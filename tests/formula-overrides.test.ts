import { beforeAll, describe, expect, test } from "vitest";
import { ensureEngines } from "../src/scenes/engines";
import { layoutSpec } from "../src/layout/layout";
import { isEmptyOverrides, overridesKey } from "../src/layout/posed";
import type { Spec } from "../src/spec/types";
import type { GroupDrawable, TextDrawable } from "../src/layout/model";

beforeAll(async () => { await ensureEngines(["mathjax"]); });
const spec: Spec = { elements: [{ id: "eq", type: "math", tex: "2x + 3 = 11", x: 500, y: 375 }, { id: "lbl", type: "label", attach_to: "eq", text: "start" }], commands: [] };
const group = (l: ReturnType<typeof layoutSpec>, id: string) => l.drawables.find((d) => d.id === id) as GroupDrawable;

describe("math override", () => {
  test("{tex} lays out the new formula; {from, t} lays out the tween; t = 1 equals the plain new layout", () => {
    const plain = layoutSpec({ ...spec, elements: [{ ...spec.elements![0], tex: "2x = 8" }, spec.elements![1]] });
    const over = layoutSpec(spec, undefined, { math: { eq: { tex: "2x = 8" } } });
    expect(group(over, "eq").children.length).toBe(group(plain, "eq").children.length);
    const settled = layoutSpec(spec, undefined, { math: { eq: { tex: "2x = 8", from: "2x + 3 = 11", t: 1 } } });
    expect(group(settled, "eq").children.length).toBe(group(plain, "eq").children.length);
    const mid = layoutSpec(spec, undefined, { math: { eq: { tex: "2x = 8", from: "2x + 3 = 11", t: 0.5 } } });
    expect(group(mid, "eq").children.length).toBeGreaterThan(group(plain, "eq").children.length);
    expect(isEmptyOverrides({ math: {} })).toBe(true);
    expect(overridesKey({ math: { eq: { tex: "a" } } })).not.toBe(overridesKey({ math: { eq: { tex: "b" } } }));
  });
});

describe("copies override", () => {
  test("a copy is laid out at the source's place under the new id and can carry its own pose", () => {
    const base = layoutSpec(spec);
    const withCopy = layoutSpec(spec, undefined, { copies: { eq2: "eq" } });
    expect(withCopy.order).toContain("eq2");
    expect(group(withCopy, "eq2").children.length).toBe(group(base, "eq").children.length);
    expect(withCopy.namedAnchors.eq2.center).toEqual(withCopy.namedAnchors.eq.center);
    const moved = layoutSpec(spec, undefined, { copies: { eq2: "eq" }, poses: { eq2: { offset: [0, -100] } }, math: { eq2: { tex: "2x = 8" } } });
    expect(group(moved, "eq2").children.length).not.toBe(group(base, "eq").children.length); // the copy morphed, the source did not
    expect(group(moved, "eq").children.length).toBe(group(base, "eq").children.length);
    // the label attached to the source is not copied
    expect(withCopy.drawables.filter((d) => (d as TextDrawable).text === "start")).toHaveLength(1);
  });
  test("a copy of an unknown source warns and is skipped; a copy of a copy works", () => {
    const l = layoutSpec(spec, undefined, { copies: { c1: "nope", eq2: "eq", eq3: "eq2" } });
    expect(l.warnings.some((w) => w.includes('copy "c1"') && w.includes("nope"))).toBe(true);
    expect(l.order).toContain("eq3");
  });
});
