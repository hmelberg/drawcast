// Interactive code (a script with controls) defaults to output on top and
// the code below (Hans 2026-09-23) — `show: "below"` — instead of the
// output alone. An explicit `show` still wins.

import { describe, expect, test } from "vitest";
import { elementBBoxes, layoutSpec } from "../src/layout/layout";
import { heuristicMeasure } from "../src/layout/measure";
import type { CodeRunResult } from "../src/code/run";
import type { Spec } from "../src/spec/types";

const OK: CodeRunResult = { ok: true, stdout: "42", stderr: "", figures: [] };
const spec = (el: object): Spec =>
  ({ elements: [{ id: "c1", type: "code", language: "python", code: "n = (1, 10)\nprint(n)", code_result: JSON.stringify(OK), ...el }], commands: [] }) as unknown as Spec;

describe("interactive code — default layout", () => {
  test("controls and no show: the code is drawn, under the output", () => {
    const layout = layoutSpec(spec({ controls: ["n"] }), heuristicMeasure);
    const boxes = elementBBoxes(layout, heuristicMeasure);
    const out = boxes.get("c1_out");
    const line = boxes.get("c1_line_1");
    expect(out).toBeDefined();
    expect(line).toBeDefined();
    expect(out!.y).toBeGreaterThan(line!.y); // y-up: the output sits above the code
  });

  test("no controls and no show: output alone, as before", () => {
    const layout = layoutSpec(spec({}), heuristicMeasure);
    expect(elementBBoxes(layout, heuristicMeasure).has("c1_line_1")).toBe(false);
  });

  test("an explicit show wins over the default", () => {
    const layout = layoutSpec(spec({ controls: ["n"], show: "output" }), heuristicMeasure);
    expect(elementBBoxes(layout, heuristicMeasure).has("c1_line_1")).toBe(false);
  });
});
