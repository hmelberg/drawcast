// Formula asks in the player (design 2026-10-03 §5.3–5.4, §6): tiles through
// the cards gate in fill mode, typed numbers and expressions through the
// formula gate; the reveal writes the truths into the boxes (an element
// patch, `fills`), wrong answers keep a struck-through mark, and a seek back
// before the ask empties the boxes again.
import { RIGHT, TRUTH, WRONG } from "../src/guess/reveal";
import { describe, expect, test } from "vitest";
import { Player, type FormulaSession, type GuessRuntime, type Reprojector } from "../src/render/player";
import type { BackendEffects } from "../src/render/backend";
import { planCommands } from "../src/render/plan";
import { SpeechManager } from "../src/render/speech";
import { formulaBlanks } from "../src/formula/blanks";
import { equivalent, exprToAscii, parseAscii, texToExpr } from "../src/formula/expr";
import { cardsGeometry, type CardsElementLike } from "../src/spec/cards";
import type { GuessMarks } from "../src/guess/marks";
import type { Command, SpecElement } from "../src/spec/types";
import type { LayoutResult } from "../src/layout/layout";

globalThis.requestAnimationFrame ??= ((cb: FrameRequestCallback) =>
  setTimeout(() => cb(performance.now()), 5) as unknown as number) as typeof requestAnimationFrame;

class QuietSpeech extends SpeechManager {
  said: string[] = [];
  override get available(): boolean { return false; }
  override speak(text: string): Promise<void> {
    this.said.push(text);
    return Promise.resolve();
  }
  override cancel(): void {}
}

const TEX = "A = \\pi \\blank{r^2}";
const BOX = { x: 480, y: 380, w: 40, h: 30 };
const tilesEl: CardsElementLike = { id: "area_tiles", type: "cards", fill: "area", items: [{ text: "2r" }, { text: "r^2", blank: 1 }, { text: "d" }], x: 100, y: 300, width: 800 };
const geometry = cardsGeometry(tilesEl, undefined, (id) => (id === "area" ? [BOX] : null));

/** What a preview frame paints (the stub's layout): its boxes sit where the viewer's typing put them. */
const PREVIEW = { preview: true } as unknown as LayoutResult;

function makePlayer(commands: Command[], opts: { tiles?: boolean; tex?: string; previewShift?: number } = {}) {
  const tex = opts.tex ?? TEX;
  const blanks = formulaBlanks("area", tex);
  const ids = ["area", ...blanks.map((b) => b.part), ...(opts.tiles ? geometry.cards : [])];
  const plan = planCommands(commands, ids, {
    formulaFor: (id) => (id === "area" ? { blanks: blanks.length } : null),
    cardsFor: (id) => {
      if (id !== "area" || !opts.tiles) return null;
      const offsets: Record<string, [number, number]> = {};
      geometry.cards.forEach((c, i) => (offsets[c] = [geometry.truth[i][0] - geometry.home[i][0], geometry.truth[i][1] - geometry.home[i][1]]));
      return { cards: geometry.cards, offsets, hides: geometry.cards.filter((_, i) => geometry.truthBin[i] >= 0) };
    },
  });
  const speech = new QuietSpeech();
  const marks = new Map<string, GuessMarks | null>();
  const effects = new Proxy({ setGuessMarks: (owner: string, m: GuessMarks | null) => marks.set(owner, m) } as Record<string, unknown>, {
    get: (t, k: string) => t[k] ?? (() => {}),
  }) as unknown as BackendEffects;
  const player = new Player(plan, new Map(), speech, null, { mode: "narrated", effects });
  const frames: { elements?: SpecElement[] }[] = [];
  const patches: { id: string; fields: Record<string, unknown> | null }[] = [];
  const rp: Reprojector = {
    frame: (_p, _scene, o) => {
      frames.push({ elements: o?.elements });
      return opts.previewShift ? PREVIEW : undefined;
    },
    commit: () => new Map(),
    committed: () => null,
    setElementPatch: (id, fields) => patches.push({ id, fields }),
  };
  player.reprojector = rp;
  const runtime: GuessRuntime = {
    setup: () => ({ handles: [], pin: {}, warnings: [] }),
    patch: () => ({ params: {} }),
    cards: (id) => (id === "area" && opts.tiles ? geometry : null),
    formula: (id) =>
      id === "area"
        ? {
            blanks,
            patch: (fills) => [{ id: "area", type: "math", tex, fills } as SpecElement],
            boxes: (l) => blanks.map((_, k) => ({ ...BOX, x: BOX.x + 100 * k + (l === PREVIEW ? opts.previewShift ?? 0 : 0) })),
          }
        : null,
  };
  player.guess = runtime;
  const fillsOf = (): ((string | null)[] | undefined)[] => frames.map((f) => (f.elements?.find((e) => e.id === "area") as { fills?: (string | null)[] } | undefined)?.fills);
  const lastPatch = (): Record<string, unknown> | null | undefined => [...patches].reverse().find((p) => p.id === "area")?.fields;
  return { player, plan, marks, frames, patches, fillsOf, lastPatch, speech };
}

