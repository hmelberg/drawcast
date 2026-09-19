// { meta, pages } → text. The printer is the parser's mirror: every form it
// writes, parse.ts reads back into the same spec, which tests/script-roundtrip
// holds it to over the whole bundled corpus.
import { dump } from "js-yaml";
import { fieldLines, formatValue } from "./values";
import { LIST_VERBS, OBJECT_VERBS, SCALAR_VERBS, TARGET_VERBS } from "./parse";

/** The keys that can head a direction line. Everything else in a command
 *  rides along as a modifier on the same line. */
const MAIN_VERBS = new Set<string>([...LIST_VERBS, ...TARGET_VERBS, ...OBJECT_VERBS, ...SCALAR_VERBS]);
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
    // `code` is the head when the element names no language — a fence must
    // always say what it is, and no runtime is called "code".
    const info = ["```" + (el.language ?? "code"), el.id, rest, el.code === "" ? 'code ""' : "", hidden ? "hidden true" : ""].filter(Boolean).join(" ");
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

/**
 * A verb's arguments after its head. The SAME flattenability rule the parser
 * relies on: simple keys become `key value` pairs, anything else (an animate
 * map whose keys are dot paths, a colours map keyed by TeX) stays one JSON
 * token — flattening those would split a literal key on its own dot.
 */
function verbArgs(head: string, value: unknown): string {
  const fl = fieldLines(head, value);
  if (fl.length === 1 && fl[0].path === head) return fl[0].token;
  return fl.map(({ path, token }) => `${path.slice(head.length + 1)} ${token}`).join(" ");
}

