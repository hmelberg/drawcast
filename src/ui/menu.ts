// One dropdown primitive for every "a verb with a few ways to do it" control:
// Open, Save, Insert, and the player's overflow. A menu whose items reduce to
// one is not a menu — it renders as that one button, so a user without Google
// never pays a click to reach the only option they have.

import { h } from "./dom";

export interface MenuItem {
  label: string;
  onSelect(): void;
  /** Same rule as the buttons this replaces: no credential, no advertisement. */
  hidden?: boolean;
}

export function visibleItems(items: MenuItem[]): MenuItem[] {
  return items.filter((i) => !i.hidden);
}

/** Compose a label for a single-item menu: "Open from disk…" (not "From disk…").
 *  Lowercases the item's first letter so it reads as one phrase. */
export function soloLabel(verb: string, item: MenuItem): string {
  const cleaned = verb.replace(/ ▾$/, "").trim();
  const itemLabel = item.label.charAt(0).toLowerCase() + item.label.slice(1);
  return `${cleaned} ${itemLabel}`.trim();
}

export function createMenu(label: string, items: MenuItem[], opts: { title?: string } = {}): HTMLElement {
  const live = visibleItems(items);
  if (live.length === 0) {
    // An empty menu contradicts the design rule: no credential, no advertisement.
    return h("span", { class: "menu", hidden: "" });
  }
  if (live.length === 1) {
    const only = h("button", opts.title ? { title: opts.title } : {}, soloLabel(label, live[0]));
    only.addEventListener("click", () => live[0].onSelect());
    return only;
  }
  const panel = h("div", { class: "menu-panel", hidden: "" });
  const trigger = h("button", { class: "menu-trigger", "aria-expanded": "false", ...(opts.title ? { title: opts.title } : {}) }, `${label} ▾`);
  const root = h("span", { class: "menu" }, trigger, panel);
  const onDocClick = (e: MouseEvent) => {
    // The click that opened THIS menu lands inside it; anything else dismisses.
    if (!root.contains(e.target as Node)) close();
  };
  const close = (): void => {
    panel.hidden = true;
    trigger.setAttribute("aria-expanded", "false");
    document.removeEventListener("click", onDocClick);
  };
  const open = (): void => {
    panel.hidden = false;
    trigger.setAttribute("aria-expanded", "true");
    document.addEventListener("click", onDocClick);
  };
  for (const item of live) {
    const b = h("button", { class: "menu-item" }, item.label);
    b.addEventListener("click", () => {
      close();
      item.onSelect();
    });
    panel.appendChild(b);
  }
  trigger.addEventListener("click", () => {
    panel.hidden ? open() : close();
  });
  return root;
}
