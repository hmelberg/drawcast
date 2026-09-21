# Supply & demand welfare — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `supply_demand` able to show who pays a tax, what the government
collects, what a price control costs, and to contrast elastic against inelastic
demand — which it cannot do today.

**Architecture:** One new per-curve lever (`elasticity`, scaling a curve's x-run
about the equilibrium, so it never saturates the way `steepness` does), and one
internal `Intervention = { qTraded, pBuyers, pSellers }` that a tax, a subsidy,
a price ceiling and a price floor all resolve to — so consumer surplus,
producer surplus, deadweight loss and the wedge rectangle are computed once
rather than once per intervention.

**Tech Stack:** TypeScript, Vitest, no new dependencies. Everything happens in
one scene file plus its manifest.

**Spec:** `docs/superpowers/specs/2026-09-21-supply-demand-welfare-design.md` —
read it first; this plan argues from it and cites its sections.

## Global Constraints

- **Internal domain is 0–100 × 0–100.** `D0 = 2`, `D1 = 96` is the usable x
  slice. Prices and tax amounts are in these units, not currency.
- **The default equilibrium is exactly (49, 50)** and both default curves are
  symmetric about it. Every worked number in this plan assumes default params.
- **No backwards compatibility is required.** This repo has no users yet;
  replace and delete rather than deprecate.
- **`src/layout/curves.ts` must not be modified.** `qualitativeShape` is shared
  with `src/layout/tier2.ts:978`; changing it would move every spec-level
  `curve` element too. All new geometry is local to the scene.
- **`COLORS` is frozen and exposed live on `kit`** (`src/layout/model.ts:200`).
  Do not add a token; reuse `COLORS.accent` for the new rectangles.
- **Run `npx vitest run` (the whole suite) before every commit.** Netlify runs
  `npm test && npm run build`, and `npm run build` runs `tsc`, which Vitest
  does not. Run `npx tsc --noEmit` before the final commit.
- **Do not push.** Hans pushes this round himself.

---

## File Structure

| file | responsibility after this round |
|---|---|
| `src/scenes/supply_demand/layout.ts` | all geometry: curves, elasticity, the intervention model, every region |
| `src/scenes/supply_demand/manifest.json` | what the compiler model is told the scene can do |
| `src/llm/prompts/compiler-v1.md` | one cross-cutting sentence (the scene-specific teaching lives in the manifest, which the catalog embeds verbatim) |
| `src/examples.json` | the bundled incidence example — the round's acceptance case |
| `tests/supply-demand.test.ts` | scene behaviour |
| `tests/prompt-size.test.ts` | the prompt ratchet |

`layout.ts` grows from 372 lines to roughly 560. That is within the range of
its siblings and it keeps one responsibility, so it is not split.

---

### Task 1: Elasticity

Spec §4. Self-contained: no other task depends on it, and it depends on
nothing. Adds a lever that reaches vertical and horizontal, without touching
`steepness` or the shared `qualitativeShape`.

