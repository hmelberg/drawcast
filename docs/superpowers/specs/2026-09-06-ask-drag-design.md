# Drag-to-place questions: `ask` with `widget: "drag"`

**Status:** approved in chat 2026-09-06 (Hans: "ja").

## What the viewer gets

A question that hands the viewer a short list of names on the left of the
figure — "Heart", "Liver", "Stomach"; "Norway", "Sweden", "Finland"; "C", "E",
"G" — and asks them to drag each onto the figure where it belongs. Each drop is
judged at once: in place, close enough, or off. When every name has landed the
card says how many are in place, the true parts appear (an organ that was
hidden is drawn), the right ones glow green and the missed ones red while the
answer line is spoken, and the lesson goes on. Skip and retry work as for every
other question.

Hans asked for both a graded and a binary verdict: the grade is shown per
chip ("in place" / "close" / "off"), the binary verdict decides right/wrong
(all in place or close enough → right), and the reveal glow shows the truth.

## One mechanism, every figure

The drop target of a chip is anything the click widgets already know how to
locate: an **element id** (an anatomy part, a `country_<slug>` on the map, any
drawn thing with a closed outline or a box), a **note** on a piano figure
(`C4`, through the piano widget's key geometry) or a **square** on a chess
figure (`e4`). Outlines come from `elementRings`, boxes from `elementBBoxes`;
neither depends on the template. So the body, the map, the keyboard and the
board work on day one; staff positions on a note sheet need ids in the music
template first (roadmap).

Chips carry a label. The author gives it (`{ "id": "kidney_left", "label":
"Left kidney" }`); a bare id gets a humanised default (`kidney_left` → "Kidney
left"). Chips with drawings instead of names are a later step (the renderer can
draw one element alone into a small SVG).

## The spec

```json
{ "ask": {
    "question": "Drag each organ to where it belongs.",
    "widget": "drag",
    "items": [{ "id": "heart", "label": "Heart" }, { "id": "liver", "label": "Liver" }, "stomach"],
    "tolerance": 0.25,
    "right": "The heart between the lungs, the liver under the right ribs, the stomach to the left below it.",
    "wrong": "Feel for the ribs: the heart sits between the lungs, the liver just under them on the right." } }
```

- `items` (1–8): what to drag, each an element id, a note or a square, with
  an optional label. Every item has a true place; distractors are not part of
  this round.
- `tolerance` (0–1, default 0.25): a drop outside the target's outline still
  counts when its distance to the outline is at most this fraction of the
  target's bounding-box diagonal. `0` means "inside only".
- `answer` is implied — the items themselves — and may not be written.
  `right` is REQUIRED: the reveal has to be a sentence, not a list of ids.
- Everything else about an ask applies: `intro`, `wrong`, `retry`, `reveal`,
  `required`, `right_goto`, `wrong_goto`. `store` is not meaningful and is
  refused.

## Judging

For a drop point p and a target: inside the outline (or the box, when the
target has no closed outline) → grade **in**, distance 0. Otherwise distance =
the shortest distance from p to the outline (or box edge) divided by the
target's bbox diagonal: ≤ `tolerance` → **near** (counts as a hit), else
**far**. A question is right when every item is a hit. The gate returns the
hit items' ids joined by ","; the planner sets the step's `answer` to all
items' ids joined by ",", so the player's existing string comparison decides
right/wrong and the outcome, score variables and gotos come for free.

## Reveal

At the end of the step every item that is an element becomes visible (the
planner records it in the step's state, so scrubbing agrees) and the player
glows hit items green and missed items red while `right` (or `wrong` then the
reveal) is spoken — the click widget's glow, in two colours. Notes and squares
have nothing to draw; they get the chip verdict only. In movies and the bare
player the laser taps each target's box in turn, as it taps a click answer.

## Files

- `src/ui/drag-model.ts` (new, pure): `humanLabel`, `resolveDragTargets`,
  `judgeDrop`, `dragSummary`. Node-tested.
- `src/ui/drag-gate.ts` (new, DOM): the tray of chips over the stage, pointer
  drag with capture, drop → judge → verdict on the chip, summary, skip.
- `src/spec/schema.ts`, `src/spec/types.ts`: `widget: "drag"`, `items`,
  `tolerance`, the validation rules above.
- `src/render/plan.ts`: the drag step (`items`, `tolerance`, `answerBoxes`,
  implied `answer`, post-step visibility, a warning per unresolvable item).
- `src/render/player.ts`: two-colour glow, show the elements, tap each box.
- `src/ui/controls.ts`: dispatch `widget === "drag"` to the drag gate.
- `src/styles.css`: the chips and the summary pill.
- Examples: the organs on the body, the Nordic names on the map, C–E–G on the
  keyboard. Docs: schema descriptions, ROADMAP.

## Not in this round

Distractor chips; chips with drawings; staff-position targets; a distance
readout in centimetres (the anatomy atlas is measured, so it is possible
later); dragging drawn elements themselves.
