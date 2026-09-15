import { beforeAll, describe, expect, test } from "vitest";
import { expandBoxAnimate, readParam, withOverrides } from "../src/render/params";
import { layoutSpec, elementBBoxes, domainMapping, paramsAtFirstDraw } from "../src/layout/layout";
import { planCommands } from "../src/render/plan";
import { planOptionsFor } from "../src/render/index";
import { fitRegion } from "../src/layout/regions";
import { ensureEnabledPacks } from "../src/scenes/packs";
import { lintCommands } from "../src/lint/lint";
import { validateSpec } from "../src/spec/schema";
import type { Spec } from "../src/spec/types";

beforeAll(async () => { await ensureEnabledPacks(["evidence"]); });

describe("a region name stands for its rectangle in param paths", () => {
  test("readParam reads through a fit name", () => {
    expect(readParam({ box: "full" }, "box.x")).toBe(60);
    expect(readParam({ box: "right" }, "box.w")).toBe(420);
    expect(readParam({ box: "middle" }, "box.x")).toBeNull();
    expect(readParam({ box: { x: 1, y: 2, w: 3, h: 4 } }, "box.h")).toBe(4);
  });
  test("withOverrides replaces a fit name by its rectangle before writing into it", () => {
    expect(withOverrides({ box: "full" }, { "box.x": 520, "box.w": 420 })).toEqual({ box: { x: 520, y: 95, w: 420, h: 560 } });
    // untouched when the path does not continue into the box
    expect(withOverrides({ box: "full" }, { other: 1 })).toEqual({ box: "full", other: 1 });
  });
  test("expandBoxAnimate turns a name into four numeric keys and leaves the rest", () => {
    expect(expandBoxAnimate({ box: "right", stage: 1 })).toEqual({ "box.x": 520, "box.y": 95, "box.w": 420, "box.h": 560, stage: 1 });
    expect(expandBoxAnimate({ box: "nowhere" })).toEqual({ box: "nowhere" });
    expect(expandBoxAnimate({ "box.x": 5 })).toEqual({ "box.x": 5 });
  });
});

const cast = (animate: Record<string, unknown>): Spec =>
  ({
    template: "sir_compartments",
    params: { box: "full" },
    commands: [{ draw: ["box_s"] }, { animate, duration: 2 }],
  }) as unknown as Spec;

describe("animate: {box: name} in the planner", () => {
  const plan = (spec: Spec) => {
    const layout = layoutSpec(spec);
    const bboxes = elementBBoxes(layout);
    return planCommands(spec.commands!, layout.order, {
      bboxOf: (id: string) => bboxes.get(id) ?? null,
      windows: layout.windows ?? {},
      ...domainMapping(spec.domain, layout.fit),
      animateBase: spec.params ?? {},
      ...planOptionsFor(spec, layout),
    } as never);
  };
  test("targets are the region's numbers and the starts are the base region's — no jump warning", () => {
    const p = plan(cast({ box: "right" }));
    const step = p.steps.find((s) => s.kind === "animate") as { targets: Record<string, number>; starts: Record<string, number | null> };
    expect(step.targets).toEqual({ "box.x": 520, "box.y": 95, "box.w": 420, "box.h": 560 });
    expect(step.starts).toEqual({ "box.x": 60, "box.y": 95, "box.w": 880, "box.h": 560 });
    expect(p.warnings).toEqual([]);
  });
  test("the layout at the animate's end is the right-half fit", () => {
    const spec = cast({ box: "right" });
    const end = layoutSpec({ ...spec, params: withOverrides(spec.params, expandBoxAnimate({ box: "right" })) });
    expect(end.fit!.box).toEqual(fitRegion("right"));
  });
  test("a non-name box target is dropped with a warning, as any non-number is", () => {
    const p = plan(cast({ box: "nowhere" }));
    expect(p.warnings.some((w) => /animate "box"/.test(w))).toBe(true);
  });
});

const CONTROLS = "import matplotlib.pyplot as plt\nbeta = (0.1, 1.0, 0.05)\ngamma = (0.05, 0.5, 0.05)\nS, I, R = [0.99], [0.01], [0.0]\nfor t in range(160):\n    new = beta * S[-1] * I[-1]\n    rec = gamma * I[-1]\n    S.append(S[-1] - new)\n    I.append(I[-1] + new - rec)\n    R.append(R[-1] + rec)\n_ = plt.plot(S, label=\"S\")\n_ = plt.plot(I, label=\"I\")\n_ = plt.plot(R, label=\"R\")\n_ = plt.legend()";
const SIR_IDS = ["box_s", "box_code_s", "box_name_s", "flow_0", "rate_0", "box_i", "box_code_i", "box_name_i", "flow_1", "rate_1", "box_r", "box_code_r", "box_name_r"];
const knobs = (target: unknown): Spec =>
  ({
    template: "sir_compartments",
    params: { box: "full" },
    elements: [{ id: "sim", type: "code", language: "python", show: "below", pane: "controls", controls: ["beta", "gamma"], code: CONTROLS }],
    commands: [
      { draw: SIR_IDS, speak: "The model, large." },
      { animate: { box: target }, duration: 3, speak: "Now let us make room." },
      { draw: ["sim", "sim_out"], speak: "And the knobs." },
      { explore: { code: "sim" }, speak: "Turn beta." },
    ],
  }) as unknown as Spec;

