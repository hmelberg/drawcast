// What a figure question says (round 7 §8.1, §8.2, §3.6): its question
// stands over the figure as the headline, so it is a full sentence naming
// the task and what counts as right — read without the narration, in two
// lines at most. And a sort judged card by card leaves no arrows or marks
// for its wrong line to point at.

import { authoredCards, cardsMode, type CardsElementLike } from "../spec/cards";
import type { Spec } from "../spec/types";
import type { LintIssue } from "./lint";

/** Under this many words a figure question cannot say its whole task. */
export const QUESTION_MIN_WORDS = 6;
/** About two lines of the headline (1.3 rem across the figure). */
export const HEADLINE_MAX_CHARS = 110;

/** An instruction with no object: "Sort them.", "Your turn.", "Sorter dem.", "Din tur." */
const INSTRUCTION_ONLY = /^((now\s+)?(sort|order|rank|match|place|drag|tap|try|sorter|ranger|plasser|dra|trykk på|prøv)\s+(them|it|these|this|dem|det|disse)(\s+(now|again|nå|igjen))?|your turn|din tur)[.!]?$/i;
/** "The arrows show …", "The marks show …", "Pilene viser …", "Merkene viser …" */
const POINTS_AT = /\b(the|these|those)\s+(arrows?|marks?)\s+(show|shows|point|points)\b|\b(pilene|pilen|merkene|merket)\s+(viser|peker)\b/i;

export function lintAsks(spec: Spec): LintIssue[] {
  const issues: LintIssue[] = [];
  const cards = new Map<string, CardsElementLike>();
  for (const e of spec.elements ?? []) if (e.type === "cards") cards.set(e.id, e as unknown as CardsElementLike);
  for (const c of authoredCards(spec)) cards.set(c.id, c);
  (spec.commands ?? []).forEach((c, i) => {
    const ask = c.ask;
    if (!ask) return;
    const figure = ask.on !== undefined || ask.blanks !== undefined || ask.pick !== undefined || Array.isArray(ask.choose);
    if (!figure) return;
    const q = typeof ask.question === "string" ? ask.question.trim() : "";
    if (q !== "") {
      const words = q.split(/\s+/).length;
      if (INSTRUCTION_ONLY.test(q) || words < QUESTION_MIN_WORDS) {
        issues.push({ rule: "ask-question", ids: [], severity: "warn", message: `commands[${i}].ask question "${q}" ${words < QUESTION_MIN_WORDS ? `is ${words} words` : "is an instruction with no object"} — it stands over the figure as the headline: a full sentence that names the task and what counts as right ("Which of these animals are mammals? Tap every mammal.")` });
      } else if (q.length > HEADLINE_MAX_CHARS) {
        issues.push({ rule: "ask-question", ids: [], severity: "warn", message: `commands[${i}].ask question is ${q.length} characters — the headline over the figure shows about ${HEADLINE_MAX_CHARS} (two lines); the rest is cut: say it shorter` });
      }
    }
    const one = typeof ask.on === "string" ? ask.on : Array.isArray(ask.on) && ask.on.length === 1 ? ask.on[0] : null;
    const cs = one !== null ? cards.get(one) : undefined;
    if (!cs || cardsMode(cs) !== "sort" || cs.check === "end") return;
    const v = ask.store ?? "f";
    for (const key of ["wrong", "right"] as const) {
      const line = ask[key];
      if (typeof line === "string" && POINTS_AT.test(line)) {
        issues.push({ rule: "cards-check", ids: [cs.id], severity: "warn", message: `commands[${i}].ask ${key}: "${line}" — ${cs.id} checks each card as it is dropped and moves a wrong one to its right box: no arrows or marks are left. Give the score: "{${v}} of {${v}.total} on the first try."` });
      }
    }
  });
  return issues;
}
