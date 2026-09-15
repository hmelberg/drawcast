import { beforeAll, describe, expect, test } from "vitest";
import { templateParamErrors } from "../src/scenes/params-check";
import { ensureEnabledPacks } from "../src/scenes/packs";

beforeAll(async () => {
  await ensureEnabledPacks(["data", "evidence", "music", "biology"]);
});

describe("params check — box", () => {
  test("a native-box template accepts a region name (resolved to its rectangle before Ajv sees it)", () => {
    expect(templateParamErrors("bar_chart", { labels: ["a", "b"], values: [1, 2], box: "right" })).toEqual([]);
  });
  test("a native-box template still rejects a box that is neither", () => {
    expect(templateParamErrors("bar_chart", { labels: ["a", "b"], values: [1, 2], box: "middle" }).length).toBeGreaterThan(0);
  });
  test("a template without a native box accepts both forms (box is stripped before Ajv sees it, so its own schema never has to)", () => {
    expect(templateParamErrors("sir_compartments", { box: "left" })).toEqual([]);
    expect(templateParamErrors("sir_compartments", { box: { x: 60, y: 95, w: 420, h: 560 } })).toEqual([]);
  });
  test("a template whose schema closes params (additionalProperties: false) still accepts a region-name box", () => {
    expect(templateParamErrors("violin_anatomy", { box: "right" })).toEqual([]);
  });
  test("a template whose schema closes params still accepts a rectangle box", () => {
    expect(templateParamErrors("flower_anatomy", { box: { x: 60, y: 95, w: 420, h: 560 } })).toEqual([]);
  });
});
