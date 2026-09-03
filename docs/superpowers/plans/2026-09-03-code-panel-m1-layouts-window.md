# Code panel M1 — layouts and the scrolling window: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `show` names where the code sits (`left`, `right`, `above`, `below`, plus `output`, `code`, `none`); `lines` turns the code pane into a window that scrolls as the storyboard steps past it, exactly on scrub, step-back and export.

**Architecture:** Layout positions every source line at its natural row, clips the pane, and publishes each element's window (line ids with their bottom offsets, the window height). The plan recomputes, after every visibility-changing step, the scroll each windowed element needs so its highest visible line is the bottom row, and stores it as per-line offsets in the step's state — the same offsets the move verb uses, so scrub and step-back restore it and the exporter records it. The player tweens offsets that changed between consecutive states at the start of a non-move step. The backend renders a leaf's `clip` as a static wrapper group with a `clipPath`, so the translated line scrolls under a fixed window.

**Tech Stack:** TypeScript, vitest; no runtime changes.

**Spec:** `docs/superpowers/specs/2026-09-03-code-panel-screen-editing-design.md` §2–§4, §8–§9.

## Global Constraints

- Core edits only where §8 lists them: types, schema, lint, `layout/code.ts`, `layout/model.ts` (+ `tier2.ts`/`layout.ts` plumbing of a `windows` map), `render/plan.ts`, `render/player.ts`, `render/svg-backend.ts`, prompt/examples/few-shots. No runtime module changes.
- `split` is retired everywhere (schema, types, lint, prompt, examples, few-shots, tests); no compatibility alias.
- `lines` ≥ 3. Row math uses layout's own constants (`CHAR_W`, `ROW_H`, `LINE_GAP`, `PAD`); nothing measured in the browser.
- Scroll offsets are plan state (per line id, y-up units); a user `move` on a windowed line is overwritten by the scroll (documented).
- `npm test`, `tsc`, both builds green at every commit; commit per task; push at the end.

---

### Task 1: Vocabulary — `show` positions, `lines`, the rename, lint

**Files:**
- Modify: `src/spec/types.ts` (`show` union, `lines?: number`), `src/spec/schema.ts` (`show` enum + description, `lines` property, `need` for lines ≥ 3 integer), `src/lint/lint.ts` (narrow-pane rule for `left`/`right`; new rule: stacked layout with > 12 source lines and no `lines`), `src/llm/prompts/compiler-v1.md` (`"split"` → `"left"`, one sentence on `lines` and the stacked layouts), `src/llm/prompts/fewshots.json`, `src/examples.json` (`"show": "split"` → `"show": "left"`), `tests/code-element.test.ts`, `tests/code-data-bridge.test.ts` (`split` → `left`)
- Test: `tests/code-panel.test.ts` (new)

**Interfaces:**
- `SpecElement.show?: "output" | "left" | "right" | "above" | "below" | "code" | "none"`, `SpecElement.lines?: number`.

- [ ] **Step 1: Failing tests**

```ts
// tests/code-panel.test.ts
import { describe, expect, test } from "vitest";
import { validateSpec } from "../src/spec/schema";
import { lintCommands } from "../src/lint/lint";
import type { Spec } from "../src/spec/types";

const spec = (el: object, commands: object[] = []): Spec =>
  ({ elements: [{ id: "c1", type: "code", language: "python", code: "print(1)", ...el }], commands }) as unknown as Spec;

describe("code panel vocabulary", () => {
  test("show names where the code sits; split is gone", () => {
    for (const s of ["output", "left", "right", "above", "below", "code", "none"]) expect(validateSpec(spec({ show: s })).ok).toBe(true);
    expect(validateSpec(spec({ show: "split" })).ok).toBe(false);
  });
  test("lines is an integer of at least 3", () => {
    expect(validateSpec(spec({ lines: 6 })).ok).toBe(true);
    expect(validateSpec(spec({ lines: 2 })).ok).toBe(false);
    expect(validateSpec(spec({ lines: 4.5 })).ok).toBe(false);
  });
  test("lint: a stacked layout with a long script and no window is called out; a narrow side-by-side too", () => {
    const long = Array.from({ length: 14 }, (_, i) => `x${i} = ${i}`).join("\n");
    expect(lintCommands(spec({ show: "above", code: long })).some((i) => i.rule === "code-use" && /set lines/.test(i.message))).toBe(true);
    expect(lintCommands(spec({ show: "above", code: long, lines: 6 })).some((i) => /set lines/.test(i.message))).toBe(false);
    expect(lintCommands(spec({ show: "right", width: 400 })).some((i) => i.rule === "code-use")).toBe(true);
  });
});
```

