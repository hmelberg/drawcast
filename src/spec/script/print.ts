// { meta, pages } → text. The printer is the parser's mirror: every form it
// writes, parse.ts reads back into the same spec, which tests/script-roundtrip
// holds it to over the whole bundled corpus.
import { dump } from "js-yaml";
import { fieldLines, formatValue } from "./values";
import { COMMAND_ORDER, ELEMENT_ORDER, LIST_VERBS, OBJECT_VERBS, SCALAR_VERBS, TARGET_FIELD, TARGET_VERBS } from "./parse";
import { AROUND_FIELD, ELEMENT_ALIASES, FLAG_FOR, LAYOUT_HEADS, PLACE_WORDS, SIDE_TYPES, isColor } from "./sugar";

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
const BEAT_FIELDS = new Set(["speak", "voice", "label", "cue"]);

const yaml = (v: unknown): string => dump(v, { lineWidth: -1, noRefs: true }).trimEnd();

/**
 * `key value` pairs for everything in `obj` except the keys named, in a fixed
 * order. Object insertion order is NOT it: a reparsed spec builds its fields
 * in the order the grammar read them, so printing by insertion order would
 * make a second print differ from the first without anything having changed.
 */
function pairs(obj: Record<string, unknown>, skip: Set<string>, order: string[] = ELEMENT_ORDER, skipPaths: Set<string> = new Set()): string {
  const rank = (k: string): number => {
    const i = order.indexOf(k);
    return i === -1 ? order.length : i;
  };
  const lines: { path: string; token: string }[] = [];
  for (const k of Object.keys(obj)) {
    if (skip.has(k) || obj[k] === undefined) continue;
    for (const fl of fieldLines(k, obj[k])) if (!skipPaths.has(fl.path)) lines.push(fl);
  }
  // Sorted by the schema's order at the top level, then by the whole path —
  // so a nested `style.dash` never trades places with `style.color` between
  // one print and the next.
  lines.sort((a, b) => rank(a.path.split(".")[0]) - rank(b.path.split(".")[0]) || a.path.localeCompare(b.path));
  return lines.map(({ path, token }) => `${path} ${token}`).join(" ");
}

/** node shape → the alias that says it. Built from the table, not beside it. */
const ALIAS_FOR = new Map<string, string>(
  Object.entries(ELEMENT_ALIASES)
    .filter(([, a]) => a.fields?.shape !== undefined)
    .map(([word, a]) => [`${a.type}:${String(a.fields!.shape)}`, word]),
);

/** Element types written under a shorter name of their own. */
const HEAD_FOR: Record<string, string> = { point: "dot", annotation: "mark" };

/** The layout word a group is written under, when it has one. */
function layoutHead(el: SpecElement): string | null {
  const layout = (el as unknown as Record<string, unknown>).layout;
  return el.type === "group" && typeof layout === "string" && LAYOUT_HEADS[layout] !== undefined ? layout : null;
}

/**
 * The shorthands an element can be written with, and the fields they eat.
 * Reversible by construction: a word is emitted only when the field holds
 * EXACTLY the value that word means — which is what the corpus gate checks,
 * 258 times over, every run.
 */
