# Space: the solar system, the night sky and a 3D panel — design

Date: 2026-09-06. Status: approved by Hans (chat, 2026-09-06): two templates on
one shared engine, three.js as the 3D backend with bundled textures, rounds in
the order 1 → 2 → 3. Sketch circles in the figure, photos only in the ⊕ card.
No iframes.

## 1. What this adds

A new pack `space` with two templates and one 3D panel kind:

| Round | Deliverable | Standpoint |
|---|---|---|
| 1 | `solar_system` template + `space` engine + ⊕ "Space" section | above the solar system (heliocentric) |
| 2 | `sky_map` template + `sky` engine | from a place on Earth (geocentric) |
| 3 | `model3d: {kind: space}` — three.js panel for both templates | free camera |

Template policy (ROADMAP.md "Template policy — when a figure earns a template"):
the family meets three of the five criteria — dense repetitive structure (eight
planets, dozens of moons, hundreds of stars), animation with teaching value
(orbits over dates, the sky turning over hours) and constant recurrence in
teaching. Two templates rather than one because the two pictures share almost
no parameters: one has `scale`/`orbits`/`bodies`, the other `lat`/`lon`/`time`/
`constellations`. One template with a `view` switch would give the compiler a
schema where half the fields are meaningless for every request.

## 2. Data strategy — local core, external periphery

Principle (Hans): a small curated core is stored locally; peripheral
information is fetched at runtime from sources that are stable and CORS-open.
Positions are never stored: they are computed for a date.

Verified 2026-09-06 (curl with an Origin header):

