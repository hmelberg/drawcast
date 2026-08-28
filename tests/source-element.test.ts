// The SOURCE element: papers and books as first-class figures. Schema, the
// img2 codec, tier-2 rendering (framed page, caption, highlighter sweeps,
// placeholder), the resolution chain with every network call mocked, the
// quote matcher, hoisting, and the lint rules.
//
// Nothing here touches the network or a canvas: the resolver's two rendering
// seams (renderImage / renderPage) are injected the way the chess tests inject
// the Chess ctor, so a PDF is never downloaded to run the suite. The last
// block is the exception that proves the seams honest — it runs the REAL
// pdf.js against a 587-byte PDF written inline, pinning the viewport API the
// text-layer path calls through.

import { describe, expect, test } from "vitest";
import { validateSpec } from "../src/spec/schema";
import { layoutSpec } from "../src/layout/layout";
import { flattenDrawables } from "../src/layout/model";
import { lintCommands } from "../src/lint/lint";
import { decodeSourceImage, encodePhoto, encodeSourceImage } from "../src/spec/trace";
import { cardTargets } from "../src/ui/card-model";
import {
  SOURCE_VERSION,
  archiveImageUrl,
  findQuoteItems,
  isPdfUrl,
  normalizeDoi,
  normalizePdfUrl,
  normalizeText,
  openAlexUrl,
  openLibraryCoverUrl,
  pageQuoteRects,
  quoteRects,
  readOpenAlex,
  readUnpaywall,
  resolveSources,
  sourceCacheKey,
  sourceRef,
  unpaywallUrl,
  type SourceDeps,
  type TextItemLike,
} from "../src/render/source";
import type { Spec, SpecElement } from "../src/spec/types";

const DATA = "data:image/jpeg;base64,AAAA";
const PAGE = encodeSourceImage(1.4, DATA);

const spec = (el: object): Spec => ({ elements: [{ id: "s1", type: "source", ...el }], commands: [] }) as unknown as Spec;

