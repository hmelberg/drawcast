// markov_model's numbers, worked on the figure while paused (2026-09-27):
// the body's scrub math, the derived stay, clamps, the second option's
// entries, label formats, typed input and the host's tap-to-type path.
import { describe, expect, test } from "vitest";
import manifest from "../src/scenes/markov_model/manifest.json";
import { scenes } from "../src/scenes/registry";
import { buildWidgetScene } from "../src/scenes/widget-scene";
import { dragMoveEvent, inputEvent, runWidget } from "../src/scenes/widget-run";
import { markovField, markovParts, markovPatch, markovScrub, markovTarget } from "../src/scenes/markov_model/widget";
import { layoutMarkovModel, lintMarkovModel, type MarkovParams } from "../src/scenes/markov_model/layout";
import { layoutSpec } from "../src/layout/layout";
import { validateSpec } from "../src/spec/schema";
import { planCommands, INITIAL_STATE, type Plan } from "../src/render/plan";
import { readParam, withOverrides } from "../src/render/params";
import { widgetHostFor } from "../src/ui/widget-host";
import type { RenderHandle } from "../src/render";
import type { Pt } from "../src/layout/model";
import type { WidgetScene } from "../src/scenes/widget-types";

const module = scenes["markov_model"];
/** The diagram with labelled stays (Well 0.89, Sick 0.95). */
const CHAIN = manifest.examples[1].params as unknown as MarkovParams;
/** Five states as a matrix, a trace, and a drug that halves Mild → Severe. */
const MATRIX = manifest.examples[3].params as unknown as MarkovParams;

const pageOf = (params: MarkovParams) => layoutSpec({ template: "markov_model", params, commands: [] } as unknown as RenderHandle["spec"]);
const sceneOf = (params: MarkovParams): WidgetScene => buildWidgetScene(module, params as unknown as Record<string, unknown>, { layout: pageOf(params) })!;
const runOn = (params: MarkovParams, events: Parameters<typeof runWidget>[2]) => runWidget(module, params as unknown as Record<string, unknown>, events, { layout: pageOf(params) });
const centre = (sc: WidgetScene, id: string): Pt => {
  const b = sc.boxes.get(id)!;
  return [b.x + b.w / 2, b.y + b.h / 2];
};
const target = (params: MarkovParams, id: string) => markovTarget(id, sceneOf(params))!;
const labels = (p: Partial<MarkovParams>) => (p.transitions ?? []).map((t) => `${t.from}>${t.to} ${t.label}`);

describe("which numbers are the viewer's", () => {
  test("the diagram: every probability arrow label and every labelled stay", () => {
    expect(markovParts(sceneOf(CHAIN)).sort()).toEqual(["loop_label_sick", "loop_label_well", "t_label_0", "t_label_1", "t_label_2"]);
  });

  test("the matrix: the cells transitions name, the stays of rows that have exits, the second option's values, utilities and costs", () => {
    const parts = markovParts(sceneOf(MATRIX));
    expect(parts).toContain("matrix_cell_well_mild");
    expect(parts).toContain("matrix_cell_mild_mild"); // a derived stay
    expect(parts).not.toContain("matrix_cell_well_severe"); // a faint 0: no transition
    expect(parts).not.toContain("matrix_cell_dead_dead"); // absorbing: no exits to rescale
    expect(parts).toContain("matrix_compare_mild_severe");
    expect(parts).toContain("matrix_compare_mild_mild");
    expect(parts).toContain("matrix_utility_severe");
    expect(parts).toContain("matrix_cost_well");
    expect(parts).toContain("matrix_compare_cost_mild");
  });

  test("a label that is not a probability is not a number to scrub", () => {
    const words = { ...CHAIN, transitions: CHAIN.transitions.map((t, i) => (i === 0 ? { ...t, label: "λ" } : t)) };
    expect(markovParts(sceneOf(words))).not.toContain("t_label_0");
  });
});

