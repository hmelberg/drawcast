// What a live viewer hears after a RIGHT quiz answer (Hans 2026-10-04:
// "Correct" doesn't sound good — vary it, pick at random, sometimes a dry
// joke). Still never the `right` explanation again (Hans 2026-09-27): one
// short affirmation, in the cast's language.
//
// The rules, in order:
// - `affirm` on the cast: false says nothing, "playful" jokes now and then
//   even with no feedback block, "plain" the old single word
//   (quiz-words.ts correctWord), a list of phrases is the cast's own pool;
// - a streak line when it fits: the last question of the cast with every
//   answer right ("A clean sweep."), two/three/… in a row, or "Back on track."
//   after a miss — each sometimes, not always;
// - a joke, only in a cast whose feedback asks for flavour (warm ≈ 1 in 5,
//   dry ≈ 1 in 3), never twice in a row, and never when a dry band line is
//   about to follow (that line is the joke). A cast with no feedback block
//   may be on a serious topic: no jokes there.
// - else a plain phrase (a warm cast leans on the warm ones).
// No phrase twice in a row (across the session's players), and none that
// repeats the band line that may follow ("Exactly." before "Exactly right.").
//
// The random source is injected, so tests (and anything that must replay)
// seed it. Movies and exports never come here: they answer for the viewer
// and read `right` (player.ts, export/video.ts collectSpeakLines).
import { isEnglish, resolveFeedback, type FeedbackSpec } from "../feedback/bands";
import { FALLBACK_LINES } from "../feedback/lines";
import { castLang, correctWord } from "./quiz-words";
import { detectLang } from "./speech";

export type AffirmSetting = "plain" | "playful" | string[] | false;

interface StreakWords {
  two: string;
  three: string;
  /** Three right out of three asked. */
  threeOfThree: string;
  four: string;
  five: string;
  /** Four or more in a row. */
  roll: string;
  /** Right straight after a miss. */
  back: string;
  /** The cast's last question, every answer right. */
  sweep: string[];
}

interface Pools {
  plain: string[];
  /** Warmer phrases: a warm cast picks among them half the time. */
  warm: string[];
  /** Dry jokes; empty where we are not sure of the idiom. */
  humour: string[];
  streak: StreakWords;
}

