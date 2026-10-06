// The front page's building blocks, shared with the watch page (home/watch.ts):
// the top bar (brand, search, Create), a card, a titled grid of cards. Text
// and attributes only through h() — never innerHTML with catalogue text.

import { getToken } from "../account";
import { accountButton } from "../account-menu";
import { YOU_PAGES } from "./you";
import { h } from "../ui/dom";
import { FORMAT_BADGE, FORMAT_CHIPS, homeHref, thumbUrl, topicSlug, type HomeCard } from "./model";
import { MY_LISTS } from "./my-lists";
import { cardOf, fetchFeed, storedFeed, thumbCountsOf } from "./feed";
import { chooseVariant, hash32, seeded } from "../card/choose";
import { countClick, viewerId, watchShown } from "./thumb-count";
import { drawCard, iconNames, type Icons } from "../card/draw";
import { loadIcons } from "../card/icons";
import type { CompiledCard } from "../card/types";
import { pictureAllowed } from "../../netlify/lib/thumb.mts";

/** Retry waits for a card picture the server was still building (a 503 —
 *  netlify/functions/card.mts finishes it in the background meanwhile). */
const THUMB_RETRIES_MS = [2500, 7000];

/**
 * The listing picture from the cast's card (cards round, 2026-10-05): drawn
 * at once from text (card/draw.ts), its named icons filled in when they
 * arrive (card/icons.ts, from Iconify), and — only when the card asks for a
 * picture (its poster, or an allowed image) — that picture under the same
 * marks once it has loaded, fetched when the card nears the screen.
 * drawCard escapes every text it draws.
 */
function drawnThumb(name: string, own: CompiledCard): { box: HTMLElement; variant: number } {
  // A cast with several thumbnails shows one of them (card/choose.ts): mostly
  // the one clicked most, the same one all day for this viewer.
  const all = [own, ...(own.variants ?? [])];
  const variant = chooseVariant(all.length, thumbCountsOf(name), seeded(hash32(`${viewerId()}|${name}|${new Date().toISOString().slice(0, 10)}`)));
  const card = all[variant];
  const box = h("div", { class: "home-thumb home-thumb-card" });
  let icons: Icons = {};
  let poster: string | undefined;
  const paint = (): void => {
    try {
      box.innerHTML = drawCard(card, { icons, posterHref: poster });
    } catch {
      /* a malformed card: the box stays as it was */
    }
  };
  paint();
  const names = iconNames(card);
  if (names.length) void loadIcons(names).then((got) => {
    icons = got;
    if (!poster) paint();
  });
  // A picture only when the card asks for one (2026-10-06): the drawing is the
  // thumbnail otherwise, and nothing more is downloaded.
  const src = card.picture === "poster" ? card.poster : card.picture && pictureAllowed(card.picture) ? card.picture : undefined;
  if (src) {
    const load = (): void => {
      const img = new Image();
      img.onload = () => {
        poster = src;
        paint();
      };
      img.src = src;
    };
    if (typeof IntersectionObserver === "undefined") load();
    else {
      const io = new IntersectionObserver((entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          io.disconnect();
          load();
        }
      }, { rootMargin: "300px" });
      io.observe(box);
    }
  }
  if (all.length > 1) watchShown(box, name, variant);
  return { box, variant };
}

/** The listing picture drawn by drawcast.app (/card/<name>.png): for items with no card yet. */
function serverThumb(c: HomeCard): HTMLElement {
  const src = thumbUrl(c.name);
  const img = h("img", { src, alt: "", loading: "lazy", decoding: "async" }) as HTMLImageElement;
  // Past the retries the box shows the title, never an empty box.
  const thumb = h("div", { class: "home-thumb" }, img);
  let tries = 0;
  img.addEventListener("error", () => {
    const wait = THUMB_RETRIES_MS[tries++];
    if (wait === undefined) {
      img.remove();
      thumb.classList.add("home-thumb-empty", `home-thumb-${c.format ?? "drawcast"}`);
      thumb.append(h("span", { class: "home-thumb-title" }, c.title));
      return;
    }
    setTimeout(() => (img.src = `${src}?r=${tries}`), wait);
  });
  return thumb;
}

