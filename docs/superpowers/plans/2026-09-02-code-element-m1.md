# Code Element M1 (Python end-to-end) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A new tier-2 `code` element that executes a Python script (pyodide, lazily loaded) at figure-preparation time and draws its code and/or output as ordinary SVG drawables, with per-line ids for narration-synced stepping.

**Architecture:** Execution happens in the ensure phase (the `source`/`portrait` resolver pattern): `resolveCode` runs the script via a `src/code/` facade, stamps a JSON envelope onto `el.code_result` on render's clone, and layout (`src/layout/code.ts`) turns code lines into monospace `TextDrawable`s (`<id>_line_N`), stdout into text, and matplotlib PNGs into `ImageDrawable`s inside an `<id>_out` group. Results are cached in IndexedDB; failures degrade to a visible error panel, never a throw. Generation actually executes AI-written code and feeds errors into the existing repair round.

**Tech Stack:** TypeScript (strict), vitest (node env — no DOM in unit tests), pyodide v314.0.2 from jsDelivr CDN (never bundled), no new npm dependencies.

**Spec:** `docs/superpowers/specs/2026-09-02-code-element-design.md` — read it first; this plan implements its M1 milestone.

## Global Constraints

- **Zero cost when unused:** runtime modules are reached ONLY via dynamic `import()` inside `src/code/run.ts`; nothing outside `src/code/` may import `src/code/pyodide.ts`. Pyodide loads from `https://cdn.jsdelivr.net/pyodide/v314.0.2/full/pyodide.js` (the version openstat has verified in production) — never from npm.
- **SVG only:** all output becomes drawables (`TextDrawable`, `ImageDrawable` with data URIs). No HTML overlays.
- **B11:** resolvers mutate only render's clone (`resolvedRenderSpec`); nothing here may write into the author's document.
- **Additive core edits only:** existing files get registrations and one small generic addition (mono font); all logic lives in new files.
- **Failures degrade, never throw:** a failed run renders an error panel; a missing runtime renders a placeholder; generation is never blocked by an unavailable runtime.
- **Tests:** vitest runs in node (`vite.config.ts` pins `environment: "node"`). Unit tests inject fake runners/caches — they must never load WASM or touch the network. Run one file with `npx vitest run tests/code-element.test.ts`, everything with `npm test`. The existing suite (~2 887 tests) must stay green after every task.
- **Commits:** one per task, message style `feat: …` / `test: …` as in `git log`.
- **Known M1 deferral:** the runner reports `onStatus` phases, but no app UI consumes them yet — a cold first play waits silently through the pyodide boot (~10 s). Spec §7's loading affordance is a follow-up; Task 11's smoke notes how the wait feels so Hans can prioritize it.

---

### Task 1: Spec surface — types, schema, validation

**Files:**
- Modify: `src/spec/types.ts` (ElementType union at :8-22, SpecElement fields after the source block at :129-139)
- Modify: `src/spec/schema.ts` (type enum at :63-66, `elementSchema.properties` before `style` at :183, `elementErrors` switch at :773)
- Create: `tests/code-element.test.ts`

**Interfaces:**
- Produces: `SpecElement` fields `language?: "python" | "r"`, `code?: string`, `show?: "output" | "split" | "code"`, `code_result?: string`; `"code"` in `ElementType`. Later tasks rely on these exact names.

- [ ] **Step 1: Write the failing tests**

Create `tests/code-element.test.ts`:

```ts
// The CODE element: a Python/R script whose code and/or output is drawn on
// the canvas. Schema, the result envelope + cached facade, tier-2 layout
// (panel, per-line ids, output pane, error panel, placeholder), the resolver
// with an injected fake runner, hoisting, lint, and the generation-time
// execution check. Nothing here loads WASM or touches the network.

import { describe, expect, test } from "vitest";
import { validateSpec } from "../src/spec/schema";
import type { Spec } from "../src/spec/types";

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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/code-element.test.ts`
Expected: FAIL — `validateSpec` reports `type` not in enum (schema errors), so `.ok` is `false` where `true` is expected.

- [ ] **Step 3: Add the type union entry and element fields**

In `src/spec/types.ts`, extend the union (line 22, after `| "source"`):

```ts
  | "source"
  | "code";
```

In `SpecElement`, after the `reveal` field (line 128) and before `// source`:

```ts
  // code (a Python/R script whose code and/or output is drawn in a panel)
  /** code: the runtime that executes the script. */
  language?: "python" | "r";
  /** code: the script itself, one newline-separated string. */
  code?: string;
  /** code: what the panel shows — output (default), split (code left, output right), or the code alone. */
  show?: "output" | "split" | "code";
  /** code: machine-written execution result envelope (JSON — see src/code/run.ts). Never authored. */
  code_result?: string;
```

- [ ] **Step 4: Add the schema entries**

In `src/spec/schema.ts`:

1. Type enum (line 65): append `"code"` to the array.
2. In `elementSchema.properties`, after the `reveal` entry (line 182) and before `style`:

```ts
    // code
    language: {
      type: "string",
      enum: ["python", "r"],
      description: "code: the runtime that executes the script. Python runs today; r is not available yet — never emit it.",
    },
    code: {
      type: "string",
      description:
        "code: the script, one newline-separated string. It EXECUTES for real in the viewer's browser at figure-preparation time, so keep it short (≤ ~14 lines), deterministic (SEED any randomness), print() exactly the numbers the narration mentions, and end with at most ONE matplotlib plot. Each line becomes a drawable `<id>_line_1` … `<id>_line_N` and the whole output panel is `<id>_out` — reveal lines with draw on their own narration beats, then draw the output.",
    },
    show: {
      type: "string",
      enum: ["output", "split", "code"],
      description:
        "code: panel layout — output (just the result; the default), split (code pane left, output pane right; give the element width ≥ 700), code (the script alone).",
    },
    code_result: {
      type: "string",
      description: "code: machine-written execution result (copy VERBATIM if present; never write, edit, or invent it).",
    },
```

3. Extend the existing `width` description (line 134) to read:

```ts
    width: { type: "number", description: "shape rect / portrait / source / code: width in logical units (a source defaults to 200 for a cover, 260 for a page; a code panel to 880)." },
```

4. In `elementErrors` (the switch at line 773), add before `default:`:

```ts
    case "code":
      need(el.language === "python" || el.language === "r", 'needs language: "python" or "r"');
      need(typeof el.code === "string" && el.code.trim() !== "", "needs code (the script)");
      break;
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/code-element.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Run the whole suite** — `npm test`. Expected: green. (A schema-snapshot or drift test may reference the type enum; if one fails, update its expected list to include `"code"` — that is the test doing its job.)

- [ ] **Step 7: Commit**

```bash
git add src/spec/types.ts src/spec/schema.ts tests/code-element.test.ts
git commit -m "feat: code element spec surface (types, schema, validation)"
```

---

### Task 2: Result envelope + cached runCode facade

**Files:**
- Create: `src/code/run.ts`
- Test: `tests/code-element.test.ts` (append)

**Interfaces:**
- Consumes: `cacheGet(key): Promise<string | null>` / `cachePut(key, value): Promise<void>` from `src/render/portrait.ts` (the existing IndexedDB string store).
- Produces (later tasks import these exact names from `../src/code/run` / `../code/run`):
  - `CODE_VERSION: number`, `PYODIDE_VERSION: string`
  - `interface CodeRunRequest { language: "python" | "r"; code: string; onStatus?: (phase: "loading" | "running", detail: string) => void }`
  - `interface CodeFigure { href: string; w: number; h: number }`
  - `interface CodeRunResult { ok: boolean; stdout: string; stderr: string; figures: CodeFigure[]; error?: string }`
  - `interface CodeRunDeps { runner?; cacheGet?; cachePut? }`
  - `codeCacheKey(req): string`, `decodeCodeResult(raw): CodeRunResult | null`, `runCode(req, deps?): Promise<CodeRunResult>`

- [ ] **Step 1: Write the failing tests** (append to `tests/code-element.test.ts`)

```ts
import { CODE_VERSION, codeCacheKey, decodeCodeResult, runCode, type CodeRunResult } from "../src/code/run";

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
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run tests/code-element.test.ts`. Expected: FAIL, module `../src/code/run` not found.

- [ ] **Step 3: Implement `src/code/run.ts`**

```ts
// Code execution facade: one narrow envelope between the drawcast spec and
// whatever runtime actually runs the script. Runtime modules (pyodide.ts,
// later webr.ts) are reached ONLY via dynamic import, so a spec without a
// code element never loads a byte of them; tests inject a fake runner.
//
// Results are cached in IndexedDB (the portrait/source store) keyed by
// language + pinned runtime version + a hash of the code, so a script
// executes once per browser — replays, scrubs and re-renders hit the cache.
// Failures come back as envelopes, never thrown, and are never cached: an
// offline or transient CDN failure must retry on the next render.

import { cacheGet, cachePut } from "../render/portrait";

/** Bump whenever the envelope shape or the capture pipeline changes. */
export const CODE_VERSION = 1;

/** Pinned runtime version (openstat-verified) — part of the cache key, so a
 *  runtime upgrade misses cleanly instead of replaying stale output. */
export const PYODIDE_VERSION = "314.0.2";

export interface CodeRunRequest {
  language: "python" | "r";
  code: string;
  onStatus?: (phase: "loading" | "running", detail: string) => void;
}

export interface CodeFigure {
  /** PNG data URI (self-contained, export-safe — the ImageDrawable contract). */
  href: string;
  /** Pixel dimensions, read from the PNG bytes — layout needs the aspect. */
  w: number;
  h: number;
}

export interface CodeRunResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  figures: CodeFigure[];
  /** Set when the run itself failed (boot failure, timeout, thrown error). */
  error?: string;
}

export interface CodeRunDeps {
  runner?: (req: CodeRunRequest) => Promise<CodeRunResult>;
  cacheGet?: (key: string) => Promise<string | null>;
  cachePut?: (key: string, value: string) => Promise<void>;
}

/** FNV-1a — the same short stable tag render/source.ts uses for quotes. */
function hash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

export function codeCacheKey(req: Pick<CodeRunRequest, "language" | "code">): string {
  const tag = req.language === "python" ? `py${PYODIDE_VERSION}` : "r0";
  return `c${CODE_VERSION}|${tag}|${hash(req.code)}`;
}

export function decodeCodeResult(raw: string | undefined): CodeRunResult | null {
  if (!raw) return null;
  try {
    const p = JSON.parse(raw) as CodeRunResult;
    if (typeof p !== "object" || p === null) return null;
    if (typeof p.ok !== "boolean" || typeof p.stdout !== "string" || typeof p.stderr !== "string") return null;
    if (!Array.isArray(p.figures)) return null;
    return p;
  } catch {
    return null;
  }
}

async function defaultRunner(req: CodeRunRequest): Promise<CodeRunResult> {
  if (req.language === "python") return (await import("./pyodide")).runPython(req);
  return { ok: false, stdout: "", stderr: "", figures: [], error: "the R runtime arrives in M2 — use language: python" };
}

export async function runCode(req: CodeRunRequest, deps: CodeRunDeps = {}): Promise<CodeRunResult> {
  const get = deps.cacheGet ?? cacheGet;
  const put = deps.cachePut ?? cachePut;
  const key = codeCacheKey(req);
  const hit = decodeCodeResult((await get(key).catch(() => null)) ?? undefined);
  if (hit) return hit;
  let result: CodeRunResult;
  try {
    result = await (deps.runner ?? defaultRunner)(req);
  } catch (err) {
    result = { ok: false, stdout: "", stderr: "", figures: [], error: (err as Error).message };
  }
  if (result.ok) await put(key, JSON.stringify(result)).catch(() => undefined);
  return result;
}
```

Note: `./pyodide` does not exist until Task 8 — the dynamic import only runs when the default runner executes in a browser, and TypeScript will flag the missing module. Create a placeholder now so `tsc` passes:

`src/code/pyodide.ts` (placeholder, replaced in Task 8):

```ts
// Pyodide runtime — implemented in Task 8. This placeholder keeps the module
// graph compiling; it must never be reached from node (tests inject runners).
import type { CodeRunRequest, CodeRunResult } from "./run";

export async function runPython(_req: CodeRunRequest): Promise<CodeRunResult> {
  return { ok: false, stdout: "", stderr: "", figures: [], error: "python runtime not implemented yet" };
}
```

- [ ] **Step 4: Run tests** — `npx vitest run tests/code-element.test.ts`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/code/run.ts src/code/pyodide.ts tests/code-element.test.ts
git commit -m "feat: code run facade — result envelope, cache key, injected runners"
```

---

### Task 3: Monospace font on text drawables

**Files:**
- Modify: `src/layout/model.ts` (TextDrawable at :76-84)
- Modify: `src/render/svg-backend.ts` (font constant near :25, `drawLeaf` text branch at :288-318)

