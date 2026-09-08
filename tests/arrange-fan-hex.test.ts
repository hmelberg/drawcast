// The fan and hex layouts of `arrange`, standalone sectors as pieces, the
// pieces-id expansion in `point`/`camera`, the sub-suffix id collision, and
// point/camera refs reaching the subtitle track.
import { describe, expect, test } from "vitest";
import { arrangeTargets } from "../src/render/arrange";
import { elementBBoxes, layoutSpec } from "../src/layout/layout";
import { planCommands, type PlanStep } from "../src/render/plan";
import { poseOf } from "../src/render/pose";
import { validateSpec } from "../src/spec/schema";
import { captionLines } from "../src/llm/subtitles";
import type { Spec } from "../src/spec/types";

type P = [number, number];
const box = (x: number, y: number, w = 40, h = 20) => ({ x, y, w, h });
const item = (id: string, x: number, y: number, w = 40, h = 20) => ({ id, box: box(x, y, w, h), centre: [x + w / 2, y + h / 2] as P, pose: { offset: [0, 0] as P, turn: undefined } });
const sector = (id: string, apex: P, start: number, end: number, r = 50) => ({
  id, box: box(apex[0], apex[1], r, r), centre: apex, pose: { offset: [0, 0] as P, turn: undefined },
  piece: { apex, centroid: apex, midAngle: (start + end) / 2, halfAngle: (end - start) / 2, radius: r },
});

describe("fan", () => {
  test("sectors abut about one apex, the first beginning at `start`, in target order", () => {
    // The angle-sum proof's three corners: 59.04°, 45°, 75.96°.
    const out = arrangeTargets([sector("va", [300, 250], 0, 59.04), sector("vb", [700, 250], 135, 180), sector("vc", [450, 500], 239.04, 315)], "fan", { at: [500, 600], gap: 0, start: 0 });
    expect(out.map((o) => o.apexTo)).toEqual([[500, 600], [500, 600], [500, 600]]);
    expect(out.map((o) => o.pivotNow)).toEqual([[300, 250], [700, 250], [450, 500]]);
    // mid-directions after the turn: 29.52, 59.04 + 22.5, 104.04 + 37.98
    expect(29.52 + out[0].rotate!).toBeCloseTo(29.52, 6);
    expect(157.5 + out[1].rotate!).toBeCloseTo(81.54, 6);
    expect(277.02 + out[2].rotate!).toBeCloseTo(142.02, 6);
    // every turn is the short way round
    for (const o of out) expect(Math.abs(o.rotate!)).toBeLessThanOrEqual(180);
  });
  test("with no `at`, the first sector's current apex is the shared apex", () => {
    const out = arrangeTargets([sector("a", [100, 100], 0, 30), sector("b", [400, 400], 0, 30)], "fan", { gap: 0 });
    expect(out[0].apexTo).toEqual([100, 100]);
    expect(out[1].apexTo).toEqual([100, 100]);
    expect(out[1].rotate).toBeCloseTo(30, 6);
  });
  test("a non-sector target in a fan goes to a row on the far side of the apex from the fan", () => {
    // The fan spans 0°–30° (bisector 15°), so the row sits below-left of the apex.
    const out = arrangeTargets([sector("a", [100, 100], 0, 30), item("t", 0, 0)], "fan", { at: [500, 500], gap: 0 });
    expect(out[1].centre).toBeDefined();
    expect(out[1].centre![1]).toBeLessThan(500);
    expect(out[1].centre![0]).toBeLessThan(500);
  });
  test("a sector already moved and turned by an earlier move still lands right, and is the default apex", () => {
    // Original apex (100,100); the pose puts it at (300,100) turned 90°: its mid-direction is now 15° + 90°.
    const moved = { ...sector("a", [100, 100], 0, 30), pose: { offset: [200, 0] as P, turn: { deg: 90, pivot: [100, 100] as P } } };
    const out = arrangeTargets([moved, sector("b", [700, 700], 40, 100)], "fan", { gap: 0, start: 0 });
    expect(out[0].apexTo).toEqual([300, 100]);
    expect(out[0].rotate).toBeCloseTo(-90, 6); // back to mid 15°
    expect(out[1].apexTo).toEqual([300, 100]);
    expect(out[1].rotate).toBeCloseTo(30 + 30 - 70, 6); // mid 70° → 60°
  });
  test("a sector written end-before-start keeps a positive half-span", () => {
    const layout = layoutSpec({ elements: [{ id: "s", type: "sector", x: 100, y: 100, radius: 50, start: 90, end: 30 }] } as unknown as Spec);
    expect(layout.pieces.s.halfAngle).toBe(30);
  });
});

