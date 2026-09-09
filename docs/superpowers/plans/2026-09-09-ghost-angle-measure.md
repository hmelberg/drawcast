# Ghost, Angle, Measure Implementation Plan (motion round 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep a faded copy of the original while pieces animate away (`keep`, and `ghost` on the motion verbs); `angle` and `measure` elements, the measure's value following the figure; `pieces` cuts `rings` (with `arrange: unroll`), `triangles`, `halving`; `ellipse` and `line` primitives; two round-2 leftovers.

**Architecture:** Ghosts generalise round 2's trails into "minted elements" (`Plan.minted`, `withMinted` applied to every layout `render()` mounts). `angle`, `measure`, `ellipse`, `line` and the three cuts are ordinary tier-2 elements in `src/layout/tier2.ts`, with pure geometry in `src/layout/measures.ts`. A measure's value follows through a new `SceneState.texts` (like `shapes`) and `RenderedElement.setText`; its dimension line is re-pointed through the existing `shapes` state. `unroll` is a morph of each ring to its strip.

**Tech Stack:** TypeScript, vitest (node, no DOM — backend tests use `tests/helpers/mini-dom.ts`), rough.js SVG backend.

**Spec:** `docs/superpowers/specs/2026-09-09-ghost-angle-measure-design.md`

## Global Constraints

- The model writes semantics, code computes geometry. Every point a new element takes is a `PointRef` (`[x, y]` or `{ref, anchor?}`), resolved at layout time through tier-2's `resolveEnd` (which returns `{ pt, anchored }`).
- Canvas 1000 × 750 logical units, y-UP; the backend flips y with `H − y`. Rotation in degrees counter-clockwise.
- Ghost defaults: opacity 0.3, id `<id>_ghost` then `<id>_ghost_2`, …, painted BELOW the source (inserted in `order` right before it), instant (no draw animation), visible in the same step it is minted. `keep` and the `ghost` option are absent by default — nothing is kept unless asked.
- `angle`: radius default 40, label default the rounded degrees with "°", label font 22 at radius + 22 on the bisector, right-angle square when `right` is true or the angle is within 0.5° of 90 and `right` is not false; the angle is swept counter-clockwise from `from` to `to`, in (0, 360].
- `measure`: `what` default `length` for a segment / arrow / path / line and `area` for polygon / sector / ellipse / pieces cell; `label` default `"{value}"`; `scale` default 1 (logical units per unit); `decimals` default 0 when the value ≥ 100 else 1; dimension line offset 24 to the side away from the element's centroid (or `side`), end ticks 12 long; the text is a separate element `label_<id>` (never rotates; an attached follower of `<id>`). The value recomputes after every step that moves or morphs a dependency (`of`, or the refs of `from`/`to`), from CURRENT geometry (current points through the current pose; area by the shoelace formula, absolute).
- `pieces`: `rings` — n equal-width annuli, `<id>_1` innermost, each a keyhole-polygon wash `<id>_k_wash` + outer circle stroke `<id>_k` + inner circle stroke `<id>_k_body`, `pieces[id].ring = { rIn, rOut }`, `apex` = the centre, `radius` = rOut; `triangles` — sector-like geometry with `radius` = the circumradius (apex to vertex) and `height` = the apothem; `halving` — alternately vertical then horizontal halves, `<id>_1` the left half, `<id>_rest` the remainder. `arrange: unroll` — strip k has length 2π·r_mid,k and height rOut − rIn, strips stacked bottom-up (innermost at the bottom), left ends aligned, the stack centred on `at`.
- Every new verb (`keep`) goes to ALL SEVEN sites: `ACTION_VERBS` and the verb list in `commandSchema.description` and `normalizeSpec`'s bare-string coercion (`src/spec/schema.ts`), `ACTION_KEYS` in `src/render/plan.ts` and in `src/lint/lint.ts`, the `mentionedIds` list in `src/llm/subtitles.ts`, and the prompt's verb inventory line in `src/llm/prompts/compiler-v1.md` (~line 31). Every new element type goes to the `type` enum in `src/spec/schema.ts`, `ElementType` in `src/spec/types.ts`, the dispatch in `layoutElements`, and the semantic checks in `validateSpec`.
- Every new schema field carries a one-sentence imperative `description` with an example.
- Never `git commit` inside a task; the controller commits after review. Never use the Write tool on an EXISTING file — use Edit with exact anchors; Write only for NEW files.
- Run only the test files you touched plus `npx tsc --noEmit`; the controller runs the full suite. Tests: `npx vitest run tests/<file>.test.ts` from the worktree root `/Users/hom/Documents/GitHub/drawcast/.claude/worktrees/template-spike`.
- `tests/examples.test.ts` demands EMPTY `plan.warnings` and no lint issue of any severity for every bundled example; fix examples, never the gate.

## File map

| File | Responsibility |
|---|---|
| `src/render/minted.ts` (new) | `MintedSpec` (trail \| ghost), `withMinted` — materialises ghosts and trails into a layout |
| `src/render/trails.ts` | keeps `TrailSpec`, `cumulativeLengthFractions`, `lengthFractionAt`; `withTrails` moves to `minted.ts` |
| `src/render/plan.ts` | `Plan.minted`, ghost minting, `keep`, `ghost` on five verbs, `texts` state, measure updates, `unroll`, `isExplicitPointRef` |
| `src/render/arrange.ts` | `unroll` strips; zipper uses `height` |
| `src/layout/measures.ts` (new) | pure: segment length, ring area / perimeter, box width / height, formatting, dimension-line geometry |
| `src/layout/tier2.ts` | `angle`, `measure`, `ellipse`, `line`, the three cuts, `Tier2Result.measures` |
| `src/layout/layout.ts` | `LayoutResult.measures` |
| `src/spec/types.ts`, `src/spec/schema.ts` | `KeepArgs`, `ghost`, the new element types and their fields |
| `src/render/backend.ts`, `src/render/svg-backend.ts` | `setText`, `swapGeometry(…, texts)` |
| `src/render/player.ts` | `texts` in `applyScene`, previews, the step settles |
| `src/render/index.ts` | `withMinted`, `measureOf` / `measuresDependingOn` options |
| `src/llm/prompts/compiler-v1.md`, `src/examples.json`, `ROADMAP.md` | prompt lines, seven examples, the roadmap entry |

---

### Task 1: Minted elements — ghosts, `keep`, and `ghost` on the motion verbs

**Files:**
- Create: `src/render/minted.ts`
- Modify: `src/render/trails.ts` (remove `withTrails` and its imports; keep the rest)
- Modify: `src/render/plan.ts` (`Plan.trails` → `Plan.minted`; `trailBoxes` → `mintedBoxes`; `mintTrail` pushes a `{ kind: "trail", … }`; new `mintGhosts`; a `keep` branch; `ghost` handling in `move`, `arrange`, `flip`, `morph`, `animate`; `ACTION_KEYS`)
- Modify: `src/render/index.ts` (`withTrails` → `withMinted(layout, minted, layoutAt)` at the three `layoutFor` returns and the mounted layout; `layoutAt = (params) => layoutFor(params, true)` — careful: `withMinted` must call a RAW layout function, so define `rawLayoutFor` (the current body without the `withTrails` wrapping) and have `layoutFor` = `withMinted(rawLayoutFor(...), minted, rawLayoutFor)`)
- Modify: `src/spec/types.ts` (`KeepArgs`, `GhostOption`, `ghost?` on `MoveArgs`/`ArrangeArgs`/`FlipArgs`/`MorphArgs`, `Command.keep`, `Command.ghost` for animate), `src/spec/schema.ts` (a `ghostSchema` helper used five times; a `keep` command schema after `flow`; `ACTION_VERBS`; the verb list; `normalizeSpec` line), `src/lint/lint.ts:444`, `src/llm/subtitles.ts` (`keep` in the `target` list), `src/llm/prompts/compiler-v1.md` (inventory line + a `keep`/`ghost` bullet after `flow`)
- Test: `tests/ghost.test.ts` (new), `tests/trail.test.ts` (rename `withTrails` uses to `withMinted`), `tests/player-raf.test.ts` (a hand-built `Plan` literal gains `minted: []` in place of `trails: []`)

**Interfaces:**
- Produces (`src/render/minted.ts`):
  ```ts
  export interface GhostSpec { kind: "ghost"; id: string; sourceId: string; offset: Pt; turn?: Turn; shapes?: Record<string, Pt[]>; opacity: number; params: Record<string, number> }
  export type MintedSpec = ({ kind: "trail" } & TrailSpec) | GhostSpec;
  export function withMinted(layout: LayoutResult, minted: MintedSpec[], layoutAt: (params: Record<string, number>) => LayoutResult): LayoutResult;
  ```
- Produces (plan): `Plan.minted: MintedSpec[]`; inside `planCommands` the closure `mintGhosts(ids: string[], opacity: number): string[]` (returns the ghost ids, having added them to `known`, `mentioned`, `mintedBoxes` and `visible`), and `ghostIdsFor(opt: GhostOption | undefined, targets: string[]): { ids: string[]; opacity: number } | null`.
- Types: `export type GhostOption = boolean | string[] | { of?: string[]; opacity?: number }`; `export interface KeepArgs { target: string[] | string; opacity?: number }`.

- [ ] **Step 1: Write the failing tests**

Create `tests/ghost.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { layoutSpec, elementBBoxes } from "../src/layout/layout";
import { heuristicMeasure } from "../src/layout/measure";
import { planCommands, type PlanStep } from "../src/render/plan";
import { planOptionsFor } from "../src/render/index";
import { withMinted } from "../src/render/minted";
import { drawablesForId, leafDrawables } from "../src/layout/model";
import { validateSpec } from "../src/spec/schema";

const SPEC = {
  elements: [
    { id: "tri", type: "polygon", points: [[100, 100], [300, 100], [200, 300]], style: { fill: "#f2c14e" } },
    { id: "lbl", type: "label", attach_to: "tri", side: "below", text: "T" },
    { id: "dot", type: "shape", shape: "circle", x: 600, y: 600, radius: 20 },
  ],
  commands: [{ draw: ["tri", "lbl", "dot"] }],
};

function planOf(commands: unknown[]) {
  const spec = { ...SPEC, commands: [...SPEC.commands, ...commands] };
  const layout = layoutSpec(spec as never, heuristicMeasure);
  const bboxes = elementBBoxes(layout, heuristicMeasure);
  const plan = planCommands(spec.commands as never, layout.order, { bboxOf: (id) => bboxes.get(id) ?? null, ...planOptionsFor(spec as never, layout) });
  return { spec, layout, plan };
}

describe("keep and ghost (design §2.1)", () => {
  test("keep mints tri_ghost at the current pose, visible in the same step, below the source, at 0.3", () => {
    const { layout, plan } = planOf([{ move: { target: ["tri"], by: [100, 0] } }, { keep: { target: ["tri"] }, speak: "Keep it." }]);
    expect(plan.warnings).toEqual([]);
    expect(plan.minted.map((m) => m.kind)).toEqual(["ghost"]);
    const g = plan.minted[0] as Extract<(typeof plan.minted)[number], { kind: "ghost" }>;
    expect(g.id).toBe("tri_ghost");
    expect(g.offset).toEqual([100, 0]);
    expect(g.opacity).toBe(0.3);
    expect(plan.states[2].visible).toContain("tri_ghost");
    expect(plan.states[1].visible).not.toContain("tri_ghost");
    expect(plan.steps[2]).toMatchObject({ kind: "show", ids: ["tri_ghost"], narration: "Keep it." });
    const out = withMinted(layout, plan.minted, () => layout);
    expect(out.order.indexOf("tri_ghost")).toBe(out.order.indexOf("tri") - 1); // right before its source
    const leaves = leafDrawables(drawablesForId(out.drawables, "tri_ghost"));
    expect(leaves.map((d) => d.id).sort()).toEqual(["tri_ghost", "tri_ghost_wash"]);
    const outline = leaves.find((d) => d.id === "tri_ghost") as { pts: [number, number][]; style: { opacity: number }; drawOpts: { mode: string } };
    expect(outline.pts[0]).toEqual([200, 100]); // (100,100) + the offset
    expect(outline.style.opacity).toBeCloseTo(0.3, 6);
    expect(outline.drawOpts.mode).toBe("instant");
    expect(withMinted(layout, [], () => layout)).toBe(layout);
  });
  test("ghost: true on move mints a ghost of every target before the motion; a second keep gets _2", () => {
    const { plan } = planOf([{ move: { target: ["tri", "dot"], by: [50, 50], ghost: true } }, { keep: { target: "tri", opacity: 0.5 } }]);
    expect(plan.warnings).toEqual([]);
    expect(plan.minted.map((m) => m.id)).toEqual(["tri_ghost", "dot_ghost", "tri_ghost_2"]);
    const first = plan.minted[0] as { offset: [number, number] };
    expect(first.offset).toEqual([0, 0]); // minted from the pre-move state
    expect((plan.minted[2] as { opacity: number }).opacity).toBe(0.5);
    expect(plan.states[1].visible).toEqual(expect.arrayContaining(["tri_ghost", "dot_ghost"]));
  });
  test("a ghost of a morphed source carries its current shapes; ghost: [ids] picks targets; a later erase takes the ghost", () => {
    const { plan } = planOf([
      { morph: { target: ["tri"], stretch: [2, 1] } },
      { flip: { target: ["tri"], ghost: ["tri"] } },
      { erase: ["tri_ghost"] },
    ]);
    expect(plan.warnings).toEqual([]);
    const g = plan.minted[0] as { shapes?: Record<string, unknown> };
    expect(g.shapes && Object.keys(g.shapes)).toContain("tri");
    expect(plan.states[plan.states.length - 1].visible).not.toContain("tri_ghost");
  });
  test("the schema accepts keep, ghost on the verbs and a bare-string keep target", () => {
    const ok = (commands: unknown[]) => validateSpec({ ...SPEC, commands } as never).ok;
    expect(ok([{ keep: { target: "tri" } }])).toBe(true);
    expect(ok([{ move: { target: ["tri"], by: [1, 0], ghost: { of: ["tri"], opacity: 0.2 } } }])).toBe(true);
    expect(ok([{ morph: { target: ["tri"], reset: true, ghost: true } }])).toBe(true);
    expect(ok([{ keep: {} }])).toBe(false);
  });
});

describe("ghost under animate (a template)", () => {
  test("ghost: true on animate mints ghosts of the visible template ids from the boundary layout", async () => {
    const { ensureEnabledPacks } = await import("../src/scenes/packs");
    await ensureEnabledPacks(["mathlogic"]);
    const spec = { template: "circle_sectors", params: { n: 4, t: 0 }, elements: [], commands: [{ draw: ["piece_1", "piece_2", "piece_3", "piece_4"] }, { animate: { t: 1 }, ghost: true }] };
    const layout = layoutSpec(spec as never, heuristicMeasure);
    const bboxes = elementBBoxes(layout, heuristicMeasure);
    const plan = planCommands(spec.commands as never, layout.order, { bboxOf: (id) => bboxes.get(id) ?? null, animateBase: spec.params, ...planOptionsFor(spec as never, layout) });
    expect(plan.warnings).toEqual([]);
    expect(plan.minted.map((m) => m.id)).toEqual(["piece_1_ghost", "piece_2_ghost", "piece_3_ghost", "piece_4_ghost"]);
    expect((plan.minted[0] as { params: Record<string, number> }).params).toEqual({});
    const out = withMinted(layout, plan.minted, (params) => layoutSpec({ ...spec, params: { ...spec.params, ...params } } as never, heuristicMeasure));
    expect(out.order).toContain("piece_1_ghost");
    expect(out.order.indexOf("piece_1_ghost")).toBe(out.order.indexOf("piece_1") - 1);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/ghost.test.ts`
Expected: FAIL — `src/render/minted` missing.

- [ ] **Step 3: `src/render/minted.ts`**