/** A resolver wired to canned answers: no network, no canvas, no pdf.js. */
function deps(routes: Record<string, unknown>, extra: Partial<SourceDeps> = {}): SourceDeps & { calls: string[]; rendered: string[] } {
  const calls: string[] = [];
  const rendered: string[] = [];
  return {
    calls,
    rendered,
    fetch: async (url: string) => {
      calls.push(url);
      const body = routes[url];
      if (body === undefined) return { ok: false, status: 404, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => body };
    },
    renderImage: async (url: string) => {
      rendered.push(url);
      if (url.includes("nocover")) throw new Error(`no cover image available: ${url}`);
      return { encoded: encodeSourceImage(1.5, DATA) };
    },
    renderPage: async (url: string, page: number, quote?: string) => {
      rendered.push(`${url}#${page}${quote ? `#${quote}` : ""}`);
      if (quote === "not on this page") return { encoded: encodeSourceImage(1.29, DATA), quoteMissed: true };
      return { encoded: encodeSourceImage(1.29, DATA, quote ? [[0.1, 0.9, 0.6, 0.03]] : []) };
    },
    ...extra,
  };
}

describe("source element — schema", () => {
  test("validates with any ONE reference, and not with none", () => {
    expect(validateSpec(spec({ of: "The Wealth of Nations" })).ok).toBe(true);
    expect(validateSpec(spec({ doi: "10.48550/arXiv.1706.03762" })).ok).toBe(true);
    expect(validateSpec(spec({ isbn: "9780691137285" })).ok).toBe(true);
    expect(validateSpec(spec({ archive: "theoryofmoralsen00smit" })).ok).toBe(true);
    expect(validateSpec(spec({ url: "https://arxiv.org/pdf/1706.03762" })).ok).toBe(true);
    expect(validateSpec(spec({ strokes: PAGE })).ok).toBe(true);
    expect(validateSpec(spec({})).ok).toBe(false);
  });

  test("page, quote, width and reveal are accepted; junk is not", () => {
    expect(validateSpec(spec({ doi: "10.1/x", page: 4, quote: "an invisible hand", width: 260, reveal: "wipe" })).ok).toBe(true);
    expect(validateSpec(spec({ of: "X", reveal: "dissolve" })).ok).toBe(false);
    expect(validateSpec(spec({ of: "X", nonsense: 1 })).ok).toBe(false);
  });
});

describe("source codec — img2", () => {
  test("round-trips the aspect, the data URI and the highlight rects", () => {
    const rects: [number, number, number, number][] = [
      [0.1, 1.2, 0.6, 0.03],
      [0.1, 1.14, 0.35, 0.03],
    ];
    const out = decodeSourceImage(encodeSourceImage(1.4, DATA, rects))!;
    expect(out.href).toBe(DATA);
    expect(out.aspect).toBeCloseTo(1.4, 2);
    expect(out.rects.length).toBe(2);
    out.rects.forEach((r, i) => r.forEach((v, k) => expect(v).toBeCloseTo(rects[i][k], 2)));
  });

  test("a plain portrait photo (img1) decodes with no rects; junk is null", () => {
    expect(decodeSourceImage(encodePhoto(1.25, DATA))).toEqual({ aspect: 1.25, href: DATA, rects: [] });
    expect(decodeSourceImage("img2:AA:zzz:data:image/jpeg;base64,AA")).toBeNull(); // rect chars not a multiple of 8
    expect(decodeSourceImage("img2:AA::not-a-data-uri")).toBeNull();
    expect(decodeSourceImage("t2:AA:")).toBeNull();
  });
});

describe("source element — rendering", () => {
  test("a resolved page draws a framed image with the title as its caption", () => {
    const res = layoutSpec(spec({ of: "Attention Is All You Need", strokes: PAGE, x: 500, y: 400, width: 200 }));
    const flat = flattenDrawables(res.drawables);
    const img = flat.find((d) => d.id === "s1__img") as { kind: string; w: number; h: number; pos: [number, number]; reveal?: string };
    expect(img.kind).toBe("image");
    expect(img.w).toBe(200);
    expect(img.h).toBeCloseTo(280, 0);
    expect(img.pos).toEqual([500, 400]);
    expect(img.reveal).toBe("wipe");
    expect(flat.some((d) => d.id === "s1__frame")).toBe(true);
    const name = flat.find((d) => d.id === "s1__name") as { text: string; pos: [number, number] };
    expect(name.text).toBe("Attention Is All You Need");
    expect(name.pos[0]).toBe(500);
    expect(name.pos[1]).toBeLessThan(400 - 140); // below the page's bottom edge
  });

  test("an unresolved reference degrades to a ruled placeholder page, no throw", () => {
    const res = layoutSpec(spec({ of: "A Book Nobody Fetched", x: 500, y: 400 }));
    const flat = flattenDrawables(res.drawables);
    expect(flat.some((d) => d.id === "s1__frame")).toBe(true);
    expect(flat.filter((d) => d.id.startsWith("s1__rule")).length).toBe(4);
    expect(flat.some((d) => d.id === "s1__img")).toBe(false);
    expect((flat.find((d) => d.id === "s1__name") as { text: string }).text).toBe("A Book Nobody Fetched");
    expect(res.warnings).toEqual([]);
    expect(res.order).toContain("s1");
  });

  test("an unresolved quote still promises its id, drawing nothing", () => {
    // The storyboard times the sweep on its own beat; that beat must survive
    // an unresolved reference, or every quoting drawcast breaks offline.
    const res = layoutSpec(spec({ of: "Smith", page: 12, quote: "an invisible hand" }));
    expect(res.order).toContain("s1_quote");
    const sweep = flattenDrawables(res.drawables).find((d) => d.id === "s1_quote") as { pts: [number, number][] };
    expect(sweep.pts).toEqual([]);
    expect(res.issues).toEqual([]);
  });

  test("a page defaults wider than a cover", () => {
    const cover = flattenDrawables(layoutSpec(spec({ of: "X", strokes: PAGE })).drawables);
    const page = flattenDrawables(layoutSpec(spec({ of: "X", strokes: PAGE, page: 4 })).drawables);
    expect((cover.find((d) => d.id === "s1__img") as { w: number }).w).toBe(200);
    expect((page.find((d) => d.id === "s1__img") as { w: number }).w).toBe(260);
  });

  test("quote rects become addressable highlighter strokes, drawn AFTER the page", () => {
    const strokes = encodeSourceImage(1.4, DATA, [
      [0.1, 1.2, 0.6, 0.04],
      [0.1, 1.1, 0.35, 0.04],
    ]);
    const res = layoutSpec(spec({ of: "Smith", strokes, page: 12, quote: "an invisible hand", x: 500, y: 400, width: 200 }));
    const flat = flattenDrawables(res.drawables);
    const first = flat.find((d) => d.id === "s1_quote") as { kind: string; pts: [number, number][]; style: { strokeWidth: number; opacity: number } };
    expect(first.kind).toBe("stroke");
    // Width 200: x from 0.1 → 500-100+20 = 420, running 0.6*200 = 120 wide.
    expect(first.pts[0][0]).toBeCloseTo(420, 0);
    expect(first.pts[1][0]).toBeCloseTo(540, 0);
    expect(first.pts[0][1]).toBeCloseTo(first.pts[1][1], 6); // a level marker sweep
    expect(first.style.strokeWidth).toBeCloseTo(8, 0); // 0.04 × 200
    expect(first.style.opacity).toBeLessThan(1);
    expect(flat.some((d) => d.id === "s1_quote_2")).toBe(true);
    // Order is paint order AND command order: the sweep follows its page.
    expect(res.order.indexOf("s1_quote")).toBeGreaterThan(res.order.indexOf("s1"));
    expect(res.order).toContain("s1_quote_2");
    // Drawing the source alone must NOT drag the highlight along.
    expect(flattenDrawables([res.drawables[0]]).some((d) => d.id === "s1_quote")).toBe(false);
  });
});

describe("source resolver — references", () => {
  test("precedence: url > archive > doi > isbn > of", () => {
    const all = { url: "u", archive: "a", doi: "d", isbn: "i", of: "t" };
    expect(sourceRef(all)).toEqual({ kind: "url", value: "u" });
    expect(sourceRef({ ...all, url: undefined })).toEqual({ kind: "archive", value: "a" });
    expect(sourceRef({ ...all, url: undefined, archive: undefined })).toEqual({ kind: "doi", value: "d" });
    expect(sourceRef({ isbn: "i", of: "t" })).toEqual({ kind: "isbn", value: "i" });
    expect(sourceRef({ of: "t" })).toEqual({ kind: "of", value: "t" });
    expect(sourceRef({})).toBeNull();
  });

  test("cache keys: strokes need none; page and quote both split the key", () => {
    const el = { type: "source" as const, doi: "10.1/X" };
    expect(sourceCacheKey({ ...el, strokes: PAGE })).toBeNull();
    expect(sourceCacheKey({ type: "source" })).toBeNull();
    const base = sourceCacheKey(el)!;
    expect(base).toBe(`s${SOURCE_VERSION}|doi|10.1/x|p0|q`);
    expect(sourceCacheKey({ ...el, page: 4 })).not.toBe(base);
    expect(sourceCacheKey({ ...el, page: 4, quote: "a" })).not.toBe(sourceCacheKey({ ...el, page: 4 }));
    // The quote is normalized before hashing: wrapping is not a new page.
    expect(sourceCacheKey({ ...el, page: 4, quote: "an  invisible\nhand" })).toBe(sourceCacheKey({ ...el, page: 4, quote: "an invisible hand" }));
  });

  test("endpoint urls and the arXiv /abs/ trap", () => {
    expect(normalizeDoi("https://doi.org/10.48550/arXiv.1706.03762")).toBe("10.48550/arXiv.1706.03762");
    expect(normalizeDoi("doi: 10.1/x")).toBe("10.1/x");
    // The slash between prefix and suffix must NOT be percent-encoded:
    // measured, `doi:10.1038%2Fnature14539` is a 404 page at OpenAlex.
    expect(openAlexUrl("10.1038/nature14539")).toBe("https://api.openalex.org/works/doi:10.1038/nature14539");
    expect(unpaywallUrl("10.1/x y", "a@b.no")).toBe("https://api.unpaywall.org/v2/10.1/x%20y?email=a%40b.no");
    expect(openLibraryCoverUrl("978-0-691-13728-5")).toBe("https://covers.openlibrary.org/b/isbn/9780691137285-L.jpg");
    expect(archiveImageUrl("smith", 7, 600)).toBe("https://iiif.archive.org/iiif/smith$7/full/600,/0/default.jpg");
    expect(normalizePdfUrl("https://arxiv.org/abs/1706.03762")).toBe("https://arxiv.org/pdf/1706.03762");
    expect(isPdfUrl("https://arxiv.org/abs/1706.03762")).toBe(true);
    expect(isPdfUrl("https://example.org/paper.pdf")).toBe(true);
    expect(isPdfUrl("https://example.org/cover.jpg")).toBe(false);
  });

  test("OpenAlex and Unpaywall are read for the OA pdf, the landing page and the title", () => {
    expect(
      readOpenAlex({
        title: "Attention Is All You Need",
        best_oa_location: { pdf_url: "https://arxiv.org/pdf/1706.03762", landing_page_url: "https://arxiv.org/abs/1706.03762" },
      }),
    ).toEqual({ pdf: "https://arxiv.org/pdf/1706.03762", landing: "https://arxiv.org/abs/1706.03762", title: "Attention Is All You Need" });
    expect(readOpenAlex({ best_oa_location: null, primary_location: { landing_page_url: "https://pub" } })).toEqual({
      pdf: null,
      landing: "https://pub",
      title: null,
    });
    // Measured on real works: best_oa_location often names a repository with
    // a null pdf_url while `locations` carries the arXiv PDF — and the
    // top-ranked mirror can be an obscure host pdf.js cannot read.
    expect(
      readOpenAlex({
        display_name: "Deep learning",
        best_oa_location: { pdf_url: null, landing_page_url: "https://hal.science/hal-04206682" },
        locations: [
          { pdf_url: null, landing_page_url: "https://doi.org/10.1038/nature14539" },
          { pdf_url: "https://langtaosha.example/download/10/108" },
          { pdf_url: "https://arxiv.org/pdf/1706.03762", landing_page_url: "http://arxiv.org/abs/1706.03762" },
        ],
      }),
    ).toEqual({ pdf: "https://arxiv.org/pdf/1706.03762", landing: "https://hal.science/hal-04206682", title: "Deep learning" });
    expect(readUnpaywall({ title: "T", best_oa_location: { url_for_pdf: "https://x.pdf", url: "https://x" } })).toEqual({
      pdf: "https://x.pdf",
      landing: "https://x",
      title: "T",
    });
    expect(readUnpaywall({ best_oa_location: null })).toEqual({ pdf: null, landing: null, title: null });
  });
});

describe("source resolver — the chain", () => {
  test("title → Wikipedia thumbnail, caption, and an auto-appended link", async () => {
    const d = deps({
      "https://en.wikipedia.org/api/rest_v1/page/summary/On_the_Origin_of_Species": {
        title: "On the Origin of Species",
        thumbnail: { source: "https://upload.wikimedia.org/title-page.jpg" },
        content_urls: { desktop: { page: "https://en.wikipedia.org/wiki/On_the_Origin_of_Species" } },
      },
    });
    const s = spec({ of: "On the Origin of Species" });
    const [r] = await resolveSources(s, d);
    expect(r).toEqual({ id: "s1", ok: true, warning: undefined });
    const el = s.elements![0];
    expect(decodeSourceImage(el.strokes!)).not.toBeNull();
    expect(el.link).toEqual(["https://en.wikipedia.org/wiki/On_the_Origin_of_Species"]);
    expect(el.source).toBe("https://upload.wikimedia.org/title-page.jpg");
    expect(d.rendered).toEqual(["https://upload.wikimedia.org/title-page.jpg"]);
  });

  test("doi → OpenAlex → the arXiv pdf, rendered at the requested page with the quote", async () => {
    const d = deps({
      "https://api.openalex.org/works/doi:10.48550/arXiv.1706.03762": {
        title: "Attention Is All You Need",
        best_oa_location: { pdf_url: "https://arxiv.org/abs/1706.03762" },
      },
    });
    const s = spec({ doi: "10.48550/arXiv.1706.03762", page: 3, quote: "scaled dot-product attention" });
    const [r] = await resolveSources(s, d);
    expect(r.ok).toBe(true);
    const el = s.elements![0];
    // /abs/ is HTML — only /pdf/ serves the PDF.
    expect(d.rendered).toEqual(["https://arxiv.org/pdf/1706.03762#3#scaled dot-product attention"]);
    expect(decodeSourceImage(el.strokes!)!.rects.length).toBe(1);
    expect(el.of).toBe("Attention Is All You Need"); // the caption the lookup discovered
    expect(el.link).toEqual(["https://arxiv.org/pdf/1706.03762"]);
  });

  test("Unpaywall is the fallback when OpenAlex knows no open copy — and only with a contact address", async () => {
    const routes = (doi: string) => ({
      [`https://api.openalex.org/works/doi:${doi}`]: { best_oa_location: null, primary_location: { landing_page_url: "https://publisher/x" } },
      [`https://api.unpaywall.org/v2/${doi}?email=hans%40example.org`]: { best_oa_location: { url_for_pdf: "https://repo/copy.pdf" } },
    });
    const withEmail = deps(routes("10.1/paywalled-a"), { contactEmail: "hans@example.org" });
    const [ok] = await resolveSources(spec({ doi: "10.1/paywalled-a" }), withEmail);
    expect(ok.ok).toBe(true);
    expect(withEmail.rendered).toEqual(["https://repo/copy.pdf#1"]);

    // No address: Unpaywall is never called, and a paywalled DOI with no title
    // to fall back on resolves to nothing but its link. (A DOI of its own —
    // the reference cache is shared, and the point here is the cold path.)
    const anon = deps(routes("10.1/paywalled-b"));
    const s = spec({ doi: "10.1/paywalled-b" });
    const [r] = await resolveSources(s, anon);
    expect(anon.calls.some((u) => u.includes("unpaywall"))).toBe(false);
    expect(r.ok).toBe(false);
    expect(r.error).toContain("no open-access image or PDF");
    expect(s.elements![0].strokes).toBeUndefined(); // the placeholder draws
    expect(s.elements![0].link).toEqual(["https://publisher/x"]); // the link still works
  });

  test("a missing Open Library cover falls back to the title, with a warning", async () => {
    const d = deps(
      {
        "https://en.wikipedia.org/api/rest_v1/page/summary/Theory_of_Moral_Sentiments": {
          title: "The Theory of Moral Sentiments",
          originalimage: { source: "https://upload.wikimedia.org/tms.jpg" },
        },
      },
      {
        // Open Library answers "no cover for this ISBN" with a 1×1 pixel,
        // which the real renderer reports as this error.
        renderImage: async (url: string) => {
          if (url.startsWith("https://covers.openlibrary.org/")) throw new Error(`no cover image available: ${url}`);
          return { encoded: encodeSourceImage(1.5, DATA) };
        },
      },
    );
    const s = spec({ isbn: "9780140432084", of: "Theory of Moral Sentiments" });
    const [r] = await resolveSources(s, d);
    expect(r.ok).toBe(true);
    expect(r.warning).toContain("Theory of Moral Sentiments");
    expect(s.elements![0].source).toBe("https://upload.wikimedia.org/tms.jpg");
    // The ISBN's own Open Library page stays the click-through.
    expect(s.elements![0].link).toEqual(["https://openlibrary.org/isbn/9780140432084"]);
  });

  test("archive: the IIIF leaf comes from page, the details page from the id", async () => {
    const s = spec({ archive: "theoryofmoralsen00smit", page: 42, of: "The Theory of Moral Sentiments" });
    const d = deps({});
    const [r] = await resolveSources(s, d);
    expect(r.ok).toBe(true);
    expect(d.rendered[0]).toContain("iiif/theoryofmoralsen00smit$42/");
    expect(s.elements![0].link).toEqual(["https://archive.org/details/theoryofmoralsen00smit"]);
    expect(d.calls).toEqual([]); // no API to ask at all
  });

  test("an unfound quote still resolves the page, with a warning and no highlight", async () => {
    const s = spec({ url: "https://example.org/paper.pdf", page: 2, quote: "not on this page" });
    const [r] = await resolveSources(s, deps({}));
    expect(r.ok).toBe(true);
    expect(r.warning).toContain("quote not found on page 2");
    expect(decodeSourceImage(s.elements![0].strokes!)!.rects).toEqual([]);
  });

  test("a quote on a picture source warns instead of pretending", async () => {
    const s = spec({ archive: "some_scan", page: 3, quote: "led by an invisible hand" });
    const [r] = await resolveSources(s, deps({}));
    expect(r.ok).toBe(true);
    expect(r.warning).toContain("needs a PDF page");
  });

  test("already-resolved strokes skip the network entirely; a reference-less source reports why", async () => {
    const d = deps({});
    const s: Spec = {
      elements: [
        { id: "a", type: "source", of: "X", strokes: PAGE },
        { id: "b", type: "source" },
      ] as SpecElement[],
      commands: [],
    };
    const out = await resolveSources(s, d);
    expect(out[0]).toEqual({ id: "a", ok: true });
    expect(out[1].ok).toBe(false);
    expect(out[1].error).toContain("no title, doi, isbn, archive id, or url");
    expect(d.calls).toEqual([]);
    expect(d.rendered).toEqual([]);
  });

  test("the second resolution of the same reference is served from cache", async () => {
    const routes = {
      "https://en.wikipedia.org/api/rest_v1/page/summary/Das_Kapital": { title: "Das Kapital", thumbnail: { source: "https://img/kapital.jpg" } },
    };
    await resolveSources(spec({ of: "Das Kapital" }), deps(routes));
    const again = deps(routes);
    const s = spec({ of: "Das Kapital" });
    const [r] = await resolveSources(s, again);
    expect(r.ok).toBe(true);
    expect(again.calls).toEqual([]);
    expect(again.rendered).toEqual([]);
    expect(s.elements![0].strokes).toBeTruthy();
    expect(s.elements![0].link).toEqual(["https://en.wikipedia.org/wiki/Das_Kapital"]);
  });

  test("an authored link survives; the resolved one is appended once and never past four", async () => {
    const routes = { "https://en.wikipedia.org/api/rest_v1/page/summary/Leviathan": { thumbnail: { source: "https://img/lev.jpg" } } };
    const s = spec({ of: "Leviathan", link: "https://example.org/review" });
    await resolveSources(s, deps(routes));
    expect(s.elements![0].link).toEqual(["https://example.org/review", "https://en.wikipedia.org/wiki/Leviathan"]);
    // Resolving again (a re-render) must not append a duplicate.
    delete s.elements![0].strokes;
    await resolveSources(s, deps(routes));
    expect(s.elements![0].link).toEqual(["https://example.org/review", "https://en.wikipedia.org/wiki/Leviathan"]);

    const full = spec({ of: "Leviathan", link: ["https://a", "https://b", "https://c", "https://d"] });
    await resolveSources(full, deps(routes));
    expect(full.elements![0].link).toEqual(["https://a", "https://b", "https://c", "https://d"]);
  });
});

describe("source resolver — quote matching", () => {
  const items = (...strs: string[]): TextItemLike[] => strs.map((str, i) => ({ str, transform: [1, 0, 0, 1, 10 * i, 100], width: 20, height: 10 }));

  test("normalizeText collapses whitespace, flattens curly punctuation, joins hyphenation", () => {
    expect(normalizeText("  Led   by an\nINVISIBLE hand  ")).toBe("led by an invisible hand");
    expect(normalizeText("govern-\nment")).toBe("government");
    expect(normalizeText("soft­hyphen")).toBe("softhyphen");
    expect(normalizeText("the nation’s wealth")).toBe("the nation's wealth");
    expect(normalizeText("well-being")).toBe("well-being"); // a real hyphen survives
  });

  test("finds a quote spanning several items, including across a hyphenated line break", () => {
    expect(findQuoteItems(items("led by", "an invisible", "hand to promote"), "an invisible hand")).toEqual({ from: 1, to: 2 });
    expect(findQuoteItems(items("the govern-", "ment of the day"), "the government of the day")).toEqual({ from: 0, to: 1 });
    expect(findQuoteItems(items("led by", "an invisible", "hand"), "AN   INVISIBLE\nHAND")).toEqual({ from: 1, to: 2 });
  });

  test("a paraphrase simply does not match — and an empty quote never does", () => {
    expect(findQuoteItems(items("led by an invisible hand"), "guided by an unseen hand")).toBeNull();
    expect(findQuoteItems(items("led by an invisible hand"), "   ")).toBeNull();
    expect(findQuoteItems([], "anything")).toBeNull();
  });

  test("quoteRects merges each line into one sweep, in y-UP image-normalized units", () => {
    // A 100×200 page (aspect 2). Two words on one line, one on the next.
    const rects = quoteRects(
      [
        { x: 10, y: 40, w: 20, h: 10 },
        { x: 32, y: 41, w: 18, h: 10 },
        { x: 10, y: 60, w: 15, h: 10 },
      ],
      100,
      200,
    );
    expect(rects.length).toBe(2);
    // Line 1 spans x 10 → 50 (plus 2px marker padding on each side) of 100.
    expect(rects[0][0]).toBeCloseTo(0.08, 2);
    expect(rects[0][2]).toBeCloseTo(0.44, 2);
    // y-up: the line at viewport y≈40 sits near the TOP, i.e. high in y-up.
    expect(rects[0][1]).toBeGreaterThan(rects[1][1]);
    // Everything stays inside the page: y + h ≤ aspect = 2.
    for (const [x, y, w, h] of rects) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x + w).toBeLessThanOrEqual(1);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y + h).toBeLessThanOrEqual(2.0001);
    }
    expect(quoteRects([], 100, 200)).toEqual([]);
  });

  test("the pdf text-layer path, end to end on a fake page — no canvas, no download", async () => {
    // A 200×400 pt page rendered at scale 2 → an 400×800 px canvas. The
    // viewport is the real pdf.js contract: PDF user space is y-UP and
    // bottom-left, the viewport is y-down, and only it knows the flip.
    const SCALE = 2;
    const CANVAS_H = 800;
    const viewport = {
      width: 400,
      height: CANVAS_H,
      convertToViewportPoint: (x: number, y: number) => [x * SCALE, CANVAS_H - y * SCALE],
    };
    // Two lines near the TOP of the page (high y in PDF space).
    const at = (str: string, x: number, y: number, w: number) => ({ str, transform: [10, 0, 0, 10, x, y], width: w, height: 10 });
    const page = {
      getViewport: () => viewport,
      render: () => ({ promise: Promise.resolve() }),
      getTextContent: async () => ({
        items: [at("Not it.", 20, 340, 40), at("led by an", 20, 320, 45), at("invisible hand", 20, 306, 60)],
      }),
    };
    const rects = (await pageQuoteRects(page, viewport, "led by an invisible hand", 400, CANVAS_H))!;
    expect(rects.length).toBe(2); // one sweep per line
    // The quoted lines sit high on the page, so high in y-up normalized units
    // (y is normalized by WIDTH, like every trace coordinate).
    expect(rects[0][1]).toBeGreaterThan(rects[1][1]);
    // The first sweep COVERS its line's band (320→330 pt = 1.60→1.65 here)…
    expect(rects[0][1]).toBeLessThanOrEqual(320 / 200);
    expect(rects[0][1] + rects[0][3]).toBeGreaterThanOrEqual(330 / 200);
    // …and stops short of the unquoted line above it (340→350 pt).
    expect(rects[0][1] + rects[0][3]).toBeLessThan(340 / 200);
    // The second sweep covers the second line and nothing above it.
    expect(rects[1][1]).toBeLessThanOrEqual(306 / 200);
    expect(rects[1][1] + rects[1][3]).toBeGreaterThanOrEqual(316 / 200);
    expect(rects[1][1] + rects[1][3]).toBeLessThan(320 / 200);
    // A paraphrase yields null — the page still resolves, just unmarked.
    expect(await pageQuoteRects(page, viewport, "guided by an unseen hand", 400, CANVAS_H)).toBeNull();
  });
});

