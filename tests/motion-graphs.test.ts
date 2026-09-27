// motion_graphs (2026-09-28): x(t), v(t), a(t) stacked on one time axis,
// the object on a track, a time cursor through every panel — animated by
// `t` in the movie, dragged by the paused viewer along with the v and a
// graphs themselves.
import { describe, expect, test } from "vitest";
import { scenes } from "../src/scenes/registry";
import { geometry, niceRange, resolveMotion, stateAt, travelTo, type MotionParams } from "../src/scenes/motion_graphs/model";
import { areaPieces, layoutMotionGraphs } from "../src/scenes/motion_graphs/layout";
import { lintMotionGraphs } from "../src/scenes/motion_graphs/lint";
import { accelerationPatch, dragPatch, motionParts, settleRanges, velocityPatch, withRanges, writeVelocities } from "../src/scenes/motion_graphs/widget";
import { buildWidgetScene } from "../src/scenes/widget-scene";
import { dragMoveEvent, inputEvent, partAt, runWidget } from "../src/scenes/widget-run";
import { SURFACE_PART, type WidgetScene } from "../src/scenes/widget-types";
import { layoutSpec } from "../src/layout/layout";
import { flattenDrawables, type Pt } from "../src/layout/model";
import { validateSpec } from "../src/spec/schema";
import { planCommands } from "../src/render/plan";
import { readParam, withOverrides } from "../src/render/params";
import { STEP_UNITS } from "../src/scenes/number-scrub";
import type { RenderHandle } from "../src/render";

const module = scenes["motion_graphs"];
const CAR: MotionParams = {
  segments: [{ duration: 3, a: 2, label: "speeding up" }, { duration: 4, label: "cruising" }, { duration: 3, v1: 0, label: "braking" }],
  t: 4,
  shade: "to_cursor",
};
const THROW: MotionParams = { x0: 0, v0: 10, a: -10, duration: 2, t: 0.5, numbers: ["x0", "v0", "a"] };
const BACK: MotionParams = { v0: 4, a: -1, duration: 6, panels: ["x", "v"], shade: "all", t: 6, track: false };

const asRec = (p: MotionParams) => p as unknown as Record<string, unknown>;
const pageOf = (p: MotionParams) => layoutSpec({ template: "motion_graphs", params: p, commands: [] } as unknown as RenderHandle["spec"]);
const sceneOf = (p: MotionParams): WidgetScene => buildWidgetScene(module, asRec(p), { layout: pageOf(p) })!;
const centre = (sc: WidgetScene, id: string): Pt => {
  const b = sc.boxes.get(id)!;
  return [b.x + b.w / 2, b.y + b.h / 2];
};
const ids = (p: MotionParams) => new Set(flattenDrawables(layoutMotionGraphs(p).drawables).map((d) => d.id));
const drawn = (p: MotionParams, id: string) => flattenDrawables(layoutMotionGraphs(p).drawables).find((d) => d.id === id) as unknown as { pts: Pt[]; shapeHint?: { c: Pt }; text?: string };

describe("the motion", () => {
  test("constant acceleration: x, v, a at any time", () => {
    const m = resolveMotion(THROW);
    expect(m.T).toBe(2);
    expect(stateAt(m, 1)).toEqual({ t: 1, x: 5, v: 0, a: -10 });
    expect(stateAt(m, 5).t).toBe(2); // clamped to the motion
  });
  test("pieces: position and velocity carry over; v1 gives the acceleration", () => {
    const m = resolveMotion(CAR);
    expect(m.segs.map((s) => [s.t0, s.v0, s.a, s.v1, s.x0])).toEqual([
      [0, 0, 2, 6, 0],
      [3, 6, 0, 6, 9],
      [7, 6, -2, 0, 33],
    ]);
    expect(stateAt(m, 10).x).toBe(42);
  });
  test("displacement and distance: a motion that turns back", () => {
    const m = resolveMotion(BACK);
    // Forward 8 m in 4 s, back 2 m in the last 2.
    expect(travelTo(m, 6)).toEqual({ displacement: 6, distance: 10 });
    expect(travelTo(m, 4)).toEqual({ displacement: 8, distance: 8 });
  });
  test("a later piece's own v0 is an instant change of velocity", () => {
    const m = resolveMotion({ v0: -3, segments: [{ duration: 1 }, { duration: 1, v0: 3 }] });
    expect(m.segs[1].v0).toBe(3);
    expect(m.segs[1].explicitV0).toBe(true);
    expect(travelTo(m, 2)).toEqual({ displacement: 0, distance: 6 });
  });
  test("round ranges: v and a reach 0; a flat one opens up", () => {
    expect(niceRange(0, 6, 3, true)).toEqual([0, 6]);
    expect(niceRange(-2, 2, 2, true)).toEqual([-2, 2]);
    expect(niceRange(3, 3, 3, true)).toEqual([0, 3]); // a constant speed: from 0 up to it
    expect(niceRange(0, 0, 2, true)).toEqual([-0.5, 0.5]); // no acceleration at all
  });
});

