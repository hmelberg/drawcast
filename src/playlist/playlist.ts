// The playlist model: a linear multi-document YAML stream (documents separated
// by ---). A document shaped {playlist: {...}} is the header (title, advance
// mode), {chapter: ...} starts a chapter group, and every other mapping is an
// ordinary spec item. Play order IS document order; the chapter tree shown in
// navigation is derived from the flat stream, never encoded as nesting.
// A single document (JSON or YAML) is a one-item playlist — exactly the
// pre-playlist behavior, so every existing drawcast keeps working.

import { readThumb } from "../../netlify/lib/thumb.mts";
import { readCastVoices, type CastVoices } from "../export/gemini-tts";
import { leftoverFoldMarker, leftoverFoldMessage } from "../ui/spec-fold";
import { CORE_SCHEMA, dump, load, loadAll } from "js-yaml";
import { cardElements, titleFont } from "../spec/card";
import { desmartenJson } from "../spec/extract";
import { dumpSpecYaml, formatSpec, parseSpecText, type SpecFormat } from "../spec/text";
import { parseScriptPages, printScriptPages } from "../spec/script/index";
import { looksLikeScript } from "../spec/script/detect";
import type { Command, Spec } from "../spec/types";
import { narrationLanguage } from "../export/video";
import { resolveSibling } from "./inset-ref";

export interface PlaylistMeta {
  title?: string;
  /** Shown under the title on the opening title page. */
  subtitle?: string;
  /**
   * The founding Generate request, when AI-generated. Original only — revise
   * instructions live in history. Carried in the file so a Drive/disk/GitHub
   * round trip (and the published copy) keeps the request that started it;
   * the localStorage library keeps its own copy in SavedDrawing.prompt.
   */
  prompt?: string;
  /**
   * Comments on the published page (C1): the giscus wiring the VIEWER needs.
   * Carried in the file because the viewer runs in a stranger's browser — it
   * can read the repo from its own URL but has no way to reach the author's
   * settings for the ids. Written onto the published COPY only (Publish
   * prepares a copy, §F.3.1); an authored one in a local doc rides along
   * harmlessly. Comments live in the AUTHOR's GitHub Discussions.
   */
  comments?: { repoId: string; category: string; categoryId: string };
  /**
   * Whether the published copy reports plays to the view counter. Written
   * onto the published COPY only, like `comments` — and written ONLY when
   * false: absent means counting, so everything published before this feature
   * existed is included without a republish, and an ordinary publish keeps
   * the file shape it has always had. Off is honoured by the player not
   * calling at all: nothing is recorded, rather than recorded and filtered.
   */
  views?: boolean;
  /**
   * The lecture that follows this one in its course — written onto the
   * PUBLISHED copy by publishCourse, which is the one moment the target URL
   * exists, and refreshed on every republish so reordering can never stale
   * it (the objection that kept the drawn next-card link-less). The viewer
   * shows a clickable "Next ▸" pill when playback finishes.
   */
  next?: { title: string; href: string };
  /**
   * The learner backend (spec §2): the Anvil base URL from the course
   * document's `enroll:` line, written onto the PUBLISHED copy by
   * publishCourse so a lecture opened straight from an email link still
   * knows where events go. The viewer only reports when the stored code
   * came from this very app.
   */
  enroll?: string;
  /**
   * The image a viewer sees while the cast loads (2026-09-24): a URL (or a
   * data URL) of the author's own picture. Publish bakes it into the poster
   * PNG beside the cast; without it the poster is the finished drawing.
   */
  poster?: string;
  /** The listing picture's words and style (thumbnail round, 2026-10-04 —
   *  netlify/lib/thumb.mts): drawn by the site over the poster, never in the player. */
  thumb?: string;
  /** The cast's own narration voices, per speaker (2026-10-07; export/gemini-tts.ts):
   *  `a: gemini:Charon | dry, warm historian`, `b: en-US-Studio-O`. Absent: the defaults. */
  voices?: CastVoices;
  /** How playback continues after an item: wait for a click, or auto after gap seconds. */
  advance: "click" | "auto";
  gap: number;
  /**
   * auto = stay on the finished drawing until the viewer continues, un-draw
   * it, and play a chapter card where a new chapter begins; none = hard cuts.
   */
  transitions: "auto" | "none";
  /**
   * Topic tags (2026-10-03, the front page): a few words a drawcast is about
   * ("health", "statistics"), lower case. Published with it, sent to the
   * registry, and what the front page's topic rows and search read.
   */
  tags?: string[];
  /**
   * The author's choice of front-page format, when the one read from the
   * drawcast's structure (standalone/transcript.ts castFormat) is wrong.
   */
  format?: "drawcast" | "quiz" | "xplanation";
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
  /** `voice` records which cloud voice spoke the clip (B12) — absent on older
   *  bakes and on default-chain clips. Playback never reads it; the bake's
   *  reuse check does, so a changed voice re-synthesizes instead of keeping a
   *  recording in the old one. */
  lines: Record<string, { mp3: string; ms: number; voice?: string; pause?: number }>;
}

