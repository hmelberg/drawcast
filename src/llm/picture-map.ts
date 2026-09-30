// Mapping a picture's parts (spec 2026-09-30-picture-regions §8, §14): the pure
// half — the request forms, the prompt, the sanitiser, the cache key, the
// compiler's note and the fill of the regions a spec's commands use. Nothing
// here calls a model; that happens only while authoring.
import Anthropic from "@anthropic-ai/sdk";
import { callForJson } from "./client";
import { cacheGet as defaultGet, cachePut as defaultPut } from "../render/portrait";
import { isAutoRegions, parsePlace, placesInCommands, type Rect4 } from "../spec/places";
import type { Spec } from "../spec/types";

export type MapDetail = "few" | "some" | "many";
export type MapKind = "areas" | "controls" | "text";
export interface MapOptions { detail: MapDetail; kinds: MapKind[]; find: string[] }
export interface MappedRegion { name: string; box: Rect4; kind: "area" | "control" | "text"; label?: string }
export interface PictureMap { regions: MappedRegion[]; notFound: string[] }

const DETAILS: MapDetail[] = ["few", "some", "many"];
const KINDS: MapKind[] = ["areas", "controls", "text"];
const CAPS: Record<MapDetail, number> = { few: 8, some: 25, many: 80 };
const KIND_OF: Record<MapKind, MappedRegion["kind"]> = { areas: "area", controls: "control", text: "text" };

const defaults = (): MapOptions => ({ detail: "some", kinds: [...KINDS], find: [] });

/** The auto request on an image, normalised; null when regions is a plain map or absent. */
export function autoOptions(regions: unknown): MapOptions | null {
  if (regions === "auto") return defaults();
  if (!isAutoRegions(regions)) return null;
  const a = (regions as { auto: unknown }).auto;
  const o = defaults();
  if (a && typeof a === "object") {
    const r = a as { detail?: unknown; kinds?: unknown; find?: unknown };
    if (DETAILS.includes(r.detail as MapDetail)) o.detail = r.detail as MapDetail;
    if (Array.isArray(r.kinds)) {
      const k = KINDS.filter((x) => (r.kinds as unknown[]).includes(x));
      if (k.length > 0) o.kinds = k;
    }
    if (Array.isArray(r.find)) o.find = r.find.filter((x): x is string => typeof x === "string" && x.trim() !== "").map((x) => x.trim());
  }
  return o;
}

/** https picture URLs in a request text, at most 3, de-duplicated, in order. */
export function picturesInRequest(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/https:\/\/[^\s<>"'`\]]+/g)) {
    // Trailing punctuation and a closing parenthesis the URL did not open
    // ("(see https://…/a.png)") are prose; a balanced one is the path's own
    // (Wikimedia's "Mona_Lisa_(painting).jpg").
    let url = m[0];
    for (;;) {
      const t = url.replace(/[.,;:!?]+$/, "");
      const unbalanced = t.endsWith(")") && t.split(")").length > t.split("(").length;
      const next = unbalanced ? t.slice(0, -1) : t;
      if (next === url) break;
      url = next;
    }
    let path: string;
    try {
      path = new URL(url).pathname;
    } catch {
      continue;
    }
    if (/\.(png|jpe?g|webp|gif|svg)$/i.test(path) || /\/(images|assets)\//i.test(path)) {
      if (!out.includes(url)) out.push(url);
      if (out.length === 3) break;
    }
  }
  return out;
}

// No minItems/maxItems: the grammar need not know the length; sanitizeMap enforces 4.
const box4 = { type: "array", items: { type: "number" } };
export const MAP_SCHEMA: object = {
  type: "object",
  properties: {
    regions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          box: box4,
          kind: { type: "string", enum: ["area", "control", "text"] },
          label: { type: "string" },
        },
        required: ["name", "box", "kind"],
        additionalProperties: false,
      },
    },
    not_found: { type: "array", items: { type: "string" } },
  },
  required: ["regions", "not_found"],
  additionalProperties: false,
};

