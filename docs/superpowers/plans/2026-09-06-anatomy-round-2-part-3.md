# Anatomy round 2, part 3 — the 3D panel: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The anatomy figure gets the ⬡ 3D button molecules have: the same body in WebGL, one clickable mesh per drawn part, a peel slider, Front/Side/Back presets, and the DBCLS credit.

**Architecture:** A build script turns the cached BodyParts3D STL files into a small mesh pack in `public/anatomy3d/` (one decimated `.bin` per part plus `index.json`); the app's `openModel3d` grows an anatomy branch that asks the atlas engine which parts the figure shows, fetches those files, and feeds each to 3dmol's `addCustom` with the figure's colours. The rules (which parts, what opacity a peel value gives, the wire format) live in pure, node-tested modules; 3dmol is reached only through the existing `Model3dViewer` boundary, so tests use stubs exactly like `tests/model3d.test.ts` does today.

**Tech Stack:** TypeScript, Vite, Vitest; 3dmol 2.5.5 (already a dependency, lazily imported); Node ESM build scripts under `scripts/anatomy/` (with `.d.mts` siblings so tests can import them under tsc).

**Spec:** `docs/superpowers/specs/2026-09-06-anatomy-round-2-design.md`, "Part 3 — the 3D panel". Parts 1 and 2 are merged (3602aa2, be5a028).

## Global Constraints

