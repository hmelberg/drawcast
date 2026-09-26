// Deterministic layout for the supply_demand scene. Works in an internal
// domain of 0–100 × 0–100 mapped onto the plot area; the LLM only supplies
// qualitative parameters.

import { linearScale, plotArea } from "../../layout/canvas";
import { makeAxes } from "../../layout/axes";
import { CURVE_SAMPLES, interpolateAtX, intersectPolylines, qualitativeShape, solveForX } from "../../layout/curves";
import { centroid } from "../../layout/geometry";
import {
  COLORS,
  Z_AREA,
  Z_STROKE,
  Z_TEXT,
  SKETCH_MS,
  defaultDrawOpts,
  defaultStyle,
  type Drawable,
  type Pt,
  type StrokeDrawable,
} from "../../layout/model";
import type { LabelRequest } from "../../layout/labels";
import type { SceneLayout } from "../types";
import { kit } from "../kit";

export interface CurveParams {
  steepness?: "gentle" | "medium" | "steep" | number;
  curvature?: "linear" | "convex" | "concave";
  /** Scales the curve's x-run about the equilibrium — see ELASTICITY. */
  elasticity?: "perfectly_inelastic" | "inelastic" | "unit" | "elastic" | "perfectly_elastic" | number;
  label?: string;
  /** The viewer's drag (widget.ts): the curve itself moved this many domain
   *  units right. Not in the manifest — authors shift with demand_shift. */
  offset?: number;
}

export interface ShiftParams {
  direction?: "right" | "left";
  amount?: number;
  label?: string;
  /** Which way the shift arrow points (see shiftArrow). Default "horizontal". */
  arrow?: "horizontal" | "vertical" | "perpendicular";
}

export interface SupplyDemandParams {
  x_label?: string;
  y_label?: string;
  demand?: CurveParams;
  /** null = draw no supply curve */
  supply?: CurveParams | null;
  equilibrium?: { show?: boolean; label?: string; guides?: boolean; q_label?: string; p_label?: string };
  demand_shift?: ShiftParams;
  supply_shift?: ShiftParams;
  /** How a changed market's names are marked: "prime" D′ E′ P*′ (default) or
   *  "index" D₁ → D₂, E₁ → E₂, P₁ → P₂ — the textbook form that keeps
   *  counting when a figure changes more than once. */
  numbering?: "prime" | "index";
  tax?: {
    amount?: number;
    side?: "seller" | "buyer";
    kind?: "per_unit" | "ad_valorem";
    label?: string;
  };
  price_ceiling?: { level?: number; label?: string; show_shortage?: boolean };
  price_floor?: { level?: number; label?: string; show_surplus?: boolean };
  regions?: ("consumer_surplus" | "producer_surplus" | "deadweight_loss" | "government_revenue" | "transfer")[];
  /** Real numbers for the 0–100 axes, for `values` and the readout only —
   *  every other param stays on the 0–100 scale. */
  units?: { price?: [number, number]; quantity?: [number, number]; price_unit?: string; quantity_unit?: string };
  /** Which computed values to show as a small labelled panel (READOUT_KEYS). */
  readout?: string[];
}

/**
 * What a market lesson wants to SEE while the viewer changes the market (Hans
 * 2026-09-26: "the numbers/results … some standard way to present them"). The
 * keys of SceneLayout.values, and the lines a readout can show — in this
 * order of meaning, not of drawing: the author's `readout` list sets that.
 */
export const READOUT_KEYS = [
  "price", "quantity", "price_new", "quantity_new", "qd", "qs", "quantity_traded", "price_buyers", "price_sellers",
  "cs", "ps", "dwl", "revenue", "transfer", "shortage", "surplus",
] as const;
type ReadoutKey = (typeof READOUT_KEYS)[number];

/** What each value is measured in, so units can scale it and the readout suffix it. */
const VALUE_KIND: Record<ReadoutKey, "price" | "quantity" | "area"> = {
  price: "price", price_new: "price", price_buyers: "price", price_sellers: "price",
  quantity: "quantity", quantity_new: "quantity", qd: "quantity", qs: "quantity", quantity_traded: "quantity", shortage: "quantity", surplus: "quantity",
  cs: "area", ps: "area", dwl: "area", revenue: "area", transfer: "area",
};

/** The readout's line names: English, and Norwegian for a Norwegian cast (most of Hans's are). */
const VALUE_NAME: Record<ReadoutKey, { en: string; nb: string }> = {
  price: { en: "Price", nb: "Pris" },
  quantity: { en: "Quantity", nb: "Mengde" },
  price_new: { en: "New price", nb: "Ny pris" },
  quantity_new: { en: "New quantity", nb: "Ny mengde" },
  qd: { en: "Quantity demanded", nb: "Etterspurt mengde" },
  qs: { en: "Quantity supplied", nb: "Tilbudt mengde" },
  quantity_traded: { en: "Quantity traded", nb: "Omsatt mengde" },
  price_buyers: { en: "Buyers pay", nb: "Kjøperne betaler" },
  price_sellers: { en: "Sellers get", nb: "Selgerne får" },
  cs: { en: "Consumer surplus", nb: "Konsumentoverskudd" },
  ps: { en: "Producer surplus", nb: "Produsentoverskudd" },
  dwl: { en: "Deadweight loss", nb: "Dødvektstap" },
  revenue: { en: "Tax revenue", nb: "Skatteinntekter" },
  transfer: { en: "Transfer", nb: "Overføring" },
  shortage: { en: "Shortage", nb: "Mangel" },
  surplus: { en: "Surplus", nb: "Overskudd" },
};

const D0 = 2;
const D1 = 96; // usable slice of the 0–100 domain, keeps arrowheads clear

const ELASTICITY: Record<string, number> = {
  perfectly_inelastic: 0.06,
  inelastic: 0.5,
  unit: 1,
  elastic: 1.5,
  perfectly_elastic: 1.94,
};

/**
 * `steepness` widens a curve's Y-SPAN, which is why it saturates at k ≈ 1.05
 * (curves.ts): the span hits the plot edges. `elasticity` scales the X-RUN
 * about the equilibrium instead, which has no ceiling — e = 0 would be
 * vertical and e = 2 horizontal.
 *
 * e is CLAMPED to [0.06, 1.94] and the clamp is not cosmetic: at the open
 * ends the polyline stops being a function of x, and interpolateAtX,
 * solveForX and intersectPolylines all assume that it is. 0.06 still reads
 * as vertical (a 4.4-unit x-run over the full height) and 1.94 as horizontal
 * (4 units of height across the plot). Do not widen it.
 */
