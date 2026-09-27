// sir_compartments parity (2026-09-28): the template grew a live model mode
// (a time-series plot, R0, vaccination, an intervention window). Every spec
// written before it — the bundled examples, the manifest's own — names no
// model parameter and must paint exactly as it did. The snapshot was taken
// on the flow-diagram-only template, before the model was added.
import { beforeAll, describe, expect, test } from "vitest";
import { ensureEnabledPacks } from "../src/scenes/packs";
import { scenes } from "../src/scenes/registry";
import { layoutSpec } from "../src/layout/layout";
import examples from "../src/examples.json";
import type { Spec } from "../src/spec/types";

beforeAll(async () => {
  await ensureEnabledPacks(["evidence"]);
});

const LEGACY_PARAMS: Record<string, unknown>[] = [
  {},
  { compartments: ["S", "E", "I", "R"] },
  { compartments: ["S", "E", "I", "R"], rates: ["β·S·I", "σ·E", "γ·I"], show_loop: { from: "R", to: "S", label: "Waning immunity" } },
  { labels: ["Un-bitten", "Zombie", "Removed"] },
  { compartments: ["S", "I", "S"] },
  { compartments: ["S", "I", "R", "D"], rates: ["β", "γ", "δ"] },
  { box: "left" },
  { box: { x: 40, y: 395, w: 920, h: 285 } },
];

describe("sir_compartments: specs without model params paint as before", () => {
  test.each(LEGACY_PARAMS.map((p) => [JSON.stringify(p), p]))("layout %s", (_name, params) => {
    const out = scenes.sir_compartments.layout!(params as Record<string, unknown>);
    expect(out).toMatchSnapshot();
  });

  // Only the flow-diagram casts: a bundled example with a model parameter
  // (r0, model) is the live mode's own and has no "before" to hold.
  const bundled = (examples as { request: string; spec: Spec }[]).filter((e) => {
    if (e.spec?.template !== "sir_compartments") return false;
    const p = (e.spec.params ?? {}) as Record<string, unknown>;
    return p.r0 === undefined && p.model === undefined;
  });
  test("there are bundled examples to hold", () => {
    expect(bundled.length).toBeGreaterThanOrEqual(3);
  });
  test.each(bundled.map((e) => [e.request, e.spec]))("bundled: %s", (_req, spec) => {
    const page = layoutSpec(spec as Spec);
    expect({ drawables: page.drawables, warnings: page.warnings }).toMatchSnapshot();
  });
});
