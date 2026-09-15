# Animated Box Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make "present the model large, then shrink it and add the knobs" a first-class pattern: `box` animates by name, the lint judges the panel at the beat it is drawn, and the bundled SIR cast shows the pattern with sliders instead of code.

**Architecture:** Nothing new in the layout: `layoutSpec` already re-fits per frame and `withOverrides` already walks `box.x`-style paths (verified 2026-09-15 with a scratch cast: fit 1.16 → 0.86 → 0.55 across an animate, zero lint issues at the end frame). Three gaps remain. (1) A region NAME cannot be a tween endpoint or a tween base, so `readParam`/`withOverrides` learn that a fit name stands for its rectangle and the planner expands `animate: {box: "right"}` into the four numeric keys. (2) The overlap lints judge the START layout, where a panel drawn only after the animate still overlaps the full-size figure; `layoutSpec` now lints the code panel's pairs on the layout at the beat the panel is first drawn. (3) The `code-use` lint about long scripts under the output ignores `pane: "controls"`. Then the prompt learns the pattern and the SIR example becomes the animated version.

**Tech Stack:** TypeScript, Vitest (`npx vitest run <file>`), `npm test` + `npm run build` (tsc) before push.

**Spec:** `docs/2026-09-15-template-box-spec.md` (the box), plus the verified scratch run described above. No separate spec; this plan is the design record. Add a "§12 Animated box (2026-09-15)" section to that spec in Task 3.

## Global Constraints

