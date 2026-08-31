// YouTube-style player controls: poster (finished drawing), big play button,
// seekable per-command progress bar, mute, mode/speed selects, theater and
// fullscreen toggles. Shared between the player mode, the editor preview, and
// the standalone #gdoc viewer.

import type { RenderHandle } from "../render";
import type { SpeechManager } from "../render/speech";
import { answersMatch } from "../spec/answers";
import { elementBBoxes } from "../layout/layout";
import { makeBrowserMeasure } from "../render/svg-backend";
import { hitElement } from "./hit";
import { chessSquareAt, pianoKeyAt, pianoKeyBox, pianoKeyGuide, pianoNoteForKey, pianoOctaves } from "../render/widgets";
import { h, logicalPoint } from "./dom";
import { isTextDrag } from "./caption";
import type { SubtitleLanguage } from "../spec/subtitles";
import type { VoiceOption } from "../render/voices";
import { gateIsOpen } from "./gates";
import { attachChessPlay } from "./chessplay";
import { attachInfoCards } from "./infocard";
import { scenes } from "../scenes/registry";

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
  /**
   * Enables the CC button. `languages` always holds at least the drawcast's
   * own language, so CC is a show/hide toggle even with nothing translated;
   * the language picker appears beside it only when there is a second one.
   */
  captions?: {
    languages: SubtitleLanguage[];
    /** The chosen track's code. A code with no track shows the source. */
    lang: string;
    on: boolean;
    onChange(next: { lang: string; on: boolean }): void;
    /**
     * Offers "＋ Add a language…" at the foot of the picker. The editor sets
     * it; the standalone viewer never does — making a track needs a model and
     * a key, and the viewer has neither by design.
     */
    onAdd?(): void;
    /**
     * The Voice row. One control for both the language spoken and the voice
     * speaking it (see render/voices.ts). Absent leaves the row out entirely.
     */
    voice?: {
      /** Re-read on every change: the browser loads voices asynchronously. */
      options(): VoiceOption[];
      current: string;
      onPick(id: string): void;
      onVoicesChanged(cb: () => void): void;
    };
  };
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

/**
 * On-key letter guide (DAW mapping) shown while a piano is interactive:
 * each playable key wears the physical key that plays it. Client-positioned
 * from the live viewBox; short-lived, so resize drift is acceptable.
 */
export function mountKeyGuide(stage: HTMLElement, octaves: 1 | 2): () => void {
  stage.querySelector(".cs-keyguide")?.remove();
  const svg = stage.querySelector<SVGSVGElement>("svg.cs-svg");
  if (!svg) return () => {};
  const r = svg.getBoundingClientRect();
  const sr = stage.getBoundingClientRect();
  if (r.width === 0) return () => {};
  const vb = svg.viewBox.baseVal;
  const guide = h("div", { class: "cs-keyguide" });
  for (const g of pianoKeyGuide(octaves)) {
    const lx = g.box.x + g.box.w / 2;
    const ly = g.black ? g.box.y + g.box.h / 2 : g.box.y + 18;
    const cx = r.left + ((lx - vb.x) / vb.width) * r.width - sr.left;
    const cy = r.top + ((750 - ly - vb.y) / vb.height) * r.height - sr.top;
    const el = h("span", { class: `cs-keyguide-key${g.black ? " black" : ""}` }, g.key.toUpperCase());
    el.style.left = `${cx}px`;
    el.style.top = `${cy}px`;
    guide.appendChild(el);
  }
  stage.appendChild(guide);
  return () => guide.remove();
}

/**
 * The piano widget's gate: clicks on the drawn keyboard resolve the NOTE
 * (and sound it); everything else about the overlay matches the click gate.
 */