| Source | Gives | Size | CORS | Licence | Use |
|---|---|---|---|---|---|
| Curated table `src/scenes/space/bodies.json` | ~35 bodies: radius, mass, semi-major axis, period, rotation, tilt, eccentricity, colour, rings, names en/nb, Wikipedia titles | ~15 KB | – | ours | core, bundled |
| astronomy-engine 2.1.19 (npm, MIT, 116 KB min) | heliocentric vectors for Sun/planets/Pluto, GeoMoon, JupiterMoons, Illumination (phase), Equator/Horizon (RA/Dec → alt/az), SiderealTime, Constellation | 116 KB | npm | MIT | core, lazy chunk |
| d3-celestial data via jsdelivr (`cdn.jsdelivr.net/gh/ofrohn/d3-celestial@master/data/`) | GeoJSON stars (`stars.6.json` 657 KB, 5 044 stars), `constellations.lines.json` 27 KB, `constellations.json` 51 KB (names in 20 languages, NOT Norwegian), `messier.json` 21 KB | see left | yes | BSD-3 | subset bundled (round 2); deeper set optional at runtime |
| Wikipedia REST `…/api/rest_v1/page/summary/<title>` on no. and en. | extract + thumbnail | 2 KB/call | yes | CC BY-SA | ⊕ card, runtime |
| Wikimedia Commons (`upload.wikimedia.org`) | Solar System Scope 2k textures, CC BY 4.0 (`File:Solarsystemscope_texture_2k_<body>.jpg`) | 200–1050 KB each at 2k; 1 686 KB for all 12 at 1280 px | yes | CC BY 4.0 | downscaled and bundled in `public/space/` (round 3) |
| Wikidata SPARQL | long tail (97 moons of Jupiter …) | 0,5 s/call | yes | CC0 | NOT used in these rounds: raw values have mixed units (Mars' a in km, Earth's in AU, Jupiter's mass "1") |
| JPL Horizons / SBDB, NASA Exoplanet Archive TAP | ephemerides, asteroids, exoplanets | – | **no** | – | out of scope (would need a proxy) |
| api.le-systeme-solaire.net | planet data | – | needs API key since 2026 | – | not used |

Rule: nothing in a figure depends on a runtime fetch. A failed Wikipedia call
leaves the ⊕ card with the table's facts only. Star data deeper than the bundled
subset is an optional runtime fetch and its absence changes nothing the figure
promised.

## 3. The `space` engine (round 1)

Location: `src/scenes/space/` (data + pure functions) and the loader in
`src/scenes/engines.ts` next to `loadAnatomy`. Loaded lazily per template, like
anatomy; imports astronomy-engine and `bodies.json` dynamically.

### 3.1 The bodies table

`src/scenes/space/bodies.json`, one entry per body:

```
{ "id": "jupiter", "kind": "planet",           // star | planet | dwarf | moon
  "name": { "en": "Jupiter", "nb": "Jupiter" },
  "parent": "sun",
  "r_km": 69911,                                  // mean radius
  "mass_kg": 1.898e27,
  "a_km": 778.5e6,                                // semi-major axis around parent
  "period_d": 4332.6,                             // sidereal orbital period, days
  "e": 0.049,
  "rot_h": 9.93,                                  // sidereal rotation, hours; negative = retrograde
  "tilt_deg": 3.1,
  "color": "#c9a678",                             // 6-digit hex (shades best)
  "ring": { "inner": 1.24, "outer": 2.27, "color": "#d8c9a3" },   // radii in body radii; Saturn only (Uranus omitted)
  "wiki": { "en": "Jupiter", "nb": "Jupiter" },
  "texture": "jupiter.jpg" }                      // round 3
```

Bodies (35): sun; mercury, venus, earth, mars, jupiter, saturn, uranus, neptune;
dwarfs pluto, ceres, eris, haumea, makemake; moons moon (earth), phobos, deimos
(mars), io, europa, ganymede, callisto (jupiter), mimas, enceladus, tethys,
dione, rhea, titan, iapetus (saturn), miranda, ariel, umbriel, titania, oberon
(uranus), triton (neptune), charon (pluto). Values from the NASA planetary fact
sheets; the table carries a `source` line. Ids are the English names in lower
case and ARE the element ids — the same rule as anatomy.

Groups the template accepts in `bodies`: `planets` (the eight), `inner`
(mercury–mars), `outer` (jupiter–neptune), `all` (planets + dwarfs). Moons are
named individually or by parent (`"jupiter"` in `moons` = its four Galilean
moons; every listed moon of that parent when `focus` is on it).

### 3.2 Positions

- Planets, Pluto: `HelioVector(body, date)` from astronomy-engine, ecliptic
  J2000 → the engine returns `{x, y}` in AU in the ecliptic plane (z ignored
  in 2D; kept for round 3).
- Earth's Moon: `GeoMoon(date)`; Jupiter's four: `JupiterMoons(date)`.
- Every other moon: a circular orbit of radius `a_km` with phase angle
  `2π · (t − J2000) / period_d`. Honest approximation for teaching; the ⊕ card
  says "position schematic" for those.
- `days`: a numeric offset from `date`, the animatable handle (`animate` only
  moves numbers).
- Moon phase: `Illumination("Moon", date).phase_fraction` plus the
  waxing/waning sign from `MoonPhase`.

Engine API seen by layouts (`engines.space`):

```
bodies(sel: string[] | "planets"|"inner"|"outer"|"all") → { bodies: Body[], missing: string[] }
body(id) → Body | undefined
positions(ids: string[], date: Date) → Record<id, {x: number, y: number, z: number}>   // AU, heliocentric ecliptic
moonPositions(parentId: string, ids: string[], date: Date) → Record<id, {x, y}>       // km, parent-centred
phase(date: Date) → { fraction: number, waxing: boolean, name: string }
au(km) / km(au)                                                                          // unit helpers
```

### 3.3 Sizes and the scale problem

No drawing can show both sizes and distances truthfully (Sun 10 cm → Neptune
646 m away). `scale` is therefore a parameter and every figure states which
truth it keeps, in a `scale_note` element:

| `scale` | radii | orbit radii / spacing | note text (en) |
|---|---|---|---|
| `schematic` (default) | compressed: `r ∝ sqrt(r_km)`, clamped so the Sun ≤ 1/6 of the frame | even spacing | "Not to scale" |
| `sizes` | true relative radii; the Sun drawn as the visible circular segment inside the frame (never off-canvas — lint treats out-of-canvas as an error) | even spacing | "Sizes to scale, distances not" |
| `distances` | every body the same small dot | true relative orbit radii | "Distances to scale, sizes not" |
| `log` | `sqrt` sizes | orbit radius ∝ log(a) | "Log distances" |

A `scale_bar` element with a label (`1 AU`, `100 000 km`) accompanies `sizes`,
`distances` and `log`.

## 4. Template `solar_system` (round 1)

Pack `space` (`src/scenes/packs/space.yaml`), `engines: [space]`, `kit` current
major, `status: ready`. Params — content only, never coordinates:

| param | type | meaning |
|---|---|---|
| `bodies` | array of ids, or one of the group words | which bodies (default `planets`) |
| `view` | `top` (default) \| `row` \| `tilted` | orbits seen from above with real angles; the classic line-up for size comparison; a 30° tilted view through `kit.project3d` |
| `scale` | see §3.3 | default `schematic` |
| `date` | ISO date or `today` (default) | positions on the orbits |
| `days` | number, −3650…3650 (default 0) | offset from `date`; the animatable handle |
| `orbits` | boolean (default true; ignored in `row`) | dashed orbit circles, ids `orbit_<id>` |
| `moons` | array of moon ids or parent ids | drawn ONLY around a `focus` body (invisible at any honest scale otherwise) |
| `focus` | one body id | that body large in the centre with its moons, ring and axial tilt; frame crops; everything else omitted |
| `names` | `en` \| `nb` \| `none` (default `en`) | label language |
| `highlight` | array of ids | tint for the whole figure (the `highlight` COMMAND glows for one sentence) |

Rules:
- Element ids are body ids, so `ask` with `widget: "click"` and `widget: "drag"`
  work without new machinery. Drag items that are elements stay hidden until
  the reveal, so "drag Mars to where it belongs" is an ordinary drag question.
- Bodies are shaded circles: one circle with a radial-gradient fill lit from
  up-left (the same look as `kit.project3d`'s `sphere`; the layout may use
  `project3d` with `elevation: 90` for `top` to get it, or the same gradient
  drawable directly — the plan decides after reading `kit.ts`). Colours from
  the table. Saturn's ring is an ellipse behind and in front of the disc.
  The Sun is a shaded circle in `#f5b400`-ish with no glow effects.
- Labels: written names next to each body, language from `names`; in `top`
  view with real angles they may collide — use `kit` label placement with
  leader lines where the pack kit offers it, else offset by quadrant.
- Unknown ids are skipped and listed in a small note (anatomy's rule).
- Lint budget: ≤ 4000 drawn points per figure (existing atlas rule); no element
  outside the canvas.

Bundled examples (`src/examples.json`, each with `"packs": ["space"]`, zero lint
issues including warnings):
1. "Which one is Mars?" — `top`, `schematic`, click question answer `mars`.
2. "How big is Jupiter?" — `row`, `sizes`, a quiz comparing Uranus and Neptune.
3. "Put the planets in order" — `row`, `names: none`, drag question whose items
   are the eight planet ids with labels; `right` names the order.
4. "Where are the planets today?" — `top`, `distances`, `bodies: inner`,
   `animate` on `days` 0 → 687 so Mars laps Earth.
5. "Jupiter and its moons" — `focus: jupiter`, `moons: [jupiter]`, then
   `explore: {space: true}`.

## 5. The ⊕ "Space" section (round 1, extended in round 2)

`explore: {space: true}` (schema flag beside `anatomy`) opens a Space section
built on the Body section's pattern: `src/ui/space-explore.ts` (DOM) and
`src/ui/space-model.ts` (pure rules, node-testable), wired in `src/ui/tray.ts`.

- Click a body in the figure → preview `focus` on it (its moons appear);
  breadcrumbs Sun → Jupiter → Io; click the breadcrumb to go back up.
- Pills: `scale` (four modes), `names` (en/nb/none), `date` (today, −1 y, +1 y).
- Info card for the current body: name, radius, distance from parent, period,
  rotation, tilt from the table, then the Wikipedia summary in the section's
  language (nb when `names: nb`, else en) with its thumbnail, fetched on demand
  and cached per session; on failure the table facts stand alone. Credit line:
  "Wikipedia, CC BY-SA" with the article link.
- Continue restores the authored params (the tray's `previewParams` /
  `overrides` mechanism).

## 6. Template `sky_map` and the `sky` engine (round 2)

The sky from a place at a time, as a full-sky dome: stereographic projection
centred on the zenith, the horizon as the outer circle, N at the top and E on
the LEFT (a planisphere held overhead). Objects below the horizon are omitted.

`sky` engine (`src/scenes/space/sky.ts` + loader) bundles:
- `stars-45.json`: the 921 stars to magnitude 4,5 from `stars.6.json`
  (HIP id, RA deg, Dec deg, mag, B−V) — 36 KB compact.
- `constellation-lines.json`: the 27 KB d3-celestial file, as is.
- `constellation-names.json`: 89 entries `{abbr, en, la, nb}`; the Norwegian
  names are hand-written (d3-celestial has none).
- `starnames-bright.json`: proper names for stars to magnitude 3,0
  (`{hip, en, nb}`; nb only where it differs).
- `messier.json`: 110 objects, 21 KB, drawn only when `messier: true`.
- LICENSE + ATTRIBUTION for the d3-celestial data (BSD-3-Clause, Olaf Frohn).
Optional deeper stars (to mag 6) come from jsdelivr at runtime when
`limit_mag > 4.5`; if the fetch fails the bundled set is drawn and a note says
so.

Sun, Moon and planets are placed by astronomy-engine: `Equator` (of date, with
aberration) → `Horizon` for the observer. The Moon is drawn with its phase
(crescent from `Illumination`).

Params:

| param | type | meaning |
|---|---|---|
| `lat`, `lon` | numbers | observer (default Oslo 59.91, 10.75) |
| `place` | string | the label written under the compass (default "Oslo") |
| `time` | ISO datetime or `now` (default) | local time is what the LLM writes; stored as ISO with offset |
| `hours` | number −24…24 (default 0) | animatable offset from `time` |
| `days` | number −366…366 (default 0) | animatable offset |
| `limit_mag` | number 2…6 (default 4.5) | faintest star drawn |
| `constellations` | `both` (default) \| `lines` \| `names` \| `none` | |
| `names` | `en` \| `nb` \| `la` \| `none` (default `en`) | constellation and star names |
| `show` | array of body ids | mark Sun/Moon/planets (default: moon + naked-eye planets above the horizon) |
| `messier` | boolean (default false) | |
| `highlight` | array of ids | constellations (`con_ori`), stars (`sirius`), bodies (`jupiter`) |
| `focus` | one constellation id | crop to it, stars to `limit_mag` inside it |

Element ids: `con_<abbr lower>` for each constellation's line group; named stars
by lower-case proper name (`sirius`, `betelgeuse`), other stars `hip_<n>`;
bodies by body id; `horizon`, `compass_n/e/s/w`, `place_label`, `moon` with the
phase. Star dots scale with magnitude; a faint B−V tint (blue-white → orange)
keeps the sketch style.

Examples: "Find Orion tonight" (click `con_ori`), "Where is Jupiter tonight?"
(`show: [jupiter]`, highlight), "The sky turns" (`animate` `hours` 0 → 6),
"Name the constellations" (drag with items `con_ori`, `con_uma`, `con_cas`…).

The ⊕ Space section gains: click a constellation or star → info card (name in
three languages, brightest star, Wikipedia summary); pills for time (now, +1 h,
+6 h), date and place presets (Oslo, Bergen, Tromsø, Equator).

## 7. The 3D panel (round 3): `model3d: {kind: space}`

Backend: three.js (npm dependency `three`, lazy dynamic import, ~690 KB min
chunk — the same class as the 3Dmol chunk of 576 KB), `OrbitControls` from
`three/examples/jsm/controls/OrbitControls.js`. No iframe anywhere.

Plugs into the existing modal: `SceneManifest.model3d` kind union
(`src/scenes/types.ts`), the doc validator (`src/scenes/doc.ts`), the
`Model3dQuery` union and `openModel3d` branch (`src/ui/model3d.ts`), the dialog
controls (`src/main.ts`). Renderer in `src/ui/space3d.ts`; pure rules
(which bodies, scene units, camera presets) in `src/ui/space3d-model.ts`,
node-testable.

Modes, chosen from the spec that opened the panel:
- `orbits` (a `solar_system` without `focus`): Sun and the spec's bodies at
  their positions for `date` + `days`, orbit lines, the spec's `scale` rule
  (schematic by default), labels as sprites, a Milky Way background sphere.
  OrbitControls: rotate, zoom, pan. Presets: Top, Side, Reset.
- `body` (a `solar_system` with `focus`): the body as a textured sphere with
  axial tilt, slow rotation, Saturn's ring with its alpha texture, moons on
  their orbits. Presets: Reset, Rotate on/off.
- `sky` (a `sky_map`): camera at the centre of a star sphere, stars as points
  sized by magnitude, constellation lines, planets marked, the horizon plane;
  OrbitControls rotate only. Presets: N, E, S, W, Up.

Textures: `public/space/tex/<id>.jpg`, 1024×512, downscaled by
`scripts/build-space-textures.mjs` from the Commons originals; plus
`saturn_ring.png` and `milky_way.jpg`. Whole set ≤ 1,5 MB, each loaded on
demand. `public/space/LICENSE` + `ATTRIBUTION.md` (Solar System Scope, CC BY
4.0) and the credit in the dialog's footnote, as for BodyParts3D.

Not planned: Aladin Lite / HiPS imagery, asteroids and exoplanets (no CORS),
dragging drawn discs, pointer pan/zoom on the 2D stage.

## 8. Cross-cutting rules (traps from earlier rounds)

- Registering a pack in `PACK_DEFS` requires bundled examples at the same time
  (`tests/examples.test.ts`); examples must have zero lint issues, warnings
  included, and pass `lintCommands`.
- `draw` takes an ARRAY of ids; `"draw": "all"` does not exist.
- Four hand-made lists must learn the new pack and engines: `store.ts`
  enabled packs, `TEMPLATE_DOC_API_SCHEMA` engines enum in `src/llm/author.ts`
  AND its copy in `tests/author.test.ts`, `tests/molecule3d.test.ts` engine
  preload; `tests/pack-defaults.test.ts` pins the defaults.
- `tests/spec-i18n.test.ts` lists translatable param paths per template; new
  string params go there; id-shaped params carry `x-translate: false`.
- `tests/palette.test.ts` wants font sizes as tokens; scope DOM queries to the
  dialog (`.model3d-dialog`).
- Never `git add -A` (another session shares the repo); Playwright screenshots
  land in the worktree root — delete before committing.
- No new command verb: everything rides on `draw`, `ask`, `highlight`, `focus`,
  `animate`, `explore`.

## 9. Testing

Node (vitest): bodies table shape and unit sanity (Earth a ≈ 1 AU, 8 planets,
every moon's parent exists); positions (Earth at ≈ 1 AU on any date; Mars
period; the Galilean order Io < Europa < Ganymede < Callisto); scale rules
(schematic Sun ≤ 1/6 frame; `sizes` keeps the ratio Jupiter/Earth ≈ 11);
layout element ids for every mode; `focus` draws the moons; sky projection
(zenith at centre, an object at altitude 0 on the horizon circle, E on the
left); examples lint clean; i18n paths; tray model rules (breadcrumbs, focus
target). Playwright smoke per round on the worktree's dev server (the Chrome
is VISIBLE at Hans': keep it short, delete screenshots).
