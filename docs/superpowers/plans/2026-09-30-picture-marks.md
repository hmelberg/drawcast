# Picture marks — the look and the motion — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On a picture place, `highlight`, `focus` and `point` draw one animated **mark** owned by the picture — a soft paper light (default), a hand-drawn arrow (default for point), a glow, a ring or a box — that eases/writes in, glides from spot to spot across steps and through several stops in one sentence.

**Architecture:** The planner turns every gesture on picture places into a new plan step `{kind: "mark"}` carrying the owner, the mark kind, the picture frame, its stops (boxes with start fractions) and continuity (`from` box, `continues` flag) computed at plan time (seek-safe). The player animates a mark step by sampling one `MarkFrame` per frame (tweened box, level, write-on, depth, breathe) and hands it to a new backend method `setMark(owner, frame)` / `endMark(owner)`. The SVG backend draws each kind. Plain-id gestures and explicit laser gestures are untouched. Delivery 1's place-specific paths (focus `spots`/`setSpotlight`, per-place `box` painting in player and frames) are REMOVED — marks replace them.

**Tech Stack:** TypeScript, vitest, rough.js via the SVG backend, tests' mini-DOM.

**Spec:** `docs/superpowers/specs/2026-09-30-picture-regions-design.md` §13 (binding), with §4–§6.

## Global Constraints