**Interfaces:**
- Produces: `TextDrawable.font?: "mono"` (model field, consumed by Task 4's layout) and `MONO_FONT` export in svg-backend. The clean and sketchy styles share `drawLeaf`'s text branch, so one change covers both.

- [ ] **Step 1: Add the model field**

In `src/layout/model.ts`, inside `TextDrawable` after `anchor`:

```ts
  /** Typeface: absent = the sketch handwriting font; "mono" = the code font. */
  font?: "mono";
```

- [ ] **Step 2: Add the backend switch**

In `src/render/svg-backend.ts`, below `SKETCH_FONT` (line 25):

```ts
/** System monospace stack: no webfont fetch, and available to the export
 *  canvas without embedding — code must render identically in the movie. */
export const MONO_FONT = "'Menlo', 'Consolas', 'DejaVu Sans Mono', monospace";
```

In `drawLeaf`'s text branch, replace line 301:

```ts
    t.setAttribute("font-family", d.font === "mono" ? MONO_FONT : SKETCH_FONT);
```

- [ ] **Step 3: Run the suite** — `npm test`. Expected: green (the field is optional; no behavior changes for existing drawables).

- [ ] **Step 4: Commit**

```bash
git add src/layout/model.ts src/render/svg-backend.ts
git commit -m "feat: mono font option on text drawables (for code panels)"
```

---

### Task 4: Layout — `codeDrawables`

**Files:**
- Create: `src/layout/code.ts`
- Modify: `src/layout/tier2.ts` (import + one `case "code"` in the dispatch at :109-186)
- Test: `tests/code-element.test.ts` (append)

**Interfaces:**
- Consumes: `decodeCodeResult`, `CodeRunResult` from `../code/run`; model/resolve helpers from `./model` / `./resolve`.
- Produces: `codeDrawables(el: SpecElement, ctx: CodeCtx): Drawable[]` and `wrapCodeLine(line: string, maxChars: number): string[]`, where `CodeCtx = { anchors: Record<string, Pt>; extraOrder: string[]; warnings: string[] }` (structurally satisfied by tier2's internal `Ctx`). Ids minted: `<id>` (panel group), `<id>_line_1..N` (top-level, in `extraOrder`), `<id>_out` (top-level group, ALWAYS present, in `extraOrder`).

- [ ] **Step 1: Write the failing tests** (append)

```ts
import { layoutSpec } from "../src/layout/layout";
import { heuristicMeasure } from "../src/layout/measure";
import { flattenDrawables, type ImageDrawable, type TextDrawable } from "../src/layout/model";
import { wrapCodeLine } from "../src/layout/code";

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
```

- [ ] **Step 2: Run to verify failure** — module `../src/layout/code` not found / no `case "code"` (element silently skipped, ids missing).

- [ ] **Step 3: Implement `src/layout/code.ts`**

```ts
// The CODE element: a script's code and/or output as a panel of ordinary
// drawables — mono text lines, stdout lines, PNG plots — so line stepping,
// scrubbing, highlight and video export work exactly like any other ink.
// Geometry only: execution happened in the ensure phase (render/code.ts) and
// arrives stamped on el.code_result.
//
// Command-addressable ids minted here (reported via ctx.extraOrder):
//   <id>_line_1..N — one per source line (when the code pane is shown)
//   <id>_out       — the whole output pane. ALWAYS present, like a source's
//                    promised _quote: an unresolved run keeps the beat and
//                    draws ruled placeholder lines instead of nothing.

import { decodeCodeResult } from "../code/run";
import {
  COLORS,
  SKETCH_MS,
  Z_AREA,
  Z_STROKE,
  Z_TEXT,
  defaultStyle,
  type Drawable,
  type Pt,
} from "./model";
import { resolveDrawOpts, resolveStyle } from "./resolve";
import type { SpecElement } from "../spec/types";

/** Mono glyph advance as a fraction of font size — fixed-pitch, so exact
 *  enough to lay out without a browser measurer (deterministic in node). */
const CHAR_W = 0.62;
/** Vertical advance per wrapped row (matches drawLeaf's tspan spacing). */
const ROW_H = 1.25;
/** Extra gap between SOURCE lines, so wrapped continuations read as one. */
const LINE_GAP = 0.35;
const PAD = 16;

export interface CodeCtx {
  anchors: Record<string, Pt>;
  extraOrder: string[];
  warnings: string[];
}

/** Wrap one source line at maxChars with a hanging indent that preserves the
 *  line's own leading whitespace (a wrapped continuation stays visibly inside
 *  its statement). A line indented too deeply to wrap sensibly is returned
 *  unwrapped — it overflows visually, and the narrow-split lint already
 *  warns about the pane that caused it. */
export function wrapCodeLine(line: string, maxChars: number): string[] {
  if (line.length <= maxChars) return [line];
  const lead = /^\s*/.exec(line)![0];
  const indent = `${lead}  `;
  if (indent.length + 4 > maxChars) return [line];
  const rows: string[] = [];
  let rest = line;
  let minCut = lead.length;
  while (rest.length > maxChars) {
    let cut = rest.lastIndexOf(" ", maxChars);
    if (cut <= minCut) cut = maxChars;
    rows.push(rest.slice(0, cut));
    rest = indent + rest.slice(cut).trimStart();
    minCut = indent.length;
  }
  rows.push(rest);
  return rows;
}

interface TextBlock {
  rows: string[];
  /** Center y offset from the pane top, in logical units (positive = down). */
  center: number;
  height: number;
}

/** Stack wrapped lines top-down; returns blocks + total content height. */
function stackLines(lines: string[][], fontSize: number): { blocks: TextBlock[]; height: number } {
  const blocks: TextBlock[] = [];
  let y = 0;
  for (const rows of lines) {
    const height = (1 + (rows.length - 1) * ROW_H) * fontSize;
    blocks.push({ rows, center: y + height / 2, height });
    y += height + fontSize * LINE_GAP;
  }
  return { blocks, height: Math.max(0, y - fontSize * LINE_GAP) };
}

export function codeDrawables(el: SpecElement, ctx: CodeCtx): Drawable[] {
  const show = el.show ?? "output";
  const w = el.width ?? 880;
  const cx = el.x ?? 500;
  const cy = el.y ?? 400;
  const fontSize = el.font_size ?? 17;
  const result = decodeCodeResult(el.code_result);
  const paneGap = 14;
  const codePaneW = show === "split" ? Math.round(w * 0.55) : w;
  const outPaneW = show === "split" ? w - codePaneW - paneGap : w;
  const showCode = show !== "output";
  const showOut = show !== "code";

  // ---- code pane content ---------------------------------------------------
  const sourceLines = (el.code ?? "").replace(/\s+$/, "").split("\n");
  const codeMax = Math.max(8, Math.floor((codePaneW - 2 * PAD) / (fontSize * CHAR_W)));
  const codeStack = showCode ? stackLines(sourceLines.map((l) => wrapCodeLine(l, codeMax)), fontSize) : { blocks: [], height: 0 };

  // ---- output pane content -------------------------------------------------
  const outMax = Math.max(8, Math.floor((outPaneW - 2 * PAD) / (fontSize * CHAR_W)));
  const failed = result !== null && (!result.ok || !!result.error);
  const outTextLines: { text: string; color?: string }[] = [];
  if (failed) {
    for (const row of wrapCodeLine(`✗ ${result!.error ?? result!.stderr}`.replace(/\n/g, " ⏎ "), outMax)) {
      outTextLines.push({ text: row, color: COLORS.regionLoss });
    }
  } else if (result) {
    for (const line of result.stdout === "" ? [] : result.stdout.split("\n")) {
      for (const row of wrapCodeLine(line, outMax)) outTextLines.push({ text: row });
    }
    if (result.stderr.trim() !== "") {
      for (const row of wrapCodeLine(result.stderr.trim(), outMax)) outTextLines.push({ text: row, color: COLORS.guide });
    }
  }
  const figures = failed || !result ? [] : result.figures;
  const figW = outPaneW - 2 * PAD;
  const figHeights = figures.map((f) => (f.w > 0 ? figW * (f.h / f.w) : figW * 0.75));
  const outStack = stackLines(outTextLines.map((l) => [l.text]), fontSize);
  const outContentH = showOut
    ? Math.max(
        3 * fontSize * (1 + LINE_GAP), // placeholder floor
        outStack.height + figHeights.reduce((a, b) => a + b + fontSize * LINE_GAP, 0),
      )
    : 0;

  // ---- panel geometry (y-up: yTop is the LARGER y) -------------------------
  const contentH = Math.max(showCode ? codeStack.height : 0, outContentH);
  const h = Math.max(60, contentH + 2 * PAD);
  if (h > 700) ctx.warnings.push(`code "${el.id}": panel is ${Math.round(h)} logical units tall — trim the script or its output`);
  const x0 = cx - w / 2;
  const yTop = cy + h / 2;
  const rect: Pt[] = [
    [x0, yTop - h],
    [x0 + w, yTop - h],
    [x0 + w, yTop],
    [x0, yTop],
  ];

  const panelChildren: Drawable[] = [
    {
      id: `${el.id}__bg`,
      kind: "area",
      pts: rect,
      precise: true,
      z: Z_AREA,
      style: resolveStyle(undefined, { fill: COLORS.paper, opacity: 1, strokeWidth: 0 }),
      drawOpts: resolveDrawOpts(undefined, { mode: "instant", duration: 0 }),
    },
    {
      id: `${el.id}__frame`,
      kind: "stroke",
      pts: rect,
      closed: true,
      shapeHint: { type: "rect", x: x0, y: yTop - h, w, h },
      z: Z_STROKE,
      style: resolveStyle(el.style, { strokeWidth: 2.5 }),
      drawOpts: resolveDrawOpts(el.draw, { mode: "sketch", duration: SKETCH_MS.node }),
    },
  ];
  if (show === "split") {
    const dx = x0 + codePaneW + paneGap / 2;
    panelChildren.push({
      id: `${el.id}__divider`,
      kind: "stroke",
      pts: [
        [dx, yTop - PAD / 2],
        [dx, yTop - h + PAD / 2],
      ],
      z: Z_STROKE,
      style: resolveStyle(undefined, { color: COLORS.guide, strokeWidth: 2, dash: true }),
      drawOpts: resolveDrawOpts(undefined, { mode: "instant", duration: 0 }),
    });
  }

  const out: Drawable[] = [
    { id: el.id, kind: "group", z: Z_STROKE, style: defaultStyle(), drawOpts: resolveDrawOpts(undefined, { mode: "sketch", duration: 0 }), children: panelChildren },
  ];
  ctx.anchors[el.id] = [cx, cy];

  // ---- code lines: one top-level drawable per SOURCE line ------------------
  if (showCode) {
    codeStack.blocks.forEach((block, i) => {
      const id = `${el.id}_line_${i + 1}`;
      const pos: Pt = [x0 + PAD, yTop - PAD - block.center];
      ctx.extraOrder.push(id);
      ctx.anchors[id] = pos;
      out.push({
        id,
        kind: "text",
        pos,
        text: block.rows.join(" "),
        lines: block.rows.length > 1 ? block.rows : undefined,
        fontSize,
        anchor: "start",
        font: "mono",
        z: Z_TEXT,
        style: resolveStyle(el.style, {}),
        drawOpts: resolveDrawOpts(el.draw, { mode: "sketch", duration: SKETCH_MS.text }),
      });
    });
  }

  // ---- output pane: one group, always minted -------------------------------
  const outX = show === "split" ? x0 + codePaneW + paneGap : x0;
  const outChildren: Drawable[] = [];
  if (showOut) {
    if (!result) {
      // Unresolved (node tests, offline, runtime missing): the source
      // element's ruled-placeholder idiom, so the beat draws SOMETHING.
      for (let i = 0; i < 3; i++) {
        const ly = yTop - PAD - fontSize * (0.8 + i * 1.6);
        outChildren.push({
          id: `${el.id}__rule${i}`,
          kind: "stroke",
          pts: [
            [outX + PAD, ly],
            [outX + outPaneW - PAD * (i === 2 ? 3 : 1), ly],
          ],
          z: Z_STROKE,
          style: resolveStyle(undefined, { color: COLORS.guide, strokeWidth: 2.5 }),
          drawOpts: resolveDrawOpts(undefined, { mode: "instant", duration: 0 }),
        });
      }
    } else {
      outStack.blocks.forEach((block, i) => {
        outChildren.push({
          id: `${el.id}__out${i}`,
          kind: "text",
          pos: [outX + PAD, yTop - PAD - block.center],
          text: block.rows.join(" "),
          fontSize,
          anchor: "start",
          font: "mono",
          z: Z_TEXT,
          style: resolveStyle(el.style, outTextLines[i]?.color ? { color: outTextLines[i].color } : {}),
          drawOpts: resolveDrawOpts(el.draw, { mode: "sketch", duration: SKETCH_MS.text }),
        });
      });
      let figTop = outStack.height + (outStack.height > 0 ? fontSize * LINE_GAP : 0);
      figures.forEach((f, k) => {
        const fh = figHeights[k];
        outChildren.push({
          id: `${el.id}__fig${k}`,
          kind: "image",
          href: f.href,
          pos: [outX + PAD + figW / 2, yTop - PAD - figTop - fh / 2],
          w: figW,
          h: fh,
          z: Z_STROKE,
          style: resolveStyle(undefined, {}),
          reveal: el.reveal ?? "fade",
          drawOpts: resolveDrawOpts(el.draw, { mode: "sketch", duration: 900 }),
        });
        figTop += fh + fontSize * LINE_GAP;
      });
    }
  }
  const outId = `${el.id}_out`;
  ctx.extraOrder.push(outId);
  ctx.anchors[outId] = [outX + outPaneW / 2, cy];
  out.push({ id: outId, kind: "group", z: Z_STROKE, style: defaultStyle(), drawOpts: resolveDrawOpts(undefined, { mode: "sketch", duration: 0 }), children: outChildren });

  return out;
}
```

- [ ] **Step 4: Wire the tier-2 dispatch**

In `src/layout/tier2.ts`: add `import { codeDrawables } from "./code";` and, in the switch (after `case "source"` at :183-185):

```ts
      case "code":
        drawables.push(...codeDrawables(el, ctx));
        break;
```

- [ ] **Step 5: Run tests** — `npx vitest run tests/code-element.test.ts`. Expected: PASS. Adjust only test expectations that encode geometry you changed deliberately — never weaken the id/kind/font assertions.

- [ ] **Step 6: Run the whole suite** — `npm test`. Expected: green.

- [ ] **Step 7: Commit**

```bash
git add src/layout/code.ts src/layout/tier2.ts tests/code-element.test.ts
git commit -m "feat: code element layout — panel, per-line ids, output pane"
```

---

### Task 5: Ensure-phase resolver

**Files:**
- Create: `src/render/code.ts`
- Modify: `src/render/resolve.ts` (RenderResolveDeps at :17-23, Promise.all at :32-35)
- Modify: `src/render/index.ts` (import; the `resolvedRenderSpec` call at :101)
- Test: `tests/code-element.test.ts` (append)

**Interfaces:**
- Consumes: `runCode`, `CodeRunDeps` from `../code/run`.
- Produces: `resolveCode(spec: Spec, deps?: CodeRunDeps): Promise<CodeResolution[]>` with `CodeResolution = { id: string; ok: boolean; error?: string }`. Mutates the spec it is given (render hands it the B11 clone).

- [ ] **Step 1: Write the failing tests** (append)

```ts
import { resolveCode } from "../src/render/code";
import { resolvedRenderSpec } from "../src/render/resolve";

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
```

- [ ] **Step 2: Run to verify failure** — module not found; `resolveCode` missing from `RenderResolveDeps`.

- [ ] **Step 3: Implement `src/render/code.ts`**

```ts
// Ensure-phase execution for CODE elements — the source/portrait contract:
// runs BEFORE layout on render's clone (B11), stamps el.code_result, degrades
// to an error envelope the layout draws as an error panel, never throws. The
// heavy runtime loads lazily inside code/run.ts, so a spec without a code
// element costs nothing.

import { runCode, type CodeRunDeps } from "../code/run";
import type { Spec } from "../spec/types";

export interface CodeResolution {
  id: string;
  ok: boolean;
  error?: string;
}

export async function resolveCode(spec: Spec, deps: CodeRunDeps = {}): Promise<CodeResolution[]> {
  const results: CodeResolution[] = [];
  for (const el of spec.elements ?? []) {
    if (el.type !== "code") continue;
    if (el.code_result) {
      results.push({ id: el.id, ok: true });
      continue;
    }
    if (!el.language || !el.code) {
      results.push({ id: el.id, ok: false, error: "code element needs language and code" });
      continue;
    }
    const result = await runCode({ language: el.language, code: el.code }, deps);
    el.code_result = JSON.stringify(result);
    results.push({ id: el.id, ok: result.ok, error: result.error });
  }
  return results;
}
```

- [ ] **Step 4: Wire the deps**

`src/render/resolve.ts` — extend the interface and the parallel await:

```ts
export interface RenderResolveDeps {
  /** render/portrait.ts's resolvePortraits — mutates the spec it is given. */
  resolvePortraits: (spec: Spec) => Promise<unknown>;
  /** render/source.ts's resolveSources — mutates the spec it is given. */
  resolveSources: (spec: Spec, opts: { contactEmail: string }) => Promise<unknown>;
  /** render/code.ts's resolveCode — mutates the spec it is given. */
  resolveCode: (spec: Spec) => Promise<unknown>;
  contactEmail: string;
}
```

```ts
  await Promise.all([
    deps.resolvePortraits(copy).catch(() => undefined),
    deps.resolveSources(copy, { contactEmail: deps.contactEmail }).catch(() => undefined),
    deps.resolveCode(copy).catch(() => undefined),
  ]);
```

`src/render/index.ts` — add `import { resolveCode } from "./code";` and extend line 101:

```ts
  spec = await resolvedRenderSpec(spec, { resolvePortraits, resolveSources, resolveCode, contactEmail: contactEmail() });
```

- [ ] **Step 5: Fix other `resolvedRenderSpec` callers** — `grep -rn "resolvedRenderSpec" src tests`. Every call site (exports, embed, tests) now needs `resolveCode` in its deps; pass the real `resolveCode` in app code and `async () => []` in tests that fake the other resolvers.

- [ ] **Step 6: Run tests** — `npx vitest run tests/code-element.test.ts` then `npm test`. Expected: PASS / green.

- [ ] **Step 7: Commit**

```bash
git add -A src tests
git commit -m "feat: resolveCode — ensure-phase execution stamped on the render clone"
```

---

### Task 6: Hoisting — outputs never visit the model

**Files:**
- Modify: `src/llm/hoist.ts` (carriesBlob at :17-19 and the three functions using `el.strokes`)
- Test: `tests/code-element.test.ts` (append)

**Interfaces:**
- Produces: hoist/restore/strip now cover `code_result` on code elements via a per-type blob-field map. Exported names stay unchanged (`hoistPortraitStrokes`, `restorePortraitStrokes`, `stripStrokesForModel`).

- [ ] **Step 1: Write the failing tests** (append)

```ts
import { HOISTED, hoistPortraitStrokes, restorePortraitStrokes, stripStrokesForModel } from "../src/llm/hoist";
import { parsePlaylistText } from "../src/playlist/playlist";
import { formatSpec } from "../src/spec/text";

describe("code element — hoisting", () => {
  const doc = formatSpec(codeSpec({}, OK), "yaml");

  test("code_result is hoisted to the sentinel and restored by id", () => {
    const { text, blobs } = hoistPortraitStrokes(doc);
    expect(text).toContain(HOISTED);
    expect(text).not.toContain("data:image/png");
    const playlist = parsePlaylistText(text);
    restorePortraitStrokes(playlist, blobs);
    expect(playlist.items[0].spec.elements![0].code_result).toBe(JSON.stringify(OK));
  });

  test("stripStrokesForModel drops code_result", () => {
    const stripped = stripStrokesForModel(codeSpec({}, OK));
    expect(stripped.elements![0].code_result).toBeUndefined();
  });
});
```

(If `parsePlaylistText`'s items accessor differs — check `itemsOf` in `src/playlist/playlist.ts` — use `itemsOf(playlist)[0]` instead of `playlist.items[0]`.)

- [ ] **Step 2: Run to verify failure** — the blob survives hoisting (text still contains the data URI).

- [ ] **Step 3: Generalize `src/llm/hoist.ts`**

Replace `carriesBlob` with a field map and use it in all three functions:

```ts
/** The field per element type that holds encoded machine output, if any. */
function blobField(el: SpecElement): "strokes" | "code_result" | null {
  if (el.type === "portrait" || el.type === "source") return "strokes";
  if (el.type === "code") return "code_result";
  return null;
}
```

`hoistPortraitStrokes` loop body becomes:

```ts
    for (const el of item.spec.elements ?? []) {
      const field = blobField(el);
      if (field && el[field] && el[field] !== HOISTED) {
        blobs.set(el.id, el[field]!);
        el[field] = HOISTED;
        any = true;
      }
    }
```

`restorePortraitStrokes` mirror:

```ts
    for (const el of item.spec.elements ?? []) {
      const field = blobField(el);
      if (field && el[field] === HOISTED) {
        const blob = blobs.get(el.id);
        if (blob) el[field] = blob;
        else delete el[field];
      }
    }
```

`stripStrokesForModel`:

```ts
export function stripStrokesForModel(spec: Spec): Spec {
  if (!spec.elements?.some((e) => { const f = blobField(e); return f && e[f]; })) return spec;
  return {
    ...spec,
    elements: spec.elements.map((e): SpecElement => {
      const f = blobField(e);
      return f && e[f] ? { ...e, [f]: undefined } : e;
    }),
  };
}
```

- [ ] **Step 4: Run tests** — code-element file, then `npm test` (the existing hoist tests must still pass — the portrait/source path is behavior-identical). Expected: green.

- [ ] **Step 5: Commit**

```bash
git add src/llm/hoist.ts tests/code-element.test.ts
git commit -m "feat: hoist code_result envelopes out of model round-trips"
```

---

### Task 7: Lint rules

**Files:**
- Modify: `src/lint/lint.ts` (rule union at :16, a `lintCode` beside `lintSources` at :174, wired into `lintCommands`)
- Test: `tests/code-element.test.ts` (append)

- [ ] **Step 1: Write the failing tests** (append)

```ts
import { lintCommands } from "../src/lint/lint";

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
```

- [ ] **Step 2: Run to verify failure** — `"code-use"` is not a `LintIssue["rule"]` (type error) / no issues produced.

- [ ] **Step 3: Implement**

Add `"code-use"` to the rule union (line 16). Beside `lintSources`:

```ts
/**
 * Code panels are load-bearing: the script executes in the viewer's browser.
 * These rules catch the storyboard killers — a script too long to narrate, a
 * split view too narrow to read, and figure-as-IDE (several panels at once).
 */
function lintCode(spec: Spec): LintIssue[] {
  const els = (spec.elements ?? []).filter((e) => e.type === "code");
  if (els.length === 0) return [];
  const issues: LintIssue[] = [];
  for (const el of els) {
    const lines = (el.code ?? "").split("\n").filter((l) => l.trim() !== "").length;
    if (lines > 22) {
      issues.push({
        rule: "code-use",
        ids: [el.id],
        message: `code "${el.id}" is ${lines} lines — a figure's script should stay under ~14; make the same point in fewer lines`,
        severity: "warn",
      });
    }
    if ((el.show ?? "output") === "split" && (el.width ?? 880) < 560) {
      issues.push({
        rule: "code-use",
        ids: [el.id],
        message: `code "${el.id}" uses split view at width ${el.width} — too narrow for two readable panes; use width ≥ 700 or show: "output"`,
        severity: "warn",
      });
    }
  }
  if (els.length > 1) {
    issues.push({
      rule: "code-use",
      ids: els.map((e) => e.id),
      message: `${els.length} code elements in one figure — one panel per figure; give each script its own figure`,
      severity: "warn",
    });
  }
  return issues;
}
```

Wire into `lintCommands`: `const issues: LintIssue[] = [...lintSources(spec), ...lintCode(spec)];`

- [ ] **Step 4: Run tests** — code-element file, then `npm test`. Expected: green.

- [ ] **Step 5: Commit**

```bash
git add src/lint/lint.ts tests/code-element.test.ts
git commit -m "feat: lint rules for code panels (length, narrow split, count)"
```

---

### Task 8: The pyodide runtime

**Files:**
- Replace: `src/code/pyodide.ts` (the Task 2 placeholder)

**Interfaces:**
- Consumes: `CodeRunRequest`, `CodeRunResult`, `CodeFigure`, `PYODIDE_VERSION` (type-only + constant imports from `./run` — no cycle: `run.ts` reaches this module only via dynamic import).
- Produces: `runPython(req: CodeRunRequest): Promise<CodeRunResult>`. Browser-only; node paths return an error envelope. No unit tests — verified by the Task 11 smoke (the vitest environment has no DOM or WASM).

- [ ] **Step 1: Implement**

```ts
// The pyodide runtime: boot once (memoized in-flight promise — the openstat
// bootstrap pattern, which fixes the half-initialized-interpreter race), run
// serialized, capture stdout/stderr, echo a trailing expression like a
// notebook, and harvest matplotlib figures as PNG data URIs with their pixel
// dimensions (layout needs the aspect; PNG bytes 16-24 carry w/h).
//
// Reached ONLY via dynamic import from run.ts. Never import this module
// statically anywhere: that would put pyodide's loader chunk on every page.
//
// Honest limitations (M1): no interrupt — pyodide can only be interrupted
// with a SharedArrayBuffer + COOP/COEP headers, which this app does not set —
// so a timeout abandons the result while the WASM finishes in the background,
// and the next queued run waits behind it.

