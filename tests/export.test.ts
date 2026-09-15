import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { speechKey, type SpeakOpts } from "../src/render/delivery";
import { BufferSpeech } from "../src/export/tts";
import { collectSpeakLines, narrationLanguage, wrapCaption } from "../src/export/video";
import type { Spec } from "../src/spec/types";

/** Minimal WebAudio stand-ins: connect() records where the audio flows, start() ends immediately. */
function fakeGraph() {
  const connections: unknown[] = [];
  const src = {
    buffer: null as AudioBuffer | null,
    onended: null as (() => void) | null,
    connect: (node: unknown) => connections.push(node),
    start: () => src.onended?.(),
    stop: () => {},
  };
  const audioCtx = { createBufferSource: () => src, destination: { name: "speakers" } };
  const dest = { name: "recorder" };
  return { connections, audioCtx, src, dest };
}

describe("collectSpeakLines", () => {
  test("collects distinct narration lines in storyboard order, with speaker/delivery/gender attached", () => {
    const lines = collectSpeakLines({
      voice: "male",
      commands: [
        { speak: "First line." },
        { draw: ["a"] },
        { speak: "Second line.", blocking: false, voice: "b", delivery: "soft" },
        { speak: "First line." }, // duplicate (same text/speaker/delivery/gender) synthesized once
        { pause: 1 },
      ],
    });
    expect(lines).toEqual([
      { text: "First line.", speaker: undefined, delivery: undefined, gender: "male" },
      { text: "Second line.", speaker: "b", delivery: "soft", gender: "male" },
    ]);
  });

  test("quiz lines are pre-synthesized: question (or paired speak), right, and the reveal fallback", () => {
    const lines = collectSpeakLines({
      voice: "female",
      commands: [
        { quiz: { question: "Which?", choices: ["one", "two"], correct: 2, right: "Yes, two.", wrong: "No." } },
        { speak: "Custom intro.", quiz: { question: "Second?", choices: ["a", "b"], correct: 1 } },
      ],
    } as never);
    const texts = lines.map((l) => l.text);
    expect(texts).toContain("Which?");
    expect(texts).toContain("Yes, two.");
    expect(texts).toContain("Custom intro.");
    expect(texts).toContain("a"); // reveal fallback for the second quiz (no right line)
    expect(texts).not.toContain("Second?"); // the paired speak replaced the question narration
    expect(texts).not.toContain("No."); // the export never takes the wrong path
    expect(lines.every((l) => l.gender === "female")).toBe(true);
  });

  test("typed-ask lines: question, right-or-answer in check mode, nothing extra in collect mode", () => {
    const lines = collectSpeakLines({
      commands: [
        { ask: { question: "Symbol for gold?", answer: "Au", wrong: "No." } },
        { ask: { question: "What is your name?", store: "name", default: "friend" } },
      ],
    } as never);
    const texts = lines.map((l) => l.text);
    expect(texts).toContain("Symbol for gold?");
    expect(texts).toContain("Au"); // reveal fallback (no right line)
    expect(texts).toContain("What is your name?");
    expect(texts).not.toContain("No."); // movies never answer wrong
    expect(texts).not.toContain("friend"); // collect mode speaks nothing extra
  });

  test("stored defaults interpolate into later lines at collection time", () => {
    const lines = collectSpeakLines({
      commands: [
        { ask: { question: "What is your name?", store: "name", default: "friend" } },
        { speak: "Nice to meet you, {name}!" },
        { quiz: { question: "Ready, {name}?", choices: ["yes", "no"], correct: 1, right: "Off we go, {name}." } },
      ],
    } as never);
    const texts = lines.map((l) => l.text);
    expect(texts).toContain("Nice to meet you, friend!");
    expect(texts).toContain("Ready, friend?");
    expect(texts).toContain("Off we go, friend.");
    expect(texts.some((t) => t.includes("{name}"))).toBe(false);
  });

  test("intro joins the spoken question line, matching the player", () => {
    const lines = collectSpeakLines({
      commands: [
        { quiz: { question: "Which?", choices: ["a", "b"], correct: 1, intro: "Test time!" } },
        { ask: { question: "Gold?", answer: "Au", intro: "A quick check!" }, speak: "Here it comes." },
      ],
    } as never);
    const texts = lines.map((l) => l.text);
    expect(texts).toContain("Test time! Which?");
    expect(texts).toContain("A quick check! Here it comes.");
    expect(texts).not.toContain("Here it comes."); // never spoken bare
    expect(texts).not.toContain("Which?");
  });

  test("the movie's score tally interpolates: pre-answer in questions, post-answer in feedback", () => {
    const lines = collectSpeakLines({
      commands: [
        { quiz: { question: "First — {score} so far?", choices: ["a", "b"], correct: 1, right: "Now {score} of {score_total}." } },
        { ask: { question: "Second?", answer: "x", right: "That makes {score}." } },
        { speak: "Final: {score} of {score_total}." },
      ],
    } as never);
    const texts = lines.map((l) => l.text);
    expect(texts).toContain("First — 0 so far?");
    expect(texts).toContain("Now 1 of 1.");
    expect(texts).toContain("That makes 2.");
    expect(texts).toContain("Final: 2 of 2.");
  });

  test("the same text spoken by two different voices stays distinct", () => {
    const lines = collectSpeakLines({
      voice: "female",
      commands: [{ speak: "Hi" }, { speak: "Hi", voice: "b" }],
    });
    expect(lines).toHaveLength(2);
  });

  test("ignores empty narration and specs without commands", () => {
    expect(collectSpeakLines({ commands: [{ speak: "  " }, { draw: ["a"] }] })).toEqual([]);
    expect(collectSpeakLines({})).toEqual([]);
  });

  test("an explore beat on a controls script is voiced (its demo plays in the movie); without controls or with play: false it is not", () => {
    const withControls = { elements: [{ id: "sim", type: "code", language: "python", show: "left", controls: ["b"], code: "b = (1, 5)" }], commands: [{ explore: { code: "sim" }, speak: "Try it." }] };
    expect(collectSpeakLines(withControls as never).map((l) => l.text)).toEqual(["Try it."]);
    const noDemo = { ...withControls, commands: [{ explore: { code: "sim", play: false }, speak: "Try it." }] };
    expect(collectSpeakLines(noDemo as never)).toEqual([]);
    const noControls = { elements: [{ id: "p", type: "code", language: "python", show: "left", code: "print(1)" }], commands: [{ explore: { code: "p" }, speak: "Try it." }] };
    expect(collectSpeakLines(noControls as never)).toEqual([]);
    const plain = { elements: [], commands: [{ explore: { params: ["n"] }, speak: "Try it." }] };
    expect(collectSpeakLines(plain as never)).toEqual([]);
  });

  test("a run's speak is voiced like any action's", () => {
    const s = { elements: [{ id: "sim", type: "code", language: "python", show: "left", controls: ["b"], code: "b = (1, 5)" }], commands: [{ run: { code: "sim", values: { b: [1, 2] } }, speak: "Watch." }] };
    expect(collectSpeakLines(s as never).map((l) => l.text)).toEqual(["Watch."]);
  });
});

