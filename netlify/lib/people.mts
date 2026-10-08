// netlify/lib/people.mts
// The photo people a thumbnail can show (2026-10-07): generated chest-up
// portraits, cut out on transparent backgrounds (scripts/build-thumb-people.mjs),
// in public/thumb-people/<id>.png. A cast names one in plain words —
//
//   thumb: band "Wait, what?" person man 45 bald surprised
//   thumb: person woman 19 puzzled
//   thumb: person annoyed
//   thumb: person everyday talking      (an ordinary person, speaking to camera)
//   thumb: person quirky man 60
//
// — and the nearest match is drawn: a word no picture has is let go (looks
// first, then age, then sex; the expression last), and among equals the
// cast's title picks, so a cast keeps its person. Adding a picture is a file
// and a line below; no code changes. Pure: no fs, no DOM.

export type Sex = "man" | "woman";
/** polished: the reaction-photo look; everyday: ordinary people, as if filming themselves (Hans, 2026-10-07). */
export type Style = "polished" | "everyday";

export interface Person {
  id: string;
  sex: Sex;
  age: number;
  /** Plain look words: bald, beard, glasses, grey, curly, long, … */
  looks: string[];
  expression: string;
  style: Style;
  /** Which way the person looks, as the viewer sees it; front: into the camera. */
  faces: "left" | "right" | "front";
  /** The cut-out's pixel size. */
  w: number;
  h: number;
}

export const PEOPLE: readonly Person[] = [
  { id: "m45-surprised", sex: "man", age: 45, looks: ["bald", "beard"], expression: "surprised", style: "polished", faces: "left", w: 561, h: 640 },
  { id: "f19-surprised", sex: "woman", age: 19, looks: ["long", "brown"], expression: "surprised", style: "polished", faces: "right", w: 500, h: 640 },
  { id: "m9-surprised", sex: "man", age: 9, looks: ["dark", "freckles"], expression: "surprised", style: "polished", faces: "left", w: 517, h: 640 },
  { id: "f72-surprised", sex: "woman", age: 72, looks: ["grey", "white", "glasses"], expression: "surprised", style: "polished", faces: "right", w: 518, h: 640 },
  { id: "m28-surprised", sex: "man", age: 28, looks: ["black", "curly", "beard"], expression: "surprised", style: "polished", faces: "left", w: 524, h: 640 },
  { id: "f35-surprised", sex: "woman", age: 35, looks: ["black", "long"], expression: "surprised", style: "polished", faces: "right", w: 533, h: 640 },
  { id: "m60-surprised", sex: "man", age: 60, looks: ["grey", "moustache"], expression: "surprised", style: "polished", faces: "left", w: 529, h: 640 },
  { id: "f16-surprised", sex: "woman", age: 16, looks: ["black", "ponytail"], expression: "surprised", style: "polished", faces: "right", w: 490, h: 640 },
  { id: "f19-puzzled", sex: "woman", age: 19, looks: ["red", "curly"], expression: "puzzled", style: "polished", faces: "right", w: 532, h: 640 },
  { id: "m45-puzzled", sex: "man", age: 45, looks: ["brown", "glasses"], expression: "puzzled", style: "polished", faces: "right", w: 547, h: 640 },
  // Everyday people (2026-10-08): ordinary faces talking into the camera.
  { id: "e-m52-talking", sex: "man", age: 52, looks: ["grey", "beard"], expression: "talking", style: "everyday", faces: "front", w: 478, h: 640 },
  { id: "e-f38-talking", sex: "woman", age: 38, looks: ["brown", "dark"], expression: "talking", style: "everyday", faces: "front", w: 531, h: 640 },
  { id: "e-m24-talking", sex: "man", age: 24, looks: ["beard", "brown"], expression: "talking", style: "everyday", faces: "front", w: 575, h: 640 },
  { id: "e-f67-talking", sex: "woman", age: 67, looks: ["grey", "short", "curly", "glasses"], expression: "talking", style: "everyday", faces: "front", w: 547, h: 640 },
  { id: "e-m40-neutral", sex: "man", age: 40, looks: ["short", "brown"], expression: "neutral", style: "everyday", faces: "front", w: 598, h: 640 },
  { id: "e-f29-neutral", sex: "woman", age: 29, looks: ["brown", "ponytail"], expression: "neutral", style: "everyday", faces: "front", w: 594, h: 640 },
  { id: "e-m70-neutral", sex: "man", age: 70, looks: ["white", "grey", "beard"], expression: "neutral", style: "everyday", faces: "front", w: 619, h: 640 },
  { id: "e-f55-skeptical", sex: "woman", age: 55, looks: ["grey", "glasses"], expression: "skeptical", style: "everyday", faces: "front", w: 517, h: 640 },
  { id: "e-m33-skeptical", sex: "man", age: 33, looks: ["short", "dark"], expression: "skeptical", style: "everyday", faces: "front", w: 514, h: 640 },
  { id: "e-f45-smiling", sex: "woman", age: 45, looks: ["brown", "curly"], expression: "smiling", style: "everyday", faces: "front", w: 544, h: 640 },
];

/** What a cast asked for. */
export interface PersonAsk {
  style?: Style;
  sex?: Sex;
  age?: number;
  looks: string[];
  expression?: string;
}

