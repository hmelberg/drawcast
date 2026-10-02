// Feedback lines in the player (spec 2026-10-03-looks-feedback-account §4.2):
// after the author's right/wrong line, ONE line for the band the viewer
// reached — never for plain, a skip or a movie.
import { describe, expect, test } from "vitest";
import { Player, type GuessRuntime, type Reprojector } from "../src/render/player";
import type { BackendEffects } from "../src/render/backend";
import { planCommands } from "../src/render/plan";
import { SpeechManager } from "../src/render/speech";
import { formatterFor, type GuessHandle } from "../src/guess/handles";
import { cardsGeometry, type CardsElementLike } from "../src/spec/cards";
import { cardsTruth, encodeArrangement } from "../src/cards/model";
import { FALLBACK_LINES } from "../src/feedback/lines";
import type { Command } from "../src/spec/types";

globalThis.requestAnimationFrame ??= ((cb: FrameRequestCallback) =>
  setTimeout(() => cb(performance.now()), 5) as unknown as number) as typeof requestAnimationFrame;

class CapturingSpeech extends SpeechManager {
  said: string[] = [];
  override get available(): boolean { return false; }
  override speak(text: string): Promise<void> {
    this.said.push(text);
    return Promise.resolve();
  }
  override cancel(): void {}
}

const effects = new Proxy({} as Record<string, unknown>, { get: (t, k: string) => t[k] ?? (() => {}) }) as unknown as BackendEffects;

const match: CardsElementLike = { id: "d", type: "cards", items: [{ text: "Aspirin", match: "Thins blood" }, { text: "Insulin", match: "Lowers sugar" }, { text: "Penicillin", match: "Kills bacteria" }] };
const g = cardsGeometry(match);

const handle: GuessHandle = {
  part: "bar_2", shows: ["bar_2"], kind: "height", truth: [80], min: 0, max: 100, step: 1, label: "Norway", format: formatterFor(1), unit: "", paths: ["values.1"],
};

function makePlayer(commands: Command[], opts: { feedback?: unknown; lang?: string } = {}) {
  const plan = planCommands(commands, ["axes", "bar_1", "bar_2", ...g.cards], {
    ...(opts.feedback !== undefined ? { feedback: opts.feedback } : {}),
    guessParts: (on) => ({ parts: Array.isArray(on) ? on : [on], shows: ["bar_2"] }),
    cardsFor: (id) => (id === "d" ? { cards: g.cards, offsets: {}, hides: [] } : null),
  });
  const speech = new CapturingSpeech();
  const player = new Player(plan, new Map(), speech, null, { mode: "narrated", effects });
  if (opts.lang) player.setSourceLang(opts.lang);
  const rp: Reprojector = { frame: () => {}, commit: () => new Map(), committed: () => null };
  player.reprojector = rp;
  const runtime: GuessRuntime = {
    setup: () => ({ handles: [handle], pin: {}, warnings: [] }),
    patch: (_s, values) => ({ params: { "values.1": values[0][0] } }),
    cards: (id) => (id === "d" ? g : null),
  };
  player.guess = runtime;
  return { player, speech, plan };
}

const truth = encodeArrangement(g, cardsTruth(g));
const links = truth.split(",");
/** One of three right: the first link kept, the other two swapped. */
const oneRight = [links[0], links[2], links[1]].join(",");

const DRY = { style: "dry", perfect: "Suspiciously good. Pharmacist?", poor: "Good thing you're not a pharmacist.", none: "Bold. Wrong, but bold." };
const cardsAsk = (feedback?: unknown): Command => ({ ask: { question: "Match them.", on: "d", right: "Each drug, its job.", wrong: "Aspirin thins, insulin lowers.", ...(feedback !== undefined ? { feedback } : {}) } as never });

