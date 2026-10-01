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
function along(axis: MarketAxis, pts: Pt[], at: number): number | null {
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
  const shape = shapeOf(v, 100) === shapeOf(t, 100);
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
export function marketWhy(m: MarketCurve, v: [number, number], kind: "tax" | "subsidy" | "shift" | "elasticity", ok: boolean): string {
  if (ok) return WHY.right;
  const t = m.truth;
  const dir = dirWord(m, directionOf(t));
  const fill = (s: string) => s.replace("{dir}", dir);
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
  const size = (g: [number, number]) => Math.abs(g[0]) + Math.abs(g[1]);
  return size(v) < size(t) ? WHY.further : WHY.less;
}

/** Where a curve crosses the other one: the equilibrium it implies. */
export function impliedEquilibrium(curve: Pt[], other: Pt[]): Pt | null {
  return intersectPolylines(curve, other);
}
