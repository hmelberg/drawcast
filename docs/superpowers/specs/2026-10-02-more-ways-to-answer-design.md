# More ways to answer — predict, place, compare, match, allocate, decide, revise

Date: 2026-10-02 · Status: proposed (round 3 of guess-and-reveal; builds on
`2026-10-01-guess-and-reveal-design.md` and `2026-10-01-rank-and-sort-design.md`)

## 1. Purpose

Seven more ways for the viewer to answer on the figure, chosen from the
"what next" list (items 1, 2, 4, 6, 7, 8, 9):

| # | Form | The viewer… | Typical question |
|---|---|---|---|
| 1 | **Predict** | sets where the figure is about to go, then watches it go there | "A tax is added — where will the price land?" |
| 2 | **Place on a scale** | drags cards onto a number line or timeline | "Put these inventions on the timeline" |
| 4 | **Higher or lower** | picks the bigger of two, several times fast | "More deaths: sharks or cows?" |
| 6 | **Match pairs** | joins each left card to its right card | "Match each drug to what it does" |
| 7 | **Allocate** | splits a fixed budget between bars, then compares | "You have 100: split it across the health budget" |
| 8 | **Decide** | picks a course of action; the cast plays out its consequences | "You're the doctor: treat now or wait?" |
| 9 | **Revise** | guesses, sees evidence, guesses again; then the truth | "How likely is she sick? …and after a second test?" |

## 2. Principles (unchanged from rounds 1–2)

- **Still `ask` with `on`.** One command asks; the figure's structure says
  what kind of answer it takes. Each form below is a field on an existing
  structure (a chart, a `scale`, a `cards` element) or one ask field — no new
  verbs.
- **Truth from the structure.** The answer is read from the data the figure
  is drawn from (the next stage, a card's `value`, a pair's `match`), never
  written twice.
- **On the figure**, never in the tray. The Answer button (bottom centre) only
  where several moves are needed; one gesture answers on release.
- **Movies never wait**: each form has a demonstration (§11).
- **Feedback names the answer** with stored variables; spoken while the
  figure moves to the truth.

## 3. Predict (1) — "where will it go?"

**Authoring:** an ask with `on` and `predict: true`, placed right BEFORE an
`animate`:

```json
{"ask": {"question": "Demand falls. Where do you think sales land?", "on": "bar_2", "predict": true, "store": "p",
         "right": "Close: {p} — it lands at {p.true}.", "wrong": "You said {p}; it falls to {p.true}."}},
{"animate": {"stage": 1}, "speak": "…"}
```

- **Truth = the figure after that animate** (the plan knows the next
  animate's targets, so the guess handles read their truth at the params the
  animate ends on: a bar's next stage, a line's next stage, a var a
  population count is bound to).
- **The guess starts from where the figure stands now** (not from the floor):
  you move it from the present to your prediction.
- **The animate is the reveal.** The ask paints the guess; the following
  animate runs from the GUESS to the truth (its starts are the guessed
  values for the predicted paths), with the ghost and gap left as in round 1.
  Nothing animates twice.
- Lint: `predict` needs an `animate` as the next visible command that moves
  the guessed values; error otherwise. The guessed part MAY be drawn (it
  is the present, not the answer).
