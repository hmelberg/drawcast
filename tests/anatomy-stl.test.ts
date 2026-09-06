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
