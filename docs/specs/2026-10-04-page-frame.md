# The engine owns the page (2026-10-04)

**Goal.** Every drawcast looks composed without the author placing things: a heading on top
(the title, which for a quiz is the question), the figure filling the content area — neither
cramped nor lost in white space — and the captions' band left clear. Consistent across casts,
adaptive to what is on the page. Authors (people or the LLM) should not need layout
instructions; when they want them, every default has an escape hatch.

Origin: the 50-quiz library run (2026-10-03). Its authors kept hand-placing labels and working
around fixed sizes; the reviewers' most common complaint was small text and small figures on
a mostly empty page.

## Principles

1. **One page frame** — `src/layout/page.ts`: heading strip (y 660–750), content area
   (x 60–940, y 110–655 since 2026-10-05, was 160; up to 700 with no heading), caption band
   (y 0–110, was 0–160 — see W30). Every module
   that needs these numbers imports them; no private copies.
2. **A heading by default.** A page with no `card` command draws `spec.title` as the top
   heading (the same look as `card`, quick and unnarrated with the first ink). Escape hatch:
   `"heading": false`, or `"heading": "<other text>"`. The video title page keeps its own rule.
3. **Fill the content area.** A figure that is alone on the page grows to use the content area
   (cards, number lines, templates with `box: full`); with company it keeps its share. Growth
   is capped (cards ×1.6) so a two-card page does not become a poster.
4. **Readable sizes by default.** No text a viewer must read is drawn under ~18 logical units
   at scale 1: card text, tick labels, chart labels and values. Labels shrink only when they
   would collide, and wrap (two lines) before they shrink further.
5. **Escape hatches, not instructions.** `heading`, cards `size`, scale `ticks`/`tick_format`,
   template `box`, element `x/y/width`, top-level `text.font_size`. The prompt teaches the
   defaults and mentions the hatches once.
6. **Lints judge what the viewer sees**: at the cast's text scale, after moves, with a new
   advisory *fill* check (main figure under ~40 % of the content area's width AND height →
   "small figure on an empty page").

## Workstreams

| # | Area | Files (owner) | Summary |
|---|---|---|---|
| W1 | Page frame + default heading + fill lint | page.ts, layout.ts, regions.ts, figure-split.ts, template-fit.ts, spec/card.ts, spec/expand.ts, lint (fill) | migrate magic numbers to page.ts; region "full" clears the caption band (95 → 160) with before/after review; default heading; `heading` field; fill advisory in check/frames |
| W2 | Cards | spec/cards.ts, cards gate/player/plan for cards | size factor (all constants scale), two-line wrap, adaptive growth when alone (content box), `size` hatch; icons on compare cards; compare title optional; attached labels and compare values follow the slide; hiding the set hides its values |
| W3 | Number line (`scale`) | spec/scale.ts | word ticks on log scales (thousand … quintillion, then 10ⁿ), thinning when crowded, unit on the line, base tick size ~22, short form on the answer marker, default placement from the content box, adaptive width when alone |
| W4 | Data templates | scenes/packs/data.yaml | label/value/tick base sizes ~20–22 with collision shrink; in-between y ticks on bar/line charts; more x ticks on long line charts; pie grows to the content area |
| W5 | Small fixes + tooling | lint.ts (move-aware), lint/frames scale-aware passes, caption sentence split, frames icon cache/retry, scripts/cast.mjs (`open` + `#create`, register 429 → "rate limited", retry) | |
| W6 | Prompt, skill brief, quiz republish | llm prompts, skill, library/quiz | after W1–W5 merge |

## Verification (every workstream)
- Full `npx vitest run` green; `tests/examples.test.ts` clean (zero warnings) — update a test's
  pinned numbers only when the change is the intended one, and say so in the commit.
- Before/after frames of representative casts (examples + library/quiz) for the touched area,
  every tile viewed; a short note of what changed and what was checked.

## Round 2 — quiz features (agreed 2026-10-04)

Every feature ships with at least one bundled example (src/examples.json, zero lint warnings)
and a short line in the compiler prompt.

