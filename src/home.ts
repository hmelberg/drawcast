// The front page (2026-10-03): bare drawcast.app, a place to see and find
// drawcasts, like a video site — rows of pictures, format chips, search —
// with the editor one click away (Create → #create). Its own chunk: it never
// loads the editor, so the front page costs what a watch page costs.
//
// Two sources, merged (home/model.ts): the curated list (home/featured.json —
// published names, chosen by hand, with format and tags) and the public
// catalogue (catalogue.ts, the registry's listing — newest first, courses or
// drawcasts). State lives in the query string (?q=…&f=…), never in the hash:
// a hash is a drawcast's address here.

import "./styles.css";
import { fetchCatalogue, type CatalogueFilterKind, type CatalogueItem } from "./catalogue";
import { DEFAULT_ENROLL_API } from "./learn";
import { h } from "./ui/dom";
import featuredJson from "./home/featured.json";
import { note, section, topBar } from "./home/ui";
import { fetchRanks } from "./home/rank";
import { byNewest, byScore, feedQuery, fetchFeed, sameFeed, storedFeed, topicRows, type FeedScore, type HomeFeed } from "./home/feed";
import { clearHistory, fetchMyList, MY_LISTS, parseMyList, readHistory, type MyList } from "./home/my-lists";
import { getToken, setToken, signInUrl } from "./account";
import { parseYou, youView, type YouPage } from "./home/you";
import {
  cardFromCatalogue,
  cardFromFeatured,
  FORMAT_CHIPS,
  matchesSearch,
  mergeCards,
  parseFeatured,
  popularItems,
  rankByBase,
  tagRows,
  type HomeCard,
  type HomeFormat,
} from "./home/model";

const featured = parseFeatured(featuredJson);
/** How many cards a row shows before "All N" (a row is a glance, not the catalogue). */
const FEATURED_ROW = 12;
const TOPIC_ROW = 8;
/** Fewer than this and a ranked row is left out: a row is a choice, not two cards. */
const ROW_MIN = 4;
const featuredByName = new Map(featured.map((e) => [e.name, e]));

/** The front page's data (home-cards round, 2026-10-05): the one feed
 *  (home/feed.ts) — kept from the last visit, so the page draws at once, and
 *  asked again behind it. Only when there is no feed at all does the page ask
 *  the registry itself, one catalogue page per query, kept for this visit. */
let feed: HomeFeed | null = storedFeed();
const freshFeed: Promise<HomeFeed | null> = fetchFeed();
async function currentFeed(): Promise<HomeFeed | null> {
  return feed ?? (feed = await freshFeed);
}

const cache = new Map<string, Promise<CatalogueItem[] | "error">>();
type Format = "drawcast" | "quiz" | "xplanation";
async function catalogue(kind: CatalogueFilterKind, q = "", extra: { format?: Format; names?: string[] } = {}): Promise<CatalogueItem[] | "error"> {
  const f = await currentFeed();
  if (f) return feedQuery(f.items, { kind, q, ...extra });
  const key = `${kind}|${q}|${extra.format ?? ""}|${(extra.names ?? []).join(",")}`;
  let p = cache.get(key);
  if (!p) {
    p = fetchCatalogue(DEFAULT_ENROLL_API, { kind, q, ...extra }).then((a) => (a === "error" ? "error" : a.items));
    cache.set(key, p);
  }
  return p;
}

/** The Popular row's items: the 30-day visit ranks (by drawcast, lectures
 *  counted for their course), then the catalogue's answer for exactly those
 *  names — so only listed, public items show — ordered by visits plus likes. */
async function popular(): Promise<CatalogueItem[]> {
  const f = await currentFeed();
  const ranks = rankByBase(f ? f.ranks : await fetchRanks()).slice(0, 50);
  if (!ranks.length) return [];
  const items = await catalogue("", "", { names: ranks.map((r) => r.name) });
  return items === "error" ? [] : popularItems(ranks, items);
}