function elasticityFactor(e: CurveParams["elasticity"]): number {
  const raw = typeof e === "number" ? e : ELASTICITY[e ?? "unit"] ?? 1;
  const clamped = Math.max(0.06, Math.min(1.94, raw));
  // Math.tan(Math.PI / 4) is 0.9999999999999999, NOT 1, so the unit case must
  // short-circuit: scaleXAbout's `s === 1` identity guard would otherwise never
  // fire for the default elasticity, and byte-identity with every existing
  // figure would rest on floating-point coincidence rather than on this line.
  return clamped === 1 ? 1 : Math.tan((clamped * Math.PI) / 4);
}

/**
 * The curve with its x-run scaled by `s` about `px`, RESAMPLED over the range
 * it now occupies. Resampling rather than transforming the points is what
 * keeps both extremes usable: a straight map would leave ~3 points inside the
 * plot at either end of the range.
 */
function scaleXAbout(pts: Pt[], px: number, s: number): Pt[] {
  if (s === 1) return pts; // exact identity — every existing figure is untouched
  const xs = pts.map(([x]) => x);
  const lo = Math.max(D0, px + (Math.min(...xs) - px) * s);
  const hi = Math.min(D1, px + (Math.max(...xs) - px) * s);
  if (!(hi > lo)) return pts;
  const out: Pt[] = [];
  for (let i = 0; i <= CURVE_SAMPLES; i++) {
    const x = lo + ((hi - lo) * i) / CURVE_SAMPLES;
    const y = interpolateAtX(pts, px + (x - px) / s);
    if (y !== null) out.push([x, y]);
  }
  return out.length >= 2 ? out : pts;
}

interface Ctx {
  sx: (v: number) => number;
  sy: (v: number) => number;
  toLogical: (pts: Pt[]) => Pt[];
}

/**
 * A tax, a subsidy, a price ceiling and a price floor are the same object: a
 * quantity actually traded, and the two prices the two sides face. Every
 * welfare region is computed from this and nothing else, which is why there is
 * no per-intervention branch further down.
 */
interface Intervention {
  kind: "none" | "tax" | "ceiling" | "floor";
  qTraded: number;
  pBuyers: number;
  pSellers: number;
}

