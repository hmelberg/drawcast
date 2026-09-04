// What the keyboard does inside a script: Tab and Enter as a code editor's,
// and a rudimentary word completion. All of it pure — the two text areas
// (the card on the panel and the tray's copy) share this module and only the
// DOM plumbing differs (ui/code-typing.ts).
//
// Deliberately small. This suggests only what it can KNOW: the language's own
// keywords, a short list of builtins that exist in every tier of that runtime,
// and the words already in the script — which is where the variable names, the
// imported module aliases and the attribute names come from for free. It never
// asks a runtime what is in scope, and it never invents a library API.
//
// microdata is the language that needs this most (its commands are its whole
// surface, and its variable names are long), so it gets all three: commands,
// expression functions, and the FDB variables the emulator loaded. None of
// them is hand-kept — the two lists are derived from the vendored snapshot and
// pinned to it by a drift test, and the variables come from the boot itself
// through code/vocabulary. A copied vocabulary is the one that goes stale.

/** Python's syntax serves four of the five runtimes. */
const PY_KEYWORDS = [
  "False", "None", "True", "and", "as", "assert", "async", "await", "break", "class", "continue", "def", "del",
  "elif", "else", "except", "finally", "for", "from", "global", "if", "import", "in", "is", "lambda", "nonlocal",
  "not", "or", "pass", "raise", "return", "try", "while", "with", "yield",
];

/** Builtins, not libraries: these answer in pyodide, Brython AND MicroPython. */
const PY_BUILTINS = [
  "abs", "all", "any", "bool", "dict", "enumerate", "filter", "float", "format", "int", "isinstance", "len",
  "list", "map", "max", "min", "print", "range", "repr", "reversed", "round", "set", "sorted", "str", "sum",
  "tuple", "type", "zip",
];

/**
 * microdata's own vocabulary, both halves derived from the vendored emulator
 * (public/mdlib/<version>/) and pinned against it by
 * tests/microdata-vocabulary.test.ts — so a snapshot that adds a command
 * fails a test instead of quietly suggesting yesterday's language.
 *
 * COMMANDS start a line; FUNCTIONS live inside generate/replace/if
 * expressions (m2py's own get_microdata_functions registry). The third and
 * most useful half — the catalogue's variable names — is not a list at all:
 * it comes from the emulator that booted, through code/vocabulary.
 */
export const MD_COMMANDS = [
  "aggregate", "anova", "assign-labels", "barchart", "boxplot", "ci", "clear", "clone-dataset", "clone-units",
  "clone-variables", "coefplot", "collapse", "configure", "correlate", "cox", "create-dataset", "define-labels",
  "delete-dataset", "destring", "drop", "drop-labels", "end", "endblock", "for", "generate", "hausman", "hexbin",
  "histogram", "history", "import", "import-event", "import-panel", "ivregress", "ivregress-predict",
  "kaplan-meier", "keep", "let", "list-labels", "logit", "logit-predict", "merge", "mlogit", "mlogit-predict",
  "negative-binomial", "negative-binomial-predict", "normaltest", "oaxaca", "piechart", "poisson",
  "poisson-predict", "probit", "probit-predict", "rdd", "recode", "regress", "regress-mml",
  "regress-mml-predict", "regress-panel", "regress-panel-diff", "regress-panel-predict", "regress-predict",
  "rename", "rename-dataset", "replace", "require", "reshape-from-panel", "reshape-to-panel", "sample", "sankey",
  "scatter", "summarize", "summarize-panel", "tabulate", "tabulate-panel", "textblock", "transitions-panel",
  "use", "variables", "weibull"
];

export const MD_FUNCTIONS = [
  "F", "Fden", "Ftail", "abs", "acos", "asin", "atan", "betaden", "bind", "binomial", "binomialp",
  "binomialtail", "ceil", "chi2", "chi2den", "chi2tail", "comb", "cos", "date", "date_fmt", "day", "dow", "doy",
  "endswith", "exp", "floor", "halfyear", "ibeta", "ibetatail", "inlabels", "inlist", "inrange", "int", "invF",
  "invFtail", "invchi2", "invchi2tail", "invibeta", "invibetatail", "invt", "invttail", "isoformatdate",
  "label_to_code", "labelcontains", "length", "ln", "lnfactorial", "log10", "logit", "lower", "ltrim", "month",
  "normal", "normalden", "pi", "quantile", "quarter", "round", "rowconcat", "rowmax", "rowmean", "rowmedian",
  "rowmin", "rowmissing", "rowstd", "rowtotal", "rowvalid", "rtrim", "sin", "sqrt", "startswith", "string",
  "substr", "sysmiss", "t", "tan", "tden", "to_int", "to_str", "to_symbol", "trim", "ttail", "upper", "week",
  "year"
];

