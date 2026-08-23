# 3D Gradient Shading Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make in-drawcast 3D spheres read as volumetric balls (radial-gradient fills instead of overlay crescents), add a textbook wireframe sphere style, speed up 3D drawing, and add a spin pause/play toggle to the Explore-in-3D modal.

**Architecture:** The drawable IR gains an optional `fillGradient` on `ResolvedStyle`; both SVG renderers (sketchy + clean) materialize it as an SVG `<radialGradient>` placed inside the leaf's own `<g>` (unique per-leaf id, so it serializes with the element and survives video export). `kit.project3d`'s sphere then becomes ONE gradient-filled circle — the `__sh` crescent and `__hl` highlight overlay drawables are DELETED (net code removal, and each atom draws in one sketch pass instead of three). A new `style: "wire"` sphere variant emits the classic outline + equator (front solid, back dashed). The 3Dmol modal gets a spin toggle via `viewer.spin(bool)`.

**Tech Stack:** TypeScript (strict), Vite, rough.js, vitest (node environment — no DOM in tests), 3Dmol.js (modal only).

**Spec:** `docs/superpowers/specs/2026-08-22-templates-design.md` — §3a covers `kit.project3d`. NOTE: the spec is silent on the sphere-shading *technique* (crescents were an implementation choice of the 2026-08-23-3d-solids-modal plan, recorded only in kit.ts docstrings). This plan therefore contradicts no spec text; the kit docstring is the binding doc to update (it is embedded verbatim in the authoring prompt via `kit.ts?raw`).

## Context-Reset Safety

This plan is fully self-contained: every task carries its exact code, and no conversation context is required to execute it. If the session context is cleared before or during execution:

1. Re-enter via the superpowers:subagent-driven-development skill with THIS plan file.
2. The ledger lives at `.superpowers/sdd/2026-08-23-3d-gradient-shading/progress.md` — tasks marked `Task <N>: complete` are done; never re-dispatch them.
3. Repo state at plan time: `main` at `f3b862b`, 504 tests green, working tree clean.
4. SEPARATE pending item, NOT part of this plan: a /code-review of remote-packs commit `1a5620c` produced 15 verified findings (stale-cache eviction cluster); the fix wave is still awaiting the user's go. Do not fold it in here.

## Global Constraints

- `npm test` (vitest, `environment: "node"` — tests cannot touch `document`) and `npx tsc --noEmit` must pass after every task.
- No new dependencies.
- `kit` object stays frozen (`Object.freeze(kit)` at the bottom of kit.ts); doc comments in kit.ts double as the AI authoring prompt (`kit.ts?raw`) — every behavior change there MUST update the adjacent docstring.
- Element ids are the narration API: any id removed from `project3d` output (`__sh`, `__hl`) must be scrubbed from `src/examples.json` in the same commit, or the bundled-examples test (`tests/molecule3d.test.ts`, "all drawn ids exist") fails.
- Do not split kit.ts into multiple files (the authoring prompt embeds it whole).
- Commit after each task with a conventional-commit message; push only in Task 4.

## File Structure

| File | Change |
|---|---|
| `src/layout/model.ts` | Add `GradientSpec` interface; `fillGradient?: GradientSpec` on `ResolvedStyle` |
| `src/render/svg-backend.ts` | Pure `radialGradientParts()` helper + DOM `appendRadialGradient()`; use in the circle branches of `drawLeaf` (sketchy) and `drawLeafClean` |
| `src/scenes/kit.ts` | Sphere branch of `project3d`: gradient fill, `style: "wire"`, delete `__sh`/`__hl`; update `Prim3` type + `project3d` docstring |
| `src/scenes/molecule_3d/template.yaml` | `ms: 420` on atoms, `ms: 320` on bonds; version 2 |
| `src/examples.json` | Methane playlist: drop all `__sh`/`__hl` ids from draw lists |
| `src/ui/model3d.ts` | `openModel3d` gains optional `opts.onMounted(viewer)` callback |
| `src/main.ts` | Spin toggle button in the model3d dialog |
| `tests/svg-gradient.test.ts` | NEW — pure-function tests for `radialGradientParts` |
| `tests/molecule3d.test.ts` | Rewrite sphere-shading tests; add wire tests |
| `tests/model3d.test.ts` | `onMounted` fires on mount, not on abort |

