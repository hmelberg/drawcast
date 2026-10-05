// Round 7's gate words come in both tongues (Review Focus 5): a Norwegian
// cast never shows an English Done or hint.
import { expect, test } from "vitest";
import { gateWords } from "../src/ui/gate-words";

test("every cards hint has a Norwegian twin, and the new words exist in both", () => {
  const en = gateWords("en"), nb = gateWords("nb");
  expect(Object.keys(nb.cards).sort()).toEqual(Object.keys(en.cards).sort());
  for (const k of ["sortEach", "selectEach"]) {
    expect(en.cards[k]).toBeTruthy();
    expect(nb.cards[k]).toBeTruthy();
    expect(nb.cards[k]).not.toBe(en.cards[k]);
  }
  expect(en.done).toBe("Done");
  expect(nb.done).toBe("Ferdig");
});
test("the tag on the viewer's own answer (the reorder's yours row too), in both tongues", () => {
  expect(gateWords("en").yours).toBe("You");
  expect(gateWords("nb").yours).toBe("Du");
});
