# Round 7: sort feedback on each drop, rank reorders, cards above boxes, bar icons and colours

Date: 2026-10-02 · Status: draft for review

Decisions taken by the user (2026-10-02): a wrong card **first lands in the
box it was dropped in, then glides to its right box**; corrected cards stay
**faded**; a bar chart's colours are **decided from its labels**.

## 1. Purpose

Feedback after watching "Which of these are mammals?", "Fruit or not? — a
quick deck", "The deadliest animal" and the decision-mistakes course:

| # | What was seen | Change |
|---|---|---|
| A | Sorting is judged only at the end; the thin red arrows to where each wrong card belongs are awkward and untidy | Judge each card as it is dropped: ✓ or ✗, then a wrong card glides to its right box and stays faded; a ✓/✗ counter keeps the score (§3) |
| B | A ranking is marked right/wrong but never shown in the true order | The cards slide into the true order; a faint "yours" row stays behind (§4) |
| C | Boxes on top and cards below reads upside down: cards should drop *into* boxes | Cards on top, boxes below by default; cards on the left and boxes on the right as an option (§5) |
| D | Icons look good on cards but are missing elsewhere: on bars, in the fruit deck, in the course (hand-drawn newspaper etc.) | Icons under bars; a prompt rule for using icons; content revisions (§6, §8) |
| E | Bars that are different things should have different colours; bars counting one thing should share one | `bar_colors`, decided from the labels when not given (§7) |

## 2. Relation to round 6

Round 6 principle A was "never move the viewer's answer; draw the truth
beside it". This round departs from it **for sort and rank only**, by the
user's choice. Your answer is not lost: for a sort it is kept in the
counter and in the faded cards, and for a rank in the "yours" row. Every
other form (bars, line, pie, scale, place, match, compare, fill, trees)
keeps the round-6 beside reveal unchanged.

## 3. A — Sort: check each drop

A new cards field, `check: "each" | "end"`.

- **Default `"each"`** for sort (with `bins`), select (`select:`) and deck.
  `"end"` keeps today's behaviour exactly (sort everything, Answer, beside
  reveal with arrows), for casts where committing to every answer first is
  the point.
- Other modes ignore `check`.

### 3.1 Sort and deck under `check: "each"`

1. The viewer drops (or taps/keys) a card into box k. It lands there as
   now (deck: it flies there as now).
2. **Right:** a green ✓ flashes beside it (the deck's existing flash,
   `FLASH_MS`). The card stays, at full strength.
3. **Wrong:** a red ✗ flashes beside it in box k. After about 0.5 s the card
   **glides to its right box** (the gate's existing glide, a little slower,
   about 0.6 s) and settles there **faded to 45 %**, with no mark. The ✗ goes
   with it; nothing red is left on the figure.
4. A placed card is final: it can no longer be dragged or tapped (taps and
   keys skip it).
5. **Taps change meaning.** Round 6's tap-to-cycle (a tap sends a card on
   round the boxes) would judge a card the viewer was only passing through
   box 1. So under `"each"`, a tap on a tray card *picks* it (the ring the
   keyboard already uses), and a tap on a box sends the picked card there.
   Drag and the 1–4 keys work as now. Deck is unchanged: tap a box.
6. **The counter**: `✓ 4 · ✗ 1` in small text (20, ink; ✓ green, ✗ red),
   centred just under the boxes (or above them in `rise`, §5). It is drawn
   when the ask starts (`✓ 0 · ✗ 0`) and ticks on each drop.
7. When the last card is placed, the question answers itself (no Answer
   button), after the last glide settles. Nothing is left to reveal: the
   reveal step is skipped. The ask's `right`/`wrong` line and the feedback
   band are spoken as now.
8. Score: **first-drop right count**. `{f}` is that count; `{f.total}` the
   number of cards; `right` is used when every first drop was right.

### 3.2 Select ("tap all the …") under `check: "each"`

- A tap on a card moves it into the box. In: ✓ and it stays. Not in: ✗ in
  the box, then it glides **back to its tray slot**, faded, and is final.
  (In a select the "right box" of a card that does not belong is the tray.)
