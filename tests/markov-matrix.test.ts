// markov_model's transition matrix (`view: "matrix" | "both"`): the grid, its
// derived diagonal, the compare layer, the page it shares with `trace`, the
// live values a later drag/tap widget will read, and the template's own lint.

import { describe, expect, test } from "vitest";
import { flattenDrawables, type TextDrawable } from "../src/layout/model";
import { layoutSpec } from "../src/layout/layout";
import { heuristicMeasure } from "../src/layout/measure";
import { CANVAS } from "../src/layout/canvas";
import type { Spec } from "../src/spec/types";
import {
  layoutMarkovModel,
  MAX_MATRIX_STATES,
  MAX_TRACE_BESIDE,
  type MarkovParams,
} from "../src/scenes/markov_model/layout";
import manifest from "../src/scenes/markov_model/manifest.json";

const BASE: MarkovParams = {
  states: ["Well", "Sick", "Dead"],
  transitions: [
    { from: "Well", to: "Sick", label: "0.10" },
    { from: "Sick", to: "Well", label: "0.30" },
    { from: "Sick", to: "Dead", label: "0.05" },
    { from: "Well", to: "Dead", label: "0.01" },
  ],
};
const TRACE = {
  utility: [0.9, 0.5, 0],
  cost: [1000, 5000, 0],
  compare: { name: "With drug", transitions: [{ from: "Well", to: "Sick", label: "0.05" }], cost: [1000, 1000, 0] },
};

function textOf(l: ReturnType<typeof layoutMarkovModel>, id: string): string {
  const d = l.drawables.find((x) => x.id === id);
  expect(d, id).toBeDefined();
  const leaves = flattenDrawables([d!]).filter((x): x is TextDrawable => x.kind === "text");
  return leaves.map((t) => t.text).join(" ");
}

/** A chain of n states, each moving on with 0.1 and dying with 0.02. */
function chain(n: number): MarkovParams {
  const states = Array.from({ length: n }, (_, i) => (i === n - 1 ? "Dead" : `S${i + 1}`));
  const transitions = states.slice(0, -1).flatMap((s, i) =>
    i + 1 === n - 1 ? [{ from: s, to: "Dead", label: "0.12" }] : [{ from: s, to: states[i + 1], label: "0.10" }, { from: s, to: "Dead", label: "0.02" }],
  );
  return { states, transitions };
}