describe("the export's sweep warm-up (source pins — the export is DOM-driven)", () => {
  const src = readFileSync("src/export/video.ts", "utf8");
  test("the recorder holds its breath over the item's mount and its sweep warm-up — paused before render, resumed before play — so neither bakes a still lead-in", () => {
    expect(src).toMatch(/import \{ precomputeSweeps \} from "\.\.\/render\/sweep-run";/);
    // Guarded: a player with no runtime (no run steps, a headless mount) has no runner.
    expect(src).toMatch(/if \(handle\.timeline\.sweepRunner\) await precomputeSweeps\(handle\.plan, handle\.timeline\.sweepRunner\);/);
    // The two pause sources share `recorder.state` and nothing else, so the
    // loop resumes ONLY what it paused itself (`heldByLoop`) and never into a
    // hidden tab — where the visibility pauser owns the recorder and its own
    // handler will resume it when the tab comes back (fix round 2).
    expect(src).toMatch(/let heldByLoop = false;/);
    expect(src).toMatch(/if \(recorder\.state === "recording"\) \{\s*recorder\.pause\(\);\s*heldByLoop = true;\s*\}/);
    expect(src).toMatch(/if \(heldByLoop && recorder\.state === "paused" && !document\.hidden\) recorder\.resume\(\);/);
    // Searched from the item loop, so the visibility pauser's own pair (which
    // uses the very same two calls, above the loop) cannot stand in for these.
    const loop = src.indexOf("for (let i = 0; i < items.length; i++)");
    expect(loop).toBeGreaterThan(-1);
    const pause = src.indexOf('if (recorder.state === "recording") {', loop);
    const mount = src.indexOf("handle = await render(items[i]", loop);
    const warm = src.indexOf("await precomputeSweeps(handle.plan, handle.timeline.sweepRunner)", loop);
    const resume = src.indexOf('if (heldByLoop && recorder.state === "paused" && !document.hidden) recorder.resume();', loop);
    const play = src.indexOf("await handle.timeline.play();", loop);
    for (const i of [pause, mount, warm, resume, play]) expect(i).toBeGreaterThan(-1);
    expect(pause).toBeLessThan(mount);
    expect(mount).toBeLessThan(warm);
    expect(warm).toBeLessThan(resume);
    expect(resume).toBeLessThan(play);
    // …and the resume lives in ONE place, a finally, so a mount or a warm-up
    // that throws does not leave the recorder paused for good.
    const fin = src.indexOf("} finally {", warm);
    expect(fin).toBeGreaterThan(warm);
    expect(fin).toBeLessThan(resume);
  });
});

