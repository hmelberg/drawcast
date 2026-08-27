// YouTube-style player controls: poster (finished drawing), big play button,
// seekable per-command progress bar, mute, mode/speed selects, theater and
// fullscreen toggles. Shared between the player mode, the editor preview, and
// the standalone #gdoc viewer.

import type { RenderHandle } from "../render";
import type { SpeechManager } from "../render/speech";
import { h } from "./dom";

export interface PlaybackPrefs {
  mode: "narrated" | "silent" | "instant";
  speed: number;
  muted?: boolean;
  onMode?(mode: "narrated" | "silent" | "instant"): void;
  onSpeed?(speed: number): void;
  onMute?(muted: boolean): void;
}

export interface ControlsOptions {
  /** Focus mode hook: the host fades its chrome while playing. */
  onPlayingChange?(playing: boolean): void;
  /** Enables the mute button (mute keeps narration timing, volume 0). */
  speech?: SpeechManager;
  /** Enables the fullscreen button; this element goes fullscreen. */
  fullscreenEl?: HTMLElement;
  /** Enables the theater (wide) toggle. */
  onTheater?(): void;
  /** Extra buttons appended at the right end (e.g. the editor/player switch). */
  trailing?: HTMLElement[];
}

/**
 * The wait verb's gate: a full-stage overlay so ANY click continues (and never
 * reaches the stage's play/pause toggle underneath). Resolves on signal abort
 * so scrubbing and disposal are never blocked.
 */
export function clickGate(stage: HTMLElement, label = "Click to continue ▸"): (signal: AbortSignal) => Promise<void> {
  return (signal) =>
    new Promise<void>((resolve) => {
      const gate = h("div", { class: "cs-waitgate", title: "Continue" }, h("span", { class: "cs-waitgate-pill" }, label));
      const done = () => {
        gate.remove();
        signal.removeEventListener("abort", done);
        resolve();
      };
      gate.addEventListener("click", (e) => {
        e.stopPropagation();
        done();
      });
      signal.addEventListener("abort", done);
      stage.appendChild(gate);
    });
}

/** The slice of the ask plan step the gate needs (structurally matches
 *  Player.askGate's parameter — controls stays decoupled from plan types). */
interface AskGateStep {
  question: string;
  choices: string[];
  correct: number;
  required: boolean;
}

/** How long the answered card (with its right/wrong colors) stays on screen
 *  while the feedback line speaks. A scrub or the next question clears it. */
const ASK_LINGER_MS = 2600;

/**
 * The ask verb's gate: a centered card — question on top, one choice row per
 * option, Skip when the ask is not required. A pick colors the chosen and
 * correct rows and resolves the 0-based index IMMEDIATELY (so the feedback
 * line speaks while the colors are still showing); the card lingers a beat,
 * then removes itself. Skip and abort resolve null. Resolves on signal abort
 * so scrubbing and disposal are never blocked.
 */
export function askGateFor(stage: HTMLElement): (signal: AbortSignal, step: AskGateStep) => Promise<number | null> {
  return (signal, step) =>
    new Promise<number | null>((resolve) => {
      // A lingering previous question makes way for this one.
      stage.querySelector(".cs-askgate")?.remove();
      const choicesBox = h("div", { class: "cs-askgate-choices" });
      const card = h("div", { class: "cs-askgate-card" }, h("div", { class: "cs-askgate-q" }, step.question), choicesBox);
      const gate = h("div", { class: "cs-askgate" }, card);
      let settled = false;
      const remove = (): void => {
        signal.removeEventListener("abort", onAbort);
        gate.remove();
      };
      const onAbort = (): void => {
        remove();
        if (!settled) {
          settled = true;
          resolve(null);
        }
      };
      const pills: HTMLButtonElement[] = step.choices.map((choice, i) => {
        const pill = h("button", { class: "cs-askgate-pill" }, `${i + 1} · ${choice}`) as HTMLButtonElement;
        pill.addEventListener("click", (e) => {
          e.stopPropagation();
          if (settled) return;
          settled = true;
          pill.classList.add(i === step.correct ? "right" : "wrong");
          pills[step.correct].classList.add("right");
          for (const p of pills) p.disabled = true;
          window.setTimeout(remove, ASK_LINGER_MS);
          resolve(i);
        });
        return pill;
      });
      choicesBox.append(...pills);
      if (!step.required) {
        const skip = h("button", { class: "cs-askgate-pill skip" }, "Skip ▸");
        skip.addEventListener("click", (e) => {
          e.stopPropagation();
          if (settled) return;
          settled = true;
          remove();
          resolve(null);
        });
        card.appendChild(skip);
      }
      gate.addEventListener("click", (e) => e.stopPropagation());
      signal.addEventListener("abort", onAbort);
      stage.appendChild(gate);
    });
}

