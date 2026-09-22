// The same request, generated at three model tiers and kept side by side so
// the difference is visible in the app's example menu (Hans 2026-09-22).
// They are PLAYLIST examples, which matters: llm/exemplars.ts's
// usableExemplars requires a `spec`, so a playlist entry can never be picked
// as an exemplar. That is the point — the Haiku one is here BECAUSE it is
// worse, and teaching the compiler from it would be the opposite of useful.
import { beforeAll, describe, expect, test } from "vitest";
import { ensureEnabledPacks } from "../src/scenes/packs";
import { DEFAULT_SETTINGS } from "../src/store";
import { isReadyTemplate } from "../src/scenes/catalog";
import { usableExemplars } from "../src/llm/exemplars";
import { parsePlaylistText, itemsOf } from "../src/playlist/playlist";
import { validateSpec } from "../src/spec/schema";
import examples from "../src/examples.json";

type Entry = { request: string; title?: string; spec?: unknown; playlist?: string };
const all = examples as Entry[];
const tiers = all.filter((e) => (e.title ?? "").includes("deadweight loss —"));

beforeAll(async () => { await ensureEnabledPacks(DEFAULT_SETTINGS.enabledPacks); });

describe("the three model-tier examples", () => {
  test("all three are present and name their model", () => {
    expect(tiers.map((e) => e.title)).toEqual([
      "A tax's deadweight loss — Haiku 4.5",
      "A tax's deadweight loss — Sonnet 5",
      "A tax's deadweight loss — Opus 5",
    ]);
  });

  test("each parses to pages that all validate", () => {
    for (const e of tiers) {
      const items = itemsOf(parsePlaylistText(e.playlist!));
      expect(items.length, e.title).toBeGreaterThan(0);
      for (const [i, it] of items.entries()) {
        const r = validateSpec(it.spec);
        expect(r.errors, `${e.title} page ${i + 1}`).toEqual([]);
      }
    }
  });

  // The record of what this comparison showed: Haiku ignored #parts=3 and
  // returned five pages, two of them near-duplicate syntheses. That is the
  // defect that put the enforcement in llm/outline.ts — kept here as
  // evidence rather than prose, so the example and the fix cannot drift.
  test("Haiku's five pages against three for the stronger tiers", () => {
    const pages = (t: string) => itemsOf(parsePlaylistText(tiers.find((e) => e.title!.includes(t))!.playlist!)).length;
    expect(pages("Haiku")).toBe(5);
    expect(pages("Sonnet")).toBe(3);
    expect(pages("Opus")).toBe(3);
  });

  // They are marked, and the marking is what the other gates read. Without
  // it the "bundled examples stay exemplary" gates fail on them — correctly,
  // since Haiku's draws an id its own `regions` never creates and Sonnet's
  // trips lint. Those defects ARE the exhibit.
  test("each is marked a specimen, and marked specimens stay out of the prompt", () => {
    for (const e of tiers) expect((e as { specimen?: boolean }).specimen, e.title).toBe(true);
    for (const e of tiers) expect(e.spec, e.title).toBeUndefined();
    const pool = usableExemplars(all.map((e) => ({ prompt: e.request, spec: e.spec as never })), isReadyTemplate);
    const req = tiers[0].request;
    expect(pool.filter((p) => p.prompt === req)).toEqual([]);
  });
});