| # | Feature | Notes |
|---|---|---|
| W8 | On-canvas answer buttons (`quiz.on_canvas`) | True/Myth and yes/no runs without the modal; placed below-right of the figure |
| W9 | `size_compare` template | same-scale comparisons: beside / inside / overlay, ratio label, "how many fit" |
| W10 | Icon fallbacks + honest check | lists of keywords, a search order across sets, a warning instead of a blank or a wrong stand-in |
| W11 | Reveal stamps | `reveal` on a question draws a short stamp beside the answer, landing WITH the right/wrong line |
| W12 | `sequence` group | a run of pictures: the current one large in the centre, the done ones as a small row (progress) |
| W13 | Odd one out; spot it on the picture | choose-based; picture regions / maps / anatomy parts |
| W14 | Bar reorder | `bar_chart` re-sorts its bars on an animate (`sort: true`) — "English jumps to first" |
| W15 | Estimate slider; steps in order | a big counter/slider scored by closeness; ordering with a first→last timeline look |
| W16 | Confidence bet; poll-and-compare; before/after guess example | bet scored for calibration; poll compares with study numbers (viewers' own answers need backend counting — later) |

## Round 2 additions (user, 2026-10-04)
- **W17 Varied right-answer replies** — pools per language, random without repeats, streak lines, dry humour sometimes (by feedback style), `affirm` hatch; the whole pool baked into recorded narration.
- **W18 Vertical settling** — after layout, centre the page's content (union over the whole run, heading excluded) vertically in the content area when the gaps are clearly uneven; relax spacing only where the engine owns positions (templates, cards, scales, laid-out groups); `page.valign` hatch ("center" default, "top", "none"). Starts after W1 merges (same files).
- **Thumbnails** — the front-page card picture must be the real page scaled down (same aspect, letterboxed), never a re-layout at another aspect.

## W2 — cards (built 2026-10-04)
- `size` on a cards element: `"auto"` (default) or a factor 0.6–2 on every size (card, icon,
  gaps, boxes, end words, values, counter, fonts). Auto grows (≤ ×1.6, step 0.05) only when the
  cards are alone on the page — nothing else but text, labels, annotations and (placing cards)
  their scale — to the largest size that fits the content area whole (under the heading, top 700
  without one; over the caption band; over any text the author put under the cards), centred
  unless `y` is given, across x 60–940 unless `x`/`width` is given. The group carries the chosen
  number, so the gate, the plan and the lint read the same geometry. A deck and a formula's tiles
  keep their own sizing.
- Card text wraps to two lines (the card grows a line); smaller only when two cannot hold it;
  `check` warns `cards-text` when a text needs three. Deck cards stay one line (deck-text).
- The floor is the caption band (160): a set below it moves up while there is room under 660,
  then icon cards (and a sort's cards, after more columns in its boxes) get shorter. Plain cards
  keep their height. A deck still stands on the canvas floor (at 160 a 30-card deck loses a column
  and half its dealt card) — open.
- compare: icons as on rank/sort; `title` true / false / words — default none when the page has
  a heading (a `card` command, or the title per W1), else the question; a cast that names
  `<id>_title` in its commands keeps it.
- A compare value and a label attached to a card follow the card (gate, slide, beside reveal,
  the plan's after-ask offsets); erasing or hiding a card (or the set) takes its value.
- **W24 Help section** (user, 2026-10-04) — after the round's features land: update the app's help (public/help.html and anything it links) for everything new — the page frame and `heading`, cards `size`/two-line text, number-line formats, chart ticks, on-canvas quiz buttons, `affirm`, `size_compare`, icon fallback lists, reveal stamps, sequence, the new question types — and the `.cast` DSL (settings keys, new fields), with short examples.
- **W25 Interaction polish (seen by W21, 2026-10-04)** — headline mode shrinks the figure to ~295 px wide (drawing gets hard); the ask headline overlaps the top of a crowd; the bar guess's value pill sits over the y-axis; the crowd's count pill overlaps its legend; the ant icon covers the hint in ants-on-earth.


## W18 — vertical settling (built 2026-10-04)
- `layout/settle.ts`, applied last in `layoutSpec`: the figure — every top-level drawable but the
  card headings (`card_<n>_…`, the centre card too) and what is pinned to the page (`at: {place}`,
  and what is placed against or labels it) — is measured whole and moved by one `dy` when the gaps
  above and below it in `contentBox()` differ by more than 60 units (`SETTLE_SLACK`); the move
  evens them. That rule is also the "already fills the page" rule: a figure within 60 of the
  area's height (≥ 88 %) is never moved — a separate 85 % cut left quiz cards touching the heading.
  A pinned box in the figure's columns is a floor/ceiling the move stops 10 short of.
- The run, not the first frame: a cards element counts where its cards go (homes, slots, bins,
  true places — spec/cards.ts geometry), so a timeline whose cards are answered above the line is
  not lifted into the heading.
- One transform, carried where positions are read: the drawables (clips too), named anchors and
  piece geometry move; the layout's `fit` carries it (`TemplateFit.settle`, s 1) so
  `domainMapping` — `{data}`, a command's canvas point, a guess's data mapping — follows, also on a
  page with no domain; `formulaHooksFor(…, settle)` moves a cards element's spec-computed geometry
  (homes, slots, truth, bins, `binSlot`, `placeAt`, its scale's line) for the plan and the player.
  On-canvas answer buttons, choose options and formula tiles are read off the layout already.
- Left as laid out: `page.valign: "none"`, a page with no heading (composed on the whole canvas
  by hand) or no commands (a preview, a unit figure), books, insets, a shown code pane, live `vars`, a
  template that lays out in (or is fitted/grown to) its box, a world larger than the page, a widget
  or interactive template, and any cast whose figure changes over the run in ways one layout cannot
  show (animate, move, arrange, flip, morph, copy, ghost, trail, run, explore, step),
  `{canvas: …}` in a command, a camera aimed at numbers. (A guess on a scale was on this list
  until 2026-10-05; it settles now — W30.) Lints run before the move (they judge the layout as built).
- Hatch: top-level `page: {valign: "center" | "top" | "none"}` (strict; `.cast` setting `page:`).
- Not done: relaxing spacing inside laid-out groups; settling casts with moves/morphs (their
  boundary layouts carry poses, so a per-layout dy would jitter — it would need the base dy pinned
  across relayouts); bundled examples blocked that way and off-centre by 30–150: about 16.
- **W27 Found while re-preparing quizzes (2026-10-04)** — chart/pie labels (~20) look small beside large cards: scale chart text with the page's card size or offer `label_size`; cards with company never grow (by design) and authors guessed sizes — consider growing against the free area of the content box; `check` doesn't treat the estimate slider (`estimate_1`) as erased after `erase`; a number line can't take extra markers (author hand-placed "old limit: 7" and "2011: 13"); idle opening beats in sequence casts (the first item could draw with the opening line).
- **W28 Wishes from the quiz reviews (2026-10-04)** — card layouts with company still look small (grow cards into the free part of the content box, not only when alone); a slightly larger heading font; the frames tool should draw the quiz card / buttons on question frames and show the pre-answer state there (reviewers keep flagging "spoilers" that are only the frames' answer-state tiles); chart label size and pie start angle hatches; a sequence item's `cites`; number-line extra markers ("old limit: 7").


## W25 — interaction polish and template faults (built 2026-10-04, branch layout-pa)
- **Ask headline** (ui/gate-dock.ts): stands OVER the drawing in the heading strip (y 655–750), its
  font fitted there (22 → 13 px; the how line goes to the dock before the question drops under 17);
  above the drawing only when the stage has height for both; a hidden caption takes no height; at the
  least size an overrun lowers the drawing by just that. A 460 px player keeps its full figure.
- **Pills**: a crowd's count pill hangs under the people and the legend (countPillPoint); a bar's
  value pill stays between the y-axis and the plot's right end (ui/bar-pill.ts).
- **scale-marker lint**: anything on screen at a scale guess in the band its marker number takes.
- **Template labels come with their element**: a template's `attached` list and `label_<id>` are
  drawnAfter (layout.ts); number_line's ticks come with its line; pathway names inside their shapes.
- **Readable templates**: forest_plot (26/22, compact rows, axis ≥ 240), causal_dag (26–20, ellipse
  round its name), event_study / did_trends / rd_plot / ceac plots from y 205; ceac `currency`,
  `thousands`, `x_min`, `x_label`, a free `x_max`, and a template warnings channel
  (`SceneLayout.warnings`) for a threshold off the axis; bar_chart/line_chart ticks two sizes up when
  the chart is the page's figure.
- **Engine**: `shape: "person"` on a shape; quiz/poll button icons resolve (resolveIcons/iconSlots
  see the command looks); log-scale tick thinning measures as the lint does, and the marker's number
  stays on the page; at-ref elements follow their card into a select/sort box, whose rows open by
  the label's height (`label_room`); a ring/box highlight encloses the target's own labels.
- Not done: binscatter's plot (same y 130, an example draws on it); annotation circles round
  attached labels; a faded ghost of template parts on `animate` / `keep`.


## W31 — move-aware check (built 2026-10-04, branch r3-move)
- `check` now judges what a move brings together, statically: `src/lint/moved.ts` `movedIssues`
  plans the cast exactly as the player does (`render/index.ts planSpec`, extracted from render()
  so both share it — moves, arranges, labels that follow their element, compare values and
  attached labels that follow a card, cards that go to their slots / boxes / true places on a
  question's reveal, turns, morphed outlines, visibility and fades) and, at the RESTING boundary
  after each command (never mid-animation), lays the figure out at that boundary's params and
  re-judges the pairs the poses moved relative to each other (`lint/posed.ts rejudged`, the
  half of `posedIssues` the frames harness already used).
- Attribution: the plan records which command made each step (`Plan.commandOf`, −1 for the
  implicit final draw); an issue reads "— where it stands after the move leaf_0 ("Forks spin
  freely…")" — verb, targets, the line's first words (not an index: check judges the expanded
  spec, where a card beat or a question is several commands). One report per (rule, ids), at its
  first boundary; a pair the layout already reports is not repeated.
- Exemptions kept: the layout's composition pairs (scratch card, annotation on its target, a
  deck's stack, `fit` groups — now one exported `composedPairs`, which the frames harness passes
  too) and the accepted crossings of a moving field (`crossing` keys, lint.ts). A sub-drawable
  (`xb1_text`) is posed with its element, and a morph's new outline is used — both were missing
  in `posedIssues`, so the frames harness gains them as well.
- Placement rules only (overlaps, out-of-canvas). Crowding counts texts on the page, which a move
  does not change; settling never moves a cast with move/arrange, so its dy is in the layout.
- Verified: 390 bundled examples and all 50 library/quiz casts. New: examples "Reading a tree of
  life" — Human written over Chimp for the beat between the two half-swap moves (the frames harness
  flags the same frame, @15; real); library "How loud is loud?" — "Rock concert" / "Lawnmower"
  after the ranking's reveal, the same heuristic-metric card-text verdict check already gives the
  cards at home (not seen in the browser's metrics). Nothing else.
- Limits: copies and ghosts (minted at plan time) are not judged; neither is a measure's rewritten
  text or a formula's morphed TeX; heuristic metrics as the rest of `check`; textual command order
  (gotos not followed), as coVisible.

## Round 3, workstream 1 — quick wins (built 2026-10-04, branch r3-quick)
- **Scale markers** (W27/W28): `markers: [{value, label?, color?}]` on a `scale` → `<id>_marker_<n>`
  (`_tick`, `_words`, `_lead`): a taller tick, the words in rows above the answer's band (clear of
  the tick numbers under the line, each other and the caption); the leader is left out where it
  would cross the answer's number. They come with the line (render drawnAfter) unless the cast
  draws one itself, and go with it (ownedBy). (`marks` was taken: text punctuation.)
- **Heading** (W28): `headingFont` 26–40 (was 26–36); underline ≈ 693.
- **Sequence item `cites`** (W28): copied onto `<id>_k` and `<id>_k_label`; validated against sources.
- **Pie `start_angle`** (W28): degrees clockwise from 12 o'clock; names placed in a clockwise-from-12
  walk; a guess on the pie honours it (handle `pie.start`).
- **Chart `label_size`** (W27/W28): bar_chart, line_chart, pie_chart, 18–40; collision shrink kept;
  defaults unchanged.
- **Erased estimate** (W27): coVisible sends a scale's answer marker and markers with its erased line.
- **Binscatter** (W25 not-done): plot from y 205; the example's marks moved to data units.

## W30 — minimum text size (built 2026-10-04, branch r3-text)
- **The minimum**: `TEXT_MIN = 18` logical units at text scale 1 for anything a template draws that
  a viewer reads (ticks, dates, values, notes, matrix cells), `TEXT_LABEL = 22` as the default for
  names a viewer must read to follow the figure (categories, node and state names, axis captions) —
  `src/layout/readable.ts`, on the kit as `kit.TEXT_MIN` / `kit.TEXT_LABEL` (kit v15). The lint's
  `FONT_FLOOR` (14) stays the "unreadable" warning. Short of room a template thins, wraps or
  truncates before it goes under `TEXT_MIN`.
- **Template box** (layout/template-fit.ts): a box that shrinks the figure holds text drawn at ≥ 18
  at 18 (it went to 14); text drawn smaller keeps its own size. A body that packs its own words asks
  `kit.textFit()` (1, or 1/s in a box fitted at s < 1) and is laid out again with the answer, so its
  words are packed at the size they are drawn (sky_map). decision_tree's own squeeze keeps the old
  floor (`fitSceneLayout(…, FONT_FLOOR)`).
- **Advisory** (`small-text`, lint/template-text.ts): `cast.mjs check` and frames print how many of
  the template's own texts are drawn under 18 (after the box and `text.font_size`); never a layout
  issue. tests/readable-text.test.ts holds every bundled template example to it at scale 1 (bar the
  four below).
- **Per template** (before → after): tornado_diagram names 17 → 22 (down to 18, then "…"), values
  15 → 18, "Base case" 17 → 20, x caption 21 → 22, a name clears its low value's width (was a fixed
  52) and the axis stands under the last bar (the figure now grows into the content area);
  timeline ticks 16 → 18, dates 17 → 18, axis ends 17 → 18, era names 18/16/14 → 20/18/18 (bands
  32/25/21 → 32/26/25; ticks were already thinned by width); sky_map names/notes/compass land at
  ≥ 18 in a box (were 17.6/16.7, 14 at s 0.73); solar_system scale bar 16 → 18 (names held by the
  box floor, were 16.8); bar_chart floors — categories 17 (13 past 12 bars) → 18 then every k-th
  bar labelled, values 15 → 18, y ticks 15 → 18 (else none), note 16 → 18; line_chart category
  floor 17/13 → 18 (every k-th already), tick floor 15 → 18, note 16 → 18; scatter_plot fit equation
  16 → 18 (and a point name's obstacle measured at its drawn 19, was 16); bar_race names/values floor
  14 → 18 — lying down, a field too deep for 18-unit rows shows fewer racers; heatmap names and
  values dropped under 18 (were shrunk to 14), note 16 → 18; distribution_curve SD ticks 16 → 18;
  sampling_dist ruler 16 → 18, the ± number set clear of a narrow curve; sir_compartments names
  ≤ 18 fitted → 18–20 in wider boxes (112/124 → 132/136); did_trends "Counterfactual" 16 → 18;
  lorenz_curve curve names 17 → 20; nephron structure names 17–18 → 22, "(Bowman's capsule)"
  14 → 18, transport species 16 → 18, "Urine" 16 → 20 (labels moved to fit); pv_loop legend 17 → 19,
  ESPVR/EDPVR 16 → 18, stroke volume 17 → 19, EDV/ESV 15 → 18; heart_circulation chamber names
  17 → 19; game_tree branch actions 17 → 19 (a little further off the line); firm_cost_curves minima
  17 → 19; world_map markers 16 → 18; morse_key / xylophone / bubble_sort hints 15–16 → 18;
  des_process "+N" 15/17/14 → 18; cost_effectiveness_plane quadrant names 16 → 18;
  two_by_two_table cell notes 16 → 18; motion_graphs track ticks 17 → 18; periodic_table group and
  period numbers 14 → 18. anatomy, water_cycle, flower_anatomy, energy_diagram, tangent_secant,
  screening_timeline, rd_plot, ppf, generic_axes_diagram, ci_dance, violin_anatomy: their examples'
  boxes took 19–22-unit labels to 16.5–17.9; the box floor now holds 18. pie_chart, forest_plot, causal_dag and the
  rest were already ≥ 18.
- **Not done**: decision_tree (names 26 → 16 as a tree grows, numbers 0.85×, column heads 0.75× —
  14 in a squeezed rollback tree; raising them sent a 6-terminal tree into a world), markov_model
  (matrix/table floors 14–16; raising them put a 5-state traced model into a world or the captions),
  des_hta (a dashboard of 14–17 throughout — needs a redesign, not a floor), periodic_table's cell
  lines (atomic numbers, "57–71" at 14: 118 cells in 1000 units). A chart `label_size` hatch is
  another workstream's.

## W29 — cards grow with company (design 2026-10-04, round 3)
Quiz reviews: card layouts with a chart, a number line, pictures or words beside or below them
still look small, and authors guessed `size` (1.05 … 2). `size: "auto"` now also grows cards that
share the page, into the part of the content box nobody else uses.
- **Company** (spec/cards-company.ts): every element on screen at the same time as the cards at
  some point of the run — a visibility walk over the commands (draw/show/reveal on, erase/hide/clear
  off, a group's members with it, an element no verb names joins at the end). Not company: the
  cards' own parts, their followers (a compare value, a label attached to a card, an element placed
  `at: {ref: <card>}`), the scale a placing set goes on, the heading (`card_<n>_…`, and the strip
  above `CONTENT_TOP`) and the caption band (below `CAPTION_TOP`), which bound the room anyway.
- **Boxes from the spec**, as the cards' own geometry is (no layout pass, so the gate, the plan
  and the lint keep reading one number): text and math by the heuristic measure about their x/y;
  icon `size`; shape rect/circle/person; ellipse `rx/ry`; path/polygon/line points; arrow `from/to`
  points or refs; a scale's line with its tick labels and marker; a label or an `at: {ref}` element
  as its host's box grown by its own size; `at: {place}` (pinned) at its page corner; a template as
  its box (default the whole content area). Anything else the spec cannot place (no x/y, images,
  live `vars`, data-unit points) and the cards stay as authored — growth never guesses.
- **The grow**: from ×1.6 down in 0.05 steps, the first size whose run extent (homes, slots, bins,
  true places, compare values, a rank's end words, room for followers' labels) stays inside the
  content box (x 60–940, y 160–655/700) and keeps 16 clear of every company box it did not already
  touch at size 1 — and covers no more of one it did (words put inside a box, a chart behind the
  cards). Across the full width when the author gave neither `x` nor `width` and that is free, else
  the authored span. Vertically the grown set keeps its centre where size 1 had it, slid only as far
  as the free band (the room between the company boxes above and below, in its columns) needs;
  an authored `y` is that centre. A set that is already out of the frame at size 1 does not grow.
- **Settle (W18)** runs after, on the finished layout, unchanged: growth fills first, settle evens
  what is left. Sort/select boxes, place levels and the counter grow with the cards (they are in
  the extent); labels and values that follow a card are offset by its slide as before.
- **Off**: an explicit `size` (a number — `size: 1` is the hatch for "as authored"), a deck, a
  formula's tiles. A page whose only other ink is words (text, labels, annotations) is "alone" and
  keeps the W2 rule (centred, words under the cards a floor); it now also leaves room for the
  followers' words. A compare title (no heading) is kept under `CONTENT_TOP` with the cards, out of
  the strip the ask's headline takes (W25) — at ×1.6 it stood under the headline.
- **Lint**: no new rule. The overlap and crowding checks judge the grown cards as drawn; since the
  grow keeps clear of company it adds no overlaps. `check` reports the size chosen only through the
  existing geometry (frames show it).
- **Built 2026-10-04** (branch r3-grow): spec/cards-company.ts (`coVisibleWithCards`, `elementBox`,
  `followerRoom`, `cardsCompany`), spec/cards.ts `growWithCompany`; tests/cards-company.test.ts.
  Library quiz casts as published: no change (their sizes are explicit, or the set is alone, or it
  is already off the frame at size 1). With the guessed sizes removed: baby-animal-names 1.15 (was
  guessed 1.05), famous-paintings 1.15 (1.25, which needed squeezed icon cards), longest-pregnancy 1.6
  (1.5), which-is-heavier 1.2 (1), which-came-first 1 (1; the alone rule gave 1.2 and pushed its
  side words off the page), cleopatra-closer / how-loud-is-loud / most-spoken-languages 1 (off the
  frame / touching words / a chart over the page). Bundled example "What is more dangerous" (company erased before the cards): 1 → 1.05 with its icons (1.4 without).

## W30 — less empty page at the bottom (built 2026-10-05)
Hans on ants-on-earth: "quite a lot of vertical free space at the bottom … a general problem with
many drawcast pages … not perfectly centralized, some white space below is fine, but this is too
much". Three causes, three rules — none of them stretches what an author placed:
- **The caption band is right-sized: `CAPTION_TOP` 160 → 110** (`FIT_BAND` and `contentBox()`
  follow: y 110–655, 545 high). The overlaid caption (render/figure-style.ts) is 1.15rem × the
  cast's text scale, line-height 1.35, 0.65rem padding, 0.4rem off the floor: two lines are 66 px
  at text scale 1 and 82 px at 1.3. In canvas units that is px × 750 / stage height — measured
  stages: 512 px (1280 × 720 window), 652 px (1440 × 860), 808 px (1920 × 1080), i.e. 62–120
  units. 110 holds two lines at scale 1 on any stage ≥ 450 px tall and at scale 1.3 on ≥ 560 px;
  the band was 160, about a fifth of the page held for words that take a tenth. A phone held
  upright writes the words below the drawing; text under 85 still gets its own strip
  (caption-dark.ts `CAPTION_STRIP_TWO`). The pie and size_compare templates' spelled-out copies of
  the content area follow (data.yaml, compare.yaml). Note: the frames harness draws captions on
  ~345 px tiles, where two lines cover ~180 units — it overstates the caption against the player.
- **Settle sooner: `SETTLE_SLACK` 60 → 30.** 60 called ants' 0-above / 35-below "noise"; 30 is
  about one row of tick numbers. The "already fills the page" rule follows (≥ 94 % of 545).
- **Centred, not biased.** The content area already sits high (its centre 382 is 36 above the
  middle of the room under the heading's underline, 693 … 0) — that is the optical lift, and the
  overlaid caption fills part of the band while the voice runs. An extra upward bias would bring
  the empty bottom back.
- **A guess on a scale settles.** `guessSetup` hands `scaleHandle` the layout's `fit.settle`: the
  handle's `scale` carries the settled line's `y` (so the pointer, hit-testing, marks, the reveal
  and polls — every reader of `scaleGeometry(h.scale)` — meet the ink) and `scaleSettle` the
  shift; `patchFor` writes the preview marker at the spec's line, since the preview layout
  settles it by the same dy (tested: tests/settle.test.ts). Cards along a scale were already
  moved by `settleCardsGeometry`.
- Effect (node survey, 440 library quiz + bundled casts, no picture icons): 112 change, 59 newly
  settled; on settled pages the median of (white below the figure − white above it under the
  underline) 105 → 71. Browser frames: ants bottom/top white 195/38 → 153/80; earths-in-the-sun
  187/50 → 155/82; Schooling and pay (binscatter) 162/11 → 123/50; the deck "Fruit or not?" 42 →
  126 off the floor; Fish, coconuts (node) was 4 units off the canvas floor and now settles. Cards
  centred or grown in the content area (eleven-oscars, Is it a fruit?) reach ~110–120.

