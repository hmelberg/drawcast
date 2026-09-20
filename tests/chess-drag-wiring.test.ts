// The drag gesture is mounted on every surface that moves a piece, and none
// of them keeps a private copy of it.
//
// In connect-gate.test.ts's style, and for its reason: there is no jsdom
// anywhere in this repo (vite.config.ts sets `environment: "node"`), so a
// gate cannot actually be mounted, pressed or dragged in a test. The gesture
// itself is pure and genuinely tested (tests/chess-drag.test.ts); what is
// left here is the wiring, and only the parts of it whose absence would fail
// SILENTLY — a surface that quietly kept its click-only handler still works,
// it just never learns to drag, and nothing in the build would say so.
//
// Each expectation below was checked by BREAKING it: unhooking a surface, or
// letting the helper drop a listener, fails the test that names it.
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const read = (f: string): string => readFileSync(new URL(`../src/ui/${f}`, import.meta.url), "utf8");
const SURFACES: [string, string][] = [
  ["controls.ts", "the ask gate"],
  ["chessdrill.ts", "the openings drill"],
  ["chessvs.ts", "the play-the-computer session"],
  ["chessplay.ts", "free play on a paused board"],
];

describe("every surface that moves a piece", () => {
  for (const [file, what] of SURFACES) {
    test(`${what} mounts the shared gesture`, () => {
      expect(read(file)).toContain("attachChessDrag(");
    });
  }

  // The gates used to read the board themselves, in a click handler. Doing so
  // again would be a second gesture on the same squares — the one that cannot
  // drag — racing the shared one.
  for (const file of ["controls.ts", "chessdrill.ts", "chessvs.ts"]) {
    test(`${file} leaves the board's geometry to the gesture`, () => {
      expect(read(file)).not.toContain("chessSquareAt");
    });
  }

  test("free play keeps its own square lookup only to swallow the click", () => {
    // chessplay.ts still asks chessSquareAt one thing — whether the click that
    // follows a press on the board should reach the play/pause toggle. That is
    // the suppression listener, not a second state machine.
    const src = read("chessplay.ts");
    expect(src.match(/chessSquareAt/g)?.length).toBe(2); // the import, and the click guard
    expect(src).not.toContain('addEventListener(\n    "pointerdown"');
  });
});

describe("the gesture's DOM half", () => {
  const src = read("chess-drag.ts");

  test("reads the gesture through the tested core, never its own arithmetic", () => {
    expect(src).toContain("squareDrag(");
    expect(src).not.toContain("Math.hypot"); // the threshold lives in the model
  });

  test("carries the piece on the renderer's own offset", () => {
    expect(src).toContain("hd.timeline.nudge(");
  });

  test("hears every way a gesture can end, or a piece hangs on an offset nobody owns", () => {
    // A press that ends in any of these three ways and is not heard leaves the
    // dragged piece sitting off its square until the next repaint.
    for (const ending of ["pointerup", "pointercancel", "lostpointercapture"]) {
      expect(src).toContain(`"${ending}"`);
    }
  });

  test("a drop on a pill is the pill's gesture, not the board's", () => {
    // Under pointer capture every event retargets to the captor, so the
    // event's own target cannot tell Skip or ✕ from paper — only the point can.
    expect(src).toContain("elementFromPoint");
  });
});
