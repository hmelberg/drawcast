import { describe, expect, test } from "vitest";
import { lintCommands, lintLayout } from "../src/lint/lint";
import { heuristicMeasure } from "../src/layout/measure";
import { defaultStyle, defaultDrawOpts, type Drawable } from "../src/layout/model";
import type { Spec } from "../src/spec/types";

function text(id: string, pos: [number, number], fontSize = 24, str = "Some label"): Drawable {
  return { id, kind: "text", pos, text: str, fontSize, anchor: "middle", z: 2, style: defaultStyle(), drawOpts: defaultDrawOpts("instant") };
}

function stroke(id: string, pts: [number, number][]): Drawable {
  return { id, kind: "stroke", pts, z: 1, style: defaultStyle(), drawOpts: defaultDrawOpts("sketch") };
}

describe("lintLayout", () => {
  test("clean layout has no issues", () => {
    const issues = lintLayout([text("a", [200, 200]), text("b", [700, 600])], heuristicMeasure);
    expect(issues).toEqual([]);
  });

  test("flags overlapping labels", () => {
    const issues = lintLayout([text("a", [500, 400]), text("b", [510, 405])], heuristicMeasure);
    const overlap = issues.find((i) => i.rule === "overlap-label-label");
    expect(overlap).toBeDefined();
    expect(overlap!.ids.sort()).toEqual(["a", "b"]);
  });

  test("flags a label sitting on a stroke", () => {
    const issues = lintLayout(
      [stroke("curve", [[100, 400], [900, 400]]), text("lbl", [500, 400])],
      heuristicMeasure,
    );
    expect(issues.some((i) => i.rule === "overlap-label-stroke")).toBe(true);
  });

  test("flags elements outside the canvas", () => {
    const issues = lintLayout([stroke("s", [[-50, 100], [200, 100]])], heuristicMeasure);
    expect(issues.some((i) => i.rule === "out-of-canvas" && i.ids.includes("s"))).toBe(true);
  });

  test("flags unreadable font sizes", () => {
    const issues = lintLayout([text("tiny", [300, 300], 8)], heuristicMeasure);
    expect(issues.some((i) => i.rule === "font-too-small")).toBe(true);
  });
});

describe("lintCommands", () => {
  const spec = (commands: object[]): Spec => ({ elements: [{ id: "e1", type: "label", text: "x", attach_to: "e1" }], commands }) as unknown as Spec;

  test("one standalone speak before ink is fine; two warn slow-start", () => {
    expect(lintCommands(spec([{ speak: "Intro." }, { draw: ["e1"] }]))).toEqual([]);
    const issues = lintCommands(spec([{ speak: "One." }, { speak: "Two." }, { draw: ["e1"] }]));
    expect(issues.map((i) => i.rule)).toEqual(["slow-start"]);
    expect(issues[0].severity).toBe("warn");
  });

  test("three consecutive standalone speaks warn talky-stretch once; pauses do not reset the run", () => {
    const issues = lintCommands(
      spec([{ draw: ["e1"] }, { speak: "a" }, { pause: 0.5 }, { speak: "b" }, { speak: "c" }, { speak: "d" }]),
    );
    expect(issues.map((i) => i.rule)).toEqual(["talky-stretch"]);
  });

  test("narrated actions break the run", () => {
    expect(
      lintCommands(spec([{ draw: ["e1"] }, { speak: "a" }, { speak: "b" }, { point: { at: { ref: "e1" } }, speak: "c" }, { speak: "d" }, { speak: "e" }])),
    ).toEqual([]);
  });

  test("speaks with no draw at all count toward slow-start", () => {
    const issues = lintCommands(spec([{ speak: "a" }, { speak: "b" }, { speak: "c" }]));
    expect(issues.map((i) => i.rule).sort()).toEqual(["slow-start", "talky-stretch"]);
  });
});
