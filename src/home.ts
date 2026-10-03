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
const featuredByName = new Map(featured.map((e) => [e.name, e]));

/** One catalogue page per query, kept for this visit: switching chips back
 *  and forth never asks the registry twice. */
const cache = new Map<string, Promise<CatalogueItem[] | "error">>();
type Format = "drawcast" | "quiz" | "xplanation";
function catalogue(kind: CatalogueFilterKind, q = "", extra: { format?: Format; names?: string[] } = {}): Promise<CatalogueItem[] | "error"> {
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
let popularPromise: Promise<CatalogueItem[]> | null = null;
function popular(): Promise<CatalogueItem[]> {
  popularPromise ??= fetchRanks().then(async (raw) => {
    const ranks = rankByBase(raw).slice(0, 50);
    if (!ranks.length) return [];
    const items = await catalogue("", "", { names: ranks.map((r) => r.name) });
    return items === "error" ? [] : popularItems(ranks, items);
  });
  return popularPromise;
}

export function runHome(): void {
  document.body.classList.add("home-body");
  const params = new URLSearchParams(location.search);
  let q = params.get("q") ?? "";
  let chip = (FORMAT_CHIPS.some((c) => c.id === params.get("f")) ? params.get("f") : "") as "" | HomeFormat;

  const { root: top } = topBar(
    q,
    (value) => {
      q = value;
      void render();
    },
    { topics: tagRows(featured).map((r) => r.tag) },
  );
  const chipButtons = FORMAT_CHIPS.map((c) => {
    const b = h("button", { type: "button", class: "home-chip", "aria-pressed": String(c.id === chip) }, c.label) as HTMLButtonElement;
    b.addEventListener("click", () => {
      chip = c.id;
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
  );
  document.body.append(top, chips, main, foot);


  let token = 0;
  async function render(): Promise<void> {
    const my = ++token;
    // The address keeps what is shown, so a reload or a shared link reopens it.
    const next = new URLSearchParams();
    if (q) next.set("q", q);
    if (chip) next.set("f", chip);
    history.replaceState(null, "", `${location.pathname}${next.toString() ? `?${next}` : ""}`);
    main.replaceChildren(note("Loading…"));
    const parts = await view();
    if (my !== token) return; // superseded by a newer chip or search
    const shown = parts.filter((p): p is HTMLElement => p !== null);
    main.replaceChildren(...(shown.length ? shown : [note(q ? `Nothing found for “${q}”.` : "Nothing published here yet."), h("a", { class: "home-create home-create-big", href: "#create" }, "Make the first one")]));
  }

  const byFormat = (cards: HomeCard[]): HomeCard[] => (chip ? cards.filter((c) => c.format === chip) : cards);
  const featuredCards = (): HomeCard[] => featured.map(cardFromFeatured);
  const fromCatalogue = (items: CatalogueItem[] | "error"): HomeCard[] => (items === "error" ? [] : items.map((i) => cardFromCatalogue(i, featuredByName)));

  async function view(): Promise<(HTMLElement | null)[]> {
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

  void render();
}
