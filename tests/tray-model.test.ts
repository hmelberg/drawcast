import { describe, expect, test } from "vitest";
import { sliderSpecs } from "../src/ui/tray-model";

describe("sliderSpecs", () => {
  test("finds a top-level bounded number", () => {
    const schema = { type: "object", properties: { n: { type: "number", minimum: 1, maximum: 100, multipleOf: 1 } } };
    expect(sliderSpecs(schema)).toEqual([{ path: "n", label: "n", min: 1, max: 100, step: 1 }]);
  });

  test("walks nested objects into dot paths", () => {
    const schema = {
      type: "object",
      properties: {
        demand_shift: { type: "object", properties: { amount: { type: "number", minimum: -93, maximum: 95 } } },
      },
    };
    expect(sliderSpecs(schema)).toEqual([{ path: "demand_shift.amount", label: "amount", min: -93, max: 95, step: "any" }]);
  });

  test("takes the number branch of a oneOf", () => {
    const schema = {
      type: "object",
      properties: {
        steepness: { oneOf: [{ type: "string", enum: ["flat", "steep"] }, { type: "number", minimum: 0.25, maximum: 2.5 }] },
      },
    };
    expect(sliderSpecs(schema)).toEqual([{ path: "steepness", label: "steepness", min: 0.25, max: 2.5, step: "any" }]);
  });

  test("skips numbers without both bounds, degenerate ranges, and non-schemas", () => {
    const schema = {
      type: "object",
      properties: {
        unbounded: { type: "number" },
        onlyMin: { type: "number", minimum: 0 },
        empty: { type: "number", minimum: 5, maximum: 5 },
        label: { type: "string" },
      },
    };
    expect(sliderSpecs(schema)).toEqual([]);
    expect(sliderSpecs(null)).toEqual([]);
    expect(sliderSpecs("nope")).toEqual([]);
  });
});