- The cards the viewer never taps can only be judged at the end, so select
  keeps the **Done** button. On Done, each missed card glides into the box,
  faded, and counts as ✗ (the counter ticks once for each, about 0.15 s
  apart, so it is seen to happen). Unpicked cards that don't belong stay in
  the tray at full strength, counted as ✓.
- The counter counts every card: picks judged on tap, then the rest on Done.

### 3.3 After the question

The counter and the faded cards follow round 6's "yours" rule: they stay at
full strength while the ask's own lines are spoken, then fade (counter to
35 %) at the next command, until the figure is erased. Seeking forward past
the ask restores the final state (every card in its right box, the faded
ones faded, the counter's final numbers), as answered reveals do now.

### 3.4 Movies (questions off) and demo

With no viewer, the cards go to their right boxes one by one as now. There
is no counter and nothing is faded, because the movie shows the truth and
not a viewer's answer.

### 3.5 Model and encoding

- `Arrangement` gets `first?: number[]`, each card's first box (−1 for
  tray, for a select). `encodeArrangement` carries it; the score
  (`guess/score.ts`) reads `first` when present, else today's final
  positions, so stored answers from `"end"` and older ones still score.
- `cards/model.ts` gets a pure `checkDrop(g, arr, card, box) → { ok, arr }`
  that records `first` and returns the arrangement with the card in its
  right box (and a `faded` set). The gate animates; the model decides.
- The faded look is a per-card opacity the player already supports for
  "yours" fades (use the same mechanism, not a new one).

### 3.6 Lint and the prompt

- Lint: under `"each"`, warn when the ask's `wrong` line mentions arrows or
  marks ("The arrows show…", "The marks show…"): there are none.
- Prompt: the cards guidance says the default checks each card as it is
  dropped and corrects it, so the `wrong` line just gives the score and
  moves on ("{f} of {f.total} on the first try."). Mention `check: "end"`
  for test-like asks.

## 4. B — Rank: the cards slide into the true order

`reveal_style` gets a third value, `"reorder"`, which becomes the
**default for rank** cards (an explicit `"beside"` or `"morph"` still wins).

1. On Answer, ✓/✗ marks appear on each card where the viewer left it, as
   now, for about 0.8 s.
2. A **"yours" row** appears, a compact copy of the viewer's order: short
   labels (font 16, the YOURS blue), at the viewer's slots, just above the
   cards' row (a column rank: just to the left of the column), with a small
   "yours" word at its start. Labels of cards the viewer had in the right
   place are omitted, leaving the gap, so only the movers are repeated.
3. The marks go, and the cards **slide into the true order** together
   (about 0.9 s, eased). Cards moving one way pass on a slight arc above the
   row, cards moving the other way below it, so no two cross through each
   other.
4. Where they land, cards that moved get a thin blue connector from their
   "yours" label to their new place, so the size of each move is visible.
   The cards themselves carry no ✗ after landing; the ones that never moved
   keep their ✓.
5. The "yours" row and connectors fade at the next command (round 6 rule).
   A forward seek restores the end state.

The ends (`ends: ["most", "least"]`) stay where they are. Movies: the cards
are drawn in the viewer-less shuffled order and then slide into the true
order the same way, with no "yours" row.

## 5. C — Cards above the boxes

`arrange` (today: rank `row` | `column`) gets values for sort, select and deck:

- **`"drop"` (new default)**: the tray of cards at the top, the boxes below.
  A sort's tray uses today's row rules (two rows when more than five), and
  the boxes' grid rules are unchanged, just mirrored vertically. Deck: the
  dealt card stands above the boxes and flies *down* into one.
- **`"side"`**: cards in a column on the left (a third of the width), boxes
  side by side on the right, for long labels or a wide figure beside them.
  Up to 8 cards (deck: the dealt card on the left); beyond that, lint
  warns and layout falls back to `"drop"`.
- **`"rise"`**: today's layout (boxes on top), kept for existing casts that
  depend on it.

The bundled examples are re-checked under `"drop"`. Any whose layout breaks
(text placed relative to the boxes) gets `arrange: "rise"` or is revised.

