// "Ask AI for a thumbnail" (2026-10-05): the reply as page lines
// (src/llm/thumbnail.ts) and a playlist's thumbnail page as text and back
// (src/card/page.ts).
import { expect, test } from "vitest";
import { thumbnailBodyOf, thumbnailUser, THUMBNAIL_SYSTEM } from "../src/llm/thumbnail";
import { thumbnailBody, withThumbnailPage } from "../src/card/page";
import { itemsOf, parsePlaylistText, thumbnailItemOf, thumbnailItemsOf } from "../src/playlist/playlist";

const CAST = `# Why prices rose
subtitle: "How demand moved the price"

## The market
    text t1 "Price" x 200 y 600

The price rose because demand shifted.
    draw t1
`;

test("the reply keeps only element lines, indented, whatever the model wrapped them in", () => {
  const reply = 'Here you go:\n```\n## Thumbnail\nrole: thumbnail\n  icon house size 300 set twemoji x 260 y 470 icon_look picture of house\n\ttext n "+30 %" x 700 y 520 font_size 150\nthumb b "Demand did it" kind band\n```\nEnjoy!';
  expect(thumbnailBodyOf(reply)).toBe(
    '## Thumbnail\n    icon house size 300 set twemoji x 260 y 470 icon_look picture of "house"\n    text n "+30 %" x 700 y 520 font_size 150\n    thumb b "Demand did it" kind band',
  );
  expect(thumbnailBodyOf("Sorry, I can't.")).toBe("");
  // A keyword with spaces gets the quotes the notation needs.
  expect(thumbnailBodyOf("    icon zap size 260 set twemoji x 850 y 450 icon_look picture of high voltage")).toBe('## Thumbnail\n    icon zap size 260 set twemoji x 850 y 450 icon_look picture of "high voltage"');
});

test("the model is told the title, subtitle and opening lines, and the notation", () => {
  const user = thumbnailUser(CAST, 'band "x"');
  expect(user).toContain("Title: Why prices rose");
  expect(user).toContain("Subtitle: How demand moved the price");
  expect(user).toContain("- The price rose because demand shifted.");
  expect(THUMBNAIL_SYSTEM).toContain("kind band");
});

test("a page's lines go into the playlist as its one thumbnail page, and come back out", () => {
  const p = parsePlaylistText(CAST);
  expect(thumbnailBody(p)).toBeNull();
  const body = '    icon house size 300 set twemoji x 260 y 470 icon_look picture of house\n    thumb b "Demand did it" kind band';
  const withPage = withThumbnailPage(p, body);
  expect(itemsOf(withPage)).toHaveLength(1);
  expect(thumbnailItemOf(withPage)!.spec.page?.valign).toBe("none");
  const back = thumbnailBody(withPage)!;
  expect(back).toContain("icon house");
  expect(back).toContain('thumb b "Demand did it"');
  // Replacing, not adding; null removes it.
  expect(withThumbnailPage(withThumbnailPage(withPage, body), body).entries.filter((e) => e.kind === "item" && e.spec.role === "thumbnail")).toHaveLength(1);
  expect(thumbnailItemOf(withThumbnailPage(withPage, null))).toBeNull();
});

test("three pages from the AI become three thumbnail pages, in order, and come back out", () => {
  const reply = "## Thumbnail\n    text a \"A\" x 500 y 500 font_size 90\n    thumb b \"One\" kind band\n## Thumbnail\n    text c \"B\" x 500 y 500 font_size 90\n    thumb d \"Two\" kind band\n\n## Thumbnail\n    text e \"C\" x 500 y 500 font_size 90\n    thumb f \"Three\" kind band";
  const text = thumbnailBodyOf(reply);
  const pl = withThumbnailPage(parsePlaylistText(CAST), text);
  expect(thumbnailItemsOf(pl).map((i) => i.spec.elements?.[0].id)).toEqual(["a", "c", "e"]);
  expect(thumbnailBody(pl)!.match(/## Thumbnail/g)).toHaveLength(3);
});

test("lines that are not a page are refused", () => {
  expect(() => withThumbnailPage(parsePlaylistText(CAST), "    text t1 \"unclosed x 1")).toThrow();
});

import { takeThumbnails, THUMBNAIL_REQUEST_NOTE } from "../src/llm/thumbnail";
import { validateSpec } from "../src/spec/schema";

const PAGE = (word: string) => ({
  elements: [
    { id: "house", type: "icon", of: "house", set: "twemoji", icon_look: "picture", x: 260, y: 470, size: 300 },
    { id: "b", type: "thumb", kind: "band", text: word },
  ],
});

test("the cast-writing reply's thumbnails are taken off before validation and become ready pages", () => {
  const reply: Record<string, unknown> = { title: "Why prices rose", elements: [], thumbnails: [PAGE("One"), PAGE("Two"), PAGE("Three")] };
  const pages = takeThumbnails(reply, (s) => validateSpec(s).ok);
  expect("thumbnails" in reply).toBe(false);
  expect(pages).toHaveLength(3);
  expect(pages.every((p) => p.role === "thumbnail" && p.page?.valign === "none")).toBe(true);
  expect(pages.map((p) => (p.elements?.[1] as { text?: string }).text)).toEqual(["One", "Two", "Three"]);
  // A single `thumbnail` is read too.
  expect(takeThumbnails({ thumbnail: PAGE("Solo") }, (s) => validateSpec(s).ok)).toHaveLength(1);
});

test("missing or invalid thumbnails are dropped, never fatal, and still taken off", () => {
  expect(takeThumbnails({ title: "x" }, () => true)).toEqual([]);
  const bad: Record<string, unknown> = { thumbnails: [{ elements: [{ id: "x", type: "thumb", kind: "sparkle" }] }, PAGE("Fine"), "a picture"] };
  expect(takeThumbnails(bad, (s) => validateSpec(s).ok)).toHaveLength(1);
  expect("thumbnails" in bad).toBe(false);
});

test("the request note asks for three different thumbnails in the reply's own JSON", () => {
  expect(THUMBNAIL_REQUEST_NOTE).toContain('"thumbnails"');
  expect(THUMBNAIL_REQUEST_NOTE).toContain("different hook AND a different main picture");
  expect(THUMBNAIL_REQUEST_NOTE).toContain('"kind": "band"');
});
