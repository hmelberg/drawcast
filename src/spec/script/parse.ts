// lines → { meta, pages }. The three structural rules live here: a beat is a
// spoken line plus what is indented under it; one direction is one command,
// except that consecutive element declarations collapse into the single
// `draw` they describe; the spoken line rides on the beat's first command.
import { scanLines, type ScriptLine } from "./lines";
import { parseValue, setPath, splitTokens } from "./values";
import { specSchema } from "../schema";
import { AROUND_FIELD, ELEMENT_ALIASES, FLAGS, LAYOUT_HEADS, PLACE_WORDS, SHORTHAND_WORDS, SIDE_TYPES, SIDE_WORDS, isColor, seconds } from "./sugar";
import { CORE_SCHEMA, load } from "js-yaml";
import { isLanguage } from "../../code/languages";
import type { Command, Spec, SpecElement } from "../types";

export class ScriptError extends Error {
  constructor(message: string, readonly line: number) {
    super(`line ${line}: ${message}`);
    this.name = "ScriptError";
  }
}

export interface ScriptPage { spec: Spec }
export interface ParsedScript { meta: Record<string, unknown>; pages: ScriptPage[]; warnings: string[] }

const schemaProps = (path: "elements" | "commands"): string[] =>
  Object.keys(((specSchema as unknown as Record<string, { properties: Record<string, { items: { properties: Record<string, unknown> } }> }>).properties as unknown as Record<string, { items: { properties: Record<string, unknown> } }>)[path].items.properties);

/**
 * Every element type the spec knows, as heads — read off the schema so the
 * list cannot fall behind a new type. `point` is deliberately NOT a head: the
 * word is the laser verb (which is what a teacher means by it), so the
 * ELEMENT is declared as `dot`. That is disambiguation, not sugar.
 */
export const ELEMENT_HEADS = new Set<string>(
  ((specSchema as unknown as { properties: { elements: { items: { properties: { type: { enum: string[] } } } } } }).properties.elements.items.properties.type.enum).filter((t) => t !== "point"),
);

/** Verbs whose argument list is bare ids: the command field IS a list. */
export const LIST_VERBS = new Set(["draw", "show", "hide", "erase"]);
/** Verbs whose leading bare ids fill one field inside their object — the
 *  field differs (`flow` streams ALONG strokes, the rest act ON targets). */
export const TARGET_FIELD: Record<string, string> = {
  highlight: "target", focus: "target", move: "target", arrange: "target",
  fade: "target", flip: "target", morph: "target", keep: "target", flow: "along",
};
export const TARGET_VERBS = new Set(Object.keys(TARGET_FIELD));
/** Verbs whose whole argument set is an object with no positional part. */
export const OBJECT_VERBS = new Set(["point", "copy", "camera", "card", "clear", "quiz", "ask", "run", "explore", "if"]);
/** Verbs and beat modifiers that take one value (or stand alone). */
export const SCALAR_VERBS = new Set(["pause", "wait", "animate", "play"]);

/**
 * Fields that ride ALONG with a verb rather than being one: they belong to
 * the command, not to the verb's own arguments. `{animate: …, duration: 3}`
 * is one command, and so is `{play: …, reveal: [...], press: [...]}` — the
 * whole point of the split is that `duration 3` after `animate` must not
 * end up inside animate. A verb that declares the same name in its own
 * schema (camera's duration, highlight's duration) keeps it.
 */
export const MODIFIER_KEYS = new Set(["parallel", "blocking", "delivery", "duration", "easing", "ghost", "trail", "tempo", "instrument", "reveal", "press"]);

/** Every element field, and every command field: what ends an id run. The
 *  ARRAYS keep the schema's own order, which is the order the printer writes
 *  fields in — so a reprint never depends on the order an object happened to
 *  be built in. */
