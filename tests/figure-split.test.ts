// The figure split (2026-09-04): a template and a script on screen get one
// half of the canvas each instead of both claiming all of it. The pure rule
// here; the layout wiring and the overlap lint below it.

import { beforeAll, describe, expect, test } from "vitest";
import { figureSplit, CODE_HALF } from "../src/layout/figure-split";
import { layoutSpec, elementBBoxes } from "../src/layout/layout";
import { heuristicMeasure } from "../src/layout/measure";
import { ensureEnabledPacks, PACK_DEFS } from "../src/scenes/packs";
import type { Spec } from "../src/spec/types";

const CODE = "years = [0, 10, 20]\nvalues = [100, 122, 149]";

describe("figureSplit — the rule", () => {
  const base = { hasTemplate: true, templateTakesBox: true, boxGiven: false };

  test("a figure with no template is left entirely alone", () => {
    expect(figureSplit({ ...base, hasTemplate: false, code: {} })).toEqual({});
  });

  test("a script that only feeds data claims nothing — the template keeps the canvas", () => {
    expect(figureSplit({ ...base, code: null })).toEqual({});
  });

  test("an untouched code element takes the reading side and the figure takes the rest", () => {
    const s = figureSplit({ ...base, code: {} });
    expect(s.code).toEqual({ x: 225, width: 410 });
    expect(s.box).toEqual({ x: 470, y: 95, w: 470, h: 560 }); // the hand-tuned convention
  });

  test("a panel of pure code hugs its longest line, and the slack goes to the figure", () => {
    const short = figureSplit({ ...base, code: { show: "code", code: "years = [0, 10, 20]" } });
    expect(short.code!.width).toBe(260); // the floor: narrower than this is not code, it is a stripe
    expect(short.box!.w).toBeGreaterThan(470); // more room than the fixed half ever gave it
    // A long line still wraps INSIDE the half rather than eating the chart's room.
    const long = figureSplit({ ...base, code: { show: "code", code: "x".repeat(200) } });
    expect(long.code!.width).toBe(CODE_HALF.width);
    // Between the two, the panel is as wide as the script needs.
    const mid = figureSplit({ ...base, code: { show: "code", code: "x".repeat(30) } });
    expect(mid.code!.width).toBeGreaterThan(260);
    expect(mid.code!.width).toBeLessThan(CODE_HALF.width);
    expect(mid.code!.x).toBe(20 + mid.code!.width / 2); // left edge stays put as it grows
  });

  test("a panel carrying its own output pane keeps the half — hugging would squeeze the output", () => {
    expect(figureSplit({ ...base, code: { show: "left", code: "y = 1" } }).code).toEqual({ ...CODE_HALF });
  });

  test("an author's x and width win, and the figure moves to the side they left", () => {
    const s = figureSplit({ ...base, code: { x: 775, width: 410 } }); // script on the RIGHT
    expect(s.code).toBeUndefined();
    expect(s.box!.x).toBe(60);
    expect(s.box!.x + s.box!.w).toBeLessThanOrEqual(775 - 410 / 2 - 40);
  });

  test("a declared box is never touched, and neither is a template that cannot take one", () => {
    expect(figureSplit({ ...base, boxGiven: true, code: {} }).box).toBeUndefined();
    expect(figureSplit({ ...base, templateTakesBox: false, code: {} }).box).toBeUndefined();
    // the code element is still given its half — that part does not depend on the box
    expect(figureSplit({ ...base, templateTakesBox: false, code: {} }).code).toEqual({ ...CODE_HALF });
  });

  test("a code panel too wide to share leaves the figure unboxed for the lint to report", () => {
    expect(figureSplit({ ...base, code: { x: 500, width: 880 } }).box).toBeUndefined();
  });
});

describe("the split in a real layout", () => {
  beforeAll(async () => {
    await ensureEnabledPacks(Object.keys(PACK_DEFS));
  });

  const spec = (el: object, params: object = {}): Spec =>
    ({
      template: "bar_chart",
      params: { labels: ["0", "10", "20"], values: [100, 122, 149], ...params },
      elements: [{ id: "calc", type: "code", language: "brython", show: "code", code: CODE, ...el }],
      commands: [{ draw: ["calc", "calc_line_1"] }, { draw: ["axes", "bar_1", "bar_2", "bar_3"] }],
    }) as unknown as Spec;

  test("the script and the chart no longer share ground, and neither is warned about", () => {
    const l = layoutSpec(spec({}), heuristicMeasure);
    const boxes = elementBBoxes(l, heuristicMeasure);
    // Frameless, so the panel's ink IS its lines — that is what must clear the chart.
    const code = boxes.get("calc_line_1")!;
    const bar = boxes.get("bar_1")!;
    expect(code.x + code.w).toBeLessThan(bar.x); // its own area, with room to spare
    expect(l.issues.filter((i) => i.rule === "overlap-code-figure")).toEqual([]);
  });

  test("an author who places both on top of each other is told", () => {
    const l = layoutSpec(spec({ x: 500, width: 880 }, { box: { x: 40, y: 95, w: 900, h: 560 } }), heuristicMeasure);
    const issue = l.issues.find((i) => i.rule === "overlap-code-figure");
    expect(issue).toBeDefined();
    expect(issue!.ids).toContain("calc");
    expect(issue!.severity).toBe("warn");
  });

  test("a code panel erased before the figure is drawn is not an overlap at all", () => {
    const s = spec({ x: 500, width: 880 }, { box: { x: 40, y: 95, w: 900, h: 560 } });
    s.commands = [{ draw: ["calc", "calc_line_1"] }, { erase: ["calc"] }, { draw: ["axes", "bar_1", "bar_2", "bar_3"] }] as never;
    expect(layoutSpec(s, heuristicMeasure).issues.filter((i) => i.rule === "overlap-code-figure")).toEqual([]);
  });

  test("a data-only script leaves the chart the whole canvas", () => {
    const l = layoutSpec(spec({ show: "none" }), heuristicMeasure);
    const bar = elementBBoxes(l, heuristicMeasure).get("bar_3")!;
    expect(bar.x + bar.w).toBeGreaterThan(700); // not squeezed into a half
  });
});
