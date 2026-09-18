import { describe, expect, test } from "vitest";
import { resolveSibling } from "../src/playlist/inset-ref";
import { pictureOf, resolveInsets, resolveInsetsSync } from "../src/render/inset";
import { planOptionsFor } from "../src/render/index";
import { heuristicMeasure } from "../src/layout/measure";
import type { Spec } from "../src/spec/types";
import type { InsetError, InsetPicture } from "../src/layout/inset";

const A: Spec = { title: "The model", elements: [{ id: "tri", type: "polygon", points: [[100, 100], [300, 100], [200, 300]] }], commands: [{ draw: ["tri"] }] };
const B: Spec = { title: "Results", elements: [{ id: "sq", type: "shape", shape: "rect", x: 550, y: 440, width: 100, height: 80 }], commands: [{ draw: ["sq"] }] };
const C: Spec = { title: "Conclusion", elements: [{ id: "pic", type: "inset", of: "The model" }], commands: [{ draw: ["pic"] }] };

describe("resolveSibling (spec §3 reference by title or number)", () => {
  const sibs = [A, B, C];
  test("by title, case-insensitive and trimmed", () => {
    expect(resolveSibling("  the MODEL ", sibs, 2)).toEqual({ index: 0 });
  });
  test("by 1-based number", () => {
    expect(resolveSibling("2", sibs, 2)).toEqual({ index: 1 });
    expect(resolveSibling("4", sibs, 2)).toEqual({ error: "no item 4 (the playlist has 3 items)" });
  });
  test("previous", () => {
    expect(resolveSibling("previous", sibs, 2)).toEqual({ index: 1 });
    expect(resolveSibling("previous", sibs, 0)).toEqual({ error: 'no "previous" item: this is the first item' });
  });
  test("a miss and a self-reference are errors", () => {
    expect(resolveSibling("Nope", sibs, 2)).toEqual({ error: 'no item titled "Nope"' });
    expect(resolveSibling("Conclusion", sibs, 2)).toEqual({ error: "an inset cannot show its own page" });
    expect(resolveSibling("3", sibs, 2)).toEqual({ error: "an inset cannot show its own page" });
  });
});

describe("pictureOf (spec §4.3)", () => {
  test("a source that ends in clear gives the held frame, not a blank", () => {
    const src: Spec = { ...A, commands: [{ draw: ["tri"] }, { clear: {} }] };
    const pic = pictureOf(src, heuristicMeasure, planOptionsFor, "pic");
    expect(pic.drawables.length).toBeGreaterThan(0);
    expect(pic.drawables.every((d) => d.id.startsWith("pic__p"))).toBe(true);
    expect(pic.ink).not.toBeNull();
    expect(pic.boxes.tri).toBeDefined();
  });
  test("a source with copy + move includes the moved copy", () => {
    const src: Spec = { ...A, commands: [{ draw: ["tri"] }, { copy: { target: "tri", as: "tri2" } }, { move: { target: "tri2", by: [300, 0] } }] };
    const pic = pictureOf(src, heuristicMeasure, planOptionsFor, "p");
    expect(pic.boxes.tri2).toBeDefined();
    expect(pic.boxes.tri2.x).toBeCloseTo(pic.boxes.tri.x + 300, 3);
  });
  test("the source's own insets are stripped (no pictures of pictures)", () => {
    const src: Spec = { ...A, elements: [...A.elements!, { id: "nested", type: "inset", of: "2" }], commands: [{ draw: ["tri", "nested"] }] };
    const pic = pictureOf(src, heuristicMeasure, planOptionsFor, "p");
    expect(pic.boxes.nested).toBeUndefined();
    expect(pic.boxes.tri).toBeDefined();
  });
});

describe("resolveInsets", () => {
  const deps = { prepare: async (s: Spec) => s, measureFor: () => heuristicMeasure, planOpts: planOptionsFor };
  test("stores the picture, the authored source and its index on the element", async () => {
    const host = structuredClone(C);
    await resolveInsets(host, { ...deps, siblings: [A, B, C], self: 2 });
    const pic = host.elements![0].picture as InsetPicture;
    expect("error" in pic).toBe(false);
    expect(pic.spec).toBe(A);
    expect(pic.index).toBe(0);
    expect(pic.drawables.length).toBeGreaterThan(0);
  });
  test("no siblings, a miss and a self-reference store an error, never throw", async () => {
    const alone = structuredClone(C);
    await resolveInsets(alone, { ...deps, self: -1 });
    expect((alone.elements![0].picture as InsetError).error).toMatch(/playlist/);
    const miss: Spec = structuredClone({ ...C, elements: [{ id: "pic", type: "inset", of: "Nope" }] });
    await resolveInsets(miss, { ...deps, siblings: [A, B, C], self: 2 });
    expect((miss.elements![0].picture as InsetError).error).toBe('no item titled "Nope"');
  });
  test("a prepare that throws degrades to an error on the element", async () => {
    const host = structuredClone(C);
    await resolveInsets(host, { ...deps, prepare: async () => { throw new Error("boom"); }, siblings: [A, B, C], self: 2 });
    expect((host.elements![0].picture as InsetError).error).toMatch(/boom/);
  });
});

describe("resolveInsetsSync (spec 2026-09-17-inset §9: the examples gate)", () => {
  test("fills the picture for a title reference, built straight off the authored sibling", () => {
    const host = structuredClone(C);
    resolveInsetsSync(host, [A, B, C], 2, heuristicMeasure, planOptionsFor);
    const pic = host.elements![0].picture as InsetPicture;
    expect("error" in pic).toBe(false);
    expect(pic.spec).toBe(A);
    expect(pic.index).toBe(0);
    expect(pic.drawables.length).toBeGreaterThan(0);
    expect(pic.boxes.tri).toBeDefined();
  });
  test("a miss stores an error, never throws", () => {
    const miss: Spec = structuredClone({ ...C, elements: [{ id: "pic", type: "inset", of: "Nope" }] });
    resolveInsetsSync(miss, [A, B, C], 2, heuristicMeasure, planOptionsFor);
    expect((miss.elements![0].picture as InsetError).error).toBe('no item titled "Nope"');
  });
});
