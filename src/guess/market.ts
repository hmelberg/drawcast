// Move the curve (spec 2026-10-03-curves-trees-formulas §3): the arithmetic
// behind a guess on a supply/demand curve. The viewer's curve is the old one
// moved along ONE axis — `X = c + k · (X₀ − c) + s` — and it is scored by two
// gaps against the old curve, a quarter and three quarters of the way along
// it. Those two gaps are the handle's numbers, so the round-1 marks apply.
//
// Pure: the truth comes from the template's own layout at the animate's end
// params, read back from `curveSamples` into the 0–100 domain — the same
// numbers the template draws, never a second model of the market.

import type { Pt } from "../layout/model";
import { interpolateAtX, intersectPolylines } from "../layout/curves";
import { layoutSupplyDemand, type SupplyDemandParams } from "../scenes/supply_demand/layout";

export type MarketAxis = "price" | "quantity";

export interface MarketCurve {
  curve: "supply_curve" | "demand_curve";
  axis: MarketAxis;
  /** c: 0 on the price axis, Qe on the quantity axis. */
  pivot: number;
  /** The old curve, domain units (Q, P), sorted by the moving axis' partner. */
  base: Pt[];
  /** The two sample points' coordinate on the other axis (Q for price, P for quantity). */
  at: [number, number];
  /** t1, t2: the true gaps along the axis. */
  truth: [number, number];
  /** The true new curve, domain units. */
  truthCurve: Pt[];
  /** The other curve, for the implied equilibrium; domain units. */
  other: Pt[];
}

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v);

/** What moves the asked curve, from the animate's targets. */
export function marketMove(curve: string, params: Rec, targets: Rec): { axis: MarketAxis; truthId: string } | string {
  const side = curve === "supply_curve" ? "supply" : curve === "demand_curve" ? "demand" : null;
  if (!side) return `${curve} is not a market curve (supply_curve or demand_curve)`;
  for (const key of Object.keys(targets)) {
    if (key === "tax.amount") {
      // A tax on sellers moves supply, a tax on buyers moves demand.
      const taxSide = isRec(params.tax) && params.tax.side === "buyer" ? "demand" : "supply";
      if (taxSide === side) return { axis: "price", truthId: `tax_${side}_curve` };
    }
    if (key === `${side}_shift.amount`) return { axis: "quantity", truthId: `${side}_shift_curve` };
    if (key === `${side}.offset` || key === `${side}.elasticity`) return { axis: "quantity", truthId: curve };
  }
  return `the next animate does not move ${curve}`;
}

/** curveSamples are template-logical; this undoes the layout's 0–100 → plot box scale. */
function samples(params: Rec): Record<string, Pt[]> {
  const lay = layoutSupplyDemand(params as SupplyDemandParams);
  const box = lay.frame!.box;
  const out: Record<string, Pt[]> = {};
  for (const [id, pts] of Object.entries(lay.curveSamples ?? {})) {
    out[id] = pts.map(([x, y]): Pt => [((x - box.x0) / (box.x1 - box.x0)) * 100, ((y - box.y0) / (box.y1 - box.y0)) * 100]);
  }
  return out;
}

const swap = (pts: Pt[]): Pt[] => pts.map(([a, b]): Pt => [b, a]);
const span = (xs: number[]): [number, number] => [Math.min(...xs), Math.max(...xs)];

/** The moving coordinate of `pts` at partner coordinate `at` (P(Q) on the price axis, Q(P) on the quantity axis). */
export function along(axis: MarketAxis, pts: Pt[], at: number): number | null {
  return axis === "price" ? interpolateAtX(pts, at) : interpolateAtX(swap(pts), at);
}