export const ELEMENT_ORDER = schemaProps("elements");
export const COMMAND_ORDER = schemaProps("commands");
export const ELEMENT_KEYS = new Set<string>(ELEMENT_ORDER);
export const COMMAND_KEYS = new Set<string>(COMMAND_ORDER);

/**
 * A verb's OWN argument names, off the schema — `highlight` stops an id run
 * at `effect`, `camera` at `zoom`. Top-level keys are not enough: `effect` is
 * a property of highlight's object, not of a command, so an id run that
 * stopped only at command keys would swallow it as a target.
 */
const ARG_KEYS = new Map<string, Set<string>>();
function argKeys(head: string): Set<string> {
  let keys = ARG_KEYS.get(head);
  if (!keys) {
    const props = (specSchema as unknown as { properties: { commands: { items: { properties: Record<string, { properties?: Record<string, unknown> }> } } } })
      .properties.commands.items.properties[head]?.properties;
    keys = new Set<string>(props ? Object.keys(props) : []);
    ARG_KEYS.set(head, keys);
  }
  return keys;
}

const isBareId = (t: string): boolean => /^[A-Za-z_][\w-]*$/.test(t);

/** Pairs whose key is a modifier the verb does not itself declare. */
function splitPairs(head: string, tokens: string[], line: number): { args: string[]; extra: string[] } {
  const args: string[] = [];
  const extra: string[] = [];
  const mine = argKeys(head);
  for (let i = 0; i < tokens.length; i += 2) {
    // `3s` stands alone: a duration, not the first half of a pair.
    const secs = seconds(tokens[i]);
    if (secs !== null) {
      (mine.has("duration") ? args : extra).push("duration", String(secs));
      i -= 1;
      continue;
    }
    if (i + 1 >= tokens.length) throw new ScriptError(`"${tokens[i]}" has no value`, line);
    const pair = [tokens[i], tokens[i + 1]];
    (MODIFIER_KEYS.has(tokens[i]) && !mine.has(tokens[i]) ? extra : args).push(...pair);
  }
  return { args, extra };
}

function keyValues(tokens: string[], into: Record<string, unknown>, line: number): void {
  for (let i = 0; i < tokens.length; i += 2) {
    const path = tokens[i];
    // `3s` stands alone: it is a duration, not the first half of a pair.
    const secs = seconds(path);
    if (secs !== null) { into.duration = secs; i -= 1; continue; }
    if (i + 1 >= tokens.length) throw new ScriptError(`"${path}" has no value`, line);
    setPath(into, path, parseValue(tokens[i + 1]));
  }
}

export interface Direction {
  element?: SpecElement;
  /** The indent the direction was written at — deeper is nested deeper. */
  indent?: number;
  /** Elements the direction minted alongside its own (a connector's label). */
  extra?: SpecElement[];
  command?: Record<string, unknown>;
  /** A beat modifier (`parallel true`): it joins the command being built. */
  modifier?: Record<string, unknown>;
  /** Where a deeper-indented continuation line writes. */
  args: Record<string, unknown>;
  /** A declaration the props block marked `hidden`: declared, not drawn. */
  hidden?: boolean;
  /** A layout group that collected its members from the block under it. It is
   *  a handle rather than ink — never drawn, and written to `elements` after
   *  the members it owns. A group written the old way is untouched. */
  encloses?: boolean;
}

