import { describe, expect, test } from "vitest";
import { definitionalRefs, dependentsMap, sourceIds } from "../src/spec/deps";
import type { SpecElement } from "../src/spec/types";

const els = [
  { id: "d", type: "curve", expr: "100 - x" },
  { id: "s", type: "curve", expr: "x" },
  { id: "eq", type: "point", at: { intersection_of: ["d", "s"] } },
  { id: "cs", type: "region", between: ["d", "s"] },
  { id: "a", type: "arrow", from: { ref: "eq" }, to: { x: 10, y: 10 } },
  { id: "lbl", type: "label", attach_to: "eq", text: "E" },
  { id: "box", type: "shape", at: { ref: "eq", side: "right" } },
  { id: "ang", type: "angle", at: { ref: "s", anchor: "start" }, from: { ref: "d", anchor: "end" }, to: 90 },
  { id: "ln", type: "line", through: [{ ref: "eq" }, [0, 0]] },
  { id: "dot", type: "point", at: { x: 2, on: "d" } },
  { id: "m", type: "measure", of: "cs" },
  { id: "n1", type: "node", text: "A" },
  { id: "n2", type: "node", text: "B" },
  { id: "e", type: "edge", from: { ref: "n1" }, to: { ref: "n2" } },
] as unknown as SpecElement[];

describe("definitional references", () => {
  test("each element names what it is defined by; placement and labels are not definitions", () => {
    expect(definitionalRefs(els[2])).toEqual(["d", "s"]);
    expect(definitionalRefs(els[3])).toEqual(["d", "s"]);
    expect(definitionalRefs(els[4])).toEqual(["eq"]);
    expect(definitionalRefs(els[5])).toEqual([]);
    expect(definitionalRefs(els[6])).toEqual([]);
    expect(definitionalRefs(els[7])).toEqual(["s", "d"]);
    expect(definitionalRefs(els[8])).toEqual(["eq"]);
    expect(definitionalRefs(els[9])).toEqual(["d"]);
    expect(definitionalRefs(els[10])).toEqual([]); // measures keep their own follow path
    expect(definitionalRefs(els[13])).toEqual(["n1", "n2"]);
  });
  test("dependents are transitive and in spec order; sources are what something depends on", () => {
    const m = dependentsMap(els);
    expect(m.get("d")).toEqual(["eq", "cs", "a", "ang", "ln", "dot"]);
    expect(m.get("eq")).toEqual(["a", "ln"]);
    expect(m.get("n1")).toEqual(["e"]);
    expect(m.get("a")).toBeUndefined();
    expect(sourceIds(els)).toEqual(["d", "s", "eq", "n1", "n2"]);
  });
  test("a template id may be a source: an arrow from an id no element declares", () => {
    const m = dependentsMap([{ id: "a", type: "arrow", from: { ref: "eq_point" }, to: { ref: "n" } }, { id: "n", type: "node" }] as unknown as SpecElement[]);
    expect(m.get("eq_point")).toEqual(["a"]);
    expect(m.get("n")).toEqual(["a"]);
  });
  test("a self-reference never lists the element as its own dependent", () => {
    const m = dependentsMap([{ id: "a", type: "arrow", from: { ref: "a" }, to: { ref: "b" } }] as unknown as SpecElement[]);
    expect(m.get("a")).toEqual([]);
  });
});
