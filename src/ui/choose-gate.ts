// The choose gate (spec 2026-10-03-round6 §4): the viewer taps a drawn
// thing — one of the ask's options — on the figure itself.
//
// Pointer: a ring follows the option under it (the hand cursor too); a tap
// on an option answers; a tap on blank paper, or on anything that is not an
// option, does nothing. Keys: Tab / Shift-Tab move a ring between the
// options, Enter (or Space) picks the ringed one, 1–9 pick by number.
// Judged (an answer, judge not false): a ✓/✗ mark on the tapped thing;
// otherwise the ring stays on it. The rules are choose-model.ts.

import type { RenderHandle } from "../render";
import type { ChooseOption } from "../render/plan";
import type { BBox } from "../layout/geometry";
import type { Pt } from "../layout/model";
import { elementBBoxes, elementLines, elementRings } from "../layout/layout";
import { makeBrowserMeasure } from "../render/svg-backend";
import { answersMatch } from "../spec/answers";
import { chooseTargets, hitChoice, type ChooseTarget } from "./choose-model";
import { clientPointFor, h, logicalPoint } from "./dom";
import { mountGateDock, type GateDock } from "./gate-dock";
import type { AskGateStep } from "./controls";
import { keysBelongElsewhere } from "./gates";
import { gateLangOf, gateWords } from "./gate-words";

/** Matches the other cards' CARD_LINGER_MS: the verdict stands this long. */
const LINGER_MS = 2600;
/** The ring's margin round an option (logical). */
const RING_PAD = 6;

/** The figure's per-id geometry the gate hit-tests — the mounted layout's by default. */
export interface ChooseGeometry {
  boxes: ReadonlyMap<string, BBox>;
  rings: ReadonlyMap<string, Pt[][]>;
  lines: ReadonlyMap<string, Pt[][]>;
}

function layoutGeometry(hd: RenderHandle): ChooseGeometry {
  return { boxes: elementBBoxes(hd.layout, makeBrowserMeasure()), rings: elementRings(hd.layout), lines: elementLines(hd.layout) };
}

export function chooseGateFor(
  stage: HTMLElement,
  hd: RenderHandle,
  geometry: () => ChooseGeometry = () => layoutGeometry(hd),
): (signal: AbortSignal, step: AskGateStep) => Promise<string | null> {
  return (signal, step) =>
    new Promise<string | null>((resolve) => {
      const options: ChooseOption[] = step.choose ?? [];
      if (options.length === 0) {
        resolve(null);
        return;
      }
      stage.querySelector(".cs-figgate")?.remove();
      const words = gateWords(gateLangOf(hd));
      const geo = geometry();
      const targets: ChooseTarget[] = chooseTargets(options, geo.boxes, geo.rings, geo.lines);
      const judged = step.answer !== undefined && step.judge !== false;

      const hint = h("span", { class: "cs-waitgate-pill cs-figgate-hint", title: words.choose }, words.choose);
      const ring = h("div", { class: "cs-card-focus cs-choose-ring" });
      ring.hidden = true;
      const gate = h("div", { class: "cs-figgate cs-choosegate" }, ring);
      const docked: HTMLElement[] = [hint];
      let dock: GateDock | null = null;
      let settled = false;
      /** The ringed option (pointer or keys), -1: none. */
      let focus = -1;

      const ringBox = (i: number): { left: number; top: number; width: number; height: number } | null => {
        const b = targets[i]?.box;
        if (!b) return null;
        const a = clientPointFor(stage, [b.x - RING_PAD, b.y + b.h + RING_PAD]);
        const c = clientPointFor(stage, [b.x + b.w + RING_PAD, b.y - RING_PAD]);
        if (!a || !c) return null;
        return { left: a[0], top: a[1], width: c[0] - a[0], height: c[1] - a[1] };
      };
      const placeRing = (): void => {
        const r = focus >= 0 ? ringBox(focus) : null;
        if (!r) {
          ring.hidden = true;
          return;
        }
        Object.assign(ring.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
        ring.hidden = false;
      };
      const setFocus = (i: number): void => {
        if (i === focus) return;
        focus = i;
        placeRing();
      };

      const remove = (): void => {
        signal.removeEventListener("abort", onAbort);
        document.removeEventListener("keydown", onKey, true);
        stage.classList.remove("cs-cardable");
        dock?.dispose();
        gate.remove();
      };
      const onAbort = (): void => {
        remove();
        if (!settled) {
          settled = true;
          resolve(null);
        }
      };
      const pick = (i: number): void => {
        if (settled || i < 0 || i >= targets.length) return;
        settled = true;
        const id = targets[i].id;
        setFocus(i);
        hint.remove();
        if (judged) {
          const ok = answersMatch(id, step.answer!);
          const r = ringBox(i);
          const mark = h("span", { class: `cs-figgate-mark ${ok ? "right" : "wrong"}` }, ok ? "✓" : "✗");
          if (r) {
            mark.style.left = `${r.left + r.width / 2}px`;
            mark.style.top = `${r.top + r.height / 2}px`;
          }
          gate.appendChild(mark);
        } else ring.classList.add("picked");
        document.removeEventListener("keydown", onKey, true);
        window.setTimeout(remove, LINGER_MS);
        resolve(id);
      };
      const indexAt = (e: MouseEvent): number => {
        const p = logicalPoint(stage, e);
        if (!p) return -1;
        const id = hitChoice(targets, p);
        return id === null ? -1 : targets.findIndex((t) => t.id === id);
      };

      // The hand cursor and the ring follow the pointer over the options.
      // Stopped from bubbling, as in the click gate: infocard's stage-level
      // listener would undo the cursor class in the same event.
      gate.addEventListener("pointermove", (e) => {
        e.stopPropagation();
        if (settled) return;
        const i = indexAt(e as MouseEvent);
        stage.classList.toggle("cs-cardable", i >= 0);
        setFocus(i);
      });
      gate.addEventListener("click", (e) => {
        e.stopPropagation();
        if (settled) return;
        const i = indexAt(e as MouseEvent);
        if (i >= 0) pick(i); // blank paper: keep waiting
      });

      const onKey = (e: KeyboardEvent): void => {
        if (settled) return;
        if (keysBelongElsewhere(e.target, e.key)) return;
        const n = targets.length;
        if (e.key === "Tab") {
          e.preventDefault();
          setFocus(((focus < 0 ? (e.shiftKey ? 0 : -1) : focus) + (e.shiftKey ? n - 1 : 1)) % n);
          return;
        }
        if ((e.key === "Enter" || e.key === " ") && focus >= 0) {
          e.preventDefault();
          pick(focus);
          return;
        }
        const digit = /^[1-9]$/.test(e.key) ? Number(e.key) : 0;
        if (digit >= 1 && digit <= n) {
          e.preventDefault();
          pick(digit - 1);
        }
      };

      if (!step.required) {
        const skip = h("button", { class: "cs-cardgate-pill skip cs-figgate-skip", type: "button" }, words.skip);
        skip.addEventListener("click", (e) => {
          e.stopPropagation();
          if (settled) return;
          settled = true;
          remove();
          resolve(null);
        });
        docked.push(skip);
      }
      signal.addEventListener("abort", onAbort);
      document.addEventListener("keydown", onKey, true);
      stage.appendChild(gate);
      dock = mountGateDock(stage, gate, docked, placeRing);
      dock.relayout();
    });
}