export function layoutSupplyDemand(params: SupplyDemandParams): SceneLayout {
  // A readout gets its own column right of the plot, and the plot gives up
  // that width. Inside the plot there is no corner a five-line panel can
  // count on: the wedge right of the equilibrium is narrow, the top is where
  // the taxed curve sweeps and the floor sits (checked on the frames harness,
  // 2026-09-26). A narrower plot is still a market; a panel over E is not.
  const readout = readoutColumn(params.readout, params.units ?? {});
  const full = plotArea();
  const plot = readout ? { ...full, x1: full.x1 - readout.w - READOUT_GAP } : full;
  const sx = linearScale([0, 100], [plot.x0, plot.x1]);
  const sy = linearScale([0, 100], [plot.y0, plot.y1]);
  const ctx: Ctx = { sx, sy, toLogical: (pts) => pts.map(([x, y]): Pt => [sx(x), sy(y)]) };

  const drawables: Drawable[] = [];
  const labels: LabelRequest[] = [];
  const anchors: Record<string, Pt> = {};
  const order: string[] = [];
  // Logical polylines for every curve-like stroke, so spec-level regions and
  // intersections can reference scene curves (seeded into tier-2).
  const curveSamples: Record<string, Pt[]> = {};
  const recordCurve = (id: string, domainPts: Pt[]) => {
    curveSamples[id] = ctx.toLogical(domainPts);
  };

  const push = (d: Drawable) => {
    drawables.push(d);
    order.push(d.id);
  };
  const attached: Record<string, string[]> = {};
  const groups: Record<string, string[]> = {};

  // `of` is the element the label NAMES: it then follows that element's move,
  // fades when it fades, and stays lit when a focus keeps it (scenes/types.ts
  // `attached`). Without it the planner can only guess from the id, and
  // `label_S` beside `supply_curve` is not a guess it can make.
  const label = (id: string, anchor: Pt, side: LabelRequest["side"], text: string, color: string = COLORS.ink, of?: string) => {
    labels.push({
      id,
      anchor,
      side,
      text,
      fontSize: 28,
      style: defaultStyle({ color }),
      drawOpts: defaultDrawOpts("instant"),
    });
    anchors[id] = anchor;
    order.push(id);
    if (of) attached[of] = [...(attached[of] ?? []), id];
  };

  push(makeAxes("axes", plot, params.x_label ?? "Quantity (Q)", params.y_label ?? "Price (P)"));

  // The names of the market before and after a change. "index" numbers them
  // (D₁ → D₂) so a second change can be a third number rather than a D″.
  const indexed = params.numbering === "index";
  const name = {
    // Only what changes is numbered: an unshifted supply stays plain S.
    D: indexed && params.demand_shift ? "D₁" : "D",
    S: indexed && params.supply_shift ? "S₁" : "S",
    E: indexed ? "E₁" : "E",
    P: indexed ? "P₁" : "P*",
    Q: indexed ? "Q₁" : "Q*",
    D2: indexed ? "D₂" : "D′",
    S2: indexed ? "S₂" : "S′",
    E2: indexed ? "E₂" : "E′",
    P2: indexed ? "P₂" : "P*′",
    Q2: indexed ? "Q₂" : "Q*′",
  };

  // Curves in domain space (0–100 both axes). Elasticity scales each curve's
  // x-run about the crossing of the UN-elasticized pair, so changing either
  // elasticity provably cannot move the equilibrium — which is what makes the
  // tax-incidence comparison honest.
  const demandBase = shapedCurve("decreasing", params.demand);
  const supplyBase = params.supply === null ? null : shapedCurve("increasing", params.supply ?? {});
  const pivot = supplyBase ? intersectPolylines(demandBase, supplyBase) : null;
  const px = pivot ? pivot[0] : (D0 + D1) / 2;
  const demandPts = scaleXAbout(demandBase, px, elasticityFactor(params.demand?.elasticity));
  const supplyPts = supplyBase ? scaleXAbout(supplyBase, px, elasticityFactor(params.supply?.elasticity)) : null;

  push(curve("demand_curve", demandPts, COLORS.demand, ctx));
  recordCurve("demand_curve", demandPts);
  anchors["demand_curve"] = ctx.toLogical([demandPts[demandPts.length - 1]])[0];
  label("label_D", anchors["demand_curve"], "right", params.demand?.label ?? name.D, COLORS.demand, "demand_curve");

  let eq: Pt | null = null;
  if (supplyPts) {
    push(curve("supply_curve", supplyPts, COLORS.supply, ctx));
    recordCurve("supply_curve", supplyPts);
    anchors["supply_curve"] = ctx.toLogical([supplyPts[supplyPts.length - 1]])[0];
    label("label_S", anchors["supply_curve"], "right", params.supply?.label ?? name.S, COLORS.supply, "supply_curve");

    eq = intersectPolylines(demandPts, supplyPts);
    if (eq && params.equilibrium?.show !== false) {
      const eqL = ctx.toLogical([eq])[0];
      if (params.equilibrium?.guides !== false) {
        push(guides("guide_lines", eq, ctx, plot));
      }
      push(dot("equilibrium_point", eqL));
      anchors["equilibrium_point"] = eqL;
      label("label_E", eqL, "above-right", params.equilibrium?.label ?? name.E, COLORS.ink, "equilibrium_point");
      label("label_Pstar", [plot.x0, eqL[1]], "left", params.equilibrium?.p_label ?? name.P, COLORS.ink, "equilibrium_point");
      label("label_Qstar", [eqL[0], plot.y0], "below", params.equilibrium?.q_label ?? name.Q, COLORS.ink, "equilibrium_point");
    }
  }

  // Shifted curves
  const shiftedDomain: Record<string, Pt[]> = {};
  for (const [kind, base, shift] of [
    ["demand", demandPts, params.demand_shift],
    ["supply", supplyPts, params.supply_shift],
  ] as const) {
    if (!shift || !base) continue;
    // Clamp (never skip): an extreme amount would filter out every shifted
    // point below and leave `shifted` empty, crashing the last-point lookups
    // that follow — and the animate machinery depends on these ids staying
    // stable across every layout call.
    const dx = Math.max(-93, Math.min(95, shift.amount ?? ((shift.direction ?? "right") === "right" ? 15 : -15)));
    // drop (not clamp) points shifted past the plot edge, so the curve keeps its slope
    const shifted = base.map(([x, y]): Pt => [x + dx, y]).filter(([x]) => x >= D0 - 1 && x <= D1 + 3);
    shiftedDomain[`${kind}_shift_curve`] = shifted;
    push(curve(`${kind}_shift_curve`, shifted, COLORS.shifted, ctx));
    recordCurve(`${kind}_shift_curve`, shifted);
    const endL = ctx.toLogical([shifted[shifted.length - 1]])[0];
    anchors[`${kind}_shift_curve`] = endL;
    label(`label_${kind === "demand" ? "D" : "S"}_shift`, endL, "right", shift.label ?? (kind === "demand" ? name.D2 : name.S2), COLORS.shifted, `${kind}_shift_curve`);
    push({
      id: `${kind}_shift_arrow`,
      kind: "stroke",
      pts: clearOfCurves(shiftArrow(kind, base, dx, shift.arrow ?? "horizontal", ctx)),
      z: Z_STROKE,
      style: defaultStyle({ color: COLORS.guide, strokeWidth: 3 }),
      drawOpts: defaultDrawOpts("sketch", SKETCH_MS.arrow),
      ...(Math.abs(dx) >= 2 ? { arrowhead: "end" as const } : {}),
    });
  }

  // New equilibrium after a single shift: E' glides as the curve slides.
  // Found even when the marker is hidden — the values still want it.
  const shifts = [params.demand_shift, params.supply_shift].filter(Boolean);
  const eqS =
    shifts.length === 1 && supplyPts
      ? params.demand_shift
        ? intersectPolylines(shiftedDomain["demand_shift_curve"]!, supplyPts)
        : intersectPolylines(demandPts, shiftedDomain["supply_shift_curve"]!)
      : null;
  if (params.equilibrium?.show !== false) {
    if (eqS) {
      const eqSL = ctx.toLogical([eqS])[0];
      push(guides("shift_guide_lines", eqS, ctx, plot));
      push(dot("shift_equilibrium_point", eqSL));
      anchors["shift_equilibrium_point"] = eqSL;
      label("label_E_shift", eqSL, "above-right", name.E2, COLORS.ink, "shift_equilibrium_point");
      label("label_P_shift", [plot.x0, eqSL[1]], "left", name.P2, COLORS.ink, "shift_equilibrium_point");
      label("label_Q_shift", [eqSL[0], plot.y0], "below", name.Q2, COLORS.ink, "shift_equilibrium_point");
    }
  }

  // Tax / subsidy. The taxed curve shifts; then Q_t is the new crossing and
  // the two prices are read off the ORIGINAL curves at Q_t. That last step is
  // what makes per-unit and ad valorem, seller-side and buyer-side, one path:
  // P_s = P_b − t holds only for a per-unit tax, but "evaluate the untaxed
  // curve at Q_t" holds for all four.
  let iv: Intervention = eq
    ? { kind: "none", qTraded: eq[0], pBuyers: eq[1], pSellers: eq[1] }
    : { kind: "none", qTraded: 0, pBuyers: 0, pSellers: 0 };

  if (params.tax && supplyPts && eq) {
    const perUnit = (params.tax.kind ?? "per_unit") !== "ad_valorem";
    const amount = perUnit
      ? Math.max(-40, Math.min(60, params.tax.amount ?? 18))
      : Math.max(-50, Math.min(200, params.tax.amount ?? 36));
    const buyerSide = params.tax.side === "buyer";
    const shift = (y: number, up: boolean): number =>
      perUnit ? y + (up ? amount : -amount) : up ? y * (1 + amount / 100) : y / (1 + amount / 100);

    const moved = (buyerSide ? demandPts : supplyPts).map(([x, y]): Pt => [x, shift(y, !buyerSide)]);
    const kept = moved.filter(([, y]) => y >= 2 && y <= 98);
    // Dropping the off-plot points (the existing idiom) keeps the slope, but a
    // big enough tax pushes the WHOLE curve off and leaves nothing — and
    // `shifted[shifted.length - 1]` below would throw on an empty array. In
    // that one case clamp instead: the curve pins to the plot edge, stays in
    // bounds, finds no crossing, and the figure simply shows no new
    // equilibrium. Never an early return — the price controls and the regions
    // further down must still draw.
    const shifted = kept.length >= 2 ? kept : moved.map(([x, y]): Pt => [x, Math.max(2, Math.min(98, y))]);
    const id = buyerSide ? "tax_demand_curve" : "tax_supply_curve";
    const color = buyerSide ? COLORS.demand : COLORS.supply;
    push({ ...curve(id, shifted, color, ctx), style: defaultStyle({ color, strokeWidth: 4.5, dash: true }) });
    recordCurve(id, shifted);
    const endL = ctx.toLogical([shifted[shifted.length - 1]])[0];
    anchors[id] = endL;
    label(
      buyerSide ? "label_D_tax" : "label_S_tax",
      endL,
      "above-left",
      params.tax.label ?? (buyerSide ? "D − tax" : "S + tax"),
      color,
      id,
    );

    const eq2 = buyerSide ? intersectPolylines(shifted, supplyPts) : intersectPolylines(demandPts, shifted);
    if (eq2) {
      const qT = eq2[0];
      const pB = interpolateAtX(demandPts, qT);
      const pS = interpolateAtX(supplyPts, qT);
      if (pB !== null && pS !== null) {
        iv = { kind: "tax", qTraded: qT, pBuyers: pB, pSellers: pS };
        // Every downstream point is read off `iv` from here on, not off the
        // raw qT/pB/pS locals: iv is the single source of truth Tasks 3 and 4
        // extend to price controls and welfare regions.
        push(guides("tax_guide_lines", [iv.qTraded, iv.pBuyers], ctx, plot));
        const pbL = ctx.toLogical([[iv.qTraded, iv.pBuyers]])[0];
        const psL = ctx.toLogical([[iv.qTraded, iv.pSellers]])[0];
        push(dot("tax_equilibrium_point", pbL));
        anchors["tax_equilibrium_point"] = pbL;
        push(dot("price_buyers_point", pbL));
        anchors["price_buyers_point"] = pbL;
        push(dot("price_sellers_point", psL));
        anchors["price_sellers_point"] = psL;
        const subsidy = amount < 0;
        label("label_Pb", [plot.x0, pbL[1]], "left", subsidy ? "P paid" : "P buyers", COLORS.demand, "price_buyers_point");
        label("label_Ps", [plot.x0, psL[1]], "left", subsidy ? "P received" : "P sellers", COLORS.supply, "price_sellers_point");
      }
    }
  }

  // Price controls. Both resolve to the same Intervention as the tax: the
  // quantity actually traded is the SHORT side, and both sides face one price,
  // so the wedge rectangle is zero-height and Task 4 skips it automatically.
  // The control as the VALUES see it: set whether or not it binds, so a
  // readout line keeps its place (at zero) while a slider crosses equilibrium.
  let control: { kind: "ceiling" | "floor"; binds: boolean; p: number } | null = null;
  if (params.price_ceiling && eq && supplyPts) {
    const pc = Math.max(2, Math.min(96, params.price_ceiling.level ?? eq[1] * 0.62));
    addPriceLine("ceiling", pc, params.price_ceiling.label ?? "Price ceiling");
    const binds = pc < eq[1];
    control = { kind: "ceiling", binds, p: pc };
    const qs = binds ? solveForX(supplyPts, pc) : null;
    if (binds && qs !== null) {
      if (iv.kind === "none") iv = { kind: "ceiling", qTraded: qs, pBuyers: pc, pSellers: pc };
      if (params.price_ceiling.show_shortage !== false) {
        addGap("shortage", pc, solveForX(demandPts, pc), qs, "Shortage");
      }
    }
  }

  if (params.price_floor && eq && supplyPts) {
    const pf = Math.max(2, Math.min(96, params.price_floor.level ?? Math.min(eq[1] * 1.35, 92)));
    addPriceLine("floor", pf, params.price_floor.label ?? "Price floor");
    const binds = pf > eq[1];
    if (!control) control = { kind: "floor", binds, p: pf };
    const qd = binds ? solveForX(demandPts, pf) : null;
    if (binds && qd !== null) {
      if (iv.kind === "none") iv = { kind: "floor", qTraded: qd, pBuyers: pf, pSellers: pf };
      if (params.price_floor.show_surplus !== false) {
        addGap("surplus", pf, qd, solveForX(supplyPts, pf), "Surplus");
      }
    }
  }

  // Every shaded area, computed against whatever intervention resolved above.
  // Nothing here asks WHICH intervention it is — that is the point of §5's
  // single { qTraded, pBuyers, pSellers }.
  if (params.regions?.length && eq && supplyPts) {
    const want = new Set(params.regions);
    const { qTraded, pBuyers, pSellers } = iv;
    const [qStar, pStar] = eq;
    // ONE left edge for the whole block. The regions deliberately start at the
    // domain edge rather than at quantity 0 (that convention is why the
    // identity closes so tightly), but `elasticity < 1` shrinks a curve's
    // x-run about the equilibrium, so a curve can begin well to the RIGHT of
    // D0 — e.g. demand.elasticity 0.5 leaves demand defined only over
    // [29.5, 68.5]. Closing at D0 there ran a fabricated straight edge from
    // the curve's first point down to the price axis, shading area no curve
    // bounds (measured: 19.5 % of total surplus for perfectly_inelastic).
    //
    // It must be SHARED, not computed per region: CS, PS and the wedge only
    // add up to ∫(D − S) when all three span the SAME interval. Give CS the
    // demand curve's own start and PS the supply curve's own start and the
    // areas stop tiling as soon as the two elasticities differ, so the
    // welfare identity breaks by the width of the mismatch.
    const qLeft = Math.max(D0, demandPts[0][0], supplyPts[0][0]);
    // Nothing to shade: the traded quantity is left of where both curves
    // exist (a ceiling on inelastic demand does this). Shading it anyway
    // shipped a zero-area two-point "area" that rendered as a bare line.
    const shadeable = qTraded > qLeft;

    if (want.has("consumer_surplus") && shadeable) {
      const upper = spanFrom(demandPts, qLeft, qTraded);
      const pts = ctx.toLogical(simplify([...upper, [qTraded, pBuyers], [qLeft, pBuyers]]));
      push(area("cs_region", pts, COLORS.region1));
      anchors["cs_region"] = centroid(pts);
      label("label_CS", anchors["cs_region"], "above-right", "Consumer surplus", COLORS.ink, "cs_region");
    }

    if (want.has("producer_surplus") && shadeable) {
      const lower = spanFrom(supplyPts, qLeft, qTraded);
      const pts = ctx.toLogical(simplify([[qLeft, pSellers], [qTraded, pSellers], ...lower.reverse()]));
      push(area("ps_region", pts, COLORS.region2));
      anchors["ps_region"] = centroid(pts);
      label("label_PS", anchors["ps_region"], "below-right", "Producer surplus", COLORS.ink, "ps_region");
    }

    // qLeft clamps the interval here too — when qTraded is left of it the
    // deadweight loss is the WHOLE of [qLeft, qStar], which is exactly what
    // the two skipped surpluses gave up.
    if (want.has("deadweight_loss") && Math.abs(qTraded - qStar) > 0.5) {
      const region = betweenRegion(demandPts, supplyPts, Math.max(qLeft, Math.min(qTraded, qStar)), Math.max(qTraded, qStar));
      if (region) {
        const pts = ctx.toLogical(region);
        push({
          id: "dwl_region",
          kind: "area",
          pts,
          z: Z_AREA,
          style: defaultStyle({ color: COLORS.regionLoss, fill: COLORS.regionLoss, opacity: 0.5, strokeWidth: 1 }),
          drawOpts: defaultDrawOpts("sketch", SKETCH_MS.region),
        });
        anchors["dwl_region"] = centroid(pts);
        label("label_DWL", anchors["dwl_region"], "right", "Deadweight loss", COLORS.regionLoss, "dwl_region");
      }
    }

    // Zero-height for a price control, where both sides face one price, so
    // this skips itself without a branch on iv.kind.
    if (want.has("government_revenue") && shadeable && Math.abs(pBuyers - pSellers) > 0.5) {
      const pts = ctx.toLogical([[qLeft, pSellers], [qTraded, pSellers], [qTraded, pBuyers], [qLeft, pBuyers]]);
      push(area("wedge_region", pts, COLORS.accent));
      anchors["wedge_region"] = centroid(pts);
      // The wedge spans the WHOLE traded quantity (qLeft to qTraded, not a
      // sliver near the crossing), so its horizontal centroid sits under the
      // untaxed guide_lines (at pStar) and its right edge grazes the with-tax
      // guides — label the wedge's upper band instead (between pStar and
      // pBuyers), the one strip a busy figure with both curves, both guide
      // sets and a deadweight-loss region leaves clear.
      label(
        "label_wedge",
        ctx.toLogical([[(qLeft + qTraded) / 2, (pStar + pBuyers) / 2]])[0],
        "above",
        // The readout's own words (VALUE_NAME), which are also shorter: at
        // "Government revenue" the label outgrew a narrow wedge and landed on
        // both curves (2026-09-26).
        pBuyers > pSellers ? "Tax revenue" : "Subsidy cost",
        COLORS.accent,
        "wedge_region",
      );
    }

    // A transfer exists when both sides face ONE price (so there is no wedge)
    // and that price differs from the free-market one — which is true for a
    // binding ceiling or floor and false for a tax, without asking which.
    if (want.has("transfer") && shadeable && Math.abs(pBuyers - pSellers) <= 0.5 && Math.abs(pStar - pBuyers) > 0.5) {
      const pts = ctx.toLogical([[qLeft, pStar], [qTraded, pStar], [qTraded, pBuyers], [qLeft, pBuyers]]);
      push(area("transfer_region", pts, COLORS.accent));
      anchors["transfer_region"] = centroid(pts);
      label("label_transfer", anchors["transfer_region"], "right", "Transfer", COLORS.accent, "transfer_region");
    }
  }

  // The numbers behind the picture, in the author's units. Computed on every
  // layout, so an animate or a slider drag carries them along frame by frame.
  const values =
    eq && supplyPts
      ? marketValues({ demandPts, supplyPts, eq, eqNew: eqS, iv, taxed: iv.kind === "tax", control }, params.units)
      : {};
  if (readout) addReadout(readout, values);

  return { drawables, labels, anchors, order, curveSamples, attached, groups, values, frame: { x: [0, 100], y: [0, 100], box: plot } };

  /**
   * The standard way to SHOW the numbers: one labelled line per key, names
   * left and values right-aligned, in a column beside the plot. Each
   * line is `readout_<key>` so a beat can draw or highlight it alone;
   * `readout` names them all. A key with no value right now (a shortage with
   * no ceiling) keeps its line with a dash, so ids never come and go
   * between frames.
   */
  function addReadout(col: ReadoutColumn, v: Record<string, number>) {
    const { keys, w, FONT, LINE } = col;
    const units = params.units ?? {};
    // Beside the plot, past the room its curve names take at the right end,
    // centred on the plot's height — between S's name at the top and D's at
    // the bottom.
    const x0 = plot.x1 + READOUT_GAP;
    const top = (plot.y0 + plot.y1) / 2 + (keys.length * LINE) / 2;
    const box = { x0, x1: x0 + w, y1: top };
    const members: string[] = [];
    keys.forEach((k, i) => {
      const id = `readout_${k}`;
      const y = box.y1 - FONT * 0.9 - i * LINE;
      const raw = v[k];
      const text = raw === undefined ? "—" : formatValue(k === "revenue" ? Math.abs(raw) : raw, VALUE_KIND[k], units);
      const line = (sub: string, pos: Pt, t: string, anchor: "start" | "end"): Drawable => ({
        id: `${id}_${sub}`,
        kind: "text",
        pos,
        text: t,
        fontSize: FONT,
        anchor,
        z: Z_TEXT,
        style: defaultStyle({ color: COLORS.ink }),
        drawOpts: defaultDrawOpts("sketch", SKETCH_MS.text),
      });
      push({
        id,
        kind: "group",
        children: [line("name", [box.x0, y], readoutName(k, v), "start"), line("value", [box.x1, y], text, "end")],
        z: Z_TEXT,
        style: defaultStyle({ color: COLORS.ink }),
        drawOpts: defaultDrawOpts("sketch", SKETCH_MS.text),
      });
      members.push(id);
    });
    groups["readout"] = members;
  }

  function addPriceLine(kind: "ceiling" | "floor", p: number, text: string) {
    const pts = ctx.toLogical([
      [D0, p],
      [D1, p],
    ]);
    push({
      id: `${kind}_line`,
      kind: "stroke",
      pts,
      z: Z_STROKE,
      style: defaultStyle({ color: COLORS.accent, strokeWidth: 4, dash: true }),
      drawOpts: defaultDrawOpts("sketch", SKETCH_MS.priceLine),
    });
    anchors[`${kind}_line`] = pts[1];
    recordCurve(`${kind}_line`, [
      [D0, p],
      [D1, p],
    ]);
    label(`label_${kind}`, pts[1], "above-left", text, COLORS.accent, `${kind}_line`);
  }

  function addGap(kind: "shortage" | "surplus", p: number, qd: number | null, qs: number | null, text: string) {
    if (qd === null || qs === null) return;
    const [qa, qb] = qd < qs ? [qd, qs] : [qs, qd];
    // One guide per quantity, each up from the axis to the price line, with
    // its own name on the axis — so a cast can say "at this price buyers want
    // THIS many" and "sellers offer only THIS many" as two beats, and only
    // then open the gap. `${kind}_guides` still names both at once.
    for (const [which, q, text] of [["qd", qd, "Qd"], ["qs", qs, "Qs"]] as const) {
      const id = `${kind}_guide_${which}`;
      const pts = ctx.toLogical([
        [q, 0],
        [q, p],
      ]);
      push({
        id,
        kind: "stroke",
        pts,
        z: Z_STROKE,
        style: defaultStyle({ color: COLORS.guide, strokeWidth: 2.5, dash: true, roughness: 0.9 }),
        drawOpts: defaultDrawOpts("sketch", SKETCH_MS.guides),
      });
      anchors[id] = pts[1];
      label(`label_${which === "qd" ? "Qd" : "Qs"}`, pts[0], "below", text, which === "qd" ? COLORS.demand : COLORS.supply, id);
    }
    groups[`${kind}_guides`] = [`${kind}_guide_qd`, `${kind}_guide_qs`];
    const arrowY = kind === "shortage" ? p * 0.45 : Math.min(p * 1.12, 96);
    const arrowPts = ctx.toLogical([
      [qa, arrowY],
      [qb, arrowY],
    ]);
    push({
      id: `${kind}_arrow`,
      kind: "stroke",
      pts: arrowPts,
      arrowhead: "both",
      z: Z_STROKE,
      style: defaultStyle({ color: COLORS.accent, strokeWidth: 3.5 }),
      drawOpts: defaultDrawOpts("sketch", SKETCH_MS.arrow),
    });
    const mid: Pt = [(arrowPts[0][0] + arrowPts[1][0]) / 2, arrowPts[0][1]];
    anchors[`${kind}_arrow`] = mid;
    label(`label_${kind}`, mid, kind === "shortage" ? "below" : "above", text, COLORS.accent, `${kind}_arrow`);
  }
}

