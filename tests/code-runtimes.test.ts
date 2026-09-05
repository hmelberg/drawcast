// The multi-runtime seam: one declaration of the languages (languages.ts)
// that types, schema, cache key, dispatch, check and the prompt all read —
// so adding a runtime is one entry, and drift between them is a test failure.

import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { LANGUAGES, RUNTIME_LABEL, RUNTIME_VERSION, cacheTag, isLanguage } from "../src/code/languages";
import { specSchema, validateSpec } from "../src/spec/schema";
import { codeCacheKey, runCode, type CodeRunRequest, type CodeRunResult } from "../src/code/run";
import { codeExecutionErrors } from "../src/code/check";
import type { Spec } from "../src/spec/types";

const spec = (el: object): Spec =>
  ({ elements: [{ id: "c1", type: "code", ...el }], commands: [] }) as unknown as Spec;

describe("languages — one declaration", () => {
  test("the six languages, each with a label and a pinned version", () => {
    expect([...LANGUAGES]).toEqual(["python", "r", "brython", "micropython", "microdata", "basic"]);
    for (const l of LANGUAGES) {
      expect(RUNTIME_LABEL[l]).toBeTruthy();
      // Five are pinned to a runtime someone else versions; basic is ours,
      // versioned by a counter we bump when its rules change.
      expect(RUNTIME_VERSION[l]).toMatch(l === "basic" ? /^\d+$/ : /^\d+\.\d+\.\d+$/);
    }
    expect(isLanguage("r")).toBe(true);
    expect(isLanguage("cobol")).toBe(false);
  });

  test("the schema enum is exactly LANGUAGES", () => {
    const language = (specSchema as unknown as { properties: { elements: { items: { properties: { language: { enum: string[] } } } } } })
      .properties.elements.items.properties.language;
    expect(language.enum).toEqual([...LANGUAGES]);
    for (const l of LANGUAGES) expect(validateSpec(spec({ language: l, code: "1" })).ok).toBe(true);
  });

  test("cache tags pin each runtime's version; the dialects also pin the library snapshot", () => {
    expect(cacheTag("python")).toBe(`py${RUNTIME_VERSION.python}`);
    expect(cacheTag("r")).toBe(`r${RUNTIME_VERSION.r}`);
    expect(cacheTag("brython")).toMatch(new RegExp(`^bry${RUNTIME_VERSION.brython.replace(/\./g, "\\.")}\\+\\d{4}-\\d{2}-\\d{2}$`));
    expect(cacheTag("micropython")).toMatch(new RegExp(`^mpy${RUNTIME_VERSION.micropython.replace(/\./g, "\\.")}\\+\\d{4}-\\d{2}-\\d{2}$`));
    // microdata runs ON pyodide, so its tag pins BOTH the interpreter and the
    // vendored m2py snapshot — a new snapshot must miss the cache cleanly.
    expect(cacheTag("microdata")).toMatch(new RegExp(`^md${RUNTIME_VERSION.microdata.replace(/\./g, "\\.")}\\+\\d{4}-\\d{2}-\\d{2}[a-z]?$`));
    expect(RUNTIME_VERSION.microdata).toBe(RUNTIME_VERSION.python);
    const keys = new Set(LANGUAGES.map((l) => codeCacheKey({ language: l, code: "1" })));
    expect(keys.size).toBe(LANGUAGES.length);
  });
});

describe("authoring-time check runs every language", () => {
  test("R and dialect elements are executed and judged, not skipped", async () => {
    const seen: string[] = [];
    const run = async (req: CodeRunRequest): Promise<CodeRunResult> => {
      seen.push(req.language);
      return req.language === "r"
        ? { ok: false, stdout: "", stderr: "", figures: [], error: "Error in log(-1): boom" }
        : { ok: true, stdout: "", stderr: "", figures: [] };
    };
    const s = {
      elements: [
        { id: "a", type: "code", language: "python", code: "1" },
        { id: "b", type: "code", language: "r", code: "log(-1)" },
        { id: "c", type: "code", language: "brython", code: "1" },
      ],
      commands: [],
    } as unknown as Spec;
    const out = await codeExecutionErrors(s, run);
    expect(seen.sort()).toEqual(["brython", "python", "r"]);
    expect(out.errors.length).toBe(1);
    expect(out.errors[0]).toContain('"b"');
  });

  test("an unavailable runtime warns with the runtime's name", async () => {
    const run = async (): Promise<CodeRunResult> => ({ ok: false, stdout: "", stderr: "", figures: [], error: "offline", runtimeUnavailable: true });
    const out = await codeExecutionErrors(spec({ language: "r", code: "1" }), run);
    expect(out.errors).toEqual([]);
    expect(out.warnings[0]).toContain("the R runtime could not load");
  });
});

describe("dispatch — node has no browser, so every browser runtime degrades to an unavailable envelope", () => {
  test.each(LANGUAGES.filter((l) => l !== "basic"))("%s", async (language) => {
    const res = await runCode({ language, code: "1" }, { cacheGet: async () => null, cachePut: async () => {} });
    expect(res.ok).toBe(false);
    expect(res.runtimeUnavailable).toBe(true);
  });
  test("basic needs no browser at all — it runs right here", async () => {
    const res = await runCode({ language: "basic", code: "10 PRINT 1+1" }, { cacheGet: async () => null, cachePut: async () => {} });
    expect(res.ok).toBe(true);
    expect(res.stdout).toBe(" 2 ");
    expect(res.screen?.chars[0].trimEnd()).toBe(" 2");
  });
});

describe("prompt knows the runtimes it may emit", () => {
  const prompt = readFileSync(new URL("../src/llm/prompts/compiler-v1.md", import.meta.url), "utf8");
  test("every language is offered and no 'never emit' sentence remains", () => {
    for (const l of LANGUAGES) expect(prompt).toContain(`"language": "${l}"`);
    expect(prompt).not.toMatch(/never emit/i);
  });
});
