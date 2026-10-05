// Say the question once (Hans 2026-10-05, ants-on-earth): a page whose
// heading already asks "How many ants are on Earth?", a voice that just said
// it, and an ask whose `question` asks it again — three times the same
// sentence, in two type styles. The heading is the one stable headline; the
// ask then adds only its TASK ("Click on the line: each step is ten times
// the last."), on screen and in the voice.
//
// Pure: split an ask's question into its question sentence(s) and the task
// after them, and tell whether a question restates a given text (a heading,
// the line spoken before it). English and Norwegian.

/** An ask's question: what it asks, and the instructions after it. */
export interface QuestionParts {
  /** The sentences up to and including the first that ends in "?" ("" when none does: all task). */
  question: string;
  /** What follows: how to answer ("" when nothing). */
  task: string;
}

/** Split after the first sentence that ends in "?". No "?" at all: the whole text is the task. */
export function splitQuestion(text: string): QuestionParts {
  const t = text.trim();
  const m = /\?["'»”’)]*(\s+|$)/.exec(t);
  if (!m) return { question: "", task: t };
  const end = m.index + m[0].length;
  return { question: t.slice(0, end).trim(), task: t.slice(end).trim() };
}

// Small on purpose: function words and question words that carry no topic.
const STOP = new Set(
  (
    // English
    "a an the is are was were be been being am do does did of on in at to for and or but it its this that these those there their they them " +
    "what which who whom whose how many much why when where than then as by with from into about over under your you we our us i me my he she his her " +
    "can could would will should shall may might must has have had so not no yes just very all any some each one ever right now here today really " +
    "think guess say tell let " +
    // Norwegian (bokmål)
    "en ei et den det de er var være vært og eller men i på til for av med fra om at ikke har hadde kan kunne vil ville skal skulle må du dere vi jeg " +
    "han hun seg sin sitt sine så nå her der hva hvem hvor hvordan hvorfor hvilken hvilket hvilke når mange mye noen alle hver tror gjett si"
  ).split(/\s+/),
);

/** Content words, lowercased, a plural or verb ending trimmed. */
export function contentWords(text: string): Set<string> {
  const out = new Set<string>();
  for (const raw of text.toLowerCase().normalize("NFC").split(/[^\p{L}\p{N}]+/u)) {
    if (raw === "" || STOP.has(raw)) continue;
    out.add(stem(raw));
  }
  return out;
}

/** A light stem: enough that "ants" meets "ant" and "maurene" meets "maur". */
function stem(w: string): string {
  if (/^\p{N}+$/u.test(w)) return w;
  for (const suf of ["ene", "ies", "er", "en", "et", "es", "s"]) {
    if (w.length - suf.length >= 3 && w.endsWith(suf)) return suf === "ies" ? `${w.slice(0, -3)}y` : w.slice(0, -suf.length);
  }
  return w;
}

/**
 * Does `question` (its question part) restate `text`? Most of its content
 * words (≥ 60 %) are in `text` and it adds at most one of its own ("How many
 * ants LIVE on Earth?" restates "How many ants are on Earth?"; "On the Moon
 * you would WEIGH a SIXTH as much. True or myth?" is a new claim under the
 * heading "True or myth? Three things about the Moon"); a question of one or
 * two content words must also cover half of `text`'s, so "How many ants?"
 * restates the heading "Ants on Earth" but not a long line that merely
 * mentions ants.
 */
export function restates(question: string, text: string | null | undefined): boolean {
  if (!text) return false;
  const q = contentWords(splitQuestion(question).question);
  const t = contentWords(text);
  if (q.size === 0 || t.size === 0) return false;
  let shared = 0;
  for (const w of q) if (t.has(w)) shared++;
  if (shared / q.size < 0.6 || q.size - shared > 1) return false;
  return q.size >= 3 || shared / t.size >= 0.5;
}

/**
 * What an ask adds beside a heading that already asks it: null — it asks
 * something else (show and say the whole question); else the task to show
 * and say instead ("" — none: the gate's own hint, and nothing said). A
 * question with no "?" is all task, and stands under any heading.
 */
export function taskBeside(question: string, ...said: (string | null | undefined)[]): string | null {
  const parts = splitQuestion(question);
  if (parts.question === "") return parts.task;
  return said.some((s) => restates(question, s)) ? parts.task : null;
}