export function attachPlayerControls(
  stageHost: HTMLElement,
  hd: RenderHandle,
  prefs: PlaybackPrefs,
  opts: ControlsOptions = {},
): void {
  const stage = stageHost.querySelector<HTMLElement>(".cs-stage");
  if (!stage) return;
  stageHost.querySelectorAll(".cs-bigplay, .cs-controlbar").forEach((el) => el.remove());

  const total = hd.plan.steps.length;
  const bigPlay = h("button", { class: "cs-bigplay", title: "Play with narration" }, "▶");
  const playBtn = h("button", { class: "cs-bar-btn", title: "Play / pause" }, "▶");
  const backBtn = h("button", { class: "cs-bar-btn", title: "Step back one command" }, "⏮");
  const fwdBtn = h("button", { class: "cs-bar-btn", title: "Step forward one command" }, "⏭");
  const progressFill = h("div", { class: "cs-progress-fill" });
  const progress = h("div", { class: "cs-progress", title: "Seek (per command)" }, progressFill);
  const stepInd = h("span", { class: "step-indicator" }, `0/${total}`);
  const modeSel = h("select", { class: "cs-bar-select", title: "Playback mode" });
  for (const m of ["narrated", "silent", "instant"]) modeSel.appendChild(h("option", { value: m }, m));
  modeSel.value = prefs.mode;
  const speedSel = h("select", { class: "cs-bar-select", title: "Speed multiplier" });
  for (const s of ["0.5", "0.75", "1", "1.25", "1.5", "2"]) speedSel.appendChild(h("option", { value: s }, `${s}×`));
  speedSel.value = String(prefs.speed);
  if (!speedSel.value) speedSel.value = "1";

  const leftExtra: HTMLElement[] = [];
  const rightExtra: HTMLElement[] = [];

  if (opts.speech) {
    const speech = opts.speech;
    speech.setMuted(prefs.muted === true);
    const muteBtn = h("button", { class: "cs-bar-btn", title: "Mute narration (timing unchanged)" }, speech.muted ? "🔇" : "🔊");
    muteBtn.addEventListener("click", () => {
      const muted = !speech.muted;
      speech.setMuted(muted);
      muteBtn.textContent = muted ? "🔇" : "🔊";
      prefs.onMute?.(muted);
    });
    leftExtra.push(muteBtn);
  }
  if (opts.onTheater) {
    const theaterBtn = h("button", { class: "cs-bar-btn", title: "Theater mode (wide)" }, "▭");
    theaterBtn.addEventListener("click", () => opts.onTheater?.());
    rightExtra.push(theaterBtn);
  }
  if (opts.fullscreenEl) {
    const el = opts.fullscreenEl;
    const fsBtn = h("button", { class: "cs-bar-btn", title: "Fullscreen" }, "⛶");
    fsBtn.addEventListener("click", () => {
      if (document.fullscreenElement) void document.exitFullscreen();
      else void el.requestFullscreen?.();
    });
    rightExtra.push(fsBtn);
  }

  const bar = h(
    "div",
    { class: "cs-controlbar" },
    playBtn,
    backBtn,
    fwdBtn,
    ...leftExtra,
    progress,
    stepInd,
    modeSel,
    speedSel,
    ...rightExtra,
    ...(opts.trailing ?? []),
  );
  stage.appendChild(bigPlay);
  // The bar lives below the drawing so it never covers axis labels.
  stage.insertAdjacentElement("afterend", bar);

  // YouTube-like idle behavior: while playing, the controls fade out fully
  // after a moment of pointer inactivity (cursor hidden too) and return on any
  // movement; when paused/done they are always visible. Listeners live on the
  // per-render .cs-figure so re-renders never stack them up.
  const figure = stage.parentElement ?? stageHost;
  const IDLE_MS = 2800;
  let idleTimer: number | null = null;
  let playing = false;
  const setIdle = (idle: boolean) => figure.classList.toggle("cs-idle", idle);
  const scheduleIdle = (ms = IDLE_MS) => {
    if (idleTimer !== null) window.clearTimeout(idleTimer);
    idleTimer = window.setTimeout(() => setIdle(true), ms);
  };
  const activity = () => {
    setIdle(false);
    if (idleTimer !== null) window.clearTimeout(idleTimer);
    idleTimer = null;
    if (playing) scheduleIdle();
  };
  figure.addEventListener("pointermove", activity);
  figure.addEventListener("pointerdown", activity);
  figure.addEventListener("pointerleave", () => {
    if (playing) scheduleIdle(600);
  });

  hd.timeline.inputGate = clickGate(stage);
  hd.timeline.askGate = askGateFor(stage);

  const togglePlay = () => {
    if (hd.timeline.state === "playing") hd.timeline.pause();
    else void hd.timeline.play();
  };
  bigPlay.addEventListener("click", (e) => {
    e.stopPropagation();
    togglePlay();
  });
  playBtn.addEventListener("click", togglePlay);
  backBtn.addEventListener("click", () => hd.timeline.stepBack());
  fwdBtn.addEventListener("click", () => hd.timeline.stepForward());
  modeSel.addEventListener("change", () => {
    const m = modeSel.value as "narrated" | "silent" | "instant";
    hd.timeline.setMode(m);
    prefs.onMode?.(m);
  });
  speedSel.addEventListener("change", () => {
    const s = parseFloat(speedSel.value);
    hd.timeline.setSpeed(s);
    prefs.onSpeed?.(s);
  });
  bar.addEventListener("click", (e) => e.stopPropagation());
  // Clicking the drawing itself toggles play/pause, like a video.
  stage.addEventListener("click", togglePlay);
  progress.addEventListener("click", (e) => {
    e.stopPropagation();
    const rect = progress.getBoundingClientRect();
    const frac = (e.clientX - rect.left) / rect.width;
    hd.timeline.renderUpTo(Math.max(0, Math.min(total, Math.round(frac * total))));
  });

  hd.timeline.callbacks = {
    onState: (s) => {
      stage.classList.toggle("is-playing", s === "playing");
      stage.classList.toggle("is-paused", s === "paused");
      playing = s === "playing";
      if (playing) scheduleIdle(); // hide even without any mouse movement
      else activity(); // paused/done: controls stay visible
      opts.onPlayingChange?.(s === "playing");
      playBtn.textContent = s === "playing" ? "⏸" : "▶";
      bigPlay.textContent = s === "done" ? "↺" : "▶";
      bigPlay.title = s === "done" ? "Replay with narration" : "Play with narration";
    },
    onStep: (done) => {
      stepInd.textContent = `${done}/${total}`;
      progressFill.style.width = `${total > 0 ? (done / total) * 100 : 0}%`;
    },
  };

  // Thumbnail state: show the finished drawing as the poster.
  hd.timeline.showPoster();
  bigPlay.textContent = "▶"; // poster shows play, not replay
  bigPlay.title = "Play with narration";
}
