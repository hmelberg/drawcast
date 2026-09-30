// Mapping a picture's parts (spec 2026-09-30-picture-regions §8, §14): the pure
// half — the request forms, the prompt, the sanitiser, the cache key, the
// compiler's note and the fill of the regions a spec's commands use. Nothing
// here calls a model; that happens only while authoring.
import { parsePlace, placesInCommands, type Rect4 } from "../spec/places";
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
  if (!regions || typeof regions !== "object" || Array.isArray(regions) || !Object.hasOwn(regions, "auto")) return null;
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
  for (const m of text.matchAll(/https:\/\/[^\s<>"'`)\]]+/g)) {
    const url = m[0].replace(/[.,;:!?]+$/, "");
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

const box4 = { type: "array", items: { type: "number" }, minItems: 4, maxItems: 4 };
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

/** Set each mapped image's regions to the boxes of the names the commands use (keeping hand-written boxes); returns the used names the map lacks. */
export function fillUsedRegions(spec: Spec, maps: Map<string, PictureMap>): { missing: string[] } {
  const used = new Map<string, Set<string>>();
  for (const s of placesInCommands(spec.commands)) {
    const p = parsePlace(s);
    if (p?.kind === "region") (used.get(p.owner) ?? used.set(p.owner, new Set()).get(p.owner)!).add(p.name);
  }
  const missing: string[] = [];
  for (const el of spec.elements ?? []) {
    if (el.type !== "image" || typeof el.url !== "string") continue;
    const map = maps.get(el.url);
    if (!map) continue;
    const hand = el.regions && typeof el.regions === "object" && !Object.hasOwn(el.regions, "auto") ? (el.regions as Record<string, Rect4>) : {};
    const filled: Record<string, Rect4> = { ...hand };
    for (const name of used.get(el.id) ?? []) {
      if (Object.hasOwn(hand, name)) continue;
      const found = map.regions.find((r) => r.name === name);
      if (found) filled[name] = found.box;
      else missing.push(name);
    }
    el.regions = filled;
  }
  return { missing };
}