describe("source element — hoisting, cards and lint", () => {
  test("a source's page image is hoisted out of every model round-trip", async () => {
    const { hoistPortraitStrokes, restorePortraitStrokes, HOISTED, stripStrokesForModel } = await import("../src/llm/hoist");
    const { parsePlaylistText, itemsOf } = await import("../src/playlist/playlist");
    const docText = JSON.stringify({ elements: [{ id: "s1", type: "source", of: "Smith", strokes: PAGE }], commands: [] });
    const { text, blobs } = hoistPortraitStrokes(docText);
    expect(blobs.get("s1")).toBe(PAGE);
    expect(text).toContain(HOISTED);
    expect(text).not.toContain(DATA);
    const revised = parsePlaylistText(text);
    restorePortraitStrokes(revised, blobs);
    expect(itemsOf(revised)[0].spec.elements![0].strokes).toBe(PAGE);
    const stripped = stripStrokesForModel({ elements: [{ id: "s1", type: "source", of: "Smith", strokes: PAGE }], commands: [] } as Spec);
    expect(stripped.elements![0].strokes).toBeUndefined();
    expect(stripped.elements![0].of).toBe("Smith");
  });

  test("the info card names a source by its title and offers its resolved link", () => {
    const targets = cardTargets(spec({ of: "The Wealth of Nations", link: ["https://archive.org/details/x"] }));
    expect(targets.get("s1")).toEqual({ id: "s1", name: "The Wealth of Nations", kind: "plain", links: ["https://archive.org/details/x"] });
  });

  test("clicking the highlighted passage opens the page's own card, not nothing", () => {
    // The sweep's box sits inside the page's and is far smaller, and the hit
    // test takes the smallest containing box — so the sweeps must alias.
    const strokes = encodeSourceImage(1.4, DATA, [
      [0.1, 1.2, 0.6, 0.04],
      [0.1, 1.1, 0.35, 0.04],
    ]);
    const s = spec({ of: "The Wealth of Nations", strokes, page: 12, quote: "an invisible hand", link: ["https://archive.org/details/x"] });
    const targets = cardTargets(s, layoutSpec(s).order);
    expect(targets.get("s1_quote")).toBe(targets.get("s1"));
    expect(targets.get("s1_quote_2")).toBe(targets.get("s1"));
    // Without the layout's ids, nothing is invented.
    expect(cardTargets(s).has("s1_quote")).toBe(false);
  });

  test("lint: a quote with no page, cameo on a source, and a gallery of covers", () => {
    const rules = (s: Spec) => lintCommands(s).filter((i) => i.rule === "source-use").map((i) => i.message);
    expect(rules(spec({ doi: "10.1/x", quote: "something" }))[0]).toContain("no page");
    expect(rules(spec({ doi: "10.1/x", page: 2, quote: "something" }))).toEqual([]);
    expect(rules(spec({ of: "X", cameo: true }))[0]).toContain("cameo");
    const gallery: Spec = {
      elements: ["a", "b", "c"].map((id) => ({ id, type: "source", of: id })) as SpecElement[],
      commands: [],
    };
    expect(rules(gallery)[0]).toContain("3 source elements");
    expect(rules(spec({ of: "X" }))).toEqual([]);
  });
});

