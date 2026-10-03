// Reveal stamps (spec/reveal-stamps.ts, round 2 W11): a question's `reveal`
// draws a short verdict beside its figure WITH the reveal line — expansion,
// placement as drawn, the plan's visibility, and the moment it lands.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { expandRevealStamps, linkStampsToButtons, placeStamp, STAMP_BLUE, STAMP_RED, STAMP_TILT, stampColor } from "../src/spec/reveal-stamps";
import { expandAnswerButtons, visibleBefore } from "../src/spec/answer-buttons";
import { validateSpec } from "../src/spec/schema";
import { expandSpec } from "../src/spec/expand";
import { elementBBoxes, layoutSpec } from "../src/layout/layout";
import type { BBox } from "../src/layout/geometry";
import { CAPTION_TOP, CONTENT_TOP } from "../src/layout/page";
import { Player } from "../src/render/player";
import { planCommands } from "../src/render/plan";
import { SpeechManager } from "../src/render/speech";
import type { RenderedElement } from "../src/render/backend";
import type { Spec } from "../src/spec/types";

/** library/quiz/true-or-myth.json as it would be written now: buttons on the
 *  figure and `reveal: true` instead of the hand-drawn MYTH/TRUE texts, the
 *  draws after each quiz and the 1.5 s pauses that let viewers catch them. */
const tom = (): Spec => {
  const d = JSON.parse(readFileSync(new URL("../library/quiz/true-or-myth.json", import.meta.url), "utf8")) as { spec: Spec };
  const s = d.spec;
  s.elements = (s.elements ?? []).filter((e) => !e.id.endsWith("_v"));
  const ids = (v: unknown): string[] => (typeof v === "string" ? [v] : Array.isArray(v) ? (v as string[]) : []);
  s.commands = (s.commands ?? []).flatMap((c) => {
    if (c.quiz) c.quiz = { ...c.quiz, on_canvas: true, reveal: true };
    if (c.draw !== undefined && ids(c.draw).every((id) => id.endsWith("_v"))) return [];
    if (c.pause !== undefined) return [];
    if (c.hide !== undefined) c.hide = ids(c.hide).filter((id) => !id.endsWith("_v"));
    return [c];
  });
  return s;
};

