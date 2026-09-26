// One source as the player writes it: the title (a link when there is one),
// who and when, and what it found. The info card and the tray's Sources
// section show the same entry.
import type { SpecSource } from "../spec/types";
import { h } from "./dom";
import { sourceByline, sourceHref } from "./source-model";

export function sourceEntry(src: SpecSource, link: (href: string, label: string) => HTMLElement): HTMLElement {
  const href = sourceHref(src);
  const title = href ? link(href, `${src.title} ↗`) : h("span", {}, src.title);
  const by = sourceByline(src);
  return h(
    "div",
    { class: "cs-source" },
    h("div", { class: "cs-source-title" }, title),
    ...(by ? [h("div", { class: "cs-source-by" }, by)] : []),
    ...(src.finding ? [h("div", { class: "cs-source-finding" }, src.finding)] : []),
  );
}
