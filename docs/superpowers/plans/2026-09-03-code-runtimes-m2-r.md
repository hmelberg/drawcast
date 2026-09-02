# Code runtimes M2 — R via webR: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `language: r` code elements run for real in the viewer's browser through pinned webR 0.6.0, with stdout/stderr, a trailing data frame as a table, base and ggplot2 plots as PNG figures, and the `{id.path}` data bridge — behind the same facade and envelope pyodide uses.

**Architecture:** One dependency-free `languages.ts` declares the four languages and their pinned versions; `run.ts` dispatches through a table of dynamic imports; the plotly renderer leaves `pyodide.ts` for a shared module. `webr.ts` boots webR once, pre-installs scanned packages, and runs each script through an R wrapper (built in `harvest-r.ts`) that evaluates with console semantics, catches conditions in R, serializes the trailing table in base R and the data bridge through jsonlite, and hands back one character vector the TS side reads. Plots arrive as ImageBitmaps and become PNG data URIs in `png.ts`.

**Tech Stack:** TypeScript (Vite, vitest), webR 0.6.0 ESM from `https://webr.r-wasm.org/v0.6.0/webr.mjs`, R packages from `repo.r-wasm.org`, jsonlite (installed on first need), plotly.js 2.32.0 (existing).

**Spec:** `docs/superpowers/specs/2026-09-03-code-runtimes-design.md` (§3 isolation budget, §4 shared architecture, §5 R runtime, §7 prompt, §8 tests, §11 smoke items).

## Global Constraints

- Core edits are ONLY those in spec §3; layout, render, resolve, hoist, player, export, `src/scenes/engines.ts`, Vite configs stay untouched.
- Runtime modules are reached only via dynamic `import()` inside `src/code/`; never statically imported elsewhere.
- webR pinned: `https://webr.r-wasm.org/v0.6.0/webr.mjs`, `RUNTIME_VERSION.r = "0.6.0"`; cache tag `r0.6.0`.
- `CODE_VERSION` stays 5 (envelope unchanged).
- Failures are envelopes, never throws; never cached. `runtimeUnavailable` marks "the runtime itself could not start".
- Caps: tables 30 rows; data bridge 5000 numbers / 200 rows, caps are ERRORS per path, never truncation.
- No `console.log` left behind; comments in the house voice (say why, name the trap).
- Tests: `npm test` (vitest, node only, no WASM, no network). `tsc` clean. `npm run build` and `npm run build:engine` clean.
- Commit after each task; push at the end of the plan (Hans: "implement all", push pre-authorized by the push-always rule).

---

### Task 1: `languages.ts` — one declaration, wired into types, schema, cache key, check

**Files:**
- Create: `src/code/languages.ts`
- Modify: `src/spec/types.ts:131-133`, `src/spec/schema.ts:185-189` and `:879`, `src/code/run.ts` (cache key + `CodeRunRequest.language`), `src/code/check.ts:38-58`
- Test: `tests/code-runtimes.test.ts` (new)

**Interfaces:**
- Produces: `LANGUAGES`, `Language`, `isLanguage(x): x is Language`, `RUNTIME_LABEL`, `RUNTIME_VERSION`, `PYLIB_VERSION`, `cacheTag(language)`.
- `CodeRunRequest.language: Language` (was `"python" | "r"`); `codeCacheKey` uses `cacheTag`.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/code-runtimes.test.ts
// The multi-runtime seam: one declaration of the languages (languages.ts)
// that types, schema, cache key, dispatch, check and the prompt all read —
// so adding a runtime is one entry, and drift between them is a test failure.

import { describe, expect, test } from "vitest";
import { LANGUAGES, RUNTIME_LABEL, RUNTIME_VERSION, cacheTag, isLanguage } from "../src/code/languages";
import { validateSpec, SPEC_SCHEMA } from "../src/spec/schema";
import { codeCacheKey, runCode } from "../src/code/run";
import { codeExecutionErrors } from "../src/code/check";
import type { Spec } from "../src/spec/types";
import type { CodeRunRequest, CodeRunResult } from "../src/code/run";

const spec = (el: object): Spec =>
  ({ elements: [{ id: "c1", type: "code", ...el }], commands: [] }) as unknown as Spec;

describe("languages — one declaration", () => {
  test("the four languages, each with a label and a pinned version", () => {
    expect([...LANGUAGES]).toEqual(["python", "r", "brython", "micropython"]);
    for (const l of LANGUAGES) {
      expect(RUNTIME_LABEL[l]).toBeTruthy();
      expect(RUNTIME_VERSION[l]).toMatch(/^\d+\.\d+\.\d+$/);
    }
    expect(isLanguage("r")).toBe(true);
    expect(isLanguage("cobol")).toBe(false);
  });

  test("the schema enum is exactly LANGUAGES", () => {
    const props = (SPEC_SCHEMA as { properties: { elements: { items: { properties: { language: { enum: string[] } } } } } })
      .properties.elements.items.properties.language;
    expect(props.enum).toEqual([...LANGUAGES]);
    for (const l of LANGUAGES) expect(validateSpec(spec({ language: l, code: "1" })).ok).toBe(true);
  });

  test("cache tags pin each runtime's version; the dialects also pin the library snapshot", () => {
    expect(cacheTag("python")).toBe(`py${RUNTIME_VERSION.python}`);
    expect(cacheTag("r")).toBe(`r${RUNTIME_VERSION.r}`);
    expect(cacheTag("brython")).toMatch(new RegExp(`^bry${RUNTIME_VERSION.brython}\\+\\d{4}-\\d{2}-\\d{2}$`));
    expect(cacheTag("micropython")).toMatch(new RegExp(`^mpy${RUNTIME_VERSION.micropython}\\+\\d{4}-\\d{2}-\\d{2}$`));
    const tags = new Set(LANGUAGES.map((l) => codeCacheKey({ language: l, code: "1" })));
    expect(tags.size).toBe(LANGUAGES.length);
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
    const s = spec({ language: "r", code: "1" });
    const out = await codeExecutionErrors(s, run);
    expect(out.errors).toEqual([]);
    expect(out.warnings[0]).toContain("the R runtime could not load");
  });
});