describe("the layout", () => {
  test("three panels on one time axis, the track, the cursor and its readouts", () => {
    const got = ids(CAR);
    for (const id of ["axes_x", "axes_v", "axes_a", "curve_x", "v_seg_0", "v_seg_2", "a_seg_1", "boundaries", "phase_0", "track", "object", "object_arrow", "cursor", "cursor_knob", "readout_t", "dot_x", "dot_v", "dot_a", "tangent_x", "tangent_v", "readout_x", "readout_v", "readout_a", "area"]) expect(got).toContain(id);
    const g = geometry(CAR);
    expect(g.panels.map((p) => p.key)).toEqual(["x", "v", "a"]);
    // One time axis: every panel shares its x extent.
    expect(new Set(g.panels.map((p) => `${p.x0},${p.x1}`)).size).toBe(1);
    const l = layoutMotionGraphs(CAR);
    expect(l.values).toMatchObject({ t: 4, x: 15, v: 6, a: 0, displacement: 15, distance: 15, duration: 10, x_end: 42, v_end: 0, a_0: 2, v_2: 0 });
    expect(l.groups!.curve_v).toEqual(["v_seg_0", "v_seg_1", "v_seg_2"]);
    // Drawing the cursor brings its dots, tangents and readouts along.
    expect(l.drawnWith!.cursor).toEqual(expect.arrayContaining(["cursor_knob", "readout_t", "dot_x", "tangent_x", "readout_a"]));
  });
  test("the panels the author picks, and nothing of the others", () => {
    const got = ids(BACK);
    expect(got.has("axes_a")).toBe(false);
    expect(got.has("a_seg_0")).toBe(false);
    expect(got.has("track")).toBe(false);
    expect(geometry(BACK).panels.map((p) => p.key)).toEqual(["x", "v"]);
  });
  test("the frame is the v panel: {data: [t, v]} lands on the v graph", () => {
    const l = layoutMotionGraphs(CAR);
    const g = geometry(CAR);
    const vp = g.panels.find((p) => p.key === "v")!;
    expect(l.frame).toEqual({ x: [0, 10], y: vp.range, box: { x0: vp.x0, y0: vp.y0, x1: vp.x1, y1: vp.y1 } });
  });
  test("the area under v: yellow forward, red back, cut where v crosses 0", () => {
    const g = geometry(BACK);
    const pieces = areaPieces(g, 6);
    expect(pieces.map((p) => p.sign)).toEqual([1, -1]);
    // The crossing is at t = 4.
    expect(pieces[0].pts.at(-1)![0]).toBeCloseTo(g.sx(4), 6);
    expect(areaPieces(g, 0)).toEqual([]);
  });
  test("the header numbers, each its own part", () => {
    const got = ids(THROW);
    for (const id of ["num_x0", "num_v0", "num_a", "name_v0", "unit_a"]) expect(got).toContain(id);
    expect(drawn(THROW, "num_a").text).toBe("−10");
  });
  test("a tangent is cut to its panel at the motion's end", () => {
    const g = geometry(BACK);
    const tan = drawn(BACK, "tangent_v").pts;
    for (const [x] of tan) expect(x).toBeLessThanOrEqual(g.plotX1 + 1e-6);
  });
});

describe("the lint", () => {
  test("the manifest's examples are clean", () => {
    for (const ex of module.manifest.examples) expect(lintMotionGraphs(ex.params as MotionParams)).toEqual([]);
  });
  test("a negative duration, too many pieces, a position that jumps", () => {
    const msgs = (p: MotionParams) => lintMotionGraphs(p).map((i) => `${i.severity}: ${i.message}`);
    expect(msgs({ segments: [{ duration: -1 }] })[0]).toMatch(/^error: .*positive time/);
    expect(msgs({ segments: Array.from({ length: 9 }, () => ({ duration: 1 })) })[0]).toMatch(/^error: 9 segments/);
    expect(msgs({ v0: 2, segments: [{ duration: 2 }, { duration: 1, x0: 10 }] })[0]).toMatch(/^error: segments\[1\]: x0 10 but the object is at 4/);
    expect(msgs({ v0: 2, segments: [{ duration: 2 }, { duration: 1, x0: 4 }] })).toEqual([]);
    expect(msgs({ duration: 2, t: 3 })[0]).toMatch(/^warn: t 3 is outside/);
    expect(msgs({ segments: [{ duration: 1, a: 1, v1: 5 }] })[0]).toMatch(/both a and v1/);
  });
});

