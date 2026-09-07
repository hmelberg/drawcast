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

- **The centre of a portrait loses a click to its own axis.** `hitElement`
  (`src/ui/hit.ts`) judges outlined shapes on their outline and everything else
  on its box, smallest box wins. `kit.ball` draws a body as one point plus a
  circle `shapeHint`, so a disc declares no outline and competes on its box —
  and the spin axis drawn through it is a thin line whose box is far smaller.
  A click dead centre on the focused body therefore answers `axis`. Harmless
  where it shows: the centre of a portrait is already the focus, so that click
  should change nothing anyway. It would matter to a click question aimed at the
  centre body of a portrait. Pinned by `tests/space-hit.test.ts` so it cannot
  drift unnoticed. The honest fix is to let a filled disc declare an outline,
  which changes hit-testing for every template that draws circle-hinted strokes
  (`src/layout/tier2.ts` does) — a decision for the repository, not this pack.

### Fixed after the round shipped (2026-09-07)

Hans found the ⊕ Space section's "click any moon to look closer" doing nothing.
Two defects, both in figures that draw a `frame`, which is exactly the `focus`
portraits the invitation appears on:

1. **The frame swallowed every click.** It was drawn `closed: true`, so
   `elementRings` handed it a hit outline covering the whole canvas.
   `hitElement`'s outline pass returns the smallest outline containing the point
   and never reaches the box pass, so the border answered every click and
   `bodyOfElement` turned that into "not a body, keep the current focus" —
   nothing happened. It is traced now as an open path that returns to its start:
   the same dashed rectangle, no outline. This also silently broke click and
   drag questions on any focus figure, since all three read the same call.
2. **Walking to a moon accused the viewer of an error.** The authored `moons`
   names satellites of the authored focus, so after a click it described a body
   no longer on screen and the figure grew "Unknown: jupiter (not a moon of
   io)". The tray now sends an empty filter with each focus change, which the
   template reads as "this body's own moons".

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

# The space pack — round 2: `sky_map`

The same pack file's second document draws the sky over a place at a moment:
the horizon as a rim, the zenith at the centre, every catalogued star above
the horizon, and the Sun, Moon and planets where a real ephemeris puts them.
Data and rules: `sky/stars.json`, `sky/constellations.json`, `sky-rules.ts`
(pure) and `sky.ts` (the astronomy-engine chunk, reached as `engines.sky`).
The chart geometry — `{ cx: 500, cy: 385, r: 285 }` — is `CHART` in
`sky-rules.ts`, defined once so the template and the tray's click overlay
cannot disagree.

## The data, and what makes the figures gradeable

`sky/stars.json` and `sky/constellations.json` are generated once by
`scripts/build-sky-data.mjs` and committed; the app never fetches them at
runtime. d3-celestial draws each constellation as raw coordinate polylines,
which cannot be checked against anything. The build snaps every vertex to
its nearest catalogue star — within 0.35°, all but one of them — and stores
each figure as pairs of Hipparcos numbers instead of coordinates: 741 edges
over 88 figures. That is what makes "draw Orion" gradeable against a fixed
answer key, and it is why the edges ship this round even though the
`connect` widget that will read them (spec §6.2 Direction B) does not.

The source is pinned to a commit SHA, not `@master`. The doc that planned
this round measured 735 edges from 800 vertices on 2026-09-06; the same
script run live against `@master` on 2026-09-07 returned 741 edges from 893
vertices, because upstream had added detail to the raw lines in between —
the top-five figures by edge count matched the measured doc exactly, which a
snapping bug could not do while moving the total, and the faintest line star
(5.89) matched exactly too. The build now pins that commit, so a wiped-cache
rebuild reproduces the committed files byte for byte — the count that ships
is stable even though the count a live fetch would measure on a given day is
not. See `sky/ATTRIBUTION.md` and `sky/LICENSE` for what is owed to
d3-celestial (the star and line data, BSD-3-Clause) and to the Norwegian
Wikipedia list of constellation names (CC BY-SA) that `sky-names.json` draws
from.