describe("dispatch — node has no browser, so every runtime degrades to an unavailable envelope", () => {
  test.each([...LANGUAGES])("%s", async (language) => {
    const res = await runCode({ language, code: "1" }, { cacheGet: async () => null, cachePut: async () => {} });
    expect(res.ok).toBe(false);
    expect(res.runtimeUnavailable).toBe(true);
  });
});
```

Note: the dispatch test needs Tasks 5–6 of THIS plan for `r` and the M3/M4 plans for the dialects. Until those land, make the table map `brython` and `micropython` to a stub module (Step 3) so the test passes now and the M3/M4 plans replace the stubs.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/code-runtimes.test.ts`
Expected: FAIL — `../src/code/languages` does not exist.

- [ ] **Step 3: Implement `languages.ts`**

```ts
// src/code/languages.ts
// The one place a code runtime is declared. Types, the schema enum, the
// cache key, the dispatch table, the authoring-time check and the prompt
// drift test all read this — so adding a runtime is one entry here plus its
// module, and a list that drifts from another is a test failure, not a
// silent gap (the vocabulary-in-five-places trap).
//
// Dependency-free on purpose: imported by spec/types.ts and spec/schema.ts,
// which must not transitively pull IndexedDB or any runtime loader.

export const LANGUAGES = ["python", "r", "brython", "micropython"] as const;
export type Language = (typeof LANGUAGES)[number];

export function isLanguage(x: unknown): x is Language {
  return typeof x === "string" && (LANGUAGES as readonly string[]).includes(x);
}

/** What the loading pill and the check's warnings call each runtime. */
export const RUNTIME_LABEL: Record<Language, string> = {
  python: "Python",
  r: "R",
  brython: "Brython",
  micropython: "MicroPython",
};

/** Pinned runtime versions — part of the cache key, so an upgrade misses
 *  cleanly instead of replaying stale output. python: pyodide (openstat's
 *  verified pin); r: webR; brython: the jsdelivr bundle; micropython: the
 *  pyscript WebAssembly build openstat runs. */
export const RUNTIME_VERSION: Record<Language, string> = {
  python: "314.0.2",
  r: "0.6.0",
  brython: "3.12.0",
  micropython: "1.27.0",
};

/** The vendored pure-Python library snapshot (public/pylib/<version>/) the
 *  dialects load. A new snapshot changes outputs exactly like a runtime
 *  upgrade, so it rides in the dialects' cache tag. */
export const PYLIB_VERSION = "2026-09-03";

export function cacheTag(language: Language): string {
  switch (language) {
    case "python":
      return `py${RUNTIME_VERSION.python}`;
    case "r":
      return `r${RUNTIME_VERSION.r}`;
    case "brython":
      return `bry${RUNTIME_VERSION.brython}+${PYLIB_VERSION}`;
    case "micropython":
      return `mpy${RUNTIME_VERSION.micropython}+${PYLIB_VERSION}`;
  }
}
```

- [ ] **Step 4: Wire types, schema, run.ts, check.ts**

`src/spec/types.ts` — replace the `language` line:

```ts
import type { Language } from "../code/languages";
// …
  /** code: the runtime that executes the script — see src/code/languages.ts. */
  language?: Language;
```

`src/spec/schema.ts` — the `language` property and the `need`:

```ts
import { LANGUAGES, isLanguage } from "../code/languages";
// …
    language: {
      type: "string",
      enum: [...LANGUAGES],
      description:
        "code: the runtime that executes the script. python = full CPython (numpy, pandas, matplotlib, plotly, PyPI on demand). r = R via webR (base or tidyverse; library() auto-installs; every top-level expression prints as at the console; a trailing data frame draws as a table, a base plot or a printed ggplot as a figure). brython and micropython are not available yet — never emit them.",
    },
// …
      need(isLanguage(el.language), `needs language: ${LANGUAGES.map((l) => `"${l}"`).join(" | ")}`);
```

`src/code/run.ts` — import and use:

```ts
import { cacheTag, type Language } from "./languages";
export { LANGUAGES, RUNTIME_VERSION, cacheTag, type Language } from "./languages";
// keep the old export alive for anything that imports it:
export const PYODIDE_VERSION = RUNTIME_VERSION.python;

export interface CodeRunRequest {
  language: Language;
  // … unchanged
}

export function codeCacheKey(req: Pick<CodeRunRequest, "language" | "code" | "paths">): string {
  const tag = cacheTag(req.language);
  const paths = [...(req.paths ?? [])].sort().join(",");
  return `c${CODE_VERSION}|${tag}|${hash(req.code)}|${req.code.length}|${hash(paths)}`;
}
```

(`RUNTIME_VERSION` must be imported, not only re-exported, for `PYODIDE_VERSION`.) Replace `defaultRunner` with the dispatch table — for THIS task the R/dialect entries point at a stub so the node test passes; Task 5 swaps `r` to `./webr`:

```ts
/** Every runtime module exports run(req). Reached only here, only lazily. */
const RUNTIMES: Record<Language, () => Promise<{ run: (req: CodeRunRequest) => Promise<CodeRunResult> }>> = {
  python: () => import("./pyodide"),
  r: () => import("./not-yet"),
  brython: () => import("./not-yet"),
  micropython: () => import("./not-yet"),
};

async function defaultRunner(req: CodeRunRequest): Promise<CodeRunResult> {
  let mod: { run: (req: CodeRunRequest) => Promise<CodeRunResult> };
  try {
    mod = await RUNTIMES[req.language]();
  } catch (err) {
    // A failed chunk load (offline, CDN down) is a runtime problem, not a
    // script bug — tag it so codeExecutionErrors can warn instead of
    // blocking generation on it.
    const tagged = new Error((err as Error).message) as Error & { runtimeUnavailable?: boolean };
    tagged.runtimeUnavailable = true;
    throw tagged;
  }
  return mod.run(req);
}
```

