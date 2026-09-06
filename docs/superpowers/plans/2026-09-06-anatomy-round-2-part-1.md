# Anatomy Round 2, Part 1 — The Body From One Dataset: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the anatomy atlas's hand-drawn organs and drawn skeleton with silhouettes projected from BodyParts3D meshes — one body, every part registered — and make the template draw it rounder: smoothed rings, a skin wash as the default ground, a `layer` that peels the gut away, a fixed detail slider, and five new examples.

**Architecture:** A build-time pipeline (`scripts/anatomy/*.mjs` + `scripts/build-anatomy-atlas.mjs`) downloads binary STL files from the BodyParts3D GitHub mirror into a gitignored cache, projects each part onto the frontal plane, rasterises the projected triangles into a mask and contours the mask with `d3-contour`, so unions and holes come for free. The atlas JSON keeps its round-1 shape plus three fields (`layer`, `behind`, `source`) and moves into a CC BY-SA directory. The template (`src/scenes/packs/anatomy.yaml`) gains `outline` and `layer`, closed Catmull-Rom smoothing and a softer pen. The interactive tray gets one flag.

**Tech Stack:** TypeScript, Vitest, Vite. Build-time devDependencies: `polygon-clipping` (already present, now unused by the atlas and removed), `d3-contour@4.0.2` (ISC). Network at build time only (raw.githubusercontent.com). No new runtime dependencies. Chrome/QuickLook for previews as in round 1.

**Spec:** `docs/superpowers/specs/2026-09-06-anatomy-round-2-design.md` (Part 1). Round-1 spec for everything unchanged: `docs/superpowers/specs/2026-09-05-anatomy-design.md`.

## Global Constraints

- **Source:** BodyParts3D 3.0 via `https://raw.githubusercontent.com/Kevin-Mattheus-Moerman/BodyParts3D/main/assets/BodyParts3D_data/` — `stl/<ID>.stl` (binary STL), `parts_list_e.txt`, `composite_parts.txt`. Licence **CC BY-SA 2.1 Japan**; attribution line: `BodyParts3D, © The Database Center for Life Science licensed under CC Attribution-Share Alike 2.1 Japan`.
- **Axes (measured 2026-09-06):** patient's left is **+x**, anterior is **−y**, up is **+z**, millimetres. Frontal projection: `X = x`, `Y_down = z_top − z`. Draw order (depth) = mean **−y** ascending (posterior parts first).
- **Atlas space** stays `[1000, 2000]`, y-down. The skin's top lands at y = 40 and its bottom at y = 1960; the skin's x-midline lands at x = 500. Ring format `{ outer, holes? }` unchanged.
- **Licence layout:** derived data lives in `src/scenes/anatomy/atlas/` (the three JSON files, `LICENSE`, `ATTRIBUTION.md`). Code stays MIT. The attribution line appears in the pack description, the atlas README and `ATTRIBUTION.md`. Downloads go to `.cache/bodyparts3d/`, **gitignored**, never committed.
- **Only leaf element files exist in the mirror.** Composites (heart, brain, skull, rib cage, vertebra sets, sternum, lungs, intestines, hand/foot bone sets) are expanded through `composite_parts.txt`. Sided hand and foot bones come from laterality-neutral composites filtered by element name (`right …` / `left …`, and `finger|thumb` vs `toe` for phalanges). A missing file (HTTP 404) is skipped with a log line; a part with NO geometry fails the build unless it is marked `optional`.
- **The one authored part:** `uterus` (BodyParts3D 3.0 is one adult male). It carries `source: "authored"`; every other part carries `source: "bodyparts3d"`.
- **Coccyx** is not in the dataset and is dropped from the atlas. `scapula` becomes `scapula_left` / `scapula_right`. Everything else keeps its round-1 id.
- **Detail is a level, not a superset; ids are part ids; a pack layout sees `params`, `kit`, `engines` only; `detail` is an integer never animated** — round-1 rules, unchanged.
- **kit version:** `KIT_VERSION` becomes 8 (`kit.smoothClosed`, `roughness` on stroke/area opts). `src/scenes/doc.ts:62` rejects templates written for a newer kit than the app, so bump the constant BEFORE the template declares `kit: 8`.
- **Every bundled example is lint-clean** (zero issues), draws only ids present at its own detail/focus, passes `lintCommands` and its params schema, and declares `"packs": ["anatomy"]`.
- **Point budgets are re-measured after the first build**, then pinned in the tests at the measured number plus ~30 %.
- Run `npx vitest run` and `npx tsc --noEmit` before every commit. Work in the `anatomy-2` worktree; never `git add -A`.

---

## File Structure

**Created:**

| path | responsibility |
|---|---|
| `scripts/anatomy/stl.mjs` (+ `.d.mts`) | binary STL → Float32Array positions |
| `scripts/anatomy/raster.mjs` (+ `.d.mts`) | a coverage mask over the atlas space: fill projected triangles, contour with d3-contour into `{outer, holes}` rings |
| `scripts/anatomy/bp3d.mjs` (+ `.d.mts`) | the BodyParts3D catalogue: parse `parts_list_e.txt` / `composite_parts.txt`, expand composites with side filters, fetch STL files into the cache |
| `assets/anatomy-sources/bodyparts.mjs` | the part table: every atlas part with its FMA ids, names, kind, parent, detail, colour, layer, behind |
| `src/scenes/anatomy/atlas/LICENSE`, `ATTRIBUTION.md` | the CC BY-SA terms and the DBCLS line |
| `src/scenes/anatomy/atlas/atlas-body.json`, `atlas-skeleton.json`, `atlas-viscera.json` | the generated atlas (moved here from `src/scenes/anatomy/`) |
| `tests/anatomy-stl.test.ts`, `tests/anatomy-raster.test.ts`, `tests/anatomy-bp3d.test.ts` | the three build modules |
| `tests/tray-reveal.test.ts` | the player-level contract the tray fix relies on |

**Modified:**

| path | change |
|---|---|
| `scripts/build-anatomy-atlas.mjs` | rewritten around the mesh pipeline; hulls, joints, preview and writers kept |
| `assets/anatomy-sources/PROVENANCE.md` | BodyParts3D entry; the LadyofHats entry marked reserve |
| `assets/anatomy-sources/viscera.mjs`, `skeleton-map.mjs`, `joints.mjs` | `viscera.mjs` shrinks to the uterus; `skeleton-map.mjs` is replaced by the part table (kept as `skeleton-map.reserve.mjs` beside the reserve SVG); `joints.mjs` unchanged |
| `.gitignore` | `.cache/` |
| `package.json` | `d3-contour` in devDependencies; `polygon-clipping` removed |
| `src/scenes/anatomy/types.ts` | `layer`, `behind`, `source` on `AtlasPart` |
| `src/scenes/engines.ts` | JSON imports point at `./anatomy/atlas/` |
| `src/scenes/kit.ts` | `smoothClosed`, `roughness` option, `KIT_VERSION = 8` |
| `src/scenes/packs/anatomy.yaml` | `outline`, `layer`, smoothing, roughness, dashed `behind`, `kit: 8`, attribution in the pack description |
| `src/scenes/packs.ts` | pack description carries the attribution |
| `src/ui/tray.ts:154` | `previewParams(overrides, { revealNew: true })` |
| `src/examples.json` | five new anatomy examples |
| `src/scenes/anatomy/README.md`, `ROADMAP.md` | the new pipeline; coccyx and the second body as roadmap items |
| `tests/anatomy-atlas.test.ts`, `tests/anatomy-template.test.ts`, `tests/anatomy-geom.test.ts` | new fields and behaviours; re-measured budgets |

---

## Task 1: STL parsing and the coverage mask

Two pure build modules with tests. Nothing here touches the network or the app.

**Files:**
- Create: `scripts/anatomy/stl.mjs`, `scripts/anatomy/stl.d.mts`, `scripts/anatomy/raster.mjs`, `scripts/anatomy/raster.d.mts`
- Test: `tests/anatomy-stl.test.ts`, `tests/anatomy-raster.test.ts`
- Modify: `package.json` (devDependency `d3-contour@4.0.2`)

**Interfaces:**
- Produces: `parseStl(buf: Uint8Array | Buffer) → { positions: Float32Array, triangles: number }` (positions is 9 floats per triangle: x0 y0 z0 x1 y1 z1 x2 y2 z2); `bboxOf(positions) → { min: [x,y,z], max: [x,y,z] }`; `class Mask { constructor(width, height, cell, origin=[0,0]); fillTriangle(a, b, c); covered(): number; rings(): {outer: number[][], holes: number[][][]}[] }` — all coordinates in atlas units; `rings()` returns polygons in atlas units.

- [ ] **Step 1: Add the contouring dependency**

Run: `npm install --save-dev d3-contour@4.0.2`
Expected: `package.json` devDependencies gain `"d3-contour": "^4.0.2"`. Leave `polygon-clipping` for now; Task 3 removes it when the union code goes.

- [ ] **Step 2: Write the failing STL test**

Create `tests/anatomy-stl.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { parseStl, bboxOf } from "../scripts/anatomy/stl.mjs";

/** A binary STL with two triangles: a unit right triangle in z=0 and one lifted to z=5. */
function tinyStl(): Uint8Array {
  const tris = [
    [[0, 0, 0], [1, 0, 0], [0, 1, 0]],
    [[0, 0, 5], [2, 0, 5], [0, 3, 5]],
  ];
  const buf = new ArrayBuffer(84 + 50 * tris.length);
  const dv = new DataView(buf);
  dv.setUint32(80, tris.length, true);
  tris.forEach((t, i) => {
    const o = 84 + 50 * i + 12; // skip the normal
    t.forEach((p, k) => p.forEach((v, j) => dv.setFloat32(o + 12 * k + 4 * j, v, true)));
  });
  return new Uint8Array(buf);
}

describe("parseStl", () => {
  test("reads the triangle count and every vertex, little-endian, skipping normals and attribute bytes", () => {
    const { positions, triangles } = parseStl(tinyStl());
    expect(triangles).toBe(2);
    expect(positions.length).toBe(18);
    expect(Array.from(positions.slice(0, 9))).toEqual([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    expect(positions[9 + 2]).toBe(5);
  });

  test("rejects a buffer whose length does not match its header", () => {
    expect(() => parseStl(tinyStl().slice(0, 100))).toThrow(/length/);
  });

  test("bboxOf spans every vertex", () => {
    const { positions } = parseStl(tinyStl());
    expect(bboxOf(positions)).toEqual({ min: [0, 0, 0], max: [2, 3, 5] });
  });
});
```

- [ ] **Step 3: Write the failing raster test**

Create `tests/anatomy-raster.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { Mask } from "../scripts/anatomy/raster.mjs";
import { ringArea } from "../scripts/anatomy/geom.mjs";

describe("Mask", () => {
  test("a filled square covers its area to within one cell of boundary", () => {
    const m = new Mask(100, 100, 1); // 100 × 100 cells of 1 unit
    m.fillTriangle([10, 10], [60, 10], [60, 60]);
    m.fillTriangle([10, 10], [60, 60], [10, 60]);
    expect(m.covered()).toBeGreaterThan(50 * 50 * 0.95);
    expect(m.covered()).toBeLessThan(50 * 50 * 1.08);
  });

  test("contours a square into one ring of about the right area, in atlas units", () => {
    const m = new Mask(100, 100, 2, [0, 0]); // cell 2 → 200 × 200 atlas units
    m.fillTriangle([20, 20], [120, 20], [120, 120]);
    m.fillTriangle([20, 20], [120, 120], [20, 120]);
    const rings = m.rings();
    expect(rings.length).toBe(1);
    expect(rings[0].holes).toEqual([]);
    expect(ringArea(rings[0].outer)).toBeGreaterThan(100 * 100 * 0.9);
    expect(ringArea(rings[0].outer)).toBeLessThan(100 * 100 * 1.1);
    const xs = rings[0].outer.map((p) => p[0]);
    expect(Math.min(...xs)).toBeGreaterThan(15);
    expect(Math.max(...xs)).toBeLessThan(125);
  });

  test("a square with a square hole becomes one outer ring with one hole", () => {
    const m = new Mask(100, 100, 1);
    // outer square 10..90 as two triangles, then carve a hole by filling a second mask and subtracting
    m.fillTriangle([10, 10], [90, 10], [90, 90]);
    m.fillTriangle([10, 10], [90, 90], [10, 90]);
    const hole = new Mask(100, 100, 1);
    hole.fillTriangle([40, 40], [60, 40], [60, 60]);
    hole.fillTriangle([40, 40], [60, 60], [40, 60]);
    m.subtract(hole);
    const rings = m.rings();
    expect(rings.length).toBe(1);
    expect(rings[0].holes.length).toBe(1);
    expect(ringArea(rings[0].holes[0])).toBeGreaterThan(20 * 20 * 0.8);
  });

  test("two separate squares become two rings", () => {
    const m = new Mask(100, 100, 1);
    m.fillTriangle([5, 5], [25, 5], [25, 25]); m.fillTriangle([5, 5], [25, 25], [5, 25]);
    m.fillTriangle([60, 60], [90, 60], [90, 90]); m.fillTriangle([60, 60], [90, 90], [60, 90]);
    expect(m.rings().length).toBe(2);
  });

  test("the origin offsets atlas coordinates", () => {
    const m = new Mask(50, 50, 1, [1000, 2000]);
    m.fillTriangle([1010, 2010], [1030, 2010], [1030, 2030]);
    m.fillTriangle([1010, 2010], [1030, 2030], [1010, 2030]);
    const xs = m.rings()[0].outer.map((p) => p[0]);
    expect(Math.min(...xs)).toBeGreaterThan(1005);
  });
});
```

