// Source resolution: turn a source element's REFERENCE (a title, a DOI, an
// ISBN, an Internet Archive scan id, or a URL) into a framed, paper-tinted
// page image — and, when a `quote` is given, the rectangles that highlight it
// — cached in IndexedDB so each work is fetched and rendered ONCE per browser.
//
// Same contract as portraits (src/render/portrait.ts), deliberately: the spec
// carries only the reference (the regenerable source of truth, small enough
// to read, diff and round-trip through the model), resolution runs in the
// ensure phase BEFORE layout, and every failure degrades to the element's
// placeholder frame — never a throw, never a stalled playback.
//
// Two cache entries per element, not one: the REFERENCE lookup (which URL is
// this work's PDF/cover/landing page — small, page-independent) and the IMAGE
// (which is large, and specific to page + quote). Changing the page therefore
// never re-asks OpenAlex, and a cache hit still knows the click-through URL.

import type { Spec, SpecElement } from "../spec/types";
import { decodeSourceImage, encodeSourceImage, type PhotoRect } from "../spec/trace";
import { cacheGet, cachePut, loadRaster, LOOK_DIM, styledPhotoDataUri } from "./portrait";

/**
 * Bump whenever the tint, the dimensions, or the cached envelope changes —
 * stale entries must MISS, not corrupt. Independent of TRACE_VERSION: the two
 * pipelines version on their own schedules.
 */
export const SOURCE_VERSION = 1;

/** Longest side of a rendered source image. Pages carry text; 240 px is mush. */
const SOURCE_DIM = LOOK_DIM.page;

// ---- the reference -------------------------------------------------------

export type SourceRefKind = "url" | "archive" | "doi" | "isbn" | "of";

export interface SourceRef {
  kind: SourceRefKind;
  value: string;
}

/**
 * The ONE reference a source element resolves through. Explicit beats derived:
 * a url the user pasted > an archive scan > a DOI > an ISBN > a title. (A
 * title is the safest to author — Wikipedia verifies it, so a wrong one fails
 * visibly — but the most specific reference present wins.)
 */
export function sourceRef(el: Pick<SpecElement, "url" | "archive" | "doi" | "isbn" | "of">): SourceRef | null {
  const pick = (kind: SourceRefKind, raw: unknown): SourceRef | null =>
    typeof raw === "string" && raw.trim() !== "" ? { kind, value: raw.trim() } : null;
  return (
    pick("url", el.url) ?? pick("archive", el.archive) ?? pick("doi", el.doi) ?? pick("isbn", el.isbn) ?? pick("of", el.of)
  );
}

/** FNV-1a — a short stable tag for the quote inside a cache key. */
function hash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/** Cache key for a source element's IMAGE, or null when it needs no resolution. */
export function sourceCacheKey(el: Pick<SpecElement, "type" | "url" | "archive" | "doi" | "isbn" | "of" | "page" | "quote" | "strokes">): string | null {
  if (el.type !== "source" || el.strokes) return null;
  const ref = sourceRef(el);
  if (!ref) return null;
  const page = typeof el.page === "number" ? Math.floor(el.page) : 0;
  const quote = typeof el.quote === "string" && el.quote.trim() !== "" ? hash(normalizeText(el.quote)) : "";
  return `s${SOURCE_VERSION}|${ref.kind}|${ref.value.toLowerCase()}|p${page}|q${quote}`;
}

/** Cache key for the reference→URLs lookup (page- and quote-independent). */
function refCacheKey(ref: SourceRef): string {
  return `s${SOURCE_VERSION}|ref|${ref.kind}|${ref.value.toLowerCase()}`;
}

// ---- endpoints -----------------------------------------------------------
// All live-probed 2026-08-28 with an `Origin:` header. Wikipedia, OpenAlex,
// Open Library covers and arxiv.org PDFs answer `access-control-allow-origin:
// *`; the archive.org IIIF endpoint 302s to the real image, reflecting the
// origin on the redirect and answering `*` on the image itself — both fine for
// `crossOrigin="anonymous"`, which checks the FINAL response.

