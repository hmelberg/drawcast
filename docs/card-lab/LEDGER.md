# Card lab ledger

Ratings and notes from the card lab (`npm run cardlab`, then `card-lab.html` on `npm run dev`).
Paste the page's "Copy ledger" lines here after each round.

## 2026-10-05 — round 1 built

- 112/112 library casts compiled; median card 2.2 KB (largest 4.1 KB) without icon drawings; icons median 0, largest 34.8 KB (dinosaur quiz).
- Small renderer 13 KB gzip; all 112 cards drawn in ~50 ms, ~190 ms at 4× slower CPU.
- Left out (casts affected): formula glyphs 24, over the 4 KB cap 13, photos/raster pictures 2, code 1.
- First look: the drawing stops at the poster frame (answers stay hidden); a code-made chart (herd immunity) is a raster and is left out.

## 2026-10-05 — round 1 ratings (Hans, 109 casts)

Good 90, OK 12, bad 7. Bad: how-a-nerve-signal-travels, scholar-s-mate, rice-on-a-chessboard, rubiks-cube, the-herd-immunity-threshold, euler-s-identity-as-half-a-turn, the-broad-street-pump. Causes: the 4 KB cap (chess, rice, cube, nerve details), formulas left out (Euler), a photo map and a code-made chart left out (pump, herd immunity), lines wobbling segment by segment instead of as one path (nerve, dashed circles).

## 2026-10-05 — round 2 built

- Lines drawn as ONE rough.js path each, as the engine does; dashes cut geometrically (render/svg-backend.ts dashedPathFromPts).
- Formulas kept as the engine's exact glyph outlines (holes even-odd): no maths library on the front page.
- Points stored as integer differences in one string; cap 20 KB raw. Compressed: median 0.6 KB, largest 4.6 KB.
- Still over the cap: scholar-s-mate (27 items), where-the-206-bones-are (5). Hans: solid vs hatched fills don't matter; a stock chess picture is acceptable.
