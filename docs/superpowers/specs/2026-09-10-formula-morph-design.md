# Design: formula morph, term colours, copy and parametric curves (the manim round, part 2)

Status: approved by Hans 2026-09-10 ("Ja, kjør" on the five-section
design; the in-place morph was chosen over a glide between
`equation_steps` lines, which is now a possible round 2b). Implementation
plan: `docs/superpowers/plans/2026-09-10-formula-morph.md`.

## 1. The problem

Part 1 (`2026-09-10-vars-and-dependencies-design.md`) gave drawcast
manim's updaters and ValueTracker. The next thing manim does that a
lesson wants is **TransformMatchingTex**: one formula becomes another, and
the terms that survive glide to their new place while the rest fades out
and in — the viewer sees *what moved*. Beside it sits **t2c**: a term keeps
its colour wherever it appears (`x` always blue), which is the "colour by
role" rule the compiler prompt already states, applied inside a formula.

What exists (explored 2026-09-10, MathJax 4.1.3 on main): the mathjax
engine's `layoutTeX` returns one outline per *filled shape* with no glyph
or token identity, although the SVG it walks carries `data-mml-node`,
`data-latex` and `data-c` on every group and path; both math consumers
(`layout/math.ts`, the `equation_steps` template) emit one drawable per
shape under a group, `<id>__g<j>`; the `morph` verb pairs every leaf of
its target with ONE destination ring; a mounted element can never gain or
lose a leaf; opacity is per element. So a formula cannot be morphed today
except into a blob.

Two smaller manim moves ride along (part 3 of the assessment): a
**`copy`** verb (TransformFromCopy — "take this line, move the copy down,
change it") and a **parametric curve** (`x_expr`/`y_expr` in `t`).

## 2. Design

The founding principle holds: the model writes semantics — the new TeX, a
colour map, a copy's name — and code computes every glyph.

### 2.1 One mechanism: a formula morph is a relayout step

Part 1 generalised the animate path (a full re-layout per frame handed to
`swapGeometry`, settled by a remount, keyed on params + the sources'
poses) to "params + vars + poses". Part 2 adds one more override the
layout understands:

```ts
LayoutOverrides.math?: Record<string, { tex: string; from?: string; t?: number }>;
```

- `tex` is the element's CURRENT TeX (the boundary state after a morph;
  `SceneState.tex: Record<string, string>` carries it, cumulative).
- `from` + `t` describe a frame mid-morph: the layout lays out BOTH
  formulas, matches them (§2.3) and emits the interpolated figure at
  progress `t`. At `t = 1` (or absent) the layout is exactly the plain
  layout of `tex`, so the settling commit and every later scrub read the
  same geometry the last frame painted.

The planner: `morph: {target, tex}` (a fourth mode beside `to`, `stretch`,
`reset`; exactly one of them) on a `math` element pushes a `morph` step
with `texItems: [{id, from, to}]`, `relayout: true`, and records
`tex[id] = to` in the scene state; a non-math target warns and is skipped.
`currentOverrides()` and the player's `overridesOf()` both carry every
`tex` entry of the scene (a TeX override always changes the layout, so
there is no "sources" restriction for it), which keys the boundary layout.
The player's `relayoutTween` gets `math` from `frameAt(e)`:
`{ math: { [id]: { tex: to, from, t: e } } }`, merged over the scene's
settled entries. Ghosts carry the override like poses (part 1 finding 5).

### 2.2 Token identity from the engine

`layoutTeX` keeps what its SVG walk already sees. Each outline gains:

```ts
{ pts, holes?, glyph: number, token: { node: string; latex: string; c?: string; chain: string[] } }
```

- `glyph`: the index of the source `<path>`/`<rect>` in document order
  (reading order) — the "these rings are one glyph" unit the walk already
  keeps and today flattens away.
- `token.node`: the nearest `data-mml-node` ancestor that directly
  contains glyphs (`mi`, `mo`, `mn`, `mtext`, …); a `<rect>` rule reports
  `"rule"`.
- `token.latex`: that node's `data-latex` (the exact TeX substring
  MathJax attributes to it; a rule takes its `mfrac`/`msqrt` parent's).
- `token.c`: the path's `data-c` codepoint (absent on rules).
- `token.chain`: the `data-latex` of every ancestor from the token up to
  the root, for colour matching (§2.4).

