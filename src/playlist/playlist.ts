// The playlist model: a linear multi-document YAML stream (documents separated
// by ---). A document shaped {playlist: {...}} is the header (title, advance
// mode), {chapter: ...} starts a chapter group, and every other mapping is an
// ordinary spec item. Play order IS document order; the chapter tree shown in
// navigation is derived from the flat stream, never encoded as nesting.
// A single document (JSON or YAML) is a one-item playlist — exactly the
// pre-playlist behavior, so every existing drawcast keeps working.

import { CORE_SCHEMA, dump, loadAll } from "js-yaml";
import { desmartenJson } from "../spec/extract";
import { formatSpec, parseSpecText, type SpecFormat } from "../spec/text";
import type { Spec } from "../spec/types";
import { narrationLanguage } from "../export/video";

export interface PlaylistMeta {
  title?: string;
  /** Shown under the title on the opening title page. */
  subtitle?: string;
  /** How playback continues after an item: wait for a click, or auto after gap seconds. */
  advance: "click" | "auto";
  gap: number;
  /**
   * auto = stay on the finished drawing until the viewer continues, un-draw
   * it, and play a chapter card where a new chapter begins; none = hard cuts.
   */
  transitions: "auto" | "none";
}

export type PlaylistEntry =
  | { kind: "chapter"; title: string }
  | { kind: "item"; spec: Spec };

/**
 * Narration baked at publish time, carried inside the published document.
 *
 * Keyed by speechKey (the sentence, plus who says it and how) — never by
 * position, because a drawcast branches: see render/published-speech.ts. `mp3`
 * is base64, which is how bytes survive in a text file.
 *
 * On the PLAYLIST rather than on a spec, and deliberately: specs go into the
 * editor's textarea, the version history, the localStorage library and the
 * prompts sent to the model, and none of those can carry a megabyte of base64
 * (design §15.2). formatPlaylist never writes this back out.
 */
export interface AudioTrack {
  lang: string;
  lines: Record<string, { mp3: string; ms: number }>;
}

export interface Playlist {
  meta: PlaylistMeta;
  entries: PlaylistEntry[];
  warnings: string[];
  /** Present only on a document published with inline audio. */
  audio?: AudioTrack;
}

export const DEFAULT_META: PlaylistMeta = { advance: "click", gap: 1, transitions: "auto" };

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Wrap one spec as a playlist (the single-figure case). */
export function singlePlaylist(spec: Spec): Playlist {
  return { meta: { ...DEFAULT_META }, entries: [{ kind: "item", spec }], warnings: [] };
}

function readMeta(raw: Record<string, unknown>, warnings: string[]): PlaylistMeta {
  const meta: PlaylistMeta = { ...DEFAULT_META };
  if (typeof raw.title === "string") meta.title = raw.title;
  if (typeof raw.subtitle === "string") meta.subtitle = raw.subtitle;
  if (raw.advance !== undefined) {
    if (raw.advance === "click" || raw.advance === "auto") meta.advance = raw.advance;
    else warnings.push(`playlist.advance must be "click" or "auto" (got ${JSON.stringify(raw.advance)}) — using click`);
  }
  if (typeof raw.gap === "number") meta.gap = raw.gap;
  if (raw.transitions !== undefined) {
    if (raw.transitions === "auto" || raw.transitions === "none") meta.transitions = raw.transitions;
    else warnings.push(`playlist.transitions must be "auto" or "none" (got ${JSON.stringify(raw.transitions)}) — using auto`);
  }
  return meta;
}

const SEPARATOR_RE = /^---\s*$/m;

/**
 * Parse playlist text: a multi-document YAML stream, or any single document
 * that parseSpecText accepts (JSON, YAML, JSON embedded in prose). Item specs
 * are NOT validated here — callers run validateSpec per item.
 */
export function parsePlaylistText(text: string): Playlist {
  if (SEPARATOR_RE.test(text)) {
    // Same tolerance as single-spec parsing: Google Docs curls quotes.
    for (const candidate of [text, desmartenJson(text)]) {
      let docs: unknown[];
      try {
        docs = loadAll(candidate, undefined, { schema: CORE_SCHEMA });
      } catch {
        continue;
      }
      const present = docs.filter((d) => d !== null && d !== undefined);
      if (present.length === 0 || !present.every(isPlainObject)) continue;
      return classifyDocs(present);
    }
  }
  const single = parseSpecText(text).value as Spec;
  return singlePlaylist(single);
}

