import { describe, expect, test } from "vitest";
import { Player } from "../src/render/player";
import { planCommands } from "../src/render/plan";
import { SpeechManager } from "../src/render/speech";
import type { Command } from "../src/spec/types";

// node has no rAF; drive Player.progress with a timer-based stand-in.
globalThis.requestAnimationFrame ??= ((cb: FrameRequestCallback) =>
  setTimeout(() => cb(performance.now()), 5) as unknown as number) as typeof requestAnimationFrame;

class RecordingSpeech extends SpeechManager {
  spoken: string[] = [];
  override get available(): boolean {
    return false;
  }
  override speak(text: string): Promise<void> {
    this.spoken.push(text);
    return Promise.resolve();
  }
  override cancel(): void {}
}

function makePlayer(commands: Command[], speech: RecordingSpeech, questions?: "on" | "skip") {
  return new Player(planCommands(commands, []), new Map(), speech, null, { mode: "narrated", questions });
}

describe("skip questions", () => {
  test("a skipped quiz says nothing and never gates", async () => {
    const speech = new RecordingSpeech();
    const player = makePlayer(
      [{ quiz: { question: "Which?", choices: ["a", "b"], correct: 1, right: "A." } }, { speak: "Moving on." }],
      speech,
      "skip",
    );
    let gated = false;
    player.quizGate = async () => {
      gated = true;
      return null;
    };
    await player.play();
    expect(gated).toBe(false);
    expect(speech.spoken).toEqual(["Moving on."]);
    expect(player.state).toBe("done");
  });

  test("a skipped collect-ask still stores its default for later lines", async () => {
    const speech = new RecordingSpeech();
    const player = makePlayer(
      [{ ask: { question: "Name?", store: "name", default: "friend" } }, { speak: "Hello, {name}." }],
      speech,
      "skip",
    );
    let gated = false;
    player.askGate = async () => {
      gated = true;
      return null;
    };
    await player.play();
    expect(gated).toBe(false);
    expect(speech.spoken).toEqual(["Hello, friend."]);
  });
});

describe("the typed ask action", () => {
  test("collect: the typed answer is stored and interpolated into later narration", async () => {
    const speech = new RecordingSpeech();
    const player = makePlayer(
      [
        { ask: { question: "What is your name?", store: "name", default: "friend" } },
        { speak: "Nice to meet you, {name}!" },
      ],
      speech,
    );
    player.askGate = async () => "Hans";
    await player.play();
    expect(player.vars.get("name")).toBe("Hans");
    expect(speech.spoken).toEqual(["What is your name?", "Nice to meet you, Hans!"]);
  });

  test("collect skipped: the default is stored and used", async () => {
    const speech = new RecordingSpeech();
    const player = makePlayer(
      [{ ask: { question: "Name?", store: "name", default: "friend" } }, { speak: "Hello, {name}." }],
      speech,
    );
    player.askGate = async () => null;
    await player.play();
    expect(speech.spoken).toEqual(["Name?", "Hello, friend."]);
  });

  test("check correct (case-insensitive): right only", async () => {
    const speech = new RecordingSpeech();
    const player = makePlayer([{ ask: { question: "Gold?", answer: "Au", right: "Gold is Au.", wrong: "No." } }], speech);
    player.askGate = async () => "  au ";
    await player.play();
    expect(speech.spoken).toEqual(["Gold?", "Gold is Au."]);
  });

  test("check wrong without retry: wrong then the reveal", async () => {
    const speech = new RecordingSpeech();
    const player = makePlayer([{ ask: { question: "Gold?", answer: "Au", right: "Gold is Au.", wrong: "Not that." } }], speech);
    player.askGate = async () => "Ag";
    await player.play();
    expect(speech.spoken).toEqual(["Gold?", "Not that.", "Gold is Au."]);
  });

  test("check wrong with reveal false: wrong only", async () => {
    const speech = new RecordingSpeech();
    const player = makePlayer([{ ask: { question: "Gold?", answer: "Au", wrong: "Not that.", reveal: false } }], speech);
    player.askGate = async () => "Ag";
    await player.play();
    expect(speech.spoken).toEqual(["Gold?", "Not that."]);
  });

  test("retry: the gate is asked again until correct", async () => {
    const speech = new RecordingSpeech();
    const player = makePlayer([{ ask: { question: "Gold?", answer: "Au", right: "Gold is Au.", wrong: "Try again.", retry: true } }], speech);
    const attempts = ["Ag", "Au"];
    player.askGate = async () => attempts.shift() ?? null;
    await player.play();
    expect(speech.spoken).toEqual(["Gold?", "Try again.", "Gold is Au."]);
  });

  test("skipped during retry with reveal: the reveal line speaks", async () => {
    const speech = new RecordingSpeech();
    const player = makePlayer([{ ask: { question: "Gold?", answer: "Au", wrong: "Try again.", retry: true } }], speech);
    const attempts: (string | null)[] = ["Ag", null];
    player.askGate = async () => attempts.shift() ?? null;
    await player.play();
    expect(speech.spoken).toEqual(["Gold?", "Try again.", "Au"]);
  });

  test("no gate (auto): types the answer — right speaks; collect stores the default", async () => {
    const speech = new RecordingSpeech();
    const player = makePlayer(
      [
        { ask: { question: "Gold?", answer: "Au", right: "Gold is Au." } },
        { ask: { question: "Name?", store: "name", default: "friend" } },
        { speak: "Bye, {name}." },
      ],
      speech,
    );
    await player.play();
    expect(speech.spoken).toEqual(["Gold?", "Gold is Au.", "Name?", "Bye, friend."]);
    expect(player.state).toBe("done");
  });
});

