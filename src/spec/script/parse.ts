// lines → { meta, pages }. The three structural rules live here: a beat is a
// spoken line plus what is indented under it; one direction is one command,
// except that consecutive element declarations collapse into the single
// `draw` they describe; the spoken line rides on the beat's first command.
import { scanLines, type ScriptLine } from "./lines";
import { parseValue, setPath, splitTokens } from "./values";
import { specSchema } from "../schema";
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
export const LIST_VERBS = new Set(["draw", "show", "hide", "erase", "reveal", "press"]);
/** Verbs whose leading bare ids fill `target` inside an object. */
export const TARGET_VERBS = new Set(["highlight", "focus", "move", "arrange", "fade", "flip", "morph", "keep"]);
/** Verbs whose whole argument set is an object with no positional part. */
export const OBJECT_VERBS = new Set(["point", "copy", "flow", "camera", "card", "clear", "quiz", "ask", "run", "explore", "if"]);
/** Verbs and beat modifiers that take one value (or stand alone). */
export const SCALAR_VERBS = new Set(["pause", "wait", "parallel", "blocking", "voice", "delivery", "duration", "easing", "tempo", "instrument", "animate", "play", "ghost", "trail", "label"]);

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
    if (tokens[0] !== undefined && isBareId(tokens[0]) && !ELEMENT_KEYS.has(tokens[0])) el.id = tokens[i++];
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
    const { ids, next } = idRun(COMMAND_KEYS);
    const cmd: Record<string, unknown> = { [head]: ids };
    keyValues(tokens.slice(next), cmd, line);
    return { command: cmd, args: cmd };
  }
  if (TARGET_VERBS.has(head)) {
    const { ids, next } = idRun(argKeys(head));
    const args: Record<string, unknown> = {};
    if (ids.length > 0) args.target = ids;
    keyValues(tokens.slice(next), args, line);
    return { command: { [head]: args }, args };
  }
  if (OBJECT_VERBS.has(head)) {
    const args: Record<string, unknown> = {};
    keyValues(tokens, args, line);
    return { command: { [head]: args }, args };
  }
  if (SCALAR_VERBS.has(head)) {
    if (tokens.length === 0) {
      const cmd: Record<string, unknown> = { [head]: head === "wait" ? "click" : true };
      return { command: cmd, args: cmd };
    }
    if (tokens.length === 1) {
      const cmd: Record<string, unknown> = { [head]: parseValue(tokens[0]) };
      return { command: cmd, args: cmd };
    }
    const args: Record<string, unknown> = {};
    keyValues(tokens, args, line);
    return { command: { [head]: args }, args };
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
  let lastArgs: Record<string, unknown> | null = null;

  const openPage = (): Spec => {
    if (!page) { page = {} as Spec; pages.push({ spec: page }); }
    return page;
  };

  const flush = (): void => {
    if (!beat) return;
    const spec = openPage();
    const commands: Record<string, unknown>[] = [];
    let pendingDraw: string[] | null = null;
    for (const item of beat.items) {
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

  for (const l of lines) {
    switch (l.kind) {
      case "blank": flush(); break;
      case "comment": break;
      case "goto": flush(); pendingLabel = l.name; break;
      case "heading": flush(); handleHeading(l, meta, pages, () => { page = null; }); break;
      case "setting": flush(); applySetting(l, openPage(), meta, pages.length); break;
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
        const d = parseFence(l, openPage(), l.line);
        if (d) { b.items.push(d); lastArgs = d.args; }
        break;
      }
    }
  }
  flush();
  if (pages.length === 0) pages.push({ spec: {} as Spec });
  return { meta, pages };
}

// Task 4 fills these in.
function handleHeading(_l: ScriptLine & { kind: "heading" }, _meta: Record<string, unknown>, _pages: ScriptPage[], _closePage: () => void): void {}
function applySetting(_l: ScriptLine & { kind: "setting" }, _spec: Spec, _meta: Record<string, unknown>, _pageCount: number): void {}
function parseFence(_l: ScriptLine & { kind: "fence" }, _spec: Spec, _line: number): Direction | null { return null; }
