# Design: vars and dependencies (the manim round, part 1)

Status: direction agreed by Hans 2026-09-10 ("begynn på dette i tråd med
det du anbefaler", after the manim assessment). The choices below were
made by Claude while Hans was away and are flagged as such where they
were not obvious. Implementation plan:
`docs/superpowers/plans/2026-09-10-vars-and-dependencies.md`.

## 1. The problem

The 2026-09-10 assessment of manim (3b1b) against drawcast found that
the one thing manim *is* — and drawcast lacks — is that relations hold
while things move. In manim a point defined as an intersection stays an
intersection when a curve slides (updaters), and a number can be swept
continuously with everything that reads it re-drawn each frame
(ValueTracker). In drawcast today:

- `animate` works only on template params; a freehand `curve.expr` may
  use nothing but `x`. There is no way to sweep a number through a
  freehand figure.
- The prompt has to say, of `move`: "intersection points, guide lines
  and regions do NOT [follow] — redraw those", and "to shift a curve
  semantically, declare the shifted curve as a second element". The
  ROADMAP lists "an `angle` that updates when its arms move" as
  deliberately not done. Only labels (by transform) and `measure` (by
  its own planner-side recompute, round 3) follow.
- `trail` exists only on `move`; a locus traced while a parameter sweeps
  (the Fourier video's spectrum, drawn as the winding frequency rises)
  cannot be written.

The second finding of the assessment governs the shape of the fix: what
made manim code hard for a model to write is coordinates and per-frame
imperative state. So every addition below is an *attribute on a verb
that exists* or a *relation that starts to hold*, never a new coordinate
task for the model. The compiler prompt is already 25 verbs and a 17.7k
token schema; this round adds one top-level field (`vars`), one element
field (`bind`), one point option (`at.on`), and one command option
(`trail` on `animate`). No new verb.

## 2. Design

The founding principle holds: the model writes semantics, code computes
geometry. One mechanism carries both features: **the `animate` path** —
a full re-layout per frame handed to `swapGeometry`, settled by a
remount — **generalised from "params" to "params + vars + the poses of
the elements something depends on"**. Freehand `animate` on a var is
that path with a var in the key; a `move` whose target has dependents is
that path with a pose in the key.

### 2.1 `vars`

```yaml
vars: {f: 1, a: 0.5}
```

A top-level record of numbers. A var may be read in three places:

1. **`curve.expr`** — `"sin(f*x)"`, `"a*x^2"`. The evaluator's variable
   set becomes `x, X, q, Q, t, T` plus every var name. A var named `x`
   (the curve variable) or like a function or constant of the evaluator
   (`sin`, `pi`, `e`) is a validation error. `t` and `q` are aliases of
   `x` in a curve expression only until a var of that name exists: `t` is
   the name a sweep parameter naturally takes, so a var shadows the alias
   (found in Task 3: the first draft reserved `t` and the very first
   example tripped on it).
2. **`bind`** on any element — see 2.2.
3. **`{name}` tokens in drawn text** — `text.text`, `label.text`,
   `node.text`: `"f = {f}"`. Formatted by the measure rule
   (`formatMeasure` in `layout/measures.ts`: ≥ 100 → no decimals, else
   one, a trailing `.0` dropped) or with explicit decimals `{f:2}`. Not
   in `math.tex` (MathJax typesetting is asynchronous; a formula that
   should show a var writes the number as a `label`/`text` beside it),
   not in template captions, not in `speak` (those `{name}` tokens are
   the viewer's stored `ask` answers and stay so).

An unknown `{name}` in text is left as written and warned about, so a
typo is visible on the canvas rather than silently blank.

### 2.2 `bind`

```yaml
- {id: hand, type: sector, x: 500, y: 375, radius: 120, start: 0, end: 30,
   bind: {end: "30 + 60*f"}}
- {id: dot, type: point, at: {x: 1, on: wave}, bind: {"at.x": "t"}}
```

`bind: {<field>: <expr>}` — expressions over the vars, evaluated at
layout time into a shallow copy of the element before its case runs.
`<field>` is a numeric field of the element (`x`, `y`, `radius`,
`start`, `end`, `width`, `height`, `rx`, `ry`, `rotation`, `slope`,
`angle`, `size`, `x_from`, `x_to`, `font_size`, `offset`, …) or a dot
path to a numeric leaf (`at.x`, `at.y`, `from.x`, `to.y`,
`points.2.0`). Rules:

- The bound value replaces the written one; the written one is still
  required where the element requires it (it is the value before the
  first `animate`, and what a viewer without a reprojector sees).
- A path that does not end on a number, or an expression naming an
  unknown var, is an **error-severity lint** (`bind`, so the repair round
  sees it) and the binding is dropped.
- `bind` on a template spec's tier-2 elements works the same way; there
  is no `bind` for template params (`animate` already reaches those).

This is the whole of manim's ValueTracker for the model: one field, the
expressions it already writes for `expr`.

### 2.3 `point.at.on`

`at: {x: 3, on: "wave"}` — the point on the curve `wave` at x = 3 (domain
units), y read off the curve's samples (`interpolateAtX`). The one
missing definitional point: a dot that slides along a curve as `t` is
swept, the tangent's foot, a marked value. `on` with `y` instead of `x`
(solve for x) is not in this round.

### 2.4 `animate` on vars, and `trail` on `animate`

`animate: {f: 3}` — a key is resolved **params first, vars second**: a
dot path that `readParam` finds in the template params is a param (as
today); else a bare name found in `vars` is a var; else the existing
warning, reworded ("animate "f": neither a template param nor a var —
skipped"). A name that is both is a param, with a warning. `animate` no
longer requires a template: a freehand spec with `vars` animates.

Internally the planner keeps a var's cumulative value in
`SceneState.params` under the key `vars.<name>`; `withOverrides` in the
reprojector's `layoutFor` splits those keys off into `spec.vars`. This
keeps every existing consumer of `params` (scrub, commit, ghosts,
`bboxesFor`, the explore tray's previews) working unchanged. `duration`,
`easing`, `ghost` apply as today.

**`trail` on `animate`**: `{animate: {f: 3}, trail: {of: "com", anchor:
"center"}}` leaves the locus of that anchor across the sweep as the
element `<of>_trail` (`_2`, `_3` on repeats), exactly like `move.trail`
— a minted element the storyboard can fade, erase, highlight. `of` is
required (an `animate` has no target to default to). The planner samples
61 layouts at uniform parameter steps and reads the anchor from each
(`namedAnchors`, else the element box), so the trail is the true locus
whatever the easing; the player advances the trail by arc length against
eased time as `move` does. Cost: 61 layouts at plan time per trailing
animate — a freehand layout is milliseconds, a heavy template's tens of
milliseconds; acceptable, and only when asked for.

### 2.5 Definitions hold

**Rule (what the prompt will say):** a point defined as an intersection
or as a point on a curve, a region between two curves, an arrow or edge
between two things, an angle between two arms, a line through points,
and a measure of a thing are *definitions*. When what they refer to
moves, turns, scales, flips or morphs, they follow — honestly, recomputed
from the moved geometry, not slid.

**What does not follow:** `at` placement (an assembly instruction: a
cylinder placed beside a piston must not ride along when the piston
slides), `attach_to` (labels keep following by transform, as today),
group membership. Claude's call; the distinction is "definition vs
placement" and the prompt states it in one sentence.

**Definitional references** (`src/spec/deps.ts`, `definitionalRefs(el)`):
`point.at.intersection_of[*]`, `point.at.on`, `region.between[*]`,
`arrow`/`edge` `from.ref`/`to.ref`, `angle` `at.ref`/`from.ref`/`to.ref`,
`line.through[*].ref`, `measure` `of`/`from.ref`/`to.ref`. `dependentsOf`
closes them transitively (an arrow to an intersection point of a moved
curve follows too). Template ids count as sources (an arrow from a
template's `eq_point` to a freehand node follows when the template id is
moved).

**Layout with overrides.** `layoutSpec(spec, measure, overrides?)`,
`overrides = {poses?: Record<id, {offset, turn}>, shapes?: Record<id,
Record<leafId, Pt[]>>}`. Tier-2's *lookups* — `ctx.anchors`,
`ctx.namedAnchors`, `ctx.curveSamples`, the box read off
`drawablesSoFar`/`seedDrawables` for universal anchors, `ctx.pieces`
apex/centroid — return the **posed** geometry for an id in `overrides`,
while the id's own emitted drawables stay in their original frame (the
renderer applies the pose transform, as today). Concretely: after an
element is emitted and relatively placed, if it has an override, its
registered anchors are mapped through `poseOf(offset, turn)` (morphed
`shapes` substituted first), its curve samples are mapped
logical → posed → back to domain, and a posed copy of its leaves
replaces the original in the lookup view (`mapLeaf`, extracted from
`minted.ts`'s ghost code, which already maps text/image/circle/rect/pts
through a pose). Template ink is mapped the same way before tier-2 runs.

**Planner.** `planOptionsFor` gains `dependentsOf(id)`. A `move`,
`transform` (arrange, flip, scale), or `morph` step whose changed ids
have dependents is marked `relayout: true`, and the planner's bbox source
switches to `opts.bboxesFor(params, {poses, shapes})` for the rest of
the plan (today it switches only after `animate`). `measure` keeps its
round-3 planner recompute (`MeasureFollow`) on every step; on a relayout
step the layout recomputes the measure too and the two agree (same
inputs), so no conflict — and no dead code to delete this round.

**Player.** Two changes:

1. A `relayout` step tweens through the reprojector instead of the
   handles: per frame it interpolates the poses (or shapes) exactly as
   today and calls `reprojector.frame(params, {visible, offsets, turns,
   opacities, shapes, texts}, {overrides: {poses, shapes} ∩ sources,
   trailProgress})`. `layoutFor` runs with those overrides; `swapGeometry`
   rebuilds every node — the moved element from its original-frame
   layout under the interpolated transform (unchanged look), the
   dependents from their recomputed geometry. Trails in flight are cut
   to the frame's arc-length fraction inside `withMinted`
   (`trailProgress`), so a trail still grows under the rebuild path. A
   `flip` step with dependents runs the same way on its two half-poses,
   which drops the turn-over squash for that step only (swapGeometry has
   no squash); a flip without dependents is untouched.
2. **The layout key.** `applyParams(params)` becomes `applyKey(scene)`:
   the key is `params` plus the poses and shapes of the *source* ids
   (elements something depends on, a set computed once from the spec).
   A boundary whose key differs from the mounted one commits (remounts)
   at that key; poses of ids nothing depends on never force a remount.
   Scrub, goto, settle and the explore gate all go through it, so every
   boundary is exact.

**Cost.** A step with no dependents runs the old handle path — zero
change. A step with dependents pays what `animate` pays today: one
layout plus one node rebuild per frame, which the templates already
sustain at 30–60 fps.

### 2.6 What the model sees

Prompt (`compiler-v1.md`), four edits, all short:

- Tier-2 bullet: `vars`, `bind`, `at.on`, in one sentence each with one
  example.
- `animate` bullet: "`animate` also drives a var: `vars: {f: 1}` … `{"animate": {"f": 4}, "duration": 6, "easing": "linear"}` — every `expr`, `bind` and `{f}` that reads it moves with it"; `trail` for the locus.
- `move` bullet: the two sentences quoted in §1 are replaced by the
  definitions rule. Shifting a curve is now `move` (with `ghost: true`
  when the original should stay); declaring D′ remains right when both
  curves are discussed.
- Schema descriptions for the four fields, tight.

STYLE.md: no entry (no engagement rule changed). Four bundled examples
(§4).

## 3. Testing and evidence

Vitest throughout, TDD per task:

- `expression`: vars in the variable set; a var named `x` or `sin`
  rejected by validation.
- `bind`: sector end bound to a var; dot path `at.x`; unknown var and
  non-numeric path are error lints; the written value is what a spec
  without a reprojector lays out.
- `at.on`: y read off the curve; warning off the curve's x range.
- text tokens: `{f}` formatted by the measure rule; `{f:2}`; unknown
  left as written with a warning.
- `deps.ts`: direct and transitive dependents; template ids as sources;
  `at`/`attach_to` are not edges.
- `layoutSpec` with overrides: an intersection follows a translated
  curve (numeric check against the shifted expression); an angle follows
  a rotated arm; an edge follows a moved node; a region between a moved
  and a fixed curve changes area the right way; the moved element's own
  drawables stay unposed.
- planner: `relayout` set only when dependents exist; bbox source
  switches; `animate` on a var stores `vars.f`; a name that is both
  warns; freehand `animate` no longer warns; `trail` on `animate` mints
  61 samples along a known locus (a point bound to `[cos(t), sin(t)]`
  traces a circle).
- player (stub reprojector, as `animate.test.ts`): a relayout move calls
  `frame` per tick with interpolated poses in the overrides and commits
  once with the boundary key; a scrub across a relayout boundary commits
  exactly when the key changes; a plain move never calls `frame`.
- examples gate: the four new examples validate, lay out, plan warning-
  free, and their post-move geometry is checked through `bboxesFor`.
- prompt test: the definitions sentence and the `vars` sentence are in
  the prompt; the old "redraw those" sentence is gone.

Hans's smoke checklist follows the round (a `-smoke.md`), as before.

## 4. Bundled examples (Hans: "husk også å legge til eksempler")

Every one a question, freehand, no template:

1. **Why does a higher frequency squeeze the wave?** `vars: {f: 1}`, a
   curve `sin(f*x)` on a domain, a dot bound to the curve at `x = t`, the
   text "f = {f}", `animate: {f: 4}` over six seconds, linear.
2. **What is the tangent at a point?** A curve, a point `at: {x, on}`
   with `bind: {"at.x": "t"}`, a `line` through the point with
   `bind: {slope: "cos(t)"}` (the model knows the derivative), an
   `animate` of `t` sliding the foot along the curve while the tangent
   turns.
3. **Does the equilibrium follow when demand shifts?** Freehand demand
   and supply, the intersection point with guides, the consumer-surplus
   region; `move: {target: demand, by: [15, 0], ghost: true}` — the
   point, the guides and the region follow; the ghost shows where demand
   was.
4. **What happens to the angle when one arm turns?** Two arrows from a
   vertex, an `angle` between them writing its degrees; `move: {target:
   arm_b, rotate: 40, pivot: {anchor: tail}}` — the arc widens and the
   number climbs.

## 5. Build order

1. `deps.ts` and the expression/var plumbing (`vars`, `bind`, `at.on`,
   text tokens) — layout only, no player.
2. `layoutSpec` overrides and the posed lookup view.
3. Planner: `animate` on vars; `relayout` steps; bbox source switch;
   `trail` on `animate`.
4. Reprojector and player: `frame` overrides, `trailProgress`, the
   layout key, the relayout tween path.
5. Schema, prompt, examples, examples gate, ROADMAP, NOTES, ledger,
   smoke checklist.

## 6. Out of scope (next parts of the manim round)

Formula morph between `equation_steps` lines with per-term colours
(part 2); a `copy` verb and a parametric `curve` (`x_expr`/`y_expr`)
(part 3); `stagger` on `draw`; a camera that follows an element; `{f}`
in `speak`; sliders for vars in the explore tray; `at.on` solving for x
from y; a flip with dependents keeping its squash; label sides pinned
during a relayout tween (a label attached to a dependent is re-solved
each frame and may change side mid-tween, as under `animate` today).
