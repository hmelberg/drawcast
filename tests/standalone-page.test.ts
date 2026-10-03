// A drawcast as its own page: the cast inside a <script> block the browser
// never runs, read back by the player (play.ts) exactly as it was written.
import { describe, expect, test } from "vitest";
import { CAST_BLOCK_ID, PLAYER_URL, castPageHtml, embedCastText, readEmbeddedCast } from "../src/standalone/page";
import { castFromBlock } from "../src/play";
import { ghRefFrom, viewerOptions } from "../src/viewer";

/** What the HTML parser leaves as the block's textContent: everything up to the first `</script`. */
function blockText(html: string): string {
  const open = new RegExp(`<script type="text/x-drawcast" id="${CAST_BLOCK_ID}"[^>]*>`).exec(html)!;
  const rest = html.slice(open.index + open[0].length);
  return rest.slice(0, rest.search(/<\/script/i));
}

const tricky = [
  "title: plain\ncommands: []\n",
  "speak: the tag </script> ends a script block",
  "speak: so does </SCRIPT  > in capitals",
  "speak: an HTML comment <!-- opens one",
  "speak: a backslash after a bracket <\\ stays",
  "speak: already escaped-looking <\\/script and <\\!-- and <\\\\ survive",
  "",
  "\n\nleading and trailing newlines\n\n",
];

describe("embedding", () => {
  test.each(tricky)("round-trips %j", (text) => {
    expect(readEmbeddedCast(embedCastText(text))).toBe(text);
  });

  test.each(tricky)("never ends the block early: %j", (text) => {
    const html = castPageHtml({ text, title: "t" });
    expect(castFromBlock(blockText(html))).toBe(text);
  });

  test("an ordinary cast is left exactly as written", () => {
    const text = "title: Supply and demand\n# a comment\ndraw: curve <- here\n";
    expect(embedCastText(text)).toBe(text);
  });
});

describe("castPageHtml", () => {
  const html = castPageHtml({ text: "title: x\n", title: 'Prices & "markets" <today>', subtitle: "Why", url: "https://a.github.io/r/x.html", image: "https://a.github.io/r/x.png", from: { owner: "a", repo: "r", path: "x.cast" } });
  test("loads the player from drawcast.app", () => {
    expect(PLAYER_URL).toBe("https://drawcast.app/play.js");
    expect(html).toContain(`<script type="module" src="${PLAYER_URL}" crossorigin></script>`);
  });
  test("escapes the title everywhere it appears", () => {
    expect(html).toContain("<title>Prices &amp; &quot;markets&quot; &lt;today&gt;</title>");
    expect(html).not.toContain("<today>");
  });
  test("carries the link card and the GitHub copy it stands for", () => {
    expect(html).toContain('<meta property="og:url" content="https://a.github.io/r/x.html">');
    expect(html).toContain('<meta property="og:image" content="https://a.github.io/r/x.png">');
    expect(html).toContain('<meta property="og:description" content="Why">');
    expect(html).toContain('data-gh="a/r/x.cast"');
  });
  test("has the mount point the viewer draws into", () => {
    expect(html).toContain('<div id="app"></div>');
  });
});

describe("what the player reads from the page", () => {
  test("data-gh is a GitHub reference only when it is one", () => {
    expect(ghRefFrom("a/r/casts/x.cast")).toEqual({ owner: "a", repo: "r", path: "casts/x.cast" });
    expect(ghRefFrom("a/r/../x.cast")).toBeNull();
    expect(ghRefFrom("a/r/x.exe")).toBeNull();
    expect(ghRefFrom(undefined)).toBeNull();
  });
  test("playback options come from the page's own hash", () => {
    const o = viewerOptions(new URLSearchParams("mode=silent&speed=1.5&style=sketchy"));
    expect(o).toMatchObject({ mode: "silent", speed: 1.5, style: "sketchy" });
  });
});
