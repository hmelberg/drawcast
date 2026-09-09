# Freehand Figures Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the model draw a figure with no template as named parts placed relative to each other, with smooth curves, formulas, a Commons photo and keyword icons — and give it a seed and a look at its own drawing.

**Architecture:** Spec-level additions (`at` relative placement, `group`, `path.smooth`, `math`, `image`, `icon`) resolved deterministically in `src/layout/tier2.ts` through a dependency-ordered emit loop and a post-emit shift; groups expand to members in the planner the way `pieces` already do; photos and icons resolve in the ensure phase like portraits; the compiler prompt gets a freehand section, a conditional code block, a router-supplied subject and an optional seed block; a visual repair round renders the figure to PNG and sends it back.

**Tech Stack:** TypeScript, Vite, vitest (node environment, no jsdom), rough.js SVG backend, mathjax-full (lite adaptor), Anthropic SDK (streaming, content blocks), Wikimedia REST + Commons API, Iconify API.

**Spec:** `docs/superpowers/specs/2026-09-09-freehand-figures-design.md` (with the `at` amendment recorded in §3.1: `at` is one field for absolute, intersection and relative placement).

## Global Constraints

- Canvas is logical 1000×750, y-up, origin bottom-left; `toSvgY` is the only y-flip (README).
- The model writes semantics; code computes geometry. No coordinate arithmetic in the prompt beyond what exists.
- Existing behaviour must not change: elements without `at.ref`, outside any group, and every template lay out byte-identically (guarded by `tests/examples.test.ts`, which requires zero lint issues at every severity on all 211 bundled examples).
- `npm test` must stay green after every task; the examples gate and `tests/prompt.test.ts` string pins are part of it.
- Font floor: lint warns below 14 (`FONT_FLOOR`), the prompt asks for ≥ 18.
- No new eager chunk in `dist/` (main), the viewer or the engine build: mathjax stays lazy (`ensureEngines`), Iconify and Commons are fetched at resolve time and baked into the element.
- Prompt budget (spec §6.3): schema growth ≤ 5,500 chars (≈ 1.5k tokens), prompt growth ≤ 3,700 chars (≈ 1k tokens), and the assembled system prompt for a non-code request must be smaller than today's baseline (measured in Task 10, step 1).
- Licences (spec §3.7): permissive sets by default, CC BY as fallback, BY-SA only by explicit `set:` and never as a seed, logo sets never.
- Commit after every task with a one-sentence message ending in `(freehand, Task N)`, on the worktree branch created in Task 1 step 1.
- Test conventions: flat `tests/<topic>.test.ts`, inline spec literals cast `as SpecElement[]`, local drawable factories (see `tests/lint.test.ts:7-13`), `vi.stubGlobal("fetch", …)` before imports or injected deps for network.

---

## Coordination with motion round 3 (worktree `template-spike`, branch `worktree-template-spike`)

Another round is in flight in the same repo: ghosts (`keep`, `ghost` on the
motion verbs, minted elements), `angle` and `measure` elements, `pieces`
of rings/triangles/halving, `arrange: unroll`, `ellipse` and `line`
(`docs/superpowers/specs/2026-09-09-ghost-angle-measure-design.md`, nine
tasks; six committed as of 2026-09-09 17:03, three left: ellipse/line,
leftovers, prompt + seven examples). Its diff against main is 3,710 lines
over 30 files. Where it meets this plan:

| File | Round 3 | This plan | Resolution |
|---|---|---|---|
| `src/spec/types.ts` `SpecElement.at` | widened to `{x, y, intersection_of, ref, anchor} \| [number, number]` for `angle`'s vertex | adds `side, gap, offset` | One union: `{x?, y?, intersection_of?, ref?, anchor?, side?, gap?, offset?} \| [number, number]`. Every `at` reader in this plan guards `Array.isArray(el.at)` first. `angle`'s `at: {ref, anchor}` already means "vertex on that point" — the same semantics as this plan's anchor placement, so nothing to reconcile. |
| `src/spec/schema.ts` `at` block, type enum, `elementErrors` | `angle`/`measure`/`ellipse`/`line`; a guard that a `point`'s `at` has no `ref`/`anchor` | `group`/`math`/`image`/`icon`; `at.ref` on coordinate-placed elements | Merge both enums; extend the shared `at` schema with `side/gap/offset`; keep round 3's `point` guard (a point never gets relative placement). |
| `src/layout/tier2.ts` | new cases `angle`, `measure`, ring/triangle/halving pieces, `resolvePointRef`, `Ctx`/`Tier2Result.measures` | emit-order rewrite of pass 3, post-emit shift, `group`/`math`/`image`/`icon` cases, `Ctx.groups/groupBoxes/fitGroups`, `issues` | Textual conflicts certain in the switch and the `Ctx`/`Tier2Result` interfaces. Do Tasks 3–8 only on a base that already contains round 3. The post-emit shift is generic and covers the new element kinds for free; `pieces` builders take `c: Pt` — pass `originOr(el, …)` there too. |
| `src/render/plan.ts` | ghosts, `keep`, `texts` state, measure follow, ~300 lines | `expandGroup` in `resolveIds`, shared pivot in `move` | `resolveIds` is one function — add `expandGroup` after round 3 lands; then `keep: {target: "pump"}` and `ghost: true` on a group move work for free. |
| `src/layout/layout.ts` `LayoutResult` | `measures` | `groups`, `fitGroups` | Trivial; both fields added. |
| `src/render/index.ts` | minted ghosts through `withTrails`, `bboxesFor` | `resolveImages`/`resolveIcons` in the ensure phase, `expandGroup` in `planOptionsFor`, engines for the spec | Different lines; rebase resolves. |
| `src/llm/prompts/compiler-v1.md` | verb list + `keep`/`ghost` bullet, `angle`/`measure` bullets | replaces lines 14–15, moves 48–49 out | Line numbers in this plan are hints from main; after rebase find the bullets by their opening text. The prompt-size baseline (Task 10 step 1) must be measured on the MERGED base, not on today's main. |
| `tests/prompt.test.ts`, `tests/schema.test.ts`, `tests/tier2.test.ts`, `tests/examples.test.ts` | pins added | pins added | Additive. |
| `src/examples.json`, `fewshots.json` | seven examples (round 3 Task 9) | six examples, three few-shots | Additive; both must pass the same gate. |

Semantic overlap worth using, not avoiding: a `group` is a natural
`keep`/`ghost` target ("keep the whole pump faded while the piston
moves"); a `measure` can measure a group member; `angle` and `measure`
can be group members. No verb or field is defined twice.

**Sequencing.** Tasks that touch none of the round-3 files can start now
on the `freehand` worktree branched from main: **1** (helpers), **7 steps
1–4** (image resolver only), **12 steps 1–3 and the resolver half of 6**
(SVG arcs, Iconify resolver, licence table, codec), **13 steps 1–3 for
`router.ts`/`seed.ts`** (compile wiring waits), **14's `visual.ts`** and
**15's eval script**. Everything that edits `types.ts`, `schema.ts`,
`tier2.ts`, `plan.ts`, `layout.ts`, `render/index.ts`, `compile.ts`, the
prompt or the examples waits until round 3 is merged to main; then
`git merge main` into `freehand`, re-run the suite, and continue with
Tasks 2–6, 8–11 and the wiring halves of 7, 12, 13, 14.

---

### Task 1: Geometry helpers — element boxes, fit regions, Catmull-Rom, simplify

**Files:**
- Create: `src/layout/boxes.ts`
- Create: `src/layout/regions.ts`
- Create: `src/layout/smooth.ts`
- Modify: `src/layout/layout.ts:236-263` (move `unionBBoxForId` out; re-export)
- Modify: `src/scenes/kit.ts:699-731` (delegate `smooth`/`smoothClosed`)
- Modify: `src/layout/geometry.ts` (add `simplifyPolyline`)
- Test: `tests/boxes.test.ts`, `tests/regions.test.ts`, `tests/smooth.test.ts`

**Interfaces:**
- Produces: `unionBBoxForId(drawables: Drawable[], id: string, measure: MeasureFn): BBox | null` (moved, same behaviour as layout.ts:236); `fitRegion(name: FitName): BBox`; `FitName = "left" | "right" | "top" | "bottom" | "full"`; `catmullRom(pts: Pt[], per?: number): Pt[]`; `catmullRomClosed(pts: Pt[], per?: number): Pt[]`; `simplifyPolyline(pts: Pt[], epsilon: number): Pt[]`.

- [ ] **Step 1: Create the worktree branch**

```bash
cd /Users/hom/Documents/GitHub/drawcast
git worktree add .claude/worktrees/freehand -b freehand main
cd .claude/worktrees/freehand && npm install --no-audit --no-fund
```

- [ ] **Step 2: Write the failing tests**

`tests/regions.test.ts`:
```ts
import { describe, expect, test } from "vitest";
import { fitRegion } from "../src/layout/regions";

describe("fitRegion", () => {
  test("halves share the band and do not overlap", () => {
    const l = fitRegion("left"), r = fitRegion("right");
    expect(l).toEqual({ x: 60, y: 95, w: 420, h: 560 });
    expect(r).toEqual({ x: 520, y: 95, w: 420, h: 560 });
    expect(l.x + l.w + 40).toBe(r.x);
  });
  test("top is the upper band (y-up), bottom the lower", () => {
    expect(fitRegion("top")).toEqual({ x: 60, y: 395, w: 880, h: 260 });
    expect(fitRegion("bottom")).toEqual({ x: 60, y: 95, w: 880, h: 260 });
    expect(fitRegion("full")).toEqual({ x: 60, y: 95, w: 880, h: 560 });
  });
});
```

`tests/smooth.test.ts`:
```ts
import { describe, expect, test } from "vitest";
import { catmullRom, catmullRomClosed } from "../src/layout/smooth";
import { simplifyPolyline } from "../src/layout/geometry";

describe("catmullRom", () => {
  test("passes through every input point, in order", () => {
    const pts: [number, number][] = [[0, 0], [100, 50], [200, 0], [300, 80]];
    const out = catmullRom(pts, 8);
    for (const p of pts) expect(out.some(([x, y]) => Math.abs(x - p[0]) < 1e-9 && Math.abs(y - p[1]) < 1e-9)).toBe(true);
    expect(out[0]).toEqual(pts[0]);
    expect(out[out.length - 1]).toEqual(pts[pts.length - 1]);
    expect(out.length).toBe((pts.length - 1) * 8 + 1);
  });
  test("closed version wraps and does not repeat the first point", () => {
    const pts: [number, number][] = [[0, 0], [100, 0], [100, 100], [0, 100]];
    const out = catmullRomClosed(pts, 4);
    expect(out.length).toBe(pts.length * 4);
    expect(out[0]).toEqual(pts[0]);
    expect(out[out.length - 1]).not.toEqual(pts[0]);
  });
});

describe("simplifyPolyline", () => {
  test("drops collinear points and keeps corners", () => {
    const line: [number, number][] = [[0, 0], [1, 0.001], [2, 0], [3, 0], [3, 3]];
    expect(simplifyPolyline(line, 0.1)).toEqual([[0, 0], [3, 0], [3, 3]]);
  });
  test("keeps two points minimum", () => {
    expect(simplifyPolyline([[0, 0], [5, 5]], 10)).toEqual([[0, 0], [5, 5]]);
  });
});
```

`tests/boxes.test.ts`:
```ts
import { describe, expect, test } from "vitest";
import { unionBBoxForId } from "../src/layout/boxes";
import { heuristicMeasure } from "../src/layout/measure";
import { defaultDrawOpts, defaultStyle, type Drawable } from "../src/layout/model";

const stroke = (id: string, pts: [number, number][]): Drawable => ({ id, kind: "stroke", pts, z: 1, style: defaultStyle(), drawOpts: defaultDrawOpts("sketch") });

describe("unionBBoxForId", () => {
  test("unions an element with its sub-drawables and ignores leaders", () => {
    const ds = [stroke("a", [[0, 0], [10, 10]]), stroke("a_wash", [[0, 0], [20, 5]]), stroke("a_leader", [[0, 0], [500, 500]])];
    expect(unionBBoxForId(ds, "a", heuristicMeasure)).toEqual({ x: 0, y: 0, w: 20, h: 10 });
  });
  test("null for an unknown id", () => {
    expect(unionBBoxForId([], "nope", heuristicMeasure)).toBeNull();
  });
});
```

- [ ] **Step 3: Run the tests to see them fail**

Run: `npx vitest run tests/regions.test.ts tests/smooth.test.ts tests/boxes.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 4: Implement**

`src/layout/regions.ts`:
```ts
import type { BBox } from "./geometry";

/** Named canvas regions a group can be fitted into (spec §3.2). Same
 *  margin (60) and band (y 95, h 560) the code/figure split uses
 *  (figure-split.ts MARGIN, BAND), with its 40-unit gutter between halves. */
export const FIT_NAMES = ["left", "right", "top", "bottom", "full"] as const;
export type FitName = (typeof FIT_NAMES)[number];

const MARGIN = 60, GUTTER = 40, BAND_Y = 95, BAND_H = 560, CANVAS_W = 1000;
const FULL_W = CANVAS_W - 2 * MARGIN;          // 880
const HALF_W = (FULL_W - GUTTER) / 2;          // 420
const HALF_H = (BAND_H - GUTTER) / 2;          // 260

export function fitRegion(name: FitName): BBox {
  switch (name) {
    case "left": return { x: MARGIN, y: BAND_Y, w: HALF_W, h: BAND_H };
    case "right": return { x: MARGIN + HALF_W + GUTTER, y: BAND_Y, w: HALF_W, h: BAND_H };
    case "top": return { x: MARGIN, y: BAND_Y + HALF_H + GUTTER, w: FULL_W, h: HALF_H };
    case "bottom": return { x: MARGIN, y: BAND_Y, w: FULL_W, h: HALF_H };
    case "full": return { x: MARGIN, y: BAND_Y, w: FULL_W, h: BAND_H };
  }
}

export function isFitName(v: unknown): v is FitName {
  return typeof v === "string" && (FIT_NAMES as readonly string[]).includes(v);
}
```

`src/layout/smooth.ts` — move the bodies of `kit.smooth` (kit.ts:699-715) and `kit.smoothClosed` (kit.ts:716-731) here verbatim as `export function catmullRom(pts: Pt[], per = 8): Pt[]` and `export function catmullRomClosed(pts: Pt[], per = 4): Pt[]`; in kit.ts replace the two bodies with `return catmullRom(pts, per)` / `return catmullRomClosed(pts, per)` (import from `../layout/smooth`). Return early with a copy when `pts.length < 3`.

`src/layout/geometry.ts` — append:
```ts
/** Ramer–Douglas–Peucker. Keeps endpoints; drops points within epsilon of the chord. */
export function simplifyPolyline(pts: Pt[], epsilon: number): Pt[] {
  if (pts.length <= 2) return pts.slice();
  const [a, b] = [pts[0], pts[pts.length - 1]];
  let maxD = -1, idx = -1;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = pointToSegment(pts[i], a, b);
    if (d > maxD) { maxD = d; idx = i; }
  }
  if (maxD <= epsilon) return [a, b];
  const left = simplifyPolyline(pts.slice(0, idx + 1), epsilon);
  const right = simplifyPolyline(pts.slice(idx), epsilon);
  return left.slice(0, -1).concat(right);
}

function pointToSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
  const qx = a[0] + t * dx, qy = a[1] + t * dy;
  return Math.hypot(p[0] - qx, p[1] - qy);
}
```
(`Pt` is `[number, number]`; import the type from `./model`.)

`src/layout/boxes.ts` — cut `unionBBoxForId` (layout.ts:236-263, private) and paste it here as `export function unionBBoxForId(drawables: Drawable[], id: string, measure: MeasureFn): BBox | null`, keeping the `_leader`/`_guides` exclusion and the text/image/circle/rect/pts branches exactly. In layout.ts add `import { unionBBoxForId } from "./boxes";` and delete the local copy. `elementBBoxes` (layout.ts:265) keeps working unchanged.

- [ ] **Step 5: Run the tests**

Run: `npx vitest run tests/regions.test.ts tests/smooth.test.ts tests/boxes.test.ts tests/anchors.test.ts tests/examples.test.ts`
Expected: PASS (examples still byte-identical — kit delegates to the same arithmetic).

- [ ] **Step 6: Commit**

```bash
git add src/layout/boxes.ts src/layout/regions.ts src/layout/smooth.ts src/layout/geometry.ts src/layout/layout.ts src/scenes/kit.ts tests/boxes.test.ts tests/regions.test.ts tests/smooth.test.ts
git commit -m "Boxes, fit regions, Catmull-Rom and simplify as layout helpers (freehand, Task 1)"
```

---

### Task 2: Spec types, schema and validation for the new fields and element types

**Files:**
- Modify: `src/spec/types.ts:12-31` (ElementType), `:77-196` (SpecElement)
- Modify: `src/spec/schema.ts:90-96` (type enum), `:108-117` (`at`), element properties around `:160-226`, `elementErrors` `:1159-1246`
- Test: `tests/schema-freehand.test.ts`

**Interfaces:**
- Produces on `SpecElement`: `at?: { x?: number; y?: number; intersection_of?: string[]; ref?: string; anchor?: string; side?: Side; gap?: number; offset?: [number, number] }`; `anchor?: string` (own landing point); `members?: string[]`; `fit?: FitName | { x: number; y: number; w: number; h: number }`; `smooth?: boolean`; `tex?: string`; `size?: number`; `set?: string`; `credit?: string`. New `ElementType` members: `"group" | "math" | "image" | "icon"`.
- `validateSpec` accepts `text` with `at.ref` and no x/y; rejects `group` without members, `math` without `tex`, `image`/`icon` without `of`, and x/y together with `at.ref`.

- [ ] **Step 1: Write the failing tests**

`tests/schema-freehand.test.ts`:
```ts
import { describe, expect, test } from "vitest";
import { validateSpec } from "../src/spec/schema";

const ok = (elements: unknown[]) => validateSpec({ elements, commands: [{ draw: elements.map((e) => (e as { id: string }).id) }] });

describe("freehand spec fields", () => {
  test("text may be placed with at.ref instead of x/y", () => {
    expect(ok([{ id: "a", type: "shape", shape: "rect", x: 100, y: 100 }, { id: "t", type: "text", text: "hi", at: { ref: "a", side: "above", gap: 10 } }]).ok).toBe(true);
  });
  test("x/y together with at.ref is rejected", () => {
    const r = ok([{ id: "a", type: "shape", shape: "rect", x: 100, y: 100 }, { id: "t", type: "text", text: "hi", x: 5, y: 5, at: { ref: "a" } }]);
    expect(r.ok).toBe(false);
    expect(r.errors.join(" ")).toMatch(/"t".*at\.ref.*x\/y/);
  });
  test("group needs members; math needs tex; image and icon need of", () => {
    expect(ok([{ id: "g", type: "group" }]).errors.join(" ")).toMatch(/"g".*members/);
    expect(ok([{ id: "m", type: "math", x: 1, y: 1 }]).errors.join(" ")).toMatch(/"m".*tex/);
    expect(ok([{ id: "i", type: "image", x: 1, y: 1 }]).errors.join(" ")).toMatch(/"i".*of/);
    expect(ok([{ id: "k", type: "icon", x: 1, y: 1 }]).errors.join(" ")).toMatch(/"k".*of/);
  });
  test("a full freehand thing validates", () => {
    expect(ok([
      { id: "body", type: "shape", shape: "rect", x: 300, y: 300, width: 60, height: 200 },
      { id: "piston", type: "shape", shape: "rect", width: 40, height: 60, at: { ref: "body", anchor: "top" }, anchor: "bottom" },
      { id: "hose", type: "path", points: [[0, 0], [40, -20], [80, 0]], smooth: true, at: { ref: "body", side: "right", gap: 6 } },
      { id: "pump", type: "group", members: ["body", "piston", "hose"], fit: "left" },
      { id: "f", type: "math", tex: "p V = n R T", size: 30, at: { ref: "pump", side: "above", gap: 20 } },
      { id: "photo", type: "image", of: "Bicycle pump", width: 200, at: { ref: "pump", side: "right", gap: 30 } },
      { id: "ic", type: "icon", of: "factory", size: 80, x: 800, y: 200 },
    ]).ok).toBe(true);
  });
});
```

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run tests/schema-freehand.test.ts`
Expected: FAIL (`additionalProperties` / unknown type).

- [ ] **Step 3: Types**

In `src/spec/types.ts`:
- Extend `ElementType` (line 12-31) with `| "group" | "math" | "image" | "icon"`.
- Replace the `at` field (line 91) with:
```ts
  /** Where the element goes. point: `{x, y}` or `intersection_of`. Any coordinate-placed element: `{ref, side?, gap?, anchor?, offset?}` — placed relative to another element's box (side: outside it, gap units away; anchor: a named point on it). Never together with x/y. */
  at?: { x?: number; y?: number; intersection_of?: string[]; ref?: string; anchor?: string; side?: Side; gap?: number; offset?: [number, number] };
  /** Own landing point when placed with at (default: the side opposite at.side, else center). Same convention as move. */
  anchor?: string;
```
- Add after `closed` (line 116): `smooth?: boolean;` (doc: "path: Catmull-Rom through the points").
- Add: `members?: string[];` (group), `fit?: "left" | "right" | "top" | "bottom" | "full" | { x: number; y: number; w: number; h: number };`, `tex?: string;` (math / label), `size?: number;` (math: x-height-based font size; icon: box size), `set?: string;` (icon set prefix), `credit?: string;` (image/icon: attribution, machine-written).

- [ ] **Step 4: Schema**

In `src/spec/schema.ts`:
- Type enum (90-96): append `"group", "math", "image", "icon"`.
- Replace the `at` object (108-117) with one that lists `x, y, intersection_of, ref (string), anchor (string), side (enum SIDE_VALUES), gap (number), offset (array of 2 numbers)`, `additionalProperties: false`, description: `"Where the element goes. point: x,y or intersection_of. Others: ref + side/gap (outside another element's box) or ref + anchor (a named point on it); optional offset. Never with x/y."`
- Add properties, each one line, descriptions ≤ 120 chars:
  - `anchor: { type: "string", description: "With at: which of THIS element's anchors lands there (default opposite of at.side, else center)." }`
  - `smooth: { type: "boolean", description: "path: smooth curve through the points (Catmull-Rom)." }`
  - `members: { type: "array", items: { type: "string" }, minItems: 1, description: "group: element ids that form one thing; draw/move/highlight the group id to act on all." }`
  - `fit: { oneOf: [{ type: "string", enum: ["left","right","top","bottom","full"] }, { type: "object", properties: { x:{type:"number"}, y:{type:"number"}, w:{type:"number"}, h:{type:"number"} }, required:["x","y","w","h"], additionalProperties:false }], description: "group: scale and centre the members into this region or box (aspect kept)." }`
  - `tex: { type: "string", description: "math: LaTeX, drawn as handwriting. label: LaTeX instead of text." }`
  - `size: { type: "number", description: "math: font size (≥ 18). icon: box size in logical units (default 100)." }`
  - `set: { type: "string", description: "icon: icon set prefix (lucide, tabler, ph, heroicons, material-symbols; fa6-solid, twemoji as CC BY)." }`
  - `credit: { type: "string", description: "image/icon: attribution (machine-written; copy VERBATIM if present)." }`
- Extend `of` (182-188) description with `" image: what to photograph (a Commons/Wikipedia title). icon: a keyword."` and `width` (164) with `"/ image: width"`.
- In `elementErrors` (1159-1246): the `text` branch (1202-1205) requires `text` and (numeric x and y OR `at.ref` string); add branches: `group` → `members` non-empty array of strings else `element "<id>": group needs members`; `math` → `tex` non-empty string else `element "<id>": math needs tex`; `image`/`icon` → `of` non-empty string else `element "<id>": <type> needs of`. For every type: if `at?.ref` and (`x` or `y` is a number) → `element "<id>": at.ref cannot be combined with x/y`.

- [ ] **Step 5: Run the tests**

Run: `npx vitest run tests/schema-freehand.test.ts tests/schema.test.ts tests/examples.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/spec/types.ts src/spec/schema.ts tests/schema-freehand.test.ts
git commit -m "Spec fields for relative placement, groups, smooth paths, math, image and icon (freehand, Task 2)"
```

---

### Task 3: Relative placement — dependency order, post-emit shift, `placement` lint

**Files:**
- Create: `src/layout/place.ts`
- Modify: `src/layout/tier2.ts:94-100` (signature), `:73-92` (Ctx), `:149-247` (emit loop), `:47-71` (Tier2Result)
- Modify: `src/layout/layout.ts:98-123` (pass measure and seed drawables; merge issues), `:156` (issues)
- Modify: `src/lint/lint.ts:21-43` (LintIssue rule union)
- Test: `tests/place.test.ts`, `tests/placement-layout.test.ts`

**Interfaces:**
- Consumes: `unionBBoxForId`, `boxAnchor`, `isUniversalAnchor` (anchors.ts), `SIDE_VALUES`.
- Produces: `placementOrder(elements: SpecElement[]): { order: SpecElement[]; issues: LintIssue[] }` (topological by `at.ref`, `attach_to`, `members`; cycles and unknown refs reported); `shiftDrawables(ds: Drawable[], dx: number, dy: number): void` (in place, recursive into groups, shapeHint too); `relativeDelta(own: BBox, ref: BBox, refAnchors: Record<string, Pt>, at: NonNullable<SpecElement["at"]>, ownAnchor: string | undefined): Pt` (dx, dy to move `own` so the placement holds); `layoutElements(elements, domain, seedAnchors?, seedCurveSamples?, opts?: { measure?: MeasureFn; seedDrawables?: Drawable[] })`; `Tier2Result.issues: LintIssue[]`.
- `LintIssue.rule` gains `"placement" | "group-empty"`.

- [ ] **Step 1: Write the failing unit tests for the pure helpers**

`tests/place.test.ts`:
```ts
import { describe, expect, test } from "vitest";
import { placementOrder, relativeDelta, shiftDrawables } from "../src/layout/place";
import { defaultDrawOpts, defaultStyle, type Drawable } from "../src/layout/model";
import type { SpecElement } from "../src/spec/types";

const el = (o: Partial<SpecElement> & { id: string }): SpecElement => ({ type: "shape", ...o }) as SpecElement;

describe("placementOrder", () => {
  test("puts a referenced element before the one that refers to it", () => {
    const r = placementOrder([el({ id: "t", type: "text", at: { ref: "a", side: "above" } }), el({ id: "a", x: 1, y: 1 })]);
    expect(r.order.map((e) => e.id)).toEqual(["a", "t"]);
    expect(r.issues).toEqual([]);
  });
  test("unknown ref and cycle are placement errors; the elements still come out", () => {
    const r = placementOrder([el({ id: "p", at: { ref: "q" } }), el({ id: "q", at: { ref: "p" } }), el({ id: "z", at: { ref: "nope" } })]);
    expect(r.order.map((e) => e.id).sort()).toEqual(["p", "q", "z"]);
    expect(r.issues.map((i) => [i.rule, i.severity])).toEqual([["placement", "error"], ["placement", "error"]]);
    expect(r.issues.map((i) => i.message).join(" ")).toMatch(/unknown ref "nope"/);
    expect(r.issues.map((i) => i.message).join(" ")).toMatch(/cycle/);
  });
});

describe("relativeDelta", () => {
  const ref = { x: 100, y: 100, w: 50, h: 20 };
  const own = { x: 0, y: 0, w: 10, h: 10 };
  test("side above with gap: own bottom edge sits gap above ref top, centred", () => {
    const [dx, dy] = relativeDelta(own, ref, {}, { ref: "r", side: "above", gap: 12 }, undefined);
    expect(dx).toBeCloseTo(120); // own centre x 5 → 125
    expect(dy).toBeCloseTo(132); // own y 0 → 100+20+12
  });
  test("anchor on ref lands own anchor", () => {
    const [dx, dy] = relativeDelta(own, ref, {}, { ref: "r", anchor: "top_right" }, "bottom_left");
    expect([dx, dy]).toEqual([150, 120]);
  });
  test("geometric anchor from the ref's named points wins over the box", () => {
    const [dx, dy] = relativeDelta(own, ref, { tip: [999, 999] }, { ref: "r", anchor: "tip" }, "center");
    expect([dx, dy]).toEqual([994, 994]);
  });
  test("offset is added last", () => {
    const [dx, dy] = relativeDelta(own, ref, {}, { ref: "r", side: "right", gap: 0, offset: [3, -4] }, undefined);
    expect([dx, dy]).toEqual([153, 101]);
  });
});

describe("shiftDrawables", () => {
  test("moves pts, pos, shapeHint and children", () => {
    const ds: Drawable[] = [
      { id: "s", kind: "stroke", pts: [[0, 0], [1, 1]], z: 1, style: defaultStyle(), drawOpts: defaultDrawOpts("sketch"), shapeHint: { type: "circle", c: [0, 0], r: 5 } },
      { id: "g", kind: "group", z: 1, style: defaultStyle(), drawOpts: defaultDrawOpts("sketch"), children: [{ id: "t", kind: "text", pos: [2, 2], text: "x", fontSize: 20, anchor: "middle", z: 2, style: defaultStyle(), drawOpts: defaultDrawOpts("sketch") }] },
    ];
    shiftDrawables(ds, 10, -5);
    expect((ds[0] as { pts: number[][] }).pts).toEqual([[10, -5], [11, -4]]);
    expect((ds[0] as { shapeHint: { c: number[] } }).shapeHint.c).toEqual([10, -5]);
    expect(((ds[1] as { children: { pos: number[] }[] }).children[0]).pos).toEqual([12, -3]);
  });
});
```

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run tests/place.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/layout/place.ts`**

```ts
// Relative placement (spec §3.1, §4.1): the order elements must be laid
// out in, and the shift that puts an element where `at` says.
import type { BBox } from "./geometry";
import { boxAnchor } from "./anchors";
import type { Drawable, Pt } from "./model";
import type { LintIssue } from "../lint/lint";
import type { Side, SpecElement } from "../spec/types";

const OPPOSITE: Record<Side, string> = {
  above: "bottom", below: "top", left: "right", right: "left",
  "above-left": "bottom_right", "above-right": "bottom_left", "below-left": "top_right", "below-right": "top_left",
};

const relAt = (el: SpecElement) => (el.at && !Array.isArray(el.at) ? el.at : undefined);

function deps(el: SpecElement): string[] {
  const out: string[] = [];
  if (relAt(el)?.ref) out.push(relAt(el)!.ref!);
  if (el.type === "label" && el.attach_to) out.push(el.attach_to);
  if (el.type === "group") out.push(...(el.members ?? []));
  return out;
}

/** Topological order over at.ref / attach_to / members. Unknown refs and
 *  cycles are `placement` errors; the offending elements keep their spec
 *  position so layout still emits something. Template-exported ids (not
 *  in `elements`) are allowed refs — pass them in `known`. */
export function placementOrder(elements: SpecElement[], known: Set<string> = new Set()): { order: SpecElement[]; issues: LintIssue[] } {
  const byId = new Map(elements.map((e) => [e.id, e]));
  const issues: LintIssue[] = [];
  const state = new Map<string, 0 | 1 | 2>(); // unvisited / on stack / done
  const order: SpecElement[] = [];
  const visit = (el: SpecElement): void => {
    const s = state.get(el.id);
    if (s === 2) return;
    if (s === 1) { issues.push({ rule: "placement", ids: [el.id], severity: "error", message: `element "${el.id}": placement cycle through at.ref/attach_to/members` }); return; }
    state.set(el.id, 1);
    for (const d of deps(el)) {
      const dep = byId.get(d);
      if (dep) visit(dep);
      else if (!known.has(d) && relAt(el)?.ref === d) issues.push({ rule: "placement", ids: [el.id], severity: "error", message: `element "${el.id}": unknown ref "${d}" in at` });
    }
    state.set(el.id, 2);
    order.push(el);
  };
  for (const el of elements) visit(el);
  return { order, issues };
}

/** dx, dy that moves `own` so that at.side / at.anchor holds against `ref`. */
export function relativeDelta(own: BBox, ref: BBox, refAnchors: Record<string, Pt>, at: NonNullable<SpecElement["at"]>, ownAnchor: string | undefined): Pt {
  const gap = at.gap ?? 8;
  let target: Pt;
  let ownName: string;
  if (at.side) {
    const s = at.side;
    const cx = ref.x + ref.w / 2, cy = ref.y + ref.h / 2;
    const xs = s.endsWith("left") ? ref.x - gap : s.endsWith("right") ? ref.x + ref.w + gap : cx;
    const ys = s.startsWith("above") ? ref.y + ref.h + gap : s.startsWith("below") ? ref.y - gap : cy;
    target = [xs, ys];
    ownName = ownAnchor ?? OPPOSITE[s];
  } else {
    const name = at.anchor ?? "center";
    target = refAnchors[name] ?? boxAnchor(ref, name);
    ownName = ownAnchor ?? "center";
  }
  const from = boxAnchor(own, ownName);
  const [ox, oy] = at.offset ?? [0, 0];
  return [target[0] - from[0] + ox, target[1] - from[1] + oy];
}

