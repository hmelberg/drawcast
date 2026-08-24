// The curated bundled examples (src/examples.json) are load-bearing twice
// over: they are what the Examples list offers a new user, and they fill the
// {{EXEMPLARS}} slots a user's own reference library leaves empty
// (src/llm/exemplars.ts). So they are held to the same bar as the fewshots —
// every one must validate, lay out, resolve every id its commands name, and
// open the way the compiler prompt says a drawcast opens.

import { beforeAll, describe, expect, test } from "vitest";
import bundledExamples from "../src/examples.json";
import { validateSpec } from "../src/spec/schema";
import { layoutSpec } from "../src/layout/layout";
import { planCommands } from "../src/render/plan";
import { parsePlaylistText, itemsOf } from "../src/playlist/playlist";
import { ensureEnabledPacks, PACK_DEFS } from "../src/scenes/packs";
import { ensureEnginesForSpecs } from "../src/scenes/engines";
import { isReadyTemplate } from "../src/scenes/catalog";
import type { Command, Spec } from "../src/spec/types";

interface BundledExample {
  request: string;
  title?: string;
  spec?: Spec;
  playlist?: string;
  packs?: string[];
}

const examples = bundledExamples as BundledExample[];

/** Every spec an example carries: a single spec, or each item of its playlist. */
function specsOf(ex: BundledExample): Spec[] {
  if (ex.spec) return [ex.spec];
  if (ex.playlist) return itemsOf(parsePlaylistText(ex.playlist)).map((i) => i.spec);
  return [];
}

const cases = examples.flatMap((ex) => specsOf(ex).map((spec, i) => [`${ex.request}${i > 0 ? ` [part ${i + 1}]` : ""}`, spec] as const));

beforeAll(async () => {
  // The app enables every bundled pack by default; an example may also name
  // its own (loadBundledExample enables those before rendering).
  await ensureEnabledPacks(Object.keys(PACK_DEFS));
  await ensureEnginesForSpecs(cases.map(([, spec]) => spec));
});

describe("bundled examples stay exemplary", () => {
  test("every example carries either a spec or a playlist", () => {
    for (const ex of examples) expect(specsOf(ex).length, ex.request).toBeGreaterThan(0);
  });

  test.each(cases)("%s — validates, lays out, and every command id resolves", (_req, spec) => {
    expect(validateSpec(spec).ok).toBe(true);
    const layout = layoutSpec(spec);
    const plan = planCommands(spec.commands, layout.order);
    expect(plan.warnings.filter((w) => w.includes("unknown id"))).toEqual([]);
  });

  // Stricter than the compiler's own repair gate (which only repairs errors):
  // these are the figures the app shows off and the model imitates, so a
  // cosmetic warning — a label sitting on a stroke, say — is a defect here.
  test.each(cases)("%s — lays out with no lint issue at all, not even a warning", (_req, spec) => {
    expect(layoutSpec(spec).issues.map((i) => `[${i.severity}] ${i.message}`)).toEqual([]);
  });

  test.each(cases)("%s — names a template that exists (or composes from elements)", (_req, spec) => {
    if (spec.template) expect(isReadyTemplate(spec.template), spec.template).toBe(true);
  });

  test.each(cases)("%s — at most one opening (announcement) speak precedes the first draw", (_req, spec) => {
    const commands = (spec.commands ?? []) as Command[];
    const firstDraw = commands.findIndex((c) => c.draw !== undefined);
    const speaksBefore = commands.slice(0, firstDraw).filter((c) => c.speak !== undefined);
    expect(speaksBefore.length).toBeLessThanOrEqual(1);
  });
});
