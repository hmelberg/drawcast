// Rewards after an answer (spec 2026-10-03-looks-feedback-account §4.3):
// sparkle, confetti, a reaction picture or a joke — live only, never on a
// skip or in a movie; a still badge under reduced motion; {streak}.
import { describe, expect, test } from "vitest";
import { Player, type Reprojector } from "../src/render/player";
import type { BackendEffects } from "../src/render/backend";
import { planCommands } from "../src/render/plan";
import { SpeechManager } from "../src/render/speech";
import { feedbackLines, resolveFeedback, type Band } from "../src/feedback/bands";
import { isLong, pickJoke, pictureFor, rewardCredits, rewardFor, TWEMOJI_CREDIT, type RewardEvent } from "../src/feedback/rewards";
import { JOKES } from "../src/feedback/jokes";
import { badgeText, confettiPieces, CONFETTI_MS, overlayFor, pictureSrc, picturePlace, pieceAt, PICTURE_PX } from "../src/ui/rewards";
import { REACTION_PICTURES } from "../src/feedback/rewards";
import { readFileSync } from "node:fs";
import { vi } from "vitest";
import type { Command } from "../src/spec/types";
import { cardsGeometry, type CardsElementLike } from "../src/spec/cards";
import { cardsTruth, encodeArrangement, positions } from "../src/cards/model";

globalThis.requestAnimationFrame ??= ((cb: FrameRequestCallback) =>
  setTimeout(() => cb(performance.now()), 5) as unknown as number) as typeof requestAnimationFrame;

const fb = (reward: string) => resolveFeedback({ style: "warm", reward }, undefined);

describe("rewardFor", () => {
  const table: [string, Band, boolean, number, string | null][] = [
    // reward, band, long, streak → reward
    ["auto", "perfect", false, 1, "sparkle"],
    ["auto", "perfect", false, 2, "sparkle"],
    ["auto", "perfect", false, 3, "confetti"],
    ["auto", "perfect", false, 4, "sparkle"],
    ["auto", "perfect", false, 5, "sparkle"],
    ["auto", "perfect", false, 6, "confetti"],
    ["auto", "perfect", false, 9, "confetti"],
    ["auto", "perfect", true, 1, "confetti"],
    ["auto", "good", true, 0, null],
    ["auto", "poor", false, 0, null],
    ["auto", "none", false, 0, null],
    ["none", "perfect", true, 5, null],
    ["confetti", "perfect", false, 1, "confetti"],
    ["confetti", "good", true, 0, null],
    ["picture", "perfect", false, 1, "picture"],
    ["picture", "none", false, 0, "picture"],
    ["picture", "good", true, 0, null],
    ["joke", "perfect", true, 1, "joke"],
    ["joke", "perfect", false, 1, "sparkle"],
    ["joke", "none", true, 0, null],
  ];
  test.each(table)("%s, %s, long %s, streak %s → %s", (reward, band, long, streak, want) => {
    expect(rewardFor(fb(reward), band, long, streak)).toBe(want);
  });

  test("a style with no reward named is auto; plain is none", () => {
    expect(resolveFeedback("warm", undefined).reward).toBe("auto");
    expect(rewardFor(resolveFeedback("plain", undefined), "perfect", true, 9)).toBeNull();
  });

  test("a joke or a picture never plays under plain (plain = no extras; the lint says so)", () => {
    for (const reward of ["joke", "picture"]) {
      const plain = resolveFeedback({ style: "plain", reward }, undefined);
      for (const band of ["perfect", "none"] as Band[]) expect(rewardFor(plain, band, true, 3)).toBeNull();
    }
  });

  test("long: four items, or several parts", () => {
    expect(isLong({ items: 3 })).toBe(false);
    expect(isLong({ items: 4 })).toBe(true);
    expect(isLong({ parts: 1 })).toBe(false);
    expect(isLong({ parts: 2 })).toBe(true);
  });
});

describe("jokes and pictures", () => {
  test("a joke is seeded and never repeats in a cast", () => {
    const used = new Set<string>();
    const a = pickJoke(7, used);
    const b = pickJoke(7, used);
    expect(JOKES).toContain(a);
    expect(b).not.toBe(a);
    expect(pickJoke(7, new Set())).toBe(a);
  });

  test("pictures: party/trophy for perfect, facepalm/monkey for none, nothing between", () => {
    expect(["🎉", "🏆"]).toContain(pictureFor("perfect", 0)?.char);
    expect(pictureFor("perfect", 0)?.name).not.toBe(pictureFor("perfect", 1)?.name);
    expect(["🤦", "🙈"]).toContain(pictureFor("none", 3)?.char);
    expect(pictureFor("good", 0)).toBeNull();
  });

  test("the twemoji credit is owed only by a cast that can show a picture", () => {
    expect(rewardCredits([{ kind: "ask", feedback: fb("picture") }])).toEqual([TWEMOJI_CREDIT]);
    expect(rewardCredits([{ kind: "ask", feedback: fb("auto") }, { kind: "draw" }])).toEqual([]);
  });
});