/** Tolerant read of a baked-audio document; anything malformed is ignored. */
function readAudio(raw: unknown, warnings: string[]): AudioTrack | undefined {
  if (!isPlainObject(raw) || !isPlainObject(raw.lines)) {
    warnings.push("audio document is not a mapping with `lines` — ignored");
    return undefined;
  }
  const lines: AudioTrack["lines"] = {};
  for (const [key, value] of Object.entries(raw.lines)) {
    if (isPlainObject(value) && typeof value.mp3 === "string" && value.mp3.length > 0) {
      lines[key] = { mp3: value.mp3, ms: typeof value.ms === "number" ? value.ms : 0 };
    }
  }
  return { lang: typeof raw.lang === "string" ? raw.lang : "", lines };
}

function classifyDocs(docs: Record<string, unknown>[]): Playlist {
  const warnings: string[] = [];
  let meta: PlaylistMeta = { ...DEFAULT_META };
  const entries: PlaylistEntry[] = [];
  let audio: AudioTrack | undefined;
  for (const doc of docs) {
    if ("playlist" in doc) {
      const raw = doc.playlist;
      if (isPlainObject(raw)) meta = readMeta(raw, warnings);
      else warnings.push("playlist header is not a mapping — ignored");
    } else if ("audio" in doc) {
      // MUST be an explicit branch: the else below treats any unrecognized
      // mapping as a spec, so an unhandled audio document becomes a figure
      // with nothing to draw and then fails validateSpec, taking the whole
      // drawcast down with it.
      audio = readAudio(doc.audio, warnings) ?? audio;
    } else if ("chapter" in doc) {
      const raw = doc.chapter;
      const title = typeof raw === "string" ? raw : isPlainObject(raw) && typeof raw.title === "string" ? raw.title : null;
      if (title) entries.push({ kind: "chapter", title });
      else warnings.push("chapter document without a title — ignored");
    } else {
      entries.push({ kind: "item", spec: doc as Spec });
    }
  }
  return { meta, entries, warnings, ...(audio ? { audio } : {}) };
}

export interface PlaylistItem {
  spec: Spec;
  /** Title of the chapter this item falls under, when any. */
  chapter?: string;
  /** Index among items (chapters excluded). */
  index: number;
}

export function itemsOf(playlist: Playlist): PlaylistItem[] {
  const items: PlaylistItem[] = [];
  let chapter: string | undefined;
  for (const e of playlist.entries) {
    if (e.kind === "chapter") chapter = e.title;
    else items.push({ spec: e.spec, chapter, index: items.length });
  }
  return items;
}

/**
 * The language this playlist narrates in, going by its items' specs. Both the
 * CC-subtitles feature and Share's YouTube panel need this same answer — one
 * copy, so a future `narrationLanguage` change cannot fix one and not the other.
 */
export function sourceLanguage(playlist: Playlist): string {
  return narrationLanguage(itemsOf(playlist).map((i) => i.spec));
}

/**
 * `playlist` with each item's spec swapped for the corresponding entry in
 * `specs` (same order as `itemsOf`) — a FRESH playlist, `playlist` itself is
 * never mutated. This is what keeps a translation from ever being written
 * back onto the document it was translated from.
 */
export function playlistWithSpecs(playlist: Playlist, specs: Spec[]): Playlist {
  let i = 0;
  return {
    ...playlist,
    entries: playlist.entries.map((e) => (e.kind === "item" ? { kind: "item" as const, spec: specs[i++] } : e)),
  };
}

/** True when the playlist is just one bare spec (no header worth keeping, no chapters). */
export function isSingle(playlist: Playlist): boolean {
  return (
    playlist.entries.length === 1 &&
    playlist.entries[0].kind === "item" &&
    playlist.meta.title === undefined &&
    playlist.meta.subtitle === undefined &&
    playlist.meta.advance === DEFAULT_META.advance &&
    playlist.meta.gap === DEFAULT_META.gap &&
    playlist.meta.transitions === DEFAULT_META.transitions
  );
}

const YAML_OPTS = { lineWidth: -1, noRefs: true } as const;

/**
 * Serialize for the editor/export. A single bare spec formats exactly as before
 * (JSON allowed); a real playlist is always a YAML multi-document stream.
 */
export function formatPlaylist(playlist: Playlist, format: SpecFormat): string {
  if (isSingle(playlist)) {
    return formatSpec((playlist.entries[0] as { spec: Spec }).spec, format);
  }
  const parts: string[] = [];
  const header: Record<string, unknown> = {};
  if (playlist.meta.title !== undefined) header.title = playlist.meta.title;
  if (playlist.meta.subtitle !== undefined) header.subtitle = playlist.meta.subtitle;
  if (playlist.meta.advance !== DEFAULT_META.advance) header.advance = playlist.meta.advance;
  if (playlist.meta.gap !== DEFAULT_META.gap) header.gap = playlist.meta.gap;
  if (playlist.meta.transitions !== DEFAULT_META.transitions) header.transitions = playlist.meta.transitions;
  if (Object.keys(header).length > 0) parts.push(dump({ playlist: header }, YAML_OPTS));
  for (const e of playlist.entries) {
    if (e.kind === "chapter") parts.push(dump({ chapter: e.title }, YAML_OPTS));
    else parts.push(dump(e.spec, YAML_OPTS));
  }
  return parts.join("---\n");
}

