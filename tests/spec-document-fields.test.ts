// Fields written by TOOLING rather than by the compiler, and the difference
// between the two schemas.
//
// specSchema is the authoring contract: what the model may write, handed to
// the API as the structured-output constraint (llm/compile.ts apiSchema). It
// is `additionalProperties: false`, which is what makes it a real constraint.
//
// A saved document carries more than the model writes. The translator stamps
// `lang` and `text_map`; the subtitle authoring stamps `subtitles`. None of
// them were in the schema, and validateSpec validated against it — so a
// translated drawcast was refused by the app ("Spec invalid: (root) must NOT
// have additional properties") and THROWN OUT by the standalone viewer. The
// language track shipped into a validator that rejected its own output.
//
// So there are two schemas: the authoring one the model sees, and the document
// one the validator uses. These tests hold both halves — the tooling fields
// pass validation, and they stay out of what the model is asked to produce.
import { describe, expect, test } from "vitest";
import { specSchema, validateSpec } from "../src/spec/schema";
import { apiSchema } from "../src/llm/compile";

const base = {
  title: "t",
  elements: [{ id: "a", type: "text", text: "x", x: 1, y: 1 }],
  commands: [{ draw: ["a"] }],
};

const TOOLING_FIELDS: Record<string, unknown> = {
  lang: "nb",
  text_map: { Susceptible: "Mottakelig" },
  subtitles: { nb: { "Supply meets demand.": "Tilbud møter etterspørsel." } },
};

describe("a saved document validates", () => {
  test("the plain spec still passes", () => {
    expect(validateSpec(base).ok).toBe(true);
  });

  for (const [field, value] of Object.entries(TOOLING_FIELDS)) {
    test(`${field} is accepted`, () => {
      const result = validateSpec({ ...base, [field]: value });
      expect(result.errors).toEqual([]);
      expect(result.ok).toBe(true);
    });
  }

  test("all of them together, as a translated drawcast actually arrives", () => {
    expect(validateSpec({ ...base, ...TOOLING_FIELDS }).ok).toBe(true);
  });

  test("an unknown field is still refused — the schema is still a constraint", () => {
    expect(validateSpec({ ...base, nonsense: 1 }).ok).toBe(false);
  });

  test("subtitles must be language → (line → line), not free-form", () => {
    expect(validateSpec({ ...base, subtitles: { nb: "a string" } }).ok).toBe(false);
    expect(validateSpec({ ...base, subtitles: { nb: { line: 7 } } }).ok).toBe(false);
  });
});

describe("the model is not asked to write them", () => {
  const properties = (schema: object): string[] => Object.keys((schema as { properties: object }).properties);

  for (const field of Object.keys(TOOLING_FIELDS)) {
    test(`${field} is absent from the authoring schema`, () => {
      expect(properties(specSchema)).not.toContain(field);
      expect(properties(apiSchema())).not.toContain(field);
    });
  }

  test("the authoring schema still constrains what the model may emit", () => {
    expect((specSchema as { additionalProperties: boolean }).additionalProperties).toBe(false);
  });
});
