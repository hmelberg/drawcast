// The export's question performances, as pure timelines: a movie cannot be
// answered, so the card demonstrates — the quiz hovers across the options
// like someone thinking and settles on the correct one; the typed ask types
// its answer character by character. paintFrame renders these frames; the
// export gates hold for the duration and then resolve.

const APPEAR_MS = 400;
const HOLD_MS = 900;
const HOVER_MS = 500; // per choice in the walk
const SELECT_MS = 800; // rest on the selection before resolving
const TYPE_MS = 75; // per character
const SETTLE_MS = 800; // rest on the finished text

export interface QuizDemoFrame {
  hover: number | null;
  selected: boolean;
  done: boolean;
}

export function quizDemoDuration(choiceCount: number): number {
  return APPEAR_MS + HOLD_MS + HOVER_MS * choiceCount + SELECT_MS;
}

/** The walk visits every choice in order and ends on the correct one. */
export function quizDemoAt(elapsedMs: number, choiceCount: number, correct: number): QuizDemoFrame {
  const walkStart = APPEAR_MS + HOLD_MS;
  if (elapsedMs < walkStart) return { hover: null, selected: false, done: false };
  const walkEnd = walkStart + HOVER_MS * choiceCount;
  if (elapsedMs < walkEnd) {
    const i = Math.min(choiceCount - 1, Math.floor((elapsedMs - walkStart) / HOVER_MS));
    // The last leg of the walk lands on the correct choice.
    return { hover: i === choiceCount - 1 ? correct : i, selected: false, done: false };
  }
  return { hover: correct, selected: true, done: elapsedMs >= quizDemoDuration(choiceCount) };
}

export interface AskDemoFrame {
  typedChars: number;
  done: boolean;
}

export function askDemoDuration(text: string): number {
  return APPEAR_MS + HOLD_MS + TYPE_MS * text.length + SETTLE_MS;
}

export function askDemoAt(elapsedMs: number, text: string): AskDemoFrame {
  const typeStart = APPEAR_MS + HOLD_MS;
  if (elapsedMs < typeStart) return { typedChars: 0, done: false };
  const chars = Math.min(text.length, Math.floor((elapsedMs - typeStart) / TYPE_MS));
  return { typedChars: chars, done: elapsedMs >= askDemoDuration(text) };
}
