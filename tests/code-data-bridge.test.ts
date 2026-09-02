// The code → template data bridge: tokens in params ("{sim.y}") name script
// variables; the resolver harvests exactly those paths and substitutes plain
// JSON on the render clone. Pure pieces here (grammar, scan, substitution,
// cache key, harvest script, resolver with a fake runner, lint, check).
// Nothing loads WASM or touches the network.

import { describe, expect, test } from "vitest";
import {
  DATA_TOKEN_RE,
  MALFORMED_TOKEN_RE,
  isDataToken,
  parseDataToken,
  pathsByCodeId,
  scanDataTokens,
  substituteDataTokens,
} from "../src/code/tokens";
import { CODE_VERSION, codeCacheKey, decodeCodeResult, runCode, type CodeRunResult } from "../src/code/run";
import { DATA_CAP_NUMBERS, DATA_CAP_ROWS, dataHarvestScript, parseHarvest } from "../src/code/harvest";

describe("data tokens — grammar", () => {
  test("parses id.var and id.var.col; rejects dotless, spaced and malformed strings", () => {
    expect(parseDataToken("{sim.y}")).toEqual({ codeId: "sim", path: "y" });
    expect(parseDataToken("{gdp.df.country}")).toEqual({ codeId: "gdp", path: "df.country" });
    expect(parseDataToken("{Sim_1.frames_2}")).toEqual({ codeId: "Sim_1", path: "frames_2" });
    expect(parseDataToken("{name}")).toBeNull(); // an ask-store token, not ours
    expect(parseDataToken("GDP {sim.y}")).toBeNull(); // no interpolation
    expect(parseDataToken("{sim.}")).toBeNull();
    expect(parseDataToken("{sim..y}")).toBeNull();
    expect(parseDataToken("{9sim.y}")).toBeNull();
    expect(parseDataToken(42)).toBeNull();
    expect(isDataToken("{sim.y}")).toBe(true);
    expect(isDataToken("{name}")).toBe(false);
  });

  test("the malformed detector catches brace+dot strings the grammar rejects, and nothing else", () => {
    for (const s of ["{sim.}", "{.y}", "{sim..y}", "{9sim.y}"]) {
      expect(DATA_TOKEN_RE.test(s), s).toBe(false);
      expect(MALFORMED_TOKEN_RE.test(s), s).toBe(true);
    }
    expect(MALFORMED_TOKEN_RE.test("{name}")).toBe(false);
    expect(MALFORMED_TOKEN_RE.test("a sentence with a. dot")).toBe(false);
    expect(MALFORMED_TOKEN_RE.test("{sim.y}")).toBe(true); // it is ALSO a valid token — callers test DATA_TOKEN_RE first
  });
});

describe("data tokens — scan", () => {
  test("finds tokens at any depth with their JSON path, in document order", () => {
    const params = {
      title: "GDP",
      labels: "{gdp.df.country}",
      series: [{ name: "a", values: "{gdp.a}" }, { name: "b", values: ["{gdp.b1}", 3] }],
      box: { x: 1 },
      stage: 0,
    };
    expect(scanDataTokens(params)).toEqual([
      { codeId: "gdp", path: "df.country", at: ["labels"] },
      { codeId: "gdp", path: "a", at: ["series", 0, "values"] },
      { codeId: "gdp", path: "b1", at: ["series", 1, "values", 0] },
    ]);
    expect(scanDataTokens(undefined)).toEqual([]);
    expect(scanDataTokens({ speak: "{name}" })).toEqual([]);
  });

  test("pathsByCodeId groups, sorts and deduplicates", () => {
    const tokens = scanDataTokens({ a: "{s.y}", b: "{s.x}", c: "{s.y}", d: "{t.z}" });
    expect(pathsByCodeId(tokens)).toEqual({ s: ["x", "y"], t: ["z"] });
  });
});

describe("data tokens — substitute", () => {
  const params = {
    title: "GDP",
    labels: "{gdp.df.country}",
    values: "{gdp.frames}",
    series: [{ name: "a", values: "{gdp.a}" }],
    stage: 0,
  };

  test("replaces every resolvable token with its value and leaves the rest of params alone", () => {
    const { params: out, failures } = substituteDataTokens(params, (id, path) => ({ value: `${id}:${path}` }));
    expect(out).toEqual({
      title: "GDP",
      labels: "gdp:df.country",
      values: "gdp:frames",
      series: [{ name: "a", values: "gdp:a" }],
      stage: 0,
    });
    expect(failures).toEqual([]);
  });

  test("a failed token deletes the nearest enclosing property and reports the failure", () => {
    const { params: out, failures } = substituteDataTokens(params, (_id, path) =>
      path === "frames" ? { error: "no variable frames" } : { value: [1, 2] },
    );
    expect(out).toEqual({ title: "GDP", labels: [1, 2], series: [{ name: "a", values: [1, 2] }], stage: 0 });
    expect(failures).toEqual([{ token: { codeId: "gdp", path: "frames", at: ["values"] }, error: "no variable frames" }]);
  });

  test("a failed token that is an array ELEMENT deletes the property holding the array", () => {
    const { params: out } = substituteDataTokens({ values: ["{s.a}", 2], keep: 1 }, () => ({ error: "nope" }));
    expect(out).toEqual({ keep: 1 });
  });

  test("one array element resolves while its sibling fails → the whole array goes, no throw", () => {
    const { params: out, failures } = substituteDataTokens({ values: ["{a.x}", "{b.y}"], keep: 1 }, (id) =>
      id === "a" ? { value: 1 } : { error: "no such var" },
    );
    expect(out).toEqual({ keep: 1 });
    expect(failures).toEqual([{ token: { codeId: "b", path: "y", at: ["values", 1] }, error: "no such var" }]);
    const rev = substituteDataTokens({ values: ["{b.y}", "{a.x}"], keep: 1 }, (id) =>
      id === "a" ? { value: 1 } : { error: "no such var" },
    );
    expect(rev.params).toEqual({ keep: 1 });
  });

  test("never mutates its input", () => {
    const before = JSON.stringify(params);
    substituteDataTokens(params, () => ({ value: 1 }));
    expect(JSON.stringify(params)).toBe(before);
  });

  test("undefined params → empty object, no failures", () => {
    expect(substituteDataTokens(undefined, () => ({ value: 1 }))).toEqual({ params: {}, failures: [] });
  });
});

