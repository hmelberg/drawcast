// setHighlight paints ONE FRAME at a given intensity. The shape over time —
// an ease-in (or pulse's three swells) then a hold — belongs to
// src/render/emphasis.ts and the player that samples it; the backend only
// says what a level looks like.
//
// It used to take a cycle phase instead, which is why the element was never
// plainly on (0.7 for an instant mid-swell) and why the effect could only
// stop at a cycle boundary.
//
// glow is a highlighter, not a light (2026-09-24): a band UNDER a line, a
// marker behind a code row, the ink recoloured on everything else — and no
// drop-shadow halo anywhere.

import { describe, expect, test } from "vitest";
import { emphasisColorFor, glowKindOf, rendererFor } from "../src/render/svg-backend";
import { layoutSpec } from "../src/layout/layout";
import { heuristicMeasure } from "../src/layout/measure";
import { installMiniDom, FakeNode } from "./helpers/mini-dom";
import { COLORS } from "../src/layout/model";
import { readsAsSame } from "../src/layout/ink";
import { EMPHASIS_WRITE_MS } from "../src/render/emphasis";

const SPEC = {
  elements: [
    { id: "h", type: "node", shape: "rect", text: "Households", x: 200, y: 375 },
    { id: "f", type: "node", shape: "rect", text: "Firms", x: 800, y: 375 },
    { id: "curve", type: "arrow", from: { ref: "f" }, to: { ref: "h" }, curved: true },
  ],
  commands: [{ draw: ["h", "f", "curve"] }],
};

async function mounted(style: "clean" | "sketchy" = "clean") {
  const { restore, doc } = installMiniDom();
  const layout = layoutSpec(SPEC as never, heuristicMeasure);
  const container = new FakeNode("div", doc as never);
  const r = await rendererFor(style).mount(layout, SPEC as never, container as never);
  for (const el of r.elements.values()) el.finish();
  return { restore, container, effects: r.effects! };
}

/** The emphasis echoes live on the overlay, which is the last child of the root svg. */
function echoes(container: FakeNode): FakeNode[] {
  const svg = container.children[0];
  const overlay = svg.children[svg.children.length - 1];
  return overlay.children;
}

/** glow's pens (bands, markers) live on the underlay — under the ink, over the area layer. */
function pens(container: FakeNode): FakeNode[] {
  const svg = container.children[0];
  const under = svg.children.find((c) => c.getAttribute("class") === "cs-underlay");
  expect(under).toBeDefined();
  return under!.children;
}

describe("setHighlight paints a level, not a cycle phase", () => {
  test("at the hold the echo is the element's full colour, not a tint", async () => {
    const { restore, container, effects } = await mounted();
    try {
      effects.setHighlight(["curve"], "pulse", 1, null);
      expect(echoes(container).length).toBeGreaterThan(0);
      for (const n of echoes(container)) expect(Number(n.style.opacity)).toBe(1);
    } finally {
      restore();
    }
  });

  test("a level halfway through the first swell shows the echo half-strength", async () => {
    const { restore, container, effects } = await mounted();
    try {
      effects.setHighlight(["curve"], "pulse", 0.5, null);
      expect(echoes(container).length).toBeGreaterThan(0);
      for (const n of echoes(container)) expect(Number(n.style.opacity)).toBeCloseTo(0.5, 3);
    } finally {
      restore();
    }
  });

  test("level 0 leaves the emphasis mounted — only endHighlight takes it away", async () => {
    const { restore, container, effects } = await mounted();
    try {
      effects.setHighlight(["curve"], "glow", 0, null, undefined, 0);
      expect(pens(container).length).toBeGreaterThan(0);
      effects.setHighlight(["curve"], "glow", 1, null, undefined, 300);
      expect(pens(container).length).toBeGreaterThan(0);
      effects.endHighlight(["curve"]);
      expect(pens(container).length).toBe(0);
    } finally {
      restore();
    }
  });

  test("no effect carries a drop-shadow halo — the neon is gone", async () => {
    const { restore, container, effects } = await mounted();
    try {
      for (const effect of ["glow", "pulse"] as const) {
        effects.setHighlight(["curve", "h"], effect, 1, null, undefined, 1000);
        for (const n of [...echoes(container), ...pens(container)]) expect(n.style.filter ?? "").toBe("");
        effects.endHighlight(["curve", "h"]);
      }
    } finally {
      restore();
    }
  });

  test("the echo takes the colour it is given", async () => {
    const { restore, container, effects } = await mounted();
    try {
      effects.setHighlight(["curve"], "pulse", 1, null, "#4a7c59");
      const strokes = echoes(container).flatMap((n) => n.querySelectorAll("path").map((p) => p.getAttribute("stroke")));
      expect(strokes.length).toBeGreaterThan(0);
      for (const s of strokes) expect(s).toBe("#4a7c59");
    } finally {
      restore();
    }
  });
});

