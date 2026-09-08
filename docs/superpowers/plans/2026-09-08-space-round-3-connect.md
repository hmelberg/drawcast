# Connect the stars, and free play on the figure — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A sixth answer widget, `connect`, that asks the viewer to draw a
constellation by joining its stars — and free play on both space figures, where
a paused click on a planet, a star or a figure opens its card.

**Architecture:** The answer key is not fetched and not passed down from the
engine: it is READ OFF THE DRAWING. The `sky_map` template already draws a
focused constellation as polylines whose vertices are exactly the projected
positions of the stars it also draws as named elements, so matching each vertex
to the star element under it recovers the figure as pairs of element ids. That
one function (`connectKey`, in `render/widgets.ts` beside the piano and chess
geometry) serves the lint pass, the planner and the gate, and it needs no
engine, so nothing moves across the code-split boundary. The gate follows the
drag widget's split: pure rules in `ui/connect-model.ts` with node tests, DOM in
`ui/connect-gate.ts`. Free play needs no new drill: two manifest interaction
kinds open the existing scene-names hook so the info card can name a star.

**Tech Stack:** TypeScript, Vite, vitest. No new dependency.

**Spec:** `docs/superpowers/specs/2026-09-06-space-design.md` — §6.2 (the
exercise), §6.3 (what round 3 settles: threshold, cap, focus requirement),
§6.4 (free play).

## Global Constraints

- **`CONNECT_MAX_EDGES = 24`.** Orion's own count. Over it, lint says so and the
  gate does not open. Exactly two figures fall outside: Eridanus (26),
  Sagittarius (29).
- **Grading: every key edge, at most one stray.** Undirected pairs compared as
  sets. `STRAY_ALLOWANCE = 1`.
- **The logical canvas is y-up, origin bottom-left.** `CANVAS.h − y` is the
  single flip and it happens at emission; `logicalPoint` and `clientPointFor`
  (`src/ui/dom.ts`) already do it. Never negate a y term to "fix" an
  orientation — that is the round-2 trap, and a review that reports the sky
  upside down has usually rendered logical coordinates without the backend's
  flip.
- **Read `layoutSpec(spec).issues`, never `.warnings`.** A sweep written
  against `.warnings` comes back green over a chart riddled with problems.
- **Element ids never contain `__` where a card or a part must reach them**
  (`usable()` in `ui/card-model.ts` screens those out). Group LEAVES use `__`;
  the ids free play names must not.
- **No static import of `scenes/space/sky.ts` from `ui/` or `render/`.** It
  pulls astronomy-engine into the main chunk. Reach a loaded engine through
  `getLoadedEngines(["sky"])` the way `ui/sky-explore.ts` does; type-only
  imports from `sky-types.ts` are free.
- **A group's leaf durations accumulate** (`src/render/svg-backend.ts:583-589`).
- **`npm test` must stay green** (5567 tests at the branch point) and
  `npx tsc --noEmit` clean.

---

### Task 1: `connectKey` — the answer key read off the drawing

**Files:**
- Modify: `src/render/widgets.ts` (append; it currently ends with `periodicCellBox`)
- Test: `tests/connect-key.test.ts` (create)

**Interfaces:**
- Consumes: `BBox` from `../layout/geometry`, `Pt` from `../layout/model` (both
  already imported there, type-only).
- Produces:
  ```ts
  export interface ConnectStar { id: string; at: Pt }
  /** Two star element ids, sorted, so an edge equals itself whichever way it was drawn. */
  export type ConnectEdge = [string, string];
  export interface ConnectKey {
    stars: ConnectStar[];
    edges: ConnectEdge[];
    /** Polyline vertices no star element sits under — a figure with any of these cannot be drawn. */
    unmatched: number;
  }
  export function connectKey(
    leaves: readonly { id: string; pts?: readonly Pt[] }[],
    boxes: ReadonlyMap<string, BBox>,
    conId: string,
    eps?: number,
  ): ConnectKey;
  ```

The template draws a lifted constellation as `kit.group(conId, segPts.map((s, i) => kit.stroke(conId + "__" + i, s, …)))` (`src/scenes/packs/space.yaml:1429`) and its stars as separate `kit.ball(starId, at, …)` elements (`:1450`), so every polyline vertex coincides with a star element's box centre to floating-point exactness.

- [ ] **Step 1: Write the failing test**

