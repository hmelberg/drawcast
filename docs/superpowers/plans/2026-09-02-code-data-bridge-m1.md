# Code → template data bridge — M1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A code element's Python script feeds template params through `"{id.var}"` tokens, and two new data templates (`bar_chart`, `data_table`) draw that data as vector geometry that the existing `animate` verb tweens through a `stage` param.

**Architecture:** Params carry tokens; the render-time code resolver (already running on a clone of the spec) scans them, asks the runtime for exactly those paths, and substitutes plain JSON into the clone's params — layout, animate, the tray and export are untouched. The two templates live in a new `data` pack (YAML + JS layout body, compiled like every other pack), interpolate between adjacent stages themselves, and mint placeholder geometry from typed labels when the data is still a token so storyboard beats exist offline.

**Tech Stack:** TypeScript, Vite, vitest (node environment — no DOM, no WASM in tests), pyodide 314.0.2 from CDN at runtime, js-yaml packs, ajv.

**Spec:** `docs/superpowers/specs/2026-09-02-code-data-bridge-design.md` (M1 = spec §12 first bullet). Read it first; every task below cites the section it implements.

## Global Constraints

- Token grammar (spec §3.1): `^\{([A-Za-z][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)\}$`; a brace string without a dot is never a token.
- Harvest caps are ERRORS, never truncation: 5,000 numbers per path, 200 DataFrame rows (spec §4.3).
- Render never writes into the author's document (B11) — every resolver change works on the clone `resolvedRenderSpec` hands it.
- `src/layout/` must never import `src/code/run.ts` or `src/render/*` (IndexedDB would leak into the pure layout layer). `src/code/tokens.ts`, `src/code/harvest.ts` and `src/code/envelope.ts` are dependency-free and may be imported from anywhere.
- `src/scenes/packs/*.yaml` templates are plain JS bodies compiled with `new Function("params", "kit", "engines", body)` — no TypeScript, no imports, everything through `kit`.
- `src/examples.json` is 1-space-indented; APPEND textually, never re-serialize the whole file (a re-dump churns 16k lines).
- Tests: `npm test` runs vitest in node. Run the full suite before every commit; a red suite is never committed. Never pipe `vitest` through `grep` (the pipe hides the exit code).
- Commit after each task with the `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` trailer. Push to `origin main` at the end (Hans: "push when done").
- Do not touch `render/plan.ts`, `render/player.ts`, `render/index.ts`, `render/svg-backend.ts`, `export/video.ts`.

---

## File map

| File | Responsibility | Task |
|---|---|---|
| **new** `src/code/tokens.ts` | token grammar, scan, substitute (pure) | 1 |
| `src/code/envelope.ts`, `src/code/run.ts` | `paths` on the request, `data`/`dataErrors` on the envelope, cache key, `CODE_VERSION` 5 | 2 |
| **new** `src/code/harvest.ts` | the Python harvest script builder + caps + payload parser (pure) | 3 |
| `src/code/pyodide.ts` | runs the harvest after a successful run | 3 |
| `src/render/params.ts` | array indices in dot paths | 4 |
| `src/spec/types.ts`, `src/spec/schema.ts` | `show: "none"` | 5 |
| `src/layout/code.ts`, `src/layout/layout.ts` | `show: none` draws nothing; `dataErrors` become layout warnings | 5 |
| `src/render/code.ts` | scan → run with paths → substitute → skip rule | 6 |
| `src/spec/schema.ts`, `src/lint/lint.ts`, `src/spec/i18n.ts` | token lint, unused-source warning, translator exemption | 7 |
| `src/code/check.ts`, **new** `src/scenes/params-check.ts`, `src/llm/compile.ts` | authoring-time data errors + post-substitution schema validation | 8 |
| `src/layout/model.ts`, `src/scenes/kit.ts` | `COLORS.series`, `kit.plotArea`, kit v5 | 9 |
| **new** `src/scenes/packs/data.yaml`, `src/scenes/packs.ts`, `src/store.ts` | the `data` pack with `bar_chart`, registered and on by default | 10 |
| `src/scenes/packs/data.yaml` | `data_table` | 11 |
| `src/llm/prompts/compiler-v1.md`, `src/spec/schema.ts`, `src/llm/prompts/fewshots.json`, `src/examples.json` | model-facing surface | 12 |
| **new** `tests/code-data-bridge.test.ts`, **new** `tests/data-pack.test.ts`, plus edits to existing tests | | 1–12 |

---

### Task 1: Token grammar, scan and substitution (`src/code/tokens.ts`)

Spec §3.1, §5 steps 1 and 3.

**Files:**
- Create: `src/code/tokens.ts`
- Test: `tests/code-data-bridge.test.ts` (new)

**Interfaces:**
- Produces:
  ```ts
  export const DATA_TOKEN_RE: RegExp;
  export const MALFORMED_TOKEN_RE: RegExp; // "{a.}" / "{.b}" / "{a..b}": brace+dot but not a token
  export interface DataToken { codeId: string; path: string; at: (string | number)[] }
  export function parseDataToken(s: unknown): { codeId: string; path: string } | null;
  export function isDataToken(s: unknown): boolean;
  export function scanDataTokens(params: unknown): DataToken[];
  export function pathsByCodeId(tokens: DataToken[]): Record<string, string[]>;
  export type TokenLookup = (codeId: string, path: string) => { value: unknown } | { error: string };
  export interface SubstituteResult { params: Record<string, unknown>; failures: { token: DataToken; error: string }[] }
  export function substituteDataTokens(params: Record<string, unknown> | undefined, lookup: TokenLookup): SubstituteResult;
  ```

- [ ] **Step 1: Write the failing tests**

Create `tests/code-data-bridge.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/code-data-bridge.test.ts`
Expected: FAIL — `Cannot find module '../src/code/tokens'`.

- [ ] **Step 3: Implement `src/code/tokens.ts`**

```ts
// Data tokens: a template param whose value is exactly "{<codeId>.<path>}"
// names a variable (or a DataFrame column / dict key / attribute walk) that a
// code element's script leaves behind. The spec is the one place that says
// what crosses the bridge — scanning params is both the request list for the
// runtime and the substitution map for the resolver.
//
// Dependency-free on purpose: imported by the resolver (render/), the lint
// (spec/), the translator (spec/i18n.ts) and the authoring-time check.

/** "{sim.y}", "{gdp.df.country}" — id, dot, one or more path segments. */
export const DATA_TOKEN_RE = /^\{([A-Za-z][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)\}$/;

/** Brace + dot but not a token ("{sim.}", "{.y}", "{a..b}") — a typo the
 *  lint should name rather than let pass as prose. Matches valid tokens too;
 *  callers test DATA_TOKEN_RE first. */
export const MALFORMED_TOKEN_RE = /^\{[^{}\s]*\.[^{}\s]*\}$/;

export interface DataToken {
  codeId: string;
  path: string;
  /** Where in params the token sits: object keys and array indices, root first. */
  at: (string | number)[];
}

export function parseDataToken(s: unknown): { codeId: string; path: string } | null {
  if (typeof s !== "string") return null;
  const m = DATA_TOKEN_RE.exec(s);
  return m ? { codeId: m[1], path: m[2] } : null;
}

export function isDataToken(s: unknown): boolean {
  return parseDataToken(s) !== null;
}

/** Every token in params, depth-first in document order. */
export function scanDataTokens(params: unknown): DataToken[] {
  const out: DataToken[] = [];
  const walk = (v: unknown, at: (string | number)[]): void => {
    const tok = parseDataToken(v);
    if (tok) {
      out.push({ ...tok, at });
      return;
    }
    if (Array.isArray(v)) v.forEach((item, i) => walk(item, [...at, i]));
    else if (v && typeof v === "object") {
      for (const [k, item] of Object.entries(v as Record<string, unknown>)) walk(item, [...at, k]);
    }
  };
  walk(params, []);
  return out;
}

/** Paths per code element id — sorted and deduplicated, so the same set of
 *  tokens always yields the same request (and the same cache key). */
export function pathsByCodeId(tokens: DataToken[]): Record<string, string[]> {
  const sets = new Map<string, Set<string>>();
  for (const t of tokens) {
    if (!sets.has(t.codeId)) sets.set(t.codeId, new Set());
    sets.get(t.codeId)!.add(t.path);
  }
  const out: Record<string, string[]> = {};
  for (const [id, set] of sets) out[id] = [...set].sort();
  return out;
}

export type TokenLookup = (codeId: string, path: string) => { value: unknown } | { error: string };

export interface SubstituteResult {
  params: Record<string, unknown>;
  failures: { token: DataToken; error: string }[];
}

/**
 * A deep copy of params with every token replaced by its looked-up value. A
 * token the lookup cannot serve is REMOVED — the nearest enclosing object
 * property is deleted, so the template's own default applies — and reported.
 * Never mutates its input.
 */
export function substituteDataTokens(params: Record<string, unknown> | undefined, lookup: TokenLookup): SubstituteResult {
  const copy = (params ? JSON.parse(JSON.stringify(params)) : {}) as Record<string, unknown>;
  const failures: SubstituteResult["failures"] = [];
  // Delete deepest-first so an index removal never shifts a path we still
  // have to visit: tokens are scanned in document order, so reverse it.
  const tokens = scanDataTokens(copy).reverse();
  for (const token of tokens) {
    const r = lookup(token.codeId, token.path);
    if ("value" in r) {
      setAt(copy, token.at, r.value);
    } else {
      deleteNearestProperty(copy, token.at);
      failures.push({ token, error: r.error });
    }
  }
  failures.reverse();
  return { params: copy, failures };
}

function setAt(root: Record<string, unknown>, at: (string | number)[], value: unknown): void {
  let host: unknown = root;
  for (let i = 0; i < at.length - 1; i++) host = (host as Record<string | number, unknown>)[at[i]];
  (host as Record<string | number, unknown>)[at[at.length - 1]] = value;
}

/** Delete the property named by the LAST string segment of `at` (an array
 *  element's token takes its whole array with it). */
function deleteNearestProperty(root: Record<string, unknown>, at: (string | number)[]): void {
  let last = at.length - 1;
  while (last >= 0 && typeof at[last] !== "string") last--;
  if (last < 0) return;
  let host: unknown = root;
  for (let i = 0; i < last; i++) host = (host as Record<string | number, unknown>)[at[i]];
  delete (host as Record<string, unknown>)[at[last] as string];
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/code-data-bridge.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 5: Commit**

```bash
git add src/code/tokens.ts tests/code-data-bridge.test.ts
git commit -m "feat(code): data token grammar, scan and substitution (pure)"
```

---

### Task 2: `paths` on the request, `data` on the envelope, cache key

Spec §4.1, §4.2.

**Files:**
- Modify: `src/code/envelope.ts` (`CODE_VERSION`, `CodeRunResult`)
- Modify: `src/code/run.ts` (`CodeRunRequest.paths`, `codeCacheKey`)
- Test: `tests/code-data-bridge.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // envelope.ts
  export const CODE_VERSION = 5;
  export interface CodeRunResult { /* existing */ data?: Record<string, unknown>; dataErrors?: Record<string, string>; }
  // run.ts
  export interface CodeRunRequest { language; code; paths?: string[]; onStatus? }
  export function codeCacheKey(req: Pick<CodeRunRequest, "language" | "code" | "paths">): string;
  ```

- [ ] **Step 1: Write the failing tests** (append to `tests/code-data-bridge.test.ts`)

```ts
import { CODE_VERSION, codeCacheKey, decodeCodeResult, runCode, type CodeRunResult } from "../src/code/run";

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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/code-data-bridge.test.ts`
Expected: FAIL — `CODE_VERSION` is 4; the key does not change with paths; TypeScript complains about `paths`.

- [ ] **Step 3: Implement**

In `src/code/envelope.ts`:

```ts
/** Bump whenever the envelope shape or the capture pipeline changes. */
export const CODE_VERSION = 5; // v5: data/dataErrors (the code → template bridge)
```

and add to `CodeRunResult` after `tables?`:

```ts
  /** Harvested script variables keyed by the requested dotted path ("y",
   *  "df.gdp") — plain JSON: numbers, strings, lists, objects, and
   *  {columns, rows} for a DataFrame (see code/harvest.ts). */
  data?: Record<string, unknown>;
  /** Per-path harvest failures (missing name, not data, over a cap). The run
   *  itself succeeded; only these paths could not be served. */
  dataErrors?: Record<string, string>;