/** Translate drawables in place (pts, pos, shapeHint, children). */
export function shiftDrawables(ds: Drawable[], dx: number, dy: number): void {
  for (const d of ds) {
    if (d.kind === "group") { shiftDrawables(d.children, dx, dy); continue; }
    if (d.kind === "text" || d.kind === "image") { d.pos = [d.pos[0] + dx, d.pos[1] + dy]; continue; }
    d.pts = d.pts.map(([x, y]) => [x + dx, y + dy] as Pt);
    if (d.kind === "area" && d.holes) d.holes = d.holes.map((h) => h.map(([x, y]) => [x + dx, y + dy] as Pt));
    if (d.kind === "stroke" && d.shapeHint) {
      d.shapeHint = d.shapeHint.type === "circle"
        ? { ...d.shapeHint, c: [d.shapeHint.c[0] + dx, d.shapeHint.c[1] + dy] }
        : { ...d.shapeHint, x: d.shapeHint.x + dx, y: d.shapeHint.y + dy };
    }
  }
}

export function shiftPoints(rec: Record<string, Pt> | undefined, dx: number, dy: number): void {
  if (!rec) return;
  for (const k of Object.keys(rec)) rec[k] = [rec[k][0] + dx, rec[k][1] + dy];
}
```
Add `"placement" | "group-empty"` to the `rule` union at `src/lint/lint.ts:21-43`.

- [ ] **Step 4: Run the unit tests**

Run: `npx vitest run tests/place.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing layout test**

`tests/placement-layout.test.ts`:
```ts
import { describe, expect, test } from "vitest";
import { layoutSpec, elementBBoxes } from "../src/layout/layout";

describe("relative placement in layoutSpec", () => {
  test("text placed above a rect sits gap above it, centred, in any spec order", () => {
    const r = layoutSpec({
      elements: [
        { id: "t", type: "text", text: "Piston", font_size: 24, at: { ref: "a", side: "above", gap: 10 } },
        { id: "a", type: "shape", shape: "rect", x: 300, y: 300, width: 100, height: 40 },
      ],
      commands: [{ draw: ["a", "t"] }],
    });
    const b = elementBBoxes(r);
    const a = b.get("a")!, t = b.get("t")!;
    expect(t.y).toBeCloseTo(a.y + a.h + 10, 0);
    expect(t.x + t.w / 2).toBeCloseTo(a.x + a.w / 2, 0);
    expect(r.issues.filter((i) => i.rule === "placement")).toEqual([]);
  });
  test("anchor placement: a circle's bottom lands on the rect's top", () => {
    const r = layoutSpec({
      elements: [
        { id: "a", type: "shape", shape: "rect", x: 300, y: 300, width: 100, height: 40 },
        { id: "c", type: "shape", shape: "circle", radius: 20, at: { ref: "a", anchor: "top" }, anchor: "bottom" },
      ],
      commands: [{ draw: ["a", "c"] }],
    });
    const b = elementBBoxes(r);
    expect(b.get("c")!.y).toBeCloseTo(b.get("a")!.y + b.get("a")!.h, 0);
  });
  test("a path's own anchors follow the shift", () => {
    const r = layoutSpec({
      elements: [
        { id: "a", type: "shape", shape: "rect", x: 300, y: 300, width: 100, height: 40 },
        { id: "p", type: "path", points: [[0, 0], [50, 30]], at: { ref: "a", side: "right", gap: 5 } },
      ],
      commands: [{ draw: ["a", "p"] }],
    });
    expect(r.namedAnchors.p.start[0]).toBeCloseTo(elementBBoxes(r).get("a")!.x + 100 + 5, 0);
  });
  test("unknown ref is an error-severity issue and the element still draws", () => {
    const r = layoutSpec({ elements: [{ id: "t", type: "text", text: "x", at: { ref: "ghost", side: "above" } }], commands: [{ draw: ["t"] }] });
    expect(r.issues.some((i) => i.rule === "placement" && i.severity === "error")).toBe(true);
    expect(r.order).toContain("t");
  });
});
```

- [ ] **Step 6: Run to see it fail**

Run: `npx vitest run tests/placement-layout.test.ts`
Expected: FAIL — text lands at canvas centre.

- [ ] **Step 7: Integrate into tier2 and layout**

In `src/layout/tier2.ts`:
- Signature (94-100) becomes `layoutElements(elements, domain, seedAnchors = {}, seedCurveSamples = {}, opts: { measure?: MeasureFn; seedDrawables?: Drawable[] } = {})`; `const measure = opts.measure ?? heuristicMeasure`.
- Add `issues: LintIssue[]` to `Tier2Result` (47-71) and to the return (249-260).
- Before pass 3 (line 149): `const { order: emitOrder, issues } = placementOrder(elements, new Set(Object.keys(seedAnchors)));` and iterate `emitOrder` instead of `elements`. (Pass 1 and pass 2 keep iterating `elements`.)
- Wrap each iteration of pass 3: record `const start = drawables.length;` before the `switch`; after it, if `el.at` is an object with `ref` (never for the `[x, y]` array form round 3 gives `angle`):
  ```ts
  const mine = drawables.slice(start);
  const refBox = unionBBoxForId([...(opts.seedDrawables ?? []), ...drawables.slice(0, start)], el.at.ref, measure);
  const ownBox = unionBBoxForId(mine, el.id, measure);
  if (refBox && ownBox) {
    const [dx, dy] = relativeDelta(ownBox, refBox, ctx.namedAnchors[el.at.ref] ?? {}, el.at, el.anchor);
    shiftDrawables(mine, dx, dy);
    if (ctx.anchors[el.id]) ctx.anchors[el.id] = [ctx.anchors[el.id][0] + dx, ctx.anchors[el.id][1] + dy];
    shiftPoints(ctx.namedAnchors[el.id], dx, dy);
    for (const k of ctx.pieceGroups[el.id] ?? []) { if (ctx.anchors[k]) ctx.anchors[k] = [ctx.anchors[k][0] + dx, ctx.anchors[k][1] + dy]; shiftPoints(ctx.namedAnchors[k], dx, dy); const pg = ctx.pieces[k]; if (pg) { pg.apex = [pg.apex[0] + dx, pg.apex[1] + dy]; pg.centroid = [pg.centroid[0] + dx, pg.centroid[1] + dy]; } }
  } else if (!refBox) {
    ctx.warnings.push(`element "${el.id}": at.ref "${el.at.ref}" has no box yet — left where it was`);
  }
  ```
  `unionBBoxForId` needs the ref's box for a `group` too: groups are handled in Task 4 (they register their box under `ctx.groupBoxes`); for now a ref to a group yields null and the warning.
- The `text` case (206-221): when `el.at?.ref` is set, use `pos = [0, 0]` instead of the canvas centre so the box is computed from origin (the shift does the rest). Same for `shape` (x/y default), `polygon`, `sector`, `arc`, `pieces`, `portrait`: when `el.at?.ref`, default centre `[0, 0]` (a private helper `originOr(el, fallback: Pt): Pt` returning `[0,0]` when `el.at?.ref` else `[el.x ?? fallback[0], el.y ?? fallback[1]]`).
- The `label` case (175-190): unchanged — labels attach through `ctx.anchors`, which the topological order now guarantees is set.

In `src/layout/layout.ts`:
- Call `layoutElements(spec.elements ?? [], spec.domain, seedAnchors, seedCurveSamples, { measure, seedDrawables: drawables })` (line ~99) — `drawables` at that point holds the template's output.
- Merge: `issues.push(...tier2.issues)` before the `lintLayout` call, and include them in the returned `issues` (line 156-158).

- [ ] **Step 8: Run the tests**

Run: `npx vitest run tests/placement-layout.test.ts tests/place.test.ts tests/tier2.test.ts tests/layout-spec.test.ts tests/examples.test.ts tests/anchors.test.ts`
Expected: PASS; examples unchanged (no bundled example uses `at.ref`).

- [ ] **Step 9: Commit**

```bash
git add src/layout/place.ts src/layout/tier2.ts src/layout/layout.ts src/lint/lint.ts tests/place.test.ts tests/placement-layout.test.ts
git commit -m "Relative placement: dependency order, post-emit shift, placement lint (freehand, Task 3)"
```

---

### Task 4: `group` — box, anchors, label attach, planner expansion, `group-empty` lint

**Files:**
- Modify: `src/layout/tier2.ts` (Ctx `groups`, `groupBoxes`; `group` case), `src/layout/layout.ts:98-123,156-158` (order, `groups` in result, lint expandId)
- Modify: `src/layout/boxes.ts` (group-aware `boxOfId`)
- Modify: `src/render/index.ts:98-103` (`expandGroup`), `src/render/plan.ts:230,330-345,809-828` (expandGroup, pivot)
- Test: `tests/group-layout.test.ts`, `tests/group-plan.test.ts`

**Interfaces:**
- Produces: `LayoutResult.groups: Record<string, string[]>` (group id → flattened leaf member ids, nested groups resolved); `Tier2Result.groups`; `PlanOptions.expandGroup?: (id: string) => string[] | null`; in tier2 `Ctx.groupBoxes: Record<string, BBox>`; `boxOfId(drawables, id, measure, groupBoxes)`.

- [ ] **Step 1: Write the failing layout test**

`tests/group-layout.test.ts`:
```ts
import { describe, expect, test } from "vitest";
import { layoutSpec, elementBBoxes } from "../src/layout/layout";

const thing = {
  elements: [
    { id: "body", type: "shape", shape: "rect", x: 300, y: 300, width: 60, height: 200 },
    { id: "cap", type: "shape", shape: "circle", radius: 20, at: { ref: "body", anchor: "top" }, anchor: "bottom" },
    { id: "pump", type: "group", members: ["body", "cap"] },
    { id: "name", type: "label", text: "Pump", attach_to: "pump", side: "right" },
    { id: "f", type: "text", text: "F", font_size: 24, at: { ref: "pump", side: "above", gap: 10 } },
  ],
  commands: [{ draw: ["pump", "name", "f"] }],
} as const;

describe("group", () => {
  test("has the union box of its members, is not in order, and expands", () => {
    const r = layoutSpec(thing as never);
    expect(r.order).not.toContain("pump");
    expect(r.groups.pump).toEqual(["body", "cap"]);
    const b = elementBBoxes(r);
    const body = b.get("body")!, cap = b.get("cap")!, f = b.get("f")!;
    expect(f.y).toBeCloseTo(cap.y + cap.h + 10, 0);
    expect(r.namedAnchors.pump.bottom[1]).toBeCloseTo(body.y, 0);
    expect(r.issues.filter((i) => i.rule === "placement" || i.rule === "group-empty")).toEqual([]);
  });
  test("nested groups flatten; missing member and empty group are errors", () => {
    const r = layoutSpec({
      elements: [
        { id: "a", type: "shape", shape: "rect", x: 100, y: 100 }, { id: "b", type: "shape", shape: "rect", x: 400, y: 100 },
        { id: "inner", type: "group", members: ["a"] }, { id: "outer", type: "group", members: ["inner", "b"] },
        { id: "bad", type: "group", members: ["ghost"] },
      ],
      commands: [{ draw: ["outer"] }],
    } as never);
    expect(r.groups.outer.sort()).toEqual(["a", "b"]);
    const bad = r.issues.filter((i) => i.rule === "group-empty");
    expect(bad.map((i) => i.severity)).toEqual(["error"]);
    expect(bad[0].message).toMatch(/"bad".*"ghost"/);
  });
});
```

- [ ] **Step 2: Run to see it fail**

Run: `npx vitest run tests/group-layout.test.ts`
Expected: FAIL (`groups` undefined).

- [ ] **Step 3: Implement the layout side**

`src/layout/boxes.ts` — add:
```ts
/** Box of an element id, or of a group (union of its flattened members). */
export function boxOfId(drawables: Drawable[], id: string, measure: MeasureFn, groups: Record<string, string[]> = {}): BBox | null {
  const members = groups[id];
  if (!members) return unionBBoxForId(drawables, id, measure);
  let out: BBox | null = null;
  for (const m of members) {
    const b = boxOfId(drawables, m, measure, groups);
    if (!b) continue;
    out = out ? { x: Math.min(out.x, b.x), y: Math.min(out.y, b.y), w: Math.max(out.x + out.w, b.x + b.w) - Math.min(out.x, b.x), h: Math.max(out.y + out.h, b.y + b.h) - Math.min(out.y, b.y) } : { ...b };
  }
  return out;
}
```
In tier2: `Ctx.groups: Record<string, string[]>` (flattened leaves) and `Ctx.groupBoxes: Record<string, BBox>`. Add `case "group":` in pass 3:
```ts
case "group": {
  const leaves: string[] = [];
  const missing: string[] = [];
  for (const m of el.members ?? []) {
    if (ctx.groups[m]) leaves.push(...ctx.groups[m]);
    else if (drawables.some((d) => d.id === m || d.id.startsWith(`${m}_`)) || (opts.seedDrawables ?? []).some((d) => d.id === m)) leaves.push(m);
    else missing.push(m);
  }
  if (missing.length > 0 || leaves.length === 0) issues.push({ rule: "group-empty", ids: [el.id], severity: "error", message: `group "${el.id}": ${missing.length ? `unknown members ${missing.map((m) => `"${m}"`).join(", ")}` : "no members"}` });
  ctx.groups[el.id] = leaves;
  const box = boxOfId([...(opts.seedDrawables ?? []), ...drawables], el.id, measure, ctx.groups);
  if (box) {
    ctx.groupBoxes[el.id] = box;
    ctx.anchors[el.id] = [box.x + box.w / 2, box.y + box.h / 2];
    ctx.namedAnchors[el.id] = Object.fromEntries(UNIVERSAL_ANCHORS.map((n) => [n, boxAnchor(box, n)]));
  }
  break;
}
```
Replace the two `unionBBoxForId(...)` calls in the Task 3 shift block with `boxOfId(..., ctx.groups)` so an `at.ref` to a group works. Return `groups: ctx.groups` in `Tier2Result`.

`src/layout/layout.ts`: skip `group` ids when building `order` (next to the `pieces` skip at 114); `groups = tier2.groups`; return `groups` in `LayoutResult` (add `groups: Record<string, string[]>` to the interface at 19-41); the lint call at 156 uses `(id) => pieceGroups[id] ?? groups[id]`.

- [ ] **Step 4: Run the layout test**

Run: `npx vitest run tests/group-layout.test.ts tests/examples.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing planner test**

`tests/group-plan.test.ts`:
```ts
import { describe, expect, test } from "vitest";
import { planCommands } from "../src/render/plan";

const bbox = { body: { x: 300, y: 300, w: 60, h: 200 }, cap: { x: 310, y: 500, w: 40, h: 40 } };

