# Round 6 — answers that stay, choices on the figure, lighter icons

Date: 2026-10-03 · Status: proposed (decisions taken by the user: the "beside"
reveal is the default; original-colour icons are the default for side
illustrations). Builds on rounds 1–5 of guess-and-reveal
(`2026-10-01-guess-and-reveal-design.md` … `2026-10-03-looks-feedback-account-design.md`).

## 1. Purpose

From the user's viewing of the round-5 examples and the decision-bias course:

| # | Problem | Change |
|---|---|---|
| A | Comparing your answer with the truth takes effort: the reveal moves your answer into the truth | **Never move the viewer's answer.** Draw the truth beside it, in a distinct look; colour right/wrong consistently; fade your answer when the explanation moves on |
| B | "Which bag?" is answered on boxes under the drawing, not on the bags | **Choose on the figure**: an ask names drawn things as its options |
| C | Guess marks stay behind when the chart re-lays out | Marks **end with their moment**, and kept marks **follow** the figure |
| D | A sort question appeared on top of the figure | A question can have **its own page** on the figure |
| E | Sorting is slow and limited to a few cards | **Tap to move**, **"tap all the …"**, and a **one-card-at-a-time deck** |
| F | Icon data clutters specs; traced icons lose colour and stroke icons trace badly | Specs keep **only the keyword**; data lives in `assets:`/a cache; **original-colour pictures** by default for side illustrations; drawn icons when the icon is the subject |

## 2. Principles

- **The viewer's answer is evidence; it never moves.** The truth is drawn as a
  second thing, beside or over it, in ink. Your answer fades (not vanishes)
  once the explanation moves on, and is erased with its figure.
- **One colour language everywhere:** blue = yours, ink = the truth,
  green ✓ = right, red ✗ = wrong. (Guess blue `#3f6fb5`, green `#4a7c59`,
  red `#b3412e`.)
- Interaction on the figure, never the tray; movies never wait; structure-
  derived (one field, not hand-placed commands).

## 3. A — Reveals beside the answer (default)

A new ask field `reveal_style`: `"beside"` (default) | `"morph"` (today's:
the answer glides into the truth). `reveal_order`: `"all"` (default) |
`"each"` (the truth appears part by part, about 0.6 s apart, in the figure's
order).

| Form | Beside reveal |
|---|---|
| Bars (one or all) | Your bar stays where you set it, filled in blue (60 % tint) and narrowed to the left half of its slot; the true bar grows in the right half, in the chart's own colour, from zero. The gap is labelled (`+12` / `−8`). The chart's layout does not change. |
| Sketched line | Your line stays (blue); the true line draws over it in ink, left to right; the area between them is shaded (blue 15 %); "±N avg" stays. |
| Pie (slice or whole) | Your pie stays; a second, true pie draws beside it (same size; the pair centred where the one stood). |
| Scale / timeline (one number) | Your pin stays; the true pin drops in ink; a connector shows the difference. |
| Market curve | Your copy stays (solid blue); the truth moves in as the following animate (as now); gap lines as now. |
| Account bar (budget) | Your bars stay; true bars beside them (as bars). |
| Cards: rank / place | Each card gets ✓ (green) or ✗ (red). Wrong cards stay where you put them; a small ink "true order" column (rank) or true pins (place) appears beside. |
| Cards: sort / match / compare / fill | ✓/✗ on each card; a wrong card shows a thin red arrow to where it belongs (sort, fill) or the true line (match); the cards do not move. |
| Tree / formula blanks | As now, plus ✓/✗ colours on each blank. |

After the reveal, your answer stays at full strength while the ask's own
lines are spoken (author's line, band line); at the next command it fades to
35 % and stays until its figure is erased, or until an author erases it.
`reveal_style: "morph"` keeps today's behaviour exactly.

Movies: the demo answer stays beside the truth the same way.

## 4. B — Choose on the figure

```json
{"ask": {"question": "Which bag would you take?", "choose": ["bag_now", "bag_later"], "store": "c", "judge": false}}
{"ask": {"question": "Which door hides the car?", "choose": ["door_1", "door_2", "door_3"], "answer": "door_2"}}
{"ask": {"question": "Treat or wait?", "choose": [{"id": "treat", "goto": "treat"}, {"id": "wait", "goto": "wait"}], "then": "after"}}
```

- `choose` lists drawn elements (any id the figure has drawn: a node, an
  icon, a group, a template part). They get a hover ring; a tap answers.
- `answer` makes it judged (✓/✗ on the tapped thing); `judge: false` is an
  opinion; `goto`/`then` branch like decide cards.
- Keys: Tab moves between the options, Enter picks.
- Movie: the laser taps `default` (or the answer, or the first option).
- `{c}` holds the tapped id's label (its text, or the element's `label`), `{c.id}` its id.
- Lint: an option that is not drawn before the ask → error; decide cards
  whose option texts repeat drawn objects → a hint to use `choose`.

