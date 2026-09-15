# Template Box Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every template accepts `params.box` (a region name or a rectangle) and shares the canvas with a code panel or freehand elements, with text held at the lint's readable floor.

**Architecture:** A template lays out on the full 1000 × 750 canvas as today; a new pure module `src/layout/template-fit.ts` then scales and centres its output (drawables, label requests, anchors, curve samples) into the box with the existing `fitTransform`/`scaleDrawables` helpers, flooring every text size at the lint's `FONT_FLOOR`. `layoutSpec` resolves the box, hands a rectangle to the five templates that lay themselves out natively (bar_chart, line_chart, scatter_plot, heatmap, data_table), fits everyone else, records the fit on the `LayoutResult`, and composes it into the domain mapping so freehand elements and widgets placed in domain units still land on the fitted figure. The figure split's default now applies to all templates. A `fit-scale` lint warns when the box was too small.

**Tech Stack:** TypeScript, Vite, Vitest (`npx vitest run <file>`), Ajv for params, YAML template packs. Netlify runs `npm test && npm run build` (tsc), so `npm run build` must pass before the branch is pushed.

**Spec:** `docs/2026-09-15-template-box-spec.md` — read it first. This plan argues from it.

## Global Constraints

- Worktree: `.claude/worktrees/template-box`, branch `worktree-template-box`, based on origin/main at 633242a (widgets-4 has merged; only `worktree-sweep` is still locked and it touches only `src/render/sweep.ts`). Run everything from the worktree; never `cd` to the main checkout.
- Do NOT edit `src/ui/controls.ts`, `src/ui/widget-host.ts`, `src/render/sweep.ts`.
- Text floor constant: reuse `FONT_FLOOR` (= 14) exported from `src/lint/lint.ts`. Do not add a second constant.
- Uniform scale only; stroke widths untouched; a template that declares `box` in its `params_schema` is never fitted.
- A spec without `params.box` and without a code element must lay out exactly as before. The examples gate (`tests/examples.test.ts`) and the whole suite (7773 tests at baseline) prove it: run `npm test` before the final commit and again after merging origin/main.
- Prompt sync rule (Hans 2026-09-10): the schema description, the compiler prompt paragraph and the prompt-size re-pin land in ONE commit (Task 6).
- Commit after every task with a message in the repo's style (a sentence saying what and why, no conventional-commit prefix), ending with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Coordinates: the logical canvas is 1000 wide, 750 high; `fitRegion("left")` = `{x: 60, y: 95, w: 420, h: 560}`, `"right"` = `{x: 520, y: 95, w: 420, h: 560}`, `"top"` = `{x: 60, y: 395, w: 880, h: 260}`, `"bottom"` = `{x: 60, y: 95, w: 880, h: 260}`, `"full"` = `{x: 60, y: 95, w: 880, h: 560}` (`src/layout/regions.ts`).

---

### Task 1: The pure fit — `template-fit.ts`

**Files:**
- Create: `src/layout/template-fit.ts`
- Modify: `src/layout/place.ts` (add `mapPoints` next to `shiftPoints`, line ~340)
- Test: `tests/template-fit.test.ts`

**Interfaces:**
- Consumes: `fitTransform(union, target)` and `scaleDrawables(ds, s, dx, dy)` from `src/layout/place.ts`; `fitRegion`, `isFitName` from `src/layout/regions.ts`; `unionBBoxForId`, `unionBoxes` from `src/layout/boxes.ts`; `FONT_FLOOR` from `src/lint/lint.ts`; `SceneLayout` from `src/scenes/types.ts`; `LabelRequest` from `src/layout/labels.ts`.
- Produces:
  ```ts
  export interface TemplateFit { s: number; dx: number; dy: number; box: BBox }
  export function resolveTemplateBox(v: unknown): BBox | null   // name → region, valid rect → copy, else null
  export function fitSceneLayout(scene: SceneLayout, box: BBox, measure: MeasureFn): TemplateFit | null  // mutates scene; null when it has no ink
  export function floorTextSizes(ds: Drawable[]): void          // recursive, max(fontSize, FONT_FLOOR)
  export const FIT_PAD = 24                                     // union padding, logical units
  // place.ts
  export function mapPoints(rec: Record<string, Pt> | undefined, map: (p: Pt) => Pt): void
  ```

- [ ] **Step 1: Write the failing test**

