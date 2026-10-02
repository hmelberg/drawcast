// Cards revealed beside the answer (spec 2026-10-03-round6 §3): the cards
// stay where the viewer put them, ✓/✗ on each, the truth in ink beside —
// and reveal_style: morph keeps the glide to the truth.
import { describe, expect, test } from "vitest";
import { Player, type GuessRuntime, type Reprojector } from "../src/render/player";
import type { BackendEffects } from "../src/render/backend";
import { planCommands } from "../src/render/plan";
import { SpeechManager } from "../src/render/speech";
import { cardsGeometry, type CardsElementLike, type CardsGeometry } from "../src/spec/cards";
import { cardsTruth, encodeArrangement, type Arrangement } from "../src/cards/model";
import { besidePositions, cardsBeside, cardsParts } from "../src/cards/beside";
import type { GuessMarks } from "../src/guess/marks";
import { EACH_MS, RIGHT, TRUTH, WRONG } from "../src/guess/reveal";
import type { Command } from "../src/spec/types";
import type { Pt } from "../src/layout/model";

globalThis.requestAnimationFrame ??= ((cb: FrameRequestCallback) =>
  setTimeout(() => cb(performance.now()), 2) as unknown as number) as typeof requestAnimationFrame;

class QuietSpeech extends SpeechManager {
  override get available(): boolean { return false; }
  override speak(): Promise<void> { return Promise.resolve(); }
  override cancel(): void {}
}

const rank = cardsGeometry({ id: "c", type: "cards", rank: true, items: ["Ant", "Bee", "Cat", "Dog"] } as unknown as CardsElementLike);
const sort = cardsGeometry({ id: "s", type: "cards", bins: ["Odd", "Even"], items: [{ text: "1", bin: "Odd" }, { text: "2", bin: "Even" }, { text: "3", bin: "Odd" }] } as unknown as CardsElementLike);

const ticks = (m: GuessMarks) => m.texts.filter((t) => t.text === "✓" || t.text === "✗");

describe("cardsBeside, pure", () => {
  test("a row rank's true order stands a line under the end labels", () => {
    const m = cardsBeside(rank, { order: [1, 0, 2, 3], boxes: [] });
    const column = m.texts.filter((x) => x.color === TRUTH);
    // The end labels sit 26 under the cards (spec/cards.ts); the true order clear below them.
    expect(column.every((x) => x.at[1] <= rank.slots[0][1] - rank.h / 2 - 45)).toBe(true);
  });

  test("rank: ✓/✗ where each card stands, and an ink true-order column beside the slots", () => {
    expect(rank.mode).toBe("rank");
    // Slot 0 holds card 1, slot 1 card 0: those two wrong, the rest right.
    const a: Arrangement = { order: [1, 0, 2, 3], boxes: [] };
    const m = cardsBeside(rank, a);
    const t = ticks(m);
    expect(t).toHaveLength(4);
    expect(t.filter((x) => x.color === WRONG)).toHaveLength(2);
    expect(t.filter((x) => x.color === RIGHT)).toHaveLength(2);
    const column = m.texts.filter((x) => x.color === TRUTH);
    expect(column.map((x) => x.text.replace(/^\d+\. /, ""))).toEqual(["Ant", "Bee", "Cat", "Dog"]);
    // Part by part: the first two slots only.
    expect(ticks(cardsBeside(rank, a, { upTo: 2 }))).toHaveLength(2);
    expect(cardsParts(rank)).toBe(4);
  });

  test("sort: a wrong card gets ✗ and a thin red arrow to its box; a right one ✓ and no arrow", () => {
    // 1 → Even (wrong), 2 → Even (right), 3 → Odd (right).
    const a: Arrangement = { order: [], boxes: [[2], [0, 1]] };
    const m = cardsBeside(sort, a);
    expect(ticks(m).map((x) => x.text).sort()).toEqual(["✓", "✓", "✗"]);
    const red = m.lines.filter((l) => l.color === WRONG);
    expect(red.length).toBe(2); // the shaft and the head
    // The arrow points into the Odd box.
    const box = sort.binBoxes[0];
    const tip = red[0].pts[1];
    expect(Math.abs(tip[0] - box.c[0])).toBeLessThanOrEqual(box.w / 2 + 3);
    expect(Math.abs(tip[1] - box.c[1])).toBeLessThanOrEqual(box.h / 2 + 3);
  });
});

