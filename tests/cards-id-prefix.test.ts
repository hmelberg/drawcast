// A cards element owns the pieces it generates ("land_1", "land_bin_1_box",
// "land_v_2", "land_title" …), never an author's element that merely shares
// its id as a prefix (bug 2026-10-07: a pie label "land_w" was drawn with the
// select cards "land" during the ask, behind the Finland card).
import { describe, expect, test } from "vitest";
import { Player, type GuessRuntime, type Reprojector } from "../src/render/player";
import type { BackendEffects } from "../src/render/backend";
import { planCommands } from "../src/render/plan";
import { SpeechManager } from "../src/render/speech";
import { cardsElements, cardsGeometry, type CardsElementLike } from "../src/spec/cards";
import { isCardsPart } from "../src/spec/cards-ids";
import { coVisibleWithCards, followerRoom } from "../src/spec/cards-company";
import type { Command, Spec, SpecElement } from "../src/spec/types";
import type { Pt } from "../src/layout/model";

globalThis.requestAnimationFrame ??= ((cb: FrameRequestCallback) =>
  setTimeout(() => cb(performance.now()), 2) as unknown as number) as typeof requestAnimationFrame;

class QuietSpeech extends SpeechManager {
  override get available(): boolean { return false; }
  override speak(): Promise<void> { return Promise.resolve(); }
  override cancel(): void {}
}

const land: CardsElementLike = { id: "land", type: "cards", select: "Mostly forest", items: [{ text: "Finland", in: true }, { text: "Egypt", in: false }, { text: "Sweden", in: true }] } as CardsElementLike;
const label = { id: "land_w", type: "text", text: "woods", x: 500, y: 300 } as SpecElement;

describe("cards membership is exact, never a bare id prefix", () => {
  test("every piece a cards element generates is its part; an author's land_w is not", () => {
    const modes: CardsElementLike[] = [
      land,
      { id: "land", type: "cards", bins: ["A", "B"], items: [{ text: "x", bin: "A" }, { text: "y", bin: "B" }] } as CardsElementLike,
      { id: "land", type: "cards", items: ["a", "b", "c"], ends: ["first", "last"], arrange: "row" } as CardsElementLike,
      { id: "land", type: "cards", items: ["a", "b", "c"], steps: true, ends: ["first", "last"] } as unknown as CardsElementLike,
      { id: "land", type: "cards", compare: "Which is bigger?", items: [{ text: "a", value: 1 }, { text: "b", value: 2 }] } as unknown as CardsElementLike,
    ];
    for (const m of modes) {
      for (const e of cardsElements(m)) {
        if (e.id === "land") continue;
        expect(isCardsPart("land", e.id), `${e.id}`).toBe(true);
        // The drawables of a piece (a card's text, a node's icon) are parts too.
        expect(isCardsPart("land", `${e.id}_text`), `${e.id}_text`).toBe(true);
      }
    }
    for (const id of ["land_w", "land_label", "land_1x", "landing", "land", "lan_1", "land_bin_x"]) expect(isCardsPart("land", id), id).toBe(false);
  });

  test("company: land_w drawn with the cards is company, not one of the cards; it never turns the cards on", () => {
    const els = [land, label] as SpecElement[];
    const seen = coVisibleWithCards("land", { elements: els, commands: [{ draw: ["land"] }, { draw: ["land_w"] }] as Spec["commands"] });
    expect(seen.has("land_w")).toBe(true);
    // Drawing land_w alone (the cards come only after it is erased) puts nothing beside the cards.
    const apart = coVisibleWithCards("land", { elements: [...els, { id: "note", type: "text", text: "n", x: 1, y: 1 }] as SpecElement[], commands: [{ draw: ["land_w", "note"] }, { erase: ["note"] }, { erase: ["land_w"] }, { draw: ["land"] }] as Spec["commands"] });
    expect(apart.has("note")).toBe(false);
  });

  test("followers: words placed against land_w do not follow the cards; against a card they do", () => {
    const els = [land, label, { id: "a", type: "text", text: "w", at: { ref: "land_w", side: "right" } }, { id: "b", type: "text", text: "v", at: { ref: "land_2", side: "right" } }] as SpecElement[];
    expect([...followerRoom("land", els).followers]).toEqual(["b"]);
  });

  test("player: the ask shows the cards' own pieces, never land_w", async () => {
    const g = cardsGeometry(land);
    const finished: string[] = [];
    const pieces = cardsElements(land).map((e) => e.id).filter((id) => id !== "land");
    const ids = [...pieces, ...g.cards.map((c) => `${c}_text`), "land_w"];
    const elements = new Map(ids.map((id) => [id, { setOffset: () => {}, finish: () => finished.push(id), hide: () => {}, setOpacity: () => {}, setPoints: () => {}, setText: () => {}, setProgress: () => {} }]));
    const effects = new Proxy({} as Record<string, unknown>, { get: (t, k: string) => t[k] ?? (() => {}) }) as unknown as BackendEffects;
    // The cast does not draw the cards first: the question shows them. land_w (a later pie label) is on the page, not yet drawn.
    const commands: Command[] = [{ ask: { question: "Which are mostly forest?", on: "land", store: "s" } } as Command, { speak: "Next." } as Command];
    const offsets: Record<string, Pt> = {};
    const plan = planCommands(commands, ["land", ...ids], { cardsFor: (id) => (id === "land" ? { cards: g.cards, offsets } : null) });
    const player = new Player(plan, elements as never, new QuietSpeech(), null, { mode: "narrated", effects });
    const rp: Reprojector = { frame: () => {}, commit: () => elements as never, committed: () => null };
    player.reprojector = rp;
    const runtime: GuessRuntime = { setup: () => ({ handles: [], pin: {}, warnings: [] }), patch: () => ({ params: {} }), cards: (id) => (id === "land" ? g : null) };
    player.guess = runtime;
    // What has been shown when the viewer is asked: the gate holds, we read, then stop.
    const asked = new Promise<string[]>((resolve) => {
      player.askGate = async () => {
        resolve([...finished]);
        return new Promise<never>(() => {});
      };
    });
    void player.play();
    const duringAsk = await asked;
    player.stop();
    expect(duringAsk).not.toContain("land_w");
    for (const c of g.cards) expect(duringAsk).toContain(c);
    expect(duringAsk).toContain(`${g.cards[0]}_text`);
  });
});
