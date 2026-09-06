import { describe, expect, test } from "vitest";
import { choiceSpecs, readChoice, sliderSpecs, trayPlan } from "../src/ui/tray-model";

describe("choiceSpecs — the enum sibling of sliderSpecs", () => {
  test("a string enum becomes one control, its values in schema order", () => {
    const schema = { type: "object", properties: { route: { type: "string", enum: ["oral", "iv"] } } };
    expect(choiceSpecs(schema)).toEqual([{ path: "route", label: "route", values: ["oral", "iv"] }]);
  });

  test("walks nested objects into dot paths, exactly as the sliders do", () => {
    const schema = {
      type: "object",
      properties: { demand: { type: "object", properties: { curvature: { type: "string", enum: ["linear", "convex", "concave"] } } } },
    };
    expect(choiceSpecs(schema)).toEqual([{ path: "demand.curvature", label: "curvature", values: ["linear", "convex", "concave"] }]);
  });

  test("two to six words are a segmented control; seven is a list, and one is no choice at all", () => {
    const modes = (...v: unknown[]): unknown => ({ type: "object", properties: { mode: { type: "string", enum: v } } });
    expect(choiceSpecs(modes("a", "b"))).toHaveLength(1);
    expect(choiceSpecs(modes("a", "b", "c", "d", "e", "f"))[0].values).toHaveLength(6);
    expect(choiceSpecs(modes("a", "b", "c", "d", "e", "f", "g"))).toEqual([]);
    expect(choiceSpecs(modes("only"))).toEqual([]);
    expect(choiceSpecs(modes())).toEqual([]);
  });

  test("only a DECLARED enum counts — prose listing the options is not one", () => {
    const schema = {
      type: "object",
      properties: {
        title: { type: "string" },
        style: { type: "string", description: "one of dotted, dashed or solid" },
        amount: { type: "number", minimum: 0, maximum: 10 },
        show_optimum: { type: "boolean" },
      },
    };
    expect(choiceSpecs(schema)).toEqual([]);
    expect(choiceSpecs(null)).toEqual([]);
    expect(choiceSpecs("nope")).toEqual([]);
  });

  test("a numeric enum is not a choice, and neither is a mixed one — the rule is a string enum", () => {
    expect(choiceSpecs({ type: "object", properties: { curves: { type: "integer", enum: [1, 2, 3] } } })).toEqual([]);
    expect(choiceSpecs({ type: "object", properties: { mode: { type: "string", enum: ["a", 2] } } })).toEqual([]);
  });

  test("takes the enum branch of a oneOf, the way sliderSpecs takes the number branch", () => {
    const schema = {
      type: "object",
      properties: {
        steepness: { oneOf: [{ type: "string", enum: ["gentle", "medium", "steep"] }, { type: "number", minimum: 0.25, maximum: 2.5 }] },
      },
    };
    expect(choiceSpecs(schema)).toEqual([{ path: "steepness", label: "steepness", values: ["gentle", "medium", "steep"] }]);
  });

  test("sliders and choices come off the same walk without swallowing each other", () => {
    const schema = {
      type: "object",
      properties: {
        route: { type: "string", enum: ["oral", "iv"] },
        half_life: { type: "number", minimum: 0.5, maximum: 24 },
        demand: {
          type: "object",
          properties: { curvature: { type: "string", enum: ["linear", "convex"] }, shift: { type: "number", minimum: -10, maximum: 10 } },
        },
      },
    };
    expect(choiceSpecs(schema).map((c) => c.path)).toEqual(["route", "demand.curvature"]);
    expect(sliderSpecs(schema).map((s) => s.path)).toEqual(["half_life", "demand.shift"]);
  });

  test("a oneOf offering BOTH a word and a number is in both lists — the live value decides which the tray shows", () => {
    // supply_demand's steepness: "gentle" | 1.4. Neither derivation can know
    // which the spec actually set, so both claim it and liveSliders /
    // liveChoices (tray.ts) drop the one whose value has the wrong type.
    const schema = {
      type: "object",
      properties: {
        steepness: { oneOf: [{ type: "string", enum: ["gentle", "medium", "steep"] }, { type: "number", minimum: 0.25, maximum: 2.5 }] },
      },
    };
    expect(choiceSpecs(schema).map((c) => c.path)).toEqual(["steepness"]);
    expect(sliderSpecs(schema).map((s) => s.path)).toEqual(["steepness"]);
  });
});

describe("readChoice — the word at a dot path", () => {
  const params = { demand: { curvature: "convex", steepness: 1.4 }, arms: [{ style: "solid" }] };

  test("reads nested words, including through an array index", () => {
    expect(readChoice(params, "demand.curvature")).toBe("convex");
    expect(readChoice(params, "arms.0.style")).toBe("solid");
  });

  test("anything that is not a word reads as nothing — a number belongs to a slider", () => {
    expect(readChoice(params, "demand.steepness")).toBe(null);
    expect(readChoice(params, "demand.missing")).toBe(null);
    expect(readChoice(params, "demand.curvature.deeper")).toBe(null);
    expect(readChoice(undefined, "demand.curvature")).toBe(null);
  });
});

describe("trayPlan — choices ride with the sliders", () => {
  const base = { sliderPaths: ["n"], choicePaths: ["route"], codeIds: ["sim"] };

  test("the ⊕ shows every choice the figure declares, alongside the knobs", () => {
    expect(trayPlan(base)).toMatchObject({ choices: ["route"], sliders: ["n"] });
  });

  test("a figure that declares none plans none", () => {
    expect(trayPlan({ sliderPaths: [], codeIds: [] }).choices).toEqual([]);
  });

  test("an authored explore naming params filters the choices by the same list", () => {
    expect(trayPlan({ ...base, gated: true, params: ["route"] })).toMatchObject({ choices: ["route"], sliders: [] });
    expect(trayPlan({ ...base, gated: true, params: ["n"] })).toMatchObject({ choices: [], sliders: ["n"] });
  });

  test("a beat that names only a script shows no choices either", () => {
    expect(trayPlan({ ...base, gated: true, code: "sim" }).choices).toEqual([]);
  });

  test("a choice is a control too, so a script sharing the tray with one stays folded", () => {
    expect(trayPlan({ sliderPaths: [], choicePaths: ["route"], codeIds: ["sim"] }).scripts).toEqual([{ id: "sim", expanded: false }]);
    expect(trayPlan({ sliderPaths: [], choicePaths: [], codeIds: ["sim"] }).scripts).toEqual([{ id: "sim", expanded: true }]);
  });
});
