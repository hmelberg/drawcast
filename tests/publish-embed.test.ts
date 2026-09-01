import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { embeddedPlaylist } from "../src/publish/embed";
import { parsePlaylistText, itemsOf } from "../src/playlist/playlist";
import { unembeddedImages } from "../src/ui/insert";

const TEXT = [
  "elements:",
  "  - {id: p1, type: portrait, of: Ricardo}",
  "commands: []",
].join("\n");

/** A two-part playlist: one portrait to embed, one source to embed. */
const MULTI = [
  "playlist:",
  "  title: Two parts",
  "---",
  "elements:",
  "  - {id: p1, type: portrait, of: Ricardo}",
  "commands: []",
  "---",
  "elements:",
  "  - {id: s1, type: source, of: Das Kapital}",
  "  - {id: t1, type: text, text: hello}",
  "commands: []",
].join("\n");

const strokesOf = (spec: { elements?: unknown[] }, i = 0): string | undefined =>
  (spec.elements?.[i] as { strokes?: string } | undefined)?.strokes;

describe("embeddedPlaylist — resolves on a copy, never the document (B2, P §3.4)", () => {
  it("hands clones to the resolvers and returns a fresh playlist", async () => {
    const doc = parsePlaylistText(TEXT);
    const original = itemsOf(doc)[0].spec;
    const out = await embeddedPlaylist(doc, {
      contactEmail: "x@y.z",
      resolvePortraits: async (spec) => {
        (spec.elements![0] as { strokes?: string }).strokes = "img1:aa:data:,x";
        return [];
      },
      resolveSources: async () => [],
    });
    expect(itemsOf(out)[0].spec).not.toBe(original);
    expect(strokesOf(itemsOf(out)[0].spec)).toBeDefined();
    // The one test that matters most — P §6: the document is byte-untouched.
    expect(strokesOf(original)).toBeUndefined();
  });

  it("leaves the ORIGINAL playlist object and its entries alone", async () => {
    const doc = parsePlaylistText(MULTI);
    const before = JSON.stringify(doc);
    const out = await embeddedPlaylist(doc, {
      contactEmail: "x@y.z",
      resolvePortraits: async (spec) => {
        for (const el of spec.elements ?? []) if (el.type === "portrait") (el as { strokes?: string }).strokes = "t2:aa";
        return [];
      },
      resolveSources: async (spec) => {
        for (const el of spec.elements ?? []) if (el.type === "source") (el as { strokes?: string }).strokes = "img1:aa:data:,x";
        return [];
      },
    });
    expect(JSON.stringify(doc)).toBe(before);
    expect(out).not.toBe(doc);
    expect(strokesOf(itemsOf(out)[0].spec)).toBe("t2:aa");
    expect(strokesOf(itemsOf(out)[1].spec)).toBe("img1:aa:data:,x");
  });

  it("keeps the header (meta, prompt included) and the chapter entries", async () => {
    const doc = parsePlaylistText(MULTI);
    doc.meta.prompt = "draw two parts";
    const out = await embeddedPlaylist(doc, {
      contactEmail: "x@y.z",
      resolvePortraits: async () => [],
      resolveSources: async () => [],
    });
    expect(out.meta.title).toBe("Two parts");
    expect(out.meta.prompt).toBe("draw two parts");
    expect(itemsOf(out)).toHaveLength(2);
  });

  it("passes the contact email through to resolveSources", async () => {
    const seen: string[] = [];
    await embeddedPlaylist(parsePlaylistText(TEXT), {
      contactEmail: "hans@example.com",
      resolvePortraits: async () => [],
      resolveSources: async (_spec, opts) => {
        seen.push(opts.contactEmail);
        return [];
      },
    });
    expect(seen).toEqual(["hans@example.com"]);
  });
});

describe("unembeddedImages", () => {
  it("counts portrait/source elements without strokes across every part", () => {
    expect(unembeddedImages(parsePlaylistText(TEXT))).toBe(1);
    expect(unembeddedImages(parsePlaylistText(MULTI))).toBe(2);
  });

  it("embedded elements do not count", () => {
    const p = parsePlaylistText(TEXT);
    (itemsOf(p)[0].spec.elements![0] as { strokes?: string }).strokes = "img1:aa:data:,x";
    expect(unembeddedImages(p)).toBe(0);
  });

  it("is zero for a playlist with no images at all", () => {
    expect(unembeddedImages(parsePlaylistText("elements: []\ncommands: []"))).toBe(0);
  });
});

// ---- the words the author reads (P §3.6, §3.7) ------------------------------