export function card(c: HomeCard, opts: { compact?: boolean } = {}): HTMLElement {
  const own = cardOf(c.name);
  const drawn = own ? drawnThumb(c.name, own) : null;
  const thumb = drawn ? drawn.box : serverThumb(c);
  const badges: HTMLElement[] = [];
  if (c.format) badges.push(h("span", { class: `home-badge home-badge-${c.format}` }, FORMAT_BADGE[c.format]));
  if (c.private) badges.push(h("span", { class: "home-badge home-badge-private" }, "Private"));
  const meta = [c.owner, c.meta].filter(Boolean).join(" · ");
  const text = h(
    "div",
    { class: "home-card-text" },
    h("div", { class: "home-card-title" }, c.title),
    ...(meta ? [h("div", { class: "home-card-meta" }, meta)] : []),
    ...(badges.length ? [h("div", { class: "home-badges" }, ...badges)] : []),
  );
  const link = h("a", { class: opts.compact ? "home-card home-card-compact" : "home-card", href: homeHref(c.name) }, thumb, text);
  // Which thumbnail drew the click, when the cast has several.
  if (drawn && own && (own.variants?.length ?? 0) > 0) link.addEventListener("click", () => countClick(c.name, drawn.variant));
  return link;
}

export function section(title: string, cards: HomeCard[], more?: HTMLElement): HTMLElement | null {
  if (cards.length === 0) return null;
  return h(
    "section",
    { class: "home-section" },
    h("div", { class: "home-section-head" }, h("h2", {}, title), ...(more ? [more] : [])),
    h("div", { class: "home-grid" }, ...cards.map((c) => card(c))),
  );
}

export function note(text: string, kind = ""): HTMLElement {
  return h("p", { class: `home-note ${kind}`.trim() }, text);
}

/**
 * The ☰ menu's sidebar (YouTube's guide): every place the site has, in one
 * column that slides in over the page. Only what works today: Saved, Liked
 * and History (2026-10-04); Subscriptions are still to come. Signing in and
 * out is the account button's (account-menu.ts). Built once per page.
 */
function buildMenu(topics: string[]): { open: () => void } {
  const link = (href: string, text: string, current = false): HTMLElement =>
    h("a", { class: current ? "home-menu-link current" : "home-menu-link", href, ...(current ? { "aria-current": "page" } : {}) }, text);
  const group = (title: string, ...items: HTMLElement[]): HTMLElement =>
    h("div", { class: "home-menu-group" }, ...(title ? [h("div", { class: "home-menu-title" }, title)] : []), ...items);
  const onHome = location.hash === "" && !location.search;
  const signedIn = getToken() !== "";
  // Topics link to their own page (?topic=, 2026-10-06), and only as many
  // show as fit, so the whole sidebar is always in view; "More topics" opens
  // the rest (and the sidebar scrolls then).
  const currentTopic = new URLSearchParams(location.search).get("topic");
  const topicLinks = topics.map((t) => link(`./?topic=${encodeURIComponent(topicSlug(t))}`, t[0].toUpperCase() + t.slice(1), currentTopic === topicSlug(t)));
  const moreTopics = h("button", { type: "button", class: "home-menu-link home-menu-more", hidden: "" }, "More topics") as HTMLButtonElement;
  let allTopics = false;
  moreTopics.addEventListener("click", () => {
    allTopics = true;
    fitTopics();
  });
  function fitTopics(): void {
    for (const a of topicLinks) a.hidden = false;
    moreTopics.hidden = true;
    if (allTopics || panel.scrollHeight <= panel.clientHeight) return;
    moreTopics.hidden = false;
    // At least two stay; the rest go from the least used end.
    for (let i = topicLinks.length - 1; i >= 2 && panel.scrollHeight > panel.clientHeight; i--) topicLinks[i].hidden = true;
  }
  const panel = h(
    "nav",
    { class: "home-menu", "aria-label": "Main menu" },
    h("div", { class: "home-menu-head" }, closeBtn(), h("a", { class: "home-brand", href: "./" }, h("img", { src: "./mark.svg", alt: "" }), "drawcast")),
    group("", link("./", "Home", onHome), randomLink()),
    group("Formats", ...FORMAT_CHIPS.filter((c) => c.id).map((c) => link(`./?f=${c.id}`, c.label))),
    ...(topics.length ? [group("Topics", ...topicLinks, moreTopics)] : []),
    // Saved and Liked live with the account; History in this browser (home/my-lists.ts).
    group(
      "You",
      ...MY_LISTS.filter((l) => signedIn || l.id === "history").map((l) => link(`./?list=${l.id}`, l.label, new URLSearchParams(location.search).get("list") === l.id)),
      // Sign in and out live on the account button (top right) now.
      ...(signedIn ? YOU_PAGES.map((p) => link(`./?you=${p.id}`, p.label, new URLSearchParams(location.search).get("you") === p.id)) : []),
      link("#create", "＋ Create a drawcast"),
      link("./help.html", "Help"),
    ),
  );
  window.addEventListener("resize", () => {
    if (!shell.hidden) fitTopics();
  });
  const backdrop = h("div", { class: "home-menu-backdrop" });
  const shell = h("div", { class: "home-menu-shell", hidden: "" }, backdrop, panel);
  document.body.append(shell);
  let opener: HTMLElement | null = null;
  function closeBtn(): HTMLElement {
    const b = h("button", { type: "button", class: "home-menu-btn", "aria-label": "Close menu" }, "☰");
    b.addEventListener("click", () => close());
    return b;
  }
  const close = (): void => {
    shell.hidden = true;
    document.removeEventListener("keydown", onKey);
    opener?.focus();
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === "Escape") close();
  };
  backdrop.addEventListener("click", close);
  return {
    open: () => {
      opener = document.activeElement as HTMLElement | null;
      shell.hidden = false;
      fitTopics();
      document.addEventListener("keydown", onKey);
      (panel.querySelector("a, button") as HTMLElement | null)?.focus();
    },
  };
}

