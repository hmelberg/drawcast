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

  test("silent for an id the template never declared (that is the planner's unknown-id warning, not this)", () => {
    const issues = layoutSpec(sd({}, ["something_else"])).issues;
    expect(issues.some((i) => i.rule === "template-id-off")).toBe(false);
  });
});