**East is on the LEFT.** A planisphere is held up and looked through, not
laid on the ground, so the projection swaps east and west against a map. The
compass letters sit at `r + 20`, outside the rim.

**The chart is not upside down**, and the way to be sure of that is not the
compass. The canvas is y-up with the origin bottom-left
(`src/layout/canvas.ts:1`) and the ONE flip to SVG's y-down happens at emission
in the backend (`canvas.ts:33`, `render/svg-backend.ts`), so a higher logical
`y` is nearer the top of the page and `place_label` at `y = 24` is the FOOT.
Read logical coordinates without that flip and every figure in the repository
looks mirrored. The compass test only checks that the layout agrees with
itself — negate `project`'s `y` term and the letters turn over with the chart
and it still passes — so there is a second test that ties the orientation to
the sky instead: Polaris, which stands due north at an altitude equal to the
observer's latitude, must be drawn ABOVE the centre, and the star nearest due
east must land left of it.

The alt/az transform itself is hand-rolled — a handful of trig calls per
star — rather than a call to astronomy-engine's own `Horizon()`, and it is
not an approximation that trades accuracy for speed: checked independently
against `Horizon()` for three stars at a fixed instant, the two agree to six
decimal places (`tests/sky-rules.test.ts` pins the bar at four). What the
hand-rolled version buys is a thousand stars projected in a tenth of a
millisecond, against a thousand `Horizon()` calls. J2000 catalogue
coordinates ARE precessed to the date first (`precess()` in `sky-rules.ts`)
— twenty-six years of precession moves a star by about 0.35°, more than a
bright star's drawn radius, so skipping it would visibly mis-place the sky.

## Why these shapes, and not the obvious ones

- **The horizon is an OPEN path that returns to its start**, never
  `closed: true`. A closed stroke becomes a hit outline (`elementRings`), and
  `hitElement` answers with the smallest outline containing the point and
  never reaches the box pass — the rim would win every click meant for a
  star. That is round 1's `frame` bug, met before it could happen. `ring()`
  in the layout closes by pushing a copy of the first point rather than
  recomputing `cos(2π)`, which lands half an ulp off and leaves a hairline
  gap where the pen started.
- **The Moon fills its WHOLE disc before its lit part**, for the same reason
  from the other side: an `area` IS an outline, and the box pass skips any id
  that has one, so a moon that filled only its crescent would lose every
  click on its dark half to whatever lies behind it.
- **The lit half is `COLORS.paper`, the dark half a wash of the Moon's own
  colour, and BOTH are `precise: true`.** Nothing can be painted brighter than
  the warm paper the figure is drawn on, so the phase is drawn the way a hand
  always has: shade the dark side. `precise` is what makes that a knock-out
  rather than a hope — a plain `kit.area` is a *shaded region*, which the
  sketchy backend hachures at `hachureGap: 5.5` and the clean one outlines in
  ink (`src/render/svg-backend.ts`, the two `isExactArea` branches). Across a
  disc 24 units wide that is four hatch strokes, and paper-coloured hatching
  laid between grey hatching hides nothing; without `precise` the lit polygon
  also draws its own 1.8-wide INK outline, so the Moon renders as a struck-
  through circle. `precise` gives one flat filled path, `stroke: none`, at the
  asked opacity, identically in both styles — the same idiom a white chess
  piece uses in `games.yaml`. It changes nothing about `elementRings`, the hit
  test or the lint.
  The terminator is a half-ellipse of semi-axis `r(1 − 2k)` along the bright
  direction — `+r` at new, `0` at quarter, `−r` at full — which makes the lit
  area exactly `k·πr²`, and the test asserts that identity against the
  engine's own `fraction` at eighteen phases rather than thresholds at two.
- **The star field is ONE element** (`stars`), because `draw` has no wildcard
  and no author can know which stars are up at a given hour. `mark` lifts a
  named star out into its own element (id = its proper name in lower case)
  WITHOUT tinting it; `highlight` lifts AND tints. That is what makes
  `{"ask": {"widget": "click", "answer": "sirius"}}` writable — the figure
  does not give the answer away by colouring it. **Its 400 dots share a
  2 200 ms budget**: a group's leaf durations accumulate, so a fixed per-dot
  sketch time would make the field take minutes.
