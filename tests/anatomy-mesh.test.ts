import { describe, expect, test } from "vitest";
import { bboxOfMesh, clusterMesh, decimateToBudget, encodeMesh, toPack } from "../scripts/anatomy/mesh.mjs";
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
