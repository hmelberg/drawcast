// lines → { meta, pages }. The three structural rules live here: a beat is a
// spoken line plus what is indented under it; one direction is one command,
// except that consecutive element declarations collapse into the single
// `draw` they describe; the spoken line rides on the beat's first command.
import { scanLines, type ScriptLine } from "./lines";
import { parseValue, setPath, splitTokens } from "./values";
import { specSchema } from "../schema";
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
export interface ParsedScript { meta: Record<string, unknown>; pages: ScriptPage[] }

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
/** Verbs whose leading bare ids fill `target` inside an object. */
export const TARGET_VERBS = new Set(["highlight", "focus", "move", "arrange", "fade", "flip", "morph", "keep"]);
/** Verbs whose whole argument set is an object with no positional part. */
export const OBJECT_VERBS = new Set(["point", "copy", "flow", "camera", "card", "clear", "quiz", "ask", "run", "explore", "if"]);
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

/** Every element field, and every command field: what ends an id run. */
export const ELEMENT_KEYS = new Set<string>(schemaProps("elements"));
export const COMMAND_KEYS = new Set<string>(schemaProps("commands"));

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
    if (i + 1 >= tokens.length) throw new ScriptError(`"${tokens[i]}" has no value`, line);
    const pair = [tokens[i], tokens[i + 1]];
    (MODIFIER_KEYS.has(tokens[i]) && !mine.has(tokens[i]) ? extra : args).push(...pair);
  }
  return { args, extra };
}

function keyValues(tokens: string[], into: Record<string, unknown>, line: number): void {
  for (let i = 0; i < tokens.length; i += 2) {
    const path = tokens[i];
    if (i + 1 >= tokens.length) throw new ScriptError(`"${path}" has no value`, line);
    setPath(into, path, parseValue(tokens[i + 1]));
  }
}

export interface Direction {
  element?: SpecElement;
  command?: Record<string, unknown>;
  /** A beat modifier (`parallel true`): it joins the command being built. */
  modifier?: Record<string, unknown>;
  /** Where a deeper-indented continuation line writes. */
  args: Record<string, unknown>;
  /** A declaration the props block marked `hidden`: declared, not drawn. */
  hidden?: boolean;
}

export function parseDirection(head: string, rest: string, line: number): Direction {
  const tokens = splitTokens(rest);
  // `dot` is the point element; the bare word `point` is the laser verb.
  const type = head === "dot" ? "point" : head;
  if (head === "dot" || ELEMENT_HEADS.has(head)) {
    const el: Record<string, unknown> = {};
    let i = 0;
    // The id is the first bare token, full stop. Element fields make perfectly
    // good ids (`slope`, `text`, `line`), and an element always has one.
    if (tokens[0] !== undefined && isBareId(tokens[0])) el.id = tokens[i++];
    if (tokens[i] !== undefined && tokens[i].startsWith('"')) el.text = parseValue(tokens[i++]);
    keyValues(tokens.slice(i), el, line);
    if (typeof el.id !== "string") throw new ScriptError(`a ${head} needs an id`, line);
    const hidden = el.hidden === true;
    delete el.hidden;
    return { element: { ...el, type } as unknown as SpecElement, args: el, hidden };
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
    if (ids.length > 0) args.target = ids;
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

interface Beat {
  speech?: string;
  voice?: "a" | "b";
  label?: string;
  items: Direction[];
}

export function parseScriptPages(text: string): ParsedScript {
  const lines = scanLines(text);
  const meta: Record<string, unknown> = {};
  const pages: ScriptPage[] = [];
  let page: Spec | null = null;
  let beat: Beat | null = null;
  let pendingLabel: string | undefined;
  let baseIndent = 0;
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
    for (const item of beat.items) {
      if (item.modifier) {
        const target = commands[commands.length - 1] ?? (commands.push({}), commands[0]);
        Object.assign(target, item.modifier);
        continue;
      }
      if (item.element) {
        (spec.elements ??= []).push(item.element);
        if (item.hidden) { pendingDraw = null; continue; }
        if (pendingDraw) pendingDraw.push(item.element.id);
        else {
          const ids = [item.element.id];
          commands.push({ draw: ids });
          pendingDraw = ids;
        }
      } else if (item.command) {
        pendingDraw = null;
        commands.push(item.command);
      }
    }
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
        const b = startBeat();
        b.speech = l.text;
        if (l.voice) b.voice = l.voice;
        break;
      }
      case "direction": {
        const b = startBeat();
        if (b.items.length === 0) baseIndent = l.indent;
        if (l.indent > baseIndent && lastArgs) {
          const tokens = splitTokens(`${l.head} ${l.rest}`.trim());
          keyValues(tokens, lastArgs, l.line);
          break;
        }
        const d = parseDirection(l.head, l.rest, l.line);
        b.items.push(d);
        lastArgs = d.args;
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
  delete meta.pageCount;
  return { meta, pages };
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