Create `tests/template-fit.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { fitSceneLayout, floorTextSizes, resolveTemplateBox, FIT_PAD } from "../src/layout/template-fit";
import { fitRegion } from "../src/layout/regions";
import { heuristicMeasure } from "../src/layout/measure";
import { FONT_FLOOR } from "../src/lint/lint";
import { resolveStyle } from "../src/layout/resolve";
import type { SceneLayout } from "../src/scenes/types";
import type { Drawable, TextDrawable, StrokeDrawable } from "../src/layout/model";
import type { LabelRequest } from "../src/layout/labels";

// A toy scene: a 400 × 200 rectangle of ink at (100, 100), a 30-unit
// text at its centre, a label anchored at its right edge, one anchor
// and one curve sample — everything a template can hand back.
function scene(): SceneLayout {
  const rect: StrokeDrawable = {
    id: "body", kind: "stroke", z: 1, pts: [[100, 100], [500, 100], [500, 300], [100, 300]], closed: true,
    style: resolveStyle(undefined, {}),
  } as StrokeDrawable;
  const text: TextDrawable = { id: "t", kind: "text", z: 2, pos: [300, 200], text: "S", fontSize: 30, anchor: "middle", style: resolveStyle(undefined, {}) } as TextDrawable;
  const label = { id: "lab", anchor: [500, 200], side: "right", text: "Susceptible", fontSize: 17 } as unknown as LabelRequest;
  return {
    drawables: [rect, text],
    labels: [label],
    anchors: { body_center: [300, 200] },
    order: ["body", "t", "lab"],
    curveSamples: { curve: [[100, 100], [500, 300]] },
  };
}

describe("resolveTemplateBox", () => {
  test("a region name resolves to that region", () => {
    expect(resolveTemplateBox("right")).toEqual(fitRegion("right"));
  });
  test("a rectangle is accepted as a copy, anything else is null", () => {
    const r = { x: 10, y: 20, w: 300, h: 200 };
    const out = resolveTemplateBox(r);
    expect(out).toEqual(r);
    expect(out).not.toBe(r);
    expect(resolveTemplateBox("middle")).toBeNull();
    expect(resolveTemplateBox({ x: 10, y: 20, w: 0, h: 200 })).toBeNull();
    expect(resolveTemplateBox({ x: 10, y: 20 })).toBeNull();
    expect(resolveTemplateBox(undefined)).toBeNull();
    expect(resolveTemplateBox(42)).toBeNull();
  });
});

describe("fitSceneLayout", () => {
  test("scales the ink union (padded) uniformly into the box and centres it", () => {
    const sc = scene();
    const box = { x: 520, y: 95, w: 420, h: 560 };
    const fit = fitSceneLayout(sc, box, heuristicMeasure)!;
    // union = rect padded by FIT_PAD: (100-24, 100-24) to (500+24, 300+24) → 448 × 248
    const s = Math.min(box.w / (400 + 2 * FIT_PAD), box.h / (200 + 2 * FIT_PAD));
    expect(fit.s).toBeCloseTo(s, 6);
    expect(fit.box).toEqual(box);
    const rect = sc.drawables[0] as StrokeDrawable;
    const xs = rect.pts.map((p) => p[0]), ys = rect.pts.map((p) => p[1]);
    // width-limited: the padded union spans the box width; the ink is inset by the pad
    expect(Math.min(...xs)).toBeCloseTo(box.x + FIT_PAD * s, 3);
    expect(Math.max(...xs)).toBeCloseTo(box.x + box.w - FIT_PAD * s, 3);
    // centred vertically
    expect((Math.min(...ys) + Math.max(...ys)) / 2).toBeCloseTo(box.y + box.h / 2, 3);
  });

  test("text, labels, anchors and curve samples travel with the ink", () => {
    const sc = scene();
    const box = { x: 520, y: 95, w: 420, h: 560 };
    const { s, dx, dy } = fitSceneLayout(sc, box, heuristicMeasure)!;
    const m = ([x, y]: [number, number]) => [x * s + dx, y * s + dy];
    expect((sc.drawables[1] as TextDrawable).pos).toEqual(m([300, 200]));
    expect(sc.labels[0].anchor).toEqual(m([500, 200]));
    expect(sc.anchors.body_center).toEqual(m([300, 200]));
    expect(sc.curveSamples!.curve).toEqual([m([100, 100]), m([500, 300])]);
  });

  test("text shrinks with the figure but never below FONT_FLOOR; labels likewise", () => {
    const sc = scene();
    const { s } = fitSceneLayout(sc, { x: 520, y: 95, w: 420, h: 560 }, heuristicMeasure)!;
    expect(s).toBeLessThan(1);
    const t = sc.drawables[1] as TextDrawable;
    expect(t.fontSize).toBeCloseTo(Math.max(FONT_FLOOR, 30 * s), 6);
    // 17 * s would be below the floor for this box; the label holds at the floor
    expect(17 * s).toBeLessThan(FONT_FLOOR);
    expect(sc.labels[0].fontSize).toBe(FONT_FLOOR);
  });

  test("a box larger than the figure scales UP — a fit is a fit", () => {
    const sc = scene();
    const { s } = fitSceneLayout(sc, { x: 0, y: 0, w: 1000, h: 750 }, heuristicMeasure)!;
    expect(s).toBeGreaterThan(1);
  });

  test("a scene with no ink is left alone and returns null", () => {
    const sc: SceneLayout = { drawables: [], labels: [], anchors: {}, order: [] };
    expect(fitSceneLayout(sc, fitRegion("left"), heuristicMeasure)).toBeNull();
  });
});

describe("floorTextSizes", () => {
  test("walks into groups", () => {
    const inner = { id: "x", kind: "text", z: 2, pos: [0, 0], text: "x", fontSize: 5, anchor: "middle" } as unknown as TextDrawable;
    const ds: Drawable[] = [{ id: "g", kind: "group", z: 2, children: [inner] } as unknown as Drawable];
    floorTextSizes(ds);
    expect(inner.fontSize).toBe(FONT_FLOOR);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/template-fit.test.ts`
Expected: FAIL — `Cannot find module '../src/layout/template-fit'`.

- [ ] **Step 3: Add `mapPoints` to place.ts**

In `src/layout/place.ts`, directly after `shiftPoints` (the function ending `for (const k of Object.keys(rec)) rec[k] = [rec[k][0] + dx, rec[k][1] + dy];`), add:

```ts
/** Map a record of named points in place through any point transform. */
export function mapPoints(rec: Record<string, Pt> | undefined, map: (p: Pt) => Pt): void {
  if (!rec) return;
  for (const k of Object.keys(rec)) rec[k] = map(rec[k]);
}
```

- [ ] **Step 4: Write `src/layout/template-fit.ts`**

```ts
// The template box (docs/2026-09-15-template-box-spec.md): a template lays
// out on the whole canvas as it always has, and this module then fits what
// it returned — drawables, label requests, anchors, curve samples — into the
// box the spec asked for. A DEFAULT plus one transform, not a layout engine:
// the five data templates that declare `box` themselves never come here.
//
// Two rules that are not obvious from the code. Uniform scale only: a figure
// squeezed on one axis is a different figure. And text holds at the lint's
// readable floor while the geometry shrinks — a 15-unit label at half width
// is 7 units, 3 px on a phone — which is what a hand does when it draws the
// same figure small. Labels then take a larger share of the box; the label
// solver moves them and the overlap lints report what no longer fits.

import { FONT_FLOOR } from "../lint/lint";
import type { SceneLayout } from "../scenes/types";
import { unionBBoxForId, unionBoxes } from "./boxes";
import type { BBox } from "./geometry";
import type { MeasureFn } from "./measure";
import type { Drawable, Pt } from "./model";
import { fitTransform, mapPoints, scaleDrawables } from "./place";
import { fitRegion, isFitName } from "./regions";

export interface TemplateFit {
  s: number;
  dx: number;
  dy: number;
  box: BBox;
}

/** Padding around the ink union before fitting — room for the labels the
 *  solver has not placed yet, so they tend to land inside the box too. */
export const FIT_PAD = 24;

/** A region name → its region; a finite positive rectangle → a copy; else null. */
export function resolveTemplateBox(v: unknown): BBox | null {
  if (isFitName(v)) return fitRegion(v);
  if (typeof v !== "object" || v === null) return null;
  const b = v as Record<string, unknown>;
  const ok = ["x", "y", "w", "h"].every((k) => typeof b[k] === "number" && Number.isFinite(b[k] as number));
  if (!ok) return null;
  const { x, y, w, h } = b as { x: number; y: number; w: number; h: number };
  if (!(w > 0) || !(h > 0)) return null;
  return { x, y, w, h };
}

/** Clamp every text size, groups included, to the lint's floor. */
export function floorTextSizes(ds: Drawable[]): void {
  for (const d of ds) {
    if (d.kind === "group") floorTextSizes(d.children);
    else if (d.kind === "text") d.fontSize = Math.max(d.fontSize, FONT_FLOOR);
  }
}

/**
 * Fit the scene's ink into `box` IN PLACE and say what transform did it.
 * Null when the scene drew nothing (nothing to fit; the caller leaves it).
 */
export function fitSceneLayout(scene: SceneLayout, box: BBox, measure: MeasureFn): TemplateFit | null {
  const ids = [...new Set(scene.drawables.map((d) => d.id))];
  const union = unionBoxes(ids.map((id) => unionBBoxForId(scene.drawables, id, measure)));
  if (!union) return null;
  const padded: BBox = { x: union.x - FIT_PAD, y: union.y - FIT_PAD, w: union.w + 2 * FIT_PAD, h: union.h + 2 * FIT_PAD };
  const { s, dx, dy } = fitTransform(padded, box);
  const map = ([x, y]: Pt): Pt => [x * s + dx, y * s + dy];
  scaleDrawables(scene.drawables, s, dx, dy);
  floorTextSizes(scene.drawables);
  for (const l of scene.labels) {
    l.anchor = map(l.anchor);
    l.fontSize = Math.max(l.fontSize * s, FONT_FLOOR);
  }
  mapPoints(scene.anchors, map);
  if (scene.curveSamples) {
    for (const k of Object.keys(scene.curveSamples)) scene.curveSamples[k] = scene.curveSamples[k].map(map);
  }
  return { s, dx, dy, box };
}
```