```

In `src/code/run.ts`, extend the request and the key:

```ts
export interface CodeRunRequest {
  language: "python" | "r";
  code: string;
  /** Dotted paths to harvest after the run ("y", "df.gdp"). Empty/absent = no harvest. */
  paths?: string[];
  onStatus?: (phase: "loading" | "running", detail: string) => void;
}
```

```ts
export function codeCacheKey(req: Pick<CodeRunRequest, "language" | "code" | "paths">): string {
  const tag = req.language === "python" ? `py${PYODIDE_VERSION}` : "r0";
  // The code length rides along with the hash to kill hash-collision risk
  // (two different scripts landing on the same 32-bit FNV-1a digest).
  // Requested paths are part of the key: a spec that adds a reference re-runs
  // once; a scrub or animate tick never does. Sorted, so order can't miss.
  const paths = [...(req.paths ?? [])].sort().join(",");
  return `c${CODE_VERSION}|${tag}|${hash(req.code)}|${req.code.length}|${hash(paths)}`;
}
```

- [ ] **Step 4: Run the whole suite**

Run: `npm test`
Expected: PASS. (`tests/code-element.test.ts` pins `startsWith("c${CODE_VERSION}|py")` — still true.)

- [ ] **Step 5: Commit**

```bash
git add src/code/envelope.ts src/code/run.ts tests/code-data-bridge.test.ts
git commit -m "feat(code): paths on the run request, data/dataErrors on the envelope, CODE_VERSION 5"
```

---

### Task 3: Python harvest (`src/code/harvest.ts` + `pyodide.ts`)

Spec §4.3.

**Files:**
- Create: `src/code/harvest.ts`
- Modify: `src/code/pyodide.ts` (`runOne`, after the run and before the figure harvests)
- Test: `tests/code-data-bridge.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export const DATA_CAP_NUMBERS = 5000;
  export const DATA_CAP_ROWS = 200;
  export interface HarvestPayload { data: Record<string, unknown>; errors: Record<string, string> }
  export function dataHarvestScript(paths: string[]): string;   // Python source; evaluates to a JSON string
  export function parseHarvest(raw: unknown): HarvestPayload;   // junk → { data: {}, errors: {} }
  ```

- [ ] **Step 1: Write the failing tests** (append)

```ts
import { DATA_CAP_NUMBERS, DATA_CAP_ROWS, dataHarvestScript, parseHarvest } from "../src/code/harvest";

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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/code-data-bridge.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/code/harvest.ts`**

```ts
// The Python side of the data bridge: after a run, resolve each requested
// dotted path in the script's namespace and convert it to plain JSON. Runs
// inside pyodide (the wrapper's __g namespace); this module only BUILDS the
// script and parses its result, so it stays dependency-free and node-testable.
//
// Conversion (spec §4.3): DataFrame → {columns, rows} with numbers kept as
// numbers and NaN/None as null; a column, Series, ndarray, list, tuple or
// range → list; dict → object; scalars as they are; anything else is an
// error naming the path. Caps are ERRORS, never truncation — a chart must not
// quietly lie about its data.

export const DATA_CAP_NUMBERS = 5000;
export const DATA_CAP_ROWS = 200;

export interface HarvestPayload {
  data: Record<string, unknown>;
  errors: Record<string, string>;
}

export function dataHarvestScript(paths: string[]): string {
  return `
import json as __json, math as __math
__paths = ${JSON.stringify(paths)}
__CAP_N = ${DATA_CAP_NUMBERS}
__CAP_ROWS = ${DATA_CAP_ROWS}
__out = {"data": {}, "errors": {}}

def __is_df(o):
    return type(o).__name__ == "DataFrame"

def __is_series(o):
    return type(o).__name__ == "Series"

def __scalar(v):
    if v is None:
        return None
    if isinstance(v, bool):
        return v
    if isinstance(v, (int, float)):
        f = float(v)
        return None if (__math.isnan(f) or __math.isinf(f)) else v
    if hasattr(v, "item"):
        try:
            return __scalar(v.item())
        except Exception:
            pass
    if isinstance(v, str):
        return v
    return str(v)

def __count(v):
    if isinstance(v, (list, tuple)):
        return sum(__count(x) for x in v)
    if isinstance(v, dict):
        if "rows" in v and "columns" in v and isinstance(v["rows"], list):
            return len(v["rows"]) * max(1, len(v["columns"]))
        return sum(__count(x) for x in v.values())
    return 1

def __convert(v, path):
    if __is_df(v):
        n = len(v.index)
        if n > __CAP_ROWS:
            raise ValueError("%d rows, the cap is %d — aggregate or sample in the script" % (n, __CAP_ROWS))
        cols = [str(c) for c in v.columns]
        rows = [[__scalar(x) for x in r] for r in v.itertuples(index=False, name=None)]
        return {"columns": cols, "rows": rows}
    if __is_series(v) or hasattr(v, "tolist"):
        v = v.tolist()
    if isinstance(v, range):
        v = list(v)
    if isinstance(v, (list, tuple)):
        out = [__convert(x, path) for x in v]
        return out
    if isinstance(v, dict):
        return {str(k): __convert(x, path) for k, x in v.items()}
    if v is None or isinstance(v, (bool, int, float, str)):
        return __scalar(v)
    if hasattr(v, "item"):
        return __scalar(v)
    raise TypeError("%s is not data (a number, string, list, dict, Series or DataFrame)" % type(v).__name__)

for __p in __paths:
    try:
        __segs = __p.split(".")
        if __segs[0] not in __g:
            raise NameError("no variable %s" % __segs[0])
        __obj = __g[__segs[0]]
        for __s in __segs[1:]:
            if __is_df(__obj) and __s in __obj.columns:
                __obj = __obj[__s]
            elif isinstance(__obj, dict) and __s in __obj:
                __obj = __obj[__s]
            elif hasattr(__obj, __s):
                __obj = getattr(__obj, __s)
            else:
                raise KeyError("no column, key or attribute %s" % __s)
        __val = __convert(__obj, __p)
        __n = __count(__val)
        if __n > __CAP_N:
            raise ValueError("%d values, the cap is %d — downsample or aggregate in the script" % (__n, __CAP_N))
        __out["data"][__p] = __val
    except Exception as __e:
        __out["errors"][__p] = "%s" % __e
__json.dumps(__out)
`;
}

export function parseHarvest(raw: unknown): HarvestPayload {
  const empty: HarvestPayload = { data: {}, errors: {} };
  if (typeof raw !== "string") return empty;
  try {
    const p = JSON.parse(raw) as { data?: unknown; errors?: unknown };
    if (typeof p !== "object" || p === null || Array.isArray(p)) return empty;
    const data = p.data && typeof p.data === "object" && !Array.isArray(p.data) ? (p.data as Record<string, unknown>) : {};
    const errors: Record<string, string> = {};
    if (p.errors && typeof p.errors === "object" && !Array.isArray(p.errors)) {
      for (const [k, v] of Object.entries(p.errors as Record<string, unknown>)) errors[k] = String(v);
    }
    return { data, errors };
  } catch {
    return empty;
  }
}
```

- [ ] **Step 4: Wire it into `src/code/pyodide.ts`**

Add the import at the top (beside the existing `./run` import):

```ts
import { dataHarvestScript, parseHarvest } from "./harvest";
```

In `runOne`, immediately after the retry loop ends (the line `let figures: CodeFigure[] = [];`), insert:

```ts
  // Data harvest for the template bridge: only the paths the spec referenced,
  // only after a clean run. A failed harvest is an error PER PATH (the
  // resolver drops that param and the template default applies) — never a
  // lost run.
  let data: Record<string, unknown> | undefined;
  let dataErrors: Record<string, string> | undefined;
  const paths = req.paths ?? [];
  if (!error && paths.length > 0) {
    status("running", "Reading data…");
    try {
      const harvested = parseHarvest(await py.runPythonAsync(dataHarvestScript(paths)));
      data = harvested.data;
      dataErrors = harvested.errors;
    } catch (err) {
      dataErrors = Object.fromEntries(paths.map((p) => [p, `harvest failed: ${(err as Error).message}`]));
    }
  }
```

and extend the return at the end of `runOne`:

```ts
  return {
    ok: !error,
    stdout: stdout.replace(/\n$/, ""),
    stderr: stderr.replace(/\n$/, ""),
    figures,
    tables,
    error,
    ...(data !== undefined ? { data } : {}),
    ...(dataErrors !== undefined && Object.keys(dataErrors).length > 0 ? { dataErrors } : {}),
  };
```

- [ ] **Step 5: Run the tests and the type check**

Run: `npx vitest run tests/code-data-bridge.test.ts && npx tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 6: Live smoke (record the result in the commit message)**

Run `npm run dev`, open the app, and in the browser console:

```js
const { runPython } = await import("/src/code/pyodide.ts");
const r = await runPython({ language: "python", code: "import pandas as pd, numpy as np\ndf = pd.DataFrame({'c': ['a','b'], 'v': [1.5, 2]})\ny = np.arange(3)\nbig = list(range(6000))\nd = {'k': (1, 2)}\nobj = object()", paths: ["df", "df.v", "y", "big", "d.k", "nope", "obj", "d.missing"] });
console.log(JSON.stringify(r.data), JSON.stringify(r.dataErrors));
```

Expected: `data` = `{"df":{"columns":["c","v"],"rows":[["a",1.5],["b",2]]},"df.v":[1.5,2],"y":[0,1,2],"d.k":[1,2]}`; `dataErrors` names `big` (6000 values, cap 5000), `nope` (no variable nope), `obj` (object is not data), `d.missing` (no column, key or attribute missing). If any differs, fix the Python in `dataHarvestScript` and re-run.

- [ ] **Step 7: Commit**

```bash
git add src/code/harvest.ts src/code/pyodide.ts tests/code-data-bridge.test.ts
git commit -m "feat(code): harvest referenced script variables as JSON after a run (caps are errors)

Live-smoked in the browser: DataFrame, column, ndarray, dict walk, over-cap,
missing name, non-data object, missing key — see harvest.ts for the rules."
```

---

### Task 4: Array indices in animate paths (`src/render/params.ts`)

Spec §6.6 (first fix).

**Files:**
- Modify: `src/render/params.ts` (`readParam`, `withOverrides`)
- Test: `tests/params.test.ts`

- [ ] **Step 1: Write the failing tests** (append to the `readParam` and `withOverrides` describes in `tests/params.test.ts`)

```ts
  test("array indices are path segments: values.2 reads the third entry, nested too", () => {
    expect(readParam({ values: [3, 5, 8] }, "values.2")).toBe(8);
    expect(readParam({ values: [[3, 5], [4, 9]] }, "values.1.0")).toBe(4);
    expect(readParam({ series: [{ values: [1, 2] }] }, "series.0.values.1")).toBe(2);
    expect(readParam({ values: [3, 5] }, "values.7")).toBeNull();
    expect(readParam({ values: [3, 5] }, "values.x")).toBeNull();
  });
```

```ts
  test("array indices are overridable without mutating the array", () => {
    const base = { values: [3, 5, 8], series: [{ values: [1, 2] }] };
    const out = withOverrides(base, { "values.2": 40, "series.0.values.1": 9 });
    expect(out).toEqual({ values: [3, 5, 40], series: [{ values: [1, 9] }] });
    expect(base.values).toEqual([3, 5, 8]);
    expect(base.series[0].values).toEqual([1, 2]);
  });
  test("a non-integer segment into an array is a collision: the original wins; a missing path never creates an array", () => {
    expect(withOverrides({ values: [3, 5] }, { "values.x": 1 })).toEqual({ values: [3, 5] });
    expect(withOverrides({}, { "values.0": 1 })).toEqual({ values: { "0": 1 } });
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/params.test.ts`
Expected: FAIL — `readParam` returns null for `values.2`; `withOverrides` leaves `values` unchanged.

- [ ] **Step 3: Implement**

Replace `readParam` and the walking core of `withOverrides` in `src/render/params.ts`:

```ts
/** An array index segment ("0", "12") — arrays are records with integer keys. */
function indexOf(seg: string): number | null {
  return /^\d+$/.test(seg) ? Number(seg) : null;
}

/** The numeric value at a dot path, or null when missing/non-numeric. Array
 *  segments are integer indices (values.2, series.0.values.1). */
export function readParam(params: Record<string, unknown> | undefined, path: string): number | null {
  let cur: unknown = params;
  for (const seg of path.split(".")) {
    if (Array.isArray(cur)) {
      const i = indexOf(seg);
      if (i === null) return null;
      cur = cur[i];
    } else if (isRecord(cur)) {
      cur = cur[seg];
    } else {
      return null;
    }
  }
  return typeof cur === "number" && Number.isFinite(cur) ? cur : null;
}
```

```ts
export function withOverrides(
  params: Record<string, unknown> | undefined,
  overrides: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...(params ?? {}) };
  for (const [path, value] of Object.entries(overrides)) {
    const segs = path.split(".");
    let host: Record<string, unknown> | unknown[] = out;
    let ok = true;
    for (let i = 0; i < segs.length - 1; i++) {
      const key: string | number = Array.isArray(host) ? (indexOf(segs[i]) ?? -1) : segs[i];
      if (key === -1) { ok = false; break; }
      const existing = (host as Record<string | number, unknown>)[key];
      let next: Record<string, unknown> | unknown[];
      if (existing === undefined) next = {};
      else if (Array.isArray(existing)) next = [...existing];
      else if (isRecord(existing)) next = { ...existing };
      else { ok = false; break; }
      (host as Record<string | number, unknown>)[key] = next;
      host = next;
    }
    if (!ok) continue;
    const last = segs[segs.length - 1];
    if (Array.isArray(host)) {
      const i = indexOf(last);
      if (i !== null) host[i] = value;
    } else {
      host[last] = value;
    }
  }
  return out;
}
```

- [ ] **Step 4: Run the suite**

Run: `npm test`
Expected: PASS (existing `params.test.ts`, `animate.test.ts`, `var-params.test.ts` unchanged in behaviour).

- [ ] **Step 5: Commit**

```bash
git add src/render/params.ts tests/params.test.ts
git commit -m "feat(animate): array indices in param dot paths (values.2, series.0.values.1)"
```

---

### Task 5: `show: none` — the data-only code element

Spec §3.2, §5 step 3 (warnings), §10 (no decode on a tween tick).

**Files:**
- Modify: `src/spec/types.ts:136` (`show` union)
- Modify: `src/spec/schema.ts:194-199` (`show` enum + description)
- Modify: `src/layout/code.ts` (`codeDrawables` head)
- Modify: `src/layout/layout.ts:66-68` (order)
- Modify: `docs/superpowers/specs/2026-09-02-code-data-bridge-design.md` §14 (one line)
- Test: `tests/code-data-bridge.test.ts`

- [ ] **Step 1: Write the failing tests** (append)

```ts
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/code-data-bridge.test.ts`
Expected: FAIL — `show: "none"` rejected by the schema.

- [ ] **Step 3: Implement**

`src/spec/types.ts` line 136:

```ts
  /** code: what the panel shows — output (default), split (code left, output right), code (the script alone), or none (nothing drawn: the element only feeds template params through "{id.var}" tokens). */
  show?: "output" | "split" | "code" | "none";
```

