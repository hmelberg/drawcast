// { meta, pages } → text. The printer is the parser's mirror: every form it
// writes, parse.ts reads back into the same spec, which tests/script-roundtrip
// holds it to over the whole bundled corpus.
import { dump } from "js-yaml";
import { fieldLines, formatValue } from "./values";
import { ELEMENT_HEADS, LIST_VERBS, OBJECT_VERBS, SCALAR_VERBS, TARGET_VERBS } from "./parse";
import type { Command, Spec, SpecElement } from "../types";

const INDENT = "    ";

/** The order settings print in — fixed, so a reprint never reshuffles a file's head. */
const SETTING_ORDER: [keyof Spec, string][] = [
  ["lang", "lang"], ["voice", "voice"], ["level", "level"], ["record", "record"],
  ["canvas", "canvas"], ["domain", "domain"], ["vars", "vars"], ["text", "text"],
  ["zoom_from", "zoom_from"], ["template", "use"], ["params", "with"],
];

/** Written by machines, read by nobody: they print last, so the readable part
 *  of the file stays on top — the rule specForDump already applies to YAML. */
const PAYLOAD_KEYS = ["assets", "subtitles", "text_map", "templates"] as const;

/** Fields a beat carries rather than a direction. */
const BEAT_FIELDS = new Set(["speak", "voice", "label"]);

const yaml = (v: unknown): string => dump(v, { lineWidth: -1, noRefs: true }).trimEnd();

/** `key value` pairs for everything in `obj` except the keys named. */
function pairs(obj: Record<string, unknown>, skip: Set<string>): string {
  const out: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    if (skip.has(k) || v === undefined) continue;
    for (const { path, token } of fieldLines(k, v)) out.push(`${path} ${token}`);
  }
  return out.join(" ");
}

/** One element, as the line that declares it. */
function elementLine(el: SpecElement, hidden: boolean): string {
  const rest = pairs(el as unknown as Record<string, unknown>, new Set(["id", "type", "text", "language", "code"]));
  if (el.type === "code") {
    const info = ["```" + (el.language ?? ""), el.id, rest, hidden ? "hidden true" : ""].filter(Boolean).join(" ");
    const body = (el.code ?? "").split("\n").map((l) => (l === "" ? l : INDENT + l)).join("\n");
    return `${INDENT}${info}\n${body}\n${INDENT}\`\`\``;
  }
  const head = el.type === "point" ? "dot" : el.type;
  // Always quoted: the parser recognizes the positional text BY its quote, so
  // a text that needs no quotes would read back as a stray key.
  const text = typeof el.text === "string" ? ` ${JSON.stringify(el.text)}` : "";
  const tail = [rest, hidden ? "hidden true" : ""].filter(Boolean).join(" ");
  return `${INDENT}${head} ${el.id}${text}${tail === "" ? "" : ` ${tail}`}`;
}

/** One command, as the direction line that carries it. */
function commandLines(cmd: Command): string[] {
  const entries = Object.entries(cmd as unknown as Record<string, unknown>).filter(([k, v]) => !BEAT_FIELDS.has(k) && v !== undefined);
  if (entries.length === 0) return [];
  const [head, value] = entries[0];
  const extra = Object.fromEntries(entries.slice(1));
  const tail = pairs(extra, new Set());
  const join = (line: string): string => `${INDENT}${[line, tail].filter(Boolean).join(" ")}`;
  if (LIST_VERBS.has(head)) return [join(`${head} ${([] as string[]).concat(value as string[]).join(" ")}`)];
  if (TARGET_VERBS.has(head)) {
    const args = { ...(value as Record<string, unknown>) };
    const target = ([] as string[]).concat((args.target as string[]) ?? []);
    delete args.target;
    return [join([head, target.join(" "), pairs(args, new Set())].filter(Boolean).join(" "))];
  }
  if (OBJECT_VERBS.has(head)) return [join(`${head} ${pairs(value as Record<string, unknown>, new Set())}`.trim())];
  if (SCALAR_VERBS.has(head)) {
    if (value === true) return [join(head)];
    if (head === "wait" && value === "click") return [join(head)];
    if (value !== null && typeof value === "object") return [join(`${head} ${pairs(value as Record<string, unknown>, new Set())}`)];
    return [join(`${head} ${formatValue(value)}`)];
  }
  // A verb the tables do not know: still printable, still readable back.
  return [join(`${head} ${pairs({ [head]: value }, new Set())}`.replace(`${head} ${head} `, `${head} `))];
}

