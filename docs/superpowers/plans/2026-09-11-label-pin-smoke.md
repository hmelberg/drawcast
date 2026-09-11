# Smoke checklist — the label pin (2026-09-11)

Four minutes by hand. The fix is `LabelPin` (layout/labels.ts): the boundary's
label placement is handed to every tween frame, so a label rides its anchor
instead of being re-solved sixty times a second. What to look for is
**absence** — a label that used to hop no longer does.

## Which examples to play — measured, not guessed

Every bundled example with an `animate` step was swept 40 frames twice, once
without pins (the old behaviour) and once with the boundary's pins, and the
worst single-frame move of every drawn text compared. Five change; the rest
were already still. Play them in this order — the first is the clearest.

| # | Example | worst frame move: was → now |
|---|---------|------------------------------|
| 237 | **A polynomial learns the sine curve** | 264 → **0** |
| 229 | **The tangent turns with the point** | 208 → 21 |
| 228 | **Frequency squeezes the wave** (Hans's report) | 209 → 29 |
| 235 | **Discounting a distant year** | 166 → 14 |
| 5 | **Demand shift, animated** (a TEMPLATE's own labels) | 137 → 12 |

The "now" figures are not residual hopping: they are the label riding an
anchor that itself moves that far per frame. `tests/label-pin.test.ts` asserts
a label never moves further in one frame than the thing it names.

- [ ] **#237** — the Taylor terms switch on while `morph.tex` grows the
      formula. Its labels used to jump a quarter of the canvas; they should now
      be completely still.
- [ ] **#228** — during the six-second `animate: {f: 4}`, the label **"one
      point rides the wave"** stays on one side of the red dot and slides with
      it. It used to teleport between the left canvas edge, the middle and the
      far right — 42 hops in 60 frames.
- [ ] **#5** — proof the fix reaches templates, not just freehand: these are
      `supply_demand`'s own labels, placed by the shared solver.
- [ ] At the end of a sweep a label may settle once into a new spot. **One move
      at the boundary is correct** — the solver runs there on purpose.
- [ ] Scrub backwards and forwards across an animate boundary: the label is in
      the same place at the same time, both directions.

Not covered by the sweep above: examples whose pack is not registered in the
plain test registry (space, anatomy) — 16 of 45 animate examples were
measurable.

## The relayout path (`move`, not `animate`)

Same `frame()` path, different verb. **#231 "An angle is made of its arms"**
(2 labels, 2 move steps) or **#218 "A pin tumbler lock, in section"** (5 move
steps).

- [ ] Labels on the moved element and on its dependents glide; none jumps to a
      different side mid-move.

## 4. The explore tray (free bonus, worth one look)

Open a cast with `explore` sliders and drag one.

- [ ] Labels move smoothly with the drag rather than flicking between spots.
      Slider previews go through the same `frame()` path as a tween.

## 5. Nothing else moved

- [ ] A cast with NO animation looks exactly as before — the solver is
      untouched at boundaries, and an unpinned request is placed exactly as it
      always was.
- [ ] A label far from its anchor still draws its dashed leader line (the pin
      carries the leader flag).

## Known, not fixed by this round

- **The planets.** `solar_system` places its own names (packs/space.yaml) and
  is out of reach of the pin. Mercury's name still steps as it orbits — 60/60
  frames, up to 90 units. Its own round; see the ROADMAP entry.
- **Edge-clamped text** shifts a few units at the settle, because
  `nudgeTextsIntoCanvas` runs at mount/remount but not on tween frames.