`src/spec/schema.ts` lines 194–199:

```ts
    show: {
      type: "string",
      enum: ["output", "split", "code", "none"],
      description:
        "code: panel layout — output (just the result; the default), split (code pane left, output pane right; give the element width ≥ 700), code (the script alone), none (draws NOTHING — the script only feeds template params through \"{id.var}\" tokens).",
    },
```

`src/layout/code.ts` — at the top of `codeDrawables`, replace the first lines through `const result = decodeCodeResult(el.code_result);` with:

```ts
export function codeDrawables(el: SpecElement, ctx: CodeCtx): Drawable[] {
  const show = el.show ?? "output";
  const result = decodeCodeResult(el.code_result);
  // Harvest failures (a "{sim.df.gdp}" the script could not serve) reach the
  // lint chip through here: the resolver stamped them on the envelope, and
  // this is the one place resolve-time trouble becomes a LayoutResult warning.
  for (const [path, msg] of Object.entries(result?.dataErrors ?? {})) {
    ctx.warnings.push(`code "${el.id}": {${el.id}.${path}} — ${msg}`);
  }
  // A pure data source: nothing drawn, no ids, no anchors — and no PNG string
  // parsed on every animate tick (this function re-runs per frame).
  if (show === "none") return [];
  const w = el.width ?? 880;
```

(keep the rest of the function as it is; `show` and `result` are now declared above.)

`src/layout/layout.ts` lines 66–68 — skip the data-only element in order:

```ts
    for (const el of spec.elements) {
      // A show:none code element draws nothing (it only feeds params), so it
      // must not become a command-addressable id or an implicit final draw.
      if (el.type === "code" && el.show === "none") continue;
      if (!order.includes(el.id)) order.push(el.id);
    }
```

Spec amendment — in `docs/superpowers/specs/2026-09-02-code-data-bridge-design.md` §14, change the row `| src/layout/code.ts | show: none early return |` to `| src/layout/code.ts, src/layout/layout.ts | show: none: early return + dataErrors → warnings; the element id is left out of order |` and remove `layout/layout.ts` from the "Not touched" line.

- [ ] **Step 4: Run the suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/spec/types.ts src/spec/schema.ts src/layout/code.ts src/layout/layout.ts docs/superpowers/specs/2026-09-02-code-data-bridge-design.md tests/code-data-bridge.test.ts
git commit -m "feat(code): show: none — a data-only code element; harvest failures surface as layout warnings"
```

---

### Task 6: The resolver — scan, run with paths, substitute, skip rule

Spec §5.

**Files:**
- Modify: `src/render/code.ts`
- Test: `tests/code-data-bridge.test.ts`

**Interfaces:**
- Consumes: `scanDataTokens`, `pathsByCodeId`, `substituteDataTokens` (Task 1); `CodeRunRequest.paths`, `CodeRunResult.data/dataErrors` (Task 2).
- Produces:
  ```ts
  export interface CodeResolution { id: string; ok: boolean; error?: string; /** true when the skip rule applied: hidden pane and no token names it */ skipped?: boolean }
  export async function resolveCode(spec: Spec, deps: CodeRunDeps = {}): Promise<CodeResolution[]>;
  ```

- [ ] **Step 1: Write the failing tests** (append)

```ts
import { resolveCode } from "../src/render/code";
import { resolvedRenderSpec } from "../src/render/resolve";

/** A facade wired to a fake runner and an in-memory cache; records requests. */
function fakeRun(result: CodeRunResult | ((req: { code: string; paths?: string[] }) => CodeRunResult)) {
  const calls: { code: string; paths?: string[] }[] = [];
  const store = new Map<string, string>();
  return {
    calls,
    runner: async (req: { code: string; paths?: string[] }) => {
      calls.push({ code: req.code, paths: req.paths });
      return typeof result === "function" ? result(req) : result;
    },
    cacheGet: async (k: string) => store.get(k) ?? null,
    cachePut: async (k: string, v: string) => void store.set(k, v),
  };
}

const bridged = (show = "none"): Spec =>
  ({
    template: "bar_chart",
    params: { labels: ["a", "b"], values: "{sim.frames}", title: "T", series: [{ name: "s", values: "{sim.s}" }] },
    elements: [codeEl({ show })],
    commands: [],
  }) as unknown as Spec;

