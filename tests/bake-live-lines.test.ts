// What a bake records for a LIVE viewer (playlist/session.ts playlistBakeLines):
// the movie answers every question right, so the lines only a live viewer
// hears — a `wrong` line, a feedback band's line, a cards count line with the
// viewer's own score — were never recorded and fell back to the browser voice
// in a published cast (Hans 2026-10-07). Each test pins one such source.
import { describe, expect, test } from "vitest";
import { playlistBakeLines } from "../src/playlist/session";
import { singlePlaylist } from "../src/playlist/playlist";
import { speechKey, type SpeakLine } from "../src/render/delivery";
import { FALLBACK_LINES } from "../src/feedback/lines";
import { JOKES } from "../src/feedback/jokes";
import { cardsLineVariants } from "../src/cards/line-variants";
import { cardsGeometryIn } from "../src/spec/cards";
import { expandSpec } from "../src/spec/expand";
import { planCommands } from "../src/render/plan";
import { Player } from "../src/render/player";
import { SpeechManager } from "../src/render/speech";
import type { SpeakOpts } from "../src/render/delivery";
import type { Spec } from "../src/spec/types";

const bake = (spec: Spec): SpeakLine[] => playlistBakeLines(singlePlaylist(spec));
const keys = (spec: Spec): Set<string> => new Set(bake(spec).map(speechKey));
const texts = (spec: Spec): string[] => bake(spec).map((l) => l.text);

const QUIZ: Spec = {
  title: "T",
  voice: "male",
  commands: [
    { speak: "Ready?" },
    { voice: "b", delivery: "grave", quiz: { question: "Which?", choices: ["A", "B"], correct: 2, right: "B, of course.", wrong: "Not A — think again." } },
    { quiz: { question: "And now?", choices: ["C", "D"], correct: 1, wrong: "You picked {q}, sadly." } },
  ],
} as Spec;

describe("wrong lines", () => {
  test("a fixed quiz `wrong` is baked in the voice and delivery the player speaks it with", () => {
    expect(keys(QUIZ).has(speechKey({ text: "Not A — think again.", speaker: "b", delivery: "grave", gender: "male" }))).toBe(true);
  });

  test("a `wrong` with a {placeholder} is not baked (its words are only known live)", () => {
    expect(texts(QUIZ).some((t) => t.includes("{q}") || t.includes("sadly"))).toBe(false);
  });

  test("a fixed ask `wrong` (a typed answer, a choose) is baked", () => {
    const spec = {
      title: "T",
      commands: [
        { ask: { question: "Capital of France?", answer: "Paris", right: "Paris.", wrong: "Try a bigger city." } },
        { voice: "a", ask: { question: "Tap it.", choose: ["x", "y"], answer: "y", right: "Y.", wrong: "Look east." } },
      ],
    } as Spec;
    const lines = bake(spec);
    expect(lines.map((l) => l.text)).toEqual(expect.arrayContaining(["Try a bigger city.", "Look east."]));
    expect(lines.find((l) => l.text === "Look east.")?.speaker).toBe("a");
  });

  test("a guess ask's fixed `right` and `wrong` are baked (the movie's collector skipped them: no `answer`)", () => {
    const spec = {
      title: "T",
      elements: [{ id: "bar", type: "rect", x: 100, y: 100, w: 100, h: 200 }],
      commands: [{ ask: { question: "How tall?", on: "bar", store: "g", right: "Spot on: two hundred.", wrong: "It's two hundred.", feedback: "plain" } }],
    } as unknown as Spec;
    expect(texts(spec)).toEqual(expect.arrayContaining(["Spot on: two hundred.", "It's two hundred."]));
  });
});

describe("feedback band lines", () => {
  test("a question's own band lines are baked in its voice", () => {
    const spec = {
      title: "T",
      commands: [{ voice: "b", ask: { question: "Capital?", answer: "Paris", right: "Paris.", feedback: { style: "warm", perfect: "A geographer!", none: "The map fooled you." } } }],
    } as Spec;
    const lines = bake(spec);
    for (const t of ["A geographer!", "The map fooled you."]) expect(lines.find((l) => l.text === t)?.speaker).toBe("b");
    // The bands the cast left to the bundled English set.
    expect(lines.map((l) => l.text)).toEqual(expect.arrayContaining(FALLBACK_LINES.warm.good ?? []));
  });

  test("a joke reward bakes the bundled jokes; plain feedback bakes no band lines", () => {
    const joke = { title: "T", commands: [{ quiz: { question: "Q?", choices: ["a", "b"], correct: 1, feedback: { style: "warm", reward: "joke" } } }] } as Spec;
    expect(texts(joke)).toEqual(expect.arrayContaining([...JOKES]));
    const plain = { title: "T", commands: [{ quiz: { question: "Q?", choices: ["a", "b"], correct: 1 } }] } as Spec;
    for (const l of Object.values(FALLBACK_LINES.warm).flat()) expect(texts(plain)).not.toContain(l);
  });
});

