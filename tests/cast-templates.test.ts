// Templates that travel inside a cast (spec.templates): registered on sight,
// never shadowing a built-in or a user template, malformed ones reported.
import { afterEach, describe, expect, test } from "vitest";
import { isCastTemplateId, registerCastTemplates, resetCastTemplates } from "../src/scenes/cast-templates";
import { scenes } from "../src/scenes/registry";
import { validateSpec } from "../src/spec/schema";
import { layoutSpec } from "../src/layout/layout";
import { ensureEnginesForSpecs } from "../src/scenes/engines";
import type { TemplateDoc } from "../src/scenes/doc";

function doc(id: string, extra: Partial<TemplateDoc> = {}): TemplateDoc {
  return {
    template: id, title: "Cast test", version: 1, kit: 1, status: "ready",
    description: "A cast-carried test figure. Choose this for cast tests.",
    params: { type: "object", properties: {} }, element_ids: { ring: "the ring" },
    examples: [{ request: "Draw the cast ring.", params: {} }],
    layout: `return { drawables: [kit.stroke("ring", kit.polygon([500, 400], 120, 6), { closed: true })], labels: [], anchors: {}, order: ["ring"] };`,
    ...extra,
  };
}
const added: string[] = [];
afterEach(() => {
  for (const id of added.splice(0)) delete scenes[id];
  resetCastTemplates();
});

describe("registerCastTemplates", () => {
  test("registers a carried template and a spec using it lays out", () => {
    added.push("cast_ring");
    const r = registerCastTemplates({ templates: [doc("cast_ring")] });
    expect(r).toEqual({ registered: ["cast_ring"], skipped: [], errors: [] });
    expect(isCastTemplateId("cast_ring")).toBe(true);
    const out = layoutSpec({ template: "cast_ring", params: {}, elements: [] } as never);
    expect(out.warnings).toEqual([]);
    expect(out.order).toContain("ring");
  });

  test("never shadows a built-in: the cast's copy is skipped", () => {
    const before = scenes.supply_demand;
    const r = registerCastTemplates({ templates: [doc("supply_demand")] });
    expect(r.skipped).toEqual(["supply_demand"]);
    expect(scenes.supply_demand).toBe(before);
    expect(isCastTemplateId("supply_demand")).toBe(false);
  });

  test("a later cast replaces an earlier cast's copy of the same id", () => {
    added.push("cast_twice");
    registerCastTemplates({ templates: [doc("cast_twice")] });
    const r = registerCastTemplates({ templates: [doc("cast_twice", { version: 2 })] });
    expect(r.registered).toEqual(["cast_twice"]);
    expect(scenes.cast_twice.manifest.status).toBe("ready");
  });

  test("a malformed document is reported, not thrown, and registers nothing", () => {
    const r = registerCastTemplates({ templates: [{ template: "Bad Id", version: 1 }] });
    expect(r.registered).toEqual([]);
    expect(r.errors[0]).toMatch(/templates\[0\]/);
    expect(scenes["Bad Id"]).toBeUndefined();
  });

  test("a document whose body fails to compile leaves no stub behind", () => {
    const r = registerCastTemplates({ templates: [doc("cast_broken", { layout: "return {" })] });
    expect(r.errors[0]).toMatch(/cast_broken/);
    expect(scenes.cast_broken).toBeUndefined();
  });

  test("no templates field is a no-op", () => {
    expect(registerCastTemplates({})).toEqual({ registered: [], skipped: [], errors: [] });
    expect(registerCastTemplates(null)).toEqual({ registered: [], skipped: [], errors: [] });
  });
});

describe("spec.templates", () => {
  test("validateSpec accepts a spec carrying a valid template document", () => {
    const v = validateSpec({ template: "supply_demand", params: {}, commands: [{ draw: ["demand_curve"] }], templates: [doc("cast_valid")] });
    expect(v.ok).toBe(true);
  });

  test("validateSpec rejects a spec carrying a malformed template document", () => {
    const v = validateSpec({ template: "supply_demand", params: {}, commands: [{ draw: ["demand_curve"] }], templates: [{ template: "nope" }] });
    expect(v.ok).toBe(false);
    expect(v.errors.join("\n")).toMatch(/templates\[0\]/);
  });

  test("ensureEnginesForSpecs registers carried templates before reading their engines", async () => {
    added.push("cast_engineless");
    await ensureEnginesForSpecs([{ template: "cast_engineless", templates: [doc("cast_engineless")] }]);
    expect(scenes.cast_engineless?.manifest.status).toBe("ready");
  });
});