describe("glow suits what it lights", () => {
  test("a line gets a yellow band laid UNDER its ink, and the line itself is untouched", async () => {
    const { restore, container, effects } = await mounted();
    try {
      effects.setHighlight(["curve"], "glow", 1, null, undefined, 1000);
      expect(echoes(container)).toHaveLength(0);
      const bands = pens(container);
      expect(bands.length).toBeGreaterThan(0);
      for (const b of bands) {
        expect(b.getAttribute("stroke")).toBe(COLORS.region1);
        expect(Number(b.getAttribute("stroke-width"))).toBeGreaterThanOrEqual(16);
        expect(b.getAttribute("stroke-linecap")).toBe("round");
      }
    } finally {
      restore();
    }
  });

  test("the band is WRITTEN on by the clock and never unwrites; the release only fades it", async () => {
    const { restore, container, effects } = await mounted();
    try {
      effects.setHighlight(["curve"], "glow", 1, null, undefined, 0);
      const band = pens(container)[0];
      const len = Number(band.style.strokeDasharray);
      expect(Number(band.style.strokeDashoffset)).toBeCloseTo(len, 3);
      effects.setHighlight(["curve"], "glow", 1, null, undefined, EMPHASIS_WRITE_MS);
      expect(Number(band.style.strokeDashoffset)).toBeCloseTo(0, 3);
      effects.setHighlight(["curve"], "glow", 0.4, null); // the release: no clock
      expect(Number(band.style.strokeDashoffset)).toBeCloseTo(0, 3);
      expect(Number(band.style.opacity)).toBeCloseTo(0.4, 3);
    } finally {
      restore();
    }
  });

  test("a colour the caller chose (the answer green) paints the band, lighter than the yellow", async () => {
    const { restore, container, effects } = await mounted();
    try {
      effects.setHighlight(["curve"], "glow", 1, null, "#4a7c59", 1000);
      for (const b of pens(container)) {
        expect(b.getAttribute("stroke")).toBe("#4a7c59");
        expect(Number(b.getAttribute("stroke-opacity"))).toBeLessThan(0.5);
      }
    } finally {
      restore();
    }
  });

  test("text gets its ink recoloured, with no paper halo on the echo", async () => {
    const { restore, container, effects } = await mounted();
    try {
      effects.setHighlight(["h"], "glow", 1, null, undefined, 1000);
      const texts = echoes(container).flatMap((n) => n.querySelectorAll("text"));
      expect(texts.length).toBeGreaterThan(0);
      for (const t of texts) {
        expect(t.getAttribute("fill")).toBe("#cf4632");
        expect(t.getAttribute("stroke")).toBeNull();
      }
    } finally {
      restore();
    }
  });
});

