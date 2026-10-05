// The watch page (2026-10-03): a drawcast opened on drawcast.app plays inside
// the site's own frame, like a video page — the top bar (brand, search,
// Create) above, "Up next" beside the player (below it on a phone), and a
// theatre mode that gives the player the full width. Loaded on demand by the
// viewer (viewer.ts), never for a drawcast's own page elsewhere (an author's
// GitHub page or an exported file shows the plain player).

import { fetchCatalogue, type CatalogueItem } from "../catalogue";
import { DEFAULT_ENROLL_API } from "../learn";
import { h } from "../ui/dom";
import featuredJson from "./featured.json";
import { cardFromCatalogue, courseNext, mergeCards, parseFeatured, tagRows, upNext, type HomeCard } from "./model";
import { feedQuery, fetchFeed, storedFeed } from "./feed";
import { reactionControls } from "./react";
import { recordWatch } from "./my-lists";
import { card, topBar } from "./ui";
import { playerMenuSlot } from "../ui/menu-slot";

const THEATRE_KEY = "drawcast:watch-theatre";

function readTheatre(): boolean {
  try {
    return localStorage.getItem(THEATRE_KEY) === "1";
  } catch {
    return false;
  }
}

function saveTheatre(on: boolean): void {
  try {
    localStorage.setItem(THEATRE_KEY, on ? "1" : "0");
  } catch {
    /* a per-viewer convenience; nothing breaks without it */
  }
}

/**
 * Wraps the viewer's `#app` in the watch layout. `name` is the drawcast's
 * name when it was opened by one (#name), which is what "Up next" relates to.
 */
export function mountWatch(app: HTMLElement, opts: { name?: string; lectureTitles?: Promise<string[]> } = {}): void {
  const body = document.body;
  body.classList.add("watch-body");
  body.classList.toggle("watch-theatre", readTheatre());

  const featured = parseFeatured(featuredJson);
  const { root: top } = topBar("", undefined, { topics: tagRows(featured).map((r) => r.tag) });
  const list = h("div", { class: "watch-list" });
  const aside = h("aside", { class: "watch-next", "aria-label": "Up next" }, h("h2", {}, "Up next"), list);
  const main = h("div", { class: "watch-main" });
  const layout = h("div", { class: "watch-layout" }, main, aside);
  app.parentNode?.insertBefore(layout, app);
  main.append(app);
  body.prepend(top);
  // Anything already laid out from the window's width (a book, book/shell.ts)
  // measures again now that it sits in the narrower player column.
  window.dispatchEvent(new Event("resize"));

  // Theatre: the player takes the full width, "Up next" drops below it.
  const theatre = h("button", { type: "button", class: "watch-theatre-btn", title: "Theatre mode: a wider player" }, "⇔ Theatre") as HTMLButtonElement;
  const syncTheatre = (): void => {
    const on = body.classList.contains("watch-theatre");
    theatre.setAttribute("aria-pressed", String(on));
    theatre.textContent = on ? "⇔ Default view" : "⇔ Theatre";
  };
  theatre.addEventListener("click", () => {
    const on = !body.classList.contains("watch-theatre");
    body.classList.toggle("watch-theatre", on);
    saveTheatre(on);
    syncTheatre();
    // The stage sizes itself from the window; let it measure again.
    window.dispatchEvent(new Event("resize"));
  });
  syncTheatre();
  const meta = app.querySelector(".player-meta");
  // 👍 / 👎 for a named drawcast (a listed one: the buttons stay hidden for
  // anything else), under the player and in its "⋯" menu.
  const reactions = opts.name ? reactionControls(opts.name) : null;
  // History (save round, 2026-10-04): this browser's own list of what was opened by name.
  if (opts.name) recordWatch(opts.name);
  if (reactions) playerMenuSlot().replaceChildren(reactions.menuRow);
  const extras = [...(reactions ? [reactions.pill] : []), theatre];
  if (meta) meta.append(...extras);
  else main.append(...extras);

  // A course lecture (`spanish/2`): the next lectures first, in order; then
  // the usual list. Each source fills in as it answers.
  let lectures: HomeCard[] = [];
  let newest: HomeCard[] = [];
  const show = (): void => {
    list.replaceChildren(...mergeCards(lectures, upNext(opts.name, featured, newest)).slice(0, 12 + lectures.length).map((c) => card(c, { compact: true })));
  };
  show();
  const byName = new Map(featured.map((e) => [e.name, e]));
  // The front page's feed (home/feed.ts): the copy kept in this browser when
  // there is one (refreshed behind, for the next front page), else the server's;
  // the registry itself only when neither answers.
  const kept = storedFeed();
  const fresh = fetchFeed();
  const items = (kind: "cast" | "course", names?: string[]): Promise<CatalogueItem[] | null> =>
    (kept ? Promise.resolve(kept) : fresh).then(async (f) => {
      if (f) return feedQuery(f.items, { kind, names });
      const answer = await fetchCatalogue(DEFAULT_ENROLL_API, { kind, names });
      return answer === "error" ? null : answer.items;
    });
  void items("cast").then((answer) => {
    if (!answer) return;
    newest = answer.map((i) => cardFromCatalogue(i, byName));
    show();
  });
  const courseName = opts.name?.includes("/") ? opts.name.split("/", 1)[0] : null;
  if (courseName) {
    void items("course", [courseName]).then((answer) => {
      if (!answer) return;
      const course = answer.find((i) => i.name === courseName) ?? null;
      lectures = courseNext(opts.name, course);
      if (lectures.length) show();
      // The lectures' own titles, when the course.md beside this one has them.
      void opts.lectureTitles?.then((titles) => {
        if (!titles.length || !lectures.length) return;
        lectures = courseNext(opts.name, course, titles);
        show();
      });
    });
  }
}