export interface Playlist {
  meta: PlaylistMeta;
  entries: PlaylistEntry[];
  warnings: string[];
  /** Present only on a document published with inline audio. */
  audio?: AudioTrack;
}

// advance defaults to auto (C10, 2026-09-02): a chapter boundary is
// structural — the piece is moving on, and a viewer watching a lecture
// should not have to click to reach section 2. The timed card has been
// shipping in every exported video all along (exportSequence hardcodes
// auto). `advance: click` remains per-playlist for kiosks and self-paced
// exercises, with the &advance= URL override on top. Note the serializer
// omits default values, so playlists that never wrote `advance` flip with
// this default — replace-don't-freeze, by ruling.
export const DEFAULT_META: PlaylistMeta = { advance: "auto", gap: 1, transitions: "auto" };

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * The parts of a lecture, plus the chapter each part falls under, as entries:
 * a chapter entry wherever the chapter changes. ONE copy, because there were
 * two places turning parts into a playlist — the course runner, which made
 * chapter entries, and #parts=N in main.ts, which mapped specs straight to
 * items and dropped `chapterOf` on the floor.
 */
export function entriesForParts(specs: Spec[], chapterOf: (string | undefined)[]): PlaylistEntry[] {
  const entries: PlaylistEntry[] = [];
  let chapter: string | undefined;
  specs.forEach((spec, i) => {
    const next = chapterOf[i];
    if (next && next !== chapter) {
      entries.push({ kind: "chapter", title: next });
      chapter = next;
    }
    entries.push({ kind: "item", spec });
  });
  return entries;
}

/** Wrap one spec as a playlist (the single-figure case). */
export function singlePlaylist(spec: Spec): Playlist {
  return { meta: { ...DEFAULT_META }, entries: [{ kind: "item", spec }], warnings: [] };
}

/** `tags: [a, b]` or `tags: a, b` → lower-case, trimmed, deduplicated; at most eight. */
export function readTags(raw: unknown): string[] | undefined {
  const list = Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(",") : [];
  // The registry's rule (drawcast-anvil parsers.TAG_RE): letters, digits,
  // spaces and hyphens, at most 30 — anything else is dropped here, since one
  // bad tag would make the registry refuse the whole registration.
  const out = [...new Set(list.filter((t): t is string => typeof t === "string").map((t) => t.trim().toLowerCase()).filter((t) => /^[\p{L}\p{N} -]{1,30}$/u.test(t)))].slice(0, 8);
  return out.length ? out : undefined;
}

