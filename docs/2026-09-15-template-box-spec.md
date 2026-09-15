# Template box — any template shares the page

Status: specification, NOT scheduled. Written 2026-09-15 from a read of the
code, no implementation. Implementer: read this whole file first, then §9
(concurrent work) before creating a branch. Estimated size: one small round,
about two days including tests and the prompt sync.

## 1. What this is

A `box` that every template accepts, so a template can take one region of
the canvas and leave the rest to a code panel or to freehand elements. Today
five templates (bar_chart, line_chart, scatter_plot, heatmap, data_table)
declare `box` in their own `params_schema` and re-lay themselves out inside
it. The other 78 own the whole 1000 × 750 canvas, so a script beside
sir_compartments, supply_demand, decision_tree or any pack template paints
the figure over the code. The `overlap-code-figure` lint exists because this
keeps happening; the figure split (`src/layout/figure-split.ts`, Hans
2026-09-04, "de skal ha hver sine områder") fixed it for the five.

This spec finishes that thought: the split's default applies to every
template, and an author or the compiler can say `box: "right"` for any of
them.

It is a layout DEFAULT plus one transform. It is not a layout engine, not
template-as-element (ROADMAP Phase C, still deferred), not an overlay model
(§8).

## 2. Problems it solves, in order of frequency

1. **Template + code panel for the other 78 templates.** "SIR model on the
   right, the script that solves it on the left" needs no coordinates from
   anyone.
2. **Template + freehand elements with room of their own.** A template in
   `"left"` leaves the right half genuinely empty for an equation, a small
   table, a portrait, an annotation block. Today freehand lives in whatever
   margin the template happens to leave.
3. **On-demand templates get sharing for free.** A template the model writes
   cannot be trusted to implement its own box. The fit is applied outside the
   template body, so every template behaves like a built-in.
4. **Timed insets.** A small template drawn for a beat and erased, the cameo
   idiom (`portrait.cameo`), placed by a region name.
5. **Groundwork for template-as-element.** Each embedded instance in that
   future design needs exactly this fit step.

Not solved: two templates on one page (one `spec.template` remains), true
overlays over a visible figure (§8), and text legibility, which this makes
WORSE unless §5 ships in the same change.

## 3. Decisions

- **One vocabulary, one place.** `box` stays in `spec.params.box`, where the
  five data templates already read it and where `figureSplit` already writes
  it. No second top-level field.
- **A region name or a rectangle.** `box: "left" | "right" | "top" |
  "bottom" | "full"` or `box: {x, y, w, h}` in canvas units. The names are
  `FIT_NAMES` from `src/layout/regions.ts`, the same regions the group `fit`
  verb takes, resolved by `fitRegion`. The compiler learns ONLY the names.
- **No bare size, no share.** A width without a position forces the layout
  to invent placement (a layout engine — the split deliberately is not one).
  A fraction is a second numeric vocabulary beside the rectangle. Neither.
- **Native box wins.** A template whose `params_schema` declares `box` gets
  the resolved rectangle as a param and lays itself out, as today. Every
  other template is laid out on the full canvas and then FITTED into the
  box (§4). Native means "re-layout at full text size"; fitted means "shrink,
  with a text floor". Templates where text dominates (tables, dense charts)
  should keep or gain a native box; compartment chains, planes and diagrams
  with a handful of labels are fine fitted.
- **Uniform scale only.** `fitTransform` (`src/layout/place.ts`) scales
  by `min(box.w / union.w, box.h / union.h)` and centres. A figure squeezed
  on one axis is a different figure. A tall box for a wide template leaves
  vertical slack; that is correct.
- **Fit the ink union, not the nominal canvas.** Most templates leave
  margins; fitting the union of their drawables gains 10–15 % of scale for
  free. Label requests are not yet placed at fit time, so the union excludes
  them; pad the union by one label height on each side so placed labels tend
  to stay inside the box. Spill is a lint note, not an error.
- **Stroke width holds.** `scaleDrawables` scales points, text size, images
  and group boxes, not `style.strokeWidth`. Keep that: a smaller figure in
  the same pen is what a hand draws.
