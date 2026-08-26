// The play command: notation parsing, spec validation, planning, and the
// Player→ToneLike seam (live speakers vs the exporter's recording sink).

import { describe, expect, test } from "vitest";
import { canonicalPitch, noteFrequency, notationBeats, parseNotation, type PlayVoice } from "../src/spec/notation";
import { validateSpec } from "../src/spec/schema";
import { planCommands } from "../src/render/plan";
import { Player } from "../src/render/player";
import { SpeechManager } from "../src/render/speech";
import type { ToneLike } from "../src/render/tones";
import type { Spec } from "../src/spec/types";

const flush = () => new Promise((r) => setTimeout(r, 10));

describe("notation", () => {
  test("pitches, durations, chords and rests parse; junk is skipped", () => {
    const toks = parseNotation("C4:q D4 E4:h  C4+E4+G4:w R:h nope X9 F#3:e Bb4:s");
    expect(toks.map((t) => t.beats)).toEqual([1, 1, 2, 4, 2, 0.5, 0.25]);
    expect(toks[3].pitches).toEqual(["C4", "E4", "G4"]);
    expect(toks[4].pitches).toEqual([]); // the rest
    expect(toks[5].pitches).toEqual(["F#3"]);
    expect(toks[6].pitches).toEqual(["A#4"]); // Bb folds to A#
  });

  test("frequencies are equal temperament around A4=440", () => {
    expect(noteFrequency("A4")).toBeCloseTo(440, 6);
    expect(noteFrequency("C4")).toBeCloseTo(261.626, 2);
    expect(noteFrequency("C5")! / noteFrequency("C4")!).toBeCloseTo(2, 9); // the octave doubles
    expect(noteFrequency("H9")).toBeNull();
    expect(canonicalPitch("db4")).toBe("C#4");
  });

  test("notationBeats totals only the readable tokens", () => {
    expect(notationBeats("C4:q D4:q E4:h")).toBe(4);
    expect(notationBeats("garbage !! nothing")).toBe(0);
  });
});

describe("spec validation", () => {
  const base = (cmd: object): Spec => ({ elements: [{ id: "dot", type: "point", at: { x: 500, y: 375 } }], commands: [cmd] }) as unknown as Spec;

  test("a play command with a notation string validates; junk notation does not", () => {
    expect(validateSpec(base({ play: "C4:q E4:q G4:h", tempo: 120, instrument: "piano", speak: "listen" })).ok).toBe(true);
    expect(validateSpec(base({ play: "total garbage" })).ok).toBe(false);
    expect(validateSpec(base({ play: "C4:q", tempo: 999 })).ok).toBe(false);
  });

  test("multi-voice play validates; tempo/instrument on other verbs do not", () => {
    expect(validateSpec(base({ play: [{ notes: "C4:h" }, { notes: "C3:h", instrument: "pluck" }] })).ok).toBe(true);
    expect(validateSpec(base({ draw: ["dot"], tempo: 100 })).ok).toBe(false);
    expect(validateSpec(base({ draw: ["dot"], instrument: "bell" })).ok).toBe(false);
  });
});

describe("planning", () => {
  test("play becomes a timed step: duration = longest voice at the tempo", () => {
    const plan = planCommands([{ play: "C4:q D4:q E4:h", tempo: 120 }], []);
    expect(plan.steps).toHaveLength(1);
    const step = plan.steps[0] as { kind: string; seconds: number; voices: PlayVoice[]; tempo: number };
    expect(step.kind).toBe("play");
    expect(step.seconds).toBeCloseTo((4 * 60) / 120, 9); // 4 beats at 120 bpm = 2 s
    expect(step.voices).toHaveLength(1);
  });

  test("a string play inherits the command instrument; voices keep their own", () => {
    const plan = planCommands([{ play: [{ notes: "C4:h" }, { notes: "C3:w", instrument: "pluck" }], instrument: "piano", tempo: 60 }], []);
    const step = plan.steps[0] as { kind: string; seconds: number; voices: PlayVoice[] };
    expect(step.voices.map((v) => v.instrument)).toEqual(["piano", "pluck"]);
    expect(step.seconds).toBeCloseTo(4, 9); // the longest voice (4 beats at 60)
  });

  test("unreadable notes are skipped with a warning, keeping the paired narration", () => {
    const plan = planCommands([{ play: "junk", speak: "still said" }], []);
    expect(plan.warnings.some((w) => w.includes("play"))).toBe(true);
    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0].kind).toBe("speak");
  });
});

