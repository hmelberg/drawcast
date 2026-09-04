// The session's learner hooks. mountPlaylist needs a DOM (no jsdom here), so
// this guards the wiring by source text, as tests/views-viewer.test.ts does.
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const src = readFileSync(new URL("../src/playlist/session.ts", import.meta.url), "utf8").replace(/^\s*\/\/.*$/gm, "");

describe("session learner hooks", () => {
  test("onAnswer is chained after the previous callback and passes the item", () => {
    expect(src).toMatch(/onAnswer\?\(answer: AnswerEvent, item: PlaylistItem\): void/);
    expect(src).toMatch(/onAnswer: \(a\) => \{\s*prev\.onAnswer\?\.\(a\);\s*opts\.onAnswer\?\.\(a, items\[i\]\);/);
  });
  test("onDone fires inside the done branch, only for the last item, once", () => {
    expect(src).toMatch(/onDone\?\(\): void/);
    const done = src.indexOf('if (s === "done") {');
    const fire = src.indexOf("opts.onDone?.()");
    expect(done).toBeGreaterThan(0);
    expect(fire).toBeGreaterThan(done);
    expect(src).toMatch(/if \(i === items\.length - 1 && !doneReported\) \{\s*doneReported = true;\s*opts\.onDone\?\.\(\);/);
  });
});
