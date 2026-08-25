import { afterEach, describe, expect, test } from "vitest";
import { catalogText, detectNeedTemplate, selectTemplates, TEMPLATE_FULL_THRESHOLD } from "../src/scenes/catalog";
import { scenes } from "../src/scenes/registry";
import { registerTemplateDoc } from "../src/scenes/registry";
import type { TemplateDoc } from "../src/scenes/doc";

const added: string[] = [];
function addFake(id: string): void {
  const doc: TemplateDoc = {
    template: id, version: 1, kit: 1, status: "ready",
    description: `Fake ${id} figure. Second sentence.`,
    params: {}, element_ids: {},
    examples: [{ request: `Draw the ${id} thing.`, params: {} }],
    layout: `return { drawables: [], labels: [], anchors: {}, order: [] };`,
  };
  registerTemplateDoc(doc);
  added.push(id);
}
/** Registers throwaway templates until the catalog is in its two-level regime — whatever the threshold and the built-in library currently are. */
function fillPastThreshold(): void {
  const ready = () => Object.values(scenes).filter((s) => s.manifest.status === "ready").length;
  for (let i = 0; ready() <= TEMPLATE_FULL_THRESHOLD; i++) addFake(`fake_${i}`);
}

afterEach(() => {
  for (const id of added.splice(0)) delete scenes[id];
});

describe("catalogText below the threshold", () => {
  test("matches the legacy full-entry format (no index, no escalation)", () => {
    const t = catalogText();
    expect(t).toContain("### Scene template: supply_demand (READY");
    expect(t).toContain("STUB — do NOT set template");
    expect(t).not.toContain("need_template");
  });

  test("forced yields exactly one full entry plus the MUST line", () => {
    const t = catalogText({ forced: "free_body" });
    expect(t).toContain("### Scene template: free_body (READY");
    expect(t).not.toContain("### Scene template: supply_demand");
    expect(t).toContain('You MUST set "template" to "free_body"');
  });
});

describe("catalogText above the threshold", () => {
  test("complete index + hot-set full entries + escalation prose", () => {
    fillPastThreshold();
    const t = catalogText({ request: "Draw the fake_3 thing." });
    for (let i = 0; i < 8; i++) expect(t).toContain(`- fake_${i}:`);   // index complete
    expect(t).toContain("- free_body:");
    expect(t).toContain("### Scene template: fake_3 (READY");           // matched → full
    expect(t).toContain("### Scene template: supply_demand (READY");    // core → full
    expect(t).not.toContain("### Scene template: fake_6 (READY");       // unmatched non-core → index only
    expect(t).toContain("need_template");
  });

  test("priorityIds join the hot set", () => {
    fillPastThreshold();
    const t = catalogText({ request: "unrelated words entirely", priorityIds: ["fake_6"] });
    expect(t).toContain("### Scene template: fake_6 (READY");
  });

  test("unregistered packs get an availability line", () => {
    fillPastThreshold();
    const t = catalogText({ request: "x" });
    expect(t).toMatch(/Pack available but not enabled: Physics/);
  });
});

describe("selectTemplates", () => {
  test("ranks by keyword overlap against description and example requests", () => {
    const hits = selectTemplates("show the forces on a block on an incline", 3);
    expect(hits[0]).toBe("free_body");
  });
  test("no overlap yields empty", () => {
    expect(selectTemplates("zzz qqq", 3)).toEqual([]);
  });
});

describe("detectNeedTemplate", () => {
  test("detects the marker object", () => {
    expect(detectNeedTemplate({ need_template: "free_body" })).toBe("free_body");
  });
  test("anything else is null", () => {
    expect(detectNeedTemplate({ template: "x", commands: [] })).toBeNull();
    expect(detectNeedTemplate(null)).toBeNull();
    expect(detectNeedTemplate({ need_template: 7 })).toBeNull();
  });
});

// Deliberate value, not incidental: it sits above the default library so the
// out-of-the-box catalog stays fully expanded (tests/pack-defaults.test.ts).
test("threshold is 50", () => {
  expect(TEMPLATE_FULL_THRESHOLD).toBe(50);
});