- **Default when only a code panel is present.** `templateTakesBox` becomes
  true for every template that lays out, so `figureSplit` invents the box
  for all of them exactly as it does for the five today. An explicit
  `params.box` still wins (`boxGiven`).

## 4. Mechanism

All of it lives in `layoutSpec` (`src/layout/layout.ts`), right after
`scene.layout(spec.params)` returns and BEFORE `inverseDomainMapping` seeds
`curveSamples`. The sweep (`src/render/sweep.ts`, worktree-sweep) and every
tween re-run `layoutSpec` per frame, so a fit placed here reaches them with
no further work; a fit placed in the renderer would not.

Steps:

1. **Resolve the box.** `params.box` is a name → `fitRegion(name)`; a
   rectangle → validate with the same predicate `isFigureBox` uses; anything
   else → warning, ignore the box.
2. **Native or fitted?** `templateTakesBox(spec.template)` (already exists:
   `params_schema.properties.box !== undefined`). Native: pass the resolved
   rectangle in `params.box` (a name must be resolved BEFORE the template
   sees it; the five templates validate a rectangle and fall back to
   `kit.plotArea()` otherwise). Fitted: continue.
3. **Union.** `unionOfBoxes` over the scene's drawables (`layout/boxes.ts`
   has the per-drawable bbox), padded (§3).
4. **Transform.** `const { s, dx, dy } = fitTransform(union, box)`. Apply:
   - `scaleDrawables(sceneLayout.drawables, s, dx, dy)` — already handles
     stroke, area (+holes), text (pos + fontSize), image, group (+box),
     clip, shapeHint.
   - `sceneLayout.labels`: `anchor` mapped; `fontSize *= s` then the floor
     (§5). The group fit in tier2 (`fitGroup`) does NOT touch label
     requests today — this is new and needs its own test.
   - `sceneLayout.anchors`: mapped (`shiftPoints` only translates; write
     `mapPoints(rec, map)` next to it in place.ts and use it for both).
   - `sceneLayout.curveSamples`: mapped in LOGICAL coordinates, then the
     existing `inverseDomainMapping` runs on the mapped samples as now.
     See §6 for why that is not enough on its own.
5. **Record the fit** on the `LayoutResult` (`fit?: { s, dx, dy, box }`)
   so lint (§7) and the widget scene (§6) can read it. Nothing else in the
   pipeline needs to know a fit happened: hit-testing, the tray, ghosts,
   arrange, animate, fade all read drawable geometry.

Behaviour that MUST be unchanged: a spec with no `params.box` and no code
element lays out byte-identically to today. The examples gate
(`tests/examples-*.test.ts`) is the proof; do not touch its snapshots.

## 5. The text floor — ships in the same change

Template labels are written at 15–30 units. A half-width box scales by
roughly 0.46 (nominal canvas) or 0.55–0.6 (ink union). A 15-unit label
becomes 7–9 units: about 8 px on a desktop viewer, 3–4 px on a phone.
Nothing guards this today — `MIN_FONT_SIZE` in `text-style.ts` clamps the
spec's BASE size, not drawn text — and the group fit has no floor either.

Rule: **hold text, shrink geometry.** After scaling, every text drawable and
every label request is clamped to `max(fontSize, TEXT_FLOOR)` with
`TEXT_FLOOR = 14` logical units (a constant in `layout/text-style.ts`, next
to `MIN_FONT_SIZE`, with a comment saying which is which). Positions are
still scaled. Labels then take a larger share of the box; the label solver
moves them; the existing overlap lints report what no longer fits. This is
what a person does when drawing the same figure small.

Lint (§7) says when the fit scale is below 0.5, because at that point the
floor is doing most of the work and the author should give the box more
room or pick a template with a native box.

Open, decide at implementation with one look: whether the group `fit` verb
should get the same floor. Probably yes, same constant, separate commit.

## 6. Domain coordinates and widgets

`domainMapping` / `inverseDomainMapping` (`layout/layout.ts`) map the spec's
domain to `plotArea()`, the STANDARD plot area. After a fit, a template's
axes no longer sit there. Two consumers care:

- **Tier-2 elements placed in domain units on a scene curve** (a point at
  x = 50 on the template's curve, a region between scene curves). Step 4
  maps `curveSamples` before the inverse mapping, so the samples are
  consistent with the fitted ink — but a freehand point given in domain
  units is still placed by the standard mapping and lands off the fitted
  curve. Decision: compose the fit into the domain mapping when a fit is
  present (`toLogical = fit ∘ standard`, inverse likewise), passed through
  the tier-2 `ctx`. This is a small change with a test that must be written
  to FAIL first: a point at the curve's known domain x, template fitted
  `"right"`, assert it lies on the fitted polyline.
- **Widgets** (`scenes/widget-scene.ts`): `toDomain` / `toLogical` are built
  from the same mapping; give them the composed one. `boxes` and `rings`
  derive from drawables and follow automatically. `controls.ts`
  hit-testing reads drawable boxes (the R9 visible-set lesson) and needs
  nothing — and it is owned by the widgets-4 worktree (§9); do not touch it.

Templates whose interactions compute geometry from `kit.plotArea()` or
`CANVAS` at INTERACTION time rather than from their own drawables would
break under a fit. A grep of `src/ui`, `widget-run.ts`, `widget-scene.ts`
and `scenes/space` found none (`src/ui/dom.ts` is the only `CANVAS` reader
and it is the stage's own size). Re-run that grep at implementation; the
answer may have changed under the live-controls and widgets rounds.

## 7. Lint

New rule `fit-scale`, severity `warn`, when a fitted template's scale is
below 0.5: "template <t> is fitted at <s> into box <name|rect>; labels are
held at the floor — give it a taller region, or use a template with a
native box". A note (not a warn) when placed labels spill outside the box.

`overlap-code-figure` keeps its message but its "give the template a box"
hint is now true for every template; reword the hint to name the regions.

The lint must NOT fire on the five native-box templates, which do not
shrink.

## 8. Positions and overlays

Any position works with the same transform: the five names, a corner, an
inset. Two halves and two bands are all the names give; quadrants or
thirds are a five-line addition to `regions.ts` if a lesson asks.

A box "on top" of another figure is a different kind of box. Paint order is
global by KIND: the SVG backend keeps three layers — all areas, then all
strokes, then all text, for every element together (`svg-backend.ts`,
`layers[0..2]`). A backing paper rectangle for an overlay lands in the
bottom layer under the strokes it is meant to cover, so a fitted template
placed over a figure draws its ink THROUGH the ink beneath. That is a
collision, not an overlay.

What exists is timed, not stacked: draw the inset on its beat, `erase` it
(Command.erase), redraw. The cameo portrait is this idiom. Lint already
accepts overlap between elements that never coexist. A stacking model
(per-element paint groups, or a `plate` flag painting opaque paper above
everything drawn before it) is out of scope; the plate flag is the cheaper
of the two if the day comes.

## 9. Concurrent work in this repo — read before branching

As of 2026-09-15 the main checkout (`main` at 3a06429) is 14 commits BEHIND
`origin/main` (live-controls stage 1 landed from its worktree). Two
worktrees are LOCKED and active:

| Worktree | Branch | Files it changes vs origin/main |
|---|---|---|
| `.claude/worktrees/sweep` | `worktree-sweep` | `src/render/sweep.ts`, `tests/sweep-model.test.ts`, its plan doc |
| `.claude/worktrees/widgets-4` | `worktree-widgets-4` | `src/ui/controls.ts`, `src/ui/widget-host.ts`, `src/ui/infocard.ts`, `src/ui/connect-gate.ts`, `src/styles.css`, `tests/widget-host.test.ts`, `tests/cursor.test.ts` |

Rules for this round:

- **Branch from `origin/main`, not from the local `main`.** `git fetch`
  first; the memory note about the 90-commits-behind trap applies.
- **Files this spec touches:** `src/layout/layout.ts`, `src/layout/place.ts`
  (`mapPoints`), `src/layout/regions.ts` (export a resolver), `src/layout/
  figure-split.ts` (predicate only), `src/layout/text-style.ts`
  (`TEXT_FLOOR`), `src/scenes/widget-scene.ts` (composed mapping),
  `src/lint/lint.ts` (`fit-scale`), `src/spec/schema.ts`, `src/scenes/
  params-check.ts` (§10), `src/llm/prompts/compiler-v1.md`, tests. None of
  these is in either worktree's diff. `src/ui/controls.ts` and
  `src/ui/widget-host.ts` are OFF LIMITS — widgets-4 owns them; anything
  this round wants there is a follow-up after that worktree merges.
- **The sweep relies on `layoutSpec` per frame.** Keeping the fit inside
  `layoutSpec` (§4) is what makes the two rounds independent. If the sweep
  round moves relayout out of `layoutSpec`, this spec's step 4 moves with
  it — coordinate before merging whichever lands second.
- **Merge order.** This round is small and touches shared layout files;
  land it AFTER widgets-4 if that worktree is within a day of merging,
  otherwise land first and let widgets-4 rebase — its diff does not touch
  the layout directory. Either way: merge `origin/main` into the branch,
  run the full suite and `tsc` (Netlify runs `npm test && npm run build`),
  check the deploy state is "ready" before saying "live".
- **Hans's smoke tests for drag, widget bodies and live controls are still
  open.** Do not start this round until those have run; landing another
  feature on untested ones is how a green suite proves nothing.

## 10. Schema, params check, prompt

- `schema.ts`: `params.box` for every template: "a region name — left,
  right, top, bottom, full — or {x, y, w, h} in canvas units. Give it only
  when something else shares the page: a code panel, an equation, a table.
  Names only unless you have a reason." One sentence about the code panel
  taking the other side automatically.
- `params-check.ts`: `box` must be accepted as a universal key for every
  template, name or rectangle, before the template's own schema is applied.
  Verified 2026-09-15: template schemas do not set `additionalProperties:
  false` at the top level, so an unknown `box` passes Ajv today for all but
  two packs (`biology.yaml` and `music.yaml` each carry one such flag —
  check whether it is top-level or nested). The five native-box templates
  type `box` as an object, so a NAME fails their check: resolve the name to
  a rectangle before the params check runs, or widen those five schemas the
  way `data-schema.ts` widens for `{id.var}` tokens.
- `compiler-v1.md`: one paragraph in the template section, names only, and
  one exemplar (§11). Re-pin `tests/prompt-size.test.ts` in the same
  commit (feedback rule: every spec feature learns prompt + schema + size
  pin in ONE round).
- The template on-demand author (`llm/on-demand.ts`) needs no change: an
  on-demand template is registered like a built-in and gets the fitted
  path.

## 11. Acceptance

One cast, checked by eye at phone width and at desktop width, and kept as
an example:

- `template: sir_compartments`, `params.box: "right"`.
- One code element, `show: "left"`, python, solving SIR with a few lines
  and ending in a matplotlib plot of S, I, R.
- Narration draws the compartments first, then the code, then the plot.

Passes when: no overlap lint; compartment labels are at the floor or above
and readable on a phone; the plot sits on the left with the code; the
`overlap-code-figure` rule is silent; the same spec WITHOUT `box` still
warns as today.

Tests, each written to fail first:

1. `layoutSpec` with a fitted template and `box: "right"`: every drawable
   bbox lies inside `fitRegion("right")` (labels may spill by ≤ one label
   height).
2. Label requests are scaled AND floored (the tier2 group fit does neither;
   this is the new code path).
3. A domain-unit point lands on the fitted scene curve (§6).
4. The five native-box templates receive a rectangle when given a name, and
   are not fitted (no `fit` on the result, no `fit-scale` lint).
5. A spec without `box` and without a code element is unchanged: reuse the
   examples gate rather than a new snapshot.
6. `fit-scale` fires at s < 0.5 and not at s ≥ 0.5.
7. `templateTakesBox` true for every template that lays out →
   `figureSplit` invents a box for sir_compartments + code, and
   `tests/figure-split.test.ts` keeps passing for the five.

## 12. Non-goals, written down so they stay out

- Two templates in one spec (template-as-element, ROADMAP Phase C).
- Overlays and paint-order changes (§8).
- Non-uniform scaling, a share parameter, a bare size.
- Teaching the compiler rectangles.
- Changing any of the five native-box templates.
- Touching `src/ui/controls.ts` or `src/ui/widget-host.ts` (§9).