describe("feedback lines in the player", () => {
  test("cards: the author's line, then the band's line (poor)", async () => {
    const { player, speech, plan } = makePlayer([cardsAsk(DRY)]);
    expect((plan.steps[0] as { feedback?: { style: string } }).feedback?.style).toBe("dry");
    player.askGate = async () => oneRight;
    await player.play();
    const i = speech.said.indexOf("Aspirin thins, insulin lowers.");
    expect(i).toBeGreaterThanOrEqual(0);
    expect(speech.said[i + 1]).toBe("Good thing you're not a pharmacist.");
  });

  test("cards: all right is perfect", async () => {
    const { player, speech } = makePlayer([cardsAsk(DRY)]);
    player.askGate = async () => truth;
    await player.play();
    const i = speech.said.indexOf("Each drug, its job.");
    expect(speech.said[i + 1]).toBe("Suspiciously good. Pharmacist?");
  });

  test("plain (the default) speaks nothing extra", async () => {
    const { player, speech, plan } = makePlayer([cardsAsk()]);
    expect((plan.steps[0] as { feedback?: unknown }).feedback).toBeUndefined();
    player.askGate = async () => oneRight;
    await player.play();
    expect(speech.said[speech.said.length - 1]).toBe("Aspirin thins, insulin lowers.");
  });

  test("an ask's plain silences the cast's style", async () => {
    const { player, speech } = makePlayer([cardsAsk("plain")], { feedback: DRY });
    player.askGate = async () => oneRight;
    await player.play();
    expect(speech.said[speech.said.length - 1]).toBe("Aspirin thins, insulin lowers.");
  });

  test("a skip speaks nothing extra", async () => {
    const { player, speech } = makePlayer([cardsAsk(DRY)]);
    player.askGate = async () => null;
    await player.play();
    for (const l of [DRY.perfect, DRY.poor, DRY.none]) expect(speech.said).not.toContain(l);
  });

  test("the movie speaks nothing extra", async () => {
    const { player, speech } = makePlayer([cardsAsk(DRY)], { feedback: "dry" });
    (player as unknown as { autoAnswers: boolean }).autoAnswers = true;
    await player.play();
    for (const l of [DRY.perfect, DRY.poor, DRY.none]) expect(speech.said).not.toContain(l);
    const all = Object.values(FALLBACK_LINES.dry).flat();
    expect(speech.said.some((s) => all.includes(s))).toBe(false);
  });

  test("a cast-level style in English: a fallback line after the author's", async () => {
    const { player, speech } = makePlayer([cardsAsk()], { feedback: "dry", lang: "en" });
    player.askGate = async () => oneRight;
    await player.play();
    const i = speech.said.indexOf("Aspirin thins, insulin lowers.");
    expect(FALLBACK_LINES.dry.poor).toContain(speech.said[i + 1]);
  });

  test("a Norwegian cast with a style but no lines of its own: nothing extra", async () => {
    const { player, speech } = makePlayer([cardsAsk()], { feedback: "dry", lang: "nb" });
    player.askGate = async () => oneRight;
    await player.play();
    expect(speech.said[speech.said.length - 1]).toBe("Aspirin thins, insulin lowers.");
  });

  test("a guess: a close miss is good; {vars} are substituted", async () => {
    const ask: Command = { ask: { question: "How much?", on: "bar_2", store: "g", right: "Close.", wrong: "It is {g.true}.", feedback: { style: "warm", good: "{g} — nearly there." } } };
    const { player, speech } = makePlayer([ask]);
    player.askGate = async () => "65"; // 15 % of the range off: within twice the tolerance
    await player.play();
    const i = speech.said.indexOf("It is 80.");
    expect(speech.said[i + 1]).toBe("65 — nearly there.");
  });

  test("a typed check ask: right is perfect, wrong is none", async () => {
    const fb = { style: "dry" as const, perfect: "Show-off.", none: "Bold." };
    const right = makePlayer([{ ask: { question: "2+2?", answer: "4", right: "Four.", feedback: fb } }]);
    right.player.askGate = async () => "4";
    await right.player.play();
    expect(right.speech.said.slice(-2)).toEqual(["Four.", "Show-off."]);
    const wrong = makePlayer([{ ask: { question: "2+2?", answer: "4", right: "Four.", wrong: "No.", feedback: fb } }]);
    wrong.player.askGate = async () => "5";
    await wrong.player.play();
    expect(wrong.speech.said.slice(-2)).toEqual(["Four.", "Bold."]);
  });

  test("a quiz: a right pick is perfect, a wrong one none, a skip nothing", async () => {
    const quiz = (): Command => ({ quiz: { question: "Which?", choices: ["one", "two"], correct: 2, right: "Two.", feedback: { style: "dry", perfect: "Show-off.", none: "Bold." } } });
    const r = makePlayer([quiz()]);
    r.player.quizGate = async () => 1;
    await r.player.play();
    expect(r.speech.said[r.speech.said.length - 1]).toBe("Show-off.");
    const w = makePlayer([quiz()]);
    w.player.quizGate = async () => 0;
    await w.player.play();
    expect(w.speech.said[w.speech.said.length - 1]).toBe("Bold.");
    const s = makePlayer([quiz()]);
    s.player.quizGate = async () => null;
    await s.player.play();
    expect(s.speech.said).not.toContain("Bold.");
  });

  test("no repeat within a cast: two poor answers, two different fallback lines", async () => {
    const { player, speech } = makePlayer([cardsAsk(), cardsAsk()], { feedback: "dry" });
    player.askGate = async () => oneRight;
    await player.play();
    const said = speech.said.filter((s) => FALLBACK_LINES.dry.poor.includes(s));
    expect(said).toHaveLength(2);
    expect(said[0]).not.toBe(said[1]);
  });
});
