// The front page (bare drawcast.app, src/home.ts + src/home/model.ts): its
// pure half — cards, formats, curated list, search, topic rows — and the
// routing that puts it at the bare address with the editor at #create.
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import type { CatalogueItem } from "../src/catalogue";
import { isNameHash, normalizeName } from "../src/names";
import {
  cardFromCatalogue,
  cardFromFeatured,
  FORMAT_CHIPS,
  homeHref,
  matchesSearch,
  mergeCards,
  parseFeatured,
  tagRows,
  thumbUrl,
  upNext,
  type FeaturedEntry,
} from "../src/home/model";

const item = (over: Partial<CatalogueItem> = {}): CatalogueItem => ({
  kind: "cast",
  title: "Supply and demand",
  name: "supply-demand",
  owner: "hmelberg",
  lectures: 1,
  updated: "2026-10-01T10:00:00+00:00",
  private: false,
  ...over,
});

describe("the curated list", () => {
  test("keeps well-formed entries, normalises names and tags, drops the rest", () => {
    const out = parseFeatured([
      { name: "QALY-Intro", title: "What is a QALY?", format: "drawcast", tags: [" Health ", "economics", 3] },
      { name: "qaly-intro", title: "dup", format: "quiz" }, // same name again
      { name: "gh-x", title: "reserved", format: "drawcast" },
      { name: "create", title: "the editor's address", format: "drawcast" },
      { name: "ok", title: "no format" },
      { name: "ok2", title: "bad format", format: "video" },
      { name: "qaly-lectures", title: "A course", format: "course", lectures: 5, owner: "ann" },
      null,
      "nonsense",
    ]);
    expect(out).toEqual([
      { name: "qaly-intro", title: "What is a QALY?", format: "drawcast", tags: ["health", "economics"] },
      { name: "qaly-lectures", title: "A course", format: "course", tags: [], owner: "ann", lectures: 5 },
    ]);
    expect(parseFeatured({ not: "a list" })).toEqual([]);
  });
  test("the shipped list parses whole — nothing in it is silently dropped", () => {
    const raw = JSON.parse(readFileSync(new URL("../src/home/featured.json", import.meta.url), "utf8")) as unknown[];
    expect(parseFeatured(raw)).toHaveLength(raw.length);
  });
});

describe("cards", () => {
  const featured = new Map<string, FeaturedEntry>([["supply-demand", { name: "supply-demand", title: "Curated title", format: "quiz", tags: ["economics"] }]]);
  test("a catalogue cast takes its format and tags from the curated list when curated", () => {
    expect(cardFromCatalogue(item(), featured)).toEqual({
      name: "supply-demand",
      title: "Supply and demand",
      owner: "hmelberg",
      format: "quiz",
      meta: "updated 2026-10-01",
      private: false,
      tags: ["economics"],
    });
  });
  test("an uncurated cast has no format yet; a course is always a Course, with its lectures", () => {
    expect(cardFromCatalogue(item({ name: "other" }), featured).format).toBeUndefined();
    const c = cardFromCatalogue(item({ kind: "course", name: "qaly", lectures: 5 }), featured);
    expect(c.format).toBe("course");
    expect(c.meta).toBe("5 lectures · updated 2026-10-01");
  });
  test("an untitled item falls back to the curated title, then its name", () => {
    expect(cardFromCatalogue(item({ title: "" }), featured).title).toBe("Curated title");
    expect(cardFromCatalogue(item({ title: "", name: "bare" }), featured).title).toBe("bare");
  });
  test("a curated course says its lectures; links stay on this page; pictures come from the card function", () => {
    expect(cardFromFeatured({ name: "c", title: "C", format: "course", tags: [], lectures: 1 }).meta).toBe("1 lecture");
    expect(homeHref("qaly-intro")).toBe("#qaly-intro");
    expect(thumbUrl("qaly-intro")).toBe("https://drawcast.app/card/qaly-intro.png");
  });
  test("merging keeps the first card for a name — curated wording wins", () => {
    const a = cardFromFeatured({ name: "x", title: "Curated", format: "drawcast", tags: [] });
    const b = cardFromCatalogue(item({ name: "x", title: "Catalogue" }), new Map());
    const c = cardFromCatalogue(item({ name: "y" }), new Map());
    expect(mergeCards([a], [b, c]).map((k) => k.title)).toEqual(["Curated", "Supply and demand"]);
  });
});

describe("search and topic rows", () => {
  const card = cardFromFeatured({ name: "q", title: "What is a QALY?", format: "drawcast", tags: ["health economics"] });
  test("every word must appear in the title or a tag, any case", () => {
    expect(matchesSearch(card, "qaly")).toBe(true);
    expect(matchesSearch(card, "QALY health")).toBe(true);
    expect(matchesSearch(card, "qaly vaccine")).toBe(false);
    expect(matchesSearch(card, "  ")).toBe(true);
  });
  test("a topic row is a tag two or more curated drawcasts share, most used first", () => {
    const e = (name: string, tags: string[]): FeaturedEntry => ({ name, title: name, format: "drawcast", tags });
    const rows = tagRows([e("a", ["health", "stats"]), e("b", ["health"]), e("c", ["stats", "health"]), e("d", ["solo"])]);
    expect(rows.map((r) => [r.tag, r.entries.map((x) => x.name)])).toEqual([
      ["health", ["a", "b", "c"]],
      ["stats", ["a", "c"]],
    ]);
  });
  test("the chips: All, the three formats, and Courses", () => {
    expect(FORMAT_CHIPS.map((c) => c.label)).toEqual(["All", "Drawcasts", "Quiz", "Xplanations", "Courses"]);
  });
});

