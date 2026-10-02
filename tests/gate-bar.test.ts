// One family for the bottom bar (round 7 §8.3): Skip and Answer (or Done) are
// pills of one shape, font, height and border — Answer filled in the guess
// blue, Skip muted — with no shadow and no pulse, on every gate that docks.
import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { gateWords } from "../src/ui/gate-words";

const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
const rule = (sel: RegExp) => sel.exec(css)?.[1] ?? "";

describe("the bar's pills", () => {
  test("one shape, font and border for Answer, Skip and Done, with no shadow or pulse", () => {
    const family = rule(/\.cs-gatedock > \.cs-guess-answer,\s*\.cs-gatedock > \.cs-figgate-skip,\s*\.cs-connect-bar > \.cs-cardgate-pill,\s*\.cs-draggate > \.cs-figgate-skip\s*\{([^}]*)\}/);
    expect(family).toMatch(/border-radius:\s*999px/);
    expect(family).toMatch(/font-family:\s*var\(--sketch-font\)/);
    expect(family).toMatch(/border-style:\s*solid/);
    expect(family).toMatch(/box-shadow:\s*none/);
    expect(family).toMatch(/animation:\s*none/);
  });
  test("Answer and Done filled in the guess blue; Skip muted", () => {
    expect(rule(/\.cs-gatedock > \.cs-guess-answer,\s*\.cs-connect-bar > \.cs-cardgate-pill\.ok\s*\{([^}]*)\}/)).toMatch(/background:\s*#3f6fb5/);
    expect(rule(/\.cs-gatedock > \.cs-figgate-skip,\s*\.cs-connect-bar > \.cs-cardgate-pill\.skip,\s*\.cs-draggate > \.cs-figgate-skip\s*\{([^}]*)\}/)).toMatch(/color:\s*var\(--muted\)/);
  });
  test("connect's hint no longer pulses", () => {
    expect(rule(/\.cs-connect-hint\s*\{([^}]*)\}/)).toMatch(/animation:\s*none/);
  });
  test("check: each (no Answer): Skip stands alone, centred — a hidden Answer takes no room (spec §8.3)", () => {
    // The global rule wins over any pill's own display, and the bar centres what is left.
    expect(css).toMatch(/\[hidden\]\s*\{\s*display:\s*none\s*!important;?\s*\}/);
    expect(rule(/\.cs-gatedock\s*\{([^}]*)\}/)).toMatch(/justify-content:\s*center/);
    // And nothing in the family gives the pills a fixed slot or an auto margin.
    expect(css).not.toMatch(/\.cs-gatedock > \.cs-figgate-skip[^{]*\{[^}]*margin-(right|left):\s*auto/);
  });
});

test("connect's words in both tongues (no English left in the gate)", () => {
  expect(gateWords("en").connect).toMatch(/Press a star and drag to the next/);
  expect(gateWords("nb").connect).toMatch(/Trykk på en stjerne/);
  const src = readFileSync(new URL("../src/ui/connect-gate.ts", import.meta.url), "utf8");
  expect(src).not.toMatch(/"Done ▸"/);
  expect(src).toMatch(/mountGateHead\(/);
  expect(readFileSync(new URL("../src/ui/drag-gate.ts", import.meta.url), "utf8")).toMatch(/mountGateHead\(/);
});