function shapedCurve(direction: "increasing" | "decreasing", p: CurveParams | undefined): Pt[] {
  const shape = qualitativeShape(direction, p?.curvature ?? "linear", p?.steepness ?? "medium");
  const pts = shape.map(([tx, ty]): Pt => [D0 + (D1 - D0) * tx, ty * 100]);
  // `offset` moves the curve ITSELF (widget.ts: a drag on a figure with a
  // tax or a price control, whose regions read off this curve). Off-plot
  // points are dropped as for a shifted curve, so the slope is kept.
  const off = Math.max(-60, Math.min(60, p?.offset ?? 0));
  if (off === 0) return pts; // exact identity — every existing figure is untouched
  const moved = pts.map(([x, y]): Pt => [x + off, y]).filter(([x]) => x >= D0 && x <= D1);
  return moved.length >= 2 ? moved : pts;
}

function curve(id: string, domainPts: Pt[], color: string, ctx: Ctx): StrokeDrawable {
  return {
    id,
    kind: "stroke",
    pts: ctx.toLogical(domainPts),
    z: Z_STROKE,
    style: defaultStyle({ color, strokeWidth: 4.5 }),
    drawOpts: defaultDrawOpts("sketch", SKETCH_MS.curve),
  };
}

function dot(id: string, c: Pt): StrokeDrawable {
  return {
    id,
    kind: "stroke",
    pts: [c],
    shapeHint: { type: "circle", c, r: 7 },
    z: Z_STROKE,
    style: defaultStyle({ strokeWidth: 3, fill: COLORS.ink }),
    drawOpts: defaultDrawOpts("sketch", SKETCH_MS.dot),
  };
}

