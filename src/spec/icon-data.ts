// Icon data (round 6 §8): a spec names an icon by KEYWORD only — an `icon`
// element's `of`, a node's or a card's `icon`, a match card's `match_icon` —
// and the artwork lives elsewhere, under one name per keyword:
//
//   - a published or embedded spec's `assets:` map (hoistIcons, below);
//   - the offline icon cache (src/scenes/icon-cache.json) that bundled
//     examples, lint and tests read — registered here by registerIconStore;
//   - the browser's IndexedDB cache and Iconify, which only render/icon.ts
//     (async) touches.
//
// The data is the icon's SVG, kept whole (`ics1:<set>:<name>:<svg>`), so one
// string serves both looks: `picture` shows the artwork itself, in its own
// colours (a line icon in ink), faded in whole; `drawn` traces its outlines
// by hand as the icon element always did (svgToRings). The older rings-only
// form (`ic1:`, spec/trace.ts encodeIcon) still reads, as drawn.
//
// Pure and synchronous: the layout, the card expansion and the lint all ask
// it, and none of them may wait.

import type { Spec } from "./types";
import { decodeIcon } from "./trace";
import { sampleSvgPath } from "../scenes/svgpath";
import { ICON_SETS } from "../render/icon-sets";

type Pt = [number, number];

/** How an icon is shown: its own artwork (`picture`) or traced by hand (`drawn`). */
export type IconLook = "picture" | "drawn";

/** An icon as asked for: a keyword, and a set when the author pinned one. */
export interface IconAsk {
  of: string;
  set?: string;
}

/** An `icon` / `match_icon` value (a keyword or {of, set}) as an ask, or null when unusable. */
export function iconAsk(icon: unknown): IconAsk | null {
  const req = typeof icon === "string" ? { of: icon } : (icon as { of?: unknown; set?: unknown } | null | undefined);
  if (!req || typeof req !== "object" || typeof req.of !== "string" || req.of.trim() === "") return null;
  return typeof req.set === "string" && req.set !== "" ? { of: req.of, set: req.set } : { of: req.of };
}

/** The look an element's icon takes: `icon_look` when given; else drawn for an `icon` element (the subject), a picture for a node's or a card's. */
export function iconLookOf(el: { type?: unknown; icon_look?: unknown }): IconLook {
  if (el.icon_look === "picture" || el.icon_look === "drawn") return el.icon_look;
  return el.type === "icon" ? "drawn" : "picture";
}

/** lower-case, runs of whitespace → one hyphen: how a free-text keyword becomes an Iconify icon name. */
export function iconSlug(of: string): string {
  return of.trim().toLowerCase().replace(/\s+/g, "-");
}

/**
 * The one name an icon's data goes by — in `assets:` and in the offline
 * cache alike: `icon.<keyword>`, `.<set>` when one is pinned, `.drawn` when
 * no set is pinned and the look is drawn (a picture prefers a colour set, so
 * the same bare keyword can land on different artwork per look).
 */
export function iconAssetName(ask: IconAsk, look: IconLook): string {
  const slug = iconSlug(ask.of).replace(/[^\w-]/g, "_");
  return ask.set ? `icon.${slug}.${ask.set}` : `icon.${slug}${look === "drawn" ? ".drawn" : ""}`;
}

const SVG_PREFIX = "ics1:";

/**
 * An Iconify SVG as icon data: the set and icon name it came from (the
 * credit is built from them) and the SVG with its outer width/height dropped
 * (Iconify writes `1em`; the viewBox alone scales it into any box).
 */