/** A DOI with any of the usual wrappers stripped: "10.xxxx/yyy". */
export function normalizeDoi(raw: string): string {
  return raw
    .trim()
    .replace(/^https?:\/\/(dx\.)?doi\.org\//i, "")
    .replace(/^doi:\s*/i, "");
}

/**
 * A DOI in a URL path. The slash between prefix and suffix must stay a real
 * slash — measured: `.../works/doi:10.1038%2Fnature14539` is a 404 page, while
 * `.../works/doi:10.1038/nature14539` is the work.
 */
function doiPath(doi: string): string {
  return encodeURIComponent(normalizeDoi(doi)).replace(/%2F/gi, "/");
}

export function openAlexUrl(doi: string): string {
  return `https://api.openalex.org/works/doi:${doiPath(doi)}`;
}

export function unpaywallUrl(doi: string, email: string): string {
  return `https://api.unpaywall.org/v2/${doiPath(doi)}?email=${encodeURIComponent(email)}`;
}

/** Open Library's cover service. No key; missing covers answer with 1×1 pixels. */
export function openLibraryCoverUrl(isbn: string): string {
  return `https://covers.openlibrary.org/b/isbn/${encodeURIComponent(isbn.replace(/[^0-9Xx]/g, ""))}-L.jpg`;
}

/**
 * One page of a public-domain Internet Archive scan, at any width.
 * `$n` is the scan's LEAF index, not the printed page number — they differ by
 * however much front matter the book has. The element exposes it honestly as
 * a leaf index; the model/user supplies it.
 */
export function archiveImageUrl(id: string, leaf = 0, width = SOURCE_DIM): string {
  return `https://iiif.archive.org/iiif/${encodeURIComponent(id)}$${Math.max(0, Math.floor(leaf))}/full/${Math.round(width)},/0/default.jpg`;
}

export function archiveDetailsUrl(id: string): string {
  return `https://archive.org/details/${encodeURIComponent(id)}`;
}

export function wikiSummaryUrlFor(title: string): string {
  return `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.trim().replace(/\s+/g, "_"))}`;
}

/** arXiv serves HTML at /abs/ and the PDF only at /pdf/ — normalize before fetching. */
export function normalizePdfUrl(url: string): string {
  return url.replace(/^(https?:\/\/(?:www\.)?arxiv\.org)\/abs\//i, "$1/pdf/");
}

export function isPdfUrl(url: string): boolean {
  try {
    const u = new URL(normalizePdfUrl(url));
    return /\.pdf$/i.test(u.pathname) || (u.hostname.toLowerCase().endsWith("arxiv.org") && u.pathname.startsWith("/pdf/"));
  } catch {
    return false;
  }
}

/**
 * The open-access PDF, the landing page, and the title out of an OpenAlex work.
 *
 * `best_oa_location.pdf_url` alone is not enough — measured on both
 * nature14539 and "Attention Is All You Need": best_oa_location names a
 * repository whose pdf_url is null while the full `locations` array carries a
 * perfectly good arXiv PDF. So every location is scanned, and arxiv.org wins
 * when it appears: it is the canonical preprint host, verified to serve
 * application/pdf with `access-control-allow-origin: *`, whereas the
 * highest-ranked mirror is sometimes an obscure host that pdf.js cannot read.
 */
export function readOpenAlex(json: unknown): { pdf: string | null; landing: string | null; title: string | null } {
  type Loc = { pdf_url?: string | null; landing_page_url?: string | null } | null | undefined;
  const w = json as { best_oa_location?: Loc; primary_location?: Loc; locations?: Loc[]; title?: string | null; display_name?: string | null } | null;
  const locs: Loc[] = [w?.best_oa_location, w?.primary_location, ...(Array.isArray(w?.locations) ? w.locations : [])];
  const url = (u: unknown): u is string => typeof u === "string" && u !== "";
  const pdfs = locs.map((l) => l?.pdf_url).filter(url);
  const pdf = pdfs.find((u) => /(^|\/\/)([a-z0-9-]+\.)*arxiv\.org\//i.test(u)) ?? pdfs[0] ?? null;
  const landing = locs.map((l) => l?.landing_page_url).find(url) ?? null;
  const title = w?.title ?? w?.display_name ?? null;
  return { pdf, landing, title: typeof title === "string" && title.trim() !== "" ? title.trim() : null };
}

/** The same, from Unpaywall's differently named fields. */
export function readUnpaywall(json: unknown): { pdf: string | null; landing: string | null; title: string | null } {
  const w = json as { best_oa_location?: { url_for_pdf?: string | null; url?: string | null } | null; title?: string | null } | null;
  const loc = w?.best_oa_location;
  return {
    pdf: typeof loc?.url_for_pdf === "string" && loc.url_for_pdf !== "" ? loc.url_for_pdf : null,
    landing: typeof loc?.url === "string" && loc.url !== "" ? loc.url : null,
    title: typeof w?.title === "string" && w.title.trim() !== "" ? w.title.trim() : null,
  };
}

/** The thumbnail out of a Wikipedia summary (same shape the portrait path reads). */
function thumbOf(summary: unknown): { image: string | null; landing: string | null; title: string | null } {
  const s = summary as
    | { thumbnail?: { source?: string }; originalimage?: { source?: string }; content_urls?: { desktop?: { page?: string } }; title?: string }
    | null;
  return {
    image: s?.originalimage?.source ?? s?.thumbnail?.source ?? null,
    landing: s?.content_urls?.desktop?.page ?? null,
    title: typeof s?.title === "string" ? s.title : null,
  };
}

// ---- quote matching ------------------------------------------------------

/**
 * The comparison form of a piece of page text: lowercased, curly punctuation
 * flattened to ASCII, soft hyphens dropped, line-break hyphenation joined
 * ("govern-\nment" → "government"), and every whitespace run collapsed to one
 * space. Both the quote and the page go through it, so a passage that wraps
 * across two lines still matches the sentence the user typed.
 */
export function normalizeText(raw: string): string {
  return normalizeWithOwners([{ text: raw, owner: 0 }]).text;
}

interface OwnedChunk {
  text: string;
  owner: number;
}

/** normalizeText, keeping a per-character map back to the chunk it came from. */
function normalizeWithOwners(chunks: readonly OwnedChunk[]): { text: string; owners: number[] } {
  const src: { ch: string; owner: number }[] = [];
  chunks.forEach((c, i) => {
    for (const ch of c.text) src.push({ ch, owner: c.owner });
    // PDF text items are fragments, often without a trailing space; a
    // synthetic separator between them keeps two words from fusing.
    if (i + 1 < chunks.length) src.push({ ch: " ", owner: c.owner });
  });

  const FLAT: Record<string, string> = { "‘": "'", "’": "'", "“": '"', "”": '"', "–": "-", "—": "-", "−": "-", " ": " " };
  let text = "";
  const owners: number[] = [];
  const push = (ch: string, owner: number): void => {
    text += ch;
    owners.push(owner);
  };
  for (let i = 0; i < src.length; i++) {
    const raw = src[i].ch;
    if (raw === "­") continue; // soft hyphen: never part of the word
    const ch = (FLAT[raw] ?? raw).toLowerCase();
    if (/\s/.test(ch)) {
      if (text !== "" && !text.endsWith(" ")) push(" ", src[i].owner);
      continue;
    }
    if (ch === "-") {
      // Hyphen followed by whitespace = a line break inside a word: drop both.
      let j = i + 1;
      while (j < src.length && /\s/.test(src[j].ch)) j++;
      if (j > i + 1 && j < src.length) {
        i = j - 1;
        continue;
      }
    }
    push(ch, src[i].owner);
  }
  // No leading space is ever pushed, so trimming can only drop the tail —
  // which keeps `owners` aligned with `text` index for index.
  const trimmed = text.trimEnd();
  return { text: trimmed, owners: owners.slice(0, trimmed.length) };
}

export interface TextItemLike {
  str: string;
  /** PDF text-space matrix; [4] and [5] are x and y (bottom-left origin). */
  transform: number[];
  width?: number;
  height?: number;
}

/**
 * The item indices covering `quote` on this page, or null when the passage is
 * not there. Matching is substring-on-normalized-text: a quote that starts or
 * ends mid-item highlights that whole item, which is what a human sweeping a
 * marker does anyway.
 */
export function findQuoteItems(items: readonly TextItemLike[], quote: string): { from: number; to: number } | null {
  const needle = normalizeText(quote);
  if (needle === "") return null;
  const page = normalizeWithOwners(items.map((it, i) => ({ text: it.str, owner: i })));
  const at = page.text.indexOf(needle);
  if (at < 0) return null;
  const owners = page.owners.slice(at, at + needle.length).filter((o) => o !== undefined);
  if (owners.length === 0) return null;
  return { from: Math.min(...owners), to: Math.max(...owners) };
}

/** A rectangle in the rendered page's own pixels (y-down, like a canvas). */
export interface ViewportRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * One highlight rect per LINE of the match, in image-normalized units (x/w as
 * fractions of the width, y/h in [0, aspect], y-UP) — the form the codec and
 * the layout both speak. Items are grouped by their vertical band, so a quote
 * spanning three lines sweeps as three marker strokes, not one fat box.
 */
export function quoteRects(rects: readonly ViewportRect[], pageW: number, pageH: number): PhotoRect[] {
  if (rects.length === 0 || pageW <= 0 || pageH <= 0) return [];
  const sorted = [...rects].sort((a, b) => a.y - b.y || a.x - b.x);
  const lines: ViewportRect[] = [];
  for (const r of sorted) {
    const last = lines[lines.length - 1];
    // Same line when the vertical centers sit within half a line height.
    if (last && Math.abs(r.y + r.h / 2 - (last.y + last.h / 2)) <= Math.max(r.h, last.h) * 0.6) {
      const x0 = Math.min(last.x, r.x);
      const y0 = Math.min(last.y, r.y);
      lines[lines.length - 1] = {
        x: x0,
        y: y0,
        w: Math.max(last.x + last.w, r.x + r.w) - x0,
        h: Math.max(last.y + last.h, r.y + r.h) - y0,
      };
    } else {
      lines.push({ ...r });
    }
  }
  // A marker is wider than the letters it covers.
  const padX = 2;
  return lines.map((l): PhotoRect => {
    const padY = l.h * 0.18;
    const x = Math.max(0, l.x - padX);
    const yTop = Math.max(0, l.y - padY);
    const yBot = Math.min(pageH, l.y + l.h + padY);
    const w = Math.min(pageW, l.x + l.w + padX) - x;
    return [x / pageW, (pageH - yBot) / pageW, w / pageW, (yBot - yTop) / pageW];
  });
}

// ---- the pdf.js seam -----------------------------------------------------

export interface PdfViewportLike {
  width: number;
  height: number;
  /**
   * PDF user space (y-up, bottom-left) → viewport pixels (y-down). Never
   * hand-flip Y: the viewport also carries the page's rotation and offset.
   *
   * Point, not rectangle: pdf.js dropped `convertToViewportRectangle`, and a
   * missing method here is a runtime TypeError, not a type error, because the
   * loader is dynamic. Verified against pdfjs-dist 6.2.108.
   */
  convertToViewportPoint(x: number, y: number): number[];
}

export interface PdfPageLike {
  getViewport(opts: { scale: number }): PdfViewportLike;
  render(opts: { canvas: unknown; viewport: PdfViewportLike; background?: string }): { promise: Promise<void> };
  getTextContent(): Promise<{ items: TextItemLike[] }>;
}

export interface PdfDocLike {
  numPages: number;
  getPage(n: number): Promise<PdfPageLike>;
}

export type PdfLoader = (url: string) => Promise<PdfDocLike>;

let pdfjs: { getDocument(src: unknown): { promise: Promise<PdfDocLike> } } | null = null;

/**
 * pdf.js, loaded lazily as its own chunk on FIRST USE — the way the scene
 * engines are (src/scenes/engines.ts). The worker comes in through Vite's
 * `?url` import and must be assigned to GlobalWorkerOptions before any
 * getDocument call; without it pdf.js fails almost silently.
 */
export const loadPdfDocument: PdfLoader = async (url) => {
  if (!pdfjs) {
    const mod = (await import("pdfjs-dist")) as unknown as {
      getDocument(src: unknown): { promise: Promise<PdfDocLike> };
      GlobalWorkerOptions: { workerSrc: string };
    };
    mod.GlobalWorkerOptions.workerSrc = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
    pdfjs = mod;
  }
  return pdfjs.getDocument(normalizePdfUrl(url)).promise;
};

// ---- rendering one image -------------------------------------------------

export interface RenderedSource {
  /** `img2:` encoding — the styled page plus any highlight rects. */
  encoded: string;
  /** Set when a quote was asked for and NOT found: the page still resolves. */
  quoteMissed?: boolean;
}

/** Turn a plain image URL (cover, title page, IIIF leaf) into the encoding. */
export type ImageRenderer = (url: string) => Promise<RenderedSource>;

/** Turn one page of a PDF into the encoding, with the quote's rects. */
export type PageRenderer = (url: string, page: number, quote?: string) => Promise<RenderedSource>;

const renderImage: ImageRenderer = async (url) => {
  const raster = await loadRaster(url, SOURCE_DIM);
  // Open Library answers "no cover for this ISBN" with a 1×1 pixel rather
  // than a 404 — the only signal is the image's own natural size.
  if (raster.naturalWidth <= 2 && raster.naturalHeight <= 2) throw new Error(`no cover image available: ${url}`);
  return { encoded: encodeSourceImage(raster.height / raster.width, styledPhotoDataUri(raster)) };
};

const renderPage: PageRenderer = async (url, page, quote) => {
  const doc = await loadPdfDocument(url);
  const n = Math.min(Math.max(1, Math.floor(page || 1)), Math.max(1, doc.numPages));
  const pdfPage = await doc.getPage(n);
  const base = pdfPage.getViewport({ scale: 1 });
  const scale = SOURCE_DIM / Math.max(base.width, base.height);
  const viewport = pdfPage.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(8, Math.round(viewport.width));
  canvas.height = Math.max(8, Math.round(viewport.height));
  // `background` is how pdf.js paints the paper: a PDF draws no ground of its
  // own, and the tint pass would read every untouched pixel as transparent
  // black. `canvas` (not `canvasContext`) is the current pdf.js parameter.
  await pdfPage.render({ canvas, viewport, background: "#ffffff" }).promise;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas 2D unavailable");
  const px = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const aspect = canvas.height / canvas.width;
  const href = styledPhotoDataUri({ width: px.width, height: px.height, data: px.data });

  if (!quote || quote.trim() === "") return { encoded: encodeSourceImage(aspect, href) };
  const found = await pageQuoteRects(pdfPage, viewport, quote, canvas.width, canvas.height);
  if (!found) return { encoded: encodeSourceImage(aspect, href), quoteMissed: true };
  return { encoded: encodeSourceImage(aspect, href, found) };
};

/**
 * The quote's highlight rects for one already-rendered page, or null when the
 * passage is not on it. The whole text-layer path with no canvas in it, so it
 * is testable against synthetic textContent.
 *
 * PDF user space is bottom-left origin; the flip goes through the viewport's
 * own `convertToViewportPoint`, never by hand.
 */
export async function pageQuoteRects(
  page: PdfPageLike,
  viewport: PdfViewportLike,
  quote: string,
  canvasW: number,
  canvasH: number,
): Promise<PhotoRect[] | null> {
  const { items } = await page.getTextContent();
  const range = findQuoteItems(items, quote);
  if (!range) return null;
  const boxes: ViewportRect[] = [];
  for (let i = range.from; i <= range.to; i++) {
    const it = items[i];
    if (!it || it.str.trim() === "") continue;
    const x = it.transform[4];
    const y = it.transform[5];
    const w = it.width ?? 0;
    const h = it.height ?? (Math.abs(it.transform[3]) || 10);
    const [ax, ay] = viewport.convertToViewportPoint(x, y);
    const [bx, by] = viewport.convertToViewportPoint(x + w, y + h);
    boxes.push({ x: Math.min(ax, bx), y: Math.min(ay, by), w: Math.abs(bx - ax), h: Math.abs(by - ay) });
  }
  return quoteRects(boxes, canvasW, canvasH);
}

// ---- resolution ----------------------------------------------------------

/** What a reference resolves to: an image, a PDF, or neither — plus a link. */
interface RefTargets {
  image?: string;
  pdf?: string;
  /** The click-through URL auto-appended to the element's `link` array. */
  link?: string;
  /** A title discovered on the way, used as the caption when none was given. */
  title?: string;
}

export interface SourceDeps {
  fetch?: (url: string) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;
  renderImage?: ImageRenderer;
  renderPage?: PageRenderer;
  /** Contact address Unpaywall asks callers for. No email → OpenAlex only. */
  contactEmail?: string;
}

export interface SourceResolution {
  id: string;
  ok: boolean;
  error?: string;
  /** Resolved, but not entirely: an unfound quote, an unusable page. */
  warning?: string;
}

async function targetsFor(ref: SourceRef, el: SpecElement, deps: SourceDeps): Promise<RefTargets> {
  const get = deps.fetch ?? ((u: string) => fetch(u));
  const json = async (url: string, what: string): Promise<unknown> => {
    const res = await get(url);
    if (!res.ok) throw new Error(`${what} lookup failed (${res.status})`);
    return res.json();
  };

  switch (ref.kind) {
    case "url":
      return isPdfUrl(ref.value)
        ? { pdf: normalizePdfUrl(ref.value), link: normalizePdfUrl(ref.value) }
        : { image: ref.value, link: ref.value };

    case "archive":
      return {
        image: archiveImageUrl(ref.value, el.page ?? 0),
        link: archiveDetailsUrl(ref.value),
      };

    case "doi": {
      const doi = normalizeDoi(ref.value);
      let found = { pdf: null as string | null, landing: null as string | null, title: null as string | null };
      try {
        found = readOpenAlex(await json(openAlexUrl(doi), "OpenAlex"));
      } catch {
        /* fall through to Unpaywall */
      }
      if (!found.pdf && deps.contactEmail) {
        try {
          const alt = readUnpaywall(await json(unpaywallUrl(doi, deps.contactEmail), "Unpaywall"));
          found = { pdf: alt.pdf, landing: alt.landing ?? found.landing, title: found.title ?? alt.title };
        } catch {
          /* neither knows an open-access copy */
        }
      }
      // No open-access PDF (paywalled, or nobody indexes one) leaves a link
      // and no picture — resolveSources then falls back to the title.
      // The link carries the NORMALIZED pdf url: the click-through layer
      // sniffs /pdf/ to open the framed viewer, and /abs/ is an HTML page.
      const pdf = found.pdf ? normalizePdfUrl(found.pdf) : undefined;
      const link = pdf ?? found.landing ?? `https://doi.org/${doi}`;
      return { pdf, link, title: found.title ?? undefined };
    }

    case "isbn": {
      const cover = openLibraryCoverUrl(ref.value);
      const link = `https://openlibrary.org/isbn/${encodeURIComponent(ref.value.replace(/[^0-9Xx]/g, ""))}`;
      return { image: cover, link };
    }

    default: {
      const summary = thumbOf(await json(wikiSummaryUrlFor(ref.value), "Wikipedia"));
      if (!summary.image) throw new Error(`no cover or title-page image on Wikipedia for "${ref.value}"`);
      return {
        image: summary.image,
        link: summary.landing ?? `https://en.wikipedia.org/wiki/${encodeURIComponent(ref.value.trim().replace(/\s+/g, "_"))}`,
        title: summary.title ?? undefined,
      };
    }
  }
}

/** Append the resolved URL to the element's links (canonical array form, max 4). */
function appendLink(el: SpecElement, url: string | undefined): void {
  if (!url) return;
  const links = typeof el.link === "string" ? [el.link] : Array.isArray(el.link) ? [...el.link] : [];
  if (links.includes(url)) {
    el.link = links;
    return;
  }
  if (links.length >= 4) {
    el.link = links;
    return;
  }
  el.link = [...links, url];
}

/**
 * Resolve every source element of a spec IN PLACE: fill `strokes` (the styled
 * page plus its highlight rects), `source` (provenance), `of` (the caption,
 * when a lookup discovered the title) and `link` (the click-through). Failures
 * leave the element without strokes — the layout draws its placeholder — and
 * are reported, never thrown.
 */
export async function resolveSources(spec: Spec, deps: SourceDeps = {}): Promise<SourceResolution[]> {
  const results: SourceResolution[] = [];
  for (const el of spec.elements ?? []) {
    if (el.type !== "source") continue;
    if (el.strokes && decodeSourceImage(el.strokes)) {
      results.push({ id: el.id, ok: true });
      continue;
    }
    const ref = sourceRef(el);
    if (!ref) {
      results.push({ id: el.id, ok: false, error: "source has no title, doi, isbn, archive id, or url" });
      continue;
    }
    let warning: string | undefined;
    // Before any mutation: a discovered title lands in `of`, which is itself
    // a reference — the key must describe what was ASKED for.
    const key = sourceCacheKey(el);

    // The reference lookup is cached apart from the image: turning to another
    // page of the same paper must not re-ask OpenAlex, and an image cache hit
    // still needs to know where the click-through goes.
    const lookup = async (r: SourceRef): Promise<RefTargets> => {
      const rKey = refCacheKey(r);
      const hit = await cacheGet(rKey);
      if (hit) {
        const cached = JSON.parse(hit) as RefTargets;
        // The IIIF leaf lives in the URL, so a page change re-derives it.
        if (r.kind === "archive") cached.image = archiveImageUrl(r.value, el.page ?? 0);
        return cached;
      }
      const fresh = await targetsFor(r, el, deps);
      await cachePut(rKey, JSON.stringify(fresh));
      return fresh;
    };

    const draw = async (t: RefTargets): Promise<{ encoded: string; from: string }> => {
      if (t.pdf) {
        const out = await (deps.renderPage ?? renderPage)(t.pdf, el.page ?? 1, el.quote);
        if (out.quoteMissed) warning = `quote not found on page ${el.page ?? 1} — the page is shown without a highlight`;
        return { encoded: out.encoded, from: t.pdf };
      }
      if (t.image) {
        if (el.quote) warning = "quote highlighting needs a PDF page; this source resolves to a picture";
        return { encoded: (await (deps.renderImage ?? renderImage)(t.image)).encoded, from: t.image };
      }
      throw new Error("no open-access image or PDF for this source");
    };

    try {
      const targets = await lookup(ref);
      appendLink(el, targets.link);
      if (!el.of && targets.title) el.of = targets.title;

      const encoded = key ? await cacheGet(key) : null;
      if (encoded) {
        el.strokes = encoded;
        el.source = el.source ?? targets.pdf ?? targets.image;
        results.push({ id: el.id, ok: true });
        continue;
      }
      let drawn: { encoded: string; from: string };
      try {
        drawn = await draw(targets);
      } catch (err) {
        // The two silent no-pictures: Open Library answers "no cover for this
        // ISBN" with a 1×1 pixel, and a paywalled DOI has no open copy at all.
        // Fall back to the TITLE, the one reference Wikipedia verifies.
        if (ref.kind === "of" || !el.of) throw err;
        drawn = await draw(await lookup({ kind: "of", value: el.of }));
        warning = `${(err as Error).message} — showing what Wikipedia has for "${el.of}" instead`;
      }
      if (key) await cachePut(key, drawn.encoded);
      el.source = el.source ?? drawn.from;
      el.strokes = drawn.encoded;
      results.push({ id: el.id, ok: true, warning });
    } catch (err) {
      results.push({ id: el.id, ok: false, error: (err as Error).message });
    }
  }
  return results;
}
