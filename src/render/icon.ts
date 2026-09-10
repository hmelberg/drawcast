// The `icon` element: a keyword ("factory", "flask") resolved to a small
// glyph via the Iconify API, embedded as outline rings the way a portrait
// embeds a traced photo. Licence-gated like `image.ts`'s Commons photos —
// an icon set's licence class decides whether it may be picked automatically
// (DEFAULT_PREFIXES, then BY_PREFIXES) or only when the author names it
// explicitly (`el.set`), and a trademarked logo set is never resolvable at
// all (see icon-sets.ts).
//
// Modeled on render/image.ts: same never-throw contract, same cache
// (cacheGet/cachePut), same injected-deps seam so tests never hit the
// network.

import type { Spec, SpecElement } from "../spec/types";
import { inlineStrokes } from "../spec/assets";
import type { Pt } from "../layout/model";
import { sampleSvgPath } from "../scenes/svgpath";
import { decodeIcon, encodeIcon } from "../spec/trace";
import { cacheGet, cachePut } from "./portrait";
import { ICON_SETS } from "./icon-sets";

/** Tried first when an icon element gives no explicit `set`: no attribution owed. */
export const DEFAULT_PREFIXES = ["lucide", "tabler", "ph", "heroicons", "material-symbols"];

/** Tried second, only once every permissive set has come up empty: attribution owed (the `credit` line pays it). */
export const BY_PREFIXES = ["fa6-solid", "fa6-regular", "twemoji"];

/** Bump when the resolver's output changes — old cache entries stop matching. */
const ICON_VERSION = 1;

export function iconSearchUrl(q: string, prefixes: string[]): string {
  return `https://api.iconify.design/search?query=${encodeURIComponent(q)}&limit=5&prefixes=${prefixes.join(",")}`;
}

export function iconSvgUrl(prefix: string, name: string): string {
  return `https://api.iconify.design/${prefix}/${name}.svg`;
}

/** lower-case, runs of whitespace → one hyphen: how a free-text `of` becomes an Iconify icon name. */
function slug(of: string): string {
  return of.trim().toLowerCase().replace(/\s+/g, "-");
}

/**
 * An Iconify SVG's `<path>` outlines, each flattened to a ring and
 * normalised into the SVG's own `viewBox` (default `0 0 24 24`) so every
 * icon comes back in 0..1 coordinates regardless of its native grid.
 * Non-path shapes (`<rect>`, `<circle>`, …) are ignored — Iconify normalises
 * the sets `icon.ts` draws from to paths.
 */
export function svgToRings(svg: string): Pt[][] {
  const vbMatch = svg.match(/viewBox="([^"]+)"/);
  const [minX, minY, w, h] = (vbMatch ? vbMatch[1].trim().split(/\s+/).map(Number) : [0, 0, 24, 24]) as [
    number,
    number,
    number,
    number,
  ];
  const rings: Pt[][] = [];
  for (const m of svg.matchAll(/<path\b[^>]*\bd="([^"]+)"/g)) {
    for (const ring of sampleSvgPath(m[1], 6)) {
      rings.push(ring.map(([x, y]) => [(x - minX) / w, (y - minY) / h] as Pt));
    }
  }
  return rings;
}

export interface IconDeps {
  fetch: typeof fetch;
}

function defaultDeps(): IconDeps {
  return { fetch: globalThis.fetch };
}

export interface IconResolveOpts {
  /** true when this resolution seeds an unattended pick — a share-alike
   *  set (by-sa) may still be drawn when the author names it explicitly,
   *  but must never be chosen this way, since the resulting document would
   *  inherit share-alike terms without anyone having agreed to that. */
  forSeed?: boolean;
}

export interface IconResolution {
  id: string;
  ok: boolean;
  error?: string;
}

/** Cache key for an icon element, or null when it needs no resolution. Keyed
 *  by `set` too (default "*"): the same keyword can resolve to a different
 *  icon depending on which set the author pinned it to. */
function iconCacheKey(el: Pick<SpecElement, "type" | "of" | "strokes" | "set">): string | null {
  if (el.type !== "icon" || el.strokes) return null;
  if (!el.of) return null;
  return `ic${ICON_VERSION}|${el.set ?? "*"}|${el.of.trim().toLowerCase()}`;
}

