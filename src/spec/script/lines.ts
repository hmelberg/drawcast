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
  | { kind: "speech"; line: number; text: string; voice?: "a" | "b" }
  | { kind: "direction"; line: number; indent: number; head: string; rest: string }
  | { kind: "fence"; line: number; indent: number; info: string; body: string };

/**
 * The closed set of column-0 `key: value` lines. Closed on purpose: a spoken
 * line may perfectly well begin "Kort sagt:", and the only thing that keeps
 * that from being read as a setting is that `Kort sagt` is not in this list.
 */
export const SETTING_KEYS = [
  // page
  "lang", "voice", "level", "record", "canvas", "domain", "vars", "text", "zoom_from", "use", "with", "chapter",
  // playlist (before the first page)
  "subtitle", "advance", "gap", "transitions", "next", "enroll", "prompt", "comments", "views",
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
    if (dialogue) { out.push({ kind: "speech", line, text: dialogue[2].trim(), voice: dialogue[1].toLowerCase() as "a" | "b" }); continue; }
    out.push({ kind: "speech", line, text: body });
  }
  return out;
}
