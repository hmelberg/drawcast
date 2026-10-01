# Curves, trees and formulas — three more ways to answer

Date: 2026-10-03 · Status: proposed (round 4 of guess-and-reveal; builds on
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

As a formula: the viewer's curve is `P(Q) = k · P₀(Q) + s`. Moving changes
`s`, turning changes `k`, so the shape is the viewer's own and nothing is
offered as a hint. Both moves can be combined, so here `release` defaults to false and the
Answer button is shown: one gesture is rarely the whole answer.

For a horizontal shift (a demand shift), the copy moves sideways:
`Q(P) = Q₀(P) + s`. The handle uses the direction the truth moves, so the
viewer is never offered a move that cannot reach the answer.

### 3.3 Scoring

Compare the viewer's curve and the truth at two quantities, a quarter and
three quarters of the way along the old curve (one point is not enough to
tell a shift from a turn). At each quantity, take the vertical gap between
the new curve and the OLD curve, for the viewer (`v₁`, `v₂`) and for the
truth (`t₁`, `t₂`).

- **Direction**: the sign of `v₁ + v₂` against the sign of `t₁ + t₂`.
- **Shape**: a *shift* when the two gaps are nearly equal
  (`|v₂ − v₁| < 0.25 · max(|v₁|, |v₂|)`), otherwise a *turn*. The same
  rule classifies the truth.
- **Size**: the mean of `|v₁ − t₁|` and `|v₂ − t₂|`, within `tolerance`
  (default 0.08 of the price axis).

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
(as predict does) and the true curve moves into place. Two short vertical
gap lines at the two scored quantities show "how far" in the guess colour,
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

### 4.2 Blanks

- `blanks` lists tree parts whose numbers the viewer fills in:
  - `value_<node>`: a chance or decision node's rolled-back value (needs
    `rollback: true`; lint errors otherwise);
  - `branchlabel_<parent>_<child>`: a probability, e.g. the 1 − p that the
    tree fills in itself.
- Under the question each blank shows "?" in a box. The truth is the tree's
  own rollback at the current params.
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

- `\blank{…}` is replaced before MathJax by its content, so the formula lays
  out exactly as the answer would. The blank's glyphs are found by the
  existing part matcher (`highlight-part.ts`), are kept back, and a rounded box
  is drawn around their bounds, padded and at least one em wide.
- Parts: `<id>_blank_<k>` (the box, k = 1, 2, … in order) and
  `<id>_blank_<k>_fill` (the hidden glyphs).
- Drawing the formula draws the boxes, never the hidden glyphs. A blank that
  no ask fills is a lint warning. A blank inside a live-math `{var}` is a
  lint error.

### 5.3 Answering

- **Tiles** (when the blank's content is not a plain number, or `others` is
  given):
  - The right contents are always tiles, and `others` adds wrong ones.
  - The tiles are small cards with the TeX drawn on them, in a shuffled row
    under the formula.
  - The viewer drags a tile onto a box, or taps a tile and then a box.
  - A tile in a box can be dragged out again or swapped.
  - Keyboard: the same as the card gates.
  - Uses the cards drag code (`src/cards/`).
- **Typed number** (when the blank's content is a plain number and there is
  no `others`): tapping the box opens a number box; right within `tolerance`
  (default 0.02 relative).
- **Typed symbols** are not in this round: no maths parser. Lint errors
  for a symbolic blank without tiles.
- One blank answers on the drop (`release`); several show the Answer button.

### 5.4 Scoring, reveal, stored

- **Scoring:** a tile is right when its TeX equals the blank's after
  removing spaces and outer braces.
- **Reveal:** the wrong tiles slide back to the row, and each box's true
  glyphs are written in by hand in the box. A wrong box keeps a small
  struck-through copy of the viewer's tile above it.
- **Stored:**
  - `{f}` "1 of 2"; with one blank, the viewer's tile as text
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
| Fill the formula | the right tiles glide into their boxes one by one |

Test me (self-test) uses the same paths as the live gates.

## 7. Shared pieces

- **New ask fields:**
  - `check` (A)
  - `blanks`, `pick`, `work` (B)
  - `others` (C)

  `tolerance`, `release`, `store` and `predict` keep their meanings.
- **Template guess handles:** a template can now offer guess handles through
  an optional `guess` function in its widget body. The function returns:
  - the handle (what moves and how);
  - the truth (computed from the end params);
  - a scorer.

  Supply/demand implements it. Decision trees use `blanks`/`pick` through
  the same hook. Other templates can follow later.
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
2. **Fill the formula:** `\blank`, the boxes, the tiles (reusing the cards
   code), number boxes, lint, and two examples (area of a circle; a missing
   number in a sum).
3. **Move the curve:** the template guess hook, the copy curve with move and
   turn, the scoring and `{t.why}`, the predict carry into the animate, and
   three examples (per-unit tax, percent tax, subsidy).
4. Prompts, rule card and `#interactive`; one generated cast as a test;
   browser checks muted; push.

## 10. Open questions

1. **Turning by elasticity in a question:** should a question whose truth is
   an elasticity change (supply becomes more elastic) offer the turn about
   the equilibrium (as specified), or should elasticity questions wait?
2. **Typed symbols:** is a small parser worth adding later (for `2r`, `x^2`),
   or do tiles cover what teaching needs?
3. **Tree blanks for terminal payoffs:** sometimes the viewer should compute
   a payoff (cost × years) rather than an expected value. Add
   `effect_<id>`/`cost_<id>` blanks now, or later?
