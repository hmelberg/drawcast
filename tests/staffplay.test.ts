// The staff as an instrument, pure half (design 2026-09-24-music §5): the
// staves read off the real note_sheet layout, pitches under points, the
// note_sheet keyboard's keys, and the composer's draft.

import { beforeAll, describe, expect, test } from "vitest";
import musicYaml from "../src/scenes/packs/music.yaml?raw";
import { registerPack } from "../src/scenes/packs";
import { scenes } from "../src/scenes/registry";
import { ensureEngines } from "../src/scenes/engines";
import { clear, draftParams, keyboardStartOctave, sheetKeyAt, staffPitchAt, staffYOf, stavesOf, undo, write, STAFF_MAX } from "../src/ui/staffplay-model";
import { flattenDrawables } from "../src/layout/model";

beforeAll(async () => {
  await ensureEngines(["music"]);
  registerPack("music", musicYaml);
});

const lay = (params: Record<string, unknown>) => scenes.note_sheet.layout!(params);

describe("staves and pitches", () => {
  test("treble: the bottom line is E4, the space above F4, one ledger below C4", () => {
    const r = lay({ notes: "C4:q" });
    const [s] = stavesOf(r.drawables, undefined);
    expect(s.ref).toBe(30);
    expect(staffPitchAt([s], [500, s.bottom])?.pitch).toBe("E4");
    expect(staffPitchAt([s], [500, s.bottom + s.gap / 2])?.pitch).toBe("F4");
    expect(staffPitchAt([s], [500, s.bottom - s.gap])?.pitch).toBe("C4");
    expect(staffYOf(s, "B4")).toBeCloseTo(s.bottom + 2 * s.gap, 6);
    // Off the staff: nothing.
    expect(staffPitchAt([s], [500, s.bottom + 12 * s.gap])).toBeNull();
    expect(staffPitchAt([s], [s.x0 - 20, s.bottom])).toBeNull();
  });

  test("bass: the bottom line is G2", () => {
    const r = lay({ clef: "bass", notes: "C3:q" });
    const [s] = stavesOf(r.drawables, "bass");
    expect(staffPitchAt([s], [500, s.bottom])?.pitch).toBe("G2");
    expect(staffPitchAt([s], [500, s.bottom + 4 * s.gap])?.pitch).toBe("A3");
  });

  test("grand: two staves, and each answers for its own lines", () => {
    const r = lay({ clef: "grand", notes: "E4:q", bass_notes: "C3:q" });
    const staves = stavesOf(r.drawables, "grand");
    expect(staves.map((s) => s.id)).toEqual(["staff", "bass_staff"]);
    const [t, b] = staves;
    expect(staffPitchAt(staves, [500, t.bottom])).toMatchObject({ pitch: "E4", staff: { id: "staff" } });
    expect(staffPitchAt(staves, [500, b.bottom + 4 * b.gap])).toMatchObject({ pitch: "A3", staff: { id: "bass_staff" } });
  });
});

describe("the note_sheet keyboard", () => {
  test("the start octave follows the layout's own rule — C of that octave is the first white key", () => {
    for (const notes of ["C4:q E4:q", "A3:q C5:q", "G5:q"]) {
      const r = lay({ notes, keyboard: true });
      const flat = flattenDrawables(r.drawables);
      const w0 = flat.find((d) => d.id === "key_w0") as { pts: [number, number][] };
      const cx = (Math.min(...w0.pts.map((p) => p[0])) + Math.max(...w0.pts.map((p) => p[0]))) / 2;
      const cy = Math.min(...w0.pts.map((p) => p[1])) + 10; // low on the key: below the black keys
      const oct = keyboardStartOctave([notes]);
      expect(sheetKeyAt(r.drawables, oct, [cx, cy])).toBe(`C${oct}`);
    }
  });

  test("a black key answers before the white key under it", () => {
    const r = lay({ notes: "C4:q", keyboard: true });
    const flat = flattenDrawables(r.drawables);
    const b0 = flat.find((d) => d.id === "key_b0") as { pts: [number, number][] };
    const cx = (Math.min(...b0.pts.map((p) => p[0])) + Math.max(...b0.pts.map((p) => p[0]))) / 2;
    const cy = (Math.min(...b0.pts.map((p) => p[1])) + Math.max(...b0.pts.map((p) => p[1]))) / 2;
    expect(sheetKeyAt(r.drawables, 4, [cx, cy])).toBe("C#4");
  });
});

describe("the draft", () => {
  test("writing continues the authored line; undo and clear", () => {
    let d = { authored: ["C4:q", "D4:q"], written: [] as string[] };
    d = write(d, "E4:h")!;
    expect(draftParams(d)).toEqual({ notes: "C4:q D4:q E4:h", from: 2 });
    d = undo(d);
    expect(draftParams(d).notes).toBe("C4:q D4:q");
    expect(draftParams(clear())).toEqual({ notes: "", from: 0 });
  });

  test("a full staff refuses another note", () => {
    const full = { authored: Array.from({ length: STAFF_MAX }, () => "C4:q"), written: [] };
    expect(write(full, "D4:q")).toBeNull();
  });

  test("the layout paints the viewer's notes from draft_from on in the accent ink", () => {
    const r = lay({ notes: "C4:q D4:q E4:q", draft_from: 2 });
    const flat = flattenDrawables(r.drawables);
    const fill = (id: string) => (flat.find((d) => d.id === id) as { style: { fill?: string } }).style.fill;
    expect(fill("note_2__h0")).not.toBe(fill("note_0__h0"));
    expect(fill("note_1__h0")).toBe(fill("note_0__h0"));
  });
});

import { readFileSync } from "node:fs";
import { validateSpec } from "../src/spec/schema";
import { planCommands } from "../src/render/plan";

describe("a composed melody plays back", () => {
  test("play may name a stored answer: it validates and plans (filled in at play time)", () => {
    expect(validateSpec({ template: "note_sheet", commands: [{ explore: { store: "melody" } }, { play: "{melody}" }] }).ok).toBe(true);
    const plan = planCommands([{ play: "{melody}" }], []);
    expect(plan.steps.find((s) => s.kind === "play")).toMatchObject({ kind: "play", voices: [{ notes: "{melody}" }] });
    expect(plan.warnings).toEqual([]);
  });

  test("the player fills the voice in from the vars and times the step by what it became (pin)", () => {
    const player = readFileSync(new URL("../src/render/player.ts", import.meta.url), "utf8");
    expect(player).toMatch(/notes: subVars\(v\.notes, this\.vars\)/);
    expect(player).toMatch(/const seconds = filled \?/);
  });

  test("a shut explore gate with store keeps what was composed on the staff (pin)", () => {
    const tray = readFileSync(new URL("../src/ui/tray.ts", import.meta.url), "utf8");
    expect(tray).toMatch(/const kept = step\.store && stage \? composedOn\(stage\) : null;/);
  });
});
