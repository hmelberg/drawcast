// The template router's pure halves: the index it reads, the reply it is
// allowed to believe, and the prompt shape (one cached block).
import { afterEach, describe, expect, test } from "vitest";
import { buildRouterSystem, parseRouteReply, ROUTE_SCHEMA } from "../src/llm/router";
import { structuredOutputSupported } from "../src/llm/client";
import { catalogIsTwoLevel, HOT_SHORTLIST, routerIndexText, TEMPLATE_FULL_THRESHOLD } from "../src/scenes/catalog";
import { registerTemplateDoc, scenes } from "../src/scenes/registry";
import type { TemplateDoc } from "../src/scenes/doc";

const added: string[] = [];
function addFake(id: string, description: string, requests: string[] = [`Draw the ${id}.`]): void {
  const doc: TemplateDoc = {
    template: id, version: 1, kit: 1, status: "ready",
    description,
    params: {}, element_ids: {},
    examples: requests.map((request) => ({ request, params: {} })),
    layout: `return { drawables: [], labels: [], anchors: {}, order: [] };`,
  };
  registerTemplateDoc(doc);
  added.push(id);
}
afterEach(() => {
  for (const id of added.splice(0)) delete scenes[id];
});

describe("routerIndexText", () => {
  test("one line per ready template: id, first sentence, the choose-sentence, two example requests", () => {
    addFake("rt_widget", "A widget diagram with cogs. Second sentence about detail. Choose this scene for any request about widgets or cogs.", ["Draw a widget.", "Show the cogs.", "A third one."]);
    const line = routerIndexText().split("\n").find((l) => l.startsWith("- rt_widget:"));
    expect(line).toBe('- rt_widget: A widget diagram with cogs. Choose this scene for any request about widgets or cogs. e.g. "Draw a widget."; "Show the cogs."');
  });
  test("a description without a choose-sentence still gets its first sentence and examples", () => {
    addFake("rt_plain", "A plain figure. More prose here.", ["Plain please."]);
    expect(routerIndexText()).toContain('- rt_plain: A plain figure. e.g. "Plain please."');
  });
  test("excluded ids and stubs are absent", () => {
    addFake("rt_hidden", "Hidden figure. Choose this for hidden things.");
    expect(routerIndexText({ excludeIds: ["rt_hidden"] })).not.toContain("rt_hidden");
    registerTemplateDoc({ template: "rt_stub", version: 1, kit: 1, status: "stub", description: "A stub.", params: {}, element_ids: {}, examples: [] });
    added.push("rt_stub");
    expect(routerIndexText()).not.toContain("rt_stub");
  });
  test("every bundled built-in is on one line, so the index is complete", () => {
    const lines = routerIndexText().split("\n");
    for (const id of ["supply_demand", "decision_tree", "qaly_profiles"]) expect(lines.some((l) => l.startsWith(`- ${id}: `)), id).toBe(true);
  });
});

describe("parseRouteReply", () => {
  const ready = new Set(["supply_demand", "decision_tree", "timeline"]);
  test("keeps known ids in order, drops unknown and duplicate ones, caps at HOT_SHORTLIST", () => {
    const r = parseRouteReply({ ids: ["timeline", "nope", "supply_demand", "timeline", "decision_tree", "x", "y"], none_fits: false }, ready);
    expect(r).toEqual({ ids: ["timeline", "supply_demand", "decision_tree"], noneFits: false });
    const many = new Set(Array.from({ length: 9 }, (_, i) => `t${i}`));
    expect(parseRouteReply({ ids: [...many], none_fits: false }, many).ids).toHaveLength(HOT_SHORTLIST);
  });
  test("none_fits is honoured only with an empty list", () => {
    expect(parseRouteReply({ ids: [], none_fits: true }, ready)).toEqual({ ids: [], noneFits: true });
    expect(parseRouteReply({ ids: ["timeline"], none_fits: true }, ready)).toEqual({ ids: ["timeline"], noneFits: false });
    expect(parseRouteReply({ ids: ["nope"], none_fits: true }, ready)).toEqual({ ids: [], noneFits: true });
  });
  test("garbage is an empty, non-none answer (the keyword selector takes over)", () => {
    for (const bad of [null, "x", 42, [], { ids: "timeline" }, {}]) expect(parseRouteReply(bad, ready)).toEqual({ ids: [], noneFits: false });
  });
});

describe("buildRouterSystem", () => {
  test("one cached block carrying the instruction and the index", () => {
    const sys = buildRouterSystem("- a: A thing.");
    expect(sys).toHaveLength(1);
    expect(sys[0].cache_control).toEqual({ type: "ephemeral" });
    expect(sys[0].text).toContain("template router");
    expect(sys[0].text.endsWith("- a: A thing.")).toBe(true);
  });
  test("the reply schema is closed, so structured outputs can hold the model to it", () => {
    expect(structuredOutputSupported(ROUTE_SCHEMA)).toBe(true);
  });
});

describe("catalogIsTwoLevel", () => {
  test("follows the ready count against the threshold, honouring excludeIds", () => {
    const ready = () => Object.values(scenes).filter((s) => s.manifest.status === "ready").length;
    const before = ready() > TEMPLATE_FULL_THRESHOLD;
    expect(catalogIsTwoLevel()).toBe(before);
    for (let i = 0; ready() <= TEMPLATE_FULL_THRESHOLD; i++) addFake(`rt_fill_${i}`, `Filler ${i}.`);
    expect(catalogIsTwoLevel()).toBe(true);
    expect(catalogIsTwoLevel(added.slice(0))).toBe(before);
  });
});
