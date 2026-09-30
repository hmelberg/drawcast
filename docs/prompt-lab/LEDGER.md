# Prompt lab ledger (newest first)

Each entry: the hypothesis, what was run, what we saw, what was decided.

## Open ideas

- **Plan first with a size budget.** The plan step explained better in
  run 1 but crowded pages; give it a budget (short labels, ≤ 8–10 branches or
  boxes, extra numbers said not drawn) and rerun against `standard`.
- **A slimmer compiler prompt** per the rule audit (tool facts as reference,
  house taste as one page, general craft left to the model and the examples).
- **Emphasis in frames**: the critic now sees gestures mid-sentence — does
  it judge emphasis better than before?

## 2026-09-30 — The local skill on a rule card: no loss on three cases

- **Hypothesis:** the /drawcast skill's author need not read the whole app
  prompt (~140k characters: rules 59k, few-shots 35k, catalogue, exemplars,
  shortlisted templates). A condensed rule card (~15k,
  `.claude/skills/drawcast/references/rule-card.md`: every tool fact in
  short form, house taste as single lines) in place of the rules, and no
  generic few-shots, should stage as well and cost less.
- **Run (free, on the machine):** three requests (drug half-life —
  pk_curve; heat pump — freehand; 99% screening test — bayes_tree), each
  authored twice by fresh Opus agents following the revised skill (story
  with brief, fact check + sources, check, frames, look/fix; no fresh-eyes
  step): arm A read the whole prompt file, arm B read the card plus the
  catalogue, exemplars and shortlisted templates. One blind Opus judge per
  request compared the final tiles and spoken lines (X/Y, arm order mixed).
- **Seen:** card preferred for half-life (clear) and screening (slight);
  full read preferred for heat pump (clear — a larger, tidier freehand
  figure and a live kWh example). Arm B used ~125k tokens per cast against
  ~175k (about 30% fewer) and finished faster; B's agents grepped the full
  rules twice in all (explore opening the tray; scratch x/y) — both lines
  are now on the card. The judges' reasons were mostly about the STORY
  (which question the insight answers, which example), not about rules
  one arm lacked.
- **Caveats:** three pairs, one run each; the judges are Opus; the
  half-life B agent leaned on an exemplar that answers the same request.
- **Found on the way:** `frames` left stale tiles from a longer earlier
  render in the folder (authors and critics could judge frames no longer in
  the cast) — fixed, it now drops them. Engine/template issues for the
  backlog: bayes_tree rounds 99.9% to "100%", has no thousands separators,
  fixed "only M are sick" wording and 15–16 px labels; pk_curve has no tick
  numbers, ids that only exist after an animate cannot be drawn/hidden
  earlier, a `point` at `{data}` maps y by the starting y_max after y_max is
  animated, `ghost` on a template animate leaves stray copies but no curve
  ghost; `node` ignores font_size (NODE_FONT 24); a circle/box highlight on
  two separate labels draws one shape round both; the default glow recolours
  coloured text red.
- **Decided:** full read stays the default for a single drawcast (quality
  first in the repo); the card is the read for course parts (many casts per
  session) and the base of the portable skill. Rerun with more cases before
  making it the default everywhere.

## 2026-09-27 — Sonnet as the look critic: no

- **Hypothesis:** Sonnet 5 (half Opus 5.5's price) sees the frames as well
  as Opus, so the critic call could move to it.
- **Run (free, on the machine):** the 16 first- and second-look calls of run
  3's machine arms (4 figures × A*/D* × 2 looks), their saved frame sheets
  and prompts. Sonnet agents answered each call fresh; the Opus answers are
  the ones on file. Four Opus judge agents compared each pair blind (random
  A/B) against the frames, item by item.
- **Seen:** Opus preferred in 16 of 16. Real major problems found: Opus 48,
  Sonnet 16; wrong items (not in the frames, or a fix that makes it worse):
  Opus 2, Sonnet 22. Sonnet's typical misses: highlights it said were
  absent, "cut off" captions that are only paged with the voice, empty
  space that was not there.
- **Caveats:** the judges are Opus (possible self-preference), and the Opus
  answers were written in the original run, not fresh. The gap is too large
  for either to explain.
- **Decided:** the critic stays on the creative model (Opus). No API
  confirmation needed.

## 2026-09-27 — A template's own parts can be moved and enlarged

- **Why:** the critic kept asking to move or enlarge a template's readout or
  curve labels, and the fix round had no field for it: those parts are drawn
  by the template, not spec elements, so the fix was lost.
- **Built:** `spec.adjust` — `{"<part or group id>": {"move": [right %, up %],
  "scale": 0.5–2.5}}`, applied in the layout before labels are placed
  (`src/layout/adjust.ts`); an unknown id warns (`adjust-unknown`). The fix
  prompt names it. Not measured yet: watch whether readout/label fixes now
  land in the next look-pass runs.

## 2026-09-27 — long-label lint

- **Built (Hans):** a label of more than four words warns (`long-label`):
  canvas text is a cue, the voice says the sentence. Labels only (curve,
  branch, part names); headings, cards and quotes are exempt. Seven bundled
  examples and the gears template's wheel label were shortened to pass.

## 2026-09-27 — Courses get the look pass

- **Decided (Hans):** a course follows the same setting (Look at the frames
  and fix) as a single figure; every part is looked at. The course cost
  estimate learns a separate rate with the look pass (`|look` in the key).

## 2026-09-27 — Plan first vs one call; the look pass

- **Hypothesis:** a plain-text plan (teacher) before the JSON (compiler)
  explains better; a critic that sees the frames fixes the layout.
- **Runs:** 1 (5 freehand, A vs C, API), 1b (C2), 1c (D by agents),
  2 (4 template requests, manual mode), 3 (the fair test: A* and D* with the
  same improvements, 2 freehand + 2 template, API and machine = 16 figures,
  four blind reviewers).
- **Seen:** the plan explains better when the single call is un-improved,
  but with the same improvements on both sides it no longer wins (7.4 vs 6.9
  explanation, 5.6 vs 5.75 visual). The look pass is what moves the visual
  score; where its fix was lost (the API, 3 of 4 D* runs) the look was worst.
  Machine runs score higher than API runs (+0.75 / +1.4). The pedagogy pass
  had no effect in five of five API runs.
- **Decided:** the single call + the look pass is the app's pipeline (main
  b41d5f3); the pedagogy pass is off; plan first stays a developer-mode
  option. Short canvas text became a house rule. Eleven engine/template
  faults the reviewers found were fixed on main the same day.
