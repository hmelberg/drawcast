// Which frames the dev frame harness (src/dev/frames.ts) draws, and why —
// pure, so the tests can read the list without a browser.
//
// A frame is a boundary the viewer actually sits at: the first beat that puts
// ink down, every boundary where an animate has committed new params
// (plan.states[i].params), the last boundary — and, with everyBeat, the
// boundary after every narrated line.
//
// QUESTIONS get a pair (2026-10-04). The boundary AFTER a quiz or an ask is
// the revealed state: the cards in their true order, the guessed part at its
// truth, the reveal stamp down. A tile taken there shows a reviewer what a
// live viewer never sees while answering, and none of the question itself.
// So every question has:
//
//   "@N question (before the answer)"  the boundary BEFORE the step — the
//        figure as it stands when the gate opens (the harness then opens the
//        real gate on it: the headline, the cards at home, the buttons);
//   "@N answer (after the reveal)"     the boundary after it — played to,
//        with a stand-in viewer's wrong-ish answer kept beside the truth
//        and the feedback line captioned (dev/frames.ts answerQuestion).
//
// N is the question's own step number (1-based), the same in both labels.

export interface FrameSpot {
  /** The boundary whose state the frame shows: the figure after this many plan steps. */
  at: number;
  /** Why this frame is here — "first ink", an animate's overrides, a beat's line, "end", or a question's pair. */
  changed: string;
  /** A question's frames: its step number (1-based), the @N both of the pair are labelled with. */
  ask?: number;
  /** The question frame of the pair: the state at `at` with the question's gate open on it. */
  before?: true;
}

interface PlanLike {
  steps: { kind: string; text?: string; narration?: string }[];
  states: { params?: Record<string, number> }[];
}

export const QUESTION_LABEL = "question (before the answer)";
export const ANSWER_LABEL = "answer (after the reveal)";

/** Boundaries worth a picture, with why — in playing order, a question's pair together. */
export function frameList(plan: PlanLike, everyBeat = false): FrameSpot[] {
  // Questions first, so a boundary that is also a beat, the end or first
  // ink keeps the question's name (dedupe keeps the first reason given).
  const out: FrameSpot[] = [];
  plan.steps.forEach((s, i) => {
    if (s.kind !== "quiz" && s.kind !== "ask") return;
    out.push({ at: i, changed: QUESTION_LABEL, ask: i + 1, before: true });
    out.push({ at: i + 1, changed: ANSWER_LABEL, ask: i + 1 });
  });
  const firstDraw = plan.steps.findIndex((s) => s.kind === "draw");
  if (firstDraw >= 0) out.push({ at: firstDraw + 1, changed: "first ink" });
  let prev = "{}";
  plan.states.forEach((state, i) => {
    const key = JSON.stringify(state.params ?? {});
    if (key !== prev) {
      // An animate commits its overrides at this boundary. Report the delta,
      // not the whole accumulated set — what CHANGED is the interesting part.
      out.push({ at: i + 1, changed: `animate ${key}` });
      prev = key;
    }
  });
  if (plan.steps.length > 0) out.push({ at: plan.steps.length, changed: "end" });
  // Every beat (?beats=all): a frame after each narrated line — what the
  // viewer sees while it is spoken. Resting frames alone never show a camera
  // zoom, the middle of a derivation or a label placed and later erased,
  // which is where layouts break (the ledger's feature ideas 2 and 8; two
  // agents built their own truncation hacks for it, 2026-09-25).
  if (everyBeat) {
    plan.steps.forEach((s, i) => {
      const line = s.kind === "speak" ? s.text : s.narration;
      if (line) out.push({ at: i + 1, changed: `beat “${line.length > 40 ? line.slice(0, 39) + "…" : line}”` });
    });
  }
  // Dedupe: one plain frame per boundary, keeping the first reason given for
  // it; a question frame is its own (its boundary may also be the line
  // before it, drawn without the gate).
  const seen = new Set<string>();
  const key = (f: FrameSpot): string => (f.before ? `q${f.at}` : `${f.at}`);
  const kept = out.filter((f) => (seen.has(key(f)) ? false : (seen.add(key(f)), true)));
  // Playing order: a question frame sits where its step does — after the
  // plain frame of its own boundary (the line before it), before its answer.
  const order = (f: FrameSpot): number => (f.before ? f.at + 0.5 : f.at);
  return kept.sort((a, b) => order(a) - order(b));
}

/** How a frame is labelled on the sheet and in the CLI: its boundary, or a question's step number. */
export function frameLabel(f: { at: number; changed: string; ask?: number }): string {
  return `@${f.ask ?? f.at} ${f.changed}`;
}