export function marketCurve(params: Rec, end: Rec, curve: string, targets: Rec): MarketCurve | string {
  const move = marketMove(curve, params, targets);
  if (typeof move === "string") return move;
  const before = samples(params);
  const after = samples(end);
  const otherId = curve === "supply_curve" ? "demand_curve" : "supply_curve";
  const old = before[curve];
  const other = before[otherId];
  const truthCurve = after[move.truthId];
  if (!old || !other) return `the market draws no ${old ? otherId : curve}`;
  if (!truthCurve || truthCurve.length < 2) return `the market draws no ${move.truthId} at the animate's end`;
  const { axis } = move;
  const partner = axis === "price" ? 0 : 1;
  const base = [...old].sort((a, b) => a[partner] - b[partner]);
  let pivot = 0;
  if (axis === "quantity") {
    const eq = intersectPolylines(old, other);
    if (!eq) return `${curve} does not cross ${otherId}`;
    pivot = eq[0];
  }
  // Where both the old and the true curve are defined, along the partner axis.
  const [a0, a1] = span(base.map((p) => p[partner]));
  const [b0, b1] = span(truthCurve.map((p) => p[partner]));
  const lo = Math.max(a0, b0);
  const hi = Math.min(a1, b1);
  if (!(hi > lo)) return `the new ${curve} does not overlap the old one`;
  const at: [number, number] = [lo + (hi - lo) / 4, lo + ((hi - lo) * 3) / 4];
  const truth = at.map((q) => {
    const n = along(axis, truthCurve, q);
    const o = along(axis, base, q);
    return n === null || o === null ? null : n - o;
  });
  if (truth[0] === null || truth[1] === null) return `could not read the new ${curve}`;
  return { curve: curve as MarketCurve["curve"], axis, pivot, base, at, truth: [truth[0], truth[1]], truthCurve, other };
}

/** The viewer's curve for (s, k), domain units. */
export function transformed(m: MarketCurve, s: number, k: number): Pt[] {
  const i = m.axis === "price" ? 1 : 0;
  return m.base.map((p): Pt => {
    const q: Pt = [p[0], p[1]];
    q[i] = m.pivot + k * (p[i] - m.pivot) + s;
    return q;
  });
}

/** The old curve's moving coordinate at the two sample points, less the pivot. */
function baseAt(m: MarketCurve): [number, number] {
  const x = m.at.map((q) => (along(m.axis, m.base, q) ?? m.pivot) - m.pivot);
  return [x[0], x[1]];
}

/** Gaps (v1, v2) of (s, k). */
export function gapsOf(m: MarketCurve, s: number, k: number): [number, number] {
  const [x1, x2] = baseAt(m);
  return [(k - 1) * x1 + s, (k - 1) * x2 + s];
}

/** The (s, k) that give gaps (v1, v2). */
export function skOf(m: MarketCurve, v: [number, number]): { s: number; k: number } {
  const [x1, x2] = baseAt(m);
  // A vertical (or horizontal) old curve has one coordinate at both points:
  // no turn can be told from a shift, so it is all shift.
  if (Math.abs(x1 - x2) < 1e-9) return { s: (v[0] + v[1]) / 2, k: 1 };
  const a = (v[0] - v[1]) / (x1 - x2);
  return { s: v[0] - a * x1, k: 1 + a };
}

export type Shape = "shift" | "turn" | "none";

export function shapeOf(v: [number, number], range: number): Shape {
  const big = Math.max(Math.abs(v[0]), Math.abs(v[1]));
  if (big < 0.01 * range) return "none";
  return Math.abs(v[1] - v[0]) < 0.25 * big ? "shift" : "turn";
}

/** The sign of v1 + v2 (§3.3). */
export function directionOf(v: [number, number]): 1 | -1 | 0 {
  const sum = v[0] + v[1];
  return sum > 1e-9 ? 1 : sum < -1e-9 ? -1 : 0;
}

/** A turn about the equilibrium crosses the old curve: its gaps differ in sign. */
const crosses = (v: [number, number]): boolean => v[0] * v[1] < 0;

/** Which way a curve turned: steeper (−1) or flatter (+1) about the pivot, from k.
 *  k stretches the moving coordinate: prices (k > 1 steeper) or quantities (k > 1 flatter). */