describe("the overlay", () => {
  test("reduced motion turns confetti into a still badge; sparkle and joke need none", () => {
    expect(overlayFor("confetti", false)).toBe("confetti");
    expect(overlayFor("confetti", true)).toBe("badge");
    expect(overlayFor("picture", true)).toBe("picture");
    expect(overlayFor("sparkle", false)).toBeNull();
    expect(overlayFor("joke", false)).toBeNull();
  });

  test("the badge names a streak", () => {
    expect(badgeText({ band: "perfect", streak: 4 })).toBe("★ 4 in a row");
    expect(badgeText({ band: "perfect", streak: 1 })).toBe("★ All right");
  });

  test("confetti: ~60 pieces burst up from the origin, fall, and fade out by the end", () => {
    const ps = confettiPieces(60, [100, 200], 3);
    expect(ps).toHaveLength(60);
    expect(confettiPieces(60, [100, 200], 3)).toEqual(ps);
    const up = ps.filter((p) => pieceAt(p, 200).y < 200).length;
    expect(up).toBeGreaterThan(40);
    expect(ps.every((p) => pieceAt(p, CONFETTI_MS).alpha === 0)).toBe(true);
    expect(pieceAt(ps[0], 0)).toMatchObject({ x: 100, y: 200, alpha: 1 });
  });
});

// ---- the player ----

class CapturingSpeech extends SpeechManager {
  said: string[] = [];
  override get available(): boolean { return false; }
  override speak(text: string): Promise<void> {
    this.said.push(text);
    return Promise.resolve();
  }
  override cancel(): void {}
}

const glows: { ids: string[]; color?: string }[] = [];
const effects = new Proxy({ setHighlight: (ids: string[], _k: string, _l: number, _x: unknown, color?: string) => glows.push({ ids, color }) } as Record<string, unknown>, {
  get: (t, k: string) => t[k] ?? (() => {}),
}) as unknown as BackendEffects;

function makePlayer(commands: Command[], feedback?: unknown) {
  const plan = planCommands(commands, ["a", "b"], { ...(feedback !== undefined ? { feedback } : {}) });
  const speech = new CapturingSpeech();
  const player = new Player(plan, new Map(), speech, null, { mode: "narrated", effects });
  const rp: Reprojector = { frame: () => {}, commit: () => new Map(), committed: () => null };
  player.reprojector = rp;
  const rewards: RewardEvent[] = [];
  player.callbacks = { onReward: (e) => rewards.push(e) };
  return { player, speech, rewards };
}

const typed = (extra: Record<string, unknown> = {}): Command => ({ ask: { question: "2+2?", answer: "4", right: "Four, {streak} in a row.", wrong: "No.", ...extra } as never });

