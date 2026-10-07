// netlify/lib/thumb.mts
// The listing picture (thumbnail round, 2026-10-04): the poster a cast
// publishes, with words, a figure and marks drawn over it. The cast carries
// one line in its header — plain words in any order, quoted words where a
// layer takes them:
//
//   thumb: band "It's not the shark" stamp "MYTH?" star
//   thumb: burst "The Moon is falling" seal arrow surprised
//   thumb: question eyes
//
// and the SITE draws the picture — here, as one SVG string — so a style
// change never means republishing. /card/<name>.png renders it
// (thumb-render.mts) for the front page and every link preview alike; the
// publish panel previews the very same SVG. Pure: no fetch, no fonts, no DOM.
//
//   words   band (the tilted yellow strip, the default) · burst (big comic
//           lettering) · question (the question card) · none
//   figure  eyes (peeking over the band) · aha surprised puzzled thinking
//           (cartoon busts, for children's casts) · noface
//   marks   note "…" · stamp "…" · star "…" (default ?!) · bang (!!) ·
//           seal (not clickbait) · arrow — any number, combined
//   title "…"  the listing title, when it should differ from the title card's
//   poster · image "https://…"  the picture under the words (default: the drawing)
//   background (2026-10-07)  paper (the default) · card [surface] (the
//           picture on a white card, tilted, on a desk: charcoal navy wood
//           cork teal or a colour; card alone, a surface the title picks) ·
//           notebook (ruled page) · graph (squared paper) · chalkboard (the
//           picture in chalk). Behind the picture, never over it: on a card
//           the picture keeps its paper; on a page or board its paper is
//           see-through (paper-key.mts) or not drawn.
//   person … (2026-10-07)  a photo person beside the picture (people.mts):
//           person man 45 bald surprised · person woman 19 puzzled · person

import { hashOf, isPersonWord, personById, pickPerson, printPerson, readPersonWords, type Person } from "./people.mts";

export const WORD_STYLES = ["band", "burst", "question", "none"] as const;
export type WordStyle = (typeof WORD_STYLES)[number];
export const KID_FIGURES = ["aha", "surprised", "puzzled", "thinking"] as const;
export const FIGURES = ["eyes", ...KID_FIGURES] as const;
export type Figure = (typeof FIGURES)[number] | "none";
export const MARKS = ["note", "stamp", "star", "bang", "seal", "arrow"] as const;
export type MarkKind = (typeof MARKS)[number];
export interface Mark {
  kind: MarkKind;
  words?: string;
  /** Where the author put it (a thumbnail page's `mark` element, 2026-10-05): the
   *  mark's centre on the 1000 × 750 canvas, SVG space (y down); absent, a corner. */
  at?: [number, number];
  /** Degrees, clockwise. */
  rotate?: number;
}
/** The marks that carry words, and what they say when the author wrote none. */
export const MARK_WORDS: Partial<Record<MarkKind, string>> = { note: "wait, what?", stamp: "PLOT TWIST", star: "?!" };

export const HEADLINE_MAX = 60;
export const QUESTION_MAX = 90;
export const LISTING_TITLE_MAX = 120;
export const WORDS_MAX = 24;

/** What a cast's line says, parsed. Absent fields are the site's to decide. */
export interface ThumbParts {
  words?: WordStyle;
  /** band / burst's words (a quoted string after band or burst, or with no keyword). */
  headline?: string;
  /** question's words. */
  question?: string;
  figure?: Figure;
  marks: Mark[];
  title?: string;
  /**
   * The picture under the words (2026-10-06): absent, the thumbnail as drawn
   * from text — the default, nothing downloaded; `poster`, the cast's own
   * poster; or an image's https address (pictureAllowed says which hosts).
   */
  picture?: "poster" | string;
  /** The background as canonical words: paper, `card <surface>`, notebook, graph, chalkboard. */
  bg?: string;
  /** A photo person, by plain words (people.mts); [] for anyone. */
  person?: string[];
}

/**
 * Whether an image may stand under a thumbnail: the author's own GitHub
 * (Pages, raw, jsDelivr) or Wikimedia Commons, https only — an image from
 * anywhere else would let that site see who opens the front page, and could
 * change or vanish.
 */
export function pictureAllowed(url: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== "https:") return false;
  const host = u.hostname.toLowerCase();
  return host.endsWith(".github.io") || host === "raw.githubusercontent.com" || (host === "cdn.jsdelivr.net" && u.pathname.startsWith("/gh/")) || host === "upload.wikimedia.org";
}

/** Every choice made: what is drawn. */
export interface ThumbPlan {
  words: WordStyle;
  headline?: string;
  question?: string;
  figure: Figure;
  marks: Mark[];
  /** The background (canonical words, as ThumbParts.bg; `card` with its surface chosen); absent, paper. */
  bg?: string;
  /** The photo person's id (people.mts). */
  person?: string;
}

const clean = (v: unknown, max: number): string | undefined => {
  if (typeof v !== "string") return undefined;
  const t = v.replace(/\s+/g, " ").trim();
  return t ? t.slice(0, max) : undefined;
};

/** The line's tokens: bare words, lower-cased, and "quoted strings" (straight or curly double quotes). */
function tokens(line: string): { word?: string; text?: string }[] {
  const out: { word?: string; text?: string }[] = [];
  const re = /"([^"]*)"|“([^”]*)”|([^\s"“”]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line))) {
    if (m[3] !== undefined) out.push({ word: m[3].toLowerCase().replace(/[,+]/g, "") });
    else out.push({ text: m[1] ?? m[2] ?? "" });
  }
  return out.filter((t) => t.text !== undefined || t.word);
}

