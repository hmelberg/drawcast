// The Player executes the command plan under the invariant: commands run
// strictly in sequence, each completes before the next begins (the one
// deliberate exception: speak with blocking:false starts narration and moves
// on). Supports the three global playback modes, play/pause, command-level
// stepping, and a live speed multiplier. Scrubbing applies the plan's
// precomputed scene state (visibility, offsets, camera) at any boundary.

import type { Plan, SceneState } from "./plan";
import { INITIAL_STATE } from "./plan";
import type { BackendEffects, RenderedElement } from "./backend";
import { EASINGS, FULL_CANVAS_BOX, lerpBox, pathPosition, pointerPath, unionBoxes } from "./effects";
import { pacedDurations } from "./pacing";
import type { BBox } from "../layout/geometry";
import type { Pt } from "../layout/model";
import { SpeechManager, type SpeechLike } from "./speech";
import type { ToneLike } from "./tones";

export type PlaybackMode = "narrated" | "silent" | "instant";
export type PlayerState = "idle" | "playing" | "paused" | "done";

export interface Reprojector {
  /** Cheap per-frame swap at interpolated params. */
  frame(params: Record<string, number>, visible: ReadonlySet<string>, offsets: Record<string, Pt>): void;
  /** Full remount at settled params; returns the new element handles. */
  commit(params: Record<string, number>): Map<string, RenderedElement>;
}

export interface PlayerCallbacks {
  onState?(state: PlayerState): void;
  onStep?(completed: number, total: number): void;
}

const ERASE_SPEED = 0.55; // erasing runs faster than drawing
const CLEAR_MS = 550;
// Instant elements (durationMs 0, e.g. explicit instant text) would clear in
// 0 ms — a snap where everything else fades. The floor keeps clear soft.
const CLEAR_MIN_MS = 250;

export class Player {
  private plan: Plan;
  private elements: Map<string, RenderedElement>;
  private speech: SpeechLike;
  private captionEl: HTMLElement | null;
  private effects: BackendEffects | null;
  /** Settable after construction (the UI wires its controls in later). */
  callbacks: PlayerCallbacks;
  /**
   * Provider for the wait verb, set by the controls layer (click overlay) or
   * the exporter (auto-resolve). Must resolve on signal abort. When unset,
   * wait degrades to a short pause so a bare Player never deadlocks.
   */
  inputGate: ((signal: AbortSignal) => Promise<void>) | null = null;
  /** Injectable after construction, exactly like inputGate: swaps geometry for the animate action. */
  reprojector: Reprojector | null = null;
  /**
   * Frame scheduler, injectable like inputGate: the exporter swaps in one
   * that keeps ticking while the tab is hidden (a Web Worker interval).
   * Callbacks receive a timestamp on the main window's clock.
   */
  raf: (cb: (now: number) => void) => void = (cb) => requestAnimationFrame(cb);
  /**
   * Sound engine for the play command, injectable like inputGate: live
   * playback wires a speaker-connected WebAudioTones, the exporter wires one
   * bound to its recording destination (notes land in the video, silently).
   * Null (headless tests) keeps play as pure pacing.
   */
  tones: ToneLike | null = null;

  private mode: PlaybackMode;
  private speedVal: number;
  private pausedFlag = false;
  /**
   * In-flight non-blocking narration. Steps that add or remove content (draw/
   * show/erase/clear/wait) await it first, so visuals never race ahead of the
   * voice; gestures and pauses run UNDER the voice by design.
   */
  private pendingSpeech: Promise<void> | null = null;
  /** The current narrated step's voice, so effects can follow it (glow-while-speaking). */
  private narrationVoice: Promise<void> | null = null;
  private ac: AbortController | null = null;
  /** Boundary: number of fully completed steps. */
  private completed = 0;
  /** Speaker "a"'s gender (from Spec.voice), passed through to every speech.speak call. */
  private narratorGender: "male" | "female" | null = null;
  /** Animate params currently reflected on screen (last reprojector.commit call). */
  private appliedParams: Record<string, number> = {};
  /** True once any reprojector.frame() has run since the last commit — forces the next applyParams to commit even if params compare equal (frame() left the DOM at a live, possibly detached, mid-tween state). */
  private geometryDirty = false;
  state: PlayerState = "idle";

