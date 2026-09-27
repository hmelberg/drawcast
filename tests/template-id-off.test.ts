// A command naming a template id that the template DECLARES (element_ids)
// but did not DRAW under these params: until now a plan warning ("unknown id
// — dropped"), which never reached the repair loop, so the model's
// `draw: ["dwl_region"]` on a page without "deadweight_loss" in regions
// shipped as a beat that drew nothing (the Haiku specimen, 2026-09-22). Now
// an error, worded with the template's own doc string for that id — which
// is where the manifest names the param that switches it on.

import { describe, expect, test } from "vitest";
import { layoutSpec } from "../src/layout/layout";
import type { Spec } from "../src/spec/types";

const sd = (params: object, ids: string[]): Spec =>
  ({ template: "supply_demand", params, commands: [{ draw: ["axes"] }, { draw: ids, speak: "…" }] }) as unknown as Spec;

describe("template-id-off", () => {
  test("drawing a declared-but-absent template id is an error naming the switch", () => {
    const issues = layoutSpec(sd({}, ["dwl_region"])).issues.filter((i) => i.rule === "template-id-off");
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe("error");
    expect(issues[0].message).toContain("dwl_region");
    expect(issues[0].message).toContain("deadweight_loss");
  });

  test("silent when the template draws it", () => {
    const issues = layoutSpec(sd({ tax: { amount: 20 }, regions: ["deadweight_loss"] }, ["dwl_region"])).issues;
    expect(issues.some((i) => i.rule === "template-id-off")).toBe(false);
  });

  // The compiler prompt says to write an animated param's STARTING value in
  // params and then animate it — and a tax that grows from 0 is the natural
  // teaching move. At 0 there is no wedge and no deadweight loss yet, but the
  // player reveals every id a tween mints, so they open with the tax. An LLM
  // experiment hit this as an error and had to start the tax at full size.
  const growing = (regions: string[], tail: object[] = [{ animate: { "tax.amount": 10 }, duration: 3, speak: "…" }]): Spec =>
    ({
      template: "supply_demand",
      params: { tax: { amount: 0 }, regions },
      commands: [
        { draw: ["axes", "demand_curve", "supply_curve"], speak: "…" },
        { draw: ["tax_supply_curve", "label_S_tax", "wedge_region", "dwl_region"], speak: "…" },
        ...tail,
      ],
    }) as unknown as Spec;

  test("silent for an id a LATER animate brings into being (a tax growing from 0)", () => {
    const issues = layoutSpec(growing(["government_revenue", "deadweight_loss"])).issues;
    expect(issues.filter((i) => i.rule === "template-id-off")).toEqual([]);
  });

  test("still an error when no state of the cast ever produces it", () => {
    // Animated, but `regions` never lists the areas: nothing ever shades.
    const issues = layoutSpec(growing([])).issues.filter((i) => i.rule === "template-id-off");
    expect(issues.map((i) => i.message.match(/draw "(\w+)"/)?.[1]).sort()).toEqual(["dwl_region", "wedge_region"]);
  });

  test("still an error when the only animate that would produce it ran BEFORE the draw and was undone", () => {
    const spec = growing(["government_revenue", "deadweight_loss"], []);
    spec.commands = [
      { animate: { "tax.amount": 10 }, duration: 1, speak: "…" } as never,
      { animate: { "tax.amount": 0 }, duration: 1, speak: "…" } as never,
      ...(spec.commands ?? []),
    ];
    const issues = layoutSpec(spec).issues.filter((i) => i.rule === "template-id-off");
    expect(issues.map((i) => i.message.match(/draw "(\w+)"/)?.[1]).sort()).toEqual(["dwl_region", "wedge_region"]);
  });

  test("silent for an id the template never declared (that is the planner's unknown-id warning, not this)", () => {
    const issues = layoutSpec(sd({}, ["something_else"])).issues;
    expect(issues.some((i) => i.rule === "template-id-off")).toBe(false);
  });
});
