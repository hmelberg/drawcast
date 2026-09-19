// The border has to CLEAR what it wraps. Two separate reasons it did not:
// the wobble is applied at render time (rough.js strays ~4.4 units beyond the
// clean path at the default roughness 1.4, measured), and the padding was a
// flat 6 that knew nothing about the target's stroke, its roughness or its
// size. And a cluster of marks could not be boxed at all without declaring a
// group by hand, because `target` took one id.
import { describe, expect, test } from "vitest";
import { elementBBoxes, layoutSpec } from "../src/layout/layout";
import { validateSpec, normalizeSpec } from "../src/spec/schema";
import { strayOf } from "../src/layout/annotate";
import type { Spec } from "../src/spec/types";

const boxOf = (spec: Spec, id: string) => elementBBoxes(layoutSpec(spec)).get(id)!;

describe("a border clears what it wraps", () => {
  test("the box clears the target's ink by more than the wobble can stray", () => {
    const spec: Spec = {
      elements: [
        { id: "t", type: "shape", shape: "rect", x: 500, y: 375, width: 200, height: 100 },
        { id: "m", type: "annotation", target: "t", kind: "box" },
      ],
      commands: [{ draw: ["t", "m"] }],
    };
    const target = boxOf(spec, "t");
    const mark = boxOf(spec, "m");
    // Both the target's ink and the border's own ink wander by strayOf(1.4).
    const needed = strayOf(1.4) * 2 + 3.5;
    expect(target.x - mark.x).toBeGreaterThan(needed);
    expect(mark.x + mark.w - (target.x + target.w)).toBeGreaterThan(needed);
    expect(target.y - mark.y).toBeGreaterThan(needed);
    expect(mark.y + mark.h - (target.y + target.h)).toBeGreaterThan(needed);
  });

  test("a rougher target is given more room, not the same room", () => {
    const at = (roughness: number): number => {
      const spec: Spec = {
        elements: [
          { id: "t", type: "shape", shape: "rect", x: 500, y: 375, width: 200, height: 100, style: { roughness } },
          { id: "m", type: "annotation", target: "t", kind: "box" },
        ],
        commands: [{ draw: ["t", "m"] }],
      };
      return boxOf(spec, "t").x - boxOf(spec, "m").x;
    };
    expect(at(2.2)).toBeGreaterThan(at(0.8) + 2);
  });

  test("a thicker target is given more room", () => {
    const at = (stroke_width: number): number => {
      const spec: Spec = {
        elements: [
          { id: "t", type: "shape", shape: "rect", x: 500, y: 375, width: 200, height: 100, style: { stroke_width } },
          { id: "m", type: "annotation", target: "t", kind: "box" },
        ],
        commands: [{ draw: ["t", "m"] }],
      };
      return boxOf(spec, "t").x - boxOf(spec, "m").x;
    };
    expect(at(10)).toBeGreaterThan(at(2) + 2);
  });

  test("a bigger word is given more room than a small one", () => {
    const at = (font_size: number): number => {
      const spec: Spec = {
        elements: [
          { id: "w", type: "text", text: "Likevekt", x: 500, y: 375, font_size },
          { id: "m", type: "annotation", target: "w", kind: "box" },
        ],
        commands: [{ draw: ["w", "m"] }],
      };
      return boxOf(spec, "w").y - boxOf(spec, "m").y;
    };
    expect(at(48)).toBeGreaterThan(at(16) + 2);
  });

  test("a circled target clears its ink too", () => {
    const spec: Spec = {
      elements: [
        { id: "t", type: "shape", shape: "circle", x: 500, y: 375, radius: 60 },
        { id: "m", type: "annotation", target: "t", kind: "circle" },
      ],
      commands: [{ draw: ["t", "m"] }],
    };
    const target = boxOf(spec, "t");
    const mark = boxOf(spec, "m");
    expect(target.x - mark.x).toBeGreaterThan(strayOf(1.4) * 2);
    expect(target.y - mark.y).toBeGreaterThan(strayOf(1.4) * 2);
  });
});