/**
 * Which elements may be declared inline, and where. An element is declared at
 * its first mention — but `elements` order is not provably inert (drawing
 * order, label collision), so it is preserved: walking the array, an element
 * whose first mention comes BEFORE one already placed would reorder the
 * array, and goes to the props block instead. Measured: 92 of 121 corpus
 * specs (76%) need no props block at all.
 */
function homes(spec: Spec, firstMention: Map<string, number>): { inline: Map<number, string[]>; props: string[] } {
  const els = spec.elements ?? [];
  // The props block prints ABOVE every beat, so whatever goes in it comes
  // first when the text is read back. The inline elements are therefore the
  // longest SUFFIX of the array whose first-draw beats never go backwards;
  // everything before that suffix — including anything never drawn at all —
  // is the prefix that has to be declared in the block.
  let start = els.length;
  let prevBeat = Infinity;
  for (let i = els.length - 1; i >= 0; i--) {
    const beat = firstMention.get(els[i].id);
    if (beat === undefined || beat > prevBeat) break;
    prevBeat = beat;
    start = i;
  }
  const props = els.slice(0, start).map((e) => e.id);
  const inline = new Map<number, string[]>();
  for (const el of els.slice(start)) {
    const beat = firstMention.get(el.id)!;
    inline.set(beat, [...(inline.get(beat) ?? []), el.id]);
  }
  return { inline, props };
}

/** For each element id, the index of the command that first DRAWS it. */
function firstDraws(spec: Spec): Map<string, number> {
  const out = new Map<string, number>();
  (spec.commands ?? []).forEach((cmd, i) => {
    for (const id of ([] as string[]).concat(cmd.draw ?? [])) if (!out.has(id)) out.set(id, i);
  });
  return out;
}

export function printScriptPage(spec: Spec): string {
  const byId = new Map((spec.elements ?? []).map((el) => [el.id, el]));
  const mention = firstDraws(spec);
  const { inline, props } = homes(spec, mention);
  const blocks: string[] = [];

  const settings: string[] = [];
  for (const [field, name] of SETTING_ORDER) {
    const v = spec[field];
    if (v !== undefined) settings.push(`${name}: ${formatValue(v)}`);
  }
  if (settings.length > 0) blocks.push(settings.join("\n"));

  if (props.length > 0) {
    blocks.push(props.map((id) => elementLine(byId.get(id)!, !mention.has(id))).join("\n"));
  }

  (spec.commands ?? []).forEach((cmd, i) => {
    const lines: string[] = [];
    if (cmd.label !== undefined) lines.push(`@${cmd.label}`);
    if (cmd.speak !== undefined) lines.push(`${cmd.voice === "b" ? "B: " : cmd.voice === "a" ? "A: " : ""}${cmd.speak}`);
    const declared = inline.get(i) ?? [];
    if (declared.length > 0) {
      // The draw this beat's declarations ARE — printed as the elements.
      for (const id of declared) lines.push(elementLine(byId.get(id)!, false));
      const rest: Command = { ...cmd };
      delete rest.draw;
      delete rest.speak;
      delete rest.voice;
      delete rest.label;
      lines.push(...commandLines(rest));
    } else {
      lines.push(...commandLines(cmd));
    }
    if (lines.length > 0) blocks.push(lines.join("\n"));
  });

  for (const key of PAYLOAD_KEYS) {
    const v = (spec as unknown as Record<string, unknown>)[key];
    if (v === undefined) continue;
    blocks.push(key === "assets" ? "```assets\n" + yaml(v) + "\n```" : "```yaml\n" + yaml({ [key]: v }) + "\n```");
  }

  return blocks.join("\n\n") + "\n";
}

export function printScriptPages(meta: Record<string, unknown>, pages: { spec: Spec }[]): string {
  const multi = pages.length > 1;
  const head: string[] = [];
  if (multi && typeof meta.title === "string") head.push(`# ${meta.title}`);
  const body = pages.map((p) => {
    const text = printScriptPage(p.spec);
    if (!multi) return typeof p.spec.title === "string" ? `# ${p.spec.title}\n\n${text}` : text;
    return typeof p.spec.title === "string" ? `## ${p.spec.title}\n${text}` : text;
  });
  // The cast title stands alone, a blank line above the first page.
  return [...head.map((h) => `${h}\n`), ...body].join("\n").replace(/\n{3,}/g, "\n\n");
}
