// The drawcast favicon: a play triangle in a rounded rust square. Hans
// picked it by eye (2026-09-02) from three candidates drawn after "the logo
// is ugly, make something new and simple" — then, minutes later, took the
// mark out of the topbar altogether ("no logo might be better, just the
// drawcast word in handwritten fonts"). So this is drawn for one place: the
// browser tab, where a page needs an icon and a word cannot be one.
//
// Nothing sketched. The first mark was drawn by rough.js like every figure;
// at 16px its rough strokes vanished, and at 30px next to the cleaner chrome
// they read as a rendering bug rather than hand-drawn charm. The hand-drawn
// quality lives in the drawings. The mark is the button that plays them.
//
// Two fixed colours and no ink: the square is the app's rust accent
// (styles.css --rust), the triangle its paper. One drawing therefore serves
// the favicon file (which cannot read a CSS custom property) and the topbar
// in both themes alike — there is no currentColor variant to keep in step.

const RUST = "#b5482e";
import { FIGURE_GROUND } from "../layout/ink";

const PAPER = FIGURE_GROUND;

export function markSvg(size = 64): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="${size}" height="${size}">` +
    `<rect x="1.5" y="1.5" width="21" height="21" rx="5.5" fill="${RUST}"/>` +
    `<path d="M9.4 7.3 L17.2 12 L9.4 16.7 Z" fill="${PAPER}"/>` +
    `</svg>`
  );
}
