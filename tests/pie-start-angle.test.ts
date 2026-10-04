// W28: a pie chart's start_angle — where the first slice starts, in degrees
// clockwise from 12 o'clock (default 0, unchanged).
import { beforeAll, describe, expect, test } from "vitest";
import dataYaml from "../src/scenes/packs/data.yaml?raw";
import { registerPack } from "../src/scenes/packs";
import { layoutSpec } from "../src/layout/layout";
import { leafDrawables, type Pt } from "../src/layout/model";
import { expandSpec } from "../src/spec/expand";
import { clockFraction, guessParts, guessSetup, pointFor } from "../src/guess/handles";
import type { Spec } from "../src/spec/types";

beforeAll(() => {
  registerPack("data", dataYaml);
});

const pie = (extra: Record<string, unknown> = {}): Spec => ({ template: "pie_chart", params: { labels: ["A", "B", "C"], values: [50, 30, 20], ...extra }, commands: [] }) as Spec;

/** A wedge's outline: centre first, then the rim from its start edge clockwise. */
function wedge(s: Spec, id: string): Pt[] {
  const d = leafDrawables(layoutSpec(s).drawables).find((x) => x.id === `${id}__f`) as { pts: Pt[] };
  return d.pts;
}
const clock = (c: Pt, p: Pt): number => clockFraction(c, p);

describe("pie_chart start_angle", () => {
  test("default: the first slice starts at 12 o'clock — the same drawing as before", () => {
    const pts = wedge(pie(), "slice_1");
    expect(clock(pts[0], pts[1])).toBeCloseTo(0, 3);
    expect(JSON.stringify(layoutSpec(pie({ start_angle: 0 })).drawables)).toBe(JSON.stringify(layoutSpec(pie()).drawables));
  });

  test("90 starts the first slice at 3 o'clock; the rest follow clockwise", () => {
    const s = pie({ start_angle: 90 });
    const a = wedge(s, "slice_1");
    expect(clock(a[0], a[1])).toBeCloseTo(0.25, 3);
    // Half the pie later the second slice begins: 3 o'clock + a half turn = 9 o'clock.
    const b = wedge(s, "slice_2");
    expect(clock(b[0], b[1])).toBeCloseTo(0.75, 3);
  });

  test("the slices' names keep clear of each other on a turned pie", () => {
    const s = pie({ labels: ["A", "B", "C", "D", "E"], values: [80, 5, 5, 5, 5], start_angle: 200 });
    const texts = leafDrawables(layoutSpec(s).drawables).filter((d) => d.kind === "text") as { pos: Pt; fontSize: number; anchor: string }[];
    for (let i = 0; i < texts.length; i++)
      for (let j = i + 1; j < texts.length; j++) {
        if (texts[i].anchor !== texts[j].anchor) continue;
        expect(Math.abs(texts[i].pos[1] - texts[j].pos[1])).toBeGreaterThanOrEqual(texts[i].fontSize * 1.25);
      }
  });

  test("a guess on a turned pie reads and draws from its start", () => {
    const s = expandSpec(pie({ start_angle: 90 }));
    const layout = layoutSpec(s);
    const h = guessSetup(s, s.params ?? {}, layout, guessParts(s, "slice_1")).handles[0];
    expect(h.pie?.start).toBeCloseTo(0.25);
    // The first slice's far edge at the truth (50 %) is at 9 o'clock.
    const p = pointFor(h, [50])!;
    expect(clockFraction(h.centre!, p)).toBeCloseTo(0.75, 3);
    // And a pointer there reads 50 % from the start.
    expect(clockFraction(h.centre!, p, h.pie?.start) * 100).toBeCloseTo(50, 3);
  });
});