/** A cast's line, read. Unknown words are listed (the panel greys them), never thrown. */
export function parseThumbLine(line: string): { parts: ThumbParts; unknown: string[] } {
  const parts: ThumbParts = { marks: [] };
  const unknown: string[] = [];
  const ts = tokens(line);
  for (let i = 0; i < ts.length; i++) {
    const t = ts[i];
    const next = ts[i + 1]?.text;
    const take = (max: number): string | undefined => {
      if (next === undefined) return undefined;
      i++;
      return clean(next, max);
    };
    if (t.text !== undefined) {
      // Words with no keyword before them: the headline (a band's words, the common case).
      if (parts.headline === undefined) parts.headline = clean(t.text, HEADLINE_MAX);
      continue;
    }
    const w = t.word!;
    if ((WORD_STYLES as readonly string[]).includes(w)) {
      parts.words = w as WordStyle;
      const text = w === "none" ? undefined : take(w === "question" ? QUESTION_MAX : HEADLINE_MAX);
      if (text && w === "question") parts.question = text;
      else if (text) parts.headline = text;
    } else if ((FIGURES as readonly string[]).includes(w) || w === "noface") {
      parts.figure = w === "noface" ? "none" : (w as Figure);
      if (parts.figure !== "none") delete parts.person;
    } else if ((MARKS as readonly string[]).includes(w)) {
      const words = MARK_WORDS[w as MarkKind] !== undefined ? take(WORDS_MAX) : undefined;
      parts.marks.push({ kind: w as MarkKind, ...(words ? { words } : {}) });
    } else if ((BACKGROUNDS as readonly string[]).includes(w)) {
      parts.bg = w;
      if (w === "card" && ts[i + 1]?.word !== undefined && ts[i + 1].word! in SURFACES) parts.bg = `card ${ts[++i].word}`;
    } else if (w === "person") {
      const ws: string[] = [];
      while (ts[i + 1]?.word !== undefined && isPersonWord(ts[i + 1].word!)) ws.push(ts[++i].word!);
      parts.person = printPerson(readPersonWords(ws));
      if (parts.figure !== undefined && parts.figure !== "none") delete parts.figure;
    } else if (w === "title") {
      const text = take(LISTING_TITLE_MAX);
      if (text) parts.title = text;
    } else if (w === "poster") {
      parts.picture = "poster";
    } else if (w === "image") {
      const url = next !== undefined ? (i++, next.trim()) : undefined;
      if (url && pictureAllowed(url)) parts.picture = url;
      else unknown.push(url ? `image ${url}` : "image");
    } else unknown.push(w);
  }
  return { parts, unknown };
}

const q = (s: string): string => `"${s.replace(/"/g, "'")}"`;

/** The parts as a canonical line (what is written into the header). */
export function printThumbLine(p: ThumbParts): string {
  const out: string[] = [];
  if (p.words) out.push(p.words);
  if (p.words === "question" && p.question) out.push(q(p.question));
  else if (p.headline && p.words !== "none" && p.words !== "question") out.push(q(p.headline));
  if (p.figure) out.push(p.figure === "none" ? "noface" : p.figure);
  if (p.person) out.push(["person", ...p.person].join(" "));
  if (p.bg) out.push(p.bg);
  for (const m of p.marks) out.push(m.words ? `${m.kind} ${q(m.words)}` : m.kind);
  if (p.title) out.push(`title ${q(p.title)}`);
  if (p.picture === "poster") out.push("poster");
  else if (p.picture) out.push(`image ${q(p.picture)}`);
  return out.join(" ");
}

// The first round's block (style/character/headline/question/title), still read.
const OLD_STYLE: Record<string, WordStyle> = { plain: "none", strip: "band", loud: "burst", question: "question" };

