// Breathing between beats (Hans 2026-09-23): a cast whose beats start the
// instant the previous voice ends sounds like one endless sentence. The
// compiler prompt has always asked for a `pause` after the canonical beat,
// and the measured casts show how far that goes: the Sonnet specimen
// paused 6 times in 42 beats, Opus 5 in 52. So the breath is the player's,
// not the model's — deterministic, in the app and in the movie alike — and
// an author's own `pause` replaces it rather than adding to it.

import type { PlanStep } from "./plan";

/** Milliseconds of silence after a spoken beat, before the next step begins. */
export const BREATH_MS = {
  /** After an ordinary spoken beat — a beat is a paragraph in the script. */
  beat: 350,
  /** After a line that ends in a question mark: the question hangs. */
  question: 800,
  /** After the last spoken beat of a page, and before a quiz/ask/wait/explore or a clear — the end of a section. */
  section: 1000,
} as const;

/** The step kinds whose arrival closes a section. */
const SECTION_NEXT = new Set<PlanStep["kind"]>(["quiz", "ask", "wait", "explore", "clear"]);

/** What step `index` says aloud and holds the beat for; null when nothing, or when the voice runs under the next step. */
function spokenText(step: PlanStep): string | null {
  if (step.kind === "speak") return step.blocking ? step.text : null;
  return step.narration ?? null;
}

/**
 * The breath owed after step `index`, in ms at speed 1 — 0 for an unspoken
 * step, a non-blocking speak (it is meant to run under what follows), or a
 * spoken step the author already followed with a `pause`.
 */
export function breathAfterMs(steps: readonly PlanStep[], index: number): number {
  const step = steps[index];
  if (!step) return 0;
  const text = spokenText(step);
  if (text === null) return 0;
  const next = steps[index + 1];
  if (next?.kind === "pause") return 0;
  if (!next || SECTION_NEXT.has(next.kind)) return BREATH_MS.section;
  if (/[?？]\s*$/.test(text)) return BREATH_MS.question;
  return BREATH_MS.beat;
}
