// The thumbnail page (2026-10-05): `role: thumbnail` marks a page as the
// cast's listing picture — read and written like any page, never played.
import { expect, test } from "vitest";
import { itemsOf, parsePlaylistText, posterItemOf, thumbnailItemOf } from "../src/playlist/playlist";
import { printScriptPages } from "../src/spec/script/print";

const CAST = `# Why prices rose
thumb: band "Demand did it"

## The market
    text t1 "Price" x 200 y 600

The price rose because demand shifted.
    draw t1

## Thumbnail
role: thumbnail
    icon home size 160 set twemoji x 760 y 400 icon_look picture of house
    text t2 "Why prices rose" x 500 y 700 font_size 40
`;

test("a thumbnail page is read, kept out of playback and the poster, and found on its own", () => {
  const p = parsePlaylistText(CAST);
  expect(itemsOf(p).map((i) => i.spec.title)).toEqual(["The market"]);
  expect(posterItemOf(p)!.spec.title).toBe("The market");
  const thumb = thumbnailItemOf(p)!;
  expect(thumb.spec.role).toBe("thumbnail");
  expect((thumb.spec.elements ?? []).map((e) => e.id)).toContain("t2");
});

test("a cast without one has no thumbnail page", () => {
  expect(thumbnailItemOf(parsePlaylistText(CAST.split("## Thumbnail")[0]))).toBeNull();
});

test("role: thumbnail survives printing the page back", () => {
  const p = parsePlaylistText(CAST);
  const pages = p.entries.filter((e): e is Extract<typeof e, { spec: unknown }> => e.kind !== "chapter");
  const text = printScriptPages(p.meta as unknown as Record<string, unknown>, pages);
  expect(text).toContain("role: thumbnail");
  expect(thumbnailItemOf(parsePlaylistText(text))).not.toBeNull();
});

import { marksOfPage, withLineLayers } from "../src/card/convert";
import { thumbSvg } from "../netlify/lib/thumb.mts";
import { validateSpec } from "../src/spec/schema";

const WITH_MARKS = `# The deadliest animal
thumb: band "Old line"

## The deadliest animal
    text t1 "Animals" x 300 y 500

Which animal kills the most people?
    draw t1

## Thumbnail
role: thumbnail
    icon shark size 220 set twemoji x 280 y 400 icon_look picture of shark
    thumb m1 "It's not the shark" kind band
    thumb m2 "PLOT TWIST" kind stamp x 800 y 640 angle 10
    thumb m3 "tiny!" kind note
    thumb m4 kind surprised
`;

test("a thumbnail page's thumb elements are its marks: words, figure, placed and corner marks", () => {
  const page = thumbnailItemOf(parsePlaylistText(WITH_MARKS))!.spec;
  expect(validateSpec(page).ok).toBe(true);
  expect(marksOfPage(page)).toEqual({
    words: "band",
    headline: "It's not the shark",
    figure: "surprised",
    marks: [
      { kind: "stamp", words: "PLOT TWIST", at: [800, 110], rotate: -10 },
      { kind: "note", words: "tiny!" },
    ],
  });
  expect(marksOfPage({ elements: [] })).toBeNull();
});

test("a thumbnail page keeps the line's background, and its person unless the page draws a figure", () => {
  const page = { words: "band" as const, headline: "H", figure: "none" as const, marks: [] };
  const line = { words: "none" as const, figure: "none" as const, marks: [], bg: "notebook", person: "m45-surprised" };
  expect(withLineLayers(page, line)).toEqual({ ...page, bg: "notebook", person: "m45-surprised" });
  expect(withLineLayers({ ...page, figure: "eyes" }, line)).toEqual({ ...page, figure: "eyes", bg: "notebook" });
  expect(withLineLayers(page, { words: "none", figure: "none", marks: [] })).toEqual(page);
});

test("a placed mark stands where it was put; a corner mark avoids the corner it covers", () => {
  const svg = thumbSvg({ words: "none", figure: "none", marks: [{ kind: "stamp", words: "X", at: [800, 110], rotate: -10 }, { kind: "note", words: "n" }] }, "p.png", { tr: 0, tl: 1, br: 2, bl: 3 });
  expect(svg).toContain("translate(660 -20) rotate(-10");
  // The note does not take the top-right corner the stamp stands in.
  expect(svg).not.toMatch(/translate\(696 20\)/);
});

test("a thumb element needs a known kind", () => {
  const bad = { elements: [{ id: "x", type: "thumb", kind: "sparkle" }] };
  expect(validateSpec(bad as never).ok).toBe(false);
});

import { parseThumbLine, pictureAllowed, printThumbLine } from "../netlify/lib/thumb.mts";

test("the thumb line's picture: poster, or an image from an allowed host; printed back", () => {
  expect(parseThumbLine('band "Hi" poster').parts.picture).toBe("poster");
  const img = parseThumbLine('band "Hi" image "https://upload.wikimedia.org/wikipedia/commons/a/ab/Map.png"');
  expect(img.parts.picture).toBe("https://upload.wikimedia.org/wikipedia/commons/a/ab/Map.png");
  expect(printThumbLine(img.parts)).toBe('band "Hi" image "https://upload.wikimedia.org/wikipedia/commons/a/ab/Map.png"');
  const bad = parseThumbLine('band "Hi" image "https://evil.example/pixel.png"');
  expect(bad.parts.picture).toBeUndefined();
  expect(bad.unknown).toEqual(["image https://evil.example/pixel.png"]);
});

test("allowed picture hosts: the author's GitHub and Wikimedia Commons, https only", () => {
  expect(pictureAllowed("https://ann.github.io/casts/x.png")).toBe(true);
  expect(pictureAllowed("https://raw.githubusercontent.com/ann/casts/main/x.png")).toBe(true);
  expect(pictureAllowed("https://cdn.jsdelivr.net/gh/ann/casts@abc/x.png")).toBe(true);
  expect(pictureAllowed("https://cdn.jsdelivr.net/npm/x/y.png")).toBe(false);
  expect(pictureAllowed("http://ann.github.io/x.png")).toBe(false);
  expect(pictureAllowed("https://example.com/x.png")).toBe(false);
  expect(pictureAllowed("not a url")).toBe(false);
});
