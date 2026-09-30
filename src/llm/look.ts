// The look pass (the prompt lab's finding, 2026-09-27 — branch prompt-lab,
// docs/prompt-lab/): after a spec lands, a critic SEES its rendered frames —
// one per spoken line — and lists the page's problems in words; a fix round
// applies them, and the critic looks again (at most twice, or until it
// answers NONE). In blind reviews this, not a longer prompt, is what moved the
// visual score. Rendering is injected (GenerateConfig.look), because frames
// need a browser. Builders here are pure.

import type Anthropic from "@anthropic-ai/sdk";
import lookMd from "./prompts/look-v1.md?raw";

export const LOOK_PROMPT_SOURCE: string = lookMd;

/** One rendered tile of the frames sheet: base64 without the data: prefix. */
export interface LookImage {
  mediaType: "image/png" | "image/jpeg";
  data: string;
}

/** The critic's user turn: the frames, then what was asked for (the request, or a plan), so it judges against the intent. */
export function lookUserContent(images: LookImage[], intentText?: string): Anthropic.ContentBlockParam[] {
  const intent = intentText ? `What the drawcast was asked to explain (for intent — judge the pages):\n\n${intentText.trim()}\n\n` : "";
  return [
    ...images.map((im) => ({ type: "image" as const, source: { type: "base64" as const, media_type: im.mediaType, data: im.data } })),
    { type: "text", text: `${intent}Review these frames.` },
  ];
}

/** True when the critic found nothing to fix (it answers NONE, optionally followed by the WISH line). */
export function lookFoundNothing(critique: string): boolean {
  return /^\s*NONE\b/i.test(critique);
}

/** The critique without its WISH line — the part the staging round acts on. */
export function lookProblems(critique: string): string {
  return critique.replace(/^\s*WISH:.*$/gim, "").trim();
}

/**
 * Edits instead of a whole spec (prompt-lab, 2026-09-27): a fix round that
 * re-emits the complete spec costs ~8–10k output tokens and a minute or two
 * for a handful of changes, so the fix may answer {"edits": [...]}. Elements
 * are addressed by id; commands by their number in the spec the fix was
 * given (the prompt lists them), so the edits need not track each other.
 */
export type SpecEdit =
  | { element: string; set?: Record<string, unknown>; remove?: boolean }
  | { add: Record<string, unknown> }
  | { params: Record<string, unknown> }
  | { spec: Record<string, unknown> }
  | { command: number; set?: Record<string, unknown>; replace?: Record<string, unknown>; remove?: boolean }
  | { insert_before: number; commands: Record<string, unknown>[] }
  | { insert_after: number; commands: Record<string, unknown>[] };

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

/** Shallow merge; a null value removes the key. */
function mergeFields(target: Obj, fields: Obj): Obj {
  const out: Obj = { ...target };
  for (const [k, v] of Object.entries(fields)) {
    if (v === null) delete out[k];
    else out[k] = v;
  }
  return out;
}

/** Deep merge for params (objects merge, everything else replaces; null removes). */
function deepMerge(target: unknown, patch: Obj): Obj {
  const out: Obj = isObj(target) ? { ...target } : {};
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) delete out[k];
    else if (isObj(v) && isObj(out[k])) out[k] = deepMerge(out[k], v);
    else out[k] = v;
  }
  return out;
}

/**
 * Applies edits to a copy of `spec`. An edit that names nothing (an unknown
 * id, a command number out of range, an unreadable shape) is SKIPPED and
 * reported, never fatal: one bad edit must not cost the good ones — through
 * the API, whole fixes were lost that way (prompt lab run 3).
 */
export function applySpecEditsLenient<S extends Obj>(spec: S, edits: SpecEdit[]): { spec: S; skipped: string[] } {
  const skipped: string[] = [];
  let out = spec;
  // Commands address the ORIGINAL numbering, so all edits go in one pass;
  // a bad one is filtered out by trying each alone first.
  const good = edits.filter((e) => {
    try {
      applySpecEdits(spec, [e]);
      return true;
    } catch (err) {
      skipped.push((err as Error).message);
      return false;
    }
  });
  out = applySpecEdits(spec, good);
  return { spec: out, skipped };
}

