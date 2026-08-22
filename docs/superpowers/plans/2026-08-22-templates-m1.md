# Templates M1 Implementation Plan — format + runtime + sceneKit

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Templates can exist as data — a YAML document whose `layout:` is a JS function body compiled with `new Function`, guarded, and registered alongside compiled-TS scenes — proven by porting `cell_diagram` to the new format.

**Architecture:** Three new modules under `src/scenes/`: `kit.ts` (the authoring stdlib handed to layout bodies), `doc.ts` (TemplateDoc type + YAML parse + validation), `compile.ts` (body compilation + output guard). `registry.ts` gains `registerTemplateDoc()`; the existing `layoutSpec` try/catch is the runtime failure path (no new failure architecture). The `cell_diagram` TS module is REPLACED by a bundled `template.yaml` (no-backwards-compat principle: replace, don't duplicate).

**Tech Stack:** TypeScript strict, vite (`?raw` imports work in app and vitest), js-yaml 4 (already a dependency), vitest.

**Spec:** `docs/superpowers/specs/2026-08-22-templates-design.md` (§1 format, §2 runtime, §3 kit, §8 errors). Task 5 amends the spec's port-target sentence: the four domain scenes (added 2026-08-22, after the spec) make `cell_diagram` the better validation port than decision_tree/supply_demand — it uses exactly the kit helpers M1 ships and nothing else.

## Global Constraints

- No new npm dependencies; the repo deliberately has NO package-lock.json — never commit one.
- Verification gate before every commit: `npx tsc && npx vitest run` — NEVER `npm run build 2>&1 | tail` (pipes mask tsc exit status; known repo trap).
- Layout code must be deterministic: no `Math.random`, no `Date` (kit provides `jitter`).
- Logical coordinates are y-up on a 1000×750 canvas (`CANVAS` from `src/layout/canvas.ts`).
- Engines are NOT supported in M1: a doc with non-empty `engines` fails validation with a message naming M4.
- `KIT_VERSION = 1`; a doc with `kit > KIT_VERSION` fails validation ("written for a newer kit").
- Commit messages end with: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`

## File Structure

- Create `src/scenes/kit.ts` — sceneKit v1: drawable/label factories with house defaults, geometry helpers, seeded jitter, standard-notation parsers, constants. Stateless; exported as one `kit` object. Doc comments here are the future authoring-prompt documentation.
- Create `src/scenes/doc.ts` — `TemplateDoc` type, `parseTemplateDoc(yaml)`, `validateTemplateDoc(raw)`, `docToManifest(doc)`.
- Create `src/scenes/compile.ts` — `validateSceneLayout(v)` output guard + `compileTemplateDoc(doc)` producing a `SceneModule`.
- Modify `src/scenes/registry.ts` — add `registerTemplateDoc(doc)`; register the bundled cell_diagram doc; remove the TS cell_diagram entry.
- Create `src/scenes/cell_diagram/template.yaml` — the port (manifest fields + layout body).
- Delete `src/scenes/cell_diagram/layout.ts` and `src/scenes/cell_diagram/manifest.json` (Task 5).
- Modify `tests/domain-scenes.test.ts` — cell_diagram accessed via the registry, not direct import.
- Test files: `tests/scene-kit.test.ts`, `tests/template-doc.test.ts`, `tests/template-compile.test.ts`.

---

### Task 1: sceneKit v1 (`src/scenes/kit.ts`)

**Files:**
- Create: `src/scenes/kit.ts`
- Test: `tests/scene-kit.test.ts`

**Interfaces:**
- Consumes: `src/layout/model.ts` (`Drawable`, `Pt`, `COLORS`, `CANVAS` via `src/layout/canvas.ts`, `SKETCH_MS`, `defaultStyle`, `defaultDrawOpts`, `Z_*`), `src/layout/labels.ts` (`LabelRequest`), `src/spec/types.ts` (`Side`).
- Produces (later tasks rely on these exact names):
  - `export const KIT_VERSION = 1`
  - `export interface SceneKit { ... }` and `export const kit: SceneKit`
  - Factories: `stroke(id, pts, o?)`, `area(id, pts, fill, o?)`, `text(id, pos, s, o?)`, `label(id, anchor, side, s, o?)`, `group(id, children)`
  - Geometry: `polygon(c, r, n, rot?)`, `arc(c, r, a0, a1, n?)`, `ellipse(c, rx, ry, n?)`, `blob(c, rx, ry, wobble?, phase?, n?)`, `wave(from, length, amplitude, wavelength, step?)`, `smooth(pts, per?)`, `parallelOffset(pts, d)`, `blockArrow(from, to, bodyW, headW, headL)`, `hatch(from, to, n?, len?, dir?)`, `jitter(i)`
  - Parsers: `parseSS(s)`, `parseNewick(s)`, `parseEdgeList(s)`
  - Constants re-exported on the kit object: `COLORS`, `CANVAS`, `SKETCH_MS`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/scene-kit.test.ts
import { describe, expect, test } from "vitest";
import { kit, KIT_VERSION } from "../src/scenes/kit";

describe("kit factories", () => {
  test("stroke applies house defaults and options", () => {
    const s = kit.stroke("a", [[0, 0], [10, 0]], { color: "red", dash: true, closed: true });
    expect(s.kind).toBe("stroke");
    expect(s.id).toBe("a");
    expect(s.style.color).toBe("red");
    expect(s.style.dash).toBe(true);
    expect(s.closed).toBe(true);
    expect(s.drawOpts.mode).toBe("sketch");
  });

  test("area fills, text positions, label builds a LabelRequest", () => {
    const a = kit.area("r", [[0, 0], [10, 0], [10, 10]], "gold");
    expect(a.style.fill).toBe("gold");
    const t = kit.text("t", [5, 5], "H₂O", { fontSize: 30 });
    expect(t.text).toBe("H₂O");
    expect(t.drawOpts.mode).toBe("instant");
    const l = kit.label("l", [1, 2], "above", "Nucleus");
    expect(l.side).toBe("above");
    expect(l.anchor).toEqual([1, 2]);
  });

  test("group wraps children", () => {
    const g = kit.group("g", [kit.stroke("g_1", [[0, 0], [1, 1]])]);
    expect(g.kind).toBe("group");
    expect(g.children).toHaveLength(1);
  });
});

describe("kit geometry", () => {
  test("polygon returns n vertices at radius r", () => {
    const pts = kit.polygon([0, 0], 10, 6);
    expect(pts).toHaveLength(6);
    for (const [x, y] of pts) expect(Math.hypot(x, y)).toBeCloseTo(10, 6);
  });

  test("arc spans a0..a1", () => {
    const pts = kit.arc([0, 0], 5, 0, Math.PI, 10);
    expect(pts[0][0]).toBeCloseTo(5);
    expect(pts[pts.length - 1][0]).toBeCloseTo(-5);
  });

  test("blob is closed-ish, deterministic, and wobbles around the ellipse", () => {
    const a = kit.blob([100, 100], 50, 40);
    const b = kit.blob([100, 100], 50, 40);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    for (const [x, y] of a) {
      const rr = Math.hypot((x - 100) / 50, (y - 100) / 40);
      expect(rr).toBeGreaterThan(0.85);
      expect(rr).toBeLessThan(1.15);
    }
  });

  test("parallelOffset keeps distance d on a straight line", () => {
    const off = kit.parallelOffset([[0, 0], [10, 0]], 3);
    expect(off[0][1]).toBeCloseTo(3);
    expect(off[1][1]).toBeCloseTo(3);
  });

  test("blockArrow is a closed 7-point polygon ending at the tip", () => {
    const poly = kit.blockArrow([0, 0], [100, 0], 20, 40, 30);
    expect(poly).toHaveLength(7);
    expect(poly[3]).toEqual([100, 0]);
  });

  test("hatch returns n segments along the line", () => {
    const segs = kit.hatch([0, 0], [100, 0], 10, 15, -1);
    expect(segs).toHaveLength(10);
    expect(segs[0][1][1]).toBeCloseTo(-15 * Math.SQRT1_2, 1);
  });

  test("wave oscillates around the baseline", () => {
    const pts = kit.wave([0, 100], 92, 30, 46);
    const ys = pts.map((p) => p[1]);
    expect(Math.max(...ys)).toBeGreaterThan(125);
    expect(Math.min(...ys)).toBeLessThan(75);
  });

  test("smooth interpolates through the input points", () => {
    const out = kit.smooth([[0, 0], [50, 100], [100, 0]], 8);
    expect(out.length).toBeGreaterThan(10);
    expect(out[out.length - 1]).toEqual([100, 0]);
  });

  test("jitter is deterministic and in (-1, 1)", () => {
    expect(kit.jitter(7)).toBe(kit.jitter(7));
    for (let i = 0; i < 50; i++) expect(Math.abs(kit.jitter(i))).toBeLessThan(1);
  });
});

describe("kit parsers", () => {
  test("parseSS turns runs into segments", () => {
    expect(kit.parseSS("CCHHHHHCCEEEECC")).toEqual([
      { kind: "loop", length: 2 },
      { kind: "helix", length: 5 },
      { kind: "loop", length: 2 },
      { kind: "sheet", length: 4 },
      { kind: "loop", length: 2 },
    ]);
  });

  test("parseNewick builds the tree with names and branch lengths", () => {
    const t = kit.parseNewick("((A:1,B:2)AB:0.5,C);");
    expect(t.children).toHaveLength(2);
    expect(t.children[0].name).toBe("AB");
    expect(t.children[0].children.map((c) => c.name)).toEqual(["A", "B"]);
    expect(t.children[0].children[1].length).toBe(2);
    expect(t.children[1].name).toBe("C");
  });

  test("parseEdgeList reads ->, -| and =>", () => {
    expect(kit.parseEdgeList("EGFR -> RAS; RAS -| p53\nX => Y")).toEqual([
      { from: "EGFR", to: "RAS", effect: "activates" },
      { from: "RAS", to: "p53", effect: "inhibits" },
      { from: "X", to: "Y", effect: "converts" },
    ]);
  });
});

test("KIT_VERSION is 1 and constants ride on the kit", () => {
  expect(KIT_VERSION).toBe(1);
  expect(kit.CANVAS.w).toBe(1000);
  expect(kit.COLORS.ink).toBeDefined();
  expect(kit.SKETCH_MS.stroke).toBeGreaterThan(0);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/scene-kit.test.ts`
Expected: FAIL — cannot resolve `../src/scenes/kit`.

- [ ] **Step 3: Implement `src/scenes/kit.ts`**

```ts
// sceneKit v1 — the stdlib handed to template layout bodies as `kit`.
// Layout bodies cannot import anything; every helper they need lives here.
// The doc comments double as the authoring-prompt documentation (M2).
//
// Two rules every layout must follow:
// 1. Text that IS geometry (atom symbols, termini) = kit.text (exact position);
//    text that NAMES things = kit.label (the collision solver may move it).
// 2. Repeated micro-strokes (bonds, dots, hatching) go in ONE kit.group —
//    groups are the narration/annotation beats.

import { CANVAS } from "../layout/canvas";
import {
  COLORS,
  SKETCH_MS,
  Z_AREA,
  Z_STROKE,
  Z_TEXT,
  defaultDrawOpts,
  defaultStyle,
  type AreaDrawable,
  type Drawable,
  type GroupDrawable,
  type Pt,
  type ShapeHint,
  type StrokeDrawable,
  type TextDrawable,
} from "../layout/model";
import type { LabelRequest } from "../layout/labels";
import type { Side } from "../spec/types";

export const KIT_VERSION = 1;

export interface StrokeOpts {
  closed?: boolean;
  arrowhead?: "end" | "start" | "both";
  shapeHint?: ShapeHint;
  color?: string;
  fill?: string;
  strokeWidth?: number;
  dash?: boolean;
  opacity?: number;
  /** Sketch duration ms (default SKETCH_MS.stroke). */
  ms?: number;
  /** Draw instantly instead of sketching. */
  instant?: boolean;
}

export interface TextOpts {
  fontSize?: number;
  color?: string;
  anchor?: "start" | "middle" | "end";
}

export interface NewickNode {
  name?: string;
  length?: number;
  children: NewickNode[];
}

export interface SSSegment {
  kind: "helix" | "sheet" | "loop";
  length: number;
}

export interface Edge {
  from: string;
  to: string;
  effect: "activates" | "inhibits" | "converts";
}

export interface SceneKit {
  // ---- factories ----
  stroke(id: string, pts: Pt[], o?: StrokeOpts): StrokeDrawable;
  area(id: string, pts: Pt[], fill: string, o?: { opacity?: number; ms?: number }): AreaDrawable;
  text(id: string, pos: Pt, s: string, o?: TextOpts): TextDrawable;
  label(id: string, anchor: Pt, side: Side, s: string, o?: { fontSize?: number; color?: string }): LabelRequest;
  group(id: string, children: Drawable[]): GroupDrawable;
  // ---- geometry (all return points in logical y-up coordinates) ----
  polygon(c: Pt, r: number, n: number, rot?: number): Pt[];
  arc(c: Pt, r: number, a0: number, a1: number, n?: number): Pt[];
  ellipse(c: Pt, rx: number, ry: number, n?: number): Pt[];
  /** Organic closed blob: ellipse with seeded low-frequency wobble. */
  blob(c: Pt, rx: number, ry: number, wobble?: number, phase?: number, n?: number): Pt[];
  /** Horizontal sine wave starting at `from`, extending `length` to the right. */
  wave(from: Pt, length: number, amplitude: number, wavelength: number, step?: number): Pt[];
  /** Catmull–Rom smoothing through the given points. */
  smooth(pts: Pt[], per?: number): Pt[];
  /** Polyline offset by d to the left of travel (double bonds, membranes). */
  parallelOffset(pts: Pt[], d: number): Pt[];
  /** Closed 7-point block-arrow polygon from → to (β-strands, big arrows). */
  blockArrow(from: Pt, to: Pt, bodyW: number, headW: number, headL: number): Pt[];
  /** n short hatch ticks along from→to (ground, walls). dir −1 = below/right. */
  hatch(from: Pt, to: Pt, n?: number, len?: number, dir?: 1 | -1): [Pt, Pt][];
  /** Deterministic pseudo-random in (−1, 1). NEVER use Math.random. */
  jitter(i: number): number;
  // ---- standard-notation parsers ----
  /** "CCHHHEEE" (H helix / E sheet / C loop) → run-length segments. */
  parseSS(s: string): SSSegment[];
  /** Newick tree string, e.g. "((A:1,B:2)AB,C);" */
  parseNewick(s: string): NewickNode;
  /** "A -> B; B -| C; X => Y" (activates / inhibits / converts). */
  parseEdgeList(s: string): Edge[];
  // ---- constants ----
  COLORS: typeof COLORS;
  CANVAS: typeof CANVAS;
  SKETCH_MS: typeof SKETCH_MS;
}

export const kit: SceneKit = {
  stroke(id, pts, o = {}) {
    return {
      id,
      kind: "stroke",
      pts,
      closed: o.closed,
      arrowhead: o.arrowhead,
      shapeHint: o.shapeHint,
      z: Z_STROKE,
      style: defaultStyle({
        ...(o.color !== undefined && { color: o.color }),
        ...(o.fill !== undefined && { fill: o.fill }),
        ...(o.strokeWidth !== undefined && { strokeWidth: o.strokeWidth }),
        ...(o.dash !== undefined && { dash: o.dash }),
        ...(o.opacity !== undefined && { opacity: o.opacity }),
      }),
      drawOpts: o.instant ? defaultDrawOpts("instant") : defaultDrawOpts("sketch", o.ms ?? SKETCH_MS.stroke),
    };
  },
  area(id, pts, fill, o = {}) {
    return {
      id,
      kind: "area",
      pts,
      z: Z_AREA,
      style: defaultStyle({ fill, opacity: o.opacity ?? 0.35, strokeWidth: 0 }),
      drawOpts: defaultDrawOpts("sketch", o.ms ?? SKETCH_MS.region),
    };
  },
  text(id, pos, s, o = {}) {
    return {
      id,
      kind: "text",
      pos,
      text: s,
      fontSize: o.fontSize ?? 28,
      anchor: o.anchor ?? "middle",
      z: Z_TEXT,
      style: defaultStyle(o.color !== undefined ? { color: o.color } : {}),
      drawOpts: defaultDrawOpts("instant"),
    };
  },
  label(id, anchor, side, s, o = {}) {
    return {
      id,
      anchor,
      side,
      text: s,
      fontSize: o.fontSize ?? 26,
      style: defaultStyle(o.color !== undefined ? { color: o.color } : {}),
      drawOpts: defaultDrawOpts("instant"),
    };
  },
  group(id, children) {
    return { id, kind: "group", z: Z_STROKE, style: defaultStyle(), drawOpts: defaultDrawOpts(), children };
  },

  polygon(c, r, n, rot = Math.PI / 2) {
    const pts: Pt[] = [];
    for (let i = 0; i < n; i++) {
      const th = rot + (i * 2 * Math.PI) / n;
      pts.push([c[0] + r * Math.cos(th), c[1] + r * Math.sin(th)]);
    }
    return pts;
  },
  arc(c, r, a0, a1, n = 24) {
    const pts: Pt[] = [];
    for (let i = 0; i <= n; i++) {
      const th = a0 + ((a1 - a0) * i) / n;
      pts.push([c[0] + r * Math.cos(th), c[1] + r * Math.sin(th)]);
    }
    return pts;
  },
  ellipse(c, rx, ry, n = 48) {
    const pts: Pt[] = [];
    for (let i = 0; i < n; i++) {
      const th = (i / n) * 2 * Math.PI;
      pts.push([c[0] + rx * Math.cos(th), c[1] + ry * Math.sin(th)]);
    }
    return pts;
  },
  blob(c, rx, ry, wobble = 0.05, phase = 0, n = 64) {
    const pts: Pt[] = [];
    for (let i = 0; i < n; i++) {
      const th = (i / n) * 2 * Math.PI;
      const w = 1 + wobble * Math.sin(3 * th + phase) + wobble * 0.6 * Math.sin(7 * th + phase * 2);
      pts.push([c[0] + rx * w * Math.cos(th), c[1] + ry * w * Math.sin(th)]);
    }
    return pts;
  },
  wave(from, length, amplitude, wavelength, step = 4) {
    const pts: Pt[] = [];
    for (let t = 0; t <= length; t += step) {
      pts.push([from[0] + t, from[1] + amplitude * Math.sin((t / wavelength) * 2 * Math.PI)]);
    }
    return pts;
  },
  smooth(pts, per = 8) {
    if (pts.length < 3) return pts.map((p): Pt => [p[0], p[1]]);
    const P = [pts[0], ...pts, pts[pts.length - 1]];
    const out: Pt[] = [];
    for (let i = 0; i + 3 < P.length; i++) {
      const [p0, p1, p2, p3] = [P[i], P[i + 1], P[i + 2], P[i + 3]];
      for (let j = 0; j < per; j++) {
        const t = j / per, t2 = t * t, t3 = t2 * t;
        out.push([
          0.5 * (2 * p1[0] + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
          0.5 * (2 * p1[1] + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3),
        ]);
      }
    }
    out.push([pts[pts.length - 1][0], pts[pts.length - 1][1]]);
    return out;
  },
  parallelOffset(pts, d) {
    const out: Pt[] = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[Math.max(0, i - 1)];
      const b = pts[Math.min(pts.length - 1, i + 1)];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      out.push([pts[i][0] - ((b[1] - a[1]) / len) * d, pts[i][1] + ((b[0] - a[0]) / len) * d]);
    }
    return out;
  },
  blockArrow(from, to, bodyW, headW, headL) {
    const dx = to[0] - from[0], dy = to[1] - from[1];
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len, uy = dy / len;
    const nx = -uy, ny = ux;
    const neck: Pt = [to[0] - ux * headL, to[1] - uy * headL];
    const h = bodyW / 2, H = headW / 2;
    return [
      [from[0] + nx * h, from[1] + ny * h],
      [neck[0] + nx * h, neck[1] + ny * h],
      [neck[0] + nx * H, neck[1] + ny * H],
      [to[0], to[1]],
      [neck[0] - nx * H, neck[1] - ny * H],
      [neck[0] - nx * h, neck[1] - ny * h],
      [from[0] - nx * h, from[1] - ny * h],
    ];
  },
  hatch(from, to, n = 18, len = 20, dir = -1) {
    const segs: [Pt, Pt][] = [];
    const dx = to[0] - from[0], dy = to[1] - from[1];
    const dlen = Math.hypot(dx, dy) || 1;
    // 45° tick: half back along the line, half perpendicular.
    const tx = (-dx / dlen + (dy / dlen) * -dir) * (len * Math.SQRT1_2);
    const ty = (-dy / dlen + (-dx / dlen) * -dir) * (len * Math.SQRT1_2);
    for (let i = 1; i <= n; i++) {
      const t = i / (n + 1);
      const p: Pt = [from[0] + dx * t, from[1] + dy * t];
      segs.push([p, [p[0] + tx, p[1] + ty]]);
    }
    return segs;
  },
  jitter(i) {
    return Math.sin(i * 12.9898 + 4.1414) % 1;
  },

  parseSS(s) {
    const clean = s.toUpperCase().replace(/[^HEC]/g, "");
    const out: SSSegment[] = [];
    let i = 0;
    while (i < clean.length) {
      let j = i;
      while (j < clean.length && clean[j] === clean[i]) j++;
      out.push({ kind: clean[i] === "H" ? "helix" : clean[i] === "E" ? "sheet" : "loop", length: j - i });
      i = j;
    }
    return out;
  },
  parseNewick(s) {
    const src = s.trim().replace(/;\s*$/, "");
    let i = 0;
    const node = (): NewickNode => {
      const n: NewickNode = { children: [] };
      if (src[i] === "(") {
        i++;
        n.children.push(node());
        while (src[i] === ",") {
          i++;
          n.children.push(node());
        }
        if (src[i] !== ")") throw new Error(`newick: expected ")" at ${i}`);
        i++;
      }
      let name = "";
      while (i < src.length && !"(),:".includes(src[i])) name += src[i++];
      if (name.trim()) n.name = name.trim();
      if (src[i] === ":") {
        i++;
        let num = "";
        while (i < src.length && !"(),".includes(src[i])) num += src[i++];
        n.length = Number(num);
      }
      return n;
    };
    const root = node();
    if (i !== src.length) throw new Error(`newick: trailing input at ${i}`);
    return root;
  },
  parseEdgeList(s) {
    const out: Edge[] = [];
    for (const part of s.split(/[;\n]/)) {
      const m = part.trim().match(/^(.+?)\s*(->|-\||=>)\s*(.+)$/);
      if (!m) continue;
      out.push({
        from: m[1].trim(),
        to: m[3].trim(),
        effect: m[2] === "->" ? "activates" : m[2] === "-|" ? "inhibits" : "converts",
      });
    }
    return out;
  },

  COLORS,
  CANVAS,
  SKETCH_MS,
};
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/scene-kit.test.ts`
Expected: PASS (all tests). Note for the hatch test: with `dir = -1` on a left-to-right line, ticks go down-and-back; the y of the tick end is `−len·√½`.

- [ ] **Step 5: Gate and commit**

```bash
npx tsc && npx vitest run
git add src/scenes/kit.ts tests/scene-kit.test.ts
git commit -m "feat: sceneKit v1 — factories, geometry, seeded jitter, notation parsers

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: TemplateDoc parse + validation (`src/scenes/doc.ts`)

**Files:**
- Create: `src/scenes/doc.ts`
- Test: `tests/template-doc.test.ts`

**Interfaces:**
- Consumes: `KIT_VERSION` from `src/scenes/kit.ts`; `SceneManifest` from `src/scenes/types.ts`; `load, CORE_SCHEMA` from `js-yaml`.
- Produces:
  - `export interface TemplateDoc { template: string; title?: string; version: number; kit: number; status: "ready" | "stub"; description: string; params: object; element_ids: Record<string, string>; examples: { request: string; params: Record<string, unknown> }[]; engines?: string[]; layout?: string }`
  - `export interface DocResult { doc?: TemplateDoc; errors: string[] }`
  - `export function parseTemplateDoc(yamlText: string): DocResult`
  - `export function validateTemplateDoc(raw: unknown): DocResult`
  - `export function docToManifest(doc: TemplateDoc): SceneManifest`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/template-doc.test.ts
import { describe, expect, test } from "vitest";
import { parseTemplateDoc, validateTemplateDoc, docToManifest } from "../src/scenes/doc";

const GOOD = `
template: demo_ring
title: Demo ring
version: 1
kit: 1
status: ready
description: A demo.
params:
  type: object
  properties:
    n: { type: number }
element_ids:
  ring: the ring
examples:
  - request: "Draw a ring."
    params: { n: 6 }
layout: |
  return { drawables: [kit.stroke("ring", kit.polygon([500, 400], 100, params.n ?? 6), { closed: true })], labels: [], anchors: {}, order: ["ring"] };
`;

describe("parseTemplateDoc", () => {
  test("parses a good document", () => {
    const r = parseTemplateDoc(GOOD);
    expect(r.errors).toEqual([]);
    expect(r.doc?.template).toBe("demo_ring");
    expect(r.doc?.layout).toContain("kit.polygon");
  });

  test("reports YAML syntax errors instead of throwing", () => {
    const r = parseTemplateDoc("template: [unclosed");
    expect(r.doc).toBeUndefined();
    expect(r.errors.length).toBeGreaterThan(0);
  });
});

describe("validateTemplateDoc", () => {
  const base = () => parseTemplateDoc(GOOD).doc as Record<string, unknown>;

  test("rejects a bad template id", () => {
    const d = base();
    d.template = "Bad Name!";
    expect(validateTemplateDoc(d).errors[0]).toMatch(/template id/);
  });

  test("rejects ready without layout", () => {
    const d = base();
    delete d.layout;
    expect(validateTemplateDoc(d).errors[0]).toMatch(/layout/);
  });

  test("stub without layout is fine", () => {
    const d = base();
    d.status = "stub";
    delete d.layout;
    expect(validateTemplateDoc(d).errors).toEqual([]);
  });

  test("rejects kit newer than KIT_VERSION", () => {
    const d = base();
    d.kit = 99;
    expect(validateTemplateDoc(d).errors[0]).toMatch(/newer kit/);
  });

  test("rejects engines in M1", () => {
    const d = base();
    d.engines = ["smilesdrawer"];
    expect(validateTemplateDoc(d).errors[0]).toMatch(/M4/);
  });

  test("rejects malformed examples", () => {
    const d = base();
    d.examples = [{ params: {} }];
    expect(validateTemplateDoc(d).errors[0]).toMatch(/example/);
  });
});

test("docToManifest maps fields onto SceneManifest", () => {
  const doc = parseTemplateDoc(GOOD).doc!;
  const m = docToManifest(doc);
  expect(m.name).toBe("demo_ring");
  expect(m.status).toBe("ready");
  expect(m.params_schema).toEqual(doc.params);
  expect(m.element_ids.ring).toBe("the ring");
  expect(m.examples).toHaveLength(1);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/template-doc.test.ts`
Expected: FAIL — cannot resolve `../src/scenes/doc`.

- [ ] **Step 3: Implement `src/scenes/doc.ts`**

```ts
// TemplateDoc — the one document format every template uses (spec §1),
// whether bundled, in a pack, or user-created.

import { CORE_SCHEMA, load } from "js-yaml";
import { KIT_VERSION } from "./kit";
import type { SceneManifest } from "./types";

export interface TemplateDoc {
  template: string;
  title?: string;
  version: number;
  kit: number;
  status: "ready" | "stub";
  description: string;
  /** JSON schema for params — content only, never coordinates. */
  params: object;
  element_ids: Record<string, string>;
  examples: { request: string; params: Record<string, unknown> }[];
  engines?: string[];
  /** JS function body: (params, kit, engines) => SceneLayout. Required when ready. */
  layout?: string;
}

export interface DocResult {
  doc?: TemplateDoc;
  errors: string[];
}

export function parseTemplateDoc(yamlText: string): DocResult {
  let raw: unknown;
  try {
    raw = load(yamlText, { schema: CORE_SCHEMA });
  } catch (err) {
    return { errors: [`YAML: ${(err as Error).message}`] };
  }
  return validateTemplateDoc(raw);
}

const ID_RE = /^[a-z][a-z0-9_]*$/;

export function validateTemplateDoc(raw: unknown): DocResult {
  const errors: string[] = [];
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { errors: ["document must be a YAML mapping"] };
  }
  const d = raw as Record<string, unknown>;

  if (typeof d.template !== "string" || !ID_RE.test(d.template)) {
    errors.push(`template id must match ${ID_RE} — got ${JSON.stringify(d.template)}`);
  }
  if (!Number.isInteger(d.version) || (d.version as number) < 1) errors.push("version must be a positive integer");
  if (!Number.isInteger(d.kit) || (d.kit as number) < 1) {
    errors.push("kit must be a positive integer");
  } else if ((d.kit as number) > KIT_VERSION) {
    errors.push(`written for a newer kit (${d.kit} > ${KIT_VERSION}) — update the app`);
  }
  if (d.status !== "ready" && d.status !== "stub") errors.push('status must be "ready" or "stub"');
  if (typeof d.description !== "string" || d.description.trim() === "") errors.push("description is required");
  if (typeof d.params !== "object" || d.params === null) errors.push("params must be an object (JSON schema)");
  if (typeof d.element_ids !== "object" || d.element_ids === null || Object.values(d.element_ids as object).some((v) => typeof v !== "string")) {
    errors.push("element_ids must map ids to doc strings");
  }
  if (!Array.isArray(d.examples)) {
    errors.push("examples must be an array");
  } else {
    d.examples.forEach((ex, i) => {
      const e = ex as Record<string, unknown>;
      if (typeof e?.request !== "string" || typeof e?.params !== "object" || e.params === null) {
        errors.push(`example ${i} must have a request string and a params object`);
      }
    });
  }
  if (d.engines !== undefined && (!Array.isArray(d.engines) || d.engines.length > 0)) {
    errors.push("engines are not supported yet (they arrive in M4) — remove the engines field");
  }
  if (d.status === "ready" && (typeof d.layout !== "string" || d.layout.trim() === "")) {
    errors.push("a ready template needs a layout function body");
  }
  if (d.title !== undefined && typeof d.title !== "string") errors.push("title must be a string");

  return errors.length > 0 ? { errors } : { doc: d as unknown as TemplateDoc, errors: [] };
}

export function docToManifest(doc: TemplateDoc): SceneManifest {
  return {
    name: doc.template,
    status: doc.status,
    description: doc.description,
    params_schema: doc.params,
    element_ids: doc.element_ids,
    examples: doc.examples,
  };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/template-doc.test.ts`
Expected: PASS.

- [ ] **Step 5: Gate and commit**

```bash
npx tsc && npx vitest run
git add src/scenes/doc.ts tests/template-doc.test.ts
git commit -m "feat: TemplateDoc format — YAML parse + validation + manifest mapping

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Compile + output guard (`src/scenes/compile.ts`)

**Files:**
- Create: `src/scenes/compile.ts`
- Test: `tests/template-compile.test.ts`

**Interfaces:**
- Consumes: `TemplateDoc`, `docToManifest` from `src/scenes/doc.ts`; `kit` from `src/scenes/kit.ts`; `SceneModule` from `src/scenes/registry.ts` — NOTE: to avoid an import cycle (registry will import compile in Task 4), move the `SceneModule` interface from `registry.ts` into `src/scenes/types.ts` in this task and re-export it from `registry.ts` (`export type { SceneModule } from "./types"`), keeping existing importers working.
- Produces:
  - `export function validateSceneLayout(v: unknown): string[]` — `[]` means valid.
  - `export function compileTemplateDoc(doc: TemplateDoc): { module?: SceneModule; errors: string[] }` — compiles the body ONCE; the returned `module.layout` runs the body and THROWS on invalid output (so `layoutSpec`'s existing catch produces the fall-through warning; spec §2 "no new failure architecture").

- [ ] **Step 1: Move `SceneModule` to `src/scenes/types.ts`**

In `src/scenes/types.ts`, append:

```ts
/** A registered template: manifest always; layout when ready and compiled. */
export interface SceneModule {
  manifest: SceneManifest;
  layout?: (params: Record<string, unknown>) => SceneLayout;
}
```

In `src/scenes/registry.ts`, delete the local `SceneModule` interface and replace with:

```ts
import type { SceneLayout, SceneManifest, SceneModule } from "./types";
export type { SceneModule } from "./types";
```

Run: `npx tsc` — Expected: clean (the shape is identical; existing `import { SceneModule } from "./registry"` sites keep working via the re-export).

- [ ] **Step 2: Write the failing tests**

```ts
// tests/template-compile.test.ts
import { describe, expect, test } from "vitest";
import { compileTemplateDoc, validateSceneLayout } from "../src/scenes/compile";
import type { TemplateDoc } from "../src/scenes/doc";

function doc(layout: string): TemplateDoc {
  return {
    template: "t_demo",
    version: 1,
    kit: 1,
    status: "ready",
    description: "d",
    params: {},
    element_ids: {},
    examples: [{ request: "r", params: {} }],
    layout,
  };
}

const GOOD_BODY = `
const pts = kit.polygon([500, 400], 100, params.n ?? 6);
return { drawables: [kit.stroke("ring", pts, { closed: true })], labels: [], anchors: { ring_center: [500, 400] }, order: ["ring"] };
`;

describe("compileTemplateDoc", () => {
  test("a good body compiles and runs deterministically", () => {
    const { module, errors } = compileTemplateDoc(doc(GOOD_BODY));
    expect(errors).toEqual([]);
    const a = module!.layout!({ n: 5 });
    expect(a.drawables[0].id).toBe("ring");
    expect(JSON.stringify(a)).toBe(JSON.stringify(module!.layout!({ n: 5 })));
  });

  test("a syntax error is a compile error, not a throw", () => {
    const { module, errors } = compileTemplateDoc(doc("return {{{"));
    expect(module).toBeUndefined();
    expect(errors[0]).toMatch(/compile/);
  });

  test("a body that throws at runtime propagates (layoutSpec catches it)", () => {
    const { module } = compileTemplateDoc(doc(`throw new Error("boom");`));
    expect(() => module!.layout!({})).toThrow(/boom/);
  });

  test("garbage output throws with a validation message", () => {
    const { module } = compileTemplateDoc(doc(`return { nope: true };`));
    expect(() => module!.layout!({})).toThrow(/drawables/);
  });

  test("NaN coordinates are rejected", () => {
    const { module } = compileTemplateDoc(doc(`return { drawables: [kit.stroke("a", [[0, NaN]])], labels: [], anchors: {}, order: ["a"] };`));
    expect(() => module!.layout!({})).toThrow(/finite/);
  });

  test("imports are impossible from a body", () => {
    const { module, errors } = compileTemplateDoc(doc(`import x from "y"; return null;`));
    // import is a syntax error inside a function body
    expect(module).toBeUndefined();
    expect(errors.length).toBeGreaterThan(0);
  });
});

describe("validateSceneLayout", () => {
  test("accepts a minimal valid layout", () => {
    expect(validateSceneLayout({ drawables: [], labels: [], anchors: {}, order: [] })).toEqual([]);
  });

  test("rejects duplicate top-level drawable ids", () => {
    const d = { id: "x", kind: "stroke", pts: [[0, 0]], z: 1, style: { color: "#000", strokeWidth: 1, roughness: 1, opacity: 1 }, drawOpts: { mode: "instant", duration: 0 } };
    const errs = validateSceneLayout({ drawables: [d, { ...d }], labels: [], anchors: {}, order: ["x"] });
    expect(errs[0]).toMatch(/duplicate/);
  });

  test("rejects order entries that name nothing", () => {
    const errs = validateSceneLayout({ drawables: [], labels: [], anchors: {}, order: ["ghost"] });
    expect(errs[0]).toMatch(/order/);
  });

  test("rejects coordinates far outside the canvas", () => {
    const errs = validateSceneLayout({
      drawables: [{ id: "a", kind: "stroke", pts: [[99999, 0]], z: 1, style: { color: "#000", strokeWidth: 1, roughness: 1, opacity: 1 }, drawOpts: { mode: "instant", duration: 0 } }],
      labels: [],
      anchors: {},
      order: ["a"],
    });
    expect(errs[0]).toMatch(/bounds/);
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run tests/template-compile.test.ts`
Expected: FAIL — cannot resolve `../src/scenes/compile`.

- [ ] **Step 4: Implement `src/scenes/compile.ts`**

```ts
// Compile a TemplateDoc's layout body into a guarded SceneModule (spec §2).
// The body is compiled ONCE via new Function; the guard validates the output
// shape and throws on violations — layoutSpec's existing try/catch turns that
// into the fall-through-to-tier-2 warning. No new failure architecture.

import { kit } from "./kit";
import { docToManifest, type TemplateDoc } from "./doc";
import type { SceneLayout, SceneModule } from "./types";
import { flattenDrawables, type Drawable, type Pt } from "../layout/model";

/** Sane coordinate bound: well beyond the 1000×750 canvas, catches runaways. */
const COORD_BOUND = 4000;

const SIDES = new Set(["above", "below", "left", "right", "above-left", "above-right", "below-left", "below-right"]);

export function compileTemplateDoc(doc: TemplateDoc): { module?: SceneModule; errors: string[] } {
  if (doc.status !== "ready" || !doc.layout) {
    return { module: { manifest: docToManifest(doc) }, errors: [] };
  }
  let fn: (params: Record<string, unknown>, kit: unknown, engines: unknown) => unknown;
  try {
    fn = new Function("params", "kit", "engines", `"use strict";\n${doc.layout}`) as typeof fn;
  } catch (err) {
    return { errors: [`template "${doc.template}" failed to compile: ${(err as Error).message}`] };
  }
  const layout = (params: Record<string, unknown>): SceneLayout => {
    const out = fn(params, kit, {});
    const errs = validateSceneLayout(out);
    if (errs.length > 0) {
      throw new Error(`template "${doc.template}" returned an invalid layout: ${errs[0]}`);
    }
    return out as SceneLayout;
  };
  return { module: { manifest: docToManifest(doc), layout }, errors: [] };
}

function finitePt(p: unknown): p is Pt {
  return Array.isArray(p) && p.length === 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]) && Math.abs(p[0] as number) <= COORD_BOUND && Math.abs(p[1] as number) <= COORD_BOUND;
}

export function validateSceneLayout(v: unknown): string[] {
  if (typeof v !== "object" || v === null) return ["result must be an object with drawables/labels/anchors/order"];
  const r = v as Record<string, unknown>;
  if (!Array.isArray(r.drawables)) return ["drawables must be an array"];
  if (!Array.isArray(r.labels)) return ["labels must be an array"];
  if (typeof r.anchors !== "object" || r.anchors === null) return ["anchors must be an object"];
  if (!Array.isArray(r.order)) return ["order must be an array"];

  const errors: string[] = [];
  const topIds = new Set<string>();
  for (const d of r.drawables as Drawable[]) {
    if (typeof d?.id !== "string" || d.id === "") {
      errors.push("every drawable needs a non-empty string id");
      continue;
    }
    if (topIds.has(d.id)) errors.push(`duplicate drawable id "${d.id}"`);
    topIds.add(d.id);
  }
  for (const d of flattenDrawables((r.drawables as Drawable[]).filter((d) => d && typeof d === "object"))) {
    if (d.kind === "stroke" || d.kind === "area") {
      if (!Array.isArray(d.pts) || !d.pts.every(finitePt)) {
        errors.push(`drawable "${d.id}": pts must be finite [x, y] pairs within ±${COORD_BOUND} (bounds/finite check)`);
      }
    } else if (d.kind === "text") {
      if (!finitePt(d.pos)) errors.push(`text "${d.id}": pos must be a finite point (bounds/finite check)`);
      if (typeof d.text !== "string") errors.push(`text "${d.id}": text must be a string`);
    } else if (d.kind === "group") {
      if (!Array.isArray(d.children)) errors.push(`group "${d.id}": children must be an array`);
    } else {
      errors.push(`drawable "${(d as Drawable).id}": unknown kind "${(d as Drawable).kind}"`);
    }
  }

  const labelIds = new Set<string>();
  for (const l of r.labels as { id?: unknown; anchor?: unknown; side?: unknown; text?: unknown }[]) {
    if (typeof l?.id !== "string" || l.id === "") {
      errors.push("every label needs a non-empty string id");
      continue;
    }
    labelIds.add(l.id);
    if (!finitePt(l.anchor)) errors.push(`label "${l.id}": anchor must be a finite point (bounds/finite check)`);
    if (typeof l.side !== "string" || !SIDES.has(l.side)) errors.push(`label "${l.id}": invalid side "${String(l.side)}"`);
    if (typeof l.text !== "string") errors.push(`label "${l.id}": text must be a string`);
  }

  for (const [id, p] of Object.entries(r.anchors as Record<string, unknown>)) {
    if (!finitePt(p)) errors.push(`anchor "${id}" must be a finite point (bounds/finite check)`);
  }

  for (const id of r.order as unknown[]) {
    if (typeof id !== "string" || (!topIds.has(id) && !labelIds.has(id))) {
      errors.push(`order names "${String(id)}" which is neither a drawable nor a label id (order check)`);
    }
  }
  return errors;
}
```

- [ ] **Step 5: Run to verify pass**

Run: `npx vitest run tests/template-compile.test.ts`
Expected: PASS. (The NaN test's message contains "finite"; the runaway test's contains "bounds"; the order test's contains "order" — the parenthetical tags in the messages guarantee the regex matches.)

- [ ] **Step 6: Gate and commit**

```bash
npx tsc && npx vitest run
git add src/scenes/compile.ts src/scenes/types.ts src/scenes/registry.ts tests/template-compile.test.ts
git commit -m "feat: template compile + output guard (new Function runtime)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Registry integration (`registerTemplateDoc`)

**Files:**
- Modify: `src/scenes/registry.ts`
- Test: extend `tests/template-doc.test.ts` (registry section appended)

**Interfaces:**
- Consumes: `parseTemplateDoc`, `TemplateDoc`, `docToManifest` from `./doc`; `compileTemplateDoc` from `./compile`.
- Produces:
  - `export function registerTemplateDoc(doc: TemplateDoc): { ok: boolean; errors: string[] }` — on success inserts a ready `SceneModule` into `scenes[doc.template]`; on compile failure inserts a STUB manifest (spec §8: degrade to stub, warning names the problem) and returns the errors.
  - `export function registerTemplateYaml(yamlText: string): { ok: boolean; errors: string[] }` — parse + register in one call (startup and, later, packs/authoring use this).

- [ ] **Step 1: Write the failing tests (append to `tests/template-doc.test.ts`)**

```ts
import { registerTemplateDoc, registerTemplateYaml, scenes } from "../src/scenes/registry";

describe("registerTemplateDoc", () => {
  test("registers a ready doc as a working scene", () => {
    const r = registerTemplateYaml(GOOD);
    expect(r.ok).toBe(true);
    expect(scenes.demo_ring.layout).toBeDefined();
    const layout = scenes.demo_ring.layout!({ n: 5 });
    expect(layout.drawables[0].id).toBe("ring");
    delete scenes.demo_ring; // keep the registry clean for other tests
  });

  test("a doc that fails to compile registers as a stub", () => {
    const doc = parseTemplateDoc(GOOD).doc!;
    const broken = { ...doc, template: "demo_broken", layout: "return {{{" };
    const r = registerTemplateDoc(broken);
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatch(/compile/);
    expect(scenes.demo_broken.manifest.status).toBe("stub");
    expect(scenes.demo_broken.layout).toBeUndefined();
    delete scenes.demo_broken;
  });

  test("invalid yaml never registers", () => {
    const r = registerTemplateYaml("template: [nope");
    expect(r.ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/template-doc.test.ts`
Expected: FAIL — `registerTemplateDoc` is not exported.

- [ ] **Step 3: Implement in `src/scenes/registry.ts`**

Append (imports at top of file):

```ts
import { parseTemplateDoc, docToManifest, type TemplateDoc } from "./doc";
import { compileTemplateDoc } from "./compile";
```

```ts
/**
 * Register a template document (spec §1). Ready docs compile to a working
 * scene; a doc whose body fails to compile degrades to a STUB manifest so
 * the catalog still knows it exists (spec §8) — the errors name the problem.
 */
export function registerTemplateDoc(doc: TemplateDoc): { ok: boolean; errors: string[] } {
  const { module, errors } = compileTemplateDoc(doc);
  if (module) {
    scenes[doc.template] = module;
    return { ok: true, errors: [] };
  }
  scenes[doc.template] = { manifest: { ...docToManifest(doc), status: "stub" } };
  return { ok: false, errors };
}

/** Parse + register in one call — startup, packs (M3), and authoring (M2) use this. */
export function registerTemplateYaml(yamlText: string): { ok: boolean; errors: string[] } {
  const { doc, errors } = parseTemplateDoc(yamlText);
  if (!doc) return { ok: false, errors };
  return registerTemplateDoc(doc);
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/template-doc.test.ts`
Expected: PASS.

- [ ] **Step 5: Gate and commit**

```bash
npx tsc && npx vitest run
git add src/scenes/registry.ts tests/template-doc.test.ts
git commit -m "feat: registerTemplateDoc/registerTemplateYaml — doc templates join the registry

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Port `cell_diagram` to the document format

**Files:**
- Create: `src/scenes/cell_diagram/template.yaml`
- Delete: `src/scenes/cell_diagram/layout.ts`, `src/scenes/cell_diagram/manifest.json`
- Modify: `src/scenes/registry.ts` (remove TS entry + imports; load the YAML)
- Modify: `tests/domain-scenes.test.ts` (access via registry)
- Modify: `docs/superpowers/specs/2026-08-22-templates-design.md` §1 (port-target sentence)

**Interfaces:**
- Consumes: `registerTemplateYaml` (Task 4); vite `?raw` import (typed by `vite/client` in tsconfig).
- Produces: `scenes.cell_diagram` is a doc-template with identical element ids and behavior to the TS version (`membrane`, `membrane_inner`, `cytoplasm`, `nucleus`, `nucleus_fill`, `nucleolus`, `mito`, `cristae`, `er`, `golgi`, `ribosomes`, labels `label_membrane`, `label_nucleus`, `label_mito`, `label_er`, `label_golgi`, `label_ribo`; params `organelles?: string[]`, `labels?: boolean`).

- [ ] **Step 1: Adjust `tests/domain-scenes.test.ts` to consume the registry (failing against the TS version is fine — this is a refactor-safety net)**

Replace the direct import and the `layoutCellDiagram` describe block:

```ts
// DELETE this import line:
// import { layoutCellDiagram } from "../src/scenes/cell_diagram/layout";

// REPLACE the layoutCellDiagram describe block with:
describe("cell_diagram (doc template)", () => {
  const layout = (params: Record<string, unknown>) => scenes.cell_diagram.layout!(params);

  test("organelle subset draws only what is asked", () => {
    const r = layout({ organelles: ["nucleus"] });
    const ids = flattenDrawables(r.drawables).map((d) => d.id);
    expect(ids).toContain("nucleus");
    expect(ids).not.toContain("mito");
    expect(ids).not.toContain("golgi");
  });

  test("labels: false suppresses name labels", () => {
    const r = layout({ labels: false });
    expect(r.labels).toHaveLength(0);
  });

  test("cell_diagram is registered from a template doc (no TS layout module)", () => {
    expect(scenes.cell_diagram.manifest.status).toBe("ready");
    expect(scenes.cell_diagram.layout).toBeDefined();
  });
});
```

Run: `npx vitest run tests/domain-scenes.test.ts` — Expected: PASS (still the TS version; the registry API is the same either way). This proves the test is implementation-agnostic BEFORE the swap.

- [ ] **Step 2: Write `src/scenes/cell_diagram/template.yaml`**

```yaml
template: cell_diagram
title: Cell cross-section
version: 2
kit: 1
status: ready
description: >-
  An animal-cell cross-section: membrane (double line) around cytoplasm, with a
  selectable set of organelles — nucleus (with nucleolus), mitochondrion (with
  cristae), endoplasmic reticulum, Golgi apparatus, ribosomes — each labeled
  with collision-solved leader labels. Choose this scene for requests about
  cell structure, organelles, 'draw a cell', or explaining what a specific
  organelle does (include just the relevant organelles and glow/point at them
  while narrating).
params:
  type: object
  properties:
    organelles:
      type: array
      items:
        type: string
        enum: [nucleus, mitochondria, er, golgi, ribosomes]
      description: "Which organelles to draw. Default: all. For a focused explanation, include only what the narration needs."
    labels:
      type: boolean
      description: "Show organelle name labels (default true). Set false if the narration will name things instead."
element_ids:
  membrane / membrane_inner: the double membrane outline
  cytoplasm: the pale interior fill
  nucleus / nucleus_fill / nucleolus: the nucleus and its nucleolus
  mito / cristae: the mitochondrion outline and its inner folds
  er: endoplasmic reticulum arcs
  golgi: Golgi stacked arcs
  ribosomes: the ribosome dots (one group)
  label_membrane / label_nucleus / label_mito / label_er / label_golgi / label_ribo: the name labels
examples:
  - request: "Draw an animal cell with its organelles."
    params: {}
  - request: "Explain what mitochondria do."
    params:
      organelles: [nucleus, mitochondria]
      labels: true
layout: |
  const on = new Set(params.organelles ?? ["nucleus", "mitochondria", "er", "golgi", "ribosomes"]);
  const showLabels = params.labels !== false;
  const C = kit.COLORS, MS = kit.SKETCH_MS;
  const drawables = [], labels = [], anchors = {}, order = [];
  const push = (d) => { drawables.push(d); order.push(d.id); };
  const label = (id, anchor, side, text, color, fontSize) => {
    if (!showLabels) return;
    labels.push(kit.label(id, anchor, side, text, { color, fontSize }));
    order.push(id);
  };
  const cx = 470, cy = 380;

  const outer = kit.blob([cx, cy], 375, 285, 0.05, 1);
  push(kit.area("cytoplasm", outer, C.region1, { opacity: 0.12 }));
  push(kit.stroke("membrane", outer, { closed: true, strokeWidth: 4.5, ms: MS.curve }));
  push(kit.stroke("membrane_inner", kit.blob([cx, cy], 358, 268, 0.05, 1), { closed: true, strokeWidth: 2.5, ms: MS.curve }));
  anchors.membrane = [cx - 190, cy + 245];
  label("label_membrane", [cx - 190, cy + 245], "above-left", "Cell membrane");

  if (on.has("nucleus")) {
    const nc = [590, 420];
    push(kit.area("nucleus_fill", kit.blob(nc, 100, 92, 0.03, 2), C.accent, { opacity: 0.15 }));
    push(kit.stroke("nucleus", kit.blob(nc, 100, 92, 0.03, 2), { closed: true, color: C.accent, strokeWidth: 4, ms: MS.node }));
    push(kit.area("nucleolus", kit.blob([nc[0] + 22, nc[1] - 12], 26, 24, 0.06, 3), C.accent, { opacity: 0.5, ms: MS.dot }));
    anchors.nucleus = nc;
    label("label_nucleus", nc, "right", "Nucleus", C.accent);
  }

  if (on.has("mitochondria")) {
    const mc = [300, 470];
    push(kit.stroke("mito", kit.blob(mc, 88, 44, 0.04, 4), { closed: true, color: C.demand, strokeWidth: 3.5, ms: MS.node }));
    const cristae = [];
    for (let k = 0; k < 4; k++) {
      const bx = mc[0] - 48 + k * 30;
      const pts = [];
      for (let t = 0; t <= 1; t += 0.12) {
        const yr = 30 * (1 - Math.abs(k - 1.5) * 0.18);
        pts.push([bx + 7 * Math.sin(t * Math.PI * 2 + k), mc[1] - yr + 2 * yr * t]);
      }
      cristae.push(kit.stroke("crista_" + k, pts, { color: C.demand, strokeWidth: 2.5, ms: MS.guides }));
    }
    push(kit.group("cristae", cristae));
    anchors.mito = mc;
    label("label_mito", [mc[0], mc[1] - 44], "below", "Mitochondrion", C.demand);
  }

  if (on.has("er")) {
    const er = [];
    for (let k = 0; k < 3; k++) {
      er.push(kit.stroke("er_" + k, kit.arc([590, 420], 130 + k * 22, Math.PI * 0.75, Math.PI * 1.35), { color: C.supply, strokeWidth: 3, ms: MS.guides }));
    }
    push(kit.group("er", er));
    anchors.er = [428, 300];
    label("label_er", [428, 292], "above-left", "Endoplasmic reticulum", C.supply, 24);
  }

  if (on.has("golgi")) {
    const gg = [];
    for (let k = 0; k < 4; k++) {
      gg.push(kit.stroke("golgi_" + k, kit.arc([320, 300 - k * 20], 80 * (1 - k * 0.16), Math.PI * 0.15, Math.PI * 0.85), { color: C.shifted, strokeWidth: 3.5, ms: MS.guides }));
    }
    push(kit.group("golgi", gg));
    anchors.golgi = [320, 320];
    label("label_golgi", [320, 350], "above", "Golgi apparatus", C.shifted, 24);
  }

  if (on.has("ribosomes")) {
    const dots = [], spots = [];
    for (let k = 0; k < 14; k++) {
      const th = kit.jitter(k) * Math.PI * 2;
      const rr = 0.45 + 0.5 * Math.abs(kit.jitter(k + 40));
      const p = [cx + 340 * rr * Math.cos(th), cy + 250 * rr * Math.sin(th)];
      if (Math.hypot(p[0] - 590, p[1] - 420) < 130) continue;
      if (Math.hypot(p[0] - 300, p[1] - 470) < 110) continue;
      spots.push(p);
      dots.push(kit.stroke("ribo_" + k, [p], { shapeHint: { type: "circle", c: p, r: 5 }, fill: C.ink, strokeWidth: 2.5, ms: MS.dot }));
    }
    push(kit.group("ribosomes", dots));
    anchors.ribosomes = spots[0] ?? [cx, cy];
    label("label_ribo", spots[0] ?? [cx, cy], "above-right", "Ribosomes", C.ink, 24);
  }

  return { drawables, labels, anchors, order };
```

- [ ] **Step 3: Swap the registry to the doc**

In `src/scenes/registry.ts`:
- DELETE the imports of `cellDiagramManifest` and `layoutCellDiagram`/`CellDiagramParams`, and the `cell_diagram:` entry in the `scenes` object.
- ADD at the top: `import cellDiagramYaml from "./cell_diagram/template.yaml?raw";`
- ADD at the bottom of the file (after `registerTemplateYaml` is defined):

```ts
// Bundled document-format templates. A registration failure here is a build
// defect — surface it loudly in dev, and the template degrades to a stub.
{
  const r = registerTemplateYaml(cellDiagramYaml);
  if (!r.ok) console.warn("bundled template failed to register:", r.errors);
}
```

Then delete the old files:

```bash
git rm src/scenes/cell_diagram/layout.ts src/scenes/cell_diagram/manifest.json
```

- [ ] **Step 4: Run the full suite**

Run: `npx vitest run`
Expected: ALL PASS — in particular `tests/domain-scenes.test.ts` (registry-based cell_diagram tests, manifest examples through `layoutSpec` with zero warnings, determinism) now exercises the doc-compiled version. If `?raw` fails to resolve under vitest, add `assetsInclude: ["**/*.yaml"]` is NOT needed — `?raw` bypasses asset handling; if TypeScript complains about the module, `vite/client` types are already in tsconfig (`"types": ["vite/client"]`) — check for a typo there rather than adding a custom d.ts.

- [ ] **Step 5: Amend the spec's port-target sentence**

In `docs/superpowers/specs/2026-08-22-templates-design.md` §1, replace:

> but ONE of them (decision_tree or supply_demand) gets a document-format port early as the validation case and the canonical few-shot exemplar.

with:

> ONE built-in gets a document-format port early as the validation case and the canonical few-shot exemplar — `cell_diagram` (chosen over decision_tree/supply_demand once the 2026-08-22 domain scenes existed: it exercises exactly the kit helpers M1 ships — blob, arc, jitter, factories — and needs no imports a function body couldn't have).

- [ ] **Step 6: Gate and commit**

```bash
npx tsc && npx vitest run
git add -A src/scenes tests/domain-scenes.test.ts docs/superpowers/specs/2026-08-22-templates-design.md
git commit -m "feat: cell_diagram ported to template.yaml — first doc-format template in production

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Final verification + push

**Files:** none new.

- [ ] **Step 1: Full gate from a clean state**

```bash
npx tsc && npx vitest run && npm run build
```

Expected: typecheck clean, all tests pass, vite build succeeds (this catches `?raw` handling in the production bundle, not just under vitest).

- [ ] **Step 2: Behavioral smoke through the real pipeline**

```bash
npx vitest run tests/domain-scenes.test.ts tests/template-doc.test.ts tests/template-compile.test.ts tests/scene-kit.test.ts
```

Expected: PASS — the four M1 surfaces plus the ported template through `layoutSpec`.

- [ ] **Step 3: Push**

```bash
git push
```

Expected: CI deploys to GitHub Pages; cell_diagram behaves identically in the live app (Hans's manual smoke: "Draw an animal cell" should render exactly as before the port).

---

## Self-Review Notes

- **Spec coverage:** §1 format → Tasks 2+5; §2 runtime/guard → Task 3; §3 kit → Task 1; §8 error table rows exercised: compile failure → stub (Task 4 test), invalid output → throw → layoutSpec fall-through (Task 3 test + existing layoutSpec behavior). §3a/4/5/5a/6/7 are M2+ by design — out of M1 scope per the milestone table.
- **Type consistency:** `SceneModule` moves to `types.ts` in Task 3 Step 1 and is re-exported from `registry.ts`; `registerTemplateYaml` (Task 4) is what Task 5's registry bootstrap calls; kit member names in Task 5's YAML body all exist in Task 1's `SceneKit` interface.
- **Known intentional deltas:** doc `version: 2` for cell_diagram (the port is its second version); TS-era `Organelle`/`CellDiagramParams` types disappear with the TS module (no importers outside the deleted files and the tests updated in Task 5 Step 1).
