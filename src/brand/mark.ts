// The drawcast mark: a play triangle drawn as ONE pen stroke that overshoots
// where it started, like a quick sketch (variant B, picked by Hans
// 2026-10-03 from five drawn for the front page). It replaced the solid
// play in a rounded rust square (2026-09-02), which had come too close to
// YouTube's own logo once drawcast.app became a page of drawcasts to watch.
//
// Where it appears: the browser tab (public/mark.svg), the front page's top
// bar beside the wordmark (home.ts), and drawcast pages' icon. The editor's
// top bar still carries the wordmark alone (Hans, 2026-09-02).
//
// One colour, the app's rust (styles.css --rust), at full strength for the
// stroke and faint inside — so it reads on paper and in dark chrome alike,
// and stays a clear shape at 16 px (checked at 16 and 32 px with the other
// candidates). No currentColor: the favicon file cannot read CSS.

const RUST = "#b5482e";

export function markSvg(size = 64): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="${size}" height="${size}">` +
    `<path d="M19 15 C 29 20, 41 26, 52 32 C 41 38, 30 44, 19 50 C 17.5 39, 17.5 27, 20 11" ` +
    `fill="${RUST}" fill-opacity="0.14" stroke="${RUST}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>` +
    `</svg>`
  );
}
