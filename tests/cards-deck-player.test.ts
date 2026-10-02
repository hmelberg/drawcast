// A deck sort in the player (spec 2026-10-03-round6 §7): the movie sends the
// cards to their boxes one by one — dealt large, flown small — never waits,
// and ends with every box filled; a live viewer's arrangement is judged.
import { describe, expect, test } from "vitest";
import { Player, type GuessRuntime, type Reprojector } from "../src/render/player";
import type { BackendEffects } from "../src/render/backend";
import { planCommands } from "../src/render/plan";
import { SpeechManager } from "../src/render/speech";
import { cardsGeometry, type CardsElementLike } from "../src/spec/cards";
import { cardsTruth, encodeArrangement } from "../src/cards/model";
import { DEAL_GROW, deckCardMs, deckFlight } from "../src/cards/deck";
import type { Command } from "../src/spec/types";
import type { Pt } from "../src/layout/model";

globalThis.requestAnimationFrame ??= ((cb: FrameRequestCallback) =>
  setTimeout(() => cb(performance.now()), 2) as unknown as number) as typeof requestAnimationFrame;

class QuietSpeech extends SpeechManager {
  override get available(): boolean { return false; }
  override speak(): Promise<void> { return Promise.resolve(); }
  override cancel(): void {}
}

const deck: CardsElementLike = {
  id: "germs",
  type: "cards",
  deck: true,
  bins: ["Virus", "Bacteria"],
  items: Array.from({ length: 30 }, (_, i) => ({ text: `Germ ${i + 1}`, bin: i % 3 === 0 ? "Bacteria" : "Virus" })),
};
const g = cardsGeometry(deck);

function makePlayer() {
  const offsets: { id: string; dx: number; dy: number; scale?: number }[] = [];
  const base: Record<string, unknown> = {
    setOffset: (id: string, dx: number, dy: number, scale?: number) => offsets.push({ id, dx, dy, scale }),
  };
  const effects = new Proxy(base, { get: (t, k: string) => t[k] ?? (() => {}) }) as unknown as BackendEffects;
  const commands: Command[] = [{ draw: ["germs"] } as Command, { ask: { question: "Virus or bacteria?", on: "germs", store: "s" } } as Command];
  const truthOffsets: Record<string, Pt> = {};
  g.cards.forEach((c, i) => (truthOffsets[c] = [g.truth[i][0] - g.home[i][0], g.truth[i][1] - g.home[i][1]]));
  const plan = planCommands(commands, ["germs", ...g.cards], { cardsFor: (id) => (id === "germs" ? { cards: g.cards, offsets: truthOffsets } : null) });
  const player = new Player(plan, new Map(), new QuietSpeech(), null, { mode: "narrated", effects });
  const rp: Reprojector = { frame: () => {}, commit: () => new Map(), committed: () => null };
  player.reprojector = rp;
  const runtime: GuessRuntime = { setup: () => ({ handles: [], pin: {}, warnings: [] }), patch: () => ({ params: {} }), cards: (id) => (id === "germs" ? g : null) };
  player.guess = runtime;
  return { player, offsets };
}

describe("the deck's motion", () => {
  test("a card grows on the stack, then flies and shrinks into its slot", () => {
    expect(deckFlight(0, 3)).toEqual({ along: 0, scale: 1 });
    expect(deckFlight(DEAL_GROW, 3).scale).toBeCloseTo(3);
    expect(deckFlight(1, 3)).toEqual({ along: 1, scale: 1 });
  });
  test("the movie's deck takes a few seconds, however many cards", () => {
    expect(deckCardMs(30) * 30).toBeLessThanOrEqual(6000);
    expect(deckCardMs(2)).toBeLessThanOrEqual(600);
  });
});

describe("a deck in the player", () => {
  test("the movie: never waits; every card goes to its box in deal order and is right", async () => {
    const { player, offsets } = makePlayer();
    player.autoAnswers = true;
    player.setSpeed(40);
    let gated = false;
    player.askGate = async () => {
      gated = true;
      return null;
    };
    await player.play();
    expect(gated).toBe(false);
    expect(player.vars.get("s.within")).toBe("30");
    expect(player.vars.get("s.count")).toBe("30");
    // One at a time, in the order they are dealt; each ends at its truth, unscaled.
    const firstMove = g.deal!.map((i) => offsets.findIndex((o) => o.id === g.cards[i] && (o.dx !== 0 || o.dy !== 0)));
    expect(firstMove.every((v, k) => v >= 0 && (k === 0 || v > firstMove[k - 1]))).toBe(true);
    for (const i of g.deal!) {
      // The last flight frame (a beside reveal then hands the card's place to its offset: a nudge back to 0).
      const last = offsets.filter((o) => o.id === g.cards[i] && (o.dx !== 0 || o.dy !== 0)).pop()!;
      expect(last.dx).toBeCloseTo(g.truth[i][0] - g.home[i][0], 0);
      expect(last.dy).toBeCloseTo(g.truth[i][1] - g.home[i][1], 0);
      expect(last.scale ?? 1).toBe(1);
    }
    // Large while dealt.
    expect(offsets.some((o) => (o.scale ?? 1) > 1.5)).toBe(true);
  }, 15000);

  test("live: the viewer's deal is judged", async () => {
    const { player } = makePlayer();
    player.askGate = async () => encodeArrangement(g, cardsTruth(g));
    await player.play();
    expect(player.vars.get("s.within")).toBe("30");
  }, 15000);
});
