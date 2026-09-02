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

  test("never mutates its input", () => {
    const before = JSON.stringify(params);
    substituteDataTokens(params, () => ({ value: 1 }));
    expect(JSON.stringify(params)).toBe(before);
  });

  test("undefined params → empty object, no failures", () => {
    expect(substituteDataTokens(undefined, () => ({ value: 1 }))).toEqual({ params: {}, failures: [] });
  });
});