/** A header's `thumb:` value — the line, or the first round's block — as a canonical line; undefined when it says nothing. */
export function readThumb(raw: unknown): string | undefined {
  if (typeof raw === "string") {
    const line = printThumbLine(parseThumbLine(raw).parts);
    return line || undefined;
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const r = raw as Record<string, unknown>;
  const p: ThumbParts = { marks: [] };
  if (typeof r.style === "string" && OLD_STYLE[r.style]) p.words = OLD_STYLE[r.style];
  if (r.style === "loud") p.marks.push({ kind: "seal" }, { kind: "arrow" });
  if (typeof r.character === "string" && ((FIGURES as readonly string[]).includes(r.character) || r.character === "none")) p.figure = r.character as Figure;
  const headline = clean(r.headline, HEADLINE_MAX);
  if (headline) p.headline = headline;
  const question = clean(r.question, QUESTION_MAX);
  if (question) p.question = question;
  const title = clean(r.title, LISTING_TITLE_MAX);
  if (title) p.title = title;
  const line = printThumbLine(p);
  return line || undefined;
}

/** The listing title a line gives, if any. */
export function thumbTitle(line: string | undefined): string | undefined {
  return line ? parseThumbLine(line).parts.title : undefined;
}

/** A children's cast, by its tags (children, kids, school; barn, skole). */
export function kidsByTags(tags: readonly string[] | undefined): boolean {
  return (tags ?? []).some((t) => /^(children|kids?|school|pupils|barn|skole|elever)$/i.test(t.trim()));
}

/**
 * Every choice made. With a headline and no word style: the band. band and
 * burst need a headline, question a question (or a title that is one) —
 * else none. The figure, unless chosen: a cartoon thinker on a children's
 * quiz band, else none; eyes need the band to peek over. The author's marks
 * as written; none are added for them.
 */
export function planThumb(line: string | undefined, ctx: { title?: string; format?: string; kids?: boolean } = {}): ThumbPlan {
  const p: ThumbParts = line ? parseThumbLine(line).parts : { marks: [] };
  const headline = p.headline;
  const question = p.question ?? (ctx.title && /\?\s*$/.test(ctx.title) ? clean(ctx.title, QUESTION_MAX) : undefined);
  let words: WordStyle = p.words ?? (headline ? "band" : "none");
  if ((words === "band" || words === "burst") && !headline) words = "none";
  if (words === "question" && !question) words = "none";
  const seed = ctx.title ?? headline ?? question ?? "";
  const person = p.person ? pickPerson(readPersonWords(p.person), seed).id : undefined;
  let figure: Figure = person ? "none" : (p.figure ?? (ctx.kids && ctx.format === "quiz" && words === "band" ? "thinking" : "none"));
  if (figure === "eyes" && words !== "band") figure = "none";
  const marks = p.marks.map((m) => (MARK_WORDS[m.kind] !== undefined ? { kind: m.kind, words: m.words ?? MARK_WORDS[m.kind] } : { kind: m.kind }));
  const bg = p.bg === "card" ? `card ${SURFACE_NAMES[hashOf(seed) % SURFACE_NAMES.length]}` : p.bg;
  return { words, ...(words === "band" || words === "burst" ? { headline } : {}), ...(words === "question" ? { question } : {}), figure, marks, ...(bg && bg !== "paper" ? { bg } : {}), ...(person ? { person } : {}) };
}

/** Nothing to draw over the poster: the card serves it as published. */
export function isPlain(plan: ThumbPlan): boolean {
  return plan.words === "none" && plan.figure === "none" && plan.marks.length === 0 && !plan.person && (plan.bg ?? "paper") === "paper";
}

// ---------------------------------------------------------------------------
// Backgrounds (2026-10-07): behind the picture, never blended into it.

export const BACKGROUNDS = ["paper", "card", "notebook", "graph", "chalkboard"] as const;

/** The desks a card lies on: a colour and, for wood and cork, a grain. */
export const SURFACES: Record<string, { fill: string; grain?: [number, number, number, number] }> = {
  charcoal: { fill: "#2b2d31" },
  navy: { fill: "#1d2a44" },
  wood: { fill: "#4a3020", grain: [0.15, 0.08, 0.03, 0.6] },
  cork: { fill: "#c99a66", grain: [0.55, 0.36, 0.2, 0.55] },
  teal: { fill: "#5fb3a9" },
  yellow: { fill: "#f2c94c" },
  orange: { fill: "#ee9a4d" },
  red: { fill: "#d9645a" },
  pink: { fill: "#e88aa8" },
  purple: { fill: "#8e7cc3" },
  blue: { fill: "#5b8fd1" },
  green: { fill: "#6fae6a" },
  grey: { fill: "#8a8d93" },
};
/** The surfaces `card` alone may get, by title. */
const SURFACE_NAMES = ["charcoal", "navy", "wood", "cork", "teal", "blue", "purple", "green"];

/** Whether the picture's paper must be see-through under this background (a poster's, keyed with paper-key.mts). */
export function seeThroughFor(bg: string | undefined): boolean {
  return bg === "notebook" || bg === "graph" || bg === "chalkboard";
}

const full = (fill: string, extra = ""): string => `<rect width="${THUMB_W}" height="${THUMB_H}" fill="${fill}"${extra}/>`;
const grainFilter = (id: string, [r, g, b, a]: [number, number, number, number], freq = 0.8): string =>
  `<filter id="${id}" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="${freq}" numOctaves="2" seed="3"/><feColorMatrix values="0 0 0 0 ${r}  0 0 0 0 ${g}  0 0 0 0 ${b}  0 0 0 ${a} 0"/></filter>`;
/** Chalk: lightness turned over, hues kept (invert, then the hues back round), pale fills to mid-tones, not black. */
const CHALK = `<filter id="thumb-chalk" color-interpolation-filters="sRGB"><feColorMatrix type="matrix" values="-1 0 0 0 1  0 -1 0 0 1  0 0 -1 0 1  0 0 0 1 0"/><feColorMatrix type="hueRotate" values="180"/><feColorMatrix type="matrix" values="0.72 0 0 0 0.28  0 0.72 0 0 0.28  0 0 0.72 0 0.28  0 0 0 1 0"/></filter>`;

/**
 * The background and the picture on it: `pic` is the picture's markup on
 * the 1000 × 750 canvas — a poster (see-through when seeThroughFor says so)
 * or a drawing with no paper of its own.
 */
export function backdrop(bg: string | undefined, pic: string, drawing: boolean): string {
  const [kind, surface] = (bg ?? "paper").split(" ");
  if (kind === "card") {
    const s = SURFACES[surface] ?? SURFACES.charcoal;
    const pin = surface === "cork" ? `<circle cx="96" cy="74" r="13" fill="#d33"/><circle cx="92" cy="70" r="4" fill="#f99"/>` : "";
    // a poster brings its own paper; a drawing gets a sheet under it
    const sheet = drawing ? full("#fffdf7", ` filter="url(#thumb-shadow)"`) : "";
    const shadowed = drawing ? pic : pic.replace("<image ", `<image filter="url(#thumb-shadow)" `);
    return (
      `<defs><filter id="thumb-shadow" x="-10%" y="-10%" width="120%" height="120%"><feDropShadow dx="0" dy="12" stdDeviation="16" flood-opacity="0.5"/></filter>${s.grain ? grainFilter("thumb-grain", s.grain) : ""}</defs>` +
      full(s.fill) + (s.grain ? full("#000", ` filter="url(#thumb-grain)"`) : "") +
      `<g transform="rotate(-2.5 500 375) translate(70 50) scale(0.86)">${sheet}${shadowed}</g>` + pin
    );
  }
  if (kind === "notebook")
    return `<defs><pattern id="thumb-rule" width="${THUMB_W}" height="34" patternUnits="userSpaceOnUse"><path d="M0 33H${THUMB_W}" stroke="#a9c8ec" stroke-width="2"/></pattern></defs>${full("#fffef8")}${full("url(#thumb-rule)")}<path d="M88 0V${THUMB_H}" stroke="#e8817a" stroke-width="3"/>${pic}`;
  if (kind === "graph")
    return `<defs><pattern id="thumb-sq" width="25" height="25" patternUnits="userSpaceOnUse"><path d="M25 0V25H0" fill="none" stroke="#9cc3e6" stroke-width="1"/></pattern><pattern id="thumb-sq5" width="125" height="125" patternUnits="userSpaceOnUse"><path d="M125 0V125H0" fill="none" stroke="#7aaedb" stroke-width="2"/></pattern></defs>${full("#fbfdff")}${full("url(#thumb-sq)")}${full("url(#thumb-sq5)")}${pic}`;
  if (kind === "chalkboard")
    return `<defs>${CHALK}${grainFilter("thumb-dust", [1, 1, 1, 0.05])}</defs>${full("#24372f")}${full("#000", ` filter="url(#thumb-dust)"`)}<g filter="url(#thumb-chalk)">${pic}</g>`;
  return full("#fffdf7") + pic;
}

// ---------------------------------------------------------------------------
// Drawing. The canvas is the poster's own: 1000 × 750.

export const THUMB_W = 1000;
export const THUMB_H = 750;
export const FONT = { marker: "Permanent Marker", loud: "Bangers", hand: "Patrick Hand" } as const;
const INK = "#2b2622";
const RED = "#c8372d";

const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** A rough width per character, in em, for each face (wrapping and fitting only). */
const EM: Record<keyof typeof FONT, number> = { marker: 0.68, loud: 0.5, hand: 0.4 };

/** Greedy word wrap at an estimated width; null when a word cannot fit even alone. */
export function wrapWords(text: string, size: number, width: number, em: number): string[] | null {
  const max = width / (size * em);
  const lines: string[] = [];
  let cur = "";
  for (const w of text.split(" ")) {
    if (w.length > max) return null;
    const next = cur ? `${cur} ${w}` : w;
    if (next.length > max) {
      lines.push(cur);
      cur = w;
    } else cur = next;
  }
  if (cur) lines.push(cur);
  return lines;
}

/** The largest size from `hi` down to `lo` at which the text wraps into at most `maxLines`. */
export function fitText(text: string, face: keyof typeof FONT, width: number, maxLines: number, hi: number, lo: number): { size: number; lines: string[] } {
  for (let s = hi; s >= lo; s -= 2) {
    const lines = wrapWords(text, s, width, EM[face]);
    if (lines && lines.length <= maxLines) return { size: s, lines };
  }
  return { size: lo, lines: wrapWords(text, lo, width, EM[face]) ?? [text] };
}

const BAND_CY = 588;

/** The band; its words between `x0` and `x1` (a person beside them takes the rest). */
function band(headline: string, x0 = 70, x1 = 930): string {
  const up = headline.toUpperCase();
  const width = x1 - x0;
  const cx = (x0 + x1) / 2;
  // One line while it reads at 52 or more; two lines only for a longer headline.
  const one = fitText(up, "marker", width, 1, 70, 52);
  const { size, lines } = one.lines.length === 1 && wrapWords(up, one.size, width, EM.marker)?.length === 1 ? one : fitText(up, "marker", width, 2, 70, width < 700 ? 32 : 38);
  const lh = size * 1.12;
  const h = lines.length * lh + 34;
  const y0 = BAND_CY - h / 2;
  const text = lines.map((l, i) => `<text x="${cx}" y="${(y0 + 22 + size * 0.86 + i * lh).toFixed(1)}" text-anchor="middle" font-family="${FONT.marker}" font-size="${size}" fill="${INK}">${esc(l)}</text>`).join("");
  return (
    `<g transform="rotate(-3.5 500 ${BAND_CY})">` +
    `<rect x="-40" y="${(y0 + 8).toFixed(1)}" width="1080" height="${h.toFixed(1)}" fill="rgba(0,0,0,0.18)"/>` +
    `<rect x="-40" y="${y0.toFixed(1)}" width="1080" height="${h.toFixed(1)}" fill="#fff4a8"/>` +
    `<path d="M-40 ${y0.toFixed(1)}H1040M-40 ${(y0 + h).toFixed(1)}H1040" stroke="${INK}" stroke-width="5"/>` +
    text +
    `</g>`
  );
}

/** burst: the comic lettering, top left. Returns its art and its bottom edge (for an arrow). */
function burst(headline: string): { art: string; bottom: number } {
  const { size, lines } = fitText(headline.toUpperCase(), "loud", 560, 2, 150, 70);
  const lh = size * 0.98;
  const row = (l: string, i: number, fill: string): string => {
    const y = 70 + size * 0.85 + i * lh;
    return (
      `<text x="79" y="${(y + 9).toFixed(1)}" font-family="${FONT.loud}" font-size="${size}" fill="${INK}" stroke="${INK}" stroke-width="10" stroke-linejoin="round">${esc(l)}</text>` +
      `<text x="70" y="${y.toFixed(1)}" font-family="${FONT.loud}" font-size="${size}" fill="${fill}" stroke="${INK}" stroke-width="10" stroke-linejoin="round" paint-order="stroke">${esc(l)}</text>`
    );
  };
  return {
    art: `<rect width="${THUMB_W}" height="${THUMB_H}" fill="rgba(0,0,0,0.07)"/><g transform="rotate(-4 300 200)">${lines.map((l, i) => row(l, i, i === 0 ? "#ffe23d" : "#ffffff")).join("")}</g>`,
    bottom: 70 + lines.length * lh + 20,
  };
}

/** The picture under the marks: the poster at `posterHref`, or — a card
 *  drawn from its own compiled drawing (src/card, 2026-10-05) — that drawing
 *  as inline SVG markup on the same 1000 × 750 canvas. */
function pictureLayer(posterHref: string, picture?: string): string {
  return picture !== undefined ? `<g>${picture}</g>` : `<image href="${esc(posterHref)}" width="1000" height="750"/>`;
}

/** The corners' slots (left, top, width, height) the marks stand in — for a
 *  reader that measures how busy a corner is from shapes, not pixels. */
export function cornerSlots(): Record<Corner, { x: number; y: number; w: number; h: number }> {
  const out = {} as Record<Corner, { x: number; y: number; w: number; h: number }>;
  for (const c of Object.keys(SLOT_AT) as Corner[]) out[c] = { x: SLOT_AT[c][0], y: SLOT_AT[c][1], w: SLOT_W, h: SLOT_H };
  return out;
}

function questionCard(text: string, posterHref: string, picture?: string): string {
  const { size, lines } = fitText(text, "hand", 380, 6, 76, 44);
  const lh = size * 1.1;
  const top = THUMB_H / 2 - (lines.length * lh) / 2 + size * 0.8;
  return (
    `<rect width="${THUMB_W}" height="${THUMB_H}" fill="#fffdf7"/>` +
    `<svg x="460" y="0" width="540" height="750" viewBox="270 80 460 640" preserveAspectRatio="xMidYMid slice">${picture !== undefined ? `<rect width="1000" height="750" fill="#fffdf7"/>` : ""}${pictureLayer(posterHref, picture)}</svg>` +
    `<rect width="460" height="750" fill="#2f5d8a"/>` +
    lines.map((l, i) => `<text x="52" y="${(top + i * lh).toFixed(1)}" font-family="${FONT.hand}" font-size="${size}" fill="#fffdf7">${esc(l)}</text>`).join("")
  );
}

// ---- The cartoon busts (children's casts): 200 × 200 art, flat colours —
// no CSS variables, which the server's renderer does not have.
interface Look {
  skin: string;
  hair: string;
  shirt: string;
}
const LOOKS: Record<(typeof KID_FIGURES)[number], Look> = {
  surprised: { skin: "#f2c29b", hair: "#5a3a24", shirt: "#4f86c6" },
  thinking: { skin: "#f2c29b", hair: "#2b2622", shirt: "#6aa36f" },
  puzzled: { skin: "#f2c29b", hair: "#c0632b", shirt: "#d9822b" },
  aha: { skin: "#c98a5e", hair: "#2b2622", shirt: "#8e5bb5" },
};
const S = `stroke="${INK}" stroke-width="5"`;
const bust = (l: Look): string =>
  `<path d="M30 200c2-34 30-52 70-52s68 18 70 52z" fill="${l.shirt}" ${S} stroke-linejoin="round"/>` +
  `<path d="M86 132v20c0 8 28 8 28 0v-20" fill="${l.skin}" ${S}/>`;
const head = (l: Look): string =>
  `<ellipse cx="52" cy="92" rx="10" ry="14" fill="${l.skin}" ${S}/><ellipse cx="148" cy="92" rx="10" ry="14" fill="${l.skin}" ${S}/>` +
  `<path d="M100 30c30 0 50 22 50 58 0 34-22 54-50 54s-50-20-50-54c0-36 20-58 50-58z" fill="${l.skin}" ${S}/>` +
  `<path d="M50 82c-4-34 18-58 52-58 32 0 54 22 48 56-8-14-22-22-40-24 6 6 6 12 4 16-12-12-34-16-50-6-6 4-10 10-14 16z" fill="${l.hair}" ${S} stroke-linejoin="round"/>`;
const arm = (d: string, shirt: string): string => `<path d="${d}" fill="none" stroke="${INK}" stroke-width="24" stroke-linecap="round"/><path d="${d}" fill="none" stroke="${shirt}" stroke-width="15" stroke-linecap="round"/>`;
const line = (d: string, w = 5): string => `<path d="${d}" fill="none" stroke="${INK}" stroke-width="${w}" stroke-linecap="round"/>`;
const eye = (cx: number, cy: number, r: number, px: number, py: number): string => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="#fff" stroke="${INK}" stroke-width="4"/><circle cx="${px}" cy="${py}" r="${Math.max(4, r * 0.4)}" fill="${INK}"/>`;

/** One cartoon bust's 200 × 200 art (no wrapper). */
export function characterArt(c: (typeof KID_FIGURES)[number]): string {
  const l = LOOKS[c];
  if (c === "surprised")
    return (
      bust(l) + head(l) + line("M70 66q12-12 24-4M106 62q12-8 24 4") + eye(82, 84, 12, 82, 86) + eye(118, 84, 12, 118, 86) +
      `<ellipse cx="100" cy="118" rx="10" ry="14" fill="#7a2a1c" stroke="${INK}" stroke-width="4"/>` +
      `<path d="M58 104c-12 2-16 18-8 30 6 8 16 8 20 0 4-8 0-24-12-30z" fill="${l.skin}" ${S} stroke-linejoin="round"/>` +
      `<path d="M142 104c12 2 16 18 8 30-6 8-16 8-20 0-4-8 0-24 12-30z" fill="${l.skin}" ${S} stroke-linejoin="round"/>` +
      `<path d="M28 40l-12-8M24 58l-14 0M172 40l12-8M176 58l14 0" stroke="#e8302a" stroke-width="5" stroke-linecap="round"/>`
    );
  if (c === "thinking")
    return (
      bust(l) + head(l) + line("M70 70q12-6 22 0M108 64q12-10 24-2") + eye(82, 86, 9.5, 86, 81) + eye(118, 86, 9.5, 122, 81) + line("M92 114q8-2 16 1") +
      arm("M70 200C66 176 80 156 98 148", l.shirt) +
      `<path d="M88 150c-6-10 2-20 14-18l14 2c8 2 8 12 0 13l-10 1c4 3 2 10-6 10-6 0-10-3-12-8z" fill="${l.skin}" ${S} stroke-linejoin="round"/>` +
      `<circle cx="150" cy="40" r="5" fill="#fff" stroke="${INK}" stroke-width="3"/><circle cx="162" cy="26" r="8" fill="#fff" stroke="${INK}" stroke-width="3"/>` +
      `<path d="M168 2c14-4 30 6 28 18 6 6 0 18-10 16-8 8-24 6-26-4-12-2-12-18 0-18 0-6 2-10 8-12z" fill="#fff" stroke="${INK}" stroke-width="3"/>` +
      `<text x="180" y="28" font-family="${FONT.hand}" font-size="22" text-anchor="middle" fill="${INK}">?</text>`
    );
  if (c === "puzzled")
    return (
      bust(l) +
      `<g transform="rotate(-8 100 90)">${head(l)}${line("M70 72l22-4M108 60q12-8 24 2")}${eye(82, 86, 8, 83, 87)}${eye(118, 84, 10, 119, 85)}${line("M86 120q6-6 12 0t12 0t10-2")}</g>` +
      arm("M168 200C182 150 178 90 160 62", l.shirt) +
      `<path d="M140 46c6-12 24-14 30-2 4 8-2 18-12 18l-14-2c-8-2-8-8-4-14z" fill="${l.skin}" ${S} stroke-linejoin="round"/>` +
      `<text x="34" y="44" font-family="${FONT.loud}" font-size="34" fill="#2f5d8a" transform="rotate(-14 34 44)">?</text>` +
      `<text x="16" y="74" font-family="${FONT.loud}" font-size="22" fill="#2f5d8a" transform="rotate(10 16 74)">?</text>`
    );
  return (
    bust(l) + head(l) + line("M70 66q12-8 24-2M106 64q12-6 24 2") + line("M72 86q10-10 20 0M108 86q10-10 20 0") +
    `<path d="M78 108q22 26 44 0z" fill="#7a2a1c" stroke="${INK}" stroke-width="4" stroke-linejoin="round"/>` +
    arm("M156 200C170 170 172 140 166 116", l.shirt) +
    `<path d="M154 118c-2-10 4-16 10-14l2-26c0-8 10-8 10 0l-1 28c8 2 10 8 8 14l-4 8c-6 6-20 6-25-10z" fill="${l.skin}" ${S} stroke-linejoin="round"/>` +
    `<path d="M160 8c-14 0-22 10-22 20 0 8 6 12 8 18h28c2-6 8-10 8-18 0-10-8-20-22-20z" fill="#ffe23d" stroke="${INK}" stroke-width="4"/>` +
    line("M148 50h24M150 58h20", 4) +
    `<path d="M128 10l-8-6M128 30h-10M192 10l8-6M192 30h10" stroke="#e8a52a" stroke-width="4" stroke-linecap="round"/>`
  );
}

/** Peeking eyes over the band's top edge (drawn before the band, so it hides their lower half). */
function eyes(): string {
  return `<g transform="rotate(-3.5 500 ${BAND_CY})" stroke="${INK}" stroke-linecap="round">
<path d="M610 520c0-40 26-66 62-66s62 26 62 66" fill="#fffdf7" stroke-width="5"/><path d="M740 520c0-40 26-66 62-66s62 26 62 66" fill="#fffdf7" stroke-width="5"/>
<circle cx="690" cy="500" r="14" fill="${INK}"/><circle cx="820" cy="500" r="14" fill="${INK}"/>
<path d="M618 432q50-30 104-6M748 418q54-18 104 14" fill="none" stroke-width="7"/>
<path d="M560 528c40-10 66-8 92-2M846 524c30-6 58-6 86 4" fill="none" stroke-width="6"/></g>`;
}

// ---- Placement. A slot is a 280 × 260 box in one corner of the free area;
// items are drawn in a box's own coordinates (0..280 × 0..260), and `inward`
// says which way the canvas's middle lies (a note's arrow points there).

export type Corner = "tl" | "tr" | "bl" | "br";
const SLOT_W = 280;
const SLOT_H = 260;
const SLOT_AT: Record<Corner, [number, number]> = { tl: [24, 20], tr: [THUMB_W - SLOT_W - 24, 20], bl: [24, THUMB_H - SLOT_H - 20], br: [THUMB_W - SLOT_W - 24, THUMB_H - SLOT_H - 20] };

/** The corners each word style leaves free, in the order used when the poster says nothing. */
export function freeCorners(words: WordStyle): Corner[] {
  if (words === "band") return ["tr", "tl"];
  if (words === "burst") return ["tr", "br", "bl"];
  if (words === "question") return ["tr", "br"];
  return ["tr", "tl", "br", "bl"];
}

/**
 * How busy each corner of the poster is: the share of its sampled pixels
 * that are not paper, from RGBA bytes. Lower is emptier. Shared by the
 * server (pngjs) and the panel (a canvas).
 */
export function cornerBusyness(rgba: Uint8Array | Uint8ClampedArray, w: number, h: number): Record<Corner, number> {
  const out = {} as Record<Corner, number>;
  for (const c of Object.keys(SLOT_AT) as Corner[]) {
    const [x0, y0] = SLOT_AT[c];
    let ink = 0;
    let n = 0;
    for (let y = y0; y < y0 + SLOT_H; y += 6)
      for (let x = x0; x < x0 + SLOT_W; x += 6) {
        const px = Math.min(w - 1, Math.floor((x / THUMB_W) * w));
        const py = Math.min(h - 1, Math.floor((y / THUMB_H) * h));
        const i = (py * w + px) * 4;
        const lum = 0.3 * rgba[i] + 0.59 * rgba[i + 1] + 0.11 * rgba[i + 2];
        n++;
        if (rgba[i + 3] > 40 && lum < 228) ink++;
      }
    out[c] = n ? ink / n : 0;
  }
  return out;
}

function noteArt(words: string, inward: 1 | -1): string {
  const { size, lines } = fitText(words, "marker", 250, 2, 54, 28);
  const text = lines.map((l, i) => `<text x="${140 + i * 8}" y="${(60 + size * 0.6 + i * size * 1.08).toFixed(1)}" text-anchor="middle" font-family="${FONT.marker}" font-size="${size}" fill="${RED}" transform="rotate(-8 140 ${60 + i * size})">${esc(l)}</text>`).join("");
  // The arrow leaves the words towards the canvas's middle.
  const y = 80 + lines.length * size;
  const arrow = `<g fill="none" stroke="${RED}" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"><path d="M150 ${y}c-20 30-60 52-110 60"/><path d="M60 ${y + 42}l-26 18 32 10"/></g>`;
  return text + (inward === -1 ? arrow : `<g transform="translate(${SLOT_W} 0) scale(-1 1)">${arrow}</g>`);
}