`src/code/not-yet.ts` (deleted by the M4 plan once every runtime exists):

```ts
// Placeholder runtime for languages whose module has not landed yet: an
// unavailable envelope, so the check warns instead of erroring and the
// element draws its error panel. Deleted when the last runtime lands.
import type { CodeRunRequest, CodeRunResult } from "./run";
import { RUNTIME_LABEL } from "./languages";

export async function run(req: CodeRunRequest): Promise<CodeRunResult> {
  return { ok: false, stdout: "", stderr: "", figures: [], error: `the ${RUNTIME_LABEL[req.language]} runtime is not available yet`, runtimeUnavailable: true };
}
```

`src/code/pyodide.ts` — add at the end: `export const run = runPython;`.

`src/code/check.ts` — the loop and the warning:

```ts
import { RUNTIME_LABEL } from "./languages";
// …
    if (el.type !== "code" || !el.language || !el.code) continue;
    const paths = byId[el.id] ?? [];
    let res: CodeRunResult;
    try {
      res = await run({ language: el.language, code: el.code, paths });
    } catch { continue; }
    if (res.runtimeUnavailable) {
      out.warnings.push(`code "${el.id}" — the ${RUNTIME_LABEL[el.language]} runtime could not load — script not verified`);
      continue;
    }
```

