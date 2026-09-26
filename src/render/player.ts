// The Player executes the command plan under the invariant: commands run
// strictly in sequence, each completes before the next begins (the one
// deliberate exception: speak with blocking:false starts narration and moves
// on). Supports the three global playback modes, play/pause, command-level
// stepping, and a live speed multiplier. Scrubbing applies the plan's
// precomputed scene state (visibility, offsets, camera) at any boundary.

import type { MeasureFollow, MorphItem, Plan, PlanStep, SceneState, TrailProgress, TransformItem } from "./plan";
import { moveFrame, morphFrame, transformFrame } from "./tween";
import { overridesKey, type LayoutOverrides } from "../layout/posed";
import { answersMatch, AUTO_NAMESPACE, subVars } from "../spec/answers";
import { notationBeats } from "../spec/notation";
import { ACTIVITY_QUESTIONS } from "../spec/types";
import type { LayoutResult } from "../layout/layout";
import { heldFrom, sceneAt } from "./plan";
import { breathAfterMs } from "./breath";
import type { BackendEffects, RenderedElement } from "./backend";
import { EASINGS, FULL_CANVAS_BOX, FULL_VIEW_BOX, lerpBox, pointerPath, unionBoxes } from "./effects";
import { lengthFractionAt } from "./trails";
import { pacedDurations } from "./pacing";
import type { BBox } from "../layout/geometry";
import type { Pt } from "../layout/model";
import type { Easing, SpecElement } from "../spec/types";
import type { ControlValue } from "../code/controls";
import { cueStartMs } from "./cue";
import { stripLangMarks } from "./lang-spans";
import { SpeechManager, type SpeechLike } from "./speech";
import { EMPHASIS_EASE_MS, EMPHASIS_FIRST_PEAK_MS, EMPHASIS_HOLD_AT_MS, EMPHASIS_ONE_SWELL_MS, EMPHASIS_RELEASE_MS, easeInLevel, emphasisLevel, releaseLevel, swellLevel } from "./emphasis";
import { translateCaption, type SubtitleTrack } from "../spec/subtitles";
import type { ToneLike } from "./tones";
import { isIdentity, type Turn } from "./pose";
import { decodeFigures } from "./decode-figures";
import { smoothstep } from "./sweep";

export type PlaybackMode = "narrated" | "silent" | "instant";
export type PlayerState = "idle" | "playing" | "paused" | "done";

/** The per-element scene state a frame paints (the rebuilt nodes carry NO
 *  handles, so everything a handle would apply has to be repeated here). */
export interface FrameScene {
  visible: ReadonlySet<string>;
  offsets: Record<string, Pt>;
  turns: Record<string, Turn>;
  opacities: Record<string, number>;
  shapes: Record<string, Record<string, Pt[]>>;
  texts: Record<string, Record<string, string>>;
}

export interface FrameOpts {
  /** Show ids the previewed layout mints that the plan's visible set has never heard of (a chess piece on a fresh square). */
  revealNew?: boolean;
  /** The code editor's preview: a patched element list. */
  elements?: SpecElement[];
  /** The poses and shapes of the source ids the layout reads (design 2026-09-10 §2.5). */
  overrides?: LayoutOverrides;
  /** Trails mid-sweep: id → fraction of the trail drawn so far. */
  trailProgress?: Record<string, number>;
}

/** One swept script as the figure must now show it (spec 2026-09-15 §4.2):
 *  the rewritten code, its fresh envelope, and the value map that produced
 *  them (what the tray's knobs are put at when a `run` hands over). */
export interface CodePatch {
  code: string;
  result: string;
  values: Record<string, ControlValue>;
}

/** Run one script at one value map — applyControls + runCode, through the
 *  same door a knob uses. Injected by render() (src/render/sweep-run.ts), so
 *  a bare Player never carries a runtime. */
export type SweepRunner = (codeId: string, values: Record<string, ControlValue>) => Promise<{ code: string; result: string }>;

export interface Reprojector {
  /** Cheap per-frame swap at interpolated params. Values are numbers from
   *  animate/sliders except under free-play previews (a fen string, a moves
   *  array). The caller hands over the whole per-element scene state —
   *  `offsets`, `turns`, `opacities`, `shapes`, `texts` — or a rotated,
   *  scaled, faded or morphed element snaps back for the length of the tween. */
  frame(params: Record<string, unknown>, scene: FrameScene, opts?: FrameOpts): LayoutResult | void;
  /** Full remount at settled params (and the source poses/shapes of that boundary); returns the new element handles. */
  commit(params: Record<string, number>, overrides?: LayoutOverrides): Map<string, RenderedElement>;
  /** A `run`'s current patch for a script (null clears it). The render
   *  closure keeps these, so a COMMIT is patched too — a boundary layout
   *  that dropped them would snap the figure back to the authored script. */
  setCodePatch?(id: string, patch: CodePatch | null): void;
  /** The spec's elements with every live patch applied, or undefined when
   *  there is none — what a frame must be laid out from mid-sweep. */
  patchedElements?(): SpecElement[] | undefined;
}

/** One graded answer from a LIVE viewer (never a movie's auto path): what
 *  was chosen or typed, every attempt in order, and what would have been
 *  right. The viewer forwards these to the learner endpoint (src/learn.ts). */
export interface AnswerEvent {
  /** The step index — the question's slot in this drawcast's plan. */
  index: number;
  kind: "quiz" | "ask";
  /** The variable the answer was stored under: the explicit store, else `_answers.N`. */
  id: string;
  question: string;
  given: string[];
  expected: string;
  correct: boolean;
  /** Seconds from the gate opening to the answer (latest attempt); absent without a live gate. */
  secs?: number;
}

export interface PlayerCallbacks {
  onState?(state: PlayerState): void;
  onStep?(completed: number, total: number): void;
  onAnswer?(answer: AnswerEvent): void;
}

const ERASE_SPEED = 0.55; // erasing runs faster than drawing
const CLEAR_MS = 550;
const SCROLL_MS = 250; // a code window sliding one or more rows
// Instant elements (durationMs 0, e.g. explicit instant text) would clear in
// 0 ms — a snap where everything else fades. The floor keeps clear soft.
const CLEAR_MIN_MS = 250;

/** One swell of the answer glow a click question puts on the correct element. */
const ANSWER_GLOW_MS = EMPHASIS_ONE_SWELL_MS;
/** The click gate's "right" green (styles.css --ok) — a literal, since SVG presentation attributes cannot read CSS variables. */
const ANSWER_OK_COLOR = "#4a7c59";

export class Player {
  private plan: Plan;
  /** The boundary the last frame is held from (plan.ts heldFrom), or null
   *  when the drawcast ends with something on screen. Steps past it that
   *  only take things away are not performed, so the drawing stays up. */
  private readonly holdFrom: number | null;
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

  /**
   * Told when a quiz's spoken feedback starts (true) and ends (false), so the
   * card can offer "Skip explanation" for exactly that long; `skipFeedback`
   * cuts it short (Hans 2026-09-26: "even after we click on an answer, we
   * should still be able to skip the explanation").
   */
  feedbackHook: ((active: boolean) => void) | null = null;
  private feedbackCtl: AbortController | null = null;
  /** Cut the current quiz feedback short; the lesson goes on from there. */
  skipFeedback(): void {
    this.feedbackCtl?.abort();
  }

  /**
   * Provider for the quiz verb, set by the controls layer (choice buttons) or
   * the exporter (auto-reveal beat). Resolves the 0-based chosen index, or
   * null for skipped/auto. Must resolve on signal abort. When unset, quiz
   * degrades to a short hold + reveal so a bare Player never deadlocks.
   */
  quizGate: ((signal: AbortSignal, step: Extract<PlanStep, { kind: "quiz" }>) => Promise<number | null>) | null = null;

  /**
   * Provider for the typed ask verb, set by the controls layer (input card)
   * or the exporter (self-typing demo). Resolves the typed string, or null
   * for skipped. Must resolve on signal abort. When unset, ask degrades to a
   * short hold + the auto text so a bare Player never deadlocks.
   */
  askGate: ((signal: AbortSignal, step: Extract<PlanStep, { kind: "ask" }>) => Promise<string | null>) | null = null;
  /** The code widget's gate — ui/tray.ts sets it, ui/controls.ts routes to it. */
  codeGate: ((signal: AbortSignal, step: Extract<PlanStep, { kind: "ask" }>) => Promise<string | null>) | null = null;

  /** A template-bound ask's movie form, set by render() when the template carries a widget body: performs the widget's demo effects. */
  widgetDemo: ((signal: AbortSignal, step: Extract<PlanStep, { kind: "ask" }>) => Promise<void>) | null = null;

  /**
   * Provider for the explore verb, wired by the tray: opens the sliders and
   * resolves on Continue. Must resolve on signal abort. Absent (movies,
   * embeds, bare players), the WHOLE step — narration included — is skipped:
   * an exploration invitation with nothing to explore is a dangling intro.
   */
  /** Resolves when the viewer continues — with the vars the beat's `store`
   *  keeps (an activity's score, a composed melody), or nothing. */
  exploreGate: ((signal: AbortSignal, step: Extract<PlanStep, { kind: "explore" }>) => Promise<Record<string, string> | void>) | null = null;

  /** Responses collected by ask commands with store — {name} in later
   *  narration interpolates from here. Keys are lowercased. */
  readonly vars = new Map<string, string>();

  /** Viewer preference: skip quiz/ask entirely (a skipped collect-ask still
   *  stores its default so later {var} lines keep working). */
  private skipQuestions = false;

  /** Set by the exporter (and true in spirit for bare players): answers are
   *  the demo's, not a viewer's — gotos never fire, the path stays linear. */
  autoAnswers = false;

  /** A goto requested by the current step; the play loop performs it. */
  private pendingJump: number | null = null;

  /** Runtime values of "{var}" animate targets (path → the viewer's number).
   *  Overlaid by applyParams/previewParams — but only onto paths already
   *  present in the boundary's params, so pre-animate boundaries stay
   *  untouched and post-animate scrubs keep the personalization. */
  private varParamOverrides: Record<string, number> = {};

  /** Per-question outcomes, keyed by step index — re-answering a question
   *  (a remediation goto, a replay) overwrites its slot, never double-counts. */
  private outcomes = new Map<number, boolean>();

