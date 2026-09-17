import { describe, expect, test } from "vitest";
import { validateSpec, normalizeSpec } from "../src/spec/schema";

describe("inset in the schema (spec §8)", () => {
  test("an inset needs of", () => {
    const bad = validateSpec({ elements: [{ id: "p", type: "inset" }], commands: [{ draw: ["p"] }] });
    expect(bad.ok).toBe(false);
    expect(bad.errors.join("\n")).toMatch(/inset needs of/);
  });
  test("of by title, by number (a string), and previous all validate", () => {
    for (const of of ["The model", "2", "previous"]) {
      const r = validateSpec({ elements: [{ id: "p", type: "inset", of, crop: false }], commands: [{ draw: ["p"] }] });
      expect(r.ok, of).toBe(true);
    }
  });
  test("a numeric of (YAML `of: 2`) is normalised to its string", () => {
    const n = normalizeSpec({ elements: [{ id: "p", type: "inset", of: 2 }], commands: [] } as never) as { elements: { of: unknown }[] };
    expect(n.elements[0].of).toBe("2");
    const r = validateSpec({ elements: [{ id: "p", type: "inset", of: 2 }], commands: [{ draw: ["p"] }] });
    expect(r.ok).toBe(true);
  });
});
