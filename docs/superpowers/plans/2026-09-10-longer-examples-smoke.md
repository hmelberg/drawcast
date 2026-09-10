# Smoke checklist: six longer worked examples on the manim-round features

For Hans, in the app (Editor → Examples). Six new bundled examples, 13–16
beats each, English, written to carry one non-obvious point the whole way
through rather than to demonstrate a verb. Each item names what to watch
for. A ✓ per line, or a note of what looked wrong.

They also enter the `{{EXEMPLARS}}` pool (bundled showcases fill the slots
a user's own reference library leaves empty), so the second question on
every one is: would I want the model to imitate this?

## 1. "Why is a life-year gained in thirty years worth so little today?"

Features: a var read by a curve's `expr`, `region` with a `{ref}` edge,
`morph.tex` with `colors`.

- [ ] Title and axes draw; the discount curve is flat at 1 across the top
      (`r` starts at 0), with the readout `r = 0.000` under the formula.
- [ ] `w(t) = 1/(1+r)^t` draws on the right, with `r` in red and the rest
      default ink.
- [ ] The animate (4 s, linear): the curve sags away from flat into the
      familiar decay, and the readout counts up to `r = 0.035` with it.
- [ ] The year-30 point lands ON the curve with its guide lines, at about
      a third of the way up.
- [ ] The morph (1.5 s): `w(t)` becomes `w(30)`, the exponent `t` becomes
      `30`, `\approx 0.36` fades in, `(1+r)` holds its place and `r` stays
      red through the tween.
- [ ] The two shaded areas: yellow from 0 to the year-20 point, green from
      20 to 60. Judge the claim by eye — they should look about equal
      (they are: 14.5 vs 14.6 units, the green one counting its tail off
      the right edge).
- [ ] The boxed punchline draws bottom right and does not sit on the
      year-30 guide line.

## 2. "Do people live longer if the cancer is found earlier?"

Features: `measure` reading its number off the drawing, `bind` on a
shape's `x`, definitions holding through a var animate.

- [ ] Two timelines, upper and lower; onset, symptoms and death marked on
      the upper one.
- [ ] The first ruler reads **survived 3 years** — it is measured from the
      figure, not typed.
- [ ] The dashed violet line joins the two death marks vertically.
- [ ] The lower row starts with its diagnosis exactly under the upper
      one's, and its ruler also reads **survived 3 years**; the readout
      says `found in year 8`.
- [ ] The animate (3 s): the blue diagnosis dot slides left to year 4, the
      readout counts down to `found in year 4`, and **the ruler and its
      number redraw with it, ending at survived 7 years**. This is the
      beat the whole example exists for — if the number lags or the ruler
      keeps its old length, stop and say so.
- [ ] Nothing on the right-hand side moves at any point.

## 3. "How can a calculator work out sin(1.2) with nothing but plus and times?"

Features: three vars inside one `expr`, `morph.tex` growing a formula
term by term.

- [ ] Blue sine curve with the `\sin x` label; red polynomial starts as
      the straight line `y = x` (it will run off the top and bottom of the
      plot — that is the point, not a clipping bug).
- [ ] Three morph/animate pairs. Each morph appends a term to `P(x)` —
      earlier terms glide, the new fraction fades in, every `x` stays red
      — and each animate then bends the red curve to match.
- [ ] After the third pair the red curve tracks the blue one through a
      whole hump and then dives away hard at the edges.
- [ ] The violet dot at the origin and its label sit clear of both curves.
- [ ] The laser underlines the polynomial near the end.

## 4. "How could anyone see whether two tones were in tune, a century before electronic tuners?"

Features: a parametric curve (`x_expr`/`y_expr`), `bind` on `t_to`, three
vars animated including one that only moves the phase.

- [ ] Red beam dot at (1, 0); a sliver of blue curve and the readout
      `B / A = 1.00`.
- [ ] The sweep (4 s, linear) draws a circle, the beam dot riding the end
      of the curve the whole way.
- [ ] `f → 2` (3 s): the circle deforms continuously into a figure of
      eight; mid-animation the curve is an open squiggle (honest — the
      figure only closes at whole ratios). Readout ends `B / A = 2.00`.
- [ ] `f → 1.5` with the sweep extended to 4π (4 s): the figure ends as
      the 3:2 bow — three touches along the top edge, two on the side.
- [ ] The phase sweep (7 s, linear): the closed figure rolls over
      continuously and returns to itself at the end. Nothing jumps.

## 5. "Can a treatment be better for mild cases, better for severe cases, and still lose overall?"

Features: `copy` → `move` → `morph.tex` twice, points placed by `at.on`
with `bind`.

- [ ] Two straight lines, A (red) above B (blue) everywhere, labelled.
- [ ] `A: 93% B: 87%` draws low-left, A red and B blue.
- [ ] Copy appears on top of it, glides down 58 units, morphs to
      `A: 73% B: 69%` — the letters and colons hold, only the numbers
      change, colours kept.
- [ ] Both dots appear ON their own line at x = 50, A's above B's.
- [ ] The animate (4 s): A's dot slides right to 75, B's left to 25 —
      each staying exactly on its own line — and they end up with the red
      dot BELOW the blue one. The lines themselves never move.
- [ ] Third line copies, glides, morphs to `A: 78% B: 82.5%` — the flip,
      in the same shape of sentence as the two above it.
- [ ] Three stacked lines are readable at once at the end.

## 6. "The test is 99% accurate and mine came back positive. Am I probably ill?"

Features: `pieces of: "grid"` at 10 × 10, `annotation` circles on single
pieces, `copy`/`move`/`morph.tex` for the derivation.

- [ ] A 10 × 10 grid draws (100 cells) with the caption under it.
- [ ] A red circle marks the top-left cell; later a violet circle marks
      one cell in the middle of the grid.
- [ ] Bayes's rule draws on the right, `D` red in every occurrence.
- [ ] Both marked cells glow together on the "two people get the phone
      call" beat.
- [ ] Copy → glide down 110 → morph to `= 0.5`: the left-hand side
      `P(D | +) =` holds its place while the fraction is replaced.
- [ ] Second copy → glide → morph to `\approx 0.09`.
- [ ] Three formula lines and the grid coexist without overlapping.

## Whole-round questions

- [ ] Is 13–16 beats too long? (These run roughly 1½–2½ minutes of
      narration each; the older bundled examples run 5–10 beats.)
- [ ] Does every one still open on ink within a second or two, and land
      its closing sentence as a real conclusion rather than a summary?
- [ ] Any of them you would strike from the exemplar pool?
