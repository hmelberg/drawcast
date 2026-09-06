import { existsSync, readFileSync, statSync } from "node:fs";
import { describe, expect, test } from "vitest";
import index from "../public/anatomy3d/index.json";
import skeleton from "../src/scenes/anatomy/atlas/atlas-skeleton.json";
import viscera from "../src/scenes/anatomy/atlas/atlas-viscera.json";
import body from "../src/scenes/anatomy/atlas/atlas-body.json";
import type { Atlas, AtlasPart } from "../src/scenes/anatomy/types";
import { decodeMesh } from "../src/ui/anatomy3d";
import anatomyYaml from "../src/scenes/packs/anatomy.yaml?raw";

// The mesh pack is generated (scripts/build-anatomy-meshes.mjs) and committed;
// these tests keep it honest against the atlas it must mirror.

const PACK = "public/anatomy3d";
interface Entry {
  files: string[];
  triangles: number;
  bytes: number;
  bbox: number[];
  system: string;
  kind: string;
  color: string;
  layer?: string;
}
const parts = index.parts as Record<string, Entry>;
const ATLAS: Record<string, AtlasPart> = {
  ...(body as unknown as Atlas).parts,
  ...(skeleton as unknown as Atlas).parts,
  ...(viscera as unknown as Atlas).parts,
};
const bufOf = (bytes: Buffer): ArrayBuffer => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

// Measured at the first build (2026-09-06, quadric edge collapse, budgets
// skin 20 000 / others 400–4 000 by size): 143 584 triangles, 1.62 MB.
// Headroom ~30 %; raise only with a reason in the commit.
const MEASURED_TRIANGLES = 143_584;
const TRIANGLE_CEILING = Math.min(200_000, Math.ceil((MEASURED_TRIANGLES * 1.3) / 1000) * 1000);

describe("the mesh pack matches the atlas", () => {
  test("every measured bone, organ, region and the skin has an entry; joints, groups and the authored uterus do not", () => {
    for (const [id, p] of Object.entries(ATLAS)) {
      const expected = p.source === "bodyparts3d" && (p.kind === "bone" || p.kind === "organ" || p.kind === "region" || p.kind === "outline");
      expect(id in parts, id).toBe(expected);
    }
    for (const id of Object.keys(parts)) expect(id in ATLAS, `${id} is in the pack but not the atlas`).toBe(true);
  });

  test("every listed file exists, decodes, and has the triangles the index claims (regions sum their bones)", () => {
    const own = new Map<string, number>();
    for (const [id, e] of Object.entries(parts)) {
      if (e.kind === "region") continue;
      expect(e.files).toEqual([`${id}.bin`]);
      const path = `${PACK}/${e.files[0]}`;
      expect(existsSync(path), path).toBe(true);
      const m = decodeMesh(bufOf(readFileSync(path)));
      expect(m.triangles, id).toBe(e.triangles);
      expect(m.positions.length / 3, `${id} vertices`).toBeLessThan(64_000);
      expect(statSync(path).size, `${id} bytes`).toBe(e.bytes);
      own.set(e.files[0], m.triangles);
    }
    for (const [id, e] of Object.entries(parts)) {
      if (e.kind !== "region") continue;
      expect(e.files.length, id).toBeGreaterThan(0);
      expect(e.triangles, id).toBe(e.files.reduce((s, f) => s + (own.get(f) ?? NaN), 0));
    }
  });

  test("the whole pack stays under 200 000 triangles and its measured size plus headroom", () => {
    const total = Object.values(parts).filter((e) => e.kind !== "region").reduce((s, e) => s + e.triangles, 0);
    expect(total).toBeLessThanOrEqual(200_000);
    expect(total).toBeLessThanOrEqual(TRIANGLE_CEILING);
    expect(total).toBeGreaterThan(0);
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
    expect(parts.liver.layer).toBe("superficial");
    expect(parts.kidney_left.layer).toBeUndefined();
  });

  test("the body is centimetres, upright and roughly 170 tall", () => {
    const [, y0, , , y1] = parts.body_outline.bbox;
    expect(y1 - y0).toBeGreaterThan(150);
    expect(y1 - y0).toBeLessThan(200);
    expect(Math.abs(y0 + y1)).toBeLessThan(5); // centred on the skin
    // The heart sits in front of the spine: larger Z (toward the camera).
    const heartZ = (parts.heart.bbox[2] + parts.heart.bbox[5]) / 2;
    const spineZ = (parts.thoracic_vertebrae.bbox[2] + parts.thoracic_vertebrae.bbox[5]) / 2;
    expect(heartZ).toBeGreaterThan(spineZ);
    // The patient's left hand has the larger X (screen right when facing the body).
    expect(parts.hand_left.bbox[0]).toBeGreaterThan(parts.hand_right.bbox[3]);
  });
});
