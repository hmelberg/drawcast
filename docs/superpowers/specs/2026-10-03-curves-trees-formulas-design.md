# Curves, trees and formulas — three more ways to answer

Date: 2026-10-03 · Status: approved 2026-10-03 (round 4 of guess-and-reveal; builds on
`2026-10-01-guess-and-reveal-design.md` and
`2026-10-02-more-ways-to-answer-design.md`, and answers its open question 1,
"predict on template widgets")

## 1. Purpose

| # | Form | The viewer… | Typical question |
|---|---|---|---|
| A | **Move the curve** (supply/demand) | drags or turns a curve to where it will go | "A 20 % tax on sellers. Show the new supply curve." |
| B | **Fill the tree** (decision tree) | types the missing expected values, then picks the best option | "What is the expected value of treating?" |
| C | **Fill the formula** (math) | drops symbol tiles, or types a number, into boxes in a formula | "What goes in the box? A = π □" |

## 2. Principles (unchanged)

- **Still `ask` with `on`.** The figure's structure says what kind of answer
  it takes; each form adds at most one or two ask fields.
- **Truth from the structure**, never written twice: (A) the params the next
  `animate` ends on; (B) the tree's own rollback; (C) what the blank hides.
- **On the figure.** One gesture answers on release (`release`, default
  true); the Answer button (bottom centre) appears only when several moves are
  needed.
- **Feedback names the answer** with stored variables, spoken while the
  figure moves to the truth; ghost and gap marks in the guess colour.
- **Movies never wait**: each form has a demonstration (§6).

## 3. A — Move the curve (supply/demand)

### 3.1 Authoring

Predict on the template: an ask `on` a curve, right before the `animate` that
moves it.

```json
{"draw": ["market"]},
{"ask": {"question": "The government adds a 20 % tax on sellers. Show the new supply curve.",
         "on": "supply_curve", "predict": true, "store": "t",
         "right": "Yes: {t.why}", "wrong": "Not quite. {t.why}"}},
{"animate": {"tax.amount": 20}, "duration": 2.5, "speak": "…"}
```

The tax is already in the params at `amount: 0` (with `kind: ad_valorem`),
as casts do today, so the truth is the taxed curve at amount 20.

- **What can be asked:** `on` is `supply_curve` or `demand_curve`, and the
  next animate must move something that moves that curve: `tax.amount`,
  `demand_shift.amount` / `supply_shift.amount`, `demand.offset` /
  `supply.offset`, or a curve's `elasticity`. A tax on buyers moves the
  demand curve; a subsidy is a negative `tax.amount`. Lint errors when the
  animate does not move the named curve.
- **The truth curve** is the curve the layout draws at the animate's end
  params: `tax_supply_curve` / `tax_demand_curve`, the shift curve, or the
  curve itself.

### 3.2 The gesture

While the question is open, a copy of the named curve (in the guess colour)
lies on it. The viewer has two moves, the same two the free-play widget has:

- **Middle of the curve → move it.** The copy moves up and down, every point
  by the same amount: the per-unit tax, the subsidy, or a shift.
- **Near either end (END_ZONE) → turn it.** The copy is stretched up or down
  about price 0, every price times the same factor: the percent tax. In free
  play, a turn is about the equilibrium (an elasticity change); in a
  question, a turn is about price 0 when the truth is a tax, and about the
  equilibrium otherwise. The question knows from the animate which of the
  two it is.

As a formula: the viewer's curve is `X = c + k · (X₀ − c) + s`, along one
axis:

- **price axis** (a tax or subsidy): `P(Q) = k · P₀(Q) + s`, turning about
  price 0 (`c = 0`);
- **quantity axis** (a shift, an offset, an elasticity change):
  `Q(P) = Qe + k · (Q₀(P) − Qe) + s`, moving sideways and turning about the
  equilibrium quantity `Qe`.

Moving changes `s`, turning changes `k`, so the shape is the viewer's own and
nothing is offered as a hint. The axis follows from the animated param, so
the viewer is never offered a move that cannot reach the answer.
Elasticity questions ("supply becomes more elastic — show it") are in this
round: their truth is a turn about the equilibrium.