describe("hex", () => {
  test("seven pointy-topped hexagons: one at `at`, six at one flat-to-flat distance at 60° steps", () => {
    const items = Array.from({ length: 7 }, (_, k) => item(`h${k}`, 0, 0, 104, 120));
    const out = arrangeTargets(items, "hex", { at: [500, 400], gap: 0 });
    expect(out[0].centre).toEqual([500, 400]);
    for (let k = 1; k <= 6; k++) {
      const c = out[k].centre!;
      expect(Math.hypot(c[0] - 500, c[1] - 400)).toBeCloseTo(104, 6);
      const ang = ((Math.atan2(c[1] - 400, c[0] - 500) * 180) / Math.PI + 360) % 360;
      const rem = ((ang % 60) + 60) % 60;
      expect(Math.min(rem, 60 - rem)).toBeCloseTo(0, 6);
    }
  });
  test("flat-topped hexagons take the 30°-offset lattice, and the second ring holds twelve", () => {
    const items = Array.from({ length: 19 }, (_, k) => item(`h${k}`, 0, 0, 120, 104));
    const out = arrangeTargets(items, "hex", { at: [0, 0], gap: 0 });
    // Slots are handed out by nearness, so look at the SET of positions: one centre,
    // six at one flat-to-flat distance on the 30° lattice, twelve on the second ring.
    const dists = out.slice(1).map((o) => Math.hypot(o.centre![0], o.centre![1])).sort((a, b) => a - b);
    expect(out[0].centre).toEqual([0, 0]);
    for (const d of dists.slice(0, 6)) expect(d).toBeCloseTo(104, 6);
    const ring1 = out.slice(1).filter((o) => Math.abs(Math.hypot(o.centre![0], o.centre![1]) - 104) < 1e-6);
    for (const o of ring1) expect(((Math.atan2(o.centre![1], o.centre![0]) * 180) / Math.PI + 360) % 60).toBeCloseTo(30, 6);
    const ring2 = dists.slice(6);
    expect(ring2).toHaveLength(12);
    // a corner cell of ring 2 sits at twice the distance; an edge cell at √3 times
    expect(Math.max(...ring2)).toBeCloseTo(208, 6);
    expect(Math.min(...ring2)).toBeCloseTo(104 * Math.sqrt(3), 6);
  });
});