function turnSense(m: MarketCurve, v: [number, number]): 1 | -1 | 0 {
  const { k } = skOf(m, v);
  const sense = k > 1 + 1e-9 ? 1 : k < 1 - 1e-9 ? -1 : 0;
  return (m.axis === "price" ? -sense : sense) as 1 | -1 | 0;
}

/** Right the way `check` asks: direction ⊂ shape ⊂ size. */
export function marketRight(m: MarketCurve, v: [number, number], check: "direction" | "shape" | "size", tolerance: number): boolean {
  const t = m.truth;
  // An elasticity change turns the curve about the equilibrium, so v1 + v2
  // carries no direction; which way it turned (steeper or flatter) does.
  const direction = crosses(t) ? turnSense(m, v) === turnSense(m, t) : directionOf(v) === directionOf(t);
  if (!direction || check === "direction") return direction;
  // A turn is also a sense: flatter for steeper is the wrong shape.
  const shape = shapeOf(v, 100) === shapeOf(t, 100) && (shapeOf(t, 100) !== "turn" || turnSense(m, v) === turnSense(m, t));
  if (!shape || check === "shape") return shape;
  return (Math.abs(v[0] - t[0]) + Math.abs(v[1] - t[1])) / 2 <= tolerance * 100;
}

function dirWord(m: MarketCurve, d: 1 | -1 | 0): string {
  if (m.axis === "price") return d >= 0 ? "up" : "down";
  return d >= 0 ? "right" : "left";
}

/** "moved up", "turned up", "moved right", "turned flatter" … or "did not move it". */
export function marketWords(m: MarketCurve, v: [number, number]): string {
  const shape = shapeOf(v, 100);
  if (shape === "none") return "did not move it";
  if (shape === "turn" && crosses(v)) return turnSense(m, v) > 0 ? "turned flatter" : "turned steeper";
  return `${shape === "shift" ? "moved" : "turned"} ${dirWord(m, directionOf(v))}`;
}

// i18n: built-in English sentences, one table so a translation can replace it
// whole (the cards' hints are English-only too). `{dir}` is the truth's way.
const WHY = {
  right: "The new curve is where you put it.",
  // Right by a looser check: what the viewer got right, in words.
  rightDirection: "It moves {dir}.",
  rightShift: "It moves {dir}.",
  rightTurn: { steeper: "It turns {dir} and gets steeper.", flatter: "It turns {dir} and gets flatter." },
  rightCross: { steeper: "It turns about the equilibrium and gets steeper.", flatter: "It turns about the equilibrium and gets flatter." },
  none: "You left the curve where it was, but it moves.",
  // A percent tax steepens supply (sellers' price × (1 + a)) but flattens
  // demand (buyers' price ÷ (1 + a)); a subsidy the other way round.
  shiftNotTurn: {
    tax: {
      steeper: "You moved it {dir} evenly. A percent tax adds more where prices are high, so the curve also gets steeper.",
      flatter: "You moved it {dir} evenly. A percent tax takes more off where prices are high, so the curve also gets flatter.",
    },
    subsidy: {
      steeper: "You moved it {dir} evenly. A percent subsidy adds more where prices are high, so the curve also gets steeper.",
      flatter: "You moved it {dir} evenly. A percent subsidy takes off more where prices are high, so the curve also gets flatter.",
    },
    other: "You moved it evenly, but the new curve also turns about the equilibrium.",
  },
  // A turn the right way up or down, but flatter for steeper (or the
  // reverse); keyed by the truth's sense.
  wrongTurn: {
    tax: {
      steeper: "You turned it flatter. A percent tax adds more where prices are high, so the curve gets steeper.",
      flatter: "You turned it steeper. A percent tax takes more off where prices are high, so the curve gets flatter.",
    },
    subsidy: {
      steeper: "You turned it flatter. A percent subsidy adds more where prices are high, so the curve gets steeper.",
      flatter: "You turned it steeper. A percent subsidy takes more off where prices are high, so the curve gets flatter.",
    },
    other: { steeper: "You turned it flatter, but the curve gets steeper.", flatter: "You turned it steeper, but the curve gets flatter." },
  },
  turnNotShift: {
    tax: "You turned it. A tax per unit adds the same amount at every quantity, so the curve moves {dir} without turning.",
    subsidy: "You turned it. A subsidy per unit takes off the same amount at every quantity, so the curve moves {dir} without turning.",
    other: "You turned it. The curve moves by the same amount at every price, so it moves {dir} without turning.",
  },
  direction: {
    tax: {
      supply_curve: "A tax on sellers raises the price they need at every quantity, so supply moves up, not down.",
      demand_curve: "A tax on buyers lowers what they will pay at every quantity, so demand moves down, not up.",
    },
    subsidy: {
      supply_curve: "A subsidy lowers the price sellers need, so supply moves down.",
      demand_curve: "A subsidy raises what buyers will pay, so demand moves up.",
    },
    shift: {
      supply_curve: { right: "Supply rises at every price, so the curve moves right.", left: "Supply falls at every price, so the curve moves left." },
      demand_curve: { right: "Demand rises at every price, so the curve moves right.", left: "Demand falls at every price, so the curve moves left." },
    },
    elasticity: {
      flatter: "More elastic means flatter: the curve turns about the equilibrium.",
      steeper: "Less elastic means steeper: the curve turns about the equilibrium.",
    },
  },
  further: "The right way and the right shape, but the curve moves further than that.",
  less: "The right way and the right shape, but the curve does not move that far.",
};

