# Named Places and Auto-Placement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An element can say *where it goes in words* — `at: {"place": "top_right"}` — and an element that says nothing at all gets placed instead of piling up in the middle of the canvas.

**Architecture:** One new pure-geometry module (`src/layout/places.ts`) computes a safe area and the delta that lands an element's own anchor on a named anchor of that area. Two wiring points in `src/layout/tier2.ts` use it: the existing post-emit shift (pass 3), which already moves a finished element for `at.ref`, and `originOr`, the single place a free element gets its fallback position. The spec gains one optional field, `at.place`, whose values are the anchor names the spec already uses — no new vocabulary.

**Tech Stack:** TypeScript, vitest (`npx vitest run <file>`), js-yaml, ajv. Flat test files in `tests/*.test.ts`.

**Spec:** `docs/superpowers/specs/2026-09-19-script-dsl-design.md` — this plan implements §7 (Places instead of coordinates), which the spec's §12 orders first.

## Global Constraints

- **The deploy gate is `npm test && npm run build`.** Netlify runs both; vitest does NOT typecheck, `npm run build` runs `tsc`. Both must pass locally before pushing.
- **Canvas is 1000 × 750 logical units, y-up, origin bottom-left** (`CANVAS` in `src/layout/canvas.ts`).
- **`place` reuses `UNIVERSAL_ANCHORS` verbatim** — `center, top, bottom, left, right, top_left, top_right, bottom_left, bottom_right` (`src/layout/anchors.ts:8`). Underscores, not hyphens; the hyphenated spelling is accepted only as a normalization alias.
- **A new spec field is taught in the same round it lands**: `src/llm/prompts/compiler-v1.md` + the schema `description` + a prompt-size re-pin in `tests/prompt-size.test.ts` (standing rule, Hans 2026-09-10).
- **Existing casts must not move.** Auto-placement changes only figures that today pile two or more positionless elements on the same spot. One free element keeps the exact centre it has always had.
- **Commit after every task.** Push once, at the end of Task 6.

## File Structure

| File | Responsibility |
|---|---|
| `src/layout/places.ts` | **new** — pure geometry: the safe area, the place delta, the auto-row slots. Knows nothing of specs, elements or layout context. |
| `src/layout/anchors.ts` | gains the exported `UniversalAnchor` type over the existing const. |
| `src/spec/types.ts` | `at.place` on `SpecElement`. |
| `src/spec/schema.ts` | the `place` property + its description (prompt documentation), the bare-string normalization, the two contradiction checks. |
| `src/layout/tier2.ts` | the two wiring points: `originOr` (build at origin / take the auto slot) and pass 3 (the shift). |
| `src/llm/prompts/compiler-v1.md` | teaches the model the vocabulary. |
| `tests/places.test.ts` | **new** — the pure module + the schema/normalization. |
| `tests/places-layout.test.ts` | **new** — the layout wiring and the auto-row. |
| `tests/prompt-size.test.ts` | the budget re-pin. |

---

### Task 1: `at.place` in the type and the schema

**Files:**
- Modify: `src/layout/anchors.ts:8` (export the type)
- Modify: `src/spec/types.ts:104` (the `at?:` field)
- Modify: `src/spec/schema.ts:126-148` (the `at` properties), `:1076` (`normalizeSpec`), `:1475` (`elementErrors`)
- Test: `tests/places.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `type UniversalAnchor` from `src/layout/anchors.ts`; `SpecElement["at"]` gains `place?: UniversalAnchor`; `normalizeSpec` turns `at: "left"` and `at: "top-right"` into `{ place: "left" }` / `{ place: "top_right" }`.

- [ ] **Step 1: Write the failing test**

Create `tests/places.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { normalizeSpec, validateSpec } from "../src/spec/schema";
import type { Spec } from "../src/spec/types";

const withAt = (at: unknown) => ({
  elements: [{ id: "t", type: "text", text: "hei", at }],
  commands: [{ draw: ["t"] }],
});

