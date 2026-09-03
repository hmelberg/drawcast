// The bar race. What is pinned: rank is interpolated (never recomputed from
// interpolated values), a racer's id follows the RACER and not its rank —
// the rough.js seed is hashSeed(id), so a rank-keyed id would re-roll a
// bar's sketchy stroke mid-overtake — and the top_n airlock lets a racer
// slide in and out instead of popping.

import { beforeAll, describe, expect, test } from "vitest";
import dataYaml from "../src/scenes/packs/data.yaml?raw";
import { registerPack } from "../src/scenes/packs";
import { scenes } from "../src/scenes/registry";
import { layoutSpec } from "../src/layout/layout";
import { plotArea } from "../src/layout/canvas";
import { heuristicMeasure } from "../src/layout/measure";
import { flattenDrawables, type AreaDrawable, type TextDrawable } from "../src/layout/model";
import type { Spec } from "../src/spec/types";

const plot = plotArea();

beforeAll(() => {
  expect(registerPack("data", dataYaml).errors).toEqual([]);
});

const race = (params: object) => layoutSpec({ template: "bar_race", params } as Spec);
const bar = (l: ReturnType<typeof layoutSpec>, i: number) =>
  flattenDrawables(l.drawables).find((d) => d.id === `race_${i}` && d.kind === "area") as AreaDrawable | undefined;
const rowY = (l: ReturnType<typeof layoutSpec>, i: number) => {
  const pts = bar(l, i)!.pts;
  return (Math.min(...pts.map((p) => p[1])) + Math.max(...pts.map((p) => p[1]))) / 2;
};
const barLen = (l: ReturnType<typeof layoutSpec>, i: number) => {
  const xs = bar(l, i)!.pts.map((p) => p[0]);
  return Math.max(...xs) - Math.min(...xs);
};
// A racer's name: the sub-drawable welded to its bar. "race_1_" is not a
// prefix of "race_10_text", so this stays exact past nine racers.
const racerName = (l: ReturnType<typeof layoutSpec>, i: number) =>
  (flattenDrawables(l.drawables).find((d) => d.kind === "text" && d.id.startsWith(`race_${i}_`)) as { text: string } | undefined)?.text;

// Two racers that swap between stage 0 and stage 1.
const SWAP = { labels: ["A", "B"], values: [[10, 6], [6, 10]] };