export function parseDirection(head: string, rest: string, line: number, warn: (msg: string) => void = () => {}): Direction {
  const tokens = splitTokens(rest);
  const alias = ELEMENT_ALIASES[head];
  const type = alias?.type ?? head;
  if (alias !== undefined || ELEMENT_HEADS.has(head)) {
    const el: Record<string, unknown> = { ...(alias?.fields ?? {}) };
    let rest2 = [...tokens];
    // `a -> b`: the connector's ends, read before anything else so the ids
    // around the arrow are never mistaken for the element's own id.
    const arrow = rest2.indexOf("->");
    if (arrow > 0) {
      setPath(el, "from.ref", rest2[arrow - 1]);
      setPath(el, "to.ref", rest2[arrow + 1]);
      const id = arrow >= 2 ? rest2[0] : undefined;
      rest2 = [...(id !== undefined ? [id] : []), ...rest2.slice(arrow + 2)];
    }
    // `around d1 d2 d3`: what a border wraps, read like a verb's id run so a
    // cluster needs no group invented for it.
    const around = rest2.indexOf("around");
    if (around >= 0 && AROUND_FIELD[type] !== undefined) {
      const ids: string[] = [];
      let k = around + 1;
      while (rest2[k] !== undefined && isBareId(rest2[k]) && !ELEMENT_KEYS.has(rest2[k])) ids.push(rest2[k++]);
      el[AROUND_FIELD[type]] = ids;
      rest2 = [...rest2.slice(0, around), ...rest2.slice(k)];
    }
    let i = 0;
    // The id is the first bare token, full stop. Element fields make perfectly
    // good ids (`slope`, `text`, `line`), and an element always has one.
    if (rest2[0] !== undefined && isBareId(rest2[0]) && FLAGS[rest2[0]] === undefined && !isColor(rest2[0]) && !SIDE_WORDS.has(rest2[0]) && !PLACE_WORDS.has(rest2[0])) {
      el.id = rest2[i++];
    } else if (rest2[0] !== undefined && isBareId(rest2[0]) && SHORTHAND_WORDS.has(rest2[0]) && rest2[1]?.startsWith('"')) {
      // Plainly meant as an id — but it is also a word the grammar owns, so
      // say so rather than quietly reading it as placement or style (§11).
      warn(`line ${line}: "${rest2[0]}" is also a placement or style word — it is being used as an id here`);
      el.id = rest2[i++];
    }
    if (rest2[i] !== undefined && rest2[i].startsWith('"')) el.text = parseValue(rest2[i++]);
    const pairs: string[] = [];
    for (let k = i; k < rest2.length; k++) {
      const tok = rest2[k];
      // Flags come first, because `curved`, `smooth` and `closed` are BOTH
      // shorthand words and real field names — written long (`curved true`)
      // they are a pair, written alone they are the flag.
      const flag = FLAGS[tok];
      if (flag) {
        const next = rest2[k + 1];
        if (ELEMENT_KEYS.has(tok) && (next === "true" || next === "false")) { pairs.push(tok, rest2[++k]); continue; }
        setPath(el, flag[0], flag[1]);
        continue;
      }
      // Placement words come before the key check too: `right` is BOTH a
      // side word and a real field (the right-angle square on an `angle`),
      // so `right win2` is a placement and `right true` is a pair.
      if (SIDE_WORDS.has(tok) || PLACE_WORDS.has(tok)) {
        const next = rest2[k + 1];
        const asKey = ELEMENT_KEYS.has(tok) && (next === "true" || next === "false");
        if (!asKey) {
          if (SIDE_WORDS.has(tok) && next !== undefined && isBareId(next) && !ELEMENT_KEYS.has(next) && FLAGS[next] === undefined && !SIDE_WORDS.has(next) && !PLACE_WORDS.has(next)) {
            setPath(el, "at.side", tok);
            setPath(el, "at.ref", next);
            k++;
            continue;
          }
          if ((SIDE_TYPES.has(type) || type === "arrow" || type === "edge") && SIDE_WORDS.has(tok)) { setPath(el, "side", tok); continue; }
          setPath(el, "at.place", PLACE_WORDS.get(tok) ?? tok);
          continue;
        }
      }
      // `gap` right after a placement phrase belongs to the placement —
      // `above bedr gap 20` is one phrase. A group's OWN gap (the space in a
      // row) has no placement in front of it, so the two never collide.
      // `in <group>`: membership, resolved when the page is finished so the
      // group may be declared later in the file.
      if (tok === "in" && rest2[k + 1] !== undefined) {
        el["@in"] = rest2[++k];
        continue;
      }
      if (tok === "gap" && el.at !== undefined && rest2[k + 1] !== undefined) {
        setPath(el, "at.gap", parseValue(rest2[++k]));
        continue;
      }
      // A KEY takes the next token as its value, and that value is never
      // read as a shorthand — `style.color red` is a pair, and the `red` in
      // it is not also a standalone colour word.
      if (tok.includes(".") || ELEMENT_KEYS.has(tok)) {
        if (rest2[k + 1] === undefined) throw new ScriptError(`"${tok}" has no value`, line);
        pairs.push(tok, rest2[++k]);
        continue;
      }
      if (isColor(tok)) { setPath(el, "style.color", tok); continue; }
      const secs = seconds(tok);
      if (secs !== null) { setPath(el, "draw.duration", secs); continue; }
      pairs.push(tok);
    }
    keyValues(pairs, el, line);
    // Named after what was WRITTEN, not what it became: `row_4` reads better
    // than `group_4`, and a `box` is a node.
    if (typeof el.id !== "string") el.id = `${head}_${line}`;
    const hidden = el.hidden === true;
    delete el.hidden;
    // A connector's quoted text is the label ON it: the line that draws the
    // arrow also names it. Parse-only sugar — the printer writes the two
    // elements as two lines, because folding them back would have to invent
    // the label's id, and the corpus has no convention to invent from.
    const extra: SpecElement[] = [];
    if ((type === "arrow" || type === "edge") && typeof el.text === "string") {
      const label: Record<string, unknown> = { id: `${String(el.id)}_label`, type: "label", text: el.text, attach_to: el.id };
      if (typeof el.side === "string") { label.side = el.side; delete el.side; }
      delete el.text;
      extra.push(label as unknown as SpecElement);
    }
    return { element: { ...el, type } as unknown as SpecElement, extra, args: el, hidden };
  }
  // The id run: bare words up to the first known field name. The same run
  // serves every verb that takes ids; only where it LANDS differs.
  const idRun = (stop: Set<string>): { ids: string[]; next: number } => {
    const ids: string[] = [];
    let i = 0;
    while (tokens[i] !== undefined && isBareId(tokens[i]) && !stop.has(tokens[i])) ids.push(tokens[i++]);
    return { ids, next: i };
  };
  if (LIST_VERBS.has(head)) {
    const { ids, next } = idRun(MODIFIER_KEYS);
    const cmd: Record<string, unknown> = { [head]: ids };
    keyValues(tokens.slice(next), cmd, line);
    return { command: cmd, args: cmd };
  }
  if (TARGET_VERBS.has(head)) {
    const { ids, next } = idRun(new Set([...argKeys(head), ...MODIFIER_KEYS]));
    const args: Record<string, unknown> = {};
    if (ids.length > 0) args[TARGET_FIELD[head]] = ids;
    const { args: own, extra } = splitPairs(head, tokens.slice(next), line);
    keyValues(own, args, line);
    const cmd: Record<string, unknown> = { [head]: args };
    keyValues(extra, cmd, line);
    return { command: cmd, args };
  }
  if (OBJECT_VERBS.has(head) || SCALAR_VERBS.has(head)) {
    if (tokens.length === 0) {
      const cmd: Record<string, unknown> = { [head]: head === "wait" ? "click" : head === "pause" ? true : {} };
      return { command: cmd, args: cmd[head] as Record<string, unknown> };
    }
    // A leading LITERAL is the verb's whole value — a play string, a pause
    // number, an animate map whose keys are dot paths. A leading bare word is
    // the first of the verb's own `key value` pairs.
    if (!/^[A-Za-z_]/.test(tokens[0])) {
      const cmd: Record<string, unknown> = { [head]: parseValue(tokens[0]) };
      keyValues(tokens.slice(1), cmd, line);
      return { command: cmd, args: cmd };
    }
    const args: Record<string, unknown> = {};
    const { args: own, extra } = splitPairs(head, tokens, line);
    keyValues(own, args, line);
    const cmd: Record<string, unknown> = { [head]: args };
    keyValues(extra, cmd, line);
    return { command: cmd, args };
  }
  if (MODIFIER_KEYS.has(head)) {
    // A modifier is not a command of its own: it joins the one the beat is
    // building (the draw its declarations describe, or the line above).
    const mod: Record<string, unknown> = {};
    if (tokens.length === 0) mod[head] = true;
    else if (tokens.length === 1) mod[head] = parseValue(tokens[0]);
    else keyValues(tokens, mod, line);
    return { modifier: mod, args: mod };
  }
  throw new ScriptError(`"${head}" is not a kind of thing or a verb`, line);
}

