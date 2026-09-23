// `sound: true` on a note_sheet (design 2026-09-24-music §7.1): a draw of
// note ids becomes a play of exactly those notes, revealed (and their keys
// pressed) as they sound — the choreography derived from the drawing.

import { describe, expect, test } from "vitest";
import { expandSound } from "../src/spec/sound";
import { expandSpec } from "../src/spec/expand";
import type { Command, Spec } from "../src/spec/types";

const sheet = (params: Record<string, unknown>, commands: Command[]): Spec => ({ template: "note_sheet", params: { sound: true, ...params }, commands });

describe("expandSound", () => {
  test("without sound: true nothing changes, by identity", () => {
    const s: Spec = { template: "note_sheet", params: { notes: "C4:q" }, commands: [{ draw: ["note_0"] }] };
    expect(expandSound(s)).toBe(s);
  });

  test("a draw of notes plays them, revealed in order, with the beat's sentence", () => {
    const out = expandSound(sheet({ notes: "C4:q E4:q G4:h" }, [{ draw: ["staff", "clef"] }, { draw: ["note_0", "note_1", "note_2"], speak: "Up the chord." }]));
    expect(out.commands![0]).toEqual({ draw: ["staff", "clef"] });
    expect(out.commands![1]).toEqual({ speak: "Up the chord.", play: "C4:q E4:q G4:h", instrument: "piano", reveal: ["note_0", "note_1", "note_2"] });
  });

  test("the staff drawn in the same beat is drawn first, quietly; rests are drawn, not revealed", () => {
    const out = expandSound(sheet({ notes: "C4:q R:q E4:q" }, [{ draw: ["staff", "note_0", "note_1", "note_2"], speak: "Two notes and a breath." }]));
    expect(out.commands![0]).toEqual({ draw: ["staff", "note_1"] });
    expect(out.commands![1]).toMatchObject({ play: "C4:q R:q E4:q", reveal: ["note_0", "note_2"] });
  });

  test("with the keyboard, each note's key goes down as it sounds", () => {
    const out = expandSound(sheet({ notes: "C4:q D4:q", keyboard: true }, [{ draw: ["note_0", "note_1"] }]));
    expect(out.commands![0]).toMatchObject({ reveal: ["note_0", "note_1"], press: ["key_0", "key_1"] });
  });

  test("a grand staff's two hands in one beat play together; the lower hand is drawn at the start", () => {
    const out = expandSound(sheet({ clef: "grand", notes: "E4:q G4:q", bass_notes: "C3:h" }, [{ draw: ["note_0", "note_1", "bass_note_0"] }]));
    expect(out.commands![0]).toEqual({ draw: ["bass_note_0"] });
    expect(out.commands![1]).toMatchObject({ play: [{ notes: "E4:q G4:q" }, { notes: "C3:h" }], reveal: ["note_0", "note_1"] });
  });

  test("the author wins: a cast with its own choreographed play is left alone", () => {
    const s = sheet({ notes: "C4:q" }, [{ play: "C4:q", reveal: ["note_0"] }, { draw: ["note_0"] }]);
    expect(expandSound(s)).toBe(s);
  });

  test("expandSpec runs it", () => {
    const out = expandSpec(sheet({ notes: "C4:q" }, [{ draw: ["note_0"] }]));
    expect(out.commands![0]).toMatchObject({ play: "C4:q", reveal: ["note_0"] });
  });
});
