// bar_chart `sort` (spec 2026-10-04-page-frame, W14): the bars stand in order
// of their value at the stage shown, slide to their new places through a
// fractional stage, and keep their ids, colours and labels with the category.
import { beforeAll, describe, expect, test } from "vitest";
import dataYaml from "../src/scenes/packs/data.yaml?raw";
import { registerPack } from "../src/scenes/packs";
import { layoutSpec } from "../src/layout/layout";
import { expandSpec } from "../src/spec/expand";
import { flattenDrawables, type AreaDrawable, type TextDrawable } from "../src/layout/model";
import { barSlot, guessParts, guessSetup, patchFor } from "../src/guess/handles";
import { withOverrides } from "../src/render/params";
import type { Spec } from "../src/spec/types";

beforeAll(() => {
  expect(registerPack("data", dataYaml).errors).toEqual([]);
});

// Native speakers (stage 0) and all speakers (stage 1), millions.
const LANGS = ["Mandarin", "Spanish", "English", "Hindi"];
const STAGES = [
  [940, 486, 380, 345],
  [1200, 560, 1500, 610],
];
const chart = (extra: object = {}): Spec =>
  ({ template: "bar_chart", params: { labels: LANGS, values: STAGES, stage: 0, sort: "desc", ...extra }, commands: [] }) as unknown as Spec;
type L = ReturnType<typeof layoutSpec>;
const all = (l: L) => flattenDrawables(l.drawables);
const fillOf = (l: L, i: number) => all(l).find((d) => d.id === `bar_${i}__f0`) as AreaDrawable;
const centreX = (l: L, i: number) => {
  const xs = fillOf(l, i).pts.map((p) => p[0]);
  return (Math.min(...xs) + Math.max(...xs)) / 2;
};
const height = (l: L, i: number) => {
  const ys = fillOf(l, i).pts.map((p) => p[1]);
  return Math.max(...ys) - Math.min(...ys);
};
/** Category names left to right. */
const order = (l: L) =>
  LANGS.map((_, i) => i + 1)
    .sort((a, b) => centreX(l, a) - centreX(l, b))
    .map((i) => LANGS[i - 1]);

describe("slot order per stage", () => {
  test("desc: largest first at each stage", () => {
    expect(order(layoutSpec(chart()))).toEqual(["Mandarin", "Spanish", "English", "Hindi"]);
    expect(order(layoutSpec(chart({ stage: 1 })))).toEqual(["English", "Mandarin", "Hindi", "Spanish"]);
  });
  test("asc: smallest first", () => {
    expect(order(layoutSpec(chart({ sort: "asc", stage: 1 })))).toEqual(["Spanish", "Hindi", "Mandarin", "English"]);
  });
  test("none (and no sort) keeps label order", () => {
    expect(order(layoutSpec(chart({ sort: "none", stage: 1 })))).toEqual(LANGS);
    expect(order(layoutSpec(chart({ sort: undefined, stage: 1 })))).toEqual(LANGS);
  });
  test("ties keep the authored order", () => {
    const l = layoutSpec(chart({ values: [5, 7, 5, 7] }));
    expect(order(l)).toEqual(["Spanish", "Hindi", "Mandarin", "English"]);
  });
  test("slots are the same places an unsorted chart uses", () => {
    const sorted = layoutSpec(chart({ stage: 1 }));
    const plain = layoutSpec(chart({ stage: 1, sort: "none" }));
    // English (bar_3) stands where bar_1 stands unsorted.
    expect(centreX(sorted, 3)).toBeCloseTo(centreX(plain, 1), 6);
    expect(centreX(sorted, 1)).toBeCloseTo(centreX(plain, 2), 6);
  });
});