  /** Step index → 1-based ordinal among the playlist's questions (the N of
   *  `_answers.N`), assigned from the plan at construction. */
  readonly ordinalOf = new Map<number, number>();
  /** Question steps that have been answered (or skipped past) — `_answers.count`. */
  private answeredSteps = new Set<number>();

  /**
   * Publish one answer (spec 2026-09-15-stored-answers §2): under its ordinal
   * (`_answers.N`, `.N.ok`, `.N.secs`), under `_answers.last`, the running
   * `_answers.count`, and under the explicit store name with the same fields.
   * `ok` null (a collect-mode ask) and `secs` null (no live gate) write no
   * field — and clear a stale one, since latest wins.
   */
  /** The name an answer event and the record report: the explicit store, else the ordinal's slot. */
  private answerId(index: number, store: string | undefined): string {
    return store ? store.toLowerCase() : `${AUTO_NAMESPACE}.${this.ordinalOf.get(index) ?? 0}`;
  }

  private recordAnswer(index: number, store: string | undefined, value: string, ok: boolean | null, secs: number | null): void {
    const fields = (base: string): void => {
      this.vars.set(base, value);
      if (ok !== null) this.vars.set(`${base}.ok`, ok ? "true" : "false");
      else this.vars.delete(`${base}.ok`);
      if (secs !== null) this.vars.set(`${base}.secs`, secs.toFixed(1));
      else this.vars.delete(`${base}.secs`);
    };
    const n = this.ordinalOf.get(index);
    if (n !== undefined) {
      fields(`${AUTO_NAMESPACE}.${n}`);
      this.answeredSteps.add(index);
    }
    fields(`${AUTO_NAMESPACE}.last`);
    this.vars.set(`${AUTO_NAMESPACE}.count`, String(this.answeredSteps.size));
    if (store) fields(store.toLowerCase());
  }

  /** Publish {score}/{score_total} from the outcomes — called right after an
   *  answer lands, BEFORE the feedback lines speak. Digit strings: they read
   *  naturally in narration and if's numeric ops coerce at comparison time. */
  private updateScoreVars(): void {
    let right = 0;
    for (const ok of this.outcomes.values()) if (ok) right++;
    this.vars.set("score", String(right));
    this.vars.set("score_total", String(this.outcomes.size));
  }

  /** Interpolate stored ask answers into a narration/caption line. */
  private line(text: string): string {
    return subVars(text, this.vars);
  }

  /**
   * The active subtitle track — what the viewer READS — or undefined for the
   * language the drawcast was written in. Independent of what is spoken (see
   * setSpokenTrack): the default is the original voice under translated text,
   * because baked or cloud narration really is a recording in one language and
   * a caption is not.
   */
  private subtitles: SubtitleTrack | undefined;

  /** The source line the caption currently shows, kept so a language change
   *  can re-render it without moving the playhead. */
  private captionSource = "";

  /**
   * Show a source line as the caption: translate first, substitute second.
   * That order is load-bearing — the translator copies {var} tokens through
   * verbatim, so a track's keys are the RAW spec lines, and a lookup done
   * after substitution would miss every personalized line.
   */
  private showCaption(source: string): void {
    this.captionSource = source;
    this.setCaption(this.line(translateCaption(source, this.subtitles)));
  }

  /** Switch the CC track (undefined = the source language). Re-renders the
   *  caption already on screen; never touches the playhead or the voice. */
  setSubtitles(track: SubtitleTrack | undefined): void {
    this.subtitles = track;
    this.showCaption(this.captionSource);
  }

  /**
   * What the VOICE says, which is a separate choice from what the caption
   * shows: Norwegian subtitles over the original English narration is a real
   * way to watch (read along), and so is the mirror image. The two tracks are
   * never coupled.
   */
  private spoken: SubtitleTrack | undefined;

  /** Switch the spoken track (undefined = the source language). Takes effect
   *  from the next line; the line already in the air is left to finish. */
  setSpokenTrack(track: SubtitleTrack | undefined): void {
    this.spoken = track;
  }

  /** The words to SPEAK for a source line: spoken track first, then {var}
   *  substitution — the same order, and for the same reason, as showCaption. */
  private spokenLine(source: string): string {
    return this.line(translateCaption(source, this.spoken));
  }
  /** Injectable after construction, exactly like inputGate: swaps geometry for the animate action. */
  reprojector: Reprojector | null = null;
  /**
   * Runs one script at one value map — the `run` step's engine, injected by
   * render() (sweep-run.ts). Null (headless tests, a Player with no runtime)
   * degrades a run to its pacing, exactly as a missing reprojector degrades
   * an animate: the drawcast keeps its shape, the figure just does not move.
   */
  sweepRunner: SweepRunner | null = null;
  /** Whether a caption shown now would sit on dark ground (render/caption-dark.ts), given what is on screen; the caption then takes the band. */
  captionOnDark: ((visible: readonly string[]) => boolean) | null = null;
  /**
   * id → the patches a `run` has left on that script, oldest first, one entry
   * per step that set one. A HISTORY, not a single value, because a script
   * can be swept twice: a scrub to a boundary between two runs must put the
   * FIRST run's result back, not throw the script away (the authored figure
   * belongs only before the first run of all). Mirrored here so the player
   * can answer without the reprojector — the tray asks what a run left the
   * script at.
   */
  private patchHistory = new Map<string, { step: number; patch: CodePatch }[]>();
  /**
   * plan step index → the full series of results that `run` step produced,
   * kept past the scrub that took its patch away. Patches are RUNTIME state:
   * `plan.states` carries none, so a scrub FORWARD over a run lands on a
   * boundary whose figure the plan cannot describe. This is how the boundary
   * gets described anyway — without running the script again, and without
   * the history entry, which `dropPatchesFrom` is entitled to throw away.
   */
  private runResults = new Map<number, CodePatch[]>();
  /**
   * The `run` step in flight, if any: its results all exist (they are
   * computed before the first frame) but its history entry holds only the
   * value the tween has reached so far. A scrub PAST it aborts it mid-sweep,
   * and must land on the value the run ENDS at, not on the half-swept one.
   */
  private activeRun: { index: number; id: string; results: CodePatch[] } | null = null;
  /**
   * The layout currently PAINTED, when a preview has replaced the plan-time
   * one. Anything hit-testing drawn geometry — a switch on a monitor's chin,
   * an overlay pinned to its glass — must ask for this, or it will be aiming
   * at where things were before the preview moved them.
   */
  private painted: LayoutResult | null = null;
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
  /** Breathe after spoken beats (render/breath.ts). Off only for tests that measure raw sequencing. */
  private breathOn: boolean;
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
  /** What is mounted: the params plus the source poses/shapes (design 2026-09-10 §2.5) the last commit ran at. */
  private appliedKey = Player.keyOf({}, undefined);
  /** True once any reprojector.frame() has run since the last commit — forces the next applyParams to commit even if params compare equal (frame() left the DOM at a live, possibly detached, mid-tween state). */
  private geometryDirty = false;
  /** Ids the plan-time layout had: anything a later param change mints beyond these was never addressable by a visibility verb and joins the implicit final draw (shown as soon as it exists). */
  private readonly planTimeIds: ReadonlySet<string>;
  /** The ids something is DEFINED by (plan.sources): only their poses and shapes are part of a boundary's layout key. */
  private readonly sources: ReadonlySet<string>;
  state: PlayerState = "idle";

