# Live Drawn Controls (Stage 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The drawn `pane: controls` panel is itself the live control while paused; the HTML controls card, the tray-on-pause, the sketchy tray border and the mono panel font all go.

**Architecture:** A new DOM-free host (`src/ui/controls-host.ts`) reads the painted layout's row geometry (`<id>_ctl_<name>__track|__chip_k|__pill|__box`) and turns a logical point into a commit through the tray's existing `controlsDeps.commit` → `runControls` → `runEdited` → `repaint` path; nothing new runs code. A stage listener in the same file drives it with pointer capture. A tiny registry (`src/ui/control-press.ts`) lets `controls.ts`'s play gesture treat a press inside a panel as a control press without either module importing the other, and lets the tray offer "Continue" to the play gesture while an explore gate holds. The panel itself gains a drawn `Run ▶` row for `autorun: false` and drops its mono font.

**Tech Stack:** TypeScript, vitest (no DOM harness in this repo: DOM code is pinned at source level, logic is tested pure), Vite. `npm test` = `vitest run`; `npm run build` = `tsc && vite build` (Netlify runs both, so tsc must pass before push).

**Spec:** `docs/superpowers/specs/2026-09-15-live-controls-sweep-movie-design.md` §3 (Stage 1). Read §2 (the rulings) too.

## Global Constraints

- **Do not modify** `src/ui/widget-host.ts`, `src/render/player.ts`, `src/scenes/widget-*.ts`, `tests/widget-*.test.ts` — the locked `widgets-3` worktree (drag gesture) edits them concurrently. If a task seems to need them, stop and say so.
- No new prompt or schema text in this stage (no prompt-size re-pin needed). `public/help.html` is user docs, not the prompt.
- Every commit must leave `npx vitest run` green. Run `npx tsc --noEmit` before the final push.
- Commit messages end with the attribution lines the session reminder gives (Co-Authored-By + Claude-Session).
- Coordinates: layout is logical, y-up (`Pt = [x, y]`); `logicalPoint(stage, e)` converts a mouse event, `clientPointFor(stage, p)` converts back to stage pixels. `BBox = {x, y, w, h}` with `y` the bottom edge.
- Ids minted by `src/layout/code-controls-pane.ts`: row `<id>_ctl_<name>` (a group), children `<rowId>__label`, `__track`, `__knob`, `__value`, `__chip_<k>`, `__chiptext_<k>`, `__pill`, `__box`. `<id>_ctls` is a group id, not a drawable. `layout.panes[<id>]` is the pane rectangle.

---

### Task 1: The control-press registry and the play-gesture exemption

**Files:**
- Create: `src/ui/control-press.ts`
- Modify: `src/ui/controls.ts:1106-1156` (togglePlay, CONTROL_SELECTOR, the stage click gesture)
- Test: `tests/stage-click.test.ts` (extend), `tests/control-press.test.ts` (new)

**Interfaces:**
- Produces:
  - `registerControlRegion(stage: HTMLElement, fn: (e: MouseEvent) => boolean): () => void` — a predicate; a press for which any registered predicate returns true is a control press.
  - `inControlRegion(stage: HTMLElement, e: MouseEvent): boolean`
  - `registerContinue(stage: HTMLElement, fn: () => boolean): () => void` — a hook the play gesture consults first; returns true when it consumed the gesture.
  - `tryContinue(stage: HTMLElement): boolean`
- Consumed by Task 4 (the host registers a region) and Task 5 (the tray registers Continue).

- [ ] **Step 1: Write the failing tests**

`tests/control-press.test.ts`:
```ts
import { describe, expect, test } from "vitest";
import { inControlRegion, registerContinue, registerControlRegion, tryContinue } from "../src/ui/control-press";

// A stand-in for the stage: the registry keys on object identity only.
const stage = {} as HTMLElement;
const ev = {} as MouseEvent;

describe("control-press registry", () => {
  test("no region registered: nothing is a control press", () => {
    expect(inControlRegion(stage, ev)).toBe(false);
  });
  test("a registered predicate decides, and unregistering removes it", () => {
    const off = registerControlRegion(stage, () => true);
    expect(inControlRegion(stage, ev)).toBe(true);
    off();
    expect(inControlRegion(stage, ev)).toBe(false);
  });
  test("any one of several predicates suffices", () => {
    const a = registerControlRegion(stage, () => false);
    const b = registerControlRegion(stage, () => true);
    expect(inControlRegion(stage, ev)).toBe(true);
    a();
    b();
  });
  test("continue: consumed only while a hook says so", () => {
    expect(tryContinue(stage)).toBe(false);
    let gated = true;
    const off = registerContinue(stage, () => gated);
    expect(tryContinue(stage)).toBe(true);
    gated = false;
    expect(tryContinue(stage)).toBe(false);
    off();
    gated = true;
    expect(tryContinue(stage)).toBe(false);
  });
});
```

Append to `tests/stage-click.test.ts` inside the describe:
```ts
  test("a press inside a registered control region (the drawn panel) is a control press too", () => {
    expect(src).toMatch(/import \{ inControlRegion, tryContinue \} from "\.\/control-press";/);
    expect(src).toMatch(/const onControl = \(e: MouseEvent\): boolean =>[\s\S]{0,200}inControlRegion\(stage, e\)/);
    expect(src).toMatch(/stage\.addEventListener\("pointerdown", \(e\) => \(pressOnControl = onControl\(e\)\), true\)/);
  });
  test("the play gesture offers Continue first: an explore gate with the tray shut resumes on the figure click and the bar's play", () => {
    const toggle = /const togglePlay = \(\) => \{([\s\S]*?)\n  \};/.exec(src);
    expect(toggle).not.toBeNull();
    expect(toggle![1].trimStart().startsWith("if (tryContinue(stage)) return;")).toBe(true);
  });
```
And change the existing selector pin: replace `".cs-ctlcard"` in the expected list with `".cs-ctlinput"`, and update the second test's regex from `onControl\(e\.target\)` to `onControl\(e\)` in both places (`pressOnControl = onControl(e)` and `if (began || onControl(e)) return;`).

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/control-press.test.ts tests/stage-click.test.ts`
Expected: FAIL — module `../src/ui/control-press` not found; the stage-click regexes do not match.

- [ ] **Step 3: Write the registry**

`src/ui/control-press.ts`:
```ts
// Who owns a press on the stage. The stage's click-to-toggle-play gesture
// (controls.ts) must not fire for a press that began on a control — and the
// drawn control panel (layout/code-controls-pane.ts, live through
// ui/controls-host.ts) is a control with no DOM node to match a CSS
// selector against. So the gesture asks a registry: any module that owns a
// region of the stage registers a predicate here, and controls.ts never
// learns who they are (no import in either direction — the tray imports
// controls.ts already, and the host is the tray's).
//
// The same registry carries the Continue hook: while an explore beat holds
// the run with the tray shut (spec 2026-09-15 §3.3), the play gesture — a
// click on the figure, the bar's ▶ — must resolve the gate rather than
// toggle the timeline, and only the tray knows whether a gate is open.
// Keyed on the stage element so two mounted sessions never share state.

const regions = new WeakMap<HTMLElement, Set<(e: MouseEvent) => boolean>>();
const continues = new WeakMap<HTMLElement, Set<() => boolean>>();

function add<T>(map: WeakMap<HTMLElement, Set<T>>, stage: HTMLElement, fn: T): () => void {
  let set = map.get(stage);
  if (!set) {
    set = new Set<T>();
    map.set(stage, set);
  }
  set.add(fn);
  return () => {
    set!.delete(fn);
  };
}

/** Register a predicate: true when the press belongs to a control. */
export function registerControlRegion(stage: HTMLElement, fn: (e: MouseEvent) => boolean): () => void {
  return add(regions, stage, fn);
}

/** True when any registered region claims the press. */
export function inControlRegion(stage: HTMLElement, e: MouseEvent): boolean {
  const set = regions.get(stage);
  if (!set) return false;
  for (const fn of set) if (fn(e)) return true;
  return false;
}

/** Register a Continue hook: return true to consume the play gesture. */
export function registerContinue(stage: HTMLElement, fn: () => boolean): () => void {
  return add(continues, stage, fn);
}

