# Group Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `row`, `column` and `grid` on a group, so three boxes in a line need no coordinates — and a member declared two sentences later lands where the row always intended, without moving the ones already drawn.

**Architecture:** One new pure module (`src/layout/group-layout.ts`) computes slot offsets from the members' own measured boxes, and one new function in `tier2.ts` applies them — a sibling of the existing `fitGroup`, which already knows how to move already-emitted members and repair their anchors, labels and nested groups. That shared machinery is extracted rather than copied. Equalizing is a cheap pre-pass, not the two-pass the spec feared: a rect node already honours an explicit `width`/`height` (`tier2.ts:1127`), so the sizes can be written onto the members before they are emitted.

**Tech Stack:** TypeScript, vitest.

**Spec:** `docs/superpowers/specs/2026-09-19-group-layout-and-inline-timing-design.md`, Part A (§1–§9). Part B (inline timing) is a separate round.

## Global Constraints

- **The deploy gate is `npm test && npm run build`** — vitest does not typecheck.
- **The script round-trip gate must stay green**: `tests/script-roundtrip.test.ts`, 258 bundled examples and every pack's params, both directions, stable twice.
- **A group with no `layout` must behave exactly as today.** The blast radius is the casts that opt in, and the corpus has none yet.
- **Nothing already drawn may shift** when a later member joins: layout runs once over the finished spec, never incrementally.
- **A new spec field is taught in the same round**: `compiler-v1.md`, the schema description, and a prompt-size re-pin.
- Work on `round/group-layout`; merge and push in the last task.

## Deliberately deferred

`boxed` (§2 of the spec — a border around members that have none) is NOT in this round. `box` members already carry their own border, so it serves only rows of formulas, images and portraits, and it would land a second border mechanism in the same week as the border fix. The spec's status line says so when this round lands.

## File Structure

| File | Responsibility |
|---|---|
| `src/layout/group-layout.ts` | **new** — slot geometry and the natural node size. Pure; no ctx, no drawables. |
| `src/layout/tier2.ts` | `layoutGroup`, the equalize pre-pass, and the owned-ids helper shared with `fitGroup`. |
| `src/spec/types.ts`, `src/spec/schema.ts` | the five fields and their validation. |
| `src/spec/script/{sugar,parse,print}.ts` | `row`/`column`/`grid` heads, member blocks, `in <id>`. |
| `tests/group-layout.test.ts`, `tests/group-layout-script.test.ts` | **new** |

---

### Task 1: Slot geometry

**Files:** Create `src/layout/group-layout.ts`; test `tests/group-layout.test.ts`.

**Produces:**
```ts
export const DEFAULT_GAP = 40;
export type GroupLayout = "row" | "column" | "grid";
export interface SlotOpts { gap?: number; columns?: number; align?: "center" | "start" | "end" }
/** Where each member's CENTRE goes, in the group's own coordinates (origin at
 *  the assembly's top-left corner, y-up), given each member's size. */
export function slotCentres(layout: GroupLayout, sizes: { w: number; h: number }[], opts?: SlotOpts): Pt[];
/** The natural size a node takes when it declares none — the same formula
 *  nodeDrawables uses, so equalize cannot drift from what gets drawn. */
export function naturalNodeSize(el: SpecElement): { w: number; h: number } | null;
```

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, test } from "vitest";
import { DEFAULT_GAP, naturalNodeSize, slotCentres } from "../src/layout/group-layout";

const size = (w: number, h: number) => ({ w, h });

describe("slot centres", () => {
  test("a row places members left to right, one gap apart, centred on the cross axis", () => {
    const c = slotCentres("row", [size(100, 40), size(60, 80)]);
    expect(c[1][0] - c[0][0]).toBeCloseTo(100 / 2 + DEFAULT_GAP + 60 / 2, 5);
    expect(c[0][1]).toBeCloseTo(c[1][1], 5);
  });

  test("a column places them top to bottom", () => {
    const c = slotCentres("column", [size(100, 40), size(60, 80)]);
    expect(c[0][1] - c[1][1]).toBeCloseTo(40 / 2 + DEFAULT_GAP + 80 / 2, 5);
    expect(c[0][0]).toBeCloseTo(c[1][0], 5);
  });

  test("the gap is the one thing you usually do not write", () => {
    const wide = slotCentres("row", [size(100, 40), size(100, 40)], { gap: 100 });
    const narrow = slotCentres("row", [size(100, 40), size(100, 40)]);
    expect(wide[1][0] - wide[0][0]).toBeCloseTo(narrow[1][0] - narrow[0][0] + (100 - DEFAULT_GAP), 5);
  });

  test("align start lines a row up by its members' tops", () => {
    const c = slotCentres("row", [size(100, 40), size(60, 80)], { align: "start" });
    expect(c[0][1] + 40 / 2).toBeCloseTo(c[1][1] + 80 / 2, 5);
  });

  test("a grid wraps at columns, row by row", () => {
    const c = slotCentres("grid", [size(50, 50), size(50, 50), size(50, 50)], { columns: 2 });
    expect(c[0][1]).toBeCloseTo(c[1][1], 5);
    expect(c[2][1]).toBeLessThan(c[0][1]);
    expect(c[2][0]).toBeCloseTo(c[0][0], 5);
  });

  test("one member is its own centre", () => {
    expect(slotCentres("row", [size(80, 20)])).toHaveLength(1);
  });

  test("no members is no slots", () => {
    expect(slotCentres("row", [])).toEqual([]);
  });
});