export const AFFIRM: Record<string, Pools> = {
  en: {
    plain: ["Yes.", "Right.", "That's it.", "Exactly.", "Spot on.", "You got it.", "Quite right.", "Bang on.", "That's the one.", "Indeed."],
    warm: ["Yes — well done.", "Nicely done.", "Well done.", "Lovely."],
    humour: ["Suspiciously good.", "Have you done this before?", "Right — and without peeking.", "Yes. Show-off.", "Correct, annoyingly.", "Fine, you knew that one."],
    streak: { two: "Two in a row.", three: "Three in a row.", threeOfThree: "Three for three.", four: "Four in a row.", five: "Five in a row.", roll: "On a roll.", back: "Back on track.", sweep: ["A clean sweep.", "Full marks."] },
  },
  nb: {
    plain: ["Ja.", "Riktig.", "Akkurat.", "Helt rett.", "Der satt den.", "Stemmer.", "Nettopp.", "Helt riktig."],
    warm: ["Bra jobba.", "Godt svart.", "Flott."],
    humour: ["Mistenkelig bra.", "Har du gjort dette før?", "Ja. Skrytepave.", "Irriterende riktig.", "Den kunne du, ja."],
    streak: { two: "To på rad.", three: "Tre på rad.", threeOfThree: "Tre av tre.", four: "Fire på rad.", five: "Fem på rad.", roll: "Nå glir det.", back: "Tilbake på sporet.", sweep: ["Alt riktig.", "Full pott."] },
  },
  nn: {
    plain: ["Ja.", "Rett.", "Akkurat.", "Heilt rett.", "Der sat den.", "Stemmer.", "Nettopp."],
    warm: ["Bra jobba.", "Godt svara.", "Flott."],
    humour: ["Mistenkeleg bra.", "Har du gjort dette før?"],
    streak: { two: "To på rad.", three: "Tre på rad.", threeOfThree: "Tre av tre.", four: "Fire på rad.", five: "Fem på rad.", roll: "No glid det.", back: "Tilbake på sporet.", sweep: ["Alt rett.", "Full pott."] },
  },
  sv: {
    plain: ["Ja.", "Rätt.", "Precis.", "Helt rätt.", "Just det.", "Det stämmer.", "Exakt."],
    warm: ["Snyggt.", "Bra jobbat.", "Fint."],
    humour: ["Misstänkt bra.", "Ja. Skrytmåns.", "Irriterande rätt."],
    streak: { two: "Två i rad.", three: "Tre i rad.", threeOfThree: "Tre av tre.", four: "Fyra i rad.", five: "Fem i rad.", roll: "Det rullar på.", back: "Tillbaka på banan.", sweep: ["Alla rätt.", "Full pott."] },
  },
  da: {
    plain: ["Ja.", "Rigtigt.", "Præcis.", "Helt rigtigt.", "Lige præcis.", "Det passer.", "Netop."],
    warm: ["Godt klaret.", "Flot.", "Godt gået."],
    humour: ["Mistænkeligt godt.", "Irriterende rigtigt."],
    streak: { two: "To i træk.", three: "Tre i træk.", threeOfThree: "Tre ud af tre.", four: "Fire i træk.", five: "Fem i træk.", roll: "Det kører.", back: "Tilbage på sporet.", sweep: ["Alle rigtige.", "Fuld plade."] },
  },
  de: {
    plain: ["Ja.", "Richtig.", "Genau.", "Stimmt.", "Ganz genau.", "Volltreffer.", "Exakt."],
    warm: ["Gut gemacht.", "Sehr schön.", "Prima."],
    humour: ["Verdächtig gut.", "Ja. Angeber.", "Ärgerlich richtig."],
    streak: { two: "Zwei in Folge.", three: "Drei in Folge.", threeOfThree: "Drei von drei.", four: "Vier in Folge.", five: "Fünf in Folge.", roll: "Du bist in Fahrt.", back: "Wieder auf Kurs.", sweep: ["Alles richtig.", "Volle Punktzahl."] },
  },
  nl: {
    plain: ["Ja.", "Goed.", "Precies.", "Klopt.", "Helemaal goed.", "Dat is 'm.", "Juist."],
    warm: ["Goed gedaan.", "Mooi zo.", "Knap."],
    humour: ["Verdacht goed.", "Ja. Opschepper."],
    streak: { two: "Twee op rij.", three: "Drie op rij.", threeOfThree: "Drie uit drie.", four: "Vier op rij.", five: "Vijf op rij.", roll: "Je bent op dreef.", back: "Weer op koers.", sweep: ["Alles goed.", "Foutloos."] },
  },
  fr: {
    plain: ["Oui.", "Exact.", "C'est ça.", "Tout à fait.", "Exactement.", "Bien vu.", "C'est juste."],
    warm: ["Bravo.", "Bien joué.", "Très bien."],
    humour: [],
    streak: { two: "Deux d'affilée.", three: "Trois d'affilée.", threeOfThree: "Trois sur trois.", four: "Quatre d'affilée.", five: "Cinq d'affilée.", roll: "Belle série.", back: "De retour sur les rails.", sweep: ["Sans faute.", "Tout juste."] },
  },
  es: {
    plain: ["Sí.", "Correcto.", "Exacto.", "Eso es.", "Así es.", "Exactamente.", "Justo."],
    warm: ["Muy bien.", "Bien hecho.", "Bravo."],
    humour: [],
    streak: { two: "Dos seguidas.", three: "Tres seguidas.", threeOfThree: "Tres de tres.", four: "Cuatro seguidas.", five: "Cinco seguidas.", roll: "Estás en racha.", back: "De vuelta al buen camino.", sweep: ["Pleno.", "Todas bien."] },
  },
  it: {
    plain: ["Sì.", "Esatto.", "Giusto.", "Proprio così.", "Esattamente.", "Corretto.", "Perfetto."],
    warm: ["Ben fatto.", "Ottimo.", "Molto bene."],
    humour: [],
    streak: { two: "Due di fila.", three: "Tre di fila.", threeOfThree: "Tre su tre.", four: "Quattro di fila.", five: "Cinque di fila.", roll: "Che serie.", back: "Di nuovo in carreggiata.", sweep: ["Tutte giuste.", "Percorso netto."] },
  },
  pt: {
    plain: ["Sim.", "Correto.", "Exato.", "Isso mesmo.", "É isso.", "Exatamente.", "Certíssimo."],
    warm: ["Muito bem.", "Boa.", "Bem feito."],
    humour: [],
    streak: { two: "Duas seguidas.", three: "Três seguidas.", threeOfThree: "Três em três.", four: "Quatro seguidas.", five: "Cinco seguidas.", roll: "Que sequência.", back: "De volta ao caminho certo.", sweep: ["Tudo certo.", "Sem erros."] },
  },
  fi: {
    plain: ["Kyllä.", "Oikein.", "Juuri niin.", "Aivan.", "Täsmälleen.", "Niin on.", "Juuri näin."],
    warm: ["Hyvin tehty.", "Hienoa.", "Hyvä."],
    humour: [],
    streak: { two: "Kaksi putkeen.", three: "Kolme putkeen.", threeOfThree: "Kolme kolmesta.", four: "Neljä putkeen.", five: "Viisi putkeen.", roll: "Hyvä putki.", back: "Taas oikeilla raiteilla.", sweep: ["Kaikki oikein.", "Täydet pisteet."] },
  },
  pl: {
    plain: ["Tak.", "Dobrze.", "Właśnie tak.", "Zgadza się.", "Dokładnie.", "Słusznie.", "Tak jest."],
    warm: ["Świetnie.", "Bardzo dobrze.", "Brawo."],
    humour: [],
    streak: { two: "Dwie z rzędu.", three: "Trzy z rzędu.", threeOfThree: "Trzy na trzy.", four: "Cztery z rzędu.", five: "Pięć z rzędu.", roll: "Dobra passa.", back: "Znowu na dobrej drodze.", sweep: ["Wszystko dobrze.", "Komplet punktów."] },
  },
};
AFFIRM.no = AFFIRM.nb;

