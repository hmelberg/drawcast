import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const schema = readFileSync(new URL("../src/spec/schema.ts", import.meta.url), "utf8");
const types = readFileSync(new URL("../src/spec/types.ts", import.meta.url), "utf8");

describe("the look variants are gone (C5, P §5)", () => {
  it("the schema no longer advertises look to the model", () => {
    expect(schema).not.toMatch(/halftone/);
    expect(schema).not.toMatch(/\blook:/);
  });
  it("SpecElement has no look field", () => {
    expect(types).not.toMatch(/look\?:/);
  });
});
