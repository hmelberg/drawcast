// netlify/lib/thumb.mts
// The listing picture's styles (thumbnail round, 2026-10-04): the poster a
// cast publishes, with words and a cartoon character drawn over it. The cast
// carries only the WORDS and, if its author wants, a style and a character
// (its header's `thumb:` block); the site draws the picture — here, as one
// SVG string — so a style change never means republishing a cast.
// /card/<name>.png renders it (netlify/lib/thumb-render.mts) for the front
// page and every link preview alike; the publish panel shows the same SVG
// as its preview. Pure: no fetch, no fonts, no DOM.
//
//   A plain     the poster as published
//   B strip     a tilted paper strip with the headline (the default)
//   D loud      deliberately over-the-top ironic clickbait (opt-in only)
//   E question  the question in big handwriting beside a crop of the figure

export const THUMB_STYLES = ["plain", "strip", "loud", "question"] as const;
export type ThumbStyle = (typeof THUMB_STYLES)[number];
export const THUMB_CHARACTERS = ["none", "surprised", "thinking", "puzzled", "aha"] as const;
export type ThumbCharacter = (typeof THUMB_CHARACTERS)[number];

/** What a cast's header may say (every field optional; "auto" = the site decides). */
export interface ThumbSpec {
  style?: ThumbStyle | "auto";
  character?: ThumbCharacter | "auto";
  /** B and D: a few words, shouted. */
  headline?: string;
  /** E: the question; a title ending in "?" stands in when absent. */
  question?: string;
  /** The listing title, when it should differ from the title card's. */
  title?: string;
}

/** What is drawn, every choice made. */
export interface ThumbPlan {
  style: ThumbStyle;
  character: ThumbCharacter;
  headline?: string;
  question?: string;
}

export const HEADLINE_MAX = 60;
export const QUESTION_MAX = 90;
export const LISTING_TITLE_MAX = 120;

const clean = (v: unknown, max: number): string | undefined => {
  if (typeof v !== "string") return undefined;
  const t = v.replace(/\s+/g, " ").trim();
  return t ? t.slice(0, max) : undefined;
};

/** A header's `thumb:` value, validated: unknown values are dropped, never thrown. */
export function readThumb(raw: unknown): ThumbSpec | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const r = raw as Record<string, unknown>;
  const out: ThumbSpec = {};
  if (r.style === "auto" || (THUMB_STYLES as readonly unknown[]).includes(r.style)) out.style = r.style as ThumbSpec["style"];
  if (r.character === "auto" || (THUMB_CHARACTERS as readonly unknown[]).includes(r.character)) out.character = r.character as ThumbSpec["character"];
  const headline = clean(r.headline, HEADLINE_MAX);
  if (headline) out.headline = headline;
  const question = clean(r.question, QUESTION_MAX);
  if (question) out.question = question;
  const title = clean(r.title, LISTING_TITLE_MAX);
  if (title) out.title = title;
  return Object.keys(out).length ? out : undefined;
}

/**
 * Every choice made (Hans 2026-10-04): the default is B when the cast has a
 * headline, else A; D is only ever the author's pick; E needs a question (or a
 * title that is one). The character, unless chosen: Thinking deeply on a
 * quiz's strip, Surprised on D, none otherwise — and never on A or E.
 */
export function planThumb(t: ThumbSpec | undefined, ctx: { title?: string; format?: string } = {}): ThumbPlan {
  const headline = t?.headline;
  const titleQuestion = ctx.title && /\?\s*$/.test(ctx.title) ? clean(ctx.title, QUESTION_MAX) : undefined;
  const question = t?.question ?? titleQuestion;
  let style: ThumbStyle = t?.style && t.style !== "auto" ? t.style : headline ? "strip" : "plain";
  if ((style === "strip" || style === "loud") && !headline) style = "plain";
  if (style === "question" && !question) style = "plain";
  let character: ThumbCharacter = "none";
  if (style === "strip" || style === "loud") {
    if (t?.character && t.character !== "auto") character = t.character;
    else if (style === "loud") character = ctx.format === "quiz" ? "puzzled" : "surprised";
    else character = ctx.format === "quiz" ? "thinking" : "none";
  }
  return { style, character, ...(style === "strip" || style === "loud" ? { headline } : {}), ...(style === "question" ? { question } : {}) };
}

// ---------------------------------------------------------------------------
// Drawing. The canvas is the poster's own: 1000 × 750.

export const THUMB_W = 1000;
export const THUMB_H = 750;
export const FONT = { marker: "Permanent Marker", loud: "Bangers", hand: "Patrick Hand" } as const;
const INK = "#2b2622";

const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** A rough width per character, in em, for each face (wrapping and fitting only). */
const EM: Record<keyof typeof FONT, number> = { marker: 0.68, loud: 0.5, hand: 0.4 };

/** Greedy word wrap at an estimated width; null when a line cannot fit even alone. */
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