/** One built-in sentence for the case at hand ({t.why}, §3.4). */
export function marketWhy(
  m: MarketCurve,
  v: [number, number],
  kind: "tax" | "subsidy" | "shift" | "elasticity",
  ok: boolean,
  check: "direction" | "shape" | "size" = "size",
): string {
  const t = m.truth;
  const dir = dirWord(m, directionOf(t));
  const fill = (s: string) => s.replace("{dir}", dir);
  if (ok) {
    // The sentence says what the check asked, and no more: a roughly right
    // guess is not "where the curve goes".
    if (check === "size") return WHY.right;
    const sense = turnSense(m, t) > 0 ? "flatter" : "steeper";
    if (crosses(t)) return WHY.rightCross[sense];
    if (check === "direction") return fill(WHY.rightDirection);
    return shapeOf(t, 100) === "turn" ? fill(WHY.rightTurn[sense]) : fill(WHY.rightShift);
  }
  const priceKind = kind === "tax" || kind === "subsidy" ? kind : "other";
  const vShape = shapeOf(v, 100);
  const tShape = shapeOf(t, 100);
  const wrongWay = crosses(t) ? turnSense(m, v) !== turnSense(m, t) : directionOf(v) !== directionOf(t);
  if (wrongWay && vShape !== "none") {
    if (kind === "elasticity") return turnSense(m, t) > 0 ? WHY.direction.elasticity.flatter : WHY.direction.elasticity.steeper;
    if (kind === "shift") return WHY.direction.shift[m.curve][dir === "left" ? "left" : "right"];
    return WHY.direction[kind][m.curve];
  }
  if (vShape === "none") return WHY.none;
  if (vShape === "shift" && tShape === "turn") {
    if (priceKind === "other") return WHY.shiftNotTurn.other;
    return fill(WHY.shiftNotTurn[priceKind][turnSense(m, t) > 0 ? "flatter" : "steeper"]);
  }
  if (vShape === "turn" && tShape === "shift") return fill(WHY.turnNotShift[priceKind]);
  if (vShape === "turn" && tShape === "turn" && turnSense(m, v) !== turnSense(m, t)) return WHY.wrongTurn[priceKind][turnSense(m, t) > 0 ? "flatter" : "steeper"];
  const size = (g: [number, number]) => Math.abs(g[0]) + Math.abs(g[1]);
  return size(v) < size(t) ? WHY.further : WHY.less;
}

/** Where a curve crosses the other one: the equilibrium it implies. */
export function impliedEquilibrium(curve: Pt[], other: Pt[]): Pt | null {
  return intersectPolylines(curve, other);
}