- **The Sun's position is always computed, even when `show` never names it.**
  Whether it is day is a fact about the moment, not about the author's list.
- **The constellation figures are ONE element too** (`figures`), for the same
  reason the star field is: `draw` has no wildcard, and which figures are up is
  a fact about the hour. `mark`, `highlight` or `focus` lifts one out as
  `con_<abbr>`. Their 350-odd segments share a 2 600 ms budget, and a lifted
  figure a 1 200 ms one.
- **An edge is drawn only when BOTH its stars are above the horizon.** A line
  running off into the ground is not what a setting constellation looks like:
  its lower half is simply gone, and that is what a viewer sees.
- **A star a DRAWN line reaches is drawn whatever `limit_mag` says.** 119 of
  the 756 stars the figures need are fainter than 4.5 and 27 fainter than 5.0,
  so a magnitude cut alone would leave the shapes full of holes — and a line
  ending at nothing is a lie about the sky. `tests/sky-template.test.ts` checks
  the strong form of this: every line endpoint lands exactly on the centre of a
  drawn dot, at `limit_mag: 2` as well as at the default. The drawing IS the
  answer key.
  The word DRAWN is load-bearing, and was not there at first. The exemption
  followed the figures being CHOSEN rather than being drawn, so
  `constellations: "names"` — names with no lines — kept every faint line star
  for lines it never drew: 361 dots at `limit_mag: 2` where `"none"` gave 23.
  There is nothing to lie about when there is no line, so `lineStars` is built
  only when `showLines`, and the manifest's `limit_mag` text says which modes
  give the bright stars alone.
- **`take` asks the constellation index first.** "Leo" and "Orion" are figures,
  and no star carries either name. One key really is shared — `Men` is both
  Mensa and a catalogue star name — and the figure wins it.

## `focus`: a portrait is the same projection through a magnifying glass

The figure's own stars are projected as usual; then the plane is scaled about
the figure's centre and shifted to the frame's centre. Nothing about the
geometry changes, so the stereographic stretch near the rim is inherited
honestly rather than hidden. The zoom is whatever fits the figure inside
`FRAME` with 110 units of padding, clamped to 1…6.

The crop is why the horizon is not drawn — there is no rim on the page any
more, so there is no compass either — and a `frame` says "this is a detail"
instead. That frame is traced as an OPEN path that returns to its start: round
1 shipped it `closed: true` and it swallowed every click.

The crop never removes the subject. Above zoom 1 the fit is what chose the
zoom; at zoom 1 the figure's half-span cannot exceed the dome's radius, 285,
while the frame allows 310 above and below the centre it is moved to. What the
crop does remove is the sky AROUND the subject — background stars, and bodies,
which is also what keeps a magnified planet inside the ±4000 the compile guard
allows.

**And what it removes, it says.** The pack's contract is that a thing the
author NAMED is said rather than silently missing, and a portrait is the
biggest way this template can lose one: `{focus: "Orion", mark: ["Vega",
"Polaris"], show: ["jupiter", "saturn", "moon"]}` lost five named things and
wrote an empty caption. A named star, body or constellation that is up but
outside the crop now gets a clause of its own, "Outside view: …", borrowed word
for word from `maps.yaml`, which says the same thing about a marker outside a
cropped map. It is a separate clause from "Below the horizon: …" because it is
a separate fact: a cropped body is NOT reported as set — it has not set, it is
outside the detail, and the caption would be lying if it said otherwise. The
same clause covers a `mark`ed constellation that a portrait excludes, and
`below` now covers a `mark`ed constellation that never rose — which is exactly
the shape of the manifest's own fourth example half the year.

Under `focus` every star the figure's lines reach becomes its own element, so a
question can name any of them — `betelgeuse`, or `hip_25281` where the
catalogue has no proper name. Those are separate elements rather than a group,
but a plan draws them one after another all the same, so their durations
accumulate exactly as a group's leaves do: Orion's 23 dots at `SKETCH_MS.dot`
would be 9.7 seconds of a 17-second page. They take the dot time or a share of
two seconds, whichever is shorter, so a pair of `mark`ed stars on a whole-sky
chart is unchanged.

