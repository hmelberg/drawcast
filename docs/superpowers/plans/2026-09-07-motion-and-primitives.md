# Motion and Primitives Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Any element can be moved AND rotated; tier-2 gets sector / arc / polygon / pieces primitives; an `arrange` verb lays targets out (row, zipper, grid, ring, stack) with code computing every coordinate; a `circle_sectors` template morphs a circle into the πr² rectangle under `animate`.

**Architecture:** The scene state grows from `offsets` to a pose (`offsets` + `turns`), composed exactly in the planner (rotation about a pivot stored in the element's original frame), tweened by a new `transform` step in the player through `RenderedElement.setTransform` on the SVG backend. Primitives are ordinary tier-2 elements in `src/layout/tier2.ts`; the `pieces` generator also records per-piece geometry in `LayoutResult.pieces` and a parent→children map in `LayoutResult.pieceGroups`, which the planner uses to expand a pieces id and to compute the zipper. The template lives in the mathlogic pack and drives the same motion by parameters.

**Tech Stack:** TypeScript, vitest (node environment, no DOM — `h()` throws; DOM code is verified by tsc and a Playwright smoke run by the controller), js-yaml packs.

**Spec:** `docs/superpowers/specs/2026-09-07-motion-and-primitives-design.md`

## Global Constraints

- The model writes semantics, code computes geometry: no verb takes a coordinate the model must compute for a shape it cannot see; `at`/`to`/`pivot` are the only coordinate inputs and all are optional.
- Canvas is 1000×750 logical units, y-UP. SVG is y-down: the backend flips with `H - y`.
- Rotation is in DEGREES, counter-clockwise in the y-up canvas.
- Never `git commit` inside a task; the controller commits after review. Never use the Write tool on an EXISTING file (other tasks edit neighbouring regions of the same files concurrently) — use Edit with exact anchors; Write only for NEW files.
- Run only the test files you touched plus `npx tsc --noEmit`; the controller runs the full suite. Tests are `npx vitest run tests/<file>.test.ts` from the worktree root `/Users/hom/Documents/GitHub/drawcast/.claude/worktrees/template-spike`.
- Every new schema field carries a `description` the model reads; keep them one sentence, imperative, with an example.

---

### Task 1: Pose — `move` gains `rotate`, `to`, `pivot`; a `transform` step; labels follow

**Files:**
- Modify: `src/spec/types.ts:196-205` (`MoveArgs`)
- Modify: `src/spec/schema.ts:492-509` (the `move` command schema) and the `move` semantic check near the ACTION_VERBS validation (search `move` in `semanticErrors`; if none exists, add one)
- Modify: `src/render/plan.ts` — `SceneState` (line ~97), `INITIAL_STATE` (~109), `PlanOptions` (~120), the move branch (~436-452), the step union (~74), state snapshot (~178)
- Modify: `src/render/backend.ts:14-26` (`RenderedElement.setTransform`)
- Modify: `src/render/svg-backend.ts:586-598` (`setOffset` → `setTransform`)
- Modify: `src/render/player.ts` — `applyScene` (~386-393), the `move` case (~988), the scroll tween (~1050-1063)
- Modify: `src/render/index.ts:181-190` (pass `attachedTo` to `planCommands`)
- Create: `src/render/pose.ts` (pure pose math)
- Test: `tests/pose.test.ts` (new), `tests/plan.test.ts` (extend the `move` describe), `tests/schema.test.ts` (extend)

**Interfaces:**
- Produces: `export interface Turn { deg: number; pivot: Pt }` and `export function composeTurn(offset: Pt, turn: Turn | undefined, deltaDeg: number, pivotNow: Pt): { offset: Pt; turn: Turn }` in `src/render/pose.ts`; `SceneState.turns: Record<string, Turn>`; `PlanStep` gains `{ kind: "transform"; items: TransformItem[]; seconds: number; easing: Easing }` with `export interface TransformItem { id: string; from: { offset: Pt; turn: Turn }; to: { offset: Pt; turn: Turn } }`; `PlanOptions.attachedTo?: (id: string) => string[]`; `RenderedElement.setTransform?(dx: number, dy: number, deg: number, pivot: Pt): void`.
- Consumes: nothing from other tasks. Task 3 emits `transform` steps through the same types.

- [ ] **Step 1: Write the failing pose tests**

Create `tests/pose.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { composeTurn, poseOf, type Turn } from "../src/render/pose";

const close = (a: [number, number], b: [number, number]) => {
  expect(a[0]).toBeCloseTo(b[0], 6);
  expect(a[1]).toBeCloseTo(b[1], 6);
};

describe("composeTurn", () => {
  test("first rotation about the element's own point leaves the offset alone and stores the pivot in the original frame", () => {
    const r = composeTurn([10, 5], undefined, 90, [110, 55]);
    expect(r.turn.deg).toBe(90);
    close(r.turn.pivot, [100, 50]); // pivotNow minus the offset
    close(r.offset, [10, 5]);
  });
  test("rotating about a point elsewhere moves the element: 180° about the origin sends (10,0)+offset 0 to (-10,0)", () => {
    // Element point P=(10,0) (original frame), no offset, no turn. Rotate 180° about Q=(0,0).
    const r = composeTurn([0, 0], undefined, 180, [0, 0]);
    // pose applies: rotate about pivot (0,0) by 180 then translate by offset
    const p = poseOf(r.offset, r.turn)([10, 0]);
    close(p, [-10, 0]);
  });
  test("two rotations about the same current point compose to their sum, wherever the element is", () => {
    const a = composeTurn([30, 0], undefined, 45, [130, 0]); // pivot at original (100,0)
    const b = composeTurn(a.offset, a.turn, 45, [130, 0]);
    expect(b.turn.deg).toBe(90);
    // the point under the pivot never moves
    close(poseOf(b.offset, b.turn)([100, 0]), [130, 0]);
  });
  test("a rotation about a different point is exact: the second pivot stays fixed", () => {
    const a = composeTurn([0, 0], undefined, 90, [0, 0]); // 90° about origin
    const b = composeTurn(a.offset, a.turn, 90, [50, 0]); // then 90° about the point now at (50,0)
    close(poseOf(b.offset, b.turn)(poseOf(a.offset, a.turn, true)([50, 0])), [50, 0]);
  });
});
```

Note on the last test: `poseOf(offset, turn, inverse = true)` returns the inverse map (current → original), so the original-frame point currently at (50,0) is found and shown to be fixed by the composed pose.

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run tests/pose.test.ts`
Expected: FAIL — cannot find module `../src/render/pose`.

- [ ] **Step 3: Write `src/render/pose.ts`**

```ts
// The pose of a moved-and-turned element (design §2.1): an offset in
// logical units plus a rotation about a pivot stored in the element's
// ORIGINAL frame. The pose maps an original point x to R(deg, pivot)x + offset.
// composeTurn adds a rotation by `deltaDeg` about `pivotNow` (a point in
// CURRENT coordinates) exactly:
//   R(δ,Q)(R(deg,p)x + t) = R(deg+δ,p)x + [R(δ)(p + t − Q) + Q − p]
// so the pivot stays p and only the offset changes.
import type { Pt } from "../layout/model";

export interface Turn {
  deg: number;
  pivot: Pt;
}

const rad = (deg: number): number => (deg * Math.PI) / 180;

/** Rotate a vector by deg about the origin (counter-clockwise, y-up). */
export function rotateVec([x, y]: Pt, deg: number): Pt {
  const c = Math.cos(rad(deg));
  const s = Math.sin(rad(deg));
  return [x * c - y * s, x * s + y * c];
}

export function composeTurn(offset: Pt, turn: Turn | undefined, deltaDeg: number, pivotNow: Pt): { offset: Pt; turn: Turn } {
  const p: Pt = turn && turn.deg !== 0 ? turn.pivot : [pivotNow[0] - offset[0], pivotNow[1] - offset[1]];
  const deg = (turn?.deg ?? 0) + deltaDeg;
  const v: Pt = [p[0] + offset[0] - pivotNow[0], p[1] + offset[1] - pivotNow[1]];
  const rv = rotateVec(v, deltaDeg);
  const next: Pt = [rv[0] + pivotNow[0] - p[0], rv[1] + pivotNow[1] - p[1]];
  return { offset: next, turn: { deg, pivot: p } };
}

/** The pose as a point map (original → current), or its inverse. */
export function poseOf(offset: Pt, turn: Turn | undefined, inverse = false): (x: Pt) => Pt {
  const deg = turn?.deg ?? 0;
  const p: Pt = turn?.pivot ?? [0, 0];
  if (!inverse) {
    return ([x, y]) => {
      const r = rotateVec([x - p[0], y - p[1]], deg);
      return [r[0] + p[0] + offset[0], r[1] + p[1] + offset[1]];
    };
  }
  return ([x, y]) => {
    const r = rotateVec([x - offset[0] - p[0], y - offset[1] - p[1]], -deg);
    return [r[0] + p[0], r[1] + p[1]];
  };
}

/** Where a bounding-box centre sits under a pose (the pivot default and `to` both use it). */
export function poseCentre(box: { x: number; y: number; w: number; h: number }, offset: Pt, turn: Turn | undefined): Pt {
  return poseOf(offset, turn)([box.x + box.w / 2, box.y + box.h / 2]);
}
```

- [ ] **Step 4: Run the pose tests**

Run: `npx vitest run tests/pose.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Extend `MoveArgs` and the schema**

In `src/spec/types.ts` replace the `MoveArgs` interface with:

```ts
export interface MoveArgs {
  target: string[] | string;
  /** [dx, dy] delta — domain units when a domain is declared, else logical. */
  by?: [number, number];
  /** Absolute destination for the element's centre (same units as by); alternative to by/path. */
  to?: [number, number];
  /** Waypoint offsets from the element's starting position; the last is the final offset. */
  path?: [number, number][];
  /** Degrees, counter-clockwise (y-up); the element turns about `pivot`. */
  rotate?: number;
  /** The point to turn about, in current coordinates (same units as by). Default: the element's own centre. */
  pivot?: [number, number];
  /** seconds */
  duration?: number;
  easing?: Easing;
}
```

In `src/spec/schema.ts` inside the `move` object's `properties` (after `path`) add:

```ts
        to: { type: "array", items: { type: "number" }, minItems: 2, maxItems: 2, description: "Absolute destination for the element's CENTRE (same units as by) — instead of by/path. Attached labels follow." },
        rotate: { type: "number", description: "Turn the element by this many DEGREES, counter-clockwise, about `pivot` (default: its own centre) — e.g. {\"move\": {\"target\": [\"slice_3\"], \"rotate\": 180, \"duration\": 1}} flips a slice. Combine with by/to to slide and turn at once." },
        pivot: { type: "array", items: { type: "number" }, minItems: 2, maxItems: 2, description: "With rotate: the point to turn about, in current coordinates (same units as by). Omit for the element's centre." },
```

and change the `move` description's first sentence to: `"Translate and/or rotate elements: by a delta, to a destination, along a path, or by rotate degrees. Attached labels FOLLOW a translation (they do not rotate); intersection points, regions and other derived elements do not — redraw those."` In `semanticErrors` add, next to the other per-command checks:

```ts
    if (cmd.move !== undefined && cmd.move.by === undefined && cmd.move.to === undefined && (cmd.move.path === undefined || cmd.move.path.length === 0) && cmd.move.rotate === undefined) {
      errors.push(`commands[${i}]: move needs one of by, to, path or rotate`);
    }
```

Also update the compiler prompt's `move` bullet in `src/llm/prompts/compiler-v1.md` (line 62) — replace the sentence "IMPORTANT: `move` translates ONLY the listed elements — attached labels, intersection points, guide lines, and regions do NOT follow." with "`rotate: 90` turns the element (degrees, counter-clockwise) about `pivot` (default its centre); `to: [x, y]` sends its centre to a point. Attached labels follow a translation; intersection points, guide lines and regions do NOT — redraw those." Keep the rest of the bullet.

- [ ] **Step 6: Write the failing plan tests**

Append to the `describe("move", …)` block in `tests/plan.test.ts`:

```ts
  test("rotate records a turn in the state and emits a transform step", () => {
    const plan = planCommands([{ draw: ["demand_curve"] }, { move: { target: ["demand_curve"], rotate: 90 } }], allIds, {
      bboxOf: (id) => (id === "demand_curve" ? { x: 100, y: 100, w: 200, h: 100 } : null),
    });
    const step = plan.steps[1] as Extract<PlanStep, { kind: "transform" }>;
    expect(step.kind).toBe("transform");
    expect(step.items).toHaveLength(1);
    expect(step.items[0].to.turn.deg).toBe(90);
    expect(step.items[0].to.turn.pivot).toEqual([200, 150]); // the bbox centre, original frame
    expect(plan.states[1].turns.demand_curve).toEqual({ deg: 90, pivot: [200, 150] });
    expect(plan.states[1].offsets.demand_curve ?? [0, 0]).toEqual([0, 0]);
  });
  test("to moves the centre to the destination (a delta from the current centre)", () => {
    const plan = planCommands([{ draw: ["demand_curve"] }, { move: { target: ["demand_curve"], to: [400, 300] } }], allIds, {
      bboxOf: (id) => (id === "demand_curve" ? { x: 100, y: 100, w: 200, h: 100 } : null),
    });
    expect(plan.states[1].offsets.demand_curve).toEqual([200, 150]);
  });
  test("attached labels follow a translation but not a rotation", () => {
    const plan = planCommands(
      [{ draw: ["demand_curve", "label_D"] }, { move: { target: ["demand_curve"], by: [10, 0], rotate: 45 } }],
      allIds,
      { bboxOf: () => ({ x: 0, y: 0, w: 10, h: 10 }), attachedTo: (id) => (id === "demand_curve" ? ["label_D"] : []) },
    );
    expect(plan.states[1].offsets.label_D).toEqual([10, 0]);
    expect(plan.states[1].turns.label_D).toBeUndefined();
    expect(plan.states[1].turns.demand_curve?.deg).toBe(45);
  });
  test("move with neither by, to, path nor rotate is skipped with a warning", () => {
    const plan = planCommands([{ move: { target: ["axes"] } }], ["axes"]);
    expect(plan.steps.filter((s) => s.kind === "move" || s.kind === "transform")).toHaveLength(0);
    expect(plan.warnings.join(" ")).toMatch(/move/);
  });
```

- [ ] **Step 7: Run them to see them fail**

Run: `npx vitest run tests/plan.test.ts`
Expected: FAIL (turns undefined / no transform kind).

- [ ] **Step 8: Implement the planner side**

In `src/render/plan.ts`:

1. Import: `import { composeTurn, poseCentre, type Turn } from "./pose";`
2. `SceneState` gains `/** Cumulative rotation per turned id: degrees about a pivot in the element's ORIGINAL frame. */ turns: Record<string, Turn>;` and `INITIAL_STATE` gets `turns: {}`.
3. The step union gains `| { kind: "transform"; items: TransformItem[]; seconds: number; easing: Easing }` and export `export interface TransformItem { id: string; from: { offset: Pt; turn: Turn }; to: { offset: Pt; turn: Turn } }`.
4. `PlanOptions` gains `/** Ids that ride along with an element's translation: its attached labels and their leaders. */ attachedTo?: (id: string) => string[];`
5. Keep a `const turns: Record<string, Turn> = {};` beside `offsets`; include `turns: { ...turns }` in every `states.push`.
6. Replace the move branch with:

```ts
    } else if (cmd.move !== undefined) {
      const ids = resolveIds(cmd.move.target, "move");
      for (const id of ids) {
        if (!visibleSet.has(id)) warnings.push(`move target "${id}" is not visible at that point (still moved)`);
      }
      const hasPath = cmd.move.path !== undefined && cmd.move.path.length > 0;
      const hasBy = cmd.move.by !== undefined;
      const hasTo = cmd.move.to !== undefined;
      const hasRotate = cmd.move.rotate !== undefined && cmd.move.rotate !== 0;
      if (ids.length === 0 || (!hasPath && !hasBy && !hasTo && !hasRotate)) {
        if (!hasPath && !hasBy && !hasTo && !hasRotate) warnings.push("move command needs one of by, to, path or rotate — skipped");
        continue;
      }
      const seconds = cmd.move.duration ?? 1;
      const easing = cmd.move.easing ?? "ease-in-out";
      const followers = (id: string): string[] => (opts.attachedTo?.(id) ?? []).filter((f) => known.has(f) && !ids.includes(f));
      if (!hasRotate && !hasTo) {
        // Plain translation, possibly along waypoints: the move step as before, followers included.
        const rawPath = hasPath ? cmd.move.path! : [cmd.move.by!];
        const path = rawPath.map((d) => deltaToLogical(d as Pt));
        const [fx, fy] = path[path.length - 1];
        const moving = [...new Set([...ids, ...ids.flatMap(followers)])];
        for (const id of moving) {
          const [ox, oy] = offsets[id] ?? [0, 0];
          offsets[id] = [ox + fx, oy + fy];
        }
        pushStep({ kind: "move", ids: moving, path, seconds, easing });
      } else {
        // A pose change: per-id from/to, tweened together.
        const items: TransformItem[] = [];
        for (const id of ids) {
          const box = bboxOf(id);
          const offset0: Pt = offsets[id] ?? [0, 0];
          const turn0 = turns[id];
          let offset: Pt = offset0;
          let turn: Turn | undefined = turn0;
          let delta: Pt = [0, 0];
          if (hasTo && box) {
            const centre = poseCentre(box, offset0, turn0);
            const dest = toLogical(cmd.move.to as Pt);
            delta = [dest[0] - centre[0], dest[1] - centre[1]];
          } else if (hasBy) {
            delta = deltaToLogical(cmd.move.by as Pt);
          } else if (hasPath) {
            delta = deltaToLogical(cmd.move.path![cmd.move.path!.length - 1] as Pt);
          }
          offset = [offset[0] + delta[0], offset[1] + delta[1]];
          if (hasRotate) {
            const pivotNow: Pt = cmd.move.pivot ? toLogical(cmd.move.pivot as Pt) : box ? poseCentre(box, offset, turn0) : [offset[0], offset[1]];
            const c = composeTurn(offset, turn0, cmd.move.rotate!, pivotNow);
            offset = c.offset;
            turn = c.turn;
          }
          items.push({ id, from: { offset: offset0, turn: turn0 ?? { deg: 0, pivot: [0, 0] } }, to: { offset, turn: turn ?? { deg: 0, pivot: [0, 0] } } });
          offsets[id] = offset;
          if (turn) turns[id] = turn;
          for (const f of followers(id)) {
            const o: Pt = offsets[f] ?? [0, 0];
            const next: Pt = [o[0] + delta[0], o[1] + delta[1]];
            items.push({ id: f, from: { offset: o, turn: turns[f] ?? { deg: 0, pivot: [0, 0] } }, to: { offset: next, turn: turns[f] ?? { deg: 0, pivot: [0, 0] } } });
            offsets[f] = next;
          }
        }
        pushStep({ kind: "transform", items, seconds, easing });
      }
    }
```

`known`, `bboxOf`, `toLogical`, `deltaToLogical`, `pushStep`, `visibleSet`, `offsets` already exist in scope (read the function; keep their names). If `PlanStep` kinds are matched exhaustively anywhere (`switch` with a `never` default), add the new kind there.

- [ ] **Step 9: Run the plan tests**

Run: `npx vitest run tests/plan.test.ts tests/pose.test.ts`
Expected: PASS.

- [ ] **Step 10: Backend and player**

`src/render/backend.ts` — add to `RenderedElement` after `setOffset`:

```ts
  /**
   * Persistent pose: translate by (dx, dy) after rotating by `deg`
   * (counter-clockwise, y-up) about `pivot` in the element's ORIGINAL frame
   * (design §2.1). setOffset(dx, dy) is setTransform(dx, dy, 0, [0, 0]).
   */
  setTransform?(dx: number, dy: number, deg: number, pivot: Pt): void;
```

`src/render/svg-backend.ts` — replace the `setOffset` method of the element handle class with:

```ts
  /** Persistent translation, logical units y-up (the y-flip happens here). */
  setOffset(dx: number, dy: number): void {
    this.setTransform(dx, dy, 0, [0, 0]);
  }

  /** Pose: SVG rotates clockwise in y-down, so a y-up counter-clockwise `deg` is `rotate(-deg)` about the flipped pivot; rotate first, then translate. */
  setTransform(dx: number, dy: number, deg: number, pivot: Pt): void {
    const parts: string[] = [];
    if (dx !== 0 || dy !== 0) parts.push(`translate(${dx.toFixed(1)} ${(-dy).toFixed(1)})`);
    if (deg !== 0) parts.push(`rotate(${(-deg).toFixed(2)} ${pivot[0].toFixed(1)} ${(CANVAS.h - pivot[1]).toFixed(1)})`);
    for (const g of this.groups) {
      if (parts.length === 0) g.removeAttribute("transform");
      else g.setAttribute("transform", parts.join(" "));
    }
  }
```

(`CANVAS` and `Pt` are already imported in svg-backend.ts — check; import from `../layout/canvas` / `../layout/model` if not.)

`src/render/player.ts`:

1. `applyScene`: replace `el.setOffset?.(dx, dy);` with
```ts
      const turn = scene.turns[id];
      if (turn && el.setTransform) el.setTransform(dx, dy, turn.deg, turn.pivot);
      else el.setOffset?.(dx, dy);
```
2. Add a `case "transform":` beside `case "move":`:
```ts
      case "transform": {
        const ease = EASINGS[step.easing];
        const items = step.items.map((it) => ({ it, el: this.elements.get(it.id) })).filter((x) => x.el?.setTransform || x.el?.setOffset);
        await this.progress(step.seconds * 1000, signal, (t) => {
          const e = ease(t);
          for (const { it, el } of items) {
            const dx = it.from.offset[0] + (it.to.offset[0] - it.from.offset[0]) * e;
            const dy = it.from.offset[1] + (it.to.offset[1] - it.from.offset[1]) * e;
            const deg = it.from.turn.deg + (it.to.turn.deg - it.from.turn.deg) * e;
            const pivot = it.to.turn.pivot;
            if (el!.setTransform) el!.setTransform(dx, dy, deg, pivot);
            else el!.setOffset!(dx, dy);
          }
        });
        return;
      }
```
3. The scroll tween (~line 1050) that reads `before.offsets` / `after.offsets` is unchanged (windows never turn).

- [ ] **Step 11: Wire `attachedTo` in `src/render/index.ts`**

Where `planCommands(spec.commands, layout.order, { … })` is called, add:

```ts
    attachedTo: (id) => {
      const out: string[] = [];
      for (const el of spec.elements ?? []) if (el.type === "label" && el.attach_to === id) out.push(el.id, `${el.id}_leader`);
      if (layout.order.includes(`label_${id}`)) out.push(`label_${id}`, `label_${id}_leader`);
      return out.filter((x) => layout.order.includes(x));
    },
```

- [ ] **Step 12: Schema test + type-check**

Append to `tests/schema.test.ts` (find its `describe` for commands; add a small describe if none):

```ts
describe("move: rotate / to / pivot", () => {
  const base = (move: object) => ({ elements: [{ id: "a", type: "path", points: [[0, 0], [10, 10]] }], commands: [{ draw: ["a"] }, { move }] });
  test("rotate alone is a valid move", () => {
    expect(validateSpec(base({ target: ["a"], rotate: 90 })).ok).toBe(true);
  });
  test("to with a pivot is valid", () => {
    expect(validateSpec(base({ target: ["a"], to: [500, 300], rotate: -45, pivot: [500, 300] })).ok).toBe(true);
  });
  test("a move with none of by/to/path/rotate is rejected", () => {
    const v = validateSpec(base({ target: ["a"] }));
    expect(v.ok).toBe(false);
    expect(v.errors.join(" ")).toMatch(/by, to, path or rotate/);
  });
});
```

Run: `npx vitest run tests/schema.test.ts tests/plan.test.ts tests/pose.test.ts && npx tsc --noEmit`
Expected: PASS, tsc clean.

- [ ] **Step 13: Report** — list the files changed and any exhaustive-switch sites you had to touch. Do not commit.

---

### Task 2: Primitives — `sector`, `arc`, `polygon`, and the `pieces` generator

**Files:**
- Modify: `src/spec/types.ts` (`ElementType` union near line 60, `SpecElement` fields ~68-130)
- Modify: `src/spec/schema.ts:74` (type enum) and the element properties block (~128-146)
- Modify: `src/layout/tier2.ts` (dispatch ~120-199; new functions at the end), `Tier2Result` (~30-45)
- Modify: `src/layout/layout.ts` (`LayoutResult` ~19-32; the tier-2 merge ~84-100)
- Modify: `src/llm/prompts/compiler-v1.md:14` (the tier-2 element list)
- Test: `tests/primitives.test.ts` (new)

**Interfaces:**
- Produces: element types `"sector" | "arc" | "polygon" | "pieces"`; `SpecElement` fields `from?: number; to?: number; sides?: number; rotation?: number; n?: number; kind?` (kind reuses the existing `AnnotationKind`-typed field? NO — `kind` is typed `AnnotationKind`; use a NEW field `of?: "sectors"` for pieces, matching the `of` field portraits use for strings — check that `of?: string` exists on SpecElement and reuse it); `LayoutResult.pieces: Record<string, PieceGeometry>` with `export interface PieceGeometry { apex: Pt; centroid: Pt; midAngle: number; halfAngle: number; radius: number }`; `LayoutResult.pieceGroups: Record<string, string[]>` (parent id → child ids in order); piece drawable ids `<id>_<k>` (1-based) added to `Tier2Result.extraOrder` and NOT the parent id.
- Consumes: nothing. Task 3 reads `pieces` and `pieceGroups` through plan options.

- [ ] **Step 1: Write the failing layout tests**

Create `tests/primitives.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { layoutSpec, elementRings } from "../src/layout/layout";
import type { Spec } from "../src/spec/types";
import { validateSpec } from "../src/spec/schema";

const spec = (elements: unknown[]): Spec => ({ elements, commands: [] }) as unknown as Spec;

describe("sector / arc / polygon", () => {
  test("a sector is a closed outline with a wash, anchored at its centroid", () => {
    const out = layoutSpec(spec([{ id: "s", type: "sector", x: 500, y: 375, radius: 100, from: 0, to: 90, style: { fill: "#f2c14e" } }]));
    expect(out.warnings).toEqual([]);
    expect(out.order).toContain("s");
    const rings = elementRings(out);
    expect(rings.get("s")?.length).toBeGreaterThan(0);
    const box = out.drawables.flatMap((d) => (d.id === "s" || d.id.startsWith("s_") ? [d] : []));
    expect(box.length).toBeGreaterThan(0);
  });
  test("an arc is a stroke only — no closed outline", () => {
    const out = layoutSpec(spec([{ id: "a", type: "arc", x: 500, y: 375, radius: 100, from: 0, to: 180 }]));
    expect(out.warnings).toEqual([]);
    expect(elementRings(out).has("a")).toBe(false);
  });
  test("a regular polygon from sides + radius, and an explicit polygon from points", () => {
    const out = layoutSpec(spec([
      { id: "hex", type: "polygon", x: 300, y: 300, radius: 80, sides: 6 },
      { id: "tri", type: "polygon", points: [[600, 300], [700, 300], [650, 380]] },
    ]));
    expect(out.warnings).toEqual([]);
    const rings = elementRings(out);
    expect(rings.get("hex")?.[0]).toHaveLength(6);
    expect(rings.get("tri")?.[0]).toHaveLength(3);
  });
  test("the schema accepts them and rejects a sector without a radius", () => {
    expect(validateSpec({ elements: [{ id: "s", type: "sector", x: 1, y: 1, radius: 5, from: 0, to: 30 }], commands: [] }).ok).toBe(true);
    expect(validateSpec({ elements: [{ id: "s", type: "sector", x: 1, y: 1, from: 0, to: 30 }], commands: [] }).ok).toBe(false);
  });
});

describe("pieces", () => {
  const out = layoutSpec(spec([{ id: "kake", type: "pieces", of: "sectors", x: 300, y: 375, radius: 120, n: 12 }]));
  test("emits n addressable sector groups, not the parent id", () => {
    expect(out.warnings).toEqual([]);
    for (let k = 1; k <= 12; k++) expect(out.order).toContain(`kake_${k}`);
    expect(out.order).not.toContain("kake");
    expect(out.pieceGroups.kake).toEqual(Array.from({ length: 12 }, (_, i) => `kake_${i + 1}`));
  });
  test("records each piece's geometry: apex at the centre, mid-angle stepping by 360/n, half-angle 15°", () => {
    const p1 = out.pieces.kake_1;
    expect(p1.apex).toEqual([300, 375]);
    expect(p1.radius).toBe(120);
    expect(p1.halfAngle).toBeCloseTo(15, 6);
    expect(p1.midAngle).toBeCloseTo(15, 6);
    expect(out.pieces.kake_2.midAngle).toBeCloseTo(45, 6);
    expect(p1.centroid[0]).toBeGreaterThan(300);
  });
  test("every piece has a closed outline for hit-testing and the identify drill", () => {
    const rings = elementRings(out);
    for (let k = 1; k <= 12; k++) expect(rings.get(`kake_${k}`)?.length).toBeGreaterThan(0);
  });
  test("pieces are valid in the schema, and n is required", () => {
    expect(validateSpec({ elements: [{ id: "p", type: "pieces", of: "sectors", x: 1, y: 1, radius: 5, n: 4 }], commands: [] }).ok).toBe(true);
    expect(validateSpec({ elements: [{ id: "p", type: "pieces", of: "sectors", x: 1, y: 1, radius: 5 }], commands: [] }).ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run tests/primitives.test.ts`
Expected: FAIL (unknown element types / schema rejects).

- [ ] **Step 3: Types and schema**

`src/spec/types.ts`: add `"sector" | "arc" | "polygon" | "pieces"` to the `ElementType` union; add to `SpecElement`:

```ts
  // sector / arc / polygon / pieces (design §2.2)
  /** sector/arc: start angle in degrees, counter-clockwise from +x. */
  from?: number;
  /** sector/arc: end angle in degrees. */
  to?: number;
  /** polygon: number of sides of a regular polygon (with radius, x, y). */
  sides?: number;
  /** polygon: rotation of a regular polygon in degrees. */
  rotation?: number;
  /** pieces: how many pieces. */
  n?: number;
```

If `SpecElement` already has `from`/`to` for another element (search first), reuse and widen the doc comment instead of redeclaring. `of?: string` exists for portraits/sources — reuse it for `pieces` (`of: "sectors"`).

`src/spec/schema.ts`: extend the enum at line 74 with `"sector", "arc", "polygon", "pieces"`; in the element properties add:

```ts
    // sector / arc / polygon / pieces
    from: { type: "number", description: "sector/arc: start angle in degrees, counter-clockwise from +x (0 = right, 90 = up)." },
    to: { type: "number", description: "sector/arc: end angle in degrees." },
    sides: { type: "integer", minimum: 3, description: "polygon: sides of a REGULAR polygon centred at x,y with radius — instead of points." },
    rotation: { type: "number", description: "polygon: turn a regular polygon by this many degrees." },
    n: { type: "integer", minimum: 2, maximum: 128, description: "pieces: how many pieces to cut — e.g. 12 sectors of a circle. Each becomes its own element <id>_1 … <id>_n that move, arrange and highlight can name; `draw: [\"<id>\"]` draws them all." },
```

Update the `of` description to mention `pieces: "sectors"` and the `radius`/`x`/`y` descriptions to include the new types. Add semantic checks in `semanticErrors` (element loop): a `sector`/`arc` needs numeric `radius`, `from`, `to`; a `polygon` needs `points` (≥ 3) or `sides` + `radius`; `pieces` needs `of === "sectors"`, numeric `radius` and `n`. Error text pattern: `element "${el.id}": sector needs radius, from and to`.

- [ ] **Step 4: Layout**

`src/layout/tier2.ts`: add cases in the dispatch:

```ts
      case "sector":
        drawables.push(...sectorDrawables(el, ctx));
        break;
      case "arc":
        drawables.push(arcDrawable(el, ctx));
        break;
      case "polygon":
        drawables.push(...polygonDrawables(el, ctx));
        break;
      case "pieces":
        drawables.push(...piecesDrawables(el, ctx));
        break;
```

and the functions (at the end of the file; follow `shapeDrawable`'s use of `resolveStyle` / `resolveDrawOpts`, `Z_AREA` / `Z_STROKE`, and how it makes a wash + outline pair — read `shapeDrawable` first and mirror its ids: outline gets the element id, the wash `${id}_fill`; `SUB_SUFFIXES` in `layout/model.ts` must include `fill` — check, add if absent):

```ts
const DEG = Math.PI / 180;

function sectorPts(c: Pt, r: number, from: number, to: number, steps = 24): Pt[] {
  const pts: Pt[] = [c];
  for (let i = 0; i <= steps; i++) {
    const a = (from + ((to - from) * i) / steps) * DEG;
    pts.push([c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)]);
  }
  return pts;
}

