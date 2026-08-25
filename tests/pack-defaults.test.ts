// What the compiler actually sees out of the box. Two decisions are pinned
// here: every built-in domain pack that fits the ACADEMIC default is enabled
// by default (an unenabled pack is invisible to the model — a chemistry
// request silently degrades to a tier-2 composition) — EXCEPT the packs in
// DEFAULT_OFF_PACKS (games, maps), which are bundled but sit outside that
// academic default and stay opt-in — and the catalog still gives every
// default-enabled template a full parameter schema (below
// TEMPLATE_FULL_THRESHOLD), so nothing is index-only and the need_template
// escalation round never fires in the default configuration. See
// src/scenes/catalog.ts and src/store.ts.

import { beforeAll, describe, expect, test } from "vitest";
import { DEFAULT_SETTINGS } from "../src/store";
import { PACK_DEFS, DEFAULT_OFF_PACKS, ensureEnabledPacks } from "../src/scenes/packs";
import { catalogText, TEMPLATE_FULL_THRESHOLD } from "../src/scenes/catalog";
import { scenes } from "../src/scenes/registry";

function readyIds(): string[] {
  return Object.values(scenes)
    .filter((s) => s.manifest.status === "ready")
    .map((s) => s.manifest.name);
}

test("every built-in pack is enabled by default, except the default-off carve-out", () => {
  const expected = Object.keys(PACK_DEFS).filter((id) => !DEFAULT_OFF_PACKS.has(id));
  expect([...DEFAULT_SETTINGS.enabledPacks].sort()).toEqual(expected.sort());
});

describe("the default catalog", () => {
  beforeAll(async () => {
    const results = await ensureEnabledPacks(DEFAULT_SETTINGS.enabledPacks);
    expect(results.filter((r) => !r.ok)).toEqual([]);
  });

  test("every ready template keeps a full entry — no index-only templates, no escalation", () => {
    const t = catalogText({ request: "draw the structure of aspirin" });
    for (const id of readyIds()) expect(t).toContain(`### Scene template: ${id} (READY`);
    expect(t).not.toContain("need_template");
  });

  test("the pack templates are in there", () => {
    expect(readyIds()).toEqual(expect.arrayContaining(["molecule", "ray_diagram", "dna_helix"]));
  });

  test("the default template count stays under the two-level threshold", () => {
    expect(readyIds().length).toBeLessThanOrEqual(TEMPLATE_FULL_THRESHOLD);
  });

  // The default-off carve-out (games/maps) must not be invisible: even
  // below the two-level threshold — the legacy full-listing branch of
  // catalogParts — an unregistered bundled pack gets an availability line,
  // so the model can still reach for it by asking for the full definition.
  test("a default-off pack still surfaces as available-but-not-enabled", () => {
    const t = catalogText({ request: "draw a chess board" });
    expect(t).toContain("Pack available but not enabled: Games");
    expect(t).toContain("Pack available but not enabled: Maps");
  });

  // Measured at Task 13 (2026-08-25), default packs enabled (economics,
  // evidence, mathlogic, physics, chemistry, biology; games/maps off), 45
  // ready templates: catalogText({request:""}).length = 118582 chars, or
  // ~29646 tokens at chars/4. The bounds below are a coarse regression
  // guard, not a pin — re-measure and update this comment (not the bound)
  // if a future pack round moves the number meaningfully.
  test("the default catalog stays within a sane budget", () => {
    const size = catalogText({ request: "" }).length;
    expect(size).toBeGreaterThan(50_000);
    expect(size).toBeLessThan(250_000);
  });
});
