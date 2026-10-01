// What a guess leaves on the figure (spec 2026-10-01-guess-and-reveal §5):
// a GHOST of the guess (dashed, in the viewer's colour) that stays where the
// viewer put it while the figure moves to the truth, and a GAP mark spanning
// guess → truth with the difference written beside it. Pure: the effects
// layer (render/svg-backend.ts setGuessMarks) draws what this returns.

import type { Pt } from "../layout/model";
import { angleOf, pointFor, type GuessHandle } from "./handles";
import { scaleGeometry } from "../spec/scale";

/** The viewer's colour — not the ink, not the highlight, not a series colour. */
export const GUESS_COLOR = "#3f6fb5";

export interface GuessMarkLine {
  pts: Pt[];
  closed?: boolean;
  dashed?: boolean;
}

export interface GuessMarkText {
  at: Pt;
  text: string;
  anchor: "start" | "middle" | "end";
}

export interface GuessMarks {
  color: string;
  lines: GuessMarkLine[];
  texts: GuessMarkText[];
}

/**
 * The marks for these handles: ghosts at `guess`; gaps grown to `t` (0..1)
 * of the way from guess to truth — the gap is drawn as the reveal runs.
 */
export function guessMarks(handles: GuessHandle[], guess: number[][], t = 1): GuessMarks {
  const lines: GuessMarkLine[] = [];
  const texts: GuessMarkText[] = [];
  handles.forEach((h, k) => {
    const g = guess[k] ?? h.truth;
    switch (h.kind) {
      case "height": {
        const top = pointFor(h, g);
        const truthTop = pointFor(h, h.truth);
        if (!top || !truthTop || h.cx === undefined || h.halfW === undefined || !h.toLogical) break;
        const base = h.toLogical([0, Math.max(h.min, Math.min(h.max, 0))])[1];
        const x0 = h.cx - h.halfW, x1 = h.cx + h.halfW;
        lines.push({ pts: [[x0, base], [x0, top[1]], [x1, top[1]], [x1, base]], dashed: true });
        if (t > 0 && Math.abs(truthTop[1] - top[1]) > 4) {
          const bx = x1 + 12;
          const y1 = top[1] + (truthTop[1] - top[1]) * t;
          lines.push({ pts: [[bx - 5, top[1]], [bx, top[1]], [bx, y1], [bx - 5, y1]] });
          // Written in the gap itself, over the bar: beside it is the next bar's
          // room. The bar's own value label stands 13 over the TRUE top, so a
          // guess above the truth keeps its number clear of it: in the gap only
          // when the gap is tall, else over the ghost.
          if (t >= 1) {
            const gap = Math.abs(y1 - top[1]);
            const hi = Math.max(top[1], y1);
            const guessAbove = top[1] > y1;
            const y = guessAbove ? (gap > 70 ? (top[1] + y1) / 2 + 12 : hi + 22) : gap > 30 ? (top[1] + y1) / 2 : hi + 34;
            texts.push({ at: [h.cx, y], text: signed(h, h.truth[0] - g[0]), anchor: "middle" });
          }
        }
        break;
      }
      case "curve": {
        const pts: Pt[] = [];
        if (h.given && h.given.length > 0 && h.toLogical) pts.push(h.toLogical([h.given[h.given.length - 1].x, h.given[h.given.length - 1].v]));
        g.forEach((_, j) => {
          const p = pointFor(h, g, j);
          if (p) pts.push(p);
        });
        if (pts.length >= 2) lines.push({ pts, dashed: true });
        break;
      }
      case "angle": {
        if (!h.centre || h.radius === undefined) break;
        const c = h.centre, r = h.radius;
        const at = (f: number, rr: number): Pt => [c[0] + rr * Math.sin(f * 2 * Math.PI), c[1] + rr * Math.cos(f * 2 * Math.PI)];
        const n = h.truth.length === 1 ? 1 : h.truth.length - 1;
        for (let j = 0; j < n; j++) {
          const fg = angleOf(h, g, j);
          const ft = angleOf(h, h.truth, j);
          lines.push({ pts: [c, at(fg, r)], dashed: true });
          if (t > 0 && Math.abs(ft - fg) > 0.005) {
            const arc: Pt[] = [];
            const steps = 24;
            for (let s = 0; s <= steps; s++) arc.push(at(fg + ((ft - fg) * t * s) / steps, r + 22));
            lines.push({ pts: arc });
          }
        }
        break;
      }
      case "count": {
        if (!h.box) break;
        texts.push({ at: [h.box.x, h.box.y + h.box.h + 22], text: `you ${h.format(g[0])}`, anchor: "start" });
        break;
      }
      case "point": {
        if (!h.scale) break;
        const sg = scaleGeometry(h.scale);
        const x = sg.xAt(g[0]);
        const y = sg.y;
        lines.push({ pts: [[x - 10, y + 30], [x + 10, y + 30], [x, y + 6]], closed: true, dashed: true });
        const xt = sg.xAt(h.truth[0]);
        if (t > 0 && Math.abs(xt - x) > 4) {
          const x1 = x + (xt - x) * t;
          const by = y - 58;
          lines.push({ pts: [[x, by + 6], [x, by], [x1, by], [x1, by + 6]] });
          if (t >= 1) texts.push({ at: [(x + x1) / 2, by - 16], text: sg.kind === "log" ? ratioText(h.truth[0], g[0]) : signedScale(sg.format, h.truth[0] - g[0]), anchor: "middle" });
        }
        break;
      }
    }
  });
  return { color: GUESS_COLOR, lines, texts };
}

function signed(h: GuessHandle, d: number): string {
  return `${d > 0 ? "+" : d < 0 ? "−" : ""}${h.format(Math.abs(d))}`;
}

function signedScale(format: (v: number) => string, d: number): string {
  // A difference of years is a number of years, not a year: "+6", never "+0006".
  const body = format(Math.abs(d));
  return `${d > 0 ? "+" : d < 0 ? "−" : ""}${body}`;
}

/** On a log scale the gap is a factor: "×43" (the truth is 43 times the guess), "÷5". */
function ratioText(truth: number, guess: number): string {
  if (!(truth > 0) || !(guess > 0)) return "";
  const r = truth >= guess ? truth / guess : guess / truth;
  const n = r < 10 ? String(Math.round(r * 10) / 10) : String(Math.round(r));
  return `${truth >= guess ? "×" : "÷"}${n}`;
}