describe("an exit: scrub, clamp, and the stay it leaves", () => {
  test("Well → Sick 0.10 dragged +20 units is 0.15, written '0.15'; Well's loop caption follows to 0.84", () => {
    const t = target(CHAIN, "t_label_0");
    expect(t).toMatchObject({ kind: "exit", value: 0.1, max: 0.99 });
    const v = markovScrub(t, 20);
    expect(v).toBe(0.15);
    const patch = markovPatch(t, v, CHAIN) as unknown as Partial<MarkovParams>;
    expect(labels(patch)[0]).toBe("Well>Sick 0.15");
    expect(patch.self_loops).toEqual([{ state: "Well", label: "0.84" }, { state: "Sick", label: "0.95" }]);
  });

  test("clamped so the row's stay never goes below 0", () => {
    const t = target(CHAIN, "t_label_0");
    expect(markovScrub(t, 4000)).toBe(0.99);
    expect(markovScrub(t, -4000)).toBe(0);
  });

  test("a base exit the second option inherits must leave ITS row a stay too", () => {
    // The drug raises Mild → Remission to 0.80; Mild → Severe (inherited)
    // may then only go to 1 − 0.80 − 0.02.
    const p = { ...MATRIX, trace: { ...MATRIX.trace!, compare: { name: "Drug", transitions: [{ from: "Mild", to: "Remission", label: "0.80" }] } } };
    expect(target(p, "matrix_cell_mild_severe")).toMatchObject({ kind: "exit", layer: "base", max: 0.18 });
  });

  test("the author's format is kept: a decimal comma stays a comma, three decimals step by 0.001", () => {
    const comma = { ...CHAIN, transitions: CHAIN.transitions.map((t, i) => (i === 0 ? { ...t, label: "0,10" } : t)) };
    const t = target(comma, "t_label_0");
    expect(labels(markovPatch(t, markovScrub(t, 8), comma) as unknown as MarkovParams)[0]).toBe("Well>Sick 0,12");
    const fine = { ...CHAIN, transitions: CHAIN.transitions.map((t, i) => (i === 2 ? { ...t, label: "0.005" } : t)) };
    const f = target(fine, "t_label_2");
    expect(markovScrub(f, 8)).toBe(0.007);
    expect(labels(markovPatch(f, 0.007, fine) as unknown as MarkovParams)[2]).toBe("Well>Dead 0.007");
  });

  test("the matrix cell and the arrow label are one number", () => {
    const both = { ...CHAIN, view: "both" as const };
    expect(target(both, "matrix_cell_well_sick")).toEqual(target(both, "t_label_0"));
  });
});

describe("a stay: derived, so dragging it rescales the row's exits", () => {
  test("Mild's stay 0.66 set to 0.83 halves its three exits (0.12, 0.20, 0.02 → 0.06, 0.10, 0.01)", () => {
    const t = target(MATRIX, "matrix_cell_mild_mild");
    expect(t).toMatchObject({ kind: "stay", value: 0.66 });
    const patch = markovPatch(t, 0.83, MATRIX) as unknown as MarkovParams;
    expect(labels(patch).filter((l) => l.startsWith("Mild>"))).toEqual(["Mild>Severe 0.06", "Mild>Remission 0.10", "Mild>Dead 0.01"]);
    expect(layoutMarkovModel({ ...MATRIX, ...patch }).values!.stay_mild).toBeCloseTo(0.83, 10);
  });

  test("the loop's label is the stay: a drag on it moves the exits and rewrites the caption", () => {
    const t = target(CHAIN, "loop_label_well");
    expect(t).toMatchObject({ kind: "stay", value: 0.89 });
    const patch = markovPatch(t, markovScrub(t, -40), CHAIN) as unknown as MarkovParams;
    // 0.79: the exits 0.10 + 0.01 grow to 0.21 in proportion.
    const exits = patch.transitions.filter((x) => x.from === "Well").map((x) => Number(x.label));
    expect(exits.reduce((a, b) => a + b, 0)).toBeCloseTo(0.21, 10);
    expect(patch.self_loops![0]).toEqual({ state: "Well", label: "0.79" });
  });
});