describe("code facade — paths ride the request and the cache key", () => {
  test("CODE_VERSION is 5 (envelope grew data/dataErrors)", () => {
    expect(CODE_VERSION).toBe(5);
  });

  test("the key differs by requested paths and is order-independent", () => {
    const none = codeCacheKey({ language: "python", code: "x = 1" });
    const a = codeCacheKey({ language: "python", code: "x = 1", paths: ["x"] });
    const ab = codeCacheKey({ language: "python", code: "x = 1", paths: ["x", "y"] });
    const ba = codeCacheKey({ language: "python", code: "x = 1", paths: ["y", "x"] });
    expect(a).not.toBe(none);
    expect(ab).not.toBe(a);
    expect(ab).toBe(ba);
    expect(codeCacheKey({ language: "python", code: "x = 1", paths: [] })).toBe(none);
  });

  test("an envelope with data decodes and round-trips; old envelopes without it still decode", async () => {
    const withData: CodeRunResult = { ok: true, stdout: "", stderr: "", figures: [], data: { y: [1, 2] }, dataErrors: { z: "no variable z" } };
    expect(decodeCodeResult(JSON.stringify(withData))).toEqual(withData);
    expect(decodeCodeResult(JSON.stringify({ ok: true, stdout: "", stderr: "", figures: [] }))?.data).toBeUndefined();
  });

  test("the runner receives the paths", async () => {
    let seen: string[] | undefined;
    const res = await runCode(
      { language: "python", code: "y = [1]", paths: ["y"] },
      {
        runner: async (req) => {
          seen = req.paths;
          return { ok: true, stdout: "", stderr: "", figures: [], data: { y: [1] } };
        },
        cacheGet: async () => null,
        cachePut: async () => undefined,
      },
    );
    expect(seen).toEqual(["y"]);
    expect(res.data).toEqual({ y: [1] });
  });
});

describe("python harvest script (contract only — the runtime is smoke-tested live)", () => {
  test("embeds the requested paths as a JSON literal and both caps", () => {
    const src = dataHarvestScript(["df.gdp", "y"]);
    expect(src).toContain('["df.gdp", "y"]');
    expect(src).toContain(String(DATA_CAP_NUMBERS));
    expect(src).toContain(String(DATA_CAP_ROWS));
    expect(src.trim().endsWith("__json.dumps(__out)")).toBe(true);
    expect(DATA_CAP_NUMBERS).toBe(5000);
    expect(DATA_CAP_ROWS).toBe(200);
  });

  test("parseHarvest guards the payload shape", () => {
    expect(parseHarvest(JSON.stringify({ data: { y: [1] }, errors: { z: "no variable z" } }))).toEqual({ data: { y: [1] }, errors: { z: "no variable z" } });
    expect(parseHarvest("not json")).toEqual({ data: {}, errors: {} });
    expect(parseHarvest(JSON.stringify([1, 2]))).toEqual({ data: {}, errors: {} });
    expect(parseHarvest(undefined)).toEqual({ data: {}, errors: {} });
  });
});

import { validateSpec } from "../src/spec/schema";
import { layoutSpec } from "../src/layout/layout";
import { flattenDrawables } from "../src/layout/model";
import type { Spec } from "../src/spec/types";

const codeEl = (extra: object, result?: CodeRunResult) => ({
  id: "sim",
  type: "code",
  language: "python",
  code: "y = [1, 2]",
  ...(result ? { code_result: JSON.stringify(result) } : {}),
  ...extra,
});

describe("code element — show: none", () => {
  test("validates; junk still rejected", () => {
    expect(validateSpec({ elements: [codeEl({ show: "none" })], commands: [] }).ok).toBe(true);
    expect(validateSpec({ elements: [codeEl({ show: "hidden" })], commands: [] }).ok).toBe(false);
  });

  test("draws nothing, mints no ids, and is absent from order", () => {
    const l = layoutSpec({ elements: [codeEl({ show: "none" }, { ok: true, stdout: "42", stderr: "", figures: [] })], commands: [] } as unknown as Spec);
    expect(l.drawables).toEqual([]);
    expect(l.order).toEqual([]);
  });

  test("harvest failures become layout warnings naming the token, in every mode", () => {
    const res: CodeRunResult = { ok: true, stdout: "", stderr: "", figures: [], data: {}, dataErrors: { "df.gdp": "no column, key or attribute gdp" } };
    for (const show of ["none", "code", "output"]) {
      const l = layoutSpec({ elements: [codeEl({ show }, res)], commands: [] } as unknown as Spec);
      expect(l.warnings.some((w) => w.includes("{sim.df.gdp}") && w.includes("no column")), show).toBe(true);
    }
  });

  test("show: code still mints its lines and stays in order", () => {
    const l = layoutSpec({ elements: [codeEl({ show: "code" })], commands: [] } as unknown as Spec);
    expect(l.order).toContain("sim");
    expect(l.order).toContain("sim_line_1");
    expect(flattenDrawables(l.drawables).some((d) => d.id === "sim_line_1")).toBe(true);
  });
});