```ts
// Minted elements (design §2.1 of round 3, §2.5 of round 2): elements the
// planner creates at plan time — a trail, a ghost — and render() appends to
// every layout it mounts, so they can be faded, erased, highlighted and
// pointed at like anything the spec declared.
import type { LayoutResult } from "../layout/layout";
import { Z_STROKE, drawablesForId, leafDrawables, type Drawable, type Pt } from "../layout/model";
import { resolveDrawOpts, resolveStyle } from "../layout/resolve";
import { poseOf, type Turn } from "./pose";
import type { TrailSpec } from "./trails";

export interface GhostSpec {
  kind: "ghost";
  id: string;
  sourceId: string;
  /** The source's pose when the ghost was minted. */
  offset: Pt;
  turn?: Turn;
  /** The source's morphed leaf points at that moment (absent = its layout points). */
  shapes?: Record<string, Pt[]>;
  opacity: number;
  /** For a template source: the boundary params the source is read at ({} for a tier-2 spec). */
  params: Record<string, number>;
}

export type MintedSpec = ({ kind: "trail" } & TrailSpec) | GhostSpec;

function trailDrawable(layout: LayoutResult, t: TrailSpec): Drawable {
  const source = t.id.replace(/_trail(_\d+)?$/, "");
  const src = leafDrawables(drawablesForId(layout.drawables, source)).find((d) => d.kind === "stroke");
  return {
    id: t.id,
    kind: "stroke",
    pts: t.pts,
    z: Z_STROKE,
    style: resolveStyle({ color: t.color ?? src?.style.color, stroke_width: t.width }),
    drawOpts: resolveDrawOpts(undefined, { duration: 1200 }),
  };
}

/** A leaf id `<src>` or `<src>_<suffix>` re-homed under the ghost id. */
function ghostLeafId(leafId: string, sourceId: string, ghostId: string): string {
  return leafId === sourceId ? ghostId : leafId.startsWith(`${sourceId}_`) ? `${ghostId}_${leafId.slice(sourceId.length + 1)}` : `${ghostId}__${leafId}`;
}

/** The source's leaves as they look NOW: morphed points, then the pose, at the ghost's opacity, drawn instantly. */
function ghostDrawables(sourceLayout: LayoutResult, g: GhostSpec): Drawable[] {
  const map = poseOf(g.offset, g.turn);
  const s = g.turn?.scale ?? 1;
  const out: Drawable[] = [];
  for (const leaf of leafDrawables(drawablesForId(sourceLayout.drawables, g.sourceId))) {
    const id = ghostLeafId(leaf.id, g.sourceId, g.id);
    const style = { ...leaf.style, opacity: leaf.style.opacity * g.opacity };
    const drawOpts = resolveDrawOpts({ mode: "instant" });
    if (leaf.kind === "text") {
      out.push({ ...leaf, id, pos: map(leaf.pos), style, drawOpts });
    } else if (leaf.kind === "image") {
      out.push({ ...leaf, id, pos: map(leaf.pos), w: leaf.w * s, h: leaf.h * s, style, drawOpts });
    } else if (leaf.kind === "stroke" && leaf.shapeHint?.type === "circle") {
      const c = map(leaf.shapeHint.c);
      out.push({ ...leaf, id, pts: [c], shapeHint: { type: "circle", c, r: leaf.shapeHint.r * s }, style, drawOpts });
    } else if (leaf.kind === "stroke" && leaf.shapeHint?.type === "rect") {
      const h = leaf.shapeHint;
      const corners: Pt[] = [[h.x, h.y], [h.x + h.w, h.y], [h.x + h.w, h.y + h.h], [h.x, h.y + h.h]];
      const { shapeHint: _drop, ...rest } = leaf;
      out.push({ ...rest, id, pts: corners.map(map), closed: true, style, drawOpts });
    } else {
      const pts = (g.shapes?.[leaf.id] ?? leaf.pts).map(map);
      out.push(leaf.kind === "area" ? { ...leaf, id, pts, holes: leaf.holes?.map((ring) => ring.map(map)), style, drawOpts } : { ...leaf, id, pts, style, drawOpts });
    }
  }
  return out;
}

/**
 * Append every minted element to a layout: trails at the end of the order
 * (drawn on top), ghosts right BEFORE their source (painted under it). An
 * id already in the order is skipped, so a cached layout can be wrapped
 * again. `layoutAt` supplies a template's boundary layout for a ghost
 * minted under animate; for a tier-2 spec it is never called ({} params
 * read the layout itself).
 */
export function withMinted(layout: LayoutResult, minted: MintedSpec[], layoutAt: (params: Record<string, number>) => LayoutResult): LayoutResult {
  if (minted.length === 0) return layout;
  const drawables = [...layout.drawables];
  const order = [...layout.order];
  for (const m of minted) {
    if (order.includes(m.id)) continue;
    if (m.kind === "trail") {
      drawables.push(trailDrawable(layout, m));
      order.push(m.id);
      continue;
    }
    const sourceLayout = Object.keys(m.params).length === 0 ? layout : layoutAt(m.params);
    const parts = ghostDrawables(sourceLayout, m);
    if (parts.length === 0) continue;
    // Under the source: insert the ghost's drawables before the source's first drawable, and its id before the source's in the order.
    const firstSrc = drawables.findIndex((d) => d.id === m.sourceId || d.id.startsWith(`${m.sourceId}_`));
    drawables.splice(firstSrc < 0 ? drawables.length : firstSrc, 0, ...parts);
    const at = order.indexOf(m.sourceId);
    order.splice(at < 0 ? order.length : at, 0, m.id);
  }
  return { ...layout, drawables, order };
}
```

Delete `withTrails` from `src/render/trails.ts` (and its now-unused imports); `tests/trail.test.ts`'s `withTrails` test becomes `withMinted(layout, [{ kind: "trail", ...spec }], () => layout)` with the same assertions.

- [ ] **Step 4: Types and schema**

`src/spec/types.ts`:

```ts
/** Keep a faded copy of the targets where they are now — true, a list of ids, or {of, opacity}. */
export type GhostOption = boolean | string[] | { of?: string[]; opacity?: number };

export interface KeepArgs {
  /** Element ids, or one pieces id. */
  target: string[] | string;
  /** Opacity of the kept copy (default 0.3). */
  opacity?: number;
}
```

`ghost?: GhostOption;` on `MoveArgs`, `ArrangeArgs`, `FlipArgs`, `MorphArgs`; on `Command`: `/** Keep a faded copy of what is about to be drawn over, in place. */ keep?: KeepArgs;` and `/** With animate: keep a faded copy of the figure at this boundary (true = every visible id). */ ghost?: GhostOption;`.

`src/spec/schema.ts`: beside `pointRefSchema`,

```ts
const ghostSchema = (what: string) => ({
  oneOf: [
    { type: "boolean" },
    { type: "array", items: { type: "string" } },
    { type: "object", properties: { of: { type: "array", items: { type: "string" } }, opacity: { type: "number", minimum: 0, maximum: 1 } }, additionalProperties: false },
  ],
  description: `${what} — KEEP a faded copy of the original where it is while this plays: true keeps every target at 0.3, ["id", …] keeps those, {"of": […], "opacity": 0.2} sets the shade. The copy is an element <id>_ghost you can erase or fade later. Default: nothing is kept.`,
});
```

