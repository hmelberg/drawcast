# Code panel M2 — the screen, the typed reveal, the cursor: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `frame` draws chrome around the code panel (a window bar, a monitor with a stand, a laptop with a keyboard, or nothing); `draw: { mode: "type" }` reveals code lines character by character at typing speed with a cursor that follows the typing.

**Architecture:** Chrome is drawables in the panel group with their own ids, laid out around the panel from the element's box, reserving their own space so the panel's `y` stays the centre of the whole assembly. The typed reveal is a leaf-handle behaviour in the backend: at progress `t` the text node shows the first `round(t·n)` characters plus a cursor glyph while typing, driven by the same reveal clock as every other leaf, so scrub and export are exact. `resolveDrawOpts` normalises `type` to `sketch` everywhere except the code lines that ask for it.

**Tech Stack:** TypeScript, vitest; no runtime changes.

**Spec:** `docs/superpowers/specs/2026-09-03-code-panel-screen-editing-design.md` §2, §5, §6, §8–§9. Deviation recorded here: the cursor shows WHILE a line types (and untypes on erase) rather than blinking between lines — a steady cursor after the last line would need cross-leaf state; the live blink is a CSS class on the typing line only.

## Global Constraints

- Core edits only: types, schema, `layout/model.ts` (`"type"` in the draw-mode union), `layout/resolve.ts` (normalise), `layout/code.ts`, `render/svg-backend.ts` (text leaf handle), lint, prompt, one example. No runtime, plan or player changes.
- Typing speed 28 characters per second, floor 400 ms per line; a wrapped line types row by row.
- Chrome ids: `<id>__bar`, `<id>__bezel`, `<id>__stand`, `<id>__keys` (a group of key strokes). `draw: [id]` draws all of it.
- `npm test`, `tsc`, both builds green at every commit; push at the end.

---

### Task 1: Vocabulary — `frame`, `draw.mode: type`, normalisation, lint

**Files:**
- Modify: `src/spec/types.ts` (`frame?: "panel" | "window" | "screen" | "laptop" | "none"`; `SpecDraw.mode` gains `"type"`), `src/spec/schema.ts` (`frame` property; `draw.mode` enum + description), `src/layout/model.ts` (`DrawResolved.mode` and `defaultDrawOpts` accept `"type"`), `src/layout/resolve.ts` (`resolveDrawOpts`: `type` → `sketch` unless `defaults.mode === "type"`), `src/lint/lint.ts` (a non-code element with `draw.mode: type` → warn, rule `code-use`)
- Test: `tests/code-panel.test.ts`

```ts
describe("screen vocabulary", () => {
  test("frame values validate; junk does not", () => {
    for (const f of ["panel", "window", "screen", "laptop", "none"]) expect(validateSpec(spec({ frame: f })).ok).toBe(true);
    expect(validateSpec(spec({ frame: "tv" })).ok).toBe(false);
  });
  test("draw.mode type validates on any element but is only honoured on code lines", () => {
    expect(validateSpec(spec({ draw: { mode: "type" } })).ok).toBe(true);
    const s = { elements: [{ id: "t", type: "text", text: "hi", x: 100, y: 100, draw: { mode: "type" } }], commands: [] } as unknown as Spec;
    expect(validateSpec(s).ok).toBe(true);
    expect(lintCommands(s).some((i) => /type/.test(i.message))).toBe(true);
    expect(resolveDrawOpts({ mode: "type" }).mode).toBe("sketch");
    expect(resolveDrawOpts({ mode: "type" }, { mode: "type", duration: 500 }).mode).toBe("type");
  });
});
```

Schema `frame` description: `"code: chrome drawn around the panel — panel (a light frame; the default), window (a title bar with three dots), screen (a monitor bezel on a stand), laptop (the bezel with a keyboard below), none (bare paper). Pair a screen or laptop with draw: {mode: \"type\"} so the code is typed on it."`. `draw.mode` description adds `"type = characters appear at typing speed with a cursor (code lines only; elsewhere it draws as sketch)"`.

