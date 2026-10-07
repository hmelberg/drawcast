// The lines only a LIVE viewer can hear around a question, that a cast can
// know ahead — what a bake records beside the movie's lines (playlist/
// session.ts playlistBakeLines), so a published cast never drops to the
// browser voice for them (Hans 2026-10-07: "many of the built-in comments
// around interactive questions are spoken in the browser voice").
//
// The movie (export/video.ts collectSpeakLines) answers every question right,
// so it never says:
// - a `wrong` line (quiz, ask: typed, choose, guess, cards, tree, formula);
// - the reveal after a wrong tap on a choose ask with no `right`: the right
//   option's words (render/player.ts chooseAsk);
// - the `right` of an ask with no `answer` field (a guess or cards ask is
//   judged without one, and the movie's collector reads only check-mode asks);
// - a feedback band's line, and the bundled jokes of `reward: joke`
//   (feedback/bands.ts pickLine, feedback/rewards.ts pickJoke);
// - a cards ask's count line with the viewer's score ("4 of 6 on the first
//   try."): every score 0 … count (cards/line-variants.ts);
// - the affirmation a right answer hears (render/affirm.ts affirmLines).
// A line reading a FREE value — a typed answer, a slider, a guess, {score}
// mid-cast — cannot be known ahead and is left out: any `{…}` left after the
// count tokens are filled means the line is not recorded.
//
// Each line carries the voice the player speaks it in: a quiz/ask's lines
// are said with its command's voice and delivery (plan.ts narrationSpeaker),
// the cast's narrator gender — speechKey has to match exactly.
import { affirmLines } from "../render/affirm";
import { speechKey, type SpeakLine } from "../render/delivery";
import { splitLangRuns } from "../render/lang-spans";
import { castLang } from "../render/quiz-words";
import { feedbackLines, resolveFeedback } from "../feedback/bands";
import { cardsLineVariants } from "../cards/line-variants";
import { authoredCards, cardsGeometryIn } from "../spec/cards";
import { expandSpec } from "../spec/expand";
import { VAR_RE } from "../spec/answers";
import type { Command, Spec } from "../spec/types";

/** Whether a line still reads a value only the live viewer supplies. */
function hasPlaceholder(text: string): boolean {
  return new RegExp(VAR_RE.source, "i").test(text);
}

type Voice = Pick<SpeakLine, "speaker" | "delivery" | "gender">;

/** The commands as the player plays them (on-canvas buttons → a choose ask, …); the authored ones if expansion fails. */
function playedCommands(spec: Spec): { spec: Spec; commands: Command[] } {
  try {
    const ex = expandSpec(structuredClone(spec));
    return { spec: ex, commands: ex.commands ?? [] };
  } catch {
    return { spec, commands: spec.commands ?? [] };
  }
}

/** Every line a live viewer of this cast can hear around its questions, known ahead. */
export function liveSpeakLines(spec: Spec): SpeakLine[] {
  const seen = new Map<string, SpeakLine>();
  const push = (text: unknown, voice: Voice): void => {
    if (typeof text !== "string" || text.trim() === "" || hasPlaceholder(text)) return;
    // `[de:ich]` is its own clip in its own voice, as in collectSpeakLines.
    for (const run of splitLangRuns(text)) {
      const line: SpeakLine = { text: run.text, ...voice, ...(run.lang ? { lang: run.lang } : {}) };
      const key = speechKey(line);
      if (!seen.has(key)) seen.set(key, line);
    }
  };
  const lang = castLang(spec);
  const { spec: played, commands } = playedCommands(spec);
  const cardIds = new Set(authoredCards(played).map((c) => c.id));
  for (const c of commands) {
    const q = c.quiz ?? c.ask;
    if (!q) continue;
    const voice: Voice = { speaker: c.voice, delivery: c.delivery, gender: spec.voice };
    push(q.right, voice);
    push(q.wrong, voice);
    if (c.quiz) push(c.quiz.right ?? c.quiz.choices?.[c.quiz.correct - 1], voice);
    const ask = c.ask;
    if (ask && Array.isArray(ask.choose) && ask.answer !== undefined && ask.right === undefined) {
      // The reveal after a wrong tap: the right option's words (plan.ts chooseOptions' label).
      const el = played.elements?.find((e) => e.id === ask.answer) as { text?: unknown; label?: unknown } | undefined;
      const label = [el?.text, el?.label].find((v): v is string => typeof v === "string" && v.trim() !== "");
      if (label) push(label.trim(), voice);
    }
    // A feedback band's line (and a joke reward's jokes), said after the author's line.
    for (const l of feedbackLines(resolveFeedback(spec.feedback, q.feedback), lang)) push(l, voice);
    // A cards ask's count lines: every score the viewer can reach.
    const on = ask?.on;
    if (ask && typeof on === "string" && cardIds.has(on)) {
      const g = cardsGeometryIn(played, on);
      if (g && g.mode !== "fill") for (const t of cardsLineVariants(ask, g, new Map(), (s) => s)) push(t, voice);
    }
  }
  // What a right answer hears first (render/affirm.ts), in the default voice
  // and in every voice a question speaks with.
  const pool = affirmLines(spec);
  if (pool.length > 0) {
    const voices = new Map<string, Voice>([["|", { gender: spec.voice }]]);
    for (const c of spec.commands ?? []) if (c.quiz || c.ask) voices.set(`${c.voice ?? ""}|${c.delivery ?? ""}`, { speaker: c.voice, delivery: c.delivery, gender: spec.voice });
    for (const text of pool) for (const v of voices.values()) push(text, v);
  }
  return [...seen.values()];
}
