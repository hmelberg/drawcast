// The watch page (2026-10-03): a drawcast opened on drawcast.app plays inside
// the site's own frame, like a video page — the top bar (brand, search,
// Create) above, "Up next" beside the player (below it on a phone), and a
// theatre mode that gives the player the full width. Loaded on demand by the
// viewer (viewer.ts), never for a drawcast's own page elsewhere (an author's
// GitHub page or an exported file shows the plain player).

import { fetchCatalogue } from "../catalogue";
import { DEFAULT_ENROLL_API } from "../learn";
import { h } from "../ui/dom";
import featuredJson from "./featured.json";
import { cardFromCatalogue, parseFeatured, upNext } from "./model";
import { card, topBar } from "./ui";

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
export function mountWatch(app: HTMLElement, opts: { name?: string } = {}): void {
  const body = document.body;
  body.classList.add("watch-body");
  body.classList.toggle("watch-theatre", readTheatre());

  const { root: top } = topBar();
  const list = h("div", { class: "watch-list" });
  const aside = h("aside", { class: "watch-next", "aria-label": "Up next" }, h("h2", {}, "Up next"), list);
  const main = h("div", { class: "watch-main" });
  const layout = h("div", { class: "watch-layout" }, main, aside);
  app.parentNode?.insertBefore(layout, app);
  main.append(app);
  body.prepend(top);

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
  if (meta) meta.append(theatre);
  else main.append(theatre);

  const featured = parseFeatured(featuredJson);
  const show = (newest: Parameters<typeof upNext>[2]): void => {
    list.replaceChildren(...upNext(opts.name, featured, newest).map((c) => card(c, { compact: true })));
  };
  show([]);
  void fetchCatalogue(DEFAULT_ENROLL_API, { kind: "cast" }).then((answer) => {
    if (answer !== "error") show(answer.items.map((i) => cardFromCatalogue(i, new Map(featured.map((e) => [e.name, e])))));
  });
}
