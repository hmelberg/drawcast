// The catalogue (registry deliveries 3–4, task 9): src/catalogue.ts's pure
// helpers get real, DOM-free tests (this suite's vitest environment is
// plain node — vite.config.ts, no jsdom); runCatalogue's DOM-building half
// is pinned against the source, the same way share.ts's Private/Listed
// blocks are (tests/share-private.test.ts, tests/share-listed.test.ts).

import { readFileSync } from "node:fs";
import { describe, expect, test, vi } from "vitest";
import { catalogueHref, catalogueMeta, catalogueQueryString, fetchCatalogue, type CatalogueItem } from "../src/catalogue";

const catalogue = readFileSync(new URL("../src/catalogue.ts", import.meta.url), "utf8");

function fetchReturning(status: number, body: unknown): typeof fetch {
  return vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
}
const throwing = (): typeof fetch =>
  vi.fn(async () => {
    throw new Error("offline");
  }) as unknown as typeof fetch;
const calls = (f: typeof fetch) => (f as unknown as ReturnType<typeof vi.fn>).mock.calls as [string, RequestInit][];

const COURSE: CatalogueItem = {
  kind: "course",
  title: "Micro I",
  name: "micro-i",
  owner: "hmelberg",
  lectures: 6,
  updated: "2026-09-20",
  private: false,
};

describe("catalogueQueryString — pure query building", () => {
  test("no filters at all — empty string", () => {
    expect(catalogueQueryString({})).toBe("");
  });

  test("q is trimmed and URL-encoded", () => {
    expect(catalogueQueryString({ q: "  supply & demand  " })).toBe("?q=supply+%26+demand");
  });

  test("q longer than 80 chars is capped, never sent whole", () => {
    const long = "x".repeat(200);
    const qs = catalogueQueryString({ q: long });
    expect(qs).toBe(`?q=${"x".repeat(80)}`);
  });

  test("kind rides through only when non-empty", () => {
    expect(catalogueQueryString({ kind: "course" })).toBe("?kind=course");
    expect(catalogueQueryString({ kind: "" })).toBe("");
  });

  test("page is sent only when it isn't the first page", () => {
    expect(catalogueQueryString({ page: 1 })).toBe("");
    expect(catalogueQueryString({ page: 2 })).toBe("?page=2");
  });

  test("all three together", () => {
    expect(catalogueQueryString({ q: "tax", kind: "cast", page: 3 })).toBe("?q=tax&kind=cast&page=3");
  });
});

describe("catalogueHref — the pretty link a card points at", () => {
  test("drawcast.app/#<name>, exactly what a bought/free name already resolves at", () => {
    expect(catalogueHref({ name: "micro-i" })).toBe("https://drawcast.app/#micro-i");
  });
});

describe("catalogueMeta — the one line under a card's title", () => {
  test("a course shows its lecture count", () => {
    expect(catalogueMeta({ kind: "course", lectures: 6, updated: "2026-09-20" })).toBe("Course · 6 lectures · updated 2026-09-20");
  });

  test("singular lecture", () => {
    expect(catalogueMeta({ kind: "course", lectures: 1, updated: "2026-09-20" })).toBe("Course · 1 lecture · updated 2026-09-20");
  });

  test("a cast never shows a lecture count", () => {
    expect(catalogueMeta({ kind: "cast", lectures: 1, updated: "2026-09-20" })).toBe("Drawcast · updated 2026-09-20");
  });
});

