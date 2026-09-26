// markov_model's `trace`: the template runs the cohort itself and draws the
// table beside the diagram, so a cast quotes computed numbers instead of doing
// the arithmetic in its narration (Hans, 2026-09-26).

import { describe, expect, test } from "vitest";
import { flattenDrawables, type TextDrawable } from "../src/layout/model";
import { layoutMarkovModel, type MarkovParams } from "../src/scenes/markov_model/layout";

const BASE: MarkovParams = {
  states: ["Well", "Sick", "Dead"],
  transitions: [
    { from: "Well", to: "Sick", label: "0.10" },
    { from: "Sick", to: "Well", label: "0.30" },
    { from: "Sick", to: "Dead", label: "0.05" },
    { from: "Well", to: "Dead", label: "0.01" },
  ],
  self_loops: ["Well", "Sick"],
};

const TRACED: MarkovParams = {
  ...BASE,
  trace: {
    utility: [0.9, 0.5, 0],
    cost: [1000, 5000, 0],
    compare: { name: "With drug", transitions: [{ from: "Well", to: "Sick", label: "0.05" }], cost: [1000, 1000, 0] },
  },
};

function cells(params: MarkovParams, row: string): string[] {
  const l = layoutMarkovModel(params);
  const g = l.drawables.find((d) => d.id === row);
  expect(g, row).toBeDefined();
  return flattenDrawables([g!]).filter((d): d is TextDrawable => d.kind === "text").map((t) => t.text);
}

describe("markov_model trace", () => {
  test("the year rows are the cohort run through the transition probabilities", () => {
    expect(cells(TRACED, "trace_row_0")).toEqual(["Start", "1,000", "0", "0"]);
    // 1000 well: 100 fall sick, 10 die; QALYs 890×0.9 + 100×0.5 = 851; cost 890×£1,000 + 100×£5,000.
    expect(cells(TRACED, "trace_row_1")).toEqual(["Year 1", "890", "100", "10", "851", "£1.39m"]);
    expect(cells(TRACED, "trace_row_2")).toEqual(["Year 2", "822", "154", "24", "817", "£1.59m"]);
  });

  test("totals, the average per person, and the comparison are computed and exposed as values", () => {
    const l = layoutMarkovModel(TRACED);
    const v = l.values!;
    expect(v.qalys_mean).toBeCloseTo(v.qalys_total / 1000, 9);
    expect(v.compare_qalys_mean).toBeGreaterThan(v.qalys_mean); // fewer fall sick
    expect(v.cost_per_qaly).toBeCloseTo((v.compare_cost_mean - v.cost_mean) / (v.compare_qalys_mean - v.qalys_mean), 6);
    expect(cells(TRACED, "trace_mean")[1]).toBe(v.qalys_mean.toFixed(1));
    expect(l.drawables.some((d) => d.id === "trace_icer")).toBe(true);
  });

  test("the table sits right of the diagram, which moves left", () => {
    const l = layoutMarkovModel(TRACED);
    const table = flattenDrawables(l.drawables.filter((d) => d.id.startsWith("trace_"))).filter((d): d is TextDrawable => d.kind === "text");
    const stateXs = ["state_well", "state_sick", "state_dead"].map((id) => l.anchors[id][0]);
    expect(Math.min(...table.map((t) => t.pos[0]))).toBeGreaterThan(Math.max(...stateXs));
  });

  test("no trace, or labels that are not probabilities: no table, the diagram as before", () => {
    const plain = layoutMarkovModel(BASE);
    expect(plain.drawables.some((d) => d.id.startsWith("trace_"))).toBe(false);
    const words = layoutMarkovModel({ ...TRACED, transitions: TRACED.transitions.map((t) => ({ ...t, label: "often" })) });
    expect(words.drawables.some((d) => d.id.startsWith("trace_"))).toBe(false);
    expect(words.anchors.state_well).toEqual(plain.anchors.state_well);
  });
});