/** The open layout block a line at this indent belongs to, if any. */
type OpenLayout = { item: Direction; indent: number };

interface Beat {
  speech?: string;
  voice?: "a" | "b";
  label?: string;
  items: Direction[];
}

export function parseScriptPages(text: string): ParsedScript {
  const lines = scanLines(text);
  const meta: Record<string, unknown> = {};
  const warnings: string[] = [];
  const warn = (msg: string): void => { warnings.push(msg); };
  const pages: ScriptPage[] = [];
  let page: Spec | null = null;
  let beat: Beat | null = null;
  let pendingLabel: string | undefined;
  let baseIndent = 0;
  let openLayouts: OpenLayout[] = [];
  /** The group a member at `indent` joins: the innermost open layout shallower than it. */
  const memberOwner = (items: Direction[], indent: number): Direction | null => {
    openLayouts = openLayouts.filter((o) => o.indent < indent && items.includes(o.item));
    return openLayouts.length > 0 ? openLayouts[openLayouts.length - 1].item : null;
  };
  let docTitle: string | undefined;
  let pendingTitle: string | undefined;
  let lastArgs: Record<string, unknown> | null = null;

  const openPage = (): Spec => {
    if (!page) {
      page = {} as Spec;
      if (pendingTitle !== undefined) { page.title = pendingTitle; pendingTitle = undefined; }
      pages.push({ spec: page });
      meta.pageCount = pages.length;
    }
    return page;
  };

  const flush = (): void => {
    if (!beat) return;
    const spec = openPage();
    const commands: Record<string, unknown>[] = [];
    let pendingDraw: string[] | null = null;
    // A group is a HANDLE, not ink: declaring one draws nothing, and it is
    // complete only once its members exist — so it is written to `elements`
    // after them, innermost first.
    const groupItems = beat.items.filter((it) => it.encloses === true).sort((a, b2) => (b2.indent ?? 0) - (a.indent ?? 0));
    for (const item of beat.items) {
      if (item.modifier) {
        const target = commands[commands.length - 1] ?? (commands.push({}), commands[0]);
        Object.assign(target, item.modifier);
        continue;
      }
      if (item.element) {
        if (item.encloses === true) continue;
        (spec.elements ??= []).push(item.element, ...(item.extra ?? []));
        if (item.hidden) { pendingDraw = null; continue; }
        const ids = [item.element.id, ...(item.extra ?? []).map((x) => x.id)];
        if (pendingDraw) pendingDraw.push(...ids);
        else {
          commands.push({ draw: ids });
          pendingDraw = ids;
        }
      } else if (item.command) {
        pendingDraw = null;
        commands.push(item.command);
      }
    }
    for (const g of groupItems) (spec.elements ??= []).push(g.element!);
    if (commands.length === 0 && beat.speech === undefined && beat.label === undefined) { beat = null; return; }
    if (commands.length === 0) commands.push({});
    const first = commands[0];
    if (beat.label !== undefined) first.label = beat.label;
    if (beat.speech !== undefined) first.speak = beat.speech;
    if (beat.voice !== undefined) first.voice = beat.voice;
    (spec.commands ??= []).push(...(commands as unknown as Command[]));
    beat = null;
    lastArgs = null;
  };

  const startBeat = (): Beat => (beat ??= { items: [], label: (() => { const l = pendingLabel; pendingLabel = undefined; return l; })() });

  for (let li = 0; li < lines.length; li++) {
    const l = lines[li];
    switch (l.kind) {
      case "blank": flush(); break;
      case "comment": break;
      case "goto": {
        flush();
        // `@name` hard against a beat labels that beat; `@name` alone in its
        // own paragraph is a label-only command — a bare jump target, which
        // is how the corpus writes a re-watch destination.
        let next = li + 1;
        while (next < lines.length && lines[next].kind === "comment") next++;
        const attached = next < lines.length && (lines[next].kind === "speech" || lines[next].kind === "direction" || lines[next].kind === "fence");
        if (attached) pendingLabel = l.name;
        else ((openPage().commands ??= []) as Command[]).push({ label: l.name } as Command);
        break;
      }
      case "heading":
        flush();
        if (l.depth === 1) docTitle = l.text;
        else { page = null; pendingTitle = l.text; }
        break;
      case "setting": flush(); applySetting(l, openPage(), meta, pages.length > 0 || page !== null); break;
      case "speech": {
        flush();
        const firstWord = l.text.split(/\s+/)[0];
        if ((ELEMENT_ALIASES[firstWord] !== undefined || ELEMENT_HEADS.has(firstWord) || COMMAND_KEYS.has(firstWord)) && !/[.!?:…]$/.test(l.text.trim())) {
          warn(`line ${l.line}: this looks like a direction but sits at column 0, so it will be read aloud`);
        }
        const b = startBeat();
        b.speech = l.text;
        if (l.voice) b.voice = l.voice;
        break;
      }
      case "direction": {
        const b = startBeat();
        if (b.items.length === 0) baseIndent = l.indent;
        // Inside a layout block, a deeper-indented element head declares a
        // MEMBER of that group rather than continuing the line above.
        const owner = memberOwner(b.items, l.indent);
        if (owner !== null && (ELEMENT_ALIASES[l.head] !== undefined || ELEMENT_HEADS.has(l.head))) {
          const d = parseDirection(l.head, l.rest, l.line, warn);
          if (d.element) {
            const members = (owner.element!.members as string[] | undefined) ?? [];
            members.push(d.element.id);
            (owner.element as unknown as Record<string, unknown>).members = members;
            owner.encloses = true;
            d.indent = l.indent;
            b.items.push(d);
            lastArgs = d.args;
            if (LAYOUT_HEADS[l.head] !== undefined) openLayouts.push({ item: d, indent: l.indent });
            break;
          }
        }
        if (l.indent > baseIndent && lastArgs) {
          // `*` is a choice, `+` is the correct one — a quiz's answers, one
          // per line, in the order the viewer sees them.
          if (l.head === "*" || l.head === "+") {
            const choices = (lastArgs.choices as string[] | undefined) ?? [];
            choices.push(l.rest);
            lastArgs.choices = choices;
            if (l.head === "+") lastArgs.correct = choices.length;
            break;
          }
          const tokens = splitTokens(`${l.head} ${l.rest}`.trim());
          keyValues(tokens, lastArgs, l.line);
          break;
        }
        const d = parseDirection(l.head, l.rest, l.line, warn);
        d.indent = l.indent;
        b.items.push(d);
        lastArgs = d.args;
        if (LAYOUT_HEADS[l.head] !== undefined && d.element) openLayouts.push({ item: d, indent: l.indent });
        break;
      }
      case "fence": {
        const b = startBeat();
        if (b.items.length === 0) baseIndent = l.indent;
        const d = parseFence(l, openPage(), isLanguage);
        if (d) { b.items.push(d); lastArgs = d.args; }
        break;
      }
    }
  }
  flush();
  if (pages.length === 0) pages.push({ spec: pendingTitle !== undefined ? ({ title: pendingTitle } as Spec) : ({} as Spec) });
  // One `#` titles a lone page; with `##` sections it is the playlist's name.
  if (docTitle !== undefined) {
    if (pages.length === 1 && pages[0].spec.title === undefined) pages[0].spec.title = docTitle;
    else meta.title = docTitle;
  }
  // `in <group>` written on a member, now that every group on the page exists.
  for (const { spec } of pages) {
    const byId = new Map((spec.elements ?? []).map((e) => [e.id, e as unknown as Record<string, unknown>]));
    for (const el of spec.elements ?? []) {
      const rec = el as unknown as Record<string, unknown>;
      const owner = rec["@in"];
      delete rec["@in"];
      if (typeof owner !== "string") continue;
      const group = byId.get(owner);
      if (group === undefined) {
        warnings.push(`element "${el.id}": there is no group "${owner}" to be in`);
        continue;
      }
      const members = (group.members as string[] | undefined) ?? [];
      if (!members.includes(el.id)) members.push(el.id);
      group.members = members;
    }
  }
  delete meta.pageCount;
  return { meta, pages, warnings };
}