describe("ids follow the category", () => {
  test("bar_3 is English at every stage: its label, value and colour go with it", () => {
    for (const stage of [0, 0.5, 1]) {
      const l = layoutSpec(chart({ stage, value_labels: true }));
      const label = all(l).find((d) => d.id === "bar_3__l") as TextDrawable;
      const value = all(l).find((d) => d.id === "bar_3__v0") as TextDrawable;
      expect(label.text).toBe("English");
      expect(label.pos[0]).toBeCloseTo(centreX(l, 3), 6);
      expect(value.pos[0]).toBeCloseTo(centreX(l, 3), 6);
    }
    const a = layoutSpec(chart({ stage: 0 })), b = layoutSpec(chart({ stage: 1 }));
    expect(fillOf(a, 3).style.fill).toBe(fillOf(b, 3).style.fill);
  });
});

describe("a fractional stage", () => {
  test("half way: the slot and the height are both half way", () => {
    const a = layoutSpec(chart({ stage: 0 })), m = layoutSpec(chart({ stage: 0.5 })), b = layoutSpec(chart({ stage: 1 }));
    for (const i of [1, 2, 3, 4]) {
      expect(centreX(m, i)).toBeCloseTo((centreX(a, i) + centreX(b, i)) / 2, 6);
      expect(height(m, i)).toBeCloseTo((height(a, i) + height(b, i)) / 2, 6);
    }
    // English is on its way from third to first.
    expect(centreX(m, 3)).toBeLessThan(centreX(a, 3));
    expect(centreX(m, 3)).toBeGreaterThan(centreX(b, 3));
  });
  test("barSlot mirrors the template", () => {
    const p = chart().params as Record<string, unknown>;
    expect(LANGS.map((_, i) => barSlot({ ...p, stage: 0 }, i))).toEqual([0, 1, 2, 3]);
    expect(LANGS.map((_, i) => barSlot({ ...p, stage: 1 }, i))).toEqual([1, 3, 0, 2]);
    expect(barSlot({ ...p, stage: 0.25 }, 2)).toBeCloseTo(1.5, 9);
    expect(barSlot({ ...p, sort: "none", stage: 1 }, 2)).toBe(2);
    expect(barSlot({ ...p, series: [{ values: STAGES }], stage: 1 }, 2)).toBe(2);
  });
});

describe("series and lint", () => {
  test("sort is ignored with series, with a warning", () => {
    const spec = {
      template: "bar_chart",
      params: { labels: ["a", "b"], sort: "desc", series: [{ name: "x", values: [1, 9] }, { name: "y", values: [2, 3] }] },
      commands: [],
    } as unknown as Spec;
    const l = layoutSpec(spec);
    const x = (id: string) => Math.min(...(all(l).find((d) => d.id === id) as AreaDrawable).pts.map((p) => p[0]));
    expect(x("bar_1__f0")).toBeLessThan(x("bar_2__f0"));
    expect(l.issues.some((i) => i.rule === "template-params" && /sort orders one series only/.test(i.message))).toBe(true);
    expect(layoutSpec(chart()).issues.filter((i) => i.rule === "template-params")).toEqual([]);
  });
});

describe("guessing a sorted chart", () => {
  const setupAt = (stage: number, on: string) => {
    const s = expandSpec(chart({ stage }));
    const layout = layoutSpec(s);
    return { layout, setup: guessSetup(s, s.params ?? {}, layout, guessParts(s, on)) };
  };
  const logicalX = (layout: L, x: number) => x * (layout.fit?.s ?? 1) + (layout.fit?.dx ?? 0);
  test("the handle stands on the bar at the stage of the ask", () => {
    for (const stage of [0, 1]) {
      const { layout, setup } = setupAt(stage, "bar_3");
      const h = setup.handles[0];
      expect(h.dx).toBe(2); // the category: beside_bars halves bar_3, wherever it stands
      expect(h.cx).toBeCloseTo(logicalX(layout, centreX(layout, 3)), 4);
      expect(h.truth).toEqual([STAGES[stage][2]]);
    }
  });
  test("on: all — every handle on its own bar", () => {
    const { layout, setup } = setupAt(1, "all");
    expect(setup.handles.map((h) => h.part)).toEqual(["bar_1", "bar_2", "bar_3", "bar_4"]);
    setup.handles.forEach((h, k) => expect(h.cx).toBeCloseTo(logicalX(layout, centreX(layout, k + 1)), 4));
  });
  test("the dragged bar keeps its place while it is guessed", () => {
    const s = expandSpec(chart({ stage: 1 }));
    const layout = layoutSpec(s);
    const setup = guessSetup(s, s.params ?? {}, layout, ["bar_3"]);
    expect(setup.pin["sort_values"]).toEqual(STAGES);
    // English guessed at 100 (it is really 1500): painted low, still first.
    const patch = patchFor(s, setup, [[100]]);
    const painted = layoutSpec({ ...s, params: withOverrides(s.params ?? {}, patch.params) } as Spec);
    expect(order(painted)).toEqual(["English", "Mandarin", "Hindi", "Spanish"]);
    expect(height(painted, 3)).toBeLessThan(height(layout, 3) / 5);
  });
});

