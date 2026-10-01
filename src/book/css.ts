// A book's styles, injected once by the shell (so the app and the standalone
// viewer share them). Tuned against the mock (dev-casts/book-mock.html) with
// Hans, 2026-09-30 – 10-01: handwriting, bold as accent ink rather than a
// marker stripe, a highlighter that covers the whole line, marks with room
// around the ink, body text indented under a heading.

export const BOOK_CSS = `
.bk-mode { width: auto !important; max-width: none !important; }
.bk-row { display: flex; align-items: flex-start; gap: 12px; margin: 0 auto; }
.bk-row.bk-rows { flex-direction: column; gap: 10px; }
.bk-row.bk-animate .bk-text, .bk-row.bk-animate .bk-figure {
  transition: width 1.1s cubic-bezier(.65, 0, .35, 1), height 1.1s cubic-bezier(.65, 0, .35, 1), opacity .5s ease;
}
.bk-figure { flex: 0 0 auto; box-sizing: border-box; overflow: hidden; }
.bk-figure.bk-closed { opacity: 0; padding: 0; border-width: 0; }
.bk-text {
  flex: 0 0 auto; position: relative; overflow: hidden; box-sizing: border-box;
  /* Paper in every theme: the text is ink on the same ground as the figure. */
  background: #faf6ec; border: 1.5px solid var(--line, #e4ddcf); border-radius: 8px;
  box-shadow: 0 2px 8px rgba(61, 56, 51, 0.09);
}
.bk-text.bk-closed { opacity: 0; border-width: 0; }
.bk-scroll {
  position: absolute; inset: 0; overflow-y: auto; scrollbar-width: none;
  padding: 1.1em 1.3em 0; color: #2b2a28;
  font-family: var(--sketch-font, "Patrick Hand", "Segoe Print", cursive);
  font-size: var(--bk-font, 20px); line-height: 1.35;
}
.bk-clean .bk-scroll { font-family: system-ui, -apple-system, "Segoe UI", sans-serif; }
.bk-scroll::-webkit-scrollbar { display: none; }
.bk-scroll::after { content: ""; display: block; height: 50%; }
.bk-block { position: relative; z-index: 1; margin: 0 0 .55em; clip-path: inset(0 100% 0 0); transition: clip-path var(--bk-wipe, 700ms) linear; }
.bk-block.bk-shown { clip-path: inset(0 0 0 0); }
.bk-block.bk-under { margin-left: .9em; }
.bk-block.bk-struck { color: #8b857b; }
.bk-block.bk-erasing { transition: opacity .45s ease, max-height .5s cubic-bezier(.65, 0, .35, 1), margin .5s ease; overflow: hidden; }
.bk-block.bk-temp {
  color: #8b857b; font-size: .85em; border-left: 2px dashed #e4ddcf; padding-left: .5em; overflow: hidden;
  transition: clip-path var(--bk-wipe, 700ms) linear, opacity .5s ease, max-height .5s cubic-bezier(.65, 0, .35, 1), margin .5s ease;
}
.bk-block h1 { font-size: 1.7em; font-weight: normal; margin: 0 0 .15em; line-height: 1.1; color: #b5482e; }
.bk-block h2 { font-size: 1.3em; font-weight: normal; margin: .4em 0 .1em; line-height: 1.15; border-bottom: 2px solid #e4ddcf; }
.bk-block h3 { font-size: 1.12em; font-weight: normal; margin: .35em 0 .05em; line-height: 1.15; color: #54504a; }
.bk-clean .bk-block h1, .bk-clean .bk-block h2, .bk-clean .bk-block h3 { font-weight: 600; }
.bk-block p { margin: 0; }
.bk-block ul { margin: 0; padding-left: 1.1em; }
.bk-block blockquote { margin: 0; padding: 2px 0 2px .6em; border-left: 3px solid #b5482e; color: #54504a; }
.bk-block strong { font-weight: normal; color: #b5482e; }
.bk-clean .bk-block strong { font-weight: 600; }
.bk-block em { color: #7a756c; }
.bk-block .bk-display { text-align: center; margin: .3em 0; }
.bk-block svg.bk-tex { fill: currentColor; overflow: visible; }
.bk-block table { border-collapse: collapse; margin: .2em 0; font-size: .92em; }
.bk-block th, .bk-block td { padding: .12em .7em; border-bottom: 1px solid #e4ddcf; text-align: left; }
.bk-block th { font-weight: normal; color: #b5482e; border-bottom: 2px solid #e4ddcf; }
.bk-block td.num, .bk-block th.num { text-align: right; }
.bk-block pre.bk-listing {
  font-family: 'Menlo', 'Consolas', 'DejaVu Sans Mono', monospace; font-size: .72em; line-height: 1.45;
  margin: .15em 0 0; padding: .45em .7em; background: #f1ece1; border-radius: 6px; white-space: pre-wrap;
}
.bk-block pre.bk-output { background: none; border-left: 3px solid #e4ddcf; border-radius: 0; color: #54504a; }
.bk-block pre.bk-output::before { content: "→ "; color: #7a756c; }
.bk-block pre.bk-listing .k { color: #8a5fa8; }
.bk-block pre.bk-listing .s { color: #4a7c59; }
.bk-block pre.bk-listing .n { color: #b5482e; }
.bk-block pre.bk-listing .c { color: #7a756c; }
.bk-block code.bk-tex-fallback { font-size: .8em; }
svg.bk-mark { position: absolute; left: 0; top: 0; overflow: visible; pointer-events: none; z-index: 3; }
svg.bk-mark.bk-behind { z-index: 0; }
svg.bk-mark .bk-ink { fill: none; stroke: #b5482e; stroke-width: 2.4; stroke-linecap: round; stroke-linejoin: round; }
svg.bk-mark .bk-hl { fill: #f6dd8a; }
svg.bk-mark.bk-flash, svg.bk-mark.bk-fading { transition: opacity .5s ease; }
svg.bk-mark.bk-fading { opacity: 0; }
@media (max-width: 700px) {
  .bk-row.bk-cols { flex-direction: column; width: 100% !important; }
  .bk-row.bk-cols .bk-figure { order: 1; width: 100% !important; }
  .bk-row.bk-cols .bk-text { order: 2; width: 100% !important; height: 45vh !important; }
}
`;