/** Offer the play gesture to the hooks; true when one consumed it. */
export function tryContinue(stage: HTMLElement): boolean {
  const set = continues.get(stage);
  if (!set) return false;
  for (const fn of set) if (fn()) return true;
  return false;
}
```

- [ ] **Step 4: Wire controls.ts**

In `src/ui/controls.ts` add the import beside the other `./` imports:
```ts
import { inControlRegion, tryContinue } from "./control-press";
```
Change `togglePlay` so its first statement is the hook:
```ts
  const togglePlay = () => {
    if (tryContinue(stage)) return; // an explore gate with the tray shut: this gesture is Continue
    if (hd.timeline.state === "playing") {
```
Replace the selector block (the three lines `CONTROL_SELECTOR`, `onControl`, `pressOnControl` and the two listeners) with:
```ts
  const CONTROL_SELECTOR = "input, button, select, textarea, label, .cs-paramtray, .cs-codeedit, .cs-ctlinput";
  // …or inside a region some module owns — the drawn control panel has no
  // DOM node of its own to match, so it registers a predicate instead
  // (ui/control-press.ts).
  const onControl = (e: MouseEvent): boolean =>
    (e.target instanceof Element && e.target.closest(CONTROL_SELECTOR) !== null) || inControlRegion(stage, e);
  let pressOnControl = false;
  stage.addEventListener("pointerdown", (e) => (pressOnControl = onControl(e)), true);
  stage.addEventListener("click", (e) => {
    const began = pressOnControl;
    pressOnControl = false;
    if (began || onControl(e)) return;
    if (gateIsOpen(stage)) return; // a question holds the run: its card is the door, not a click beside it
    if (isTextDrag(window.getSelection())) return;
    togglePlay();
  });
```
Keep the existing comment block above it; append one sentence: "A press inside a drawn control panel is a control press through the registry."

- [ ] **Step 5: Run the tests**

Run: `npx vitest run tests/control-press.test.ts tests/stage-click.test.ts`
Expected: PASS (the `.cs-ctlcard` selector pin now expects `.cs-ctlinput`).

- [ ] **Step 6: Commit**

```bash
git add src/ui/control-press.ts src/ui/controls.ts tests/control-press.test.ts tests/stage-click.test.ts
git commit -m "Live controls: the control-press registry — a press inside a registered region never toggles play, and the play gesture offers Continue first (Task 1)"
```

---

### Task 2: The panel in the sketch font, with a drawn Run row

**Files:**
- Modify: `src/layout/code-controls-pane.ts` (`mkText` at ~:165, `controlsPaneHeight` at ~:91, `controlsPane` signature at :123 and its row loop end at ~:305)
- Modify: `src/layout/code.ts:367-378` and `:718-744` (the two call sites)
- Test: `tests/code-pane-controls.test.ts` (extend)

**Interfaces:**
- Produces: `controlsPane(..., origControls?, opts?: { runRow?: boolean })` — with `runRow: true` the panel ends with one extra row, id `<id>_ctl__run`, a pill `<id>_ctl__run__pill` and caption `<id>_ctl__run__value` ("Run ▶"); `controlsPaneHeight(labels, fontSize, w, extraRows = 0)`. Task 3 hits `__run__pill`.
- Exported constant `RUN_ROW_ID = "__run"` (the `<name>` part of the row id).

- [ ] **Step 1: Write the failing tests**

Append to `tests/code-pane-controls.test.ts` inside `describe("controlsPane (pure)")`:
```ts
  test("the panel's text is set in the figure's own face, not the code font (spec 2026-09-15 §3.5)", () => {
    const p = controlsPane("sim", "python", code, names, { x: 100, top: 600, w: 400 }, 17, undefined, undefined);
    const texts = flattenDrawables(p.drawables).filter((d) => d.kind === "text") as TextDrawable[];
    expect(texts.length).toBeGreaterThan(0);
    for (const t of texts) expect(t.font).toBeUndefined();
  });
  test("autorun: false draws a Run ▶ row last, and the height counts it", () => {
    const p = controlsPane("sim", "python", "n = (0, 100)", ["n"], { x: 0, top: 0, w: 500 }, 20, undefined, undefined, undefined, { runRow: true });
    expect(p.order).toEqual(["sim_ctl_n", `sim_ctl_${RUN_ROW_ID}`]);
    expect(p.groups).toEqual({ sim_ctls: p.order });
    const pill = flattenDrawables(p.drawables).find((d) => d.id === `sim_ctl_${RUN_ROW_ID}__pill`);
    const cap = flattenDrawables(p.drawables).find((d) => d.id === `sim_ctl_${RUN_ROW_ID}__value`) as TextDrawable;
    expect(pill).toBeDefined();
    expect(cap.text).toBe("Run ▶");
    expect(p.height).toBeCloseTo(controlsPaneHeight(["n"], 20, 500, 1), 5);
    expect(p.height).toBeCloseTo(2 * 20 * CTL_ROW_H, 5);
  });
  test("a layout with autorun: false reserves the Run row in the pane", () => {
    const s = spec({ code: "n = (0, 100)", controls: ["n"], autorun: false });
    expect(ids(s)).toContain(`sim_ctl_${RUN_ROW_ID}__pill`);
  });
```
Add `RUN_ROW_ID` to the import from `../src/layout/code-controls-pane`.

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/code-pane-controls.test.ts`
Expected: FAIL — `font` is `"mono"`; `RUN_ROW_ID` undefined.

- [ ] **Step 3: Implement in `code-controls-pane.ts`**

1. Export the constant near `CTL_ROW_H`:
```ts
/** The `<name>` half of the Run row's id (`<id>_ctl__run`) — two underscores,
 *  which no control name written in a script produces after `_ctl_`. */
export const RUN_ROW_ID = "__run";
```
2. In `mkText`, delete the line `font: "mono",` (the text then takes the figure's default face). Leave the `CHAR_W` width estimates as they are — a slight over-estimate for the sketch face keeps the value column from colliding.
3. `controlsPaneHeight(labels, fontSize, w, extraRows = 0)`: add the parameter and add `extraRows * fontSize * CTL_ROW_H` to the returned height.
4. `controlsPane` gains a trailing `opts: { runRow?: boolean } = {}`. The row loop keeps a running top-of-row y (read the loop: it decrements by `rowH`, or `WRAP_MULT * rowH` for a wrapped row, per control). Hoist that running variable — call it `nextTop` — to the scope above the loop so it is still readable after it, then, after the loop and before `const height = …`:
```ts
  if (opts.runRow) {
    const rowId = `${id}_ctl_${RUN_ROW_ID}`;
    const cy = nextTop - 0.5 * rowH;
    const boxY = cy - fieldH / 2;
    const children: Drawable[] = [
      mkStrokeRect(`${rowId}__pill`, box.x, boxY, box.w, fieldH),
      mkText(`${rowId}__value`, [box.x + box.w / 2, cy], "Run ▶", "middle"),
    ];
    rows.push({ id: rowId, kind: "group", z: Z_STROKE, style: defaultStyle(), drawOpts: resolveDrawOpts(undefined, { mode: "sketch", duration: 0 }), children });
    order.push(rowId);
    anchors[rowId] = [box.x, cy];
```
   and `const height = controlsPaneHeight(labels, fontSize, box.w, opts.runRow ? 1 : 0);`.

- [ ] **Step 4: Pass the flag from `code.ts`**

At the height pre-pass (~:372-378) call `controlsPaneHeight(labels, fontSize, w, el.autorun === false ? 1 : 0)`; at the `controlsPane(...)` call (~:718) append `{ runRow: el.autorun === false }` as the last argument.

- [ ] **Step 5: Run the tests**

Run: `npx vitest run tests/code-pane-controls.test.ts tests/examples.test.ts`
Expected: PASS. (The examples gate re-lays every bundled example; a `pane: controls` example with `autorun: false` grows a row — if an example's geometry issue count changes, read the failure and adjust that example's `width` rather than the layout.)

- [ ] **Step 6: Commit**

```bash
git add src/layout/code-controls-pane.ts src/layout/code.ts tests/code-pane-controls.test.ts
git commit -m "Live controls: the drawn panel in the figure's own face, and a drawn Run ▶ row for autorun: false (Task 2)"
```

---

### Task 3: The controls host core (pure)

**Files:**
- Create: `src/ui/controls-host.ts` (core only in this task; the stage listener is Task 4 in the same file)
- Test: `tests/controls-host.test.ts`

**Interfaces:**
- Consumes: `RUN_ROW_ID` (Task 2); `leafDrawables` (`src/layout/model.ts`), `bboxOfPts` (`src/layout/geometry.ts`), `ControlSpec`, `ControlValue` (`src/code/controls.ts`), `LayoutResult` (`src/layout/layout.ts`), `SpecElement`.
- Produces:
```ts
export interface ControlsPanel { el: SpecElement; controls: ControlSpec[] }
export interface ControlsHostDeps {
  panels: () => ControlsPanel[];                      // every pane: "controls" script, with its ORIGINAL-parse controls
  layout: () => LayoutResult;                          // the painted layout (or hd.layout)
  visible: (id: string) => boolean;                    // is the panel on screen at this boundary
  enabled: () => boolean;                              // false while the tray is open (its rows are the live copy then)
  commit: (el: SpecElement, c: ControlSpec, raw: string | boolean, immediate: boolean) => void;
  run: (el: SpecElement) => void;                      // the drawn Run ▶ row: a forced run
  editText: (el: SpecElement, c: ControlSpec, box: BBox) => void; // text/number: the caller mounts the transient input
}
export interface SliderGesture { el: SpecElement; control: ControlSpec; x0: number; x1: number }
export interface ControlsHost {
  panelAt(p: Pt): string | null;
  press(p: Pt): SliderGesture | null;
  drag(g: SliderGesture, p: Pt): void;
  release(g: SliderGesture, p: Pt): void;
  over(p: Pt): boolean;
}
export function sliderValueAt(c: ControlSpec, frac: number): number;
export function controlsHostFor(deps: ControlsHostDeps): ControlsHost;
```

- [ ] **Step 1: Write the failing tests**

`tests/controls-host.test.ts`:
```ts
// The controls host's DOM-free core: a logical point on the drawn panel
// becomes a commit through the tray's own closures. Geometry comes from a
// real layout (layoutSpec + heuristicMeasure), never from numbers typed here.
import { describe, expect, test } from "vitest";
import { layoutSpec } from "../src/layout/layout";
import { heuristicMeasure } from "../src/layout/measure";
import { flattenDrawables, type StrokeDrawable, type AreaDrawable } from "../src/layout/model";
import { bboxOfPts } from "../src/layout/geometry";
import { parseControls, type ControlSpec } from "../src/code/controls";
import { RUN_ROW_ID } from "../src/layout/code-controls-pane";
import { controlsHostFor, sliderValueAt, type ControlsHostDeps } from "../src/ui/controls-host";
import type { Spec, SpecElement } from "../src/spec/types";

const OK = JSON.stringify({ ok: true, stdout: "42", stderr: "", figures: [] });
const CODE = 'n = (0, 100)\nmodel = ["SIR", "SEIR"]\nlog = False\nname = "x"\ngo = Button("Go")';
const NAMES = ["n", "model", "log", "name", "go"];

function setup(extra: object = {}) {
  const el = { id: "sim", type: "code", language: "python", show: "left", width: 900, pane: "controls", controls: NAMES, code: CODE, code_src: CODE, code_result: OK, ...extra } as unknown as SpecElement;
  const spec = { elements: [el], commands: [{ draw: ["sim"] }] } as unknown as Spec;
  const layout = layoutSpec(spec, heuristicMeasure);
  const controls = parseControls("python", CODE, NAMES).controls;
  const commits: { name: string; raw: string | boolean; immediate: boolean }[] = [];
  const runs: string[] = [];
  const edits: { name: string }[] = [];
  const deps: ControlsHostDeps = {
    panels: () => [{ el, controls }],
    layout: () => layout,
    visible: () => true,
    enabled: () => true,
    commit: (_el, c, raw, immediate) => commits.push({ name: c.name, raw, immediate }),
    run: (e) => runs.push(e.id),
    editText: (_el, c) => edits.push({ name: c.name }),
  };
  const leaves = flattenDrawables(layout.drawables);
  const leaf = (id: string) => leaves.find((d) => d.id === id) as StrokeDrawable | AreaDrawable;
  const centre = (id: string): [number, number] => {
    const b = bboxOfPts(leaf(id).pts);
    return [b.x + b.w / 2, b.y + b.h / 2];
  };
  return { el, layout, controls, deps, commits, runs, edits, leaf, centre };
}

describe("sliderValueAt", () => {
  const c = (o: Partial<ControlSpec>): ControlSpec => ({ name: "n", kind: "slider", label: "n", default: 0, line: 0, start: 0, end: 0, birthplace: "assign", min: 0, max: 100, ...o });
  test("a fraction maps linearly and clamps", () => {
    expect(sliderValueAt(c({}), 0.3)).toBeCloseTo(30, 6);
    expect(sliderValueAt(c({}), -0.2)).toBe(0);
    expect(sliderValueAt(c({}), 1.7)).toBe(100);
  });
  test("snaps to the step and to integers", () => {
    expect(sliderValueAt(c({ step: 5 }), 0.33)).toBe(35);
    expect(sliderValueAt(c({ integer: true }), 0.337)).toBe(34);
    expect(sliderValueAt(c({ min: 0.1, max: 1.0, step: 0.05, decimals: 2 }), 0.5)).toBeCloseTo(0.55, 6);
  });
});

describe("controls host core", () => {
  test("panelAt: inside the pane rectangle, and nowhere else", () => {
    const { layout, deps } = setup();
    const host = controlsHostFor(deps);
    const pane = layout.panes!.sim;
    expect(host.panelAt([pane.x + pane.w / 2, pane.y + pane.h / 2])).toBe("sim");
    expect(host.panelAt([pane.x + pane.w + 50, pane.y + pane.h / 2])).toBeNull();
    expect(host.over([pane.x + pane.w / 2, pane.y + pane.h / 2])).toBe(true);
  });
  test("a slider press at 30 % of the track commits 30, not immediately, and returns a drag gesture", () => {
    const { deps, commits, leaf } = setup();
    const host = controlsHostFor(deps);
    const track = leaf("sim_ctl_n__track");
    const xs = track.pts.map((q) => q[0]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y = track.pts[0][1];
    const g = host.press([x0 + 0.3 * (x1 - x0), y]);
    expect(g?.control.name).toBe("n");
    expect(commits).toEqual([{ name: "n", raw: "30", immediate: false }]);
    host.drag(g!, [x0 + 0.5 * (x1 - x0), y]);
    expect(commits.at(-1)).toEqual({ name: "n", raw: "50", immediate: false });
    host.release(g!, [x1 + 999, y]); // past the end: clamps, and the release is immediate
    expect(commits.at(-1)).toEqual({ name: "n", raw: "100", immediate: true });
  });
  test("a press on the row band above the track line still counts as the slider", () => {
    const { deps, commits, leaf } = setup();
    const host = controlsHostFor(deps);
    const track = leaf("sim_ctl_n__track");
    const y = track.pts[0][1];
    const x0 = Math.min(...track.pts.map((q) => q[0]));
    host.press([x0, y + 6]);
    expect(commits.length).toBe(1);
    expect(commits[0].raw).toBe("0");
  });
  test("a choice click on the second chip commits that option, immediately, with no gesture", () => {
    const { deps, commits, centre } = setup();
    const host = controlsHostFor(deps);
    expect(host.press(centre("sim_ctl_model__chip_1"))).toBeNull();
    expect(commits).toEqual([{ name: "model", raw: "SEIR", immediate: true }]);
  });
  test("a toggle click flips from its current value", () => {
    const { deps, commits, centre } = setup();
    const host = controlsHostFor(deps);
    host.press(centre("sim_ctl_log__pill"));
    expect(commits).toEqual([{ name: "log", raw: true, immediate: true }]);
  });
  test("a text box click asks the caller for the transient input, with the box", () => {
    const { deps, commits, edits, centre } = setup();
    const host = controlsHostFor(deps);
    host.press(centre("sim_ctl_name__box"));
    expect(edits).toEqual([{ name: "name" }]);
    expect(commits).toEqual([]);
  });
  test("a button press commits once, immediately", () => {
    const { deps, commits, centre } = setup();
    const host = controlsHostFor(deps);
    host.press(centre("sim_ctl_go__pill"));
    expect(commits).toEqual([{ name: "go", raw: true, immediate: true }]);
  });
  test("the drawn Run ▶ row forces a run", () => {
    const { deps, runs, centre } = setup({ autorun: false });
    const host = controlsHostFor(deps);
    host.press(centre(`sim_ctl_${RUN_ROW_ID}__pill`));
    expect(runs).toEqual(["sim"]);
  });
  test("nothing happens on a hidden panel, or while disabled", () => {
    const a = setup();
    a.deps.visible = () => false;
    expect(controlsHostFor(a.deps).press(a.centre("sim_ctl_model__chip_1"))).toBeNull();
    expect(a.commits).toEqual([]);
    const b = setup();
    b.deps.enabled = () => false;
    controlsHostFor(b.deps).press(b.centre("sim_ctl_model__chip_1"));
    expect(b.commits).toEqual([]);
    expect(controlsHostFor(b.deps).over(b.centre("sim_ctl_model__chip_1"))).toBe(false);
  });
  test("the gutter between rows is not a control", () => {
    const { layout, deps, commits } = setup();
    const host = controlsHostFor(deps);
    const pane = layout.panes!.sim;
    host.press([pane.x + pane.w - 1, pane.y + 1]); // bottom-right corner of the pane: below the last row's band
    expect(commits).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/controls-host.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the core**

`src/ui/controls-host.ts`:
```ts
// The drawn control panel, live (spec 2026-09-15 §3.1): a `pane: controls`
// panel's knobs, chips, pills and boxes take the pointer directly, so a
// control has ONE look — the drawn one — instead of a picture with an HTML
// twin lying on it (the deleted ui/controls-card.ts, whose two copies of
// one state could drift). Same shape as ui/widget-host.ts: a DOM-free core
// (controlsHostFor) that tests drive from a real layout, and a stage
// listener (attachControlsHost, below) that is source-pinned.
//
// Geometry is READ, never computed here: the row children the layout mints
// (`<id>_ctl_<name>__track`, `__chip_<k>`, `__pill`, `__box`) are found by
// id in the painted layout's leaves, so a knob that moved because the
// script was rewritten is hit where it is drawn now. Nothing here runs
// code: a hit becomes `commit` — the tray's own closure over its values,
// its debounce and its run path — exactly as a tray row's input event does.
import type { SpecElement } from "../spec/types";
import type { ControlSpec } from "../code/controls";
import type { LayoutResult } from "../layout/layout";
import type { BBox } from "../layout/geometry";
import { bboxOfPts } from "../layout/geometry";
import { leafDrawables, type Pt } from "../layout/model";
import { RUN_ROW_ID } from "../layout/code-controls-pane";

export interface ControlsPanel {
  el: SpecElement;
  /** The ORIGINAL-parse controls (kinds, ranges, options) — a rewritten
   *  slider is a bare number and no longer carries them. */
  controls: ControlSpec[];
}

export interface ControlsHostDeps {
  panels: () => ControlsPanel[];
  layout: () => LayoutResult;
  visible: (id: string) => boolean;
  /** False while the tray is open: its rows are the live copy then, and one
   *  live copy at a time is what keeps the two from drifting. */
  enabled: () => boolean;
  commit: (el: SpecElement, c: ControlSpec, raw: string | boolean, immediate: boolean) => void;
  run: (el: SpecElement) => void;
  editText: (el: SpecElement, c: ControlSpec, box: BBox) => void;
}

export interface SliderGesture {
  el: SpecElement;
  control: ControlSpec;
  x0: number;
  x1: number;
}

export interface ControlsHost {
  /** The `pane: controls` element whose pane rectangle contains p. */
  panelAt(p: Pt): string | null;
  /** A press: performs a click control's effect; returns a gesture for a slider. */
  press(p: Pt): SliderGesture | null;
  drag(g: SliderGesture, p: Pt): void;
  release(g: SliderGesture, p: Pt): void;
  /** True over a live row (the cursor rule; no side effects). */
  over(p: Pt): boolean;
}

/** Vertical slack around a row's ink, logical units — a finger-sized band. */
const BAND_PAD = 8;

/** The slider value at a fraction of its track: linear, snapped, clamped. */
export function sliderValueAt(c: ControlSpec, frac: number): number {
  const min = c.min ?? 0;
  const max = c.max ?? 1;
  const f = Math.min(1, Math.max(0, frac));
  let v = min + f * (max - min);
  if (c.step && c.step > 0) v = min + Math.round((v - min) / c.step) * c.step;
  if (c.integer) v = Math.round(v);
  v = Math.min(max, Math.max(min, v));
  return Number(v.toFixed(c.decimals ?? 6));
}

const inBox = (b: BBox, p: Pt, pad = 0): boolean => p[0] >= b.x - pad && p[0] <= b.x + b.w + pad && p[1] >= b.y - pad && p[1] <= b.y + b.h + pad;

export function controlsHostFor(deps: ControlsHostDeps): ControlsHost {
  type Leaf = ReturnType<typeof leafDrawables>[number];
  const leavesById = (): Map<string, Leaf> => {
    const m = new Map<string, Leaf>();
    for (const d of leafDrawables(deps.layout().drawables)) m.set(d.id, d);
    return m;
  };
  const ptsBox = (d: Leaf | undefined): BBox | null => (d && (d.kind === "stroke" || d.kind === "area") && d.pts.length > 0 ? bboxOfPts(d.pts) : null);

  const panelAt = (p: Pt): string | null => {
    const panes = deps.layout().panes ?? {};
    for (const { el } of deps.panels()) {
      const b = panes[el.id];
      if (b && deps.visible(el.id) && inBox(b, p)) return el.id;
    }
    return null;
  };

  /** The row under p, with the leaves the hit test needs. */
  type Hit = { el: SpecElement; c: ControlSpec | null; rowId: string; leaves: Map<string, Leaf>; box: BBox };
  const rowAt = (p: Pt): Hit | null => {
    if (!deps.enabled()) return null;
    const id = panelAt(p);
    if (id === null) return null;
    const panel = deps.panels().find((x) => x.el.id === id);
    if (!panel) return null;
    const leaves = leavesById();
    const rowIds: [string, ControlSpec | null][] = panel.controls.map((c) => [`${id}_ctl_${c.name}`, c]);
    if (panel.el.autorun === false) rowIds.push([`${id}_ctl_${RUN_ROW_ID}`, null]);
    for (const [rowId, c] of rowIds) {
      const pts: Pt[] = [];
      for (const [lid, d] of leaves) {
        if (!lid.startsWith(`${rowId}__`)) continue;
        if (d.kind === "stroke" || d.kind === "area") pts.push(...d.pts);
      }
      if (pts.length === 0) continue;
      const box = bboxOfPts(pts);
      if (inBox(box, p, BAND_PAD)) return { el: panel.el, c, rowId, leaves, box };
    }
    return null;
  };

  const trackOf = (h: Hit): { x0: number; x1: number } | null => {
    const t = ptsBox(h.leaves.get(`${h.rowId}__track`));
    return t ? { x0: t.x, x1: t.x + t.w } : null;
  };
  const sliderCommit = (g: SliderGesture, p: Pt, immediate: boolean): void => {
    const frac = g.x1 > g.x0 ? (p[0] - g.x0) / (g.x1 - g.x0) : 0;
    deps.commit(g.el, g.control, String(sliderValueAt(g.control, frac)), immediate);
  };

  return {
    panelAt,
    over: (p) => rowAt(p) !== null,
    press: (p) => {
      const h = rowAt(p);
      if (!h) return null;
      if (h.c === null) {
        deps.run(h.el); // the drawn Run ▶ row
        return null;
      }
      const c = h.c;
      switch (c.kind) {
        case "slider": {
          const t = trackOf(h);
          if (!t) return null;
          const g: SliderGesture = { el: h.el, control: c, x0: t.x0, x1: t.x1 };
          sliderCommit(g, p, false);
          return g;
        }
        case "choice": {
          const options = c.options ?? [];
          for (let k = 0; k < options.length; k++) {
            const b = ptsBox(h.leaves.get(`${h.rowId}__chip_${k}`));
            if (b && inBox(b, p, 2)) {
              deps.commit(h.el, c, options[k], true);
              return null;
            }
          }
          return null;
        }
        case "toggle": {
          const valueText = h.leaves.get(`${h.rowId}__value`);
          const on = valueText?.kind === "text" && valueText.text === "on";
          deps.commit(h.el, c, !on, true);
          return null;
        }
        case "text":
        case "number": {
          const b = ptsBox(h.leaves.get(`${h.rowId}__box`)) ?? h.box;
          deps.editText(h.el, c, b);
          return null;
        }
        case "button":
          deps.commit(h.el, c, true, true);
          return null;
        default:
          return null;
      }
    },
    drag: (g, p) => sliderCommit(g, p, false),
    release: (g, p) => sliderCommit(g, p, true),
  };
}
```
Note on the toggle: the drawn `__value` text is "on"/"off" and reflects the rewritten script — the panel's current truth — so the flip reads it rather than `deps.values`, which the host therefore does not need.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/controls-host.test.ts`
Expected: PASS. If the "row band above the track" test fails, the heuristic measure's row height is below 6 units at fontSize 17 — lower the offset in the test to `+ 3`, not `BAND_PAD`.

- [ ] **Step 5: Commit**

```bash
git add src/ui/controls-host.ts tests/controls-host.test.ts
git commit -m "Live controls: the controls host core — a logical point on the drawn panel becomes a commit; sliders snap, chips choose, pills flip, boxes ask for an input, the Run row runs (Task 3)"
```

---

### Task 4: The transient input and the stage listener

**Files:**
- Create: `src/ui/controls-input.ts`
- Modify: `src/ui/controls-host.ts` (append `attachControlsHost`)
- Modify: `src/styles.css` (add `.cs-ctlinput`)
- Test: `tests/controls-host-stage.test.ts` (source pins)

**Interfaces:**
- Produces:
```ts
// controls-input.ts
export interface ControlsInputOpts { box: BBox; fontPx: number; value: string; numeric: boolean; onCommit: (text: string) => void; onCancel: () => void }
export function mountControlsInput(stage: HTMLElement, opts: ControlsInputOpts): { close: () => void; reposition: () => void } | null;
// controls-host.ts
export interface AttachOpts { playing: () => boolean; gated: () => boolean; pauseAndSnap: () => void }
export function attachControlsHost(stage: HTMLElement, host: ControlsHost, opts: AttachOpts): () => void;  // returns teardown
```
- Consumes: `registerControlRegion` (Task 1), `logicalPoint`, `clientPointFor` (`src/ui/dom.ts`).

- [ ] **Step 1: Write the failing pins**

`tests/controls-host-stage.test.ts`:
```ts
// The controls host's stage half is DOM (no harness here): source pins,
// the idiom tests/stage-click.test.ts set.
import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";

const host = readFileSync("src/ui/controls-host.ts", "utf8");
const input = readFileSync("src/ui/controls-input.ts", "utf8");
const css = readFileSync("src/styles.css", "utf8");

describe("controls host on the stage (pins)", () => {
  test("the host registers its panels as a control region, so a press there never toggles play", () => {
    expect(host).toMatch(/registerControlRegion\(stage, \(e\) => \{[\s\S]{0,300}host\.panelAt\(p\) !== null/);
  });
  test("a press while playing pauses and snaps FIRST, then the same press is the gesture (one click)", () => {
    const down = /stage\.addEventListener\(\s*"pointerdown",[\s\S]*?\n    true,\n  \);/.exec(host);
    expect(down).not.toBeNull();
    const body = down![0];
    expect(body).toContain("opts.pauseAndSnap()");
    expect(body.indexOf("opts.pauseAndSnap()")).toBeLessThan(body.indexOf("host.press("));
  });
  test("a slider drag takes pointer capture and releases it", () => {
    expect(host).toMatch(/stage\.setPointerCapture\(e\.pointerId\)/);
    expect(host).toMatch(/stage\.releasePointerCapture\(/);
    expect(host).toMatch(/host\.drag\(/);
    expect(host).toMatch(/host\.release\(/);
  });
  test("the cursor rule: a live row shows a pointer only while paused or gated", () => {
    expect(host).toMatch(/stage\.classList\.toggle\("cs-ctl-hover", /);
    expect(css).toMatch(/\.cs-stage\.cs-ctl-hover \{ cursor: pointer; \}/);
  });
  test("the transient input: sketch font, no border of its own, Enter/blur commit, Escape cancels, stops propagation", () => {
    expect(input).toMatch(/class: "cs-ctlinput"/);
    expect(css).toMatch(/\.cs-ctlinput \{[^}]*font-family: var\(--sketch-font\)/);
    expect(css).toMatch(/\.cs-ctlinput \{[^}]*border: none/);
    expect(input).toMatch(/e\.key === "Enter"/);
    expect(input).toMatch(/e\.key === "Escape"/);
    expect(input).toMatch(/addEventListener\("blur"/);
    expect(input).toMatch(/stopPropagation\(\)/);
    expect(input).toMatch(/clientPointFor\(stage, \[/);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/controls-host-stage.test.ts`
Expected: FAIL — `controls-input.ts` missing.

- [ ] **Step 3: The transient input**

`src/ui/controls-input.ts`:
```ts
// The one piece of HTML left in a live control panel (spec 2026-09-15 §3.2):
// a text or number field's value is typed into an <input> laid over the
// DRAWN box — the drawn box is its frame, so the input has no border of its
// own — in the figure's sketch face at the drawn text's size. Enter and blur
// commit, Escape cancels; either way the node is removed. Positioned the way
// ui/code-editor.ts lays its textarea on a pane: the logical box through
// clientPointFor, re-run on resize.
import type { BBox } from "../layout/geometry";
import { clientPointFor, h } from "./dom";

export interface ControlsInputOpts {
  /** The drawn box, logical y-up. */
  box: BBox;
  /** The drawn text's size in logical units; scaled to pixels like the box. */
  fontSize: number;
  value: string;
  numeric: boolean;
  onCommit: (text: string) => void;
  onCancel: () => void;
}

export function mountControlsInput(stage: HTMLElement, opts: ControlsInputOpts): { close: () => void; reposition: () => void } | null {
  const input = h("input", { class: "cs-ctlinput", type: "text", inputmode: opts.numeric ? "decimal" : "text", value: opts.value });
  let done = false;
  const finish = (commit: boolean): void => {
    if (done) return;
    done = true;
    window.removeEventListener("resize", reposition);
    input.remove();
    if (commit) opts.onCommit(input.value);
    else opts.onCancel();
  };
  const reposition = (): void => {
    const tl = clientPointFor(stage, [opts.box.x, opts.box.y + opts.box.h]);
    const br = clientPointFor(stage, [opts.box.x + opts.box.w, opts.box.y]);
    if (!tl || !br) return;
    const hPx = br[1] - tl[1];
    input.style.left = `${tl[0]}px`;
    input.style.top = `${tl[1]}px`;
    input.style.width = `${br[0] - tl[0]}px`;
    input.style.height = `${hPx}px`;
    // The drawn text is fontSize logical units tall; the box is FIELD_H_EM
    // of those — scale the pixel font by the same ratio the box was scaled.
    input.style.fontSize = `${Math.max(11, (opts.fontSize / opts.box.h) * hPx)}px`;
  };
  reposition();
  if (!input.style.left) return null;
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") finish(true);
    else if (e.key === "Escape") finish(false);
    e.stopPropagation();
  });
  input.addEventListener("blur", () => finish(true));
  for (const type of ["pointerdown", "click"] as const) input.addEventListener(type, (e) => e.stopPropagation());
  window.addEventListener("resize", reposition);
  stage.appendChild(input);
  input.focus();
  input.select();
  return { close: () => finish(false), reposition };
}
```
(`ControlsInputOpts.fontSize` replaces the `fontPx` in the interface sketch above — the caller has the logical size.)

CSS, add after the `.cs-codeedit` rules (grep `\.cs-codeedit {` in `src/styles.css`):
```css
/* The live control panel's one HTML piece: a text/number field typed over
   its DRAWN box (ui/controls-input.ts). The drawn box is the frame — no
   border, no background of its own — in the figure's sketch face. */
.cs-ctlinput {
  position: absolute;
  z-index: 25;
  box-sizing: border-box;
  padding: 0 0.3em;
  margin: 0;
  border: none;
  outline: none;
  background: transparent;
  color: var(--ink);
  font-family: var(--sketch-font);
  text-align: center;
}
.cs-stage.cs-ctl-hover { cursor: pointer; }
```

- [ ] **Step 4: The stage listener**

Append to `src/ui/controls-host.ts` (add `import { logicalPoint } from "./dom";` and `import { registerControlRegion } from "./control-press";` at the top):
```ts
export interface AttachOpts {
  playing: () => boolean;
  /** An explore gate holds the run with the tray shut: the panel is live
   *  even though the timeline's state is "playing". */
  gated: () => boolean;
  /** Playing → paused at the boundary, so the gesture lands on settled
   *  geometry (the tray's own one-click path does the same: pause, snap). */
  pauseAndSnap: () => void;
}

/**
 * The stage half: pointer events → the core. A press inside a panel is a
 * control press for controls.ts's play gesture (the registry), pauses the
 * timeline first when it is playing (one click, spec §3.3), and — for a
 * slider — captures the pointer so the knob follows a drag that leaves the
 * row and the release is the panel's, not the figure's.
 */
export function attachControlsHost(stage: HTMLElement, host: ControlsHost, opts: AttachOpts): () => void {
  const live = (): boolean => !opts.playing() || opts.gated();
  const unregister = registerControlRegion(stage, (e) => {
    const p = logicalPoint(stage, e);
    return p !== null && host.panelAt(p) !== null;
  });
  let gesture: SliderGesture | null = null;
  const onDown = (e: PointerEvent): void => {
    if (e.button !== 0) return;
    const p = logicalPoint(stage, e);
    if (!p || host.panelAt(p) === null) return;
    if (opts.playing() && !opts.gated()) opts.pauseAndSnap();
    const q = logicalPoint(stage, e) ?? p; // the snap may have moved the viewBox
    gesture = host.press(q);
    if (gesture) {
      stage.setPointerCapture(e.pointerId);
      e.preventDefault(); // no text selection, no page scroll on touch
    }
  };
  const onMove = (e: PointerEvent): void => {
    const p = logicalPoint(stage, e);
    if (gesture) {
      if (p) host.drag(gesture, p);
      return;
    }
    stage.classList.toggle("cs-ctl-hover", live() && p !== null && host.over(p));
  };
  const onUp = (e: PointerEvent): void => {
    if (!gesture) return;
    const p = logicalPoint(stage, e);
    if (p) host.release(gesture, p);
    gesture = null;
    if (stage.hasPointerCapture(e.pointerId)) stage.releasePointerCapture(e.pointerId);
  };
  stage.addEventListener(
    "pointerdown",
    onDown,
    true,
  );
  stage.addEventListener("pointermove", onMove);
  stage.addEventListener("pointerup", onUp);
  stage.addEventListener("pointercancel", onUp);
  return () => {
    unregister();
    stage.removeEventListener("pointerdown", onDown, true);
    stage.removeEventListener("pointermove", onMove);
    stage.removeEventListener("pointerup", onUp);
    stage.removeEventListener("pointercancel", onUp);
    stage.classList.remove("cs-ctl-hover");
  };
}
```
The pin in Step 1 expects `pauseAndSnap()` before `host.press(` inside the `pointerdown` registration text; with `onDown` as a named function the regex `stage\.addEventListener\(\s*"pointerdown",[\s\S]*?\n    true,\n  \);` will not contain them. Either inline `onDown`'s body in the `addEventListener` call (preferred: matches the pin as written) or change the pin to anchor on `const onDown = (e: PointerEvent): void => \{([\s\S]*?)\n  \};`. Pick one and make test and source agree.

- [ ] **Step 5: Run the pins and tsc**

Run: `npx vitest run tests/controls-host-stage.test.ts tests/controls-host.test.ts && npx tsc --noEmit`
Expected: PASS, tsc clean.

- [ ] **Step 6: Commit**

```bash
git add src/ui/controls-host.ts src/ui/controls-input.ts src/styles.css tests/controls-host-stage.test.ts
git commit -m "Live controls: the stage listener (register the panel as a control region, pause-and-snap on the press, pointer capture for drags) and the transient text input over the drawn box (Task 4)"
```

---

### Task 5: The tray rewired — doors, knob preview, gate with the tray shut, card deleted

**Files:**
- Modify: `src/ui/tray.ts` — imports (:20-60), `controlsCards`/`reflow`/`thawStage`/`clearPreview`/`onState` (:255-272, :420-445, :1369), `controlsDeps.commit` (:392-408), `openControlsInPlace` (:610-660, delete), the stage click handler (:1165-1215), the cursor rule (:1217-1223), `continueNow` (:472-489), the explore gate (:1249-1269), `freezeClick` (:182-194)
- Delete: `src/ui/controls-card.ts`; `.cs-ctlcard*` CSS in `src/styles.css:1930-1957` and the `.cs-ctlcard` half of the dark rule at `:1873`
- Modify: `src/ui/controls-group.ts` (delete `syncControlsGroup` and the `group` parameter's cross-host use is gone; keep the `data-control` attribute — harmless)
- Test: `tests/tray-controls.test.ts` (rewrite the card pins), `tests/controls-card.test.ts` if it exists (delete)

**Interfaces:**
- Consumes: `controlsHostFor`, `attachControlsHost` (Tasks 3–4), `mountControlsInput` (Task 4), `registerContinue` (Task 1), `parseControls`, `applyControls` (`src/code/controls.ts`).
- Produces: nothing new outside tray.ts.

- [ ] **Step 1: Rewrite the pins first**

In `tests/tray-controls.test.ts` delete the tests titled "one controls-group builder, two hosts…", "a pane: controls panel opens its card…", "the card is torn down with the preview", "the card takes keyboard focus…", "a controls card open during playback…", "a control moved in one host syncs…", "the one-click path reflows the card…". Add:
```ts
  test("the drawn panel is the live control: the tray builds the host from its own closures and attaches it (spec 2026-09-15 §3)", () => {
    expect(src).toMatch(/import \{ attachControlsHost, controlsHostFor \} from "\.\/controls-host";/);
    expect(src).toMatch(/const controlsHost = controlsHostFor\(\{/);
    expect(src).toMatch(/attachControlsHost\(stage, controlsHost, \{/);
    expect(src).not.toMatch(/controls-card/);
    expect(src).not.toMatch(/syncControlsGroup/);
    expect(src).not.toMatch(/controlsCards/);
  });
  test("the host is disabled while the tray is open (one live copy at a time)", () => {
    expect(src).toMatch(/enabled: \(\) => tray\.hidden/);
  });
  test("a commit relays the panel from the rewritten script at once (the knob follows the pointer), then the run follows the debounce", () => {
    const i = src.indexOf("const previewKnobs");
    expect(i).toBeGreaterThan(-1);
    const body = src.slice(i, i + 900);
    expect(body).toContain("applyControls(");
    expect(body).toContain("patches.set(el.id, { code");
    expect(body).toContain("requestAnimationFrame");
    const commit = src.slice(src.indexOf("commit: (c, raw, immediate) =>"), src.indexOf("run: () => runControls"));
    expect(commit.indexOf("previewKnobs(")).toBeLessThan(commit.indexOf("runControls("));
  });
  test("a paused click on a pane: controls panel is the host's, not the editor's or the tray's", () => {
    expect(src).toMatch(/if \(el\?\.pane === "controls"\) \{\s*e\.stopPropagation\(\);\s*return;\s*\}/);
  });
  test("the explore beat on a pane: controls script holds the run with the tray SHUT: pause, hook Continue, no open()", () => {
    const i = src.indexOf("hd.timeline.exploreGate =");
    const region = src.slice(i, i + 3000);
    expect(region).toMatch(/const shut = [\s\S]{0,200}pane === "controls"/);
    expect(region).toMatch(/if \(shut\) \{[\s\S]{0,400}hd\.timeline\.pause\(\);[\s\S]{0,400}\}/);
    expect(region).toMatch(/if \(!shut\) open\(\{ filter: step\.params, gated: true/);
  });
  test("Continue through the play gesture: the hook resolves the gate and resumes the paused timeline", () => {
    expect(src).toMatch(/registerContinue\(stage, \(\) => \{[\s\S]{0,300}gateResolve !== null && tray\.hidden[\s\S]{0,300}continueNow\(\);[\s\S]{0,100}return true;/);
    const i = src.indexOf("const continueNow");
    const body = src.slice(i, i + 900);
    expect(body).toMatch(/if \(hd\.timeline\.state === "paused"\) void hd\.timeline\.play\(\);/);
  });
  test("the tray's cursor rule leaves pane: controls panels to the host", () => {
    expect(src).toMatch(/cs-editable[\s\S]{0,300}pane !== "controls"/);
  });
```
Keep the existing "a click during playback on a control-bearing panel pauses first, then opens that script (spec §2.6)" test as is — the tray path for `pane: code` scripts is unchanged.

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/tray-controls.test.ts`
Expected: the new tests FAIL.

- [ ] **Step 3: Delete the card and the cross-host sync**

- `git rm src/ui/controls-card.ts`. If `tests/controls-card.test.ts` exists, `git rm` it too.
- In `src/styles.css` delete the `.cs-ctlcard` comment block and rules (`:1930-1957`, from the comment starting "paper/ink (var(--paper)/var(--ink)) like .cs-paramtray" through `.cs-ctlcard-chin button:hover { … }`), and change `:1873` to `:root[data-theme="dark"] .cs-paramtray { border-color: var(--line); }` (Task 6 removes that border altogether; leave the rule for now so this commit stays green).
- In `src/ui/controls-group.ts` delete `export function syncControlsGroup` and its doc comment. Keep `commit`'s `group` parameter in `ControlsGroupDeps` (the builder passes it; tray.ts will ignore it).
- In `src/ui/tray.ts`:
  - remove the `mountControlsCard`/`ControlsCardHandle` import and the `syncControlsGroup` import (`import { buildControlsGroup, type ControlsGroupDeps } from "./controls-group";`);
  - delete `const controlsCards = …` and its comment; in `thawStage` use `if (!tray.hidden || editors.size > 0) return;`; in `reflow` drop the card lines and the `controlsCards.size === 0` clause; in `clearPreview` delete the card loop and its comment; in `onState` use `(!tray.hidden || editors.size > 0)`;
  - delete `openControlsInPlace` whole;
  - in `freezeClick` drop the `.cs-ctlcard` line;
  - in `controlsDeps.commit` delete the "Two hosts, one script" comment and the `for (const g of controlGroups…) syncControlsGroup` loop.

- [ ] **Step 4: The knob preview on commit**

Above `controlsDeps` in tray.ts add:
```ts
  /** A control moved: relay the DRAWN panel from the rewritten script right
   *  away — the knob lands under the pointer on this frame — while the run
   *  itself waits for the language's debounce (`runControls`). The patch
   *  keeps the last result, so only the panel changes until the run lands;
   *  coalesced to one repaint per frame, since a drag commits per move. */
  let knobFrame: number | null = null;
  const previewKnobs = (el: SpecElement, authoredCode: string, controls: ControlSpec[]): void => {
    if (el.pane !== "controls") return;
    const values = controlValues.get(el.id) ?? {};
    const code = applyControls(el.language ?? "python", authoredCode, controls, values);
    const result = patches.get(el.id)?.result ?? el.code_result ?? "";
    patches.set(el.id, { code, result });
    if (knobFrame !== null) return;
    knobFrame = requestAnimationFrame(() => {
      knobFrame = null;
      repaint();
    });
  };
```
and in `controlsDeps.commit`, after `controlValues.set(el.id, next);`:
```ts
      previewKnobs(el, authoredCode, controls);
      runControls(el, controls, immediate);
```
Check how `patches` is typed (`Map<string, { code: string; result: string }>`) and that `applyControls` is already imported (it is, for `runControls`).

- [ ] **Step 5: Build and attach the host**

After `continueNow` and `paneBoxOf`/`visibleNow` are defined (they are consts; place the host after `visibleNow`), add:
```ts
  /** The drawn control panels, live (spec 2026-09-15 §3): the host reads the
   *  painted geometry and commits through the SAME closures the tray's rows
   *  use — one state, one look. Disabled while the tray is open, so there is
   *  one live copy at a time. */
  const controlPanels = editable
    .filter((e) => e.pane === "controls" && Array.isArray(e.controls) && e.controls.length > 0)
    .map((el) => {
      const authoredEl = (hd.authored.elements ?? []).find((e) => e.id === el.id);
      const src = authoredEl?.code ?? el.code_src ?? el.code ?? "";
      return { el, authoredCode: src, controls: parseControls(el.language ?? "python", src, el.controls ?? []).controls };
    })
    .filter((p) => p.controls.length > 0);
  let ctlInput: { close: () => void } | null = null;
  const controlsHost = controlsHostFor({
    panels: () => controlPanels,
    layout: () => hd.timeline.paintedLayout() ?? hd.layout,
    visible: visibleNow,
    enabled: () => tray.hidden,
    commit: (el, c, raw, immediate) => {
      const p = controlPanels.find((x) => x.el.id === el.id);
      if (!p) return;
      controlsDeps(el, p.authoredCode, p.controls).commit(c, raw, immediate, tray);
    },
    run: (el) => {
      const p = controlPanels.find((x) => x.el.id === el.id);
      if (p) runControls(el, p.controls, true, true);
    },
    editText: (el, c, box) => {
      if (!stage) return;
      ctlInput?.close();
      const p = controlPanels.find((x) => x.el.id === el.id);
      if (!p) return;
      const current = controlValues.get(el.id)?.[c.name] ?? c.default;
      ctlInput = mountControlsInput(stage, {
        box,
        fontSize: el.font_size ?? 17,
        value: String(current),
        numeric: c.kind === "number",
        onCommit: (text) => {
          ctlInput = null;
          controlsDeps(el, p.authoredCode, p.controls).commit(c, text, true, tray);
        },
        onCancel: () => {
          ctlInput = null;
        },
      });
    },
  });
  if (stage && controlPanels.length > 0) {
    attachControlsHost(stage, controlsHost, {
      playing: () => hd.timeline.state === "playing",
      gated: () => gateResolve !== null,
      pauseAndSnap: () => {
        hd.timeline.pause();
        hd.timeline.renderUpTo(hd.timeline.position);
      },
    });
  }
```
Check the element's font-size field name in `src/spec/types.ts` (grep `font_size`) and the default the code pane uses in `src/layout/code.ts` (grep `fontSize =`); use those. `controlsDeps(...).commit`'s fourth argument is the group node — pass `tray` (any element; the sync loop that used it is gone). Add the imports: `import { attachControlsHost, controlsHostFor } from "./controls-host";`, `import { mountControlsInput } from "./controls-input";`, `import { registerContinue } from "./control-press";`. Also close `ctlInput` in `clearPreview` (`ctlInput?.close(); ctlInput = null;`).

- [ ] **Step 6: The doors**

In the stage click handler (the one registered with `true` after `const screenAt`):
- Playing branch: leave as is. It only fires for a click whose press did NOT begin on a panel (the host paused on pointerdown, so by click time the state is "paused" and this branch is skipped; for a `pane: code` script with controls nothing changes).
- Paused branch: replace
```ts
        const el = editable.find((x) => x.id === id);
        if (el && el.pane === "controls" && openControlsInPlace(el)) return;
        if (el && openInPlace(el)) return;
```
  with
```ts
        const el = editable.find((x) => x.id === id);
        // A `pane: controls` panel is the host's (ui/controls-host.ts): the
        // press already did the object's natural action. Nothing to open.
        if (el?.pane === "controls") {
          e.stopPropagation();
          return;
        }
        if (el && openInPlace(el)) return;
```
- Cursor rule: change the `cs-editable` toggle to exclude panels:
```ts
      const over = screenAt(e);
      const overPanel = over !== null && editable.find((x) => x.id === over)?.pane === "controls";
      stage.classList.toggle("cs-editable", paused && !overPlay && over !== null && !overPanel);
```
  (the pin expects the text `pane !== "controls"` within 300 chars of `cs-editable`; write it as `editable.find((x) => x.id === over)?.pane !== "controls"` instead — one expression, then `!overPlay && over !== null && notPanel`).

- [ ] **Step 7: The explore gate with the tray shut, and Continue**

Replace the tail of `hd.timeline.exploreGate` (from `const onAbort` to the closing of the promise) with:
```ts
      // A `pane: controls` script's beat holds the run with the tray SHUT
      // (spec 2026-09-15 §3.3): the drawn panel is live, the caption carries
      // the invitation, and Continue is the play gesture — the bar's ▶ or a
      // click on the figure outside the panel — through the registry hook.
      const shut = step.code !== undefined && editable.find((e) => e.id === step.code)?.pane === "controls";
      const onAbort = (): void => {
        gateResolve = null;
        closeEditors();
        clearPreview();
        close();
        resolve();
      };
      signal.addEventListener("abort", onAbort);
      gateResolve = () => {
        signal.removeEventListener("abort", onAbort);
        resolve();
      };
      if (shut) {
        // Paused, not merely waiting: the bar shows ▶, and a click anywhere
        // on the drawing is Continue (tryContinue in controls.ts), never a
        // stray resume into a still-pending gate.
        hd.timeline.pause();
      }
      if (!shut) open({ filter: step.params, gated: true, code: step.code, anatomy: step.anatomy, space: step.space });
```
Delete the old `if (step.code !== undefined) { … openControlsInPlace(el); }` block. In `continueNow`'s gate branch, after `r();` add:
```ts
      if (hd.timeline.state === "paused") void hd.timeline.play(); // the shut-tray gate paused the timeline
```
Register the hook once, after the host is attached:
```ts
  if (stage) {
    registerContinue(stage, () => {
      if (gateResolve !== null && tray.hidden) {
        continueNow();
        return true;
      }
      return false;
    });
  }
```
Check `hd.timeline.pause()` is safe when the state is already not "playing" (it returns early — yes, `player.ts:371`). Note: `pause()` sets `pausedFlag`; `play()` then resumes mid-step, and since `r()` already resolved the gate the step completes and the loop continues.

- [ ] **Step 8: Run everything**

Run: `npx vitest run && npx tsc --noEmit`
Expected: PASS, tsc clean. Expect other pin tests to reference the card (`grep -rn "ctlcard\|controls-card\|openControlsInPlace\|syncControlsGroup" tests/`); fix each by deleting the pin or pointing it at the host equivalent from this task's Step 1.

- [ ] **Step 9: Commit**

```bash
git add -A src/ui src/styles.css tests
git commit -m "Live controls: the tray hands its panels to the host — knob preview on commit, paused click is the host's, explore holds with the tray shut and Continue rides the play gesture; the HTML card and the two-host sync are deleted (Task 5)"
```

---

### Task 6: Chrome, help and the smoke list

**Files:**
- Modify: `src/styles.css:1853-1866` (`.cs-paramtray`), `:1873` (dark rule), `:1875-1883` (`.cs-popped`)
- Modify: `public/help.html:364,366`
- Modify: `ROADMAP.md` (one entry)
- Create: `docs/superpowers/plans/2026-09-15-live-controls-smoke.md`
- Test: `tests/tray-chrome.test.ts` (new pin)

- [ ] **Step 1: Write the failing pin**

`tests/tray-chrome.test.ts`:
```ts
// The tray is chrome under the bar, not a drawing (Hans 2026-09-15: the
// hand-drawn box around it "is ugly"). Paper, ink and the sketch face stay;
// the sketchy border and the scroll box go.
import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";

const css = readFileSync("src/styles.css", "utf8");
const rule = (sel: string): string => {
  const i = css.indexOf(`\n${sel} {`);
  expect(i, `${sel} rule must exist`).toBeGreaterThan(-1);
  return css.slice(i, css.indexOf("}", i));
};

describe("tray chrome", () => {
  test("docked: a plain top edge, no sketchy radius", () => {
    const r = rule(".cs-paramtray");
    expect(r).toMatch(/border-top: 1px solid var\(--line\)/);
    expect(r).not.toMatch(/border-radius: 255px/);
    expect(r).not.toMatch(/overflow: auto/);
  });
  test("popped out: a plain 1px line, still resizable", () => {
    const r = rule(".cs-paramtray.cs-popped");
    expect(r).toMatch(/border: 1px solid var\(--line\)/);
    expect(r).toMatch(/resize: both/);
  });
  test("no rule anywhere carries the sketchy-box radius for tray chrome", () => {
    expect(css).not.toMatch(/\.cs-ctlcard/);
    expect(css).not.toMatch(/:root\[data-theme="dark"\] \.cs-paramtray/);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/tray-chrome.test.ts`
Expected: FAIL.

- [ ] **Step 3: Change the CSS**

`.cs-paramtray`: replace `border: 1.5px solid var(--ink);` and the `border-radius` line with `border: none;` and `border-top: 1px solid var(--line);`; keep `margin-top: -1px`. Update its comment ("Looks like the figure … a hand-drawn border" → "paper, ink and the sketch face; a plain top edge — chrome, not a drawing (2026-09-15)"). Delete the `:root[data-theme="dark"] .cs-paramtray { … }` rule and its comment block (the border it softened is gone). `.cs-paramtray.cs-popped`: add `border: 1px solid var(--line);` and keep `resize: both; overflow: auto` (the popped palette is the one place the browser's resize needs overflow). Run `npx vitest run tests/palette.test.ts` — it pins the number of dark media blocks; this change touches none.

- [ ] **Step 4: Help, ROADMAP, smoke list**

`public/help.html:364` (explore row): replace "Opens the ⊕ slider tray from the storyboard itself and waits for Continue" with "Holds the lesson for the viewer: with a <code>pane: controls</code> script the drawn knobs are live and the tray stays shut — press ▶ or click the figure to continue; otherwise the ⊕ tray opens". Keep "Videos skip the whole beat."

`public/help.html:366` (controls row): replace the two sentences from "With <code>pane: controls</code> the pane draws the knobs" to the end with: "With <code>pane: controls</code> the pane draws the knobs instead of the code, and the drawn knobs are the controls: while paused, drag a slider, click a chip or a switch, or click a box to type. A click on the panel while the lesson plays pauses it on the same press. <code>autorun: false</code> adds a drawn Run ▶ row. The movie shows the panel at its defaults."

`ROADMAP.md`: add under the current round's heading (follow the file's existing entry shape):
"- 2026-09-15 Live drawn controls (stage 1 of `docs/superpowers/specs/2026-09-15-live-controls-sweep-movie-design.md`): the `pane: controls` panel is the control; HTML card, tray-on-pause and the sketchy tray border removed; panel text in the sketch face; drawn Run ▶ row. Next: stage 2 (the `run` sweep + explore demo), stage 3 (`#movie`)."

`docs/superpowers/plans/2026-09-15-live-controls-smoke.md`:
```markdown
# Live drawn controls — smoke (Hans)

App, SIR example (pane: controls), light then dark mode:

1. Play. Mid-playback, press on the beta track. The cast pauses on that press and the knob is already under the pointer; drag — the knob follows; on release the curve re-runs (Python debounce).
2. Let the explore beat arrive. The lesson stops with the panel live and the tray SHUT; the bar shows ▶. Drag a knob: the drawn knob and the curve follow. Press ▶ (or click the figure outside the panel): the lesson continues from the beat.
3. While paused (not at the beat): a click on the figure resumes; a click on the panel does not — it moves a knob.
4. Markov cohort: the `days` number box — click, type 40, Enter; the box shows 40 and the run follows. Escape on a fresh click cancels.
5. A choice chip and a toggle: one click each, the fill/knob moves at once.
6. `autorun: false` (edit an example's YAML): the drawn Run ▶ row runs.
7. Export the movie: the panel is drawn at its defaults, no invitation, no gate.
8. Mobile (or DevTools touch): a slider drag does not scroll the page.
9. The ⊕ tray opened by hand: no hand-drawn border, no scrollbar; its rows still work; while it is open the drawn panel ignores presses.
10. `?perf` in the URL, cache cleared (DevTools → Application → IndexedDB → delete): the console shows the boot/install/run timings (Task 7).
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run tests/tray-chrome.test.ts tests/palette.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/styles.css public/help.html ROADMAP.md docs/superpowers/plans/2026-09-15-live-controls-smoke.md tests/tray-chrome.test.ts
git commit -m "Live controls: the tray is chrome, not a drawing (plain top edge, no sketchy box); help rows, ROADMAP, smoke list (Task 6)"
```

---

### Task 7: Perf timings, the measurement, and warm-up only if warranted

**Files:**
- Create: `src/code/perf.ts`
- Modify: `src/code/run.ts:87-105` (`defaultRunner`), `src/code/pyodide.ts:61-88` (`bootPyodide`), `:106-125` (package install), `:248` (the exec), `src/code/webr.ts:80` (the import) and `:102` (`ensurePackages`)
- Maybe create: `src/viewer.ts` warm-up beside `:688` — only if Step 4's measurement says boot or install dominates
- Test: `tests/perf.test.ts`

**Interfaces:**
- Produces: `perfEnabled(): boolean` (true when `location.search` contains `perf`); `perfSpan(label: string): () => void` — returns an `end` function that logs `[perf] <label> <ms> ms` when enabled, no-op otherwise.

- [ ] **Step 1: Write the failing test**

`tests/perf.test.ts`:
```ts
import { describe, expect, test, vi } from "vitest";
import { perfEnabled, perfSpan } from "../src/code/perf";

describe("perf spans", () => {
  test("off outside a ?perf page: no log", () => {
    expect(perfEnabled()).toBe(false); // node: no location
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    perfSpan("x")();
    expect(info).not.toHaveBeenCalled();
    info.mockRestore();
  });
  test("on: one line per span with the label and a millisecond count", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const end = perfSpan("pyodide boot", true);
    end();
    expect(info).toHaveBeenCalledTimes(1);
    expect(String(info.mock.calls[0][0])).toMatch(/^\[perf\] pyodide boot \d+(\.\d+)? ms$/);
    info.mockRestore();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/perf.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

`src/code/perf.ts`:
```ts
// Where does the first knob's wait go? (spec 2026-09-15 §3.6: measure before
// warming anything.) `?perf` on the page turns these spans into console
// lines: runtime chunk import, interpreter boot, package installs, the run
// itself. Off, they cost one boolean.
export function perfEnabled(): boolean {
  return typeof location !== "undefined" && /[?&]perf(=|&|$)/.test(location.search);
}

/** Start a span; call the returned function to end it. `force` is for tests. */
export function perfSpan(label: string, force = false): () => void {
  if (!force && !perfEnabled()) return () => undefined;
  const t0 = performance.now();
  return () => console.info(`[perf] ${label} ${(performance.now() - t0).toFixed(1)} ms`);
}
```
Wrap, in each file, with `const end = perfSpan("…"); … end();` in a `finally` where the wrapped call can throw:
- `run.ts` `defaultRunner`: around the dynamic `import()` — label `runtime import ${req.language}`; around the runtime's run call — label `run ${req.language}`.
- `pyodide.ts` `bootPyodide`: around the boot promise body — `pyodide boot`; the package install helper (`:106-125`) — `install ${pkg}`; the exec at `:248` — `python exec`.
- `webr.ts`: the import at `:80` — `webr import`; `ensurePackages` — `webr packages`; the `captureR` call — `r exec`.
Read each site before editing; keep the existing control flow. `tests/pyodide*.test.ts` / `tests/webr*.test.ts` may pin source text — run them.

- [ ] **Step 4: Measure**

Run the dev server (`npm run dev`, note the port), open the SIR example with `?perf` appended to the URL, clear IndexedDB (DevTools → Application → Storage → IndexedDB → delete the drawcast database) and reload. Play, click the beta track, drag. Record the console lines in `docs/superpowers/plans/2026-09-15-live-controls-smoke.md` under a new heading "Measured 2026-09-15": one line per span. Then decide:
- If `runtime import` + `pyodide boot` + `install *` together exceed 300 ms **at the first knob** (not at page load — they may already have run in the render's ensure phase, in which case they will not appear at the knob at all): do Step 5.
- Otherwise write "warm-up not warranted: the boot happens in the ensure phase; the first knob's wait is `run python` at N ms" in the smoke file and skip Step 5.
If this cannot be run (no browser in the executor's environment), say so in the smoke file and leave Step 5 for Hans's smoke to decide; do not build it blind.

- [ ] **Step 5 (conditional): Warm-up at play**

In `src/viewer.ts` beside `speech.prefetch` (`:688`):
```ts
    // Runtimes for scripts the viewer can touch (controls, an explore beat)
    // boot in the background once play starts — a plain code pane never
    // needs one (its result is baked). Idle priority: after the first frame.
    const langs = warmLanguages(playlist);
    if (langs.length > 0) (window.requestIdleCallback ?? ((f: () => void) => setTimeout(f, 500)))(() => void warmRuntimes(langs));
```
with, in `src/code/run.ts`:
```ts
/** Boot the runtime chunks for these languages without running anything. */
export async function warmRuntimes(languages: string[]): Promise<void> {
  for (const language of languages) {
    const end = perfSpan(`warm ${language}`);
    try {
      if (language === "python") (await import("./pyodide")).bootPyodide();
      else if (language === "r") await (await import("./webr")).bootWebR();
    } catch {
      /* a warm-up never surfaces an error; the real run reports its own */
    } finally {
      end();
    }
  }
}
```
and a pure `warmLanguages(playlist)` in `src/playlist/` (grep how `playlistSpeakLines` walks the playlist and mirror it): the distinct `language` of every code element that has `controls`, plus every language named by an `explore.code` command's element. Test it in `tests/warm-languages.test.ts`: a playlist with a plain code pane → `[]`; with a `controls` script → `["python"]`; two scripts, one R with an explore beat → `["python", "r"]`, no duplicates. Check `webr.ts` for its boot function's real name before calling it.

- [ ] **Step 6: Run the tests**

Run: `npx vitest run && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/code/perf.ts src/code/run.ts src/code/pyodide.ts src/code/webr.ts tests/perf.test.ts docs/superpowers/plans/2026-09-15-live-controls-smoke.md
git commit -m "Live controls: ?perf spans on import/boot/install/run, the first-knob measurement recorded, warm-up only where it was warranted (Task 7)"
```
(Add `src/viewer.ts` and the warm-languages files if Step 5 ran.)

---

### Task 8: Whole-branch review, tsc, merge and push

**Files:** none new.

- [ ] **Step 1: Full suite and typecheck**

Run: `npx vitest run && npx tsc --noEmit && npm run build`
Expected: all green; the build's `vite build` succeeds.

- [ ] **Step 2: Grep for leftovers**

Run: `grep -rn "ctlcard\|controls-card\|openControlsInPlace\|syncControlsGroup\|controlsCards" src tests public docs/superpowers/plans/2026-09-15-live-controls.md`
Expected: matches only inside this plan and the spec's history sections. Fix any in `src`/`tests`/`public`.

- [ ] **Step 3: Read the diff as a reviewer**

Run: `git diff main...HEAD --stat` and read `git diff main...HEAD -- src/ui/tray.ts src/ui/controls-host.ts`. Look for: a `pane: controls` script with `show: output` (no pane → `panelAt` never matches → the tray's group is the only door: correct); a control named so that `${id}_ctl_${name}__` prefixes another row's id (`n` and `n2`: `sim_ctl_n__` does not prefix `sim_ctl_n2__` — fine); the transient input left behind on `clearPreview` (closed in Task 5 Step 5); the gate hook firing while the tray is open (it checks `tray.hidden`).

- [ ] **Step 4: Merge to main and push**

```bash
git fetch origin
git merge --no-ff origin/main   # take main's newer commits, resolve nothing in the widget files (we did not touch them)
npx vitest run && npx tsc --noEmit
git push origin worktree-live-controls
```
Then, from the main checkout (`/Users/hom/Documents/GitHub/drawcast`), merge and push:
```bash
git merge --no-ff worktree-live-controls
npx vitest run && npx tsc --noEmit
git push origin main
```
Report "pushed and live on drawcast.melberg.app once Netlify's deploy state is ready" — check `netlify api listSiteDeploys` (or the Netlify UI) for state `ready` before saying live, per the repo's deploy rule.

---

## Self-review notes

- Spec §3.1 gestures: Task 3 (slider/choice/toggle/button/text/number, Run row). Pointer capture, cursor: Task 4. §3.2 transient input: Task 4. §3.3 doors: Task 5 Steps 6–7. §3.4 exemption: Task 1 + Task 4 registration. §3.5 deletions/font/chrome: Tasks 2, 5, 6. §3.6 warm-up measured first: Task 7. §3.7 tests: each task; the "deletion pin" is Task 8 Step 2 plus the tray-controls pins. §3.8 smoke: Task 6.
- Not in this stage, by the spec: keyboard adjustment; `show: output` scripts keep the tray group.
- Player untouched: the gate change lives in tray.ts's `exploreGate` implementation, and `pause()`/`play()`/`renderUpTo` are existing public methods.