function arcPts(c: Pt, r: number, from: number, to: number, steps = 32): Pt[] {
  const pts: Pt[] = [];
  for (let i = 0; i <= steps; i++) {
    const a = (from + ((to - from) * i) / steps) * DEG;
    pts.push([c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)]);
  }
  return pts;
}

/** A closed outline with a wash, the pair every filled primitive is made of. */
function filledOutline(id: string, pts: Pt[], el: SpecElement, ctx: Ctx): Drawable[] {
  const style = resolveStyle(el.style);
  const out: Drawable[] = [];
  if (style.fill) out.push({ id: `${id}_fill`, kind: "area", pts, z: Z_AREA, style: { ...style, opacity: style.opacity ?? 0.35 }, drawOpts: resolveDrawOpts(el.draw, { mode: "sketch", duration: SKETCH_MS.area }) });
  out.push({ id, kind: "stroke", pts, closed: true, z: Z_STROKE, style, drawOpts: resolveDrawOpts(el.draw) });
  return out;
}
```

(Read `AreaDrawable`/`StrokeDrawable` in `layout/model.ts` and `SKETCH_MS` in `layout/canvas.ts` for the exact field names; if `style.opacity` is not a field, drop that override and let the wash use the default area opacity the way `regionDrawable` does.)

```ts
function sectorDrawables(el: SpecElement, ctx: Ctx): Drawable[] {
  const c: Pt = [el.x ?? CANVAS.w / 2, el.y ?? CANVAS.h / 2];
  const pts = sectorPts(c, el.radius ?? 100, el.from ?? 0, el.to ?? 90);
  const mid = ((el.from ?? 0) + (el.to ?? 90)) / 2;
  ctx.anchors[el.id] = [c[0] + (el.radius ?? 100) * 0.6 * Math.cos(mid * DEG), c[1] + (el.radius ?? 100) * 0.6 * Math.sin(mid * DEG)];
  return filledOutline(el.id, pts, el, ctx);
}

