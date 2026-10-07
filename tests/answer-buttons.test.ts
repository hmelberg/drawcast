// On-canvas answer buttons (spec/answer-buttons.ts): a quiz's choices drawn
// on the figure and tapped — expansion, placement, and the answer path.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { expandAnswerButtons, placeButtons, visibleBefore } from "../src/spec/answer-buttons";
import { validateSpec } from "../src/spec/schema";
import type { Spec } from "../src/spec/types";
import { expandSpec } from "../src/spec/expand";
import { elementBBoxes, layoutSpec } from "../src/layout/layout";
import type { BBox } from "../src/layout/geometry";
import { Player } from "../src/render/player";
import { planCommands } from "../src/render/plan";
import { SpeechManager } from "../src/render/speech";
import { CAPTION_TOP, CONTENT_TOP } from "../src/layout/page";

const tom = (): Spec => {
  const d = JSON.parse(readFileSync(new URL("./fixtures/quiz/true-or-myth.json", import.meta.url), "utf8")) as { spec: Spec };
  for (const c of d.spec.commands ?? []) if (c.quiz) c.quiz.on_canvas = true;
  return d.spec;
};

describe("on-canvas answer buttons", () => {
  it("expands a quiz into buttons, a quiet choose ask and a hide", () => {
    const out = expandAnswerButtons(tom());
    const cmds = out.commands ?? [];
    expect(cmds.some((c) => c.quiz)).toBe(false);
    const k = cmds.findIndex((c) => c.ask);
    expect(cmds[k - 1].draw).toEqual(["quiz_1_btn_1", "quiz_1_btn_2"]);
    expect(cmds[k].ask).toMatchObject({ choose: ["quiz_1_btn_1", "quiz_1_btn_2"], answer: "quiz_1_btn_2", say_question: false });
    expect(cmds[k + 1].hide).toEqual(["quiz_1_btn_1", "quiz_1_btn_2"]);
    const btn = out.elements!.find((e) => e.id === "quiz_1_btn_1")!;
    expect(btn).toMatchObject({ type: "node", shape: "rect", text: "True" });
    expect(out.elements!.some((e) => e.id === "quiz_5_btn_2")).toBe(true);
  });

  it("validates as authored", () => {
    expect(validateSpec(tom()).errors ?? []).toEqual([]);
  });
});

const overlap = (a: BBox, b: BBox): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

describe("where the buttons go", () => {
  it("visibleBefore follows draws, hides and clears", () => {
    expect(visibleBefore([{ draw: ["a", "b"] }, { hide: "a" }, { draw: "c" }], 3)).toEqual(["b", "c"]);
    expect(visibleBefore([{ draw: ["a", "b"] }, { clear: { keep: "b" } }], 2)).toEqual(["b"]);
  });

  it("below the figure and right of its middle when there is room", () => {
    const fig = { x: 300, y: 350, w: 400, h: 280 };
    const { layout, centres } = placeButtons([fig], 2, { w: 140, h: 64 });
    expect(layout).toBe("row");
    for (const c of centres) expect(c.y + 32).toBeLessThanOrEqual(fig.y - 24 + 1e-6);
    expect((centres[0].x + centres[1].x) / 2).toBeGreaterThan(500);
    for (const c of centres) expect(c.y - 32).toBeGreaterThanOrEqual(CAPTION_TOP + 10);
  });

  it("beside the figure when nothing fits below", () => {
    const fig = { x: 250, y: 190, w: 500, h: 430 };
    const { centres } = placeButtons([fig], 2, { w: 140, h: 64 });
    for (const c of centres) expect(c.x - 70).toBeGreaterThanOrEqual(fig.x + fig.w + 24 - 1e-6);
  });

  it("buttons_at and buttons_layout pin them", () => {
    const { layout, centres } = placeButtons([], 2, { w: 140, h: 64 }, { at: { x: 500, y: 300 }, layout: "column" });
    expect(layout).toBe("column");
    expect(centres.map((c) => c.x)).toEqual([500, 500]);
    expect(centres[0].y).toBeGreaterThan(centres[1].y);
  });

  it("as laid out: every quiz's buttons clear of what stands on the page, inside the content area", () => {
    const spec = expandSpec(tom());
    const res = layoutSpec(spec);
    const boxes = elementBBoxes(res);
    const cmds = spec.commands ?? [];
    cmds.forEach((c, i) => {
      if (!c.ask) return;
      const near = visibleBefore(cmds, i).filter((id) => !id.includes("_btn_"));
      for (const id of c.ask.choose as string[]) {
        const b = boxes.get(id)!;
        expect(b).toBeDefined();
        expect(b.y).toBeGreaterThanOrEqual(CAPTION_TOP + 10 - 6);
        expect(b.y + b.h).toBeLessThanOrEqual(CONTENT_TOP + 6);
        for (const n of near) {
          const nb = boxes.get(n);
          if (nb) expect(overlap(b, nb), `${id} on ${n}`).toBe(false);
        }
      }
    });
  });
});

globalThis.requestAnimationFrame ??= ((cb: FrameRequestCallback) =>
  setTimeout(() => cb(performance.now()), 5) as unknown as number) as typeof requestAnimationFrame;

