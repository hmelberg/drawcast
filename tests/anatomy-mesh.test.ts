import { describe, expect, test } from "vitest";
import { bboxOfMesh, clusterMesh, decimateToBudget, encodeMesh, simplifyMesh, toPack } from "../scripts/anatomy/mesh.mjs";
import { decodeMesh } from "../src/ui/anatomy3d";

/** A cube as 12 raw triangles (36 vertices), BodyParts3D style: 9 floats per triangle. */
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

const bufOf = (bytes: Uint8Array): ArrayBuffer => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

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
    expect(m.positions.length).toBe(0);
  });
  test("clustering is deterministic", () => {
    const a = clusterMesh(cube(7, [3, 3, 3]), 2);
    const b = clusterMesh(cube(7, [3, 3, 3]), 2);
    expect(Array.from(a.indices)).toEqual(Array.from(b.indices));
    expect(Array.from(a.positions)).toEqual(Array.from(b.positions));
  });
});

/** A cube whose every face is an n × n grid of quads (12 n² triangles), raw triangle soup. */
function gridCube(n: number, size = 10): Float32Array {
  const out: number[] = [];
  const faces: ((u: number, v: number) => number[])[] = [
    (u, v) => [u, v, 0], (u, v) => [u, v, 1], (u, v) => [0, u, v], (u, v) => [1, u, v], (u, v) => [u, 0, v], (u, v) => [u, 1, v],
  ];
  for (const at of faces) {
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      const p = (a: number, b: number) => at(a / n, b / n).map((c) => c * size);
      out.push(...p(i, j), ...p(i + 1, j), ...p(i + 1, j + 1), ...p(i, j), ...p(i + 1, j + 1), ...p(i, j + 1));
    }
  }
  return new Float32Array(out);
}

/** Every undirected edge of a closed triangle surface belongs to exactly two faces. */
function isClosed(indices: ArrayLike<number>): boolean {
  const count = new Map<string, number>();
  for (let f = 0; f < indices.length; f += 3) {
    for (let i = 0; i < 3; i++) {
      const a = indices[f + i], b = indices[f + ((i + 1) % 3)];
      const k = a < b ? `${a}-${b}` : `${b}-${a}`;
      count.set(k, (count.get(k) ?? 0) + 1);
    }
  }
  return [...count.values()].every((c) => c === 2);
}

describe("simplifyMesh (quadric edge collapse)", () => {
  test("a mesh already within budget comes back unchanged", () => {
    const m = clusterMesh(cube(), 1);
    const s = simplifyMesh(m, 12);
    expect(s.triangles).toBe(12);
    expect(Array.from(s.positions)).toEqual(Array.from(m.positions));
  });
  test("a finely gridded cube collapses toward its eight corners and stays closed", () => {
    const m = clusterMesh(gridCube(6), 0.01); // 432 faces, shared vertices
    expect(m.triangles).toBe(432);
    expect(isClosed(m.indices)).toBe(true);
    const s = simplifyMesh(m, 24);
    expect(s.triangles).toBeLessThanOrEqual(24);
    expect(s.triangles).toBeGreaterThanOrEqual(12);
    expect(isClosed(s.indices)).toBe(true);
    // Every corner of the cube survives: flat-face collapses are free, corners cost.
    const pts = new Set<string>();
    for (let i = 0; i < s.positions.length; i += 3) pts.add(`${Math.round(s.positions[i])},${Math.round(s.positions[i + 1])},${Math.round(s.positions[i + 2])}`);
    for (const c of ["0,0,0", "10,0,0", "0,10,0", "10,10,0", "0,0,10", "10,0,10", "0,10,10", "10,10,10"]) expect(pts, c).toContain(c);
    // The bounding box is untouched.
    expect(bboxOfMesh(s.positions)).toEqual([0, 0, 0, 10, 10, 10]);
  });
  test("the result is compact: no unreferenced vertices, indices in range", () => {
    const s = simplifyMesh(clusterMesh(gridCube(4), 0.01), 30);
    const used = new Set(Array.from(s.indices));
    expect(used.size).toBe(s.positions.length / 3);
    expect(Math.max(...s.indices)).toBe(s.positions.length / 3 - 1);
  });
});

describe("decimateToBudget", () => {
  test("clusters at the base cell and keeps it; the budget is met by collapsing edges", () => {
    const { mesh, cell } = decimateToBudget(gridCube(6), 0.01, 40);
    expect(cell).toBe(0.01);
    expect(mesh.triangles).toBeLessThanOrEqual(40);
    expect(isClosed(mesh.indices)).toBe(true);
  });
  test("stays put when already under budget", () => {
    const { mesh, cell } = decimateToBudget(cube(), 1, 100);
    expect(cell).toBe(1);
    expect(mesh.triangles).toBe(12);
  });
});

describe("the .bin format round-trips", () => {
  test("encode → decode gives back the same vertices and faces (Uint16 for a small mesh)", () => {
    const m = clusterMesh(cube(3, [1, 2, 3]), 0.5);
    const bytes = encodeMesh(m);
    expect(String.fromCharCode(...bytes.slice(0, 4))).toBe("DCM1");
    expect(bytes.length % 4).toBe(0);
    const back = decodeMesh(bufOf(bytes));
    expect(back.indices).toBeInstanceOf(Uint16Array);
    expect(Array.from(back.positions)).toEqual(Array.from(m.positions));
    expect(Array.from(back.indices)).toEqual(Array.from(m.indices));
    expect(back.triangles).toBe(12);
  });
  test("a mesh with more than 65 535 vertices is written with Uint32 indices", () => {
    const n = 65_540;
    const positions = new Float32Array(n * 3).map((_, i) => i);
    const indices = new Uint32Array([0, 1, 2, n - 3, n - 2, n - 1]);
    const back = decodeMesh(bufOf(encodeMesh({ positions, indices })));
    expect(back.indices).toBeInstanceOf(Uint32Array);
    expect(Array.from(back.indices)).toEqual([0, 1, 2, n - 3, n - 2, n - 1]);
  });
  test("a wrong magic is refused", () => {
    const bytes = encodeMesh(clusterMesh(cube(), 1));
    bytes[0] = 88;
    expect(() => decodeMesh(bufOf(bytes))).toThrow(/DCM1/);
  });
  test("a truncated file is refused", () => {
    const bytes = encodeMesh(clusterMesh(cube(), 1));
    expect(() => decodeMesh(bufOf(bytes).slice(0, bytes.length - 8))).toThrow(/length/);
  });
});

describe("bboxOfMesh", () => {
  test("min and max of a cube at (1,2,3) with side 4", () => {
    expect(bboxOfMesh(clusterMesh(cube(4, [1, 2, 3]), 1).positions)).toEqual([1, 2, 3, 5, 6, 7]);
  });
});
