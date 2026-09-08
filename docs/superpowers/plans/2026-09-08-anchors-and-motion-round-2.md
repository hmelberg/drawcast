# Anchors and Motion Round 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Named anchors on every element accepted wherever a verb takes a point; attached labels that ride a turn and a scale; a `flip` (reflection), a `morph` (outline tween), a `trail` on `move`, a `flow` gesture; and two calculus templates (`riemann_sum`, `tangent_secant`).

**Architecture:** Anchors are recorded by the tier-2 layout (`LayoutResult.namedAnchors`) and resolved by the planner in current coordinates through the element's pose; a `PointRef` schema type (`[x, y]` or `{ref, anchor}`) replaces bare coordinate arrays on `move.to` / `move.pivot` / `arrange.at`. The pose model (`src/render/pose.ts`) grows a `mirror` flag with an exact composition rule; the SVG backend gains `mirror` + a `squash` prefix for the turn-over tween, `setPoints` for morphs, and a `setFlow` overlay effect. Trails are real stroke elements the planner mints and `render()` appends to every layout it mounts. The templates live in the mathlogic pack YAML.

**Tech Stack:** TypeScript, vitest (node, no DOM — backend tests use `tests/helpers/mini-dom.ts`), js-yaml packs, rough.js SVG backend.

**Spec:** `docs/superpowers/specs/2026-09-08-anchors-and-motion-round-2-design.md`

## Global Constraints

- The model writes semantics, code computes geometry: every coordinate input a verb takes must also accept a named point (`PointRef`), and the anchor names are exactly those in spec §2.1 — `center top bottom left right top_left top_right bottom_left bottom_right` universal; `vertex_k side_k centroid` polygon; `apex centroid arc start end` sector; `start end mid` arc; `tail tip mid` arrow/edge; `start end mid point_k` path.
- Canvas 1000 × 750 logical units, y-UP; the backend flips with `H − y`. Rotation in DEGREES, counter-clockwise in the y-up canvas.
- Pose: `x ↦ s·R(deg)·Mᵐ(x − p) + p + offset`, M = reflection across the vertical line through the pivot p (original frame), applied BEFORE the rotation.
- Every new schema field carries a one-sentence imperative `description` with an example — the schema is embedded in the prompt.
- Every new verb is added to ALL FOUR enumerations: `ACTION_VERBS` in `src/spec/schema.ts` (~line 822), `ACTION_KEYS` in `src/render/plan.ts` (~line 284), `ACTION_KEYS` in `src/lint/lint.ts` (line 252), and the verb list in `commandSchema.description` (`src/spec/schema.ts` ~line 294). `src/llm/subtitles.ts:60` lists the verbs that carry a `speak` to the subtitle track — add `flip`, `morph`, `flow` there too.
- Never `git commit` inside a task; the controller commits after review. Never use the Write tool on an EXISTING file — use Edit with exact anchors; Write only for NEW files.
- Run only the test files you touched plus `npx tsc --noEmit`; the controller runs the full suite. Tests: `npx vitest run tests/<file>.test.ts` from the worktree root `/Users/hom/Documents/GitHub/drawcast/.claude/worktrees/template-spike`.
- Defaults from the spec, verbatim: `flip.duration` 1.2 s, `morph.duration` 1.5 s, `flow.duration` 3 s, `flow.speed` 120, `flow.spacing` 24, `flow.kind` dots, `trail.width` 2.5, trail sampled at 60 uniform steps, morph resampling K = max(len(from), len(to), 24).

## File map

| File | Responsibility |
|---|---|
| `src/layout/anchors.ts` (new) | Pure anchor math: universal anchors from a box, geometric anchors from points |
| `src/layout/tier2.ts` | Records `namedAnchors`; arrow endpoints take `anchor` |
| `src/layout/layout.ts` | `LayoutResult.namedAnchors` |
| `src/spec/types.ts`, `src/spec/schema.ts` | `PointRef`, `EndRef.anchor`, `move.anchor`, `move.trail`, `flip`, `morph`, `flow` |
| `src/render/pose.ts` | `Turn.mirror`, `composeFlip`, exported `isIdentity` |
| `src/render/plan.ts` | Anchor resolution, followers rule, `flip` / `morph` / `flow` branches, trails |
| `src/render/morph.ts` (new) | Resampling and ring alignment for morph |
| `src/render/trails.ts` (new) | `withTrails`, `cumulativeLengthFractions`, `lengthFractionAt` |
| `src/render/backend.ts`, `src/render/svg-backend.ts` | `setTransform(mirror, squash)`, `setPoints`, `setFlow` / `endFlow`, `swapGeometry(shapes)` |
| `src/render/player.ts` | flip halves in `transform`, `morph` and `flow` steps, trail progress, `applyScene` shapes |
| `src/render/index.ts` | `planOptionsFor` (`anchorOf`, `leafPointsOf`), trails appended to every mounted layout |
| `src/scenes/packs/mathlogic.yaml` | `riemann_sum`, `tangent_secant` |
| `src/llm/prompts/compiler-v1.md` | Verb bullets |
| `src/examples.json` | Eight bundled examples |
| `ROADMAP.md` | The round's entry |

---

### Task 1: Named anchors in the layout, arrow endpoints take `anchor`

**Files:**
- Create: `src/layout/anchors.ts`
- Modify: `src/layout/tier2.ts` (`Tier2Result` ~44-66, `Ctx` ~68-84, `layoutElements` ~86-105 and its return ~240-248, `case "path"` ~180-192, `resolveEnd` ~493-507, `connectorDrawable` ~509-545, `sectorDrawables` / `arcDrawable` / `polygonDrawables` / `piecesDrawables` ~985-1090)
- Modify: `src/layout/layout.ts` (`LayoutResult` 19-40, `layoutSpec` locals ~61-66, the tier-2 block ~93-104, the return at ~154)
- Modify: `src/spec/types.ts:66-70` (`EndRef`)
- Modify: `src/spec/schema.ts:54-63` (`endRefSchema`)
- Modify: `src/render/index.ts:95-110` (`planOptionsFor`)
- Modify: `src/render/plan.ts:120-160` (`PlanOptions.anchorOf` — the option only; resolution is Task 2)
- Test: `tests/anchors.test.ts` (new)

**Interfaces:**
- Produces (`src/layout/anchors.ts`):
  - `export const UNIVERSAL_ANCHORS = ["center", "top", "bottom", "left", "right", "top_left", "top_right", "bottom_left", "bottom_right"] as const;`
  - `export function isUniversalAnchor(name: string): boolean`
  - `export function boxAnchor(box: BBox, name: string): Pt` (unknown name → center)
  - `export function ptsBox(pts: Pt[]): BBox | null`
  - `export function polygonAnchors(pts: Pt[]): Record<string, Pt>` (`vertex_k`, `side_k`, `centroid`)
  - `export function sectorAnchors(c: Pt, r: number, fromDeg: number, toDeg: number): Record<string, Pt>` (`apex`, `centroid`, `arc`, `start`, `end`)
  - `export function polylineAnchors(pts: Pt[], kind: "path" | "arrow" | "arc"): Record<string, Pt>` (arrow: `tail tip mid`; arc: `start end mid`; path: `start end mid point_k`)
- Produces: `Tier2Result.namedAnchors: Record<string, Record<string, Pt>>`, `LayoutResult.namedAnchors: Record<string, Record<string, Pt>>`, `EndRef.anchor?: string`, `PlanOptions.anchorOf?: (id: string, name: string) => Pt | null`, and `planOptionsFor` returning `anchorOf` (Task 2 consumes it).

- [ ] **Step 1: Write the failing anchor-math tests**

Create `tests/anchors.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { boxAnchor, polygonAnchors, polylineAnchors, ptsBox, sectorAnchors } from "../src/layout/anchors";
import { layoutSpec } from "../src/layout/layout";
import { layoutElements } from "../src/layout/tier2";
import type { Spec, SpecElement } from "../src/spec/types";

const close = (a: [number, number] | undefined, b: [number, number]) => {
  expect(a).toBeDefined();
  expect(a![0]).toBeCloseTo(b[0], 6);
  expect(a![1]).toBeCloseTo(b[1], 6);
};

describe("anchor math", () => {
  test("boxAnchor names the nine points of a box and falls back to center", () => {
    const box = { x: 100, y: 200, w: 40, h: 20 };
    close(boxAnchor(box, "center"), [120, 210]);
    close(boxAnchor(box, "top"), [120, 220]);
    close(boxAnchor(box, "bottom_left"), [100, 200]);
    close(boxAnchor(box, "top_right"), [140, 220]);
    close(boxAnchor(box, "right"), [140, 210]);
    close(boxAnchor(box, "nonsense"), [120, 210]);
  });
  test("polygonAnchors: vertices in order, side midpoints wrapping, centroid", () => {
    const a = polygonAnchors([[0, 0], [4, 0], [4, 4], [0, 4]]);
    close(a.vertex_1, [0, 0]);
    close(a.vertex_3, [4, 4]);
    close(a.side_1, [2, 0]);
    close(a.side_4, [0, 2]); // vertex_4 → vertex_1
    close(a.centroid, [2, 2]);
  });
  test("sectorAnchors: apex, arc midpoint on the rim, the two arc ends", () => {
    const a = sectorAnchors([0, 0], 10, 0, 90);
    close(a.apex, [0, 0]);
    close(a.start, [10, 0]);
    close(a.end, [0, 10]);
    close(a.arc, [Math.SQRT1_2 * 10, Math.SQRT1_2 * 10]);
  });
  test("polylineAnchors: arrow tail/tip, path point_k, arc start/end/mid", () => {
    close(polylineAnchors([[0, 0], [10, 0]], "arrow").tail, [0, 0]);
    close(polylineAnchors([[0, 0], [10, 0]], "arrow").tip, [10, 0]);
    close(polylineAnchors([[0, 0], [5, 5], [10, 0]], "path").point_2, [5, 5]);
    close(polylineAnchors([[0, 0], [5, 5], [10, 0]], "arc").mid, [5, 5]);
    expect(ptsBox([])).toBeNull();
  });
});

describe("layout records named anchors", () => {
  const spec = (elements: unknown[]): Spec => ({ elements, commands: [] }) as unknown as Spec;
  test("polygon, sector, arc, arrow and path each get their geometric anchors; pieces sectors too", () => {
    const out = layoutSpec(spec([
      { id: "tri", type: "polygon", points: [[100, 100], [300, 100], [200, 300]] },
      { id: "sec", type: "sector", x: 500, y: 500, radius: 100, start: 0, end: 90 },
      { id: "bow", type: "arc", x: 700, y: 300, radius: 50, start: 0, end: 180 },
      { id: "arr", type: "arrow", from: { x: 100, y: 600 }, to: { x: 300, y: 600 } },
      { id: "pth", type: "path", points: [[600, 600], [700, 650], [800, 600]] },
      { id: "cake", type: "pieces", of: "sectors", x: 500, y: 200, radius: 80, n: 4 },
    ]));
    close(out.namedAnchors.tri.vertex_3, [200, 300]);
    close(out.namedAnchors.tri.side_1, [200, 100]);
    close(out.namedAnchors.sec.apex, [500, 500]);
    close(out.namedAnchors.sec.end, [500, 600]);
    close(out.namedAnchors.bow.start, [750, 300]);
    close(out.namedAnchors.arr.tail, [100, 600]);
    close(out.namedAnchors.arr.tip, [300, 600]);
    close(out.namedAnchors.pth.point_2, [700, 650]);
    close(out.namedAnchors.cake_1.apex, [500, 200]);
    expect(out.namedAnchors.cake_1.start).toBeDefined();
  });
  test("an arrow endpoint with an anchor lands on the named point at layout time; unknown names warn and use the element's plain anchor", () => {
    const els: SpecElement[] = [
      { id: "tri", type: "polygon", points: [[100, 100], [300, 100], [200, 300]] },
      { id: "arr", type: "arrow", from: { x: 500, y: 500 }, to: { ref: "tri", anchor: "vertex_3" } },
      { id: "arr2", type: "arrow", from: { x: 500, y: 500 }, to: { ref: "tri", anchor: "top" } },
      { id: "arr3", type: "arrow", from: { x: 500, y: 500 }, to: { ref: "tri", anchor: "nonsense" } },
    ] as SpecElement[];
    const r = layoutElements(els, undefined);
    const tip = (id: string) => (r.drawables.find((d) => d.id === id) as { pts: [number, number][] }).pts.slice(-1)[0];
    close(tip("arr"), [200, 300]);
    close(tip("arr2"), [200, 300]); // top of the triangle's box = its apex row, centred
    expect(r.warnings.join(" ")).toMatch(/nonsense/);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/anchors.test.ts`
Expected: FAIL — `src/layout/anchors` does not exist.

- [ ] **Step 3: Create `src/layout/anchors.ts`**

```ts
// Named points on elements (design §2.1). Pure geometry: the universal nine
// come from a bounding box, the geometric ones from the points a tier-2
// element was laid out with. The planner maps them through the pose.
import type { BBox } from "./geometry";
import { centroid } from "./geometry";
import type { Pt } from "./model";

export const UNIVERSAL_ANCHORS = ["center", "top", "bottom", "left", "right", "top_left", "top_right", "bottom_left", "bottom_right"] as const;

export function isUniversalAnchor(name: string): boolean {
  return (UNIVERSAL_ANCHORS as readonly string[]).includes(name);
}

/** The named point of a box; an unknown name is the centre. */
export function boxAnchor(box: BBox, name: string): Pt {
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  switch (name) {
    case "top": return [cx, box.y + box.h];
    case "bottom": return [cx, box.y];
    case "left": return [box.x, cy];
    case "right": return [box.x + box.w, cy];
    case "top_left": return [box.x, box.y + box.h];
    case "top_right": return [box.x + box.w, box.y + box.h];
    case "bottom_left": return [box.x, box.y];
    case "bottom_right": return [box.x + box.w, box.y];
    default: return [cx, cy];
  }
}

export function ptsBox(pts: Pt[]): BBox | null {
  if (pts.length === 0) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of pts) {
    if (x < x0) x0 = x;
    if (y < y0) y0 = y;
    if (x > x1) x1 = x;
    if (y > y1) y1 = y;
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** vertex_k in point order, side_k = midpoint of vertex k → k+1 (wrapping), centroid. */
export function polygonAnchors(pts: Pt[]): Record<string, Pt> {
  const out: Record<string, Pt> = {};
  const n = pts.length;
  pts.forEach((p, i) => { out[`vertex_${i + 1}`] = p; });
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    out[`side_${i + 1}`] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  }
  if (n >= 3) out.centroid = centroid(pts);
  return out;
}

const DEG = Math.PI / 180;

export function sectorAnchors(c: Pt, r: number, fromDeg: number, toDeg: number): Record<string, Pt> {
  const at = (deg: number): Pt => [c[0] + r * Math.cos(deg * DEG), c[1] + r * Math.sin(deg * DEG)];
  const mid = (fromDeg + toDeg) / 2;
  return { apex: c, centroid: [c[0] + 0.6 * r * Math.cos(mid * DEG), c[1] + 0.6 * r * Math.sin(mid * DEG)], arc: at(mid), start: at(fromDeg), end: at(toDeg) };
}

export function polylineAnchors(pts: Pt[], kind: "path" | "arrow" | "arc"): Record<string, Pt> {
  const out: Record<string, Pt> = {};
  if (pts.length === 0) return out;
  const first = pts[0], last = pts[pts.length - 1], mid = pts[Math.floor(pts.length / 2)];
  if (kind === "arrow") { out.tail = first; out.tip = last; out.mid = mid; return out; }
  out.start = first; out.end = last; out.mid = mid;
  if (kind === "path") pts.forEach((p, i) => { out[`point_${i + 1}`] = p; });
  return out;
}
```

- [ ] **Step 4: Record anchors in tier-2**

In `src/layout/tier2.ts`:
- Import `{ boxAnchor, isUniversalAnchor, polygonAnchors, polylineAnchors, ptsBox, sectorAnchors } from "./anchors"`.
- `Tier2Result` gains `/** Geometric anchors per element id (design §2.1): polygon vertex_k/side_k/centroid, sector apex/arc/start/end, arrow tail/tip/mid, path start/end/mid/point_k. */ namedAnchors: Record<string, Record<string, Pt>>;`
- `Ctx` gains `namedAnchors: Record<string, Record<string, Pt>>;` and `/** The drawables laid out so far — an arrow endpoint's `anchor` reads a box off them. */ drawablesSoFar: Drawable[];`. In `layoutElements` initialise `namedAnchors: {}` and, right after `const drawables: Drawable[] = [];` is declared, set `ctx.drawablesSoFar = drawables` (same array). Return `namedAnchors: ctx.namedAnchors`.
- `case "path"`: after `ctx.anchors[el.id] = …` add `ctx.namedAnchors[el.id] = polylineAnchors(pts, "path");`.
- `connectorDrawable`: before the return, `ctx.namedAnchors[el.id] = polylineAnchors(pts, "arrow");` (edges too — same names).
- `sectorDrawables`: `ctx.namedAnchors[el.id] = sectorAnchors(c, r, from, to);`
- `arcDrawable`: `ctx.namedAnchors[el.id] = polylineAnchors(pts, "arc");`
- `polygonDrawables`: `ctx.namedAnchors[el.id] = polygonAnchors(pts);`
- `piecesDrawables` (sector loop): `ctx.namedAnchors[id] = sectorAnchors(c, r, from, to);`
- `resolveEnd`: replace the `if (end.ref)` block with

```ts
  if (end.ref) {
    const a = ctx.anchors[end.ref];
    if (!a) {
      ctx.warnings.push(`arrow/edge endpoint references unknown id "${end.ref}"`);
      return null;
    }
    if (end.anchor === undefined) return a;
    const named = ctx.namedAnchors[end.ref]?.[end.anchor];
    if (named) return named;
    if (isUniversalAnchor(end.anchor)) {
      // Universal anchors come off the box of what the element drew so far
      // (points only — tier-2 has no text measurer).
      const pts: Pt[] = [];
      for (const d of leafDrawables(drawablesForId(ctx.drawablesSoFar, end.ref))) {
        if (d.kind === "stroke" && d.shapeHint?.type === "circle") {
          const { c, r } = d.shapeHint;
          pts.push([c[0] - r, c[1] - r], [c[0] + r, c[1] + r]);
        } else if (d.kind === "stroke" && d.shapeHint?.type === "rect") {
          const h = d.shapeHint;
          pts.push([h.x, h.y], [h.x + h.w, h.y + h.h]);
        } else if (d.kind === "stroke" || d.kind === "area") {
          pts.push(...d.pts);
        }
      }
      const box = ptsBox(pts);
      if (box) return boxAnchor(box, end.anchor);
    }
    ctx.warnings.push(`arrow/edge endpoint: "${end.ref}" has no anchor "${end.anchor}" — using its plain anchor`);
    return a;
  }
```

Import `drawablesForId` and `leafDrawables` from `./model` (both exported there).

- [ ] **Step 5: Carry `namedAnchors` through `layoutSpec`, and expose `anchorOf`**

`src/layout/layout.ts`: `LayoutResult` gains `/** Geometric anchors per tier-2 element id (design §2.1). Empty for a pure template spec. */ namedAnchors: Record<string, Record<string, Pt>>;`. In `layoutSpec`: `let namedAnchors: Record<string, Record<string, Pt>> = {};`, set `namedAnchors = tier2.namedAnchors;` beside `pieces = tier2.pieces;`, and return it. Every other place that builds a `LayoutResult` literal must gain `namedAnchors: {}` — run `npx tsc --noEmit` and fix each error it reports (expect `src/render/trails.ts` later, and any test fixture).

`src/spec/types.ts` `EndRef`: add `/** A named point on ref (default center) — see PointRef's anchor names. */ anchor?: string;`.

`src/spec/schema.ts` `endRefSchema.properties`: add
```ts
    anchor: { type: "string", description: "A named point ON ref instead of its centre — e.g. {\"ref\": \"tri\", \"anchor\": \"vertex_1\"}: center (default) / top / bottom / left / right / top_left / top_right / bottom_left / bottom_right on any element; polygon vertex_1…, side_1… (side midpoints), centroid; sector apex, arc, start, end; arrow and edge tail, tip, mid; path start, end, mid, point_1…." },
```

`src/render/plan.ts` `PlanOptions`: add `/** Geometric anchor of an element in its ORIGINAL frame (layout.namedAnchors), or null. */ anchorOf?: (id: string, name: string) => Pt | null;`.