describe("Player → tones seam", () => {
  const fakeTones = () => {
    const calls: { voices: PlayVoice[]; tempo: number }[] = [];
    const t: ToneLike = {
      play: (voices, tempo) => {
        calls.push({ voices, tempo });
        return 100;
      },
      cancel: () => undefined,
      pause: () => undefined,
      resume: () => undefined,
    };
    return { t, calls };
  };

  test("a play step schedules on the injected tone engine and waits out its duration", async () => {
    const plan = planCommands([{ play: "C4:s", tempo: 240 }], []);
    const player = new Player(plan, new Map(), new SpeechManager(), null, { mode: "narrated" });
    const { t, calls } = fakeTones();
    player.tones = t;
    const frames: ((now: number) => void)[] = [];
    player.raf = (cb) => frames.push(cb);
    const done = player.play();
    await flush();
    expect(calls).toHaveLength(1);
    expect(calls[0].voices[0].notes).toBe("C4:s");
    expect(calls[0].tempo).toBe(240);
    for (let guard = 0; player.state === "playing" && guard < 20; guard++) {
      for (const cb of frames.splice(0)) cb(performance.now() + 100_000);
      await flush();
    }
    await done;
    expect(player.state).toBe("done");
  });

  test("without a tone engine the play step still paces (headless)", async () => {
    const plan = planCommands([{ play: "C4:s", tempo: 240 }], []);
    const player = new Player(plan, new Map(), new SpeechManager(), null, { mode: "narrated" });
    const frames: ((now: number) => void)[] = [];
    player.raf = (cb) => frames.push(cb);
    const done = player.play();
    await flush();
    for (let guard = 0; player.state === "playing" && guard < 20; guard++) {
      for (const cb of frames.splice(0)) cb(performance.now() + 100_000);
      await flush();
    }
    await done;
    expect(player.state).toBe("done");
  });
});

describe("press — visuals locked to the notes", () => {
  test("pressAt fractions follow the first voice's note starts, skipping rests", () => {
    const plan = planCommands([{ play: "R:q C4:q D4:q E4:h", press: ["a", "b", "c"] }], ["a", "b", "c"]);
    const step = plan.steps[0] as { kind: string; press: string[]; pressAt: number[] };
    expect(step.kind).toBe("play");
    expect(step.press).toEqual(["a", "b", "c"]);
    // 5 beats total; sounding notes start at beats 1, 2, 3.
    expect(step.pressAt).toEqual([1 / 5, 2 / 5, 3 / 5]);
    // Press ids count as revealed: visible at the boundary, no auto-draw at the end.
    expect(plan.states[0].visible).toEqual(["a", "b", "c"]);
    expect(plan.steps.filter((s) => s.kind === "draw")).toHaveLength(0);
  });

  test("unknown press ids drop with a warning; extras land at the end", () => {
    const plan = planCommands([{ play: "C4:q", press: ["a", "ghost", "b"] }], ["a", "b"]);
    const step = plan.steps[0] as { press: string[]; pressAt: number[] };
    expect(plan.warnings.some((w) => w.includes("ghost"))).toBe(true);
    expect(plan.warnings.some((w) => w.includes("press ids"))).toBe(true);
    expect(step.press).toEqual(["a", "b"]);
    expect(step.pressAt).toEqual([0, 1]); // b has no note left — appears at the end
  });

  test("the player reveals each press id as its note starts, in order", async () => {
    const finished: string[] = [];
    const stub = (id: string) =>
      ({ id, durationMs: 100, finish: () => finished.push(id), hide: () => undefined, setProgress: () => undefined }) as never;
    const elements = new Map([["a", stub("a")], ["b", stub("b")]]);
    const plan = planCommands([{ play: "C4:q D4:q", press: ["a", "b"], tempo: 240 }], ["a", "b"]);
    const player = new Player(plan, elements, new SpeechManager(), null, { mode: "narrated" });
    const frames: ((now: number) => void)[] = [];
    player.raf = (cb) => frames.push(cb);
    const done = player.play();
    await flush();
    // Drive the clock in small increments so the two reveals land separately.
    let now = performance.now();
    for (let guard = 0; player.state === "playing" && guard < 60; guard++) {
      now += 100;
      for (const cb of frames.splice(0)) cb(now);
      await flush();
    }
    await done;
    expect(player.state).toBe("done");
    expect(finished).toEqual(["a", "b"]);
  });
});