export function encodeIconSvg(set: string, name: string, svg: string): string {
  const clean = svg.replace(/<svg\b[^>]*>/, (open) => open.replace(/\s(?:width|height)="[^"]*"/g, ""));
  return `${SVG_PREFIX}${set}:${name}:${clean}`;
}

/** The parts of `ics1:` data, or null for anything else. */
export function decodeIconSvg(s: unknown): { set: string; name: string; svg: string } | null {
  if (typeof s !== "string" || !s.startsWith(SVG_PREFIX)) return null;
  const body = s.slice(SVG_PREFIX.length);
  const a = body.indexOf(":");
  const b = a < 0 ? -1 : body.indexOf(":", a + 1);
  if (a <= 0 || b <= a + 1) return null;
  const svg = body.slice(b + 1);
  if (!svg.trimStart().startsWith("<svg")) return null;
  return { set: body.slice(0, a), name: body.slice(a + 1, b), svg };
}

/** True for any icon data this module can show (`ics1:` SVG or `ic1:` rings). */
export function isIconData(s: unknown): s is string {
  return decodeIconSvg(s) !== null || (typeof s === "string" && decodeIcon(s) !== null);
}

/** The attribution line for `ics1:` data ("dog from twemoji · CC BY 4.0"), or undefined. */
export function iconCreditOf(data: unknown): string | undefined {
  const d = decodeIconSvg(data);
  if (!d) return undefined;
  const licence = ICON_SETS[d.set]?.licence;
  return licence ? `${d.name} from ${d.set} · ${licence}` : `${d.name} from ${d.set}`;
}

/**
 * An Iconify SVG's `<path>` outlines, each flattened to a ring and
 * normalised into the SVG's own `viewBox` (default `0 0 24 24`) so every
 * icon comes back in 0..1 coordinates regardless of its native grid.
 * Non-path shapes (`<rect>`, `<circle>`, …) are ignored — Iconify normalises
 * the sets drawn from to paths.
 */
export function svgToRings(svg: string): Pt[][] {
  const vbMatch = svg.match(/viewBox="([^"]+)"/);
  const [minX, minY, w, h] = (vbMatch ? vbMatch[1].trim().split(/\s+/).map(Number) : [0, 0, 24, 24]) as [number, number, number, number];
  const rings: Pt[][] = [];
  for (const m of svg.matchAll(/<path\b[^>]*\bd="([^"]+)"/g)) {
    for (const ring of sampleSvgPath(m[1], 6)) {
      rings.push(ring.map(([x, y]) => [(x - minX) / w, (y - minY) / h] as Pt));
    }
  }
  return rings;
}

const ringMemo = new Map<string, Pt[][] | null>();

/** The rings to trace for icon data (0..1, y-down), from either form; null when unreadable or empty. Memoised: a layout asks every frame. */
export function iconRingsOf(data: unknown): Pt[][] | null {
  if (typeof data !== "string") return null;
  const hit = ringMemo.get(data);
  if (hit !== undefined) return hit;
  const svg = decodeIconSvg(data);
  const rings = svg ? svgToRings(svg.svg) : decodeIcon(data);
  const out = rings && rings.length > 0 ? rings : null;
  if (ringMemo.size > 400) ringMemo.clear();
  ringMemo.set(data, out);
  return out;
}

/**
 * The picture for icon data: a self-contained `data:` URI of the SVG with
 * `currentColor` (a line icon's ink) set to `ink`, and its aspect (h / w,
 * from the viewBox). Null for rings-only data — that can only be drawn.
 */