describe("Publish's two embed choices", () => {
  it("share.ts asks about images and narration, not 'with narration'", async () => {
    const src = await readFile(new URL("../src/ui/share.ts", import.meta.url), "utf8");
    expect(src).not.toContain("linkBakeCb");
    expect(src).not.toContain('"with narration"');
    expect(src).toContain("Embed images");
    expect(src).toContain("Embed narration");
    // The count comes from the shared counter, never a second copy of it.
    expect(src).toContain("unembeddedImages");
  });

  it("passes both choices to publish as one object", async () => {
    const src = await readFile(new URL("../src/ui/share.ts", import.meta.url), "utf8");
    // Task 11 (B3) extended this object with `slug?: string` — bake and
    // embedImages stay exactly as this task landed them, so pin only that
    // the two survive together, not that nothing else may follow.
    expect(src).toMatch(/publish:\s*\(choices:\s*\{\s*bake:\s*boolean;\s*embedImages:\s*boolean/);
  });

  it("labels the images box with its count, and says so when there is nothing to embed", async () => {
    const src = await readFile(new URL("../src/ui/share.ts", import.meta.url), "utf8");
    expect(src).toContain("`Embed images (${embedCount})`");
    expect(src).toContain("all images are already in the file");
    // Zero unembedded images: the box is off AND cannot be turned on.
    expect(src).toMatch(/embedImagesCb\.disabled = embedCount === 0;/);
    expect(src).toMatch(/embedImagesCb\.checked = embedCount !== 0;/);
    // …and a disabled box can never publish an embed, whatever it looks like.
    expect(src).toMatch(/embedImages: embedImagesCb\.checked && !embedImagesCb\.disabled/);
  });
});

describe("publishing embeds into the copy, never the document (P §3.4)", () => {
  it("main.ts's publishTextFor reads `source` throughout, and counts/embeds from the editor text, not the render-mutated doc.playlist", async () => {
    const src = await readFile(new URL("../src/main.ts", import.meta.url), "utf8");
    const fn = src.slice(src.indexOf("async function publishTextFor"), src.indexOf("let lastBakeNote"));
    // The count AND the clone embeddedPlaylist works from both read
    // `editorPlaylist` — text re-parsed via readPlaylistText — never
    // doc.playlist, since render() resolves portraits/sources IN PLACE on
    // doc.playlist's own spec objects on every preview render.
    expect(fn).toContain("const editorPlaylist = embedImages ? (readPlaylistText(specArea.value) ?? doc.playlist) : null;");
    expect(fn).toContain("const before = editorPlaylist ? unembeddedImages(editorPlaylist) : 0;");
    expect(fn).toContain("embeddedPlaylist(editorPlaylist,");
    expect(fn).not.toContain("embeddedPlaylist(doc.playlist");
    // The only legitimate doc.playlist reads left are: the editorPlaylist
    // fallback and the unconditional `let source = doc.playlist;` default
    // (used as-is whenever embedImages is false, or there is nothing to
    // embed) — `doc.publishedAs` is a different field, not a playlist.
    expect(fn.match(/doc\.playlist/g)).toHaveLength(2);
    for (const onSource of ["formatPlaylist(source", "playlistSpeakLines(source)", "itemsOf(source)", "formatPublished(source"]) {
      expect(fn).toContain(onSource);
    }
  });

  it("the status line counts what was embedded", async () => {
    const src = await readFile(new URL("../src/main.ts", import.meta.url), "utf8");
    expect(src).toContain("image(s) embedded");
    expect(src).toContain("${lastEmbedNote}");
  });

  it("reports a status before the embed await, so a slow embed does not look stalled", async () => {
    const src = await readFile(new URL("../src/main.ts", import.meta.url), "utf8");
    const fn = src.slice(src.indexOf("async function publishTextFor"), src.indexOf("let lastBakeNote"));
    const statusAt = fn.indexOf('setStatus("Embedding images…");');
    const embedAt = fn.indexOf("await embeddedPlaylist(editorPlaylist");
    expect(statusAt).toBeGreaterThan(-1);
    expect(embedAt).toBeGreaterThan(statusAt);
  });

  it("Share's doc() derives the playlist from the editor text, not the render-mutated doc.playlist", async () => {
    const src = await readFile(new URL("../src/main.ts", import.meta.url), "utf8");
    expect(src).toMatch(/doc:\s*\(\)\s*=>\s*\(\{\s*\.\.\.doc,\s*playlist:\s*readPlaylistText\(specArea\.value\)\s*\?\?\s*doc\.playlist\s*\}\)/);
  });

  it("course lectures embed on a parsed copy, and skip a lecture with nothing to embed", async () => {
    const src = await readFile(new URL("../src/ui/course.ts", import.meta.url), "utf8");
    expect(src).toMatch(/async function publish\(\{ bake, embedImages \}/);
    expect(src).toContain("async function embedLectures");
    expect(src).toContain("embeddedPlaylist(playlist, { resolvePortraits, resolveSources, contactEmail })");
    // Nothing to embed → the lecture's yaml is left byte-identical rather
    // than reflowed through parse+format.
    expect(src).toMatch(/const before = unembeddedImages\(playlist\);\s*\n\s*if \(before === 0\) continue;/);
    expect(src).toContain("image(s) embedded");
  });
});

describe("the rename: pin becomes embed (P §3.7)", () => {
  it("the Insert menu offers embedding, and no user-facing string says pin", async () => {
    const main = await readFile(new URL("../src/main.ts", import.meta.url), "utf8");
    expect(main).toContain('label: "Embed images in the file"');
    expect(main).toContain('title: "Add an image, or embed every image into the file"');
    expect(main).not.toContain('"Pin all images"');
  });

  it("the dialog is titled Embed, its button says Embed, and it names the difference", async () => {
    const src = await readFile(new URL("../src/ui/insert.ts", import.meta.url), "utf8");
    expect(src).toContain('createModal("Embed images in the file"');
    expect(src).toContain('"Embed")');
    expect(src).not.toContain('createModal("Pin all images"');
    // §3.6: this dialog changes YOUR document; publishing embeds into the copy.
    expect(src).toMatch(/this document/i);
    expect(src).toMatch(/Publishing embeds/i);
  });

  it("no user-facing string in insert.ts still says pin/pinned/pinning", async () => {
    const src = await readFile(new URL("../src/ui/insert.ts", import.meta.url), "utf8");
    // Strip comments — the WHY-comments may keep the historical word.
    const code = src
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split("\n")
      .map((l) => l.replace(/(^|[^:])\/\/.*$/, "$1"))
      .join("\n");
    const strings = [...code.matchAll(/"([^"\\]*)"/g)].map((m) => m[1]);
    expect(strings.filter((s) => /\bpin(ned|ning|s)?\b/i.test(s))).toEqual([]);
  });
});
