// Rank revealed by reordering (round 7 §4): verdicts where the viewer left
// the cards, a faint "yours" row, the cards slide into the true order on
// arcs (opposite directions on opposite sides), blue connectors after.
import { describe, expect, test } from "vitest";
import { Player, type GuessRuntime, type Reprojector } from "../src/render/player";
import type { BackendEffects } from "../src/render/backend";
import { planCommands } from "../src/render/plan";
import { SpeechManager } from "../src/render/speech";
import { cardsGeometry, type CardsElementLike, type CardsGeometry } from "../src/spec/cards";
import { encodeArrangement, positions, type Arrangement } from "../src/cards/model";
import { reorderAt, reorderLanded, reorderSide, yoursRow } from "../src/cards/reorder";
import type { GuessMarks } from "../src/guess/marks";
import { FADED, YOURS } from "../src/guess/reveal";
import { lintCommands } from "../src/lint/lint";
import type { Command, Spec } from "../src/spec/types";
import type { Pt } from "../src/layout/model";

globalThis.requestAnimationFrame ??= ((cb: FrameRequestCallback) =>
  setTimeout(() => cb(performance.now()), 2) as unknown as number) as typeof requestAnimationFrame;

class QuietSpeech extends SpeechManager {
  override get available(): boolean { return false; }
  override speak(): Promise<void> { return Promise.resolve(); }
  override cancel(): void {}
}

const rankOf = (n: number, extra: Partial<CardsElementLike> = {}) =>
  cardsGeometry({ id: "c", type: "cards", items: Array.from({ length: n }, (_, i) => `Card ${i + 1}`), ...extra } as CardsElementLike);
const rank = cardsGeometry({ id: "c", type: "cards", items: ["Ant", "Bee", "Cat", "Dog"] } as CardsElementLike);
const wrong: Arrangement = { order: [1, 0, 2, 3], boxes: [] };

function perms(n: number): number[][] {
  if (n === 1) return [[0]];
  return perms(n - 1).flatMap((p) => Array.from({ length: n }, (_, k) => [...p.slice(0, k), n - 1, ...p.slice(k)]));
}
/** A fixed sample of shuffles (n of 7 and 8: every permutation is too many). */
function sample(n: number, count: number): number[][] {
  let s = 12345;
  const rand = () => ((s = (s * 1103515245 + 12345) >>> 0) / 4294967296);
  return Array.from({ length: count }, () => {
    const p = Array.from({ length: n }, (_, i) => i);
    for (let i = n - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [p[i], p[j]] = [p[j], p[i]];
    }
    return p;
  });
}

