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
  test("both mount paths chain through the same helper (single-item lecture and multi-item playlist)", () => {
    expect(src.match(/chainCallbacks\(hd, /g)?.length).toBe(2);
  });
  test("onItemDone and showNextLink stay no-ops for a single-item playlist (multi-item behaviour is unchanged)", () => {
    const guard = "if (items.length <= 1) return;";
    expect(src.split(guard).length - 1).toBe(2);
    expect(src).toMatch(/function onItemDone\([^)]*\)[^{]*\{\s*if \(items\.length <= 1\) return;/);
    expect(src).toMatch(/function showNextLink\([^)]*\)[^{]*\{\s*if \(items\.length <= 1\) return;/);
  });
  test("the single-item path chains after attachPlayerControls installs its own callbacks", () => {
    const controls = src.indexOf("attachPlayerControls(host, hd, prefs, controlOpts)");
    const chain = src.indexOf("chainCallbacks(hd, 0)");
    expect(controls).toBeGreaterThan(0);
    expect(chain).toBeGreaterThan(controls);
  });
});
