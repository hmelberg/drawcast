// The microdata emulator answers with ONE string. Figures and tables ride
// inside it as `__micro_transform_start_<type>__ … __micro_transform_end__`
// blocks (m2py.py's _log_embed), and a failed command is LOGGED as a
// "FEIL …" line rather than raised — so nothing here can be learned from an
// exception. This module pulls those three things apart.
//
// Dependency-free on purpose (the harvest.ts idiom): the runtime module
// only fetches the raw string, so every rule about what that string MEANS
// is node-testable without a browser.

import type { CodeTable } from "./envelope";

/** Written by m2py.py's _log_embed as "\n<start>\n<payload>\n<end>\n". */
const EMBED_RE = /__micro_transform_start_([a-z]+)__\n([\s\S]*?)\n__micro_transform_end__/g;

/**
 * A logged command failure. Case-SENSITIVE: m2py uppercases both catalogue's
 * prefix ("FEIL PÅ KOMMANDO", "ERROR ON COMMAND"), and matching loosely would
 * turn an innocent "Errors: 0" into a failed run. The \b stops "Feilverdier"
 * from matching. (The emulator's own /^\s*FEIL\b/i at index.html:5981 is for
 * styling, where a false positive costs a colour, not a repair round.)
 */
const ERROR_LINE_RE = /^[ \t]*((?:FEIL|ERROR)\b.*)$/m;

/** Rows kept per drawn table — pyodide.ts's own TABLE_CAP, for the same
 *  reason: the envelope is cached and travels, and layout draws 24 anyway. */
export const TABLE_ROW_CAP = 30;

export interface MicrodataOutput {
  /** Everything that was not an embed, plus markdown blocks, as printed. */
  stdout: string;
  /** One per `tabulate`/`summarize`-style command that printed a frame. */
  tables: CodeTable[];
  /** Plotly figure JSON, exactly as the shared renderer wants it. */
  figures: string[];
  /** The FIRST logged failure — a script fails where it first went wrong. */
  error?: string;
}