describe("the lint judges a panel drawn after an animate on the layout of that beat", () => {
  test("full → right, panel drawn after: no overlap issues at all", () => {
    const r = layoutSpec(knobs("right"));
    expect(r.issues.map((i) => `${i.rule}: ${i.message}`)).toEqual([]);
  });
  test("full → a box that still covers the panel's side: overlap-code-figure from the draw-beat layout", () => {
    // expandBoxAnimate leaves an object `box` alone (only names expand), so the
    // rectangle target is written as box.* keys — the way an author would.
    const spec: Spec = {
      template: "sir_compartments",
      params: { box: "full" },
      elements: [{ id: "sim", type: "code", language: "python", show: "below", pane: "controls", controls: ["beta", "gamma"], code: CONTROLS }],
      commands: [
        { draw: SIR_IDS, speak: "The model, large." },
        { animate: { "box.x": 300, "box.w": 640 }, duration: 3, speak: "Now let us make room." },
        { draw: ["sim", "sim_out"], speak: "And the knobs." },
        { explore: { code: "sim" }, speak: "Turn beta." },
      ],
    } as unknown as Spec;
    const r = layoutSpec(spec);
    expect(r.issues.some((i) => i.rule === "overlap-code-figure")).toBe(true);
  });
  test("paramsAtFirstDraw folds the animates before the panel's first draw and is null without any", () => {
    expect(paramsAtFirstDraw(knobs("right"), "sim")).toEqual({ box: { x: 520, y: 95, w: 420, h: 560 } });
    const plain = { ...knobs("right"), commands: [{ draw: SIR_IDS }, { draw: ["sim", "sim_out"] }] } as unknown as Spec;
    expect(paramsAtFirstDraw(plain, "sim")).toBeNull();
  });
  test("pane: controls is not a long script under the output", () => {
    expect(lintCommands(knobs("right")).filter((i: { rule: string }) => i.rule === "code-use")).toEqual([]);
  });
  test("skipDrawBeatLint bypasses the draw-beat pass — the base-layout overlap resurfaces; the default call does not have it", () => {
    const withFlag = layoutSpec(knobs("right"), undefined, undefined, undefined, { skipDrawBeatLint: true });
    expect(withFlag.issues.some((i) => i.rule === "overlap-code-figure")).toBe(true);
    const withoutFlag = layoutSpec(knobs("right"));
    expect(withoutFlag.issues.some((i) => i.rule === "overlap-code-figure")).toBe(false);
  });
  test("a panel left to the implicit final draw (never named in any draw/show) folds to the end of the animates, not the start layout", () => {
    const spec = {
      ...knobs("right"),
      commands: [
        { draw: SIR_IDS, speak: "The model, large." },
        { animate: { box: "right" }, duration: 3, speak: "Now let us make room." },
        { explore: { code: "sim" }, speak: "Turn beta." },
      ],
    } as unknown as Spec;
    expect(paramsAtFirstDraw(spec, "sim")).toEqual({ box: { x: 520, y: 95, w: 420, h: 560 } });
    expect(layoutSpec(spec).issues).toEqual([]);
  });
});

describe("the spec validator accepts a region name under animate.box", () => {
  const minimal = (animate: Record<string, unknown>): Spec =>
    ({
      template: "sir_compartments",
      params: { box: "full" },
      commands: [{ animate }],
    }) as unknown as Spec;

  test("a region name reports no error mentioning animate", () => {
    const v = validateSpec(minimal({ box: "right" }));
    expect(v.errors.filter((e) => e.includes("animate"))).toEqual([]);
  });

  test("a string that is not one of the five names is rejected, naming them", () => {
    const v = validateSpec(minimal({ box: "middle" }));
    expect(v.ok).toBe(false);
    expect(v.errors).toContain(
      'commands[0]: animate "box" must be a region name (left, right, top, bottom, full), a finite number for box.x/box.y/box.w/box.h, or a "{var}" token',
    );
  });

  test("the dotted numeric form still passes", () => {
    const v = validateSpec(minimal({ "box.x": 520 }));
    expect(v.errors.filter((e) => e.includes("animate"))).toEqual([]);
  });
});