function arcDrawable(el: SpecElement, ctx: Ctx): Drawable {
  const c: Pt = [el.x ?? CANVAS.w / 2, el.y ?? CANVAS.h / 2];
  const pts = arcPts(c, el.radius ?? 100, el.from ?? 0, el.to ?? 180);
  ctx.anchors[el.id] = pts[Math.floor(pts.length / 2)];
  return { id: el.id, kind: "stroke", pts, z: Z_STROKE, style: resolveStyle(el.style), drawOpts: resolveDrawOpts(el.draw) };
}

function polygonDrawables(el: SpecElement, ctx: Ctx): Drawable[] {
  let pts: Pt[];
  if (el.points && el.points.length >= 3) pts = el.points as Pt[];
  else {
    const c: Pt = [el.x ?? CANVAS.w / 2, el.y ?? CANVAS.h / 2];
    const n = Math.max(3, Math.round(el.sides ?? 5));
    const r = el.radius ?? 100;
    const rot = (el.rotation ?? 0) * DEG;
    pts = Array.from({ length: n }, (_, i): Pt => {
      const a = rot + Math.PI / 2 + (2 * Math.PI * i) / n; // first vertex on top
      return [c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)];
    });
  }
  const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length;
  const cy = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  ctx.anchors[el.id] = [cx, cy];
  return filledOutline(el.id, pts, el, ctx);
}