// A 587-byte one-page PDF, inline: three lines of Helvetica on a 200×400 page
// (built once, kept verbatim). Real pdf.js, no network, no canvas — the guard
// against a pdf.js upgrade quietly changing the API this path depends on.
const TINY_PDF =
  "JVBERi0xLjQKMSAwIG9iajw8L1R5cGUvQ2F0YWxvZy9QYWdlcyAyIDAgUj4+ZW5kb2JqCjIgMCBvYmo8PC9UeXBlL1BhZ2VzL0tpZHNbMyAwIFJdL0NvdW50IDE+PmVuZG9iagozIDAgb2JqPDwvVHlwZS9QYWdlL1BhcmVudCAyIDAgUi9NZWRpYUJveFswIDAgMjAwIDQwMF0vUmVzb3VyY2VzPDwvRm9udDw8L0YxIDQgMCBSPj4+Pi9Db250ZW50cyA1IDAgUj4+ZW5kb2JqCjQgMCBvYmo8PC9UeXBlL0ZvbnQvU3VidHlwZS9UeXBlMS9CYXNlRm9udC9IZWx2ZXRpY2E+PmVuZG9iago1IDAgb2JqPDwvTGVuZ3RoIDkxPj5zdHJlYW0KQlQgL0YxIDEyIFRmIDIwIDMyMCBUZCAoTm90IGl0LikgVGogMCAtMjAgVGQgKGxlZCBieSBhbikgVGogMCAtMTQgVGQgKGludmlzaWJsZSBoYW5kKSBUaiBFVAplbmRzdHJlYW1lbmRvYmoKeHJlZgowIDYKMDAwMDAwMDAwMCA2NTUzNSBmIAowMDAwMDAwMDA5IDAwMDAwIG4gCjAwMDAwMDAwNTIgMDAwMDAgbiAKMDAwMDAwMDEwMSAwMDAwMCBuIAowMDAwMDAwMjExIDAwMDAwIG4gCjAwMDAwMDAyNzIgMDAwMDAgbiAKdHJhaWxlcjw8L1NpemUgNi9Sb290IDEgMCBSPj4Kc3RhcnR4cmVmCjQwOAolJUVPRgo=";

