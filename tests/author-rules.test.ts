// Template-on-demand step 3: the refreshed authoring rules — warnings earn
// one repair, the drillable-parts lint, and what the author prompt carries.
import { describe, expect, test } from "vitest";
import { buildAuthorSystem, needsAuthorRepair, partsIssues, secondExemplarYaml } from "../src/llm/author";
import { layoutSpec } from "../src/layout/layout";
import { heuristicMeasure } from "../src/layout/measure";
import { ensureEnabledPacks } from "../src/scenes/packs";
import type { LintIssue } from "../src/lint/lint";

describe("needsAuthorRepair", () => {
  const warn: LintIssue = { rule: "overlap-label-stroke", ids: [], message: "x", severity: "warn" };
  const err: LintIssue = { rule: "out-of-canvas", ids: [], message: "x", severity: "error" };
  test("errors and error-level lint always repair", () => {
    expect(needsAuthorRepair(["bad"], [], 0)).toBe(true);
    expect(needsAuthorRepair([], [err], 2)).toBe(true);
  });
  test("warnings earn exactly one repair round", () => {
    expect(needsAuthorRepair([], [warn], 0)).toBe(true);
    expect(needsAuthorRepair([], [warn], 1)).toBe(false);
    expect(needsAuthorRepair([], [], 0)).toBe(false);
  });
});

describe("partsIssues (the drillable-parts authoring lint)", () => {
  test("a small figure is never asked for parts", () => {
    expect(partsIssues({ drawables: [], order: [] }, heuristicMeasure)).toEqual([]);
  });
  test("a figure with named outlined parts passes; one of many strokes without any gets one warning", async () => {
    await ensureEnabledPacks(["music"]);
    const violin = layoutSpec({ template: "violin_anatomy", params: {}, elements: [] } as never, heuristicMeasure);
    expect(partsIssues(violin, heuristicMeasure)).toEqual([]);
    const bare = layoutSpec({ template: "supply_demand", params: {}, elements: [] } as never, heuristicMeasure);
    const issues = partsIssues(bare, heuristicMeasure);
    expect(issues.map((i) => [i.rule, i.severity])).toEqual([["drillable-parts", "warn"]]);
    expect(issues[0].message).toContain("label_<part>");
  });
});

describe("buildAuthorSystem (refreshed)", () => {
  test("carries the engine interfaces, both exemplars and the parts rule, with every placeholder filled", () => {
    const text = buildAuthorSystem()[0].text;
    expect(text).toContain("export interface AnatomyEngine");
    expect(text).toContain("template: cell_diagram");
    expect(text).toContain("template: violin_anatomy");
    expect(text).toContain("label_<part>");
    expect(text).toContain("Never draw a title");
    expect(text).not.toContain("{{");
  });
  test("the second exemplar is the bundled violin, serialised as a document", () => {
    const y = secondExemplarYaml();
    expect(y.startsWith("template: violin_anatomy")).toBe(true);
    expect(y).toContain("layout: |");
  });
});
