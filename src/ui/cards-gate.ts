// The cards gate (specs 2026-10-01-rank-and-sort §4, 2026-10-02-more-ways-
// to-answer): the viewer answers on the drawn cards —
//
//   rank     drag the cards into order            → Answer
//   sort     check: each (default, round 7 §3) — the next card is picked;
//            tap a box (or drag a card there): it is judged at once, a
//            wrong one glides to its right box, faded; a counter keeps the
//            score; the last card answers. check: end — a tap sends a card
//            round the boxes and back (row → 1 → 2 → … → row) → Answer.
//            select (one box): check: each — a tap puts a card in, judged (a
//            wrong one goes back, faded); Done judges the rest. check: end —
//            a tap moves it in or out
//   deck     (a sort with deck: true) one large card at a time: tap a box
//            or press 1–4; it flies there with a ✓ or ✗ and the next comes
//            (answers itself after the last). check: each — a wrong card
//            then flies on to its right box, faded; a counter keeps the score
//   place    drag each card onto the number line  → Answer
//   match    drag from a card to its partner      → Answer
//   compare  tap the bigger card of each pair     (answers itself)
//   decide   tap a choice                         (answers itself)
//   fill     drag a tile into each of a formula's boxes, or tap a tile (it
//            goes to the first empty box, then on as sort's) and, if you
//            like, then a box → Answer (one box: the drop answers, unless
//            the ask says release: false)
//
// A pressed card follows the pointer on the figure (it is the figure's own
// card, moved by the player's `place`); let go, the arrangement changes and
// every card glides to where it now puts them. The rules are cards/model.ts.
//
// Keys: Tab / Shift-Tab pick a card (a ring shows which); rank ←/→ move it a
// slot; sort 1–4 put it in that box, 0 back to the row; place ←/→ move it
// along the line (shift: further); match 1–6 join it to that partner (top to
// bottom); compare ←/→ or 1/2 pick in the current pair; decide 1–4 or ←/→
// and Enter; fill 1–n put the tile in that box, 0 back to the row. Enter
// answers where there is an Answer button.

import type { RenderHandle } from "../render";
import type { CardsSession } from "../render/player";
import { allChecked, cardAt, checkDrop, cardsMarks, drop, isPlaced, encodeArrangement, matchLines, placePins, placeRight, positions, putIn, rightCards, tapCard, type Arrangement } from "../cards/model";
import { DEAL_GROW } from "../cards/deck";
import { CORRECTED, counterMarks } from "../cards/counter";
import { tick } from "../guess/reveal";
import { GUESS_COLOR, type GuessMarkText } from "../guess/marks";
import type { Pt } from "../layout/model";
import { clientPointFor, h, logicalPoint } from "./dom";
import { mountGateDock, type GateDock } from "./gate-dock";
import type { AskGateStep } from "./controls";
import { keysBelongElsewhere } from "./gates";
import { gateLangOf, gateWords } from "./gate-words";

/** How long the other cards take to make room. */
const SETTLE_MS = 160;
/** A pair's numbers stand this long before the next pair is asked. */
const PAIR_MS = 700;
/** The focus ring's margin round a card (logical). */
const RING_PAD = 3;
/** A press that moves less than this (CSS px) is a tap, not a drag. */
const TAP_SLOP_PX = 8;
/** fill: a held tile floats this far (logical) above the pointer, so the
 *  finger's point — where it drops — and the box under it stay in sight. */
const HOLD_LIFT = 14;
/** deck: a dealt card's flight into its box, and the next card's growing. */
const FLY_MS = 280;
const GROW_MS = Math.round(FLY_MS * DEAL_GROW * 2);
/** deck: how long a card's ✓ or ✗ stands. */
const FLASH_MS = 700;
/** deck: after the last card lands, a beat before it answers. */
const LAST_MS = 450;
/** The ✓ and ✗ colours (spec 2026-10-03-round6 Global Constraints). */
const RIGHT_COLOR = "#4a7c59";
const WRONG_COLOR = "#b3412e";
/** check: each (round 7 §3.1): a wrong card's ✗ stands in the box it was dropped in this long, */
const CHECK_HOLD_MS = 500;
/** then it glides to its right box over this. */
const CORRECT_MS = 600;

