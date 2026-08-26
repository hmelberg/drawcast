// Portrait resolution: turn a portrait element's reference (a person's name,
// or a user-provided image URL) into traced sketch strokes, cached in
// IndexedDB so each image is fetched and traced ONCE per browser. The spec
// stays small and readable — the NAME is the regenerable source of truth;
// embedded strokes (dropped files, pinned specs) skip resolution entirely.
// Runs in the ensure phase BEFORE layout (layout is synchronous), so
// playback never stalls mid-figure and exports resolve before recording.

import type { Spec, SpecElement } from "../spec/types";
import { decodeTrace, encodeTrace } from "../spec/trace";
import { traceImage } from "./tracer";

/** Bump when the tracer's output changes — old cache entries stop matching. */
export const TRACE_VERSION = 3; // v3: poster (region) look is the default

/** The Wikipedia summary endpoint for a person (CORS-open, returns the infobox thumbnail). */
export function wikiSummaryUrl(name: string): string {
  return `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(name.trim().replace(/\s+/g, "_"))}`;
}

/** Cache key for a portrait element, or null when it needs no resolution. */
export function portraitCacheKey(el: Pick<SpecElement, "type" | "of" | "url" | "strokes" | "look">): string | null {
  if (el.type !== "portrait" || el.strokes) return null;
  const look = el.look === "line" ? "line" : "poster";
  if (el.url) return `p${TRACE_VERSION}|${look}|url|${el.url}`;
  if (el.of) return `p${TRACE_VERSION}|${look}|name|${el.of.trim().toLowerCase()}`;
  return null;
}

/** The portrait thumbnail URL out of a Wikipedia summary response, or null. */
export function thumbFromSummary(summary: unknown): string | null {
  const s = summary as { thumbnail?: { source?: string }; originalimage?: { source?: string } } | null;
  return s?.thumbnail?.source ?? s?.originalimage?.source ?? null;
}

// ---- IndexedDB cache (in-memory fallback for tests/headless) --------------

const memCache = new Map<string, string>();
const DB_NAME = "drawcast-portraits";
const STORE = "traces";

function openDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  return new Promise((resolve) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });
}

export async function cacheGet(key: string): Promise<string | null> {
  const hit = memCache.get(key);
  if (hit) return hit;
  const db = await openDb();
  if (!db) return null;
  return new Promise((resolve) => {
    const req = db.transaction(STORE, "readonly").objectStore(STORE).get(key);
    req.onsuccess = () => resolve(typeof req.result === "string" ? req.result : null);
    req.onerror = () => resolve(null);
  });
}

export async function cachePut(key: string, encoded: string): Promise<void> {
  memCache.set(key, encoded);
  const db = await openDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(encoded, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}

// ---- image → trace --------------------------------------------------------

/** Longest image side used for tracing — detail beyond this is noise at portrait size. */
const TRACE_DIM = 150;

/** Load a CORS-readable image into pixel data (browser only). */
async function loadRaster(url: string): Promise<{ width: number; height: number; data: Uint8ClampedArray }> {
  const img = new Image();
  img.crossOrigin = "anonymous";
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error(`image failed to load (host may not allow cross-origin reads): ${url}`));
    img.src = url;
  });
  const scale = Math.min(1, TRACE_DIM / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(8, Math.round(img.naturalWidth * scale));
  const h = Math.max(8, Math.round(img.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas 2D unavailable");
  ctx.drawImage(img, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h); // throws on tainted canvas = clear CORS signal
}

/** Fetch + trace + encode one portrait image URL. */
export async function traceFromUrl(url: string, look: "poster" | "line" = "poster"): Promise<string> {
  const raster = await loadRaster(url);
  return encodeTrace(traceImage(raster, { style: look }));
}

/** Trace a local image file (editor file-drop) — no CORS involved. */
export async function traceFromBlob(blob: Blob): Promise<string> {
  const url = URL.createObjectURL(blob);
  try {
    return await traceFromUrl(url);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export interface PortraitResolution {
  id: string;
  ok: boolean;
  error?: string;
}

/**
 * Resolve every portrait element of a spec IN PLACE: fill `strokes` (and
 * `source`) from the cache, or by name→Wikipedia→trace / url→trace on a
 * miss. Failures leave the element without strokes — the layout draws its
 * placeholder — and are reported, never thrown.
 */
export async function resolvePortraits(spec: Spec): Promise<PortraitResolution[]> {
  const results: PortraitResolution[] = [];
  for (const el of spec.elements ?? []) {
    if (el.type !== "portrait") continue;
    if (el.strokes && decodeTrace(el.strokes)) {
      results.push({ id: el.id, ok: true });
      continue;
    }
    const key = portraitCacheKey(el);
    if (!key) {
      results.push({ id: el.id, ok: false, error: "portrait has no name, url, or readable strokes" });
      continue;
    }
    try {
      let encoded = await cacheGet(key);
      if (!encoded) {
        let imageUrl = el.url ?? null;
        if (!imageUrl && el.of) {
          const res = await fetch(wikiSummaryUrl(el.of));
          if (!res.ok) throw new Error(`Wikipedia lookup failed (${res.status}) for "${el.of}"`);
          imageUrl = thumbFromSummary(await res.json());
          if (!imageUrl) throw new Error(`no portrait found on Wikipedia for "${el.of}"`);
        }
        if (!imageUrl) throw new Error("no image source");
        encoded = await traceFromUrl(imageUrl, el.look === "line" ? "line" : "poster");
        el.source = el.source ?? imageUrl;
        await cachePut(key, encoded);
      }
      el.strokes = encoded;
      results.push({ id: el.id, ok: true });
    } catch (err) {
      results.push({ id: el.id, ok: false, error: (err as Error).message });
    }
  }
  return results;
}