- [ ] **Step 4: Run both to verify they fail**

Run: `npx vitest run tests/anatomy-stl.test.ts tests/anatomy-raster.test.ts`
Expected: FAIL — cannot resolve the two modules.

- [ ] **Step 5: Write `scripts/anatomy/stl.mjs`**

```js
// Binary STL: an 80-byte header, a uint32 triangle count, then 50 bytes per
// triangle — a float32 normal (ignored), three float32 vertices, a uint16
// attribute (ignored). Little-endian throughout. BodyParts3D's mirror ships
// exactly this; ASCII STL is not handled and is rejected by the length check.

export function parseStl(buf) {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  if (bytes.length < 84) throw new Error(`STL too short: ${bytes.length} bytes`);
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const triangles = dv.getUint32(80, true);
  const expected = 84 + 50 * triangles;
  if (bytes.length !== expected) throw new Error(`STL length ${bytes.length} does not match header (${triangles} triangles → ${expected} bytes)`);
  const positions = new Float32Array(triangles * 9);
  for (let i = 0; i < triangles; i++) {
    const o = 84 + 50 * i + 12;
    for (let k = 0; k < 9; k++) positions[i * 9 + k] = dv.getFloat32(o + 4 * k, true);
  }
  return { positions, triangles };
}

/** Axis-aligned bounds of a positions array (9 floats per triangle). */
export function bboxOf(positions) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) {
    for (let a = 0; a < 3; a++) {
      const v = positions[i + a];
      if (v < min[a]) min[a] = v;
      if (v > max[a]) max[a] = v;
    }
  }
  return { min, max };
}
```

Create `scripts/anatomy/stl.d.mts`:

```ts
export function parseStl(buf: Uint8Array | ArrayBuffer): { positions: Float32Array; triangles: number };
export function bboxOf(positions: Float32Array | number[]): { min: number[]; max: number[] };
```

- [ ] **Step 6: Write `scripts/anatomy/raster.mjs`**

```js
// A coverage mask over a rectangle of the atlas space. Projected triangles are
// scan-filled into it; d3-contour then traces the 0.5 isoline, which gives the
// union of everything filled as polygons WITH holes — the orbits of a skull,
// the gap between an arm and the torso — for free, at whatever resolution the
// cell size sets. This replaces polygon union: 79 MB of skin and 117 gyri are
// no trouble for a bitmap.

import { contours } from "d3-contour";

export class Mask {
  /** width/height in cells; cell = atlas units per cell; origin = atlas coords of cell (0,0). */
  constructor(width, height, cell, origin = [0, 0]) {
    this.width = width;
    this.height = height;
    this.cell = cell;
    this.origin = origin;
    this.data = new Uint8Array(width * height);
  }

  toCell(p) {
    return [(p[0] - this.origin[0]) / this.cell, (p[1] - this.origin[1]) / this.cell];
  }

  /** Scan-fill one triangle given in atlas units. Cells whose centre is inside are set. */
  fillTriangle(a, b, c) {
    const [ax, ay] = this.toCell(a), [bx, by] = this.toCell(b), [cx, cy] = this.toCell(c);
    const y0 = Math.max(0, Math.floor(Math.min(ay, by, cy)));
    const y1 = Math.min(this.height - 1, Math.ceil(Math.max(ay, by, cy)));
    const area = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay);
    if (Math.abs(area) < 1e-12) return; // degenerate
    for (let row = y0; row <= y1; row++) {
      const py = row + 0.5;
      // x-extent of the triangle on this scanline, via edge intersections
      let xl = Infinity, xr = -Infinity;
      const edge = (px0, py0, px1, py1) => {
        if ((py0 <= py && py1 > py) || (py1 <= py && py0 > py)) {
          const t = (py - py0) / (py1 - py0);
          const x = px0 + t * (px1 - px0);
          if (x < xl) xl = x;
          if (x > xr) xr = x;
        }
      };
      edge(ax, ay, bx, by); edge(bx, by, cx, cy); edge(cx, cy, ax, ay);
      if (xl > xr) continue;
      const c0 = Math.max(0, Math.ceil(xl - 0.5));
      const c1 = Math.min(this.width - 1, Math.floor(xr - 0.5));
      for (let col = c0; col <= c1; col++) this.data[row * this.width + col] = 1;
    }
  }

  /** Clear every cell set in `other` (same geometry required). */
  subtract(other) {
    for (let i = 0; i < this.data.length; i++) if (other.data[i]) this.data[i] = 0;
  }

  /** Number of set cells. */
  covered() {
    let n = 0;
    for (let i = 0; i < this.data.length; i++) n += this.data[i];
    return n;
  }

  /** Polygons of the covered region, in atlas units: [{ outer, holes }]. */
  rings() {
    const gen = contours().size([this.width, this.height]).thresholds([0.5]).smooth(true);
    const [multi] = gen(this.data);
    const toAtlas = (ring) => {
      // d3-contour closes rings by repeating the first point; drop it.
      const pts = ring.slice(0, -1).map(([cx, cy]) => [this.origin[0] + cx * this.cell, this.origin[1] + cy * this.cell]);
      return pts;
    };
    const out = [];
    for (const poly of multi.coordinates) {
      const outer = toAtlas(poly[0]);
      if (outer.length < 3) continue;
      out.push({ outer, holes: poly.slice(1).map(toAtlas).filter((h) => h.length >= 3) });
    }
    return out;
  }
}
```

Create `scripts/anatomy/raster.d.mts`:

```ts
export class Mask {
  width: number; height: number; cell: number; origin: number[]; data: Uint8Array;
  constructor(width: number, height: number, cell: number, origin?: number[]);
  toCell(p: number[]): number[];
  fillTriangle(a: number[], b: number[], c: number[]): void;
  subtract(other: Mask): void;
  covered(): number;
  rings(): { outer: number[][]; holes: number[][][] }[];
}
```

- [ ] **Step 7: Run to verify they pass**

Run: `npx vitest run tests/anatomy-stl.test.ts tests/anatomy-raster.test.ts && npx tsc --noEmit`
Expected: PASS, clean. If the hole test yields two rings instead of one-with-hole, d3-contour has returned the hole as its own polygon: check the winding — d3-contour puts holes in `poly.slice(1)` of the enclosing polygon, so this means the outer and the hole were not nested in the mask; re-check `subtract`.

- [ ] **Step 8: Commit**

```bash
git add scripts/anatomy/stl.mjs scripts/anatomy/stl.d.mts scripts/anatomy/raster.mjs scripts/anatomy/raster.d.mts tests/anatomy-stl.test.ts tests/anatomy-raster.test.ts package.json package-lock.json
git commit -m "Atlas build: binary STL parsing and a coverage mask contoured by d3-contour"
```

---

## Task 2: The BodyParts3D catalogue, the fetcher and the part table

**Files:**
- Create: `scripts/anatomy/bp3d.mjs`, `scripts/anatomy/bp3d.d.mts`, `assets/anatomy-sources/bodyparts.mjs`
- Modify: `.gitignore` (`.cache/`)
- Test: `tests/anatomy-bp3d.test.ts`

**Interfaces:**
- Produces: `parseCatalogue(partsText, compositeText) → Catalogue` with `names: Map<id, name>` and `composites: Map<id, {id, name}[]>`; `elementsFor(cat, spec) → string[]` where `spec = { fma?: string[], composite?: string, side?: "right" | "left", filter?: RegExp, exclude?: string[] }`; `fetchStl(id, {cacheDir, mirror, fetchImpl?}) → Promise<Uint8Array | null>` (null on 404); `MIRROR` constant.
- The part table exports `MIRROR_FILES`, `BONES`, `REGIONS`, `GROUPS`, `VISCERA`, `VISCERA_GROUPS`, `SKIN`, `AUTHORED`.

- [ ] **Step 1: Write the failing test**

Create `tests/anatomy-bp3d.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { mkdtempSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseCatalogue, elementsFor, fetchStl } from "../scripts/anatomy/bp3d.mjs";

const parts = `"id"\ten
FMA7197\tliver
FMA71335\tset of carpal bones
FMA24435\tright scaphoid
FMA24436\tleft scaphoid
FMA23709\tscaphoid
FMA231315\tset of phalanges
FMA24459\tdistal phalanx of right thumb
FMA32634\tproximal phalanx of right second toe
FMA46565\tskull
FMA52748\tmandible
FMA9999\tleft maxilla
`;
const composites = `composite id\tcomposite name\tprimitive id\tprimitive name
FMA71335\tset of carpal bones\tFMA24435\tright scaphoid
FMA71335\tset of carpal bones\tFMA24436\tleft scaphoid
FMA71335\tset of carpal bones\tFMA23709\tscaphoid
FMA231315\tset of phalanges\tFMA24459\tdistal phalanx of right thumb
FMA231315\tset of phalanges\tFMA32634\tproximal phalanx of right second toe
FMA46565\tskull\tFMA52748\tmandible
FMA46565\tskull\tFMA9999\tleft maxilla
`;

describe("the BodyParts3D catalogue", () => {
  const cat = parseCatalogue(parts, composites);

  test("maps ids to English names and composites to their elements", () => {
    expect(cat.names.get("FMA7197")).toBe("liver");
    expect(cat.composites.get("FMA71335")!.map((e) => e.id)).toEqual(["FMA24435", "FMA24436", "FMA23709"]);
  });

  test("a plain part is its own element list", () => {
    expect(elementsFor(cat, { fma: ["FMA7197"] })).toEqual(["FMA7197"]);
  });

  test("a sided composite keeps only elements named for that side, dropping the laterality-neutral duplicates", () => {
    expect(elementsFor(cat, { composite: "FMA71335", side: "right" })).toEqual(["FMA24435"]);
    expect(elementsFor(cat, { composite: "FMA71335", side: "left" })).toEqual(["FMA24436"]);
  });

  test("a filter separates finger bones from toe bones inside one composite", () => {
    expect(elementsFor(cat, { composite: "FMA231315", side: "right", filter: /finger|thumb/ })).toEqual(["FMA24459"]);
    expect(elementsFor(cat, { composite: "FMA231315", side: "right", filter: /toe/ })).toEqual(["FMA32634"]);
  });

  test("exclude removes an element from a composite", () => {
    expect(elementsFor(cat, { composite: "FMA46565", exclude: ["FMA52748"] })).toEqual(["FMA9999"]);
  });

  test("an unknown composite is an error, not an empty list", () => {
    expect(() => elementsFor(cat, { composite: "FMA0" })).toThrow(/FMA0/);
  });
});

describe("fetchStl", () => {
  test("writes a downloaded file into the cache and serves it from there next time; a 404 is null", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bp3d-"));
    let calls = 0;
    const fetchImpl = async (url: string) => {
      calls++;
      if (url.endsWith("FMA1.stl")) return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
      return new Response("nope", { status: 404 });
    };
    const a = await fetchStl("FMA1", { cacheDir: dir, mirror: "https://x/", fetchImpl });
    expect(Array.from(a!)).toEqual([1, 2, 3]);
    expect(existsSync(join(dir, "FMA1.stl"))).toBe(true);
    const b = await fetchStl("FMA1", { cacheDir: dir, mirror: "https://x/", fetchImpl });
    expect(Array.from(b!)).toEqual([1, 2, 3]);
    expect(calls).toBe(1); // second call came from the cache
    expect(await fetchStl("FMA2", { cacheDir: dir, mirror: "https://x/", fetchImpl })).toBeNull();
    expect(readFileSync(join(dir, "FMA2.missing"), "utf8")).toBe("404"); // the miss is remembered too
    expect(await fetchStl("FMA2", { cacheDir: dir, mirror: "https://x/", fetchImpl })).toBeNull();
    expect(calls).toBe(2);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/anatomy-bp3d.test.ts`
Expected: FAIL — cannot resolve `../scripts/anatomy/bp3d.mjs`.

- [ ] **Step 3: Write `scripts/anatomy/bp3d.mjs`**