describe("code element — resolver substitutes tokens on the clone", () => {
  test("runs with exactly the referenced paths, sorted, and substitutes their values", async () => {
    const deps = fakeRun({ ok: true, stdout: "", stderr: "", figures: [], data: { frames: [[1, 2], [3, 4]], s: [5, 6] } });
    const s = bridged();
    const res = await resolveCode(s, deps);
    expect(deps.calls).toEqual([{ code: "y = [1, 2]", paths: ["frames", "s"] }]);
    expect(res).toEqual([{ id: "sim", ok: true, error: undefined }]);
    expect(s.params).toEqual({ labels: ["a", "b"], values: [[1, 2], [3, 4]], title: "T", series: [{ name: "s", values: [5, 6] }] });
  });

  test("a path the harvest could not serve drops that param; the envelope keeps the reason for the layout warning", async () => {
    const deps = fakeRun({ ok: true, stdout: "", stderr: "", figures: [], data: { s: [5] }, dataErrors: { frames: "no variable frames" } });
    const s = bridged();
    await resolveCode(s, deps);
    expect(s.params).toEqual({ labels: ["a", "b"], title: "T", series: [{ name: "s", values: [5] }] });
    expect(decodeCodeResult(s.elements![0].code_result)?.dataErrors).toEqual({ frames: "no variable frames" });
  });

  test("a failed run drops every token of that element and stamps the failure", async () => {
    const deps = fakeRun({ ok: false, stdout: "", stderr: "boom", figures: [], error: "boom" });
    const s = bridged();
    const res = await resolveCode(s, deps);
    expect(res[0].ok).toBe(false);
    expect(s.params).toEqual({ labels: ["a", "b"], title: "T", series: [{ name: "s" }] });
  });

  test("a token naming a non-code id is dropped and reported in the failures of no element (lint catches it earlier)", async () => {
    const deps = fakeRun({ ok: true, stdout: "", stderr: "", figures: [], data: {} });
    const s = { ...bridged(), params: { values: "{ghost.y}", title: "T" } } as unknown as Spec;
    await resolveCode(s, deps);
    expect(s.params).toEqual({ title: "T" });
    expect(deps.calls).toEqual([]); // sim has no tokens and a hidden pane: skipped
  });

  test("skip rule: a hidden pane with no token never runs; a visible pane always runs; a hidden pane with a token runs", async () => {
    for (const [show, tokens, runs] of [
      ["none", false, 0],
      ["code", false, 0],
      ["output", false, 1],
      ["split", false, 1],
      ["none", true, 1],
      ["code", true, 1],
    ] as const) {
      const deps = fakeRun({ ok: true, stdout: "", stderr: "", figures: [], data: { y: [1] } });
      const s = { template: "bar_chart", params: tokens ? { values: "{sim.y}" } : { values: [1] }, elements: [codeEl({ show })], commands: [] } as unknown as Spec;
      const res = await resolveCode(s, deps);
      expect(deps.calls.length, `${show} tokens=${tokens}`).toBe(runs);
      if (runs === 0) expect(res).toEqual([{ id: "sim", ok: true, skipped: true }]);
    }
  });

  test("a stamped envelope is reused only when it covers every requested path", async () => {
    const stampedNoData: CodeRunResult = { ok: true, stdout: "", stderr: "", figures: [] };
    const s = { ...bridged(), elements: [codeEl({ show: "none" }, stampedNoData)] } as unknown as Spec;
    const deps = fakeRun({ ok: true, stdout: "", stderr: "", figures: [], data: { frames: [[1]], s: [2] } });
    await resolveCode(s, deps);
    expect(deps.calls.length).toBe(1); // re-ran: the stamp had no data for the paths
    await resolveCode(s, deps);
    expect(deps.calls.length).toBe(1); // now covered: reused
  });

  test("B11 through resolvedRenderSpec: the author's params keep their tokens", async () => {
    const doc = bridged();
    const before = JSON.stringify(doc);
    const copy = await resolvedRenderSpec(doc, {
      resolvePortraits: async () => undefined,
      resolveSources: async () => undefined,
      resolveCode: async (c) => resolveCode(c, fakeRun({ ok: true, stdout: "", stderr: "", figures: [], data: { frames: [[1, 2]], s: [3] } })),
      contactEmail: "",
    });
    expect(JSON.stringify(doc)).toBe(before);
    expect(copy.params!.values).toEqual([[1, 2]]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/code-data-bridge.test.ts`
Expected: FAIL — the runner is called without `paths`; params keep their tokens.

- [ ] **Step 3: Implement — replace `src/render/code.ts` wholesale**

```ts
// Ensure-phase execution for CODE elements — the source/portrait contract:
// runs BEFORE layout on render's clone (B11), stamps el.code_result, degrades
// to an error envelope the layout draws as an error panel, never throws. The
// heavy runtime loads lazily inside code/run.ts, so a spec without a code
// element costs nothing.
//
// The data bridge lives here too: params may name script variables with
// "{id.var}" tokens. This resolver (1) scans them, (2) runs each script with
// exactly its referenced paths, (3) substitutes the harvested values into the
// clone's params — and applies the skip rule: a script whose output pane is
// hidden and whose id no token names is never executed (its lines are text).

import { decodeCodeResult, runCode, type CodeRunDeps, type CodeRunResult } from "../code/run";
import { pathsByCodeId, scanDataTokens, substituteDataTokens } from "../code/tokens";
import type { Spec, SpecElement } from "../spec/types";

export interface CodeResolution {
  id: string;
  ok: boolean;
  error?: string;
  /** The skip rule applied: hidden pane, no token names this element. */
  skipped?: boolean;
}

/** A stamped envelope serves a request only when it answers every path —
 *  with a value or with a recorded per-path error (re-running would just
 *  replay the same envelope from the run cache). */
function covers(env: CodeRunResult | null, paths: string[]): env is CodeRunResult {
  if (!env || !env.ok) return false;
  return paths.every((p) => (env.data !== undefined && p in env.data) || (env.dataErrors !== undefined && p in env.dataErrors));
}

function paneHidden(el: SpecElement): boolean {
  return el.show === "code" || el.show === "none";
}

export async function resolveCode(spec: Spec, deps: CodeRunDeps = {}): Promise<CodeResolution[]> {
  const results: CodeResolution[] = [];
  const byId = pathsByCodeId(scanDataTokens(spec.params));
  const codeEls = new Map<string, SpecElement>();

  for (const el of spec.elements ?? []) {
    if (el.type !== "code") continue;
    codeEls.set(el.id, el);
    const paths = byId[el.id] ?? [];
    if (paneHidden(el) && paths.length === 0) {
      results.push({ id: el.id, ok: true, skipped: true });
      continue;
    }
    if (el.code_result) {
      // Only a successful stamp that covers the request is trustworthy cache:
      // a stamped FAILURE (a transient boot/timeout envelope from an earlier
      // pass, say) must re-run rather than freeze that error onto the element.
      if (covers(decodeCodeResult(el.code_result), paths)) {
        results.push({ id: el.id, ok: true });
        continue;
      }
      delete el.code_result;
    }
    if (!el.language || !el.code) {
      results.push({ id: el.id, ok: false, error: "code element needs language and code" });
      continue;
    }
    const result = await runCode({ language: el.language, code: el.code, paths }, deps);
    el.code_result = JSON.stringify(result);
    results.push({ id: el.id, ok: result.ok, error: result.error });
  }

  if (Object.keys(byId).length > 0) {
    const { params } = substituteDataTokens(spec.params, (codeId, path) => {
      const el = codeEls.get(codeId);
      if (!el) return { error: `"${codeId}" is not a code element in this drawcast` };
      const env = decodeCodeResult(el.code_result);
      if (!env || !env.ok) return { error: env?.error ?? "the script did not run" };
      if (env.dataErrors && path in env.dataErrors) return { error: env.dataErrors[path] };
      if (env.data && path in env.data) return { value: env.data[path] };
      return { error: "not harvested" };
    });
    spec.params = params;
  }
  return results;
}
```

- [ ] **Step 4: Run the suite**

Run: `npm test`
Expected: PASS. The existing resolver tests in `tests/code-element.test.ts` still pass: their elements default to `show: output` (never skipped) and their stamped OK envelopes cover an empty path list.

- [ ] **Step 5: Commit**

```bash
git add src/render/code.ts tests/code-data-bridge.test.ts
git commit -m "feat(render): resolve data tokens — run with referenced paths, substitute on the clone, skip hidden unreferenced scripts"
```

---

### Task 7: Static lint, unused-source warning, translator exemption

Spec §9.1, §9.4.

**Files:**
- Modify: `src/spec/schema.ts` (`semanticErrors`, after the element loop near line 780)
- Modify: `src/lint/lint.ts` (`lintCode`)
- Modify: `src/spec/i18n.ts` (`rewriteParams`)
- Test: `tests/code-data-bridge.test.ts`, `tests/spec-i18n.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `tests/code-data-bridge.test.ts`:

```ts
import { lintCommands } from "../src/lint/lint";

describe("data tokens — static lint", () => {
  const withParams = (params: object, els: object[] = [codeEl({ show: "none" })]) =>
    validateSpec({ template: "bar_chart", params, elements: els, commands: [] });

  test("a token must name a code element in this drawcast", () => {
    expect(withParams({ values: "{sim.y}" }).ok).toBe(true);
    const r = withParams({ values: "{ghost.y}" });
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toContain('"{ghost.y}"');
    expect(r.errors[0]).toContain("params.values");
  });

  test("a token naming a non-code element is an error", () => {
    const r = withParams({ values: "{ax.y}" }, [{ id: "ax", type: "axes" }, codeEl({ show: "none" })]);
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toContain('"ax" is not a code element');
  });

  test("a malformed token is named; prose with braces and dots is not", () => {
    const r = withParams({ values: "{sim.}" });
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toContain("{sim.}");
    expect(withParams({ title: "Growth {is}. Not a token" }).ok).toBe(true);
  });

  test("lint warns about a data source nothing references", () => {
    const unused = { template: "bar_chart", params: { values: [1] }, elements: [codeEl({ show: "none" })], commands: [] } as unknown as Spec;
    expect(lintCommands(unused).some((i) => i.rule === "code-use" && i.message.includes("show: none") && i.ids.includes("sim"))).toBe(true);
    const used = { ...unused, params: { values: "{sim.y}" } } as unknown as Spec;
    expect(lintCommands(used).some((i) => i.message.includes("show: none"))).toBe(false);
  });
});
```

Append to `tests/spec-i18n.test.ts` (a new `describe` at the end):

```ts
describe("data tokens are never text", () => {
  test("a \"{sim.y}\" param is neither offered to the translator nor rewritten", () => {
    const schema = { type: "object", properties: { labels: { type: "array", items: { type: "string" } }, title: { type: "string" } } };
    const s: Spec = { template: "bar_chart", params: { labels: "{sim.df.country}", title: "GDP" }, elements: [], commands: [] };
    expect(translatableStrings(s, schema).map((t) => t.text)).toEqual(["GDP"]);
    const out = applyTranslations(s, { "{sim.df.country}": "BROKEN", GDP: "BNP" }, schema);
    expect(out.params).toEqual({ labels: "{sim.df.country}", title: "BNP" });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/code-data-bridge.test.ts tests/spec-i18n.test.ts`
Expected: FAIL — `{ghost.y}` validates; the translator offers the token.

- [ ] **Step 3: Implement**

`src/spec/schema.ts` — add the import at the top:

```ts
import { DATA_TOKEN_RE, MALFORMED_TOKEN_RE, scanDataTokens } from "../code/tokens";
```

and in `semanticErrors`, right after the element loop that pushes `elementErrors(el)` (before `return errors;`):

```ts
  // Data tokens ("{sim.y}") must name a CODE element of this drawcast. A
  // brace+dot string that fails the grammar is a typo worth naming; anything
  // else with braces is prose.
  const codeIds = new Set((spec.elements ?? []).filter((e) => e.type === "code").map((e) => e.id));
  const allIds = new Set((spec.elements ?? []).map((e) => e.id));
  for (const t of scanDataTokens(spec.params)) {
    const where = `params.${t.at.join(".")}`;
    if (codeIds.has(t.codeId)) continue;
    if (allIds.has(t.codeId)) errors.push(`${where}: "{${t.codeId}.${t.path}}" — "${t.codeId}" is not a code element (only a code element's variables can feed params)`);
    else errors.push(`${where}: "{${t.codeId}.${t.path}}" references "${t.codeId}", which is not a code element in this drawcast`);
  }
  const walkMalformed = (v: unknown, at: string): void => {
    if (typeof v === "string") {
      if (MALFORMED_TOKEN_RE.test(v) && !DATA_TOKEN_RE.test(v)) errors.push(`${at}: "${v}" looks like a data token but is malformed — use "{codeId.variable}" (letters, digits, underscores, dots)`);
    } else if (Array.isArray(v)) v.forEach((x, i) => walkMalformed(x, `${at}.${i}`));
    else if (v && typeof v === "object") for (const [k, x] of Object.entries(v as Record<string, unknown>)) walkMalformed(x, `${at}.${k}`);
  };
  walkMalformed(spec.params, "params");
```

`src/lint/lint.ts` — in `lintCode`, add the import `import { scanDataTokens } from "../code/tokens";` at the top of the file, and inside the `for (const el of els)` loop add:

```ts
    if (el.show === "none" && !referenced.has(el.id)) {
      issues.push({
        rule: "code-use",
        ids: [el.id],
        message: `code "${el.id}" is show: none but no param references it — it draws nothing and feeds nothing; reference it as "{${el.id}.<variable>}" or show its output`,
        severity: "warn",
      });
    }
```

with, before the loop:

```ts
  const referenced = new Set(scanDataTokens(spec.params).map((t) => t.codeId));
```

`src/spec/i18n.ts` — add `import { isDataToken } from "../code/tokens";` and change the leaf line of `rewriteParams` to:

```ts
  if (str(value) && paramIsText(schema, key) && !isDataToken(value)) return rewrite(value, role);
```

- [ ] **Step 4: Run the suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/spec/schema.ts src/lint/lint.ts src/spec/i18n.ts tests/code-data-bridge.test.ts tests/spec-i18n.test.ts
git commit -m "feat(spec): lint data tokens (unknown id, non-code id, malformed), warn on unused sources, exempt tokens from translation"
```

---

### Task 8: Authoring-time check — data errors and post-substitution schema validation

Spec §9.2.

**Files:**
- Modify: `src/code/check.ts`
- Create: `src/scenes/params-check.ts`
- Modify: `src/llm/compile.ts:339-360`
- Test: `tests/code-data-bridge.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // code/check.ts
  export interface CodeCheckOutcome { errors: string[]; warnings: string[]; /** spec.params after substituting what the check harvested; spec.params itself when nothing was referenced */ resolvedParams?: Record<string, unknown> }
  // scenes/params-check.ts
  export function templateParamErrors(templateId: string, params: unknown): string[];
  export function templateParamIssues(templateId: string, params: unknown, strict: boolean): { errors: string[]; warnings: string[] };
  ```

- [ ] **Step 1: Write the failing tests** (append)

```ts
import { codeExecutionErrors } from "../src/code/check";
import { templateParamErrors, templateParamIssues } from "../src/scenes/params-check";
import { registerTemplateDoc, scenes } from "../src/scenes/registry";
import { parseTemplateDoc } from "../src/scenes/doc";

describe("authoring-time check — data paths", () => {
  test("runs with the referenced paths and turns per-path harvest errors into repairable errors", async () => {
    const s = bridged("none");
    const run = async (req: { paths?: string[] }) => ({ ok: true, stdout: "", stderr: "", figures: [], data: { s: [1] }, dataErrors: { frames: "no variable frames" } }) as CodeRunResult;
    const out = await codeExecutionErrors(s, run);
    expect(out.errors).toEqual(['code "sim": {sim.frames} — no variable frames']);
    expect(out.resolvedParams).toEqual({ labels: ["a", "b"], title: "T", series: [{ name: "s", values: [1] }] });
  });

  test("a clean harvest yields no errors and the substituted params", async () => {
    const s = bridged("none");
    const run = async () => ({ ok: true, stdout: "", stderr: "", figures: [], data: { frames: [[1, 2]], s: [3] } }) as CodeRunResult;
    const out = await codeExecutionErrors(s, run);
    expect(out.errors).toEqual([]);
    expect(out.resolvedParams!.values).toEqual([[1, 2]]);
  });
});

describe("template params validated against the manifest schema", () => {
  const yaml = `
template: tp_probe
version: 1
kit: 1
status: ready
description: probe
params:
  type: object
  properties:
    values:
      type: array
      items: { type: number }
      maxItems: 3
element_ids: {}
examples: []
layout: |
  return { drawables: [], labels: [], anchors: {}, order: [] };
`;
  test("reports violations with a path; unknown or stub templates report nothing", () => {
    const { doc } = parseTemplateDoc(yaml);
    expect(registerTemplateDoc(doc!).ok).toBe(true);
    try {
      expect(templateParamErrors("tp_probe", { values: [1, 2] })).toEqual([]);
      expect(templateParamErrors("tp_probe", { values: ["a"] })[0]).toContain("/values/0");
      expect(templateParamErrors("tp_probe", { values: [1, 2, 3, 4] })[0]).toContain("/values");
      expect(templateParamErrors("nope_never", { values: ["a"] })).toEqual([]);
      const strict = templateParamIssues("tp_probe", { values: ["a"] }, true);
      expect(strict.errors.length).toBe(1);
      expect(strict.warnings).toEqual([]);
      const lenient = templateParamIssues("tp_probe", { values: ["a"] }, false);
      expect(lenient.errors).toEqual([]);
      expect(lenient.warnings.length).toBe(1);
    } finally {
      delete scenes.tp_probe;
    }
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/code-data-bridge.test.ts`
Expected: FAIL — `resolvedParams` undefined; module `params-check` missing.

- [ ] **Step 3: Implement `src/code/check.ts`** (replace the body of `codeExecutionErrors`)

```ts
import type { Spec } from "../spec/types";
import type { CodeRunRequest, CodeRunResult } from "./run";
import { pathsByCodeId, scanDataTokens, substituteDataTokens } from "./tokens";

export interface CodeCheckOutcome {
  errors: string[];
  warnings: string[];
  /** spec.params with every harvested token substituted — what a render
   *  would lay out — so the caller can validate it against the template's
   *  schema. spec.params itself when nothing was referenced. */
  resolvedParams?: Record<string, unknown>;
}

export async function codeExecutionErrors(
  spec: Spec,
  run: (req: CodeRunRequest) => Promise<CodeRunResult>,
): Promise<CodeCheckOutcome> {
  const out: CodeCheckOutcome = { errors: [], warnings: [] };
  const byId = pathsByCodeId(scanDataTokens(spec.params));
  const envelopes = new Map<string, CodeRunResult>();
  for (const el of spec.elements ?? []) {
    if (el.type !== "code" || el.language !== "python" || !el.code) continue;
    const paths = byId[el.id] ?? [];
    let res: CodeRunResult;
    try {
      res = await run({ language: "python", code: el.code, paths });
    } catch {
      // A throwing injected runner is still just this ONE element's runtime
      // being unavailable — the remaining code elements still get checked.
      continue;
    }
    if (res.runtimeUnavailable) {
      // The runtime never loaded (offline CDN, no browser) — the script was
      // never actually verified, so this is a WARNING, never an error: an
      // offline author must not burn a repair round on code that may be fine.
      out.warnings.push(`code "${el.id}" — the Python runtime could not load — script not verified`);
      continue;
    }
    envelopes.set(el.id, res);
    if (!res.ok || res.error) {
      out.errors.push(
        `code element "${el.id}" fails when executed — fix the script:\n${(res.error ?? res.stderr).slice(0, 600)}`,
      );
      continue;
    }
    if (res.stderr.trim() !== "") {
      out.warnings.push(`code "${el.id}" writes to stderr (${res.stderr.trim().slice(0, 200)}) — silence it or fix the cause`);
    }
    // A referenced path the harvest could not serve: the model repairs the
    // script (assign the variable) or the token (name the right one).
    for (const [path, msg] of Object.entries(res.dataErrors ?? {})) {
      out.errors.push(`code "${el.id}": {${el.id}.${path}} — ${msg}`);
    }
  }
  if (Object.keys(byId).length === 0) {
    out.resolvedParams = spec.params;
    return out;
  }
  out.resolvedParams = substituteDataTokens(spec.params, (codeId, path) => {
    const env = envelopes.get(codeId);
    if (!env || !env.ok) return { error: "not run" };
    if (env.dataErrors && path in env.dataErrors) return { error: env.dataErrors[path] };
    if (env.data && path in env.data) return { value: env.data[path] };
    return { error: "not harvested" };
  }).params;
  return out;
}
```

- [ ] **Step 4: Create `src/scenes/params-check.ts`**

```ts
// Validate a spec's params against its template's params_schema — the check
// the wire schema never does (params is additionalProperties: true there).
// Used at authoring time after data tokens have been substituted, so the
// model hears "values: expected numbers, got strings" in the repair round.
// Strict = errors; lenient = warnings (pre-existing templates fed by hand,
// where a stricter reading must not regress a bundled example).

import AjvModule, { type ValidateFunction } from "ajv";
import { scenes } from "./registry";

const AjvCtor = ((AjvModule as unknown as { default?: unknown }).default ?? AjvModule) as typeof AjvModule;
const ajv = new AjvCtor({ allErrors: true, strict: false });
const compiled = new Map<string, { schema: object; validate: ValidateFunction }>();

export function templateParamErrors(templateId: string, params: unknown): string[] {
  const scene = scenes[templateId];
  if (!scene || scene.manifest.status !== "ready") return [];
  const schema = scene.manifest.params_schema;
  let entry = compiled.get(templateId);
  if (!entry || entry.schema !== schema) {
    entry = { schema, validate: ajv.compile(schema) };
    compiled.set(templateId, entry);
  }
  if (entry.validate(params ?? {})) return [];
  return (entry.validate.errors ?? []).map(
    (e) => `params${e.instancePath || ""} ${e.message ?? "invalid"}${e.params ? " " + JSON.stringify(e.params) : ""}`,
  );
}

export function templateParamIssues(templateId: string, params: unknown, strict: boolean): { errors: string[]; warnings: string[] } {
  const problems = templateParamErrors(templateId, params).map((p) => `template "${templateId}": ${p}`);
  return strict ? { errors: problems, warnings: [] } : { errors: [], warnings: problems };
}
```

- [ ] **Step 5: Wire it into `src/llm/compile.ts`**

Add the imports near the other `../scenes` imports:

```ts
import { templateParamIssues } from "../scenes/params-check";
import { isPackTemplateId, packTemplateIds } from "../scenes/packs";
import { scanDataTokens } from "../code/tokens";
```

Inside the validation block, change the code-check section so `check` is visible afterwards and add the params validation right after it (replace from `if (cfg.executeCode !== false && …` through the closing brace of that `if`):

```ts
        let check: CodeCheckOutcome = NO_CODE_CHECK;
        if (cfg.executeCode !== false && !cfg.signal?.aborted && (best.elements ?? []).some((e) => e.type === "code")) {
          const run = cfg.codeRunner ?? (await import("../code/run")).runCode;
          // Race the real check against a budget/abort: generation must never
          // hang on the WASM runtime. On expiry the check is abandoned (not
          // cancelled) and generation proceeds without its errors/warnings —
          // render still executes the code for real, later.
          let budgetTimer: ReturnType<typeof setTimeout> | undefined;
          let onAbort: (() => void) | undefined;
          const budget = new Promise<CodeCheckOutcome>((resolve) => {
            budgetTimer = setTimeout(() => resolve(NO_CODE_CHECK), AUTHORING_CODE_CHECK_MS);
            onAbort = () => resolve(NO_CODE_CHECK);
            cfg.signal?.addEventListener("abort", onAbort, { once: true });
          });
          check = await Promise.race<CodeCheckOutcome>([codeExecutionErrors(best, run), budget]);
          if (budgetTimer) clearTimeout(budgetTimer);
          if (onAbort) cfg.signal?.removeEventListener("abort", onAbort);
          validation.errors.push(...check.errors);
          for (const w of check.warnings) {
            lintIssues.push({ rule: "code-use", ids: [], message: w, severity: "warn" });
          }
        }
        // Params against the template's own schema, AFTER substitution (spec
        // §9.2): strict for a spec that carries data tokens and for the data
        // pack's templates; advisory for a hand-fed pre-existing template.
        if (best.template) {
          const tokens = scanDataTokens(best.params).length > 0;
          const dataPack = isPackTemplateId(best.template) && packTemplateIds("data").includes(best.template);
          const issues = templateParamIssues(best.template, check.resolvedParams ?? best.params, tokens || dataPack);
          validation.errors.push(...issues.errors);
          for (const w of issues.warnings) lintIssues.push({ rule: "code-use", ids: [], message: w, severity: "warn" });
        }
```

(`NO_CODE_CHECK` already exists at line 28; `CodeCheckOutcome` is already imported.)

- [ ] **Step 6: Run the suite and the type check**

Run: `npm test && npx tsc --noEmit`
Expected: PASS. If `tests/generate-loop.test.ts` or `tests/cancel.test.ts` now see template-param warnings on their fixtures, those fixtures use core templates with valid params — investigate the exact message before touching a fixture; a strict error on a fixture means the fixture's params are genuinely off-schema and must be fixed in the fixture, never by loosening the check.

- [ ] **Step 7: Commit**

```bash
git add src/code/check.ts src/scenes/params-check.ts src/llm/compile.ts tests/code-data-bridge.test.ts
git commit -m "feat(llm): authoring-time data errors + params validated against the template schema after substitution"
```

---

### Task 9: Kit v5 — `COLORS.series` and `kit.plotArea`

Spec §6.1.

**Files:**
- Modify: `src/layout/model.ts` (`COLORS`)
- Modify: `src/scenes/kit.ts` (`KIT_VERSION`, `SceneKit`, the `kit` object)
- Test: `tests/scene-kit.test.ts`

- [ ] **Step 1: Update the failing test**

In `tests/scene-kit.test.ts`, change the `KIT_VERSION` test to:

```ts
test("KIT_VERSION is 5 and constants ride on the kit", () => {
  expect(KIT_VERSION).toBe(5);
  expect(kit.COLORS.series).toHaveLength(6);
  for (const c of kit.COLORS.series) expect(Object.values(kit.COLORS)).toContain(c);
  expect(Object.isFrozen(kit.COLORS.series)).toBe(true);
  expect(kit.plotArea()).toEqual({ x0: 120, y0: 95, x1: 930, y1: 675 });
```

(keep the rest of that test's existing assertions after these lines.)

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/scene-kit.test.ts`
Expected: FAIL — `KIT_VERSION` is 4, `series` undefined.

- [ ] **Step 3: Implement**

`src/layout/model.ts` — inside `COLORS`, after `regionLoss`:

```ts
  /**
   * Ordered series palette for data-driven templates (bar_chart, line_chart,
   * …): series k takes series[k % 6]. Drawn from the roles above so a chart
   * shares the figure's ink. Frozen with its parent — the kit exposes it live.
   */
  series: Object.freeze(["#b5482e", "#2f6b8f", "#8a5fa8", "#d0865f", "#87a878", "#f2c14e"]),
```

`src/scenes/kit.ts`:

```ts
export const KIT_VERSION = 5; // v5: COLORS.series + plotArea() (the data pack)
```

Change the canvas import to `import { CANVAS, plotArea, type PlotArea } from "../layout/canvas";`, add to the `SceneKit` interface's constants block:

```ts
  /** The standard plot box every axes template uses (layout/canvas.ts) — the default `box` of the data templates. */
  plotArea: typeof plotArea;
```

and to the `kit` object beside `AXIS_OVERHANG,`:

```ts
  plotArea,
```

- [ ] **Step 4: Run the suite**

Run: `npm test`
Expected: PASS. (`tests/template-doc.test.ts` pins "newer kit" with a relative number — unchanged. Existing templates declare `kit: ≤ 4` and stay valid.)

- [ ] **Step 5: Commit**

```bash
git add src/layout/model.ts src/scenes/kit.ts tests/scene-kit.test.ts
git commit -m "feat(kit): v5 — COLORS.series palette and plotArea() for the data pack"
```

---

### Task 10: The `data` pack with `bar_chart`

Spec §6.1, §6.2, §7 (placeholder bars from typed labels).

**Files:**
- Create: `src/scenes/packs/data.yaml`
- Modify: `src/scenes/packs.ts` (`PACK_DEFS`)
- Modify: `src/store.ts:183` (`enabledPacks`), `:39` (`packsUpgrade` → v7)
- Modify: `tests/packs.test.ts` (import list)
- Test: `tests/data-pack.test.ts` (new)

- [ ] **Step 1: Write the failing tests**

Create `tests/data-pack.test.ts`:

```ts
// The data pack: templates fed by data — typed by the author or substituted
// from a script by the render-time resolver. What is pinned here: the
// depth-means-staged rule, interpolation at a fractional stage, absent bars
// growing from the axis, stable ids and limits across stages, the placeholder
// promise (typed labels + a still-unresolved token → n bars of height 0), the
// box param, and every manifest example laying out clean.

import { beforeAll, describe, expect, test } from "vitest";
import dataYaml from "../src/scenes/packs/data.yaml?raw";
import { registerPack, PACK_DEFS, DEFAULT_OFF_PACKS } from "../src/scenes/packs";
import { scenes } from "../src/scenes/registry";
import { layoutSpec } from "../src/layout/layout";
import { plotArea } from "../src/layout/canvas";
import { flattenDrawables, type AreaDrawable, type TextDrawable } from "../src/layout/model";
import { DEFAULT_SETTINGS } from "../src/store";
import type { Spec } from "../src/spec/types";

beforeAll(() => {
  const r = registerPack("data", dataYaml);
  expect(r.errors).toEqual([]);
});

const plot = plotArea();
/** The y scale bar_chart uses for a chart whose data spans [0, hi] with the 8 % headroom. */
const Y = (v: number, hi: number) => plot.y0 + (v / (hi * 1.08)) * (plot.y1 - plot.y0);
const area = (l: ReturnType<typeof layoutSpec>, id: string) => flattenDrawables(l.drawables).find((d) => d.id === id) as AreaDrawable | undefined;
const barTop = (l: ReturnType<typeof layoutSpec>, i: number, j = 0) => Math.max(...area(l, `bar_${i}__f${j}`)!.pts.map((p) => p[1]));
const layout = (params: object) => layoutSpec({ template: "bar_chart", params } as Spec);

describe("pack registration", () => {
  test("data is a bundled pack, enabled by default, with the two M1 templates", () => {
    expect(PACK_DEFS.data.id).toBe("data");
    expect(DEFAULT_OFF_PACKS.has("data")).toBe(false);
    expect(DEFAULT_SETTINGS.enabledPacks).toContain("data");
    expect(scenes.bar_chart?.manifest.status).toBe("ready");
  });

  // Task 11 adds "data_table" to this list and asserts its manifest is ready.
  test("every manifest example lays out with zero warnings and no error lint", () => {
    for (const tid of ["bar_chart"]) {
      for (const ex of scenes[tid].manifest.examples) {
        const res = layoutSpec({ template: tid, params: ex.params } as Spec);
        expect(res.warnings, `${tid}: ${ex.request}`).toEqual([]);
        expect(res.issues.filter((i) => i.severity === "error"), `${tid}: ${ex.request}`).toEqual([]);
      }
    }
  });
});

describe("bar_chart — static data", () => {
  test("mints axes, bar_1..n (with their category label) and the title; bar heights follow the values", () => {
    const l = layout({ labels: ["a", "b", "c"], values: [2, 4, 8], title: "T", y_label: "Y" });
    expect(l.order).toEqual(["axes", "bar_1", "bar_2", "bar_3", "title"]);
    expect(barTop(l, 3)).toBeCloseTo(Y(8, 8), 6);
    expect(barTop(l, 1)).toBeCloseTo(Y(2, 8), 6);
    const texts = flattenDrawables(l.drawables).filter((d): d is TextDrawable => d.kind === "text").map((d) => d.text);
    expect(texts).toEqual(expect.arrayContaining(["a", "b", "c", "T", "Y"]));
    expect(l.warnings).toEqual([]);
  });

  test("value_labels write each value above its bar with the data's own precision", () => {
    const l = layout({ labels: ["a", "b"], values: [2.5, 4], value_labels: true });
    const texts = flattenDrawables(l.drawables).filter((d): d is TextDrawable => d.kind === "text").map((d) => d.text);
    expect(texts).toEqual(expect.arrayContaining(["2.5", "4.0"]));
  });

  test("series draw grouped bars with a legend; colors cycle COLORS.series", () => {
    const l = layout({ labels: ["a", "b"], series: [{ name: "x", values: [1, 2] }, { name: "y", values: [3, 4] }] });
    expect(l.order).toEqual(["axes", "bar_1", "bar_2", "legend"]);
    expect(area(l, "bar_1__f0")!.style.fill).toBe("#b5482e");
    expect(area(l, "bar_1__f1")!.style.fill).toBe("#2f6b8f");
  });

  test("box places the chart; labels beyond 40 and series beyond 6 are dropped", () => {
    const l = layout({ labels: ["a"], values: [1], box: { x: 500, y: 100, w: 400, h: 500 } });
    const pts = area(l, "bar_1__f0")!.pts;
    expect(Math.min(...pts.map((p) => p[0]))).toBeGreaterThanOrEqual(500);
    expect(Math.max(...pts.map((p) => p[0]))).toBeLessThanOrEqual(900);
    const many = layout({ labels: Array.from({ length: 50 }, (_, i) => `l${i}`), values: Array.from({ length: 50 }, () => 1) });
    expect(many.order.filter((id) => id.startsWith("bar_"))).toHaveLength(40);
  });
});

describe("bar_chart — stages", () => {
  const staged = { labels: ["a", "b", "c"], values: [[2, 4, 8], [4, 8, 2]] };

  test("depth means staged: stage 0 and stage 1 are the two rows; limits span ALL stages", () => {
    const s0 = layout({ ...staged, stage: 0 });
    const s1 = layout({ ...staged, stage: 1 });
    expect(barTop(s0, 1)).toBeCloseTo(Y(2, 8), 6);
    expect(barTop(s1, 1)).toBeCloseTo(Y(4, 8), 6); // same scale: hi is 8 in both
    expect(barTop(s1, 3)).toBeCloseTo(Y(2, 8), 6);
    expect(s0.order).toEqual(s1.order);
  });

  test("a fractional stage interpolates linearly", () => {
    const l = layout({ ...staged, stage: 0.5 });
    expect(barTop(l, 1)).toBeCloseTo(Y(3, 8), 6);
    expect(barTop(l, 3)).toBeCloseTo(Y(5, 8), 6);
  });

  test("stage is clamped; a series with fewer stages holds its last one", () => {
    const l = layout({ ...staged, stage: 7 });
    expect(barTop(l, 1)).toBeCloseTo(Y(4, 8), 6);
    const mixed = layout({ labels: ["a"], series: [{ name: "x", values: [[1], [2]] }, { name: "y", values: [5] }], stage: 1 });
    expect(barTop(mixed, 1, 1)).toBeCloseTo(Y(5, 5), 6);
  });

  test("a bar absent from a stage has height 0 and still exists (ids stable)", () => {
    const l = layout({ labels: ["a", "b", "c"], values: [[5, 5, 5], [5, 5]], stage: 1 });
    expect(l.order).toContain("bar_3");
    expect(barTop(l, 3)).toBeCloseTo(Y(0, 5), 6);
    const half = layout({ labels: ["a", "b", "c"], values: [[5, 5, 5], [5, 5]], stage: 0.5 });
    expect(barTop(half, 3)).toBeCloseTo(Y(2.5, 5), 6);
  });

  test("ylim pins the scale; negative values hang below a dashed zero line", () => {
    const l = layout({ labels: ["a"], values: [3], ylim: [0, 10] });
    expect(barTop(l, 1)).toBeCloseTo(plot.y0 + 0.3 * (plot.y1 - plot.y0), 6);
    const neg = layout({ labels: ["a", "b"], values: [-2, 4] });
    expect(flattenDrawables(neg.drawables).some((d) => d.id === "axes__zero")).toBe(true);
    const pts = area(neg, "bar_1__f0")!.pts;
    const zero = flattenDrawables(neg.drawables).find((d) => d.id === "axes__zero")!;
    expect(Math.max(...pts.map((p) => p[1]))).toBeCloseTo((zero as { pts: [number, number][] }).pts[0][1], 6);
  });
});

describe("bar_chart — the placeholder promise", () => {
  test("typed labels + an unresolved token → n bars of height 0, so beats exist offline", () => {
    const l = layout({ labels: ["a", "b", "c"], values: "{sim.frames}", stage: 0 });
    expect(l.order).toEqual(["axes", "bar_1", "bar_2", "bar_3"]);
    expect(barTop(l, 2)).toBeCloseTo(plot.y0, 6);
    expect(l.warnings).toEqual([]);
  });

  test("no labels and no data → axes only, no warnings", () => {
    const l = layout({ values: "{sim.frames}" });
    expect(l.order).toEqual(["axes"]);
    expect(l.warnings).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/data-pack.test.ts`
Expected: FAIL — `data.yaml` not found.

- [ ] **Step 3: Create `src/scenes/packs/data.yaml`** (header + `bar_chart`; `data_table` is Task 11)

```yaml
pack: data
title: Data charts & tables
description: Bar charts and tables drawn from data — typed by the author or computed by a code element's script and referenced with "{id.var}" tokens — as vector geometry the animate verb can tween stage by stage.
---
template: bar_chart
title: Bar chart
version: 1
kit: 5
status: ready
description: >-
  A bar chart from data: categories along the x axis, one bar per category
  (grouped bars with `series`), drawn as ink so it animates as geometry.
  `values` may be one list (a static chart) or a list of lists — STAGES of
  the same chart — and the numeric `stage` param picks which one is shown;
  a fractional stage interpolates, so `animate: {stage: 1}` plays the change
  as bars growing and shrinking. Feed it typed numbers, or a code element's
  variables via "{id.var}" tokens (labels typed by hand keep the bar_i beats
  alive before the script has run). Choose this scene for ANY request for a
  bar chart, a column chart, a histogram (compute the bins in Python), a
  comparison across categories or years, or "show how these numbers change".
params:
  type: object
  properties:
    labels:
      type: array
      items: { type: string }
      maxItems: 40
      description: "Category names under the bars, one per bar. TYPE these by hand even when values come from a script — the storyboard's bar_i beats exist only when the bar count is known before the script runs."
    values:
      oneOf:
        - { type: array, items: { type: number }, maxItems: 40 }
        - { type: array, items: { type: array, items: { type: number }, maxItems: 40 }, maxItems: 12 }
        - { type: string, pattern: "^\\{[A-Za-z][A-Za-z0-9_]*\\.[A-Za-z_][A-Za-z0-9_.]*\\}$" }
      description: "One series: a list of numbers (static), or a list of lists (STAGES — depth means staged; every stage has one number per label, a missing one counts as 0), or a \"{id.var}\" token naming a code element's variable."
    series:
      type: array
      maxItems: 6
      items:
        type: object
        properties:
          name: { type: string }
          values:
            oneOf:
              - { type: array, items: { type: number }, maxItems: 40 }
              - { type: array, items: { type: array, items: { type: number }, maxItems: 40 }, maxItems: 12 }
              - { type: string, pattern: "^\\{[A-Za-z][A-Za-z0-9_]*\\.[A-Za-z_][A-Za-z0-9_.]*\\}$" }
        required: [values]
      description: "Several series → grouped bars with a legend. Use INSTEAD of values. Each series' values follow the same static/staged/token rule."
    stage:
      type: number
      minimum: 0
      description: "Which stage is shown (0-based; default 0). Fractional values interpolate between adjacent stages — the animate verb's target: {\"animate\": {\"stage\": 1}}. Write the starting stage explicitly."
    value_labels:
      type: boolean
      description: "Write each bar's value above it (default false)."
    gap:
      type: number
      minimum: 0
      maximum: 0.8
      description: "Space between category groups as a fraction of a slot (default 0.35)."
    box:
      type: object
      properties:
        x: { type: number }
        y: { type: number }
        w: { type: number }
        h: { type: number }
      required: [x, y, w, h]
      description: "Plot area in logical units (lower-left corner, width, height) when the chart shares the canvas with something else — a code panel on the left, say. Default: the standard plot area."
    ylim:
      type: array
      items: { type: number }
      minItems: 2
      maxItems: 2
      description: "Fixed y range [low, high]. Default: 0 to the largest value across ALL stages (plus headroom), so the frame never jumps during a tween."
    x_label:
      type: string
    y_label:
      type: string
    title:
      type: string
element_ids:
  axes: the x and y axes with their captions (and a dashed zero line when values go negative)
  bar_1: "the first category's bar (its fill, outline, category label and value label; bar_2, bar_3, … likewise) — one per label, at every stage"
  legend: the series legend (only with several series)
  title: figure title, when set
examples:
  - request: "Bar chart of GDP per capita for Norway, Sweden and Denmark."
    params:
      labels: ["Norway", "Sweden", "Denmark"]
      values: [87, 52, 58]
      y_label: "USD (thousands)"
      title: "GDP per capita"
  - request: "Show how the three countries' GDP changed from 2010 to 2020, one stage per year."
    params:
      labels: ["Norway", "Sweden", "Denmark"]
      values: [[87, 52, 58], [67, 52, 61]]
      stage: 0
      value_labels: true
      title: "GDP per capita, 2010 → 2020"
  - request: "Grouped bars: treated vs control, before and after."
    params:
      labels: ["Before", "After"]
      series:
        - { name: "Treated", values: [10, 16] }
        - { name: "Control", values: [10, 11] }
      y_label: "Outcome"
layout: |
  const C = kit.COLORS, MS = kit.SKETCH_MS;
  const num = (v, d) => (typeof v === "number" && Number.isFinite(v) ? v : d);
  const str = (v, d) => (typeof v === "string" && v.trim() !== "" ? v.trim() : d);
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const isNumRow = (a) => Array.isArray(a) && a.every((v) => v === null || (typeof v === "number" && Number.isFinite(v)));
  // values: number[] (one stage) or number[][] (staged — depth means staged).
  // Anything else — an unresolved "{code.var}" token before the script has
  // run, say — is "no data yet".
  const toStages = (v) => {
    if (!Array.isArray(v) || v.length === 0) return null;
    if (Array.isArray(v[0])) return v.every(isNumRow) ? v.slice(0, 12) : null;
    return isNumRow(v) ? [v] : null;
  };
  const series = [];
  if (Array.isArray(params.series)) {
    params.series.slice(0, 6).forEach((s, k) => {
      const st = toStages(s && s.values);
      if (st) series.push({ name: str(s && s.name, "Series " + (k + 1)), stages: st });
    });
  } else {
    const st = toStages(params.values);
    if (st) series.push({ name: "", stages: st });
  }
  const labels = (Array.isArray(params.labels) ? params.labels : [])
    .filter((l) => typeof l === "string" || typeof l === "number")
    .map(String)
    .slice(0, 40);
  let n = labels.length;
  for (const s of series) for (const st of s.stages) n = Math.max(n, st.length);
  n = Math.min(40, n);
  // The promise idiom: typed labels but no data yet → n bars of height 0, so
  // the storyboard's bar_i beats exist offline and before the script has run.
  if (series.length === 0 && n > 0) series.push({ name: "", stages: [labels.map(() => 0)] });
  let K = 1;
  for (const s of series) K = Math.max(K, s.stages.length);
  const stage = clamp(num(params.stage, 0), 0, K - 1);
  const k0 = Math.floor(stage), k1 = Math.min(K - 1, k0 + 1), t = stage - k0;
  // A series with fewer stages than K holds its last stage; a missing bar is 0.
  const atStage = (s, k, i) => {
    const st = s.stages[Math.min(k, s.stages.length - 1)];
    const v = st[i];
    return typeof v === "number" ? v : 0;
  };
  const value = (s, i) => atStage(s, k0, i) + (atStage(s, k1, i) - atStage(s, k0, i)) * t;

  // Limits over ALL stages, so the frame never jumps mid-tween. Bars start at 0.
  let lo = 0, hi = 0;
  for (const s of series) for (const st of s.stages) for (const v of st) if (typeof v === "number") { lo = Math.min(lo, v); hi = Math.max(hi, v); }
  const ylim = Array.isArray(params.ylim) && params.ylim.length === 2 && params.ylim.every((v) => typeof v === "number" && Number.isFinite(v)) ? params.ylim : null;
  let yMin = ylim ? Math.min(ylim[0], ylim[1]) : lo;
  let yMax = ylim ? Math.max(ylim[0], ylim[1]) : hi;
  if (!ylim) {
    const pad = (yMax - yMin) * 0.08;
    if (yMax > 0) yMax += pad;
    if (yMin < 0) yMin -= pad;
  }
  if (yMax - yMin < 1e-9) yMax = yMin + 1;

  const b = params.box;
  const plot = b && typeof b === "object" && [b.x, b.y, b.w, b.h].every((v) => typeof v === "number" && Number.isFinite(v)) && b.w > 0 && b.h > 0
    ? { x0: b.x, y0: b.y, x1: b.x + b.w, y1: b.y + b.h }
    : kit.plotArea();
  const Y = (v) => plot.y0 + ((v - yMin) / (yMax - yMin)) * (plot.y1 - plot.y0);
  const base = Y(clamp(0, yMin, yMax)); // the bars' baseline: the zero line, or the axis when 0 is off-scale
  const m = series.length;
  const slotW = (plot.x1 - plot.x0) / Math.max(1, n);
  const gap = clamp(num(params.gap, 0.35), 0, 0.8);
  const groupW = slotW * (1 - gap);
  const barW = groupW / Math.max(1, m);
  const xLab = str(params.x_label, "");
  const yLab = str(params.y_label, "");
  const showValues = params.value_labels === true;
  // Value labels carry the data's own precision (at most 2 decimals).
  let dec = 0;
  for (const s of series) for (const st of s.stages) for (const v of st) {
    if (typeof v === "number" && !Number.isInteger(v)) dec = Math.min(2, Math.max(dec, (String(v).split(".")[1] || "").length));
  }
  const fmt = (v) => (dec === 0 ? String(Math.round(v)) : v.toFixed(dec));

  const drawables = [], labelReqs = [], anchors = {}, order = [];
  const push = (d) => { drawables.push(d); order.push(d.id); };

  const axesChildren = [
    kit.stroke("axes__x", [[plot.x0 - 6, plot.y0], [plot.x1 + kit.AXIS_OVERHANG, plot.y0]], { arrowhead: "end", strokeWidth: 4, ms: MS.axis }),
    kit.stroke("axes__y", [[plot.x0, plot.y0 - 6], [plot.x0, plot.y1 + kit.AXIS_OVERHANG]], { arrowhead: "end", strokeWidth: 4, ms: MS.axis }),
  ];
  if (xLab) axesChildren.push(kit.axisLabel("axes__x_label", "x", plot, xLab, { fontSize: 22 }));
  if (yLab) axesChildren.push(kit.axisLabel("axes__y_label", "y", plot, yLab, { fontSize: 22 }));
  if (yMin < 0) axesChildren.push(kit.stroke("axes__zero", [[plot.x0, base], [plot.x1, base]], { color: C.guide, dash: true, strokeWidth: 2, ms: MS.guides }));
  push(kit.group("axes", axesChildren));
  anchors.axes = [plot.x0, plot.y0];

  const labelSize = n > 12 ? 13 : 17;
  for (let i = 0; i < n; i++) {
    const id = "bar_" + (i + 1);
    const xc = plot.x0 + slotW * (i + 0.5);
    const children = [];
    let reach = base;
    series.forEach((s, j) => {
      const v = value(s, i);
      const x = plot.x0 + slotW * i + (slotW - groupW) / 2 + barW * j;
      const yv = Y(clamp(v, yMin, yMax));
      const lo2 = Math.min(base, yv), hi2 = Math.max(base, yv);
      const color = C.series[j % C.series.length];
      const rect = [[x, lo2], [x + barW, lo2], [x + barW, hi2], [x, hi2]];
      children.push(kit.area(id + "__f" + j, rect, color, { opacity: 0.55 }));
      children.push(kit.stroke(id + "__o" + j, rect, { closed: true, color, strokeWidth: 2.5, ms: MS.stroke }));
      if (showValues) children.push(kit.text(id + "__v" + j, [x + barW / 2, v >= 0 ? hi2 + 13 : lo2 - 13], fmt(v), { fontSize: 15, color: C.guide }));
      reach = v >= 0 ? Math.max(reach, hi2) : Math.min(reach, lo2);
    });
    children.push(kit.text(id + "__l", [xc, plot.y0 - 20], labels[i] !== undefined ? labels[i] : String(i + 1), { fontSize: labelSize }));
    push(kit.group(id, children));
    anchors[id] = [xc, (base + reach) / 2];
  }

  if (m >= 2) {
    const lx = plot.x1 - 150, ly = plot.y1 - 16;
    const children = [];
    series.forEach((s, j) => {
      const y = ly - j * 24;
      const color = C.series[j % C.series.length];
      children.push(kit.area("legend__s" + j, [[lx, y - 8], [lx + 18, y - 8], [lx + 18, y + 8], [lx, y + 8]], color, { opacity: 0.55 }));
      children.push(kit.text("legend__t" + j, [lx + 26, y], s.name, { fontSize: 16, anchor: "start" }));
    });
    push(kit.group("legend", children));
    anchors.legend = [lx + 70, ly - (m - 1) * 12];
  }

  const title = str(params.title, "");
  if (title) {
    const ty = Math.min(700, plot.y1 + 25);
    push(kit.text("title", [(plot.x0 + plot.x1) / 2, ty], title, { fontSize: 30 }));
    anchors.title = [(plot.x0 + plot.x1) / 2, ty];
  }
  return { drawables, labels: labelReqs, anchors, order };
```

- [ ] **Step 4: Register the pack**

`src/scenes/packs.ts` — add to `PACK_DEFS` after `maps`:

```ts
  data: {
    id: "data",
    title: "Data charts & tables",
    description: "Bar charts and tables drawn from data — typed, or computed by a code element and referenced with \"{id.var}\" tokens — as vector geometry the animate verb tweens stage by stage.",
    load: async () => (await import("./packs/data.yaml?raw")).default,
  },
```

`src/store.ts` line 183 — append `"data"` to `enabledPacks`; line 39 — `packsUpgrade: "drawcast.packsDefault.v7",`.

`tests/packs.test.ts` — add `import dataYaml from "../src/scenes/packs/data.yaml?raw";` beside the other pack imports, and wherever the file registers every pack by name in a list that contains `statsYaml` (search for `statsYaml` — the "every bundled pack registers" style loop), add the pair `["data", dataYaml]`. If no such list exists (the file only registers packs individually per describe), add nothing.

- [ ] **Step 5: Run the tests**

Run: `npx vitest run tests/data-pack.test.ts tests/packs.test.ts tests/pack-defaults.test.ts tests/settings-packs-upgrade.test.ts`
Expected: PASS (the test file references only `bar_chart` at this point; Task 11 extends it).

Run: `npm test`
Expected: PASS (72 ready templates ≤ threshold 80; the catalog budget test stays under 250 k chars).

- [ ] **Step 6: Commit**

```bash
git add src/scenes/packs/data.yaml src/scenes/packs.ts src/store.ts tests/data-pack.test.ts tests/packs.test.ts
git commit -m "feat(scenes): data pack with bar_chart — stages interpolated by the template, placeholder bars from typed labels"
```

---

### Task 11: `data_table`

Spec §6.5. Deviation from the spec's "drawn with kit.table": `kit.table` draws one uniform grid group, which cannot give per-row ids or content-sized columns; the template composes rows from `kit.stroke`/`kit.text` instead (the same idiom as `layout/code.ts`'s grid). Amend the spec line in this task.

**Files:**
- Modify: `src/scenes/packs/data.yaml` (append a document)
- Modify: `docs/superpowers/specs/2026-09-02-code-data-bridge-design.md` §6.5 (one line)
- Test: `tests/data-pack.test.ts`

- [ ] **Step 1: Write the failing tests**

In `tests/data-pack.test.ts`, extend the two registration tests: add `expect(scenes.data_table?.manifest.status).toBe("ready");` after the `bar_chart` line, and change the examples loop to `for (const tid of ["bar_chart", "data_table"])`. Then append:

```ts
describe("data_table", () => {
  const table = (params: object) => layoutSpec({ template: "data_table", params } as Spec);
  const texts = (l: ReturnType<typeof layoutSpec>) => flattenDrawables(l.drawables).filter((d): d is TextDrawable => d.kind === "text");

  test("header + row_1..n from columns/rows; numbers formatted by decimals; integers untouched", () => {
    const l = table({ columns: ["Year", "2 %", "7 %"], rows: [[0, 100, 100], [10, 121.899, 196.715]], decimals: 1, title: "T" });
    expect(l.order).toEqual(["header", "row_1", "row_2", "title"]);
    const t = texts(l).map((d) => d.text);
    expect(t).toEqual(expect.arrayContaining(["Year", "2 %", "7 %", "0", "100", "10", "121.9", "196.7", "T"]));
    expect(l.warnings).toEqual([]);
  });

  test("a whole harvested DataFrame ({columns, rows}) feeds it through data; explicit columns/rows win", () => {
    const l = table({ data: { columns: ["a", "b"], rows: [[1, "x"], [2, "y"]] } });
    expect(l.order).toEqual(["header", "row_1", "row_2"]);
    const explicit = table({ data: { columns: ["a"], rows: [[1]] }, columns: ["z"], rows: [[9], [8], [7]] });
    expect(explicit.order).toEqual(["header", "row_1", "row_2", "row_3"]);
    expect(texts(explicit).map((d) => d.text)).toContain("z");
  });

  test("numeric columns are right-aligned, text columns left-aligned", () => {
    const l = table({ columns: ["name", "n"], rows: [["a", 1], ["b", 22]] });
    const cell = (id: string) => texts(l).find((d) => d.id === id)!;
    expect(cell("row_1__c0").anchor).toBe("start");
    expect(cell("row_1__c1").anchor).toBe("end");
  });

  test("rows beyond 24 (or beyond the box) are cut with a 'more rows' line", () => {
    const rows = Array.from({ length: 40 }, (_, i) => [i, i * 2]);
    const l = table({ columns: ["i", "2i"], rows });
    expect(l.order.filter((id) => id.startsWith("row_")).length).toBeLessThanOrEqual(24);
    expect(l.order).toContain("more");
    expect(texts(l).some((d) => /more rows/.test(d.text))).toBe(true);
  });

  test("an unresolved token draws just nothing (no header, no warnings) — rows beats come from typed data", () => {
    const l = table({ data: "{sim.df}" });
    expect(l.order).toEqual([]);
    expect(l.warnings).toEqual([]);
  });

  test("box confines the table", () => {
    const l = table({ columns: ["a"], rows: [[1]], box: { x: 500, y: 100, w: 400, h: 500 } });
    for (const d of texts(l)) expect(d.pos[0]).toBeGreaterThanOrEqual(500);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/data-pack.test.ts`
Expected: FAIL — `unknown template "data_table"`.

- [ ] **Step 3: Append the template to `src/scenes/packs/data.yaml`**

```yaml
---
template: data_table
title: Data table
version: 1
kit: 5
status: ready
description: >-
  A ruled table from data: a header row over an ink rule, then one drawable
  per row (`row_1`, `row_2`, …) so a table can fill in row by row on
  narration beats. Columns size to their content; numeric columns are
  right-aligned and formatted with `decimals`. Feed it typed `columns` and
  `rows`, or a code element's whole DataFrame with `data: "{id.df}"`. Choose
  this scene for ANY request to show a table of numbers, a comparison grid,
  a schedule of values year by year, or the rows of a data frame.
params:
  type: object
  properties:
    columns:
      type: array
      items: { type: string }
      maxItems: 8
      description: "Header labels, one per column."
    rows:
      type: array
      maxItems: 200
      items:
        type: array
        items:
          oneOf: [{ type: number }, { type: string }, { type: "null" }]
      description: "Cell values, one array per row (numbers stay numbers — they are formatted by decimals; strings are shown as written). At most 24 rows are drawn."
    data:
      oneOf:
        - type: object
          properties:
            columns: { type: array, items: { type: string } }
            rows: { type: array, items: { type: array } }
          required: [columns, rows]
        - { type: string, pattern: "^\\{[A-Za-z][A-Za-z0-9_]*\\.[A-Za-z_][A-Za-z0-9_.]*\\}$" }
      description: "A whole DataFrame — {columns, rows} as the runtime harvests it — usually as a \"{id.df}\" token. Explicit columns/rows win when both are given."
    decimals:
      type: integer
      minimum: 0
      maximum: 6
      description: "Decimals for non-integer numbers (default 2)."
    font_size:
      type: number
      minimum: 12
      maximum: 30
      description: "Cell text size (default 20)."
    box:
      type: object
      properties:
        x: { type: number }
        y: { type: number }
        w: { type: number }
        h: { type: number }
      required: [x, y, w, h]
      description: "Where the table sits (lower-left corner, width, height) when it shares the canvas. Default: the standard plot area; the table hangs from its top edge."
    title:
      type: string
element_ids:
  header: the header row (column names over an ink rule)
  row_1: "the first data row (row_2, row_3, … likewise) — draw them one per beat to fill the table in"
  more: "the '… N more rows' line when the data exceeds what fits"
  title: figure title, when set
examples:
  - request: "A table of 100 growing at 2 percent and 7 percent, every ten years for thirty years."
    params:
      columns: ["Year", "2 %", "7 %"]
      rows:
        - [0, 100, 100]
        - [10, 121.9, 196.7]
        - [20, 148.6, 387.0]
        - [30, 181.1, 761.2]
      decimals: 1
      title: "Compounding, decade by decade"
  - request: "Show the three countries and their GDP per capita as a table."
    params:
      columns: ["Country", "GDP per capita"]
      rows:
        - ["Norway", 87]
        - ["Sweden", 52]
        - ["Denmark", 58]
layout: |
  const C = kit.COLORS, MS = kit.SKETCH_MS;
  const num = (v, d) => (typeof v === "number" && Number.isFinite(v) ? v : d);
  const str = (v, d) => (typeof v === "string" && v.trim() !== "" ? v.trim() : d);
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  // data: a harvested DataFrame ({columns, rows}); a still-unresolved token is a string → no data.
  const data = params.data && typeof params.data === "object" ? params.data : null;
  const columns = (Array.isArray(params.columns) ? params.columns : data && Array.isArray(data.columns) ? data.columns : [])
    .map(String)
    .slice(0, 8);
  const rowsIn = Array.isArray(params.rows) ? params.rows : data && Array.isArray(data.rows) ? data.rows : [];
  const dec = clamp(Math.round(num(params.decimals, 2)), 0, 6);
  const cell = (c) => (c === null || c === undefined ? "" : typeof c === "number" ? (Number.isInteger(c) ? String(c) : c.toFixed(dec)) : String(c));
  const rows = rowsIn.filter(Array.isArray).map((r) => columns.map((_, j) => cell(r[j])));
  const fontSize = clamp(num(params.font_size, 20), 12, 30);
  const rowH = fontSize * 1.6;
  const b = params.box;
  const box = b && typeof b === "object" && [b.x, b.y, b.w, b.h].every((v) => typeof v === "number" && Number.isFinite(v)) && b.w > 0 && b.h > 0
    ? { x0: b.x, y0: b.y, x1: b.x + b.w, y1: b.y + b.h }
    : kit.plotArea();
  const CAP = 24;
  const fit = Math.max(1, Math.floor((box.y1 - box.y0) / rowH) - 2); // header + a "more" line
  const shown = rows.slice(0, Math.min(CAP, fit));
  const more = rows.length - shown.length;

  const drawables = [], anchors = {}, order = [];
  const push = (d) => { drawables.push(d); order.push(d.id); };
  if (columns.length === 0) return { drawables, labels: [], anchors, order };

  // Column widths ∝ the widest cell (header included), clamped into the box.
  const charW = fontSize * 0.55;
  const raw = columns.map((c, j) => Math.max(c.length, 1, ...shown.map((r) => r[j].length)) * charW + fontSize);
  const total = raw.reduce((a, v) => a + v, 0) || 1;
  const widths = raw.map((w) => (w / total) * (box.x1 - box.x0));
  const colX = (j) => box.x0 + widths.slice(0, j).reduce((a, v) => a + v, 0);
  const rowTop = (r) => box.y1 - r * rowH; // r = 0 → the header's top edge
  const numeric = columns.map((_, j) => shown.length > 0 && shown.every((r) => r[j] === "" || /^-?\d[\d.,]*%?$/.test(r[j])));
  const cellText = (id, r, j, text, color) =>
    kit.text(id, [numeric[j] ? colX(j) + widths[j] - fontSize / 2 : colX(j) + fontSize / 2, rowTop(r) - rowH / 2], text, {
      fontSize,
      anchor: numeric[j] ? "end" : "start",
      ...(color ? { color } : {}),
    });

  const head = columns.map((c, j) => cellText("header__c" + j, 0, j, c, C.ink));
  head.push(kit.stroke("header__rule", [[box.x0, rowTop(1)], [box.x1, rowTop(1)]], { strokeWidth: 2.5, ms: MS.stroke }));
  push(kit.group("header", head));
  anchors.header = [(box.x0 + box.x1) / 2, rowTop(0) - rowH / 2];

  shown.forEach((r, i) => {
    const id = "row_" + (i + 1);
    const kids = r.map((text, j) => cellText(id + "__c" + j, i + 1, j, text));
    kids.push(kit.stroke(id + "__rule", [[box.x0, rowTop(i + 2)], [box.x1, rowTop(i + 2)]], { color: C.guide, strokeWidth: 1, instant: true }));
    push(kit.group(id, kids));
    anchors[id] = [(box.x0 + box.x1) / 2, rowTop(i + 1) - rowH / 2];
  });

  if (more > 0) {
    const y = rowTop(shown.length + 1) - rowH / 2;
    push(kit.text("more", [box.x0 + fontSize / 2, y], "… " + more + " more rows", { fontSize, anchor: "start", color: C.guide }));
    anchors.more = [(box.x0 + box.x1) / 2, y];
  }

  const title = str(params.title, "");
  if (title) {
    const ty = Math.min(700, box.y1 + 25);
    push(kit.text("title", [(box.x0 + box.x1) / 2, ty], title, { fontSize: 30 }));
    anchors.title = [(box.x0 + box.x1) / 2, ty];
  }
  return { drawables, labels: [], anchors, order };
```

Spec amendment — §6.5, replace the sentence beginning "Drawn with `kit.table`:" with: "Drawn as one group per row from `kit.stroke`/`kit.text` (`kit.table` draws a single uniform grid and cannot give per-row ids or content-sized columns): header row over an ink rule, guide-colored row rules, columns sized to content and clamped to the box, numeric columns right-aligned."

- [ ] **Step 4: Run the suite**

Run: `npm test`
Expected: PASS (73 ready templates).

- [ ] **Step 5: Commit**

```bash
git add src/scenes/packs/data.yaml docs/superpowers/specs/2026-09-02-code-data-bridge-design.md tests/data-pack.test.ts
git commit -m "feat(scenes): data_table — header + per-row beats from typed rows or a harvested DataFrame"
```

---

### Task 12: Model-facing surface — prompt, schema descriptions, few-shot, bundled examples

Spec §3.3, §9.3.

**Files:**
- Modify: `src/llm/prompts/compiler-v1.md` (the `animate` bullet at line 39; a new bullet after the `code` bullet at line 44)
- Modify: `src/spec/schema.ts:189-193` (`code` description), `:425` (`animate` description), `:498` (`params` description)
- Modify: `src/llm/prompts/fewshots.json` (append one pair)
- Modify: `src/examples.json` (append two examples, textually)
- Modify: `tests/prompt.test.ts`, `tests/fewshots.test.ts`
- Test: `tests/examples.test.ts`, `tests/translate-coverage.test.ts` (existing; must stay green)

- [ ] **Step 1: Write the failing drift tests**

Append to `tests/prompt.test.ts` inside the `describe("compiler prompt style rules"`:

```ts
  test("teaches the data bridge: tokens, depth-means-staged, typed labels", () => {
    expect(compilerV1).toContain('"{sim.y}"');
    expect(compilerV1).toContain("Depth means staged");
    expect(compilerV1).toContain("TYPE the labels");
    expect(compilerV1).toContain('"show": "none"');
  });
```

In `tests/fewshots.test.ts`, add at the top (after the imports):

```ts
import { beforeAll } from "vitest";
import { ensureEnabledPacks } from "../src/scenes/packs";

beforeAll(async () => {
  // The data-bridge few-shot uses the data pack's bar_chart.
  await ensureEnabledPacks(["data"]);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/prompt.test.ts`
Expected: FAIL — the phrases are absent.

- [ ] **Step 3: Edit `src/llm/prompts/compiler-v1.md`**

Change the end of the `animate` bullet (line 39) from `…only numeric params animate, and only on template specs. One or two animate beats per figure at the moments of change; draw the elements first, animate them after.` to `…only numeric params animate, and only on template specs — including a data template's `stage` (`{"animate": {"stage": 1}}` grows and shrinks the bars from one stage of the data to the next) and single array entries (`{"animate": {"values.2": 40}}`). One or two animate beats per figure at the moments of change; draw the elements first, animate them after.`

Insert a new bullet directly after the `code` bullet (line 44):

```
- **Data from code, drawn as ink.** A template param may name a code element's variable with a TOKEN: `"values": "{sim.y}"`, `"labels": "{sim.df.country}"` (a DataFrame column), `"data": "{sim.df}"` (a whole frame). The script runs once, the app substitutes the values, and the template draws them as vector geometry — so use `bar_chart` / `data_table` with a token INSTEAD of `plt.bar(...)` or a printed frame whenever the numbers come from computation; the chart then animates, scrubs and exports exactly, and costs bytes, not pixels. Rules: the variable must be a number, list, dict, Series or DataFrame (`frames = [df.y2010.tolist(), df.y2020.tolist()]`); **Depth means staged** — a list of lists is stages of the SAME chart, and `{"animate": {"stage": 1}}` plays the change; ALWAYS write the starting `"stage": 0`; **TYPE the labels by hand** even when values come from the script, so the `bar_1` … `bar_n` beats exist before it has run; a script that only feeds data gets `"show": "none"` (nothing drawn — no line beats, no output pane), one that is part of the story gets `"show": "code"` beside the chart's `box`. Example: `{"template": "bar_chart", "params": {"labels": ["Norway", "Sweden", "Denmark"], "values": "{gdp.frames}", "stage": 0, "title": "GDP per capita, 2010 → 2020"}, "elements": [{"id": "gdp", "type": "code", "language": "python", "show": "none", "code": "import pandas as pd\ndf = pd.DataFrame({\"c\": [\"Norway\", \"Sweden\", \"Denmark\"], \"y2010\": [87, 52, 58], \"y2020\": [67, 52, 61]})\nframes = [df.y2010.tolist(), df.y2020.tolist()]"}], "commands": [{"draw": ["axes", "bar_1", "bar_2", "bar_3"], "speak": "In 2010 Norway towered over its neighbours."}, {"animate": {"stage": 1}, "duration": 3, "speak": "Ten years on, the oil price took the tower down."}]}`. Never put a token inside a longer string, and never reference an element that is not a code element.
```

- [ ] **Step 4: Edit the schema descriptions in `src/spec/schema.ts`**

Append to the `code` description (line ~191, before the closing quote): ` A script can also FEED a template: any params value written as "{<this id>.<variable>}" is replaced by that variable after the run (lists, numbers, dicts, a DataFrame as {columns, rows}); with show: "none" the element draws nothing and only supplies data.`

Append to the `animate` description (line 425): ` A data template's stage param is the canonical target ({"stage": 1}); array entries address as values.2.`

Change the `params` description (line 498) to: `"Scene template parameters, per the catalog's parameter schema. A value may be a \"{codeId.variable}\" token naming a code element's script variable (or \"{codeId.df.column}\" for a DataFrame column) — the app substitutes the harvested value before drawing."`

- [ ] **Step 5: Append the few-shot pair to `src/llm/prompts/fewshots.json`**

Append this object to the array (keep the file's existing 2-space formatting; add a comma after the previous entry):

```json
  {
    "request": "Roll a die 100 times and then 10,000 times and show how the shares of each face settle down",
    "spec": {
      "title": "The law of large numbers, one die at a time",
      "template": "bar_chart",
      "params": {
        "labels": ["1", "2", "3", "4", "5", "6"],
        "values": "{dice.frames}",
        "stage": 0,
        "ylim": [0, 0.3],
        "y_label": "Share of rolls",
        "value_labels": true,
        "title": "Six faces, 100 rolls then 10,000"
      },
      "elements": [
        {
          "id": "dice",
          "type": "code",
          "language": "python",
          "show": "none",
          "code": "import numpy as np\nrng = np.random.default_rng(7)\ndef shares(n):\n    rolls = rng.integers(1, 7, size=n)\n    return [round(float((rolls == f).mean()), 3) for f in range(1, 7)]\nframes = [shares(100), shares(10000)]"
        }
      ],
      "commands": [
        { "draw": ["title"], "speak": "Is a die fair? Ask it a hundred times, then ten thousand." },
        { "draw": ["axes", "bar_1", "bar_2", "bar_3", "bar_4", "bar_5", "bar_6"], "parallel": true, "speak": "A hundred rolls: the faces come up unevenly, some near a quarter, some barely a tenth." },
        { "point": { "at": { "ref": "bar_6" } }, "speak": "Nothing is wrong with the die — a hundred is just too few." },
        { "animate": { "stage": 1 }, "duration": 3, "speak": "Ten thousand rolls, and every face settles toward one sixth." },
        { "highlight": { "target": ["bar_1", "bar_6"] }, "speak": "The law of large numbers is not that luck evens out — it is that luck gets diluted." }
      ]
    }
  }
```

- [ ] **Step 6: Append two bundled examples to `src/examples.json`** (textually — never re-serialize the file)

Write the two objects to a scratch file `/tmp/new-examples.json` as a JSON array:

```json
[
  {
    "request": "Show GDP per capita for Norway, Sweden and Denmark in 2010 and 2020, computing the numbers in Python and animating the change",
    "packs": ["data"],
    "spec": {
      "title": "GDP per capita, 2010 → 2020",
      "template": "bar_chart",
      "params": {
        "labels": ["Norway", "Sweden", "Denmark"],
        "values": "{gdp.frames}",
        "stage": 0,
        "value_labels": true,
        "y_label": "USD (thousands)",
        "box": { "x": 470, "y": 95, "w": 470, "h": 560 }
      },
      "elements": [
        {
          "id": "gdp",
          "type": "code",
          "language": "python",
          "show": "code",
          "x": 225,
          "y": 400,
          "width": 410,
          "font_size": 15,
          "code": "import pandas as pd\ndf = pd.DataFrame({\n    \"country\": [\"Norway\", \"Sweden\", \"Denmark\"],\n    \"y2010\": [87, 52, 58],\n    \"y2020\": [67, 52, 61]})\nframes = [df.y2010.tolist(), df.y2020.tolist()]"
        }
      ],
      "commands": [
        { "draw": ["gdp", "gdp_line_1", "gdp_line_2", "gdp_line_3", "gdp_line_4", "gdp_line_5"], "parallel": true, "speak": "Three countries, two years, one data frame." },
        { "draw": ["gdp_line_6"], "speak": "Two lists of three numbers — that is all the chart needs." },
        { "draw": ["axes", "bar_1", "bar_2", "bar_3"], "parallel": true, "speak": "In 2010 Norway towered over its neighbours." },
        { "animate": { "stage": 1 }, "duration": 3, "speak": "Ten years on, the oil price took the tower down while Denmark crept up." },
        { "highlight": { "target": ["bar_1"] }, "speak": "Same bars, same axes — only the numbers moved. That is what a chart drawn from data can do." }
      ]
    }
  },
  {
    "request": "A table showing 100 growing at 2 percent versus 7 percent, decade by decade, revealed one row at a time",
    "packs": ["data"],
    "spec": {
      "title": "Compounding, decade by decade",
      "template": "data_table",
      "params": {
        "columns": ["Year", "At 2 %", "At 7 %"],
        "rows": [[0, 100, 100], [10, 121.9, 196.7], [20, 148.6, 387.0], [30, 181.1, 761.2]],
        "decimals": 1,
        "font_size": 24,
        "box": { "x": 200, "y": 300, "w": 600, "h": 340 },
        "title": "Compounding, decade by decade"
      },
      "commands": [
        { "draw": ["title"], "speak": "Does the interest rate really matter? Let the numbers speak, ten years at a time." },
        { "draw": ["header", "row_1"], "parallel": true, "speak": "Both start at one hundred." },
        { "draw": ["row_2"], "speak": "After ten years: one twenty-two against nearly two hundred." },
        { "draw": ["row_3"], "speak": "After twenty: one forty-nine against three eighty-seven." },
        { "draw": ["row_4"], "delivery": "grave", "speak": "After thirty: one eighty-one — against seven hundred and sixty. The rate was three and a half times higher; the money is four times more." }
      ]
    }
  }
]
```

Then append them with this one-off node script (run from the repo root):

```bash
node -e '
const fs = require("fs");
const path = "src/examples.json";
const text = fs.readFileSync(path, "utf8");
const add = JSON.parse(fs.readFileSync("/tmp/new-examples.json", "utf8"));
const body = add.map((e) => JSON.stringify(e, null, 1).split("\n").map((l) => " " + l).join("\n")).join(",\n");
const trimmed = text.replace(/\s*\]\s*$/, "");
fs.writeFileSync(path, trimmed + ",\n" + body + "\n]\n");
'
git diff --stat src/examples.json
```

Expected: the diff shows only additions (roughly 120 lines), no deletions.

- [ ] **Step 7: Run the suite**

Run: `npm test`
Expected: PASS — including `tests/examples.test.ts` (both examples validate, lay out with every command id resolved: the placeholder bars come from the typed labels; the table rows are typed), `tests/translate-coverage.test.ts` (typed labels are translatable; code lines and computed captions are collected from the layout), `tests/fewshots.test.ts`, `tests/prompt.test.ts`. If `examples.test.ts` reports an overlap lint error between the code panel and the chart in the GDP example, widen the gap by moving the code element's `x` to 215 and re-run; do not change the box.

- [ ] **Step 8: Commit**

```bash
git add src/llm/prompts/compiler-v1.md src/spec/schema.ts src/llm/prompts/fewshots.json src/examples.json tests/prompt.test.ts tests/fewshots.test.ts
git commit -m "feat(llm): teach the data bridge — prompt bullet, schema hints, a few-shot and two bundled examples"
```

---

### Task 13: Final verification, browser smoke, push

- [ ] **Step 1: Full suite, type check, engine build**

Run: `npm test && npx tsc --noEmit && npm run build`
Expected: all green. (Do NOT run `npm run build:engine` unless you intend to rebuild `dist-engine` — it deletes the directory first.)

- [ ] **Step 2: Browser smoke (record outcomes in the final commit message or the memory handoff)**

`npm run dev`, open the app, Examples → "Show GDP per capita for Norway, Sweden and Denmark…":
1. The chart's bars have the 2010 heights after the code runs (not zero) — the resolver substituted `frames`.
2. Play: bars grow/shrink smoothly on the animate beat; scrub back and forth — the tween is exact.
3. Settings → developer mode → lint chip shows no `code-use` warning for the example.
4. Change `values: "{gdp.framez}"` in the editor: the chart falls back to zero-height placeholder bars and the lint chip shows `{gdp.framez} — no variable framez`.
5. Export video (short): the bars animate in the recording.

- [ ] **Step 3: Push**

```bash
git branch --show-current   # must print main
git push origin main
git ls-remote origin main | cut -c1-12 && git rev-parse --short=12 HEAD   # must match
```

---

## Self-review (done while writing)

- **Spec coverage, M1 bullet:** token scan/substitute (T1, T6), `paths` in request/envelope (T2), Python harvest (T3), cache key (T2), skip rule (T6), `show: none` (T5), lint (T7), execution check + post-substitution schema validation (T8), i18n exemption (T7), array-index params (T4), `COLORS.series` kit v5 (T9), `bar_chart` (T10), `data_table` (T11), prompt + few-shot + two examples (T12). Deferred to M2/M3 per spec §12: `line_chart`, `scatter_plot`, `x-max-from` tray hint, threshold 100, `packsDefault` — note: this plan bumps `packsDefault` to v7 already (T10) because the pack ships now; M2 needs no further bump.
- **Placeholders:** none; every step carries its code or its exact command.
- **Type consistency:** `DataToken.at` is `(string|number)[]` in T1 and in T7's error path; `CodeRunResult.data/dataErrors` names match across T2, T3, T6, T8; `CodeResolution.skipped` is set only by the skip rule (T6 tests assert the exact object); `templateParamIssues(templateId, params, strict)` signature is the same in T8's module and its `compile.ts` call; `kit.plotArea()` is added in T9 and used by both templates in T10/T11; `COLORS.series[0]` is `#b5482e`, which T10's test pins.
- **Spec amendments carried by tasks:** T5 (layout.ts touched), T11 (`kit.table` → per-row groups).
