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
  const looksLikeLonghand = (text: string): boolean => /^(?:Slider|Choice|Toggle|Text|Number|Button)\s*\(/.test(text.trim());
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
    // range, a list, a Button), a later longhand call by name (even one whose
    // kind is not itself a shape, e.g. a later `Toggle(...)`), or any later
    // def default is a second birth — an error. A later plain value (a
    // number, a string, a bool) in an assignment is the script overwriting
    // its own control — a warning; so is a later assignment whose literal
    // looks like a control attempt but fails to classify (an invalid range,
    // say) — it too would have overwritten the control's value.
    const first = ok[0];
    const rest = ok.slice(1);
    const seconds = rest.filter((x) => x.c.birthplace === "param" || isShape(x.k) || looksLikeLonghand(x.c.text));
    if (seconds.length > 0) {
      issues.push({ name, message: `"${name}" is born twice (lines ${[first, ...seconds].map((b) => b.c.line + 1).join(" and ")}) — a control has one birthplace`, severity: "error" });
      continue;
    }
    const spec = first.k;
    controls.push({ ...spec, name, label: spec.label ?? name, line: first.c.line, start: first.c.start, end: first.c.end, birthplace: first.c.birthplace });
    const later = rest.find((x) => x.c.birthplace === "assign" && x.c.line > first.c.line);
    if (later) issues.push({ name, message: `"${name}" is reassigned to a literal on line ${later.c.line + 1} — the control's value would be overwritten`, severity: "warn" });
    const laterBad = bad.find((x) => x.c.line > first.c.line);
    if (laterBad) issues.push({ name, message: `"${name}" is assigned an invalid control literal on line ${laterBad.c.line + 1} (${laterBad.k.error}) — the control's value would be overwritten`, severity: "warn" });
  }
  return { controls, issues };
}

/** A control's value, rendered in the language's own literal syntax. */
export function formatValue(language: string, control: ControlSpec, value: ControlValue): string {
  const grammar = grammarFor(language) ?? "python";
  switch (control.kind) {
    case "toggle": {
      const on = value === true || value === "true";
      return grammar === "python" ? (on ? "True" : "False") : on ? "TRUE" : "FALSE";
    }
    case "text":
    case "choice":
      return `"${String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n").replace(/\r/g, "\\r")}"`;
    case "button": {
      const n = Number(value);
      return String(Number.isFinite(n) ? Math.max(0, Math.round(n)) : control.default);
    }
    case "slider":
    case "number": {
      const n = Number(value);
      const v = Number.isFinite(n) ? n : Number(control.default);
      if (control.integer) return String(Math.round(v));
      return v.toFixed(control.decimals ?? 2);
    }
    default:
      return String(value);
  }
}

/** Rewrite each control's literal span with its value (missing values → the control's default). Line count preserved. */
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

/** parse + apply defaults; idempotent; returns `code` unchanged when names is empty/undefined or the language has no grammar. */
export function withControlDefaults(language: string, code: string, names: string[] | undefined): string {
  if (!names || names.length === 0 || grammarFor(language) === null) return code;
  const { controls } = parseControls(language, code, names);
  if (controls.length === 0) return code;
  return applyControls(language, code, controls, {});
}