The copy is drawn as a guess mark (`setGuessMarks`), not by the template: the
market's own layout is untouched while the viewer works, and the following
animate moves the real curve.

Both moves can be combined, so here `release` defaults to false and the
Answer button is shown: one gesture is rarely the whole answer. Keys: ↑/↓
move, Shift+↑/↓ turn.

### 3.3 Scoring

Compare the viewer's curve and the truth at two points of the old curve, a
quarter and three quarters of the way along it (one point is not enough to
tell a shift from a turn). At each, take the gap along the axis (§3.2)
between the new curve and the OLD curve, for the viewer (`v₁`, `v₂`) and for
the truth (`t₁`, `t₂`). These two gaps ARE the handle's numbers: the gesture
sets `v₁, v₂` (from `s` and `k`), the truth is `t₁, t₂`, so the round-1
scoring and marks apply unchanged.

- **Direction**: the sign of `v₁ + v₂` against the sign of `t₁ + t₂`.
- **Shape**: a *shift* when the two gaps are nearly equal
  (`|v₂ − v₁| < 0.25 · max(|v₁|, |v₂|)`), otherwise a *turn*. The same
  rule classifies the truth.
- **Size**: the mean of `|v₁ − t₁|` and `|v₂ − t₂|`, within `tolerance`
  (default 0.08 of that axis).

A new field `check` chooses what "right" means:

| `check` | Right when |
|---|---|
| `direction` | the curve moved the right way |
| `shape` (default) | the right way AND the right shape |
| `size` | the right way, the right shape, and within tolerance |

### 3.4 Stored variables

- `{t}` — "moved up", "turned up", "moved right" … (what the viewer did)
- `{t.true}` — the same words for the truth
- `{t.off}` — the size miss, in the price units (`units`) when given
- `{t.price}`, `{t.price_true}`, `{t.quantity}`, `{t.quantity_true}` — the
  equilibrium the viewer's curve implies (where it crosses the other curve)
  against the true one; for a tax, the price buyers pay
- `{t.why}` — one built-in sentence for the case at hand, such as:
  - shift, truth turn: "You moved it up evenly. A percent tax adds more where
    prices are high, so the curve also gets steeper."
  - turn, truth shift: "You turned it. A tax per unit adds the same amount at
    every quantity, so the curve moves up without turning."
  - wrong direction (supply, tax): "A tax on sellers raises the price they
    need at every quantity, so supply moves up, not down."
  - right: "The new curve is where you put it."

  The sentences go through i18n like the other built-in texts. Authors may
  ignore `{t.why}` and write their own lines.

### 3.5 Reveal and marks

The viewer's copy stays as a dashed ghost. The following animate then runs
(as predict does, from the template's own start — the guess lives only in
the marks) and the true curve moves into place. Two short gap lines at the two scored quantities show "how far" in the guess colour,
and the implied equilibrium of the guess is shown as an open dot. The marks
end when the market is erased.

### 3.6 Not in this round

Questions on ceilings and floors ("put a ceiling that binds"), on the
deadweight-loss region, and on who bears the tax. Each is a later field on
the same ask; the price-of-buyers point could reuse the round-1 `point`
handle.

## 4. B — Fill the tree (decision tree)

### 4.1 Authoring

```json
{"draw": ["tree"]},
{"ask": {"question": "What is the expected value of treating?", "on": "tree",
         "blanks": ["value_treat"], "store": "e",
         "right": "Right: {e.true}.", "wrong": "It is {e.true}: {e.work}"}},
{"ask": {"question": "So which do you choose?", "on": "tree", "pick": "start", "store": "c",
         "right": "Yes, {c.true}.", "wrong": "{c.true} is worth more."}}
```

A decision tree is a template, the whole figure: `blanks` or `pick` makes
the ask a tree question, and `on` may be left out (when given it is
`"tree"`).

### 4.2 Blanks

