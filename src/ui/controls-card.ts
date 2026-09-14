// The in-place controls card: a `pane: controls` panel's card (spec §3.2 in
// docs/superpowers/specs/2026-09-14-pane-controls-design.md) — the SAME
// controls-group node tray.ts builds (controls-group.ts) mounted ON the
// drawn panel instead of under the control bar, the way ui/code-editor.ts's
// mountCodeEditor mounts the script editor over a code pane. One group, one
// `controlValues`, one `runControls`, one `takenOver`: tray.ts moves the node
// between the two hosts rather than building a second one, so a slider
// dragged here and a takeover run from the tray's own copy are impossible —
// there is only ever one copy, wherever it currently lives.
//
// Positioning mirrors mountCodeEditor's `reposition` (ui/code-editor.ts): the
// pane rectangle, in logical y-up units, mapped to stage pixels through
// `clientPointFor`, then clamped inside the stage with a margin. Copied
// rather than shared because the editor's version also sizes a textarea to a
// minimum row count and scales its font to the drawn line height, so the
// typed text lands on the drawn lines pixel-for-pixel — a controls card has
// no lines to match; it keeps its own (tray-sized) type and only needs the
// rectangle's left/top/width, leaving its height to the group's own content,
// capped by a max-height so it never spills off the stage.

import type { BBox } from "../layout/geometry";
import { clientPointFor, h } from "./dom";

export interface ControlsCardOpts {
  /** The element the controls belong to — its pane box is looked up by this id. */
  id: string;
  /** The pane rectangle right now (logical, y-up), or null when the panel
   *  draws no controls at this moment — a `show` switch can take it away
   *  while the card is open. */
  paneBox(): BBox | null;
  /** The controls-group node to lay over the pane — built by the caller
   *  (buildControlsGroup), so the tray and this card show one node, never
   *  two copies of it. */
  group: HTMLElement;
  /** Closed by ✕ or Escape — the tray unfreezes the stage from here. */
  onClose(): void;
  /** Continue ▶ in the footer — the same action as the tray's own. */
  onContinue(): void;
}

export interface ControlsCardHandle {
  /** Re-measure and re-place; hides the card while the pane is gone. */
  reposition(): void;
  close(): void;
}

/** Kept clear of the stage edge, same idea as code-editor.ts's `editorRect`. */
const MARGIN = 4;

/**
 * Mounts the card over the pane. Returns null when there is no pane to lie on
 * (`show: "output"`, or the panel switched off) — the caller leaves the group
 * in the tray instead, exactly as `mountCodeEditor` falls back to the tray's
 * own script editor.
 */
export function mountControlsCard(stage: HTMLElement, opts: ControlsCardOpts): ControlsCardHandle | null {
  if (!opts.paneBox()) return null;

  const contBtn = h("button", { class: "cs-ctlcard-continue", title: "Restore the lesson and play on" }, "Continue ▶");
  const closeBtn = h("button", { class: "cs-ctlcard-close", title: "Close (Esc)" }, "✕");
  const chin = h("div", { class: "cs-ctlcard-chin" }, contBtn, closeBtn);
  const card = h("div", { class: "cs-ctlcard", role: "dialog", "aria-label": `Controls for ${opts.id}`, tabindex: "-1" }, opts.group, chin);

  // The stage's explore guard swallows clicks so a stray one cannot resume
  // playback; ours are ours — the same three listeners ui/code-editor.ts
  // puts on `.cs-codeedit`, and the guard lets `.cs-ctlcard` through the same way.
  card.addEventListener("click", (e) => e.stopPropagation());
  card.addEventListener("pointerdown", (e) => e.stopPropagation());
  card.addEventListener("contextmenu", (e) => e.stopPropagation());
  card.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Escape") close();
  });
  contBtn.addEventListener("click", () => opts.onContinue());
  closeBtn.addEventListener("click", () => close());

  stage.appendChild(card);

  const reposition = (): void => {
    const box = opts.paneBox();
    if (!box) {
      card.hidden = true; // the panel is switched off: nothing to lie on
      return;
    }
    const tl = clientPointFor(stage, [box.x, box.y + box.h]);
    const br = clientPointFor(stage, [box.x + box.w, box.y]);
    if (!tl || !br) return;
    const stageW = stage.clientWidth;
    const stageH = stage.clientHeight;
    const width = Math.min(Math.max(br[0] - tl[0], 200), Math.max(0, stageW - 2 * MARGIN));
    const left = Math.max(MARGIN, Math.min(tl[0], stageW - MARGIN - width));
    const top = Math.max(MARGIN, Math.min(tl[1], stageH - MARGIN));
    card.hidden = false;
    card.style.left = `${left}px`;
    card.style.top = `${top}px`;
    card.style.width = `${width}px`;
    card.style.maxHeight = `${Math.max(0, stageH - top - MARGIN)}px`;
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
    ro?.disconnect();
    card.remove();
    opts.onClose();
  }

  reposition();
  return { reposition, close };
}