describe("group as a command target", () => {
  test("draw, highlight and move expand to the members", () => {
    const plan = planCommands(
      [{ draw: ["pump"] }, { highlight: { target: ["pump"], style: "pulse" } }, { move: { target: ["pump"], by: [10, 0] } }],
      ["body", "cap"],
      { expandGroup: (id) => (id === "pump" ? ["body", "cap"] : null), bboxOf: (id) => bbox[id as keyof typeof bbox] },
    );
    expect(plan.warnings).toEqual([]);
    expect(plan.steps[0]).toMatchObject({ kind: "draw", ids: ["body", "cap"] });
    expect(plan.states[2].visible).toEqual(expect.arrayContaining(["body", "cap"]));
  });
  test("rotate on a group turns about the union centre, not each member's own", () => {
    const plan = planCommands([{ draw: ["body", "cap"] }, { move: { target: ["pump"], rotate: 90 } }], ["body", "cap"], {
      expandGroup: (id) => (id === "pump" ? ["body", "cap"] : null), bboxOf: (id) => bbox[id as keyof typeof bbox],
    });
    const step = plan.steps[1] as { kind: string; pivots?: Record<string, [number, number]> };
    expect(step.kind).toBe("move");
    // union box: x 300..360, y 300..540 → centre (330, 420)
    expect(step.pivots?.body).toEqual([330, 420]);
    expect(step.pivots?.cap).toEqual([330, 420]);
  });
});
```
(Read `tests/plan.test.ts` and `src/render/plan.ts:700-830` first: adapt the field name if the move step stores pivots under another key — the assertion must read whatever `move` puts on the step per target. Do not weaken the test to "does not throw".)

- [ ] **Step 6: Run to see it fail**

Run: `npx vitest run tests/group-plan.test.ts`
Expected: FAIL — unknown id "pump" warnings.

- [ ] **Step 7: Implement the planner side**

`src/render/plan.ts`: add `expandGroup?: (id: string) => string[] | null;` to `PlanOptions` (line 230 area). In `resolveIds` (330-345) try `opts.expandId?.(id)` then `opts.expandGroup?.(id)`. In the `move` handler (around 709 and 809-828): compute `const groupTargets = new Set(requested.filter((id) => (opts.expandGroup?.(id)?.length ?? 0) > 1))` from the raw target list; when `cmd.move.pivot === undefined` and `groupTargets.size > 0`, the pivot for every resolved member of a group target is `poseCentre(unionBox(members.map(currentBox)), offset, turn)` computed once per group (same accumulated pose the per-element default uses). Members of a non-group target keep today's per-element centre.

`src/render/index.ts` `planOptionsFor` (98-103): add `expandGroup: (id) => layout.groups[id] ?? null`, and include `"expandGroup"` in its `Pick<…>` type.

- [ ] **Step 8: Run the tests**

Run: `npx vitest run tests/group-plan.test.ts tests/plan.test.ts tests/examples.test.ts`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/layout/boxes.ts src/layout/tier2.ts src/layout/layout.ts src/render/index.ts src/render/plan.ts tests/group-layout.test.ts tests/group-plan.test.ts
git commit -m "group: union box and anchors, label attach, planner expansion with a shared pivot (freehand, Task 4)"
```

---

### Task 5: `path.smooth` and fill

**Files:**
- Modify: `src/layout/tier2.ts:191-204` (path case)
- Test: `tests/path-smooth.test.ts`

**Interfaces:**
- Consumes: `catmullRom`, `catmullRomClosed` (Task 1), `filledOutline` (tier2.ts:1047).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, test } from "vitest";
import { layoutElements } from "../src/layout/tier2";
import { flattenDrawables } from "../src/layout/model";
import type { SpecElement } from "../src/spec/types";

const get = (ds: ReturnType<typeof flattenDrawables>, id: string) => ds.find((d) => d.id === id)!;

describe("path smooth + fill", () => {
  const pts: [number, number][] = [[100, 100], [200, 180], [300, 100], [400, 200]];
  test("smooth: many points through the waypoints; start/end anchors unchanged", () => {
    const r = layoutElements([{ id: "p", type: "path", points: pts, smooth: true }] as SpecElement[], undefined);
    const p = get(flattenDrawables(r.drawables), "p") as { pts: [number, number][] };
    expect(p.pts.length).toBe((pts.length - 1) * 8 + 1);
    expect(r.namedAnchors.p.start).toEqual([100, 100]);
    expect(r.namedAnchors.p.end).toEqual([400, 200]);
  });
  test("closed + smooth + fill: a wash area below the outline", () => {
    const r = layoutElements([{ id: "b", type: "path", points: [[0, 0], [100, 0], [100, 100], [0, 100]], closed: true, smooth: true, style: { fill: "#c00" } }] as SpecElement[], undefined);
    const ds = flattenDrawables(r.drawables);
    expect(get(ds, "b_wash")).toMatchObject({ kind: "area" });
    expect(get(ds, "b")).toMatchObject({ kind: "stroke", closed: true });
    expect((get(ds, "b") as { pts: unknown[] }).pts.length).toBe(16);
  });
  test("without smooth the polyline is untouched", () => {
    const r = layoutElements([{ id: "p", type: "path", points: pts }] as SpecElement[], undefined);
    expect((get(flattenDrawables(r.drawables), "p") as { pts: unknown[] }).pts).toEqual(pts);
  });
});
```

- [ ] **Step 2: Run to see it fail** — `npx vitest run tests/path-smooth.test.ts` → FAIL (4 points, no wash).

- [ ] **Step 3: Implement** — in the `path` case: `const raw = (el.points ?? []) as Pt[]; const pts = el.smooth ? (el.closed ? catmullRomClosed(raw) : catmullRom(raw)) : raw;` then, if `el.closed && el.style?.fill`, `drawables.push(...filledOutline(el.id, pts, el))` (which emits `<id>_wash` + the closed stroke), else the existing stroke push. Anchors: `ctx.namedAnchors[el.id] = polylineAnchors(raw, "path")` on the raw waypoints (so `point_k` still means the k-th authored point), and `ctx.anchors[el.id]` the raw mid point.

- [ ] **Step 4: Run** — `npx vitest run tests/path-smooth.test.ts tests/tier2.test.ts tests/examples.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/layout/tier2.ts tests/path-smooth.test.ts
git commit -m "path.smooth: Catmull-Rom through the waypoints, fill on closed paths (freehand, Task 5)"
```

---

### Task 6: `math` element, `label.tex`, engine loading for specs

**Files:**
- Create: `src/layout/math.ts`
- Modify: `src/layout/tier2.ts` (math case), `src/spec/schema.ts:839` (`normalizeSpec`: label.tex → math), `src/scenes/engines.ts:736` (`ensureEnginesForSpecs` scans elements), `src/render/index.ts:145` (load engines for the spec)
- Test: `tests/math-element.test.ts`

**Interfaces:**
- Produces: `mathDrawables(el: SpecElement, mathjax: MathJaxEngine): { drawables: Drawable[]; box: BBox }`; `enginesForSpec(spec: Spec): string[]`.
- Constants: `MATH_X_HEIGHT = 0.5` (x-height as a fraction of `size`), default `size = 28`.

- [ ] **Step 1: Write the failing test**

```ts
import { beforeAll, describe, expect, test } from "vitest";
import { ensureEngines, ensureEnginesForSpecs, enginesForSpec, getLoadedEngines } from "../src/scenes/engines";
import { layoutSpec, elementBBoxes } from "../src/layout/layout";
import { normalizeSpec } from "../src/spec/schema";
import { flattenDrawables } from "../src/layout/model";

describe("math element (real mathjax, node)", () => {
  beforeAll(async () => { await ensureEngines(["mathjax"]); });
  test("enginesForSpec asks for mathjax when a math element or a tex label is present", () => {
    expect(enginesForSpec({ elements: [{ id: "m", type: "math", tex: "x", x: 1, y: 1 }], commands: [] })).toEqual(["mathjax"]);
    expect(enginesForSpec({ elements: [{ id: "l", type: "label", tex: "y", attach_to: "a" }], commands: [] })).toEqual(["mathjax"]);
    expect(enginesForSpec({ elements: [{ id: "t", type: "text", text: "y", x: 1, y: 1 }], commands: [] })).toEqual([]);
  });
  test("draws precise areas, sized by size, placeable with at", () => {
    const r = layoutSpec({
      elements: [
        { id: "a", type: "shape", shape: "rect", x: 300, y: 300, width: 100, height: 40 },
        { id: "m", type: "math", tex: "F = m a", size: 32, at: { ref: "a", side: "above", gap: 12 } },
      ],
      commands: [{ draw: ["a", "m"] }],
    });
    const ds = flattenDrawables(r.drawables).filter((d) => d.id.startsWith("m__g"));
    expect(ds.length).toBeGreaterThan(3);
    expect(ds.every((d) => d.kind === "area" && (d as { precise?: boolean }).precise)).toBe(true);
    const b = elementBBoxes(r);
    expect(b.get("m")!.y).toBeCloseTo(b.get("a")!.y + 40 + 12, 0);
    expect(b.get("m")!.h).toBeGreaterThan(16); // "F" cap height ≈ 0.7 em > x-height 16
    expect(r.issues.filter((i) => i.severity === "error")).toEqual([]);
  });
  test("a label with tex normalizes to a math element placed by side", () => {
    const n = normalizeSpec({ elements: [{ id: "a", type: "shape", shape: "rect", x: 1, y: 1 }, { id: "l", type: "label", tex: "y = x^2", attach_to: "a", side: "right" }], commands: [] }) as { elements: { id: string; type: string; at?: unknown }[] };
    expect(n.elements[1]).toMatchObject({ id: "l", type: "math", tex: "y = x^2", at: { ref: "a", side: "right", gap: 8 } });
  });
  test("without the engine loaded the element warns instead of throwing", async () => {
    // simulate by asking for a spec whose engines are not loaded: use a fresh module-level guard in tier2 (enginesLoaded)
    const r = layoutSpec({ elements: [{ id: "m", type: "math", tex: "x", x: 100, y: 100 }], commands: [{ draw: ["m"] }] });
    expect(r.warnings.concat(r.issues.map((i) => i.message)).join(" ")).not.toMatch(/Error/);
  });
});
```

- [ ] **Step 2: Run to see it fail** — `npx vitest run tests/math-element.test.ts` → FAIL.

- [ ] **Step 3: Implement**

`src/layout/math.ts`:
```ts
import type { BBox } from "./geometry";
import { simplifyPolyline } from "./geometry";
import { Z_AREA, SKETCH_MS, type Drawable, type Pt } from "./model";
import { resolveDrawOpts, resolveStyle } from "./resolve";
import type { MathJaxEngine } from "../scenes/engines";
import type { SpecElement } from "../spec/types";

export const MATH_X_HEIGHT = 0.5;
export const MATH_DEFAULT_SIZE = 28;

/** TeX → precise filled outlines (with holes), scaled so the x-height is
 *  MATH_X_HEIGHT × size, centred on (cx, cy). The same construction as
 *  equation_steps in mathlogic.yaml. */
export function mathDrawables(el: SpecElement, mathjax: MathJaxEngine, cx: number, cy: number): { drawables: Drawable[]; box: BBox } {
  const size = el.size ?? el.font_size ?? MATH_DEFAULT_SIZE;
  const laid = mathjax.layoutTeX(el.tex ?? "", { display: false });
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const o of laid.outlines) for (const [x, y] of o.pts) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
  const s = size * MATH_X_HEIGHT; // laid.h is normalised so an x-height row is 1
  const w = (maxX - minX) * s, h = (maxY - minY) * s;
  const tx = (x: number) => cx - w / 2 + (x - minX) * s;
  const ty = (y: number) => cy - h / 2 + (y - minY) * s;
  const place = (ring: [number, number][]): Pt[] => simplifyPolyline(ring.map(([x, y]) => [tx(x), ty(y)] as Pt), 0.35);
  const ink = resolveStyle(el.style);
  const drawables: Drawable[] = laid.outlines.map((o, j) => ({
    id: `${el.id}__g${j}`, kind: "area", pts: place(o.pts), holes: o.holes?.map(place), precise: true, z: Z_AREA + 1,
    style: resolveStyle(el.style, { fill: ink.color, opacity: 1 }),
    drawOpts: resolveDrawOpts(el.draw, { mode: "sketch", duration: SKETCH_MS.text }),
  }));
  return { drawables: [{ id: el.id, kind: "group", children: drawables, z: Z_AREA + 1, style: ink, drawOpts: resolveDrawOpts(el.draw) }], box: { x: cx - w / 2, y: cy - h / 2, w, h } };
}
```
Note: `resolveStyle`/`resolveDrawOpts` live in `src/layout/resolve.ts` (exported); math.ts imports them from there and never imports tier2.ts. Check `laid.outlines[].pts` orientation against `mathlogic.yaml:1060-1095` (the y flip is already applied by the engine's lite adaptor path there; mirror exactly what `place` does at 1085-1090, including whether y is negated).

tier2 `case "math"`: if `!enginesLoaded(["mathjax"])` → `ctx.warnings.push(`math "${el.id}": mathjax engine not loaded — skipped`)` and break; else `const { drawables: ds, box } = mathDrawables(el, getLoadedEngines(["mathjax"]).mathjax as MathJaxEngine, ...originOr(el, [CANVAS.w/2, CANVAS.h/2]))`, push, `ctx.anchors[el.id] = [box.x + box.w/2, box.y + box.h/2]`, `ctx.namedAnchors[el.id]` = the nine box anchors. `unionBBoxForId` already unions `<id>` groups (group children carry `__g` ids — verify `unionBBoxForId` looks through group drawables; if it only reads top-level ids, extend it to recurse into `kind: "group"` children whose group id matches).

`normalizeSpec` (schema.ts:839): map every `label` with a string `tex` to `{ ...el, type: "math", at: { ref: el.attach_to, side: el.side ?? "above-right", gap: 8 }, attach_to: undefined, side: undefined, text: undefined }` (keep `id`, `style`, `draw`, `font_size` → `size`). Do this before validation so `elementErrors` sees a `math` element.

`engines.ts`: add `export function enginesForSpec(spec: { template?: string; elements?: { type?: string; tex?: unknown }[] }): string[]` = template's manifest engines ∪ `["mathjax"]` when any element is `math` or has a string `tex`; make `ensureEnginesForSpecs` use it. `render/index.ts`: after `ensureFonts()` (145) add `await ensureEnginesForSpecs([spec]);` (idempotent; a no-op when nothing is needed). `src/llm/compile.ts:391` already ensures engines before lint — route it through `enginesForSpec` too so a freehand math spec lints with the engine present.

- [ ] **Step 4: Run** — `npx vitest run tests/math-element.test.ts tests/mathjax.test.ts tests/examples.test.ts tests/render-resolve.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/layout/math.ts src/layout/tier2.ts src/spec/schema.ts src/scenes/engines.ts src/render/index.ts src/llm/compile.ts tests/math-element.test.ts
git commit -m "math element: TeX as handwriting via the mathjax engine; label.tex; engines follow the spec (freehand, Task 6)"
```

---

### Task 7: `image` element — Commons resolution, credit caption, credits in export and player

**Files:**
- Create: `src/render/image.ts`, `src/export/credits.ts`
- Modify: `src/render/resolve.ts:17-25,32` (deps + resolver), `src/render/index.ts:159` (pass `resolveImages`), `src/layout/tier2.ts` (image case), `src/ui/share.ts:796,1188` (credits file), `src/ui/controls.ts:565-580,864-892` (credits slot)
- Test: `tests/image-resolve.test.ts`, `tests/image-layout.test.ts`, `tests/credits.test.ts`

**Interfaces:**
- Produces: `resolveImages(spec: Spec, deps?: ImageDeps): Promise<ImageResolution[]>` where `ImageDeps = { fetch: typeof fetch; loadRaster: typeof loadRaster }`; `commonsSearchUrl(q: string): string`; `commonsFileInfoUrl(fileTitle: string): string`; `creditFromInfo(info: unknown): { credit: string; licence: string } | null`; `creditsOf(specs: Spec[]): string[]`; `foldedControls(narrow, hasMute, hasCC, hasCredits = false)` with `SecondarySlot` gaining `"credits"`.

- [ ] **Step 1: Write the failing resolver test**

`tests/image-resolve.test.ts`:
```ts
import { describe, expect, test } from "vitest";
import { commonsFileInfoUrl, commonsSearchUrl, creditFromInfo, resolveImages } from "../src/render/image";
import { decodePhoto } from "../src/spec/trace";
import { wikiSummaryUrl } from "../src/render/portrait";

const info = (license: string | null, artist = "<a href='x'>Jane Doe</a>") => ({
  query: { pages: { "1": { title: "File:Bicycle pump.jpg", imageinfo: [{ thumburl: "https://upload.wikimedia.org/x.jpg", extmetadata: { ...(license ? { LicenseShortName: { value: license } } : {}), Artist: { value: artist } } }] } } },
});
const raster = async () => ({ width: 4, height: 2, data: new Uint8ClampedArray(4 * 2 * 4) });
const deps = (routes: Record<string, unknown>) => ({
  fetch: (async (url: string) => ({ ok: url in routes, status: url in routes ? 200 : 404, json: async () => routes[url] })) as unknown as typeof fetch,
  loadRaster: raster as never,
});