`layoutTeX` also returns `tokens: { index, node, latex, glyphs: number[] }[]`
in reading order — the sequence the matcher works on. Nothing else in the
codebase depends on the outline entry having exactly two fields; the
`equation_steps` template and `math.ts` keep reading `pts`/`holes`.

### 2.3 Matching and the tween (`layout/math-morph.ts`)

`matchTokens(from: Token[], to: Token[])`: the longest common subsequence
over token keys `node + latex` (so `mi:x` matches `mi:x`, never `mn:2`),
in reading order; a token may match at most once. Within a matched pair,
glyphs pair in order; a count mismatch (rare — same latex, same font)
pairs the shorter run and leaves the rest unmatched. Rules match rules.

`mathMorphDrawables(el, engine, cx, cy, from, to, t)` lays out both
formulas the way `mathDrawables` does (same size rule, both centred on
`(cx, cy)`), then emits one `area` per shape:

- a matched shape: outer ring `morphPair(oldRing, true, newRing, true)`
  lerped at `t`; holes lerped pairwise when the counts agree, else the
  new shape's holes appear at `t ≥ 0.5` (a counter that cannot be paired
  does not drag across the canvas);
- an unmatched old shape: its own outline, `style.opacity = 1 − t`;
- an unmatched new shape: its own outline, `style.opacity = t`;
- ids `<el.id>__g<k>` in emission order (the frame's nodes carry no
  handles, so the ids only need to be unique); at `t = 1` the function is
  not called — the plain layout of `tex` is.

The group's box is the union of both formulas' boxes; anchors from it.
Colour (§2.4) is read from the NEW formula's token for a matched shape and
from each shape's own token otherwise.

Alignment: `morphPair`'s `alignRing` picks the start index by least
squared distance, which is right for near-identical letterforms (the
common case: the same glyph in a new place) and acceptable for a genuine
shape change.

### 2.4 Term colours

```yaml
- {id: icer, type: math, tex: "ICER = \\frac{\\Delta C}{\\Delta E}",
   colors: {"\\Delta C": "#b5482e", "\\Delta E": "#2f6b8f"}}
```

`colors: Record<string, string>` on a `math` element (and a `label` with
`tex`, which normalises to one) and as a `colors` param of
`equation_steps`. A key is a TeX snippet; a shape takes the colour of the
DEEPEST entry in its `token.chain` whose `data-latex` equals a key after
whitespace normalisation (`\Delta C` = `\Delta  C`). Unmatched shapes keep
the element's ink. Implemented once (`colorFor(chain, colors)` in
`math-morph.ts`) and used by both consumers; in `equation_steps` it is the
`kit.area` fill argument. A key that matches nothing is a layout warning
naming the element and the key.

### 2.5 `copy` — a clone in the layout, not a ghost

```yaml
- {copy: {target: "eq", as: "eq2"}, speak: "Keep the line and work on a copy."}
```

`copy` mints a **full element**: `SceneState.copies: Record<newId, sourceId>`
(cumulative) and `LayoutOverrides.copies` of the same shape; tier-2
appends `{...source, id: newId}` to the element list before layout, so the
clone is placed exactly where the source is (same `at`, same x/y) and is
then an ordinary element — movable, fadeable, erasable, a `morph.tex`
target, a source for dependents. `as` defaults to `<id>_copy`
(`_copy_2`, …); `as` naming an existing id is a warning and the copy is
skipped; a template id, a pieces child or a minted element cannot be
copied (warning). The step is `{kind: "copy", ids}`; the player commits the
boundary key (the copy is in it) and shows the id — a `speak` paired with
it reads over the appearance. Labels attached to the source are not
copied. The prompt teaches the derivation idiom: copy the line, move the
copy down, morph its TeX; `keep` (a faded ghost) remains the choice when
the original should fade instead.

### 2.6 Parametric curve

```yaml
- {id: circle, type: curve, x_expr: "cos(t)", y_expr: "sin(t)", t_from: 0, t_to: 6.29}
```

`x_expr`/`y_expr` are expressions in `t` (the vars readable, as for
`expr`), sampled at `CURVE_SAMPLES` points over `t_from`–`t_to` (default
0–1) in domain units. Exactly one of `expr` or the pair is allowed
(validation). The curve is drawn like any curve and registers its samples;
`intersection_of`, `at.on` and `region.between` on a parametric curve warn
("not a function of x") and skip, since they read x-monotone polylines.
`bind: {t_to: "s"}` + `animate` draws the circle progressively.