function codeOf(lang: string | null | undefined, question: string): string {
  const code = (lang ?? detectLang(question)).toLowerCase().split(/[-_]/)[0];
  return AFFIRM[code] ? code : "en";
}

/** The cast's `affirm`, validated: anything else reads as unset (the default). */
export function parseAffirm(v: unknown): AffirmSetting | undefined {
  if (v === false || v === "plain" || v === "playful") return v;
  if (Array.isArray(v)) {
    const own = v.filter((s): s is string => typeof s === "string").map((s) => s.trim()).filter((s) => s !== "");
    return own.length > 0 ? own : undefined;
  }
  return undefined;
}

const words = (s: string): string => ` ${s.toLowerCase().replace(/[^\p{L}\p{N}']+/gu, " ").trim()} `;

/** The band line that may follow a right answer (feedback/bands.ts pickLine's "perfect" pool). */
function bandAfter(fb: FeedbackSpec | undefined, lang: string | null): string[] {
  if (!fb || fb.style === "plain") return [];
  return fb.lines.perfect ?? (isEnglish(lang) ? FALLBACK_LINES[fb.style].perfect : []);
}

/** Drop the phrases a following band line would echo ("Exactly." before "Exactly right."). */
function notEchoed(pool: readonly string[], after: readonly string[]): string[] {
  const later = after.map(words);
  return pool.filter((p) => !later.some((l) => l.includes(words(p))));
}

/**
 * The chance of trying a joke on a right answer. Never twice in a row, so the
 * share of right answers that get one is p / (1 + p): warm 0.25 → 1 in 5,
 * dry 0.5 → 1 in 3. No feedback (or plain): none — we cannot tell a light
 * cast from a serious one. A dry band line about to follow is the joke.
 */
export function humourChance(fb: FeedbackSpec | undefined, lang: string | null): number {
  if (!fb || fb.style === "plain") return 0;
  if (fb.style === "dry") return bandAfter(fb, lang).length > 0 ? 0 : 0.5;
  return 0.25;
}

/** The plain phrases this feedback style picks among: [first choice, the rest]. */
function plainPools(p: Pools, fb: FeedbackSpec | undefined, after: string[]): { warm: string[]; plain: string[] } {
  const warm = notEchoed(p.warm, after);
  const plain = notEchoed(p.plain, after);
  if (!fb || fb.style === "plain") return { warm: [], plain: [...plain, ...warm] };
  if (fb.style === "dry") return { warm: [], plain };
  return { warm, plain };
}

/** Where the viewer stands after this right answer (the player's tally). */
export interface AffirmMoment {
  /** Right answers in a row, this one included ({streak}). */
  streak: number;
  /** Right answers so far ({score}) and questions answered ({score_total}). */
  score: number;
  total: number;
  /** This is the cast's last question. */
  last: boolean;
}

/** What the session remembers between players: the last phrase said, and whether it was a joke. */
export interface AffirmMemory {
  last: string | null;
  joke: boolean;
}
const SESSION: AffirmMemory = { last: null, joke: false };

export class Affirmer {
  private setting: AffirmSetting | undefined;
  private questions = 0;

  constructor(
    private readonly rng: () => number = Math.random,
    private readonly memory: AffirmMemory = SESSION,
  ) {}

  /** Read the cast: its `affirm` and how many questions it asks (a streak needs two). */
  configure(spec: { affirm?: unknown; commands?: { quiz?: unknown; ask?: unknown }[] }): void {
    this.setting = parseAffirm(spec.affirm);
    this.questions = (spec.commands ?? []).filter((c) => c.quiz || c.ask).length;
  }

