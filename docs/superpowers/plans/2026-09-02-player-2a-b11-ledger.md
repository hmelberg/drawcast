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

## Follow-up round, same day (Hans's ruling on 2b)

Hans: leave the progress bar inline for now; add a little space between the
y arrowhead and its label; then do title + chapter. Delivered in three
commits (suite → 2861):

7. **The y-label had NO possible gap on the standard plot — measured, then
   fixed structurally.** plotArea() left 33 units above the arrow tip for a
   35-unit label box, so the canvas-top clamp pressed the label onto the
   arrowhead regardless of Y_LABEL_GAP; PPF (the B13 test case) is a
   standard-plot template. Fix: PLOT_MARGIN.top 55→75, the four `y1: 695`
   template literals →675 (every template that chose its own plot already
   tops out ≤630), Y_LABEL_GAP 8→12. The whole 2861-test suite — including
   the 114-spec lint sweeps — passed on the new geometry unchanged.
8. **C9 both halves.** DOM: title appended after the stage; the bar's
   `afterend` insert lands between them → drawing → bar → title, and the
   fullscreen flex column carries the order with no sizing change. Prompt:
   the STYLE.md 2026-09-01 "title counts as something" rule (status was
   *not yet in the prompt*) folded into the compiler prompt's "Start on the
   canvas" opening rule; drift test pins it. No full title card for
   singles, per review R5.
9. **C10 is a default flip, not a mechanism** — exportSequence has
   hardcoded auto all along. Serializer omits defaults, so playlists that
   never wrote `advance` flip with it: ruled fine (replace-don't-freeze,
   review note 5). The parse-warning fallback text follows the default.
10. **C11: the pill's words are the distinction.** A click-gated chapter
   card says "Next chapter ▸"; "Click to continue ▸" now always means an
   authored `wait`. Under the auto default the chapter card usually just
   holds `gap` seconds and dissolves (its `clear`), which is D8's
   recommendation 3 verbatim.
11. **Progress bar stays inline** — Hans's explicit ruling, recorded on C7.
   D6's remaining behaviours (hover-scrub, time readout, grouping) stay
   open there.

## Open

- Hans's eyes on: the new bar icons (macOS was the complaint), the lighter
  band, the y-label gap (PPF), the title under the player, and a course
  crossing chapters on the timer.
- C7 remainder: hover-scrub/seek preview, time readout, left/right
  grouping — and the progress-bar row only if Hans ever reverses the
  ruling.