```js
// The BodyParts3D catalogue and fetcher. The GitHub mirror holds one binary
// STL per LEAF element (FMA<id>.stl, a few BP<id>.stl); composites — heart,
// brain, skull, rib cage, the sets of hand and foot bones — exist only as rows
// in composite_parts.txt. Hand and foot bone sets are laterality-neutral and
// list "scaphoid", "right scaphoid" and "left scaphoid" alike; a sided part
// keeps only the elements named for its side.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const MIRROR = "https://raw.githubusercontent.com/Kevin-Mattheus-Moerman/BodyParts3D/main/assets/BodyParts3D_data/";

const rows = (text) => text.split(/\r?\n/).slice(1).filter((l) => l.trim() !== "").map((l) => l.split("\t"));

/** parts_list_e.txt + composite_parts.txt → { names, composites }. */
export function parseCatalogue(partsText, compositeText) {
  const names = new Map();
  for (const [id, name] of rows(partsText)) names.set(id, name);
  const composites = new Map();
  for (const [cid, , eid, ename] of rows(compositeText)) {
    if (!composites.has(cid)) composites.set(cid, []);
    composites.get(cid).push({ id: eid, name: ename });
    if (!names.has(eid)) names.set(eid, ename);
  }
  return { names, composites };
}

/** The element ids a part is made of. */
export function elementsFor(cat, spec) {
  let ids;
  if (spec.composite) {
    const els = cat.composites.get(spec.composite);
    if (!els) throw new Error(`composite ${spec.composite} is not in composite_parts.txt`);
    let keep = els;
    if (spec.side) keep = keep.filter((e) => e.name.startsWith(spec.side + " ") || e.name.includes(" " + spec.side + " ") || e.name.endsWith(" " + spec.side) || new RegExp(`\\b${spec.side}\\b`).test(e.name));
    if (spec.filter) keep = keep.filter((e) => spec.filter.test(e.name));
    ids = keep.map((e) => e.id);
  } else {
    ids = [...(spec.fma ?? [])];
  }
  if (spec.exclude) ids = ids.filter((id) => !spec.exclude.includes(id));
  return ids;
}

/** One STL from the cache or the mirror. null when the mirror has no such file
 *  (remembered as <id>.missing so the build never asks twice). */
export async function fetchStl(id, { cacheDir, mirror = MIRROR, fetchImpl = fetch, log = () => {} }) {
  mkdirSync(cacheDir, { recursive: true });
  const file = join(cacheDir, `${id}.stl`);
  const miss = join(cacheDir, `${id}.missing`);
  if (existsSync(file)) return new Uint8Array(readFileSync(file));
  if (existsSync(miss)) return null;
  const url = `${mirror}stl/${id}.stl`;
  const res = await fetchImpl(url, { headers: { "user-agent": "drawcast/1.0 (anatomy atlas build)" } });
  if (res.status === 404) {
    writeFileSync(miss, "404");
    log(`  ${id}: not in the mirror`);
    return null;
  }
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  writeFileSync(file, bytes);
  log(`  ${id}: ${(bytes.length / 1024).toFixed(0)} KB`);
  return bytes;
}

/** parts_list_e.txt and composite_parts.txt, cached like the meshes. */
export async function fetchCatalogue({ cacheDir, mirror = MIRROR, fetchImpl = fetch }) {
  mkdirSync(cacheDir, { recursive: true });
  const get = async (name) => {
    const file = join(cacheDir, name);
    if (existsSync(file)) return readFileSync(file, "utf8");
    const res = await fetchImpl(`${mirror}${name}`, { headers: { "user-agent": "drawcast/1.0 (anatomy atlas build)" } });
    if (!res.ok) throw new Error(`${mirror}${name}: HTTP ${res.status}`);
    const text = await res.text();
    writeFileSync(file, text);
    return text;
  };
  return parseCatalogue(await get("parts_list_e.txt"), await get("composite_parts.txt"));
}
```

Create `scripts/anatomy/bp3d.d.mts`:

```ts
export const MIRROR: string;
export interface Catalogue { names: Map<string, string>; composites: Map<string, { id: string; name: string }[]> }
export interface PartSpec { fma?: string[]; composite?: string; side?: "right" | "left"; filter?: RegExp; exclude?: string[] }
export function parseCatalogue(partsText: string, compositeText: string): Catalogue;
export function elementsFor(cat: Catalogue, spec: PartSpec): string[];
export function fetchStl(id: string, opts: { cacheDir: string; mirror?: string; fetchImpl?: typeof fetch; log?: (s: string) => void }): Promise<Uint8Array | null>;
export function fetchCatalogue(opts: { cacheDir: string; mirror?: string; fetchImpl?: typeof fetch }): Promise<Catalogue>;
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/anatomy-bp3d.test.ts && npx tsc --noEmit`
Expected: PASS, clean.

- [ ] **Step 5: Gitignore the cache**

Append to `.gitignore`:

```
# BodyParts3D downloads for scripts/build-anatomy-atlas.mjs — tens of MB, refetched on demand
.cache/
```

- [ ] **Step 6: Write the part table**

Create `assets/anatomy-sources/bodyparts.mjs`. Ids are round-1 ids except `scapula_left`/`scapula_right` (was one `scapula`), and `coccyx` and `thyroid` are gone (not in BodyParts3D 3.0). Left/right are the BODY's sides, as the dataset names them. `layer` is only meaningful for abdominal organs; `behind` marks parts drawn dashed when the superficial layer covers them.

