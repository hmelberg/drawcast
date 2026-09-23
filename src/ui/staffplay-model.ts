// The staff as an instrument — the pure half (design 2026-09-24-music-
// notation-and-staff §5). Where the staves are, read off the laid-out
// figure's own staff lines (never re-derived from constants that could
// drift from music.yaml); which pitch a point on them is; which key of the
// note_sheet keyboard a point is on; and how a composed line is written back
// into the template's notation.

import type { Drawable } from "../layout/model";
import { leafDrawables } from "../layout/model";

type Pt = [number, number];

export interface Staff {
  /** "staff" (the upper, or only, one) or "bass_staff" (a grand staff's lower). */
  id: "staff" | "bass_staff";
  /** y of the bottom line, and the gap between lines. */
  bottom: number;
  gap: number;
  /** Diatonic number (octave*7 + letter) of the bottom line: E4 = 30, G2 = 18. */
  ref: number;
  x0: number;
  x1: number;
}

const LETTERS = "CDEFGAB";

/** "E4" → 30. */
export function diatOf(pitch: string): number {
  return Number(pitch[pitch.length - 1]) * 7 + LETTERS.indexOf(pitch[0]);
}

/** 30 → "E4". */
export function pitchOfDiat(d: number): string {
  return `${LETTERS[((d % 7) + 7) % 7]}${Math.floor(d / 7)}`;
}

/**
 * The staves of a laid-out note_sheet, from its drawn lines. `clef` is the
 * template's param: a single staff is bass when it says so, else treble;
 * a grand staff's upper staff is treble and its lower bass.
 */
export function stavesOf(drawables: Drawable[], clef: unknown): Staff[] {
  const leaves = leafDrawables(drawables);
  const out: Staff[] = [];
  for (const id of ["staff", "bass_staff"] as const) {
    const lines = [0, 1, 2, 3, 4].map((i) => leaves.find((d) => d.id === `${id}__l${i}`));
    if (lines.some((l) => !l || l.kind !== "stroke")) continue;
    const ys = lines.map((l) => (l as { pts: Pt[] }).pts[0][1]);
    const xs = (lines[0] as { pts: Pt[] }).pts.map((p) => p[0]);
    const bass = id === "bass_staff" || clef === "bass";
    out.push({ id, bottom: ys[0], gap: ys[1] - ys[0], ref: bass ? 18 : 30, x0: Math.min(...xs), x1: Math.max(...xs) });
  }
  return out;
}

/**
 * The pitch under a point on a staff: the nearest line or space, reaching
 * three ledger lines above and below. Null off the staves. With two staves
 * the nearer one answers — the gap between them belongs half to each.
 */
export function staffPitchAt(staves: Staff[], p: Pt): { staff: Staff; pitch: string } | null {
  let best: { staff: Staff; pitch: string; dist: number } | null = null;
  for (const s of staves) {
    if (p[0] < s.x0 || p[0] > s.x1) continue;
    const lo = s.bottom - 3.5 * s.gap, hi = s.bottom + 7.5 * s.gap;
    if (p[1] < lo || p[1] > hi) continue;
    const dist = Math.abs(p[1] - (s.bottom + 2 * s.gap));
    if (best && best.dist <= dist) continue;
    const steps = Math.round((p[1] - s.bottom) / (s.gap / 2));
    best = { staff: s, pitch: pitchOfDiat(s.ref + steps), dist };
  }
  return best && { staff: best.staff, pitch: best.pitch };
}

/** The staff position a pitch is written at — its y. */
export function staffYOf(s: Staff, pitch: string): number {
  return s.bottom + (diatOf(pitch.replace("#", "")) - s.ref) * (s.gap / 2);
}

/**
 * The octave note_sheet's keyboard starts at — the SAME rule its layout
 * uses: the lowest octave any token reaches, at most 6, 4 when nothing
 * sounds. Pinned against the layout by tests/staffplay.test.ts.
 */