`resolveStyle(style, base?)` is exported from `src/layout/resolve.ts`. If the `StrokeDrawable`/`TextDrawable` casts in the test complain about a missing required field of `BaseDrawable` (read its fields at `src/layout/model.ts`, `export interface BaseDrawable`), add that field with a neutral value inside the test's object literals rather than loosening the types. `SceneLayout.anchors` is typed non-optional (`anchors: Record<string, Pt>`); `mapPoints` accepts it.

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run tests/template-fit.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 6: Commit**

```bash
git add src/layout/template-fit.ts src/layout/place.ts tests/template-fit.test.ts
git commit -m "Template box: the pure fit — a template's returned layout scaled and centred into a box, text held at the lint's floor (spec §4–5, Task 1)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Wire the fit into `layoutSpec`; the split default for every template

**Files:**
- Modify: `src/layout/layout.ts` (lines 24–58 `LayoutResult`; 84–96 the split; 105–139 the template block; 243–247 `templateTakesBox`; 250–254 `isFigureBox`)
- Test: `tests/template-box.test.ts`

**Interfaces:**
- Consumes: `resolveTemplateBox`, `fitSceneLayout`, `TemplateFit` (Task 1); `figureSplit` unchanged.
- Produces: `LayoutResult.fit?: TemplateFit`; `nativeBox(template)` (the renamed `templateTakesBox`, same body, module-private); `FIT_NAMES` in the invalid-box warning text.

- [ ] **Step 1: Write the failing test**

Create `tests/template-box.test.ts`:

```ts
import { beforeAll, describe, expect, test } from "vitest";
import { layoutSpec, elementBBoxes } from "../src/layout/layout";
import { fitRegion } from "../src/layout/regions";
import { flattenDrawables } from "../src/layout/model";
import { ensureEnabledPacks } from "../src/scenes/packs";
import { FONT_FLOOR } from "../src/lint/lint";
import type { BBox } from "../src/layout/geometry";
import type { Spec } from "../src/spec/types";

const inside = (b: BBox, r: BBox, slack = 0) =>
  b.x >= r.x - slack && b.y >= r.y - slack && b.x + b.w <= r.x + r.w + slack && b.y + b.h <= r.y + r.h + slack;

const CODE = "beta, gamma = 0.3, 0.1\nprint(beta / gamma)";
const sir = (params: object = {}, elements: object[] = []): Spec =>
  ({ template: "sir_compartments", params, elements, commands: [{ draw: ["box_S"] }] }) as unknown as Spec;

beforeAll(async () => {
  await ensureEnabledPacks(["evidence", "data"]);
});

describe("template box — a template without a native box is fitted", () => {
  test("box: \"right\" puts every template drawable inside the right region (labels may spill by one label height)", () => {
    const r = layoutSpec(sir({ box: "right" }));
    expect(r.fit).toBeDefined();
    expect(r.fit!.box).toEqual(fitRegion("right"));
    expect(r.fit!.s).toBeLessThan(1);
    const R = fitRegion("right");
    for (const [id, b] of elementBBoxes(r)) {
      expect(inside(b, R, FONT_FLOOR * 1.25), id).toBe(true);
    }
  });

  test("a rectangle works the same way", () => {
    const box = { x: 100, y: 400, w: 300, h: 200 };
    const r = layoutSpec(sir({ box }));
    expect(r.fit!.box).toEqual(box);
    for (const [id, b] of elementBBoxes(r)) expect(inside(b, box, FONT_FLOOR * 1.25), id).toBe(true);
  });

  test("no text drawn below the floor, so font-too-small never fires on a fitted template", () => {
    const r = layoutSpec(sir({ box: { x: 60, y: 95, w: 200, h: 120 } }));
    for (const d of flattenDrawables(r.drawables)) {
      if (d.kind === "text") expect(d.fontSize, d.id).toBeGreaterThanOrEqual(FONT_FLOOR);
    }
    expect(r.issues.filter((i) => i.rule === "font-too-small")).toEqual([]);
  });

  test("an invalid box is ignored with a warning, and the template keeps the canvas", () => {
    const r = layoutSpec(sir({ box: "middle" }));
    expect(r.fit).toBeUndefined();
    expect(r.warnings.some((w) => /box .*"middle".*left, right, top, bottom, full/.test(w))).toBe(true);
  });

  test("without a box and without a code element nothing is fitted", () => {
    const r = layoutSpec(sir());
    expect(r.fit).toBeUndefined();
    const all = [...elementBBoxes(r).values()];
    const x0 = Math.min(...all.map((b) => b.x)), x1 = Math.max(...all.map((b) => b.x + b.w));
    expect(x1 - x0).toBeGreaterThan(500); // the chain spans most of the canvas, as it always has
  });
});

describe("template box — the split default reaches every template", () => {
  test("a code panel beside sir_compartments gets the split's invented box: no overlap, no lint", () => {
    const r = layoutSpec(sir({}, [{ id: "sim", type: "code", language: "python", show: "code", code: CODE }]));
    expect(r.fit).toBeDefined();
    expect(r.issues.filter((i) => i.rule === "overlap-code-figure")).toEqual([]);
    const code = elementBBoxes(r).get("sim")!;
    // the figure sits to the right of the script
    expect(r.fit!.box.x).toBeGreaterThanOrEqual(code.x + code.w - 1);
  });

  test("a data-only script (show: none) still leaves the template the whole canvas", () => {
    const r = layoutSpec(sir({}, [{ id: "feed", type: "code", language: "python", show: "none", code: CODE }]));
    expect(r.fit).toBeUndefined();
  });
});

