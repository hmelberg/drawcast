// The cards gate (specs 2026-10-01-rank-and-sort §4, 2026-10-02-more-ways-
// to-answer): the viewer answers on the drawn cards —
//
//   rank     drag the cards into order            → Answer
//   sort     drag each card into its box          → Answer
//   place    drag each card onto the number line  → Answer
//   match    drag from a card to its partner      → Answer
//   compare  tap the bigger card of each pair     (answers itself)
//   decide   tap a choice                         (answers itself)
//
// A pressed card follows the pointer on the figure (it is the figure's own
// card, moved by the player's `place`); let go, the arrangement changes and
// every card glides to where it now puts them. The rules are cards/model.ts.
//
// Keys: Tab / Shift-Tab pick a card (a ring shows which); rank ←/→ move it a
// slot; sort 1–4 put it in that box, 0 back to the row; place ←/→ move it
// along the line (shift: further); match 1–6 join it to that partner (top to
// bottom); compare ←/→ or 1/2 pick in the current pair; decide 1–4 or ←/→
// and Enter. Enter answers where there is an Answer button.

import type { RenderHandle } from "../render";
import type { CardsSession } from "../render/player";
import { cardAt, cardsMarks, drop, encodeArrangement, matchLines, placePins, positions, type Arrangement } from "../cards/model";
import { GUESS_COLOR } from "../guess/marks";
import type { Pt } from "../layout/model";
import { clientPointFor, h, logicalPoint } from "./dom";
import type { AskGateStep } from "./controls";

/** How long the other cards take to make room. */
const SETTLE_MS = 160;
/** A pair's numbers stand this long before the next pair is asked. */
const PAIR_MS = 700;

