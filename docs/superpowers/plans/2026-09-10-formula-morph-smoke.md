# Smoke checklist: formula morph, term colours, copy and parametric curves (the manim round, part 2)

For Hans, in the app (Editor → Examples). Each item names what to load and
what to watch for. A ✓ per line, or a note of what looked wrong.

## 1. "How do you solve 2x + 3 = 11?"

- [ ] `2x + 3 = 11` draws; `x` is blue throughout, everything else the
      default ink.
- [ ] The equation glows.
- [ ] A copy appears exactly on top of the line, then glides straight up
      (about 1 s) — nothing else moves.
- [ ] The copy morphs (about 1.5 s): the `+ 3` fades out, the `11` becomes
      `8`, `2x` and `=` glide into their new spacing. `x` stays blue the
      whole time, including mid-morph.
- [ ] A second copy is minted off the `2x = 8` line, glides up again, and
      morphs to `x = 4`: `2x` becomes `x`, `8` becomes `4`, `=` glides.
      `x` stays blue.
- [ ] By the end, three lines are stacked bottom to top: `2x + 3 = 11`,
      `2x = 8`, `x = 4`. The top line glows.

## 2. "What does the ICER compare?"

- [ ] The title and `\text{ICER} = \frac{C_1 - C_0}{E_1 - E_0}` draw; the
      `C` terms in the numerator are red, the `E` terms in the denominator
      are blue, `ICER` itself stays the default ink (no colour bleed into
      the acronym's own letters).
- [ ] The formula glows.
- [ ] The morph (about 1.5 s): `C_1 - C_0` collapses into `\Delta C`,
      staying red; `E_1 - E_0` collapses into `\Delta E`, staying blue;
      `\text{ICER} =` and the fraction bar hold their place (matched, not
      refaded).
- [ ] The example line ("$500 more, 0.1 extra years → $5,000 per year")
      draws underneath.
- [ ] The formula glows again.

## 3. "Why do cos and sin draw a circle?"

- [ ] Title and axes draw.
- [ ] A red point and a grey arrow from the origin appear at `(1, 0)`.
- [ ] A near-invisible sliver of blue curve and the label `(\cos t, \sin
      t)` draw at the point.
- [ ] Over the 5-second sweep: the blue curve draws itself progressively,
      the red point rides its leading edge, the grey arrow keeps its tail
      at the origin and its head on the point — by the end, a full circle
      of radius 1 is drawn and the point is back near its start.
- [ ] The arrow glows at the end.

## 4. Scrub across a morph

- [ ] Pick either equation example, start playback, and drag the seek bar
      to a point mid-morph, then back to before it starts. The mid-morph
      frame matches what played (matched shapes partway between old and
      new position, fading shapes at partial opacity); scrubbing to before
      the morph shows the plain old formula, no residue.
- [ ] Step frame-by-frame (or scrub slowly) across one morph boundary: no
      flicker, no double-draw, no shape jumping to a wrong place at the
      last frame.

## 5. Export

- [ ] Export example 1 or 2 as WebM: the copies, the moves and both morphs
      play in the video exactly as in the player, colours intact.

## 6. Nothing else moved

- [ ] Load "What does E = mc² actually say? Show me the curve it comes
      from." (a plain `math` element, no `colors`, no morph): renders as
      before.
- [ ] Load the "Logistic growth: equation to plot" playlist (an
      `equation_steps` template with no `colors` param): renders as
      before.
- [ ] Load any example from part 1 (the frequency sweep or the sliding
      tangent): plays and scrubs as before — `vars`, `bind` and dependents
      are untouched by this round.
