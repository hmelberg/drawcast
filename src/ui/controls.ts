// YouTube-style player controls: poster (finished drawing), big play button,
// seekable per-command progress bar, mute, mode/speed selects, theater and
// fullscreen toggles. Shared between the player mode, the editor preview, and
// the standalone #gdoc viewer.

import type { RenderHandle } from "../render";
import type { SpeechManager } from "../render/speech";
import { answersMatch } from "../spec/answers";
import { CANVAS } from "../layout/canvas";
import { elementBBoxes } from "../layout/layout";
import { makeBrowserMeasure } from "../render/svg-backend";
import { hitElement } from "./hit";
import { chessSquareAt, pianoKeyAt, pianoOctaves } from "../render/widgets";
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
 *  Player.quizGate's parameter — controls stays decoupled from plan types). */
interface QuizGateStep {
  question: string;
  choices: string[];
  correct: number;
  required: boolean;
}

/** How long the answered card (with its right/wrong colors) stays on screen
 *  while the feedback line speaks. A scrub or the next question clears it. */
const CARD_LINGER_MS = 2600;

/**
 * The quiz verb's gate: a centered card — question on top, one choice row per
 * option, Skip when the ask is not required. A pick colors the chosen and
 * correct rows and resolves the 0-based index IMMEDIATELY (so the feedback
 * line speaks while the colors are still showing); the card lingers a beat,
 * then removes itself. Skip and abort resolve null. Resolves on signal abort
 * so scrubbing and disposal are never blocked.
 */
