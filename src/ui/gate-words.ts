// The words the figure gates say themselves — the hint in the answer dock,
// Answer, Skip, a field's label — in the cast's own language (round 5 fix
// wave, M2): a Norwegian cast said "Click where you think it is" beside its
// own Norwegian lines. English, unless the cast is written in Norwegian
// (spec.lang nb / no / nn — or, with no lang, its lines read as Norwegian). One table, so a gate can never mix the two.

import type { RenderHandle } from "../render";
import { castLang } from "../render/quiz-words";

export type GateLang = "en" | "nb";

/** The gate language for a cast's `lang` (anything Norwegian is nb). */
export function gateLang(lang: string | null | undefined): GateLang {
  const l = (lang ?? "").toLowerCase();
  return l === "nb" || l === "no" || l === "nn" || /^(nb|no|nn)[-_]/.test(l) ? "nb" : "en";
}

/** The gate language of the cast a gate is mounted for: its lang, else what
 *  its lines read as (castLang); no handle: English. */
export function gateLangOf(hd: RenderHandle | null | undefined): GateLang {
  return gateLang(hd?.spec ? castLang(hd.spec as Parameters<typeof castLang>[0]) : null);
}

export interface GateWords {
  answer: string;
  skip: string;
  /** A select's Answer under check: each (round 7 §3.2), and connect's. */
  done: string;
  /** The reorder's row of the viewer's own order (round 7 §4). */
  yours: string;
  /** connect: press a star and drag; a click on a line removes it. */
  connect: string;
  typeNumber: string;
  guessFor(label: string): string;
  /** guess: one hint per handle kind, and the two composite ones. */
  guess: {
    height: string;
    curve: string;
    angle: string;
    count: string;
    point: string;
    market: string;
    bars: string;
    edges: string;
  };
  /** "{hint} — let go to answer" */
  letGo(hint: string): string;
  /** "{hint}, then Answer" */
  thenAnswer(hint: string): string;
  /** A budget's account bar, when the cast gives it no account_label. */
  account: string;
  /** A budget not yet balanced: what is left or over. */
  budgetLeft(n: string): string;
  budgetOver(n: string): string;
  /** cards: one hint per mode. */
  cards: Record<string, string>;
  formula: { number: string; one: string; many: string };
  tree: { blanks: string; branch: string; nowBranch: string };
  dragNames: string;
  /** choose: tap one of the drawn options. */
  choose: string;
}

const EN: GateWords = {
  answer: "Answer ▸",
  skip: "Skip ▸",
  done: "Done ▸",
  yours: "yours",
  connect: "Press a star and drag to the next. Click a line to remove it",
  typeNumber: "Type a number",
  guessFor: (label) => `Your guess for ${label}`,
  guess: {
    height: "Drag the bar to your guess",
    curve: "Draw the rest of the line",
    angle: "Drag the slice's edge",
    count: "Drag across the people",
    point: "Click where you think it is",
    market: "Drag the middle to move it, an end to turn it",
    bars: "Drag each bar to your guess",
    edges: "Drag the edges between the slices",
  },
  letGo: (hint) => `${hint} — let go to answer`,
  thenAnswer: (hint) => `${hint}, then Answer`,
  account: "Left",
  budgetLeft: (n) => `Balance the budget: ${n} left`,
  budgetOver: (n) => `Balance the budget: ${n} over`,
  cards: {
    rank: "Drag the cards into order",
    sort: "Tap or drag each card into its box",
    sortEach: "Tap a box, or drag a card",
    select: "Tap the cards that belong in the box",
    selectEach: "Tap the cards that belong, then Done",
    deck: "Tap the box this card goes in (or press 1, 2, …)",
    place: "Drag each card onto the line",
    match: "Drag each card to its partner",
    compare: "Tap one in each pair",
    decide: "Choose one",
    fill: "Tap or drag a tile into each box",
  },
  formula: {
    number: "Tap the box and type the number",
    one: "Tap the box and type what goes in it",
    many: "Tap a box and type what goes in it",
  },
  tree: { blanks: "Tap a ? and type the number", branch: "Tap the best branch", nowBranch: "Now tap the best branch" },
  dragNames: "Drag each name onto the figure ▸",
  choose: "Tap your choice on the figure",
};

const NB: GateWords = {
  answer: "Svar ▸",
  skip: "Hopp over ▸",
  done: "Ferdig ▸",
  yours: "din",
  connect: "Trykk på en stjerne og dra til den neste. Klikk på en linje for å fjerne den",
  typeNumber: "Skriv et tall",
  guessFor: (label) => `Ditt gjett for ${label}`,
  guess: {
    height: "Dra søylen dit du tror",
    curve: "Tegn resten av linjen",
    angle: "Dra kanten på kakestykket",
    count: "Dra over personene",
    point: "Klikk der du tror det er",
    market: "Dra midten for å flytte, en ende for å vri",
    bars: "Dra hver søyle dit du tror",
    edges: "Dra kantene mellom kakestykkene",
  },
  letGo: (hint) => `${hint} – slipp for å svare`,
  thenAnswer: (hint) => `${hint}, og trykk Svar`,
  account: "Igjen",
  budgetLeft: (n) => `Fordel budsjettet: ${n} igjen`,
  budgetOver: (n) => `Fordel budsjettet: ${n} for mye`,
  cards: {
    rank: "Dra kortene i riktig rekkefølge",
    sort: "Trykk eller dra hvert kort til riktig boks",
    sortEach: "Trykk på en boks, eller dra et kort",
    select: "Trykk på kortene som hører hjemme i boksen",
    selectEach: "Trykk på kortene som hører hjemme, og trykk Ferdig",
    deck: "Trykk på boksen kortet hører til (eller 1, 2, …)",
    place: "Dra hvert kort på linjen",
    match: "Dra hvert kort til partneren sin",
    compare: "Trykk på ett i hvert par",
    decide: "Velg ett",
    fill: "Trykk eller dra en brikke til hver boks",
  },
  formula: {
    number: "Trykk på boksen og skriv tallet",
    one: "Trykk på boksen og skriv det som skal stå der",
    many: "Trykk på en boks og skriv det som skal stå der",
  },
  tree: { blanks: "Trykk på et ? og skriv tallet", branch: "Trykk på den beste grenen", nowBranch: "Trykk nå på den beste grenen" },
  dragNames: "Dra hvert navn til figuren ▸",
  choose: "Trykk på valget ditt i figuren",
};

export function gateWords(lang: GateLang): GateWords {
  return lang === "nb" ? NB : EN;
}

/** A number as the dock says it — shared with the account bar (guess/numbers.ts). */
export { dockNumber } from "../guess/numbers";
import { dockNumber } from "../guess/numbers";

/**
 * The dock's line for a budget not yet balanced (spec 2026-10-03 §5, L6):
 * `account` is what is left (negative: over). With the cast's own account
 * label ("Hours left") it says "Hours left: 22" / "Hours left: −4.8", as the
 * account bar does; without one, "Balance the budget: 22 left / 4.8 over".
 */
export function budgetLine(words: GateWords, account: number, formatted: string, label: string | null): string {
  const n = dockNumber(formatted);
  if (label) return `${label}: ${account < 0 ? "−" : ""}${n}`;
  return account < 0 ? words.budgetOver(n) : words.budgetLeft(n);
}
