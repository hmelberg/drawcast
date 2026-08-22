import { beforeEach, describe, expect, test, vi } from "vitest";

// store.ts touches localStorage at call time — give the node env a real-enough stub.
const mem = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
});

import { loadMyTemplates, saveMyTemplate, deleteMyTemplate } from "../src/store";
import { isUserTemplateId, registerUserTemplateYaml, unregisterUserTemplate, registerMyTemplatesAtStartup } from "../src/scenes/my-templates";
import { scenes } from "../src/scenes/registry";

const USER_YAML = `
template: my_test_widget
version: 1
kit: 1
status: ready
description: A test widget.
params: { type: object }
element_ids: { dot: the dot }
examples:
  - request: "Draw the widget."
    params: {}
layout: |
  return { drawables: [kit.stroke("dot", [[500, 400]], { shapeHint: { type: "circle", c: [500, 400], r: 10 } })], labels: [], anchors: {}, order: ["dot"] };
`;

beforeEach(() => {
  mem.clear();
  unregisterUserTemplate("my_test_widget");
});

describe("store: my templates", () => {
  test("save/load/delete round-trip, upsert by id, newest first", () => {
    saveMyTemplate({ id: "a", yaml: "ya", ts: "1" });
    saveMyTemplate({ id: "b", yaml: "yb", ts: "2" });
    saveMyTemplate({ id: "a", yaml: "ya2", ts: "3" });
    const all = loadMyTemplates();
    expect(all.map((t) => t.id)).toEqual(["a", "b"]);
    expect(all[0].yaml).toBe("ya2");
    deleteMyTemplate("a");
    expect(loadMyTemplates().map((t) => t.id)).toEqual(["b"]);
  });
});

describe("registerUserTemplateYaml", () => {
  test("registers a valid user template and marks the id user-owned", () => {
    const r = registerUserTemplateYaml(USER_YAML);
    expect(r).toEqual({ ok: true, id: "my_test_widget", errors: [] });
    expect(scenes.my_test_widget.layout).toBeDefined();
    expect(isUserTemplateId("my_test_widget")).toBe(true);
  });

  test("re-registering the same user id is allowed (iterate/improve)", () => {
    registerUserTemplateYaml(USER_YAML);
    const r = registerUserTemplateYaml(USER_YAML.replace("A test widget.", "A better widget."));
    expect(r.ok).toBe(true);
    expect(scenes.my_test_widget.manifest.description).toContain("better");
  });

  test("refuses to overwrite a built-in id", () => {
    const r = registerUserTemplateYaml(USER_YAML.replace("my_test_widget", "supply_demand"));
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatch(/built-in|existing template/);
    expect(scenes.supply_demand.layout).toBeDefined(); // untouched
  });

  test("invalid yaml reports errors and registers nothing", () => {
    const r = registerUserTemplateYaml("template: [broken");
    expect(r.ok).toBe(false);
    expect(r.errors.length).toBeGreaterThan(0);
  });
});

describe("unregister + startup registration", () => {
  test("unregister removes a user template from the registry", () => {
    registerUserTemplateYaml(USER_YAML);
    unregisterUserTemplate("my_test_widget");
    expect(scenes.my_test_widget).toBeUndefined();
    expect(isUserTemplateId("my_test_widget")).toBe(false);
  });

  test("unregister never touches non-user entries", () => {
    unregisterUserTemplate("supply_demand");
    expect(scenes.supply_demand).toBeDefined();
  });

  test("startup registers everything stored, reporting per-id results", () => {
    saveMyTemplate({ id: "my_test_widget", yaml: USER_YAML, ts: "1" });
    saveMyTemplate({ id: "broken", yaml: "template: [broken", ts: "2" });
    const results = registerMyTemplatesAtStartup();
    expect(results.find((r) => r.id === "my_test_widget")?.ok).toBe(true);
    expect(results.find((r) => r.id === "broken")?.ok).toBe(false);
    expect(scenes.my_test_widget.layout).toBeDefined();
  });
});
