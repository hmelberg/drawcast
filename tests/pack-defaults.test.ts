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

  // Measured at the space round (2026-09-07), default packs enabled (games and
  // maps off): 78 ready templates, catalogText({request:""}).length = 254666
  // chars (~63667 tokens at chars/4); the largest single entry is line_chart
  // at 12395 chars, then qaly_profiles at 9991 and bar_race at 8844.
  //
  // The bound is the LARGEST ENTRY, not the total and not the mean. A ceiling
  // on the total expires every time a pack lands: the 250000 one was set at
  // Task 13 (2026-08-25) against 45 templates and 118582 chars, and by this
  // round the catalog had grown into it, so a single new template had to move
  // it. The mean was the next attempt and cannot catch what this comment
  // claims to catch: 3265 against a 4500 ceiling is 96000 chars of headroom
  // spread over 78 templates, so ONE template would have to grow by 96000
  // chars — eight times the largest entry there is — before the ratio noticed.
  // A max is the shape of the claim: one template's prose sprawling past what
  // a catalog entry should cost fails here as soon as it does it. The floor on
  // the total guards the opposite failure, a catalog that has COLLAPSED — no
  // per-entry bound can see that, because a pack that fails to register takes
  // its entries out of the measurement entirely.
  test("the default catalog stays within a sane budget — no single template sprawls", () => {
    const text = catalogText({ request: "" });
    expect(text.length).toBeGreaterThan(200_000);
    // One entry runs from its own heading to the next; the last one carries
    // the catalog's trailing "available but not enabled" lines, so it stops
    // there. Measured on the text the model actually reads, not on a manifest.
    const entries = text
      .split("### Scene template: ")
      .slice(1)
      .map((e) => ({ id: e.slice(0, e.indexOf(" (")), chars: e.split("\n\nPack available but not enabled:")[0].length }));
    expect(entries).toHaveLength(readyIds().length);
    const largest = entries.reduce((a, b) => (b.chars > a.chars ? b : a));
    expect(largest.chars, `${largest.id} is the biggest catalog entry`).toBeLessThan(16_000);
  });
});
