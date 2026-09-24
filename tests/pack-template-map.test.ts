// PACK_TEMPLATES lets a published cast's viewer load only the packs it needs
// (2026-09-24, Hans: published casts are slow to load — all 18 packs were
// fetched one after another). It must say exactly what the YAML registers.

import { beforeAll, describe, expect, test } from "vitest";
import { ensureEnabledPacks, PACK_DEFS, PACK_TEMPLATES, packsForSpecs, packTemplateIds } from "../src/scenes/packs";

beforeAll(async () => {
  await ensureEnabledPacks(Object.keys(PACK_DEFS));
});

describe("the template → pack map", () => {
  test("names every pack, and each pack's templates exactly as its YAML registers them", () => {
    expect(Object.keys(PACK_TEMPLATES).sort()).toEqual(Object.keys(PACK_DEFS).sort());
    for (const id of Object.keys(PACK_DEFS)) expect(PACK_TEMPLATES[id].slice().sort(), id).toEqual(packTemplateIds(id).sort());
  });

  test("a cast needs the packs of its templates, and none for built-ins or carried templates", () => {
    const registered = (id: string) => id === "supply_demand";
    expect(packsForSpecs([{ template: "note_sheet" }, { template: "piano_keys" }], registered)).toEqual(["music"]);
    expect(packsForSpecs([{ template: "supply_demand" }, {}], registered)).toEqual([]);
    expect(packsForSpecs([{ template: "mine", templates: [{ template: "mine" }] }], registered)).toEqual([]);
  });

  test("a template no pack is known to own means: load them all", () => {
    expect(packsForSpecs([{ template: "who_knows" }], () => false)).toBeNull();
  });
});
