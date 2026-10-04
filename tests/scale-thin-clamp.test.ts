// W25: a long log line thins its numbers as far as the lint's own measure
// needs, and the marker's number stays whole on the page.
import { describe, expect, test } from "vitest";
import { layoutSpec } from "../src/layout/layout";
import { expandSpec } from "../src/spec/expand";
import { scaleValueElements } from "../src/spec/scale";
import { PAGE_W } from "../src/layout/page";
import type { Spec } from "../src/spec/types";

const spec = (el: Record<string, unknown>): Spec => ({ title: "How many people?", elements: [el], commands: [{ draw: [el.id as string], speak: "x" }, { draw: [`${el.id}_answer`], speak: "y" }] }) as unknown as Spec;

describe("scale", () => {
  test("1000 to 10 billion: no tick numbers overlap, and nothing off the page", () => {
    const out = layoutSpec(expandSpec(spec({ id: "a", type: "scale", min: 1000, max: 1e10, log: true, value: 8.1e9, unit: "people" })));
    expect(out.issues.map((i) => i.message)).toEqual([]);
    expect(out.warnings).toEqual([]);
  });
  test("the marker's number near the right end is pulled in; its pin is not", () => {
    const sc = { id: "b", type: "scale" as const, min: 1e6, max: 1e10, log: true, value: 8.1e9, x: 100, width: 880, y: 400 };
    const [pin, num] = scaleValueElements(sc, 8.1e9) as unknown as { points?: number[][]; x?: number; text?: string; font_size?: number }[];
    const pinX = pin.points![2][0];
    expect(num.x!).toBeLessThan(pinX);
    expect(num.x! + (num.text!.length * num.font_size! * 0.52) / 2).toBeLessThanOrEqual(PAGE_W);
  });
});
