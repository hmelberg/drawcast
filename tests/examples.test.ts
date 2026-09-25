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
import { flattenDrawables } from "../src/layout/model";
import { validateSpec } from "../src/spec/schema";
import { expandSpec } from "../src/spec/expand";
import { domainMapping, elementBBoxes, layoutSpec } from "../src/layout/layout";
import { heuristicMeasure } from "../src/layout/measure";
import { planCommands } from "../src/render/plan";
import { planOptionsFor } from "../src/render/index";
import { resolveInsetsSync } from "../src/render/inset";
import { lintCommands } from "../src/lint/lint";
import { cardTargets } from "../src/ui/card-model";
import { linkKindOf } from "../src/ui/link-model";
import { parsePlaylistText, itemsOf } from "../src/playlist/playlist";
import { ensureEnabledPacks, PACK_DEFS } from "../src/scenes/packs";
import { ensureEnginesForSpecs } from "../src/scenes/engines";
import { isReadyTemplate } from "../src/scenes/catalog";
import { templateParamErrors } from "../src/scenes/params-check";
import { splitVarOverrides, withOverrides } from "../src/render/params";
import { runWidget } from "../src/scenes/widget-run";
import { buildWidgetScene } from "../src/scenes/widget-scene";
import type { Command, Spec } from "../src/spec/types";

interface BundledExample {
  request: string;
  title?: string;
  spec?: Spec;
  playlist?: string;
  packs?: string[];
  /** Kept to be examined, not imitated — see src/main.ts. Skipped by every
   *  gate here, which all ask "is this example exemplary?" of entries that
   *  are on purpose not. tests/model-tier-examples.test.ts gates them. */
  specimen?: boolean;
}

const examples = (bundledExamples as BundledExample[]).filter((e) => !e.specimen);

/** An inset clone whose picture is resolved in `beforeAll`, once packs and
 *  engines are ready — NOT at module load, when `cases` is built (a source
 *  template a pack registers, like `equation_steps`, does not exist as a
 *  scene yet at that point, and mathjax has not measured a font). */
interface DeferredInsetResolve {
  spec: Spec;
  siblings: Spec[];
  index: number;
}
const deferredInsetResolves: DeferredInsetResolve[] = [];

/** Every spec an example carries: a single spec, or each item of its
 *  playlist — with every `card` beat EXPANDED into its elements and commands
 *  first, exactly as render() and the compile-time lint expand it
 *  (src/spec/card.ts): without that the gate read a card as "command with no
 *  recognized verb skipped", so no bundled example could open with the
 *  disappearing heading STYLE.md's 2026-09-16 ruling asks for.
 *
 *  Any inset is CLONED off its own siblings here (so `cases` below holds the
 *  object `beforeAll` later mutates in place) but not yet RESOLVED — see
 *  `deferredInsetResolves` (spec 2026-09-17-inset §9: the gate resolves
 *  insets, synchronously, the same way render() does, so a `point` at a part
 *  INSIDE one is exercised by the same layout/plan/lint checks as everything
 *  else, not skipped). Only a playlist item can have siblings; a single-spec
 *  example is unchanged. */
function specsOf(ex: BundledExample): Spec[] {
  if (ex.spec) return [expandSpec(ex.spec)];
  if (ex.playlist) {
    const items = itemsOf(parsePlaylistText(ex.playlist)).map((it) => ({ ...it, spec: expandSpec(it.spec) }));
    const siblings = items.map((it) => it.spec);
    return items.map((it, i) => {
      if (!(it.spec.elements ?? []).some((e) => e.type === "inset")) return it.spec;
      const clone = structuredClone(it.spec);
      deferredInsetResolves.push({ spec: clone, siblings, index: i });
      return clone;
    });
  }
  return [];
}

const cases = examples.flatMap((ex) => specsOf(ex).map((spec, i) => [`${ex.request}${i > 0 ? ` [part ${i + 1}]` : ""}`, spec] as const));

/** `resolveInsetsSync` stores `picture` on an inset element for layout/plan
 *  to read — a render-time-only field the compiler-facing schema does not
 *  carry (render() itself only resolves insets AFTER validateSpec, never
 *  before). Strip it before validating, the one check that runs on the
 *  authored shape rather than the resolved one. */
