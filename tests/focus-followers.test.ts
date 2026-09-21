import { describe, expect, test } from "vitest";
import { planCommands, type PlanStep } from "../src/render/plan";
import { layoutSpec } from "../src/layout/layout";
import { planOptionsFor } from "../src/render/index";
import type { Spec } from "../src/spec/types";

const focusOf = (plan: ReturnType<typeof planCommands>) => plan.steps.find((s) => s.kind === "focus") as Extract<PlanStep, { kind: "focus" }>;

describe("focus keeps what its target carries", () => {
  const attachedTo = (id: string) => (id === "curve" ? ["label_curve"] : []);

  test("an element's label stays lit with the element", () => {
    const plan = planCommands(
      [{ draw: ["curve", "label_curve", "other"] }, { focus: { target: ["curve"] } }],
      ["curve", "label_curve", "other"],
      { attachedTo },
    );
    expect(focusOf(plan).ids).toEqual(["curve", "label_curve"]);
  });

  test("a label the author already named is not kept twice", () => {
    const plan = planCommands(
      [{ draw: ["curve", "label_curve"] }, { focus: { target: ["curve", "label_curve"] } }],
      ["curve", "label_curve"],
      { attachedTo },
    );
    expect(focusOf(plan).ids).toEqual(["curve", "label_curve"]);
  });

  test("a label that has not been drawn yet is not kept — there is nothing to dim", () => {
    const plan = planCommands(
      [{ draw: ["curve"] }, { focus: { target: ["curve"] } }, { draw: ["label_curve"] }],
      ["curve", "label_curve"],
      { attachedTo },
    );
    expect(focusOf(plan).ids).toEqual(["curve"]);
  });

  test("an unattached target is untouched", () => {
    const plan = planCommands([{ draw: ["curve", "other"] }, { focus: { target: ["other"] } }], ["curve", "other"], { attachedTo });
    expect(focusOf(plan).ids).toEqual(["other"]);
  });
});

describe("a template can say which label belongs to which element", () => {
  const spec = {
    title: "probe",
    template: "cost_effectiveness_plane",
    params: { wtp_threshold: 100000, points: [{ label: "The new drug", effect: 0.5, cost: 40000 }] },
    commands: [],
  } as unknown as Spec;

  test("the layout carries the template's own attachments", () => {
    const layout = layoutSpec(spec);
    expect(layout.attached["wtp_line"]).toContain("wtp_label");
  });

  test("the planner reads them through attachedTo, the way it reads label_<id>", () => {
    const layout = layoutSpec(spec);
    expect(planOptionsFor(spec, layout).attachedTo!("wtp_line")).toContain("wtp_label");
  });

  test("a fade on the line takes its price with it", () => {
    const layout = layoutSpec(spec);
    const plan = planCommands(
      [{ draw: ["wtp_line", "wtp_label", "pt_0"] }, { fade: { target: ["wtp_line"], to: 0.2 } }],
      layout.order,
      planOptionsFor(spec, layout),
    );
    const fade = plan.steps.find((s) => s.kind === "fade") as Extract<PlanStep, { kind: "fade" }>;
    expect(fade.items.map((i) => i.id).sort()).toEqual(["wtp_label", "wtp_line"]);
  });
});