function piecesDrawables(el: SpecElement, ctx: Ctx): Drawable[] {
  const c: Pt = [el.x ?? CANVAS.w / 2, el.y ?? CANVAS.h / 2];
  const r = el.radius ?? 120;
  const n = Math.max(2, Math.round(el.n ?? 8));
  const step = 360 / n;
  const out: Drawable[] = [];
  const ids: string[] = [];
  for (let k = 0; k < n; k++) {
    const id = `${el.id}_${k + 1}`;
    const from = k * step;
    const to = (k + 1) * step;
    const pts = sectorPts(c, r, from, to);
    const mid = (from + to) / 2;
    const centroid: Pt = [c[0] + r * 0.6 * Math.cos(mid * DEG), c[1] + r * 0.6 * Math.sin(mid * DEG)];
    out.push({ id, kind: "group", children: filledOutline(id, pts, el, ctx), z: Z_STROKE, style: resolveStyle(el.style), drawOpts: resolveDrawOpts(el.draw) });
    ctx.anchors[id] = centroid;
    ctx.pieces[id] = { apex: c, centroid, midAngle: mid, halfAngle: step / 2, radius: r };
    ids.push(id);
    ctx.extraOrder.push(id);
  }
  ctx.pieceGroups[el.id] = ids;
  ctx.anchors[el.id] = c;
  return out;
}
```

(Read `GroupDrawable` in `layout/model.ts` for its exact required fields — if a group has no `style`/`drawOpts`, omit them; nested ids inside the group are `${id}` and `${id}_fill`, which the validator's uniqueness check must accept — they are distinct per piece.) Extend `Ctx` with `pieces: Record<string, PieceGeometry>` and `pieceGroups: Record<string, string[]>` (initialised `{}` where `ctx` is built), and `Tier2Result` with the same two fields, exported `PieceGeometry` from tier2.ts.

`src/layout/layout.ts`: `LayoutResult` gains `pieces: Record<string, PieceGeometry>; pieceGroups: Record<string, string[]>;` (empty objects when there are no elements); in the tier-2 merge copy them from `tier2`; in the order loop skip `el.type === "pieces"` the way `code` with `show: "none"` is skipped (the children are already in `extraOrder`). Every other place that constructs a `LayoutResult` literal (search `warnings: []` / `windows:` across src and tests) gets `pieces: {}, pieceGroups: {}` — tsc will list them.

- [ ] **Step 5: Run the tests and tsc**

Run: `npx vitest run tests/primitives.test.ts tests/schema.test.ts tests/examples.test.ts && npx tsc --noEmit`
Expected: PASS; tsc clean (fix every `LayoutResult` literal it flags).

- [ ] **Step 6: Prompt**

In `src/llm/prompts/compiler-v1.md` line 14, after "`annotation` (a hand-drawn mark on another element — see below)" add: ", and the geometric primitives `sector` (x, y, radius, from, to — degrees counter-clockwise from +x), `arc` (same, a stroke), `polygon` (`points`, or `sides` + `radius` for a regular one) and `pieces` (`of: \"sectors\"`, x, y, radius, n — cuts a circle into n sectors `<id>_1 … <id>_n`, each its own element, `draw: [\"<id>\"]` draws them all). Give filled primitives a `style.fill`; these are the pieces the `move` (rotate) and `arrange` verbs act on — a circle cut into pieces and zipped into a rectangle is `pieces` + `arrange: {layout: \"zipper\"}`."

