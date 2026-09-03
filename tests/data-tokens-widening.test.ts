// accepts_data: one flag on a template manifest widens its params schema so
// a "{codeId.var}" data token may stand in wherever a harvested variable
// could fill a value — a number, an array of number, an array of string, or
// an array of array of number. Hand-editing sixty schemas would drift; this
// pins the one function that does it (data-schema.ts) and the wiring that
// applies it at registration (doc.ts's accepts_data flag, registry.ts's
// registerTemplateDoc).

import { beforeAll, describe, expect, test } from "vitest";
import { widenForDataTokens, DATA_TOKEN_PATTERN } from "../src/scenes/data-schema";
import { parsePack, registerPack, unregisterPack } from "../src/scenes/packs";
import { scenes } from "../src/scenes/registry";
import { templateParamErrors } from "../src/scenes/params-check";
import { layoutSpec } from "../src/layout/layout";
import { flattenDrawables, type StrokeDrawable, type TextDrawable } from "../src/layout/model";
import evidenceYaml from "../src/scenes/packs/evidence.yaml?raw";
import htaYaml from "../src/scenes/packs/hta.yaml?raw";
import empiricsYaml from "../src/scenes/packs/empirics.yaml?raw";
import type { Spec } from "../src/spec/types";

describe("widenForDataTokens", () => {
  test("a number leaf also accepts a token string", () => {
    const w = widenForDataTokens({ type: "object", properties: { mean: { type: "number" } } }) as any;
    expect(w.properties.mean.oneOf).toEqual([{ type: "number" }, { type: "string", pattern: DATA_TOKEN_PATTERN }]);
  });

  test("an array-of-number leaf is widened, not replaced", () => {
    const w = widenForDataTokens({ type: "object", properties: { xs: { type: "array", items: { type: "number" } } } }) as any;
    expect(w.properties.xs.oneOf[0]).toEqual({ type: "array", items: { type: "number" } });
    expect(w.properties.xs.oneOf[1]).toEqual({ type: "string", pattern: DATA_TOKEN_PATTERN });
  });

  test("an array-of-string leaf is widened", () => {
    const w = widenForDataTokens({ type: "object", properties: { names: { type: "array", items: { type: "string" }, maxItems: 2 } } }) as any;
    expect(w.properties.names.oneOf[0]).toEqual({ type: "array", items: { type: "string" }, maxItems: 2 });
    expect(w.properties.names.oneOf[1]).toEqual({ type: "string", pattern: DATA_TOKEN_PATTERN });
  });

  test("an array-of-array-of-number leaf is widened", () => {
    const w = widenForDataTokens({
      type: "object",
      properties: { ys: { type: "array", items: { type: "array", items: { type: "number" } } } },
    }) as any;
    expect(w.properties.ys.oneOf[0]).toEqual({ type: "array", items: { type: "array", items: { type: "number" } } });
    expect(w.properties.ys.oneOf[1]).toEqual({ type: "string", pattern: DATA_TOKEN_PATTERN });
  });

  test("a boolean or enum leaf is left alone — a token cannot be a mode", () => {
    const src = { type: "object", properties: { on: { type: "boolean" }, how: { type: "string", enum: ["a", "b"] } } };
    expect(widenForDataTokens(src)).toEqual(src);
  });

  test("a plain (non-array) string leaf is left alone — not one of the four shapes", () => {
    const src = { type: "object", properties: { title: { type: "string" } } };
    expect(widenForDataTokens(src)).toEqual(src);
  });

  test("a number nested inside an array of objects is widened (arms[].survival shape)", () => {
    const src = {
      type: "object",
      properties: {
        arms: {
          type: "array",
          items: {
            type: "object",
            properties: {
              label: { type: "string" },
              color: { type: "string", enum: ["a", "b"] },
              survival: { type: "array", items: { type: "number" } },
            },
            required: ["label", "survival"],
          },
        },
      },
    };
    const w = widenForDataTokens(src) as any;
    expect(w.properties.arms.items.properties.survival.oneOf[0]).toEqual({ type: "array", items: { type: "number" } });
    // label (plain string) and color (enum) travel unwidened, required is preserved verbatim.
    expect(w.properties.arms.items.properties.label).toEqual({ type: "string" });
    expect(w.properties.arms.items.properties.color).toEqual({ type: "string", enum: ["a", "b"] });
    expect(w.properties.arms.items.required).toEqual(["label", "survival"]);
  });

  test("a number nested inside a plain (non-array) object property is widened (pooled.est shape)", () => {
    const src = {
      type: "object",
      properties: {
        pooled: { type: "object", properties: { est: { type: "number" }, side: { type: "string", enum: ["upper", "lower"] } } },
      },
    };
    const w = widenForDataTokens(src) as any;
    expect(w.properties.pooled.properties.est.oneOf[0]).toEqual({ type: "number" });
    expect(w.properties.pooled.properties.side).toEqual({ type: "string", enum: ["upper", "lower"] });
  });

  test("it does not mutate its input", () => {
    const src = { type: "object", properties: { mean: { type: "number" } } };
    const copy = JSON.parse(JSON.stringify(src));
    widenForDataTokens(src);
    expect(src).toEqual(copy);
  });

  test("an already-widened leaf is left alone (idempotent) — running it twice matches running it once", () => {
    const once = widenForDataTokens({ type: "object", properties: { mean: { type: "number" } } });
    const twice = widenForDataTokens(once);
    expect(twice).toEqual(once);
  });

  test("a schema carrying the data pack's own inline token pattern is left alone (idempotent against hand-authored widening)", () => {
    const src = {
      type: "object",
      properties: {
        x: { oneOf: [{ type: "array", items: { type: "number" }, maxItems: 40 }, { type: "string", pattern: DATA_TOKEN_PATTERN }] },
      },
    };
    expect(widenForDataTokens(src)).toEqual(src);
  });
});

