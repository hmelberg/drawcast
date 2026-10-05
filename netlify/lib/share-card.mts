// netlify/lib/share-card.mts
// The share card's pure rules (spec 2026-10-02-share-design §§3–5). A link
// someone pastes into a feed is drawcast.app/c/<name> (or /c/gh/<owner>/
// <repo>/<path> for a GitHub cast with no name): a path, because a
// link-preview crawler never sees anything after `#`. netlify/functions/
// card.mts answers it — a person with a redirect to the `#` link that plays,
// a crawler with the card page built here. The name rule is name-host.mts's
// (the same one src/names.ts holds), so a /c/ path can only ever mean a
// name the registry could have.
import yaml from "js-yaml";
import { NAME_LABEL_RE, RESERVED_LABELS } from "./name-host.mts";
import { readThumb } from "./thumb.mts";

/** What a card reads from a cast: its text, and (thumbnail round, 2026-10-04) its format and `thumb:` block. */
export interface CastCardText {
  title?: string;
  subtitle?: string;
  format?: string;
  tags?: string[];
  /** The canonical thumb line (thumb.mts). */
  thumb?: string;
}

export type ShareTarget = { kind: "name"; name: string } | { kind: "gh"; owner: string; repo: string; path: string };

const SUB_RE = /^[a-z0-9-]{1,20}$/;
const GH_PART_RE = /^[\w.-]+$/;

function isName(base: string, sub: string | undefined): boolean {
  if (!NAME_LABEL_RE.test(base)) return false;
  for (const p of RESERVED_LABELS) if (base === p || base.startsWith(`${p}-`)) return false;
  return sub === undefined || SUB_RE.test(sub);
}

/** The cast a /c/ or /card/ path means, or null. Percent-encoding is refused
 *  outright: no real name or repo path needs it, and it is how `..` and `/`
 *  would be smuggled past the segment checks. */
export function parseSharePath(pathname: string, prefix: "/c/" | "/card/"): ShareTarget | null {
  if (!pathname.startsWith(prefix) || pathname.includes("%")) return null;
  let rest = pathname.slice(prefix.length).replace(/\/+$/, "");
  if (prefix === "/card/") {
    if (!rest.endsWith(".png")) return null;
    rest = rest.slice(0, -".png".length);
  }
  const parts = rest.split("/");
  if (parts[0] === "gh") {
    const [, owner, repo, ...path] = parts;
    if (!owner || !repo || path.length === 0) return null;
    if (![owner, repo, ...path].every((p) => GH_PART_RE.test(p) && p !== "." && p !== "..")) return null;
    let file = path.join("/");
    // A card for a .yaml cast drops the extension; one for a .cast keeps it.
    if (prefix === "/card/" && !/\.cast$/i.test(file)) file += ".yaml";
    if (!/\.(cast|ya?ml)$/i.test(file)) return null;
    return { kind: "gh", owner, repo, path: file };
  }
  if (parts.length > 2) return null;
  const base = parts[0].toLowerCase();
  const sub = parts[1]?.toLowerCase();
  if (!isName(base, sub)) return null;
  return { kind: "name", name: sub === undefined ? base : `${base}/${sub}` };
}

export function hashForShare(t: ShareTarget): string {
  return t.kind === "name" ? `#${t.name}` : `#gh=${t.owner}/${t.repo}/${t.path}`;
}

export function sharePathFor(t: ShareTarget): string {
  return t.kind === "name" ? `/c/${t.name}` : `/c/gh/${t.owner}/${t.repo}/${t.path}`;
}

export function cardPathFor(t: ShareTarget): string {
  return t.kind === "name" ? `/card/${t.name}.png` : `/card/gh/${t.owner}/${t.repo}/${t.path.replace(/\.ya?ml$/i, "")}.png`;
}

/** Link-preview crawlers (spec §3). Matched by their own product tokens only:
 *  the in-app browsers of Facebook, Instagram and LinkedIn carry `FBAN`,
 *  `Instagram` and `LinkedInApp` — a person, who must get the cast. */
const BOT_RE = /facebookexternalhit|facebot|linkedinbot|twitterbot|slackbot|discordbot|whatsapp\/|telegrambot|bluesky|cardyb|mastodon\/|redditbot|applebot|googlebot|skypeuripreview|iframely|embedly|pinterest|viber/i;

