// An explicit #parts=N is enforced where enforcement is real: the outline
// and storyboard calls are the ones whose schema IS the structured-output
// constraint (client.ts structuredOutputSupported), so the count goes into
// the schema and the model cannot return five for three. normalizeOutline's
// clip stays as the backstop for a plain-JSON fallback.

import { describe, expect, test } from "vitest";
import { structuredOutputSupported } from "../src/llm/client";
import { outlineSchemaFor } from "../src/llm/outline";
import { storyboardSchemaFor } from "../src/llm/storyboard";

const partsOf = (schema: object) => (schema as { properties: { parts: { minItems?: number; maxItems?: number } } }).properties.parts;

describe("#parts=N in the schema", () => {
  test("an explicit count pins parts to exactly N", () => {
    for (const build of [outlineSchemaFor, storyboardSchemaFor]) {
      const parts = partsOf(build(3));
      expect(parts.minItems).toBe(3);
      expect(parts.maxItems).toBe(3);
      expect(structuredOutputSupported(build(3))).toBe(true);
    }
  });

  test("a bare #parts leaves the count to the planner", () => {
    for (const build of [outlineSchemaFor, storyboardSchemaFor]) {
      const parts = partsOf(build(null));
      expect(parts.minItems).toBeUndefined();
      expect(parts.maxItems).toBeUndefined();
    }
  });

  test("a count above the ceiling is held at the ceiling", () => {
    const parts = partsOf(outlineSchemaFor(40));
    expect(parts.maxItems).toBe(6);
    expect(parts.minItems).toBe(6);
  });
});