- [ ] **Step 2: Implement.** Schema `show` description: `"code: where the CODE sits relative to its output — output (just the result; the default), left / right (code pane on that side, 55 % of the width; give the element width ≥ 700), above / below (code pane stacked over or under the output at full width — pair with lines on a long script), code (the script alone), none (draws NOTHING — the script only feeds template params through \"{id.var}\" tokens)."`. `lines` description: `"code: show the script through a window this many lines tall (≥ 3); stepping past the window scrolls it, as an editor does. Use with above/below, or whenever a script runs long."`. Lint: in the code-use rule, `(el.show === "left" || el.show === "right") && width < 560` → the existing message with the layout name; and `(el.show === "above" || el.show === "below") && el.lines === undefined && nonEmptyLines > 12` → `code "<id>": N lines above/below the output leave little room for it on the canvas — set lines (a window of 6–8) or use left/right`. Rename `split` → `left` with `sed` across the listed files; keep the prompt's "give the element width ≥ 700" clause.

- [ ] **Step 3: Verify + commit.** `npx vitest run tests/code-panel.test.ts tests/code-element.test.ts tests/code-data-bridge.test.ts tests/examples.test.ts tests/fewshots.test.ts && npx tsc --noEmit` — note `layout/code.ts` still compares `show === "split"`; until Task 2 lands, treat `left` as the old split there (a one-line `const sideBySide = show === "left" || show === "right"` is part of Task 2; for this commit change the two comparisons to `show === "left"` so nothing regresses). Commit: `feat(code): show names where the code sits (left/right/above/below); lines declares a window; split retired`.

---

### Task 2: Layout — four layouts, the window, the clip, the output tail

**Files:**
- Modify: `src/layout/code.ts`, `src/layout/model.ts` (`clip?: BBox` on `BaseDrawable`), `src/layout/tier2.ts` (`windows` on `Ctx` + `Tier2Result`), `src/layout/layout.ts` (`windows` on `LayoutResult`)
- Test: `tests/code-panel.test.ts`

**Interfaces:**
- `export interface CodeWindow { ids: string[]; bottoms: number[]; height: number }` (exported from `layout/code.ts`): line ids in order, each line's bottom edge as a distance from the pane's content top (logical units, positive down), and the window's content height.
- `LayoutResult.windows: Record<string, CodeWindow>` keyed by element id (only windowed code elements).
- `BaseDrawable.clip?: BBox` (logical y-up: `{x, y, w, h}` with `y` the bottom).

- [ ] **Step 1: Failing tests**

```ts
import { layoutSpec } from "../src/layout/layout";
import { heuristicMeasure } from "../src/layout/measure";
import { flattenDrawables, type TextDrawable } from "../src/layout/model";

const OK = JSON.stringify({ ok: true, stdout: Array.from({ length: 12 }, (_, i) => `row ${i}`).join("\n"), stderr: "", figures: [] });
const eight = Array.from({ length: 8 }, (_, i) => `line_${i} = ${i}`).join("\n");
const textOf = (spec: Spec, id: string) => flattenDrawables(layoutSpec(spec, heuristicMeasure).drawables).find((d) => d.id === id) as TextDrawable;

describe("code panel layouts", () => {
  test("left and right mirror each other; above and below stack at full width", () => {
    const L = textOf(spec({ show: "left", code: eight, code_result: OK }), "c1_line_1");
    const R = textOf(spec({ show: "right", code: eight, code_result: OK }), "c1_line_1");
    expect(R.pos[0]).toBeGreaterThan(L.pos[0]);
    const A = layoutSpec(spec({ show: "above", code: eight, code_result: OK }), heuristicMeasure);
    const B = layoutSpec(spec({ show: "below", code: eight, code_result: OK }), heuristicMeasure);
    const aLine = flattenDrawables(A.drawables).find((d) => d.id === "c1_line_1") as TextDrawable;
    const aOut = flattenDrawables(A.drawables).find((d) => d.id === "c1__out0") as TextDrawable;
    expect(aLine.pos[1]).toBeGreaterThan(aOut.pos[1]);
    const bLine = flattenDrawables(B.drawables).find((d) => d.id === "c1_line_1") as TextDrawable;
    const bOut = flattenDrawables(B.drawables).find((d) => d.id === "c1__out0") as TextDrawable;
    expect(bLine.pos[1]).toBeLessThan(bOut.pos[1]);
    expect(aLine.pos[0]).toBe(aOut.pos[0]); // same left edge: full-width panes
  });
  test("a window positions every line at its natural row, clips each, and publishes bottoms and height", () => {
    const l = layoutSpec(spec({ show: "left", code: eight, lines: 4, code_result: OK }), heuristicMeasure);
    const win = l.windows["c1"];
    expect(win.ids).toEqual(Array.from({ length: 8 }, (_, i) => `c1_line_${i + 1}`));
    expect(win.bottoms.length).toBe(8);
    for (let i = 1; i < 8; i++) expect(win.bottoms[i]).toBeGreaterThan(win.bottoms[i - 1]);
    expect(win.bottoms[3]).toBeLessThanOrEqual(win.height + 0.01); // the 4th line fits the window
    expect(win.bottoms[4]).toBeGreaterThan(win.height); // the 5th does not
    const line5 = flattenDrawables(l.drawables).find((d) => d.id === "c1_line_5")!;
    expect(line5.clip).toBeDefined();
    const line1 = flattenDrawables(l.drawables).find((d) => d.id === "c1_line_1")!;
    expect(line1.clip).toEqual(line5.clip);
    expect(layoutSpec(spec({ show: "left", code: eight, code_result: OK }), heuristicMeasure).windows).toEqual({});
  });
  test("with a window the panel is the window's height, not the script's", () => {
    const tall = layoutSpec(spec({ show: "above", code: eight, code_result: OK }), heuristicMeasure);
    const win = layoutSpec(spec({ show: "above", code: eight, lines: 3, code_result: OK }), heuristicMeasure);
    const frameH = (l: ReturnType<typeof layoutSpec>) => {
      const f = flattenDrawables(l.drawables).find((d) => d.id === "c1__frame") as { shapeHint?: { h: number } };
      return f.shapeHint!.h;
    };
    expect(frameH(win)).toBeLessThan(frameH(tall));
  });
  test("with a window the output keeps its LAST rows behind a leading ellipsis", () => {
    const l = layoutSpec(spec({ show: "below", code: eight, lines: 3, font_size: 24, code_result: OK }), heuristicMeasure);
    const outs = flattenDrawables(l.drawables).filter((d) => d.id.startsWith("c1__out")) as TextDrawable[];
    expect(outs[0].text).toBe("…");
    expect(outs[outs.length - 1].text).toBe("row 11");
  });
});
```