describe("the slide, pure", () => {
  test("sides: a row's rightward card above, leftward below; a column's downward right, upward left", () => {
    const g = rankOf(4);
    expect(reorderSide(g, g.slots[0], g.slots[3])).toBe(1);
    expect(reorderSide(g, g.slots[3], g.slots[0])).toBe(-1);
    const c = rankOf(4, { arrange: "column" });
    expect(reorderSide(c, c.slots[0], c.slots[3])).toBe(1);
    expect(reorderSide(c, c.slots[3], c.slots[0])).toBe(-1);
    // Ends where it should, starts where it was.
    expect(reorderAt(g, g.slots[0], g.slots[3], 0)).toEqual(g.slots[0]);
    expect(reorderAt(g, g.slots[0], g.slots[3], 1)).toEqual(g.slots[3]);
  });

  for (const column of [false, true])
    for (let n = 2; n <= 8; n++) {
      test(`${column ? "column" : "row"} of ${n}: no card passes through one moving the other way, or one standing still`, () => {
        const g = rankOf(n, column ? { arrange: "column" } : {});
        for (const order of n <= 6 ? perms(n) : sample(n, 300)) {
          const from = positions(g, { order, boxes: [] });
          const moves = g.cards.map((_, i) => Math.hypot(from[i][0] - g.truth[i][0], from[i][1] - g.truth[i][1]) > 0.5);
          const sides = g.cards.map((_, i) => reorderSide(g, from[i], g.truth[i]));
          for (let k = 0; k <= 100; k++) {
            const at = g.cards.map((_, i) => reorderAt(g, from[i], g.truth[i], k / 100));
            for (let i = 0; i < n; i++)
              for (let j = i + 1; j < n; j++) {
                if (moves[i] && moves[j] && sides[i] === sides[j]) continue;
                const hit = Math.abs(at[i][0] - at[j][0]) < g.w - 0.5 && Math.abs(at[i][1] - at[j][1]) < g.h - 0.5;
                if (hit) throw new Error(`order ${order.join(",")}: cards ${i} and ${j} cross at t=${k / 100}`);
              }
          }
        }
      });
    }

  test("the yours row: only the cards the viewer had wrong, the word first, blue, size 16, on the canvas", () => {
    const row = yoursRow(rank, wrong, "yours");
    expect(row.map((t) => t.text)).toEqual(["yours", "Bee", "Ant"]);
    expect(row.every((t) => t.color === YOURS && t.size === 16)).toBe(true);
    const high = rankOf(4, { y: 700 });
    for (const t of yoursRow(high, wrong, "yours")) expect(t.at[1]).toBeLessThanOrEqual(740);
    const col = rankOf(8, { arrange: "column" });
    for (const t of yoursRow(col, { order: [7, 1, 2, 3, 4, 5, 6, 0], boxes: [] }, "yours")) {
      expect(t.at[0]).toBeGreaterThan(0);
      expect(t.at[1]).toBeLessThanOrEqual(740);
    }
  });

  test("the ends (most / least) stay where they are, clear of the yours row (spec §4)", () => {
    const g = rankOf(4, { ends: ["most", "least"] });
    // Where cardsElements puts a row's ends (spec/cards.ts): under the first and last slot.
    const ends = [g.slots[0], g.slots[3]].map((p) => [p[0], p[1] - g.h / 2 - 26]);
    for (const t of yoursRow(g, { order: [3, 1, 2, 0], boxes: [] }, "yours"))
      for (const e of ends) expect(Math.abs(t.at[1] - e[1])).toBeGreaterThan(20);
    // Nothing but the cards is moved: the ends are not among them.
    expect(g.cards.some((id) => /_end_\d$/.test(id))).toBe(false);
  });

  test("landed: ✓ on the cards that never moved, a blue connector for each that did, no ✗", () => {
    const m = reorderLanded(rank, wrong, "yours");
    expect(m.texts.filter((t) => t.text === "✓")).toHaveLength(2);
    expect(m.texts.filter((t) => t.text === "✗")).toHaveLength(0);
    expect(m.lines).toHaveLength(2);
    expect(m.lines.every((l) => l.color === YOURS)).toBe(true);
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
  const commands: Command[] = [{ draw: [geom.id] } as Command, { ask: { question: "Which kills the most people a year? Put them in order.", on: geom.id, store: "r", ...ask } } as Command, { speak: "Next." } as Command];
  const truthOffsets: Record<string, Pt> = {};
  geom.cards.forEach((c, i) => (truthOffsets[c] = [geom.truth[i][0] - geom.home[i][0], geom.truth[i][1] - geom.home[i][1]]));
  const plan = planCommands(commands, [geom.id, ...geom.cards], { cardsFor: (id) => (id === geom.id ? { cards: geom.cards, offsets: truthOffsets } : null) });
  const placed = new Map<string, Pt>();
  const elements = new Map(
    geom.cards.map((id) => [id, { setOffset: (dx: number, dy: number) => placed.set(id, [dx, dy]), finish: () => {}, hide: () => {}, setOpacity: () => {}, setPoints: () => {}, setText: () => {} }]),
  );
  const player = new Player(plan, elements as never, new QuietSpeech(), null, { mode: "narrated", effects });
  const rp: Reprojector = { frame: () => {}, commit: () => elements as never, committed: () => null };
  player.reprojector = rp;
  const runtime: GuessRuntime = { setup: () => ({ handles: [], pin: {}, warnings: [] }), patch: () => ({ params: {} }), cards: (id) => (id === geom.id ? geom : null) };
  player.guess = runtime;
  return { player, nudges, marks, placed, history };
}

const ticks = (m: GuessMarks) => m.texts.filter((t) => t.text === "✓" || t.text === "✗");

describe("reorder in the player (the default for rank)", () => {
  test("verdicts on all four first, then the slide off the row; every card ends at the truth, no nudge left", async () => {
    const { player, nudges, history, placed } = makePlayer(rank, {});
    player.askGate = async () => encodeArrangement(rank, wrong);
    await player.play();
    expect(history.some((h) => h.m !== null && ticks(h.m).length === 4)).toBe(true);
    expect(nudges.some((n) => Math.abs(n.dy) > 1)).toBe(true);
    for (const id of rank.cards) {
      const l = nudges.filter((n) => n.id === id).pop()!;
      expect([l.dx, l.dy]).toEqual([0, 0]);
    }
    rank.cards.forEach((id, i) => expect(placed.get(id)).toEqual([rank.truth[i][0] - rank.home[i][0], rank.truth[i][1] - rank.home[i][1]]));
  });

  test("landed: the yours row, blue connectors, ✓ on the unmoved cards; restored on a seek forward, gone on a seek back", async () => {
    const { player, marks, history } = makePlayer(rank, {});
    player.askGate = async () => encodeArrangement(rank, wrong);
    await player.play();
    const landed = history.filter((h) => h.m !== null && h.m.lines.length > 0)[0].m!;
    expect(landed.lines).toHaveLength(2);
    expect(landed.texts.filter((t) => t.text === "✓")).toHaveLength(2);
    expect(landed.texts.some((t) => t.text === "yours" && t.color === YOURS)).toBe(true);
    player.renderUpTo(2);
    expect(marks.get("cards_1")!.lines).toHaveLength(2);
    player.renderUpTo(1);
    expect(marks.get("cards_1") ?? null).toBeNull();
  });

  test("at the next command the yours row and the connectors fade; the ✓ on the unmoved cards stay (spec §4.5, round 6 rule)", async () => {
    const { player, marks } = makePlayer(rank, {});
    player.askGate = async () => encodeArrangement(rank, wrong);
    await player.play(); // the ask, then "Next."
    const m = marks.get("cards_1")!;
    expect(m.lines.length).toBe(2);
    expect(m.lines.every((l) => l.opacity === FADED)).toBe(true);
    expect(m.texts.filter((t) => t.color === YOURS).every((t) => t.opacity === FADED)).toBe(true);
    // Pinned on purpose: the truth's ✓ is not yours and keeps its strength.
    expect(m.texts.filter((t) => t.text === "✓").every((t) => t.opacity === undefined)).toBe(true);
  });

  test("the movie slides the same way, with no marks", async () => {
    const { player, nudges, marks } = makePlayer(rank, {});
    await player.play();
    expect(nudges.some((n) => Math.abs(n.dy) > 1)).toBe(true);
    expect(marks.get("cards_1") ?? null).toBeNull();
  });

  test("an explicit beside still wins: the cards stay where the viewer left them", async () => {
    const { player, nudges } = makePlayer(rank, { reveal_style: "beside" });
    player.askGate = async () => encodeArrangement(rank, wrong);
    await player.play();
    expect(nudges.every((n) => n.dx === 0 && n.dy === 0)).toBe(true);
  });
});

test("lint: reorder on anything but rank cards warns", () => {
  const spec = (el: object) =>
    ({ elements: [el], commands: [{ draw: ["c"] }, { ask: { question: "Which box does each card go in? Sort them all.", on: "c", reveal_style: "reorder" } }] }) as unknown as Spec;
  const sortEl = { id: "c", type: "cards", bins: ["A", "B"], items: [{ text: "x", bin: "A" }, { text: "y", bin: "B" }] };
  const rankEl = { id: "c", type: "cards", items: ["x", "y", "z"] };
  expect(lintCommands(spec(sortEl)).filter((i) => /reorder/.test(i.message))).toHaveLength(1);
  expect(lintCommands(spec(rankEl)).filter((i) => /reorder/.test(i.message))).toHaveLength(0);
});