```js
// Every atlas part and where its geometry comes from in BodyParts3D 3.0.
// `fma` lists leaf element ids; `composite` names a row set in
// composite_parts.txt, narrowed by `side` (element name carries "right"/"left"),
// `filter` (a regex on the element name) and `exclude`. Sided hand and foot
// bones come from the laterality-neutral sets this way.
//
// detail: 1 = the region silhouettes (built as hulls of these bones) and the big
// organs, 2 = named bones, joints and the smaller organs, 3 = the small bones
// and the fine organs. layer: "superficial" parts are lifted away by
// `layer: deep`; behind: drawn dashed under a superficial layer.

export const SKIN = { fma: ["FMA7163"] };

export const BONES = [
  { id: "cranium", composite: "FMA46565", exclude: ["FMA52748"], parent: "skull", detail: 2, name: { en: "Cranium", nb: "Hjerneskalle", la: "Cranium" }, uberon: "UBERON:0003128" },
  { id: "mandible", fma: ["FMA52748"], parent: "skull", detail: 2, name: { en: "Mandible", nb: "Underkjeve", la: "Mandibula" }, uberon: "UBERON:0001684" },
  { id: "cervical_vertebrae", composite: "FMA72063", parent: "spine", detail: 2, name: { en: "Cervical vertebrae", nb: "Halsvirvler", la: "Vertebrae cervicales" } },
  { id: "thoracic_vertebrae", composite: "FMA72064", parent: "spine", detail: 2, name: { en: "Thoracic vertebrae", nb: "Brystvirvler", la: "Vertebrae thoracicae" } },
  { id: "lumbar_vertebrae", composite: "FMA72065", parent: "spine", detail: 2, name: { en: "Lumbar vertebrae", nb: "Lendevirvler", la: "Vertebrae lumbales" } },
  { id: "sacrum", fma: ["FMA16202"], parent: "spine", detail: 2, name: { en: "Sacrum", nb: "Korsbein", la: "Os sacrum" } },
  { id: "ribs", composite: "FMA71331", parent: "rib_cage", detail: 2, name: { en: "Ribs", nb: "Ribbein", la: "Costae" }, uberon: "UBERON:0002228" },
  { id: "sternum", composite: "FMA7485", parent: "rib_cage", detail: 2, name: { en: "Sternum", nb: "Brystbein", la: "Sternum" }, uberon: "UBERON:0000975" },
  { id: "clavicle_left", fma: ["FMA13323"], parent: "shoulder_girdle", detail: 2, name: { en: "Left clavicle", nb: "Venstre kragebein", la: "Clavicula sinistra" } },
  { id: "clavicle_right", fma: ["FMA13322"], parent: "shoulder_girdle", detail: 2, name: { en: "Right clavicle", nb: "Høyre kragebein", la: "Clavicula dextra" } },
  { id: "scapula_left", fma: ["FMA13396"], parent: "shoulder_girdle", detail: 2, name: { en: "Left scapula", nb: "Venstre skulderblad", la: "Scapula sinistra" } },
  { id: "scapula_right", fma: ["FMA13395"], parent: "shoulder_girdle", detail: 2, name: { en: "Right scapula", nb: "Høyre skulderblad", la: "Scapula dextra" } },
  { id: "humerus_left", fma: ["FMA23131"], parent: "upper_arm_left", detail: 2, name: { en: "Left humerus", nb: "Venstre overarmsbein", la: "Humerus sinister" } },
  { id: "humerus_right", fma: ["FMA23130"], parent: "upper_arm_right", detail: 2, name: { en: "Right humerus", nb: "Høyre overarmsbein", la: "Humerus dexter" } },
  { id: "radius_left", fma: ["FMA23465"], parent: "forearm_left", detail: 2, name: { en: "Left radius", nb: "Venstre spolebein", la: "Radius sinister" } },
  { id: "ulna_left", fma: ["FMA23468"], parent: "forearm_left", detail: 2, name: { en: "Left ulna", nb: "Venstre albuebein", la: "Ulna sinistra" } },
  { id: "radius_right", fma: ["FMA23464"], parent: "forearm_right", detail: 2, name: { en: "Right radius", nb: "Høyre spolebein", la: "Radius dexter" } },
  { id: "ulna_right", fma: ["FMA23467"], parent: "forearm_right", detail: 2, name: { en: "Right ulna", nb: "Høyre albuebein", la: "Ulna dextra" } },
  { id: "carpals_left", composite: "FMA71335", side: "left", parent: "hand_left", detail: 3, name: { en: "Left carpals", nb: "Venstre håndrotsbein", la: "Ossa carpi" } },
  { id: "metacarpals_left", composite: "FMA71336", side: "left", parent: "hand_left", detail: 3, name: { en: "Left metacarpals", nb: "Venstre mellomhåndsbein", la: "Ossa metacarpi" } },
  { id: "phalanges_hand_left", composite: "FMA231315", side: "left", filter: /finger|thumb/, parent: "hand_left", detail: 3, name: { en: "Left finger bones", nb: "Venstre fingerbein", la: "Phalanges manus" } },
  { id: "carpals_right", composite: "FMA71335", side: "right", parent: "hand_right", detail: 3, name: { en: "Right carpals", nb: "Høyre håndrotsbein", la: "Ossa carpi" } },
  { id: "metacarpals_right", composite: "FMA71336", side: "right", parent: "hand_right", detail: 3, name: { en: "Right metacarpals", nb: "Høyre mellomhåndsbein", la: "Ossa metacarpi" } },
  { id: "phalanges_hand_right", composite: "FMA231315", side: "right", filter: /finger|thumb/, parent: "hand_right", detail: 3, name: { en: "Right finger bones", nb: "Høyre fingerbein", la: "Phalanges manus" } },
  { id: "hip_bones", fma: ["FMA16586", "FMA16587"], parent: "pelvis", detail: 2, name: { en: "Hip bones", nb: "Hoftebein", la: "Ossa coxae" }, uberon: "UBERON:0001272" },
  { id: "femur_left", fma: ["FMA24475"], parent: "thigh_left", detail: 2, name: { en: "Left femur", nb: "Venstre lårbein", la: "Os femoris sinistrum" }, uberon: "UBERON:0000981" },
  { id: "femur_right", fma: ["FMA24474"], parent: "thigh_right", detail: 2, name: { en: "Right femur", nb: "Høyre lårbein", la: "Os femoris dextrum" }, uberon: "UBERON:0000981" },
  { id: "patella_left", fma: ["FMA24487"], parent: "lower_leg_left", detail: 2, name: { en: "Left patella", nb: "Venstre kneskål", la: "Patella sinistra" } },
  { id: "patella_right", fma: ["FMA24486"], parent: "lower_leg_right", detail: 2, name: { en: "Right patella", nb: "Høyre kneskål", la: "Patella dextra" } },
  { id: "tibia_left", fma: ["FMA24478"], parent: "lower_leg_left", detail: 2, name: { en: "Left tibia", nb: "Venstre skinnebein", la: "Tibia sinistra" } },
  { id: "fibula_left", fma: ["FMA24481"], parent: "lower_leg_left", detail: 2, name: { en: "Left fibula", nb: "Venstre leggbein", la: "Fibula sinistra" } },
  { id: "tibia_right", fma: ["FMA24477"], parent: "lower_leg_right", detail: 2, name: { en: "Right tibia", nb: "Høyre skinnebein", la: "Tibia dextra" } },
  { id: "fibula_right", fma: ["FMA24480"], parent: "lower_leg_right", detail: 2, name: { en: "Right fibula", nb: "Høyre leggbein", la: "Fibula dextra" } },
  { id: "tarsals_left", composite: "FMA71339", side: "left", parent: "foot_left", detail: 3, name: { en: "Left tarsals", nb: "Venstre fotrotsbein", la: "Ossa tarsi" } },
  { id: "metatarsals_left", composite: "FMA71340", side: "left", parent: "foot_left", detail: 3, name: { en: "Left metatarsals", nb: "Venstre mellomfotsbein", la: "Ossa metatarsi" } },
  { id: "phalanges_foot_left", composite: "FMA231315", side: "left", filter: /toe/, parent: "foot_left", detail: 3, name: { en: "Left toe bones", nb: "Venstre tåbein", la: "Phalanges pedis" } },
  { id: "tarsals_right", composite: "FMA71339", side: "right", parent: "foot_right", detail: 3, name: { en: "Right tarsals", nb: "Høyre fotrotsbein", la: "Ossa tarsi" } },
  { id: "metatarsals_right", composite: "FMA71340", side: "right", parent: "foot_right", detail: 3, name: { en: "Right metatarsals", nb: "Høyre mellomfotsbein", la: "Ossa metatarsi" } },
  { id: "phalanges_foot_right", composite: "FMA231315", side: "right", filter: /toe/, parent: "foot_right", detail: 3, name: { en: "Right toe bones", nb: "Høyre tåbein", la: "Phalanges pedis" } },
];

/** detail-1 silhouettes: convex hulls of these bones. */
export const REGIONS = [
  { id: "skull", of: ["cranium", "mandible"], parent: "head", name: { en: "Skull", nb: "Kranium", la: "Cranium" } },
  { id: "spine", of: ["cervical_vertebrae", "thoracic_vertebrae", "lumbar_vertebrae", "sacrum"], parent: "axial", name: { en: "Spine", nb: "Ryggrad", la: "Columna vertebralis" } },
  { id: "shoulder_girdle", of: ["clavicle_left", "clavicle_right", "scapula_left", "scapula_right"], parent: "axial", name: { en: "Shoulder girdle", nb: "Skulderbelte", la: "Cingulum pectorale" } },
  { id: "rib_cage", of: ["ribs", "sternum"], parent: "axial", name: { en: "Rib cage", nb: "Brystkasse", la: "Cavea thoracis" } },
  { id: "pelvis", of: ["hip_bones", "sacrum"], parent: "axial", name: { en: "Pelvis", nb: "Bekken", la: "Pelvis" }, uberon: "UBERON:0002355" },
  { id: "upper_arm_left", of: ["humerus_left"], parent: "arm_left", name: { en: "Left upper arm", nb: "Venstre overarm", la: "Brachium sinistrum" } },
  { id: "forearm_left", of: ["radius_left", "ulna_left"], parent: "arm_left", name: { en: "Left forearm", nb: "Venstre underarm", la: "Antebrachium sinistrum" } },
  { id: "hand_left", of: ["carpals_left", "metacarpals_left", "phalanges_hand_left"], parent: "arm_left", name: { en: "Left hand", nb: "Venstre hånd", la: "Manus sinistra" } },
  { id: "upper_arm_right", of: ["humerus_right"], parent: "arm_right", name: { en: "Right upper arm", nb: "Høyre overarm", la: "Brachium dextrum" } },
  { id: "forearm_right", of: ["radius_right", "ulna_right"], parent: "arm_right", name: { en: "Right forearm", nb: "Høyre underarm", la: "Antebrachium dextrum" } },
  { id: "hand_right", of: ["carpals_right", "metacarpals_right", "phalanges_hand_right"], parent: "arm_right", name: { en: "Right hand", nb: "Høyre hånd", la: "Manus dextra" } },
  { id: "thigh_left", of: ["femur_left"], parent: "leg_left", name: { en: "Left thigh", nb: "Venstre lår", la: "Femur sinistrum" } },
  { id: "lower_leg_left", of: ["tibia_left", "fibula_left", "patella_left"], parent: "leg_left", name: { en: "Left lower leg", nb: "Venstre legg", la: "Crus sinistrum" } },
  { id: "foot_left", of: ["tarsals_left", "metatarsals_left", "phalanges_foot_left"], parent: "leg_left", name: { en: "Left foot", nb: "Venstre fot", la: "Pes sinister" } },
  { id: "thigh_right", of: ["femur_right"], parent: "leg_right", name: { en: "Right thigh", nb: "Høyre lår", la: "Femur dextrum" } },
  { id: "lower_leg_right", of: ["tibia_right", "fibula_right", "patella_right"], parent: "leg_right", name: { en: "Right lower leg", nb: "Høyre legg", la: "Crus dextrum" } },
  { id: "foot_right", of: ["tarsals_right", "metatarsals_right", "phalanges_foot_right"], parent: "leg_right", name: { en: "Right foot", nb: "Høyre fot", la: "Pes dexter" } },
];

export const GROUPS = [
  { id: "head", parent: null, name: { en: "Head", nb: "Hode", la: "Caput" } },
  { id: "axial", parent: null, name: { en: "Trunk skeleton", nb: "Kroppsstammen", la: "Skeleton axiale" } },
  { id: "arm_left", parent: null, name: { en: "Left arm", nb: "Venstre arm", la: "Membrum superius sinistrum" } },
  { id: "arm_right", parent: null, name: { en: "Right arm", nb: "Høyre arm", la: "Membrum superius dextrum" } },
  { id: "leg_left", parent: null, name: { en: "Left leg", nb: "Venstre bein", la: "Membrum inferius sinistrum" } },
  { id: "leg_right", parent: null, name: { en: "Right leg", nb: "Høyre bein", la: "Membrum inferius dextrum" } },
];

export const VISCERA = [
  { id: "brain", composite: "FMA50801", parent: "head", detail: 1, color: "#c9a3ae", uberon: "UBERON:0000955", name: { en: "Brain", nb: "Hjerne", la: "Encephalon" } },
  { id: "trachea", fma: ["FMA7394"], parent: "thorax", detail: 2, color: "#a8b0b8", name: { en: "Trachea", nb: "Luftrør", la: "Trachea" } },
  { id: "esophagus", fma: ["FMA7131"], parent: "thorax", detail: 3, behind: true, color: "#b59a8c", name: { en: "Oesophagus", nb: "Spiserør", la: "Oesophagus" } },
  { id: "lung_right", composite: "FMA7309", parent: "thorax", detail: 1, color: "#c98f9b", uberon: "UBERON:0002168", name: { en: "Right lung", nb: "Høyre lunge", la: "Pulmo dexter" } },
  { id: "lung_left", composite: "FMA7310", parent: "thorax", detail: 1, color: "#c98f9b", uberon: "UBERON:0002167", name: { en: "Left lung", nb: "Venstre lunge", la: "Pulmo sinister" } },
  { id: "heart", composite: "FMA7088", parent: "thorax", detail: 1, color: "#b8524f", uberon: "UBERON:0000948", name: { en: "Heart", nb: "Hjerte", la: "Cor" } },
  { id: "aorta", fma: ["FMA3734"], parent: "thorax", detail: 3, behind: true, color: "#c0655f", uberon: "UBERON:0000947", name: { en: "Aorta", nb: "Hovedpulsåre", la: "Aorta" } },
  { id: "liver", fma: ["FMA7197"], parent: "abdomen", detail: 1, layer: "superficial", color: "#8a5a3c", uberon: "UBERON:0002107", name: { en: "Liver", nb: "Lever", la: "Hepar" } },
  { id: "gallbladder", fma: ["FMA7202"], parent: "abdomen", detail: 3, color: "#7f9a5c", name: { en: "Gallbladder", nb: "Galleblære", la: "Vesica biliaris" } },
  { id: "stomach", fma: ["FMA7148"], parent: "abdomen", detail: 1, layer: "superficial", color: "#c9a15f", uberon: "UBERON:0000945", name: { en: "Stomach", nb: "Magesekk", la: "Gaster" } },
  { id: "spleen", fma: ["FMA7196"], parent: "abdomen", detail: 2, behind: true, color: "#7d5a86", uberon: "UBERON:0002106", name: { en: "Spleen", nb: "Milt", la: "Splen" } },
  { id: "pancreas", composite: "FMA7198", parent: "abdomen", detail: 2, behind: true, color: "#c9b06a", uberon: "UBERON:0001264", name: { en: "Pancreas", nb: "Bukspyttkjertel", la: "Pancreas" } },
  { id: "kidney_right", fma: ["FMA7204"], parent: "urinary", detail: 2, behind: true, color: "#8a5f4a", uberon: "UBERON:0004539", name: { en: "Right kidney", nb: "Høyre nyre", la: "Ren dexter" } },
  { id: "kidney_left", fma: ["FMA7205"], parent: "urinary", detail: 2, behind: true, color: "#8a5f4a", uberon: "UBERON:0004538", name: { en: "Left kidney", nb: "Venstre nyre", la: "Ren sinister" } },
  { id: "adrenal_right", fma: ["FMA15629"], parent: "urinary", detail: 3, behind: true, color: "#c9a25f", name: { en: "Right adrenal gland", nb: "Høyre binyre", la: "Glandula suprarenalis dextra" } },
  { id: "adrenal_left", fma: ["FMA15630"], parent: "urinary", detail: 3, behind: true, color: "#c9a25f", name: { en: "Left adrenal gland", nb: "Venstre binyre", la: "Glandula suprarenalis sinistra" } },
  { id: "small_intestine", composite: "FMA7200", parent: "abdomen", detail: 1, layer: "superficial", color: "#d8a679", uberon: "UBERON:0002108", name: { en: "Small intestine", nb: "Tynntarm", la: "Intestinum tenue" } },
  { id: "large_intestine", composite: "FMA7201", parent: "abdomen", detail: 1, layer: "superficial", color: "#c08a5c", uberon: "UBERON:0000059", name: { en: "Large intestine", nb: "Tykktarm", la: "Intestinum crassum" } },
  { id: "bladder", fma: ["FMA15900"], parent: "urinary", detail: 2, color: "#c9c47f", uberon: "UBERON:0001255", name: { en: "Urinary bladder", nb: "Urinblære", la: "Vesica urinaria" } },
  { id: "prostate", fma: ["FMA9600"], parent: "pelvis_organs", detail: 2, sex: "male", color: "#a08a70", uberon: "UBERON:0002367", name: { en: "Prostate", nb: "Prostata", la: "Prostata" } },
];

/** The one part with no mesh: BodyParts3D 3.0 is one adult male. A blob
 *  placed against the projected pelvis — the build computes `c` from the hip
 *  bones' box (centre x, 6 % above the pubic bottom) and uses these radii. */
export const AUTHORED = [
  { id: "uterus", parent: "pelvis_organs", detail: 2, sex: "female", color: "#b07f95", uberon: "UBERON:0000995", name: { en: "Uterus", nb: "Livmor", la: "Uterus" }, shape: { rx: 30, ry: 26, wobble: 0.1, seed: 18 }, place: "pelvis" },
];

export const VISCERA_GROUPS = [
  { id: "thorax", parent: null, name: { en: "Chest organs", nb: "Brystorganer", la: "Viscera thoracis" } },
  { id: "abdomen", parent: null, name: { en: "Abdomen", nb: "Buk", la: "Abdomen" } },
  { id: "urinary", parent: null, name: { en: "Urinary system", nb: "Urinveier", la: "Systema urinarium" } },
  { id: "pelvis_organs", parent: null, name: { en: "Pelvic organs", nb: "Bekkenorganer", la: "Organa pelvis" } },
];
```

Note `neck` and `thyroid` are gone (no thyroid mesh); `coccyx` is gone; `scapula` is split. Task 3's build fails loudly if any listed part yields no geometry, which is the check that these ids are right.

- [ ] **Step 7: Run the tests and typecheck, then commit**

Run: `npx vitest run tests/anatomy-bp3d.test.ts && npx tsc --noEmit`
Expected: PASS.

```bash
git add scripts/anatomy/bp3d.mjs scripts/anatomy/bp3d.d.mts assets/anatomy-sources/bodyparts.mjs .gitignore tests/anatomy-bp3d.test.ts
git commit -m "Atlas build: the BodyParts3D catalogue, a caching fetcher, and the part table"
```

---

## Task 3: The build, rewritten around meshes — and a look at the result

**Files:**
- Rewrite: `scripts/build-anatomy-atlas.mjs`
- Create: `src/scenes/anatomy/atlas/LICENSE`, `src/scenes/anatomy/atlas/ATTRIBUTION.md`
- Move (generated): `src/scenes/anatomy/atlas-*.json` → `src/scenes/anatomy/atlas/atlas-*.json`
- Modify: `src/scenes/anatomy/types.ts` (`layer`, `behind`, `source`), `src/scenes/engines.ts` (import paths), `assets/anatomy-sources/PROVENANCE.md`, `tests/anatomy-atlas.test.ts`
- Rename: `assets/anatomy-sources/skeleton-map.mjs` → `skeleton-map.reserve.mjs`; delete `assets/anatomy-sources/viscera.mjs`
- Remove devDependency: `polygon-clipping`

**Interfaces:**
- Consumes: Tasks 1–2; `simplify`, `ringArea`, `convexHull`, `blob`, `closestPair`, `round1` from `scripts/anatomy/geom.mjs`; `JOINTS`, `jointRadius` from `assets/anatomy-sources/joints.mjs`
- Produces: the three atlas files with every part carrying `depth` (mean anterior offset, mm), `source`, and for organs `layer`/`behind`; `body_outline` from the skin

- [ ] **Step 1: Extend the types**

In `src/scenes/anatomy/types.ts`, add to `AtlasPart` after `color?`:

```ts
  /** Where the geometry came from. Everything but the uterus is measured. */
  source: "bodyparts3d" | "authored";
  /** Abdominal organs the `layer: deep` view lifts away. */
  layer?: "superficial" | "deep";
  /** Lies behind superficial organs: drawn dashed while they cover it. */
  behind?: boolean;
```

- [ ] **Step 2: Write the licence files**

`src/scenes/anatomy/atlas/LICENSE`:

```
The atlas JSON files in this directory are derived from BodyParts3D
(The Database Center for Life Science, Japan), release 3.0 / 20110915,
and are licensed under the Creative Commons Attribution-ShareAlike 2.1
Japan licence: https://creativecommons.org/licenses/by-sa/2.1/jp/

Attribution required by the licensor:
"BodyParts3D, © The Database Center for Life Science licensed under
CC Attribution-Share Alike 2.1 Japan"

Derivative works of these files must be distributed under the same
licence. The drawcast application code around them is MIT-licensed and
is not a derivative of the data.
```