function guides(id: string, domainPt: Pt, ctx: Ctx, plot: ReturnType<typeof plotArea>): StrokeDrawable {
  const p = ctx.toLogical([domainPt])[0];
  return {
    id,
    kind: "stroke",
    pts: [
      [plot.x0, p[1]],
      p,
      [p[0], plot.y0],
    ],
    z: Z_STROKE,
    style: defaultStyle({ color: COLORS.guide, strokeWidth: 2.5, dash: true, roughness: 0.9 }),
    drawOpts: defaultDrawOpts("sketch", SKETCH_MS.guides),
  };
}

function area(id: string, pts: Pt[], color: string): Drawable {
  return {
    id,
    kind: "area",
    pts,
    z: Z_AREA,
    style: defaultStyle({ color, fill: color, opacity: 0.5, strokeWidth: 1 }),
    drawOpts: defaultDrawOpts("sketch", SKETCH_MS.region),
  };
}

/**
 * The curve's own sample points over [x0, x1], with exact points AT both ends
 * spliced in where the samples do not already land there.
 *
 * Filtering alone would leave each region's edges on the nearest sample
 * INSIDE the interval, and the sample spacing is not small next to a narrow
 * interval: an inelastic curve traded near its own equilibrium can leave no
 * sample at all between the two bounds, and the polygon then closes with a
 * chord that cuts the corner off. That is invisible for a tax (there
 * pBuyers IS D(qTraded) and pSellers IS S(qTraded), so the corner is already
 * on the curve) and up to 12 % of total surplus for a price control, where
 * the two sides face a control price the curve does not pass through.
 */
