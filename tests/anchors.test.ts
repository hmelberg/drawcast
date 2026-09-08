import { describe, expect, test } from "vitest";
import { boxAnchor, polygonAnchors, polylineAnchors, ptsBox, sectorAnchors } from "../src/layout/anchors";
import { layoutSpec } from "../src/layout/layout";
import { layoutElements } from "../src/layout/tier2";
import type { Spec, SpecElement } from "../src/spec/types";

const close = (a: [number, number] | undefined, b: [number, number]) => {
  expect(a).toBeDefined();
  expect(a![0]).toBeCloseTo(b[0], 6);
  expect(a![1]).toBeCloseTo(b[1], 6);
};

describe("anchor math", () => {
  test("boxAnchor names the nine points of a box and falls back to center", () => {
    const box = { x: 100, y: 200, w: 40, h: 20 };
    close(boxAnchor(box, "center"), [120, 210]);
    close(boxAnchor(box, "top"), [120, 220]);
    close(boxAnchor(box, "bottom_left"), [100, 200]);
    close(boxAnchor(box, "top_right"), [140, 220]);
    close(boxAnchor(box, "right"), [140, 210]);
    close(boxAnchor(box, "nonsense"), [120, 210]);
  });
  test("polygonAnchors: vertices in order, side midpoints wrapping, centroid", () => {
    const a = polygonAnchors([[0, 0], [4, 0], [4, 4], [0, 4]]);
    close(a.vertex_1, [0, 0]);
    close(a.vertex_3, [4, 4]);
    close(a.side_1, [2, 0]);
    close(a.side_4, [0, 2]); // vertex_4 → vertex_1
    close(a.centroid, [2, 2]);
  });
  test("sectorAnchors: apex, arc midpoint on the rim, the two arc ends", () => {
    const a = sectorAnchors([0, 0], 10, 0, 90);
    close(a.apex, [0, 0]);
    close(a.start, [10, 0]);
    close(a.end, [0, 10]);
    close(a.arc, [Math.SQRT1_2 * 10, Math.SQRT1_2 * 10]);
  });
  test("polylineAnchors: arrow tail/tip, path point_k, arc start/end/mid", () => {
    close(polylineAnchors([[0, 0], [10, 0]], "arrow").tail, [0, 0]);
    close(polylineAnchors([[0, 0], [10, 0]], "arrow").tip, [10, 0]);
    close(polylineAnchors([[0, 0], [5, 5], [10, 0]], "path").point_2, [5, 5]);
    close(polylineAnchors([[0, 0], [5, 5], [10, 0]], "arc").mid, [5, 5]);
    expect(ptsBox([])).toBeNull();
  });
});

describe("layout records named anchors", () => {
  const spec = (elements: unknown[]): Spec => ({ elements, commands: [] }) as unknown as Spec;
  test("polygon, sector, arc, arrow and path each get their geometric anchors; pieces sectors too", () => {
    const out = layoutSpec(spec([
      { id: "tri", type: "polygon", points: [[100, 100], [300, 100], [200, 300]] },
      { id: "sec", type: "sector", x: 500, y: 500, radius: 100, start: 0, end: 90 },
      { id: "bow", type: "arc", x: 700, y: 300, radius: 50, start: 0, end: 180 },
      { id: "arr", type: "arrow", from: { x: 100, y: 600 }, to: { x: 300, y: 600 } },
      { id: "pth", type: "path", points: [[600, 600], [700, 650], [800, 600]] },
      { id: "cake", type: "pieces", of: "sectors", x: 500, y: 200, radius: 80, n: 4 },
    ]));
    close(out.namedAnchors.tri.vertex_3, [200, 300]);
    close(out.namedAnchors.tri.side_1, [200, 100]);
    close(out.namedAnchors.sec.apex, [500, 500]);
    close(out.namedAnchors.sec.end, [500, 600]);
    close(out.namedAnchors.bow.start, [750, 300]);
    close(out.namedAnchors.arr.tail, [100, 600]);
    close(out.namedAnchors.arr.tip, [300, 600]);
    close(out.namedAnchors.pth.point_2, [700, 650]);
    close(out.namedAnchors.cake_1.apex, [500, 200]);
    expect(out.namedAnchors.cake_1.start).toBeDefined();
  });
  test("an arrow endpoint with an anchor lands on the named point at layout time; unknown names warn and use the element's plain anchor, backoff included", () => {
    const els: SpecElement[] = [
      { id: "tri", type: "polygon", points: [[100, 100], [300, 100], [200, 300]] },
      { id: "arr0", type: "arrow", from: { x: 500, y: 500 }, to: { ref: "tri" } },
      { id: "arr", type: "arrow", from: { x: 500, y: 500 }, to: { ref: "tri", anchor: "vertex_3" } },
      { id: "arr2", type: "arrow", from: { x: 500, y: 500 }, to: { ref: "tri", anchor: "top" } },
      { id: "arr3", type: "arrow", from: { x: 500, y: 500 }, to: { ref: "tri", anchor: "nonsense" } },
    ] as SpecElement[];
    const r = layoutElements(els, undefined);
    const tip = (id: string) => (r.drawables.find((d) => d.id === id) as { pts: [number, number][] }).pts.slice(-1)[0];
    close(tip("arr"), [200, 300]);
    close(tip("arr2"), [200, 300]); // top of the triangle's box = its apex row, centred
    expect(r.warnings.join(" ")).toMatch(/nonsense/);
    // An unrecognised anchor name falls all the way back to the plain
    // anchor — same point AND same node-radius backoff as no anchor at all,
    // not the bare unshrunk point a valid anchor gets.
    close(tip("arr3"), tip("arr0"));
  });
  test("a VALID anchor on a node lands exactly on the named point, with no node-radius backoff", () => {
    const els: SpecElement[] = [
      { id: "n1", type: "node", x: 500, y: 400, shape: "circle" },
      { id: "arr4", type: "arrow", from: { x: 100, y: 400 }, to: { ref: "n1", anchor: "right" } },
    ] as SpecElement[];
    const r = layoutElements(els, undefined);
    const tip = (id: string) => (r.drawables.find((d) => d.id === id) as { pts: [number, number][] }).pts.slice(-1)[0];
    const nodeRadius = 44; // default circle node radius with no text: max(44, 0/2 + 14)
    close(tip("arr4"), [500 + nodeRadius, 400]);
  });
});