describe("bar_race", () => {
  test("is a ready template with one id per racer, in input order", () => {
    expect(scenes.bar_race?.manifest.status).toBe("ready");
    const l = race({ ...SWAP, stage: 0 });
    expect(l.order.filter((id) => id.startsWith("race_"))).toEqual(["race_1", "race_2"]);
  });

  test("the row position glides across the crossing instead of jumping", () => {
    const at = (s: number) => rowY(race({ ...SWAP, stage: s }), 1);
    const [y0, quarter, half, threeQ, y1] = [0, 0.25, 0.5, 0.75, 1].map(at);
    // Monotone, and the quarter step is a real fraction of the whole move —
    // a rank-snap would leave y unchanged until it jumped.
    expect(Math.abs(quarter - y0)).toBeGreaterThan(Math.abs(y1 - y0) * 0.15);
    expect(half).toBeCloseTo((y0 + y1) / 2, 0);
    expect(Math.abs(threeQ - y0)).toBeGreaterThan(Math.abs(quarter - y0));
  });

  test("bar length interpolates with the value", () => {
    expect(barLen(race({ ...SWAP, stage: 0.5 }), 1)).toBeCloseTo(barLen(race({ ...SWAP, stage: 0.5 }), 2), 0);
  });

  test("an id belongs to a racer, not to a rank", () => {
    // A is ahead at stage 0 and behind at stage 1; race_1 is A at both.
    const first = race({ ...SWAP, stage: 0 });
    const last = race({ ...SWAP, stage: 1 });
    expect(rowY(first, 1)).not.toBeCloseTo(rowY(last, 1), 0);
    // The racer's element and its name cannot BOTH be the bare id "race_1":
    // a layout with two drawables sharing an id is rejected outright
    // (src/scenes/compile.ts). "race_1" is the bar's fill — the drawable the
    // rough seed is keyed to — and the name rides the sub-drawable id
    // "race_1_text", so match the element or anything welded to it.
    const label = (l: ReturnType<typeof layoutSpec>) =>
      flattenDrawables(l.drawables)
        .filter((d) => d.kind === "text" && (d.id === "race_1" || d.id.startsWith("race_1_")))
        .map((d) => (d as { text: string }).text);
    expect(label(first).join(" ")).toContain("A");
    expect(label(last).join(" ")).toContain("A");
  });

  test("top_n keeps the field to n rows, and the n+1th is the airlock", () => {
    const l = race({
      labels: ["A", "B", "C", "D"],
      values: [[10, 8, 6, 4]],
      top_n: 2,
      stage: 0,
    });
    expect(bar(l, 1)).toBeDefined();
    expect(bar(l, 2)).toBeDefined();
    // Third place sits in the fading airlock row; fourth is not drawn at all.
    expect(bar(l, 4)).toBeUndefined();
    // …but it is still DECLARED. The player's plan-time `visible` set is
    // fixed before the tween (src/render/index.ts), so a racer that re-enters
    // the field mid-cast can only do so under an id that was in `order` all
    // along — dropping the off-field beat would leave every other assertion
    // here green and break re-entry.
    expect(l.order).toContain("race_4");
  });

  test("a racer climbing into the field fades in rather than popping", () => {
    const climbing = { labels: ["A", "B", "C"], values: [[10, 8, 1], [10, 1, 8]], top_n: 2 };
    const mid = race({ ...climbing, stage: 0.5 });
    const end = race({ ...climbing, stage: 1 });
    const op = (l: ReturnType<typeof layoutSpec>) => bar(l, 3)?.style.opacity ?? 0;
    expect(op(mid)).toBeGreaterThan(0);
    expect(op(mid)).toBeLessThan(op(end));
  });

  test("order: fixed keeps input order and animates lengths only", () => {
    const fixed = { ...SWAP, order: "fixed" };
    expect(rowY(race({ ...fixed, stage: 0 }), 1)).toBeCloseTo(rowY(race({ ...fixed, stage: 1 }), 1), 3);
    // "lengths only" is the other half: the row holds still, the bar does not.
    // A falls 10 → 6 while the leader is 10 at both stages, so it keeps 60 %.
    const [len0, len1] = [0, 1].map((s) => barLen(race({ ...fixed, stage: s }), 1));
    expect(len1).toBeCloseTo(len0 * 0.6, 6);
  });

  test("a race still waiting on its script draws named, zero-length bars", () => {
    // The placeholder promise: the editor lints BEFORE any script has run, so
    // a still-unresolved "{id.var}" token must lay out as a quiet placeholder
    // — the beats and the typed names present, the data merely absent — and
    // never as an error state.
    const l = race({ labels: ["Oslo", "Bergen", "Tromsø"], values: "{sim.v}", stage: 0 });
    expect(l.warnings).toEqual([]);
    expect(l.issues).toEqual([]);
    expect(l.order.filter((id) => id.startsWith("race_"))).toEqual(["race_1", "race_2", "race_3"]);
    expect([1, 2, 3].map((i) => barLen(l, i))).toEqual([0, 0, 0]);
    expect([1, 2, 3].map((i) => racerName(l, i))).toEqual(["Oslo", "Bergen", "Tromsø"]);
    // Not data yet is not wrong data: no refusal note is drawn.
    expect(flattenDrawables(l.drawables).some((d) => d.id === "note")).toBe(false);
  });

  test("a name too long for its margin is truncated, not run off the canvas", () => {
    // The left margin stops widening at 40 % of the plot, so a long enough
    // name would otherwise be drawn past x = 0 — out-of-canvas, which is an
    // ERROR, not a cosmetic overflow.
    const long = "United Kingdom of Great Britain and Northern Ireland"; // 52 chars
    const l = race({ labels: [long, "France"], values: [[10, 6]] });
    expect(l.warnings).toEqual([]);
    expect(l.issues.filter((i) => i.severity === "error")).toEqual([]);
    const drawn = racerName(l, 1)!;
    expect(drawn.endsWith("…")).toBe(true);
    expect(drawn.length).toBeLessThan(long.length);
    // A name that fits is left exactly alone.
    expect(racerName(l, 2)).toBe("France");
  });
});