describe("source resolver — against the real pdf.js", () => {
  test("the viewport contract holds and a quote sweeps the right lines", { timeout: 30000 }, async () => {
    const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const data = Uint8Array.from(atob(TINY_PDF), (c) => c.charCodeAt(0));
    const doc = await getDocument({ data }).promise;
    const page = await doc.getPage(1);
    const viewport = page.getViewport({ scale: 2 }); // 200×400 pt → 400×800 px
    expect(viewport.width).toBe(400);
    expect(viewport.height).toBe(800);
    // The API pageQuoteRects depends on. pdf.js DROPPED convertToViewportRectangle,
    // which the loader's dynamic import turns into a runtime TypeError, not a
    // type error — so the contract is pinned here.
    expect(typeof viewport.convertToViewportPoint).toBe("function");

    const rects = (await pageQuoteRects(page as never, viewport as never, "led by an invisible hand", 400, 800))!;
    expect(rects.length).toBe(2); // the quote wraps: one sweep per line
    // Line 2 is at PDF y = 300, line 3 at y = 286; normalized by WIDTH (200 pt).
    expect(rects[0][1]).toBeLessThanOrEqual(300 / 200);
    expect(rects[0][1] + rects[0][3]).toBeGreaterThanOrEqual((300 + 8) / 200);
    expect(rects[1][1]).toBeLessThanOrEqual(286 / 200);
    // Neither sweep reaches the unquoted first line (PDF y = 320).
    for (const [, y, , h] of rects) expect(y + h).toBeLessThan(320 / 200);
    // A paraphrase never matches; the page would still resolve, unmarked.
    expect(await pageQuoteRects(page as never, viewport as never, "guided by an unseen hand", 400, 800)).toBeNull();
  });
});