export function isPreviewBot(userAgent: string | null): boolean {
  return !!userAgent && BOT_RE.test(userAgent);
}

const TITLE_MAX = 120;
const LINE_MAX = 300;

function clip(s: string, max: number): string {
  const one = s.replace(/\s+/g, " ").trim();
  return one.length <= max ? one : one.slice(0, max - 1).trimEnd() + "…";
}

/** title and subtitle from a published cast's header — the first YAML
 *  document only (later documents are parts, with titles of their own, and
 *  the audio). In a published cast that document is a header under a
 *  `playlist:` key (`playlist.title`, `playlist.subtitle`); only when it has
 *  no `playlist` object (a single-figure cast, whose first document is the
 *  spec itself) are the top-level `title` / `subtitle` read. A locked
 *  envelope has neither, so a private cast never puts a word on a card. */
export function castCardText(text: string): CastCardText {
  // A .cast file (script): `# Title` on top, `subtitle:` among the settings
  // under it, all before the first page (`##`) or the first indented line.
  // (A YAML file may open with a `# comment`; its spec keys at column 0 say which it is.)
  if (/^\s*#\s+\S/.test(text) && !/^(playlist|elements|commands|title|template)\s*:/m.test(text)) return scriptCardText(text);
  const first = text.split(/^---\s*$/m, 1)[0];
  let head: unknown;
  try {
    head = yaml.load(first);
  } catch {
    return {};
  }
  if (!head || typeof head !== "object") return {};
  const top = head as Record<string, unknown>;
  const pl = top.playlist;
  const src = pl && typeof pl === "object" ? (pl as Record<string, unknown>) : top;
  const { title, subtitle, format, thumb, tags } = src;
  const out: CastCardText = {};
  if (typeof title === "string" && title.trim()) out.title = clip(title, TITLE_MAX);
  if (typeof subtitle === "string" && subtitle.trim()) out.subtitle = clip(subtitle, LINE_MAX);
  if (typeof format === "string") out.format = format;
  const tagList = Array.isArray(tags) ? tags.filter((x): x is string => typeof x === "string") : typeof tags === "string" ? tags.split(",") : [];
  if (tagList.length) out.tags = tagList.map((x) => x.trim()).filter(Boolean);
  const t = readThumb(thumb);
  if (t) out.thumb = t;
  return out;
}

/** castCardText for a script — src/spec/script's head, read by hand (netlify/lib must not import src/). */
function scriptCardText(text: string): CastCardText {
  const out: CastCardText = {};
  const scalar = (v: string): string => {
    const t = v.trim();
    if (t.startsWith('"')) {
      try {
        return String(JSON.parse(t));
      } catch {
        return t;
      }
    }
    return t;
  };
  const all = text.replace(/\r\n?/g, "\n").split("\n");
  for (let i = 0; i < all.length; i++) {
    const line = all[i];
    // `thumb:` is a line (thumb.mts) — or, from the first round, a block of indented lines read as YAML.
    const thumbLine = /^thumb:\s+(.+)$/.exec(line);
    if (thumbLine) {
      // The app's printer writes the line as a quoted YAML string (`thumb: "band \"…\""`); hand-written lines are bare.
      const raw = thumbLine[1].trim();
      const t = readThumb(raw.startsWith('"') ? scalar(raw) : raw.replace(/^'(.*)'$/, "$1").replace(/''/g, "'"));
      if (t) out.thumb = t;
      continue;
    }
    if (/^thumb:\s*$/.test(line)) {
      let j = i + 1;
      while (j < all.length && /^\s+\S/.test(all[j])) j++;
      try {
        const t = readThumb(yaml.load(all.slice(i + 1, j).join("\n")));
        if (t) out.thumb = t;
      } catch {
        /* a broken block is no thumb */
      }
      i = j - 1;
      continue;
    }
    if (/^##(\s|$)/.test(line) || /^\s+\S/.test(line)) break;
    const tagLine = /^tags:\s+(.+)$/.exec(line);
    if (tagLine) {
      const v = tagLine[1].trim().replace(/^\[|\]$/g, "");
      out.tags = v.split(",").map((x) => scalar(x).trim()).filter(Boolean);
      continue;
    }
    const fmt = /^format:\s+(\S+)/.exec(line);
    if (fmt) {
      out.format = scalar(fmt[1]);
      continue;
    }
    const h = /^#\s+(.+)$/.exec(line);
    if (h && out.title === undefined) {
      const t = h[1].trim();
      if (t) out.title = clip(t, TITLE_MAX);
      continue;
    }
    const sub = /^subtitle:\s+(.+)$/.exec(line);
    if (sub) {
      const t = scalar(sub[1]);
      if (t) out.subtitle = clip(t, LINE_MAX);
    }
  }
  return out;
}

// src/course/document.ts's option-line shape (netlify/lib must not import src/).
const OPTION_RE = /^([a-zæøå][a-zæøå0-9_-]*)\s*:\s*(.+)$/;

function optionsOf(line: string): [string, string][] {
  return line
    .split("·")
    .map((part) => OPTION_RE.exec(part.trim()))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => [m[1], m[2].trim()]);
}

// src/course/document.ts's line shapes: a lecture heading (headerEnd — the
// header ends at the first `##`), any heading, a tag line, a rule.
const LECTURE_RE = /^##\s/;
const HEADING_RE = /^#{1,6}\s/;
const TAG_LINE_RE = /^#[a-zæøå]/i;
const RULE_RE = /^-{3,}\s*$/;

/** A course's course.md: its `# Title`, and the first line of the intro
 *  paragraph — skipping the `key: value` option lines, `#tag` lines and rules
 *  that may sit around it. A course with `private: true` gives nothing at all:
 *  a private course must leave no text on a card. (`private` is looked for in
 *  every line up to the first lecture heading — parseCourse's own reach — so
 *  a misplaced option still locks it.) */
export function courseCardText(md: string): { title?: string; subtitle?: string } {
  const lines = md.split(/\r?\n/).map((l) => l.trim());
  const at = lines.findIndex((l) => /^# \S/.test(l));
  if (at < 0) return {};
  const body: string[] = [];
  for (const l of lines.slice(at + 1)) {
    if (LECTURE_RE.test(l)) break;
    if (!l || RULE_RE.test(l) || HEADING_RE.test(l) || TAG_LINE_RE.test(l)) continue;
    body.push(l);
  }
  if (body.some((l) => optionsOf(l).some(([k, v]) => k === "private" && v === "true"))) return {};
  const out: { title?: string; subtitle?: string } = { title: clip(lines[at].slice(2), TITLE_MAX) };
  const intro = body.find((l) => optionsOf(l).length === 0 && !/^status\s*:/.test(l));
  if (intro) out.subtitle = clip(intro, LINE_MAX);
  return out;
}

export interface Card {
  title: string;
  description?: string;
  /** The /c/ link itself — og:url and canonical. */
  url: string;
  /** Absolute. */
  image: string;
  /** The picture's pixel size, [width, height] — og:image:width/height. */
  imageSize?: readonly [number, number];
  /** The # link that plays — the refresh and the fallback link. */
  playUrl: string;
}

export const GENERIC = { title: "drawcast", description: "Drawn explanations you can watch and play with", image: "/share-card.png" } as const;

/** /share-card.png's size, and a published poster's (the figure's 1000×750 canvas). */
export const GENERIC_SIZE = [1200, 630] as const;
export const POSTER_SIZE = [1000, 750] as const;

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function cardHtml(card: Card): string {
  const t = esc(card.title);
  const d = card.description ? esc(card.description) : null;
  const meta = [
    `<meta property="og:type" content="website">`,
    `<meta property="og:site_name" content="drawcast">`,
    `<meta property="og:title" content="${t}">`,
    ...(d ? [`<meta property="og:description" content="${d}">`, `<meta name="description" content="${d}">`] : []),
    `<meta property="og:url" content="${esc(card.url)}">`,
    `<meta property="og:image" content="${esc(card.image)}">`,
    ...(card.imageSize ? [`<meta property="og:image:width" content="${card.imageSize[0]}">`, `<meta property="og:image:height" content="${card.imageSize[1]}">`] : []),
    `<meta name="twitter:card" content="summary_large_image">`,
    `<link rel="canonical" href="${esc(card.url)}">`,
    `<meta http-equiv="refresh" content="0; url=${esc(card.playUrl)}">`,
  ];
  return `<!doctype html><html><head><meta charset="utf-8"><title>${t} — drawcast</title>${meta.join("")}</head><body><a href="${esc(card.playUrl)}">${t}</a></body></html>`;
}