import { PYODIDE_VERSION, type CodeFigure, type CodeRunRequest, type CodeRunResult } from "./run";

const PYODIDE_URL = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/pyodide.js`;
const RUN_TIMEOUT_MS = 180_000;

interface Pyodide {
  runPythonAsync(code: string): Promise<unknown>;
  loadPackagesFromImports(code: string): Promise<unknown>;
  setStdout(opts?: { batched: (s: string) => void }): void;
  setStderr(opts?: { batched: (s: string) => void }): void;
}

declare global {
  interface Window {
    loadPyodide?: (opts?: object) => Promise<Pyodide>;
  }
}

let bootPromise: Promise<Pyodide> | null = null;
let queue: Promise<unknown> = Promise.resolve();

function boot(): Promise<Pyodide> {
  if (bootPromise) return bootPromise;
  bootPromise = (async () => {
    if (typeof document === "undefined") throw new Error("python needs a browser to run in");
    if (!window.loadPyodide) {
      await new Promise<void>((resolve, reject) => {
        const script = document.createElement("script");
        script.src = PYODIDE_URL;
        script.onload = () => resolve();
        script.onerror = () => reject(new Error("could not load the Python runtime (offline?)"));
        document.head.appendChild(script);
      });
    }
    return window.loadPyodide!();
  })();
  // A failed boot must not poison every later run: clear so the next render retries.
  bootPromise.catch(() => {
    bootPromise = null;
  });
  return bootPromise;
}

/** Notebook semantics: exec the body, eval a trailing expression, print it. */
function execWrapper(code: string): string {
  return [
    "import ast as __ast",
    `__code = ${JSON.stringify(code)}`,
    "__tree = __ast.parse(__code) if __code.strip() else None",
    "if __tree and __tree.body and isinstance(__tree.body[-1], __ast.Expr):",
    "    __expr = __ast.Expression(__tree.body[-1].value)",
    "    __body = __ast.Module(__tree.body[:-1], type_ignores=[])",
    "    exec(compile(__body, '<code>', 'exec'), globals())",
    "    __result = eval(compile(__expr, '<code>', 'eval'), globals())",
    "    if __result is not None:",
    "        print(__result)",
    "elif __tree:",
    "    exec(compile(__tree, '<code>', 'exec'), globals())",
  ].join("\n");
}

/** Harvest matplotlib figures as base64 PNG + pixel dims; no-op without matplotlib. */
const HARVEST = `
import json as __json, io as __io, base64 as __b64, struct as __struct
__figs = []
try:
    import matplotlib.pyplot as __plt