/**
 * Serialize FOR PUBLISHING, with baked audio appended as its own document.
 *
 * Separate from formatPlaylist on purpose. formatPlaylist is what the editor
 * textarea, the version stack and the localStorage library all go through, and
 * none of them can carry a megabyte of base64 — the twenty-deep history alone
 * would hold twenty copies of it (design §15.2). Keeping the audio out of that
 * function is what makes the rule structural instead of a convention someone
 * has to remember, so this is the ONLY place that writes an audio document.
 *
 * A single-spec playlist is promoted to a stream: it now has a second document
 * to carry, and `---` is what says so.
 */
export function formatPublished(playlist: Playlist, audio: AudioTrack | null): string {
  const body = formatPlaylist(playlist, "yaml");
  if (!audio || Object.keys(audio.lines).length === 0) return body;
  // lineWidth:-1 (YAML_OPTS) is load-bearing here: js-yaml folds long scalars
  // across lines by default, which would corrupt every base64 payload at once.
  return `${body.replace(/\n*$/, "\n")}---\n${dump({ audio }, YAML_OPTS)}`;
}

export function itemTitle(item: PlaylistItem): string {
  return item.spec.title ?? `Part ${item.index + 1}`;
}

// ---- Title page and chapter cards ----------------------------------------
// A card is itself a tiny spec played through the ordinary renderer, so it
// appears identically in live playback, the #gdoc viewer, and video export
// (which rasterizes the SVG — a DOM overlay would vanish from exports).
// Text elements carry explicit sketch draws, so titles FADE in (text reveal
// is an opacity ramp) and every card fades back out through clear.

/** Font size that keeps a one-line title inside the 1000-unit canvas (no word-wrap for plain text). */
function titleFont(text: string): number {
  return Math.max(34, Math.min(64, Math.round(900 / (0.55 * Math.max(1, text.length)))));
}

export interface TitlePageOptions {
  title: string;
  subtitle?: string;
  /** Seconds the closing hold lasts (default 1). */
  gap?: number;
}

/**
 * The TV-style opening card: the title fades in over its underline, the
 * subtitle follows, the camera pushes in slowly, then everything fades out.
 * Always auto-continues — the viewer already pressed play.
 */
export function makeTitlePage(opts: TitlePageOptions): Spec {
  const elements: Spec["elements"] = [
    {
      id: "tp_title",
      type: "text",
      text: opts.title,
      x: 500,
      y: 430,
      font_size: titleFont(opts.title),
      draw: { mode: "sketch", duration: 1.2 },
    },
    { id: "tp_line", type: "path", points: [[300, 372], [700, 368]] },
  ];
  if (opts.subtitle) {
    elements.push({
      id: "tp_subtitle",
      type: "text",
      text: opts.subtitle,
      x: 500,
      y: 315,
      font_size: 28,
      style: { opacity: 0.75 },
      draw: { mode: "sketch", duration: 0.9 },
    });
  }
  const commands: Spec["commands"] = [{ draw: ["tp_title", "tp_line"], speak: opts.title }];
  if (opts.subtitle) commands.push({ draw: ["tp_subtitle"], speak: opts.subtitle });
  commands.push({ camera: { center: { ref: "tp_title" }, zoom: 1.08, duration: Math.max(1.6, opts.gap ?? 1) } });
  commands.push({ clear: {} });
  return { elements, commands };
}

export interface ChapterCardOptions {
  /** The chapter being entered. */
  chapter: string;
  /** Title of the chapter's first item, shown as a byline. */
  next?: string;
  gate: "click" | "auto";
  /** Seconds to hold on auto advance (default 1). */
  gap?: number;
}

