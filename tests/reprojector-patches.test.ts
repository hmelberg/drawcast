import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
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

// The render closure is DOM-driven (src/render/index.ts mounts a figure), so
// it is pinned in source the way src/ui/* and src/export/* are.
describe("the render closure re-substitutes data tokens while a sweep is patched (source pins)", () => {
  const src = readFileSync("src/render/index.ts", "utf8");
  const from = src.indexOf("const rawLayoutFor =");
  const to = src.indexOf("const layoutFor =", from);

  test("rawLayoutFor reads the patched envelopes back into the AUTHORED params, guarded by codePatches.size > 0", () => {
    expect(from).toBeGreaterThan(-1);
    expect(to).toBeGreaterThan(from);
    const body = src.slice(from, to);
    // A "{id.var}" param is harvested from the script's OUTPUT: a sweep that
    // changes the output must change the param, or the number labelling a
    // swept line stands still while the line walks. The same reading the
    // tray's repaint() does — authored params, patched elements' code_result.
    expect(body).toMatch(/if \(codePatches\.size > 0 && scanDataTokens\(authored\.params\)\.length > 0\)/);
    expect(body).toMatch(/substituteDataTokens\(authored\.params,/);
    expect(body).toMatch(/decodeCodeResult\(/);
    // The caller's own params are explicit overrides and keep the last word.
    expect(body).toMatch(/effective = \{ \.\.\.sub, \.\.\.params \};/);
    expect(body).toMatch(/const split = splitVarOverrides\(effective\);/);
  });

  test("the idle precompute stops when the figure it was warming is gone", () => {
    expect(src).toMatch(/let disposed = false;/);
    expect(src).toMatch(/void precomputeSweeps\(plan, sweepRunner, \(\) => disposed\);/);
    // Both teardown paths set it: destroy() and update() (which re-renders).
    expect(src.match(/disposed = true;/g) ?? []).toHaveLength(2);
  });
});
