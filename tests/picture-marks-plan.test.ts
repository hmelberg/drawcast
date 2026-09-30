// tests/picture-marks-plan.test.ts — spec §13: gestures on picture places become one mark per picture.
import { expect, test } from "vitest";
import { planCommands } from "../src/render/plan";
import { FULL_VIEW4 } from "../src/spec/places";

// A picture shown at x 100..500, y 300..500 (y up); regions in top-left fractions.
const rect = { x: 100, y: 300, w: 400, h: 200 };
type R4 = [number, number, number, number];
const regions = { left: [0, 0, 0.5, 1] as R4, bottom: [0, 0.9, 1, 0.1] as R4, right: [0.5, 0, 0.5, 1] as R4 };
const opts = {
  bboxOf: (id: string) => (id === "md" ? rect : id === "t" ? { x: 0, y: 0, w: 10, h: 10 } : null),
  pictureOf: (id: string) => (id === "md" ? { frame: { rect, view: FULL_VIEW4 }, regions } : null),
};
const plan = (commands: object[]) => planCommands(commands as never, ["md", "t"], opts as never);
const marks = (p: any) => p.steps.filter((s: any) => s.kind === "mark");

test("highlight a place: a light mark with one stop", () => {
  const [m] = marks(plan([{ draw: ["md"] }, { highlight: { target: "md:left" } }]));
  expect(m).toMatchObject({ owner: "md", mark: "light", frame: rect, stops: [{ box: { x: 100, y: 300, w: 200, h: 200 }, at: 0 }] });
  expect(m.from).toBeUndefined();
});
test("several places in one highlight are stops through the sentence", () => {
  const [m] = marks(plan([{ draw: ["md"] }, { highlight: { target: ["md:left", "md:right", "md:bottom"] } }]));
  expect(m.stops.map((s: any) => s.at)).toEqual([0, 1 / 3, 2 / 3]);
});
test("effects map: circle → ring, box stays box, glow → light", () => {
  const k = (effect: string) => marks(plan([{ draw: ["md"] }, { highlight: { target: "md:left", effect } }]))[0].mark;
  expect([k("circle"), k("ring"), k("box"), k("glow"), k("pulse")]).toEqual(["ring", "ring", "box", "light", "light"]);
});
test("focus on a place is a light mark; point defaults to an arrow, glow on request, laser gestures unchanged", () => {
  expect(marks(plan([{ draw: ["md"] }, { focus: { target: "md:left" } }]))[0].mark).toBe("light");
  expect(marks(plan([{ draw: ["md"] }, { point: { at: { ref: "md:left" } } }]))[0].mark).toBe("arrow");
  expect(marks(plan([{ draw: ["md"] }, { point: { at: { ref: "md:left" }, gesture: "glow" } }]))[0].mark).toBe("glow");
  const p = plan([{ draw: ["md"] }, { point: { at: { ref: "md:left" }, gesture: "circle" } }]);
  expect(marks(p)).toEqual([]);
  expect(p.steps.some((s: any) => s.kind === "point")).toBe(true);
});
test("the next light on the same picture glides from the last box, across a camera move", () => {
  const p = plan([{ draw: ["md"] }, { highlight: { target: "md:left" } }, { camera: { on: ["md:right"] } }, { highlight: { target: "md:right" } }]);
  const [a, b] = marks(p);
  expect(a.continues).toBe(true);
  expect(b.from).toEqual({ x: 100, y: 300, w: 200, h: 200 });
});
test("lift, a different kind, or hiding the picture breaks the glide", () => {
  const lifted = marks(plan([{ draw: ["md"] }, { highlight: { target: "md:left" } }, { highlight: { target: "md:right", lift: true } }]));
  expect(lifted[0].continues).toBeFalsy();
  expect(lifted[1].from).toBeUndefined();
  const kinds = marks(plan([{ draw: ["md"] }, { highlight: { target: "md:left" } }, { point: { at: { ref: "md:right" } } }]));
  expect(kinds[1].from).toBeUndefined();
  const hidden = marks(plan([{ draw: ["md"] }, { highlight: { target: "md:left" } }, { hide: ["md"] }, { show: ["md"] }, { highlight: { target: "md:right" } }]));
  expect(hidden[1].from).toBeUndefined();
});
test("plain ids are untouched", () => {
  const p = plan([{ draw: ["md", "t"] }, { highlight: { target: "t" } }]);
  expect(marks(p)).toEqual([]);
  expect(p.steps.find((s: any) => s.kind === "highlight")).toMatchObject({ ids: ["t"], effect: "glow" });
});
