# Guess and Reveal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The viewer guesses a number on the figure (bar, line, pie, crowd, scale), then the figure animates from the guess to the truth with the gap shown, and the LLM can ask such guesses under `#interactive`.

**Architecture:** One pure module (`src/guess/`) resolves *guess handles* from the spec and its layout (a handle = one number the viewer sets, with a param path or an element patch, its bounds and a pointer→value map). The guess is an override painted through the player's existing `previewSpec`; the reveal is a tween of those overrides from guess to truth (the `animate` pattern), followed by the plan's honest state. `ask` gains `on`; its gate (`src/ui/guess-gate.ts`) owns the pointer, keys and Answer/Skip; the player scores, stores `{g.*}` vars and draws a ghost + gap mark through a new effects primitive.

**Tech Stack:** TypeScript, Vitest, the SVG backend, data pack templates (YAML + JS layout strings).

**Spec:** `docs/superpowers/specs/2026-10-01-guess-and-reveal-design.md`

## Spec amendments found while planning (recorded in the spec's §13 at the end)

- A cast has ONE template, so there is no figure id: `on` names a part (`bar_3`, `line_1`, `slice_2`), a list of parts, or `"all"` (every guessable part of the template). A population state is its set id (`crowd_sick`); a scale is its element id.
- The icon array is the existing `population` element (no new template).
- `scale` is sugar (`src/spec/scale.ts`) expanding into ordinary elements: a group `<id>` (line, ticks, end labels) and a point `<id>_value` (the true marker and its label). Truth = the scale's `value`.
- Bar charts: one series (`values`), static or staged (the current stage). Grouped/stacked bars are not guessable in this round (lint says so).
- The chart's y range is pinned to the true chart's frame while guessing and revealing, so the axis never jumps.
- Line charts take `ask.from` (an x value; default the middle x): before it the line is given, after it the viewer sketches.

## Global Constraints

- Movies/embeds never wait; an `on` ask demonstrates its `default` (or the start state) with the laser, then reveals.
- Interactions on the figure, never in the tray (memory rule). The Test-me chip sits on the figure.
- Short canvas text: value labels a number and unit only.
- Run browser checks muted (narration AND tones).
- `#interactive` gets its own tag group (`engagement`); `#lively` its own (`motion`) — the `interaction` group is exclusive.

## Review Focus

1. A guess on a part that is already drawn shows the answer → lint error, plan still works (the gate hides nothing; it just previews).
2. Viewer skips → counts as a miss, reveal still plays from the start state, `{g}` = default/start.
3. Scrub/seek during a guess or reveal → gate aborts, preview settles, ghost marks are removed.
4. Values that are not data yet (`{code.var}` token unresolved) → no handles; the ask falls back to the typed card with a warning.
5. Keyboard-only viewer → Tab/arrow keys move the focused handle, Enter answers.

---

### Task 1: Schema, types, plan step for `ask.on`

**Files:** Modify `src/spec/types.ts` (AskArgs: `on?: string | string[]`, `from?: number`, tolerance union `number | { rel: number }`), `src/spec/schema.ts` (ask properties + descriptions), `src/render/plan.ts` (ask step carries `on: string[]`, `from`, `toleranceRel`; asked parts made visible after the step; `fallback` from `default`), `src/ui/controls.ts` (AskGateStep: `on?`, `from?`).
**Test:** `tests/guess-plan.test.ts` — an ask with `on: "bar_2"` yields a plan step with `on: ["bar_2"]`, and `bar_2` is visible in the state after it.

### Task 2: Guess model — handles, mapping, scoring (pure)

**Files:** Create `src/guess/handles.ts`, `src/guess/score.ts`, `src/guess/index.ts`.
**Interfaces (produced):**
```ts
export type GuessKind = "height" | "curve" | "angle" | "count" | "point";
export interface GuessHandle {
  part: string;                 // drawable id the gesture grabs / the ghost outlines
  kind: GuessKind;
  truth: number[];              // one number (height/angle/count/point) or the sketched points (curve)
  min: number; max: number;     // domain bounds
  /** Param override path(s) (template params / vars.x) — one per truth entry. */
  paths?: string[];
  /** Or an element patch: id + field path inside the element. */
  element?: { id: string; field: string };
  /** curve: x positions of truth entries, and the index the sketch starts at. */
  xs?: number[]; fromIndex?: number;
  /** Map a logical pointer to a value (or, for curve, to [index, value]). */
  label: string;                // "Norway", "Sick", "Mozart" — for keyboard focus / aria
  format: (v: number) => string;
}
export interface GuessSetup { handles: GuessHandle[]; pin: Record<string, unknown>; warnings: string[] }
export function guessSetup(spec: Spec, layout: LayoutResult, on: string[], opts: { from?: number }): GuessSetup;
export function startValues(h: GuessHandle): number[];
export function valueAt(h: GuessHandle, p: Pt, layout: LayoutResult, current: number[]): number[]; // pointer → new values
export function patchFor(handles: GuessHandle[], values: number[][]): { params: Record<string, unknown>; elements: SpecElement[] };
export function encodeGuess(values: number[][]): string; export function decodeGuess(s: string, handles: GuessHandle[]): number[][] | null;
// score.ts
export interface GuessScore { ok: boolean; err: number; off: number; pct: number; within: number; count: number }
export function scoreGuess(handles: GuessHandle[], values: number[][], tol: { abs?: number; rel?: number }): GuessScore;
export function guessVars(store: string, handles: GuessHandle[], values: number[][], s: GuessScore): Record<string, string>;
```
Templates handled: `bar_chart` (height), `line_chart` (curve), `pie_chart` (angle), population state sets (count), scale (point).
**Tests:** `tests/guess-handles.test.ts`, `tests/guess-score.test.ts` — handles per template, pointer mapping through the frame, patches, scoring (abs, rel, whole chart, curve averaging), vars formatting, encode/decode round trip.