## 5. C — Guess marks end with their moment, kept marks follow

- Guess marks (ghosts, gaps, connectors) end when the guessed part next
  changes shape (a later animate, a re-layout) or at the next question —
  whichever comes first — unless the ask says `keep: true`.
- A kept owner's marks are recomputed from the same answer whenever its
  part is laid out again (the guess setup is pure; the player re-runs it on
  the new layout), so they follow the bar or line.
- The beside reveal (§3) uses the same rule for "your answer".

## 6. D — A question on its own page

Ask field `stage: "own"`: while the question is open, the rest of the figure
fades to 15 % (not removed); the asked parts and their cards are at full
strength; after the reveal (and its lines) the figure fades back over
~300 ms. Lint: a question whose cards or options overlap other visible parts
→ a warning suggesting `stage: "own"`.

## 7. E — Faster sorting

- **Tap to move** (sort and fill): a tap on a card sends it to a box — with
  two boxes, to the other side (row → box 1 → box 2 → row cycles when there
  are more); dragging still works. No new field.
- **"Tap all the …"**: a cards element with `select: "<box title>"` and items
  marked `{text, in: true}` — one box; tapping a card moves it in or out;
  Answer judges. (Spec-wise a one-bin sort; the gate is the same.)
- **Deck** (`deck: true` on a sort): one card at a time, centred and large;
  the viewer taps a box (or presses 1/2/…); the card flies there and the next
  one comes. With `deck`, a sort may have up to 30 items. ✓/✗ flash per
  card; the reveal shows the boxes with ✓/✗ as §3. Movie: the cards go to
  their boxes one by one.

## 8. F — Icons: keyword in the spec, pictures by default

- **Spec stays light:** an icon (element, node `icon`, card `icon`,
  `match_icon`) is authored as a keyword (`"dog"`) or `{of, set}`. The app
  resolves it before playing (cached in IndexedDB) — no mid-play pause.
- **Where the data lives:** publishing and the Embed dialog move resolved
  drawings into the spec's `assets:` section (as `hoistStrokes` already does
  for other drawings), referenced by the icon — never inline. The editor
  folds `assets:` and any string longer than ~200 characters.
- **Bundled examples and tests:** an offline icon cache file
  (`src/scenes/icon-cache.json`, keyword+set → data) that lint and tests read,
  so examples carry keywords only. The examples' inline `icon_strokes` are
  removed.
- **Two looks:** `icon_look: "picture"` (default for card, node and decorative
  icons) shows the original artwork, in colour, faded in whole;
  `icon_look: "drawn"` (default for a standalone `icon` element that is the
  subject; settable anywhere) traces it by hand as today. Picture mode
  prefers colour sets (twemoji) when the keyword is found there, else the
  line icon in ink.
- Pictures are SVG data, scaled like the drawn icons, in the figure's
  coordinates (they move, highlight and erase with their card).

## 9. Revisions

- "The deadliest animal": beside reveal on the malaria bar; picture icons;
  keywords only.
- "Is it a fruit?": a deck version (12–16 items) plus the existing one using
  tap-to-move.
- Lecture 1 (decision course): the money-bag and door choices become
  `choose` on the drawn bags and doors; icons as pictures; keywords only.
  Other lectures: replace decide cards that repeat drawn objects with
  `choose` where it reads better.
- All bundled examples with guesses: re-checked under the beside default.

## 10. Guidance

Prompt and rule card: "answer on the figure — `choose` when the options are
drawn things"; "a sort with many items → `deck`"; "a yes/no grouping → tap
all the …"; "`stage: own` when the question needs the page"; icons are
keywords; "`icon_look: drawn` only when the icon is what you explain".

## 11. Build order

1. Icons (F): keyword-only specs, offline cache, assets hoisting for icon
   data, editor folding, picture look (default) — the examples get lighter
   first.
2. Choose on the figure (B).
3. Beside reveals (A) for bars, line, scale/timeline, pie, cards ✓/✗; colour
   language; fade-after rule; `reveal_style: morph` kept.
4. Marks end / follow (C) — shares code with A's fade rule.
5. Own page (D).
6. Sorting (E): tap to move, "tap all", deck.
7. Revisions (§9), guidance, browser check (muted), generated cast, push.

## 12. Open questions

1. Bars beside: halve the bar width (your half + true half), or keep full
   width and draw your bar as an outline in front? (Proposed: halves.)
2. Should the fade-to-35 % of your answer happen at the next command, or
   only when the author erases it? (Proposed: next command.)
