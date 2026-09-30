// tests/picture-plan.test.ts
import { describe, expect, test } from "vitest";
import { planCommands } from "../src/render/plan";
import { FULL_VIEW4 } from "../src/spec/places";

// A picture shown at x 100..500, y 300..500 (y up); regions in top-left fractions.
const rect = { x: 100, y: 300, w: 400, h: 200 };
const regions = { left: [0, 0, 0.5, 1] as [number, number, number, number], bottom: [0, 0.9, 1, 0.1] as [number, number, number, number] };
const opts = {
  bboxOf: (id: string) => (id === "md" ? rect : id === "t" ? { x: 0, y: 0, w: 10, h: 10 } : null),
  pictureOf: (id: string) => (id === "md" ? { frame: { rect, view: FULL_VIEW4 }, regions } : null),
};
const plan = (commands: object[]) => planCommands(commands as never, ["md", "t"], opts as never);
const stepOf = (p: ReturnType<typeof plan>, kind: string) => p.steps.find((s: any) => s.kind === kind) as any;
/** The first mark step's first stop box (spec §13: gestures on places are marks). */
const stopOf = (p: ReturnType<typeof plan>) => stepOf(p, "mark").stops[0].box;

describe("places in the planner", () => {
  test("highlight a region: a mark on the region's canvas box", () => {
    const p = plan([{ draw: ["md"] }, { highlight: { target: "md:left" } }]);
    expect(stepOf(p, "highlight")).toBeUndefined();
    const s = stepOf(p, "mark");
    expect(s.mark).toBe("light");
    expect(s.owner).toBe("md");
    expect(s.stops[0].box).toEqual({ x: 100, y: 300, w: 200, h: 200 });
    expect(p.warnings).toEqual([]);
  });
  test("highlight with part naming a region is the same as the region", () => {
    const b = stopOf(plan([{ draw: ["md"] }, { highlight: { target: "md", part: "bottom" } }]));
    expect(b.y).toBeCloseTo(300, 5);
    expect(b.h).toBeCloseTo(20, 5);
  });
  test("glow on a place becomes a light mark; an ordinary id keeps glow", () => {
    expect(stepOf(plan([{ draw: ["md"] }, { highlight: { target: "md@[0,0,0.5,0.5]", effect: "glow" } }]), "mark").mark).toBe("light");
    expect(stepOf(plan([{ draw: ["md", "t"] }, { highlight: { target: "t" } }]), "highlight").effect).toBe("glow");
  });
  test("a point place in a highlight: a 60 x 60 stop centred on it", () => {
    expect(stopOf(plan([{ draw: ["md"] }, { highlight: { target: "md@top" } }]))).toEqual({ x: 270, y: 470, w: 60, h: 60 });
  });
  test("point at a region, at a region's anchor, at a fraction", () => {
    const at = (ref: string, anchor?: string) => stopOf(plan([{ draw: ["md"] }, { point: { at: { ref, ...(anchor ? { anchor } : {}) } } }]));
    expect(at("md:left")).toEqual({ x: 100, y: 300, w: 200, h: 200 });
    expect(at("md:left", "top")).toEqual({ x: 200, y: 500, w: 0, h: 0 });
    const f = at("md@[0.6, 0.1]");
    expect(f.x).toBeCloseTo(340, 5);
    expect(f.y).toBeCloseTo(480, 5);
    expect([f.w, f.h]).toEqual([0, 0]);
    expect(at("md@top")).toEqual({ x: 300, y: 500, w: 0, h: 0 });
  });
  test("an explicit laser gesture on a place keeps the laser", () => {
    const s = stepOf(plan([{ draw: ["md"] }, { point: { at: { ref: "md:left" }, gesture: "tap" } }]), "point");
    expect([s.x, s.y]).toEqual([200, 400]);
    expect(s.box).toEqual({ x: 100, y: 300, w: 200, h: 200 });
  });
  test("camera on a region frames its box", () => {
    const p = plan([{ draw: ["md"] }, { camera: { on: ["md:left"] } }]);
    const s = stepOf(p, "camera");
    // The framed box is centred on the region (the fit lifts it a little: compare x only).
    expect(s.box.x + s.box.w / 2).toBeCloseTo(200, 0);
  });
  test("focus on a region: a light mark on the picture, no focus step", () => {
    const p = plan([{ draw: ["md", "t"] }, { focus: { target: "md:left" } }]);
    expect(stepOf(p, "focus")).toBeUndefined();
    expect(stepOf(p, "mark")).toMatchObject({ mark: "light", frame: rect, stops: [{ box: { x: 100, y: 300, w: 200, h: 200 }, at: 0 }] });
  });
  test("a mixed focus keeps the ids, drops the places and warns", () => {
    const p = plan([{ draw: ["md", "t"] }, { focus: { target: ["t", "md:left"] } }]);
    const s = stepOf(p, "focus");
    expect(s.ids).toEqual(["t"]);
    expect(stepOf(p, "mark")).toBeUndefined();
    expect(p.warnings.join("\n")).toContain('focus: places and ids in one focus — focus "md:left" in its own command');
  });
  test("a moved picture: the region follows it", () => {
    expect(stopOf(plan([{ draw: ["md"] }, { move: { target: "md", by: [50, -20] } }, { highlight: { target: "md:left" } }]))).toEqual({ x: 150, y: 280, w: 200, h: 200 });
  });
  test("a missing region and a non-picture owner warn and skip", () => {
    const p = plan([{ draw: ["md", "t"] }, { highlight: { target: "md:nope" } }, { point: { at: { ref: "t:x" } } }]);
    expect(p.steps.some((s: any) => s.kind === "highlight" || s.kind === "point" || s.kind === "mark")).toBe(false);
    expect(p.warnings.join("\n")).toMatch(/md has no region "nope" — it has: left, bottom/);
    expect(p.warnings.join("\n")).toMatch(/"t" is not a picture/);
  });
  test("a place on a picture not yet drawn is skipped with a warning", () => {
    const p = plan([{ highlight: { target: "md:left" } }]);
    expect(p.steps.some((s: any) => s.kind === "highlight" || s.kind === "mark")).toBe(false);
    expect(p.warnings.join("\n")).toMatch(/"md:left" is not visible/);
  });
  test("a mixed highlight keeps the plain id's effect and warns", () => {
    const p = plan([{ draw: ["md", "t"] }, { highlight: { target: ["t", "md:left"] } }]);
    expect(stepOf(p, "highlight").effect).toBe("glow");
    expect(stepOf(p, "highlight").ids).toEqual(["t"]);
    expect(stepOf(p, "mark")).toBeUndefined();
    expect(p.warnings.join("\n")).toContain("in its own command");
  });
  test("an inherited name is not a region", () => {
    const p = plan([{ draw: ["md"] }, { highlight: { target: "md:toString" } }]);
    expect(p.steps.some((s: any) => s.kind === "highlight" || s.kind === "mark")).toBe(false);
    expect(p.warnings.join("\n")).toMatch(/has no region "toString"/);
  });
  test("a scaled picture: the region scales about the picture's centre (final fix I2)", () => {
    const p = plan([{ draw: ["md"] }, { move: { target: "md", scale: 2 } }, { highlight: { target: "md:left" } }]);
    const b = stopOf(p);
    expect(b.x).toBeCloseTo(-100, 5);
    expect(b.y).toBeCloseTo(200, 5);
    expect(b.w).toBeCloseTo(400, 5);
    expect(b.h).toBeCloseTo(400, 5);
  });
  test("a turned picture: the region's corners turn with it (final fix I2)", () => {
    const p = plan([{ draw: ["md"] }, { move: { target: "md", rotate: 90 } }, { highlight: { target: "md:left" } }]);
    const b = stopOf(p);
    // The left half (200 x 200, left of the centre 300, 400) turned a quarter about the centre: 200 x 200, above or below it.
    expect(b.x).toBeCloseTo(200, 5);
    expect(b.w).toBeCloseTo(200, 5);
    expect(b.h).toBeCloseTo(200, 5);
    expect([200, 400].some((y) => Math.abs(b.y - y) < 1e-6)).toBe(true);
    // A point place turns too: the left edge's middle (100, 400) lands on the vertical through the centre.
    const pt = stopOf(plan([{ draw: ["md"] }, { move: { target: "md", rotate: 90 } }, { point: { at: { ref: "md@[0, 0.5]" } } }]));
    expect(pt.x).toBeCloseTo(300, 5);
    expect(Math.abs(pt.y - 400)).toBeCloseTo(200, 5);
  });
  test("a scaled picture: the mark's frame scales with it (final fix I2)", () => {
    const s = stepOf(plan([{ draw: ["md", "t"] }, { move: { target: "md", scale: 2 } }, { focus: { target: "md:left" } }]), "mark");
    expect(s.frame.w).toBeCloseTo(800, 5);
    expect(s.frame.h).toBeCloseTo(400, 5);
  });
  test("camera centred on a region centres on the region's box (final fix T6-triage b)", () => {
    // zoom 4: the framed box stays clear of the canvas edge, which would otherwise clamp it.
    const s = stepOf(plan([{ draw: ["md"] }, { camera: { center: { ref: "md:left" }, zoom: 4 } }]), "camera");
    expect(s.box.x + s.box.w / 2).toBeCloseTo(200, 5);
    expect(s.box.y + s.box.h / 2).toBeCloseTo(400, 5);
  });
});
