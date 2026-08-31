// Fullscreen sizing, and the duplicate that broke it.
//
// `.viewer-figure` was a byte-for-byte copy of `.player-figure`, so every
// `:fullscreen` rule — all of them written against `.player-figure` — simply
// did not apply in the standalone viewer. A published drawcast went fullscreen
// with the stage still at `width:100%; aspect-ratio:4/3`, which on a 16:9
// screen is 133% of the screen's height: the drawing was LARGER than the
// screen, with no way to scroll to the rest of it.
//
// The frame is one class now. These tests hold that line, and hold the second
// half of the fix: the stage's fullscreen height is what the title, bar and
// caption leave over, never a guessed fraction of the viewport.
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

// Comments stripped first: they talk ABOUT the selectors they explain, and a
// rule reader that cannot tell the two apart reads every explanation as code.
const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const viewer = readFileSync(new URL("../src/viewer.ts", import.meta.url), "utf8").replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, "");

/** The declarations of every rule whose selector matches `pattern`. */
function rulesMatching(pattern: RegExp): string[] {
  const out: string[] = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  for (let m = re.exec(css); m !== null; m = re.exec(css)) {
    if (pattern.test(m[1])) out.push(m[2]);
  }
  return out;
}

describe("one frame for the player and the viewer", () => {
  test("the viewer mounts into the shared frame class", () => {
    expect(viewer).toContain('class: "player-figure"');
    expect(viewer).not.toContain("viewer-figure");
  });

  test("no .viewer-figure rule is left to drift out of step", () => {
    expect(rulesMatching(/\.viewer-figure\b/)).toEqual([]);
  });

  test("the fullscreen rules are reachable from the viewer", () => {
    // Every :fullscreen rule must be keyed on the shared class — a rule keyed
    // on anything else is a rule one of the two mounts would not get.
    const selectors = css.match(/[^{}]*:fullscreen[^{}]*(?=\{)/g) ?? [];
    expect(selectors.length).toBeGreaterThan(0);
    for (const sel of selectors) expect(sel).toContain(".player-figure:fullscreen");
  });
});

describe("the fullscreen stage is sized by what is left over", () => {
  const stage = rulesMatching(/\.player-figure:fullscreen\s+\.cs-stage/);

  test("there is such a rule", () => {
    expect(stage).toHaveLength(1);
  });

  test("its height comes from flex, not from a fraction of the viewport", () => {
    // `width: min(100%, calc(76vh * 4 / 3))` was the old guess: it assumed the
    // title, caption and control bar always fit in the other 24vh. A short
    // window or a three-line caption overflowed, and the overflow went half
    // above the top of the screen where nothing can scroll to it.
    expect(stage[0]).not.toMatch(/\d+vh/);
    expect(stage[0]).toMatch(/flex:\s*1\s+1\s+0/);
    expect(stage[0]).toMatch(/min-height:\s*0/);
  });

  test("it never grows wider than the screen", () => {
    expect(stage[0]).toMatch(/max-width:\s*100%/);
  });

  test("the figure between it and the screen is a column that can shrink", () => {
    const figure = rulesMatching(/\.player-figure:fullscreen\s+\.cs-figure/);
    expect(figure).toHaveLength(1);
    expect(figure[0]).toMatch(/flex-direction:\s*column/);
    expect(figure[0]).toMatch(/min-height:\s*0/);
  });
});