- [ ] **Step 2: Implement** in `layout/code.ts`:

```ts
const sideBySide = show === "left" || show === "right";
const stacked = show === "above" || show === "below";
const codePaneW = sideBySide ? Math.round(w * 0.55) : w;
const outPaneW = sideBySide ? w - codePaneW - paneGap : w;
// window
const windowRows = typeof el.lines === "number" && el.lines >= 3 ? Math.floor(el.lines) : 0;
const rowPitch = fontSize * ROW_H;
// codeStack as today; then:
const windowH = windowRows > 0 ? windowRows * rowPitch + (windowRows - 1) * fontSize * LINE_GAP : codeStack.height;
const codeContentH = Math.min(codeStack.height, windowH);
```

Budgets: side-by-side unchanged (`outBudget = maxH − 2·PAD`); stacked: `outBudget = maxH − 2·PAD − codeContentH − paneGap` (floor 0). Panel height `h = min(maxH, max(60, contentH + 2·PAD))` where `contentH` is `max(codeContentH, outContentH)` side by side and `codeContentH + paneGap + outContentH` stacked.

Pane rects (y-up): side by side — code pane x = `x0` (left) or `x0 + outPaneW + paneGap` (right), out pane the other; both from `yTop − PAD` down. Stacked — `above`: code pane top = `yTop − PAD`, out pane top = `yTop − PAD − codeContentH − paneGap`; `below`: the reverse. The divider is vertical between side-by-side panes (as today) and horizontal between stacked ones.

Lines: positioned from the code pane's top as today (`pos = [paneX + PAD, paneTop − block.center]`). When windowed: every line gets `clip: { x: paneX, y: paneTop − windowH, w: codePaneW, h: windowH }` and the element publishes `ctx.windows[el.id] = { ids, bottoms: blocks.map(b => b.center + b.height / 2), height: windowH }`. The `__frame` shapeHint uses the windowed `h`.

Output tail: `truncateRows(rows, budget, fontSize, keep: "head" | "tail")`; `tail` keeps the last rows that fit minus one row for the `"…"` marker, prepended. Windowed elements use `tail`; others `head`.

Plumbing: `CodeCtx.windows`, `Ctx.windows`, `Tier2Result.windows`, `LayoutResult.windows` (default `{}`).

- [ ] **Step 3: Verify + commit.** `npm test && npx tsc --noEmit`. Commit: `feat(layout): code panel layouts left/right/above/below, the lines window with clip and published bottoms, the output tail`.

---

### Task 3: Backend — render `clip`

**Files:**
- Modify: `src/render/svg-backend.ts`

**Interfaces:** a leaf with `clip` mounts as `<g clip-path="url(#cs-clip-N)"><g …leaf…></g></g>`; the outer wrapper never receives the offset transform; a `<clipPath id clipPathUnits="userSpaceOnUse"><rect/></clipPath>` lives in a `<defs>` created once per `<svg>`.