const SEX_WORDS: Record<string, Sex> = { man: "man", male: "man", boy: "man", guy: "man", woman: "woman", female: "woman", girl: "woman", lady: "woman" };
/** Age words, as the age they stand for. boy and girl are children too. */
const AGE_WORDS: Record<string, number> = { child: 9, kid: 9, boy: 9, girl: 9, teen: 16, teenager: 16, young: 22, adult: 35, middle: 45, older: 62, old: 70, elderly: 72, senior: 72 };
/** Expressions the cast may name, as the pictures' own word. */
const EXPRESSIONS: Record<string, string> = {
  surprised: "surprised", shocked: "surprised", amazed: "surprised", wow: "surprised",
  puzzled: "puzzled", confused: "puzzled", unsure: "puzzled",
  annoyed: "annoyed", irritated: "annoyed", grumpy: "annoyed", angry: "annoyed",
  laughing: "laughing", happy: "laughing", amused: "laughing",
  thinking: "thinking", skeptical: "skeptical", doubtful: "skeptical", worried: "worried",
  talking: "talking", speaking: "talking", explaining: "talking", neutral: "neutral", calm: "neutral", serious: "neutral",
  smiling: "smiling", friendly: "smiling",
};
const STYLE_WORDS: Record<string, Style> = { everyday: "everyday", ordinary: "everyday", normal: "everyday", regular: "everyday", average: "everyday", real: "everyday", quirky: "everyday", odd: "everyday", eccentric: "everyday", polished: "polished" };
/** Style words that also ask for a look. */
const STYLE_LOOKS: Record<string, string> = { quirky: "quirky", odd: "quirky", eccentric: "quirky" };
const LOOKS = new Set(["quirky", "bald", "beard", "glasses", "grey", "gray", "white", "curly", "long", "short", "brown", "black", "blond", "red", "dark", "moustache", "mustache", "ponytail", "freckles", "braids"]);
const LOOK_SAME: Record<string, string> = { gray: "grey", mustache: "moustache" };

/** Whether a word, after `person`, belongs to it. */
export function isPersonWord(w: string): boolean {
  return w in STYLE_WORDS || w in SEX_WORDS || w in AGE_WORDS || w in EXPRESSIONS || LOOKS.has(w) || /^\d{1,2}s?$/.test(w);
}

/** A person's words, read (unknown words are the caller's). */
export function readPersonWords(words: readonly string[]): PersonAsk {
  const ask: PersonAsk = { looks: [] };
  for (const w of words) {
    if (w in STYLE_WORDS) ask.style = STYLE_WORDS[w];
    if (w in STYLE_LOOKS && !ask.looks.includes(STYLE_LOOKS[w])) ask.looks.push(STYLE_LOOKS[w]);
    if (w in SEX_WORDS) ask.sex = SEX_WORDS[w];
    if (w in AGE_WORDS) ask.age = AGE_WORDS[w];
    else if (/^\d{1,2}s$/.test(w)) ask.age = Number(w.slice(0, -1)) + 5;
    else if (/^\d{1,2}$/.test(w)) ask.age = Number(w);
    if (w in EXPRESSIONS) ask.expression = EXPRESSIONS[w];
    if (LOOKS.has(w)) {
      const l = LOOK_SAME[w] ?? w;
      if (!ask.looks.includes(l)) ask.looks.push(l);
    }
  }
  return ask;
}

/** The ask as canonical words (sex, age, looks, expression). */
export function printPerson(ask: PersonAsk): string[] {
  return [...(ask.style === "everyday" ? ["everyday"] : []), ...(ask.sex ? [ask.sex] : []), ...(ask.age !== undefined ? [String(ask.age)] : []), ...ask.looks, ...(ask.expression ? [ask.expression] : [])];
}

/** A small stable hash (FNV-1a) of a string. */
export function hashOf(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * The picture nearest the ask. Each wish narrows the choice only while some
 * picture still meets it, in order: style (polished unless asked),
 * expression, sex, age (the nearest ages), then looks (the most of them);
 * `seed` picks among what is left.
 */
export function pickPerson(ask: PersonAsk, seed = "", people: readonly Person[] = PEOPLE): Person {
  let left = [...people];
  const narrow = (keep: (p: Person) => boolean): void => {
    const next = left.filter(keep);
    if (next.length) left = next;
  };
  narrow((p) => p.style === (ask.style ?? "polished"));
  if (ask.expression) narrow((p) => p.expression === ask.expression);
  if (ask.sex) narrow((p) => p.sex === ask.sex);
  if (ask.age !== undefined) {
    const best = Math.min(...left.map((p) => Math.abs(p.age - ask.age!)));
    narrow((p) => Math.abs(p.age - ask.age!) <= best + 4);
  }
  if (ask.looks.length) {
    const score = (p: Person): number => ask.looks.filter((l) => p.looks.includes(l)).length;
    const best = Math.max(...left.map(score));
    if (best > 0) narrow((p) => score(p) === best);
  }
  return left[hashOf(seed) % left.length];
}

export function personById(id: string | undefined): Person | undefined {
  return id ? PEOPLE.find((p) => p.id === id) : undefined;
}