function stripPictures(spec: Spec): Spec {
  if (!(spec.elements ?? []).some((el) => el.type === "inset" && "picture" in el)) return spec;
  return {
    ...spec,
    elements: (spec.elements ?? []).map((el) => {
      if (el.type !== "inset" || !("picture" in el)) return el;
      const { picture: _picture, ...rest } = el;
      return rest;
    }),
  };
}

/** The spec at a plan-time param set: template params overlaid, `vars.<name>` keys into vars (the shape render() builds). */
function specAt(spec: Spec, params: Record<string, number>): Spec {
  const split = splitVarOverrides(params);
  return { ...spec, params: withOverrides(spec.params, split.params), ...(Object.keys(split.vars).length > 0 ? { vars: { ...(spec.vars ?? {}), ...split.vars } } : {}) };
}

beforeAll(async () => {
  // The app enables every bundled pack by default; an example may also name
  // its own (loadBundledExample enables those before rendering).
  await ensureEnabledPacks(Object.keys(PACK_DEFS));
  await ensureEnginesForSpecs(cases.map(([, spec]) => spec));
  // Now that every pack is registered and every engine an inset's SOURCE
  // needs is ready (equation_steps needs mathjax, registered by mathlogic),
  // resolve the insets `specsOf` deferred — into the very spec objects
  // `cases` already holds, so every test below sees the resolved picture.
  for (const { spec, siblings, index } of deferredInsetResolves) resolveInsetsSync(spec, siblings, index, heuristicMeasure, planOptionsFor);
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

  // Planned the way render() plans it — WITH the layout's boxes. Without them
  // every geometry-dependent verb (flip through a point, arrange, move to a
  // ref) resolved to nothing and warned, and a gate that only read "unknown
  // id" never saw it: the symmetry example was quietly emitting `flip target
  // "tri" has no geometry (skipped)`. So: no warning at all, of any kind.
  test.each(cases)("%s — validates, lays out, and plans with no warning at all", (_req, spec) => {
    expect(validateSpec(stripPictures(spec)).ok).toBe(true);
    const layout = layoutSpec(spec);
    const bboxes = elementBBoxes(layout);
    const plan = planCommands(spec.commands, layout.order, {
      bboxOf: (id) => bboxes.get(id) ?? null,
      windows: layout.windows ?? {},
      ...domainMapping(spec.domain, layout.fit),
      animateBase: spec.template ? spec.params ?? {} : null,
      // Same shape render() builds (src/render/index.ts): after an animate
      // step the planner switches its bbox source to the post-animate
      // layout, so later steps (a move to a ref, a flip through a point)
      // target where things actually are, not where they started.
      // … and after a relayout step (a move of something an intersection,
      // an angle or an arrow is defined by) it reads the posed layout; a
      // var-animate keeps its value under vars.<name> (design 2026-09-10).
      varsBase: spec.vars ?? null,
      bboxesFor: (params, overrides) => {
        // A stage relayout has no draw beat: the draw-beat lints (code's, template-id-off) are skipped here.
        const l = layoutSpec(specAt(spec, params), undefined, overrides, undefined, { skipDrawBeatLint: true });
        // The layout AFTER the move or the sweep is what the viewer sees:
        // it must lay out as cleanly as the first frame (review finding 9).
        expect(l.warnings, `after ${JSON.stringify(params)} ${JSON.stringify(overrides)}`).toEqual([]);
        expect(l.issues.filter((i) => i.severity === "error"), `after ${JSON.stringify(params)}`).toEqual([]);
        const b = elementBBoxes(l);
        return (id) => b.get(id) ?? null;
      },
      // planOptionsFor carries `controlsOf` too, so a `run` or an explore
      // demo in a bundled example is planned exactly as the app plans it —
      // without it every run would warn here and every demo would silently
      // plan nothing, and this gate could not fail on a sweep.
      ...planOptionsFor(spec, layout),
    });
    expect(plan.warnings).toEqual([]);
  });

  // Stricter than the compiler's own repair gate (which only repairs errors):
  // these are the figures the app shows off and the model imitates, so a
  // cosmetic warning — a label sitting on a stroke, say — is a defect here.
  test.each(cases)("%s — lays out with no lint issue at all, not even a warning", (_req, spec) => {
    const l = layoutSpec(spec);
    expect(l.issues.map((i) => `[${i.severity}] ${i.message}`)).toEqual([]);
    // Layout WARNINGS too (a code mark that no drawn line carries, an unknown
    // attach_to…): tests/molecule3d.test.ts checked them and this gate did not,
    // so a revised example passed here and failed there (2026-09-25).
    expect(l.warnings).toEqual([]);
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

  // A template param the storyboard animates (a demand shift, a threshold, a
  // camera angle) is a promise about the frame the viewer then sits on: that
  // frame must lint as cleanly as the first, warnings included. The planning
  // test above only asks the posed layout for errors; the frames harness
  // found an E label pushed onto its guides after an AD shift that this gate
  // passed (2026-09-25 example revisions).
  // Examples this check found colliding when it was added, awaiting their
  // revision in the example-revision batches (docs/2026-09-25-example-revision-
  // lessons.md). The list only shrinks; a new entry is a regression.
  const PENDING_ANIMATE_LINT = new Set([
    "Explain how bicycle gears work: why a small rear cog makes pedalling harder but faster, and a big one easier but slower.",
    "A tax is collected from sellers, so why do buyers end up paying part of it?",
  ]);
  test.each(cases)("%s — every template param state the storyboard animates to lints clean", (req, spec) => {
    if (!spec.template || PENDING_ANIMATE_LINT.has(req)) return;
    const varNames = new Set(Object.keys(spec.vars ?? {}));
    let overrides: Record<string, number> = {};
    for (const cmd of (spec.commands ?? []) as Command[]) {
      if (!cmd.animate) continue;
      const next = { ...overrides };
      let touched = false;
      for (const [k, v] of Object.entries(cmd.animate)) {
        if (typeof v !== "number" || k === "stage" || varNames.has(k)) continue;
        next[k] = v;
        touched = true;
      }
      if (!touched) continue;
      overrides = next;
      const at = layoutSpec({ ...spec, params: withOverrides(spec.params, overrides) }, undefined, undefined, undefined, { skipDrawBeatLint: true });
      expect(at.issues.map((i) => `[${i.severity}] ${i.message}`), JSON.stringify(overrides)).toEqual([]);
    }
  });

  // An animate target is a promise about a LATER frame: the tests above only
  // ever see stage 0. A figure that lints clean at rest and collides halfway
  // through its own animation is exactly the defect an example must not model.
  test.each(cases)("%s — every stage the storyboard animates to lays out as cleanly as the first", (_req, spec) => {
    for (const cmd of (spec.commands ?? []) as Command[]) {
      const stage = cmd.animate?.stage;
      if (typeof stage !== "number") continue;
      const at = layoutSpec({ ...spec, params: withOverrides(spec.params, { stage }) }, undefined, undefined, undefined, { skipDrawBeatLint: true });
      expect(at.warnings, `stage ${stage}`).toEqual([]);
      expect(at.issues.filter((i) => i.severity === "error"), `stage ${stage}`).toEqual([]);
    }
  });

  // The same promise for a var (design 2026-09-10 §2.4): the figure at every
  // value the storyboard sweeps to — cumulative, as the player reaches them —
  // lays out with no warning and no error.
  test.each(cases)("%s — every var value the storyboard animates to lays out as cleanly as the first", (_req, spec) => {
    if (!spec.vars) return;
    let vars = { ...spec.vars };
    for (const cmd of (spec.commands ?? []) as Command[]) {
      if (!cmd.animate) continue;
      const next = { ...vars };
      for (const [k, v] of Object.entries(cmd.animate)) if (typeof v === "number" && k in vars) next[k] = v;
      vars = next;
      const at = layoutSpec({ ...spec, vars }, undefined, undefined, undefined, { skipDrawBeatLint: true });
      expect(at.warnings, JSON.stringify(vars)).toEqual([]);
      expect(at.issues.filter((i) => i.severity === "error"), JSON.stringify(vars)).toEqual([]);
    }
  });

  // The same promise for a formula morph (design 2026-09-10-formula-morph
  // §4/Task 8): the boundary a `morph.tex` step settles on — the committed
  // frame the player's stub reprojector lands on once the tween finishes
  // (just `math.tex`, no `from`/`t`) — must lay out as cleanly as the rest.
  // Walked in storyboard order so a `copy` made AFTER an earlier morph
  // inherits that morph's tex into the accumulated `math` map, exactly as
  // plan.ts's own `tex` map does (a copy of a copy in the derivation idiom
  // must show the copy's CURRENT formula, not its original one) — and the
  // copy's own id follows plan.ts's own default-naming rule: `<target>_copy`,
  // then `_copy_2`, … per repeated source, or the authored `as`.
  test.each(cases)("%s — every morph.tex boundary lays out cleanly", (_req, spec) => {
    const commands = (spec.commands ?? []) as Command[];
    if (!commands.some((c) => c.morph?.tex !== undefined)) return;
    const copies: Record<string, string> = {};
    const math: Record<string, { tex: string }> = {};
    const copyCount = new Map<string, number>();
    for (const cmd of commands) {
      if (cmd.copy !== undefined) {
        const src = cmd.copy.target;
        let as = cmd.copy.as;
        if (as === undefined) {
          const n = (copyCount.get(src) ?? 0) + 1;
          copyCount.set(src, n);
          as = n === 1 ? `${src}_copy` : `${src}_copy_${n}`;
        }
        copies[as] = src;
        if (math[src]) math[as] = math[src];
      } else if (cmd.morph?.tex !== undefined) {
        const targets = Array.isArray(cmd.morph.target) ? cmd.morph.target : [cmd.morph.target];
        for (const target of targets) math[target] = { tex: cmd.morph!.tex! };
        const at = layoutSpec(spec, undefined, { math: { ...math }, copies: { ...copies } });
        expect(at.warnings, `after morph ${JSON.stringify(cmd.morph)}`).toEqual([]);
        expect(at.issues.filter((i) => i.severity === "error"), `after morph ${JSON.stringify(cmd.morph)}`).toEqual([]);
      }
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

  // `crossing` is a LICENCE: a keyed drawable may overlap another keyed one
  // without the lint calling it a defect. Nothing in the type system says who
  // may hand that licence out — and src/llm/author.ts ships kit.ts verbatim to
  // the template-authoring model, "Race templates only" comment and all, while
  // user templates and remote packs register through the same path. So pin the
  // roster: with every bundled pack enabled, only line_chart and bar_race may
  // produce a keyed drawable. A third template appearing here is either a
  // deliberate extension (update this list, and say why) or an authored
  // template quietly buying itself an exemption.
  test("only line_chart and bar_race stamp `crossing` — the exemption is not a licence anyone can take", () => {
    const keyed = new Set<string>();
    for (const scene of Object.values(scenes)) {
      if (!scene.layout) continue; // a stub draws nothing
      for (const ex of scene.manifest.examples) {
        let out;
        try {
          out = scene.layout(ex.params as Record<string, unknown>);
        } catch {
          continue; // a body that refuses these params is somebody else's test
        }
        for (const d of flattenDrawables(out.drawables)) {
          if (typeof (d as { crossing?: unknown }).crossing === "string") keyed.add(scene.manifest.name);
        }
      }
    }
    expect([...keyed].sort()).toEqual(["bar_race", "line_chart"]);
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

  // A template that can be WORKED must survive being worked: one click on
  // every part at the example's params, no error, no dropped effect.
  test("every ready template with a widget body runs clean under one click per part", () => {
    for (const s of Object.values(scenes)) {
      if (s.manifest.status !== "ready" || !s.widget) continue;
      for (const ex of s.manifest.examples) {
        const scene = buildWidgetScene(s, ex.params);
        expect(scene, s.manifest.name).not.toBeNull();
        const run = runWidget(s, ex.params, scene!.ids);
        expect(run.errors, `${s.manifest.name} ${ex.request}`).toEqual([]);
      }
    }
  });
  test("the widgets pack ships at least three worked widgets", () => {
    expect(Object.values(scenes).filter((s) => s.manifest.status === "ready" && s.widget).length).toBeGreaterThanOrEqual(3);
  });
});
