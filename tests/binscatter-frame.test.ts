// W25 follow-up: binscatter's plot sits in the page frame's content box (from
// y 205, like event_study / did_trends / rd_plot), clear of the caption band —
// and the bundled example that draws on it keeps its marks on the data.
import { beforeAll, describe, expect, test } from "vitest";
import { ensureEnabledPacks, PACK_DEFS } from "../src/scenes/packs";
import examples from "../src/examples.json";
import { expandSpec } from "../src/spec/expand";
import { layoutSpec } from "../src/layout/layout";
import { leafDrawables, type Pt } from "../src/layout/model";
import { CAPTION_TOP } from "../src/layout/page";
import type { Spec } from "../src/spec/types";

beforeAll(async () => {
  await ensureEnabledPacks(Object.keys(PACK_DEFS));
});

const pts = (l: ReturnType<typeof layoutSpec>, id: string): Pt[] => (leafDrawables(l.drawables).find((d) => d.id === id) as unknown as { pts: Pt[] }).pts;

describe("binscatter in the page frame", () => {
  test("the plot starts over the caption band", () => {
    const l = layoutSpec({ template: "binscatter", params: {}, commands: [] } as unknown as Spec);
    expect(l.frame?.box.y0).toBeGreaterThanOrEqual(CAPTION_TOP + 40);
    for (const d of leafDrawables(l.drawables)) {
      const p = (d as { pts?: Pt[] }).pts;
      if (p) for (const [, y] of p) expect(y).toBeGreaterThanOrEqual(CAPTION_TOP);
    }
  });

  test("the example's spread bar and ability line are in data units and land on the plot", () => {
    const e = (examples as { spec?: Spec }[]).find((x) => x.spec?.template === "binscatter")!;
    const l = layoutSpec(expandSpec(e.spec!));
    const f = l.frame!;
    const toY = (v: number) => f.box.y0 + ((v - f.y[0]) / (f.y[1] - f.y[0])) * (f.box.y1 - f.box.y0);
    const toX = (v: number) => f.box.x0 + ((v - f.x[0]) / (f.x[1] - f.x[0])) * (f.box.x1 - f.box.x0);
    // The spread bar stands at 5.75 years-of-schooling units, around the fit there.
    const [a, b] = pts(l, "spread");
    expect(a[0]).toBeCloseTo(toX(5.747), 1);
    expect(a[1]).toBeCloseTo(toY(2.819), 1);
    expect(b[1]).toBeCloseTo(toY(6.504), 1);
    const fit = pts(l, "fit");
    const atBar = fit.reduce((best, p) => (Math.abs(p[0] - a[0]) < Math.abs(best[0] - a[0]) ? p : best));
    expect(atBar[1]).toBeGreaterThan(a[1]);
    expect(atBar[1]).toBeLessThan(b[1]);
    // The ability line starts on the y axis.
    expect(pts(l, "ability_line")[0][0]).toBeCloseTo(f.box.x0, 1);
    expect(l.issues).toEqual([]);
  });
});
