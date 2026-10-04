// Placing cards on a line (Hans 2026-10-04, "Closer to the pyramids, or the
// Moon?"): the value a card would land on reads precisely while it is
// dragged and after; the reveal glides each card to its true place, leaving
// a ghost where the viewer put it; and the score lines are voiced ahead.
import { describe, expect, test } from "vitest";
import { cardsGeometry, type CardsElementLike } from "../src/spec/cards";
import { drop, initialArrangement, placeMarks, placeValueAt } from "../src/cards/model";
import { GHOST_OPACITY, placeGlide } from "../src/cards/beside";
import { Player, type GuessRuntime, type Reprojector } from "../src/render/player";
import type { BackendEffects } from "../src/render/backend";
import { planCommands } from "../src/render/plan";
import { SpeechManager } from "../src/render/speech";
import type { SpeakLine } from "../src/render/delivery";
import type { GuessMarks } from "../src/guess/marks";
import type { Command } from "../src/spec/types";
import type { Pt } from "../src/layout/model";

globalThis.requestAnimationFrame ??= ((cb: FrameRequestCallback) =>
  setTimeout(() => cb(performance.now()), 2) as unknown as number) as typeof requestAnimationFrame;

const timeline = { id: "time", type: "scale" as const, min: -3000, max: 2000, x: 100, y: 420, width: 800 };
const when: CardsElementLike = { id: "when", type: "cards", along: "time", items: [{ text: "Great Pyramid", value: -2560 }, { text: "Cleopatra dies", value: -30 }, { text: "Moon landing", value: 1969 }] };
const g = cardsGeometry(when, () => timeline);
const sg = g.scale!;

describe("the value it lands on", () => {
  test("placeValueAt is the drop's value: snapped over the line, null off it", () => {
    const p: Pt = [sg.xAt(-1903), sg.y + 60];
    expect(placeValueAt(g, p)).toBe(-1900);
    expect(drop(g, initialArrangement(g), 0, p).values![0]).toBe(-1900);
    expect(placeValueAt(g, [sg.xAt(0), sg.y - 200])).toBeNull();
  });
  test("placed cards: a pin and their value in the scale's words; the card being dragged: a pin and a tick at the value, no stale label", () => {
    const values = [-1900, null, 1650];
    const m = placeMarks(g, values);
    expect(m.texts.map((t) => t.text).sort()).toEqual(["1650", "1900 BC"]);
    const d = placeMarks(g, values, { card: 0, at: [sg.xAt(-1000), sg.y + 70], value: -1000 });
    expect(d.texts.map((t) => t.text)).toEqual(["1650"]);
    const x = sg.xAt(-1000);
    // The tick crosses the line at the value.
    expect(d.lines.some((l) => l.pts.every((q) => Math.abs(q[0] - x) < 0.01) && l.pts.some((q) => q[1] < sg.y) && l.pts.some((q) => q[1] > sg.y))).toBe(true);
  });
});

describe("the glide reveal's marks", () => {
  const a = { order: [], boxes: [], values: [-1900, -50, 1650] };
  test("gliding: a ghost (dashed outline) only for a card that was off, with the value it was given", () => {
    const m = placeGlide(g, a);
    const outlines = m.lines.filter((l) => l.closed && l.dashed);
    expect(outlines).toHaveLength(2);
    expect(outlines.every((l) => l.opacity === GHOST_OPACITY)).toBe(true);
    expect(m.texts.map((t) => t.text).sort()).toEqual(["1650", "1900 BC"]);
  });
  test("landed: the true values on the line, ✓/✗ on the cards, an arrow from yours to the truth", () => {
    const m = placeGlide(g, a, { landed: true });
    const words = m.texts.map((t) => t.text);
    for (const t of ["2560 BC", "30 BC", "1969", "1900 BC", "1650"]) expect(words).toContain(t);
    expect(words.filter((t) => t === "✓")).toHaveLength(1);
    expect(words.filter((t) => t === "✗")).toHaveLength(2);
    // Yours and the truth's value stand on either side of the arrow.
    const mine = m.texts.find((t) => t.text === "1900 BC")!;
    const truth = m.texts.find((t) => t.text === "2560 BC")!;
    expect(mine.at[0]).toBeGreaterThan(truth.at[0]);
    expect(mine.anchor).toBe("start");
    expect(truth.anchor).toBe("end");
  });
  test("a card not placed glides from the row: no ghost", () => {
    const m = placeGlide(g, { order: [], boxes: [], values: [null, null, null] }, { landed: true });
    expect(m.lines.some((l) => l.closed)).toBe(false);
  });
});

