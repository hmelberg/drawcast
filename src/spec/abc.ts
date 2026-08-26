// ABC notation → the internal note format (spec/notation.ts). ABC is the
// compact text format of the folk-tune world — and the one music notation
// LLMs can genuinely write — so it is drawcast's rich input for real tunes,
// converted here into the same tokens play/note_sheet/press already consume.
//
// Practical subset: X/T/M/L/Q/K/V headers (inline [K:..] fields too), key
// signatures (major + minor) with correct per-measure accidental
// persistence, octave marks (C c c' C,), note lengths (A2, A/, A3/2),
// broken rhythm (A>B, A<B), triplets ((3ABC), chords ([CEG]2), ties
// (C-C merge), rests (z, x, Z). Skipped gracefully: grace notes {..},
// decorations !..!, "chord symbols", slurs, lyrics (w:), repeats (played
// once). See ROADMAP §Sound for the MusicXML import that may sit on top.

export interface AbcTune {
  /** One internal-notation string per ABC voice, in first-seen order. */
  voices: { notes: string }[];
  /** Tempo as quarter-note BPM (from Q:), or null when the tune has none. */
  tempo: number | null;
  title: string | null;
  /** The meter's numerator (from M:), for bar lines; null when absent. */
  meterTop: number | null;
}

interface RawToken {
  pitches: string[];
  beats: number;
  tie: boolean;
}

// Circle-of-fifths signature counts (positive = sharps, negative = flats).
const MAJOR_SIGS: Record<string, number> = { C: 0, G: 1, D: 2, A: 3, E: 4, B: 5, "F#": 6, "C#": 7, F: -1, Bb: -2, Eb: -3, Ab: -4, Db: -5, Gb: -6, Cb: -7 };
const MINOR_SIGS: Record<string, number> = { A: 0, E: 1, B: 2, "F#": 3, "C#": 4, "G#": 5, "D#": 6, D: -1, G: -2, C: -3, F: -4, Bb: -5, Eb: -6 };
const SHARP_ORDER = ["F", "C", "G", "D", "A", "E", "B"];
const FLAT_ORDER = ["B", "E", "A", "D", "G", "C", "F"];

