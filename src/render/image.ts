// The `image` element: an illustrative Commons photo resolved from a plain
// description ("of"), the way portraits resolve from a name — but where a
// portrait draws a traced sketch, an image embeds the faithful photo and
// carries a licence-gated credit line, because a Commons photo (unlike a
// Wikipedia infobox portrait) makes no promise about reuse rights.
//
// Modeled on render/portrait.ts's resolvePortraits: same cache, same
// fetch→trace shape, same never-throw contract. `type: "image"` and the
// `credit` field are not in spec/types.ts yet (freehand-figures Task 7 is
// split across two dispatches) — both are read/written through a narrow
// local type here so `tsc --noEmit` stays clean without touching the schema.

import type { Spec, SpecElement } from "../spec/types";
import { decodePhoto, encodePhoto } from "../spec/trace";
import { cacheGet, cachePut, LOOK_DIM, loadRaster, styledPhotoDataUri, wikiSummaryUrl, type Raster } from "./portrait";

/** An element carrying the not-yet-schema'd `image` fields. */
type ImageEl = SpecElement & { credit?: string };

/** Bump when the resolver's output changes — old cache entries stop matching. */
const IMAGE_VERSION = 1;

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
}

function defaultDeps(): ImageDeps {
  return { fetch: globalThis.fetch, loadRaster };
}

export interface ImageResolution {
  id: string;
  ok: boolean;
  error?: string;
}

/** Cache key for an image element, or null when it needs no resolution. */
function imageCacheKey(el: Pick<ImageEl, "type" | "of" | "strokes">): string | null {
  if ((el.type as string) !== "image" || el.strokes) return null;
  if (!el.of) return null;
  return `i${IMAGE_VERSION}|${el.of.trim().toLowerCase()}`;
}

/** The Commons file title (`File:...`) implied by an image URL's last path segment. */
function fileTitleFromUrl(url: string): string {
  const last = url.split("/").pop() ?? "";
  return `File:${decodeURIComponent(last)}`;
}

/**
 * The embeddable data URI for a loaded raster. Every real caller runs in a
 * browser (`document` always exists there), where this is the same styled
 * canvas encode portraits use — sharing the look on purpose. The `document`
 * guard exists only for this module's own node tests, which inject a fake
 * `loadRaster` that returns raw pixel data with no canvas to encode it on
 * (the same guard shape already used for other DOM globals in
 * svg-backend.ts, figure-style.ts and render/index.ts).
 */
function photoDataUri(raster: Raster): string {
  if (typeof document === "undefined") return "data:image/jpeg;base64,";
  return styledPhotoDataUri(raster);
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
  for (const raw of spec.elements ?? []) {
    const el = raw as ImageEl;
    if ((el.type as string) !== "image") continue;
    if (el.strokes && decodePhoto(el.strokes)) {
      results.push({ id: el.id, ok: true });
      continue;
    }
    const key = imageCacheKey(el);
    if (!key) {
      results.push({ id: el.id, ok: false, error: "image has no description or readable strokes" });
      continue;
    }
    try {
      let encoded = await cacheGet(key);
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
        const photo = encodePhoto(raster.height / raster.width, photoDataUri(raster));
        encoded = JSON.stringify({ strokes: photo, credit, source: thumburl });
        await cachePut(key, encoded);
      }
      const parsed = JSON.parse(encoded) as { strokes: string; credit: string; source: string };
      el.strokes = parsed.strokes;
      el.credit = parsed.credit;
      el.source = el.source ?? parsed.source;
      results.push({ id: el.id, ok: true });
    } catch (err) {
      results.push({ id: el.id, ok: false, error: (err as Error).message });
    }
  }
  return results;
}
