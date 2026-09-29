import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const schema = readFileSync(new URL("../src/spec/schema.ts", import.meta.url), "utf8");
const types = readFileSync(new URL("../src/spec/types.ts", import.meta.url), "utf8");

describe("the look variants are gone (C5, P §5)", () => {
  it("the schema no longer advertises look to the model", () => {
    expect(schema).not.toMatch(/halftone/);
    // `look: "screen"` is the one look that came back (picture regions); the old variants stay gone.
    expect(schema).not.toMatch(/\blook:\s*\{[^}]*(poster|line|halftone)/);
  });
  it("SpecElement's look is only \"screen\"", () => {
    expect(types).toMatch(/look\?: "screen";/);
    expect(types).not.toMatch(/look\?: [^;]*(poster|line|halftone)/);
  });
});