describe("cards count lines", () => {
  const CARDS = {
    title: "T",
    elements: [
      {
        id: "land",
        type: "cards",
        select: "Had malaria",
        items: [
          { text: "USA", in: true },
          { text: "Italy", in: true },
          { text: "Iceland", in: false },
        ],
      },
    ],
    commands: [{ voice: "b", ask: { question: "Tap every country that had it.", on: "land", store: "m", right: "All {m.total} right.", wrong: "{m.within} of {m.total} on the first try." } }],
  } as unknown as Spec;

  test("every score a viewer can reach is baked, in the ask's voice", () => {
    const lines = bake(CARDS);
    for (const t of ["All 3 right.", "0 of 3 on the first try.", "1 of 3 on the first try.", "2 of 3 on the first try.", "3 of 3 on the first try."]) {
      expect(lines.find((l) => l.text === t)?.speaker, t).toBe("b");
    }
    expect(lines.some((l) => l.text.includes("{"))).toBe(false);
  });

  test("the variants are the player's own: the same function its prefetch uses", () => {
    const g = cardsGeometryIn(expandSpec(structuredClone(CARDS)), "land")!;
    const v = cardsLineVariants({ store: "m", right: "All {m.total} right.", wrong: "{m} of {m.total} on the first try." }, g, new Map(), (s) => s);
    expect(v).toContain("All 3 right.");
    expect(v.length).toBeGreaterThanOrEqual(5);
  });

  test("a line reading a free value as well (a placed card's distance) is not baked", () => {
    const spec = structuredClone(CARDS);
    spec.commands![0].ask!.wrong = "{m.within} of {m.total}; off by {m.off}.";
    expect(texts(spec).some((t) => t.includes("off by"))).toBe(false);
  });
});

describe("a live viewer hears only baked lines (on-canvas buttons, end to end)", () => {
  globalThis.requestAnimationFrame ??= ((cb: FrameRequestCallback) => setTimeout(() => cb(performance.now()), 5) as unknown as number) as typeof requestAnimationFrame;

  class KeySpeech extends SpeechManager {
    said: string[] = [];
    override get available(): boolean {
      return false;
    }
    override speak(text: string, _speed?: number, _signal?: AbortSignal, opts?: SpeakOpts): Promise<void> {
      this.said.push(speechKey({ text, speaker: opts?.speaker, delivery: opts?.delivery, gender: opts?.gender }));
      return Promise.resolve();
    }
    override cancel(): void {}
  }

  const BUTTONS = {
    title: "T",
    affirm: "playful",
    elements: [{ id: "pic", type: "icon", of: "fish", x: 500, y: 450, size: 300 }],
    commands: [
      { draw: ["pic"], speak: "A goldfish forgets in three seconds." },
      { voice: "b", quiz: { question: "Goldfish memory: true or myth?", choices: ["True", "Myth"], correct: 2, right: "Myth: months.", wrong: "Not so.", on_canvas: true, feedback: { style: "warm", perfect: "A fish whisperer.", none: "Fish fool everyone." } } },
      { quiz: { question: "Do fish sleep?", choices: ["Yes", "No"], correct: 1, on_canvas: true } },
    ],
  } as unknown as Spec;

  for (const taps of [["quiz_1_btn_2", "quiz_2_btn_1"], ["quiz_1_btn_1", "quiz_2_btn_2"]]) {
    test(`taps ${taps.join(", ")}`, async () => {
      const baked = keys(BUTTONS);
      const ex = expandSpec(structuredClone(BUTTONS));
      const ids = (ex.elements ?? []).map((e) => e.id);
      const labels = new Map((ex.elements ?? []).map((e) => [e.id, (e as { text?: string }).text ?? null]));
      const plan = planCommands(ex.commands ?? [], ids, { labelOf: (id) => labels.get(id) ?? null, bboxOf: () => ({ x: 0, y: 0, w: 10, h: 10 }), feedback: ex.feedback });
      const speech = new KeySpeech();
      const player = new Player(plan, new Map(), speech, null, { mode: "narrated", breath: false });
      player.affirmer.configure(ex);
      const queue = [...taps];
      player.askGate = async () => queue.shift() ?? null;
      await player.play();
      expect(speech.said.length).toBeGreaterThan(3);
      for (const k of speech.said) expect(baked.has(k), k).toBe(true);
    });
  }
});
