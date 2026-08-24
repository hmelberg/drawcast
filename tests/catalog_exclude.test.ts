import { afterEach, describe, expect, it } from "vitest";
import { catalogText, TEMPLATE_FULL_THRESHOLD } from "../src/scenes/catalog";
import { scenes, registerTemplateDoc } from "../src/scenes/registry";
import type { TemplateDoc } from "../src/scenes/doc";

describe("catalog excludeIds", () => {
  it("omits an excluded template from the catalog text", () => {
    expect(catalogText({})).toContain("molecule_3d");
    expect(catalogText({ excludeIds: ["molecule_3d"] })).not.toContain("molecule_3d");
  });

  it("does not grant a forced full entry to an excluded template", () => {
    const text = catalogText({ forced: "molecule_3d", excludeIds: ["molecule_3d"] });
    expect(text).not.toContain('You MUST set "template" to "molecule_3d"');
  });
});

// Same pattern as tests/catalog.test.ts / tests/catalog-split.test.ts: register
// throwaway ready templates until the catalog leaves the legacy full-listing
// branch and enters the two-level (index + hot-set) regime, so the stableIds
// and shortlist filters (the only places that ALSO need the exclusion, besides
// the `entries` source and the `forced` guard already covered above) actually run.
describe("catalog excludeIds above the threshold", () => {
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
  // Overshoots by a margin (not just past the threshold by one): excludeIds
  // removes the excluded id from `ready` too (catalog.ts filters `entries`/
  // `ready` at the source), so a fill that lands exactly one past the
  // threshold would drop back to the legacy single-branch regime the moment
  // one id is excluded — defeating the point of this describe block, which is
  // to exercise the two-level stableIds/shortlist filters specifically.
  function fillPastThreshold(margin = 3): void {
    const ready = () => Object.values(scenes).filter((s) => s.manifest.status === "ready").length;
    for (let i = 0; ready() <= TEMPLATE_FULL_THRESHOLD + margin; i++) addFake(`fake_${i}`);
  }

  afterEach(() => {
    for (const id of added.splice(0)) delete scenes[id];
  });

  it("drops an excluded id from the index line entirely", () => {
    fillPastThreshold();
    expect(catalogText({})).toContain("- molecule_3d:");
    expect(catalogText({ excludeIds: ["molecule_3d"] })).not.toContain("molecule_3d");
  });

  it("shortlist (keyword-matched hot set) never promotes an excluded id to a full entry", () => {
    fillPastThreshold();
    // This exact request is molecule_3d's own example, so it normally wins a
    // shortlist slot via selectTemplates()'s keyword overlap.
    const request = "Show methane in 3D so the tetrahedral shape is clear.";
    expect(catalogText({ request })).toContain("### Scene template: molecule_3d (READY");
    expect(catalogText({ request, excludeIds: ["molecule_3d"] })).not.toContain("molecule_3d");
  });

  it("stableIds (priorityIds hot set) never promotes an excluded id to a full entry", () => {
    fillPastThreshold();
    expect(catalogText({ priorityIds: ["molecule_3d"] })).toContain("### Scene template: molecule_3d (READY");
    expect(catalogText({ priorityIds: ["molecule_3d"], excludeIds: ["molecule_3d"] })).not.toContain("molecule_3d");
  });
});
