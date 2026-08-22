// M5 Task 2: {{CATALOG}} cache split. catalogParts() separates the
// preference-stable part (index + forced/priority/core + stubs + packs +
// escalation — never depends on the free-text request) from the
// request-dependent shortlist, so generateSpec can pin the stable part in
// its cache_control prefix. catalogText(opts) must still equal the two
// parts joined — see tests/catalog.test.ts, kept green unmodified.

import { afterEach, describe, expect, test } from "vitest";
import { catalogParts, catalogText } from "../src/scenes/catalog";
import { scenes, registerTemplateDoc } from "../src/scenes/registry";
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
afterEach(() => {
  for (const id of added.splice(0)) delete scenes[id];
});

describe("catalogParts below the threshold", () => {
  test("variable is empty and stable is byte-identical to catalogText()", () => {
    const parts = catalogParts();
    expect(parts.variable).toBe("");
    expect(parts.stable).toBe(catalogText());
  });
});

describe("catalogParts forced (below or above threshold)", () => {
  test("all-stable: variable empty, stable matches catalogText({ forced })", () => {
    const parts = catalogParts({ forced: "free_body" });
    expect(parts.variable).toBe("");
    expect(parts.stable).toBe(catalogText({ forced: "free_body" }));
  });

  test("stays all-stable once the catalog is above threshold too", () => {
    for (let i = 0; i < 8; i++) addFake(`fake_${i}`);
    const parts = catalogParts({ forced: "free_body", request: "irrelevant text" });
    expect(parts.variable).toBe("");
    expect(parts.stable).toContain("### Scene template: free_body (READY");
    expect(parts.stable).toContain('You MUST set "template" to "free_body"');
  });
});

describe("catalogParts above the threshold", () => {
  test("stable is preference-stable across different requests (does not depend on opts.request)", () => {
    for (let i = 0; i < 8; i++) addFake(`fake_${i}`);
    const a = catalogParts({ request: "Draw the fake_3 thing." });
    const b = catalogParts({ request: "Draw the fake_5 thing." });
    expect(a.stable).toBe(b.stable);
    // but the joined text (what actually reaches the model) still differs —
    // the shortlist is real, just relocated out of the stable prefix.
    expect(catalogText({ request: "Draw the fake_3 thing." })).not.toBe(catalogText({ request: "Draw the fake_5 thing." }));
  });

  test("variable carries the shortlisted entry (not already in stable), with the one-line preamble", () => {
    for (let i = 0; i < 8; i++) addFake(`fake_${i}`);
    const parts = catalogParts({ request: "Draw the fake_3 thing." });
    expect(parts.variable).toContain("Additional likely-relevant template definitions for THIS request:");
    expect(parts.variable).toContain("### Scene template: fake_3 (READY");
    expect(parts.stable).not.toContain("### Scene template: fake_3 (READY");
  });

  test("priorityIds promote an id into stable, so it's never duplicated into variable", () => {
    for (let i = 0; i < 8; i++) addFake(`fake_${i}`);
    const parts = catalogParts({ request: "Draw the fake_6 thing.", priorityIds: ["fake_6"] });
    expect(parts.stable).toContain("### Scene template: fake_6 (READY");
    // fake_6's own full entry must appear exactly once across stable+variable.
    const joined = parts.stable + parts.variable;
    expect(joined.split("### Scene template: fake_6 (READY").length - 1).toBe(1);
  });

  test("catalogText(opts) equals stable + variable joined", () => {
    for (let i = 0; i < 8; i++) addFake(`fake_${i}`);
    const request = "Draw the fake_3 thing.";
    const parts = catalogParts({ request });
    const joined = parts.stable + (parts.variable ? "\n\n" + parts.variable : "");
    expect(catalogText({ request })).toBe(joined);
  });

  test("no keyword match yields an empty variable even above threshold", () => {
    for (let i = 0; i < 8; i++) addFake(`fake_${i}`);
    const parts = catalogParts({ request: "zzz qqq" });
    expect(parts.variable).toBe("");
  });
});
