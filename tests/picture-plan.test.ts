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

describe("places in the planner", () => {
  test("highlight a region: a box step on the region's canvas box", () => {
    const p = plan([{ draw: ["md"] }, { highlight: { target: "md:left" } }]);
    const s = stepOf(p, "highlight");
    expect(s.effect).toBe("box");
    expect(s.ids).toEqual(["md:left"]);
    expect(s.boxes["md:left"]).toEqual({ x: 100, y: 300, w: 200, h: 200 });
    expect(p.warnings).toEqual([]);
  });
  test("highlight with part naming a region is the same as the region", () => {
    const s = stepOf(plan([{ draw: ["md"] }, { highlight: { target: "md", part: "bottom" } }]), "highlight");
    expect(s.ids).toEqual(["md:bottom"]);
    expect(s.boxes["md:bottom"].y).toBeCloseTo(300, 5);
    expect(s.boxes["md:bottom"].h).toBeCloseTo(20, 5);
    expect(s.part).toBeUndefined();
  });
  test("glow on a place becomes box; an ordinary id keeps glow", () => {
    expect(stepOf(plan([{ draw: ["md"] }, { highlight: { target: "md@[0,0,0.5,0.5]", effect: "glow" } }]), "highlight").effect).toBe("box");
    expect(stepOf(plan([{ draw: ["md", "t"] }, { highlight: { target: "t" } }]), "highlight").effect).toBe("glow");
  });
  test("point at a region, at a region's anchor, at a fraction", () => {
    let s = stepOf(plan([{ draw: ["md"] }, { point: { at: { ref: "md:left" } } }]), "point");
    expect([s.x, s.y]).toEqual([200, 400]);
    expect(s.box).toEqual({ x: 100, y: 300, w: 200, h: 200 });
    s = stepOf(plan([{ draw: ["md"] }, { point: { at: { ref: "md:left", anchor: "top" } } }]), "point");
    expect([s.x, s.y]).toEqual([200, 500]);
    s = stepOf(plan([{ draw: ["md"] }, { point: { at: { ref: "md@[0.6, 0.1]" } } }]), "point");
    expect(s.x).toBeCloseTo(340, 5);
    expect(s.y).toBeCloseTo(480, 5);
    s = stepOf(plan([{ draw: ["md"] }, { point: { at: { ref: "md@top" } } }]), "point");
    expect([s.x, s.y]).toEqual([300, 500]);
  });
  test("camera on a region frames its box", () => {
    const p = plan([{ draw: ["md"] }, { camera: { on: ["md:left"] } }]);
    const s = stepOf(p, "camera");
    // The framed box is centred on the region (the fit lifts it a little: compare x only).
    expect(s.box.x + s.box.w / 2).toBeCloseTo(200, 0);
  });
  test("focus on a region: the picture stays lit, one spot with the region as its hole", () => {
    const s = stepOf(plan([{ draw: ["md", "t"] }, { focus: { target: "md:left" } }]), "focus");
    expect(s.ids).toContain("md");
    expect(s.ids).not.toContain("t");
    expect(s.spots).toEqual([{ frame: rect, holes: [{ x: 100, y: 300, w: 200, h: 200 }] }]);
  });
  test("a moved picture: the region follows it", () => {
    const s = stepOf(plan([{ draw: ["md"] }, { move: { target: "md", by: [50, -20] } }, { highlight: { target: "md:left" } }]), "highlight");
    expect(s.boxes["md:left"]).toEqual({ x: 150, y: 280, w: 200, h: 200 });
  });
  test("a missing region and a non-picture owner warn and skip", () => {
    const p = plan([{ draw: ["md", "t"] }, { highlight: { target: "md:nope" } }, { point: { at: { ref: "t:x" } } }]);
    expect(p.steps.some((s: any) => s.kind === "highlight" || s.kind === "point")).toBe(false);
    expect(p.warnings.join("\n")).toMatch(/md has no region "nope" — it has: left, bottom/);
    expect(p.warnings.join("\n")).toMatch(/"t" is not a picture/);
  });
  test("a place on a picture not yet drawn is skipped with a warning", () => {
    const p = plan([{ highlight: { target: "md:left" } }]);
    expect(p.steps.some((s: any) => s.kind === "highlight")).toBe(false);
    expect(p.warnings.join("\n")).toMatch(/"md:left" is not visible/);
  });
  test("a mixed highlight keeps the plain id's effect and warns", () => {
    const p = plan([{ draw: ["md", "t"] }, { highlight: { target: ["t", "md:left"] } }]);
    expect(stepOf(p, "highlight").effect).toBe("glow");
    expect(p.warnings.join("\n")).toContain("in its own command");
  });
  test("an inherited name is not a region", () => {
    const p = plan([{ draw: ["md"] }, { highlight: { target: "md:toString" } }]);
    expect(p.steps.some((s: any) => s.kind === "highlight")).toBe(false);
    expect(p.warnings.join("\n")).toMatch(/has no region "toString"/);
  });
  test("a scaled picture: the region scales about the picture's centre (final fix I2)", () => {
    const p = plan([{ draw: ["md"] }, { move: { target: "md", scale: 2 } }, { highlight: { target: "md:left" } }]);
    const b = stepOf(p, "highlight").boxes["md:left"];
    expect(b.x).toBeCloseTo(-100, 5);
    expect(b.y).toBeCloseTo(200, 5);
    expect(b.w).toBeCloseTo(400, 5);
    expect(b.h).toBeCloseTo(400, 5);
  });
  test("a turned picture: the region's corners turn with it (final fix I2)", () => {
    const p = plan([{ draw: ["md"] }, { move: { target: "md", rotate: 90 } }, { highlight: { target: "md:left" } }]);
    const b = stepOf(p, "highlight").boxes["md:left"];
    // The left half (200 x 200, left of the centre 300, 400) turned a quarter about the centre: 200 x 200, above or below it.
    expect(b.x).toBeCloseTo(200, 5);
    expect(b.w).toBeCloseTo(200, 5);
    expect(b.h).toBeCloseTo(200, 5);
    expect([200, 400].some((y) => Math.abs(b.y - y) < 1e-6)).toBe(true);
    // A point place turns too: the left edge's middle (100, 400) lands on the vertical through the centre.
    const pt = stepOf(plan([{ draw: ["md"] }, { move: { target: "md", rotate: 90 } }, { point: { at: { ref: "md@[0, 0.5]" } } }]), "point");
    expect(pt.x).toBeCloseTo(300, 5);
    expect(Math.abs(pt.y - 400)).toBeCloseTo(200, 5);
  });
  test("a scaled picture: the spotlight frame scales with it (final fix I2)", () => {
    const s = stepOf(plan([{ draw: ["md", "t"] }, { move: { target: "md", scale: 2 } }, { focus: { target: "md:left" } }]), "focus");
    expect(s.spots[0].frame.w).toBeCloseTo(800, 5);
    expect(s.spots[0].frame.h).toBeCloseTo(400, 5);
  });
});
