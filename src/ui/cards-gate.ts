// The cards gate (spec 2026-10-01-rank-and-sort §4): the viewer drags the
// drawn cards — into order (rank) or into boxes (sort) — and presses Answer.
// A pressed card follows the pointer on the figure; let go, it takes the
// slot (the others make room) or the box it is over, and every card glides
// to where the arrangement puts it. The rules are cards/model.ts; the cards
// are the figure's own (moved by the player's place, i.e. the renderer's
// offset), so this owns only the pointer and the pills.

import type { RenderHandle } from "../render";
import type { CardsSession } from "../render/player";
import { cardAt, drop, encodeArrangement, positions, type Arrangement } from "../cards/model";
import type { Pt } from "../layout/model";
import { h, logicalPoint } from "./dom";
import type { AskGateStep } from "./controls";

/** How long the other cards take to make room. */
const SETTLE_MS = 160;

export function cardsGateFor(stage: HTMLElement, _hd: RenderHandle): (signal: AbortSignal, step: AskGateStep) => Promise<string | null> {
  return (signal, step) =>
    new Promise<string | null>((resolve) => {
      const session = step.cardsSession as CardsSession | undefined;
      if (!session) {
        resolve(null);
        return;
      }
      stage.querySelector(".cs-figgate")?.remove();
      const g = session.geometry;
      let arr: Arrangement = session.start;
      // Where each card is shown right now (logical centre).
      let shown: Pt[] = positions(g, arr);
      let settled = false;
      let anim = 0;

      const hint = h(
        "span",
        { class: "cs-waitgate-pill cs-figgate-hint" },
        g.mode === "rank" ? "Drag the cards into order, then Answer" : "Drag each card into its box, then Answer",
      );
      const answer = h("button", { class: "cs-cardgate-pill cs-guess-answer", type: "button" }, "Answer ▸");
      const gate = h("div", { class: "cs-figgate cs-guessgate cs-cardsgate" }, hint, answer);

      const put = (i: number, p: Pt): void => session.place(g.cards[i], p[0] - g.home[i][0], p[1] - g.home[i][1]);
      /** Glide every card (but `held`) from where it is shown to where `arr` puts it. */
      const settle = (held = -1): void => {
        cancelAnimationFrame(anim);
        const from = shown.slice();
        const to = positions(g, arr);
        const t0 = performance.now();
        const step = (): void => {
          const t = Math.min(1, (performance.now() - t0) / SETTLE_MS);
          const e = 1 - (1 - t) * (1 - t);
          shown = from.map((p, i) => (i === held ? p : [p[0] + (to[i][0] - p[0]) * e, p[1] + (to[i][1] - p[1]) * e]));
          shown.forEach((p, i) => i !== held && put(i, p));
          if (t < 1 && !settled) anim = requestAnimationFrame(step);
        };
        step();
      };

      const finish = (result: string | null): void => {
        if (settled) return;
        settled = true;
        cancelAnimationFrame(anim);
        signal.removeEventListener("abort", onAbort);
        gate.remove();
        resolve(result);
      };
      const onAbort = (): void => {
        // Back to where they were drawn: the plan owns the cards again.
        g.cards.forEach((id) => session.place(id, 0, 0));
        finish(null);
      };

      let dragging: { card: number; grab: Pt } | null = null;
      gate.addEventListener("pointerdown", (e) => {
        if (settled || (e.target as Element).closest("button")) return;
        e.preventDefault();
        e.stopPropagation();
        const p = logicalPoint(stage, e);
        if (!p) return;
        const card = cardAt(g, shown, p);
        if (card < 0) return;
        try {
          gate.setPointerCapture(e.pointerId);
        } catch {
          /* a synthetic pointer has no capture */
        }
        dragging = { card, grab: [p[0] - shown[card][0], p[1] - shown[card][1]] };
        gate.classList.add("dragging");
      });
      gate.addEventListener("pointermove", (e) => {
        e.stopPropagation();
        if (!dragging || settled) return;
        const p = logicalPoint(stage, e);
        if (!p) return;
        shown[dragging.card] = [p[0] - dragging.grab[0], p[1] - dragging.grab[1]];
        put(dragging.card, shown[dragging.card]);
        if (g.mode === "rank") {
          // The others make room as it passes over them.
          const next = drop(g, arr, dragging.card, shown[dragging.card]);
          if (next.order.join() !== arr.order.join()) {
            arr = next;
            settle(dragging.card);
          }
        }
      });
      const endDrag = (e: PointerEvent): void => {
        e.stopPropagation();
        if (!dragging) return;
        const { card } = dragging;
        dragging = null;
        gate.classList.remove("dragging");
        if (e.type === "pointerup") arr = drop(g, arr, card, shown[card]);
        settle();
      };
      gate.addEventListener("pointerup", endDrag);
      gate.addEventListener("pointercancel", endDrag);
      gate.addEventListener("click", (e) => e.stopPropagation());

      answer.addEventListener("click", (e) => {
        e.stopPropagation();
        finish(encodeArrangement(g, arr));
      });
      if (!step.required) {
        const skip = h("button", { class: "cs-cardgate-pill skip cs-figgate-skip", type: "button" }, "Skip ▸");
        skip.addEventListener("click", (e) => {
          e.stopPropagation();
          finish(null);
        });
        gate.appendChild(skip);
      }
      signal.addEventListener("abort", onAbort);
      stage.appendChild(gate);
    });
}
