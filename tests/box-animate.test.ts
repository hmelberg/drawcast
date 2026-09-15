import { beforeAll, describe, expect, test } from "vitest";
import { expandBoxAnimate, readParam, withOverrides } from "../src/render/params";
import { layoutSpec, elementBBoxes, domainMapping } from "../src/layout/layout";
import { planCommands } from "../src/render/plan";
import { planOptionsFor } from "../src/render/index";
import { fitRegion } from "../src/layout/regions";
import { ensureEnabledPacks } from "../src/scenes/packs";
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
