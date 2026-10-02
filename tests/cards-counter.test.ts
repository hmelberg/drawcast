// The check-each counter (round 7 §3.1.6): ✓ n · ✗ m, green, ink, red,
// centred on the boxes, and faded with "yours" at the next command.
import { expect, test } from "vitest";
import { cardsGeometry, counterAt, type CardsElementLike } from "../src/spec/cards";
import { checkDrop, initialArrangement } from "../src/cards/model";
import { counterMarks } from "../src/cards/counter";
import { FADED, RIGHT, TRUTH, WRONG, fadeYours } from "../src/guess/reveal";

const two: CardsElementLike = { id: "c", type: "cards", bins: ["Fixed", "Variable"], items: [{ text: "Rent", bin: "Fixed" }, { text: "Flour", bin: "Variable" }, { text: "Tax", bin: "Fixed" }] };

test("✓ n · ✗ m, in green, ink and red, all fading at the next command", () => {
  const g = cardsGeometry(two);
  const a = checkDrop(g, initialArrangement(g), 0, 1).arr;
  const m = counterMarks(g, a);
  expect(m.texts.map((t) => t.text)).toEqual(["✓ 0", "·", "✗ 1"]);
  expect(m.texts.map((t) => t.color)).toEqual([RIGHT, TRUTH, WRONG]);
  expect(m.texts.every((t) => t.gap === true && t.size === 20)).toBe(true);
  expect(fadeYours(m, FADED).texts.every((t) => t.opacity === FADED)).toBe(true);
  // A flash rides along after the counter.
  expect(counterMarks(g, a, [{ at: [0, 0], text: "✗", anchor: "start" }]).texts).toHaveLength(4);
});

test("rise (today's layout): centred under the boxes, clear of the tray and of the headline strip", () => {
  const g = cardsGeometry(two);
  const [x, y] = counterAt(g);
  const bottom = Math.min(...g.binBoxes.map((b) => b.c[1] - b.h / 2));
  const trayTop = Math.max(...g.home.map((p) => p[1] + g.h / 2));
  expect(y + 10).toBeLessThan(bottom);
  expect(y - 10).toBeGreaterThan(trayTop);
  const left = Math.min(...g.binBoxes.map((b) => b.c[0] - b.w / 2));
  const right = Math.max(...g.binBoxes.map((b) => b.c[0] + b.w / 2));
  expect(x).toBeCloseTo((left + right) / 2, 5);
});
