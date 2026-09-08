import { describe, it, expect } from "vitest";
import spaceYaml from "../src/scenes/packs/space.yaml?raw";
import { registerPack } from "../src/scenes/packs";
import { activitiesFor } from "../src/ui/quiz-model";
import { KNOWN_INTERACTIONS } from "../src/scenes/types";
import { scenes } from "../src/scenes/registry";

// The space pack registers lazily (packs.ts); every other pack-reading test
// file registers it itself before reading `scenes` (space-template.test.ts,
// sky-template.test.ts). registerPack is idempotent once a pack is owned.
registerPack("space", spaceYaml);

describe("free play on the space figures", () => {
  it("both templates declare their interaction", () => {
    expect(scenes.solar_system.manifest.interactions).toEqual(["space"]);
    expect(scenes.sky_map.manifest.interactions).toEqual(["sky"]);
  });
  it("knows the two new kinds", () => {
    expect(KNOWN_INTERACTIONS).toContain("space");
    expect(KNOWN_INTERACTIONS).toContain("sky");
  });
  it("keeps the generic drill for a kind with no bespoke activity of its own", () => {
    // The trap this pins: activitiesFor used to return the parts drill ONLY
    // when a figure declared nothing at all, so declaring an interaction for
    // the sake of CARDS would silently take the drill away.
    expect(activitiesFor(["sky"], 12).map((a) => a.id)).toEqual(["parts_quiz"]);
    expect(activitiesFor(["space"], 9).map((a) => a.id)).toEqual(["parts_quiz"]);
  });
  it("still gives a bespoke kind its own activities and no generic one", () => {
    expect(activitiesFor(["piano"], 30).map((a) => a.id)).toEqual(["note_quiz"]);
  });
  it("gives nothing to a figure with too few parts", () => {
    expect(activitiesFor(["sky"], 2)).toEqual([]);
  });
});
