// Lints judge positions after moves (spec 2026-10-04 §6, W5): a label drawn
// where a glass USED to stand is not on the glass. coVisible stops pairing an
// element once a move has taken it off its laid-out place; posedIssues (the
// frames harness, per boundary) judges moved pairs at their real places.
import { describe, expect, test } from "vitest";
import { coVisible } from "../src/lint/lint";
import { posedIssues } from "../src/lint/posed";
import { layoutSpec } from "../src/layout/layout";
import { heuristicMeasure } from "../src/layout/measure";
import type { Spec } from "../src/spec/types";

const glass = { id: "gc", type: "path", points: [[690, 640], [690, 230], [790, 230], [790, 640]] };
const label = { id: "note", type: "text", text: "same water", x: 740, y: 420, font_size: 36 };

const onStroke = (issues: { rule: string; ids: string[] }[]) => issues.filter((i) => i.rule === "overlap-label-stroke" && i.ids.includes("gc"));

describe("coVisible after a move", () => {
  test("a pair joined after one of them moved is not judged at the old place; a pair from before still is", () => {
    const cmds = [{ draw: ["a", "b"] }, { move: { target: "a", by: [-240, 0] as [number, number] } }, { draw: ["c"] }];
    const together = coVisible(cmds, ["a", "b", "c"]);
    expect(together("a", "b")).toBe(true);
    expect(together("a", "c")).toBe(false);
    expect(together("b", "c")).toBe(true);
  });

  test("the layout no longer flags a label drawn on the spot a glass left", () => {
    const spec = { elements: [glass, label], commands: [{ draw: ["gc"] }, { move: { target: ["gc"], by: [-240, 0] } }, { draw: ["note"], speak: "Same water." }] } as unknown as Spec;
    expect(onStroke(layoutSpec(spec, heuristicMeasure).issues)).toEqual([]);
    const still = { ...spec, commands: [{ draw: ["gc"] }, { draw: ["note"], speak: "Same water." }] } as unknown as Spec;
    expect(onStroke(layoutSpec(still, heuristicMeasure).issues)).toHaveLength(1);
  });
});

describe("posedIssues", () => {
  test("a glass moved away from a label clears the overlap; moved onto one, it is flagged", () => {
    const spec = { elements: [glass, label], commands: [{ draw: ["gc", "note"] }] } as unknown as Spec;
    const laid = layoutSpec(spec, heuristicMeasure);
    expect(onStroke(laid.issues)).toHaveLength(1);
    expect(onStroke(posedIssues(laid.drawables, heuristicMeasure, { offsets: { gc: [-240, 0] } }, laid.issues))).toEqual([]);
    // Moved together, the label keeps the layout's verdict.
    expect(onStroke(posedIssues(laid.drawables, heuristicMeasure, { offsets: { gc: [-240, 0], note: [-240, 0] } }, laid.issues))).toHaveLength(1);

    const apart = { elements: [glass, { ...label, x: 400 }], commands: [{ draw: ["gc", "note"] }] } as unknown as Spec;
    const laid2 = layoutSpec(apart, heuristicMeasure);
    expect(onStroke(laid2.issues)).toEqual([]);
    expect(onStroke(posedIssues(laid2.drawables, heuristicMeasure, { offsets: { gc: [-340, 0] } }, laid2.issues))).toHaveLength(1);
  });

  test("no poses: the layout's issues, untouched", () => {
    const laid = layoutSpec({ elements: [glass, label], commands: [] } as unknown as Spec, heuristicMeasure);
    expect(posedIssues(laid.drawables, heuristicMeasure, { offsets: {} }, laid.issues)).toBe(laid.issues);
  });
});
