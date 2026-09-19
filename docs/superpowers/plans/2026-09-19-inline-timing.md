# Inline Timing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An action written inside a spoken line starts at that point in the sentence — `Pengene går rundt (@arrow hush -> bedr@) og kommer tilbake.`

**Architecture:** The scanner lifts `(@ … @)` spans out of a speech line and records where each one sat; the parser turns them into ordinary commands carrying a `cue` (0–1 of the way through the line); the printer writes a cued command back inside its line and an uncued one under it, so the two spellings never mean the same thing. The player delays the action by `cue × the line's duration` — and because the video export drives the same `Player` through `render()` (`src/render/index.ts:421`) with a pre-synthesized `BufferSpeech`, one implementation covers the app and the export both.

**Tech Stack:** TypeScript, vitest.

**Spec:** `docs/superpowers/specs/2026-09-19-group-layout-and-inline-timing-design.md`, Part B (§10–§14). Part A shipped 2026-09-19.

## Global Constraints

- **The round-trip gate must stay green** (`tests/script-roundtrip.test.ts`): a cued command prints inline, an uncued one indented, and both read back identically.
- **The deploy gate is `npm test && npm run build`** — vitest does not typecheck.
- **A cast with no inline action must behave exactly as today**, in the player and in the export.
- **A new spec field is taught in the same round**: `compiler-v1.md`, the schema description, and a prompt-size re-pin.
- Work on `round/inline-timing`; merge and push in the last task.

## File Structure

| File | Responsibility |
|---|---|
| `src/spec/script/lines.ts` | lift the spans out of a speech line, with their offsets |
| `src/spec/script/parse.ts` | spans → commands with `cue` |
| `src/spec/script/print.ts` | a cued command goes back inside its line |
| `src/spec/types.ts`, `schema.ts` | the `cue` field |
| `src/render/plan.ts` | carry the cue onto the step |
| `src/render/player.ts` | delay the action by `cue × duration` |
| `tests/inline-timing.test.ts` | **new** |

---

### Task 1: Lifting the spans

**Files:** Modify `src/spec/script/lines.ts`; test `tests/inline-timing.test.ts`.

A `speech` line gains `actions?: { head: string; rest: string; offset: number }[]`, where `offset` is the number of characters of SPOKEN text before the action. The span, plus one space in front of it when there is one, is removed from the spoken text; the printer re-inserts exactly that.

`(@` opens an action only when what follows is a word — otherwise the text is prose and needs no escape. A span that is never closed is a `ScriptError` naming the line.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, test } from "vitest";
import { scanLines } from "../src/spec/script/lines";

const speech = (text: string) => scanLines(text)[0] as { text: string; actions?: { head: string; rest: string; offset: number }[] };

