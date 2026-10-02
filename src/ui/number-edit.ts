// Tap to type (2026-09-27): the number field a widget body's `editable`
// part opens, laid right over the number it edits — a real
// <input type="number"> named for what it edits (aria-label), on a small
// hand-drawn chip in the figure's sketch face. Enter commits, and a number
// the host rejects keeps the field open, marked invalid, with the reason as
// its title; Escape cancels; blur commits a good number and quietly drops a
// bad one (a blur must never trap focus). Positioned like controls-input.ts:
// the logical box through clientPointFor, which follows the paused view's
// pan and zoom, re-run on resize.
import type { BBox } from "../layout/geometry";
import { clientPointFor, h } from "./dom";

export interface NumberEditOpts {
  /** The number's box, logical y-up. */
  box: BBox;
  value: number;
  label: string;
  min?: number;
  max?: number;
  step?: number;
  /** A text field (inputmode decimal) instead of type=number, so "5,8" or
   *  "£300" reach onCommit as typed — a tree's blanks (ui/tree-gate.ts). */
  text?: boolean;
  /** The on-screen keyboard (default "decimal"). iOS's decimal pad has no
   *  minus key: a field that may take a negative number asks for "text". */
  inputmode?: "decimal" | "text";
  /** "over" (default): laid over the number it edits (a widget's own
   *  number). "near": next to the box — below it, else above, else beside —
   *  so what the box asks about stays in sight (a tree's or a formula's blank). */
  place?: "over" | "near";
  /** With place "near": more of the figure to keep clear of (stage px), e.g.
   *  the whole formula the blank sits in. */
  avoid?: () => StageRect | null;
  /** Every keystroke's text (a live preview in the box). */
  onInput?: (text: string) => void;
  /** The typed text: null when taken, else why not (the field stays open). */
  onCommit: (text: string) => string | null;
  onCancel: () => void;
}

/** A rectangle in stage px (left/top from the stage's corner). */
export interface StageRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** The union of two rectangles (either may be missing). */
export function unionRect(a: StageRect | null, b: StageRect | null): StageRect | null {
  if (!a) return b;
  if (!b) return a;
  return { left: Math.min(a.left, b.left), top: Math.min(a.top, b.top), right: Math.max(a.right, b.right), bottom: Math.max(a.bottom, b.bottom) };
}

/**
 * Where a w×h field goes next to `target` inside a stage of `stage` size
 * whose bottom `floor` px are kept in sight (the caption, the answer dock):
 * below it, else above it, else beside it (right, else left) — never over
 * it. When none of those fits, below it all the same, over the floor (the
 * caption is read again; what is asked about is not). Centred on the target
 * where it can be, clamped into the stage. Pure, for the tests.
 */
export function nearSpot(target: StageRect, size: { w: number; h: number }, stage: { w: number; h: number; floor?: number }, gap = 8): { left: number; top: number; side: "below" | "above" | "right" | "left" | "over-floor" } {
  const m = 4;
  const bottom = stage.h - (stage.floor ?? 0);
  const clampX = (x: number): number => Math.max(m, Math.min(stage.w - size.w - m, x));
  const clampY = (y: number): number => Math.max(m, Math.min(bottom - size.h - m, y));
  const cx = (target.left + target.right) / 2;
  const cy = (target.top + target.bottom) / 2;
  const fitsY = size.h <= bottom - 2 * m;
  if (target.bottom + gap + size.h <= bottom - m) return { left: clampX(cx - size.w / 2), top: target.bottom + gap, side: "below" };
  if (target.top - gap - size.h >= m) return { left: clampX(cx - size.w / 2), top: target.top - gap - size.h, side: "above" };
  if (fitsY && target.right + gap + size.w <= stage.w - m) return { left: target.right + gap, top: clampY(cy - size.h / 2), side: "right" };
  if (fitsY && target.left - gap - size.w >= m) return { left: target.left - gap - size.w, top: clampY(cy - size.h / 2), side: "left" };
  return { left: clampX(cx - size.w / 2), top: Math.min(target.bottom + gap, Math.max(m, stage.h - size.h - m)), side: "over-floor" };
}

/** The box (logical y-up) in stage px, or null when the stage is not laid out. */
export function stageRectOf(stage: HTMLElement, box: BBox): StageRect | null {
  const tl = clientPointFor(stage, [box.x, box.y + box.h]);
  const br = clientPointFor(stage, [box.x + box.w, box.y]);
  return tl && br ? { left: tl[0], top: tl[1], right: br[0], bottom: br[1] } : null;
}

/** The height taken at the stage's bottom (px) by what a field must leave
 *  in sight: the answer dock (ui/gate-dock.ts) and the caption being read. */
export function dockFloor(stage: HTMLElement): number {
  const dock = parseFloat(stage.style.getPropertyValue("--cs-dock-h")) || 0;
  const caption = stage.querySelector<HTMLElement>(".cs-caption:not(.cs-caption-empty)");
  if (!caption || stage.closest(".cs-cc-off")) return dock;
  const sr = stage.getBoundingClientRect();
  const cr = caption.getBoundingClientRect();
  return Math.max(dock, sr.bottom - cr.top);
}

/**
 * Lay `el` next to a logical box (placeOverBox's size rules: its font from
 * the box's height, at least `minEm` ems wide) — see nearSpot. `measure`:
 * the element sizes its own height (a field with a row of keys).
 */