Add `ghost: ghostSchema("Ghost of the targets before they move")` to the `move`, `arrange`, `flip` and `morph` command schemas, and `ghost: ghostSchema("With animate: ghost of the figure at this boundary")` as a top-level command property next to `duration`/`easing` (find where `animate`'s `duration` is declared in `commandSchema.properties`). After `flow`:

```ts
    keep: {
      type: "object",
      description:
        "Keep a faded copy of elements where they are NOW, as elements <id>_ghost — the original stays on screen while its pieces move away: {\"keep\": {\"target\": \"kake\"}, \"speak\": \"Keep the circle in mind while the slices move.\"} before an arrange or a morph. Default opacity 0.3.",
      properties: {
        target: idListSchema("Element ids, or one pieces id."),
        opacity: { type: "number", minimum: 0, maximum: 1, description: "Shade of the kept copy (default 0.3) — e.g. 0.5 for a stronger ghost." },
      },
      required: ["target"],
      additionalProperties: false,
    },
```

`ACTION_VERBS` gains `"keep"` after `"flow"`; the verb list in `commandSchema.description` too; `normalizeSpec`: `if (cmd.keep) cmd.keep.target = toList(cmd.keep.target)!;`. `src/lint/lint.ts:444` `ACTION_KEYS` gains `"keep"`; `src/llm/subtitles.ts` adds `"keep"` to the `target`-bearing list; the prompt's inventory line gains `keep` after `flow`, and after the `flow` bullet:

```
- `keep` / `ghost`: `{"keep": {"target": "kake"}, "speak": "Hold the whole circle in mind…"}` leaves a faded copy (0.3) of the targets where they are, as elements `<id>_ghost`; the same as `"ghost": true` on a `move`, `arrange`, `flip`, `morph` or `animate`, which keeps the original while the pieces go — cut a circle, keep it, zip the slices into the rectangle beside it. Erase or fade the ghost by its id when it has done its job. Default: nothing is kept.
```

- [ ] **Step 5: Planner**

In `src/render/plan.ts`: import `type { MintedSpec, GhostSpec }` from `./minted`; `Plan.trails` → `minted: MintedSpec[]`; locals `const minted: MintedSpec[] = []`, `trailBoxes` → `mintedBoxes`, a `ghostCount = new Map<string, number>()`. `mintTrail` pushes `{ kind: "trail", id, pts, color, width }` and sets `mintedBoxes`. Add after `mintTrail`'s neighbours (near `resolvePoint`):

```ts
  /** Mint a faded copy of each id where it is NOW (design §2.1 round 3): known, mentioned, boxed and visible at once. Returns the ghost ids. */
  const mintGhosts = (ids: string[], opacity: number, params: Record<string, number> = {}): string[] => {
    const out: string[] = [];
    for (const id of ids) {
      const box = currentBox(id);
      if (!box) {
        warnings.push(`ghost of "${id}": no geometry (skipped)`);
        continue;
      }
      const n = (ghostCount.get(id) ?? 0) + 1;
      ghostCount.set(id, n);
      const ghostId = n === 1 ? `${id}_ghost` : `${id}_ghost_${n}`;
      const g: GhostSpec = { kind: "ghost", id: ghostId, sourceId: id, offset: offsets[id] ?? [0, 0], turn: turns[id], shapes: shapes[id], opacity, params };
      minted.push(g);
      mintedBoxes.set(ghostId, box);
      known.add(ghostId);
      mentioned.add(ghostId);
      makeVisible([ghostId]);
      out.push(ghostId);
    }
    return out;
  };
  /** The ghost option of a verb, resolved against its targets: which ids, at what opacity. */
  const ghostIdsFor = (opt: GhostOption | undefined, targets: string[]): { ids: string[]; opacity: number } | null => {
    if (opt === undefined || opt === false) return null;
    if (opt === true) return { ids: targets, opacity: 0.3 };
    if (Array.isArray(opt)) return { ids: resolveIds(opt, "ghost"), opacity: 0.3 };
    return { ids: opt.of ? resolveIds(opt.of, "ghost") : targets, opacity: opt.opacity ?? 0.3 };
  };
```

(`mintedBoxes` entries are in CURRENT coordinates already, like trail boxes — `boxOf` returns them first and `currentBox` must NOT re-pose them: a minted id never has an offset or turn, so `currentBox` is a no-op on it. Keep that invariant in a comment.)

In `move` (both halves), `arrange`, `flip`, `morph`: right after `ids` are resolved and validated, `const ghosts = ghostIdsFor(cmd.X.ghost, ids); if (ghosts) mintGhosts(ghosts.ids, ghosts.opacity);` — BEFORE any offset/turn/shape is changed. In `animate`, after the skip guards and before `params = { ...params, ...targets }`: `const ghosts = ghostIdsFor(cmd.ghost, visible.filter((id) => !id.endsWith("_ghost") && !/_ghost_\d+$/.test(id))); if (ghosts) mintGhosts(ghosts.ids, ghosts.opacity, { ...params });` (the boundary params BEFORE this animate). New branch after `flow`:

```ts
    } else if (cmd.keep !== undefined) {
      const ids = resolveIds(cmd.keep.target, "keep");
      if (ids.length === 0) continue;
      const ghostIds = mintGhosts(ids, cmd.keep.opacity ?? 0.3, { ...params });
      if (ghostIds.length === 0) continue;
      pushStep({ kind: "show", ids: ghostIds });
```

`ACTION_KEYS` gains `"keep"`. Return `minted` on the `Plan`. `src/render/index.ts`: replace the trails wiring:

```ts
  let minted: MintedSpec[] = [];
  const rawLayoutFor = (params, cache, elements) => { …the current body without withTrails… };
  const layoutFor = (params, cache, elements) => withMinted(rawLayoutFor(params, cache, elements), minted, (p) => rawLayoutFor(p, true));
  …
  minted = plan.minted;
  const mountedLayout = withMinted(layout, minted, (p) => rawLayoutFor(p, true));
```

- [ ] **Step 6: Run**

Run: `npx vitest run tests/ghost.test.ts tests/trail.test.ts tests/plan.test.ts tests/player-raf.test.ts tests/schema.test.ts tests/prompt.test.ts tests/examples.test.ts && npx tsc --noEmit`
Expected: all PASS (extend `tests/prompt.test.ts`'s inventory assertion to `keep` and add `"`keep`"` to the strings it checks).

---
### Task 2: `angle` element

**Files:**
- Modify: `src/layout/tier2.ts` (a `resolvePointRef(p, ctx)` helper beside `resolveEnd`; `case "angle"`; `angleDrawables`)
- Modify: `src/spec/types.ts` (`ElementType` gains `"angle"`; `SpecElement` gains `at?: PointRef | EndRef` — check the existing `at` field used by `point` (`{ intersection_of?, x?, y? }`) and widen it rather than clash; `from?`/`to?` already exist as `EndRef` for arrows — widen to `EndRef | [number, number] | number`; new `label?: string | boolean`, `right?: boolean`)
- Modify: `src/spec/schema.ts` (`type` enum; `from`/`to` become `oneOf` number | pointRef branches; `at` widened; `label`, `right` fields; semantic check "angle needs at, from and to")
- Test: `tests/angle.test.ts` (new)

**Interfaces:**
- Consumes: `resolveEnd(end, ctx): ResolvedEnd | null` (tier2), `arcPts(c, r, from, to)` (tier2), `SUB_SUFFIXES` includes `"text"`.
- Produces: `resolvePointRef(p: PointRef | undefined, ctx: Ctx): Pt | null` (array → `{x, y}` → `resolveEnd`; object → `resolveEnd`) — Tasks 3 and 7 reuse it. Drawables `<id>` (arc or right-angle square, stroke) and `<id>_text`; `ctx.namedAnchors[id] = { vertex, arc }`; `ctx.anchors[id] = arc`.

- [ ] **Step 1: Write the failing tests**

Create `tests/angle.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { layoutSpec } from "../src/layout/layout";
import { heuristicMeasure } from "../src/layout/measure";
import { flattenDrawables } from "../src/layout/model";
import { validateSpec } from "../src/spec/schema";
import type { Spec } from "../src/spec/types";

const spec = (elements: unknown[]): Spec => ({ elements, commands: [] }) as unknown as Spec;
const textOf = (out: ReturnType<typeof layoutSpec>, id: string) => (flattenDrawables(out.drawables).find((d) => d.id === id) as { text?: string } | undefined)?.text;

describe("angle element (design §2.2)", () => {
  const tri = { id: "tri", type: "polygon", points: [[200, 200], [500, 200], [200, 400]] };
  test("an angle at a vertex between two arms writes its degrees, sweeps counter-clockwise, and anchors vertex/arc", () => {
    const out = layoutSpec(spec([tri, { id: "a", type: "angle", at: { ref: "tri", anchor: "vertex_1" }, from: { ref: "tri", anchor: "vertex_2" }, to: { ref: "tri", anchor: "vertex_3" } }]), heuristicMeasure);
    expect(out.warnings).toEqual([]);
    expect(textOf(out, "a_text")).toBe("90°");
    const arc = flattenDrawables(out.drawables).find((d) => d.id === "a") as { pts: [number, number][] };
    expect(arc.pts).toHaveLength(3); // the right-angle square: two arm points and the corner
    expect(out.namedAnchors.a.vertex).toEqual([200, 200]);
    const b = out.namedAnchors.a.arc;
    expect(Math.hypot(b[0] - 200, b[1] - 200)).toBeCloseTo(40, 6);
    expect(b[0]).toBeGreaterThan(200); expect(b[1]).toBeGreaterThan(200); // on the bisector, into the first quadrant
  });
  test("directions in degrees, a custom radius and label, and the reflex side when the arms are given the other way round", () => {
    const out = layoutSpec(spec([{ id: "b", type: "angle", at: [500, 375], from: 0, to: 60, radius: 80, label: "α" }, { id: "c", type: "angle", at: [800, 375], from: 60, to: 0, label: false, right: false }]), heuristicMeasure);
    expect(out.warnings).toEqual([]);
    expect(textOf(out, "b_text")).toBe("α");
    const arc = flattenDrawables(out.drawables).find((d) => d.id === "b") as { pts: [number, number][] };
    expect(arc.pts.length).toBeGreaterThan(10);
    expect(Math.hypot(arc.pts[0][0] - 500, arc.pts[0][1] - 375)).toBeCloseTo(80, 6);
    expect(textOf(out, "c_text")).toBeUndefined();
    const reflex = flattenDrawables(out.drawables).find((d) => d.id === "c") as { pts: [number, number][] };
    const last = reflex.pts[reflex.pts.length - 1];
    expect(Math.atan2(last[1] - 375, last[0] - 800)).toBeCloseTo(0, 3); // swept 300° from 60° round to 0°
  });
  test("schema: needs at, from and to; a 90° between arms not flagged right: false gets the square", () => {
    expect(validateSpec(spec([{ id: "x", type: "angle", at: [0, 0], from: 0 }])).ok).toBe(false);
    expect(validateSpec(spec([{ id: "x", type: "angle", at: [0, 0], from: 0, to: 90 }])).ok).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/angle.test.ts`
Expected: FAIL — unknown element type.

- [ ] **Step 3: Implement**

`src/layout/tier2.ts`:

```ts
/** A PointRef of a tier-2 element, in logical coordinates (arrays and {x, y} follow the arrow-endpoint rule: domain units when a domain is declared). */
function resolvePointRef(p: PointRef | undefined, ctx: Ctx): Pt | null {
  if (p === undefined) return null;
  if (Array.isArray(p)) return resolveEnd({ x: p[0], y: p[1] }, ctx)?.pt ?? null;
  return resolveEnd(p, ctx)?.pt ?? null;
}

function angleDrawables(el: SpecElement, ctx: Ctx): Drawable[] {
  const at = resolvePointRef(el.at as PointRef, ctx);
  if (!at) {
    ctx.warnings.push(`angle "${el.id}": its vertex does not resolve`);
    return [];
  }
  const dirOf = (arm: unknown): number | null => {
    if (typeof arm === "number") return arm;
    const p = resolvePointRef(arm as PointRef, ctx);
    return p ? (Math.atan2(p[1] - at[1], p[0] - at[0]) * 180) / Math.PI : null;
  };
  const a0 = dirOf(el.from);
  const a1 = dirOf(el.to);
  if (a0 === null || a1 === null) {
    ctx.warnings.push(`angle "${el.id}": an arm does not resolve`);
    return [];
  }
  let sweep = (((a1 - a0) % 360) + 360) % 360;
  if (sweep === 0) sweep = 360;
  const r = el.radius ?? 40;
  const style = resolveStyle(el.style);
  const drawOpts = resolveDrawOpts(el.draw, { duration: SKETCH_MS.guides });
  const right = el.right === true || (el.right !== false && Math.abs(sweep - 90) <= 0.5);
  let pts: Pt[];
  if (right) {
    const s = r * 0.6;
    const d0: Pt = [at[0] + s * Math.cos(a0 * DEG), at[1] + s * Math.sin(a0 * DEG)];
    const d1: Pt = [at[0] + s * Math.cos((a0 + sweep) * DEG), at[1] + s * Math.sin((a0 + sweep) * DEG)];
    pts = [d0, [d0[0] + d1[0] - at[0], d0[1] + d1[1] - at[1]], d1];
  } else {
    pts = arcPts(at, r, a0, a0 + sweep, Math.max(12, Math.round(sweep / 6)));
  }
  const bis = (a0 + sweep / 2) * DEG;
  const arcPt: Pt = [at[0] + r * Math.cos(bis), at[1] + r * Math.sin(bis)];
  const out: Drawable[] = [{ id: el.id, kind: "stroke", pts, z: Z_STROKE, style, drawOpts }];
  const labelText = el.label === false ? null : typeof el.label === "string" ? el.label : `${Math.round(sweep)}°`;
  if (labelText !== null) {
    const pos: Pt = [at[0] + (r + 22) * Math.cos(bis), at[1] + (r + 22) * Math.sin(bis)];
    out.push({ id: `${el.id}_text`, kind: "text", pos, text: labelText, fontSize: 22, anchor: "middle", z: Z_TEXT, style, drawOpts: resolveDrawOpts(el.draw, { mode: "sketch", duration: SKETCH_MS.text }) });
  }
  ctx.anchors[el.id] = arcPt;
  ctx.namedAnchors[el.id] = { vertex: at, arc: arcPt };
  return out;
}
```

Add `case "angle": drawables.push(...angleDrawables(el, ctx)); break;` to the dispatch. Types: `ElementType` gains `"angle"`; on `SpecElement`, widen `from`/`to` to `EndRef | [number, number] | number` and add `label?: string | boolean` and `right?: boolean`; for `at`, the existing `point` field is `at?: { intersection_of?: string[]; x?: number; y?: number }` — widen it to `at?: { intersection_of?: string[]; x?: number; y?: number; ref?: string; anchor?: string } | [number, number]` and, in `resolvePointDomain` (the `point` element's reader), leave its behaviour unchanged for objects without `ref` (it never sees arrays because the schema's `point` description keeps them out — add `Array.isArray(at)` → return null with a warning there to be safe). Schema: `type` enum gains `"angle"`; `at` becomes `{ oneOf: [ the existing object with `ref`/`anchor` added, the two-number array ] }` with a description covering both uses; `from`/`to` become `{ oneOf: [ { type: "number" }, …pointRefSchema branches… ], description: "arrow/edge: endpoint (ref or x+y); angle: the arm — a point ({ref, anchor} or [x, y]) or a direction in degrees counter-clockwise from +x — e.g. from: {\"ref\": \"tri\", \"anchor\": \"vertex_2\"}." }` (build it from `endRefSchema.properties` and the array branch); `label: { oneOf: [{ type: "string" }, { type: "boolean" }], description: "angle/measure: the text — angle default the degrees (\"62°\"); false hides it; measure default \"{value}\" e.g. \"b = {value}\"." }`; `right: { type: "boolean", description: "angle: draw the right-angle square (default: automatically when the angle is 90°)." }`. Semantic check in `validateSpec`: `case "angle": need(el.at !== undefined && el.from !== undefined && el.to !== undefined, "needs at, from and to");`.

- [ ] **Step 4: Run**

Run: `npx vitest run tests/angle.test.ts tests/tier2.test.ts tests/anchors.test.ts tests/schema.test.ts && npx tsc --noEmit`
Expected: all PASS.

---

### Task 3: `measure` element — layout side

**Files:**
- Create: `src/layout/measures.ts`
- Modify: `src/layout/tier2.ts` (`case "measure"`; `measureDrawables`; `Ctx.measures`; `Tier2Result.measures`)
- Modify: `src/layout/layout.ts` (`LayoutResult.measures`)
- Modify: `src/spec/types.ts` (`"measure"`; fields `of?`, `what?`, `unit?`, `scale?`, `decimals?`, `offset?` — `side` exists for labels; `label` from Task 2), `src/spec/schema.ts` (enum, fields, semantic check "measure needs of, or from and to")
- Test: `tests/measure.test.ts` (new; the layout half)

**Interfaces:**
- Produces (`src/layout/measures.ts`):
  ```ts
  export type MeasureWhat = "length" | "width" | "height" | "area" | "perimeter";
  export interface MeasureFormat { label: string; unit?: string; scale: number; decimals?: number }
  export type PointSource = { ref: string; anchor: string } | { pt: Pt };
  export interface MeasureSpec { of?: string; what: MeasureWhat; from?: PointSource; to?: PointSource; side: "left" | "right"; offset: number; format: MeasureFormat; lineId: string; textId: string }
  export function segmentLength(a: Pt, b: Pt): number;
  export function ringArea(pts: Pt[]): number;        // |shoelace| / 2
  export function ringPerimeter(pts: Pt[]): number;   // closed
  export function ringCentroid(pts: Pt[]): Pt;        // vertex mean
  export function boxSize(pts: Pt[]): { w: number; h: number };
  export function measureValue(what: MeasureWhat, g: { a?: Pt; b?: Pt; ring?: Pt[] }): number | null;
  export function formatMeasure(value: number, f: MeasureFormat): string;
  export function dimensionLine(a: Pt, b: Pt, offset: number, side: "left" | "right", tick?: number): { line: [Pt, Pt]; ticks: [Pt, Pt][]; textPos: Pt };
  ```
  `side` is relative to the direction a → b (`left` = the left-hand normal). `textPos` is the line's midpoint pushed a further 16 units outward.
- Produces (layout): `Tier2Result.measures` / `LayoutResult.measures: Record<string, MeasureSpec>`; drawables `<id>` (the line), `<id>_guides` (the two ticks as one polyline of two segments — emit two stroke drawables `<id>_guides` is ONE polyline [t1a, t1b, t2a, t2b]? No: ticks are two separate segments; emit them as `<id>_guides` with `pts: [t1a, t1b]` and a second `<id>_guides_2`… `SUB_SUFFIXES` lists only fixed suffixes, so emit ONE stroke `<id>_guides` whose pts trace tick 1, back along the line, tick 2 — visually two ticks joined by the line itself (overlapping the main line). Simpler and honest: the main line `<id>` carries the ticks as the polyline `[t1a, t1b, a', b', t2a, t2b]`? A tick is perpendicular; the polyline `[t1a, t1b, t1mid, …]` doubles back. Decision: `<id>` = polyline `[t1a, t1b]` + `[a', b']` + `[t2a, t2b]` drawn as THREE stroke drawables `<id>` (the line), `<id>_guides` (tick 1) and `<id>_dot` (tick 2) — both suffixes exist in `SUB_SUFFIXES` (`guides`, `dot`) and are bundled by `drawablesForId`. Text `label_<id>` (a text drawable, fontSize 24, anchor middle, pushed to `ctx.extraOrder`).

- [ ] **Step 1: Write the failing tests**

Create `tests/measure.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { dimensionLine, formatMeasure, measureValue, ringArea, ringPerimeter } from "../src/layout/measures";
import { layoutSpec } from "../src/layout/layout";
import { heuristicMeasure } from "../src/layout/measure";
import { flattenDrawables } from "../src/layout/model";
import { validateSpec } from "../src/spec/schema";
import type { Spec } from "../src/spec/types";

const spec = (elements: unknown[]): Spec => ({ elements, commands: [] }) as unknown as Spec;
const textOf = (out: ReturnType<typeof layoutSpec>, id: string) => (flattenDrawables(out.drawables).find((d) => d.id === id) as { text?: string } | undefined)?.text;

describe("measure geometry", () => {
  test("area, perimeter, length, format", () => {
    const sq: [number, number][] = [[0, 0], [100, 0], [100, 100], [0, 100]];
    expect(ringArea(sq)).toBe(10000);
    expect(ringArea([...sq].reverse())).toBe(10000); // orientation-free
    expect(ringPerimeter(sq)).toBe(400);
    expect(measureValue("length", { a: [0, 0], b: [30, 40] })).toBe(50);
    expect(measureValue("width", { ring: sq })).toBe(100);
    expect(measureValue("area", { a: [0, 0] })).toBeNull();
    expect(formatMeasure(10000, { label: "{value}", scale: 1 })).toBe("10000");
    expect(formatMeasure(50, { label: "b = {value}", scale: 1 })).toBe("b = 50.0");
    expect(formatMeasure(250, { label: "{value}", scale: 100, unit: "cm", decimals: 1 })).toBe("2.5 cm");
  });
  test("dimensionLine offsets to the left of a→b, with ticks and the text further out", () => {
    const d = dimensionLine([0, 0], [100, 0], 24, "left");
    expect(d.line).toEqual([[0, 24], [100, 24]]);
    expect(d.ticks).toHaveLength(2);
    expect(d.textPos).toEqual([50, 40]);
    expect(dimensionLine([0, 0], [100, 0], 24, "right").line[0][1]).toBe(-24);
  });
});

describe("measure element (design §2.3)", () => {
  const sq = { id: "sq", type: "polygon", points: [[200, 200], [300, 200], [300, 300], [200, 300]], style: { fill: "#87a878" } };
  test("area of a polygon by default, as a text label_<id> at the centroid, recorded in layout.measures", () => {
    const out = layoutSpec(spec([sq, { id: "ar", type: "measure", of: "sq", label: "A = {value}" }]), heuristicMeasure);
    expect(out.warnings).toEqual([]);
    expect(textOf(out, "label_ar")).toBe("A = 10000");
    expect(out.order).toContain("label_ar");
    expect(out.measures.ar).toMatchObject({ of: "sq", what: "area", lineId: "ar", textId: "label_ar" });
    const t = flattenDrawables(out.drawables).find((d) => d.id === "label_ar") as { pos: [number, number] };
    expect(t.pos).toEqual([250, 250]);
  });
  test("a segment between two anchors draws a dimension line away from the element with ticks and the length", () => {
    const out = layoutSpec(spec([sq, { id: "side", type: "measure", from: { ref: "sq", anchor: "vertex_1" }, to: { ref: "sq", anchor: "vertex_2" }, label: "b = {value}", unit: "px" }]), heuristicMeasure);
    expect(out.warnings).toEqual([]);
    expect(textOf(out, "label_side")).toBe("b = 100 px");
    const line = flattenDrawables(out.drawables).find((d) => d.id === "side") as { pts: [number, number][] };
    expect(line.pts[0][1]).toBe(176); // below the bottom edge, away from the square's centroid
    expect(flattenDrawables(out.drawables).some((d) => d.id === "side_guides")).toBe(true);
    expect(out.measures.side.from).toEqual({ ref: "sq", anchor: "vertex_1" });
  });
  test("what: width/height/perimeter of an element; length of an arrow; scale and decimals", () => {
    const out = layoutSpec(spec([sq, { id: "arr", type: "arrow", from: { x: 500, y: 500 }, to: { x: 560, y: 580 } },
      { id: "w", type: "measure", of: "sq", what: "width", scale: 50, unit: "cm" },
      { id: "p", type: "measure", of: "sq", what: "perimeter" },
      { id: "l", type: "measure", of: "arr", decimals: 2 }]), heuristicMeasure);
    expect(out.warnings).toEqual([]);
    expect(textOf(out, "label_w")).toBe("2.0 cm");
    expect(textOf(out, "label_p")).toBe("400");
    expect(textOf(out, "label_l")).toBe("100.00");
    expect(out.measures.l.what).toBe("length");
  });
  test("schema: needs of, or from and to", () => {
    expect(validateSpec(spec([{ id: "m", type: "measure" }])).ok).toBe(false);
    expect(validateSpec(spec([sq, { id: "m", type: "measure", of: "sq" }])).ok).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/measure.test.ts`
Expected: FAIL — `src/layout/measures` missing.

- [ ] **Step 3: `src/layout/measures.ts`**

```ts
// Measure geometry (design §2.3): what a measure element reads off a
// figure, and how it is written. Pure — tier-2 lays the element out with
// it, and the planner recomputes with it after every step that moves or
// morphs what it measures.
import type { Pt } from "./model";

export type MeasureWhat = "length" | "width" | "height" | "area" | "perimeter";
export interface MeasureFormat { label: string; unit?: string; scale: number; decimals?: number }
export type PointSource = { ref: string; anchor: string } | { pt: Pt };
export interface MeasureSpec {
  of?: string;
  what: MeasureWhat;
  from?: PointSource;
  to?: PointSource;
  side: "left" | "right";
  offset: number;
  format: MeasureFormat;
  lineId: string;
  textId: string;
}

export function segmentLength(a: Pt, b: Pt): number {
  return Math.hypot(b[0] - a[0], b[1] - a[1]);
}

/** |shoelace| / 2 — orientation-free, so a mirrored ring measures the same. */
export function ringArea(pts: Pt[]): number {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    s += a[0] * b[1] - b[0] * a[1];
  }
  return Math.abs(s) / 2;
}

export function ringPerimeter(pts: Pt[]): number {
  let s = 0;
  for (let i = 0; i < pts.length; i++) s += segmentLength(pts[i], pts[(i + 1) % pts.length]);
  return s;
}

export function ringCentroid(pts: Pt[]): Pt {
  const n = Math.max(1, pts.length);
  return [pts.reduce((s, p) => s + p[0], 0) / n, pts.reduce((s, p) => s + p[1], 0) / n];
}

export function boxSize(pts: Pt[]): { w: number; h: number } {
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  return { w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
}

export function measureValue(what: MeasureWhat, g: { a?: Pt; b?: Pt; ring?: Pt[] }): number | null {
  if (what === "length") return g.a && g.b ? segmentLength(g.a, g.b) : g.ring && g.ring.length >= 2 ? segmentLength(g.ring[0], g.ring[g.ring.length - 1]) : null;
  if (!g.ring || g.ring.length < 2) return null;
  if (what === "width") return boxSize(g.ring).w;
  if (what === "height") return boxSize(g.ring).h;
  if (what === "perimeter") return ringPerimeter(g.ring);
  return g.ring.length >= 3 ? ringArea(g.ring) : null;
}

export function formatMeasure(value: number, f: MeasureFormat): string {
  const v = value / (f.scale || 1);
  const decimals = f.decimals ?? (Math.abs(v) >= 100 ? 0 : 1);
  const text = f.label.includes("{value}") ? f.label.replace("{value}", v.toFixed(decimals)) : `${f.label}${v.toFixed(decimals)}`;
  return f.unit ? `${text} ${f.unit}` : text;
}

/** The dimension line for a → b, offset to its `side` (left = the left-hand normal of a → b), with end ticks and the text spot 16 further out. */
export function dimensionLine(a: Pt, b: Pt, offset: number, side: "left" | "right", tick = 12): { line: [Pt, Pt]; ticks: [Pt, Pt][]; textPos: Pt } {
  const len = segmentLength(a, b) || 1;
  const ux = (b[0] - a[0]) / len, uy = (b[1] - a[1]) / len;
  const sgn = side === "left" ? 1 : -1;
  const nx = -uy * sgn, ny = ux * sgn;
  const A: Pt = [a[0] + nx * offset, a[1] + ny * offset];
  const B: Pt = [b[0] + nx * offset, b[1] + ny * offset];
  const t = tick / 2;
  const ticks: [Pt, Pt][] = [
    [[A[0] - nx * t, A[1] - ny * t], [A[0] + nx * t, A[1] + ny * t]],
    [[B[0] - nx * t, B[1] - ny * t], [B[0] + nx * t, B[1] + ny * t]],
  ];
  const textPos: Pt = [(A[0] + B[0]) / 2 + nx * 16, (A[1] + B[1]) / 2 + ny * 16];
  return { line: [A, B], ticks, textPos };
}
```

- [ ] **Step 4: Tier-2 `measure`**

In `src/layout/tier2.ts` (import the module as `M`): `Ctx.measures: Record<string, MeasureSpec>` (init `{}`), `Tier2Result.measures`, returned. The element:

```ts
/** The primary ring of an element laid out so far: its first closed leaf (area or closed stroke), else its first stroke's points. */
function primaryRingSoFar(ctx: Ctx, id: string): { pts: Pt[]; closed: boolean } | null {
  const leaves = leafDrawables(drawablesForId(ctx.drawablesSoFar, id)).filter((d): d is StrokeDrawable | AreaDrawable => d.kind === "stroke" || d.kind === "area");
  const closed = leaves.find((d) => d.kind === "area" || (d.kind === "stroke" && d.closed && !d.shapeHint));
  if (closed) return { pts: closed.pts, closed: true };
  const open = leaves.find((d) => d.kind === "stroke" && !d.shapeHint && d.pts.length >= 2);
  return open ? { pts: open.pts, closed: false } : null;
}

function measureDrawables(el: SpecElement, ctx: Ctx): Drawable[] {
  const format: M.MeasureFormat = { label: typeof el.label === "string" ? el.label : "{value}", unit: el.unit, scale: el.scale ?? 1, decimals: el.decimals };
  const textId = `label_${el.id}`;
  const style = resolveStyle(el.style, { strokeWidth: 2 });
  const drawOpts = resolveDrawOpts(el.draw, { duration: SKETCH_MS.guides });
  let a: Pt | null = null, b: Pt | null = null;
  let ring: Pt[] | null = null;
  let what: M.MeasureWhat;
  let fromSrc: M.PointSource | undefined, toSrc: M.PointSource | undefined;
  let awayFrom: Pt | null = null;
  const src = (p: PointRef | undefined): M.PointSource | undefined => (p === undefined ? undefined : !Array.isArray(p) && p.ref ? { ref: p.ref, anchor: p.anchor ?? "center" } : (() => { const pt = resolvePointRef(p, ctx); return pt ? { pt } : undefined; })());
  if (el.from !== undefined && el.to !== undefined) {
    a = resolvePointRef(el.from as PointRef, ctx);
    b = resolvePointRef(el.to as PointRef, ctx);
    fromSrc = src(el.from as PointRef);
    toSrc = src(el.to as PointRef);
    what = (el.what as M.MeasureWhat | undefined) ?? "length";
    const refId = !Array.isArray(el.from) && (el.from as EndRef).ref;
    if (refId) { const r = primaryRingSoFar(ctx, refId); if (r) awayFrom = M.ringCentroid(r.pts); }
  } else if (el.of !== undefined) {
    const r = primaryRingSoFar(ctx, el.of);
    if (!r) { ctx.warnings.push(`measure "${el.id}": "${el.of}" has nothing to measure`); return []; }
    ring = r.pts;
    what = (el.what as M.MeasureWhat | undefined) ?? (r.closed ? "area" : "length");
    if (what === "length") { a = r.pts[0]; b = r.pts[r.pts.length - 1]; }
    if (what === "width") { const xs = r.pts.map((p) => p[0]), ys = r.pts.map((p) => p[1]); const y = Math.min(...ys); a = [Math.min(...xs), y]; b = [Math.max(...xs), y]; }
    if (what === "height") { const xs = r.pts.map((p) => p[0]), ys = r.pts.map((p) => p[1]); const x = Math.max(...xs); a = [x, Math.min(...ys)]; b = [x, Math.max(...ys)]; }
    awayFrom = M.ringCentroid(r.pts);
  } else {
    ctx.warnings.push(`measure "${el.id}": needs of, or from and to`);
    return [];
  }
  const value = M.measureValue(what, { a: a ?? undefined, b: b ?? undefined, ring: ring ?? undefined });
  if (value === null || (what !== "area" && what !== "perimeter" && (!a || !b))) { ctx.warnings.push(`measure "${el.id}": cannot resolve what to measure`); return []; }
  const out: Drawable[] = [];
  let textPos: Pt;
  let side: "left" | "right" = "left";
  if (a && b && what !== "area" && what !== "perimeter") {
    if (el.side === "right" || el.side === "left") side = el.side;
    else if (awayFrom) {
      const cross = (b[0] - a[0]) * (awayFrom[1] - a[1]) - (b[1] - a[1]) * (awayFrom[0] - a[0]);
      side = cross > 0 ? "right" : "left"; // the centroid is on the left → put the line on the right
    }
    const d = M.dimensionLine(a, b, el.offset ?? 24, side);
    out.push({ id: el.id, kind: "stroke", pts: d.line, z: Z_STROKE, style, drawOpts });
    out.push({ id: `${el.id}_guides`, kind: "stroke", pts: d.ticks[0], z: Z_STROKE, style, drawOpts });
    out.push({ id: `${el.id}_dot`, kind: "stroke", pts: d.ticks[1], z: Z_STROKE, style, drawOpts });
    textPos = d.textPos;
    ctx.anchors[el.id] = [(d.line[0][0] + d.line[1][0]) / 2, (d.line[0][1] + d.line[1][1]) / 2];
  } else {
    textPos = ring ? (what === "perimeter" ? [M.ringCentroid(ring)[0], Math.max(...ring.map((p) => p[1])) + 26] : M.ringCentroid(ring)) : [CANVAS.w / 2, CANVAS.h / 2];
    ctx.anchors[el.id] = textPos;
  }
  out.push({ id: textId, kind: "text", pos: textPos, text: M.formatMeasure(value, format), fontSize: 24, anchor: "middle", z: Z_TEXT, style: resolveStyle(el.style), drawOpts: resolveDrawOpts(el.draw, { mode: "sketch", duration: SKETCH_MS.text }) });
  ctx.extraOrder.push(textId);
  ctx.anchors[textId] = textPos;
  ctx.measures[el.id] = { of: el.of, what, from: fromSrc, to: toSrc, side, offset: el.offset ?? 24, format, lineId: el.id, textId };
  return out;
}
```

(`side` for a from/to measure whose `from` is a literal point has no `awayFrom` → `left`.) Dispatch `case "measure"`. `layout.ts`: `measures: Record<string, MeasureSpec>` on `LayoutResult`, taken from `tier2.measures`, `{}` otherwise; every `LayoutResult` literal elsewhere gains `measures: {}` (tsc will list them). Types: `ElementType` gains `"measure"`; `SpecElement` gains `of?: string` (check: `portrait`/`source` already use `of` — same name, same type, fine), `what?: "length" | "width" | "height" | "area" | "perimeter"`, `unit?: string`, `scale?: number`, `decimals?: number`, `offset?: number`. Schema: enum; `what: { type: "string", enum: [...], description: "measure: what to read — length (a segment, arrow or path), width / height (of the element's box), area or perimeter (of its outline). Default: length for a segment, area for a closed shape." }`, `of` — the existing `of` description gains "measure: the element to measure"; `unit: { type: "string", description: "measure: appended to the value — \"cm\"." }`, `scale: { type: "number", exclusiveMinimum: 0, description: "measure: logical units per unit (default 1) — 50 with unit cm makes a 100-unit side read 2.0 cm." }`, `decimals: { type: "integer", minimum: 0, maximum: 4, description: "measure: decimals shown (default 0 when the value is 100 or more, else 1)." }`, `offset: { type: "number", description: "measure: how far the dimension line sits from the segment (default 24)." }`; the `side` description gains "measure: left/right of the segment's direction". Semantic check: `case "measure": need(el.of !== undefined || (el.from !== undefined && el.to !== undefined), "needs of, or from and to");`.

- [ ] **Step 5: Run**

Run: `npx vitest run tests/measure.test.ts tests/angle.test.ts tests/tier2.test.ts tests/schema.test.ts tests/text-style.test.ts && npx tsc --noEmit`
Expected: all PASS.

---

### Task 4: The measure follows — `texts` state, `setText`, recompute after motion

**Files:**
- Modify: `src/render/plan.ts` (`SceneState.texts`; `INITIAL_STATE`; the snapshot; `PlanOptions.measureOf`, `measuresDependingOn`; a `measureUpdates(changed)` closure; `transform` and `morph` steps gain `extraMorphs?`, `extraTransforms?`, `texts?`; every pose/morph branch calls it)
- Modify: `src/render/backend.ts` (`RenderedElement.setText`; `swapGeometry(…, shapes?, texts?)`), `src/render/svg-backend.ts` (`setText`; `buildNodes` substitutes text; `swapGeometry`)
- Modify: `src/render/player.ts` (`Reprojector.frame(…, shapes?, texts?)`; `applyScene`; `previewParams`/`previewSpec` forward `scene.texts`; the `transform` case tweens `extraMorphs`; the `morph` case tweens `extraTransforms`; both settle `texts`)
- Modify: `src/render/index.ts` (`planOptionsFor` returns `measureOf` and `measuresDependingOn`; the reprojector forwards `texts`)
- Modify: `src/llm/subtitles.ts` (the dummy options gain `measureOf: () => null`, `measuresDependingOn: () => []` — nothing to do, they are optional; verify)
- Test: `tests/measure.test.ts` (extend: the planner half), `tests/measure-backend.test.ts` (new; mini-DOM)

**Interfaces:**
- Produces: `SceneState.texts: Record<string, Record<string, string>>`; `PlanOptions.measureOf?: (id: string) => MeasureSpec | null`, `PlanOptions.measuresDependingOn?: (id: string) => string[]`; `export interface TextItem { id: string; leafId: string; text: string }`; steps `transform` and `morph` gain `extraMorphs?: MorphItem[]`, `extraTransforms?: TransformItem[]`, `texts?: TextItem[]`; `RenderedElement.setText?(texts: Record<string, string>): void`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/measure.test.ts`:

```ts
import { elementBBoxes } from "../src/layout/layout";
import { planCommands, type PlanStep } from "../src/render/plan";
import { planOptionsFor } from "../src/render/index";

describe("the measure follows (design §2.3)", () => {
  const sq = { id: "sq", type: "polygon", points: [[200, 200], [300, 200], [300, 300], [200, 300]], style: { fill: "#87a878" } };
  const els = [sq,
    { id: "ar", type: "measure", of: "sq", label: "A = {value}" },
    { id: "side", type: "measure", from: { ref: "sq", anchor: "vertex_1" }, to: { ref: "sq", anchor: "vertex_2" }, label: "b = {value}" },
    { id: "p", type: "point", at: { x: 600, y: 600 } },
    { id: "d", type: "measure", from: { ref: "p" }, to: { ref: "sq", anchor: "vertex_3" } }];
  const planOf = (commands: unknown[]) => {
    const s = { elements: els, commands: [{ draw: ["sq", "ar", "side", "p", "d"] }, ...commands] };
    const layout = layoutSpec(s as never, heuristicMeasure);
    const bboxes = elementBBoxes(layout, heuristicMeasure);
    return { layout, plan: planCommands(s.commands as never, layout.order, { bboxOf: (id) => bboxes.get(id) ?? null, ...planOptionsFor(s as never, layout) }) };
  };
  test("a scale ×2 about a corner writes A ×4 and b ×2, re-points the dimension line, and moves its label", () => {
    const { plan } = planOf([{ move: { target: ["sq"], scale: 2, pivot: { anchor: "bottom_left" } } }]);
    expect(plan.warnings).toEqual([]);
    const st = plan.states[1];
    expect(st.texts.label_ar.label_ar).toBe("A = 40000");
    expect(st.texts.label_side.label_side).toBe("b = 200");
    expect(st.shapes.side.side[1][0]).toBeCloseTo(400, 6); // the line now spans 200 → 400
    const step = plan.steps[1] as Extract<PlanStep, { kind: "transform" }>;
    expect(step.texts?.map((t) => t.id).sort()).toEqual(["label_ar", "label_d", "label_side"]);
    expect(step.extraMorphs?.some((m) => m.id === "side")).toBe(true);
    expect(st.offsets.label_side?.[0]).toBeCloseTo(50, 6); // the label slid to the new midpoint
  });
  test("a mirror keeps the area positive; a morph stretch doubles it; moving a from-ref point changes a segment measure", () => {
    const { layout, plan } = planOf([{ flip: { target: ["sq"] } }, { morph: { target: ["sq"], stretch: [2, 1] } }, { move: { target: ["p"], by: [0, -100] } }]);
    expect(plan.warnings).toEqual([]);
    expect(plan.states[1].texts.label_ar.label_ar).toBe("A = 10000");
    expect(plan.states[2].texts.label_ar.label_ar).toBe("A = 20000");
    // label_d depends on p (from) and sq (to): the flip and the stretch rewrite it, the move of p rewrites it again — every time to a different number
    const layoutText = textOf(layout, "label_d")!;
    const after1 = plan.states[1].texts.label_d.label_d;
    const after3 = plan.states[3].texts.label_d.label_d;
    expect(after1).not.toBe(layoutText);
    expect(after3).not.toBe(plan.states[2].texts.label_d.label_d);
  });
});
```

Create `tests/measure-backend.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { layoutSpec } from "../src/layout/layout";
import { heuristicMeasure } from "../src/layout/measure";
import { rendererFor } from "../src/render/svg-backend";
import { installMiniDom, FakeNode } from "./helpers/mini-dom";

const SPEC = { elements: [{ id: "sq", type: "polygon", points: [[200, 200], [300, 200], [300, 300], [200, 300]] }, { id: "ar", type: "measure", of: "sq", label: "A = {value}" }], commands: [{ draw: ["sq", "ar"] }] };

describe("setText on the SVG backend", () => {
  for (const style of ["clean", "sketchy"] as const) {
    test(`rewrites a text leaf's content and restores it when unlisted (${style})`, async () => {
      const { restore, doc } = installMiniDom();
      try {
        const layout = layoutSpec(SPEC as never, heuristicMeasure);
        const container = new FakeNode("div", doc as never);
        const mounted = await rendererFor(style).mount(layout, SPEC as never, container as never);
        const el = mounted.elements.get("label_ar")!;
        el.finish();
        const textNode = () => { const out: FakeNode[] = []; const walk = (n: FakeNode) => { if (n.tagName === "text") out.push(n); n.children.forEach(walk); }; walk(container); return out.find((t) => (t.textContent ?? "").includes("A = ")); };
        expect(textNode()!.textContent).toBe("A = 10000");
        el.setText!({ label_ar: "A = 40000" });
        expect(textNode()!.textContent).toBe("A = 40000");
        el.setText!({});
        expect(textNode()!.textContent).toBe("A = 10000");
      } finally {
        restore();
      }
    });
  }
});
```

(If the mini-DOM's `FakeNode` exposes text content under another name — check `tests/helpers/mini-dom.ts` — use that.)

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/measure.test.ts tests/measure-backend.test.ts`
Expected: FAIL — no `texts`, no `setText`.

- [ ] **Step 3: Backend `setText` and `texts` on tween frames**

`src/render/backend.ts`: `/** Rewrite the listed text leaves' content (keyed by leaf id); unlisted ones return to the layout's text. */ setText?(texts: Record<string, string>): void;` and `swapGeometry(…, shapes?, texts?: Record<string, Record<string, string>>)`. `src/render/svg-backend.ts`: in `SvgElementHandle` a `private currentText = new Map<string, string | null>()` and

```ts
  setText(texts: Record<string, string>): void {
    this.entries.forEach((e, i) => {
      const leaf = e.leaf;
      if (leaf.kind !== "text") return;
      const want = texts[leaf.id] ?? null;
      if (want === (this.currentText.get(leaf.id) ?? null)) return;
      this.currentText.set(leaf.id, want);
      const drawable = want !== null ? { ...leaf, text: want, lines: undefined } : leaf;
      const rebuilt = drawLeaf(this.rc, drawable);
      e.g.replaceChildren(...Array.from(rebuilt.children));
      this.leaves[i] = makeLeafHandle(e.g, drawable);
      this.leaves[i].prepare();
      this.leaves[i].setProgress(1);
    });
  }
```

`buildNodes` gains `texts?` after `shapes` and substitutes `{ ...leaf, text, lines: undefined }` for a text leaf with an entry; `swapGeometry` forwards it.

- [ ] **Step 4: Planner**

`src/render/plan.ts`: `SceneState.texts`; `INITIAL_STATE.texts = {}`; the local `const texts: Record<string, Record<string, string>> = {}` and its snapshot copy; `PlanOptions.measureOf`, `measuresDependingOn`; `export interface TextItem { id: string; leafId: string; text: string }`; the `transform` and `morph` step variants gain `extraMorphs?: MorphItem[]; extraTransforms?: TransformItem[]; texts?: TextItem[]`. After `followerItems` add:

```ts
  /** The current geometry a measure reads (design §2.3): a segment's ends through anchorNow, or the primary ring through the current pose. */
  const measureGeometryNow = (m: MeasureSpec): { a?: Pt; b?: Pt; ring?: Pt[] } | null => {
    const pointNow = (s: PointSource): Pt | null => ("pt" in s ? s.pt : anchorNow(s.ref, s.anchor, "measure"));
    if (m.from && m.to) {
      const a = pointNow(m.from), b = pointNow(m.to);
      return a && b ? { a, b } : null;
    }
    if (!m.of) return null;
    const leaves = currentLeaves(m.of);
    const primary = leaves?.find((l) => l.closed) ?? leaves?.[0];
    if (!primary) {
      // a shape circle/rect has no morphable leaves: measure its current box instead
      const box = currentBox(m.of);
      return box ? { ring: [[box.x, box.y], [box.x + box.w, box.y], [box.x + box.w, box.y + box.h], [box.x, box.y + box.h]] } : null;
    }
    const ring = primary.pts.map(poseOf(offsets[m.of] ?? [0, 0], turns[m.of]));
    if (m.what === "length") return { a: ring[0], b: ring[ring.length - 1], ring };
    if (m.what === "width") { const xs = ring.map((p) => p[0]), ys = ring.map((p) => p[1]); const y = Math.min(...ys); return { a: [Math.min(...xs), y], b: [Math.max(...xs), y], ring }; }
    if (m.what === "height") { const xs = ring.map((p) => p[0]), ys = ring.map((p) => p[1]); const x = Math.max(...xs); return { a: [x, Math.min(...ys)], b: [x, Math.max(...ys)], ring }; }
    return { ring };
  };
  /** After ids changed pose or shape: every measure depending on them is re-read — its line re-pointed (a morph of its own leaves), its label slid to the new spot, its value rewritten. */
  const measureUpdates = (changed: string[]): { extraMorphs: MorphItem[]; extraTransforms: TransformItem[]; texts: TextItem[] } => {
    const out = { extraMorphs: [] as MorphItem[], extraTransforms: [] as TransformItem[], texts: [] as TextItem[] };
    const seen = new Set<string>();
    for (const id of changed) for (const mid of opts.measuresDependingOn?.(id) ?? []) {
      if (seen.has(mid) || !known.has(mid)) continue;
      seen.add(mid);
      const m = opts.measureOf?.(mid);
      if (!m) continue;
      const g = measureGeometryNow(m);
      if (!g) continue;
      const value = measureValue(m.what, g);
      if (value === null) continue;
      const text = formatMeasure(value, m.format);
      let textPos: Pt;
      if (g.a && g.b && m.what !== "area" && m.what !== "perimeter") {
        const d = dimensionLine(g.a, g.b, m.offset, m.side);
        const cur = currentLeaves(m.lineId) ?? [];
        const targets: Record<string, Pt[]> = { [m.lineId]: d.line, [`${m.lineId}_guides`]: d.ticks[0], [`${m.lineId}_dot`]: d.ticks[1] };
        const next: Record<string, Pt[]> = {};
        for (const l of cur) {
          const to = targets[l.leafId];
          if (!to) continue;
          out.extraMorphs.push({ id: m.lineId, leaves: [{ leafId: l.leafId, from: l.pts, to }] });
          next[l.leafId] = to;
        }
        if (Object.keys(next).length > 0) shapes[m.lineId] = { ...(shapes[m.lineId] ?? {}), ...next };
        textPos = d.textPos;
      } else {
        textPos = g.ring ? (m.what === "perimeter" ? [ringCentroid(g.ring)[0], Math.max(...g.ring.map((p) => p[1])) + 26] : ringCentroid(g.ring)) : [0, 0];
      }
      const tb = bboxOf(m.textId);
      if (tb) {
        const o: Pt = offsets[m.textId] ?? [0, 0];
        const c: Pt = [tb.x + tb.w / 2 + o[0], tb.y + tb.h / 2 + o[1]];
        const nextOffset: Pt = [o[0] + textPos[0] - c[0], o[1] + textPos[1] - c[1]];
        out.extraTransforms.push({ id: m.textId, from: { offset: o, turn: turns[m.textId] ?? IDENTITY }, to: { offset: nextOffset, turn: turns[m.textId] ?? IDENTITY } });
        offsets[m.textId] = nextOffset;
      }
      texts[m.textId] = { ...(texts[m.textId] ?? {}), [m.textId]: text };
      out.texts.push({ id: m.textId, leafId: m.textId, text });
    }
    return out;
  };
```

(Collapse the per-leaf `extraMorphs` pushes into ONE `MorphItem` per `lineId` with several leaves.) Every branch that pushes a `transform` (move's pose half, arrange, flip) or `morph` step, and the plain-translation `move` step (convert its followers-only handling: a plain move of a measured element also re-reads — emit the updates onto a `transform`-less `move` step? A `move` step has no items; simplest: when `measureUpdates` returns anything non-empty for a plain move, push the `move` step as today and then an INSTANT `morph` step (seconds 0) carrying the extras, so the line and text snap into place at the end), calls `const upd = measureUpdates(ids)` AFTER the offsets/turns/shapes for the step are final and BEFORE `pushStep`, and spreads `{ ...upd }` onto the step when any list is non-empty. `measuresDependingOn` must also cover a `label_<id>` id? No — the label is the measure's own text. Note the measure ids themselves must never be treated as followers of what they measure (they are not `attach_to` labels), and the text `label_<id>` IS an attached follower of `<id>` (the line) by the `label_<id>` convention — so when the line is re-pointed via a morph, the text does NOT move by `followerItems` (morphs move no followers); it moves by the explicit `extraTransforms` above. Good.

`src/render/index.ts` `planOptionsFor`: `measureOf: (id) => layout.measures[id] ?? null`, `measuresDependingOn: (id) => Object.entries(layout.measures).filter(([, m]) => m.of === id || (m.from && "ref" in m.from && m.from.ref === id) || (m.to && "ref" in m.to && m.to.ref === id)).map(([k]) => k)`; widen the `Pick`. The reprojector's `frame` forwards `texts`.

- [ ] **Step 5: Player**

`Reprojector.frame(…, shapes?, texts?)`; `applyScene`: `el.setText?.(scene.texts[id] ?? {});`; `previewParams`/`previewSpec`: pass `scene.texts` after `scene.shapes`; the `animate` case passes `before.texts`. In the `transform` case's progress callback, after the items loop: tween `step.extraMorphs` exactly as the `morph` case tweens its items (`setPoints` with the leaf lerp, merged over `before.shapes[id]`); after the loop (guarded by `if (signal.aborted) return;`): settle `extraMorphs` onto `after.shapes[id] ?? {}` and apply `for (const t of step.texts ?? []) this.elements.get(t.id)?.setText?.({ ...(after.texts[t.id] ?? {}) })`. In the `morph` case: tween `step.extraTransforms` with `setTransform` like the transform case, and settle texts the same way. (Factor a private `settleTexts(step, after)` and `tweenMorphItems(items, e, before)` helper so the two cases share them.)

- [ ] **Step 6: Run**

Run: `npx vitest run tests/measure.test.ts tests/measure-backend.test.ts tests/morph.test.ts tests/plan.test.ts tests/player-raf.test.ts tests/fade-opacity.test.ts tests/subtitle-authoring.test.ts && npx tsc --noEmit`
Expected: all PASS (every `SceneState` literal in tests gains `texts: {}` — `tests/player-raf.test.ts` builds one).

---
### Task 5: `pieces` of `rings`, and `arrange: unroll`

**Files:**
- Modify: `src/layout/tier2.ts` (`PieceGeometry` gains `ring?: { rIn: number; rOut: number }` and `height?: number`; `ringPiecesDrawables`; `piecesDrawables` dispatches on `of`)
- Modify: `src/render/arrange.ts` (`ArrangeLayout` gains `"unroll"`; `ArrangeOutput.rect?`; `unrollRings`; zipper uses `height`)
- Modify: `src/render/plan.ts` (the `arrange` branch turns `rect` outputs into `extraMorphs`)
- Modify: `src/spec/types.ts` (`ArrangeArgs.layout` union), `src/spec/schema.ts` (`of` enum + description, `arrange.layout` enum + description, the `pieces` semantic check)
- Test: `tests/pieces-rings.test.ts` (new)

**Interfaces:**
- Consumes: `morphPair` (`src/render/morph.ts`), `MorphItem`, the transform step's `extraMorphs` (Task 4), `currentLeaves`, `filledOutline`, `AreaDrawable.holes` is NOT used (a keyhole polygon instead — a morph cannot carry a hole).
- Produces: `export function unrollRings(items: ArrangeInput[], at: Pt): { id: string; rect: Pt[] }[]` in `arrange.ts` (rect = the strip's four corners `[x0, y], [x0 + L, y], [x0 + L, y + h], [x0, y + h]`, innermost ring at the bottom, left ends aligned at `x0 = at[0] − Lmax / 2`, the stack centred vertically on `at`); ring piece ids `<id>_k` (outer circle stroke), `<id>_k_body` (inner circle stroke, absent for k = 1), `<id>_k_wash` (the keyhole area).

- [ ] **Step 1: Write the failing tests**

Create `tests/pieces-rings.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { layoutSpec, elementBBoxes } from "../src/layout/layout";
import { heuristicMeasure } from "../src/layout/measure";
import { flattenDrawables } from "../src/layout/model";
import { planCommands, type PlanStep } from "../src/render/plan";
import { planOptionsFor } from "../src/render/index";
import { unrollRings } from "../src/render/arrange";
import type { Spec } from "../src/spec/types";

const spec = (elements: unknown[], commands: unknown[] = []): Spec => ({ elements, commands }) as unknown as Spec;

describe("pieces of rings (design §2.4)", () => {
  test("n annuli of equal width, innermost first, each an outer stroke, an inner stroke and a keyhole wash, with ring geometry", () => {
    const out = layoutSpec(spec([{ id: "r", type: "pieces", of: "rings", x: 300, y: 400, radius: 120, n: 4, style: { fill: "#2f6b8f" } }]), heuristicMeasure);
    expect(out.warnings).toEqual([]);
    expect(out.pieceGroups.r).toEqual(["r_1", "r_2", "r_3", "r_4"]);
    expect(out.pieces.r_1.ring).toEqual({ rIn: 0, rOut: 30 });
    expect(out.pieces.r_4.ring).toEqual({ rIn: 90, rOut: 120 });
    expect(out.pieces.r_4.apex).toEqual([300, 400]);
    expect(out.pieces.r_4.radius).toBe(120);
    const ids = flattenDrawables(out.drawables).map((d) => d.id);
    expect(ids).toContain("r_4");
    expect(ids).toContain("r_4_body");
    expect(ids).toContain("r_4_wash");
    expect(ids).not.toContain("r_1_body");
    const wash = flattenDrawables(out.drawables).find((d) => d.id === "r_4_wash") as { pts: [number, number][] };
    const radii = wash.pts.map((p) => Math.hypot(p[0] - 300, p[1] - 400));
    expect(Math.max(...radii)).toBeCloseTo(120, 6);
    expect(Math.min(...radii)).toBeCloseTo(90, 6);
  });
  test("unrollRings: strip k is 2π·r_mid long and (rOut − rIn) high, stacked bottom-up with left ends aligned", () => {
    const piece = (k: number) => ({ id: `r_${k}`, box: { x: 0, y: 0, w: 1, h: 1 }, centre: [0, 0] as [number, number], pose: { offset: [0, 0] as [number, number], turn: undefined }, piece: { apex: [300, 400] as [number, number], centroid: [300, 400] as [number, number], midAngle: 90, halfAngle: 180, radius: 30 * k, ring: { rIn: 30 * (k - 1), rOut: 30 * k } } });
    const out = unrollRings([piece(1), piece(2), piece(3), piece(4)], [600, 400]);
    expect(out.map((o) => o.id)).toEqual(["r_1", "r_2", "r_3", "r_4"]);
    const len = (r: { rect: [number, number][] }) => r.rect[1][0] - r.rect[0][0];
    expect(len(out[3] as never)).toBeCloseTo(2 * Math.PI * 105, 6);
    expect(len(out[0] as never)).toBeCloseTo(2 * Math.PI * 15, 6);
    expect(out[0].rect[0][1]).toBeCloseTo(400 - 60, 6); // four strips of 30 → 120 high, centred on 400
    expect(out[3].rect[0][1]).toBeCloseTo(400 + 30, 6);
    expect(out[0].rect[0][0]).toBeCloseTo(out[3].rect[0][0], 6); // left ends aligned
    expect(out[3].rect[2][1] - out[3].rect[0][1]).toBeCloseTo(30, 6);
  });
  test("arrange unroll morphs every ring's leaves into its strip; a non-ring target warns and is laid out as a row", () => {
    const s = spec([{ id: "r", type: "pieces", of: "rings", x: 300, y: 400, radius: 120, n: 3, style: { fill: "#2f6b8f" } }, { id: "sq", type: "polygon", points: [[700, 100], [760, 100], [760, 160], [700, 160]] }],
      [{ draw: ["r", "sq"] }, { arrange: { target: "r", layout: "unroll", at: [600, 400], duration: 2 } }, { arrange: { target: ["sq"], layout: "unroll" } }]);
    const layout = layoutSpec(s, heuristicMeasure);
    const bboxes = elementBBoxes(layout, heuristicMeasure);
    const plan = planCommands(s.commands, layout.order, { bboxOf: (id) => bboxes.get(id) ?? null, ...planOptionsFor(s, layout) });
    const step = plan.steps[1] as Extract<PlanStep, { kind: "transform" }>;
    expect(step.extraMorphs?.map((m) => m.id)).toEqual(["r_1", "r_2", "r_3"]);
    const r3 = step.extraMorphs!.find((m) => m.id === "r_3")!;
    expect(r3.leaves.map((l) => l.leafId).sort()).toEqual(["r_3", "r_3_body", "r_3_wash"]);
    const xs = r3.leaves[0].to.map((p) => p[0]);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(2 * Math.PI * 100, 0); // the resampled rectangle keeps its corners within a unit
    expect(plan.states[1].shapes.r_3).toBeDefined();
    expect(plan.warnings.join(" ")).toMatch(/unroll/);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/pieces-rings.test.ts`
Expected: FAIL.

- [ ] **Step 3: Tier-2 rings**

In `src/layout/tier2.ts`, `PieceGeometry` gains `/** A ring piece: its inner and outer radii (pieces of rings). */ ring?: { rIn: number; rOut: number };` and `/** The piece's height across its apex-to-base direction (a triangle's apothem); absent = radius. */ height?: number;`. In `piecesDrawables`, before the sector code: `if (el.of === "rings") return ringPiecesDrawables(el, ctx, c);`.

```ts
/** A circle of points, counter-clockwise from +x. */
function circlePts(c: Pt, r: number, n = 48): Pt[] {
  return Array.from({ length: n }, (_, i): Pt => [c[0] + r * Math.cos((2 * Math.PI * i) / n), c[1] + r * Math.sin((2 * Math.PI * i) / n)]);
}

/**
 * `pieces: {of: "rings"}` — n concentric annuli of equal width, `<id>_1` the
 * innermost. The wash is a KEYHOLE polygon (the outer circle, a seam in to
 * the inner circle walked the other way, and back), not an area with a hole,
 * so a morph can straighten it into a strip (design §2.4).
 */
function ringPiecesDrawables(el: SpecElement, ctx: Ctx, c: Pt): Drawable[] {
  const R = el.radius ?? 120;
  const n = Math.max(1, Math.min(64, Math.round(el.n ?? 6)));
  const w = R / n;
  const style = resolveStyle(el.style);
  const out: Drawable[] = [];
  const ids: string[] = [];
  for (let k = 0; k < n; k++) {
    const rIn = k * w, rOut = (k + 1) * w;
    const id = `${el.id}_${k + 1}`;
    const outer = circlePts(c, rOut);
    const inner = rIn > 0 ? circlePts(c, rIn).reverse() : [];
    const keyhole: Pt[] = rIn > 0 ? [...outer, outer[0], inner[inner.length - 1], ...inner] : outer;
    if (style.fill) out.push({ id: `${id}_wash`, kind: "area", pts: keyhole, z: Z_AREA, style: resolveStyle(el.style, { opacity: 0.35 }), drawOpts: resolveDrawOpts(el.draw, { mode: "sketch", duration: SKETCH_MS.region }) });
    out.push({ id, kind: "stroke", pts: outer, closed: true, z: Z_STROKE, style, drawOpts: resolveDrawOpts(el.draw) });
    if (rIn > 0) out.push({ id: `${id}_body`, kind: "stroke", pts: circlePts(c, rIn), closed: true, z: Z_STROKE, style, drawOpts: resolveDrawOpts(el.draw) });
    const mid = (rIn + rOut) / 2;
    const centroid: Pt = [c[0], c[1] + mid];
    ctx.anchors[id] = centroid;
    ctx.pieces[id] = { apex: c, centroid, midAngle: 90, halfAngle: 180, radius: rOut, ring: { rIn, rOut } };
    ids.push(id);
    ctx.extraOrder.push(id);
  }
  ctx.pieceGroups[el.id] = ids;
  ctx.anchors[el.id] = c;
  return out;
}
```

Schema: `of` enum gains `"rings"` with description text "\"rings\" (n concentric rings of a circle of radius at x, y — unroll them with arrange)"; the semantic check accepts `"rings"` (needs radius). `validateSpec`'s pieces check: `need(["sectors", "strips", "grid", "rings", "triangles", "halving"].includes(el.of), …)` (Task 6 adds the last two; write the list now).

- [ ] **Step 4: `unroll`**

`src/render/arrange.ts`: `ArrangeLayout` gains `"unroll"`; `ArrangeOutput` gains `/** unroll: the strip this ring straightens into (four corners, current coordinates). */ rect?: Pt[];`.

```ts
/** Ring pieces straightened into strips (design §2.4): strip k is 2π·r_mid long and (rOut − rIn) high; innermost at the bottom, left ends aligned, the stack centred on `at`. */
export function unrollRings(items: ArrangeInput[], at: Pt): { id: string; rect: Pt[] }[] {
  const rings = items.filter((i) => i.piece?.ring).sort((a, b) => a.piece!.ring!.rIn - b.piece!.ring!.rIn);
  const strips = rings.map((i) => ({ id: i.id, len: 2 * Math.PI * ((i.piece!.ring!.rIn + i.piece!.ring!.rOut) / 2), h: i.piece!.ring!.rOut - i.piece!.ring!.rIn }));
  const total = strips.reduce((s, x) => s + x.h, 0);
  const lmax = Math.max(...strips.map((s) => s.len));
  const x0 = at[0] - lmax / 2;
  let y = at[1] - total / 2;
  return strips.map((s) => {
    const rect: Pt[] = [[x0, y], [x0 + s.len, y], [x0 + s.len, y + s.h], [x0, y + s.h]];
    y += s.h;
    return { id: s.id, rect };
  });
}
```

In `arrangeTargets`: `if (layout === "unroll") { const rings = items.filter((i) => i.piece?.ring); const others = items.filter((i) => !i.piece?.ring); const out: ArrangeOutput[] = unrollRings(rings, at); if (rings.length > 0) out.push(...othersRow(others, at, Math.max(...rings.map((i) => i.piece!.ring!.rOut)), gap, 90)); else out.push(...arrangeTargets(others, "row", opts)); return out; }`. In `zipper`, `const h = sectors[0].piece!.height ?? r;` and `apexTo: [x0 + k * s, at[1] + (up ? -h / 2 : h / 2)]`.

Planner (`arrange` branch): after `placed`, warn `arrange unroll: none of the targets is a ring piece — laid out as a row instead` when the layout is `unroll` and no input has `piece?.ring`; for each `p` with `rect`: `const leaves = currentLeaves(p.id) ?? []; const inv = poseOf(input.pose.offset, input.pose.turn, true); const item: MorphItem = { id: p.id, leaves: [] }; const next = {}; for (const l of leaves) { const pair = morphPair(l.pts, l.closed, p.rect.map(inv), true); item.leaves.push({ leafId: l.leafId, from: pair.from, to: pair.to }); next[l.leafId] = pair.to; } shapes[p.id] = next; extraMorphs.push(item);` and pass `extraMorphs` on the `transform` step (skip the `items` push for a `rect` output — its pose does not change). Then `measureUpdates(ids)` as Task 4 wires it.

- [ ] **Step 5: Run**

Run: `npx vitest run tests/pieces-rings.test.ts tests/arrange.test.ts tests/arrange-fan-hex.test.ts tests/primitives.test.ts tests/pieces-rect.test.ts tests/schema.test.ts && npx tsc --noEmit`
Expected: all PASS.

---

### Task 6: `pieces` of `triangles` and `halving`

**Files:**
- Modify: `src/layout/tier2.ts` (`trianglePiecesDrawables`, `halvingPiecesDrawables`; dispatch in `piecesDrawables`)
- Modify: `src/spec/types.ts` (`SpecElement.from` already widened; `of` enum), `src/spec/schema.ts` (`of` enum + description; `from` description gains the triangles use; semantic check)
- Test: `tests/pieces-triangles.test.ts` (new)

**Interfaces:**
- Produces: triangle piece ids `<id>_k` with `filledOutline`, `pieces[id] = { apex, centroid, midAngle, halfAngle, radius: circumradius, height: apothem }` and `namedAnchors[id] = { apex, base (the base midpoint), vertex_1..3, side_1..3, centroid }`; halving piece ids `<id>_1 … <id>_n` and `<id>_rest` (boxes, no piece geometry), all in `pieceGroups[id]`.

- [ ] **Step 1: Write the failing tests**

Create `tests/pieces-triangles.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { layoutSpec, elementBBoxes } from "../src/layout/layout";
import { heuristicMeasure } from "../src/layout/measure";
import { flattenDrawables } from "../src/layout/model";
import { planCommands, type PlanStep } from "../src/render/plan";
import { planOptionsFor } from "../src/render/index";
import { poseOf } from "../src/render/pose";
import type { Spec } from "../src/spec/types";

const spec = (elements: unknown[], commands: unknown[] = []): Spec => ({ elements, commands }) as unknown as Spec;

describe("pieces of triangles (design §2.4)", () => {
  test("a regular hexagon fans into six triangles from the centre with sector-like geometry and apex/base anchors", () => {
    const out = layoutSpec(spec([{ id: "t", type: "pieces", of: "triangles", x: 300, y: 400, radius: 120, sides: 6, style: { fill: "#f2c14e" } }]), heuristicMeasure);
    expect(out.warnings).toEqual([]);
    expect(out.pieceGroups.t).toHaveLength(6);
    const g = out.pieces.t_1;
    expect(g.apex).toEqual([300, 400]);
    expect(g.halfAngle).toBeCloseTo(30, 6);
    expect(g.radius).toBeCloseTo(120, 6);
    expect(g.height).toBeCloseTo(120 * Math.cos(Math.PI / 6), 6);
    expect(out.namedAnchors.t_1.apex).toEqual([300, 400]);
    expect(Math.hypot(out.namedAnchors.t_1.base[0] - 300, out.namedAnchors.t_1.base[1] - 400)).toBeCloseTo(g.height!, 6);
    const tri = flattenDrawables(out.drawables).find((d) => d.id === "t_1") as { pts: [number, number][] };
    expect(tri.pts).toHaveLength(3);
  });
  test("zipping the six triangles makes a parallelogram of height = apothem", () => {
    const s = spec([{ id: "t", type: "pieces", of: "triangles", x: 300, y: 400, radius: 120, sides: 6, style: { fill: "#f2c14e" } }], [{ draw: ["t"] }, { arrange: { target: "t", layout: "zipper", at: [650, 400] } }]);
    const layout = layoutSpec(s, heuristicMeasure);
    const bboxes = elementBBoxes(layout, heuristicMeasure);
    const plan = planCommands(s.commands, layout.order, { bboxOf: (id) => bboxes.get(id) ?? null, ...planOptionsFor(s, layout) });
    expect(plan.warnings).toEqual([]);
    const st = plan.states[1];
    const apexY = (id: string) => poseOf(st.offsets[id], st.turns[id])(layout.pieces[id].apex)[1];
    const h = layout.pieces.t_1.height!;
    expect(apexY("t_1")).toBeCloseTo(400 - h / 2, 6);
    expect(apexY("t_2")).toBeCloseTo(400 + h / 2, 6);
  });
  test("a polygon given by points fans from vertex_1 by default, or from the named vertex", () => {
    const out = layoutSpec(spec([{ id: "q", type: "pieces", of: "triangles", points: [[100, 100], [400, 100], [400, 300], [100, 300]], from: "vertex_2" }]), heuristicMeasure);
    expect(out.warnings).toEqual([]);
    expect(out.pieceGroups.q).toHaveLength(2);
    expect(out.pieces.q_1.apex).toEqual([400, 100]);
  });
});

describe("pieces of halving", () => {
  test("halves alternate vertical then horizontal; the remainder is <id>_rest; all in the group", () => {
    const out = layoutSpec(spec([{ id: "h", type: "pieces", of: "halving", x: 500, y: 375, width: 400, height: 400, n: 3, style: { fill: "#2f6b8f" } }]), heuristicMeasure);
    expect(out.warnings).toEqual([]);
    expect(out.pieceGroups.h).toEqual(["h_1", "h_2", "h_3", "h_rest"]);
    const box = (id: string) => { const d = flattenDrawables(out.drawables).find((x) => x.id === id) as { pts: [number, number][] }; const xs = d.pts.map((p) => p[0]), ys = d.pts.map((p) => p[1]); return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) }; };
    expect(box("h_1")).toEqual({ x: 300, y: 175, w: 200, h: 400 });
    expect(box("h_2")).toEqual({ x: 500, y: 375, w: 200, h: 200 });
    expect(box("h_3")).toEqual({ x: 500, y: 175, w: 100, h: 200 });
    expect(box("h_rest")).toEqual({ x: 600, y: 175, w: 100, h: 200 });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/pieces-triangles.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

In `piecesDrawables`: `if (el.of === "triangles") return trianglePiecesDrawables(el, ctx, c); if (el.of === "halving") return halvingPiecesDrawables(el, ctx, c);`.

```ts
/** `pieces: {of: "triangles"}` — a polygon fanned into triangles from a vertex (points) or its centre (regular); each carries sector-like geometry so fan and zipper take it. */
function trianglePiecesDrawables(el: SpecElement, ctx: Ctx, c: Pt): Drawable[] {
  let verts: Pt[];
  let apexIndex: number | null = null; // null = fan from the centre
  if (el.points && el.points.length >= 3) {
    verts = el.points as Pt[];
    const m = /^vertex_(\d+)$/.exec(typeof el.from === "string" ? el.from : "vertex_1");
    apexIndex = Math.max(0, Math.min(verts.length - 1, (m ? Number(m[1]) : 1) - 1));
  } else {
    const n = Math.max(3, Math.round(el.sides ?? 6));
    const r = el.radius ?? 100;
    const rot = (el.rotation ?? 0) * DEG;
    verts = Array.from({ length: n }, (_, i): Pt => { const a = rot + Math.PI / 2 + (2 * Math.PI * i) / n; return [c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)]; });
    if (typeof el.from === "string" && /^vertex_\d+$/.test(el.from)) apexIndex = Number(el.from.slice(7)) - 1;
  }
  const tris: { apex: Pt; a: Pt; b: Pt }[] = [];
  if (apexIndex === null) {
    for (let i = 0; i < verts.length; i++) tris.push({ apex: c, a: verts[i], b: verts[(i + 1) % verts.length] });
  } else {
    const apex = verts[apexIndex];
    for (let s = 1; s + 1 < verts.length; s++) tris.push({ apex, a: verts[(apexIndex + s) % verts.length], b: verts[(apexIndex + s + 1) % verts.length] });
  }
  const out: Drawable[] = [];
  const ids: string[] = [];
  tris.forEach((t, k) => {
    const id = `${el.id}_${k + 1}`;
    const pts = [t.apex, t.a, t.b];
    out.push(...filledOutline(id, pts, el));
    const base: Pt = [(t.a[0] + t.b[0]) / 2, (t.a[1] + t.b[1]) / 2];
    const mid = (Math.atan2(base[1] - t.apex[1], base[0] - t.apex[0]) * 180) / Math.PI;
    const da = (Math.atan2(t.a[1] - t.apex[1], t.a[0] - t.apex[0]) * 180) / Math.PI;
    const db = (Math.atan2(t.b[1] - t.apex[1], t.b[0] - t.apex[0]) * 180) / Math.PI;
    let span = Math.abs(((db - da + 540) % 360) - 180);
    const height = Math.hypot(base[0] - t.apex[0], base[1] - t.apex[1]);
    const radius = Math.max(Math.hypot(t.a[0] - t.apex[0], t.a[1] - t.apex[1]), Math.hypot(t.b[0] - t.apex[0], t.b[1] - t.apex[1]));
    const centroid = centroidOf3(pts);
    ctx.anchors[id] = centroid;
    ctx.pieces[id] = { apex: t.apex, centroid, midAngle: mid, halfAngle: span / 2, radius, height };
    ctx.namedAnchors[id] = { ...polygonAnchors(pts), apex: t.apex, base };
    ids.push(id);
    ctx.extraOrder.push(id);
  });
  ctx.pieceGroups[el.id] = ids;
  ctx.anchors[el.id] = apexIndex === null ? c : verts[apexIndex];
  return out;
}

/** `pieces: {of: "halving"}` — a rectangle halved n times, vertically then horizontally in turn; `<id>_rest` is what is left. */
function halvingPiecesDrawables(el: SpecElement, ctx: Ctx, c: Pt): Drawable[] {
  const w = el.width ?? 400, h = el.height ?? 400;
  const n = Math.max(1, Math.min(20, Math.round(el.n ?? 4)));
  let rest = { x: c[0] - w / 2, y: c[1] - h / 2, w, h };
  const out: Drawable[] = [];
  const ids: string[] = [];
  const emit = (id: string, b: { x: number; y: number; w: number; h: number }) => {
    const pts: Pt[] = [[b.x, b.y], [b.x + b.w, b.y], [b.x + b.w, b.y + b.h], [b.x, b.y + b.h]];
    out.push(...filledOutline(id, pts, el));
    ctx.anchors[id] = [b.x + b.w / 2, b.y + b.h / 2];
    ids.push(id);
    ctx.extraOrder.push(id);
  };
  for (let k = 1; k <= n; k++) {
    if (k % 2 === 1) { emit(`${el.id}_${k}`, { ...rest, w: rest.w / 2 }); rest = { ...rest, x: rest.x + rest.w / 2, w: rest.w / 2 }; }
    else { emit(`${el.id}_${k}`, { ...rest, y: rest.y + rest.h / 2, h: rest.h / 2 }); rest = { ...rest, h: rest.h / 2 }; }
  }
  emit(`${el.id}_rest`, rest);
  ctx.pieceGroups[el.id] = ids;
  ctx.anchors[el.id] = c;
  return out;
}
```

(`centroidOf3` = the vertex mean; use `centroid` from `./geometry`.) Schema: `of` enum gains `"triangles"`, `"halving"` with descriptions ("\"triangles\" fans a regular polygon (sides + radius) or a polygon (points, from: \"vertex_k\") into triangles; \"halving\" halves a width × height rectangle n times, alternately, with `<id>_rest` the remainder — 1/2 + 1/4 + …"); the `from` description gains "pieces of triangles: the vertex to fan from (\"vertex_1\")"; `SpecElement.from` accepts a string. Semantic: triangles need `sides + radius` or `points`; halving needs width, height, n. A numbered author id colliding with `<id>_rest` is a validation error like `<id>_k` (extend the existing collision check).

- [ ] **Step 4: Run**

Run: `npx vitest run tests/pieces-triangles.test.ts tests/pieces-rings.test.ts tests/arrange.test.ts tests/primitives.test.ts tests/schema.test.ts && npx tsc --noEmit`
Expected: all PASS.

---

### Task 7: `ellipse` and `line` elements

**Files:**
- Modify: `src/layout/tier2.ts` (`ellipseDrawables`, `lineDrawable`, `clipToBox`; dispatch)
- Modify: `src/spec/types.ts` (`"ellipse"`, `"line"`; `rx?`, `ry?`, `through?: PointRef[]`, `slope?`, `angle?`), `src/spec/schema.ts` (enum, fields, semantic checks)
- Test: `tests/ellipse-line.test.ts` (new)

**Interfaces:**
- Produces: `ellipse` → `filledOutline` (48 points, counter-clockwise from the +x end of the major axis, rotated by `rotation`), `namedAnchors[id] = { focus_1, focus_2 }` (on the major axis, `focus_1` the one toward −x before rotation); `line` → stroke `<id>` `[A, B]` clipped to the plot box (domain declared) or the canvas, `namedAnchors[id] = { start: A, end: B, mid, point_1[, point_2] }`; `clipToBox(P: Pt, d: Pt, box: { x0, x1, y0, y1 }): [Pt, Pt] | null`.

- [ ] **Step 1: Write the failing tests**

Create `tests/ellipse-line.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { layoutSpec } from "../src/layout/layout";
import { heuristicMeasure } from "../src/layout/measure";
import { flattenDrawables } from "../src/layout/model";
import { validateSpec } from "../src/spec/schema";
import type { Spec } from "../src/spec/types";

const spec = (elements: unknown[], domain?: unknown): Spec => ({ elements, commands: [], ...(domain ? { domain } : {}) }) as unknown as Spec;
const pts = (out: ReturnType<typeof layoutSpec>, id: string) => (flattenDrawables(out.drawables).find((d) => d.id === id) as { pts: [number, number][] }).pts;

describe("ellipse (design §2.5)", () => {
  test("a closed outline with a wash, 48 points on the ellipse, foci on the major axis", () => {
    const out = layoutSpec(spec([{ id: "e", type: "ellipse", x: 500, y: 375, rx: 300, ry: 180, style: { fill: "#87a878" } }]), heuristicMeasure);
    expect(out.warnings).toEqual([]);
    const ring = pts(out, "e");
    expect(ring).toHaveLength(48);
    for (const [x, y] of ring) expect(((x - 500) / 300) ** 2 + ((y - 375) / 180) ** 2).toBeCloseTo(1, 6);
    expect(flattenDrawables(out.drawables).some((d) => d.id === "e_wash")).toBe(true);
    expect(out.namedAnchors.e.focus_1).toEqual([260, 375]);
    expect(out.namedAnchors.e.focus_2).toEqual([740, 375]);
  });
  test("a tall ellipse has its foci on the vertical axis; rotation turns everything", () => {
    const out = layoutSpec(spec([{ id: "e", type: "ellipse", x: 500, y: 375, rx: 100, ry: 200, rotation: 90 }]), heuristicMeasure);
    const f1 = out.namedAnchors.e.focus_1, f2 = out.namedAnchors.e.focus_2;
    // rotation 90 turns the vertical major axis onto the horizontal: foci at 500 ± sqrt(200² − 100²) in x
    expect(Math.abs(f1[0] - f2[0])).toBeCloseTo(2 * Math.sqrt(30000), 4);
    expect(f1[1]).toBeCloseTo(375, 4);
  });
});

describe("line (design §2.5)", () => {
  test("through two anchors, clipped to the canvas, with start/end/mid/point anchors", () => {
    const out = layoutSpec(spec([{ id: "tri", type: "polygon", points: [[200, 250], [600, 250], [450, 500]] }, { id: "l", type: "line", through: [{ ref: "tri", anchor: "vertex_1" }, { ref: "tri", anchor: "vertex_2" }], style: { dash: true } }]), heuristicMeasure);
    expect(out.warnings).toEqual([]);
    const [a, b] = pts(out, "l");
    expect(a).toEqual([0, 250]);
    expect(b).toEqual([1000, 250]);
    expect(out.namedAnchors.l.point_2).toEqual([600, 250]);
    expect(out.namedAnchors.l.mid).toEqual([500, 250]);
  });
  test("through one point with an angle; with a slope in domain units, clipped to the plot box", () => {
    const out = layoutSpec(spec([{ id: "d", type: "line", through: [[500, 375]], angle: 45 }]), heuristicMeasure);
    const [a, b] = pts(out, "d");
    expect(a[1] - a[0]).toBeCloseTo(375 - 500, 6); // y − x is constant along a 45° line
    expect(b[1] - b[0]).toBeCloseTo(375 - 500, 6);
    const dom = layoutSpec(spec([{ id: "ax", type: "axes", x_label: "x", y_label: "y" }, { id: "s", type: "line", through: [[0, 0]], slope: 1 }], { x: [0, 100], y: [0, 100] }), heuristicMeasure);
    expect(dom.warnings).toEqual([]);
    const [p, q] = pts(dom, "s");
    expect(q[0] - p[0]).toBeGreaterThan(0);
    expect(q[1] - p[1]).toBeGreaterThan(0);
  });
  test("schema: ellipse needs rx and ry; line needs through, and with one point a slope or an angle", () => {
    expect(validateSpec(spec([{ id: "e", type: "ellipse", x: 1, y: 1, rx: 10 }])).ok).toBe(false);
    expect(validateSpec(spec([{ id: "l", type: "line", through: [[0, 0]] }])).ok).toBe(false);
    expect(validateSpec(spec([{ id: "l", type: "line", through: [[0, 0]], angle: 30 }])).ok).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/ellipse-line.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
function ellipseDrawables(el: SpecElement, ctx: Ctx): Drawable[] {
  const c: Pt = [el.x ?? CANVAS.w / 2, el.y ?? CANVAS.h / 2];
  const rx = el.rx ?? 150, ry = el.ry ?? 100;
  const rot = (el.rotation ?? 0) * DEG;
  const turn = (p: Pt): Pt => [c[0] + (p[0] - c[0]) * Math.cos(rot) - (p[1] - c[1]) * Math.sin(rot), c[1] + (p[0] - c[0]) * Math.sin(rot) + (p[1] - c[1]) * Math.cos(rot)];
  const pts = Array.from({ length: 48 }, (_, i): Pt => turn([c[0] + rx * Math.cos((2 * Math.PI * i) / 48), c[1] + ry * Math.sin((2 * Math.PI * i) / 48)]));
  const f = Math.sqrt(Math.abs(rx * rx - ry * ry));
  const [f1, f2]: [Pt, Pt] = rx >= ry ? [turn([c[0] - f, c[1]]), turn([c[0] + f, c[1]])] : [turn([c[0], c[1] - f]), turn([c[0], c[1] + f])];
  ctx.anchors[el.id] = c;
  ctx.namedAnchors[el.id] = { focus_1: f1, focus_2: f2 };
  return filledOutline(el.id, pts, el);
}

/** Where the line P + t·d enters and leaves a box, or null when it misses. */
function clipToBox(P: Pt, d: Pt, box: { x0: number; x1: number; y0: number; y1: number }): [Pt, Pt] | null {
  let t0 = -Infinity, t1 = Infinity;
  for (const [lo, hi, p, v] of [[box.x0, box.x1, P[0], d[0]], [box.y0, box.y1, P[1], d[1]]] as [number, number, number, number][]) {
    if (Math.abs(v) < 1e-9) { if (p < lo || p > hi) return null; continue; }
    const ta = (lo - p) / v, tb = (hi - p) / v;
    t0 = Math.max(t0, Math.min(ta, tb)); t1 = Math.min(t1, Math.max(ta, tb));
  }
  if (!(t0 < t1)) return null;
  return [[P[0] + t0 * d[0], P[1] + t0 * d[1]], [P[0] + t1 * d[0], P[1] + t1 * d[1]]];
}

function lineDrawable(el: SpecElement, ctx: Ctx): Drawable | null {
  const through = ((el.through ?? []) as PointRef[]).map((p) => resolvePointRef(p, ctx));
  if (through.length === 0 || through.some((p) => p === null)) { ctx.warnings.push(`line "${el.id}": through does not resolve`); return null; }
  const P = through[0]!;
  let d: Pt;
  if (through.length >= 2) d = [through[1]![0] - P[0], through[1]![1] - P[1]];
  else if (typeof el.slope === "number") {
    // domain slope → logical: scale dy by the y-scale and dx by the x-scale
    const plot = plotArea();
    const kx = ctx.domainDeclared ? (plot.x1 - plot.x0) / (ctx.domainX[1] - ctx.domainX[0]) : 1;
    const ky = ctx.domainDeclared ? (plot.y1 - plot.y0) / (ctx.domainY[1] - ctx.domainY[0]) : 1;
    d = [kx, el.slope * ky];
  } else if (typeof el.angle === "number") d = [Math.cos(el.angle * DEG), Math.sin(el.angle * DEG)];
  else { ctx.warnings.push(`line "${el.id}": needs a second point, a slope or an angle`); return null; }
  if (Math.hypot(d[0], d[1]) < 1e-9) { ctx.warnings.push(`line "${el.id}": its two points coincide`); return null; }
  const plot = plotArea();
  const box = ctx.domainDeclared ? { x0: plot.x0, x1: plot.x1, y0: plot.y0, y1: plot.y1 } : { x0: 0, x1: CANVAS.w, y0: 0, y1: CANVAS.h };
  const seg = clipToBox(P, d, box);
  if (!seg) { ctx.warnings.push(`line "${el.id}": misses the canvas`); return null; }
  const [A, B] = seg;
  const mid: Pt = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2];
  ctx.anchors[el.id] = mid;
  const named: Record<string, Pt> = { start: A, end: B, mid };
  through.forEach((p, i) => { named[`point_${i + 1}`] = p!; });
  ctx.namedAnchors[el.id] = named;
  return { id: el.id, kind: "stroke", pts: [A, B], z: Z_STROKE, style: resolveStyle(el.style, { strokeWidth: 2.5 }), drawOpts: resolveDrawOpts(el.draw, { duration: SKETCH_MS.guides }) };
}
```

Dispatch both. Types: `rx?: number; ry?: number; through?: PointRef[]; slope?: number; angle?: number` (note: `angle` is a new SpecElement field — not to be confused with the `angle` element type). Schema: enum; `rx`/`ry` ("ellipse: half-axes in logical units"), `through` (array 1–2 of pointRef branches: "line: one or two points the line passes through — [{\"ref\": \"tri\", \"anchor\": \"vertex_1\"}, {\"ref\": \"tri\", \"anchor\": \"vertex_2\"}] extends a side; with one point give slope or angle"), `slope` ("line: rise over run in domain units when a domain is declared, else logical"), `angle` ("line: direction in degrees counter-clockwise from +x"); semantic checks: `ellipse` needs rx and ry; `line` needs `through` (1–2) and, with one point, `slope` or `angle`.

- [ ] **Step 4: Run**

Run: `npx vitest run tests/ellipse-line.test.ts tests/tier2.test.ts tests/anchors.test.ts tests/morph.test.ts tests/schema.test.ts && npx tsc --noEmit`
Expected: all PASS.

---

### Task 8: Round-2 leftovers — `isExplicitPointRef`, the examples gate's `bboxesFor`

**Files:**
- Modify: `src/render/plan.ts` (a module-level `isExplicitPointRef(p: PointRef | undefined): boolean` replacing the three inline tests in `move`, `flip`, `morph`)
- Modify: `tests/examples.test.ts` (the gate passes `bboxesFor`)
- Test: `tests/plan.test.ts` (one test for the helper's three answers)

- [ ] **Step 1: Write the failing test**

Append to `tests/plan.test.ts`:

```ts
import { isExplicitPointRef } from "../src/render/plan";
describe("isExplicitPointRef", () => {
  test("arrays, refs and x+y are explicit; a ref-less anchor is not", () => {
    expect(isExplicitPointRef([1, 2])).toBe(true);
    expect(isExplicitPointRef({ ref: "a" })).toBe(true);
    expect(isExplicitPointRef({ x: 1, y: 2 })).toBe(true);
    expect(isExplicitPointRef({ anchor: "vertex_2" })).toBe(false);
    expect(isExplicitPointRef(undefined)).toBe(false);
  });
});
```

- [ ] **Step 2: Implement**

```ts
/** A PointRef that names a place in the SCENE (an array, a ref, or x+y) rather than the acting element's own anchor — resolved once per command, never per target. */
export function isExplicitPointRef(p: PointRef | undefined): boolean {
  if (p === undefined) return false;
  if (Array.isArray(p)) return true;
  return p.ref !== undefined || (p.x !== undefined && p.anchor === undefined);
}
```

Replace `pivotIsExplicit`, `throughIsExplicit`, `morphPivotIsExplicit` with calls. In `tests/examples.test.ts`'s gate, add `bboxesFor: (params) => { const b = elementBBoxes(layoutSpec({ ...spec, params: { ...(spec.params ?? {}), ...params } })); return (id) => b.get(id) ?? null; }` — the same shape `render()` uses (read `src/render/index.ts` for `withOverrides` and use it if exported).

- [ ] **Step 3: Run**

Run: `npx vitest run tests/plan.test.ts tests/flip.test.ts tests/morph.test.ts tests/examples.test.ts && npx tsc --noEmit`
Expected: all PASS.

---

### Task 9: Prompt, seven bundled examples, the roadmap

**Files:**
- Modify: `src/llm/prompts/compiler-v1.md` (the tier-2 element list gains `angle`, `measure`, `ellipse`, `line`; the `pieces` sentence gains `rings`/`triangles`/`halving`; the `arrange` bullet gains `unroll`; the `keep`/`ghost` bullet is from Task 1)
- Modify: `src/examples.json` (append six entries; edit the existing circle_sectors example to add `"ghost": true` on its `animate: {t: 1}` command)
- Modify: `ROADMAP.md` (a section after "Anchors and motion round 2 — done 2026-09-08")
- Test: `tests/prompt.test.ts` (extend), `tests/examples.test.ts` (runs as is)

- [ ] **Step 1: Prompt**

In the tier-2 list (line ~14): after `pieces (…)` add: "`angle` (a vertex `at` and two arms `from`/`to` — points `{ref, anchor}` or directions in degrees — writes its degrees itself), `measure` (`of` an element, or `from`/`to` a segment: `what` length / width / height / area / perimeter, `label: \"b = {value}\"` — the number FOLLOWS the figure: scale the square and its area text changes), `ellipse` (`rx`, `ry`, anchors `focus_1`/`focus_2`) and `line` (an infinite line `through` one or two points, `slope` or `angle` — tangents, asymptotes, an extended side)". Extend the `pieces` sentence: "`of: \"rings\"` cuts a circle into concentric rings (`arrange: {layout: \"unroll\"}` straightens them into the staircase that becomes the πr² triangle), `of: \"triangles\"` fans a polygon into triangles from its centre or a vertex (zipper them into the parallelogram), `of: \"halving\"` halves a rectangle again and again (`<id>_rest` is what remains — 1/2 + 1/4 + …)". The `arrange` bullet's layout list gains "`unroll` (ring pieces into strips)". `tests/prompt.test.ts`: assert `"`angle`"`, `"`measure`"`, `"`ellipse`"`, `"`line`"`, `"unroll"`, `"halving"`, `"`keep`"` are present.

- [ ] **Step 2: The examples**

Append to `src/examples.json` (match the file's pretty-printed indentation):

```json
{"request":"Hvorfor er arealet av en sirkel πr², ringversjonen?","packs":[],"spec":{"title":"Sirkelen som ringer","elements":[
 {"id":"ringer","type":"pieces","of":"rings","x":200,"y":400,"radius":100,"n":8,"style":{"fill":"#2f6b8f"}},
 {"id":"lengste","type":"measure","of":"ringer_8","what":"width","label":"{value}","side":"right"},
 {"id":"hoyde","type":"measure","from":{"ref":"ringer_1","anchor":"bottom"},"to":{"ref":"ringer_8","anchor":"top"},"label":"r = {value}","side":"left"}],
"commands":[
 {"draw":["ringer"],"speak":"Del sirkelen i tynne ringer i stedet for kakestykker. Hver ring er nesten en smal stripe bøyd rundt sentrum."},
 {"draw":["hoyde","label_hoyde"],"speak":"Stablet oppå hverandre er ringene til sammen så høye som radien r."},
 {"keep":{"target":"ringer"},"speak":"Behold sirkelen der den står."},
 {"arrange":{"target":"ringer","layout":"unroll","at":[640,400],"duration":3},"speak":"Rett ut hver ring til en stripe. Den innerste er kort, den ytterste nesten hele omkretsen: to pi r."},
 {"draw":["lengste","label_lengste"],"speak":"Stripene danner en trapp som nærmer seg en trekant med grunnlinje to pi r og høyde r."},
 {"highlight":{"target":["label_hoyde","label_lengste"],"effect":"glow"},"speak":"Arealet av trekanten er en halv ganger to pi r ganger r. Det er pi r i annen."}]}}
```

```json
{"request":"Hvorfor er arealet av en regulær mangekant halve omkretsen ganger apotemet?","packs":[],"spec":{"title":"Sekskanten som trekanter","elements":[
 {"id":"trek","type":"pieces","of":"triangles","x":250,"y":400,"radius":140,"sides":6,"style":{"fill":"#f2c14e"}},
 {"id":"apotem","type":"measure","from":{"ref":"trek_1","anchor":"apex"},"to":{"ref":"trek_1","anchor":"base"},"label":"a = {value}","side":"right"}],
"commands":[
 {"draw":["trek"],"speak":"En regulær sekskant delt i seks like trekanter fra sentrum."},
 {"draw":["apotem","label_apotem"],"speak":"Høyden i hver trekant, fra sentrum til midten av en side, heter apotemet a."},
 {"keep":{"target":"trek"},"speak":"Behold sekskanten i tankene."},
 {"arrange":{"target":"trek","layout":"zipper","at":[700,400],"duration":3},"speak":"Legg trekantene annenhver opp og ned. De danner et parallellogram med høyde a."},
 {"highlight":{"target":["label_apotem"],"effect":"glow"},"speak":"Grunnlinja er tre sider, halve omkretsen. Arealet er halve omkretsen ganger apotemet. Med flere og flere sider blir det sirkelens pi r i annen."}]}}
```

```json
{"request":"Hvorfor er 1/2 + 1/4 + 1/8 + … = 1?","packs":[],"spec":{"title":"Halvparten av resten","elements":[
 {"id":"ramme","type":"polygon","points":[[300,175],[700,175],[700,575],[300,575]],"style":{"color":"#3d3833","stroke_width":3}},
 {"id":"kv","type":"pieces","of":"halving","x":500,"y":375,"width":400,"height":400,"n":6,"style":{"fill":"#2f6b8f"}}],
"commands":[
 {"draw":["ramme"],"speak":"Et kvadrat med areal 1. Kan vi fylle det med biter som er halvparten så store hver gang?"},
 {"draw":["kv_1"],"speak":"Først en halv."},
 {"draw":["kv_2"],"speak":"Så en firedel, halvparten av det som var igjen."},
 {"draw":["kv_3"],"speak":"En åttedel."},
 {"draw":["kv_4","kv_5","kv_6"],"speak":"En sekstendel, en trettitodel, en sekstifiredel. Hver bit tar halvparten av resten."},
 {"highlight":{"target":["kv_rest"],"effect":"glow"},"speak":"Det som er igjen er alltid like stort som den siste biten, og det halveres for alltid. Summen nærmer seg 1 uten noen gang å nå den."}]}}
```

```json
{"request":"Hva skjer med arealet når sidene dobles?","packs":[],"spec":{"title":"Dobbel side, firedobbelt areal","elements":[
 {"id":"kv","type":"polygon","points":[[150,150],[350,150],[350,350],[150,350]],"style":{"fill":"#87a878"}},
 {"id":"side","type":"measure","from":{"ref":"kv","anchor":"vertex_1"},"to":{"ref":"kv","anchor":"vertex_2"},"label":"s = {value}"},
 {"id":"areal","type":"measure","of":"kv","label":"A = {value}"}],
"commands":[
 {"draw":["kv","side","label_side","areal","label_areal"],"speak":"Et kvadrat med side 200 og areal 40 000. Hva skjer om vi dobler siden?"},
 {"move":{"target":["kv"],"scale":2,"pivot":{"anchor":"bottom_left"},"duration":2,"ghost":true},"speak":"Siden blir 400. Men arealet blir 160 000: fire ganger så stort, ikke to."},
 {"highlight":{"target":["label_areal"],"effect":"glow"},"speak":"Areal vokser med kvadratet av skaleringen. Dobler du siden, får du to ganger to."}]}}
```

```json
{"request":"Hvorfor er en ytre vinkel lik summen av de to motstående indre?","packs":[],"spec":{"title":"Ytre vinkel","elements":[
 {"id":"tri","type":"polygon","points":[[200,250],[600,250],[450,500]],"style":{"fill":"#f2c14e"}},
 {"id":"forl","type":"line","through":[{"ref":"tri","anchor":"vertex_1"},{"ref":"tri","anchor":"vertex_2"}],"style":{"dash":true,"color":"#8f887c"}},
 {"id":"a","type":"angle","at":{"ref":"tri","anchor":"vertex_1"},"from":{"ref":"tri","anchor":"vertex_2"},"to":{"ref":"tri","anchor":"vertex_3"},"style":{"color":"#b5482e"}},
 {"id":"c","type":"angle","at":{"ref":"tri","anchor":"vertex_3"},"from":{"ref":"tri","anchor":"vertex_1"},"to":{"ref":"tri","anchor":"vertex_2"},"style":{"color":"#2f6b8f"}},
 {"id":"ytre","type":"angle","at":{"ref":"tri","anchor":"vertex_2"},"from":0,"to":{"ref":"tri","anchor":"vertex_3"},"radius":60,"style":{"color":"#8a5fa8"}}],
"commands":[
 {"draw":["tri"],"speak":"En trekant med hjørnene A, B og C."},
 {"draw":["a"],"speak":"Vinkelen ved A er 45 grader."},
 {"draw":["c"],"speak":"Vinkelen ved C er 76 grader."},
 {"draw":["forl","ytre"],"speak":"Forleng siden AB forbi B. Vinkelen mellom forlengelsen og siden BC er den ytre vinkelen: 121 grader."},
 {"move":{"target":["a"],"anchor":"vertex","to":{"ref":"tri","anchor":"vertex_2"},"duration":1.5,"ghost":true},"speak":"Flytt vinkelen ved A bort til B. Den fyller den første delen av den ytre vinkelen."},
 {"move":{"target":["c"],"anchor":"vertex","to":{"ref":"tri","anchor":"vertex_2"},"rotate":-180,"pivot":{"anchor":"vertex"},"duration":1.5,"ghost":true},"speak":"Snu vinkelen ved C og legg den inntil. Sammen fyller de nøyaktig den ytre vinkelen: 45 pluss 76 er 121."}]}}
```

```json
{"request":"Hva er en ellipse?","packs":[],"spec":{"title":"Ellipsen: to brennpunkter","elements":[
 {"id":"ell","type":"ellipse","x":500,"y":375,"rx":300,"ry":180},
 {"id":"akse","type":"line","through":[{"ref":"ell","anchor":"focus_1"},{"ref":"ell","anchor":"focus_2"}],"style":{"dash":true,"color":"#8f887c"}},
 {"id":"f1","type":"shape","shape":"circle","x":260,"y":375,"radius":6,"style":{"fill":"#3d3833"}},
 {"id":"f2","type":"shape","shape":"circle","x":740,"y":375,"radius":6,"style":{"fill":"#3d3833"}},
 {"id":"p","type":"shape","shape":"circle","x":500,"y":555,"radius":7,"style":{"color":"#b5482e","fill":"#b5482e"}},
 {"id":"d1","type":"measure","from":{"ref":"p"},"to":{"ref":"f1"},"style":{"color":"#b5482e"}},
 {"id":"d2","type":"measure","from":{"ref":"p"},"to":{"ref":"f2"},"style":{"color":"#2f6b8f"}}],
"commands":[
 {"draw":["ell","akse","f1","f2"],"speak":"En ellipse har to brennpunkter på den lange aksen."},
 {"draw":["p","d1","label_d1","d2","label_d2"],"speak":"Fra et punkt på kurven måler vi avstanden til hvert brennpunkt: 300 og 300."},
 {"move":{"target":["p"],"to":{"ref":"ell","anchor":"right"},"duration":3},"speak":"Flytt punktet til enden av den lange aksen: den ene avstanden vokser til 540, den andre krymper til 60."},
 {"highlight":{"target":["label_d1","label_d2"],"effect":"glow"},"speak":"Summen er alltid 600, to ganger den halve storaksen. Det er definisjonen på en ellipse."}]}}
```

And in the existing example whose request is "Hvorfor er arealet av en sirkel πr²?" on `circle_sectors` (find it by `"template": "circle_sectors"`), add `"ghost": true` to its `animate` command with `{ "t": 1 }` and a clause to that beat's narration: "…mens den oppdelte sirkelen blir stående bak." Every example must pass the gate (empty warnings, no lint issue) — adjust coordinates or sides, never the gate; the angle and measure texts must not sit on strokes (move them with `radius`/`offset`/`side`).

- [ ] **Step 3: ROADMAP**

After the "Anchors and motion round 2" section (before "## Sound"):

```markdown
## Ghosts, angle and measure, three more cuts — done 2026-09-09

Hans's idea: keep the original on screen, faded, while its pieces animate
away — sometimes you want the circle to stay while its sectors zip into
the rectangle, sometimes not; a choice, default off. Design
`docs/superpowers/specs/2026-09-09-ghost-angle-measure-design.md`, ledger
`docs/superpowers/plans/2026-09-09-ghost-angle-measure-ledger.md`. Shipped:

1. **`keep` and `ghost`.** `keep: {target}` mints a faded copy `<id>_ghost`
   of any element where it is now; `ghost: true` on `move`, `arrange`,
   `flip`, `morph` and `animate` does the same for the targets before they
   go. Ghosts are minted elements like trails (`Plan.minted`), painted
   under the original, erasable and fadeable by id.
2. **`angle`** — vertex plus two arms (points or directions), writes its
   own degrees, draws the right-angle square when it is one.
3. **`measure`** — length / width / height / area / perimeter of an element
   or a segment, written as `label_<id>`; the value FOLLOWS the figure
   (`SceneState.texts`, backend `setText`): scale the square and its area
   text goes ×4; the dimension line is re-pointed through `shapes`.
4. **Three more cuts** — `pieces` of `rings` (with `arrange: unroll`, the
   staircase that becomes the πr² triangle), `triangles` (fan a polygon;
   zipper them into the parallelogram), `halving` (1/2 + 1/4 + … = 1).
5. **`ellipse`** (with foci as anchors) and **`line`** (infinite, through
   points or by slope/angle, clipped to the plot or the canvas).
6. Round-2 leftovers: one `isExplicitPointRef`; the examples gate plans
   with `bboxesFor`.
7. Seven bundled examples, every one a question.

Deliberately not done: rotated text; solids (own round); a copies
generator; `arrange` sort/align; ghosts that follow later motion;
measuring in domain units; `unroll` beyond ring pieces; an `angle` that
updates when its arms move.
```

- [ ] **Step 4: Run**

Run: `npx vitest run tests/examples.test.ts tests/prompt.test.ts && npx tsc --noEmit`
Expected: all PASS.

---

## Controller's closing checklist (not a task)

- Full suite; `npm run build`; `npm run build:engine`.
- Live smoke (the hand checklist gains: the ring unroll with its ghost, the measure changing under a scale, the ellipse's moving point) — a light automated pass on the ring and measure examples.
- Ledger: `docs/superpowers/plans/2026-09-09-ghost-angle-measure-ledger.md`.

