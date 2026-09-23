// The `music` element's friendly names → SMuFL glyphs (design
// 2026-09-24-music-notation-and-staff §4.3). Tiny and eager: validation and
// the element's layout read it; the glyph OUTLINES stay in the lazy engine.

import type { NoteValue } from "./geometry";

/** What a symbol is drawn as: a note (head + stem + flag), one glyph, glyphs in a row, or a stacked time signature. */
export type SymbolPlan =
  | { note: NoteValue }
  | { row: string[] }
  | { time: [string[], string[]] };

const ONE: Record<string, string> = {
  whole_rest: "restWhole", half_rest: "restHalf", quarter_rest: "restQuarter", eighth_rest: "rest8th", sixteenth_rest: "rest16th",
  treble_clef: "gClef", bass_clef: "fClef", alto_clef: "cClef",
  sharp: "accidentalSharp", flat: "accidentalFlat", natural: "accidentalNatural", double_sharp: "accidentalDoubleSharp", double_flat: "accidentalDoubleFlat",
  fermata: "fermataAbove", segno: "segno", coda: "coda", repeat_start: "repeatLeft", repeat_end: "repeatRight",
  common_time: "timeSigCommon", cut_time: "timeSigCutCommon",
};
const DYNAMICS: Record<string, string[]> = {
  p: ["dynamicPiano"], mp: ["dynamicMezzo", "dynamicPiano"], mf: ["dynamicMezzo", "dynamicForte"], f: ["dynamicForte"], ff: ["dynamicForte", "dynamicForte"],
};
const NOTES: Record<string, NoteValue> = { whole_note: "whole", half_note: "half", quarter_note: "quarter", eighth_note: "eighth", sixteenth_note: "sixteenth" };

/** How to draw `symbol` (with `time` for a time signature), or null for an unknown one. */
export function symbolPlan(symbol: string, time?: string): SymbolPlan | null {
  if (symbol in NOTES) return { note: NOTES[symbol] };
  if (symbol in ONE) return { row: [ONE[symbol]] };
  if (symbol in DYNAMICS) return { row: DYNAMICS[symbol] };
  if (symbol === "time") {
    const m = /^(\d{1,2})\/(\d{1,2})$/.exec(time ?? "");
    if (!m) return null;
    const digits = (s: string) => [...s].map((d) => `timeSig${d}`);
    return { time: [digits(m[1]), digits(m[2])] };
  }
  return null;
}
