import { describe, expect, test } from "vitest";
import { layoutSpec } from "../src/layout/layout";
import { beforeAll } from "vitest";
import { ensureEnabledPacks, PACK_DEFS } from "../src/scenes/packs";
import type { Spec } from "../src/spec/types";
import { leafDrawables, type TextDrawable } from "../src/layout/model";

describe("sampling_dist axis numbers", () => {
  beforeAll(async () => {
    await ensureEnabledPacks(Object.keys(PACK_DEFS));
  });

  const layoutFor = (n: number) => {
    const spec = { template: "sampling_dist", params: { shape: "skewed", n }, commands: [] } as unknown as Spec;
    return layoutSpec(spec);
  };

  test("the baselines carry a sparse fixed ruler", () => {
    const texts = leafDrawables(layoutFor(5).drawables).filter((d): d is TextDrawable => d.kind === "text");
    const ticks = texts.filter((t) => ["0", "5", "10"].includes(t.text));
    expect(ticks.length).toBe(6); // 0/5/10 on both panels
  });

  test("the SE bracket narrows and its number shrinks as n grows", () => {
    const seLabel = (n: number) => {
      const texts = leafDrawables(layoutFor(n).drawables).filter((d): d is TextDrawable => d.kind === "text");
      return texts.find((t) => t.text.startsWith("±"))!.text;
    };
    const wide = Number(seLabel(4).slice(2));
    const tight = Number(seLabel(64).slice(2));
    expect(wide).toBeGreaterThan(0);
    expect(tight).toBeCloseTo(wide / 4, 1); // se = sd/√n: 16× the n, 1/4 the spread
  });
});