const R_KEYWORDS = ["FALSE", "Inf", "NA", "NULL", "NaN", "TRUE", "break", "else", "for", "function", "if", "in", "next", "repeat", "return", "while"];

const R_BUILTINS = [
  "abline", "apply", "as.character", "as.factor", "as.numeric", "barplot", "c", "cat", "cor", "data.frame",
  "dim", "factor", "head", "hist", "ifelse", "is.na", "lapply", "length", "levels", "library", "lines", "list",
  "lm", "matrix", "max", "mean", "median", "min", "names", "ncol", "nrow", "order", "paste", "paste0", "plot",
  "points", "predict", "print", "quantile", "rep", "rev", "rnorm", "round", "runif", "sample", "sapply", "sd",
  "seq", "seq_len", "set.seed", "sort", "sprintf", "sum", "summary", "t.test", "table", "tail", "var", "vector",
];

/** R's names carry dots (data.frame, is.na); Python's do not, and there a dot
 *  means "an attribute of the thing on the left". */
const rLike = (language: string): boolean => language === "r";

function tokenRe(language: string): RegExp {
  return rLike(language) ? /[A-Za-z._][A-Za-z0-9._]*/g : /[A-Za-z_][A-Za-z0-9_]*/g;
}

function isWordChar(ch: string, language: string): boolean {
  return rLike(language) ? /[A-Za-z0-9._]/.test(ch) : /[A-Za-z0-9_]/.test(ch);
}

export type CompletionKind = "local" | "command" | "variable" | "function" | "builtin" | "keyword";

export interface Completion {
  word: string;
  kind: CompletionKind;
}

export interface CompletionResult {
  /** The token being typed, as a range in the text. */
  start: number;
  end: number;
  prefix: string;
  items: Completion[];
}

/** Indent one level: four spaces for Python, two for R — what each language's
 *  own code looks like, and what `lines` panes were laid out for. */
export function indentWidth(language: string): number {
  return rLike(language) ? 2 : 4;
}

/** Every distinct identifier in the script — the variables, the aliases an
 *  import created, the attributes reached through a dot. */
export function localWords(text: string, language: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(tokenRe(language))) {
    if (m[0].length > 1) out.add(m[0]);
  }
  return [...out];
}

/**
 * A comment or a string literal is prose, not code — completing inside one is
 * pure noise. Python and R comment with '#', microdata with '//', and an odd
 * number of quotes before the caret on this line means we are inside a string.
 */
function inProse(line: string, language: string): boolean {
  const comment = language === "microdata" ? "//" : "#";
  let quote: string | null = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quote) {
      if (ch === quote && line[i - 1] !== "\\") quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (line.startsWith(comment, i)) return true;
  }
  return quote !== null;
}

/**
 * What to offer for the token the caret is inside. Null when there is nothing
 * to say: too little typed (unless `force`, the Ctrl-Space door), the caret in
 * a comment or a string, or no candidate the viewer has not already typed in
 * full.
 */
export function completionsFor(input: {
  text: string;
  caret: number;
  language: string;
  /** The FDB variables the microdata emulator loaded, when it has booted. */
  variables?: string[];
  force?: boolean;
  limit?: number;
}): CompletionResult | null {
  const { text, caret, language, variables = [], force = false, limit = 6 } = input;
  const lineStart = text.lastIndexOf("\n", caret - 1) + 1;
  // A microdata line begins with a COMMAND, and half of them are hyphenated
  // (create-dataset, regress-panel-diff). The hyphen counts as part of the
  // word in that one position and nowhere else — mid-line it is a minus sign.
  const command = language === "microdata" ? /^(\s*)([A-Za-z][A-Za-z0-9_-]*)$/.exec(text.slice(lineStart, caret)) : null;
  let start = caret;
  if (command) start = lineStart + command[1].length;
  else while (start > 0 && isWordChar(text[start - 1], language)) start--;
  const prefix = text.slice(start, caret);
  if (prefix === "" || /^[0-9.]/.test(prefix)) return null;
  if (!force && prefix.length < 2) return null;
  if (inProse(text.slice(lineStart, start), language)) return null;

  // After a dot, Python is asking for an attribute — a keyword there is never
  // right, and the script's own words are the only honest source.
  const afterDot = !rLike(language) && language !== "microdata" && start > 0 && text[start - 1] === ".";
  const named = (words: readonly string[], kind: CompletionKind): Completion[] => words.map((word) => ({ word, kind }));
  let curated: Completion[];
  if (afterDot) curated = [];
  else if (language === "microdata")
    // At the start of a line the commands ARE the language; anywhere else the
    // caret is inside an expression or an argument, where the variables and
    // the expression functions live.
    curated = command ? named(MD_COMMANDS, "command") : [...named(variables, "variable"), ...named(MD_FUNCTIONS, "function")];
  else if (rLike(language)) curated = [...named(R_BUILTINS, "builtin"), ...named(R_KEYWORDS, "keyword")];
  else curated = [...named(PY_BUILTINS, "builtin"), ...named(PY_KEYWORDS, "keyword")];
  const locals = named(localWords(text.slice(0, start) + text.slice(caret), language), "local");

  const rank: Record<CompletionKind, number> = { local: 0, command: 1, variable: 2, builtin: 3, function: 3, keyword: 4 };
  const seen = new Set<string>();
  const items = [...locals, ...curated]
    .filter((c) => c.word.startsWith(prefix) && c.word !== prefix)
    .filter((c) => (seen.has(c.word) ? false : seen.add(c.word)))
    .sort((a, b) => rank[a.kind] - rank[b.kind] || a.word.length - b.word.length || a.word.localeCompare(b.word))
    .slice(0, limit);
  return items.length === 0 ? null : { start, end: caret, prefix, items };
}

