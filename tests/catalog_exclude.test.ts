import { describe, expect, it } from "vitest";
import { catalogText } from "../src/scenes/catalog";

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
