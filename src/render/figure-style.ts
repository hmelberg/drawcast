// The figure's own look (.cs-stage/.cs-svg/.cs-caption), injected
// as a <style> tag by render() — a host page needs no stylesheet for figures
// to look right. Single source: styles.css no longer carries these base
// rules (it keeps only app chrome and overrides like :fullscreen sizes).
// The var() fallbacks are the app's own :root values, so the rules are
// self-contained outside drawcast while the app's variables still win inside.

import { FIGURE_GROUND } from "../layout/ink";
import { COLORS } from "../layout/model";

/**
 * The subtitles over the drawing are WRITTEN on it, the way its own labels
 * are (Hans, 2026-09-25): the figure's ink with a halo of its paper round
 * every letter, no band. The drawing stays visible between the words and
 * the halo clears just the strokes under each letter. It replaced a
 * translucent dark band (alpha 0.6, white text) that hid everything under
 * it. Exported so the contrast test reads the values the CSS uses.
 */
export const CAPTION_TEXT = { ink: COLORS.ink, halo: FIGURE_GROUND } as const;

/** The halo: a ring of the paper colour at ±1.5 px, softened out to 6 px. */
const HALO = [
  ...[[1.5, 0], [-1.5, 0], [0, 1.5], [0, -1.5], [1.1, 1.1], [-1.1, 1.1], [1.1, -1.1], [-1.1, -1.1]].map(([x, y]) => `${x}px ${y}px 0 ${FIGURE_GROUND}`),
  `0 0 3px ${FIGURE_GROUND}`,
  `0 0 6px ${FIGURE_GROUND}`,
].join(", ");

/** Where the C64 face lives: the app's own copy first, drawcast's published
 *  one for a page that embeds the engine (the engine build ships no public
 *  folder — the mdlib pattern). */
export const C64_FONT_URLS = [
  "/fonts/c64/C64_Pro_Mono-STYLE.woff2", // the app at its root (drawcast.app, netlify dev)
  "fonts/c64/C64_Pro_Mono-STYLE.woff2", // a build under a subpath (hmelberg.github.io/drawcast/)
  "https://drawcast.app/fonts/c64/C64_Pro_Mono-STYLE.woff2", // a page embedding the engine (CORS is on for /fonts/* in netlify.toml)
] as const;