describe("markov_model matrix", () => {
  test("a cell per from/to pair; the diagonal is derived as 1 − the row's exits", () => {
    const l = layoutMarkovModel({ ...BASE, view: "matrix" });
    expect(textOf(l, "matrix_cell_well_sick")).toBe("0.10");
    expect(textOf(l, "matrix_cell_well_well")).toBe("0.89");
    expect(textOf(l, "matrix_cell_sick_sick")).toBe("0.65");
    expect(textOf(l, "matrix_cell_dead_dead")).toBe("1"); // absorbing
    expect(textOf(l, "matrix_cell_dead_well")).toBe("0");
    // Derived = grey, on a wash; a given probability = ink.
    const diag = flattenDrawables(l.drawables.filter((d) => d.id === "matrix_cell_well_well"));
    expect(diag.some((d) => d.kind === "area")).toBe(true);
    const stay = diag.find((d): d is TextDrawable => d.kind === "text")!;
    const given = l.drawables.find((d) => d.id === "matrix_cell_well_sick") as TextDrawable;
    expect(stay.style.color).not.toBe(given.style.color);
  });

  test("ids are stable and addressable, and the sets name what a beat wants", () => {
    const l = layoutMarkovModel({ ...BASE, view: "matrix", trace: TRACE });
    for (const id of [
      "matrix_corner", "matrix_rule_head", "matrix_rule_from", "matrix_rule_values",
      "matrix_head_row_well", "matrix_head_col_dead", "matrix_head_utility", "matrix_head_cost",
      "matrix_utility_sick", "matrix_cost_sick", "matrix_compare_well_sick", "matrix_compare_well_well",
      "matrix_compare_cost_well", "matrix_compare_name",
    ]) {
      expect(l.order, id).toContain(id);
      expect(l.anchors[id], id).toBeDefined();
    }
    for (const a of ["well", "sick", "dead"]) for (const b of ["well", "sick", "dead"]) expect(l.order).toContain(`matrix_cell_${a}_${b}`);
    expect(textOf(l, "matrix_compare_well_sick")).toBe("0.05");
    expect(textOf(l, "matrix_compare_well_well")).toBe("0.94"); // the stay the option implies
    expect(textOf(l, "matrix_compare_cost_well")).toBe("£2,000");
    // Unchanged cells carry no compare value.
    expect(l.order).not.toContain("matrix_compare_sick_well");
    expect(l.groups!.matrix_row_well).toEqual(expect.arrayContaining(["matrix_head_row_well", "matrix_cell_well_well", "matrix_cell_well_sick", "matrix_utility_well", "matrix_cost_well"]));
    expect(l.groups!.matrix_stay).toEqual(["matrix_cell_well_well", "matrix_cell_sick_sick", "matrix_cell_dead_dead"]);
    expect(l.groups!.matrix_compare).toContain("matrix_compare_well_sick");
    expect(l.groups!.matrix).not.toContain("matrix_compare_well_sick");
    // With the matrix, the table leaves its utility/cost rows to the matrix columns.
    expect(l.order).not.toContain("trace_utility");
    expect(l.order).toContain("trace_row_1");
    // Every matrix id the manifest's patterns promise is documented there.
    const keys = Object.keys(manifest.element_ids);
    for (const k of ["matrix", "matrix_cell_<from>_<to>", "matrix_compare_<from>_<to>", "matrix_row_<slug>", "matrix_utility_<slug>"]) expect(keys).toContain(k);
  });

  test("the same params give the same ids and places (a widget can address a cell across relayouts)", () => {
    const a = layoutMarkovModel({ ...BASE, view: "both", trace: TRACE });
    const b = layoutMarkovModel({ ...BASE, view: "both", trace: TRACE });
    expect(a.order).toEqual(b.order);
    expect(a.anchors.matrix_cell_sick_dead).toEqual(b.anchors.matrix_cell_sick_dead);
    // A changed probability moves no cell.
    const c = layoutMarkovModel({ ...BASE, view: "both", trace: TRACE, transitions: BASE.transitions.map((t, i) => (i === 0 ? { ...t, label: "0.20" } : t)) });
    expect(c.anchors.matrix_cell_well_sick).toEqual(a.anchors.matrix_cell_well_sick);
  });

  test("view: diagram draws no matrix; matrix draws no diagram; both draws both, apart", () => {
    const d = layoutMarkovModel(BASE);
    expect(d.order.some((id) => id.startsWith("matrix"))).toBe(false);
    const m = layoutMarkovModel({ ...BASE, view: "matrix" });
    expect(m.order.some((id) => id.startsWith("state_") || /^t_\d/.test(id))).toBe(false);
    const both = layoutMarkovModel({ ...BASE, view: "both" });
    const states = ["state_well", "state_sick", "state_dead"].map((id) => both.anchors[id][0]);
    const cells = both.order.filter((id) => id.startsWith("matrix_cell_")).map((id) => both.anchors[id][0]);
    expect(Math.max(...states)).toBeLessThan(Math.min(...cells));
  });

  test("up to 10 states in the matrix, and the trace table runs with them", () => {
    const p = { ...chain(MAX_MATRIX_STATES), view: "matrix" as const, trace: { utility: Array(10).fill(0.8), cost: Array(10).fill(100) } };
    const l = layoutMarkovModel(p);
    expect(l.order).toContain("matrix_cell_s9_dead");
    expect(l.order).toContain("trace_row_2");
    // ...on the canvas, and no text under the lint's floor.
    for (const d of flattenDrawables(l.drawables)) {
      if (d.kind === "text") {
        expect(d.fontSize, d.id).toBeGreaterThanOrEqual(14);
        expect(d.pos[1], d.id).toBeGreaterThan(10);
        expect(d.pos[1], d.id).toBeLessThan(CANVAS.h - 60);
      }
    }
    // The diagram keeps its limits: 6 states, and a table beside it of 4.
    const diagram = layoutMarkovModel({ ...chain(8) });
    expect(diagram.order).not.toContain("state_s7");
    const beside = layoutMarkovModel({ ...chain(MAX_TRACE_BESIDE + 1), trace: {} });
    expect(beside.order.some((id) => id.startsWith("trace_"))).toBe(false);
    const under = layoutMarkovModel({ ...chain(MAX_TRACE_BESIDE + 1), view: "both", trace: {} });
    expect(under.order).toContain("trace_mean");
  });

  test("the matrix and the table never overlap", () => {
    const l = layoutMarkovModel({ ...BASE, view: "matrix", trace: { ...TRACE, cycles: 4 } });
    const ys = (pre: string) => flattenDrawables(l.drawables.filter((d) => d.id.startsWith(pre))).filter((d): d is TextDrawable => d.kind === "text").map((t) => t.pos[1]);
    expect(Math.min(...ys("matrix_"))).toBeGreaterThan(Math.max(...ys("trace_")));
  });
});