function readMeta(raw: Record<string, unknown>, warnings: string[]): PlaylistMeta {
  const meta: PlaylistMeta = { ...DEFAULT_META };
  if (typeof raw.title === "string") meta.title = raw.title;
  if (typeof raw.subtitle === "string") meta.subtitle = raw.subtitle;
  if (typeof raw.prompt === "string") meta.prompt = raw.prompt;
  const tags = readTags(raw.tags);
  if (tags) meta.tags = tags;
  if (raw.format === "drawcast" || raw.format === "quiz" || raw.format === "xplanation") meta.format = raw.format;
  if (isPlainObject(raw.next)) {
    if (typeof raw.next.title === "string" && typeof raw.next.href === "string") {
      meta.next = { title: raw.next.title, href: raw.next.href };
    } else {
      warnings.push("playlist.next needs title and href — ignored");
    }
  }
  if (typeof raw.enroll === "string") meta.enroll = raw.enroll;
  if (typeof raw.poster === "string") meta.poster = raw.poster;
  const thumb = readThumb(raw.thumb);
  if (thumb) meta.thumb = thumb;
  const voices = readCastVoices(raw.voices);
  if (voices) meta.voices = voices;
  if (isPlainObject(raw.comments)) {
    const c = raw.comments;
    if (typeof c.repoId === "string" && typeof c.categoryId === "string") {
      meta.comments = { repoId: c.repoId, category: typeof c.category === "string" ? c.category : "", categoryId: c.categoryId };
    } else {
      warnings.push("playlist.comments needs repoId and categoryId (from giscus.app) — ignored");
    }
  }
  if (raw.views !== undefined) {
    if (typeof raw.views === "boolean") meta.views = raw.views;
    else warnings.push(`playlist.views must be true or false (got ${JSON.stringify(raw.views)}) — counting`);
  }
  if (raw.advance !== undefined) {
    if (raw.advance === "click" || raw.advance === "auto") meta.advance = raw.advance;
    else warnings.push(`playlist.advance must be "click" or "auto" (got ${JSON.stringify(raw.advance)}) — using auto`);
  }
  if (typeof raw.gap === "number") meta.gap = raw.gap;
  if (raw.transitions !== undefined) {
    if (raw.transitions === "auto" || raw.transitions === "none") meta.transitions = raw.transitions;
    else warnings.push(`playlist.transitions must be "auto" or "none" (got ${JSON.stringify(raw.transitions)}) — using auto`);
  }
  return meta;
}

/**
 * Settings that belong to the DOCUMENT and are not fields of a page spec
 * (spec/schema.ts: specSchema has no `prompt`, no `advance`, …). A page that
 * carries one fails validateSpec with "(root) must NOT have additional
 * properties", which is how a revised drawcast used to become unrunnable, so
 * they are lifted to where they belong rather than left to sink the page.
 * Same set as the script parser's META_SETTINGS (spec/script/parse.ts).
 */
const DOC_SETTINGS = ["subtitle", "prompt", "advance", "gap", "transitions", "next", "enroll", "comments", "views", "poster", "tags", "format"] as const;

/** Move any document settings off a page spec; null when it carried none. */
function takeDocSettings(spec: Record<string, unknown>): Record<string, unknown> | null {
  const raw: Record<string, unknown> = {};
  for (const key of DOC_SETTINGS) {
    if (key in spec) {
      raw[key] = spec[key];
      delete spec[key];
    }
  }
  return Object.keys(raw).length > 0 ? raw : null;
}

/** Has anything to put on a canvas — as opposed to a header mistaken for a page. */
function isDrawable(doc: Record<string, unknown>): boolean {
  return "commands" in doc || "elements" in doc || "template" in doc;
}

const SEPARATOR_RE = /^---\s*$/m;

/**
 * Parse playlist text: a multi-document YAML stream, or any single document
 * that parseSpecText accepts (JSON, YAML, JSON embedded in prose). Item specs
 * are NOT validated here — callers run validateSpec per item.
 */
export function parsePlaylistText(text: string): Playlist {
  const playlist = parsePlaylistBody(text);
  // A folded-data marker left in the text (ui/spec-fold.ts) names data that
  // is not here — say so, never take it silently as content.
  const marker = leftoverFoldMarker(text);
  if (marker) playlist.warnings.push(leftoverFoldMessage(marker));
  return playlist;
}

/**
 * A script carries its baked narration the way a published YAML stream does:
 * after the last `---` line, as an `audio:` document. Split there, so the
 * script parser never meets the base64 and the YAML reader never meets the
 * script. null when the text ends with no such document.
 */
export function splitAudioTail(text: string): { body: string; audio: string } | null {
  const re = /\n---[ \t]*\r?\n(?=audio[ \t]*:)/g;
  let at = -1;
  let len = 0;
  for (let m = re.exec(text); m !== null; m = re.exec(text)) {
    at = m.index;
    len = m[0].length;
  }
  return at < 0 ? null : { body: text.slice(0, at + 1), audio: text.slice(at + len) };
}

