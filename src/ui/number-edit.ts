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
  /** The typed text: null when taken, else why not (the field stays open). */
  onCommit: (text: string) => string | null;
  onCancel: () => void;
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
    inputmode: "decimal",
    "aria-label": opts.label,
    // Nothing to start from (NaN): an empty field, not "NaN".
    value: Number.isFinite(opts.value) ? fieldText(opts.value) : "",
    ...(opts.min !== undefined ? { min: String(opts.min) } : {}),
    ...(opts.max !== undefined ? { max: String(opts.max) } : {}),
    ...(opts.text ? { type: "text", autocomplete: "off" } : { type: "number", step: opts.step !== undefined ? String(opts.step) : "any" }),
  }) as HTMLInputElement;
  let done = false;
  const finish = (commit: boolean, fromBlur = false): void => {
    if (done) return;
    if (commit) {
      const error = opts.onCommit(input.value);
      if (error !== null) {
        if (!fromBlur) {
          input.setAttribute("aria-invalid", "true");
          input.title = error;
          input.select();
          return;
        }
        opts.onCancel();
      }
    } else opts.onCancel();
    done = true;
    window.removeEventListener("resize", reposition);
    input.remove();
  };
  const reposition = (): void => {
    placeOverBox(stage, input, opts.box);
  };
  reposition();
  if (!input.style.left) return null;
  input.addEventListener("input", () => {
    input.removeAttribute("aria-invalid");
    input.removeAttribute("title");
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
  input.focus();
  input.select();
  return { close: () => finish(false), reposition };
}