`src/render/index.ts` `planOptionsFor`: widen the `Pick` to include `"anchorOf"` and return `anchorOf: (id, name) => layout.namedAnchors[id]?.[name] ?? null,`.

- [ ] **Step 6: Run the tests and tsc**

Run: `npx vitest run tests/anchors.test.ts tests/tier2.test.ts tests/primitives.test.ts tests/pieces-rect.test.ts && npx tsc --noEmit`
Expected: all PASS, tsc clean.

---

### Task 2: `PointRef` — `move.to` / `move.pivot` / `arrange.at` take anchors; `move.anchor`; `point.at` / `camera.center` anchors

**Files:**
- Modify: `src/spec/types.ts` (`EndRef` 66-70 → add `PointRef` below it; `MoveArgs` 213-230; `ArrangeArgs` 232-247)
- Modify: `src/spec/schema.ts` (header comment lines 1-8; a `pointRefSchema` helper beside `endRefSchema` ~54; the `move` schema 510-531; `arrange.at` ~544)
- Modify: `src/render/plan.ts` (`resolveIds`/`currentBox` region 238-282 → add `anchorOriginal`, `anchorNow`, `resolvePoint`; the `point` branch 462-492; the `move` branch 493-573; the `arrange` branch 574-635; the `camera` branch ~651-690)
- Modify: `src/examples.json` — the eight `"pivot": [x, y]` and nine `"at": [x, y]` usages are still valid (arrays stay accepted); no change needed, verify with the examples test.
- Test: `tests/plan.test.ts` (extend), `tests/schema.test.ts` (extend)

**Interfaces:**
- Consumes: `PlanOptions.anchorOf`, `boxAnchor`, `isUniversalAnchor` (Task 1); `poseOf`, `poseCentre` (`src/render/pose.ts`).
- Produces: `export type PointRef = [number, number] | EndRef;` in `src/spec/types.ts`; `MoveArgs.to?: PointRef; pivot?: PointRef; anchor?: string;`; `ArrangeArgs.at?: PointRef`; inside `planCommands` the closures `anchorOriginal(id, name, verb): Pt | null`, `anchorNow(id, name, verb): Pt | null`, `resolvePoint(p: PointRef | undefined, self: string | undefined, verb: string): Pt | null` — Tasks 3–6 call these.
- Semantics change (spec §2.1, needed for rolling): an EXPLICIT `pivot` rides along with the move's own translation — the planner adds the `by`/`to`/`path` delta to the pivot before composing the rotation and scale, so "slide by 377 and turn −360° about the wheel's centre" rolls instead of swinging about a far point.

- [ ] **Step 1: Write the failing planner tests**

Append to `tests/plan.test.ts` (inside a new `describe`):

```ts
describe("anchors in commands (design §2.1)", () => {
  const box = (x: number, y: number, w: number, h: number) => ({ x, y, w, h });
  const boxes: Record<string, ReturnType<typeof box>> = { a: box(100, 100, 200, 20), b: box(400, 400, 100, 20), tri: box(0, 0, 100, 100) };
  const named: Record<string, Record<string, [number, number]>> = {
    a: { tail: [100, 110], tip: [300, 110], mid: [200, 110] },
    b: { tail: [400, 410], tip: [500, 410], mid: [450, 410] },
    tri: { vertex_1: [0, 0], vertex_2: [100, 0], vertex_3: [0, 100], side_2: [50, 50], centroid: [100 / 3, 100 / 3] },
  };
  const opts = { bboxOf: (id: string) => boxes[id] ?? null, anchorOf: (id: string, name: string) => named[id]?.[name] ?? null };
  const transformOf = (plan: ReturnType<typeof planCommands>, i = 0) => plan.steps[i] as Extract<PlanStep, { kind: "transform" }>;

  test("move.to {ref, anchor} with move.anchor: b's tail lands on a's tip", () => {
    const plan = planCommands([{ move: { target: ["b"], anchor: "tail", to: { ref: "a", anchor: "tip" } } }], ["a", "b"], opts);
    expect(plan.warnings).toEqual([]);
    const it = transformOf(plan).items.find((x) => x.id === "b")!;
    expect(it.to.offset).toEqual([-100, -300]); // tail (400,410) → tip (300,110)
    expect(plan.states[0].offsets.b).toEqual([-100, -300]);
  });
  test("move.pivot {anchor} without ref is the target's own anchor: 180° about side_2 sends vertex_1 to (100,100)", () => {
    const plan = planCommands([{ move: { target: ["tri"], rotate: 180, pivot: { anchor: "side_2" } } }], ["tri"], opts);
    const st = plan.states[0];
    const p = poseOf(st.offsets.tri, st.turns.tri)([0, 0]);
    expect(p[0]).toBeCloseTo(100, 6);
    expect(p[1]).toBeCloseTo(100, 6);
  });
  test("anchors resolve in CURRENT coordinates after an earlier move", () => {
    const plan = planCommands(
      [{ move: { target: ["a"], by: [50, 0] } }, { move: { target: ["b"], anchor: "tail", to: { ref: "a", anchor: "tip" } } }],
      ["a", "b"],
      opts,
    );
    expect(plan.states[1].offsets.b).toEqual([-50, -300]);
  });
  test("an explicit pivot rides with the translation: by + rotate about the element's own centre given as a ref rolls, it does not swing", () => {
    const plan = planCommands([{ move: { target: ["tri"], by: [300, 0], rotate: -360, pivot: { ref: "tri" } } }], ["tri"], opts);
    const it = transformOf(plan).items[0];
    // pivot in the original frame is the centre itself, so a half-way pose is a pure slide + spin about it
    expect(it.to.turn.pivot[0]).toBeCloseTo(50, 6);
    expect(it.to.turn.pivot[1]).toBeCloseTo(50, 6);
    expect(it.to.offset).toEqual([300, 0]);
  });
  test("a universal anchor comes off the box; an unknown one warns and uses center; arrange.at takes a ref", () => {
    const plan = planCommands([{ move: { target: ["b"], to: { ref: "tri", anchor: "top_right" } } }], ["b", "tri"], opts);
    expect(plan.states[0].offsets.b).toEqual([100 - 450, 100 - 410]);
    const bad = planCommands([{ move: { target: ["b"], to: { ref: "tri", anchor: "wat" } } }], ["b", "tri"], opts);
    expect(bad.warnings.join(" ")).toMatch(/wat/);
    expect(bad.states[0].offsets.b).toEqual([50 - 450, 50 - 410]);
    const arr = planCommands([{ arrange: { target: ["a", "b"], layout: "row", at: { ref: "tri", anchor: "top" } } }], ["a", "b", "tri"], opts);
    expect(arr.warnings).toEqual([]);
    const ys = transformOf(arr).items.map((it) => it.to.offset[1]);
    expect(ys.every((y) => Math.abs(y - ys[0]) < 1e-6)).toBe(true);
  });
  test("point.at and camera.center aim at an anchor", () => {
    const plan = planCommands([{ point: { at: { ref: "a", anchor: "tip" } } }, { camera: { center: { ref: "a", anchor: "tip" }, zoom: 4 } }], ["a"], opts);
    expect(plan.steps[0]).toMatchObject({ kind: "point", x: 300, y: 110 });
    const cam = plan.steps[1] as Extract<PlanStep, { kind: "camera" }>;
    expect(cam.box!.x + cam.box!.w / 2).toBeCloseTo(300, 6); // (300,110) at zoom 4 stays inside the canvas clamp
  });
});
```

Add to `tests/schema.test.ts`:

```ts
describe("PointRef", () => {
  test("move.to accepts an array or a {ref, anchor} object; move.anchor is a string", () => {
    const base = { elements: [{ id: "a", type: "arrow", from: { x: 0, y: 0 }, to: { x: 10, y: 0 } }, { id: "b", type: "arrow", from: { x: 0, y: 5 }, to: { x: 10, y: 5 } }] };
    expect(validateSpec({ ...base, commands: [{ move: { target: ["b"], to: [5, 5] } }] } as never).ok).toBe(true);
    expect(validateSpec({ ...base, commands: [{ move: { target: ["b"], anchor: "tail", to: { ref: "a", anchor: "tip" } } }] } as never).ok).toBe(true);
    expect(validateSpec({ ...base, commands: [{ move: { target: ["b"], to: "a.tip" } }] } as never).ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/plan.test.ts tests/schema.test.ts`
Expected: the new tests FAIL (offsets wrong / validation rejects the object form).

- [ ] **Step 3: Types and schema**

`src/spec/types.ts`: below `EndRef` add `/** A point a verb takes: [x, y] (domain units when a domain is declared, else logical) or a named point on an element. */ export type PointRef = [number, number] | EndRef;`. In `MoveArgs`: `to?: PointRef;`, `pivot?: PointRef;` and `/** Which anchor of the moving element lands on `to` (default center). */ anchor?: string;`. In `ArrangeArgs`: `at?: PointRef;`.

`src/spec/schema.ts`: replace the header's line 5-7 with `// Unions (oneOf) are fine under structured output — play, marks and drag items ship with them; keep them shallow. Per-type requirements are enforced by the semantic checks below and fed back to the LLM in the repair round.`. Add after `endRefSchema`:

```ts
const ANCHOR_NAMES =
  "center (default) / top / bottom / left / right / top_left / top_right / bottom_left / bottom_right on any element; polygon vertex_1…, side_1… (side midpoints), centroid; sector apex, arc, start, end; arrow and edge tail, tip, mid; path start, end, mid, point_1…";

/** A point a verb takes: [x, y], or a named point on an element so the model never computes it. */
const pointRefSchema = (what: string) => ({
  oneOf: [
    { type: "array", items: { type: "number" }, minItems: 2, maxItems: 2 },
    {
      type: "object",
      properties: { ref: { type: "string" }, anchor: { type: "string" }, x: { type: "number" }, y: { type: "number" } },
      additionalProperties: false,
    },
  ],
  description: `${what} — [x, y] (domain units when a domain is declared, else logical), or {"ref": id, "anchor": name} for a point ON an element so you never compute it: ${ANCHOR_NAMES}.`,
});
```

Use the same `ANCHOR_NAMES` string in `endRefSchema.anchor`'s description (Task 1 wrote it inline — replace with the constant). In the `move` schema: `to: pointRefSchema("Destination of the moving element's `anchor` (default its centre) — instead of by/path — e.g. \"to\": {\"ref\": \"a\", \"anchor\": \"tip\"} with \"anchor\": \"tail\" puts b's tail on a's tip")`, `pivot: pointRefSchema("With rotate/scale: the point to turn or grow about — {\"anchor\": \"vertex_2\"} (no ref) is the element's OWN vertex; {\"ref\": \"wheel\"} another element's centre; rides along with by/to, so by + rotate rolls. Omit for the element's own centre")`, and add `anchor: { type: "string", description: "With to: which anchor of the MOVING element lands there (default center) — \"anchor\": \"tail\" to place an arrow's tail." }`. In `arrange`: `at: pointRefSchema("Centre of the arrangement (default: where the targets are now; fan: the first sector's apex)")`.

- [ ] **Step 4: Planner resolution**

In `src/render/plan.ts`, import `{ boxAnchor, isUniversalAnchor } from "../layout/anchors"` and `type PointRef` / `EndRef` from `../spec/types`. After `currentBox` add:

```ts
  /** A named point of an element in its ORIGINAL frame: geometric from the layout, else off its box. */
  const anchorOriginal = (id: string, name: string, verb: string): Pt | null => {
    const geometric = opts.anchorOf?.(id, name) ?? null;
    if (geometric) return geometric;
    const box = bboxOf(id);
    if (!box) return null;
    if (!isUniversalAnchor(name)) {
      warnings.push(`${verb}: "${id}" has no anchor "${name}" — using center`);
      return boxAnchor(box, "center");
    }
    return boxAnchor(box, name);
  };
  /** The same point where it is NOW (through the pose); a pieces id → the box around its pieces. */
  const anchorNow = (id: string, name: string, verb: string): Pt | null => {
    const kids = opts.expandId?.(id)?.filter((k) => known.has(k)) ?? [];
    if (kids.length > 0) {
      const box = unionBox(kids.map(currentBox));
      if (!box) return null;
      if (!isUniversalAnchor(name)) warnings.push(`${verb}: "${id}" has no anchor "${name}" — using center`);
      return boxAnchor(box, isUniversalAnchor(name) ? name : "center");
    }
    if (!known.has(id)) {
      warnings.push(`${verb}: unknown id "${id}"`);
      return null;
    }
    const p = anchorOriginal(id, name, verb);
    return p ? poseOf(offsets[id] ?? [0, 0], turns[id])(p) : null;
  };
  /** A PointRef in current logical coordinates. `self` is the element a ref-less {anchor} names. */
  const resolvePoint = (p: PointRef | undefined, self: string | undefined, verb: string): Pt | null => {
    if (p === undefined) return null;
    if (Array.isArray(p)) return toLogical(p as Pt);
    const r = p as EndRef;
    if (r.ref === undefined && r.anchor === undefined && r.x !== undefined && r.y !== undefined) return toLogical([r.x, r.y]);
    const id = r.ref ?? self;
    if (!id) {
      warnings.push(`${verb}: a point needs ref, x + y, or an anchor of the target`);
      return null;
    }
    return anchorNow(id, r.anchor ?? "center", verb);
  };
```

`move` branch (the pose-change half): replace the `hasTo` delta with

```ts
          if (hasTo) {
            const dest = resolvePoint(cmd.move.to, undefined, "move");
            const from = anchorNow(id, cmd.move.anchor ?? "center", "move");
            if (dest && from) delta = [dest[0] - from[0], dest[1] - from[1]];
          } else if (hasBy) { … unchanged … }
```

and replace both `pivotNow` lines (scale and rotate) with one computed once before them:

```ts
          let pivotNow: Pt;
          if (cmd.move.pivot !== undefined) {
            const explicit = Array.isArray(cmd.move.pivot) || (cmd.move.pivot as EndRef).ref !== undefined || ((cmd.move.pivot as EndRef).x !== undefined && (cmd.move.pivot as EndRef).anchor === undefined);
            const q = explicit ? resolvePoint(cmd.move.pivot, undefined, "move") : null;
            if (q) {
              pivotNow = [q[0] + delta[0], q[1] + delta[1]]; // the pivot rides with the translation
            } else {
              const own = anchorOriginal(id, (cmd.move.pivot as EndRef).anchor ?? "center", "move");
              pivotNow = own ? poseOf(offset, turn)(own) : [offset[0], offset[1]];
            }
          } else {
            pivotNow = box ? poseCentre(box, offset, turn) : [offset[0], offset[1]];
          }
```

(`offset` here is already the translated offset, exactly as before.) The plain-translation branch (`!hasRotate && !hasTo && !hasScale`) is unchanged. `hasTo` now requires `bboxOf(id)` only through `anchorNow`; keep the existing `if (hasTo && box)` guard semantics by leaving `delta = [0, 0]` when either point is null (a warning was already pushed).

`arrange`: `const at = resolvePoint(cmd.arrange.at, undefined, "arrange") ?? undefined;`.

`point`: inside `if (at?.ref !== undefined)`, after `const b = …`, add: `if (at.anchor !== undefined) { const p = anchorNow(at.ref, at.anchor, "point"); if (p) { [x, y] = p; box = b ?? undefined; } else { x = …; y = …; } }` — i.e. when an anchor is given the laser aims at the anchor point and keeps `box` for the gesture size; without an anchor the code stays as it is.

`camera`: inside `if (center?.ref !== undefined)`, after the box logic: `if (center.anchor !== undefined) { const p = anchorNow(center.ref, center.anchor, "camera"); if (p) [cx, cy] = p; }`.

- [ ] **Step 5: Run the tests and tsc**

Run: `npx vitest run tests/plan.test.ts tests/schema.test.ts tests/arrange.test.ts tests/arrange-fan-hex.test.ts tests/examples.test.ts && npx tsc --noEmit`
Expected: all PASS.

---

### Task 3: Followers ride the pose change

**Files:**
- Modify: `src/render/plan.ts` (the `move` pose-change half ~530-572, the `arrange` follower loop ~600-634)
- Test: `tests/followers.test.ts` (new)

**Interfaces:**
- Consumes: `poseOf` (`src/render/pose.ts`), `bboxOf`, `TransformItem`.
- Produces: inside `planCommands` a closure `followerItems(targetId: string, from: { offset: Pt; turn: Turn | undefined }, to: { offset: Pt; turn: Turn | undefined }, moved: Set<string>, ids: string[]): TransformItem[]` that Task 4 (`flip`) reuses, and the constant `IDENTITY: Turn = { deg: 0, pivot: [0, 0] }`. Rule (spec §2.2): `offset_f += P₁(c_f) − P₀(c_f)` with `c_f` the follower's ORIGINAL-frame box centre; a follower with no box gets the target's translation delta (today's rule).

- [ ] **Step 1: Write the failing tests**

Create `tests/followers.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { planCommands, type PlanStep } from "../src/render/plan";

const box = (x: number, y: number, w: number, h: number) => ({ x, y, w, h });
// A 100×50 box with its label centred at (120, 25), just right of it.
const boxes: Record<string, ReturnType<typeof box>> = { sq: box(0, 0, 100, 50), label_sq: box(110, 20, 20, 10), label_sq_leader: box(100, 25, 10, 1) };
const opts = {
  bboxOf: (id: string) => boxes[id] ?? null,
  attachedTo: (id: string) => (id === "sq" ? ["label_sq", "label_sq_leader"] : []),
};
const items = (plan: ReturnType<typeof planCommands>, i = 0) => (plan.steps[i] as Extract<PlanStep, { kind: "transform" }>).items;

