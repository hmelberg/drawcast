// des_hta: the movie sweeps t and the viewer drags it and scrubs the hazard
// ratio — every stop along the way must lay out clean, not just the author's.
import { expect, test } from "vitest";
import { scenes } from "../src/scenes/registry";
import { layoutSpec } from "../src/layout/layout";

test("des_hta: lint-clean at every cursor time and hazard ratio, in every view with a cursor", () => {
  const bad: string[] = [];
  for (const ex of scenes.des_hta.manifest.examples) {
    const P = ex.params as Record<string, unknown> & { horizon: number; strategies: { hr?: unknown }[] };
    for (const view of ["timelines", "curves", "overview"]) {
      for (let k = 0; k <= 30; k++) {
        const t = (P.horizon * k) / 30;
        for (const hr of [0.3, 1, 1.8]) {
          const h = P.strategies[1].hr;
          const s1 = { ...P.strategies[1], hr: h && typeof h === "object" ? Object.fromEntries(Object.keys(h).map((key) => [key, hr])) : hr };
          const params = { ...P, strategies: [P.strategies[0], s1], view, t };
          const res = layoutSpec({ template: "des_hta", params, elements: [] } as never);
          for (const i of res.issues) bad.push(`${view} t=${t.toFixed(2)} hr=${hr}: ${i.message}`);
        }
      }
    }
  }
  expect(bad.slice(0, 20)).toEqual([]);
});