function spanFrom(pts: Pt[], x0: number, x1: number): Pt[] {
  const inner = pts.filter(([x]) => x >= x0 && x <= x1);
  const out = [...inner];
  if (!(inner.length > 0 && inner[0][0] - x0 < 1e-9)) {
    const y0 = interpolateAtX(pts, x0);
    if (y0 !== null) out.unshift([x0, y0]);
  }
  if (!(inner.length > 0 && x1 - inner[inner.length - 1][0] < 1e-9)) {
    const y1 = interpolateAtX(pts, x1);
    if (y1 !== null) out.push([x1, y1]);
  }
  return out;
}

/**
 * Consecutive coincident vertices dropped (and a last one coinciding with the
 * first). A tax's surplus polygon meets its closing price exactly ON the
 * curve, so `spanFrom`'s endpoint and the price corner are the same point
 * there — bit for bit, both being the same `interpolateAtX` call. Dropping
 * the doubled vertex keeps every existing figure byte-identical.
 *
 * EXACT equality, not a tolerance, and that is load-bearing: in the free
 * market the traded quantity lands one ulp off a curve sample (q* = 49 IS a
 * sample), and a tolerant compare would swallow that pre-existing pair and
 * move the CS/PS label anchors — `centroid` averages vertices, so dropping
 * one shifts it. Only the genuinely-identical vertex this function adds is
 * removed again.
 */
