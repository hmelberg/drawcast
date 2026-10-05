# Card lab ledger

Ratings and notes from the card lab (`npm run cardlab`, then `card-lab.html` on `npm run dev`).
Paste the page's "Copy ledger" lines here after each round.

## 2026-10-05 — round 1 built

- 112/112 library casts compiled; median card 2.2 KB (largest 4.1 KB) without icon drawings; icons median 0, largest 34.8 KB (dinosaur quiz).
- Small renderer 13 KB gzip; all 112 cards drawn in ~50 ms, ~190 ms at 4× slower CPU.
- Left out (casts affected): formula glyphs 24, over the 4 KB cap 13, photos/raster pictures 2, code 1.
- First look: the drawing stops at the poster frame (answers stay hidden); a code-made chart (herd immunity) is a raster and is left out.