### Task 3: `scale` sugar element

**Files:** Create `src/spec/scale.ts` (expandScale), modify `src/spec/expand.ts`, `src/spec/types.ts` (`"scale"` type + `min`,`max`,`value`,`scale_kind`,`unit`,`ticks`,`at`/`box`), `src/spec/schema.ts`.
**Test:** `tests/scale-sugar.test.ts` — expansion yields `<id>` group + `<id>_value`; log and year kinds place ticks correctly; value position maps exactly.

### Task 4: `pie_chart` template

**Files:** Modify `src/scenes/packs/data.yaml` (new template: labels, values, staged values + `stage`, `value_labels` as percents, `title`, `box`; parts `slice_i`, `legend`, `title`; frame-free).
**Test:** `tests/pie-chart.test.ts` — layout has slice ids, staged interpolation, angles sum to 360°.

### Task 5: Effects primitive for the ghost and gap

**Files:** `src/render/backend.ts` (`setGuessMarks?(owner: string, marks: GuessMarks | null)`), `src/render/svg-backend.ts` (draw dashed polylines, gap brackets, labels in the overlay), `src/guess/marks.ts` (pure: build GuessMarks from handles + guess + truth + layout).
**Test:** `tests/guess-marks.test.ts` — bar gap bracket spans guess→truth tops; curve band; pie arc; scale bracket.

### Task 6: Player — guess ask path

**Files:** `src/render/player.ts` (case "ask" with `step.on`: resolve setup from the committed layout; gate or auto; reveal tween via previewSpec; commit; ghost marks; store vars; score; feedback; goto), clean guess marks on scrub/dispose/clear.
**Test:** `tests/guess-player.test.ts` — with a fake gate resolving an encoded guess: vars `{g}`, `{g.true}`, `{g.off}`, `{g.ok}` set; outcome recorded; skip → miss; auto mode uses default.

### Task 7: The guess gate (DOM)

**Files:** Create `src/ui/guess-gate.ts`, modify `src/ui/controls.ts` (route `step.on` first), `src/styles.css`.
Behaviour: overlay over the stage; pointerdown/move on the figure sets the nearest handle; live preview via `hd.timeline.previewSpec`; value label pill follows; Answer / Skip pills; Tab/arrow/Enter keys; typed entry on double-click of the value pill.
**Test:** `tests/guess-gate.test.ts` (jsdom) — Answer resolves the encoded guess; Skip resolves null; abort resolves null and settles the preview.

### Task 8: Lint / validation

**Files:** `src/lint/lint.ts` (or the ask checks wherever they live): `on` must resolve to handles; asked part not drawn before the ask; no `answer`/`widget`/`items` with `on`; grouped/stacked bar charts refused.
**Test:** `tests/guess-lint.test.ts`.

### Task 9: Test me chip

**Files:** Create `src/ui/test-me.ts`, wire in `src/ui/controls.ts`; uses guessSetup with `on: ["all"]` on a paused/ended figure whose template is guessable; same gate; reveal with marks; nothing recorded.
**Test:** `tests/test-me.test.ts` — chip appears only for guessable charts with every guessable part drawn.

### Task 10: Tags, prompts, rule card, examples

**Files:** `src/llm/tags.ts` (`interactive` group engagement; `lively` group motion), `src/llm/prompts/compiler-v1.md`, `.claude/skills/drawcast/references/rule-card.md`, `src/examples.json` (4 example casts: health spending bars, screening crowd, top-1 % pie, Mozart scale; one line chart sketch), spec §13 amendments.
**Test:** `tests/tags.test.ts` additions — `#interactive #quiz` keeps both briefs.

### Task 11: Browser verification (muted) and full test run.
