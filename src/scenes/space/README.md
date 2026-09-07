# The space pack — round 1

`solar_system` draws the Sun, planets, dwarf planets and (under `focus`)
moons for a date, at a chosen scale. Design:
`docs/superpowers/specs/2026-09-06-space-design.md`.

## Data and licences

- `bodies.json` — 35 bodies (radius, mass, semi-major axis, period,
  eccentricity, rotation, tilt, colour, ring, names en/nb, Wikipedia titles).
  Values from the NASA Planetary Fact Sheets and Planetary Satellite Fact
  Sheet (public domain); colours, Norwegian names and the `l0_deg` sketch
  longitudes are ours.
- Positions: [astronomy-engine](https://github.com/cosinekitty/astronomy)
  2.1.19, MIT, loaded lazily with the engine. Sun, planets and Pluto through
  `HelioVector`, the Moon through `GeoMoon`, the Galilean moons through
  `JupiterMoons`; every other body — the rest of the moons, and the dwarf
  planets other than Pluto — rides a circular orbit of radius `a_km`,
  advancing at a constant (mean) rate from `l0_deg` (the ⊕ card says
  "position schematic" for those; `EPHEMERIS_IDS` in `ephemeris.ts` is the
  exact line between the two).
- The ⊕ card fetches the Wikipedia REST summary (CC BY-SA, credited on the
  card) at runtime; a failed fetch leaves the table's facts alone.

The table stores the physical constants and the display metadata; the engine
computes everything date-dependent — where a body IS. Nothing in `bodies.json`
is a live position: `l0_deg`, where present, is a fixed reference-epoch
angle the circular sketch advances from, not a place any body currently
occupies. `positions()`/`moonPositions()` take a `Date` and return AU or km;
the pure rules in `rules.ts` turn those into pixels for a given scale mode
and frame. `resolveDate` is the pack's one clock: every other function here
is deterministic given the date it is handed, which is what lets the layout
tests pin a date and a Playwright smoke script drive the real one.

## The four scale modes, and why there are four

No single drawing can show true sizes and true distances on one page — Earth
at Jupiter's true distance and Jupiter at its true size would need a canvas
kilometres wide either way. So `scale` picks which truth the figure keeps,
and says so in `scale_note`:

- **schematic** (default) — sizes compressed toward readable, orbits spaced
  evenly. Nothing is measurable; it is a map, not a photograph.
- **sizes** — true relative radii, orbits still evenly spaced. Jupiter is
  eleven Earths across; in the `row` view the Sun is so large that only its
  edge fits the page, and what is drawn is the circular segment inside the
  frame (`sunSegment`). The `reduced` wording of `scale_note` ("Sizes to
  scale, Sun reduced, distances not") is NOT the row's: it belongs to the
  views that shrink the centre body rather than clip it — from above, and
  under `focus`.
- **distances** — true relative orbit radii, every body drawn the same small
  dot. Pair it with `bodies: ["inner"]` or `["outer"]` — the whole system at
  once crowds the inner planets into the Sun.
- **log** — orbit radius by the log of the distance, so the inner and outer
  planets both get room; a decade ruler (`scale_bar`, e.g. "1 → 10 AU")
  appears when a clean decade pair fits the drawn range.

## Labels: two rules from round 1's label-placement fix (Task 7b)

Two different views place names two different ways, because they have two
different problems.

**Top and tilted views (the "from above" branch of `solar_system`'s layout in
`src/scenes/packs/space.yaml`, shared by both since `tilted` is the same
picture through a leaning camera): a name is written along its own orbit,
and that one orbit ducks under it.** With
eight evenly spaced orbits the gap between rings is 33 units, and the core of
even a short name is wider than that — no ring gap can hold a label at any
readable size, so a name that clears every ring does not exist. Sitting ON
its own ring is the one placement whose core stays clear of every OTHER
ring; the two neighbouring rings are broken only across the label's box and
picked back up on the far side, the way a contour line on an atlas breaks for
its own elevation number. This is placed by the template itself, not the
shared label solver in `layout/labels.ts` — the solver's eight compass sides
around a point cannot aim a label at a specific 33-unit gap on a specific
ring, and the break has to know exactly where the name landed before the
orbit is drawn.

**The `row` view: a tier step derived from the type, not a fixed pixel
count.** Names sit under their bodies, stepping up through numbered "tiers"
(`labelTiers`) when neighbours are too close to share a line. The step
between tiers is a real line of type — `LABEL_PX * 1.25 + 4`, the font's own
line height plus a little air — because a fixed step breaks the moment two
neighbouring bodies differ enough in radius that a larger one eats into a
smaller step (Venus and Earth's labels missed each other by 0.05 units at
one fixed guess during development). Each name then climbs whole tier-steps
until its box is actually clear of every name already written, rather than
trusting the tier index alone.

Both branches measure against the same list, in the same shape: boxes
`{x, y, w, h}` at the low corner, compared with `boxHit`, seeded with the
captions from `captionBoxes()` — the notes, the title and the bar's label are
pushed at the end but their boxes are fixed long before, and a name has to see
them. The row's own step is DOWNWARD (under the body), and below a disc that
fills the frame the next line is the caption strip and then the edge of the
page; when the search below fails, the same search runs upward from the same
start and the name ends on the disc itself, where it reads on its halo and no
lint rule sees it (a body is a circle hint, not a polyline).

## Known limits (honest, not fixed this round)

- **`bodies: ["all"]` still produces warnings.** The group expands to the
  eight planets and five dwarf planets — 13 bodies on top of the usual eight
  — and in most view/scale combinations that crowds `overlap-label-stroke`
  or `overlap-label-label` warnings out of the linter (e.g. Jupiter's label
  sitting on Saturn's orbit). These are `severity: "warn"`, not `"error"`, so
  the figure still draws and the tests that gate on it (`space-template.test.ts`)
  only fail on errors — but a real drawcast built with `bodies: ["all"]`
  will carry warnings in its lint report. Only three of the twelve
  view × scale combinations stay clean — `row` at `schematic`, `sizes` or
  `log`; `row`/`distances` collides Mercury's and Venus's labels with the
  Sun's, and every `top` and `tilted` combination collides at least one
  label with an orbit.
- **A wide enough foot strip collides two captions.** An unknown name in
  `bodies` writes `missing_note` ("Unknown: …") across the middle of the strip
  along the foot; `scale_note` starts at the left of that same strip, and from
  above at `scale: "sizes"` it grows to its `reduced` wording ("Sizes to
  scale, Sun reduced, distances not") and reaches it — a genuine
  `overlap-label-label` warning between `scale_note` and `missing_note`.
  Reproduce with `{ scale: "sizes", bodies: ["planets", "krypton"] }`. A row
  clips the Sun rather than shrinking it, so its note never takes the longer
  wording and it needs a longer list of unknown names to collide the same two
  captions — `bodies: ["planets", "krypton", "vulcan", "romulus", "tatooine"]`
  does it.

  The collision stays between the two CAPTIONS: no name is caught up in it,
  swept over 200 dates in the top view AND in the row
  (`tests/space-template.test.ts`, "in the … view, no name is caught in the
  strip where two captions collide"). That containment is a claim this file got
  wrong once, and it is worth saying why: the sweep ran the default `top` view only, while the
  row seeded its obstacle list empty and never consulted `captionBoxes()` at
  all, so `{ view: "row", scale: "sizes", bodies: ["jupiter", "krypton"] }`
  wrote Jupiter's name straight across `missing_note`. Both branches measure
  the same caption boxes now, and the sweep covers both.

Neither breaks anything — both are `warn`-level lint, and the figure is
still correct — but a developer chasing lint noise on a real request should
know these two are structural, not a regression.

## Ids

Body ids are the English names in lower case and ARE the element ids
(`mars`, `io`); `orbit_<id>`, `label_<id>`, `axis`, `frame`, `scale_note`,
`scale_bar`, `missing_note`, `title`.

## The engine (`engines.space`)

`all`, `body`, `bodies` (group words `planets | inner | outer | all` expand
in place), `moonsOf`, `satellites`, `resolveDate` (the pack's only clock),
`positions` (AU, heliocentric ecliptic, z kept for round 3), `moonPositions`
(km), `phase`, `schematic`, `au`, `km`, and the scale rules from `rules.ts`.

## The ⊕ Space section (`src/ui/space-model.ts` + `space-explore.ts`)

The tray's Space section splits the way the anatomy Body section does: the
rules — what a click means, the breadcrumb chain, the pills' choices, the
card's formatted facts, the Wikipedia URL and response shape — live in
`space-model.ts`, DOM-free and unit-tested against the real table.
`space-explore.ts` is the DOM glue: it renders the hint, crumbs, pill rows
and card, and wires the click overlay. Keep it that way — anything that can
be expressed as a pure function of the table and the current params belongs
in `space-model.ts`, where a test can pin it. `space-explore.ts` itself has
no unit tests of its own (the anatomy Body section is the same); the manual
smoke checklist (`docs/superpowers/plans/2026-09-06-space-round-1-smoke.md`)
is what actually exercises its DOM wiring — a reason, not an excuse, to keep
that file as thin as possible.

## Rounds ahead

Round 2: `sky_map` + the `sky` engine. Round 3: `model3d: { kind: space }`
(three.js) — `texture` in the table is reserved for it.