  constructor(
    plan: Plan,
    elements: Map<string, RenderedElement>,
    speech: SpeechLike,
    captionEl: HTMLElement | null,
    opts: { mode?: PlaybackMode; speed?: number; effects?: BackendEffects } = {},
    callbacks: PlayerCallbacks = {},
  ) {
    this.plan = plan;
    this.elements = elements;
    this.speech = speech;
    this.captionEl = captionEl;
    this.effects = opts.effects ?? null;
    this.callbacks = callbacks;
    this.mode = opts.mode ?? "narrated";
    this.speedVal = opts.speed ?? 1;
    this.hideAll();
  }

  get totalSteps(): number {
    return this.plan.steps.length;
  }

  get position(): number {
    return this.completed;
  }

  setSpeed(x: number): void {
    this.speedVal = x;
  }

  setMode(mode: PlaybackMode): void {
    this.mode = mode;
    if (mode === "instant") this.renderUpTo(this.plan.steps.length);
  }

  setNarratorGender(g: "male" | "female" | null): void {
    this.narratorGender = g;
  }

  async play(): Promise<void> {
    if (this.state === "playing") return;
    if (this.ac && this.state === "paused" && this.pausedFlag) {
      // resume mid-step
      this.pausedFlag = false;
      this.speechSynthResume();
      this.setState("playing");
      return;
    }
    if (this.mode === "instant") {
      this.renderUpTo(this.plan.steps.length);
      return;
    }
    if (this.completed >= this.plan.steps.length) this.renderUpTo(0);

    const ac = new AbortController();
    this.ac = ac;
    this.pausedFlag = false;
    this.setState("playing");
    while (this.completed < this.plan.steps.length && !ac.signal.aborted) {
      this.callbacks.onStep?.(this.completed, this.plan.steps.length);
      await this.runStep(this.completed, ac.signal);
      if (ac.signal.aborted) return;
      this.completed++;
      this.callbacks.onStep?.(this.completed, this.plan.steps.length);
    }
    if (!ac.signal.aborted) {
      this.ac = null;
      this.setState("done");
    }
  }

  pause(): void {
    if (this.state !== "playing") return;
    this.pausedFlag = true;
    this.speech.pause();
    this.tones?.pause();
    this.setState("paused");
  }

  stop(): void {
    this.renderUpTo(0);
  }

  stepForward(): void {
    this.renderUpTo(Math.min(this.completed + 1, this.plan.steps.length));
  }

  stepBack(): void {
    this.renderUpTo(Math.max(this.completed - 1, 0));
  }

  /**
   * Poster/thumbnail state: show the finished figure without caption. Pressing
   * play from here restarts from the beginning.
   */
  showPoster(): void {
    this.renderUpTo(this.plan.steps.length);
    this.setCaption("");
  }

  /** Scene state at a step boundary (after steps[0..n-1]). */
  private stateAt(n: number): SceneState {
    return n > 0 ? this.plan.states[n - 1] : INITIAL_STATE;
  }

  /** Jump to a step boundary: apply exactly the scene state after steps[0..n-1]. */
  renderUpTo(n: number): void {
    this.abortRun();
    const scene = this.stateAt(n);
    this.applyParams(scene.params);
    this.applyScene(scene);
    this.completed = n;
    // Show the most recent narration line at this boundary.
    let caption = "";
    for (let i = 0; i < n; i++) {
      const s = this.plan.steps[i];
      if (s.kind === "speak") caption = s.text;
      else if (s.narration !== undefined) caption = s.narration;
    }
    this.setCaption(caption);
    this.callbacks.onStep?.(this.completed, this.plan.steps.length);
    this.setState(n >= this.plan.steps.length ? "done" : n === 0 ? "idle" : "paused");
  }

  /** Apply a scene's visibility/offsets/pointer/camera to the currently mounted elements. */
  private applyScene(scene: SceneState): void {
    const visible = new Set(scene.visible);
    for (const [id, el] of this.elements) {
      const [dx, dy] = scene.offsets[id] ?? [0, 0];
      el.setOffset?.(dx, dy);
      if (visible.has(id)) el.finish();
      else el.hide();
    }
    this.effects?.setPointer(null);
    this.effects?.setCamera(scene.camera);
  }

  private static sameParams(a: Record<string, number>, b: Record<string, number>): boolean {
    const ka = Object.keys(a);
    const kb = Object.keys(b);
    return ka.length === kb.length && ka.every((k) => a[k] === b[k]);
  }

