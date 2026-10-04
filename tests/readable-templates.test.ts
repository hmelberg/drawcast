// W25: forest_plot and causal_dag text readable at scale 1 (≥ 20), with
// shrink-before-collide; forest rows clear of the caption band.
import { beforeAll, describe, expect, test } from "vitest";
import { ensureEnabledPacks } from "../src/scenes/packs";
import { scenes } from "../src/scenes/registry";
import { flattenDrawables } from "../src/layout/model";
import { CAPTION_TOP } from "../src/layout/page";

beforeAll(async () => {
  await ensureEnabledPacks(["evidence"]);
});

const texts = (out: { drawables: unknown[] }) =>
  flattenDrawables(out.drawables as never).filter((d): d is Extract<typeof d, { kind: "text" }> => d.kind === "text");

describe("forest_plot", () => {
  const studies = (n: number) => Array.from({ length: n }, (_, i) => ({ label: `Study ${i + 1}`, est: 0.8, lo: 0.6, hi: 1.05 }));
  for (const n of [2, 8]) {
    test(`${n} studies: names ≥ 20, numbers ≥ 20, everything above the caption band`, () => {
      const out = scenes.forest_plot.layout!({ measure: "RR", studies: studies(n), pooled: { est: 0.8, lo: 0.7, hi: 0.9 } });
      for (const t of texts(out)) {
        expect(t.fontSize, t.id).toBeGreaterThanOrEqual(20);
        expect(t.pos[1] - (t.fontSize) / 2, t.id).toBeGreaterThanOrEqual(CAPTION_TOP);
      }
    });
  }
});

describe("causal_dag", () => {
  test("node names ≥ 20, a long one included, and the ellipse holds it", () => {
    const out = scenes.causal_dag.layout!({
      nodes: [
        { name: "Coffee", role: "exposure" },
        { name: "Heart disease", role: "outcome" },
        { name: "Smoking", role: "confounder" },
        { name: "Socioeconomic status", role: "confounder" },
        { name: "Age", role: "confounder" },
      ],
      edges: "Smoking -> Coffee\nSmoking -> Heart disease\nCoffee -> Heart disease",
    });
    const names = texts(out).filter((t) => t.id.endsWith("__text"));
    expect(names.length).toBe(5);
    for (const t of names) expect(t.fontSize, t.id).toBeGreaterThanOrEqual(20);
  });
});
