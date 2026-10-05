// The front page's building blocks, shared with the watch page (home/watch.ts):
// the top bar (brand, search, Create), a card, a titled grid of cards. Text
// and attributes only through h() — never innerHTML with catalogue text.

import { getToken, setToken, signInUrl, signOut } from "../account";
import { DEFAULT_ENROLL_API } from "../learn";
import { h } from "../ui/dom";
import { FORMAT_BADGE, FORMAT_CHIPS, homeHref, thumbUrl, type HomeCard } from "./model";
import { MY_LISTS } from "./my-lists";

/** Retry waits for a card picture the server was still building (a 503 —
 *  netlify/functions/card.mts finishes it in the background meanwhile). */
const THUMB_RETRIES_MS = [2500, 7000];

export function card(c: HomeCard, opts: { compact?: boolean } = {}): HTMLElement {
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
  return h("a", { class: opts.compact ? "home-card home-card-compact" : "home-card", href: homeHref(c.name) }, thumb, text);
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
 * and History (2026-10-04); Subscriptions are still to come. Built once per page.
 */
function buildMenu(topics: string[]): { open: () => void } {
  const link = (href: string, text: string, current = false): HTMLElement =>
    h("a", { class: current ? "home-menu-link current" : "home-menu-link", href, ...(current ? { "aria-current": "page" } : {}) }, text);
  const group = (title: string, ...items: HTMLElement[]): HTMLElement =>
    h("div", { class: "home-menu-group" }, ...(title ? [h("div", { class: "home-menu-title" }, title)] : []), ...items);
  const onHome = location.hash === "" && !location.search;
  const signedIn = getToken() !== "";
  const account = signedIn
    ? (() => {
        const b = h("button", { type: "button", class: "home-menu-link" }, "Sign out") as HTMLButtonElement;
        b.addEventListener("click", () => {
          const token = getToken();
          setToken("");
          void signOut(DEFAULT_ENROLL_API, token).finally(() => location.reload());
        });
        return b;
      })()
    : link(signInUrl(location.href), "Sign in");
  const panel = h(
    "nav",
    { class: "home-menu", "aria-label": "Main menu" },
    h("div", { class: "home-menu-head" }, closeBtn(), h("a", { class: "home-brand", href: "./" }, h("img", { src: "./mark.svg", alt: "" }), "drawcast")),
    group("", link("./", "Home", onHome), link("#browse", "Explore everything")),
    group("Formats", ...FORMAT_CHIPS.filter((c) => c.id).map((c) => link(`./?f=${c.id}`, c.label))),
    ...(topics.length ? [group("Topics", ...topics.map((t) => link(`./?q=${encodeURIComponent(t)}`, t[0].toUpperCase() + t.slice(1))))] : []),
    // Saved and Liked live with the account; History in this browser (home/my-lists.ts).
    group(
      "You",
      ...MY_LISTS.filter((l) => signedIn || l.id === "history").map((l) => link(`./?list=${l.id}`, l.label, new URLSearchParams(location.search).get("list") === l.id)),
      link("#create", "＋ Create a drawcast"),
      account,
      link("./help.html", "Help"),
    ),
  );
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
      document.addEventListener("keydown", onKey);
      (panel.querySelector("a, button") as HTMLElement | null)?.focus();
    },
  };
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
    h("a", { class: "home-create", href: "#create", title: "Make a drawcast: the editor" }, "＋ Create"),
  );
  return { root, input };
}