function makePlayer(geom: CardsGeometry, ask: Record<string, unknown>) {
  const nudges: { id: string; dx: number; dy: number }[] = [];
  const marks = new Map<string, GuessMarks | null>();
  const history: { at: number; m: GuessMarks | null }[] = [];
  const base: Record<string, unknown> = {
    setOffset: (id: string, dx: number, dy: number) => nudges.push({ id, dx, dy }),
    setGuessMarks: (owner: string, m: GuessMarks | null) => {
      marks.set(owner, m);
      history.push({ at: performance.now(), m });
    },
  };
  const effects = new Proxy(base, { get: (t, k: string) => t[k] ?? (() => {}) }) as unknown as BackendEffects;
  const commands: Command[] = [{ draw: [geom.id] } as Command, { ask: { question: "Which?", on: geom.id, store: "s", ...ask } } as Command, { speak: "Next." } as Command];
  const truthOffsets: Record<string, Pt> = {};
  geom.cards.forEach((c, i) => (truthOffsets[c] = [geom.truth[i][0] - geom.home[i][0], geom.truth[i][1] - geom.home[i][1]]));
  const plan = planCommands(commands, [geom.id, ...geom.cards], { cardsFor: (id) => (id === geom.id ? { cards: geom.cards, offsets: truthOffsets } : null) });
  // Element handles that record their offsets.
  const placed = new Map<string, Pt>();
  const elements = new Map(
    geom.cards.map((id) => [
      id,
      {
        setOffset: (dx: number, dy: number) => placed.set(id, [dx, dy]),
        finish: () => {},
        hide: () => {},
        setOpacity: () => {},
        setPoints: () => {},
        setText: () => {},
      },
    ]),
  );
  const player = new Player(plan, elements as never, new QuietSpeech(), null, { mode: "narrated", effects });
  const rp: Reprojector = { frame: () => {}, commit: () => elements as never, committed: () => null };
  player.reprojector = rp;
  const runtime: GuessRuntime = { setup: () => ({ handles: [], pin: {}, warnings: [] }), patch: () => ({ params: {} }), cards: (id) => (id === geom.id ? geom : null) };
  player.guess = runtime;
  return { player, nudges, marks, placed, history };
}

describe("cards in the player", () => {
  const wrong: Arrangement = { order: [1, 0, 2, 3], boxes: [] };

  test("beside: the cards stay where the viewer left them, ✓/✗ and the true order shown", async () => {
    const { player, marks, placed, nudges } = makePlayer(rank, { reveal_style: "beside" });
    player.askGate = async () => encodeArrangement(rank, wrong);
    await player.play();
    // Card 0 stands in slot 1 (the viewer's), not its true slot 0.
    const at = placed.get(rank.cards[0])!;
    expect(at[0] + rank.home[0][0]).toBeCloseTo(rank.slots[1][0], 0);
    expect(at[1] + rank.home[0][1]).toBeCloseTo(rank.slots[1][1], 0);
    // No glide: no nudge ever walks a card towards the truth.
    expect(nudges.every((n) => n.dx === 0 && n.dy === 0)).toBe(true);
    const m = marks.get("cards_1")!;
    expect(ticks(m)).toHaveLength(4);
    expect(m.texts.some((t) => t.color === TRUTH)).toBe(true);
    // A scrub back puts the cards at the plan's places and the marks away.
    player.renderUpTo(1);
    expect(marks.get("cards_1")).toBeNull();
    expect(placed.get(rank.cards[0])).toEqual([0, 0]);
  });

  test("morph: the cards glide to the truth as before", async () => {
    const { player, marks, placed, nudges } = makePlayer(rank, { reveal_style: "morph" });
    player.askGate = async () => encodeArrangement(rank, wrong);
    await player.play();
    expect(nudges.some((n) => n.dx !== 0 || n.dy !== 0)).toBe(true);
    const at = placed.get(rank.cards[0])!;
    expect(at[0] + rank.home[0][0]).toBeCloseTo(rank.truth[0][0], 0);
    const m = marks.get("cards_1")!;
    expect(m.texts.some((t) => /^you: /.test(t.text))).toBe(true);
    expect(ticks(m)).toHaveLength(0);
  });

  test("reveal_order each: the verdicts come card by card", async () => {
    const { player, history } = makePlayer(rank, { reveal_style: "beside", reveal_order: "each" });
    player.askGate = async () => encodeArrangement(rank, wrong);
    await player.play();
    const counts = history.filter((h) => h.m !== null).map((h) => ({ at: h.at, n: ticks(h.m!).length }));
    const firstOf = (n: number) => counts.find((c) => c.n === n)!.at;
    expect(firstOf(2) - firstOf(1)).toBeGreaterThan(EACH_MS * 0.6);
    expect(counts[counts.length - 1].n).toBe(4);
  });

  test("a replay that skips the question forgets the earlier answer: a seek forward shows none (fix round 2)", async () => {
    const { player, marks } = makePlayer(rank, {});
    player.askGate = async () => encodeArrangement(rank, wrong);
    await player.play();
    player.renderUpTo(3);
    expect(marks.get("cards_1")).toBeTruthy();
    player.renderUpTo(0);
    player.askGate = async () => null;
    await player.play();
    player.renderUpTo(1);
    player.renderUpTo(3);
    expect(marks.get("cards_1") ?? null).toBeNull();
  }, 10000);

  test("a skipped question has no answer to keep: the cards glide to the truth", async () => {
    const { player, nudges } = makePlayer(rank, {});
    player.askGate = async () => null;
    await player.play();
    expect(nudges.some((n) => n.dx !== 0 || n.dy !== 0)).toBe(true);
  });

  test("after the next command the verdicts stay at full strength", async () => {
    const { player, history } = makePlayer(sort, {});
    player.askGate = async () => encodeArrangement(sort, cardsTruth(sort));
    await player.play();
    const last = history.filter((h) => h.m !== null).pop()!.m!;
    expect(ticks(last).every((t) => (t.opacity ?? 1) === 1)).toBe(true);
  });
});