export type MarketKind = "tax" | "subsidy" | "shift" | "elasticity";

/** What the animate does to the asked curve, for {t.why}: a negative tax is a subsidy. */
export function marketKind(curve: string, params: Rec, targets: Rec): MarketKind {
  const move = marketMove(curve, params, targets);
  if (typeof move !== "string" && move.axis === "price") {
    const t = targets["tax.amount"];
    return typeof t === "number" && t < 0 ? "subsidy" : "tax";
  }
  // The asked curve's own elasticity only: the other curve's is not this move.
  const side = curve === "supply_curve" ? "supply" : "demand";
  return `${side}.elasticity` in targets ? "elasticity" : "shift";
}

/** The viewer's curve for gaps v, domain units. */
export function curveOfGaps(m: MarketCurve, v: [number, number]): Pt[] {
  const { s, k } = skOf(m, v);
  return transformed(m, s, k);
}

/** The market's plot area, in its domain units (the template draws 0–100 on both axes). */
export const MARKET_DOMAIN = { lo: 0, hi: 100 };

/** A polyline clipped to the square [lo, hi]² (Liang–Barsky per segment): the runs inside. */
export function clipToSquare(pts: Pt[], lo: number, hi: number): Pt[][] {
  const runs: Pt[][] = [];
  let cur: Pt[] = [];
  const flush = () => {
    if (cur.length >= 2) runs.push(cur);
    cur = [];
  };
  for (let i = 0; i + 1 < pts.length; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[i + 1];
    const dx = x1 - x0, dy = y1 - y0;
    let t0 = 0, t1 = 1;
    let inside = true;
    for (const [pp, q] of [[-dx, x0 - lo], [dx, hi - x0], [-dy, y0 - lo], [dy, hi - y0]] as [number, number][]) {
      if (pp === 0) {
        if (q < 0) inside = false;
        continue;
      }
      const r = q / pp;
      if (pp < 0) t0 = Math.max(t0, r);
      else t1 = Math.min(t1, r);
    }
    if (!inside || t0 > t1) {
      flush();
      continue;
    }
    const a: Pt = [x0 + dx * t0, y0 + dy * t0];
    const b: Pt = [x0 + dx * t1, y0 + dy * t1];
    const last = cur[cur.length - 1];
    if (!last || Math.hypot(last[0] - a[0], last[1] - a[1]) > 1e-9) {
      flush();
      cur.push(a);
    }
    cur.push(b);
    if (t1 < 1) flush();
  }
  flush();
  return runs;
}

/** The viewer's copy as drawn: the longest run of it inside the plot square
 *  (domain units). What the grab dots sit on and what a press measures its
 *  ends along — the whole curve runs off the plot once it is moved. */
export function visibleCopy(m: MarketCurve, v: [number, number]): Pt[] {
  const runs = clipToSquare(curveOfGaps(m, v), MARKET_DOMAIN.lo, MARKET_DOMAIN.hi);
  return runs.length === 0 ? [] : runs.reduce((a, b) => (b.length > a.length ? b : a));
}

/** The point of the viewer's curve (gaps v) at partner coordinate q, domain units. */
export function marketPoint(m: MarketCurve, v: [number, number], q: number): Pt | null {
  const x0 = along(m.axis, m.base, q);
  if (x0 === null) return null;
  const { s, k } = skOf(m, v);
  const x = m.pivot + k * (x0 - m.pivot) + s;
  return m.axis === "price" ? [q, x] : [x, q];
}

/**
 * The equilibrium a curve implies against the other one, as (Q, P) in domain
 * units. A tax or subsidy on buyers moves demand: buyers pay what the OLD
 * demand curve says at that quantity, so that is the price reported (§3.4).
 */
export function impliedMarket(m: MarketCurve, curve: Pt[]): Pt | null {
  const e = impliedEquilibrium(curve, m.other);
  if (!e) return null;
  if (m.curve === "demand_curve" && m.axis === "price") {
    const p = along("price", m.base, e[0]);
    return p === null ? e : [e[0], p];
  }
  return e;
}
