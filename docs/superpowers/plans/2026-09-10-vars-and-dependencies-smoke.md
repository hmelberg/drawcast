# Smoke checklist: vars and dependencies (the manim round, part 1)

For Hans, in the app (Editor → Examples). Each item names what to load and
what to watch for. A ✓ per line, or a note of what looked wrong.

## 1. "Why does a higher frequency squeeze the wave?"

- [ ] The wave draws once; the red dot sits ON the wave; the readout says
      `f = 1`.
- [ ] During the six-second sweep the wave compresses continuously, the dot
      rides up and down with it, and the readout counts `1` → `4` (one
      decimal, no `.0`).
- [ ] The label "one point rides the wave" stays near the dot the whole way.
- [ ] The last beat slides the dot rightwards along the squeezed wave.
- [ ] Scrub back across the sweep: the frame at any point of the bar matches
      what played; step back/forward lands exactly on `f = 1` / `f = 4`.

## 2. "What is the tangent at a point, and how does it turn as the point slides?"

- [ ] The dashed tangent touches the curve at the dot and leans with it.
- [ ] During the seven-second sweep the dot slides along the sine curve and
      the tangent turns: flat at the crest, steepest through zero, flat in
      the trough. The readout `x = …` counts up.
- [ ] The glow at the end lands on the tangent where it stopped.

## 3. "Does the equilibrium follow when demand shifts?"

- [ ] After the three-second move the demand curve has shifted right and a
      faded ghost stays where it was.
- [ ] The intersection dot, its two guide lines and the yellow wedge moved
      WITH the curve — the dot is still on both curves, the guides still
      reach the axes from it, the wedge's top edge is the new demand.
- [ ] The laser circles the NEW equilibrium.
- [ ] `erase demand_ghost` removes the ghost, nothing else.
- [ ] Scrub back before the move: dot, guides and wedge are back at the old
      crossing; scrub forward again: at the new one. No flicker, no double
      shift.

## 4. "What happens to the angle when one arm turns?"

- [ ] The arc sits between the two arrows and writes its degrees (about 22°).
- [ ] The first turn widens the arc and the number climbs to about 72°; the
      second turn shrinks it through zero and it grows the other way round
      (about 352°). The turning arm's label follows the arm.
- [ ] The glow at the end lands on the arc where it now is.

## 5. Export

- [ ] Export example 3 (or 1) as WebM: the moved geometry and the sweep are
      in the video exactly as in the player; the ghost is faded in the video.

## 6. Nothing else moved

- [ ] Load the πr² example (circle sectors zipped into a rectangle) and the
      cycloid example: they play exactly as before (no dependents, so the
      old path).
- [ ] Load any template example with an `animate` (a bar chart's stage, the
      demand shift template): plays and scrubs as before.
