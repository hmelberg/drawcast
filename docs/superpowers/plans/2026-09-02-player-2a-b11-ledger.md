# Player Part 2a + B11 — ledger (2026-09-02)

Plan: `2026-09-02-player-2a-b11-plan.md`. Delivered in three commits:
B11 clone-at-render-entry, the all-SVG icon pass, the subtitle band.
Suite 2853 → 2860.

## Rulings

1. **Band alpha is 0.6, not D1's "~0.55" — by measurement.** The worst
   case (band over bare paper `#fffefb`) blends to **3.86:1** at 0.55 —
   under AA for 1.15rem text — and **4.53:1** at 0.6, the lightest alpha
   that passes. Computed with `tests/contrast.ts`, never eyeballed (the
   round-two lesson: contrast numbers get claimed without being computed).
   `tests/caption-band.test.ts` pins both directions (≥ 4.5:1 over paper,
   alpha ≤ 0.65 so the wall of ink cannot creep back).
2. **The roadmap's export worry was stale.** D1 warns the band is burnt
   into exported video; `export/video.ts` paints captions *below* the
   figure in ink on paper and never draws the CSS band. Player-only
   change, no export delta.
3. **Every glyph, one pass (review R4), but CC stays text.** `▶ ⏸ ⏮ ⏭ ▭
   ⛶ ⋯ ↺ 🔊 🔇` all became Material-geometry inline SVG taking
   currentColor (`ui/icons.ts`, pure-data `ICON_PATHS` drift-tested in
   node — h() still throws there). "CC" is a wordmark, like YouTube's,
   and keeps its underline-when-on convention.
4. **Icons carry their size as presentation attributes** (`width/height
   ="1.15em"`) besides the `.cs-icon` rule: an SVG with only a viewBox
   defaults to 300×150, and the control bar should not depend on a
   stylesheet being present to avoid that.
5. **B11 mirrors publish/embed.ts** — same injected-deps shape, same
   "prove it with scribbling fakes" test. `main.ts:4048`'s counter
   workaround (re-parse the editor text for Share) is left in place: it
   is also the freshness guarantee for a dialog over a live textarea,
   not just a leak patch.
6. **`.cs-bigplay` gained `display:grid`** to center its icon; the later,
   more specific `.cs-stage.is-playing .cs-bigplay { display:none }`
   still wins, so hide-while-playing is unaffected.

## Open

- Hans's eyes on the new bar (macOS was the complaint) and on the lighter
  band — one look before 2b builds on this.
- Part 2b remains: progress-bar row above the buttons, left/right groups,
  title below the player, chapter-gate default, hover-scrub/seek
  behaviours (C7, C9, C10, C11) — the half that touches fullscreen
  sizing and its drift test.