function shorthands(el: SpecElement): { words: string[]; used: Set<string>; eaten: Set<string> } {
  const words: string[] = [];
  const used = new Set<string>();
  const e = el as unknown as Record<string, unknown>;
  const at = e.at as Record<string, unknown> | undefined;

  // `a -> b`, when both ends are plain refs and carry nothing else.
  const end = (v: unknown): string | null => {
    if (!v || typeof v !== "object" || Array.isArray(v)) return null;
    const keys = Object.keys(v as object);
    return keys.length === 1 && keys[0] === "ref" ? String((v as { ref: unknown }).ref) : null;
  };
  const from = end(e.from), to = end(e.to);
  if (from !== null && to !== null) { words.push(from, "->", to); used.add("from"); used.add("to"); }

  // A layout group is headed by its layout word, and its membership is
  // written by the block it encloses or by each member's `in`.
  if (el.type === "group" && typeof e.layout === "string" && LAYOUT_HEADS[e.layout] !== undefined) {
    used.add("layout");
    used.add("members");
  }

  // What a border wraps.
  const aroundField = AROUND_FIELD[el.type];
  if (aroundField !== undefined && Array.isArray(e[aroundField])) {
    words.push("around", ...(e[aroundField] as string[]));
    used.add(aroundField);
  }

  // Placement, in words.
  if (at && typeof at.place === "string" && Object.keys(at).length === 1) {
    const word = [...PLACE_WORDS].find(([, anchor]) => anchor === at.place)?.[0];
    if (word !== undefined) { words.push(word); used.add("at"); }
  } else if (at && typeof at.side === "string" && typeof at.ref === "string" && Object.keys(at).every((k) => ["side", "ref", "gap"].includes(k))) {
    words.push(at.side, at.ref);
    if (typeof at.gap === "number") words.push("gap", String(at.gap));
    used.add("at");
  }
  if (SIDE_TYPES.has(el.type) && typeof e.side === "string" && at === undefined) { words.push(e.side); used.add("side"); }

  // Flags and colours, in a fixed order so a reprint never reshuffles them.
  const style = e.style as Record<string, unknown> | undefined;
  const draw = e.draw as Record<string, unknown> | undefined;
  const eaten = new Set<string>();
  for (const [path, value] of [["curved", e.curved], ["smooth", e.smooth], ["closed", e.closed],
    ["direction", e.direction], ["curvature", e.curvature], ["steepness", e.steepness],
    ["draw.mode", draw?.mode], ["style.dash", style?.dash], ["style.stroke_width", style?.stroke_width]] as [string, unknown][]) {
    if (value === undefined) continue;
    const word = FLAG_FOR.get(`${path}=${JSON.stringify(value)}`);
    if (word === undefined) continue;
    words.push(word);
    if (path.startsWith("style.")) eaten.add(`style.${path.slice(6)}`);
    else if (path.startsWith("draw.")) eaten.add(path);
    else used.add(path);
  }
  if (typeof style?.color === "string" && isColor(style.color)) { words.push(style.color); eaten.add("style.color"); }
  if (typeof draw?.duration === "number" && eaten.has("draw.mode")) { words.push(`${draw.duration}s`); eaten.add("draw.duration"); }

  // Whatever a word already said is not said again as a pair — `dashed` and
  // `style.dash true` on one line would both round-trip and both be noise.
  return { words, used, eaten };
}