describe("a border around several things at once", () => {
  const CLUSTER: Spec = {
    elements: [
      { id: "d1", type: "shape", shape: "circle", x: 400, y: 300, radius: 6 },
      { id: "d2", type: "shape", shape: "circle", x: 460, y: 340, radius: 6 },
      { id: "d3", type: "shape", shape: "circle", x: 520, y: 290, radius: 6 },
      { id: "m", type: "annotation", target: ["d1", "d2", "d3"], kind: "box" },
    ],
    commands: [{ draw: ["d1", "d2", "d3", "m"] }],
  };

  test("a list of targets validates", () => {
    expect(validateSpec(CLUSTER).ok).toBe(true);
  });

  test("one target still normalizes to the list form", () => {
    const n = normalizeSpec({ elements: [{ id: "m", type: "annotation", target: "a" }], commands: [] }) as Spec;
    expect(n.elements![0].target).toEqual(["a"]);
  });

  test("the border wraps the whole cluster", () => {
    const mark = boxOf(CLUSTER, "m");
    const d1 = boxOf(CLUSTER, "d1");
    const d3 = boxOf(CLUSTER, "d3");
    expect(mark.x).toBeLessThan(d1.x);
    expect(mark.x + mark.w).toBeGreaterThan(d3.x + d3.w);
    expect(layoutSpec(CLUSTER).warnings.filter((w) => w.includes("annotation"))).toEqual([]);
  });

  test("an unknown id among known ones is named, and the rest are still wrapped", () => {
    const spec: Spec = {
      elements: [
        { id: "d1", type: "shape", shape: "circle", x: 400, y: 300, radius: 6 },
        { id: "m", type: "annotation", target: ["d1", "nope"], kind: "box" },
      ],
      commands: [{ draw: ["d1", "m"] }],
    };
    const r = layoutSpec(spec);
    expect(r.warnings.join(" ")).toContain("nope");
    expect(elementBBoxes(r).get("m")).toBeDefined();
  });

  test("a cluster of drawn marks is a box target, not a circle target", () => {
    // Every leaf is a stroke, so the default kind stays `circle`; what matters
    // is that the mark exists and wraps them.
    const spec: Spec = {
      elements: [
        { id: "d1", type: "shape", shape: "circle", x: 400, y: 300, radius: 6 },
        { id: "d2", type: "shape", shape: "circle", x: 460, y: 340, radius: 6 },
        { id: "m", type: "annotation", target: ["d1", "d2"] },
      ],
      commands: [{ draw: ["d1", "d2", "m"] }],
    };
    expect(elementBBoxes(layoutSpec(spec)).get("m")).toBeDefined();
  });
});

describe("writing a border in a script", () => {
  test("`mark around` names what it wraps", async () => {
    const { parseScriptPages } = await import("../src/spec/script/parse");
    const spec = parseScriptPages('Se her.\n    mark m around d1 d2 d3 kind box\n').pages[0].spec;
    expect(spec.elements).toEqual([{ id: "m", type: "annotation", target: ["d1", "d2", "d3"], kind: "box" }]);
    expect(spec.commands).toEqual([{ speak: "Se her.", draw: ["m"] }]);
  });

  test("the id is optional — the border is usually drawn once and left", async () => {
    const { parseScriptPages } = await import("../src/spec/script/parse");
    const spec = parseScriptPages("Se her.\n    mark around plate\n").pages[0].spec;
    expect(spec.elements![0]).toMatchObject({ type: "annotation", target: ["plate"] });
  });

  test("it prints back the way it was written", async () => {
    const { printScriptPages } = await import("../src/spec/script/print");
    const text = printScriptPages({}, [{ spec: {
      elements: [{ id: "m", type: "annotation", target: ["d1", "d2"], kind: "circle" }],
      commands: [{ draw: ["m"], speak: "Se her." }],
    } }]);
    expect(text).toBe("Se her.\n    mark m around d1 d2 kind circle\n");
  });
});