Commit: `feat(code): frame and draw.mode type — vocabulary, normalisation, lint`.

---

### Task 2: Backend — the typed reveal

**Files:**
- Modify: `src/render/svg-backend.ts` (text branch of `makeLeafHandle`)

- [ ] **Implement.** When `leaf.drawOpts.mode === "type"`: capture the full strings per row (single `textContent` or each `tspan`), and

```ts
const rows = t.querySelectorAll("tspan").length > 0 ? [...t.querySelectorAll("tspan")] : null;
const full = rows ? rows.map((s) => s.textContent ?? "") : [t.textContent ?? ""];
const total = full.reduce((a, s) => a + s.length, 0);
const CURSOR = "▌";
const apply = (n: number, typing: boolean) => {
  let left = n;
  full.forEach((s, i) => {
    const take = Math.max(0, Math.min(s.length, left));
    left -= take;
    const shown = s.slice(0, take) + (typing && left === 0 && take < s.length + 1 && (i === full.length - 1 || take < s.length) ? CURSOR : "");
    if (rows) rows[i].textContent = shown; else t.textContent = shown;
  });
};
return {
  durationMs: leaf.drawOpts.duration,
  prepare: () => { g.style.opacity = String(leaf.style.opacity); apply(0, false); },
  setProgress: (p) => { const n = Math.round(p * total); apply(n, p > 0 && p < 1); g.classList.toggle("cs-typing", p > 0 && p < 1); },
};
```

(The cursor sits after the last shown character of the row being typed; at `p = 1` the full text stands with no cursor; at `p = 0` nothing.) A `.cs-typing` CSS rule in the figure styles blinks nothing by default — the text itself is the reveal; the class is a hook for the live player's stylesheet to animate the cursor glyph's opacity via `text-decoration`-free means (a `@keyframes` on the group is fine since export rasterises frames from the same DOM at fixed times). Erase drives `p` from 1 to 0: the line untypes.

Note the layout's `text` field for a wrapped line is `rows.join(" ")` while the tspans carry the rows; the handle reads the DOM, not the leaf, so rows type in reading order.

Commit: `feat(render): draw.mode type — a text leaf reveals character by character with a cursor while typing`.

---

### Task 3: Layout — chrome and the typed lines

**Files:**
- Modify: `src/layout/code.ts`
- Test: `tests/code-panel.test.ts`

- [ ] **Tests**

```ts
describe("the screen", () => {
  const ids = (s: Spec) => flattenDrawables(layoutSpec(s, heuristicMeasure).drawables).map((d) => d.id);
  test("each frame value draws its own chrome ids, and none draws no frame", () => {
    expect(ids(spec({ frame: "window", code_result: OK }))).toContain("c1__bar");
    expect(ids(spec({ frame: "screen", code_result: OK }))).toEqual(expect.arrayContaining(["c1__bezel", "c1__stand"]));
    expect(ids(spec({ frame: "laptop", code_result: OK }))).toEqual(expect.arrayContaining(["c1__bezel", "c1__keys"]));
    expect(ids(spec({ frame: "none", code_result: OK }))).not.toContain("c1__frame");
    expect(ids(spec({ code_result: OK }))).toContain("c1__frame");
  });
  test("chrome reserves its space: the assembly stays centred on y and the content moves inside it", () => {
    const plain = textOf(spec({ show: "left", code: eight, code_result: OK }), "c1_line_1");
    const laptop = textOf(spec({ show: "left", code: eight, code_result: OK, frame: "laptop" }), "c1_line_1");
    expect(laptop.pos[1]).toBeGreaterThan(plain.pos[1]); // the panel rides higher: the keyboard hangs below it
    const bezel = leaf(spec({ show: "left", code: eight, code_result: OK, frame: "screen" }), "c1__bezel") as { shapeHint?: { h: number } };
    const frame = leaf(spec({ show: "left", code: eight, code_result: OK, frame: "screen" }), "c1__frame") as { shapeHint?: { h: number } };
    expect(bezel.shapeHint!.h).toBeGreaterThan(frame.shapeHint!.h);
  });
  test("draw.mode type gives each code line a typing duration and leaves the frame sketched", () => {
    const l = flattenDrawables(layoutSpec(spec({ show: "left", code: "x = 1\nlonger_line = 12345678", draw: { mode: "type" }, code_result: OK }), heuristicMeasure).drawables);
    const l1 = l.find((d) => d.id === "c1_line_1")!;
    const l2 = l.find((d) => d.id === "c1_line_2")!;
    expect(l1.drawOpts.mode).toBe("type");
    expect(l2.drawOpts.duration).toBeGreaterThan(l1.drawOpts.duration);
    expect(l.find((d) => d.id === "c1__frame")!.drawOpts.mode).toBe("sketch");
  });
});
```