const ask = (extra: Record<string, unknown> = {}): Command => ({ ask: { question: "What goes in the box?", on: "area", store: "f", right: "Yes", wrong: "It is {f.true}", ...extra } });

describe("formula asks in the player", () => {
  test("movie, tiles: the right tile goes in, the truth is written in, the box is gone after", async () => {
    const { player, plan, lastPatch } = makePlayer([{ draw: ["area", "area_blank_1"] }, ask({ others: ["2r", "d"] })], { tiles: true });
    const step = plan.steps[1] as { formula?: string; cards?: string };
    expect(step.formula).toBe("area");
    expect(step.cards).toBe("area");
    expect(plan.states[0].visible).toContain("area_blank_1");
    expect(plan.states[1].visible).not.toContain("area_blank_1");
    expect(plan.states[1].visible).toContain("area");
    // The right tile is replaced by the truth's glyphs; the wrong ones stay in the row.
    expect(plan.states[1].visible).not.toContain("area_tiles_2");
    expect(plan.states[1].visible).toContain("area_tiles_1");
    (player as unknown as { autoAnswers: boolean }).autoAnswers = true;
    await player.play();
    expect(lastPatch()).toEqual({ fills: ["r^2"] });
    expect(player.vars.get("f.ok")).toBe("true");
  });

  test("live tiles: a wrong tile is struck through above its box; the formula's marks outlive the next ask", async () => {
    const { player, marks, lastPatch } = makePlayer([{ draw: ["area", "area_blank_1"] }, ask({ others: ["2r", "d"] }), { ask: { question: "Next?" } }], { tiles: true });
    const answers: (string | null)[] = ["0", null];
    player.askGate = async (_s, step) => {
      const s = step as { cardsSession?: unknown };
      // The tile "2r" (card 0) in the only box.
      return s.cardsSession ? answers.shift()! : null;
    };
    await player.play();
    expect(player.vars.get("f.ok")).toBe("false");
    expect(lastPatch()).toEqual({ fills: ["r^2"] });
    // Beside (the default): the tile stays in the box; ✗ by it, the true tile's text in ink
    // over it, and a thin red arrow sending the wrong tile back to the row.
    const m = marks.get("formula_1");
    expect(m?.texts.some((t) => t.text === "✗" && t.color === WRONG)).toBe(true);
    expect(m?.texts.some((t) => t.text === "r^2" && t.color === TRUTH)).toBe(true);
    expect(m?.lines.some((l) => l.color === WRONG)).toBe(true);
    expect(m?.texts.map((t) => t.text)).not.toContain("2r");
  });

  test("live tiles, morph: a wrong tile is struck through above its box", async () => {
    const { player, marks } = makePlayer([{ draw: ["area", "area_blank_1"] }, ask({ others: ["2r", "d"], reveal_style: "morph" })], { tiles: true });
    player.askGate = async (_s, step) => ((step as { cardsSession?: unknown }).cardsSession ? "0" : null);
    await player.play();
    const m = marks.get("formula_1");
    expect(m?.texts.map((t) => t.text)).toContain("2r");
    expect(m?.lines.length).toBeGreaterThan(0);
  });

  test("feedback: a right typed formula is perfect, said after the author's line; a skip adds nothing", async () => {
    const fb = { style: "warm" as const, perfect: "Spot on.", none: "Not this time." };
    const right = makePlayer([{ draw: ["area", "area_blank_1"] }, ask({ feedback: fb })]);
    right.player.askGate = async () => JSON.stringify(["r*r"]);
    await right.player.play();
    expect(right.speech.said.slice(-2)).toEqual(["Yes", "Spot on."]);
    const skip = makePlayer([{ draw: ["area", "area_blank_1"] }, ask({ feedback: fb })]);
    skip.player.askGate = async () => null;
    await skip.player.play();
    expect(skip.speech.said).not.toContain("Not this time.");
  });

  test("feedback on tiles (the cards path): a wrong tile is none", async () => {
    const fb = { style: "dry" as const, none: "Bold." };
    const { player, speech } = makePlayer([{ draw: ["area", "area_blank_1"] }, ask({ others: ["2r", "d"], feedback: fb })], { tiles: true });
    player.askGate = async (_s, step) => ((step as { cardsSession?: unknown }).cardsSession ? "0" : null);
    await player.play();
    expect(speech.said[speech.said.length - 1]).toBe("Bold.");
  });

  test("typed r*r is right: scored by value, stored", async () => {
    const { player, fillsOf, lastPatch } = makePlayer([{ draw: ["area", "area_blank_1"] }, ask()]);
    let session: FormulaSession | null = null;
    player.askGate = async (_s, step) => {
      session = (step as { formulaSession?: FormulaSession }).formulaSession ?? null;
      expect(session!.show(["r*"])).toEqual([false]);
      expect(session!.show(["r*r"])).toEqual([true]);
      return JSON.stringify(["r*r"]);
    };
    await player.play();
    expect(session!.blanks).toHaveLength(1);
    expect(session!.boxOf(0)).toEqual(BOX);
    expect(player.vars.get("f.ok")).toBe("true");
    expect(player.vars.get("f")).toBe("r*r");
    expect(player.vars.get("f.true")).toBe("r^2");
    expect(player.vars.get("f.1")).toBe("r*r");
    expect(player.vars.get("f.1.true")).toBe("r^2");
    expect(player.vars.get("f.within")).toBe("1");
    expect(player.vars.get("f.count")).toBe("1");
    // The preview: the typed answer drawn in the box, in the guess colour (not
    // equal to the truth as written, so the layout never gives it away).
    const shown = fillsOf().filter((f) => f !== undefined);
    expect(shown.some((f) => f![0] !== null && f![0] !== "r^2" && /r/.test(f![0]!))).toBe(true);
    expect(lastPatch()).toEqual({ fills: ["r^2"] });
  });

  test("typed 2r is wrong: a struck-through 2r above the box, under the formula's owner", async () => {
    const { player, marks, speech } = makePlayer([{ draw: ["area", "area_blank_1"] }, ask()]);
    player.askGate = async () => JSON.stringify(["2r"]);
    await player.play();
    expect(player.vars.get("f.ok")).toBe("false");
    expect(speech.said.some((t) => t.includes("It is r^2"))).toBe(true);
    const m = marks.get("formula_1");
    expect(m?.texts.map((t) => t.text)).toContain("2r");
    const t = m!.texts.find((x) => x.text === "2r")!;
    expect(t.at[1]).toBeGreaterThan(BOX.y + BOX.h);
    expect(m!.lines.some((l) => l.pts.length === 2 && Math.abs(l.pts[0][1] - l.pts[1][1]) < 1e-9)).toBe(true);
    // Beside (the default): a red ✗ by the box; morph: none.
    expect(m!.texts.some((x) => x.text === "✗" && x.color === WRONG)).toBe(true);
    const morph = makePlayer([{ draw: ["area", "area_blank_1"] }, ask({ reveal_style: "morph" })]);
    morph.player.askGate = async () => JSON.stringify(["2r"]);
    await morph.player.play();
    expect(morph.marks.get("formula_1")!.texts.some((x) => x.text === "✗" || x.text === "✓")).toBe(false);
  });

  test("beside: a right typed answer gets a green ✓ by its box (tiles too)", async () => {
    const typed = makePlayer([{ draw: ["area", "area_blank_1"] }, ask()]);
    typed.player.askGate = async () => JSON.stringify(["r^2"]);
    await typed.player.play();
    expect(typed.marks.get("formula_1")!.texts.map((x) => [x.text, x.color])).toEqual([["✓", RIGHT]]);
  });

  test("the struck-through answer sits over the box as the truth is drawn, not the preview's", async () => {
    const { player, marks } = makePlayer([{ draw: ["area", "area_blank_1"] }, ask()], { previewShift: 60 });
    player.askGate = async () => JSON.stringify(["2r"]);
    await player.play();
    const t = marks.get("formula_1")!.texts.find((x) => x.text === "2r")!;
    expect(t.at[0]).toBeCloseTo(BOX.x + BOX.w / 2);
  });

  test("a negative typed number keeps its sign a sign (an empty group, then the fill grouped)", async () => {
    const { player, fillsOf } = makePlayer([{ draw: ["area"] }, ask()], { tex: "x = \\blank{-3}" });
    player.askGate = async (_s, step) => {
      (step as { formulaSession?: FormulaSession }).formulaSession!.show(["-3"]);
      return JSON.stringify(["-3"]);
    };
    await player.play();
    expect(fillsOf().some((f) => f?.[0] === "{}{-3}")).toBe(true);
    expect(player.vars.get("f.ok")).toBe("true");
  });

  test("form exact: r*r is not the form asked for", async () => {
    const { player } = makePlayer([{ draw: ["area", "area_blank_1"] }, ask({ form: "exact" })]);
    player.askGate = async () => JSON.stringify(["r*r"]);
    await player.play();
    expect(player.vars.get("f.ok")).toBe("false");
  });

  test("a skip scores wrong and still writes the truth in", async () => {
    const { player, lastPatch } = makePlayer([{ draw: ["area", "area_blank_1"] }, ask()]);
    player.askGate = async () => null;
    await player.play();
    expect(player.vars.get("f.ok")).toBe("false");
    expect(lastPatch()).toEqual({ fills: ["r^2"] });
  });

  test("several blanks: n of m, per-blank vars, numbers within tolerance", async () => {
    const tex = "\\blank{2} \\pi \\blank{r}";
    const { player } = makePlayer([{ draw: ["area"] }, ask()], { tex });
    player.askGate = async () => JSON.stringify(["2,01", "d"]);
    await player.play();
    expect(player.vars.get("f")).toBe("1 of 2");
    expect(player.vars.get("f.1")).toBe("2,01");
    expect(player.vars.get("f.2.true")).toBe("r");
    expect(player.vars.get("f.within")).toBe("1");
    expect(player.vars.get("f.count")).toBe("2");
  });

  test("movie, typed: the truth is typed in, a character at a time", async () => {
    const { player, fillsOf, lastPatch } = makePlayer([{ draw: ["area", "area_blank_1"] }, ask()]);
    (player as unknown as { autoAnswers: boolean }).autoAnswers = true;
    await player.play();
    const shown = fillsOf().filter((f) => f !== undefined && f[0] !== null);
    expect(shown.length).toBeGreaterThanOrEqual(2);
    expect(player.vars.get("f.ok")).toBe("true");
    expect(lastPatch()).toEqual({ fills: ["r^2"] });
  });

  test("a seek back before the ask empties the boxes; forward past it writes the truth", async () => {
    const { player, lastPatch, marks } = makePlayer([{ draw: ["area", "area_blank_1"] }, ask(), { speak: "Next." }]);
    player.askGate = async () => JSON.stringify(["2r"]);
    await player.play();
    expect(lastPatch()).toEqual({ fills: ["r^2"] });
    player.renderUpTo(1);
    expect(lastPatch()).toBeNull();
    expect(marks.get("formula_1") ?? null).toBeNull();
    player.renderUpTo(3);
    expect(lastPatch()).toEqual({ fills: ["r^2"] });
  });
});

describe("exprToAscii", () => {
  test.each(["r^2", "\\pi r^2", "\\frac{v^2}{2a}", "\\sqrt{x}", "2(a+b)", "-x^2", "\\frac{a+b}{2}", "e^{-x}"])("%s reads back the same", (tex) => {
    const e = texToExpr(tex)!;
    const back = parseAscii(exprToAscii(e));
    expect("error" in back).toBe(false);
    expect(equivalent(back as never, e)).toBe(true);
  });
});