/** One command, as the direction line that carries it. */
function commandLines(cmd: Command): string[] {
  const entries = Object.entries(cmd as unknown as Record<string, unknown>).filter(([k, v]) => !BEAT_FIELDS.has(k) && v !== undefined);
  if (entries.length === 0) return [];
  // The verb heads the line wherever it sits in the object; `{duration: 3,
  // animate: {...}}` is an animate line, not a duration line.
  const at = Math.max(0, entries.findIndex(([k]) => MAIN_VERBS.has(k)));
  const [head, value] = entries[at];
  const extra = Object.fromEntries(entries.filter((_, i) => i !== at));
  const tail = pairs(extra, new Set());
  const join = (line: string): string => `${INDENT}${[line, tail].filter(Boolean).join(" ")}`;
  if (LIST_VERBS.has(head)) return [join(`${head} ${([] as string[]).concat(value as string[]).join(" ")}`)];
  if (TARGET_VERBS.has(head)) {
    const args = { ...(value as Record<string, unknown>) };
    const target = ([] as string[]).concat((args.target as string[]) ?? []);
    delete args.target;
    const more = Object.keys(args).length > 0 ? verbArgs(head, args) : "";
    return [join([head, target.join(" "), more].filter(Boolean).join(" "))];
  }
  if (OBJECT_VERBS.has(head) || SCALAR_VERBS.has(head)) {
    if (value === true && head !== "pause") return [join(head)];
    if (head === "wait" && value === "click") return [join(head)];
    if (value !== null && typeof value === "object") {
      if (!Array.isArray(value) && Object.keys(value as object).length === 0) return [join(head)];
      return [join(`${head} ${verbArgs(head, value)}`.trim())];
    }
    // A string value is quoted even when it need not be: the parser tells a
    // verb's VALUE from its first KEY by the quote, and a notation string
    // ("C4:h") is a perfectly good bare word.
    return [join(`${head} ${typeof value === "string" ? JSON.stringify(value) : formatValue(value)}`)];
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
function homes(spec: Spec, firstMention: Map<string, number>, drawLists: Map<number, string[]>): { inline: Map<number, string[]>; props: string[] } {
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
  // A beat's declarations ARE its draw command, so they may only be used when
  // they rebuild it exactly — same ids, same order. A draw that also names
  // something declared elsewhere (or minted by a code element) keeps its own
  // line, and its elements move to the props block. Measured: no corpus draw
  // mixes first-drawn and already-drawn ids, so this is a guard, not a path.
  for (;;) {
    const inline = new Map<number, string[]>();
    for (const el of els.slice(start)) {
      const beat = firstMention.get(el.id)!;
      inline.set(beat, [...(inline.get(beat) ?? []), el.id]);
    }
    let cut = -1;
    for (const [beat, ids] of inline) {
      const draw = drawLists.get(beat) ?? [];
      if (ids.length === draw.length && ids.every((id, k) => id === draw[k])) continue;
      for (const id of ids) cut = Math.max(cut, els.findIndex((e) => e.id === id));
    }
    if (cut === -1) return { inline, props: els.slice(0, start).map((e) => e.id) };
    start = cut + 1;
  }
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
  const drawLists = new Map<number, string[]>();
  (spec.commands ?? []).forEach((cmd, i) => {
    if (cmd.draw !== undefined) drawLists.set(i, ([] as string[]).concat(cmd.draw));
  });
  const { inline, props } = homes(spec, mention, drawLists);
  const blocks: string[] = [];

  const settings: string[] = [];
  for (const [field, name] of SETTING_ORDER) {
    const v = spec[field];
    if (v !== undefined) settings.push(`${name}: ${formatValue(v)}`);
  }
  if (settings.length > 0) blocks.push(settings.join("\n"));

  if (props.length > 0) {
    // ALWAYS hidden: a props declaration only declares. Whatever draws it
    // later keeps its own `draw` line, so declaring it visible here would
    // mint a second, phantom draw command at the top of the page.
    blocks.push(props.map((id) => elementLine(byId.get(id)!, true)).join("\n"));
  }

  (spec.commands ?? []).forEach((cmd, i) => {
    const lines: string[] = [];
    if (cmd.label !== undefined) lines.push(`@${cmd.label}`);
    if (cmd.speak !== undefined) lines.push(`${cmd.voice === "b" ? "B: " : cmd.voice === "a" ? "A: " : ""}${cmd.speak}`);
    const declared = inline.get(i) ?? [];
    if (declared.length > 0) {
      // The draw this beat's declarations ARE — printed as the elements.
      for (const id of declared) lines.push(elementLine(byId.get(id)!, false));
      // What the declarations did not carry: `parallel`, a `duration` — beat
      // modifiers, printed as their own lines, which the parser folds back
      // into the draw the declarations rebuilt.
      const rest = Object.entries(cmd as unknown as Record<string, unknown>)
        .filter(([k, v]) => !BEAT_FIELDS.has(k) && k !== "draw" && v !== undefined);
      for (const [k, v] of rest) {
        for (const { path, token } of fieldLines(k, v)) lines.push(`${INDENT}${path} ${token}`);
      }
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

/** Playlist-level settings, in the order they print. */
const META_ORDER = ["subtitle", "prompt", "comments", "views", "next", "enroll", "advance", "gap", "transitions"];

export function printScriptPages(meta: Record<string, unknown>, pages: { spec: Spec }[]): string {
  const multi = pages.length > 1;
  // One page takes the `#` for itself; several sit under the playlist's.
  const docTitle = multi ? meta.title : (pages[0]?.spec.title ?? meta.title);
  const head: string[] = [];
  if (typeof docTitle === "string") head.push(`# ${docTitle}`);
  for (const key of META_ORDER) {
    if (meta[key] !== undefined) head.push(`${key}: ${formatValue(meta[key])}`);
  }
  const body = pages.map((p) => {
    const text = printScriptPage(p.spec);
    return multi && typeof p.spec.title === "string" ? `## ${p.spec.title}\n${text}` : text;
  });
  const headBlock = head.length > 0 ? [`${head.join("\n")}\n`] : [];
  return [...headBlock, ...body].join("\n").replace(/\n{3,}/g, "\n\n");
}