## 6. D — Icons on bars

- `bar_chart` gets `icons: [keyword, …]`, one per bar (as `labels`), in the
  round-6 keyword form (`"mosquito"`, or `{of, set}`), resolved the same way
  (icon cache / `assets:`), and shown in the `picture` look by default.
- The icon stands **under the bar**, between the axis and the category
  label (about 44 units square, scaled down to the bar's slot width). The
  label stays below it. Above the bar is left for the value label and the
  guess handle.
- Up to 12 bars; more than that and lint warns, and the icons are left out.
- An icon is part of its bar's category, so it is drawn with the category
  label (the storyboard's `bar_i` beat draws both) and highlights with it.
- Not in this round: series legends with icons (no example needs one yet).

## 7. E — Bar colours

`bar_chart` gets `bar_colors: "each" | "same"` (one series only; grouped
and stacked charts keep one colour per series, as now).

- `"each"`: bar i gets `C.series[i % n]`.
- `"same"`: every bar gets the first series colour (today's look).
- **Not given, decided from the labels:** `"same"` when the bars are one
  quantity over ordered levels, i.e. every label is a number, a year, a
  numeric range or bin (`"0–9"`, `"10-19"`, `"<5"`, `"65+"`), a month or a
  weekday. Otherwise (names of things) `"each"`.
- The guess and the beside reveal use the bar's own colour for the true half
  (round 6 already says "in the chart's own colour"); "yours" stays blue.
  Check that blue "yours" reads clearly next to a blue-ish series colour; if
  not, skip that colour from the per-bar cycle while a guess is on.

## 8. Content and guidance

- **Prompt rule (icons):** when a card, node, bar or decorative picture
  names a concrete object or animal, give it an icon keyword. Draw by hand
  only when no icon fits, or when the drawing itself explains something (a
  mechanism, a shape, a process).
- **Fruit or not? — a quick deck**: add icons to all fourteen items.
- **The deadliest animal**: icons under the bars (`icons:`); the rank
  question shows the reorder.
- **Which of these are mammals?**: `wrong` line without "The arrows show…".
- **Is it a fruit?**: same.
- **Decision-mistakes course** (dev-casts/courses/decision-mistakes, not in
  git): replace decorative hand drawings (newspaper and the like) with
  keyword icons where one fits; revised by hand, one lecture at a time, per
  the revision loop.
- Every bundled example with a sort or rank: re-checked under the new
  defaults (`check: "each"`, `arrange: "drop"`, `reveal_style: "reorder"`).

## 9. Build order

1. Sort `check: "each"`: model (`checkDrop`, `first`), gate (land → ✓/✗ →
   glide → fade; final cards; tap-to-pick), counter, score, seek restore.
2. Deck under `"each"` (the flash exists; add the glide, fade, counter).
3. Select under `"each"` (tap judgement, Done → missed cards glide in).
4. Rank `reveal_style: "reorder"` (marks, "yours" row, arcs, connectors).
5. `arrange: "drop"` and `"side"` for sort/select/deck; re-check examples.
6. Bar `icons` and `bar_colors` with the label rule.
7. Lint, prompt guidance, example revisions (§8).

## 10. Testing

- Unit (pure): `checkDrop` (right, wrong, select in/out, last card),
  scoring with and without `first`, the label rule for `bar_colors` (names,
  years, ranges, `65+`, months, mixed → `"each"`), the drop/side geometry
  stays on the canvas for 2–4 boxes × 4–14 cards (and deck 30), and reorder
  arc sides never cross.
- Lint tests: the arrows-in-wrong-line warning, `side` > 8 cards, icons >
  12 bars.
- In the browser, muted (narration and WebAudio), for each changed example:
  a wrong drop lands, flashes, glides and fades; the counter's numbers; no
  red left on the figure; seek forward/back; a movie run; phone width.

## 11. Open points

- Should the faded corrected cards also carry a tiny ↺ so they read as
  "moved for you" in a screenshot? Default: no, fading only.
- `check: "each"` for fill tiles (formula blanks) is a natural next step,
  but it is not in this round.