/** The first `prefix:name` result whose prefix's licence class is allowed, or null. */
function firstAllowed(icons: unknown, allow: ("permissive" | "by")[]): { prefix: string; name: string } | null {
  if (!Array.isArray(icons)) return null;
  for (const entry of icons) {
    if (typeof entry !== "string") continue;
    const sep = entry.indexOf(":");
    if (sep < 0) continue;
    const prefix = entry.slice(0, sep), name = entry.slice(sep + 1);
    const row = ICON_SETS[prefix];
    if (row && (allow as string[]).includes(row.cls)) return { prefix, name };
  }
  return null;
}

/**
 * Resolve every `icon` element of a spec IN PLACE: fill `strokes`, `set` and
 * `credit` from the cache, or by keyword → Iconify search (or a named
 * `el.set` straight to the SVG endpoint) → licence check → outline trace, on
 * a miss. Licence-gated (see icon-sets.ts): an unknown set, a logo set, or a
 * share-alike set picked as an unattended seed is rejected outright — no
 * strokes, no credit. Failures are reported, never thrown.
 */
export async function resolveIcons(spec: Spec, deps: IconDeps = defaultDeps(), opts: IconResolveOpts = {}): Promise<IconResolution[]> {
  const results: IconResolution[] = [];
  for (const el of spec.elements ?? []) {
    if (el.type !== "icon") continue;
    const have = inlineStrokes(spec, el);
    if (have && decodeIcon(have)) {
      results.push({ id: el.id, ok: true });
      continue;
    }
    const key = iconCacheKey(el);
    if (!key) {
      results.push({ id: el.id, ok: false, error: "icon has no description or readable strokes" });
      continue;
    }
    try {
      const requestedSet = el.set;
      // Policy checks apply on every call, cache hit or miss: whether a
      // set may be used here depends on THIS call's `opts.forSeed`, not on
      // whether some earlier call already fetched the SVG.
      if (requestedSet) {
        const row = ICON_SETS[requestedSet];
        if (!row) throw new Error(`unknown icon set "${requestedSet}"`);
        if (row.cls === "logo") throw new Error(`logo sets are not allowed ("${requestedSet}")`);
        if (row.cls === "by-sa" && opts.forSeed) throw new Error(`share-alike set cannot be a seed ("${requestedSet}")`);
      }
      let cached = await cacheGet(key);
      if (!cached) {
        let prefix: string, name: string;
        if (requestedSet) {
          prefix = requestedSet;
          name = slug(el.of!);
        } else {
          const searchRes = await deps.fetch(iconSearchUrl(el.of!, DEFAULT_PREFIXES));
          const searchJson = searchRes.ok ? ((await searchRes.json()) as { icons?: unknown }) : { icons: [] };
          let hit = firstAllowed(searchJson.icons, ["permissive"]);
          if (!hit) {
            const byRes = await deps.fetch(iconSearchUrl(el.of!, BY_PREFIXES));
            const byJson = byRes.ok ? ((await byRes.json()) as { icons?: unknown }) : { icons: [] };
            hit = firstAllowed(byJson.icons, ["by"]);
          }
          if (!hit) throw new Error(`no icon found for "${el.of}"`);
          prefix = hit.prefix;
          name = hit.name;
        }
        const svgRes = await deps.fetch(iconSvgUrl(prefix, name));
        if (!svgRes.ok) throw new Error(`Iconify fetch failed (${svgRes.status}) for "${prefix}:${name}"`);
        const svg = await svgRes.text();
        const rings = svgToRings(svg);
        if (rings.length === 0) throw new Error(`no outline found for "${prefix}:${name}"`);
        const strokes = encodeIcon(rings);
        const credit = `${name} from ${prefix} · ${ICON_SETS[prefix].licence}`;
        cached = JSON.stringify({ strokes, set: prefix, credit });
        await cachePut(key, cached);
      }
      const parsed = JSON.parse(cached) as { strokes: string; set: string; credit: string };
      el.strokes = parsed.strokes;
      el.set = parsed.set;
      el.credit = parsed.credit;
      results.push({ id: el.id, ok: true });
    } catch (err) {
      results.push({ id: el.id, ok: false, error: (err as Error).message });
    }
  }
  return results;
}
