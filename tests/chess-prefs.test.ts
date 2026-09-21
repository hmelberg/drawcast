// The board's viewer settings: what the legal-move hints do, and which way
// the board faces. One remembers itself across casts, the other is a preview
// that dies with every other preview — and the difference is the whole point.
import { describe, expect, test, vi } from "vitest";
import {
  boardFlip,
  clearViewerFlip,
  onBoardViewChange,
  readShowLegalMoves,
  setShowLegalMoves,
  setViewerFlip,
  SHOW_LEGAL_KEY,
} from "../src/ui/chess-prefs";

/** A stand-in for the one thing a cast's own params say about the board. */
const handle = (flip = false) => ({ spec: { params: { flip } } }) as never;

function withStorage<T>(fn: (mem: Map<string, string>) => T): T {
  const mem = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => void mem.set(k, v),
    removeItem: (k: string) => void mem.delete(k),
  });
  try {
    return fn(mem);
  } finally {
    vi.unstubAllGlobals();
  }
}

describe("the legal-move hints", () => {
  test("are OFF until someone turns them on", () => {
    withStorage(() => expect(readShowLegalMoves()).toBe(false));
  });

  test("are remembered once turned on, and again once turned off", () => {
    withStorage(() => {
      setShowLegalMoves(true);
      expect(readShowLegalMoves()).toBe(true);
      setShowLegalMoves(false);
      expect(readShowLegalMoves()).toBe(false);
    });
  });

  test("survive a browser with no storage at all — off, never a throw", () => {
    // No stub: this suite runs in plain node, which is the private-mode case.
    expect(() => setShowLegalMoves(true)).not.toThrow();
    expect(readShowLegalMoves()).toBe(false);
  });

  test("read as off when something else wrote nonsense under the key", () => {
    withStorage((mem) => {
      mem.set(SHOW_LEGAL_KEY, "{not json");
      expect(readShowLegalMoves()).toBe(false);
    });
  });
});

describe("which way the board faces", () => {
  test("is the cast's own flip until the viewer says otherwise", () => {
    const hd = handle(true);
    expect(boardFlip(hd)).toBe(true);
    clearViewerFlip(hd);
    expect(boardFlip(hd)).toBe(true);
  });

  test("is the viewer's the moment they turn the board", () => {
    const hd = handle(false);
    setViewerFlip(hd, true);
    expect(boardFlip(hd)).toBe(true);
    // …and turning it back is a viewer flip too, not a return to silence.
    setViewerFlip(hd, false);
    expect(boardFlip(hd)).toBe(false);
    clearViewerFlip(hd);
  });

  test("goes back to the cast's when the preview it rode on is dropped", () => {
    // Every other preview dies on Play, a scrub or Continue ▸. If this one
    // outlived them, the board would face one way and the squares under the
    // pointer the other — every click mirrored, with nothing to see.
    const hd = handle(false);
    setViewerFlip(hd, true);
    clearViewerFlip(hd);
    expect(boardFlip(hd)).toBe(false);
  });

  test("is per figure — one board turning never turns another", () => {
    const a = handle(false);
    const b = handle(false);
    setViewerFlip(a, true);
    expect(boardFlip(b)).toBe(false);
    clearViewerFlip(a);
  });

  test("tells whoever draws on the board when the VIEWER turns it — and only then", () => {
    // Turning it needs a repaint (and free play's ring and dots, placed from
    // the square boxes, are in the mirrored place until they are dropped).
    // Dropping it does NOT: every door that clears it — Play, Continue ▸, a
    // step, opening the tray — has just settled honest geometry itself, and
    // a repaint fired from here would dirty what they just settled.
    const hd = handle(false);
    const seen: boolean[] = [];
    const off = onBoardViewChange(hd, () => seen.push(boardFlip(hd)));
    setViewerFlip(hd, true);
    clearViewerFlip(hd);
    off();
    setViewerFlip(hd, true); // nobody listening any more
    expect(seen).toEqual([true]);
    clearViewerFlip(hd);
  });
});
