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
    const tl = clientPointFor(stage, [opts.box.x, opts.box.y + opts.box.h]);
    const br = clientPointFor(stage, [opts.box.x + opts.box.w, opts.box.y]);
    if (!tl || !br) return;
    const hPx = Math.max(br[1] - tl[1], 18);
    const fontPx = Math.max(16, hPx * 0.9);
    // Wide enough to type in, centred on the number it covers.
    const wPx = Math.max(br[0] - tl[0] + fontPx * 1.6, fontPx * 4.2);
    const cx = (tl[0] + br[0]) / 2;
    const cy = (tl[1] + br[1]) / 2;
    const hBox = fontPx * 1.55;
    input.style.left = `${cx - wPx / 2}px`;
    input.style.top = `${cy - hBox / 2}px`;
    input.style.width = `${wPx}px`;
    input.style.height = `${hBox}px`;
    input.style.fontSize = `${fontPx}px`;
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