/** The settings that are spelled differently in a script than in the spec. */
const SETTING_FIELD: Record<string, string> = { use: "template", with: "params" };
/** Playlist-level settings — they live on the document, not on a page. */
const META_SETTINGS = new Set(["subtitle", "advance", "gap", "transitions", "next", "enroll", "prompt", "comments", "views"]);

function applySetting(l: ScriptLine & { kind: "setting" }, spec: Spec, meta: Record<string, unknown>, started: boolean): void {
  const value = l.rest === "" ? true : parseValue(l.rest);
  if (l.key === "chapter") {
    // A chapter is an entry of its own, ahead of the page that follows.
    const chapters = (meta.chapters as { before: number; title: string }[] | undefined) ?? [];
    chapters.push({ before: (meta.pageCount as number) ?? 0, title: String(value) });
    meta.chapters = chapters;
    return;
  }
  if (META_SETTINGS.has(l.key) && !started) { meta[l.key] = value; return; }
  (spec as unknown as Record<string, unknown>)[SETTING_FIELD[l.key] ?? l.key] = value;
}

function parseFence(l: ScriptLine & { kind: "fence" }, spec: Spec, isLanguage: (s: string) => boolean): Direction | null {
  const tokens = splitTokens(l.info);
  const head = tokens[0] ?? "";
  if (head === "assets" || head === "yaml") {
    const value = load(l.body, { schema: CORE_SCHEMA }) as unknown;
    if (head === "assets") {
      spec.assets = { ...(spec.assets ?? {}), ...(value as Record<string, string>) };
      return null;
    }
    // The escape hatch: a list is elements, a mapping is merged into the page.
    if (Array.isArray(value)) {
      (spec.elements ??= []).push(...(value as SpecElement[]));
      return null;
    }
    if (value && typeof value === "object") Object.assign(spec, value);
    return null;
  }
  if (head !== "code" && !isLanguage(head)) throw new ScriptError(`"${head}" is not a language, and not yaml or assets`, l.line);
  const el: Record<string, unknown> = head === "code" ? {} : { language: head };
  let i = 1;
  if (tokens[i] !== undefined && isBareId(tokens[i]) && !ELEMENT_KEYS.has(tokens[i])) el.id = tokens[i++];
  keyValues(tokens.slice(i), el, l.line);
  if (typeof el.id !== "string") throw new ScriptError("a code fence needs an id", l.line);
  const hidden = el.hidden === true;
  delete el.hidden;
  // An empty body leaves `code` as the info line set it (usually absent): a
  // code element may carry only a `game`, with no script at all.
  if (l.body !== "") el.code = l.body;
  return { element: { ...el, type: "code" } as unknown as SpecElement, args: el, hidden };
}
