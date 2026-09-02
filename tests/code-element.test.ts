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
import { CANVAS } from "../src/layout/canvas";
import { flattenDrawables, type ImageDrawable, type StrokeDrawable, type TextDrawable } from "../src/layout/model";
import { wrapCodeLine } from "../src/layout/code";
import { resolveCode } from "../src/render/code";
import { resolvedRenderSpec } from "../src/render/resolve";
import { HOISTED, hoistPortraitStrokes, restorePortraitStrokes, stripStrokesForModel } from "../src/llm/hoist";
import { itemsOf, parsePlaylistText } from "../src/playlist/playlist";
import { formatSpec } from "../src/spec/text";
import { lintCommands } from "../src/lint/lint";
import { codeExecutionErrors } from "../src/code/check";

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
    expect(res).toEqual({ ok: false, stdout: "", stderr: "", figures: [], error: "no runtime", runtimeUnavailable: false });
  });

  test("a throw tagged runtimeUnavailable propagates that flag into the envelope", async () => {
    const res = await runCode(
      { language: "python", code: "x" },
      {
        runner: async () => {
          const err = new Error("could not load the Python runtime (offline?)") as Error & { runtimeUnavailable: boolean };
          err.runtimeUnavailable = true;
          throw err;
        },
        cacheGet: async () => null,
        cachePut: async () => {},
      },
    );
    expect(res.runtimeUnavailable).toBe(true);
    expect(res.ok).toBe(false);
  });

  test("the R stub reports runtimeUnavailable (M2 not built yet, not a script bug)", async () => {
    const res = await runCode({ language: "r", code: "1 + 1" }, { cacheGet: async () => null, cachePut: async () => {} });
    expect(res.runtimeUnavailable).toBe(true);
    expect(res.ok).toBe(false);
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

  test("a figure taller than the canvas is scaled to fit inside the panel, aspect preserved", () => {
    const tall: CodeRunResult = { ok: true, stdout: "", stderr: "", figures: [{ href: "data:image/png;base64,AA", w: 600, h: 800 }] };
    // y centered on the canvas so "fits inside the panel" isn't tangled up
    // with an off-center default y pushing the panel's own top off-canvas.
    const s = codeSpec({ show: "output", y: CANVAS.h / 2 }, tall);
    const flat = flattenDrawables(layoutSpec(s, heuristicMeasure).drawables);
    const frame = flat.find((d) => d.id === "c1__frame") as StrokeDrawable;
    const img = flat.find((d): d is ImageDrawable => d.kind === "image")!;
    const rect = frame.shapeHint as { type: "rect"; x: number; y: number; w: number; h: number };
    expect(rect.type).toBe("rect");
    // the panel itself never exceeds the canvas-derived cap
    expect(rect.h).toBeLessThanOrEqual(CANVAS.h - 40);
    // the image never renders taller than the space left for it in the panel,
    // and its WIDTH shrank too (proof the scale-down preserves aspect rather
    // than just clipping the height): a full-bleed image would be 848 wide.
    expect(img.w).toBeLessThan(848);
    const [imgX, imgY] = img.pos;
    expect(imgY - img.h / 2).toBeGreaterThanOrEqual(rect.y - 0.01);
    expect(imgY + img.h / 2).toBeLessThanOrEqual(rect.y + rect.h + 0.01);
    expect(imgX - img.w / 2).toBeGreaterThanOrEqual(rect.x - 0.01);
    expect(imgX + img.w / 2).toBeLessThanOrEqual(rect.x + rect.w + 0.01);
    expect(img.w / img.h).toBeCloseTo(600 / 800, 2);
  });

  test("40 stdout lines get truncated with a '… more lines' marker; the panel stays within the canvas", () => {
    const many: CodeRunResult = {
      ok: true,
      stdout: Array.from({ length: 40 }, (_, i) => `line ${i}`).join("\n"),
      stderr: "",
      figures: [],
    };
    const s = codeSpec({ show: "output", y: CANVAS.h / 2 }, many);
    const layout = layoutSpec(s, heuristicMeasure);
    const flat = flattenDrawables(layout.drawables);
    const outTexts = flat.filter((d): d is TextDrawable => d.kind === "text" && d.id.startsWith("c1__out"));
    expect(outTexts.some((t) => t.text.includes("more lines"))).toBe(true);
    expect(outTexts.length).toBeLessThan(40); // some rows were actually dropped
    expect(layout.warnings.some((w) => w.includes("c1") && w.includes("truncated"))).toBe(true);
    const frame = flat.find((d) => d.id === "c1__frame") as StrokeDrawable;
    const rect = frame.shapeHint as { type: "rect"; x: number; y: number; w: number; h: number };
    expect(rect.y).toBeGreaterThanOrEqual(0);
    expect(rect.y + rect.h).toBeLessThanOrEqual(CANVAS.h);
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

  test("a previously-stamped FAILURE re-runs on the next pass instead of freezing", async () => {
    const bad: CodeRunResult = { ok: false, stdout: "", stderr: "boom", figures: [], error: "boom" };
    const s = codeSpec({}, bad); // pre-stamped with a failing envelope
    const deps = runDeps(OK);
    const res = await resolveCode(s, deps);
    expect(res).toEqual([{ id: "c1", ok: true, error: undefined }]);
    expect(deps.calls.length).toBe(1); // it DID re-run, not skip
    expect(decodeCodeResult(s.elements![0].code_result)).toEqual(OK);
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

describe("code element — lint", () => {
  test("warns on a long script, a narrow split, and multiple panels", () => {
    const long = Array.from({ length: 25 }, (_, i) => `x${i} = ${i}`).join("\n");
    expect(lintCommands(codeSpec({ code: long })).some((i) => i.rule === "code-use")).toBe(true);
    expect(lintCommands(codeSpec({ show: "split", width: 400 })).some((i) => i.rule === "code-use")).toBe(true);
    const two: Spec = { elements: [
      { id: "a", type: "code", language: "python", code: "print(1)" },
      { id: "b", type: "code", language: "python", code: "print(2)" },
    ], commands: [] } as unknown as Spec;
    expect(lintCommands(two).some((i) => i.rule === "code-use" && i.ids.length === 2)).toBe(true);
  });

  test("a short single panel lints clean", () => {
    expect(lintCommands(codeSpec({})).filter((i) => i.rule === "code-use")).toEqual([]);
  });
});

describe("code element — generation-time execution check", () => {
  test("a failing script becomes a validation error naming the element", async () => {
    const bad: CodeRunResult = { ok: false, stdout: "", stderr: "", figures: [], error: "NameError: name 'pd' is not defined" };
    const out = await codeExecutionErrors(codeSpec({}), async () => bad);
    expect(out.errors.length).toBe(1);
    expect(out.errors[0]).toContain('"c1"');
    expect(out.errors[0]).toContain("NameError");
  });

  test("clean runs add nothing; stderr chatter becomes a warning", async () => {
    expect((await codeExecutionErrors(codeSpec({}), async () => OK)).errors).toEqual([]);
    const noisy: CodeRunResult = { ok: true, stdout: "1", stderr: "FutureWarning: soon", figures: [] };
    const out = await codeExecutionErrors(codeSpec({}), async () => noisy);
    expect(out.errors).toEqual([]);
    expect(out.warnings[0]).toContain("FutureWarning");
  });

  test("an unavailable runtime never blocks generation", async () => {
    const out = await codeExecutionErrors(codeSpec({}), async () => { throw new Error("no browser"); });
    // No data tokens in this fixture's params -> the early-return branch,
    // which stamps unresolvedTokens: 0 (Task 8 fix round 2).
    expect(out).toEqual({ errors: [], warnings: [], unresolvedTokens: 0 });
  });

  test("a result flagged runtimeUnavailable becomes a WARNING, never an error", async () => {
    const unavailable: CodeRunResult = {
      ok: false,
      stdout: "",
      stderr: "",
      figures: [],
      error: "could not load the Python runtime (offline?)",
      runtimeUnavailable: true,
    };
    const out = await codeExecutionErrors(codeSpec({}), async () => unavailable);
    expect(out.errors).toEqual([]);
    expect(out.warnings.length).toBe(1);
    expect(out.warnings[0]).toContain('"c1"');
    expect(out.warnings[0]).toContain("not verified");
  });

  test("a throwing runner for one element does not abandon the rest", async () => {
    const two: Spec = {
      elements: [
        { id: "a", type: "code", language: "python", code: "print(1)" },
        { id: "b", type: "code", language: "python", code: "raise ValueError('bad')" },
      ],
      commands: [],
    } as unknown as Spec;
    const bad: CodeRunResult = { ok: false, stdout: "", stderr: "", figures: [], error: "ValueError: bad" };
    const out = await codeExecutionErrors(two, async (req) => {
      if (req.code.includes("raise")) return bad;
      throw new Error("offline"); // element "a"'s runner call fails
    });
    // "a" throws (skipped, never blocks) but "b" still gets checked for real.
    expect(out.errors.length).toBe(1);
    expect(out.errors[0]).toContain('"b"');
  });
});

describe("code element — multi-figure beats", () => {
  const TWO: CodeRunResult = {
    ok: true,
    stdout: "",
    stderr: "",
    figures: [
      { href: "data:image/png;base64,AA", w: 640, h: 480 },
      { href: "data:image/png;base64,BB", w: 640, h: 480 },
    ],
  };

  test("a run with several figures mints <id>_fig_N beats sharing one slot", () => {
    const l = layoutSpec(codeSpec({ show: "output", figures: 2 }, TWO), heuristicMeasure);
    const flat = flattenDrawables(l.drawables);
    const f1 = flat.find((d) => d.id === "c1_fig_1") as ImageDrawable;
    const f2 = flat.find((d) => d.id === "c1_fig_2") as ImageDrawable;
    expect(f1.kind).toBe("image");
    expect(f2.href).toBe("data:image/png;base64,BB");
    expect(f1.pos).toEqual(f2.pos); // one shared slot — slides, not a stack
    const out = flat.find((d) => d.id === "c1_out")!;
    expect(flattenDrawables([out]).some((d) => d.id.includes("_fig_") || d.id.includes("__fig"))).toBe(false);
  });

  test("declared figures promise beats before the script has run", () => {
    const l = layoutSpec(codeSpec({ figures: 3 }), heuristicMeasure);
    const ids = flattenDrawables(l.drawables).map((d) => d.id);
    expect(ids).toContain("c1_fig_1");
    expect(ids).toContain("c1_fig_3");
  });

  test("a single undeclared figure stays inside <id>_out (back-compat)", () => {
    const l = layoutSpec(codeSpec({}, OK), heuristicMeasure);
    const ids = flattenDrawables(l.drawables).map((d) => d.id);
    expect(ids).not.toContain("c1_fig_1");
    expect(ids).toContain("c1__fig0");
  });

  test("figures must be an integer >= 2", () => {
    expect(validateSpec(spec({ language: "python", code: "x", figures: 1 })).ok).toBe(false);
    expect(validateSpec(spec({ language: "python", code: "x", figures: 2.5 })).ok).toBe(false);
    expect(validateSpec(spec({ language: "python", code: "x", figures: 2 })).ok).toBe(true);
  });
});

describe("code element — table output", () => {
  const TBL: CodeRunResult = {
    ok: true,
    stdout: "",
    stderr: "",
    figures: [],
    tables: [{ columns: ["City", "Rain"], rows: [["Bergen", "2250"], ["Oslo", "763"]] }],
  };

  test("a harvested table renders header cells, data cells, and a header rule", () => {
    const l = layoutSpec(codeSpec({ show: "output" }, TBL), heuristicMeasure);
    const flat = flattenDrawables(l.drawables);
    const cells = flat.filter((d) => d.id.startsWith("c1__tbl0__"));
    const texts = cells.filter((d): d is TextDrawable => d.kind === "text").map((d) => d.text);
    expect(texts).toContain("City");
    expect(texts).toContain("Bergen");
    expect(texts).toContain("2250");
    expect(cells.some((d) => d.id === "c1__tbl0__tr1" && d.kind === "stroke")).toBe(true); // header underline
    // table cells live inside the output group, not as their own beats
    const ids = flat.map((d) => d.id);
    expect(ids).not.toContain("c1_tbl_1");
  });

  test("an old cached envelope without a tables field still lays out", () => {
    const noTables = { ok: true, stdout: "hi", stderr: "", figures: [] } as CodeRunResult;
    const l = layoutSpec(codeSpec({}, noTables), heuristicMeasure);
    expect(flattenDrawables(l.drawables).some((d) => d.id === "c1_out")).toBe(true);
  });

  test("a table beyond the row cap gets a 'more rows' note", () => {
    const many: CodeRunResult = {
      ok: true, stdout: "", stderr: "", figures: [],
      tables: [{ columns: ["n"], rows: Array.from({ length: 40 }, (_, i) => [String(i)]), truncated: 0 }],
    };
    const l = layoutSpec(codeSpec({ show: "output" }, many), heuristicMeasure);
    const texts = flattenDrawables(l.drawables).filter((d): d is TextDrawable => d.kind === "text").map((d) => d.text);
    expect(texts.some((t) => /more rows/.test(t))).toBe(true);
  });
});