/** A stand-in caption element: what the viewer reads while each line is spoken. */
const captionEl = () => ({ textContent: "", classList: { toggle() {} }, parentElement: null }) as unknown as HTMLElement;

class RecordingSpeech extends SpeechManager {
  spoken: string[] = [];
  captions: string[] = [];
  caption: HTMLElement | null = null;
  override get available(): boolean {
    return false;
  }
  override speak(text: string): Promise<void> {
    this.spoken.push(text);
    this.captions.push(this.caption?.textContent ?? "");
    return Promise.resolve();
  }
  override cancel(): void {}
}

const TWO: Spec = {
  elements: [{ id: "pic", type: "icon", of: "fish", x: 500, y: 450, size: 300 } as never],
  commands: [
    { draw: ["pic"], speak: "A goldfish forgets in three seconds." },
    { quiz: { question: "Goldfish memory: true or myth?", choices: ["True", "Myth"], correct: 2, right: "Myth: months.", wrong: "Not so.", store: "g", on_canvas: true } },
    { speak: "You got {score} of {score_total}; you said {g}." },
  ],
};

function playerOf(spec: Spec, speech: RecordingSpeech) {
  const ex = expandAnswerButtons(spec);
  const ids = (ex.elements ?? []).map((e) => e.id);
  const labels = new Map((ex.elements ?? []).map((e) => [e.id, (e as { text?: string }).text ?? null]));
  const plan = planCommands(ex.commands ?? [], ids, { labelOf: (id) => labels.get(id) ?? null, bboxOf: () => ({ x: 0, y: 0, w: 10, h: 10 }) });
  speech.caption = captionEl();
  return { plan, player: new Player(plan, new Map(), speech, speech.caption, { mode: "narrated", breath: false }) };
}

describe("answering on the buttons", () => {
  it("the question is not spoken or captioned; the gate is told to stay quiet", () => {
    const { plan } = playerOf(TWO, new RecordingSpeech());
    const ask = plan.steps.find((s) => s.kind === "ask");
    if (ask?.kind !== "ask") throw new Error("no ask");
    expect(ask.narration).toBeUndefined();
    expect(ask.quiet).toBe(true);
    expect(ask.question).toBe("Goldfish memory: true or myth?");
    expect(ask.choose!.map((o) => o.label)).toEqual(["True", "Myth"]);
  });

  it("say_question: true speaks it as a quiz would", () => {
    const spec = structuredClone(TWO);
    spec.commands![1].quiz!.say_question = true;
    const { plan } = playerOf(spec, new RecordingSpeech());
    const ask = plan.steps.find((s) => s.kind === "ask");
    expect(ask?.narration).toBe("Goldfish memory: true or myth?");
    expect(ask?.kind === "ask" && ask.quiet).toBeFalsy();
  });

  it("a right tap: scored, stored as the button's words, right spoken, question never", async () => {
    const speech = new RecordingSpeech();
    const { player } = playerOf(TWO, speech);
    let gated: { quiet?: boolean } | null = null;
    player.askGate = async (_s, step) => {
      gated = step as { quiet?: boolean };
      return "quiz_1_btn_2";
    };
    await player.play();
    expect(gated!.quiet).toBe(true);
    expect(speech.spoken).not.toContain("Goldfish memory: true or myth?");
    // A varied affirmation, then the explanation (Hans 2026-10-04) — two
    // utterances, so each is its own baked clip (2026-10-07), under one caption.
    const at = speech.spoken.indexOf("Myth: months.");
    expect(at).toBeGreaterThan(0);
    const nod = speech.spoken[at - 1];
    expect(nod).not.toBe("A goldfish forgets in three seconds.");
    expect(speech.captions[at - 1]).toBe(`${nod} Myth: months.`);
    expect(speech.captions[at]).toBe(`${nod} Myth: months.`);
    expect(speech.spoken.at(-1)).toBe("You got 1 of 1; you said Myth.");
    expect(player.vars.get("g.ok")).toBe("true");
  });

  it("affirm: plain puts the single word before the explanation", async () => {
    const speech = new RecordingSpeech();
    const spec = { ...structuredClone(TWO), affirm: "plain" } as Spec;
    const { player } = playerOf(spec, speech);
    player.affirmer.configure(spec);
    player.askGate = async () => "quiz_1_btn_2";
    await player.play();
    const at = speech.spoken.indexOf("Correct.");
    expect(speech.spoken.slice(at, at + 2)).toEqual(["Correct.", "Myth: months."]);
  });

  it("a wrong tap: wrong, then the reveal; score 0", async () => {
    const speech = new RecordingSpeech();
    const { player } = playerOf(TWO, speech);
    player.askGate = async () => "quiz_1_btn_1";
    await player.play();
    expect(speech.spoken.slice(1)).toEqual(["Not so.", "Myth: months.", "You got 0 of 1; you said True."]);
  });

  it("a movie answers right and plays on", async () => {
    const speech = new RecordingSpeech();
    const { player } = playerOf(TWO, speech);
    await player.play();
    expect(speech.spoken.at(-1)).toBe("You got 1 of 1; you said Myth.");
  });
});