describe("the drag math", () => {
  test("a v piece: its end corner turns it, its start corner too, its middle lifts it", () => {
    // Constant case: end → a changes, start → v0 and a, middle → v0 only.
    expect(velocityPatch(THROW, 0, 0.9, 2)).toEqual({ v0: 10, a: -9 });
    expect(velocityPatch(THROW, 0, 0.1, 2)).toEqual({ v0: 12, a: -11 });
    expect(velocityPatch(THROW, 0, 0.5, 2)).toEqual({ v0: 12, a: -10 });
  });
  test("pieces: the cruise lifted, the ramps either side turn with it; v1 stays v1", () => {
    const p = velocityPatch(CAR, 1, 0.5, 2) as { segments: Record<string, unknown>[] };
    expect(p.segments[0]).toMatchObject({ duration: 3, a: 2.6667 });
    expect(p.segments[1]).toMatchObject({ duration: 4, a: 0 });
    expect(p.segments[2]).toEqual({ duration: 3, v1: 0, label: "braking" });
    const m = resolveMotion({ ...CAR, ...p } as unknown as MotionParams);
    expect(m.segs[1].v0).toBeCloseTo(8, 3);
    expect(m.segs[2].v0).toBeCloseTo(8, 3);
  });
  test("an instant change of velocity stays one: its neighbour does not follow", () => {
    const P: MotionParams = { v0: -3, segments: [{ duration: 1 }, { duration: 1, v0: 3 }] };
    const p = velocityPatch(P, 1, 0.1, 1) as { segments: Record<string, unknown>[]; v0?: number };
    expect(p.segments[1]).toMatchObject({ v0: 4, a: -1 });
    expect(p.segments[0]).toMatchObject({ a: 0 });
  });
  test("an a piece: its acceleration; the pieces after keep theirs", () => {
    // Steps of a fiftieth of the a range (−10…0 → 0.2).
    expect(accelerationPatch(THROW, 0, -1.3)).toEqual({ a: -11.2 });
    const p = accelerationPatch(CAR, 0, 1) as { segments: Record<string, unknown>[] };
    expect(p.segments[0]).toMatchObject({ a: 3 });
    expect(p.segments[1]).toBe(CAR.segments![1]);
  });
  test("the author's form is written back", () => {
    const m = resolveMotion(CAR);
    const p = writeVelocities(CAR, m, [0, 6, 6], [6, 6, 0], 0.1);
    expect(p).toEqual({ v0: 0, segments: [{ duration: 3, a: 2, label: "speeding up" }, { duration: 4, a: 0, label: "cruising" }, { duration: 3, v1: 0, label: "braking" }] });
  });
  test("ranges: held while the motion fits, widened when it leaves, fitted again at the release", () => {
    expect(withRanges(THROW, { a: -9 }, {})).toMatchObject({ x_range: geometry(THROW).ranges.x, v_range: geometry(THROW).ranges.v });
    const wide = withRanges(THROW, { v0: 30 }, {}) as { v_range: number[] };
    expect(wide.v_range[1]).toBeGreaterThanOrEqual(30);
    // An authored range is never written.
    expect("v_range" in withRanges({ ...THROW, v_range: [-20, 20] }, { v0: 12 }, { v: true })).toBe(false);
    expect(settleRanges({ a: 1, x_range: [0, 5], v_range: [0, 2] }, { v: true })).toEqual({ a: 1, x_range: undefined, v_range: [0, 2] });
  });
});