describe("BufferSpeech", () => {
  test("resolves buffers by speechKey, so the same text in two voices stays distinct", async () => {
    const bufferA = { id: "a" } as unknown as AudioBuffer;
    const bufferB = { id: "b" } as unknown as AudioBuffer;
    const buffers = new Map<string, AudioBuffer>([
      [speechKey({ text: "Hi", speaker: "a" }), bufferA],
      [speechKey({ text: "Hi", speaker: "b" }), bufferB],
    ]);
    const { audioCtx, src, dest } = fakeGraph();
    const speech = new BufferSpeech(audioCtx as never, dest as never, buffers);

    await speech.speak("Hi", 1, undefined, { speaker: "b" });

    expect(src.buffer).toBe(bufferB);
  });
});

// Guards the silent-failure link between two independent key-construction
// paths for the SAME spoken line: collectSpeakLines (src/export/video.ts,
// what synthesizeAll pre-synthesizes and keys buffers by) and the opts the
// live Player passes to speech.speak() (src/render/player.ts's runStep,
// after render() calls player.setNarratorGender(spec.voice) — see
// src/render/index.ts). If either path drifts (a renamed field, a dropped
// default), BufferSpeech.speak's lookup (src/export/tts.ts) misses silently
// and narration just goes quiet — no error, no test failure elsewhere.
describe("export-key link: BufferSpeech lookup vs collectSpeakLines", () => {
  test("the key BufferSpeech looks up for a narrated draw+speak command matches the key collectSpeakLines derives for the same line", async () => {
    const spec: Spec = {
      voice: "female",
      commands: [{ draw: ["a"], speak: "Explaining b.", voice: "b", delivery: "grave" }],
    } as unknown as Spec;

    const lines = collectSpeakLines(spec);
    expect(lines).toEqual([{ text: "Explaining b.", speaker: "b", delivery: "grave", gender: "female" }]);
    const collectKey = speechKey(lines[0]);

    // What the Player builds for this command: narrationSpeaker/narrationDelivery
    // come straight from the command's voice/delivery, gender from
    // this.narratorGender (set to spec.voice by setNarratorGender at render()).
    const playerOpts: SpeakOpts = { speaker: "b", delivery: "grave", gender: "female" };
    const lookupKey = speechKey({ text: "Explaining b.", speaker: playerOpts.speaker, delivery: playerOpts.delivery, gender: playerOpts.gender });

    expect(lookupKey).toBe(collectKey);

    // And prove the lookup actually resolves through BufferSpeech, not just
    // that the two key strings happen to match in isolation.
    const buffer = { id: "buf" } as unknown as AudioBuffer;
    const buffers = new Map<string, AudioBuffer>([[collectKey, buffer]]);
    const { audioCtx, src, dest } = fakeGraph();
    const speech = new BufferSpeech(audioCtx as never, dest as never, buffers);

    await speech.speak("Explaining b.", 1, undefined, playerOpts);

    expect(src.buffer).toBe(buffer);
  });
});

describe("wrapCaption", () => {
  const measure = (s: string) => s.length * 10; // 10px per character

  test("keeps short captions on one line", () => {
    expect(wrapCaption(measure, "short and sweet", 400)).toEqual(["short and sweet"]);
  });

  test("wraps greedily at the measured width", () => {
    expect(wrapCaption(measure, "aaaa bbbb cccc dddd", 100)).toEqual(["aaaa bbbb", "cccc dddd"]);
  });

  test("a single overlong word still lands on its own line", () => {
    expect(wrapCaption(measure, "supercalifragilistic yes", 100)).toEqual(["supercalifragilistic", "yes"]);
  });
});

describe("narrationLanguage", () => {
  test("a Norwegian narration reports nb, so YouTube tags the audio as Norwegian", () => {
    const spec: Spec = { commands: [{ speak: "Her er kurven vi skal se på." }, { speak: "Legg merke til hvor den bøyer av." }] };
    expect(narrationLanguage([spec])).toBe("nb");
  });

  test("the majority of the lines decides — one stray line does not flip the whole video", () => {
    const spec: Spec = {
      commands: [{ speak: "Here is the curve." }, { speak: "Notice where it bends." }, { speak: "Og her er poenget." }],
    };
    expect(narrationLanguage([spec])).toBe("en");
  });

  test("a drawcast with no narration at all falls back to English rather than throwing", () => {
    expect(narrationLanguage([{ commands: [{ draw: ["a"] }] }])).toBe("en");
  });
});