function strip(headline: string): string {
  // One line while it reads at 52 or more; two lines only for a longer headline.
  const one = fitText(headline.toUpperCase(), "marker", 860, 1, 70, 52);
  const { size, lines } = one.lines.length === 1 && wrapWords(headline.toUpperCase(), one.size, 860, EM.marker)?.length === 1 ? one : fitText(headline.toUpperCase(), "marker", 860, 2, 70, 38);
  const lh = size * 1.12;
  const h = lines.length * lh + 34;
  const cy = 588;
  const y0 = cy - h / 2;
  const text = lines.map((l, i) => `<text x="500" y="${(y0 + 22 + size * 0.86 + i * lh).toFixed(1)}" text-anchor="middle" font-family="${FONT.marker}" font-size="${size}" fill="${INK}">${esc(l)}</text>`).join("");
  return (
    `<g transform="rotate(-3.5 500 ${cy})">` +
    `<rect x="-40" y="${(y0 + 8).toFixed(1)}" width="1080" height="${h.toFixed(1)}" fill="rgba(0,0,0,0.18)"/>` +
    `<rect x="-40" y="${y0.toFixed(1)}" width="1080" height="${h.toFixed(1)}" fill="#fff4a8"/>` +
    `<path d="M-40 ${y0.toFixed(1)}H1040M-40 ${(y0 + h).toFixed(1)}H1040" stroke="${INK}" stroke-width="5"/>` +
    text +
    `</g>`
  );
}

function loud(headline: string): string {
  const words = headline.toUpperCase();
  const { size, lines } = fitText(words, "loud", 560, 2, 150, 70);
  const lh = size * 0.98;
  const row = (l: string, i: number, fill: string): string => {
    const y = 70 + size * 0.85 + i * lh;
    return (
      `<text x="${70 + 9}" y="${(y + 9).toFixed(1)}" font-family="${FONT.loud}" font-size="${size}" fill="${INK}" stroke="${INK}" stroke-width="10" stroke-linejoin="round">${esc(l)}</text>` +
      `<text x="70" y="${y.toFixed(1)}" font-family="${FONT.loud}" font-size="${size}" fill="${fill}" stroke="${INK}" stroke-width="10" stroke-linejoin="round" paint-order="stroke">${esc(l)}</text>`
    );
  };
  const text = lines.map((l, i) => row(l, i, i === 0 ? "#ffe23d" : "#ffffff")).join("");
  const arrowY = Math.min(70 + lines.length * lh + 20, 420);
  return (
    `<rect width="${THUMB_W}" height="${THUMB_H}" fill="rgba(0,0,0,0.07)"/>` +
    `<g transform="rotate(-4 300 200)">${text}</g>` +
    `<g transform="translate(330 ${arrowY.toFixed(0)}) scale(2.1)"><path d="M10 18c40 6 82 28 110 74" fill="none" stroke="#e8302a" stroke-width="12" stroke-linecap="round"/><path d="M96 84l30 18 4-34" fill="none" stroke="#e8302a" stroke-width="12" stroke-linecap="round" stroke-linejoin="round"/></g>` +
    `<g transform="rotate(12 868 128)"><circle cx="868" cy="128" r="104" fill="#e8302a"/><circle cx="868" cy="128" r="90" fill="none" stroke="#fff" stroke-width="6" stroke-dasharray="14 10"/>` +
    ["NOT", "CLICK", "BAIT"].map((w, i) => `<text x="868" y="${92 + i * 38}" text-anchor="middle" font-family="${FONT.loud}" font-size="44" fill="#fff">${w}</text>`).join("") +
    `</g>`
  );
}

function question(q: string, posterHref: string): string {
  const { size, lines } = fitText(q, "hand", 380, 6, 76, 44);
  const lh = size * 1.1;
  const top = THUMB_H / 2 - (lines.length * lh) / 2 + size * 0.8;
  return (
    `<rect width="${THUMB_W}" height="${THUMB_H}" fill="#fffdf7"/>` +
    `<svg x="460" y="0" width="540" height="750" viewBox="270 80 460 640" preserveAspectRatio="xMidYMid slice"><image href="${esc(posterHref)}" width="1000" height="750"/></svg>` +
    `<rect width="460" height="750" fill="#2f5d8a"/>` +
    lines.map((l, i) => `<text x="52" y="${(top + i * lh).toFixed(1)}" font-family="${FONT.hand}" font-size="${size}" fill="#fffdf7">${esc(l)}</text>`).join("")
  );
}

// The characters: 200 × 200 busts, flat colours (no CSS variables — the
// server's renderer has none), heavy ink outlines like the rest of the site.
interface Look {
  skin: string;
  hair: string;
  shirt: string;
}
const LOOKS: Record<Exclude<ThumbCharacter, "none">, Look> = {
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

/** One character's 200 × 200 art (no wrapper). */
export function characterArt(c: Exclude<ThumbCharacter, "none">): string {
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

function character(c: ThumbCharacter, style: ThumbStyle): string {
  if (c === "none") return "";
  // B: the top-right corner, over the figure's margin; D: big, bottom right.
  const [x, y, s] = style === "loud" ? [640, 400, 1.75] : [722, 14, 1.42];
  return `<g transform="translate(${x} ${y}) scale(${s})">${characterArt(c)}</g>`;
}

/** The listing picture as an SVG string, the poster at `posterHref` (a data: URL on the server). */
export function thumbSvg(plan: ThumbPlan, posterHref: string): string {
  const poster = `<rect width="${THUMB_W}" height="${THUMB_H}" fill="#fffdf7"/><image href="${esc(posterHref)}" width="${THUMB_W}" height="${THUMB_H}"/>`;
  let body = poster;
  if (plan.style === "strip" && plan.headline) body += character(plan.character, "strip") + strip(plan.headline);
  else if (plan.style === "loud" && plan.headline) body += loud(plan.headline) + character(plan.character, "loud");
  else if (plan.style === "question" && plan.question) body = question(plan.question, posterHref);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${THUMB_W}" height="${THUMB_H}" viewBox="0 0 ${THUMB_W} ${THUMB_H}">${body}</svg>`;
}