describe("the widget", () => {
  test("the parts a press can take", () => {
    const sc = sceneOf(CAR);
    expect(motionParts(sc)).toEqual(["cursor_knob", "cursor", "v_seg_0", "v_seg_1", "v_seg_2", "a_seg_0", "a_seg_1", "a_seg_2", "curve_x"]);
    const body = module.widget!();
    expect(partAt(sc, centre(sc, "cursor_knob"), 18, body.parts)).toBe("cursor_knob");
    expect(partAt(sc, centre(sc, "v_seg_1"), 18, body.parts)).toBe("v_seg_1");
  });
  test("drag the cursor's handle: time moves and everything reads out there", () => {
    const sc = sceneOf(CAR);
    const g = geometry(CAR);
    const from = centre(sc, "cursor_knob");
    const to: Pt = sc.toLogical([8, 0]);
    const run = runWidget(module, asRec(CAR), [dragMoveEvent("cursor_knob", from, [to[0], from[1]], sc)], { layout: pageOf(CAR) });
    expect(run.errors).toEqual([]);
    expect(run.params.t).toBe(8);
    const l = layoutMotionGraphs(run.params as MotionParams);
    expect(l.values).toMatchObject({ t: 8, v: 4, a: -2, x: 38 });
    expect(g.sx(8)).toBeGreaterThan(g.sx(4));
  });
  test("blank paper in the panels is the cursor's too", () => {
    const sc = sceneOf(CAR);
    const r = dragPatch(SURFACE_PART, sc.toLogical([1, 1]), sc.toLogical([2.5, 1]), sc);
    expect(r!.patch).toEqual({ t: 2.5 });
    const surface = module.widget!().surface!(sc)!;
    expect(surface.w).toBeGreaterThan(500);
  });
  test("lift the cruise on the v graph: x(t) and a(t) recompute", () => {
    const sc = sceneOf(CAR);
    const from = centre(sc, "v_seg_1");
    const up = sc.toLogical([5, 8]); // v = 8 on the v panel
    const run = runWidget(module, asRec(CAR), [dragMoveEvent("v_seg_1", from, [from[0], up[1]], sc)], { layout: pageOf(CAR) });
    expect(run.errors).toEqual([]);
    const l = layoutMotionGraphs(run.params as MotionParams);
    expect(l.values!.v).toBeCloseTo(8, 3);
    expect(l.values!.a_0).toBeCloseTo(2.6667, 3);
    expect(l.values!.a_2).toBeCloseTo(-2.6667, 3);
    // The v range grew to hold 8 (held for the gesture, not narrowed).
    expect((run.params.v_range as number[])[1]).toBeGreaterThanOrEqual(8);
  });
  test("scrub and type the header numbers", () => {
    const sc = sceneOf(THROW);
    const from = centre(sc, "num_a");
    const run = runWidget(module, asRec(THROW), [dragMoveEvent("num_a", from, [from[0] + STEP_UNITS * 5, from[1]], sc)], { layout: pageOf(THROW) });
    expect(run.params.a).toBe(-9);
    const typed = runWidget(module, asRec(THROW), [inputEvent("num_v0", 15)], { layout: pageOf(THROW) });
    expect(typed.params.v0).toBe(15);
    expect(module.widget!().editable!("num_v0", [0, 0], sc)).toMatchObject({ value: 10, label: "Starting velocity" });
    expect(module.widget!().editable!("cursor", [0, 0], sc)).toBeNull();
  });
  test("the Reset pill brings the author's motion back; moving time alone shows none", () => {
    const body = module.widget!();
    const sc = sceneOf(THROW);
    const state = body.init(sc);
    expect(body.rest!(buildWidgetScene(module, asRec({ ...THROW, t: 1.5 }))!, state)).toBeNull();
    const moved = buildWidgetScene(module, asRec({ ...THROW, a: -5 }))!;
    expect(body.rest!(moved, state)).toMatchObject({ a: -10, v0: 10 });
  });
});

describe("the movie: animate t sweeps the cursor", () => {
  test("t animates from the drawn value; the object, cursor and area follow", () => {
    const spec = { template: "motion_graphs", params: CAR, commands: [{ animate: { t: 10 }, duration: 4 }] };
    expect(validateSpec(spec).ok).toBe(true);
    expect(readParam(asRec(CAR), "t")).toBe(4);
    const plan = planCommands(spec.commands as never, [], { animateBase: asRec(CAR) });
    const step = plan.steps.find((s) => s.kind === "animate") as { starts: Record<string, number | null>; targets: Record<string, number> };
    expect(step.starts.t).toBe(4);
    expect(step.targets.t).toBe(10);
    const at = (t: number) => withOverrides(asRec(CAR), { t }) as unknown as MotionParams;
    const ballX = (p: MotionParams) => drawn(p, "object").shapeHint!.c[0];
    const cursorX = (p: MotionParams) => drawn(p, "cursor").pts[0][0];
    expect(ballX(at(8))).toBeGreaterThan(ballX(at(4)));
    expect(cursorX(at(8))).toBeGreaterThan(cursorX(at(4)));
    expect(layoutMotionGraphs(at(8)).values).toMatchObject({ t: 8, displacement: 38 });
    const area = (p: MotionParams) => (flattenDrawables(layoutMotionGraphs(p).drawables).filter((d) => d.id.startsWith("area__")) as unknown as { pts: Pt[] }[]).flatMap((d) => d.pts.map((q) => q[0]));
    expect(Math.max(...area(at(8)))).toBeGreaterThan(Math.max(...area(at(4))));
  });
  test("{motion.<key>} tokens read the values", () => {
    const l = layoutSpec({ template: "motion_graphs", params: CAR, commands: [], elements: [{ id: "note", type: "text", text: "x = {motion.x} m", at: [500, 20] }] } as unknown as RenderHandle["spec"]);
    const note = flattenDrawables(l.drawables).find((d) => d.id === "note") as unknown as { text: string };
    expect(note.text).toBe("x = 15 m");
  });
});