`SPEC_SCHEMA` must be exported from `schema.ts` if it is not already (check the name; adapt the test to the exported schema object's actual name).

- [ ] **Step 5: Run the tests**

Run: `npx vitest run tests/code-runtimes.test.ts tests/code-element.test.ts tests/code-data-bridge.test.ts && npx tsc --noEmit`
Expected: PASS; the existing "cache key pins version" test still sees `c5|py`.

- [ ] **Step 6: Commit**

```bash
git add src/code/languages.ts src/code/not-yet.ts src/code/run.ts src/code/check.ts src/code/pyodide.ts src/spec/types.ts src/spec/schema.ts tests/code-runtimes.test.ts
git commit -m "feat(code): one declaration of the runtimes — languages.ts drives types, schema, cache tag, dispatch and the check"
```

---

### Task 2: Shared `plotly-render.ts` and `png.ts`

**Files:**
- Create: `src/code/plotly-render.ts`, `src/code/png.ts`
- Modify: `src/code/pyodide.ts` (remove `PLOTLY_JS_URL`, `PlotlyJs`, `loadPlotly`, `renderPlotlyFigures`; import `renderPlotlyFigures` from `./plotly-render`)

**Interfaces:**
- Produces: `renderPlotlyFigures(jsons: string[]): Promise<CodeFigure[]>`, `loadPlotly()`, `bitmapToFigure(bitmap: ImageBitmap): CodeFigure`.

- [ ] **Step 1: Create `plotly-render.ts`** — move the block verbatim from `pyodide.ts` (the `PLOTLY_JS_URL` constant, the `PlotlyJs` interface, `plotlyPromise`, `loadPlotly`, `renderPlotlyFigures`) with this header:

```ts
// plotly.js as a static-image renderer, shared by every runtime that yields
// plotly figure JSON (pyodide's plotly, the dialects' plotly.express
// emulation, later R's ggplotly): offscreen newPlot → toImage PNG at 2×, so
// a chart drops into the SVG scene and the video export like any matplotlib
// image. Live interactivity is the overlay of a later round, not this.
//
// openstat's production pin — the family's verified plotly.js.
import type { CodeFigure } from "./envelope";
```

- [ ] **Step 2: Create `png.ts`**

```ts
// ImageBitmap → PNG data URI with pixel dimensions: what webR's canvas
// device hands back per plot page. Browser-only (a canvas is the encoder);
// the runtime modules that call it already refuse to run without a DOM.
import type { CodeFigure } from "./envelope";

export function bitmapToFigure(bitmap: ImageBitmap): CodeFigure {
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no 2d canvas context to encode the plot");
  ctx.drawImage(bitmap, 0, 0);
  const href = canvas.toDataURL("image/png");
  return { href, w: bitmap.width, h: bitmap.height };
}
```

- [ ] **Step 3: Point `pyodide.ts` at the shared module**

Replace the moved block with `import { renderPlotlyFigures } from "./plotly-render";` and keep the call site unchanged.

- [ ] **Step 4: Verify**

Run: `npm test && npx tsc --noEmit`
Expected: PASS, no behaviour change (no test touches plotly.js).

- [ ] **Step 5: Commit**

```bash
git add src/code/plotly-render.ts src/code/png.ts src/code/pyodide.ts
git commit -m "refactor(code): plotly renderer and PNG encoder shared across runtimes"
```

---

### Task 3: `harvest-r.ts` — the R scripts, built and tested in node

**Files:**
- Create: `src/code/harvest-r.ts`
- Test: `tests/code-r.test.ts` (new)

**Interfaces:**
- Produces: `rPackagesIn(code: string): string[]`, `R_WRAPPER: string`, `R_BASE_PACKAGES: ReadonlySet<string>`, `GGPLOT_BASE_SIZE`, `R_TABLE_CAP = 30`, `R_DATA_CAP_NUMBERS = 5000`, `R_DATA_CAP_ROWS = 200`, `R_BOOT: string`.
- The wrapper reads two variables from its evaluation environment: `.__code` (the script, one string) and `.__paths` (requested dotted paths joined by `"\n"`, `""` for none). Its VALUE is `c(error, stderr, table_json, data_json)` — four strings, empty when absent.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/code-r.test.ts
// The R side of the code element that node can see: package pre-scan, and
// the wrapper script's contract (the variables it reads, the four-string
// value it returns, the caps it carries). webR itself runs only in a
// browser — the live smoke covers execution.

import { describe, expect, test } from "vitest";
import { R_BOOT, R_DATA_CAP_NUMBERS, R_DATA_CAP_ROWS, R_TABLE_CAP, R_WRAPPER, rPackagesIn } from "../src/code/harvest-r";

describe("rPackagesIn — what to install before the run", () => {
  test("library, require, requireNamespace and pkg:: forms, deduplicated, in order", () => {
    const code = `library(ggplot2)\nrequire("dplyr")\nrequireNamespace('tidyr')\ndata.table::fread("x")\nlibrary(ggplot2)`;
    expect(rPackagesIn(code)).toEqual(["ggplot2", "dplyr", "tidyr", "data.table"]);
  });
  test("base and recommended-by-default names are not packages to install", () => {
    expect(rPackagesIn("library(stats)\nutils::head(x)\nlibrary(graphics)\nwebr::install('x')")).toEqual([]);
  });
  test("a comment is not a package", () => {
    expect(rPackagesIn("# library(ggplot2) later\nx <- 1")).toEqual([]);
  });
});

describe("R wrapper — contract", () => {
  test("reads .__code and .__paths, returns four strings", () => {
    expect(R_WRAPPER).toContain(".__code");
    expect(R_WRAPPER).toContain(".__paths");
    expect(R_WRAPPER.trim().split("\n").at(-1)).toMatch(/^c\(\.__err, .*\.__table_json, .*\.__data_json\)\)?$/);
  });
  test("carries the caps as errors, never truncation, with the Python wording", () => {
    expect(R_WRAPPER).toContain(`${R_TABLE_CAP}L`);
    expect(R_WRAPPER).toContain(`${R_DATA_CAP_NUMBERS}L`);
    expect(R_WRAPPER).toContain(`${R_DATA_CAP_ROWS}L`);
    expect(R_WRAPPER).toContain("downsample or aggregate in the script");
    expect(R_WRAPPER).toContain("aggregate or sample in the script");
  });
  test("console semantics: autoprint for all but the last expression, withVisible for the last", () => {
    expect(R_WRAPPER).toContain("withAutoprint(");
    expect(R_WRAPPER).toContain("withVisible(");
    expect(R_WRAPPER).toContain("is.data.frame(");
  });
  test("boot installs the library() shim and the ggplot2 theme hook", () => {
    expect(R_BOOT).toContain("webr::shim_install()");
    expect(R_BOOT).toContain('packageEvent("ggplot2", "onLoad")');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/code-r.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/code/harvest-r.ts
// The R side of the code element, as strings node can test: the package
// pre-scan, the one-time boot script, and the run wrapper. The wrapper
// evaluates the user's script with console semantics, catches every
// condition IN R (so the TS side never handles R condition objects),
// serializes a trailing data frame in base R (strings only — no package
// needed for a script that just prints), serializes the data bridge through
// jsonlite (installed by webr.ts when paths are requested), and returns one
// character vector: c(error, stderr, table_json, data_json).
//
// Why a character vector and not R objects: RCharacter.toArray() is the
// whole boundary. Everything else stays R-side and purge-able.

export const R_TABLE_CAP = 30;
export const R_DATA_CAP_NUMBERS = 5000;
export const R_DATA_CAP_ROWS = 200;

/** ggplot2 sizes its text in points against a 72-dpi canvas; at the 2×
 *  canvas size webr.ts renders, an unbumped theme reads as fine print once
 *  the figure is fitted into the output pane. The hook runs when ggplot2
 *  loads, before any plot, and a script's own theme_set() still wins.
 *  The value is what the live smoke settled on (spec §5.4). */
export const GGPLOT_BASE_SIZE = 22;

/** Attached with R, or installed with it as recommended — never something
 *  to fetch from the repo. `webr` is the runtime's own package. */
export const R_BASE_PACKAGES: ReadonlySet<string> = new Set([
  "base", "stats", "utils", "graphics", "grDevices", "methods", "datasets", "tools", "parallel",
  "compiler", "grid", "splines", "stats4", "tcltk", "webr",
]);

/** Package names a script names: library(x), require(x), requireNamespace("x")
 *  and x::fn. The shim installed at boot covers the first two on its own;
 *  the pre-scan exists for the others and so the status pill can say what is
 *  downloading. Comments are stripped first. Order of first mention. */
export function rPackagesIn(code: string): string[] {
  const src = code.replace(/#[^\n]*/g, "");
  const out: string[] = [];
  const add = (name: string) => {
    if (!R_BASE_PACKAGES.has(name) && !out.includes(name)) out.push(name);
  };
  const calls = /\b(?:library|require|requireNamespace)\(\s*["']?([A-Za-z][A-Za-z0-9.]*)["']?\s*[,)]/g;
  const colons = /\b([A-Za-z][A-Za-z0-9.]*)::/g;
  let m: RegExpExecArray | null;
  while ((m = calls.exec(src))) add(m[1]);
  while ((m = colons.exec(src))) add(m[1]);
  return out;
}

/** Runs once after webR.init(). */
export const R_BOOT = `
webr::shim_install()
setHook(packageEvent("ggplot2", "onLoad"), function(...) {
  ggplot2::theme_set(ggplot2::theme_gray(base_size = ${GGPLOT_BASE_SIZE}))
})
options(width = 80)
`;

export const R_WRAPPER = `
.__env <- new.env(parent = globalenv())
.__err <- ""
.__warn <- character(0)
.__table <- NULL
.__table_json <- ""
.__data_json <- ""
.__exprs <- tryCatch(parse(text = .__code, keep.source = FALSE),
  error = function(e) { .__err <<- paste0("Error: ", conditionMessage(e)); NULL })
.__run <- function() {
  n <- length(.__exprs)
  if (n > 1) withAutoprint(.__exprs[seq_len(n - 1)], evaluated = TRUE, echo = FALSE, local = .__env)
  if (n > 0) {
    last <- withVisible(eval(.__exprs[[n]], .__env))
    if (last$visible) {
      if (is.data.frame(last$value)) .__table <<- last$value else print(last$value)
    }
  }
}
if (!is.null(.__exprs)) withCallingHandlers(
  tryCatch(.__run(), error = function(e) {
    call <- conditionCall(e)
    .__err <<- if (is.null(call)) paste0("Error: ", conditionMessage(e))
      else paste0("Error in ", paste(deparse(call, nlines = 1), collapse = ""), ": ", conditionMessage(e))
  }),
  warning = function(w) { .__warn <<- c(.__warn, paste0("Warning: ", conditionMessage(w))); invokeRestart("muffleWarning") },
  message = function(m) { .__warn <<- c(.__warn, sub("\\n$", "", conditionMessage(m))); invokeRestart("muffleMessage") }
)
.__jstr <- function(s) {
  s <- gsub("\\\\", "\\\\\\\\", s, fixed = TRUE)
  s <- gsub("\\"", "\\\\\\"", s, fixed = TRUE)
  s <- gsub("\\n", "\\\\n", s, fixed = TRUE)
  s <- gsub("\\r", "\\\\r", s, fixed = TRUE)
  s <- gsub("\\t", "\\\\t", s, fixed = TRUE)
  paste0("\\"", s, "\\"")
}
.__cell <- function(col) {
  out <- if (is.numeric(col)) format(col, digits = getOption("digits"), trim = TRUE) else as.character(col)
  out[is.na(col)] <- ""
  out
}
if (.__err == "" && !is.null(.__table)) {
  t <- as.data.frame(.__table, stringsAsFactors = FALSE)
  cap <- ${R_TABLE_CAP}L
  n <- nrow(t)
  h <- if (n > cap) t[seq_len(cap), , drop = FALSE] else t
  cells <- lapply(h, .__cell)
  rows <- vapply(seq_len(nrow(h)), function(i)
    paste0("[", paste(vapply(cells, function(cv) .__jstr(cv[[i]]), ""), collapse = ","), "]"), "")
  .__table_json <- paste0("{\\"columns\\":[", paste(vapply(names(h), .__jstr, ""), collapse = ","),
    "],\\"rows\\":[", paste(rows, collapse = ","), "],\\"truncated\\":", max(0L, n - cap), "}")
}
.__paths <- if (nzchar(.__paths)) strsplit(.__paths, "\\n", fixed = TRUE)[[1]] else character(0)
if (.__err == "" && length(.__paths) > 0) {
  .__CAP_N <- ${R_DATA_CAP_NUMBERS}L
  .__CAP_ROWS <- ${R_DATA_CAP_ROWS}L
  .__count <- function(x) {
    if (is.data.frame(x)) return(nrow(x) * max(1L, ncol(x)))
    if (is.list(x)) return(sum(vapply(x, .__count, 1)))
    length(x)
  }
  .__leaf <- function(x) jsonlite::unbox(x)
  .__plain <- function(v) {
    if (is.factor(v)) return(as.character(v))
    if (inherits(v, "Date") || inherits(v, "POSIXt")) return(as.character(v))
    v
  }
  .__conv <- function(v) {
    if (is.data.frame(v)) {
      if (nrow(v) > .__CAP_ROWS) stop(sprintf("%d rows, the cap is %d — aggregate or sample in the script", nrow(v), .__CAP_ROWS))
      v <- as.data.frame(v, stringsAsFactors = FALSE)
      cols <- lapply(v, .__plain)
      rows <- lapply(seq_len(nrow(v)), function(i) unname(lapply(cols, function(col) .__leaf(col[[i]]))))
      return(list(columns = names(v), rows = rows))
    }
    v <- .__plain(v)
    if (is.atomic(v)) {
      if (length(v) == 1L && is.null(names(v))) return(.__leaf(v))
      if (!is.null(names(v))) return(lapply(as.list(v), .__leaf))
      return(unname(lapply(as.list(v), .__leaf)))
    }
    if (is.list(v)) {
      out <- lapply(v, .__conv)
      return(if (is.null(names(v))) unname(out) else out)
    }
    stop(sprintf("%s is not data (a number, string, vector, list or data frame)", class(v)[1]))
  }
  .__walk <- function(obj, segs) {
    for (s in segs) {
      if ((is.data.frame(obj) || is.list(obj)) && !is.null(names(obj)) && s %in% names(obj)) obj <- obj[[s]]
      else stop(sprintf("no column or element %s", s))
    }
    obj
  }
  .__data <- list()
  .__errors <- list()
  for (p in .__paths) {
    res <- tryCatch({
      segs <- strsplit(p, ".", fixed = TRUE)[[1]]
      if (!exists(segs[1], envir = .__env, inherits = FALSE)) stop(sprintf("no variable %s", segs[1]))
      obj <- .__walk(get(segs[1], envir = .__env), segs[-1])
      n <- .__count(obj)
      if (n > .__CAP_N) stop(sprintf("%d values, the cap is %d — downsample or aggregate in the script", n, .__CAP_N))
      list(ok = TRUE, value = .__conv(obj))
    }, error = function(e) list(ok = FALSE, msg = conditionMessage(e)))
    if (res$ok) .__data[[p]] <- res$value else .__errors[[p]] <- jsonlite::unbox(res$msg)
  }
  .__data_json <- as.character(jsonlite::toJSON(list(data = .__data, errors = .__errors),
    auto_unbox = FALSE, na = "null", null = "null", digits = NA))
}
c(.__err, paste(.__warn, collapse = "\\n"), .__table_json, .__data_json)
`;
```

Escaping note: this is a TS template literal; every `\\` above is what the R source must contain as a single backslash pair, and `\\"` is `\"` in R source. When implementing, print `R_WRAPPER` once with `node -e` and eyeball the R: the `.__jstr` body must read `gsub("\\", "\\\\", s, fixed = TRUE)` and `gsub("\"", "\\\"", s, fixed = TRUE)`.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/code-r.test.ts`
Expected: PASS.

- [ ] **Step 5: Sanity-check the R with a local R if present**

Run: `which Rscript && Rscript -e 'source(textConnection(readLines("/dev/stdin")))'` is not needed — instead, if `Rscript` exists: write the wrapper to a temp file with `.__code <- 'x <- c(1,2)\nsummary(x)\ndata.frame(a=1:2, b=c("p","q"))'` and `.__paths <- "x"` prepended, run `Rscript` (jsonlite must be installed locally for the data part; otherwise set `.__paths <- ""`). Expected: the summary prints; the last value is a 4-string vector whose third element is `{"columns":["a","b"],"rows":[["1","p"],["2","q"]],"truncated":0}`. If no local R, skip — the live smoke covers it.

- [ ] **Step 6: Commit**

```bash
git add src/code/harvest-r.ts tests/code-r.test.ts
git commit -m "feat(code): the R wrapper — console semantics, trailing table, jsonlite data bridge, package pre-scan"
```

---

### Task 4: `webr.ts` — the runtime module

**Files:**
- Create: `src/code/webr.ts`
- Modify: `src/code/run.ts` (`r: () => import("./webr")`)

**Interfaces:**
- Consumes: `R_WRAPPER`, `R_BOOT`, `rPackagesIn` (Task 3); `bitmapToFigure` (Task 2); `CodeRunRequest`, `CodeRunResult`, `CodeTable` (run/envelope); `parseHarvest` (harvest.ts); `RUNTIME_VERSION.r`.
- Produces: `run(req: CodeRunRequest): Promise<CodeRunResult>` (alias `runR`). Browser-only; in node `boot()` throws an unavailable error before touching the network (the Task 1 dispatch test relies on this).

- [ ] **Step 1: Implement**

```ts
// src/code/webr.ts
// The R runtime: pinned webR, booted once (memoized in-flight promise), runs
// serialized, one shelter per run purged in finally (xplainer's never-purged
// shelter grew all session), typed output entries kept apart (xplainer
// merged stdout and stderr), plots from the canvas device as PNG data URIs.
//
// Reached ONLY via dynamic import from run.ts. Never import this module
// statically anywhere: that would put webR's loader on every page.
//
// Honest limitations: without COOP/COEP headers webR uses its PostMessage
// channel, where interrupt() is unavailable — a timeout returns an error
// envelope while the WASM finishes in the background, exactly as pyodide.
// Package installs live in webR's in-memory filesystem, so a page reload
// re-downloads them (the HTTP cache helps).

import type { CodeRunRequest, CodeRunResult, CodeTable } from "./run";
import { RUNTIME_VERSION } from "./languages";
import { parseHarvest } from "./harvest";
import { R_BOOT, R_WRAPPER, rPackagesIn } from "./harvest-r";
import { bitmapToFigure } from "./png";

const WEBR_BASE = `https://webr.r-wasm.org/v${RUNTIME_VERSION.r}/`;
const WEBR_URL = `${WEBR_BASE}webr.mjs`;
const RUN_TIMEOUT_MS = 180_000;

/** Canvas device size for one plot page. 2× the pane's logical width so the
 *  video export stays crisp; pointsize scales base-graphics text with it,
 *  the ggplot2 theme hook in R_BOOT does the same for grid text. The live
 *  smoke pins these (spec §5.4). */
const PLOT_WIDTH = 1400;
const PLOT_HEIGHT = 900;
const PLOT_POINTSIZE = 24;

interface RCharacterLike {
  toArray(): Promise<(string | null)[]>;
}
interface Shelter {
  captureR(
    code: string,
    opts: {
      env: Record<string, unknown>;
      withAutoprint: boolean;
      captureStreams: boolean;
      captureConditions: boolean;
      captureGraphics: { width: number; height: number; pointsize?: number; bg?: string };
      throwJsException: boolean;
    },
  ): Promise<{ result: RCharacterLike; output: { type: string; data: unknown }[]; images: ImageBitmap[] }>;
  purge(): Promise<void>;
}
interface WebRInstance {
  init(): Promise<unknown>;
  evalRVoid(code: string): Promise<void>;
  installPackages(pkgs: string[], opts?: { quiet?: boolean; mount?: boolean }): Promise<void>;
  Shelter: new () => Promise<Shelter>;
}

let bootPromise: Promise<WebRInstance> | null = null;
let queue: Promise<unknown> = Promise.resolve();
const installed = new Set<string>();

function unavailable(message: string): Error & { runtimeUnavailable: true } {
  const err = new Error(message) as Error & { runtimeUnavailable: true };
  err.runtimeUnavailable = true;
  return err;
}

function boot(): Promise<WebRInstance> {
  if (bootPromise) return bootPromise;
  bootPromise = (async () => {
    if (typeof document === "undefined") throw unavailable("R needs a browser to run in");
    let mod: { WebR: new (opts: { baseUrl: string }) => WebRInstance };
    try {
      mod = (await import(/* @vite-ignore */ WEBR_URL)) as typeof mod;
    } catch {
      throw unavailable("could not load the R runtime (offline?)");
    }
    const webR = new mod.WebR({ baseUrl: WEBR_BASE });
    await webR.init();
    await webR.evalRVoid(R_BOOT);
    return webR;
  })();
  bootPromise.catch(() => {
    bootPromise = null;
  });
  return bootPromise;
}

async function ensurePackages(webR: WebRInstance, pkgs: string[], status: (p: "loading" | "running", d: string) => void): Promise<void> {
  const missing = pkgs.filter((p) => !installed.has(p));
  if (missing.length === 0) return;
  status("loading", `Installing ${missing.join(", ")}…`);
  // A package the repo lacks must not sink the run: the script's own
  // library() call then raises the honest R error the panel shows.
  await webR.installPackages(missing, { quiet: true }).catch(() => undefined);
  for (const p of missing) installed.add(p);
}

function textOf(entries: { type: string; data: unknown }[], type: string): string {
  return entries
    .filter((e) => e.type === type)
    .map((e) => String(e.data))
    .join("\n");
}

async function runOne(req: CodeRunRequest): Promise<CodeRunResult> {
  const status = req.onStatus ?? (() => undefined);
  status("loading", "Loading R…");
  const webR = await boot();
  const paths = req.paths ?? [];
  const pkgs = rPackagesIn(req.code);
  if (paths.length > 0 && !pkgs.includes("jsonlite")) pkgs.push("jsonlite");
  await ensurePackages(webR, pkgs, status);
  status("running", "Running…");
  const shelter = await new webR.Shelter();
  try {
    const captured = await shelter.captureR(R_WRAPPER, {
      env: { ".__code": req.code, ".__paths": paths.join("\n") },
      withAutoprint: false,
      captureStreams: true,
      captureConditions: true,
      captureGraphics: { width: PLOT_WIDTH, height: PLOT_HEIGHT, pointsize: PLOT_POINTSIZE, bg: "white" },
      throwJsException: true,
    });
    const [rError, rWarn, tableJson, dataJson] = (await captured.result.toArray()).map((s) => s ?? "");
    const stdout = textOf(captured.output, "stdout").replace(/\n$/, "");
    const stderrParts = [textOf(captured.output, "stderr").trim(), rWarn.trim()].filter((s) => s !== "");
    const error = rError !== "" ? rError : undefined;
    const figures = error ? [] : captured.images.map((img) => {
      const fig = bitmapToFigure(img);
      img.close();
      return fig;
    });
    let tables: CodeTable[] = [];
    if (!error && tableJson !== "") {
      try {
        tables = [JSON.parse(tableJson) as CodeTable];
      } catch {
        /* a malformed table loses the table, not the run */
      }
    }
    let data: Record<string, unknown> | undefined;
    let dataErrors: Record<string, string> | undefined;
    if (!error && paths.length > 0) {
      status("running", "Reading data…");
      if (dataJson === "") {
        dataErrors = Object.fromEntries(paths.map((p) => [p, "harvest failed: jsonlite did not load"]));
      } else {
        const harvested = parseHarvest(dataJson);
        data = harvested.data;
        dataErrors = harvested.errors;
      }
    }
    return {
      ok: !error,
      stdout,
      stderr: stderrParts.join("\n"),
      figures,
      tables,
      error,
      ...(data !== undefined ? { data } : {}),
      ...(dataErrors !== undefined && Object.keys(dataErrors).length > 0 ? { dataErrors } : {}),
    };
  } finally {
    await shelter.purge().catch(() => undefined);
  }
}

export function runR(req: CodeRunRequest): Promise<CodeRunResult> {
  const run = queue.then(() => runOne(req));
  queue = run.catch(() => undefined);
  const envelope = (err: unknown): CodeRunResult => ({
    ok: false,
    stdout: "",
    stderr: "",
    figures: [],
    error: (err as Error).message,
    runtimeUnavailable: (err as { runtimeUnavailable?: boolean } | undefined)?.runtimeUnavailable === true,
  });
  const settled = run.catch(envelope);
  let timeoutId!: ReturnType<typeof setTimeout>;
  const timeout = new Promise<CodeRunResult>((resolve) => {
    timeoutId = setTimeout(
      () => resolve({ ok: false, stdout: "", stderr: "", figures: [], error: `timed out after ${RUN_TIMEOUT_MS / 1000}s` }),
      RUN_TIMEOUT_MS,
    );
  });
  settled.then(() => clearTimeout(timeoutId));
  return Promise.race([settled, timeout]);
}

export const run = runR;
```

Then in `run.ts`: `r: () => import("./webr"),`.

- [ ] **Step 2: Verify**

Run: `npm test && npx tsc --noEmit && npm run build && npm run build:engine`
Expected: all green; `dist-engine/chunks/` gains a `webr-*.js` chunk; `dist/` likewise. The Task 1 dispatch test for `r` now goes through `webr.ts` and still returns `runtimeUnavailable` (no `document` in node).

- [ ] **Step 3: Commit**

```bash
git add src/code/webr.ts src/code/run.ts
git commit -m "feat(code): R runs through pinned webR 0.6.0 — console output, tables, canvas plots, the data bridge"
```

---

### Task 5: Prompt, schema voice, examples, few-shot

**Files:**
- Modify: `src/llm/prompts/compiler-v1.md:48` (one sentence), `src/spec/schema.ts` (`language` description — already written in Task 1), `src/llm/prompts/fewshots.json` (append one), `src/examples.json` (append one)
- Test: `tests/code-runtimes.test.ts` (add a prompt-drift test)

- [ ] **Step 1: Add the failing drift test** to `tests/code-runtimes.test.ts`:

```ts
import { readFileSync } from "node:fs";

describe("prompt knows the runtimes it may emit", () => {
  const prompt = readFileSync(new URL("../src/llm/prompts/compiler-v1.md", import.meta.url), "utf8");
  test("R is offered, the old 'never emit r' sentence is gone", () => {
    expect(prompt).toContain('"language": "r"');
    expect(prompt).not.toContain("never emit `\"language\": \"r\"`");
  });
});
```

- [ ] **Step 2: Rewrite the sentence** in `compiler-v1.md` line 48. Replace exactly:

`Python only for now — never emit `"language": "r"`. One code element per figure.`

with:

`` `language` picks the runtime: `"python"` (full CPython — numpy, pandas, matplotlib, plotly, PyPI packages on demand) or `"r"` (R — base or tidyverse; `library()` auto-installs; EVERY top-level expression prints as at the console, so a bare `summary(m)` shows; leave a data frame — tibble or data.table included — as the LAST line and it draws as a ruled table; a base `plot()` or a ggplot left as the last line draws as a figure, and `"figures": K` works with one plot per stage; the same `{id.path}` tokens feed templates from an R variable, a data frame column or a named vector). Write R when the request asks for R or the field's idiom is R; otherwise Python. Never emit `"brython"` or `"micropython"` yet. One code element per figure. ``

- [ ] **Step 3: Append the R few-shot** to `src/llm/prompts/fewshots.json` (inside the array, after the last entry):

```json
  {
    "request": "In R, show a tidyverse pipeline summarising a small table by group.",
    "spec": {
      "title": "Group means, the tidyverse way",
      "elements": [
        {
          "id": "tidy",
          "type": "code",
          "language": "r",
          "show": "split",
          "width": 900,
          "code": "library(dplyr)\ndf <- tibble(group = c(\"a\", \"a\", \"b\", \"b\", \"c\"), x = c(2, 4, 6, 8, 10))\ndf |> group_by(group) |> summarise(mean_x = mean(x), n = n())"
        }
      ],
      "commands": [
        { "draw": ["tidy", "tidy_line_1"], "parallel": true, "speak": "dplyr is the grammar of data manipulation — one verb per step." },
        { "draw": ["tidy_line_2"], "speak": "A tiny tibble: three groups, five values." },
        { "draw": ["tidy_line_3"], "speak": "Group by, then summarise — the pipe reads like a sentence." },
        { "draw": ["tidy_out"], "speak": "And the last line, a tibble, lands as a table." }
      ]
    }
  }
```

- [ ] **Step 4: Append the R example** to `src/examples.json` (same shape as the Python "law of large numbers" example):

```json
 {
  "request": "In R with ggplot2: 200 random draws, their mean, and a histogram, stepped line by line",
  "spec": {
   "title": "The law of large numbers, in R",
   "elements": [
    {
     "id": "sim",
     "type": "code",
     "language": "r",
     "show": "split",
     "width": 900,
     "code": "library(ggplot2)\nset.seed(7)\ndf <- data.frame(x = rnorm(200))\ncat(\"mean:\", round(mean(df$x), 3), \"\\n\")\nggplot(df, aes(x)) + geom_histogram(bins = 20)"
    }
   ],
   "commands": [
    { "speak": "Can two hundred random numbers already know where their center is? Let's ask R." },
    { "draw": ["sim", "sim_line_1"], "parallel": true, "speak": "ggplot2 for the picture — it installs itself the first time." },
    { "draw": ["sim_line_2"], "speak": "A seed, so this figure tells the same truth every time." },
    { "draw": ["sim_line_3"], "speak": "Two hundred draws from a standard normal, in a data frame." },
    { "draw": ["sim_line_4"], "speak": "Their mean, printed — close to zero, not exactly zero." },
    { "draw": ["sim_line_5"], "speak": "And a histogram as the last line, so it draws itself." },
    { "draw": ["sim_out"], "speak": "There it is: the bell, and the center it already knows." }
   ]
  }
 }
```

- [ ] **Step 5: Verify**

Run: `npm test`
Expected: PASS — `fewshots.test` and `examples.test` accept both (they validate, lay out offline with a placeholder envelope, resolve every id, lint clean). If `lintCommands` complains about slow-start/talky-stretch, trim a speak; do not add draws.

- [ ] **Step 6: Commit**

```bash
git add src/llm/prompts/compiler-v1.md src/llm/prompts/fewshots.json src/examples.json tests/code-runtimes.test.ts
git commit -m "feat(llm): the compiler may write R — tier guidance, an R few-shot and a bundled ggplot2 example"
```

---

### Task 6: Build, live smoke, ledger, push

**Files:**
- Create: `docs/superpowers/plans/2026-09-03-code-runtimes-m2-ledger.md`

- [ ] **Step 1: Full verification**

```bash
npm test && npx tsc --noEmit && npm run build && npm run build:engine
```

- [ ] **Step 2: Start the dev server** (`npm run dev`, note the port) and smoke through `render()` in a real browser (Playwright MCP against `http://localhost:<port>/`). Harness, evaluated in the page:

```js
const { render } = await import("/src/render/index.ts");
const div = document.createElement("div"); document.body.appendChild(div);
const h = await render(spec, div);
const el = h.spec.elements.find((e) => e.type === "code");
return { result: JSON.parse(el.code_result), order: h.layout.order, warnings: h.layout.warnings, issues: h.lint() };
```

Specs to run (spec §8 R list), recording stdout / stderr / tables / figures count / data / dataErrors / warnings for each — ×3 (cold, warm, after reload):

1. Base plot + console semantics:
```yaml
elements:
  - id: r1
    type: code
    language: r
    show: split
    code: |
      x <- c(1, 2, 3, 4, 5)
      summary(x)
      plot(x, x^2, type = "b")
commands: [{ draw: [r1] }]
```
Expect: stdout has the summary line, 1 figure, no stderr.
2. ggplot2 via auto-install + trailing plot + data.frame table (two elements in one spec).
3. dplyr pipe → tibble as table; data.table → table (`library(data.table); dt <- data.table(a=1:3, b=c("x","y","z")); dt`).
4. A warning (`as.numeric("a")`) reaches stderr; a broken script (`log(-1); stop("no")`) → error panel, `ok: false`.
5. `figures: 2` with two `plot()` calls → two figures, `r1_fig_1`, `r1_fig_2` in `order`.
6. Tokens: `bar_chart` with `values: "{r1.frames}"` where `frames <- list(c(87, 52, 58), c(67, 52, 61))`; `scatter_plot` with `x: "{r1.df.h}"`, `y: "{r1.df.s}"` from a data frame; a named vector `v <- c(a = 1, b = 2)` as `"{r1.v}"` → object.
7. Bundled example "The law of large numbers, in R" renders through the Examples path.
8. Pyodide regression: the Python "law of large numbers" example still renders (plotly extraction).

Decide `PLOT_WIDTH/HEIGHT/POINTSIZE` and `GGPLOT_BASE_SIZE` from the screenshots of items 1 and 2 (one screenshot each, JPEG, no more — token economy); adjust and re-smoke those two.

- [ ] **Step 3: Ledger** — `docs/superpowers/plans/2026-09-03-code-runtimes-m2-ledger.md` in the house format (pre-flight, rulings, progress, smoke results, final verification, commits).

- [ ] **Step 4: Push**

```bash
git push origin main && git ls-remote origin main
```
