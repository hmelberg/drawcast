# Code Controls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A code element lists `controls: [n, beta]`; the named variables' literals in the script become sliders, choice rows, toggles, text/number fields and buttons in the ⊕ tray; moving one rewrites the literal in the script, re-runs it through the tray's existing Run path, and the panel and any figure it feeds repaint. Defaults are baked into the document's `code_result`, so movies see the default run. Nothing persists past Continue.

**Architecture:** One pure string module (`src/code/controls.ts`) parses a script for named variables' birthplaces (a top-level assignment or a function default), classifies the literal (shorthand tuple/list/bool/string/number or longhand `Slider(...)`/`Choice(...)`/…) and rewrites it in place with a value, never changing the line count. The resolver, the authoring-time check and the panel layout apply the defaults through it; the tray parses the AUTHORED code (tokens and tuples intact) and runs `applyControls(...)` through `runEdited`. Lint, schema and the code prompt fragment learn one `controls: string[]` (plus `glow` and `autorun` booleans).

**Tech Stack:** TypeScript (strict, `erasableSyntaxOnly`), vitest (no jsdom — pure modules + source-level pins), the existing tray/preview machinery. Netlify builds run `npm test && npm run build` (tsc), so `npx tsc --noEmit` must be clean before every push.

**Spec:** `docs/superpowers/specs/2026-09-14-code-controls-design.md`

## Global Constraints

- No persistence: control values are preview state, cleared with the tray's `clearPreview()`; `ask`/`store` is untouched.
- The rewrite never changes the line count (`<id>_line_N` beats are indexed by source line).
- The rewritten script is what runs AND what the panel draws; tuples and longhand calls never appear on screen.
- Schema stays anyOf-free: `controls` is `string[]`, `glow` and `autorun` are booleans.
- Every prompt/schema addition re-pins BOTH constants in `tests/prompt-size.test.ts` with a dated note (feedback rule 2026-09-10).
- `basic` scripts get no controls (lint error).
- Python family = `python | brython | micropython | microdata` share one grammar; `r` has its own.
- Run `npm test` and `npx tsc --noEmit` before each commit that touches `src/`.
- Commit messages end with the session's attribution lines (see the repo's recent `git log`).

---

### Task 1: The control grammar — Python shorthand, birthplaces, issues

**Files:**
- Create: `src/code/controls.ts`
- Test: `tests/code-controls.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type ControlKind = "slider" | "choice" | "toggle" | "text" | "number" | "button";
  export type ControlValue = number | string | boolean;
  export interface ControlSpec {
    name: string; kind: ControlKind; label: string;
    default: ControlValue;
    min?: number; max?: number; step?: number; integer?: boolean; decimals?: number; // slider, number
    options?: string[];   // choice
    caption?: string;     // button
    line: number; start: number; end: number;      // literal span: 0-based line, [start,end) columns
    birthplace: "assign" | "param";
  }
  export interface ControlIssue { name: string; message: string; severity: "error" | "warn" }
  export interface ParsedControls { controls: ControlSpec[]; issues: ControlIssue[] }
  export function grammarFor(language: string): "python" | "r" | null;
  export function parseControls(language: string, code: string, names: string[]): ParsedControls;
  ```

- [ ] **Step 1: Write the failing tests (shorthand + birthplaces + issues)**

```ts
// tests/code-controls.test.ts
// The control grammar (spec 2026-09-14 §2.2–2.4): names in the spec, shapes
// in the script. Pure string functions — no DOM, no runtime.
import { describe, expect, test } from "vitest";
import { applyControls, grammarFor, parseControls, withControlDefaults } from "../src/code/controls";

const py = (code: string, names: string[]) => parseControls("python", code, names);

describe("grammarFor", () => {
  test("the python family shares one grammar; r its own; basic none", () => {
    expect(grammarFor("python")).toBe("python");
    expect(grammarFor("brython")).toBe("python");
    expect(grammarFor("micropython")).toBe("python");
    expect(grammarFor("microdata")).toBe("python");
    expect(grammarFor("r")).toBe("r");
    expect(grammarFor("basic")).toBeNull();
    expect(grammarFor("cobol")).toBeNull();
  });
});

describe("parseControls — python shorthand", () => {
  test("a two-integer tuple is an integer slider with step 1 and the midpoint default", () => {
    const { controls, issues } = py("n = (1, 50)\nprint(n)", ["n"]);
    expect(issues).toEqual([]);
    expect(controls).toHaveLength(1);
    const c = controls[0];
    expect(c).toMatchObject({ name: "n", kind: "slider", label: "n", min: 1, max: 50, step: 1, integer: true, default: 25, line: 0, birthplace: "assign" });
    expect("n = (1, 50)".slice(c.start, c.end)).toBe("(1, 50)");
  });

  test("a decimal point anywhere makes a float slider; the third number is the step", () => {
    expect(py("beta = (0.1, 1.0, 0.05)", ["beta"]).controls[0]).toMatchObject({ kind: "slider", min: 0.1, max: 1, step: 0.05, integer: false, decimals: 2 });
    expect(py("x = (1, 5, 0.5)", ["x"]).controls[0]).toMatchObject({ integer: false, step: 0.5, default: 3 });
    expect(py("x = (0, 100, 5)", ["x"]).controls[0]).toMatchObject({ integer: true, step: 5, default: 50 });
  });

  test("a float slider without a step gets a nice hundredth of the range", () => {
    expect(py("x = (0.1, 1.0)", ["x"]).controls[0].step).toBe(0.01);
    expect(py("x = (0.0, 49.0)", ["x"]).controls[0].step).toBe(0.5);
  });

  test("a list of strings is a choice row, default the first item", () => {
    expect(py('model = ["SIR", "SEIR"]', ["model"]).controls[0]).toMatchObject({ kind: "choice", options: ["SIR", "SEIR"], default: "SIR" });
    expect(py("m = ['a', 'b', 'c']", ["m"]).controls[0].options).toEqual(["a", "b", "c"]);
  });

  test("a bool is a toggle, a string a text field, a number a number field (never a guessed range)", () => {
    expect(py("log = False", ["log"]).controls[0]).toMatchObject({ kind: "toggle", default: false });
    expect(py("log = True", ["log"]).controls[0]).toMatchObject({ kind: "toggle", default: true });
    expect(py('name = "Alice"', ["name"]).controls[0]).toMatchObject({ kind: "text", default: "Alice" });
    expect(py("seed = 3", ["seed"]).controls[0]).toMatchObject({ kind: "number", default: 3, integer: true });
    expect(py("rate = 2.5", ["rate"]).controls[0]).toMatchObject({ kind: "number", default: 2.5, integer: false });
  });

  test("a trailing comment does not reach the literal", () => {
    const c = py("n = (1, 50)  # cycles", ["n"]).controls[0];
    expect(c).toMatchObject({ kind: "slider", max: 50 });
    expect("n = (1, 50)  # cycles".slice(c.start, c.end)).toBe("(1, 50)");
  });

  test("a default argument in a def line is a birthplace too", () => {
    const code = "def simulate(n=(1, 50), beta=(0.1, 1.0)):\n    return n * beta\nsimulate()";
    const { controls, issues } = py(code, ["n", "beta"]);
    expect(issues).toEqual([]);
    expect(controls.map((c) => c.birthplace)).toEqual(["param", "param"]);
    expect(controls[1]).toMatchObject({ name: "beta", line: 0 });
    expect(code.split("\n")[0].slice(controls[1].start, controls[1].end)).toBe("(0.1, 1.0)");
  });

  test("controls come back in the order of `names`, not the order in the script", () => {
    const { controls } = py("b = 1\na = 2", ["a", "b"]);
    expect(controls.map((c) => c.name)).toEqual(["a", "b"]);
  });
});

describe("parseControls — issues", () => {
  test("a name with no birthplace is an error", () => {
    const { controls, issues } = py("print(1)", ["n"]);
    expect(controls).toEqual([]);
    expect(issues).toEqual([{ name: "n", message: expect.stringContaining("no birthplace"), severity: "error" }]);
  });

  test("a name born twice is an error (two assignments, or an assignment and a default)", () => {
    expect(py("n = (1, 5)\nn = (2, 6)", ["n"]).issues[0]).toMatchObject({ name: "n", severity: "error", message: expect.stringContaining("twice") });
    expect(py("n = (1, 5)\ndef f(n=3):\n    pass", ["n"]).issues[0]).toMatchObject({ name: "n", severity: "error" });
  });

  test("an assignment that is not a control literal is not a birthplace; a later plain literal warns", () => {
    const { controls, issues } = py("x = (1, 50)\nx = x * 2", ["x"]);
    expect(controls).toHaveLength(1);
    expect(issues).toEqual([]);
    const later = py("x = (1, 50)\nx = 5", ["x"]);
    expect(later.controls).toHaveLength(1);
    expect(later.issues).toEqual([{ name: "x", message: expect.stringContaining("reassigned"), severity: "warn" }]);
  });

  test("a literal outside the grammar is an error", () => {
    expect(py("x = {'a': 1}", ["x"]).issues[0]).toMatchObject({ name: "x", severity: "error", message: expect.stringContaining("not a control literal") });
    expect(py("x = [1, 2]", ["x"]).issues[0]).toMatchObject({ severity: "error" });
    expect(py("x = f(2)", ["x"]).issues[0]).toMatchObject({ severity: "error" });
  });

  test("an unsupported language reports every name as an error", () => {
    expect(parseControls("basic", "10 N = 5", ["N"]).issues[0]).toMatchObject({ name: "N", severity: "error", message: expect.stringContaining("basic") });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/code-controls.test.ts`
Expected: FAIL — `Cannot find module '../src/code/controls'`.

- [ ] **Step 3: Write the module (grammar + birthplaces; `applyControls`/`withControlDefaults` are Task 3 but export stubs so the file compiles)**

```ts
// src/code/controls.ts
// Code controls (design 2026-09-14-code-controls): `controls: [n, beta]` on a
// code element names variables; each is BORN once in the script as a control
// literal — a range tuple, a list of strings, a bool, a string, a number — or
// as a longhand Slider(...)/Choice(...)/Toggle(...)/Text(...)/Number(...)/
// Button(...) call. This module finds the birthplace, classifies it, and
// rewrites the literal's span with a value. Pure strings: the lint, the
// resolver, the check, the panel layout and the tray all share it, and node
// tests cover it without a DOM or a runtime.

export type ControlKind = "slider" | "choice" | "toggle" | "text" | "number" | "button";
export type ControlValue = number | string | boolean;

export interface ControlSpec {
  name: string;
  kind: ControlKind;
  label: string;
  default: ControlValue;
  min?: number;
  max?: number;
  step?: number;
  integer?: boolean;
  /** Display decimals — the step's, or 0 for an integer. */
  decimals?: number;
  options?: string[];
  caption?: string;
  /** The literal's span: 0-based line, [start, end) columns within that line. */
  line: number;
  start: number;
  end: number;
  birthplace: "assign" | "param";
}

export interface ControlIssue {
  name: string;
  message: string;
  severity: "error" | "warn";
}

export interface ParsedControls {
  controls: ControlSpec[];
  issues: ControlIssue[];
}

export type Grammar = "python" | "r";

/** Which grammar a language reads; null = no controls for this language. */
export function grammarFor(language: string): Grammar | null {
  if (language === "python" || language === "brython" || language === "micropython" || language === "microdata") return "python";
  if (language === "r") return "r";
  return null;
}

const NUM = String.raw`-?\d+(?:\.\d+)?`;
const STR = String.raw`"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'`;
const IDENT = String.raw`[A-Za-z_][A-Za-z0-9_.]*`;

/** A number's source text is "integer" when it carries no decimal point. */
const isIntText = (t: string): boolean => !t.includes(".");

/** A nice step for a float range: the {1,2,5}×10^k closest to range/100. */
function niceStep(range: number): number {
  const raw = range / 100;
  if (!(raw > 0)) return 0.01;
  const exp = Math.floor(Math.log10(raw));
  const candidates = [1, 2, 5].map((m) => m * 10 ** exp).concat(10 ** (exp + 1));
  let best = candidates[0];
  for (const c of candidates) if (Math.abs(c - raw) < Math.abs(best - raw)) best = c;
  return Number(best.toPrecision(12));
}

function decimalsOf(step: number): number {
  const s = String(step);
  const i = s.indexOf(".");
  return i < 0 ? 0 : Math.min(6, s.length - i - 1);
}

/** Midpoint on the step grid (floor, so (1, 50) gives 25 — Hans' reading of "midpoint"). */
function midpoint(min: number, max: number, step: number, integer: boolean): number {
  const mid = min + Math.floor((max - min) / 2 / step) * step;
  return integer ? Math.round(mid) : Number(mid.toFixed(decimalsOf(step)));
}