describe("standalone sectors are pieces", () => {
  const spec = {
    elements: [
      { id: "va", type: "sector", x: 300, y: 250, radius: 50, start: 0, end: 59.04, style: { fill: "#fc4" } },
      { id: "vb", type: "sector", x: 700, y: 250, radius: 50, start: 135, end: 180, style: { fill: "#fc4" } },
      { id: "vc", type: "sector", x: 450, y: 500, radius: 50, start: 239.04, end: 315, style: { fill: "#fc4" } },
    ],
  } as unknown as Spec;
  test("the layout records apex and angles for a sector element", () => {
    const layout = layoutSpec(spec);
    expect(layout.pieces.vb).toEqual({ apex: [700, 250], centroid: expect.any(Array), midAngle: 157.5, halfAngle: 22.5, radius: 50 });
  });
  test("end to end: fan sets the three corners on a half turn at the apex", () => {
    const layout = layoutSpec(spec);
    const bboxes = elementBBoxes(layout);
    const plan = planCommands([{ draw: ["va", "vb", "vc"] }, { arrange: { target: ["va", "vb", "vc"], layout: "fan", at: [500, 600] } }], layout.order, {
      bboxOf: (id) => bboxes.get(id) ?? null,
      pieceOf: (id) => layout.pieces[id] ?? null,
    });
    const step = plan.steps[1] as Extract<PlanStep, { kind: "transform" }>;
    expect(step.items.map((i) => i.id)).toEqual(["va", "vb", "vc"]);
    let angle = 0;
    for (const it of step.items) {
      const g = layout.pieces[it.id];
      const apex = poseOf(it.to.offset, it.to.turn)(g.apex);
      expect(apex[0]).toBeCloseTo(500, 6);
      expect(apex[1]).toBeCloseTo(600, 6);
      const mid = (((g.midAngle + it.to.turn.deg) % 360) + 360) % 360;
      expect(mid).toBeCloseTo(angle + g.halfAngle, 6);
      angle += 2 * g.halfAngle;
    }
    expect(angle).toBeCloseTo(180, 6);
  });
});

describe("a pieces id in point and camera", () => {
  const pieces = ["k_1", "k_2"];
  const opts = {
    bboxOf: (id: string) => (id === "k_1" ? { x: 100, y: 100, w: 100, h: 100 } : id === "k_2" ? { x: 300, y: 300, w: 100, h: 100 } : null),
    expandId: (id: string) => (id === "k" ? pieces : null),
  };
  test("point.at.ref names the whole group", () => {
    const plan = planCommands([{ draw: ["k"] }, { point: { at: { ref: "k" } } }], pieces, opts);
    const step = plan.steps[1] as Extract<PlanStep, { kind: "point" }>;
    expect(step.kind).toBe("point");
    expect(plan.warnings).toEqual([]);
    expect(step.x).toBeCloseTo(250, 6);
    expect(step.y).toBeCloseTo(250, 6);
  });
  test("camera.center.ref centres on the group", () => {
    const plan = planCommands([{ draw: ["k"] }, { camera: { center: { ref: "k" }, zoom: 2 } }], pieces, opts);
    const cam = plan.states[1].camera!;
    expect(plan.warnings).toEqual([]);
    expect(cam.x + cam.w / 2).toBeCloseTo(250, 6);
    expect(cam.y + cam.h / 2).toBeCloseTo(250, 6);
  });
});

describe("sub-suffix id collisions", () => {
  const base = (elements: unknown[]) => ({ elements, commands: [{ draw: (elements as { id: string }[]).map((e) => e.id) }] });
  test("an element whose id reads as another's sub-drawable is rejected", () => {
    const v = validateSpec(base([{ id: "sky", type: "text", text: "a", x: 1, y: 1 }, { id: "sky_wash", type: "text", text: "b", x: 1, y: 40 }]));
    expect(v.ok).toBe(false);
    expect(v.errors.join(" ")).toMatch(/"sky" and "sky_wash" collide/);
  });
  test("the suffix alone is a fine id", () => {
    expect(validateSpec(base([{ id: "sky_wash", type: "text", text: "b", x: 1, y: 40 }])).ok).toBe(true);
  });
});

describe("subtitles for point and camera beats", () => {
  test("a speak paired with a point.at.ref or camera.center.ref reaches the caption track", () => {
    // No draw beat names "a": only the point/camera refs can put it in the known set.
    const spec = {
      elements: [{ id: "a", type: "text", text: "A", x: 100, y: 100 }],
      commands: [{ point: { at: { ref: "a" } }, speak: "P" }, { camera: { center: { ref: "a" }, zoom: 2 }, speak: "C" }],
    } as unknown as Spec;
    const lines = captionLines(spec);
    expect(lines).toContain("P");
    expect(lines).toContain("C");
  });
});