describe("rewards in the player", () => {
  test("a right typed answer sparkles; every third right in a row is confetti", async () => {
    const { player, rewards } = makePlayer([typed(), typed(), typed(), typed(), typed(), typed()], { style: "warm" });
    player.askGate = async () => "4";
    await player.play();
    expect(rewards.map((r) => r.kind)).toEqual(["sparkle", "sparkle", "confetti", "sparkle", "sparkle", "confetti"]);
    expect(rewards.map((r) => r.streak)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(rewards[0].band).toBe("perfect");
  }, 20000);

  test("{streak} counts right answers in a row, reset by a wrong or a skip", async () => {
    const { player, speech } = makePlayer([typed(), typed(), typed(), typed(), typed()]);
    const answers = ["4", "4", "5", null, "4"];
    player.askGate = async () => answers.shift() ?? null;
    await player.play();
    expect(speech.said.filter((s) => s.startsWith("Four,"))).toEqual(["Four, 1 in a row.", "Four, 2 in a row.", "Four, 0 in a row.", "Four, 0 in a row.", "Four, 1 in a row."]);
  });

  test("plain (the default) gives no reward", async () => {
    const { player, rewards } = makePlayer([typed()]);
    player.askGate = async () => "4";
    await player.play();
    expect(rewards).toEqual([]);
  });

  test("plain with a reward asked for still gives it", async () => {
    const { player, rewards } = makePlayer([typed()], { style: "plain", reward: "confetti" });
    player.askGate = async () => "4";
    await player.play();
    expect(rewards.map((r) => r.kind)).toEqual(["confetti"]);
  });

  test("a skip gives no reward", async () => {
    const { player, rewards } = makePlayer([typed()], "warm");
    player.askGate = async () => null;
    await player.play();
    expect(rewards).toEqual([]);
  });

  test("the movie gives no reward", async () => {
    const { player, rewards } = makePlayer([typed(), typed(), typed()], { style: "warm", reward: "confetti" });
    (player as unknown as { autoAnswers: boolean }).autoAnswers = true;
    player.askGate = async () => "4";
    await player.play();
    expect(rewards).toEqual([]);
  });

  test("a picture for none (a wrong answer), when asked for", async () => {
    const { player, rewards } = makePlayer([typed()], { style: "warm", reward: "picture" });
    player.askGate = async () => "5";
    await player.play();
    expect(rewards.map((r) => [r.kind, r.band])).toEqual([["picture", "none"]]);
  });

  test("a quiz: right picks sparkle", async () => {
    const quiz: Command = { quiz: { question: "Which?", choices: ["one", "two"], correct: 2, right: "Two.", feedback: "warm" } };
    const { player, rewards } = makePlayer([quiz]);
    player.quizGate = async () => 1;
    await player.play();
    expect(rewards.map((r) => r.kind)).toEqual(["sparkle"]);
  });

  test("a click answer: the sparkle is the green glow on the answered part", async () => {
    glows.length = 0;
    const { player, rewards } = makePlayer([{ ask: { question: "Which?", answer: "b", widget: "click", right: "Yes." } as never }], "warm");
    player.askGate = async () => "b";
    await player.play();
    expect(rewards.map((r) => r.kind)).toEqual(["sparkle"]);
    expect(glows.some((g) => g.ids.includes("b") && g.color === "#4a7c59")).toBe(true);
  });
});

describe("rewards on a long task", () => {
  const four: CardsElementLike = {
    id: "d",
    type: "cards",
    items: [
      { text: "Aspirin", match: "Thins blood" },
      { text: "Insulin", match: "Lowers sugar" },
      { text: "Penicillin", match: "Kills bacteria" },
      { text: "Morphine", match: "Eases pain" },
    ],
  };
  const g4 = cardsGeometry(four);
  function cardsPlayer(feedback: unknown) {
    const plan = planCommands([{ ask: { question: "Match them.", on: "d", right: "Each drug, its job.", feedback } as never }], [...g4.cards], {
      cardsFor: (id) => (id === "d" ? { cards: g4.cards, offsets: {}, hides: [] } : null),
    });
    const speech = new CapturingSpeech();
    const player = new Player(plan, new Map(), speech, null, { mode: "narrated", effects });
    player.reprojector = { frame: () => {}, commit: () => new Map(), committed: () => null };
    player.guess = { setup: () => ({ handles: [], pin: {}, warnings: [] }), patch: () => ({ params: {} }), cards: (id) => (id === "d" ? g4 : null) };
    player.partBox = (id) => (id === g4.cards[0] ? { x: 10, y: 20, w: 30, h: 40 } : null);
    const rewards: RewardEvent[] = [];
    player.callbacks = { onReward: (e) => rewards.push(e) };
    player.askGate = async () => encodeArrangement(g4, cardsTruth(g4));
    return { player, speech, rewards };
  }

  test("all four right: confetti from the cards' box", async () => {
    const { player, rewards } = cardsPlayer("warm");
    await player.play();
    expect(rewards.map((r) => r.kind)).toEqual(["confetti"]);
    expect(rewards[0].box).toEqual({ x: 10, y: 20, w: 30, h: 40 });
  });

  test("sorted cards: the confetti bursts from where the cards now sit (their bins), not their home row", async () => {
    const sortEl: CardsElementLike = {
      id: "s",
      type: "cards",
      bins: ["Fruit", "Not a fruit"],
      items: [
        { text: "Tomato", bin: "Fruit" },
        { text: "Potato", bin: "Not a fruit" },
        { text: "Apple", bin: "Fruit" },
      ],
    } as CardsElementLike;
    const gs = cardsGeometry(sortEl);
    const plan = planCommands([{ ask: { question: "Sort them.", on: "s", right: "Yes.", feedback: { style: "warm", reward: "confetti" } } as never }], [...gs.cards], {
      cardsFor: (id) => (id === "s" ? { cards: gs.cards, offsets: {}, hides: [] } : null),
    });
    const player = new Player(plan, new Map(), new CapturingSpeech(), null, { mode: "narrated", effects });
    player.reprojector = { frame: () => {}, commit: () => new Map(), committed: () => null };
    player.guess = { setup: () => ({ handles: [], pin: {}, warnings: [] }), patch: () => ({ params: {} }), cards: (id) => (id === "s" ? gs : null) };
    // Each card's layout box sits at its HOME place.
    player.partBox = (id) => {
      const i = gs.cards.indexOf(id);
      return i < 0 ? null : { x: gs.home[i][0] - gs.w / 2, y: gs.home[i][1] - gs.h / 2, w: gs.w, h: gs.h };
    };
    const rewards: RewardEvent[] = [];
    player.callbacks = { onReward: (e) => rewards.push(e) };
    const truth = cardsTruth(gs);
    player.askGate = async () => encodeArrangement(gs, truth);
    await player.play();
    expect(rewards.map((r) => r.kind)).toEqual(["confetti"]);
    const at = positions(gs, truth);
    const x0 = Math.min(...at.map((p) => p[0])) - gs.w / 2, y0 = Math.min(...at.map((p) => p[1])) - gs.h / 2;
    const box = rewards[0].box!;
    expect(box.x).toBeCloseTo(x0);
    expect(box.y).toBeCloseTo(y0);
    expect(box.w).toBeCloseTo(Math.max(...at.map((p) => p[0])) + gs.w / 2 - x0);
    expect(box.h).toBeCloseTo(Math.max(...at.map((p) => p[1])) + gs.h / 2 - y0);
  });

  test("a joke, when asked for, is said after the band line", async () => {
    const { player, speech, rewards } = cardsPlayer({ style: "warm", reward: "joke", perfect: "All four." });
    await player.play();
    expect(rewards.map((r) => r.kind)).toEqual(["joke"]);
    const i = speech.said.indexOf("All four.");
    expect(i).toBeGreaterThanOrEqual(0);
    expect(JOKES).toContain(speech.said[i + 1]);
  });

  test("no joke in a cast in another language; the subtitle track collects them for an English one", async () => {
    const { player, speech, rewards } = cardsPlayer({ style: "warm", reward: "joke", perfect: "Alle fire." });
    player.setSourceLang("nb");
    await player.play();
    expect(rewards.map((r) => r.kind)).toEqual(["joke"]);
    expect(speech.said.some((s) => JOKES.includes(s))).toBe(false);
    // The jokes are collected only where they can play: a style, in English (plain = no extras).
    expect(feedbackLines(resolveFeedback({ style: "warm", reward: "joke", perfect: "Yes." }, undefined), "en")).toEqual(expect.arrayContaining([...JOKES]));
    expect(feedbackLines(resolveFeedback({ style: "warm", reward: "joke", perfect: "Ja." }, undefined), "nb")).toEqual(["Ja."]);
    expect(feedbackLines(resolveFeedback({ style: "plain", reward: "joke" }, undefined), "en")).toEqual([]);
  });
});

describe("streak across rewinds and re-answers", () => {
  test("a replay from the start counts the streak afresh", async () => {
    const { player, speech } = makePlayer([typed(), typed()]);
    player.askGate = async () => "4";
    await player.play();
    player.renderUpTo(0);
    speech.said.length = 0;
    await player.play();
    expect(speech.said.filter((s) => s.startsWith("Four,"))).toEqual(["Four, 1 in a row.", "Four, 2 in a row."]);
  });

  test("a backward jump resets the streak; answering the same question again never extends it", async () => {
    const { player, speech } = makePlayer([typed(), typed()]);
    player.askGate = async () => "4";
    await player.play();
    player.jumpTo(1, false); // back over the second question
    speech.said.length = 0;
    await player.play();
    // The second question again: already answered in this pass, so the streak stays 0.
    expect(speech.said.filter((s) => s.startsWith("Four,"))).toEqual(["Four, 0 in a row."]);
  });
});

describe("the reaction picture is bundled", () => {
  test("every picture is an inline data: URL; nothing is fetched", () => {
    const spy = vi.fn();
    const was = globalThis.fetch;
    globalThis.fetch = spy as unknown as typeof fetch;
    try {
      for (const p of [...REACTION_PICTURES.perfect, ...REACTION_PICTURES.none]) {
        const src = pictureSrc(p.name);
        expect(src?.startsWith("data:image/svg+xml")).toBe(true);
        expect(decodeURIComponent(src!.split(",")[1])).toContain("<svg");
      }
    } finally {
      globalThis.fetch = was;
    }
    expect(spy).not.toHaveBeenCalled();
    // …and the overlay names no remote picture address.
    const src = readFileSync(new URL("../src/ui/rewards.ts", import.meta.url), "utf8");
    expect(src).not.toMatch(/iconify|https?:\/\//);
  });

  test("the picture stays on the stage, clear of the caption and answer dock at the bottom", () => {
    const sw = 800, sh = 450;
    const low = picturePlace(100, 440, sw, sh);
    expect(low.top + PICTURE_PX / 2).toBeLessThanOrEqual(sh - 96);
    const high = picturePlace(100, 0, sw, sh);
    expect(high.top - PICTURE_PX / 2).toBeGreaterThanOrEqual(0);
    expect(picturePlace(790, 200, sw, sh).left + PICTURE_PX).toBeLessThanOrEqual(sw);
    expect(picturePlace(100, 200, sw, sh)).toEqual({ left: 116, top: 200 });
  });
});
