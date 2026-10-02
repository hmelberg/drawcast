// The check-each counter (round 7 §3.1.6): ✓ right · ✗ wrong so far, small,
// on the figure by the boxes. Its texts carry `gap`, so it fades with
// "yours" at the next command (guess/reveal.ts fadeYours). Pure.

import { counterAt, type CardsGeometry } from "../spec/cards";
import { GUESS_COLOR, type GuessMarks, type GuessMarkText } from "../guess/marks";
import { RIGHT, TRUTH, WRONG } from "../guess/reveal";
import { checkTally, type Arrangement } from "./model";

/** A card corrected for the viewer stands at this strength. */
export const CORRECTED = 0.45;
export const COUNTER_SIZE = 20;

/** The counter for this arrangement, then any flashes still standing (`extra`). */
export function counterMarks(g: CardsGeometry, a: Arrangement, extra: GuessMarkText[] = []): GuessMarks {
  const { right, wrong } = checkTally(g, a);
  const [x, y] = counterAt(g);
  const at = (dx: number): [number, number] => [x + dx, y];
  const texts: GuessMarkText[] = [
    { at: at(-10), text: `✓ ${right}`, anchor: "end", color: RIGHT, size: COUNTER_SIZE, gap: true },
    { at: at(0), text: "·", anchor: "middle", color: TRUTH, size: COUNTER_SIZE, gap: true },
    { at: at(10), text: `✗ ${wrong}`, anchor: "start", color: WRONG, size: COUNTER_SIZE, gap: true },
  ];
  return { color: GUESS_COLOR, lines: [], texts: [...texts, ...extra] };
}
