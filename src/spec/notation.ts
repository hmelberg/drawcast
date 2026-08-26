// Musical notation shared by the play command (render/tones.ts), the spec
// validator, and the music templates (via kit.parseNotes). One tiny format:
// space-separated tokens, each `PITCHES:DUR`.
//
//   PITCHES  one pitch (C4, F#3, Bb4), a chord joined with + (C4+E4+G4),
//            or R for a rest.
//   DUR      w (4 beats) | h (2) | q (1, the default) | e (1/2) | s (1/4).
//
// Example: "C4:q D4:q E4:q F4:q G4:h  R:q  G4+B4+D5:w"

/** The play command's synthesized instruments (recipes live in render/tones.ts). */
export type Instrument = "tone" | "piano" | "organ" | "pluck" | "bell";
export const INSTRUMENTS: readonly Instrument[] = ["tone", "piano", "organ", "pluck", "bell"];

/** One channel of a play command: its own notes and (optionally) instrument. */
export interface PlayVoice {
  notes: string;
  instrument?: Instrument;
}

export interface NoteToken {
  /** Scientific pitch names, uppercase with # accidentals; empty = rest. */
  pitches: string[];
  /** Duration in beats (quarter note = 1). */
  beats: number;
  /** Frequencies in Hz, one per pitch (equal temperament, A4 = 440). */
  freqs: number[];
}

const DUR_BEATS: Record<string, number> = { w: 4, h: 2, q: 1, e: 0.5, s: 0.25 };
const LETTER_SEMITONE: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const PITCH_RE = /^([A-Ga-g])([#b]?)([1-7])$/;

/** Semitones above C0, or null when the name doesn't parse. */
export function pitchIndex(name: string): number | null {
  const m = PITCH_RE.exec(name.trim());
  if (!m) return null;
  const semis = LETTER_SEMITONE[m[1].toUpperCase()] + (m[2] === "#" ? 1 : m[2] === "b" ? -1 : 0);
  return Number(m[3]) * 12 + semis;
}

/** Equal-temperament frequency (A4 = 440 Hz), or null for an unparseable name. */
export function noteFrequency(name: string): number | null {
  const idx = pitchIndex(name);
  if (idx === null) return null;
  const A4 = 4 * 12 + 9;
  return 440 * Math.pow(2, (idx - A4) / 12);
}

/** Canonical spelling: uppercase letter, flats folded to sharps (Db4 → C#4). */
export function canonicalPitch(name: string): string | null {
  const idx = pitchIndex(name);
  if (idx === null) return null;
  const NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  return NAMES[idx % 12] + String(Math.floor(idx / 12));
}

/**
 * Parse a notation string into note tokens. Unreadable tokens are silently
 * skipped (the spec validator warns separately), so a partly-wrong melody
 * still plays its good notes.
 */
export function parseNotation(notation: string): NoteToken[] {
  const out: NoteToken[] = [];
  for (const raw of String(notation).trim().split(/\s+/)) {
    if (raw === "") continue;
    const [head, durRaw] = raw.split(":");
    const beats = DUR_BEATS[(durRaw ?? "q").toLowerCase()] ?? null;
    if (beats === null) continue;
    if (/^r$/i.test(head)) {
      out.push({ pitches: [], beats, freqs: [] });
      continue;
    }
    const pitches: string[] = [];
    const freqs: number[] = [];
    let ok = true;
    for (const p of head.split("+")) {
      const canon = canonicalPitch(p);
      const f = noteFrequency(p);
      if (canon === null || f === null) {
        ok = false;
        break;
      }
      pitches.push(canon);
      freqs.push(f);
    }
    if (ok && pitches.length > 0) out.push({ pitches, beats, freqs });
  }
  return out;
}

/** Total beats of the readable tokens (0 = nothing playable). */
export function notationBeats(notation: string): number {
  return parseNotation(notation).reduce((s, t) => s + t.beats, 0);
}