describe("followers ride the pose change (design §2.2)", () => {
  test("a rotation of 90° about the box's bottom_left swings the label round: its centre (120,25) → (−25,120)", () => {
    const plan = planCommands([{ move: { target: ["sq"], rotate: 90, pivot: { anchor: "bottom_left" } } }], ["sq", "label_sq", "label_sq_leader"], opts);
    const lab = items(plan).find((it) => it.id === "label_sq")!;
    expect(lab.to.offset[0]).toBeCloseTo(-25 - 120, 6);
    expect(lab.to.offset[1]).toBeCloseTo(120 - 25, 6);
    expect(lab.to.turn.deg).toBe(0); // the text never turns
  });
  test("a scale ×2 about bottom_left pushes the label out with the far side: (120,25) → (240,50)", () => {
    const plan = planCommands([{ move: { target: ["sq"], scale: 2, pivot: { anchor: "bottom_left" } } }], ["sq", "label_sq", "label_sq_leader"], opts);
    const lab = items(plan).find((it) => it.id === "label_sq")!;
    expect(lab.to.offset).toEqual([120, 25]);
    expect(lab.to.turn.scale ?? 1).toBe(1);
  });
  test("a pure translation is today's delta exactly", () => {
    const plan = planCommands([{ move: { target: ["sq"], to: [500, 500] } }], ["sq", "label_sq", "label_sq_leader"], opts);
    const lab = items(plan).find((it) => it.id === "label_sq")!;
    expect(lab.to.offset).toEqual([450, 475]);
  });
  test("arrange zipper carries a slice's label (it used to leave it behind)", () => {
    const pieces = { p_1: { apex: [300, 375] as [number, number], centroid: [330, 390] as [number, number], midAngle: 45, halfAngle: 45, radius: 120 }, p_2: { apex: [300, 375] as [number, number], centroid: [270, 390] as [number, number], midAngle: 135, halfAngle: 45, radius: 120 } };
    const b: Record<string, ReturnType<typeof box>> = { p_1: box(300, 375, 120, 120), p_2: box(180, 375, 120, 120), label_p_1: box(340, 400, 20, 10) };
    const plan = planCommands([{ arrange: { target: ["p_1", "p_2"], layout: "zipper", at: [600, 375] } }], ["p_1", "p_2", "label_p_1"], {
      bboxOf: (id) => b[id] ?? null,
      pieceOf: (id) => pieces[id as keyof typeof pieces] ?? null,
      attachedTo: (id) => (id === "p_1" ? ["label_p_1"] : []),
    });
    const lab = items(plan).find((it) => it.id === "label_p_1");
    expect(lab).toBeDefined();
    expect(Math.hypot(lab!.to.offset[0], lab!.to.offset[1])).toBeGreaterThan(100);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/followers.test.ts`
Expected: FAIL — rotation/scale cases leave the label offset at `[0, 0]`; the zipper case finds no label item.

- [ ] **Step 3: Implement `followerItems` and use it in `move` and `arrange`**

In `planCommands`, near `anchorNow`, add:

```ts
  const IDENTITY: Turn = { deg: 0, pivot: [0, 0] };
  /** Followers ride their target's pose change: each is moved by where its own
   *  box centre goes under the target's new pose minus where it was under the
   *  old one (design §2.2). Text never turns or scales. `moved` dedupes a
   *  follower two targets share; `ids` are the targets themselves. */
  const followerItems = (
    targetId: string,
    from: { offset: Pt; turn: Turn | undefined },
    to: { offset: Pt; turn: Turn | undefined },
    moved: Set<string>,
    ids: string[],
  ): TransformItem[] => {
    const out: TransformItem[] = [];
    const before = poseOf(from.offset, from.turn);
    const after = poseOf(to.offset, to.turn);
    for (const f of [...new Set(opts.attachedTo?.(targetId) ?? [])]) {
      if (!known.has(f) || ids.includes(f) || moved.has(f)) continue;
      moved.add(f);
      const fb = bboxOf(f);
      const o: Pt = offsets[f] ?? [0, 0];
      let d: Pt;
      if (fb) {
        const c: Pt = [fb.x + fb.w / 2, fb.y + fb.h / 2];
        const p0 = before(c), p1 = after(c);
        d = [p1[0] - p0[0], p1[1] - p0[1]];
      } else {
        d = [to.offset[0] - from.offset[0], to.offset[1] - from.offset[1]];
      }
      const next: Pt = [o[0] + d[0], o[1] + d[1]];
      out.push({ id: f, from: { offset: o, turn: turns[f] ?? IDENTITY }, to: { offset: next, turn: turns[f] ?? IDENTITY } });
      offsets[f] = next;
    }
    return out;
  };
```

In the `move` pose-change half, replace the `for (const f of followers(id)) { … }` loop with `items.push(...followerItems(id, { offset: offset0, turn: turn0 }, { offset, turn }, movedFollowers, ids));`. In `arrange`, delete `let delta: Pt | null = null;`, the `delta = …` assignment (keep the offset update), the `if (delta === null) continue;` and the follower loop; after `if (turn) turns[p.id] = turn;` add `items.push(...followerItems(p.id, { offset: input.pose.offset, turn: input.pose.turn }, { offset, turn }, movedFollowers, ids));`. Remove the now-unused `followers` closures in both branches. Update the comment above the arrange loop: followers ride the pose change, zipper and fan included.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/followers.test.ts tests/plan.test.ts tests/arrange.test.ts tests/arrange-fan-hex.test.ts tests/examples.test.ts && npx tsc --noEmit`
Expected: all PASS.

---

### Task 4: `flip` — reflection in the pose model, the turn-over tween

**Files:**
- Modify: `src/render/pose.ts` (whole file — `Turn.mirror`, `composeFlip`, `isIdentity` exported, `poseOf` mirror)
- Modify: `src/render/backend.ts:13-36` (`setTransform` signature, `Squash` type)
- Modify: `src/render/svg-backend.ts` (`poseTransform` 586-594; `SvgElementHandle.setTransform` ~634-640; `buildNodes` pose line ~943)
- Modify: `src/render/plan.ts` (`TransformItem` ~92-96; `currentBox` identity test ~269; `ACTION_KEYS` ~284; a new `flip` branch after `arrange`)
- Modify: `src/render/player.ts` (`applyScene` ~406; `move` case ~1022; `transform` case 1028-1044)
- Modify: `src/spec/types.ts` (`FlipArgs` after `FadeArgs`; `Command.flip`)
- Modify: `src/spec/schema.ts` (a `flip` command schema after `fade`; `ACTION_VERBS`; the verb list in `commandSchema.description`)
- Modify: `src/lint/lint.ts:252`, `src/llm/subtitles.ts:60`
- Modify: `src/llm/prompts/compiler-v1.md` (a `flip` bullet after the `fade` bullet, line ~64)
- Test: `tests/pose.test.ts` (extend), `tests/flip.test.ts` (new; plan + mini-DOM backend)

**Interfaces:**
- Consumes: `resolvePoint`, `anchorNow`, `followerItems`, `IDENTITY` (Tasks 2–3).
- Produces: `Turn.mirror?: boolean`; `export function composeFlip(offset: Pt, turn: Turn | undefined, phiDeg: number, lineNow: Pt): { offset: Pt; turn: Turn }`; `export const isIdentity(turn: Turn | undefined): boolean`; `export interface Squash { at: Pt; angle: number; k: number }` in `backend.ts`; `RenderedElement.setTransform?(dx, dy, deg, pivot, scale?, mirror?, squash?)`; `TransformItem.flip?: { at: Pt; angle: number }`; `export function poseTransform(dx, dy, deg, pivot, scale = 1, mirror = false, squash?: Squash): string | null`.

- [ ] **Step 1: Write the failing pose tests**

Append to `tests/pose.test.ts` (add `composeFlip`, `composeScale` to the existing import line):

```ts
describe("composeFlip (design §2.3)", () => {
  test("a vertical mirror through the element's own centre keeps the offset and sets mirror", () => {
    const r = composeFlip([10, 0], undefined, 90, [60, 25]); // element centre now at (60,25)
    expect(r.turn.mirror).toBe(true);
    expect(r.turn.deg % 360).toBe(0);
    close(r.offset, [10, 0]);
    close(poseOf(r.offset, r.turn)([0, 0]), [110, 0]); // current (10,0) reflected across x=60 → (110,0)
    close(poseOf(r.offset, r.turn)([50, 25]), [60, 25]); // the centre stays
  });
  test("a horizontal mirror through the origin flips y, and inverts", () => {
    const r = composeFlip([0, 0], undefined, 0, [0, 0]);
    close(poseOf(r.offset, r.turn)([3, 4]), [3, -4]);
    close(poseOf(r.offset, r.turn, true)([3, -4]), [3, 4]);
  });
  test("two flips across the same line are the identity", () => {
    const a = composeFlip([5, 7], undefined, 90, [100, 0]);
    const b = composeFlip(a.offset, a.turn, 90, [100, 0]);
    close(poseOf(b.offset, b.turn)([20, 30]), [25, 37]);
    expect(b.turn.mirror).toBe(false);
  });
  test("a flip across a 45° line through the origin swaps x and y", () => {
    const r = composeFlip([0, 0], undefined, 45, [0, 0]);
    close(poseOf(r.offset, r.turn)([3, 1]), [1, 3]);
  });
  test("a turn and a scale after a mirror keep composing exactly", () => {
    const m = composeFlip([0, 0], undefined, 90, [0, 0]); // x ↦ −x
    const t = composeTurn(m.offset, m.turn, 90, [0, 0]); // then rotate 90° about the origin
    close(poseOf(t.offset, t.turn)([1, 0]), [0, -1]); // (1,0) → (−1,0) → (0,−1)
    const s = composeScale(t.offset, t.turn, 2, [0, 0]);
    close(poseOf(s.offset, s.turn)([1, 0]), [0, -2]);
    expect(s.turn.mirror).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/pose.test.ts`
Expected: FAIL — `composeFlip` is not exported.

- [ ] **Step 3: The pose model**

Replace the body of `src/render/pose.ts` (Edit the whole file region by region; the file is 67 lines) so it reads:

```ts
// The pose of a moved, turned, scaled and possibly mirrored element (design
// §2.1, §2.3): x ↦ s·R(deg)·Mᵐ(x − p) + p + offset, with the pivot p stored in
// the element's ORIGINAL frame and M the reflection across the vertical line
// through p (x ↦ −x relative to p), applied BEFORE the rotation.
//   composeTurn:  R(δ,Q)(T(x)) = s·R(deg+δ)·Mᵐ(x−p) + p + [R(δ)(p + t − Q) + Q − p]
//   composeScale: S(k,Q)(T(x)) = ks·R(deg)·Mᵐ(x−p) + p + [k(p + t − Q) + Q − p]
//   composeFlip:  Refl_{Q,φ}(y) = R(2φ+180)·M·(y − Q) + Q and M·R(θ) = R(−θ)·M, so
//                 deg' = 2φ + 180 − deg, m' = ¬m, offset' = R(2φ+180)·M·(p + t − Q) + Q − p
import type { Pt } from "../layout/model";

export interface Turn {
  deg: number;
  pivot: Pt;
  /** Uniform scale about the same pivot (absent = 1). */
  scale?: number;
  /** Reflected across the vertical line through the pivot, before the rotation (absent = false). */
  mirror?: boolean;
}

/** True when the pose is still the identity, so a new pivot may be chosen. */
export const isIdentity = (turn: Turn | undefined): boolean => !turn || (turn.deg === 0 && (turn.scale ?? 1) === 1 && !turn.mirror);

const rad = (deg: number): number => (deg * Math.PI) / 180;
const normDeg = (deg: number): number => ((deg % 360) + 360) % 360;

/** Rotate a vector by deg about the origin (counter-clockwise, y-up). */
export function rotateVec([x, y]: Pt, deg: number): Pt {
  const c = Math.cos(rad(deg));
  const s = Math.sin(rad(deg));
  return [x * c - y * s, x * s + y * c];
}

export function composeTurn(offset: Pt, turn: Turn | undefined, deltaDeg: number, pivotNow: Pt): { offset: Pt; turn: Turn } {
  const p: Pt = isIdentity(turn) ? [pivotNow[0] - offset[0], pivotNow[1] - offset[1]] : turn!.pivot;
  const deg = (turn?.deg ?? 0) + deltaDeg;
  const v: Pt = [p[0] + offset[0] - pivotNow[0], p[1] + offset[1] - pivotNow[1]];
  const rv = rotateVec(v, deltaDeg);
  const next: Pt = [rv[0] + pivotNow[0] - p[0], rv[1] + pivotNow[1] - p[1]];
  return { offset: next, turn: { deg, pivot: p, scale: turn?.scale ?? 1, mirror: turn?.mirror ?? false } };
}

export function composeScale(offset: Pt, turn: Turn | undefined, factor: number, pivotNow: Pt): { offset: Pt; turn: Turn } {
  const p: Pt = isIdentity(turn) ? [pivotNow[0] - offset[0], pivotNow[1] - offset[1]] : turn!.pivot;
  const scale = (turn?.scale ?? 1) * factor;
  const v: Pt = [p[0] + offset[0] - pivotNow[0], p[1] + offset[1] - pivotNow[1]];
  const next: Pt = [factor * v[0] + pivotNow[0] - p[0], factor * v[1] + pivotNow[1] - p[1]];
  return { offset: next, turn: { deg: turn?.deg ?? 0, pivot: p, scale, mirror: turn?.mirror ?? false } };
}

/** Reflect across the line through `lineNow` (current coordinates) at `phiDeg` degrees from +x (counter-clockwise). */
export function composeFlip(offset: Pt, turn: Turn | undefined, phiDeg: number, lineNow: Pt): { offset: Pt; turn: Turn } {
  const p: Pt = isIdentity(turn) ? [lineNow[0] - offset[0], lineNow[1] - offset[1]] : turn!.pivot;
  const rot = 2 * phiDeg + 180;
  const deg = normDeg(rot - (turn?.deg ?? 0));
  const v: Pt = [p[0] + offset[0] - lineNow[0], p[1] + offset[1] - lineNow[1]];
  const rv = rotateVec([-v[0], v[1]], rot);
  const next: Pt = [rv[0] + lineNow[0] - p[0], rv[1] + lineNow[1] - p[1]];
  return { offset: next, turn: { deg, pivot: p, scale: turn?.scale ?? 1, mirror: !(turn?.mirror ?? false) } };
}

/** The pose as a point map (original → current), or its inverse. */
export function poseOf(offset: Pt, turn: Turn | undefined, inverse = false): (x: Pt) => Pt {
  const deg = turn?.deg ?? 0;
  const p: Pt = turn?.pivot ?? [0, 0];
  const s = turn?.scale ?? 1;
  const m = turn?.mirror ?? false;
  if (!inverse) {
    return ([x, y]) => {
      const r = rotateVec([m ? -(x - p[0]) : x - p[0], y - p[1]], deg);
      return [s * r[0] + p[0] + offset[0], s * r[1] + p[1] + offset[1]];
    };
  }
  return ([x, y]) => {
    const r = rotateVec([(x - offset[0] - p[0]) / s, (y - offset[1] - p[1]) / s], -deg);
    return [(m ? -r[0] : r[0]) + p[0], r[1] + p[1]];
  };
}

/** Where a bounding-box centre sits under a pose (the pivot default and `to` both use it). */
export function poseCentre(box: { x: number; y: number; w: number; h: number }, offset: Pt, turn: Turn | undefined): Pt {
  return poseOf(offset, turn)([box.x + box.w / 2, box.y + box.h / 2]);
}
```

Run `npx vitest run tests/pose.test.ts` — PASS. In `src/render/plan.ts` `currentBox`, replace the inline identity test with `if (isIdentity(turn))` (import it from `./pose`).

- [ ] **Step 4: Backend — mirror and squash in the transform string**

`src/render/backend.ts`: add

```ts
/** The turn-over tween's squash: y ↦ at + Par(y − at) + k·Perp(y − at) about the
 *  line through `at` at `angle` degrees (y-up, counter-clockwise from +x). A
 *  per-frame prefix in CURRENT coordinates — never part of a settled pose. */
export interface Squash { at: Pt; angle: number; k: number }
```

and change the method to `setTransform?(dx: number, dy: number, deg: number, pivot: Pt, scale?: number, mirror?: boolean, squash?: Squash): void;` with the doc line "`mirror` reflects across the vertical line through the pivot before the rotation".

`src/render/svg-backend.ts` `poseTransform` (import `Squash` from `./backend`):

```ts
export function poseTransform(dx: number, dy: number, deg: number, pivot: Pt, scale = 1, mirror = false, squash?: Squash): string | null {
  const parts: string[] = [];
  if (squash && squash.k < 1) {
    // Applied LAST (outermost): squash perpendicular to the mirror line. In
    // SVG's y-down frame a y-up line at φ lies at −φ, so rotate(φ) aligns it
    // with the x-axis; scale y; rotate back.
    const qx = squash.at[0].toFixed(1);
    const qy = (CANVAS.h - squash.at[1]).toFixed(1);
    const k = Math.max(squash.k, 0.002).toFixed(4);
    parts.push(`translate(${qx} ${qy}) rotate(${(-squash.angle).toFixed(2)}) scale(1 ${k}) rotate(${squash.angle.toFixed(2)}) translate(${(-squash.at[0]).toFixed(1)} ${(-(CANVAS.h - squash.at[1])).toFixed(1)})`);
  }
  const px = pivot[0].toFixed(1);
  const py = (CANVAS.h - pivot[1]).toFixed(1);
  if (dx !== 0 || dy !== 0) parts.push(`translate(${dx.toFixed(1)} ${(-dy).toFixed(1)})`);
  if (deg !== 0) parts.push(`rotate(${(-deg).toFixed(2)} ${px} ${py})`);
  if (scale !== 1 || mirror) {
    // The canvas's y-flip commutes with a mirror in x, so scale(−s, s) about P is the reflection.
    parts.push(`translate(${px} ${py}) scale(${(mirror ? -scale : scale).toFixed(4)} ${scale.toFixed(4)}) translate(${(-pivot[0]).toFixed(1)} ${(-(CANVAS.h - pivot[1])).toFixed(1)})`);
  }
  return parts.length === 0 ? null : parts.join(" ");
}
```

`SvgElementHandle.setTransform(dx, dy, deg, pivot, scale = 1, mirror = false, squash?: Squash)` passes all seven through. In `buildNodes` (~943): `poseTransform(dx, dy, turn.deg, turn.pivot, turn.scale ?? 1, turn.mirror ?? false)`.

- [ ] **Step 5: Types, schema, enumerations, prompt**

`src/spec/types.ts`, after `FadeArgs`:

```ts
export interface FlipArgs {
  /** Element ids, or one pieces id. */
  target: string[] | string;
  /** Mirror axis through `through` (default vertical). */
  axis?: "vertical" | "horizontal";
  /** A point on the axis (default: each target's own current centre). */
  through?: PointRef;
  /** An explicit mirror line (overrides axis/through). */
  line?: { from: PointRef; to: PointRef };
  /** seconds (default 1.2) */
  duration?: number;
  easing?: Easing;
}
```

and in `Command`: `/** Reflect elements across a line, played as a turn-over. */ flip?: FlipArgs;`.

`src/spec/schema.ts`, after `fade`:

```ts
    flip: {
      type: "object",
      description:
        "Reflect elements across a mirror line, played as a turn-over — the fourth transformation beside slide, turn and grow: {\"flip\": {\"target\": [\"tri\"], \"axis\": \"vertical\"}} mirrors about a vertical line through the element's own centre; \"line\": {\"from\": {\"ref\": \"axis\", \"anchor\": \"start\"}, \"to\": {\"ref\": \"axis\", \"anchor\": \"end\"}} mirrors across a drawn line. Attached labels follow (they never turn over themselves).",
      properties: {
        target: idListSchema("Element ids, or one pieces id."),
        axis: { type: "string", enum: ["vertical", "horizontal"], description: "The mirror line's direction through `through` (default vertical)." },
        through: pointRefSchema("A point the mirror line passes through (default: the target's own centre; {\"anchor\": \"left\"} with no ref is the target's own left edge)"),
        line: {
          type: "object",
          description: "An explicit mirror line from one point to another — overrides axis/through.",
          properties: { from: pointRefSchema("One point on the line"), to: pointRefSchema("Another point on the line") },
          required: ["from", "to"],
          additionalProperties: false,
        },
        duration: { type: "number", description: "Seconds (default 1.2)." },
        easing: { type: "string", enum: ["linear", "ease-in", "ease-out", "ease-in-out"], description: "Velocity profile (default ease-in-out)." },
      },
      required: ["target"],
      additionalProperties: false,
    },
```

Add `"flip"` to `ACTION_VERBS` (schema ~822), `ACTION_KEYS` (plan ~284 and lint 252), the verb list in `commandSchema.description` (~294), and the list at `src/llm/subtitles.ts:60`.

`src/llm/prompts/compiler-v1.md`, after the `fade` bullet:

```
- `flip`: `{"flip": {"target": ["tri"], "line": {"from": {"ref": "axis", "anchor": "start"}, "to": {"ref": "axis", "anchor": "end"}}}}` — mirrors elements across a line (or `"axis": "vertical" | "horizontal"` through `through`, default the element's own centre), played as a turn-over. Reflection is the one transformation slide + turn cannot make — use it for symmetry, congruence and mirror images.
```

- [ ] **Step 6: Planner `flip` branch and the tween**

`src/render/plan.ts`: `TransformItem` gains `/** A flip: the player plays two squashed halves about this line instead of interpolating the poses. */ flip?: { at: Pt; angle: number };`. After the `arrange` branch (import `composeFlip`):

```ts
    } else if (cmd.flip !== undefined) {
      const ids = resolveIds(cmd.flip.target, "flip");
      if (ids.length === 0) continue;
      const line = cmd.flip.line ? { from: resolvePoint(cmd.flip.line.from, undefined, "flip"), to: resolvePoint(cmd.flip.line.to, undefined, "flip") } : null;
      const items: TransformItem[] = [];
      const movedFollowers = new Set<string>();
      for (const id of ids) {
        if (!visibleSet.has(id)) warnings.push(`flip target "${id}" is not visible at that point (still flipped)`);
        const offset0: Pt = offsets[id] ?? [0, 0];
        const turn0 = turns[id];
        let at: Pt | null;
        let angle: number;
        if (line && line.from && line.to) {
          at = line.from;
          angle = (Math.atan2(line.to[1] - line.from[1], line.to[0] - line.from[0]) * 180) / Math.PI;
        } else {
          at = resolvePoint(cmd.flip.through, id, "flip") ?? anchorNow(id, "center", "flip");
          angle = cmd.flip.axis === "horizontal" ? 0 : 90;
        }
        if (!at) {
          warnings.push(`flip target "${id}" has no geometry (skipped)`);
          continue;
        }
        const c = composeFlip(offset0, turn0, angle, at);
        items.push({ id, from: { offset: offset0, turn: turn0 ?? IDENTITY }, to: c, flip: { at, angle } });
        offsets[id] = c.offset;
        turns[id] = c.turn;
        items.push(...followerItems(id, { offset: offset0, turn: turn0 }, c, movedFollowers, ids));
      }
      if (items.length === 0) continue;
      pushStep({ kind: "transform", items, seconds: cmd.flip.duration ?? 1.2, easing: cmd.flip.easing ?? "ease-in-out" });
```

`src/render/player.ts` `transform` case — inside the per-item loop, before the interpolation:

```ts
            if (it.flip) {
              const half = e < 0.5;
              const pose = half ? it.from : it.to;
              const k = half ? 1 - 2 * e : 2 * e - 1;
              if (el!.setTransform) el!.setTransform(pose.offset[0], pose.offset[1], pose.turn.deg, pose.turn.pivot, pose.turn.scale ?? 1, pose.turn.mirror ?? false, e >= 1 ? undefined : { at: it.flip.at, angle: it.flip.angle, k });
              else el!.setOffset!(pose.offset[0], pose.offset[1]);
              continue;
            }
```

and in the non-flip path pass `it.to.turn.mirror ?? false` as the sixth argument. `applyScene` (~406) and the `move` case (~1022): pass `turn.mirror ?? false`.

- [ ] **Step 7: Write the flip plan + backend tests**

Create `tests/flip.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { planCommands, type PlanStep } from "../src/render/plan";
import { poseOf } from "../src/render/pose";
import { poseTransform, rendererFor } from "../src/render/svg-backend";
import { layoutSpec } from "../src/layout/layout";
import { heuristicMeasure } from "../src/layout/measure";
import { validateSpec } from "../src/spec/schema";
import { installMiniDom, FakeNode } from "./helpers/mini-dom";

const box = (x: number, y: number, w: number, h: number) => ({ x, y, w, h });

describe("flip planning", () => {
  const opts = {
    bboxOf: (id: string) => (id === "tri" ? box(100, 100, 100, 100) : id === "ax" ? box(400, 0, 0, 700) : null),
    anchorOf: (id: string, name: string) => (id === "ax" ? ({ start: [400, 0], end: [400, 700] } as Record<string, [number, number]>)[name] ?? null : null),
  };
  test("a vertical flip about the element's own centre keeps its centre and mirrors", () => {
    const plan = planCommands([{ flip: { target: ["tri"] } }], ["tri"], opts);
    const st = plan.states[0];
    expect(st.turns.tri.mirror).toBe(true);
    const c = poseOf(st.offsets.tri, st.turns.tri)([150, 150]);
    expect(c[0]).toBeCloseTo(150, 6);
    expect(c[1]).toBeCloseTo(150, 6);
    const step = plan.steps[0] as Extract<PlanStep, { kind: "transform" }>;
    expect(step.items[0].flip).toEqual({ at: [150, 150], angle: 90 });
    expect(step.seconds).toBe(1.2);
  });
  test("a flip across a drawn line sends the element to the other side", () => {
    const plan = planCommands([{ flip: { target: ["tri"], line: { from: { ref: "ax", anchor: "start" }, to: { ref: "ax", anchor: "end" } } } }], ["tri", "ax"], opts);
    const st = plan.states[0];
    const c = poseOf(st.offsets.tri, st.turns.tri)([150, 150]);
    expect(c[0]).toBeCloseTo(650, 6);
    expect(c[1]).toBeCloseTo(150, 6);
  });
  test("the schema accepts flip", () => {
    const spec = { elements: [{ id: "tri", type: "polygon", points: [[0, 0], [10, 0], [0, 10]] }], commands: [{ flip: { target: ["tri"], axis: "horizontal" }, speak: "Mirror it." }] };
    expect(validateSpec(spec as never).ok).toBe(true);
  });
});

describe("mirror and squash in the SVG transform", () => {
  test("a mirrored pose scales x by −s about the pivot", () => {
    expect(poseTransform(0, 0, 0, [100, 100], 1, true)).toBe("translate(100.0 650.0) scale(-1.0000 1.0000) translate(-100.0 -650.0)");
  });
  test("a squash prefixes the pose; k ≥ 1 adds nothing", () => {
    const s = poseTransform(0, 0, 0, [0, 0], 1, false, { at: [500, 375], angle: 90, k: 0.5 });
    expect(s).toContain("scale(1 0.5000)");
    expect(s!.startsWith("translate(500.0 375.0) rotate(-90.00)")).toBe(true);
    expect(poseTransform(0, 0, 0, [0, 0], 1, false, { at: [500, 375], angle: 90, k: 1 })).toBeNull();
  });
  test("setTransform writes the mirror onto every group of the element", async () => {
    const { restore, doc } = installMiniDom();
    try {
      const spec = { elements: [{ id: "tri", type: "polygon", points: [[100, 100], [300, 100], [200, 300]], style: { fill: "#f2c14e" } }], commands: [{ draw: ["tri"] }] };
      const layout = layoutSpec(spec as never, heuristicMeasure);
      const container = new FakeNode("div", doc as never);
      const mounted = await rendererFor("clean").mount(layout, spec as never, container as never);
      const tri = mounted.elements.get("tri")!;
      tri.setTransform!(0, 0, 0, [200, 166], 1, true);
      const groups: FakeNode[] = [];
      const walk = (n: FakeNode) => { if (n.dataset.leafId === "tri" || n.dataset.leafId === "tri_wash") groups.push(n); n.children.forEach(walk); };
      walk(container);
      expect(groups.length).toBeGreaterThan(0);
      for (const g of groups) expect(g.getAttribute("transform")).toContain("scale(-1.0000 1.0000)");
    } finally {
      restore();
    }
  });
});
```

- [ ] **Step 8: Run everything touched**

Run: `npx vitest run tests/pose.test.ts tests/flip.test.ts tests/plan.test.ts tests/followers.test.ts tests/fade-opacity.test.ts tests/schema.test.ts tests/prompt.test.ts tests/examples.test.ts && npx tsc --noEmit`
Expected: all PASS.

---
### Task 5: `morph` — an outline tweened to new points, another outline, or a stretch

**Files:**
- Create: `src/render/morph.ts`
- Modify: `src/spec/types.ts` (`MorphArgs` after `FlipArgs`; `Command.morph`)
- Modify: `src/spec/schema.ts` (a `morph` command schema after `flip`; `ACTION_VERBS`; the verb list in `commandSchema.description`; a semantic check "morph needs exactly one of to, stretch, reset")
- Modify: `src/render/plan.ts` (`SceneState.shapes`; `INITIAL_STATE`; the state snapshot at ~202; `PlanOptions.leafPointsOf`; `ACTION_KEYS`; a `boxOf` wrapper used by `currentBox` / `anchorOriginal`; a `morph` branch; `PlanStep` gains `morph`)
- Modify: `src/render/backend.ts` (`RenderedElement.setPoints`; `MountResult.swapGeometry` gains `shapes`)
- Modify: `src/render/svg-backend.ts` (`SvgElementHandle` constructor + `setPoints`; both `new SvgElementHandle(` sites ~987 and ~1019; `buildNodes` substitutes morphed points; `swapGeometry`)
- Modify: `src/render/player.ts` (`Reprojector.frame` gains `shapes`; `applyScene`; the `animate` case's `rp.frame(...)` call; a `morph` case)
- Modify: `src/render/index.ts` (`planOptionsFor` returns `leafPointsOf`; the reprojector's `frame` forwards `shapes`)
- Modify: `src/lint/lint.ts:252`, `src/llm/subtitles.ts:60`, `src/llm/prompts/compiler-v1.md` (a `morph` bullet after `flip`)
- Test: `tests/morph.test.ts` (new)

**Interfaces:**
- Consumes: `resolvePoint`, `anchorNow`, `anchorOriginal` (Task 2), `poseOf`, `ptsBox`, `polygonAnchors`.
- Produces (`src/render/morph.ts`): `resamplePolyline(pts: Pt[], closed: boolean, k: number): Pt[]`, `alignRing(from: Pt[], to: Pt[]): Pt[]`, `morphPair(from: Pt[], fromClosed: boolean, to: Pt[], toClosed: boolean): { from: Pt[]; to: Pt[] }`, `stretchPts(pts: Pt[], pivot: Pt, sx: number, sy: number): Pt[]`. In plan: `SceneState.shapes: Record<string, Record<string, Pt[]>>` (element id → leaf id → ORIGINAL-frame points), `PlanOptions.leafPointsOf?: (id: string) => { leafId: string; pts: Pt[]; closed: boolean }[] | null`, `PlanStep` `{ kind: "morph"; items: MorphItem[]; seconds: number; easing: Easing }` with `export interface MorphItem { id: string; leaves: { leafId: string; from: Pt[]; to: Pt[] }[] }`, and the closure `boxOf(id): BBox | null` (Task 6 extends it). Backend: `RenderedElement.setPoints?(points: Record<string, Pt[]>): void` (leaves not listed go back to their layout points), `swapGeometry(layout, visible, offsets, turns?, opacities?, shapes?)`, `Reprojector.frame(params, visible, offsets, turns, opacities, revealNew?, elements?, shapes?)`.

- [ ] **Step 1: Write the failing tests**

Create `tests/morph.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { alignRing, morphPair, resamplePolyline, stretchPts } from "../src/render/morph";
import { planCommands, type PlanStep } from "../src/render/plan";
import { rendererFor } from "../src/render/svg-backend";
import { layoutSpec } from "../src/layout/layout";
import { heuristicMeasure } from "../src/layout/measure";
import { planOptionsFor } from "../src/render/index";
import { validateSpec } from "../src/spec/schema";
import { installMiniDom, FakeNode } from "./helpers/mini-dom";

type P = [number, number];
const square: P[] = [[0, 0], [100, 0], [100, 100], [0, 100]];

describe("morph geometry", () => {
  test("resamplePolyline spaces k points evenly by arc length; a closed ring excludes the repeated start", () => {
    const open = resamplePolyline([[0, 0], [100, 0]], false, 5);
    expect(open).toEqual([[0, 0], [25, 0], [50, 0], [75, 0], [100, 0]]);
    const ring = resamplePolyline(square, true, 8);
    expect(ring).toHaveLength(8);
    expect(ring[0]).toEqual([0, 0]);
    expect(ring[2]).toEqual([100, 0]);
    expect(ring[4]).toEqual([100, 100]);
  });
  test("alignRing rotates the target's start so a ring does not twist", () => {
    const from = resamplePolyline(square, true, 8);
    const rotated = [...from.slice(3), ...from.slice(0, 3)];
    expect(alignRing(from, rotated)).toEqual(from);
  });
  test("morphPair resamples both sides to K = max(len, len, 24)", () => {
    const { from, to } = morphPair(square, true, [[0, 0], [200, 0], [200, 100], [0, 100], [0, 50]], true);
    expect(from).toHaveLength(24);
    expect(to).toHaveLength(24);
  });
  test("stretchPts scales about the pivot per axis", () => {
    expect(stretchPts([[10, 10]], [0, 0], 2, 1)).toEqual([[20, 10]]);
  });
});

const SPEC = {
  elements: [
    { id: "para", type: "polygon", points: [[200, 250], [550, 250], [700, 500], [350, 500]], style: { fill: "#87a878" } },
    { id: "rekt", type: "polygon", points: [[200, 250], [550, 250], [550, 500], [200, 500]] },
    { id: "dot", type: "shape", shape: "circle", x: 800, y: 600, radius: 20 },
  ],
  commands: [{ draw: ["para", "rekt", "dot"] }],
};

describe("morph planning", () => {
  const layout = layoutSpec(SPEC as never, heuristicMeasure);
  const opts = { bboxOf: (id: string) => (id === "dot" ? { x: 780, y: 580, w: 40, h: 40 } : { x: 200, y: 250, w: 500, h: 250 }), ...planOptionsFor(SPEC as never, layout) };
  const morphStep = (plan: ReturnType<typeof planCommands>, i: number) => plan.steps[i] as Extract<PlanStep, { kind: "morph" }>;

  test("to {ref} morphs every leaf (outline and wash) to the ref's ring and stores the shape in the state", () => {
    const plan = planCommands([{ draw: ["para", "rekt"] }, { morph: { target: ["para"], to: { ref: "rekt" } } }], layout.order, opts);
    expect(plan.warnings).toEqual([]);
    const step = morphStep(plan, 1);
    expect(step.seconds).toBe(1.5);
    const leafIds = step.items[0].leaves.map((l) => l.leafId).sort();
    expect(leafIds).toEqual(["para", "para_wash"]);
    for (const l of step.items[0].leaves) expect(l.from).toHaveLength(l.to.length);
    const shape = plan.states[1].shapes.para.para;
    const xs = shape.map((p) => p[0]);
    expect(Math.max(...xs)).toBeCloseTo(550, 6); // the parallelogram's far corner at 700 has come in to the rectangle's 550
  });
  test("stretch [2, 1] about the element's left edge doubles its width; a morphed id's anchors and box follow", () => {
    const plan = planCommands([{ draw: ["para"] }, { morph: { target: ["para"], stretch: [2, 1], pivot: { anchor: "left" } } }, { move: { target: ["dot"], to: { ref: "para", anchor: "right" } } }], layout.order, opts);
    expect(plan.warnings).toEqual([]);
    const shape = plan.states[1].shapes.para.para;
    expect(Math.max(...shape.map((p) => p[0]))).toBeCloseTo(1200, 6); // 200 + 2·(700 − 200)
    const mv = plan.steps[2] as Extract<PlanStep, { kind: "transform" }>;
    expect(mv.items[0].to.offset[0]).toBeCloseTo(1200 - 800, 6);
  });
  test("reset tweens back to the layout points and clears the state; a shape circle warns", () => {
    const plan = planCommands([{ draw: ["para", "dot"] }, { morph: { target: ["para"], stretch: [2, 1] } }, { morph: { target: ["para"], reset: true } }, { morph: { target: ["dot"], stretch: [2, 2] } }], layout.order, opts);
    expect(plan.states[2].shapes.para).toBeUndefined();
    expect(plan.warnings.join(" ")).toMatch(/dot/);
  });
  test("the schema requires exactly one of to / stretch / reset", () => {
    const bad = { ...SPEC, commands: [{ morph: { target: ["para"] } }] };
    expect(validateSpec(bad as never).ok).toBe(false);
    const good = { ...SPEC, commands: [{ morph: { target: ["para"], to: [[0, 0], [10, 0], [10, 10]] } }] };
    expect(validateSpec(good as never).ok).toBe(true);
  });
});

describe("setPoints on the SVG backend", () => {
  for (const style of ["clean", "sketchy"] as const) {
    test(`rebuilds the leaf's path with the new points and restores it when unlisted (${style})`, async () => {
      const { restore, doc } = installMiniDom();
      try {
        const layout = layoutSpec(SPEC as never, heuristicMeasure);
        const container = new FakeNode("div", doc as never);
        const mounted = await rendererFor(style).mount(layout, SPEC as never, container as never);
        const para = mounted.elements.get("para")!;
        para.finish();
        const leaf = () => {
          const out: FakeNode[] = [];
          const walk = (n: FakeNode) => { if (n.dataset.leafId === "para") out.push(n); n.children.forEach(walk); };
          walk(container);
          return out[0];
        };
        // rough.js nests its paths one level down, so read every `d` in the subtree
        const dOf = (n: FakeNode) => {
          const out: string[] = [];
          const walk = (x: FakeNode) => { const d = x.getAttribute("d"); if (d) out.push(d); x.children.forEach(walk); };
          walk(n);
          return out.join("|");
        };
        const before = dOf(leaf());
        expect(before.length).toBeGreaterThan(0);
        para.setPoints!({ para: [[200, 250], [550, 250], [550, 500], [200, 500]] });
        const after = dOf(leaf());
        expect(after).not.toBe(before);
        para.setPoints!({});
        expect(dOf(leaf())).toBe(before);
      } finally {
        restore();
      }
    });
  }
});
```

(`planOptionsFor` is exported from `src/render/index.ts`, which imports DOM-touching modules lazily — the existing `arrange` tests import it the same way; if that import drags in `document` at load, move the `SPEC`-based plan tests to use an inline `leafPointsOf` built from `leafDrawables(drawablesForId(layout.drawables, id))` instead.)

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/morph.test.ts`
Expected: FAIL — `src/render/morph` missing.

- [ ] **Step 3: `src/render/morph.ts`**

```ts
// Morph geometry (design §2.4): resampling by arc length so two outlines
// with different vertex counts tween point for point, and ring alignment so
// a closed shape does not twist on its way.
import type { Pt } from "../layout/model";

function cumulative(pts: Pt[]): number[] {
  const out = [0];
  for (let i = 1; i < pts.length; i++) out.push(out[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  return out;
}

/** k points evenly spaced by arc length. A closed ring is closed first (its
 *  last point rejoins its first) and the k samples exclude the repeated start. */
export function resamplePolyline(pts: Pt[], closed: boolean, k: number): Pt[] {
  if (pts.length === 0 || k <= 0) return [];
  const first = pts[0], last = pts[pts.length - 1];
  const ring = closed && (first[0] !== last[0] || first[1] !== last[1]) ? [...pts, first] : pts;
  const cum = cumulative(ring);
  const total = cum[cum.length - 1];
  if (total === 0) return Array.from({ length: k }, (): Pt => [first[0], first[1]]);
  const denom = closed ? k : Math.max(1, k - 1);
  const out: Pt[] = [];
  let j = 0;
  for (let i = 0; i < k; i++) {
    const s = (total * i) / denom;
    while (j < cum.length - 2 && cum[j + 1] < s) j++;
    const seg = cum[j + 1] - cum[j];
    const t = seg === 0 ? 0 : (s - cum[j]) / seg;
    out.push([ring[j][0] + (ring[j + 1][0] - ring[j][0]) * t, ring[j][1] + (ring[j + 1][1] - ring[j][1]) * t]);
  }
  return out;
}

/** Rotate a ring's start index to the one closest to `from` (least total squared distance). */
export function alignRing(from: Pt[], to: Pt[]): Pt[] {
  const k = to.length;
  if (k === 0 || from.length !== k) return to;
  let best = 0;
  let bestD = Infinity;
  for (let shift = 0; shift < k; shift++) {
    let d = 0;
    for (let i = 0; i < k && d < bestD; i++) {
      const p = to[(i + shift) % k];
      d += (p[0] - from[i][0]) ** 2 + (p[1] - from[i][1]) ** 2;
    }
    if (d < bestD) {
      bestD = d;
      best = shift;
    }
  }
  return to.map((_, i) => to[(i + best) % k]);
}

/** Both sides of a morph at a common count K = max(len(from), len(to), 24). */
export function morphPair(from: Pt[], fromClosed: boolean, to: Pt[], toClosed: boolean): { from: Pt[]; to: Pt[] } {
  const k = Math.max(from.length, to.length, 24);
  const a = resamplePolyline(from, fromClosed, k);
  let b = resamplePolyline(to, toClosed, k);
  if (fromClosed && toClosed) b = alignRing(a, b);
  return { from: a, to: b };
}

export function stretchPts(pts: Pt[], pivot: Pt, sx: number, sy: number): Pt[] {
  return pts.map(([x, y]): Pt => [pivot[0] + (x - pivot[0]) * sx, pivot[1] + (y - pivot[1]) * sy]);
}
```

- [ ] **Step 4: Types, schema, enumerations, prompt**

`src/spec/types.ts`:

```ts
export interface MorphArgs {
  /** Element ids, or one pieces id. */
  target: string[] | string;
  /** The new outline in canvas coordinates, or another element's outline. */
  to?: [number, number][] | { ref: string };
  /** Per-axis factors about `pivot` (default the element's centre). */
  stretch?: [number, number];
  pivot?: PointRef;
  /** Back to the layout's points. */
  reset?: boolean;
  /** seconds (default 1.5) */
  duration?: number;
  easing?: Easing;
}
```

`Command.morph?: MorphArgs;` ("Tween an outline to new points, another outline, or a stretch."). Schema after `flip`:

```ts
    morph: {
      type: "object",
      description:
        "Change an element's SHAPE smoothly: {\"morph\": {\"target\": [\"para\"], \"to\": {\"ref\": \"rekt\"}}} slides a parallelogram's outline into the rectangle (shearing — the stack of cards); \"stretch\": [2, 1] with \"pivot\": {\"anchor\": \"left\"} doubles the width from the left edge (non-uniform scaling — move.scale is uniform); \"to\": [[x, y], …] gives the outline; \"reset\": true goes back. Works on polygon, path, sector, arc, curve, region and pieces; a shape circle/rect cannot morph — declare a polygon.",
      properties: {
        target: idListSchema("Element ids, or one pieces id."),
        to: {
          oneOf: [
            { type: "array", items: { type: "array", items: { type: "number" }, minItems: 2, maxItems: 2 }, minItems: 3 },
            { type: "object", properties: { ref: { type: "string" } }, required: ["ref"], additionalProperties: false },
          ],
          description: "The new outline — [[x, y], …] in canvas coordinates (domain units when a domain is declared), or {\"ref\": id} for another element's outline as it is now.",
        },
        stretch: { type: "array", items: { type: "number", exclusiveMinimum: 0 }, minItems: 2, maxItems: 2, description: "[sx, sy] factors about pivot — e.g. [2, 1] doubles the width only." },
        pivot: pointRefSchema("With stretch: the fixed point (default the element's centre; {\"anchor\": \"bottom_left\"} without ref is its own corner)"),
        reset: { type: "boolean", description: "Back to the layout's own points." },
        duration: { type: "number", description: "Seconds (default 1.5)." },
        easing: { type: "string", enum: ["linear", "ease-in", "ease-out", "ease-in-out"], description: "Velocity profile (default ease-in-out)." },
      },
      required: ["target"],
      additionalProperties: false,
    },
```

Semantic check beside the `move` one (~892): `if (cmd.morph !== undefined) { const n = [cmd.morph.to !== undefined, cmd.morph.stretch !== undefined, cmd.morph.reset === true].filter(Boolean).length; if (n !== 1) errors.push(\`commands[${i}]: morph needs exactly one of to, stretch or reset\`); }`. Add `"morph"` to the four enumerations and `src/llm/subtitles.ts:60`.

Prompt bullet after `flip`:

```
- `morph`: `{"morph": {"target": ["para"], "to": {"ref": "rekt"}}}` — tweens an outline into another element's outline (shearing a parallelogram into the rectangle of the same base and height — the stack of cards), to explicit `"to": [[x, y], …]` points, or `"stretch": [2, 1]` about a `pivot` for a non-uniform scale (double the width, keep the height). `move.scale` grows uniformly; `morph` changes the shape. Polygons, paths, sectors, curves and regions morph; a `shape` circle does not.
```

- [ ] **Step 5: Planner**

In `src/render/plan.ts`:
- `SceneState` gains `/** Current ORIGINAL-frame points of every morphed leaf: element id → leaf id → points (absent = the layout's own). */ shapes: Record<string, Record<string, Pt[]>>;`; `INITIAL_STATE.shapes = {}`; the local `const shapes: Record<string, Record<string, Pt[]>> = {};`; the snapshot at ~202 adds `shapes: Object.fromEntries(Object.entries(shapes).map(([id, m]) => [id, { ...m }]))`.
- `PlanOptions.leafPointsOf?: (id: string) => { leafId: string; pts: Pt[]; closed: boolean }[] | null;` — "the morphable leaves of an element (stroke/area with pts, no shapeHint) in draw order, with their layout points".
- `PlanStep` gains `| { kind: "morph"; items: MorphItem[]; seconds: number; easing: Easing }` and `export interface MorphItem { id: string; leaves: { leafId: string; from: Pt[]; to: Pt[] }[] }`.
- Before `currentBox`, add the box wrapper and switch `currentBox` and `anchorOriginal` to it:

```ts
  /** The layout box of an id, or — once it has morphed — the box of its current points. */
  const boxOf = (id: string): BBox | null => {
    const s = shapes[id];
    if (s) {
      const b = ptsBox(Object.values(s).flat());
      if (b) return b;
    }
    return bboxOf(id);
  };
  const currentLeaves = (id: string) => {
    const base = opts.leafPointsOf?.(id);
    if (!base || base.length === 0) return null;
    return base.map((l) => ({ leafId: l.leafId, pts: shapes[id]?.[l.leafId] ?? l.pts, closed: l.closed, original: l.pts }));
  };
```

In `anchorOriginal`, before `opts.anchorOf`: `if (shapes[id] && !isUniversalAnchor(name)) { const leaves = currentLeaves(id); const primary = leaves?.find((l) => l.closed) ?? leaves?.[0]; const a = primary ? polygonAnchors(primary.pts)[name] : undefined; if (a) return a; }` (import `polygonAnchors`, `ptsBox`).

- The branch, after `flip`:

```ts
    } else if (cmd.morph !== undefined) {
      const ids = resolveIds(cmd.morph.target, "morph");
      if (ids.length === 0) continue;
      const modes = [cmd.morph.to !== undefined, cmd.morph.stretch !== undefined, cmd.morph.reset === true].filter(Boolean).length;
      if (modes !== 1) {
        warnings.push("morph needs exactly one of to, stretch or reset — skipped");
        continue;
      }
      let refRing: { pts: Pt[]; closed: boolean } | null = null;
      if (cmd.morph.to !== undefined && !Array.isArray(cmd.morph.to)) {
        const ref = cmd.morph.to.ref;
        const leaves = known.has(ref) ? currentLeaves(ref) : null;
        const primary = leaves?.find((l) => l.closed) ?? leaves?.[0];
        if (!primary) {
          warnings.push(`morph: "${ref}" has no outline to morph to — skipped`);
          continue;
        }
        const map = poseOf(offsets[ref] ?? [0, 0], turns[ref]);
        refRing = { pts: primary.pts.map(map), closed: primary.closed };
      }
      const items: MorphItem[] = [];
      for (const id of ids) {
        const leaves = currentLeaves(id);
        if (!leaves) {
          warnings.push(`morph target "${id}" has no outline to morph (a shape circle or rect cannot — use a polygon)`);
          continue;
        }
        const fwd = poseOf(offsets[id] ?? [0, 0], turns[id]);
        const inv = poseOf(offsets[id] ?? [0, 0], turns[id], true);
        const leafItems: MorphItem["leaves"] = [];
        const next: Record<string, Pt[]> = {};
        if (cmd.morph.reset) {
          for (const l of leaves) {
            const pair = morphPair(l.pts, l.closed, l.original, l.closed);
            leafItems.push({ leafId: l.leafId, from: pair.from, to: pair.to });
          }
          delete shapes[id];
        } else if (cmd.morph.stretch) {
          const [sx, sy] = cmd.morph.stretch;
          const q = resolvePoint(cmd.morph.pivot, id, "morph") ?? anchorNow(id, "center", "morph") ?? [0, 0];
          for (const l of leaves) {
            const to = stretchPts(l.pts.map(fwd), q, sx, sy).map(inv);
            leafItems.push({ leafId: l.leafId, from: l.pts, to });
            next[l.leafId] = to;
          }
          shapes[id] = next;
        } else {
          const ring = refRing ?? { pts: (cmd.morph.to as [number, number][]).map((p) => toLogical(p as Pt)), closed: true };
          for (const l of leaves) {
            const pair = morphPair(l.pts, l.closed, ring.pts.map(inv), refRing ? refRing.closed : l.closed);
            leafItems.push({ leafId: l.leafId, from: pair.from, to: pair.to });
            next[l.leafId] = pair.to;
          }
          shapes[id] = next;
        }
        items.push({ id, leaves: leafItems });
      }
      if (items.length === 0) continue;
      pushStep({ kind: "morph", items, seconds: cmd.morph.duration ?? 1.5, easing: cmd.morph.easing ?? "ease-in-out" });
```

(import `morphPair`, `stretchPts` from `./morph`). `src/render/index.ts` `planOptionsFor` adds:

```ts
    leafPointsOf: (id) => {
      const out: { leafId: string; pts: Pt[]; closed: boolean }[] = [];
      for (const d of leafDrawables(drawablesForId(layout.drawables, id))) {
        if ((d.kind === "stroke" && !d.shapeHint && d.pts.length >= 2) || (d.kind === "area" && d.pts.length >= 3)) out.push({ leafId: d.id, pts: d.pts, closed: d.kind === "area" || d.closed === true });
      }
      return out.length > 0 ? out : null;
    },
```

- [ ] **Step 6: Backend `setPoints` and `swapGeometry(shapes)`**

`src/render/backend.ts`: `RenderedElement` gains `/** Replace the points of the listed leaves (ORIGINAL-frame, keyed by leaf id) and rebuild them; every leaf NOT listed returns to its layout points. The pose transform stays on the leaf's group. */ setPoints?(points: Record<string, Pt[]>): void;`; `swapGeometry(layout, visible, offsets, turns?, opacities?, shapes?: Record<string, Record<string, Pt[]>>)`.

`src/render/svg-backend.ts`: introduce `interface LeafEntry { g: SVGGElement; leaf: Exclude<Drawable, { kind: "group" }>; fadeNode: SVGGElement }` (the shape `buildNodes` already pushes). Change `SvgElementHandle`:

```ts
  constructor(id: string, entries: LeafEntry[], private readonly rc: RoughSVG | null) {
    this.id = id;
    this.entries = entries;
    this.leaves = entries.map(({ g, leaf }) => makeLeafHandle(g, leaf));
    this.groups = entries.map(({ g }) => g);
    this.fadeGroups = entries.map(({ fadeNode }) => fadeNode);
    … (cumulative / durationMs / prepare as before)
  }
  private entries: LeafEntry[];
  private current = new Map<string, Pt[] | null>();

  /** Morph support: rebuild a leaf with new points, or with its own when unlisted. Same-reference points are a no-op, so applyScene's per-boundary call costs nothing. */
  setPoints(points: Record<string, Pt[]>): void {
    this.entries.forEach((e, i) => {
      const leaf = e.leaf;
      if ((leaf.kind !== "stroke" && leaf.kind !== "area") || leaf.shapeHint) return;
      const want = points[leaf.id] ?? null;
      if (want === (this.current.get(leaf.id) ?? null)) return;
      this.current.set(leaf.id, want);
      const drawable = want ? { ...leaf, pts: want } : leaf;
      const rebuilt = drawLeaf(this.rc, drawable);
      e.g.replaceChildren(...Array.from(rebuilt.children));
      this.leaves[i] = makeLeafHandle(e.g, drawable);
      this.leaves[i].prepare();
      this.leaves[i].setProgress(1);
    });
  }
```

Both construction sites become `new SvgElementHandle(id, entry, rc)` (the `rc` in scope at mount). `buildNodes` gains a trailing `shapes?: Record<string, Record<string, Pt[]>>` parameter and, where it picks the leaf to draw, uses `const pts = shapes?.[id]?.[leaf.id]; const drawn = pts && (leaf.kind === "stroke" || leaf.kind === "area") ? { ...leaf, pts } : leaf;` for `drawLeaf`. `swapGeometry: (l, visible, offsets, turns, opacities, shapes) => { …; buildNodes(l, new Map(), visible, offsets, turns, opacities, shapes); }`.

- [ ] **Step 7: Player**

`Reprojector.frame(params, visible, offsets, turns, opacities, revealNew?, elements?, shapes?)`; `src/render/index.ts` forwards `shapes` to `mounted.swapGeometry!(l, vis, offsets, turns, opacities, shapes)`. In the `animate` case: `rp.frame(cur, visible, before.offsets, before.turns, before.opacities, true, undefined, before.shapes)`. `applyScene` adds `el.setPoints?.(scene.shapes[id] ?? {});` after the opacity line. New case:

```ts
      case "morph": {
        const ease = EASINGS[step.easing];
        const items = step.items.map((it) => ({ it, el: this.elements.get(it.id) })).filter((x) => x.el?.setPoints);
        await this.progress(step.seconds * 1000, signal, (t) => {
          const e = ease(t);
          for (const { it, el } of items) {
            const pts: Record<string, Pt[]> = { ...(before.shapes[it.id] ?? {}) };
            for (const leaf of it.leaves) pts[leaf.leafId] = leaf.from.map((p, i): Pt => [p[0] + (leaf.to[i][0] - p[0]) * e, p[1] + (leaf.to[i][1] - p[1]) * e]);
            el!.setPoints!(pts);
          }
        });
        return;
      }
```

(`before` is the state before the step, already in scope in the step runner.) Check every other place that lists the step kinds (a `switch` with an exhaustive default, the subtitle track, `stepDuration` helpers) — `npx tsc --noEmit` reports the ones a union extension breaks.

- [ ] **Step 8: Run**

Run: `npx vitest run tests/morph.test.ts tests/plan.test.ts tests/fade-opacity.test.ts tests/flip.test.ts tests/animate.test.ts tests/player-raf.test.ts tests/schema.test.ts tests/prompt.test.ts tests/examples.test.ts && npx tsc --noEmit`
Expected: all PASS.

---

### Task 6: `trail` on `move` — the track of an anchor, as an element

**Files:**
- Create: `src/render/trails.ts`
- Modify: `src/spec/types.ts` (`MoveArgs.trail`), `src/spec/schema.ts` (`move.trail`)
- Modify: `src/render/plan.ts` (`Plan.trails`; `move` and `transform` steps gain `trails`; `boxOf` reads minted trail boxes; the `move` branch mints trails)
- Modify: `src/render/player.ts` (`move` and `transform` cases advance the trails)
- Modify: `src/render/index.ts` (`layoutFor` and the mounted layout go through `withTrails`)
- Modify: `src/llm/prompts/compiler-v1.md` (the `move` bullet gains the trail sentence)
- Test: `tests/trail.test.ts` (new)

**Interfaces:**
- Consumes: `pathPosition` (`src/render/effects.ts`), `anchorOriginal`, `boxOf`, `poseOf`, `IDENTITY`.
- Produces (`src/render/trails.ts`): `export interface TrailSpec { id: string; pts: Pt[]; color?: string; width: number }`, `export function cumulativeLengthFractions(pts: Pt[]): number[]`, `export function lengthFractionAt(table: number[], u: number): number`, `export function withTrails(layout: LayoutResult, trails: TrailSpec[]): LayoutResult`. In plan: `Plan.trails: TrailSpec[]`, `export interface TrailProgress { id: string; lengthAt: number[] }`, and `trails?: TrailProgress[]` on the `move` and `transform` steps. `MoveArgs.trail?: boolean | { of?: string; anchor?: string; color?: string; width?: number }`.

- [ ] **Step 1: Write the failing tests**

Create `tests/trail.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { planCommands, type PlanStep } from "../src/render/plan";
import { cumulativeLengthFractions, lengthFractionAt, withTrails } from "../src/render/trails";
import { layoutSpec } from "../src/layout/layout";
import { heuristicMeasure } from "../src/layout/measure";

const box = (x: number, y: number, w: number, h: number) => ({ x, y, w, h });

describe("trail helpers", () => {
  test("cumulativeLengthFractions runs 0 → 1 and lengthFractionAt interpolates", () => {
    const t = cumulativeLengthFractions([[0, 0], [10, 0], [10, 10]]);
    expect(t).toEqual([0, 0.5, 1]);
    expect(lengthFractionAt(t, 0.25)).toBeCloseTo(0.25, 6);
    expect(lengthFractionAt(t, 1)).toBe(1);
    expect(cumulativeLengthFractions([[5, 5], [5, 5]])).toEqual([0, 0]);
  });
  test("withTrails appends a stroke in the source's colour and keeps the layout otherwise", () => {
    const layout = layoutSpec({ elements: [{ id: "w", type: "shape", shape: "circle", x: 100, y: 100, radius: 20, style: { color: "#b5482e" } }], commands: [] } as never, heuristicMeasure);
    const out = withTrails(layout, [{ id: "w_trail", pts: [[100, 80], [200, 80]], width: 2.5 }]);
    expect(out.order).toEqual([...layout.order, "w_trail"]);
    const d = out.drawables.find((x) => x.id === "w_trail") as { style: { color: string; strokeWidth: number } };
    expect(d.style.color).toBe("#b5482e");
    expect(d.style.strokeWidth).toBe(2.5);
    expect(withTrails(layout, [])).toBe(layout);
  });
});

describe("trail planning", () => {
  const opts = { bboxOf: (id: string) => (id === "w" ? box(100, 200, 120, 120) : null) };
  test("a rolling wheel's bottom point traces a cycloid: 61 samples, rising to 2r, ending on the floor 2πr along", () => {
    const plan = planCommands([{ move: { target: ["w"], by: [377, 0], rotate: -360, trail: { anchor: "bottom" }, duration: 4 } }], ["w"], opts);
    expect(plan.warnings).toEqual([]);
    expect(plan.trails).toHaveLength(1);
    const tr = plan.trails[0];
    expect(tr.id).toBe("w_trail");
    expect(tr.pts).toHaveLength(61);
    expect(tr.pts[0]).toEqual([160, 200]);
    expect(Math.max(...tr.pts.map((p) => p[1]))).toBeCloseTo(320, 3);
    expect(tr.pts[60][0]).toBeCloseTo(537, 3);
    expect(tr.pts[60][1]).toBeCloseTo(200, 3);
    const step = plan.steps[0] as Extract<PlanStep, { kind: "transform" }>;
    expect(step.trails![0].lengthAt[0]).toBe(0);
    expect(step.trails![0].lengthAt[60]).toBe(1);
    expect(plan.states[0].visible).toContain("w_trail");
  });
  test("a plain move traces a straight line; the trail id is known to later commands; a second trail gets _2", () => {
    const plan = planCommands(
      [{ move: { target: ["w"], by: [100, 50], trail: true } }, { fade: { target: ["w_trail"], to: 0.3 } }, { move: { target: ["w"], by: [0, 100], trail: true } }],
      ["w"],
      opts,
    );
    expect(plan.warnings).toEqual([]);
    expect(plan.trails.map((t) => t.id)).toEqual(["w_trail", "w_trail_2"]);
    expect(plan.trails[0].pts[60]).toEqual([260, 310]);
    expect((plan.steps[0] as Extract<PlanStep, { kind: "move" }>).trails![0].id).toBe("w_trail");
    expect(plan.states[1].opacities.w_trail).toBe(0.3);
  });
  test("trail.of must be one of the targets", () => {
    const plan = planCommands([{ move: { target: ["w"], by: [10, 0], trail: { of: "nope" } } }], ["w"], opts);
    expect(plan.trails).toHaveLength(0);
    expect(plan.warnings.join(" ")).toMatch(/nope/);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/trail.test.ts`
Expected: FAIL — `src/render/trails` missing.

- [ ] **Step 3: `src/render/trails.ts`**

```ts
// Trails (design §2.5): the track an anchor leaves during a move, minted by
// the planner as an ordinary stroke element and appended to every layout
// render() mounts, so it can be faded, erased, highlighted or pointed at.
import type { LayoutResult } from "../layout/layout";
import { Z_STROKE, drawablesForId, leafDrawables, type Pt } from "../layout/model";
import { resolveDrawOpts, resolveStyle } from "../layout/resolve";

export interface TrailSpec {
  id: string;
  pts: Pt[];
  /** Absent = the source element's own stroke colour. */
  color?: string;
  width: number;
}

/** Fraction of the total length reached at each sample (0 … 1; all 0 for a motionless trail). */
export function cumulativeLengthFractions(pts: Pt[]): number[] {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const total = cum[cum.length - 1];
  return total === 0 ? cum.map(() => 0) : cum.map((c) => c / total);
}

/** Linear interpolation of a sample table at u ∈ [0, 1]. */
export function lengthFractionAt(table: number[], u: number): number {
  const n = table.length - 1;
  if (n <= 0) return 0;
  const x = Math.max(0, Math.min(1, u)) * n;
  const i = Math.min(n - 1, Math.floor(x));
  return table[i] + (table[i + 1] - table[i]) * (x - i);
}

export function withTrails(layout: LayoutResult, trails: TrailSpec[]): LayoutResult {
  if (trails.length === 0) return layout;
  const drawables = [...layout.drawables];
  const order = [...layout.order];
  for (const t of trails) {
    if (order.includes(t.id)) continue;
    const source = t.id.replace(/_trail(_\d+)?$/, "");
    const src = leafDrawables(drawablesForId(layout.drawables, source)).find((d) => d.kind === "stroke");
    drawables.push({
      id: t.id,
      kind: "stroke",
      pts: t.pts,
      z: Z_STROKE,
      style: resolveStyle({ color: t.color ?? src?.style.color, stroke_width: t.width }),
      drawOpts: resolveDrawOpts(undefined, { duration: 1200 }),
    });
    order.push(t.id);
  }
  return { ...layout, drawables, order };
}
```

(If `SpecStyle` names the width differently from `stroke_width`, use its name — check `src/spec/types.ts`.)

- [ ] **Step 4: Types, schema, prompt**

`MoveArgs.trail?: boolean | { of?: string; anchor?: string; color?: string; width?: number };` ("Leave the track of one target's anchor as an element `<id>_trail`."). Schema, in `move.properties`:

```ts
        trail: {
          oneOf: [
            { type: "boolean" },
            { type: "object", properties: { of: { type: "string" }, anchor: { type: "string" }, color: { type: "string" }, width: { type: "number" } }, additionalProperties: false },
          ],
          description: "Leave the TRACK of the motion as a new element <id>_trail (the locus): true traces the first target's centre; {\"of\": \"dot\", \"anchor\": \"bottom\"} traces that target's anchor — a point on a rolling wheel draws the cycloid, a planet its orbit. Fade, erase or highlight the trail afterwards by its id.",
        },
```

Prompt: extend the `move` bullet: "`\"trail\": true` (or `{\"of\": id, \"anchor\": name}`) leaves the track of the motion behind as an element `<id>_trail` — a point on a rolling wheel draws the cycloid, a planet its orbit; erase or fade the trail by its id afterwards."

- [ ] **Step 5: Planner**

`src/render/plan.ts`: `Plan` gains `/** Trails the moves minted (design §2.5): render() appends them to every layout it mounts. */ trails: TrailSpec[];`; `export interface TrailProgress { id: string; lengthAt: number[] }`; the `move` and `transform` step variants gain `trails?: TrailProgress[]`. Locals: `const trails: TrailSpec[] = []; const trailBoxes = new Map<string, BBox>(); const trailCount = new Map<string, number>();`. `boxOf` checks `trailBoxes.get(id)` first. Inside the `move` branch, after the ids are resolved and BEFORE either sub-branch computes, define:

```ts
      const trailOpt = cmd.move.trail === true ? {} : cmd.move.trail || null;
      /** Sample the trailed anchor along a pose tween and mint the trail element. */
      const mintTrail = (poseAt: (id: string, u: number) => { offset: Pt; turn: Turn | undefined }): TrailProgress[] => {
        if (!trailOpt) return [];
        const of = trailOpt.of ?? ids[0];
        if (!ids.includes(of)) {
          warnings.push(`move.trail.of "${of}" is not one of the move's targets — no trail`);
          return [];
        }
        const anchor = anchorOriginal(of, trailOpt.anchor ?? "center", "move");
        if (!anchor) return [];
        const pts: Pt[] = [];
        for (let k = 0; k <= 60; k++) {
          const p = poseAt(of, k / 60);
          pts.push(poseOf(p.offset, p.turn)(anchor));
        }
        const n = (trailCount.get(of) ?? 0) + 1;
        trailCount.set(of, n);
        const trailId = n === 1 ? `${of}_trail` : `${of}_trail_${n}`;
        trails.push({ id: trailId, pts, color: trailOpt.color, width: trailOpt.width ?? 2.5 });
        const b = ptsBox(pts);
        if (b) trailBoxes.set(trailId, b);
        known.add(trailId);
        mentioned.add(trailId);
        makeVisible([trailId]);
        return [{ id: trailId, lengthAt: cumulativeLengthFractions(pts) }];
      };