const FIGURE_CSS = `
@font-face {
  font-family: 'C64 Pro Mono';
  src: ${C64_FONT_URLS.map((u) => `url(${u}) format('woff2')`).join(", ")};
  font-display: swap;
}
/* The Commodore's cursor: a square that blinks slowly. A CSS animation, so a
   frame of the video export simply shows it on. */
@keyframes cs-blink { 0%, 49% { opacity: 1; } 50%, 100% { opacity: 0; } }
.cs-blink { animation: cs-blink 1.1s steps(1, end) infinite; }
.cs-stage {
  position: relative;
  width: 100%;
  aspect-ratio: 4 / 3;
  background: ${FIGURE_GROUND};
  /* No border: the host (the app's figure card, or a page embedding the
     engine) already draws whatever edge it wants, and a second hairline in
     nearly the same tone reads as a white frame around the drawing rather
     than as the paper it is (Hans, 2026-09-05). */
  border-radius: 4px;
  overflow: hidden;
}
.cs-svg { width: 100%; height: 100%; display: block; }
/* Subtitles, the way a video carries them: a band across the bottom of the
   drawing, on its own dark ground so the words read over whatever is beneath
   them. It is a child of the stage, so it scales with the picture in
   fullscreen and needs no separate rule there. */
.cs-caption {
  position: absolute;
  /* As wide as its words, centred: the box itself is invisible (the
     letters carry their own halo), so this only bounds the lines. */
  left: 50%;
  bottom: 0.4rem;
  transform: translateX(-50%);
  width: max-content;
  max-width: calc(100% - 1.2rem);
  box-sizing: border-box;
  border-radius: 6px;
  z-index: 5;
  padding: 0.3rem 0.8rem 0.35rem;
  font-family: var(--sketch-font, "Patrick Hand", "Segoe Print", "Comic Sans MS", cursive);
  font-size: calc(1.15rem * var(--cs-text-scale, 1));
  line-height: 1.35;
  text-align: center;
  color: ${CAPTION_TEXT.ink};
  text-shadow: ${HALO};
  background: none;
  /* Selecting a phrase to look up is the one gesture the band answers; every
     other click belongs to the drawing underneath (see ui/caption.ts). */
  pointer-events: none;
  -webkit-user-select: text;
  user-select: text;
}
.cs-caption::selection,
.cs-caption *::selection { background: rgba(181, 72, 46, 0.55); }
/* Over dark ground (render/caption-dark.ts: a photo, a C64 screen, a solid
   dark fill in the caption's strip) the paper halo would make pale patches:
   those captions take a dark band with light letters, the one style that
   reads on any ground. Only as an overlay — below the drawing it is paper. */
.cs-stage:not(.cs-caption-below) .cs-caption.cs-caption-dark {
  color: #fbf8f1;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.8);
  background: rgba(24, 20, 16, 0.72);
}
/* Subtitles BELOW the drawing when the stage has room under it (Hans,
   2026-09-25; render/caption-place.ts decides and sets the class): the
   drawing keeps its 4 : 3 at the top — so the svg never letterboxes and a
   click maps exactly — and the words sit on the paper under it, in ink,
   with no band to cover anything. */
.cs-caption-below { display: flex; flex-direction: column; justify-content: flex-start; }
.cs-caption-below .cs-svg { height: auto; aspect-ratio: 4 / 3; flex: none; }
.cs-caption-below .cs-caption {
  position: static;
  flex: none;
  /* The caption is the stage's first child (it is there before the svg is
     mounted); in the column it goes last. */
  order: 1;
  /* On bare paper the words need no extra size to carry over a drawing. */
  font-size: calc(1.02rem * var(--cs-text-scale, 1));
  transform: none;
  width: auto;
  max-width: none;
  border-radius: 0;
  padding: 0.35rem 0.9rem 0.4rem;
  color: ${COLORS.ink};
  text-shadow: none;
  background: none;
}
/* A phone held upright shows the app's figure a little taller than 4 : 3 —
   room for three lines of subtitles under the drawing (4 : 4.1) instead of over it.
   Fullscreen and the viewer size the stage themselves and override this. */
@media (max-width: 700px) and (orientation: portrait) {
  .cs-stage { aspect-ratio: 4 / 4.1; }
}
/* The band goes away between beats rather than hanging over the drawing as an
   empty box — and CC off takes it away outright. Visibility rather than
   display: the video export reads this element's textContent every frame, and
   an unrendered node still carries its text. */
.cs-caption-empty,
.cs-cc-off .cs-caption { visibility: hidden; }
/* Text is selectable only where there IS text: the band is transparent to
   pointers so the drawing keeps its clicks, and turns solid for the drag. */
.cs-caption:not(.cs-caption-empty) { pointer-events: auto; }
.cs-cc-off .cs-caption { pointer-events: none; }
/* Selecting a phrase in the caption offers to look it up — the viewer draws
   the boundary, which no phrase detector does reliably. */
.cs-lookup {
  position: absolute;
  z-index: 7;
  transform: translate(-50%, -100%);
  padding: 0.08rem 0.5rem;
  font-family: inherit;
  font-size: 0.8rem;
  line-height: 1.4;
  color: #b5482e;
  background: #fffefb;
  border: 1.5px solid #eee8da;
  border-radius: 999px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.12);
  cursor: pointer;
  user-select: none;
  white-space: nowrap;
}
.cs-lookup:hover { border-color: #b5482e; }
`;

let injected = false;

export function ensureFigureStyles(): void {
  if (injected || typeof document === "undefined") return;
  injected = true;
  const style = document.createElement("style");
  style.dataset.drawcastFigureStyles = "";
  style.textContent = FIGURE_CSS;
  document.head.appendChild(style);
}
