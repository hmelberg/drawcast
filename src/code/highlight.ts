// Syntax colouring for a code element's SOURCE pane (layout/code.ts) — ported
// from microdata's own editor backdrop (index.html's highlightScriptPyR +
// highlightCodeLine for Python/R, highlightCommandTokens for the microdata
// command language; app.css's md-out-* classes for the palette). Pure and
// dependency-free but for layout/model's COLORS (already crossed by
// code/chart-style.ts — see that file), so it is safe to import from the
// layout layer without pulling render/portrait's IndexedDB.
//
// tokenizeLine is STATELESS, one line at a time — unlike the microdata
// original, which tracks an open triple-quoted string ACROSS lines
// (highlightScriptPyR's `openTriple`). A code element draws one text
// drawable per SOURCE LINE (layout/code.ts), and this module's signature
// mirrors that: no state threads between calls. A Python triple-quoted
// string that spans several source lines therefore colours only within
// each line that opens AND/OR closes it — a line entirely INSIDE the
// string (no quote marks of its own) is tokenized as ordinary code on its
// own line. Deliberate scope cut, not an oversight: fixing it needs a
// stateful caller, which the required signature does not have.

import { COLORS } from "../layout/model";

export type TokenKind =
  | "plain"
  | "keyword"
  | "command"
  | "variable"
  | "number"
  | "string"
  | "comment"
  | "operator"
  | "function"
  | "path";

export interface Token {
  text: string;
  kind: TokenKind;
}

/**
 * Ink-on-paper palette for the token kinds, borrowed from layout/model.ts
 * COLORS so a code pane shares the figure's own hand rather than importing
 * a second palette. Six distinct colours (the rest fall back to one of
 * these, `plain` to none — the drawable's own `style.color` applies):
 *   keyword  → accent  (violet-blue, reads as an accent against the cream ground)
 *   command  → demand  (rust) — the DSL's leading verb, meant to stand out
 *   variable → supply  (blue)
 *   path     → supply  (shares variable's blue — a `db` in `db/NAME` names a thing, same family as a variable)
 *   number   → region1 (amber)
 *   string   → region2 (sage green)
 *   function → region2 (shares string's green)
 *   comment  → guide   (taupe grey)
 *   operator → guide   (shares comment's grey — low-key punctuation)
 * The microdata reference spends nine CSS colours across these same
 * concepts (op/path-prefix/aggopt violet, paren/kw-calm khaki, kw-brown
 * yellow-green, cmd grey, func green, str teal, var blue, num amber,
 * comment grey-italic) — collapsed here to six so the figure's palette
 * stays small (Hans: keep it simple).
 */
export function tokenColor(kind: TokenKind): string | undefined {
  switch (kind) {
    case "keyword":
      return COLORS.accent;
    case "command":
      return COLORS.demand;
    case "variable":
    case "path":
      return COLORS.supply;
    case "number":
      return COLORS.region1;
    case "string":
    case "function":
      return COLORS.region2;
    case "comment":
    case "operator":
      return COLORS.guide;
    case "plain":
      return undefined;
  }
}

// ---- Python / R (and Brython / MicroPython, which share Python's grammar) ----
// Ported from microdata's highlightCodeLine (index.html ~L2958) — same scan
// order: comment-to-end-of-line, triple-quoted string (same-line only — see
// the module header), quoted string, number, identifier (keyword/builtin
// call vs. plain), bracket/operator, else plain.

const PYTHON_KEYWORDS = new Set([
  "False", "None", "True", "and", "as", "assert", "async", "await",
  "break", "class", "continue", "def", "del", "elif", "else", "except",
  "finally", "for", "from", "global", "if", "import", "in", "is",
  "lambda", "nonlocal", "not", "or", "pass", "raise", "return",
  "try", "while", "with", "yield",
]);
const PYTHON_BUILTINS = new Set([
  "abs", "all", "any", "bool", "dict", "dir", "enumerate", "filter",
  "float", "format", "getattr", "hasattr", "int", "isinstance",
  "len", "list", "map", "max", "min", "open", "print", "range",
  "reversed", "round", "set", "sorted", "str", "sum", "tuple", "type", "zip",
]);