// ---------------------------------------------------------------------------
// Everything the viewer actually READS: the scale and its ticks, the running
// year, the value on the bar, and the vertical field.
// ---------------------------------------------------------------------------

const textById = (l: ReturnType<typeof layoutSpec>, id: string) =>
  flattenDrawables(l.drawables).find((d) => d.kind === "text" && d.id === id) as TextDrawable | undefined;
// The value axis's tick labels. They live inside the `axes` group — ids are
// unique across the whole tree (src/scenes/compile.ts), so they cannot all BE
// "axes"; `axes__t0…` is the pack's own double-underscore child convention.
const tickLabels = (l: ReturnType<typeof layoutSpec>) =>
  flattenDrawables(l.drawables).filter((d): d is TextDrawable => d.kind === "text" && /^axes__t\d+$/.test(d.id));
const tickTexts = (l: ReturnType<typeof layoutSpec>) => tickLabels(l).map((d) => d.text);
const barBox = (l: ReturnType<typeof layoutSpec>, i: number) => {
  const pts = bar(l, i)!.pts;
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
};

describe("bar_race scale and furniture", () => {
  const growing = { labels: ["A", "B"], values: [[10, 5], [100, 50]] };

  test("the scale follows the leader, so the leader always fills the plot", () => {
    const early = race({ ...growing, stage: 0 });
    const late = race({ ...growing, stage: 1 });
    expect(barLen(early, 1)).toBeCloseTo(barLen(late, 1), 0);
  });

  test("xlim fixes the scale instead", () => {
    const early = race({ ...growing, stage: 0, xlim: [0, 100] });
    const late = race({ ...growing, stage: 1, xlim: [0, 100] });
    expect(barLen(early, 1)).toBeLessThan(barLen(late, 1) * 0.2);
  });

  test("tick values are chosen once and only their positions move", () => {
    const quarter = race({ ...growing, stage: 0.25 });
    const mid = race({ ...growing, stage: 0.5 });
    const end = race({ ...growing, stage: 1 });
    // The same tick vocabulary all the way along — ticks slide, they never
    // reflow.
    expect(new Set(tickTexts(end)).size).toBeGreaterThan(1);
    expect(tickTexts(end)).toEqual(["0", "20", "40", "60", "80", "100"]);
    expect(tickTexts(mid).every((t) => tickTexts(end).includes(t))).toBe(true);
    // The QUARTER stage is the assertion that discriminates, and it does so on
    // the step derivation itself rather than on any padding around it. The
    // leader is 32.5 there, and niceStep of 32.5 — or of the 35.1 range around
    // it — is 10, so a step re-derived from this frame puts "10" and "30" on
    // the axis, and neither is in the end's twenties vocabulary. (The half
    // stage does NOT discriminate: niceStep(55) is also 20, so its containment
    // holds under a per-frame recompute too. It is kept as coverage, not as
    // proof.)
    expect(tickTexts(quarter).every((t) => tickTexts(end).includes(t))).toBe(true);
    // Ticks past the current top are DROPPED, and the survivors have SLID
    // outward — same value, new position, which is what "positions are
    // recomputed every frame" means.
    expect(tickTexts(quarter).length).toBeLessThan(tickTexts(mid).length);
    expect(tickTexts(mid).length).toBeLessThan(tickTexts(end).length);
    const xOf = (l: ReturnType<typeof layoutSpec>, t: string) => tickLabels(l).find((d) => d.text === t)!.pos[0];
    expect(xOf(quarter, "20")).toBeGreaterThan(xOf(mid, "20"));
    expect(xOf(mid, "20")).toBeGreaterThan(xOf(end, "20"));
    expect(xOf(mid, "0")).toBeCloseTo(xOf(end, "0"), 6);
  });

  test("the ticker shows the nearest stage's caption, never a blend", () => {
    const l = race({ ...growing, ticker: ["1990", "2020"], stage: 0.6 });
    const tick = textById(l, "ticker")!;
    expect(tick.text).toBe("2020");
    // Large, dimmed, and in the plot's far corner — the clock is furniture the
    // bars run over, not a label competing with them.
    expect(tick.fontSize).toBe(46);
    expect(tick.style.opacity).toBeGreaterThan(0);
    expect(tick.style.opacity).toBeLessThan(0.6);
    expect(tick.pos[0]).toBeGreaterThan(plot.x0 + (plot.x1 - plot.x0) * 0.75);
    expect(tick.pos[1]).toBeLessThan(plot.y0 + (plot.y1 - plot.y0) * 0.25);
    // Just past the other side of the midpoint it is still the earlier year:
    // text does not interpolate, so it snaps to the nearer stage.
    expect(textById(race({ ...growing, ticker: ["1990", "2020"], stage: 0.4 }), "ticker")!.text).toBe("1990");
    // A beat the manifest advertises has to be addressable, not just drawn.
    expect(l.order).toContain("ticker");
    // No ticker param, no ticker drawable — and no dangling id either.
    const bare = race({ ...growing, stage: 0 });
    expect(textById(bare, "ticker")).toBeUndefined();
    expect(bare.order).not.toContain("ticker");
  });

  test("vertical orientation puts names under the bars and caps the field at 12", () => {
    const field = {
      labels: Array.from({ length: 15 }, (_, i) => "P" + i),
      values: [Array.from({ length: 15 }, (_, i) => 15 - i)],
      orientation: "vertical",
      stage: 0,
    };
    const l = race(field);
    expect(l.issues.filter((i) => /overlap/i.test(i.message))).toEqual([]);
    expect(bar(l, 13)).toBeUndefined();

    // Bars grow UPWARD out of the baseline, and the leader's is tall and
    // narrow — the horizontal fallback would be the exact reverse.
    const b1 = barBox(l, 1), b2 = barBox(l, 2);
    expect(b1.y0).toBeCloseTo(b2.y0, 6); // one shared baseline
    expect(b1.y1 - b1.y0).toBeGreaterThan(b2.y1 - b2.y0);
    expect(b1.x1 - b1.x0).toBeLessThan(b1.y1 - b1.y0);
    // The name sits UNDER its own column, centred on it — not off in a margin.
    const name = textById(l, "race_1_text")!;
    expect(name.text).toBe("P0");
    expect(name.anchor).toBe("middle");
    expect(name.pos[1]).toBeLessThan(b1.y0);
    expect(name.pos[0]).toBeCloseTo((b1.x0 + b1.x1) / 2, 6);
    // The value rides ABOVE the column here, not off its end.
    expect(textById(l, "race_1_value")!.pos[1]).toBeGreaterThan(b1.y1);

    // Twelve is the cap: top_n 20 gets 12 rows plus the one airlock row, where
    // the same request horizontally gets the full 20.
    const capped = race({ ...field, top_n: 20 });
    expect(bar(capped, 13)).toBeDefined();
    expect(bar(capped, 14)).toBeUndefined();
    const wide = race({ ...field, orientation: "horizontal", top_n: 20 });
    expect(bar(wide, 15)).toBeDefined();
  });

  test("value labels stay inside the plot at full length", () => {
    const l = race({ labels: ["A"], values: [[100]], value_labels: true, stage: 0, decimals: 0 });
    const label = textById(l, "race_1_value")!;
    expect(label.text).toBe("100");
    expect(label.pos[0]).toBeLessThan(plot.x1);
    expect(l.issues).toEqual([]);
    // The hard case: a fixed scale the leader reaches EXACTLY, so there is no
    // headroom left outside the bar. The label turns and rides inside its own
    // end rather than running off the plot.
    const full = race({ labels: ["A"], values: [[100]], value_labels: true, xlim: [0, 100], decimals: 0 });
    const rid = textById(full, "race_1_value")!;
    expect(rid.anchor).toBe("end");
    expect(rid.pos[0]).toBeLessThanOrEqual(plot.x1);
    expect(full.issues.filter((i) => i.rule === "out-of-canvas")).toEqual([]);
  });

  test("the clock never swallows a number a bar is carrying", () => {
    // `order: "fixed"` is what puts the LONGEST bar in the BOTTOM row — right
    // under the ticker's own corner. The number a viewer most wants must not
    // be the one that disappears: it turns around and rides the year's near
    // edge instead.
    const l = race({ labels: ["A", "B", "C", "D"], values: [[1, 2, 3, 100]], order: "fixed", ticker: ["1999"], x_label: "N" });
    const v = textById(l, "race_4_value")!;
    const clock = textById(l, "ticker")!;
    expect(v.text).toBe("100");
    expect(v.anchor).toBe("end");
    expect(v.pos[0]).toBeLessThan(clock.pos[0] - heuristicMeasure(clock.text, clock.fontSize).w);
    expect(l.issues).toEqual([]);
  });

  test("value labels are on by default and off when asked", () => {
    expect(textById(race({ labels: ["A"], values: [[7]] }), "race_1_value")!.text).toBe("7");
    expect(textById(race({ labels: ["A"], values: [[7]], value_labels: false }), "race_1_value")).toBeUndefined();
  });

  test("the tick vocabulary survives a race that spikes and a race that ends at nothing", () => {
    // A spike: the leader peaks at 1000 mid-race and finishes at 100. The
    // step comes from the finish, so the peak frame would carry fifty ticks
    // unless the step is coarsened ONCE, from numbers no frame can change.
    const spike = { labels: ["A"], values: [[100], [1000], [100]] };
    expect(tickTexts(race({ ...spike, stage: 1 })).length).toBeLessThanOrEqual(13);
    expect(tickTexts(race({ ...spike, stage: 2 })).every((t) => tickTexts(race({ ...spike, stage: 1 })).includes(t))).toBe(true);
    // …and the axis still reaches the leader at the top of the spike, rather
    // than stopping a quarter of the way along with the rest of the ticks cut.
    const atPeak = tickLabels(race({ ...spike, stage: 1 }));
    expect(atPeak[atPeak.length - 1].pos[0]).toBeGreaterThan(plot.x0 + (plot.x1 - plot.x0) * 0.8);
    // A race everyone has left by the last stage: the final stage's magnitude
    // is 0 and would name no ticks at all, so the vocabulary falls back to the
    // largest number the race ever reaches.
    expect(tickTexts(race({ labels: ["A"], values: [[80], [0]], stage: 0 })).length).toBeGreaterThan(1);
    // A fixed range never widens, so data far outside it must not coarsen the
    // ticks away — xlim's own span is the only thing that sizes them.
    expect(tickTexts(race({ labels: ["A"], values: [[9999]], xlim: [0, 10] }))).toEqual(["0", "2", "4", "6", "8", "10"]);
  });

  test("a ticker still waiting on its script keeps its beat", () => {
    // An id missing from `order` is a DROPPED command (src/render/plan.ts) —
    // so a "{code.var}" ticker has to declare the beat before it can fill it.
    const l = race({ labels: ["A"], values: [[7]], ticker: "{sim.years}" });
    expect(l.order).toContain("ticker");
    expect(textById(l, "ticker")!.text).toBe("");
    expect(l.issues).toEqual([]);
    // …and an unresolved clock claims no room: the value label keeps the side
    // it would have had with no ticker at all.
    expect(textById(l, "race_1_value")!.anchor).toBe("start");
  });

  // `null` is ABSENCE — not in the field — and 0 is the number zero. The
  // distinction earns its keep at the transition: a racer that arrives must
  // arrive AT its value, not climb into it from a number the data never
  // contained. "Kasparov 1345" is the defect these three tests forbid.
  const entering = { labels: ["A", "B"], values: [[10, null], [10, 40]] };
  const leaving = { labels: ["A", "B"], values: [[10, 40], [10, null]] };

  test("null means absent: ranked last, drawn as nothing, still holding its beat", () => {
    const l = race({ ...entering, stage: 0 });
    expect(bar(l, 2)).toBeUndefined();
    expect(textById(l, "race_2_value")).toBeUndefined();
    expect(textById(l, "race_2_text")).toBeUndefined();
    // …but never dropped from `order`: the player's plan-time `visible` set is
    // fixed before the tween, so a racer that arrives mid-cast can only do so
    // under an id that was there all along (the Task 4 re-entry invariant).
    expect(l.order).toContain("race_2");
    // Absent ranks BELOW a genuine zero — 0 is a value, absence is not.
    const zeroVsNull = race({ labels: ["A", "B", "C"], values: [[5, 0, null]], top_n: 3 });
    expect(rowY(zeroVsNull, 2)).toBeLessThan(rowY(zeroVsNull, 1)); // B (0) sits under A (5)
    expect(bar(zeroVsNull, 3)).toBeUndefined();                    // C (null) is not there at all
    expect(textById(zeroVsNull, "race_2_value")!.text).toBe("0");  // and zero still reads as zero
  });

  test("a racer arrives AT its value instead of growing into it", () => {
    const at = (s: number) => race({ ...entering, stage: s });
    for (const s of [0.01, 0.25, 0.5, 0.75, 1]) {
      expect(textById(at(s), "race_2_value")!.text, `stage ${s}`).toBe("40");
      expect(barLen(at(s), 2), `stage ${s}`).toBeCloseTo(barLen(at(1), 2), 6);
    }
    // It fades in over the transition rather than popping — the same gesture
    // the airlock makes, driven by the data instead of by the ranking.
    const op = (s: number) => bar(at(s), 2)!.style.opacity;
    expect(op(0.25)).toBeGreaterThan(0);
    expect(op(0.25)).toBeLessThan(op(0.75));
    expect(op(0.75)).toBeLessThan(op(1));
  });

  test("a racer leaving holds the last length it really had", () => {
    const at = (s: number) => race({ ...leaving, stage: s });
    for (const s of [0, 0.25, 0.5, 0.75, 0.99]) {
      expect(textById(at(s), "race_2_value")!.text, `stage ${s}`).toBe("40");
      expect(barLen(at(s), 2), `stage ${s}`).toBeCloseTo(barLen(at(0), 2), 6);
    }
    expect(bar(at(0.25), 2)!.style.opacity).toBeGreaterThan(bar(at(0.75), 2)!.style.opacity);
    expect(bar(at(1), 2)).toBeUndefined();
  });

  test("the bundled chess race never draws a rating the data does not contain", () => {
    // The few-shot itself, swept: every value label at every quarter stage has
    // to be a real rating or lie between two real ones. Before `null`, an
    // unrated player interpolated 0 → 2690 and the chart drew "1345".
    const ex = (scenes.bar_race!.manifest.examples as { request: string; params: Record<string, unknown> }[])
      .find((e) => /chess/i.test(e.request))!;
    const rated = (ex.params.values as (number | null)[][]).flat().filter((v): v is number => typeof v === "number");
    const floor = Math.min(...rated), ceil = Math.max(...rated);
    expect(rated).not.toContain(0);
    for (let q = 0; q <= 16; q++) {
      const l = race({ ...ex.params, stage: q / 4 });
      for (const d of flattenDrawables(l.drawables)) {
        if (d.kind !== "text" || !/^race_\d+_value$/.test(d.id)) continue;
        const v = Number((d as TextDrawable).text);
        expect(v, `stage ${q / 4} ${d.id} = ${(d as TextDrawable).text}`).toBeGreaterThanOrEqual(floor);
        expect(v, `stage ${q / 4} ${d.id} = ${(d as TextDrawable).text}`).toBeLessThanOrEqual(ceil);
      }
    }
  });

  test("the scale is sized by the field on screen, not by a racer nobody can see", () => {
    // B arrives at stage 2. At the INTEGER stage 1 — a frame a storyboard
    // rests on, and the one a viewer reads at leisure — B's presence is still
    // 0, so it is not drawn. Sizing the plot for its arriving value would
    // collapse the visible leader to a sliver with nothing on screen to
    // explain it; §5.2's promise is continuity in `stage`.
    const arriving = { labels: ["A", "B"], values: [[10, null], [10, null], [10, 1000]] };
    const at1 = race({ ...arriving, stage: 1 });
    expect(bar(at1, 2)).toBeUndefined();
    expect(barLen(at1, 1)).toBeCloseTo(barLen(race({ ...arriving, stage: 0 }), 1), 6);
    expect(barLen(at1, 1)).toBeGreaterThan((plot.x1 - plot.x0) * 0.9);
    // …and the scale then grows WITH the racer as it fades in, so the leader's
    // collapse happens while something visible is causing it.
    expect(barLen(race({ ...arriving, stage: 1.5 }), 1)).toBeLessThan(barLen(at1, 1) * 0.2);
  });

  test("a race whose every number is zero or less refuses, drawn", () => {
    // Bars start at the low end of the scale and clamp into it, so nothing
    // here can have any length: the figure would be a bare arrow with names
    // beside it and no lint issue to explain the silence.
    const l = race({ labels: ["A", "B"], values: [[-5, -3]] });
    const n = textById(l, "note")!;
    expect(n.text).toMatch(/zero or less/);
    expect(l.order).toContain("note");
    expect(l.issues).toEqual([]);
    expect(l.warnings).toEqual([]);
    // The numbers go with it — a column of values against the axis with no
    // bars beside them is the same silence, differently dressed.
    expect(textById(l, "race_1_value")).toBeUndefined();
    // All zeroes is the same case; a race that merely PASSES THROUGH zero is
    // not, and neither is one that starts at zero and goes somewhere.
    expect(textById(race({ labels: ["A"], values: [[0]] }), "note")).toBeDefined();
    expect(textById(race({ labels: ["A", "B"], values: [[-5, 10]] }), "note")).toBeUndefined();
    expect(textById(race({ labels: ["A", "B"], values: [[0, 0], [5, 3]] }), "note")).toBeUndefined();
    // Not data yet is not wrong data: an unresolved token never refuses.
    expect(textById(race({ labels: ["A"], values: "{sim.v}" }), "note")).toBeUndefined();
    // And it still lints clean at the row count where the note's own row is
    // tightest — 20 racers plus the airlock.
    const crowded = race({
      labels: Array.from({ length: 21 }, (_, i) => "Racer " + i),
      values: [Array.from({ length: 21 }, (_, i) => -i)],
      top_n: 20,
      title: "Nothing to race",
      x_label: "Points",
    });
    expect(textById(crowded, "note")).toBeDefined();
    expect(crowded.issues).toEqual([]);
  });

  test("a race still waiting on its script draws no ticks and no values", () => {
    // The placeholder promise again: "not data yet" must not be dressed up as
    // a scale reading 0…1 with a column of zeroes hanging off it.
    const l = race({ labels: ["Oslo", "Bergen"], values: "{sim.v}", stage: 0 });
    expect(tickTexts(l)).toEqual([]);
    expect(textById(l, "race_1_value")).toBeUndefined();
    expect(l.issues).toEqual([]);
  });

  test("degenerate fields still lay out: one stage, all equal, values spanning zero", () => {
    for (const params of [
      { labels: ["A", "B"], values: [[5, 5]] },
      { labels: ["A", "B"], values: [[0, 0]] }, // draws the refusal note; still lays out cleanly
      { labels: ["A", "B"], values: [[-5, 10]], stage: 0 },
      { labels: ["A", "B", "C"], values: [[3, 2, 1]], top_n: 2 }, // C sits exactly ON the airlock row
    ]) {
      const l = race(params);
      expect(l.warnings, JSON.stringify(params)).toEqual([]);
      expect(l.issues, JSON.stringify(params)).toEqual([]);
      // A negative number never draws a bar running backwards past the names.
      for (const i of [1, 2]) expect(barBox(l, i).x0, JSON.stringify(params)).toBeGreaterThanOrEqual(plot.x0 - 1e-6);
    }
  });
});
