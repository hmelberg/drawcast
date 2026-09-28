# Live math — a formula whose numbers the viewer can change (2026-09-29)

## Why

Templates already have live numbers (equation_plot, decision_tree, markov
model): paused, the viewer drags a number sideways or taps it to type, and
the figure recomputes. A freehand page had nothing of the kind: its `vars`
could be swept by `animate`, but the viewer could only watch. Hans's rules
point one way — interaction on the figure itself, and behaviour that follows
from the content's structure rather than from hand-placed commands. A
formula that names a var already says "this number drives the picture";
that is enough to make the number live.

## The convention (reused, not invented)

Drawn text already reads vars as `{name}` (`{f}`, `{f:2}`, `{m:0,}` —
spec/vars.ts `interpolateVars`). A `math` element's `tex` now reads them the
same way:

```json
{"vars": {"B": 100, "r": 0.035, "t": 20},
 "elements": [{"id": "pv", "type": "math", "tex": "PV = \\frac{{B}}{(1+{r})^{{t}}}"}]}
```

`{r}` in TeX is also an ordinary group, so the braces stay: `{r}` becomes
`{<value>}`, never loosening what surrounds it. But a braced ARGUMENT is TeX,
not a token: `{name}` directly after a control word (`\frac{u}`, `\text{r}`),
or after `^`, `_`, `}` or `]` (`^{t}`, the denominator of `\frac{a}{b}`),
keeps its letter. Wrap it once more to put the value there: `^{{t}}`,
`\frac{{B}}{…}`. This is what keeps the one bundled formula that names a var
as a letter (`W = 10 \cdot \frac{u}{{1 - u}}`, vars `{u: 50}`) exactly as it
was. A bare letter (`^t`, `2r`) stays a letter, and a name that is not a var
(nor a template/population value such as `{pop.sick}`, which shows as a
plain number) is plain TeX, so every existing formula is unchanged.

## What is drawn

- Each var occurrence is its own part, `<id>_var_<name>` (`_2`, `_3` … for
  later occurrences) — a group nested inside the formula's group, so `draw`,
  `move`, `erase`, `morph` and `copy` of the formula carry it untouched.
- The value is formatted like `{name}` in text (the measure rule, or the
  var's `decimals`, `{r:3}` inline), with the cast's decimal comma.
- `form` on the math element: `"values"` (default) writes numbers,
  `"symbols"` writes the names (`r`, `\beta` for `beta`, `r_1` for `r_1`),
  `"both"` writes the formula in names, then `=` and its right side (after
  the first top-level `=`) in numbers — equation_plot's `equation_form`.

## Live by default

Every var a math element shows is live unless the var says `fixed: true`
(or is computed, below). Paused — exactly where template live numbers are
live (the widget host's press rule: not playing, no other gate up, not on a
control, caption or card) — a drag sideways on the part changes the var by a
step every STEP_UNITS (number-scrub.ts `scrubbed`), a tap opens the number
field (ui/number-edit.ts). The change is a preview through the same route a
template scrub takes (`previewParams({"vars.<name>": v})`), so everything
that reads the var re-lays out: `bind` fields, curve `expr`, `{name}` in text,
population counts, other formulas. Like every widget preview it lasts until
play resumes or the step changes.

Step and bounds, when the var does not say: the step is the larger of the
written value's own last decimal (0.035 → 0.001, 20 → 1) and a nice 1 % of
the value (1000 → 10); the floor is 0 unless the value is negative.

## Var definitions

A var stays a plain number. The object form adds what a number cannot say:

```json
"vars": {"r": {"value": 0.035, "min": 0, "max": 0.1, "step": 0.005, "color": "#1f7a7a"},
         "t": 20,
         "PV": {"expr": "B/(1+r)^t", "decimals": 1}}
```

`value, min, max, step, decimals, color, fixed` — and `expr`: a computed
var, recomputed from the vars before it on every layout, never live, never
animated. `{PV}` in text or math shows the result, and `bind` reads it
(`"height": "PV*2"`), so a bar and its number follow a scrub of `r`.

## Colour

Each live var takes a colour from `PARAM_PALETTE` (layout/model.ts) by its
order among the live vars in `vars`, unless its definition has `color`.
The same colour marks that var's value wherever it is drawn: in every
formula, and as a coloured run in `text`, `label` and node text that shows
`{name}` — letter, number and every readout share one colour. An explicit
`colors` entry on the math element still wins for its own glyphs.

## Casts

`animate: {r: 0.07}` sweeps the var as before (the drawn number follows,
since the formula re-lays out each frame). A computed var is not animatable
(the planner does not know it as a var).

## Not in this round

- `highlight: <id>_var_<name>` from a command: the parts are nested, not
  order entries; point at the formula instead.
- Live vars in a `label` with `tex`, or inside template equations.
