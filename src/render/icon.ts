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

/** Bump when the resolver's output changes — old cache entries stop matching. 2: the SVG itself (spec/icon-data.ts `ics1:`), per look; 3: pictures by twemoji name and alias. */
const ICON_VERSION = 3;

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

/** Common keywords whose twemoji goes by another name (each checked against the set). */
export const PICTURE_ALIASES: Record<string, string> = {
  car: "automobile", lightning: "high-voltage", heart: "red-heart", money: "money-bag", cash: "dollar-banknote",
  phone: "mobile-phone", computer: "laptop", doctor: "health-worker", medicine: "pill", vaccine: "syringe",
  idea: "light-bulb", bulb: "light-bulb", clock: "alarm-clock", time: "hourglass-done", book: "open-book",
  bike: "bicycle", plane: "airplane", train: "locomotive", boat: "sailboat", virus: "microbe", bacteria: "microbe",
  bacterium: "microbe", germ: "microbe", globe: "globe-showing-europe-africa", earth: "globe-showing-europe-africa",
  world: "globe-showing-europe-africa", water: "droplet", trash: "wastebasket", chart: "chart-increasing",
  graph: "chart-increasing", lock: "locked", mail: "envelope", email: "envelope", tree: "deciduous-tree",
  flower: "blossom", home: "house", rain: "cloud-with-rain", snow: "snowflake", gift: "wrapped-gift",
  target: "direct-hit", check: "check-mark-button", cross: "cross-mark", question: "red-question-mark",
  dice: "game-die", die: "game-die", shop: "convenience-store", store: "convenience-store", cart: "shopping-cart",
  food: "fork-and-knife-with-plate", apple: "red-apple", bee: "honeybee", sheep: "ewe", people: "busts-in-silhouette",
  heartbeat: "beating-heart", plug: "electric-plug", tool: "hammer-and-wrench", tools: "hammer-and-wrench",
  bag: "handbag", map: "world-map", flag: "triangular-flag", moon: "crescent-moon", music: "musical-note",
  tv: "television",
};

/** The twemoji names a picture keyword tries, in order: an alias, the keyword itself, "<keyword>-face". */
export function pictureNames(of: string): string[] {
  const s = slug(of);
  return [...new Set([PICTURE_ALIASES[s], s, `${s}-face`].filter((n): n is string => !!n))];
}

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
/** Old rings-only icons whose picture could not be had this session: not asked again on every render (offline). */
const pictureMisses = new Set<string>();

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
  const legacy = look === "picture" && decodeIconSvg(have) === null;
  if (fresh && (!legacy || pictureMisses.has(iconAssetName(req, look)))) return;
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
    pictureMisses.add(iconAssetName(req, look));
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
  let svg: string | null = null;
  let svgName = "";
  if (requestedSet) {
    prefix = requestedSet;
    iconName = slug(of);
  } else {
    // A picture tries the colour set by NAME first (fix round 1): the
    // keyword's own twemoji, an alias (car → automobile), then "<kw>-face".
    // Its search ranks "tram-car" for "car"; a wrong picture is worse than
    // an ink one, so a miss simply falls through to the line icons.
    if (look === "picture") {
      for (const name of pictureNames(of)) {
        const res = await deps.fetch(iconSvgUrl(PICTURE_PREFIXES[0], name));
        if (!res.ok) continue;
        const text = await res.text();
        if (svgToRings(text).length === 0) continue;
        svg = text;
        svgName = name;
        break;
      }
    }
    if (svg !== null) {
      prefix = PICTURE_PREFIXES[0];
      iconName = svgName;
    } else {
      const search = async (prefixes: string[], allow: ("permissive" | "by")[]) => {
        const res = await deps.fetch(iconSearchUrl(of, prefixes));
        const json = res.ok ? ((await res.json()) as { icons?: unknown }) : { icons: [] };
        return firstAllowed(json.icons, allow);
      };
      let hit = await search(DEFAULT_PREFIXES, ["permissive"]);
      hit ??= await search(BY_PREFIXES, ["by"]);
      if (!hit) throw new Error(`no icon found for "${of}"`);
      prefix = hit.prefix;
      iconName = hit.name;
    }
  }
  if (svg === null) {
    const svgRes = await deps.fetch(iconSvgUrl(prefix, iconName));
    if (!svgRes.ok) throw new Error(`Iconify fetch failed (${svgRes.status}) for "${prefix}:${iconName}"`);
    svg = await svgRes.text();
    if (svgToRings(svg).length === 0) throw new Error(`no outline found for "${prefix}:${iconName}"`);
  }
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
    const missName = el.of ? iconAssetName({ of: el.of, ...(el.set ? { set: el.set } : {}) }, look) : "";
    const legacy = look === "picture" && !!el.of && decodeIconSvg(have) === null && !pictureMisses.has(missName);
    if (have && isIconData(have) && fresh && !legacy) {
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
      // `set` stays the author's (fix round 1): pinning the one found would
      // keep a later icon_look: picture from ever reaching the colour set.
      el.credit = got.credit;
      el.icon_key = iconKey(el.of, got.set);
      results.push({ id: el.id, ok: true });
    } catch (err) {
      if (kept) {
        pictureMisses.add(missName);
        el.strokes = kept.strokes;
        results.push({ id: el.id, ok: true });
        continue;
      }
      results.push({ id: el.id, ok: false, error: (err as Error).message });
    }
  }
  // A bar chart's icons (round 7 §6): one per bar, into params.icon_data[i].
  const p = spec.params as Record<string, unknown> | undefined;
  if (spec.template === "bar_chart" && p && Array.isArray(p.icons)) {
    const look = iconLookOf({ type: "bar", icon_look: p.icon_look });
    for (const [i, k] of (p.icons as unknown[]).entries()) {
      const req = iconAsk(k);
      if (!req) continue;
      const data = (Array.isArray(p.icon_data) ? p.icon_data : (p.icon_data = [])) as Record<string, unknown>[];
      const host = (data[i] ??= {});
      try {
        await fillOne(spec, host, { data: "strokes", key: "icon_key", credit: "credit" }, req, look, deps, opts);
        results.push({ id: `bar_${i + 1}`, ok: true });
      } catch (err) {
        results.push({ id: `bar_${i + 1}`, ok: false, error: (err as Error).message });
      }
    }
  }
  return results;
}