// R's own set — kept modest (core control-flow keywords, a couple dozen very
// common base-R functions) rather than porting microdata's ~80-item
// tidyverse/ggplot catalogue (R_FUNCTIONS in index.html): this pane is a
// figure's illustration of a script, not an IDE.
const R_KEYWORDS = new Set([
  "if", "else", "for", "while", "repeat", "function", "return",
  "break", "next", "in", "TRUE", "FALSE", "NULL", "NA", "Inf", "NaN", "T", "F",
]);
const R_BUILTINS = new Set([
  "c", "list", "data.frame", "matrix", "factor", "table",
  "print", "cat", "paste", "paste0", "sprintf",
  "length", "nrow", "ncol", "mean", "sum", "min", "max", "sd", "median", "var",
  "sort", "unique", "head", "tail", "summary", "class", "str",
  "is.na", "which", "sapply", "lapply", "library", "require",
]);

interface PyRCfg {
  commentChar: string;
  triple: boolean;
  identStart: RegExp;
  identPart: RegExp;
  keywords: Set<string>;
  builtins: Set<string>;
}
const PY_CFG: PyRCfg = { commentChar: "#", triple: true, identStart: /[A-Za-z_]/, identPart: /[A-Za-z0-9_]/, keywords: PYTHON_KEYWORDS, builtins: PYTHON_BUILTINS };
const R_CFG: PyRCfg = { commentChar: "#", triple: false, identStart: /[A-Za-z_.]/, identPart: /[A-Za-z0-9_.]/, keywords: R_KEYWORDS, builtins: R_BUILTINS };

function tokenizePyRLike(line: string, cfg: PyRCfg): Token[] {
  const tokens: Token[] = [];
  let plain = "";
  const flush = () => {
    if (plain) {
      tokens.push({ text: plain, kind: "plain" });
      plain = "";
    }
  };
  const n = line.length;
  let i = 0;
  while (i < n) {
    const c = line[i];
    if (c === cfg.commentChar) {
      flush();
      tokens.push({ text: line.slice(i), kind: "comment" });
      return tokens;
    }
    if (cfg.triple && (c === '"' || c === "'") && line[i + 1] === c && line[i + 2] === c) {
      const delim = c + c + c;
      const close = line.indexOf(delim, i + 3);
      flush();
      if (close === -1) {
        tokens.push({ text: line.slice(i), kind: "string" });
        return tokens;
      }
      tokens.push({ text: line.slice(i, close + 3), kind: "string" });
      i = close + 3;
      continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n) {
        if (line[j] === "\\") {
          j += 2;
          continue;
        }
        if (line[j] === c) {
          j++;
          break;
        }
        j++;
      }
      flush();
      tokens.push({ text: line.slice(i, j), kind: "string" });
      i = j;
      continue;
    }
    if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(line[i + 1] ?? ""))) {
      let k = i;
      while (k < n && /[0-9_]/.test(line[k])) k++;
      if (line[k] === ".") {
        k++;
        while (k < n && /[0-9_]/.test(line[k])) k++;
      }
      if (line[k] === "e" || line[k] === "E") {
        k++;
        if (line[k] === "+" || line[k] === "-") k++;
        while (k < n && /[0-9]/.test(line[k])) k++;
      }
      flush();
      tokens.push({ text: line.slice(i, k), kind: "number" });
      i = k;
      continue;
    }
    if (cfg.identStart.test(c)) {
      const s = i;
      while (i < n && cfg.identPart.test(line[i])) i++;
      const word = line.slice(s, i);
      let m = i;
      while (m < n && /\s/.test(line[m])) m++;
      const isCall = line[m] === "(";
      const kind: TokenKind = cfg.keywords.has(word) ? "keyword" : cfg.builtins.has(word) || isCall ? "function" : "plain";
      if (kind === "plain") {
        plain += word;
        continue;
      }
      flush();
      tokens.push({ text: word, kind });
      continue;
    }
    if ("()[]{}".includes(c) || "+-*/%=<>!&|~^".includes(c)) {
      flush();
      tokens.push({ text: c, kind: "operator" });
      i++;
      continue;
    }
    plain += c;
    i++;
  }
  flush();
  return tokens;
}

// ---- microdata's command language ------------------------------------------
// Ported from highlightCommandTokens (index.html ~L5796): a command word
// first on the line (or any `scrub-*` verb), `db/NAME` paths, quoted
// strings, numbers (a date like 2022-01-01 scans as three number tokens
// glued by two plain hyphens — the reference's own number scanner has no
// notion of a date or a unary minus, and this ports it as-is rather than
// inventing date support it never had), and the DSL's reserved words.
//
// The reference spreads those reserved words across FOUR CSS classes
// (kw-brown for report options FROM `by`/`over`/`rowpct`&c., a violet
// aggopt class for `mean`/`median`&c., a violet op class for the lone `if`,
// and a khaki kw-calm class for `as`/`for`/`in`&c.) — collapsed here into
// ONE "keyword" kind (see tokenColor's doc comment for why).
const MD_KEYWORDS = new Set([
  // report/table options (was kw-brown)
  "rowpct", "colpct", "cellpct", "chi2", "flatten", "horizontal", "missing", "summarize",
  "by", "over",
  // aggregate options (was aggopt)
  "mean", "median", "std", "min", "max", "count", "sum", "sd", "sem", "semean",
  "percent", "iqr", "gini", "var", "p50", "p25", "p75", "p90", "p95", "p99",
  "first", "last", "n", "nobs", "obs", "freq", "prop",
  // the one purple keyword
  "if",
  // connective/clause words (was kw-calm)
  "as", "for", "end", "in", "and", "or", "not", "with", "from", "to", "where", "into", "on",
]);

