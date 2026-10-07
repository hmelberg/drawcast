# Engine gaps found by the OWID quiz batch (2026-10-07)

Collected from author reports and fresh-eyes reviews. Candidates for an engine round.

## Two-voice quizzes
- `voice` on an ask/quiz command is rejected → the right/wrong lines take whatever speaker the previous command left current (plan.ts:797 narrationSpeaker = currentNarrationSpeaker, set at :1558 only by a voiced command with an action). Fix: accept `voice` on quiz/ask in the schema and use it for narrationSpeaker.

## Asks
- The ask's prompt replaces or overlaps the page heading (several casts) — the heading should stay; the prompt goes below it / in the caption band.
- `choose` reveal draws no mark on the right option (ocean-plastic, smallpox): the figure should mark it.
- Estimate slider sits mid-page over the figure (hides the chicken; covers a scale's tick numbers).
- Viewer's guess vanishes at the reveal (sliders, bars, allocate, draw-the-line) — keep a faint "You" ghost beside the truth.
- Allocate: account bar cut at the right edge; "Stories left" label tiny.
- Draw-the-rest on line_chart: the given part shown before the ask can be cut back (nuclear-warheads, farmed-fish).
- After a guess's figure is erased, its on-figure answer stamp stays.
- The ask's intro shows as the caption after the reveal.

## Cards
- Rank / compare / along-a-scale cards come out tiny without `size`; compare cards ignore `y` (pinned under the heading).

## Charts
- Bar `value_labels` format: no per-bar format; mixing 0.5 with integers gives "5.0"; 24.6 prints "24.60".
- No log y-axis on line_chart / bar_chart (guinea worm, battery prices lie flat on the floor).
- Bar chart colour can't be changed; `box` gives partial control; `box` given as a list is ignored.
- pie_chart: `box: "left"` / animated box shrinks it to a dot; `label_size` > ~30 inside a box shrinks the pie; long slice names shrink a boxed pie; `animate box` doesn't resize (needs move/scale with pivot).
- Line chart can't drop the series end label ("World"); tick numbers and end names stay small even with larger text size.
- Number line (scale): tick numbers and answer label small, no size option; unit written after the number ("525 dollars" not "$525").

## Layout / lint
- Multi-line text (`\n`) is flagged as running off the canvas.
- A crowd of people can't be scaled with `move` (each scales about its own centre).
- Grid group with `fit` keeps flags small.

## Thumbnails
- "→" glyph doesn't render.
- `question` thumbnail centre-crops the drawing into its right panel; stickers placed in whole-card coordinates, not the picture's.

## Possibly affects a published quiz
- A pie whose other slices are drawn before the ask leaves the answer showing as the gap — check *what-the-universe-is-made-of*.

## Added later
- Anchoring a label to `bar_N`'s top doesn't land at the bar top (labels placed by coordinates instead).
- Card `size` max 2 (schema) — still small beside a chart.
- On-canvas quiz buttons have no size option.
- pie_chart can't explode (pull out) a slice; a zero-value slice shows its name unless labelled " ".
- bar_chart can't dash/lighten one bar (forecast).
- line_chart draw-the-rest handle starts before `from` (1986 with from: 1989).
- An animated zoom on line_chart leaves clipped values as a vertical stroke at the left edge.
- (several authors) Some ask kinds (estimate slider, line draw) put their question in the heading slot during the ask — authors could not keep the heading; others (tb choose) keep it. Make every ask keep the heading.
- Compare cards: revealed percentages small, winner of each pair not marked.
- Text in a bar chart's data units anchors unpredictably near the right edge.
- Frames: the "answer (after the reveal)" tile's caption still shows the pre-ask line. The player DOES caption the answer line (player.ts speakLine → showCaption), so this is the frames tool capturing before it — fix the tool so reviewers aren't misled.
- Lint/frames count the heading card itself (y 701 + 50) as "off-screen" — false positive on every quiz tile.
- Bar drag always starts at 4 % of the axis (no start value).
- pie_chart without a box dips into the caption band; with a box it is drawn at ~¼ size during the ask.
- Line guess: `after: keep` does not keep the viewer's drawn line; the guess handle starts flat at the first value.
- Bar chart: no per-bar colour (can't grey/dash one bar).
- Sort cards drop their flag icons.
- Quiz choice card covers the figure while open.
- Revise: the first guess isn't shown during the clue beat (the live player keeps it via guessMemory; the frames tool shows the default start).
- BUG: an element whose id starts with a cards group's id (e.g. "land_w" vs cards "land") is treated as one of its cards — it was drawn behind the Finland card. Match exact ids / an explicit member list.
- Frames tool doesn't draw the viewer's guess (You pin, drawn line, ✓/✗) on the reveal frame though the player keeps it (src/guess/reveal.ts) — reviewers keep flagging "guess vanishes".
- Select cards above size ~1.12 run off the canvas with the default arrangement.