function parsePlaylistBody(text: string): Playlist {
  // A .cast file with its narration baked in: the script, then `---`, then `audio:`.
  const tail = splitAudioTail(text);
  if (tail && looksLikeScript(tail.body)) {
    const playlist = parsePlaylistBody(tail.body);
    let doc: unknown = null;
    try {
      doc = load(tail.audio, { schema: CORE_SCHEMA });
    } catch {
      playlist.warnings.push("audio document is not valid YAML — ignored");
    }
    const audio = isPlainObject(doc) ? readAudio(doc.audio, playlist.warnings) : undefined;
    return audio ? { ...playlist, audio } : playlist;
  }
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
  // A script says "another page" with `##`, not with a document separator.
  if (looksLikeScript(text)) {
    const { meta, pages, warnings } = parseScriptPages(text);
    // Any document-level setting — a founding prompt, a subtitle, an advance
    // rule — means this is a playlist document, not a bare spec.
    if (pages.length > 1 || Object.keys(meta).length > 0) {
      const playlist: Playlist = { meta: { ...DEFAULT_META }, entries: [], warnings: [...warnings] };
      for (const [key, value] of Object.entries(meta)) {
        if (key === "chapters") continue;
        (playlist.meta as unknown as Record<string, unknown>)[key] = value;
      }
      // The two front-page fields read the same way in both formats: tags as a
      // clean list ("tags: a, b" or a list), a format only when it is one.
      if (meta.tags !== undefined) {
        const tags = readTags(meta.tags);
        if (tags) playlist.meta.tags = tags;
        else delete playlist.meta.tags;
      }
      if (meta.format !== undefined && meta.format !== "drawcast" && meta.format !== "quiz" && meta.format !== "xplanation") delete playlist.meta.format;
      // The listing picture's block (thumbnail round): validated as in YAML, or gone.
      if (meta.voices !== undefined) {
        const voices = readCastVoices(meta.voices);
        if (voices) playlist.meta.voices = voices;
        else delete playlist.meta.voices;
      }
      if (meta.thumb !== undefined) {
        const thumb = readThumb(meta.thumb);
        if (thumb) playlist.meta.thumb = thumb;
        else delete playlist.meta.thumb;
      }
      const chapters = (meta.chapters as { before: number; title: string }[] | undefined) ?? [];
      pages.forEach((p, i) => {
        for (const c of chapters) if (c.before === i) playlist.entries.push({ kind: "chapter", title: c.title });
        playlist.entries.push({ kind: "item", spec: p.spec });
      });
      // A chapter written after the last page opens nothing, but dropping it
      // here would be the one entry a round trip silently eats — the printer
      // writes it back out at the end, so read it back in at the end.
      for (const c of chapters) if (c.before >= pages.length) playlist.entries.push({ kind: "chapter", title: c.title });
      return playlist;
    }
    const single = singlePlaylist(pages[0].spec);
    single.warnings.push(...warnings);
    return single;
  }
  const single = parseSpecText(text).value as Spec;
  const playlist = singlePlaylist(single);
  // A lone spec that carries `prompt:` (the founding request, which every
  // saved document now keeps) is a one-page PLAYLIST with a header, not an
  // invalid page.
  const stray = takeDocSettings(single as unknown as Record<string, unknown>);
  if (stray) playlist.meta = readMeta(stray, playlist.warnings);
  return playlist;
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
      if (typeof value.voice === "string" && value.voice.length > 0) lines[key].voice = value.voice;
    }
  }
  return { lang: typeof raw.lang === "string" ? raw.lang : "", lines };
}

