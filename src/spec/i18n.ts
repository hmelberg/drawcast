// Which strings in a spec are TEXT, and which are machinery. One traversal
// answers both halves of the question — collecting the strings to translate and
// putting the translations back — so the two can never drift apart and leave a
// field collected but unreachable, or rewritten without ever having been shown
// to a translator.
//
// Everything here builds a NEW spec. exportSequence hands out the document's
// own spec objects by reference (playlist.ts), so translating in place would
// rewrite the user's library instead of the copy bound for a video.

import type { AskArgs, Command, QuizArgs, Spec, SpecElement } from "./types";

/** A string worth translating, with the job it does — a label must stay short. */
export interface Translatable {
  text: string;
  role: string;
}

/** Returns the replacement for `text`, or `text` itself to leave it alone. */
type Rewrite = (text: string, role: string) => string;

function str(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

/**
 * A param string is text unless the schema says otherwise. The exceptions are
 * real and measured across the bundled manifests: `enum` marks a mode, a
 * property called `id` is an identifier, and `x-translate: false` marks the
 * rest — a math expression, a color, a structure string, a reference to
 * another param's id. Everything else on a template IS drawn on the canvas.
 *
 * References BY NAME (markov's transitions.from against states[]) are left in:
 * both sides go through the same source-keyed map, so they stay in step.
 */
function paramIsText(schema: Record<string, unknown> | undefined, key: string): boolean {
  if (!schema) return true;
  if (schema.enum !== undefined) return false;
  if (schema["x-translate"] === false) return false;
  return key !== "id";
}

type Schema = Record<string, unknown> | undefined;

function subSchema(schema: Schema, key: string): Schema {
  const props = schema?.properties as Record<string, Record<string, unknown>> | undefined;
  return props?.[key];
}

function itemSchema(schema: Schema): Schema {
  return schema?.items as Record<string, unknown> | undefined;
}

/** Walk a params value beside its schema, rewriting the leaves that are text. */
function rewriteParams(value: unknown, schema: Schema, key: string, role: string, rewrite: Rewrite): unknown {
  if (Array.isArray(value)) return value.map((v) => rewriteParams(v, itemSchema(schema), key, role, rewrite));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = rewriteParams(v, subSchema(schema, k), k, role, rewrite);
    }
    return out;
  }
  if (str(value) && paramIsText(schema, key)) return rewrite(value, role);
  return value;
}

function rewriteElement(el: SpecElement, rewrite: Rewrite): SpecElement {
  const out = { ...el };
  // `of` is a lookup key (Wikipedia resolves it), `quote` is matched against a
  // real document's text layer, `source` is an attribution: all three break
  // when reworded, however sensible the wording.
  if (str(out.text)) out.text = rewrite(out.text, "label");
  if (str(out.x_label)) out.x_label = rewrite(out.x_label, "axis label");
  if (str(out.y_label)) out.y_label = rewrite(out.y_label, "axis label");
  return out;
}

function rewriteQuiz(q: QuizArgs, rewrite: Rewrite): QuizArgs {
  const out = { ...q };
  out.question = rewrite(q.question, "question");
  if (str(q.intro)) out.intro = rewrite(q.intro, "question intro");
  if (str(q.right)) out.right = rewrite(q.right, "answer feedback");
  if (str(q.wrong)) out.wrong = rewrite(q.wrong, "answer feedback");
  out.choices = q.choices.map((c) => rewrite(c, "answer option"));
  return out;
}

function rewriteAsk(a: AskArgs, rewrite: Rewrite): AskArgs {
  const out = { ...a };
  out.question = rewrite(a.question, "question");
  if (str(a.intro)) out.intro = rewrite(a.intro, "question intro");
  if (str(a.right)) out.right = rewrite(a.right, "answer feedback");
  if (str(a.wrong)) out.wrong = rewrite(a.wrong, "answer feedback");
  // With a widget the answer is not a word at all — an element id, a note like
  // "C4", a move like "e2e4" — and translating it breaks the question. Without
  // one it is typed prose, and it MUST move with its question or no viewer can
  // ever be right.
  if (!a.widget) {
    if (str(a.answer)) out.answer = rewrite(a.answer, "expected answer");
    if (str(a.default)) out.default = rewrite(a.default, "expected answer");
  }
  return out;
}

function rewriteCommand(c: Command, rewrite: Rewrite): Command {
  const out = { ...c };
  if (str(out.speak)) out.speak = rewrite(out.speak, "narration");
  if (c.quiz) out.quiz = rewriteQuiz(c.quiz, rewrite);
  if (c.ask) out.ask = rewriteAsk(c.ask, rewrite);
  return out;
}

/**
 * The single traversal. `paramsSchema` is the template's own `params_schema`
 * (passed in rather than looked up: importing the scene registry here would
 * drag every layout module into whatever chunk this lands in).
 */
function rewriteSpec(spec: Spec, paramsSchema: object | undefined, rewrite: Rewrite): Spec {
  const out: Spec = { ...spec };
  if (str(out.title)) out.title = rewrite(out.title, "title");
  if (spec.elements) out.elements = spec.elements.map((el) => rewriteElement(el, rewrite));
  if (spec.commands) out.commands = spec.commands.map((c) => rewriteCommand(c, rewrite));
  if (spec.params) {
    out.params = rewriteParams(spec.params, paramsSchema as Schema, "", "figure text", rewrite) as Record<string, unknown>;
  }
  return out;
}

/** Every string a translator should see, in the order it appears, deduplicated. */
export function translatableStrings(spec: Spec, paramsSchema?: object): Translatable[] {
  const found: Translatable[] = [];
  const seen = new Set<string>();
  rewriteSpec(spec, paramsSchema, (text, role) => {
    if (!seen.has(text)) {
      seen.add(text);
      found.push({ text, role });
    }
    return text;
  });
  return found;
}

/**
 * A new spec with every translated string replaced. A string the map does not
 * mention is left exactly as it was — a partial translation degrades to mixed
 * language, never to a blank figure.
 */
export function applyTranslations(spec: Spec, map: Record<string, string>, paramsSchema?: object): Spec {
  return rewriteSpec(spec, paramsSchema, (text) => (str(map[text]) ? map[text] : text));
}