describe("the second option", () => {
  test("its changed cell edits its own entry; a stay it changes rewrites every exit of its row as its entries", () => {
    const t = target(MATRIX, "matrix_compare_mild_severe");
    expect(t).toMatchObject({ kind: "exit", layer: "compare", value: 0.06 });
    const p1 = markovPatch(t, 0.04, MATRIX) as unknown as { trace: MarkovParams["trace"] };
    expect(p1.trace!.compare!.transitions).toEqual([{ from: "Mild", to: "Severe", label: "0.04" }]);
    expect(p1.trace!.cost).toEqual(MATRIX.trace!.cost); // the rest of trace untouched
    const s = target(MATRIX, "matrix_compare_mild_mild");
    expect(s).toMatchObject({ kind: "stay", layer: "compare", value: 0.72 });
    const p2 = markovPatch(s, 0.86, MATRIX) as unknown as { trace: MarkovParams["trace"] };
    expect(p2.trace!.compare!.transitions).toEqual([
      { from: "Mild", to: "Severe", label: "0.03" },
      { from: "Mild", to: "Remission", label: "0.10" },
      { from: "Mild", to: "Dead", label: "0.01" },
    ]);
  });

  test("an entry is added for a transition it did not change yet", () => {
    const t = { kind: "exit" as const, layer: "compare" as const, i: 0, j: 1, value: 0.08, max: 0.99, written: "0.08", name: "x" };
    const p = markovPatch(t, 0.05, MATRIX) as unknown as { trace: MarkovParams["trace"] };
    expect(p.trace!.compare!.transitions).toContainEqual({ from: "Well", to: "Mild", label: "0.05" });
  });

  test("its cost is drawn as the year's TOTAL and stored as what it adds", () => {
    const t = target(MATRIX, "matrix_compare_cost_mild");
    expect(t).toMatchObject({ kind: "compare_cost", value: 5500 });
    const p = markovPatch(t, 4000, MATRIX) as unknown as { trace: MarkovParams["trace"] };
    expect(p.trace!.compare!.cost).toEqual([0, 1500, 0, 0, 0]);
  });
});

describe("utilities and costs", () => {
  test("a utility steps by 0.01 near 0.75; a cost by ~1 % (12 000 → 200), never below 0", () => {
    const u = target(MATRIX, "matrix_utility_mild");
    expect(markovScrub(u, 8)).toBe(0.77);
    const c = target(MATRIX, "matrix_cost_severe");
    expect(markovScrub(c, 12)).toBe(12600);
    expect(markovScrub(c, -40000)).toBe(0);
    expect((markovPatch(c, 9000, MATRIX) as unknown as { trace: MarkovParams["trace"] }).trace!.cost).toEqual([200, 2500, 9000, 800, 0]);
  });

  test("a short utility array is padded with the zeros it meant", () => {
    const p = { ...MATRIX, trace: { ...MATRIX.trace!, utility: [0.9] } };
    expect((markovPatch(target(p, "matrix_utility_mild"), 0.5, p) as unknown as { trace: MarkovParams["trace"] }).trace!.utility).toEqual([0.9, 0.5, 0, 0, 0]);
  });

  test("fields: a probability 0 to its max, a cost from 0, a utility unbounded (worse than dead is allowed)", () => {
    expect(markovField(target(CHAIN, "t_label_0"))).toMatchObject({ min: 0, max: 0.99, step: 0.01, label: "Well → Sick probability" });
    expect(markovField(target(MATRIX, "matrix_cost_well"))).toMatchObject({ min: 0, label: "Cost a year in Well" });
    expect(markovField(target(MATRIX, "matrix_utility_well")).min).toBeUndefined();
  });
});

describe("live: the trace and the ICER follow a drag", () => {
  test("a drag on the drug's Mild → Severe cell changes the ICER line", () => {
    const before = layoutMarkovModel(MATRIX).values!.icer;
    const sc = sceneOf(MATRIX);
    const from = centre(sc, "matrix_compare_mild_severe");
    const run = runOn(MATRIX, [dragMoveEvent("matrix_compare_mild_severe", from, [from[0] - 20, from[1]], sc)]);
    expect(run.errors).toEqual([]);
    const after = run.params as unknown as MarkovParams;
    expect(after.trace!.compare!.transitions).toEqual([{ from: "Mild", to: "Severe", label: "0.01" }]);
    expect(layoutMarkovModel(after).values!.icer).not.toBeCloseTo(before, 0);
  });

  test("a typed value arrives as an input event", () => {
    const run = runOn(MATRIX, [inputEvent("matrix_cell_well_mild", 0.2)]);
    expect(labels(run.params as unknown as MarkovParams)[0]).toBe("Well>Mild 0.20");
  });
});

