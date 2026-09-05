// The in-place script editor: a text area laid down ON the code pane, where
// the lines are drawn, so editing a script is done where you are looking
// rather than in a panel under the player.
//
// This is spec §7's original wording ("placed exactly over the code pane's
// rectangle"), which M3 traded for the tray (ledger Ruling A: one gate, one
// Continue, no coordinate mapping). Both surfaces now exist and the viewer
// picks — a paused click on the screen types here, the ⊕ still opens the
// tray's copy — because the two are one editor: ONE draft string, ONE Run
// through the tray's preview state, ONE Continue. Nothing here talks to the
// runtime or the player; tray.ts owns all of that and hands us callbacks.
//
// It stays an HTML overlay over the SVG (the house rule the veil follows):
// movies and <drawcast-figure> mount no control bar, so no recording and no
// embed can ever contain it.

import type { BBox } from "../layout/geometry";
import { LINE_PITCH } from "../layout/code";
import { MONO_FONT } from "../render/svg-backend";
import { attachCodeTyping } from "./code-typing";
import { clientPointFor, h } from "./dom";

/** The card's padding plus its border, in pixels — kept in step with the
 *  .cs-codeedit rule in styles.css so the text area's first character sits
 *  exactly where the drawn line's first character is. */
const CARD_INSET = 6;

/** A rectangle in stage-relative pixels. */
export interface PxRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Where the card goes: the pane's own pixel rectangle, grown to something a
 * person can actually type in, then kept inside the stage. Pure, because the
 * clamping is the part worth pinning in a node test — a one-line script's
 * pane is 20 pixels tall, and a pane near the bottom edge would hang its
 * chin off the picture.
 */
export function editorRect(
  pane: PxRect,
  stage: { w: number; h: number },
  opts: { rowPx: number; chinPx: number; minRows?: number; minWidth?: number; margin?: number; inset?: number },
): PxRect {
  const m = opts.margin ?? 4;
  const minRows = opts.minRows ?? 6;
  // The card's own padding and border sit OUTSIDE the text, so the typed lines
  // land on the drawn ones rather than a few pixels in from them.
  const inset = opts.inset ?? 0;
  const width = Math.min(Math.max(pane.width + 2 * inset, opts.minWidth ?? 240), Math.max(0, stage.w - 2 * m));
  const left = Math.max(m, Math.min(pane.left - inset, stage.w - m - width));
  const wanted = Math.max(pane.height, opts.rowPx * minRows) + 2 * inset + opts.chinPx;
  const height = Math.min(wanted, Math.max(0, stage.h - 2 * m));
  const top = Math.max(m, Math.min(pane.top - inset, stage.h - m - height));
  return { left, top, width, height };
}

export interface EditorSurface {
  setValue(text: string): void;
  status(text: string): void;
  busy(on: boolean): void;
}

/** Question mode: the chin submits an answer instead of continuing. */
export interface CodeAsk {
  /** The viewer pressed Check — run their script and judge it. */
  onCheck(text: string): void;
  /** Null when the question is required: then there is no way past it. */
  onSkip: (() => void) | null;
}

export interface CodeEditorOpts {
  /** The element being edited — its pane box is looked up by this id. */
  id: string;
  /** The script's language, for the card's one-line label. */
  language: string;
  /** The pane's authored font size in logical units (el.font_size). */
  fontSize: number;
  /** The pane rectangle right now (logical, y-up), or null when the panel
   *  draws no code at this moment — a `show` switch can take it away while
   *  the card is open. */
  paneBox(): BBox | null;
  /** The current draft, read when the card mounts. */
  value(): string;
  /** Every keystroke, so the tray's copy of this script stays the same text. */
  onInput(text: string): void;
  onRun(text: string): void;
  onContinue(): void;
  /** Closed by ✕ or Escape — the tray unfreezes the stage from here. */
  onClose(): void;
  /** Registered for as long as the card lives, so a Run started in the tray
   *  reports its status here too. */
  register(surface: EditorSurface): () => void;
  /** Set while an ask holds the run: Check replaces Continue, Escape stops
   *  closing the card (the question owns it), and Skip appears unless the
   *  question is required. */
  ask?: CodeAsk;
}

export interface CodeEditorHandle {
  id: string;
  /** Re-measure and re-place; hides the card while the pane is gone. */
  reposition(): void;
  close(): void;
}

/**
 * Mounts the card over the pane. Returns null when there is no pane to lie on
 * (`show: "output"`, or the code half switched off) — the caller falls back to
 * the tray's editor, which needs no geometry at all.
 */