### 2.7 What the model sees

Prompt (`compiler-v1.md`):
- `morph` bullet: "A `math` element morphs into a NEW FORMULA:
  `{"morph": {"target": "eq", "tex": "2x = 8"}}` — like terms glide to
  their new place, the rest fades out and in; write the whole new formula."
- Freehand rule 5 (math): `colors` in one sentence.
- Tier-2 bullet: the parametric curve in one sentence.
- Gesture verbs: `copy` in one line, with the derivation idiom.
Schema descriptions one sentence each; the prompt-size budget is re-pinned
with a note, as in part 1.

## 3. Testing and evidence

- Engine (`tests/mathjax.test.ts` grows): `x = \frac{a+1}{2b}` yields
  tokens `mi:x, mo:=, mi:a, mo:+, mn:1, rule, mn:2, mi:b` in that order,
  `=` is one token of two glyphs, the rule has no `c`, chains end at the
  root's latex.
- Matcher: `2x + 3 = 11` → `2x = 8` matches `2, x, =` and leaves `+, 3,
  11, 8` unmatched; a repeated `x` matches in order; rules match rules.
- Tween layout: at `t = 0` every matched shape sits on the old formula
  and unmatched-new shapes have opacity 0; at `t = 1` the plain layout
  of the new TeX is what `layoutSpec` returns; at `t = 0.5` a matched
  glyph's centroid is the midpoint; a counter with no partner appears at
  `t ≥ 0.5` only.
- Colours: `colors: {"x": …}` colours both `x` in `x^2 + x` and nothing
  else; `"\\Delta C"` colours the numerator's three shapes; an unknown
  key warns; the same in `equation_steps`.
- Planner: `morph.tex` on a math element is a relayout step with
  `texItems` and `tex` state; on a non-math target it warns; `copy`
  mints the copy state, defaults the name, refuses a taken name; a copy
  can then be moved and tex-morphed (state carries both).
- Player (stub reprojector): a tex morph tweens with `math.t` running
  0 → 1 in the frame overrides and commits once with `math.tex`; a copy
  step commits and shows; a scrub back drops the copy from the key.
- Layout with overrides: a `copies` override lays out the clone at the
  source's place under the new id; poses on the clone leave the source.
- Parametric: the sampled circle has 61 points on radius 1 (domain); a
  `point.at.on` a parametric curve warns.
- Examples gate: the three new examples (§4) validate, plan warning-free,
  and every morph boundary lays out cleanly (the gate's `bboxesFor`
  asserts the post-step layout, from part 1).

## 4. Bundled examples (every one a question)

1. **How do you solve 2x + 3 = 11?** — a `math` line with `colors` on `x`;
   `copy` it, move the copy down, morph it to `2x = 8`; copy again, morph
   to `x = 4`. The lines stack like a derivation and the viewer sees the
   `3` leave and the `11` become `8`.
2. **What does the ICER compare?** — `ICER = \frac{C_1 - C_0}{E_1 - E_0}`
   with the cost terms red and the effect terms blue, morphing to
   `\frac{\Delta C}{\Delta E}`: the differences collapse into the deltas
   and the colours stay with their side.
3. **Why do cos and sin draw a circle?** — a parametric curve with
   `t_to` bound to a var, a point at its end, `animate` sweeping the var so
   the circle draws itself while a `math` label reads `(\cos t, \sin t)`.

## 5. Build order

1. Engine token identity (§2.2) + tests.
2. Matcher and colour lookup (§2.3, §2.4 helper) + tests.
3. `mathMorphDrawables` and `colors` in `math.ts` and `equation_steps`.
4. `LayoutOverrides.math` / `.copies` in tier-2; `copies` layout.
5. Planner: `morph.tex`, `copy`, scene state, `currentOverrides`.
6. Player: `overridesOf` with tex and copies, `frameAt` math, the `copy`
   step; `render/index.ts` plumbing.
7. Parametric curve.
8. Schema, types, prompt, examples, gates, prompt-size re-pin.
9. ROADMAP, NOTES, ledger, smoke, merge.

## 6. Out of scope

A glide between `equation_steps` lines (round 2b — the copy-move-morph
idiom covers the derivation case meanwhile); manim's `key_map`
(author-directed matching); morphing a formula whose font changes;
`stagger` on `draw`; a camera that follows an element; `{f}` in `speak`;
vars sliders in the explore tray.