- [ ] **Step 7: Report** — files changed, the `LayoutResult` literals you had to extend. Do not commit.

---

### Task 3: The `arrange` verb (depends on Tasks 1 and 2)

**Files:**
- Modify: `src/spec/types.ts` (`Command` gains `arrange?: ArrangeArgs`; new interface), `src/spec/schema.ts` (command schema + `ACTION_VERBS` + verb-count validation)
- Modify: `src/render/plan.ts` (`PlanOptions.pieceOf`, `PlanOptions.expandId`; the `arrange` branch; `resolveIds` expansion)
- Modify: `src/render/index.ts` (pass `pieceOf` and `expandId` from `layout.pieces` / `layout.pieceGroups`)
- Modify: `src/lint/lint.ts` if it enumerates verbs (search for `"move"` there)
- Modify: `src/llm/prompts/compiler-v1.md` (verb list line 31 + a new `arrange` bullet after `move`)
- Create: `src/render/arrange.ts` (pure layout math)
- Test: `tests/arrange.test.ts` (new), `tests/plan.test.ts` (id expansion)

**Interfaces:**
- Consumes: `TransformItem`, `composeTurn`, `poseCentre`, `Turn` (Task 1); `LayoutResult.pieces`, `LayoutResult.pieceGroups`, `PieceGeometry` (Task 2).
- Produces: `export interface ArrangeArgs { target: string[] | string; layout: "row" | "zipper" | "grid" | "ring" | "stack"; at?: [number, number]; gap?: number; columns?: number; duration?: number; easing?: Easing }`; `export function arrangeTargets(items: ArrangeInput[], layout: ArrangeArgs["layout"], opts: { at?: Pt; gap: number; columns?: number }): ArrangeOutput[]` in `src/render/arrange.ts` where `ArrangeInput = { id: string; box: BBox; centre: Pt; piece?: PieceGeometry; pose: { offset: Pt; turn: Turn | undefined } }` and `ArrangeOutput = { id: string; centre?: Pt; rotate?: number; pivotNow?: Pt; apexTo?: Pt }`.

- [ ] **Step 1: Write the failing arrange-math tests**

Create `tests/arrange.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { arrangeTargets } from "../src/render/arrange";

const box = (x: number, y: number, w = 40, h = 20) => ({ x, y, w, h });
const item = (id: string, x: number, y: number) => ({ id, box: box(x, y), centre: [x + 20, y + 10] as [number, number], pose: { offset: [0, 0] as [number, number], turn: undefined } });

describe("row / stack / grid / ring", () => {
  test("row lays boxes left to right with the gap, centred on at", () => {
    const out = arrangeTargets([item("a", 0, 0), item("b", 500, 500), item("c", 100, 300)], "row", { at: [500, 375], gap: 10 });
    // total width 3*40 + 2*10 = 140 → starts at 430
    expect(out.map((o) => o.centre)).toEqual([[450, 375], [500, 375], [550, 375]]);
    expect(out.every((o) => o.rotate === undefined)).toBe(true);
  });
  test("stack goes bottom to top", () => {
    const out = arrangeTargets([item("a", 0, 0), item("b", 0, 0)], "stack", { at: [500, 375], gap: 10 });
    expect(out.map((o) => o.centre)).toEqual([[500, 360], [500, 390]]);
  });
  test("grid wraps at columns", () => {
    const out = arrangeTargets([item("a", 0, 0), item("b", 0, 0), item("c", 0, 0)], "grid", { at: [500, 375], gap: 10, columns: 2 });
    expect(out[0].centre![1]).toBe(out[1].centre![1]);
    expect(out[2].centre![1]).toBeLessThan(out[0].centre![1]);
  });
  test("ring spaces centres evenly around at", () => {
    const out = arrangeTargets([item("a", 0, 0), item("b", 0, 0), item("c", 0, 0), item("d", 0, 0)], "ring", { at: [500, 375], gap: 10 });
    const r = Math.hypot(out[0].centre![0] - 500, out[0].centre![1] - 375);
    for (const o of out) expect(Math.hypot(o.centre![0] - 500, o.centre![1] - 375)).toBeCloseTo(r, 6);
  });
  test("with no at, the arrangement is centred on the targets' current centroid", () => {
    const out = arrangeTargets([item("a", 0, 0), item("b", 100, 0)], "row", { gap: 0 });
    const mid = (out[0].centre![0] + out[1].centre![0]) / 2;
    expect(mid).toBeCloseTo(70, 6); // centres at 20 and 120 → centroid 70
  });
});

describe("zipper", () => {
  const piece = (k: number, n: number) => {
    const step = 360 / n;
    const mid = (k + 0.5) * step;
    return { id: `p_${k + 1}`, box: box(0, 0), centre: [0, 0] as [number, number], pose: { offset: [0, 0] as [number, number], turn: undefined }, piece: { apex: [300, 375] as [number, number], centroid: [0, 0] as [number, number], midAngle: mid, halfAngle: step / 2, radius: 120 } };
  };
  test("alternates pieces up and down along a line, apexes stepping by r·sin(halfAngle), rotated about the apex", () => {
    const n = 12;
    const out = arrangeTargets(Array.from({ length: n }, (_, k) => piece(k, n)), "zipper", { at: [600, 375], gap: 0 });
    const s = 120 * Math.sin((15 * Math.PI) / 180);
    expect(out[1].apexTo![0] - out[0].apexTo![0]).toBeCloseTo(s, 6);
    expect(out[0].apexTo![1]).toBeCloseTo(375 - 60, 6); // even: apex below the line, pointing up
    expect(out[1].apexTo![1]).toBeCloseTo(375 + 60, 6); // odd: apex above, pointing down
    expect(out[0].rotate).toBeCloseTo(90 - 15, 6); // mid-angle 15° → 90°
    expect(out[1].rotate).toBeCloseTo(-90 - 45, 6); // mid-angle 45° → -90°
    expect(out[0].pivotNow).toEqual([300, 375]);
    // the row is centred on at.x
    const xs = out.map((o) => o.apexTo![0]);
    expect((Math.min(...xs) + Math.max(...xs)) / 2).toBeCloseTo(600, 6);
  });
  test("an element without piece geometry falls back to row placement", () => {
    const out = arrangeTargets([item("a", 0, 0), item("b", 0, 0)], "zipper", { at: [500, 375], gap: 10 });
    expect(out.map((o) => o.centre)).toEqual([[475, 375], [525, 375]]);
  });
});
```

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run tests/arrange.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/render/arrange.ts`**

```ts
// The arrange verb's geometry (design §2.3): where each target should end
// up, from its current box and, for sectors, its piece geometry. Pure —
// the planner turns the outputs into poses.
import type { BBox } from "../layout/geometry";
import type { Pt } from "../layout/model";
import type { PieceGeometry } from "../layout/tier2";
import type { Turn } from "./pose";

export interface ArrangeInput {
  id: string;
  /** Current bounding box (already offset). */
  box: BBox;
  /** Current centre. */
  centre: Pt;
  piece?: PieceGeometry;
  pose: { offset: Pt; turn: Turn | undefined };
}

export interface ArrangeOutput {
  id: string;
  /** Destination for the element's centre (row/stack/grid/ring, or a non-sector in a zipper). */
  centre?: Pt;
  /** Zipper: rotate by this many degrees about pivotNow (the apex, current coordinates)… */
  rotate?: number;
  pivotNow?: Pt;
  /** …then move so the apex lands here. */
  apexTo?: Pt;
}

const DEG = Math.PI / 180;

function centroidOf(items: ArrangeInput[]): Pt {
  const n = Math.max(1, items.length);
  return [items.reduce((s, i) => s + i.centre[0], 0) / n, items.reduce((s, i) => s + i.centre[1], 0) / n];
}