describe("accepts_data wiring", () => {
  const YAML_WITH_FLAG = `
pack: zz_widen_test_pack
title: Test
description: Test pack for accepts_data wiring.
---
template: zz_widen_test_flagged
version: 1
kit: 1
status: ready
description: A test template with accepts_data set.
accepts_data: true
params:
  type: object
  properties:
    mean: { type: number }
    mode: { type: string, enum: [a, b] }
element_ids: {}
examples:
  - request: "test"
    params: {}
layout: |
  return { drawables: [], labels: [], anchors: {}, order: [] };
---
template: zz_widen_test_unflagged
version: 1
kit: 1
status: ready
description: A test template WITHOUT accepts_data, for contrast.
params:
  type: object
  properties:
    mean: { type: number }
element_ids: {}
examples:
  - request: "test"
    params: {}
layout: |
  return { drawables: [], labels: [], anchors: {}, order: [] };
`;

  test("a template flagged accepts_data carries the flag onto its manifest and validates a token where a number belongs", () => {
    const r = registerPack("zz_widen_test_pack", YAML_WITH_FLAG);
    expect(r.errors).toEqual([]);
    try {
      expect(scenes.zz_widen_test_flagged.manifest.accepts_data).toBe(true);
      expect(templateParamErrors("zz_widen_test_flagged", { mean: "{sim.mu}" })).toEqual([]);
      // Still rejects garbage that is neither a number nor a well-formed token.
      expect(templateParamErrors("zz_widen_test_flagged", { mean: "not a token" }).length).toBeGreaterThan(0);
      // The flag never reaches an enum leaf — a token cannot select a mode.
      expect(templateParamErrors("zz_widen_test_flagged", { mode: "{sim.mode}" }).length).toBeGreaterThan(0);
    } finally {
      unregisterPack("zz_widen_test_pack");
    }
  });

  test("a template WITHOUT accepts_data keeps rejecting a token where a number belongs", () => {
    const r = registerPack("zz_widen_test_pack", YAML_WITH_FLAG);
    expect(r.errors).toEqual([]);
    try {
      expect(scenes.zz_widen_test_unflagged.manifest.accepts_data).toBeUndefined();
      expect(templateParamErrors("zz_widen_test_unflagged", { mean: "{sim.mu}" }).length).toBeGreaterThan(0);
    } finally {
      unregisterPack("zz_widen_test_pack");
    }
  });
});