**Files:**
- Modify: `src/scenes/supply_demand/layout.ts`
- Test: `tests/supply-demand.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `CurveParams.elasticity?: "perfectly_inelastic" | "inelastic" | "unit" | "elastic" | "perfectly_elastic" | number`
  - `elasticityFactor(e): number` — the `s` multiplier
  - `scaleXAbout(pts: Pt[], px: number, s: number): Pt[]`
  - the local `px` (pivot x) inside `layoutSupplyDemand`, which Task 2 does not
    need but Task 4's region maths reads indirectly through the curves.

- [ ] **Step 1: Write the failing tests**

Append to `tests/supply-demand.test.ts`:

```ts
describe("elasticity", () => {
  test("elasticity 1 and the word 'unit' are exact identities", () => {
    const base = layoutSupplyDemand({});
    for (const e of [1, "unit" as const]) {
      const l = layoutSupplyDemand({ demand: { elasticity: e }, supply: { elasticity: e } });
      expect(l.curveSamples!["demand_curve"]).toEqual(base.curveSamples!["demand_curve"]);
      expect(l.curveSamples!["supply_curve"]).toEqual(base.curveSamples!["supply_curve"]);
    }
  });

  test("the equilibrium never moves, whatever the elasticities", () => {
    const base = layoutSupplyDemand({}).anchors["equilibrium_point"];
    for (const e of [0.06, 0.3, 0.5, 1, 1.5, 1.9, 1.94]) {
      for (const params of [{ demand: { elasticity: e } }, { supply: { elasticity: e } }]) {
        const eq = layoutSupplyDemand(params).anchors["equilibrium_point"];
        expect(eq[0]).toBeCloseTo(base[0], 2);
        expect(eq[1]).toBeCloseTo(base[1], 2);
      }
    }
  });

  test("inelastic is near-vertical, elastic is near-horizontal, and both keep enough points", () => {
    const span = (l: SceneLayout, id: string, i: 0 | 1) => {
      const v = l.curveSamples![id].map((p) => p[i]);
      return Math.max(...v) - Math.min(...v);
    };
    const inelastic = layoutSupplyDemand({ demand: { elasticity: "perfectly_inelastic" } });
    const elastic = layoutSupplyDemand({ demand: { elasticity: "perfectly_elastic" } });
    // near-vertical: a narrow x-run, the full y-span
    expect(span(inelastic, "demand_curve", 0)).toBeLessThan(span(elastic, "demand_curve", 0) / 10);
    expect(span(inelastic, "demand_curve", 1)).toBeGreaterThan(span(elastic, "demand_curve", 1) * 10);
    // neither extreme degenerates into a 2-point polyline
    for (const l of [inelastic, elastic]) expect(l.curveSamples!["demand_curve"].length).toBeGreaterThan(20);
  });

  test("elasticity composes with steepness rather than replacing it", () => {
    const ySpan = (l: SceneLayout) => {
      const ys = l.curveSamples!["demand_curve"].map(([, y]) => y);
      return Math.max(...ys) - Math.min(...ys);
    };
    const flat = layoutSupplyDemand({ demand: { steepness: 0.4, elasticity: 0.5 } });
    const full = layoutSupplyDemand({ demand: { steepness: 1, elasticity: 0.5 } });
    expect(ySpan(full)).toBeGreaterThan(ySpan(flat));
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/supply-demand.test.ts -t elasticity`
Expected: FAIL — `elasticity` is not a known property, curves are identical
across every value.

- [ ] **Step 3: Implement**

In `src/scenes/supply_demand/layout.ts`, extend `CurveParams`:

```ts
export interface CurveParams {
  steepness?: "gentle" | "medium" | "steep" | number;
  curvature?: "linear" | "convex" | "concave";
  /** Scales the curve's x-run about the equilibrium — see ELASTICITY. */
  elasticity?: "perfectly_inelastic" | "inelastic" | "unit" | "elastic" | "perfectly_elastic" | number;
  label?: string;
}
```

Add near `D0`/`D1`, with the comment — the clamp is load-bearing and a later
reader will otherwise widen it:

```ts
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
```

Import `CURVE_SAMPLES` from `../../layout/curves` (add it to the existing
import on line 7).

Then replace lines 91–92 (the two `shapedCurve` calls) with:

```ts
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/supply-demand.test.ts`
Expected: PASS, including the two pre-existing `numeric steepness` tests at
line 99, **unmodified** — the `s === 1` early return guarantees it.

- [ ] **Step 5: Run the whole suite**

Run: `npx vitest run`
Expected: PASS. If `tests/examples.test.ts` or `tests/exemplars.test.ts` fail,
stop and report — the elasticity default is meant to be an exact identity, so a
failure there means `scaleXAbout` is not returning `pts` unchanged.

- [ ] **Step 6: Commit**

```bash
git add src/scenes/supply_demand/layout.ts tests/supply-demand.test.ts
git commit -m "supply_demand: elasticity, a slope lever that does not saturate

steepness widens a curve's y-span and so saturates at k = 1.048 once the
span hits the plot edges. elasticity scales the x-run about the equilibrium
instead: e=0.06 reads vertical, e=1.94 horizontal, e=1 is an exact identity.

Pivoting on the crossing of the un-elasticized pair means neither curve's
elasticity can move the equilibrium, which is what the incidence comparison
in the next task needs."
```

---

### Task 2: The intervention model, and a tax that says who pays

Spec §5 and §6. Builds the `Intervention` abstraction and the tax on top of it
in one task, because §6.3's rule is what makes all four tax variants one code
path — building the tax first and refactoring after would write it twice.

**Files:**
- Modify: `src/scenes/supply_demand/layout.ts`
- Test: `tests/supply-demand.test.ts`

**Interfaces:**
- Consumes: Task 1's `demandPts` / `supplyPts` / `px`.
- Produces:
  - `interface Intervention { kind: "none" | "tax" | "ceiling" | "floor"; qTraded: number; pBuyers: number; pSellers: number }`
  - a local `const iv: Intervention` inside `layoutSupplyDemand`, which Tasks 3
    and 4 both read.
  - `SupplyDemandParams["tax"]` gains `amount`, `side`, `kind`; loses nothing yet.
  - new element ids `price_buyers_point`, `price_sellers_point`, `label_Pb`,
    `label_Ps`, and `tax_demand_curve` / `label_D_tax` for a buyer-side tax.

- [ ] **Step 1: Write the failing tests**

```ts
describe("tax decomposition", () => {
  const P = (l: SceneLayout, id: string) => l.anchors[id];

  test("default per-unit tax lands on the worked values from the spec", () => {
    // Domain units: the equilibrium is (49, 50); a per-unit 18 gives
    // Q_t = 38.93, P_b = 59.00, P_s = 41.00 (spec §6.3).
    const l = layoutSupplyDemand({ tax: { amount: 18 } });
    const pb = P(l, "price_buyers_point");
    const ps = P(l, "price_sellers_point");
    expect(pb[0]).toBeCloseTo(ps[0], 3);          // same quantity
    const eq = P(l, "equilibrium_point");
    expect(pb[1]).toBeGreaterThan(eq[1]);         // buyers pay MORE, and logical y is UP
    expect(ps[1]).toBeLessThan(eq[1]);            // sellers receive LESS
  });

  test("a seller-side and a buyer-side tax are the same figure", () => {
    const seller = layoutSupplyDemand({ tax: { amount: 18, side: "seller" } });
    const buyer = layoutSupplyDemand({ tax: { amount: 18, side: "buyer" } });
    for (const id of ["price_buyers_point", "price_sellers_point"]) {
      expect(P(buyer, id)[0]).toBeCloseTo(P(seller, id)[0], 1);
      expect(P(buyer, id)[1]).toBeCloseTo(P(seller, id)[1], 1);
    }
    expect(ids(seller)).toContain("tax_supply_curve");
    expect(ids(buyer)).toContain("tax_demand_curve");
  });

  test("perfectly inelastic demand puts the whole burden on buyers", () => {
    const l = layoutSupplyDemand({ demand: { elasticity: "perfectly_inelastic" }, tax: { amount: 18 } });
    const eq = P(l, "equilibrium_point");
    const ps = P(l, "price_sellers_point");
    // sellers receive what they did before: the seller price barely moves
    expect(Math.abs(ps[1] - eq[1])).toBeLessThan(Math.abs(P(l, "price_buyers_point")[1] - eq[1]) / 4);
  });

  test("perfectly elastic demand puts the whole burden on sellers", () => {
    const l = layoutSupplyDemand({ demand: { elasticity: "perfectly_elastic" }, tax: { amount: 18 } });
    const eq = P(l, "equilibrium_point");
    const pb = P(l, "price_buyers_point");
    expect(Math.abs(pb[1] - eq[1])).toBeLessThan(Math.abs(P(l, "price_sellers_point")[1] - eq[1]) / 4);
  });

  test("an ad valorem tax pivots supply instead of translating it", () => {
    const l = layoutSupplyDemand({ tax: { amount: 36, kind: "ad_valorem" } });
    const base = l.curveSamples!["supply_curve"];
    const taxed = l.curveSamples!["tax_supply_curve"];
    const gapAt = (frac: number) => {
      const i = Math.floor(base.length * frac);
      const b = base[i];
      const t = taxed.reduce((best, p) => (Math.abs(p[0] - b[0]) < Math.abs(best[0] - b[0]) ? p : best), taxed[0]);
      return Math.abs(t[1] - b[1]);
    };
    // proportional, so the gap GROWS along the curve; a per-unit tax is parallel
    expect(gapAt(0.8)).toBeGreaterThan(gapAt(0.2) * 1.5);
  });

  test("a negative amount is a subsidy: quantity rises and sellers receive more than buyers pay", () => {
    const l = layoutSupplyDemand({ tax: { amount: -18 } });
    const eq = P(l, "equilibrium_point");
    const pb = P(l, "price_buyers_point");
    const ps = P(l, "price_sellers_point");
    expect(pb[0]).toBeGreaterThan(eq[0]);   // more is traded
    expect(ps[1]).toBeGreaterThan(pb[1]);   // sellers receive MORE than buyers pay
  });

  test("P_b and P_s are drawn by default, with their axis labels", () => {
    const all = ids(layoutSupplyDemand({ tax: { amount: 18 } }));
    for (const id of ["price_buyers_point", "price_sellers_point", "label_Pb", "label_Ps"]) {
      expect(all).toContain(id);
    }
  });
});
```

**Note on the y direction — measured, not assumed.** The logical canvas is
**y-UP**: `plotArea()` returns `y0 = PLOT_MARGIN.bottom` and
`y1 = CANVAS.h - PLOT_MARGIN.top`, so `sy = linearScale([0,100], [y0, y1])`
sends a higher price to a **larger** logical y. `src/layout/canvas.ts:33`
calls the SVG flip "the one y-flip … backends call this at emission time
only". Confirmed by probe on 2026-09-21: the default equilibrium is
`[516.9, 385.0]`, the demand curve runs from `[136.2, 628.6]` at low quantity
(high price) to `[897.6, 141.4]` at high quantity (low price).

The pre-existing ceiling test at `tests/supply-demand.test.ts:54` already
encodes this — it asserts `ceilingY < eqY` for a ceiling *below* the
equilibrium price — so it is independent confirmation, not just a probe.

`anchors` holds logical points, so every price assertion here reads
"higher price ⇒ larger y".

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/supply-demand.test.ts -t "tax decomposition"`
Expected: FAIL — `price_buyers_point` is undefined in `anchors`.

- [ ] **Step 3: Implement the intervention type and the tax**

Extend the params interface:

```ts
  tax?: {
    amount?: number;
    side?: "seller" | "buyer";
    kind?: "per_unit" | "ad_valorem";
    show_deadweight_loss?: boolean;
    label?: string;
  };
```

(`show_deadweight_loss` stays for now; Task 4 deletes it. Keeping it here means
the suite stays green between the two commits.)

Add above `layoutSupplyDemand`:

```ts
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
```

Replace the whole `if (params.tax && supplyPts && eq) { … }` block
(`layout.ts:170-203`) with:

```ts
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
    );

    const eq2 = buyerSide ? intersectPolylines(shifted, supplyPts) : intersectPolylines(demandPts, shifted);
    if (eq2) {
      const qT = eq2[0];
      const pB = interpolateAtX(demandPts, qT);
      const pS = interpolateAtX(supplyPts, qT);
      if (pB !== null && pS !== null) {
        iv = { kind: "tax", qTraded: qT, pBuyers: pB, pSellers: pS };
        push(guides("tax_guide_lines", [qT, pB], ctx, plot));
        const pbL = ctx.toLogical([[qT, pB]])[0];
        const psL = ctx.toLogical([[qT, pS]])[0];
        push(dot("tax_equilibrium_point", pbL));
        anchors["tax_equilibrium_point"] = pbL;
        push(dot("price_buyers_point", pbL));
        anchors["price_buyers_point"] = pbL;
        push(dot("price_sellers_point", psL));
        anchors["price_sellers_point"] = psL;
        const subsidy = amount < 0;
        label("label_Pb", [plot.x0, pbL[1]], "left", subsidy ? "P paid" : "P buyers", COLORS.demand);
        label("label_Ps", [plot.x0, psL[1]], "left", subsidy ? "P received" : "P sellers", COLORS.supply);
      }
    }
  }
```

**KEEP the old deadweight-loss block** — do not delete it here. Move it inside
the `if (pB !== null && pS !== null)` branch above and adapt it to the new
quantity, so it reads:

```ts
        if (params.tax.show_deadweight_loss !== false) {
          const region = betweenRegion(demandPts, supplyPts, Math.min(qT, eq[0]), Math.max(qT, eq[0]));
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
            label("label_DWL", anchors["dwl_region"], "right", "Deadweight loss", COLORS.regionLoss);
          }
        }
```

`Math.min`/`Math.max` is what makes it work for a subsidy too, where the taxed
quantity is above `Q*` rather than below. Task 4 moves this into `regions`.

**Why it stays:** `tsconfig.json` sets `noUnusedLocals: true`, and this is the
only call site of the module-level `betweenRegion` (`layout.ts:357`) — deleting
it makes that function unused and fails this task's own `npx tsc --noEmit` step.
Keeping it also means **no test needs skipping**: the two pre-existing tests
that pass `show_deadweight_loss: true` keep passing untouched.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/supply-demand.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the whole suite and the type check**

Run: `npx vitest run && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/scenes/supply_demand/layout.ts tests/supply-demand.test.ts
git commit -m "supply_demand: a tax that says who pays it

tax.amount replaces the hard-coded 18, and takes a side (seller or buyer),
a kind (per-unit or ad valorem) and a negative value for a subsidy. All four
combinations are one code path because the two prices are read off the
UNTAXED curves at the new quantity rather than derived from the tax size.

Seller-side and buyer-side therefore come out bit-identical, which is the
tax-equivalence theorem and is now a test rather than a claim."
```

---

### Task 3: Price controls resolve to the same intervention

Spec §7. Parameterises the ceiling and floor levels and routes them through
Task 2's `Intervention`.

**Files:**
- Modify: `src/scenes/supply_demand/layout.ts`
- Test: `tests/supply-demand.test.ts`

**Interfaces:**
- Consumes: Task 2's `Intervention` and the local `iv`.
- Produces: `price_ceiling.level`, `price_floor.level`; `iv` now also resolves
  for `kind: "ceiling" | "floor"`.

- [ ] **Step 1: Write the failing tests**

```ts
describe("price control levels", () => {
  test("level sets the line, and the defaults reproduce today's figure", () => {
    const dflt = layoutSupplyDemand({ price_ceiling: {} });
    const explicit = layoutSupplyDemand({ price_ceiling: { level: 31 } });
    const y = (l: SceneLayout) => flattenDrawables(l.drawables).find((d) => d.id === "ceiling_line")!.pts[0][1];
    expect(y(explicit)).toBeCloseTo(y(dflt), 1);
    const lower = layoutSupplyDemand({ price_ceiling: { level: 20 } });
    expect(y(lower)).toBeLessThan(y(dflt)); // lower price = smaller logical y (y is UP)
  });

  test("a lower ceiling opens a wider shortage", () => {
    const gap = (level: number) => {
      const a = flattenDrawables(layoutSupplyDemand({ price_ceiling: { level } }).drawables)
        .find((d) => d.id === "shortage_arrow")!.pts;
      return Math.abs(a[1][0] - a[0][0]);
    };
    expect(gap(20)).toBeGreaterThan(gap(40));
  });

  test("a non-binding control still draws its line but no gap", () => {
    const all = ids(layoutSupplyDemand({ price_ceiling: { level: 80 } })); // above P* = 50
    expect(all).toContain("ceiling_line");
    expect(all).not.toContain("shortage_arrow");
  });

  test("a floor above the equilibrium produces a surplus", () => {
    const all = ids(layoutSupplyDemand({ price_floor: { level: 70 } }));
    expect(all).toContain("floor_line");
    expect(all).toContain("surplus_arrow");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/supply-demand.test.ts -t "price control levels"`
Expected: FAIL — `level` is ignored, and a non-binding ceiling still draws a gap.

- [ ] **Step 3: Implement**

Extend the params:

```ts
  price_ceiling?: { level?: number; label?: string; show_shortage?: boolean };
  price_floor?: { level?: number; label?: string; show_surplus?: boolean };
```

Replace the two control blocks (`layout.ts:205-221`) with:

```ts
  // Price controls. Both resolve to the same Intervention as the tax: the
  // quantity actually traded is the SHORT side, and both sides face one price,
  // so the wedge rectangle is zero-height and Task 4 skips it automatically.
  if (params.price_ceiling && eq && supplyPts) {
    const pc = Math.max(2, Math.min(96, params.price_ceiling.level ?? eq[1] * 0.62));
    addPriceLine("ceiling", pc, params.price_ceiling.label ?? "Price ceiling");
    const binds = pc < eq[1];
    const qs = binds ? solveForX(supplyPts, pc) : null;
    if (binds && qs !== null) {
      if (iv.kind === "none") iv = { kind: "ceiling", qTraded: qs, pBuyers: pc, pSellers: pc };
      if (params.price_ceiling.show_shortage !== false) {
        addGap("shortage", pc, qs, solveForX(demandPts, pc), "Shortage");
      }
    }
  }

  if (params.price_floor && eq && supplyPts) {
    const pf = Math.max(2, Math.min(96, params.price_floor.level ?? Math.min(eq[1] * 1.35, 92)));
    addPriceLine("floor", pf, params.price_floor.label ?? "Price floor");
    const binds = pf > eq[1];
    const qd = binds ? solveForX(demandPts, pf) : null;
    if (binds && qd !== null) {
      if (iv.kind === "none") iv = { kind: "floor", qTraded: qd, pBuyers: pf, pSellers: pf };
      if (params.price_floor.show_surplus !== false) {
        addGap("surplus", pf, qd, solveForX(supplyPts, pf), "Surplus");
      }
    }
  }
```

`if (iv.kind === "none")` is the spec's **tax > ceiling > floor** precedence
(§5): a tax already claimed `iv`, so a control set alongside it draws its line
but does not take over the welfare maths.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/supply-demand.test.ts`
Expected: PASS, including the pre-existing ceiling test at line 54.

- [ ] **Step 5: Run the whole suite and the type check**

Run: `npx vitest run && npx tsc --noEmit`

- [ ] **Step 6: Commit**

```bash
git add src/scenes/supply_demand/layout.ts tests/supply-demand.test.ts
git commit -m "supply_demand: price control levels, resolved as interventions

price_ceiling.level and price_floor.level replace the hard-coded 0.62 and
1.35 multiples, so a control can be set, compared and animated. Both resolve
to the same { qTraded, pBuyers, pSellers } the tax does, with buyers and
sellers facing one price — which is what makes the welfare maths in the next
task indifferent to which intervention it is looking at.

A non-binding control now draws its line and omits the gap, which is a
legitimate figure rather than an error."
```

---

### Task 4: One `regions` list for every shaded area

Spec §5.1 and §3.4/§3.5. The welfare payload, and the one deliberate regression
in the round.

**Files:**
- Modify: `src/scenes/supply_demand/layout.ts`
- Modify: `src/examples.json` (minimal migration only — Task 5 rewrites it)
- Test: `tests/supply-demand.test.ts`

**Interfaces:**
- Consumes: Task 2/3's `iv: Intervention`.
- Produces: `regions: ("consumer_surplus" | "producer_surplus" | "deadweight_loss" | "government_revenue" | "transfer")[]`;
  element ids `wedge_region`, `label_wedge`, `transfer_region`, `label_transfer`.
  Deletes `tax.show_deadweight_loss`.

- [ ] **Step 1: Write the failing tests**

These need two imports the test file does not yet have — add them to the
existing import block at the top:

```ts
import { layoutSupplyDemand, type SupplyDemandParams } from "../src/scenes/supply_demand/layout";
```

(`CANVAS` and `flattenDrawables` are already imported at lines 3–4.)

```ts
/** Polygon area by the shoelace formula, in logical units. */
function polyArea(l: SceneLayout, id: string): number {
  const d = flattenDrawables(l.drawables).find((x) => x.id === id);
  if (!d || (d.kind !== "area" && d.kind !== "stroke")) return 0;
  const p = d.pts;
  let a = 0;
  for (let i = 0; i < p.length; i++) {
    const [x1, y1] = p[i];
    const [x2, y2] = p[(i + 1) % p.length];
    a += x1 * y2 - x2 * y1;
  }
  return Math.abs(a) / 2;
}

const ALL_REGIONS = ["consumer_surplus", "producer_surplus", "deadweight_loss", "government_revenue", "transfer"] as const;

describe("welfare regions", () => {
  test("a bare tax shades nothing", () => {
    const all = ids(layoutSupplyDemand({ tax: { amount: 18 } }));
    for (const id of ["cs_region", "ps_region", "dwl_region", "wedge_region"]) {
      expect(all).not.toContain(id);
    }
  });

  test("the welfare identity holds for every intervention", () => {
    const base = layoutSupplyDemand({ regions: [...ALL_REGIONS] });
    const cs0 = polyArea(base, "cs_region");
    const ps0 = polyArea(base, "ps_region");
    const cases: SupplyDemandParams[] = [
      { tax: { amount: 18 } },
      { tax: { amount: 18, side: "buyer" } },
      { tax: { amount: 36, kind: "ad_valorem" } },
      { tax: { amount: -18 } },
      { price_ceiling: { level: 32 } },
      { price_floor: { level: 68 } },
    ];
    for (const c of cases) {
      const l = layoutSupplyDemand({ ...c, regions: [...ALL_REGIONS] });
      const dCS = polyArea(l, "cs_region") - cs0;
      const dPS = polyArea(l, "ps_region") - ps0;
      // the wedge is a TRANSFER out of the two surpluses for a tax, and INTO
      // them for a subsidy, so it enters the identity with the sign of the tax
      const wedge = polyArea(l, "wedge_region") * (c.tax && (c.tax.amount ?? 0) < 0 ? -1 : 1);
      const dwl = polyArea(l, "dwl_region");
      // RELATIVE tolerance: these are logical pixels squared, order 1e5, and
      // CS/PS are built from the 61-point curves while betweenRegion resamples
      // at 24 — an absolute tolerance would be tighter than the sampling. 2% of
      // total surplus still catches any sign error, wrong bound or missing region.
      expect(Math.abs(dCS + dPS + wedge + dwl)).toBeLessThan((cs0 + ps0) * 0.02);
    }
  });

  test("the wedge rectangle spans the two prices and ends at the traded quantity", () => {
    const l = layoutSupplyDemand({ tax: { amount: 18 }, regions: ["government_revenue"] });
    const pb = l.anchors["price_buyers_point"];
    const ps = l.anchors["price_sellers_point"];
    // NB: `.pts` is not on every Drawable variant (TextDrawable has none), so
    // narrow before reading it — a bare `.find(...)!.pts` does not compile here.
    const wedge = flattenDrawables(l.drawables).find((d) => d.id === "wedge_region");
    if (!wedge || wedge.kind !== "area") throw new Error("wedge_region missing or not an area");
    const pts = wedge.pts;
    const xs = pts.map(([x]) => x);
    const ys = pts.map(([, y]) => y);
    // a true rectangle: its height IS the price gap and its right edge IS Q_t
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(Math.abs(pb[1] - ps[1]), 1);
    expect(Math.max(...xs)).toBeCloseTo(pb[0], 1);
    expect(polyArea(l, "wedge_region")).toBeCloseTo(
      (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys)),
      0,
    );
  });

  test("a price control has no wedge but does have a transfer", () => {
    const l = layoutSupplyDemand({ price_ceiling: { level: 32 }, regions: ["government_revenue", "transfer"] });
    expect(ids(l)).not.toContain("wedge_region");
    expect(polyArea(l, "transfer_region")).toBeGreaterThan(0);
  });

  test("consumer surplus follows the intervention rather than the free market", () => {
    const free = layoutSupplyDemand({ regions: ["consumer_surplus"] });
    const taxed = layoutSupplyDemand({ tax: { amount: 18 }, regions: ["consumer_surplus"] });
    expect(polyArea(taxed, "cs_region")).toBeLessThan(polyArea(free, "cs_region") * 0.95);
  });

  test("a subsidy costs the government more than the two sides gain", () => {
    const base = layoutSupplyDemand({ regions: [...ALL_REGIONS] });
    const sub = layoutSupplyDemand({ tax: { amount: -18 }, regions: [...ALL_REGIONS] });
    const gain =
      polyArea(sub, "cs_region") - polyArea(base, "cs_region") +
      (polyArea(sub, "ps_region") - polyArea(base, "ps_region"));
    expect(polyArea(sub, "wedge_region")).toBeGreaterThan(gain);
  });

  test("every combination stays inside the logical canvas", () => {
    // spec §10.8 — replaces the narrower pre-existing bounds test
    const combos: SupplyDemandParams[] = [
      { tax: { amount: 18 }, regions: [...ALL_REGIONS] },
      { tax: { amount: -40 }, regions: [...ALL_REGIONS] },
      { tax: { amount: 200, kind: "ad_valorem" }, regions: [...ALL_REGIONS] },
      { tax: { amount: 18, side: "buyer" }, regions: [...ALL_REGIONS] },
      { price_ceiling: { level: 4 }, regions: [...ALL_REGIONS] },
      { price_floor: { level: 94 }, regions: [...ALL_REGIONS] },
      { demand: { elasticity: 0.06 }, supply: { elasticity: 1.94 }, tax: { amount: 18 }, regions: [...ALL_REGIONS] },
      { demand: { elasticity: 1.94 }, supply: { elasticity: 0.06 }, tax: { amount: 18 }, regions: [...ALL_REGIONS] },
    ];
    for (const c of combos) {
      for (const d of flattenDrawables(layoutSupplyDemand(c).drawables)) {
        if (d.kind !== "stroke" && d.kind !== "area") continue;
        for (const [x, y] of d.pts) {
          expect(x).toBeGreaterThanOrEqual(0);
          expect(x).toBeLessThanOrEqual(CANVAS.w);
          expect(y).toBeGreaterThanOrEqual(0);
          expect(y).toBeLessThanOrEqual(CANVAS.h);
        }
      }
    }
  });

  test("the wedge is labelled a cost when the tax is negative", () => {
    const sub = layoutSupplyDemand({ tax: { amount: -18 }, regions: ["government_revenue"] });
    expect(sub.labels.find((l) => l.id === "label_wedge")!.text).toMatch(/cost/i);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/supply-demand.test.ts -t "welfare regions"`
Expected: FAIL — `wedge_region` does not exist and `cs_region` ignores the tax.

- [ ] **Step 3: Implement**

Delete `show_deadweight_loss` from the `tax` params type and from the old DWL
block. Widen `regions`:

```ts
  regions?: ("consumer_surplus" | "producer_surplus" | "deadweight_loss" | "government_revenue" | "transfer")[];
```

Replace the whole `if (params.regions && eq) { … }` block (`layout.ts:223-240`)
with:

```ts
  // Every shaded area, computed against whatever intervention resolved above.
  // Nothing here asks WHICH intervention it is — that is the point of §5's
  // single { qTraded, pBuyers, pSellers }.
  if (params.regions?.length && eq && supplyPts) {
    const want = new Set(params.regions);
    const { qTraded, pBuyers, pSellers } = iv;
    const [qStar, pStar] = eq;

    if (want.has("consumer_surplus")) {
      const upper = demandPts.filter(([x]) => x <= qTraded);
      const pts = ctx.toLogical([...upper, [qTraded, pBuyers], [D0, pBuyers]]);
      push(area("cs_region", pts, COLORS.region1));
      anchors["cs_region"] = centroid(pts);
      label("label_CS", anchors["cs_region"], "above-right", "Consumer surplus");
    }

    if (want.has("producer_surplus")) {
      const lower = supplyPts.filter(([x]) => x <= qTraded);
      const pts = ctx.toLogical([[D0, pSellers], [qTraded, pSellers], ...lower.reverse()]);
      push(area("ps_region", pts, COLORS.region2));
      anchors["ps_region"] = centroid(pts);
      label("label_PS", anchors["ps_region"], "below-right", "Producer surplus");
    }

    if (want.has("deadweight_loss") && Math.abs(qTraded - qStar) > 0.5) {
      const region = betweenRegion(demandPts, supplyPts, Math.min(qTraded, qStar), Math.max(qTraded, qStar));
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
        label("label_DWL", anchors["dwl_region"], "right", "Deadweight loss", COLORS.regionLoss);
      }
    }

    // Zero-height for a price control, where both sides face one price, so
    // this skips itself without a branch on iv.kind.
    if (want.has("government_revenue") && Math.abs(pBuyers - pSellers) > 0.5) {
      const pts = ctx.toLogical([[D0, pSellers], [qTraded, pSellers], [qTraded, pBuyers], [D0, pBuyers]]);
      push(area("wedge_region", pts, COLORS.accent));
      anchors["wedge_region"] = centroid(pts);
      label(
        "label_wedge",
        anchors["wedge_region"],
        "right",
        pBuyers > pSellers ? "Government revenue" : "Government cost",
        COLORS.accent,
      );
    }

    if (want.has("transfer") && (iv.kind === "ceiling" || iv.kind === "floor")) {
      const pts = ctx.toLogical([[D0, pStar], [qTraded, pStar], [qTraded, pBuyers], [D0, pBuyers]]);
      push(area("transfer_region", pts, COLORS.accent));
      anchors["transfer_region"] = centroid(pts);
      label("label_transfer", anchors["transfer_region"], "right", "Transfer", COLORS.accent);
    }
  }
```

Then migrate the three call sites of the deleted flag:

- `tests/supply-demand.test.ts:41` → `{ tax: { amount: 18 }, regions: ["deadweight_loss"], price_ceiling: { show_shortage: true } }`
- `tests/supply-demand.test.ts:66` → `{ tax: { amount: 18 }, regions: ["deadweight_loss"] }` (and remove any `test.skip` left from Task 2)
- `src/examples.json:25550` → replace `"show_deadweight_loss": true` inside
  `params.tax` with nothing, and add `"regions": ["deadweight_loss"]` as a
  sibling of `tax` in `params`. Minimal edit only; Task 5 rewrites this example.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/supply-demand.test.ts`
Expected: PASS. If the welfare identity is off by more than 1 logical unit,
the likeliest cause is a region whose right edge does not close on its curve —
check that `interpolateAtX(demandPts, qTraded)` really equals `pBuyers`.

- [ ] **Step 5: Run the whole suite and the type check**

Run: `npx vitest run && npx tsc --noEmit`
Expected: PASS, `tests/examples.test.ts` included — it validates every bundled
example's params against the manifest, so a missed migration shows up there.

- [ ] **Step 6: Commit**

```bash
git add src/scenes/supply_demand/layout.ts src/examples.json tests/supply-demand.test.ts
git commit -m "supply_demand: one regions list for every shaded area

consumer_surplus, producer_surplus, deadweight_loss, government_revenue and
transfer, all computed against whatever intervention is active rather than
always against the free market — shading the untaxed triangle on a taxed
diagram was a figure that taught the wrong thing.

Two deliberate changes of behaviour: nothing is shaded unless asked for, so a
bare tax: {} no longer draws the deadweight triangle (Hans), and
tax.show_deadweight_loss is deleted rather than kept beside the list.

The welfare identity dCS + dPS + wedge + DWL = 0 is asserted over all six
interventions from the shaded polygons' own areas, which is what validates
the region geometry rather than the other way round."
```

---

### Task 5: Prompt sync, the acceptance example, and the ratchet

Spec §9 and §11. Hans's standing rule is that a new param is taught in the same
round it ships, or the model never uses it.

**Files:**
- Modify: `src/scenes/supply_demand/manifest.json`
- Modify: `src/llm/prompts/compiler-v1.md:89`
- Modify: `src/examples.json` (the full rewrite)
- Modify: `tests/prompt-size.test.ts`

**Interfaces:**
- Consumes: every param and element id from Tasks 1–4.
- Produces: nothing code-facing.

- [ ] **Step 1: Update the manifest**

In `src/scenes/supply_demand/manifest.json`:

1. Add `elasticity` to both `demand` and `supply` in `params_schema`, with this
   description (it must contrast with the neighbouring `steepness` text, which
   explains why a second lever exists):

   > "How flat or steep the curve is, as an elasticity — the lever to use for tax incidence. Words: perfectly_inelastic, inelastic, unit (default, unchanged), elastic, perfectly_elastic; or a number 0.06–1.94 that animates. Unlike steepness, which saturates, this reaches genuinely vertical and genuinely horizontal. Changing it never moves the equilibrium, so two figures at different elasticities are directly comparable."

2. Replace the whole `tax` object with:

```json
"tax": {
  "type": "object",
  "description": "A tax on the market: draws the shifted curve, the new equilibrium, and the two prices the two sides now face — the price buyers pay and the price sellers receive. Use for any request about tax incidence, who bears a tax, tax revenue, subsidies, or deadweight loss from a tax. Nothing is SHADED unless you also list it in `regions`.",
  "properties": {
    "amount": {
      "type": "number",
      "description": "Size of the tax in price-axis units — the axis runs 0-100 and the untaxed equilibrium sits at 50, so 18 is a substantial tax. Default 18. NEGATIVE IS A SUBSIDY: the curve shifts the other way, more is traded, and `government_revenue` becomes a government cost. Numeric, so it animates: tween it from 0 to watch the wedge open and the deadweight loss grow. For kind ad_valorem this is a PERCENTAGE instead (36 = 36%)."
    },
    "side": {
      "type": "string",
      "enum": ["seller", "buyer"],
      "description": "Who the tax is collected from: seller (default) shifts supply up, buyer shifts demand down. The figure comes out IDENTICAL either way — same quantity, same two prices — which is the point worth showing when a request asks whether it matters who pays."
    },
    "kind": {
      "type": "string",
      "enum": ["per_unit", "ad_valorem"],
      "description": "per_unit (default) is a fixed amount per unit, so the curve shifts parallel. ad_valorem is a percentage of the price, so the curve PIVOTS from the origin and the wedge widens as price rises — the realistic shape for VAT or sales tax."
    },
    "label": { "type": "string", "description": "Default \"S + tax\", or \"D - tax\" for a buyer-side tax." }
  }
}
```

3. Add to `price_ceiling` and `price_floor` (same text, swapping the last
   sentence):

```json
"level": {
  "type": "number",
  "description": "Where the line sits, in price-axis units (0-100; the equilibrium price is 50). Numeric, so it animates — sliding a ceiling down opens the shortage and grows the deadweight loss in one gesture. A ceiling only BINDS below the equilibrium price; above it the line is drawn and nothing else happens, which is a legitimate figure about a ceiling that does nothing."
}
```

4. Replace the `regions` property with:

```json
"regions": {
  "type": "array",
  "items": {
    "type": "string",
    "enum": ["consumer_surplus", "producer_surplus", "deadweight_loss", "government_revenue", "transfer"]
  },
  "description": "Which areas to shade. NOTHING IS SHADED UNLESS LISTED HERE — ask for an area on the beat that explains it, not by default. Every area is computed against whichever intervention is set (tax, ceiling or floor), not against the untaxed market: with a tax, consumer surplus is measured from the price buyers actually pay. government_revenue is the tax wedge (a government COST when the amount is negative) and is skipped for a price control, where both sides face one price; transfer is the surplus a price control moves between the two sides, and is skipped for a tax. A binding ceiling's consumer surplus assumes efficient rationing — the buyers who value the good most are the ones who get it."
}
```

5. Add the new `element_ids`: `price_buyers_point`, `price_sellers_point`,
   `label_Pb`, `label_Ps`, `wedge_region`, `label_wedge`, `transfer_region`,
   `label_transfer`, `tax_demand_curve`, `label_D_tax`. Remove nothing.

6. Add two `examples`:

```json
{
  "request": "Show that when demand is inelastic, buyers pay most of a tax.",
  "params": {
    "demand": { "elasticity": "inelastic" },
    "supply": {},
    "equilibrium": { "show": true },
    "tax": { "amount": 18 },
    "regions": ["government_revenue", "deadweight_loss"]
  }
},
{
  "request": "What does a price ceiling cost society?",
  "params": {
    "demand": {},
    "supply": {},
    "equilibrium": { "show": true },
    "price_ceiling": { "level": 32 },
    "regions": ["consumer_surplus", "producer_surplus", "transfer", "deadweight_loss"]
  }
}
```

- [ ] **Step 2: Fix the one wrong sentence in the compiler prompt**

`src/llm/prompts/compiler-v1.md:89` currently ends its animate examples with
"steepening demand shrinks a tax's deadweight-loss triangle" — which does not
happen, because steepness saturates. Replace that clause with:

> "animating `demand.elasticity` swings a tax's burden from buyers to sellers and shrinks its deadweight-loss triangle (use `elasticity`, not `steepness`, for anything about slope: steepness stops changing the picture above about 1)."

That is the only edit to this file. Everything else scene-specific lives in the
manifest, which `src/scenes/catalog.ts:69` embeds into the prompt verbatim.

- [ ] **Step 3: Rewrite the acceptance example**

`src/examples.json`, the item titled **"Economics 3 · Who really pays a tax"**
(around line 25532). It is the round's done-condition (spec §11) and it fills
`{{EXEMPLARS}}` in the compiler prompt, so it teaches the model by example.

- `params.demand`: `{ "elasticity": 0.5 }` instead of `{ "steepness": 0.35 }`
- `params.supply`: `{}`
- `params.tax`: `{ "amount": 18 }`
- add `params.regions`: `["deadweight_loss"]`
- insert these two beats after the one that draws
  `["tax_equilibrium_point", "tax_guide_lines"]`. They are the figure finally
  answering its own question, so they carry the two best sentences:

```json
{
  "draw": ["price_buyers_point", "label_Pb"],
  "speak": "Buyers now hand over this much — noticeably more than before the tax."
},
{
  "draw": ["price_sellers_point", "label_Ps"],
  "speak": "But the shop only keeps this much. The gap between the two lines is the government's, and neither side chose how to split it."
}
```
- replace `{"animate": {"demand.steepness": 1.2}}` with
  `{"animate": {"demand.elasticity": 1.5}}` and
  `{"animate": {"supply.steepness": 0.35}}` with
  `{"animate": {"supply.elasticity": 0.5}}` — both now move for their whole
  3.5 seconds instead of stalling partway
- keep `dwl_region` in its existing `draw` beat; it is now reached via `regions`

- [ ] **Step 4: Re-pin the prompt ratchet — measure, never estimate**

Run: `npx vitest run tests/prompt-size.test.ts`

It will fail with `expected <actual> to be less than or equal to 204717`. Take
that **actual** number and set `BASELINE_SYSTEM_CHARS` to it
(`tests/prompt-size.test.ts:341`).

`BASELINE_SCHEMA_CHARS` (line 342, 81722) should be **unchanged**: `apiSchema()`
is the spec-level schema and this round touches only a scene manifest. If it
did move, something edited `src/spec/schema.ts` — find it and revert it rather
than re-pinning.

Add a dated note above the constants, in the established style:

```
// Re-pinned 2026-09-21 (supply & demand welfare): supply_demand's manifest
// gains `elasticity` on both curves (the lever for tax incidence, where
// `steepness` saturates), `tax.amount/side/kind`, `level` on both price
// controls, three more `regions` members, ten element ids and two examples.
// The scene's params_schema is embedded verbatim in the catalog
// (src/scenes/catalog.ts:69), so all of it lands on the system prompt; the
// spec-level schema is untouched (81722). One sentence in compiler-v1.md's
// animate bullet also changed — it promised that steepening demand shrinks a
// deadweight-loss triangle, which saturation means it does not.
// system 204717 -> <measured>.
```

- [ ] **Step 5: Verify everything**

Run: `npx vitest run && npx tsc --noEmit && npm run build`
Expected: all pass. `npm run build` matters because Netlify runs it and Vitest
does not type-check.

Then look at the acceptance example end to end and confirm it reads: the
figure should now show two prices, the burden split should be visibly uneven,
and both animate beats should move for their full duration.

- [ ] **Step 6: Commit**

```bash
git add src/scenes/supply_demand/manifest.json src/llm/prompts/compiler-v1.md src/examples.json tests/prompt-size.test.ts
git commit -m "supply_demand: teach the model the new params, and fix the example that needed them

Manifest gains elasticity, the tax fields, control levels, the widened
regions enum, ten element ids and two examples; the prompt ratchet is
re-pinned to the measured size.

compiler-v1.md promised that steepening demand shrinks a deadweight-loss
triangle. It does not — steepness saturates at 1.048 — so the sentence now
points at elasticity.

The bundled 'Who really pays a tax' example could not answer its own
question: there was no P_b or P_s in the scene, and one of its two animate
beats ran from 0.35 to 1.2 and therefore stopped moving partway through its
3.5 seconds. It now draws both prices and animates elasticity."
```

---

## Notes for the executor

- **Task 1 is independent**; Tasks 2→3→4 are strictly sequential (each reads the
  `Intervention` the previous one shaped); Task 5 depends on all of them.
- **If the welfare identity fails**, do not adjust the tolerance. It is exact
  geometry, and a real failure means a region polygon does not close on its
  curve. `toBeCloseTo(0, 0)` is already loose enough for polyline sampling.
- **The logical canvas is y-UP** (measured; see Task 2's note). A higher price
  is a LARGER logical y. Every price comparison in the tests is written in
  logical coordinates.
- **Do not widen the elasticity clamp** to make a figure look more extreme. The
  whole of `curves.ts`'s interpolation assumes a function of x.
