// The drag question's answer device: a tray of chips over the figure's left
// edge, each dragged (pointer capture, so touch works too) onto the figure and
// judged where it lands — in place, close, or off — then left there with its
// verdict. When every chip has landed the card sums up, lingers, and resolves
// with the hit ids joined by ",". The rules are drag-model.ts; this is the DOM.

import type { RenderHandle } from "../render";
import { elementBBoxes, elementRings } from "../layout/layout";
import { makeBrowserMeasure } from "../render/svg-backend";
import { chessSquareBox, pianoKeyBox, pianoOctaves } from "../render/widgets";
import { h, logicalPoint } from "./dom";
import { dragSummary, judgeDrop, resolveDragTargets, type DragJudgement, type DragTarget } from "./drag-model";
import type { AskGateStep } from "./controls";

/** Matches the other cards' CARD_LINGER_MS. */
const LINGER_MS = 2600;
/** A press that moves less than this (CSS px) is a click, not a drag: the chip goes back. */
const DRAG_MIN_PX = 4;
const GRADE_WORD: Record<DragJudgement["grade"], string> = { in: "in place", near: "close", far: "off" };

export function dragGateFor(stage: HTMLElement, hd: RenderHandle): (signal: AbortSignal, step: AskGateStep) => Promise<string | null> {
  return (signal, step) =>
    new Promise<string | null>((resolve) => {
      stage.querySelector(".cs-figgate")?.remove();
      const { targets } = resolveDragTargets(step.items ?? [], {
        boxes: elementBBoxes(hd.layout, makeBrowserMeasure()),
        rings: elementRings(hd.layout),
        noteBox: (n) => pianoKeyBox(pianoOctaves(hd.spec.params), n),
        squareBox: (s) => chessSquareBox(hd.spec.params?.["flip"] === true, s),
      });
      if (targets.length === 0) {
        // Nothing to place (the planner skipped every item): no gate, no answer.
        resolve(null);
        return;
      }
      const tolerance = step.tolerance ?? 0.25;
      const hint = h("span", { class: "cs-waitgate-pill cs-figgate-hint" }, "Drag each name onto the figure ▸");
      const summary = h("span", { class: "cs-waitgate-pill cs-drag-summary" });
      summary.hidden = true;
      const tray = h("div", { class: "cs-drag-tray" });
      const gate = h("div", { class: "cs-figgate cs-draggate" }, tray, hint, summary);
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
      const judged = new Map<string, DragJudgement>();
      const finish = (): void => {
        if (settled) return;
        settled = true;
        hint.remove();
        summary.textContent = dragSummary(targets.map((t) => judged.get(t.id)!));
        summary.hidden = false;
        window.setTimeout(remove, LINGER_MS);
        resolve(
          targets
            .filter((t) => judged.get(t.id)!.hit)
            .map((t) => t.id)
            .join(","),
        );
      };

      /** One chip: dragged by its transform, it stays where it lands. */
      const chipFor = (t: DragTarget): HTMLElement => {
        const chip = h("button", { class: "cs-cardgate-pill cs-drag-chip", type: "button", "data-id": t.id }, t.label);
        let start: [number, number] | null = null;
        let dx = 0;
        let dy = 0;
        const home = (): void => {
          start = null;
          dx = 0;
          dy = 0;
          chip.classList.remove("dragging");
          chip.style.transform = "";
        };
        chip.addEventListener("pointerdown", (e) => {
          if (settled || judged.has(t.id)) return;
          e.preventDefault();
          e.stopPropagation();
          try {
            chip.setPointerCapture(e.pointerId);
          } catch {
            /* a synthetic pointer has no capture to take; the drag still follows the moves the chip receives */
          }
          start = [e.clientX - dx, e.clientY - dy];
          chip.classList.add("dragging");
        });
        chip.addEventListener("pointermove", (e) => {
          if (!start) return;
          dx = e.clientX - start[0];
          dy = e.clientY - start[1];
          chip.style.transform = `translate(${dx}px, ${dy}px)`;
        });
        chip.addEventListener("pointerup", (e) => {
          if (!start) return;
          start = null;
          chip.classList.remove("dragging");
          const p = logicalPoint(stage, e);
          const r = stage.getBoundingClientRect();
          const onStage = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
          if (!p || !onStage || (Math.abs(dx) < DRAG_MIN_PX && Math.abs(dy) < DRAG_MIN_PX)) {
            home(); // off the figure, or a mere click: back to the tray
            return;
          }
          const j = judgeDrop(p, t, tolerance);
          judged.set(t.id, j);
          chip.classList.add("placed", j.hit ? "right" : "wrong");
          chip.title = GRADE_WORD[j.grade];
          chip.append(h("span", { class: "cs-drag-verdict" }, j.hit ? (j.grade === "in" ? " ✓" : " ✓ close") : " ✗"));
          if (judged.size === targets.length) finish();
        });
        chip.addEventListener("pointercancel", home);
        return chip;
      };
      for (const t of targets) tray.appendChild(chipFor(t));

      if (!step.required) {
        const skip = h("button", { class: "cs-cardgate-pill skip cs-figgate-skip" }, "Skip ▸");
        skip.addEventListener("click", (e) => {
          e.stopPropagation();
          if (settled) return;
          settled = true;
          remove();
          resolve(null);
        });
        gate.appendChild(skip);
      }
      gate.addEventListener("click", (e) => e.stopPropagation());
      signal.addEventListener("abort", onAbort);
      stage.appendChild(gate);
    });
}