export function quizGateFor(stage: HTMLElement): (signal: AbortSignal, step: QuizGateStep) => Promise<number | null> {
  return (signal, step) =>
    new Promise<number | null>((resolve) => {
      // A lingering previous question makes way for this one.
      stage.querySelector(".cs-cardgate")?.remove();
      const choicesBox = h("div", { class: "cs-cardgate-choices" });
      const card = h("div", { class: "cs-cardgate-card" }, h("div", { class: "cs-cardgate-q" }, step.question), choicesBox);
      const gate = h("div", { class: "cs-cardgate" }, card);
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
        const pill = h("button", { class: "cs-cardgate-pill" }, `${i + 1} · ${choice}`) as HTMLButtonElement;
        pill.addEventListener("click", (e) => {
          e.stopPropagation();
          if (settled) return;
          settled = true;
          pill.classList.add(i === step.correct ? "right" : "wrong");
          pills[step.correct].classList.add("right");
          for (const p of pills) p.disabled = true;
          window.setTimeout(remove, CARD_LINGER_MS);
          resolve(i);
        });
        return pill;
      });
      choicesBox.append(...pills);
      if (!step.required) {
        const skip = h("button", { class: "cs-cardgate-pill skip" }, "Skip ▸");
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

/** The slice of the typed-ask plan step the gate needs. */
interface AskGateStep {
  question: string;
  answer?: string;
  retry: boolean;
  required: boolean;
  widget?: "click" | "piano" | "chess";
}

/**
 * The click widget's gate: a transparent overlay on the stage (so the
 * play/pause toggle underneath never fires); a click maps through the svg's
 * LIVE viewBox (camera-proof) into logical y-up coordinates, hits the
 * smallest containing element box, drops a colored marker, and resolves the
 * element id — the player judges it like any typed answer.
 */
/** A click event mapped through the svg's LIVE viewBox into logical y-up coordinates (camera-proof). */
function logicalPoint(stage: HTMLElement, e: MouseEvent): [number, number] | null {
  const svg = stage.querySelector<SVGSVGElement>("svg.cs-svg");
  if (!svg) return null;
  const r = svg.getBoundingClientRect();
  if (r.width === 0 || r.height === 0) return null;
  const vb = svg.viewBox.baseVal;
  const sx = vb.x + ((e.clientX - r.left) / r.width) * vb.width;
  const sy = vb.y + ((e.clientY - r.top) / r.height) * vb.height;
  return [sx, CANVAS.h - sy];
}

/**
 * The piano widget's gate: clicks on the drawn keyboard resolve the NOTE
 * (and sound it); everything else about the overlay matches the click gate.
 */
function pianoGateFor(stage: HTMLElement, hd: RenderHandle): (signal: AbortSignal, step: AskGateStep) => Promise<string | null> {
  return (signal, step) =>
    new Promise<string | null>((resolve) => {
      stage.querySelector(".cs-figgate")?.remove();
      const hint = h("span", { class: "cs-waitgate-pill cs-figgate-hint" }, "Click a key on the piano \u25b8");
      const gate = h("div", { class: "cs-figgate" }, hint);
      const octaves = pianoOctaves(hd.spec.params);
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
      gate.addEventListener("click", (e) => {
        e.stopPropagation();
        if (settled) return;
        const p = logicalPoint(stage, e);
        if (!p) return;
        const note = pianoKeyAt(octaves, p);
        if (note === null) return; // off the keys: keep waiting
        try {
          hd.timeline.tones?.play([{ notes: `${note}:q` }], 160);
        } catch {
          /* silent */
        }
        settled = true;
        const ok = step.answer !== undefined && answersMatch(note, step.answer);
        const gr = gate.getBoundingClientRect();
        const mark = h("span", { class: `cs-figgate-mark ${ok ? "right" : "wrong"}` });
        mark.style.left = `${e.clientX - gr.left}px`;
        mark.style.top = `${e.clientY - gr.top}px`;
        gate.appendChild(mark);
        hint.remove();
        window.setTimeout(remove, CARD_LINGER_MS);
        resolve(note);
      });
      if (!step.required) {
        const skip = h("button", { class: "cs-cardgate-pill skip cs-figgate-skip" }, "Skip \u25b8");
        skip.addEventListener("click", (e) => {
          e.stopPropagation();
          if (settled) return;
          settled = true;
          remove();
          resolve(null);
        });
        gate.appendChild(skip);
      }
      signal.addEventListener("abort", onAbort);
      stage.appendChild(gate);
    });
}

/**
 * The chess widget's gate: click the move's FROM square (a steel ring marks
 * it; clicking it again deselects), then the TO square — resolves the move
 * as coordinates ("e2e4"), judged like any typed answer.
 */
function chessGateFor(stage: HTMLElement, hd: RenderHandle): (signal: AbortSignal, step: AskGateStep) => Promise<string | null> {
  return (signal, step) =>
    new Promise<string | null>((resolve) => {
      stage.querySelector(".cs-figgate")?.remove();
      const hint = h("span", { class: "cs-waitgate-pill cs-figgate-hint" }, "Click the move: from, then to \u25b8");
      const gate = h("div", { class: "cs-figgate" }, hint);
      const flip = hd.spec.params?.["flip"] === true;
      let from: string | null = null;
      let fromMark: HTMLElement | null = null;
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
      gate.addEventListener("click", (e) => {
        e.stopPropagation();
        if (settled) return;
        const p = logicalPoint(stage, e);
        if (!p) return;
        const sq = chessSquareAt(flip, p);
        if (sq === null) return;
        const gr = gate.getBoundingClientRect();
        if (from === null) {
          from = sq;
          fromMark = h("span", { class: "cs-figgate-mark from" });
          fromMark.style.left = `${e.clientX - gr.left}px`;
          fromMark.style.top = `${e.clientY - gr.top}px`;
          gate.appendChild(fromMark);
          return;
        }
        if (sq === from) {
          from = null;
          fromMark?.remove();
          fromMark = null;
          return;
        }
        settled = true;
        const move = `${from}${sq}`;
        const ok = step.answer !== undefined && answersMatch(move, step.answer);
        const mark = h("span", { class: `cs-figgate-mark ${ok ? "right" : "wrong"}` });
        mark.style.left = `${e.clientX - gr.left}px`;
        mark.style.top = `${e.clientY - gr.top}px`;
        gate.appendChild(mark);
        fromMark?.classList.add(ok ? "right" : "wrong");
        hint.remove();
        window.setTimeout(remove, CARD_LINGER_MS);
        resolve(move);
      });
      if (!step.required) {
        const skip = h("button", { class: "cs-cardgate-pill skip cs-figgate-skip" }, "Skip \u25b8");
        skip.addEventListener("click", (e) => {
          e.stopPropagation();
          if (settled) return;
          settled = true;
          remove();
          resolve(null);
        });
        gate.appendChild(skip);
      }
      signal.addEventListener("abort", onAbort);
      stage.appendChild(gate);
    });
}

function figureGateFor(stage: HTMLElement, hd: RenderHandle): (signal: AbortSignal, step: AskGateStep) => Promise<string | null> {
  return (signal, step) =>
    new Promise<string | null>((resolve) => {
      stage.querySelector(".cs-figgate")?.remove();
      const hint = h("span", { class: "cs-waitgate-pill cs-figgate-hint" }, "Click on the figure \u25b8");
      const gate = h("div", { class: "cs-figgate" }, hint);
      const boxes = elementBBoxes(hd.layout, makeBrowserMeasure());
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
      gate.addEventListener("click", (e) => {
        e.stopPropagation();
        if (settled) return;
        const p = logicalPoint(stage, e);
        if (!p) return;
        const id = hitElement(boxes, p);
        if (id === null) return; // background: keep waiting
        settled = true;
        const ok = step.answer !== undefined && answersMatch(id, step.answer);
        const gr = gate.getBoundingClientRect();
        const mark = h("span", { class: `cs-figgate-mark ${ok ? "right" : "wrong"}` });
        mark.style.left = `${e.clientX - gr.left}px`;
        mark.style.top = `${e.clientY - gr.top}px`;
        gate.appendChild(mark);
        hint.remove();
        window.setTimeout(remove, CARD_LINGER_MS);
        resolve(id);
      });
      if (!step.required) {
        const skip = h("button", { class: "cs-cardgate-pill skip cs-figgate-skip" }, "Skip \u25b8");
        skip.addEventListener("click", (e) => {
          e.stopPropagation();
          if (settled) return;
          settled = true;
          remove();
          resolve(null);
        });
        gate.appendChild(skip);
      }
      signal.addEventListener("abort", onAbort);
      stage.appendChild(gate);
    });
}

/**
 * The typed ask verb's gate: a centered card with the question and a text
 * field. Collect mode resolves the typed text at once. Check mode judges:
 * correct → green, linger, resolve; wrong with retry → red flash, field
 * clears, the SAME card keeps accepting attempts; wrong without retry → red,
 * linger, resolve the wrong text (the player speaks wrong/reveal). Skip and
 * abort resolve null. Resolves on signal abort.
 */
export function askGateFor(stage: HTMLElement): (signal: AbortSignal, step: AskGateStep) => Promise<string | null> {
  return (signal, step) =>
    new Promise<string | null>((resolve) => {
      stage.querySelector(".cs-cardgate")?.remove();
      const input = h("input", { type: "text", class: "cs-cardgate-input", "aria-label": step.question }) as HTMLInputElement;
      const okBtn = h("button", { class: "cs-cardgate-pill ok" }, "OK");
      const inputRow = h("div", { class: "cs-cardgate-inputrow" }, input, okBtn);
      const card = h("div", { class: "cs-cardgate-card" }, h("div", { class: "cs-cardgate-q" }, step.question), inputRow);
      const gate = h("div", { class: "cs-cardgate" }, card);
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
      const settle = (v: string | null, hold: number): void => {
        if (settled) return;
        settled = true;
        if (hold > 0) window.setTimeout(remove, hold);
        else remove();
        resolve(v);
      };
      const submit = (): void => {
        if (settled) return;
        const typed = input.value.trim();
        if (typed.length === 0) return;
        if (step.answer === undefined) {
          settle(typed, 700); // collect: brief linger so the entry registers
          return;
        }
        if (answersMatch(typed, step.answer)) {
          input.classList.remove("wrong");
          input.classList.add("right");
          input.disabled = true;
          settle(typed, CARD_LINGER_MS);
        } else if (step.retry) {
          // Same card, next attempt: flash red and clear.
          input.classList.add("wrong");
          window.setTimeout(() => {
            input.classList.remove("wrong");
            input.value = "";
            input.focus();
          }, 650);
        } else {
          input.classList.add("wrong");
          input.disabled = true;
          settle(typed, CARD_LINGER_MS);
        }
      };
      okBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        submit();
      });
      input.addEventListener("keydown", (e) => {
        e.stopPropagation();
        if (e.key === "Enter") submit();
      });
      if (!step.required) {
        const skip = h("button", { class: "cs-cardgate-pill skip" }, "Skip ▸");
        skip.addEventListener("click", (e) => {
          e.stopPropagation();
          settle(null, 0);
        });
        card.appendChild(skip);
      }
      gate.addEventListener("click", (e) => e.stopPropagation());
      signal.addEventListener("abort", onAbort);
      stage.appendChild(gate);
      input.focus();
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
  hd.timeline.quizGate = quizGateFor(stage);
  const textGate = askGateFor(stage);
  const figureGate = figureGateFor(stage, hd);
  const pianoGate = pianoGateFor(stage, hd);
  const chessGate = chessGateFor(stage, hd);
  hd.timeline.askGate = (signal, step) =>
    step.widget === "click"
      ? figureGate(signal, step)
      : step.widget === "piano"
        ? pianoGate(signal, step)
        : step.widget === "chess"
          ? chessGate(signal, step)
          : textGate(signal, step);

  // Intrinsic free play (pause is the door): on a piano figure, a paused
  // click that lands ON a key sounds it instead of resuming playback.
  // Capture phase so the stage's play/pause toggle never sees it; question
  // gates render their own overlay and are left alone.
  if (hd.spec.template === "piano_keys") {
    const octaves = pianoOctaves(hd.spec.params);
    stage.addEventListener(
      "click",
      (e) => {
        if (hd.timeline.state === "playing") return;
        // Controls keep priority: the big replay button sits centered INSIDE
        // the stage — right over the drawn keyboard — and must never be eaten.
        if (e.target instanceof Element && e.target.closest("button")) return;
        if (stage.querySelector(".cs-figgate, .cs-cardgate")) return;
        const p = logicalPoint(stage, e);
        if (!p) return;
        const note = pianoKeyAt(octaves, p);
        if (note === null) return;
        e.stopPropagation();
        try {
          hd.timeline.tones?.play([{ notes: `${note}:q` }], 160);
        } catch {
          /* silent */
        }
      },
      true,
    );
  }

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