export function mountCodeEditor(stage: HTMLElement, opts: CodeEditorOpts): CodeEditorHandle | null {
  if (!opts.paneBox()) return null;

  const area = h("textarea", {
    class: "cs-codeedit-area",
    spellcheck: "false",
    "aria-label": `${opts.language} script`,
    title: "Tab indents · Shift-Tab outdents · Ctrl-Space suggests · Esc closes the editor",
  }) as HTMLTextAreaElement;
  area.value = opts.value();
  // The SAME stack the SVG text nodes get, not a copy of it in the stylesheet:
  // the card must be the panel's own type, or the swap between drawn and typed
  // shows as a jump in the letters.
  area.style.fontFamily = MONO_FONT;
  const status = h("span", { class: "cs-codeedit-status" }, "");
  const runBtn = h("button", { class: "cs-codeedit-run", title: "Run this script in the same runtime" }, "Run ▶");
  // Two chins, one card: a question submits an answer where free exploring
  // continues the lesson. Nothing else about the editor changes — the same
  // draft, the same Run, the same runtime.
  const contBtn = opts.ask
    ? h("button", { class: "cs-codeedit-continue", title: "Check your answer" }, "Check ✓")
    : h("button", { class: "cs-codeedit-continue", title: "Restore the lesson and play on" }, "Continue ▶");
  const closeBtn = opts.ask
    ? h("button", { class: "cs-codeedit-close", title: "Skip this question" }, "Skip ▸")
    : h("button", { class: "cs-codeedit-close", title: "Close the editor (Esc)" }, "✕");
  if (opts.ask && !opts.ask.onSkip) closeBtn.hidden = true; // required: no way past
  const chin = h("div", { class: "cs-codeedit-chin" }, runBtn, status, contBtn, closeBtn);
  const card = h("div", { class: "cs-codeedit", role: "dialog", "aria-label": "Edit the script on screen" }, area, chin);

  // Tab, Shift-Tab, Enter and the word list. Attached BEFORE the card's own
  // key handler below, so an Escape that only dismisses the suggestion list is
  // spent there (stopImmediatePropagation) and never closes the editor too.
  const typing = attachCodeTyping(area, { language: opts.language });

  // The stage's explore guard swallows clicks so a stray one cannot resume;
  // ours are ours (the guard lets .cs-codeedit through, and this keeps the
  // events from reaching anything else that listens on the stage).
  card.addEventListener("click", (e) => e.stopPropagation());
  card.addEventListener("pointerdown", (e) => e.stopPropagation());
  card.addEventListener("contextmenu", (e) => e.stopPropagation());
  // Typing is typing: no figure shortcut may read these keys, and Escape is
  // the way out that every overlay in the app already answers to.
  area.addEventListener("keydown", (e) => {
    e.stopPropagation();
    // A question owns the card while it is open; Escape may not walk out of it.
    if (e.key === "Escape" && !opts.ask) close();
  });
  area.addEventListener("input", () => opts.onInput(area.value));
  runBtn.addEventListener("click", () => opts.onRun(area.value));
  contBtn.addEventListener("click", () => (opts.ask ? opts.ask.onCheck(area.value) : opts.onContinue()));
  closeBtn.addEventListener("click", () => (opts.ask ? opts.ask.onSkip?.() : close()));

  stage.appendChild(card);

  const unregister = opts.register({
    setValue: (text) => {
      if (document.activeElement === area) return; // never fight the typist
      area.value = text;
    },
    status: (text) => {
      status.textContent = text;
    },
    busy: (on) => {
      runBtn.disabled = on;
    },
  });

  const chinPx = (): number => Math.max(30, chin.getBoundingClientRect().height);

  const reposition = (): void => {
    const box = opts.paneBox();
    if (!box) {
      card.hidden = true; // the code half is switched off: nothing to lie on
      return;
    }
    const tl = clientPointFor(stage, [box.x, box.y + box.h]);
    const br = clientPointFor(stage, [box.x + box.w, box.y]);
    if (!tl || !br) return;
    // Pixels per logical unit, from the pane we just measured: the card's
    // type then matches the drawn type at any figure size, in fullscreen and
    // in theater mode. A floor keeps a small embed's editor readable — the
    // card is opaque paper, so a size that no longer matches is honest.
    const scalePx = box.h > 0 ? (br[1] - tl[1]) / box.h : 1;
    const fontPx = Math.max(11, opts.fontSize * scalePx);
    const rowPx = fontPx * LINE_PITCH;
    const rect = editorRect(
      { left: tl[0], top: tl[1], width: br[0] - tl[0], height: br[1] - tl[1] },
      { w: stage.clientWidth, h: stage.clientHeight },
      { rowPx, chinPx: chinPx(), inset: CARD_INSET },
    );
    card.hidden = false;
    card.style.left = `${rect.left}px`;
    card.style.top = `${rect.top}px`;
    card.style.width = `${rect.width}px`;
    card.style.height = `${rect.height}px`;
    area.style.fontSize = `${fontPx}px`;
    area.style.lineHeight = `${rowPx}px`;
  };

  const onResize = (): void => reposition();
  window.addEventListener("resize", onResize);
  const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(onResize) : null;
  ro?.observe(stage);

  let closed = false;
  function close(): void {
    if (closed) return;
    closed = true;
    window.removeEventListener("resize", onResize);
    typing.detach();
    ro?.disconnect();
    unregister();
    card.remove();
    opts.onClose();
  }

  reposition();
  area.focus();
  // The caret lands where the reader was looking, not in the middle of a word.
  area.setSelectionRange(area.value.length, area.value.length);
  return { id: opts.id, reposition, close };
}