describe("resolveImages", () => {
  test("wikipedia summary hit → file info → credit and embedded photo", async () => {
    const spec = { elements: [{ id: "p", type: "image", of: "Bicycle pump", width: 200, x: 1, y: 1 }], commands: [] };
    const r = await resolveImages(spec as never, deps({
      [wikiSummaryUrl("Bicycle pump")]: { originalimage: { source: "https://upload.wikimedia.org/wikipedia/commons/a/ab/Bicycle_pump.jpg" } },
      [commonsFileInfoUrl("File:Bicycle_pump.jpg")]: info("CC BY-SA 4.0"),
    }));
    expect(r).toEqual([{ id: "p", ok: true }]);
    const el = (spec.elements[0] as { strokes?: string; credit?: string });
    expect(decodePhoto(el.strokes!)?.aspect).toBeCloseTo(0.5);
    expect(el.credit).toBe("Jane Doe · CC BY-SA 4.0");
  });
  test("summary miss falls back to a Commons search", async () => {
    const spec = { elements: [{ id: "p", type: "image", of: "Hand pump", x: 1, y: 1 }], commands: [] };
    const r = await resolveImages(spec as never, deps({ [commonsSearchUrl("Hand pump")]: info("CC0") }));
    expect(r[0].ok).toBe(true);
    expect((spec.elements[0] as { credit?: string }).credit).toBe("Jane Doe · CC0");
  });
  test("no licence → rejected, nothing embedded, error names the reason", async () => {
    const spec = { elements: [{ id: "p", type: "image", of: "Thing", x: 1, y: 1 }], commands: [] };
    const r = await resolveImages(spec as never, deps({ [commonsSearchUrl("Thing")]: info(null) }));
    expect(r[0]).toMatchObject({ id: "p", ok: false, error: expect.stringMatching(/licence/) });
    expect((spec.elements[0] as { strokes?: string }).strokes).toBeUndefined();
  });
  test("creditFromInfo strips HTML from the artist", () => {
    expect(creditFromInfo(info("CC BY 4.0", "<b>A &amp; B</b>"))).toEqual({ credit: "A & B · CC BY 4.0", licence: "CC BY 4.0" });
    expect(creditFromInfo(info(null))).toBeNull();
  });
});
```

- [ ] **Step 2: Run to see it fail** — `npx vitest run tests/image-resolve.test.ts` → FAIL.

- [ ] **Step 3: Implement `src/render/image.ts`**

Model it on `resolvePortraits` (portrait.ts:170-205): skip when `el.type !== "image"` or `el.strokes` decodes; cache key `` `i1|${el.of.trim().toLowerCase()}` `` via `cacheGet`/`cachePut` (portrait.ts:51,63) storing `JSON.stringify({ strokes, credit })`; resolution:
1. `fetch(wikiSummaryUrl(of))` → `originalimage.source` (or `thumbnail.source`); derive the file title from the URL's last path segment (decodeURIComponent, prefix `File:`); `fetch(commonsFileInfoUrl(title))`.
2. Else `fetch(commonsSearchUrl(of))`.
3. `creditFromInfo(json)`: first page's `imageinfo[0]`; `LicenseShortName.value` required (else null); artist = `Artist.value` with tags stripped (`replace(/<[^>]+>/g, "")`, HTML entities `&amp; &lt; &gt; &quot;` decoded, trimmed); `credit = `${artist || "Wikimedia Commons"} · ${licence}``.
4. Photo: `loadRaster(thumburl, LOOK_DIM.photo)` → `encodePhoto(h/w, styledPhotoDataUri(raster))` (portrait.ts:93,128; `encodePhoto` trace.ts:67).
5. Set `el.strokes`, `el.credit`, `el.source = thumburl`.

URLs:
```ts
export const commonsSearchUrl = (q: string) => `https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(q)}&gsrnamespace=6&gsrlimit=1&prop=imageinfo&iiprop=url|extmetadata&iiurlwidth=480&format=json&origin=*`;
export const commonsFileInfoUrl = (title: string) => `https://commons.wikimedia.org/w/api.php?action=query&titles=${encodeURIComponent(title)}&prop=imageinfo&iiprop=url|extmetadata&iiurlwidth=480&format=json&origin=*`;
```
`ImageDeps` defaults to `{ fetch: globalThis.fetch, loadRaster }`. Never throw; collect `{ id, ok, error }`.

`src/render/resolve.ts`: add `resolveImages` to `RenderResolveDeps` and to the `Promise.all`; `src/render/index.ts:159` passes it. Update `tests/render-resolve.test.ts` fakes to include `resolveImages: async () => []`.

- [ ] **Step 4: Run** — `npx vitest run tests/image-resolve.test.ts tests/render-resolve.test.ts` → PASS.

- [ ] **Step 5: Write the failing layout + credits tests**

`tests/image-layout.test.ts`:
```ts
import { describe, expect, test } from "vitest";
import { layoutSpec, elementBBoxes } from "../src/layout/layout";
import { flattenDrawables } from "../src/layout/model";
import { encodePhoto } from "../src/spec/trace";

const strokes = encodePhoto(0.5, "data:image/jpeg;base64,AAAA");

describe("image element layout", () => {
  test("photo with credit caption below, sized by width, placeable with at", () => {
    const r = layoutSpec({
      elements: [
        { id: "a", type: "shape", shape: "rect", x: 300, y: 300, width: 100, height: 40 },
        { id: "p", type: "image", of: "Bicycle pump", width: 200, strokes, credit: "Jane Doe · CC0", at: { ref: "a", side: "right", gap: 30 } },
      ],
      commands: [{ draw: ["a", "p"] }],
    });
    const ds = flattenDrawables(r.drawables);
    const img = ds.find((d) => d.id === "p__img") as { kind: string; w: number; h: number; reveal?: string };
    expect(img).toMatchObject({ kind: "image", w: 200, h: 100, reveal: "fade" });
    const cap = ds.find((d) => d.id === "p__name") as { kind: string; text: string; fontSize: number };
    expect(cap).toMatchObject({ kind: "text", text: "Jane Doe · CC0", fontSize: 14 });
    expect(elementBBoxes(r).get("p")!.x).toBeCloseTo(300 + 100 + 30, 0);
  });
  test("unresolved image draws nothing and warns", () => {
    const r = layoutSpec({ elements: [{ id: "p", type: "image", of: "Nothing", x: 100, y: 100 }], commands: [{ draw: ["p"] }] });
    expect(flattenDrawables(r.drawables).filter((d) => d.id.startsWith("p"))).toEqual([]);
    expect(r.warnings.join(" ")).toMatch(/no image found for "Nothing"/);
  });
});
```
`tests/credits.test.ts`:
```ts
import { describe, expect, test } from "vitest";
import { creditsOf } from "../src/export/credits";
import { foldedControls } from "../src/ui/controls";

describe("credits", () => {
  test("collects image and icon credits once each, in element order", () => {
    expect(creditsOf([{ elements: [{ id: "a", type: "image", of: "x", credit: "A · CC0" }, { id: "b", type: "icon", of: "y", credit: "lucide · ISC" }, { id: "c", type: "image", of: "x", credit: "A · CC0" }], commands: [] }] as never)).toEqual(["A · CC0", "lucide · ISC"]);
  });
  test("credits slot is folded only when there are credits", () => {
    expect(foldedControls(false, true, true).folded).not.toContain("credits");
    expect(foldedControls(false, true, true, true).folded).toContain("credits");
    expect(foldedControls(false, true, true, true).inline).not.toContain("credits");
  });
});
```

- [ ] **Step 6: Run to see them fail** — `npx vitest run tests/image-layout.test.ts tests/credits.test.ts` → FAIL.

- [ ] **Step 7: Implement layout, credits, share and controls**

tier2 `case "image"`: `const photo = el.strokes ? decodePhoto(el.strokes) : null; if (!photo) { ctx.warnings.push(`no image found for "${el.of ?? el.id}"`); break; }` then build a `GroupDrawable` `el.id` with children `${id}__img` (as portraitDrawable's 652-668: `w = el.width ?? 220`, `h = w * photo.aspect`, `reveal: el.reveal ?? "fade"`, pos = `originOr(el, [500, 375])`) and, when `el.credit`, `${id}__name` text `fontSize 14`, `pos: [cx, cy - h/2 - 14]`, `anchor: "middle"`. Anchors: centre + nine box anchors.

`src/export/credits.ts`: `export function creditsOf(specs: Spec[]): string[]` — unique, in order, over elements of type image/icon with a string `credit`. `share.ts`: after each `downloadBlob(`${base}.vtt`, …)` (796 and 1188), if `creditsOf(items).length > 0` also `downloadBlob(`${base}.credits.txt`, new Blob([creditsOf(items).join("\n") + "\n"], { type: "text/plain" }))`.

`controls.ts`: `SecondarySlot` gains `"credits"`; `foldedControls(narrow, hasMute, hasCC, hasCredits = false)` appends `"credits"` to `folded` (never `inline`) when `hasCredits`; in `attachPlayerControls` build the slot as a `div.menu-item` listing `creditsOf([hd.spec])` lines (one `<div>` each, `class: "credit-line"`); `layout()` (864-892) treats it like the other slots. Add `.credit-line { font-size: 12px; opacity: .8 }` to `src/styles.css` next to the existing Wikipedia credit rule (1874).

- [ ] **Step 8: Run** — `npx vitest run tests/image-layout.test.ts tests/credits.test.ts tests/fold-policy.test.ts tests/examples.test.ts` → PASS.

- [ ] **Step 9: Commit**

```bash
git add src/render/image.ts src/render/resolve.ts src/render/index.ts src/layout/tier2.ts src/export/credits.ts src/ui/share.ts src/ui/controls.ts src/styles.css tests/image-resolve.test.ts tests/image-layout.test.ts tests/credits.test.ts tests/render-resolve.test.ts
git commit -m "image element: Commons photo with licence-gated credit, credits file and player menu (freehand, Task 7)"
```

---

### Task 8: `group.fit` — scale and centre members into a region; lint follow-ups

**Files:**
- Modify: `src/layout/place.ts` (add `fitTransform`, `scaleDrawables`), `src/layout/tier2.ts` (group case applies fit), `src/lint/lint.ts:238-244,306-360` (`sameGroup` skip), `src/layout/layout.ts:156` (pass it)
- Test: `tests/group-fit.test.ts`

**Interfaces:**
- Produces: `fitTransform(union: BBox, target: BBox): { s: number; dx: number; dy: number }` (uniform scale about the origin then translate: `p' = p*s + [dx, dy]`); `scaleDrawables(ds: Drawable[], s: number, dx: number, dy: number): void` (pts/pos/holes/shapeHint/fontSize/image w,h); `lintLayoutDetailed(drawables, measure, commands?, expandId?, sameGroup?: (a: string, b: string) => boolean)`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, test } from "vitest";
import { layoutSpec, elementBBoxes } from "../src/layout/layout";
import { fitRegion } from "../src/layout/regions";
import { flattenDrawables } from "../src/layout/model";

const pump = (fit: unknown) => ({
  elements: [
    { id: "body", type: "shape", shape: "rect", x: 0, y: 0, width: 60, height: 200 },
    { id: "cap", type: "shape", shape: "circle", radius: 20, at: { ref: "body", anchor: "top" }, anchor: "bottom" },
    { id: "t", type: "text", text: "cap", font_size: 24, at: { ref: "cap", side: "above", gap: 4 } },
    { id: "pump", type: "group", members: ["body", "cap", "t"], fit },
  ],
  commands: [{ draw: ["pump"] }],
});