// A click question shows WHERE the answer was: the correct element glows
// while the answer line is spoken — green when the viewer found it, the
// highlight colour when it is revealed after a miss or a skip. The typed
// ask has no element to show, so nothing glows there.
/** A recording stand-in for the backend's effects: every glow frame and every end. */
const fakeEffects = () => {
  const calls: { ids: string[]; effect: string; color?: string }[] = [];
  const ended: string[][] = [];
  const pointer: unknown[] = [];
  const effects = {
    setHighlight: (ids: string[], effect: string, _t: number, _box: unknown, color?: string) => {
      calls.push({ ids, effect, color });
    },
    endHighlight: (ids: string[]) => {
      ended.push(ids);
    },
    setPointer: (p: unknown) => {
      pointer.push(p);
    },
    setCamera: () => undefined,
  };
  return { effects, calls, ended, pointer };
};

describe("the click ask glows the answer element", () => {
  const LIVER_BOX = { x: 10, y: 20, w: 30, h: 40 };
  const clickPlayer = (speech: RecordingSpeech, effects: unknown, ask: Record<string, unknown>) => {
    const plan = planCommands(
      [{ draw: ["liver", "stomach"] }, { ask: { question: "Click on the liver.", widget: "click", answer: "liver", ...ask } } as Command],
      ["liver", "stomach"],
      { bboxOf: (id) => (id === "liver" ? LIVER_BOX : null) },
    );
    return new Player(plan, new Map(), speech, null, { mode: "narrated", effects: effects as never });
  };

  test("a right click: the liver glows green while the right line is spoken", async () => {
    const speech = new RecordingSpeech();
    const { effects, calls, ended } = fakeEffects();
    const player = clickPlayer(speech, effects, { right: "The liver, under the right ribs." });
    player.askGate = async () => "liver";
    await player.play();
    expect(speech.spoken).toEqual(["Click on the liver.", "The liver, under the right ribs."]);
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every((c) => c.ids.join() === "liver" && c.effect === "glow")).toBe(true);
    expect(calls[0].color).toBe("#4a7c59");
    expect(ended).toEqual([["liver"]]);
  });

  test("a wrong click: the liver glows in the highlight colour while the answer is revealed", async () => {
    const speech = new RecordingSpeech();
    const { effects, calls, ended } = fakeEffects();
    const player = clickPlayer(speech, effects, { right: "The liver, under the right ribs.", wrong: "Not there." });
    player.askGate = async () => "stomach";
    await player.play();
    expect(speech.spoken).toEqual(["Click on the liver.", "Not there.", "The liver, under the right ribs."]);
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every((c) => c.ids.join() === "liver" && c.effect === "glow" && c.color === undefined)).toBe(true);
    expect(ended).toEqual([["liver"]]);
  });

  test("a skip reveals too: the liver glows while its id is spoken", async () => {
    const speech = new RecordingSpeech();
    const { effects, calls } = fakeEffects();
    const player = clickPlayer(speech, effects, {});
    player.askGate = async () => null;
    await player.play();
    expect(speech.spoken).toEqual(["Click on the liver.", "liver"]);
    expect(calls.length).toBeGreaterThan(0);
  });

  test("reveal: false keeps a miss dark", async () => {
    const speech = new RecordingSpeech();
    const { effects, calls } = fakeEffects();
    const player = clickPlayer(speech, effects, { reveal: false });
    player.askGate = async () => "stomach";
    await player.play();
    expect(speech.spoken).toEqual(["Click on the liver."]);
    expect(calls).toEqual([]);
  });

  test("the typed ask never glows — there is no element to show", async () => {
    const speech = new RecordingSpeech();
    const { effects, calls } = fakeEffects();
    const plan = planCommands([{ ask: { question: "Gold?", answer: "Au", right: "Gold is Au." } }], [], { bboxOf: () => LIVER_BOX });
    const player = new Player(plan, new Map(), speech, null, { mode: "narrated", effects: effects as never });
    player.askGate = async () => "Ag";
    await player.play();
    expect(speech.spoken).toEqual(["Gold?", "Gold is Au."]);
    expect(calls).toEqual([]);
  });
});

