import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const schema = readFileSync(new URL("../src/spec/schema.ts", import.meta.url), "utf8");
const types = readFileSync(new URL("../src/spec/types.ts", import.meta.url), "utf8");

describe("the look variants are gone (C5, P §5)", () => {
  it("the schema no longer advertises look to the model", () => {
    expect(schema).not.toMatch(/halftone/);
    // `look: "screen"` is the one look that came back (picture regions); the old variants stay gone.
    // Cards' looks (paper, flat, outline — round 5 §3.2) are new, not the old variants: "outline" is not "line".
    expect(schema).not.toMatch(/\blook:\s*\{[^}]*\b(poster|line|halftone)\b/);
  });
  it("SpecElement's look is only \"screen\" (an image) or a cards look", () => {
    expect(types).toMatch(/look\?: "screen" \| "paper" \| "flat" \| "outline";/);
    expect(types).not.toMatch(/look\?: [^;]*"(poster|line|halftone)"/);
  });
});
