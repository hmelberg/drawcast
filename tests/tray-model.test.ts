import { describe, expect, test } from "vitest";
import { sliderSpecs, trayPlan } from "../src/ui/tray-model";

describe("sliderSpecs", () => {
  test("finds a top-level bounded number", () => {
    const schema = { type: "object", properties: { n: { type: "number", minimum: 1, maximum: 100, multipleOf: 1 } } };
    expect(sliderSpecs(schema)).toEqual([{ path: "n", label: "n", min: 1, max: 100, step: 1 }]);
  });

  test("walks nested objects into dot paths", () => {
    const schema = {
      type: "object",
      properties: {
        demand_shift: { type: "object", properties: { amount: { type: "number", minimum: -93, maximum: 95 } } },
      },
    };
    expect(sliderSpecs(schema)).toEqual([{ path: "demand_shift.amount", label: "amount", min: -93, max: 95, step: "any" }]);
  });

  test("takes the number branch of a oneOf", () => {
    const schema = {
      type: "object",
      properties: {
        steepness: { oneOf: [{ type: "string", enum: ["flat", "steep"] }, { type: "number", minimum: 0.25, maximum: 2.5 }] },
      },
    };
    expect(sliderSpecs(schema)).toEqual([{ path: "steepness", label: "steepness", min: 0.25, max: 2.5, step: "any" }]);
  });

  test("a bounded integer gets step 1 by default", () => {
    const schema = { type: "object", properties: { rows: { type: "integer", minimum: 4, maximum: 12 } } };
    expect(sliderSpecs(schema)).toEqual([{ path: "rows", label: "rows", min: 4, max: 12, step: 1 }]);
  });

  test("skips numbers without both bounds, degenerate ranges, and non-schemas", () => {
    const schema = {
      type: "object",
      properties: {
        unbounded: { type: "number" },
        onlyMin: { type: "number", minimum: 0 },
        empty: { type: "number", minimum: 5, maximum: 5 },
        label: { type: "string" },
      },
    };
    expect(sliderSpecs(schema)).toEqual([]);
    expect(sliderSpecs(null)).toEqual([]);
    expect(sliderSpecs("nope")).toEqual([]);
  });
});

describe("x-max-from — a slider bounded by the data's stage count", () => {
  const schema = { type: "object", properties: { stage: { type: "number", minimum: 0, "x-max-from": ["values", "series.0.values"] } } };
  test("staged values give max = stages − 1 with a continuous step", () => {
    expect(sliderSpecs(schema, { values: [[1, 2], [3, 4], [5, 6]] })).toEqual([{ path: "stage", label: "stage", min: 0, max: 2, step: "any" }]);
  });
  test("falls through the candidate paths", () => {
    expect(sliderSpecs(schema, { series: [{ values: [[1], [2]] }] })).toEqual([{ path: "stage", label: "stage", min: 0, max: 1, step: "any" }]);
  });
  test("a static list, a token or a single stage yields no slider", () => {
    expect(sliderSpecs(schema, { values: [1, 2, 3] })).toEqual([]);
    expect(sliderSpecs(schema, { values: "{sim.frames}" })).toEqual([]);
    expect(sliderSpecs(schema, { values: [[1, 2]] })).toEqual([]);
    expect(sliderSpecs(schema)).toEqual([]);
  });
  test("a static maximum still wins over the hint", () => {
    const s = { type: "object", properties: { stage: { type: "number", minimum: 0, maximum: 5, "x-max-from": ["values"] } } };
    expect(sliderSpecs(s, { values: [[1], [2], [3]] })[0].max).toBe(5);
  });
});

describe("trayPlan — what one tray shows when a figure offers several things", () => {
  const base = { sliderPaths: ["n", "rate"], codeIds: ["sim"] };

  test("the ⊕ shows everything the figure offers — sliders AND the script, never one instead of the other", () => {
    const p = trayPlan(base);
    expect(p.sliders).toEqual(["n", "rate"]);
    expect(p.scripts).toEqual([{ id: "sim", expanded: false }]);
    expect(p.activities).toBe(true);
  });

  test("a script is the main event when it is the only control, so it opens expanded", () => {
    expect(trayPlan({ ...base, sliderPaths: [] }).scripts).toEqual([{ id: "sim", expanded: true }]);
  });

  test("clicking a screen expands that script and no other", () => {
    const p = trayPlan({ ...base, codeIds: ["a", "b"], open: "b" });
    expect(p.scripts).toEqual([{ id: "a", expanded: false }, { id: "b", expanded: true }]);
  });

  test("an authored explore shows exactly what the beat named — that editor, nothing else", () => {
    const p = trayPlan({ ...base, gated: true, code: "sim" });
    expect(p.scripts).toEqual([{ id: "sim", expanded: true }]);
    expect(p.sliders).toEqual([]);
    expect(p.activities).toBe(false);
  });

  test("an authored explore naming params shows those sliders and no script", () => {
    const p = trayPlan({ ...base, gated: true, params: ["rate"] });
    expect(p.sliders).toEqual(["rate"]);
    expect(p.scripts).toEqual([]);
  });

  test("a beat that names both gets both; one that names neither gets every slider", () => {
    expect(trayPlan({ ...base, gated: true, params: ["n"], code: "sim" })).toMatchObject({ sliders: ["n"], scripts: [{ id: "sim", expanded: true }] });
    expect(trayPlan({ ...base, gated: true }).sliders).toEqual(["n", "rate"]);
  });

  test("a filter naming a param the figure has no slider for drops it rather than inventing one", () => {
    expect(trayPlan({ ...base, gated: true, params: ["nope"] }).sliders).toEqual([]);
  });
});