describe("the natural size of a node", () => {
  test("a rect grows with its text", () => {
    const small = naturalNodeSize({ id: "a", type: "node", shape: "rect", text: "Hi" })!;
    const big = naturalNodeSize({ id: "b", type: "node", shape: "rect", text: "Husholdninger" })!;
    expect(big.w).toBeGreaterThan(small.w);
    expect(big.h).toBeCloseTo(small.h, 5);
  });

  test("a declared width wins", () => {
    expect(naturalNodeSize({ id: "a", type: "node", shape: "rect", text: "Hi", width: 300 })!.w).toBe(300);
  });

  test("only nodes have one", () => {
    expect(naturalNodeSize({ id: "t", type: "text", text: "hi" })).toBeNull();
  });
});
```

- [ ] **Step 2: Run it and watch it fail** — `npx vitest run tests/group-layout.test.ts`, module does not resolve.

- [ ] **Step 3: Write the module.** `slotCentres` walks the sizes accumulating along the main axis, adding `gap` between neighbours, and places each centre on the cross axis per `align`. `naturalNodeSize` mirrors `nodeDrawables`' rect branch (`Math.max(130, textW + 36)` × 62, `heuristicMeasure(text, NODE_FONT)`), returning null for a non-node.

- [ ] **Step 4: Run it and watch it pass.**

- [ ] **Step 5: Commit.**

---

### Task 2: The fields

**Files:** Modify `src/spec/types.ts`, `src/spec/schema.ts`; test `tests/group-layout.test.ts` (extend).

Add to `SpecElement`: `layout?: "row" | "column" | "grid"`, `equalize?: boolean`, `align?: "center" | "start" | "end"`. `gap` and `columns` already exist on the element (they are `at.gap`'s neighbour and `pieces`' columns) — check before adding; reuse if the names are free at element level, else add.

Validation: `layout` only on a `group`; `columns` required by nothing but read only by `grid`; a `layout` group with no members is already an error (`group-empty`).

- [ ] **Step 1: Write the failing test** — a group with `layout: "row"` validates; `layout` on a non-group is an error naming the element.
- [ ] **Step 2: Run it and watch it fail.**
- [ ] **Step 3: Add the fields, the schema entries with their descriptions, and the check.**
- [ ] **Step 4: Run it and watch it pass.**
- [ ] **Step 5: Commit.**

---

### Task 3: Equalize, as a pre-pass

**Files:** Modify `src/layout/tier2.ts`; test `tests/group-layout.test.ts` (extend).

Before the emit loop (beside the free-node and auto-row passes, ~line 290): for every group with a `layout` and `equalize !== false`, compute `naturalNodeSize` for each member, take the largest `w` and `h`, and write them onto the member elements. `normalizeSpec` has already deep-cloned the spec (`layout.ts` calls it), so mutating is safe.

- [ ] **Step 1: Write the failing test** — two boxes with different text in a row come out the same width; `equalize: false` leaves them their own widths; a non-node member is untouched.
- [ ] **Step 2: Run it and watch it fail.**
- [ ] **Step 3: Implement the pre-pass.**
- [ ] **Step 4: Run it and watch it pass, and run the full layout suite for regressions.**
- [ ] **Step 5: Commit.**

---

### Task 4: `layoutGroup`

**Files:** Modify `src/layout/tier2.ts`; test `tests/group-layout.test.ts` (extend).

`fitGroup` (tier2.ts:776) already moves already-emitted members: it computes the ids a member owns (`<id>`, `<id>_…`, `pieceGroups`), the nested groups that move with it, and updates drawables, `ctx.anchors`, `ctx.namedAnchors`, `ctx.groupBoxes` and the pending label requests. `layoutGroup` needs exactly that, per member, with a translation instead of a scale — so **extract the owned-ids and repair logic into a shared helper and have both call it**. Do not copy it.

In the group case (tier2.ts:~608), `layout` runs BEFORE `fit`:

```ts
if (el.layout && box) box = layoutGroup(el, leaves, all, labels, ctx, measure, issues) ?? box;
if (el.fit && box && box.w > 0 && box.h > 0) box = fitGroup(el, leaves, box, all, labels, ctx, measure, issues);
```

so "a row of five boxes fitted into the left half" is one group with both.

- [ ] **Step 1: Write the failing test**

```ts
test("a row places its members left to right with no coordinates anywhere", () => {
  const r = layoutSpec({
    elements: [
      { id: "a", type: "node", shape: "rect", text: "Innsats" },
      { id: "b", type: "node", shape: "rect", text: "Produksjon" },
      { id: "c", type: "node", shape: "rect", text: "Resultat" },
      { id: "g", type: "group", members: ["a", "b", "c"], layout: "row" },
    ],
    commands: [{ draw: ["g"] }],
  });
  const b = elementBBoxes(r);
  expect(b.get("a")!.x).toBeLessThan(b.get("b")!.x);
  expect(b.get("b")!.x).toBeLessThan(b.get("c")!.x);
  // one gap apart, and level
  expect(b.get("b")!.x - (b.get("a")!.x + b.get("a")!.w)).toBeCloseTo(DEFAULT_GAP, 0);
  expect(b.get("a")!.y).toBeCloseTo(b.get("c")!.y, 0);
  expect(r.issues.filter((i) => i.severity === "error")).toEqual([]);
});
```

plus: a column stacks downward; `gap` is honoured; a nested column inside a row moves as one; an arrow between two members runs between their settled boxes; `layout` + `fit` scales the assembled row into the region; a member drawn in a later command does not move the earlier ones (lay out, then compare boxes against the same spec with all members in one draw).

- [ ] **Step 2: Run it and watch it fail.**
- [ ] **Step 3: Extract the shared helper from `fitGroup`, then write `layoutGroup`.**
- [ ] **Step 4: Run it and watch it pass; then the whole suite.**
- [ ] **Step 5: Commit.**

---

### Task 5: The script

**Files:** Modify `src/spec/script/{sugar,parse,print}.ts`; test `tests/group-layout-script.test.ts`.

- `row`, `column`, `grid` are element aliases for `group` with that `layout` (the `ELEMENT_ALIASES` table already carries `fields`, so `row → {type: "group", fields: {layout: "row"}}` needs no new mechanism).
- Inside such a block, a deeper-indented line whose head is an element type is a MEMBER declaration, not a key/value continuation: parse it as its own element and append its id to the group's `members`.
- `in <id>` on any element appends that element's id to that group's `members`, resolved when the page is finished so the group may be declared later.
- Printing: members all first drawn in the group's own beat → nested block; otherwise the group alone and each member with `in <id>`.

- [ ] **Step 1: Write the failing test** — the nested form parses to group + members; the `in` form parses to the same spec; both print back in their own shape; the round-trip gate stays green.
- [ ] **Step 2: Run it and watch it fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run it, the round-trip gate, and the whole suite.**
- [ ] **Step 5: Commit.**

---

### Task 6: Teach the model, re-pin, and a bundled example

**Files:** `src/llm/prompts/compiler-v1.md`, `tests/prompt-size.test.ts`, `src/examples.json`.

Teach `layout` in the freehand composition bullet, beside `fit` — they are the pair: `layout` arranges the members, `fit` places the assembly. Say that a row equalizes its boxes and that members may be declared in any beat.

Add ONE bundled example that uses it, because the examples fill `{{EXEMPLARS}}` and are how the model learns a new field. The economic circuit is the natural candidate: it is the cast that motivated the round, and rewriting it drops six coordinates.

- [ ] **Step 1: Write the prompt bullet.**
- [ ] **Step 2: Run the prompt-size test to read the new sizes; re-pin both baselines with the reason.**
- [ ] **Step 3: Rewrite the economic-circuit example to use a row, and run `tests/examples.test.ts`** — it must validate, lay out and lint clean.
- [ ] **Step 4: Run the whole suite.**
- [ ] **Step 5: Commit.**

---

### Task 7: The gate and the push

- [ ] **Step 1: `npx vitest run`** — everything green.
- [ ] **Step 2: `npm run build`** — tsc clean.
- [ ] **Step 3: Update the spec's status** — Part A implemented, `boxed` deferred and why.
- [ ] **Step 4: Merge to main, push, wait for the Netlify deploy to read `ready`.**
- [ ] **Step 5: Report**, with the economic circuit printed before and after.

## Self-Review

**Spec coverage:** §2's fields — Task 2 (minus `boxed`, deferred above). §3 placement via existing `at`/`fit` — Task 4's ordering. §4 equalize — Task 3. §5 `in` and "nothing shifts" — Tasks 4 and 5, with a test for each. §6 nesting — Task 4. §7 arrows — no work needed, covered by a test. §8 the script — Task 5. §9's exclusions — nothing to do.

**The risk:** Task 4 touches the group case every figure with a group goes through. Mitigated by the guard that a group without `layout` takes exactly the old path, and by extracting rather than copying `fitGroup`'s repair logic — a second copy is how the two would drift.

**Type consistency:** `GroupLayout` is the type of the spec field, the parameter of `slotCentres` and the value in `ELEMENT_ALIASES`. `DEFAULT_GAP` is imported by the tests rather than re-typed as 40.
