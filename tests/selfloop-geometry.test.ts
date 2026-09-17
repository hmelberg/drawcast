// Arrow round (Hans 2026-09-17): a self-loop on a WIDE ellipse used to open
// its mouth at ±0.8 rad in direction space, which on a 78×44 node put the
// two anchors 100+ units apart for a 48-unit loop — the teardrop's neck was
// wider than the loop, and the curve swung back through the node. The
// mouth now spans about the loop's own width, whatever the node's shape.
import { describe, expect, test } from "vitest";
import { kit } from "../src/scenes/kit";
import type { Pt, StrokeDrawable } from "../src/layout/model";

const C: Pt = [500, 400];
const RX = 85;
const RY = 45;
const norm = (p: Pt): number => Math.hypot((p[0] - C[0]) / RX, (p[1] - C[1]) / RY);
const loop = (dir: Pt): Pt[] => (kit.edgeArrow("l", C, C, { selfLoop: true, loopDir: dir, shorten: { ellipse: [RX, RY] } }).drawables[0] as StrokeDrawable).pts;

describe("self-loop geometry on a wide ellipse", () => {
  for (const dir of [[-0.7, -0.7], [1, 0], [0, -1], [0.7, 0.7]] as Pt[]) {
    test(`loopDir ${JSON.stringify(dir)}: no sample enters the node, the mouth is narrow, both ends sit on the boundary`, () => {
      const pts = loop(dir);
      for (const p of pts) expect(norm(p)).toBeGreaterThanOrEqual(0.97);
      const first = pts[0];
      const last = pts[pts.length - 1];
      expect(norm(first)).toBeLessThanOrEqual(1.2);
      expect(norm(last)).toBeLessThanOrEqual(1.2);
      const mouth = Math.hypot(last[0] - first[0], last[1] - first[1]);
      const apex = pts.reduce((b, p) => (Math.hypot(p[0] - C[0], p[1] - C[1]) > Math.hypot(b[0] - C[0], b[1] - C[1]) ? p : b));
      const extent = Math.hypot(apex[0] - C[0], apex[1] - C[1]) - Math.hypot(first[0] - C[0], first[1] - C[1]);
      // The mouth is no wider than the loop reaches out.
      expect(mouth).toBeLessThanOrEqual(extent * 1.2);
      expect(mouth).toBeGreaterThan(10);
    });
  }
  test("the arrowhead re-enters the node", () => {
    const pts = loop([-0.7, -0.7]);
    const tip = pts[pts.length - 1];
    const prev = pts[pts.length - 3];
    const dir: Pt = [tip[0] - prev[0], tip[1] - prev[1]];
    const inward: Pt = [C[0] - tip[0], C[1] - tip[1]];
    expect(dir[0] * inward[0] + dir[1] * inward[1]).toBeGreaterThan(0);
  });
});
