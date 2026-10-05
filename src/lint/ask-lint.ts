// What a figure question says (round 7 §8.1, §8.2, §3.6): its question
// stands over the figure as the headline, so it is a full sentence naming
// the task and what counts as right — read without the narration, in two
// lines at most. And a sort judged card by card leaves no arrows or marks
// for its wrong line to point at.
//
// Under a page heading that already asks the question (Hans 2026-10-05), the
// heading is the headline and `question` gives the task only: a task-only
// sentence is fine there, and a question that restates both the heading and
// the line spoken before it is the same sentence a third time.

import { authoredCards, cardsGeometry, cardsMode, resolveCardsSize, type CardsElementLike } from "../spec/cards";
import { authoredScales, type ScaleElementLike } from "../spec/scale";
import { pageHeading } from "../spec/card";
import { restates, splitQuestion } from "../spec/question-echo";
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
  issues.push(...lintCardTexts(spec, [...cards.values()]));
  // The page's heading as each command finds it: the last card's title, else
  // the default heading (the title), else an expanded card heading's text.
  const headings = new Map((spec.elements ?? []).filter((e) => /^card_\d+_title$/.test(e.id) && typeof e.text === "string").map((e) => [e.id, String(e.text)]));
  let heading: string | null = pageHeading(spec);
  let lastSpeak: string | null = null;
  (spec.commands ?? []).forEach((c, i) => {
    if (typeof c.card?.title === "string") heading = c.card.title;
    for (const id of Array.isArray(c.draw) ? c.draw : typeof c.draw === "string" ? [c.draw] : []) if (typeof id === "string" && headings.has(id)) heading = headings.get(id)!;
    const ask = c.ask;
    const spokeBefore = lastSpeak;
    if (typeof c.speak === "string" && c.speak.trim() !== "") lastSpeak = c.speak;
    if (!ask) return;
    const figure = ask.on !== undefined || ask.blanks !== undefined || ask.pick !== undefined || Array.isArray(ask.choose);
    if (!figure) return;
    const q = typeof ask.question === "string" ? ask.question.trim() : "";
    const taskOnly = heading !== null && splitQuestion(q).question === "";
    if (q !== "" && heading !== null && restates(q, heading) && restates(q, spokeBefore)) {
      issues.push({ rule: "ask-question", ids: [], severity: "warn", message: `commands[${i}].ask question "${q}" asks again what the heading ("${heading}") and the line before it already ask — give the task only ("Click on the line where you think it is."): the heading stays the headline and the voice asks once` });
    }
    if (q !== "" && !taskOnly) {
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

/**
 * Card text wraps to two lines (page frame 2026-10-04 §4); a text that needs a
 * third is drawn smaller to fit — say it shorter. Judged at the size the cards
 * are drawn (an authored set as the expansion resolves it). A deck's small
 * cards have their own rule (lint.ts deck-text: one line).
 */
function lintCardTexts(spec: Spec, sets: CardsElementLike[]): LintIssue[] {
  const out: LintIssue[] = [];
  const scales = authoredScales(spec);
  const scaleOf = (sid: string): ScaleElementLike | undefined => scales.find((x) => x.id === sid) ?? ((spec.elements ?? []).find((e) => e.id === sid && e.type === "scale") as unknown as ScaleElementLike | undefined);
  const raw = new Set((spec.elements ?? []).filter((e) => e.type === "cards").map((e) => e.id));
  for (const el of sets) {
    if (el.deck === true || cardsMode(el) === "fill") continue;
    const g = cardsGeometry(raw.has(el.id) ? resolveCardsSize(el, spec, scaleOf) : el, scaleOf);
    for (const i of g.tooLong ?? []) {
      out.push({ rule: "cards-text", ids: [el.id], severity: "warn", message: `${el.id} card ${i + 1}: "${g.texts[i]}" needs three lines on its card (cards wrap to two) — it is drawn smaller; say it in a word or three` });
    }
  }
  return out;
}