- [ ] **Implement.** Constants: `BAR_H = 28`, `BEZEL = 18`, `STAND_H = 56`, `KEYS_H = 120`. Reserved space per frame value: above = `BAR_H` (window) or `BEZEL` (screen/laptop); below = `BEZEL + STAND_H` (screen) or `BEZEL + KEYS_H` (laptop) or `0`; sides = `BEZEL` (screen/laptop). The panel rect is computed as today for `h`, then the whole assembly height `H = h + above + below` is centred on `cy`: `yTop = cy + H / 2 − above`. Chrome drawables (in `panelChildren`, before the frame): `window`: `__bar` — a stroke rect from `yTop` to `yTop + BAR_H` across the panel plus three small circles (`__bar_dot_1..3`, radius 5, in the first 60 units) in guide colour; `screen`/`laptop`: `__bezel` — a rounded rect (`shapeHint` rect) `BEZEL` outside the panel with strokeWidth 4 and a faint fill wash (`COLORS.guide` at opacity 0.08 as an area); `screen`: `__stand` — a neck (two short strokes) and a base line 200 wide, centred, below the bezel; `laptop`: `__keys` — a group: the slab (rounded rect `w + 2·BEZEL` wide, `KEYS_H` tall, hinged to the bezel's bottom), four rows of key rects (`KEYS_H − 24` split into rows of 18 with 6 gaps, key width `(w − 12·6) / 13`, 13 keys in rows 1–3, a 7-key-wide space bar centred in row 4), strokeWidth 1.5, `mode: instant` for the keys so `draw: [id]` stays quick. `frame: none`: no `__frame`, no `__bg`. Typed lines: when `el.draw?.mode === "type"`, each line's `drawOpts = { mode: "type", duration: Math.max(400, Math.round((block.rows.join("").length / 28) * 1000)) }`; every other drawable resolves through `resolveDrawOpts(el.draw, …)` which normalises to sketch.

Commit: `feat(layout): frame chrome (window, screen, laptop) and typed code lines`.

---

### Task 4: Prompt, example, smoke, ledger, push

- Prompt: one sentence in the code bullet: "`\"frame\": \"laptop\"` (or `screen` / `window`) draws the panel as a computer, and `\"draw\": {\"mode\": \"type\"}` types the lines at typing speed — pair them when the story is 'watch me write this'; with `lines` the screen scrolls like an editor."
- Example: "Typed on a laptop" — a Brython script (7 lines), `show: above`, `lines: 5`, `frame: laptop`, `draw: { mode: "type" }`, stepped one line per beat, output last. Must pass the example tests (lint clean).
- Smoke (dev server, Playwright): a typed line mid-progress shows a prefix and the cursor glyph; `p = 1` full text; erase untypes; the laptop chrome renders (ids present, no lint); the bundled example renders.
- Ledger `docs/superpowers/plans/2026-09-03-code-panel-m2-ledger.md`; push.