// ---------------------------------------------------------------------------
// The six retrofitted templates (M4). The mechanism above is generic; this is
// the payoff — the figures a health economist actually computes with, opted in
// one at a time. What each must hold:
//
//   1. `accepts_data: true` on the manifest, so registration widens its schema.
//   2. A description that TELLS the model tokens are welcome (the catalog is
//      the only place the model learns this; a widened schema it never sees).
//   3. The placeholder promise: the editor lints BEFORE any script has run, so
//      a still-unresolved "{sim.v}" must lay out as quiet placeholder geometry
//      — no throw, no warning, no lint issue — and every beat the resolved
//      figure will mint must ALREADY exist, or `draw: [...]` reports "unknown
//      id" against a figure that is merely waiting for its numbers.
//   4. A bumped `version` (the pack docs' own change marker).
//
// Each fixture below puts its token exactly where a harvested variable goes,
// and each geometry assertion names what the placeholder actually looks like.

const RETROFIT = ["distribution_curve", "forest_plot", "survival_curve", "ceac", "did_trends", "event_study"] as const;

/** Params with a token in the place a script fills, plus the typed companions
 *  (names, labels, arms) that supply the shape before the numbers arrive. */
const TOKEN_FED: Record<(typeof RETROFIT)[number], Record<string, unknown>> = {
  distribution_curve: { shade: { from: "{stat.crit}", side: "two", label: "2.5% each tail" } },
  forest_plot: {
    measure: "RR",
    studies: [
      { label: "Anderson 2015", est: "{meta.est0}", lo: "{meta.lo0}", hi: "{meta.hi0}" },
      { label: "Bianchi 2017", est: "{meta.est1}", lo: "{meta.lo1}", hi: "{meta.hi1}" },
    ],
    pooled: { est: "{meta.pooled_est}", lo: "{meta.pooled_lo}", hi: "{meta.pooled_hi}" },
  },
  survival_curve: {
    arms: [
      { label: "Treatment", survival: "{km.treated}" },
      { label: "Control", survival: "{km.control}" },
    ],
  },
  ceac: {
    strategies: [
      { label: "New treatment", midpoint: "{psa.mid}" },
      { label: "Standard care", midpoint: "{psa.mid}", rising: false },
    ],
    thresholds: "{psa.wtp}",
  },
  did_trends: { effect: "{did.beta}", group_labels: ["Treated", "Control"] },
  event_study: { effect: "{es.beta}", ci: "{es.se}" },
};

/** Beats the RESOLVED figure will mint — every one must exist while the token
 *  is still a raw string, or the editor reports "unknown id" before the run. */
const TOKEN_FED_BEATS: Record<(typeof RETROFIT)[number], string[]> = {
  distribution_curve: ["axis", "curve", "shade", "shade2", "shade_label", "mean_line"],
  forest_plot: ["null_line", "ci_0", "study_0", "study_label_0", "est_label_0", "ci_1", "study_1", "pooled", "pooled_label", "axis"],
  survival_curve: ["axes", "arm_0", "arm_label_0", "arm_1", "arm_label_1"],
  ceac: ["axes", "half_line", "curve_0", "curve_label_0", "curve_1", "curve_label_1"],
  did_trends: ["axes", "treat_line", "control_line", "treated_line", "counterfactual", "effect_arrow"],
  event_study: ["axes", "zero_line", "treat_line", "coef_0"],
};

