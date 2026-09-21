// The board's two switches, wired to every surface that needs them.
//
// connect-gate.test.ts's style and its reason: no jsdom in this repo, so the
// tray and the gates cannot be mounted and pressed. The rules themselves are
// pure and tested (chess-prefs.test.ts, chessplay-model.test.ts); what is
// left here is the wiring whose absence would fail SILENTLY — a surface that
// keeps drawing the hints, or a door that settles honest geometry without
// dropping the viewer's flip and leaves every square mirrored underneath.
//
// Each expectation below was checked by BREAKING it.
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const read = (f: string): string => readFileSync(new URL(`../src/ui/${f}`, import.meta.url), "utf8");
const MARKERS: [string, string][] = [
  ["chessplay.ts", "free play"],
  ["chessdrill.ts", "the openings drill"],
  ["chessvs.ts", "the play-the-computer session"],
];

describe("the legal-move hints", () => {
  for (const [file, what] of MARKERS) {
    test(`${what} asks the setting before marking where a piece may go`, () => {
      const src = read(file);
      expect(src).toContain("selectionTargets(");
      expect(src).toContain("readShowLegalMoves()");
      // The raw target list is the thing selectionTargets gates. A surface
      // calling it directly would mark the squares whatever the setting says.
      expect(src).not.toContain("legalTargets(");
    });
  }
});

describe("which way the board faces", () => {
  test("free play never captures it — it reads it at every use", () => {
    // A captured flip and a turned board disagree about which square a point
    // is on: the piece you grab is the one three files away, and nothing on
    // screen explains it. The geometry calls must go through the getter.
    const src = read("chessplay.ts");
    expect(src).toContain("boardFlip(hd)");
    expect(src).not.toMatch(/const flip = hd\.spec\.params/);
    expect(src).not.toMatch(/chessSquareAt\(flip,/);
    expect(src).not.toMatch(/chessSquareBox\(flip,/);
  });

  test("free play carries it into every position it previews", () => {
    // previewParams REPLACES the override set each call (player.ts), so a
    // preview that leaves flip out paints the cast's view under a viewer who
    // turned the board — mid-drag, with a piece in the air.
    const src = read("chessplay.ts");
    for (const m of src.match(/previewParams\([^;]*/g) ?? []) expect(m).toContain("flip");
  });

  test("the play-the-computer session plays on the board it was started from", () => {
    const src = read("chessvs.ts");
    expect(src).toContain("boardFlip(hd)");
    for (const m of src.match(/previewParams\([^;]*/g) ?? []) expect(m).toContain("flip");
  });

  test("the drill keeps facing the side it drills, and asks nobody", () => {
    // Its flip is its own: the board turns to face the side being drilled.
    const src = read("chessdrill.ts");
    expect(src).toContain("flip = drilled === \"b\"");
    expect(src).not.toContain("boardFlip(");
  });

  test("every door that settles honest geometry drops the viewer's flip", () => {
    // Opening the tray, Continue ▸ and Play all draw the cast's own board.
    // Any one of them forgetting leaves the flip believed but not drawn.
    const src = read("tray.ts");
    expect(src.match(/clearViewerFlip\(hd\)/g)?.length).toBe(3);
    const play = read("chessplay.ts");
    expect(play).toContain("clearViewerFlip(hd)"); // …and so does a step or a scrub
  });

  test("the tray offers both switches on a chess figure", () => {
    const src = read("tray.ts");
    expect(src).toContain("setViewerFlip(hd,");
    expect(src).toContain("setShowLegalMoves(");
  });

  test("turning the board repaints it", () => {
    // Nothing else will: previewParams is the only way the figure is redrawn
    // while paused, and the tray has just shut itself.
    expect(read("chessplay.ts")).toContain("onBoardViewChange(hd,");
  });
});