```ts
// tests/connect-key.test.ts
import { describe, it, expect } from "vitest";
import { connectKey } from "../src/render/widgets";

const box = (x: number, y: number) => ({ x: x - 2, y: y - 2, w: 4, h: 4 });

describe("connectKey", () => {
  it("reads a figure's edges off its drawn polylines", () => {
    const leaves = [
      { id: "con_tst__0", pts: [[10, 10], [20, 20], [30, 10]] as [number, number][] },
      { id: "con_tst__1", pts: [[30, 10], [40, 30]] as [number, number][] },
      { id: "alnitak", pts: undefined },
    ];
    const boxes = new Map([
      ["alnitak", box(10, 10)],
      ["hip_2", box(20, 20)],
      ["hip_3", box(30, 10)],
      ["hip_4", box(40, 30)],
      ["label_alnitak", box(10, 14)],
    ]);
    const k = connectKey(leaves, boxes, "con_tst");
    expect(k.unmatched).toBe(0);
    expect(k.stars.map((s) => s.id).sort()).toEqual(["alnitak", "hip_2", "hip_3", "hip_4"]);
    expect(k.edges).toEqual([
      ["alnitak", "hip_2"],
      ["hip_2", "hip_3"],
      ["hip_3", "hip_4"],
    ]);
  });

  it("never names a label, and counts a vertex with no star under it", () => {
    const leaves = [{ id: "con_tst__0", pts: [[10, 10], [99, 99]] as [number, number][] }];
    const boxes = new Map([["alnitak", box(10, 10)], ["label_alnitak", box(10, 10)]]);
    const k = connectKey(leaves, boxes, "con_tst");
    expect(k.unmatched).toBe(1);
    expect(k.edges).toEqual([]);
    expect(k.stars.map((s) => s.id)).toEqual(["alnitak"]);
  });

  it("gives one edge per pair however many segments repeat it", () => {
    const leaves = [
      { id: "con_tst__0", pts: [[10, 10], [20, 20]] as [number, number][] },
      { id: "con_tst__1", pts: [[20, 20], [10, 10]] as [number, number][] },
    ];
    const boxes = new Map([["a", box(10, 10)], ["b", box(20, 20)]]);
    expect(connectKey(leaves, boxes, "con_tst").edges).toEqual([["a", "b"]]);
  });

  it("is empty for a constellation that is not drawn", () => {
    expect(connectKey([], new Map(), "con_ori")).toEqual({ stars: [], edges: [], unmatched: 0 });
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/connect-key.test.ts`
Expected: FAIL — `connectKey` is not exported.

- [ ] **Step 3: Implement**

```ts
// src/render/widgets.ts — appended

/** A star of a connect figure: the element the viewer joins, and where it sits
 *  on the y-up logical canvas. */
export interface ConnectStar {
  id: string;
  at: Pt;
}

/** Two star element ids, SORTED — an edge equals itself whichever way it was
 *  drawn, which is what lets grading compare sets. */
export type ConnectEdge = [string, string];

export interface ConnectKey {
  stars: ConnectStar[];
  edges: ConnectEdge[];
  /** Vertices with no star element under them: a figure with any of these
   *  cannot be drawn, so lint refuses the question rather than shipping one
   *  the viewer cannot win. */
  unmatched: number;
}

/**
 * The answer key, read off the drawing rather than carried beside it.
 *
 * A lifted constellation is drawn as polylines (`con_ori__0`, `con_ori__1`, …)
 * whose vertices ARE the projected positions of the stars the same layout draws
 * as named elements, so the star under a vertex is the star that vertex means.
 * Deriving the key this way keeps the sky engine — and astronomy-engine behind
 * it — out of every caller, and guarantees that what is graded and what is
 * revealed are the same figure.
 *
 * `label_…` ids are skipped: a name sits close to its star and would otherwise
 * win a vertex from the dot it names.
 */
export function connectKey(
  leaves: readonly { id: string; pts?: readonly Pt[] }[],
  boxes: ReadonlyMap<string, BBox>,
  conId: string,
  eps = 2,
): ConnectKey {
  const prefix = conId + "__";
  const candidates: { id: string; at: Pt }[] = [];
  for (const [id, b] of boxes) {
    if (id.includes("__") || id.startsWith("label_") || id === conId) continue;
    candidates.push({ id, at: [b.x + b.w / 2, b.y + b.h / 2] });
  }
  const at = (p: Pt): string | null => {
    let best: string | null = null;
    let bestD = eps * eps;
    for (const c of candidates) {
      const dx = c.at[0] - p[0];
      const dy = c.at[1] - p[1];
      const d = dx * dx + dy * dy;
      if (d <= bestD) {
        bestD = d;
        best = c.id;
      }
    }
    return best;
  };
  const seen = new Map<string, ConnectEdge>();
  const starIds = new Set<string>();
  let unmatched = 0;
  for (const leaf of leaves) {
    if (leaf.id !== conId && !leaf.id.startsWith(prefix)) continue;
    const pts = leaf.pts ?? [];
    let prev: string | null = null;
    for (const p of pts) {
      const id = at(p);
      if (id === null) {
        unmatched++;
        prev = null;
        continue;
      }
      starIds.add(id);
      if (prev !== null && prev !== id) {
        const e: ConnectEdge = prev < id ? [prev, id] : [id, prev];
        seen.set(e[0] + " " + e[1], e);
      }
      prev = id;
    }
  }
  const byId = new Map(candidates.map((c) => [c.id, c] as const));
  return {
    stars: [...starIds].map((id) => ({ id, at: byId.get(id)!.at })),
    edges: [...seen.values()],
    unmatched,
  };
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run tests/connect-key.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Prove it against the real Orion**

Add to the same file:

```ts
it("recovers Orion's 24 edges from a real focused chart", async () => {
  const { layoutSpec } = await import("../src/layout/layout");
  const { ensureEnginesForTemplate } = await import("../src/scenes/engines");
  const { leafDrawables } = await import("../src/layout/model");
  const { elementBBoxes } = await import("../src/layout/layout");
  await ensureEnginesForTemplate("sky_map");
  const spec = {
    title: "Orion",
    template: "sky_map",
    params: { focus: "con_ori", time: "2026-01-15T22:00:00+01:00" },
    commands: [{ draw: "all" }],
  };
  const lay = layoutSpec(spec as never);
  const measure = /* the same measure tests/sky-template.test.ts passes */;
  const k = connectKey(leafDrawables(lay.drawables), elementBBoxes(lay, measure), "con_ori");
  expect(k.unmatched).toBe(0);
  expect(k.edges.length).toBe(24);
  expect(k.stars.length).toBe(23);
});
```

Mirror the setup of an existing sky test (`tests/sky-template.test.ts`) for the
exact helper names and the measure function it passes to `elementBBoxes` — copy
that file's idiom rather than inventing one. If Orion's count differs from 24,
STOP and report it: the data says 24 edges over 23 stars, so a different number
means the derivation is wrong, not the data.

- [ ] **Step 6: Commit**

```bash
git add src/render/widgets.ts tests/connect-key.test.ts
git commit -m "The answer key is read off the drawing, not carried beside it"
```

---

### Task 2: `connect-model.ts` — snapping, toggling, grading

**Files:**
- Create: `src/ui/connect-model.ts`
- Test: `tests/connect-model.test.ts` (create)

**Interfaces:**
- Consumes: `ConnectEdge`, `ConnectStar` from `../render/widgets` (Task 1).
- Produces:
  ```ts
  export const CONNECT_MAX_EDGES = 24;
  export const STRAY_ALLOWANCE = 1;
  export function snapStar(p: Pt, stars: readonly ConnectStar[], radius: number): ConnectStar | null;
  export function makeEdge(a: string, b: string): ConnectEdge;
  export function sameEdge(a: ConnectEdge, b: ConnectEdge): boolean;
  export function toggleEdge(drawn: readonly ConnectEdge[], e: ConnectEdge): ConnectEdge[];
  export function edgeAt(p: Pt, drawn: readonly ConnectEdge[], stars: readonly ConnectStar[], tol: number): ConnectEdge | null;
  export interface ConnectGrade { hits: ConnectEdge[]; missing: ConnectEdge[]; strays: ConnectEdge[]; pass: boolean }
  export function gradeConnect(drawn: readonly ConnectEdge[], key: readonly ConnectEdge[]): ConnectGrade;
  export function connectProgress(drawn: number, needed: number): string;
  export function connectSummary(g: ConnectGrade): string;
  ```

- [ ] **Step 1: Write the failing test**

```ts
// tests/connect-model.test.ts
import { describe, it, expect } from "vitest";
import {
  CONNECT_MAX_EDGES, connectProgress, connectSummary, edgeAt, gradeConnect,
  makeEdge, snapStar, toggleEdge,
} from "../src/ui/connect-model";

