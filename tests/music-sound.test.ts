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

describe("reveal & press — visuals locked to the notes", () => {
  test("reveal fractions follow the first voice's note starts (rests skipped) and ids stay visible", () => {
    const plan = planCommands([{ play: "R:q C4:q D4:q E4:h", reveal: ["a", "b", "c"] }], ["a", "b", "c"]);
    const step = plan.steps[0] as { kind: string; reveal: string[]; revealAt: number[] };
    expect(step.kind).toBe("play");
    expect(step.reveal).toEqual(["a", "b", "c"]);
    // 5 beats total; sounding notes start at beats 1, 2, 3.
    expect(step.revealAt).toEqual([1 / 5, 2 / 5, 3 / 5]);
    // Revealed ids stay: visible at the boundary, no auto-draw at the end.
    expect(plan.states[0].visible).toEqual(["a", "b", "c"]);
    expect(plan.steps.filter((s) => s.kind === "draw")).toHaveLength(0);
  });

  test("press ids go down at note start, up at note end — and END the step hidden", () => {
    const plan = planCommands([{ play: "C4:q D4:q E4:h", press: ["a", "b", "c"] }], ["a", "b", "c"]);
    const step = plan.steps[0] as { press: string[]; pressAt: number[]; pressOff: number[] };
    expect(step.pressAt).toEqual([0, 1 / 4, 2 / 4]);
    expect(step.pressOff).toEqual([1 / 4, 2 / 4, 1]);
    // Pressed keys have come back up by the boundary — and still no auto-draw.
    expect(plan.states[0].visible).toEqual([]);
    expect(plan.steps.filter((s) => s.kind === "draw")).toHaveLength(0);
  });

  test("reveal and press ride one command: staff notes stay while keys bounce", () => {
    const plan = planCommands([{ play: "C4:q D4:q", reveal: ["n0", "n1"], press: ["k0", "k1"] }], ["n0", "n1", "k0", "k1"]);
    const step = plan.steps[0] as { reveal: string[]; press: string[] };
    expect(step.reveal).toEqual(["n0", "n1"]);
    expect(step.press).toEqual(["k0", "k1"]);
    expect(plan.states[0].visible).toEqual(["n0", "n1"]);
  });

  test("unknown press ids drop with a warning; extras land at the end", () => {
    const plan = planCommands([{ play: "C4:q", press: ["a", "ghost", "b"] }], ["a", "b"]);
    const step = plan.steps[0] as { press: string[]; pressAt: number[]; pressOff: number[] };
    expect(plan.warnings.some((w) => w.includes("ghost"))).toBe(true);
    expect(plan.warnings.some((w) => w.includes("press ids"))).toBe(true);
    expect(step.press).toEqual(["a", "b"]);
    expect(step.pressAt).toEqual([0, 1]);
    expect(step.pressOff).toEqual([1, 1]);
  });

  test("the player presses and releases each id around its note, in order", async () => {
    const events: string[] = [];
    const stub = (id: string) =>
      ({ id, durationMs: 100, finish: () => events.push("+" + id), hide: () => events.push("-" + id), setProgress: () => undefined }) as never;
    const elements = new Map([["a", stub("a")], ["b", stub("b")]]);
    const plan = planCommands([{ play: "C4:q D4:q", press: ["a", "b"], tempo: 240 }], ["a", "b"]);
    const player = new Player(plan, elements, new SpeechManager(), null, { mode: "narrated" });
    const frames: ((now: number) => void)[] = [];
    player.raf = (cb) => frames.push(cb);
    const done = player.play();
    await flush();
    let now = performance.now();
    for (let guard = 0; player.state === "playing" && guard < 60; guard++) {
      now += 60;
      for (const cb of frames.splice(0)) cb(now);
      await flush();
    }
    await done;
    expect(player.state).toBe("done");
    // The player hides all pressed elements up front (initial state), so the
    // meaningful sequence is: a down, a up + b down, b up.
    expect(events.filter((e) => e === "+a" || e === "+b")).toEqual(["+a", "+b"]);
    const upA = events.lastIndexOf("-a");
    const downB = events.indexOf("+b");
    expect(upA).toBeGreaterThan(events.indexOf("+a"));
    expect(events.lastIndexOf("-b")).toBeGreaterThan(downB);
  });
});