function stampArt(words: string): string {
  const up = words.toUpperCase();
  const { size } = fitText(up, "loud", 230, 1, 66, 30);
  return `<g transform="rotate(-12 140 110)" opacity="0.9"><rect x="0" y="52" width="280" height="116" rx="10" fill="none" stroke="${RED}" stroke-width="9" stroke-dasharray="60 6 30 4"/>
<rect x="14" y="66" width="252" height="88" rx="6" fill="none" stroke="${RED}" stroke-width="3"/>
<text x="140" y="${(110 + size * 0.34).toFixed(1)}" text-anchor="middle" font-family="${FONT.loud}" font-size="${size}" letter-spacing="3" fill="${RED}">${esc(up)}</text></g>`;
}

const STAR = "M70 0l14 30 32-12-8 32 34 8-28 20 22 26-34 2 2 34-28-18-20 28-10-32-32 10 14-30L4 76l30-14L16 32l34 4z";
function starArt(words: string): string {
  const { size } = fitText(words, "loud", 80, 1, 64, 26);
  return `<g transform="translate(50 20) rotate(8 70 70) scale(1.25)">
<path d="${STAR}" fill="#000" opacity="0.18" transform="translate(5 7)" stroke="#000" stroke-width="22" stroke-linejoin="round"/>
<path d="${STAR}" fill="#fff" stroke="#fff" stroke-width="22" stroke-linejoin="round"/>
<path d="${STAR}" fill="#7b5cff" stroke="${INK}" stroke-width="5" stroke-linejoin="round"/>
<text x="70" y="${(78 + size * 0.32).toFixed(1)}" text-anchor="middle" font-family="${FONT.loud}" font-size="${size}" fill="#fff" stroke="${INK}" stroke-width="2">${esc(words)}</text></g>`;
}