export function iconPictureOf(data: unknown, ink: string): { href: string; aspect: number } | null {
  const d = decodeIconSvg(data);
  if (!d) return null;
  const vb = d.svg.match(/viewBox="([^"]+)"/);
  const [, , w, h] = vb ? vb[1].trim().split(/\s+/).map(Number) : [0, 0, 24, 24];
  const aspect = w > 0 && h > 0 ? h / w : 1;
  const svg = d.svg.replace(/currentColor/g, ink);
  return { href: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`, aspect };
}

// ---- the offline stores ---------------------------------------------------

const stores: Record<string, string>[] = [];
let complete = false;

/**
 * Make a name → data map (the offline icon cache) answer every lookup below.
 * `complete`: every icon in play is meant to be in it (the tests, the
 * example scripts) — a keyword it lacks is then named as missing from the
 * cache. The app's lazily loaded copy is not complete: anything else is
 * resolved over the network. Registering the same map twice is a no-op.
 */
export function registerIconStore(store: Record<string, string>, opts: { complete?: boolean } = {}): void {
  if (!stores.includes(store)) stores.push(store);
  if (opts.complete) complete = true;
}

/** Forget every registered store (tests). */
export function clearIconStores(): void {
  stores.length = 0;
  complete = false;
}

/** True once a complete offline store is registered — the layout then names a keyword the cache lacks. */
export function hasIconStore(): boolean {
  return complete;
}

/** Icon data by name: the spec's own `assets:` first, then the offline stores. */
export function storedIcon(spec: Pick<Spec, "assets"> | undefined, name: string): string | undefined {
  const own = spec?.assets?.[name];
  if (isIconData(own)) return own;
  for (const s of stores) if (isIconData(s[name])) return s[name];
  return undefined;
}

/** True when an icon element carries its artwork in the document itself — inline, or under its keyword in `assets:` (the offline cache does not count). */
export function iconEmbedded(spec: Pick<Spec, "assets">, el: { type?: unknown; of?: unknown; set?: unknown; icon_look?: unknown; strokes?: unknown }): boolean {
  if (isIconData(el.strokes)) return true;
  if (typeof el.of !== "string" || el.of.trim() === "") return false;
  const ask = { of: el.of, ...(typeof el.set === "string" && el.set !== "" ? { set: el.set } : {}) };
  return isIconData(spec.assets?.[iconAssetName(ask, iconLookOf(el))]);
}

// ---- filling a spec from the stores ---------------------------------------

/** One place an icon is asked for, and where its data and credit go. */
interface IconSlot {
  ask: IconAsk;
  look: IconLook;
  host: Record<string, unknown>;
  data: string;
  credit: string;
}

/** Every icon a spec asks for: icon elements, nodes, cards' items (and match partners). */
export function iconSlots(spec: Pick<Spec, "elements">): IconSlot[] {
  const out: IconSlot[] = [];
  for (const el of spec.elements ?? []) {
    if (!el || typeof el !== "object") continue;
    const host = el as unknown as Record<string, unknown>;
    if (el.type === "icon") {
      if (typeof el.of === "string" && el.of.trim() !== "") out.push({ ask: { of: el.of, ...(el.set ? { set: el.set } : {}) }, look: iconLookOf(el), host, data: "strokes", credit: "credit" });
    } else if (el.type === "node") {
      const ask = iconAsk(el.icon);
      if (ask) out.push({ ask, look: iconLookOf(el), host, data: "icon_strokes", credit: "credit" });
    } else if (el.type === "cards" && Array.isArray(el.items)) {
      const look = iconLookOf(el);
      for (const it of el.items) {
        if (typeof it !== "object" || it === null) continue;
        const item = it as unknown as Record<string, unknown>;
        const a = iconAsk(item.icon);
        if (a) out.push({ ask: a, look, host: item, data: "icon_strokes", credit: "credit" });
        const m = iconAsk(item.match_icon);
        if (m) out.push({ ask: m, look, host: item, data: "match_icon_strokes", credit: "match_credit" });
      }
    }
  }
  return out;
}

/** The keywords a spec asks for that neither carry data nor find it in `assets:` or an offline store. */
export function missingIcons(spec: Spec): IconAsk[] {
  return iconSlots(spec)
    .filter((s) => !isIconData(s.host[s.data]) && storedIcon(spec, iconAssetName(s.ask, s.look)) === undefined)
    .map((s) => s.ask);
}

/**
 * Fill every icon that carries no data of its own from `assets:` or the
 * offline stores, IN PLACE — data, and the credit when none is written.
 * Returns how many were filled.
 */
export function fillIconDataInPlace(spec: Spec): number {
  let n = 0;
  for (const s of iconSlots(spec)) {
    if (isIconData(s.host[s.data])) continue;
    const data = storedIcon(spec, iconAssetName(s.ask, s.look));
    if (data === undefined) continue;
    s.host[s.data] = data;
    const credit = iconCreditOf(data);
    if (credit && typeof s.host[s.credit] !== "string") s.host[s.credit] = credit;
    n++;
  }
  return n;
}

/** fillIconDataInPlace on a copy — the same object back when nothing is there to fill (render must never write into the document, B11). */
export function withIconData(spec: Spec): Spec {
  const fillable = iconSlots(spec).some((s) => !isIconData(s.host[s.data]) && storedIcon(spec, iconAssetName(s.ask, s.look)) !== undefined);
  if (!fillable) return spec;
  const copy = structuredClone(spec);
  fillIconDataInPlace(copy);
  return copy;
}

// ---- hoisting into assets -------------------------------------------------

/**
 * Move every icon's inline data into `spec.assets`, IN PLACE, under its
 * keyword's name (iconAssetName) — the element keeps the keyword only: no
 * data, no key, and no credit the data itself can rebuild. What Publish and
 * the Embed dialog do before writing a spec out, and the inverse of
 * fillIconDataInPlace. Data already under the name is kept (one keyword, one
 * artwork). Returns how many fields were moved.
 */
export function hoistIcons(spec: Spec): number {
  let moved = 0;
  const keyField = (dataField: string): string => (dataField === "match_icon_strokes" ? "match_icon_key" : "icon_key");
  for (const s of iconSlots(spec)) {
    const data = s.host[s.data];
    if (!isIconData(data)) continue;
    const name = iconAssetName(s.ask, s.look);
    const assets = (spec.assets ??= {});
    if (!isIconData(assets[name])) assets[name] = data;
    delete s.host[s.data];
    delete s.host[keyField(s.data)];
    if (s.host[s.credit] === iconCreditOf(data)) delete s.host[s.credit];
    moved++;
  }
  return moved;
}