export function arrangeTargets(items: ArrangeInput[], layout: "row" | "zipper" | "grid" | "ring" | "stack", opts: { at?: Pt; gap: number; columns?: number }): ArrangeOutput[] {
  const at = opts.at ?? centroidOf(items);
  const gap = opts.gap;
  if (layout === "zipper" && items.some((i) => i.piece)) return zipper(items, at);
  if (layout === "row" || layout === "zipper") {
    const total = items.reduce((s, i) => s + i.box.w, 0) + gap * (items.length - 1);
    let x = at[0] - total / 2;
    return items.map((i) => {
      const c: Pt = [x + i.box.w / 2, at[1]];
      x += i.box.w + gap;
      return { id: i.id, centre: c };
    });
  }
  if (layout === "stack") {
    const total = items.reduce((s, i) => s + i.box.h, 0) + gap * (items.length - 1);
    let y = at[1] - total / 2;
    return items.map((i) => {
      const c: Pt = [at[0], y + i.box.h / 2];
      y += i.box.h + gap;
      return { id: i.id, centre: c };
    });
  }
  if (layout === "grid") {
    const cols = Math.max(1, Math.round(opts.columns ?? Math.ceil(Math.sqrt(items.length))));
    const cw = Math.max(...items.map((i) => i.box.w)) + gap;
    const ch = Math.max(...items.map((i) => i.box.h)) + gap;
    const rows = Math.ceil(items.length / cols);
    const x0 = at[0] - (cols * cw - gap) / 2 + (cw - gap) / 2;
    const y0 = at[1] + (rows * ch - gap) / 2 - (ch - gap) / 2; // top row first, y-up
    return items.map((i, k) => ({ id: i.id, centre: [x0 + (k % cols) * cw, y0 - Math.floor(k / cols) * ch] as Pt }));
  }
  // ring
  const perimeter = items.reduce((s, i) => s + Math.max(i.box.w, i.box.h) + gap, 0);
  const r = Math.max(perimeter / (2 * Math.PI), 40);
  return items.map((i, k) => {
    const a = Math.PI / 2 + (2 * Math.PI * k) / items.length;
    return { id: i.id, centre: [at[0] + r * Math.cos(a), at[1] + r * Math.sin(a)] as Pt };
  });
}

/** Sector pieces zipped into the πr² rectangle: even pieces point up with the apex below the midline, odd pieces point down with the apex above it, apexes stepping by r·sin(halfAngle). */
function zipper(items: ArrangeInput[], at: Pt): ArrangeOutput[] {
  const sectors = items.filter((i) => i.piece);
  const others = items.filter((i) => !i.piece);
  const r = sectors[0].piece!.radius;
  const s = r * Math.sin(sectors[0].piece!.halfAngle * DEG);
  const width = s * (sectors.length - 1);
  const x0 = at[0] - width / 2;
  const out: ArrangeOutput[] = sectors.map((i, k) => {
    const up = k % 2 === 0;
    const targetMid = up ? 90 : -90;
    const apexTo: Pt = [x0 + k * s, at[1] + (up ? -r / 2 : r / 2)];
    return { id: i.id, rotate: targetMid - i.piece!.midAngle, pivotNow: i.piece!.apex, apexTo };
  });
  if (others.length > 0) {
    const row = arrangeTargets(others, "row", { at: [at[0], at[1] - r], gap: 10 });
    out.push(...row);
  }
  return out;
}
```

Note: `pivotNow` for a zipper is the piece's apex in its ORIGINAL coordinates; the planner maps it through the piece's current pose before composing (see Step 6). `at` defaults to the targets' current centroid — for a freshly drawn `pieces` circle that is the circle's centre, so the rectangle forms over the circle; the model passes `at` to put it beside.

- [ ] **Step 4: Run the arrange tests**

Run: `npx vitest run tests/arrange.test.ts`
Expected: PASS.

- [ ] **Step 5: Types, schema, prompt**

`src/spec/types.ts`: add

```ts
export interface ArrangeArgs {
  /** Element ids, or ONE pieces id (all its pieces). */
  target: string[] | string;
  layout: "row" | "zipper" | "grid" | "ring" | "stack";
  /** Centre of the arrangement (same units as move.by); default: the targets' current centroid. */
  at?: [number, number];
  /** Space between neighbours, logical units (default 6). */
  gap?: number;
  /** grid: pieces per row. */
  columns?: number;
  /** seconds (default 2) */
  duration?: number;
  easing?: Easing;
}
```

and `arrange?: ArrangeArgs;` on `Command` after `move`. `src/spec/schema.ts`: add `arrange` to the verb list description on the command schema (line ~275) and to `ACTION_VERBS` in `semanticErrors`; add the command property:

```ts
    arrange: {
      type: "object",
      description:
        "Lay the targets out and animate them there — code computes every position and turn. layout: row (left to right), zipper (sector pieces alternately up and down, interleaved into the πr² rectangle), grid, ring, stack. target may be ONE pieces id for all its pieces. at = the centre of the arrangement (default: where the targets are now). {\"arrange\": {\"target\": \"kake\", \"layout\": \"zipper\", \"at\": [650, 375], \"duration\": 3}, \"speak\": \"Now we zip the slices together…\"}",
      properties: {
        target: idListSchema("Element ids, or one pieces id."),
        layout: { type: "string", enum: ["row", "zipper", "grid", "ring", "stack"] },
        at: { type: "array", items: { type: "number" }, minItems: 2, maxItems: 2, description: "Centre of the arrangement (same units as move.by). Default: the targets' current centroid." },
        gap: { type: "number", description: "Space between neighbours in logical units (default 6)." },
        columns: { type: "integer", minimum: 1, description: "grid: pieces per row." },
        duration: { type: "number", description: "Seconds (default 2)." },
        easing: { type: "string", enum: ["linear", "ease-in", "ease-out", "ease-in-out"] },
      },
      required: ["target", "layout"],
      additionalProperties: false,
    },