describe("group.fit", () => {
  test("members are scaled uniformly and centred in the left region", () => {
    const r = layoutSpec(pump("left") as never);
    const b = elementBBoxes(r);
    const L = fitRegion("left");
    const g = [b.get("body")!, b.get("cap")!, b.get("t")!];
    const x0 = Math.min(...g.map((q) => q.x)), x1 = Math.max(...g.map((q) => q.x + q.w));
    const y0 = Math.min(...g.map((q) => q.y)), y1 = Math.max(...g.map((q) => q.y + q.h));
    expect(y1 - y0).toBeCloseTo(L.h, 0);                 // height-limited
    expect((x0 + x1) / 2).toBeCloseTo(L.x + L.w / 2, 0);   // centred
    expect(b.get("body")!.w / b.get("body")!.h).toBeCloseTo(60 / 200, 2); // aspect kept
    const t = flattenDrawables(r.drawables).find((d) => d.id === "t") as { fontSize: number };
    expect(t.fontSize).toBeGreaterThan(24); // scaled up with the figure
  });
  test("a box fit that shrinks text below 18 warns naming the group", () => {
    const r = layoutSpec(pump({ x: 100, y: 100, w: 40, h: 60 }) as never);
    expect(r.issues.some((i) => i.rule === "font-too-small" && /fit box too small.*"pump"/.test(i.message))).toBe(true);
  });
  test("overlap between two members of a fitted group is not reported", () => {
    const r = layoutSpec({
      elements: [
        { id: "a", type: "shape", shape: "rect", x: 0, y: 0, width: 100, height: 100 },
        { id: "b", type: "shape", shape: "rect", x: 20, y: 20, width: 100, height: 100 },
        { id: "g", type: "group", members: ["a", "b"], fit: "right" },
      ],
      commands: [{ draw: ["g"] }],
    } as never);
    expect(r.issues.filter((i) => i.rule.startsWith("overlap"))).toEqual([]);
  });
  test("at.ref across a fit boundary is a placement error", () => {
    const r = layoutSpec({
      elements: [
        { id: "o", type: "shape", shape: "rect", x: 600, y: 600 },
        { id: "a", type: "shape", shape: "rect", x: 0, y: 0 },
        { id: "b", type: "text", text: "x", at: { ref: "o", side: "above" } },
        { id: "g", type: "group", members: ["a", "b"], fit: "left" },
      ],
      commands: [{ draw: ["o", "g"] }],
    } as never);
    expect(r.issues.some((i) => i.rule === "placement" && /"b".*outside its fit group "g"/.test(i.message))).toBe(true);
  });
});
```

- [ ] **Step 2: Run to see it fail** — `npx vitest run tests/group-fit.test.ts` → FAIL.

- [ ] **Step 3: Implement**

`place.ts`:
```ts
export function fitTransform(union: BBox, target: BBox): { s: number; dx: number; dy: number } {
  const s = Math.min(target.w / union.w, target.h / union.h);
  const cx = target.x + target.w / 2, cy = target.y + target.h / 2;
  const ux = union.x + union.w / 2, uy = union.y + union.h / 2;
  return { s, dx: cx - ux * s, dy: cy - uy * s };
}
export function scaleDrawables(ds: Drawable[], s: number, dx: number, dy: number): void {
  const m = ([x, y]: Pt): Pt => [x * s + dx, y * s + dy];
  for (const d of ds) {
    if (d.kind === "group") { scaleDrawables(d.children, s, dx, dy); continue; }
    if (d.kind === "text") { d.pos = m(d.pos); d.fontSize = d.fontSize * s; continue; }
    if (d.kind === "image") { d.pos = m(d.pos); d.w *= s; d.h *= s; continue; }
    d.pts = d.pts.map(m);
    if (d.kind === "area" && d.holes) d.holes = d.holes.map((h) => h.map(m));
    if (d.kind === "stroke" && d.shapeHint) d.shapeHint = d.shapeHint.type === "circle" ? { type: "circle", c: m(d.shapeHint.c), r: d.shapeHint.r * s } : { type: "rect", x: d.shapeHint.x * s + dx, y: d.shapeHint.y * s + dy, w: d.shapeHint.w * s, h: d.shapeHint.h * s };
  }
}
```
tier2 group case: after computing `box`, if `el.fit`: `target = isFitName(el.fit) ? fitRegion(el.fit) : el.fit`; `{s, dx, dy} = fitTransform(box, target)`; apply `scaleDrawables` to every drawable whose id belongs to a leaf member (`d.id === m || d.id.startsWith(`${m}_`)`), apply the same map to `ctx.anchors`, `ctx.namedAnchors`, `ctx.pieces` of the members, recompute `box`/`groupBoxes`/anchors; record `ctx.fitGroups[el.id] = leaves` (new Ctx field, returned as `Tier2Result.fitGroups`). After scaling, any text member with `fontSize < 18` → `issues.push({ rule: "font-too-small", ids: [el.id], severity: "warn", message: `fit box too small for the text in group "${el.id}" (${id} at ${Math.round(fontSize)})` })`. Fit boundary check (in `placementOrder`, which now also receives `groups` with `fit`): an element that is a leaf of fit group G with `at.ref` not a leaf of G → `placement` error `element "<id>": at.ref "<ref>" is outside its fit group "<G>"`.

lint: add the optional `sameGroup` parameter; in `overlap-label-label` and `overlap-label-stroke` skip a pair when `sameGroup(ownerA, ownerB)`. layout.ts passes `(a, b) => Object.values(fitGroups).some((ls) => ls.includes(a) && ls.includes(b))`.

- [ ] **Step 4: Run** — `npx vitest run tests/group-fit.test.ts tests/group-layout.test.ts tests/lint.test.ts tests/examples.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/layout/place.ts src/layout/tier2.ts src/layout/layout.ts src/lint/lint.ts tests/group-fit.test.ts
git commit -m "group.fit: scale and centre a thing into a region; same-group overlap exempt (freehand, Task 8)"
```

---

### Task 9: On-demand trigger — freehand first

**Files:**
- Modify: `src/main.ts:3180-3196`
- Modify: `src/llm/multi.ts:62-125`
- Test: extend the existing tests that cover `authorTemplatesForParts` (`grep -l "templatesOnDemand\|onDemandRun" tests/*.test.ts` — `tests/course-parallel.test.ts` and the `tests/on-demand*.test.ts` files) and add `tests/on-demand-shared-subject.test.ts`

**Interfaces:**
- Produces in `multi.ts`: `export function sharedBriefIds(briefs: (TemplateBrief | null)[]): Set<string>` (ids seen ≥ 2 times); the loop authors only parts whose brief id is in that set.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, test } from "vitest";
import { sharedBriefIds } from "../src/llm/multi";

describe("sharedBriefIds", () => {
  test("only ids two or more freehand parts agree on", () => {
    expect([...sharedBriefIds([{ id: "sewing_machine", description: "x" }, null, { id: "sewing_machine", description: "y" }, { id: "violin", description: "z" }])]).toEqual(["sewing_machine"]);
    expect(sharedBriefIds([{ id: "a", description: "" }, { id: "b", description: "" }]).size).toBe(0);
  });
});
```
Then, in the existing course test that today asserts a template is authored for a single templateWorthy part, add a sibling case: two parts with `templateWorthy` specs and a stubbed `describeTemplateFor` returning the same id → `authorOnDemand` called once; different ids → never called. (Read the existing test's stubbing seams — `cfg.route`, `generate` injection — and use them; do not stub `fetch`.)

- [ ] **Step 2: Run to see it fail** — `npx vitest run tests/on-demand-shared-subject.test.ts` → FAIL.

- [ ] **Step 3: Implement**

`multi.ts`: before the loop, collect `const worthy = outcomes.map((o, i) => o.spec && templateWorthy(o.spec) ? i : -1).filter((i) => i >= 0)`; if `worthy.length < 2` return (a single freehand part stays freehand — spec §5.5). Call `describeTemplateFor(buildPartRequest(...), outcomes[i].spec, { apiKey, model, signal })` for each (in parallel, `Promise.all`, errors → null) and compute `shared = sharedBriefIds(briefs)`; in the loop replace `if (!o.spec || !templateWorthy(o.spec)) continue;` with `if (!o.spec || !briefs[i] || !shared.has(briefs[i].id)) continue;`. Pass the brief into `authorOnDemand` if its config accepts one (`OnDemandConfig`, on-demand.ts:130-143 — if it does not, leave the second brief call in place; it is cached by the same model and cheap). `hooks.onPhase?.(`${label}: shares a subject with another part — authoring`)`.

`main.ts:3180-3196`: delete the `if (settings.templatesOnDemand)` branch; always `setStatusAction("Drawn freehand.", "Author a template and redraw (~4 min)", …)` when `templateWorthy(outcome.spec)`. Keep `authorNext` for the explicit button path only. Update the Settings note for `templatesOnDemand` (store.ts / main.ts settings tab) to say it applies to course runs.

- [ ] **Step 4: Run** — `npx vitest run tests/on-demand-shared-subject.test.ts tests/course-parallel.test.ts tests/on-demand*.test.ts tests/generate-loop.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main.ts src/llm/multi.ts tests/on-demand-shared-subject.test.ts tests/course-parallel.test.ts
git commit -m "Freehand first: single figures offer a template, courses author only for a shared subject (freehand, Task 9)"
```

---

### Task 10: Prompt — freehand section, conditional code block, size budget

**Files:**
- Create: `src/llm/prompts/compiler-v1-code.md`
- Modify: `src/llm/prompts/compiler-v1.md:14-15,48-49`, `src/llm/prompt.ts:7-12,25-35,59,85`, `src/llm/compile.ts:301-309`
- Test: `tests/prompt-size.test.ts`, extend `tests/prompt.test.ts`

**Interfaces:**
- Produces: `PromptParts.code?: string` (the code bullet text, or `""`); placeholder `{{CODE}}` (optional — `missingPlaceholders` does not require it); `wantsCode(request: string, tags: string[]): boolean` in `src/llm/prompt.ts`; `CODE_PROMPT_SOURCE` exported from `src/llm/compile.ts` (the `.md?raw` import, same pattern as the compiler prompt).

- [ ] **Step 1: Measure the baseline and pin it**

Run this once BEFORE editing the prompt and paste the two numbers into the test below:
```bash
node --input-type=module -e "
const { createServer } = await import('vite');
const s = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'warn' });
globalThis.localStorage = { getItem(){return null}, setItem(){}, removeItem(){}, key(){return null}, length: 0, clear(){} };
const { apiSchema, fewshotsText, promptVariants } = await s.ssrLoadModule('/src/llm/compile.ts');
const { catalogParts } = await s.ssrLoadModule('/src/scenes/catalog.ts');
const { buildSystemPrompt } = await s.ssrLoadModule('/src/llm/prompt.ts');
const v = promptVariants()[0].source;
const sys = buildSystemPrompt(v, { schema: apiSchema(), catalog: catalogParts({}).stable, fewshots: fewshotsText(), exemplars: '' });
console.log('SYSTEM_CHARS', sys.length, 'SCHEMA_CHARS', JSON.stringify(apiSchema(), null, 2).length);
await s.close();"
```
Record both numbers in the ledger (Task 15) as the baseline.

`tests/prompt-size.test.ts`:
```ts
import { describe, expect, test } from "vitest";
import { apiSchema, fewshotsText, promptVariants, CODE_PROMPT_SOURCE } from "../src/llm/compile";
import { catalogParts } from "../src/scenes/catalog";
import { buildSystemPrompt, wantsCode } from "../src/llm/prompt";

const BASELINE_SYSTEM_CHARS = 0; // ← paste SYSTEM_CHARS from step 1
const BASELINE_SCHEMA_CHARS = 0; // ← paste SCHEMA_CHARS from step 1

const system = (code: boolean) => buildSystemPrompt(promptVariants()[0].source, { schema: apiSchema(), catalog: catalogParts({}).stable, fewshots: fewshotsText(), exemplars: "", code: code ? CODE_PROMPT_SOURCE : "" });

describe("prompt budget (spec §6.3)", () => {
  test("schema grew by at most 5,500 chars", () => {
    expect(JSON.stringify(apiSchema(), null, 2).length).toBeLessThanOrEqual(BASELINE_SCHEMA_CHARS + 5_500);
  });
  test("a non-code request gets a system prompt smaller than today's", () => {
    expect(system(false).length).toBeLessThan(BASELINE_SYSTEM_CHARS);
  });
  test("the code block is only sent when asked for, and is the 12k bullet", () => {
    expect(system(true).length - system(false).length).toBeGreaterThan(10_000);
    expect(system(false)).not.toContain("**code** runs a real script");
    expect(system(true)).toContain("**code** runs a real script");
  });
  test("wantsCode", () => {
    expect(wantsCode("Explain a demand curve", [])).toBe(false);
    expect(wantsCode("Simulate 500 coin flips in Python", [])).toBe(true);
    expect(wantsCode("Show the C64 booting", [])).toBe(true);
    expect(wantsCode("anything", ["code"])).toBe(true);
  });
});
```

- [ ] **Step 2: Run to see it fail** — `npx vitest run tests/prompt-size.test.ts` → FAIL (no `CODE_PROMPT_SOURCE`, no `code` part).

- [ ] **Step 3: Implement the conditional block**

- Move lines 48-49 of `compiler-v1.md` (the `code` and "Data from code" bullets) verbatim into `src/llm/prompts/compiler-v1-code.md`; leave `{{CODE}}` on line 48.
- `prompt.ts`: `PromptParts.code?: string`; `fill` adds `.replaceAll("{{CODE}}", parts.code ?? "")`; `PROMPT_PLACEHOLDERS` lists `{{CODE}}` as optional; `missingPlaceholders` ignores it. Export
  ```ts
  const CODE_WORDS = /\b(code|script|python|pandas|numpy|matplotlib|plotly|simulat\w*|tidyverse|ggplot|brython|micropython|microdata|c64|commodore|basic)\b|\bR\b/i;
  export function wantsCode(request: string, tags: string[]): boolean {
    return tags.some((t) => /^(code|python|r|microdata|c64|basic)$/i.test(t)) || CODE_WORDS.test(request);
  }
  ```
- `compile.ts`: `export const CODE_PROMPT_SOURCE = codeMd` (import `./prompts/compiler-v1-code.md?raw`); in `generateSpec` (301-309) pass `code: wantsCode(request, tagsOf(cfg.brief ?? "")) ? CODE_PROMPT_SOURCE : ""` — `tagsOf` = the tag ids already parsed in main.ts; if compile.ts has no access to them, add `GenerateConfig.tags?: string[]` and set it at main.ts:3124 from `parsed.tags`.
- `cancel/course-parallel/effort/generate-loop/improve/latency` tests keep working: `{{CODE}}` is optional.

- [ ] **Step 4: Write the freehand section**

Replace lines 14-15 of `compiler-v1.md` with a `## Freehand figures` section (≤ 25 lines, ≤ 3,700 chars) containing, in this order: (1) build a THING as a `group` of named parts, one absolute part then the rest with `at` (`{ref, side, gap}` outside, `{ref, anchor}` on a point, own `anchor` for the landing side); (2) list the parts and how they sit BEFORE writing elements; (3) `fit: "left"|"right"|"top"|"bottom"|"full"` gives the thing its place — never compute coordinates per element; (4) smooth closed `path` for organic shapes, `polygon`/`shape` for mechanical ones, `pieces` for things cut in parts; (5) `math` for formulas beside curves, `label.tex` for a curve's equation; (6) at most one `image` per figure, an illustration never a substitute; (7) `icon` as a STAMP when the figure only shows what a thing is, the seed (given in the request as ready `path` elements in a group) when it must EXPLAIN the parts — keep, edit, extend or drop them; (8) tier-3 raw `text`/`shape`/`path` only for table cells and similar; font ≥ 18; canvas centre (500, 375); (9) anti-patterns by name: coordinates computed per element, `text` without `attach_to` where a `label` fits, more than one image, a formula typed as `text`, an icon used as the whole figure. Add matching `expect(compilerV1).toContain(...)` pins in `tests/prompt.test.ts` for phrases (2), (7) and the anti-pattern line.

- [ ] **Step 5: Run** — `npx vitest run tests/prompt-size.test.ts tests/prompt.test.ts tests/latency.test.ts tests/generate-loop.test.ts` → PASS (paste the baselines first).

- [ ] **Step 6: Commit**

```bash
git add src/llm/prompts/compiler-v1.md src/llm/prompts/compiler-v1-code.md src/llm/prompt.ts src/llm/compile.ts src/main.ts tests/prompt-size.test.ts tests/prompt.test.ts
git commit -m "Prompt: freehand figures section, code bullet on demand, size budget pinned (freehand, Task 10)"
```

---

### Task 11: Few-shots, bundled examples, STYLE entry, sweep

**Files:**
- Modify: `src/llm/prompts/fewshots.json` (rewrite #4, add 3), `src/examples.json` (add 6), `STYLE.md:22` (new dated entry)
- Test: `tests/fewshots.test.ts`, `tests/examples.test.ts` (existing gates), `tests/freehand-examples.test.ts`

- [ ] **Step 1: Write the failing coverage test**

`tests/freehand-examples.test.ts`:
```ts
import { describe, expect, test } from "vitest";
import examples from "../src/examples.json";
import fewshots from "../src/llm/prompts/fewshots.json";

type Ex = { request: string; spec?: { template?: string; elements?: { type: string; at?: { ref?: string }; fit?: unknown; tex?: unknown }[] } };
const uses = (ex: Ex, pred: (e: NonNullable<Ex["spec"]>["elements"][number]) => boolean) => !!ex.spec?.elements?.some(pred);

describe("freehand exemplars (spec §6.2)", () => {
  test("three few-shots cover a thing, a formula and an image, all freehand", () => {
    const fh = (fewshots as Ex[]).filter((e) => !e.spec?.template);
    expect(fh.some((e) => uses(e, (x) => x.type === "group" && x.fit !== undefined))).toBe(true);
    expect(fh.some((e) => uses(e, (x) => x.type === "math"))).toBe(true);
    expect(fh.some((e) => uses(e, (x) => x.type === "image"))).toBe(true);
    expect((fewshots as Ex[]).find((e) => e.request.startsWith("Show a client"))!.spec!.elements!.some((x) => x.at?.ref)).toBe(true);
  });
  test("six bundled examples, question-shaped, two per target", () => {
    const fh = (examples as Ex[]).filter((e) => e.spec && !e.spec.template);
    const things = fh.filter((e) => uses(e, (x) => x.type === "group"));
    const maths = fh.filter((e) => uses(e, (x) => x.type === "math"));
    const images = fh.filter((e) => uses(e, (x) => x.type === "image"));
    expect(things.length).toBeGreaterThanOrEqual(2);
    expect(maths.length).toBeGreaterThanOrEqual(2);
    expect(images.length).toBeGreaterThanOrEqual(2);
    for (const e of [...things, ...maths, ...images]) expect(e.request).toMatch(/\?|why|how|hvorfor|hvordan/i);
  });
});
```

- [ ] **Step 2: Run to see it fail** — `npx vitest run tests/freehand-examples.test.ts` → FAIL.

- [ ] **Step 3: Write the exemplars**

Few-shots (fewshots.json, keys `request`/`spec` only):
- Rewrite #4 (client–server): keep nodes/arrows; place the two labels' equivalents and add `at`-placed `text` notes (`"GET /profile"` above `req` via `at: {ref: "req", side: "above", gap: 6}`), so the entry shows `at`.
- New: "How does a bicycle pump push air into a tyre?" — group `pump` (`fit: "left"`): `body` rect, `piston` rect at body top, `rod` path, `handle` rect, `hose` smooth path from body bottom-right, `valve` small circle at hose end; labels attach to parts; storyboard: draw group with a narrated hook on ink, highlight piston while explaining, `move` the piston down by an anchor-based `to`, point at valve, closing line naming the insight (one-way valve).
- New: "Why does a dropped ball speed up? Show the equations with the curve." — `axes` with `domain`, `curve` `expr: "0.5*9.8*x*x"`, `math` `s = \tfrac{1}{2} g t^2` placed `above-right` of the curve, `label` with `tex: "v = g t"`, contrast beat (a straight line drawn then erased).
- New: "What does a wind turbine's gearbox actually do?" — group of `tower`, `nacelle`, `blades` (three smooth closed paths), `gearbox` rect inside nacelle, one `image` `of: "Wind turbine"` placed to the right with `width: 200`, cameo-style erase after the biography beat.
All few-shots must pass `tests/fewshots.test.ts` (validate, lay out, zero issues). Images in few-shots have no `strokes` at rest — the layout warns `no image found` and draws nothing; make sure `tests/fewshots.test.ts` treats that warning as allowed for `image` elements (add the exemption there, narrowly: `warnings.filter(w => !/^no image found/.test(w))`).

Bundled examples (examples.json, keys `request`, `title`, `spec`), question-shaped, two per target, at least one in Norwegian per target: e.g. "Hva er delene i en symaskin, og hva gjør de?", "How does a lock and key open a door?", "Hvorfor faller alle ting like fort? Vis formelen.", "What does e = mc² say, next to the curve?", "Hvordan ser en ekte bikube ut, sammenlignet med skissen?", "Why is the Eiffel Tower shaped like that?" (with an `image`). Bundled examples must lint fully clean (`tests/examples.test.ts` line 95 forbids even warnings) — so bundled `image` examples need `strokes` embedded: resolve them once with the app (Insert → embed images, or `resolveImages` in a one-off node script with real fetch) and paste the `strokes`/`credit` fields in. Record the credits in the example.

STYLE.md: new entry under `## Ledger (newest first)` (line 22): `### 2026-09-09 — A thing is drawn as named parts`, Hans's ruling quoted from the spec discussion, distillation (parts named because the drill and click-to-explain need them; freehand first, template as upgrade), Status: in the prompt (Task 10) and in PEDAGOGY_RUBRIC — add one line to `PEDAGOGY_RUBRIC` (compile.ts:255-263): "8. If the figure is a thing, its parts are named elements the narration points at."

- [ ] **Step 4: Sweep and gates**

Run: `npx vitest run tests/freehand-examples.test.ts tests/fewshots.test.ts tests/examples.test.ts tests/prompt.test.ts` → PASS. Then `npm run sweep:round` (extend its pack list if any new example uses a pack) → `PASS`.

- [ ] **Step 5: Commit**

```bash
git add src/llm/prompts/fewshots.json src/examples.json STYLE.md src/llm/compile.ts tests/freehand-examples.test.ts tests/fewshots.test.ts
git commit -m "Three freehand few-shots, six bundled examples, the parts rule in STYLE and the rubric (freehand, Task 11)"
```

---

### Task 12: `icon` element — SVG arcs, Iconify resolver, licence table, codec

**Files:**
- Modify: `src/scenes/svgpath.ts:20` (arc command `A/a`)
- Create: `src/render/icon.ts`, `src/render/icon-sets.ts`
- Modify: `src/spec/trace.ts` (`encodeIcon`/`decodeIcon`), `src/render/resolve.ts` (`resolveIcons`), `src/render/index.ts:159`, `src/layout/tier2.ts` (icon case), `src/export/credits.ts` (already covers icon)
- Test: `tests/svgpath-arc.test.ts`, `tests/icon-resolve.test.ts`, `tests/icon-layout.test.ts`

**Interfaces:**
- Produces: `ICON_SETS: Record<string, { licence: string; cls: "permissive" | "by" | "by-sa" | "logo" }>` (lucide ISC, tabler MIT, ph MIT, heroicons MIT, material-symbols Apache-2.0, fa6-solid/fa6-regular CC BY 4.0, twemoji CC BY 4.0, openmoji CC BY-SA 4.0, simple-icons logo); `DEFAULT_PREFIXES = ["lucide","tabler","ph","heroicons","material-symbols"]`, `BY_PREFIXES = ["fa6-solid","fa6-regular","twemoji"]`; `iconSearchUrl(q, prefixes)`, `iconSvgUrl(prefix, name)`; `svgToRings(svg: string): Pt[][]` (viewBox-normalised to 0..1); `resolveIcons(spec, deps?, opts?: { forSeed?: boolean })`; `encodeIcon(rings: Pt[][]): string` (`"ic1:" + JSON`), `decodeIcon(s): Pt[][] | null`; `iconDrawables(el, rings, cx, cy): Drawable[]`.

- [ ] **Step 1: Write the failing arc test**

`tests/svgpath-arc.test.ts`:
```ts
import { describe, expect, test } from "vitest";
import { sampleSvgPath } from "../src/scenes/svgpath";

describe("sampleSvgPath arcs", () => {
  test("a circle from two half arcs has ~2πr length and 16+ points", () => {
    const rings = sampleSvgPath("M 12 2 A 10 10 0 1 1 12 22 A 10 10 0 1 1 12 2 Z", 8);
    expect(rings.length).toBe(1);
    const r = rings[0];
    expect(r.length).toBeGreaterThanOrEqual(16);
    let len = 0;
    for (let i = 0; i < r.length; i++) { const a = r[i], b = r[(i + 1) % r.length]; len += Math.hypot(b[0] - a[0], b[1] - a[1]); }
    expect(len).toBeCloseTo(2 * Math.PI * 10, 0);
    expect(r.every(([x, y]) => Math.abs(Math.hypot(x - 12, y - 12) - 10) < 0.05)).toBe(true);
  });
  test("relative arc and zero-radius arc (a line)", () => {
    expect(sampleSvgPath("M 0 0 a 0 0 0 0 1 10 0 L 10 10 Z", 4)[0][1]).toEqual([10, 0]);
  });
});
```

- [ ] **Step 2: Run to see it fail** — `npx vitest run tests/svgpath-arc.test.ts` → FAIL (`unsupported SVG path command "A"`).

- [ ] **Step 3: Implement arcs** in `svgpath.ts`: add `case "A": case "a":` consuming 7 numbers per arc (`rx ry xAxisRotation largeArc sweep x y`, relative for `a`); convert endpoint parameterisation to centre parameterisation per the SVG spec (F.6.5: correct out-of-range radii, compute centre, start angle θ1 and sweep Δθ with the sign from the sweep flag), then sample `Math.max(segments, Math.ceil(Math.abs(Δθ) / (Math.PI / 8)) * 4)` points along the ellipse (rotate by xAxisRotation) and push them; a zero radius becomes a straight line to the endpoint. Keep current-point bookkeeping consistent with `C`/`Q`.

- [ ] **Step 4: Write the failing resolver + layout tests**

`tests/icon-resolve.test.ts`:
```ts
import { describe, expect, test } from "vitest";
import { iconSearchUrl, iconSvgUrl, resolveIcons, svgToRings, DEFAULT_PREFIXES, BY_PREFIXES } from "../src/render/icon";
import { ICON_SETS } from "../src/render/icon-sets";
import { decodeIcon } from "../src/spec/trace";

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M2 20h20v-8l-6 4v-4l-6 4V8H2z"/></svg>';
const deps = (routes: Record<string, unknown>) => ({
  fetch: (async (url: string) => ({ ok: url in routes, status: url in routes ? 200 : 404, json: async () => routes[url], text: async () => routes[url] as string })) as unknown as typeof fetch,
});

describe("resolveIcons", () => {
  test("permissive hit: rings embedded, credit set, size kept", async () => {
    const spec = { elements: [{ id: "f", type: "icon", of: "factory", size: 80, x: 1, y: 1 }], commands: [] };
    const r = await resolveIcons(spec as never, deps({ [iconSearchUrl("factory", DEFAULT_PREFIXES)]: { icons: ["lucide:factory"] }, [iconSvgUrl("lucide", "factory")]: SVG }));
    expect(r).toEqual([{ id: "f", ok: true }]);
    const el = spec.elements[0] as { strokes?: string; credit?: string; set?: string };
    expect(decodeIcon(el.strokes!)!.length).toBe(1);
    expect(el.credit).toBe("factory from lucide · ISC");
    expect(el.set).toBe("lucide");
  });
  test("permissive miss falls back to CC BY sets", async () => {
    const spec = { elements: [{ id: "f", type: "icon", of: "flask", x: 1, y: 1 }], commands: [] };
    const r = await resolveIcons(spec as never, deps({ [iconSearchUrl("flask", DEFAULT_PREFIXES)]: { icons: [] }, [iconSearchUrl("flask", BY_PREFIXES)]: { icons: ["fa6-solid:flask"] }, [iconSvgUrl("fa6-solid", "flask")]: SVG }));
    expect(r[0].ok).toBe(true);
    expect((spec.elements[0] as { credit?: string }).credit).toBe("flask from fa6-solid · CC BY 4.0");
  });
  test("BY-SA only with explicit set, never as a seed; logo sets never", async () => {
    const mk = (set: string) => ({ elements: [{ id: "e", type: "icon", of: "smile", set, x: 1, y: 1 }], commands: [] });
    const routes = { [iconSvgUrl("openmoji", "smile")]: SVG, [iconSvgUrl("simple-icons", "smile")]: SVG };
    expect((await resolveIcons(mk("openmoji") as never, deps(routes)))[0].ok).toBe(true);
    expect((await resolveIcons(mk("openmoji") as never, deps(routes), { forSeed: true }))[0]).toMatchObject({ ok: false, error: expect.stringMatching(/share-alike/) });
    expect((await resolveIcons(mk("simple-icons") as never, deps(routes)))[0]).toMatchObject({ ok: false, error: expect.stringMatching(/logo/) });
    const noSet = { elements: [{ id: "e", type: "icon", of: "smile", x: 1, y: 1 }], commands: [] };
    expect((await resolveIcons(noSet as never, deps({ [iconSearchUrl("smile", DEFAULT_PREFIXES)]: { icons: ["openmoji:smile"] } })))[0].ok).toBe(false);
  });
  test("svgToRings normalises the viewBox to 0..1", () => {
    const rings = svgToRings(SVG);
    expect(rings[0].every(([x, y]) => x >= 0 && x <= 1 && y >= 0 && y <= 1)).toBe(true);
  });
  test("every default and BY prefix has a licence row of the right class", () => {
    for (const p of DEFAULT_PREFIXES) expect(ICON_SETS[p].cls).toBe("permissive");
    for (const p of BY_PREFIXES) expect(ICON_SETS[p].cls).toBe("by");
  });
});
```
`tests/icon-layout.test.ts`:
```ts
import { describe, expect, test } from "vitest";
import { layoutSpec, elementBBoxes } from "../src/layout/layout";
import { flattenDrawables } from "../src/layout/model";
import { encodeIcon } from "../src/spec/trace";

describe("icon layout", () => {
  test("rings scaled to size, y flipped (svg y-down → canvas y-up), placeable with at", () => {
    const strokes = encodeIcon([[[0, 0], [1, 0], [1, 1], [0, 1]]]);
    const r = layoutSpec({ elements: [{ id: "a", type: "shape", shape: "rect", x: 300, y: 300, width: 100, height: 40 }, { id: "i", type: "icon", of: "box", size: 50, strokes, at: { ref: "a", side: "above", gap: 10 } }], commands: [{ draw: ["a", "i"] }] });
    const b = elementBBoxes(r).get("i")!;
    expect([b.w, b.h]).toEqual([50, 50]);
    expect(b.y).toBeCloseTo(300 + 40 + 10, 0);
    expect(flattenDrawables(r.drawables).find((d) => d.id === "i__r0")).toMatchObject({ kind: "stroke", closed: true });
  });
  test("unresolved icon draws nothing and warns", () => {
    const r = layoutSpec({ elements: [{ id: "i", type: "icon", of: "nothing", x: 100, y: 100 }], commands: [{ draw: ["i"] }] });
    expect(r.warnings.join(" ")).toMatch(/no icon for "nothing"/);
  });
});
```

- [ ] **Step 5: Run to see them fail** — `npx vitest run tests/icon-resolve.test.ts tests/icon-layout.test.ts` → FAIL.

- [ ] **Step 6: Implement**

`icon-sets.ts`: the `ICON_SETS` table above. `trace.ts`: `encodeIcon(rings)` = `"ic1:" + JSON.stringify(rings.map(r => r.map(([x,y]) => [+x.toFixed(4), +y.toFixed(4)])))`; `decodeIcon` parses when prefixed, else null. `icon.ts`:
```ts
export const iconSearchUrl = (q: string, prefixes: string[]) => `https://api.iconify.design/search?query=${encodeURIComponent(q)}&limit=5&prefixes=${prefixes.join(",")}`;
export const iconSvgUrl = (prefix: string, name: string) => `https://api.iconify.design/${prefix}/${name}.svg`;
```
`svgToRings(svg)`: read `viewBox="minX minY w h"` (default `0 0 24 24`), every `<path d="…">` through `sampleSvgPath(d, 6)`, map to `[(x-minX)/w, (y-minY)/h]`; ignore `<rect>`/`<circle>` for now (Iconify normalises most sets to paths). Resolution: if `el.set` → `ICON_SETS[set]` must exist; `logo` → error "logo sets are not allowed"; `by-sa` with `opts.forSeed` → error "share-alike set cannot be a seed"; then fetch the SVG at `iconSvgUrl(set, slug(of))`. Without `set`: search `DEFAULT_PREFIXES`, then `BY_PREFIXES`; take the first `prefix:name` whose prefix is in the allowed class; fetch its SVG. Set `el.strokes = encodeIcon(rings)`, `el.set = prefix`, `el.credit = `${name} from ${prefix} · ${ICON_SETS[prefix].licence}``. Cache like images (`cacheGet`/`cachePut` key `` `ic1|${prefix ?? "*"}|${of}` ``). Add `resolveIcons` to `RenderResolveDeps` and `render()`.

tier2 `case "icon"`: `rings = decodeIcon(el.strokes)`; none → warn `no icon for "<of>"`; else `size = el.size ?? 100`, centre `originOr(el, [500,375])`, each ring → `StrokeDrawable` `${id}__r${k}` with `pts = ring.map(([u, v]) => [cx - size/2 + u*size, cy + size/2 - v*size])` (y flip), `closed: true`, wrapped in a `GroupDrawable` `el.id`; anchors centre + nine box anchors. Add `"r0"`-style suffixes to the painted-suffix list in `model.ts:264-271` if the renderer filters by suffix (read `leafDrawables` first — group children are painted regardless; if so, nothing to add).

- [ ] **Step 7: Run** — `npx vitest run tests/svgpath-arc.test.ts tests/icon-resolve.test.ts tests/icon-layout.test.ts tests/credits.test.ts tests/mathjax.test.ts tests/examples.test.ts` → PASS.

- [ ] **Step 8: Commit**

```bash
git add src/scenes/svgpath.ts src/render/icon.ts src/render/icon-sets.ts src/spec/trace.ts src/render/resolve.ts src/render/index.ts src/layout/tier2.ts src/layout/model.ts tests/svgpath-arc.test.ts tests/icon-resolve.test.ts tests/icon-layout.test.ts
git commit -m "icon element: Iconify keyword icons as hand-drawn rings, licence-classed, SVG arcs supported (freehand, Task 12)"
```

---

### Task 13: Router subject and the icon seed

**Files:**
- Modify: `src/llm/router.ts:23-29,32-40,42-52,65-76`
- Create: `src/llm/seed.ts`
- Modify: `src/llm/compile.ts:104-168` (`GenerateConfig.fetchSeed`), `:289-300,314-315` (use it), `:445-470` (credit attach)
- Modify: `src/main.ts:3124` (wire `fetchSeed`)
- Test: `tests/router.test.ts` (extend), `tests/seed.test.ts`

**Interfaces:**
- Produces: `RouteResult.subject: string` (`""` when none); `ROUTE_SCHEMA.properties.subject: { type: "string" }`, required; `SeedBlock = { text: string; ids: string[]; credit: string }`; `seedBlock(subject: string, rings: Pt[][], credit: string): SeedBlock` (paths simplified to ≤ 40 points each, coordinates in a 300×300 box at the canvas centre, ids `seed_<k>`, one group `seed` with `fit: "left"`); `attachSeedCredit(spec: Spec, seed: SeedBlock): boolean` (sets `credit` on the group named `seed` — or on the first group containing a surviving `seed_` id — returns whether any survived); `GenerateConfig.fetchSeed?: (subject: string, signal?: AbortSignal) => Promise<SeedBlock | null>`.

- [ ] **Step 1: Write the failing tests**

Extend `tests/router.test.ts`: the parsed reply keeps `subject` (`{ ids: [], none_fits: true, subject: "bicycle pump" }` → `subject === "bicycle pump"`; missing → `""`; non-string → `""`).

`tests/seed.test.ts`:
```ts
import { describe, expect, test } from "vitest";
import { attachSeedCredit, seedBlock } from "../src/llm/seed";

const ring = Array.from({ length: 200 }, (_, i): [number, number] => [0.5 + 0.4 * Math.cos((i / 200) * 2 * Math.PI), 0.5 + 0.4 * Math.sin((i / 200) * 2 * Math.PI)]);

describe("seedBlock", () => {
  test("simplifies to ≤ 40 points per path, names parts seed_k, wraps in a fitted group", () => {
    const s = seedBlock("bicycle pump", [ring, [[0, 0], [1, 1]]], "pump from lucide · ISC");
    expect(s.ids).toEqual(["seed_1", "seed_2"]);
    const json = JSON.parse(s.text.slice(s.text.indexOf("["), s.text.lastIndexOf("]") + 1)) as { id: string; type: string; points?: number[][]; members?: string[]; fit?: string }[];
    expect(json.find((e) => e.id === "seed_1")!.points!.length).toBeLessThanOrEqual(40);
    expect(json.find((e) => e.id === "seed")).toMatchObject({ type: "group", members: ["seed_1", "seed_2"], fit: "left" });
    expect(s.text).toMatch(/keep, edit, rename, extend or drop/);
  });
  test("credit attaches only when a seed path survives", () => {
    const s = seedBlock("x", [[[0, 0], [1, 0], [1, 1]]], "c");
    const kept = { elements: [{ id: "seed_1", type: "path", points: [[1, 1]] }, { id: "pump", type: "group", members: ["seed_1"] }], commands: [] };
    expect(attachSeedCredit(kept as never, s)).toBe(true);
    expect((kept.elements[1] as { credit?: string }).credit).toBe("based on c");
    const dropped = { elements: [{ id: "body", type: "path", points: [[1, 1]] }], commands: [] };
    expect(attachSeedCredit(dropped as never, s)).toBe(false);
  });
});
```

- [ ] **Step 2: Run to see them fail** — `npx vitest run tests/seed.test.ts tests/router.test.ts` → FAIL.

- [ ] **Step 3: Implement**

router.ts: add `subject` to `RouteResult`, `ROUTE_SCHEMA` (required, string), the prompt (`"Also return subject: the THING the figure is about, as a two-to-four word noun phrase in English (\"bicycle pump\", \"sewing machine\"), or \"\" when the request is about a relation, a quantity or a process rather than a thing."`), `parseRouteReply` (string → trimmed, else `""`), and the JSON example line.

seed.ts:
```ts
import { simplifyPolyline } from "../layout/geometry";
import type { Pt } from "../layout/model";
import type { Spec } from "../spec/types";

export interface SeedBlock { text: string; ids: string[]; credit: string }
const BOX = 300, CX = 500, CY = 375;

export function seedBlock(subject: string, rings: Pt[][], credit: string): SeedBlock {
  const ids: string[] = [];
  const elements: unknown[] = rings.map((r, k) => {
    const id = `seed_${k + 1}`; ids.push(id);
    let eps = 0.004, pts = r;
    while (pts.length > 40 && eps < 0.2) { pts = simplifyPolyline(r, eps); eps *= 1.6; }
    return { id, type: "path", closed: r.length > 2, smooth: true, points: pts.map(([u, v]) => [Math.round(CX - BOX / 2 + u * BOX), Math.round(CY + BOX / 2 - v * BOX)]) };
  });
  elements.push({ id: "seed", type: "group", members: ids, fit: "left" });
  const text = `Seed for "${subject}" — a keyword icon's outlines as ready path elements (${credit}). Use them as the starting shape of the thing: keep, edit, rename, extend or drop them; name the parts a viewer should know.\n\n${JSON.stringify(elements)}`;
  return { text, ids, credit };
}

export function attachSeedCredit(spec: Spec, seed: SeedBlock): boolean {
  const els = spec.elements ?? [];
  const survivors = new Set(els.filter((e) => seed.ids.includes(e.id)).map((e) => e.id));
  if (survivors.size === 0) return false;
  const group = els.find((e) => e.type === "group" && e.id === "seed") ?? els.find((e) => e.type === "group" && (e.members ?? []).some((m) => survivors.has(m)));
  if (group) group.credit = `based on ${seed.credit}`;
  return true;
}
```
compile.ts: `GenerateConfig.fetchSeed?`; after routing, `const seed = route?.noneFits && route.subject && cfg.fetchSeed ? await cfg.fetchSeed(route.subject, cfg.signal).catch(() => null) : null;` and `const userContent = [request, cfg.brief, seed?.text].filter(Boolean).join("\n\n");`; after `best` is final (before the return at ~467), `if (seed && best) attachSeedCredit(best, seed)`. Record `seeded: boolean` on `GenerationOutcome`.

main.ts:3124: `fetchSeed: async (subject, signal) => { const spec = { elements: [{ id: "seed_icon", type: "icon", of: subject, x: 0, y: 0 }], commands: [] }; const r = await resolveIcons(spec, undefined, { forSeed: true }); const el = spec.elements[0]; const rings = el.strokes ? decodeIcon(el.strokes) : null; return r[0]?.ok && rings ? seedBlock(subject, rings, el.credit ?? "") : null; }` (imports from `./render/icon`, `./spec/trace`, `./llm/seed`). The status line shows `"seeded from <set>"` when `outcome.seeded`.

- [ ] **Step 4: Run** — `npx vitest run tests/seed.test.ts tests/router.test.ts tests/generate-loop.test.ts tests/selector*.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/llm/router.ts src/llm/seed.ts src/llm/compile.ts src/main.ts tests/router.test.ts tests/seed.test.ts
git commit -m "Router names the subject; an icon seed rides the request; credit follows surviving seed paths (freehand, Task 13)"
```

---

### Task 14: Visual repair round (off by default)

**Files:**
- Modify: `src/export/video.ts:246` (export `paintFrame`), create `src/export/snapshot.ts`
- Create: `src/llm/visual.ts`
- Modify: `src/llm/compile.ts:104-168,484-529` (`GenerateConfig.visualRepair?: (spec: Spec) => Promise<string | null>` + the round), `src/main.ts` (wire behind a Settings → Advanced toggle `visualRepair`, default false; `src/store.ts` Settings field)
- Test: `tests/visual-repair.test.ts`, `tests/settings-migration.test.ts` (pin default false)

**Interfaces:**
- Produces: `snapshotPng(spec: Spec): Promise<string | null>` (browser only: hidden container, `render()`, `hd.timeline.renderUpTo(hd.plan.steps.length)`, serialise `svg.cs-svg`, `paintFrame` onto a 1280×720 canvas, `canvas.toDataURL("image/png")`, destroy); `visualRepairMessages(pngBase64: string, lint: LintIssue[]): Anthropic.MessageParam[]`; `VISUAL_REPAIR_PROMPT` constant; compile applies the same adoption rule as the pedagogy pass (valid, same template, lint no worse, changed).

- [ ] **Step 1: Write the failing tests**

`tests/visual-repair.test.ts`:
```ts
import { describe, expect, test, vi } from "vitest";
import { visualRepairMessages, VISUAL_REPAIR_PROMPT, wantsVisualRepair } from "../src/llm/visual";

describe("visual repair", () => {
  test("only freehand specs with a group qualify", () => {
    expect(wantsVisualRepair({ elements: [{ id: "g", type: "group", members: ["a"] }, { id: "a", type: "shape", shape: "rect", x: 1, y: 1 }], commands: [] })).toBe(true);
    expect(wantsVisualRepair({ template: "supply_demand", elements: [{ id: "g", type: "group", members: ["a"] }], commands: [] })).toBe(false);
    expect(wantsVisualRepair({ elements: [{ id: "a", type: "shape", shape: "rect", x: 1, y: 1 }], commands: [] })).toBe(false);
  });
  test("the user turn carries the PNG as an image block, then the lint list and the prompt", () => {
    const m = visualRepairMessages("AAAA", [{ rule: "overlap-label-stroke", ids: ["a", "b"], severity: "warn", message: "a overlaps b" }]);
    expect(m).toHaveLength(1);
    const content = m[0].content as { type: string; text?: string; source?: { data: string; media_type: string } }[];
    expect(content[0]).toMatchObject({ type: "image", source: { media_type: "image/png", data: "AAAA" } });
    expect(content[1].text).toContain("a overlaps b");
    expect(content[1].text).toContain(VISUAL_REPAIR_PROMPT);
  });
});
```
Then in `tests/generate-loop.test.ts` (read its fake-client harness first) add one case: with `visualRepair: async () => "AAAA"` and a spec that qualifies, the fake client receives one extra call whose last user content is an array with an `image` block; with the fake returning an invalid spec, `best` is unchanged.

- [ ] **Step 2: Run to see them fail** — `npx vitest run tests/visual-repair.test.ts` → FAIL.

- [ ] **Step 3: Implement**

`visual.ts`:
```ts
import type Anthropic from "@anthropic-ai/sdk";
import type { LintIssue } from "../lint/lint";
import type { Spec } from "../spec/types";

export const VISUAL_REPAIR_PROMPT = "This is your drawing, rendered exactly as the viewer sees its last frame. Look at it as a teacher would: parts in the wrong place or wrong size, overlapping strokes, text on top of lines, a thing that does not read as the thing. Fix what is wrong by returning the corrected spec (same template, same ids where possible). If nothing is wrong, return the spec unchanged.";

export function wantsVisualRepair(spec: Spec): boolean {
  return !spec.template && (spec.elements ?? []).some((e) => e.type === "group");
}

export function visualRepairMessages(pngBase64: string, lint: LintIssue[]): Anthropic.MessageParam[] {
  const list = lint.length ? `Remaining lint:\n${lint.map((i) => `- [${i.severity}] ${i.message}`).join("\n")}\n\n` : "";
  return [{ role: "user", content: [
    { type: "image", source: { type: "base64", media_type: "image/png", data: pngBase64 } },
    { type: "text", text: `${list}${VISUAL_REPAIR_PROMPT}` },
  ] }];
}
```
compile.ts: after the pedagogy block (529), `if (best && cfg.visualRepair && wantsVisualRepair(best)) { const png = await cfg.visualRepair(best).catch(() => null); if (png) { … callForJson(client, cfg.model, system, [...messages, { role: "assistant", content: JSON.stringify(best) }, ...visualRepairMessages(png.replace(/^data:image\/png;base64,/, ""), lintIssues)], schema, { signal, effort: "low" }) … } }` with the identical adoption block as 511-522 and `rounds.push({ label: "visual" … })` (extend the `GenerationRound` label union).

`export/snapshot.ts`: export `paintFrame` from video.ts (rename nothing; add `export`), and
```ts
export async function snapshotPng(spec: Spec): Promise<string | null> {
  if (typeof document === "undefined") return null;
  const host = document.createElement("div"); host.style.cssText = "position:fixed;left:-10000px;top:0;width:800px;height:600px"; document.body.appendChild(host);
  try {
    const hd = await render(spec, host, { mode: "silent" } as never);
    hd.timeline.renderUpTo(hd.plan.steps.length);
    const svg = host.querySelector<SVGSVGElement>("svg.cs-svg"); if (!svg) return null;
    const canvas = document.createElement("canvas"); canvas.width = 1280; canvas.height = 720;
    await paintFrame(canvas.getContext("2d")!, new XMLSerializer().serializeToString(svg), await sketchFontStyle(), "", spec.title ?? "");
    hd.destroy();
    return canvas.toDataURL("image/png");
  } finally { host.remove(); }
}
```
(`sketchFontStyle` is video.ts:132 — export it too.) Check `RenderOptions` for the actual field that silences narration and use it.

store.ts: `visualRepair: boolean` default `false` in `DEFAULT_SETTINGS`, listed in the Advanced tab with the note "Renders the figure and lets the model look at it once (one extra call). Off until measured."; pin in `tests/settings-migration.test.ts`. main.ts:3124 passes `visualRepair: settings.visualRepair ? snapshotPng : undefined`.

- [ ] **Step 4: Run** — `npx vitest run tests/visual-repair.test.ts tests/generate-loop.test.ts tests/settings-migration.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/llm/visual.ts src/llm/compile.ts src/export/video.ts src/export/snapshot.ts src/store.ts src/main.ts tests/visual-repair.test.ts tests/generate-loop.test.ts tests/settings-migration.test.ts
git commit -m "Visual repair round: the model sees its last frame once, off by default (freehand, Task 14)"
```

---

### Task 15: Live eval, smoke checklist, ledger, merge readiness

**Files:**
- Create: `scripts/freehand-eval.mjs`, `docs/superpowers/plans/2026-09-09-freehand-figures-smoke.md`, `docs/superpowers/plans/2026-09-09-freehand-figures-ledger.md`
- Modify: `package.json` scripts (`"eval:freehand": "node scripts/freehand-eval.mjs"`), `ROADMAP.md` (a "Freehand figures — done" section + follow-ups), `NOTES.md` (status of the sources table)

- [ ] **Step 1: Write the eval script**

Model on `scripts/selector-eval.mjs` (Vite SSR harness, `ANTHROPIC_API_KEY` from env or `.env`, hand-rolled flags). Flags: `--seed on|off`, `--visual on|off` (visual needs a browser; in node the script passes `visualRepair: undefined` and prints "visual: unavailable in node"), `--out <dir>` (default `.superpowers/eval/freehand-<timestamp>`), `--limit N`. Cases (12, in the script):
```js
const CASES = [
  ["thing", "How does a bicycle pump push air into a tyre?"], ["thing", "Hva er delene i en symaskin, og hva gjør de?"],
  ["thing", "What are the parts of a neuron and what does each do?"], ["thing", "Hvordan virker en dørlås?"],
  ["math", "Why does a dropped ball speed up? Show the equations with the curve."], ["math", "Hvorfor blir renters rente så stor? Vis formelen ved kurven."],
  ["math", "What does the logistic equation say, drawn next to its S-curve?"], ["math", "Vis formelen for arealet av en sirkel ved siden av sirkelen."],
  ["image", "Why is the Eiffel Tower shaped like that?"], ["image", "Hvorfor har en bikube sekskanter? Vis et ekte bilde og skissen."],
  ["image", "What makes a violin sound the way it does?"], ["image", "Hvordan ser Stortinget ut, og hvorfor er det bygget slik?"],
];
```
For each: `generateSpec(request, { apiKey, model, variant, exemplars: [], route: routeTemplates-bound, fetchSeed: seed==="on" ? …resolveIcons in node with real fetch… : undefined, pedagogyReview: true, effort: "high" })`; record `{ label, request, template, rounds: rounds.map(r=>r.label), seeded, lintErrors, lintWarns, ms, cost, usesAt, usesGroup, usesFit, usesMath, usesImage, usesIcon }`, write the spec to `<out>/<n>.json`, print a table, and a PASS/FAIL per spec §7.4: no error-severity lint on any; ≥ 3 of 4 per label use the target field (`thing` → group, `math` → math, `image` → image); median ms < 90 000. Exit code 1 on FAIL.

- [ ] **Step 2: Run the baseline and the after-runs**

`git stash` nothing — run against `main` first: `git worktree add ../freehand-baseline main && (cd ../freehand-baseline && npm install && ANTHROPIC_API_KEY=… node ../freehand/scripts/freehand-eval.mjs --seed off --out ../freehand/.superpowers/eval/baseline)` (the script must tolerate the old `generateSpec` lacking `fetchSeed`). Then on the branch: `npm run eval:freehand -- --seed off` and `--seed on`. Paste the three tables into the ledger with cost and time.

- [ ] **Step 3: Write the smoke checklist**

`docs/superpowers/plans/2026-09-09-freehand-figures-smoke.md`, following `2026-09-08-anchors-and-motion-round-2-smoke.md`: `npm run dev` in the worktree, then five sections: (1) Examples → the bicycle pump: parts drawn as one thing on the left, labels on parts, piston moves as one, "Find the part" drill (⊕) lists the parts; (2) the free-fall example: formula appears as handwriting above the curve, `label.tex` on the curve; (3) the Eiffel Tower example: photo fades in with a credit line under it, ⋯ menu shows Credits, video export writes `.credits.txt`; (4) a fresh request "hvordan virker en sykkelpumpe" with Templates on demand ON: status says "Drawn freehand" and offers the button, no 4-minute wait; with seed on, status says "seeded from lucide"; (5) Settings → Advanced → Visual repair on, regenerate: one extra "visual" round in the status, figure not worse. Each with an explicit "Expect:" paragraph.

- [ ] **Step 4: Ledger and roadmap**

Ledger: header like the anchors ledger, the baseline numbers from Task 10 step 1 and the post-change numbers, the eval tables, every ruling made during execution, and the spec amendment about `at`. ROADMAP: `## Freehand figures — done 2026-09-xx` summarising the elements and verbs added, with "Deliberately left": Commons SVG tracing, photo-as-reference, offline icon subset, per-element credit on the canvas for icons. NOTES: mark the table rows as done/deferred.

- [ ] **Step 5: Full suite, build, sweep**

Run: `npm test && npm run build && npm run build:engine && npm run sweep:round` → all green; note `dist/assets` largest chunks did not gain an eager mathjax/iconify chunk (`ls -S dist/assets | head`).

- [ ] **Step 6: Commit and hand over**

```bash
git add scripts/freehand-eval.mjs package.json docs/superpowers/plans/2026-09-09-freehand-figures-smoke.md docs/superpowers/plans/2026-09-09-freehand-figures-ledger.md ROADMAP.md NOTES.md
git commit -m "Freehand eval script, smoke checklist, ledger and roadmap entry (freehand, Task 15)"
```
Merge into `main` only after Hans's smoke test (the merge condition of every round).