- Worktree `.claude/worktrees/template-box`; create branch `worktree-box-animate` from the current HEAD (80f808c = origin/main). Never edit `src/ui/controls.ts`, `src/ui/widget-host.ts`, `src/render/sweep.ts`.
- Region names are `FIT_NAMES` from `src/layout/regions.ts` (left, right, top, bottom, full), resolved by `fitRegion`; `isFitName` is the predicate. Regions: left `{60,95,420,560}`, right `{520,95,420,560}`, top `{60,395,880,260}`, bottom `{60,95,880,260}`, full `{60,95,880,560}`.
- The compiler learns names only: the prompt sentence uses `"box": "full"` then `{"animate": {"box": "right"}}`, never a rectangle.
- A spec without any animate on `box` and without a code element drawn after an animate must lint exactly as today (examples gate `tests/examples.test.ts` and full suite prove it; 7905 tests at HEAD).
- Prompt-size pins in `tests/prompt-size.test.ts` are re-measured, never summed, in the same commit as the prompt text (Hans's rule).
- Commit style: a plain sentence saying what and why, ending with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

---

### Task 1: `box` animates by name

**Files:**
- Modify: `src/render/params.ts` (`readParam` line ~15, `withOverrides` line ~34)
- Modify: `src/render/plan.ts` (the `animate` branch, line ~1704–1760)
- Test: `tests/box-animate.test.ts` (new)

**Interfaces:**
- Produces: `export function expandBoxAnimate(animate: Record<string, unknown>): Record<string, unknown>` in `src/render/params.ts` — a copy of `animate` where a `box: "<name>"` entry is replaced by `box.x`, `box.y`, `box.w`, `box.h` of that region; anything else untouched. Used by `plan.ts` here and by `layout.ts` in Task 2.
- `readParam(params, "box.x")` returns 60 when `params.box === "full"`; `withOverrides({box: "full"}, {"box.x": 520})` returns `{box: {x: 520, y: 95, w: 880, h: 560}}`.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/box-animate.test.ts
import { beforeAll, describe, expect, test } from "vitest";
import { expandBoxAnimate, readParam, withOverrides } from "../src/render/params";
import { layoutSpec, elementBBoxes, domainMapping } from "../src/layout/layout";
import { planCommands } from "../src/render/plan";
import { planOptionsFor } from "../src/render/index";
import { fitRegion } from "../src/layout/regions";
import { ensureEnabledPacks } from "../src/scenes/packs";
import type { Spec } from "../src/spec/types";

beforeAll(async () => { await ensureEnabledPacks(["evidence"]); });

describe("a region name stands for its rectangle in param paths", () => {
  test("readParam reads through a fit name", () => {
    expect(readParam({ box: "full" }, "box.x")).toBe(60);
    expect(readParam({ box: "right" }, "box.w")).toBe(420);
    expect(readParam({ box: "middle" }, "box.x")).toBeNull();
    expect(readParam({ box: { x: 1, y: 2, w: 3, h: 4 } }, "box.h")).toBe(4);
  });
  test("withOverrides replaces a fit name by its rectangle before writing into it", () => {
    expect(withOverrides({ box: "full" }, { "box.x": 520, "box.w": 420 })).toEqual({ box: { x: 520, y: 95, w: 420, h: 560 } });
    // untouched when the path does not continue into the box
    expect(withOverrides({ box: "full" }, { other: 1 })).toEqual({ box: "full", other: 1 });
  });
  test("expandBoxAnimate turns a name into four numeric keys and leaves the rest", () => {
    expect(expandBoxAnimate({ box: "right", stage: 1 })).toEqual({ "box.x": 520, "box.y": 95, "box.w": 420, "box.h": 560, stage: 1 });
    expect(expandBoxAnimate({ box: "nowhere" })).toEqual({ box: "nowhere" });
    expect(expandBoxAnimate({ "box.x": 5 })).toEqual({ "box.x": 5 });
  });
});

const cast = (animate: Record<string, unknown>): Spec =>
  ({
    template: "sir_compartments",
    params: { box: "full" },
    commands: [{ draw: ["box_s"] }, { animate, duration: 2 }],
  }) as unknown as Spec;

describe("animate: {box: name} in the planner", () => {
  const plan = (spec: Spec) => {
    const layout = layoutSpec(spec);
    const bboxes = elementBBoxes(layout);
    return planCommands(spec.commands!, layout.order, {
      bboxOf: (id) => bboxes.get(id) ?? null,
      windows: layout.windows ?? {},
      ...domainMapping(spec.domain, layout.fit),
      animateBase: spec.params ?? {},
      ...planOptionsFor(spec, layout),
    } as never);
  };
  test("targets are the region's numbers and the starts are the base region's — no jump warning", () => {
    const p = plan(cast({ box: "right" }));
    const step = p.steps.find((s) => s.kind === "animate") as { targets: Record<string, number>; starts: Record<string, number | null> };
    expect(step.targets).toEqual({ "box.x": 520, "box.y": 95, "box.w": 420, "box.h": 560 });
    expect(step.starts).toEqual({ "box.x": 60, "box.y": 95, "box.w": 880, "box.h": 560 });
    expect(p.warnings).toEqual([]);
  });
  test("the layout at the animate's end is the right-half fit", () => {
    const spec = cast({ box: "right" });
    const end = layoutSpec({ ...spec, params: withOverrides(spec.params, expandBoxAnimate({ box: "right" })) });
    expect(end.fit!.box).toEqual(fitRegion("right"));
  });
  test("a non-name box target is dropped with a warning, as any non-number is", () => {
    const p = plan(cast({ box: "nowhere" }));
    expect(p.warnings.some((w) => /animate "box"/.test(w))).toBe(true);
  });
});
```
Check the planner's step shape first: `grep -n 'kind: "animate"' src/render/plan.ts` (line ~113 shows `targets`, `starts`); adjust the cast in the test to the real type if the field names differ, and adjust `p.steps` to the plan's actual array name (Task 3 of the template-box round used the same call — see `tests/template-box.test.ts` "the planner's domain mapping composes the fit" for the working shape).

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/box-animate.test.ts`
Expected: FAIL — `expandBoxAnimate` is not exported; `readParam({box: "full"}, "box.x")` is null; `withOverrides` drops the override (its walk stops at a string).

- [ ] **Step 3: `params.ts`**

Import `fitRegion, isFitName` from `"../layout/regions"`. In `readParam`, inside the loop, before the `isRecord(cur)` check, add: `if (isFitName(cur)) cur = fitRegion(cur);` — but only when there is a following segment; simplest: at the top of each iteration `if (isFitName(cur)) cur = fitRegion(cur);` (a bare name is never numeric anyway, so the final check still returns null for `readParam({box: "full"}, "box")`). In `withOverrides`, in the segment walk where `existing` is examined: add a branch `else if (isFitName(existing)) next = fitRegion(existing);` before the `else { ok = false; break; }`. Add:

```ts
/** `animate: {box: "right"}` → the region's four numbers; anything else is
 *  copied as written (the planner then judges it as it always has). */
export function expandBoxAnimate(animate: Record<string, unknown>): Record<string, unknown> {
  const v = animate["box"];
  if (!isFitName(v)) return { ...animate };
  const { box: _box, ...rest } = animate;
  const r = fitRegion(v);
  return { ...rest, "box.x": r.x, "box.y": r.y, "box.w": r.w, "box.h": r.h };
}
```
Check for an import cycle: `src/layout/regions.ts` imports only `./geometry`; `params.ts` is in `render/`; no cycle.

- [ ] **Step 4: `plan.ts`**

In the `animate` branch, replace `for (const [rawKey, v] of Object.entries(cmd.animate))` with `for (const [rawKey, v] of Object.entries(expandBoxAnimate(cmd.animate)))` (import from `./params`). Nothing else: the starts loop already calls `readParam(opts.animateBase, key)`, which now reads through a name; `layoutFor(params)` in `render/index.ts` calls `withOverrides(spec.params, ...)`, which now writes through a name. A `box: "nowhere"` stays a string and hits the existing "target is not a number (dropped)" warning.

- [ ] **Step 5: Run the tests**

Run: `npx vitest run tests/box-animate.test.ts tests/template-box.test.ts tests/examples.test.ts tests/animate*.test.ts tests/vars*.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/render/params.ts src/render/plan.ts tests/box-animate.test.ts
git commit -m "Animated box: a region name stands for its rectangle in animate paths, so a figure can start full and shrink into a half by name

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: The lint judges the panel at the beat it is drawn; `pane: "controls"` is not a long script

**Files:**
- Modify: `src/layout/layout.ts` (`layoutSpec` signature and its final lint block, lines ~240–258; `codeFigureOverlap` line ~275)
- Modify: `src/lint/lint.ts` (line ~700, the `lines > 12` stacked-layout warn)
- Test: `tests/box-animate.test.ts` (append)

**Interfaces:**
- Consumes: `expandBoxAnimate`, `withOverrides` (Task 1).
- Produces: `export function paramsAtFirstDraw(spec: Spec, elementId: string): Record<string, unknown> | null` in `src/layout/layout.ts` — the params after every `animate` that precedes the first command drawing `elementId` (or an id `${elementId}_…`), or null when no animate precedes it (unchanged behaviour path). `layoutSpec` gains a fifth, optional parameter `opts?: { skipDrawBeatLint?: boolean }` used only by its own nested call.

- [ ] **Step 1: Write the failing tests**

Append to `tests/box-animate.test.ts`:

```ts
const CONTROLS = "import matplotlib.pyplot as plt\nbeta = (0.1, 1.0, 0.05)\ngamma = (0.05, 0.5, 0.05)\nS, I, R = [0.99], [0.01], [0.0]\nfor t in range(160):\n    new = beta * S[-1] * I[-1]\n    rec = gamma * I[-1]\n    S.append(S[-1] - new)\n    I.append(I[-1] + new - rec)\n    R.append(R[-1] + rec)\n_ = plt.plot(S, label=\"S\")\n_ = plt.plot(I, label=\"I\")\n_ = plt.plot(R, label=\"R\")\n_ = plt.legend()";
const SIR_IDS = ["box_s", "box_code_s", "box_name_s", "flow_0", "rate_0", "box_i", "box_code_i", "box_name_i", "flow_1", "rate_1", "box_r", "box_code_r", "box_name_r"];
const knobs = (target: unknown): Spec =>
  ({
    template: "sir_compartments",
    params: { box: "full" },
    elements: [{ id: "sim", type: "code", language: "python", show: "below", pane: "controls", controls: ["beta", "gamma"], code: CONTROLS }],
    commands: [
      { draw: SIR_IDS, speak: "The model, large." },
      { animate: { box: target }, duration: 3, speak: "Now let us make room." },
      { draw: ["sim", "sim_out"], speak: "And the knobs." },
      { explore: { code: "sim" }, speak: "Turn beta." },
    ],
  }) as unknown as Spec;

describe("the lint judges a panel drawn after an animate on the layout of that beat", () => {
  test("full → right, panel drawn after: no overlap issues at all", () => {
    const r = layoutSpec(knobs("right"));
    expect(r.issues.map((i) => `${i.rule}: ${i.message}`)).toEqual([]);
  });
  test("full → a box that still covers the panel's side: overlap-code-figure from the draw-beat layout", () => {
    const r = layoutSpec(knobs({ x: 300, y: 95, w: 640, h: 560 } as never));
    // the animate target here is a rectangle written as box.* keys — expand it the way an author would
    expect(r.issues.some((i) => i.rule === "overlap-code-figure")).toBe(true);
  });
  test("paramsAtFirstDraw folds the animates before the panel's first draw and is null without any", () => {
    expect(paramsAtFirstDraw(knobs("right"), "sim")).toEqual({ box: { x: 520, y: 95, w: 420, h: 560 } });
    const plain = { ...knobs("right"), commands: [{ draw: SIR_IDS }, { draw: ["sim", "sim_out"] }] } as unknown as Spec;
    expect(paramsAtFirstDraw(plain, "sim")).toBeNull();
  });
  test("pane: controls is not a long script under the output", () => {
    const { lintCommands } = require("../src/lint/lint");
    expect(lintCommands(knobs("right")).filter((i: { rule: string }) => i.rule === "code-use")).toEqual([]);
  });
});
```
For the second test, write the rectangle target as `{ animate: { "box.x": 300, "box.w": 640 } }` instead if `expandBoxAnimate` leaves an object `box` alone (it does; only names expand) — the test's intent is a box that still overlaps the left half. Import `paramsAtFirstDraw` and `lintCommands` at the top of the file (no `require`).

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/box-animate.test.ts`
Expected: the first test FAILS with `overlap-code-figure` and two `overlap-label-stroke` issues (the start layout has the full-size model over the panel); `paramsAtFirstDraw` is not exported; the `code-use` warn is present.

- [ ] **Step 3: `lint.ts`**

In the stacked-layout `code-use` check (`(show === "above" || show === "below") && el.lines === undefined && lines > 12`), add `&& el.pane !== "controls"` and extend the comment: a controls pane draws knobs, not lines.

- [ ] **Step 4: `layout.ts`**

Add, near `codeFigureOverlap`:

```ts
/**
 * The params in force when `elementId` is first drawn: every `animate`
 * before that beat, folded. Null when nothing animates before it — the
 * layout at the base params is then the layout at that beat too. The lint
 * uses this for a code panel that arrives after the figure has moved (a
 * template that starts full and shrinks into a half to make room), so it
 * judges the pair on the ground they actually share.
 */
export function paramsAtFirstDraw(spec: Spec, elementId: string): Record<string, unknown> | null {
  let params = spec.params ?? {};
  let animated = false;
  const owns = (id: string) => id === elementId || id.startsWith(`${elementId}_`);
  for (const cmd of spec.commands ?? []) {
    const drawn = [cmd.draw, cmd.show].flatMap((d) => (d === undefined ? [] : Array.isArray(d) ? d : [d]));
    if (drawn.some(owns)) return animated ? params : null;
    if (cmd.animate) {
      const numeric = Object.fromEntries(Object.entries(expandBoxAnimate(cmd.animate)).filter(([, v]) => typeof v === "number"));
      if (Object.keys(numeric).length > 0) { params = withOverrides(params, numeric); animated = true; }
    }
  }
  return null;
}
```
(`cmd.show` may be typed differently from `cmd.draw`; read `Command` in `src/spec/types.ts` and use only the fields that carry ids.) Import `expandBoxAnimate, withOverrides` from `"../render/params"` — check for a cycle first: `grep -n "^import" src/render/params.ts` must not reach back to `layout/layout.ts`; if it does, move `expandBoxAnimate`+`withOverrides` usage behind a tiny local fold and say so in the report.

Give `layoutSpec` an optional last parameter `opts: { skipDrawBeatLint?: boolean } = {}`. Replace the final lint block's two lines
```ts
  issues.push(...lintLayout(drawables, measure, spec.commands, (id) => pieceGroups[id] ?? groups[id], composed));
  if (codeEl) issues.push(...codeFigureOverlap(codeEl.id, templateIds, drawables, measure, spec));
```
with:
```ts
  const layoutIssues = lintLayout(drawables, measure, spec.commands, (id) => pieceGroups[id] ?? groups[id], composed);
  const atDraw = codeEl && !opts.skipDrawBeatLint ? paramsAtFirstDraw(rawSpec, codeEl.id) : null;
  if (!codeEl || atDraw === null) {
    issues.push(...layoutIssues);
    if (codeEl) issues.push(...codeFigureOverlap(codeEl.id, templateIds, drawables, measure, spec));
  } else {
    // The panel arrives after the figure has moved: its pairs are judged on
    // the layout of THAT beat, everything else on the base layout as before.
    const ownsCode = (id: string) => id === codeEl.id || id.startsWith(`${codeEl.id}_`);
    issues.push(...layoutIssues.filter((i) => !i.ids.some(ownsCode)));
    const later = layoutSpec({ ...rawSpec, params: atDraw }, measure, overrides, labelPinsIn, { skipDrawBeatLint: true });
    issues.push(...later.issues.filter((i) => i.ids.some(ownsCode)));
  }
```
`later.issues` already contains `codeFigureOverlap` for that layout (the nested call takes the first branch). Use `rawSpec` (the un-normalized input) for the nested call so normalization runs once per layout; `spec` is the normalized clone.

- [ ] **Step 5: Run the tests**

Run: `npx vitest run tests/box-animate.test.ts tests/template-box.test.ts tests/figure-split.test.ts tests/examples.test.ts tests/lint*.test.ts`
Expected: PASS. Then `npm test` and `npx tsc --noEmit -p .`: green.

- [ ] **Step 6: Commit**

```bash
git add src/layout/layout.ts src/lint/lint.ts tests/box-animate.test.ts
git commit -m "Animated box: a code panel drawn after an animate is linted on the layout of that beat, and a controls pane is not a long script

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: The prompt learns the pattern; the SIR cast becomes the animated one; spec §12

**Files:**
- Modify: `src/llm/prompts/compiler-v1.md` (list item 1, right after the `"box": "right"` sentence added in the template-box round)
- Modify: `src/examples.json` (entry index 259, the SIR cast — replace in place)
- Modify: `tests/prompt-size.test.ts` (pins + one assertion in the "template box in the prompt" describe)
- Modify: `docs/2026-09-15-template-box-spec.md` (append §12)
- Test: `tests/examples.test.ts`, `tests/examples-style.test.ts` (existing gates)

- [ ] **Step 1: Failing test**

In `tests/prompt-size.test.ts`, inside the "template box in the prompt" describe, add:
```ts
  test("the compiler learns the present-then-shrink pattern by names", () => {
    expect(system(false)).toContain('{"animate": {"box": "right"}');
  });
```
Run: `npx vitest run tests/prompt-size.test.ts` — expected: that test FAILS.

- [ ] **Step 2: Prompt**

In `compiler-v1.md` list item 1, directly after `never compute a rectangle for it.`, append one sentence:
```
 To PRESENT a model large and only then make room for its knobs, start with `"box": "full"`, and when the story turns to the numbers write `{"animate": {"box": "right"}, "duration": 3, "speak": "…"}` — the figure shrinks into its half while the sentence lands — then draw the code element (`"pane": "controls"`) on the next beat.
```
Re-measure the pins: set both baselines to 0, run the size test, copy the two actual lengths back, add a dated line to the re-pin comment ("2026-09-15 animated-box round: one sentence in compiler-v1.md, +N on the system prompt; schema untouched").

- [ ] **Step 3: The example**

Replace entry 259 of `src/examples.json` (request starts "Step through the SIR model") with:

```json
{
  "request": "Show the SIR model large, then shrink it aside and add sliders for beta and gamma that re-run the epidemic curve.",
  "packs": ["evidence"],
  "spec": {
    "title": "SIR, then the knobs",
    "template": "sir_compartments",
    "params": { "box": "full" },
    "elements": [
      {
        "id": "sim",
        "type": "code",
        "language": "python",
        "show": "below",
        "pane": "controls",
        "controls": ["beta", "gamma"],
        "chart": "seaborn",
        "code": "import matplotlib.pyplot as plt\nbeta = (0.1, 1.0, 0.05)\ngamma = (0.05, 0.5, 0.05)\nS, I, R = [0.99], [0.01], [0.0]\nfor t in range(160):\n    new = beta * S[-1] * I[-1]\n    rec = gamma * I[-1]\n    S.append(S[-1] - new)\n    I.append(I[-1] + new - rec)\n    R.append(R[-1] + rec)\n_ = plt.plot(S, label=\"S\")\n_ = plt.plot(I, label=\"I\")\n_ = plt.plot(R, label=\"R\")\n_ = plt.legend()"
      }
    ],
    "commands": [
      { "draw": ["box_s", "box_code_s", "box_name_s"], "speak": "Everyone starts susceptible." },
      { "draw": ["flow_0", "rate_0", "box_i", "box_code_i", "box_name_i"], "speak": "Contact with an infectious person moves you across, at a rate beta times how many are infectious." },
      { "draw": ["flow_1", "rate_1", "box_r", "box_code_r", "box_name_r"], "speak": "And recovery moves you on, at a rate gamma." },
      { "animate": { "box": "right" }, "duration": 3, "speak": "Two rates decide the whole epidemic. Let us make room to turn them." },
      { "draw": ["sim", "sim_out"], "speak": "The same model as a curve: susceptible falls, infectious rises and peaks, recovered climbs." },
      { "explore": { "code": "sim" }, "speak": "Slide beta up and watch the peak come sooner and higher; slide gamma up and watch it flatten." }
    ]
  }
}
```
The compartment ids are lower-case as delivered in the template-box round (`box_s`, `box_code_s`, …). Keep the file's 2-space formatting.

- [ ] **Step 4: Spec §12**

Append to `docs/2026-09-15-template-box-spec.md`:
```
## 12. Animated box (2026-09-15, follow-up round)

`box` is a tween target: `params.box: "full"` then `{"animate": {"box": "right"}}` shrinks the fitted figure into its half over the beat (a region name stands for its rectangle in every param path — `render/params.ts`). The lint judges a code panel drawn after such an animate on the layout of the beat it is first drawn (`paramsAtFirstDraw`, `layout/layout.ts`), so "present the model large, then make room for the knobs" carries no false overlap. Known limit: labels of the opening frame are still placed around the not-yet-drawn panel's ink (layout is static); invisible in practice for a panel on the empty side.
```

- [ ] **Step 5: Gates, suite, build**

Run: `npx vitest run tests/examples.test.ts tests/examples-style.test.ts tests/prompt-size.test.ts` then `npm test` and `npm run build`. Expected: all green. If `examples-style` objects to a phrase, adjust minimally and say what. If the gate reports any lint issue on the new example, that is a Task 2 defect — do not loosen the gate; report it.

- [ ] **Step 6: Commit**

```bash
git add src/llm/prompts/compiler-v1.md src/examples.json tests/prompt-size.test.ts docs/2026-09-15-template-box-spec.md
git commit -m "Animated box: the compiler learns present-then-shrink by names, the SIR cast starts large and makes room for beta and gamma sliders, spec §12

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Self-review

- Task 1 covers names as tween endpoints and bases; Task 2 covers the two lint gaps found in the scratch run; Task 3 the prompt, example and record. The four engine items from the assessment map to T1 (sugar), T2 (draw-beat lint, code-use), T3 (prompt). The "labels avoid an invisible panel" item is recorded as a known limit, not fixed (layout is static).
- Types: `expandBoxAnimate` (T1) consumed by T2's `paramsAtFirstDraw`; `paramsAtFirstDraw` exported from layout.ts and tested in T2; `layoutSpec`'s new optional 5th parameter only used internally.
- Merge: origin/main may move; merge before push, re-run suite and build.
