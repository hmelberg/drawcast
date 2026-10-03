// The front page's building blocks, shared with the watch page (home/watch.ts):
// the top bar (brand, search, Create), a card, a titled grid of cards. Text
// and attributes only through h() — never innerHTML with catalogue text.

import { h } from "../ui/dom";
import { FORMAT_BADGE, homeHref, thumbUrl, type HomeCard } from "./model";

export function card(c: HomeCard, opts: { compact?: boolean } = {}): HTMLElement {
  const img = h("img", { src: thumbUrl(c.name), alt: "", loading: "lazy", decoding: "async" });
  img.addEventListener("error", () => img.remove());
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
  return h("a", { class: opts.compact ? "home-card home-card-compact" : "home-card", href: homeHref(c.name) }, h("div", { class: "home-thumb" }, img), text);
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
 * The top bar. `onSearch` handles a search in place (the front page); without
 * it a search goes to the front page's results (`./?q=…`), which is what the
 * watch page wants.
 */
export function topBar(q = "", onSearch?: (q: string) => void): { root: HTMLElement; input: HTMLInputElement } {
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
    h("a", { class: "home-brand", href: "./" }, h("img", { src: "./mark.svg", alt: "" }), "drawcast"),
    form,
    h("a", { class: "home-create", href: "#create", title: "Make a drawcast: the editor" }, "＋ Create"),
  );
  return { root, input };
}