describe("routing", () => {
  const entry = readFileSync(new URL("../src/entry.ts", import.meta.url), "utf8");
  const main = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
  const home = readFileSync(new URL("../src/home.ts", import.meta.url), "utf8");
  test("bare drawcast.app is the front page, checked before every other route", () => {
    const at = entry.indexOf('if (hash === "" || hash === "#") {');
    expect(at).toBeGreaterThan(0);
    expect(entry.slice(at, at + 200)).toContain('await import("./home")');
    expect(at).toBeLessThan(entry.indexOf('hash === "#browse"'));
  });
  test("#create is the editor: a reserved name, so it falls through to the app", () => {
    expect(normalizeName("create")).toBeNull();
    expect(isNameHash("#create")).toBe(false);
    expect(main).toContain('showMode(location.hash === "#create" ? "editor" : settings.uiMode);');
  });
  test("the front page never loads the editor", () => {
    expect(home).not.toMatch(/from "\.\/main"|import\("\.\/main"\)/);
    expect(home).toContain('href: "#create"');
  });
});

describe("Up next (the watch page)", () => {
  const e = (name: string, format: FeaturedEntry["format"], tags: string[]): FeaturedEntry => ({ name, title: name, format, tags });
  const featured = [e("a", "drawcast", ["physics"]), e("b", "quiz", ["health"]), e("c", "drawcast", ["health", "statistics"]), e("d", "drawcast", ["health"]), e("me", "drawcast", ["health", "statistics"])];
  test("shared topic tags first, then the same format, ties in curated order; never the one being watched", () => {
    expect(upNext("me", featured, []).map((c) => c.name)).toEqual(["c", "d", "b", "a"]);
  });
  test("a lecture (name/3) relates through its course's name", () => {
    expect(upNext("me/3", featured, []).map((c) => c.name)[0]).toBe("c");
  });
  test("an uncurated drawcast gets the curated list in order, then the newest, without duplicates or itself", () => {
    const newest = [cardFromCatalogue(item({ name: "x" }), new Map()), cardFromCatalogue(item({ name: "a" }), new Map()), cardFromCatalogue(item({ name: "zz" }), new Map())];
    expect(upNext("zz", featured, newest).map((c) => c.name)).toEqual(["a", "b", "c", "d", "me", "x"]);
    expect(upNext(undefined, featured, [], 2)).toHaveLength(2);
  });
});

describe("the watch page wiring", () => {
  const viewer = readFileSync(new URL("../src/viewer.ts", import.meta.url), "utf8");
  test("the viewer mounts it on demand, never for a page carrying its own cast", () => {
    expect(viewer).toContain('if (req.embedded === undefined) void import("./home/watch").then((m) => m.mountWatch(app, { name: req.watchName })).catch(() => undefined);');
  });
  test("a name link tells it which drawcast it is", () => {
    expect(viewer).toContain("await runViewer({ ...req, watchName: name });");
  });
});

describe("the curated library's code is trusted by its bytes", () => {
  const trust = JSON.parse(readFileSync(new URL("../src/home/trusted-code.json", import.meta.url), "utf8")) as { keys: string[] };
  const viewer = readFileSync(new URL("../src/viewer.ts", import.meta.url), "utf8");
  test("the list holds code-trust keys only (content fingerprints, never a source or a name)", () => {
    expect(trust.keys.length).toBeGreaterThan(0);
    for (const k of trust.keys) expect(k).toMatch(/^[ct]:[0-9a-f]{32}$/);
  });
  test("the viewer trusts them for this page only, before the gate asks", () => {
    expect(viewer).toContain("trustKeys(libraryTrust.keys, { persist: false });");
    expect(viewer.indexOf("trustKeys(libraryTrust.keys")).toBeLessThan(viewer.indexOf("const codeAllowed = await gateSpecs("));
  });
});

describe("the ☰ menu", () => {
  const ui = readFileSync(new URL("../src/home/ui.ts", import.meta.url), "utf8");
  test("the top bar opens it from a ☰ button before the logo, on the front page and the watch page alike", () => {
    expect(ui).toMatch(/h\("div", \{ class: "home-top-left" \}, menuBtn, h\("a", \{ class: "home-brand"/);
    expect(ui).toContain('"aria-label": "Menu"');
  });
  test("it offers only places that exist: home, explore, the formats, topics, create, sign in or out, help", () => {
    for (const s of ['link("./", "Home"', 'link("#browse", "Explore everything")', "`./?f=${c.id}`", "`./?q=${encodeURIComponent(t)}`", 'link("#create", "＋ Create a drawcast")', "signInUrl(location.href)", '"Sign out"', 'link("./help.html", "Help")']) expect(ui).toContain(s);
    expect(ui).not.toMatch(/Liked|History|Subscriptions"/);
  });
  test("Escape and the backdrop close it, and focus goes back to the button", () => {
    expect(ui).toContain('if (e.key === "Escape") close();');
    expect(ui).toContain('backdrop.addEventListener("click", close);');
    expect(ui).toContain("opener?.focus();");
  });
});