A figure entirely below the horizon is said so in the caption ("Below the
horizon: The Southern Cross") and the whole sky is drawn instead; it is never a
blank page.

## Constellation names: an atlas names what it has room for

Names go on largest figure first — the shape an eye finds first is the one
worth naming — and only where the name costs NOTHING. A name lying across the
lines of the very shape it names is worse than no name, so a figure with no
free spot goes unnamed: 11 to 24 of the 39 figures up over Oslo get one across
the sweep's 200 moments, 17 on average.

Two things had to be true for those names to mean anything, and the first
attempt at this had neither.

**A name goes ON its own figure**, not next to it. The star and body searches
walk outward from a point until they find free paper, and a constellation's
name walking 90 units out lands in the middle of somebody else's shape:
measured, on one December chart, 21 of 39 names sat nearer another figure's
bounding-box middle than their own — "The Great Bear" 166 units away, in Coma
Berenices. So the candidates are a spread over the figure's OWN extent: its
middle, ellipses at a third, two thirds and the whole of the room its box
leaves for a word, and one last ring a line of type outside the box, for a
figure too small or too solid to hold its own name.

**And the reader's rule is proximity to LINES, not to boxes.** That alone still
left 10 of 39 wrong, because a sprawling figure — Camelopardalis, Lacerta —
has a big box with almost nothing in it, and a name in one of its corners is
nearer the neighbour's stars ("The Giraffe": 52 units from its own lines, 11
from Andromeda's). So a spot nearer another drawn figure's lines than its own
carries a HARD cost, which on the whole-sky chart means the name is simply not
written; and among the honest spots, the soft term prefers the one closest to
its own lines. `tests/sky-template.test.ts` asserts the zero directly.

A portrait is the one exception to "free or nothing": its subject is the whole
point of the page, so its name takes the cheapest spot. (It has no neighbours
to be confused with either, so the ownership cost is vacuous there.)

Because "write nothing" is also lint-clean, the sweep alone cannot justify any
of this. `tests/sky-template.test.ts` holds the floor: at least five names on
the default chart, Orion among them, at least eight on every moment of the
sweep, and three different words in three languages.

## Labels here: hard cost and soft cost

The template places its own names, like round 1's, and against the same
obstacle shape (`{x, y, w, h}` boxes, `boxHit`, seeded from
`captionBoxes()`). What is new is that the price list has two buckets:

- **hard** — off the page (a lint error), another name (an
  `overlap-label-label` warning), a drawn line across the label's core (an
  `overlap-label-stroke` warning). These are what a reader, and the linter,
  call a defect.
- **soft** — how far out the name had to walk (three per candidate ring),
  plus the star dots it ends up sitting on (one each). A dot under a name
  costs no lint at all: `kit.ball` is a one-point stroke with a circle hint,
  and the stroke rule needs two points. It is only untidy — and on a chart
  with four hundred dots, refusing to write over one would leave every name
  off. But a name that walked three rings out to dodge two dots no longer
  reads as belonging to anything, which is what the ring cost buys back.

A BODY always gets its name and takes the cheapest spot; a STAR, and a
CONSTELLATION on the whole-sky chart, takes a spot with no hard cost or goes
unnamed. A body's and a star's candidates aim INWARD first, toward the zenith,
where the dome is emptiest — outward from a body near the rim runs off the
page. A constellation's are a different shape entirely, and the section below
says why.

The clearance a name reserves is a character wider than the word actually
written (`TRANSLATED_ROOM`), because `applyTextMap` swaps the words after this
body has run. That character is reserved against the drawn LINES as well as
against the other names — the core the stroke rule measures is the core of the
padded box, not of the box. It was not, at first, and five of the translation
guard's Italian `label_con_ori` ("Orione") labels grazed a line the English
ones cleared.