const HINT: Record<string, string> = {
  rank: "Drag the cards into order",
  sort: "Drag each card into its box",
  place: "Drag each card onto the line",
  match: "Drag each card to its partner",
  compare: "Tap the bigger one",
  decide: "Choose one",
};

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
      const mode = g.mode;
      let arr: Arrangement = session.start;
      // Where each card is shown right now (logical centre).
      let shown: Pt[] = positions(g, arr);
      let settled = false;
      let anim = 0;
      let focus = -1;
      /** compare: the pair being asked. */
      let row = 0;
      const needsAnswer = mode !== "compare" && mode !== "decide";

      const hint = h("span", { class: "cs-waitgate-pill cs-figgate-hint" }, HINT[mode] ?? "");
      const answer = h("button", { class: "cs-cardgate-pill cs-guess-answer", type: "button" }, "Answer ▸");
      answer.hidden = !needsAnswer;
      const ring = h("div", { class: "cs-card-focus" });
      ring.hidden = true;
      const valuePill = h("span", { class: "cs-guess-value cs-card-value" });
      valuePill.hidden = true;
      const gate = h("div", { class: "cs-figgate cs-guessgate cs-cardsgate" }, hint, answer, ring, valuePill);

      const put = (i: number, p: Pt): void => session.place(g.cards[i], p[0] - g.home[i][0], p[1] - g.home[i][1]);
      /** Glide every card (but `held`) from where it is shown to where `arr` puts it. */
      const settle = (held = -1): void => {
        cancelAnimationFrame(anim);
        const from = shown.slice();
        const to = positions(g, arr);
        const t0 = performance.now();
        const stepFrame = (): void => {
          const t = Math.min(1, (performance.now() - t0) / SETTLE_MS);
          const e = 1 - (1 - t) * (1 - t);
          shown = from.map((p, i) => (i === held ? p : [p[0] + (to[i][0] - p[0]) * e, p[1] + (to[i][1] - p[1]) * e]));
          shown.forEach((p, i) => i !== held && put(i, p));
          // Place: each card on the line is pinned to its point.
          if (mode === "place") session.mark({ color: GUESS_COLOR, lines: placePins(g, positions(g, arr)), texts: [] });
          placeRing();
          if (t < 1 && !settled) anim = requestAnimationFrame(stepFrame);
        };
        stepFrame();
      };
      /** The answer's marks while it is given: match lines (plus the one being drawn). */
      const drawLinks = (live?: { from: number; to: Pt }): void => {
        if (mode !== "match") return;
        const lines = matchLines(g, arr.links ?? [], shown).map((l) => ({ ...l, dashed: false }));
        if (live) {
          const n = g.pairs ?? 0;
          const a = shown[live.from];
          const edge: Pt = [a[0] + (live.from < n ? g.w / 2 : -g.w / 2), a[1]];
          lines.push({ pts: [edge, live.to], dashed: true });
        }
        session.mark({ color: GUESS_COLOR, lines, texts: [] });
      };
      const placeRing = (): void => {
        if (focus < 0) {
          ring.hidden = true;
          return;
        }
        const p = shown[focus];
        const a = clientPointFor(stage, [p[0] - g.w / 2 - 6, p[1] + g.h / 2 + 6]);
        const b = clientPointFor(stage, [p[0] + g.w / 2 + 6, p[1] - g.h / 2 - 6]);
        if (!a || !b) return;
        Object.assign(ring.style, { left: `${a[0]}px`, top: `${a[1]}px`, width: `${b[0] - a[0]}px`, height: `${b[1] - a[1]}px` });
        ring.hidden = false;
      };

      const finish = (result: string | null): void => {
        if (settled) return;
        settled = true;
        cancelAnimationFrame(anim);
        signal.removeEventListener("abort", onAbort);
        document.removeEventListener("keydown", onKey, true);
        gate.remove();
        resolve(result);
      };
      const onAbort = (): void => {
        // Back to where they were drawn: the plan owns the cards again.
        g.cards.forEach((id) => session.place(id, 0, 0));
        session.mark(null);
        finish(null);
      };

      // —— compare and decide: a tap answers ——
      const pickInRow = (side: 0 | 1): void => {
        const rows = g.rows ?? [];
        if (mode !== "compare" || row >= rows.length) return;
        const picks = (arr.picks ?? []).slice();
        picks[row] = side;
        arr = { ...arr, picks };
        session.show(rows[row].map((c) => g.valueIds![c]));
        session.mark(cardsMarks(g, arr));
        row++;
        if (row >= rows.length) window.setTimeout(() => finish(encodeArrangement(g, arr)), PAIR_MS);
        else {
          focus = rows[row][0];
          placeRing();
        }
      };
      const choose = (k: number): void => {
        if (mode !== "decide" || k < 0 || k >= g.cards.length) return;
        arr = { ...arr, choice: k };
        session.mark(cardsMarks(g, arr));
        window.setTimeout(() => finish(encodeArrangement(g, arr)), 250);
      };

      // —— pointer ——
      let dragging: { card: number; grab: Pt; moved: boolean } | null = null;
      gate.addEventListener("pointerdown", (e) => {
        if (settled || (e.target as Element).closest("button")) return;
        e.preventDefault();
        e.stopPropagation();
        const p = logicalPoint(stage, e);
        if (!p) return;
        const card = cardAt(g, shown, p);
        if (card < 0) return;
        if (mode === "compare") {
          const rows = g.rows ?? [];
          if (row < rows.length && rows[row].includes(card)) pickInRow(rows[row][0] === card ? 0 : 1);
          return;
        }
        if (mode === "decide") {
          choose(card);
          return;
        }
        try {
          gate.setPointerCapture(e.pointerId);
        } catch {
          /* a synthetic pointer has no capture */
        }
        dragging = { card, grab: [p[0] - shown[card][0], p[1] - shown[card][1]], moved: false };
        focus = card;
        gate.classList.add("dragging");
      });
      gate.addEventListener("pointermove", (e) => {
        e.stopPropagation();
        if (!dragging || settled) return;
        const p = logicalPoint(stage, e);
        if (!p) return;
        dragging.moved = true;
        if (mode === "match") {
          drawLinks({ from: dragging.card, to: p });
          return;
        }
        shown[dragging.card] = [p[0] - dragging.grab[0], p[1] - dragging.grab[1]];
        put(dragging.card, shown[dragging.card]);
        placeRing();
        if (mode === "rank") {
          // The others make room as it passes over them.
          const next = drop(g, arr, dragging.card, shown[dragging.card]);
          if (next.order.join() !== arr.order.join()) {
            arr = next;
            settle(dragging.card);
          }
        }
        if (mode === "place" && g.scale) {
          const c = shown[dragging.card];
          const sg = g.scale;
          const onLine = c[0] >= sg.x0 - 20 && c[0] <= sg.x1 + 20 && c[1] >= sg.y - 30;
          const cp = clientPointFor(stage, [c[0], c[1] + g.h / 2]);
          valuePill.hidden = !onLine || !cp;
          if (onLine && cp) {
            valuePill.textContent = sg.format(sg.valueAtX(c[0]));
            valuePill.style.left = `${cp[0]}px`;
            valuePill.style.top = `${cp[1]}px`;
          }
        }
      });
      const endDrag = (e: PointerEvent): void => {
        e.stopPropagation();
        if (!dragging) return;
        const { card } = dragging;
        dragging = null;
        gate.classList.remove("dragging");
        valuePill.hidden = true;
        const p = logicalPoint(stage, e);
        if (e.type === "pointerup") {
          if (mode === "match") {
            if (p) arr = drop(g, arr, card, p);
            drawLinks();
            return;
          }
          arr = drop(g, arr, card, shown[card]);
        }
        settle();
      };
      gate.addEventListener("pointerup", endDrag);
      gate.addEventListener("pointercancel", endDrag);
      gate.addEventListener("click", (e) => e.stopPropagation());

      // —— keys ——
      const onKey = (e: KeyboardEvent): void => {
        if (settled) return;
        const n = g.cards.length;
        const pairs = g.pairs ?? 0;
        if (e.key === "Tab") {
          e.preventDefault();
          // Match picks among the left cards; the rest among all.
          const span = mode === "match" ? pairs : n;
          focus = ((focus < 0 ? -1 : focus) + (e.shiftKey ? span - 1 : 1) + span) % span;
          placeRing();
          return;
        }
        if (e.key === "Enter") {
          e.preventDefault();
          if (mode === "decide" && focus >= 0) choose(focus);
          else if (needsAnswer) finish(encodeArrangement(g, arr));
          return;
        }
        const digit = /^[0-9]$/.test(e.key) ? Number(e.key) : null;
        const left = e.key === "ArrowLeft", right = e.key === "ArrowRight";
        if (mode === "compare") {
          if (left || digit === 1) pickInRow(0);
          else if (right || digit === 2) pickInRow(1);
          else return;
          e.preventDefault();
          return;
        }
        if (mode === "decide") {
          if (digit !== null && digit >= 1) choose(digit - 1);
          else if (left || right) {
            focus = ((focus < 0 ? 0 : focus) + (right ? 1 : n - 1)) % n;
            placeRing();
          } else return;
          e.preventDefault();
          return;
        }
        if (focus < 0) return;
        if (mode === "rank" && (left || right)) {
          const s = arr.order.indexOf(focus);
          const t = Math.max(0, Math.min(n - 1, s + (right ? 1 : -1)));
          arr = drop(g, arr, focus, g.slots[t]);
        } else if (mode === "sort" && digit !== null) {
          arr = digit === 0 ? drop(g, arr, focus, [-9999, -9999]) : digit <= g.bins.length ? drop(g, arr, focus, g.binBoxes[digit - 1].c) : arr;
        } else if (mode === "place" && (left || right) && g.scale) {
          const sg = g.scale;
          const cur = arr.values?.[focus] ?? sg.middle;
          const next = sg.stepFrom(cur, (right ? 1 : -1) * (e.shiftKey ? 10 : 1));
          const values = (arr.values ?? []).slice();
          values[focus] = next;
          arr = { ...arr, values };
        } else if (mode === "match" && digit !== null && digit >= 1 && digit <= pairs) {
          // Partners are numbered top to bottom as they stand.
          const rights = Array.from({ length: pairs }, (_, j) => j).sort((a, b) => shown[pairs + b][1] - shown[pairs + a][1]);
          arr = drop(g, arr, focus, shown[pairs + rights[digit - 1]]);
          drawLinks();
          e.preventDefault();
          return;
        } else return;
        e.preventDefault();
        settle();
      };

      answer.addEventListener("click", (e) => {
        e.stopPropagation();
        finish(encodeArrangement(g, arr));
      });
      if (!step.required) {
        const skip = h("button", { class: "cs-cardgate-pill skip cs-figgate-skip", type: "button" }, "Skip ▸");
        skip.addEventListener("click", (e) => {
          e.stopPropagation();
          g.cards.forEach((id) => session.place(id, 0, 0));
          finish(null);
        });
        gate.appendChild(skip);
      }
      signal.addEventListener("abort", onAbort);
      document.addEventListener("keydown", onKey, true);
      stage.appendChild(gate);
      if (mode === "compare" && (g.rows ?? []).length > 0) {
        focus = g.rows![0][0];
        placeRing();
      }
    });
}
