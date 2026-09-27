# Prompt lab ledger (newest first)

Each entry: the hypothesis, what was run, what we saw, what was decided.

## Open ideas

- **Plan first with a size budget.** The plan step explained better in
  run 1 but crowded pages; give it a budget (short labels, ≤ 8–10 branches or
  boxes, extra numbers said not drawn) and rerun against `standard`.
- **Sonnet as the look critic** — half the price of Opus 5.5 ($2/$10 vs
  $4/$20 per MTok), probably faster; does it see as much?
- **A slimmer compiler prompt** per the rule audit (tool facts as reference,
  house taste as one page, general craft left to the model and the examples).
- **Emphasis in frames**: the critic now sees gestures mid-sentence — does
  it judge emphasis better than before?

## 2026-09-27 — A template's own parts can be moved and enlarged

- **Why:** the critic kept asking to move or enlarge a template's readout or
  curve labels, and the fix round had no field for it: those parts are drawn
  by the template, not spec elements, so the fix was lost.
- **Built:** `spec.adjust` — `{"<part or group id>": {"move": [right %, up %],
  "scale": 0.5–2.5}}`, applied in the layout before labels are placed
  (`src/layout/adjust.ts`); an unknown id warns (`adjust-unknown`). The fix
  prompt names it. Not measured yet: watch whether readout/label fixes now
  land in the next look-pass runs.

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
