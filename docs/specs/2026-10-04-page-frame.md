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
   (x 60–940, y 160–660; up to 700 with no heading), caption band (y 0–160). Every module
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
