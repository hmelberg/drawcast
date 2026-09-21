# Supply & demand — elasticity, tax decomposition, and welfare under any intervention

Status: DESIGNED 2026-09-21, not yet implemented. Written with Hans after the
chess board-switcher round (main c676b84). Implementer: read this whole file
first; it assumes the drawcast repo and nothing else.

## 1. What this is

`supply_demand` can draw consumer and producer surplus, and a deadweight-loss
triangle from a tax. It cannot say **who pays the tax**, **how much the
government collects**, or **what a price control costs** — and its one lever on
slope is saturated, so it cannot draw the elastic/inelastic contrast that the
incidence lesson is made of.

Hans, 2026-09-21: *"What about how to split the effect of a tax into different
parts? (Reveneue to the government, consumer surplus change, producer surpplus
change?"* — then *"BUt keep sttpness also, just add elasticity scale (if
possible)"* and *"price ceiling and floor should alos be easy to visualise
(Mayby wait for a seocnd round if that is better)"*.

This round answers all three. The third one turned out to be the load-bearing
request: making price controls carry welfare too is what forces §5's single
intervention model, which is a better design than the tax-only branch this
round started as.

## 2. What already exists (read this before designing anything)

Measured in the repo on 2026-09-21, not recalled.

- **`src/scenes/supply_demand/layout.ts`**, 372 lines, plain TS (not a pack
  template with a `layout: |` body). It owns an internal 0–100 × 0–100 domain
  mapped onto the plot area; `D0 = 2`, `D1 = 96` is the usable x slice.
- **The default equilibrium is exactly (49, 50).** With `steepness: medium`
  (k = 1) and `curvature: linear`, demand is `y = 92 − 84t` and supply is
  `y = 8 + 84t` over `x = 2 + 94t`. Both curves are symmetric about it, so a
  per-unit tax on the default figure splits 50/50 — the sanity anchor for
  every incidence test in §10.
- **`qualitativeShape`** (`src/layout/curves.ts:27`) spreads the endpoints
  `0.42k` either side of 0.5 and clips to `[0.06, 0.94]`, so the y-span
  **saturates at k ≈ 1.048**. `steep` (1.5) draws the same curve as `medium`
  (1); an animate from 1 to 2.5 renders a still picture. This is already
  documented in the function's own docstring, in both manifest `steepness`
  descriptions, and in the 2026-09-20 re-pin note in `tests/prompt-size.test.ts`.
  It is a known, written-down limit, not a discovery.
- `qualitativeShape` already accepts `direction: "flat" | "vertical"`, which
  `supply_demand` never uses. **We are not using them either** — see §4.
- **Its other consumer is `src/layout/tier2.ts:978`** (spec-level `curve`
  elements). Anything changed inside `qualitativeShape` lands there too. §4
  therefore changes nothing inside it.
- **`betweenRegion`** (`layout.ts:357`) is already generic: two polylines and
  an x-interval, returns the closed polygon between them. It is called once
  today, for the tax DWL. §5 calls it for every intervention.
- **`interpolateAtX` / `solveForX` / `intersectPolylines`** (`curves.ts:146`,
  `186`, `159`) all assume a polyline that is **a function of x**;
  `intersectPolylines` samples the overlapping x range at N = 200 and looks for
  a sign change. §4's clamp exists to keep that assumption true.
- **`COLORS` is `Object.freeze`d and exposed live on `kit`** to compiled
  template bodies (`model.ts:200`). Adding a token is a shared-surface change,
  so §8's wedge and transfer rectangles reuse `COLORS.accent` rather than
  adding one.
- **Three hard-coded constants that this round parameterises**, all with the same
  defect — invisible to the model, unanimatable:
  - `const taxAmount = 18` (`layout.ts:172`)
  - the ceiling at `eq[1] * 0.62` = 31 (`layout.ts:207`)
  - the floor at `Math.min(eq[1] * 1.35, 92)` = 67.5 (`layout.ts:216`)
- **`tests/supply-demand.test.ts`**, 172 lines, 11 tests. Two of them
  (`numeric steepness…`, line 99) assert the current steepness mapping and must
  keep passing unchanged — see §4's identity guarantee.
- **The prompt-size ratchet** (`tests/prompt-size.test.ts`) is an exact ceiling
  with zero slack, re-pinned per round with a dated note. The manifest's
  `params_schema` is embedded verbatim in the system prompt, so every
  description written here is paid for twice.

So the gap is narrower than it looks: the region machinery, the polygon
helper, and the curve maths are all present. What is missing is a second price,
a rectangle, a lever that does not saturate, and one abstraction to hang them on.

## 3. Decisions taken

Each was Hans's call, recorded with its reasoning so a later round does not
silently reverse it.

1. **`steepness` stays; `elasticity` is added beside it, not instead.**
   Hans: *"BUt keep sttpness also, just add elasticity scale (if possible)."*
   They are levers on different axes (§4), so they compose rather than compete,
   and `elasticity` defaults to an exact identity. No existing spec changes.
2. **CS/PS auto-follow the active intervention.** No `regions_at` param. The
   current behaviour — shading the free-market triangle on a taxed diagram — is
   silently wrong, and a figure that teaches the wrong thing is a bug, not a
   default. A spec wanting the pre-intervention triangle omits the
   intervention.
3. **Price controls ship in this round, not a second one.** Hans offered to
   defer. Declined, because ceiling/floor welfare adds no branch — it *removes*
   the branch the tax-only design was about to grow (§5). The fixed costs of a
   second round (re-reading the file, a second manifest edit, a second
   compiler-v1.md sync, a second prompt re-pin) would have been paid twice for
   work that is a thin layer on machinery being built regardless.
4. **`P_b` / `P_s` markers are default-on. Every shaded area is opt-in,
   including the deadweight loss.** Hans, 2026-09-21: *"NO deadweight area is
   not visible by default. it is something we turn on when e want to explain
   it."* Without `P_b`/`P_s` the tax wedge is not visible as two prices at all,
   so those stay on; the areas are explanatory and clutter a figure that is
   only showing the wedge. This is a **behaviour change**: `tax: {}` draws the
   DWL triangle today and will not after this round.
5. **All five shaded areas live in one `regions` list** (§5.1), and
   `tax.show_deadweight_loss` is deleted rather than kept alongside it. Falls
   out of decision 4: once the DWL is opt-in it is an opt-in shaded area like
   the other four, and the repo has no users to keep compatible. Removes three
   params (`show_deadweight_loss`, `show_revenue`, a transfer flag) and three
   prompt descriptions in favour of one enum.
6. **All four tax dimensions in one round**: `amount`, `side`, `kind`
   (per-unit and ad valorem), and negative-amount subsidies. §6.3's rule is
   what makes this one code path instead of four.
7. **Efficient rationing is assumed** for a binding price ceiling — the
   highest-value buyers get the good, so CS is the area under D above the
   ceiling up to `Q_s`. This is the textbook convention and it must be stated
   in the manifest description, because the alternative (random rationing)
   gives a visibly different and smaller CS.
8. **Full prompt sync in the same round** — manifest, `compiler-v1.md`,
   fewshot, re-pin. Hans's standing rule.

## 4. Elasticity — a second lever that cannot saturate

`steepness` widens the curve's **y-span**, which is exactly why it saturates:
the span hits the plot edges. `elasticity` scales the curve's **x-run** about a
pivot, which has no ceiling.

    s  = tan(e · π/4)              e clamped to [0.06, 1.94]
    x' = px + (x − px) · s         then drop points outside the plot

Applied to the sampled polyline *after* `shapedCurve`, so **nothing inside
`qualitativeShape` changes** and `tier2.ts:978` is untouched.

| `elasticity` | `s` | reads as |
|---|---|---|
| 0.06 (`perfectly_inelastic`) | 0.047 | vertical — x-run 4.4 units over the full height |
| 0.5 (`inelastic`) | 0.41 | steep |
| **1 (`unit`, default)** | **1** | **exactly today's curve** |
| 1.5 (`elastic`) | 2.41 | flat |
| 1.94 (`perfectly_elastic`) | 21.2 | horizontal — 4.0 units of height across the plot |

`tan(π/4) = 1` exactly, so `e = 1` is a true identity: every existing figure
renders byte-identically and the two steepness tests at
`tests/supply-demand.test.ts:99` keep passing untouched.

**The clamp is load-bearing, not cosmetic.** At `e = 0` the curve collapses to
a literal vertical line, and `interpolateAtX`, `solveForX` and
`intersectPolylines` all assume a function of x (§2). `[0.06, 1.94]` keeps
every curve strictly single-valued while still reading as vertical and
horizontal. Do not widen it.

**The pivot is the payoff.** `px` is the crossing of the two *un-elasticized*
curves — computed first, shared by both. Since scaling about `px` fixes `px`,
**changing either elasticity provably cannot move the equilibrium.** That is
what makes the incidence lesson work: vary demand elasticity, watch the burden
split swing, with E nailed in place. When `supply` is null, `px` is the
midpoint of the demand curve's run.

Words map onto the numbers above; a bare number is also accepted, so the value
animates. Both `demand` and `supply` get the param.

## 5. One intervention, not three

This is the core of the round. A tax, a subsidy, a ceiling and a floor are all
the same object:

    Intervention = { qTraded, pBuyers, pSellers }

      tax / subsidy   qTraded = Q_t   pBuyers = D(Q_t)     pSellers = S(Q_t)
      price ceiling   qTraded = Q_s   pBuyers = pSellers = P_c
      price floor     qTraded = Q_d   pBuyers = pSellers = P_f

Precedence when several are set: **tax > ceiling > floor**. With none set,
`qTraded = Q*` and `pBuyers = pSellers = P*`, which reduces to today's
free-market behaviour — so there is no "no intervention" special case either.

Everything downstream then stops branching:

- **CS** = under D, above `pBuyers`, over `[D0, qTraded]`
- **PS** = above S, below `pSellers`, over `[D0, qTraded]`
- **wedge** = `(pBuyers − pSellers) × qTraded`, a rectangle. Government revenue
  for a tax; government **cost** for a subsidy (negative, relabelled); and
  *automatically zero-height, therefore skipped*, for a ceiling or floor, where
  buyers and sellers face one price. No special case.
- **DWL** = `betweenRegion(D, S, min(qTraded, Q*), max(qTraded, Q*))` — the
  existing helper, one call, correct for tax/ceiling/floor (Q below Q*) and for
  a subsidy (Q above Q*) alike.

### 5.1 One list for every shaded area

    regions: ["consumer_surplus" | "producer_surplus" | "deadweight_loss"
              | "government_revenue" | "transfer"]

Empty by default: **a bare `tax: {}` draws the wedge and its two prices and
shades nothing** (decision 3.4). Each member is computed against whatever
intervention §5 resolved, so the same list works for a tax, a subsidy or a
price control, and a member that has no area under the active intervention is
skipped rather than erroring:

| member | tax / subsidy | ceiling / floor | none |
|---|---|---|---|
| `consumer_surplus` | under D above `P_b` | under D above the control | the free-market triangle |
| `producer_surplus` | above S below `P_s` | above S below the control | the free-market triangle |
| `deadweight_loss` | the `betweenRegion` triangle | same | skipped (no area) |
| `government_revenue` | the wedge rectangle | skipped (zero height) | skipped |
| `transfer` | skipped | `(P* − P_c) × Q_s` or `(P_f − P*) × Q_d` | skipped |

`tax.show_deadweight_loss` is **deleted**, not deprecated (decision 3.5).

The regions close exactly, which is the second reason to define `pBuyers` and
`pSellers` by evaluating the *untaxed* curves at `qTraded`: `D(Q_t) = P_b` and
`S(Q_t) = P_s` by construction, so the polygon's right edge lands on the curve
with no gap. Under a binding ceiling `D(Q_s) > P_c`, so CS is a trapezoid with
a vertical right edge — correct, and the visible consequence of decision 3.7.

## 6. Tax

### 6.1 Params

    tax: {
      amount?: number          // price-axis units; default 18 (today's constant)
      side?: "seller" | "buyer"        // default "seller"
      kind?: "per_unit" | "ad_valorem" // default "per_unit"
      label?: string
    }

Shading is not here — it is `regions` (§5.1).

`amount` is clamped to `[-40, 60]`. Negative is a subsidy. For
`kind: "ad_valorem"` it is a **percentage**, clamped to `[-50, 200]`.

Default 18 reproduces today's *geometry* exactly. `tax: {}` is **not**
unchanged, though: it no longer shades the DWL triangle (decision 3.4). That is
the one deliberate regression in this round.

### 6.2 The shift

| side | per_unit | ad_valorem |
|---|---|---|
| seller | `S: y' = y + t` | `S: y' = y · (1 + a/100)` |
| buyer | `D: y' = y − t` | `D: y' = y / (1 + a/100)` |

Ad valorem pivots from the origin instead of translating, which is the visible
difference worth teaching. Points shifted off the plot are **dropped, not
clamped** — the existing idiom at `layout.ts:133` and `:174`, which preserves
the slope.

### 6.3 The rule that collapses four cases into one

1. Shift the taxed curve per §6.2.
2. `Q_t` = crossing of the shifted pair.
3. **`P_b` = the *original* demand curve at `Q_t`. `P_s` = the *original*
   supply curve at `Q_t`.**

Step 3 is the whole trick. `P_s = P_b − t` holds only for a per-unit tax;
"evaluate the untaxed curve at `Q_t`" holds for every combination, including ad
valorem, where the wedge is `P_b − P_b/(1+a/100)`.

Worked defaults, for the implementer to check against. Computed against the
§2 curve equations on 2026-09-21, not estimated:

| case | `Q_t` | `P_b` | `P_s` |
|---|---|---|---|
| per-unit 18, seller | 38.9 | 59.0 | 41.0 |
| per-unit 18, buyer | 38.9 | 59.0 | 41.0 |
| ad valorem 36%, seller | 40.5 | 57.6 | 42.4 |
| subsidy −18, seller | 59.1 | 41.0 | 59.0 |

The first two rows being identical is the **tax-equivalence theorem**, and it
falls out of §6.3 rather than being coded — which is why §10.4 asserts it.

## 7. Price controls

`price_ceiling.level` and `price_floor.level`: numeric, price-axis units,
animatable, clamped to `[2, 96]`. Defaults preserve today's computed values
(31 and 67.5 on the default figure) so existing specs are unchanged.

A ceiling only bites below `P*` and a floor only above it; when a level does
not bind, the gap and its arrow are omitted, any requested `deadweight_loss` or
`transfer` region is skipped, and the line is still drawn. Say this in the description — a non-binding control is a legitimate
figure ("this ceiling does nothing"), not an error.

`regions: ["transfer"]` (both controls) shades `(P* − P_c) × Q_s`, or
`(P_f − P*) × Q_d`: the surplus that moves between the two sides. This is the
actual point of a price control and it uses §5's rectangle primitive.

Animating `level` down from `P*` opens the shortage and grows the DWL in one
gesture. That falls out of making it numeric; no extra work.

## 8. New element ids

    price_buyers_point / price_sellers_point   dots at (qTraded, P_b) and (qTraded, P_s)
    label_Pb / label_Ps                        price-axis labels
    wedge_region                               revenue (tax) or cost (subsidy) rectangle
    label_wedge                                "Government revenue" / "Government cost"
    transfer_region / label_transfer           price-control transfer rectangle
                                               (all three only when `regions` asks)
    tax_demand_curve / label_D_tax             buyer-side tax (mirrors tax_supply_curve)

`cs_region`, `ps_region`, `dwl_region` and their labels keep their ids and
change only *where* they are computed. `wedge_region` and `transfer_region` use
`COLORS.accent` at low opacity, per §2's note on the frozen palette.

## 9. Prompt sync

Per decision 3.8, in this round:

- **manifest**: the two `elasticity` descriptions (with the saturation contrast
  spelled out, since the neighbouring `steepness` text explains why it exists),
  the four `tax` fields, the two `level` fields, the new enum members on
  `regions` (three of them, §5.1), the new `element_ids`, and two new `examples` — one incidence
  figure, one price-control welfare figure.
- **`compiler-v1.md`**: one sentence that elasticity is the lever for
  incidence, one that CS/PS now follow the intervention, and one that the
  shaded areas are opt-in — the model must be told to ask for
  `deadweight_loss`, because it will otherwise assume a tax figure comes with
  one, as it did before this round.
- **`fewshots.json`**: one tax-incidence example.
- **`tests/prompt-size.test.ts`**: re-pin both constants to the measured new
  size, with a dated note in the established style. Measure, do not estimate.

## 10. Testing

TDD. The anchor is the **welfare identity**, computed by shoelace over the
polygons actually shaded:

    ΔCS + ΔPS + wedge + DWL ≈ 0

One assertion validates every region's geometry at once, and it is run over all
five interventions (per-unit tax both sides, ad valorem, subsidy, ceiling,
floor). A sign error, a wrong bound or an off-by-one in a polygon cannot
survive it.

Also:

1. `elasticity: 1` leaves `curveSamples` byte-identical to omitting it.
2. The pivot invariant: sweep `elasticity` across `[0.06, 1.94]` on each curve
   in turn; `anchors.equilibrium_point` never moves.
3. `perfectly_inelastic` demand ⇒ `P_b − P* ≈ t` and `P_s ≈ P*` (buyers bear
   ~all); `perfectly_elastic` demand ⇒ the mirror.
4. Seller-side and buyer-side taxes of equal size give equal `Q_t`, `P_b`, `P_s`.
5. `wedge_region` area ≈ `|P_b − P_s| × qTraded`.
6. Subsidy: `Q > Q*`, wedge is negative, label reads "Government cost".
7. A non-binding ceiling draws the line and omits gap/DWL.
8. The existing canvas-bounds test (`supply-demand.test.ts:40`) extended to
   every new combination, including both elasticity extremes.
9. The two existing steepness tests (`supply-demand.test.ts:99`) pass
   **unmodified** — the §4 identity.
10. **A bare `tax: {}` shades nothing**, and `regions: ["deadweight_loss"]`
    shades the same triangle it used to (decision 3.4).

**Three** call sites pass the deleted `show_deadweight_loss: true` and must be
migrated to `regions: ["deadweight_loss"]` — grepped across the repo, not
assumed: `tests/supply-demand.test.ts:41` (canvas bounds), `:66` (the tax
test), and `src/examples.json:25550`, which is §11's acceptance case.

## 11. The acceptance case is already in the repo, and it is already broken

`src/examples.json:25532` is a bundled example called **"Economics 3 · Who
really pays a tax"**, request: *"A tax is collected from sellers, so why do
buyers end up paying part of it?"*

It cannot answer its own question. There is no `P_b` and no `P_s` in the
scene, so the figure gestures at the answer by glowing the two equilibrium
dots. That is the gap in §1, sitting in the shipped examples.

It is also **half-dead as an animation**, which is §4's case made concretely.
Its last two beats are:

    animate: { "demand.steepness": 1.2 }   duration 3.5
    animate: { "supply.steepness": 0.35 }  duration 3.5

Steepness saturates at k ≈ 1.048 (§2), so the demand tween runs from 0.35 and
then **stops moving partway through its 3.5 seconds** while the narration keeps
going. The supply tween, running downward from 1, works. One of the two beats
in drawcast's own incidence example is a still picture.

After this round it should be rewritten to:

- animate `demand.elasticity` rather than `demand.steepness`, which is live
  across its whole range and is the lever the beat is actually reaching for;
- draw `price_buyers_point` / `price_sellers_point` and `label_Pb` / `label_Ps`,
  so "buyers end up paying part of it" is visible rather than implied;
- ask for `regions: ["deadweight_loss"]` explicitly, per decision 3.4;
- optionally shade `government_revenue` on the beat about lost trades.

This matters more than one example, because `examples.json` is load-bearing
twice (`tests/examples.test.ts:1`): it is the Examples list a new user sees,
**and** it fills the `{{EXEMPLARS}}` slots in the compiler prompt. Rewriting
this one teaches the model the new params by demonstration, which is a stronger
prompt-sync lever than the §9 fewshot. Treat the rewritten example as the
round's acceptance test: if it reads correctly end to end, the round is done.

## 12. Non-goals, written down so they stay out

Deferred because they need genuinely new geometry and get no cheaper by being
crammed in here:

- **Externality / Pigouvian tax** — needs a third curve (MSC or MSB), the
  social optimum, and the externality DWL. The strongest candidate for the next
  round, and the one closest to Hans's own field.
- **Tariff / quota** — needs a world-price line and import geometry.
- **Random (inefficient) rationing** under a ceiling, and black-market
  variants. Decision 3.7 fixes the convention to efficient rationing.
- **Elasticity on spec-level tier-2 `curve` elements.** Local to this scene.
- **A numeric read-out of ΔCS / ΔPS / revenue / DWL.** The figure shades the
  areas; putting numbers on them is a separate question about units, since the
  0–100 domain is not a currency.

## 13. Files

| file | change |
|---|---|
| `src/scenes/supply_demand/layout.ts` | the bulk: §4 elasticity, §5 intervention model, §6 tax, §7 controls, §8 elements |
| `src/scenes/supply_demand/manifest.json` | params, element_ids, two examples (§9) |
| `src/llm/prompts/compiler-v1.md` | two sentences (§9) |
| `src/llm/prompts/fewshots.json` | one incidence example (§9) |
| `tests/supply-demand.test.ts` | §10; the two steepness tests stay unmodified |
| `src/examples.json` | rewrite the incidence example (§11) — the acceptance case |
| `tests/prompt-size.test.ts` | re-pin both constants with a dated note |

`src/layout/curves.ts` is **not** touched — see §4.
