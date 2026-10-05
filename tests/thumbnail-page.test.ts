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