describe("the emphasis colour steps aside when it would read as the target's own ink", () => {
  test("the default red on a red element switches; anything else stays", () => {
    expect(emphasisColorFor("#cf4632", COLORS.demand, false)).not.toBe("#cf4632");
    expect(readsAsSame(emphasisColorFor("#cf4632", COLORS.demand, false), COLORS.demand)).toBe(false);
    expect(emphasisColorFor("#cf4632", COLORS.supply, false)).toBe("#cf4632");
    expect(emphasisColorFor(COLORS.region1, COLORS.region1, false)).not.toBe(COLORS.region1);
  });

  test("a colour the spec asked for is kept as asked", () => {
    expect(emphasisColorFor("#b5482e", COLORS.demand, true)).toBe("#b5482e");
  });

  test("glow picks by leaf: band for a line, marker for a code row, tint for the rest", () => {
    const style = { color: COLORS.ink, strokeWidth: 2, opacity: 1, roughness: 1 } as never;
    const draw = { mode: "sketch", duration: 500 } as never;
    expect(glowKindOf({ id: "a", kind: "stroke", pts: [[0, 0], [10, 0]], z: 1, style, drawOpts: draw })).toBe("band");
    expect(glowKindOf({ id: "b", kind: "text", pos: [0, 0], text: "x = 1", fontSize: 17, anchor: "start", font: "mono", z: 2, style, drawOpts: draw })).toBe("marker");
    expect(glowKindOf({ id: "c", kind: "text", pos: [0, 0], text: "label", fontSize: 17, anchor: "start", z: 2, style, drawOpts: draw })).toBe("tint");
    expect(glowKindOf({ id: "d", kind: "area", pts: [[0, 0], [1, 0], [1, 1]], z: 0, style, drawOpts: draw })).toBe("tint");
  });

  test("glow frames a filled shape instead of washing it red: a shaded ball, a bar's outline beside its fill", () => {
    const style = { color: COLORS.ink, strokeWidth: 2, opacity: 1, roughness: 1 } as never;
    const filled = { color: COLORS.ink, strokeWidth: 3, opacity: 1, roughness: 1, fill: "#777" } as never;
    const draw = { mode: "sketch", duration: 500 } as never;
    const ball = { id: "atom_0", kind: "stroke", pts: [[50, 50]], shapeHint: { type: "circle", c: [50, 50], r: 20 }, z: 1, style: filled, drawOpts: draw } as const;
    expect(glowKindOf(ball as never)).toBe("frame");
    const outline = { id: "bar__o0", kind: "stroke", pts: [[0, 0], [10, 0], [10, 20], [0, 20]], closed: true, z: 1, style, drawOpts: draw } as const;
    expect(glowKindOf(outline as never, true)).toBe("frame"); // the target also holds the bar's fill
    expect(glowKindOf(outline as never, false)).toBe("band"); // an empty box keeps the band along its line
  });
});

describe("glow on a line of code", () => {
  const CODE_SPEC = {
    elements: [{ id: "sim", type: "code", language: "python", show: "code", code: "import numpy as np\nrng = np.random.default_rng(7)", x: 500, y: 375, width: 700 }],
    commands: [{ draw: ["sim"] }],
  };

  test("a marker box lies behind the row, and the yellow number on it is re-inked", async () => {
    const { restore, doc } = installMiniDom();
    try {
      const layout = layoutSpec(CODE_SPEC as never, heuristicMeasure);
      const container = new FakeNode("div", doc as never);
      const r = await rendererFor("sketchy").mount(layout, CODE_SPEC as never, container as never);
      for (const el of r.elements.values()) el.finish();
      r.effects!.setHighlight(["sim_line_2"], "glow", 1, null, undefined, 1000);
      const marker = pens(container);
      expect(marker).toHaveLength(1);
      expect(marker[0].getAttribute("stroke")).toBe(COLORS.region1);
      expect(marker[0].getAttribute("stroke-linecap")).toBe("round");
      // The number "7" is COLORS.region1 in the row; on the echo it is ink.
      const spans = echoes(container).flatMap((n) => n.querySelectorAll("tspan"));
      const seven = spans.find((t) => t.textContent === "7");
      expect(seven?.getAttribute("fill")).toBe(COLORS.ink);
    } finally {
      restore();
    }
  });
});