```

(Copy the exact easing enum from the `move` schema.) `src/lint/lint.ts`: if a verb list exists there (search `"move"`), add `"arrange"`. Prompt `src/llm/prompts/compiler-v1.md`: add `arrange` to the verb list on line 31 and a bullet after the `move` bullet: "- `arrange`: `{\"arrange\": {\"target\": \"kake\", \"layout\": \"zipper\", \"at\": [650, 375], \"duration\": 3}}` — lays the targets out and moves them there, every position and turn computed for you: `row`, `zipper` (sector pieces alternately up and down, interleaved into a rectangle — the πr² proof), `grid` (`columns`), `ring`, `stack`. `target` may be one `pieces` id. Use it instead of writing coordinates into `move`."

- [ ] **Step 6: Planner**

`src/render/plan.ts`: `PlanOptions` gains

```ts
  /** Piece geometry from the layout (the pieces element), by piece id. */
  pieceOf?: (id: string) => PieceGeometry | null;
  /** A pieces id → its piece ids, so one id can name them all. */
  expandId?: (id: string) => string[] | null;
```

`resolveIds` expands: before the `known.has(id)` check, `const kids = opts.expandId?.(id); if (kids && kids.length > 0) return kids.filter((k) => known.has(k));` — the function must therefore `flatMap`, not `filter`. Add the branch after `move`:

```ts
    } else if (cmd.arrange !== undefined) {
      const ids = resolveIds(cmd.arrange.target, "arrange");
      if (ids.length === 0) continue;
      const inputs: ArrangeInput[] = [];
      for (const id of ids) {
        const box = currentBox(id);
        if (!box) {
          warnings.push(`arrange target "${id}" has no geometry (skipped)`);
          continue;
        }
        const pose = { offset: offsets[id] ?? [0, 0], turn: turns[id] };
        const raw = bboxOf(id)!;
        inputs.push({ id, box, centre: poseCentre(raw, pose.offset, pose.turn), piece: opts.pieceOf?.(id) ?? undefined, pose });
      }
      if (inputs.length === 0) continue;
      const at = cmd.arrange.at ? toLogical(cmd.arrange.at as Pt) : undefined;
      const placed = arrangeTargets(inputs, cmd.arrange.layout, { at, gap: cmd.arrange.gap ?? 6, columns: cmd.arrange.columns });
      const items: TransformItem[] = [];
      for (const p of placed) {
        const input = inputs.find((i) => i.id === p.id)!;
        const from = { offset: input.pose.offset, turn: input.pose.turn ?? { deg: 0, pivot: [0, 0] as Pt } };
        let offset: Pt = input.pose.offset;
        let turn: Turn | undefined = input.pose.turn;
        if (p.rotate !== undefined && p.pivotNow && p.apexTo) {
          const pivotNow = poseOf(offset, turn)(p.pivotNow); // the apex where it is now
          const c = composeTurn(offset, turn, p.rotate, pivotNow);
          offset = c.offset;
          turn = c.turn;
          // the apex is the pivot, so it did not move; slide it to apexTo
          offset = [offset[0] + p.apexTo[0] - pivotNow[0], offset[1] + p.apexTo[1] - pivotNow[1]];
        } else if (p.centre) {
          offset = [offset[0] + p.centre[0] - input.centre[0], offset[1] + p.centre[1] - input.centre[1]];
        }
        items.push({ id: p.id, from, to: { offset, turn: turn ?? { deg: 0, pivot: [0, 0] } } });
        offsets[p.id] = offset;
        if (turn) turns[p.id] = turn;
      }
      pushStep({ kind: "transform", items, seconds: cmd.arrange.duration ?? 2, easing: cmd.arrange.easing ?? "ease-in-out" });
    }
```

Imports: `import { arrangeTargets, type ArrangeInput } from "./arrange";`, `poseOf` from `./pose`, `type PieceGeometry` from `../layout/tier2`. `currentBox` exists (~line 223) and must also apply the turn: change it to compute the box of the four rotated corners when `turns[id]` is set (map the corners through `poseOf` and take the bounds).

`src/render/index.ts`: pass `pieceOf: (id) => layout.pieces[id] ?? null, expandId: (id) => layout.pieceGroups[id] ?? null,` to `planCommands`.

- [ ] **Step 7: Planner tests**

Append to `tests/plan.test.ts`:

```ts
describe("arrange", () => {
  const pieces = ["k_1", "k_2", "k_3", "k_4"];
  const opts = {
    bboxOf: (id: string) => (pieces.includes(id) ? { x: 200, y: 300, w: 100, h: 80 } : null),
    expandId: (id: string) => (id === "k" ? pieces : null),
    pieceOf: (id: string) => {
      const k = pieces.indexOf(id);
      return k < 0 ? null : { apex: [300, 375] as [number, number], centroid: [0, 0] as [number, number], midAngle: (k + 0.5) * 90, halfAngle: 45, radius: 120 };
    },
  };
  test("a pieces id expands to its pieces; zipper emits one transform step with a turn per piece", () => {
    const plan = planCommands([{ draw: ["k"] }, { arrange: { target: "k", layout: "zipper", at: [600, 375] } }], pieces, opts);
    expect((plan.steps[0] as { ids: string[] }).ids).toEqual(pieces);
    const step = plan.steps[1] as Extract<PlanStep, { kind: "transform" }>;
    expect(step.kind).toBe("transform");
    expect(step.items.map((i) => i.id)).toEqual(pieces);
    expect(step.items[0].to.turn.deg).toBeCloseTo(90 - 45, 6);
    expect(step.items[1].to.turn.deg).toBeCloseTo(-90 - 135, 6);
    expect(plan.states[1].turns.k_1.deg).toBeCloseTo(45, 6);
  });
  test("row on plain elements is a pure translation to a centred row", () => {
    const plan = planCommands([{ draw: ["a", "b"] }, { arrange: { target: ["a", "b"], layout: "row", at: [500, 375], gap: 20 } }], ["a", "b"], {
      bboxOf: (id) => (id === "a" ? { x: 0, y: 0, w: 100, h: 50 } : { x: 900, y: 700, w: 100, h: 50 }),
    });
    const step = plan.steps[1] as Extract<PlanStep, { kind: "transform" }>;
    expect(step.items[0].to.offset).toEqual([390, 350]); // a's centre (50,25) → (440,375)
    expect(step.items[1].to.offset).toEqual([-390, -350]); // b's centre (950,725) → (560,375)
    expect(step.items.every((i) => i.to.turn.deg === 0)).toBe(true);
  });
});
```

Run: `npx vitest run tests/plan.test.ts tests/arrange.test.ts tests/schema.test.ts && npx tsc --noEmit`
Expected: PASS, tsc clean.

- [ ] **Step 8: Report** — files changed. Do not commit.

---

### Task 4: The `circle_sectors` template and the πr² example

**Files:**
- Modify: `src/scenes/packs/mathlogic.yaml` (append one template document after `plot3d`, separated by `---`)
- Modify: `tests/packs.test.ts:997` (the mathlogic `TEMPLATE_IDS` list gains `"circle_sectors"`)
- Modify: `src/examples.json` (append one example — format-preserving: 2-space indent, the file ends with `\n]\n`; splice the new entry before the final `]`, never re-serialise the file)
- Modify: `src/scenes/packs.ts` (the mathlogic `description` mentions the circle-into-rectangle proof)
- Test: `tests/circle-sectors.test.ts` (new)

**Interfaces:**
- Consumes: nothing from other tasks (uses only the kit).
- Produces: template `circle_sectors` with params `n` (integer 2–64, default 12), `t` (number 0–1, default 0), `show_radius` (boolean, default true), `labels` (boolean, default true), `language` ("en" | "nb", default "en"); element ids `piece_<k>` (1-based), `radius_line`, `label_r`, `label_base`, `label_height`, `caption`.

- [ ] **Step 1: Write the failing template tests**

Create `tests/circle-sectors.test.ts`:

```ts
import { beforeAll, describe, expect, test } from "vitest";
import { ensureEnabledPacks } from "../src/scenes/packs";
import { scenes } from "../src/scenes/registry";
import { layoutSpec, elementRings } from "../src/layout/layout";
import { sliderSpecs } from "../src/ui/tray-model";
import { validateSpec } from "../src/spec/schema";

beforeAll(async () => {
  await ensureEnabledPacks(["mathlogic"]);
});

const lay = (params: Record<string, unknown>) => layoutSpec({ template: "circle_sectors", params, elements: [] } as never);

describe("circle_sectors", () => {
  test("registers, with n and t as sliders", () => {
    expect(scenes.circle_sectors?.manifest.status).toBe("ready");
    expect(sliderSpecs(scenes.circle_sectors.manifest.params_schema).map((s) => s.path).sort()).toEqual(["n", "t"]);
  });
  test("t = 0 is a circle of n outlined pieces around one centre; t = 1 zips them; both lint clean", () => {
    for (const t of [0, 0.5, 1]) {
      const out = lay({ n: 12, t });
      expect(out.warnings, `t=${t}`).toEqual([]);
      expect(out.issues.filter((i) => i.severity === "error"), `t=${t}`).toEqual([]);
      for (let k = 1; k <= 12; k++) expect(out.order).toContain(`piece_${k}`);
      expect(elementRings(out).get("piece_1")?.length).toBeGreaterThan(0);
    }
    const circle = lay({ n: 12, t: 0 });
    const zipped = lay({ n: 12, t: 1 });
    const width = (o: ReturnType<typeof lay>) => {
      const xs = o.drawables.filter((d) => d.id.startsWith("piece_")).flatMap((d) => ("pts" in d ? (d.pts as [number, number][]) : []).map((p) => p[0]));
      return Math.max(...xs) - Math.min(...xs);
    };
    expect(width(zipped)).toBeGreaterThan(width(circle) * 1.3); // the rectangle is ~πr wide, the circle 2r
  });
  test("a fractional n rounds and stays clean (animate interpolates n)", () => {
    const out = lay({ n: 23.4, t: 1 });
    expect(out.warnings).toEqual([]);
    expect(out.order.filter((id) => id.startsWith("piece_"))).toHaveLength(23);
  });
  test("both manifest examples lint clean and the bundled example validates", () => {
    for (const ex of scenes.circle_sectors.manifest.examples) {
      const out = layoutSpec({ template: "circle_sectors", params: ex.params, elements: [] } as never);
      expect(out.warnings, ex.request).toEqual([]);
      expect(out.issues.map((i) => i.message), ex.request).toEqual([]);
    }
    expect(validateSpec({ template: "circle_sectors", params: { n: 12, t: 0 }, commands: [{ draw: ["piece_1"] }, { animate: { t: 1 }, duration: 3 }] }).ok).toBe(true);
  });
});
```

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run tests/circle-sectors.test.ts`
Expected: FAIL — `scenes.circle_sectors` undefined.

- [ ] **Step 3: Write the template**

Append to `src/scenes/packs/mathlogic.yaml` (after the last document; keep a `---` line between documents; the layout body is JavaScript run as `new Function("params", "kit", "engines")`, `kit` per `src/scenes/kit.ts` — read `kit.arc(c, r, a0, a1, n)`, `kit.stroke(id, pts, o)`, `kit.area(id, pts, fill, o)`, `kit.group(id, children)`, `kit.label(id, anchor, side, text, o)`, `kit.text(id, pos, s, o)`, `kit.COLORS`, `kit.SKETCH_MS` before writing; angles in kit.arc are RADIANS — check its implementation and convert):

```yaml
---
template: circle_sectors
title: Circle cut into sectors → the πr² rectangle
version: 1
kit: 9
status: ready
description: >-
  A circle of radius r cut into n equal sectors that zip together into a
  near-rectangle of width πr and height r — the classic proof that the
  area of a circle is πr². The param t morphs the figure: t = 0 is the
  circle, t = 1 the zipped rectangle, and animate moves every piece on
  the way; n refines the cut (with 40 pieces the top edge is nearly
  straight). Choose this for ANY request about why the area of a circle is
  πr², the area of a disc, rearranging sectors into a rectangle, or
  Archimedes' circle-and-triangle argument.
params:
  type: object
  properties:
    n:
      type: integer
      minimum: 2
      maximum: 64
      description: "How many sectors (default 12). animate to 40 to refine the cut."
    t:
      type: number
      minimum: 0
      maximum: 1
      description: "0 = the circle, 1 = the zipped rectangle (default 0); animate from 0 to 1 to move the pieces."
    show_radius:
      type: boolean
      description: "Draw the radius line and its label r (default true)."
    labels:
      type: boolean
      description: "Label the rectangle's base πr and height r once t > 0.5 (default true)."
    language:
      type: string
      enum: [en, nb]
      description: "Label language (default en)."
element_ids:
  piece_<k>: sector k of n (1-based), a closed outline with a wash — every one moves with t
  radius_line: the radius drawn inside the first sector (when show_radius)
  label_r: the radius label
  label_base: "πr" under the rectangle (when labels and t > 0.5)
  label_height: "r" beside the rectangle (when labels and t > 0.5)
examples:
  - request: "Why is the area of a circle πr²? Show the circle cut into slices."
    params: { n: 12, t: 0 }
  - request: "Show the slices zipped into a rectangle with forty thin pieces."
    params: { n: 40, t: 1, language: en }
layout: |-
  const C = kit.COLORS, MS = kit.SKETCH_MS;
  const n = Math.max(2, Math.min(64, Math.round(Number(params.n ?? 12))));
  const t = Math.max(0, Math.min(1, Number(params.t ?? 0)));
  const showRadius = params.show_radius !== false;
  const labelsOn = params.labels !== false;
  const nb = params.language === "nb";
  const R = 150;
  const CIRCLE = [300, 375];
  const step = (2 * Math.PI) / n;
  const half = step / 2;
  const s = R * Math.sin(half);
  const rectCx = 690;
  const rectCy = 375;
  const x0 = rectCx - (s * (n - 1)) / 2;
  const drawables = [], labels = [], anchors = {}, order = [];
  const push = (d) => { drawables.push(d); order.push(d.id); };
  const rot = (p, c, a) => { const dx = p[0] - c[0], dy = p[1] - c[1]; return [c[0] + dx * Math.cos(a) - dy * Math.sin(a), c[1] + dx * Math.sin(a) + dy * Math.cos(a)]; };
  const lerp = (a, b, u) => a + (b - a) * u;
  for (let k = 0; k < n; k++) {
    const a0 = k * step, a1 = (k + 1) * step, mid = (a0 + a1) / 2;
    const up = k % 2 === 0;
    const targetMid = up ? Math.PI / 2 : -Math.PI / 2;
    let delta = targetMid - mid;
    while (delta > Math.PI) delta -= 2 * Math.PI;
    while (delta < -Math.PI) delta += 2 * Math.PI;
    const apexTo = [x0 + k * s, rectCy + (up ? -R / 2 : R / 2)];
    const angle = delta * t;
    const apex = [lerp(CIRCLE[0], apexTo[0], t), lerp(CIRCLE[1], apexTo[1], t)];
    const pts = [CIRCLE];
    const steps = 20;
    for (let i = 0; i <= steps; i++) { const a = a0 + (step * i) / steps; pts.push([CIRCLE[0] + R * Math.cos(a), CIRCLE[1] + R * Math.sin(a)]); }
    const moved = pts.map((p) => { const q = rot(p, CIRCLE, angle); return [q[0] + apex[0] - CIRCLE[0], q[1] + apex[1] - CIRCLE[1]]; });
    const id = "piece_" + (k + 1);
    push(kit.group(id, [
      kit.area(id + "_fill", moved, C.region1, { opacity: 0.45, ms: MS.area }),
      kit.stroke(id + "_edge", moved, { closed: true, color: C.ink, strokeWidth: 2.5, ms: MS.stroke }),
    ]));
    const cm = rot([CIRCLE[0] + 0.6 * R * Math.cos(mid), CIRCLE[1] + 0.6 * R * Math.sin(mid)], CIRCLE, angle);
    anchors[id] = [cm[0] + apex[0] - CIRCLE[0], cm[1] + apex[1] - CIRCLE[1]];
  }
  if (showRadius) {
    const a = t < 0.5 ? half : Math.PI / 2;
    const apex = t < 0.5 ? CIRCLE : [x0, rectCy - R / 2];
    const tip = [apex[0] + R * Math.cos(a), apex[1] + R * Math.sin(a)];
    push(kit.stroke("radius_line", [apex, tip], { color: C.demand, strokeWidth: 3, ms: MS.stroke }));
    labels.push(kit.label("label_r", [(apex[0] + tip[0]) / 2, (apex[1] + tip[1]) / 2], t < 0.5 ? "above" : "left", "r", { color: C.demand, fontSize: 26 }));
    order.push("label_r");
    anchors.radius_line = tip;
  }
  if (labelsOn && t > 0.5) {
    labels.push(kit.label("label_base", [rectCx, rectCy - R / 2 - 8], "below", "πr", { color: C.demand, fontSize: 28 }));
    labels.push(kit.label("label_height", [x0 + s * (n - 1) + s + 10, rectCy], "right", "r", { color: C.demand, fontSize: 28 }));
    order.push("label_base", "label_height");
    anchors.label_base = [rectCx, rectCy - R / 2 - 30];
  }
  anchors.circle = CIRCLE;
  anchors.rectangle = [rectCx, rectCy];
  return { drawables, labels, anchors, order };
```

Check `kit.COLORS` for the actual names (`C.gain`, `C.demand`, `C.ink` — read `COLORS` in kit.ts and substitute the real keys). If the group children need unique ids across pieces, `${id}_fill` / `${id}_edge` are unique per piece. Adjust `strokeWidth`/`ms` option names to `StrokeOpts` in kit.ts.

- [ ] **Step 4: Register in the tests and the pack description**

`tests/packs.test.ts:997`: append `"circle_sectors"` to the mathlogic `TEMPLATE_IDS`. `src/scenes/packs.ts`: extend the mathlogic pack's `description` string with "…and the circle cut into sectors that zip into the πr² rectangle." — and the pack YAML header's `description:` line the same way (line 3 of `mathlogic.yaml`).

- [ ] **Step 5: Run the tests**

Run: `npx vitest run tests/circle-sectors.test.ts tests/packs.test.ts`
Expected: PASS. If a lint issue appears at t = 1 (a label on a piece), move the label anchor (`label_base` further below, `label_height` further right) rather than dropping it.

- [ ] **Step 6: The bundled example**

Append to `src/examples.json` (splice before the final `]`; keep 2-space indentation like its neighbours) this entry — Norwegian request, as Hans asked it:

```json
  {
    "request": "Hvorfor er arealet av en sirkel πr²?",
    "packs": ["mathlogic"],
    "spec": {
      "title": "Hvorfor er arealet av en sirkel πr²?",
      "template": "circle_sectors",
      "params": { "n": 12, "t": 0, "language": "nb" },
      "elements": [
        { "id": "eq", "type": "text", "text": "πr · r = πr²", "x": 690, "y": 120, "font_size": 36, "style": { "color": "#b5482e" } },
        { "id": "mark", "type": "annotation", "target": "eq", "kind": "box" }
      ],
      "commands": [
        { "draw": ["piece_1", "piece_2", "piece_3", "piece_4", "piece_5", "piece_6", "piece_7", "piece_8", "piece_9", "piece_10", "piece_11", "piece_12"], "parallel": true, "speak": "πr² ser ut som noe man bare må pugge, men formelen kan du klippe ut med saks. Her er en sirkel delt i tolv like kakestykker." },
        { "draw": ["radius_line", "label_r"], "speak": "Radien er r, og hele buen rundt er omkretsen, to π r." },
        { "pause": 0.4 },
        { "animate": { "t": 1 }, "duration": 4, "speak": "Nå snur vi annenhvert stykke og skyver dem sammen, som tenner i en glidelås. Arealet er uendret, vi har bare flyttet bitene." },
        { "draw": ["label_base", "label_height"], "speak": "Halve omkretsen ligger nede og halve oppe, så grunnlinjen er πr, og høyden er radien r." },
        { "animate": { "n": 40 }, "duration": 3, "easing": "linear", "speak": "Med førti tynnere stykker blir den bulkete kanten nesten helt rett: et rektangel." },
        { "draw": ["eq", "mark"], "speak": "Grunnlinje ganger høyde: πr ganger r, altså πr²." },
        { "speak": "Så πr² er ikke et mysterium. Det er omkretsen ganget med radien, halvert av en sirkel som er rettet ut." }
      ]
    }
  }
