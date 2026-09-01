// Control-bar icons as inline SVG taking currentColor (Part 2a — C8/D6.1,
// review R4). The bar used to mix geometric text glyphs (▶ ⏸ ▭ ⛶ ⋯ ↺) with
// emoji-class codepoints (🔊 🔇, and ⏮ ⏭ are emoji-class too): macOS renders
// those as full-colour bitmaps that ignore `color`, so one control in an
// otherwise inked bar was a small cartoon speaker — and no bitmap can follow
// a theme. One material for every glyph kills the class of problem.
//
// Path data is Material Icons geometry (Apache-2.0), 24×24 filled style —
// the same set YouTube's own bar descends from, so the shapes read as
// "video player" on sight. ICON_PATHS is pure data on purpose: the node
// test suite drift-tests the inventory without a DOM (h() throws in node).

export const ICON_PATHS = {
  play: "M8 5v14l11-7z",
  pause: "M6 19h4V5H6v14zm8-14v14h4V5h-4z",
  replay: "M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z",
  prev: "M6 6h2v12H6zm3.5 6l8.5 6V6z",
  next: "M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z",
  volume:
    "M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z",
  muted:
    "M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z",
  theater: "M19 6H5c-1.1 0-2 .9-2 2v8c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm0 10H5V8h14v8z",
  fullscreen: "M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z",
  more: "M6 10c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm12 0c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm-6 0c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z",
} as const;

export type IconName = keyof typeof ICON_PATHS;

const SVG_NS = "http://www.w3.org/2000/svg";

/** A fresh icon element (an SVG node mounts in one place only — build one per
 *  use, never share). Sized by font-size via .cs-icon; inherits currentColor. */
export function icon(name: IconName): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("class", "cs-icon");
  svg.setAttribute("viewBox", "0 0 24 24");
  // Presentation-attribute size so the icon is sane even with no stylesheet
  // (an SVG with only a viewBox defaults to 300×150); .cs-icon refines it.
  svg.setAttribute("width", "1.15em");
  svg.setAttribute("height", "1.15em");
  svg.setAttribute("fill", "currentColor");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS(SVG_NS, "path");
  path.setAttribute("d", ICON_PATHS[name]);
  svg.appendChild(path);
  return svg;
}