function simplify(pts: Pt[]): Pt[] {
  const same = (a: Pt, b: Pt) => a[0] === b[0] && a[1] === b[1];
  const out: Pt[] = [];
  for (const p of pts) if (out.length === 0 || !same(out[out.length - 1], p)) out.push(p);
  while (out.length > 1 && same(out[0], out[out.length - 1])) out.pop();
  return out;
}

function betweenRegion(a: Pt[], b: Pt[], x0: number, x1: number): Pt[] | null {
  if (x1 <= x0) return null;
  const N = 24;
  const upper: Pt[] = [];
  const lower: Pt[] = [];
  for (let i = 0; i <= N; i++) {
    const x = x0 + ((x1 - x0) * i) / N;
    const ya = interpolateAtX(a, x);
    const yb = interpolateAtX(b, x);
    if (ya === null || yb === null) continue;
    upper.push([x, ya]);
    lower.push([x, yb]);
  }
  if (upper.length < 2) return null;
  return [...upper, ...lower.reverse()];
}

/**
 * The shift arrow, in logical coordinates: from a point on the old curve to
 * the new one, at a place both curves reach and away from the crossing
 * (where it vanished under E and E′ — 2026-09-26).
 *
 *  - "horizontal" (default): the same PRICE on both curves, so the arrow's
 *    length is the shift itself — "at every price, buyers want more".
 *  - "vertical": the same QUANTITY — "for the same amount, buyers will now
 *    pay more" (a change in willingness to pay, a cost shock on supply).
 *  - "perpendicular": square to the old curve, the plainest "the whole line
 *    moved out" when the axes are not the point.
 *
 * It used to join the two curves' middle SAMPLES, which are at different
 * prices once the shifted curve's off-plot points are dropped: an arrow that
 * was neither horizontal nor vertical, and read as neither.
 */
function shiftArrow(kind: "demand" | "supply", base: Pt[], dx: number, how: "horizontal" | "vertical" | "perpendicular", ctx: Ctx): Pt[] {
  const onPlot = (x: number) => x >= D0 - 1 && x <= D1 + 3;
  // Demand's arrow sits high on the curve, supply's low: both to the left of
  // the crossing, where the plot has room.
  const want = kind === "demand" ? 0.25 : 0.3;
  const order = base.map((_, i) => i).sort((a, b) => Math.abs(a / (base.length - 1) - want) - Math.abs(b / (base.length - 1) - want));
  const shifted = (x: number): number | null => (onPlot(x) ? interpolateAtX(base, x - dx) : null);
  for (const i of order) {
    const [x, y] = base[i];
    if (how === "horizontal") {
      if (onPlot(x + dx)) return ctx.toLogical([[x, y], [x + dx, y]]);
    } else if (how === "vertical") {
      const y2 = shifted(x);
      if (y2 !== null && y2 >= 0 && y2 <= 100) return ctx.toLogical([[x, y], [x, y2]]);
    } else {
      // Square to the old curve ON SCREEN (the axes are scaled differently),
      // walked out until it meets the new one.
      const a = ctx.toLogical([base[Math.max(0, i - 1)], base[Math.min(base.length - 1, i + 1)], [x, y]]);
      const [tx, ty] = [a[1][0] - a[0][0], a[1][1] - a[0][1]];
      const len = Math.hypot(tx, ty) || 1;
      const sign = dx >= 0 ? 1 : -1;
      // The normal that points the way the curve moved (toward +x for a right shift).
      let [nx, ny] = [ty / len, -tx / len];
      if (nx * sign < 0) [nx, ny] = [-nx, -ny];
      const start = a[2];
      const toDomain = (p: Pt): Pt => [(p[0] - ctx.sx(0)) / (ctx.sx(1) - ctx.sx(0)), (p[1] - ctx.sy(0)) / (ctx.sy(1) - ctx.sy(0))];
      let prev = 0;
      for (let s = 1; s <= 400; s++) {
        const p: Pt = [start[0] + nx * s, start[1] + ny * s];
        const [qx, qy] = toDomain(p);
        const cy = shifted(qx);
        if (cy === null) break;
        const diff = qy - cy;
        if (s > 1 && (diff === 0 || diff > 0 !== prev > 0)) return [start, p];
        prev = diff;
      }
    }
  }
  // No place fits (a shift of ~0, or one that left no overlap): a zero-length
  // arrow on the old curve, which draws nothing.
  const mid = base[Math.floor(base.length / 2)];
  return ctx.toLogical([mid, mid]);
}

/**
 * The arrow pulled back a little at both ends, so it starts just off the old
 * curve and its head stops just short of the new one — touching both, it read
 * as a third crossing line (Hans 2026-09-26: "a small gap … not a large gap,
 * but some"). A short arrow keeps at least half its length.
 */
function clearOfCurves(pts: Pt[], gap = 12): Pt[] {
  const [a, b] = [pts[0], pts[pts.length - 1]];
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (len === 0) return pts;
  const g = Math.min(gap, len / 4);
  const [ux, uy] = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
  return [
    [a[0] + ux * g, a[1] + uy * g],
    [b[0] - ux * g, b[1] - uy * g],
  ];
}

/** A curve's height at q, continued straight along its end segment past the samples. */
function heightAt(pts: Pt[], q: number): number {
  const y = interpolateAtX(pts, q);
  if (y !== null) return y;
  const [a, b] = q < pts[0][0] ? [pts[0], pts[1]] : [pts[pts.length - 2], pts[pts.length - 1]];
  return b[0] === a[0] ? a[1] : a[1] + ((b[1] - a[1]) * (q - a[0])) / (b[0] - a[0]);
}

/** ∫ f over [a, b] (trapezoids; exact for the straight curves most lessons use). */
function integrate(f: (q: number) => number, a: number, b: number, n = 400): number {
  if (!(b > a)) return 0;
  const h = (b - a) / n;
  let sum = (f(a) + f(b)) / 2;
  for (let i = 1; i < n; i++) sum += f(a + i * h);
  return sum * h;
}

