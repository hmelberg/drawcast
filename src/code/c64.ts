// The Commodore 64's screen, as data: the sixteen colours, the 40×25 grid a
// run leaves behind, and the two conversions a lesson needs (a colour code
// from a PETSCII control character, a screen code from a character).
//
// Its own file because two very different places need it and neither should
// pull the other in: code/basic.ts WRITES a screen, layout/code.ts DRAWS one,
// and the layout must never import an interpreter to learn what blue is.
// Dependency-free, like envelope.ts and languages.ts.

/** The C64 palette, in the machine's own order — 0 = black … 15 = light grey.
 *  These are the VICE/Pepto values, the ones every C64 screenshot on the web
 *  is measured against. */
export const C64_PALETTE = [
  "#000000", // 0 black
  "#ffffff", // 1 white
  "#813338", // 2 red
  "#75cec8", // 3 cyan
  "#8e3c97", // 4 purple
  "#56ac4d", // 5 green
  "#2e2c9b", // 6 blue
  "#edf171", // 7 yellow
  "#8e5029", // 8 orange
  "#553800", // 9 brown
  "#c46c71", // 10 light red
  "#4a4a4a", // 11 dark grey
  "#7b7b7b", // 12 grey
  "#a9ff9f", // 13 light green
  "#706deb", // 14 light blue
  "#b2b2b2", // 15 light grey
] as const;

export const C64_COLS = 40;
export const C64_ROWS = 25;
/** The screen a C64 wakes up on: light blue on blue, blue border. */
export const C64_BORDER = 14;
export const C64_BACKGROUND = 6;
/** The type. The machine's own power-on default is light blue (14); Hans
 *  asked for white (1), 2026-09-06 — one number to flip back. POKE 646 and the
 *  colour codes still do what they do. */
export const C64_TEXT = 1;

/**
 * What a run leaves on the screen. Strings rather than arrays so a stamped
 * envelope stays small and readable: one row per string, and the colours as
 * one hex digit per cell.
 */
export interface C64Screen {
  /** C64_ROWS strings of C64_COLS characters. */
  chars: string[];
  /** C64_ROWS strings of C64_COLS hex digits — the colour RAM. */
  colors: string[];
  border: number;
  background: number;
  /** Where the cursor waits — [row, col] — for the blinking square. */
  cursor?: [number, number];
}

/** PETSCII control codes that change the text colour, keyed by code. */
export const PETSCII_COLOR: Record<number, number> = {
  144: 0, 5: 1, 28: 2, 159: 3, 156: 4, 30: 5, 31: 6, 158: 7,
  129: 8, 149: 9, 150: 10, 151: 11, 152: 12, 153: 13, 154: 14, 155: 15,
};

/** Character → screen code (the value POKEd into screen RAM). Letters are the
 *  1-26 block, digits and punctuation their ASCII value, everything else a
 *  space — enough for the pokes a lesson actually writes. */
export function screenCode(ch: string): number {
  const c = ch.toUpperCase().charCodeAt(0);
  if (c >= 65 && c <= 90) return c - 64; // A-Z → 1-26
  if (c === 64) return 0; // @
  if (c >= 32 && c <= 63) return c; // space, digits, punctuation
  if (c === 91) return 27;
  if (c === 93) return 29;
  return 32;
}

/** Screen code → character, the inverse of screenCode for the same range. */
export function screenChar(code: number): string {
  const c = code & 0x7f;
  if (c === 0) return "@";
  if (c >= 1 && c <= 26) return String.fromCharCode(64 + c);
  if (c === 27) return "[";
  if (c === 29) return "]";
  if (c >= 32 && c <= 63) return String.fromCharCode(c);
  return " ";
}

/** The screen's shape: 40 × 25 characters of 8 × 8 pixels — 320 × 200. */
export const C64_SCREEN_ASPECT = 320 / 200;

/** What a C64 shows the moment it is switched on, row by row (the blank rows
 *  between are the machine's own spacing). Row 5 is where the cursor waits. */
export const C64_BOOT_LINES: readonly (readonly [row: number, text: string])[] = [
  [1, "    **** COMMODORE 64 BASIC V2 ****"],
  [3, " 64K RAM SYSTEM  38911 BASIC BYTES FREE"],
  [5, "READY."],
];

/**
 * Where a game runs: vc64web (VirtualC64 compiled to WebAssembly) as its own
 * page in an iframe — never its player script in ours. `openROMS=true` makes
 * it load the MEGA65 Open ROMs, so no Commodore ROM is ever distributed by
 * drawcast; the program URL rides last in the hash and autostarts (verified
 * 2026-09-05 against the emulator's own log: three OpenROM images loaded,
 * the .prg flashed, 50 frames/s). Hash-separated, so the program URL itself
 * may not contain a '#' — the lint says so.
 */
export function c64EmulatorUrl(game: string, opts: { touch?: boolean } = {}): string {
  // port2=true: the keyboard IS a joystick in port 2 (cursor keys, space to
  // fire) from the first frame — the port nearly every game reads. Without
  // it a viewer had to find the switch inside the emulator's own bar.
  //
  // touch=true, and it MUST come first (vc64web's own rule): on a phone or a
  // tablet there is no keyboard to be a joystick, so port 2 gets an on-screen
  // one instead. We hide the emulator's navbar, so a touch viewer could not
  // reach that switch at all — the game would simply not respond.
  const stick = opts.touch ? "#touch=true#port2=true" : "#port2=true";
  return `https://vc64web.github.io/#openROMS=true#navbar=hidden#wide=true#border=0.3${stick}#${game}`;
}

/**
 * Is the viewer's MAIN pointer a finger? `any-pointer` would also catch a
 * laptop with a touchscreen, where the keyboard is right there and the better
 * joystick. Defaults to false anywhere without matchMedia.
 */
export function prefersTouchJoystick(): boolean {
  try {
    return typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
  } catch {
    return false;
  }
}

/**
 * Whether a source is immediate mode — no line numbered — where the machine
 * runs each line the moment RETURN is pressed and prints under it, or a
 * program to be LISTed and RUN. The machine's own rule, so a lesson needs no
 * word for it. Here, and not in the interpreter, because the layout must
 * know which beats to mint before any run has happened.
 */
export function isImmediate(source: string): boolean {
  return !source.split("\n").some((l) => /^\s*\d+/.test(l));
}

/** A blank screen in the machine's own colours. */
export function blankScreen(): C64Screen {
  return {
    chars: Array.from({ length: C64_ROWS }, () => " ".repeat(C64_COLS)),
    colors: Array.from({ length: C64_ROWS }, () => String(C64_TEXT.toString(16)).repeat(C64_COLS)),
    border: C64_BORDER,
    background: C64_BACKGROUND,
  };
}