  /**
   * Remount at the boundary's params when they differ from what is on screen,
   * or when reprojector.frame() has run since the last commit (its mid-tween
   * DOM state must always be settled by a trailing commit — never left as-is,
   * even if the boundary's params happen to equal the last committed ones).
   */
  private applyParams(params: Record<string, number>): void {
    if (!this.reprojector) return;
    if (!this.geometryDirty && Player.sameParams(this.appliedParams, params)) return;
    this.elements = this.reprojector.commit(params);
    this.appliedParams = { ...params };
    this.geometryDirty = false;
  }

  dispose(): void {
    this.abortRun();
  }

  private abortRun(): void {
    this.pausedFlag = false;
    this.pendingSpeech = null;
    this.speech.cancel();
    this.tones?.cancel();
    this.ac?.abort();
    this.ac = null;
  }

  /** Wait out any in-flight non-blocking narration (resolves on abort too). */
  private async narrationBarrier(): Promise<void> {
    if (!this.pendingSpeech) return;
    await this.pendingSpeech;
    this.pendingSpeech = null;
  }

  private speechSynthResume(): void {
    this.speech.resume();
    this.tones?.resume();
  }

  private setState(s: PlayerState): void {
    this.state = s;
    this.callbacks.onState?.(s);
  }

  private setCaption(text: string): void {
    if (!this.captionEl) return;
    this.captionEl.textContent = text;
    this.captionEl.classList.toggle("cs-caption-empty", text === "");
  }

  private els(ids: string[]): RenderedElement[] {
    return ids.map((id) => this.elements.get(id)).filter((el): el is RenderedElement => el !== undefined);
  }

  private async runStep(index: number, signal: AbortSignal): Promise<void> {
    const step = this.plan.steps[index];
    if (step.kind !== "speak" && step.narration !== undefined) {
      // Narrated action: voice and action start together; both must finish.
      await this.narrationBarrier();
      if (signal.aborted) return;
      this.setCaption(step.narration);
      const voice =
        this.mode === "narrated"
          ? this.speech.speak(step.narration, this.speedVal, signal, {
              speaker: step.narrationSpeaker,
              delivery: step.narrationDelivery,
              gender: this.narratorGender ?? undefined,
            })
          : this.waitScaled(Math.min(1400, SpeechManager.estimateMs(step.narration) * 0.4), signal);
      this.narrationVoice = voice;
      try {
        await Promise.all([this.runAction(index, signal), voice]);
      } finally {
        this.narrationVoice = null;
      }
      return;
    }
    return this.runAction(index, signal);
  }

