import { beforeAll, describe, expect, test } from "vitest";
import { ensureEngines, enginesForSpec } from "../src/scenes/engines";
import { layoutSpec, elementBBoxes } from "../src/layout/layout";
import { normalizeSpec } from "../src/spec/schema";
import { flattenDrawables, SKETCH_MS } from "../src/layout/model";

describe("math element (real mathjax, node)", () => {
  beforeAll(async () => { await ensureEngines(["mathjax"]); });

  test("enginesForSpec asks for mathjax when a math element or a tex label is present", () => {
    expect(enginesForSpec({ elements: [{ id: "m", type: "math", tex: "x", x: 1, y: 1 }], commands: [] })).toEqual(["mathjax"]);
    expect(enginesForSpec({ elements: [{ id: "l", type: "label", tex: "y", attach_to: "a" }], commands: [] })).toEqual(["mathjax"]);
    expect(enginesForSpec({ elements: [{ id: "t", type: "text", text: "y", x: 1, y: 1 }], commands: [] })).toEqual([]);
  });

  test("draws precise areas, sized by size, placeable with at", () => {
    const r = layoutSpec({
      elements: [
        { id: "a", type: "shape", shape: "rect", x: 300, y: 300, width: 100, height: 40 },
        { id: "m", type: "math", tex: "F = m a", size: 32, at: { ref: "a", side: "above", gap: 12 } },
      ],
      commands: [{ draw: ["a", "m"] }],
    });
    const ds = flattenDrawables(r.drawables).filter((d) => d.id.startsWith("m__g"));
    expect(ds.length).toBeGreaterThan(3);
    expect(ds.every((d) => d.kind === "area" && (d as { precise?: boolean }).precise)).toBe(true);
    const b = elementBBoxes(r);
    expect(b.get("m")!.y).toBeCloseTo(b.get("a")!.y + 40 + 12, 0);
    expect(b.get("m")!.h).toBeGreaterThan(16); // "F" cap height ≈ 0.7 em > x-height 16
    expect(r.issues.filter((i) => i.severity === "error")).toEqual([]);
  });

  test("the glyphs stand upright: the bar of a fraction sits between its parts", () => {
    const r = layoutSpec({
      elements: [{ id: "m", type: "math", tex: "\\frac{1}{2} + x_1", size: 40, x: 500, y: 400 }],
      commands: [{ draw: ["m"] }],
    });
    const box = elementBBoxes(r).get("m")!;
    // Centred on its own (x, y), and taller than one x-height row: a fraction
    // stacks numerator over denominator.
    expect(box.x + box.w / 2).toBeCloseTo(500, 0);
    expect(box.y + box.h / 2).toBeCloseTo(400, 0);
    expect(box.h).toBeGreaterThan(40);
    // The subscript "1" of x_1 hangs BELOW the middle of the row — proof the
    // y axis is not flipped (a mirrored layout would raise it).
    const glyphs = flattenDrawables(r.drawables).filter((d) => d.id.startsWith("m__g") && d.kind === "area");
    const lowest = Math.min(...glyphs.map((g) => Math.min(...(g as { pts: [number, number][] }).pts.map((p) => p[1]))));
    expect(lowest).toBeLessThan(box.y + box.h / 2);
  });

  test("named anchors follow the box, so other elements can attach to the equation", () => {
    const r = layoutSpec({
      elements: [
        { id: "m", type: "math", tex: "E = mc^2", size: 30, x: 400, y: 500 },
        { id: "s", type: "shape", shape: "rect", width: 20, height: 20, at: { ref: "m", side: "right", gap: 10 } },
      ],
      commands: [{ draw: ["m", "s"] }],
    });
    const b = elementBBoxes(r);
    const m = b.get("m")!;
    // The anchors come from the laid-out box, the measured box from the
    // simplified rings — within a fraction of a unit of each other.
    expect(r.namedAnchors.m.center[0]).toBeCloseTo(m.x + m.w / 2, 0);
    expect(r.namedAnchors.m.center[1]).toBeCloseTo(m.y + m.h / 2, 0);
    expect(r.namedAnchors.m.right[0]).toBeCloseTo(m.x + m.w, 0);
    expect(r.namedAnchors.m.right[1]).toBeCloseTo(m.y + m.h / 2, 0);
    expect(b.get("s")!.x).toBeCloseTo(m.x + m.w + 10, 0);
    expect(r.warnings).toEqual([]);
  });

  test("a label with tex normalizes to a math element placed by side", () => {
    const n = normalizeSpec({ elements: [{ id: "a", type: "shape", shape: "rect", x: 1, y: 1 }, { id: "l", type: "label", tex: "y = x^2", attach_to: "a", side: "right" }], commands: [] }) as { elements: { id: string; type: string; at?: unknown }[] };
    expect(n.elements[1]).toMatchObject({ id: "l", type: "math", tex: "y = x^2", at: { ref: "a", side: "right", gap: 8 } });
    expect(n.elements[1]).not.toHaveProperty("attach_to");
    expect(n.elements[1]).not.toHaveProperty("side");
  });

  test("a tex label keeps id, style and font_size (as size), and lays out where it attaches", () => {
    const n = normalizeSpec({
      elements: [{ id: "l", type: "label", tex: "\\pi", attach_to: "a", font_size: 44, style: { color: "#b5482e" } }],
      commands: [],
    }) as { elements: Record<string, unknown>[] };
    expect(n.elements[0]).toMatchObject({ type: "math", size: 44, style: { color: "#b5482e" }, at: { ref: "a", side: "above-right", gap: 8 } });
    expect(n.elements[0]).not.toHaveProperty("font_size");

    const r = layoutSpec({
      elements: [
        { id: "a", type: "shape", shape: "rect", x: 200, y: 200, width: 60, height: 60 },
        { id: "l", type: "label", tex: "\\pi", attach_to: "a", side: "right" },
      ],
      commands: [{ draw: ["a", "l"] }],
    });
    const b = elementBBoxes(r);
    expect(b.get("l")).toBeDefined();
    expect(b.get("l")!.x).toBeCloseTo(b.get("a")!.x + 60 + 8, 0);
    expect(r.issues.filter((i) => i.severity === "error")).toEqual([]);
  });

  test("the x-height IS the scale: the row is half the size, and it doubles with it", () => {
    const heightAt = (size: number): number => {
      const r = layoutSpec({
        elements: [{ id: "m", type: "math", tex: "x", size, x: 500, y: 400 }],
        commands: [{ draw: ["m"] }],
      });
      return elementBBoxes(r).get("m")!.h;
    };
    // "x" is one x-height tall, and an x-height is MATH_X_HEIGHT × size — to
    // within the glyph's own overshoot (a rounded letterform rises ~2% past
    // the nominal x-height line), which is why 60 is bounded rather than
    // toBeCloseTo(30, 0): the measured row is 30.66, not the constant's fault.
    expect(heightAt(30)).toBeCloseTo(15, 0);
    expect(heightAt(60)).toBeGreaterThan(29);
    expect(heightAt(60)).toBeLessThan(31);
    // …and it is linear in size, so the constant cannot hide in a
    // size-dependent fudge. Not linear to the last digit: RING_EPS is an
    // absolute tolerance, so a bigger glyph keeps marginally more of its
    // extremes (2.012, not 2.000).
    expect(heightAt(60) / heightAt(30)).toBeCloseTo(2, 1);
  });

  test("the glyphs are FILLED in the element's ink, and drawn as text is drawn", () => {
    const r = layoutSpec({
      elements: [{ id: "m", type: "math", tex: "x", size: 30, x: 500, y: 400, style: { color: "#b5482e" } }],
      commands: [{ draw: ["m"] }],
    });
    const glyph = flattenDrawables(r.drawables).find((d) => d.id === "m__g0")!;
    expect(glyph.style.fill).toBe("#b5482e");
    expect(glyph.style.opacity).toBe(1);
    expect(glyph.drawOpts).toEqual({ mode: "sketch", duration: SKETCH_MS.text });
  });

  test("TeX that renders no ink draws nothing and says nothing", () => {
    const r = layoutSpec({
      elements: [{ id: "m", type: "math", tex: "\\hspace{1em}", x: 500, y: 400 }],
      commands: [{ draw: ["m"] }],
    });
    expect(r.drawables).toEqual([]);
    expect(r.issues.filter((i) => i.severity === "error")).toEqual([]);
  });

  test("bad TeX is a layout issue, not a crash", () => {
    const r = layoutSpec({
      elements: [{ id: "m", type: "math", tex: "\\frac{1}{", x: 500, y: 400 }],
      commands: [{ draw: ["m"] }],
    });
    expect(r.warnings.concat(r.issues.map((i) => i.message)).join(" ")).toMatch(/math "m"/);
  });
});
