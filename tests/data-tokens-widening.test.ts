// accepts_data: one flag on a template manifest widens its params schema so
// a "{codeId.var}" data token may stand in wherever a harvested variable
// could fill a value — a number, an array of number, an array of string, or
// an array of array of number. Hand-editing sixty schemas would drift; this
// pins the one function that does it (data-schema.ts) and the wiring that
// applies it at registration (doc.ts's accepts_data flag, registry.ts's
// registerTemplateDoc).

import { describe, expect, test } from "vitest";
import { widenForDataTokens, DATA_TOKEN_PATTERN } from "../src/scenes/data-schema";
import { registerPack, unregisterPack } from "../src/scenes/packs";
import { scenes } from "../src/scenes/registry";
import { templateParamErrors } from "../src/scenes/params-check";

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