function pianoGateFor(stage: HTMLElement, hd: RenderHandle): (signal: AbortSignal, step: AskGateStep) => Promise<string | null> {
  return (signal, step) =>
    new Promise<string | null>((resolve) => {
      stage.querySelector(".cs-figgate")?.remove();
      const hint = h("span", { class: "cs-waitgate-pill cs-figgate-hint" }, "Click a key — or play your keyboard: A S D F G H J \u25b8");
      const gate = h("div", { class: "cs-figgate" }, hint);
      const octaves = pianoOctaves(hd.spec.params);
      const unguide = mountKeyGuide(stage, octaves);
      let settled = false;
      const remove = (): void => {
        signal.removeEventListener("abort", onAbort);
        unguide();
        gate.remove();
      };
      const onAbort = (): void => {
        remove();
        if (!settled) {
          settled = true;
          window.removeEventListener("keydown", onKey);
          resolve(null);
        }
      };
      gate.addEventListener("click", (e) => e.stopPropagation());
      const settle = (note: string, clientX: number | null, clientY: number | null): void => {
        if (settled) return;
        settled = true;
        window.removeEventListener("keydown", onKey);
        try {
          hd.timeline.tones?.play([{ notes: `${note}:q` }], 160);
        } catch {
          /* silent */
        }
        const ok = step.answer !== undefined && answersMatch(note, step.answer);
        const gr = gate.getBoundingClientRect();
        let mx = clientX;
        let my = clientY;
        if (mx === null || my === null) {
          // Typed answers get their mark ON the key.
          const box = pianoKeyBox(octaves, note);
          const svg = stage.querySelector<SVGSVGElement>("svg.cs-svg");
          if (box && svg) {
            const r = svg.getBoundingClientRect();
            const vb = svg.viewBox.baseVal;
            mx = r.left + ((box.x + box.w / 2 - vb.x) / vb.width) * r.width;
            my = r.top + ((750 - (box.y + box.h / 2) - vb.y) / vb.height) * r.height;
          }
        }
        if (mx !== null && my !== null) {
          const mark = h("span", { class: `cs-figgate-mark ${ok ? "right" : "wrong"}` });
          mark.style.left = `${mx - gr.left}px`;
          mark.style.top = `${my - gr.top}px`;
          gate.appendChild(mark);
        }
        hint.remove();
        window.setTimeout(remove, CARD_LINGER_MS);
        resolve(note);
      };
      const onKey = (e: KeyboardEvent): void => {
        if (settled) return;
        if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
        const note = pianoNoteForKey(octaves, e.key);
        if (note === null) return;
        e.preventDefault();
        settle(note, null, null);
      };
      window.addEventListener("keydown", onKey);
      gate.addEventListener("pointerdown", (e) => {
        e.stopPropagation();
        if (settled) return;
        const p = logicalPoint(stage, e);
        if (!p) return;
        const note = pianoKeyAt(octaves, p);
        if (note === null) return; // off the keys: keep waiting
        settle(note, e.clientX, e.clientY);
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
        const id = hitElement(boxes, p, 18); // fat-finger slop, in logical units
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
          // Collect mode has no colors to show — vanish at once, so whatever
          // the answer triggers (a personalized animate) plays in full view.
          settle(typed, 0);
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
  // cs-play is a stable hook: review mode pauses playback by pressing this
  // button rather than reaching into the player's internals.
  const playBtn = h("button", { class: "cs-bar-btn cs-play", title: "Play / pause" }, "▶");
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
  /** Popovers that belong to the bar; mounted beside it, not inside it, so the
   *  bar's own flex layout never has to make room for a panel. */
  const menuPanels: HTMLElement[] = [];

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
  if (opts.captions) {
    const cc = opts.captions;
    // Read once into local state, reported back through onChange: the caller
    // owns the live values (the bar is rebuilt with every item, so it cannot),
    // and may expose them as getters that this must not assign to.
    let on = cc.on;
    let lang = cc.lang;
    let voice = cc.voice?.current ?? "";

    // Everything about how the narration reaches you, in one panel behind CC:
    // what you read, in which language, and which voice says it. As separate
    // bar controls this was three more selects on a strip that already carries
    // twelve and wraps on a phone.
    const ccBtn = h("button", { class: "cs-bar-btn cs-cc", title: "Subtitles and voice" }, "CC");
    const onCb = h("input", { type: "checkbox" }) as HTMLInputElement;
    const langSel = h("select", { class: "cs-menu-select" }) as HTMLSelectElement;
    const voiceSel = h("select", { class: "cs-menu-select" }) as HTMLSelectElement;
    const langRow = h("label", { class: "cs-menu-row cs-menu-sub" }, h("span", {}, "Language"), langSel);
    const voiceRow = h("label", { class: "cs-menu-row" }, h("span", {}, "Voice"), voiceSel);
    const menu = h(
      "div",
      { class: "cs-menu", hidden: "" },
      h("div", { class: "cs-menu-title" }, "Narration"),
      h("label", { class: "cs-menu-row" }, h("span", {}, "Subtitles"), onCb),
      langRow,
      voiceRow,
    );
    voiceRow.hidden = !cc.voice;

    /** Not a language: the last row of the picker opens the authoring dialog. */
    const ADD = "__add__";

    const paint = (): void => {
      ccBtn.classList.toggle("is-on", on);
      onCb.checked = on;
      // The language of the TEXT only matters when there is text showing, and
      // when there is more than one to choose between.
      langRow.hidden = cc.languages.length <= 1 && !cc.onAdd;
      langSel.disabled = !on;
    };

    const fillLanguages = (): void => {
      langSel.replaceChildren();
      for (const l of cc.languages) langSel.appendChild(h("option", { value: l.code }, l.label));
      if (cc.onAdd) langSel.appendChild(h("option", { value: ADD }, "＋ Add a language…"));
      langSel.value = lang || cc.languages[0]?.code || "";
    };

    const fillVoices = (): void => {
      if (!cc.voice) return;
      voiceSel.replaceChildren();
      let group: HTMLElement | null = null;
      for (const o of cc.voice.options()) {
        const option = h("option", { value: o.id }, o.label) as HTMLOptionElement;
        if (o.disabled) option.disabled = true;
        if (o.lang === undefined) {
          group = null;
          voiceSel.appendChild(option);
          continue;
        }
        // One <optgroup> per language, so the list reads as "these voices can
        // say this drawcast in Norwegian" rather than as a flat wall of names.
        if (!group || group.dataset.lang !== o.lang) {
          group = h("optgroup", { label: cc.languages.find((l) => l.code === o.lang)?.label ?? o.lang }) as HTMLElement;
          group.dataset.lang = o.lang;
          voiceSel.appendChild(group);
        }
        group.appendChild(option);
      }
      // A voice remembered from another machine may not exist here; fall back
      // to Default rather than showing a selection that will not be used.
      voiceSel.value = voice;
      if (voiceSel.selectedIndex < 0) {
        voice = "";
        voiceSel.value = "";
      }
    };

    fillLanguages();
    fillVoices();
    paint();
    // Chrome loads voices asynchronously and reports an empty list first.
    cc.voice?.onVoicesChanged(fillVoices);

    const closeMenu = (): void => {
      menu.hidden = true;
      window.removeEventListener("keydown", onMenuKey, true);
    };
    function onMenuKey(e: KeyboardEvent): void {
      if (e.key === "Escape") closeMenu();
    }
    ccBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (!menu.hidden) return closeMenu();
      menu.hidden = false;
      window.addEventListener("keydown", onMenuKey, true);
    });
    // Any click that is not inside the menu closes it — including one on the
    // drawing, which must then NOT also toggle playback: dismissing a panel and
    // pausing the drawcast are two different intentions, and one click should
    // not be read as both. Capture phase on the document so this runs before
    // the stage's own handlers, and stopPropagation so none of them see it.
    document.addEventListener(
      "click",
      (e) => {
        if (menu.hidden) return;
        if (e.target instanceof Node && (menu.contains(e.target) || ccBtn.contains(e.target))) return;
        closeMenu();
        e.stopPropagation();
      },
      true,
    );
    menu.addEventListener("click", (e) => e.stopPropagation());

    onCb.addEventListener("change", () => {
      on = onCb.checked;
      paint();
      cc.onChange({ lang, on });
    });
    langSel.addEventListener("change", () => {
      if (langSel.value === ADD) {
        // Put the picker back before opening the dialog, so cancelling leaves
        // the caption exactly as it reads now.
        langSel.value = lang;
        closeMenu();
        cc.onAdd?.();
        return;
      }
      lang = langSel.value;
      // Picking a language is asking to read it: it turns subtitles back on
      // rather than silently choosing a track nobody can see.
      on = true;
      paint();
      cc.onChange({ lang, on });
    });
    voiceSel.addEventListener("change", () => {
      voice = voiceSel.value;
      cc.voice?.onPick(voice);
    });

    rightExtra.push(ccBtn);
    menuPanels.push(menu);
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
  for (const panel of menuPanels) bar.appendChild(panel);

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

  // Intrinsic free play (pause is the door): the manifest's interactions
  // section (interactivity spec §6) is the one declared source — never
  // sniffed from the template name. On a piano figure, a paused click that
  // lands ON a key sounds it instead of resuming playback. Capture phase so
  // the stage's play/pause toggle never sees it; question gates render
  // their own overlay and are left alone.
  const interactions = (hd.spec.template && scenes[hd.spec.template]?.manifest.interactions) || [];
  if (interactions.includes("chess")) attachChessPlay(stage, hd);
  attachInfoCards(stage, hd); // no-op unless the spec carries card elements
  if (interactions.includes("piano")) {
    const octaves = pianoOctaves(hd.spec.params);
    // A keyboard is an instrument: no scroll-panning from the stage, so a
    // finger can press and glide (touch-action gates pointermove delivery).
    stage.style.touchAction = "none";
    /** Last note per active pointer — a glide re-sounds only on key changes;
     *  several fingers = a chord. */
    const pressed = new Map<number, string>();
    const freePlayBlocked = (e: Event): boolean =>
      hd.timeline.state === "playing" ||
      (e.target instanceof Element && e.target.closest("button") !== null) ||
      gateIsOpen(stage);
    const sound = (note: string): void => {
      try {
        hd.timeline.tones?.play([{ notes: `${note}:q` }], 160);
      } catch {
        /* silent */
      }
    };
    stage.addEventListener(
      "pointerdown",
      (e) => {
        if (freePlayBlocked(e)) return;
        const p = logicalPoint(stage, e);
        const note = p && pianoKeyAt(octaves, p);
        if (!note) return;
        pressed.set(e.pointerId, note);
        sound(note);
      },
      true,
    );
    stage.addEventListener(
      "pointermove",
      (e) => {
        const last = pressed.get(e.pointerId);
        if (last === undefined || freePlayBlocked(e)) return;
        const p = logicalPoint(stage, e);
        const note = p && pianoKeyAt(octaves, p);
        if (!note || note === last) return;
        pressed.set(e.pointerId, note);
        sound(note); // the glissando
      },
      true,
    );
    for (const type of ["pointerup", "pointercancel"] as const) {
      stage.addEventListener(type, (e) => pressed.delete(e.pointerId), true);
    }
    // Typed letters play too (the labels are the mapping); self-cleaning when
    // this mount's stage leaves the DOM.
    const onFreeKey = (e: KeyboardEvent): void => {
      if (!stage.isConnected) {
        window.removeEventListener("keydown", onFreeKey);
        return;
      }
      if (hd.timeline.state === "playing") return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (gateIsOpen(stage)) return;
      const note = pianoNoteForKey(octaves, e.key);
      if (note === null) return;
      e.preventDefault();
      sound(note);
    };
    window.addEventListener("keydown", onFreeKey);
    // The synthesized click after a key press must not reach the play/pause
    // toggle; clicks that never sounded a key (background, buttons) pass.
    stage.addEventListener(
      "click",
      (e) => {
        if (freePlayBlocked(e)) return;
        const p = logicalPoint(stage, e);
        if (p && pianoKeyAt(octaves, p) !== null) e.stopPropagation();
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
  // Clicking the drawing itself toggles play/pause, like a video — but the
  // subtitle band lies across the bottom of it now, and selecting a phrase
  // there to look up ends in a click delivered to the stage. Toggling on that
  // click would pause the drawcast every time a viewer highlighted a word.
  stage.addEventListener("click", () => {
    if (isTextDrag(window.getSelection())) return;
    togglePlay();
  });
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