- Plain ids: no behaviour change for any gesture on an ordinary element id. Explicit `gesture: tap | circle | underline` on a place keeps the laser (today's path).
- Mark kinds: `light` (highlight default and all focus on places), `ring`, `box` (highlight `effect: ring` / `box`), `arrow` (point default on places), `glow` (point `gesture: glow`). Effect mapping on places: `glow`/`pulse`/`underline` → `light`, `circle` → `ring`.
- Continuity: a mark step continues the previous mark step on the same owner when it is the same kind, has no `lift: true`, and no step in between hides, erases or clears the owner or puts a different mark kind on it. Camera, speak-only, wait and gestures on other targets do not break it.
- Timing: first appearance eases/writes in over 450 ms; a glide between boxes lasts 550 ms, ease-in-out; a mark that does not continue releases over 280 ms; light depth rises from 0.35 to 0.62 over the step (paper wash alpha = depth × level); glow breathes once per 1.6 s (scale 1 ± 0.08).
- Colours: light wash = `FIGURE_GROUND` (src/layout/ink); arrow = ink `#2b2622` under a `#fff3c4` core (two strokes); glow = radial `#fff3c4` → `MARKER_COLOR` → transparent; ring/box = `HIGHLIGHT_COLOR`.
- Seek-safety: every box a mark uses is computed by the planner; the player never depends on having played an earlier step.
- Commits end with a blank line then `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Work in the worktree `.claude/worktrees/picture-regions` (branch `picture-regions`); never touch the main checkout.

## Review Focus

1. **Seeking into the middle of a glide** — the mark must appear at the step's own box, never stuck at a stale one or missing. Pinned in Task 3 (player starts at `from` only when the previous step actually played; `seekTo` paints the step's end state).
2. **Abort / stop / step-back while a continuing mark is up** — no mark left on screen. Pinned in Task 3 (`endMark` on every reset path that clears the laser).
3. **A mark on a picture that is then hidden** — the next mark does not glide from a hidden picture. Pinned in Task 1 (continuity breaks on hide/erase/clear).
4. **Mixed place + id targets** — ids behave exactly as before; places in a mixed highlight are dropped with the existing warning. Pinned in Task 1.
5. **Frames sheet parity** — the contact sheet shows each mark at its end state, so the authoring look-loop sees it. Pinned in Task 3.

---

## File Structure

- Modify `src/spec/types.ts`, `src/spec/schema.ts` — effects `light`, `ring`; gestures `arrow`, `glow`; `lift?: boolean` on highlight, focus, point.
- Create `src/render/marks.ts` — pure: `MarkKind`, `MarkStop`, `MarkFrame`, `markFrameAt(step, t, ms)` (the whole animation curve, testable without DOM), `arrowGeometry(box, frame)`.
- Modify `src/render/plan.ts` — emit `mark` steps for places; continuity; drop `spots`.
- Modify `src/render/backend.ts` — `setMark?`, `endMark?`; remove `setSpotlight`/`endSpotlight`.
- Modify `src/render/svg-backend.ts` — draw marks; remove spotlight.
- Modify `src/render/player.ts` — play `mark` steps; remove per-place box painting and spots; `endMark` on resets.
- Modify `src/dev/frames.ts` — paint mark end states; remove spots/per-place box code.
- Modify `src/llm/prompts/compiler-v1.md`, `tests/prompt-size.test.ts`, both example casts.
- Tests: `tests/picture-marks-plan.test.ts`, `tests/picture-marks-frame.test.ts`, `tests/picture-marks-backend.test.ts`, `tests/picture-marks-player.test.ts`; update `tests/picture-plan.test.ts`, `tests/picture-backend.test.ts`, `tests/picture-player.test.ts` where they asserted the replaced behaviour (box default, spots, per-place boxes).

---

### Task 1: Mark steps in the planner

**Files:** `src/spec/types.ts`, `src/spec/schema.ts`, `src/render/marks.ts` (types only in this task), `src/render/plan.ts`, tests `tests/picture-marks-plan.test.ts`, updates to `tests/picture-plan.test.ts`.

**Interfaces — Produces:**

```ts
// src/render/marks.ts
export type MarkKind = "light" | "ring" | "box" | "arrow" | "glow";
/** One stop of a mark: its box (canvas, y-up) and when it is reached, as a fraction of the step. */
export interface MarkStop { box: BBox; at: number }
// plan step (add to the PlanStep union in plan.ts)
{ kind: "mark"; owner: string; mark: MarkKind; frame: BBox; stops: MarkStop[];
  from?: BBox;          // the previous mark's last box when this one continues it
  continues?: boolean;  // the NEXT mark step continues this one: do not release at the end
  seconds: number; untilNarrationEnd?: boolean }
```

Types: `HighlightEffect` += `"light" | "ring"`; `PointGesture` += `"arrow" | "glow"`; `HighlightArgs.lift?`, `FocusArgs.lift?`, `PointArgs.lift?: boolean`. Schema: the two enums, a `lift` boolean on the three verbs ("Start this mark fresh instead of gliding from the previous one on the same picture."), and extend the highlight effect description by one clause: `light = a soft light on a picture place (its default), ring = a hand-drawn ring`.

**Planner rules (all in plan.ts, next to `placeNow`):**
- highlight whose targets are ALL places on ONE owner → a mark step: kind = effect mapped (undefined/`light`/`glow`/`pulse`/`underline` → light; `circle`/`ring` → ring; `box` → box); stops = the places' boxes in order, `at = i / n`. Places on two owners → one mark step per owner, in order, each with its own places. Point/anchor places in a highlight: stop box = a 60×60 box centred on the point.
- focus whose targets are all places → mark `light` (same stops rule). A focus with plain ids keeps today's path (places in a mixed focus are dropped with a warning `focus: places and ids in one focus — focus "<place list>" in its own command`).
- point with a place ref and gesture undefined/`arrow`/`glow` → mark `arrow`/`glow`, one stop (region/box → its box; point/anchor → 0-size box at the point). `tap`/`circle`/`underline` keep today's laser step.
- mixed highlight (places + ids): unchanged from delivery 1 (ids keep their effect, places dropped with the "in its own command" warning).
- `seconds` and `untilNarrationEnd` as the verb they come from (highlight 1.5, focus 2, point 2 defaults).
- Continuity: keep `lastMark: Map<owner, {kind, box, stepIndex}>`. On a new mark step: if `lastMark` has the owner, same kind, and no `lift`, set `from = last.box` and set `continues = true` on the step at `last.stepIndex`. Delete the owner's entry on draw/show? no — on `hide`, `erase`, `clear` (when the owner is among the hidden ids) and when a mark step of a DIFFERENT kind is put on the owner (then replace the entry). After pushing, set `lastMark[owner] = {kind, box: last stop's box, stepIndex}`.
- Remove the delivery-1 focus `spots` field and its code; remove the `box`-default-on-places logic that the mark path now replaces.

- [ ] **Step 1: Write the failing tests** — `tests/picture-marks-plan.test.ts`, with the same fixture as `tests/picture-plan.test.ts` (rect `{x:100,y:300,w:400,h:200}`, regions `left: [0,0,0.5,1]`, `bottom: [0,0.9,1,0.1]`, plus `right: [0.5,0,0.5,1]`):

```ts
const marks = (p: any) => p.steps.filter((s: any) => s.kind === "mark");
test("highlight a place: a light mark with one stop", () => {
  const [m] = marks(plan([{ draw: ["md"] }, { highlight: { target: "md:left" } }]));
  expect(m).toMatchObject({ owner: "md", mark: "light", frame: rect, stops: [{ box: { x: 100, y: 300, w: 200, h: 200 }, at: 0 }] });
  expect(m.from).toBeUndefined();
});
test("several places in one highlight are stops through the sentence", () => {
  const [m] = marks(plan([{ draw: ["md"] }, { highlight: { target: ["md:left", "md:right", "md:bottom"] } }]));
  expect(m.stops.map((s: any) => s.at)).toEqual([0, 1 / 3, 2 / 3]);
});
test("effects map: circle → ring, box stays box, glow → light", () => {
  const k = (effect: string) => marks(plan([{ draw: ["md"] }, { highlight: { target: "md:left", effect } }]))[0].mark;
  expect([k("circle"), k("ring"), k("box"), k("glow"), k("pulse")]).toEqual(["ring", "ring", "box", "light", "light"]);
});
test("focus on a place is a light mark; point defaults to an arrow, glow on request, laser gestures unchanged", () => {
  expect(marks(plan([{ draw: ["md"] }, { focus: { target: "md:left" } }]))[0].mark).toBe("light");
  expect(marks(plan([{ draw: ["md"] }, { point: { at: { ref: "md:left" } } }]))[0].mark).toBe("arrow");
  expect(marks(plan([{ draw: ["md"] }, { point: { at: { ref: "md:left" }, gesture: "glow" } }]))[0].mark).toBe("glow");
  const p = plan([{ draw: ["md"] }, { point: { at: { ref: "md:left" }, gesture: "circle" } }]);
  expect(marks(p)).toEqual([]);
  expect(p.steps.some((s: any) => s.kind === "point")).toBe(true);
});
test("the next light on the same picture glides from the last box, across a camera move", () => {
  const p = plan([{ draw: ["md"] }, { highlight: { target: "md:left" } }, { camera: { on: ["md:right"] } }, { highlight: { target: "md:right" } }]);
  const [a, b] = marks(p);
  expect(a.continues).toBe(true);
  expect(b.from).toEqual({ x: 100, y: 300, w: 200, h: 200 });
});
test("lift, a different kind, or hiding the picture breaks the glide", () => {
  const lifted = marks(plan([{ draw: ["md"] }, { highlight: { target: "md:left" } }, { highlight: { target: "md:right", lift: true } }]));
  expect(lifted[0].continues).toBeFalsy();
  expect(lifted[1].from).toBeUndefined();
  const kinds = marks(plan([{ draw: ["md"] }, { highlight: { target: "md:left" } }, { point: { at: { ref: "md:right" } } }]));
  expect(kinds[1].from).toBeUndefined();
  const hidden = marks(plan([{ draw: ["md"] }, { highlight: { target: "md:left" } }, { hide: ["md"] }, { show: ["md"] }, { highlight: { target: "md:right" } }]));
  expect(hidden[1].from).toBeUndefined();
});
test("plain ids are untouched", () => {
  const p = plan([{ draw: ["md", "t"] }, { highlight: { target: "t" } }]);
  expect(marks(p)).toEqual([]);
  expect(p.steps.find((s: any) => s.kind === "highlight")).toMatchObject({ ids: ["t"], effect: "glow" });
});
```

Update `tests/picture-plan.test.ts`: assertions that expected a `highlight` step with effect `box` on places, `spots` on focus, or a `point` step on a place now expect the corresponding `mark` step (same boxes). Keep the moved/scaled/rotated-picture, missing-region, not-visible and mixed-target tests — adapt them to read the mark's stop box.

- [ ] **Step 2: Run** `npx vitest run tests/picture-marks-plan.test.ts tests/picture-plan.test.ts` → FAIL.
- [ ] **Step 3: Implement** the types, schema and planner rules above. Keep `placeNow` as the single place-resolver.
- [ ] **Step 4: Run** the two files plus `tests/plan.test.ts tests/focus-zoom.test.ts tests/picture-schema.test.ts` → PASS. The full suite may fail in player/backend picture tests that Task 3 rewrites and in `prompt-size` (Task 4); list them in the report, fix nothing there.
- [ ] **Step 5: Commit** "Plan: gestures on picture places become one mark per picture — light by default, arrow/glow for pointing, ring/box on request — with stops through a sentence and glides across steps".

---

### Task 2: The frame curve and the drawing

**Files:** `src/render/marks.ts` (the pure curve + arrow geometry), `src/render/backend.ts`, `src/render/svg-backend.ts`; tests `tests/picture-marks-frame.test.ts`, `tests/picture-marks-backend.test.ts`; remove the delivery-1 spotlight tests from `tests/picture-backend.test.ts` (the box-effect test for plain ids stays).

**Interfaces — Produces:**

```ts
// src/render/marks.ts
export interface MarkFrame {
  kind: MarkKind; frame: BBox; box: BBox;
  level: number;   // 0..1 how present (ease-in / release)
  write: number;   // 0..1 how much of a drawn mark (arrow, ring, box) is written
  depth: number;   // light only: wash alpha before level
  breathe: number; // glow only: scale factor
}
export const MARK_IN_MS = 450, MARK_GLIDE_MS = 550, MARK_RELEASE_MS = 280;
/** The mark at `ms` into its step of total `durMs`. Pure. */
export function markFrameAt(step: { mark: MarkKind; frame: BBox; stops: MarkStop[]; from?: BBox }, ms: number, durMs: number): MarkFrame;
/** The release at `ms` into it (level falls 1 → 0), at the step's last box. */
export function markReleaseAt(step: …, ms: number): MarkFrame;
/** Where an arrow's tip and tail go for a target box: tip just outside the box, tail 70 units away toward the side of the frame with more room (default up-right). */
export function arrowGeometry(box: BBox, frame: BBox): { tip: Pt; tail: Pt };
// backend.ts
setMark?(owner: string, f: MarkFrame): void;
endMark?(owner: string): void;
```

`markFrameAt` rules: with `from`, the mark starts at level 1, write 1 at `from` and glides to stop 0 over `MARK_GLIDE_MS` (ease-in-out); without `from` it appears at stop 0 with level and write rising over `MARK_IN_MS`. Stop i (i ≥ 1) begins at `stops[i].at × durMs` and glides from stop i−1 over `min(MARK_GLIDE_MS, the gap)`. `depth = 0.35 + 0.27 × min(1, ms / durMs)`. `breathe = 1 + 0.08 × sin(2π ms / 1600)`. Box interpolation: linear on x, y, w, h with the ease.

SVG drawing (one `<g data-mark=owner>` on the overlay per owner, created on first `setMark`, updated in place every frame — never rebuilt per frame):
- `light`: a `<mask>` (unique id, e.g. from the backend's mask sequence) with a white rect = frame and a black ellipse at the box, blurred with an `feGaussianBlur` filter (stdDeviation = max(8, 0.18 × min(box.w, box.h))), ellipse radii = box half-sizes × 1.25 + 10; a rect over the frame filled `FIGURE_GROUND`, `fill-opacity = depth × level`, masked. Update only attributes per frame.
- `ring`: rough ellipse built ONCE (two passes like `ellipseRingPath`, `HIGHLIGHT_COLOR`) for a unit box, then placed by a transform (translate + scale) to the current box padded by 8; write-on by `strokeDashoffset` from `write`; opacity = level.
- `box`: `boxMarkPath` built once, placed by transform like the ring.
- `arrow`: rough curve + head built once in local coords (tip at 0,0, tail at `(70, -55)` in SVG y-down), two strokes (ink 5, `#fff3c4` 2.2); per frame a transform from `arrowGeometry` (translate to tip, rotate to the tail's angle); write-on by dashoffset from tail to tip; opacity = level.
- `glow`: a circle filled with a radial gradient (unique id), r = clamp(0.6 × min(w,h), 18, 40) × breathe at the box centre, opacity = level.
- `endMark(owner)` removes the group and its defs.

Remove `setSpotlight`/`endSpotlight` (backend.ts, svg-backend.ts) — marks replace them.

- [ ] **Step 1: Failing tests** — `tests/picture-marks-frame.test.ts` (pure): no `from` → at 0 ms level 0, at 450 ms level 1 at stop 0's box; with `from` → at 0 ms box = from and level 1, at 550 ms box = stop 0; three stops over 3000 ms → at 1000 ms box = stop 0's box, at 1275 ms halfway between stop 0 and 1 (ease-in-out at 0.5 = 0.5), at 1550 ms = stop 1; depth 0.35 at 0 and 0.62 at the end; `markReleaseAt(step, 280).level === 0`; `arrowGeometry` of a box in the top-right corner of the frame puts the tail on the left or below (inside the frame). `tests/picture-marks-backend.test.ts` (mini-dom, mount as in `tests/picture-backend.test.ts`): `setMark("md", light frame)` creates one group with a mask and a rect whose `fill-opacity` = depth × level; a second `setMark` with another box updates the same nodes (child count unchanged, ellipse cx changed); `ring` and `arrow` groups carry a `transform` that changes when the box changes; `glow` circle r scales with `breathe`; `endMark` removes the group and the mask.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** the new files + `tests/highlight-emphasis.test.ts tests/picture-backend.test.ts` → PASS.
- [ ] **Step 5: Commit** "Marks: the animation curve (ease in, glide between stops, deepening light, breathing glow) and the SVG marks — soft paper light, hand-drawn arrow, glow, ring, box — updated in place every frame".

---

### Task 3: Playing marks, frames parity, clean-up

**Files:** `src/render/player.ts`, `src/dev/frames.ts`; tests `tests/picture-marks-player.test.ts`; update/remove `tests/picture-player.test.ts` cases for per-place boxes and spots.

**Player `case "mark"`:** duration `durMs` = the narration's remaining length when `untilNarrationEnd` (follow how the highlight case waits on `this.narrationVoice` — sample `markFrameAt` with the elapsed time and an estimated duration: use the step's `seconds × 1000` as the minimum and keep painting the last stop until the voice ends), else `seconds × 1000`. Paint `effects.setMark(owner, markFrameAt(step, t, durMs))` every frame via the existing `progress`/raf helpers. At the end: if `step.continues`, leave the mark as it is (the next mark step takes it over); else animate `markReleaseAt` over `MARK_RELEASE_MS` then `endMark(owner)`. In a `finally`, if aborted, `endMark(owner)`. On every reset path that calls `setPointer(null)` (around player.ts:662 and seek/stop), also end every mark painted so far (keep a `Set<string>` of owners with a live mark).

Seek-safety: when playback starts at a mark step whose `from` was set but the previous mark step did not play (seek landed here), start as if there were no `from` (ease in at stop 0). Track "the owner's mark is live" in the Set to decide.

Remove the delivery-1 per-place box painting in the highlight case and the `spots` handling in the focus case (the planner no longer emits them).

**frames.ts:** `case "mark"`: paint `setMark(owner, markFrameAt(step, durMs, durMs))` with `durMs = step.seconds × 1000` (the end state, write 1, level 1, last stop, full depth). Remove the per-place box grouping and `spots` code added in delivery 1.

- [ ] **Step 1: Failing tests** — `tests/picture-marks-player.test.ts` with a stub backend recording `setMark`/`endMark` calls and the Player harness of `tests/picture-backend.test.ts`: (a) one highlight on a place → `setMark` called with rising level, final frames at the region's box, then `endMark("md")`; (b) two consecutive highlights on the same picture → no `endMark` between them, the second step's first frame box equals the first step's box, and exactly one `endMark` at the very end; (c) three stops in one highlight → the recorded boxes visit all three in order; (d) aborting the player mid-mark (`player.stop()` or the harness's abort) → `endMark` called.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** the new file + `tests/picture-player.test.ts tests/focus-zoom.test.ts tests/player*.test.ts` → PASS; then the full suite: only `prompt-size` may fail (Task 4).
- [ ] **Step 5: Commit** "Player: marks ease in, glide from spot to spot and between steps, release only when nothing continues them; the frames sheet shows each mark's end state; delivery 1's spotlight and per-place boxes removed".

---

### Task 4: Teach it, show it, check it

**Files:** `src/llm/prompts/compiler-v1.md`, `tests/prompt-size.test.ts`, `docs/examples/2026-09-30-picture-regions-microdata.yaml`, `docs/examples/2026-09-30-picture-regions-arnolfini.yaml`.

- [ ] **Step 1: Prompt** — in the verb bullets, replace delivery 1's place clauses: highlight — "on a picture place a soft light (the default; `ring`/`box` on request); several places in one highlight are stops it travels through"; point — "on a picture `{"ref": "shot:search"}` draws a hand-drawn arrow (`gesture: glow` for a glow)"; one clause in the highlight bullet: "the next gesture on the same picture glides there from the last; `lift: true` starts fresh". Re-pin both prompt-size constants to the measured sizes with a dated note.
- [ ] **Step 2: Examples** — microdata: drop `gesture: underline` on the two points (they become arrows); make the toolbar walk ONE highlight with the six buttons as stops over one sentence ("The script window, help, the support chat, export, whether your changes are saved, and settings.") instead of six sentences; keep the rest. Arnolfini: drop `gesture: circle` on the candle (→ arrow) — keep one `gesture: glow` point somewhere (the dog), the man/woman highlight becomes two stops; keep the mirror focus. Both must still pass `tests/picture-example.test.ts`.
- [ ] **Step 3:** full suite green, `npx tsc --noEmit -p .` clean.
- [ ] **Step 4: Commit** "Prompt and examples: soft light, arrows and glides on pictures; prompt re-pinned".
- [ ] **Step 5 (controller):** render both examples on the frames page and play one in the app (muted); judge the look; adjust constants in `src/render/marks.ts` if something reads wrong.
