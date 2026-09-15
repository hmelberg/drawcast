import { describe, expect, test } from "vitest";
import { applyCodePatches } from "../src/render/sweep-run";
import type { SpecElement } from "../src/spec/types";

const els = [
  { id: "sim", type: "code", code: "a", code_result: "r0" },
  { id: "n", type: "node" },
] as unknown as SpecElement[];

describe("applyCodePatches", () => {
  test("replaces code and code_result of patched ids only; untouched list when empty", () => {
    const out = applyCodePatches(els, new Map([["sim", { code: "b", result: "r1", values: {} }]]));
    expect(out[0]).toMatchObject({ id: "sim", code: "b", code_result: "r1" });
    expect(out[1]).toBe(els[1]);
    expect(applyCodePatches(els, new Map())).toBe(els);
  });
});
