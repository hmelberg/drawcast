// The stored-answers round (spec docs/superpowers/specs/2026-09-15-stored-answers-design.md):
// quiz store, the _answers namespace with .ok/.secs, carry across playlist
// items, the movie's mirror of the names, the local record, and the lint.
import { describe, expect, test } from "vitest";
import { collectSpeakLines } from "../src/export/video";
import type { Spec } from "../src/spec/types";

describe("the movie's lines", () => {
  test("store the correct option under a quiz store", () => {
    const lines = collectSpeakLines({
      elements: [],
      commands: [{ quiz: { question: "Pick?", choices: ["apples", "pears"], correct: 2, store: "pick" } }, { speak: "You chose {pick}." }],
    } as unknown as Spec);
    expect(lines.map((l) => l.text)).toContain("You chose pears.");
  });
});