except Exception:
    __plt = None
if __plt is not None:
    for __n in __plt.get_fignums():
        __fig = __plt.figure(__n)
        __buf = __io.BytesIO()
        __fig.savefig(__buf, format="png", bbox_inches="tight", dpi=110)
        __data = __buf.getvalue()
        __w, __h = __struct.unpack(">II", __data[16:24])
        __figs.append({"data": __b64.b64encode(__data).decode("ascii"), "w": __w, "h": __h})
    __plt.close("all")
__json.dumps(__figs)
`;

async function runOne(req: CodeRunRequest): Promise<CodeRunResult> {
  const status = req.onStatus ?? (() => undefined);
  status("loading", "Loading Python…");
  const py = await boot();
  status("loading", "Loading packages…");
  await py.loadPackagesFromImports(req.code).catch(() => undefined);
  let stdout = "";
  let stderr = "";
  py.setStdout({ batched: (s) => (stdout += s + "\n") });
  py.setStderr({ batched: (s) => (stderr += s + "\n") });
  let error: string | undefined;
  try {
    status("running", "Running…");
    await py.runPythonAsync(execWrapper(req.code));
  } catch (err) {
    // Pyodide's PythonError message carries the full Python traceback.
    error = (err as Error).message;
  }
  let figures: CodeFigure[] = [];
  if (!error && /\b(matplotlib|pyplot|plt)\b/.test(req.code)) {
    try {
      const raw = await py.runPythonAsync(HARVEST);
      if (typeof raw === "string") {
        figures = (JSON.parse(raw) as { data: string; w: number; h: number }[]).map((f) => ({
          href: `data:image/png;base64,${f.data}`,
          w: f.w,
          h: f.h,
        }));
      }
    } catch {
      /* a failed harvest loses the plot, not the run */
    }
  }
  py.setStdout();
  py.setStderr();
  return { ok: !error, stdout: stdout.replace(/\n$/, ""), stderr: stderr.replace(/\n$/, ""), figures, error };
}

export function runPython(req: CodeRunRequest): Promise<CodeRunResult> {
  const task = queue.then(() =>
    Promise.race([
      runOne(req),
      new Promise<CodeRunResult>((resolve) =>
        setTimeout(
          () => resolve({ ok: false, stdout: "", stderr: "", figures: [], error: `timed out after ${RUN_TIMEOUT_MS / 1000}s` }),
          RUN_TIMEOUT_MS,
        ),
      ),
    ]),
  );
  queue = task.catch(() => undefined);
  return task;
}
```