function unquote(s: string): string {
  return s.slice(1, -1).replace(/\\(["'\\])/g, "$1");
}

/** Split `a, b, key=c` at depth 0 — parentheses, brackets and strings respected. */
function splitArgs(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  let quote: string | null = null;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quote) {
      cur += ch;
      if (ch === "\\") {
        cur += s[++i] ?? "";
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      cur += ch;
      continue;
    }
    if (ch === "(" || ch === "[" || ch === "{") depth++;
    if (ch === ")" || ch === "]" || ch === "}") depth--;
    if (ch === "," && depth === 0) {
      out.push(cur.trim());
      cur = "";
      continue;
    }
    cur += ch;
  }
  if (cur.trim() !== "") out.push(cur.trim());
  return out;
}

/** Strip a trailing `# comment` that is not inside a string. */
function stripComment(line: string): string {
  let quote: string | null = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quote) {
      if (ch === "\\") i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === "#") return line.slice(0, i);
  }
  return line;
}

type Classified = Omit<ControlSpec, "name" | "line" | "start" | "end" | "birthplace" | "label"> & { label?: string };

/** Classify one literal's source text; null = not a control literal. */
export function classifyLiteral(grammar: Grammar, lit: string): Classified | { error: string } | null {
  const t = lit.trim();
  const bools = grammar === "python" ? { t: "True", f: "False" } : { t: "TRUE", f: "FALSE" };
  if (t === bools.t || t === bools.f) return { kind: "toggle", default: t === bools.t };
  if (new RegExp(`^(?:${STR})$`).test(t)) return { kind: "text", default: unquote(t) };
  if (new RegExp(`^${NUM}$`).test(t)) return { kind: "number", default: Number(t), integer: isIntText(t), decimals: isIntText(t) ? 0 : decimalsOf(Number(t)) };
  // shorthand range: (a, b[, step]) in python, c(a, b[, step]) in r
  const rangeRe = grammar === "python" ? new RegExp(`^\\(\\s*(${NUM})\\s*,\\s*(${NUM})\\s*(?:,\\s*(${NUM})\\s*)?\\)$`) : new RegExp(`^c\\(\\s*(${NUM})\\s*,\\s*(${NUM})\\s*(?:,\\s*(${NUM})\\s*)?\\)$`);
  const r = rangeRe.exec(t);
  if (r) return sliderFrom(r[1], r[2], r[3]);
  // shorthand choices: ["a", "b"] in python, c("a", "b") in r
  const listRe = grammar === "python" ? /^\[(.*)\]$/s : /^c\((.*)\)$/s;
  const l = listRe.exec(t);
  if (l) {
    const items = splitArgs(l[1]);
    if (items.length > 0 && items.every((x) => new RegExp(`^(?:${STR})$`).test(x))) {
      const options = items.map(unquote);
      return { kind: "choice", options, default: options[0] };
    }
    return { error: "a list must hold only strings to be a choice row (numbers want a range tuple)" };
  }
  // longhand
  const call = /^(Slider|Choice|Toggle|Text|Number|Button)\s*\((.*)\)$/s.exec(t);
  if (call) return longhand(grammar, call[1], splitArgs(call[2]));
  return null;
}

function sliderFrom(a: string, b: string, s: string | undefined, extra: Partial<Classified> = {}): Classified | { error: string } {
  const min = Number(a);
  const max = Number(b);
  if (!(max > min)) return { error: `a range needs min < max (got ${a}, ${b})` };
  const integer = isIntText(a) && isIntText(b) && (s === undefined || isIntText(s));
  const step = s !== undefined ? Number(s) : integer ? 1 : niceStep(max - min);
  if (!(step > 0)) return { error: "a step must be positive" };
  const decimals = integer ? 0 : decimalsOf(step);
  const def = extra.default !== undefined ? extra.default : midpoint(min, max, step, integer);
  return { kind: "slider", min, max, step, integer, decimals, default: def, label: extra.label };
}

function longhand(grammar: Grammar, ctor: string, args: string[]): Classified | { error: string } {
  const positional: string[] = [];
  const kw: Record<string, string> = {};
  for (const a of args) {
    const m = /^([A-Za-z_]\w*)\s*=\s*(.+)$/s.exec(a);
    if (m) kw[m[1]] = m[2].trim();
    else positional.push(a);
  }
  const strOf = (v: string | undefined): string | undefined => (v !== undefined && new RegExp(`^(?:${STR})$`).test(v) ? unquote(v) : undefined);
  const numOf = (v: string | undefined): number | undefined => (v !== undefined && new RegExp(`^${NUM}$`).test(v) ? Number(v) : undefined);
  const label = strOf(kw.label);
  if (kw.label !== undefined && label === undefined) return { error: "label must be a quoted string" };
  switch (ctor) {
    case "Slider": {
      if (positional.length < 2) return { error: "Slider needs min and max" };
      const stepText = kw.step ?? positional[2];
      if (stepText !== undefined && numOf(stepText) === undefined) return { error: "step must be a number" };
      const def = kw.default !== undefined ? numOf(kw.default) : undefined;
      if (kw.default !== undefined && def === undefined) return { error: "default must be a number" };
      const c = sliderFrom(positional[0], positional[1], stepText, { default: def, label });
      if ("error" in c) return c;
      if (def !== undefined && (def < c.min! || def > c.max!)) return { error: `default ${def} is outside the range ${c.min}–${c.max}` };
      return c;
    }
    case "Choice": {
      const options = positional.map((p) => strOf(p));
      if (options.length === 0 || options.some((o) => o === undefined)) return { error: "Choice needs one or more quoted strings" };
      const opts = options as string[];
      const def = strOf(kw.default) ?? opts[0];
      if (!opts.includes(def)) return { error: `default "${def}" is not one of the choices` };
      return { kind: "choice", options: opts, default: def, label };
    }
    case "Toggle": {
      const bools = grammar === "python" ? { t: "True", f: "False" } : { t: "TRUE", f: "FALSE" };
      const v = positional[0] ?? kw.default ?? bools.f;
      if (v !== bools.t && v !== bools.f) return { error: `Toggle takes ${bools.t} or ${bools.f}` };
      return { kind: "toggle", default: v === bools.t, label };
    }
    case "Text": {
      const v = strOf(positional[0] ?? kw.default ?? '""');
      if (v === undefined) return { error: "Text takes a quoted string" };
      return { kind: "text", default: v, label };
    }
    case "Number": {
      const text = positional[0] ?? kw.default;
      const v = numOf(text);
      if (text === undefined || v === undefined) return { error: "Number takes a number" };
      return { kind: "number", default: v, integer: isIntText(text), decimals: isIntText(text) ? 0 : decimalsOf(v), label };
    }
    case "Button": {
      const caption = strOf(positional[0] ?? kw.label);
      return { kind: "button", default: 0, caption: caption ?? "Run", label: label ?? caption };
    }
    default:
      return { error: `unknown control ${ctor}` };
  }
}

interface Candidate {
  name: string;
  line: number;
  start: number;
  end: number;
  birthplace: "assign" | "param";
  text: string;
}

