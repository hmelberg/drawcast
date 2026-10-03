// A place in the player's "⋯ More choices" menu that the page around the
// player fills (the watch page: 👍 / 👎). One per page — there is one player —
// and kept across renders: controls.ts moves this same element into each new
// menu, so what the page put there survives a re-render.
import { h } from "./dom";

let slot: HTMLElement | null = null;

export function playerMenuSlot(): HTMLElement {
  slot ??= h("div", { class: "cs-menu-slot" });
  return slot;
}
