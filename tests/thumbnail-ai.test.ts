// "Ask AI for a thumbnail" (2026-10-05): the reply as page lines
// (src/llm/thumbnail.ts) and a playlist's thumbnail page as text and back
// (src/card/page.ts).
import { expect, test } from "vitest";
import { thumbnailBodyOf, thumbnailUser, THUMBNAIL_SYSTEM } from "../src/llm/thumbnail";
import { thumbnailBody, withThumbnailPage } from "../src/card/page";
import { itemsOf, parsePlaylistText, thumbnailItemOf } from "../src/playlist/playlist";

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
    '    icon house size 300 set twemoji x 260 y 470 icon_look picture of "house"\n    text n "+30 %" x 700 y 520 font_size 150\n    thumb b "Demand did it" kind band',
  );
  expect(thumbnailBodyOf("Sorry, I can't.")).toBe("");
  // A keyword with spaces gets the quotes the notation needs.
  expect(thumbnailBodyOf("    icon zap size 260 set twemoji x 850 y 450 icon_look picture of high voltage")).toBe('    icon zap size 260 set twemoji x 850 y 450 icon_look picture of "high voltage"');
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

test("lines that are not a page are refused", () => {
  expect(() => withThumbnailPage(parsePlaylistText(CAST), "    text t1 \"unclosed x 1")).toThrow();
});