- [ ] **Step 2: Type-check and test** — `npx tsc --noEmit` (or `npm run build`), then `npm test`. Expected: clean / green (nothing in node reaches this module).

- [ ] **Step 3: Commit**

```bash
git add src/code/pyodide.ts
git commit -m "feat: pyodide runtime — memoized boot, serialized runs, plot harvest"
```

---

### Task 9: Execute-in-generation check

**Files:**
- Create: `src/code/check.ts`
- Modify: `src/llm/compile.ts` (`GenerateConfig`, and `generateSpec` right after the lint try/catch at ~:318-324, before `rounds.push`)
- Test: `tests/code-element.test.ts` (append)

**Interfaces:**
- Consumes: `CodeRunRequest`, `CodeRunResult` types from `./run`.
- Produces: `codeExecutionErrors(spec, run): Promise<{ errors: string[]; warnings: string[] }>`; `GenerateConfig` gains `executeCode?: boolean` and `codeRunner?: (req: CodeRunRequest) => Promise<CodeRunResult>`.

- [ ] **Step 1: Write the failing tests** (append)

```ts
import { codeExecutionErrors } from "../src/code/check";

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
    expect(out).toEqual({ errors: [], warnings: [] });
  });
});
```

- [ ] **Step 2: Run to verify failure** — module `../src/code/check` not found.

