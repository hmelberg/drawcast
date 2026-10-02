// check: each in the player (round 7 §3): the first drops are the score,
// nothing is left to reveal, the corrected cards stay faded and the counter
// stands — through a seek forward, gone on a seek back; a movie has neither.
import { describe, expect, test } from "vitest";
import { Player, type GuessRuntime, type Reprojector } from "../src/render/player";
import type { BackendEffects } from "../src/render/backend";
import { planCommands } from "../src/render/plan";
import { SpeechManager } from "../src/render/speech";
import { cardsGeometry, type CardsElementLike, type CardsGeometry } from "../src/spec/cards";
import { cardsTruth, checkDrop, encodeArrangement, initialArrangement, type Arrangement } from "../src/cards/model";
import type { GuessMarks } from "../src/guess/marks";
import { FADED } from "../src/guess/reveal";
import type { Command } from "../src/spec/types";
import type { Pt } from "../src/layout/model";

globalThis.requestAnimationFrame ??= ((cb: FrameRequestCallback) =>
  setTimeout(() => cb(performance.now()), 2) as unknown as number) as typeof requestAnimationFrame;

class QuietSpeech extends SpeechManager {
  override get available(): boolean { return false; }
  override speak(): Promise<void> { return Promise.resolve(); }
  override cancel(): void {}
}

const sort = cardsGeometry({ id: "s", type: "cards", bins: ["Odd", "Even"], items: [{ text: "1", bin: "Odd" }, { text: "2", bin: "Even" }, { text: "3", bin: "Odd" }] } as CardsElementLike);

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
  const commands: Command[] = [{ draw: [geom.id] } as Command, { ask: { question: "Which box does each number go in? Sort every card.", on: geom.id, store: "s", ...ask } } as Command, { speak: "Next." } as Command];
  const truthOffsets: Record<string, Pt> = {};
  geom.cards.forEach((c, i) => (truthOffsets[c] = [geom.truth[i][0] - geom.home[i][0], geom.truth[i][1] - geom.home[i][1]]));
  const plan = planCommands(commands, [geom.id, ...geom.cards], { cardsFor: (id) => (id === geom.id ? { cards: geom.cards, offsets: truthOffsets } : null) });
  const placed = new Map<string, Pt>();
  const opacity = new Map<string, number>();
  const elements = new Map(
    geom.cards.map((id) => [
      id,
      { setOffset: (dx: number, dy: number) => placed.set(id, [dx, dy]), finish: () => {}, hide: () => {}, setOpacity: (a: number) => opacity.set(id, a), setPoints: () => {}, setText: () => {} },
    ]),
  );
  const player = new Player(plan, elements as never, new QuietSpeech(), null, { mode: "narrated", effects });
  const rp: Reprojector = { frame: () => {}, commit: () => elements as never, committed: () => null };
  player.reprojector = rp;
  const runtime: GuessRuntime = { setup: () => ({ handles: [], pin: {}, warnings: [] }), patch: () => ({ params: {} }), cards: (id) => (id === geom.id ? geom : null) };
  player.guess = runtime;
  return { player, nudges, marks, placed, history, opacity };
}

/** Card 0 first dropped in Even (wrong), the rest right. */
function answered(): Arrangement {
  let a = initialArrangement(sort);
  for (const [c, b] of [[0, 1], [1, 1], [2, 0]] as const) a = checkDrop(sort, a, c, b).arr;
  return a;
}
const counterText = (m: GuessMarks | null | undefined) => (m?.texts ?? []).map((t) => t.text);