/** Every `name = LITERAL` (top level) and `def f(name=LITERAL)` in the script, with spans. */
function candidates(grammar: Grammar, code: string, names: Set<string>): Candidate[] {
  const out: Candidate[] = [];
  const lines = code.split("\n");
  const assignRe = grammar === "python" ? new RegExp(`^(${IDENT})\\s*=(?!=)\\s*(.*)$`) : new RegExp(`^(${IDENT})\\s*(?:<-|=)(?!=)\\s*(.*)$`);
  const defRe = grammar === "python" ? /^\s*def\s+[A-Za-z_]\w*\s*\((.*)\)\s*(?:->[^:]*)?:\s*$/ : /^\s*[A-Za-z_.][\w.]*\s*<-\s*function\s*\((.*)\)\s*\{?\s*$/;
  lines.forEach((raw, lineNo) => {
    const line = stripComment(raw);
    const d = defRe.exec(line);
    if (d) {
      const inner = d[1];
      const innerStart = line.indexOf(inner, line.indexOf("("));
      let pos = 0;
      for (const arg of splitArgs(inner)) {
        const at = inner.indexOf(arg, pos);
        pos = at + arg.length;
        const m = /^([A-Za-z_][\w.]*)\s*=\s*(.+)$/s.exec(arg);
        if (!m || !names.has(m[1])) continue;
        const litStart = innerStart + at + arg.indexOf(m[2], m[1].length);
        out.push({ name: m[1], line: lineNo, start: litStart, end: litStart + m[2].length, birthplace: "param", text: m[2] });
      }
      return;
    }
    const a = assignRe.exec(line);
    if (!a || !names.has(a[1])) return;
    if (grammar === "r" && /^\s*function\b/.test(a[2])) return; // a function definition, handled above
    const rhs = a[2].replace(/\s+$/, "");
    const start = line.length - a[2].length;
    out.push({ name: a[1], line: lineNo, start, end: start + rhs.length, birthplace: "assign", text: rhs });
  });
  return out;
}

export function parseControls(language: string, code: string, names: string[]): ParsedControls {
  const grammar = grammarFor(language);
  const issues: ControlIssue[] = [];
  if (grammar === null) {
    for (const name of names) issues.push({ name, message: `controls are not available for ${language} scripts`, severity: "error" });
    return { controls: [], issues };
  }
  const wanted = new Set(names);
  const found = candidates(grammar, code, wanted);
  const controls: ControlSpec[] = [];
  const isShape = (k: Classified): boolean => k.kind === "slider" || k.kind === "choice" || k.kind === "button";
  for (const name of names) {
    const mine = found.filter((c) => c.name === name);
    const classified = mine.map((c) => ({ c, k: classifyLiteral(grammar, c.text) }));
    const ok = classified.filter((x): x is { c: Candidate; k: Classified } => x.k !== null && !("error" in x.k));
    const bad = classified.filter((x): x is { c: Candidate; k: { error: string } } => x.k !== null && "error" in x.k);
    if (ok.length === 0) {
      if (bad.length > 0) issues.push({ name, message: `"${name}" is not a control literal: ${bad[0].k.error}`, severity: "error" });
      else if (mine.length > 0) issues.push({ name, message: `"${name}" is not a control literal (${mine[0].text.slice(0, 40)}) — write a range tuple, a list of strings, a bool, a string, a number, or Slider(...)/Choice(...)/…`, severity: "error" });
      else issues.push({ name, message: `"${name}" has no birthplace in the script — assign it a control literal at top level, or give it as a default argument`, severity: "error" });
      continue;
    }
    // The first classifiable candidate is the birthplace. A later SHAPE (a
    // range, a list, a Button) or any later def default is a second birth —
    // an error. A later plain value (a number, a string, a bool) in an
    // assignment is the script overwriting its own control — a warning.
    const first = ok[0];
    const rest = ok.slice(1);
    const seconds = rest.filter((x) => x.c.birthplace === "param" || isShape(x.k));
    if (seconds.length > 0) {
      issues.push({ name, message: `"${name}" is born twice (lines ${[first, ...seconds].map((b) => b.c.line + 1).join(" and ")}) — a control has one birthplace`, severity: "error" });
      continue;
    }
    const spec = first.k;
    controls.push({ ...spec, name, label: spec.label ?? name, line: first.c.line, start: first.c.start, end: first.c.end, birthplace: first.c.birthplace });
    const later = rest.find((x) => x.c.birthplace === "assign" && x.c.line > first.c.line);
    if (later) issues.push({ name, message: `"${name}" is reassigned to a literal on line ${later.c.line + 1} — the control's value would be overwritten`, severity: "warn" });
  }
  return { controls, issues };
}

// applyControls / withControlDefaults / formatValue: Task 3.
export function formatValue(_language: string, _control: ControlSpec, _value: ControlValue): string {
  throw new Error("Task 3");
}
export function applyControls(_language: string, _code: string, _controls: ControlSpec[], _values: Record<string, ControlValue>): string {
  throw new Error("Task 3");
}
export function withControlDefaults(_language: string, _code: string, _names: string[] | undefined): string {
  throw new Error("Task 3");
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/code-controls.test.ts`
Expected: the `grammarFor`, shorthand and issues describes PASS (the Task 3 functions are not called yet).

- [ ] **Step 5: Commit**

```bash
git add src/code/controls.ts tests/code-controls.test.ts
git commit -m "Code controls: the grammar — python shorthand literals, birthplaces in assignments and def defaults, issues (Task 1)"
```

---

### Task 2: Longhand calls and the R grammar

**Files:**
- Modify: `src/code/controls.ts` (already handles longhand and R in Task 1's code — this task pins them with tests and fixes what the tests find)
- Test: `tests/code-controls.test.ts`

**Interfaces:** unchanged.

- [ ] **Step 1: Add the failing tests**

```ts
describe("parseControls — longhand", () => {
  test("Slider with step, default and label", () => {
    const c = py('n = Slider(1, 50, default=10, label="Cycles")', ["n"]).controls[0];
    expect(c).toMatchObject({ kind: "slider", min: 1, max: 50, step: 1, integer: true, default: 10, label: "Cycles" });
    expect('n = Slider(1, 50, default=10, label="Cycles")'.slice(c.start, c.end)).toBe('Slider(1, 50, default=10, label="Cycles")');
    expect(py("b = Slider(0.1, 1.0, step=0.05)", ["b"]).controls[0]).toMatchObject({ step: 0.05, integer: false, decimals: 2 });
  });
  test("Choice, Toggle, Text, Number, Button", () => {
    expect(py('m = Choice("SIR", "SEIR", label="Model")', ["m"]).controls[0]).toMatchObject({ kind: "choice", options: ["SIR", "SEIR"], default: "SIR", label: "Model" });
    expect(py('m = Choice("a", "b", default="b")', ["m"]).controls[0].default).toBe("b");
    expect(py('t = Toggle(True, label="Log")', ["t"]).controls[0]).toMatchObject({ kind: "toggle", default: true, label: "Log" });
    expect(py('s = Text("Alice", label="Name")', ["s"]).controls[0]).toMatchObject({ kind: "text", default: "Alice", label: "Name" });
    expect(py('k = Number(3, label="Seed")', ["k"]).controls[0]).toMatchObject({ kind: "number", default: 3, integer: true, label: "Seed" });
    expect(py('r = Button("Roll again")', ["r"]).controls[0]).toMatchObject({ kind: "button", default: 0, caption: "Roll again", label: "Roll again" });
  });
  test("bad longhand arguments are errors", () => {
    expect(py("n = Slider(1, 50, default=99)", ["n"]).issues[0]).toMatchObject({ severity: "error", message: expect.stringContaining("outside") });
    expect(py('m = Choice("a", "b", default="z")', ["m"]).issues[0]).toMatchObject({ severity: "error", message: expect.stringContaining("not one of") });
    expect(py("n = Slider(5)", ["n"]).issues[0]).toMatchObject({ severity: "error" });
    expect(py("n = Slider(1, 50, label=Cycles)", ["n"]).issues[0]).toMatchObject({ severity: "error", message: expect.stringContaining("label") });
  });
  test("longhand inside a def default", () => {
    const code = "def sim(beta=Slider(0.1, 1.0, step=0.05), days=(30, 200)):\n    pass";
    const { controls, issues } = py(code, ["beta", "days"]);
    expect(issues).toEqual([]);
    expect(controls[0]).toMatchObject({ kind: "slider", step: 0.05, birthplace: "param" });
    expect(code.split("\n")[0].slice(controls[0].start, controls[0].end)).toBe("Slider(0.1, 1.0, step=0.05)");
    expect(controls[1]).toMatchObject({ kind: "slider", min: 30, max: 200, integer: true });
  });
});

describe("parseControls — R", () => {
  const r = (code: string, names: string[]) => parseControls("r", code, names);
  test("c(a, b) is a range, c(\"a\", \"b\") a choice, TRUE a toggle; <- and = both assign", () => {
    expect(r("n <- c(1, 50)", ["n"]).controls[0]).toMatchObject({ kind: "slider", min: 1, max: 50, integer: true, default: 25 });
    expect(r("n = c(0.1, 1.0, 0.05)", ["n"]).controls[0]).toMatchObject({ kind: "slider", step: 0.05, integer: false });
    expect(r('m <- c("SIR", "SEIR")', ["m"]).controls[0]).toMatchObject({ kind: "choice", options: ["SIR", "SEIR"] });
    expect(r("lg <- TRUE", ["lg"]).controls[0]).toMatchObject({ kind: "toggle", default: true });
    expect(r('nm <- "Ann"', ["nm"]).controls[0]).toMatchObject({ kind: "text", default: "Ann" });
    expect(r("k <- 3", ["k"]).controls[0]).toMatchObject({ kind: "number", integer: true });
  });
  test("a function default is a birthplace; the function's own name is not", () => {
    const code = "sim <- function(n = c(1, 50), beta = 0.3) {\n  n * beta\n}\nsim()";
    const { controls, issues } = r(code, ["n", "beta"]);
    expect(issues).toEqual([]);
    expect(controls[0]).toMatchObject({ name: "n", kind: "slider", birthplace: "param" });
    expect(code.split("\n")[0].slice(controls[0].start, controls[0].end)).toBe("c(1, 50)");
    expect(controls[1]).toMatchObject({ name: "beta", kind: "number", integer: false });
  });
  test("longhand in R uses the same names", () => {
    expect(r('n <- Slider(1, 50, default = 10, label = "Cycles")', ["n"]).controls[0]).toMatchObject({ default: 10, label: "Cycles" });
    expect(r('b <- Button("Resample")', ["b"]).controls[0]).toMatchObject({ kind: "button", caption: "Resample" });
    expect(r("t <- Toggle(FALSE)", ["t"]).controls[0]).toMatchObject({ kind: "toggle", default: false });
  });
});
```

- [ ] **Step 2: Run the tests**

Run: `npx vitest run tests/code-controls.test.ts`
Expected: some longhand/R cases FAIL (typically the span of a longhand inside a def when the literal contains `=`; and R's `default = 10` with spaces around `=` — the kw regex `^([A-Za-z_]\w*)\s*=\s*(.+)$` already allows spaces).

- [ ] **Step 3: Fix what fails**

The def-default span: `arg.indexOf(m[2], m[1].length)` finds the literal after the parameter name — correct even when the literal contains `=` because the search starts after the name. If the R function regex misses `function(n = c(1, 50), beta = 0.3) {` because of the trailing `{`, the `defRe` for R already allows `\{?`. Fix any remaining failure in place; do not widen the grammar beyond the spec's table.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/code-controls.test.ts`
Expected: PASS (except the Task 3 describes, not yet written).

- [ ] **Step 5: Commit**

```bash
git add src/code/controls.ts tests/code-controls.test.ts
git commit -m "Code controls: longhand Slider/Choice/Toggle/Text/Number/Button and the R grammar (Task 2)"
```

---

### Task 3: The rewrite — `formatValue`, `applyControls`, `withControlDefaults`

**Files:**
- Modify: `src/code/controls.ts`
- Test: `tests/code-controls.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export function formatValue(language: string, control: ControlSpec, value: ControlValue): string;
  /** Rewrite each control's literal span with its value (missing values → the control's default). Line count preserved. */
  export function applyControls(language: string, code: string, controls: ControlSpec[], values: Record<string, ControlValue>): string;
  /** parse + apply defaults; idempotent; returns `code` unchanged when names is empty/undefined or the language has no grammar. */
  export function withControlDefaults(language: string, code: string, names: string[] | undefined): string;
  ```

- [ ] **Step 1: Add the failing tests**

```ts
describe("applyControls / withControlDefaults", () => {
  test("rewrites the literal span with the value, in the language's own syntax, keeping the line count", () => {
    const code = "n = (1, 50)\nlog = False\nname = \"x\"\nm = [\"SIR\", \"SEIR\"]\nr = Button(\"Roll\")";
    const { controls } = py(code, ["n", "log", "name", "m", "r"]);
    const out = applyControls("python", code, controls, { n: 12, log: true, name: 'A"b', m: "SEIR", r: 3 });
    expect(out.split("\n")).toEqual(["n = 12", "log = True", 'name = "A\\"b"', 'm = "SEIR"', "r = 3"]);
  });
  test("a float slider value is written with the step's decimals", () => {
    const code = "beta = (0.1, 1.0, 0.05)";
    const { controls } = py(code, ["beta"]);
    expect(applyControls("python", code, controls, { beta: 0.35 })).toBe("beta = 0.35");
    expect(applyControls("python", code, controls, { beta: 0.3 })).toBe("beta = 0.30");
  });
  test("R writes TRUE/FALSE", () => {
    const code = "lg <- FALSE\nn <- c(1, 50)";
    const { controls } = parseControls("r", code, ["lg", "n"]);
    expect(applyControls("r", code, controls, { lg: true, n: 7 })).toBe("lg <- TRUE\nn <- 7");
  });
  test("two controls on one def line rewrite right-to-left so spans stay valid", () => {
    const code = "def sim(n=(1, 50), beta=Slider(0.1, 1.0, step=0.05)):\n    pass\nsim()";
    const { controls } = py(code, ["n", "beta"]);
    expect(applyControls("python", code, controls, { n: 3, beta: 0.2 }).split("\n")[0]).toBe("def sim(n=3, beta=0.20):");
  });
  test("a missing value falls back to the default", () => {
    const code = "n = (1, 50)";
    const { controls } = py(code, ["n"]);
    expect(applyControls("python", code, controls, {})).toBe("n = 25");
  });
  test("withControlDefaults applies defaults and is idempotent; no names → unchanged", () => {
    const code = "n = Slider(20, 2000, default=200)\nseed = Button(\"Draw again\")\nx = n + seed";
    const once = withControlDefaults("python", code, ["n", "seed"]);
    expect(once).toBe("n = 200\nseed = 0\nx = n + seed");
    expect(withControlDefaults("python", once, ["n", "seed"])).toBe(once);
    expect(withControlDefaults("python", code, undefined)).toBe(code);
    expect(withControlDefaults("python", code, [])).toBe(code);
    expect(withControlDefaults("basic", "10 N = 5", ["N"])).toBe("10 N = 5");
  });
  test("a name with an issue is left as written (the lint reports it)", () => {
    expect(withControlDefaults("python", "print(1)", ["n"])).toBe("print(1)");
  });
});
```

- [ ] **Step 2: Run the tests**

Run: `npx vitest run tests/code-controls.test.ts -t "applyControls"`
Expected: FAIL with `Task 3`.

- [ ] **Step 3: Replace the stubs**

```ts
export function formatValue(language: string, control: ControlSpec, value: ControlValue): string {
  const grammar = grammarFor(language) ?? "python";
  switch (control.kind) {
    case "toggle":
      return grammar === "python" ? (value ? "True" : "False") : value ? "TRUE" : "FALSE";
    case "text":
    case "choice":
      return `"${String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
    case "button":
      return String(Math.max(0, Math.round(Number(value))));
    case "slider":
    case "number": {
      const n = Number(value);
      if (!Number.isFinite(n)) return String(control.default);
      if (control.integer) return String(Math.round(n));
      return n.toFixed(control.decimals ?? 2);
    }
    default:
      return String(value);
  }
}

export function applyControls(language: string, code: string, controls: ControlSpec[], values: Record<string, ControlValue>): string {
  const lines = code.split("\n");
  // Right-to-left within a line, so an earlier rewrite never moves a later span.
  const ordered = [...controls].sort((a, b) => a.line - b.line || b.start - a.start);
  for (const c of ordered) {
    const line = lines[c.line];
    if (line === undefined) continue;
    const v = Object.prototype.hasOwnProperty.call(values, c.name) ? values[c.name] : c.default;
    lines[c.line] = line.slice(0, c.start) + formatValue(language, c, v) + line.slice(c.end);
  }
  return lines.join("\n");
}

export function withControlDefaults(language: string, code: string, names: string[] | undefined): string {
  if (!names || names.length === 0 || grammarFor(language) === null) return code;
  const { controls } = parseControls(language, code, names);
  if (controls.length === 0) return code;
  return applyControls(language, code, controls, {});
}
```

- [ ] **Step 4: Run the whole file**

Run: `npx vitest run tests/code-controls.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/code/controls.ts tests/code-controls.test.ts
git commit -m "Code controls: the in-place rewrite — values in the language's syntax, spans right-to-left, defaults idempotent (Task 3)"
```

---

### Task 4: Spec surface — types, schema, validation, the code prompt, the prompt-size pins

**Files:**
- Modify: `src/spec/types.ts` (code element fields, after `code_result` at ~line 245)
- Modify: `src/spec/schema.ts` (element properties after `code_result` at ~line 375; `case "code"` at ~line 1479)
- Modify: `src/llm/prompts/compiler-v1-code.md` (append one bullet)
- Modify: `tests/prompt-size.test.ts` (re-pin both constants with a dated note)
- Test: `tests/code-element.test.ts` (schema describe)

**Interfaces:**
- Produces on `SpecElement`: `controls?: string[]; glow?: boolean; autorun?: boolean;`

- [ ] **Step 1: Add the failing schema tests** (in `tests/code-element.test.ts`, inside `describe("code element — schema")`)

```ts
  test("controls, glow and autorun are accepted on a code element; junk shapes are not", () => {
    expect(validateSpec(spec({ language: "python", code: "n = (1, 5)", controls: ["n"] })).ok).toBe(true);
    expect(validateSpec(spec({ language: "python", code: "n = (1, 5)", controls: ["n"], glow: true, autorun: false })).ok).toBe(true);
    expect(validateSpec(spec({ language: "python", code: "n = (1, 5)", controls: "n" })).ok).toBe(false);
    expect(validateSpec(spec({ language: "python", code: "n = (1, 5)", controls: [1] })).ok).toBe(false);
    expect(validateSpec(spec({ language: "python", code: "n = (1, 5)", controls: ["not an identifier"] })).ok).toBe(false);
  });
```

- [ ] **Step 2: Run it**

Run: `npx vitest run tests/code-element.test.ts -t "controls, glow"`
Expected: FAIL (additionalProperties rejects `controls`).

- [ ] **Step 3: Types**

In `src/spec/types.ts`, after the `code_result` field:

```ts
  /** code: names of script variables the viewer may change from the ⊕ tray
   *  (design 2026-09-14-code-controls). Each is born ONCE in the script as a
   *  control literal — `(min, max[, step])`, `["a", "b"]`, `True`/`False`, a
   *  string, a number — or as `Slider(...)`/`Choice(...)`/`Toggle(...)`/
   *  `Text(...)`/`Number(...)`/`Button(...)`. The literal's default (midpoint of
   *  a range) is what the baked run and the movie show. */
  controls?: string[];
  /** code: while a control is being adjusted, glow the panel and the figure it feeds (default false). */
  glow?: boolean;
  /** code: re-run on every control change (default true); false shows a Run button instead. */
  autorun?: boolean;
```

- [ ] **Step 4: Schema**

In `src/spec/schema.ts`, after the `code_result` property:

```ts
    controls: {
      type: "array",
      items: { type: "string", pattern: "^[A-Za-z_][A-Za-z0-9_.]*$" },
      description:
        "code: names of variables the viewer may change from the ⊕ tray. Each is born ONCE in the script as a control literal — a range tuple (min, max) or (min, max, step) becomes a slider (integers when written without decimal points), a list of strings a choice row, True/False a switch, a string a text field, a bare number a number field (never a guessed range) — or as Slider(1, 50, default=10, label=\"Cycles\") / Choice(\"a\", \"b\") / Toggle(False) / Text(\"x\") / Number(3) / Button(\"Roll again\") when a label or default is wanted. The default (midpoint of a range) is what the movie shows. Prefer controls to an explore beat that tells the viewer to edit the script.",
    },
    glow: {
      type: "boolean",
      description: "code: while a control is being adjusted, glow the panel and the figure its data feeds (default false).",
    },
    autorun: {
      type: "boolean",
      description: "code: re-run the script on every control change (default true); false shows a Run button in the tray instead.",
    },
```

In `case "code":` of the validator, after the `lines` check:

```ts
      if (el.controls !== undefined) {
        need(Array.isArray(el.controls) && el.controls.every((n) => typeof n === "string" && /^[A-Za-z_][A-Za-z0-9_.]*$/.test(n)), "controls must be a list of variable names");
      }
```

- [ ] **Step 5: The prompt bullet**

Append to `src/llm/prompts/compiler-v1-code.md` (one bullet, one line, same style as the two bullets there):

```
- **Controls — a script the viewer can turn.** `"controls": ["n", "beta"]` on a code element makes those variables tray controls; each is born ONCE in the script as a control literal: `n = (20, 2000)` (a range → slider; integers when written without decimal points, `(0.1, 1.0, 0.05)` for a float step), `model = ["SIR", "SEIR"]` (choice row), `log = False` (switch), `name = "x"` (text field), `seed = 3` (number field — a bare number is NEVER a guessed range), or longhand `n = Slider(20, 2000, default=200, label="Draws")`, `Choice("a", "b")`, `Toggle(False)`, `Text("x")`, `Number(3)`, `Button("Draw again")` (a counter the script may use as a seed). A default argument `def sim(beta=(0.1, 1.0)):` is a birthplace too. The literal's default (midpoint of a range) is what the movie shows; moving a control rewrites that line and re-runs the script, and any `{sim.y}` token follows. Prefer controls over an `explore` beat that tells the viewer to edit the script; an `explore` naming the script opens its controls. Same in R: `n <- c(20, 2000)`, `c("SIR", "SEIR")`, `TRUE`, `function(n = c(1, 50))`.
```

- [ ] **Step 6: Re-pin the prompt sizes**

Run: `npx vitest run tests/prompt-size.test.ts`
Expected: the schema test and the non-code system-prompt test FAIL by the number of characters the three descriptions add.

Measure the new sizes: each failing assertion prints `expected <measured> to be less than or equal to <pin>`; the measured number is the new pin. Set `BASELINE_SYSTEM_CHARS` and `BASELINE_SCHEMA_CHARS` to the measured values and add above them:

```ts
// Re-pinned 2026-09-14 for the code-controls round (Task 4): three new
// code-element properties — `controls` (one description, the literal grammar
// in one sentence), `glow`, `autorun` — grew the schema by the measured
// delta, which lands on the system prompt too (the schema is embedded
// verbatim). The controls bullet itself lives in compiler-v1-code.md, which
// only a code request receives, so it costs an ordinary request nothing.
```

- [ ] **Step 7: Run the tests**

Run: `npx vitest run tests/code-element.test.ts tests/prompt-size.test.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/spec/types.ts src/spec/schema.ts src/llm/prompts/compiler-v1-code.md tests/code-element.test.ts tests/prompt-size.test.ts
git commit -m "Code controls: controls/glow/autorun on the code element — types, schema, validation, the code prompt bullet, prompt-size re-pin (Task 4)"
```

---

### Task 5: Lint rule `controls`

**Files:**
- Modify: `src/lint/lint.ts` (`LintIssue.rule` union near line 20–55; `lintCode()` at ~line 555)
- Test: `tests/code-controls-lint.test.ts`

**Interfaces:**
- Consumes: `parseControls`, `grammarFor` from `src/code/controls.ts`; `pathsByCodeId`, `scanDataTokens` from `src/code/tokens.ts` (already imported by lint? check — `lint.ts` imports from `../code/tokens` for data tokens; if not, add the import).
- Produces: issues with `rule: "controls"`.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/code-controls-lint.test.ts
// The `controls` lint (spec 2026-09-14 §2.7): every error the repair round
// must see, every warning, each with a spec that trips it and one that does not.
import { describe, expect, test } from "vitest";
import { lintCommands } from "../src/lint/lint";
import type { Spec } from "../src/spec/types";

const spec = (el: object, commands: object[] = [{ draw: ["sim"] }], params?: object): Spec =>
  ({ elements: [{ id: "sim", type: "code", language: "python", show: "left", ...el }], commands, ...(params ? { template: "bar_chart", params } : {}) }) as unknown as Spec;
const rules = (s: Spec) => lintCommands(s).filter((i) => i.rule === "controls");

describe("controls lint — errors", () => {
  test("a clean script has no issues", () => {
    expect(rules(spec({ controls: ["n"], code: "n = (1, 50)\nprint(n)" }))).toEqual([]);
  });
  test("no birthplace", () => {
    const [i] = rules(spec({ controls: ["n"], code: "print(1)" }));
    expect(i).toMatchObject({ severity: "error", ids: ["sim"] });
    expect(i.message).toContain("no birthplace");
  });
  test("born twice", () => {
    expect(rules(spec({ controls: ["n"], code: "n = (1, 5)\nn = (2, 6)" }))[0]).toMatchObject({ severity: "error" });
  });
  test("not a control literal", () => {
    expect(rules(spec({ controls: ["n"], code: "n = {'a': 1}" }))[0]).toMatchObject({ severity: "error" });
  });
  test("bad longhand argument", () => {
    expect(rules(spec({ controls: ["n"], code: "n = Slider(1, 50, default=99)" }))[0]).toMatchObject({ severity: "error" });
  });
  test("controls on a basic script", () => {
    expect(rules(spec({ language: "basic", controls: ["N"], code: "10 N = 5" }))[0]).toMatchObject({ severity: "error" });
  });
  test("controls on a non-code element", () => {
    const s = { elements: [{ id: "t", type: "text", text: "hi", controls: ["x"] }], commands: [{ draw: ["t"] }] } as unknown as Spec;
    expect(rules(s)[0]).toMatchObject({ severity: "error", ids: ["t"] });
  });
});

describe("controls lint — warnings", () => {
  test("an explicit keyword at a call site defeats the control", () => {
    const [i] = rules(spec({ controls: ["n"], code: "def sim(n=(1, 50)):\n    return n\nsim(n=5)" }));
    expect(i).toMatchObject({ severity: "warn" });
    expect(i.message).toContain("sim(n=");
    expect(rules(spec({ controls: ["n"], code: "def sim(n=(1, 50)):\n    return n\nsim()" }))).toEqual([]);
  });
  test("a later plain-literal reassignment", () => {
    expect(rules(spec({ controls: ["x"], code: "x = (1, 50)\nx = 5" }))[0]).toMatchObject({ severity: "warn" });
  });
  test("a step that does not divide the range; two controls with one label", () => {
    expect(rules(spec({ controls: ["x"], code: "x = (0, 10, 3)" }))[0]).toMatchObject({ severity: "warn", message: expect.stringContaining("divide") });
    expect(rules(spec({ controls: ["a", "b"], code: 'a = Slider(1, 5, label="Same")\nb = Slider(1, 5, label="Same")' }))[0]).toMatchObject({ severity: "warn", message: expect.stringContaining("label") });
  });
  test("a hidden pane that feeds nothing", () => {
    expect(rules(spec({ controls: ["n"], show: "none", code: "n = (1, 50)" }))[0]).toMatchObject({ severity: "warn", message: expect.stringContaining("nothing visible") });
    // Fed through a token: fine.
    expect(rules(spec({ controls: ["n"], show: "none", code: "n = (1, 50)\ny = [n]" }, [{ draw: ["sim"] }], { values: "{sim.y}" }))).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it**

Run: `npx vitest run tests/code-controls-lint.test.ts`
Expected: FAIL — no issues with rule `controls`.

- [ ] **Step 3: Add the rule**

In `LintIssue.rule` add:
```ts
    /** code controls: a name with no birthplace, born twice, not a control literal, a bad longhand argument, or a control the viewer could not see change */
    | "controls"
```

Add imports at the top of `lint.ts` (keep existing ones):
```ts
import { grammarFor, parseControls } from "../code/controls";
import { pathsByCodeId, scanDataTokens } from "../code/tokens";
```
(`scanDataTokens`/`pathsByCodeId` may already be imported — do not duplicate.)

In `lintCode(spec)`, before `if (els.length === 0) return issues;`, add:

```ts
  // controls on something that is not a script
  for (const el of spec.elements ?? []) {
    if (el.type !== "code" && el.controls !== undefined) {
      issues.push({ rule: "controls", ids: [el.id], message: `"${el.id}" has controls but is not a code element`, severity: "error" });
    }
  }
```

After the `game` loop, add:

```ts
  // Code controls (design 2026-09-14): names in the spec, shapes in the script.
  const fed = pathsByCodeId(scanDataTokens(spec.params));
  for (const el of els) {
    if (!el.controls || el.controls.length === 0) continue;
    const lang = el.language ?? "";
    if (grammarFor(lang) === null) {
      issues.push({ rule: "controls", ids: [el.id], message: `code "${el.id}": controls are not available for ${lang || "this"} scripts`, severity: "error" });
      continue;
    }
    const { controls, issues: found } = parseControls(lang, el.code ?? "", el.controls);
    for (const f of found) issues.push({ rule: "controls", ids: [el.id], message: `code "${el.id}": ${f.message}`, severity: f.severity });
    // A step that does not land on max.
    for (const c of controls) {
      if (c.kind === "slider" && c.min !== undefined && c.max !== undefined && c.step) {
        const k = (c.max - c.min) / c.step;
        if (Math.abs(k - Math.round(k)) > 1e-9) issues.push({ rule: "controls", ids: [el.id], message: `code "${el.id}": "${c.name}" — step ${c.step} does not divide the range ${c.min}–${c.max}`, severity: "warn" });
      }
    }
    // Two controls, one label.
    const byLabel = new Map<string, string[]>();
    for (const c of controls) byLabel.set(c.label, [...(byLabel.get(c.label) ?? []), c.name]);
    for (const [label, names] of byLabel) {
      if (names.length > 1) issues.push({ rule: "controls", ids: [el.id], message: `code "${el.id}": controls ${names.join(" and ")} share the label "${label}"`, severity: "warn" });
    }
    // A call site that passes a controlled name as an explicit keyword.
    for (const c of controls) {
      if (c.birthplace !== "param") continue;
      const re = new RegExp(`\\b([A-Za-z_][\\w.]*)\\s*\\([^)]*\\b${c.name}\\s*=`, "g");
      const lines = (el.code ?? "").split("\n");
      lines.forEach((line, i) => {
        if (i === c.line) return;
        const m = re.exec(line);
        re.lastIndex = 0;
        if (m) issues.push({ rule: "controls", ids: [el.id], message: `code "${el.id}": ${m[1]}(${c.name}=…) on line ${i + 1} overrides the "${c.name}" control`, severity: "warn" });
      });
    }
    // A hidden pane that feeds nothing: the control would change nothing visible.
    if ((el.show ?? "output") === "none" && (fed[el.id] ?? []).length === 0) {
      issues.push({ rule: "controls", ids: [el.id], message: `code "${el.id}": its pane is hidden and no template param reads {${el.id}.…} — a control would change nothing visible`, severity: "warn" });
    }
  }
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/code-controls-lint.test.ts tests/code-element.test.ts`
Expected: PASS. If the "controls on a non-code element" test fails with a schema complaint instead, note that lint runs on unvalidated specs — the test builds the spec directly, so lint must not depend on validation.

- [ ] **Step 5: Commit**

```bash
git add src/lint/lint.ts tests/code-controls-lint.test.ts
git commit -m "Code controls: the controls lint — no birthplace, born twice, bad literal, call-site override, non-dividing step, shared label, invisible effect (Task 5)"
```

---

### Task 6: Defaults are baked — resolver, authoring-time check, panel layout

**Files:**
- Modify: `src/render/code.ts` (`resolveCode`, the `runCode(...)` call at ~line 70)
- Modify: `src/code/check.ts` (`codeExecutionErrors`, the `run(...)` call at ~line 40)
- Modify: `src/layout/code.ts` (`sourceLines` at ~line 337)
- Test: `tests/code-element.test.ts` (resolver and layout describes)

**Interfaces:**
- Consumes: `withControlDefaults(language, code, names)` from Task 3.

- [ ] **Step 1: Write the failing tests** (append to `tests/code-element.test.ts`)

```ts
describe("code controls — defaults are baked", () => {
  const withControls = (extra: object = {}) =>
    codeSpec({ code: "n = (1, 50)\nprint(n)", controls: ["n"], show: "left", ...extra });

  test("the resolver runs the default-rewritten script and stamps that run", async () => {
    const s = withControls();
    const deps = runDeps(OK);
    await resolveCode(s, deps);
    expect(deps.calls).toEqual(["n = 25\nprint(n)"]);
    expect(s.elements![0].code).toBe("n = 25\nprint(n)"); // the clone's code is the default run's code
  });

  test("a second pass re-uses the stamp (the rewritten code still covers)", async () => {
    const s = withControls();
    const deps = runDeps(OK);
    await resolveCode(s, deps);
    await resolveCode(s, deps);
    expect(deps.calls.length).toBe(1);
  });

  test("the panel draws the rewritten line, never the tuple", () => {
    const s = withControls({ code_result: JSON.stringify(OK) });
    const texts = flattenDrawables(layoutSpec(s, heuristicMeasure).drawables)
      .filter((d): d is TextDrawable => d.kind === "text" && d.id === "c1_line_1")
      .map((d) => d.text);
    expect(texts).toEqual(["n = 25"]);
  });

  test("the authoring-time check runs the defaults too", async () => {
    const seen: string[] = [];
    await codeExecutionErrors(withControls(), async (req) => {
      seen.push(req.code);
      return OK;
    });
    expect(seen).toEqual(["n = 25\nprint(n)"]);
  });
});
```

(`TextDrawable` is already imported in this test file; its text field is `text` — confirm with `grep -n "interface TextDrawable" -A6 src/layout/model.ts` and adjust the property name if it differs.)

- [ ] **Step 2: Run it**

Run: `npx vitest run tests/code-element.test.ts -t "defaults are baked"`
Expected: FAIL — the runner sees the tuple.

- [ ] **Step 3: Resolver**

In `src/render/code.ts`, import `withControlDefaults` from `../code/controls`, and inside the `for (const el of spec.elements ?? [])` loop, immediately after `codeEls.set(el.id, el);`:

```ts
    // Code controls: the document's stamp is the run at the controls'
    // defaults, and the panel draws the same text (design 2026-09-14 §2.5).
    // Applied on the render CLONE, before the stamp check and the run — the
    // authored spec keeps its tuples for the tray to parse.
    if (el.language && el.code) el.code = withControlDefaults(el.language, el.code, el.controls);
```

- [ ] **Step 4: Check**

In `src/code/check.ts`, replace `res = await run({ language: el.language, code: el.code, paths });` with:

```ts
      res = await run({ language: el.language, code: withControlDefaults(el.language, el.code, el.controls), paths });
```
and import `withControlDefaults` from `./controls`.

- [ ] **Step 5: Layout**

In `src/layout/code.ts`, replace the `sourceLines` line with:

```ts
  // The panel shows the run's text: a control literal is drawn as its default value.
  const sourceLines = withControlDefaults(el.language ?? "", el.code ?? "", el.controls).replace(/\s+$/, "").split("\n");
```
and import `withControlDefaults` from `../code/controls` (layout already imports the envelope from `../code/envelope`; `controls.ts` is dependency-free, so no cycle).

- [ ] **Step 6: Run the tests**

Run: `npx vitest run tests/code-element.test.ts tests/code-data-bridge.test.ts tests/code-controls.test.ts && npx tsc --noEmit`
Expected: PASS, tsc clean.

- [ ] **Step 7: Commit**

```bash
git add src/render/code.ts src/code/check.ts src/layout/code.ts tests/code-element.test.ts
git commit -m "Code controls: the resolver, the check and the panel all see the default-rewritten script — the movie shows the defaults (Task 6)"
```

---

### Task 7: Tray model — the controls group, row layout, debounce

**Files:**
- Modify: `src/ui/tray-model.ts` (`TrayPlan`, `trayPlan`)
- Create: `src/ui/controls-model.ts`
- Test: `tests/tray-model.test.ts`, `tests/controls-model.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // tray-model.ts
  export interface TrayPlan { /* existing */ controls: string[]; }   // code ids whose control groups to show, in order
  // trayPlan input gains: controlIds: string[]  (code ids that have controls)
  // controls-model.ts
  export type RowWidth = "full" | "half";
  export function rowWidth(kind: ControlKind): RowWidth;            // slider/text → full; toggle/choice/number/button → half
  export function debounceMs(language: string): number;             // python (pyodide) 400, everything else 250
  export function readout(control: ControlSpec, value: ControlValue): string; // slider/number formatting for the trailing value
  export function nextValues(values: Record<string, ControlValue>, control: ControlSpec, raw: string | boolean): Record<string, ControlValue>;
  ```

- [ ] **Step 1: Failing tests**

`tests/controls-model.test.ts`:
```ts
import { describe, expect, test } from "vitest";
import { debounceMs, nextValues, readout, rowWidth } from "../src/ui/controls-model";
import { parseControls } from "../src/code/controls";

const c = (code: string, name: string) => parseControls("python", code, [name]).controls[0];

describe("controls-model", () => {
  test("row widths: sliders and text take a row, the rest flow two per row", () => {
    expect(rowWidth("slider")).toBe("full");
    expect(rowWidth("text")).toBe("full");
    for (const k of ["toggle", "choice", "number", "button"] as const) expect(rowWidth(k)).toBe("half");
  });
  test("debounce: pyodide is slower to re-run", () => {
    expect(debounceMs("python")).toBe(400);
    expect(debounceMs("brython")).toBe(250);
    expect(debounceMs("r")).toBe(250);
  });
  test("readout follows the step's decimals; integers have none", () => {
    expect(readout(c("n = (1, 50)", "n"), 12)).toBe("12");
    expect(readout(c("b = (0.1, 1.0, 0.05)", "b"), 0.3)).toBe("0.30");
    expect(readout(c("b = (0.0, 49.0)", "b"), 12.24)).toBe("12.2");
  });
  test("nextValues: a slider parses its number, a toggle its boolean, a button counts up", () => {
    const n = c("n = (1, 50)", "n");
    expect(nextValues({}, n, "12")).toEqual({ n: 12 });
    const t = c("t = False", "t");
    expect(nextValues({ n: 12 }, t, true)).toEqual({ n: 12, t: true });
    const b = c('r = Button("Roll")', "r");
    expect(nextValues({}, b, "")).toEqual({ r: 1 });
    expect(nextValues({ r: 1 }, b, "")).toEqual({ r: 2 });
    const k = c("k = 3", "k");
    expect(nextValues({}, k, "abc")).toEqual({ k: 3 }); // unparsable → default
  });
});
```

`tests/tray-model.test.ts` (append):
```ts
describe("trayPlan — controls", () => {
  test("the viewer's ⊕ shows every control group, in element order", () => {
    const p = trayPlan({ sliderPaths: [], codeIds: ["a", "b", "c"], controlIds: ["c", "a"] });
    expect(p.controls).toEqual(["a", "c"]);
  });
  test("a gated explore beat naming a script shows that script's controls only", () => {
    const p = trayPlan({ sliderPaths: ["n"], codeIds: ["a", "b"], controlIds: ["a", "b"], gated: true, code: "b" });
    expect(p.controls).toEqual(["b"]);
    expect(p.scripts).toEqual([{ id: "b", expanded: true }]);
  });
  test("a gated beat naming only params shows no controls", () => {
    expect(trayPlan({ sliderPaths: ["n"], codeIds: ["a"], controlIds: ["a"], gated: true, params: ["n"] }).controls).toEqual([]);
  });
  test("controlIds is optional (older callers)", () => {
    expect(trayPlan({ sliderPaths: [], codeIds: ["a"] }).controls).toEqual([]);
  });
});
```

- [ ] **Step 2: Run them**

Run: `npx vitest run tests/controls-model.test.ts tests/tray-model.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

`src/ui/controls-model.ts`:
```ts
// The tray's controls group, DOM-free (design 2026-09-14 §2.6): row widths,
// the re-run debounce per runtime, the trailing readout and the value step
// from a DOM event to the next values map. tray.ts renders it.
import type { ControlKind, ControlSpec, ControlValue } from "../code/controls";

export type RowWidth = "full" | "half";

export function rowWidth(kind: ControlKind): RowWidth {
  return kind === "slider" || kind === "text" ? "full" : "half";
}

/** Pyodide re-runs slower (a WASM CPython plus matplotlib per run), so it waits a little longer for the slider to settle. */
export function debounceMs(language: string): number {
  return language === "python" ? 400 : 250;
}

export function readout(control: ControlSpec, value: ControlValue): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value);
  return control.integer ? String(Math.round(n)) : n.toFixed(control.decimals ?? 2);
}

export function nextValues(values: Record<string, ControlValue>, control: ControlSpec, raw: string | boolean): Record<string, ControlValue> {
  const out = { ...values };
  switch (control.kind) {
    case "button":
      out[control.name] = Number(values[control.name] ?? 0) + 1;
      break;
    case "toggle":
      out[control.name] = raw === true || raw === "true";
      break;
    case "slider":
    case "number": {
      const n = Number(raw);
      out[control.name] = Number.isFinite(n) && raw !== "" ? n : control.default;
      break;
    }
    default:
      out[control.name] = String(raw);
  }
  return out;
}
```

`src/ui/tray-model.ts`: add `controls: string[]` to `TrayPlan` (doc: `/** Code ids whose control groups to show, in written order. */`), add `controlIds?: string[]` to the input (doc: `/** Code ids that declare controls. */`), default `controlIds = []` in the destructuring, and:
- gated branch: `const controls = scripts.map((s) => s.id).filter((id) => controlIds.includes(id));` and return `{ ..., controls }`.
- open branch: `controls: codeIds.filter((id) => controlIds.includes(id))`.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/controls-model.test.ts tests/tray-model.test.ts && npx tsc --noEmit`
Expected: PASS; tsc will flag the `trayPlan` call in `tray.ts` only if `controls` is read somewhere — it is not yet, so clean.

- [ ] **Step 5: Commit**

```bash
git add src/ui/controls-model.ts src/ui/tray-model.ts tests/controls-model.test.ts tests/tray-model.test.ts
git commit -m "Code controls: the tray model — control groups in the plan, row widths, debounce, readout and value stepping (Task 7)"
```

---

### Task 8: Tray rows, autorun through `runEdited`, glow, explore expansion

**Files:**
- Modify: `src/ui/tray.ts` (state near line 181; `clearPreview`; `runEdited` at ~251; the plan call at ~490; the scripts section at ~826)
- Modify: `src/render/player.ts` (add `holdGlow`)
- Modify: `src/styles.css` (rows)
- Test: `tests/tray-controls.test.ts` (source-level pins, the `tray-reveal.test.ts` idiom)

**Interfaces:**
- Consumes: `parseControls`, `applyControls` (Task 3); `rowWidth`, `debounceMs`, `readout`, `nextValues` (Task 7); `TrayPlan.controls` (Task 7).
- Produces: `Player.holdGlow(ids: string[]): () => void`.

- [ ] **Step 1: Failing source pins**

```ts
// tests/tray-controls.test.ts
// Source-level pins for the tray's controls group (no DOM in this repo):
// the rows must rewrite the AUTHORED script (tuples intact) and run through
// runEdited, values must die with the preview, and the group must be built
// from the tray plan's `controls`.
import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";

const src = readFileSync("src/ui/tray.ts", "utf8");
const player = readFileSync("src/render/player.ts", "utf8");

describe("tray controls (pins)", () => {
  test("controls parse the authored element, not the resolved clone", () => {
    expect(src).toMatch(/parseControls\(\s*[^)]*authoredEl\.code/);
  });
  test("a control change runs the rewritten script through runEdited", () => {
    expect(src).toMatch(/runEdited\([^,]+,\s*applyControls\(/);
  });
  test("control values are cleared with the preview", () => {
    expect(src).toMatch(/const clearPreview[\s\S]*?controlValues\.clear\(\)/);
  });
  test("the group is built from plan.controls", () => {
    expect(src).toContain("plan.controls");
    expect(src).toContain("controlIds:");
  });
  test("the player can hold a glow for the tray", () => {
    expect(player).toMatch(/holdGlow\(ids: string\[\]\): \(\) => void/);
  });
});
```

- [ ] **Step 2: Run it**

Run: `npx vitest run tests/tray-controls.test.ts`
Expected: FAIL.

- [ ] **Step 3: `Player.holdGlow`**

In `src/render/player.ts`, next to `glowWhile`:

```ts
  /** Hold the answer glow on `ids` until the returned function is called —
   *  the tray's `glow: true` controls (design 2026-09-14 §2.6). No effects:
   *  a no-op release. */
  holdGlow(ids: string[]): () => void {
    const effects = this.effects;
    if (!effects || ids.length === 0) return () => {};
    effects.setHighlight(ids, "glow", 0.5, null);
    return () => effects.endHighlight(ids);
  }
```

- [ ] **Step 4: Tray state and helpers**

In `src/ui/tray.ts` add imports:
```ts
import { applyControls, parseControls, type ControlSpec, type ControlValue } from "../code/controls";
import { debounceMs, nextValues, readout, rowWidth } from "./controls-model";
```

Near `const patches = new Map(...)` add:
```ts
  /** Control values per script — preview state, dropped with the rest. */
  const controlValues = new Map<string, Record<string, ControlValue>>();
  /** Scripts the viewer took over by editing and running: their controls go quiet until Continue. */
  const takenOver = new Set<string>();
  const runTimers = new Map<string, ReturnType<typeof setTimeout>>();
```
In `clearPreview` add `controlValues.clear(); takenOver.clear(); for (const t of runTimers.values()) clearTimeout(t); runTimers.clear();`.

Change `runEdited`'s signature to `(el: SpecElement, code: string, source: "editor" | "controls" = "editor")` and add, right after its `if (!el.language) return;` guard:

```ts
    // A Run from the editor with text the controls did not produce: the
    // viewer took the script over, and its controls go quiet until Continue.
    if (source === "editor" && code !== (lastControlsCode.get(el.id) ?? el.code)) takenOver.add(el.id);
```
with `const lastControlsCode = new Map<string, string>();` declared beside `controlValues`. The existing callers (`onRun`, the Run button) keep the default `"editor"`.

Add the controls run, after `runEdited`:

```ts
  /** A control moved: rewrite the AUTHORED script (its tuples intact) with
   *  the current values and run it through the same door an edited script
   *  uses. `immediate` = no debounce (a click, not a drag). `autorun: false`
   *  runs only from the group's own Run button, which passes `force`. */
  const runControls = (el: SpecElement, controls: ControlSpec[], immediate: boolean, force = false): void => {
    const authoredEl = (hd.authored.elements ?? []).find((e) => e.id === el.id);
    if (!authoredEl?.code || !el.language) return;
    const language = el.language;
    const authoredCode = authoredEl.code;
    const pending = runTimers.get(el.id);
    if (pending) clearTimeout(pending);
    if (el.autorun === false && !force) return;
    const go = (): void => {
      const values = controlValues.get(el.id) ?? {};
      lastControlsCode.set(el.id, applyControls(language, authoredCode, controls, values));
      void runEdited(el, applyControls(language, authoredCode, controls, values), "controls");
    };
    if (immediate || force) go();
    else runTimers.set(el.id, setTimeout(go, debounceMs(language)));
  };
```

- [ ] **Step 5: The plan call and the group**

At the `trayPlan({...})` call add `controlIds: editable.filter((e) => Array.isArray(e.controls) && e.controls.length > 0).map((e) => e.id),`.

Before the scripts loop (`for (const { id, expanded } of plan.scripts)`), render the groups:

```ts
    // Code controls (design 2026-09-14 §2.6): one group per script, above the
    // template sliders' cousins — a slider/text per row, the small controls
    // two per row. Values rewrite the AUTHORED script and run through the
    // same door an edited script uses.
    for (const id of plan.controls) {
      const el = editable.find((e) => e.id === id);
      const authoredEl = (hd.authored.elements ?? []).find((e) => e.id === id);
      if (!el || !authoredEl?.code || !el.language || !el.controls) continue;
      const { controls } = parseControls(el.language, authoredEl.code, el.controls);
      if (controls.length === 0) continue;
      const values = controlValues.get(id) ?? {};
      const group = h("div", { class: "cs-tray-controls", role: "group", "aria-label": `Controls for ${id}` });
      if (takenOver.has(id)) group.classList.add("cs-tray-controls-quiet");
      const glowIds = el.glow ? [id, ...hd.layout.order.filter((o) => !editable.some((e) => o === e.id || o.startsWith(`${e.id}_`)))] : [];
      let release: (() => void) | null = null;
      const glowOn = (): void => {
        if (glowIds.length === 0 || release) return;
        release = hd.timeline.holdGlow(glowIds);
      };
      const glowOff = (): void => {
        release?.();
        release = null;
      };
      const commit = (c: ControlSpec, raw: string | boolean, immediate: boolean): void => {
        controlValues.set(id, nextValues(controlValues.get(id) ?? {}, c, raw));
        runControls(el, controls, immediate);
      };
      for (const c of controls) {
        const row = h("div", { class: `cs-tray-row cs-tray-ctl cs-tray-ctl-${rowWidth(c.kind)}` });
        const label = h("span", { class: "cs-tray-label" }, c.label);
        const current = values[c.name] ?? c.default;
        switch (c.kind) {
          case "slider": {
            const range = h("input", { type: "range", min: String(c.min), max: String(c.max), step: String(c.step), value: String(current), "aria-label": c.label }) as HTMLInputElement;
            const out = h("span", { class: "cs-tray-value" }, readout(c, current));
            range.addEventListener("input", () => {
              out.textContent = readout(c, Number(range.value));
              commit(c, range.value, false);
            });
            range.addEventListener("focus", glowOn);
            range.addEventListener("pointerdown", glowOn);
            range.addEventListener("blur", glowOff);
            range.addEventListener("pointerup", glowOff);
            row.append(label, range, out);
            break;
          }
          case "choice": {
            const seg = h("div", { class: "cs-tray-choice", role: "group", "aria-label": c.label });
            const btns: HTMLButtonElement[] = [];
            for (const v of c.options ?? []) {
              const b = h("button", { class: "cs-tray-choicebtn", "data-value": v }, v);
              b.addEventListener("click", () => {
                for (const x of btns) x.classList.toggle("on", x === b);
                commit(c, v, true);
              });
              b.classList.toggle("on", v === current);
              btns.push(b);
              seg.appendChild(b);
            }
            row.append(label, seg);
            break;
          }
          case "toggle": {
            const box = h("input", { type: "checkbox", "aria-label": c.label }) as HTMLInputElement;
            box.checked = current === true;
            box.addEventListener("change", () => commit(c, box.checked, true));
            row.append(label, box);
            break;
          }
          case "text":
          case "number": {
            const input = h("input", { type: c.kind === "number" ? "number" : "text", value: String(current), "aria-label": c.label, ...(c.kind === "number" && c.integer ? { step: "1" } : {}) }) as HTMLInputElement;
            input.addEventListener("change", () => commit(c, input.value, true)); // Enter or blur
            row.append(label, input);
            break;
          }
          case "button": {
            const pill = h("button", { class: "cs-tray-pill cs-tray-ctlbtn" }, c.caption ?? c.label);
            pill.addEventListener("click", () => commit(c, "", true));
            row.append(pill);
            break;
          }
        }
        group.appendChild(row);
      }
      if (el.autorun === false) {
        const run = h("button", { class: "cs-tray-run" }, "Run ▶");
        run.addEventListener("click", () => runControls(el, controls, true, true));
        group.appendChild(h("div", { class: "cs-tray-actions" }, run));
      }
      tray.appendChild(group);
    }
```

In the group code above, the `autorun === false` Run button must call `runControls(el, controls, true, true)` (force), and `commit` stays `runControls(el, controls, immediate)` — with `autorun: false` every commit returns early and the values wait for that button.

Explore expansion: in `open()`'s gated path nothing else is needed — `trayPlan` already returns `controls` filtered to the named script (Task 7).

- [ ] **Step 6: CSS**

In `src/styles.css`, after `.cs-tray-row input[type="range"] …`:

```css
/* Code controls (design 2026-09-14 §2.6): a slider or text field takes a
   row; the small controls flow two per row. Quiet = the viewer edited and
   ran the script; Continue restores the controls. */
.cs-tray-controls { display: flex; flex-wrap: wrap; gap: 0.35rem 0.8rem; }
.cs-tray-ctl-full { flex: 1 1 100%; }
.cs-tray-ctl-half { flex: 1 1 calc(50% - 0.4rem); }
.cs-tray-ctl input[type="text"], .cs-tray-ctl input[type="number"] { flex: 1; min-width: 0; font: inherit; }
.cs-tray-controls-quiet { opacity: 0.45; pointer-events: none; }
@media (max-width: 600px) { .cs-tray-ctl-half { flex-basis: 100%; } }
```

- [ ] **Step 7: Run tests and tsc**

Run: `npx vitest run tests/tray-controls.test.ts tests/tray-model.test.ts tests/tray-reveal.test.ts && npx tsc --noEmit`
Expected: PASS, tsc clean.

- [ ] **Step 8: Commit**

```bash
git add src/ui/tray.ts src/render/player.ts src/styles.css tests/tray-controls.test.ts
git commit -m "Code controls: the tray group — rows per control, autorun through runEdited on the authored script, values die with the preview, glow: true holds the answer glow (Task 8)"
```

---

### Task 9: One click from playback into a script's controls

**Files:**
- Modify: `src/ui/tray.ts` (the stage `click` capture handler at ~line 950: `if (hd.timeline.state === "playing" || !tray.hidden) return;`)
- Test: `tests/tray-controls.test.ts` (one more pin)

**Interfaces:** none new.

- [ ] **Step 1: Failing pin**

```ts
  test("a click during playback on a control-bearing panel pauses first, then opens that script (spec §2.6)", () => {
    const i = src.indexOf("hd.timeline.state === \"playing\"", src.indexOf("const screenAt"));
    const region = src.slice(i, i + 1200);
    expect(region).toContain("hd.timeline.pause()");
    expect(region).toMatch(/open\(\{ onCode: /);
    expect(region.indexOf("hd.timeline.pause()")).toBeLessThan(region.indexOf("open({ onCode:"));
  });
```

- [ ] **Step 2: Run it** — `npx vitest run tests/tray-controls.test.ts` — Expected: FAIL.

- [ ] **Step 3: The handler**

Replace the first guard of the panel click handler with:

```ts
        if (!tray.hidden) return; // the tray's own freeze guard owns the stage
        if (hd.timeline.state === "playing") {
          // One click from the movie into a script's controls (design
          // 2026-09-14 §2.6): hit-test on the scene as it is NOW — a click
          // that lands anywhere else stays the sacred pause and returns —
          // then pause at the boundary, then open on what is paused.
          const id = screenAt(e);
          const el = id === null ? undefined : editable.find((x) => x.id === id);
          if (!el || !Array.isArray(el.controls) || el.controls.length === 0) return;
          e.stopPropagation(); // the bar's own click→pause toggle must not resume us
          hd.timeline.pause();
          open({ onCode: id! });
          return;
        }
```

`screenAt` reads `hd.timeline.position` — during playback that is the step in progress, which is the scene the viewer is looking at; `open()` then snaps to the boundary via `renderUpTo(position)`.

- [ ] **Step 4: Run** — `npx vitest run tests/tray-controls.test.ts && npx tsc --noEmit` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ui/tray.ts tests/tray-controls.test.ts
git commit -m "Code controls: one click from playback on a control-bearing panel pauses, then opens its controls (Task 9)"
```

---

### Task 10: The tray looks like the figure, and pops out

**Files:**
- Create: `src/ui/tray-popout.ts`
- Modify: `src/ui/tray.ts` (the tray element at ~line 151; the ⊕ button row)
- Modify: `src/styles.css` (`.cs-paramtray` at ~line 1836)
- Test: `tests/tray-popout.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface PopoutBox { x: number; y: number; w: number; h: number }
  export const POPOUT_MIN = { w: 260, h: 120 } as const;
  export function clampBox(box: PopoutBox, host: { w: number; h: number }): PopoutBox;   // keeps ≥ POPOUT_MIN and inside host
  export function readBox(storage: Pick<Storage, "getItem"> | null, key: string): PopoutBox | null;
  export function writeBox(storage: Pick<Storage, "setItem"> | null, key: string, box: PopoutBox): void;
  export function attachPopout(tray: HTMLElement, host: HTMLElement, opts: { storageKey: string }): { popOut(): void; dock(): void; popped(): boolean; detach(): void };
  ```

- [ ] **Step 1: Failing tests (pure part)**

```ts
// tests/tray-popout.test.ts
import { describe, expect, test } from "vitest";
import { clampBox, POPOUT_MIN, readBox, writeBox } from "../src/ui/tray-popout";

describe("tray pop-out geometry", () => {
  test("clamps inside the host and never below the minimum size", () => {
    expect(clampBox({ x: -20, y: -5, w: 300, h: 200 }, { w: 800, h: 600 })).toEqual({ x: 0, y: 0, w: 300, h: 200 });
    expect(clampBox({ x: 700, y: 550, w: 300, h: 200 }, { w: 800, h: 600 })).toEqual({ x: 500, y: 400, w: 300, h: 200 });
    expect(clampBox({ x: 0, y: 0, w: 10, h: 10 }, { w: 800, h: 600 })).toEqual({ x: 0, y: 0, w: POPOUT_MIN.w, h: POPOUT_MIN.h });
    expect(clampBox({ x: 0, y: 0, w: 2000, h: 2000 }, { w: 800, h: 600 })).toEqual({ x: 0, y: 0, w: 800, h: 600 });
  });
  test("storage round-trips and survives garbage or a throwing storage", () => {
    const store = new Map<string, string>();
    const s = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
    writeBox(s, "k", { x: 1, y: 2, w: 300, h: 150 });
    expect(readBox(s, "k")).toEqual({ x: 1, y: 2, w: 300, h: 150 });
    store.set("k", "{nope");
    expect(readBox(s, "k")).toBeNull();
    expect(readBox({ getItem: () => { throw new Error("private mode"); } }, "k")).toBeNull();
    expect(() => writeBox({ setItem: () => { throw new Error("quota"); } }, "k", { x: 0, y: 0, w: 300, h: 150 })).not.toThrow();
    expect(readBox(null, "k")).toBeNull();
  });
});
```

- [ ] **Step 2: Run** — `npx vitest run tests/tray-popout.test.ts` — Expected: FAIL (module missing).

- [ ] **Step 3: The module**

```ts
// src/ui/tray-popout.ts
// The tray pops out into a floating palette over the stage (design
// 2026-09-14 §2.6b): same content, a drag handle, browser-native resizing
// (CSS `resize: both`), position and size remembered per session. Docked is
// the default and never covers the figure; the pop-out is for the viewer who
// wants the controls beside what they change. Geometry and storage are pure
// (tested); the DOM part is thin.

export interface PopoutBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const POPOUT_MIN = { w: 260, h: 120 } as const;

export function clampBox(box: PopoutBox, host: { w: number; h: number }): PopoutBox {
  const w = Math.min(host.w, Math.max(POPOUT_MIN.w, box.w));
  const h = Math.min(host.h, Math.max(POPOUT_MIN.h, box.h));
  const x = Math.min(Math.max(0, box.x), Math.max(0, host.w - w));
  const y = Math.min(Math.max(0, box.y), Math.max(0, host.h - h));
  return { x, y, w, h };
}

export function readBox(storage: Pick<Storage, "getItem"> | null, key: string): PopoutBox | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<PopoutBox>;
    if ([v.x, v.y, v.w, v.h].every((n) => typeof n === "number" && Number.isFinite(n))) return { x: v.x!, y: v.y!, w: v.w!, h: v.h! };
    return null;
  } catch {
    return null;
  }
}

export function writeBox(storage: Pick<Storage, "setItem"> | null, key: string, box: PopoutBox): void {
  if (!storage) return;
  try {
    storage.setItem(key, JSON.stringify(box));
  } catch {
    /* private mode, quota — the palette just forgets */
  }
}

function sessionStore(): Storage | null {
  try {
    return typeof sessionStorage === "undefined" ? null : sessionStorage;
  } catch {
    return null;
  }
}

export function attachPopout(tray: HTMLElement, host: HTMLElement, opts: { storageKey: string }): { popOut(): void; dock(): void; popped(): boolean; detach(): void } {
  const grip = document.createElement("div");
  grip.className = "cs-tray-grip";
  grip.setAttribute("aria-label", "Drag to move the controls");
  const dockBtn = document.createElement("button");
  dockBtn.className = "cs-tray-dock";
  dockBtn.title = "Dock under the bar";
  dockBtn.textContent = "⇤";
  grip.appendChild(dockBtn);
  let popped = false;
  let drag: { dx: number; dy: number } | null = null;

  const place = (box: PopoutBox): void => {
    const b = clampBox(box, { w: host.clientWidth, h: host.clientHeight });
    tray.style.left = `${b.x}px`;
    tray.style.top = `${b.y}px`;
    tray.style.width = `${b.w}px`;
    tray.style.height = `${b.h}px`;
    writeBox(sessionStore(), opts.storageKey, b);
  };
  const current = (): PopoutBox => ({ x: tray.offsetLeft, y: tray.offsetTop, w: tray.offsetWidth, h: tray.offsetHeight });

  const onMove = (e: PointerEvent): void => {
    if (!drag) return;
    const r = host.getBoundingClientRect();
    place({ ...current(), x: e.clientX - r.left - drag.dx, y: e.clientY - r.top - drag.dy });
  };
  const onUp = (): void => {
    drag = null;
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
  };
  grip.addEventListener("pointerdown", (e) => {
    if (e.target === dockBtn) return;
    const r = tray.getBoundingClientRect();
    drag = { dx: e.clientX - r.left, dy: e.clientY - r.top };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    e.preventDefault();
  });
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === "Escape" && popped) dock();
  };

  const popOut = (): void => {
    if (popped) return;
    popped = true;
    tray.classList.add("cs-popped");
    tray.prepend(grip);
    host.appendChild(tray);
    const saved = readBox(sessionStore(), opts.storageKey);
    place(saved ?? { x: host.clientWidth - 380, y: 24, w: 360, h: Math.min(360, host.clientHeight - 48) });
    window.addEventListener("keydown", onKey);
  };
  const dock = (): void => {
    if (!popped) return;
    popped = false;
    tray.classList.remove("cs-popped");
    tray.style.cssText = "";
    grip.remove();
    window.removeEventListener("keydown", onKey);
    tray.dispatchEvent(new CustomEvent("cs-tray-dock"));
  };
  dockBtn.addEventListener("click", dock);
  // Resizing writes back too (the browser's own resize handle).
  const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => popped && writeBox(sessionStore(), opts.storageKey, current()));
  ro?.observe(tray);
  return { popOut, dock, popped: () => popped, detach: () => { onUp(); ro?.disconnect(); window.removeEventListener("keydown", onKey); } };
}
```

- [ ] **Step 4: Wire it in `tray.ts`**

After `const tray = h("div", { class: "cs-paramtray", hidden: "" });` and the `bar.insertAdjacentElement("afterend", tray);` line:

```ts
  // Pop-out (design 2026-09-14 §2.6b): the same tray, floating over the stage.
  // On docking the tray returns under the bar — the host is the figure wrapper.
  const figure = bar.parentElement as HTMLElement;
  const popout = attachPopout(tray, figure, { storageKey: `drawcast.tray:${location.pathname}` });
  tray.addEventListener("cs-tray-dock", () => bar.insertAdjacentElement("afterend", tray));
```
Import `attachPopout` from `./tray-popout`. Add a `⧉` button next to where the activity pills row is built (Task 8's group is appended after it), only when the pointer is fine and the viewport wide:
```ts
    if (window.matchMedia("(pointer: fine) and (min-width: 720px)").matches) {
      const pop = h("button", { class: "cs-tray-popbtn", title: "Pop the controls out" }, "⧉");
      pop.addEventListener("click", () => popout.popOut());
      tray.appendChild(h("div", { class: "cs-tray-toprow" }, pop));
    }
```
In the tray's `close()` path call `popout.dock()` first so a closed tray always docks; in the destroy/teardown of `attachParamsTray` (wherever `bodySection?.destroy()` runs on unmount) call `popout.detach()`.

- [ ] **Step 5: CSS**

Replace the `.cs-paramtray` block:

```css
/* ---------- explore tray (params sliders under the control bar) ----------
   Looks like the figure (design 2026-09-14 §2.6b): the paper, the fonts, a
   hand-drawn border, no gap under the bar. Popped out, it floats over the
   stage with the browser's own resize handle. */
.cs-paramtray {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  padding: 0.5rem 0.7rem 0.6rem;
  background: var(--paper);
  color: var(--ink);
  border: 1.5px solid var(--ink);
  border-radius: 255px 15px 225px 15px / 15px 225px 15px 255px; /* the sketchy-box trick, same ink as the drawing */
  margin-top: -1px;
}
.cs-paramtray.cs-popped {
  position: absolute;
  z-index: 30;
  resize: both;
  overflow: auto;
  min-width: 260px;
  min-height: 120px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.18);
}
.cs-tray-grip { cursor: grab; display: flex; justify-content: flex-end; padding: 0 0 0.2rem; border-bottom: 1px dashed var(--line); margin-bottom: 0.3rem; touch-action: none; }
.cs-tray-grip:active { cursor: grabbing; }
.cs-tray-dock, .cs-tray-popbtn { font-size: var(--text-xs); background: none; border: none; color: var(--muted); cursor: pointer; }
.cs-tray-dock:hover, .cs-tray-popbtn:hover { color: var(--ink); }
.cs-tray-toprow { display: flex; justify-content: flex-end; }
```
Confirm `.cs-figure` (the tray's host) is `position: relative` — `grep -n "^\.cs-figure {" -A6 src/styles.css`; if not, add `position: relative;` to it.

- [ ] **Step 6: Run** — `npx vitest run tests/tray-popout.test.ts && npx tsc --noEmit` — Expected: PASS, clean.

- [ ] **Step 7: Commit**

```bash
git add src/ui/tray-popout.ts src/ui/tray.ts src/styles.css tests/tray-popout.test.ts
git commit -m "The tray looks like the figure and pops out into a movable, resizable palette (code controls Task 10, spec §2.6b)"
```

---

### Task 11: Examples, help, roadmap, smoke checklist

**Files:**
- Modify: `src/examples.json` (index 107 — "The law of large numbers, live" — and two new entries appended at the end)
- Modify: `public/help.html` (the `explore` row at ~line 364; a new row after `widget (on ask)`)
- Modify: `ROADMAP.md` (a new `## Code controls — done 2026-09-…` section after the "Six longer worked examples" section at ~line 743)
- Create: `docs/superpowers/plans/2026-09-14-code-controls-smoke.md`
- Test: `tests/examples.test.ts`, `tests/examples-style.test.ts`, `tests/code-controls-lint.test.ts` (gates run as-is)

- [ ] **Step 1: Rewrite example 107**

Replace the `spec` of the example whose title is "The law of large numbers, live" (keep its `request`) with:

```json
{
  "title": "The law of large numbers, live",
  "elements": [
    {
      "id": "sim",
      "type": "code",
      "language": "python",
      "show": "left",
      "width": 900,
      "controls": ["n", "seed"],
      "code": "import numpy as np\nimport matplotlib.pyplot as plt\nn = Slider(20, 2000, default=200, label=\"Draws\")\nseed = Button(\"Draw again\")\nrng = np.random.default_rng(7 + seed)\nx = rng.normal(size=n)\nprint(\"mean:\", round(x.mean(), 3))\n_ = plt.hist(x, bins=20)"
    }
  ],
  "commands": [
    { "speak": "Can two hundred random numbers already know where their center is? Let's run it for real." },
    { "draw": ["sim", "sim_line_1", "sim_line_2"], "parallel": true, "speak": "Numpy for the numbers, matplotlib for the picture." },
    { "draw": ["sim_line_3", "sim_line_4"], "speak": "Two knobs: how many draws, and a button that draws again — you will get them in a moment." },
    { "draw": ["sim_line_5", "sim_line_6"], "speak": "A seeded generator, two hundred draws from a standard normal." },
    { "draw": ["sim_line_7", "sim_line_8"], "speak": "Print the mean, and pile the draws into a histogram." },
    { "draw": ["sim_out"], "delivery": "grave", "speak": "The mean sits near zero, and the familiar bell is already there — randomness, obeying a law." },
    { "explore": { "code": "sim" }, "speak": "Now slide the draws down to twenty and up to two thousand, and press Draw again a few times. Watch how the center holds still while the bell fills in." }
  ]
}
```

- [ ] **Step 2: Append the SIR example**

```json
{
  "request": "Why does an epidemic peak and then fade, even when nobody was immune at the start?",
  "spec": {
    "title": "An epidemic peaks because it runs out of people to infect",
    "elements": [
      {
        "id": "sir",
        "type": "code",
        "language": "python",
        "show": "left",
        "width": 900,
        "controls": ["beta", "gamma", "days"],
        "code": "import matplotlib.pyplot as plt\ndef sir(beta=(0.1, 1.0, 0.05), gamma=(0.05, 0.5, 0.05), days=(30, 200)):\n    s, i, r = 0.99, 0.01, 0.0\n    S, I, R = [s], [i], [r]\n    for _ in range(days):\n        new, rec = beta * s * i, gamma * i\n        s, i, r = s - new, i + new - rec, r + rec\n        S.append(s); I.append(i); R.append(r)\n    plt.plot(S, label=\"susceptible\"); plt.plot(I, label=\"infected\"); plt.plot(R, label=\"recovered\")\n    plt.legend(); print(\"peak infected:\", round(max(I), 3))\nsir()"
      }
    ],
    "commands": [
      { "draw": ["sir", "sir_line_1", "sir_line_2"], "parallel": true, "speak": "Three groups: the susceptible, the infected, the recovered. Two rates decide everything — how fast it spreads, and how fast people recover." },
      { "draw": ["sir_line_3", "sir_line_4"], "speak": "Almost everyone starts susceptible; one in a hundred is infected." },
      { "draw": ["sir_line_5", "sir_line_6", "sir_line_7", "sir_line_8"], "speak": "Each day, new infections need a susceptible person AND an infected one to meet — so the fewer susceptibles are left, the fewer new cases, whatever the virus does." },
      { "draw": ["sir_line_9", "sir_line_10", "sir_line_11"], "speak": "Plot the three curves." },
      { "draw": ["sir_out"], "delivery": "grave", "speak": "The infected curve rises, peaks, and falls — not because anyone became immune at the start, but because the epidemic burns through the people it can reach." },
      { "explore": { "code": "sir" }, "speak": "Try it: lower the spread rate and the peak flattens and moves later. Raise the recovery rate and it shrinks. That is the whole idea behind flattening the curve." }
    ]
  }
}
```
Count the lines of `code` (11 lines after the rewrite: imports 1, def 2, s/i/r 3, lists 4, for 5, new/rec 6, update 7, append 8, plot 9, legend/print 10, call 11) and make sure the `draw` beats name exactly `sir_line_1` … `sir_line_11` — the examples gate resolves every id.

- [ ] **Step 3: Append the R bootstrap example**

```json
{
  "request": "What does a sampling distribution look like if I only have one sample? Bootstrap it in R.",
  "spec": {
    "title": "One sample, resampled: the bootstrap",
    "elements": [
      {
        "id": "boot",
        "type": "code",
        "language": "r",
        "show": "left",
        "width": 900,
        "controls": ["n", "reps", "resample"],
        "code": "library(ggplot2)\nn <- Slider(10, 500, default = 40, label = \"Sample size\")\nreps <- c(100, 2000)\nresample <- Button(\"Resample\")\nset.seed(1 + resample)\nx <- rexp(n, rate = 1/4)\nmeans <- replicate(reps, mean(sample(x, replace = TRUE)))\ncat(\"sample mean:\", round(mean(x), 2), \" boot sd:\", round(sd(means), 2), \"\\n\")\nggplot(data.frame(m = means), aes(m)) + geom_histogram(bins = 25)"
      }
    ],
    "commands": [
      { "draw": ["boot", "boot_line_1", "boot_line_2", "boot_line_3", "boot_line_4"], "parallel": true, "speak": "One sample of waiting times, and three knobs: its size, how many resamples, and a button for a fresh sample." },
      { "draw": ["boot_line_5", "boot_line_6"], "speak": "The sample: forty exponential waiting times, mean about four." },
      { "draw": ["boot_line_7"], "speak": "The trick: resample the sample WITH replacement, take the mean, and repeat — the data pretends to be the population." },
      { "draw": ["boot_line_8", "boot_line_9"], "speak": "Print the sample mean and the spread of the resampled means, then draw them." },
      { "draw": ["boot_out"], "delivery": "grave", "speak": "That histogram is the sampling distribution of the mean, built from one sample. Its width is the standard error — no formula needed." },
      { "explore": { "code": "boot" }, "speak": "Slide the sample size up and watch the histogram narrow. Press Resample: a different sample, the same shape." }
    ]
  }
}
```

- [ ] **Step 4: Run the gates**

Run: `npx vitest run tests/examples.test.ts tests/examples-style.test.ts tests/code-controls-lint.test.ts tests/examples-style.test.ts`
Expected: PASS. If the examples gate complains about an unknown `sir_line_N`/`boot_line_N`, recount the code lines and fix the beats — never pad the script. If the style ratchet trips, the request is errand-shaped: rephrase it as a question (both new requests above are questions).

Then confirm the three examples lint clean with zero `controls` warnings: `npx vitest run tests/examples.test.ts -t "lint"` and, in the app, open each example and check the lint panel shows nothing for the script.

- [ ] **Step 5: Help**

In `public/help.html`, after the `widget (on ask)` row add:

```html
            <tr><td><code>controls</code> (on code)</td><td>Names script variables the viewer can change from the ⊕ tray: a range tuple <code>n = (1, 50)</code> becomes a slider (integers when written without decimal points), a list of strings a choice row, <code>True</code>/<code>False</code> a switch, a string a text field, a number a number field, and <code>Slider(1, 50, default=10, label="Cycles")</code>, <code>Choice(…)</code>, <code>Toggle(…)</code>, <code>Text(…)</code>, <code>Number(…)</code>, <code>Button("Draw again")</code> when a label or default is wanted — also as a function's default argument, and in R with <code>c(1, 50)</code>. Moving a control rewrites that line and re-runs the script; the panel and any chart it feeds update. The movie shows the defaults; Continue restores the lesson.</td></tr>
```
And extend the `explore` row's text with: `An <code>explore</code> naming a script with <code>controls</code> opens those controls.`

- [ ] **Step 6: ROADMAP**

Add after the "Six longer worked examples" section:

```markdown
## Code controls — done 2026-09-14

Spec `docs/superpowers/specs/2026-09-14-code-controls-design.md`, plan
`docs/superpowers/plans/2026-09-14-code-controls.md`. `controls: [n, beta]`
on a code element; the variables' literals in the script (`(1, 50)`,
`["a", "b"]`, `True`, `"x"`, `3`, or `Slider(...)`/`Choice(...)`/`Toggle(...)`/
`Text(...)`/`Number(...)`/`Button(...)`, in a top-level assignment or a
function default) become tray controls; a change rewrites the literal in
place (line count kept) and re-runs through the tray's Run path; defaults are
baked into `code_result`, so the movie shows the default run. `glow: true`
holds the answer glow on the panel and the fed figure while a control moves;
`autorun: false` waits for Run. One click on a control-bearing panel during
playback pauses and opens its controls. The tray took the figure's paper and
a hand-drawn border, and pops out into a movable, resizable palette (⧉).
Three examples (LLN with a Draw-again button, SIR in function form, an R
bootstrap). Round 1 of "users extend drawcast themselves"; the widget body
(events on the drawing, games, sound) is the next round, its own spec.

Open: a `drawcast` stub module so a script with `Slider(...)` also runs in a
notebook; `basic` scripts; a drag bubble showing the slider value on the
thumb; controls on a template's own tier-2 code (none exist yet).
```

- [ ] **Step 7: Smoke checklist**

`docs/superpowers/plans/2026-09-14-code-controls-smoke.md`:

```markdown
# Code controls — smoke checklist (Hans)

Run `npm run dev`, open Examples.

1. **The law of large numbers, live** → play to the end; the explore beat
   opens the tray with "Draws" slider + "Draw again" button under the script.
   - [ ] The panel's third line reads `n = 200` (never the `Slider(...)` call).
   - [ ] Slide Draws to 20: the line reads `n = 20`, the histogram thins, the
         mean moves; slide back to 200: instant (cached), no "Running…".
   - [ ] Press Draw again three times: three different histograms, `seed = 1..3`.
   - [ ] Continue ▶ restores the lesson's frame; reopening ⊕ shows the defaults.
   - [ ] Export the movie: it shows the default run (n = 200, seed = 0).
2. **An epidemic peaks…** (function form)
   - [ ] beta/gamma/days sliders; `def sir(beta=0.55, …)` line updates.
   - [ ] beta → 0.1: the infected curve flattens; gamma → 0.5: it shrinks.
3. **One sample, resampled** (R)
   - [ ] "Sample size" slider (from `Slider(10, 500, default = 40, …)`),
         `reps` slider from `c(100, 2000)`, Resample button; R re-runs (a
         few seconds the first time), the ggplot histogram changes.
4. **One click from playback**: while example 1 plays, click the code panel
   once → it pauses AND the tray opens on the script's controls. Click the
   background once → it only pauses (as before).
5. **glow: true**: edit example 1's spec to add `"glow": true`; dragging the
   slider glows the panel; releasing clears it. Without the flag: no glow.
6. **Pop-out**: press ⧉ in the tray; drag it by its top edge; resize from the
   corner; reload → it comes back where it was; Esc or ⇤ docks it. On a phone
   width there is no ⧉.
7. **Taken over**: in the tray editor, change `bins=20` to `bins=5` and press
   Run ▶ → the control rows go quiet (faded); Continue ▶, reopen → live again.
8. **Lint**: in the editor, change `controls` to `["n", "zzz"]` → the lint
   names `zzz` with "no birthplace"; set `n = 5` on a later line → warning.
```

- [ ] **Step 8: Run everything**

Run: `npm test && npx tsc --noEmit`
Expected: PASS (count the total; it should be the previous total plus the new files' tests), tsc clean.

- [ ] **Step 9: Commit**

```bash
git add src/examples.json public/help.html ROADMAP.md docs/superpowers/plans/2026-09-14-code-controls-smoke.md
git commit -m "Code controls: three bundled examples (LLN with Draw again, SIR in function form, an R bootstrap), help, roadmap, smoke checklist (Task 11)"
```

---

### Task 12: Whole-branch verification and push

**Files:** none new.

- [ ] **Step 1: Full suite and types**

Run: `npm test 2>&1 | tail -15 && npx tsc --noEmit && echo TSC-OK`
Expected: all green, `TSC-OK`.

- [ ] **Step 2: Prompt-size pins still exact**

Run: `npx vitest run tests/prompt-size.test.ts`
Expected: PASS. (Task 11's help/roadmap edits do not touch the prompt; the pins from Task 4 hold.)

- [ ] **Step 3: A production build**

Run: `npm run build 2>&1 | tail -5`
Expected: vite build succeeds (this is what Netlify runs after the tests).

- [ ] **Step 4: Review the diff with fresh eyes against the spec's §2.4 invariants**

```bash
git log --oneline main..HEAD
git diff main --stat
grep -n "line count" src/code/controls.ts
```
Confirm: no `split("\n")` in `applyControls` changes length (it rewrites within lines); the resolver applies defaults on the clone only (`tests/code-element.test.ts` "the author's spec is never stamped" still passes).

- [ ] **Step 5: Push**

```bash
git branch --show-current   # main
git push origin main
git ls-remote origin main | cut -c1-12   # matches git rev-parse --short=12 HEAD
```
Then watch the Netlify deploy reach state "ready" before reporting "live" (feedback rule 2026-09-10).

---

## Self-review against the spec

- §2.1 names in spec / shapes in script → Tasks 1, 4. §2.2 grammar table incl. integer rule, nice step, defaults, R, longhand-parsed-never-executed → Tasks 1–3. §2.3 birthplaces, one per name, literal-RHS rule, later reassignment warning → Tasks 1, 5. §2.4 rewrite invariants, `controls.ts` API → Task 3 (+ Task 6 for "what runs and what the panel draws", Task 8 for "editor shows rewritten text / takes over"). §2.5 defaults applied in resolver, check, layout → Task 6. §2.6 tray group, order, layout, autorun+debounce, text commit on Enter/blur, `autorun: false`, `glow: true`, explore expansion, one-click → Tasks 7, 8, 9. §2.6b look + pop-out → Task 10. §2.7 lint errors/warnings → Task 5. §2.8 prompt, schema, re-pin, anyOf-free → Task 4. §3 tests → every task; the mini-DOM item became source pins (repo idiom) plus the smoke checklist. §4 out of scope respected (no `store`, no basic, no motion, no drawn controls). §5 examples → Task 11. §6 build order → task order.
- Type consistency: `ControlSpec`/`ControlValue`/`parseControls`/`applyControls`/`withControlDefaults`/`formatValue` (Tasks 1–3) are the names used in Tasks 5–8; `rowWidth`/`debounceMs`/`readout`/`nextValues` (Task 7) in Task 8; `TrayPlan.controls` + `controlIds` (Task 7) in Task 8; `holdGlow` (Task 8) in Task 8's rows; `attachPopout`/`clampBox`/`readBox`/`writeBox`/`POPOUT_MIN` (Task 10) consistent.
- Not in the spec but decided here: the stub `drawcast` notebook module is left open (ROADMAP); `takenOver` rows fade rather than disappear.
