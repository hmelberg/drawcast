import { describe, expect, test } from "vitest";
import { validateSpec } from "../src/spec/schema";

const ok = (elements: unknown[]) => validateSpec({ elements, commands: [{ draw: elements.map((e) => (e as { id: string }).id) }] });

describe("freehand spec fields", () => {
  test("text may be placed with at.ref instead of x/y", () => {
    expect(ok([{ id: "a", type: "shape", shape: "rect", x: 100, y: 100 }, { id: "t", type: "text", text: "hi", at: { ref: "a", side: "above", gap: 10 } }]).ok).toBe(true);
  });
  test("x/y together with at.ref is rejected", () => {
    const r = ok([{ id: "a", type: "shape", shape: "rect", x: 100, y: 100 }, { id: "t", type: "text", text: "hi", x: 5, y: 5, at: { ref: "a" } }]);
    expect(r.ok).toBe(false);
    expect(r.errors.join(" ")).toMatch(/"t".*at\.ref.*x\/y/);
  });
  test("group needs members; math needs tex; image and icon need of", () => {
    expect(ok([{ id: "g", type: "group" }]).errors.join(" ")).toMatch(/"g".*members/);
    expect(ok([{ id: "m", type: "math", x: 1, y: 1 }]).errors.join(" ")).toMatch(/"m".*tex/);
    expect(ok([{ id: "i", type: "image", x: 1, y: 1 }]).errors.join(" ")).toMatch(/"i".*of/);
    expect(ok([{ id: "k", type: "icon", x: 1, y: 1 }]).errors.join(" ")).toMatch(/"k".*of/);
  });
  test("a full freehand thing validates", () => {
    expect(ok([
      { id: "body", type: "shape", shape: "rect", x: 300, y: 300, width: 60, height: 200 },
      { id: "piston", type: "shape", shape: "rect", width: 40, height: 60, at: { ref: "body", anchor: "top" }, anchor: "bottom" },
      { id: "hose", type: "path", points: [[0, 0], [40, -20], [80, 0]], smooth: true, at: { ref: "body", side: "right", gap: 6 } },
      { id: "pump", type: "group", members: ["body", "piston", "hose"], fit: "left" },
      { id: "f", type: "math", tex: "p V = n R T", size: 30, at: { ref: "pump", side: "above", gap: 20 } },
      { id: "photo", type: "image", of: "Bicycle pump", width: 200, at: { ref: "pump", side: "right", gap: 30 } },
      { id: "ic", type: "icon", of: "factory", size: 80, x: 800, y: 200 },
    ]).ok).toBe(true);
  });
});
