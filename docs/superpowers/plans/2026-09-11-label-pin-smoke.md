# Smoke checklist — the label pin (2026-09-11)

Four minutes by hand. The fix is `LabelPin` (layout/labels.ts): the boundary's
label placement is handed to every tween frame, so a label rides its anchor
instead of being re-solved sixty times a second. What to look for is
**absence** — a label that used to hop no longer does.

## 1. The frequency sweep — the figure Hans reported

Open the bundled example **"Frequency squeezes the wave"** (request: "Why does
a higher frequency squeeze the wave?") and play it.

- [ ] During the six-second `animate: {f: 4}`, the label **"one point rides the
      wave"** stays on one side of the red dot and slides with it. Before the
      fix it teleported between the left canvas edge, the middle and the far
      right — 42 hops in 60 frames.
- [ ] At the end of the sweep the label may settle once into a new spot. **One
      move at the boundary is correct**; the solver runs there on purpose.
- [ ] Scrub backwards and forwards across the animate boundary: the label is in
      the same place at the same time, both directions.

## 2. The second animate in the same cast

- [ ] `animate: {t: 10}` slides the dot along the squeezed wave. The label
      follows it the whole way, keeping its offset.

## 3. A relayout tween (not just animate)

Any example with `move` on an element something else is defined by — e.g.
**"Lead-time bias"** (#2 of the six longer examples) or **"The tangent that
slides"**.

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
