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

export function createMenu(label: string, items: MenuItem[], opts: { title?: string } = {}): HTMLElement {
  const live = visibleItems(items);
  if (live.length === 1) {
    const only = h("button", opts.title ? { title: opts.title } : {}, `${label.replace(/ ▾$/, "")} ${live[0].label}`.trim());
    only.addEventListener("click", () => live[0].onSelect());
    return only;
  }
  const panel = h("div", { class: "menu-panel", hidden: "" });
  const trigger = h("button", { class: "menu-trigger", "aria-expanded": "false", ...(opts.title ? { title: opts.title } : {}) }, `${label} ▾`);
  const close = (): void => {
    panel.hidden = true;
    trigger.setAttribute("aria-expanded", "false");
  };
  for (const item of live) {
    const b = h("button", { class: "menu-item" }, item.label);
    b.addEventListener("click", () => {
      close();
      item.onSelect();
    });
    panel.appendChild(b);
  }
  trigger.addEventListener("click", (e) => {
    e.stopPropagation();
    panel.hidden = !panel.hidden;
    trigger.setAttribute("aria-expanded", String(!panel.hidden));
  });
  // Dismissal belongs on the document, not the trigger: a click anywhere else
  // — including on another menu's trigger — has to close this one.
  document.addEventListener("click", close);
  return h("span", { class: "menu" }, trigger, panel);
}