export function keyboardStartOctave(notations: string[]): number {
  let lo = 9;
  for (const n of notations) for (const m of n.matchAll(/[A-G]#?b?(\d)/g)) lo = Math.min(lo, Number(m[1]));
  return lo === 9 ? 4 : Math.min(lo, 6);
}

/**
 * The key of note_sheet's drawn keyboard under a point: black keys first
 * (they lie on top), from the drawn `key_w<i>`/`key_b<i>` outlines.
 */
export function sheetKeyAt(drawables: Drawable[], startOctave: number, p: Pt): string | null {
  const inside = (pts: Pt[]): boolean => {
    const xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1]);
    return p[0] >= Math.min(...xs) && p[0] <= Math.max(...xs) && p[1] >= Math.min(...ys) && p[1] <= Math.max(...ys);
  };
  const leaves = leafDrawables(drawables);
  for (const d of leaves) {
    const m = /^key_b(\d+)$/.exec(d.id);
    if (m && d.kind === "stroke" && inside(d.pts)) {
      const i = Number(m[1]);
      return `${LETTERS[i % 7]}#${startOctave + Math.floor(i / 7)}`;
    }
  }
  for (const d of leaves) {
    const m = /^key_w(\d+)$/.exec(d.id);
    if (m && d.kind === "stroke" && inside(d.pts)) {
      const i = Number(m[1]);
      return `${LETTERS[i % 7]}${startOctave + Math.floor(i / 7)}`;
    }
  }
  return null;
}

/** Duration letters in the order of the control row and the 1–5 keys. */
export const DURATIONS = ["w", "h", "q", "e", "s"] as const;
export type Duration = (typeof DURATIONS)[number];

/** Tokens a staff holds — note_sheet draws at most this many. */
export const STAFF_MAX = 16;

/** A notation string's tokens (whitespace-separated). */
export function tokensOf(notation: string): string[] {
  return notation.trim() === "" ? [] : notation.trim().split(/\s+/);
}

/**
 * The composer's state: the authored line it continues from and what the
 * viewer has written after it, per staff. Kept (decision 3.5): writing
 * appends after the authored notes; ↺ starts an empty staff.
 */
export interface Draft {
  authored: string[];
  written: string[];
}

export function write(d: Draft, token: string): Draft | null {
  if (d.authored.length + d.written.length >= STAFF_MAX) return null;
  return { ...d, written: [...d.written, token] };
}

export function undo(d: Draft): Draft {
  return { ...d, written: d.written.slice(0, -1) };
}

export function clear(): Draft {
  return { authored: [], written: [] };
}

/** The line as the template takes it, and where the viewer's part begins. */
export function draftParams(d: Draft): { notes: string; from: number } {
  return { notes: [...d.authored, ...d.written].join(" "), from: d.authored.length };
}

/** The right edge of the last drawn note on a staff (`note_<i>` or
 *  `bass_note_<i>` groups), or the staff's own left edge plus room for the
 *  clef when it holds none — where writing a new note begins. */
export function lastNoteRight(drawables: Drawable[], staff: Staff): number {
  const prefix = staff.id === "bass_staff" ? "bass_note_" : "note_";
  const re = new RegExp(`^${prefix}(\\d+)$`);
  let right = staff.x0 + 3 * staff.gap;
  const visit = (ds: Drawable[]): void => {
    for (const d of ds) {
      if (d.kind === "group") {
        if (re.test(d.id)) for (const leaf of leafDrawables(d.children)) if ("pts" in leaf) for (const p of leaf.pts) right = Math.max(right, p[0]);
        else visit(d.children);
      }
    }
  };
  visit(drawables);
  return right;
}

/**
 * The line a staff shows before the viewer writes anything — note_sheet's
 * own reading of its params: `abc` first (its first voice on the upper
 * staff, the second on a grand staff's lower), else `notes`/`bass_notes`,
 * else the default scale. `abcVoices` is kit.parseABC's voices, passed in so
 * this stays free of the notation module.
 */
export function authoredLine(params: Record<string, unknown>, staff: Staff["id"], abcVoices?: { notes: string }[]): string {
  const clef = params["clef"];
  if (typeof params["abc"] === "string" && params["abc"].trim() !== "" && abcVoices) {
    const v = abcVoices[staff === "bass_staff" ? 1 : 0];
    if (v) return v.notes;
  }
  if (staff === "bass_staff") return typeof params["bass_notes"] === "string" ? params["bass_notes"] : "";
  if (typeof params["notes"] === "string" && params["notes"].trim() !== "") return params["notes"];
  return clef === "bass" ? "C3:q D3:q E3:q F3:q G3:q A3:q B3:q C4:q" : "C4:q D4:q E4:q F4:q G4:q A4:q B4:q C5:q";
}