describe("fill beside (final fix wave E): the tiles stand clear of the formula", () => {
  const tiles = { id: "area_tiles", type: "cards", fill: "area", items: [{ text: "r^2", blank: 1 }, { text: "2r" }, { text: "d" }] } as unknown as CardsElementLike;
  const box = { x: 100, y: 100, w: 40, h: 30 };
  const g = cardsGeometry(tiles, undefined, (id) => (id === "area" ? [box] : null));

  test("a tile in a box stands just under it, off the formula's glyphs", () => {
    for (const card of [0, 1]) {
      const p = besidePositions(g, { order: [], boxes: [[card]] })[card];
      expect(p[0]).toBeCloseTo(box.x + box.w / 2);
      // Its top is under the box's bottom (y-up).
      expect(p[1] + g.h / 2).toBeLessThan(box.y);
    }
    // A tile left in the row stays where it is.
    expect(besidePositions(g, { order: [], boxes: [[1]] })[2]).toEqual(g.home[2]);
  });

  test("wrong: no raw TeX written over the box (the box shows the truth as TeX); ✗ by the box", () => {
    const m = cardsBeside(g, { order: [], boxes: [[1]] });
    expect(m.texts.some((t) => t.text.includes("^"))).toBe(false);
    expect(m.texts.some((t) => t.text === "✗")).toBe(true);
  });
});

describe("reveal arrows keep off other cards (final fix wave E)", () => {
  const rects = (g: CardsGeometry, pos: Pt[]) => pos.map((p) => ({ l: p[0] - g.w / 2 + 1, r: p[0] + g.w / 2 - 1, b: p[1] - g.h / 2 + 1, t: p[1] + g.h / 2 - 1 }));
  const crosses = (g: CardsGeometry, pos: Pt[], m: GuessMarks): boolean => {
    const rs = rects(g, pos);
    for (const l of m.lines) {
      if (l.color !== WRONG) continue;
      for (let s = 1; s < l.pts.length; s++) {
        const [a, b] = [l.pts[s - 1], l.pts[s]];
        const n = Math.max(2, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 3));
        for (let k = 0; k <= n; k++) {
          const x = a[0] + ((b[0] - a[0]) * k) / n, y = a[1] + ((b[1] - a[1]) * k) / n;
          if (rs.some((r) => x > r.l && x < r.r && y > r.b && y < r.t)) return true;
        }
      }
    }
    return false;
  };
  let seed = 11;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

  test("select: an arrow from a card in the box to its place in the row goes round the cards on the way", () => {
    const g = cardsGeometry({ id: "m", type: "cards", select: "Mammals", items: [{ text: "Whale", in: true }, "Shark", { text: "Bat", in: true }, "Penguin", { text: "Hedgehog", in: true }, "Crocodile", "Octopus", { text: "Dolphin", in: true }] } as unknown as CardsElementLike);
    for (let trial = 0; trial < 40; trial++) {
      const inBox = g.cards.map((_, i) => i).filter(() => rnd() < 0.5);
      const a: Arrangement = { order: [], boxes: [inBox] };
      const m = cardsBeside(g, a);
      expect(crosses(g, besidePositions(g, a), m)).toBe(false);
    }
  });

  test("sort: arrows to the right box go round the cards in between", () => {
    const g = cardsGeometry({ id: "s", type: "cards", bins: ["Fruit", "Not"], items: ["Apple", "Carrot", "Pear", "Potato", "Plum", "Leek"].map((t, i) => ({ text: t, bin: i % 2 === 0 ? "Fruit" : "Not" })) } as unknown as CardsElementLike);
    for (let trial = 0; trial < 40; trial++) {
      const boxes: number[][] = [[], []];
      g.cards.forEach((_, i) => {
        const r = rnd();
        if (r < 0.45) boxes[0].push(i);
        else if (r < 0.9) boxes[1].push(i);
      });
      const a: Arrangement = { order: [], boxes };
      const m = cardsBeside(g, a);
      expect(crosses(g, besidePositions(g, a), m)).toBe(false);
    }
  });
});

test("compare: each pick's ✓/✗ is green or red from the start (final fix wave E)", async () => {
  const { cardsMarks } = await import("../src/cards/model");
  const g = cardsGeometry({ id: "k", type: "cards", compare: "More dangerous", items: [{ text: "Shark", value: 6 }, { text: "Mosquito", value: 725000 }, { text: "Snake", value: 100000 }, { text: "Dog", value: 25000 }] } as unknown as CardsElementLike);
  const a: Arrangement = { order: [], boxes: [], picks: [0, 0] };
  const m = cardsMarks(g, a);
  const t = ticks(m);
  expect(t.length).toBe(2);
  for (const x of t) expect(x.color).toBe(x.text === "✓" ? RIGHT : WRONG);
});
