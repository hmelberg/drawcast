// The one piece of HTML left in a live control panel (spec 2026-09-15 §3.2):
// a text or number field's value is typed into an <input> laid over the
// DRAWN box — the drawn box is its frame, so the input has no border of its
// own — in the figure's sketch face at the drawn text's size. Enter and blur
// commit, Escape cancels; either way the node is removed. Positioned the way
// ui/code-editor.ts lays its textarea on a pane: the logical box through
// clientPointFor, re-run on resize.
import type { BBox } from "../layout/geometry";
import { clientPointFor, h } from "./dom";

export interface ControlsInputOpts {
  /** The drawn box, logical y-up. */
  box: BBox;
  /** The drawn text's size in logical units; scaled to pixels like the box. */
  fontSize: number;
  value: string;
  numeric: boolean;
  onCommit: (text: string) => void;
  onCancel: () => void;
}

export function mountControlsInput(stage: HTMLElement, opts: ControlsInputOpts): { close: () => void; reposition: () => void } | null {
  const input = h("input", { class: "cs-ctlinput", type: "text", inputmode: opts.numeric ? "decimal" : "text", value: opts.value });
  let done = false;
  const finish = (commit: boolean): void => {
    if (done) return;
    done = true;
    window.removeEventListener("resize", reposition);
    input.remove();
    if (commit) opts.onCommit(input.value);
    else opts.onCancel();
  };
  const reposition = (): void => {
    const tl = clientPointFor(stage, [opts.box.x, opts.box.y + opts.box.h]);
    const br = clientPointFor(stage, [opts.box.x + opts.box.w, opts.box.y]);
    if (!tl || !br) return;
    const hPx = br[1] - tl[1];
    input.style.left = `${tl[0]}px`;
    input.style.top = `${tl[1]}px`;
    input.style.width = `${br[0] - tl[0]}px`;
    input.style.height = `${hPx}px`;
    // The drawn text is fontSize logical units tall; the box is FIELD_H_EM
    // of those — scale the pixel font by the same ratio the box was scaled.
    input.style.fontSize = `${Math.max(11, (opts.fontSize / opts.box.h) * hPx)}px`;
  };
  reposition();
  if (!input.style.left) return null;
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") finish(true);
    else if (e.key === "Escape") finish(false);
    e.stopPropagation();
  });
  input.addEventListener("blur", () => finish(true));
  for (const type of ["pointerdown", "click"] as const) input.addEventListener(type, (e) => e.stopPropagation());
  window.addEventListener("resize", reposition);
  stage.appendChild(input);
  input.focus();
  input.select();
  return { close: () => finish(false), reposition };
}
