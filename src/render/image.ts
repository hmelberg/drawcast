// The `image` element: an illustrative Commons photo resolved from a plain
// description ("of"), the way portraits resolve from a name — but where a
// portrait draws a traced sketch, an image embeds the faithful photo and
// carries a licence-gated credit line, because a Commons photo (unlike a
// Wikipedia infobox portrait) makes no promise about reuse rights.
//
// Modeled on render/portrait.ts's resolvePortraits: same cache, same
// fetch→trace shape, same never-throw contract.

import type { Spec, SpecElement } from "../spec/types";
import { inlineStrokes } from "../spec/assets";
import { decodePhoto, encodeLinkedPhoto, encodePhoto, isLinkedPhoto } from "../spec/trace";
import { cacheGet, cachePut, faithfulDataUri, LOOK_DIM, loadRaster, measureNatural, SCREEN_DIM, SCREEN_MIN_DIM, SCREEN_URI_BUDGET, styledPhotoDataUri, wikiSummaryUrl, type Raster } from "./portrait";

export { SCREEN_URI_BUDGET };

/** Bump when the resolver's output changes — old cache entries stop matching. */
const IMAGE_VERSION = 2;

export function commonsSearchUrl(q: string): string {
  return `https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(q)}&gsrnamespace=6&gsrlimit=1&prop=imageinfo&iiprop=url|extmetadata&iiurlwidth=480&format=json&origin=*`;
}

export function commonsFileInfoUrl(title: string): string {
  return `https://commons.wikimedia.org/w/api.php?action=query&titles=${encodeURIComponent(title)}&prop=imageinfo&iiprop=url|extmetadata&iiurlwidth=480&format=json&origin=*`;
}

/** Strip HTML tags and decode the handful of entities Commons' Artist field uses. */
function plainText(html: string): string {
  return html
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .trim();
}

interface CommonsImageInfo {
  thumburl?: string;
  extmetadata?: { LicenseShortName?: { value?: string }; Artist?: { value?: string } };
}

/** The first page's first imageinfo entry out of a Commons API response, or null. */
function firstImageInfo(json: unknown): CommonsImageInfo | null {
  const pages = (json as { query?: { pages?: Record<string, { imageinfo?: CommonsImageInfo[] }> } } | null)?.query?.pages;
  if (!pages) return null;
  for (const page of Object.values(pages)) {
    const info = page.imageinfo?.[0];
    if (info) return info;
  }
  return null;
}

/**
 * A photo's credit line and licence out of a Commons API response —
 * `null` when the licence is missing, which lint (a later step) uses to
 * reject the image outright: no licence, no reuse claim, no photo.
 */
export function creditFromInfo(json: unknown): { credit: string; licence: string } | null {
  const info = firstImageInfo(json);
  const licence = info?.extmetadata?.LicenseShortName?.value;
  if (!info || !licence) return null;
  const artist = info.extmetadata?.Artist?.value ? plainText(info.extmetadata.Artist.value) : "";
  return { credit: `${artist || "Wikimedia Commons"} · ${licence}`, licence };
}

export interface ImageDeps {
  fetch: typeof fetch;
  loadRaster: (url: string, maxDim: number) => Promise<Raster>;
  /** Raster → embeddable data URI. Its own seam (not folded into loadRaster)
   *  for the same reason source.ts injects `renderImage` whole: a node test
   *  can supply a fake raster without needing a real canvas to encode it on. */
  encode: (raster: Raster) => string;
  /** The `look: "screen"` encoding: colour untouched — lossless PNG by default, JPEG when asked (to fit SCREEN_URI_BUDGET). */
  encodeScreen: (raster: Raster, opts?: { type?: "png" | "jpeg"; quality?: number }) => string;
  /** Natural size without reading pixels — for a host that refuses them. */
  measure: (url: string) => Promise<{ width: number; height: number }>;
  /** The picture proxy's endpoints (netlify/functions/picture.mts), tried in order when a direct read is refused. */
  pictureEndpoints?: readonly string[];
}