export function cardsGateFor(stage: HTMLElement, hd: RenderHandle): (signal: AbortSignal, step: AskGateStep) => Promise<string | null> {
  return (signal, step) =>
    new Promise<string | null>((resolve) => {
      const session = step.cardsSession as CardsSession | undefined;
      if (!session) {
        resolve(null);
        return;
      }
      stage.querySelector(".cs-figgate")?.remove();
      const words = gateWords(gateLangOf(hd));
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
      const deck = mode === "sort" && g.deck === true && Array.isArray(g.deal);
      // check: each — a plain sort judges every drop (round 7 §3.1): no Answer.
      const sortEach = mode === "sort" && g.each === true && !deck && g.select !== true;
      /** A deck judging each card (round 7 §3.1): a wrong one flies on to its right box. */
      const deckEach = deck && g.each === true;
      /** A select judging each tap (round 7 §3.2): Done judges the rest. */
      const selectEach = mode === "sort" && g.select === true && g.each === true;
      /** A counter stands while the cards are judged. */
      const counting = sortEach || deckEach || selectEach;
      const needsAnswer = mode !== "compare" && mode !== "decide" && !deck && !sortEach;
      // A formula with one box: putting a tile in it answers.
      const dropAnswers = mode === "fill" && g.binBoxes.length === 1 && step.release !== false;
      /** fill: the tile tapped, waiting for a tap on a box (-1: none). */
      let picked = -1;

      const hintKey = deck ? "deck" : g.select ? (selectEach ? "selectEach" : "select") : sortEach ? "sortEach" : mode;
      const hintText = words.cards[hintKey] ?? words.cards[mode] ?? "";
      const hint = h("span", { class: "cs-waitgate-pill cs-figgate-hint", title: hintText }, hintText);
      const answer = h("button", { class: "cs-cardgate-pill cs-guess-answer", type: "button" }, selectEach ? words.done : words.answer);
      answer.hidden = !needsAnswer || dropAnswers;
      const ring = h("div", { class: "cs-card-focus" });
      ring.hidden = true;
      const valuePill = h("span", { class: "cs-guess-value cs-card-value" });
      valuePill.hidden = true;
      const gate = h("div", { class: "cs-figgate cs-guessgate cs-cardsgate" }, ring, valuePill);
      let dock: GateDock | null = null;
      // The bar (round 7 §8.3): Skip, then Answer; the hint is the how line under the question (§8.1).
      const docked: HTMLElement[] = [answer];

      const put = (i: number, p: Pt): void => session.place(g.cards[i], p[0] - g.home[i][0], p[1] - g.home[i][1]);
      /** Glide every card (but `held`) from where it is shown to where `arr` puts it. */
      const settle = (held = -1, ms = SETTLE_MS): void => {
        cancelAnimationFrame(anim);
        const from = shown.slice();
        const to = positions(g, arr);
        const t0 = performance.now();
        const stepFrame = (): void => {
          const t = Math.min(1, (performance.now() - t0) / ms);
          const e = 1 - (1 - t) * (1 - t);
          shown = from.map((p, i) => (i === held ? p : [p[0] + (to[i][0] - p[0]) * e, p[1] + (to[i][1] - p[1]) * e]));
          shown.forEach((p, i) => i !== held && put(i, p));
          // Place: each card on the line is pinned to its point.
          if (mode === "place") session.mark({ color: GUESS_COLOR, lines: placePins(g, positions(g, arr)), texts: [] });
          placeRing();
          rideFlashes();
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
      /** compare: the keys have been used. The ring marks the pair being
       *  asked for the keyboard; under a finger or a mouse a dashed ring on a
       *  card nobody tapped reads as a pick (round 5 fix wave, L9). */
      let keyed = false;
      const placeRing = (): void => {
        if (focus < 0 || (mode === "compare" && !keyed)) {
          ring.hidden = true;
          return;
        }
        const p = shown[focus];
        // A narrow margin: in a sort bin the top card sits close under the
        // bin's title, and a wider ring ran into it (L13).
        const a = clientPointFor(stage, [p[0] - g.w / 2 - RING_PAD, p[1] + g.h / 2 + RING_PAD]);
        const b = clientPointFor(stage, [p[0] + g.w / 2 + RING_PAD, p[1] - g.h / 2 - RING_PAD]);
        if (!a || !b) return;
        Object.assign(ring.style, { left: `${a[0]}px`, top: `${a[1]}px`, width: `${b[0] - a[0]}px`, height: `${b[1] - a[1]}px` });
        ring.hidden = false;
      };

      // —— deck: one card at a time (round 6 §7) ——
      /** deck: how many cards have been dealt; deal[dealt] is the one in the middle. */
      let dealt = 0;
      let deckAnim = 0;
      let flashTimer = 0;
      /** deck: cards in motion — from, to, scale from and to, start, length. */
      const flights = new Map<number, { from: Pt; to: Pt; s0: number; s1: number; t0: number; ms: number }>();
      const big = g.deckScale ?? 1;
      /** deck: each card's scale as drawn now — a card tapped while it still
       *  grows flies from the size it has reached, not from full size. */
      const scaleNow: number[] = g.cards.map(() => 1);
      const fly = (card: number, to: Pt, s1: number, ms: number): void => {
        flights.set(card, { from: shown[card], to, s0: scaleNow[card], s1, t0: performance.now(), ms });
        cancelAnimationFrame(deckAnim);
        const frame = (): void => {
          if (settled) return;
          const now = performance.now();
          for (const [c, f] of flights) {
            const t = Math.min(1, (now - f.t0) / f.ms);
            const e = t * t * (3 - 2 * t);
            shown[c] = [f.from[0] + (f.to[0] - f.from[0]) * e, f.from[1] + (f.to[1] - f.from[1]) * e];
            const sc = f.s0 + (f.s1 - f.s0) * e;
            scaleNow[c] = sc;
            session.place(g.cards[c], shown[c][0] - g.home[c][0], shown[c][1] - g.home[c][1], sc);
            if (t >= 1) flights.delete(c);
          }
          rideFlashes();
          if (flights.size > 0) deckAnim = requestAnimationFrame(frame);
        };
        frame();
      };
      /** deck: the dealt card goes to box k; its ✓ or ✗ flashes; the next card comes. */
      const dealTo = (k: number): void => {
        if (!deck || settled || dealt >= g.deal!.length || k < 0 || k >= g.bins.length) return;
        const card = g.deal![dealt++];
        if (deckEach) {
          // check: each — it flies to box k with ✓ or ✗; a wrong one then flies on to its right box, faded.
          const { ok, arr: judged } = checkDrop(g, arr, card, k);
          // Right: straight to its truth slot (placeRight). Wrong: into box k, for now.
          const before = positions(g, arr);
          arr = ok ? judged : putIn({ ...arr, first: judged.first }, card, k);
          const after = positions(g, arr);
          // A card that changes slot (one dealt later, already in that box) moves with it.
          g.cards.forEach((_, c) => {
            if (c !== card && isPlaced(arr, c) && (before[c][0] !== after[c][0] || before[c][1] !== after[c][1])) fly(c, after[c], 1, SETTLE_MS);
          });
          const to = after[card];
          fly(card, to, 1, FLY_MS);
          const now = performance.now();
          later(() => {
            flashes.set(card, tick([to[0] + g.w / 2 + 2, to[1]], ok, "start", 24));
            markNow();
          }, FLY_MS);
          if (ok) {
            later(() => {
              flashes.delete(card);
              markNow();
            }, FLY_MS + FLASH_MS);
            busyUntil = Math.max(busyUntil, now + FLY_MS);
          } else {
            later(() => {
              const before = positions(g, arr);
              arr = placeRight(g, arr, card);
              const after = positions(g, arr);
              // The cards in either box that change slot move with it.
              g.cards.forEach((_, c) => {
                if (c !== card && isPlaced(arr, c) && (before[c][0] !== after[c][0] || before[c][1] !== after[c][1])) fly(c, after[c], 1, SETTLE_MS);
              });
              // Its ✗ rides along (§3.1.3) and goes when it lands.
              riding.add(card);
              fly(card, after[card], 1, CORRECT_MS);
              session.fade?.(g.cards[card], CORRECTED);
            }, FLY_MS + CHECK_HOLD_MS);
            later(() => {
              riding.delete(card);
              flashes.delete(card);
              markNow();
            }, FLY_MS + CHECK_HOLD_MS + CORRECT_MS);
            busyUntil = Math.max(busyUntil, now + FLY_MS + CHECK_HOLD_MS + CORRECT_MS);
          }
        } else {
          arr = { ...arr, boxes: arr.boxes.map((b, j) => (j === k ? [...b, card] : b)) };
          const to = positions(g, arr)[card];
          fly(card, to, 1, FLY_MS);
          const ok = rightCards(g, arr)[card];
          window.clearTimeout(flashTimer);
          flashTimer = window.setTimeout(() => {
            if (settled) return;
            session.mark({ color: ok ? RIGHT_COLOR : WRONG_COLOR, lines: [], texts: [{ at: [to[0] + g.w / 2 + 2, to[1]], text: ok ? "✓" : "✗", anchor: "start" }] });
            flashTimer = window.setTimeout(() => !settled && session.mark(null), FLASH_MS);
          }, FLY_MS);
        }
        // The next card comes to the middle (the stack's top) and grows.
        if (dealt < g.deal!.length) {
          session.show([g.cards[g.deal![dealt]]]);
          fly(g.deal![dealt], g.home[g.deal![0]], big, GROW_MS);
        } else if (deckEach) later(() => finish(encodeArrangement(g, arr)), Math.max(0, busyUntil - performance.now()) + LAST_MS);
        else window.setTimeout(() => !settled && finish(encodeArrangement(g, arr)), FLY_MS + LAST_MS);
      };
      /** deck: the box under a logical point (padded), or -1. */
      const binAt = (p: Pt): number => g.binBoxes.findIndex((bx) => Math.abs(p[0] - bx.c[0]) <= bx.w / 2 + 10 && Math.abs(p[1] - bx.c[1]) <= bx.h / 2 + 10);

      // —— check: each (round 7 §3) ——
      /** Timers that must not outlive the gate (a ✓ going, a glide to the right box). */
      const timers: number[] = [];
      const later = (f: () => void, ms: number): void => void timers.push(window.setTimeout(() => !settled && f(), ms));
      /** Each card's ✓ or ✗ while it stands — one map, so a quick next drop never wipes the last. */
      const flashes = new Map<number, GuessMarkText>();
      /** Cards gliding to their right box with their ✗ beside them (round 7 §3.1.3: "the ✗ goes with it"). */
      const riding = new Set<number>();
      /** Until when a card still lands or glides: the last answers after. */
      let busyUntil = 0;
      const markNow = (): void => session.mark(counterMarks(g, arr, [...flashes.values()]));
      /** A riding ✗ keeps beside its card, wherever the card is drawn this frame. */
      const rideFlashes = (): void => {
        if (riding.size === 0) return;
        for (const c of riding) {
          const f = flashes.get(c);
          if (f) flashes.set(c, { ...f, at: [shown[c][0] + g.w / 2 + 2, shown[c][1]] });
        }
        markNow();
      };
      /** The tray, top row first, left to right: the order cards are picked in. */
      const trayOrder = g.cards.map((_, i) => i).sort((a, b) => g.home[b][1] - g.home[a][1] || g.home[a][0] - g.home[b][0]);
      const nextPick = (): number => trayOrder.find((c) => !isPlaced(arr, c)) ?? -1;
      /** Card dropped in box k (-1: the tray): it lands there, ✓ or ✗; a wrong one then glides to its right box, faded, its ✗ riding with it. */
      const judge = (card: number, k: number): void => {
        const { ok, arr: judged } = checkDrop(g, arr, card, k);
        // Right: straight to its truth slot. Wrong: where it was dropped, for now.
        arr = ok ? judged : putIn({ ...arr, first: judged.first }, card, k);
        settle();
        const at = positions(g, arr)[card];
        flashes.set(card, tick([at[0] + g.w / 2 + 2, at[1]], ok, "start", 24));
        markNow();
        const now = performance.now();
        if (ok) {
          later(() => {
            flashes.delete(card);
            markNow();
          }, FLASH_MS);
          busyUntil = Math.max(busyUntil, now + SETTLE_MS);
        } else {
          later(() => {
            arr = placeRight(g, arr, card);
            riding.add(card);
            settle(-1, CORRECT_MS);
            session.fade?.(g.cards[card], CORRECTED);
          }, CHECK_HOLD_MS);
          // Landed: the ✗ goes with the glide — nothing red is left.
          later(() => {
            riding.delete(card);
            flashes.delete(card);
            markNow();
          }, CHECK_HOLD_MS + CORRECT_MS);
          busyUntil = Math.max(busyUntil, now + CHECK_HOLD_MS + CORRECT_MS);
        }
        focus = nextPick();
        placeRing();
        if (allChecked(g, arr)) later(() => finish(encodeArrangement(g, arr)), Math.max(0, busyUntil - now) + LAST_MS);
      };
      /** select, Done (round 7 §3.2): the cards left out are judged — a missed one glides into the box, faded, ✗, one by one; one that stays out is ✓. */
      const SWEEP_MS = 150;
      let swept = false;
      const sweep = (): void => {
        if (swept) return;
        swept = true;
        answer.disabled = true;
        const rest = trayOrder.filter((c) => !isPlaced(arr, c));
        for (const c of rest) if (g.truthBin[c] < 0) arr = checkDrop(g, arr, c, -1).arr;
        markNow();
        const missed = rest.filter((c) => g.truthBin[c] >= 0);
        // A wrong card still gliding back goes on undisturbed: the sweep starts once it has landed.
        const start = Math.max(0, busyUntil - performance.now());
        missed.forEach((c, k) =>
          later(() => {
            arr = checkDrop(g, arr, c, -1).arr;
            settle(-1, CORRECT_MS);
            session.fade?.(g.cards[c], CORRECTED);
            markNow();
          }, start + (k + 1) * SWEEP_MS),
        );
        later(() => finish(encodeArrangement(g, arr)), start + missed.length * SWEEP_MS + CORRECT_MS + LAST_MS);
      };

      const finish = (result: string | null): void => {
        if (settled) return;
        settled = true;
        cancelAnimationFrame(anim);
        cancelAnimationFrame(deckAnim);
        window.clearTimeout(flashTimer);
        for (const t of timers) window.clearTimeout(t);
        // The counter stands after the answer, its flashes gone.
        if (counting && result !== null) {
          flashes.clear();
          session.mark(counterMarks(g, arr));
        }
        if (deck && !deckEach) session.mark(null);
        signal.removeEventListener("abort", onAbort);
        document.removeEventListener("keydown", onKey, true);
        dock?.dispose();
        gate.remove();
        resolve(result);
      };
      const onAbort = (): void => {
        // Back to where they were drawn, unfaded: the plan owns the cards again.
        g.cards.forEach((id) => session.place(id, 0, 0));
        g.cards.forEach((id) => session.fade?.(id, 1));
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
        if (row >= rows.length) {
          // Answered: no ring left standing on the last pair while it is read.
          focus = -1;
          placeRing();
          window.setTimeout(() => finish(encodeArrangement(g, arr)), PAIR_MS);
        } else {
          focus = rows[row][0];
          placeRing();
        }
      };
      /** fill, one box: a tile in it answers once it has settled there. */
      const maybeAnswer = (): void => {
        if (dropAnswers && (arr.boxes[0] ?? []).length > 0) window.setTimeout(() => !settled && finish(encodeArrangement(g, arr)), SETTLE_MS + 60);
      };
      /** fill: the box under a logical point (its own size or a tile's, padded), or -1. */
      const boxAt = (p: Pt): number =>
        g.binBoxes.findIndex((bx) => Math.abs(p[0] - bx.c[0]) <= Math.max(bx.w, 24) / 2 + 10 && Math.abs(p[1] - bx.c[1]) <= Math.max(bx.h, 24) / 2 + 10);
      const choose = (k: number): void => {
        if (mode !== "decide" || k < 0 || k >= g.cards.length) return;
        arr = { ...arr, choice: k };
        session.mark(cardsMarks(g, arr));
        window.setTimeout(() => finish(encodeArrangement(g, arr)), 250);
      };

      // —— pointer ——
      /** `start`: where the press began, in client px (a tap's jitter is measured on the screen). */
      let dragging: { card: number; grab: Pt; start: Pt; moved: boolean; at: Pt } | null = null;
      /** The last tap's card and where it landed: a quick second tap there
       *  finds the card still gliding away (final fix wave E — not dropped). */
      let lastTap: { card: number; at: Pt; t: number } | null = null;
      const TAP_AGAIN_MS = 450;
      gate.addEventListener("pointerdown", (e) => {
        if (settled || (e.target as Element).closest("button")) return;
        e.preventDefault();
        e.stopPropagation();
        const p = logicalPoint(stage, e);
        if (!p) return;
        if (deck) {
          // A deck answers with taps on the boxes; the cards are not dragged.
          dealTo(binAt(p));
          return;
        }
        if (sortEach) {
          // Tap the box, not the card (round 7 §3.1.5): a tap on a box — or on
          // a card already in one — sends the picked card there; a tray card
          // is picked, or dragged.
          const hit = cardAt(g, shown, p);
          if (hit < 0 || isPlaced(arr, hit)) {
            const k = binAt(p);
            if (k >= 0 && focus >= 0 && !isPlaced(arr, focus)) judge(focus, k);
            return;
          }
        }
        let card = cardAt(g, shown, p);
        if (card < 0 && !counting && lastTap && performance.now() - lastTap.t < TAP_AGAIN_MS && Math.abs(p[0] - lastTap.at[0]) <= g.w / 2 && Math.abs(p[1] - lastTap.at[1]) <= g.h / 2) card = lastTap.card;
        if (card < 0) {
          // fill: a tapped tile, then a tap on a box, puts it there.
          if (mode === "fill" && picked >= 0) {
            const k = boxAt(p);
            if (k >= 0) {
              arr = drop(g, arr, picked, g.binBoxes[k].c);
              settle();
              maybeAnswer();
            }
            picked = -1;
            focus = -1;
            placeRing();
          }
          return;
        }
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
        dragging = { card, grab: [p[0] - shown[card][0], p[1] - shown[card][1]], start: [e.clientX, e.clientY], moved: false, at: p };
        focus = card;
        gate.classList.add("dragging");
      });
      gate.addEventListener("pointermove", (e) => {
        e.stopPropagation();
        if (!dragging || settled) return;
        const p = logicalPoint(stage, e);
        if (!p) return;
        // A finger's jitter on a tap is not a drag (fill: a tap picks the
        // tile) — measured in screen px, not in the 1000-wide canvas.
        if (!dragging.moved && Math.hypot(e.clientX - dragging.start[0], e.clientY - dragging.start[1]) < TAP_SLOP_PX) return;
        dragging.moved = true;
        if (mode === "match") {
          drawLinks({ from: dragging.card, to: p });
          return;
        }
        dragging.at = p;
        // fill: the tile rides above the pointer (y-up: +), which is the drop point.
        shown[dragging.card] = mode === "fill" ? [p[0], p[1] + g.h / 2 + HOLD_LIFT] : [p[0] - dragging.grab[0], p[1] - dragging.grab[1]];
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
        const { card, moved, at } = dragging;
        dragging = null;
        gate.classList.remove("dragging");
        valuePill.hidden = true;
        const p = logicalPoint(stage, e);
        if (e.type === "pointerup") {
          if (sortEach) {
            if (!moved) {
              // A tap on a tray card picks it; the next tap on a box sends it.
              focus = card;
              placeRing();
              return;
            }
            const k = binAt(shown[card]);
            if (k >= 0) {
              judge(card, k);
              return;
            }
            // Let go off the boxes: back to the tray, unjudged.
          }
          if (selectEach) {
            // A tap — or a drag into the box — puts it in, judged; a drag let go elsewhere goes back.
            if (!moved || binAt(shown[card]) >= 0) {
              judge(card, 0);
              return;
            }
          }
          if ((mode === "fill" || mode === "sort") && !moved) {
            // A tap, not a drag (round 6 §7): it sends the card on round the
            // boxes and back to the row (a tile: the first empty blank first).
            // fill: a tap on a box next puts the tapped tile there instead.
            arr = tapCard(g, arr, card);
            lastTap = { card, at, t: performance.now() };
            if (mode === "fill") picked = card;
            focus = card;
            settle();
            if (mode === "fill") maybeAnswer();
            return;
          }
          if (mode === "match") {
            if (p) arr = drop(g, arr, card, p);
            drawLinks();
            return;
          }
          if (!sortEach && !selectEach) arr = drop(g, arr, card, mode === "fill" ? at : shown[card]);
          if (mode === "fill") {
            picked = -1;
            maybeAnswer();
          }
        }
        settle();
      };
      gate.addEventListener("pointerup", endDrag);
      gate.addEventListener("pointercancel", endDrag);
      gate.addEventListener("click", (e) => e.stopPropagation());

      // —— keys ——
      const onKey = (e: KeyboardEvent): void => {
        if (settled) return;
        // Another control has the keys (the tray, a text box; the Answer
        // button's Enter is its own click) — not the Play button that kept
        // the focus (gates.ts keysBelongElsewhere).
        if (keysBelongElsewhere(e.target, e.key)) return;
        if (deck) {
          const k = /^[1-9]$/.test(e.key) ? Number(e.key) - 1 : -1;
          if (k < 0 || k >= g.bins.length) return;
          e.preventDefault();
          dealTo(k);
          return;
        }
        if (mode === "compare" && !keyed) {
          keyed = true;
          placeRing();
        }
        const n = g.cards.length;
        const pairs = g.pairs ?? 0;
        if (e.key === "Tab") {
          e.preventDefault();
          if (counting) {
            // Only the cards still in the tray: a placed card is final.
            const open = trayOrder.filter((c) => !isPlaced(arr, c));
            if (open.length === 0) return;
            const i = open.indexOf(focus);
            focus = open[((i < 0 ? -1 : i) + (e.shiftKey ? open.length - 1 : 1) + open.length) % open.length];
            placeRing();
            return;
          }
          // Match picks among the left cards; the rest among all.
          const span = mode === "match" ? pairs : n;
          focus = ((focus < 0 ? -1 : focus) + (e.shiftKey ? span - 1 : 1) + span) % span;
          placeRing();
          return;
        }
        if (e.key === "Enter") {
          e.preventDefault();
          if (mode === "decide" && focus >= 0) choose(focus);
          else if (needsAnswer) {
            if (selectEach) sweep();
            else finish(encodeArrangement(g, arr));
          }
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
        if (sortEach || selectEach) {
          // 1–4 send the picked card; 0 means nothing (a placed card is final).
          const d = /^[1-9]$/.test(e.key) ? Number(e.key) - 1 : -1;
          if (d < 0 || d >= g.bins.length || isPlaced(arr, focus)) return;
          e.preventDefault();
          judge(focus, d);
          return;
        }
        if (mode === "rank" && (left || right)) {
          const s = arr.order.indexOf(focus);
          const t = Math.max(0, Math.min(n - 1, s + (right ? 1 : -1)));
          arr = drop(g, arr, focus, g.slots[t]);
        } else if ((mode === "sort" || mode === "fill") && digit !== null) {
          arr = digit === 0 ? drop(g, arr, focus, [-9999, -9999]) : digit <= g.bins.length ? drop(g, arr, focus, g.binBoxes[digit - 1].c) : arr;
          if (mode === "fill") {
            settle();
            maybeAnswer();
            e.preventDefault();
            return;
          }
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
        if (selectEach) sweep();
        else finish(encodeArrangement(g, arr));
      });
      if (!step.required) {
        const skip = h("button", { class: "cs-cardgate-pill skip cs-figgate-skip", type: "button" }, words.skip);
        skip.addEventListener("click", (e) => {
          e.stopPropagation();
          g.cards.forEach((id) => session.place(id, 0, 0));
          g.cards.forEach((id) => session.fade?.(id, 1));
          session.mark(null);
          finish(null);
        });
        docked.unshift(skip);
      }
      signal.addEventListener("abort", onAbort);
      document.addEventListener("keydown", onKey, true);
      stage.appendChild(gate);
      dock = mountGateDock(stage, gate, docked, () => placeRing(), { question: step.question, how: hint });
      dock.relayout();
      // check: each — the first tray card is picked (a deck has no tray to
      // pick from); the counter starts at 0.
      if (counting) {
        if (!deck) {
          focus = nextPick();
          placeRing();
        }
        markNow();
      }
      if (mode === "compare" && (g.rows ?? []).length > 0) {
        focus = g.rows![0][0];
        placeRing();
      }
      // deck: the top card grows in the middle.
      if (deck && g.deal!.length > 0) fly(g.deal![0], g.home[g.deal![0]], big, GROW_MS);
    });
}
