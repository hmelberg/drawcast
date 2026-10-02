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
import {
  decodeIconSvg,
  encodeIconSvg,
  iconAsk,
  iconAssetName,
  iconCreditOf,
  iconLookOf,
  iconSlug,
  isIconData,
  registerIconStore,
  storedIcon,
  svgToRings,
  type IconAsk,
  type IconLook,
} from "../spec/icon-data";
import { cacheGet, cachePut } from "./portrait";
import { ICON_SETS } from "./icon-sets";

/** Tried first when an icon element gives no explicit `set`: no attribution owed. */
export const DEFAULT_PREFIXES = ["lucide", "tabler", "ph", "heroicons", "material-symbols"];

/** Tried second, only once every permissive set has come up empty: attribution owed (the `credit` line pays it). */
export const BY_PREFIXES = ["fa6-solid", "fa6-regular", "twemoji"];

/** Bump when the resolver's output changes — old cache entries stop matching. 2: the SVG itself (spec/icon-data.ts `ics1:`), per look. */
const ICON_VERSION = 2;

export function iconSearchUrl(q: string, prefixes: string[]): string {
  return `https://api.iconify.design/search?query=${encodeURIComponent(q)}&limit=5&prefixes=${prefixes.join(",")}`;
}

export function iconSvgUrl(prefix: string, name: string): string {
  return `https://api.iconify.design/${prefix}/${name}.svg`;
}

/** lower-case, runs of whitespace → one hyphen: how a free-text `of` becomes an Iconify icon name. */
const slug = iconSlug;

/** An Iconify SVG's outlines as 0..1 rings — spec/icon-data.ts, where the layout traces a drawn icon too. */
export { svgToRings };

/** Tried first for a PICTURE (round 6 §8) when no set is pinned: a colour set, credited like any CC BY set. */
export const PICTURE_PREFIXES = ["twemoji"];

export interface IconDeps {
  fetch: typeof fetch;
  /** The offline icon cache (src/scenes/icon-cache.json), loaded on first
   *  need and registered with spec/icon-data.ts. Optional: a test's deps
   *  without it never read the bundled cache. */
  offline?: () => Promise<Record<string, string>>;
}

