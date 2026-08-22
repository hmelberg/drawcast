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

describe("annotation element — schema", () => {
  test("an annotation with a target validates", () => {
    expect(validateSpec(TEXT_SPEC).ok).toBe(true);
  });

  test("an annotation without a target is rejected", () => {
    const v = validateSpec({ elements: [{ id: "m", type: "annotation" }], commands: [] });
    expect(v.ok).toBe(false);
    expect(v.errors.join(" ")).toContain("target");
  });

  test("an unknown kind is rejected", () => {
    const v = validateSpec({
      elements: [{ id: "m", type: "annotation", target: "x", kind: "sparkles" }],
      commands: [],
    });
    expect(v.ok).toBe(false);
  });
});

describe("annotation element — layout", () => {
  test("a text target defaults to underline: strokes sit below the text", () => {
    const layout = layoutSpec(TEXT_SPEC);
    const leaves = leafDrawables(drawablesForId(layout.drawables, "mark"));
    expect(leaves.length).toBeGreaterThan(0);
    const noteBox = elementBBoxes(layout).get("note")!;
    for (const d of leaves) {
      expect(d.kind).toBe("stroke");
      for (const [, y] of d.kind === "stroke" ? d.pts : []) expect(y).toBeLessThan(noteBox.y + 1);
    }
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

  test("highlight renders BEHIND its target (area layer) as a thick marker", () => {
    const layout = layoutSpec({
      elements: [
        { id: "note", type: "text", text: "Key number: 42", x: 500, y: 375 },
        { id: "m", type: "annotation", target: "note", kind: "highlight" },
      ],
      commands: [],
    });
    const leaves = leafDrawables(drawablesForId(layout.drawables, "m"));
    expect(leaves).toHaveLength(1);
    expect(leaves[0].z).toBe(0);
    expect(leaves[0].kind === "stroke" && leaves[0].style.strokeWidth).toBeGreaterThan(20);
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

  test("an unknown target produces a warning and no drawables", () => {
    const layout = layoutSpec({
      elements: [{ id: "m", type: "annotation", target: "ghost", kind: "box" }],
      commands: [],
    });
    expect(layout.warnings.join(" ")).toContain("ghost");
    expect(drawablesForId(layout.drawables, "m")).toHaveLength(0);
  });

  test("a label with a leader line: the mark covers the TEXT, not the leader", () => {
    // The rent-control case: the Shortage label gets pushed aside and tied to
    // its anchor with a long leader — the marker must hug the text alone.
    const layout = layoutSpec({
      template: "supply_demand",
      params: {
        equilibrium: { show: true, guides: true },
        price_ceiling: { label: "Rent control", show_shortage: true },
      },
      elements: [{ id: "mark", type: "annotation", target: "label_shortage", kind: "highlight" }],
      commands: [],
    });
    const mark = leafDrawables(drawablesForId(layout.drawables, "mark"))[0];
    expect(mark.kind).toBe("stroke");
    if (mark.kind !== "stroke") return;
    // A text-height marker, not a leader-spanning monster.
    expect(mark.style.strokeWidth).toBeLessThan(60);
    const label = leafDrawables(drawablesForId(layout.drawables, "label_shortage")).find((d) => d.kind === "text");
    const labelY = label && label.kind === "text" ? label.pos[1] : 0;
    for (const [, y] of mark.pts) expect(Math.abs(y - labelY)).toBeLessThan(30);
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