describe("markov_model values", () => {
  test("per-state stays, transition probabilities, inputs and the run's results", () => {
    const v = layoutMarkovModel({ ...BASE, view: "matrix", trace: TRACE }).values!;
    expect(v.stay_well).toBeCloseTo(0.89, 12);
    expect(v.stay_dead).toBe(1);
    expect(v.p_well_sick).toBeCloseTo(0.1, 12);
    expect(v.compare_p_well_sick).toBeCloseTo(0.05, 12);
    expect(v.compare_stay_well).toBeCloseTo(0.94, 12);
    expect(v.utility_sick).toBe(0.5);
    expect(v.cost_sick).toBe(5000);
    expect(v.compare_cost_well).toBe(2000);
    for (const k of ["qalys_mean", "cost_mean", "qalys_total", "cost_total", "compare_qalys_mean", "compare_cost_mean", "qalys_gained", "cost_added", "icer"]) {
      expect(Number.isFinite(v[k]), k).toBe(true);
    }
    expect(v.icer).toBeCloseTo(v.cost_added / v.qalys_gained, 9);
    expect(v.qalys_gained).toBeCloseTo(v.compare_qalys_mean - v.qalys_mean, 12);
  });

  test("the values do not depend on the view (the numbers are the model's, not the picture's)", () => {
    const a = layoutMarkovModel({ ...BASE, trace: TRACE }).values!;
    const b = layoutMarkovModel({ ...BASE, view: "matrix", trace: TRACE }).values!;
    expect(b).toEqual(a);
  });

  test("{markov.<key>} tokens resolve in a cast's own text", () => {
    const spec = {
      template: "markov_model",
      params: { ...BASE, view: "matrix", trace: TRACE },
      elements: [{ id: "note", type: "text", x: 500, y: 40, text: "stay {markov.stay_well:2}, ICER {markov.icer:0}" }],
      commands: [],
    } as unknown as Spec;
    const l = layoutSpec(spec, heuristicMeasure);
    const v = layoutMarkovModel({ ...BASE, view: "matrix", trace: TRACE }).values!;
    const note = flattenDrawables(l.drawables).find((d) => d.id === "note") as TextDrawable;
    expect(note.text).toBe(`stay 0.89, ICER ${Math.round(v.icer)}`);
  });
});

describe("markov_model lint", () => {
  const lint = (params: MarkovParams) =>
    layoutSpec({ template: "markov_model", params, commands: [] } as unknown as Spec, heuristicMeasure).issues.filter((i) => i.rule === "template-params");

  test("exits adding up to more than 1: an error, and the diagonal shows the negative stay in red", () => {
    expect(lint({ ...BASE, view: "matrix" })).toEqual([]);
    const over = { ...BASE, view: "matrix" as const, transitions: BASE.transitions.map((t) => (t.from === "Sick" && t.to === "Dead" ? { ...t, label: "0.80" } : t)) };
    const e = lint(over);
    expect(e.some((i) => i.severity === "error" && /out of Sick add up to 1.1/.test(i.message))).toBe(true);
    expect(textOf(layoutMarkovModel(over), "matrix_cell_sick_sick")).toBe("−0.10");
  });

  test("a label that is not a probability: an error with the matrix or trace, silence without", () => {
    const words = { ...BASE, transitions: BASE.transitions.map((t, i) => (i === 0 ? { ...t, label: "often" } : t)) };
    expect(lint(words)).toEqual([]);
    expect(lint({ ...words, view: "matrix" }).some((i) => i.severity === "error" && /Well → Sick has label "often"/.test(i.message))).toBe(true);
    expect(lint({ ...words, trace: {} }).some((i) => i.severity === "error" && /not|probabilit/.test(i.message))).toBe(true);
    // The compare option's labels are checked too.
    const cmp = { ...BASE, trace: { compare: { name: "Drug", transitions: [{ from: "Well", to: "Sick", label: "1.5" }] } } };
    expect(lint(cmp).some((i) => /Drug: transition Well → Sick/.test(i.message))).toBe(true);
  });

  test("too many states for the view, a trace too wide to sit beside the diagram, a compare change of nothing", () => {
    expect(lint(chain(8)).some((i) => /view "matrix"/.test(i.message))).toBe(true);
    expect(lint({ ...chain(8), view: "matrix" })).toEqual([]);
    expect(lint({ ...chain(5), trace: {} }).some((i) => i.severity === "error" && /fits 4 states/.test(i.message))).toBe(true);
    const ghost = { ...BASE, trace: { compare: { name: "Drug", transitions: [{ from: "Dead", to: "Well", label: "0.5" }] } } };
    expect(lint(ghost).some((i) => i.severity === "warn" && /Dead → Well, which is not in transitions/.test(i.message))).toBe(true);
  });
});