  private async runAction(index: number, signal: AbortSignal): Promise<void> {
    const step = this.plan.steps[index];
    const before = this.stateAt(index);
    switch (step.kind) {
      case "speak": {
        this.setCaption(step.text);
        if (this.mode === "narrated") {
          const spoken = this.speech.speak(step.text, this.speedVal, signal, {
            speaker: step.speaker,
            delivery: step.delivery,
            gender: this.narratorGender ?? undefined,
          });
          if (step.blocking) await spoken;
          else this.pendingSpeech = spoken;
        } else {
          // silent: hold the caption for a reading-time slice instead
          const hold = this.waitScaled(Math.min(1400, SpeechManager.estimateMs(step.text) * 0.4), signal);
          if (step.blocking) await hold;
          else this.pendingSpeech = hold;
        }
        return;
      }
      case "pause":
        return this.waitScaled(step.seconds * 1000, signal);
      case "play": {
        await this.narrationBarrier();
        if (signal.aborted) return;
        // Notes are scheduled on the audio clock; the WAIT runs on the frame
        // clock (worker-driven in export), so background tabs can't desync.
        // Tempo scales with the live speed so audio and wait stay aligned.
        if (this.mode === "narrated") this.tones?.play(step.voices, step.tempo * this.speedVal, signal);
        if (step.press.length === 0) return this.waitScaled(step.seconds * 1000, signal);
        // Reveal press[k] the moment its note starts — driven off the same
        // progress clock as the wait, so audio and ink stay locked together.
        let revealed = 0;
        await this.progress(step.seconds * 1000, signal, (t) => {
          while (revealed < step.press.length && step.pressAt[revealed] <= t) {
            this.elements.get(step.press[revealed])?.finish();
            revealed++;
          }
        });
        return;
      }
      case "wait":
        await this.narrationBarrier();
        if (signal.aborted) return;
        if (this.inputGate) return this.inputGate(signal);
        return this.waitScaled(800, signal);
      case "draw": {
        await this.narrationBarrier();
        if (signal.aborted) return;
        const els = this.els(step.ids);
        const ms = this.paced(els, step, 1);
        if (step.parallel) {
          await Promise.all(els.map((el, i) => this.animateRange(el, 0, 1, ms[i], signal)));
        } else {
          for (const [i, el] of els.entries()) {
            await this.animateRange(el, 0, 1, ms[i], signal);
            if (signal.aborted) return;
          }
        }
        return;
      }
      case "show":
        await this.narrationBarrier();
        if (signal.aborted) return;
        for (const el of this.els(step.ids)) el.finish();
        return;
      case "hide":
        for (const el of this.els(step.ids)) el.hide();
        return;
      case "erase": {
        await this.narrationBarrier();
        if (signal.aborted) return;
        const els = this.els(step.ids);
        const ms = this.paced(els, step, ERASE_SPEED);
        if (step.parallel) {
          await Promise.all(els.map((el, i) => this.animateRange(el, 1, 0, ms[i], signal)));
        } else {
          for (const [i, el] of els.entries()) {
            await this.animateRange(el, 1, 0, ms[i], signal);
            if (signal.aborted) return;
          }
        }
        return;
      }
      case "clear": {
        await this.narrationBarrier();
        if (signal.aborted) return;
        const els = this.els(step.ids);
        await Promise.all(
          els.map((el) => this.animateRange(el, 1, 0, Math.min(Math.max(el.durationMs * 0.4, CLEAR_MIN_MS), CLEAR_MS), signal)),
        );
        return;
      }
      case "highlight": {
        if (!this.effects) return;
        const effects = this.effects;
        const box = unionBoxes(
          step.ids.flatMap((id) => {
            const b = step.boxes[id];
            if (!b) return [];
            const [dx, dy] = before.offsets[id] ?? [0, 0];
            return [{ x: b.x + dx, y: b.y + dy, w: b.w, h: b.h }];
          }),
        );
        try {
          if (step.untilNarrationEnd && this.narrationVoice) {
            // Glow-while-speaking: repeat full effect cycles until the voice
            // ends (each progress cycle is one complete swell/throb).
            let speaking = true;
            void this.narrationVoice.finally(() => (speaking = false));
            while (speaking && !signal.aborted) {
              await this.progress(step.seconds * 1000, signal, (t) => effects.setHighlight(step.ids, step.effect, t, box, step.color));
            }
          } else {
            await this.progress(step.seconds * 1000, signal, (t) => effects.setHighlight(step.ids, step.effect, t, box, step.color));
          }
        } finally {
          effects.endHighlight(step.ids);
        }
        return;
      }
      case "point": {
        if (!this.effects) return;
        const effects = this.effects;
        const [dx, dy] = step.refId ? before.offsets[step.refId] ?? [0, 0] : [0, 0];
        const box: BBox | undefined = step.box && { x: step.box.x + dx, y: step.box.y + dy, w: step.box.w, h: step.box.h };
        const path = pointerPath({ x: step.x + dx, y: step.y + dy, box }, step.gesture);
        try {
          await this.progress(step.seconds * 1000, signal, (t) => effects.setPointer(t >= 1 ? null : path(t)));
        } finally {
          effects.setPointer(null);
        }
        return;
      }
      case "animate": {
        await this.narrationBarrier();
        if (signal.aborted) return;
        const rp = this.reprojector;
        const after = this.plan.states[index].params;
        if (!rp) {
          // No reprojection surface (headless tests, degraded backends): keep the pacing.
          return this.waitScaled(step.seconds * 1000, signal);
        }
        const visible = new Set(before.visible);
        await this.progress(step.seconds * 1000, signal, (t) => {
          const e = t * t * (3 - 2 * t); // smoothstep
          const cur: Record<string, number> = { ...before.params };
          for (const key of Object.keys(step.targets)) {
            const start = step.starts[key];
            cur[key] = start === null ? step.targets[key] : start + (step.targets[key] - start) * e;
          }
          rp.frame(cur, visible, before.offsets);
          this.geometryDirty = true;
        });
        if (signal.aborted) return; // a scrub's renderUpTo owns the state now
        this.applyParams(after);
        this.applyScene(this.plan.states[index]);
        return;
      }
      case "move": {
        const els = this.els(step.ids).filter((el) => el.setOffset);
        const bases = new Map<string, Pt>(els.map((el): [string, Pt] => [el.id, before.offsets[el.id] ?? [0, 0]]));
        const ease = EASINGS[step.easing];
        await this.progress(step.seconds * 1000, signal, (t) => {
          const [px, py] = pathPosition(step.path, ease(t));
          for (const el of els) {
            const [bx, by] = bases.get(el.id)!;
            el.setOffset!(bx + px, by + py);
          }
        });
        return;
      }
      case "camera": {
        if (!this.effects) return;
        const effects = this.effects;
        const from = before.camera ?? FULL_CANVAS_BOX;
        const to = step.box ?? FULL_CANVAS_BOX;
        const ease = EASINGS["ease-in-out"];
        await this.progress(step.seconds * 1000, signal, (t) => effects.setCamera(t >= 1 ? step.box : lerpBox(from, to, ease(t))));
        return;
      }
    }
  }

