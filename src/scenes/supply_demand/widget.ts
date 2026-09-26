// supply_demand's widget body (Hans 2026-09-26): the natural interaction of a
// market diagram is to take hold of it. While the figure is paused the viewer
// DRAGS what is drawn and the market recomputes under the pointer — the
// equilibrium slides, the shortage opens, the deadweight-loss triangle grows:
//
//   a curve, in its middle        → it shifts sideways
//   a curve, near either end      → it turns about the equilibrium (elasticity)
//   the price ceiling / floor     → up and down (level)
//   the taxed curve               → up and down (the tax)
//
// Structure-derived: the template simply HAS this; no cast command asks for
// it. Pure like every body (widget-types.ts) — it reads the press-time scene
// and returns a patch, and the host paints that patch live (`live: true`).
// All arithmetic is in the template's own 0–100 domain: the host maps the
// pointer through the template frame and the page's fit, so a drag is exact
// under any box or grow scaling.
import { interpolateAtX, intersectPolylines } from "../../layout/curves";
import type { Pt } from "../../layout/model";
import type { WidgetBody, WidgetEvent, WidgetScene } from "../widget-types";
import { layoutSupplyDemand, type CurveParams, type SupplyDemandParams } from "./layout";

/** What a press can take, in the order a tie goes: a taxed or shifted curve
 *  lying ON its original (a tax of 0, D′ at amount 0) is the one on top, so
 *  the viewer can pull it off. */
export const SD_PARTS = ["tax_supply_curve", "tax_demand_curve", "demand_shift_curve", "supply_shift_curve", "ceiling_line", "floor_line", "demand_curve", "supply_curve"];

/** The outer share of a curve's length, at either end, that turns it rather
 *  than shifting it. */
export const END_ZONE = 0.2;

// The manifest's documented ranges (layout.ts clamps the same way).
const E_MIN = 0.06;
const E_MAX = 1.94;
const SHIFT_MIN = -93;
const SHIFT_MAX = 95;
const OFFSET_MAX = 60;
const LEVEL_MIN = 2;
const LEVEL_MAX = 96;

const ELASTICITY: Record<string, number> = { perfectly_inelastic: 0.06, inelastic: 0.5, unit: 1, elastic: 1.5, perfectly_elastic: 1.94 };

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
const round = (v: number, places = 2): number => Math.round(v * 10 ** places) / 10 ** places;

/** layout.ts elasticityFactor, duplicated rather than exported: the x-run
 *  scale an elasticity gives (tan(e·π/4), exactly 1 at unit). */
function elasticityScale(e: CurveParams["elasticity"]): number {
  const raw = typeof e === "number" ? e : (ELASTICITY[e ?? "unit"] ?? 1);
  const c = clamp(raw, E_MIN, E_MAX);
  return c === 1 ? 1 : Math.tan((c * Math.PI) / 4);
}
const elasticityOf = (s: number): number => round(clamp((4 / Math.PI) * Math.atan(s), E_MIN, E_MAX), 3);