const MD_WORD_START = /[\p{L}_]/u;
const MD_WORD_PART = /[\p{L}\p{N}_.\-]/u;

function tokenizeMicrodata(line: string): Token[] {
  const tokens: Token[] = [];
  let plain = "";
  const flush = () => {
    if (plain) {
      tokens.push({ text: plain, kind: "plain" });
      plain = "";
    }
  };
  const n = line.length;
  let i = 0;
  let wordIndex = 0;
  while (i < n) {
    const c = line[i];
    if (/\s/.test(c)) {
      plain += c;
      i++;
      continue;
    }
    if (c === '"' || c === "'") {
      const q = c;
      let j = i + 1;
      while (j < n) {
        if (line[j] === "\\" && j + 1 < n) {
          j += 2;
          continue;
        }
        if (line[j] === q) {
          j++;
          break;
        }
        j++;
      }
      flush();
      tokens.push({ text: line.slice(i, j), kind: "string" });
      i = j;
      continue;
    }
    if (i + 1 < n) {
      const two = c + line[i + 1];
      if (two === "<=" || two === ">=" || two === "==" || two === "!=" || two === "<>" || two === "&&" || two === "||") {
        flush();
        tokens.push({ text: two, kind: "operator" });
        i += 2;
        continue;
      }
    }
    if (/\d/.test(c) || (c === "." && i + 1 < n && /\d/.test(line[i + 1]))) {
      let k = i;
      if (c === ".") k++;
      while (k < n && /\d/.test(line[k])) k++;
      if (k < n && (line[k] === "." || line[k] === "e" || line[k] === "E")) {
        if (line[k] === ".") {
          k++;
          while (k < n && /\d/.test(line[k])) k++;
        }
        if (k < n && (line[k] === "e" || line[k] === "E")) {
          k++;
          if (k < n && (line[k] === "+" || line[k] === "-")) k++;
          while (k < n && /\d/.test(line[k])) k++;
        }
      }
      flush();
      tokens.push({ text: line.slice(i, k), kind: "number" });
      i = k;
      continue;
    }
    if (MD_WORD_START.test(c)) {
      let k = i;
      while (k < n && MD_WORD_PART.test(line[k])) k++;
      const word = line.slice(i, k);
      let m = k;
      while (m < n && /\s/.test(line[m])) m++;
      const nextNonWs = m < n ? line[m] : "";
      const isWordBeforeSlash = nextNonWs === "/";
      const isFunc = m < n && line[m] === "(";
      const low = word.toLowerCase();
      let kind: TokenKind;
      if (isWordBeforeSlash) kind = "path";
      else if (wordIndex === 0) kind = "command";
      else if (low.startsWith("scrub-")) kind = "command";
      else if (MD_KEYWORDS.has(low)) kind = "keyword";
      else if (isFunc) kind = "function";
      else kind = "variable";
      wordIndex++;
      flush();
      tokens.push({ text: word, kind });
      i = k;
      continue;
    }
    if (c === "/" && i + 1 < n && line[i + 1] === "/") {
      const prev = i > 0 ? line[i - 1] : "";
      if ((i === 0 || /\s/.test(prev)) && prev !== ":") {
        flush();
        tokens.push({ text: line.slice(i), kind: "comment" });
        return tokens;
      }
    }
    if (c === "(" || c === ")") {
      flush();
      tokens.push({ text: c, kind: "operator" });
      i++;
      continue;
    }
    if (c === "/") {
      flush();
      tokens.push({ text: c, kind: "operator" });
      i++;
      continue;
    }
    if (",=<>*&!".includes(c)) {
      flush();
      tokens.push({ text: c, kind: "operator" });
      i++;
      continue;
    }
    plain += c;
    i++;
  }
  flush();
  return tokens;
}