/**
 * The picture proxy: same-origin first (a Netlify deploy, or `netlify dev`),
 * then drawcast.app itself (the GitHub Pages deploy, plain `vite`). Both are
 * GETs an `<img crossOrigin>` may make under the CSP's img-src.
 */
export const PICTURE_ENDPOINTS: readonly string[] = ["/.netlify/functions/picture", "https://drawcast.app/.netlify/functions/picture"];

function defaultDeps(): ImageDeps {
  return { fetch: globalThis.fetch, loadRaster, encode: styledPhotoDataUri, encodeScreen: faithfulDataUri, measure: measureNatural, pictureEndpoints: PICTURE_ENDPOINTS };
}

export interface ImageResolution {
  id: string;
  ok: boolean;
  error?: string;
}

/** Cache key for an image element, or null when it needs no resolution. `strokes`: the RESOLVED strokes
 *  (inlineStrokes) — a hoisted "@name" that holds a linked picture must still retry. */
function imageCacheKey(el: Pick<SpecElement, "type" | "of" | "url" | "look">, strokes: string | undefined): string | null {
  if (el.type !== "image" || (strokes && !isLinkedPhoto(strokes))) return null;
  if (el.url) return `i${IMAGE_VERSION}|url|${el.look ?? "photo"}|${el.url.trim()}`;
  if (!el.of) return null;
  return `i${IMAGE_VERSION}|${el.of.trim().toLowerCase()}`;
}

/**
 * A `look: "screen"` picture as a data URI within SCREEN_URI_BUDGET: PNG
 * first; over budget, JPEG q=0.9; still over, the raster's long side shrinks
 * by x0.8 (re-read at the smaller size, JPEG again) down to SCREEN_MIN_DIM.
 * `uri` is null when nothing fits — the caller keeps the picture linked.
 */
async function embedScreen(url: string, deps: ImageDeps): Promise<{ uri: string | null; aspect: number }> {
  let raster = await deps.loadRaster(url, SCREEN_DIM);
  const aspect = raster.height / raster.width;
  const png = deps.encodeScreen(raster);
  if (png.length <= SCREEN_URI_BUDGET) return { uri: png, aspect };
  let dim = Math.max(raster.width, raster.height);
  for (;;) {
    const jpeg = deps.encodeScreen(raster, { type: "jpeg", quality: 0.9 });
    if (jpeg.length <= SCREEN_URI_BUDGET) return { uri: jpeg, aspect };
    if (dim <= SCREEN_MIN_DIM) return { uri: null, aspect };
    dim = Math.max(SCREEN_MIN_DIM, Math.round(dim * 0.8));
    raster = await deps.loadRaster(url, dim);
  }
}

/** The Commons file title (`File:...`) implied by an image URL's last path segment. */
function fileTitleFromUrl(url: string): string {
  const last = url.split("/").pop() ?? "";
  return `File:${decodeURIComponent(last)}`;
}

/**
 * Resolve every `image` element of a spec IN PLACE: fill `strokes`, `credit`
 * and `source` from the cache, or by description → Commons search / a
 * Wikipedia-summary shortcut → licence check → trace, on a miss. An image
 * with no licence on Commons is rejected outright (no strokes, no credit) —
 * unlike a portrait's placeholder-on-failure, there is nothing safe to show
 * for a photo this app cannot attribute. Failures are reported, never thrown.
 */
