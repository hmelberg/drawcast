// The figure's own look (.cs-stage/.cs-svg/.cs-caption/.cs-title), injected
// as a <style> tag by render() — a host page needs no stylesheet for figures
// to look right. Single source: styles.css no longer carries these base
// rules (it keeps only app chrome and overrides like :fullscreen sizes).
// The var() fallbacks are the app's own :root values, so the rules are
// self-contained outside drawcast while the app's variables still win inside.
/**
 * The subtitle band's ground (A6/D1). At 0.82 the band was nearly opaque ink
 * over the drawing; 0.6 is the lightest alpha whose blend over bare paper
 * still gives the caption text ≥ 4.5:1 (measured — tests/caption-band.test.ts
 * pins it), with a strengthened text shadow carrying the edge over busy
 * drawings. Exported so the drift test computes on the value the CSS uses.
 */
export const CAPTION_BAND = { ink: [24, 20, 16], alpha: 0.6 } as const;

const BAND = `rgba(${CAPTION_BAND.ink.join(", ")}, ${CAPTION_BAND.alpha})`;
const BAND_CLEAR = `rgba(${CAPTION_BAND.ink.join(", ")}, 0)`;

const FIGURE_CSS = `
.cs-stage {
  position: relative;
  width: 100%;
  aspect-ratio: 4 / 3;
  background: #fffefb;
  border: 1px solid #eee8da;
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
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 5;
  padding: 0.45rem 0.9rem 0.5rem;
  font-family: var(--sketch-font, "Patrick Hand", "Segoe Print", "Comic Sans MS", cursive);
  font-size: 1.15rem;
  line-height: 1.35;
  text-align: center;
  color: #fbf8f1;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.8), 0 0 6px rgba(0, 0, 0, 0.45);
  background: linear-gradient(to top, ${BAND} 55%, ${BAND_CLEAR});
  /* Selecting a phrase to look up is the one gesture the band answers; every
     other click belongs to the drawing underneath (see ui/caption.ts). */
  pointer-events: none;
  -webkit-user-select: text;
  user-select: text;
}
.cs-caption::selection,
.cs-caption *::selection { background: rgba(181, 72, 46, 0.55); }
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
.cs-title {
  font-family: var(--sketch-font, "Patrick Hand", "Segoe Print", "Comic Sans MS", cursive);
  font-size: 1.3rem;
  /* The figure never reads a chrome token. Its paper is real paper — a sheet
     on a dark desk when the app is dark — and an exported video must look
     like what the editor showed. A themed --ink here would put light text on
     white paper, inside the drawing, in the file. */
  color: #3d3833;
  text-align: center;
  width: fit-content;
  padding: 0 0.4rem;
  /* Above the drawing — and only for a drawcast that does not DRAW its own
     title (render/index.ts, C9 as clarified): drawn titles live on the
     canvas, so this never duplicates one. */
  margin: 0.05rem auto 0.1rem;
  max-width: 90%;
}
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