describe("a filled area stays see-through even at full strength", () => {
  // Strokes and letters can be replaced outright by the echo — there is
  // nothing behind them. A shaded area is different: at full opacity it would
  // paint over whatever it contains (the labels inside a region, the curve
  // through a sector) for the length of the sentence.
  const AREA_SPEC = {
    template: "supply_demand",
    params: { regions: ["consumer_surplus"] },
    commands: [{ draw: ["axes", "demand_curve", "supply_curve", "cs_region"] }],
  };

  test("the echo tints the fill rather than replacing it, while its stroke goes full", async () => {
    const { restore, doc } = installMiniDom();
    try {
      const layout = layoutSpec(AREA_SPEC as never, heuristicMeasure);
      const container = new FakeNode("div", doc as never);
      const r = await rendererFor("clean").mount(layout, AREA_SPEC as never, container as never);
      for (const el of r.elements.values()) el.finish();
      r.effects!.setHighlight(["cs_region"], "glow", 1, null);
      const filled = echoes(container)
        .flatMap((n) => n.querySelectorAll("path"))
        .filter((p) => (p.getAttribute("fill") ?? "none") !== "none");
      expect(filled.length).toBeGreaterThan(0);
      for (const p of filled) {
        expect(p.getAttribute("fill")).toBe("#cf4632");
        const fo = p.getAttribute("fill-opacity");
        expect(fo).not.toBeNull(); // absent reads as Number(null) === 0 — a pass that proves nothing
        expect(Number(fo)).toBeGreaterThan(0.2);
        expect(Number(fo)).toBeLessThan(0.6);
        expect(p.getAttribute("stroke")).toBe("#cf4632");
      }
    } finally {
      restore();
    }
  });
});

describe("the hand-drawn ring follows the same level", () => {
  const BOX = { x: 100, y: 100, w: 200, h: 80 };

  test("the ring draws on as the level rises and never un-draws when it dips", async () => {
    const { restore, container, effects } = await mounted("sketchy");
    try {
      effects.setHighlight(["curve"], "circle", 1, BOX);
      const ring = echoes(container)[0];
      const paths = ring.querySelectorAll("path");
      const offsetAfterFirstPeak = paths.map((p) => Number(p.style.strokeDashoffset));
      for (const o of offsetAfterFirstPeak) expect(o).toBeCloseTo(0, 3); // fully drawn
      effects.setHighlight(["curve"], "circle", 1 / 3, BOX); // the trough between throbs
      for (const p of paths) expect(Number(p.style.strokeDashoffset)).toBeCloseTo(0, 3);
      expect(Number(ring.style.opacity)).toBeCloseTo(1 / 3, 3);
    } finally {
      restore();
    }
  });
});

// A list walked one item at a time fades each finished item to ~0.3 (the
// compiler prompt's walk rule). A later highlight on a faded item must still
// land at full strength: the echo lives on the overlay, outside the fade
// wrapper the item's own ink sits under, so the fade never reaches it.
describe("a highlight on faded ink", () => {
  /** The product of every opacity from `n` up to the root — what SVG composites. */
  const composited = (n: FakeNode): number => {
    let acc = 1;
    for (let p: FakeNode | null = n; p; p = p.parentNode) {
      const v = p.style.opacity ?? p.getAttribute("opacity");
      if (v !== null && v !== undefined && v !== "" && Number.isFinite(Number(v))) acc *= Number(v);
    }
    return acc;
  };

  for (const effect of ["glow", "pulse"] as const) {
    test(`a ${effect} on an element faded to 0.25 shows at full strength`, async () => {
      const { restore, doc } = installMiniDom();
      try {
        const layout = layoutSpec(SPEC as never, heuristicMeasure);
        const container = new FakeNode("div", doc as never);
        const r = await rendererFor("clean").mount(layout, SPEC as never, container as never);
        for (const el of r.elements.values()) el.finish();
        r.elements.get("curve")!.setOpacity!(0.25);
        r.effects!.setHighlight(["curve"], effect, 1, null, undefined, 1000);
        const shown = effect === "glow" ? pens(container) : echoes(container);
        expect(shown.length).toBeGreaterThan(0);
        for (const n of shown) expect(composited(n)).toBeCloseTo(1, 6);
        // …while the element's own ink really is faded.
        const own: FakeNode[] = [];
        const walk = (n: FakeNode) => {
          if (n.dataset.leafId === "curve" && !shown.some((e) => e === n)) own.push(n);
          n.children.forEach(walk);
        };
        const svg = container.children[0];
        svg.children.slice(0, -1).filter((c) => c.getAttribute("class") !== "cs-underlay").forEach(walk);
        expect(own.length).toBeGreaterThan(0);
        expect(composited(own[0])).toBeCloseTo(0.25, 6);
      } finally {
        restore();
      }
    });
  }
});
