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
