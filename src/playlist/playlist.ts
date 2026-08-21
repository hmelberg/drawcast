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
  /** How playback continues after an item: wait for a click, or auto after gap seconds. */
  advance: "click" | "auto";
  gap: number;
  /** auto = synthesized "Next: …" title cards between items; none = hard cuts. */
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

// ---- Transition title cards ----------------------------------------------
// A transition is itself a tiny spec played through the ordinary renderer, so
// it appears identically in live playback, the #gdoc viewer, and video export
// (which rasterizes the SVG — a DOM overlay would vanish from exports).

export interface TitleCardOptions {
  /** Title of the upcoming item. */
  next: string;
  /** Set when this transition crosses into a new chapter. */
  chapter?: string;
  level?: "basic" | "advanced";
  gate: "click" | "auto";
  /** Seconds to hold on auto advance (default 1). */
  gap?: number;
}

export function makeTitleCard(opts: TitleCardOptions): Spec {
  const elements: Spec["elements"] = [
    {
      id: "card_kicker",
      type: "text",
      text: opts.chapter ?? "Next",
      x: 500,
      y: 465,
      font_size: 28,
      style: { opacity: 0.7 },
    },
    { id: "card_title", type: "text", text: opts.next, x: 500, y: 390, font_size: 52 },
    { id: "card_line", type: "path", points: [[330, 352], [670, 348]] },
  ];
  if (opts.level) {
    elements.push({ id: "card_level", type: "text", text: opts.level, x: 500, y: 305, font_size: 22, style: { opacity: 0.6 } });
  }
  const commands: Spec["commands"] = [
    { draw: elements.map((e) => e.id), speak: opts.chapter ? `${opts.chapter}. Next: ${opts.next}` : `Next: ${opts.next}` },
  ];
  commands.push(opts.gate === "click" ? { wait: "click" } : { pause: opts.gap ?? 1 });
  return { elements, commands };
}