export async function resolveImages(spec: Spec, deps: ImageDeps = defaultDeps()): Promise<ImageResolution[]> {
  const results: ImageResolution[] = [];
  for (const el of spec.elements ?? []) {
    if (el.type !== "image") continue;
    const have = inlineStrokes(spec, el);
    if (have && decodePhoto(have)) { // a linked picture (lnk1) is not resolved: decodePhoto refuses it
      results.push({ id: el.id, ok: true });
      continue;
    }
    const key = imageCacheKey(el, have);
    if (!key) {
      results.push({ id: el.id, ok: false, error: "image has no description or readable strokes" });
      continue;
    }
    try {
      let encoded = await cacheGet(key);
      if (!encoded && el.url) {
        const url = el.url.trim();
        // The pixels, read from `src` (the picture itself, or the proxy's copy of it); throws when they cannot be read.
        const embedFrom = async (src: string): Promise<{ strokes: string; linked: boolean }> => {
          if (el.look === "screen") {
            const { uri, aspect } = await embedScreen(src, deps);
            // Too big to embed even at SCREEN_MIN_DIM: shown by link, like a refusing host.
            return uri ? { strokes: encodePhoto(aspect, uri), linked: false } : { strokes: encodeLinkedPhoto(aspect, url), linked: true };
          }
          const raster = await deps.loadRaster(src, LOOK_DIM.photo);
          return { strokes: encodePhoto(raster.height / raster.width, deps.encode(raster)), linked: false };
        };
        let outcome: { strokes: string; linked: boolean } | null = null;
        try {
          outcome = await embedFrom(url);
        } catch {
          // The host refuses pixel reads (no CORS header): read them through the picture proxy instead.
          for (const endpoint of deps.pictureEndpoints ?? []) {
            try {
              outcome = await embedFrom(`${endpoint}?url=${encodeURIComponent(url)}`);
              break;
            } catch {
              // this endpoint is unreachable or refused the picture — try the next
            }
          }
        }
        if (!outcome) {
          // Nothing could read the pixels — still SHOWN, by link.
          const n = await deps.measure(url);
          outcome = { strokes: encodeLinkedPhoto(n.height / n.width, url), linked: true };
        }
        const { strokes, linked } = outcome;
        encoded = JSON.stringify({ strokes, source: url });
        // Only a successful pixel read is cached: a linked outcome may be transient, and a later embed must retry.
        if (!linked) await cachePut(key, encoded);
      }
      if (!encoded) {
        let thumburl: string | undefined;
        let credit: string | undefined;

        const summaryRes = await deps.fetch(wikiSummaryUrl(el.of!));
        if (summaryRes.ok) {
          const summary = (await summaryRes.json()) as { originalimage?: { source?: string }; thumbnail?: { source?: string } };
          const source = summary.originalimage?.source ?? summary.thumbnail?.source;
          if (source) {
            const infoRes = await deps.fetch(commonsFileInfoUrl(fileTitleFromUrl(source)));
            if (infoRes.ok) {
              const infoJson = await infoRes.json();
              const found = creditFromInfo(infoJson);
              if (found) {
                thumburl = firstImageInfo(infoJson)?.thumburl ?? source;
                credit = found.credit;
              }
            }
          }
        }

        if (!credit) {
          const searchRes = await deps.fetch(commonsSearchUrl(el.of!));
          if (!searchRes.ok) throw new Error(`Commons search failed (${searchRes.status}) for "${el.of}"`);
          const json = await searchRes.json();
          const found = creditFromInfo(json);
          if (!found) throw new Error(`no licence found on Commons for "${el.of}"`);
          thumburl = firstImageInfo(json)?.thumburl;
          credit = found.credit;
        }

        if (!thumburl) throw new Error(`no image found on Commons for "${el.of}"`);
        const raster = await deps.loadRaster(thumburl, LOOK_DIM.photo);
        const photo = encodePhoto(raster.height / raster.width, deps.encode(raster));
        encoded = JSON.stringify({ strokes: photo, credit, source: thumburl });
        await cachePut(key, encoded);
      }
      const parsed = JSON.parse(encoded) as { strokes: string; credit?: string; source: string };
      el.strokes = parsed.strokes;
      if (parsed.credit) el.credit = parsed.credit; // a url image keeps its authored credit
      el.source = parsed.source;
      results.push({ id: el.id, ok: true });
    } catch (err) {
      results.push({ id: el.id, ok: false, error: (err as Error).message });
    }
  }
  return results;
}