describe("the six retrofitted templates accept {id.var}", () => {
  beforeAll(() => {
    for (const [id, yaml] of [["evidence", evidenceYaml], ["hta", htaYaml], ["empirics", empiricsYaml]] as const) {
      expect(registerPack(id, yaml).errors, id).toEqual([]);
    }
  });

  const lay = (id: string, params: Record<string, unknown>) => layoutSpec({ template: id, params } as Spec);
  // Placed labels land in `drawables` (as text) and in `order`, so both
  // sources together are every id a `draw:` command could name.
  const ids = (l: ReturnType<typeof layoutSpec>) => new Set([...l.order, ...flattenDrawables(l.drawables).map((d) => d.id)]);
  const textOf = (l: ReturnType<typeof layoutSpec>, id: string) =>
    (flattenDrawables(l.drawables).find((d) => d.id === id) as TextDrawable | undefined)?.text;

  test.each(RETROFIT)("%s carries accepts_data, so its schema is widened at registration", (id) => {
    expect(scenes[id].manifest.accepts_data).toBe(true);
  });

  test.each(RETROFIT)("%s tells the model it accepts tokens", (id) => {
    expect(scenes[id].manifest.description).toMatch(/\{[a-z]+\.[a-z]+\}|data token/i);
  });

  test.each(RETROFIT)("%s bumped its version — the retrofit is a documented change", (id) => {
    const yaml = id === "ceac" ? htaYaml : id === "did_trends" || id === "event_study" ? empiricsYaml : evidenceYaml;
    const doc = parsePack(yaml).pack!.templates.find((t) => t.template === id)!;
    expect(doc.version).toBeGreaterThanOrEqual(2);
  });

  test.each(RETROFIT)("%s validates a token where its data belongs", (id) => {
    expect(templateParamErrors(id, TOKEN_FED[id])).toEqual([]);
  });

  // This round's schema-vs-example canary, extended past the data pack (its
  // home is tests/data-pack.test.ts, scoped to the six data-pack templates).
  // These six now have BOTH a widened schema and manifest examples, which is
  // exactly the combination that cost an earlier task a fix round: layoutSpec
  // lints a shape the body can render and says nothing about whether that same
  // shape validates against the template's OWN declared params_schema — the
  // schema the compiler shows the model verbatim (src/scenes/catalog.ts). The
  // pack tests only ever lay these examples out, so nothing checked it here.
  test.each(RETROFIT)("%s: every manifest example validates against its own (now widened) params schema", (id) => {
    for (const ex of scenes[id].manifest.examples) {
      expect(templateParamErrors(id, ex.params), `${id}: ${ex.request}`).toEqual([]);
    }
  });

  // The other half of the canary: widening must not have turned a numeric slot
  // into "any string". A malformed token, or plain prose, is still a defect.
  test.each([
    ["distribution_curve", { shade: { from: "1.96", side: "two" } }],
    // Two studies, so minItems is satisfied and the ONLY thing left to fail
    // is the malformed token in `est` (a one-study fixture would pass this
    // test for the wrong reason — verified by mutating the token branch).
    ["forest_plot", { studies: [{ label: "A", est: "{meta.est", lo: 0.6, hi: 1.0 }, { label: "B", est: 0.7, lo: 0.5, hi: 0.9 }] }],
    ["survival_curve", { arms: [{ label: "A", survival: "quite good" }] }],
    ["ceac", { thresholds: "{psa}" }],
    ["did_trends", { effect: "big" }],
    ["event_study", { ci: "{es.}" }],
  ] as const)("%s still refuses a string that is not a well-formed token", (id, params) => {
    expect(templateParamErrors(id, params).length, id).toBeGreaterThan(0);
  });

  // The requirement that decides this task.
  test.each(RETROFIT)("%s lays out an unresolved token as quiet placeholder geometry", (id) => {
    const l = lay(id, TOKEN_FED[id]);
    expect(l.warnings).toEqual([]);
    expect(l.issues).toEqual([]);
    for (const d of flattenDrawables(l.drawables)) {
      const pts = (d as { pts?: [number, number][] }).pts ?? [];
      const pos = (d as { pos?: [number, number] }).pos;
      for (const [x, y] of pos ? [...pts, pos] : pts) {
        expect(Number.isFinite(x) && Number.isFinite(y), `${id} ${d.id} ${x},${y}`).toBe(true);
        expect(Math.abs(x)).toBeLessThan(2000);
        expect(Math.abs(y)).toBeLessThan(2000);
      }
    }
  });

  test.each(RETROFIT)("%s mints every beat the resolved figure will mint, before the script runs", (id) => {
    const have = ids(lay(id, TOKEN_FED[id]));
    expect(TOKEN_FED_BEATS[id].filter((b) => !have.has(b)), id).toEqual([]);
  });

  // Per-template: what the placeholder actually IS, not just that it is quiet.
  test("forest_plot: a token-fed study and pooled estimate draw at the null with no invented numbers", () => {
    const l = lay("forest_plot", TOKEN_FED.forest_plot);
    const texts = flattenDrawables(l.drawables).filter((d): d is TextDrawable => d.kind === "text");
    const nullX = (flattenDrawables(l.drawables).find((d) => d.id === "null_line") as StrokeDrawable).pts[0][0];
    // The whisker collapses onto the null line: no width, so no fabricated CI.
    const ci = flattenDrawables(l.drawables).find((d) => d.id === "ci_0") as StrokeDrawable;
    for (const [x] of ci.pts) expect(x).toBeCloseTo(nullX, 6);
    // The "est [lo, hi]" column is dashes, not digits invented by the fallback.
    expect(texts.find((t) => t.id === "est_label_0")!.text).not.toMatch(/\d/);
    expect(texts.find((t) => t.id === "pooled_label__stats")!.text).not.toMatch(/\d/);
    // The typed study names are what supply the row count.
    expect(texts.map((t) => t.text)).toEqual(expect.arrayContaining(["Anderson 2015", "Bianchi 2017", "Pooled"]));
  });

  test("survival_curve: token-fed arms are flat at 100 % survival, both named, no median guides", () => {
    const l = lay("survival_curve", TOKEN_FED.survival_curve);
    const arm0 = flattenDrawables(l.drawables).find((d) => d.id === "arm_0") as StrokeDrawable;
    const ys = arm0.pts.map((p) => p[1]);
    expect(Math.min(...ys)).toBeCloseTo(Math.max(...ys), 6); // flat: nobody has died yet
    // Nothing crosses 50 %, so the median guides stay off the figure entirely
    // rather than being drawn at an invented crossing.
    expect(l.order).not.toContain("median_line");
    // The typed arm names are what supply the curve count before the numbers.
    expect(textOf(l, "arm_label_0")).toBe("Treatment");
    expect(textOf(l, "arm_label_1")).toBe("Control");
  });

  // ceac, did_trends and event_study are SCHEMATIC: every curve on them is
  // generated from shape knobs (a logistic midpoint, an effect size), so the
  // honest placeholder is the template's own default schematic — the figure it
  // draws when nobody has said anything yet — not an emptied frame.
  test("ceac / did_trends / event_study: an unresolved knob lays out exactly like the template's default", () => {
    for (const [id, defaults] of [
      ["ceac", { strategies: [{ label: "New treatment" }, { label: "Standard care", rising: false }] }],
      ["did_trends", { group_labels: ["Treated", "Control"] }],
      ["event_study", {}],
    ] as const) {
      const token = lay(id, TOKEN_FED[id as (typeof RETROFIT)[number]]);
      const plain = lay(id, defaults);
      expect(JSON.stringify(token.drawables), id).toBe(JSON.stringify(plain.drawables));
    }
    // ceac's thresholds default keeps threshold_0 alive: the beat an author
    // wrote against a token-fed thresholds list still exists offline.
    expect(lay("ceac", TOKEN_FED.ceac).order).toContain("threshold_0");
    expect(lay("event_study", TOKEN_FED.event_study).order.filter((id) => id.startsWith("coef_"))).toHaveLength(10);
  });

  test("distribution_curve: a token shade boundary still shades both tails and keeps the typed caption", () => {
    const l = lay("distribution_curve", TOKEN_FED.distribution_curve);
    expect(l.order).toEqual(expect.arrayContaining(["shade", "shade2"]));
    expect(textOf(l, "shade_label")).toBe("2.5% each tail");
  });
});