- [ ] **Step 1: Implement.** A helper `mountLeaf(layer, g, leaf, svg)`: if `leaf.clip`, create (or reuse by rect key) a clipPath in the svg's `<defs>` (`x = clip.x`, `y = CANVAS.h − clip.y − clip.h`, `w`, `h`), wrap `g` in a `<g clip-path>` and append the wrapper; else append `g`. Use it in both mount paths (the handle-building mount and `swapGeometry`'s remount at line ~799). `setOffset` keeps targeting the inner `g` (already `this.groups`). The exporter serializes the svg subtree, so the `<defs>` and the wrapper travel with it — verified live in Task 5.

- [ ] **Step 2: Verify + commit.** `npm test && npx tsc --noEmit` (no node test can see the DOM; the smoke covers it). Commit: `feat(render): a leaf's clip renders as a fixed clipPath wrapper the offset transform stays inside`.

---

### Task 4: Plan — scroll offsets in every state

**Files:**
- Modify: `src/render/plan.ts` (`PlanOptions.windows?: Record<string, CodeWindow>`; recompute after visibility changes), `src/render/index.ts` (pass `layout.windows`)
- Test: `tests/code-panel.test.ts`

- [ ] **Step 1: Failing test**

```ts
import { planCommands } from "../src/render/plan";

describe("plan — the window scrolls as lines are drawn, and back on erase", () => {
  const win = { c1: { ids: ["c1_line_1", "c1_line_2", "c1_line_3", "c1_line_4", "c1_line_5"], bottoms: [20, 40, 60, 80, 100], height: 60 } };
  const ids = ["c1", ...win.c1.ids, "c1_out"];
  test("offsets follow the highest visible line", () => {
    const plan = planCommands(
      [{ draw: ["c1", "c1_line_1", "c1_line_2", "c1_line_3"] }, { draw: ["c1_line_4"] }, { draw: ["c1_line_5"] }, { erase: ["c1_line_5"] }] as never,
      ids,
      { windows: win },
    );
    const dy = (s: number, id: string) => plan.states[s].offsets[id]?.[1] ?? 0;
    expect(dy(0, "c1_line_1")).toBe(0);
    expect(dy(1, "c1_line_1")).toBe(20); // line 4's bottom 80 − window 60
    expect(dy(1, "c1_line_5")).toBe(20); // hidden lines scroll too, so they arrive in place
    expect(dy(2, "c1_line_1")).toBe(40);
    expect(dy(3, "c1_line_1")).toBe(20); // erased the last line: scroll back
    expect(plan.states[2].offsets["c1_out"]).toBeUndefined();
  });
});
```

- [ ] **Step 2: Implement.** In `planCommands`, after every `makeVisible`/`makeHidden` (draw, show, erase, hide, clear — and the implicit final draw), call `applyScroll()`:

```ts
const applyScroll = () => {
  for (const [, w] of Object.entries(opts.windows ?? {})) {
    let maxBottom = 0;
    w.ids.forEach((id, i) => { if (visibleSet.has(id)) maxBottom = Math.max(maxBottom, w.bottoms[i]); });
    const scroll = Math.max(0, maxBottom - w.height);
    for (const id of w.ids) {
      if (scroll === 0) delete offsets[id]; else offsets[id] = [0, scroll];
    }
  }
};
```

(y-up: a positive dy moves a line UP, which is what scrolling does.) `render/index.ts` passes `windows: layout.windows`. Note the plan's `currentBox` already adds offsets, so `point`/`highlight` on a scrolled line targets where it is.

- [ ] **Step 3: Verify + commit.** Commit: `feat(plan): windowed code lines carry their scroll as state offsets`.

---

### Task 5: Player — tween the scroll; live smoke

**Files:**
- Modify: `src/render/player.ts`

- [ ] **Step 1: Implement.** In `runAction`, for `draw`, `show`, `erase`, `hide`, `clear`: before the step's own work, compare `before.offsets` with `this.plan.states[index].offsets` for every id both know or either knows; for the ids whose offset differs (these are scroll changes — user moves are their own step kind), tween `setOffset` from the old to the new over 250 ms (ease-in-out) with `this.progress`; `draw` scrolls first so the new line lands at the bottom row, `erase` scrolls after the erase so the line is gone before the pane slides back. `renderUpTo` already applies state offsets, so scrub and step-back are exact without change.

- [ ] **Step 2: Live smoke** (dev server, Playwright): a `left` spec with 10 lines and `lines: 4`, stepped one line per beat — lines 5–10 scroll in, the pane clips, `_out` stays put; `above` and `below` with a plot; `right`; step back twice and scrub; export one clip through the existing exporter and confirm the clip frames show the scrolled state. Then the pyodide/R/Brython bundled examples once each (renamed `left`).

- [ ] **Step 3: Ledger + push.** `docs/superpowers/plans/2026-09-03-code-panel-m1-ledger.md`; `git push`; `ls-remote`.