describe("lifting an action out of a line", () => {
  test("the spoken text is the line without the span", () => {
    const l = speech("Pengene går rundt (@arrow a -> b@) og tilbake.\n");
    expect(l.text).toBe("Pengene går rundt og tilbake.");
    expect(l.actions).toEqual([{ head: "arrow", rest: "a -> b", offset: "Pengene går rundt".length }]);
  });

  test("several actions keep their order and their places", () => {
    const l = speech("Først (@draw a@) så (@draw b@) ferdig.\n");
    expect(l.text).toBe("Først så ferdig.");
    expect(l.actions!.map((a) => a.rest)).toEqual(["a", "b"]);
    expect(l.actions![0].offset).toBeLessThan(l.actions![1].offset);
  });

  test("an action at the very start has offset 0", () => {
    const l = speech("(@camera zoom 2@) Se her.\n");
    expect(l.text).toBe("Se her.");
    expect(l.actions![0].offset).toBe(0);
  });

  test("a line with no action is untouched", () => {
    expect(speech("Helt vanlig prosa.\n").actions).toBeUndefined();
  });

  test("a parenthesis followed by an at-sign in prose is prose", () => {
    const l = speech("Skriv (@ hvis du vil) videre.\n");
    expect(l.text).toBe("Skriv (@ hvis du vil) videre.");
    expect(l.actions).toBeUndefined();
  });

  test("an unclosed span names its line", () => {
    expect(() => scanLines("Pengene (@arrow a -> b går rundt.\n")).toThrow(/line 1/);
  });
});
```

- [ ] **Step 2: Run it and watch it fail.**
- [ ] **Step 3: Implement the lift in `scanLines`' speech branch.**
- [ ] **Step 4: Run it and watch it pass.**
- [ ] **Step 5: Commit.**

---

### Task 2: The cue

**Files:** Modify `src/spec/types.ts`, `src/spec/schema.ts`, `src/spec/script/parse.ts`; test `tests/inline-timing.test.ts` (extend).

`Command` gains `cue?: number` — 0–1 of the way through the spoken line. The parser divides the offset by the spoken line's length.

Command order in a beat: **uncued first, then cued in ascending order**, so the printer reproduces it without choosing. The speak rides the beat's first command, as always — and a beat whose only commands are cued carries both `speak` and `cue` on that first command, which reads exactly as it should: the line starts, and part-way through, the thing happens.

- [ ] **Step 1: Write the failing test** — a line with one action parses to one command with `speak` and `cue ≈ 0.5`; two actions give two commands in cue order; an indented direction alongside an inline one comes first and has no cue; `cue` validates in 0–1 and is refused outside it.
- [ ] **Step 2: Run it and watch it fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run it and watch it pass.**
- [ ] **Step 5: Commit.**

---

### Task 3: Printing it back

**Files:** Modify `src/spec/script/print.ts`; test `tests/inline-timing.test.ts` (extend).

A command with a `cue` prints inside its beat's spoken line at `Math.round(cue × text.length)` characters, preceded by a space unless the offset is 0. A command without one prints on its own indented line, as today. The corpus has no cues, so the gate must not move at all.

- [ ] **Step 1: Write the failing test** — print → parse → print is stable for a cued line; an uncued command still prints indented; a cast with both prints the indented one first.
- [ ] **Step 2: Run it and watch it fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run it, plus the round-trip gate.**
- [ ] **Step 5: Commit.**

---

### Task 4: The pause that makes it true

**Files:** Modify `src/render/plan.ts`, `src/render/player.ts`; test `tests/inline-timing.test.ts` (extend).

`plan.ts` carries `cue` onto the step it pushes for a narrated action (beside `narration`). `player.ts`'s `runStep` — the branch at `player.ts:939` that today does `Promise.all([runAction, voice])` — waits `cue × SpeechManager.estimateMs(line)` (scaled by the playback speed, like every other wait) before starting the action, while the voice runs from the top.

The estimate, not a measured duration: it is what the silent path already uses, it needs no speech marks, and it is the one number available identically in the player, in a baked-audio cast and in the export. §12 of the spec says so and why.

- [ ] **Step 1: Write the failing test** — plan a spec with a cued command and assert the step carries the cue; assert an uncued command's step does not.
- [ ] **Step 2: Run it and watch it fail.**
- [ ] **Step 3: Implement in plan.ts and player.ts.**
- [ ] **Step 4: Run the whole suite** — the player's own tests must be untouched.
- [ ] **Step 5: Commit.**

---

### Task 5: Teach it, and three examples

**Files:** `src/llm/prompts/compiler-v1.md`, `tests/prompt-size.test.ts`, `src/examples.json`.

Three bundled examples, because the examples are what the model learns a new field from — and Hans asked for examples. Each should show one thing:

1. **A cue that earns itself**: a figure where the action genuinely belongs mid-sentence ("…and THEN the arrow appears").
2. **A structure drawn step by step**: a `row` whose members are declared in later beats with `in`, so Part A's normal form is in the corpus too.
3. **A branch**: a `column` nested in a `row` with arrows, the shape Hans asked about.

- [ ] **Step 1: Write the prompt bullet for `cue`**, beside the speak rules.
- [ ] **Step 2: Add the three examples and run `tests/examples.test.ts`** — each must validate, lay out and lint clean.
- [ ] **Step 3: Re-pin the prompt budget with the reason.**
- [ ] **Step 4: Run the whole suite.**
- [ ] **Step 5: Commit.**

---

### Task 6: The gate and the push

- [ ] **Step 1: `npx vitest run`.**
- [ ] **Step 2: `npm run build`.**
- [ ] **Step 3: Update the spec's status** — Part B implemented, and the export note: it drives the same Player, so there was one implementation, not two.
- [ ] **Step 4: Merge, push, wait for `ready`.**
- [ ] **Step 5: Report.**

## Self-Review

**Spec coverage:** §10 the form — Tasks 1–3. §11 why it is timing and not a second syntax — enforced by Task 3's rule that only a cued command prints inline. §12 the field and the proportional cue — Tasks 2 and 4. §13 the grammar, including the opener rule and single-line-only — Task 1. §14's exclusions — nothing to build.

**Where the spec was pessimistic:** it named export timing as Part B's main risk, on the assumption that the export schedules its own steps. It does not — `src/export/video.ts` calls `render()`, which builds a `Player`. The cue is honoured in one place. The spec's status line should say so when this lands.

**The remaining risk:** `estimateMs` is an estimate, so with baked audio a cue may land slightly off the word it was written against. That is the accepted trade in §12, and the alternative (SSML timepoints) is its own spec.
