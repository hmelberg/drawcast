// The scanner: a drawcast script's text, one typed line at a time. It knows
// the SHAPE of a line — voice or machine, heading or setting — and nothing
// about specs, elements or verbs. Indentation is the whole grammar: column 0
// is the voice, anything indented is a stage direction, and a deeper indent
// belongs to the direction above it (which the parser resolves, not this).
export type ScriptLine =
  | { kind: "blank"; line: number }
  | { kind: "comment"; line: number }
  | { kind: "heading"; line: number; depth: 1 | 2; text: string }
  | { kind: "setting"; line: number; key: string; rest: string }
  | { kind: "goto"; line: number; name: string }
  | { kind: "speech"; line: number; text: string; voice?: "a" | "b"; actions?: InlineAction[] }
  | { kind: "direction"; line: number; indent: number; head: string; rest: string }
  | { kind: "fence"; line: number; indent: number; info: string; body: string };

/**
 * The closed set of column-0 `key: value` lines. Closed on purpose: a spoken
 * line may perfectly well begin "Kort sagt:", and the only thing that keeps
 * that from being read as a setting is that `Kort sagt` is not in this list.
 */
/** An action written inside a spoken line, and where it sat in it. */
export interface InlineAction {
  head: string;
  rest: string;
  /** Characters of SPOKEN text before it — the span itself is not spoken. */
  offset: number;
}

/** Thrown for a span that is opened and never closed. */
export class ScanError extends Error {
  constructor(message: string, readonly line: number) {
    super(`line ${line}: ${message}`);
    this.name = "ScanError";
  }
}

const OPEN = "(@";
const CLOSE = "@)";

/**
 * Lift `(@ … @)` out of a spoken line. What is left is what gets said; each
 * action remembers how many spoken characters came before it, which is what
 * makes it a TIME rather than a second way of writing the same direction.
 *
 * `(@` opens an action only when a word follows it, so a parenthesis and an
 * at-sign in ordinary prose need no escape.
 */
function liftActions(text: string, line: number): { text: string; actions?: InlineAction[] } {
  if (!text.includes(OPEN)) return { text };
  const actions: InlineAction[] = [];
  let spoken = "";
  let i = 0;
  while (i < text.length) {
    const open = text.indexOf(OPEN, i);
    if (open === -1 || !/^[A-Za-z_]/.test(text.slice(open + OPEN.length))) {
      spoken += text.slice(i);
      break;
    }
    const close = text.indexOf(CLOSE, open);
    if (close === -1) throw new ScanError(`an action opened with "(@" is never closed with "@)"`, line);
    // The span, and the space in front of it, leave the spoken line together.
    let upto = open;
    if (upto > i && text[upto - 1] === " ") upto -= 1;
    spoken += text.slice(i, upto);
    const body = text.slice(open + OPEN.length, close).trim();
    const space = body.indexOf(" ");
    actions.push({
      head: space === -1 ? body : body.slice(0, space),
      rest: space === -1 ? "" : body.slice(space + 1).trim(),
      offset: spoken.length,
    });
    i = close + CLOSE.length;
    // A span at the very start leaves its trailing space behind too.
    if (spoken.length === 0 && text[i] === " ") i += 1;
  }
  return actions.length > 0 ? { text: spoken, actions } : { text };
}

export const SETTING_KEYS = [
  // page
  "lang", "voice", "level", "record", "canvas", "domain", "vars", "text", "zoom_from", "use", "with", "details", "sources", "chapter",
  // playlist (before the first page)
  "subtitle", "advance", "gap", "transitions", "next", "enroll", "prompt", "comments", "views", "poster",
] as const;

const SETTING_RE = new RegExp(`^(${SETTING_KEYS.join("|")}):(?:\\s+(.*))?$`);
const HEADING_RE = /^(#{1,2})\s+(.*)$/;
const GOTO_RE = /^@([A-Za-z_][\w-]*)\s*$/;
const DIALOGUE_RE = /^([AB]):\s+(.*)$/;
const FENCE_RE = /^```(.*)$/;

const TAB_WIDTH = 4;
const expand = (s: string): string => s.replace(/\t/g, " ".repeat(TAB_WIDTH));

export function scanLines(text: string): ScriptLine[] {
  const raw = text.replace(/\r\n?/g, "\n").split("\n");
  const out: ScriptLine[] = [];
  for (let i = 0; i < raw.length; i++) {
    const line = i + 1;
    const src = expand(raw[i]);
    const body = src.trim();
    if (body === "") {
      // The empty string after a trailing newline is not a blank line of its own.
      if (i < raw.length - 1 || raw[i] !== "") out.push({ kind: "blank", line });
      continue;
    }
    const indent = src.length - src.trimStart().length;
    {
      const fence = FENCE_RE.exec(body);
      if (fence) {
        const info = fence[1].trim();
        const lines: string[] = [];
        let j = i + 1;
        for (; j < raw.length; j++) {
          const candidate = expand(raw[j]);
          if (FENCE_RE.test(candidate.trim())) break;
          lines.push(candidate.slice(indent));
        }
        out.push({ kind: "fence", line, indent, info, body: lines.join("\n") });
        i = j; // skip the closing fence
        continue;
      }
    }
    if (indent > 0) {
      const space = body.indexOf(" ");
      out.push({
        kind: "direction",
        line,
        indent,
        head: space === -1 ? body : body.slice(0, space),
        rest: space === -1 ? "" : body.slice(space + 1).trim(),
      });
      continue;
    }
    if (body.startsWith("//")) { out.push({ kind: "comment", line }); continue; }
    const heading = HEADING_RE.exec(body);
    if (heading) { out.push({ kind: "heading", line, depth: heading[1].length as 1 | 2, text: heading[2].trim() }); continue; }
    const goto = GOTO_RE.exec(body);
    if (goto) { out.push({ kind: "goto", line, name: goto[1] }); continue; }
    const setting = SETTING_RE.exec(body);
    if (setting) { out.push({ kind: "setting", line, key: setting[1], rest: (setting[2] ?? "").trim() }); continue; }
    const dialogue = DIALOGUE_RE.exec(body);
    if (dialogue) { out.push({ kind: "speech", line, ...liftActions(dialogue[2].trim(), line), voice: dialogue[1].toLowerCase() as "a" | "b" }); continue; }
    out.push({ kind: "speech", line, ...liftActions(body, line) });
  }
  return out;
}
