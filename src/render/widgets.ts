// Widget geometry for the figure-answer devices. The piano math MIRRORS the
// piano_keys template's layout constants (src/scenes/packs/music.yaml) — the
// template draws in absolute logical units, so key hit-boxes are computable
// without per-key elements. KEEP IN SYNC with the template's constants.

import type { BBox } from "../layout/geometry";
import type { Pt } from "../layout/model";

const WHITE = ["C", "D", "E", "F", "G", "A", "B"] as const;
const HAS_SHARP: Record<string, boolean> = { C: true, D: true, E: false, F: true, G: true, A: true, B: false };

function pianoConsts(octaves: 1 | 2) {
  const nWhite = octaves * 7;
  const KW = Math.min(60, 760 / nWhite);
  const X0 = (1000 - nWhite * KW) / 2;
  return { nWhite, KW, X0, Y_BOT: 250, Y_TOP: 520, BLACK_BOT: 370, BW: KW * 0.62, startOct: octaves === 1 ? 4 : 3 };
}

/** The note under a logical y-up point on a piano_keys figure, or null. Sharps ("C#4"), never flats. */
export function pianoKeyAt(octaves: 1 | 2, p: Pt): string | null {
  const c = pianoConsts(octaves);
  const [x, y] = p;
  if (y < c.Y_BOT || y > c.Y_TOP || x < c.X0 || x > c.X0 + c.nWhite * c.KW) return null;
  if (y >= c.BLACK_BOT) {
    // The black zone: a sharp sits astride the boundary right of its white key.
    for (let i = 0; i < c.nWhite - 1; i++) {
      const letter = WHITE[i % 7];
      if (!HAS_SHARP[letter]) continue;
      const bx = c.X0 + (i + 1) * c.KW - c.BW / 2;
      if (x >= bx && x <= bx + c.BW) return `${letter}#${c.startOct + Math.floor(i / 7)}`;
    }
  }
  const wi = Math.min(c.nWhite - 1, Math.floor((x - c.X0) / c.KW));
  return `${WHITE[wi % 7]}${c.startOct + Math.floor(wi / 7)}`;
}

/** The hit-box of a note on a piano_keys figure (for the movie's pointer demo). */
export function pianoKeyBox(octaves: 1 | 2, note: string): BBox | null {
  const c = pianoConsts(octaves);
  const m = /^([A-G])(#?)(\d)$/i.exec(note.trim());
  if (!m) return null;
  const letter = m[1].toUpperCase();
  const sharp = m[2] === "#";
  const oct = Number(m[3]) - c.startOct;
  const wi = oct * 7 + WHITE.indexOf(letter as (typeof WHITE)[number]);
  if (wi < 0 || wi >= c.nWhite) return null;
  if (sharp) {
    if (!HAS_SHARP[letter] || wi >= c.nWhite - 1) return null;
    const bx = c.X0 + (wi + 1) * c.KW - c.BW / 2;
    return { x: bx, y: c.BLACK_BOT, w: c.BW, h: c.Y_TOP - c.BLACK_BOT };
  }
  return { x: c.X0 + wi * c.KW, y: c.Y_BOT, w: c.KW, h: c.Y_TOP - c.Y_BOT };
}

/** The piano_keys octaves param, exactly as the template folds it. */
export function pianoOctaves(params: Record<string, unknown> | null | undefined): 1 | 2 {
  return params?.["octaves"] === 1 ? 1 : 2;
}

// Chess board geometry — mirrors the chess_board template's constants
// (src/scenes/packs/games.yaml): BOARD 620 centered, CELL = BOARD/8.
const CH_BOARD = 620;
const CH_X0 = (1000 - CH_BOARD) / 2;
const CH_Y0 = (750 - CH_BOARD) / 2;
const CH_CELL = CH_BOARD / 8;

/** The algebraic square under a logical y-up point, or null off the board. */
export function chessSquareAt(flip: boolean, p: Pt): string | null {
  const col = Math.floor((p[0] - CH_X0) / CH_CELL);
  const row = Math.floor((p[1] - CH_Y0) / CH_CELL); // 0 = bottom
  if (col < 0 || col > 7 || row < 0 || row > 7) return null;
  const file = String.fromCharCode(97 + (flip ? 7 - col : col));
  const rank = flip ? 8 - row : row + 1;
  return `${file}${rank}`;
}

/** The hit-box of an algebraic square (for the movie's pointer demo). */
export function chessSquareBox(flip: boolean, square: string): BBox | null {
  const m = /^([a-h])([1-8])$/i.exec(square.trim());
  if (!m) return null;
  const f = m[1].toLowerCase().charCodeAt(0) - 97;
  const r = Number(m[2]);
  const col = flip ? 7 - f : f;
  const row = flip ? 8 - r : r - 1;
  return { x: CH_X0 + col * CH_CELL, y: CH_Y0 + row * CH_CELL, w: CH_CELL, h: CH_CELL };
}

/**
 * Computer-keyboard note entry for a piano figure: the LETTER ON THE DRAWN
 * KEY is the key you type (press E for the E key — the labels are the
 * mapping), Shift adds the sharp where one exists. Notes land in the
 * keyboard's first octave.
 */
export function pianoNoteForKey(octaves: 1 | 2, key: string, shift: boolean): string | null {
  const letter = key.length === 1 ? key.toUpperCase() : "";
  if (!(WHITE as readonly string[]).includes(letter)) return null;
  if (shift && !HAS_SHARP[letter]) return null;
  const startOct = octaves === 1 ? 4 : 3;
  return `${letter}${shift ? "#" : ""}${startOct}`;
}