export function placeNearBox(stage: HTMLElement, el: HTMLElement, box: BBox, opts: { minEm?: number; avoid?: StageRect | null; measure?: boolean } = {}): boolean {
  const r = stageRectOf(stage, box);
  if (!r) return false;
  const hPx = Math.max(r.bottom - r.top, 18);
  const fontPx = Math.max(16, Math.min(hPx * 0.9, 28));
  const wPx = Math.max(r.right - r.left + fontPx * 1.6, fontPx * (opts.minEm ?? 4.2));
  const sr = stage.getBoundingClientRect();
  el.style.fontSize = `${fontPx}px`;
  let wEl = wPx;
  if (opts.measure) {
    // Its own width when that is more (a row of keys on one line), but never
    // wider than the stage (then the keys wrap).
    el.style.height = "auto";
    el.style.width = "max-content";
    wEl = Math.min(Math.max(wPx, el.offsetWidth), sr.width - 8);
  } else el.style.height = `${fontPx * 1.55}px`;
  el.style.width = `${wEl}px`;
  const hEl = opts.measure ? el.offsetHeight || fontPx * 1.55 : fontPx * 1.55;
  const spot = nearSpot(unionRect(r, opts.avoid ?? null)!, { w: wEl, h: hEl }, { w: sr.width, h: sr.height, floor: dockFloor(stage) });
  el.style.left = `${spot.left}px`;
  el.style.top = `${spot.top}px`;
  el.dataset.side = spot.side;
  return true;
}

/** The field's starting text: the number without float dust. */
export function fieldText(v: number): string {
  return String(Number(v.toPrecision(10)));
}

/**
 * Lay a field over a logical box (y-up): its font from the box's height,
 * wide enough to type in (at least `minEm` ems), centred on the box — or,
 * with `below`, its top that many px under the box, so what the box shows
 * stays in sight. Re-run on resize and on pan/zoom (clientPointFor follows
 * the view). False when the stage is not laid out yet.
 */
export function placeOverBox(stage: HTMLElement, el: HTMLElement, box: BBox, opts: { minEm?: number; below?: number } = {}): boolean {
  const tl = clientPointFor(stage, [box.x, box.y + box.h]);
  const br = clientPointFor(stage, [box.x + box.w, box.y]);
  if (!tl || !br) return false;
  const hPx = Math.max(br[1] - tl[1], 18);
  const fontPx = Math.max(16, hPx * 0.9);
  const wPx = Math.max(br[0] - tl[0] + fontPx * 1.6, fontPx * (opts.minEm ?? 4.2));
  const cx = (tl[0] + br[0]) / 2;
  const cy = (tl[1] + br[1]) / 2;
  const hBox = fontPx * 1.55;
  el.style.left = `${cx - wPx / 2}px`;
  el.style.top = opts.below !== undefined ? `${br[1] + opts.below}px` : `${cy - hBox / 2}px`;
  el.style.width = `${wPx}px`;
  el.style.height = `${hBox}px`;
  el.style.fontSize = `${fontPx}px`;
  return true;
}

export function mountNumberEdit(stage: HTMLElement, opts: NumberEditOpts): { close: () => void; reposition: () => void } | null {
  const input = h("input", {
    class: "cs-numedit",
    inputmode: opts.inputmode ?? "decimal",
    "aria-label": opts.label,
    // Nothing to start from (NaN): an empty field, not "NaN".
    value: Number.isFinite(opts.value) ? fieldText(opts.value) : "",
    ...(opts.min !== undefined ? { min: String(opts.min) } : {}),
    ...(opts.max !== undefined ? { max: String(opts.max) } : {}),
    ...(opts.text ? { type: "text", autocomplete: "off" } : { type: "number", step: opts.step !== undefined ? String(opts.step) : "any" }),
  }) as HTMLInputElement;
  // Why a typed number was not taken: said under the field, readable.
  const message = h("div", { class: "cs-numedit-error", role: "alert" });
  message.hidden = true;
  let done = false;
  const finish = (commit: boolean, fromBlur = false): void => {
    if (done) return;
    if (commit) {
      const error = opts.onCommit(input.value);
      if (error !== null) {
        if (!fromBlur) {
          input.setAttribute("aria-invalid", "true");
          input.title = error;
          message.textContent = error;
          message.hidden = false;
          placeMessage();
          input.select();
          return;
        }
        opts.onCancel();
      }
    } else opts.onCancel();
    done = true;
    window.removeEventListener("resize", reposition);
    input.remove();
    message.remove();
  };
  const placeMessage = (): void => {
    message.style.left = input.style.left;
    message.style.top = `${parseFloat(input.style.top) + (parseFloat(input.style.height) || 0) + 4}px`;
    message.style.minWidth = input.style.width;
  };
  const reposition = (): void => {
    if (opts.place === "near") placeNearBox(stage, input, opts.box, { avoid: opts.avoid?.() ?? null });
    else placeOverBox(stage, input, opts.box);
    placeMessage();
  };
  reposition();
  if (!input.style.left) return null;
  input.addEventListener("input", () => {
    input.removeAttribute("aria-invalid");
    input.removeAttribute("title");
    message.hidden = true;
    opts.onInput?.(input.value);
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      finish(true);
    } else if (e.key === "Escape") {
      e.preventDefault();
      finish(false);
    }
    // The player's own keys (space, arrows) are not this field's viewer's.
    e.stopPropagation();
  });
  input.addEventListener("keyup", (e) => e.stopPropagation());
  input.addEventListener("blur", () => finish(true, true));
  for (const type of ["pointerdown", "click", "wheel"] as const) input.addEventListener(type, (e) => e.stopPropagation());
  window.addEventListener("resize", reposition);
  stage.appendChild(input);
  stage.appendChild(message);
  input.focus();
  input.select();
  return { close: () => finish(false), reposition };
}
