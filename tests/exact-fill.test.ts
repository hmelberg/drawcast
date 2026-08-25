// Exact filled areas: the one drawable that is painted identically in BOTH
// render styles — a single <path> with fill-rule evenodd, no roughening and no
// hachure. Letterforms live here: a rough.js hachure fill (gap 5.5, weight 1.7)
// across a 54 px glyph stem is the "grainy" look this replaces, and a ring
// filled without its counters paints the hole in a "b" shut.
//
// Pure attribute/path building only — the vitest environment is node, so DOM
// assembly is exercised by the visual gate, not here.

import { describe, expect, test } from "vitest";
import { areaPathData, exactAreaAttrs, isExactArea } from "../src/render/svg-backend";
import { defaultDrawOpts, defaultStyle, Z_AREA, type AreaDrawable, type Pt } from "../src/layout/model";

const square = (x: number, y: number, s: number): Pt[] => [[x, y], [x + s, y], [x + s, y + s], [x, y + s]];

function area(o: Partial<AreaDrawable> = {}): AreaDrawable {
  return {
    id: "a",
    kind: "area",
    pts: square(0, 0, 100),
    z: Z_AREA,
    style: defaultStyle({ fill: "#3d3833", opacity: 1, strokeWidth: 0 }),
    drawOpts: defaultDrawOpts(),
    ...o,
  };
}

describe("isExactArea", () => {
  test("a plain shaded region is not exact — it keeps the hand-drawn hachure", () => {
    expect(isExactArea(area())).toBe(false);
    expect(isExactArea(area({ holes: [] }))).toBe(false);
  });

  test("precise, or any hole, makes it exact", () => {
    expect(isExactArea(area({ precise: true }))).toBe(true);
    expect(isExactArea(area({ holes: [square(20, 20, 20)] }))).toBe(true);
  });
});

describe("areaPathData", () => {
  test("no holes: one closed subpath, y-flipped to SVG space", () => {
    const d = areaPathData(area({ pts: [[0, 0], [10, 0], [10, 10]] }));
    expect(d).toBe("M0.0 750.0 L10.0 750.0 L10.0 740.0 Z");
  });

  test("each hole becomes its own closed subpath of the SAME path", () => {
    const d = areaPathData(area({ pts: square(0, 0, 100), holes: [square(20, 20, 20), square(60, 60, 20)] }));
    expect(d.match(/M/g)).toHaveLength(3);
    expect(d.match(/Z/g)).toHaveLength(3);
    // The counters are inside the outer ring's SVG-space extent.
    expect(d).toContain("M20.0 730.0");
    expect(d).toContain("M60.0 690.0");
  });

  test("a degenerate hole (fewer than 3 points) is dropped, not emitted as a stray stub", () => {
    const d = areaPathData(area({ holes: [[[1, 1], [2, 2]]] }));
    expect(d.match(/M/g)).toHaveLength(1);
  });
});

describe("exactAreaAttrs", () => {
  test("evenodd fill, no stroke, full-strength paint — the crisp treatment text gets", () => {
    const a = exactAreaAttrs(area({ holes: [square(20, 20, 20)] }));
    expect(a["fill-rule"]).toBe("evenodd");
    expect(a.fill).toBe("#3d3833");
    expect(a.stroke).toBe("none");
    // No fill-opacity knock-down at all: a softened fill (the shaded-region
    // look) is what made equations read as washed out in the clean style.
    expect(a["fill-opacity"]).toBeUndefined();
    expect(a.d).toBe(areaPathData(area({ holes: [square(20, 20, 20)] })));
  });

  test("the drawable's own opacity still applies, and only when below 1", () => {
    expect(exactAreaAttrs(area({ precise: true })).opacity).toBeUndefined();
    const faded = area({ precise: true, style: defaultStyle({ fill: "#000", opacity: 0.5, strokeWidth: 0 }) });
    expect(exactAreaAttrs(faded).opacity).toBe("0.5");
  });

  test("falls back to the stroke color when no fill is set", () => {
    const noFill = area({ precise: true, style: defaultStyle({ color: "#123456", opacity: 1, strokeWidth: 0 }) });
    expect(exactAreaAttrs(noFill).fill).toBe("#123456");
  });
});