export function runHome(): void {
  document.body.classList.add("home-body");
  const params = new URLSearchParams(location.search);
  let q = params.get("q") ?? "";
  let chip = (FORMAT_CHIPS.some((c) => c.id === params.get("f")) ? params.get("f") : "") as "" | HomeFormat;
  // ?list=saved|liked|history (save round, 2026-10-04): the viewer's own list instead of the rows.
  let list: MyList | null = parseMyList(params.get("list"));
  // ?you=content|courses|credit (account round delivery 2): your own pages.
  let you: YouPage | null = parseYou(params.get("you"));
  // Stripe comes back to ?you=credit with the outcome in the fragment
  // (entry.ts routes it here); render() rewrites the address, so take it now.
  let returned = you ? location.hash : "";

  const { root: top } = topBar(
    q,
    (value) => {
      q = value;
      void render();
    },
    { topics: tagRows(featured).map((r) => r.tag) },
  );
  const chipButtons = FORMAT_CHIPS.map((c) => {
    const b = h("button", { type: "button", class: "home-chip", "aria-pressed": String(!list && !you && c.id === chip) }, c.label) as HTMLButtonElement;
    b.addEventListener("click", () => {
      chip = c.id;
      list = null;
      you = null;
      for (const [i, x] of chipButtons.entries()) x.setAttribute("aria-pressed", String(FORMAT_CHIPS[i].id === chip));
      void render();
    });
    return b;
  });
  const chips = h("nav", { class: "home-chips", "aria-label": "Formats" }, ...chipButtons);
  const main = h("main", { class: "home-main" });
  const foot = h(
    "footer",
    { class: "home-foot" },
    h("a", { href: "#browse" }, "Browse everything"),
    " · ",
    h("a", { href: "./help.html" }, "Help"),
    " · ",
    h("a", { href: "#create" }, "Make your own"),
    // The cards' colour icons (card/icons.ts): Twemoji, CC-BY 4.0; the stock chess men (card/stock.ts): OpenMoji, CC BY-SA 4.0.
    h(
      "div",
      { class: "home-credit" },
      "Icons on cards: ",
      h("a", { href: "https://github.com/twitter/twemoji", rel: "noopener" }, "Twemoji"),
      " by Twitter, CC-BY 4.0; ",
      h("a", { href: "https://openmoji.org", rel: "noopener" }, "OpenMoji"),
      ", CC BY-SA 4.0",
    ),
  );
  document.body.append(top, chips, main, foot);


  let token = 0;
  async function render(): Promise<void> {
    const my = ++token;
    // The address keeps what is shown, so a reload or a shared link reopens it.
    const next = new URLSearchParams();
    // A search leaves the list for the front page's own views (a chip does, on its click).
    if (q) list = you = null;
    if (list) next.set("list", list);
    if (you) next.set("you", you);
    if (q) next.set("q", q);
    if (chip) next.set("f", chip);
    history.replaceState(null, "", `${location.pathname}${next.toString() ? `?${next}` : ""}`);
    chips.hidden = you !== null; // your own pages are not the catalogue
    // From a kept feed the page is drawn at once: no "Loading…" flash.
    if (!feed) main.replaceChildren(note("Loading…"));
    const parts = await view();
    if (my !== token) return; // superseded by a newer chip or search
    const shown = parts.filter((p): p is HTMLElement => p !== null);
    main.replaceChildren(...(shown.length ? shown : [note(q ? `Nothing found for “${q}”.` : "Nothing published here yet."), h("a", { class: "home-create home-create-big", href: "#create" }, "Make the first one")]));
  }

  const byFormat = (cards: HomeCard[]): HomeCard[] => (chip ? cards.filter((c) => c.format === chip) : cards);
  const featuredCards = (): HomeCard[] => featured.map(cardFromFeatured);
  const fromCatalogue = (items: CatalogueItem[] | "error"): HomeCard[] => (items === "error" ? [] : items.map((i) => cardFromCatalogue(i, featuredByName)));

  async function listView(which: MyList): Promise<(HTMLElement | null)[]> {
    const meta = MY_LISTS.find((l) => l.id === which)!;
    if (which === "history") {
      const names = readHistory().map((e) => e.name);
      if (!names.length) return [h("h2", { class: "home-list-title" }, meta.label), note(meta.empty)];
      const items = await catalogue("", "", { names });
      // In the order watched; anything unlisted since is simply not there.
      const order = new Map(names.map((n, i) => [n, i]));
      const cards = fromCatalogue(items).sort((a, b) => (order.get(a.name) ?? 99) - (order.get(b.name) ?? 99));
      const clear = h("button", { type: "button", class: "home-more" }, "Clear history") as HTMLButtonElement;
      clear.addEventListener("click", () => {
        clearHistory();
        void render();
      });
      return [section(meta.label, cards, clear) ?? note(meta.empty), items === "error" ? note("The catalogue can't be reached right now.", "error") : null];
    }
    const key = getToken();
    if (!key) return [h("h2", { class: "home-list-title" }, meta.label), note("Sign in to see your list."), h("a", { class: "home-create", href: signInUrl(location.href) }, "Sign in")];
    const items = await fetchMyList(which, key);
    if (items === "signin") {
      setToken("");
      return [h("h2", { class: "home-list-title" }, meta.label), note("Your session has ended — sign in again."), h("a", { class: "home-create", href: signInUrl(location.href) }, "Sign in")];
    }
    if (items === "error") return [h("h2", { class: "home-list-title" }, meta.label), note("Your list can't be reached right now.", "error")];
    return [section(meta.label, fromCatalogue(items)) ?? h("div", {}, h("h2", { class: "home-list-title" }, meta.label), note(meta.empty))];
  }

  async function view(): Promise<(HTMLElement | null)[]> {
    if (you) {
      const r = returned;
      returned = "";
      return youView(you, () => void render(), r);
    }
    if (list) return listView(list);
    const format = chip && chip !== "course" ? chip : undefined;
    if (q) {
      const items = await catalogue(chip === "course" ? "course" : format ? "cast" : "", q, format ? { format } : {});
      const cards = byFormat(mergeCards(featuredCards().filter((c) => matchesSearch(c, q)), fromCatalogue(items)));
      return [section(`Results for “${q}”`, cards), items === "error" ? note("The catalogue can't be reached right now; showing the featured drawcasts only.", "error") : null];
    }
    if (chip === "course") {
      const items = await catalogue("course");
      return [section("Courses", mergeCards(byFormat(featuredCards()), fromCatalogue(items)), h("a", { class: "home-more", href: "#browse&kind=course" }, "All courses")), items === "error" ? note("The catalogue can't be reached right now.", "error") : null];
    }
    if (format) {
      // Drawcasts, Quiz, Xplanations: the curated ones of that format first,
      // then every listed item the registry knows by that format (byFormat
      // also guards against a registry that ignores `format=`).
      const items = await catalogue("cast", "", { format });
      return [section(FORMAT_CHIPS.find((c) => c.id === chip)!.label, byFormat(mergeCards(featuredCards(), fromCatalogue(items))))];
    }
    const ranked = await currentFeed();
    if (ranked?.scores) return rankedRows(ranked.items, ranked.scores);
    const [casts, courses, hot] = await Promise.all([catalogue("cast"), catalogue("course"), popular()]);
    // A row needs a few items to be a row; until then the Featured row stands alone.
    const popularCards = fromCatalogue(hot).slice(0, 12);
    return [
      // The first twelve of the curated list, in its order (home/featured.json
      // is ordered by hand: best first); every one is reachable through the
      // format chips, the topic rows and search.
      section("Featured", featuredCards().slice(0, FEATURED_ROW)),
      popularCards.length >= 4 ? section("Popular", popularCards) : null,
      section("Newest drawcasts", fromCatalogue(casts).slice(0, 12), h("a", { class: "home-more", href: "#browse&kind=cast" }, "More")),
      section("Courses", fromCatalogue(courses).slice(0, 8), h("a", { class: "home-more", href: "#browse&kind=course" }, "All courses")),
      ...tagRows(featured).map((row) =>
        section(
          row.tag[0].toUpperCase() + row.tag.slice(1),
          row.entries.slice(0, TOPIC_ROW).map(cardFromFeatured),
          row.entries.length > TOPIC_ROW ? h("a", { class: "home-more", href: `?q=${encodeURIComponent(row.tag)}` }, `All ${row.entries.length}`) : undefined,
        ),
      ),
      casts === "error" && courses === "error" ? note("The catalogue can't be reached right now.", "error") : null,
    ];
  }

  /**
   * The rows (ranking round, 2026-10-05), from the feed's scores
   * (netlify/lib/rank-score.mts): the curated Featured row first, then
   * Trending (recent likes, finishes and visits), New, Top this month, each
   * format, the levels, and the topics the whole catalogue shares. A row
   * needs ROW_MIN items to show; a public item only.
   */
  function rankedRows(all: CatalogueItem[], scores: Record<string, FeedScore>): (HTMLElement | null)[] {
    const items = all.filter((i) => !i.private);
    const casts = items.filter((i) => i.kind === "cast");
    const cards = (list: CatalogueItem[], n = FEATURED_ROW): HomeCard[] => fromCatalogue(list.slice(0, n));
    const row = (title: string, list: CatalogueItem[], more?: HTMLElement, n = FEATURED_ROW): HTMLElement | null => (list.length >= ROW_MIN ? section(title, cards(list, n), more) : null);
    const moreLink = (href: string, text = "More"): HTMLElement => h("a", { class: "home-more", href }, text);
    const month = byScore(items, scores, "month").filter((i) => (scores[i.name]?.month ?? 0) > 0);
    return [
      section("Featured", featuredCards().slice(0, FEATURED_ROW)),
      row("Trending", byScore(items, scores)),
      row("New", byNewest(casts), moreLink("#browse&kind=cast")),
      row("Top this month", month),
      row("Quizzes", byScore(casts.filter((i) => i.format === "quiz"), scores), moreLink("?f=quiz")),
      row("Courses", byScore(items.filter((i) => i.kind === "course"), scores), moreLink("#browse&kind=course", "All courses"), 8),
      row("Xplanations", byScore(casts.filter((i) => i.format === "xplanation"), scores), moreLink("?f=xplanation")),
      row("Start here", byScore(casts.filter((i) => i.level === "basic"), scores)),
      row("Going deeper", byScore(casts.filter((i) => i.level === "advanced"), scores)),
      ...topicRows(items, scores).map((t) =>
        row(t.tag[0].toUpperCase() + t.tag.slice(1), t.items, t.items.length > TOPIC_ROW ? moreLink(`?q=${encodeURIComponent(t.tag)}`, `All ${t.items.length}`) : undefined, TOPIC_ROW),
      ),
    ];
  }

  void render();
  // A kept feed drew the page; the server's newer one redraws it only if it differs.
  const kept = feed;
  if (kept)
    void freshFeed.then((fresh) => {
      if (!fresh || sameFeed(kept, fresh)) return;
      feed = fresh;
      // Your own pages do not draw from the feed: redrawing them would ask
      // the server again and lose what was typed in their search box.
      if (!you) void render();
    });
}