const stars = [
  { id: "a", at: [0, 0] as [number, number] },
  { id: "b", at: [10, 0] as [number, number] },
  { id: "c", at: [10, 10] as [number, number] },
];

describe("snapStar", () => {
  it("takes the nearest star inside the radius", () => {
    expect(snapStar([1, 1], stars, 5)?.id).toBe("a");
    expect(snapStar([9, 1], stars, 5)?.id).toBe("b");
  });
  it("is null when nothing is close enough", () => {
    expect(snapStar([5, 5], stars, 2)).toBeNull();
  });
});

describe("edges", () => {
  it("sorts its ends, so a line drawn backwards is the same line", () => {
    expect(makeEdge("b", "a")).toEqual(["a", "b"]);
  });
  it("toggles: drawing an existing line removes it", () => {
    const one = toggleEdge([], makeEdge("a", "b"));
    expect(one).toEqual([["a", "b"]]);
    expect(toggleEdge(one, makeEdge("b", "a"))).toEqual([]);
  });
  it("finds the segment under a click, and nothing off it", () => {
    const drawn = [makeEdge("a", "b")];
    expect(edgeAt([5, 0.5], drawn, stars, 2)).toEqual(["a", "b"]);
    expect(edgeAt([5, 9], drawn, stars, 2)).toBeNull();
    // Past the end of the segment is off it, however near the infinite line.
    expect(edgeAt([-5, 0], drawn, stars, 2)).toBeNull();
  });
});

describe("gradeConnect", () => {
  const key = [makeEdge("a", "b"), makeEdge("b", "c")];
  it("passes on the exact figure", () => {
    const g = gradeConnect([makeEdge("b", "a"), makeEdge("c", "b")], key);
    expect(g.pass).toBe(true);
    expect(g.missing).toEqual([]);
    expect(g.strays).toEqual([]);
  });
  it("forgives one stray, never two", () => {
    expect(gradeConnect([...key, makeEdge("a", "c")], key).pass).toBe(true);
    expect(gradeConnect([...key, makeEdge("a", "c"), makeEdge("c", "a")], key).strays.length).toBe(1);
  });
  it("fails when a line of the figure is missing, however few strays", () => {
    const g = gradeConnect([makeEdge("a", "b")], key);
    expect(g.pass).toBe(false);
    expect(g.missing).toEqual([["b", "c"]]);
  });
  it("fails an empty drawing", () => {
    expect(gradeConnect([], key).pass).toBe(false);
  });
});

