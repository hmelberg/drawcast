// The CODE element: a Python/R script whose code and/or output is drawn on
// the canvas. Schema, the result envelope + cached facade, tier-2 layout
// (panel, per-line ids, output pane, error panel, placeholder), the resolver
// with an injected fake runner, hoisting, lint, and the generation-time
// execution check. Nothing here loads WASM or touches the network.

import { describe, expect, test } from "vitest";
import { validateSpec } from "../src/spec/schema";
import type { Spec } from "../src/spec/types";
import { CODE_VERSION, codeCacheKey, decodeCodeResult, runCode, type CodeRunResult } from "../src/code/run";
import { layoutSpec } from "../src/layout/layout";
import { heuristicMeasure } from "../src/layout/measure";
import { flattenDrawables, type ImageDrawable, type TextDrawable } from "../src/layout/model";
import { wrapCodeLine } from "../src/layout/code";
import { resolveCode } from "../src/render/code";
import { resolvedRenderSpec } from "../src/render/resolve";
import { HOISTED, hoistPortraitStrokes, restorePortraitStrokes, stripStrokesForModel } from "../src/llm/hoist";
import { itemsOf, parsePlaylistText } from "../src/playlist/playlist";
import { formatSpec } from "../src/spec/text";

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

const codeSpec = (el: object, result?: CodeRunResult): Spec =>
  spec({ language: "python", code: "import numpy as np\nprint(np.pi)", ...(result ? { code_result: JSON.stringify(result) } : {}), ...el });

const layoutIds = (s: Spec) => flattenDrawables(layoutSpec(s, heuristicMeasure).drawables).map((d) => d.id);

describe("code element — layout", () => {
  test("split mode mints per-line ids, an output group, and the panel", () => {
    const ids = layoutIds(codeSpec({ show: "split" }, OK));
    expect(ids).toContain("c1");
    expect(ids).toContain("c1_line_1");
    expect(ids).toContain("c1_line_2");
    expect(ids).toContain("c1_out");
    const line = flattenDrawables(layoutSpec(codeSpec({ show: "split" }, OK), heuristicMeasure).drawables)
      .find((d) => d.id === "c1_line_1") as TextDrawable;
    expect(line.kind).toBe("text");
    expect(line.font).toBe("mono");
    expect(line.anchor).toBe("start");
  });

  test("output mode draws no code lines; code mode draws no figures", () => {
    const outIds = layoutIds(codeSpec({ show: "output" }, OK));
    expect(outIds).not.toContain("c1_line_1");
    expect(outIds).toContain("c1_out");
    const codeIds = layoutIds(codeSpec({ show: "code" }, OK));
    expect(codeIds).toContain("c1_line_1");
  });

  test("stdout and figures land inside the output group, aspect preserved", () => {
    const l = layoutSpec(codeSpec({ show: "output", width: 600 }, OK), heuristicMeasure);
    const out = flattenDrawables(l.drawables).filter((d) => d.id.startsWith("c1__"));
    const img = out.find((d) => d.kind === "image") as ImageDrawable;
    expect(img.href).toBe("data:image/png;base64,AA");
    expect(img.h / img.w).toBeCloseTo(480 / 640, 2);
    expect(out.some((d) => d.kind === "text" && (d as TextDrawable).text.includes("42"))).toBe(true);
  });

  test("an unresolved element still mints <id>_out (placeholder), and a failed run shows the error", () => {
    expect(layoutIds(codeSpec({}))).toContain("c1_out");
    const failed = layoutSpec(codeSpec({}, { ok: false, stdout: "", stderr: "NameError: x", figures: [], error: "NameError: x" }), heuristicMeasure);
    const texts = flattenDrawables(failed.drawables).filter((d): d is TextDrawable => d.kind === "text");
    expect(texts.some((t) => t.text.includes("NameError"))).toBe(true);
  });

  test("wrapCodeLine wraps long lines with a hanging indent and preserves leading spaces", () => {
    expect(wrapCodeLine("short", 40)).toEqual(["short"]);
    const rows = wrapCodeLine("    value = alpha + beta + gamma + delta", 20);
    expect(rows.length).toBeGreaterThan(1);
    expect(rows[0].startsWith("    ")).toBe(true);
    expect(rows[1].startsWith("      ")).toBe(true);
    for (const r of rows) expect(r.length).toBeLessThanOrEqual(20);
  });
});

describe("code element — resolver", () => {
  test("stamps code_result from the runner; skips stamped elements", async () => {
    const s = codeSpec({});
    const deps = runDeps(OK);
    const res = await resolveCode(s, deps);
    expect(res).toEqual([{ id: "c1", ok: true, error: undefined }]);
    expect(JSON.parse(s.elements![0].code_result!)).toEqual(OK);
    await resolveCode(s, deps);
    expect(deps.calls.length).toBe(1); // second pass: already stamped
  });

  test("a failed run stamps the error envelope — layout will draw it", async () => {
    const s = codeSpec({});
    const bad: CodeRunResult = { ok: false, stdout: "", stderr: "SyntaxError", figures: [], error: "SyntaxError" };
    const res = await resolveCode(s, runDeps(bad));
    expect(res[0].ok).toBe(false);
    expect(decodeCodeResult(s.elements![0].code_result)).toEqual(bad);
  });

  test("resolvedRenderSpec keeps B11: the author's spec is never stamped", async () => {
    const s = codeSpec({});
    const copy = await resolvedRenderSpec(s, {
      resolvePortraits: async () => undefined,
      resolveSources: async () => undefined,
      resolveCode: async (c) => resolveCode(c, runDeps(OK)),
      contactEmail: "",
    });
    expect(s.elements![0].code_result).toBeUndefined();
    expect(copy.elements![0].code_result).toBeDefined();
  });
});

describe("code element — hoisting", () => {
  const doc = formatSpec(codeSpec({}, OK), "yaml");

  test("code_result is hoisted to the sentinel and restored by id", () => {
    const { text, blobs } = hoistPortraitStrokes(doc);
    expect(text).toContain(HOISTED);
    expect(text).not.toContain("data:image/png");
    const playlist = parsePlaylistText(text);
    restorePortraitStrokes(playlist, blobs);
    expect(itemsOf(playlist)[0].spec.elements![0].code_result).toBe(JSON.stringify(OK));
  });

  test("stripStrokesForModel drops code_result", () => {
    const stripped = stripStrokesForModel(codeSpec({}, OK));
    expect(stripped.elements![0].code_result).toBeUndefined();
  });
});
