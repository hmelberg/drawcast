// Test me hides the numbers a cast wrote on the figure (polish 2026-10-04 A3).
import { expect, test } from "vitest";
import { writtenNumbers } from "../src/render/player";
import type { SpecElement } from "../src/spec/types";

test("only visible text elements with a digit", () => {
  const els = [
    { id: "n1", type: "text", text: "<10", x: 0, y: 0 },
    { id: "n7", type: "text", text: "610,000", x: 0, y: 0 },
    { id: "word", type: "text", text: "Mosquito", x: 0, y: 0 },
    { id: "box", type: "node", text: "500", x: 0, y: 0 },
  ] as unknown as SpecElement[];
  expect(writtenNumbers(els, new Set(["n1", "word", "box"]))).toEqual(["n1"]);
});
