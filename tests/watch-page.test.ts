// drawcast.app/w/<name>: the edge's head, the sitemap, and the app's route.
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { metaFromCatalogue, sitemapXml, watchHead, watchName } from "../netlify/lib/watch-page.mts";
import { listedNames } from "../netlify/functions/sitemap.mts";
import { watchPathHash } from "../src/names";

const INDEX = readFileSync("index.html", "utf8");

describe("watch address", () => {
  test("paths that are names, and nothing else", () => {
    expect(watchName("/w/moon")).toBe("moon");
    expect(watchName("/w/Spanish/03/")).toBe("spanish/3");
    expect(watchName("/w/browse")).toBeNull(); // reserved
    expect(watchName("/w/a/b/c")).toBeNull();
    expect(watchName("/x/moon")).toBeNull();
  });
  test("the app turns the path into the hash it already plays, keeping the address's hash", () => {
    expect(watchPathHash("/w/moon", "")).toBe("#moon");
    expect(watchPathHash("/w/spanish/2", "#mode=silent")).toBe("#spanish/2&mode=silent");
    expect(watchPathHash("/", "#moon")).toBeNull();
    expect(watchPathHash("/w/create", "")).toBeNull();
  });
  test("the head: base first, title, card, canonical to the author's door page", () => {
    const meta = metaFromCatalogue({ items: [{ kind: "cast", name: "moon", title: "Why the <Moon> has phases", owner: "hmelberg", page: "https://hmelberg.github.io/drawcast-library/casts/moon.html", tags: ["astronomy"] }] }, "moon");
    const out = watchHead(INDEX, "moon", meta);
    expect(out).toMatch(/<head>\s*<base href="\/" \/>/);
    expect(out).toContain("<title>Why the &lt;Moon&gt; has phases · drawcast</title>");
    expect(out).toContain('<meta property="og:image" content="https://drawcast.app/card/moon.png" />');
    expect(out).toContain('<link rel="canonical" href="https://hmelberg.github.io/drawcast-library/casts/moon.html" />');
    expect(out).toContain('content="https://drawcast.app/w/moon"');
    expect(out).toContain("About astronomy.");
    expect(out.match(/<title>/g)).toHaveLength(1);
    // A folder or index page is a listing, never the canonical.
    for (const page of ["https://hmelberg.github.io/drawcast-library/casts/", "https://x.github.io/r/index.html"]) {
      expect(watchHead(INDEX, "moon", { title: "M", page })).toContain('<link rel="canonical" href="https://drawcast.app/w/moon" />');
    }
    expect(out.match(/name="description"/g)).toHaveLength(1);
  });
  test("unknown, private or unreachable: still a working page, canonical to itself", () => {
    expect(metaFromCatalogue({ items: [{ name: "moon", title: "x", private: true }] }, "moon")).toBeNull();
    const out = watchHead(INDEX, "spanish/2", null);
    expect(out).toContain('<base href="/" />');
    expect(out).toContain("<title>spanish · drawcast</title>");
    expect(out).toContain('<link rel="canonical" href="https://drawcast.app/w/spanish/2" />');
  });
  test("sitemap: the front page and every listed public name, pages followed", async () => {
    const pages = [
      { items: [{ name: "a", updated: "2026-10-01T10:00:00" }, { name: "p", private: true }], more: true },
      { items: [{ name: "b" }], more: false },
    ];
    let n = 0;
    const names = await listedNames((async () => new Response(JSON.stringify(pages[n++]))) as typeof fetch);
    expect(names).toEqual([{ name: "a", updated: "2026-10-01T10:00:00" }, { name: "b", updated: null }]);
    const xml = sitemapXml(names);
    expect(xml).toContain("<loc>https://drawcast.app/</loc>");
    expect(xml).toContain("<loc>https://drawcast.app/w/a</loc><lastmod>2026-10-01</lastmod>");
    expect(xml).not.toContain("/w/p");
  });
});

import { watchDescription } from "../netlify/lib/watch-page.mts";
test("the description reads as a sentence", () => {
  expect(watchDescription({ title: "x", owner: "hmelberg", tags: ["mathematics"] })).toBe("A drawcast by hmelberg: a drawn explanation you can watch and play with. About mathematics.");
  expect(watchDescription({ title: "x", kind: "course", lectures: 5 })).toBe("A drawcast course in 5 lectures: drawn explanations you can watch and play with.");
});
