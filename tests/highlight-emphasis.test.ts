// setHighlight paints ONE FRAME at a given intensity. The shape over time —
// three swells then a hold — belongs to src/render/emphasis.ts and the player
// that samples it; the backend only says what a level looks like.
//
// It used to take a cycle phase instead, which is why the element was never
// plainly on (0.7 for an instant mid-swell) and why the effect could only
// stop at a cycle boundary.

import { describe, expect, test } from "vitest";
import { rendererFor } from "../src/render/svg-backend";
import { layoutSpec } from "../src/layout/layout";
import { heuristicMeasure } from "../src/layout/measure";
import { installMiniDom, FakeNode } from "./helpers/mini-dom";

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

describe("setHighlight paints a level, not a cycle phase", () => {
  test("at the hold the echo is the element's full colour, not a tint", async () => {
    const { restore, container, effects } = await mounted();
    try {
      effects.setHighlight(["curve"], "glow", 1, null);
      expect(echoes(container).length).toBeGreaterThan(0);
      for (const n of echoes(container)) expect(Number(n.style.opacity)).toBe(1);
    } finally {
      restore();
    }
  });

  test("a level halfway through the first swell shows the echo half-strength", async () => {
    const { restore, container, effects } = await mounted();
    try {
      effects.setHighlight(["curve"], "glow", 0.5, null);
      expect(echoes(container).length).toBeGreaterThan(0);
      for (const n of echoes(container)) expect(Number(n.style.opacity)).toBeCloseTo(0.5, 3);
    } finally {
      restore();
    }
  });

  test("level 0 leaves the echo mounted — only endHighlight takes it away", async () => {
    const { restore, container, effects } = await mounted();
    try {
      effects.setHighlight(["curve"], "glow", 0, null);
      expect(echoes(container).length).toBeGreaterThan(0);
      effects.setHighlight(["curve"], "glow", 1, null);
      expect(echoes(container).length).toBeGreaterThan(0);
      effects.endHighlight(["curve"]);
      expect(echoes(container).length).toBe(0);
    } finally {
      restore();
    }
  });

  test("glow carries a two-layer halo so a thin stroke reads as lit; pulse is the bare echo", async () => {
    const { restore, container, effects } = await mounted();
    try {
      effects.setHighlight(["curve"], "glow", 1, null);
      const lit = echoes(container).map((n) => n.style.filter ?? "");
      expect(lit.length).toBeGreaterThan(0);
      expect(lit.every((f) => f.split("drop-shadow").length - 1 === 2)).toBe(true);
      effects.endHighlight(["curve"]);
      effects.setHighlight(["curve"], "pulse", 1, null);
      expect(echoes(container).length).toBeGreaterThan(0);
      for (const n of echoes(container)) expect(n.style.filter ?? "").toBe("");
    } finally {
      restore();
    }
  });

  test("the echo takes the colour it is given", async () => {
    const { restore, container, effects } = await mounted();
    try {
      effects.setHighlight(["curve"], "glow", 1, null, "#4a7c59");
      const strokes = echoes(container).flatMap((n) => n.querySelectorAll("path").map((p) => p.getAttribute("stroke")));
      expect(strokes.length).toBeGreaterThan(0);
      for (const s of strokes) expect(s).toBe("#4a7c59");
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
        r.effects!.setHighlight(["curve"], effect, 1, null);
        const shown = echoes(container);
        expect(shown.length).toBeGreaterThan(0);
        for (const n of shown) expect(composited(n)).toBeCloseTo(1, 6);
        // …while the element's own ink really is faded.
        const own: FakeNode[] = [];
        const walk = (n: FakeNode) => {
          if (n.dataset.leafId === "curve" && !shown.some((e) => e === n)) own.push(n);
          n.children.forEach(walk);
        };
        const svg = container.children[0];
        svg.children.slice(0, -1).forEach(walk);
        expect(own.length).toBeGreaterThan(0);
        expect(composited(own[0])).toBeCloseTo(0.25, 6);
      } finally {
        restore();
      }
    });
  }
});