/**
 * "Random drawcast" (2026-10-06, where Explore everything was): a listed,
 * public drawcast picked at random from the front page's feed — the kept one
 * when there is one, else asked for. Courses are left out: a random lecture
 * series is a long commitment to land in by chance.
 */
function randomLink(): HTMLElement {
  const b = h("button", { type: "button", class: "home-menu-link" }, "Random drawcast") as HTMLButtonElement;
  b.addEventListener("click", () => {
    b.disabled = true;
    void (async () => {
      const feed = storedFeed() ?? (await fetchFeed());
      const here = decodeURIComponent(location.pathname.startsWith("/w/") ? location.pathname.slice(3) : location.hash.slice(1));
      const pool = (feed?.items ?? []).filter((i) => i.kind === "cast" && !i.private && i.name !== here);
      b.disabled = false;
      location.href = pool.length ? homeHref(pool[Math.floor(Math.random() * pool.length)].name) : "#browse";
    })();
  });
  return b;
}

/**
 * The top bar. `onSearch` handles a search in place (the front page); without
 * it a search goes to the front page's results (`./?q=…`), which is what the
 * watch page wants.
 */
export function topBar(q = "", onSearch?: (q: string) => void, opts: { topics?: string[] } = {}): { root: HTMLElement; input: HTMLInputElement } {
  const menu = buildMenu(opts.topics ?? []);
  const menuBtn = h("button", { type: "button", class: "home-menu-btn", "aria-label": "Menu", title: "Menu" }, "☰");
  menuBtn.addEventListener("click", () => menu.open());
  const input = h("input", { type: "search", class: "home-q", placeholder: "Search drawcasts", "aria-label": "Search drawcasts" }) as HTMLInputElement;
  input.value = q;
  const form = h("form", { class: "home-search", role: "search" }, input, h("button", { type: "submit", class: "home-search-btn" }, "Search"));
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const value = input.value.trim();
    if (onSearch) onSearch(value);
    else location.href = value ? `./?q=${encodeURIComponent(value)}` : "./";
  });
  const root = h(
    "header",
    { class: "home-top" },
    h("div", { class: "home-top-left" }, menuBtn, h("a", { class: "home-brand", href: "./" }, h("img", { src: "./mark.svg", alt: "" }), "drawcast")),
    form,
    h(
      "div",
      { class: "home-top-right" },
      h("a", { class: "home-create", href: "#create", title: "Make a drawcast: the editor" }, "＋ Create"),
      accountButton({ where: "home", onSignOut: () => location.reload() }),
    ),
  );
  return { root, input };
}