`src/scenes/anatomy/atlas/ATTRIBUTION.md`:

```markdown
# Attribution

The anatomy atlas (`atlas-body.json`, `atlas-skeleton.json`,
`atlas-viscera.json`) is derived from **BodyParts3D**:

> BodyParts3D, © The Database Center for Life Science licensed under
> CC Attribution-Share Alike 2.1 Japan

- Data: BodyParts3D 3.0 (20110915), obtained via the GitHub mirror
  https://github.com/Kevin-Mattheus-Moerman/BodyParts3D
- Paper: Mitsuhashi N, Fujieda K, Tamura T, Kawamoto S, Takagi T, Okubo K.
  BodyParts3D: 3D structure database for anatomical concepts.
  Nucleic Acids Res. 2009;37(Database issue):D782-5. doi:10.1093/nar/gkn613
- Archive: doi:10.18908/lsdba.nbdc00837-000

Each part's silhouette is the frontal projection of the corresponding
FMA-identified mesh (or the union of a composite's element meshes),
rasterised and contoured by `scripts/build-anatomy-atlas.mjs`. The single
exception is `uterus`, which has no mesh in this male dataset and is a
schematic shape (`source: "authored"`).
```

- [ ] **Step 3: Rewrite the build script**

Replace `scripts/build-anatomy-atlas.mjs` with:

```js
// BodyParts3D meshes → atlas JSON + preview. Deterministic given the cache;
// run by hand, output checked in:
//   node scripts/build-anatomy-atlas.mjs
//
// Every part is the frontal projection of one or more FMA-identified meshes:
// the triangles are projected (x → right, z → up), scan-filled into a coverage
// mask over the atlas space, and the mask is contoured. Union and holes come
// out of the mask for free. The first run downloads ~150 MB into
// .cache/bodyparts3d/ (gitignored); later runs are offline.

import { fileURLToPath } from "node:url";
import { mkdirSync, writeFileSync, existsSync, unlinkSync } from "node:fs";
import { simplify, ringArea, centroid, convexHull, blob, closestPair, round1 } from "./anatomy/geom.mjs";
import { parseStl } from "./anatomy/stl.mjs";
import { Mask } from "./anatomy/raster.mjs";
import { fetchCatalogue, fetchStl, elementsFor } from "./anatomy/bp3d.mjs";
import { SKIN, BONES, REGIONS, GROUPS, VISCERA, AUTHORED, VISCERA_GROUPS } from "../assets/anatomy-sources/bodyparts.mjs";
import { JOINTS, jointRadius } from "../assets/anatomy-sources/joints.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const CACHE = `${ROOT}.cache/bodyparts3d`;
const OUT = `${ROOT}src/scenes/anatomy/atlas`;
const PREVIEW = `${ROOT}assets/anatomy-sources/preview.svg`;

const SPACE = [1000, 2000];
const TOP = 40, BOTTOM = 1960;          // where the skin's extremes land in atlas y
const CELL = 1.5;                        // atlas units per mask cell
const TOL = 1.0;                         // Douglas–Peucker, atlas units
const MIN_AREA = { outer: 20, hole: 40 };
const SOURCE = "BodyParts3D, © The Database Center for Life Science licensed under CC Attribution-Share Alike 2.1 Japan (release 3.0); uterus authored";

const log = (s) => console.log(s);
const bbox = (pts) => { let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; for (const [x, y] of pts) { if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y; } return { x0, y0, x1, y1 }; };
const outerPts = (rings) => rings.flatMap((r) => r.outer);
const pointsIn = (part) => part.rings.reduce((s, r) => s + r.outer.length + (r.holes ?? []).reduce((t, h) => t + h.length, 0), 0);

async function main() {
  const cat = await fetchCatalogue({ cacheDir: CACHE });
  log(`catalogue: ${cat.names.size} names, ${cat.composites.size} composites`);

  /** The meshes of one part: [{ id, positions }], skipping files the mirror lacks. */
  const meshesFor = async (label, spec) => {
    const ids = elementsFor(cat, spec);
    const out = [];
    for (const id of ids) {
      const bytes = await fetchStl(id, { cacheDir: CACHE, log });
      if (!bytes) continue;
      out.push({ id, ...parseStl(bytes) });
    }
    const tris = out.reduce((s, m) => s + m.triangles, 0);
    log(`${label}: ${out.length}/${ids.length} meshes, ${tris} triangles`);
    if (out.length === 0 && !spec.optional) throw new Error(`${label}: no geometry — check its ids in bodyparts.mjs`);
    return out;
  };

  // 1. The skin sets the frame: its z-extremes → TOP/BOTTOM, its x-midline → 500.
  const skin = await meshesFor("skin", SKIN);
  let zTop = -Infinity, zBot = Infinity, xMin = Infinity, xMax = -Infinity;
  for (const m of skin) for (let i = 0; i < m.positions.length; i += 3) {
    const x = m.positions[i], z = m.positions[i + 2];
    if (z > zTop) zTop = z; if (z < zBot) zBot = z; if (x < xMin) xMin = x; if (x > xMax) xMax = x;
  }
  const k = (BOTTOM - TOP) / (zTop - zBot);
  const xMid = (xMin + xMax) / 2;
  const project = (x, z) => [SPACE[0] / 2 + (x - xMid) * k, TOP + (zTop - z) * k];
  log(`frame: z ${zBot.toFixed(0)}..${zTop.toFixed(0)} mm, x mid ${xMid.toFixed(0)}, scale ${k.toFixed(3)} atlas units/mm`);

  /** Project + rasterise + contour a part's meshes → { rings, depth }. */
  const silhouette = (meshes) => {
    const mask = new Mask(Math.ceil(SPACE[0] / CELL), Math.ceil(SPACE[1] / CELL), CELL, [0, 0]);
    let ySum = 0, n = 0;
    for (const m of meshes) {
      const p = m.positions;
      for (let i = 0; i < p.length; i += 9) {
        mask.fillTriangle(project(p[i], p[i + 2]), project(p[i + 3], p[i + 5]), project(p[i + 6], p[i + 8]));
        ySum += -(p[i + 1] + p[i + 4] + p[i + 7]); n += 3;
      }
    }
    const rings = [];
    for (const r of mask.rings()) {
      const outer = simplify(r.outer, TOL);
      if (outer.length < 3 || ringArea(outer) < MIN_AREA.outer) continue;
      const holes = r.holes.map((h) => simplify(h, TOL)).filter((h) => h.length >= 3 && ringArea(h) >= MIN_AREA.hole);
      rings.push(holes.length ? { outer: round1(outer), holes: holes.map(round1) } : { outer: round1(outer) });
    }
    return { rings, depth: Math.round((n ? ySum / n : 0) * 10) / 10 };
  };
  const record = (spec, system, kind, geo, extra = {}) => ({
    name: spec.name, system, kind, parent: spec.parent, detail: spec.detail, depth: geo.depth, sex: spec.sex ?? "any",
    ...(spec.color ? { color: spec.color } : {}), source: "bodyparts3d", ...(spec.layer ? { layer: spec.layer } : {}), ...(spec.behind ? { behind: true } : {}),
    rings: geo.rings, ...(spec.uberon ? { uberon: spec.uberon } : {}), ...extra,
  });

  // 2. Bones.
  const skeleton = {};
  for (const b of BONES) {
    const geo = silhouette(await meshesFor(b.id, b));
    if (geo.rings.length === 0) throw new Error(`${b.id}: projected to nothing`);
    skeleton[b.id] = record(b, "skeleton", "bone", geo);
  }

  // 3. Joints: derived from the projected bones, as in round 1.
  for (const j of JOINTS) {
    let c, diag;
    const d = (pts) => { const bb = bbox(pts); return Math.hypot(bb.x1 - bb.x0, bb.y1 - bb.y0); };
    if (j.between) {
      const [a, b] = j.between.map((id) => outerPts(skeleton[id].rings));
      const { p, q } = closestPair(a, b);
      c = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
      diag = Math.max(d(a), d(b));
    } else {
      const pts = outerPts(skeleton[j.top].rings);
      c = pts.reduce((best, p) => (p[1] < best[1] ? p : best), pts[0]);
      diag = d(pts);
    }
    const r = jointRadius(diag);
    skeleton[j.id] = { name: j.name, system: "skeleton", kind: "joint", parent: j.parent, detail: 2, depth: 999, sex: "any", source: "bodyparts3d", rings: [{ outer: round1(blob({ c, rx: r, ry: r, n: 16 })) }] };
  }

  // 4. Regions (detail 1): hulls of their bones. Groups. The skin as the outline.
  const body = {};
  for (const rg of REGIONS) {
    const pts = rg.of.flatMap((id) => outerPts(skeleton[id].rings));
    body[rg.id] = { name: rg.name, system: "skeleton", kind: "region", parent: rg.parent, detail: 1, depth: 0, sex: "any", source: "bodyparts3d", rings: [{ outer: round1(convexHull(pts)) }], ...(rg.uberon ? { uberon: rg.uberon } : {}) };
  }
  for (const g of GROUPS) body[g.id] = { name: g.name, system: "skeleton", kind: "group", parent: g.parent, detail: 1, depth: 0, sex: "any", source: "bodyparts3d", rings: [] };
  for (const g of VISCERA_GROUPS) body[g.id] = { name: g.name, system: "viscera", kind: "group", parent: g.parent, detail: 1, depth: 0, sex: "any", source: "bodyparts3d", rings: [] };
  const skinGeo = silhouette(skin);
  body.body_outline = { name: { en: "Body", nb: "Kropp", la: "Corpus" }, system: "skeleton", kind: "outline", parent: null, detail: 1, depth: -999, sex: "any", source: "bodyparts3d", rings: skinGeo.rings };
  log(`skin: ${skinGeo.rings.length} ring(s), ${skinGeo.rings.reduce((s, r) => s + (r.holes?.length ?? 0), 0)} hole(s)`);

  // 5. Organs, then the one authored part placed against the projected pelvis.
  const viscera = {};
  for (const o of VISCERA) {
    const geo = silhouette(await meshesFor(o.id, o));
    if (geo.rings.length === 0) throw new Error(`${o.id}: projected to nothing`);
    viscera[o.id] = record(o, "viscera", "organ", geo);
  }
  for (const a of AUTHORED) {
    const pb = bbox(outerPts(skeleton.hip_bones.rings));
    const c = [(pb.x0 + pb.x1) / 2, pb.y0 + 0.62 * (pb.y1 - pb.y0)];
    viscera[a.id] = { name: a.name, system: "viscera", kind: "organ", parent: a.parent, detail: a.detail, depth: (viscera.bladder?.depth ?? 0) - 5, sex: a.sex, color: a.color, source: "authored", rings: [{ outer: round1(simplify(blob({ c, ...a.shape }), TOL)) }], ...(a.uberon ? { uberon: a.uberon } : {}) };
  }

  // 6. Write.
  mkdirSync(OUT, { recursive: true });
  const write = (name, parts) => {
    const head = `{\n "view": "anterior",\n "space": ${JSON.stringify(SPACE)},\n "source": ${JSON.stringify(SOURCE)},\n "parts": {\n`;
    const rows = Object.entries(parts).map(([id, p]) => `  ${JSON.stringify(id)}: ${JSON.stringify(p)}`).join(",\n");
    writeFileSync(`${OUT}/${name}`, `${head}${rows}\n }\n}\n`);
    const n = Object.values(parts).reduce((s, p) => s + pointsIn(p), 0);
    log(`${name}: ${Object.keys(parts).length} parts, ${n} points`);
  };
  write("atlas-body.json", body);
  write("atlas-skeleton.json", skeleton);
  write("atlas-viscera.json", viscera);
  for (const stale of ["atlas-body.json", "atlas-skeleton.json", "atlas-viscera.json"]) {
    const old = `${ROOT}src/scenes/anatomy/${stale}`;
    if (existsSync(old)) unlinkSync(old);
  }

  log("landmarks (atlas units, y down):");
  for (const rg of REGIONS) { const bb = bbox(body[rg.id].rings[0].outer); log(`  ${rg.id.padEnd(18)} x ${bb.x0.toFixed(0)}..${bb.x1.toFixed(0)}  y ${bb.y0.toFixed(0)}..${bb.y1.toFixed(0)}`); }

  writeFileSync(PREVIEW, preview(body, skeleton, viscera));
  log(`preview: ${PREVIEW}`);
}

function preview(body, skeleton, viscera) {
  const d = (r) => `M${r.outer.map(([x, y]) => `${x} ${y}`).join("L")}Z${(r.holes ?? []).map((h) => `M${h.map(([x, y]) => `${x} ${y}`).join("L")}Z`).join("")}`;
  const shape = (p, fill, stroke, width = 1.4, opts = "") => p.rings.map((r) => `<path d="${d(r)}" fill="${fill}" fill-rule="evenodd" stroke="${stroke}" stroke-width="${width}" ${opts}/>`).join("");
  const byDepth = (parts) => Object.values(parts).filter((p) => p.rings.length > 0 && p.kind !== "outline").sort((a, b) => a.depth - b.depth);
  const skin = shape(body.body_outline, "#f1dccb", "#c9b4a3", 1.2, 'fill-opacity="0.7"');
  const left = skin
    + byDepth(body).filter((p) => p.kind === "region").map((p) => shape(p, "#e6dcc4", "#333")).join("")
    + byDepth(viscera).filter((p) => p.detail === 1).map((p) => shape(p, p.color, "#333", 1.4, 'fill-opacity="0.65"')).join("");
  const right = skin
    + byDepth(skeleton).filter((p) => p.kind === "bone").map((p) => shape(p, "#e6dcc4", "#333")).join("")
    + byDepth(viscera).map((p) => shape(p, p.color, "#333", 1.4, `fill-opacity="0.65"${p.behind ? ' stroke-dasharray="5 4"' : ""}`)).join("")
    + byDepth(skeleton).filter((p) => p.kind === "joint").map((p) => shape(p, "none", "#c0392b", 2.5)).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2000 2000" width="1000" height="1000">`
    + `<rect width="2000" height="2000" fill="#faf6ec"/><g>${left}</g><g transform="translate(1000,0)">${right}</g>`
    + `<line x1="1000" y1="0" x2="1000" y2="2000" stroke="#bbb"/></svg>`;
}

