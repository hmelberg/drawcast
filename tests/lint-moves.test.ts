// Lints judge positions after moves (spec 2026-10-04 §6, W5): a label drawn
// where a glass USED to stand is not on the glass. coVisible stops pairing an
// element once a move has taken it off its laid-out place; posedIssues (the
// frames harness, per boundary) judges moved pairs at their real places.
import { describe, expect, test } from "vitest";
import { coVisible } from "../src/lint/lint";
import { posedIssues } from "../src/lint/posed";
import { movedIssues } from "../src/lint/moved";
import { planCommands } from "../src/render/plan";
import { layoutSpec } from "../src/layout/layout";
import { heuristicMeasure } from "../src/layout/measure";
import type { Spec } from "../src/spec/types";

const glass = { id: "gc", type: "path", points: [[690, 640], [690, 230], [790, 230], [790, 640]] };
const label = { id: "note", type: "text", text: "same water", x: 740, y: 420, font_size: 36 };

const onStroke = <T extends { rule: string; ids: string[] }>(issues: T[]): T[] => issues.filter((i) => i.rule === "overlap-label-stroke" && i.ids.includes("gc"));

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

// W31: `check` judges the moved pairs too, statically (lint/moved.ts) — the
// plan's resting pose after each command, the issue named by its command.
describe("movedIssues (the move-aware check)", () => {
  const apart = { ...label, x: 400 };
  const run = (commands: unknown[], elements: unknown[] = [glass, apart]) => movedIssues({ elements, commands } as unknown as Spec, heuristicMeasure);

  test("a glass moved onto a label is flagged after the move, named by it", () => {
    const issues = onStroke(run([{ draw: ["gc", "note"] }, { move: { target: ["gc"], by: [-340, 0] }, speak: "Slide the glass over." }]));
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toContain('after the move gc ("Slide the glass over.…")');
  });

  test("a label drawn after the glass moved onto its spot is flagged (the layout cannot see it)", () => {
    const commands = [{ draw: ["gc"] }, { move: { target: ["gc"], by: [-340, 0] } }, { draw: ["note"], speak: "Same water." }];
    expect(onStroke(layoutSpec({ elements: [glass, apart], commands } as unknown as Spec, heuristicMeasure).issues)).toEqual([]);
    const issues = onStroke(run(commands));
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toContain("after the draw note");
  });

  test("only resting poses: a glass that passes over the label inside one move is not flagged", () => {
    expect(onStroke(run([{ draw: ["gc", "note"] }, { move: { target: ["gc"], by: [-600, 0] } }]))).toEqual([]);
  });

  test("not on screen together: the label erased before the glass arrives is not flagged", () => {
    expect(onStroke(run([{ draw: ["gc", "note"] }, { erase: ["note"] }, { move: { target: ["gc"], by: [-340, 0] } }]))).toEqual([]);
  });

  test("a label that follows its element is not flagged against it, and an overlap the layout reports is not repeated", () => {
    const tag = { id: "tag", type: "label", text: "glass", attach_to: "gc" };
    expect(run([{ draw: ["gc", "tag"] }, { move: { target: ["gc"], by: [-200, 0] } }], [glass, tag]).filter((i) => i.ids.includes("tag"))).toEqual([]);
    expect(onStroke(run([{ draw: ["gc", "note"] }, { move: { target: ["gc", "note"], by: [-100, 0] } }], [glass, label]))).toEqual([]);
  });

  test("a node's words turn with it: a rotated box is not flagged against its own text", () => {
    const box = { id: "xb", type: "node", text: "x", shape: "rect", x: 568, y: 429, width: 56, height: 56 };
    const issues = run([{ draw: ["xb"] }, { move: { target: ["xb"], rotate: -5, pivot: [200, 429] } }], [box]);
    expect(issues).toEqual([]);
  });

  test("the plan names each step's command; the implicit final draw is -1", () => {
    const plan = planCommands([{ draw: ["a"] }, { speak: "x", move: { target: "a", by: [1, 0] } }], ["a", "b"]);
    expect(plan.commandOf?.length).toBe(plan.steps.length);
    expect(plan.commandOf?.[0]).toBe(0);
    expect(plan.commandOf?.at(-1)).toBe(-1);
    expect(new Set(plan.commandOf)).toEqual(new Set([0, 1, -1]));
  });
});