/** One element, as the line that declares it. */
function elementLine(el: SpecElement, hidden: boolean, indent: string = INDENT, inGroup?: string): string {
  const { words, used, eaten } = el.type === "code"
    ? { words: [] as string[], used: new Set<string>(), eaten: new Set<string>() }
    : shorthands(el);
  const shapeAlias = ALIAS_FOR.get(`${el.type}:${String((el as unknown as Record<string, unknown>).shape ?? "")}`);
  const skip = new Set(["id", "type", "text", "language", "code", ...used]);
  if (shapeAlias !== undefined) skip.add("shape");
  const rest = pairs(el as unknown as Record<string, unknown>, skip, ELEMENT_ORDER, eaten);
  if (el.type === "code") {
    // `code` is the head when the element names no language — a fence must
    // always say what it is, and no runtime is called "code".
    const info = ["```" + (el.language ?? "code"), el.id, rest, el.code === "" ? 'code ""' : "", hidden ? "hidden true" : ""].filter(Boolean).join(" ");
    const body = (el.code ?? "").split("\n").map((l) => (l === "" ? l : indent + l)).join("\n");
    return `${indent}${info}\n${body}\n${indent}\`\`\``;
  }
  const head = shapeAlias ?? layoutHead(el) ?? HEAD_FOR[el.type] ?? el.type;
  // Always quoted: the parser recognizes the positional text BY its quote, so
  // a text that needs no quotes would read back as a stray key.
  const text = typeof el.text === "string" ? ` ${JSON.stringify(el.text)}` : "";
  const tail = [words.join(" "), rest, inGroup !== undefined ? `in ${inGroup}` : "", hidden ? "hidden true" : ""].filter(Boolean).join(" ");
  return `${indent}${head} ${el.id}${text}${tail === "" ? "" : ` ${tail}`}`;
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
  const tail = pairs(extra, new Set(), COMMAND_ORDER);
  const join = (line: string): string => `${INDENT}${[line, tail].filter(Boolean).join(" ")}`;
  if (LIST_VERBS.has(head)) return [join(`${head} ${([] as string[]).concat(value as string[]).join(" ")}`)];
  if (TARGET_VERBS.has(head)) {
    const args = { ...(value as Record<string, unknown>) };
    const field = TARGET_FIELD[head];
    const target = ([] as string[]).concat((args[field] as string[]) ?? []);
    delete args[field];
    const more = Object.keys(args).length > 0 ? verbArgs(head, args) : "";
    return [join([head, target.join(" "), more].filter(Boolean).join(" "))];
  }
  if (head === "quiz" && value !== null && typeof value === "object") {
    // The choices become their own lines, `+` on the correct one.
    const args = { ...(value as Record<string, unknown>) };
    const choices = (args.choices as string[] | undefined) ?? [];
    const correct = args.correct as number | undefined;
    delete args.choices;
    delete args.correct;
    const first = join(`quiz ${verbArgs("quiz", args)}`.trim());
    return [first, ...choices.map((c, i) => `${INDENT}${INDENT}${i + 1 === correct ? "+" : "*"} ${c}`)];
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
function homes(spec: Spec, firstMention: Map<string, number>, drawLists: Map<number, string[]>, byId: Map<string, SpecElement>): { inline: Map<number, string[]>; props: string[] } {
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
      // A layout group is declared, never drawn, so it is not part of the
      // draw its beat's declarations have to rebuild.
      const drawn = ids.filter((id) => layoutHead(byId.get(id) ?? ({} as SpecElement)) === null);
      if (drawn.length === draw.length && drawn.every((id, k) => id === draw[k])) continue;
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
    // A CUED draw is written inside its sentence, so its elements cannot also
    // be declared by that beat — the declaration would carry no cue. They are
    // declared up front instead, and the inline action draws them.
    if (cmd.cue !== undefined) return;
    for (const id of ([] as string[]).concat(cmd.draw ?? [])) if (!out.has(id)) out.set(id, i);
  });
  // A layout group is never drawn, so it has no beat of its own — but it is
  // not a WALL in the ordering walk either. It belongs to the beat its LAST
  // member arrives in, which is where the parser writes it back: after them.
  for (const el of spec.elements ?? []) {
    if (layoutHead(el) === null) continue;
    const beats = ((el.members ?? []) as string[]).map((m) => out.get(m));
    if (beats.length > 0 && beats.every((b) => b !== undefined)) out.set(el.id, Math.max(...(beats as number[])));
  }
  return out;
}