Obstacle lists are pruned once per NAME (`boxNear`, `nearSegs`) rather than per
candidate. With the figures on the page `guides` holds 350 more two-point lines
than it did, so it is a FLAT SOUP of endpoint pairs walked once per name rather
than a list of polylines pruned one call each — the difference between a sweep
that runs and one that times out.

Eight candidate sides and three rings were enough for a chart whose only lines
were the rim and the Moon. With the figures drawn, a body's name — which is
always written, free spot or not — landed on a line at four moments of the
sweep. The fix was a wider search, never a lower bar: sixteen sides and five
rings, and the search still stops the instant it finds a spot that costs
nothing at all.

## `show`, and what is not in the sky

`show` takes the same group words `solar_system`'s `bodies` does (`planets`,
`inner`, `outer`, `all`) and keeps EVERY body of an expansion, never just the
first — round 1's own scar, in its `highlight` param. Only the nine the
ephemeris knows can be drawn; Earth rides in on `planets` and `all` and drops
out without a word, because nobody typed its name. A name the author DID type
that matches nothing goes to the caption's "Unknown:" clause, never to an
exception.

A proper name need not be unique: the catalogue calls both HIP 68002 (ζ Cen,
mag 2.55) and HIP 109268 (α Gru, mag 1.73) "Alnair". The BRIGHTER one keeps
the name — in `findStar`'s index and in the template's own `own` list, which
must agree — and the other goes back into the field rather than vanishing from
a sky it is really in. Minting the id twice is not a cosmetic problem: a
duplicate drawable id throws in the compile guard, and `layoutSpec` catches
that as a fall-through to tier-2, which is a WARNING and never an issue.

## A sweep has to prove it swept

`resolveTime` answers a `time` it cannot parse with the real clock, and says
nothing. Its pattern used not to accept the fractional seconds
`Date.toISOString()` always writes, so a 200-moment sweep built the honest way
— `new Date(base + i·step).toISOString()` — was two hundred copies of the
moment the test ran, and passed. The pattern reads them now, and
`tests/sky-template.test.ts` carries the guard that would have caught it:
200 moments must produce 200 different `place_label` clocks before any row of
the sweep is believed.

The same function had the same defect from the other side: a regex match is
not a date. `Date.UTC` and `Date.parse` both ROLL what will not fit rather
than refusing it — `2026-13-45` resolved to 2027-02-14, `2026-02-30` to March
2, `T25:00` to the next day at 01:00 — so a figure could name one date and
draw another. The day is now built and read back out of its own construction
(`realDay`), the clock is range-checked (`realClock`), and anything that
disagrees joins the silent `now` fallback, which is where input that cannot
be used belongs: throwing would blank the figure over a typo. `T24:00:00` is
the one ISO clock that rolls on purpose — midnight ending the day — and keeps
its meaning.

## One caption