- First version: the parts round 1 can guess (bars, lines, pie slices,
  population states bound to a var, scales whose `value` is bound to a var).
  Template widgets (supply_demand's curves, the decision tree) are out of
  scope here.

## 4. Place on a scale (2) — cards onto a number line

**Authoring:** a `cards` element whose items carry a `value`, and `on` a
`scale`:

```json
{"id": "years", "type": "scale", "min": 1400, "max": 2000},
{"id": "inv", "type": "cards", "scale": "years", "items": [
  {"text": "Printing press", "value": 1440}, {"text": "Telescope", "value": 1608}, {"text": "Steam engine", "value": 1712}]}
```

- The cards start in a row under the scale (shuffled); the viewer drags each
  onto the line — a card snaps so its pin points at the value under it, its
  number shown.
- **Scoring:** each card is right within `tolerance` of the scale's range
  (default 0.05); `{g}` "2 of 3", `{g.off}` the mean distance in the scale's
  unit ("off by 40 years on average").
- **Reveal:** every card glides to its true value; cards closer than a card
  width are stacked in levels above the line so none overlap; a dashed pin
  stays where each wrong card was placed.
- After the question the cards stand at their true values (plan offsets, as
  for rank/sort).

## 5. Higher or lower (4) — a fast run of comparisons

**Authoring:** a `cards` element with `pairs` (each `[a, b]`) and a value per
item:

```json
{"id": "risk", "type": "cards", "compare": "more deaths per year", "items": [
  {"text": "Sharks", "value": 6}, {"text": "Cows", "value": 20},
  {"text": "Lightning", "value": 24000}, {"text": "Snakes", "value": 100000}],
 "pairs": [[0, 1], [2, 3]]}
```

- One ask runs the whole series: pair by pair, two cards side by side with
  the question ("Which has more deaths per year?"); the viewer taps one; it
  flips to show both values (✓ or ✗), and the next pair slides in after a
  beat. No Answer button.
- **Scoring:** `{g}` "1 of 2"; per pair `{g.1}` right/wrong.
- Pairs default to consecutive items when `pairs` is absent.

## 6. Match pairs (6) — join each left card to its partner

**Authoring:** a `cards` element with `match` on each item:

```json
{"id": "drugs", "type": "cards", "items": [
  {"text": "Aspirin", "match": "Thins the blood"}, {"text": "Insulin", "match": "Lowers blood sugar"},
  {"text": "Penicillin", "match": "Kills bacteria"}]}
```

- Two columns: the items on the left (in order), their matches on the right
  (shuffled). The viewer drags from a left card to a right card; a line joins
  them (a later drag from the same card replaces its line). Answer when done.
- **Reveal:** the right column re-orders so each match sits opposite its
  partner (glide), true lines are drawn, the viewer's wrong lines stay
  dashed. `{g}` "2 of 3".
- 2–6 pairs.

## 7. Allocate (7) — split a budget, then compare

**Authoring:** an ask `on: "all"` of a bar chart with `budget` and `judge: false`:

```json
{"ask": {"question": "You have 100 kroner for health. How would you split it?", "on": "all", "budget": 100, "judge": false,
         "store": "a", "right": "You gave most to {a.biggest}. Here is how Norway actually splits it."}}
```

- Bars start equal (budget / n). Raising one bar lowers the others in
  proportion (the total always equals the budget); a pill shows the total.
- **No right or wrong** (`judge: false`): the reveal moves the bars to the
  chart's own values (the reference — what is actually done), the viewer's
  split stays as ghosts, and `right` is spoken whatever they chose. Stored:
  `{a.bar_1}` … each share; `{a.biggest}` the label they gave most.
- `judge: false` works for any guess (an opinion question: "how much SHOULD
  …?"): no right/wrong, no score, the reveal still shows the reference.
- `budget` also works on a whole pie (already sum-constrained).

## 8. Decide (8) — choose, and see what follows

**Authoring:** a `cards` element of `options`, each with a `goto` label; the
consequences are ordinary labelled sections of the cast:

```json
{"id": "plan", "type": "cards", "options": [
  {"text": "Treat now", "goto": "treat"}, {"text": "Wait and see", "goto": "wait"}]},
{"ask": {"question": "You are the doctor. What do you do?", "on": "plan", "store": "d", "default": "Treat now"}},
{"label": "treat"}, …, {"label": "after_treat"}, …
```

- The options are cards side by side on the figure; the viewer taps one; it
  is marked, the others fade, and the cast jumps to its label.
- **No right or wrong by default.** An option may be `"best": true` — then
  `{d.ok}` and the score count it, and `right`/`wrong` speak.
- **Movies** play straight through, as every goto does: the branches play in
  order. Write each branch so it reads on its own ("If you treat now: …").
  The demo taps the `default` option.
- Lint: every option's `goto` names a label after the ask; each branch ends
  with a jump to a shared label (or the end) — warn when a branch runs into
  the next branch.
- Consequences are drawn with the figure's own means (an `animate` of a
  population var, a decision tree's branch highlighted, a bar chart's next
  stage): nothing new.

## 9. Revise (9) — guess, see evidence, guess again

**Authoring:** two asks on the same part; the first keeps the truth back with
`reveal: false`, the second names it with `revise`:

```json
{"ask": {"question": "She tests positive. How likely is she to be sick?", "on": "p", "store": "g1", "reveal": false}},
{"draw": ["second_test"], "speak": "A second, independent test is also positive."},
{"ask": {"question": "And now?", "on": "p", "revise": "g1", "store": "g2",
         "right": "Yes: from {g1} to {g2} — the truth is {g2.true}."}}
```

- `reveal: false` on a guess: the guess is stored ({g1}), its ghost stays,
  and the part is NOT revealed (no truth, no right/wrong, no score).
- `revise: "<store>"` starts the second guess from the first (its ghost
  stays, lighter), and the truth for the reveal is the part's value at THAT
  point of the cast (the evidence may have changed it — a var bound to it
  may have been animated). Stored: `{g2.moved}` (how far the viewer moved).
- The reveal shows both ghosts and the truth: you see how far the evidence
  moved you, and how far it should have.

## 10. Shared pieces

- **Cards** grow four modes, chosen by structure: `bins` → sort; `scale` →
  place; `pairs`/`compare` → higher-or-lower; `match` on items → match;
  `options` → decide; otherwise rank. Each mode is its own layout and gate
  behaviour in `src/cards/`; the element stays one sugar.
- **New ask fields:** `predict` (§3), `budget` and `judge` (§7), `revise`
  (§9). `reveal: false` gains its guess meaning (§9).
- **Marks:** all forms use the guess colour and the ghost/gap vocabulary.
- **Keyboard:** each gate takes Tab/arrows/Enter (rank and sort's missing
  keyboard is added in the same pass).

## 11. Movies

| Form | The movie shows |
|---|---|
| Predict | the laser drags to `default` (or the present), then the animate |
| Place | cards glide from the row to their true values |
| Higher/lower | each pair: a pause, the right card marked, the values shown |
| Match | the lines are drawn one by one, right column re-ordering |
| Allocate | the bars at the default split (or equal), then the reference |
| Decide | the `default` option tapped; every branch plays in order |
| Revise | both demo guesses (`default`s), then the truth |

## 12. LLM guidance

`#interactive`'s brief gets the new forms in its "pick the form from the
answer" list: a change → predict; dates or values of several things → place
on a scale; quick comparisons → higher/lower; pairs of things → match; an
opinion or a budget → allocate; a choice with consequences → decide; new
evidence → revise. The compiler prompt's "Ask the viewer" gets one example
each (kept short: the prompt-size pin moves once for the round).

## 13. Build order

1. Predict (reuses guess handles + the animate; highest value).
2. Revise (two small fields on the guess path).
3. Allocate / judge: false (a constraint on whole-chart guesses).
4. Place on a scale (cards + scale).
5. Match pairs (cards + lines).
6. Higher or lower (cards, a series in one ask).
7. Decide (cards + goto; branch lint).
8. Keyboard for all card gates; prompts, rule card, `#interactive`; one
   example per form; browser checks muted.

## 14. Open questions

1. **Predict on template widgets** (supply_demand curves, equation sliders):
   worth a follow-up with per-template handles?
2. **Decide in movies:** play every branch (as specified) or only the
   `default`'s branch?
3. **Allocate's reference:** always the chart's data, or allow none (pure
   opinion, nothing revealed)?