- `blanks` lists tree parts whose numbers the viewer fills in:
  - `value_<node>`: a chance or decision node's rolled-back value (needs
    `rollback: true`; lint errors otherwise);
  - `branchlabel_<parent>_<child>`: a probability, e.g. the 1 − p that the
    tree fills in itself;
  - `effect_<node>` / `cost_<node>`: a terminal's payoff or cost (the viewer
    computes it, e.g. cost × years). Its truth is the number the author
    wrote; it has a working line only when the node carries `work` (a short
    text, e.g. `"12 × £300"`).
- Under the question each blank shows "?" in a box: the tree gains an
  internal param `answers` (part id → text) that replaces those numbers as
  drawn ("?" while asking, the typed number while typing, gone after the
  reveal). Rollback is not affected. The truth is the tree's own rollback at
  the current params (or the authored number for a terminal).
- The viewer taps a blank and types into the tree's own tap-to-type box
  (`editable`, EditField), with label "Expected value of Treat". Enter moves
  to the next blank. One blank: Enter answers. Several: the Answer button.
- **Scoring:** each blank is right within `tolerance` (default 0.02,
  relative; a probability is right within 0.01). An empty blank is wrong.
- **Reveal:** the true values are written in from the right of the tree to
  the left (deepest node first, about 300 ms each). Under each wrong blank a
  working line is written: `0.3 × 10 + 0.7 × 4 = 5.8`. It is built from the
  rollback (each child's probability and value), so it always matches. The
  working lines stay until the tree is erased; a field `work: "all"` shows
  them under every blank, and `work: false` under none.
- **Stored:** `{e}` "2 of 3", `{e.true}` (one blank: its value with the
  tree's `currency`/`unit`), `{e.<blank>}` and `{e.<blank>.true}` for each,
  `{e.work}` (one blank: its working line).

### 4.3 Pick

- `pick: "<decision node>"`: the viewer taps a branch of that decision
  (the branch line and its label are the targets, with a hover ring). The tap
  answers.
- The truth is the rollback's `bestId`; the reveal draws the existing best
  mark and prune marks.
- **Stored:** `{c}` the chosen label, `{c.true}` the best label, `{c.diff}`
  how much better the best one is, in the tree's units.
- `pick` and `blanks` can be in one ask. The viewer fills in the blanks first,
  then the decision's branches become tappable, and Answer judges both.

### 4.4 Keeping it small

Lint warns when there are more than 4 blanks, or the tree has more than 12
nodes. It errors when a blank names a part that is not in the tree, or names
a value that rollback does not compute.

## 5. C — Fill the formula (math)

### 5.1 Authoring

A blank is written in the formula itself:

```json
{"id": "area", "type": "math", "tex": "A = \\pi \\blank{r^2}"},
{"draw": ["area"]},
{"ask": {"question": "What goes in the box?", "on": "area", "others": ["r", "2r", "d"], "store": "f",
         "right": "Yes: A = πr².", "wrong": "It is r squared: {f.true}."}}
```

### 5.2 How a blank is drawn

- `\blank{…}` is replaced before MathJax by its content, wrapped in a nested
  mark as live math wraps a var (`live-math.ts` marks, `partOfChain`), so the
  formula lays out exactly as the answer would and the blank's glyphs are
  gathered into a part of their own. Those glyphs are kept back (drawn at
  opacity 0) and a rounded box is drawn around their bounds, padded and at
  least one em wide.
- The element gains an internal field `fills` (blank k → TeX or null): a
  blank with a fill shows it in the box (the viewer's tile or typed answer,
  in the guess colour; after the reveal, the truth in the ink). The guess
  path patches it like a scale's marker (`patchFor` elements).
- Parts: `<id>_blank_<k>` (the box, k = 1, 2, … in order) and
  `<id>_blank_<k>_fill` (the hidden glyphs).
- Drawing the formula draws the boxes, never the hidden glyphs. A blank that
  no ask fills is a lint warning. A blank inside a live-math `{var}` is a
  lint error.

### 5.3 Answering

- **Tiles** (when `others` is given):
  - The right contents are always tiles, and `others` adds wrong ones.
  - The tiles are small cards with the TeX drawn on them, in a shuffled row
    under the formula.
  - The viewer drags a tile onto a box, or taps a tile and then a box.
  - A tile in a box can be dragged out again or swapped.
  - Keyboard: the same as the card gates.
  - The tiles are expanded from the ask into elements (`<id>_tile_<k>`, a
    rounded box with the TeX), drawn by the ask itself, and answered through
    the cards gate in a new mode, `fill`: each box takes one tile.
- **Typed number** (when the blank's content is a plain number and there is
  no `others`): tapping the box opens a number box; right within `tolerance`
  (default 0.02 relative).
- **Typed expression** (a symbolic blank and no `others`): tapping the box
  opens a text field taking AsciiMath-style input: `pi r^2`, `2r`, `sqrt(x)`,
  `(a+b)/2`, with implied multiplication and `·`, `×`, `π`, `√` accepted. As
  the viewer types, the answer is drawn in the box (through `fills`), so they
  see `πr²` and know it was read as meant. A row of keys above the field
  gives `^ √ π / ( )` for phones.
  - **Checked by value:** the typed answer and the truth are evaluated at
    five random points (each letter drawn from 0.5–3), and right when they
    agree to 1e-6 relative at every point where both are defined (at least
    three). `r^2`, `r*r` and `r r` are all right; `2r` is not.
  - **`form: "exact"`** (for "simplify" questions): right only when the
    typed expression, printed back to TeX, equals the truth after removing
    spaces and outer braces.
  - **The truth** comes from the blank's TeX through a small converter
    (`^{}`, `_{}` on a letter as part of its name, `\frac`, `\sqrt`,
    `\pi`, `\cdot`, `\times`, `\left( \right)`). A blank it cannot
    convert takes tiles only; lint errors when such a blank has no `others`.
  - The parser is a new module beside `src/spec/expression.ts` (which stays
    as it is: curve strings keep their stricter syntax).
- One blank answers on the drop or on Enter (`release`); several show the
  Answer button.

### 5.4 Scoring, reveal, stored

- **Scoring:** a tile is right when its TeX equals the blank's after
  removing spaces and outer braces; a typed answer as in §5.3.
- **Reveal:** the wrong tiles slide back to the row, and each box's true
  glyphs are written in by hand in the box. A wrong box keeps a small
  struck-through copy of the viewer's tile above it.
- **Stored:**
  - `{f}` "1 of 2"; with one blank, the viewer's answer as text
  - `{f.true}` the true content
  - `{f.<k>}`, `{f.<k>.true}` for each blank
- **The box stays filled** after the ask. Later commands can highlight
  `<id>_blank_1_fill` like any part.

## 6. Movies

| Form | The movie shows |
|---|---|
| Move the curve | the laser takes the middle of the curve and moves it (the commonest guess), then the animate brings the truth |
| Fill the tree | each "?" is written in with the true value, the working line under the first |
| Pick | the laser taps the best branch |
| Fill the formula | the right tiles glide into their boxes one by one; a typed blank has its answer typed in, character by character |

Test me (self-test) uses the same paths as the live gates.

## 7. Shared pieces

- **New ask fields:**
  - `check` (A)
  - `blanks`, `pick`, `work` (B)
  - `others`, `form` (C)

  `tolerance`, `release`, `store` and `predict` keep their meanings.
- **A new guess handle kind, `market`** (A): its two numbers are the gaps
  `v₁, v₂`; built from the template's own pure layout at the ask's params
  and at the end params of the next animate (so its truth needs no later
  layout on screen); painted by marks, never by params.
- **Two new gates** beside the guess and cards gates: the tree gate (B:
  number fields over the blanks, branch taps) and the formula gate's typed
  field (C); tiles use the cards gate.
- **Marks:** the guess colour, ghosts and gap lines from rounds 1–3.

## 8. LLM guidance

`#interactive`'s "pick the form from the answer" list gains:
- a policy's effect on a market → move the curve, with `check: shape` when
  the kind of tax matters;
- a computed value in a decision → fill the tree, then pick;
- a step in a derivation or a formula's missing piece → fill the formula,
  with two or three plausible wrong tiles.

The compiler prompt and the rule card get one example each. The prompt-size
pin moves once.

## 9. Build order

1. **Fill the tree:** blanks via the tree's editable fields, the working
   lines, pick, lint, and two examples (treat or wait; an HE tree with a
   blank probability).
2. **Fill the formula:** `\blank`, the boxes and `fills`, the tiles (a
   cards `fill` mode), number boxes, the expression parser (AsciiMath-style
   input, TeX truth, check by value, `form: exact`), the typed field with its
   preview, lint, and three examples (area of a circle with tiles; a missing
   number in a sum; a typed derivative).
3. **Move the curve:** the template guess hook, the copy curve with move and
   turn, the scoring and `{t.why}`, the predict carry into the animate, and
   three examples (per-unit tax, percent tax, subsidy).
4. Prompts, rule card and `#interactive`; one generated cast as a test;
   browser checks muted; push.

## 10. Decisions (2026-10-03)

1. **Elasticity questions are in:** the turn is about the equilibrium
   (quantity axis); in a tax question it is about price 0 (§3.2).
2. **Typed expressions are in,** checked by value, with `form: "exact"` for
   simplifying; tiles stay the tool for telling likely mistakes apart (§5.3).
3. **Terminal payoff and cost blanks are in,** with an optional `work` text
   on the node (§4.2).

## 11. As built (2026-10-02/03)

Built on branch `curves-trees-formulas` in 15 plan tasks plus three fix waves (a review per task, a muted browser check of every new example, three generated `#interactive` casts, and a final whole-branch review). Changes against the sections above:

**Trees (§4)**
- A tree's blanks show "?" on every boundary before their ask (plan states carry `answers`), including the poster, scrubbing and the movie — draw the whole tree first; no pre-drawing tricks.
- While a pick is asked, that decision's best/prune marks are hidden; the reveal draws them in. Without rollback, a solid ring marks the best branch.
- Working lines (`tree_<index>` marks) stay until the tree is erased — later guess, cards or tree asks don't clear them. A probability blank that is a complement gets "1 − 0.12 = 0.88".
- `{c.diff}` is the best option's margin over the next best on a right pick, a skip or in the movie; best minus chosen on a wrong pick; cost-only trees use cost saved; under a wtp it is money.
- Typed numbers accept thousands commas ("$78,000"), decimal commas ("5,8", "0,250") and percents for probabilities ("88%").
- Stored tree numbers use the tree's own formatting (its `decimals`).

**Formulas (§5)**
- Typed expressions are in (AsciiMath-style, checked by value at random points; `form: "exact"` compares the written form). TeX control words outside the subset make a blank tiles-only, except Greek letters (kept as symbols so the printed TeX round-trips).
- Tiles are a cards element `<id>_tiles` (cards `<id>_tiles_N`, not `<id>_tile_<k>`), placed by the layout under the formula's laid-out box (above it when there's no room), clamped inside the canvas; the shuffle is seeded from the content. After the reveal all tiles leave; erasing the formula erases them. Drag, or tap a tile then a box; a drop goes to the nearest box.
- An empty fill keeps its box; during a morph an unfilled blank is a `\phantom` (no boxes while morphing).
- `highlight <id>_blank_<k>_fill` lights the fill's glyphs.

**Market curves (§3)**
- The copy is drawn by guess marks (solid with grab dots while asked, a lighter dashed ghost after), clipped to the plot; the turn is relative to the grabbed point (a press alone changes nothing) and a press must land near the copy. Keys follow the screen: price axis ↑/↓ (Shift turns), quantity axis →/←.
- A turn in the wrong sense (flatter vs steeper) is the wrong shape. The right-answer `{t.why}` follows `check` ("It moves up." / "It turns up and gets steeper."); authors prefix it ("Yes. {t.why}").
- One curve per question (lint error otherwise).

**Shared**
- One answer dock for the guess, cards, tree and formula gates (Answer never over the caption; the hint never over the title); fields open beside their blank; the drawing shrinks a little while an ask is open.
- The poster before Play stops before the first ask, so it never shows an answer.
- A scale's answer marker now leaves with its scale.

**Examples:** 9 new (2 tree, 3 formula, 3 market, and the generated "Statins at sixty: how much life?").