Round 1 shipped a known limit: `scale_note` and `missing_note` could collide
in the same foot strip, with the recorded remedy "place the second relative
to the first's measured right edge" — still open, since round 1 ended before
applying it (see round 1's "Known limits" above). This template starts one
step past that instead of repeating it: there is ONE caption, `sky_note`,
composed by `noteClauses()` in `sky-rules.ts` from up to five facts in the
order they matter — daylight, anything named that has set, anything a
`focus` portrait cropped off the page, unknown names, and that the Sun, Moon
and planets are drawn as symbols — joined with " · " and dropped from the
END, cheapest clause last, while the line is still too wide. One caption
cannot collide with itself.

## The ⊕ Sky section (`src/ui/sky-model.ts` + `sky-explore.ts`)

Splits the way round 1's Space section does: the rules — hit-testing, what
is actually on the page right now, the card's formatted facts, the
Wikipedia title — live in `sky-model.ts`, DOM-free and unit-tested against
the real tables; `sky-explore.ts` is the DOM glue, with no unit tests of its
own, same convention as `space-explore.ts`.

It cannot use `hitElement` (`src/ui/hit.ts`): a click inside the `stars` or
`figures` group would only ever answer "the stars" or "the figures," never
a particular one. So it projects the sky itself, with the exact same
`engines.sky.chart` the template drew at, and asks `visibleField` for
precisely the stars and constellation edges the page is showing RIGHT NOW —
gated by `limit_mag`, the `constellations` mode, the `mark`/`highlight`
exemption, and a `focus` portrait's crop and magnifying-glass transform — so
a click can never find something the chart does not draw. `targetAt` then
finds the nearest star or line, a star beating a line at equal distance.

A body (Sun, Moon or planet) is hit-tested on the same footing, but NOT
through `hitElement` either — because that reasoning never applied to
bodies in the first place. Every shown body is its own drawable element in
`space.yaml`, unlike the one-element star field. It was missed in the first
draft of this section anyway, reproducing Hans's one bug report against
round 1 almost exactly (clicking a moon did nothing), and was fixed before
merge rather than left as a known limit: `targetAt` gained a `bodies`
parameter appended after the existing ones, so every old call keeps its old
meaning; `visibleField` gained a parallel body list with the same
focus-crop; and the card renders from round 1's own `cardFacts`/
`bodyLabel`/`phaseLine` — the Moon's phase as a sentence below the facts,
not a fact row, because a phase is not that kind of information.

## Known limits (honest, not fixed)

- **The clock is local SOLAR time**, per `localClock`'s definition in
  `sky-rules.ts` — 21:43 where an Oslo wall clock says 23:00 in summer. It
  needs no timezone table and is deterministic, and `place_label` writes it
  plainly, but a viewer comparing it with their own clock will find it off by
  the zone offset plus the equation of longitude.
- **Seven planets in one patch of sky crowd their names.** `show: ["planets"]`
  during a conjunction season puts five labels in a hand's width of chart;
  they stay lint-clean and each stays nearest its own dot, but they are
  tight. The figure is honest about it rather than dropping names.
- **The phase reads small.** The Moon is drawn at r = 12 on a chart 570
  across — twenty times its true size, as `sky_note` says — and at that size
  a thin crescent is a subtle shading rather than a shape.
- **Messier objects are not drawn.** `messier: true` is not a param this
  round. The build's source measurement never measured that data's JSON
  shape, and drawing one would add no new machinery — dots on the same
  projection that already exists. A follow-up, not a gap in the design.
- **No deeper stars at runtime.** `limit_mag` stops at 4.5, the faintest the
  bundled union holds. The spec offered a jsdelivr fetch beyond that, but a
  layout body runs synchronously and the engine loads before any params are
  known, so the value that would trigger the fetch is read at a point where
  nothing can await it. Dropping the feature removes a promise the
  architecture could not have kept.
- **`focus` magnifies; it does not re-project.** A portrait scales the same
  stereographic plane about the figure's centre rather than re-centring the
  projection there, so a constellation low on the horizon carries the rim's
  stretch into its close-up (see "`focus`: a portrait is the same
  projection through a magnifying glass" above). Honest, and visible;
  re-centring means a second projection origin and a second set of
  geometry tests.

## Ids

`horizon`, `compass_n/e/s/w`, `stars`, `figures`, `place_label`, `sky_note`,
`title`; one id per drawn body (`sun`, `moon`, `mars`, …) and `label_<id>`; a
star named in `mark` or `highlight` becomes `<proper name in lower case>` with
`label_<that>`. A constellation named in `mark`, `highlight` or `focus` becomes
`con_<abbr in lower case>` with `label_con_<abbr>`; under `focus` its stars get
`hip_<number>` where they have no proper name, and the crop is bordered by
`frame` (which replaces `horizon` and the compass).

## Rounds ahead

Round 2 shipped the ⊕ Sky section along with the chart itself — see above.
Open, and deliberately not this round: `ask.widget: "connect"` (spec §6.2
Direction B — given a name, draw the lines; the 741-edge answer key already
ships), Messier objects, stars fainter than 4.5 at runtime, a `focus` that
re-centres the projection rather than magnifying it, and the language
wrinkle in spec §6.2 — `ask.answer` is one string, so a figure with three
names needs the question to say which one it wants. Round 3:
`model3d: { kind: space }` (three.js) — `texture` in the table is reserved for
it.