/** The nearest point of a polyline to p, and how far along it lies (0–1 of its length). */
export function nearestAlong(pts: readonly Pt[], p: Pt): { at: Pt; t: number } {
  const lens = [0];
  for (let i = 1; i < pts.length; i++) lens.push(lens[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const total = lens[lens.length - 1] || 1;
  let best = { d: Infinity, at: pts[0], t: 0 };
  for (let i = 1; i < pts.length; i++) {
    const [a, b] = [pts[i - 1], pts[i]];
    const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
    const len2 = dx * dx + dy * dy;
    const u = len2 === 0 ? 0 : clamp(((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2, 0, 1);
    const at: Pt = [a[0] + u * dx, a[1] + u * dy];
    const d = Math.hypot(p[0] - at[0], p[1] - at[1]);
    if (d < best.d) best = { d, at, t: (lens[i - 1] + u * (lens[i] - lens[i - 1])) / total };
  }
  return { at: best.at, t: best.t };
}

/** The market at the press, read off the template's own layout: the curves in
 *  domain units, the pivot every elasticity turns about, the price lines. */
function market(params: SupplyDemandParams): { curve: (id: string) => Pt[] | null; pivot: Pt | null } {
  const lay = layoutSupplyDemand(params);
  const f = lay.frame!;
  const toDom = ([x, y]: Pt): Pt => [
    f.x[0] + ((x - f.box.x0) / (f.box.x1 - f.box.x0)) * (f.x[1] - f.x[0]),
    f.y[0] + ((y - f.box.y0) / (f.box.y1 - f.box.y0)) * (f.y[1] - f.y[0]),
  ];
  const curve = (id: string): Pt[] | null => lay.curveSamples?.[id]?.map(toDom) ?? null;
  const d = curve("demand_curve");
  const s = curve("supply_curve");
  // Elasticity scales each curve's x-run about the crossing of the pair, and
  // the scaled pair still crosses there — so the pivot is today's crossing.
  // With no supply the layout turns demand about the plot's middle.
  const pivot = d && s ? intersectPolylines(d, s) : d ? ((): Pt | null => {
    const y = interpolateAtX(d, 49);
    return y === null ? null : [49, y];
  })() : null;
  return { curve, pivot };
}

type Kind = "demand" | "supply";
interface State {
  /** The caption last said, so a drag says it once, not once a frame. */
  said: string | null;
}

/** The patch (and its caption) a drag from `from` to `to` makes — the whole
 *  gesture, not a step, so every frame and the release agree. Null: nothing. */
export function dragPatch(id: string, fromL: Pt, from: Pt, to: Pt, scene: WidgetScene): { patch: Record<string, unknown>; caption: string } | null {
  const P = scene.params as SupplyDemandParams;
  const [dq, dp] = [to[0] - from[0], to[1] - from[1]];

  if (id === "ceiling_line" || id === "floor_line") {
    const key = id === "ceiling_line" ? "price_ceiling" : "price_floor";
    const own = P[key] ?? {};
    // The drawn line IS the level (the layout's default is a share of P*).
    const line = market(P).curve(id);
    const level0 = typeof own.level === "number" ? own.level : line ? line[0][1] : null;
    if (level0 === null) return null;
    return { patch: { [key]: { ...own, level: round(clamp(level0 + dp, LEVEL_MIN, LEVEL_MAX)) } }, caption: id === "ceiling_line" ? "Moving the price ceiling" : "Moving the price floor" };
  }

  if (id === "tax_supply_curve" || id === "tax_demand_curve") {
    const tax = P.tax ?? {};
    const perUnit = (tax.kind ?? "per_unit") !== "ad_valorem";
    const buyer = id === "tax_demand_curve";
    const a0 = tax.amount ?? (perUnit ? 18 : 36);
    let a: number;
    if (perUnit) {
      // The seller's curve rides UP by the tax, the buyer's DOWN.
      a = clamp(buyer ? a0 - dp : a0 + dp, -40, 60);
    } else {
      // A percentage: the untaxed price at the grabbed quantity, and the
      // rate that puts the taxed curve where the pointer now is.
      const base = market(P).curve(buyer ? "demand_curve" : "supply_curve");
      const yb = base ? interpolateAtX(base, from[0]) : null;
      if (yb === null || yb < 0.5) return null;
      const target = (buyer ? yb / (1 + a0 / 100) : yb * (1 + a0 / 100)) + dp;
      if (target < 0.5) return null;
      a = clamp(buyer ? (yb / target - 1) * 100 : (target / yb - 1) * 100, -50, 200);
    }
    return { patch: { tax: { ...tax, amount: round(a) } }, caption: "Changing the tax" };
  }

  const shifted = id === "demand_shift_curve" || id === "supply_shift_curve";
  if (!shifted && id !== "demand_curve" && id !== "supply_curve") return null;
  const kind: Kind = id.startsWith("demand") ? "demand" : "supply";
  const curveP = (P[kind] ?? {}) as CurveParams;
  const shiftKey = `${kind}_shift` as const;
  const shift = P[shiftKey];
  const a0 = shift ? (shift.amount ?? ((shift.direction ?? "right") === "right" ? 15 : -15)) : 0;

  // Where along the drawn curve the press landed: its ends turn it.
  const drawn = scene.lines.get(id)?.[0];
  const along = drawn ? nearestAlong(drawn, fromL) : null;
  if (along && (along.t < END_ZONE || along.t > 1 - END_ZONE)) {
    const m = market(P);
    if (!m.pivot) return null;
    // A shifted curve is the turned base moved by the shift, so it turns
    // about the crossing moved with it.
    const [px, py] = shifted ? [m.pivot[0] + a0, m.pivot[1]] : m.pivot;
    // The grabbed point, ON the curve (the press was only near it).
    const g = scene.toDomain(along.at) ?? from;
    const gx = g[0] - px,
      gy = g[1] - py;
    if (Math.abs(gx) < 1e-6 || Math.abs(gy) < 1e-6) return null;
    // The new curve is the line through the pivot and the pointer: its slope
    // over the grabbed one's is how much the x-run scales. Past the pivot's
    // vertical it is as steep as it goes, past its horizontal as flat.
    const sx = (to[0] - px) * Math.sign(gx),
      sy = (to[1] - py) * Math.sign(gy);
    const s0 = elasticityScale(curveP.elasticity);
    const s = sx <= 0.01 ? 0 : sy <= 0.01 ? Infinity : (s0 * Math.abs(gy) * sx) / (Math.abs(gx) * sy);
    return { patch: { [kind]: { ...curveP, elasticity: elasticityOf(s) } }, caption: `Turning ${kind} about the equilibrium` };
  }

  if (shifted) {
    return { patch: { [shiftKey]: { ...shift, amount: round(clamp(a0 + dq, SHIFT_MIN, SHIFT_MAX)) } }, caption: `Shifting ${kind}` };
  }
  // The original curve. With a tax or a price control on the figure, what the
  // viewer sees — the traded quantity, the prices, every shaded area — is
  // read off THIS curve, so it is this curve that must move (its `offset`).
  // On a bare market the original stays where it was as the reference and a
  // shifted copy is pulled off it — D′ (or S′) and E′, the textbook shift.
  if (P.tax || P.price_ceiling || P.price_floor) {
    const o0 = curveP.offset ?? 0;
    return { patch: { [kind]: { ...curveP, offset: round(clamp(o0 + dq, -OFFSET_MAX, OFFSET_MAX)) } }, caption: `Shifting ${kind}` };
  }
  return { patch: { [shiftKey]: { ...(shift ?? {}), amount: round(clamp(dq, SHIFT_MIN, SHIFT_MAX)) } }, caption: `Shifting ${kind}` };
}

export function supplyDemandWidget(): WidgetBody {
  return {
    parts: SD_PARTS,
    live: true,
    init: (): State => ({ said: null }),
    on(event: WidgetEvent, raw: unknown, scene: WidgetScene) {
      const state = (raw ?? { said: null }) as State;
      if (event.type !== "drag_move" && event.type !== "drag") return { state, effects: [] };
      const { from: fromL, fromDomain: from } = event;
      if (!fromL || !from || !event.domain) return { state, effects: [] };
      const r = dragPatch(event.id, fromL, from, event.domain, scene);
      if (!r) return { state, effects: [] };
      const effects: Record<string, unknown>[] = [{ patch: r.patch }];
      if (r.caption !== state.said) effects.push({ caption: r.caption });
      return { state: { said: r.caption }, effects };
    },
  };
}