/**
 * The market's numbers (SceneLayout.values), in the author's units: prices
 * and quantities mapped linearly from the 0–100 axes, areas in price ×
 * quantity. Only keys that mean something for these params are present.
 *
 * The areas are measured from quantity 0, each curve continued straight to
 * the axis over the thin strip left of where it is drawn — so a per-unit
 * tax's revenue reads exactly t × Q and a straight line's surplus exactly
 * ½ × base × height, the sums a viewer will check by hand. Where elasticity
 * has pulled a curve's start well right of the axis, continuing it would be
 * invention, and the areas start where the curves do (as the shading does).
 */
function marketValues(
  m: {
    demandPts: Pt[];
    supplyPts: Pt[];
    eq: Pt;
    eqNew: Pt | null;
    iv: Intervention;
    taxed: boolean;
    control: { kind: "ceiling" | "floor"; binds: boolean; p: number } | null;
  },
  units: SupplyDemandParams["units"] = {},
): Record<string, number> {
  const { demandPts: D, supplyPts: S, eq, iv } = m;
  const [p0, p1] = validRange(units.price);
  const [q0, q1] = validRange(units.quantity);
  const P = (v: number) => p0 + ((p1 - p0) * v) / 100;
  const Q = (v: number) => q0 + ((q1 - q0) * v) / 100;
  const dQ = (v: number) => ((q1 - q0) * v) / 100;
  const A = (v: number) => (((p1 - p0) * (q1 - q0)) / 10000) * v;

  const start = Math.max(D[0][0], S[0][0]);
  const lo = start <= D0 + 1e-6 ? 0 : start;
  const traded = Math.max(0, iv.qTraded - lo);
  const out: Record<string, number> = {
    price: P(eq[1]),
    quantity: Q(eq[0]),
    quantity_traded: Q(iv.qTraded),
    price_buyers: P(iv.pBuyers),
    price_sellers: P(iv.pSellers),
    cs: A(integrate((q) => heightAt(D, q) - iv.pBuyers, lo, iv.qTraded)),
    ps: A(integrate((q) => iv.pSellers - heightAt(S, q), lo, iv.qTraded)),
    dwl: A(Math.abs(integrate((q) => heightAt(D, q) - heightAt(S, q), Math.max(lo, Math.min(iv.qTraded, eq[0])), Math.max(lo, iv.qTraded, eq[0])))),
  };
  if (m.eqNew) {
    out.price_new = P(m.eqNew[1]);
    out.quantity_new = Q(m.eqNew[0]);
  }
  if (m.taxed) out.revenue = A((iv.pBuyers - iv.pSellers) * traded);
  if (m.control) {
    // Not binding: the market clears at equilibrium and the gap is zero —
    // the line stays (at 0) while a slider carries the control across.
    const p = m.control.binds ? m.control.p : eq[1];
    const qd = m.control.binds ? solveForX(D, p) : eq[0];
    const qs = m.control.binds ? solveForX(S, p) : eq[0];
    if (qd !== null && qs !== null) {
      out.qd = Q(qd);
      out.qs = Q(qs);
      if (m.control.kind === "ceiling") out.shortage = dQ(Math.max(0, qd - qs));
      else out.surplus = dQ(Math.max(0, qs - qd));
    }
    out.transfer = A(Math.abs(eq[1] - p) * traded);
  }
  return out;
}

function validRange(r: [number, number] | undefined): [number, number] {
  return Array.isArray(r) && r.length === 2 && r.every(Number.isFinite) && r[1] !== r[0] ? r : [0, 100];
}

/** Currency signs go in front ($12); every other unit after (12 kr, 400 flats). */
function withUnit(num: string, unit: string | undefined): string {
  if (!unit) return num;
  return /^[$€£¥]$/.test(unit) ? `${unit}${num}` : `${num} ${unit}`;
}

/**
 * A readout number: whole from 100 up, one decimal from 10, two below —
 * trailing zeros dropped, thousands grouped, the cast's decimal mark (kit.num).
 */
function formatValue(v: number, kind: "price" | "quantity" | "area", units: NonNullable<SupplyDemandParams["units"]>): string {
  const a = Math.abs(v);
  const d = a >= 100 ? 0 : a >= 10 ? 1 : 2;
  let fixed = v.toFixed(d);
  if (Number(fixed) === 0) fixed = (0).toFixed(d); // no "-0"
  const [int, frac] = (d > 0 ? fixed.replace(/\.?0+$/, "") : fixed).split(".");
  const comma = kit.num(1.5, 1).includes(",");
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, comma ? " " : ",").replace("-", "−");
  const num = frac ? `${grouped}${comma ? "," : "."}${frac}` : grouped;
  return withUnit(num, kind === "quantity" ? units.quantity_unit : units.price_unit);
}

/** Room between the plot's right edge and the readout: the curve names (S, D′, "S + tax") sit there. */
const READOUT_GAP = 66;

interface ReadoutColumn {
  keys: ReadoutKey[];
  w: number;
  FONT: number;
  LINE: number;
}

function readoutName(k: ReadoutKey, v: Record<string, number>): string {
  const n = k === "revenue" && (v.revenue ?? 0) < -1e-9 ? { en: "Subsidy cost", nb: "Subsidiekostnad" } : VALUE_NAME[k];
  return kit.say({ ...n, nn: n.nb, no: n.nb });
}

/**
 * The readout's keys (unknown ones dropped) and its width — fixed by the
 * words and a WIDE number, never by this frame's digits: a width that
 * followed the value would squeeze the plot back and forth mid-sweep.
 */
function readoutColumn(requested: string[] | undefined, units: NonNullable<SupplyDemandParams["units"]>): ReadoutColumn | null {
  const keys = (requested ?? []).filter((k): k is ReadoutKey => (READOUT_KEYS as readonly string[]).includes(k));
  if (keys.length === 0) return null;
  const FONT = 24;
  const LINE = 32;
  const names = keys.flatMap((k) => [readoutName(k, {}), ...(k === "revenue" ? [readoutName(k, { revenue: -1 })] : [])]);
  const valueW = Math.max(...keys.map((k) => kit.textWidth(withUnit("0 000", VALUE_KIND[k] === "quantity" ? units.quantity_unit : units.price_unit), FONT)));
  const w = Math.max(...names.map((n) => kit.textWidth(n, FONT))) + 20 + valueW;
  return { keys, w, FONT, LINE };
}