const bangArt = (): string => `<text x="140" y="190" text-anchor="middle" font-family="${FONT.loud}" font-size="170" fill="#e8302a" stroke="${INK}" stroke-width="7" paint-order="stroke" transform="rotate(8 140 130)">!!</text>`;

function sealArt(): string {
  return (
    `<g transform="rotate(12 140 120)"><circle cx="140" cy="120" r="104" fill="#e8302a"/><circle cx="140" cy="120" r="90" fill="none" stroke="#fff" stroke-width="6" stroke-dasharray="14 10"/>` +
    ["NOT", "CLICK", "BAIT"].map((w, i) => `<text x="140" y="${84 + i * 38}" text-anchor="middle" font-family="${FONT.loud}" font-size="44" fill="#fff">${w}</text>`).join("") +
    `</g>`
  );
}

const kidArt = (c: (typeof KID_FIGURES)[number]): string => `<g transform="translate(10 0) scale(1.3)">${characterArt(c)}</g>`;

// ---- The photo person (people.mts): chest-up, bottom-anchored on one side,
// a little past the edge, facing the middle, cut out with a white outline.
const PERSON_H = 600;
const PERSON_OVER = 50;

/** The side the person stands: the emptier one, or the right when the words need the left. */
function personSide(words: WordStyle, busy?: Record<Corner, number>): "left" | "right" {
  if (words === "burst" || words === "question" || !busy) return "right";
  return busy.tl + busy.bl < busy.tr + busy.br ? "left" : "right";
}

