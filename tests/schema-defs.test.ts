// The schema is embedded verbatim in every system prompt AND is the API's
// structured-output constraint, so a shape written out eight times is paid
// for eight times on every request. $defs is supported by both readers —
// Anthropic structured outputs list $ref/$def, and Ajv resolves #/$defs by
// JSON pointer regardless of draft-07's own keyword name. Design §3.2.
import { describe, expect, test } from "vitest";
import AjvModule from "ajv";
import { apiSchema } from "../src/llm/compile";
import { documentSchema, specSchema, validateSpec } from "../src/spec/schema";

const AjvCtor = ((AjvModule as unknown as { default?: unknown }).default ?? AjvModule) as typeof AjvModule;

describe("the schema's shared shapes", () => {
  test("the repeated shapes are defined once", () => {
    const s = apiSchema() as { $defs?: Record<string, unknown> };
    expect(Object.keys(s.$defs ?? {}).sort()).toEqual(["end_ref", "ghost", "point_ref"]);
    // The bodies are gone from the call sites: each of the 8 point_ref call
    // sites, 5 ghost call sites and 2 $ref-wrapped end_ref sites (at/center —
    // the other 2 end_ref sites read .properties directly, per the trap) now
    // point at $defs instead of repeating the shape inline.
    //
    // A raw count of the point-ref array shape's JSON text ({"type":"array",
    // "items":{"type":"number"},"minItems":2,"maxItems":2}) across the WHOLE
    // schema does not discriminate this: that exact 4-key shape is also
    // written out independently, outside pointRefSchema, at 8 other call
    // sites this task does not touch (point/angle's `at`, the endRefSchema
    // from/to numeric-pair alternative, path points, polygon vertices, and
    // the domain's x/y ranges) — measured at 16 total before this change, 9
    // after (8 untouched + the 1 canonical copy in $defs.point_ref), not the
    // ~1 a naive whole-schema count would suggest. Counting $ref occurrences
    // instead pins exactly what Strategy A changed.
    const text = JSON.stringify(s);
    expect((text.match(/"\$ref":"#\/\$defs\/point_ref"/g) ?? []).length).toBe(8);
    expect((text.match(/"\$ref":"#\/\$defs\/ghost"/g) ?? []).length).toBe(5);
    expect((text.match(/"\$ref":"#\/\$defs\/end_ref"/g) ?? []).length).toBe(2);
  });

  test("every call site keeps its own description", () => {
    const text = JSON.stringify(apiSchema());
    // move.to, move.pivot, arrange.at, flip.through and morph.pivot each say
    // something different about the same shape; that is the point of Strategy A.
    expect(text).toContain("Destination of the moving element's");
    expect(text).toContain("the point to turn or grow about");
    expect(text).toContain("Centre of the arrangement");
    expect(text).toContain("A point the mirror line passes through");
  });

  // documentSchema is `{ ...specSchema, properties: {…} }`, so $defs rides
  // the spread — but a pointer that resolved against specSchema's root must
  // still resolve against the document's. This is the trap; pin it.
  test("ajv resolves the pointers from both roots", () => {
    const ajv = new AjvCtor({ allErrors: true, strict: false });
    const viaSpec = ajv.compile(JSON.parse(JSON.stringify(specSchema)));
    const viaDoc = ajv.compile(JSON.parse(JSON.stringify(documentSchema)));
    const good = { commands: [{ move: { target: ["a"], to: { ref: "b", anchor: "tip" } } }] };
    const bad = { commands: [{ move: { target: ["a"], to: { nonsense: 1 } } }] };
    expect(viaSpec(good)).toBe(true);
    expect(viaDoc(good)).toBe(true);
    expect(viaSpec(bad)).toBe(false);
    expect(viaDoc(bad)).toBe(false);
  });

  test("a spec that validated before still validates", () => {
    const spec = {
      title: "t",
      elements: [{ id: "a", type: "point", at: { x: 10, y: 10 } }],
      commands: [
        { move: { target: ["a"], to: [500, 400], ghost: true } },
        { flip: { target: ["a"], through: { ref: "a", anchor: "left" } } },
      ],
    };
    expect(validateSpec(spec).errors).toEqual([]);
  });
});