describe("at.place — a named spot on the canvas", () => {
  test("a place name validates", () => {
    expect(validateSpec(withAt({ place: "top_right" })).ok).toBe(true);
  });

  test("the bare string form normalizes to an object", () => {
    const n = normalizeSpec(withAt("left")) as Spec;
    expect(n.elements![0].at).toEqual({ place: "left" });
  });

  test("a hyphenated place name normalizes to the anchor spelling", () => {
    const n = normalizeSpec(withAt("top-right")) as Spec;
    expect(n.elements![0].at).toEqual({ place: "top_right" });
  });

  test("place cannot be combined with x/y", () => {
    const r = validateSpec({
      elements: [{ id: "t", type: "text", text: "hei", x: 100, y: 100, at: { place: "left" } }],
      commands: [{ draw: ["t"] }],
    });
    expect(r.ok).toBe(false);
    expect(r.errors.join(" ")).toContain("at.place cannot be combined with x/y");
  });

  test("place cannot be combined with ref", () => {
    const r = validateSpec(withAt({ place: "left", ref: "other" }));
    expect(r.ok).toBe(false);
    expect(r.errors.join(" ")).toContain("at.place cannot be combined with at.ref");
  });

  test("an unknown place name is rejected", () => {
    expect(validateSpec(withAt({ place: "middle-ish" })).ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/places.test.ts`
Expected: FAIL — the first test errors because `place` is not in the `at` schema (`additionalProperties: false`).

- [ ] **Step 3: Export the anchor-name type**

In `src/layout/anchors.ts`, directly under the existing `UNIVERSAL_ANCHORS` const (line 8):

```ts
export type UniversalAnchor = (typeof UNIVERSAL_ANCHORS)[number];
```

- [ ] **Step 4: Add the field to the spec type**

In `src/spec/types.ts`, add the import beside the existing `SpecText` type import:

```ts
import type { UniversalAnchor } from "../layout/anchors";
```

and extend the `at` field's object form (the line beginning `at?: { x?: number; y?: number; on?: string; ...`) with `place`, keeping the rest of the line as it is:

```ts
  /** Where the element goes. point: `{x, y}` or `intersection_of`. Any coordinate-placed element: `{ref, side?, gap?, anchor?, offset?}` — placed relative to another element's box (side: outside it, gap units away; anchor: a named point on it) — or `{place}`, a named spot on the canvas itself. Never together with x/y. */
  at?: { x?: number; y?: number; on?: string; intersection_of?: string[]; ref?: string; anchor?: string; side?: Side; gap?: number; offset?: [number, number]; place?: UniversalAnchor } | [number, number];
```

- [ ] **Step 5: Add the schema property and its description**

In `src/spec/schema.ts`, add to the imports:

```ts
import { UNIVERSAL_ANCHORS } from "../layout/anchors";
```

and inside the `at` oneOf object's `properties` (after `offset`), add:

```ts
            place: {
              type: "string",
              enum: [...UNIVERSAL_ANCHORS],
              description:
                "A named spot on the CANVAS, for a part that belongs to the page rather than to another element: the element's own same-named point lands on that point of the canvas's safe area, so `left` seats its left edge at the left margin, `center` centres it, and `top_right` tucks it into that corner — it can never fall off the edge, whatever its size. Its own `anchor` overrides which of ITS points lands there. Never with x/y or ref.",
            },
```

- [ ] **Step 6: Normalize the bare string form**

In `src/spec/schema.ts`, inside `normalizeSpec`'s element loop (after the `el.link` normalization, before the label-as-TeX rewrite), add:

```ts
    // `at: "left"` is the short way to say `at: {place: "left"}`, and the
    // hyphenated spelling (the script DSL's, and the one a model reaches for
    // by analogy with side names) normalizes to the anchor spelling — so
    // validation, layout and lint only ever see one form. An unknown name is
    // left as written: the schema enum reports it, this function does not.
    if (typeof (el.at as unknown) === "string") {
      const place = (el.at as unknown as string).replace(/-/g, "_");
      el.at = { place } as SpecElement["at"];
    }
```

- [ ] **Step 7: Add the two contradiction checks**

In `src/spec/schema.ts`, in `elementErrors`, replace the existing `at.ref` + x/y block (line ~1475) with:

```ts
  if (el.at !== undefined && !Array.isArray(el.at)) {
    const at = el.at as { ref?: string; place?: string };
    if (typeof at.ref === "string" && (typeof el.x === "number" || typeof el.y === "number")) {
      errs.push(`element "${el.id}": at.ref cannot be combined with x/y`);
    }
    if (typeof at.place === "string" && (typeof el.x === "number" || typeof el.y === "number")) {
      errs.push(`element "${el.id}": at.place cannot be combined with x/y`);
    }
    if (typeof at.place === "string" && typeof at.ref === "string") {
      errs.push(`element "${el.id}": at.place cannot be combined with at.ref — a place is on the canvas, a ref is on another element`);
    }
  }
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `npx vitest run tests/places.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 9: Commit**

```bash
git add src/layout/anchors.ts src/spec/types.ts src/spec/schema.ts tests/places.test.ts
git commit -m "Places: at.place, a named spot on the canvas, in the type and the schema"
```

---

### Task 2: The place geometry

**Files:**
- Create: `src/layout/places.ts`
- Test: `tests/places.test.ts` (extend)

**Interfaces:**
- Consumes: `UniversalAnchor` (Task 1), `boxAnchor` and `UNIVERSAL_ANCHORS` from `src/layout/anchors.ts`, `CANVAS` from `src/layout/canvas.ts`, `BBox` from `src/layout/geometry.ts`, `Pt` from `src/layout/model.ts`.
- Produces:
  - `PLACE_MARGIN: number` (40)
  - `safeArea(canvas?: { w: number; h: number }): BBox`
  - `placeDelta(own: BBox, place: UniversalAnchor, ownAnchor?: string, canvas?: { w: number; h: number }): Pt`
  - `autoRow(n: number, canvas?: { w: number; h: number }): Pt[]`

- [ ] **Step 1: Write the failing test**

Append to `tests/places.test.ts`:

```ts
import { autoRow, placeDelta, safeArea, PLACE_MARGIN } from "../src/layout/places";

const box = (x: number, y: number, w: number, h: number) => ({ x, y, w, h });
const shifted = (b: { x: number; y: number; w: number; h: number }, [dx, dy]: [number, number]) =>
  ({ x: b.x + dx, y: b.y + dy, w: b.w, h: b.h });

describe("place geometry", () => {
  test("the safe area is the canvas inset by the margin on every side", () => {
    expect(safeArea()).toEqual({ x: PLACE_MARGIN, y: PLACE_MARGIN, w: 1000 - 2 * PLACE_MARGIN, h: 750 - 2 * PLACE_MARGIN });
  });

  test("left seats the left edge on the margin, vertically centred", () => {
    const b = shifted(box(0, 0, 100, 40), placeDelta(box(0, 0, 100, 40), "left"));
    expect(b.x).toBeCloseTo(PLACE_MARGIN, 5);
    expect(b.y + b.h / 2).toBeCloseTo(375, 5);
  });

  test("top_right tucks the element's own top-right corner into that corner", () => {
    const b = shifted(box(0, 0, 200, 80), placeDelta(box(0, 0, 200, 80), "top_right"));
    expect(b.x + b.w).toBeCloseTo(1000 - PLACE_MARGIN, 5);
    expect(b.y + b.h).toBeCloseTo(750 - PLACE_MARGIN, 5);
  });

  test("center centres the element on the canvas", () => {
    const b = shifted(box(0, 0, 120, 60), placeDelta(box(0, 0, 120, 60), "center"));
    expect(b.x + b.w / 2).toBeCloseTo(500, 5);
    expect(b.y + b.h / 2).toBeCloseTo(375, 5);
  });

  test("a huge element still cannot fall off the left edge", () => {
    const b = shifted(box(0, 0, 900, 700), placeDelta(box(0, 0, 900, 700), "left"));
    expect(b.x).toBeCloseTo(PLACE_MARGIN, 5);
  });

  test("the element's own anchor overrides which of its points lands there", () => {
    const b = shifted(box(0, 0, 120, 60), placeDelta(box(0, 0, 120, 60), "left", "center"));
    expect(b.x + b.w / 2).toBeCloseTo(PLACE_MARGIN, 5);
  });

  test("autoRow spreads n slots evenly across the safe area at mid height", () => {
    const slots = autoRow(2);
    expect(slots).toHaveLength(2);
    expect(slots[0][0]).toBeCloseTo(PLACE_MARGIN + (1000 - 2 * PLACE_MARGIN) * 0.25, 5);
    expect(slots[1][0]).toBeCloseTo(PLACE_MARGIN + (1000 - 2 * PLACE_MARGIN) * 0.75, 5);
    expect(slots[0][1]).toBeCloseTo(375, 5);
  });

  test("a single slot is the centre of the canvas", () => {
    expect(autoRow(1)[0][0]).toBeCloseTo(500, 5);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/places.test.ts`
Expected: FAIL — "Failed to resolve import ../src/layout/places".

- [ ] **Step 3: Write the module**

Create `src/layout/places.ts`:

```ts
// A named spot on the CANVAS (spec 2026-09-19-script-dsl §7). `at: {place}`
// lands the element's OWN same-named anchor on that anchor of the safe area:
// `left` seats its left edge at the left margin, `center` centres it, a
// corner tucks into that corner. Because both ends of the rule are the SAME
// anchor, the element stays on the canvas whatever its size — which is what
// makes a place safe to write without knowing how big the thing will come out.
import { boxAnchor, type UniversalAnchor } from "./anchors";
import { CANVAS } from "./canvas";
import type { BBox } from "./geometry";
import type { Pt } from "./model";

/** How far the safe area sits inside the canvas, logical units. */
export const PLACE_MARGIN = 40;

type CanvasSize = { w: number; h: number };

/** The canvas inset by PLACE_MARGIN — what a place name refers to. */
export function safeArea(canvas: CanvasSize = CANVAS): BBox {
  return { x: PLACE_MARGIN, y: PLACE_MARGIN, w: canvas.w - 2 * PLACE_MARGIN, h: canvas.h - 2 * PLACE_MARGIN };
}

/** dx, dy that puts `own`'s `ownAnchor` (default: the place's own name) on `place`. */
export function placeDelta(own: BBox, place: UniversalAnchor, ownAnchor?: string, canvas: CanvasSize = CANVAS): Pt {
  const target = boxAnchor(safeArea(canvas), place);
  const from = boxAnchor(own, ownAnchor ?? place);
  return [target[0] - from[0], target[1] - from[1]];
}

/**
 * Where n positionless elements go: evenly spaced slot centres across the
 * safe area, at mid height. One slot is the canvas centre, which is where a
 * lone free element has always landed — so a figure only changes when it was
 * piling elements on top of each other.
 */
export function autoRow(n: number, canvas: CanvasSize = CANVAS): Pt[] {
  const area = safeArea(canvas);
  return Array.from({ length: n }, (_, i) => [area.x + (area.w * (i + 0.5)) / n, canvas.h / 2] as Pt);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/places.test.ts`
Expected: PASS, 14 tests.

- [ ] **Step 5: Commit**

```bash
git add src/layout/places.ts tests/places.test.ts
git commit -m "Places: the safe area, the place delta and the auto-row slots"
```

---

### Task 3: Wire `place` into the layout

**Files:**
- Modify: `src/layout/tier2.ts` — imports, `originOr` (~line 818), the relative-placement block (~line 612)
- Test: `tests/places-layout.test.ts`

**Interfaces:**
- Consumes: `placeDelta` (Task 2), `at.place` (Task 1).
- Produces: an element with `at: {place}` is emitted at the origin and shifted into place by pass 3, exactly as `at.ref` elements are.

- [ ] **Step 1: Write the failing test**

Create `tests/places-layout.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { layoutSpec, elementBBoxes } from "../src/layout/layout";
import { PLACE_MARGIN } from "../src/layout/places";

describe("at.place in layoutSpec", () => {
  test("left seats a rect's left edge on the margin, vertically centred", () => {
    const r = layoutSpec({
      elements: [{ id: "a", type: "shape", shape: "rect", width: 120, height: 60, at: { place: "left" } }],
      commands: [{ draw: ["a"] }],
    });
    const b = elementBBoxes(r).get("a")!;
    expect(b.x).toBeCloseTo(PLACE_MARGIN, 0);
    expect(b.y + b.h / 2).toBeCloseTo(375, 0);
    expect(r.issues.filter((i) => i.rule === "placement")).toEqual([]);
  });

  test("top_right tucks a text into the top-right corner", () => {
    const r = layoutSpec({
      elements: [{ id: "t", type: "text", text: "BNP = summen", font_size: 26, at: { place: "top_right" } }],
      commands: [{ draw: ["t"] }],
    });
    const b = elementBBoxes(r).get("t")!;
    expect(b.x + b.w).toBeCloseTo(1000 - PLACE_MARGIN, 0);
    expect(b.y + b.h).toBeCloseTo(750 - PLACE_MARGIN, 0);
  });

  test("a placed element's own anchor still overrides", () => {
    const r = layoutSpec({
      elements: [{ id: "a", type: "shape", shape: "rect", width: 120, height: 60, at: { place: "left" }, anchor: "center" }],
      commands: [{ draw: ["a"] }],
    });
    const b = elementBBoxes(r).get("a")!;
    expect(b.x + b.w / 2).toBeCloseTo(PLACE_MARGIN, 0);
  });

  test("a place on an element that draws nothing of its own is reported, not silent", () => {
    const r = layoutSpec({
      elements: [
        { id: "a", type: "shape", shape: "rect", x: 500, y: 375, width: 100, height: 40 },
        { id: "l", type: "label", attach_to: "a", text: "hei", at: { place: "left" } },
      ],
      commands: [{ draw: ["a", "l"] }],
    });
    expect(r.issues.some((i) => i.rule === "placement" && i.ids.includes("l"))).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/places-layout.test.ts`
Expected: FAIL — the rect lands at the canvas centre (its own default), not at the margin.

- [ ] **Step 3: Import the geometry in tier2**

In `src/layout/tier2.ts`, add to the existing `./place` import line's neighbours:

```ts
import { placeDelta } from "./places";
```

- [ ] **Step 4: Build placed elements at the origin**

In `src/layout/tier2.ts`, in `originOr` (~line 818), replace the `relAt(el)?.ref` test so a place is built at the origin too — pass 3 moves it afterwards, exactly as it does for a ref:

```ts
function originOr(el: SpecElement, ctx: Ctx, fallback: Pt): Pt {
  const at = relAt(el);
  if (at?.ref || at?.place) {
    ctx.atFallback[el.id] = fallback;
    return [0, 0];
  }
  return [el.x ?? fallback[0], el.y ?? fallback[1]];
}
```

- [ ] **Step 5: Shift placed elements in pass 3**

In `src/layout/tier2.ts`, in the relative-placement block (~line 612): widen the condition, hoist `ownBox` above the branch, and add the place branch. The ref branch's body is unchanged apart from losing its own `const ownBox` line (it now comes from above):

```ts
    const at = relAt(el);
    if ((at?.ref || at?.place) && el.type !== "angle" && el.type !== "point") {
      const mine = drawables.slice(start);
      const ownBox = ownBBox(mine, el.id, measure);
      const move = (dx: number, dy: number) => {
        // ... unchanged ...
      };
      if (at.place) {
        // A place needs no ref box: the canvas IS the reference.
        if (ownBox) {
          const [dx, dy] = placeDelta(ownBox, at.place, el.anchor);
          move(dx, dy);
        } else {
          issues.push({
            rule: "placement",
            ids: [el.id],
            severity: "warn",
            message: el.type === "label"
              ? `element "${el.id}": at.place is ignored — a label draws nothing of its own to place; use attach_to and side instead`
              : `element "${el.id}": at.place is ignored — ${el.type} draws nothing of its own to place`,
          });
        }
      } else {
        const refBox = refBBox([...(opts.seedDrawables ?? []), ...drawables.slice(0, start)], at.ref!, measure, ctx);
        const fallback = ctx.atFallback[el.id];
        // ... the rest of the existing body, verbatim, minus its own
        //     `const ownBox = ownBBox(mine, el.id, measure);` line ...
      }
    }
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx vitest run tests/places-layout.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 7: Run the placement suite for regressions**

Run: `npx vitest run tests/placement-layout.test.ts tests/place.test.ts tests/layout-spec.test.ts`
Expected: PASS — the ref path is untouched.

- [ ] **Step 8: Commit**

```bash
git add src/layout/tier2.ts tests/places-layout.test.ts
git commit -m "Places: at.place lands an element on the canvas, through the same pass-3 shift as at.ref"
```

---

### Task 4: Auto-placement for positionless elements

**Files:**
- Modify: `src/layout/tier2.ts` — the `Ctx` interface (~line 118), its initializer (~line 240), a new pass after the free-node pass (~line 287), `originOr` (~line 818)
- Test: `tests/places-layout.test.ts` (extend)

**Interfaces:**
- Consumes: `autoRow` (Task 2), `relAt` (already imported in tier2).
- Produces: `Ctx.autoPlace: Record<string, Pt>` — the position a positionless element takes, read by `originOr`.

- [ ] **Step 1: Write the failing test**

Append to `tests/places-layout.test.ts`:

```ts
import { autoRow } from "../src/layout/places";

describe("auto-placement of positionless elements", () => {
  test("one free shape keeps the centre it has always had", () => {
    const r = layoutSpec({
      elements: [{ id: "a", type: "shape", shape: "rect", width: 120, height: 60 }],
      commands: [{ draw: ["a"] }],
    });
    const b = elementBBoxes(r).get("a")!;
    expect(b.x + b.w / 2).toBeCloseTo(500, 0);
    expect(b.y + b.h / 2).toBeCloseTo(375, 0);
  });

  test("three free shapes spread into a row instead of piling up", () => {
    const r = layoutSpec({
      elements: [
        { id: "a", type: "shape", shape: "rect", width: 120, height: 60 },
        { id: "b", type: "shape", shape: "rect", width: 120, height: 60 },
        { id: "c", type: "shape", shape: "rect", width: 120, height: 60 },
      ],
      commands: [{ draw: ["a", "b", "c"] }],
    });
    const boxes = elementBBoxes(r);
    const centres = ["a", "b", "c"].map((id) => boxes.get(id)!.x + boxes.get(id)!.w / 2);
    const slots = autoRow(3).map(([x]) => x);
    expect(centres[0]).toBeCloseTo(slots[0], 0);
    expect(centres[1]).toBeCloseTo(slots[1], 0);
    expect(centres[2]).toBeCloseTo(slots[2], 0);
    expect(centres[0]).toBeLessThan(centres[1]);
    expect(centres[1]).toBeLessThan(centres[2]);
  });

  test("an element with its own x is left exactly where it says", () => {
    const r = layoutSpec({
      elements: [
        { id: "a", type: "shape", shape: "rect", x: 200, y: 600, width: 120, height: 60 },
        { id: "b", type: "shape", shape: "rect", width: 120, height: 60 },
        { id: "c", type: "shape", shape: "rect", width: 120, height: 60 },
      ],
      commands: [{ draw: ["a", "b", "c"] }],
    });
    const boxes = elementBBoxes(r);
    expect(boxes.get("a")!.x + boxes.get("a")!.w / 2).toBeCloseTo(200, 0);
    // Only the two free ones share the row.
    const slots = autoRow(2).map(([x]) => x);
    expect(boxes.get("b")!.x + boxes.get("b")!.w / 2).toBeCloseTo(slots[0], 0);
    expect(boxes.get("c")!.x + boxes.get("c")!.w / 2).toBeCloseTo(slots[1], 0);
  });

  test("an element placed with at is not part of the row", () => {
    const r = layoutSpec({
      elements: [
        { id: "a", type: "shape", shape: "rect", width: 120, height: 60, at: { place: "left" } },
        { id: "b", type: "shape", shape: "rect", width: 120, height: 60 },
      ],
      commands: [{ draw: ["a", "b"] }],
    });
    const boxes = elementBBoxes(r);
    expect(boxes.get("a")!.x).toBeCloseTo(PLACE_MARGIN, 0);
    // b is the only free element, so it keeps the centre.
    expect(boxes.get("b")!.x + boxes.get("b")!.w / 2).toBeCloseTo(500, 0);
  });

  test("nodes keep their own ring and do not join the row", () => {
    const r = layoutSpec({
      elements: [
        { id: "n1", type: "node", shape: "rect", text: "A" },
        { id: "n2", type: "node", shape: "rect", text: "B" },
        { id: "t", type: "text", text: "hei", font_size: 26 },
      ],
      commands: [{ draw: ["n1", "n2", "t"] }],
    });
    const boxes = elementBBoxes(r);
    // The lone free text (nodes are not in the row) keeps the centre.
    expect(boxes.get("t")!.x + boxes.get("t")!.w / 2).toBeCloseTo(500, 0);
    // The two nodes are on the ring: different x, mirrored about the centre.
    expect(boxes.get("n1")!.x).not.toBeCloseTo(boxes.get("n2")!.x, 0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/places-layout.test.ts`
Expected: FAIL — the three free rects all land on the canvas centre, so `centres[0]` equals `centres[1]`.

- [ ] **Step 3: Add the context field**

In `src/layout/tier2.ts`, in the `Ctx` interface (beside `nodeRadius`, ~line 118):

```ts
  /** Positions computed for elements that gave none (see the auto-row pass). */
  autoPlace: Record<string, Pt>;
```

and in its initializer (~line 240, beside `nodeRadius: new Map(),`):

```ts
    autoPlace: {},
```

- [ ] **Step 4: Add the auto-row pass**

In `src/layout/tier2.ts`, directly after Pass 1 (the free-node ring, which ends with the `for (const node of elements.filter(...))` loop, ~line 287), add:

```ts
  // Pass 1b: elements that gave no position at all would each take their own
  // type's fallback — in practice the canvas centre, so two of them land on
  // top of each other. They spread into a row instead (spec 2026-09-19 §7).
  // ONE free element keeps the centre it has always had, so a figure only
  // changes when it was already a pile. Nodes are excluded: they have their
  // own ring above. So are the types whose position comes from somewhere
  // else — a label from what it is attached to, a curve from the domain, an
  // inset from its column.
  const freeElements = elements.filter((e) => AUTO_ROW_TYPES.has(e.type) && e.x === undefined && e.y === undefined && !relAt(e));
  if (freeElements.length > 1) {
    const slots = autoRow(freeElements.length);
    freeElements.forEach((el, i) => {
      ctx.autoPlace[el.id] = slots[i];
    });
  }
```

and, at module level near the other constants at the top of the file:

```ts
/** The types the auto-row pass places: the ones that own a free x/y and
 *  otherwise fall back to the middle of the canvas. */
const AUTO_ROW_TYPES = new Set<ElementType>(["text", "shape", "math", "image", "icon", "portrait", "polygon", "sector", "arc", "ellipse"]);
```

Add `autoRow` to the `./places` import and `ElementType` to the `../spec/types` type import if it is not already there.

- [ ] **Step 5: Read the slot in `originOr`**

In `src/layout/tier2.ts`, `originOr` becomes:

```ts
function originOr(el: SpecElement, ctx: Ctx, fallback: Pt): Pt {
  const at = relAt(el);
  if (at?.ref || at?.place) {
    ctx.atFallback[el.id] = fallback;
    return [0, 0];
  }
  const auto = ctx.autoPlace[el.id];
  return [el.x ?? auto?.[0] ?? fallback[0], el.y ?? auto?.[1] ?? fallback[1]];
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx vitest run tests/places-layout.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 7: Run the whole suite and judge every failure**

Run: `npx vitest run`
Expected: PASS. A failure is only acceptable when the spec under test has **two or more** positionless elements of an `AUTO_ROW_TYPES` type — that figure was a pile before this task and is a row now, which is the intended change; update that expectation and name it in the commit message. Any other failure is a bug in this task: fix it before committing.

- [ ] **Step 8: Run the bundled-examples gate**

Run: `npx vitest run tests/examples.test.ts`
Expected: PASS — every bundled example still validates, lays out and lints.

- [ ] **Step 9: Commit**

```bash
git add src/layout/tier2.ts tests/places-layout.test.ts
git commit -m "Places: positionless elements spread into a row instead of piling up in the centre"
```

---

### Task 5: Teach the model, and re-pin the prompt budget

**Files:**
- Modify: `src/llm/prompts/compiler-v1.md` (the composition bullet, line ~20, and the `fit` bullet's neighbourhood, line ~22)
- Modify: `tests/prompt-size.test.ts:292-293` (the two baselines)

**Interfaces:**
- Consumes: the schema `description` written in Task 1 (it is embedded verbatim in the prompt).
- Produces: nothing other code reads.

- [ ] **Step 1: Add the vocabulary to the compiler prompt**

In `src/llm/prompts/compiler-v1.md`, at the end of bullet 1 ("Build a THING, not a scatter of elements", line ~20), append:

```markdown
A part that belongs to the PAGE rather than to another part takes a place instead of a ref: `"at": {"place": "top_right"}` lands the element's own same-named point on that point of the canvas (`center`, `top`, `bottom`, `left`, `right`, `top_left`, `top_right`, `bottom_left`, `bottom_right`), so a corner note tucks into the corner and cannot fall off the edge whatever its size. And an element that gives no position at all is placed for you: alone it takes the centre, several spread into a row — so never write x/y merely to keep two things apart.
```

- [ ] **Step 2: Run the prompt-size test to see the new sizes**

Run: `npx vitest run tests/prompt-size.test.ts`
Expected: FAIL — "expected N to be less than or equal to 197600" (system) and the same for the schema. Write down both actual numbers.

- [ ] **Step 3: Re-pin the two baselines**

In `tests/prompt-size.test.ts`, replace lines 292-293 with the measured values and the reason, keeping the file's existing habit of explaining each re-pin:

```ts
// 2026-09-19 (named places): the `at.place` schema description and the
// prompt's place sentence. schema 78677 → <measured>, system 197600 →
// <measured>.
const BASELINE_SYSTEM_CHARS = <measured>;
const BASELINE_SCHEMA_CHARS = <measured>;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/prompt-size.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/llm/prompts/compiler-v1.md tests/prompt-size.test.ts
git commit -m "Places: taught in the compiler prompt, prompt budget re-pinned"
```

---

### Task 6: The deploy gate, the spec's status, and the push

**Files:**
- Modify: `docs/superpowers/specs/2026-09-19-script-dsl-design.md` (the status line)

**Interfaces:**
- Consumes: Tasks 1-5.
- Produces: nothing.

- [ ] **Step 1: Run the full suite**

Run: `npx vitest run`
Expected: PASS, every test.

- [ ] **Step 2: Run the build — this is what Netlify runs, and vitest does not typecheck**

Run: `npm run build`
Expected: `tsc` clean, then a successful vite build. A type error here is a deploy failure; fix it and re-run both Step 1 and Step 2.

- [ ] **Step 3: Update the spec's status line**

In `docs/superpowers/specs/2026-09-19-script-dsl-design.md`, replace the status paragraph with:

```markdown
Status: §7 (named places and auto-placement) implemented 2026-09-19 — plan:
docs/superpowers/plans/2026-09-19-named-places.md. §3-§6 and §8-§11 (the
script format itself) are designed, not implemented; their plan is written
once places have landed.
```

- [ ] **Step 4: Commit and push**

```bash
git add docs/superpowers/specs/2026-09-19-script-dsl-design.md
git commit -m "Places landed: spec status"
git push origin main
```

- [ ] **Step 5: Report**

Say, first thing: pushed and live on https://drawcast.app, then what changed — `at: {"place": …}` in words, and positionless elements no longer piling up. Note that nothing in the editor yet *spells* a place in words: that arrives with the script format.

---

## Self-Review

**Spec coverage (§7 of the design):** named places on the canvas — Tasks 1-3. Auto-placement with `row` as a hint — Task 4 delivers the automatic row; `row`/`stack`/`grid` as authored hints are the `arrange` verb, which already exists, so no task is owed. Words survive the round trip — guaranteed by storing `place` in the spec (Task 1) rather than resolving it to numbers. The model gets the vocabulary for free — Task 5.

**Deliberately not in this plan:** `stack` and `grid` auto-layouts (the row is the one shape that earns its place in v1 — a pile is the failure it fixes); place resolution against a template's free space rather than the canvas (templates place their own parts); and the two lint rules of §11, which belong to the script format, not to places.

**Known limitation to carry into the round's notes:** the auto-row spaces slots evenly by index, before any element is measured, so three elements of very different widths are evenly spaced rather than evenly *gapped*. `arrange: {layout: "row"}` remains the precise tool. This is stated so it is a choice, not a surprise.

**Type consistency check:** `UniversalAnchor` (anchors.ts) is the type of `at.place` (types.ts), the enum of the schema property (schema.ts) and the parameter of `placeDelta` (places.ts) — one source, four uses. `Pt` is `[number, number]` from `layout/model.ts` in both `autoRow`'s return and `Ctx.autoPlace`'s values. `PLACE_MARGIN` is imported by both test files rather than re-typed as 40.