export function defaultDeps(): IconDeps {
  return { fetch: (input, init) => globalThis.fetch(input, init), offline: loadOfflineIcons };
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

/** Cache key for an icon keyword: keyed by `set` too (default "*"): the same
 *  keyword can resolve to a different icon depending on which set the author
 *  pinned it to. An icon element and a node's icon share it. */
function iconCacheKey(of: string, set: string | undefined, look: IconLook): string {
  return `ic${ICON_VERSION}|${set ? "" : look}|${set ?? "*"}|${of.trim().toLowerCase()}`;
}

/** The first `prefix:name` result whose prefix's licence class is allowed (and, given `exactName`, whose name is exactly that), or null. */
function firstAllowed(icons: unknown, allow: ("permissive" | "by")[], exactName?: string): { prefix: string; name: string } | null {
  if (!Array.isArray(icons)) return null;
  for (const entry of icons) {
    if (typeof entry !== "string") continue;
    const sep = entry.indexOf(":");
    if (sep < 0) continue;
    const prefix = entry.slice(0, sep), name = entry.slice(sep + 1);
    if (exactName !== undefined && name !== exactName) continue;
    const row = ICON_SETS[prefix];
    if (row && (allow as string[]).includes(row.cls)) return { prefix, name };
  }
  return null;
}

/** A node's `icon` as {of, set}, or null when it has none (or an unusable one). */
export function nodeIconRequest(el: Pick<SpecElement, "type" | "icon">): { of: string; set?: string } | null {
  if (el.type !== "node" || el.icon === undefined) return null;
  const icon = typeof el.icon === "string" ? { of: el.icon } : el.icon;
  if (!icon || typeof icon.of !== "string" || icon.of.trim() === "") return null;
  return typeof icon.set === "string" && icon.set !== "" ? { of: icon.of, set: icon.set } : { of: icon.of };
}


/** What a resolution is stored under beside its strokes (`icon_key`): the keyword and the set it came from. */
export function iconKey(of: string, set: string): string {
  return `${slug(of)}@${set}`;
}

/**
 * Whether strokes stored under `key` still answer this request: the same
 * keyword, and the same set when one is asked for. No key (a spec written
 * before keys were stored) trusts the strokes as they are.
 */
export function iconKeyMatches(key: unknown, req: { of: string; set?: string }): boolean {
  if (typeof key !== "string" || key === "") return true;
  const at = key.lastIndexOf("@");
  const of = at < 0 ? key : key.slice(0, at), set = at < 0 ? "" : key.slice(at + 1);
  return of === slug(req.of) && (req.set === undefined || req.set === set);
}

/** The set a stored key names ("" for none). */
const keySet = (key: unknown): string => (typeof key === "string" && key.includes("@") ? key.slice(key.lastIndexOf("@") + 1) : "");

/**
 * Fill one icon's data, IN PLACE on `host`: kept when it is there and still
 * answers the ask (its key), else resolved (resolveKeyword). Legacy rings-only
 * data asked for as a picture is resolved again for the artwork, and kept
 * when that fails — a drawn icon beats none. Throws with the reason.
 */
async function fillOne(
  spec: Spec,
  host: Record<string, unknown>,
  f: { data: string; key: string; credit: string },
  req: IconAsk,
  look: IconLook,
  deps: IconDeps,
  opts: IconResolveOpts,
): Promise<void> {
  const have = host[f.data];
  const fresh = isIconData(have) && iconKeyMatches(host[f.key], req);
  if (fresh && !(look === "picture" && decodeIconSvg(have) === null)) return;
  const kept = fresh ? { data: have, key: host[f.key], credit: host[f.credit] } : null;
  // Unresolved, or resolved for an icon since edited: never keep a wrong picture.
  delete host[f.data];
  delete host[f.key];
  try {
    const got = await resolveKeyword(spec, req, look, deps, opts);
    host[f.data] = got.strokes;
    host[f.credit] = got.credit;
    host[f.key] = iconKey(req.of, got.set);
  } catch (err) {
    if (!kept) throw err;
    host[f.data] = kept.data;
    if (kept.key !== undefined) host[f.key] = kept.key;
    if (kept.credit !== undefined) host[f.credit] = kept.credit;
  }
}

/**
 * A cards element's icons (round 5 §3.3): each item's `icon` into its
 * `icon_strokes` and `credit`, and a match item's `match_icon` (its
 * partner's) into `match_icon_strokes` and `match_credit` — the fields
 * spec/cards.ts copies onto the card nodes — with the key each was resolved
 * for (`icon_key`, `match_icon_key`), so an edited icon is resolved again.
 * Reported under the card's id.
 */
async function resolveCardIcons(spec: Spec, el: SpecElement, results: IconResolution[], deps: IconDeps, opts: IconResolveOpts): Promise<void> {
  const items = Array.isArray(el.items) ? el.items : [];
  const look = iconLookOf(el);
  const sides = [
    { icon: "icon", data: "icon_strokes", credit: "credit", key: "icon_key", id: (i: number) => `${el.id}_${i + 1}` },
    { icon: "match_icon", data: "match_icon_strokes", credit: "match_credit", key: "match_icon_key", id: (i: number) => `${el.id}_m_${i + 1}` },
  ] as const;
  for (const [i, it] of items.entries()) {
    if (typeof it !== "object" || it === null) continue;
    const item = it as unknown as Record<string, unknown>;
    for (const side of sides) {
      const req = iconAsk(item[side.icon]);
      if (!req) continue;
      try {
        await fillOne(spec, item, side, req, look, deps, opts);
        results.push({ id: side.id(i), ok: true });
      } catch (err) {
        results.push({ id: side.id(i), ok: false, error: (err as Error).message });
      }
    }
  }
}

let offlineLoad: Promise<Record<string, string>> | null = null;

/** The offline icon cache, loaded once (its own chunk: only a spec with icons pays for it) and registered for the layout too. */
export function loadOfflineIcons(): Promise<Record<string, string>> {
  offlineLoad ??= import("../scenes/icon-cache.json")
    .then((m) => {
      const store = ((m as { default?: unknown }).default ?? m) as Record<string, string>;
      registerIconStore(store);
      return store;
    })
    .catch(() => ({}));
  return offlineLoad;
}

/**
 * One keyword → icon data (spec/icon-data.ts `ics1:`, the SVG): from the
 * spec's `assets:` or the offline cache, the IndexedDB cache, or Iconify
 * search (or a named `set` straight to the SVG endpoint) → licence check,
 * on a miss. A picture with no set pinned tries the colour set first
 * (PICTURE_PREFIXES). Throws with the reason; the caller turns it into a result.
 */
async function resolveKeyword(spec: Spec, req: IconAsk, look: IconLook, deps: IconDeps, opts: IconResolveOpts): Promise<{ strokes: string; set: string; credit: string }> {
  const { of } = req;
  const requestedSet = req.set;
  // Policy checks apply on every call, cache hit or miss: whether a
  // set may be used here depends on THIS call's `opts.forSeed`, not on
  // whether some earlier call already fetched the SVG.
  if (requestedSet) {
    const row = ICON_SETS[requestedSet];
    if (!row) throw new Error(`unknown icon set "${requestedSet}"`);
    if (row.cls === "logo") throw new Error(`logo sets are not allowed ("${requestedSet}")`);
    if (row.cls === "by-sa" && opts.forSeed) throw new Error(`share-alike set cannot be a seed ("${requestedSet}")`);
  }
  const name = iconAssetName(req, look);
  let stored = storedIcon(spec, name);
  if (stored === undefined && deps.offline) {
    await deps.offline().catch(() => undefined);
    stored = storedIcon(spec, name);
  }
  const fromData = (data: string): { strokes: string; set: string; credit: string } => {
    const d = decodeIconSvg(data);
    return { strokes: data, set: d?.set ?? requestedSet ?? "", credit: iconCreditOf(data) ?? "" };
  };
  if (stored !== undefined) return fromData(stored);
  const key = iconCacheKey(of, requestedSet, look);
  const cached = await cacheGet(key);
  if (cached && decodeIconSvg(cached)) return fromData(cached);
  let prefix: string, iconName: string;
  if (requestedSet) {
    prefix = requestedSet;
    iconName = slug(of);
  } else {
    const search = async (prefixes: string[], allow: ("permissive" | "by")[], exact = false) => {
      const res = await deps.fetch(iconSearchUrl(of, prefixes));
      const json = res.ok ? ((await res.json()) as { icons?: unknown }) : { icons: [] };
      const hit = firstAllowed(json.icons, allow, exact ? slug(of) : undefined);
      return hit;
    };
    // The colour set only when it has the keyword itself: its search ranks
    // "tram-car" for "car", and a wrong picture is worse than an ink one.
    let hit = look === "picture" ? await search(PICTURE_PREFIXES, ["by"], true) : null;
    hit ??= await search(DEFAULT_PREFIXES, ["permissive"]);
    hit ??= await search(BY_PREFIXES, ["by"]);
    if (!hit) throw new Error(`no icon found for "${of}"`);
    prefix = hit.prefix;
    iconName = hit.name;
  }
  const svgRes = await deps.fetch(iconSvgUrl(prefix, iconName));
  if (!svgRes.ok) throw new Error(`Iconify fetch failed (${svgRes.status}) for "${prefix}:${iconName}"`);
  const svg = await svgRes.text();
  if (svgToRings(svg).length === 0) throw new Error(`no outline found for "${prefix}:${iconName}"`);
  const data = encodeIconSvg(prefix, iconName, svg);
  await cachePut(key, data);
  return fromData(data);
}

/**
 * Resolve every `icon` element of a spec IN PLACE — fill `strokes`, `set` and
 * `credit` — and every node's `icon` (round 5 §3.3) — fill `icon_strokes` and
 * `credit`. Each also gets `icon_key`, what it was resolved for: data
 * whose key no longer matches the `icon` / `of` (an edit) is resolved again.
 * The data is the icon's SVG (spec/icon-data.ts); its look decides how the
 * layout shows it, and which set a bare keyword prefers. Licence-gated (see
 * icon-sets.ts): an unknown set, a logo set, or a share-alike set picked as
 * an unattended seed is rejected outright — no data, no credit. Failures are
 * reported, never thrown.
 */
export async function resolveIcons(spec: Spec, deps: IconDeps = defaultDeps(), opts: IconResolveOpts = {}): Promise<IconResolution[]> {
  const results: IconResolution[] = [];
  for (const el of spec.elements ?? []) {
    if (el.type === "cards") {
      await resolveCardIcons(spec, el, results, deps, opts);
      continue;
    }
    if (el.type === "node") {
      const req = nodeIconRequest(el);
      if (!req) continue;
      try {
        await fillOne(spec, el as unknown as Record<string, unknown>, { data: "icon_strokes", key: "icon_key", credit: "credit" }, req, iconLookOf(el), deps, opts);
        results.push({ id: el.id, ok: true });
      } catch (err) {
        results.push({ id: el.id, ok: false, error: (err as Error).message });
      }
      continue;
    }
    if (el.type !== "icon") continue;
    const look = iconLookOf(el);
    const have = inlineStrokes(spec, el);
    const fresh = !el.of || iconKeyMatches(el.icon_key, { of: el.of, ...(el.set ? { set: el.set } : {}) });
    if (have && isIconData(have) && fresh && !(look === "picture" && el.of && decodeIconSvg(have) === null)) {
      results.push({ id: el.id, ok: true });
      continue;
    }
    // Resolved for an `of` since edited: the strokes go, and a `set` the
    // resolver filled in (the key's) no longer binds the search.
    let set = el.set;
    const kept = fresh && have && isIconData(have) ? { strokes: el.strokes, credit: el.credit, key: el.icon_key } : null;
    if (!fresh) {
      delete el.strokes;
      if (set && set === keySet(el.icon_key)) set = undefined;
      delete el.icon_key;
    }
    if (kept) delete el.strokes;
    if (el.strokes || !el.of) {
      results.push({ id: el.id, ok: false, error: "icon has no description or readable strokes" });
      continue;
    }
    try {
      const got = await resolveKeyword(spec, { of: el.of, ...(set ? { set } : {}) }, look, deps, opts);
      el.strokes = got.strokes;
      el.set = got.set;
      el.credit = got.credit;
      el.icon_key = iconKey(el.of, got.set);
      results.push({ id: el.id, ok: true });
    } catch (err) {
      if (kept) {
        el.strokes = kept.strokes;
        results.push({ id: el.id, ok: true });
        continue;
      }
      results.push({ id: el.id, ok: false, error: (err as Error).message });
    }
  }
  return results;
}