---

### Task 1: Gradient fill support in the IR and both renderers

**Files:**
- Modify: `src/layout/model.ts` (ResolvedStyle, around line 6–13)
- Modify: `src/render/svg-backend.ts` (module top; `drawLeafClean` ~line 148–179; sketchy circle branch ~line 230–235)
- Test: `tests/svg-gradient.test.ts` (new)

**Interfaces:**
- Consumes: existing `ResolvedStyle`, `drawLeaf`/`drawLeafClean` internals.
- Produces: `GradientSpec` (exported from `src/layout/model.ts`) and `radialGradientParts(g: GradientSpec): { attrs: Record<string, string>; stops: Record<string, string>[] }` (exported from `src/render/svg-backend.ts`). Task 2's kit code sets `style.fillGradient` and relies on both renderers honoring it for circle-hinted strokes.

- [ ] **Step 1: Write the failing test**

Create `tests/svg-gradient.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { radialGradientParts } from "../src/render/svg-backend";

// Pure attribute-building only — the vitest environment is node, so the DOM
// assembly path (appendRadialGradient) is exercised by the visual gate, not here.
describe("radialGradientParts", () => {
  test("defaults: r=0.5, no focal offset attrs when unset", () => {
    const p = radialGradientParts({ stops: [{ offset: 0, color: "#fff" }, { offset: 1, color: "#000" }] });
    expect(p.attrs).toEqual({ r: "0.5" });
    expect(p.stops).toEqual([
      { offset: "0%", "stop-color": "#fff" },
      { offset: "100%", "stop-color": "#000" },
    ]);
  });

  test("focal point and radius pass through; offsets become percentages in order", () => {
    const p = radialGradientParts({
      fx: 0.32, fy: 0.3, r: 0.75,
      stops: [
        { offset: 0, color: "#e8f1f8" },
        { offset: 0.55, color: "#bcd2e0" },
        { offset: 1, color: "#4a5a66", opacity: 0.9 },
      ],
    });
    expect(p.attrs).toEqual({ fx: "0.32", fy: "0.3", r: "0.75" });
    expect(p.stops[1]).toEqual({ offset: "55%", "stop-color": "#bcd2e0" });
    expect(p.stops[2]).toEqual({ offset: "100%", "stop-color": "#4a5a66", "stop-opacity": "0.9" });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/svg-gradient.test.ts`
Expected: FAIL — `radialGradientParts` is not exported.

- [ ] **Step 3: Add `GradientSpec` to the IR**

In `src/layout/model.ts`, directly after the `Pt` type and before `ResolvedStyle`:

```ts
/**
 * Radial-gradient fill in SVG objectBoundingBox coordinates. When set on a
 * circle-hinted stroke drawable, both renderers paint the fill with this
 * gradient instead of the flat `fill` (keep `fill` set too — it is the base
 * color the gradient shades, and the fallback paint). SVG is y-down here:
 * an up-left highlight means fx, fy < 0.5.
 */
export interface GradientSpec {
  stops: { offset: number; color: string; opacity?: number }[];
  fx?: number;
  fy?: number;
  /** Radius in unit bbox coords (default 0.5; > 0.5 softens the limb). */
  r?: number;
}
```

And add to `ResolvedStyle`:

```ts
export interface ResolvedStyle {
  color: string;
  fill?: string;
  fillGradient?: GradientSpec;
  strokeWidth: number;
  dash?: boolean;
  roughness: number;
  opacity: number;
}
```

(`defaultStyle` spreads overrides, so no change needed there.)

- [ ] **Step 4: Implement the helper and renderer wiring**

In `src/render/svg-backend.ts`, add `GradientSpec` to the imports from `../layout/model`, then below `hashSeed`:

```ts
/**
 * Pure attribute construction for an SVG <radialGradient>, split from the DOM
 * assembly so it stays unit-testable in the node test environment.
 */
export function radialGradientParts(g: GradientSpec): { attrs: Record<string, string>; stops: Record<string, string>[] } {
  const attrs: Record<string, string> = {};
  if (g.fx !== undefined) attrs.fx = String(g.fx);
  if (g.fy !== undefined) attrs.fy = String(g.fy);
  attrs.r = String(g.r ?? 0.5);
  const stops = g.stops.map((s) => {
    const stop: Record<string, string> = { offset: `${+(s.offset * 100).toFixed(1)}%`, "stop-color": s.color };
    if (s.opacity !== undefined) stop["stop-opacity"] = String(s.opacity);
    return stop;
  });
  return { attrs, stops };
}

// Paint-server ids are looked up document-wide, and several SVGs can share a
// page (viewer + a re-render + export cloning) — a monotone counter keeps
// every gradient id unique for the session.
let gradSeq = 0;

/** Builds the <radialGradient> INSIDE the leaf's own <g> (a paint server is
 * referenced by id, not by position, so it needn't live in <defs>) — this way
 * it serializes with the element, which is what the video exporter clones. */
function appendRadialGradient(g: SVGGElement, spec: GradientSpec): string {
  const id = `csg${++gradSeq}`;
  const parts = radialGradientParts(spec);
  const el = document.createElementNS(SVG_NS, "radialGradient");
  el.setAttribute("id", id);
  for (const [k, v] of Object.entries(parts.attrs)) el.setAttribute(k, v);
  for (const s of parts.stops) {
    const stop = document.createElementNS(SVG_NS, "stop");
    for (const [k, v] of Object.entries(s)) stop.setAttribute(k, v);
    el.appendChild(stop);
  }
  g.appendChild(el);
  return `url(#${id})`;
}
```

In `drawLeafClean` (currently `function drawLeafClean(g: SVGGElement, d: ...)`), replace the two lines

```ts
  const filled = !!d.style.fill;
  if (d.shapeHint?.type === "circle") {
    const { c, r } = d.shapeHint;
    const p = plainPath(circlePath(c[0], toSvgY(c[1]), r), d.style, filled);
    if (filled) p.setAttribute("fill", d.style.fill!);
```

with

```ts
  const gradPaint = d.style.fillGradient ? appendRadialGradient(g, d.style.fillGradient) : null;
  const filled = !!(d.style.fill || gradPaint);
  if (d.shapeHint?.type === "circle") {
    const { c, r } = d.shapeHint;
    const p = plainPath(circlePath(c[0], toSvgY(c[1]), r), d.style, filled);
    if (filled) p.setAttribute("fill", gradPaint ?? d.style.fill!);
```

In `drawLeaf` (sketchy), replace the circle branch

```ts
  if (d.shapeHint?.type === "circle") {
    const { c, r } = d.shapeHint;
    const node = rc.circle(c[0], toSvgY(c[1]), r * 2, d.style.fill ? { ...opts, fill: d.style.fill, fillStyle: "solid" } : opts);
    g.appendChild(node);
```

with

```ts
  if (d.shapeHint?.type === "circle") {
    const { c, r } = d.shapeHint;
    const fillPaint = d.style.fillGradient ? appendRadialGradient(g, d.style.fillGradient) : d.style.fill;
    const node = rc.circle(c[0], toSvgY(c[1]), r * 2, fillPaint ? { ...opts, fill: fillPaint, fillStyle: "solid" } : opts);
    g.appendChild(node);
```

(rough.js writes the `fill` option string straight into the solid-fill path's `fill` attribute, so a `url(#id)` reference passes through untouched. The player's progressive reveal fades `fillOpacity` on any path whose fill ≠ "none" — a url() fill qualifies, so gradient fills fade in exactly like flat ones.)

- [ ] **Step 5: Run the test and typecheck**

Run: `npx vitest run tests/svg-gradient.test.ts && npx tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 6: Full suite, then commit**

Run: `npx vitest run`
Expected: all green (this task changes no existing behavior — `fillGradient` is unset everywhere so far).

```bash
git add src/layout/model.ts src/render/svg-backend.ts tests/svg-gradient.test.ts
git commit -m "feat: radial-gradient fill support in the drawable IR and both SVG renderers"
```

---

### Task 2: kit sphere — gradient ball + wire style, crescents deleted; molecule_3d speed pass

**Files:**
- Modify: `src/scenes/kit.ts` (`Prim3` sphere variant ~line 93; `project3d` docstring ~lines 151–166; sphere branch ~lines 492–550)
- Modify: `src/scenes/molecule_3d/template.yaml` (`version`, atom/bond prims)
- Modify: `src/examples.json` (methane walk-around playlist, entry titled "Methane in 3D (walk-around)")
- Test: `tests/molecule3d.test.ts` (rewrite the `__sh`/`__hl` tests, ~lines 71–101; other `shade: false` usages stay valid)

**Interfaces:**
- Consumes: `GradientSpec` via `defaultStyle({ fillGradient: ... })` from Task 1; existing `shadeColor(hex, factor)` (factor 0.5 = unchanged, →1 lighter, →0 darker).
- Produces: sphere with `shade !== false` emits EXACTLY ONE drawable (id = prim id, circle shapeHint, `style.fill` = base color, `style.fillGradient` set). Sphere with `style: "wire"` emits `id` (outline, no fill), `id__eq` (solid front equator), `id__eqb` (dashed back equator); painter's order `id__eqb` → `id` → `id__eq`. The ids `id__sh` / `id__hl` NO LONGER EXIST anywhere.

- [ ] **Step 1: Rewrite the failing tests**

In `tests/molecule3d.test.ts`, DELETE the tests "emits __sh (crescent area, …)" and "shade: false suppresses both" (~lines 71–101) and add in their place (reuse the file's existing `cam` fixture):

```ts
    test("shaded sphere is ONE drawable with a radial-gradient fill — no __sh/__hl overlay pieces", () => {
      const { drawables, order, anchors } = kit.project3d(cam, [
        { kind: "sphere", id: "s", c: [0, 0, 0], r: 1, fill: "#bcd2e0" },
      ]);
      expect(order).toEqual(["s"]);
      expect(anchors["s"]).toBeDefined();
      const s = drawables[0];
      expect(s.style.fill).toBe("#bcd2e0");
      const grad = s.style.fillGradient!;
      expect(grad.stops).toHaveLength(3);
      expect(grad.stops[1].color).toBe("#bcd2e0"); // mid stop = the base color itself
      expect(grad.fx!).toBeLessThan(0.5); // highlight up-left (SVG y-down)
      expect(grad.fy!).toBeLessThan(0.5);
    });

    test("shade: false keeps a flat fill and no gradient", () => {
      const { drawables, order } = kit.project3d(cam, [
        { kind: "sphere", id: "s", c: [0, 0, 0], r: 1, fill: "#bcd2e0", shade: false },
      ]);
      expect(order).toEqual(["s"]);
      expect(drawables[0].style.fill).toBe("#bcd2e0");
      expect(drawables[0].style.fillGradient).toBeUndefined();
    });

    test("shaded sphere without an explicit fill shades a light tint of its stroke color", () => {
      const { drawables } = kit.project3d(cam, [
        { kind: "sphere", id: "s", c: [0, 0, 0], r: 1, color: "#5a544c" },
      ]);
      expect(drawables[0].style.fill).toBeDefined();
      expect(drawables[0].style.fillGradient).toBeDefined();
      expect(drawables[0].style.fillGradient!.stops[1].color).toBe(drawables[0].style.fill);
    });

    test("wire sphere: outline + solid front equator + dashed back equator, no fill", () => {
      const { drawables, order, anchors } = kit.project3d(cam, [
        { kind: "sphere", id: "s", c: [0, 0, 0], r: 1, style: "wire" },
      ]);
      expect(order).toContain("s");
      expect(order).toContain("s__eq");
      expect(order).toContain("s__eqb");
      // Painter's order (far → near): back half behind the circle, front half on top.
      expect(order.indexOf("s__eqb")).toBeLessThan(order.indexOf("s"));
      expect(order.indexOf("s")).toBeLessThan(order.indexOf("s__eq"));
      const outline = drawables.find((d) => d.id === "s")!;
      const front = drawables.find((d) => d.id === "s__eq")!;
      const back = drawables.find((d) => d.id === "s__eqb")!;
      expect(outline.style.fill).toBeUndefined();
      expect(outline.style.fillGradient).toBeUndefined();
      expect(front.style.dash).toBeFalsy();
      expect(back.style.dash).toBe(true);
      // Only the sphere itself gets an anchor.
      expect(anchors["s__eq"]).toBeUndefined();
      expect(anchors["s__eqb"]).toBeUndefined();
    });
```

- [ ] **Step 2: Run to verify the new tests fail**

Run: `npx vitest run tests/molecule3d.test.ts`
Expected: the four new tests FAIL (order still contains `s__sh` etc.); nothing else in the file should break yet.

- [ ] **Step 3: Update `Prim3` and the sphere branch in kit.ts**

In `src/scenes/kit.ts`, change the sphere variant of `Prim3` to:

```ts
  | { kind: "sphere"; id: string; c: Vec3; r: number; color?: string; fill?: string; shade?: boolean; style?: "solid" | "wire"; ms?: number }
```

Replace the ENTIRE `if (prim.kind === "sphere") { ... }` block (the current block including both `pieces.push` calls for `__sh` and `__hl`) with:

```ts
      if (prim.kind === "sphere") {
        const q = proj(prim.c);
        anchors[prim.id] = [q.x, q.y];
        const resolvedColor = prim.color ?? COLORS.ink;
        if (prim.style === "wire") {
          // Textbook wireframe: outline circle + the world-space equator,
          // front half solid, back half dashed — the geometry-class "this is
          // a sphere" cue. No fill at all.
          pieces.push({
            depth: q.depth,
            drawable: {
              id: prim.id,
              kind: "stroke",
              pts: [[q.x, q.y]],
              shapeHint: { type: "circle", c: [q.x, q.y], r: prim.r * q.s },
              z: Z_STROKE,
              style: defaultStyle({ color: resolvedColor, strokeWidth: 3 }),
              drawOpts: defaultDrawOpts("sketch", prim.ms ?? SKETCH_MS.node),
            },
          });
          // Sample the equator (world-space horizontal circle through the
          // center), classify each point front/back against the center's own
          // depth, and keep the LONGEST run of each class — in general
          // position the equator crosses the silhouette exactly twice, so
          // that IS the front and the back half; a degenerate edge-on camera
          // just gets a partial arc, which still reads correctly.
          const N = 48;
          const samples = Array.from({ length: N }, (_, i) => {
            const t = (i / N) * 2 * Math.PI;
            const p = proj([prim.c[0] + prim.r * Math.cos(t), prim.c[1], prim.c[2] + prim.r * Math.sin(t)]);
            return { pt: [p.x, p.y] as Pt, back: p.depth > q.depth };
          });
          const boundary = samples.findIndex((s, i) => s.back !== samples[(i + N - 1) % N].back);
          const ordered = boundary <= 0 ? samples : [...samples.slice(boundary), ...samples.slice(0, boundary)];
          const runs: { back: boolean; pts: Pt[] }[] = [];
          for (const s of ordered) {
            const last = runs[runs.length - 1];
            if (last && last.back === s.back) last.pts.push(s.pt);
            else runs.push({ back: s.back, pts: [s.pt] });
          }
          // Bridge each run to the start of the next so the halves meet at the silhouette.
          runs.forEach((r, i) => {
            const next = runs[(i + 1) % runs.length];
            if (next !== r) r.pts.push(next.pts[0]);
          });
          const longest = (back: boolean) =>
            runs.filter((r) => r.back === back && r.pts.length >= 2).sort((a, b) => b.pts.length - a.pts.length)[0];
          const front = longest(false);
          const back = longest(true);
          if (back) {
            pieces.push({
              depth: q.depth + 1e-6,
              drawable: {
                id: `${prim.id}__eqb`,
                kind: "stroke",
                pts: back.pts,
                z: Z_STROKE,
                style: defaultStyle({ color: resolvedColor, strokeWidth: 2, dash: true, opacity: 0.65 }),
                drawOpts: defaultDrawOpts("sketch", prim.ms ?? SKETCH_MS.guides),
              },
            });
          }
          if (front) {
            pieces.push({
              depth: q.depth - 1e-6,
              drawable: {
                id: `${prim.id}__eq`,
                kind: "stroke",
                pts: front.pts,
                z: Z_STROKE,
                style: defaultStyle({ color: resolvedColor, strokeWidth: 2.5 }),
                drawOpts: defaultDrawOpts("sketch", prim.ms ?? SKETCH_MS.guides),
              },
            });
          }
        } else {
          // Solid ball: ONE circle whose radial-gradient fill carries the
          // volume — bright core offset toward the fixed up-left light,
          // darkened limb (screen-space light, camera-independent, matching
          // the previous crescent convention). No overlay drawables, so the
          // ball is complete the instant its circle finishes drawing.
          const base = prim.fill ?? shadeColor(resolvedColor, 0.85);
          const shaded = prim.shade !== false;
          pieces.push({
            depth: q.depth,
            drawable: {
              id: prim.id,
              kind: "stroke",
              pts: [[q.x, q.y]],
              shapeHint: { type: "circle", c: [q.x, q.y], r: prim.r * q.s },
              z: Z_STROKE,
              style: defaultStyle({
                color: resolvedColor,
                ...((prim.fill !== undefined || shaded) && { fill: base }),
                ...(shaded && {
                  fillGradient: {
                    fx: 0.32,
                    fy: 0.3,
                    r: 0.75,
                    stops: [
                      { offset: 0, color: shadeColor(base, 0.78) },
                      { offset: 0.55, color: base },
                      { offset: 1, color: shadeColor(base, 0.3) },
                    ],
                  },
                }),
                strokeWidth: 3,
              }),
              drawOpts: defaultDrawOpts("sketch", prim.ms ?? SKETCH_MS.node),
            },
          });
        }
      } else if (prim.kind === "face3") {
```

Behavior notes (deliberate, covered by the tests): a shaded sphere with no explicit `fill` now paints a light tint of its stroke color (`shadeColor(color, 0.85)`) — previously it stayed unfilled with crescents on top. `shade: false` + no `fill` still renders an empty circle.

- [ ] **Step 4: Update the `project3d` docstring (this text IS the authoring prompt)**

In the `SceneKit` interface docstring for `project3d`, replace the sentence beginning "Spheres default to `shade: true`: each emits a fixed up-left highlight …" (through "…so balls read as solid.") with:

```
   * Spheres default to `shade: true`: the ball is ONE circle whose radial-
   * gradient fill is lit from up-left (bright core toward the light, darkened
   * limb) — volumetric with no extra drawables. `style: "wire"` draws the
   * textbook wireframe instead: outline plus equator, front half solid
   * (`id__eq`), back half dashed (`id__eqb`), no fill.
```

Also update `shadeColor`'s own docstring (currently "Used by project3d's face3 flat-shading") to say it serves both face3 flat-shading AND the sphere gradient stops.

- [ ] **Step 5: Speed pass on molecule_3d**

In `src/scenes/molecule_3d/template.yaml`:
- `version: 1` → `version: 2`.
- Sphere prim line becomes:
  ```
  prims.push({ kind: "sphere", id: "atom_" + i, c: a.p, r: a.r, color: a.color, fill: a.fill, ms: 420 });
  ```
- Bond prim gains `ms: 320`:
  ```
  prims.push({
    kind: "seg", id: "bond_" + (i + 1),
    a: preset.atoms[f].p, b: preset.atoms[t].p,
    w: 5, color: kit.COLORS.guide, ms: 320,
    trimA: preset.atoms[f].r + 0.04, trimB: preset.atoms[t].r + 0.04,
  });
  ```
(Together with the crescent removal this cuts a methane atom from ~3450 ms of sketch time — node 850 + two region fills at 1300 each — to 420 ms.)

- [ ] **Step 6: Scrub `__sh`/`__hl` from the methane example**

In `src/examples.json`, in the entry titled `"Methane in 3D (walk-around)"`, remove every `atom_<i>__sh` and `atom_<i>__hl` token from all three parts' `draw:` lists (the playlist is one YAML string — edit carefully, keeping the flow-list commas valid). E.g. part 1's second beat becomes:

```
  - draw: [ground_shadow, atom_0, label_0]
```

and the long redraw lists in parts 2–3 become:

```
  - draw: [ground_shadow, bond_1, bond_1__f, bond_2, bond_2__f, bond_3, bond_3__f, bond_4, bond_4__f, atom_0, atom_1, atom_2, atom_3, atom_4, label_0, label_1, label_2, label_3, label_4, caption]
```

(part 1's hydrogen beat likewise drops the ten `__sh`/`__hl` tokens but keeps its bonds/atoms/labels.)

- [ ] **Step 7: Run the full suite and typecheck**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all green — including the bundled-examples suite, which validates every drawn id against the rendered layout (this is the net that catches any `__sh` id left behind).

- [ ] **Step 8: Commit**

```bash
git add src/scenes/kit.ts src/scenes/molecule_3d/template.yaml src/examples.json tests/molecule3d.test.ts
git commit -m "feat: gradient-shaded 3D spheres + wire style; delete crescent overlays; faster molecule_3d"
```

---

### Task 3: Spin pause/play toggle in the Explore-in-3D modal

**Files:**
- Modify: `src/ui/model3d.ts` (`openModel3d`, ~line 216)
- Modify: `src/main.ts` (model3d dialog block, ~lines 909–965)
- Test: `tests/model3d.test.ts`

**Interfaces:**
- Consumes: existing `openModel3d(host, container, q, signal)` and `Model3dViewer` (has `spin(axis: boolean | string): void`).
- Produces: `openModel3d(host, container, q, signal, opts?: { onMounted?: (viewer: Model3dViewer) => void })` — `onMounted` fires exactly once, after a successful mount (after `viewer.spin(true)`), and NEVER when the call was aborted/superseded or failed.

- [ ] **Step 1: Write the failing tests**

In `tests/model3d.test.ts`, following the file's existing pattern (it stubs `MODEL3D_DEF.load` with a fake namespace and calls `resetModel3dCacheForTests()` — mirror the arrangement of the existing successful-mount test):

```ts
  test("onMounted delivers the viewer after a successful mount", async () => {
    resetModel3dCacheForTests();
    const calls: string[] = [];
    const fakeViewer = {
      addModel: () => calls.push("addModel"),
      setStyle: () => calls.push("setStyle"),
      zoomTo: () => calls.push("zoomTo"),
      render: () => calls.push("render"),
      spin: (on: boolean | string) => calls.push(`spin:${on}`),
      clear: () => calls.push("clear"),
    };
    MODEL3D_DEF.load = async () => ({ createViewer: () => fakeViewer });
    const host = { open: true } as unknown as HTMLDialogElement;
    const container = { replaceChildren: () => {} } as unknown as HTMLElement;
    let mounted: unknown = null;
    await openModel3d(host, container, { input: { xyz: "1\n\nH 0 0 0" }, title: "t" }, new AbortController().signal, {
      onMounted: (v) => { mounted = v; },
    });
    expect(mounted).toBe(fakeViewer);
    expect(calls).toContain("spin:true");
  });

  test("onMounted is NOT called when the open was already superseded", async () => {
    resetModel3dCacheForTests();
    MODEL3D_DEF.load = async () => ({ createViewer: () => { throw new Error("must not mount"); } });
    const ac = new AbortController();
    ac.abort();
    let mounted = false;
    await openModel3d(
      { open: true } as unknown as HTMLDialogElement,
      { replaceChildren: () => {} } as unknown as HTMLElement,
      { input: { xyz: "1\n\nH 0 0 0" }, title: "t" },
      ac.signal,
      { onMounted: () => { mounted = true; } },
    );
    expect(mounted).toBe(false);
  });
```

Adjust the `Model3dQuery` literal (`title` etc.) to match the actual shape used by the file's existing tests — copy their fixture.

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/model3d.test.ts`
Expected: FAIL — `openModel3d` takes 4 arguments / `onMounted` never called.

- [ ] **Step 3: Implement in model3d.ts**

Change the signature and add one line after `viewer.spin(true);`:

```ts
export async function openModel3d(
  host: HTMLDialogElement,
  container: HTMLElement,
  q: Model3dQuery,
  signal: AbortSignal,
  opts?: { onMounted?: (viewer: Model3dViewer) => void },
): Promise<() => void> {
```

```ts
    viewer.spin(true);
    opts?.onMounted?.(viewer);
```

(Both existing abort paths return before this line, so the "never on supersession" contract holds with no extra checks. Extend the function's doc comment with one sentence: "`opts.onMounted` fires once after a successful mount — the caller's handle for runtime controls like the spin toggle — and never fires on an aborted, superseded, or failed open.")

- [ ] **Step 4: Wire the button in main.ts**

In the "explore-in-3D modal" block: import `type Model3dViewer` from `./ui/model3d`; add the button and state, and reset on open:

```ts
const model3dContainer = h("div", { class: "model3d-container" });
const model3dSpinBtn = h("button", {}, "Pause spin");
const model3dCloseBtn = h("button", {}, "Close");
const model3dDialog = h(
  "dialog",
  { class: "model3d-dialog" },
  h("h3", {}, "Explore in 3D"),
  model3dContainer,
  h("div", { class: "row" }, model3dSpinBtn, model3dCloseBtn),
);
```

```ts
let model3dViewer: Model3dViewer | null = null;
let model3dSpinning = true;
function setModel3dSpin(on: boolean): void {
  model3dSpinning = on;
  model3dSpinBtn.textContent = on ? "Pause spin" : "Spin";
  model3dViewer?.spin(on);
}
model3dSpinBtn.addEventListener("click", () => setModel3dSpin(!model3dSpinning));
```

In `openModel3dDialog`, before `model3dDialog.showModal()`:

```ts
  model3dViewer = null;
  setModel3dSpin(true); // every open starts spinning, whatever the last session did
```

and pass the callback (the abort guard keeps a superseded mount from installing its viewer):

```ts
  void openModel3d(model3dDialog, model3dContainer, q, ac.signal, {
    onMounted: (v) => {
      if (!ac.signal.aborted) model3dViewer = v;
    },
  }).then((destroy) => {
```

In the dialog's `close` handler, add `model3dViewer = null;` alongside the existing cleanup.

- [ ] **Step 5: Run the suite and typecheck**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add src/ui/model3d.ts src/main.ts tests/model3d.test.ts
git commit -m "feat: spin pause/play toggle in the Explore-in-3D modal"
```

---

### Task 4: Visual gate, then push

This task is the CONTROLLER's (or the user's) — no implementer subagent.

- [ ] **Step 1: Build check**

Run: `npm run build`
Expected: clean build; note the main-bundle size hasn't grown (3dmol stays its own chunk).

- [ ] **Step 2: Visual gate (one screenshot, token-frugal)**

Start `npm run dev`, load the "Methane in 3D (walk-around)" example, let part 1 draw, take ONE screenshot. Judge against the complaint that motivated this plan ("looks like curves drawn on top of a flat drawing … more a circle than a ball"):
- atoms read as volumetric balls (smooth bright-to-dark falloff, no hard-edged overlay shapes);
- sketchy outline still hand-drawn;
- the figure completes noticeably faster than before.

If the gradient balls STILL read flat, STOP and report to the user — their stated fallback is to drop the shading effort rather than iterate further, and that is their call, not the controller's.

- [ ] **Step 3: Push**

```bash
git push
```

GitHub Pages CI deploys from main. Report "pushed and live" with the URL, per standing preference.

---

## Parked / explicitly out of scope

- The `animate` command (smooth camera tweening / gliding curve shifts) stays parked — see the appendix of `docs/superpowers/plans/2026-08-23-3d-solids-modal.md`.
- The remote-packs code-review fix wave (15 findings on `1a5620c`) is a separate pending decision.
- box3/face3 shading is UNCHANGED by design: flat per-face brightness is physically right for flat faces (the visual complaint was specifically about spheres).
- No `<defs>`-level gradient dedup: per-leaf gradients are ~5 SVG nodes each and molecule scenes have ≤10 spheres — sharing would add bookkeeping for no visible win.

## Self-review notes

- Spec coverage: the spec (§3a) mandates projection, primitives, painter's sort, wireframe-with-dashed-hidden-edges for polyhedra — all untouched or extended (wire spheres extend the same textbook convention). No spec text mandates crescent shading; kit docstrings updated in Task 2 Step 4.
- Type consistency: `GradientSpec` (Task 1) is the exact type consumed in Task 2's `fillGradient` literal; `openModel3d`'s 5th parameter (Task 3 Step 3) matches the call in Step 4 and the tests in Step 1.
- The bundled-examples test is the safety net for the examples.json edit (Task 2 Step 6): any missed `__sh` id fails "all drawn ids exist".