/** Strip surrounding blank lines without touching the first line's indent. */
function trimBlank(s: string): string {
  return s.replace(/^\n+/, "").replace(/\s+$/, "");
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

function decodeEntities(s: string): string {
  return s.replace(/&(#\d+|#x[0-9a-fA-F]+|[a-z]+);/g, (whole, name: string) => {
    if (name.startsWith("#x") || name.startsWith("#X")) return String.fromCodePoint(parseInt(name.slice(2), 16));
    if (name.startsWith("#")) return String.fromCodePoint(parseInt(name.slice(1), 10));
    return ENTITIES[name] ?? whole;
  });
}

/** Cell text: pandas puts only entities and the odd <br> inside a cell. */
function cellText(html: string): string {
  return decodeEntities(html.replace(/<[^>]*>/g, "")).replace(/\s+/g, " ").trim();
}

function cellsIn(rowHtml: string): string[] {
  const out: string[] = [];
  const re = /<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>/g;
  for (let m = re.exec(rowHtml); m; m = re.exec(rowHtml)) out.push(cellText(m[1]));
  return out;
}

/**
 * pandas' own `DataFrame.to_html` — never arbitrary HTML. A Series is written
 * with `header=False`, so the frame has NO thead; those columns come back as
 * one blank header per column, because the grid in layout/code.ts sizes its
 * columns from `columns.length` and would draw a one-column table otherwise.
 */
export function parseHtmlTable(html: string): CodeTable | null {
  const table = /<table\b[^>]*>([\s\S]*?)<\/table>/.exec(html);
  if (!table) return null;
  const body = table[1];
  const head = /<thead\b[^>]*>([\s\S]*?)<\/thead>/.exec(body);
  const columns = head ? cellsIn(head[1]) : [];
  const rowsHtml = head ? body.replace(head[0], "") : body;
  const rows: string[][] = [];
  const re = /<tr\b[^>]*>([\s\S]*?)<\/tr>/g;
  for (let m = re.exec(rowsHtml); m; m = re.exec(rowsHtml)) {
    const cells = cellsIn(m[1]);
    if (cells.length > 0) rows.push(cells);
  }
  const width = rows.reduce((w, r) => Math.max(w, r.length), columns.length);
  // `tabulate kommune` is 350-odd rows; the grid draws 24. Cap the envelope
  // (it is cached, and rides in a published cast) but COUNT what was dropped —
  // a table must never quietly claim to be the whole frame.
  const dropped = Math.max(0, rows.length - TABLE_ROW_CAP);
  return {
    columns: columns.length > 0 ? columns : Array.from({ length: width }, () => ""),
    rows: dropped > 0 ? rows.slice(0, TABLE_ROW_CAP) : rows,
    ...(dropped > 0 ? { truncated: dropped } : {}),
  };
}

export function parseMicrodataOutput(raw: string): MicrodataOutput {
  const texts: string[] = [];
  const tables: CodeTable[] = [];
  const figures: string[] = [];
  let last = 0;
  EMBED_RE.lastIndex = 0;
  for (let m = EMBED_RE.exec(raw); m; m = EMBED_RE.exec(raw)) {
    texts.push(raw.slice(last, m.index));
    last = m.index + m[0].length;
    const [, kind, payload] = m;
    if (kind === "figure") figures.push(payload.trim());
    else if (kind === "tablehtml") {
      const t = parseHtmlTable(payload);
      // A frame we cannot read is worth more as its own text than as silence.
      if (t) tables.push(t);
      else texts.push(payload);
    } else texts.push(payload);
  }
  texts.push(raw.slice(last));

  const stdout = texts.map(trimBlank).filter((t) => t !== "").join("\n\n");
  const err = ERROR_LINE_RE.exec(stdout);
  return { stdout, tables, figures, ...(err ? { error: err[1].trim() } : {}) };
}

/** `import fd/NAME …`, `import-event fd/NAME …`, `import-panel fd/NAME …` —
 *  the alias comes from an earlier `require`, so it is matched loosely and
 *  only the VARIABLE is returned. Comments start with `//`. */
const IMPORT_RE = /^[ \t]*import(?:-event|-panel)?[ \t]+[A-Za-z_][A-Za-z0-9_]*\/([A-Za-z][A-Za-z0-9_]*)/gm;

/**
 * The FDB variables a script says it imports, in order, each once.
 *
 * The emulator's mock-data engine invents a plausible column for ANY name, so
 * a hallucinated variable RUNS CLEAN — and a lesson built on it would teach a
 * variable that does not exist. Only the shipped catalogue can catch that, so
 * the runtime checks this list against it.
 */
export function importedVariables(code: string): string[] {
  const out: string[] = [];
  IMPORT_RE.lastIndex = 0;
  for (let m = IMPORT_RE.exec(code); m; m = IMPORT_RE.exec(code)) {
    if (!out.includes(m[1])) out.push(m[1]);
  }
  return out;
}

/** Real variables sharing an invented one's register prefix — the shortlist a
 *  repair round needs, instead of 736 names to guess among. */
function nearestVariables(name: string, catalog: Set<string>, limit = 4): string[] {
  const stem = name.split("_")[0];
  const out: string[] = [];
  for (const c of catalog) {
    if (c !== name && c.split("_")[0] === stem) out.push(c);
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * The message for a script that imports variables the shipped catalogue does
 * not have, or undefined when every name is real.
 *
 * An EMPTY catalogue judges nothing: a snapshot that failed to load must not
 * condemn a correct script.
 */
export function unknownVariableError(code: string, catalog: Set<string>): string | undefined {
  if (catalog.size === 0) return undefined;
  const unknown = importedVariables(code).filter((v) => !catalog.has(v));
  if (unknown.length === 0) return undefined;
  const parts = unknown.map((v) => {
    const near = nearestVariables(v, catalog);
    return near.length > 0 ? `${v} (did you mean ${near.join(", ")}?)` : v;
  });
  return `not in the microdata variable catalogue: ${parts.join("; ")}`;
}

/**
 * The package a failed command asked for, or null.
 *
 * Two shapes, because the emulator does not let a missing import surface as
 * a ModuleNotFoundError: it CATCHES the import and raises its own sentence,
 * in Norwegian or English, ending in `pip install <pkg>` (m2py.py:7224 for
 * plotly, :3873 statsmodels, :7002 lifelines). Matching only Python's wording
 * left every chart command broken — caught in a live browser run, not by a
 * unit test, which is why the fixture above is the real message.
 */
export function missingModule(text: string | undefined): string | null {
  if (!text) return null;
  const asked = /pip install ([A-Za-z0-9_.-]+)/.exec(text);
  const named = /No module named '([^']+)'/.exec(text);
  const pkg = asked?.[1] ?? named?.[1];
  return pkg ? pkg.split(".")[0] : null;
}