```

Plain-translation sub-branch: capture `const bases = Object.fromEntries(ids.map((id) => [id, offsets[id] ?? [0, 0]]))` BEFORE the offsets are updated, then `const stepTrails = mintTrail((id, u) => { const [px, py] = pathPosition(path, u); return { offset: [bases[id][0] + px, bases[id][1] + py], turn: turns[id] }; });` and `pushStep({ kind: "move", ids: moving, path, seconds, easing, trails: stepTrails })`. Pose sub-branch: after the items loop, `const stepTrails = mintTrail((id, u) => { const it = items.find((x) => x.id === id)!; const lerp = (a: number, b: number) => a + (b - a) * u; return { offset: [lerp(it.from.offset[0], it.to.offset[0]), lerp(it.from.offset[1], it.to.offset[1])], turn: { deg: lerp(it.from.turn.deg, it.to.turn.deg), pivot: it.to.turn.pivot, scale: lerp(it.from.turn.scale ?? 1, it.to.turn.scale ?? 1), mirror: it.to.turn.mirror } }; });` — the same interpolation the player's `transform` case uses — and pass `trails: stepTrails` on the step. `makeVisible` must run AFTER `pushStep`'s snapshot? No: the state snapshot is taken in `pushStep`, so call `mintTrail` (which makes the trail visible) BEFORE `pushStep`, exactly as written. Return `trails` in the `Plan`. Import `pathPosition` from `./effects`, `cumulativeLengthFractions`, `type TrailSpec` from `./trails`.

- [ ] **Step 6: Player and render()**

`src/render/player.ts`: in the `move` case's progress callback, compute `const e = ease(t)` once, use it for `pathPosition`, and end the callback with `for (const tr of step.trails ?? []) this.elements.get(tr.id)?.setProgress(lengthFractionAt(tr.lengthAt, e));`. Same line at the end of the `transform` case's callback. Import `lengthFractionAt`.

`src/render/index.ts`: declare `let trails: TrailSpec[] = [];` above `layoutFor`; make `layoutFor` return `withTrails(layout, trails)` on its early return and `withTrails(l, trails)` otherwise (the cache keeps the raw `l`). After `const plan = planCommands(...)`: `trails = plan.trails; const mountedLayout = withTrails(layout, trails);` and use `mountedLayout` in `renderer.mount(mountedLayout, spec, stage)` and as the handle's `layout`. Import `withTrails`, `type TrailSpec`.

- [ ] **Step 7: Run**

Run: `npx vitest run tests/trail.test.ts tests/plan.test.ts tests/flip.test.ts tests/morph.test.ts tests/player-raf.test.ts tests/examples.test.ts tests/schema.test.ts tests/prompt.test.ts && npx tsc --noEmit`
Expected: all PASS.

---
### Task 7: `flow` — dots or dashes streaming along strokes

**Files:**
- Modify: `src/spec/types.ts` (`FlowArgs`; `Command.flow`), `src/spec/schema.ts` (a `flow` schema after `morph`; `ACTION_VERBS`; the verb list; a semantic check "flow needs along")
- Modify: `src/render/plan.ts` (`PlanStep` `flow`; `ACTION_KEYS`; a `flow` branch)
- Modify: `src/render/backend.ts` (`BackendEffects.setFlow` / `endFlow`, `FlowOpts`)
- Modify: `src/render/svg-backend.ts` (`makeEffects` ~766-870: the overlay effect)
- Modify: `src/render/player.ts` (a `flow` case beside `highlight`)
- Modify: `src/lint/lint.ts:252`, `src/llm/subtitles.ts:60`, `src/llm/prompts/compiler-v1.md` (a `flow` bullet after `morph`)
- Test: `tests/flow.test.ts` (new)

**Interfaces:**
- Produces: `export interface FlowArgs { along: string[] | string; duration?: number; speed?: number; spacing?: number; kind?: "dots" | "dashes"; color?: string; reverse?: boolean }`; plan step `{ kind: "flow"; ids: string[]; seconds: number; speed: number; spacing: number; marks: "dots" | "dashes"; color?: string; reverse: boolean; untilNarrationEnd?: boolean }`; `export interface FlowOpts { spacing: number; marks: "dots" | "dashes"; color?: string; reverse: boolean }`; `BackendEffects.setFlow?(ids: string[], opts: FlowOpts, frame: { travelled: number; alpha: number }): void` and `endFlow?(ids: string[]): void`.

- [ ] **Step 1: Write the failing tests**

Create `tests/flow.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { planCommands, type PlanStep } from "../src/render/plan";
import { rendererFor } from "../src/render/svg-backend";
import { layoutSpec } from "../src/layout/layout";
import { heuristicMeasure } from "../src/layout/measure";
import { validateSpec } from "../src/spec/schema";
import { installMiniDom, FakeNode } from "./helpers/mini-dom";