/** The width the person covers on the canvas. */
const personCover = (p: Person): number => Math.round((p.w / p.h) * PERSON_H) - PERSON_OVER;

function personArt(p: Person, side: "left" | "right", href: string): string {
  const w = Math.round((p.w / p.h) * PERSON_H);
  const x = side === "right" ? THUMB_W - w + PERSON_OVER : -PERSON_OVER;
  const y = THUMB_H - PERSON_H;
  const toward = side === "right" ? "left" : "right";
  const place = p.faces === toward || p.faces === "front" ? `translate(${x} ${y})` : `translate(${x + w} ${y}) scale(-1 1)`;
  return (
    `<defs><filter id="thumb-cut" x="-10%" y="-10%" width="120%" height="120%">` +
    `<feMorphology in="SourceAlpha" operator="dilate" radius="7" result="grow"/><feFlood flood-color="#ffffff"/><feComposite in2="grow" operator="in" result="edge"/>` +
    `<feMerge result="cut"><feMergeNode in="edge"/><feMergeNode in="SourceGraphic"/></feMerge>` +
    `<feDropShadow in="cut" dx="0" dy="6" stdDeviation="8" flood-color="#000" flood-opacity="0.35"/></filter></defs>` +
    `<g transform="${place}"><image href="${esc(href)}" width="${w}" height="${PERSON_H}" filter="url(#thumb-cut)"/></g>`
  );
}

