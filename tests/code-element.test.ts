// The CODE element: a Python/R script whose code and/or output is drawn on
// the canvas. Schema, the result envelope + cached facade, tier-2 layout
// (panel, per-line ids, output pane, error panel, placeholder), the resolver
// with an injected fake runner, hoisting, lint, and the generation-time
// execution check. Nothing here loads WASM or touches the network.

import { describe, expect, test } from "vitest";
import { validateSpec } from "../src/spec/schema";
import type { Spec } from "../src/spec/types";
import { CODE_VERSION, codeCacheKey, decodeCodeResult, runCode, type CodeRunResult } from "../src/code/run";

const spec = (el: object): Spec =>
  ({ elements: [{ id: "c1", type: "code", ...el }], commands: [] }) as unknown as Spec;

describe("code element — schema", () => {
  test("validates with language + code; rejects either missing", () => {
    expect(validateSpec(spec({ language: "python", code: "print(1)" })).ok).toBe(true);
    expect(validateSpec(spec({ language: "r", code: "1 + 1" })).ok).toBe(true);
    expect(validateSpec(spec({ language: "python" })).ok).toBe(false);
    expect(validateSpec(spec({ code: "print(1)" })).ok).toBe(false);
    expect(validateSpec(spec({ language: "cobol", code: "x" })).ok).toBe(false);
  });

  test("show, width, font_size and code_result are accepted; junk is not", () => {
    expect(validateSpec(spec({ language: "python", code: "print(1)", show: "split", width: 880, font_size: 17 })).ok).toBe(true);
    expect(validateSpec(spec({ language: "python", code: "print(1)", code_result: "{}" })).ok).toBe(true);
    expect(validateSpec(spec({ language: "python", code: "print(1)", show: "sideways" })).ok).toBe(false);
    expect(validateSpec(spec({ language: "python", code: "print(1)", nonsense: 1 })).ok).toBe(false);
  });
});

const OK: CodeRunResult = { ok: true, stdout: "42", stderr: "", figures: [{ href: "data:image/png;base64,AA", w: 640, h: 480 }] };

/** A facade wired to a fake runner and an in-memory cache. */
function runDeps(result: CodeRunResult) {
  const calls: string[] = [];
  const store = new Map<string, string>();
  return {
    calls,
    store,
    runner: async (req: { code: string }) => {
      calls.push(req.code);
      return result;
    },
    cacheGet: async (k: string) => store.get(k) ?? null,
    cachePut: async (k: string, v: string) => void store.set(k, v),
  };
}

describe("code facade — envelope and cache", () => {
  test("cache key pins version, language and code hash", () => {
    const a = codeCacheKey({ language: "python", code: "print(1)" });
    expect(a.startsWith(`c${CODE_VERSION}|py`)).toBe(true);
    expect(a).not.toBe(codeCacheKey({ language: "python", code: "print(2)" }));
  });

  test("decode round-trips the envelope and rejects junk", () => {
    expect(decodeCodeResult(JSON.stringify(OK))).toEqual(OK);
    expect(decodeCodeResult(undefined)).toBeNull();
    expect(decodeCodeResult("not json")).toBeNull();
    expect(decodeCodeResult('{"stdout": 3}')).toBeNull();
  });

  test("a successful run is cached; the second call never reaches the runner", async () => {
    const deps = runDeps(OK);
    expect(await runCode({ language: "python", code: "x" }, deps)).toEqual(OK);
    expect(await runCode({ language: "python", code: "x" }, deps)).toEqual(OK);
    expect(deps.calls.length).toBe(1);
  });

  test("failures are returned as envelopes and never cached", async () => {
    const bad: CodeRunResult = { ok: false, stdout: "", stderr: "boom", figures: [], error: "boom" };
    const deps = runDeps(bad);
    expect((await runCode({ language: "python", code: "x" }, deps)).ok).toBe(false);
    await runCode({ language: "python", code: "x" }, deps);
    expect(deps.calls.length).toBe(2);
    expect(deps.store.size).toBe(0);
  });

  test("a throwing runner degrades to an error envelope", async () => {
    const res = await runCode(
      { language: "python", code: "x" },
      { runner: async () => { throw new Error("no runtime"); }, cacheGet: async () => null, cachePut: async () => {} },
    );
    expect(res).toEqual({ ok: false, stdout: "", stderr: "", figures: [], error: "no runtime" });
  });
});