main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 4: Point the engine at the new directory and retire the old inputs**

In `src/scenes/engines.ts`, the three imports become `import("./anatomy/atlas/atlas-body.json")` etc. In `assets/anatomy-sources/`, `git mv skeleton-map.mjs skeleton-map.reserve.mjs` and `git rm viscera.mjs`; add a line at the top of the reserve file: `// RESERVE — the round-1 map of the LadyofHats SVG. Not imported; kept so the drawn skeleton can be rebuilt if BodyParts3D becomes unavailable.` Run `npm uninstall polygon-clipping`.

- [ ] **Step 5: Run the build (network; the first run downloads ~150 MB and takes minutes)**

Run: `node scripts/build-anatomy-atlas.mjs`
Expected: a log line per part with `n/m meshes, T triangles` (sided hand-bone sets will show fewer meshes than ids — the laterality-neutral duplicates have no file — that is expected), `skin: 1 ring(s)` with a few holes, three `atlas-*.json` lines with counts, the landmark table, the preview path. A thrown `X: no geometry` names a part whose ids are wrong; check the id in the cache's `parts_list_e.txt` and fix `bodyparts.mjs`. A part that downloads but "projected to nothing" has a mesh outside the frame — print its `bboxOf` and look.

- [ ] **Step 6: LOOK — the visual checkpoint**

```bash
qlmanage -t -s 1000 -o assets/anatomy-sources assets/anatomy-sources/preview.svg
```

Open `assets/anatomy-sources/preview.svg.png` with the Read tool and judge:

1. **Right panel, skeleton:** every bone reads — long bones with their heads, ribs as separate arcs with the sternum between, pelvis with foramina, skull with orbits, five fingers, five toes. Projected meshes are cleaner than the drawing was; if a bone looks bloated, the mask cell is too coarse for it (lower `CELL` to 1.0 and rebuild).
2. **Organs against the skeleton:** they are now measured, so if the liver sits under the right ribs and the kidneys beside the lumbar spine, the projection axes are right. If the body is mirrored (liver on the viewer's right), the x mapping needs `-(x - xMid)`; if organs sit low or high relative to bones, `project()` is inconsistent between parts — it is one function, so this cannot happen unless the skin frame is wrong.
3. **Depth:** kidneys, pancreas, spleen show as dashed behind the gut; the heart lies over the lungs' medial edges; the aorta (detail 3) behind the heart.
4. **Skin:** one silhouette that follows the body, arms separated from the torso where the mesh separates them, head and neck right. Thin bridges between arm and torso mean the cell size merges them: `CELL = 1.0`.
5. **Left panel:** the mannequin of 17 hulls, skin wash behind, the big organs on it.

Rebuild until all five hold; delete the PNG; record what you saw in the commit message.

- [ ] **Step 7: Update the atlas tests**

In `tests/anatomy-atlas.test.ts`: imports point at `../src/scenes/anatomy/atlas/…`. Replace the `well formed` test's kind/sex checks with the same plus:

```ts
      expect(["bodyparts3d", "authored"]).toContain(p.source);
      if (p.layer) expect(["superficial", "deep"]).toContain(p.layer);
      if (p.behind) expect(p.layer, `${id}: a part behind others is not itself superficial`).not.toBe("superficial");
```

Add tests:

```ts
test("everything but the uterus is measured", () => {
  const authored = Object.entries(EVERY_PART).filter(([, p]) => p.source === "authored").map(([id]) => id);
  expect(authored).toEqual(["uterus"]);
});

test("the skin is one silhouette", () => {
  expect(BODY.parts.body_outline.rings.length).toBe(1);
  expect(BODY.parts.body_outline.rings[0].outer.length).toBeGreaterThan(60);
});

test("the superficial layer is exactly the gut, liver and stomach", () => {
  const superficial = Object.entries(VISCERA.parts).filter(([, p]) => p.layer === "superficial").map(([id]) => id).sort();
  expect(superficial).toEqual(["large_intestine", "liver", "small_intestine", "stomach"]);
});

test("depth puts the kidneys behind the intestines and the heart in front of the lungs' bulk", () => {
  expect(VISCERA.parts.kidney_left.depth).toBeLessThan(VISCERA.parts.small_intestine.depth);
  expect(VISCERA.parts.heart.depth).toBeGreaterThan(VISCERA.parts.lung_left.depth);
});
```

Update the budget numbers in `ATLASES` to the measured totals plus ~30 %, and the region count test (17 stays). Replace the `scapula` reference in the template tests if any (`grep -n scapula tests/`). Then:

Run: `npx vitest run tests/anatomy-atlas.test.ts tests/anatomy-template.test.ts && npx tsc --noEmit`
Expected: PASS. Template tests that named `hand_left`/`femur_left`/`knee_left` still hold; the whole-figure lint test may now fail on `overlap-label-label` because organs sit differently — that is Task 5's job; if it does, mark that single test `test.skip` with the comment `// re-enabled in Task 5` and move on.

- [ ] **Step 8: Provenance and commit**

Add to `assets/anatomy-sources/PROVENANCE.md` a `## BodyParts3D` section (mirror URL, release 3.0, licence, attribution, the axis facts, "downloaded on demand into .cache/bodyparts3d/, never committed") and mark the LadyofHats section `(RESERVE — no longer used by the build)`.

```bash
git add scripts/build-anatomy-atlas.mjs src/scenes/anatomy/atlas src/scenes/anatomy/types.ts src/scenes/engines.ts assets/anatomy-sources/PROVENANCE.md assets/anatomy-sources/skeleton-map.reserve.mjs assets/anatomy-sources/preview.svg tests/anatomy-atlas.test.ts tests/anatomy-template.test.ts package.json package-lock.json
git rm -q --cached src/scenes/anatomy/atlas-body.json src/scenes/anatomy/atlas-skeleton.json src/scenes/anatomy/atlas-viscera.json assets/anatomy-sources/viscera.mjs assets/anatomy-sources/skeleton-map.mjs 2>/dev/null; git add -u src/scenes/anatomy assets/anatomy-sources
git commit -m "The atlas from one body: every part a frontal projection of its BodyParts3D mesh"
```

---

## Task 4: Kit — closed smoothing and a softer pen

**Files:**
- Modify: `src/scenes/kit.ts` (`KIT_VERSION`, `StrokeOpts.roughness`, area opts `roughness`, `smoothClosed`)
- Test: `tests/kit-smooth-closed.test.ts`

**Interfaces:**
- Produces: `kit.smoothClosed(pts: Pt[], per?: number): Pt[]` — a periodic Catmull-Rom through a closed ring, `per` samples per input edge (default 4), no closing duplicate; `roughness?: number` on `kit.stroke` and `kit.area` opts, landing in `style.roughness`; `KIT_VERSION = 8`.

- [ ] **Step 1: Write the failing test**

Create `tests/kit-smooth-closed.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { kit, KIT_VERSION } from "../src/scenes/kit";

const square = [[0, 0], [100, 0], [100, 100], [0, 100]] as [number, number][];

describe("kit.smoothClosed", () => {
  test("is periodic: per samples per edge, starts at the first point, no seam duplicate", () => {
    const out = kit.smoothClosed(square, 4);
    expect(out.length).toBe(16);
    expect(out[0]).toEqual([0, 0]);
    expect(out[out.length - 1]).not.toEqual([0, 0]);
  });

  test("rounds the corners without leaving the neighbourhood of the ring", () => {
    const out = kit.smoothClosed(square, 8);
    for (const [x, y] of out) {
      expect(x).toBeGreaterThan(-12);
      expect(x).toBeLessThan(112);
      expect(y).toBeGreaterThan(-12);
      expect(y).toBeLessThan(112);
    }
    // A corner is cut: no output point sits exactly on (100, 100) except the vertex itself.
    const near = out.filter(([x, y]) => Math.abs(x - 100) < 1 && Math.abs(y - 100) < 1);
    expect(near.length).toBe(1);
  });

  test("a ring with fewer than three points is returned as a copy", () => {
    expect(kit.smoothClosed([[1, 2], [3, 4]] as [number, number][], 4)).toEqual([[1, 2], [3, 4]]);
  });
});

describe("roughness", () => {
  test("stroke and area carry roughness into their style when asked, and not otherwise", () => {
    expect(kit.stroke("a", square, { roughness: 0.7 }).style.roughness).toBe(0.7);
    expect(kit.area("b", square, "#ccc", { roughness: 0.4 }).style.roughness).toBe(0.4);
    expect(kit.stroke("c", square).style.roughness).toBe(kit.stroke("d", square, {}).style.roughness);
  });

  test("the kit version says these exist", () => {
    expect(KIT_VERSION).toBe(8);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/kit-smooth-closed.test.ts`
Expected: FAIL — `smoothClosed is not a function`, roughness undefined, version 7.

- [ ] **Step 3: Implement**

In `src/scenes/kit.ts`:

- Line 41: `export const KIT_VERSION = 8; // v8: smoothClosed() + roughness on stroke/area (anatomy); v7: GROUND …` (keep the old tail of the comment).
- `StrokeOpts`: add `/** Pen wobble for the sketchy renderer; default is the style's. Anatomy uses 0.7. */ roughness?: number;`
- `SceneKit.area` signature: add `roughness?: number` to its options object type; `SceneKit.smoothClosed(pts: Pt[], per?: number): Pt[];` with the doc comment `/** Periodic Catmull–Rom through a CLOSED ring — no seam. */`.
- In `kit.stroke`, inside `defaultStyle({...})`: `...(o.roughness !== undefined && { roughness: o.roughness }),`
- In `kit.area`, the style call becomes `defaultStyle({ fill, opacity: …, strokeWidth: 0, ...(o.roughness !== undefined && { roughness: o.roughness }) })`.
- Add after `smooth`:

```ts
  smoothClosed(pts, per = 4) {
    const n = pts.length;
    if (n < 3) return pts.map((p): Pt => [p[0], p[1]]);
    const out: Pt[] = [];
    for (let i = 0; i < n; i++) {
      const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
      for (let j = 0; j < per; j++) {
        const t = j / per, t2 = t * t, t3 = t2 * t;
        out.push([
          0.5 * (2 * p1[0] + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
          0.5 * (2 * p1[1] + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3),
        ]);
      }
    }
    return out;
  },
```

- [ ] **Step 4: Run, typecheck, commit**

Run: `npx vitest run tests/kit-smooth-closed.test.ts tests/packs.test.ts && npx tsc --noEmit`
Expected: PASS. (`packs.test.ts` is the pack-registration sweep; a `kit:` check there must still accept templates at 7.)

```bash
git add src/scenes/kit.ts tests/kit-smooth-closed.test.ts
git commit -m "kit v8: a periodic Catmull-Rom for closed rings, and roughness as a stroke/area option"
```

---

## Task 5: The template draws the new body — rounder, on skin, in layers

**Files:**
- Modify: `src/scenes/packs/anatomy.yaml`, `src/scenes/packs.ts` (pack description)
- Test: `tests/anatomy-template.test.ts`

**Interfaces:**
- Consumes: `kit.smoothClosed`, `roughness`; atlas fields `depth`, `layer`, `behind`, `source`; `body_outline` rings with holes
- Produces: params `outline` (`skin` | `line` | `none`) and `layer` (`superficial` | `deep`); element `body_outline` as an area (skin) or closed stroke (line); every part ring smoothed ×4; dashed ink on `behind` parts under the superficial layer

- [ ] **Step 1: Write the failing tests**

Append to `tests/anatomy-template.test.ts` (and re-enable anything skipped in Task 3):

```ts
describe("anatomy round 2: skin, layers, smoothing", () => {
  beforeEach(async () => {
    unregisterPack("anatomy");
    await ensureEngines(["anatomy"]);
    registerPack("anatomy", anatomyYaml);
  });
  const leafOf = (params: Record<string, unknown>, id: string) => leafDrawables(lay(params).drawables).filter((d) => d.id === id || d.id.startsWith(id + "__"));

  test("the default ground is a skin wash: an area, no stroke", () => {
    const parts = leafOf({}, "body_outline");
    expect(parts.some((d) => d.kind === "area")).toBe(true);
    expect(parts.some((d) => d.kind === "stroke")).toBe(false);
  });

  test("outline: line draws the silhouette as a closed stroke; none draws nothing", () => {
    const line = leafOf({ outline: "line" }, "body_outline");
    expect(line.some((d) => d.kind === "stroke" && (d as { closed?: boolean }).closed)).toBe(true);
    expect(line.some((d) => d.kind === "area")).toBe(false);
    expect(leafOf({ outline: "none" }, "body_outline")).toEqual([]);
    expect(idsOf({ outline: "none" })).not.toContain("body_outline");
  });

  test("under focus the skin is clipped to the crop and nothing leaves the canvas", () => {
    for (const outline of ["skin", "line", "none"]) {
      const res = layoutSpec({ template: "anatomy", params: { focus: ["abdomen"], outline }, elements: [] } as never);
      expect(res.issues.filter((i) => i.rule === "out-of-canvas"), outline).toEqual([]);
    }
    expect(idsOf({ focus: ["abdomen"] })).toContain("frame");
  });

  test("layer: deep lifts the gut, liver and stomach away and nothing else", () => {
    const shallow = new Set(idsOf({ detail: 2 }));
    const deep = new Set(idsOf({ detail: 2, layer: "deep" }));
    const gone = [...shallow].filter((id) => !deep.has(id)).sort();
    expect(gone).toEqual(["large_intestine", "liver", "small_intestine", "stomach"]);
    expect([...deep].filter((id) => !shallow.has(id))).toEqual([]);
  });

  test("a part behind the gut is dashed while the gut covers it, solid once the gut is lifted", () => {
    const covered = leafOf({ detail: 2 }, "kidney_left").find((d) => d.kind === "stroke")!;
    expect(covered.style.dash).toBe(true);
    const bare = leafOf({ detail: 2, layer: "deep" }, "kidney_left").find((d) => d.kind === "stroke")!;
    expect(bare.style.dash).not.toBe(true);
    const liver = leafOf({ detail: 2 }, "liver").find((d) => d.kind === "stroke")!;
    expect(liver.style.dash).not.toBe(true);
  });

  test("every drawn ring is smoothed four samples per atlas point, and the pen is softer", async () => {
    const atlas = (await import("../src/scenes/anatomy/atlas/atlas-viscera.json")).default as { parts: Record<string, { rings: { outer: number[][] }[] }> };
    const heartInk = leafOf({}, "heart").find((d) => d.kind === "stroke")!;
    expect((heartInk as { pts: unknown[] }).pts.length).toBe(4 * atlas.parts.heart.rings[0].outer.length);
    expect(heartInk.style.roughness).toBe(0.7);
  });

  test("draw order follows measured depth: posterior organs before anterior ones", () => {
    const order = lay({ detail: 2 }).order;
    expect(order.indexOf("kidney_left")).toBeLessThan(order.indexOf("small_intestine"));
    expect(order.indexOf("lung_left")).toBeLessThan(order.indexOf("heart"));
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/anatomy-template.test.ts -t "round 2"`
Expected: FAIL — `body_outline` is a stroke, no `layer`, ring lengths equal the atlas's.

- [ ] **Step 3: Update the manifest**

In `src/scenes/packs/anatomy.yaml`: `kit: 8`. The pack `description` and the template `description` each end with one sentence: `Silhouettes are frontal projections of BodyParts3D meshes (© The Database Center for Life Science, CC BY-SA 2.1 Japan).` Add two params after `labels`:

```yaml
    outline:
      type: string
      enum: [skin, line, none]
      description: "The ground the parts sit on: skin (default) is a soft skin-coloured wash of the body's silhouette with no line; line draws the silhouette as an ink outline; none draws only the parts."
    layer:
      type: string
      enum: [superficial, deep]
      description: "superficial (default) shows the organs as seen from the front — the gut, liver and stomach in front, kidneys and pancreas dashed behind them. deep lifts the gut, liver and stomach away so the kidneys, adrenals, pancreas, spleen and aorta show in full. Use deep for anything about the retroperitoneum or 'what lies behind'."
```

Update `element_ids.body_outline` to `the body's silhouette — a skin wash by default (outline: skin), an ink outline (line), or absent (none); left out under focus except as a clipped wash`. Replace the four manifest `examples` with:

```yaml
examples:
  - request: "Draw the organs of the human body and label them."
    params: { labels: "all", detail: 1 }
  - request: "Where is the liver? Show the body so I can point at it."
    params: { systems: ["viscera"], detail: 2, highlight: ["liver"], labels: "none" }
  - request: "Vis hva som ligger bak tarmene."
    params: { systems: ["viscera"], detail: 2, layer: "deep", labels: "all", names: "nb" }
  - request: "The skeleton in plain ink, with the knees marked."
    params: { systems: ["skeleton"], detail: 2, color: "mono", outline: "line", highlight: ["knee_left", "knee_right"], labels: "focus" }
```

- [ ] **Step 4: Change the layout**

In the `layout:` block:

a. After `const mono = …` add:

```js
  const outlineMode = params.outline === "line" || params.outline === "none" ? params.outline : "skin";
  const layerIn = params.layer === "deep" ? "deep" : "superficial";
  const ROUGH = 0.7;                      // the anatomy pen: a quick sketch, not a nervous one
  const SKIN = "#f1dccb";
  const SM = (ring) => kit.smoothClosed(ring, 4);
```

b. In `leaves(L)`, exclude lifted parts: change the filter to
`Object.keys(all).filter((id) => drawnAt(id, focusIds.has(id) ? 3 : L) && (!focusing || focusIds.has(id)) && !(layerIn === "deep" && all[id].layer === "superficial"))`.

c. Replace the whole "The ground" block (`if (!focusing && all.body_outline) { … } else if (focusing) { … }`) with:

```js
  // The ground. Skin: a wash of the silhouette, no line — paper, not ink, so
  // labels may cross it and lint has nothing to catch. Line: the silhouette
  // as ink. Under focus the wash is clipped to the crop box (a rectangle
  // clip, Sutherland–Hodgman) and a frame marks the crop; a stroke outline is
  // never drawn under focus because it would leave the canvas.
  const clipToBox = (ring, x0, y0, x1, y1) => {
    let out = ring;
    const clipEdge = (pts, inside, intersect) => {
      const res = [];
      for (let i = 0; i < pts.length; i++) {
        const cur = pts[i], prev = pts[(i - 1 + pts.length) % pts.length];
        const ci = inside(cur), pi = inside(prev);
        if (ci) { if (!pi) res.push(intersect(prev, cur)); res.push(cur); }
        else if (pi) res.push(intersect(prev, cur));
      }
      return res;
    };
    const lerpX = (a, b, x) => [x, a[1] + (b[1] - a[1]) * ((x - a[0]) / (b[0] - a[0]))];
    const lerpY = (a, b, y) => [a[0] + (b[0] - a[0]) * ((y - a[1]) / (b[1] - a[1])), y];
    out = clipEdge(out, (p) => p[0] >= x0, (a, b) => lerpX(a, b, x0));
    out = clipEdge(out, (p) => p[0] <= x1, (a, b) => lerpX(a, b, x1));
    out = clipEdge(out, (p) => p[1] >= y0, (a, b) => lerpY(a, b, y0));
    out = clipEdge(out, (p) => p[1] <= y1, (a, b) => lerpY(a, b, y1));
    return out;
  };
  if (all.body_outline && outlineMode !== "none") {
    const ring = all.body_outline.rings[0];
    const outer = SM(ring.outer), holes = (ring.holes || []).map(SM);
    if (!focusing) {
      if (outlineMode === "skin") {
        push(kit.area("body_outline", outer.map(P), SKIN, { opacity: 0.35, holes: holes.length ? holes.map((h) => h.map(P)) : undefined, roughness: 0.5, ms: MS.region }));
      } else {
        push(kit.group("body_outline", [
          kit.stroke("body_outline__ink0", outer.map(P), { closed: true, color: C.guide, strokeWidth: 3, roughness: 0.6, ms: MS.stroke }),
          ...holes.map((h, j) => kit.stroke("body_outline__hole0_" + j, h.map(P), { closed: true, color: C.guide, strokeWidth: 2, roughness: 0.6, ms: MS.stroke })),
        ]));
      }
      anchors.body_outline = P(centroidOf(all.body_outline.rings));
    } else if (outlineMode === "skin") {
      const clipped = clipToBox(outer, bx0, by0, bx1, by1);
      const clippedHoles = holes.map((h) => clipToBox(h, bx0, by0, bx1, by1)).filter((h) => h.length >= 3);
      if (clipped.length >= 3) {
        push(kit.area("body_outline", clipped.map(P), SKIN, { opacity: 0.35, holes: clippedHoles.length ? clippedHoles.map((h) => h.map(P)) : undefined, roughness: 0.5, ms: MS.region }));
        anchors.body_outline = P(centroidOf([{ outer: clipped }]));
      }
    }
  }
  if (focusing) {
    push(kit.stroke("frame", [[FRAME.x0, FRAME.y0], [FRAME.x1, FRAME.y0], [FRAME.x1, FRAME.y1], [FRAME.x0, FRAME.y1]], { closed: true, color: C.guide, strokeWidth: 1.5, dash: true, ms: MS.guides }));
  }
```

d. In the drawing loop, smooth every ring and soften the pen — replace the body of `rings.forEach((ring, i) => { … })` with:

```js
      const outer = SM(ring.outer).map(P);
      const holes = (ring.holes || []).map((h) => SM(h).map(P));
      const dashed = isAbsent(id) || (part.behind === true && layerIn === "superficial" && systems.includes("viscera"));
      if (part.kind === "joint") {
        kids.push(kit.stroke(id + "__ink" + i, outer, { closed: true, color: lit ? C.accent : "#b5533c", strokeWidth: lit ? 3.5 : 2.5, roughness: ROUGH, ms: MS.dot }));
        return;
      }
      if (!isAbsent(id)) kids.push(kit.area(id + "__fill" + i, outer, fillOf(id), { opacity: lit ? 0.8 : (mono ? 0.18 : 0.45), holes: holes.length ? holes : undefined, roughness: ROUGH, ms: MS.region }));
      kids.push(kit.stroke(id + "__ink" + i, outer, { closed: true, color: isAbsent(id) ? C.guide : ink, strokeWidth: lit ? 3 : 2, dash: dashed || undefined, roughness: ROUGH, ms: MS.stroke }));
      holes.forEach((h, j) => kids.push(kit.stroke(id + "__hole" + i + "_" + j, h, { closed: true, color: ink, strokeWidth: 1.6, roughness: ROUGH, ms: MS.stroke })));
```

e. `edgeAnchor` and `centroidOf` keep working on the atlas rings (unsmoothed) — no change. The `drawn` sort already orders by `depth` within a system; the atlas now carries measured depths, so nothing changes there.

f. The whole-body label columns use `all.body_outline.rings[0].outer` for `minX`/`maxX` — unchanged and still right (the skin is the widest thing).

- [ ] **Step 5: Run everything anatomy, then the full suite**

Run: `npx vitest run tests/anatomy-template.test.ts tests/anatomy-atlas.test.ts tests/examples.test.ts && npx tsc --noEmit`
Expected: PASS, including the re-enabled whole-figure lint test. If `overlap-label-label` appears in the whole-body plate, the columns are longer than before (more organs): lower the column gap floor from `1.3` to `1.25 × LABEL_PX` only if the text boxes still clear by the lint's 2 units — otherwise drop label fontSize to 18 for `labels: all`.

Then `npx vitest run` for the whole suite.

- [ ] **Step 6: Commit**

```bash
git add src/scenes/packs/anatomy.yaml src/scenes/packs.ts tests/anatomy-template.test.ts
git commit -m "Anatomy draws the measured body: smoothed rings, a skin wash by default, a deep layer, a softer pen"
```

---

## Task 6: The interactive tray reveals what a new level draws

**Files:**
- Modify: `src/ui/tray.ts:154`
- Test: `tests/tray-reveal.test.ts`

**Interfaces:**
- Consumes: `Player.previewParams(overrides, { revealNew })` (`src/render/player.ts:447`); `withNewIdsVisible(planOrder: Set<string>, newOrder: string[], visible: ReadonlySet<string>): Set<string>` exported from `src/render/params.ts` (imported by `src/render/index.ts:9`)

- [ ] **Step 1: Write the failing test**

Create `tests/tray-reveal.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { withNewIdsVisible } from "../src/render/params";

describe("revealing ids a preview mints", () => {
  test("ids absent from the plan-time layout become visible; ids the plan knew but hid stay hidden", () => {
    const planTime = new Set(["body_outline", "hand_left", "femur_left", "heart"]);
    const previewed = ["body_outline", "carpals_left", "metacarpals_left", "femur_left", "heart"];
    const visible = new Set(["body_outline", "femur_left"]); // the storyboard has not drawn the heart yet
    const out = withNewIdsVisible(planTime, previewed, visible);
    expect(out.has("carpals_left")).toBe(true);
    expect(out.has("metacarpals_left")).toBe(true);
    expect(out.has("heart"), "known at plan time and deliberately hidden — stays hidden").toBe(false);
    expect(out.has("body_outline")).toBe(true);
  });

  test("the tray's slider repaint asks for that reveal", () => {
    // A source-level pin: the one-line fix that makes anatomy's detail slider
    // do anything. If someone drops the option again, this fails with a
    // message that says why it was there.
    const src = readFileSync("src/ui/tray.ts", "utf8");
    expect(src, "previewParams must pass { revealNew: true } — templates whose element set depends on a param (anatomy's detail) mint ids the plan never drew").toMatch(/previewParams\(overrides,\s*\{\s*revealNew:\s*true\s*\}\)/);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/tray-reveal.test.ts`
Expected: FAIL on the second test — the source pin does not match. (The first test should already pass: `withNewIdsVisible` is exported from `src/render/params.ts`; if it is not, export it there.)

- [ ] **Step 3: The fix**

In `src/ui/tray.ts` line 154, change `hd.timeline.previewParams(overrides);` to:

```ts
      // revealNew: a template whose element SET depends on a param (anatomy's
      // detail, chess's free play) mints ids the plan never drew. Without the
      // flag the preview rebuilds only what is already visible — so the
      // anatomy detail slider changed nothing on screen. Measured against the
      // plan-time layout, so ids the storyboard deliberately hides stay hidden.
      hd.timeline.previewParams(overrides, { revealNew: true });
```

- [ ] **Step 4: Run, full suite, commit**

Run: `npx vitest run tests/tray-reveal.test.ts && npx vitest run && npx tsc --noEmit`
Expected: PASS everywhere. If a chess or data-pack tray test breaks, the reveal changed a preview it depends on — read that test's expectation before touching anything; the reveal is meant to be additive (more ids visible, never fewer).

```bash
git add src/ui/tray.ts tests/tray-reveal.test.ts
git commit -m "The interactive tray reveals ids a new detail level mints — the anatomy slider now changes the figure"
```

---

## Task 7: Five examples, the docs, and the merge

**Files:**
- Modify: `src/examples.json`, `src/scenes/anatomy/README.md`, `ROADMAP.md`
- Test: `tests/anatomy-template.test.ts` (the count)

- [ ] **Step 1: Bump the example count test**

In `tests/anatomy-template.test.ts`, `"drawcast ships four anatomy examples"` becomes `"drawcast ships nine anatomy examples"` with `.toBe(9)`. Run it: FAIL with 4.

- [ ] **Step 2: Add the five examples**

Append to `src/examples.json` (before the closing `]`). Ids named in `draw` must exist at each example's own detail/layer/focus; the element list at `detail: 2`, `layer: superficial` is the round-1 list plus `esophagus`/`aorta`/`adrenal_*` only at detail 3.

```json
{
  "request": "Show the human body with its organs, and name them.",
  "packs": ["anatomy"],
  "spec": {
    "title": "The body, named",
    "template": "anatomy",
    "params": { "systems": ["viscera"], "detail": 2, "labels": "all" },
    "commands": [
      { "draw": ["body_outline", "brain", "trachea", "lung_right", "lung_left", "heart"], "speak": "A body from the front. The chest: two lungs around the heart, the windpipe above." },
      { "draw": ["liver", "stomach", "spleen", "pancreas", "kidney_right", "kidney_left", "small_intestine", "large_intestine", "bladder"], "speak": "The belly: liver to the right, stomach to the left, the gut in the middle, kidneys behind, bladder at the bottom." },
      { "draw": ["label_brain", "label_lung_right", "label_lung_left", "label_heart", "label_trachea", "label_liver", "label_stomach", "label_spleen", "label_pancreas", "label_kidney_right", "label_kidney_left", "label_small_intestine", "label_large_intestine", "label_bladder"], "speak": "And their names, the way an anatomical plate would give them." },
      { "quiz": { "question": "Which organ lies highest in the belly on the body's right?", "choices": ["The liver", "The spleen", "The bladder"], "correct": 1, "right": "The liver — tucked up under the right ribs, the largest gland in the body." } }
    ]
  }
},
{
  "request": "What lies behind the intestines?",
  "packs": ["anatomy"],
  "spec": {
    "title": "What lies behind",
    "template": "anatomy",
    "params": { "systems": ["viscera"], "detail": 2, "labels": "none" },
    "commands": [
      { "draw": ["body_outline", "lung_right", "lung_left", "heart", "liver", "stomach", "small_intestine", "large_intestine", "bladder"], "speak": "Seen from the front, the gut, the liver and the stomach fill the belly." },
      { "draw": ["kidney_right", "kidney_left", "spleen", "pancreas"], "speak": "Behind them, drawn with a broken line because they are hidden, lie four more organs." },
      { "quiz": { "question": "Which pair sits behind the gut, either side of the spine?", "choices": ["The lungs", "The kidneys", "The adrenal glands only"], "correct": 2, "right": "The kidneys — retroperitoneal, at the level of the lowest ribs." } },
      { "ask": { "question": "Click on the left kidney.", "widget": "click", "answer": "kidney_left", "right": "That is the left kidney, a little higher than the right one, which the liver pushes down." } }
    ]
  }
},
{
  "request": "Lær meg de latinske navnene på knoklene i beinet.",
  "packs": ["anatomy"],
  "spec": {
    "title": "Latinske navn",
    "template": "anatomy",
    "params": { "systems": ["skeleton"], "detail": 2, "focus": ["leg_left"], "labels": "all", "names": "la" },
    "commands": [
      { "draw": ["frame", "femur_left", "label_femur_left"], "speak": "Lårbeinet heter os femoris, kroppens lengste knokkel." },
      { "draw": ["patella_left", "label_patella_left", "tibia_left", "label_tibia_left", "fibula_left", "label_fibula_left"], "speak": "Kneskålen er patella, skinnebeinet tibia og det tynne leggbeinet fibula." },
      { "draw": ["tarsals_left", "metatarsals_left", "phalanges_foot_left", "hip_left", "knee_left", "ankle_left"], "speak": "Fotrotsbeina heter ossa tarsi, mellomfotsbeina ossa metatarsi, og tåbeina phalanges pedis." },
      { "ask": { "question": "Hva heter lårbeinet på latin?", "answer": "Os femoris", "right": "Os femoris — femur er lår." } },
      { "ask": { "question": "Og skinnebeinet?", "answer": "Tibia", "right": "Tibia, det bærende beinet i leggen." } }
    ]
  }
},
{
  "request": "Draw the skeleton in plain ink and quiz me on it.",
  "packs": ["anatomy"],
  "spec": {
    "title": "The skeleton in ink",
    "template": "anatomy",
    "params": { "systems": ["skeleton"], "detail": 2, "color": "mono", "outline": "line", "labels": "none" },
    "commands": [
      { "draw": ["body_outline", "cranium", "mandible", "cervical_vertebrae", "thoracic_vertebrae", "lumbar_vertebrae", "sacrum", "ribs", "sternum"], "speak": "The axial skeleton: skull, spine, rib cage, in plain ink." },
      { "draw": ["clavicle_left", "clavicle_right", "scapula_left", "scapula_right", "humerus_left", "humerus_right", "radius_left", "ulna_left", "radius_right", "ulna_right", "hand_left", "hand_right"], "speak": "The arms hang from the shoulder girdle." },
      { "draw": ["hip_bones", "femur_left", "femur_right", "patella_left", "patella_right", "tibia_left", "fibula_left", "tibia_right", "fibula_right", "foot_left", "foot_right"], "speak": "And the legs from the pelvis." },
      { "quiz": { "question": "How many bones does one hand have?", "choices": ["14", "27", "52"], "correct": 2, "right": "27 — eight carpals, five metacarpals and fourteen phalanges." } },
      { "ask": { "question": "Click on the sternum.", "widget": "click", "answer": "sternum", "right": "The sternum, the breastbone, where the ribs meet in front." } }
    ]
  }
},
{
  "request": "Zoom inn på hånden og vis knoklene.",
  "packs": ["anatomy"],
  "spec": {
    "title": "Inne i hånden",
    "template": "anatomy",
    "params": { "systems": ["skeleton"], "focus": ["hand_left"], "labels": "focus", "names": "nb", "detail": 2 },
    "commands": [
      { "draw": ["frame", "carpals_left", "label_carpals_left"], "speak": "Håndrotsbeina, åtte små knokler i to rader." },
      { "draw": ["metacarpals_left", "label_metacarpals_left"], "speak": "Så de fem mellomhåndsbeina." },
      { "draw": ["phalanges_hand_left", "label_phalanges_hand_left", "wrist_left"], "speak": "Og fingerbeina, tre i hver finger, to i tommelen." },
      { "ask": { "question": "Klikk på håndrotsbeina.", "widget": "click", "answer": "carpals_left", "right": "Håndrotsbeina — de ligger i håndleddet, mellom underarmen og mellomhånden." } },
      { "ask": { "question": "Klikk på fingerbeina.", "widget": "click", "answer": "phalanges_hand_left", "right": "Fingerbeina, phalanges — fjorten i alt." } }
    ]
  }
}
```

If the hand example's `wrist_left` joint is cropped out of the `hand_left` focus (its parent is `arm_left`, not `hand_left`), drop it from the `draw` list. If any label collides in the Latin leg example, switch that example to `labels: "focus"` with `highlight` on the four named bones.

- [ ] **Step 3: Run the guards**

Run: `npx vitest run tests/examples.test.ts tests/molecule3d.test.ts tests/anatomy-template.test.ts`
Expected: PASS. Each failure names the example and the rule; fix the example, not the rule.

- [ ] **Step 4: Docs**

Rewrite `src/scenes/anatomy/README.md` around the new pipeline (source, cache, the part table as the thing to edit, `CELL`/`TOL` as the knobs, the preview loop, the licence directory, the reserve). In `ROADMAP.md`'s anatomy block, replace the "Concave region silhouettes" item's neighbour list with: **coccyx and thyroid** (absent from BodyParts3D 3.0 — authored blobs or another source), **a female body** (the uterus is authored; BodyParts3D 4.0 or Z-Anatomy for a second body), and keep sound, 3D (now Part 3 of round 2), multi-target asks, posterior view.

- [ ] **Step 5: Full suite, build, commit**

Run: `npx vitest run && npx tsc --noEmit && npm run build`
Expected: all green.

```bash
git add src/examples.json src/scenes/anatomy/README.md ROADMAP.md tests/anatomy-template.test.ts
git commit -m "Five more anatomy examples, and the atlas README for the mesh pipeline"
```

- [ ] **Step 6: Merge and push (Hans's rule: push after each part)**

From the main checkout: `git checkout main && git pull --ff-only && git merge --no-ff worktree-anatomy-2`, resolve `src/examples.json` by appending if main gained examples meanwhile, run `npm install && npx vitest run`, then `git push origin main && git ls-remote origin refs/heads/main`. Remove the worktree and branch. Tell Hans what to look at in the app: the default skin ground, the deep layer, the detail slider, the rounded bones, and whether the roughness constant (0.7) suits him.

---

## Self-Review

**Spec coverage (Part 1).** Licence layout → Task 3 Step 2 and the pack description in Task 5. Pipeline steps 1–9 → Tasks 1–3 (STL parse, mask+contour, catalogue+fetch+part table, build with frame/depth/hulls/joints/skin/authored uterus/preview). Smoothing → Task 4 (kit) + Task 5. `outline` skin/line/none incl. focus clipping → Task 5. `layer` and dashed `behind` → Task 5 (atlas fields from Task 3). Colours → unchanged. No new drawing library; roughness 0.7 → Tasks 4–5. Tray reveal → Task 6. Five examples → Task 7. Tests listed in the spec → Tasks 1, 3, 5, 6. Reserve kept → Task 3 Step 4.

**Type consistency.** `AtlasPart.source/layer/behind` (Task 3 Step 1) are what Task 3's `record()` writes and Task 5 reads. `Mask.rings()` returns `{outer, holes}` in atlas units (Task 1) and the build simplifies them into `AtlasRing` (Task 3). `elementsFor` spec fields (`fma`, `composite`, `side`, `filter`, `exclude`) match the part table's keys (Task 2). `kit.smoothClosed(ring, 4)` (Task 4) is what `SM` calls (Task 5) and what the ×4 test asserts. `previewParams(overrides, { revealNew: true })` (Task 6) matches `player.ts:447`.

**Known soft spots, flagged:**

1. **The first build downloads ~150 MB** (skin 79 MB, brain gyri, rib cage). It needs the network and patience; the cache makes every later run offline.
2. **Sided hand/foot sets rely on element NAMES containing "right"/"left".** The catalogue test pins the rule; if a set names sides differently ("dexter"), that part will project to nothing and the build will say which.
3. **Skin holes.** Where an arm touches the torso the mask may bridge or split; `CELL` is the knob and the preview the judge.
4. **Label plates get longer** (esophagus, aorta, adrenals at detail 3 add rows only at detail 3; at detail 2 the list is the round-1 list plus none). Task 5 Step 5 says what to do if the columns overflow.
5. **The uterus is placed by rule** (62 % down the hip bones' box). Hans's eye on the female view decides whether the rule is right.