export function printScriptPage(spec: Spec): string {
  const byId = new Map((spec.elements ?? []).map((el) => [el.id, el]));
  // member id → the layout group it belongs to.
  const groupOf = new Map<string, string>();
  for (const el of spec.elements ?? []) {
    if (layoutHead(el) === null) continue;
    for (const m of (el.members ?? []) as string[]) groupOf.set(m, el.id);
  }
  const mention = firstDraws(spec);
  const drawLists = new Map<number, string[]>();
  (spec.commands ?? []).forEach((cmd, i) => {
    if (cmd.draw !== undefined) drawLists.set(i, ([] as string[]).concat(cmd.draw));
  });
  const { inline, props } = homes(spec, mention, drawLists, byId);

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
    // `hidden` is what keeps a props declaration from minting a draw command
    // of its own, so everything here carries it — a group included.
    blocks.push(props.map((id) => elementLine(byId.get(id)!, true, INDENT, groupOf.get(id))).join("\n"));
  }

  // A cued command is written INSIDE the spoken line of the beat it belongs
  // to — the beat that carries the speak, which is the last one before it.
  const cuedOf = new Map<number, number[]>();
  let speakAt = -1;
  (spec.commands ?? []).forEach((cmd, i) => {
    if (cmd.speak !== undefined) speakAt = i;
    if (cmd.cue === undefined) return;
    if (cmd.speak !== undefined) { cuedOf.set(i, [...(cuedOf.get(i) ?? []), i]); return; }
    if (speakAt >= 0) cuedOf.set(speakAt, [...(cuedOf.get(speakAt) ?? []), i]);
  });
  const inlined = new Set([...cuedOf.values()].flat());

  (spec.commands ?? []).forEach((cmd, i) => {
    if (inlined.has(i) && cmd.speak === undefined) return;
    const lines: string[] = [];
    if (cmd.label !== undefined) lines.push(`@${cmd.label}`);
    if (cmd.speak !== undefined) {
      // Put each cued action back where it was written, from the end so the
      // earlier offsets are still valid as the line grows.
      let spoken = cmd.speak;
      const cued = [...(cuedOf.get(i) ?? [])].sort((a, b2) => (spec.commands![b2].cue ?? 0) - (spec.commands![a].cue ?? 0));
      for (const k of cued) {
        const at = Math.round((spec.commands![k].cue ?? 0) * cmd.speak.length);
        const action = commandLines(spec.commands![k])[0]?.trim() ?? "";
        const span = `(@${action}@)`;
        spoken = at === 0 ? `${span} ${spoken}` : `${spoken.slice(0, at)} ${span}${spoken.slice(at)}`;
      }
      lines.push(`${cmd.voice === "b" ? "B: " : cmd.voice === "a" ? "A: " : ""}${spoken}`);
    }
    const declared = inline.get(i) ?? [];
    if (declared.length > 0) {
      // The draw this beat's declarations ARE — printed as the elements, with
      // a layout group's members nested under the group's own line.
      const nested = new Set<string>();
      for (const id of declared) {
        if (layoutHead(byId.get(id) ?? ({} as SpecElement)) === null) continue;
        const members = ((byId.get(id)!.members ?? []) as string[]);
        // Nested only when the whole group arrives here; otherwise it is a
        // declared handle and each member says which group it is in.
        if (!members.every((m) => declared.includes(m))) continue;
        const group = id;
        lines.push(elementLine(byId.get(group)!, false));
        nested.add(group);
        for (const m of members) {
          const child = byId.get(m)!;
          lines.push(elementLine(child, false, INDENT + INDENT));
          nested.add(m);
          for (const gm of ((child.members ?? []) as string[])) {
            lines.push(elementLine(byId.get(gm)!, false, INDENT + INDENT + INDENT));
            nested.add(gm);
          }
        }
      }
      for (const id of declared) {
        if (nested.has(id)) continue;
        const el = byId.get(id)!;
        lines.push(elementLine(el, layoutHead(el) !== null, INDENT, groupOf.get(id)));
      }
      // What the declarations did not carry: `parallel`, a `duration` — beat
      // modifiers, printed as their own lines, which the parser folds back
      // into the draw the declarations rebuilt.
      const rest = Object.entries(cmd as unknown as Record<string, unknown>)
        .filter(([k, v]) => !BEAT_FIELDS.has(k) && k !== "draw" && v !== undefined);
      for (const [k, v] of rest) {
        for (const { path, token } of fieldLines(k, v)) lines.push(`${INDENT}${path} ${token}`);
      }
    } else if (cmd.cue === undefined) {
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