describe("check: each in the player", () => {
  test("{s} is the first-drop count, {s.total} the number of cards; wrong when any first drop was", async () => {
    const { player } = makePlayer(sort, {});
    player.askGate = async () => encodeArrangement(sort, answered());
    await player.play();
    expect(player.vars.get("s")).toBe("2");
    expect(player.vars.get("s.total")).toBe("3");
    expect(player.vars.get("s.ok")).toBe("false");
  });

  test("nothing left to reveal: the counter is the marks, no arrows; the corrected card stays faded; every card at its truth", async () => {
    const { player, marks, placed, history, opacity } = makePlayer(sort, {});
    player.askGate = async () => encodeArrangement(sort, answered());
    await player.play();
    const full = history.filter((h) => h.m !== null && counterText(h.m).join(" ") === "✓ 2 · ✗ 1");
    expect(full.length).toBeGreaterThan(0);
    expect(full[0].m!.lines).toHaveLength(0);
    expect(full[0].m!.texts.every((t) => t.opacity === undefined)).toBe(true);
    // After "Next." the counter and the corrected card fade with yours.
    expect(marks.get("cards_1")!.texts.every((t) => t.opacity === FADED)).toBe(true);
    expect(opacity.get(sort.cards[0])).toBe(FADED);
    sort.cards.forEach((id, i) => expect(placed.get(id)).toEqual([sort.truth[i][0] - sort.home[i][0], sort.truth[i][1] - sort.home[i][1]]));
  });

  test("seek: forward past the ask restores the counter and the faded card; back before it clears both (Review Focus 3)", async () => {
    const { player, marks, opacity } = makePlayer(sort, {});
    player.askGate = async () => encodeArrangement(sort, answered());
    await player.play();
    player.renderUpTo(1);
    expect(marks.get("cards_1") ?? null).toBeNull();
    expect(opacity.get(sort.cards[0])).toBe(1);
    player.renderUpTo(2);
    expect(counterText(marks.get("cards_1"))).toEqual(["✓ 2", "·", "✗ 1"]);
    expect(opacity.get(sort.cards[0])).toBe(0.45);
    expect(opacity.get(sort.cards[1])).toBe(1);
    player.renderUpTo(3);
    expect(opacity.get(sort.cards[0])).toBe(FADED);
  });

  test("the movie: no counter, nothing faded", async () => {
    const { player, marks, opacity } = makePlayer(sort, {});
    await player.play();
    expect(marks.get("cards_1") ?? null).toBeNull();
    expect([...opacity.values()].every((a) => a === 1)).toBe(true);
  });

  test("an answer without first (check: end, or older) keeps the beside reveal (Review Focus 4)", async () => {
    const { player, history } = makePlayer(sort, {});
    player.askGate = async () => encodeArrangement(sort, cardsTruth(sort));
    await player.play();
    const ms = history.filter((h) => h.m !== null).map((h) => h.m!);
    expect(ms.some((m) => m.texts.some((t) => t.text === "✓"))).toBe(true);
    expect(ms.some((m) => m.texts.some((t) => /^✓ \d+$/.test(t.text)))).toBe(false);
  });

  test("a re-applied scene keeps the gate's fades while it is open (Review Focus 7)", async () => {
    const { player } = makePlayer(sort, {});
    let seen: number | null = null;
    player.askGate = async (_signal, step) => {
      (step as { cardsSession?: { fade?(id: string, a: number): void } }).cardsSession!.fade!(sort.cards[0], 0.45);
      // What any applyScene (a resize commit) would give the card now.
      seen = (player as unknown as { baseOpacity(id: string, s: { opacities: Record<string, number> }): number }).baseOpacity(sort.cards[0], { opacities: {} });
      return encodeArrangement(sort, answered());
    };
    await player.play();
    expect(seen).toBe(0.45);
  });
});

// The deck and the tap-all go through the same reveal (spec §3.3–3.4).
const deck = cardsGeometry({ id: "d", type: "cards", deck: true, bins: ["Odd", "Even"], items: [{ text: "1", bin: "Odd" }, { text: "2", bin: "Even" }, { text: "3", bin: "Odd" }, { text: "4", bin: "Even" }] } as CardsElementLike);
const zoo = cardsGeometry({ id: "z", type: "cards", select: "Mammals", items: [{ text: "Whale", in: true }, "Shark", { text: "Bat", in: true }, "Trout"] } as CardsElementLike);
/** Card 0 first dropped wrong (a select's in-card: missed, -1), the rest right. */
function answeredOf(g: CardsGeometry): Arrangement {
  let a = initialArrangement(g);
  g.cards.forEach((_, i) => {
    const right = g.truthBin[i];
    const wrong = g.select ? (right === 0 ? -1 : 0) : (right + 1) % g.bins.length;
    a = checkDrop(g, a, i, i === 0 ? wrong : right).arr;
  });
  return a;
}

for (const [name, g] of [["deck", deck], ["select", zoo]] as const) {
  describe(`check: each in the player — ${name}`, () => {
    const n = g.cards.length;
    test("the counter is the marks; seek forward restores it and the faded card; back clears both; the next command fades them", async () => {
      const { player, marks, opacity } = makePlayer(g, {});
      player.askGate = async () => encodeArrangement(g, answeredOf(g));
      await player.play();
      expect(player.vars.get("s")).toBe(String(n - 1));
      expect(marks.get("cards_1")!.texts.every((t) => t.opacity === FADED)).toBe(true);
      expect(opacity.get(g.cards[0])).toBe(FADED);
      player.renderUpTo(1);
      expect(marks.get("cards_1") ?? null).toBeNull();
      expect(opacity.get(g.cards[0])).toBe(1);
      player.renderUpTo(2);
      expect(counterText(marks.get("cards_1"))).toEqual([`✓ ${n - 1}`, "·", "✗ 1"]);
      expect(opacity.get(g.cards[0])).toBe(0.45);
      expect(opacity.get(g.cards[1])).toBe(1);
    });

    test("the movie: no counter, nothing faded", async () => {
      const { player, marks, opacity } = makePlayer(g, {});
      await player.play();
      expect(marks.get("cards_1") ?? null).toBeNull();
      expect([...opacity.values()].every((a) => a === 1)).toBe(true);
    });
  });
}