describe("template box — a native box is resolved, never fitted", () => {
  const chart = (box: unknown) =>
    layoutSpec({ template: "bar_chart", params: { labels: ["a", "b", "c"], values: [1, 2, 3], box } } as unknown as Spec);

  test("bar_chart given a NAME receives the rectangle and lays itself out in it", () => {
    const r = chart("right");
    expect(r.fit).toBeUndefined();
    const R = fitRegion("right");
    for (const [id, b] of elementBBoxes(r)) {
      if (id === "title") continue;
      expect(inside(b, R, 40), id).toBe(true); // axis labels hang just outside the plot area
    }
    expect(r.issues.filter((i) => i.rule === "fit-scale")).toEqual([]);
  });

  test("bar_chart given a rectangle behaves as it did before this round", () => {
    const box = { x: 470, y: 95, w: 460, h: 560 };
    expect(chart(box).fit).toBeUndefined();
    expect(chart(box).warnings).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/template-box.test.ts`
Expected: FAIL — `r.fit` is undefined in the fitted cases; the sir + code case reports `overlap-code-figure`; the bar_chart name case has ink outside the region (the template saw a string, fell back to the full plot area).

- [ ] **Step 3: Extend `LayoutResult` and wire the fit**

In `src/layout/layout.ts`:

(a) Imports — add after the `figureSplit` import:
```ts
import { fitSceneLayout, resolveTemplateBox, type TemplateFit } from "./template-fit";
import { FIT_NAMES } from "./regions";
```

(b) `LayoutResult` — add after `labelPins: Record<string, LabelPin>;`:
```ts
  /** The template's fit into its box (spec/2026-09-15-template-box): absent
   *  when no box was in play or the template laid itself out in one. */
  fit?: TemplateFit;
```

(c) Replace the split block (from `const codeEl = ...` through `if (split.box) spec.params = ...`) and move `const warnings: string[] = [];` ABOVE it, with:
```ts
  const warnings: string[] = [];
  // A template and a script on screen each get their own half of the canvas
  // before anything is laid out — the default the two used to lack, so a
  // chart no longer lands on top of the code that computed it. Since the
  // template box round every template that lays out can take a box: the
  // five data templates natively, the rest by the fit below.
  const codeEl = (spec.elements ?? []).find((e) => e.type === "code" && e.show !== "none");
  const hasTemplate = !!(spec.template && scenes[spec.template]?.layout);
  const rawBox = (spec.params ?? {})["box"];
  const requestedBox = resolveTemplateBox(rawBox);
  if (rawBox !== undefined && !requestedBox) {
    warnings.push(`template box ${JSON.stringify(rawBox)} is neither a region name (${FIT_NAMES.join(", ")}) nor {x, y, w, h} — ignored`);
  }
  const split = figureSplit({
    hasTemplate,
    templateTakesBox: hasTemplate,
    boxGiven: requestedBox !== null,
    code: codeEl ? { x: codeEl.x, width: codeEl.width, show: codeEl.show, code: codeEl.code, fontSize: codeEl.font_size } : null,
  });
  if (split.code && codeEl) Object.assign(codeEl, split.code);
  const box = requestedBox ?? split.box ?? null;
  const native = nativeBox(spec.template);
  // The five templates that lay themselves out in a box get the RECTANGLE —
  // a name means nothing to them. Everyone else keeps params untouched and
  // is fitted after laying out.
  if (box && native) spec.params = { ...(spec.params ?? {}), box };
  let fit: TemplateFit | undefined;
```
Delete the old `const warnings: string[] = [];` line that followed the split (it is now above).

(d) In the template block, after `const sceneLayout = scene.layout(spec.params ?? {});` and before `templateIds = sceneLayout.order;`, add:
```ts
        if (box && !native) fit = fitSceneLayout(sceneLayout, box, measure) ?? undefined;
```
(The curve-sample inverse mapping that follows already reads `sceneLayout.curveSamples`, now fitted.)

(e) Rename `templateTakesBox` to `nativeBox` (same body; update its doc comment to "Does this template lay itself out in a `box` param? Five data templates do; every other template is fitted by template-fit.ts."). Delete `isFigureBox` (now unused — `resolveTemplateBox` replaces it). Run `grep -n "isFigureBox\|templateTakesBox" src/layout/layout.ts` to confirm no stragglers.

(f) The return statement — add `fit`:
```ts
  return { drawables, order, issues, warnings, windows, panes, pieces, pieceGroups, groups, fitGroups, namedAnchors, measures, labelPins, ...(fit ? { fit } : {}) };
```

- [ ] **Step 4: Run the new test and the neighbours**

Run: `npx vitest run tests/template-box.test.ts tests/figure-split.test.ts tests/data-pack.test.ts tests/group-fit.test.ts tests/examples.test.ts`
Expected: all PASS. If a `template-box` case fails on the label slack, print the offending id and bbox; a label leader (`<id>_leader`) is excluded by `unionBBoxForId` already, so a real failure means the padding or the floor is wrong, not the test.

- [ ] **Step 5: Run the whole suite**

Run: `npm test 2>&1 | tail -6`
Expected: 380+ files, every test passing (7773 + the new ones). A failure in a template test that passes a `box` string today is a real regression: inspect before touching the test.

- [ ] **Step 6: Commit**

```bash
git add src/layout/layout.ts tests/template-box.test.ts
git commit -m "Template box: layoutSpec resolves a name or rectangle, hands the five native templates the rectangle, fits everyone else, and the figure split's default now reaches every template (spec §3–4, Task 2)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Domain coordinates follow the fit — tier-2 and widgets

**Files:**
- Modify: `src/layout/layout.ts` (`domainMapping` line ~330, `inverseDomainMapping` line ~346, the `layoutElements` call line ~142)
- Modify: `src/layout/tier2.ts` (`layoutElements` opts, lines 196–241: `sx`, `sy`, `ix`, `iy`)
- Modify: `src/scenes/widget-scene.ts` (`WidgetSceneOpts.layout` Pick, lines 11–16 and 47–51)
- Test: `tests/template-box.test.ts` (append), `tests/widget-scene-fit.test.ts` (new)

**Interfaces:**
- Consumes: `TemplateFit` (Task 1), `LayoutResult.fit` (Task 2).
- Produces:
  ```ts
  // layout.ts
  export function domainMapping(domain: Spec["domain"], fit?: TemplateFit): { toLogical; deltaToLogical }
  export function inverseDomainMapping(domain: Spec["domain"], fit?: TemplateFit): (p: Pt) => Pt
  // tier2.ts: opts.fit?: TemplateFit
  // widget-scene.ts: layout?: Pick<LayoutResult, "drawables" | "order" | "fit">
  ```

- [ ] **Step 1: Write the failing tests**

Append to `tests/template-box.test.ts`:

```ts
import { domainMapping, inverseDomainMapping } from "../src/layout/layout";
import { plotArea } from "../src/layout/canvas";

describe("template box — domain coordinates follow the fit", () => {
  test("a freehand text at domain (50, 50) lands at the fitted image of the plot centre", () => {
    const r = layoutSpec(sir({ box: "left" }, [{ id: "t", type: "text", text: "here", x: 50, y: 50 }]));
    const { s, dx, dy } = r.fit!;
    const plot = plotArea();
    const cx = (plot.x0 + plot.x1) / 2, cy = (plot.y0 + plot.y1) / 2;
    const b = elementBBoxes(r).get("t")!;
    expect(b.x + b.w / 2).toBeCloseTo(cx * s + dx, 0);
    expect(b.y + b.h / 2).toBeCloseTo(cy * s + dy, 0);
  });

  test("domainMapping and its inverse compose the fit and round-trip", () => {
    const fit = { s: 0.5, dx: 300, dy: 100, box: fitRegion("right") };
    const fwd = domainMapping({ x: [0, 100], y: [0, 100] }, fit);
    const inv = inverseDomainMapping({ x: [0, 100], y: [0, 100] }, fit);
    const plain = domainMapping({ x: [0, 100], y: [0, 100] });
    const p = plain.toLogical([25, 75]);
    expect(fwd.toLogical([25, 75])).toEqual([p[0] * 0.5 + 300, p[1] * 0.5 + 100]);
    const back = inv(fwd.toLogical([25, 75]));
    expect(back[0]).toBeCloseTo(25, 6);
    expect(back[1]).toBeCloseTo(75, 6);
    // deltas scale by s and ignore the offset
    const d = plain.deltaToLogical([10, 10]);
    expect(fwd.deltaToLogical([10, 10])).toEqual([d[0] * 0.5, d[1] * 0.5]);
  });

  test("without a fit both mappings are unchanged", () => {
    const a = domainMapping({ x: [0, 10], y: [0, 10] }).toLogical([5, 5]);
    const b = domainMapping({ x: [0, 10], y: [0, 10] }, undefined).toLogical([5, 5]);
    expect(a).toEqual(b);
  });
});
```

Create `tests/widget-scene-fit.test.ts`:

```ts
import { beforeAll, describe, expect, test } from "vitest";
import { buildWidgetScene } from "../src/scenes/widget-scene";
import { layoutSpec } from "../src/layout/layout";
import { scenes } from "../src/scenes/registry";
import { ensureEnabledPacks } from "../src/scenes/packs";
import { plotArea } from "../src/layout/canvas";
import type { Spec } from "../src/spec/types";

beforeAll(async () => {
  await ensureEnabledPacks(["evidence"]);
});

describe("widget scene — a fitted layout's coordinate converters compose the fit", () => {
  test("toLogical of the domain centre is the fitted plot centre, and toDomain inverts it", () => {
    const domain = { x: [0, 100] as [number, number], y: [0, 100] as [number, number] };
    const layout = layoutSpec({ template: "sir_compartments", params: { box: "right" }, domain } as Spec);
    expect(layout.fit).toBeDefined();
    const sc = buildWidgetScene(scenes.sir_compartments, { box: "right" }, { domain, layout })!;
    const { s, dx, dy } = layout.fit!;
    const plot = plotArea();
    const cx = (plot.x0 + plot.x1) / 2, cy = (plot.y0 + plot.y1) / 2;
    const p = sc.toLogical([50, 50]);
    expect(p[0]).toBeCloseTo(cx * s + dx, 6);
    expect(p[1]).toBeCloseTo(cy * s + dy, 6);
    const d = sc.toDomain(p)!;
    expect(d[0]).toBeCloseTo(50, 6);
    expect(d[1]).toBeCloseTo(50, 6);
  });

  test("boxes come from the layout on screen — the fitted one — not the module's own full-canvas layout", () => {
    const layout = layoutSpec({ template: "sir_compartments", params: { box: "right" } } as Spec);
    const sc = buildWidgetScene(scenes.sir_compartments, { box: "right" }, { layout })!;
    for (const [id, b] of sc.boxes) expect(b.x, id).toBeGreaterThanOrEqual(layout.fit!.box.x - 20);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/template-box.test.ts tests/widget-scene-fit.test.ts`
Expected: FAIL — `domainMapping` ignores its second argument (compose test), the freehand text lands at the standard plot centre, `toLogical` in the widget scene returns the unfitted point.

- [ ] **Step 3: Compose the fit in `layout.ts`**

Replace `domainMapping` and `inverseDomainMapping` with:

```ts
/** Spec domain → logical canvas. With a `fit`, the standard plot area is
 *  where the template's axes WERE; the fit says where they are now. */
export function domainMapping(domain: Spec["domain"], fit?: TemplateFit): { toLogical: (p: Pt) => Pt; deltaToLogical: (d: Pt) => Pt } {
  const s = fit?.s ?? 1, dx = fit?.dx ?? 0, dy = fit?.dy ?? 0;
  const post = ([x, y]: Pt): Pt => [x * s + dx, y * s + dy];
  const postDelta = ([a, b]: Pt): Pt => [a * s, b * s];
  if (!domain) return { toLogical: (p) => post(p), deltaToLogical: (d) => postDelta(d) };
  const plot = plotArea();
  const dX = domain.x ?? [0, 100];
  const dY = domain.y ?? [0, 100];
  const sx = linearScale(dX, [plot.x0, plot.x1]);
  const sy = linearScale(dY, [plot.y0, plot.y1]);
  const fx = (plot.x1 - plot.x0) / (dX[1] - dX[0] || 1);
  const fy = (plot.y1 - plot.y0) / (dY[1] - dY[0] || 1);
  return {
    toLogical: ([x, y]) => post([sx(x), sy(y)]),
    deltaToLogical: ([a, b]) => postDelta([a * fx, b * fy]),
  };
}

/** Logical canvas → spec domain (the inverse of domainMapping, fit included). */
export function inverseDomainMapping(domain: Spec["domain"], fit?: TemplateFit): (p: Pt) => Pt {
  const s = fit?.s ?? 1, dx = fit?.dx ?? 0, dy = fit?.dy ?? 0;
  const plot = plotArea();
  const dX = domain?.x ?? [0, 100];
  const dY = domain?.y ?? [0, 100];
  const ix = linearScale([plot.x0, plot.x1], dX);
  const iy = linearScale([plot.y0, plot.y1], dY);
  return ([x, y]) => [ix((x - dx) / s), iy((y - dy) / s)];
}
```

Note the `!domain` branch: today it returns identity; with a fit it must still apply the fit, which the code above does. Check every existing caller of `domainMapping`/`inverseDomainMapping` (`grep -rn "domainMapping(\|inverseDomainMapping(" src tests`) — they pass one argument and keep working.

In the template block, the curve-sample seeding must NOT double-apply: the samples were already mapped by `fitSceneLayout`, so keep `inverseDomainMapping(spec.domain, fit)` there — that undoes the fit and the plot mapping together, returning true domain values. Change that line to:
```ts
          const inv = inverseDomainMapping(spec.domain, fit);
```

Pass the fit to tier-2 (the `layoutElements` call):
```ts
    const tier2 = layoutElements(spec.elements, spec.domain, seedAnchors, seedCurveSamples, { measure, seedDrawables: [...drawables], vars: spec.vars, overrides, fit });
```

- [ ] **Step 4: Compose the fit in `tier2.ts`**

Add to the `opts` type of `layoutElements`: `fit?: TemplateFit` (import `type { TemplateFit } from "./template-fit"`). Then replace the four scale lines:
```ts
  const fs = opts.fit?.s ?? 1, fdx = opts.fit?.dx ?? 0, fdy = opts.fit?.dy ?? 0;
  const sxStd = linearScale(domainX, [plot.x0, plot.x1]);
  const syStd = linearScale(domainY, [plot.y0, plot.y1]);
  const ixStd = linearScale([plot.x0, plot.x1], domainX);
  const iyStd = linearScale([plot.y0, plot.y1], domainY);
  const ctx: Ctx = {
    sx: (v) => sxStd(v) * fs + fdx,
    sy: (v) => syStd(v) * fs + fdy,
    ...
    ix: (v) => ixStd((v - fdx) / fs),
    iy: (v) => iyStd((v - fdy) / fs),
```
Then grep tier2 for any OTHER place that builds a scale from `plot` directly (`grep -n "plot\.\(x0\|x1\|y0\|y1\)" src/layout/tier2.ts`). Line ~2070 ("domain slope → logical") scales a delta by the y- and x-scale; if it reads `plot` directly rather than `ctx.sx`, multiply that delta by `fs` too. Read it before deciding; do not change what is not a domain→logical conversion.

- [ ] **Step 5: Widen the widget scene's layout type**

In `src/scenes/widget-scene.ts`: `layout?: Pick<LayoutResult, "drawables" | "order" | "fit">;` and in `buildWidgetScene`:
```ts
  const fit = opts.layout?.fit;
  const fwd = domainMapping(opts.domain, fit);
  const inv = opts.domain ? inverseDomainMapping(opts.domain, fit) : null;
```
`widget-host.ts`, `widget-demo.ts` and `body-explore.ts` already pass a full `LayoutResult`, so nothing else changes. Do not edit widget-host.

- [ ] **Step 6: Run the tests**

Run: `npx vitest run tests/template-box.test.ts tests/widget-scene-fit.test.ts tests/anchors.test.ts tests/regions.test.ts tests/region-edge-ref.test.ts tests/examples.test.ts tests/widget-host.test.ts`
Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add src/layout/layout.ts src/layout/tier2.ts src/scenes/widget-scene.ts tests/template-box.test.ts tests/widget-scene-fit.test.ts
git commit -m "Template box: domain coordinates compose the fit — a freehand point on a fitted template's curve and a widget's click both land where the figure now is (spec §6, Task 3)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: The `fit-scale` lint and the reworded overlap hint

**Files:**
- Modify: `src/lint/lint.ts` (rule union lines 10–43; export a constant)
- Modify: `src/layout/layout.ts` (after the fit; `codeFigureOverlap` message)
- Test: `tests/template-box.test.ts` (append)

**Interfaces:**
- Produces: `export const FIT_SCALE_FLOOR = 0.5` in `lint.ts`; rule name `"fit-scale"`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/template-box.test.ts`:

```ts
import { FIT_SCALE_FLOOR } from "../src/lint/lint";

describe("template box — fit-scale lint", () => {
  test("a box too small for the template warns once, naming the scale and the way out", () => {
    const r = layoutSpec(sir({ box: { x: 60, y: 95, w: 200, h: 120 } }));
    expect(r.fit!.s).toBeLessThan(FIT_SCALE_FLOOR);
    const hits = r.issues.filter((i) => i.rule === "fit-scale");
    expect(hits).toHaveLength(1);
    expect(hits[0].severity).toBe("warn");
    expect(hits[0].ids).toEqual(["sir_compartments"]);
    expect(hits[0].message).toMatch(/fitted at 0\.\d+/);
    expect(hits[0].message).toMatch(/taller region|native box/);
  });

  test("a comfortable box does not warn", () => {
    const r = layoutSpec(sir({ box: "full" }));
    expect(r.fit!.s).toBeGreaterThanOrEqual(FIT_SCALE_FLOOR);
    expect(r.issues.filter((i) => i.rule === "fit-scale")).toEqual([]);
  });

  test("the overlap hint now names the region words", () => {
    const r = layoutSpec(sir({}, [{ id: "sim", type: "code", language: "python", show: "code", code: CODE, x: 500, width: 880 }]));
    const hit = r.issues.find((i) => i.rule === "overlap-code-figure");
    expect(hit).toBeDefined();
    expect(hit!.message).toMatch(/box: "left"|box: "right"/);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/template-box.test.ts`
Expected: FAIL — no `fit-scale` issue; the old hint text.

- [ ] **Step 3: Add the rule**

In `src/lint/lint.ts`, add `| "fit-scale"` to the `rule` union (next to `"overlap-code-figure"`), and next to `export const FONT_FLOOR = 14;` add:
```ts
/** Below this fit scale the text floor is doing most of the work — the
 *  template box was too small for the figure (template-fit.ts). */
export const FIT_SCALE_FLOOR = 0.5;
```

In `src/layout/layout.ts`, import `FIT_SCALE_FLOOR` from `"../lint/lint"` (the file already imports `coVisible, lintLayout, type LintIssue` from there), and right after the fit line in the template block add:
```ts
        if (fit && fit.s < FIT_SCALE_FLOOR) {
          const where = isFitName((spec.params ?? {})["box"]) ? `"${(spec.params ?? {})["box"]}"` : JSON.stringify(fit.box);
          issues.push({
            rule: "fit-scale",
            ids: [spec.template],
            severity: "warn",
            message:
              `template ${spec.template} is fitted at ${fit.s.toFixed(2)} into box ${where}; its labels are held at the readable floor — ` +
              `give it a taller region, or use a template with a native box`,
          });
        }
```
(`issues` is declared before the template block; import `isFitName` from `./regions`.)

Reword the `codeFigureOverlap` message:
```ts
            `code panel "${codeId}" and the ${spec.template} figure ("${id}") are drawn on the same ground — ` +
            `give the template a box (params.box: "left" or "right"), or the code element x/width, so each has its own area`,
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/template-box.test.ts tests/figure-split.test.ts tests/lint*.test.ts`
Expected: PASS. If a figure-split test asserts the old hint wording verbatim, update that assertion to the new text — the message is the thing that changed, by design.

- [ ] **Step 5: Commit**

```bash
git add src/lint/lint.ts src/layout/layout.ts tests/template-box.test.ts tests/figure-split.test.ts
git commit -m "Template box: a fit-scale lint says when the box was too small for the figure, and the overlap hint names the region words (spec §7, Task 4)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: The params check accepts a region name for the native five

**Files:**
- Modify: `src/scenes/params-check.ts` (`templateParamErrors`, lines 18–43)
- Test: `tests/params-check-box.test.ts` (new)

**Interfaces:**
- Consumes: `resolveTemplateBox` (Task 1).

- [ ] **Step 1: Write the failing test**

Create `tests/params-check-box.test.ts`:

```ts
import { beforeAll, describe, expect, test } from "vitest";
import { templateParamErrors } from "../src/scenes/params-check";
import { ensureEnabledPacks } from "../src/scenes/packs";

beforeAll(async () => {
  await ensureEnabledPacks(["data", "evidence"]);
});

describe("params check — box", () => {
  test("a native-box template accepts a region name (resolved to its rectangle before Ajv sees it)", () => {
    expect(templateParamErrors("bar_chart", { labels: ["a", "b"], values: [1, 2], box: "right" })).toEqual([]);
  });
  test("a native-box template still rejects a box that is neither", () => {
    expect(templateParamErrors("bar_chart", { labels: ["a", "b"], values: [1, 2], box: "middle" }).length).toBeGreaterThan(0);
  });
  test("a template without a native box accepts both forms (its schema does not close params)", () => {
    expect(templateParamErrors("sir_compartments", { box: "left" })).toEqual([]);
    expect(templateParamErrors("sir_compartments", { box: { x: 60, y: 95, w: 420, h: 560 } })).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/params-check-box.test.ts`
Expected: FAIL on the first test — Ajv reports `params/box must be object`.

- [ ] **Step 3: Resolve the name before validating**

In `src/scenes/params-check.ts`, import `resolveTemplateBox` from `"../layout/template-fit"` and `isFitName` from `"../layout/regions"`, and change the validation call:
```ts
  // A region name is the layout's vocabulary for `box` (template-fit.ts);
  // the five templates that type `box` as a rectangle get exactly that.
  const p = params && typeof params === "object" && isFitName((params as Record<string, unknown>)["box"])
    ? { ...(params as Record<string, unknown>), box: resolveTemplateBox((params as Record<string, unknown>)["box"]) }
    : params;
  if (!entry.validate || entry.validate(p ?? {})) return [];
```
If importing `../layout/template-fit` from `scenes/` creates a circular import at module load (template-fit → lint → … → scenes/registry → params-check), Vitest will say so on the first run: in that case move `resolveTemplateBox` into `src/layout/regions.ts` (it depends only on `fitRegion`/`isFitName`/`BBox`) and re-export it from template-fit.ts, keeping every test import working.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/params-check-box.test.ts tests/examples.test.ts tests/data-pack.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/scenes/params-check.ts tests/params-check-box.test.ts
git commit -m "Template box: the params check reads a region name as the rectangle the five native-box templates type (spec §10, Task 5)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Schema description, compiler prompt, prompt-size pin — one commit

**Files:**
- Modify: `src/spec/schema.ts` (the `params` property, lines 891–896)
- Modify: `src/llm/prompts/compiler-v1.md` (the "How to choose your approach" list, item 1, line 13)
- Modify: `src/llm/prompts/compiler-v1-code.md` (line 2, the sentence "and the app then SPLITS the canvas by itself…")
- Modify: `tests/prompt-size.test.ts` (lines 122–123, the two baselines; a new describe at the end)

- [ ] **Step 1: Write the failing test**

Append to the END of `tests/prompt-size.test.ts` (it already has the `system(code, sound)` helper at line ~125 and imports `apiSchema`):

```ts
describe("template box in the prompt (spec 2026-09-15-template-box §10)", () => {
  test("the compiler learns params.box by its region names, in the main prompt, the code prompt and the schema", () => {
    expect(system(false)).toContain('"box": "right"');
    expect(system(true)).toContain('"box": "left"` puts the figure on the left');
    expect(JSON.stringify(apiSchema())).toContain('Any template also takes \\"box\\"');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/prompt-size.test.ts`
Expected: the new test FAILS (text not in the prompt); the two size pins still pass.

- [ ] **Step 3: Schema description**

In `src/spec/schema.ts`, extend the `params` description (keep the existing sentence, append):
```
 Any template also takes "box": a region name — "left", "right", "top", "bottom" or "full" — that puts the whole figure in that part of the canvas so a code panel, an equation or a table can have the rest; or {x, y, w, h} in canvas units. Give it only when something else shares the page, and prefer the names.
```

- [ ] **Step 4: Compiler prompt**

In `src/llm/prompts/compiler-v1.md`, at the end of list item 1 ("Scene template (best)…"), append one sentence:
```
 When something ELSE must share the page — a script, a formula, a small table — add `"box": "right"` (or `"left"`, `"top"`, `"bottom"`; `"full"` is the default) to `params`: the figure keeps its shape at that size and the other half is free; never compute a rectangle for it.
```

In `src/llm/prompts/compiler-v1-code.md`, line 2, replace the clause `and the app then SPLITS the canvas by itself, script on the left and chart on the right, so write neither the code element's `x`/`width` nor the template's `box` unless you mean to override that` with:
```
and the app then SPLITS the canvas by itself for ANY template — script on the left, figure on the right — so write neither the code element's `x`/`width` nor the template's `box` unless you mean to override that (`"box": "left"` puts the figure on the left instead)
```

- [ ] **Step 5: Re-pin the prompt size**

Run: `npx vitest run tests/prompt-size.test.ts`
Expected: the two size assertions FAIL, each reporting the actual length. Set `BASELINE_SYSTEM_CHARS` and `BASELINE_SCHEMA_CHARS` in `tests/prompt-size.test.ts` to exactly those actual values (they were 225171 and 110309; the increase should be under 900 characters together — if it is more, a paragraph grew beyond one sentence, trim it). Add a dated comment above the constants in the file's own style, e.g. `// Re-pinned 2026-09-15 for the template box round: one sentence on params.box in the schema (+N on the schema, +N on the system prompt), one in compiler-v1.md, one clause in compiler-v1-code.md (+N).` with the measured deltas filled in.

- [ ] **Step 6: Run the tests**

Run: `npx vitest run tests/prompt-size.test.ts tests/prompt.test.ts tests/schema*.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/spec/schema.ts src/llm/prompts/compiler-v1.md src/llm/prompts/compiler-v1-code.md tests/prompt-size.test.ts
git commit -m "Template box: the schema and the compiler learn params.box by its region names, prompt size re-pinned (spec §10, Task 6)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: The acceptance cast as a bundled example; docs

**Files:**
- Modify: `src/examples.json` (append one entry)
- Modify: `ROADMAP.md` (the Phase C "Template-as-element" bullet, line ~1389)
- Modify: `docs/2026-09-15-template-box-spec.md` (Status line)
- Test: `tests/examples.test.ts` (existing gate; no new file)

- [ ] **Step 1: Find the compartment ids**

There is no `tsx` in this repo; write a throwaway test file `tests/zz-sir-ids.test.ts`:
```ts
import { test } from "vitest";
import { layoutSpec } from "../src/layout/layout";
import { ensureEnabledPacks } from "../src/scenes/packs";
test("print sir ids", async () => {
  await ensureEnabledPacks(["evidence"]);
  console.log(layoutSpec({ template: "sir_compartments", params: {} } as never).order.join(" "));
});
```
Run: `npx vitest run tests/zz-sir-ids.test.ts` and read the printed line; then `rm tests/zz-sir-ids.test.ts`. Expected: ids like `box_S box_code_S box_name_S flow_0 rate_0 …` for S, I, R. Use EXACTLY the printed spelling in step 2; if the codes are lower-cased (`box_s`), use that.

- [ ] **Step 2: Append the example**

Append to the array in `src/examples.json` (the gate reads `request`, `spec`, `packs`):

```json
{
  "request": "Draw the SIR model and, beside it, the Python that solves it and plots the three curves.",
  "packs": ["evidence"],
  "spec": {
    "title": "SIR: the boxes and the curves",
    "template": "sir_compartments",
    "params": { "box": "right" },
    "elements": [
      {
        "id": "sim",
        "type": "code",
        "language": "python",
        "show": "left",
        "chart": "seaborn",
        "code": "import matplotlib.pyplot as plt\nbeta, gamma, days = 0.3, 0.1, 160\nS, I, R = [0.99], [0.01], [0.0]\nfor t in range(days):\n    new = beta * S[-1] * I[-1]\n    rec = gamma * I[-1]\n    S.append(S[-1] - new)\n    I.append(I[-1] + new - rec)\n    R.append(R[-1] + rec)\nprint(\"peak infectious share:\", round(max(I), 2))\n_ = plt.plot(S, label=\"S\")\n_ = plt.plot(I, label=\"I\")\n_ = plt.plot(R, label=\"R\")\n_ = plt.legend()"
      }
    ],
    "commands": [
      { "draw": ["box_S", "box_code_S", "box_name_S"], "speak": "Everyone starts susceptible." },
      { "draw": ["flow_0", "rate_0", "box_I", "box_code_I", "box_name_I"], "speak": "Contact with an infectious person moves you across, at a rate beta times how many are infectious." },
      { "draw": ["flow_1", "rate_1", "box_R", "box_code_R", "box_name_R"], "speak": "And recovery moves you on, at a rate gamma." },
      { "draw": ["sim", "sim_line_1", "sim_line_2", "sim_line_3"], "parallel": true, "speak": "The same three boxes in code: a rate in, a rate out, and a starting share." },
      { "draw": ["sim_line_4", "sim_line_5", "sim_line_6", "sim_line_7", "sim_line_8", "sim_line_9"], "speak": "Each day, the new infections leave S and enter I, and the recoveries leave I and enter R." },
      { "draw": ["sim_line_10", "sim_line_11", "sim_line_12", "sim_line_13", "sim_line_14"], "speak": "Then we plot the three shares over time." },
      { "draw": ["sim_out"], "speak": "The infectious curve rises, peaks at under a third of the population, and falls as susceptibles run out." },
      { "explore": { "code": "sim" }, "speak": "Change beta or gamma and run it again." }
    ]
  }
}
```

- [ ] **Step 3: Run the examples gate**

Run: `npx vitest run tests/examples.test.ts tests/examples-style.test.ts`
Expected: PASS. A failure naming an unknown id means step 1's spelling differs — fix the ids, not the gate. A `font-too-small` or overlap issue means the fit is wrong — go back to Task 2, do not loosen the gate. If `examples-style` rejects a phrase, edit the narration to satisfy it; the rule is documented in that test.

- [ ] **Step 4: Docs**

In `ROADMAP.md`, in the Phase C "Template-as-element" bullet, after "one spec already combines a template with freehand elements;" insert: "since the template box round (2026-09-15, `params.box` on every template, template-fit.ts) that template also takes a REGION and leaves the rest of the page free;". In `docs/2026-09-15-template-box-spec.md`, change the Status line to: `Status: implemented 2026-09-15 on branch worktree-template-box (plan: docs/superpowers/plans/2026-09-15-template-box.md). Hans's smoke test of the SIR cast on a phone is the remaining acceptance step.`

- [ ] **Step 5: Whole suite and build**

Run: `npm test 2>&1 | tail -6 && npm run build 2>&1 | tail -3`
Expected: every test passes; `tsc` and Vite build clean.

- [ ] **Step 6: Commit**

```bash
git add src/examples.json ROADMAP.md docs/2026-09-15-template-box-spec.md
git commit -m "Template box: the acceptance cast — sir_compartments on the right, the Python that solves it on the left — as a bundled example; roadmap and spec status (spec §11, Task 7)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: Merge origin/main, final verification, push

**Files:** none new.

- [ ] **Step 1: Merge**

```bash
git fetch origin && git merge origin/main
```
Expected: clean, or conflicts only in files this branch touched. `worktree-sweep` may have landed `src/render/sweep.ts`; it does not touch layout. Resolve, then:

- [ ] **Step 2: Verify**

Run: `npm test 2>&1 | tail -6 && npm run build 2>&1 | tail -3`
Expected: all green.

- [ ] **Step 3: Push the branch and report**

```bash
git push -u origin worktree-template-box
```
Report the branch, the test count, and that the SIR cast is ready for Hans's phone-width smoke test. Merging to main is Hans's call (the branch is small; a fast-forward from main after `git merge --ff-only worktree-template-box` is the expected path).

---

## Self-review against the spec

- §3 decisions: names or rectangle (T1, T2), no bare size/share (nothing added), native wins (T2 `nativeBox`), uniform scale (T1 uses `fitTransform`), ink union + pad (T1), stroke width untouched (`scaleDrawables` as-is), split default for all (T2 `templateTakesBox: hasTemplate`).
- §4 mechanism steps 1–5: T1 (resolve, union, transform incl. labels/anchors/curves), T2 (record `fit`), curve samples mapped before inverse (T1 mutates, T3 passes `fit` to the inverse).
- §5 text floor: T1 (`FONT_FLOOR`, labels and drawables), T2 test that `font-too-small` never fires.
- §6 domain and widgets: T3. `controls.ts` untouched.
- §7 lint: T4.
- §9 concurrency: header constraints; T8 merge order.
- §10 schema/params-check/prompt/pin: T5, T6.
- §11 acceptance cast and the seven tests: T7 example; tests 1 (T2), 2 (T1), 3 (T3), 4 (T2 native cases), 5 (examples gate, T2 step 5), 6 (T4), 7 (T2 sir + code case; figure-split.test unchanged).
- Open from spec §5 (floor on the group `fit` verb): deliberately NOT in this plan — separate commit if Hans wants it.