- [ ] **Step 3: Implement `src/code/check.ts`**

```ts
// Authoring-time execution check: actually RUN each python code element the
// model wrote and turn failures into validation errors the existing repair
// round fixes — AI-written code that errors gets repaired before the author
// ever sees it. The runner is injected (node tests use fakes); generation
// passes the real runCode, which also warms the IndexedDB result cache the
// first render will then hit.

import type { Spec } from "../spec/types";
import type { CodeRunRequest, CodeRunResult } from "./run";

export interface CodeCheckOutcome {
  errors: string[];
  warnings: string[];
}

export async function codeExecutionErrors(
  spec: Spec,
  run: (req: CodeRunRequest) => Promise<CodeRunResult>,
): Promise<CodeCheckOutcome> {
  const out: CodeCheckOutcome = { errors: [], warnings: [] };
  for (const el of spec.elements ?? []) {
    if (el.type !== "code" || el.language !== "python" || !el.code) continue;
    let res: CodeRunResult;
    try {
      res = await run({ language: "python", code: el.code });
    } catch {
      return out; // runtime unavailable (offline, node) — never block generation
    }
    if (!res.ok || res.error) {
      out.errors.push(
        `code element "${el.id}" fails when executed — fix the script:\n${(res.error ?? res.stderr).slice(0, 600)}`,
      );
    } else if (res.stderr.trim() !== "") {
      out.warnings.push(`code "${el.id}" writes to stderr (${res.stderr.trim().slice(0, 200)}) — silence it or fix the cause`);
    }
  }
  return out;
}
```

- [ ] **Step 4: Wire into `generateSpec`**

In `src/llm/compile.ts`, add to `GenerateConfig`:

```ts
  /** Run python code elements during validation and feed failures to repair (default on; node/test contexts inject codeRunner or set false). */
  executeCode?: boolean;
  /** Injected runner for the execution check; defaults to the real runCode. */
  codeRunner?: (req: CodeRunRequest) => Promise<CodeRunResult>;
```

with `import { codeExecutionErrors } from "../code/check";` and `import type { CodeRunRequest, CodeRunResult } from "../code/run";` at the top. Then, inside the loop right after the lint try/catch (after line ~323, still inside `if (validation.ok)`) and before `rounds.push(...)`:

```ts
        if (cfg.executeCode !== false && (best.elements ?? []).some((e) => e.type === "code")) {
          const run = cfg.codeRunner ?? (await import("../code/run")).runCode;
          const check = await codeExecutionErrors(best, run);
          validation.errors.push(...check.errors);
          for (const w of check.warnings) {
            lintIssues.push({ rule: "code-use", ids: [], message: w, severity: "warn" });
          }
        }
```

(`validation.errors` entries flow into the existing repair feedback and `needsRepair` untouched.)

- [ ] **Step 5: Run tests** — code-element file, then `npm test`. Expected: green (existing compile tests pass unchanged: they have no code elements, so the block is inert).

- [ ] **Step 6: Commit**

```bash
git add src/code/check.ts src/llm/compile.ts tests/code-element.test.ts
git commit -m "feat: execute AI-written code during generation; errors feed the repair round"
```

---

### Task 10: Teach the model — prompt bullet + bundled example

**Files:**
- Modify: `src/llm/prompts/compiler-v1.md` (insert after the `source` bullet, line 43)
- Modify: `src/examples.json` (append one `{request, spec}` entry)

- [ ] **Step 1: Add the prompt bullet** (after line 43, before the Resource-links bullet):

```md
- **code** runs a real script and draws its code and/or output ON the canvas — `{"id": "sim", "type": "code", "language": "python", "show": "split", "code": "import numpy as np\nrng = np.random.default_rng(7)\nx = rng.normal(size=200)\nprint(round(x.mean(), 3))"}`. The script EXECUTES in the viewer's browser at figure-preparation time, so treat it as load-bearing: keep it short (≤ ~14 lines), SEED any randomness, print() exactly the numbers the narration mentions, and end with at most ONE matplotlib plot. Each code line is its own drawable `<id>_line_1` … `<id>_line_N` and the output panel is `<id>_out` — the signature move is stepping: `{"draw": ["sim_line_1"], "speak": "First, two hundred random draws."}` per line (group related lines in one draw), then `{"draw": ["sim_out"], "speak": "And the mean lands where theory says."}` when the result should land. `show` picks the layout: `"output"` (just the result — the default), `"split"` (code left, output right; give the element width ≥ 700), `"code"` (the script alone). Python only for now — never emit `"language": "r"`. One code element per figure. Never write `code_result` — the app fills it.
```

- [ ] **Step 2: Append the bundled example** to `src/examples.json` (last array entry):

```json
{
  "request": "Step through a tiny Python simulation: 200 random draws, their mean, and a histogram",
  "spec": {
    "title": "The law of large numbers, live",
    "elements": [
      {
        "id": "sim",
        "type": "code",
        "language": "python",
        "show": "split",
        "width": 900,
        "code": "import numpy as np\nimport matplotlib.pyplot as plt\nrng = np.random.default_rng(7)\nx = rng.normal(size=200)\nprint(\"mean:\", round(x.mean(), 3))\nplt.hist(x, bins=20)"
      }
    ],
    "commands": [
      { "speak": "Can two hundred random numbers already know where their center is? Let's run it for real." },
      { "draw": ["sim_line_1", "sim_line_2"], "parallel": true, "speak": "Numpy for the numbers, matplotlib for the picture." },
      { "draw": ["sim_line_3"], "speak": "A seeded generator — so this figure shows the same truth every time." },
      { "draw": ["sim_line_4"], "speak": "Two hundred draws from a standard normal." },
      { "draw": ["sim_line_5", "sim_line_6"], "speak": "Print the mean, and pile the draws into a histogram." },
      { "draw": ["sim_out"], "delivery": "grave", "speak": "The mean sits near zero, and the familiar bell is already there — randomness, obeying a law." }
    ]
  }
}
```

- [ ] **Step 3: Verify the example validates** — the suite already has a test that runs every bundled example through `validateSpec`/layout (look for the test that iterates `examples.json`; if none exists, add to `tests/code-element.test.ts`):

```ts
import examples from "../src/examples.json";

test("the bundled code example validates and lays out", () => {
  const ex = (examples as { request: string; spec: unknown }[]).find((e) => e.request.includes("200 random draws"))!;
  const v = validateSpec(ex.spec);
  expect(v.errors).toEqual([]);
  expect(() => layoutSpec(ex.spec as Spec, heuristicMeasure)).not.toThrow();
});
```

- [ ] **Step 4: Run** — `npm test`. Expected: green.

- [ ] **Step 5: Commit**

```bash
git add src/llm/prompts/compiler-v1.md src/examples.json tests/code-element.test.ts
git commit -m "feat: teach the compiler the code element (prompt bullet + bundled example)"
```

---

### Task 11: Build, manual smoke, push

- [ ] **Step 1: Full verification**

```bash
npm test && npm run build && npm run build:engine
```

Expected: all green; `scripts/check-engine-build.mjs` passes. Check `dist-engine/` chunk listing — there must be NO pyodide payload in it (the runtime is CDN-loaded at runtime; only the small `src/code/*` chunks may appear, lazily).

- [ ] **Step 2: Manual smoke checklist** (dev server, real browser — this is where pyodide actually runs; vitest cannot cover it):

1. Paste this spec in the editor and play:

```yaml
title: Smoke — python output
elements:
  - id: demo
    type: code
    language: python
    show: split
    code: |
      import numpy as np
      import matplotlib.pyplot as plt
      rng = np.random.default_rng(7)
      x = rng.normal(size=200)
      print("mean:", round(x.mean(), 3))
      plt.hist(x, bins=20)
commands:
  - draw: [demo_line_1, demo_line_2]
    speak: "Numpy and matplotlib."
  - draw: [demo_line_3, demo_line_4]
    speak: "Two hundred seeded draws."
  - draw: [demo_line_5, demo_line_6]
    speak: "Mean, and histogram."
  - draw: [demo_out]
    speak: "There it is."
```

Verify: first play boots pyodide (network tab shows the jsDelivr fetch), lines step in mono type, `demo_out` shows `mean: -0.052`-ish text and the histogram PNG; **reload and replay** — no pyodide fetch (IndexedDB cache hit), instant output.
2. `show: output` variant renders output only. A syntax error in the code renders the red error panel and playback completes.
3. Scrub the seek bar back and forth across the line beats — exact restore.
4. Export the movie — the code panel, mono text and plot are IN the video.
5. A spec **without** a code element: network tab shows no pyodide/no `src/code` chunks.
6. Generate with AI: "Step through a tiny Python simulation of 200 coin flips and print the share of heads" — watch a working figure arrive (and, if the model errs, the repair round fixing it).

- [ ] **Step 3: Push**

```bash
git push
```

Then report to Hans: what landed, the smoke results, and that M2 (webR) is next.
