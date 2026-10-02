// The `icon` element: a keyword ("factory", "flask") resolved to a small
// glyph via the Iconify API, embedded as outline rings the way a portrait
// embeds a traced photo. Licence-gated like `image.ts`'s Commons photos —
// an icon set's licence class decides whether it may be picked automatically
// (DEFAULT_PREFIXES, EXTRA_PREFIXES, then BY_PREFIXES) or only when the author
// names it explicitly (`el.set`), and a trademarked logo set is never
// resolvable at all (see icon-sets.ts).
//
// Two families, one per look: a picture comes from the colour emoji sets
// (PICTURE_PREFIXES), a drawn icon from the ink sets. Search results are
// ranked by name (nameScore), not taken first-come, and a figure's icons are
// pulled toward one set afterwards (harmonise) so a slide keeps one style.
//
// Modeled on render/image.ts: same never-throw contract, same cache
// (cacheGet/cachePut), same injected-deps seam so tests never hit the
// network.

import type { Spec, SpecElement } from "../spec/types";
import { inlineStrokes } from "../spec/assets";
import {
  decodeIconSvg,
  encodeIconSvg,
  iconAlternatives,
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

/** Tried first when an icon element gives no explicit `set`: no attribution owed. In
 *  order of preference — a tie on name goes to the earlier set (tabler: the largest). */
export const DEFAULT_PREFIXES = ["tabler", "lucide", "ph", "heroicons", "material-symbols"];

/** Tried when DEFAULT_PREFIXES have no good match: still no attribution owed.
 *  Real-world objects the UI sets lack (sheep, elephant, violin, grapes) and
 *  medical ones (kidney, blood cells, doctor). */
export const EXTRA_PREFIXES = ["mdi", "icon-park-outline", "hugeicons", "healthicons"];

/** Tried last, once no permissive set has a good match: attribution owed (the
 *  `credit` line pays it). game-icons: filled silhouettes of nearly any object,
 *  which trace well by hand. */
export const BY_PREFIXES = ["fa6-solid", "fa6-regular", "twemoji", "game-icons"];

/** A match this good is taken at once; a weaker one only when no tier has better. */
const STRONG = 2;

/** What a colour (emoji) match must score: the thing itself. Emoji names
 *  describe ("tram-car", "police-car"), so a head-noun match there is a near miss. */
const EXACT = 3;

/** Style and size suffixes a set adds to a name ("-outline", "-filled", "-01", fluent's "-24"). */
const STYLE_SUFFIX = /-(?:outline|outlined|filled|fill|solid|bold|regular|light|thin|duotone|twotone|rounded|sharp|alt|\d+)$/;

/** A hyphenated name with its last word singular: "blood-cells" → "blood-cell". */
const singularName = (name: string): string => {
  const parts = name.split("-");
  parts[parts.length - 1] = singular(parts[parts.length - 1]);
  return parts.join("-");
};

/**
 * How well an icon's name answers a query: 3 the thing itself ("car",
 * "car-filled", "hospital-bed-01"); 2 the query as the head noun, last
 * ("hand-saw", "balance-scale"); 1 the query first, modifying something else
 * ("chicken-leg", "fish-eggs", "scale-mail"); 0 anywhere else ("wave-saw-tool").
 */
export function nameScore(name: string, query: string): number {
  let core = name.toLowerCase();
  for (let next = core.replace(STYLE_SUFFIX, ""); next !== core && next !== ""; next = core.replace(STYLE_SUFFIX, "")) core = next;
  const c = singularName(core), q = singularName(slug(query));
  if (c === q) return 3;
  if (c.endsWith(`-${q}`)) return 2;
  if (c.startsWith(`${q}-`)) return 1;
  return 0;
}

/** A word's singular, by the common English endings; short words and -ss/-us/-is words kept. */
function singular(word: string): string {
  if (word.length <= 3 || /(ss|us|is)$/.test(word)) return word;
  if (/[^aeiou]ies$/.test(word)) return word.slice(0, -3) + "y";
  if (/(ches|shes|xes|sses)$/.test(word)) return word.slice(0, -2);
  return word.endsWith("s") ? word.slice(0, -1) : word;
}

/** One keyword's queries: itself, its last word singular, then leading words dropped — never to one word from a phrase. */
function keywordQueries(of: string): string[] {
  const words = of.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const out: string[] = [];
  for (let k = words.length; k >= Math.min(2, words.length); k--) {
    const tail = words.slice(words.length - k);
    out.push(tail.join(" "), [...tail.slice(0, -1), singular(tail[tail.length - 1])].join(" "));
  }
  return out;
}

/**
 * The queries a keyword's search tries, in order: the keyword itself, then
 * each `or` alternative as written, then the looser forms of each — its last
 * word made singular ("cows" → "cow"), then words dropped from the left
 * ("red blood cell" → "blood cell"), since the head noun of an English phrase
 * comes last. Never down to one word from a longer phrase: a bare "cell" or
 * "plant" is the near miss the prompt would rather leave out.
 */
export function searchQueries(of: string, or: string[] = []): string[] {
  const each = [of, ...or].map(keywordQueries).filter((qs) => qs.length > 0);
  return [...new Set([...each.map((qs) => qs[0]), ...each.flatMap((qs) => qs.slice(1))])];
}

/** Bump when the resolver's output changes — old cache entries stop matching. 2: the SVG itself (spec/icon-data.ts `ics1:`), per look; 3: pictures by twemoji name and alias; 4: ranked by name, emoji family for pictures. */
const ICON_VERSION = 4;

export function iconSearchUrl(q: string, prefixes: string[]): string {
  return `https://api.iconify.design/search?query=${encodeURIComponent(q)}&limit=64&prefixes=${prefixes.join(",")}`;
}

export function iconSvgUrl(prefix: string, name: string): string {
  return `https://api.iconify.design/${prefix}/${name}.svg`;
}

/** lower-case, runs of whitespace → one hyphen: how a free-text `of` becomes an Iconify icon name. */
const slug = iconSlug;

/** An Iconify SVG's outlines as 0..1 rings — spec/icon-data.ts, where the layout traces a drawn icon too. */
export { svgToRings };

/** The colour family, tried first for a PICTURE (round 6 §8) when no set is
 *  pinned: twemoji (CC BY, credited), then noto and fluent-emoji-flat — the
 *  same emoji in a like flat style, no attribution owed. */
export const PICTURE_PREFIXES = ["twemoji", "noto", "fluent-emoji-flat"];

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

type Hit = { prefix: string; name: string; score: number };
type Allow = ("permissive" | "by")[];

/** The best-named `prefix:name` result whose prefix's licence class is allowed, or null: by nameScore, then the set's place in `prefixes`, then Iconify's order. */
function bestAllowed(icons: unknown, allow: Allow, query: string, prefixes: string[]): Hit | null {
  if (!Array.isArray(icons)) return null;
  let best: (Hit & { rank: number }) | null = null;
  for (const [i, entry] of icons.entries()) {
    if (typeof entry !== "string") continue;
    const sep = entry.indexOf(":");
    if (sep < 0) continue;
    const prefix = entry.slice(0, sep), name = entry.slice(sep + 1);
    const row = ICON_SETS[prefix];
    if (!row || !(allow as string[]).includes(row.cls)) continue;
    const score = nameScore(name, query);
    const at = prefixes.indexOf(prefix);
    const rank = (at < 0 ? prefixes.length : at) * 1e4 + i;
    if (!best || score > best.score || (score === best.score && rank < best.rank)) best = { prefix, name, score, rank };
  }
  return best && { prefix: best.prefix, name: best.name, score: best.score };
}

/** One Iconify search, ranked. */
async function searchBest(deps: IconDeps, q: string, prefixes: string[], allow: Allow): Promise<Hit | null> {
  const res = await deps.fetch(iconSearchUrl(q, prefixes));
  const json = res.ok ? ((await res.json()) as { icons?: unknown }) : { icons: [] };
  return bestAllowed(json.icons, allow, q, prefixes);
}

/** An icon's SVG, or null when it is missing or has no outline. */
async function fetchSvg(deps: IconDeps, prefix: string, name: string): Promise<string | null> {
  const res = await deps.fetch(iconSvgUrl(prefix, name));
  if (!res.ok) return null;
  const text = await res.text();
  return svgToRings(text).length > 0 ? text : null;
}

/** A node's `icon` as {of, set, or}, or null when it has none (or an unusable one). */
export function nodeIconRequest(el: Pick<SpecElement, "type" | "icon">): IconAsk | null {
  if (el.type !== "node" || el.icon === undefined) return null;
  return iconAsk(el.icon);
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
  jobs: Job[],
): Promise<void> {
  const job = (set: string, source: Source): void => {
    jobs.push({
      look,
      req,
      set,
      source,
      apply: (got) => {
        host[f.data] = got.strokes;
        host[f.credit] = got.credit;
        host[f.key] = iconKey(req.of, got.set);
      },
    });
  };
  const have = host[f.data];
  const fresh = isIconData(have) && iconKeyMatches(host[f.key], req);
  const legacy = look === "picture" && decodeIconSvg(have) === null;
  if (fresh && (!legacy || pictureMisses.has(iconAssetName(req, look)))) {
    job(keySet(host[f.key]) || (decodeIconSvg(have)?.set ?? ""), "kept");
    return;
  }
  const kept = fresh ? { data: have, key: host[f.key], credit: host[f.credit] } : null;
  // Unresolved, or resolved for an icon since edited: never keep a wrong picture.
  delete host[f.data];
  delete host[f.key];
  try {
    const got = await resolveKeyword(spec, req, look, deps, opts);
    host[f.data] = got.strokes;
    host[f.credit] = got.credit;
    host[f.key] = iconKey(req.of, got.set);
    job(got.set, got.source);
  } catch (err) {
    if (!kept) throw err;
    pictureMisses.add(iconAssetName(req, look));
    host[f.data] = kept.data;
    if (kept.key !== undefined) host[f.key] = kept.key;
    if (kept.credit !== undefined) host[f.credit] = kept.credit;
    job(keySet(kept.key), "kept");
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
async function resolveCardIcons(spec: Spec, el: SpecElement, results: IconResolution[], jobs: Job[], deps: IconDeps, opts: IconResolveOpts): Promise<void> {
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
        await fillOne(spec, item, side, req, look, deps, opts, jobs);
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

/** Where an icon's data came from this render: `kept` (already on its host),
 *  `stored` (the spec's `assets:` or the offline cache — never re-picked, so a
 *  published cast and the examples stay as they are), `found` (the IndexedDB
 *  cache or Iconify). */
type Source = "kept" | "stored" | "found";
type Got = { strokes: string; set: string; credit: string };

/** One icon of a figure, for the harmonising pass: its ask, the set it came from, and how to replace it. */
interface Job {
  look: IconLook;
  req: IconAsk;
  set: string;
  source: Source;
  apply: (got: Got) => void;
}

const TIERS: { prefixes: string[]; allow: Allow }[] = [
  { prefixes: DEFAULT_PREFIXES, allow: ["permissive"] },
  { prefixes: EXTRA_PREFIXES, allow: ["permissive"] },
  { prefixes: BY_PREFIXES, allow: ["by"] },
];

/**
 * The ink search: each query (searchQueries) through the tiers, a strong
 * match (nameScore ≥ STRONG) taken at once — the keyword as written in every
 * tier before any looser form of it, so an exact CC BY hit beats a trimmed
 * permissive one. A weak match is kept only when nothing better turns up.
 */
async function searchTiers(deps: IconDeps, of: string, alts: string[]): Promise<Hit | null> {
  let weak: Hit | null = null;
  for (const q of searchQueries(of, alts)) {
    for (const t of TIERS) {
      const h = await searchBest(deps, q, t.prefixes, t.allow);
      if (!h) continue;
      if (h.score >= STRONG) return h;
      if (!weak || h.score > weak.score) weak = h;
    }
  }
  return weak;
}

const gotOf = (prefix: string, name: string, svg: string): Got => {
  const data = encodeIconSvg(prefix, name, svg);
  return { strokes: data, set: prefix, credit: iconCreditOf(data) ?? "" };
};

/**
 * One keyword → icon data (spec/icon-data.ts `ics1:`, the SVG): from the
 * spec's `assets:` or the offline cache, the IndexedDB cache, or Iconify
 * (a named `set` straight to the SVG endpoint by name) → licence check, on a
 * miss. A picture with no set pinned stays in the colour family when it can:
 * twemoji by name, then the family searched for a well-named match; else the
 * ink tiers. Throws with the reason; the caller turns it into a result.
 */
async function resolveKeyword(spec: Spec, req: IconAsk, look: IconLook, deps: IconDeps, opts: IconResolveOpts): Promise<Got & { source: Source }> {
  const { of } = req;
  const alts = req.or ?? [];
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
  const fromData = (data: string, source: Source): Got & { source: Source } => {
    const d = decodeIconSvg(data);
    return { strokes: data, set: d?.set ?? requestedSet ?? "", credit: iconCreditOf(data) ?? "", source };
  };
  if (stored !== undefined) return fromData(stored, "stored");
  const key = iconCacheKey(of, requestedSet, look);
  const cached = await cacheGet(key);
  if (cached && decodeIconSvg(cached)) return fromData(cached, "found");
  const keywords = [of, ...alts];
  let hit: { prefix: string; name: string } | null = null;
  let svg: string | null = null;
  if (requestedSet) {
    // A pinned set is asked by name: the keyword's, then each alternative's.
    for (const n of [...new Set(keywords.map(slug))]) {
      svg = await fetchSvg(deps, requestedSet, n);
      if (svg !== null) {
        hit = { prefix: requestedSet, name: n };
        break;
      }
    }
    hit ??= { prefix: requestedSet, name: slug(of) };
  } else {
    if (look === "picture") {
      // twemoji by NAME first (fix round 1): the keyword's own, an alias
      // (car → automobile), then "<kw>-face". Then the colour family by
      // search, an exact name only (its search ranks "tram-car" for "car"):
      // a wrong picture is worse than an ink one.
      for (const n of [...new Set(keywords.flatMap(pictureNames))]) {
        svg = await fetchSvg(deps, PICTURE_PREFIXES[0], n);
        if (svg !== null) {
          hit = { prefix: PICTURE_PREFIXES[0], name: n };
          break;
        }
      }
      if (!hit) {
        for (const q of searchQueries(of, alts)) {
          const h = await searchBest(deps, q, PICTURE_PREFIXES, ["permissive", "by"]);
          if (h && h.score >= EXACT) {
            hit = h;
            break;
          }
        }
      }
    }
    hit ??= await searchTiers(deps, of, alts);
    if (!hit) throw new Error(`no icon found for "${keywords.join('" or "')}"`);
  }
  if (svg === null) {
    const svgRes = await deps.fetch(iconSvgUrl(hit.prefix, hit.name));
    if (!svgRes.ok) throw new Error(`Iconify fetch failed (${svgRes.status}) for "${hit.prefix}:${hit.name}"`);
    svg = await svgRes.text();
    if (svgToRings(svg).length === 0) throw new Error(`no outline found for "${hit.prefix}:${hit.name}"`);
  }
  const data = encodeIconSvg(hit.prefix, hit.name, svg);
  await cachePut(key, data);
  return fromData(data, "found");
}

/** The colour family or the ink one. */
const familyOf = (set: string): IconLook => (PICTURE_PREFIXES.includes(set) ? "picture" : "drawn");

/** The ink sets, in tier order (twemoji is colour, whatever its tier). */
const INK_PREFIXES = TIERS.flatMap((t) => t.prefixes).filter((p) => !PICTURE_PREFIXES.includes(p));

/** An icon from one of `sets` with a well-named match only (a colour set: by name, or an exact name), or null. */
async function findIn(deps: IconDeps, req: IconAsk, sets: string[]): Promise<Got | null> {
  const alts = req.or ?? [];
  const colour = sets.every((s) => PICTURE_PREFIXES.includes(s));
  if (colour) {
    for (const set of sets) {
      for (const n of [...new Set([req.of, ...alts].flatMap(pictureNames))]) {
        const svg = await fetchSvg(deps, set, n);
        if (svg !== null) return gotOf(set, n, svg);
      }
    }
  }
  for (const q of searchQueries(req.of, alts)) {
    const h = await searchBest(deps, q, sets, ["permissive", "by"]);
    if (!h || h.score < (colour ? EXACT : STRONG)) continue;
    const svg = await fetchSvg(deps, h.prefix, h.name);
    if (svg !== null) return gotOf(h.prefix, h.name, svg);
  }
  return null;
}

/** The most frequent value (the first seen on a tie). */
function mostOf<T>(values: T[]): T {
  const n = new Map<T, number>();
  for (const v of values) n.set(v, (n.get(v) ?? 0) + 1);
  return [...n].reduce((a, b) => (b[1] > a[1] ? b : a))[0];
}

/**
 * One style per figure: among a look's icons, the family most of them came
 * from (a tie goes to the look's own), and within it the set most came from.
 * Each icon found this render outside that set — and not pinned to a set by
 * its author — is asked again there, then (when its family differs) in the
 * rest of the family, a well-named match only; it keeps what it has when
 * neither has one. Never throws.
 */
async function harmonise(jobs: Job[], deps: IconDeps): Promise<void> {
  for (const look of ["picture", "drawn"] as const) {
    const group = jobs.filter((j) => j.look === look && j.set !== "");
    if (group.length < 2) continue;
    const fams = group.map((j) => familyOf(j.set));
    const family = fams.filter((f) => f === look).length * 2 >= fams.length ? look : look === "picture" ? "drawn" : "picture";
    const main = mostOf(group.filter((j) => familyOf(j.set) === family).map((j) => j.set));
    const rest = (family === "picture" ? PICTURE_PREFIXES : INK_PREFIXES).filter((p) => p !== main);
    for (const j of group) {
      if (j.source !== "found" || j.req.set || j.set === main) continue;
      try {
        const got = (await findIn(deps, j.req, [main])) ?? (familyOf(j.set) !== family ? await findIn(deps, j.req, rest) : null);
        if (got) {
          j.apply(got);
          j.set = got.set;
        }
      } catch {
        // keep what it has
      }
    }
  }
}

/**
 * Resolve every `icon` element of a spec IN PLACE — fill `strokes`, `set` and
 * `credit` — and every node's `icon` (round 5 §3.3) — fill `icon_strokes` and
 * `credit`. Each also gets `icon_key`, what it was resolved for: data
 * whose key no longer matches the `icon` / `of` (an edit) is resolved again.
 * The data is the icon's SVG (spec/icon-data.ts); its look decides how the
 * layout shows it, and which set a bare keyword prefers. Licence-gated (see
 * icon-sets.ts): an unknown set, a logo set, or a share-alike set picked as
 * an unattended seed is rejected outright — no data, no credit. Then the
 * figure's icons are pulled toward one set (harmonise). Failures are
 * reported, never thrown.
 */
export async function resolveIcons(spec: Spec, deps: IconDeps = defaultDeps(), opts: IconResolveOpts = {}): Promise<IconResolution[]> {
  const results: IconResolution[] = [];
  const jobs: Job[] = [];
  for (const el of spec.elements ?? []) {
    if (el.type === "cards") {
      await resolveCardIcons(spec, el, results, jobs, deps, opts);
      continue;
    }
    if (el.type === "node") {
      const req = nodeIconRequest(el);
      if (!req) continue;
      try {
        await fillOne(spec, el as unknown as Record<string, unknown>, { data: "icon_strokes", key: "icon_key", credit: "credit" }, req, iconLookOf(el), deps, opts, jobs);
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
    const or = iconAlternatives(el.or);
    const job = (set: string, source: Source, req: IconAsk): void => {
      jobs.push({
        look,
        req,
        set,
        source,
        apply: (got) => {
          el.strokes = got.strokes;
          el.credit = got.credit;
          el.icon_key = iconKey(req.of, got.set);
        },
      });
    };
    if (have && isIconData(have) && fresh && !legacy) {
      if (el.of) job(keySet(el.icon_key) || (decodeIconSvg(have)?.set ?? ""), "kept", { of: el.of, ...(el.set ? { set: el.set } : {}) });
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
    const req: IconAsk = { of: el.of, ...(set ? { set } : {}), ...(or ? { or } : {}) };
    try {
      const got = await resolveKeyword(spec, req, look, deps, opts);
      el.strokes = got.strokes;
      // `set` stays the author's (fix round 1): pinning the one found would
      // keep a later icon_look: picture from ever reaching the colour set.
      el.credit = got.credit;
      el.icon_key = iconKey(el.of, got.set);
      job(got.set, got.source, req);
      results.push({ id: el.id, ok: true });
    } catch (err) {
      if (kept) {
        pictureMisses.add(missName);
        el.strokes = kept.strokes;
        job(keySet(kept.key), "kept", req);
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
        await fillOne(spec, host, { data: "strokes", key: "icon_key", credit: "credit" }, req, look, deps, opts, jobs);
        results.push({ id: `bar_${i + 1}`, ok: true });
      } catch (err) {
        results.push({ id: `bar_${i + 1}`, ok: false, error: (err as Error).message });
      }
    }
  }
  await harmonise(jobs, deps);
  return results;
}