/** letter -> "#" | "b" for a key, e.g. G major = { F: "#" }. */
function keyAccidentals(key: string): Record<string, string> {
  const m = /^([A-Ga-g])([#b]?)\s*(maj|major|m|min|minor|aeo|aeolian|ion|ionian)?/.exec(key.trim());
  if (!m) return {};
  const tonic = m[1].toUpperCase() + (m[2] ?? "");
  const mode = (m[3] ?? "").toLowerCase();
  const minor = mode === "m" || mode.startsWith("min") || mode.startsWith("aeo");
  const count = (minor ? MINOR_SIGS : MAJOR_SIGS)[tonic];
  const out: Record<string, string> = {};
  if (count === undefined || count === 0) return out;
  const order = count > 0 ? SHARP_ORDER : FLAT_ORDER;
  for (let i = 0; i < Math.abs(count) && i < 7; i++) out[order[i]] = count > 0 ? "#" : "b";
  return out;
}

/** Beats (quarter = 1) formatted for the internal notation's duration slot. */
function fmtBeats(beats: number): string {
  const NAMED: [number, string][] = [[4, "w"], [3, "h."], [2, "h"], [1.5, "q."], [1, "q"], [0.75, "e."], [0.5, "e"], [0.375, "s."], [0.25, "s"]];
  for (const [b, name] of NAMED) if (Math.abs(beats - b) < 1e-6) return name;
  return String(Math.round(beats * 1000) / 1000);
}

export function parseABC(src: string): AbcTune {
  let title: string | null = null;
  let tempo: number | null = null;
  let meterTop: number | null = null;
  let unitBeats = 0.5; // L:1/8 default → half a beat per unit
  let keySig: Record<string, string> = {};

  const voiceOrder: string[] = [];
  const voiceTokens = new Map<string, RawToken[]>();
  let currentVoice = "1";
  const tokensOf = (id: string): RawToken[] => {
    if (!voiceTokens.has(id)) {
      voiceTokens.set(id, []);
      voiceOrder.push(id);
    }
    return voiceTokens.get(id)!;
  };

  /** Accidentals sounded so far in the current measure: "letter+octave" -> "#"|"b"|"". */
  let measureAcc: Record<string, string> = {};

  const applyField = (letter: string, value: string): void => {
    const v = value.trim();
    if (letter === "T" && title === null) title = v;
    else if (letter === "K") {
      keySig = keyAccidentals(v);
      measureAcc = {};
    } else if (letter === "M") {
      const mm = /^(\d+)\/(\d+)$/.exec(v);
      if (mm) meterTop = Number(mm[1]);
      else if (v === "C") meterTop = 4;
      else if (v === "C|") meterTop = 2;
    } else if (letter === "L") {
      const lm = /^(\d+)\/(\d+)$/.exec(v);
      if (lm && Number(lm[2]) > 0) unitBeats = (Number(lm[1]) / Number(lm[2])) * 4;
    } else if (letter === "Q") {
      const qm = /(?:(\d+)\/(\d+)\s*=\s*)?(\d+)/.exec(v);
      if (qm) {
        const bpm = Number(qm[3]);
        const frac = qm[1] ? Number(qm[1]) / Number(qm[2]) : 0.25;
        tempo = Math.round(bpm * (frac / 0.25));
      }
    } else if (letter === "V") {
      currentVoice = v.split(/\s/)[0] || "1";
      tokensOf(currentVoice);
    }
  };

  /** ABC length suffix at line[i]: "2", "/", "//", "/4", "3/2"... */
  const readLength = (line: string, i: number): { factor: number; next: number } => {
    let factor = 1;
    const num = /^(\d+)/.exec(line.slice(i));
    if (num) {
      factor *= Number(num[1]);
      i += num[1].length;
    }
    while (line[i] === "/") {
      i++;
      const den = /^(\d+)/.exec(line.slice(i));
      if (den) {
        factor /= Number(den[1]);
        i += den[1].length;
      } else {
        factor /= 2;
      }
    }
    return { factor, next: i };
  };

  /** One pitch at line[i] (accidental + letter + octave marks) or null. */
  const readPitch = (line: string, i: number): { name: string; next: number } | null => {
    const m = /^(\^{1,2}|_{1,2}|=)?([A-Ga-g])([,']*)/.exec(line.slice(i));
    if (!m) return null;
    const letter = m[2].toUpperCase();
    let octave = m[2] === m[2].toLowerCase() ? 5 : 4;
    for (const c of m[3]) octave += c === "'" ? 1 : -1;
    octave = Math.max(1, Math.min(7, octave));
    const slot = letter + octave;
    let acc: string;
    if (m[1]) {
      acc = m[1].startsWith("^") ? "#" : m[1].startsWith("_") ? "b" : "";
      measureAcc[slot] = acc;
    } else if (slot in measureAcc) {
      acc = measureAcc[slot];
    } else {
      acc = keySig[letter] ?? "";
    }
    return { name: letter + acc + octave, next: i + m[0].length };
  };

  for (const rawLine of src.split(/\r?\n/)) {
    // %%directives and w: lyric lines vanish whole; % comments trim the tail.
    if (/^\s*%%/.test(rawLine) || /^\s*[wW]:/.test(rawLine)) continue;
    const pc = rawLine.indexOf("%");
    const line = (pc >= 0 ? rawLine.slice(0, pc) : rawLine).trimEnd();
    if (line.trim() === "") continue;

    const header = /^([A-Za-z]):(.*)$/.exec(line.trim());
    if (header && /[XTKMLQVCZORBNSHIF]/.test(header[1].toUpperCase()) && header[1].length === 1) {
      applyField(header[1].toUpperCase(), header[2]);
      continue;
    }

    const tokens = tokensOf(currentVoice);
    let pendingBroken: ">" | "<" | null = null;
    let tuplet: { left: number; factor: number } | null = null;
    let i = 0;
    while (i < line.length) {
      const ch = line[i];
      if (ch === " " || ch === "\t" || ch === "\\" || ch === ")") {
        i++;
        continue;
      }
      // Bar lines (all repeat flavors) reset measure accidentals.
      const bar = /^(\[\||\|\]|\|\||::|:\||\|:|\|)/.exec(line.slice(i));
      if (bar) {
        measureAcc = {};
        i += bar[0].length;
        continue;
      }
      // Inline fields [K:G] [M:3/4] ...
      const inline = /^\[([A-Za-z]):([^\]]*)\]/.exec(line.slice(i));
      if (inline) {
        applyField(inline[1].toUpperCase(), inline[2]);
        i += inline[0].length;
        continue;
      }
      // Tuplet marker (3 — the next n notes get 2/n of their length (v1: n=2..4).
      const tup = /^\((\d)/.exec(line.slice(i));
      if (tup) {
        const n = Number(tup[1]);
        tuplet = n >= 2 && n <= 4 ? { left: n, factor: n === 2 ? 1.5 : n === 4 ? 0.75 : 2 / 3 } : null;
        i += tup[0].length;
        continue;
      }
      if (ch === ">" || ch === "<") {
        pendingBroken = ch;
        i++;
        continue;
      }
      if (ch === "-") {
        if (tokens.length > 0) tokens[tokens.length - 1].tie = true;
        i++;
        continue;
      }
      // Skipped decorations: {grace}, !deco!, "chord symbol", ornaments.
      if (ch === "{") {
        const close = line.indexOf("}", i);
        i = close < 0 ? line.length : close + 1;
        continue;
      }
      if (ch === "!") {
        const close = line.indexOf("!", i + 1);
        i = close < 0 ? line.length : close + 1;
        continue;
      }
      if (ch === '"') {
        const close = line.indexOf('"', i + 1);
        i = close < 0 ? line.length : close + 1;
        continue;
      }
      // Rests: z/x (unit-relative), Z (a whole measure).
      if (ch === "z" || ch === "x" || ch === "Z") {
        i++;
        const len = readLength(line, i);
        i = len.next;
        const beats = ch === "Z" ? (meterTop ?? 4) * len.factor : unitBeats * len.factor;
        tokens.push({ pitches: [], beats, tie: false });
        continue;
      }
      // Chord [CEG]2
      if (ch === "[") {
        i++;
        const pitches: string[] = [];
        while (i < line.length && line[i] !== "]") {
          const p = readPitch(line, i);
          if (p) {
            pitches.push(p.name);
            const inner = readLength(line, p.next); // rare per-note lengths: read + ignore
            i = inner.next;
          } else {
            i++;
          }
        }
        i++; // past ]
        const len = readLength(line, i);
        i = len.next;
        if (pitches.length > 0) tokens.push({ pitches, beats: unitBeats * len.factor, tie: false });
        continue;
      }
      const p = readPitch(line, i);
      if (p) {
        const len = readLength(line, p.next);
        i = len.next;
        let beats = unitBeats * len.factor;
        if (tuplet) {
          beats *= tuplet.factor;
          if (--tuplet.left <= 0) tuplet = null;
        }
        if (pendingBroken) {
          // A>B: dotted A, halved B (A<B mirrors it).
          const prev = tokens[tokens.length - 1];
          if (prev) {
            if (pendingBroken === ">") {
              prev.beats *= 1.5;
              beats *= 0.5;
            } else {
              prev.beats *= 0.5;
              beats *= 1.5;
            }
          }
          pendingBroken = null;
        }
        // Tie merge: same single pitch continues the previous token.
        const prev = tokens[tokens.length - 1];
        if (prev?.tie && prev.pitches.length === 1 && prev.pitches[0] === p.name) {
          prev.beats += beats;
          prev.tie = false;
        } else {
          tokens.push({ pitches: [p.name], beats, tie: false });
        }
        continue;
      }
      i++; // anything unrecognized: skip one character
    }
  }

  const voices = voiceOrder
    .map((id) => voiceTokens.get(id)!)
    .filter((toks) => toks.some((t) => t.pitches.length > 0))
    .map((toks) => ({
      notes: toks.map((t) => (t.pitches.length === 0 ? "R" : t.pitches.join("+")) + ":" + fmtBeats(t.beats)).join(" "),
    }));
  return { voices, tempo, title, meterTop };
}