/** Where the photo people are served (the site's own files). */
export const personHrefDefault = (id: string): string => `/thumb-people/${id}.png`;

/** The big red arrow: from under burst's lettering (or the upper middle), down and to the right. */
function arrowArt(fromY: number): string {
  return `<g transform="translate(330 ${Math.min(fromY, 420).toFixed(0)}) scale(2.1)"><path d="M10 18c40 6 82 28 110 74" fill="none" stroke="#e8302a" stroke-width="12" stroke-linecap="round"/><path d="M96 84l30 18 4-34" fill="none" stroke="#e8302a" stroke-width="12" stroke-linecap="round" stroke-linejoin="round"/></g>`;
}

/**
 * The listing picture as an SVG string, the poster at `posterHref` (a data:
 * URL on the server). `busy`, when known, orders the free corners emptiest
 * first; the figure takes the emptiest, then each mark the next (a corner
 * takes a second, smaller item nearer the middle when items outnumber corners).
 */
export function thumbSvg(plan: ThumbPlan, posterHref: string, busy?: Record<Corner, number>, picture?: string, personHref: (id: string) => string = personHrefDefault): string {
  // The question card is its own background: the picture stands in its panel on paper.
  let base = backdrop(plan.bg, pictureLayer(posterHref, picture), picture !== undefined);
  let arrowFrom = 300;
  if (plan.words === "question" && plan.question) base = questionCard(plan.question, posterHref, picture);
  const person = personById(plan.person);
  const side = person ? personSide(plan.words, busy) : undefined;
  if (plan.words === "burst" && plan.headline) {
    const b = burst(plan.headline);
    base += b.art;
    arrowFrom = b.bottom;
  }
  // The corner items: a cartoon figure first, then the marks (the arrow has a place of its own).
  const items: ((inward: 1 | -1) => string)[] = [];
  if (plan.figure !== "none" && plan.figure !== "eyes") {
    const f = plan.figure;
    items.push(() => kidArt(f));
  }
  for (const m of plan.marks) {
    if (m.at) continue; // drawn where it was put, below
    if (m.kind === "note") items.push((inward) => noteArt(m.words ?? "", inward));
    else if (m.kind === "stamp") items.push(() => stampArt(m.words ?? ""));
    else if (m.kind === "star") items.push(() => starArt(m.words ?? "?!"));
    else if (m.kind === "bang") items.push(bangArt);
    else if (m.kind === "seal") items.push(sealArt);
  }
  let corners = freeCorners(plan.words);
  // The person's side is theirs: the marks take the other corners.
  if (side) {
    const rest = corners.filter((c) => c[1] !== side[0]);
    corners = rest.length ? rest : [side === "right" ? "tl" : "tr"];
  }
  if (busy) corners = [...corners].sort((a, b) => busy[a] - busy[b]);
  // A corner a placed mark stands in comes last: the corner marks go elsewhere first.
  const covered = (c: Corner): boolean =>
    plan.marks.some((m) => m.at && Math.abs(m.at[0] - (SLOT_AT[c][0] + SLOT_W / 2)) < SLOT_W && Math.abs(m.at[1] - (SLOT_AT[c][1] + SLOT_H / 2)) < SLOT_H);
  corners = [...corners.filter((c) => !covered(c)), ...corners.filter(covered)];
  const used = new Map<Corner, number>();
  let over = "";
  // A mark the author placed stands where it was put, centred there (the
  // slot's art is drawn in a SLOT_W × SLOT_H box); the rest take corners.
  const placed = plan.marks.filter((m) => m.at);
  for (const m of placed) {
    const art = m.kind === "note" ? noteArt(m.words ?? "", 1) : m.kind === "stamp" ? stampArt(m.words ?? "") : m.kind === "star" ? starArt(m.words ?? "?!") : m.kind === "bang" ? bangArt() : m.kind === "seal" ? sealArt() : "";
    if (!art) continue;
    const [cx, cy] = m.at!;
    const turn = m.rotate ? ` rotate(${m.rotate} ${SLOT_W / 2} ${SLOT_H / 2})` : "";
    over += `<g transform="translate(${(cx - SLOT_W / 2).toFixed(0)} ${(cy - SLOT_H / 2).toFixed(0)})${turn}">${art}</g>`;
  }
  items.forEach((art, i) => {
    const c = corners[i % corners.length];
    const k = used.get(c) ?? 0;
    used.set(c, k + 1);
    const [x, y0] = SLOT_AT[c];
    const inward: 1 | -1 = c[1] === "l" ? 1 : -1;
    // A second item in a corner stands nearer the middle, and smaller.
    const y = k === 0 ? y0 : c[0] === "t" ? y0 + 190 : y0 - 170;
    over += k === 0 ? `<g transform="translate(${x} ${y})">${art(inward)}</g>` : `<g transform="translate(${x + 40} ${y}) scale(0.7)">${art(inward)}</g>`;
  });
  const cover = person ? personCover(person) + 16 : 0;
  const strip = plan.words === "band" && plan.headline ? band(plan.headline, side === "left" ? Math.max(70, cover) : 70, side === "right" ? Math.min(930, THUMB_W - cover) : 930) : "";
  const front = person ? personArt(person, side!, personHref(person.id)) : "";
  const arrow = plan.marks.some((m) => m.kind === "arrow") ? arrowArt(arrowFrom) : "";
  const body = base + (strip && plan.figure === "eyes" ? eyes() : "") + over + strip + front + arrow;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${THUMB_W}" height="${THUMB_H}" viewBox="0 0 ${THUMB_W} ${THUMB_H}">${body}</svg>`;
}
