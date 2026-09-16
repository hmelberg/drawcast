// The row under the player — the title on its own line, then whatever the
// page adds beside it (the watch page: a view count, a note, the way back to
// the app). The one builder the app's Player mode and the standalone viewer
// share (title-below-player design, 2026-09-16), so the two pages cannot
// drift: the frame itself carries no title, the way a YouTube page puts the
// video's name under the picture, and the canvas shows a heading only when
// the cast draws one.

import { h } from "./dom";

export interface PlayerMeta {
  root: HTMLElement;
  /** Empty until the document names it: the row keeps its height meanwhile. */
  setTitle(title: string): void;
}

export function playerMeta(...trailing: (Node | string)[]): PlayerMeta {
  const titleEl = h("h1", { class: "player-title" });
  const root = h("div", { class: "player-meta" }, titleEl, ...trailing);
  return {
    root,
    setTitle: (title) => {
      titleEl.textContent = title;
    },
  };
}