describe("expanding a reveal", () => {
  it("validates as authored", () => {
    expect(validateSpec(tom()).errors ?? []).toEqual([]);
  });

  it("reveal: true stamps the right choice's words: MYTH in red, TRUE in blue", () => {
    const out = expandRevealStamps(tom());
    const s1 = out.elements!.find((e) => e.id === "reveal_1_stamp") as unknown as { text: string; style: { color: string }; type: string };
    expect(s1).toMatchObject({ type: "node", text: "MYTH", style: { color: STAMP_RED } });
    const s4 = out.elements!.find((e) => e.id === "reveal_4_stamp") as unknown as { text: string; style: { color: string } };
    expect(s4).toMatchObject({ text: "TRUE", style: { color: STAMP_BLUE } });
    const q = (out.commands ?? []).find((c) => c.quiz)!.quiz!;
    expect(q.reveal_stamp).toBe("reveal_1_stamp");
    expect(q.reveal).toBeUndefined();
  });

  it("goes with its figure: the hide of the icon takes the stamp along", () => {
    const out = expandRevealStamps(tom());
    const hides = (out.commands ?? []).filter((c) => c.hide !== undefined).map((c) => c.hide);
    expect(hides).toContainEqual(["gw", "gw_l", "reveal_1_stamp"]);
    expect(hides).toContainEqual(["octo", "octo_l", "reveal_5_stamp"]);
  });

  it("carries through the on-canvas buttons onto the ask, which knows the buttons as obstacles", () => {
    const out = linkStampsToButtons(expandAnswerButtons(expandRevealStamps(tom())));
    const ask = (out.commands ?? []).find((c) => c.ask)!.ask!;
    expect(ask.reveal_stamp).toBe("reveal_1_stamp");
    expect(ask.reveal).toBeUndefined();
    const hint = (out.elements!.find((e) => e.id === "reveal_1_stamp") as unknown as { reveal_stamp: { about: string[]; near: string[] } }).reveal_stamp;
    expect(hint.about).toEqual(["gw", "gw_l"]);
    expect(hint.near).toEqual(expect.arrayContaining(["gw", "gw_l", "quiz_1_btn_1", "quiz_1_btn_2"]));
  });

  it("words of the author's own, a label look, a colour, and keep", () => {
    const spec: Spec = {
      elements: [{ id: "pic", type: "icon", of: "moon", x: 400, y: 450, size: 300 } as never],
      commands: [
        { draw: ["pic"], speak: "How long can a person stay awake?" },
        { quiz: { question: "Longest?", choices: ["11 days", "2 days"], correct: 1, reveal: "264 hours!" } },
        { quiz: { question: "Again?", choices: ["Yes", "No"], correct: 2, reveal: { text: "No", style: "label", color: "#000000", keep: true } } },
        { hide: ["pic"] },
      ],
    };
    expect(validateSpec(spec).errors ?? []).toEqual([]);
    const out = expandRevealStamps(spec);
    const [a, b] = out.elements!.slice(1) as unknown as { id: string; type: string; text: string; style: { color: string } }[];
    expect(a).toMatchObject({ type: "node", text: "264 hours!", style: { color: STAMP_BLUE } });
    expect(b).toMatchObject({ type: "text", text: "No", style: { color: "#000000" } });
    // keep: the hide takes the first stamp, not the kept one.
    expect(out.commands!.at(-1)!.hide).toEqual(["pic", a.id]);
  });

  it("a clear that keeps the figure keeps its stamp", () => {
    const spec: Spec = {
      elements: [{ id: "pic", type: "icon", of: "moon", x: 400, y: 450, size: 300 } as never, { id: "other", type: "text", text: "x", x: 100, y: 600 } as never],
      commands: [{ draw: ["pic", "other"] }, { quiz: { question: "?", choices: ["True", "Myth"], correct: 2, reveal: true } }, { clear: { keep: ["pic"] } }],
    };
    const out = expandRevealStamps(spec);
    expect(out.commands!.at(-1)!.clear).toEqual({ keep: ["pic", "reveal_1_stamp"] });
  });

  it("an ask's boolean reveal keeps its old meaning; words make a stamp", () => {
    const base: Spec = { elements: [{ id: "t", type: "text", text: "Gold?", x: 400, y: 400 } as never], commands: [{ draw: ["t"] }] };
    const plain = { ...base, commands: [...base.commands!, { ask: { question: "Symbol?", answer: "Au", reveal: false } }] };
    expect(expandRevealStamps(plain)).toBe(plain);
    const stamped = expandRevealStamps({ ...base, commands: [...base.commands!, { ask: { question: "Symbol?", answer: "Au", reveal: "Au" } }] });
    expect(stamped.commands!.at(-1)!.ask).toMatchObject({ reveal_stamp: "reveal_1_stamp" });
    expect(stamped.commands!.at(-1)!.ask!.reveal).toBeUndefined();
  });

  it("the schema says what is wrong", () => {
    const spec = (q: Record<string, unknown>): Spec => ({
      elements: [{ id: "pic", type: "icon", of: "moon", x: 400, y: 450, size: 300 } as never],
      commands: [{ draw: ["pic"] }, { quiz: { question: "?", choices: ["True", "Myth"], correct: 2, ...q } as never }],
    });
    expect(validateSpec(spec({ reveal_at: "pic" })).errors.join()).toMatch(/reveal_at needs a reveal stamp/);
    expect(validateSpec(spec({ reveal: "this verdict is far too long for a stamp" })).errors.join()).toMatch(/a word or three/);
    expect(validateSpec(spec({ reveal: true, reveal_at: "nope" })).errors.join()).toMatch(/not an element id/);
    expect(validateSpec(spec({ reveal: { text: "MYTH", tilt: 3 } })).ok).toBe(false);
    expect(validateSpec(spec({ reveal: true, reveal_at: { x: 800, y: 500 } })).errors).toEqual([]);
  });

  it("colours: red for a no, blue for the rest", () => {
    expect(stampColor("MYTH")).toBe(STAMP_RED);
    expect(stampColor("False")).toBe(STAMP_RED);
    expect(stampColor("No!")).toBe(STAMP_RED);
    expect(stampColor("TRUE")).toBe(STAMP_BLUE);
    expect(stampColor("< 2,000 years")).toBe(STAMP_BLUE);
    expect(stampColor("Nothing")).toBe(STAMP_BLUE);
  });
});