function classifyDocs(docs: Record<string, unknown>[]): Playlist {
  const warnings: string[] = [];
  const entries: PlaylistEntry[] = [];
  let audio: AudioTrack | undefined;
  /** The `playlist:` header, which wins over anything read loosely below. */
  let wrapped: Record<string, unknown> | null = null;
  /** A header written without its wrapper, plus settings found on pages. */
  let loose: Record<string, unknown> = {};
  for (const doc of docs) {
    if ("playlist" in doc) {
      const raw = doc.playlist;
      if (isPlainObject(raw)) wrapped = raw;
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
    } else if (!isDrawable(doc) && DOC_SETTINGS.some((key) => key in doc)) {
      // A header that forgot its `playlist:` wrapper — the near miss a model
      // makes when it is handed a document and asked for one back. Read as a
      // header, it says what it meant; read as a page, it is a blank figure
      // that fails validation and takes the whole drawcast down.
      loose = { ...loose, ...doc };
    } else {
      const stray = takeDocSettings(doc);
      if (stray) loose = { ...loose, ...stray };
      entries.push({ kind: "item", spec: doc as Spec });
    }
  }
  const raw = { ...loose, ...(wrapped ?? {}) };
  const meta: PlaylistMeta = Object.keys(raw).length > 0 ? readMeta(raw, warnings) : { ...DEFAULT_META };
  // An inset names another item (spec 2026-09-17-inset §4.10): the one check
  // that needs the whole playlist, so it lives here rather than in a spec's lint.
  const specs = entries.filter((e): e is { kind: "item"; spec: Spec } => e.kind === "item").map((e) => e.spec);
  specs.forEach((spec, i) => {
    for (const el of spec.elements ?? []) {
      if (!isPlainObject(el) || el.type !== "inset") continue;
      const ref = resolveSibling(String(el.of ?? ""), specs, i);
      if ("error" in ref) warnings.push(`item ${i + 1}: inset "${String(el.id)}": ${ref.error}`);
    }
  });
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
  // A quiz keeps each check's visuals after its answer (2026-10-05,
  // spec/check-cleanup.ts): the answer on screen is the point there. A page
  // that says otherwise keeps its own word.
  const quiz = playlist.meta?.format === "quiz";
  for (const e of playlist.entries) {
    if (e.kind === "chapter") chapter = e.title;
    // The thumbnail page (role: thumbnail) is the listing's picture, never played.
    else if (e.spec.role === "thumbnail") continue;
    else {
      const spec = quiz && e.spec.page?.checks === undefined && (e.spec.commands ?? []).some((c) => c.ask !== undefined) ? { ...e.spec, page: { ...(e.spec.page ?? {}), checks: "keep" as const } } : e.spec;
      items.push({ spec, chapter, index: items.length });
    }
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

/**
 * True when the playlist is just one bare spec (no header worth keeping, no
 * chapters). A founding `prompt` counts as a header worth keeping: it is the
 * one field that would otherwise be dropped on every save, so a doc that has
 * one always serializes WITH its header (§F.3.3's accepted shape change).
 */
export function isSingle(playlist: Playlist): boolean {
  return (
    playlist.entries.length === 1 &&
    playlist.entries[0].kind === "item" &&
    playlist.meta.title === undefined &&
    playlist.meta.subtitle === undefined &&
    playlist.meta.prompt === undefined &&
    playlist.meta.comments === undefined &&
    playlist.meta.views === undefined &&
    playlist.meta.next === undefined &&
    playlist.meta.enroll === undefined &&
    playlist.meta.poster === undefined &&
    playlist.meta.thumb === undefined &&
    playlist.meta.voices === undefined &&
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
  if (format === "script") {
    const meta: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(playlist.meta)) {
      if (value !== undefined && value !== (DEFAULT_META as unknown as Record<string, unknown>)[key]) meta[key] = value;
    }
    const pages: { spec: Spec }[] = [];
    const chapters: { before: number; title: string }[] = [];
    for (const e of playlist.entries) {
      if (e.kind === "chapter") chapters.push({ before: pages.length, title: e.title });
      else pages.push({ spec: e.spec });
    }
    if (chapters.length > 0) meta.chapters = chapters;
    return printScriptPages(meta, pages);
  }
  const parts: string[] = [];
  const header: Record<string, unknown> = {};
  if (playlist.meta.title !== undefined) header.title = playlist.meta.title;
  if (playlist.meta.subtitle !== undefined) header.subtitle = playlist.meta.subtitle;
  if (playlist.meta.tags !== undefined) header.tags = playlist.meta.tags;
  if (playlist.meta.format !== undefined) header.format = playlist.meta.format;
  // Always written when set (like title/subtitle), never compared against a
  // default — DEFAULT_META has no prompt, and a set one must always survive.
  if (playlist.meta.prompt !== undefined) header.prompt = playlist.meta.prompt;
  if (playlist.meta.comments !== undefined) header.comments = playlist.meta.comments;
  if (playlist.meta.views !== undefined) header.views = playlist.meta.views;
  if (playlist.meta.next !== undefined) header.next = playlist.meta.next;
  if (playlist.meta.enroll !== undefined) header.enroll = playlist.meta.enroll;
  if (playlist.meta.poster !== undefined) header.poster = playlist.meta.poster;
  if (playlist.meta.thumb !== undefined) header.thumb = playlist.meta.thumb;
  if (playlist.meta.voices !== undefined) header.voices = playlist.meta.voices;
  if (playlist.meta.advance !== DEFAULT_META.advance) header.advance = playlist.meta.advance;
  if (playlist.meta.gap !== DEFAULT_META.gap) header.gap = playlist.meta.gap;
  if (playlist.meta.transitions !== DEFAULT_META.transitions) header.transitions = playlist.meta.transitions;
  if (Object.keys(header).length > 0) parts.push(dump({ playlist: header }, YAML_OPTS));
  for (const e of playlist.entries) {
    if (e.kind === "chapter") parts.push(dump({ chapter: e.title }, YAML_OPTS));
    else parts.push(dumpSpecYaml(e.spec));
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
export function formatPublished(playlist: Playlist, audio: AudioTrack | null, format: "yaml" | "script" = "yaml"): string {
  // A .cast file is the same stream with a script in front: the audio
  // document after it is identical, so the server's split and the viewer's
  // join (publish/server.ts, viewer.ts) never learn which one they carry.
  const body = formatPlaylist(playlist, format);
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
  // The same geometry a cast's own `card` beat draws (spec/card.ts).
  const elements = cardElements(opts.title, opts.subtitle, "tp");
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
 * The card a course lecture ends on. The card itself stays title-only ink —
 * the CLICK lives in `meta.next`, which publishCourse writes onto the
 * published copy (where the target URL finally exists) and refreshes on
 * every republish, so it can never go stale the way a burnt-in URL would.
 * The viewer renders it as a "Next ▸" pill when playback finishes.
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

export interface EndPageOptions {
  /** This lecture's 1-based number. */
  position: number;
  total: number;
  /** The previous lecture's title (absent on the first). */
  prev?: string;
  /** The next lecture's title (absent on the last). */
  next?: string;
  /** The lecture's language (its parts' `lang` / castLang): the page's own
   *  words — Previous, Next, Watch again, "N of M", the spoken Next — are in
   *  it. Unknown or absent: English. */
  lang?: string | null;
}

/** The words an end page says itself, per language. */
interface EndWords {
  prev: string;
  next: string;
  again: string;
  title: string;
  of(n: number, total: number): string;
}

const END_WORDS: Record<string, EndWords> = {
  en: { prev: "Previous", next: "Next", again: "Watch again", title: "Where next", of: (n, t) => `${n} of ${t}` },
  nb: { prev: "Forrige", next: "Neste", again: "Se igjen", title: "Hvor nå", of: (n, t) => `${n} av ${t}` },
  nn: { prev: "Førre", next: "Neste", again: "Sjå igjen", title: "Kvar no", of: (n, t) => `${n} av ${t}` },
  sv: { prev: "Föregående", next: "Nästa", again: "Se igen", title: "Vart nu", of: (n, t) => `${n} av ${t}` },
  da: { prev: "Forrige", next: "Næste", again: "Se igen", title: "Hvor nu", of: (n, t) => `${n} af ${t}` },
  de: { prev: "Zurück", next: "Weiter", again: "Noch einmal ansehen", title: "Wie weiter", of: (n, t) => `${n} von ${t}` },
  fr: { prev: "Précédent", next: "Suivant", again: "Revoir", title: "Et ensuite", of: (n, t) => `${n} sur ${t}` },
  es: { prev: "Anterior", next: "Siguiente", again: "Ver de nuevo", title: "Y ahora", of: (n, t) => `${n} de ${t}` },
};

/** The end-page words for a lang tag (nb-NO → nb, no → nb); English otherwise. */
export function endWords(lang: string | null | undefined): EndWords {
  const code = (lang ?? "").toLowerCase().split(/[-_]/)[0];
  return END_WORDS[code === "no" ? "nb" : code] ?? END_WORDS.en;
}

/**
 * The page a course lecture ends on (spec 2026-09-28-drawcast-links §5): the
 * previous and next lectures as link cards, and "Watch again". The links name
 * lectures by NUMBER (`lecture:N`), read against the course when clicked
 * (links/resolve.ts) — so the page is right before the next lecture has a
 * file, in the app, in dev and on GitHub alike, and a republish rewrites
 * nothing. It ends drawn (no clear): the links are what the viewer is left
 * with. The spoken line is the Next card's own, so baked narration carries over.
 */
export function makeEndPage(opts: EndPageOptions): Spec {
  const both = opts.prev !== undefined && opts.next !== undefined;
  const elements: Spec["elements"] = [];
  const cards: string[] = [];
  const card = (id: string, kicker: string, title: string, n: number, x: number): void => {
    elements.push({ id: `${id}_kicker`, type: "text", text: kicker, x, y: 545, font_size: 24, style: { opacity: 0.6 } });
    elements.push({ id, type: "link", href: `lecture:${n}`, title, size: 320, x, y: 395 });
    cards.push(`${id}_kicker`, id);
  };
  const w = endWords(opts.lang);
  if (opts.prev !== undefined) card("end_prev", w.prev, opts.prev, opts.position - 1, both ? 265 : 500);
  if (opts.next !== undefined) card("end_next", w.next, opts.next, opts.position + 1, both ? 735 : 500);
  elements.push({ id: "end_again", type: "link", form: "text", href: `lecture:${opts.position}`, title: w.again, open: "here", x: 500, y: 160 });
  elements.push({ id: "end_count", type: "text", text: w.of(opts.position, opts.total), x: 500, y: 95, font_size: 22, style: { opacity: 0.6 } });
  const first: Command = opts.next !== undefined ? { draw: cards, speak: `${w.next}: ${opts.next}` } : { draw: cards };
  // A non-English page declares its lang, so the spoken Next is read in that voice.
  const lang = w === END_WORDS.en ? {} : { lang: opts.lang as string };
  return { title: w.title, ...lang, end_page: true, elements, commands: [first, { draw: ["end_again", "end_count"] }] };
}

/** The item a poster is drawn from: the LAST content part — the end
 *  picture — never the end page or the legacy Next card. Null when there is none. */
export function posterItemOf(playlist: Playlist): { spec: Spec } | null {
  const content = itemsOf(playlist).filter((i) => !isEndPage(i.spec));
  return content.at(-1) ?? null;
}

/** The cast's thumbnail page (`role: thumbnail`), which itemsOf leaves out of playback, or null. */
export function thumbnailItemOf(playlist: Playlist): { spec: Spec } | null {
  return thumbnailItemsOf(playlist)[0] ?? null;
}

/** Every thumbnail page, in order: the first is the cast's thumbnail, the rest its variants (2026-10-06), shown in turn and counted. */
export function thumbnailItemsOf(playlist: Playlist): { spec: Spec }[] {
  return playlist.entries.flatMap((e) => (e.kind !== "chapter" && e.spec.role === "thumbnail" ? [{ spec: e.spec }] : []));
}

/** True for a lecture's generated last page: the end page, or the legacy drawn Next card. */
export function isEndPage(spec: Spec): boolean {
  return spec.end_page === true || (spec.elements ?? []).some((e) => e.id === "nx_kicker");
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

export interface ExportSequenceOptions {
  /**
   * Open a SINGLE cast with a title card made from its own title — the
   * exported file has no page under it to carry the title (title-below-player
   * design, 2026-09-16). Skipped when the cast already opens with its own
   * `card` beat; a playlist keeps its title page regardless.
   */
  titleCard?: boolean;
}

/** Whether the cast's first beat is its own `card` — then export adds none. */
function opensWithCard(spec: Spec): boolean {
  return spec.commands?.[0]?.card !== undefined;
}

/**
 * The specs a video export plays, in order — and the single description of
 * what a viewer sees live: title page first, each item un-drawing itself
 * before the next, a chapter card where a new chapter begins. Export always
 * auto-advances; there is no one to click.
 */
export function exportSequence(playlist: Playlist, opts: ExportSequenceOptions = {}): Spec[] {
  const items = itemsOf(playlist);
  const { meta } = playlist;
  const seq: Spec[] = [];
  if (meta.title !== undefined && items.length > 0) {
    seq.push(makeTitlePage({ title: meta.title, subtitle: meta.subtitle, gap: meta.gap }));
  } else if (opts.titleCard && items.length === 1 && items[0].spec.title && !opensWithCard(items[0].spec)) {
    seq.push(makeTitlePage({ title: items[0].spec.title, gap: meta.gap }));
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