// ---- C64 BASIC ---------------------------------------------------------------
// Kept modest, as asked — no function-call detection, no path/command
// concepts, just keyword/string/number/comment/plain. The keyword list is
// copied by hand from code/basic.ts's own KEYWORDS (its tokenizer, which
// drives the interpreter) rather than imported, so this pure module pulls
// none of that file's C64/envelope/run dependencies; the two lists should
// be kept in sync if BASIC's grammar grows. Unlike basic.ts (which
// uppercases its whole source before scanning, since the dialect is
// case-insensitive), this keeps the ORIGINAL casing in every emitted token
// — colouring must never change what the line says.
const BASIC_KEYWORDS = [
  "RESTORE", "RETURN", "VERIFY", "PRINT", "INPUT", "GOSUB", "CLOSE", "RIGHT$", "LEFT$", "CHR$", "STR$", "MID$",
  "GOTO", "THEN", "STEP", "NEXT", "DATA", "READ", "POKE", "PEEK", "STOP", "WAIT", "OPEN", "LOAD", "SAVE",
  "LIST", "CONT", "SPC(", "TAB(", "LET", "FOR", "REM", "END", "DIM", "AND", "NOT", "INT", "RND", "LEN",
  "ASC", "VAL", "ABS", "SGN", "SYS", "USR", "DEF", "GET", "NEW", "CLR", "RUN", "FRE", "POS", "SIN", "COS",
  "TAN", "ATN", "EXP", "LOG", "SQR", "IF", "TO", "OR", "ON", "FN",
];

function tokenizeBasic(line: string): Token[] {
  const tokens: Token[] = [];
  let plain = "";
  const flush = () => {
    if (plain) {
      tokens.push({ text: plain, kind: "plain" });
      plain = "";
    }
  };
  const upper = line.toUpperCase();
  const n = line.length;
  let i = 0;
  while (i < n) {
    const c = line[i];
    if (c === " " || c === "\t") {
      plain += c;
      i++;
      continue;
    }
    if (c === '"') {
      const j = line.indexOf('"', i + 1);
      const end = j === -1 ? n : j + 1;
      flush();
      tokens.push({ text: line.slice(i, end), kind: "string" });
      i = end;
      continue;
    }
    if ((c >= "0" && c <= "9") || (c === "." && /[0-9]/.test(line[i + 1] ?? ""))) {
      const m = /^\d*\.?\d*([eE][+-]?\d+)?/.exec(line.slice(i))!;
      flush();
      tokens.push({ text: m[0], kind: "number" });
      i += m[0].length;
      continue;
    }
    const kw = BASIC_KEYWORDS.find((k) => upper.startsWith(k, i));
    if (kw) {
      flush();
      if (kw === "REM") {
        tokens.push({ text: line.slice(i), kind: "comment" });
        return tokens;
      }
      tokens.push({ text: line.slice(i, i + kw.length), kind: "keyword" });
      i += kw.length;
      continue;
    }
    if (c === "?") {
      flush();
      tokens.push({ text: c, kind: "keyword" }); // shorthand for PRINT
      i++;
      continue;
    }
    if (/[A-Za-z]/.test(c)) {
      const m = /^[A-Za-z][A-Za-z0-9]*[$%]?/.exec(line.slice(i))!;
      flush();
      tokens.push({ text: m[0], kind: "variable" });
      i += m[0].length;
      continue;
    }
    if ("+-*/^=<>(),;:".includes(c)) {
      const two = line.slice(i, i + 2);
      if (two === "<=" || two === ">=" || two === "<>" || two === "=<" || two === "=>" || two === "><") {
        flush();
        tokens.push({ text: two, kind: "operator" });
        i += 2;
        continue;
      }
      flush();
      tokens.push({ text: c, kind: "operator" });
      i++;
      continue;
    }
    plain += c;
    i++;
  }
  flush();
  return tokens;
}

/**
 * One source line → its tokens, texts concatenating back to `line` exactly
 * (whitespace included — column arithmetic elsewhere, marks above all,
 * depends on that). Empty input still returns one (empty) token, so a
 * caller can assume every line has at least one. Unknown/absent language →
 * one plain token covering the whole line.
 */
export function tokenizeLine(line: string, language: string): Token[] {
  let tokens: Token[];
  switch (language) {
    case "python":
    case "brython":
    case "micropython":
      tokens = tokenizePyRLike(line, PY_CFG);
      break;
    case "r":
      tokens = tokenizePyRLike(line, R_CFG);
      break;
    case "microdata":
      tokens = tokenizeMicrodata(line);
      break;
    case "basic":
      tokens = tokenizeBasic(line);
      break;
    default:
      tokens = [];
  }
  return tokens.length > 0 ? tokens : [{ text: line, kind: "plain" }];
}