const SPEC = {
  elements: [
    { id: "h", type: "node", shape: "rect", text: "Households", x: 200, y: 375 },
    { id: "f", type: "node", shape: "rect", text: "Firms", x: 800, y: 375 },
    { id: "money", type: "arrow", from: { ref: "f" }, to: { ref: "h" }, curved: true, style: { color: "#2f6b8f" } },
  ],
  commands: [{ draw: ["h", "f", "money"] }, { flow: { along: ["money"] }, speak: "Money circulates." }],
};

describe("flow planning", () => {
  test("defaults, the narration hold, and the schema", () => {
    const plan = planCommands(SPEC.commands as never, ["h", "f", "money"], { bboxOf: () => ({ x: 0, y: 0, w: 10, h: 10 }) });
    const step = plan.steps[1] as Extract<PlanStep, { kind: "flow" }>;
    expect(step).toMatchObject({ kind: "flow", ids: ["money"], seconds: 3, speed: 120, spacing: 24, marks: "dots", reverse: false, untilNarrationEnd: true });
    const timed = planCommands([{ flow: { along: "money", duration: 2, kind: "dashes", reverse: true, speed: 60 } }], ["money"], {});
    expect(timed.steps[0]).toMatchObject({ kind: "flow", seconds: 2, marks: "dashes", reverse: true, speed: 60 });
    expect((timed.steps[0] as { untilNarrationEnd?: boolean }).untilNarrationEnd).toBeUndefined();
    expect(validateSpec(SPEC as never).ok).toBe(true);
    expect(validateSpec({ ...SPEC, commands: [{ flow: { speed: 3 } }] } as never).ok).toBe(false);
  });
});