describe("the movie form: a cast sweeps a transition probability", () => {
  test("animate of transitions.0.label starts from the drawn '0.10' and every frame draws as text", () => {
    const spec = { template: "markov_model", params: CHAIN, commands: [{ animate: { "transitions.0.label": 0.3 }, duration: 2 }] };
    expect(validateSpec(spec).ok).toBe(true);
    expect(readParam(CHAIN as unknown as Record<string, unknown>, "transitions.0.label")).toBe(0.1);
    const plan = planCommands(spec.commands as never, [], { animateBase: CHAIN as unknown as Record<string, unknown> });
    const step = plan.steps.find((s) => s.kind === "animate") as { starts: Record<string, number | null> };
    expect(step.starts["transitions.0.label"]).toBe(0.1);
    // A frame midway: the label is a number now — drawn and read as text.
    const mid = withOverrides(CHAIN as unknown as Record<string, unknown>, { "transitions.0.label": 0.2 }) as unknown as MarkovParams;
    const lay = layoutMarkovModel(mid);
    expect(lay.labels.find((l) => l.id === "t_label_0")!.text).toBe("0.20");
    expect(lintMarkovModel(mid)).toEqual([]);
    const m = { ...mid, view: "matrix" as const, trace: {} };
    expect(layoutMarkovModel(m).values!.p_well_sick).toBeCloseTo(0.2, 10);
    // …and the viewer can take hold of it where the sweep left it.
    expect(target(mid, "t_label_0")).toMatchObject({ value: 0.2, written: "0.20" });
  });

  test("a utility (a number already) sweeps as any param does", () => {
    const plan = planCommands([{ animate: { "trace.utility.1": 0.5 }, duration: 1 }] as never, [], { animateBase: MATRIX as unknown as Record<string, unknown> });
    expect((plan.steps.find((s) => s.kind === "animate") as { starts: Record<string, number | null> }).starts["trace.utility.1"]).toBe(0.75);
  });
});

// ---- the host ---------------------------------------------------------------

function fakePlan(order: string[]): Plan {
  return { steps: [], states: [{ ...INITIAL_STATE, visible: order }], labels: {}, warnings: [], minted: [] } as unknown as Plan;
}

function mkHandle(params: MarkovParams) {
  const spec = { template: "markov_model", params, commands: [] } as unknown as RenderHandle["spec"];
  const layout = layoutSpec(spec);
  const previews: Record<string, unknown>[] = [];
  let painted: ReturnType<typeof layoutSpec> | null = null;
  const timeline = {
    state: "paused",
    position: 1,
    vars: new Map<string, string>(),
    callbacks: {},
    previewParams: (o: Record<string, unknown>) => {
      painted = layoutSpec({ ...spec, params: { ...params, ...o } } as unknown as RenderHandle["spec"]);
      previews.push(o);
    },
    paintedLayout: () => painted,
    glow: async () => undefined,
    tapAt: async () => undefined,
    caption: () => undefined,
    getParamOverrides: () => ({}),
  };
  const hd = { spec, layout, plan: fakePlan(layout.order), timeline } as unknown as RenderHandle;
  const host = widgetHostFor(hd, { frame: (fn) => (fn(), () => undefined), warn: () => undefined })!;
  return { host, previews, sc: sceneOf(params) };
}

describe("the host: tap to type a matrix cost", () => {
  test("a tap on Severe's cost opens a field named for it; 9000 lands in trace.cost", () => {
    const { host, previews, sc } = mkHandle(MATRIX);
    const p = centre(sc, "matrix_cost_severe");
    expect(host.scrubbable(p)).toBe(true);
    host.press(p);
    expect(host.release(p)).toBe("edit");
    expect(host.editField()!.field).toMatchObject({ value: 12000, label: "Cost a year in Severe", min: 0 });
    expect(host.commitEdit("-5")).toMatchObject({ ok: false });
    expect(host.commitEdit("9000")).toEqual({ ok: true });
    expect((previews.at(-1) as { trace: MarkovParams["trace"] }).trace!.cost![2]).toBe(9000);
  });

  test("a stay typed above what its exits allow is refused (bounds, not a clamp)", () => {
    const { host, sc } = mkHandle(MATRIX);
    const p = centre(sc, "matrix_cell_well_mild");
    host.press(p);
    host.release(p);
    expect(host.editField()!.field.max).toBe(0.99);
    expect(host.commitEdit("0.995")).toMatchObject({ ok: false });
  });
});