describe("words", () => {
  it("counts up while drawing", () => {
    expect(connectProgress(3, 24)).toBe("3 / 24 lines");
  });
  it("says what was right and what was extra", () => {
    const key = [makeEdge("a", "b"), makeEdge("b", "c")];
    expect(connectSummary(gradeConnect(key, key))).toBe("2 of 2 lines, none extra");
    expect(connectSummary(gradeConnect([makeEdge("a", "b"), makeEdge("a", "c")], key)))
      .toBe("1 of 2 lines, 1 extra");
  });
});

it("caps the exercise at Orion's own size", () => {
  expect(CONNECT_MAX_EDGES).toBe(24);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/connect-model.test.ts`
Expected: FAIL — the module does not exist.

- [ ] **Step 3: Implement**

Write `src/ui/connect-model.ts` with a header comment in the house voice,
following `src/ui/drag-model.ts` for tone and structure. Required behaviour:

- `snapStar` — nearest by squared distance, `null` beyond `radius`.
- `makeEdge(a, b)` — sorted pair; callers never build one by hand.
- `sameEdge` — element-wise on the sorted pair.
- `toggleEdge` — remove when present (compared with `sameEdge`), else append.
- `edgeAt` — the drawn segment under a point: distance from the point to the
  SEGMENT (clamp the projection parameter to `[0, 1]`, so past an end is off
  it, which the test pins), nearest wins, `null` beyond `tol`.
- `gradeConnect` — `hits` = key edges present, `missing` = key edges absent,
  `strays` = drawn edges not in the key; `pass` = `missing.length === 0 &&
  strays.length <= STRAY_ALLOWANCE`. Duplicates cannot occur because
  `toggleEdge` owns the list, but grade defensively over a de-duplicated set
  anyway — the exported function must be honest about any input.
- `connectProgress(drawn, needed)` — `"3 / 24 lines"`.
- `connectSummary` — `"1 of 2 lines, 1 extra"`, and `"none extra"` for zero.
  Singular/plural on "extra" is not needed; the count carries it.

- [ ] **Step 4: Run the test**

Run: `npx vitest run tests/connect-model.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ui/connect-model.ts tests/connect-model.test.ts
git commit -m "Connect's rules: snap, toggle, and what counts as the figure"
```

---

### Task 3: The widget in the schema

**Files:**
- Modify: `src/spec/schema.ts` (the `widget` enum at :406, its description at
  :408, and the ask validation block at :876-905)
- Test: `tests/connect-schema.test.ts` (create)

**Interfaces:**
- Produces: `ask.widget: "connect"` accepted by the validator; `answer` and
  `right` required with it; `items`/`tolerance`/`store` rejected.

- [ ] **Step 1: Write the failing test**

```ts
// tests/connect-schema.test.ts
import { describe, it, expect } from "vitest";
import { validateSpec } from "../src/spec/schema";

const base = (ask: Record<string, unknown>) => ({
  title: "T",
  template: "sky_map",
  params: { focus: "con_ori" },
  commands: [{ draw: "all" }, { ask }],
});

const errorsOf = (spec: unknown): string[] => validateSpec(spec).errors ?? [];

describe("ask.widget connect", () => {
  it("accepts the shape the author writes", () => {
    expect(errorsOf(base({ question: "Draw Orion.", widget: "connect", answer: "con_ori", right: "The belt is the three in a row." }))).toEqual([]);
  });
  it("needs the constellation as its answer", () => {
    expect(errorsOf(base({ question: "Draw Orion.", widget: "connect", right: "x" })).join(" ")).toContain("answer");
  });
  it("needs a right line, because the reveal is a sentence", () => {
    expect(errorsOf(base({ question: "Draw Orion.", widget: "connect", answer: "con_ori" })).join(" ")).toContain("right");
  });
  it("takes no items and no tolerance — those belong to drag", () => {
    const errs = errorsOf(base({ question: "q", widget: "connect", answer: "con_ori", right: "r", items: ["a"] })).join(" ");
    expect(errs).toContain("items");
  });
});
```

Check `tests/ask-schema.test.ts` first for the real name and return shape of the
validator; use whatever that file uses and adjust the helper above to match.

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/connect-schema.test.ts`
Expected: FAIL — `"connect"` is not in the enum.

- [ ] **Step 3: Implement**

1. Enum: `enum: ["click", "piano", "chess", "code", "drag", "connect"]`.
2. Append to the `widget` description, in the same voice, before the closing
   "All but drag require answer" sentence (which must become "All but drag
   require answer"): 

   > `connect` = DRAW A CONSTELLATION on a `sky_map` portrait: the viewer joins
   > star to star (press one and drag to the next, or tap both) until the figure
   > is made, and `answer` is the constellation's element id (`con_ori`). Use it
   > only with `focus` on that same figure, which is what gives every one of its
   > stars an element id; the figure's own lines are hidden while the question
   > stands and drawn back as the reveal. At most 24 lines — Orion's own count,
   > and the most anyone will draw by hand; for a bigger figure ask which
   > constellation it is instead.
3. Validation, beside the drag block:
   - `connect` requires `answer` (the existing "widget requires answer" rule at
     :896 already covers it — verify, and keep it).
   - `connect` requires `right`.
   - `connect` rejects `items`, `tolerance` and `store`. The current line at
     :905 says items/tolerance are drag-only; make its message name the widget
     that was actually used.

- [ ] **Step 4: Run the test**

Run: `npx vitest run tests/connect-schema.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the whole suite — the enum is shared**

Run: `npx vitest run`
Expected: no new failures. Some tests assert the widget enum's contents or the
description text; update those to include `connect` where they do.

- [ ] **Step 6: Commit**

```bash
git add src/spec/schema.ts tests/connect-schema.test.ts
git commit -m "A sixth answer device: connect"
```

---

### Task 4: Lint refuses a question the viewer cannot win

**Files:**
- Modify: `src/lint/lint.ts` (`lintLayoutDetailed`, which already receives
  `drawables` and `commands`)
- Test: `tests/connect-lint.test.ts` (create)

**Interfaces:**
- Consumes: `connectKey` from `../render/widgets` (Task 1),
  `CONNECT_MAX_EDGES` from `../ui/connect-model` (Task 2).
- Produces: a new `LintIssue.rule` value `"connect"`, severity `"warn"`, on
  four conditions.

The four conditions, each with the message it prints (`<id>` is `ask.answer`):

| condition | message |
|---|---|
| the answer names nothing drawn | `connect: "<id>" is not drawn in this figure — a connect question needs focus on that constellation` |
| the figure is drawn but has no edges | `connect: "<id>" has no lines to draw` |
| a vertex has no star element under it | `connect: <n> of "<id>"'s points have no star to join — the figure cannot be drawn as it stands` |
| over the cap | `connect: "<id>" has <n> lines; the cap is 24 (Orion's) — ask which constellation it is instead` |

- [ ] **Step 1: Write the failing test**

```ts
// tests/connect-lint.test.ts
import { describe, it, expect } from "vitest";
import { lintLayoutDetailed } from "../src/lint/lint";

// Build drawables by hand: a two-segment figure over three star balls.
// Copy the Drawable shapes from an existing lint test (tests/lint*.test.ts)
// rather than inventing them.

describe("connect lint", () => {
  it("says nothing about a figure that can be drawn", () => { /* … */ });
  it("names an answer that is not drawn", () => { /* … */ });
  it("refuses a figure over the cap", () => { /* … */ });
  it("counts points with no star under them", () => { /* … */ });
});
```

Fill each case from the shapes the neighbouring lint tests use. Every assertion
reads `.issues` — never `.warnings`.

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/connect-lint.test.ts`

- [ ] **Step 3: Implement**

In `lintLayoutDetailed`, after the existing `ask code` block (:314-330), add the
connect block. `leaves` is already in scope; build the box map the same way the
out-of-canvas pass at :161-167 builds its boxes, which is the file's own idiom
and needs no new import:

```ts
const leafBoxes = new Map<string, BBox>();
for (const d of leaves) {
  if (d.kind === "text") leafBoxes.set(d.id, bboxOfText(d, measure));
  else if (d.kind === "image") leafBoxes.set(d.id, { x: d.pos[0] - d.w / 2, y: d.pos[1] - d.h / 2, w: d.w, h: d.h });
  else if (d.pts.length > 0) leafBoxes.set(d.id, bboxOfPts(d.pts));
}
```

A `kit.ball` is a stroke carrying a circle `shapeHint`, so its bbox centre IS
the star's centre — the same point the figure's polylines pass through. Build
this map ONCE, lazily, only when a connect ask is present: every other figure
must pay nothing for it.

Then, for each `cmd.ask?.widget === "connect"` with a string `answer`, call
`connectKey(leaves, leafBoxes, answer)` and push at
most ONE issue per command (the first condition that holds, in the table's
order — a figure that is not drawn has no edges either, and saying both is
noise). `rule: "connect"`, `ids: [answer]`, `severity: "warn"`.

Add `"connect"` to the `rule` union at :28-31 with a one-line doc comment in the
same style as its neighbours.

- [ ] **Step 4: Run the test**

Run: `npx vitest run tests/connect-lint.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lint/lint.ts tests/connect-lint.test.ts
git commit -m "Lint will not ship a constellation the viewer cannot draw"
```

---

### Task 5: The plan carries the reveal

**Files:**
- Modify: `src/render/plan.ts` (the widget union at :40, the ask branch at
  :285-343)
- Test: `tests/connect-plan.test.ts` (create)

**Interfaces:**
- Produces: on an ask step with `widget: "connect"`, `answerBox` set to the
  constellation group's box when it has one, and the group marked visible for
  after the question — `makeVisible([answer])`, exactly as the drag branch does
  for its element items.

Why the planner does no more than this: the key is derivable from the layout at
gate time, so passing it down the plan would be a second copy that can disagree
with the first. The movie path needs only a box to point the laser at.

- [ ] **Step 1: Write the failing test**

```ts
// tests/connect-plan.test.ts — mirror tests/ask-plan.test.ts's setup exactly.
// 1. A connect ask leaves its constellation visible after the step.
// 2. The step carries widget "connect" and an answerBox.
// 3. A connect ask whose answer names nothing drawn produces no answerBox and
//    does not throw.
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/connect-plan.test.ts`

- [ ] **Step 3: Implement**

1. Widen the widget union at `:40` to include `"connect"` (and the matching one
   in `src/ui/controls.ts:186`).
2. In the ask branch, beside the drag block:

```ts
// The connect widget: the figure's own lines are the reveal. The gate hides
// them while the viewer draws (it owns the DOM), and the plan agrees they are
// there once the question ends — the same contract the drag widget's items
// have. The key itself is read off the layout at gate time, so it is not
// copied into the plan, where the two could drift apart.
if (cmd.ask.widget === "connect" && typeof cmd.ask.answer === "string") {
  mentioned.add(cmd.ask.answer);
  makeVisible([cmd.ask.answer]);
}
```
3. Add the `answerBox` spread for `connect`, in the same shape as `click`'s at
   `:333`.

- [ ] **Step 4: Run the test, then the suite**

Run: `npx vitest run tests/connect-plan.test.ts && npx vitest run`
Expected: PASS, no new failures.

- [ ] **Step 5: Commit**

```bash
git add src/render/plan.ts src/ui/controls.ts tests/connect-plan.test.ts
git commit -m "The figure's own lines are the reveal"
```

---

### Task 6: The gate — drawing the figure

**Files:**
- Create: `src/ui/connect-gate.ts`
- Modify: `src/ui/controls.ts` (the `askGate` dispatch at :967-980)
- Modify: `src/styles.css` (the gate's own classes, beside `.cs-draggate`)
- Test: `tests/connect-gate.test.ts` (create — jsdom, following
  `tests/drag-gate.test.ts` if it exists; otherwise the nearest DOM-gate test)

**Interfaces:**
- Consumes: `connectKey` (Task 1), everything from `connect-model.ts` (Task 2),
  `logicalPoint` and `clientPointFor` from `./dom`, `elementBBoxes` and
  `leafDrawables` from the layout, `AskGateStep` from `./controls`.
- Produces: `export function connectGateFor(stage: HTMLElement, hd: RenderHandle): (signal: AbortSignal, step: AskGateStep) => Promise<string | null>`
  — resolving `step.answer` when the drawing passes, and the summary string
  when it does not (which cannot match the answer, so the player takes the
  wrong branch), and `null` on skip or abort.

Behaviour, in the order it happens:

1. Derive the key with `connectKey(leafDrawables(hd.layout.drawables), elementBBoxes(hd.layout, makeBrowserMeasure()), step.answer)`.
   No stars, no edges, or more than `CONNECT_MAX_EDGES` → `resolve(null)` and no
   gate: lint already said so at compile time, and a viewer must never meet a
   question that cannot be answered.
2. Hide the figure's own lines: `stage.querySelectorAll('[data-leaf-id^="<answer>__"]')`
   plus the group itself, saving each node's inline `opacity` and restoring it
   on teardown. (`svg-backend.ts:305` stamps `data-leaf-id`.) This is the gate's
   own doing rather than the author's discipline, so a cast that draws the
   figure first still asks an honest question.
3. Mount an `<svg class="cs-connect-ink">` overlay across the stage, drawn in
   CLIENT pixels via `clientPointFor`, holding: a dot per star (so the viewer
   can see what may be joined), the segments drawn so far, and the rubber band.
   Re-measure on `resize`.
4. Pointer: `pointerdown` near a star (within `SNAP_RADIUS`, in logical units —
   use a radius proportional to the median nearest-neighbour distance of the
   key's stars, clamped, so a crowded figure still separates) arms it and starts
   a rubber band; `pointermove` follows; `pointerup` on another star toggles that
   edge. A press that never left the star (< 4 CSS px, the drag widget's
   `DRAG_MIN_PX`) leaves the star ARMED so the next tap on another star draws the
   segment — that is the two-tap path, and it is the one that works on touch.
   A pointerup on empty space cancels. A click on an existing segment
   (`edgeAt`) removes it.
5. A counter pill shows `connectProgress(drawn.length, key.edges.length)`.
   A "Done ▸" pill finishes. A "Skip ▸" pill appears unless `step.required`.
6. On finish: grade, paint hits green and strays red in the overlay, show
   `connectSummary`, linger `LINGER_MS` (2600, the same as every other card),
   remove, and resolve.

- [ ] **Step 1: Write the failing test**

The gate is DOM, and the house convention is that pure rules carry the tests.
Test what can be tested honestly in jsdom, and no more:

```ts
// tests/connect-gate.test.ts
// 1. A key over the cap resolves null and mounts no gate.
// 2. A key with no edges resolves null and mounts no gate.
// 3. The gate hides the figure's lines while it stands and restores them after.
// 4. Skip resolves null; abort resolves null and removes the gate.
```

Synthesize pointer events the way the existing gate tests do; if none exist,
keep to the four cases above, which need no pointer geometry.

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/connect-gate.test.ts`

- [ ] **Step 3: Implement the gate**

Follow `src/ui/drag-gate.ts` closely: the same promise shape, the same
`settled`/`remove`/`onAbort` structure, the same `LINGER_MS`, the same
`stage.querySelector(".cs-figgate")?.remove()` first line, the same
`gate.addEventListener("click", (e) => e.stopPropagation())`, and the same
skip pill. Give the overlay `touch-action: none` while it is mounted so a
finger can draw without scrolling the stage, and restore it on teardown.

- [ ] **Step 4: Wire it into the dispatch**

`src/ui/controls.ts`: build `const connectGate = connectGateFor(stage, hd);`
beside the others and add the `step.widget === "connect"` arm to the chain.

- [ ] **Step 5: Style it**

`src/styles.css`, beside `.cs-draggate`: the overlay
(`position: absolute; inset: 0; pointer-events: none` on the svg, with the
segments' own `pointer-events: stroke` so a click can remove one), the star
dots, the rubber band (dashed), and the two verdict colours. Reuse the
variables the drag gate's `.right` / `.wrong` classes use — do not introduce a
second green.

- [ ] **Step 6: Run the tests**

Run: `npx vitest run tests/connect-gate.test.ts && npx vitest run`
Expected: PASS, no new failures.

- [ ] **Step 7: Commit**

```bash
git add src/ui/connect-gate.ts src/ui/controls.ts src/styles.css tests/connect-gate.test.ts
git commit -m "The gate: press a star, drag to the next, and the figure appears"
```

---

### Task 7: Free play — a paused click on a planet or a star

**Files:**
- Modify: `src/scenes/types.ts:20` (`KNOWN_INTERACTIONS`)
- Modify: `src/ui/infocard.ts` (`sceneNamesFor`, :71-90)
- Modify: `src/ui/quiz-model.ts` (`activitiesFor`, :26-39)
- Modify: `src/scenes/packs/space.yaml` (both manifests: after `explore: space`)
- Test: `tests/connect-freeplay.test.ts` (create)

**Interfaces:**
- Produces: `KNOWN_INTERACTIONS = ["piano", "chess", "periodic", "space", "sky"]`.
  `activitiesFor` keeps returning the generic parts drill when the declared
  interactions imply no bespoke activity.

- [ ] **Step 1: Write the failing test**

```ts
// tests/connect-freeplay.test.ts
import { describe, it, expect } from "vitest";
import { activitiesFor } from "../src/ui/quiz-model";
import { KNOWN_INTERACTIONS } from "../src/scenes/types";
import { scenes } from "../src/scenes/registry";

describe("free play on the space figures", () => {
  it("both templates declare their interaction", () => {
    expect(scenes.solar_system.manifest.interactions).toEqual(["space"]);
    expect(scenes.sky_map.manifest.interactions).toEqual(["sky"]);
  });
  it("knows the two new kinds", () => {
    expect(KNOWN_INTERACTIONS).toContain("space");
    expect(KNOWN_INTERACTIONS).toContain("sky");
  });
  it("keeps the generic drill for a kind with no bespoke activity of its own", () => {
    // The trap this pins: activitiesFor used to return the parts drill ONLY
    // when a figure declared nothing at all, so declaring an interaction for
    // the sake of CARDS would silently take the drill away.
    expect(activitiesFor(["sky"], 12).map((a) => a.id)).toEqual(["parts_quiz"]);
    expect(activitiesFor(["space"], 9).map((a) => a.id)).toEqual(["parts_quiz"]);
  });
  it("still gives a bespoke kind its own activities and no generic one", () => {
    expect(activitiesFor(["piano"], 30).map((a) => a.id)).toEqual(["note_quiz"]);
  });
  it("gives nothing to a figure with too few parts", () => {
    expect(activitiesFor(["sky"], 2)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/connect-freeplay.test.ts`

- [ ] **Step 3: Declare the kinds and keep the drill**

1. `src/scenes/types.ts:20` — add `"space"` and `"sky"`.
2. `src/scenes/packs/space.yaml` — `interactions: [space]` under
   `solar_system`'s `explore: space`, and `interactions: [sky]` under
   `sky_map`'s.
3. `src/ui/quiz-model.ts` — restructure `activitiesFor` so the generic drill is
   a fall-through rather than an early return:

```ts
export function activitiesFor(interactions: readonly string[], partsCount = 0): Activity[] {
  const out: Activity[] = [];
  if (interactions.includes("chess")) { /* … unchanged … */ }
  if (interactions.includes("piano")) { /* … unchanged … */ }
  if (interactions.includes("periodic")) { /* … unchanged … */ }
  // A kind declared for its CARDS (space, sky) implies no drill of its own.
  // The generic identify drill is what such a figure should keep — the early
  // return this replaces took it away from anything that declared anything.
  if (out.length === 0 && partsCount >= MIN_PARTS) out.push({ kind: "parts", id: "parts_quiz", label: "🎯 Find the part" });
  return out;
}
```
   Update the doc comment above it: the rule is now "a bespoke activity
   displaces the generic drill", not "a declaration does".

- [ ] **Step 4: Name the parts, so a click opens a card**

`src/ui/infocard.ts`, `sceneNamesFor`: keep the periodic branch and add two.
Both reach their engine through `getLoadedEngines`, both in a `try`/`catch`
that returns `[]` — a card is not worth throwing at a viewer over, which is
what the periodic branch already says.

- `space`: for every drawn element id that is a body id, the body's name in the
  figure's `names` language. Read the ids from `hd.layout.order`, ask the
  `space` engine for each; skip what it does not know.
- `sky`: for every drawn id, ask the `sky` engine in this order — a
  constellation (`findConstellation`, giving `name(c, lang)`), a star
  (`findStar`, giving `starName(s, lang)` and falling back to `HIP <n>` when a
  star has no proper name), then a body. `lang` comes from `params.names`
  exactly as the periodic branch reads `params.names`.

Element ids containing `__` are group leaves and must be skipped — the same
`usable()` rule the card model applies.

- [ ] **Step 5: Run the tests**

Run: `npx vitest run tests/connect-freeplay.test.ts && npx vitest run`
Expected: PASS. Watch for tests that assert `KNOWN_INTERACTIONS`'s exact
contents or a manifest snapshot; update them.

- [ ] **Step 6: Commit**

```bash
git add src/scenes/types.ts src/scenes/packs/space.yaml src/ui/infocard.ts src/ui/quiz-model.ts tests/connect-freeplay.test.ts
git commit -m "A paused click on a star now says which star it is"
```

---

### Task 8: What the model is told, and two examples

**Files:**
- Modify: `src/llm/prompts/compiler-v1.md:70` (the widget paragraph)
- Modify: `src/scenes/packs/space.yaml` (the `sky_map` description)
- Modify: `src/examples.json` (append two)
- Modify: `src/scenes/space/README.md` (a section on the widget)
- Test: the existing examples guard (find it: it is the test that lints every
  example and asserts `.issues`)

- [ ] **Step 1: Add the widget to the compiler prompt**

One sentence in `compiler-v1.md:70`'s paragraph, after the chess sentence:

> On a `sky_map` figure focused on one constellation, `"widget": "connect"`
> asks the viewer to DRAW it: they join star to star until the figure is made,
> and `answer` is the constellation's element id (`con_ori`). Use `focus` on
> that same figure, and choose one of at most 24 lines.

- [ ] **Step 2: Add it to the template's own description**

In `sky_map`'s `description`, after the sentence about the bundled answer key:
one sentence saying that a focused figure can be asked for with
`{"ask": {"widget": "connect", "answer": "con_ori", …}}`, and that the cap is
24 lines. Keep it to one sentence — this description is on every compile
request and the catalog already costs about 64 000 tokens.

- [ ] **Step 3: Write the two examples**

Both start from a question, per STYLE.md's 2026-09-07 entry ("Generelt er det
fint om eksemplene tar utgangspunkt i et spørsmål eller noe de vil forklare").
Append to `src/examples.json` with TARGETED string edits — never re-serialize
the file; a whole-file JSON rewrite reformats all 14 000 lines.

1. **Orion, 24 lines.** Request: `"Do I know Orion well enough to draw it?"`.
   `sky_map`, `focus: "con_ori"`, a January evening. Beats: name what is on the
   page, hide nothing (the gate does that), ask with `widget: "connect"`, and a
   `right` line that says what the figure is — the belt of three, the shoulders
   Betelgeuse and Bellatrix, the foot Rigel.
2. **Cassiopeia, 4 lines.** Request: `"Hvordan finner jeg Kassiopeia?"` —
   Norwegian, `names: "nb"`, `focus: "con_cas"`. The W is four lines, so this is
   the one a viewer finishes in seconds, and it is the one that proves the
   widget on a figure nobody needs a minute for.

- [ ] **Step 4: Run the examples guard**

Run: `npx vitest run` and read the guard's output. Every example must lint
clean — `.issues`, not `.warnings`.

- [ ] **Step 5: Write the pack's own account**

`src/scenes/space/README.md`: a section on the widget covering the derivation
of the key from the drawing (and why it is not carried beside it), the cap and
which two figures it excludes, the grading threshold, and the free-play
interaction kinds. Match the file's existing voice.

- [ ] **Step 6: Commit**

```bash
git add src/llm/prompts/compiler-v1.md src/scenes/packs/space.yaml src/examples.json src/scenes/space/README.md
git commit -m "Two figures to draw, and the words that ask for them"
```

---

## Final verification

- [ ] `npx vitest run` — green, and the count has grown by this round's tests
- [ ] `npx tsc --noEmit` — clean
- [ ] `npm run build` — clean, and astronomy-engine is still absent from the
      main chunk (grep the built assets, as round 2 did)
- [ ] A smoke checklist written for Hans at
      `docs/superpowers/plans/2026-09-08-space-round-3-smoke.md`, covering what
      no test can see: that a segment appears where the pointer went, that the
      two-tap path works, that a wrong figure is marked wrong, that the reveal
      shows the true lines, and that a paused click on a star opens its card.