export function mapSystemPrompt(): string {
  return [
    "You map a picture for a teacher who will point at its parts while explaining it. Return the parts a newcomer would be shown, as named boxes.",
    "- Boxes are [x, y, w, h] as FRACTIONS of the whole picture, measured from the TOP-LEFT corner: x and w of the width, y and h of the height. Be precise: the box should hug the part.",
    "- Names are short English snake_case ids (command_line, search_field, mirror), unique, describing the part — not its colour or position.",
    '- kind: "area" for a panel, section or region of a scene; "control" for a button, field, menu, tab or icon; "text" for a block of visible words.',
    "- label: the visible text on or in the part, verbatim, when it has any.",
    "- Never invent a part you cannot see. When asked to find something that is not in the picture, put the request in not_found instead.",
  ].join("\n");
}

export function mapUserText(opts: MapOptions): string {
  return (
    `Detail: ${opts.detail} (${CAPS[opts.detail]} parts at most). Kinds: ${opts.kinds.join(", ")}.` +
    (opts.find.length ? ` Find exactly these, and nothing else: ${opts.find.join("; ")}. Quoted phrases are visible text.` : "")
  );
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;

function cleanBox(b: unknown): Rect4 | null {
  if (!Array.isArray(b) || b.length !== 4 || !b.every((n) => typeof n === "number" && Number.isFinite(n))) return null;
  const x = Math.min(1, Math.max(0, b[0]));
  const y = Math.min(1, Math.max(0, b[1]));
  const x2 = Math.min(1, Math.max(0, b[0] + b[2]));
  const y2 = Math.min(1, Math.max(0, b[1] + b[3]));
  const w = round3(x2 - x);
  const h = round3(y2 - y);
  if (w < 0.004 || h < 0.004) return null;
  return [round3(x), round3(y), w, h];
}

function snake(s: string): string {
  let n = s.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  if (!/^[a-z]/.test(n)) n = n ? `part_${n}` : "part";
  return n.slice(0, 32).replace(/_+$/, "") || "part";
}

/** Clean a raw reply. Never throws; bad input → an empty map. */
export function sanitizeMap(raw: unknown, opts: MapOptions): PictureMap {
  const out: PictureMap = { regions: [], notFound: [] };
  try {
    if (!raw || typeof raw !== "object") return out;
    const r = raw as { regions?: unknown; not_found?: unknown };
    // A box in pixels means every box is in pixels — the reply cannot be read as fractions.
    const pixels = (it: unknown) => {
      const b = it && typeof it === "object" ? (it as { box?: unknown }).box : undefined;
      return Array.isArray(b) && b.some((n) => typeof n === "number" && n > 1.5);
    };
    if (Array.isArray(r.regions) && r.regions.some(pixels)) return out;
    const allowed = new Set(opts.kinds.map((k) => KIND_OF[k]));
    const used = new Set<string>();
    if (Array.isArray(r.regions)) {
      for (const item of r.regions) {
        if (out.regions.length >= CAPS[opts.detail]) break;
        if (!item || typeof item !== "object") continue;
        const it = item as { name?: unknown; box?: unknown; kind?: unknown; label?: unknown };
        if (typeof it.name !== "string") continue;
        if (!allowed.has(it.kind as MappedRegion["kind"])) continue;
        const box = cleanBox(it.box);
        if (!box) continue;
        const base = snake(it.name);
        let name = base;
        for (let i = 2; used.has(name); i++) {
          const suffix = `_${i}`;
          name = base.slice(0, 32 - suffix.length) + suffix;
        }
        used.add(name);
        const reg: MappedRegion = { name, box, kind: it.kind as MappedRegion["kind"] };
        if (typeof it.label === "string" && it.label.trim() !== "") reg.label = it.label.trim();
        out.regions.push(reg);
      }
    }
    if (Array.isArray(r.not_found)) {
      out.notFound = r.not_found.filter((x): x is string => typeof x === "string" && x.trim() !== "").map((x) => x.trim()).slice(0, 10);
    }
  } catch {
    return { regions: [], notFound: [] };
  }
  return out;
}

/** m1|<picture key>|<detail>|<sorted kinds>|<sorted find>; a data URI keys by its fingerprint. */
export function mapCacheKey(picture: string, opts: MapOptions): string {
  const pic = picture.startsWith("data:") ? `data:${picture.length}:${picture.slice(0, 64)}:${picture.slice(-64)}` : picture;
  return `m1|${pic}|${opts.detail}|${[...opts.kinds].sort().join(",")}|${[...opts.find].sort().join(";")}`;
}

/** The compiler's note: one line per picture, then one per part, then "  not found: …". */
export function mapNote(entries: { url: string; map: PictureMap }[]): string {
  const lines: string[] = [];
  for (const { url, map } of entries) {
    lines.push(`Picture ${url} — mapped parts (target as <id>:<name>):`);
    for (const r of map.regions) lines.push(`  ${r.name} — ${r.kind}${r.label ? ` — "${r.label}"` : ""}`);
    if (map.notFound.length) lines.push(`  not found: ${map.notFound.join("; ")}`);
  }
  return lines.join("\n");
}

/** The image elements of a spec that ask for regions: auto, with their picture key and options. */
export function autoImages(spec: Spec): { id: string; picture: string; opts: MapOptions }[] {
  const out: { id: string; picture: string; opts: MapOptions }[] = [];
  for (const el of spec.elements ?? []) {
    if (el.type !== "image" || typeof el.url !== "string") continue;
    const opts = autoOptions(el.regions);
    if (opts) out.push({ id: el.id, picture: el.url, opts });
  }
  return out;
}

/** Set each mapped image's regions to the boxes of the names the commands use (keeping hand-written boxes); returns the used names the map lacks (missingAt: with their picture). */
export function fillUsedRegions(spec: Spec, maps: Map<string, PictureMap>): { missing: string[]; missingAt: { owner: string; name: string }[] } {
  const used = new Map<string, Set<string>>();
  for (const s of placesInCommands(spec.commands)) {
    const p = parsePlace(s);
    if (p?.kind === "region") (used.get(p.owner) ?? used.set(p.owner, new Set()).get(p.owner)!).add(p.name);
  }
  const missing: string[] = [];
  const missingAt: { owner: string; name: string }[] = [];
  for (const el of spec.elements ?? []) {
    if (el.type !== "image" || typeof el.url !== "string") continue;
    const map = maps.get(el.url);
    if (!map) continue;
    const hand = el.regions && typeof el.regions === "object" && !isAutoRegions(el.regions) ? (el.regions as Record<string, Rect4>) : {};
    const names = used.get(el.id);
    // Nothing aims into an auto picture: it stays auto (nothing to fill, nothing to lose).
    if (!names?.size && Object.keys(hand).length === 0) continue;
    const filled: Record<string, Rect4> = Object.assign(Object.create(null) as Record<string, Rect4>, hand);
    for (const name of names ?? []) {
      if (Object.hasOwn(hand, name) || !/^[a-z][a-z0-9_]{0,31}$/.test(name)) continue;
      const found = map.regions.find((r) => r.name === name);
      if (found) filled[name] = found.box;
      else {
        missing.push(name);
        missingAt.push({ owner: el.id, name });
      }
    }
    el.regions = filled;
  }
  return { missing, missingAt };
}

// ---- the call (authoring only) ---------------------------------------------

export interface MapDeps {
  client: Anthropic;
  model: string;
  signal?: AbortSignal;
  cacheGet?: (k: string) => Promise<string | null>;
  cachePut?: (k: string, v: string) => Promise<void>;
}

type ImageBlock = Anthropic.ImageBlockParam;
type MediaType = "image/png" | "image/jpeg" | "image/webp" | "image/gif";

function imageBlock(picture: string): ImageBlock | null {
  if (picture.startsWith("https://")) return { type: "image", source: { type: "url", url: picture } };
  const m = /^data:(image\/(?:png|jpeg|webp|gif));base64,(.+)$/s.exec(picture);
  if (!m) return null;
  return { type: "image", source: { type: "base64", media_type: m[1] as MediaType, data: m[2] } };
}

function isAbort(err: unknown, signal?: AbortSignal): boolean {
  return !!signal?.aborted || err instanceof Anthropic.APIUserAbortError || (err instanceof Error && err.name === "AbortError");
}

/** Map one picture. picture = https URL or data: URI. Cached. Throws only on abort; other failures → null. */
export async function mapPicture(picture: string, opts: MapOptions, deps: MapDeps): Promise<PictureMap | null> {
  const get = deps.cacheGet ?? defaultGet;
  const put = deps.cachePut ?? defaultPut;
  const key = mapCacheKey(picture, opts);
  try {
    const hit = await get(key);
    if (hit) {
      const parsed = sanitizeMap(JSON.parse(hit), opts);
      if (parsed.regions.length > 0 || parsed.notFound.length > 0) return parsed;
    }
  } catch {
    /* a bad cache entry is a miss */
  }
  const block = imageBlock(picture);
  if (!block) return null;
  try {
    const { json } = await callForJson(
      deps.client,
      deps.model,
      [{ type: "text", text: mapSystemPrompt() }],
      [{ role: "user", content: [block, { type: "text", text: mapUserText(opts) }] }],
      MAP_SCHEMA,
      { maxTokens: 4000, signal: deps.signal, isolate: true },
    );
    const map = sanitizeMap(json, opts);
    if (map.regions.length > 0 || map.notFound.length > 0) {
      try {
        await put(key, JSON.stringify(map));
      } catch {
        /* the cache is a courtesy */
      }
    }
    return map;
  } catch (err) {
    if (isAbort(err, deps.signal)) throw err;
    return null;
  }
}

/** What a mapPicture result means to the editor: parts to write, a picture the call read but found nothing in, or a call that failed (null). */
export function mapOutcome(map: PictureMap | null): "found" | "none" | "failed" {
  return map === null ? "failed" : map.regions.length > 0 ? "found" : "none";
}

/** Map several (sequentially), returning url → map for the ones that succeeded, plus warnings for the ones that failed. */
export async function mapPictures(
  items: { picture: string; opts: MapOptions }[],
  deps: MapDeps,
): Promise<{ maps: Map<string, PictureMap>; warnings: string[] }> {
  return mapShared(sharedMapper(deps), items, deps.signal);
}

/** The pipeline's picture check on one reply (see checkMappedPictures). */
export interface MapCheck {
  /** One line per used name a map lacks, and one per unmapped auto picture a part name aims into. */
  errors: string[];
  /** `<where><owner>\0<name>` of the names already reported above — validation's own "has no region" line for them is dropped. */
  reported: Set<string>;
}

/**
 * The compile and revise pipelines' picture step, run on every candidate
 * before it is validated: fill the used boxes from the maps (§14), report
 * each used name a map lacks with the picture's real names, and report a part
 * NAME aimed into a picture still `regions: auto` — nothing mapped it, so the
 * name was guessed. (pictureErrors outside the pipelines stays tolerant of
 * auto: the editor maps it later.) `where` prefixes every line ("item 2: ").
 * Never throws — a malformed reply is validation's to report.
 */
export function checkMappedPictures(spec: unknown, maps?: Map<string, PictureMap> | null, where = ""): MapCheck {
  const out: MapCheck = { errors: [], reported: new Set() };
  try {
    const s = spec as Spec;
    if (!s || typeof s !== "object" || !Array.isArray(s.elements)) return out;
    if (maps && maps.size > 0) {
      const { missingAt } = fillUsedRegions(s, maps);
      const seen = new Set<string>();
      for (const { owner, name } of missingAt) {
        const key = `${owner}\0${name}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.reported.add(where + key);
        const el = s.elements.find((e) => e?.id === owner);
        const map = el && typeof el.url === "string" ? maps.get(el.url) : undefined;
        const names = map?.regions.map((r) => r.name).join(", ") || "none";
        out.errors.push(`${where}"${owner}:${name}": not a mapped part of the picture — ${owner}'s mapped parts are: ${names}`);
      }
    }
    const unmapped = new Set<string>();
    for (const place of placesInCommands(s.commands)) {
      const p = parsePlace(place);
      if (p?.kind !== "region" || unmapped.has(p.owner)) continue;
      const el = s.elements.find((e) => e?.id === p.owner);
      if (el?.type === "image" && isAutoRegions(el.regions)) unmapped.add(p.owner);
    }
    for (const id of unmapped) out.errors.push(`${where}"${id}" was not mapped — its parts are unknown; aim at "${id}@top", "${id}@[x, y, w, h]" or the whole picture`);
  } catch {
    return { errors: [], reported: new Set() };
  }
  return out;
}

/** Validation's errors with the pipeline's picture check folded in: its "has no region" lines for names the check already reported are dropped (one line per missing name), its own lines appended. */
export function withMapCheck(errors: string[], check: MapCheck): string[] {
  const kept = check.reported.size === 0
    ? errors
    : errors.filter((e) => {
        const m = /^((?:item \d+: )?)"[^"]*": (\S+) has no region "([^"]*)"/.exec(e);
        return !m || !check.reported.has(`${m[1]}${m[2]}\0${m[3]}`);
      });
  return [...kept, ...check.errors];
}

/** What the compile pipeline gets from mapping a request (GenerateConfig.mapPictures). */
export interface RequestMaps { maps: Map<string, PictureMap>; note: string; warnings: string[] }

/**
 * One picture mapper for a whole run: the parts of a multi-part drawcast or a
 * course's lectures ask for the same picture in parallel, and a cold cache
 * would otherwise pay for it once per part — the first ask's call is shared.
 */
function sharedMapper(deps: Omit<MapDeps, "signal">) {
  const inflight = new Map<string, Promise<PictureMap | null>>();
  return (picture: string, opts: MapOptions, signal?: AbortSignal): Promise<PictureMap | null> => {
    const key = mapCacheKey(picture, opts);
    let p = inflight.get(key);
    if (!p) {
      p = mapPicture(picture, opts, { ...deps, signal });
      p.catch(() => inflight.delete(key)); // an abort is not remembered
      inflight.set(key, p);
    }
    return p;
  };
}

/** mapPictures over a shared mapper (see sharedMapper). */
async function mapShared(map: ReturnType<typeof sharedMapper>, items: { picture: string; opts: MapOptions }[], signal?: AbortSignal) {
  const maps = new Map<string, PictureMap>();
  const warnings: string[] = [];
  for (const { picture, opts } of items) {
    if (maps.has(picture)) continue;
    const m = await map(picture, opts, signal);
    if (m && (m.regions.length > 0 || m.notFound.length > 0)) maps.set(picture, m);
    else warnings.push(`Could not map the parts of ${picture.startsWith("data:") ? "an embedded picture" : picture}; regions: auto has no boxes for it.`);
  }
  return { maps, warnings };
}

/** The compile pipeline's hook (GenerateConfig.mapPictures): the request's picture URLs (none → null, no call), mapped with the default options, with the compiler's note. */
export function makeMapPictures(deps: Omit<MapDeps, "signal">): (request: string, signal?: AbortSignal) => Promise<RequestMaps | null> {
  const map = sharedMapper(deps);
  return async (request, signal) => {
    const urls = picturesInRequest(request);
    if (urls.length === 0) return null;
    const { maps, warnings } = await mapShared(map, urls.map((picture) => ({ picture, opts: defaults() })), signal);
    const note = maps.size > 0 ? mapNote([...maps].map(([url, m]) => ({ url, map: m }))) : "";
    return { maps, note, warnings };
  };
}

/** Revise's hook (ReviseConfig.mapAuto): the pictures a document's regions: auto asks for, with their options. */
export function makeMapAuto(deps: Omit<MapDeps, "signal">): (items: { picture: string; opts: MapOptions }[], signal?: AbortSignal) => Promise<{ maps: Map<string, PictureMap>; warnings: string[] }> {
  const map = sharedMapper(deps);
  return (items, signal) => mapShared(map, items, signal);
}

/**
 * The editor's write-back (§14 trigger 3): every image whose regions ask for
 * auto and whose picture was mapped gets the WHOLE map, sorted by name, for
 * the author to use and prune. Returns what was written, per image id.
 */
export function writeFullMaps(spec: Spec, maps: Map<string, PictureMap>): { id: string; count: number; notFound: string[] }[] {
  const out: { id: string; count: number; notFound: string[] }[] = [];
  for (const el of Array.isArray(spec.elements) ? spec.elements : []) {
    if (el?.type !== "image" || typeof el.url !== "string" || !autoOptions(el.regions)) continue;
    const map = maps.get(el.url);
    if (!map || map.regions.length === 0) continue;
    const regions: Record<string, Rect4> = Object.create(null) as Record<string, Rect4>;
    for (const r of [...map.regions].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) regions[r.name] = r.box;
    el.regions = regions;
    out.push({ id: el.id, count: map.regions.length, notFound: map.notFound });
  }
  return out;
}