- Code stays MIT; everything derived from BodyParts3D — here `public/anatomy3d/` — carries its own `LICENSE` (CC BY-SA 2.1 Japan) and `ATTRIBUTION.md`, and the attribution line is SHOWN as the panel's footer: `Meshes: BodyParts3D, © The Database Center for Life Science, CC BY-SA 2.1 Japan`.
- The STL cache `.cache/bodyparts3d/` is gitignored and never committed. The mesh build reads it and fetches what it lacks through `scripts/anatomy/bp3d.mjs` exactly as the atlas build does.
- Whole pack ≤ 200 000 triangles. Per-part budgets are measured after the first build; tests pin the measured totals plus ~30 % headroom, never a number that merely passes.
- Every part vertex count stays under 64 000 (3dmol's `faceArray` is `Uint16Array` per geometry group; it splits bigger meshes, but a part that needs splitting is a part that is too big).
- Pack coordinates are **centimetres**, not the spec's metres: (X, Y, Z) = ((x − cx), (z − cz), −(y − cy)) / 10 with (cx, cy, cz) the skin's bbox centre in BodyParts3D mm. Patient's left → +X (screen right when facing the body), up → +Y, anterior → +Z (toward the camera). A 170-unit body sits where 3dmol's camera, slab and picking are tuned (large molecules are 100–200 Å); a 1.7-unit body does not. The mapping matrix has determinant +1, so face winding survives.
- No new npm dependency.
- Worktree per part (Hans): work on branch `worktree-anatomy-3d`, merge `--no-ff` into main, push after the merge. Commit messages end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_017oPwciUjNwjDkJSy9R8ams`. Never `git add -A`; another session edits files in the main checkout.
- Bundled examples must lint clean (zero issues) and pass `lintCommands`; `draw` takes an ARRAY of ids.
- Look at the panel in a browser before calling the round done (Task 5 has the smoke).

---

## File map

| File | Responsibility |
|---|---|
| `scripts/anatomy/mesh.mjs` (+ `mesh.d.mts`) | Pure mesh tools: BodyParts3D → pack coordinates, vertex clustering, budget loop, `.bin` encoder. |
| `scripts/build-anatomy-meshes.mjs` | The build: part table + cache → `public/anatomy3d/*.bin`, `index.json`, licence files. Prints the numbers. |
| `public/anatomy3d/` | The mesh pack (committed), `LICENSE`, `ATTRIBUTION.md`. |
| `src/ui/anatomy3d.ts` | Browser-side pure rules: `.bin` decoder, `visibleParts` (the figure's leaf rule for 3D), `peelOpacity`, `toCustomShape`, `packUrl`. |
| `src/ui/model3d.ts` | `Model3dQuery` gains the anatomy kind; `qualifiesFor3d` recognises it; `openModel3d` grows the anatomy branch and the `AnatomyScene` handle. |
| `src/scenes/types.ts`, `src/scenes/doc.ts` | `manifest.model3d` accepts `{ kind: "anatomy" }`. |
| `src/scenes/packs/anatomy.yaml` | `model3d: { kind: anatomy }`, one description sentence. |
| `src/main.ts`, `src/styles.css` | Dialog controls for the anatomy kind: peel slider, Front/Side/Back, name caption, credit footer. |
| `src/examples.json` | The "See it in 3D" example. |
| `src/scenes/anatomy/README.md`, `ROADMAP.md` | Docs. |
| Tests | `tests/anatomy-mesh.test.ts`, `tests/anatomy3d.test.ts`, `tests/anatomy3d-pack.test.ts`, additions to `tests/model3d.test.ts`, `tests/anatomy-template.test.ts` (example count → 11). |

---

### Task 1: Mesh tools and the wire format

**Files:**
- Create: `scripts/anatomy/mesh.mjs`, `scripts/anatomy/mesh.d.mts`
- Create: `src/ui/anatomy3d.ts` (the decoder only, for now)
- Test: `tests/anatomy-mesh.test.ts`

**Interfaces:**
- Produces (`scripts/anatomy/mesh.mjs`):
  - `toPack(positions: Float32Array, centre: [number, number, number]): Float32Array` — BodyParts3D mm triangles (9 floats per triangle) → pack cm, same layout.
  - `clusterMesh(positions: Float32Array, cell: number): { positions: Float32Array; indices: Uint32Array; triangles: number }` — snap every vertex to a `cell`-sized grid, merge equal cells, drop triangles with two equal vertices.
  - `decimateToBudget(positions: Float32Array, cell: number, budget: number): { mesh: ReturnType<typeof clusterMesh>; cell: number }` — cluster at `cell`; while triangles > budget, cell ×= 1.25 and redo.
  - `encodeMesh(mesh: { positions: Float32Array; indices: Uint32Array }): Uint8Array` — the `.bin` format below.
  - `bboxOfMesh(positions: Float32Array): [number, number, number, number, number, number]`.
- Produces (`src/ui/anatomy3d.ts`): `decodeMesh(buf: ArrayBuffer): { positions: Float32Array; indices: Uint16Array | Uint32Array; triangles: number }` — throws on a bad magic or a length mismatch.

**The `.bin` format** (little-endian): bytes 0–3 ASCII `DCM1`; 4–7 uint32 vertex count; 8–11 uint32 index count; 12–15 uint32 flags (bit 0 set → Uint32 indices, clear → Uint16); then Float32 positions (3 per vertex); then the indices; zero-padded to a multiple of 4 bytes. Uint16 is used whenever vertex count ≤ 65 535.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/anatomy-mesh.test.ts
import { describe, expect, test } from "vitest";
import { bboxOfMesh, clusterMesh, decimateToBudget, encodeMesh, toPack } from "../scripts/anatomy/mesh.mjs";
import { decodeMesh } from "../src/ui/anatomy3d";

/** A unit cube as 12 raw triangles (36 vertices), BodyParts3D style: 9 floats per triangle. */
function cube(size = 10, at: [number, number, number] = [0, 0, 0]): Float32Array {
  const [ox, oy, oz] = at;
  const v = (x: number, y: number, z: number) => [ox + x * size, oy + y * size, oz + z * size];
  const quads: [number[], number[], number[], number[]][] = [
    [v(0, 0, 0), v(1, 0, 0), v(1, 1, 0), v(0, 1, 0)], // back
    [v(0, 0, 1), v(1, 0, 1), v(1, 1, 1), v(0, 1, 1)], // front
    [v(0, 0, 0), v(0, 1, 0), v(0, 1, 1), v(0, 0, 1)], // left
    [v(1, 0, 0), v(1, 1, 0), v(1, 1, 1), v(1, 0, 1)], // right
    [v(0, 0, 0), v(1, 0, 0), v(1, 0, 1), v(0, 0, 1)], // bottom
    [v(0, 1, 0), v(1, 1, 0), v(1, 1, 1), v(0, 1, 1)], // top
  ];
  const out: number[] = [];
  for (const [a, b, c, d] of quads) out.push(...a, ...b, ...c, ...a, ...c, ...d);
  return new Float32Array(out);
}

describe("toPack: BodyParts3D mm → pack cm, re-centred, z up, anterior toward the camera", () => {
  test("a point 100 mm to the patient's left, 50 mm posterior, 200 mm up → (10, 20, −5)", () => {
    const p = toPack(new Float32Array([100, 50, 200, 0, 0, 0, 0, 0, 0]), [0, 0, 0]);
    expect([p[0], p[1], p[2]]).toEqual([10, 20, -5]);
  });
  test("the centre lands at the origin", () => {
    const p = toPack(new Float32Array([30, 40, 50, 0, 0, 0, 0, 0, 0]), [30, 40, 50]);
    expect([p[0], p[1], p[2]]).toEqual([0, 0, 0]);
  });
});

describe("clusterMesh", () => {
  test("a cube's 36 raw vertices become 8 shared vertices and 12 faces", () => {
    const m = clusterMesh(cube(), 1);
    expect(m.positions.length / 3).toBe(8);
    expect(m.triangles).toBe(12);
    expect(m.indices.length).toBe(36);
    expect(Math.max(...m.indices)).toBe(7);
  });
  test("a coarse grid collapses the cube and drops the degenerate faces", () => {
    const m = clusterMesh(cube(10), 100); // every vertex snaps to the same cell
    expect(m.triangles).toBe(0);
    expect(m.indices.length).toBe(0);
  });
  test("clustering is deterministic", () => {
    const a = clusterMesh(cube(7, [3, 3, 3]), 2);
    const b = clusterMesh(cube(7, [3, 3, 3]), 2);
    expect(Array.from(a.indices)).toEqual(Array.from(b.indices));
    expect(Array.from(a.positions)).toEqual(Array.from(b.positions));
  });
});

describe("decimateToBudget", () => {
  test("stays at the base cell when already under budget", () => {
    const { mesh, cell } = decimateToBudget(cube(), 1, 100);
    expect(cell).toBe(1);
    expect(mesh.triangles).toBe(12);
  });
  test("grows the cell until the budget holds", () => {
    // Two cubes 6 apart: at cell 1 → 24 faces; the budget of 12 forces merging.
    const two = new Float32Array([...cube(4, [0, 0, 0]), ...cube(4, [6, 0, 0])]);
    const { mesh, cell } = decimateToBudget(two, 1, 12);
    expect(mesh.triangles).toBeLessThanOrEqual(12);
    expect(cell).toBeGreaterThan(1);
  });
});

describe("the .bin format round-trips", () => {
  test("encode → decode gives back the same vertices and faces (Uint16 for a small mesh)", () => {
    const m = clusterMesh(cube(3, [1, 2, 3]), 0.5);
    const bytes = encodeMesh(m);
    expect(String.fromCharCode(...bytes.slice(0, 4))).toBe("DCM1");
    expect(bytes.length % 4).toBe(0);
    const back = decodeMesh(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    expect(back.indices).toBeInstanceOf(Uint16Array);
    expect(Array.from(back.positions)).toEqual(Array.from(m.positions));
    expect(Array.from(back.indices)).toEqual(Array.from(m.indices));
    expect(back.triangles).toBe(12);
  });
  test("a mesh with more than 65 535 vertices is written with Uint32 indices", () => {
    const n = 65_540;
    const positions = new Float32Array(n * 3).map((_, i) => i);
    const indices = new Uint32Array([0, 1, 2, n - 3, n - 2, n - 1]);
    const back = decodeMesh(encodeMesh({ positions, indices }).buffer);
    expect(back.indices).toBeInstanceOf(Uint32Array);
    expect(Array.from(back.indices)).toEqual([0, 1, 2, n - 3, n - 2, n - 1]);
  });
  test("a wrong magic is refused", () => {
    const bytes = encodeMesh(clusterMesh(cube(), 1));
    bytes[0] = 88;
    expect(() => decodeMesh(bytes.buffer)).toThrow(/DCM1/);
  });
  test("a truncated file is refused", () => {
    const bytes = encodeMesh(clusterMesh(cube(), 1));
    expect(() => decodeMesh(bytes.buffer.slice(0, bytes.length - 8))).toThrow(/length/);
  });
});

describe("bboxOfMesh", () => {
  test("min and max of a cube at (1,2,3) with side 4", () => {
    expect(bboxOfMesh(clusterMesh(cube(4, [1, 2, 3]), 1).positions)).toEqual([1, 2, 3, 5, 6, 7]);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run tests/anatomy-mesh.test.ts`
Expected: FAIL — cannot resolve `../scripts/anatomy/mesh.mjs` / `../src/ui/anatomy3d`.

- [ ] **Step 3: Write the mesh tools**

```js
// scripts/anatomy/mesh.mjs
// Pure mesh tools for the 3D pack: BodyParts3D millimetres → pack centimetres,
// vertex clustering (the decimation), and the .bin writer. Node-tested; the
// browser-side reader lives in src/ui/anatomy3d.ts and shares the format.

/** BodyParts3D mm (x left, y posterior, z up) → pack cm re-centred: X = x, Y = z, Z = −y. */
export function toPack(positions, centre) {
  const [cx, cy, cz] = centre;
  const out = new Float32Array(positions.length);
  for (let i = 0; i < positions.length; i += 3) {
    out[i] = (positions[i] - cx) / 10;
    out[i + 1] = (positions[i + 2] - cz) / 10;
    out[i + 2] = -(positions[i + 1] - cy) / 10;
  }
  return out;
}

/** Snap vertices to a grid of `cell`, merge equal cells, drop degenerate faces. */
export function clusterMesh(positions, cell) {
  const key = new Map();
  const verts = [];
  const indices = [];
  const snap = (v) => Math.round(v / cell);
  const indexOf = (x, y, z) => {
    const kx = snap(x), ky = snap(y), kz = snap(z);
    const k = `${kx},${ky},${kz}`;
    let idx = key.get(k);
    if (idx === undefined) {
      idx = verts.length / 3;
      key.set(k, idx);
      verts.push(kx * cell, ky * cell, kz * cell);
    }
    return idx;
  };
  for (let i = 0; i < positions.length; i += 9) {
    const a = indexOf(positions[i], positions[i + 1], positions[i + 2]);
    const b = indexOf(positions[i + 3], positions[i + 4], positions[i + 5]);
    const c = indexOf(positions[i + 6], positions[i + 7], positions[i + 8]);
    if (a === b || b === c || a === c) continue;
    indices.push(a, b, c);
  }
  // Vertices only degenerate faces referenced are dropped, so counts stay honest.
  const used = new Uint8Array(verts.length / 3);
  for (const i of indices) used[i] = 1;
  const remap = new Int32Array(used.length).fill(-1);
  const kept = [];
  for (let i = 0; i < used.length; i++) if (used[i]) { remap[i] = kept.length / 3; kept.push(verts[i * 3], verts[i * 3 + 1], verts[i * 3 + 2]); }
  return { positions: new Float32Array(kept), indices: Uint32Array.from(indices, (i) => remap[i]), triangles: indices.length / 3 };
}

/** Cluster at `cell`, growing it by a quarter until the triangle budget holds. */
export function decimateToBudget(positions, cell, budget) {
  let c = cell;
  let mesh = clusterMesh(positions, c);
  while (mesh.triangles > budget) {
    c *= 1.25;
    mesh = clusterMesh(positions, c);
  }
  return { mesh, cell: c };
}

export function bboxOfMesh(positions) {
  const bb = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) for (let a = 0; a < 3; a++) {
    const v = positions[i + a];
    if (v < bb[a]) bb[a] = v;
    if (v > bb[a + 3]) bb[a + 3] = v;
  }
  return bb;
}

/** DCM1 | u32 vertices | u32 indices | u32 flags (bit 0: u32 indices) | f32×3 per vertex | indices | pad to 4. */
export function encodeMesh({ positions, indices }) {
  const nv = positions.length / 3;
  const wide = nv > 65535;
  const idxBytes = indices.length * (wide ? 4 : 2);
  const total = Math.ceil((16 + positions.length * 4 + idxBytes) / 4) * 4;
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  out.set([0x44, 0x43, 0x4d, 0x31], 0); // "DCM1"
  dv.setUint32(4, nv, true);
  dv.setUint32(8, indices.length, true);
  dv.setUint32(12, wide ? 1 : 0, true);
  for (let i = 0; i < positions.length; i++) dv.setFloat32(16 + i * 4, positions[i], true);
  const o = 16 + positions.length * 4;
  for (let i = 0; i < indices.length; i++) wide ? dv.setUint32(o + i * 4, indices[i], true) : dv.setUint16(o + i * 2, indices[i], true);
  return out;
}
```

```ts
// scripts/anatomy/mesh.d.mts
export interface ClusteredMesh { positions: Float32Array; indices: Uint32Array; triangles: number }
export function toPack(positions: Float32Array, centre: [number, number, number]): Float32Array;
export function clusterMesh(positions: Float32Array, cell: number): ClusteredMesh;
export function decimateToBudget(positions: Float32Array, cell: number, budget: number): { mesh: ClusteredMesh; cell: number };
export function bboxOfMesh(positions: Float32Array): [number, number, number, number, number, number];
export function encodeMesh(mesh: { positions: Float32Array; indices: Uint32Array | Uint16Array }): Uint8Array;
```

```ts
// src/ui/anatomy3d.ts — the decoder (more arrives in Task 3)
// The 3D body: pure rules the anatomy branch of openModel3d relies on. No DOM,
// no 3dmol — node tests cover everything here.

export interface PackMesh { positions: Float32Array; indices: Uint16Array | Uint32Array; triangles: number }

/** Reads a mesh-pack .bin (format: scripts/anatomy/mesh.mjs encodeMesh). */
export function decodeMesh(buf: ArrayBuffer): PackMesh {
  const dv = new DataView(buf);
  if (buf.byteLength < 16 || String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3)) !== "DCM1") {
    throw new Error("not a DCM1 mesh file");
  }
  const nv = dv.getUint32(4, true);
  const ni = dv.getUint32(8, true);
  const wide = (dv.getUint32(12, true) & 1) === 1;
  const posBytes = nv * 12;
  const need = 16 + posBytes + ni * (wide ? 4 : 2);
  if (buf.byteLength < need) throw new Error(`mesh file length ${buf.byteLength} is short of the ${need} bytes its header promises`);
  // Copy out of the buffer: the index block may start at an odd multiple of 2 for Uint32 views.
  const positions = new Float32Array(buf.slice(16, 16 + posBytes));
  const idxBuf = buf.slice(16 + posBytes, need);
  const indices = wide ? new Uint32Array(idxBuf) : new Uint16Array(idxBuf);
  return { positions, indices, triangles: ni / 3 };
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/anatomy-mesh.test.ts` — Expected: PASS (11 tests). Then `npx tsc --noEmit` — Expected: clean (the `.d.mts` makes the `.mjs` import typed).

- [ ] **Step 5: Commit**

```bash
git add scripts/anatomy/mesh.mjs scripts/anatomy/mesh.d.mts src/ui/anatomy3d.ts tests/anatomy-mesh.test.ts
git commit -F <message file>   # "Mesh tools for the 3D pack: pack coordinates, vertex clustering, the DCM1 wire format"
```

---

### Task 2: The build script and the committed mesh pack

**Files:**
- Create: `scripts/build-anatomy-meshes.mjs`
- Create: `public/anatomy3d/LICENSE`, `public/anatomy3d/ATTRIBUTION.md` (copies of `src/scenes/anatomy/atlas/LICENSE` and `ATTRIBUTION.md`, the latter with one added line: "The meshes in this directory are decimated copies of the BodyParts3D 3.0 STL files, re-centred and scaled to centimetres.")
- Create (generated): `public/anatomy3d/index.json`, `public/anatomy3d/*.bin`
- Modify: `.gitattributes` (create if absent) — `public/anatomy3d/*.bin binary`
- Test: `tests/anatomy3d-pack.test.ts`

**Interfaces:**
- Consumes: `SKIN, BONES, REGIONS, VISCERA` from `assets/anatomy-sources/bodyparts.mjs`; `fetchCatalogue, fetchStl, elementsFor` from `scripts/anatomy/bp3d.mjs`; `parseStl` from `scripts/anatomy/stl.mjs`; Task 1's `mesh.mjs`.
- Produces `public/anatomy3d/index.json`:

```json
{
  "version": 1,
  "units": "cm",
  "source": "BodyParts3D, © The Database Center for Life Science licensed under CC Attribution-Share Alike 2.1 Japan (release 3.0)",
  "parts": {
    "liver":   { "files": ["liver.bin"], "triangles": 3980, "bytes": 51234, "bbox": [-4.1, 2.0, -3.2, 12.8, 16.5, 9.0], "system": "viscera", "kind": "organ", "color": "#8a5a3c", "layer": "superficial" },
    "skull":   { "files": ["cranium.bin", "mandible.bin"], "triangles": 5300, "bytes": 0, "bbox": [...], "system": "skeleton", "kind": "region", "color": "#e6dcc4" },
    "body_outline": { "files": ["body_outline.bin"], "triangles": 19800, "bytes": 0, "bbox": [...], "system": "skeleton", "kind": "outline", "color": "#f1dccb" }
  }
}
```

  Bones and organs: one file each. Regions: `files` lists their bones' files (no file of their own, so the pack holds every triangle once). Skin: `body_outline.bin`. Joints, groups and the authored uterus have no entry. `color` is the atlas part's colour, else the system default (`#e6dcc4` skeleton, `#c9a15f` viscera, `#f1dccb` skin) — the same three literals as the template's `SYSTEM_COLOR`/`SKIN`.

**Budgets** (triangles): skin 20 000; every other part `clamp(round(diagonal_cm × 100), 400, 4000)` where the diagonal is the part's own bbox diagonal in cm — a femur (≈ 45 cm) gets 4 000, a lumbar vertebra (≈ 6 cm) 600, a carpal 400. Base cells: 2 mm bones, 3 mm organs, 6 mm skin; `decimateToBudget` grows them as needed and the build prints the final cell per part.

- [ ] **Step 1: Write the pack test (it fails until the pack exists)**

```ts
// tests/anatomy3d-pack.test.ts
import { existsSync, readFileSync, statSync } from "node:fs";
import { describe, expect, test } from "vitest";
import index from "../public/anatomy3d/index.json";
import skeleton from "../src/scenes/anatomy/atlas/atlas-skeleton.json";
import viscera from "../src/scenes/anatomy/atlas/atlas-viscera.json";
import body from "../src/scenes/anatomy/atlas/atlas-body.json";
import type { Atlas, AtlasPart } from "../src/scenes/anatomy/types";
import { decodeMesh } from "../src/ui/anatomy3d";
import anatomyYaml from "../src/scenes/packs/anatomy.yaml?raw";

const PACK = "public/anatomy3d";
type Entry = { files: string[]; triangles: number; bytes: number; bbox: number[]; system: string; kind: string; color: string; layer?: string };
const parts = index.parts as Record<string, Entry>;
const ATLAS: Record<string, AtlasPart> = { ...(body as unknown as Atlas).parts, ...(skeleton as unknown as Atlas).parts, ...(viscera as unknown as Atlas).parts };

describe("the mesh pack matches the atlas", () => {
  test("every measured bone, organ, region and the skin has an entry; joints, groups and the authored uterus do not", () => {
    for (const [id, p] of Object.entries(ATLAS)) {
      const expected = p.source === "bodyparts3d" && (p.kind === "bone" || p.kind === "organ" || p.kind === "region" || p.kind === "outline");
      expect(id in parts, id).toBe(expected);
    }
  });
  test("every listed file exists, decodes, and has the triangles the index claims (regions sum their bones)", () => {
    const own = new Map<string, number>();
    for (const [id, e] of Object.entries(parts)) {
      if (e.kind === "region") continue;
      expect(e.files).toEqual([`${id}.bin`]);
      const path = `${PACK}/${e.files[0]}`;
      expect(existsSync(path), path).toBe(true);
      const bytes = readFileSync(path);
      const m = decodeMesh(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
      expect(m.triangles).toBe(e.triangles);
      expect(m.positions.length / 3).toBeLessThan(64_000);
      expect(statSync(path).size).toBe(e.bytes);
      own.set(e.files[0], m.triangles);
    }
    for (const e of Object.values(parts)) if (e.kind === "region") expect(e.triangles).toBe(e.files.reduce((s, f) => s + (own.get(f) ?? NaN), 0));
  });
  test("the whole pack stays under 200 000 triangles and its measured size plus headroom", () => {
    const total = Object.values(parts).filter((e) => e.kind !== "region").reduce((s, e) => s + e.triangles, 0);
    expect(total).toBeLessThanOrEqual(200_000);
    expect(total).toBeLessThanOrEqual(/* MEASURED × 1.3 — fill in after the first build */ 200_000);
  });
  test("units, colours and the licence files", () => {
    expect(index.units).toBe("cm");
    expect(index.source).toMatch(/CC Attribution-Share Alike 2\.1 Japan/);
    expect(existsSync(`${PACK}/LICENSE`)).toBe(true);
    expect(readFileSync(`${PACK}/ATTRIBUTION.md`, "utf8")).toMatch(/BodyParts3D/);
    // The three default colours are the template's own literals.
    for (const c of ["#e6dcc4", "#c9a15f", "#f1dccb"]) expect(anatomyYaml).toContain(c);
    expect(parts.body_outline.color).toBe("#f1dccb");
    expect(parts.femur_left.color).toBe("#e6dcc4");
    expect(parts.liver.color).toBe(ATLAS.liver.color);
  });
  test("the body is centimetres, upright and roughly 170 tall", () => {
    const [, y0, , , y1] = parts.body_outline.bbox;
    expect(y1 - y0).toBeGreaterThan(150);
    expect(y1 - y0).toBeLessThan(200);
    expect(Math.abs(y0 + y1)).toBeLessThan(5); // centred
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run tests/anatomy3d-pack.test.ts` — Expected: FAIL (no `public/anatomy3d/index.json`).

- [ ] **Step 3: Write the build script**

```js
// scripts/build-anatomy-meshes.mjs
// BodyParts3D meshes → the 3D pack in public/anatomy3d/: one decimated .bin
// per bone, organ and the skin, an index.json the app reads, and the licence
// files. Deterministic given the cache; run by hand, output checked in:
//   node scripts/build-anatomy-meshes.mjs
// Shares the STL cache (.cache/bodyparts3d/) with build-anatomy-atlas.mjs.

import { fileURLToPath } from "node:url";
import { mkdirSync, writeFileSync, readdirSync, unlinkSync, copyFileSync, readFileSync, statSync } from "node:fs";
import { parseStl } from "./anatomy/stl.mjs";
import { fetchCatalogue, fetchStl, elementsFor } from "./anatomy/bp3d.mjs";
import { toPack, decimateToBudget, encodeMesh, bboxOfMesh } from "./anatomy/mesh.mjs";
import { SKIN, BONES, REGIONS, VISCERA } from "../assets/anatomy-sources/bodyparts.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const CACHE = `${ROOT}.cache/bodyparts3d`;
const OUT = `${ROOT}public/anatomy3d`;
const ATLAS_DIR = `${ROOT}src/scenes/anatomy/atlas`;
const SOURCE = "BodyParts3D, © The Database Center for Life Science licensed under CC Attribution-Share Alike 2.1 Japan (release 3.0)";
// The template's own defaults (anatomy.yaml SYSTEM_COLOR / SKIN) — pinned by tests/anatomy3d-pack.test.ts.
const SYSTEM_COLOR = { skeleton: "#e6dcc4", viscera: "#c9a15f" };
const SKIN_COLOR = "#f1dccb";
const CELL_MM = { skeleton: 2, viscera: 3, skin: 6 };
const SKIN_BUDGET = 20000;
const budgetFor = (bbox) => {
  const d = Math.hypot(bbox[3] - bbox[0], bbox[4] - bbox[1], bbox[5] - bbox[2]);
  return Math.max(400, Math.min(4000, Math.round(d * 100)));
};
const log = (s) => console.log(s);

async function main() {
  const cat = await fetchCatalogue({ cacheDir: CACHE });
  const raw = async (label, spec) => {
    const chunks = [];
    for (const id of elementsFor(cat, spec)) {
      const bytes = await fetchStl(id, { cacheDir: CACHE, log });
      if (bytes) chunks.push(parseStl(bytes).positions);
    }
    if (chunks.length === 0) throw new Error(`${label}: no geometry`);
    const n = chunks.reduce((s, c) => s + c.length, 0);
    const all = new Float32Array(n);
    let o = 0;
    for (const c of chunks) { all.set(c, o); o += c.length; }
    return all;
  };

  // The skin sets the centre; everything is re-centred on it.
  const skinMm = await raw("skin", SKIN);
  const bb = bboxOfMesh(skinMm);
  const centre = [(bb[0] + bb[3]) / 2, (bb[1] + bb[4]) / 2, (bb[2] + bb[5]) / 2];
  log(`centre (mm): ${centre.map((v) => v.toFixed(0)).join(", ")}`);

  mkdirSync(OUT, { recursive: true });
  for (const f of readdirSync(OUT)) if (f.endsWith(".bin")) unlinkSync(`${OUT}/${f}`);

  const parts = {};
  let total = 0;
  const emit = (id, positionsMm, { system, kind, color, layer, cellMm, budget }) => {
    const packed = toPack(positionsMm, centre);
    const bbox = bboxOfMesh(packed);
    const { mesh, cell } = decimateToBudget(packed, cellMm / 10, budget ?? budgetFor(bbox));
    const bytes = encodeMesh(mesh);
    writeFileSync(`${OUT}/${id}.bin`, bytes);
    parts[id] = { files: [`${id}.bin`], triangles: mesh.triangles, bytes: bytes.length, bbox: bbox.map((v) => Math.round(v * 10) / 10), system, kind, color, ...(layer ? { layer } : {}) };
    total += mesh.triangles;
    log(`${id.padEnd(22)} ${String(positionsMm.length / 9).padStart(8)} → ${String(mesh.triangles).padStart(6)} tris  cell ${(cell * 10).toFixed(2)} mm  ${bytes.length} B`);
  };

  emit("body_outline", skinMm, { system: "skeleton", kind: "outline", color: SKIN_COLOR, cellMm: CELL_MM.skin, budget: SKIN_BUDGET });
  for (const b of BONES) emit(b.id, await raw(b.id, b), { system: "skeleton", kind: "bone", color: b.color ?? SYSTEM_COLOR.skeleton, cellMm: CELL_MM.skeleton });
  for (const o of VISCERA) emit(o.id, await raw(o.id, o), { system: "viscera", kind: "organ", color: o.color ?? SYSTEM_COLOR.viscera, layer: o.layer, cellMm: CELL_MM.viscera });
  for (const rg of REGIONS) {
    const files = rg.of.map((id) => `${id}.bin`);
    const bbs = rg.of.map((id) => parts[id].bbox);
    const bbox = [0, 1, 2].map((a) => Math.min(...bbs.map((b) => b[a]))).concat([3, 4, 5].map((a) => Math.max(...bbs.map((b) => b[a]))));
    parts[rg.id] = { files, triangles: rg.of.reduce((s, id) => s + parts[id].triangles, 0), bytes: 0, bbox, system: "skeleton", kind: "region", color: SYSTEM_COLOR.skeleton };
  }

  writeFileSync(`${OUT}/index.json`, JSON.stringify({ version: 1, units: "cm", source: SOURCE, parts }, null, 1) + "\n");
  copyFileSync(`${ATLAS_DIR}/LICENSE`, `${OUT}/LICENSE`);
  writeFileSync(`${OUT}/ATTRIBUTION.md`, readFileSync(`${ATLAS_DIR}/ATTRIBUTION.md`, "utf8") + "\nThe meshes in this directory are decimated copies of the BodyParts3D 3.0 STL files, re-centred and scaled to centimetres.\n");
  const size = readdirSync(OUT).filter((f) => f.endsWith(".bin")).reduce((s, f) => s + statSync(`${OUT}/${f}`).size, 0);
  log(`pack: ${Object.keys(parts).length} parts, ${total} triangles, ${(size / 1e6).toFixed(2)} MB`);
}

main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 4: Build, read the numbers, pin the budget**

Run: `node scripts/build-anatomy-meshes.mjs` (offline after the atlas build; it reuses the cache). Read the last line: total triangles and MB. Replace the `/* MEASURED × 1.3 */` placeholder in the pack test with the measured total × 1.3 (rounded up to a thousand) and note the measured number in a comment beside it. If the total exceeds 200 000, lower `SKIN_BUDGET` or the 4 000 cap — never the test.

- [ ] **Step 5: Run the pack test, add `.gitattributes`**

`printf 'public/anatomy3d/*.bin binary\n' >> .gitattributes` (or create the file). Run: `npx vitest run tests/anatomy3d-pack.test.ts tests/anatomy-mesh.test.ts` — Expected: PASS.

- [ ] **Step 6: Commit** (the pack included — list the directory, not `-A`)

```bash
git add scripts/build-anatomy-meshes.mjs public/anatomy3d .gitattributes tests/anatomy3d-pack.test.ts
git commit -F <message file>   # "The 3D mesh pack: every bone, organ and the skin from BodyParts3D, decimated, under CC BY-SA"
```

---

### Task 3: Which parts, how see-through, and the shape 3dmol gets

**Files:**
- Modify: `src/ui/anatomy3d.ts`
- Test: `tests/anatomy3d.test.ts`

**Interfaces:**
- Consumes: `AtlasPart` from `src/scenes/anatomy/types`; the atlas via `ensureEngines(["anatomy"])` and `getLoadedEngines(["anatomy"]).anatomy.parts(...)` (as `tests/body-model.test.ts` does); the real template layout via `scenes.anatomy.layout` after `registerPack("anatomy", anatomyYaml)` (as `tests/anatomy-template.test.ts` does).
- Produces:
  - `export interface Anatomy3dInput { systems: AtlasSystem[]; detail: 1 | 2 | 3; layer: "superficial" | "deep"; focus: string[]; outline: "skin" | "line" | "none"; sex: "neutral" | "female" | "male"; names: "en" | "nb" | "la" }`
  - `export function anatomyInputFrom(params: Record<string, unknown>): Anatomy3dInput` — the template's defaults: systems `["viscera"]`, detail 2 (integers 1–3, else 2), layer superficial, focus `[]` (strings only), outline skin, sex neutral, names en.
  - `export function visibleParts(all: Record<string, AtlasPart>, q: Anatomy3dInput): string[]` — the template's leaf rule (a part with rings, kind ≠ outline, own detail ≤ L, no ringed child with detail ≤ L; focused parts at level 3; under focus only the focused parts and their descendants; `layer: deep` drops parts tagged superficial), then `body_outline` appended when `q.outline !== "none"` and nothing is focused. Names in `focus` resolve case-insensitively against the id and every language's name, like the template. Sorted: skeleton before viscera, then by depth, then id — the template's order.
  - `export function peelOpacity(part: Pick<AtlasPart, "kind" | "system" | "layer">, peel: number): number` — skin `0.3 × (1 − peel)`; a superficial-layer organ or any skeleton part `1 − peel`; everything else 1. `peel` is clamped to [0, 1].
  - `export function toCustomShape(mesh: PackMesh, color: string, opacity: number): { vertexArr: { x: number; y: number; z: number }[]; normalArr: never[]; faceArr: number[]; color: string; opacity: number; clickable: true }` — `normalArr: []` is deliberate: 3dmol computes normals when the array is shorter than the vertex list, and it reads `.length` on it, so it must exist.
  - `export function partName(part: AtlasPart, names: "en" | "nb" | "la"): string` — falls back to `en`.
  - `export const PACK_PATH = "anatomy3d/"` and `export function packUrl(file: string, baseURI: string): string` → `new URL(PACK_PATH + file, baseURI).href`.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/anatomy3d.test.ts
import { beforeAll, describe, expect, test } from "vitest";
import { ensureEngines, getLoadedEngines } from "../src/scenes/engines";
import { registerPack, unregisterPack } from "../src/scenes/packs";
import { scenes } from "../src/scenes/registry";
import anatomyYaml from "../src/scenes/packs/anatomy.yaml?raw";
import type { AtlasPart } from "../src/scenes/anatomy/types";
import { anatomyInputFrom, packUrl, partName, peelOpacity, toCustomShape, visibleParts, type PackMesh } from "../src/ui/anatomy3d";

let all: Record<string, AtlasPart>;
beforeAll(async () => {
  await ensureEngines(["anatomy"]);
  all = getLoadedEngines(["anatomy"]).anatomy.parts({ systems: ["skeleton", "viscera"], sex: "neutral" });
  unregisterPack("anatomy");
  registerPack("anatomy", anatomyYaml);
});

/** The ids the real template draws for these params (its own leaf rule, its own order). */
function drawnByTemplate(params: Record<string, unknown>): string[] {
  const layout = scenes.anatomy.layout!(params);
  return layout.drawables.filter((d) => d.kind === "group" && all[d.id] && all[d.id].kind !== "outline").map((d) => d.id);
}

describe("anatomyInputFrom: the template's defaults", () => {
  test("empty params", () => {
    expect(anatomyInputFrom({})).toEqual({ systems: ["viscera"], detail: 2, layer: "superficial", focus: [], outline: "skin", sex: "neutral", names: "en" });
  });
  test("reads what is there and ignores junk", () => {
    const q = anatomyInputFrom({ systems: ["skeleton"], detail: 3, layer: "deep", focus: ["hand_left", 7], outline: "none", names: "nb", sex: "male" });
    expect(q).toEqual({ systems: ["skeleton"], detail: 3, layer: "deep", focus: ["hand_left"], outline: "none", sex: "male", names: "nb" });
    expect(anatomyInputFrom({ detail: 2.5 }).detail).toBe(2);
    expect(anatomyInputFrom({ detail: 9 }).detail).toBe(2);
  });
});

describe("visibleParts agrees with the template's own leaf rule", () => {
  const cases: Record<string, unknown>[] = [
    { systems: ["viscera"], detail: 2 },
    { systems: ["skeleton"], detail: 1 },
    { systems: ["skeleton"], detail: 3 },
    { systems: ["skeleton", "viscera"], detail: 2, layer: "deep" },
    { systems: ["skeleton"], detail: 2, focus: ["hand_left"] },
    { systems: ["viscera"], detail: 2, focus: ["abdomen"] },
  ];
  for (const params of cases) {
    test(JSON.stringify(params), () => {
      const q = anatomyInputFrom(params);
      const mine = visibleParts(all, q).filter((id) => id !== "body_outline");
      expect(mine).toEqual(drawnByTemplate(params).filter((id) => all[id].kind !== "joint"));
    });
  }
  test("the skin comes last, and only without focus and with an outline", () => {
    expect(visibleParts(all, anatomyInputFrom({})).at(-1)).toBe("body_outline");
    expect(visibleParts(all, anatomyInputFrom({ outline: "none" }))).not.toContain("body_outline");
    expect(visibleParts(all, anatomyInputFrom({ focus: ["abdomen"] }))).not.toContain("body_outline");
  });
  test("a focus name resolves like the template: Norwegian and Latin names work", () => {
    expect(visibleParts(all, anatomyInputFrom({ systems: ["skeleton"], focus: ["Venstre hånd"] }))).toEqual(visibleParts(all, anatomyInputFrom({ systems: ["skeleton"], focus: ["hand_left"] })));
  });
});

describe("peelOpacity", () => {
  test("skin is a faint shell that peels away first", () => {
    expect(peelOpacity(all.body_outline, 0)).toBeCloseTo(0.3);
    expect(peelOpacity(all.body_outline, 1)).toBe(0);
  });
  test("superficial organs and the skeleton fade with the peel; deep organs never do", () => {
    expect(peelOpacity(all.liver, 0.25)).toBeCloseTo(0.75);
    expect(peelOpacity(all.femur_left, 0.5)).toBeCloseTo(0.5);
    expect(peelOpacity(all.kidney_left, 0.9)).toBe(1);
    expect(peelOpacity(all.pancreas, 1)).toBe(1);
  });
  test("peel is clamped", () => {
    expect(peelOpacity(all.liver, -1)).toBe(1);
    expect(peelOpacity(all.liver, 2)).toBe(0);
  });
});

describe("toCustomShape", () => {
  const mesh: PackMesh = { positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), indices: new Uint16Array([0, 1, 2]), triangles: 1 };
  test("vertices as {x,y,z}, faces as a plain array, an EMPTY normalArr, clickable", () => {
    const s = toCustomShape(mesh, "#abcdef", 0.5);
    expect(s.vertexArr).toEqual([{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }]);
    expect(s.faceArr).toEqual([0, 1, 2]);
    expect(s.normalArr).toEqual([]);
    expect(s).toMatchObject({ color: "#abcdef", opacity: 0.5, clickable: true });
  });
});

describe("names and urls", () => {
  test("partName falls back to English", () => {
    expect(partName(all.liver, "nb")).toBe("Lever");
    expect(partName(all.liver, "la")).toBe("Hepar");
    expect(partName({ ...all.liver, name: { en: "Liver" } }, "nb")).toBe("Liver");
  });
  test("packUrl resolves against the document base", () => {
    expect(packUrl("liver.bin", "https://drawcast.app/")).toBe("https://drawcast.app/anatomy3d/liver.bin");
    expect(packUrl("index.json", "http://localhost:5173/some/page")).toBe("http://localhost:5173/some/anatomy3d/index.json");
  });
});
```

- [ ] **Step 2: Run to see them fail** — `npx vitest run tests/anatomy3d.test.ts` — FAIL: missing exports.

- [ ] **Step 3: Implement**

```ts
// appended to src/ui/anatomy3d.ts
import type { AtlasPart, AtlasSystem } from "../scenes/anatomy/types";

export interface Anatomy3dInput {
  systems: AtlasSystem[];
  detail: 1 | 2 | 3;
  layer: "superficial" | "deep";
  focus: string[];
  outline: "skin" | "line" | "none";
  sex: "neutral" | "female" | "male";
  names: "en" | "nb" | "la";
}

/** The template's own defaults, read the way its layout reads params. */
export function anatomyInputFrom(params: Record<string, unknown>): Anatomy3dInput {
  const systems = Array.isArray(params.systems) ? (params.systems.filter((s) => s === "skeleton" || s === "viscera") as AtlasSystem[]) : [];
  const d = params.detail;
  const detail = d === 1 || d === 2 || d === 3 ? d : 2;
  return {
    systems: systems.length ? systems : ["viscera"],
    detail,
    layer: params.layer === "deep" ? "deep" : "superficial",
    focus: Array.isArray(params.focus) ? params.focus.filter((f): f is string => typeof f === "string") : [],
    outline: params.outline === "line" || params.outline === "none" ? params.outline : "skin",
    sex: params.sex === "female" || params.sex === "male" ? params.sex : "neutral",
    names: params.names === "nb" || params.names === "la" ? params.names : "en",
  };
}

const SYSTEM_ORDER: Record<AtlasSystem, number> = { skeleton: 0, viscera: 1 };

/** The parts the figure draws, by the template's leaf rule — the 3D panel shows the same body. */
export function visibleParts(all: Record<string, AtlasPart>, q: Anatomy3dInput): string[] {
  const children: Record<string, string[]> = {};
  for (const [id, p] of Object.entries(all)) if (p.parent) (children[p.parent] ??= []).push(id);
  const byName: Record<string, string> = {};
  for (const [id, p] of Object.entries(all)) {
    byName[id.toLowerCase()] = id;
    for (const key of ["en", "nb", "la"] as const) if (p.name[key]) byName[String(p.name[key]).toLowerCase()] = id;
  }
  const focusIds = new Set<string>();
  for (const f of q.focus) {
    const root = byName[f.trim().toLowerCase()];
    if (!root) continue;
    const stack = [root];
    while (stack.length) {
      const id = stack.pop()!;
      if (focusIds.has(id)) continue;
      focusIds.add(id);
      stack.push(...(children[id] ?? []));
    }
  }
  const focusing = focusIds.size > 0;
  const hasGeo = (id: string) => all[id].rings.length > 0 && all[id].kind !== "outline";
  const drawnAt = (id: string, L: number) => hasGeo(id) && all[id].detail <= L && !(children[id] ?? []).some((c) => hasGeo(c) && all[c].detail <= L);
  const ids = Object.keys(all).filter(
    (id) => drawnAt(id, focusIds.has(id) ? 3 : q.detail) && (!focusing || focusIds.has(id)) && !(q.layer === "deep" && all[id].layer === "superficial"),
  );
  ids.sort((a, b) => SYSTEM_ORDER[all[a].system] - SYSTEM_ORDER[all[b].system] || all[a].depth - all[b].depth || (a < b ? -1 : 1));
  if (!focusing && q.outline !== "none" && all.body_outline) ids.push("body_outline");
  return ids;
}

/** How see-through a part is at a peel value: the skin is a faint shell, superficial organs and bones fade, deep organs stay. */
export function peelOpacity(part: Pick<AtlasPart, "kind" | "system" | "layer">, peel: number): number {
  const p = Math.max(0, Math.min(1, peel));
  if (part.kind === "outline") return 0.3 * (1 - p);
  if (part.layer === "superficial" || part.system === "skeleton") return 1 - p;
  return 1;
}

export interface CustomShape {
  vertexArr: { x: number; y: number; z: number }[];
  /** Empty on purpose: 3dmol computes normals when this is shorter than vertexArr, and reads .length on it. */
  normalArr: never[];
  faceArr: number[];
  color: string;
  opacity: number;
  clickable: true;
}

export function toCustomShape(mesh: PackMesh, color: string, opacity: number): CustomShape {
  const vertexArr: CustomShape["vertexArr"] = [];
  for (let i = 0; i < mesh.positions.length; i += 3) vertexArr.push({ x: mesh.positions[i], y: mesh.positions[i + 1], z: mesh.positions[i + 2] });
  return { vertexArr, normalArr: [], faceArr: Array.from(mesh.indices), color, opacity, clickable: true };
}

export function partName(part: AtlasPart, names: "en" | "nb" | "la"): string {
  return part.name[names] ?? part.name.en;
}

export const PACK_PATH = "anatomy3d/";
export function packUrl(file: string, baseURI: string): string {
  return new URL(PACK_PATH + file, baseURI).href;
}
```

- [ ] **Step 4: Run** — `npx vitest run tests/anatomy3d.test.ts` — PASS. If a `visibleParts` case disagrees with the template, the template is right: read `leaves(L)` in `anatomy.yaml` and match it (the point-budget reduction is the one thing NOT mirrored — none of the test cases trips it at 6 000).

- [ ] **Step 5: Commit** — `git add src/ui/anatomy3d.ts tests/anatomy3d.test.ts`; "The 3D body's rules: the figure's parts, the peel, the shape 3dmol gets".

---

### Task 4: The anatomy kind in the manifest, the query and the viewer

**Files:**
- Modify: `src/scenes/types.ts:33` (manifest type), `src/scenes/doc.ts:98-114` (validation), `src/scenes/packs/anatomy.yaml` (after `engines: [anatomy]`: `model3d:` / `  kind: anatomy`)
- Modify: `src/ui/model3d.ts`
- Test: `tests/model3d.test.ts` (additions), `tests/anatomy-template.test.ts` (one new test)

**Interfaces:**
- `SceneManifest.model3d?: { kind: "molecule"; source: "preset" | "smiles" } | { kind: "anatomy" }`
- `export type Model3dQuery = { kind: "molecule"; input: { xyz: string } | { smiles: string } } | { kind: "anatomy"; input: Anatomy3dInput }`
- `qualifiesFor3d(spec)` returns `{ kind: "anatomy", input: anatomyInputFrom(spec.params ?? {}) }` when the manifest kind is anatomy.
- `Model3dViewer` gains: `addCustom(spec: Record<string, unknown>): Model3dShape; removeAllShapes(): unknown; getView(): unknown; setView(v: unknown): unknown; rotate(angle: number, axis: string): unknown;` with `export interface Model3dShape { updateStyle(spec: Record<string, unknown>): void }`.
- `export interface AnatomyScene { setPeel(peel: number): void; view(preset: "front" | "side" | "back"): void; onName(cb: (name: string | null) => void): void; parts: string[] }`
- `openModel3d(host, container, q, signal, opts?: { onMounted?: (viewer) => void; onAnatomy?: (scene: AnatomyScene) => void })`.
- Testable seams: `export const ANATOMY3D_DEF: { fetch: (url: string, signal: AbortSignal) => Promise<ArrayBuffer | string> }` — the real one does `fetch(url, { signal })` and returns `res.json()`-able text for `index.json` and `arrayBuffer()` otherwise; tests replace it. Parts come from `ensureEngines(["anatomy"])` + `getLoadedEngines(["anatomy"]).anatomy.parts({ systems: input.systems, sex: input.sex })`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/model3d.test.ts` (it already imports `openModel3d`, `MODEL3D_DEF`, `qualifiesFor3d`, `resetModel3dCacheForTests`, `validateTemplateDoc`, `docToManifest`, `scenes`, `registerPack`, `unregisterPack`; add imports for `anatomyYaml` from `../src/scenes/packs/anatomy.yaml?raw`, `ANATOMY3D_DEF, type AnatomyScene` from `../src/ui/model3d`, `ensureEngines` from `../src/scenes/engines`, `encodeMesh, clusterMesh` from `../scripts/anatomy/mesh.mjs`):

```ts
describe("model3d kind anatomy", () => {
  test("doc validation accepts { kind: \"anatomy\" } without a source, and still rejects junk", () => {
    const v = validateTemplateDoc(base({ kind: "anatomy" }));
    expect(v.errors).toEqual([]);
    expect(docToManifest(v.doc!).model3d).toEqual({ kind: "anatomy" });
    expect(validateTemplateDoc(base({ kind: "anatomy", source: "preset" })).errors[0]).toMatch(/source/);
    expect(validateTemplateDoc(base({ kind: "molecule" })).errors[0]).toMatch(/source/);
  });

  test("the anatomy pack carries it, and qualifiesFor3d reads the figure's params", async () => {
    await ensureEngines(["anatomy"]);
    registerPack("anatomy", anatomyYaml);
    try {
      expect(scenes.anatomy.manifest.model3d).toEqual({ kind: "anatomy" });
      const q = qualifiesFor3d({ template: "anatomy", params: { systems: ["skeleton"], detail: 3, names: "nb" } });
      expect(q).toEqual({ kind: "anatomy", input: { systems: ["skeleton"], detail: 3, layer: "superficial", focus: [], outline: "skin", sex: "neutral", names: "nb" } });
      expect(qualifiesFor3d({ template: "anatomy" })?.kind).toBe("anatomy");
    } finally {
      unregisterPack("anatomy");
    }
  });

  describe("openModel3d, anatomy branch", () => {
    const cubeBytes = () => encodeMesh(clusterMesh(new Float32Array([0,0,0, 1,0,0, 0,1,0,  0,0,0, 0,1,0, 0,0,1]), 0.5));
    /** A pack of exactly the parts the figure will ask for, all the same cube. */
    const fakePack = (ids: string[]) => {
      const parts: Record<string, unknown> = {};
      for (const id of ids) parts[id] = { files: [`${id}.bin`], triangles: 2, bytes: 0, bbox: [0, 0, 0, 1, 1, 1], system: "viscera", kind: "organ", color: "#123456" };
      return JSON.stringify({ version: 1, units: "cm", source: "test", parts });
    };
    const stubViewer = () => {
      const shapes: { spec: Record<string, unknown>; styles: Record<string, unknown>[] }[] = [];
      const calls: string[] = [];
      const viewer = {
        addModel: () => calls.push("addModel"),
        setStyle: () => undefined, zoomTo: () => calls.push("zoomTo"), render: () => calls.push("render"),
        spin: (on: boolean | string) => calls.push(`spin:${on}`), clear: () => calls.push("clear"),
        addPropertyLabels: () => undefined, removeAllLabels: () => undefined,
        addCustom: (spec: Record<string, unknown>) => { const s = { spec, styles: [] as Record<string, unknown>[] }; shapes.push(s); return { updateStyle: (st: Record<string, unknown>) => s.styles.push(st) }; },
        removeAllShapes: () => calls.push("removeAllShapes"),
        getView: () => ["view"], setView: (v: unknown) => calls.push(`setView:${JSON.stringify(v)}`), rotate: (a: number, ax: string) => calls.push(`rotate:${a}${ax}`),
      };
      return { viewer, shapes, calls };
    };
    const withStubs = async (params: Record<string, unknown>, expectIds: (ids: string[]) => string[]) => {
      resetModel3dCacheForTests();
      await ensureEngines(["anatomy"]);
      const { viewer, shapes, calls } = stubViewer();
      MODEL3D_DEF.load = async () => ({ createViewer: () => viewer });
      const fetched: string[] = [];
      let packIds: string[] = [];
      ANATOMY3D_DEF.fetch = async (url) => {
        fetched.push(url);
        if (url.endsWith("index.json")) return fakePack(packIds);
        const b = cubeBytes();
        return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
      };
      const q = { kind: "anatomy" as const, input: anatomyInputFrom(params) };
      // The parts the figure shows, from the real atlas:
      const all = getLoadedEngines(["anatomy"]).anatomy.parts({ systems: q.input.systems, sex: q.input.sex });
      packIds = expectIds(visibleParts(all, q.input));
      let scene: AnatomyScene | null = null;
      const container = { replaceChildren: vi.fn() } as unknown as HTMLElement;
      const destroy = await openModel3d({ open: true } as unknown as HTMLDialogElement, container, q, new AbortController().signal, { onAnatomy: (s) => { scene = s; } });
      return { shapes, calls, fetched, scene: scene as AnatomyScene | null, destroy, packIds };
    };

    test("one addCustom per visible part, coloured from the pack, skin translucent, then zoomTo and a spin", async () => {
      const { shapes, calls, fetched, packIds } = await withStubs({ systems: ["viscera"], detail: 1 }, (ids) => ids);
      expect(fetched[0]).toMatch(/anatomy3d\/index\.json$/);
      expect(shapes.map((s) => s.spec.color)).toEqual(packIds.map(() => "#123456"));
      expect(shapes.length).toBe(packIds.length);
      expect(shapes.at(-1)!.spec.opacity).toBeCloseTo(0.3); // body_outline is last and a faint shell
      expect(shapes[0].spec.opacity).toBe(1);
      expect(shapes[0].spec.clickable).toBe(true);
      expect(calls).toContain("zoomTo");
      expect(calls).toContain("spin:true");
      expect(calls).not.toContain("addModel");
    });

    test("a part the pack lacks is skipped, not fatal", async () => {
      const { shapes, packIds } = await withStubs({ systems: ["viscera"], detail: 1 }, (ids) => ids.filter((id) => id !== "liver"));
      expect(shapes.length).toBe(packIds.length);
    });

    test("the scene handle: peel restyles the shapes, presets set the view, a click names the part", async () => {
      const { shapes, calls, scene } = await withStubs({ systems: ["viscera"], detail: 1 }, (ids) => ids);
      expect(scene).not.toBeNull();
      scene!.setPeel(1);
      expect(shapes.at(-1)!.styles.at(-1)).toEqual({ opacity: 0 }); // skin gone
      // deep organs (no superficial tag) keep opacity 1 under any peel: find one
      const idx = scene!.parts.indexOf("heart");
      expect(shapes[idx].styles.at(-1)).toEqual({ opacity: 1 });
      scene!.view("side");
      expect(calls.at(-2)).toBe('setView:["view"]');
      expect(calls.at(-1)).toBe("rotate:90y");
      let named: string | null = "unset";
      scene!.onName((n) => (named = n));
      (shapes[idx].spec.callback as () => void)();
      expect(named).toBe("Heart");
    });

    test("names follow the figure's language", async () => {
      const { shapes, scene } = await withStubs({ systems: ["viscera"], detail: 1, names: "nb" }, (ids) => ids);
      let named: string | null = null;
      scene!.onName((n) => (named = n));
      (shapes[scene!.parts.indexOf("heart")].spec.callback as () => void)();
      expect(named).toBe("Hjerte");
    });

    test("a failed index fetch shows plain failure text and never throws", async () => {
      resetModel3dCacheForTests();
      MODEL3D_DEF.load = async () => ({ createViewer: () => stubViewer().viewer });
      ANATOMY3D_DEF.fetch = async () => { throw new Error("offline"); };
      const container = { replaceChildren: vi.fn() } as unknown as HTMLElement;
      await openModel3d({ open: true } as unknown as HTMLDialogElement, container, { kind: "anatomy", input: anatomyInputFrom({}) }, new AbortController().signal);
      expect(container.replaceChildren).toHaveBeenLastCalledWith(expect.stringMatching(/Couldn't load the 3D view: offline/));
    });
  });
});
```

(`vi`, `anatomyInputFrom`, `visibleParts`, `getLoadedEngines` need importing at the top of the test file.)

And in `tests/anatomy-template.test.ts`, inside the round-2 describe:

```ts
  test("the template advertises the 3D panel", () => {
    expect(scenes.anatomy.manifest.model3d).toEqual({ kind: "anatomy" });
  });
```

- [ ] **Step 2: Run to see them fail** — `npx vitest run tests/model3d.test.ts tests/anatomy-template.test.ts` — FAIL (type/validation and missing exports).

- [ ] **Step 3: Manifest type and validation**

`src/scenes/types.ts:33`:
```ts
  model3d?: { kind: "molecule"; source: "preset" | "smiles" } | { kind: "anatomy" };
```
`src/scenes/doc.ts` (the interface at line 22 gets the same union; the validation block becomes):
```ts
  if (d.model3d !== undefined) {
    if (typeof d.model3d !== "object" || d.model3d === null || Array.isArray(d.model3d)) {
      errors.push("model3d must be an object");
    } else {
      const m3 = d.model3d as Record<string, unknown>;
      if (m3.kind === "molecule") {
        if (m3.source !== "preset" && m3.source !== "smiles") errors.push(`model3d.source must be "preset" or "smiles" — got ${JSON.stringify(m3.source)}`);
      } else if (m3.kind === "anatomy") {
        if (m3.source !== undefined) errors.push("model3d.source does not apply to kind \"anatomy\" — the mesh pack is the source");
      } else {
        errors.push(`model3d.kind must be "molecule" or "anatomy" — got ${JSON.stringify(m3.kind)}`);
      }
    }
  }
```
Update the existing test `unknown kind rejected` expectation if its regex no longer matches (it matches `/model3d\.kind/` — still fine).

`src/scenes/packs/anatomy.yaml`, after `engines: [anatomy]`:
```yaml
model3d:
  kind: anatomy
```
and one sentence appended to the description, before "Silhouettes are frontal projections…": `The ⬡ 3D button in the app shows the same body as meshes — say so in a closing line when the lesson is about shape or depth.`

- [ ] **Step 4: The query, the viewer boundary and the anatomy branch in `src/ui/model3d.ts`**

```ts
import { anatomyInputFrom, decodeMesh, packUrl, partName, peelOpacity, toCustomShape, visibleParts, type Anatomy3dInput } from "./anatomy3d";
import { ensureEngines, getLoadedEngines } from "../scenes/engines";
import type { AtlasPart } from "../scenes/anatomy/types";

export type Model3dQuery =
  | { kind: "molecule"; input: { xyz: string } | { smiles: string } }
  | { kind: "anatomy"; input: Anatomy3dInput };

// in qualifiesFor3d, first thing after reading m3:
  if (m3.kind === "anatomy") return { kind: "anatomy", input: anatomyInputFrom(spec.params ?? {}) };
  if (m3.kind !== "molecule") return null;

export interface Model3dShape { updateStyle(spec: Record<string, unknown>): void }
// Model3dViewer gains:
  addCustom(spec: Record<string, unknown>): Model3dShape;
  removeAllShapes(): unknown;
  getView(): unknown;
  setView(view: unknown): unknown;
  rotate(angle: number, axis: string): unknown;

/** The dialog's handle on a mounted body: peel, camera presets, the clicked part's name. */
export interface AnatomyScene {
  parts: string[];
  setPeel(peel: number): void;
  view(preset: "front" | "side" | "back"): void;
  onName(cb: (name: string | null) => void): void;
}

/** Injectable fetch for the mesh pack — tests serve a synthetic pack through it. */
export const ANATOMY3D_DEF: { fetch: (url: string, signal: AbortSignal) => Promise<ArrayBuffer | string> } = {
  fetch: async (url, signal) => {
    const res = await fetch(url, { signal });
    if (!res.ok) throw new Error(`mesh pack fetch failed (${res.status}) for ${url.split("/").pop()}`);
    return url.endsWith(".json") ? res.text() : res.arrayBuffer();
  },
};

interface PackIndex { parts: Record<string, { files: string[]; color: string }> }
const meshCache = new Map<string, Promise<ReturnType<typeof decodeMesh>>>();

/** Fetches index.json and the visible parts' files (memoised per session), returns what to add. */
async function loadAnatomy(q: Anatomy3dInput, signal: AbortSignal): Promise<{ id: string; part: AtlasPart; color: string; meshes: ReturnType<typeof decodeMesh>[] }[]> {
  await ensureEngines(["anatomy"]);
  const all = getLoadedEngines(["anatomy"]).anatomy.parts({ systems: q.systems, sex: q.sex });
  const base = typeof document !== "undefined" ? document.baseURI : "http://localhost/";
  const index = JSON.parse(String(await ANATOMY3D_DEF.fetch(packUrl("index.json", base), signal))) as PackIndex;
  const ids = visibleParts(all, q).filter((id) => index.parts[id] !== undefined);
  const file = (f: string) => {
    let p = meshCache.get(f);
    if (!p) {
      p = ANATOMY3D_DEF.fetch(packUrl(f, base), signal).then((b) => decodeMesh(b as ArrayBuffer));
      meshCache.set(f, p);
      p.catch(() => meshCache.delete(f));
    }
    return p;
  };
  return Promise.all(ids.map(async (id) => ({ id, part: all[id], color: index.parts[id].color, meshes: await Promise.all(index.parts[id].files.map(file)) })));
}
```

In `openModel3d`, the body of the `try` becomes a branch:

```ts
    const $3Dmol = (await ensure3dmol()) as Model3dNamespace;
    if (q.kind === "anatomy") {
      const loaded = await loadAnatomy(q.input, signal);
      if (signal.aborted || !host.open) return destroy;
      container.replaceChildren();
      viewer = $3Dmol.createViewer(container, { backgroundColor: "white" });
      const v = viewer;
      let nameCb: (name: string | null) => void = () => undefined;
      const shapes: { part: AtlasPart; shape: Model3dShape }[] = [];
      for (const { id, part, color, meshes } of loaded) {
        for (const mesh of meshes) {
          const spec = toCustomShape(mesh, color, peelOpacity(part, 0)) as Record<string, unknown>;
          spec.callback = () => nameCb(partName(part, q.input.names));
          shapes.push({ part, shape: v.addCustom(spec) });
        }
      }
      v.zoomTo();
      v.render();
      const front = v.getView();
      v.spin(true);
      const scene: AnatomyScene = {
        parts: loaded.map((l) => l.id),
        setPeel: (peel) => { for (const { part, shape } of shapes) shape.updateStyle({ opacity: peelOpacity(part, peel) }); v.render(); },
        view: (preset) => { v.setView(front); if (preset === "side") v.rotate(90, "y"); if (preset === "back") v.rotate(180, "y"); v.render(); },
        onName: (cb) => { nameCb = cb; },
      };
      opts?.onMounted?.(v);
      opts?.onAnatomy?.(scene);
    } else {
      // …the existing molecule code, unchanged (data/format/addModel/setStyle/zoomTo/render/spin/labels)…
    }
```

`scene.parts` lists one id per PART; `shapes` has one entry per FILE (a region has several) — `setPeel` walks shapes, the tests index `shapes` by `scene.parts` only for single-file organs, which is what they use. `destroy` stays as it is (`spin(false)`, `clear()`).

- [ ] **Step 5: Run** — `npx vitest run tests/model3d.test.ts tests/anatomy-template.test.ts tests/anatomy3d.test.ts` — PASS. `npx tsc --noEmit` — clean (main.ts still compiles: `openModel3dDialog(q)` takes the union; the `⬡ 3D` button title is fixed in Task 5).

- [ ] **Step 6: Commit** — `git add src/scenes/types.ts src/scenes/doc.ts src/scenes/packs/anatomy.yaml src/ui/model3d.ts tests/model3d.test.ts tests/anatomy-template.test.ts`; "model3d kind anatomy: the query, the mesh-pack loader, one addCustom per part, and the scene handle".

---

### Task 5: The dialog controls, the example, the docs, and a look

**Files:**
- Modify: `src/main.ts:2213-2290` (the explore-in-3D modal), `src/main.ts:2565-2570` (button title)
- Modify: `src/styles.css` after `.model3d-container` rules
- Modify: `src/examples.json` (append), `tests/anatomy-template.test.ts:357` (ten → eleven, 10 → 11)
- Modify: `src/scenes/anatomy/README.md` (new section), `ROADMAP.md` (part 3 shipped)

- [ ] **Step 1: Dialog controls in `main.ts`**

Beside `model3dSpinBtn`/`model3dLabelsBtn`:

```ts
const model3dPeel = h("input", { type: "range", min: "0", max: "1", step: "0.01", value: "0", class: "model3d-peel", "aria-label": "Peel: fade the skin, bones and outer organs" }) as HTMLInputElement;
const model3dPeelRow = h("label", { class: "model3d-peelrow" }, "Peel", model3dPeel);
const model3dViews = (["front", "side", "back"] as const).map((p) => h("button", { class: "model3d-view", "data-view": p }, p[0].toUpperCase() + p.slice(1)));
const model3dName = h("div", { class: "model3d-name", "aria-live": "polite" });
const model3dCredit = h("div", { class: "model3d-credit" }, "Meshes: BodyParts3D, © The Database Center for Life Science, CC BY-SA 2.1 Japan");
const model3dAnatomyControls = h("div", { class: "model3d-anatomy" }, model3dPeelRow, ...model3dViews);
model3dModal.body.append(model3dContainer, model3dName, model3dCredit);
model3dModal.footer.append(model3dSpinBtn, model3dLabelsBtn, model3dAnatomyControls);

let model3dScene: AnatomyScene | null = null;
model3dPeel.addEventListener("input", () => model3dScene?.setPeel(Number(model3dPeel.value)));
for (const b of model3dViews) b.addEventListener("click", () => model3dScene?.view(b.dataset.view as "front" | "side" | "back"));
function showAnatomyControls(on: boolean): void {
  model3dAnatomyControls.hidden = !on;
  model3dCredit.hidden = !on;
  model3dName.hidden = !on;
  model3dLabelsBtn.hidden = on; // atom labels are a molecule thing
}
```

In `openModel3dDialog(q)`: `model3dScene = null; model3dPeel.value = "0"; model3dName.textContent = ""; showAnatomyControls(q.kind === "anatomy"); model3dModal.dialog.querySelector(".dialog-head h2, .dialog-title")?.replaceChildren(q.kind === "anatomy" ? "⬡ The body in 3D" : "⬡ Explore in 3D");` (find the title element `createModal` builds — `dialogHead` in `src/ui/modal.ts` — and use its actual selector; if it has none, leave the title alone). Pass `onAnatomy: (s) => { if (!ac.signal.aborted) { model3dScene = s; s.onName((n) => (model3dName.textContent = n ?? "")); } }` to `openModel3d`. In the `close` handler add `model3dScene = null;`. The molecule path must not call `setModel3dLabels` for anatomy: guard `setModel3dLabelsState` with `if (model3dViewer && !model3dAnatomyControls.hidden) return;` — or simpler, in `onMounted` only call `setModel3dLabels(v, model3dLabelsOn)` when `q.kind === "molecule"`.

Button title at line ~2567: `title: q.kind === "anatomy" ? "See this body in 3D" : "Explore this molecule in 3D"`.

CSS (after `.model3d-container`):
```css
.model3d-anatomy { display: flex; gap: 0.5rem; align-items: center; flex-wrap: wrap; }
.model3d-anatomy[hidden], .model3d-credit[hidden], .model3d-name[hidden] { display: none; }
.model3d-peelrow { display: inline-flex; gap: 0.4rem; align-items: center; font-size: 0.9rem; }
.model3d-peel { width: 9rem; }
.model3d-name { min-height: 1.4em; margin-top: 0.4rem; font-weight: 600; }
.model3d-credit { font-size: 0.75rem; color: var(--muted, #777); margin-top: 0.2rem; }
```

- [ ] **Step 2: The example** (append before the final `]` of `src/examples.json`):

```json
  {
    "request": "Show the heart between the lungs, and let me see it in 3D.",
    "packs": ["anatomy"],
    "spec": {
      "title": "See it in 3D",
      "template": "anatomy",
      "params": { "systems": ["viscera"], "detail": 2, "focus": ["thorax"], "labels": "focus", "highlight": ["heart"] },
      "commands": [
        { "draw": ["frame", "lung_right", "label_lung_right", "lung_left", "label_lung_left"], "speak": "Two lungs, one on each side of the chest — the right one a little larger, the left one leaving room." },
        { "draw": ["heart", "label_heart"], "speak": "Room for the heart, which sits between them, tilted a little to the left." },
        { "highlight": { "target": ["trachea"] }, "speak": "The windpipe comes down from above and splits into the two lungs." },
        { "quiz": { "question": "Which lung is the larger one?", "choices": ["The right lung", "The left lung", "They are the same"], "correct": 1, "right": "The right — the heart takes part of the left side of the chest." } },
        { "speak": "A drawing shows the front. The 3D button under the figure shows the same body from any side — turn it, and peel the skin and bones away to see the heart in its place." }
      ]
    }
  }
```

Check what `focus: ["thorax"]` draws (the thorax group's children: trachea, lungs, heart — confirm `trachea` is drawn so the highlight target is visible; if the thorax has more children at level 3 under focus (e.g. aorta), the example still lints as long as every drawn id it names exists — run the examples test and adjust the draw list to the ids the lint reports). Update the count test to eleven/11.

- [ ] **Step 3: Docs**

`src/scenes/anatomy/README.md`, a new section before "Adding a system":

```markdown
## The 3D panel

`public/anatomy3d/` is the same body as meshes: one decimated `.bin` per bone
and organ plus the skin, built by `scripts/build-anatomy-meshes.mjs` from the
same STL cache (`node scripts/build-anatomy-meshes.mjs`; run it whenever the
part table changes, and commit the pack — it is under the atlas's CC BY-SA
licence, with its own `LICENSE` and `ATTRIBUTION.md`). Pack units are
centimetres, re-centred on the skin, +Y up, +Z toward the camera. Budgets:
skin 20 000 triangles, other parts 400–4 000 by size; the whole pack must stay
under 200 000 (pinned by `tests/anatomy3d-pack.test.ts`). The panel shows what
the figure shows — `visibleParts` in `src/ui/anatomy3d.ts` is the template's
leaf rule again, cross-checked against the real layout — coloured as in 2D,
each part clickable for its name in the figure's language; the peel slider
fades the skin, the skeleton and the superficial organs; Front/Side/Back are
camera presets. 3dmol computes the normals itself (`normalArr: []`).
```

ROADMAP: the anatomy bullet — add "part 3 — the 3D panel" to the shipped list and remove the open "3D panel (round 2, part 3)" sub-bullet.

- [ ] **Step 4: Full verification**

`npx vitest run` (all green), `npx tsc --noEmit` (clean), `npm run build` (clean).

- [ ] **Step 5: Look at it**

`npx vite --port 5199 --strictPort` in the background; Playwright: load the "See it in 3D" example from the sidebar (`button.library-open` with that text), click the `.model3d-btn` in the control bar, wait ~3 s, screenshot the dialog. Check: a body in the canvas (not blank), the credit line, the peel slider; drag the peel to 1 (set `.value` and dispatch `input`) and screenshot again — the skin and ribs must be gone and the heart visible; click the canvas centre and read `.model3d-name`. Check the console for errors. Close the page, stop the server, delete the screenshots. If `updateStyle({opacity})` does not visibly change a shape, replace `setPeel` with remove-and-re-add (`viewer.removeAllShapes()` then re-add every shape with the new opacity) and note it in the README.

- [ ] **Step 6: Commit, merge, push**

`git add src/main.ts src/styles.css src/examples.json tests/anatomy-template.test.ts src/scenes/anatomy/README.md ROADMAP.md`; "The 3D panel: peel, presets, the part's name, the credit — and the See it in 3D example". Then ExitWorktree (keep) and from the main checkout: `git pull --ff-only && git merge --no-ff worktree-anatomy-3d && npm install && npx vitest run && git push origin main && git ls-remote origin refs/heads/main`; remove the worktree and branch. Tell Hans what to try: open "See it in 3D", press ⬡ 3D, turn the body, peel, click the heart, press Side.

---

## Self-review

- Spec coverage: meshes per part with colours (T2, T4), lit and spinning (T4: spin), click names in the figure's language (T4), peel slider (T3/T5), Front/Side/Back (T4/T5), DBCLS footer (T5), hidden-by-layer/systems hidden here too (T3 `visibleParts`), the pack format/index/decimation/budgets (T1/T2), lazy fetch + session cache (T4 `meshCache`), the seams (`manifest.model3d`, `Model3dQuery`, `qualifiesFor3d`, `openModel3d` branch — T4), tests as listed (T1–T4), the example (T5). Deviations, all stated: centimetres not metres; budget by size instead of a fixed table; vertex clustering with a growing cell instead of edge-collapse; regions reuse their bones' files.
- Names used across tasks: `decodeMesh`/`PackMesh` (T1→T3/T4), `Anatomy3dInput`/`anatomyInputFrom`/`visibleParts`/`peelOpacity`/`toCustomShape`/`partName`/`packUrl` (T3→T4), `AnatomyScene`/`ANATOMY3D_DEF`/`Model3dShape` (T4→T5), `index.json` shape (T2→T4).