  private pick(pool: readonly string[]): string | null {
    const fresh = pool.filter((l) => l !== this.memory.last);
    const from = fresh.length > 0 ? fresh : pool;
    if (from.length === 0) return null;
    return from[Math.floor(this.rng() * from.length) % from.length];
  }

  private said(line: string | null, joke = false): string | null {
    if (line !== null) {
      this.memory.last = line;
      this.memory.joke = joke;
    }
    return line;
  }

  private streakLine(s: StreakWords, m: AffirmMoment): string | null {
    if (this.questions < 2) return null;
    const maybe = (p: number, line: string): string | null => (line !== this.memory.last && this.rng() < p ? line : null);
    if (m.last && m.total >= 3 && m.score === m.total) return this.pick(s.sweep);
    if (m.streak === 1 && m.total >= 2 && m.score < m.total) return maybe(0.4, s.back);
    if (m.streak === 2) return maybe(0.4, s.two);
    if (m.streak === 3) return maybe(0.5, m.total === 3 ? s.threeOfThree : s.three);
    if (m.streak === 4) return maybe(0.4, this.rng() < 0.5 ? s.four : s.roll);
    if (m.streak === 5) return maybe(0.4, this.rng() < 0.5 ? s.five : s.roll);
    if (m.streak > 5) return maybe(0.3, s.roll);
    return null;
  }

  /** The line for this right answer, or null (`affirm: false`). */
  say(lang: string | null, step: { question: string; feedback?: FeedbackSpec }, m: AffirmMoment): string | null {
    const setting = this.setting;
    if (setting === false) return null;
    if (setting === "plain") return correctWord(lang, step.question);
    if (Array.isArray(setting)) return this.said(this.pick(setting));
    const p = AFFIRM[codeOf(lang, step.question)];
    const streak = this.streakLine(p.streak, m);
    if (streak !== null) return this.said(streak);
    const after = bandAfter(step.feedback, lang);
    const jokes = notEchoed(p.humour, after);
    // `affirm: "playful"` (a light cast with no feedback block) jokes about one time in four.
    const chance = setting === "playful" ? Math.max(0.25, humourChance(step.feedback, lang)) : humourChance(step.feedback, lang);
    if (!this.memory.joke && jokes.length > 0 && this.rng() < chance) return this.said(this.pick(jokes), true);
    const { warm, plain } = plainPools(p, step.feedback, after);
    return this.said(this.pick(warm.length > 0 && this.rng() < 0.5 ? warm : plain));
  }
}

/**
 * Every affirmation a live viewer of this cast could hear — what a bake
 * records and a subtitle track translates, so a baked cast never drops to a
 * browser voice for "Spot on." Only the cast's language; nothing when it
 * has no quiz (the one place an affirmation is said).
 */
export function affirmLines(spec: {
  lang?: string | null;
  affirm?: unknown;
  feedback?: unknown;
  commands?: { speak?: string; quiz?: { question?: string; feedback?: unknown }; ask?: { question?: string; feedback?: unknown; choose?: unknown; answer?: unknown; say_question?: boolean } }[];
}): string[] {
  const commands = spec.commands ?? [];
  // A quiz, and a quiet choose ask (the on-canvas buttons' own form): the
  // two places the player says an affirmation (player.ts quiz, chooseAsk).
  const quizzes = commands.flatMap((c) => (c.quiz ? [c.quiz] : c.ask && Array.isArray(c.ask.choose) && c.ask.answer !== undefined && c.ask.say_question === false ? [c.ask] : []));
  if (quizzes.length === 0) return [];
  const setting = parseAffirm(spec.affirm);
  const lang = castLang(spec);
  const question = quizzes[0].question ?? "";
  if (setting === false) return [];
  if (setting === "plain") return [correctWord(lang, question)];
  if (Array.isArray(setting)) return setting;
  const p = AFFIRM[codeOf(lang, question)];
  const out = new Set<string>();
  for (const q of quizzes) {
    const raw = resolveFeedback(spec.feedback, q.feedback);
    // The plan drops a plain feedback with no reward (render/plan.ts feedbackOf).
    const fb = raw.style === "plain" && raw.reward === "none" ? undefined : raw;
    const after = bandAfter(fb, lang);
    const { warm, plain } = plainPools(p, fb, after);
    for (const l of [...warm, ...plain]) out.add(l);
    if (setting === "playful" || humourChance(fb, lang) > 0) for (const l of notEchoed(p.humour, after)) out.add(l);
  }
  if (commands.filter((c) => c.quiz || c.ask).length >= 2) {
    const s = p.streak;
    for (const l of [s.two, s.three, s.threeOfThree, s.four, s.five, s.roll, s.back, ...s.sweep]) out.add(l);
  }
  return [...out];
}