```

Then run `npx vitest run tests/examples.test.ts` — it demands zero lint issues at rest, ids that resolve, params that satisfy the schema, and (for `animate.stage` only) clean stages. If `label_base`/`label_height` do not exist at t = 0 (they appear only when t > 0.5), the examples test's "every command id resolves" check runs against the RESTING layout — so either draw them at t = 0 too (make `labels` independent of t, placed at the rectangle's position from the start — acceptable, the rectangle area is empty at t = 0) or drop that draw command and let the labels appear with the pieces. Prefer the first: labels always exist, positioned at the rectangle.

- [ ] **Step 7: Run everything you touched**

Run: `npx vitest run tests/circle-sectors.test.ts tests/packs.test.ts tests/examples.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 8: Report** — the template's final element ids, any label positions you moved, and whether the bundled example draws the labels at t = 0. Do not commit.

---

### Task 5: Prompt polish, roadmap and ledger (after Tasks 1–4)

**Files:**
- Modify: `src/llm/prompts/compiler-v1.md` (verify the three edits from Tasks 1–3 read as one story; add one sentence to the template-choice paragraph naming `circle_sectors` for area-of-a-circle requests)
- Modify: `ROADMAP.md` (a "Motion and primitives — done 2026-09-08" section under "Template on demand": what shipped, the three layers, what is not done: rotated text, general tiling, scale/flip)
- Create: `docs/superpowers/plans/2026-09-07-motion-and-primitives-ledger.md` (what shipped per task, test counts, the live smoke's outcome as reported by the controller, traps)

- [ ] **Step 1: Read the diff of the four tasks** (`git diff --stat` and the changed prompt lines) and write the ledger and roadmap section from what actually landed, not from this plan.
- [ ] **Step 2: Run `npx tsc --noEmit` and `npx vitest run`** — the full suite must be green; report the count.
- [ ] **Step 3: Report.** Do not commit.

---

## Self-review

- Spec coverage: §2.1 → Task 1 (rotate/to/pivot, pose composition, transform step, labels follow, backend); §2.2 → Task 2 (sector/arc/polygon/pieces, pieces metadata, prompt); §2.3 → Task 3 (arrange, expandId, zipper); §2.4 → Task 4 (template + example); §4 verification → each task's tests plus the controller's live smoke.
- Type consistency: `Turn`, `composeTurn`, `poseOf`, `poseCentre` (Task 1) are what Task 3 imports; `PieceGeometry`, `LayoutResult.pieces`, `pieceGroups` (Task 2) are what Task 3's `pieceOf`/`expandId` read; `TransformItem` is shared by Tasks 1 and 3.
- Placeholders: none; every code step carries the code.