describe("a prediction on a sorted chart", () => {
  test("its marks travel with the bar to the place it ends in", async () => {
    globalThis.requestAnimationFrame ??= ((cb: FrameRequestCallback) =>
      setTimeout(() => cb(performance.now()), 5) as unknown as number) as typeof requestAnimationFrame;
    const { Player } = await import("../src/render/player");
    const { planCommands } = await import("../src/render/plan");
    const { SpeechManager } = await import("../src/render/speech");
    const { formatterFor } = await import("../src/guess/handles");
    class Quiet extends SpeechManager {
      override get available(): boolean { return false; }
      override speak(): Promise<void> { return Promise.resolve(); }
      override cancel(): void {}
    }
    // English: third (cx 300) at stage 0, first (cx 100) at stage 1.
    const handle = (stage: number) => ({
      part: "bar_3", shows: ["bar_3"], kind: "height" as const, truth: [stage >= 1 ? 1500 : 380], min: 0, max: 1600, step: 10, label: "English",
      format: formatterFor(10), unit: "", paths: ["values.0.2"], dx: 2, cx: stage >= 1 ? 100 : 300, halfW: 40, toLogical: (p: [number, number]) => [p[0], p[1] / 4] as [number, number],
    });
    const plan = planCommands(
      [
        { ask: { question: "How many?", on: "bar_3", predict: true, tolerance: 0.1 } },
        { animate: { stage: 1 }, duration: 0.2 },
      ] as never,
      ["axes", "bar_1", "bar_2", "bar_3"],
      { animateBase: { stage: 0, values: STAGES }, guessParts: (on) => ({ parts: Array.isArray(on) ? on : [on], shows: ["bar_3"] }) },
    );
    const player = new Player(plan, new Map(), new Quiet(), null, { mode: "narrated" });
    player.reprojector = { frame: () => {}, commit: () => new Map(), committed: () => null };
    player.guess = {
      setup: (_on, _from, params) => ({ handles: [handle(Number(params["stage"] ?? 0))], pin: {}, warnings: [] }),
      patch: (_s, values) => ({ params: { "values.0.2": values[0][0] } }),
    };
    const marks: { owner: string; m: { lines: { pts: [number, number][] }[] } | null }[] = [];
    (player as unknown as { effects: unknown }).effects = new Proxy({}, { get: (_t, k) => (k === "setGuessMarks" ? (owner: string, m: never) => void marks.push({ owner, m }) : () => {}) });
    player.askGate = async () => "1000";
    await player.play();
    const mine = marks.filter((x) => x.owner === "guess_0" && x.m && x.m.lines.length > 0);
    const xs = (m: (typeof mine)[number]) => m.m!.lines.flatMap((l) => l.pts.map((p) => p[0]));
    // At the end every mark stands on the bar's new place (cx 100 ± its half width) …
    expect(Math.max(...xs(mine[mine.length - 1]))).toBeLessThanOrEqual(100 + 40 + 1);
    // … and on the way it passed between the two.
    expect(mine.some((m) => { const c = Math.min(...xs(m)); return c > 100 - 40 + 5 && c < 300 - 40 - 5; })).toBe(true);
  });
});