describe("fetchCatalogue", () => {
  test("GETs /catalogue with the query string, bounded, and maps a clean 200", async () => {
    const f = fetchReturning(200, { items: [COURSE], page: 1, more: true });
    const out = await fetchCatalogue("https://drawcast.anvil.app", { q: "micro", kind: "course" }, f);
    expect(out).toEqual({ items: [COURSE], page: 1, more: true });
    const [url, init] = calls(f)[0];
    expect(url).toBe("https://drawcast.anvil.app/_/api/catalogue?q=micro&kind=course");
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  test("a malformed row is dropped, never shown with missing fields", async () => {
    const bad = { kind: "course", title: "T" }; // no name/owner/updated
    const f = fetchReturning(200, { items: [COURSE, bad], page: 1, more: false });
    const out = await fetchCatalogue("https://a", {}, f);
    expect(out).toEqual({ items: [COURSE], page: 1, more: false });
  });

  test("defaults: lectures 1 when absent/zero, private false, page 1, more false", async () => {
    const f = fetchReturning(200, { items: [{ kind: "cast", title: "T", name: "t", owner: "o", updated: "2026-09-01" }] });
    const out = await fetchCatalogue("https://a", {}, f);
    expect(out).toEqual({ items: [{ kind: "cast", title: "T", name: "t", owner: "o", updated: "2026-09-01", lectures: 1, private: false }], page: 1, more: false });
  });

  test("the private badge field rides through when true", async () => {
    const priv = { ...COURSE, private: true };
    const f = fetchReturning(200, { items: [priv] });
    const out = await fetchCatalogue("https://a", {}, f);
    expect(out).toEqual({ items: [priv], page: 1, more: false });
  });

  test("a body with no items array, or any non-200, is 'error' — never a throw", async () => {
    expect(await fetchCatalogue("https://a", {}, fetchReturning(200, {}))).toBe("error");
    expect(await fetchCatalogue("https://a", {}, fetchReturning(400, {}))).toBe("error");
    expect(await fetchCatalogue("https://a", {}, fetchReturning(500, {}))).toBe("error");
  });

  test("a network error never throws — error", async () => {
    await expect(fetchCatalogue("https://a", {}, throwing())).resolves.toBe("error");
  });
});

describe("runCatalogue — page structure and search behaviour (source-pinned, no jsdom)", () => {
  const fn = catalogue.slice(catalogue.indexOf("export async function runCatalogue("), catalogue.length);

  test("heading, search input, kind select (All/Courses/Drawcasts) and a Search button", () => {
    expect(fn).toContain('h("h1", { class: "cat-heading" }, "drawcast catalogue")');
    expect(fn).toMatch(/\["", "All"\],\s*\["course", "Courses"\],\s*\["cast", "Drawcasts"\],/);
    expect(fn).toContain('h("button", { class: "cat-search-btn", type: "submit" }, "Search")');
  });

  test("search fires on the form's submit and the kind select's change — never a keystroke listener", () => {
    expect(fn).toContain('form.addEventListener("submit"');
    expect(fn).toContain('kindSelect.addEventListener("change"');
    expect(fn).not.toContain('qInput.addEventListener("input"');
    expect(fn).not.toContain('qInput.addEventListener("keyup"');
    expect(fn).not.toContain('qInput.addEventListener("keydown"');
  });

  test("the empty and error states use the exact required wording", () => {
    expect(fn).toContain('"Nothing listed yet."');
    expect(fn).toContain(`"The catalogue can't be reached right now."`);
  });

  test("More pages: a button wired to click, hidden unless the answer says more", () => {
    expect(fn).toContain('h("button", { class: "cat-more", type: "button" }, "More")');
    expect(fn).toContain('moreBtn.addEventListener("click"');
    expect(fn).toContain("moreRow.hidden = !answer.more;");
  });

  test("mounts into document.body, viewer.ts's own pattern — never #app, which the editor owns", () => {
    expect(fn).toContain("document.body.append(root);");
    expect(fn).not.toContain('getElementById("app")');
  });

  test("builds every card through h(), never innerHTML with server text", () => {
    expect(catalogue).not.toMatch(/\.innerHTML\s*=/);
  });

  test("a stale in-flight search can never clobber a newer one (superseded guard, same idiom as Private's)", () => {
    expect(fn).toContain("const my = ++loadToken;");
    expect(fn).toContain("if (my !== loadToken) return;");
  });
});

describe("card fields never carry anything sensitive", () => {
  test("CatalogueItem has no key/item_key/email FIELD — only what catalogue_entry (server_code/registry.py) is meant to answer (comments may still discuss why, in prose)", () => {
    const raw = catalogue.slice(catalogue.indexOf("export interface CatalogueItem"), catalogue.indexOf("export interface CatalogueAnswer"));
    // Strip comments (line and block) before checking for actual FIELD
    // declarations — the doc comments legitimately discuss "key"/"email" in
    // prose, explaining what is deliberately absent.
    const iface = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(iface).not.toMatch(/\bkey\b/);
    expect(iface).not.toMatch(/email/i);
    expect(iface).not.toMatch(/item_key/);
  });
});

describe("a link to the catalogue from the app (task 9's own requirement)", () => {
  test("public/help.html links #browse — a nav entry plus a paragraph, following how every other help section links out", () => {
    const help = readFileSync(new URL("../public/help.html", import.meta.url), "utf8");
    expect(help).toContain('<a href="#catalogue">Browse the catalogue</a>');
    expect(help).toContain('<h2 id="catalogue">Browse the catalogue</h2>');
    expect(help).toContain('href="./#browse"');
  });

  test("the editor's sidebar links out to #browse, right beside Help — same target=_blank/rel=noopener pattern", () => {
    const main = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
    expect(main).toContain('h("a", { class: "sidebar-row", href: "./help.html", target: "_blank", rel: "noopener" }, "Help")');
    expect(main).toContain('h("a", { class: "sidebar-row", href: "#browse", target: "_blank", rel: "noopener" }, "Browse the catalogue")');
  });
});