/** One text replacement plus where the caret (or selection) ends up. */
export interface TextEdit {
  start: number;
  end: number;
  text: string;
  selStart: number;
  selEnd: number;
}

const lineStartsIn = (value: string, from: number, to: number): number[] => {
  const first = value.lastIndexOf("\n", from - 1) + 1;
  const starts = [first];
  for (let i = first; i < to; i++) if (value[i] === "\n") starts.push(i + 1);
  return starts;
};

/**
 * Tab and Shift-Tab. A selection spanning lines shifts every line it touches;
 * otherwise Tab moves to the next tab stop (so a half-indented line lands on
 * the grid) and Shift-Tab takes one level off the line's own indentation,
 * wherever the caret happens to sit in it.
 */
export function tabEdit(value: string, selStart: number, selEnd: number, width: number, dedent = false): TextEdit | null {
  const multi = selStart !== selEnd && value.slice(selStart, selEnd).includes("\n");
  if (multi || (dedent && selStart !== selEnd)) {
    const starts = lineStartsIn(value, selStart, selEnd);
    const from = starts[0];
    const to = value.indexOf("\n", selEnd) === -1 ? value.length : value.indexOf("\n", selEnd);
    const before = value.slice(from, to);
    const lines = before.split("\n");
    let firstDelta = 0;
    let total = 0;
    const shifted = lines.map((line, i) => {
      if (dedent) {
        const lead = /^[ \t]*/.exec(line)![0];
        const drop = Math.min(lead.length, lead.startsWith("\t") ? 1 : width);
        if (i === 0) firstDelta = -drop;
        total -= drop;
        return line.slice(drop);
      }
      if (line === "" && i === lines.length - 1) return line; // never indent a trailing empty line
      if (i === 0) firstDelta = width;
      total += width;
      return " ".repeat(width) + line;
    });
    const text = shifted.join("\n");
    if (text === before) return null;
    return {
      start: from,
      end: to,
      text,
      selStart: Math.max(from, selStart + firstDelta),
      selEnd: Math.max(from, selEnd + total),
    };
  }
  const lineStart = value.lastIndexOf("\n", selStart - 1) + 1;
  if (dedent) {
    const lead = /^[ \t]*/.exec(value.slice(lineStart))![0];
    const drop = Math.min(lead.length, lead.startsWith("\t") ? 1 : width);
    if (drop === 0) return null;
    return { start: lineStart, end: lineStart + drop, text: "", selStart: Math.max(lineStart, selStart - drop), selEnd: Math.max(lineStart, selEnd - drop) };
  }
  const col = selStart - lineStart;
  const n = width - (col % width);
  const caret = selStart + n;
  return { start: selStart, end: selEnd, text: " ".repeat(n), selStart: caret, selEnd: caret };
}

/**
 * Enter keeps the block you are in: the new line starts at the current line's
 * indentation, one level deeper after a line that opens a block. Without this
 * Tab is only half a keyboard — every new line would start back at column 0.
 */
export function enterEdit(value: string, selStart: number, selEnd: number, width: number, language: string): TextEdit {
  const lineStart = value.lastIndexOf("\n", selStart - 1) + 1;
  const line = value.slice(lineStart, selStart);
  const lead = /^[ \t]*/.exec(line)![0];
  const opens = rLike(language) ? /\{\s*$/.test(line) : /:\s*$/.test(line);
  const text = `\n${lead}${opens ? " ".repeat(width) : ""}`;
  const caret = selStart + text.length;
  return { start: selStart, end: selEnd, text, selStart: caret, selEnd: caret };
}
