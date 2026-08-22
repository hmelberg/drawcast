import { describe, expect, test } from "vitest";
import { validateSpec } from "../src/spec/schema";
import { elementBBoxes, layoutSpec } from "../src/layout/layout";
import { leafDrawables, drawablesForId } from "../src/layout/model";
import type { Spec } from "../src/spec/types";

const TEXT_SPEC: Spec = {
  elements: [
    { id: "note", type: "text", text: "Equilibrium", x: 500, y: 375 },
    { id: "mark", type: "annotation", target: "note" },
  ],
  commands: [],
};

describe("annotation element — schema (trimmed to permanent punctuation)", () => {
  test("an annotation with a target validates", () => {
    expect(validateSpec(TEXT_SPEC).ok).toBe(true);
  });

  test("an annotation without a target is rejected", () => {
    const v = validateSpec({ elements: [{ id: "m", type: "annotation" }], commands: [] });
    expect(v.ok).toBe(false);
    expect(v.errors.join(" ")).toContain("target");
  });

  test("the retired marker/underline kinds are rejected (glow and the laser own transience)", () => {
    for (const kind of ["highlight", "underline", "sparkles"]) {
      const v = validateSpec({
        elements: [{ id: "m", type: "annotation", target: "x", kind }],
        commands: [],
      });
      expect(v.ok).toBe(false);
    }
  });
});

describe("annotation element — layout", () => {
  test("a text target defaults to a box around the text", () => {
    const layout = layoutSpec(TEXT_SPEC);
    const leaves = leafDrawables(drawablesForId(layout.drawables, "mark"));
    expect(leaves).toHaveLength(1);
    const d = leaves[0];
    expect(d.kind === "stroke" && d.closed).toBe(true);
    const noteBox = elementBBoxes(layout).get("note")!;
    const markBox = elementBBoxes(layout).get("mark")!;
    // The box hugs the text: slightly larger, roughly centered on it.
    expect(markBox.w).toBeGreaterThan(noteBox.w);
    expect(markBox.h).toBeLessThan(noteBox.h + 40);
    expect(layout.order).toContain("mark");
  });

  test("a node target defaults to a closed ellipse around it", () => {
    const layout = layoutSpec({
      elements: [
        { id: "n", type: "node", shape: "circle", text: "Sick" },
        { id: "ring", type: "annotation", target: "n" },
      ],
      commands: [],
    });
    const leaves = leafDrawables(drawablesForId(layout.drawables, "ring"));
    expect(leaves).toHaveLength(1);
    const d = leaves[0];
    expect(d.kind === "stroke" && d.closed).toBe(true);
    expect(d.kind === "stroke" && d.pts.length).toBeGreaterThan(10);
  });

  test("strike and cross render OVER text (text layer)", () => {
    const layout = layoutSpec({
      elements: [
        { id: "note", type: "text", text: "rejected option", x: 500, y: 375 },
        { id: "s", type: "annotation", target: "note", kind: "strike" },
        { id: "x", type: "annotation", target: "note", kind: "cross" },
      ],
      commands: [],
    });
    for (const id of ["s", "x"]) {
      const leaves = leafDrawables(drawablesForId(layout.drawables, id));
      expect(leaves.length).toBeGreaterThan(0);
      for (const d of leaves) expect(d.z).toBe(2);
    }
  });

  test("a retired kind from an old saved spec degrades to the default with a warning (no crash)", () => {
    const layout = layoutSpec({
      elements: [
        { id: "note", type: "text", text: "Key number", x: 500, y: 375 },
        { id: "m", type: "annotation", target: "note", kind: "highlight" as never },
      ],
      commands: [],
    });
    const leaves = leafDrawables(drawablesForId(layout.drawables, "m"));
    expect(leaves).toHaveLength(1);
    expect(layout.warnings.join(" ")).toMatch(/retired|unknown/i);
  });

  test("a label with a leader line: the mark covers the TEXT, not the leader", () => {
    // The rent-control case: the Shortage label gets pushed aside and tied to
    // its anchor with a long leader — the box must hug the text alone.
    const layout = layoutSpec({
      template: "supply_demand",
      params: {
        equilibrium: { show: true, guides: true },
        price_ceiling: { label: "Rent control", show_shortage: true },
      },
      elements: [{ id: "mark", type: "annotation", target: "label_shortage", kind: "box" }],
      commands: [],
    });
    const markBox = elementBBoxes(layout).get("mark")!;
    expect(markBox.h).toBeLessThan(70); // text-height box, not a leader-spanning monster
  });

  test("an unknown target produces a warning and no drawables", () => {
    const layout = layoutSpec({
      elements: [{ id: "m", type: "annotation", target: "ghost", kind: "box" }],
      commands: [],
    });
    expect(layout.warnings.join(" ")).toContain("ghost");
    expect(drawablesForId(layout.drawables, "m")).toHaveLength(0);
  });

  test("annotations can target template ids (drawn after the scene)", () => {
    const layout = layoutSpec({
      template: "supply_demand",
      params: {},
      elements: [{ id: "m", type: "annotation", target: "label_E", kind: "circle" }],
      commands: [],
    });
    expect(leafDrawables(drawablesForId(layout.drawables, "m")).length).toBeGreaterThan(0);
  });
});