const overlap = (a: BBox, b: BBox, gap = 0): boolean => a.x < b.x + b.w + gap && b.x < a.x + a.w + gap && a.y < b.y + b.h + gap && b.y < a.y + a.h + gap;

describe("where the stamp goes", () => {
  it("beside the figure, right of it, level with its upper part", () => {
    const fig = { x: 300, y: 300, w: 300, h: 300 };
    const c = placeStamp([fig], fig, { w: 140, h: 80 });
    expect(c.x - 70).toBeGreaterThanOrEqual(fig.x + fig.w);
    expect(c.y).toBeGreaterThan(fig.y + fig.h / 2);
  });

  it("round other ink: an obstacle on the right sends it elsewhere, still clear", () => {
    const fig = { x: 300, y: 300, w: 300, h: 300 };
    const block = { x: 600, y: 160, w: 340, h: 495 };
    const c = placeStamp([fig, block], fig, { w: 140, h: 80 });
    const box = { x: c.x - 70, y: c.y - 40, w: 140, h: 80 };
    expect(overlap(box, fig)).toBe(false);
    expect(overlap(box, block)).toBe(false);
  });

  it("as laid out: every stamp clear of the figure, the buttons and the caption band, turned, landing as a stamp", () => {
    const spec = expandSpec(tom());
    const res = layoutSpec(spec);
    const boxes = elementBBoxes(res);
    const cmds = spec.commands ?? [];
    let n = 0;
    cmds.forEach((c, i) => {
      const id = c.ask?.reveal_stamp;
      if (!id) return;
      n++;
      const b = boxes.get(id)!;
      expect(b).toBeDefined();
      expect(b.y).toBeGreaterThanOrEqual(CAPTION_TOP + 10 - 6);
      expect(b.y + b.h).toBeLessThanOrEqual(CONTENT_TOP + 6);
      for (const other of [...visibleBefore(cmds, i), ...(c.ask!.choose as string[])]) {
        const ob = boxes.get(other);
        if (ob && other !== id) expect(overlap(b, ob), `${id} on ${other}`).toBe(false);
      }
      const text = res.drawables.find((d) => d.id === `${id}_text`);
      const frame = res.drawables.find((d) => d.id === id);
      expect(text?.kind === "text" && text.tilt).toBe(STAMP_TILT);
      expect(text?.kind === "text" && text.weight).toBe("bold");
      expect(text?.drawOpts.mode).toBe("stamp");
      expect(frame?.kind === "stroke" && frame.shapeHint).toBeFalsy();
      expect(frame?.drawOpts.mode).toBe("stamp");
    });
    expect(n).toBe(5);
  });
});

describe("the plan", () => {
  it("the stamp is there once the question ends, and gone with its figure", () => {
    const spec = expandSpec(tom());
    const ids = (spec.elements ?? []).map((e) => e.id);
    const plan = planCommands(spec.commands ?? [], ids, { bboxOf: () => ({ x: 0, y: 0, w: 10, h: 10 }) });
    const k = plan.steps.findIndex((s) => s.kind === "ask");
    const ask = plan.steps[k];
    expect(ask.kind === "ask" && ask.stamp).toBe("reveal_1_stamp");
    expect(plan.states[k - 1].visible).not.toContain("reveal_1_stamp");
    expect(plan.states[k].visible).toContain("reveal_1_stamp");
    const gone = plan.steps.findIndex((s, j) => j > k && s.kind === "hide" && s.ids.includes("gw"));
    expect(plan.states[gone].visible).not.toContain("reveal_1_stamp");
  });
});

// ---- the moment it lands ----------------------------------------------------

globalThis.requestAnimationFrame ??= ((cb: FrameRequestCallback) =>
  setTimeout(() => cb(performance.now()), 5) as unknown as number) as typeof requestAnimationFrame;

/** One log for the voice and the stamps, in the order things happen. */
class LoggingSpeech extends SpeechManager {
  constructor(private readonly log: string[]) {
    super();
  }
  override get available(): boolean {
    return false;
  }
  override speak(text: string): Promise<void> {
    this.log.push(`say: ${text}`);
    return Promise.resolve();
  }
  override cancel(): void {}
}