class PrefetchSpeech extends SpeechManager {
  fetched: SpeakLine[] = [];
  override get available(): boolean {
    return false;
  }
  override speak(): Promise<void> {
    return Promise.resolve();
  }
  override cancel(): void {}
  prefetch(lines: SpeakLine[]): void {
    this.fetched.push(...lines);
  }
}

function makePlayer(ask: Record<string, unknown>) {
  const marks: { owner: string; m: GuessMarks | null }[] = [];
  const offsets: { id: string; dx: number; dy: number }[] = [];
  const base: Record<string, unknown> = {
    setGuessMarks: (owner: string, m: GuessMarks | null) => marks.push({ owner, m }),
    setOffset: (id: string, dx: number, dy: number) => offsets.push({ id, dx, dy }),
  };
  const effects = new Proxy(base, { get: (t, k: string) => t[k] ?? (() => {}) }) as unknown as BackendEffects;
  const commands: Command[] = [{ draw: ["when"] } as Command, { ask: { question: "When?", on: "when", store: "w", ...ask } } as Command, { speak: "Next." } as Command];
  const truthOffsets: Record<string, Pt> = {};
  g.cards.forEach((c, i) => (truthOffsets[c] = [g.truth[i][0] - g.home[i][0], g.truth[i][1] - g.home[i][1]]));
  const plan = planCommands(commands, ["when", ...g.cards], { cardsFor: (id) => (id === "when" ? { cards: g.cards, offsets: truthOffsets } : null) });
  const speech = new PrefetchSpeech();
  const player = new Player(plan, new Map(), speech, null, { mode: "narrated", effects });
  const rp: Reprojector = { frame: () => {}, commit: () => new Map(), committed: () => null };
  player.reprojector = rp;
  const runtime: GuessRuntime = { setup: () => ({ handles: [], pin: {}, warnings: [] }), patch: () => ({ params: {} }), cards: (id) => (id === "when" ? g : null) };
  player.guess = runtime;
  player.setSpeed(40);
  return { player, speech, marks, offsets };
}

describe("place in the player", () => {
  test("while the question stands, every score line is voiced ahead", async () => {
    const { player, speech } = makePlayer({ right: "All {w.total} close.", wrong: "{w.within} of {w.total} close." });
    let fetchedAtGate: string[] = [];
    player.askGate = async () => {
      fetchedAtGate = speech.fetched.map((l) => l.text);
      return null;
    };
    await player.play();
    for (const t of ["All 3 close.", "0 of 3 close.", "1 of 3 close.", "2 of 3 close."]) expect(fetchedAtGate).toContain(t);
  });
  test("the default reveal glides the cards to the truth, the ghosts standing from the first frame and kept after", async () => {
    const { player, marks, offsets } = makePlayer({ right: "Right.", wrong: "Not quite." });
    let pressed = 0;
    player.askGate = async () => {
      pressed = marks.length;
      return "-1900,-50,1650";
    };
    await player.play();
    const after = marks.slice(pressed).filter((x) => x.owner.startsWith("cards_") && x.m);
    // The first mark after Done is the ghosts; the last, the landed truth.
    expect(after[0].m!.lines.some((l) => l.closed && l.dashed)).toBe(true);
    const words = after[after.length - 1].m!.texts.map((t) => t.text);
    expect(words).toContain("2560 BC");
    expect(words).toContain("1900 BC");
    // The cards moved (a glide), not left where the viewer put them.
    const pyr = offsets.filter((o) => o.id === g.cards[0]);
    expect(pyr.length).toBeGreaterThan(2);
  });
});