  constructor(
    plan: Plan,
    elements: Map<string, RenderedElement>,
    speech: SpeechLike,
    captionEl: HTMLElement | null,
    opts: { mode?: PlaybackMode; speed?: number; effects?: BackendEffects; questions?: "on" | "skip"; vars?: ReadonlyMap<string, string>; questionOffset?: number; breath?: boolean } = {},
    callbacks: PlayerCallbacks = {},
  ) {
    this.plan = plan;
    this.holdFrom = heldFrom(plan);
    this.elements = elements;
    // A copy's id never appears in the plan-time (mounted) layout, so without
    // this it always fell through as "minted by a param change" and every
    // applyScene call unconditionally finish()ed it — undoing an erase/hide/
    // clear on a copy at the very next commit (review finding 1, 2026-09-10).
    this.planTimeIds = new Set([...elements.keys(), ...plan.states.flatMap((s) => Object.keys(s.copies ?? {}))]);
    this.sources = new Set(plan.sources ?? []);
    this.speech = speech;
    this.captionEl = captionEl;
    this.effects = opts.effects ?? null;
    this.callbacks = callbacks;
    this.mode = opts.mode ?? "narrated";
    this.speedVal = opts.speed ?? 1;
    this.breathOn = opts.breath ?? true;
    // Carried in from earlier playlist items (playlist/carry.ts): a name
    // stored in part 1 reads in part 3. Latest wins, so this item's own
    // answers overwrite what came in.
    if (opts.vars) for (const [k, v] of opts.vars) this.vars.set(k, v);
    // Every quiz/ask step gets its ordinal up front, from the plan, so
    // {_answers.N} means "the N-th question" whether or not the viewer
    // answered it, and a wrong_goto loop re-answers the same slot.
    let n = opts.questionOffset ?? 0;
    plan.steps.forEach((s, i) => {
      if (s.kind === "quiz" || s.kind === "ask") this.ordinalOf.set(i, ++n);
    });
    this.skipQuestions = opts.questions === "skip";
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
    // A pending tray preview (geometryDirty) must settle before stepping:
    // frame() leaves handle-less DOM, and the run's actions need honest
    // elements. No-op when nothing is dirty and params already match.
    this.applyKey(this.stateAt(this.completed));

    const ac = new AbortController();
    this.ac = ac;
    this.pausedFlag = false;
    this.setState("playing");
    while (this.completed < this.plan.steps.length && !ac.signal.aborted) {
      this.callbacks.onStep?.(this.completed, this.plan.steps.length);
      await this.runStep(this.completed, ac.signal);
      if (ac.signal.aborted) return;
      if (this.pendingJump !== null) {
        const n = this.pendingJump;
        this.pendingJump = null;
        this.jumpTo(n, true);
        continue;
      }
      // A breath after a spoken beat (render/breath.ts): the next step's
      // voice and ink start only once the sentence has had its moment.
      // Scaled with playback speed like every other wait, and skipped when
      // the author wrote a `pause` here.
      if (this.breathOn) {
        await this.waitScaled(breathAfterMs(this.plan.steps, this.completed), ac.signal);
        if (ac.signal.aborted) return;
      }
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
    // The poster is the FINISHED drawing (Hans 2026-09-24: "the first page is
    // supposed to be the final drawing"): what the cast leaves on the page,
    // the whole page in view and at full strength — not the end's camera on
    // one detail (a zoom walk, a close-up that never pulled back) nor the
    // shadow a walk or a fade left the earlier items in. Erased things stay
    // erased: that was the author's choice. Playing moves on from here as
    // from any boundary.
    const end = this.stateAt(this.plan.steps.length);
    this.applyScene({ ...end, camera: null, opacities: {} });
    this.showCaption("");
  }

  /** Scene state PAINTED at a step boundary (after steps[0..n-1]) — the
   *  held last frame past holdFrom, the planned state everywhere else. */
  private stateAt(n: number): SceneState {
    return sceneAt(this.plan, n);
  }

  /** Whether a step that only takes things away is past the held frame —
   *  performed, it would wipe the frame the drawcast is meant to end on. */
  private heldPast(index: number): boolean {
    return this.holdFrom !== null && index >= this.holdFrom;
  }

  /** Jump to a step boundary: apply exactly the scene state after steps[0..n-1]. */
  renderUpTo(n: number): void {
    this.abortRun();
    this.jumpTo(n, false);
  }

  /** Move the playhead to a boundary: scrub (keepPlaying false, from
   *  renderUpTo) or a content-initiated goto mid-run (keepPlaying true —
   *  the run's own AbortController must survive the jump). Both drop the
   *  patches the steps at or after `n` made: a remediation `goto` that
   *  jumped backwards over a `run` and left its entry standing would put the
   *  history out of order, and the next scrub would show the wrong patch. */
  jumpTo(n: number, keepPlaying: boolean): void {
    // A sweep's patch belongs to the step that set it: scrubbing to before
    // that step undoes it (back to the previous run's result, or to what the
    // author wrote), scrubbing past it keeps it. Dropped BEFORE the key is
    // applied, so the boundary commit below is laid out from the right script.
    this.dropPatchesFrom(n);
    // …and a scrub landing PAST a run puts back what that run ended on.
    if (!keepPlaying) this.restoreRunPatches(n);
    const scene = this.stateAt(n);
    this.applyKey(scene);
    this.applyScene(scene);
    this.completed = n;
    // Show the most recent narration line at this boundary.
    let caption = "";
    for (let i = 0; i < n; i++) {
      const s = this.plan.steps[i];
      if (s.kind === "speak") caption = s.text;
      else if (s.narration !== undefined && !(this.skipQuestions && (s.kind === "quiz" || s.kind === "ask"))) caption = s.narration;
    }
    this.showCaption(caption);
    this.callbacks.onStep?.(this.completed, this.plan.steps.length);
    if (!keepPlaying) this.setState(n >= this.plan.steps.length ? "done" : n === 0 ? "idle" : "paused");
  }

  /** Apply a scene's visibility/offsets/pointer/camera to the currently mounted elements. */
  private applyScene(scene: SceneState): void {
    const visible = new Set(scene.visible);
    for (const [id, el] of this.elements) {
      const [dx, dy] = scene.offsets[id] ?? [0, 0];
      const turn = scene.turns[id];
      if (turn && el.setTransform) el.setTransform(dx, dy, turn.deg, turn.pivot, turn.scale ?? 1, turn.mirror ?? false);
      else el.setOffset?.(dx, dy);
      el.setOpacity?.(scene.opacities[id] ?? 1);
      el.setPoints?.(scene.shapes[id] ?? {});
      el.setText?.(scene.texts[id] ?? {});
      if (visible.has(id) || !this.planTimeIds.has(id)) el.finish();
      else el.hide();
    }
    this.effects?.setPointer(null);
    this.effects?.setCamera(scene.camera);
  }

  private static keyOf(params: Record<string, number>, ov: LayoutOverrides | undefined): string {
    return JSON.stringify([Object.entries(params).sort(([a], [b]) => (a < b ? -1 : 1)), overridesKey(ov)]);
  }

  /** The poses and shapes of the source ids at a scene, plus every math
   *  element's current TeX and every clone `copy` has minted — the part of
   *  the scene a layout reads (design 2026-09-10 §2.5); undefined when none
   *  of the four is populated. Poses/shapes stay restricted to sources so a
   *  move of anything else never changes the key (and never forces a
   *  remount); tex and copies never are — a TeX override always changes the
   *  layout, and a copy is what MAKES an id exist at all (mirrors plan.ts's
   *  currentOverrides, so both sides key the same layout). `frameMath`
   *  overlays a tween in progress (its `from`/`t`) onto the settled tex. */
  private overridesOf(
    offsets: Record<string, Pt>,
    turns: Record<string, Turn>,
    shapes: Record<string, Record<string, Pt[]>>,
    tex: Record<string, string>,
    copies: Record<string, string>,
    frameMath?: Record<string, { tex: string; from?: string; t?: number }>,
  ): LayoutOverrides | undefined {
    const poses: Record<string, { offset: Pt; turn?: Turn }> = {};
    const shp: Record<string, Record<string, Pt[]>> = {};
    for (const id of this.sources) {
      const o = offsets[id];
      const t = turns[id];
      if ((o && (o[0] !== 0 || o[1] !== 0)) || (t && !isIdentity(t))) poses[id] = { offset: o ?? [0, 0], turn: t };
      if (shapes[id]) shp[id] = shapes[id];
    }
    const math: Record<string, { tex: string; from?: string; t?: number }> = {};
    for (const [id, t] of Object.entries(tex)) math[id] = { tex: t };
    Object.assign(math, frameMath);
    if (Object.keys(poses).length === 0 && Object.keys(shp).length === 0 && Object.keys(math).length === 0 && Object.keys(copies).length === 0) return undefined;
    return { poses, shapes: shp, math, copies: { ...copies } };
  }

  private frameScene(scene: SceneState, visible: ReadonlySet<string> = new Set(scene.visible)): FrameScene {
    return { visible, offsets: scene.offsets, turns: scene.turns, opacities: scene.opacities, shapes: scene.shapes, texts: scene.texts };
  }

  /**
   * Remount at the boundary's params when they differ from what is on screen,
   * or when reprojector.frame() has run since the last commit (its mid-tween
   * DOM state must always be settled by a trailing commit — never left as-is,
   * even if the boundary's params happen to equal the last committed ones).
   */
  /** Commit the current boundary's honest geometry MID-RUN — the explore
   *  gate's way back after slider previews (renderUpTo would abort the run
   *  the gate is parked on). Adopts fresh element handles. */
  settleParams(): void {
    // A `run`'s patch is NOT preview state: it is what the lesson now shows,
    // and it survives Continue (only a scrub back past the run takes it away).
    this.applyKey(this.stateAt(this.completed));
  }

  /** What a `run` has left this script at, or null — the tray reads it to
   *  open its knobs where the sweep stopped instead of at the author's
   *  defaults. */
  codePatchOf(id: string): CodePatch | null {
    const hist = this.patchHistory.get(id);
    return hist && hist.length > 0 ? hist[hist.length - 1].patch : null;
  }

  /** The elements a frame must be laid out from while a sweep is live. */
  patchedElements(): SpecElement[] | undefined {
    return this.reprojector?.patchedElements?.();
  }

  /** Record one script's patch at the step that made it, and show it. Within
   *  a step the newest wins (a sweep sets one per value, and only its last is
   *  a boundary's state) — so the history holds one entry per (id, step) and
   *  never grows with the length of a sweep. */
  private pushCodePatch(id: string, patch: CodePatch, step: number): void {
    const hist = this.patchHistory.get(id) ?? [];
    // BY STEP, not by arrival: a forward scrub fills in the runs it skipped
    // after later ones may already have entries, and an out-of-order history
    // would make `dropPatchesFrom` and `codePatchOf` answer with the wrong
    // one. Playback always appends (its step is the newest), so the common
    // path is still a push or an in-place replace.
    const at = hist.findIndex((e) => e.step >= step);
    if (at === -1) hist.push({ step, patch });
    else if (hist[at].step === step) hist[at] = { step, patch };
    else hist.splice(at, 0, { step, patch });
    this.patchHistory.set(id, hist);
    // Only the newest entry is what the figure shows; an older one filled in
    // behind a later run's result must not paint over it.
    if (hist[hist.length - 1].step === step) this.showCodePatch(id, patch);
  }

  /**
   * Put back what every `run` before boundary `n` left its script at.
   *
   * A forward scrub crosses runs the viewer never played, and there is
   * nothing in the plan to read their results from — `plan.states` carries
   * geometry, not code. So: a run whose results are already known (the one in
   * flight this scrub just aborted, or one remembered from an earlier play)
   * gets its LAST result applied synchronously, before the boundary is laid
   * out. A run with no results at all is asked for its last value only —
   * a cache read after the idle warm-up — and the answer is applied later,
   * and only if the scrub it was asked for still stands.
   */
  private restoreRunPatches(n: number): void {
    const upto = Math.min(n, this.plan.steps.length);
    for (let i = 0; i < upto; i++) {
      const step = this.plan.steps[i];
      if (step.kind !== "run") continue;
      // The aborted in-flight run's entry holds the value its tween had
      // reached; its own results say where it was going. Those win.
      const known = (this.activeRun?.index === i ? this.activeRun.results : null) ?? this.runResults.get(i) ?? null;
      if (known) {
        const last = known[known.length - 1];
        // code === "" is "nothing ever succeeded" — leave the authored script.
        if (last && last.code !== "") this.pushCodePatch(step.code, last, i);
        continue;
      }
      if (this.patchHistory.get(step.code)?.some((e) => e.step === i)) continue;
      const runner = this.sweepRunner;
      const values = step.values[step.values.length - 1];
      if (!runner || !values) continue;
      void runner(step.code, values).then(
        async (patch) => {
          // Decoded before it is shown (see the run case): the restored
          // figure arrives painted, not as a pane that fills in a beat later.
          await decodeFigures(patch.result);
          // The scrub must still stand, and nothing may have played this run
          // in the meantime — either way its own result is the honest one.
          if (this.completed !== n) return;
          if (this.patchHistory.get(step.code)?.some((e) => e.step === i)) return;
          this.pushCodePatch(step.code, { ...patch, values }, i);
          // The commit mounts fresh elements, hidden until told otherwise:
          // the scene's visibility must be applied again, as jumpTo does, or
          // the whole page — heading and all — stays blank (2026-09-25: every
          // scrub past an uncached run, and every frames-harness end frame of
          // a cast with a run).
          const scene = this.stateAt(this.completed);
          this.applyKey(scene);
          this.applyScene(scene);
        },
        () => {
          /* a script that will not run leaves the authored figure standing */
        },
      );
    }
    this.activeRun = null; // consumed, or stale: either way the scrub owns the state now
  }

  /** Hand one script's patch (or null, the authored script) to the render
   *  closure, and mark the geometry dirty so the next boundary commits the
   *  patched layout even when its params compare equal to what is mounted. */
  private showCodePatch(id: string, patch: CodePatch | null): void {
    this.reprojector?.setCodePatch?.(id, patch);
    this.geometryDirty = true;
  }

  /** Take back every patch a step at or after `n` made — a scrub to before
   *  the run that made it. What the EARLIER runs left stands: the newest
   *  surviving entry goes back on screen, and only a script with no entry
   *  left returns to what the author wrote. */
  private dropPatchesFrom(n: number): void {
    for (const [id, hist] of [...this.patchHistory]) {
      let dropped = false;
      while (hist.length > 0 && hist[hist.length - 1].step >= n) {
        hist.pop();
        dropped = true;
      }
      if (!dropped) continue;
      if (hist.length === 0) {
        this.patchHistory.delete(id);
        this.showCodePatch(id, null);
      } else {
        this.showCodePatch(id, hist[hist.length - 1].patch);
      }
    }
  }

  /** The viewer's runtime var-animate values (path → number) — the tray
   *  starts its sliders at these, not at the plan-time fallbacks. */
  getParamOverrides(): Record<string, number> {
    return { ...this.varParamOverrides };
  }

  /** Overlay runtime var-animate values onto paths the params already hold. */
  private withVarOverrides(params: Record<string, number>): Record<string, number> {
    let out = params;
    for (const [k, v] of Object.entries(this.varParamOverrides)) {
      if (k in params && params[k] !== v) {
        if (out === params) out = { ...params };
        out[k] = v;
      }
    }
    return out;
  }

  private applyKey(scene: SceneState): void {
    if (!this.reprojector) return;
    this.painted = null; // back to the plan-time geometry
    const merged = this.withVarOverrides(scene.params);
    const ov = this.overridesOf(scene.offsets, scene.turns, scene.shapes, scene.tex, scene.copies);
    const key = Player.keyOf(merged, ov);
    if (!this.geometryDirty && key === this.appliedKey) return;
    this.elements = this.reprojector.commit(merged, ov);
    this.appliedKey = key;
    this.geometryDirty = false;
  }

  /**
   * Paint the current boundary with extra param overrides — the explore
   * tray's live slider preview and free play's position preview. Cheap
   * frame() geometry only (no handles); marks geometry dirty so the next
   * renderUpTo/applyParams commits honest state even when the boundary's
   * params compare equal to appliedParams.
   */
  previewParams(overrides: Record<string, unknown>, opts: { revealNew?: boolean } = {}): void {
    if (!this.reprojector) return;
    const scene = this.stateAt(this.completed);
    this.painted =
      this.reprojector.frame({ ...this.withVarOverrides(scene.params), ...overrides }, this.frameScene(scene), {
        revealNew: opts.revealNew,
        overrides: this.overridesOf(scene.offsets, scene.turns, scene.shapes, scene.tex, scene.copies),
      }) || null;
    this.geometryDirty = true;
  }

  /** One swell of the answer glow on `ids` — a widget's "right", "wrong" or
   *  "look here" — always cleared, even when there are no effects to draw it. */
  async glow(ids: string[], ms = ANSWER_GLOW_MS, color?: string): Promise<void> {
    const effects = this.effects;
    if (!effects || ids.length === 0) return;
    const ac = new AbortController();
    try {
      await this.progress(ms, ac.signal, (t) => effects.setHighlight(ids, "glow", swellLevel(t), null, color, t * ms));
    } finally {
      effects.endHighlight(ids);
    }
  }

  /** The laser taps the centre of `box` — a widget demo's gesture — and lifts. */
  async tapAt(box: BBox, ms = 900): Promise<void> {
    const effects = this.effects;
    if (!effects) return;
    const path = pointerPath({ x: box.x + box.w / 2, y: box.y + box.h / 2, box }, "tap");
    const ac = new AbortController();
    try {
      await this.progress(ms, ac.signal, (t) => effects.setPointer(t >= 1 ? null : path(t)));
    } finally {
      effects.setPointer(null);
    }
  }

  /** A widget's line in the caption band; null puts the narration's caption back. */
  caption(text: string | null): void {
    if (text === null) this.showCaption(this.captionSource);
    else this.setCaption(text);
  }

  /**
   * Paint the current boundary with a patched SPEC — the code editor's
   * preview: edited elements (a script and its fresh envelope) and, when the
   * script feeds tokens, the re-substituted params. Ids the patched layout
   * mints that the plan never drew (new code lines, a new output row) are
   * revealed. settleParams() is the way back, as for slider previews.
   */
  previewSpec(patch: { elements?: SpecElement[]; params?: Record<string, unknown>; hide?: ReadonlySet<string> }): void {
    if (!this.reprojector) return;
    const scene = this.stateAt(this.completed);
    // `hide` is the viewer's own subtraction — a switch on a drawn monitor
    // turning a half off. It goes through the SAME call as everything else,
    // because the reprojector rebuilds geometry without minting new element
    // handles: anything applied afterwards would be talking to stale nodes.
    const visible = new Set(scene.visible);
    for (const id of patch.hide ?? []) visible.delete(id);
    this.painted =
      this.reprojector.frame({ ...this.withVarOverrides(scene.params), ...(patch.params ?? {}) }, this.frameScene(scene, visible), {
        revealNew: true,
        elements: patch.elements,
        overrides: this.overridesOf(scene.offsets, scene.turns, scene.shapes, scene.tex, scene.copies),
      }) || null;
    this.geometryDirty = true;
  }

  /** The layout on screen right now: a preview's, or the plan's. */
  paintedLayout(): LayoutResult | null {
    return this.painted;
  }

  /** Move a rendered part by (dx, dy) on top of the pose it is drawn with — a
   *  widget's drag ghost; (0, 0) restores it. Through the EFFECTS, not the
   *  element handles: the handles hold the nodes this figure mounted with, and
   *  any preview since (a slider, the widget's own patch) has replaced them. */
  nudge(id: string, dx: number, dy: number): void {
    this.effects?.setOffset?.(id, dx, dy);
  }

  /**
   * Add-on hook (the identify drill, ui/quiz.ts): dim these ids to alpha, or
   * restore them with alpha 1. Rides on the focus verb's primitive and, like
   * it, survives no scrub — which is why the drill tears down on any step.
   */
  dimElements(ids: string[], alpha: number): void {
    if (!this.effects?.setFocus || ids.length === 0) return;
    if (alpha >= 1) this.effects.endFocus?.(ids);
    else this.effects.setFocus(ids, alpha);
  }

  dispose(): void {
    this.abortRun();
  }

  private abortRun(): void {
    this.pendingJump = null;
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

  /** Speak a runtime-chosen line (quiz/ask feedback): narrated mode voices it,
   *  other modes hold a capped reading beat; the caption always updates. */
  private async speakLine(source: string, step: Extract<PlanStep, { kind: "quiz" | "ask" }>, signal: AbortSignal): Promise<void> {
    // The caption may be a translation; what is SPOKEN never is.
    const text = this.spokenLine(source);
    this.showCaption(source);
    if (this.mode === "narrated") {
      await this.speech.speak(text, this.speedVal, signal, {
        speaker: step.narrationSpeaker,
        delivery: step.narrationDelivery,
        gender: this.narratorGender ?? undefined,
      });
    } else {
      await this.waitScaled(Math.min(1400, SpeechManager.estimateMs(text) * 0.4), signal);
    }
  }

  private setCaption(text: string): void {
    if (!this.captionEl) return;
    // `[de:ich]` is an instruction to the VOICE; the reader sees "ich". The
    // strip belongs here and not upstream because this is the one place every
    // caption passes through — narration, a widget's own line, a translated
    // track — so no path can forget it. (pronounce.ts draws the same line
    // from the other side: what is SAID is not what is written.)
    text = stripLangMarks(text);
    this.captionEl.textContent = text;
    this.captionEl.classList.toggle("cs-caption-empty", text === "");
    // Written on the drawing, a caption over something dark (a photo, a C64
    // screen) takes the band instead (figure-style.ts .cs-caption-dark).
    const scene = this.plan.states[Math.min(this.completed, this.plan.states.length - 1)];
    this.captionEl.classList.toggle("cs-caption-dark", text !== "" && !!this.captionOnDark && !!scene && this.captionOnDark(scene.visible));
  }

  private els(ids: string[]): RenderedElement[] {
    return ids.map((id) => this.elements.get(id)).filter((el): el is RenderedElement => el !== undefined);
  }

  private async runStep(index: number, signal: AbortSignal): Promise<void> {
    const step = this.plan.steps[index];
    if (step.kind === "explore" && (this.skipQuestions || this.autoAnswers || !this.exploreGate)) {
      // Nobody is there to play (a movie, questions off): stand in the way a
      // movie answers an ask — as a perfect viewer — so later {x} lines read
      // naturally: full marks for an activity, no melody for a composition.
      if (step.store) {
        const k = step.store.toLowerCase();
        if (step.activity !== undefined) {
          this.vars.set(k, String(ACTIVITY_QUESTIONS));
          this.vars.set(`${k}.total`, String(ACTIVITY_QUESTIONS));
        } else this.vars.set(k, "");
      }
      return;
    }
    if (this.skipQuestions && (step.kind === "quiz" || step.kind === "ask")) {
      // Preference: no question, no narration, no gate — but a collect-ask
      // still stores its default so later {var} lines keep working.
      if (step.kind === "ask" && step.store) this.vars.set(step.store.toLowerCase(), step.fallback ?? step.answer ?? "");
      if (step.kind === "quiz" && step.store) this.vars.set(step.store.toLowerCase(), step.choices[step.correct]);
      return;
    }
    if (step.kind !== "speak" && step.narration !== undefined) {
      // Narrated action: voice and action start together; both must finish.
      await this.narrationBarrier();
      if (signal.aborted) return;
      const narration = this.spokenLine(step.narration);
      this.showCaption(step.narration);
      const voice =
        this.mode === "narrated"
          ? this.speech.speak(narration, this.speedVal, signal, {
              speaker: step.narrationSpeaker,
              delivery: step.narrationDelivery,
              gender: this.narratorGender ?? undefined,
            })
          : this.waitScaled(Math.min(1400, SpeechManager.estimateMs(narration) * 0.4), signal);
      this.narrationVoice = voice;
      try {
        // An action written inside the sentence waits for its moment. The
        // estimate rather than a measured duration: it is the one number
        // available identically here, in a baked-audio cast and in the
        // export, and no speech marks have to be plumbed to get it.
        const cued = async (): Promise<void> => {
          const wait = cueStartMs(step.cue, step.cueEnd, narration, step.narrationDelivery, this.actionMs(index));
          if (wait > 0) await this.waitScaled(wait, signal);
          if (signal.aborted) return;
          return this.runAction(index, signal);
        };
        await Promise.all([cued(), voice]);
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
        const text = this.spokenLine(step.text);
        this.showCaption(step.text);
        if (this.mode === "narrated") {
          const spoken = this.speech.speak(text, this.speedVal, signal, {
            speaker: step.speaker,
            delivery: step.delivery,
            gender: this.narratorGender ?? undefined,
          });
          if (step.blocking) await spoken;
          else this.pendingSpeech = spoken;
        } else {
          // silent: hold the caption for a reading-time slice instead
          const hold = this.waitScaled(Math.min(1400, SpeechManager.estimateMs(text) * 0.4), signal);
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
        // A voice written as "{melody}" is what the viewer composed and a
        // `store` kept (design 2026-09-24-music §5.2): filled in now, and the
        // step lasts as long as what it turned out to be.
        const filled = step.voices.some((v) => v.notes.includes("{"));
        const voices = filled ? step.voices.map((v) => ({ ...v, notes: subVars(v.notes, this.vars) })).filter((v) => notationBeats(v.notes) > 0) : step.voices;
        const seconds = filled ? (Math.max(0, ...voices.map((v) => notationBeats(v.notes))) * 60) / step.tempo : step.seconds;
        if (this.mode === "narrated" && voices.length > 0) this.tones?.play(voices, step.tempo * this.speedVal, signal);
        if (step.press.length === 0 && step.reveal.length === 0) return this.waitScaled(seconds * 1000, signal);
        // reveal[k] appears at its note's start and stays; press[k] goes
        // down at its note's start and back up at its end — all driven off
        // the same progress clock as the wait, so audio and ink stay locked.
        let revealed = 0;
        let pressed = 0;
        let released = 0;
        await this.progress(step.seconds * 1000, signal, (t) => {
          while (revealed < step.reveal.length && step.revealAt[revealed] <= t) {
            this.elements.get(step.reveal[revealed])?.finish();
            revealed++;
          }
          while (pressed < step.press.length && step.pressAt[pressed] <= t) {
            this.elements.get(step.press[pressed])?.finish();
            pressed++;
          }
          while (released < pressed && step.pressOff[released] <= t) {
            this.elements.get(step.press[released])?.hide();
            released++;
          }
        });
        return;
      }
      case "run": {
        await this.narrationBarrier();
        if (signal.aborted) return;
        const rp = this.reprojector;
        const runner = this.sweepRunner;
        // No runtime and no reprojection surface (headless tests, the plan's
        // subtitle pass, a degraded backend): keep the pacing, change nothing.
        if (!runner || !rp) return this.waitScaled(step.seconds * 1000, signal);
        // Every map is run BEFORE the first frame (spec §4.2): a sweep that
        // stalls between values is not a sweep, it is a slideshow of spinners.
        // The idle precompute (render/index.ts) has usually filled the cache
        // by now, so this loop is a cache read per step.
        const results: CodePatch[] = [];
        for (const v of step.values) {
          try {
            results.push({ ...(await runner(step.code, v)), values: v });
          } catch (err) {
            // A step that failed HOLDS the previous result: the figure stops
            // moving rather than blanking out mid-sweep. The held entry is
            // reused WHOLE — its own values with its own script, or the tray
            // would open knobs that never produced the code on screen.
            console.warn(`[run ${step.code}] step failed: ${(err as Error).message}`);
            results.push(results[results.length - 1] ?? { code: "", result: "", values: v });
          }
          if (signal.aborted) return;
        }
        // Every figure decoded before the first frame, for the same reason
        // every VALUE was run before it: a repaint rebuilds the output pane's
        // <image> from scratch, and an undecoded PNG paints nothing — a white
        // flash per step. Cached by href, so a value seen before is free.
        // It must stay BEFORE runResults.set below: restoreRunPatches' sync
        // branch re-shows those results without decoding them itself.
        await Promise.all(results.map((r) => decodeFigures(r.result)));
        if (signal.aborted) return;
        const n = results.length;
        // Remembered from here on: a scrub that skips this step (forward, or
        // back and forward again) has to show what the run ended on, and
        // re-running the series to find that out would stall the scrub.
        this.runResults.set(index, results);
        this.activeRun = { index, id: step.code, results };
        const scene = this.plan.states[index];
        const overrides = this.overridesOf(scene.offsets, scene.turns, scene.shapes, scene.tex, scene.copies);
        let last = -1;
        await this.progress(step.seconds * 1000, signal, (t) => {
          const k = Math.min(n - 1, Math.floor(t * n));
          if (k === last) return;
          // Catch up rather than jump: a frame clock slower than the sweep
          // must not drop values silently (and a test must be able to name
          // every step the sweep went through).
          while (last < k) {
            last++;
            // code === "" is "nothing ever succeeded": leave the authored script alone.
            if (results[last].code !== "") this.pushCodePatch(step.code, results[last], index);
          }
          // revealNew: a fresh envelope mints rows the authored run never had.
          rp.frame(this.withVarOverrides(scene.params), this.frameScene(scene), { revealNew: true, elements: this.patchedElements(), overrides });
          // As in animate: frame() left the DOM at a live, handle-less state,
          // so the boundary below MUST commit even when nothing was patched
          // (a sweep whose every step failed still painted frames).
          this.geometryDirty = true;
        });
        if (signal.aborted) return; // a scrub's renderUpTo owns the state now
        this.activeRun = null; // the run finished: its history entry IS its last result
        this.applyKey(scene); // the boundary, with the last patch in it
        this.applyScene(scene);
        return;
      }
      case "label":
        return;
      case "explore": {
        await this.narrationBarrier();
        if (signal.aborted) return;
        if (this.exploreGate) {
          const kept = await this.exploreGate(signal, step);
          if (kept && !signal.aborted) for (const [k, v] of Object.entries(kept)) this.vars.set(k.toLowerCase(), v);
        }
        return;
      }
      case "if": {
        // Live viewers only: movies/skip fall straight through (linear path).
        if (this.autoAnswers || this.skipQuestions) return;
        const raw = this.vars.get(step.varName.toLowerCase());
        if (raw === undefined) return;
        const num = Number(raw.trim());
        let hit = false;
        switch (step.op) {
          case "gt": hit = Number.isFinite(num) && num > (step.value as number); break;
          case "lt": hit = Number.isFinite(num) && num < (step.value as number); break;
          case "gte": hit = Number.isFinite(num) && num >= (step.value as number); break;
          case "lte": hit = Number.isFinite(num) && num <= (step.value as number); break;
          case "eq": hit = answersMatch(raw, String(step.value)); break;
          case "ne": hit = !answersMatch(raw, String(step.value)); break;
        }
        if (hit && this.plan.labels[step.target] !== undefined) this.pendingJump = this.plan.labels[step.target];
        return;
      }
      case "wait":
        await this.narrationBarrier();
        if (signal.aborted) return;
        if (this.inputGate) return this.inputGate(signal);
        return this.waitScaled(800, signal);
      case "quiz": {
        await this.narrationBarrier();
        if (signal.aborted) return;
        // The gate shows immediately — the viewer may answer while the
        // question narration (started by runStep) is still speaking.
        let chosen: number | null;
        const liveQuiz = !this.autoAnswers && this.quizGate !== null;
        const t0 = performance.now();
        if (this.quizGate) {
          chosen = await this.quizGate(signal, step);
        } else {
          await this.waitScaled(1600, signal);
          chosen = null;
        }
        const quizSecs = liveQuiz ? (performance.now() - t0) / 1000 : null;
        if (signal.aborted) return;
        // Let the question finish before any feedback talks over it.
        if (this.narrationVoice) await this.narrationVoice;
        if (signal.aborted) return;
        // Auto paths (movies, gate-less players) answer correctly by
        // definition; a live viewer's Skip counts as wrong — a test is a test.
        const quizOk = this.autoAnswers || this.quizGate === null ? true : chosen === step.correct;
        this.outcomes.set(index, quizOk);
        this.updateScoreVars();
        // Store BEFORE feedback so the feedback lines may use {store} too; a
        // skip or an auto answer keeps the correct option (the ask's default).
        this.recordAnswer(index, step.store, step.choices[chosen ?? step.correct], quizOk, quizSecs);
        if (!this.autoAnswers && this.quizGate !== null) {
          this.callbacks.onAnswer?.({
            index,
            kind: "quiz",
            id: this.answerId(index, step.store),
            question: step.question,
            given: chosen === null ? [] : [step.choices[chosen]],
            expected: step.choices[step.correct],
            correct: chosen === step.correct,
            ...(quizSecs !== null ? { secs: quizSecs } : {}),
          });
        }
        const reveal = step.right ?? step.choices[step.correct];
        // The feedback runs on its own signal, so the viewer can skip it
        // without skipping what comes after.
        const ctl = new AbortController();
        this.feedbackCtl = ctl;
        const fb = anySignal(signal, ctl.signal);
        const lines: string[] = [];
        if (chosen === step.correct) {
          if (step.right) lines.push(step.right);
        } else if (chosen !== null) {
          // `wrong` is a hint BEFORE the reveal; one that just repeats the
          // reveal would say the same sentence twice (Hans 2026-09-25).
          if (step.wrong && step.wrong.trim() !== reveal.trim()) lines.push(step.wrong);
          lines.push(reveal);
        } else if (!liveQuiz) {
          // A movie or a gate-less player reveals the answer; a live viewer
          // who pressed Skip skipped the question AND its explanation.
          lines.push(reveal);
        }
        if (lines.length > 0) {
          if (liveQuiz) this.feedbackHook?.(true);
          try {
            for (const line of lines) {
              if (fb.aborted) break;
              await this.speakLine(line, step, fb);
            }
          } finally {
            if (this.feedbackCtl === ctl) this.feedbackCtl = null;
            if (liveQuiz) this.feedbackHook?.(false);
          }
        }
        if (signal.aborted) return;
        if (!this.autoAnswers && this.quizGate !== null && chosen !== null) {
          const target = chosen === step.correct ? step.rightGoto : step.wrongGoto;
          if (target !== undefined && this.plan.labels[target] !== undefined) this.pendingJump = this.plan.labels[target];
        }
        return;
      }
      case "ask": {
        await this.narrationBarrier();
        if (signal.aborted) return;
        // The auto path (movie/bare player) "types" the answer in check mode,
        // the default in collect mode — one uniform string contract.
        const auto = step.answer ?? step.fallback ?? "";
        let typed: string | null;
        const attempts: string[] = [];
        // Seconds from the card opening to the answer, latest attempt wins;
        // null when no viewer sat at a gate (movies, bare players).
        const timing: { secs: number | null } = { secs: null };
        const timedGate = async (): Promise<string | null> => {
          const from = performance.now();
          const t = await this.askGate!(signal, step);
          if (!this.autoAnswers) timing.secs = (performance.now() - from) / 1000;
          return t;
        };
        if (step.widget !== undefined && (this.autoAnswers || !this.askGate)) {
          // Widget asks demonstrate with the laser instead of the typing card:
          // the pointer taps the answer element (SVG — it exports), then the
          // auto answer stands. A piano answer also SOUNDS (tones route into
          // the export's recording).
          if ((step.widget === "piano" || step.widget === "staff") && step.answer !== undefined && this.tones) {
            try {
              this.tones.play([{ notes: `${step.answer}:q` }], 160, signal);
            } catch {
              /* an unparseable note stays silent */
            }
          }
          if (step.widgetTemplate && this.widgetDemo) {
            await this.widgetDemo(signal, step);
            if (signal.aborted) return;
          } else {
            // A drag question has one box per item: the laser taps each in turn.
            const boxes = step.answerBoxes ?? (step.answerBox ? [step.answerBox] : []);
            if (this.effects && boxes.length > 0) {
              const effects = this.effects;
              for (const b of boxes) {
                const path = pointerPath({ x: b.x + b.w / 2, y: b.y + b.h / 2, box: b }, "tap");
                try {
                  await this.progress(boxes.length > 1 ? 900 : 1400, signal, (t) => effects.setPointer(t >= 1 ? null : path(t)));
                } finally {
                  effects.setPointer(null);
                }
                if (signal.aborted) return;
              }
            } else {
              await this.waitScaled(1200, signal);
            }
          }
          typed = auto;
        } else if (this.askGate) {
          typed = await timedGate();
          if (typed !== null) attempts.push(typed);
        } else {
          await this.waitScaled(1600, signal);
          typed = auto;
        }
        if (signal.aborted) return;
        // Let the question finish before any feedback talks over it.
        if (this.narrationVoice) await this.narrationVoice;
        if (signal.aborted) return;
        // Store BEFORE feedback so the feedback lines may use {store} too.
        // Collect mode has nothing to judge, so no .ok field.
        this.recordAnswer(index, step.store, typed ?? step.fallback ?? step.answer ?? "", null, timing.secs);
        if (step.answer === undefined) return; // collect mode: nothing to judge
        const answer = step.answer;
        const isRight = (t: string | null): boolean => t !== null && answersMatch(t, answer);
        while (typed !== null && !isRight(typed)) {
          if (step.wrong) await this.speakLine(step.wrong, step, signal);
          if (signal.aborted) return;
          if (!step.retry || !this.askGate) break;
          typed = await timedGate();
          if (typed !== null) attempts.push(typed);
          if (signal.aborted) return;
          if (typed !== null) this.recordAnswer(index, step.store, typed, null, timing.secs);
        }
        this.recordAnswer(index, step.store, typed ?? step.fallback ?? step.answer ?? "", isRight(typed), timing.secs);
        this.outcomes.set(index, isRight(typed));
        this.updateScoreVars();
        if (!this.autoAnswers && this.askGate !== null) {
          this.callbacks.onAnswer?.({
            index,
            kind: "ask",
            id: this.answerId(index, step.store),
            question: step.question,
            given: attempts,
            expected: answer,
            correct: isRight(typed),
            ...(timing.secs !== null ? { secs: timing.secs } : {}),
          });
        }
        // A click question shows WHERE the answer was: the element glows
        // while the answer line is spoken — green when the viewer found it,
        // the highlight colour when it is revealed after a miss or a skip.
        // Live viewers only: the movie's laser has already tapped it.
        const live = !this.autoAnswers && this.askGate !== null;
        let groups: { ids: string[]; color?: string }[] = [];
        if (step.widget === "drag" && step.items) {
          // The truth appears: every element item is shown (the plan's state
          // agrees); live, the hits glow green and the misses the highlight colour.
          const elementIds = step.items.filter((i) => i.element).map((i) => i.id);
          for (const el of this.els(elementIds)) el.finish();
          if (live) {
            const placed = new Set(
              (typed ?? "")
                .split(",")
                .map((s) => s.trim().toLowerCase())
                .filter((s) => s !== ""),
            );
            groups = [
              { ids: elementIds.filter((id) => placed.has(id.toLowerCase())), color: ANSWER_OK_COLOR },
              { ids: elementIds.filter((id) => !placed.has(id.toLowerCase())) },
            ];
          }
        } else if (step.widget === "click" && step.answerBox && live) {
          groups = [{ ids: [answer], ...(isRight(typed) ? { color: ANSWER_OK_COLOR } : {}) }];
        }
        if (isRight(typed)) {
          await this.glowWhile(groups, signal, async () => {
            if (step.right) await this.speakLine(step.right, step, signal);
          });
        } else if (step.reveal) {
          await this.glowWhile(groups, signal, () => this.speakLine(step.right ?? answer, step, signal));
        }
        if (!this.autoAnswers && this.askGate !== null && typed !== null) {
          const target = isRight(typed) ? step.rightGoto : step.wrongGoto;
          if (target !== undefined && this.plan.labels[target] !== undefined) this.pendingJump = this.plan.labels[target];
        }
        return;
      }
      case "draw": {
        await this.narrationBarrier();
        if (signal.aborted) return;
        // A windowed code pane scrolls first, so the new line lands at the
        // bottom row before its ink appears.
        await this.tweenScroll(index, signal);
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
        await this.tweenScroll(index, signal);
        for (const el of this.els(step.ids)) el.finish();
        return;
      case "hide":
        if (this.heldPast(index)) return;
        for (const el of this.els(step.ids)) el.hide();
        await this.tweenScroll(index, signal);
        return;
      case "erase": {
        await this.narrationBarrier();
        if (signal.aborted || this.heldPast(index)) return;
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
        // The pane settles back only once the erased line is gone.
        await this.tweenScroll(index, signal);
        return;
      }
      case "clear": {
        await this.narrationBarrier();
        if (signal.aborted || this.heldPast(index)) return;
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
        const paint = (level: number, elapsedMs?: number) => effects.setHighlight(step.ids, step.effect, level, box, step.color, elapsedMs, step.part);
        // pulse throbs three times before the hold; everything else eases in once.
        const curve = step.effect === "pulse" ? "throb" : "ease";
        try {
          if (step.untilNarrationEnd && this.narrationVoice) {
            // Emphasis-while-speaking: in, then held at full for the rest of
            // the sentence, released the moment the voice stops.
            await this.emphasize(signal, paint, this.narrationVoice, 1, curve);
          } else {
            // An explicit duration is the whole effect, release included: the
            // throbs compress to fit when there is less room than they want.
            const swellMs = Math.max(1, step.seconds * 1000 - EMPHASIS_RELEASE_MS);
            const rate = curve === "throb" ? Math.max(1, EMPHASIS_HOLD_AT_MS / swellMs) : 1;
            await this.emphasize(signal, paint, this.waitScaled(swellMs, signal), rate, curve);
          }
        } finally {
          effects.endHighlight(step.ids);
        }
        return;
      }
      case "focus": {
        const effects = this.effects;
        if (!effects?.setFocus) return;
        // The inverse spotlight: dim everything visible EXCEPT the targets.
        const keep = new Set(step.ids);
        const dimIds = before.visible.filter((id) => !keep.has(id));
        if (dimIds.length === 0) return;
        const DIM = 0.16;
        const RAMP = 280;
        const alphaAt = (t: number) => 1 - (1 - DIM) * t;
        try {
          await this.progress(RAMP, signal, (t) => effects.setFocus!(dimIds, alphaAt(t)));
          if (signal.aborted) return;
          if (step.untilNarrationEnd && this.narrationVoice) {
            await this.narrationVoice;
          } else {
            await this.waitScaled(Math.max(0, step.seconds * 1000 - 2 * RAMP), signal);
          }
          if (signal.aborted) return;
          await this.progress(RAMP, signal, (t) => effects.setFocus!(dimIds, alphaAt(1 - t)));
        } finally {
          effects.endFocus?.(dimIds);
        }
        return;
      }
      case "flow": {
        const effects = this.effects;
        if (!effects?.setFlow) return;
        const o = { spacing: step.spacing, marks: step.marks, color: step.color, reverse: step.reverse };
        const paint = (elapsedMs: number, alpha: number) => effects.setFlow!(step.ids, o, { travelled: (elapsedMs / 1000) * step.speed, alpha });
        try {
          if (step.untilNarrationEnd && this.narrationVoice) {
            let speaking = true;
            void this.narrationVoice.finally(() => (speaking = false));
            let base = 0;
            const CYCLE = 1000;
            while (speaking && !signal.aborted) {
              await this.progress(CYCLE, signal, (t) => paint(base + t * CYCLE, Math.min(1, (base + t * CYCLE) / 300)));
              base += CYCLE;
            }
            if (!signal.aborted) await this.progress(300, signal, (t) => paint(base + t * 300, 1 - t));
          } else {
            const ms = step.seconds * 1000;
            await this.progress(ms, signal, (t) => paint(t * ms, Math.min(1, t / 0.1, (1 - t) / 0.1)));
          }
        } finally {
          effects.endFlow?.(step.ids);
        }
        return;
      }
      case "point": {
        if (!this.effects) return;
        const effects = this.effects;
        // The planner aimed at the element's CURRENT box (its pose applied),
        // so nothing is added here — adding the offset again sent the laser
        // twice as far for a moved element.
        const path = pointerPath({ x: step.x, y: step.y, box: step.box }, step.gesture);
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
        if (!rp) {
          // No reprojection surface (headless tests, degraded backends): keep the pacing.
          return this.waitScaled(step.seconds * 1000, signal);
        }
        // "{var}" targets: swap in the viewer's stored number (the plan-time
        // value is the ask's default — the movie's path); record the override
        // so later commits and scrubs keep the personalization.
        const targets = { ...step.targets };
        if (step.varTargets) {
          for (const [key, varName] of Object.entries(step.varTargets)) {
            const raw = this.vars.get(varName);
            if (raw === undefined || raw.trim() === "") continue;
            const n = Number(raw.trim());
            if (!Number.isFinite(n)) continue;
            targets[key] = n;
            this.varParamOverrides[key] = n;
          }
        }
        // A trail minted by this step is visible from its first frame (the
        // plan makes it visible in the AFTER state); cut to the sweep's progress.
        const visible = new Set([...before.visible, ...(step.trails ?? []).map((tr) => tr.id)]);
        const overrides = this.overridesOf(before.offsets, before.turns, before.shapes, before.tex, before.copies);
        // Absent easing keeps the historical smoothstep exactly (the SAME
        // definition a sweep glides by — render/sweep.ts owns it, so the two
        // cannot drift); a long race asks for `linear` so the middle years do
        // not blur past while the ends crawl.
        const ease = step.easing ? EASINGS[step.easing] : smoothstep;
        await this.progress(step.seconds * 1000, signal, (t) => {
          const e = ease(t);
          const cur: Record<string, number> = { ...this.withVarOverrides(before.params) };
          for (const key of Object.keys(targets)) {
            const start = step.starts[key];
            cur[key] = start === null ? targets[key] : start + (targets[key] - start) * e;
          }
          // reveal ids the tween mints (a 40th slice): they join the implicit final draw
          rp.frame(cur, this.frameScene(before, visible), { revealNew: true, overrides, trailProgress: Player.trailProgressAt(step.trails, e) });
          this.geometryDirty = true;
        });
        if (signal.aborted) return; // a scrub's renderUpTo owns the state now
        this.applyKey(this.plan.states[index]);
        this.applyScene(this.plan.states[index]);
        return;
      }
      case "move": {
        if (step.relayout && this.reprojector) return this.relayoutTween(index, step, before, signal, (e) => ({ offsets: moveFrame(step, before, e) }));
        const els = this.els(step.ids).filter((el) => el.setOffset);
        const ease = EASINGS[step.easing];
        await this.progress(step.seconds * 1000, signal, (t) => {
          const e = ease(t);
          const offsets = moveFrame(step, before, e);
          for (const el of els) {
            const [x, y] = offsets[el.id];
            // A plain move never changes an element's turn — carry the
            // existing pose through setTransform so an earlier rotate isn't
            // dropped by setOffset's transform-attribute rewrite.
            const turn = before.turns[el.id];
            if (turn && el.setTransform) el.setTransform(x, y, turn.deg, turn.pivot, turn.scale ?? 1, turn.mirror ?? false);
            else el.setOffset!(x, y);
          }
          for (const tr of step.trails ?? []) this.elements.get(tr.id)?.setProgress(lengthFractionAt(tr.lengthAt, e));
          this.tweenMorphItems(step.extraMorphs, e, before);
          this.tweenTransformItems(step.extraTransforms, e);
        });
        if (signal.aborted) return; // a scrub's renderUpTo owns the state now
        this.settleMeasures(step, this.plan.states[index]);
        return;
      }
      case "transform": {
        if (step.relayout && this.reprojector) {
          // A flip with dependents runs on its two half-poses; the turn-over
          // squash is a handle-only prefix and is dropped for that step (design §2.5).
          return this.relayoutTween(index, step, before, signal, (e) => {
            const f = transformFrame(step.items, e);
            return { offsets: f.offsets, turns: f.turns };
          });
        }
        const ease = EASINGS[step.easing];
        const items = step.items.map((it) => ({ it, el: this.elements.get(it.id) })).filter((x) => x.el?.setTransform || x.el?.setOffset);
        await this.progress(step.seconds * 1000, signal, (t) => {
          const e = ease(t);
          const f = transformFrame(step.items, e);
          for (const { it, el } of items) {
            const [dx, dy] = f.offsets[it.id];
            const turn = f.turns[it.id];
            if (el!.setTransform) el!.setTransform(dx, dy, turn.deg, turn.pivot, turn.scale ?? 1, turn.mirror ?? false, f.squash[it.id]);
            else el!.setOffset!(dx, dy);
          }
          for (const tr of step.trails ?? []) this.elements.get(tr.id)?.setProgress(lengthFractionAt(tr.lengthAt, e));
          this.tweenMorphItems(step.extraMorphs, e, before);
          this.tweenTransformItems(step.extraTransforms, e);
        });
        if (signal.aborted) return; // a scrub's renderUpTo owns the state now
        this.settleMeasures(step, this.plan.states[index]);
        return;
      }
      case "fade": {
        const ease = EASINGS[step.easing];
        const items = step.items.map((it) => ({ it, el: this.elements.get(it.id) })).filter((x) => x.el?.setOpacity);
        await this.progress(step.seconds * 1000, signal, (t) => {
          const e = ease(t);
          for (const { it, el } of items) el!.setOpacity!(it.from + (it.to - it.from) * e);
        });
        return;
      }
      case "morph": {
        if ((step.relayout || (step.texItems && step.texItems.length > 0)) && this.reprojector)
          return this.relayoutTween(index, step, before, signal, (e) => ({
            shapes: morphFrame(step.items, before, e),
            math: Object.fromEntries((step.texItems ?? []).map((it) => [it.id, { tex: it.to, from: it.from, t: e }])),
          }));
        // A tex-only morph (texItems, no shape items) has nothing to tween
        // through a handle: without a reprojector, just keep the pacing
        // (mirrors the animate case's no-reprojector branch).
        if (step.items.length === 0) return this.waitScaled(step.seconds * 1000, signal);
        const ease = EASINGS[step.easing];
        const items = step.items.map((it) => ({ it, el: this.elements.get(it.id) })).filter((x) => x.el?.setPoints);
        await this.progress(step.seconds * 1000, signal, (t) => {
          const e = ease(t);
          const shapes = morphFrame(step.items, before, e);
          for (const { it, el } of items) el!.setPoints!(shapes[it.id]);
          this.tweenMorphItems(step.extraMorphs, e, before);
          this.tweenTransformItems(step.extraTransforms, e);
        });
        if (signal.aborted) return; // a scrub's renderUpTo owns the state now
        // Settle on the boundary's own points — the last tween frame is
        // morphPair's K-point resample, not the layout's own vertex count, so
        // a `reset` (whose boundary carries no shapes entry at all) must be
        // re-applied here or the element keeps its resampled path until the
        // next applyScene (a scrub).
        const after = this.plan.states[index];
        for (const { it, el } of items) el!.setPoints!(after.shapes[it.id] ?? {});
        this.settleMeasures(step, after);
        return;
      }
      case "copy": {
        // The clone is a fresh element the layout mints from `copies` in the
        // overrides (design 2026-09-10 §2.5) — nothing to tween, so the step
        // just commits the boundary key (which now carries the copy) and
        // shows the id. With no reprojector the id has no handle: applyKey
        // is a no-op and applyScene finds nothing to show for it — fine.
        await this.narrationBarrier();
        if (signal.aborted) return;
        const after = this.plan.states[index];
        this.applyKey(after);
        this.applyScene(after);
        return;
      }
      case "camera": {
        if (!this.effects) return;
        const effects = this.effects;
        const from = before.camera ?? FULL_VIEW_BOX;
        const to = step.box ?? FULL_VIEW_BOX;
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
  /**
   * What a step's animation costs, in milliseconds — what an end-anchored cue
   * has to start early by. A draw is its elements' own paced durations; every
   * other animating kind carries its `seconds`. Anything instant (a show, a
   * hide) costs nothing, which makes an end cue on it the same as a start
   * cue, exactly as it should be.
   */
  private actionMs(index: number): number {
    const step = this.plan.steps[index];
    if (step.kind === "draw" || step.kind === "erase") {
      const ms = this.paced(this.els(step.ids), step, 1);
      if (ms.length === 0) return 0;
      return step.parallel ? Math.max(...ms) : ms.reduce((a, b) => a + b, 0);
    }
    return "seconds" in step && typeof step.seconds === "number" ? step.seconds * 1000 : 0;
  }

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
   * A measure's dimension line rides its figure (design §2.3): the same
   * per-leaf lerp the morph case runs for its own items, merged over the
   * boundary's existing points so leaves this step does not touch stay put.
   */
  private static trailProgressAt(trails: TrailProgress[] | undefined, e: number): Record<string, number> {
    return Object.fromEntries((trails ?? []).map((tr) => [tr.id, lengthFractionAt(tr.lengthAt, e)]));
  }

  /**
   * A step whose targets something is DEFINED by (design 2026-09-10 §2.5):
   * every frame is a re-layout at the interpolated poses and shapes, handed
   * to the reprojector — the moved element from its original-frame layout
   * under its interpolated transform (the same look as the handle path), the
   * dependents from their recomputed geometry. The handles are bypassed and
   * the boundary is committed at the end, as after an animate.
   */
  private async relayoutTween(
    index: number,
    step: { seconds: number; easing: Easing; trails?: TrailProgress[] } & MeasureFollow,
    before: SceneState,
    signal: AbortSignal,
    frameAt: (e: number) => {
      offsets?: Record<string, Pt>;
      turns?: Record<string, Turn>;
      shapes?: Record<string, Record<string, Pt[]>>;
      math?: Record<string, { tex: string; from?: string; t?: number }>;
    },
  ): Promise<void> {
    const rp = this.reprojector!;
    const ease = EASINGS[step.easing];
    const params = this.withVarOverrides(before.params);
    const visible = new Set([...before.visible, ...(step.trails ?? []).map((t) => t.id)]);
    await this.progress(step.seconds * 1000, signal, (t) => {
      const e = ease(t);
      const f = frameAt(e);
      // The step's measure extras ride along exactly as on the handle path
      // (a measure of a co-moved element that is not a source has nothing
      // else to move it — review finding 7): its dimension line as a shape,
      // its label's slide as a pose; the value is written at the boundary.
      const extra = transformFrame(step.extraTransforms ?? [], e);
      const offsets = { ...before.offsets, ...(f.offsets ?? {}), ...extra.offsets };
      const turns = { ...before.turns, ...(f.turns ?? {}), ...extra.turns };
      const shapes: Record<string, Record<string, Pt[]>> = { ...before.shapes, ...morphFrame(step.extraMorphs ?? [], before, e), ...(f.shapes ?? {}) };
      rp.frame(
        params,
        { visible, offsets, turns, opacities: before.opacities, shapes, texts: before.texts },
        { overrides: this.overridesOf(offsets, turns, shapes, before.tex, before.copies, f.math), trailProgress: Player.trailProgressAt(step.trails, e) },
      );
      this.geometryDirty = true;
    });
    if (signal.aborted) return; // a scrub's renderUpTo owns the state now
    const after = this.plan.states[index];
    this.applyKey(after);
    this.applyScene(after);
  }

  private tweenMorphItems(items: MorphItem[] | undefined, e: number, before: SceneState): void {
    for (const it of items ?? []) {
      const el = this.elements.get(it.id);
      if (!el?.setPoints) continue;
      const pts: Record<string, Pt[]> = { ...(before.shapes[it.id] ?? {}) };
      for (const leaf of it.leaves) pts[leaf.leafId] = leaf.from.map((p, i): Pt => [p[0] + (leaf.to[i][0] - p[0]) * e, p[1] + (leaf.to[i][1] - p[1]) * e]);
      el.setPoints(pts);
    }
  }

  /** A measure's label slides to the new spot alongside the step it belongs to — the transform case's own pose lerp, on ids the step does not otherwise touch. */
  private tweenTransformItems(items: TransformItem[] | undefined, e: number): void {
    for (const it of items ?? []) {
      const el = this.elements.get(it.id);
      if (!el) continue;
      const dx = it.from.offset[0] + (it.to.offset[0] - it.from.offset[0]) * e;
      const dy = it.from.offset[1] + (it.to.offset[1] - it.from.offset[1]) * e;
      const deg = it.from.turn.deg + (it.to.turn.deg - it.from.turn.deg) * e;
      const sc = (it.from.turn.scale ?? 1) + ((it.to.turn.scale ?? 1) - (it.from.turn.scale ?? 1)) * e;
      if (el.setTransform) el.setTransform(dx, dy, deg, it.to.turn.pivot, sc, it.to.turn.mirror ?? false);
      else el.setOffset?.(dx, dy);
    }
  }

  /**
   * Land the step's measure extras on the boundary the plan recorded: the
   * dimension lines on their exact points (the tween's last frame is a fresh
   * array, and a later scrub reads these), and the labels on their recomputed
   * strings. The VALUE never tweens — a measure reads what the figure is once
   * it has arrived, so it is written in one go at the end.
   */
  private settleMeasures(step: MeasureFollow, after: SceneState): void {
    for (const it of step.extraMorphs ?? []) this.elements.get(it.id)?.setPoints?.(after.shapes[it.id] ?? {});
    for (const t of step.texts ?? []) this.elements.get(t.id)?.setText?.({ ...(after.texts[t.id] ?? {}) });
  }

  /**
   * Drive onTick(t) with t ∈ [0,1] over a duration, honoring pause and the
   * live speed multiplier. Always ends with onTick(1) unless aborted.
   */
  /**
   * Offsets that differ between a step's before and after states without a
   * move verb are a code window's scroll (the plan writes them after every
   * visibility change): slide them over SCROLL_MS so the pane reads as an
   * editor scrolling, not a jump. renderUpTo applies the after-state's
   * offsets outright, so scrub and step-back need nothing here.
   */
  private async tweenScroll(index: number, signal: AbortSignal): Promise<void> {
    const before = this.stateAt(index);
    const after = this.plan.states[index];
    const ids = new Set([...Object.keys(before.offsets), ...Object.keys(after.offsets)]);
    const moves: { el: RenderedElement; from: Pt; to: Pt }[] = [];
    for (const id of ids) {
      const a = before.offsets[id] ?? [0, 0];
      const b = after.offsets[id] ?? [0, 0];
      if (a[0] === b[0] && a[1] === b[1]) continue;
      const el = this.elements.get(id);
      if (el?.setOffset) moves.push({ el, from: a, to: b });
    }
    if (moves.length === 0) return;
    const ease = EASINGS["ease-in-out"];
    await this.progress(SCROLL_MS, signal, (t) => {
      const e = ease(t);
      for (const m of moves) m.el.setOffset!(m.from[0] + (m.to[0] - m.from[0]) * e, m.from[1] + (m.to[1] - m.from[1]) * e);
    });
  }

  /**
   * Runs `work` (a spoken line, typically) while the groups glow — each its
   * own ids in its own colour, all in one loop of full swells of
   * ANSWER_GLOW_MS until the work is done; at least one whole swell, so a
   * silent player still shows the elements. No effects or nothing to glow:
   * just the work. The glow is always cleared, even on abort.
   */
  private async glowWhile(groups: { ids: string[]; color?: string }[], signal: AbortSignal, work: () => Promise<void>): Promise<void> {
    const effects = this.effects;
    const live = groups.filter((g) => g.ids.length > 0);
    if (!effects || live.length === 0) {
      await work();
      return;
    }
    const done = work();
    try {
      await this.emphasize(
        signal,
        (level, elapsedMs) => {
          for (const g of live) effects.setHighlight(g.ids, "glow", level, null, g.color, elapsedMs);
        },
        done,
        1,
        "ease",
      );
    } finally {
      for (const g of live) effects.endHighlight(g.ids);
    }
    await done;
  }

  /**
   * An open-ended rAF loop: `onFrame(elapsedMs)` every frame until it returns
   * false (or the signal aborts). progress()'s sibling for work whose length
   * is not known in advance — a sentence's, say. Honours pause and speed the
   * same way.
   */
  private frames(signal: AbortSignal, onFrame: (elapsedMs: number) => boolean): Promise<void> {
    return new Promise((resolve) => {
      let t = 0;
      let last = performance.now();
      const tick = (now: number) => {
        if (signal.aborted) return resolve();
        if (!this.pausedFlag) t += (now - last) * this.speedVal;
        last = now;
        if (!onFrame(t)) return resolve();
        this.raf(tick);
      };
      this.raf(tick);
    });
  }

  /**
   * The emphasis envelope: three throbs, then a HOLD at full for as long as
   * `until` takes, then a release from wherever the level had got to.
   *
   * The hold is the point. Repeating a swell instead — which is what this used
   * to do — left the element at full for an instant at a time and never simply
   * ON, and since a repeat could only stop at a cycle boundary it went on
   * breathing past the end of the voice. Here the level is sampled per frame,
   * so the release starts on the word. `rate` > 1 compresses the throbs to fit
   * an explicit duration; the floor at the first peak keeps even an instant
   * emphasis visible.
   */
  private async emphasize(
    signal: AbortSignal,
    paint: (level: number, elapsedMs?: number) => void,
    until: Promise<unknown>,
    rate = 1,
    curve: "throb" | "ease" = "throb",
  ): Promise<void> {
    let running = true;
    void until.then(
      () => (running = false),
      () => (running = false),
    );
    let level = 0;
    await this.frames(signal, (elapsed) => {
      const at = elapsed * rate;
      level = curve === "throb" ? emphasisLevel(at) : easeInLevel(at);
      paint(level, elapsed);
      return running || at < (curve === "throb" ? EMPHASIS_FIRST_PEAK_MS : EMPHASIS_EASE_MS);
    });
    if (signal.aborted) return;
    // No elapsed time in the release: a band or marker stays as written and only fades.
    await this.progress(EMPHASIS_RELEASE_MS, signal, (t) => paint(releaseLevel(level, t)));
  }

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
  /**
   * Out-of-plan camera push into an element's box — the playlist's live
   * semantic-zoom exit (the export path plays the same move as a camera
   * command in exportSequence). Abortable like fadeOutAll.
   */
  async zoomInto(box: BBox, opts: { zoom?: number; ms?: number } = {}): Promise<void> {
    const effects = this.effects;
    if (!effects) return;
    this.abortRun();
    const ac = new AbortController();
    this.ac = ac;
    const zoom = Math.min(8, Math.max(1.2, opts.zoom ?? 4.5));
    const w = FULL_CANVAS_BOX.w / zoom;
    const h = FULL_CANVAS_BOX.h / zoom;
    const cx = box.x + box.w / 2;
    const cy = box.y + box.h / 2;
    const to: BBox = {
      x: Math.min(Math.max(cx - w / 2, 0), FULL_CANVAS_BOX.w - w),
      y: Math.min(Math.max(cy - h / 2, 0), FULL_CANVAS_BOX.h - h),
      w,
      h,
    };
    const from = this.stateAt(this.completed).camera ?? FULL_VIEW_BOX;
    const ease = EASINGS["ease-in-out"];
    await this.progress(opts.ms ?? 1600, ac.signal, (t) => effects.setCamera(lerpBox(from, to, ease(t))));
  }

  async fadeOutAll(ms = CLEAR_MS): Promise<void> {
    this.abortRun();
    const ac = new AbortController();
    this.ac = ac;
    const els = this.els([...this.stateAt(this.completed).visible]);
    await Promise.all(els.map((el) => this.animateRange(el, 1, 0, ms, ac.signal)));
  }
}

/** A signal that aborts when either does (AbortSignal.any, where the runtime has it). */
function anySignal(a: AbortSignal, b: AbortSignal): AbortSignal {
  const any = (AbortSignal as unknown as { any?: (s: AbortSignal[]) => AbortSignal }).any;
  if (any) return any([a, b]);
  const c = new AbortController();
  const stop = () => c.abort();
  if (a.aborted || b.aborted) c.abort();
  a.addEventListener("abort", stop, { once: true });
  b.addEventListener("abort", stop, { once: true });
  return c.signal;
}
