// What the compiler actually sees out of the box. Two decisions are pinned
// here: every built-in domain pack that fits the ACADEMIC default is enabled
// by default (an unenabled pack is invisible to the model — a chemistry
// request silently degrades to a tier-2 composition) — EXCEPT the packs in
// DEFAULT_OFF_PACKS (games, maps), which are bundled but sit outside that
// academic default and stay opt-in — and, since 2026-09-07, the default
// library is ABOVE TEMPLATE_FULL_THRESHOLD on purpose: the catalog is an
// index of every template plus full entries for the core and for the
// request's shortlist (the router in src/llm/router.ts, then the keyword
// selector), with the need_template escalation as the safety valve. Before
// the router the full catalog was the default (~75k tokens a request); the
// index + shortlist regime is ~20k. See src/scenes/catalog.ts and
// src/store.ts.

import { beforeAll, describe, expect, test } from "vitest";
import { DEFAULT_SETTINGS } from "../src/store";
import { PACK_DEFS, DEFAULT_OFF_PACKS, ensureEnabledPacks } from "../src/scenes/packs";
import { catalogFullText, catalogIsTwoLevel, catalogParts, catalogText, HOT_SHORTLIST, TEMPLATE_FULL_THRESHOLD } from "../src/scenes/catalog";
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

  test("the default library is in the two-level regime — the router's regime", () => {
    expect(readyIds().length).toBeGreaterThan(TEMPLATE_FULL_THRESHOLD);
    expect(catalogIsTwoLevel()).toBe(true);
  });

  test("every ready template is on the index, the core stays in full, and the escalation is offered", () => {
    const { stable, variable } = catalogParts({ request: "draw the structure of aspirin" });
    for (const id of readyIds()) expect(stable).toContain(`- ${id}: `);
    for (const id of ["supply_demand", "decision_tree", "qaly_profiles"]) expect(stable).toContain(`### Scene template: ${id} (READY`);
    expect(stable).toContain("need_template");
    // The request's own shortlist travels outside the cached prefix, in full.
    expect(variable).toContain("### Scene template: molecule (READY");
  });

  test("a router shortlist puts its picks in full, capped, ahead of the keyword picks", () => {
    const { variable } = catalogParts({ request: "draw the structure of aspirin", shortlist: ["ray_diagram", "dna_helix"] });
    const at = (id: string) => variable.indexOf(`### Scene template: ${id} (READY`);
    expect(at("ray_diagram")).toBeGreaterThan(-1);
    expect(at("dna_helix")).toBeGreaterThan(at("ray_diagram"));
    expect(at("molecule")).toBeGreaterThan(at("dna_helix")); // the keyword pick fills the remaining slots
    expect(variable.split("### Scene template: ").length - 1).toBeLessThanOrEqual(HOT_SHORTLIST);
  });

  test("the pack templates are in there", () => {
    expect(readyIds()).toEqual(expect.arrayContaining(["molecule", "ray_diagram", "dna_helix"]));
  });

  // The default-off carve-out (games/maps) must not be invisible: an
  // unregistered bundled pack gets an availability line in either regime, so
  // the model can still reach for it by asking for the full definition.
  test("a default-off pack still surfaces as available-but-not-enabled", () => {
    const t = catalogText({ request: "draw a chess board" });
    expect(t).toContain("Pack available but not enabled: Games");
    expect(t).toContain("Pack available but not enabled: Maps");
  });

  // Measured at the space/periodic merge (2026-09-07), default packs enabled
  // (games and maps off): 79 ready templates, the full catalog
  // = 258427 chars (~64607 tokens at chars/4); the largest single entry is
  // line_chart at 12395 chars, then qaly_profiles at 9991 and bar_race at
  // 8844. periodic_table is 3761 and solar_system 6921 — neither is near the
  // top. The mean entry is 3248.
  //
  // The bound is the LARGEST ENTRY, not the total and not the mean. A ceiling
  // on the total expires every time a pack lands: the 250000 one was set at
  // Task 13 (2026-08-25) against 45 templates and 118582 chars, and by this
  // round the catalog had grown into it, so a single new template had to move
  // it — which is what happened twice independently, the space round and the
  // periodic-table round each meeting a catalog at ~99% of its own guard and
  // each having to raise the number rather than learn anything from it. The
  // mean was the next attempt and cannot catch what this comment claims to
  // catch: 3248 against a 4500 ceiling is 99000 chars of headroom spread over
  // 79 templates, so ONE template would have to grow by 99000 chars — eight
  // times the largest entry there is — before the ratio noticed. A max is the
  // shape of the claim: one template's prose sprawling past what a catalog
  // entry should cost fails here as soon as it does it. The floor on the total
  // guards the opposite failure, a catalog that has COLLAPSED — no per-entry
  // bound can see that, because a pack that fails to register takes its
  // entries out of the measurement entirely.
  //
  // Since the two-level regime became the default (2026-09-07) the model no
  // longer reads the full text on every request, but a shortlisted entry
  // still travels in full, so the per-entry bound still costs what it says;
  // the measurement is taken on catalogFullText, the same text as before.
  test("the default catalog stays within a sane budget — no single template sprawls", () => {
    const text = catalogFullText();
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

  test("the prompt the model reads in the default regime is a fraction of the full catalog", () => {
    const full = catalogFullText().length;
    const { stable, variable } = catalogParts({ request: "draw the structure of aspirin" });
    expect(stable.length + variable.length).toBeLessThan(full * 0.35);
  });
});