describe("ABC notation", () => {
  test("a simple tune converts: headers, unit length, meter, tempo, title", async () => {
    const { parseABC } = await import("../src/spec/abc");
    const tune = parseABC("X:1\nT:Twinkle\nM:4/4\nL:1/4\nQ:1/4=120\nK:C\nC C G G | A A G2 |");
    expect(tune.title).toBe("Twinkle");
    expect(tune.tempo).toBe(120);
    expect(tune.meterTop).toBe(4);
    expect(tune.voices).toHaveLength(1);
    expect(tune.voices[0].notes).toBe("C4:q C4:q G4:q G4:q A4:q A4:q G4:h");
  });

  test("key signatures apply and explicit accidentals persist to the bar line", async () => {
    const { parseABC } = await import("../src/spec/abc");
    // D major: F and C are sharp. The =c naturalizes c for the REST of its bar.
    const tune = parseABC("L:1/4\nK:D\nF c =c c | c F");
    expect(tune.voices[0].notes).toBe("F#4:q C#5:q C5:q C5:q C#5:q F#4:q");
  });

  test("octave marks, chords, rests, ties and dotted/broken rhythm", async () => {
    const { parseABC } = await import("../src/spec/abc");
    const t1 = parseABC("L:1/4\nK:C\nC, c' [CEG]2 z2 C- | C");
    expect(t1.voices[0].notes).toBe("C3:q C6:q C4+E4+G4:h R:h C4:h");
    const t2 = parseABC("L:1/8\nK:C\nA>B c3/2");
    // A>B: dotted A (0.75 beats), halved B (0.25); c3/2 = 0.75 beats.
    expect(t2.voices[0].notes).toBe("A4:e. B4:s C5:e.");
  });

  test("triplets compress to 2/3; V: lines become parallel voices", async () => {
    const { parseABC } = await import("../src/spec/abc");
    const t = parseABC("L:1/4\nK:C\nV:1\n(3CDE F\nV:2\nC2 C2");
    expect(t.voices).toHaveLength(2);
    expect(t.voices[0].notes).toBe("C4:0.667 D4:0.667 E4:0.667 F4:q");
    expect(t.voices[1].notes).toBe("C4:h C4:h");
  });

  test("dotted and numeric durations round-trip through the internal parser", () => {
    const toks = parseNotation("C4:q. D4:e. E4:0.667 F4:h.");
    expect(toks.map((t) => t.beats)).toEqual([1.5, 0.75, 0.667, 3]);
  });

  test("a play command with abc validates, plans with the tune's own tempo, and presses per note", () => {
    const abc = "M:4/4\nL:1/4\nQ:1/4=140\nK:G\nG A B c |";
    const spec = { elements: [{ id: "n0", type: "point", at: { x: 500, y: 375 } }], commands: [{ play: { abc } }] } as never;
    expect(validateSpec(spec).ok).toBe(true);
    const plan = planCommands([{ play: { abc }, reveal: ["n0"] }], ["n0"]);
    const step = plan.steps[0] as { kind: string; tempo: number; seconds: number; voices: PlayVoice[]; revealAt: number[] };
    expect(step.kind).toBe("play");
    expect(step.tempo).toBe(140); // from Q:, no command tempo given
    expect(step.seconds).toBeCloseTo((4 * 60) / 140, 9);
    expect(step.voices[0].notes).toBe("G4:q A4:q B4:q C5:q"); // K:G sharpens F only — none here
    expect(step.revealAt).toEqual([0]);
  });
});