function fakeElement(id: string, log: string[]): RenderedElement {
  return {
    id,
    durationMs: 200,
    setProgress: (t: number) => {
      if (t === 0 && id.endsWith("_stamp")) log.push(`land: ${id}`);
    },
    finish: () => {},
    hide: () => {},
  };
}

const PIC: Spec = {
  elements: [{ id: "pic", type: "icon", of: "fish", x: 400, y: 450, size: 300 } as never],
  commands: [
    { draw: ["pic"], speak: "A goldfish forgets in three seconds: true or myth?" },
    { quiz: { question: "Goldfish memory: true or myth?", choices: ["True", "Myth"], correct: 2, right: "Myth: months.", wrong: "Not so.", on_canvas: true, reveal: true } },
    { speak: "Next." },
  ],
};

function playerOf(spec: Spec, log: string[]) {
  const ex = linkStampsToButtons(expandAnswerButtons(expandRevealStamps(spec)));
  const ids = (ex.elements ?? []).map((e) => e.id);
  const labels = new Map((ex.elements ?? []).map((e) => [e.id, (e as { text?: string }).text ?? null]));
  const plan = planCommands(ex.commands ?? [], ids, { labelOf: (id) => labels.get(id) ?? null, bboxOf: () => ({ x: 0, y: 0, w: 10, h: 10 }) });
  const els = new Map(ids.map((id) => [id, fakeElement(id, log)]));
  return new Player(plan, els, new LoggingSpeech(log), null, { mode: "narrated", breath: false });
}

/** The log from the first stamp or reveal-ish line on. */
const after = (log: string[], first: string): string[] => log.slice(log.findIndex((l) => l === first));

describe("the stamp lands WITH the reveal line", () => {
  it("a right tap: the stamp, then the line — not after it", async () => {
    const log: string[] = [];
    const player = playerOf(PIC, log);
    player.askGate = async () => "quiz_1_btn_2";
    await player.play();
    const i = log.indexOf("land: reveal_1_stamp");
    expect(i).toBeGreaterThan(-1);
    expect(log[i + 1]).toMatch(/Myth: months\.$/);
    expect(log.filter((l) => l.startsWith("land:"))).toHaveLength(1);
  });

  it("a wrong tap: the hint, then the stamp with the reveal", async () => {
    const log: string[] = [];
    const player = playerOf(PIC, log);
    player.askGate = async () => "quiz_1_btn_1";
    await player.play();
    expect(after(log, "say: Not so.").slice(0, 3)).toEqual(["say: Not so.", "land: reveal_1_stamp", "say: Myth: months."]);
  });

  it("a movie: the stamp with the reveal line", async () => {
    const log: string[] = [];
    const player = playerOf(PIC, log);
    await player.play();
    expect(after(log, "land: reveal_1_stamp").slice(0, 2)).toEqual(["land: reveal_1_stamp", "say: Myth: months."]);
  });

  it("the question card (no buttons): wrong hint, then the stamp with the reveal; a movie the same", async () => {
    const spec = structuredClone(PIC);
    delete spec.commands![1].quiz!.on_canvas;
    const log: string[] = [];
    const player = playerOf(spec, log);
    player.quizGate = async () => 0;
    await player.play();
    expect(after(log, "say: Not so.").slice(0, 3)).toEqual(["say: Not so.", "land: reveal_1_stamp", "say: Myth: months."]);
    const movie: string[] = [];
    await playerOf(spec, movie).play();
    expect(after(movie, "land: reveal_1_stamp").slice(0, 2)).toEqual(["land: reveal_1_stamp", "say: Myth: months."]);
  });

  it("a typed ask: the stamp with the reveal", async () => {
    const spec: Spec = {
      elements: [{ id: "t", type: "text", text: "Gold", x: 400, y: 400 } as never],
      commands: [{ draw: ["t"], speak: "Gold." }, { ask: { question: "Its symbol?", answer: "Au", right: "Au, from aurum.", reveal: "Au" } }],
    };
    const log: string[] = [];
    await playerOf(spec, log).play();
    expect(after(log, "land: reveal_1_stamp").slice(0, 2)).toEqual(["land: reveal_1_stamp", "say: Au, from aurum."]);
  });
});