// A drag question shows the truth in two colours: when it ends, every element
// item appears, the hits glow green and the misses the highlight colour while
// the answer line is spoken. The movie's laser taps each target in turn.
describe("the drag ask shows the truth in two colours", () => {
  const boxes: Record<string, { x: number; y: number; w: number; h: number }> = {
    heart: { x: 10, y: 10, w: 20, h: 20 },
    liver: { x: 40, y: 10, w: 30, h: 20 },
  };
  const dragPlayer = (speech: RecordingSpeech, effects: unknown, extra: Record<string, unknown> = {}) => {
    const plan = planCommands(
      [{ draw: ["body"] }, { ask: { question: "Place.", widget: "drag", items: ["heart", "liver"], right: "Heart up, liver right.", wrong: "Not quite.", ...extra } } as Command],
      ["body", "heart", "liver"],
      { bboxOf: (id) => boxes[id] ?? null },
    );
    const finished: string[] = [];
    const el = (id: string) => ({ id, finish: () => finished.push(id), hide: () => undefined, setProgress: () => undefined, durationMs: 100 }) as never;
    const elements = new Map(["body", "heart", "liver"].map((id) => [id, el(id)]));
    return { player: new Player(plan, elements, speech, null, { mode: "narrated", effects: effects as never }), finished };
  };

  test("all placed: both glow green while right is spoken; the elements are shown", async () => {
    const speech = new RecordingSpeech();
    const { effects, calls, ended } = fakeEffects();
    const { player, finished } = dragPlayer(speech, effects);
    player.askGate = async () => "heart,liver";
    await player.play();
    expect(speech.spoken).toEqual(["Place.", "Heart up, liver right."]);
    expect(finished).toEqual(expect.arrayContaining(["heart", "liver"]));
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every((c) => c.ids.join() === "heart,liver" && c.color === "#4a7c59")).toBe(true);
    expect(ended).toEqual([["heart", "liver"]]);
  });

  test("one missed: wrong then the reveal; the hit glows green, the miss the highlight colour", async () => {
    const speech = new RecordingSpeech();
    const { effects, calls } = fakeEffects();
    const { player } = dragPlayer(speech, effects);
    player.askGate = async () => "heart";
    await player.play();
    expect(speech.spoken).toEqual(["Place.", "Not quite.", "Heart up, liver right."]);
    const colours = new Map(calls.map((c) => [c.ids.join(), c.color]));
    expect(colours.get("heart")).toBe("#4a7c59");
    expect(colours.has("liver")).toBe(true);
    expect(colours.get("liver")).toBeUndefined(); // the highlight colour
    expect(colours.size).toBe(2);
  });

  test("skipped: the reveal speaks and everything glows in the highlight colour", async () => {
    const speech = new RecordingSpeech();
    const { effects, calls } = fakeEffects();
    const { player } = dragPlayer(speech, effects);
    player.askGate = async () => null;
    await player.play();
    expect(speech.spoken).toEqual(["Place.", "Heart up, liver right."]);
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every((c) => c.ids.join() === "heart,liver" && c.color === undefined)).toBe(true);
  });

  test("no gate (movie): the laser taps each target box, the right line speaks, no glow", async () => {
    const speech = new RecordingSpeech();
    const { effects, calls, pointer } = fakeEffects();
    const { player, finished } = dragPlayer(speech, effects);
    await player.play();
    expect(speech.spoken).toEqual(["Place.", "Heart up, liver right."]);
    const nulls = pointer.filter((p) => p === null).length;
    expect(nulls).toBeGreaterThanOrEqual(2); // one hide per tap, one tap per target
    expect(pointer.filter((p) => p !== null).length).toBeGreaterThan(1);
    expect(finished).toEqual(expect.arrayContaining(["heart", "liver"]));
    expect(calls).toEqual([]);
  });
});