describe("setFlow on the SVG backend", () => {
  for (const style of ["clean", "sketchy"] as const) {
    test(`an overlay path inside the stroke's own group, dashed and offset by the distance travelled; endFlow removes it (${style})`, async () => {
      const { restore, doc } = installMiniDom();
      try {
        const layout = layoutSpec(SPEC as never, heuristicMeasure);
        const container = new FakeNode("div", doc as never);
        const mounted = await rendererFor(style).mount(layout, SPEC as never, container as never);
        for (const el of mounted.elements.values()) el.finish();
        const effects = mounted.effects!;
        const leaf = () => {
          const out: FakeNode[] = [];
          const walk = (n: FakeNode) => { if (n.dataset.leafId === "money") out.push(n); n.children.forEach(walk); };
          walk(container);
          return out[0];
        };
        const before = leaf().children.length;
        effects.setFlow!(["money"], { spacing: 24, marks: "dots", reverse: false }, { travelled: 30, alpha: 1 });
        const overlay = leaf().children[leaf().children.length - 1];
        expect(leaf().children.length).toBe(before + 1);
        expect(overlay.getAttribute("stroke-dasharray")).toBe("0.1 24");
        expect(overlay.getAttribute("stroke-dashoffset")).toBe("-6.00"); // 30 mod 24, forwards
        expect(overlay.getAttribute("stroke")).toBe("#2f6b8f");
        effects.setFlow!(["money"], { spacing: 24, marks: "dots", reverse: false }, { travelled: 31, alpha: 0.5 });
        expect(leaf().children.length).toBe(before + 1); // reused, not re-added
        expect(overlay.getAttribute("opacity")).toBe("0.475");
        effects.endFlow!(["money"]);
        expect(leaf().children.length).toBe(before);
      } finally {
        restore();
      }
    });
  }
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/flow.test.ts`
Expected: FAIL — no `flow` step, no `setFlow`.

- [ ] **Step 3: Types, schema, enumerations, prompt**

`src/spec/types.ts`:

```ts
export interface FlowArgs {
  /** Stroke element ids the marks stream along (arrow, edge, path, curve, arc, template strokes). */
  along: string[] | string;
  /** Seconds (default 3; with a paired speak and no duration: until the voice ends). */
  duration?: number;
  /** Logical units per second (default 120). */
  speed?: number;
  /** Units between marks (default 24). */
  spacing?: number;
  kind?: "dots" | "dashes";
  /** Default: the element's own colour. */
  color?: string;
  /** Stream from the stroke's end to its start. */
  reverse?: boolean;
}
```

`Command.flow?: FlowArgs;` ("Dots or dashes streaming along strokes while the sentence lands."). Schema after `morph`:

```ts
    flow: {
      type: "object",
      description:
        "Something STREAMS along strokes while the sentence lands — money round the circular flow, current in a circuit, blood, water, traffic, infection along a contact: {\"flow\": {\"along\": [\"wages\", \"spending\"]}, \"speak\": \"Money circulates…\"}. Transient like highlight; with a paired speak and no duration it runs until the voice ends. \"reverse\": true streams the other way; \"kind\": \"dashes\" for a pulse rather than particles.",
      properties: {
        along: idListSchema("Stroke element ids to stream along (arrows, edges, paths, curves, arcs)."),
        duration: { type: "number", description: "Seconds (default 3; omit with a paired speak to hold until the voice ends)." },
        speed: { type: "number", exclusiveMinimum: 0, description: "Logical units per second (default 120) — 40 reads as a trickle, 300 as a rush." },
        spacing: { type: "number", exclusiveMinimum: 0, description: "Units between marks (default 24)." },
        kind: { type: "string", enum: ["dots", "dashes"], description: "dots = particles (default); dashes = a moving pulse." },
        color: { type: "string", description: "Mark colour (default: the stroke's own)." },
        reverse: { type: "boolean", description: "Stream from the stroke's end to its start." },
      },
      required: ["along"],
      additionalProperties: false,
    },
```

Add `"flow"` to the four enumerations and `src/llm/subtitles.ts:60`. Prompt bullet after `morph`:

```
- `flow`: `{"flow": {"along": ["wages", "spending"]}, "speak": "Money circulates: what one spends, another earns."}` — dots stream along the named strokes while the sentence lands (a transient gesture like `highlight`): the circular flow of income, current in a circuit, blood, water, traffic, an infection along a contact. `"reverse": true` streams the other way; `"speed"` in units per second (default 120).
```

- [ ] **Step 4: Planner**

`PlanStep` gains `| { kind: "flow"; ids: string[]; seconds: number; speed: number; spacing: number; marks: "dots" | "dashes"; color?: string; reverse: boolean; untilNarrationEnd?: boolean }`. Branch after `morph`:

```ts
    } else if (cmd.flow !== undefined) {
      const ids = resolveIds(cmd.flow.along, "flow");
      if (ids.length === 0) continue;
      for (const id of ids) if (!visibleSet.has(id)) warnings.push(`flow target "${id}" is not visible at that point`);
      pushStep({
        kind: "flow",
        ids,
        seconds: cmd.flow.duration ?? 3,
        speed: cmd.flow.speed ?? 120,
        spacing: cmd.flow.spacing ?? 24,
        marks: cmd.flow.kind ?? "dots",
        color: cmd.flow.color,
        reverse: cmd.flow.reverse === true,
        ...(cmd.flow.duration === undefined && currentNarration !== undefined ? { untilNarrationEnd: true } : {}),
      });
```

- [ ] **Step 5: Backend effect**

`src/render/backend.ts`: `export interface FlowOpts { spacing: number; marks: "dots" | "dashes"; color?: string; reverse: boolean }` and on `BackendEffects`: `/** Marks streaming along the ids' strokes: `travelled` is the distance covered so far (logical units), `alpha` the ramp (0–1). Stateless per frame; endFlow removes the overlays. */ setFlow?(ids: string[], opts: FlowOpts, frame: { travelled: number; alpha: number }): void; endFlow?(ids: string[]): void;`.

`src/render/svg-backend.ts` `makeEffects`: add a `const flows = new Map<string, SVGPathElement[]>();` and

```ts
    setFlow(ids: string[], o: FlowOpts, frame: { travelled: number; alpha: number }): void {
      const key = keyOf(ids);
      let paths = flows.get(key);
      if (!paths) {
        paths = [];
        for (const id of ids) {
          for (const { g, leaf } of leafNodes.get(id) ?? []) {
            if (leaf.kind !== "stroke" || leaf.pts.length < 2 || leaf.shapeHint) continue;
            const p = document.createElementNS(SVG_NS, "path") as SVGPathElement;
            p.setAttribute("d", pathFromPts(leaf.pts, leaf.closed));
            p.setAttribute("fill", "none");
            p.setAttribute("stroke", o.color ?? leaf.style.color);
            p.setAttribute("stroke-linecap", "round");
            p.setAttribute("stroke-width", o.marks === "dots" ? "7" : "4");
            p.setAttribute("stroke-dasharray", o.marks === "dots" ? `0.1 ${o.spacing}` : `${o.spacing / 2} ${o.spacing / 2}`);
            p.style.pointerEvents = "none";
            g.appendChild(p); // inside the leaf's own group: inherits the element's pose and fade
            paths.push(p);
          }
        }
        flows.set(key, paths);
      }
      const phase = frame.travelled % o.spacing;
      const offset = o.reverse ? phase : -phase;
      for (const p of paths) {
        p.setAttribute("stroke-dashoffset", offset.toFixed(2));
        p.setAttribute("opacity", (0.95 * Math.max(0, Math.min(1, frame.alpha))).toFixed(3));
      }
    },
    endFlow(ids: string[]): void {
      const key = keyOf(ids);
      for (const p of flows.get(key) ?? []) p.remove();
      flows.delete(key);
    },
```

(An arrow's head is drawn into the same group as its shaft by `drawLeaf`; the overlay uses the shaft's `pts` only, so heads carry no marks.)

- [ ] **Step 6: Player**

Beside the `highlight` case:

```ts
      case "flow": {
        const effects = this.effects;
        if (!effects?.setFlow) return;
        const o = { spacing: step.spacing, marks: step.marks, color: step.color, reverse: step.reverse };
        const paint = (elapsedMs: number, alpha: number) => effects.setFlow!(step.ids, o, { travelled: (elapsedMs / 1000) * step.speed, alpha });
        try {
          if (step.untilNarrationEnd && this.narrationVoice) {
            let speaking = true;
            void this.narrationVoice.finally(() => (speaking = false));
            let base = 0;
            const CYCLE = 1000;
            while (speaking && !signal.aborted) {
              await this.progress(CYCLE, signal, (t) => paint(base + t * CYCLE, Math.min(1, (base + t * CYCLE) / 300)));
              base += CYCLE;
            }
            if (!signal.aborted) await this.progress(300, signal, (t) => paint(base + t * 300, 1 - t));
          } else {
            const ms = step.seconds * 1000;
            await this.progress(ms, signal, (t) => paint(t * ms, Math.min(1, t / 0.1, (1 - t) / 0.1)));
          }
        } finally {
          effects.endFlow?.(step.ids);
        }
        return;
      }
```

- [ ] **Step 7: Run**

Run: `npx vitest run tests/flow.test.ts tests/plan.test.ts tests/schema.test.ts tests/prompt.test.ts tests/player-raf.test.ts tests/examples.test.ts && npx tsc --noEmit`
Expected: all PASS.

---

### Task 8: The calculus templates — `riemann_sum` and `tangent_secant`

Independent of Tasks 1–7 (disjoint files); may run in parallel with Task 1.

**Files:**
- Modify: `src/scenes/packs/mathlogic.yaml` (append two template documents after `circle_sectors`; update the pack `description` on line 3 to mention integrals and derivatives)
- Test: `tests/calculus-templates.test.ts` (new)

**Interfaces:**
- Produces template ids `riemann_sum` (params `expr x_from x_to a b n rule show_area show_sum x_label y_label`; ids `axes x_label y_label curve area bar_1…bar_n label_a label_b sum_label exact_label`) and `tangent_secant` (params `expr x_from x_to at h show_tangent show_triangle x_label y_label`; ids `axes x_label y_label curve point_a point_b secant tangent run rise label_dx label_dy slope_label derivative_label`). Task 9's bundled examples use these ids verbatim.

- [ ] **Step 1: Write the failing tests**

Create `tests/calculus-templates.test.ts`:

```ts
import { beforeAll, describe, expect, test } from "vitest";
import { ensureEnabledPacks } from "../src/scenes/packs";
import { scenes } from "../src/scenes/registry";
import { layoutSpec } from "../src/layout/layout";
import { sliderSpecs } from "../src/ui/tray-model";

beforeAll(async () => {
  await ensureEnabledPacks(["mathlogic"]);
});

const lay = (template: string, params: Record<string, unknown>) => layoutSpec({ template, params, elements: [] } as never);
const textOf = (out: ReturnType<typeof lay>, id: string) => (out.drawables.find((d) => d.id === id) as { text?: string } | undefined)?.text ?? "";

describe("riemann_sum", () => {
  test("registers ready with n as a slider", () => {
    expect(scenes.riemann_sum?.manifest.status).toBe("ready");
    expect(sliderSpecs(scenes.riemann_sum.manifest.params_schema).map((s) => s.path)).toContain("n");
  });
  test("n bars under the curve, lint-clean across the animate range; the sum approaches the integral", () => {
    const sums: number[] = [];
    for (const n of [1, 6, 40, 200]) {
      const out = lay("riemann_sum", { expr: "x*x/10 + 1", x_from: 0, x_to: 10, a: 2, b: 8, n });
      expect(out.warnings, `n=${n}`).toEqual([]);
      expect(out.issues.filter((i) => i.severity === "error"), `n=${n}`).toEqual([]);
      expect(out.order.filter((id) => /^bar_\d+$/.test(id))).toHaveLength(n);
      const m = /Σ ≈ ([\d.]+)/.exec(textOf(out, "sum_label"));
      expect(m, `n=${n}`).not.toBeNull();
      sums.push(Number(m![1]));
    }
    // ∫₂⁸ (x²/10 + 1) dx = (512 − 8)/30 + 6 = 22.8
    expect(Math.abs(sums[3] - 22.8)).toBeLessThan(0.2);
    expect(Math.abs(sums[0] - 22.8)).toBeGreaterThan(Math.abs(sums[3] - 22.8));
    expect(textOf(lay("riemann_sum", { n: 6 }), "exact_label")).toMatch(/∫ ≈/);
  });
  test("a fractional n rounds; right and midpoint rules bracket the integral for an increasing curve", () => {
    expect(lay("riemann_sum", { n: 5.6 }).order.filter((id) => /^bar_\d+$/.test(id))).toHaveLength(6);
    const left = Number(/Σ ≈ ([\d.]+)/.exec(textOf(lay("riemann_sum", { n: 6, rule: "left" }), "sum_label"))![1]);
    const right = Number(/Σ ≈ ([\d.]+)/.exec(textOf(lay("riemann_sum", { n: 6, rule: "right" }), "sum_label"))![1]);
    expect(left).toBeLessThan(right);
  });
  test("both manifest examples lint clean", () => {
    for (const ex of scenes.riemann_sum.manifest.examples) {
      const out = lay("riemann_sum", ex.params);
      expect(out.warnings).toEqual([]);
      expect(out.issues.filter((i) => i.severity === "error")).toEqual([]);
    }
  });
});

describe("tangent_secant", () => {
  test("registers ready with h as a slider", () => {
    expect(scenes.tangent_secant?.manifest.status).toBe("ready");
    expect(sliderSpecs(scenes.tangent_secant.manifest.params_schema).map((s) => s.path)).toContain("h");
  });
  test("the secant's slope converges on the derivative as h shrinks; every frame is lint-clean", () => {
    const slopes: number[] = [];
    for (const h of [4, 1, 0.05]) {
      const out = lay("tangent_secant", { expr: "x*x/10 + 1", x_from: 0, x_to: 10, at: 4, h });
      expect(out.warnings, `h=${h}`).toEqual([]);
      expect(out.issues.filter((i) => i.severity === "error"), `h=${h}`).toEqual([]);
      for (const id of ["axes", "curve", "point_a", "point_b", "secant", "tangent", "run", "rise", "slope_label", "derivative_label"]) expect(out.order, `${id} at h=${h}`).toContain(id);
      slopes.push(Number(/≈ (-?[\d.]+)/.exec(textOf(out, "slope_label"))![1]));
    }
    expect(textOf(lay("tangent_secant", { at: 4 }), "derivative_label")).toMatch(/f′\(4\) = 0\.80/);
    expect(Math.abs(slopes[2] - 0.8)).toBeLessThan(0.02);
    expect(Math.abs(slopes[0] - 0.8)).toBeGreaterThan(Math.abs(slopes[2] - 0.8));
    // the Δ labels give way when the triangle is too small to carry them
    expect(lay("tangent_secant", { at: 4, h: 4 }).order).toContain("label_dx");
    expect(lay("tangent_secant", { at: 4, h: 0.05 }).order).not.toContain("label_dx");
  });
  test("both manifest examples lint clean", () => {
    for (const ex of scenes.tangent_secant.manifest.examples) {
      const out = lay("tangent_secant", ex.params);
      expect(out.warnings).toEqual([]);
      expect(out.issues.filter((i) => i.severity === "error")).toEqual([]);
    }
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/calculus-templates.test.ts`
Expected: FAIL — the templates are not registered.

- [ ] **Step 3: Append the templates to `src/scenes/packs/mathlogic.yaml`**

Update line 3's `description` to end "…, the circle cut into sectors that zip into the πr² rectangle, Riemann sums under a curve, and the secant that becomes the tangent." Then append (after the last line of `circle_sectors`, keeping the `---` document separator convention the file uses between templates):

```yaml
---
template: riemann_sum
title: Riemann sum → the integral
version: 1
kit: 9
status: ready
description: >-
  The area under a curve y = f(x) between a and b approximated by n
  rectangles (left, right or midpoint rule), with the exact region washed
  underneath, the running sum "Σ ≈" and the integral "∫ ≈" written on the
  figure. n ANIMATES: animate n from 4 to 40 and the bars thin, the sum
  converging on the integral. Choose this for ANY request about what an
  integral is, the area under a curve, Riemann sums, or why more
  rectangles give a better estimate.
params:
  type: object
  properties:
    expr:
      type: string
      description: "y = f(x), the same expression syntax as a curve's expr (default \"x*x/10 + 1\")."
    x_from: { type: number, description: "Left end of the drawn domain (default 0)." }
    x_to: { type: number, description: "Right end of the drawn domain (default 10)." }
    a: { type: number, description: "Left end of the interval summed (default x_from)." }
    b: { type: number, description: "Right end of the interval summed (default x_to)." }
    n:
      type: integer
      minimum: 1
      maximum: 200
      description: "How many rectangles (default 6). animate to 40 to refine."
    rule:
      type: string
      enum: [left, right, midpoint]
      description: "Where each rectangle's height is read (default left)."
    show_area: { type: boolean, description: "Wash the exact region under the curve (default true)." }
    show_sum: { type: boolean, description: "Write Σ ≈ and ∫ ≈ on the figure (default true)." }
    x_label: { type: string, description: "x-axis caption (default x)." }
    y_label: { type: string, description: "y-axis caption (default f(x))." }
element_ids:
  axes: the L-shaped axes
  x_label: x-axis caption
  y_label: y-axis caption
  curve: the function
  area: the exact region under the curve on [a, b] (when show_area)
  bar_<k>: rectangle k of n, left to right — each its own element
  label_a: the interval's left end, on the axis
  label_b: the interval's right end
  sum_label: "Σ ≈ …" (n = …) — the rectangles' total, recomputed every frame
  exact_label: "∫ ≈ …" — the integral by fine numeric quadrature
examples:
  - request: "What is an integral? Show the area under a curve as rectangles."
    params: { expr: "x*x/10 + 1", x_from: 0, x_to: 10, a: 2, b: 8, n: 4 }
  - request: "Show a Riemann sum with forty thin rectangles under a curve."
    params: { expr: "x*x/10 + 1", x_from: 0, x_to: 10, a: 2, b: 8, n: 40, rule: midpoint }
layout: |-
  const C = kit.COLORS, MS = kit.SKETCH_MS;
  const num = (v, d) => (typeof v === "number" && Number.isFinite(v) ? v : d);
  const exprSrc = typeof params.expr === "string" && params.expr.trim() ? params.expr : "x*x/10 + 1";
  const f = kit.expr(exprSrc, ["x"]);
  const fx = (x) => { const y = f({ x }); return Number.isFinite(y) ? y : 0; };
  const x0 = num(params.x_from, 0);
  const x1 = Math.max(x0 + 1e-6, num(params.x_to, 10));
  const a = Math.min(Math.max(num(params.a, x0), x0), x1);
  const b = Math.min(Math.max(num(params.b, x1), a), x1);
  const n = Math.max(1, Math.min(200, Math.round(num(params.n, 6))));
  const rule = params.rule === "right" || params.rule === "midpoint" ? params.rule : "left";
  const showArea = params.show_area !== false;
  const showSum = params.show_sum !== false;
  const xLabel = typeof params.x_label === "string" ? params.x_label : "x";
  const yLabel = typeof params.y_label === "string" ? params.y_label : "f(x)";
  const plot = kit.plotArea();
  const samples = kit.sample(fx, x0, x1, 120);
  const yTop = Math.max(1e-9, ...samples.map((p) => p[1]), 0) * 1.1;
  const sx = (x) => plot.x0 + ((x - x0) / (x1 - x0)) * (plot.x1 - plot.x0);
  const sy = (y) => plot.y0 + (Math.max(0, Math.min(y, yTop)) / yTop) * (plot.y1 - plot.y0);
  const fmt = (v) => (Math.abs(v - Math.round(v)) < 1e-9 ? String(Math.round(v)) : v.toFixed(1));
  const drawables = [], labels = [], anchors = {}, order = [];
  const push = (d) => { drawables.push(d); order.push(d.id); };
  push(kit.stroke("axes", [[plot.x0, plot.y1 + kit.AXIS_OVERHANG], [plot.x0, plot.y0], [plot.x1 + kit.AXIS_OVERHANG, plot.y0]], { color: C.ink, strokeWidth: 3, ms: MS.axis }));
  push(kit.axisLabel("x_label", "x", plot, xLabel));
  push(kit.axisLabel("y_label", "y", plot, yLabel));
  anchors.axes = [plot.x0, plot.y0];
  const curvePts = samples.map(([x, y]) => [sx(x), sy(y)]);
  push(kit.stroke("curve", curvePts, { color: C.demand, strokeWidth: 4, ms: MS.curve }));
  anchors.curve = curvePts[curvePts.length - 1];
  if (showArea && b > a) {
    const under = [];
    for (let i = 0; i <= 80; i++) { const x = a + ((b - a) * i) / 80; under.push([sx(x), sy(fx(x))]); }
    under.push([sx(b), sy(0)], [sx(a), sy(0)]);
    push(kit.area("area", under, C.region2, { opacity: 0.22, ms: MS.region }));
    anchors.area = [sx((a + b) / 2), (sy(fx((a + b) / 2)) + sy(0)) / 2];
  }
  const w = (b - a) / n;
  let sum = 0;
  for (let k = 0; k < n; k++) {
    const xl = a + k * w, xr = xl + w;
    const xs = rule === "left" ? xl : rule === "right" ? xr : (xl + xr) / 2;
    const h = Math.max(0, fx(xs));
    sum += h * w;
    const id = "bar_" + (k + 1);
    const pts = [[sx(xl), sy(0)], [sx(xr), sy(0)], [sx(xr), sy(h)], [sx(xl), sy(h)]];
    push(kit.area(id, pts, C.supply, { opacity: 0.35, ms: MS.region }));
    drawables.push(kit.stroke(id + "_body", pts, { closed: true, color: C.supply, strokeWidth: 2, ms: MS.stroke }));
    anchors[id] = [sx((xl + xr) / 2), sy(h / 2)];
  }
  labels.push(kit.label("label_a", [sx(a), sy(0)], "below", fmt(a), { color: C.ink, fontSize: 24 }));
  labels.push(kit.label("label_b", [sx(b), sy(0)], "below", fmt(b), { color: C.ink, fontSize: 24 }));
  order.push("label_a", "label_b");
  anchors.label_a = [sx(a), sy(0)];
  anchors.label_b = [sx(b), sy(0)];
  if (showSum) {
    let exact = 0;
    const m = 2000;
    for (let i = 0; i < m; i++) { const x = a + ((b - a) * (i + 0.5)) / m; exact += Math.max(0, fx(x)) * ((b - a) / m); }
    const tx = plot.x0 + 24, ty = plot.y1 - 16;
    push(kit.text("sum_label", [tx, ty], "Σ ≈ " + sum.toFixed(1) + "  (n = " + n + ")", { fontSize: 26, color: C.supply, anchor: "start" }));
    push(kit.text("exact_label", [tx, ty - 34], "∫ ≈ " + exact.toFixed(1), { fontSize: 26, color: C.demand, anchor: "start" }));
    anchors.sum_label = [tx + 60, ty];
    anchors.exact_label = [tx + 60, ty - 34];
  }
  return { drawables, labels, anchors, order };
---
template: tangent_secant
title: Secant → tangent (the derivative)
version: 1
kit: 9
status: ready
description: >-
  A curve y = f(x) with a point A at x = at and a second point B at x = at + h,
  the secant through them with its rise/run triangle and slope written out,
  and the true tangent at A (dashed) with f′(at). h ANIMATES: animate h
  toward 0 and B slides into A, the secant turns into the tangent and the
  slope converges on the derivative. Choose this for ANY request about what
  a derivative is, the slope of a curve at a point, a tangent line, a
  difference quotient, or the limit of (f(x+h) − f(x))/h.
params:
  type: object
  properties:
    expr:
      type: string
      description: "y = f(x), the same expression syntax as a curve's expr (default \"x*x/10 + 1\")."
    x_from: { type: number, description: "Left end of the drawn domain (default 0)." }
    x_to: { type: number, description: "Right end of the drawn domain (default 10)." }
    at: { type: number, description: "x of the point A the derivative is taken at (default 4)." }
    h:
      type: number
      minimum: 0.01
      maximum: 20
      description: "Distance from A to B along x (default 4). animate toward 0.05 to turn the secant into the tangent."
    show_tangent: { type: boolean, description: "Draw the true tangent at A, dashed (default true)." }
    show_triangle: { type: boolean, description: "Draw the rise/run legs with Δx and Δy labels (default true)." }
    x_label: { type: string, description: "x-axis caption (default x)." }
    y_label: { type: string, description: "y-axis caption (default f(x))." }
element_ids:
  axes: the L-shaped axes
  x_label: x-axis caption
  y_label: y-axis caption
  curve: the function
  point_a: the point A at x = at
  point_b: the point B at x = at + h
  secant: the line through A and B
  tangent: the tangent at A, dashed (when show_tangent)
  run: the horizontal leg from A (when show_triangle)
  rise: the vertical leg up to B (when show_triangle)
  label_dx: "Δx = h" under the run (only while the triangle is wide enough to carry it)
  label_dy: "Δy = …" beside the rise (same)
  slope_label: "slope ≈ …" — the secant's slope, recomputed every frame
  derivative_label: "f′(at) = …" — the true derivative at A
examples:
  - request: "What is a derivative? Show a secant becoming a tangent."
    params: { expr: "x*x/10 + 1", x_from: 0, x_to: 10, at: 4, h: 4 }
  - request: "Show the tangent to a curve at a point with its slope."
    params: { expr: "x*x/10 + 1", x_from: 0, x_to: 10, at: 6, h: 0.05 }
layout: |-
  const C = kit.COLORS, MS = kit.SKETCH_MS;
  const num = (v, d) => (typeof v === "number" && Number.isFinite(v) ? v : d);
  const exprSrc = typeof params.expr === "string" && params.expr.trim() ? params.expr : "x*x/10 + 1";
  const f = kit.expr(exprSrc, ["x"]);
  const fx = (x) => { const y = f({ x }); return Number.isFinite(y) ? y : 0; };
  const x0 = num(params.x_from, 0);
  const x1 = Math.max(x0 + 1e-6, num(params.x_to, 10));
  const span = x1 - x0;
  const xa = Math.min(Math.max(num(params.at, x0 + 0.4 * span), x0), x1);
  const h = Math.max(0.01, Math.min(num(params.h, 0.4 * span), Math.max(0.01, x1 - xa)));
  const xb = Math.min(x1, xa + h);
  const showTangent = params.show_tangent !== false;
  const showTri = params.show_triangle !== false;
  const xLabel = typeof params.x_label === "string" ? params.x_label : "x";
  const yLabel = typeof params.y_label === "string" ? params.y_label : "f(x)";
  const plot = kit.plotArea();
  const samples = kit.sample(fx, x0, x1, 120);
  const yTop = Math.max(1e-9, ...samples.map((p) => p[1]), fx(xa), fx(xb), 0) * 1.1;
  const sx = (x) => plot.x0 + ((x - x0) / span) * (plot.x1 - plot.x0);
  const sy = (y) => plot.y0 + (Math.max(0, Math.min(y, yTop)) / yTop) * (plot.y1 - plot.y0);
  const fmt = (v) => (Math.abs(v - Math.round(v)) < 1e-9 ? String(Math.round(v)) : v.toFixed(2).replace(/0$/, ""));
  const drawables = [], labels = [], anchors = {}, order = [];
  const push = (d) => { drawables.push(d); order.push(d.id); };
  push(kit.stroke("axes", [[plot.x0, plot.y1 + kit.AXIS_OVERHANG], [plot.x0, plot.y0], [plot.x1 + kit.AXIS_OVERHANG, plot.y0]], { color: C.ink, strokeWidth: 3, ms: MS.axis }));
  push(kit.axisLabel("x_label", "x", plot, xLabel));
  push(kit.axisLabel("y_label", "y", plot, yLabel));
  anchors.axes = [plot.x0, plot.y0];
  const curvePts = samples.map(([x, y]) => [sx(x), sy(y)]);
  push(kit.stroke("curve", curvePts, { color: C.demand, strokeWidth: 4, ms: MS.curve }));
  anchors.curve = curvePts[curvePts.length - 1];
  const A = [sx(xa), sy(fx(xa))], B = [sx(xb), sy(fx(xb))];
  // A line through P along d, clipped to the plot box (parametric slab test).
  const clipLine = (P, d) => {
    let t0 = -Infinity, t1 = Infinity;
    for (const [lo, hi, p, v] of [[plot.x0, plot.x1, P[0], d[0]], [plot.y0, plot.y1, P[1], d[1]]]) {
      if (Math.abs(v) < 1e-9) { if (p < lo || p > hi) return null; continue; }
      const ta = (lo - p) / v, tb = (hi - p) / v;
      t0 = Math.max(t0, Math.min(ta, tb)); t1 = Math.min(t1, Math.max(ta, tb));
    }
    if (!(t0 < t1)) return null;
    return [[P[0] + t0 * d[0], P[1] + t0 * d[1]], [P[0] + t1 * d[0], P[1] + t1 * d[1]]];
  };
  const dirOf = (m) => { const dx = (plot.x1 - plot.x0) / span, dy = (m * (plot.y1 - plot.y0)) / yTop; const L = Math.hypot(dx, dy) || 1; return [dx / L, dy / L]; };
  const secSlope = (fx(xb) - fx(xa)) / (xb - xa);
  const sec = clipLine(A, dirOf(secSlope));
  if (sec) { push(kit.stroke("secant", sec, { color: C.supply, strokeWidth: 3, ms: MS.connector })); anchors.secant = sec[1]; }
  const eps = 1e-4 * span;
  const deriv = (fx(xa + eps) - fx(xa - eps)) / (2 * eps);
  if (showTangent) {
    const tan = clipLine(A, dirOf(deriv));
    if (tan) { push(kit.stroke("tangent", tan, { color: C.demand, strokeWidth: 3, dash: true, ms: MS.connector })); anchors.tangent = tan[1]; }
  }
  if (showTri) {
    const corner = [B[0], A[1]];
    push(kit.stroke("run", [A, corner], { color: C.guide, strokeWidth: 2.5, ms: MS.connector }));
    push(kit.stroke("rise", [corner, B], { color: C.guide, strokeWidth: 2.5, ms: MS.connector }));
    anchors.run = [(A[0] + corner[0]) / 2, A[1]];
    anchors.rise = [corner[0], (corner[1] + B[1]) / 2];
    if (corner[0] - A[0] >= 40) {
      labels.push(kit.label("label_dx", anchors.run, "below", "Δx = " + fmt(h), { color: C.guide, fontSize: 22 }));
      labels.push(kit.label("label_dy", anchors.rise, "right", "Δy = " + fmt(fx(xb) - fx(xa)), { color: C.guide, fontSize: 22 }));
      order.push("label_dx", "label_dy");
    }
  }
  push(kit.stroke("point_a", [A], { shapeHint: { type: "circle", c: A, r: 7 }, color: C.ink, fill: C.ink, strokeWidth: 2, ms: MS.dot }));
  push(kit.stroke("point_b", [B], { shapeHint: { type: "circle", c: B, r: 7 }, color: C.supply, fill: C.supply, strokeWidth: 2, ms: MS.dot }));
  anchors.point_a = A;
  anchors.point_b = B;
  const tx = plot.x0 + 24, ty = plot.y1 - 16;
  push(kit.text("slope_label", [tx, ty], "slope ≈ " + secSlope.toFixed(2), { fontSize: 26, color: C.supply, anchor: "start" }));
  push(kit.text("derivative_label", [tx, ty - 34], "f′(" + fmt(xa) + ") = " + deriv.toFixed(2), { fontSize: 26, color: C.demand, anchor: "start" }));
  anchors.slope_label = [tx + 60, ty];
  anchors.derivative_label = [tx + 60, ty - 34];
  return { drawables, labels, anchors, order };
```

Check the kit surface as you go (`src/scenes/kit.ts`: `expr`, `sample`, `plotArea`, `AXIS_OVERHANG`, `axisLabel`, `label`, `text`, `stroke`, `area`; `SKETCH_MS` keys `axis curve region stroke connector dot text` in `src/layout/model.ts`). If a lint warning about a text sitting on the curve appears for the default expression, move `tx`/`ty` (the top-left corner is free for an increasing curve; test both examples).

- [ ] **Step 4: Run**

Run: `npx vitest run tests/calculus-templates.test.ts tests/catalog.test.ts tests/examples.test.ts`
Expected: the template tests PASS; `examples.test.ts` FAILS on "every ready template has an example or a fewshot" until Task 9 adds the two bundled examples — if Task 9 has not run yet, note that in the report rather than adding the examples here.

---
### Task 9: Bundled examples, the prompt's cross-cutting lines, the roadmap

Runs after Tasks 1–8.

**Files:**
- Modify: `src/examples.json` (append eight entries at the end of the array)
- Modify: `src/llm/prompts/compiler-v1.md` (the approach list, line ~13; the `move` bullet ~62; the "Attached labels follow a translation" phrase in that bullet)
- Modify: `ROADMAP.md` (a new section after "Motion and primitives — done 2026-09-08")
- Test: `tests/examples.test.ts` (runs as is), `tests/prompt.test.ts` (extend)

**Interfaces:**
- Consumes every verb and template from Tasks 1–8 by name: `move.anchor`, `to: {ref, anchor}`, `pivot: {anchor}`, `trail`, `flip`, `morph`, `flow`, `riemann_sum`, `tangent_secant`.

- [ ] **Step 1: Extend the prompt test**

Append to `tests/prompt.test.ts`'s first `describe`:

```ts
  test("teaches anchors and the four motion-round-2 verbs", () => {
    for (const s of ["\"anchor\": \"tail\"", "`flip`", "`morph`", "`flow`", "\"trail\": true", "riemann_sum", "tangent_secant", "compute a coordinate for a point you can name"]) expect(compilerV1).toContain(s);
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/prompt.test.ts tests/examples.test.ts`
Expected: the new prompt test FAILS; the examples test FAILS on "every ready template has an example or a fewshot" for the two templates.

- [ ] **Step 3: The prompt**

`src/llm/prompts/compiler-v1.md`:
- Line ~13, extend the sentence about `circle_sectors`: "…; what an integral is / the area under a curve is `riemann_sum`, and what a derivative is / a secant becoming a tangent is `tangent_secant`, when they are in the shortlist."
- The `move` bullet: replace "`to: [x, y]` sends its centre to a point" with "`to` sends the element's `anchor` (default its centre) to a point — `{\"move\": {\"target\": \"b\", \"anchor\": \"tail\", \"to\": {\"ref\": \"a\", \"anchor\": \"tip\"}}}` puts vector b's tail on a's tip; `pivot: {\"anchor\": \"vertex_2\"}` turns an element about its OWN vertex, `pivot: {\"ref\": \"wheel\"}` about another element's centre. **Never compute a coordinate for a point you can name**: `to`, `pivot`, `at` and arrow endpoints take `{ref, anchor}` (center/top/bottom/left/right/corners on anything; vertex_k, side_k, centroid on polygons; apex, arc on sectors; tail, tip on arrows; start, end, point_k on paths)." Replace "Attached labels follow a translation; intersection points, guide lines and regions do NOT — redraw those." with "Attached labels follow their element's move, turn and scale (the text itself never rotates); intersection points, guide lines and regions do NOT — redraw those." Append the trail sentence from Task 6 if it is not already there.

- [ ] **Step 4: The eight examples**

Append to the array in `src/examples.json` (keep the file's existing formatting — it is pretty-printed JSON; match its indentation):

```json
{"request":"Hvordan legger man sammen to vektorer?","packs":[],"spec":{"title":"Vektorsum: hale mot spiss","elements":[
 {"id":"a","type":"arrow","from":{"x":200,"y":250},"to":{"x":480,"y":330},"style":{"color":"#b5482e","stroke_width":4}},
 {"id":"la","type":"label","attach_to":"a","side":"below","text":"a","style":{"color":"#b5482e"}},
 {"id":"b","type":"arrow","from":{"x":200,"y":450},"to":{"x":330,"y":650},"style":{"color":"#2f6b8f","stroke_width":4}},
 {"id":"lb","type":"label","attach_to":"b","side":"left","text":"b","style":{"color":"#2f6b8f"}},
 {"id":"sum","type":"arrow","from":{"x":200,"y":250},"to":{"x":610,"y":530},"style":{"color":"#8a5fa8","stroke_width":4}},
 {"id":"lsum","type":"label","attach_to":"sum","side":"below-right","text":"a + b","style":{"color":"#8a5fa8"}}],
"commands":[
 {"draw":["a","la"],"speak":"To vektorer. Den røde er a: den peker mot høyre og litt opp."},
 {"draw":["b","lb"],"speak":"Den blå er b: kortere, og mest oppover."},
 {"move":{"target":["b"],"anchor":"tail","to":{"ref":"a","anchor":"tip"},"duration":1.5},"speak":"Å legge dem sammen betyr å sette halen på b i spissen av a."},
 {"draw":["sum","lsum"],"speak":"Summen går fra start til slutt: fra halen på a til spissen av b."},
 {"point":{"at":{"ref":"b","anchor":"tip"},"gesture":"circle"},"speak":"Rekkefølgen spiller ingen rolle: b først og så a ender i samme punkt."}]}}
```

```json
{"request":"Hvorfor er arealet av en trekant halvparten av grunnlinje ganger høyde?","packs":[],"spec":{"title":"Trekant = halvt parallellogram","elements":[
 {"id":"tri","type":"polygon","points":[[250,250],[650,250],[400,550]],"style":{"fill":"#f2c14e"}},
 {"id":"kopi","type":"polygon","points":[[250,250],[650,250],[400,550]],"style":{"fill":"#87a878"}},
 {"id":"para","type":"polygon","points":[[250,250],[650,250],[800,550],[400,550]],"style":{"color":"#b5482e","stroke_width":3}},
 {"id":"t_b","type":"text","text":"b","x":450,"y":220,"font_size":30,"style":{"color":"#b5482e"}},
 {"id":"t_h","type":"text","text":"h","x":830,"y":400,"font_size":30,"style":{"color":"#b5482e"}}],
"commands":[
 {"draw":["tri"],"speak":"En trekant med grunnlinje b og høyde h. Hvorfor er arealet halvparten av b ganger h?"},
 {"draw":["kopi"],"speak":"Lag en kopi av trekanten, oppå den første."},
 {"move":{"target":["kopi"],"rotate":180,"pivot":{"anchor":"side_2"},"duration":2},"speak":"Snu kopien en halv omdreining om midtpunktet på den skrå siden."},
 {"draw":["para","t_b","t_h"],"speak":"Sammen fyller de to trekantene et parallellogram med samme grunnlinje og samme høyde: areal b ganger h."},
 {"fade":{"target":["kopi"],"to":0.25}},
 {"highlight":{"target":["tri"],"effect":"glow"},"speak":"Trekanten er nøyaktig halvparten av det. Derfor: en halv b h."}]}}
```

```json
{"request":"Hvilken vei går et punkt på et hjul som ruller?","packs":[],"spec":{"title":"Sykloiden","elements":[
 {"id":"bakke","type":"path","points":[[60,200],[940,200]],"style":{"color":"#8f887c","stroke_width":3}},
 {"id":"hjul","type":"shape","shape":"circle","x":160,"y":260,"radius":60,"style":{"color":"#3d3833","stroke_width":3}},
 {"id":"eike","type":"path","points":[[160,260],[160,200]],"style":{"color":"#8f887c","stroke_width":2}},
 {"id":"prikk","type":"shape","shape":"circle","x":160,"y":200,"radius":7,"style":{"color":"#b5482e","fill":"#b5482e"}}],
"commands":[
 {"draw":["bakke","hjul","eike","prikk"],"speak":"Et hjul med radius r står på bakken, og ett punkt på kanten er merket rødt. Hvor går det punktet når hjulet ruller?"},
 {"move":{"target":["hjul","eike","prikk"],"by":[377,0],"rotate":-360,"pivot":{"ref":"hjul"},"trail":{"of":"prikk"},"duration":4,"easing":"linear"},"speak":"Én omdreining. Punktet stiger, svever over hjulet, og lander på bakken igjen."},
 {"highlight":{"target":["prikk_trail"],"effect":"glow"},"speak":"Buen heter sykloiden. Den er ikke en sirkelbue: punktet står stille i det øyeblikket det treffer bakken."},
 {"point":{"at":{"ref":"prikk"},"gesture":"tap"},"speak":"Og avstanden hjulet rullet på én omdreining er omkretsen: to pi r."}]}}
```

```json
{"request":"Hvordan henger husholdninger og bedrifter sammen i økonomien?","packs":[],"spec":{"title":"Det økonomiske kretsløpet","elements":[
 {"id":"hush","type":"node","shape":"rect","text":"Husholdninger","x":220,"y":375},
 {"id":"bedr","type":"node","shape":"rect","text":"Bedrifter","x":780,"y":375},
 {"id":"lonn","type":"arrow","from":{"ref":"bedr"},"to":{"ref":"hush"},"curved":true,"style":{"color":"#2f6b8f","stroke_width":3}},
 {"id":"l_lonn","type":"label","attach_to":"lonn","side":"below","text":"Lønn og inntekt","style":{"color":"#2f6b8f"}},
 {"id":"kjop","type":"arrow","from":{"ref":"hush"},"to":{"ref":"bedr"},"curved":true,"style":{"color":"#b5482e","stroke_width":3}},
 {"id":"l_kjop","type":"label","attach_to":"kjop","side":"above","text":"Kjøp av varer","style":{"color":"#b5482e"}}],
"commands":[
 {"draw":["hush","bedr"],"speak":"To slags aktører: husholdninger som eier arbeidskraften, og bedrifter som lager varene."},
 {"draw":["lonn","l_lonn"],"speak":"Bedriftene betaler lønn. Pengene går fra bedriftene til husholdningene."},
 {"draw":["kjop","l_kjop"],"speak":"Husholdningene bruker pengene på varer. Da går de tilbake til bedriftene."},
 {"flow":{"along":["lonn","kjop"]},"speak":"Pengene sirkulerer. Det én bruker, er det en annen tjener, og i neste runde er inntekten tilbake hos den som brukte."},
 {"flow":{"along":["kjop"],"speed":40,"color":"#8f887c"},"speak":"Sparer husholdningene mer, tynnes strømmen: bedriftene selger mindre, og lønningene i neste runde blir lavere."}]}}
```

(Check which way `curved: true` bows each arrow — `connectorDrawable` bows to the left of the travel direction — and put each label on the outside of its bow.)

```json
{"request":"Hva skjer med en figur når den speiles?","packs":[],"spec":{"title":"Speiling","elements":[
 {"id":"akse","type":"path","points":[[500,200],[500,620]],"style":{"color":"#8f887c","stroke_width":2,"dash":true}},
 {"id":"tri","type":"polygon","points":[[250,300],[450,300],[300,520]],"style":{"fill":"#f2c14e"}},
 {"id":"skygge","type":"polygon","points":[[250,300],[450,300],[300,520]],"style":{"color":"#8f887c","dash":true}},
 {"id":"t_a","type":"text","text":"A","x":230,"y":280,"font_size":26},
 {"id":"t_b","type":"text","text":"B","x":470,"y":280,"font_size":26},
 {"id":"t_c","type":"text","text":"C","x":290,"y":545,"font_size":26}],
"commands":[
 {"draw":["tri","t_a","t_b","t_c"],"speak":"En trekant med hjørnene A, B og C, lest mot klokka."},
 {"draw":["akse"],"speak":"Og en speilingsakse. Hva skjer når trekanten speiles i den?"},
 {"draw":["skygge"]},
 {"flip":{"target":["tri"],"line":{"from":{"ref":"akse","anchor":"start"},"to":{"ref":"akse","anchor":"end"}},"duration":1.6},"speak":"Hvert punkt havner like langt på den andre siden av aksen. Formen og størrelsen er bevart."},
 {"point":{"at":{"ref":"tri","anchor":"vertex_2"},"gesture":"circle"},"speak":"Men rekkefølgen har snudd: A, B, C går nå med klokka. En speiling kan aldri lages med bare flytting og dreining."},
 {"flip":{"target":["tri"],"axis":"horizontal","duration":1.2},"speak":"Speil én gang til, om en vannrett linje gjennom midten: da er retningen mot klokka igjen."}]}}
```

```json
{"request":"Hvorfor forandrer ikke arealet seg når et parallellogram skjæres?","packs":[],"spec":{"title":"Skjæring bevarer areal","elements":[
 {"id":"para","type":"polygon","points":[[200,250],[550,250],[700,500],[350,500]],"style":{"fill":"#87a878"}},
 {"id":"rekt","type":"polygon","points":[[200,250],[550,250],[550,500],[200,500]],"style":{"color":"#8f887c","dash":true}},
 {"id":"t_b","type":"text","text":"b","x":375,"y":220,"font_size":30},
 {"id":"t_h","type":"text","text":"h","x":170,"y":375,"font_size":30}],
"commands":[
 {"draw":["para","t_b","t_h"],"speak":"Et parallellogram med grunnlinje b og høyde h. Tenk på det som en stabel med tynne kort."},
 {"draw":["rekt"],"speak":"Skyv kortene så stabelen står rett. Hvert kort er like langt som før, og det er like mange kort."},
 {"morph":{"target":["para"],"to":{"ref":"rekt"},"duration":2},"speak":"Da er figuren et rektangel med sidene b og h. Arealet er uendret: b ganger h."},
 {"morph":{"target":["para"],"stretch":[2,1],"pivot":{"anchor":"left"},"duration":1.5},"speak":"Dobler vi grunnlinja og lar høyden stå, blir arealet dobbelt så stort. Ikke fire ganger: bare den ene faktoren vokste."}]}}
```

```json
{"request":"Hva er egentlig et integral?","packs":["mathlogic"],"spec":{"title":"Integralet: summen av tynne søyler","template":"riemann_sum","params":{"expr":"x*x/10 + 1","x_from":0,"x_to":10,"a":2,"b":8,"n":4,"rule":"left","x_label":"x","y_label":"f(x)"},"commands":[
 {"draw":["axes","x_label","y_label","curve"],"speak":"Hva er arealet under en kurve? Ingen formel for rektangler hjelper når kanten er buet."},
 {"draw":["area","label_a","label_b"],"speak":"Vi vil ha arealet mellom a og b. Ideen er å bytte det ut med noe vi kan regne på."},
 {"draw":["bar_1","bar_2","bar_3","bar_4"],"parallel":true,"speak":"Fire søyler, hver like høy som kurven i venstre kant. Søyler kan vi summere."},
 {"draw":["sum_label","exact_label"],"speak":"Summen er for liten: søylene mangler skivene under kurven."},
 {"animate":{"n":40},"duration":4,"speak":"Flere og tynnere søyler. Feilen krymper for hver deling."},
 {"highlight":{"target":["sum_label"],"effect":"glow"},"speak":"Grensen når søylene blir uendelig tynne er integralet. Det er ikke en formel: det er en sum som har sluttet å forandre seg."}]}}
```

```json
{"request":"Hva er den deriverte?","packs":["mathlogic"],"spec":{"title":"Den deriverte: stigningen i ett punkt","template":"tangent_secant","params":{"expr":"x*x/10 + 1","x_from":0,"x_to":10,"at":4,"h":4,"x_label":"x","y_label":"f(x)"},"commands":[
 {"draw":["axes","x_label","y_label","curve"],"speak":"Hvor bratt er en kurve i ett punkt? En rett linje har én stigning, men denne stiger mer og mer."},
 {"draw":["point_a","point_b","secant"],"speak":"Ta to punkter på kurven, A og B, og trekk linja gjennom dem."},
 {"draw":["run","rise","label_dx","label_dy","slope_label"],"speak":"Stigningen er endring i høyde delt på endring i bredde: delta y over delta x."},
 {"animate":{"h":0.05},"duration":4,"speak":"Flytt B nærmere A. Linja vipper, og stigningstallet nærmer seg én bestemt verdi."},
 {"draw":["tangent","derivative_label"],"speak":"Den verdien er den deriverte i A: stigningen til tangenten, linja som bare så vidt berører kurven."},
 {"highlight":{"target":["derivative_label"],"effect":"glow"},"speak":"Den deriverte er altså ikke en stigning mellom to punkter, men det stigningen går mot når punktene smelter sammen."}]}}
```

For every example: `validateSpec` ok, `planCommands` without an unknown-id warning, `layoutSpec` with no lint issue at all, `lintCommands` empty (the examples test checks each). Fix coordinates rather than weaken tests: a label that lands on a stroke moves to another `side`; a text that overlaps moves.

- [ ] **Step 5: ROADMAP entry**

Append after the "Motion and primitives — done 2026-09-08" section (before "Sound"):

```markdown
## Anchors and motion round 2 — done 2026-09-08

Hans's question: what else should drawcast have to explain visually — more
primitives, mathematical objects as templates, other ways to divide, stack or
move? The assessment (design
`docs/superpowers/specs/2026-09-08-anchors-and-motion-round-2-design.md`,
ledger `docs/superpowers/plans/2026-09-08-anchors-and-motion-round-2-ledger.md`):
the biggest gap was not a shape but that the model still computed coordinates
for pivots, destinations and arrow endpoints. Shipped:

1. **Anchors.** Named points on every element (`center`, the box's edges and
   corners; `vertex_k` / `side_k` / `centroid` on polygons; `apex` / `arc` /
   `start` / `end` on sectors; `tail` / `tip` on arrows; `point_k` on paths),
   accepted wherever a verb takes a point (`PointRef`: `[x, y]` or
   `{ref, anchor}`) — `move.to`, `move.pivot`, `arrange.at`, `point.at`,
   `camera.center`, arrow endpoints — plus `move.anchor` for which point of
   the moving element lands. An explicit pivot now rides with the move's own
   translation, so `by` + `rotate` rolls a wheel instead of swinging it.
2. **Followers ride the pose change.** A label follows its element's turn and
   scale (positioned, never rotated) — zipper and fan carry their labels too.
3. **`flip`.** Reflection across an axis or a drawn line, in the pose model
   (`Turn.mirror`, exact composition), played as a turn-over (a squash
   through the mirror line).
4. **`morph`.** An outline tweened to another element's outline, to points, or
   `stretch: [sx, sy]` about a pivot (shearing, non-uniform scale); scene
   state `shapes`, backend `setPoints`.
5. **`trail`** on `move`: the track of an anchor minted as an element
   `<id>_trail` (cycloids, orbits), fadeable and erasable.
6. **`flow`.** Dots or dashes streaming along strokes while a sentence lands
   (circular flow, current, blood, traffic).
7. **`riemann_sum` and `tangent_secant`** in the mathlogic pack — calculus
   had no template.
8. Eight bundled examples, every one a question.

Deliberately not done: a copies generator, `angle` / `measure` elements,
solids, more `pieces` cuts (rings, triangles, halving), more `arrange`
layouts (sort, align, mirror), rotated text, anchors on template ids beyond
the box, a persistent flow, morphing a `shape` circle.
```

- [ ] **Step 6: Run**

Run: `npx vitest run tests/examples.test.ts tests/prompt.test.ts tests/calculus-templates.test.ts && npx tsc --noEmit`
Expected: all PASS.

---

## Controller's closing checklist (not a task)

- Full suite `npx vitest run`; `npm run build`; `npm run build:engine`.
- Playwright smoke on the dev server (spec §4): screenshots mid-step of the flip (Speiling), the morph (Skjæring), the flow (kretsløpet) and the trail (Sykloiden), plus the two template examples at the end of their animates. Saved to the scratchpad; findings in the ledger.
- Ledger: `docs/superpowers/plans/2026-09-08-anchors-and-motion-round-2-ledger.md`.