/** The card played where a new chapter begins — the only interstitial left. */
export function makeChapterCard(opts: ChapterCardOptions): Spec {
  const elements: Spec["elements"] = [
    { id: "ch_kicker", type: "text", text: "Chapter", x: 500, y: 465, font_size: 24, style: { opacity: 0.6 } },
    {
      id: "ch_title",
      type: "text",
      text: opts.chapter,
      x: 500,
      y: 390,
      font_size: Math.min(56, titleFont(opts.chapter)),
      draw: { mode: "sketch", duration: 1 },
    },
    { id: "ch_line", type: "path", points: [[330, 352], [670, 348]] },
  ];
  if (opts.next) {
    elements.push({
      id: "ch_next",
      type: "text",
      text: opts.next,
      x: 500,
      y: 300,
      font_size: 26,
      style: { opacity: 0.7 },
      draw: { mode: "sketch", duration: 0.7 },
    });
  }
  const commands: Spec["commands"] = [
    { draw: ["ch_kicker", "ch_title", "ch_line"], speak: `Next chapter: ${opts.chapter}` },
  ];
  if (opts.next) commands.push({ draw: ["ch_next"] });
  commands.push(opts.gate === "click" ? { wait: "click" } : { pause: opts.gap ?? 1 });
  commands.push({ clear: {} });
  return { elements, commands };
}

export interface NextCardOptions {
  /** Title of the lecture that follows this one. */
  next: string;
  /** The NEXT lecture's 1-based number. */
  position: number;
  total: number;
  /** Seconds to hold before fading out (default 1.5). */
  gap?: number;
}

/**
 * The card a course lecture ends on. Title only: the link target does not exist
 * until the course is published, and a burnt-in URL goes stale the first time
 * the course is reordered. The overview page carries the clickable version.
 */
export function makeNextCard(opts: NextCardOptions): Spec {
  const elements: Spec["elements"] = [
    { id: "nx_kicker", type: "text", text: "Next", x: 500, y: 465, font_size: 24, style: { opacity: 0.6 } },
    {
      id: "nx_title",
      type: "text",
      text: opts.next,
      x: 500,
      y: 390,
      font_size: Math.min(56, titleFont(opts.next)),
      draw: { mode: "sketch", duration: 1 },
    },
    { id: "nx_line", type: "path", points: [[330, 352], [670, 348]] },
    {
      id: "nx_count",
      type: "text",
      text: `${opts.position} of ${opts.total}`,
      x: 500,
      y: 300,
      font_size: 26,
      style: { opacity: 0.7 },
      draw: { mode: "sketch", duration: 0.7 },
    },
  ];
  return {
    elements,
    commands: [
      { draw: ["nx_kicker", "nx_title", "nx_line"], speak: `Next: ${opts.next}` },
      { draw: ["nx_count"] },
      { pause: opts.gap ?? 1.5 },
      { clear: {} },
    ],
  };
}

/** The item's spec plus a soft exit: hold for the gap, then un-draw everything. */
function withSoftExit(spec: Spec, gap: number): Spec {
  return { ...spec, commands: [...(spec.commands ?? []), { pause: gap }, { clear: {} }] };
}

/** Duration and magnification of the semantic-zoom exit, shared with the live path. */
export const ZOOM_EXIT = { seconds: 1.6, zoom: 4.5 } as const;

/**
 * The semantic-zoom exit: instead of holding and un-drawing in place, the
 * figure pushes INTO the element the next item names (zoom_from), then fades
 * there — so the next figure feels like the inside of this one. An unknown
 * id degrades gracefully (the camera command centers on the canvas).
 */
function withZoomExit(spec: Spec, ref: string, gap: number): Spec {
  return {
    ...spec,
    commands: [
      ...(spec.commands ?? []),
      { pause: Math.min(gap, 0.6) },
      { camera: { center: { ref }, zoom: ZOOM_EXIT.zoom, duration: ZOOM_EXIT.seconds } },
      { clear: {} },
    ],
  };
}

/**
 * The specs a video export plays, in order — and the single description of
 * what a viewer sees live: title page first, each item un-drawing itself
 * before the next, a chapter card where a new chapter begins. Export always
 * auto-advances; there is no one to click.
 */
export function exportSequence(playlist: Playlist): Spec[] {
  const items = itemsOf(playlist);
  const { meta } = playlist;
  const seq: Spec[] = [];
  if (meta.title !== undefined && items.length > 0) {
    seq.push(makeTitlePage({ title: meta.title, subtitle: meta.subtitle, gap: meta.gap }));
  }
  items.forEach((item, i) => {
    if (i > 0 && meta.transitions === "auto") {
      // A semantic zoom IS the transition — it replaces the chapter card.
      const crossing = item.chapter !== items[i - 1].chapter && !item.spec.zoom_from ? item.chapter : undefined;
      if (crossing) seq.push(makeChapterCard({ chapter: crossing, next: itemTitle(item), gate: "auto", gap: meta.gap }));
    }
    const last = i === items.length - 1;
    const zoomRef = !last ? items[i + 1].spec.zoom_from : undefined;
    seq.push(
      last || meta.transitions !== "auto"
        ? item.spec
        : zoomRef
          ? withZoomExit(item.spec, zoomRef, meta.gap)
          : withSoftExit(item.spec, meta.gap),
    );
  });
  return seq;
}
