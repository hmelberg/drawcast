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

export interface Playlist {
  meta: PlaylistMeta;
  entries: PlaylistEntry[];
  warnings: string[];
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

function classifyDocs(docs: Record<string, unknown>[]): Playlist {
  const warnings: string[] = [];
  let meta: PlaylistMeta = { ...DEFAULT_META };
  const entries: PlaylistEntry[] = [];
  for (const doc of docs) {
    if ("playlist" in doc) {
      const raw = doc.playlist;
      if (isPlainObject(raw)) meta = readMeta(raw, warnings);
      else warnings.push("playlist header is not a mapping — ignored");
    } else if ("chapter" in doc) {
      const raw = doc.chapter;
      const title = typeof raw === "string" ? raw : isPlainObject(raw) && typeof raw.title === "string" ? raw.title : null;
      if (title) entries.push({ kind: "chapter", title });
      else warnings.push("chapter document without a title — ignored");
    } else {
      entries.push({ kind: "item", spec: doc as Spec });
    }
  }
  return { meta, entries, warnings };
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

/** The item's spec plus a soft exit: hold for the gap, then un-draw everything. */
function withSoftExit(spec: Spec, gap: number): Spec {
  return { ...spec, commands: [...(spec.commands ?? []), { pause: gap }, { clear: {} }] };
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
      const crossing = item.chapter !== items[i - 1].chapter ? item.chapter : undefined;
      if (crossing) seq.push(makeChapterCard({ chapter: crossing, next: itemTitle(item), gate: "auto", gap: meta.gap }));
    }
    const last = i === items.length - 1;
    seq.push(!last && meta.transitions === "auto" ? withSoftExit(item.spec, meta.gap) : item.spec);
  });
  return seq;
}
