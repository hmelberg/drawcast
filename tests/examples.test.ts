// The curated bundled examples (src/examples.json) are load-bearing twice
// over: they are what the Examples list offers a new user, and they fill the
// {{EXEMPLARS}} slots a user's own reference library leaves empty
// (src/llm/exemplars.ts). So they are held to the same bar as the fewshots —
// every one must validate, lay out, resolve every id its commands name, and
// open the way the compiler prompt says a drawcast opens.

import { beforeAll, describe, expect, test } from "vitest";
import bundledExamples from "../src/examples.json";
import fewshots from "../src/llm/prompts/fewshots.json";
import { scenes } from "../src/scenes/registry";
import { validateSpec } from "../src/spec/schema";
import { layoutSpec } from "../src/layout/layout";
import { planCommands } from "../src/render/plan";
import { lintCommands } from "../src/lint/lint";
import { cardTargets } from "../src/ui/card-model";
import { linkKindOf } from "../src/ui/link-model";
import { parsePlaylistText, itemsOf } from "../src/playlist/playlist";
import { ensureEnabledPacks, PACK_DEFS } from "../src/scenes/packs";
import { ensureEnginesForSpecs } from "../src/scenes/engines";
import { isReadyTemplate } from "../src/scenes/catalog";
import { templateParamErrors } from "../src/scenes/params-check";
import { withOverrides } from "../src/render/params";
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

  // Coverage is complete as of this commit — every template a fresh install
  // offers has a worked example. Adding a template to a bundled pack without
  // one is what this catches: the Examples list is how a user meets it, and
  // the exemplar pool is how the model learns to reach for it.
  test("every ready template has an example or a fewshot", () => {
    const covered = new Set(
      [...cases.map(([, spec]) => spec), ...(fewshots as { spec: Spec }[]).map((f) => f.spec)].map((s) => s.template).filter(Boolean),
    );
    const ready = Object.values(scenes)
      .filter((s) => s.manifest.status === "ready")
      .map((s) => s.manifest.name);
    expect(ready.filter((id) => !covered.has(id))).toEqual([]);
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

  test.each(cases)("%s — no command-level lint issue (slow-start / talky-stretch)", (_req, spec) => {
    expect(lintCommands(spec)).toEqual([]);
  });

  test.each(cases)("%s — names a template that exists (or composes from elements)", (_req, spec) => {
    if (spec.template) expect(isReadyTemplate(spec.template), spec.template).toBe(true);
  });

  // The compiler validates params against the template's own params_schema on
  // every generation — strictly, for the data pack. A bundled example that
  // would not survive that check teaches the model a shape the repair round
  // then argues with, so it is a defect here too. (Also a drift guard the
  // other way: a schema tightened without looking at the examples.)
  test.each(cases)("%s — params satisfy the template's own params_schema", (_req, spec) => {
    if (!spec.template) return;
    expect(templateParamErrors(spec.template, spec.params ?? {})).toEqual([]);
  });

  // An animate target is a promise about a LATER frame: the tests above only
  // ever see stage 0. A figure that lints clean at rest and collides halfway
  // through its own animation is exactly the defect an example must not model.
  test.each(cases)("%s — every stage the storyboard animates to lays out as cleanly as the first", (_req, spec) => {
    for (const cmd of (spec.commands ?? []) as Command[]) {
      const stage = cmd.animate?.stage;
      if (typeof stage !== "number") continue;
      const at = layoutSpec({ ...spec, params: withOverrides(spec.params, { stage }) });
      expect(at.warnings, `stage ${stage}`).toEqual([]);
      expect(at.issues.filter((i) => i.severity === "error"), `stage ${stage}`).toEqual([]);
    }
  });

  // Hans's race-label ruling, 2026-09-03. He watched the bundled urn race and
  // saw "some of the labels on the lines disappear (B and C) and some
  // reappears (C)" — label_top: 3 re-ranking five urns every stage, so Urn B
  // was never named and Urn C's name came and went as it traded third place
  // with Urn A. A race keeps its names.
  test("the urn line race names all five urns — no label_top ranking names off the chart", () => {
    const urn = examples.find((e) => /five urns/i.test(e.request));
    expect(urn, "the bundled urn race is gone or renamed").toBeDefined();
    const params = urn!.spec!.params as Record<string, unknown>;
    expect(params.label_top).toBeUndefined();
    expect((params.series as { name: string }[]).map((s) => s.name)).toEqual(["Urn A", "Urn B", "Urn C", "Urn D", "Urn E"]);
    // The closing beat highlights Urn B by name ("Urn B was not worse at
    // anything"), which only lands if Urn B is labelled on the chart.
    const speaks = (urn!.spec!.commands ?? []).map((c) => (c as Command).speak ?? "").join(" ");
    expect(speaks).toMatch(/Urn B/);
  });

  // The other half of the same ruling. `label_top` is allowed to stay where
  // the disappearing name IS the lesson — but only where the viewer is told,
  // and told when it happens, not five stages later. Without this guard a
  // future example could pick the param up and reproduce exactly the surprise
  // Hans reported.
  test("a bundled race that ranks names off the chart says so out loud", () => {
    const ranked = examples.filter((e) => (e.spec?.params as { label_top?: number } | undefined)?.label_top !== undefined);
    for (const ex of ranked) {
      const speaks = (ex.spec!.commands ?? []).map((c) => (c as Command).speak ?? "");
      const tells = speaks.some((t) => /\bnamed?\b|\bname\b|\blabel/i.test(t));
      expect(tells, `${ex.request}: uses label_top but never tells the viewer a name is being withheld`).toBe(true);
    }
  });

  // A link only does its job if it reaches a card and sniffs to the right
  // kind. A mistyped YouTube id still LOOKS like a link — it just quietly
  // degrades from the embedded player to a plain new tab — so pin both.
  test.each(cases)("%s — every authored link reaches a card, with the kind its URL implies", (_req, spec) => {
    const linked = (spec.elements ?? []).filter((el) => (Array.isArray(el.link) ? el.link.length : el.link ? 1 : 0) > 0);
    if (linked.length === 0) return;
    const targets = cardTargets(spec, layoutSpec(spec).order);
    for (const el of linked) {
      const urls = typeof el.link === "string" ? [el.link] : (el.link ?? []);
      const reached = [...targets.values()].flatMap((t) => t.links);
      for (const url of urls) {
        expect(reached, `${el.id} link ${url}`).toContain(url);
        if (/youtube\.com|youtu\.be/.test(url)) expect(linkKindOf(url).kind, url).toBe("youtube");
        if (/\.pdf$|arxiv\.org\/pdf\//.test(url)) expect(linkKindOf(url).kind, url).toBe("pdf");
        if (/wikipedia\.org\/wiki\//.test(url)) expect(linkKindOf(url).kind, url).toBe("wiki");
      }
    }
  });

  test.each(cases)("%s — at most one opening (announcement) speak precedes the first draw", (_req, spec) => {
    const commands = (spec.commands ?? []) as Command[];
    const firstDraw = commands.findIndex((c) => c.draw !== undefined);
    const speaksBefore = commands.slice(0, firstDraw).filter((c) => c.speak !== undefined);
    expect(speaksBefore.length).toBeLessThanOrEqual(1);
  });
});
