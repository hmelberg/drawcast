// A plain sort with no viewer (a movie, the player's Watch): the cards glide
// to the truth, so the score is a perfect viewer's and the right line is
// spoken — never "0 of 6" and the wrong line under a picture of every card
// in its box.
import { describe, expect, test } from "vitest";
import { Player, type GuessRuntime, type Reprojector } from "../src/render/player";
import type { BackendEffects } from "../src/render/backend";
import { planCommands } from "../src/render/plan";
import { SpeechManager } from "../src/render/speech";
import { cardsGeometry, type CardsElementLike } from "../src/spec/cards";
import type { Command } from "../src/spec/types";
import type { Pt } from "../src/layout/model";

globalThis.requestAnimationFrame ??= ((cb: FrameRequestCallback) =>
  setTimeout(() => cb(performance.now()), 2) as unknown as number) as typeof requestAnimationFrame;

class RecordingSpeech extends SpeechManager {
  spoken: string[] = [];
  override get available(): boolean { return false; }
  override speak(text: string): Promise<void> { this.spoken.push(text); return Promise.resolve(); }
  override cancel(): void {}
}

const sort: CardsElementLike = {
  id: "germs",
  type: "cards",
  bins: ["Virus", "Bacterium"],
  items: [{ text: "Flu", bin: "Virus" }, { text: "Cholera", bin: "Bacterium" }, { text: "Measles", bin: "Virus" }, { text: "Strep", bin: "Bacterium" }],
};
const g = cardsGeometry(sort);

describe("a sort with no viewer", () => {
  test("is scored as a perfect viewer, and says the right line", async () => {
    const effects = new Proxy({}, { get: () => () => {} }) as unknown as BackendEffects;
    const commands: Command[] = [{ draw: ["germs"] } as Command, { ask: { question: "Which?", on: "germs", store: "s", right: "{s} right.", wrong: "{s} on the first try." } } as Command];
    const truthOffsets: Record<string, Pt> = {};
    g.cards.forEach((c, i) => (truthOffsets[c] = [g.truth[i][0] - g.home[i][0], g.truth[i][1] - g.home[i][1]]));
    const plan = planCommands(commands, ["germs", ...g.cards], { cardsFor: (id) => (id === "germs" ? { cards: g.cards, offsets: truthOffsets } : null) });
    const speech = new RecordingSpeech();
    const player = new Player(plan, new Map(), speech, null, { mode: "narrated", effects });
    player.reprojector = { frame: () => {}, commit: () => new Map(), committed: () => null } satisfies Reprojector;
    player.guess = { setup: () => ({ handles: [], pin: {}, warnings: [] }), patch: () => ({ params: {} }), cards: (id) => (id === "germs" ? g : null) } satisfies GuessRuntime;
    player.autoAnswers = true;
    player.setSpeed(40);
    await player.play();
    expect(player.vars.get("s.within")).toBe("4");
    expect(speech.spoken).toContain("4 of 4 right.");
    expect(speech.spoken.some((l) => l.includes("first try"))).toBe(false);
  });
});