  /**
   * Per-element durations for one draw/erase step, capped so the whole step
   * fits its budget (src/render/pacing.ts). `speedFactor` is the verb's own
   * multiplier (erase runs faster than draw) and applies before the cap, so
   * the budget always means wall-clock.
   */
  private paced(els: RenderedElement[], step: { parallel?: boolean; narration?: string }, speedFactor: number): number[] {
    return pacedDurations(
      els.map((el) => el.durationMs * speedFactor),
      { narrated: step.narration !== undefined, parallel: !!step.parallel },
    );
  }

  /** Reveal/erase an element by animating its progress from `from` to `to`. */
  private animateRange(el: RenderedElement, from: number, to: number, ms: number, signal: AbortSignal): Promise<void> {
    if (ms <= 0) {
      el.setProgress(to);
      return Promise.resolve();
    }
    return this.progress(ms, signal, (t) => el.setProgress(from + (to - from) * t));
  }

  /**
   * Drive onTick(t) with t ∈ [0,1] over a duration, honoring pause and the
   * live speed multiplier. Always ends with onTick(1) unless aborted.
   */
  private progress(ms: number, signal: AbortSignal, onTick: (t: number) => void): Promise<void> {
    if (ms <= 0) {
      onTick(1);
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      let t = 0;
      let last = performance.now();
      let lastP = -1;
      const tick = (now: number) => {
        if (signal.aborted) return resolve();
        if (!this.pausedFlag) t += (now - last) * this.speedVal;
        last = now;
        const p = Math.min(t / ms, 1);
        // Skip onTick while paused holds p unchanged — avoids a busy-loop of
        // relayouts (e.g. animate's reprojector.frame) firing every rAF for
        // no visual change. p===1 always gets through so completion fires.
        if (p !== lastP) {
          lastP = p;
          onTick(p);
        }
        if (p >= 1) return resolve();
        this.raf(tick);
      };
      this.raf(tick);
    });
  }

  private waitScaled(ms: number, signal: AbortSignal): Promise<void> {
    if (ms <= 0) return Promise.resolve();
    return new Promise((resolve) => {
      let t = 0;
      let last = performance.now();
      const tick = (now: number) => {
        if (signal.aborted) return resolve();
        if (!this.pausedFlag) t += (now - last) * this.speedVal;
        last = now;
        if (t >= ms) return resolve();
        this.raf(tick);
      };
      this.raf(tick);
    });
  }

  private hideAll(): void {
    for (const el of this.elements.values()) el.hide();
  }

  /**
   * Un-draw everything visible at the current boundary — the playlist's soft
   * exit between items. Runs outside the plan (no step, no state change);
   * dispose and scrubbing abort it like any running step.
   */
  async fadeOutAll(ms = CLEAR_MS): Promise<void> {
    this.abortRun();
    const ac = new AbortController();
    this.ac = ac;
    const els = this.els([...this.stateAt(this.completed).visible]);
    await Promise.all(els.map((el) => this.animateRange(el, 1, 0, ms, ac.signal)));
  }
}