/** Applies edits to a copy of `spec`. Throws on an edit that names nothing. */
export function applySpecEdits<S extends Obj>(spec: S, edits: SpecEdit[]): S {
  const out = structuredClone(spec) as Obj;
  let elements = [...((out.elements as Obj[] | undefined) ?? [])];
  const original = (out.commands as Obj[] | undefined) ?? [];
  const slots: { before: Obj[]; cmd: Obj | null; after: Obj[] }[] = original.map((c) => ({ before: [], cmd: c, after: [] }));
  const slot = (i: number) => {
    if (!Number.isInteger(i) || i < 0 || i >= slots.length) throw new Error(`no command ${i} (the spec has ${slots.length})`);
    return slots[i];
  };
  for (const e of edits as Obj[]) {
    if (typeof e.element === "string") {
      const i = elements.findIndex((el) => el.id === e.element);
      if (i < 0) throw new Error(`no element "${e.element}"`);
      if (e.remove === true) elements = elements.filter((_, k) => k !== i);
      else if (isObj(e.set)) elements[i] = mergeFields(elements[i], e.set);
    } else if (isObj(e.add)) {
      elements.push(e.add);
    } else if (isObj(e.params)) {
      out.params = deepMerge(out.params, e.params);
    } else if (isObj(e.spec)) {
      for (const [k, v] of Object.entries(e.spec)) {
        if (k === "elements" || k === "commands") continue;
        if (v === null) delete out[k];
        else out[k] = v;
      }
    } else if (typeof e.command === "number") {
      const s = slot(e.command);
      if (e.remove === true) s.cmd = null;
      else if (isObj(e.replace)) s.cmd = e.replace;
      else if (isObj(e.set) && s.cmd) s.cmd = mergeFields(s.cmd, e.set);
    } else if (typeof e.insert_before === "number" && Array.isArray(e.commands)) {
      slot(e.insert_before).before.push(...(e.commands as Obj[]));
    } else if (typeof e.insert_after === "number" && Array.isArray(e.commands)) {
      slot(e.insert_after).after.push(...(e.commands as Obj[]));
    } else {
      throw new Error(`unreadable edit ${JSON.stringify(e).slice(0, 80)}`);
    }
  }
  out.elements = elements;
  out.commands = slots.flatMap((s) => [...s.before, ...(s.cmd ? [s.cmd] : []), ...s.after]);
  return out as S;
}

/** A fix reply is either {"edits": [...]} or a complete spec. */
export function isEditsReply(json: unknown): json is { edits: SpecEdit[] } {
  return isObj(json) && Array.isArray(json.edits);
}

/** One line per command, numbered as the edits address them. */
function commandIndex(spec: Obj): string {
  const cmds = (spec.commands as Obj[] | undefined) ?? [];
  return cmds
    .map((c, i) => {
      const verb = Object.keys(c).find((k) => !["speak", "cue", "cue_end", "duration", "easing", "voice", "delivery", "blocking"].includes(k)) ?? "speak";
      const speak = typeof c.speak === "string" ? ` — "${c.speak.slice(0, 50)}${c.speak.length > 50 ? "…" : ""}"` : "";
      return `${i}: ${verb}${speak}`;
    })
    .join("\n");
}

/** The staging round's instruction: apply the critique to the spec just delivered. */
export function lookFixPrompt(critique: string, spec?: Obj): string {
  const edits = spec
    ? [
        "",
        'Reply with ONLY the changes, as {"edits": [...]} — much shorter than the whole spec. Each edit is one of:',
        '- {"element": "<id>", "set": {<fields>}} (merges; a field set to null is removed) · {"element": "<id>", "remove": true} · {"add": {<a new element>}}',
        '- {"params": {<fields>}} (merges into params, nested objects too) · {"spec": {<top-level fields such as vars, text, domain>}}',
        '- A template\'s own parts (its readout, its curve labels, a card it draws) are not elements: move or enlarge them with {"spec": {"adjust": {"<part or group id>": {"move": [<right %>, <up %>], "scale": <0.5–2.5>}}}} — move in percent of the page. Keep any adjust entries the spec already has.',
        '- {"command": <n>, "set": {<fields>}} · {"command": <n>, "replace": {<command>}} · {"command": <n>, "remove": true}',
        '- {"insert_before": <n>, "commands": [...]} · {"insert_after": <n>, "commands": [...]}',
        "Command numbers are those below, in the spec as it stands now — every edit uses these numbers, whatever the other edits do. If the changes are so many that the whole spec is simpler, return the complete spec instead.",
        "",
        "Commands:",
        commandIndex(spec),
      ]
    : ["", "Return the corrected COMPLETE spec (not a diff), as minified JSON. A template's own parts (its readout, its curve labels) are not elements: move or enlarge them with the top-level `adjust` ({\"<part id>\": {\"move\": [right %, up %], \"scale\": 1.4}})."];
  return [
    "A designer watched the rendered frames of this spec and reports these problems, most important first:",
    "",
    lookProblems(critique),
    "",
    "Fix them. Keep the spoken lines as they are unless a fix needs a line changed.",
    ...edits,
  ].join("\n");
}
