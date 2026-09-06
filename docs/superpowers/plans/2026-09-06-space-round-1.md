# Space Round 1 — the `space` engine, `solar_system`, and the ⊕ Space section: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A new `space` pack whose one template, `solar_system`, draws the Sun, planets, dwarf planets and moons for a date, at a chosen scale, from above or in a row, with every body a clickable element; a lazy `space` engine (curated bodies table + astronomy-engine); and a **Space** section in the ⊕ tray (click a body to focus on it, breadcrumbs, scale/names/date pills, a fact card with the Wikipedia summary).

**Architecture:** Data and pure rules live in `src/scenes/space/` (`bodies.json`; `rules.ts` — selection, scale rules, the Sun segment; `ephemeris.ts` — astronomy-engine positions and the circular fallback; `engine.ts` — the object a layout sees as `engines.space`). The loader in `src/scenes/engines.ts` dynamic-imports `./space/engine`, which is the code-split boundary that keeps astronomy-engine out of the main chunk. The template is one YAML document in `src/scenes/packs/space.yaml` whose layout body composes drawables from the engine's numbers; a new kit primitive `ball()` (kit v9) gives the shaded disc that `project3d` already gives spheres. The tray section copies the Body section exactly: `src/ui/space-model.ts` (pure, node-tested) + `src/ui/space-explore.ts` (DOM) mounted by `tray.ts` through `overrides → repaint()`, so Continue restores the lesson.

**Tech Stack:** TypeScript, Vite, Vitest (node), astronomy-engine 2.1.19 (MIT, exact pin), the existing sceneKit / label solver / lint.

**Spec:** `docs/superpowers/specs/2026-09-06-space-design.md` — this plan implements §3 (engine), §4 (`solar_system`), §5 (⊕ Space section), §8 (traps), §9 (tests). Rounds 2 (`sky_map`) and 3 (three.js panel) get their own plans; nothing here may paint them into a corner — the bodies table already carries `texture` and `wiki`, and `positions()` returns `z`.

## Global Constraints

Copied from spec §8:

- Registering a pack in `PACK_DEFS` requires bundled examples at the same time (`tests/examples.test.ts`); examples must have zero lint issues, warnings included, and pass `lintCommands`.
- `draw` takes an ARRAY of ids; `"draw": "all"` does not exist.
- Four hand-made lists must learn the new pack and engines: `store.ts` enabled packs, `TEMPLATE_DOC_API_SCHEMA` engines enum in `src/llm/author.ts` AND its copy in `tests/author.test.ts`, `tests/molecule3d.test.ts` engine preload; `tests/pack-defaults.test.ts` pins the defaults.
- `tests/spec-i18n.test.ts` lists translatable param paths per template; new string params go there; id-shaped params carry `x-translate: false`.
- `tests/palette.test.ts` wants font sizes as tokens; scope DOM queries to the dialog (`.model3d-dialog`).
- Never `git add -A` (another session shares the repo); Playwright screenshots land in the worktree root — delete before committing.
- No new command verb: everything rides on `draw`, `ask`, `highlight`, `focus`, `animate`, `explore`.

Added by this plan:

- Every bundled example carries `"packs": ["space"]`.
- astronomy-engine is reached in the browser ONLY through the engine loader's dynamic import (`loadSpace` in `engines.ts` → `import("./space/engine")` → `engine.ts`'s static `import ... from "astronomy-engine"`). No file that the main chunk imports statically (`tray.ts`, `space-explore.ts`, `space-model.ts`, `rules.ts`, `types.ts`) may import `ephemeris.ts` or `astronomy-engine`. Node tests import `src/scenes/space/ephemeris.ts` directly.
- Layout bodies are deterministic: the clock is read only inside the engine (`resolveDate`), never in the layout; every bundled example pins an ISO `date`.
- Element ids ARE body ids (`mars`, `io`), orbits are `orbit_<id>`, names are `label_<id>` — the anatomy rule.
- Worktree `/Users/hom/Documents/GitHub/drawcast/.claude/worktrees/space`, branch `space`. `npx vitest run` and `npx tsc --noEmit` before every commit. Vitest: `npx vitest run <file>` runs one file.

## Rulings made by this plan (where the spec left a choice or a conflict)

1. **`bodies` is always an array.** Group words (`planets`, `inner`, `outer`, `all`) are entries that expand in place (`["inner", "jupiter"]`), not an alternative string type — one schema shape for the compiler, no `oneOf`.
2. **`today` is resolved in the engine, at UTC midnight**, so every figure in a session agrees and a layout stays a pure function of its params for that day. Bundled examples pin an ISO date, because `tests/examples.test.ts` lints every example and a `today` figure would drift under the guard by the day.
3. **Shaded discs come from a new kit primitive, `kit.ball()` (kit v9)** — the same one-circle radial-gradient drawable `project3d` gives a solid sphere, for 2D. The `tilted` view does NOT go through `project3d`: it has no polyline primitive, so one orbit would be 48 `seg` strokes (384 for eight orbits); instead the layout applies `project3d`'s own four-line orbit-camera formula (azimuth 0, elevation 30°) to orbit points and body centres, and draws bodies with `ball()` scaled by the perspective factor. Same picture, eight orbit polylines.
4. **`sizes` in `top`/`tilted`:** planets keep true relative radii, the Sun is clamped to one sixth of the frame, and the note says "Planet sizes to scale, Sun reduced, distances not". The Sun as a visible circular SEGMENT exists only in `row` (where it stands at the left edge). Any other reading makes the Sun cover every orbit.
5. **Bodies sit ON their drawn circular orbit at the true longitude** (heliocentric ecliptic longitude from the ephemeris, or the parent-centred angle for moons). Eccentricity and inclination are not drawn in round 1 (`z` is returned, not used).
6. **`focus` draws every listed moon of the focus body by default; `moons` filters** (moon ids, or the parent's id meaning all). A moon named in `bodies` is not drawn (invisible at any solar-system scale) and is listed in the note as `io (a moon: use focus)`.
7. **Labels may cross orbit guides.** The solver requests carry `ignore: [own body, every orbit_ id]` — orbits are faint dashed guides, not ink — and must still avoid every other body and name. In `row` view names sit under their body in tiers, so neighbours closer than a name is wide do not collide.
8. **`tests/spec-i18n.test.ts`'s per-template list covers only the built-in `src/scenes/*/manifest.json` scenes, not packs** (measured: its glob is `../src/scenes/*/manifest.json`). No entry is added there; `x-translate: false` on every id-shaped param plus the file's end-to-end "every bundled drawcast survives being translated" test are what guard the pack.
9. **The smoke is an MCP-driven / by-hand checklist, not a script.** `scripts/smoke-race.mjs` records the controller ruling of 2026-09-03: Playwright is not a dependency of this repo and is not to be added for one gate. Task 10 lists the exact clicks and what must be seen.
10. **`log` mode's `scale_bar` is a decade ruler** along the −y axis from r(d) to r(10·d) for the largest decade pair (1→10 AU for the Sun, 100 000→1 000 000 km for a focus body) that fits inside the drawn orbit range; when no pair fits, there is no bar and the note stands alone.
11. **`phase()` returns the name in both languages** (`name` en, `name_nb`) — a small extension of the spec's `{fraction, waxing, name}` so the card needs no second table.
12. **Ceres, Eris, Haumea and Makemake have no ephemeris in astronomy-engine.** They (and every moon outside GeoMoon/JupiterMoons) get the circular sketch with an approximate J2000 mean longitude `l0_deg` in the table; the ⊕ card says "Position schematic" for them (`engine.schematic(id)`).
13. **No stub pack.** The pack lands in Task 5 together with its ready template and its first bundled example, because `tests/examples.test.ts` demands an example for every ready template the moment the pack is in `PACK_DEFS`; a stub would only be rewritten one task later. The engine (Task 3) is registered first and is testable on its own.
14. **`quiz.correct` is 1-based** (`src/spec/schema.ts:318`). Every quiz below counts from 1.

---

## File Structure

**Created:**

| path | responsibility |
|---|---|
| `src/scenes/space/bodies.json` | the curated table: 35 bodies, `source` line |
| `src/scenes/space/types.ts` | `Body`, `BodiesTable`, `ScaleMode`, `Frame`, `Vec`, `MoonPhaseInfo`, `SpaceEngine` |
| `src/scenes/space/rules.ts` | pure: `AU_KM`, `indexBodies`, `expandBodies`, `moonsOf`, `satellitesFor`, `orbitRadii`, `logRadius`, `drawnRadii`, `circle`, `clipRingToBox`, `sunSegment`, `scaleNote`, `scaleBar`, `labelTiers` |
| `src/scenes/space/ephemeris.ts` | astronomy-engine: `resolveDate`, `helioPositions`, `moonPositionsKm`, `moonPhase`, `EPHEMERIS_IDS`, `eqjToEcliptic`, `circularAngle` |
| `src/scenes/space/engine.ts` | `makeSpaceEngine(table)` → `SpaceEngine`; the lazy chunk |
| `src/scenes/packs/space.yaml` | pack header + `solar_system` |
| `src/ui/space-model.ts` | pure: focus target, breadcrumbs, labels, card facts, Wikipedia URL/reader |
| `src/ui/space-explore.ts` | DOM: `mountSpaceSection`, the click overlay, pills, the card |
| `src/scenes/space/README.md` | sources, licences, ids, the engine API |
| `tests/space-rules.test.ts`, `tests/space-ephemeris.test.ts`, `tests/space-engine.test.ts`, `tests/space-template.test.ts`, `tests/space-model.test.ts` | |

**Modified:**

| path | change |
|---|---|
| `package.json`, `package-lock.json` | `astronomy-engine` 2.1.19 exact |
| `src/scenes/engines.ts` | `KNOWN_ENGINES` + `space`; `loadSpace`; `ENGINE_DEFS.space`; type re-export |
| `src/llm/author.ts:77`, `tests/author.test.ts:99`, `tests/molecule3d.test.ts:254` | the hand-made engine lists |
| `src/scenes/kit.ts:41`, `tests/kit-smooth-closed.test.ts:43`, `tests/scene-kit.test.ts` | `ball()`, `KIT_VERSION` 9 |
| `src/scenes/packs.ts:115`, `src/store.ts:191` | the pack |
| `src/examples.json` | five examples, appended at the end |
| `src/spec/schema.ts:365-370, 897`, `src/spec/types.ts:302`, `src/render/plan.ts:24, 257` | `explore.space` |
| `src/ui/tray-model.ts`, `tests/tray-model.test.ts`, `tests/explore-command.test.ts` | the `space` boolean in the tray plan |
| `src/ui/tray.ts:35, 100-102, 113-115, 121-122, 264-265, 393-447, 808`, `src/styles.css` (after line 1679) | mount the section |
| `ROADMAP.md` (~line 445) | the round shipped |

---

## Task 1: astronomy-engine, the bodies table, the pure rules

**Files:**
- Create: `src/scenes/space/bodies.json`, `src/scenes/space/types.ts`, `src/scenes/space/rules.ts`
- Modify: `package.json`, `package-lock.json` (by `npm install`)
- Test: `tests/space-rules.test.ts`

**Interfaces:**
- Consumes: `Pt` from `src/layout/model.ts`.
- Produces (used by Tasks 2, 3, 5, 8):
  - `types.ts`: `Body`, `BodiesTable`, `BodyKind`, `ScaleMode`, `Frame`, `Vec`, `MoonPhaseInfo`, `SpaceEngine` (the full interface below).
  - `rules.ts`: `AU_KM`; `indexBodies(table): Record<string, Body>`; `expandBodies(all, sel: readonly string[]): { ids: string[]; missing: string[] }`; `moonsOf(all, parentId): Body[]`; `satellitesFor(all, focus: string | null, moons?: readonly string[]): { ids; missing }`; `orbitRadii(bodies, mode, rMin, rMax): number[]`; `logRadius(a, aMin, aMax, rMin, rMax): number`; `drawnRadii(centre, bodies, mode, largestPx, pxPerKm?): { centre: number; bodies: number[] }`; `circle(c, r, n): Pt[]`; `clipRingToBox(ring, frame): Pt[]`; `sunSegment(c, r, frame): { fill: Pt[]; arc: Pt[]; clipped: boolean }`; `scaleNote(mode, lang, sunReduced?): string`; `scaleBar(mode, pxPerKm, lang): { lengthPx; label } | null`; `labelTiers(xs, widths, gap): number[]`; `FRAME`, `MIN_BODY_PX`, `PLANET_IDS`, `DWARF_IDS`.

- [ ] **Step 1: Install the dependency (exact pin)**

Run: `npm install astronomy-engine@2.1.19 --save-exact`
Expected: `package.json` `dependencies` gains `"astronomy-engine": "2.1.19"`; `package-lock.json` changes.

Run: `node -e "const A=require('astronomy-engine'); console.log(typeof A.HelioVector, typeof A.GeoMoon, typeof A.JupiterMoons, typeof A.Illumination, typeof A.MoonPhase, A.Body.Earth)"`
Expected: `function function function function function Earth`.

- [ ] **Step 2: Write the bodies table**

Create `src/scenes/space/bodies.json` with exactly this content (values from the NASA planetary and planetary-satellite fact sheets; `r_km` mean radius, `a_km` semi-major axis around `parent`, `period_d` sidereal orbital period in days — negative = retrograde orbit, `rot_h` sidereal rotation in hours — negative = retrograde spin, `tilt_deg` axial tilt (omitted where unknown), `l0_deg` approximate mean longitude at J2000 for bodies with no ephemeris, `ring` radii in body radii, `texture` reserved for round 3):

```json
{
  "source": "NASA Planetary Fact Sheets and Planetary Satellite Fact Sheet (nssdc.gsfc.nasa.gov/planetary/factsheet), 2026. Colours, Norwegian names and l0_deg (approximate J2000 mean longitudes for Ceres, Eris, Haumea, Makemake — their positions are schematic) are ours. Units: km, kg, days, hours, degrees.",
  "bodies": [
    { "id": "sun", "kind": "star", "name": { "en": "Sun", "nb": "Solen" }, "parent": null, "r_km": 695700, "mass_kg": 1.989e30, "a_km": 0, "period_d": 0, "e": 0, "rot_h": 609.1, "tilt_deg": 7.25, "color": "#f5b400", "wiki": { "en": "Sun", "nb": "Solen" }, "texture": "sun.jpg" },
    { "id": "mercury", "kind": "planet", "name": { "en": "Mercury", "nb": "Merkur" }, "parent": "sun", "r_km": 2439.7, "mass_kg": 3.301e23, "a_km": 57909000, "period_d": 87.969, "e": 0.2056, "rot_h": 1407.6, "tilt_deg": 0.034, "color": "#9a9a9a", "wiki": { "en": "Mercury (planet)", "nb": "Merkur" }, "texture": "mercury.jpg" },
    { "id": "venus", "kind": "planet", "name": { "en": "Venus", "nb": "Venus" }, "parent": "sun", "r_km": 6051.8, "mass_kg": 4.867e24, "a_km": 108209000, "period_d": 224.701, "e": 0.0068, "rot_h": -5832.5, "tilt_deg": 177.4, "color": "#e6c99a", "wiki": { "en": "Venus", "nb": "Venus" }, "texture": "venus.jpg" },
    { "id": "earth", "kind": "planet", "name": { "en": "Earth", "nb": "Jorden" }, "parent": "sun", "r_km": 6371, "mass_kg": 5.972e24, "a_km": 149598000, "period_d": 365.256, "e": 0.0167, "rot_h": 23.934, "tilt_deg": 23.44, "color": "#4f7fd1", "wiki": { "en": "Earth", "nb": "Jorden" }, "texture": "earth.jpg" },
    { "id": "mars", "kind": "planet", "name": { "en": "Mars", "nb": "Mars" }, "parent": "sun", "r_km": 3389.5, "mass_kg": 6.417e23, "a_km": 227956000, "period_d": 686.98, "e": 0.0935, "rot_h": 24.623, "tilt_deg": 25.19, "color": "#c1613d", "wiki": { "en": "Mars", "nb": "Mars" }, "texture": "mars.jpg" },
    { "id": "jupiter", "kind": "planet", "name": { "en": "Jupiter", "nb": "Jupiter" }, "parent": "sun", "r_km": 69911, "mass_kg": 1.898e27, "a_km": 778479000, "period_d": 4332.589, "e": 0.0487, "rot_h": 9.925, "tilt_deg": 3.13, "color": "#c9a678", "wiki": { "en": "Jupiter", "nb": "Jupiter" }, "texture": "jupiter.jpg" },
    { "id": "saturn", "kind": "planet", "name": { "en": "Saturn", "nb": "Saturn" }, "parent": "sun", "r_km": 58232, "mass_kg": 5.683e26, "a_km": 1432041000, "period_d": 10759.22, "e": 0.052, "rot_h": 10.656, "tilt_deg": 26.73, "color": "#e0c98f", "ring": { "inner": 1.24, "outer": 2.27, "color": "#d8c9a3" }, "wiki": { "en": "Saturn", "nb": "Saturn" }, "texture": "saturn.jpg" },
    { "id": "uranus", "kind": "planet", "name": { "en": "Uranus", "nb": "Uranus" }, "parent": "sun", "r_km": 25362, "mass_kg": 8.681e25, "a_km": 2867043000, "period_d": 30688.5, "e": 0.0469, "rot_h": -17.24, "tilt_deg": 97.77, "color": "#9fd6dc", "wiki": { "en": "Uranus", "nb": "Uranus" }, "texture": "uranus.jpg" },
    { "id": "neptune", "kind": "planet", "name": { "en": "Neptune", "nb": "Neptun" }, "parent": "sun", "r_km": 24622, "mass_kg": 1.024e26, "a_km": 4514953000, "period_d": 60195, "e": 0.0097, "rot_h": 16.11, "tilt_deg": 28.32, "color": "#4a6fd6", "wiki": { "en": "Neptune", "nb": "Neptun" }, "texture": "neptune.jpg" },
    { "id": "pluto", "kind": "dwarf", "name": { "en": "Pluto", "nb": "Pluto" }, "parent": "sun", "r_km": 1188.3, "mass_kg": 1.303e22, "a_km": 5906380000, "period_d": 90560, "e": 0.2444, "rot_h": -153.29, "tilt_deg": 122.53, "color": "#c9b29b", "wiki": { "en": "Pluto", "nb": "Pluto" } },
    { "id": "ceres", "kind": "dwarf", "name": { "en": "Ceres", "nb": "Ceres" }, "parent": "sun", "r_km": 469.7, "mass_kg": 9.38e20, "a_km": 413700000, "period_d": 1680, "e": 0.0785, "rot_h": 9.07, "tilt_deg": 4, "color": "#a8a196", "l0_deg": 160, "wiki": { "en": "Ceres (dwarf planet)", "nb": "Ceres (dvergplanet)" } },
    { "id": "eris", "kind": "dwarf", "name": { "en": "Eris", "nb": "Eris" }, "parent": "sun", "r_km": 1163, "mass_kg": 1.66e22, "a_km": 10125000000, "period_d": 203830, "e": 0.4407, "rot_h": 25.9, "color": "#d9d5cf", "l0_deg": 25, "wiki": { "en": "Eris (dwarf planet)", "nb": "Eris (dvergplanet)" } },
    { "id": "haumea", "kind": "dwarf", "name": { "en": "Haumea", "nb": "Haumea" }, "parent": "sun", "r_km": 780, "mass_kg": 4.01e21, "a_km": 6452000000, "period_d": 103470, "e": 0.1887, "rot_h": 3.92, "color": "#d5d0c8", "l0_deg": 203, "wiki": { "en": "Haumea", "nb": "Haumea" } },
    { "id": "makemake", "kind": "dwarf", "name": { "en": "Makemake", "nb": "Makemake" }, "parent": "sun", "r_km": 715, "mass_kg": 3.1e21, "a_km": 6850000000, "period_d": 112900, "e": 0.1613, "rot_h": 22.83, "color": "#c8a080", "l0_deg": 170, "wiki": { "en": "Makemake", "nb": "Makemake" } },
    { "id": "moon", "kind": "moon", "name": { "en": "Moon", "nb": "Månen" }, "parent": "earth", "r_km": 1737.4, "mass_kg": 7.346e22, "a_km": 384400, "period_d": 27.3217, "e": 0.0549, "rot_h": 655.7, "tilt_deg": 6.68, "color": "#b8b8b0", "wiki": { "en": "Moon", "nb": "Månen" }, "texture": "moon.jpg" },
    { "id": "phobos", "kind": "moon", "name": { "en": "Phobos", "nb": "Phobos" }, "parent": "mars", "r_km": 11.1, "mass_kg": 1.06e16, "a_km": 9376, "period_d": 0.3189, "e": 0.0151, "rot_h": 7.65, "tilt_deg": 0, "color": "#8d8378", "wiki": { "en": "Phobos (moon)", "nb": "Phobos" } },
    { "id": "deimos", "kind": "moon", "name": { "en": "Deimos", "nb": "Deimos" }, "parent": "mars", "r_km": 6.2, "mass_kg": 1.5e15, "a_km": 23458, "period_d": 1.2624, "e": 0.0002, "rot_h": 30.3, "tilt_deg": 0, "color": "#9a9086", "wiki": { "en": "Deimos (moon)", "nb": "Deimos" } },
    { "id": "io", "kind": "moon", "name": { "en": "Io", "nb": "Io" }, "parent": "jupiter", "r_km": 1821.6, "mass_kg": 8.93e22, "a_km": 421800, "period_d": 1.7691, "e": 0.0041, "rot_h": 42.46, "tilt_deg": 0, "color": "#d9c55a", "wiki": { "en": "Io (moon)", "nb": "Io (måne)" } },
    { "id": "europa", "kind": "moon", "name": { "en": "Europa", "nb": "Europa" }, "parent": "jupiter", "r_km": 1560.8, "mass_kg": 4.8e22, "a_km": 671100, "period_d": 3.5512, "e": 0.0094, "rot_h": 85.23, "tilt_deg": 0.1, "color": "#c9b8a0", "wiki": { "en": "Europa (moon)", "nb": "Europa (måne)" } },
    { "id": "ganymede", "kind": "moon", "name": { "en": "Ganymede", "nb": "Ganymedes" }, "parent": "jupiter", "r_km": 2634.1, "mass_kg": 1.482e23, "a_km": 1070400, "period_d": 7.1546, "e": 0.0013, "rot_h": 171.7, "tilt_deg": 0.2, "color": "#a09383", "wiki": { "en": "Ganymede (moon)", "nb": "Ganymedes" } },
    { "id": "callisto", "kind": "moon", "name": { "en": "Callisto", "nb": "Callisto" }, "parent": "jupiter", "r_km": 2410.3, "mass_kg": 1.076e23, "a_km": 1882700, "period_d": 16.689, "e": 0.0074, "rot_h": 400.5, "tilt_deg": 0, "color": "#7d7469", "wiki": { "en": "Callisto (moon)", "nb": "Callisto" } },
    { "id": "mimas", "kind": "moon", "name": { "en": "Mimas", "nb": "Mimas" }, "parent": "saturn", "r_km": 198.2, "mass_kg": 3.75e19, "a_km": 185540, "period_d": 0.942, "e": 0.0196, "rot_h": 22.6, "tilt_deg": 0, "color": "#bfbdb8", "wiki": { "en": "Mimas", "nb": "Mimas" } },
    { "id": "enceladus", "kind": "moon", "name": { "en": "Enceladus", "nb": "Enceladus" }, "parent": "saturn", "r_km": 252.1, "mass_kg": 1.08e20, "a_km": 238040, "period_d": 1.37, "e": 0.0047, "rot_h": 32.9, "tilt_deg": 0, "color": "#e8e8e4", "wiki": { "en": "Enceladus", "nb": "Enceladus" } },
    { "id": "tethys", "kind": "moon", "name": { "en": "Tethys", "nb": "Tethys" }, "parent": "saturn", "r_km": 531.1, "mass_kg": 6.17e20, "a_km": 294670, "period_d": 1.888, "e": 0.0001, "rot_h": 45.3, "tilt_deg": 0, "color": "#d4d2cc", "wiki": { "en": "Tethys (moon)", "nb": "Tethys" } },
    { "id": "dione", "kind": "moon", "name": { "en": "Dione", "nb": "Dione" }, "parent": "saturn", "r_km": 561.4, "mass_kg": 1.095e21, "a_km": 377420, "period_d": 2.737, "e": 0.0022, "rot_h": 65.7, "tilt_deg": 0, "color": "#c9c6bf", "wiki": { "en": "Dione (moon)", "nb": "Dione (måne)" } },
    { "id": "rhea", "kind": "moon", "name": { "en": "Rhea", "nb": "Rhea" }, "parent": "saturn", "r_km": 763.8, "mass_kg": 2.31e21, "a_km": 527070, "period_d": 4.518, "e": 0.001, "rot_h": 108.4, "tilt_deg": 0, "color": "#c2bfb8", "wiki": { "en": "Rhea (moon)", "nb": "Rhea (måne)" } },
    { "id": "titan", "kind": "moon", "name": { "en": "Titan", "nb": "Titan" }, "parent": "saturn", "r_km": 2574.7, "mass_kg": 1.345e23, "a_km": 1221870, "period_d": 15.945, "e": 0.0288, "rot_h": 382.7, "tilt_deg": 0.3, "color": "#d8a54a", "wiki": { "en": "Titan (moon)", "nb": "Titan (måne)" } },
    { "id": "iapetus", "kind": "moon", "name": { "en": "Iapetus", "nb": "Iapetus" }, "parent": "saturn", "r_km": 734.5, "mass_kg": 1.81e21, "a_km": 3560840, "period_d": 79.33, "e": 0.0283, "rot_h": 1904, "tilt_deg": 0, "color": "#8f857a", "wiki": { "en": "Iapetus (moon)", "nb": "Iapetus" } },
    { "id": "miranda", "kind": "moon", "name": { "en": "Miranda", "nb": "Miranda" }, "parent": "uranus", "r_km": 235.8, "mass_kg": 6.6e19, "a_km": 129900, "period_d": 1.413, "e": 0.0013, "rot_h": 33.9, "tilt_deg": 0, "color": "#c6c3bd", "wiki": { "en": "Miranda (moon)", "nb": "Miranda (måne)" } },
    { "id": "ariel", "kind": "moon", "name": { "en": "Ariel", "nb": "Ariel" }, "parent": "uranus", "r_km": 578.9, "mass_kg": 1.35e21, "a_km": 190900, "period_d": 2.52, "e": 0.0012, "rot_h": 60.5, "tilt_deg": 0, "color": "#b9b6b0", "wiki": { "en": "Ariel (moon)", "nb": "Ariel (måne)" } },
    { "id": "umbriel", "kind": "moon", "name": { "en": "Umbriel", "nb": "Umbriel" }, "parent": "uranus", "r_km": 584.7, "mass_kg": 1.17e21, "a_km": 266000, "period_d": 4.144, "e": 0.0039, "rot_h": 99.5, "tilt_deg": 0, "color": "#7e7b76", "wiki": { "en": "Umbriel", "nb": "Umbriel" } },
    { "id": "titania", "kind": "moon", "name": { "en": "Titania", "nb": "Titania" }, "parent": "uranus", "r_km": 788.9, "mass_kg": 3.53e21, "a_km": 436300, "period_d": 8.706, "e": 0.0011, "rot_h": 208.9, "tilt_deg": 0, "color": "#a9a49c", "wiki": { "en": "Titania (moon)", "nb": "Titania (måne)" } },
    { "id": "oberon", "kind": "moon", "name": { "en": "Oberon", "nb": "Oberon" }, "parent": "uranus", "r_km": 761.4, "mass_kg": 3.01e21, "a_km": 583500, "period_d": 13.463, "e": 0.0014, "rot_h": 323.1, "tilt_deg": 0, "color": "#9b958d", "wiki": { "en": "Oberon (moon)", "nb": "Oberon (måne)" } },
    { "id": "triton", "kind": "moon", "name": { "en": "Triton", "nb": "Triton" }, "parent": "neptune", "r_km": 1353.4, "mass_kg": 2.14e22, "a_km": 354760, "period_d": -5.877, "e": 0, "rot_h": -141, "tilt_deg": 0, "color": "#c8b8c8", "wiki": { "en": "Triton (moon)", "nb": "Triton (måne)" } },
    { "id": "charon", "kind": "moon", "name": { "en": "Charon", "nb": "Charon" }, "parent": "pluto", "r_km": 606, "mass_kg": 1.586e21, "a_km": 19591, "period_d": 6.387, "e": 0.0002, "rot_h": 153.29, "tilt_deg": 0, "color": "#a8a29a", "wiki": { "en": "Charon", "nb": "Charon (måne)" } }
  ]
}
```

- [ ] **Step 3: Write the types**

Create `src/scenes/space/types.ts`:

```ts
// The space pack's data shapes and the engine a layout sees as `engines.space`.
// Ids are the English names in lower case and ARE the element ids (the same
// rule as anatomy). Nothing here imports astronomy-engine: this file is
// reachable from the main chunk (tray, model) and must stay light.

import type { Pt } from "../../layout/model";

export type BodyKind = "star" | "planet" | "dwarf" | "moon";

export interface Body {
  id: string;
  kind: BodyKind;
  /** Display names; these never go through the prose translator. */
  name: { en: string; nb: string };
  /** What it orbits: null for the Sun, "sun" for planets and dwarfs, a planet id for moons. */
  parent: string | null;
  /** Mean radius, km. */
  r_km: number;
  mass_kg: number;
  /** Semi-major axis around `parent`, km (0 for the Sun). */
  a_km: number;
  /** Sidereal orbital period, days; negative = retrograde orbit (Triton). 0 for the Sun. */
  period_d: number;
  /** Orbital eccentricity — carried for the card, not drawn in round 1. */
  e: number;
  /** Sidereal rotation, hours; negative = retrograde spin. */
  rot_h: number;
  /** Axial tilt, degrees; absent where unknown. */
  tilt_deg?: number;
  /** 6-digit hex; shades best. */
  color: string;
  /** Ring radii in body radii. Saturn only. */
  ring?: { inner: number; outer: number; color: string };
  /** Wikipedia article titles for the ⊕ card. */
  wiki: { en: string; nb: string };
  /** Round 3: `public/space/tex/<texture>`. */
  texture?: string;
  /** Approximate mean longitude at J2000, degrees, for bodies drawn on the circular sketch. */
  l0_deg?: number;
}

export interface BodiesTable {
  source: string;
  bodies: Body[];
}

export type ScaleMode = "schematic" | "sizes" | "distances" | "log";

/** A logical-canvas rectangle, y-up. */
export interface Frame {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Heliocentric ecliptic position, AU (z kept for round 3). */
export interface Vec {
  x: number;
  y: number;
  z: number;
}

export interface MoonPhaseInfo {
  /** Illuminated fraction 0–1. */
  fraction: number;
  waxing: boolean;
  /** Ecliptic phase angle 0–360: 0 new, 90 first quarter, 180 full, 270 last quarter. */
  angle: number;
  name: string;
  name_nb: string;
}

/** What a template's `layout` gets as `engines.space`, and what the ⊕ section reads. */
export interface SpaceEngine {
  /** Every body by id. */
  all(): Record<string, Body>;
  body(id: string): Body | undefined;
  /** Ids, names (en/nb) and the group words planets | inner | outer | all, case-insensitive; unknown names in `missing`. */
  bodies(sel: readonly string[]): { bodies: Body[]; missing: string[] };
  /** Direct children of a body, innermost first. */
  moonsOf(parentId: string): Body[];
  /** What orbits the focus body in the figure: its children, or the `moons` selection restricted to them. No focus, nothing. */
  satellites(focus: string | null, moons: readonly string[] | undefined): { bodies: Body[]; missing: string[] };
  /** "today" / an ISO date → a Date at UTC midnight, shifted by `days`. The only clock in the pack. */
  resolveDate(date: unknown, days: unknown): Date;
  /** Heliocentric ecliptic positions in AU for sun-orbiting bodies; a moon reports its parent's. */
  positions(ids: readonly string[], date: Date): Record<string, Vec>;
  /** Parent-centred ecliptic positions in km for the named moons of `parentId`. */
  moonPositions(parentId: string, ids: readonly string[], date: Date): Record<string, { x: number; y: number }>;
  phase(date: Date): MoonPhaseInfo;
  /** True when the body's position is the circular sketch, not an ephemeris. */
  schematic(id: string): boolean;
  au(km: number): number;
  km(au: number): number;
  // ---- the scale rules (rules.ts), reachable from a layout body ----
  orbitRadii(bodies: readonly Body[], mode: ScaleMode, rMin: number, rMax: number): number[];
  logRadius(a_km: number, aMin: number, aMax: number, rMin: number, rMax: number): number;
  drawnRadii(centre: Body, bodies: readonly Body[], mode: ScaleMode, largestPx: number, pxPerKm?: number): { centre: number; bodies: number[] };
  sunSegment(c: Pt, r: number, frame: Frame): { fill: Pt[]; arc: Pt[]; clipped: boolean };
  scaleNote(mode: ScaleMode, lang: "en" | "nb", sunReduced?: boolean): string;
  scaleBar(mode: ScaleMode, pxPerKm: number, lang: "en" | "nb"): { lengthPx: number; label: string } | null;
  labelTiers(xs: readonly number[], widths: readonly number[], gap: number): number[];
}
```

- [ ] **Step 4: Write the failing tests**

Create `tests/space-rules.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import bodiesJson from "../src/scenes/space/bodies.json";
import type { BodiesTable, Body } from "../src/scenes/space/types";
import {
  AU_KM, DWARF_IDS, FRAME, MIN_BODY_PX, PLANET_IDS, circle, clipRingToBox, drawnRadii, expandBodies, indexBodies,
  labelTiers, logRadius, moonsOf, orbitRadii, satellitesFor, scaleBar, scaleNote, sunSegment,
} from "../src/scenes/space/rules";

const table = bodiesJson as unknown as BodiesTable;
const all = indexBodies(table);
const B = (id: string): Body => all[id];
const sorted = (ids: readonly string[]): Body[] => ids.map(B).sort((a, b) => a.a_km - b.a_km);

describe("the bodies table", () => {
  test("has the 35 bodies of the spec, with unique lower-case ids and a source line", () => {
    expect(table.bodies).toHaveLength(35);
    expect(typeof table.source).toBe("string");
    const ids = table.bodies.map((b) => b.id);
    expect(new Set(ids).size).toBe(35);
    for (const id of ids) expect(id).toMatch(/^[a-z]+$/);
  });

  test("one star, eight planets, five dwarfs, twenty-one moons", () => {
    const count = (k: string) => table.bodies.filter((b) => b.kind === k).length;
    expect(count("star")).toBe(1);
    expect(count("planet")).toBe(8);
    expect(count("dwarf")).toBe(5);
    expect(count("moon")).toBe(21);
  });

  test("every parent exists; the Sun has none; planets and dwarfs orbit the Sun; moons orbit a planet or dwarf", () => {
    for (const b of table.bodies) {
      if (b.id === "sun") { expect(b.parent).toBeNull(); continue; }
      expect(b.parent && all[b.parent], b.id).toBeTruthy();
      if (b.kind === "planet" || b.kind === "dwarf") expect(b.parent).toBe("sun");
      if (b.kind === "moon") expect(["planet", "dwarf"]).toContain(all[b.parent!].kind);
    }
  });

  test("units are sane: Earth at 1 AU, a year of 365 days, 6 371 km", () => {
    expect(B("earth").a_km / AU_KM).toBeCloseTo(1, 3);
    expect(B("earth").period_d).toBeCloseTo(365.256, 2);
    expect(B("earth").r_km).toBe(6371);
    expect(B("jupiter").r_km / B("earth").r_km).toBeGreaterThan(10.9);
  });

  test("every body has a 6-digit colour, both names and both Wikipedia titles", () => {
    for (const b of table.bodies) {
      expect(b.color, b.id).toMatch(/^#[0-9a-f]{6}$/);
      expect(b.name.en && b.name.nb, b.id).toBeTruthy();
      expect(b.wiki.en && b.wiki.nb, b.id).toBeTruthy();
    }
    expect(B("saturn").ring).toEqual({ inner: 1.24, outer: 2.27, color: "#d8c9a3" });
    expect(B("neptune").name.nb).toBe("Neptun");
    expect(B("ganymede").wiki.nb).toBe("Ganymedes");
  });
});

describe("expandBodies", () => {
  test("group words expand in place, in the table's order", () => {
    expect(expandBodies(all, ["planets"]).ids).toEqual([...PLANET_IDS]);
    expect(expandBodies(all, ["inner"]).ids).toEqual(["mercury", "venus", "earth", "mars"]);
    expect(expandBodies(all, ["outer"]).ids).toEqual(["jupiter", "saturn", "uranus", "neptune"]);
    expect(expandBodies(all, ["all"]).ids).toEqual([...PLANET_IDS, ...DWARF_IDS]);
    expect(expandBodies(all, ["inner", "jupiter"]).ids).toEqual(["mercury", "venus", "earth", "mars", "jupiter"]);
  });

  test("ids and names match case-insensitively, in either language; duplicates collapse", () => {
    expect(expandBodies(all, ["Mars", "JUPITER", "Jorden", "mars"])).toEqual({ ids: ["mars", "jupiter", "earth"], missing: [] });
  });

  test("unknown names are reported, never thrown; moons are known", () => {
    expect(expandBodies(all, ["krypton", "io"])).toEqual({ ids: ["io"], missing: ["krypton"] });
    expect(expandBodies(all, [])).toEqual({ ids: [], missing: [] });
  });
});

describe("moons and satellites", () => {
  test("moonsOf lists a body's children innermost first", () => {
    expect(moonsOf(all, "jupiter").map((b) => b.id)).toEqual(["io", "europa", "ganymede", "callisto"]);
    expect(moonsOf(all, "saturn")).toHaveLength(7);
    expect(moonsOf(all, "venus")).toEqual([]);
  });

  test("a focus draws all its moons by default; `moons` filters, by moon id or the parent's id", () => {
    expect(satellitesFor(all, "jupiter", undefined).ids).toEqual(["io", "europa", "ganymede", "callisto"]);
    expect(satellitesFor(all, "jupiter", ["jupiter"]).ids).toEqual(["io", "europa", "ganymede", "callisto"]);
    expect(satellitesFor(all, "jupiter", ["europa", "io"]).ids).toEqual(["io", "europa"]);
    expect(satellitesFor(all, "jupiter", ["titan"])).toEqual({ ids: [], missing: ["titan (not a moon of jupiter)"] });
    expect(satellitesFor(all, "jupiter", ["krypton"])).toEqual({ ids: [], missing: ["krypton"] });
  });

  test("no focus, no satellites", () => {
    expect(satellitesFor(all, null, ["jupiter"])).toEqual({ ids: [], missing: [] });
  });
});

describe("orbitRadii", () => {
  const inner = sorted(["mercury", "venus", "earth", "mars"]);
  test("schematic and sizes space the orbits evenly from rMin to rMax", () => {
    expect(orbitRadii(inner, "schematic", 60, 290)).toEqual([60, 60 + 230 / 3, 60 + (2 * 230) / 3, 290]);
    expect(orbitRadii(inner, "sizes", 60, 290)).toEqual(orbitRadii(inner, "schematic", 60, 290));
  });
  test("distances are proportional to a_km, the outermost at rMax", () => {
    const r = orbitRadii(inner, "distances", 60, 290);
    expect(r[3]).toBe(290);
    expect(r[2]).toBeCloseTo((290 * B("earth").a_km) / B("mars").a_km, 6);
  });
  test("log runs from rMin to rMax and keeps the order", () => {
    const r = orbitRadii(sorted(PLANET_IDS), "log", 60, 290);
    expect(r[0]).toBe(60);
    expect(r[7]).toBe(290);
    for (let i = 1; i < r.length; i++) expect(r[i]).toBeGreaterThan(r[i - 1]);
    expect(logRadius(1, 1, 100, 0, 100)).toBe(0);
    expect(logRadius(10, 1, 100, 0, 100)).toBeCloseTo(50, 9);
  });
  test("one body sits midway; none gives none", () => {
    expect(orbitRadii([B("moon")], "schematic", 130, 290)).toEqual([210]);
    expect(orbitRadii([B("moon")], "distances", 130, 290)).toEqual([290]);
    expect(orbitRadii([], "schematic", 60, 290)).toEqual([]);
  });
});

describe("drawnRadii", () => {
  const planets = sorted(PLANET_IDS);
  test("sizes keeps true ratios: Jupiter/Earth ≈ 11, the Sun ≈ 10 Jupiters", () => {
    const r = drawnRadii(B("sun"), planets, "sizes", 70);
    const at = (id: string) => r.bodies[planets.findIndex((b) => b.id === id)];
    expect(at("jupiter")).toBe(70);
    expect(at("jupiter") / at("earth")).toBeCloseTo(69911 / 6371, 1);
    expect(r.centre).toBeCloseTo((70 * 695700) / 69911, 3);
  });
  test("schematic compresses by the square root; small bodies never vanish", () => {
    const r = drawnRadii(B("sun"), planets, "schematic", 14);
    const at = (id: string) => r.bodies[planets.findIndex((b) => b.id === id)];
    expect(at("jupiter") / at("earth")).toBeCloseTo(Math.sqrt(69911 / 6371), 2);
    expect(at("mercury")).toBeGreaterThanOrEqual(MIN_BODY_PX);
    expect(drawnRadii(B("sun"), planets, "log", 14)).toEqual(r);
  });
  test("distances: every body the same small dot; the centre true-relative when the scale is given", () => {
    expect(drawnRadii(B("sun"), planets, "distances", 14)).toEqual({ centre: 8, bodies: planets.map(() => 5) });
    const pxPerKm = 290 / B("mars").a_km;
    expect(drawnRadii(B("sun"), planets, "distances", 14, pxPerKm).centre).toBe(3); // 0.9 px, floored
    expect(drawnRadii(B("jupiter"), moonsOf(all, "jupiter"), "distances", 14, 290 / B("callisto").a_km).centre).toBeCloseTo((290 * 69911) / 1882700, 3);
  });
  test("a body alone gets the budget", () => {
    expect(drawnRadii(B("venus"), [], "schematic", 120)).toEqual({ centre: 120, bodies: [] });
  });
});

describe("the Sun as a segment", () => {
  test("a circle that leaves the frame is clipped to it, and its visible arc is a contiguous run inside", () => {
    const { fill, arc, clipped } = sunSegment([-767, 390], 877, FRAME);
    expect(clipped).toBe(true);
    for (const [x, y] of fill) {
      expect(x).toBeGreaterThanOrEqual(FRAME.x0 - 1e-6);
      expect(x).toBeLessThanOrEqual(FRAME.x1 + 1e-6);
      expect(y).toBeGreaterThanOrEqual(FRAME.y0 - 1e-6);
      expect(y).toBeLessThanOrEqual(FRAME.y1 + 1e-6);
    }
    expect(arc.length).toBeGreaterThan(10);
    for (const [x] of arc) expect(x).toBeGreaterThanOrEqual(FRAME.x0);
    for (let i = 1; i < arc.length; i++) expect(Math.hypot(arc[i][0] - arc[i - 1][0], arc[i][1] - arc[i - 1][1])).toBeLessThan(40);
  });
  test("a circle inside the frame is untouched", () => {
    const { fill, arc, clipped } = sunSegment([160, 390], 97, FRAME);
    expect(clipped).toBe(false);
    expect(fill).toHaveLength(240);
    expect(arc).toHaveLength(240);
  });
  test("clipRingToBox is Sutherland–Hodgman: a square half outside comes back as the inside half", () => {
    const out = clipRingToBox([[-10, 0], [10, 0], [10, 10], [-10, 10]], { x0: 0, y0: 0, x1: 100, y1: 100 });
    expect(out).toEqual([[0, 0], [10, 0], [10, 10], [0, 10]]);
    const first = circle([0, 0], 1, 4)[0];
    expect(first[0]).toBeCloseTo(-1, 9);
    expect(first[1]).toBeCloseTo(0, 9);
  });
});

describe("the note, the bar and the tiers", () => {
  test("every scale mode states which truth it keeps, in both languages", () => {
    expect(scaleNote("schematic", "en")).toBe("Not to scale");
    expect(scaleNote("sizes", "en")).toBe("Sizes to scale, distances not");
    expect(scaleNote("sizes", "en", true)).toBe("Planet sizes to scale, Sun reduced, distances not");
    expect(scaleNote("distances", "en")).toBe("Distances to scale, sizes not");
    expect(scaleNote("log", "en")).toBe("Log distances");
    expect(scaleNote("schematic", "nb")).toBe("Ikke i målestokk");
    expect(scaleNote("distances", "nb")).toBe("Avstander i målestokk, størrelser ikke");
  });
  test("the bar picks a round unit that draws between 50 and 300 px", () => {
    expect(scaleBar("sizes", 0.001, "en")).toEqual({ lengthPx: 100, label: "100\u202f000\u202fkm" });
    const mars = scaleBar("distances", 290 / B("mars").a_km, "en");
    expect(mars?.label).toBe("1 AU");
    expect(mars?.lengthPx).toBeCloseTo(190.3, 0);
    const neptune = scaleBar("distances", 290 / B("neptune").a_km, "en");
    expect(neptune?.label).toBe("10 AU");
    expect(neptune?.lengthPx).toBeCloseTo(96.1, 0);
    expect(scaleBar("schematic", 0.001, "en")).toBeNull();
    expect(scaleBar("log", 0.001, "en")).toBeNull();
  });
  test("labelTiers drops a name to the next tier when its neighbour's is too close", () => {
    expect(labelTiers([100, 130, 160, 400], [70, 70, 70, 70], 6)).toEqual([0, 1, 2, 0]);
    expect(labelTiers([100, 300], [70, 70], 6)).toEqual([0, 0]);
    expect(labelTiers([], [], 6)).toEqual([]);
  });
});
```

`rules.ts` writes the thousands separator as the escape `\u202f` (narrow no-break space) and every test spells it the same way — never as a typed character, which editors silently normalise.

- [ ] **Step 5: Run to verify it fails**

Run: `npx vitest run tests/space-rules.test.ts`
Expected: FAIL — cannot resolve `../src/scenes/space/rules`.

- [ ] **Step 6: Write the rules**

Create `src/scenes/space/rules.ts`:

```ts
// The space pack's pure rules: which bodies a selection names, how big and
// how far apart they are drawn under each scale mode, the Sun as a segment
// inside the frame, the scale note and bar, label tiers. No DOM, no clock,
// no astronomy — those live in ephemeris.ts. A layout body cannot import, so
// the engine (engine.ts) re-exposes these as engines.space.*.

import type { Pt } from "../../layout/model";
import type { BodiesTable, Body, Frame, ScaleMode } from "./types";

export const AU_KM = 149597870.7;

export const PLANET_IDS = ["mercury", "venus", "earth", "mars", "jupiter", "saturn", "uranus", "neptune"] as const;
export const DWARF_IDS = ["pluto", "ceres", "eris", "haumea", "makemake"] as const;
const GROUPS: Record<string, readonly string[]> = {
  planets: PLANET_IDS,
  inner: PLANET_IDS.slice(0, 4),
  outer: PLANET_IDS.slice(4),
  all: [...PLANET_IDS, ...DWARF_IDS],
};

/** The frame every view draws inside; the strip below y0 holds the notes and the bar. */
export const FRAME: Frame = { x0: 60, y0: 80, x1: 940, y1: 700 };
/** The smallest disc worth drawing: below this a body is a stroke-width blob. */
export const MIN_BODY_PX = 2.5;

export function indexBodies(table: BodiesTable): Record<string, Body> {
  const out: Record<string, Body> = {};
  for (const b of table.bodies) out[b.id] = b;
  return out;
}

/**
 * Group words expand in place; ids and names (en/nb) match case-insensitively;
 * duplicates collapse; unknown names are reported, never thrown (anatomy's rule).
 */
export function expandBodies(all: Record<string, Body>, sel: readonly string[]): { ids: string[]; missing: string[] } {
  const byName = new Map<string, string>();
  for (const b of Object.values(all)) {
    byName.set(b.id, b.id);
    byName.set(b.name.en.toLowerCase(), b.id);
    byName.set(b.name.nb.toLowerCase(), b.id);
  }
  const ids: string[] = [];
  const missing: string[] = [];
  const take = (id: string): void => {
    if (!ids.includes(id)) ids.push(id);
  };
  for (const raw of sel) {
    if (typeof raw !== "string") continue;
    const key = raw.trim().toLowerCase();
    if (key === "") continue;
    const group = GROUPS[key];
    if (group) {
      for (const id of group) if (all[id]) take(id);
      continue;
    }
    const id = byName.get(key);
    if (id) take(id);
    else missing.push(raw.trim());
  }
  return { ids, missing };
}

/** Direct children, innermost first. */
export function moonsOf(all: Record<string, Body>, parentId: string): Body[] {
  return Object.values(all).filter((b) => b.parent === parentId).sort((a, b) => a.a_km - b.a_km);
}

/**
 * What orbits the focus body: every child by default, or the `moons`
 * selection — moon ids, or the parent's own id meaning all of them —
 * restricted to the focus body's children. No focus, no satellites.
 */
export function satellitesFor(all: Record<string, Body>, focus: string | null, moons: readonly string[] | undefined): { ids: string[]; missing: string[] } {
  if (!focus || !all[focus]) return { ids: [], missing: [] };
  const own = moonsOf(all, focus).map((b) => b.id);
  if (!moons || moons.length === 0) return { ids: own, missing: [] };
  const ids: string[] = [];
  const named = expandBodies(all, moons);
  const missing = [...named.missing];
  for (const id of named.ids) {
    if (id === focus) {
      for (const m of own) if (!ids.includes(m)) ids.push(m);
    } else if (own.includes(id)) {
      if (!ids.includes(id)) ids.push(id);
    } else {
      missing.push(`${id} (not a moon of ${focus})`);
    }
  }
  ids.sort((a, b) => all[a].a_km - all[b].a_km);
  return { ids, missing };
}

/** Log mapping of a distance onto [rMin, rMax]; degenerate ranges land at rMax. */
export function logRadius(a: number, aMin: number, aMax: number, rMin: number, rMax: number): number {
  if (aMax <= aMin || a <= 0 || aMin <= 0) return rMax;
  const t = (Math.log(a) - Math.log(aMin)) / (Math.log(aMax) - Math.log(aMin));
  return rMin + Math.max(0, Math.min(1, t)) * (rMax - rMin);
}

/**
 * Orbit radii in canvas units for bodies SORTED by a_km ascending: even
 * spacing (schematic, sizes), proportional with the outermost at rMax
 * (distances), or log (log). One body sits midway (or at rMax for distances).
 */
export function orbitRadii(bodies: readonly Body[], mode: ScaleMode, rMin: number, rMax: number): number[] {
  const n = bodies.length;
  if (n === 0) return [];
  if (mode === "distances") {
    const aMax = Math.max(...bodies.map((b) => b.a_km)) || 1;
    return bodies.map((b) => (rMax * b.a_km) / aMax);
  }
  if (n === 1) return [(rMin + rMax) / 2];
  if (mode === "log") {
    const as = bodies.map((b) => b.a_km);
    const aMin = Math.min(...as), aMax = Math.max(...as);
    return bodies.map((b) => logRadius(b.a_km, aMin, aMax, rMin, rMax));
  }
  return bodies.map((_, i) => rMin + (i * (rMax - rMin)) / (n - 1));
}

/**
 * Drawn radii: the largest body gets `largestPx`; the rest follow true ratios
 * (sizes) or square-root ratios (schematic, log), floored at MIN_BODY_PX. The
 * centre follows the same rule UNCLAMPED (the layout clamps or clips it).
 * distances: every body a 5 px dot, the centre 8 px — or, given px per km,
 * true-relative between 3 and 105 px.
 */
export function drawnRadii(centre: Body, bodies: readonly Body[], mode: ScaleMode, largestPx: number, pxPerKm?: number): { centre: number; bodies: number[] } {
  if (mode === "distances") {
    const c = pxPerKm !== undefined ? Math.max(3, Math.min(105, pxPerKm * centre.r_km)) : 8;
    return { centre: c, bodies: bodies.map(() => 5) };
  }
  const f = mode === "sizes" ? (km: number) => km : Math.sqrt;
  const maxF = bodies.length > 0 ? Math.max(...bodies.map((b) => f(b.r_km))) : 0;
  if (maxF === 0) return { centre: largestPx, bodies: [] };
  const k = largestPx / maxF;
  return { centre: k * f(centre.r_km), bodies: bodies.map((b) => Math.max(MIN_BODY_PX, k * f(b.r_km))) };
}

/** n points on a circle, starting at the LEFTMOST point (angle −π) and going counter-clockwise. */
export function circle(c: Pt, r: number, n: number): Pt[] {
  const pts: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const t = -Math.PI + (2 * Math.PI * i) / n;
    pts.push([c[0] + r * Math.cos(t), c[1] + r * Math.sin(t)]);
  }
  return pts;
}

/** Sutherland–Hodgman clip of a closed ring to a rectangle (the anatomy layout's clipToBox). */
export function clipRingToBox(ring: Pt[], f: Frame): Pt[] {
  const clipEdge = (pts: Pt[], inside: (p: Pt) => boolean, intersect: (a: Pt, b: Pt) => Pt): Pt[] => {
    const res: Pt[] = [];
    for (let i = 0; i < pts.length; i++) {
      const cur = pts[i], prev = pts[(i - 1 + pts.length) % pts.length];
      const ci = inside(cur), pi = inside(prev);
      if (ci) {
        if (!pi) res.push(intersect(prev, cur));
        res.push(cur);
      } else if (pi) {
        res.push(intersect(prev, cur));
      }
    }
    return res;
  };
  const lerpX = (a: Pt, b: Pt, x: number): Pt => [x, a[1] + (b[1] - a[1]) * ((x - a[0]) / (b[0] - a[0]))];
  const lerpY = (a: Pt, b: Pt, y: number): Pt => [a[0] + (b[0] - a[0]) * ((y - a[1]) / (b[1] - a[1])), y];
  let out = ring;
  out = clipEdge(out, (p) => p[0] >= f.x0, (a, b) => lerpX(a, b, f.x0));
  out = clipEdge(out, (p) => p[0] <= f.x1, (a, b) => lerpX(a, b, f.x1));
  out = clipEdge(out, (p) => p[1] >= f.y0, (a, b) => lerpY(a, b, f.y0));
  out = clipEdge(out, (p) => p[1] <= f.y1, (a, b) => lerpY(a, b, f.y1));
  return out;
}

/**
 * The Sun that does not fit: its disc clipped to the frame (`fill`, an area)
 * and the part of its rim that lies inside (`arc`, an open stroke). Because
 * `circle` starts at the leftmost point, a centre off to the LEFT of the
 * frame gives a contiguous arc; a disc wholly inside comes back untouched.
 */
export function sunSegment(c: Pt, r: number, f: Frame): { fill: Pt[]; arc: Pt[]; clipped: boolean } {
  const ring = circle(c, r, 240);
  const inside = (p: Pt): boolean => p[0] >= f.x0 && p[0] <= f.x1 && p[1] >= f.y0 && p[1] <= f.y1;
  const arc = ring.filter(inside);
  const clipped = arc.length < ring.length;
  return { fill: clipped ? clipRingToBox(ring, f) : ring, arc, clipped };
}

const NOTES: Record<ScaleMode, { en: string; nb: string }> = {
  schematic: { en: "Not to scale", nb: "Ikke i målestokk" },
  sizes: { en: "Sizes to scale, distances not", nb: "Størrelser i målestokk, avstander ikke" },
  distances: { en: "Distances to scale, sizes not", nb: "Avstander i målestokk, størrelser ikke" },
  log: { en: "Log distances", nb: "Logaritmiske avstander" },
};
const SUN_REDUCED = { en: "Planet sizes to scale, Sun reduced, distances not", nb: "Planetstørrelser i målestokk, Solen forminsket, avstander ikke" };

/** Which truth the figure keeps — every figure says so. */
export function scaleNote(mode: ScaleMode, lang: "en" | "nb", sunReduced = false): string {
  if (mode === "sizes" && sunReduced) return SUN_REDUCED[lang];
  return NOTES[mode][lang];
}

/** U+202F, narrow no-break space: the thousands separator in every number the pack writes. */
export const THIN = "\u202f";
export const fmtInt = (n: number): string => Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, THIN);

/**
 * A bar between 50 and 300 px in a round unit: km of RADIUS for sizes
 * (pxPerKm = px per km of radius), AU of DISTANCE for distances. The
 * schematic view has no scale; log's ruler is the layout's own.
 */
export function scaleBar(mode: ScaleMode, pxPerKm: number, lang: "en" | "nb"): { lengthPx: number; label: string } | null {
  if (!(pxPerKm > 0)) return null;
  const pick = (units: number[], pxPer: number): number | null => {
    for (const u of units) {
      const px = u * pxPer;
      if (px >= 50 && px <= 300) return u;
    }
    return null;
  };
  if (mode === "sizes") {
    const u = pick([10000, 100000, 1000000, 10000000], pxPerKm);
    return u === null ? null : { lengthPx: u * pxPerKm, label: `${fmtInt(u)}${THIN}km` };
  }
  if (mode === "distances") {
    const pxPerAu = pxPerKm * AU_KM;
    const u = pick([0.1, 1, 10, 100], pxPerAu);
    return u === null ? null : { lengthPx: u * pxPerAu, label: `${u < 1 ? (lang === "nb" ? "0,1" : "0.1") : u}${THIN}AU` };
  }
  return null;
}

/**
 * Tiers for names under a row of bodies (xs ascending): a name takes the
 * lowest tier whose last name ends more than `gap` before this one starts.
 */
export function labelTiers(xs: readonly number[], widths: readonly number[], gap: number): number[] {
  const ends: number[] = [];
  return xs.map((x, i) => {
    const start = x - widths[i] / 2, end = x + widths[i] / 2;
    let t = 0;
    while (t < ends.length && ends[t] + gap > start) t++;
    ends[t] = end;
    return t;
  });
}
```

- [ ] **Step 7: Run, typecheck, commit**

Run: `npx vitest run tests/space-rules.test.ts && npx tsc --noEmit`
Expected: PASS (the distances bar for Mars: 290 / 227 956 000 × 149 597 870.7 = 190.3 px for 1 AU; for Neptune 1 AU = 9.6 px, so 10 AU = 96.1 px).

```bash
git add package.json package-lock.json src/scenes/space/bodies.json src/scenes/space/types.ts src/scenes/space/rules.ts tests/space-rules.test.ts
git commit -m "Space: astronomy-engine pinned, the bodies table, and the pure scale rules"
```

---

## Task 2: The ephemeris — positions, moon positions, phase, the date

**Files:**
- Create: `src/scenes/space/ephemeris.ts`
- Test: `tests/space-ephemeris.test.ts`

**Interfaces:**
- Consumes: `Body`, `Vec`, `MoonPhaseInfo` from Task 1's `types.ts`; `AU_KM` from `rules.ts`; astronomy-engine (`HelioVector`, `GeoMoon`, `JupiterMoons`, `Illumination`, `MoonPhase`, `Body`).
- Produces (used by Task 3):
  - `resolveDate(date: unknown, days: unknown): Date`
  - `daysSinceJ2000(d: Date): number`, `J2000_MS`
  - `eqjToEcliptic(v: {x,y,z}): Vec`
  - `circularAngle(body: Body, d: Date): number` (radians)
  - `helioPositions(all: Record<string, Body>, ids: readonly string[], d: Date): Record<string, Vec>` (AU)
  - `moonPositionsKm(all, parentId: string, ids: readonly string[], d: Date): Record<string, { x: number; y: number }>` (km)
  - `moonPhase(d: Date): MoonPhaseInfo`
  - `EPHEMERIS_IDS: ReadonlySet<string>` (the 15 bodies with a real ephemeris)
  - `PHASE_NAMES: { en: string; nb: string }[]`

- [ ] **Step 1: Write the failing tests**

Create `tests/space-ephemeris.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import bodiesJson from "../src/scenes/space/bodies.json";
import type { BodiesTable } from "../src/scenes/space/types";
import { AU_KM, indexBodies } from "../src/scenes/space/rules";
import {
  EPHEMERIS_IDS, J2000_MS, PHASE_NAMES, circularAngle, daysSinceJ2000, eqjToEcliptic, helioPositions, moonPhase, moonPositionsKm, resolveDate,
} from "../src/scenes/space/ephemeris";

const all = indexBodies(bodiesJson as unknown as BodiesTable);
const D = resolveDate("2026-09-06", 0);
const deg = (r: number): number => ((r * 180) / Math.PI + 360) % 360;
const norm = (p: { x: number; y: number }): number => Math.hypot(p.x, p.y);

describe("resolveDate", () => {
  test("an ISO date is that day at UTC midnight; days shift it, fractions included", () => {
    expect(D.toISOString()).toBe("2026-09-06T00:00:00.000Z");
    expect(resolveDate("2026-09-06", 1.5).toISOString()).toBe("2026-09-07T12:00:00.000Z");
    expect(resolveDate("2026-09-06T14:30:00+02:00", 0).toISOString()).toBe("2026-09-06T00:00:00.000Z");
  });
  test("'today', undefined and garbage are today's UTC midnight", () => {
    const now = new Date();
    const midnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    expect(resolveDate("today", 0).getTime()).toBe(midnight);
    expect(resolveDate(undefined, undefined).getTime()).toBe(midnight);
    expect(resolveDate("yesterday-ish", "3").getTime()).toBe(midnight);
  });
  test("J2000 is 2000-01-01 12:00 UTC", () => {
    expect(daysSinceJ2000(resolveDate("2000-01-01", 0))).toBe(-0.5);
    expect(J2000_MS).toBe(Date.UTC(2000, 0, 1, 12));
  });
});

describe("heliocentric positions (astronomy-engine, rotated to the ecliptic)", () => {
  test("Earth is one AU from the Sun on 2026-09-06, in the ecliptic plane, at a heliocentric longitude near 343°", () => {
    const p = helioPositions(all, ["earth"], D).earth;
    expect(norm(p)).toBeGreaterThan(0.98);
    expect(norm(p)).toBeLessThan(1.02);
    expect(Math.abs(p.z)).toBeLessThan(0.005); // in the EQUATORIAL frame this would be ~0.4 AU
    const lon = deg(Math.atan2(p.y, p.x));
    expect(lon).toBeGreaterThan(335);
    expect(lon).toBeLessThan(352);
  });
  test("the Sun is the origin; Mars lies between perihelion and aphelion", () => {
    const p = helioPositions(all, ["sun", "mars"], D);
    expect(p.sun).toEqual({ x: 0, y: 0, z: 0 });
    expect(norm(p.mars)).toBeGreaterThan(1.38);
    expect(norm(p.mars)).toBeLessThan(1.67);
  });
  test("one Martian year later Mars has come round to the same longitude", () => {
    const a = helioPositions(all, ["mars"], D).mars;
    const b = helioPositions(all, ["mars"], resolveDate("2026-09-06", all.mars.period_d)).mars;
    const da = Math.abs(deg(Math.atan2(a.y, a.x)) - deg(Math.atan2(b.y, b.x)));
    expect(Math.min(da, 360 - da)).toBeLessThan(1.5);
  });
  test("a moon reports its parent's position; unknown ids are left out", () => {
    const p = helioPositions(all, ["io", "jupiter", "krypton"], D);
    expect(p.io).toEqual(p.jupiter);
    expect(p.krypton).toBeUndefined();
  });
  test("a body without an ephemeris rides the circular sketch at its semi-major axis", () => {
    const p = helioPositions(all, ["ceres"], D).ceres;
    expect(norm(p)).toBeCloseTo(all.ceres.a_km / AU_KM, 9);
    expect(EPHEMERIS_IDS.has("ceres")).toBe(false);
    expect(EPHEMERIS_IDS.has("pluto")).toBe(true);
    expect(EPHEMERIS_IDS.size).toBe(15);
  });
  test("the rotation is the J2000 obliquity about x", () => {
    const v = eqjToEcliptic({ x: 1, y: 0, z: 0 });
    expect(v).toEqual({ x: 1, y: 0, z: 0 });
    const w = eqjToEcliptic({ x: 0, y: 0, z: 1 });
    expect(w.y).toBeCloseTo(Math.sin((23.4392911 * Math.PI) / 180), 9);
  });
});

describe("moon positions (parent-centred, km)", () => {
  test("the Moon is 356 000 – 407 000 km from Earth", () => {
    const r = norm(moonPositionsKm(all, "earth", ["moon"], D).moon);
    expect(r).toBeGreaterThan(356000);
    expect(r).toBeLessThan(407000);
  });
  test("the Galilean moons come out in order, Io at about 421 800 km", () => {
    const p = moonPositionsKm(all, "jupiter", ["callisto", "io", "europa", "ganymede"], D);
    expect(norm(p.io)).toBeGreaterThan(421800 * 0.95);
    expect(norm(p.io)).toBeLessThan(421800 * 1.05);
    expect(norm(p.io)).toBeLessThan(norm(p.europa));
    expect(norm(p.europa)).toBeLessThan(norm(p.ganymede));
    expect(norm(p.ganymede)).toBeLessThan(norm(p.callisto));
  });
  test("every other moon rides a circle of radius a_km and returns after one period", () => {
    const a = moonPositionsKm(all, "saturn", ["titan"], D).titan;
    expect(norm(a)).toBeCloseTo(all.titan.a_km, 6);
    const b = moonPositionsKm(all, "saturn", ["titan"], resolveDate("2026-09-06", all.titan.period_d)).titan;
    expect(b.x).toBeCloseTo(a.x, 3);
    expect(b.y).toBeCloseTo(a.y, 3);
  });
  test("a retrograde moon runs the other way; a foreign id is left out", () => {
    const t0 = resolveDate("2026-09-06", 0), t1 = resolveDate("2026-09-06", 0.5);
    const a = moonPositionsKm(all, "neptune", ["triton"], t0).triton, b = moonPositionsKm(all, "neptune", ["triton"], t1).triton;
    expect(a.x * b.y - a.y * b.x).toBeLessThan(0); // clockwise
    expect(moonPositionsKm(all, "jupiter", ["titan"], D).titan).toBeUndefined();
  });
  test("circularAngle: one period is one turn, from l0", () => {
    const fake = { ...all.ceres, period_d: 10, l0_deg: 90 };
    expect(circularAngle(fake, new Date(J2000_MS))).toBeCloseTo(Math.PI / 2, 9);
    expect(circularAngle(fake, new Date(J2000_MS + 10 * 86400000))).toBeCloseTo(Math.PI / 2 + 2 * Math.PI, 9);
  });
});

describe("moon phase", () => {
  test("fraction in [0, 1], a name from the eight, waxing below 180°", () => {
    const p = moonPhase(D);
    expect(p.fraction).toBeGreaterThanOrEqual(0);
    expect(p.fraction).toBeLessThanOrEqual(1);
    expect(PHASE_NAMES.map((n) => n.en)).toContain(p.name);
    expect(PHASE_NAMES.map((n) => n.nb)).toContain(p.name_nb);
    expect(p.waxing).toBe(p.angle < 180);
  });
  test("the least-lit day of a month is a new moon", () => {
    let best = moonPhase(D);
    for (let i = 1; i <= 30; i++) { const p = moonPhase(resolveDate("2026-09-06", i)); if (p.fraction < best.fraction) best = p; }
    expect(best.fraction).toBeLessThan(0.05);
    expect(best.name).toBe("new moon");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/space-ephemeris.test.ts`
Expected: FAIL — cannot resolve `../src/scenes/space/ephemeris`.

- [ ] **Step 3: Write the ephemeris**

Create `src/scenes/space/ephemeris.ts`:

```ts
// Positions for a date. astronomy-engine (MIT) where it has an ephemeris —
// the Sun, the eight planets and Pluto (HelioVector), the Moon (GeoMoon), the
// Galilean moons (JupiterMoons) — and a circular orbit of radius a_km for
// every other body. This is the ONE place in the pack that reads a clock
// (resolveDate); layouts stay deterministic by taking the Date it hands back.
//
// This file is reached in the browser only through engine.ts, which the
// engine loader dynamic-imports: that is what keeps the 116 KB of
// astronomy-engine out of the main chunk. Never import it from tray/ui code.

import * as AstroNs from "astronomy-engine";
import { AU_KM } from "./rules";
import type { Body, MoonPhaseInfo, Vec } from "./types";

// astronomy-engine ships CommonJS. Vite prebundles it with named exports;
// Node's ESM interop may hand the exports over directly or under `default`.
// One shim, both worlds — tests/space-ephemeris.test.ts proves the node path,
// the smoke (Task 10) the browser path.
const A: typeof AstroNs = (AstroNs as { HelioVector?: unknown }).HelioVector ? AstroNs : ((AstroNs as { default?: typeof AstroNs }).default as typeof AstroNs);

export const J2000_MS = Date.UTC(2000, 0, 1, 12, 0, 0);
const DAY_MS = 86400000;

/** Mean obliquity of the ecliptic at J2000. HelioVector, GeoMoon and JupiterMoons
 *  return J2000 EQUATORIAL (EQJ) vectors; one rotation about x makes them ecliptic. */
const OBLIQUITY_DEG = 23.4392911;
const EPS = (OBLIQUITY_DEG * Math.PI) / 180;
const COS_E = Math.cos(EPS), SIN_E = Math.sin(EPS);

const ASTRO_BODY: Record<string, AstroNs.Body> = {
  sun: A.Body.Sun,
  mercury: A.Body.Mercury,
  venus: A.Body.Venus,
  earth: A.Body.Earth,
  mars: A.Body.Mars,
  jupiter: A.Body.Jupiter,
  saturn: A.Body.Saturn,
  uranus: A.Body.Uranus,
  neptune: A.Body.Neptune,
  pluto: A.Body.Pluto,
};
const GALILEAN = ["io", "europa", "ganymede", "callisto"] as const;

/** Bodies whose position is a real ephemeris; every other body is the circular sketch. */
export const EPHEMERIS_IDS: ReadonlySet<string> = new Set([...Object.keys(ASTRO_BODY), "moon", ...GALILEAN]);

export function eqjToEcliptic(v: { x: number; y: number; z: number }): Vec {
  return { x: v.x, y: v.y * COS_E + v.z * SIN_E, z: -v.y * SIN_E + v.z * COS_E };
}

/**
 * "today" (or anything unusable) is the current UTC day at midnight — stable
 * within a day, so every figure in a session agrees; an ISO date (any time
 * part ignored) is that UTC midnight; `days` shifts either, fractions allowed.
 */
export function resolveDate(date: unknown, days: unknown): Date {
  let ms: number;
  const iso = typeof date === "string" ? date.trim() : "";
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/.exec(iso);
  if (m) {
    ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  } else {
    const now = new Date();
    ms = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  }
  const d = typeof days === "number" && Number.isFinite(days) ? days : 0;
  return new Date(ms + d * DAY_MS);
}

export function daysSinceJ2000(d: Date): number {
  return (d.getTime() - J2000_MS) / DAY_MS;
}

/** The circular sketch: 2π·t/period from the body's J2000 longitude (l0_deg, default 0); a negative period runs clockwise. */
export function circularAngle(body: Body, d: Date): number {
  if (!body.period_d) return 0;
  const l0 = ((body.l0_deg ?? 0) * Math.PI) / 180;
  return l0 + (2 * Math.PI * daysSinceJ2000(d)) / body.period_d;
}

/** Heliocentric ecliptic positions in AU. A moon reports its parent's position (it is invisible at any honest solar-system scale). */
export function helioPositions(all: Record<string, Body>, ids: readonly string[], d: Date): Record<string, Vec> {
  const out: Record<string, Vec> = {};
  const one = (id: string): Vec | null => {
    const b = all[id];
    if (!b) return null;
    if (id === "sun") return { x: 0, y: 0, z: 0 };
    if (b.parent && b.parent !== "sun") return one(b.parent);
    const ab = ASTRO_BODY[id];
    if (ab !== undefined) return eqjToEcliptic(A.HelioVector(ab, d));
    const t = circularAngle(b, d), r = b.a_km / AU_KM;
    return { x: r * Math.cos(t), y: r * Math.sin(t), z: 0 };
  };
  for (const id of ids) {
    const p = one(id);
    if (p) out[id] = p;
  }
  return out;
}

/**
 * Parent-centred ecliptic positions in km: GeoMoon for the Moon, JupiterMoons
 * for the Galileans, the circular sketch for the rest. Ids that are not moons
 * of `parentId` are left out.
 */
export function moonPositionsKm(all: Record<string, Body>, parentId: string, ids: readonly string[], d: Date): Record<string, { x: number; y: number }> {
  const out: Record<string, { x: number; y: number }> = {};
  let jm: AstroNs.JupiterMoonsInfo | null = null;
  for (const id of ids) {
    const b = all[id];
    if (!b || b.parent !== parentId) continue;
    if (parentId === "earth" && id === "moon") {
      const v = eqjToEcliptic(A.GeoMoon(d));
      out[id] = { x: v.x * AU_KM, y: v.y * AU_KM };
      continue;
    }
    if (parentId === "jupiter" && (GALILEAN as readonly string[]).includes(id)) {
      jm ??= A.JupiterMoons(d);
      // astronomy.d.ts names the four as io/europa/ganymede/callisto; an older
      // build exposes moon[0..3] in the same order — accept either.
      const info = jm as unknown as Record<string, { x: number; y: number; z: number }> & { moon?: { x: number; y: number; z: number }[] };
      const sv = info[id] ?? info.moon?.[GALILEAN.indexOf(id as (typeof GALILEAN)[number])];
      if (sv) {
        const v = eqjToEcliptic(sv);
        out[id] = { x: v.x * AU_KM, y: v.y * AU_KM };
        continue;
      }
    }
    const t = circularAngle(b, d);
    out[id] = { x: b.a_km * Math.cos(t), y: b.a_km * Math.sin(t) };
  }
  return out;
}

export const PHASE_NAMES: { en: string; nb: string }[] = [
  { en: "new moon", nb: "nymåne" },
  { en: "waxing crescent", nb: "voksende månesigd" },
  { en: "first quarter", nb: "første kvarter" },
  { en: "waxing gibbous", nb: "voksende måne" },
  { en: "full moon", nb: "fullmåne" },
  { en: "waning gibbous", nb: "avtagende måne" },
  { en: "last quarter", nb: "siste kvarter" },
  { en: "waning crescent", nb: "avtagende månesigd" },
];

/** The Moon's phase: illuminated fraction from Illumination, the waxing/waning side and the name from MoonPhase's 0–360° angle. */
export function moonPhase(d: Date): MoonPhaseInfo {
  const angle = A.MoonPhase(d);
  const fraction = A.Illumination(A.Body.Moon, d).phase_fraction;
  const i = Math.floor(((angle + 22.5) % 360) / 45);
  return { fraction, waxing: angle < 180, angle, name: PHASE_NAMES[i].en, name_nb: PHASE_NAMES[i].nb };
}
```

- [ ] **Step 4: Run, typecheck, commit**

Run: `npx vitest run tests/space-ephemeris.test.ts && npx tsc --noEmit`
Expected: PASS. If `tsc` complains that `AstroNs.JupiterMoonsInfo` does not exist, open `node_modules/astronomy-engine/astronomy.d.ts`, find the return type of `JupiterMoons` and use that name; if named imports come back undefined at runtime (`A.HelioVector is not a function`), the shim's `default` branch is the one in play — the test tells you which.

```bash
git add src/scenes/space/ephemeris.ts tests/space-ephemeris.test.ts
git commit -m "Space ephemeris: astronomy-engine positions rotated to the ecliptic, moons, phase, the one clock"
```

---

## Task 3: The `space` engine — loader, registry, and the hand-made lists

**Files:**
- Create: `src/scenes/space/engine.ts`
- Modify: `src/scenes/engines.ts:25-28` (imports, `KNOWN_ENGINES`), `:599-640` (loader + `ENGINE_DEFS`); `src/llm/author.ts:77`; `tests/author.test.ts:99`; `tests/molecule3d.test.ts:254`; `tests/engines.test.ts:147-152`
- Test: `tests/space-engine.test.ts`

**Interfaces:**
- Consumes: Tasks 1–2.
- Produces: `makeSpaceEngine(table: BodiesTable): SpaceEngine`; `ensureEngines(["space"])` / `getLoadedEngines(["space"]).space as SpaceEngine`; `KNOWN_ENGINES` includes `"space"`; `export type { SpaceEngine } from "./space/types"` in `engines.ts`.

- [ ] **Step 1: Write the failing test**

Create `tests/space-engine.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { ENGINE_DEFS, KNOWN_ENGINES, ensureEngines, getLoadedEngines, type SpaceEngine } from "../src/scenes/engines";
import { TEMPLATE_DOC_API_SCHEMA } from "../src/llm/author";

async function space(): Promise<SpaceEngine> {
  await ensureEngines(["space"]);
  return getLoadedEngines(["space"]).space as SpaceEngine;
}

describe("space engine (real load — node, no DOM)", () => {
  test("is a known engine with a loader, and the authoring schema's enum agrees", () => {
    expect(KNOWN_ENGINES).toContain("space");
    expect(ENGINE_DEFS.space).toBeDefined();
    expect(TEMPLATE_DOC_API_SCHEMA.properties.engines.items.enum).toContain("space");
  });

  test("bodies, groups and moons come from the table", async () => {
    const eng = await space();
    expect(eng.bodies(["planets"]).bodies.map((b) => b.id)).toHaveLength(8);
    expect(eng.bodies(["Jorden", "krypton"])).toMatchObject({ missing: ["krypton"] });
    expect(eng.body("mars")?.name.nb).toBe("Mars");
    expect(eng.moonsOf("jupiter").map((b) => b.id)).toEqual(["io", "europa", "ganymede", "callisto"]);
    expect(eng.satellites("jupiter", ["io"]).bodies.map((b) => b.id)).toEqual(["io"]);
    expect(Object.keys(eng.all())).toHaveLength(35);
  });

  test("positions, moon positions, phase and the schematic flag go through", async () => {
    const eng = await space();
    const d = eng.resolveDate("2026-09-06", 0);
    const p = eng.positions(["earth"], d).earth;
    expect(Math.hypot(p.x, p.y)).toBeCloseTo(1, 1);
    expect(typeof p.z).toBe("number");
    expect(Math.hypot(eng.moonPositions("earth", ["moon"], d).moon.x, eng.moonPositions("earth", ["moon"], d).moon.y)).toBeGreaterThan(350000);
    expect(eng.phase(d).fraction).toBeLessThanOrEqual(1);
    expect(eng.schematic("ceres")).toBe(true);
    expect(eng.schematic("mars")).toBe(false);
    expect(eng.au(eng.km(2))).toBeCloseTo(2, 9);
  });

  test("the scale rules are reachable from a layout body", async () => {
    const eng = await space();
    const inner = eng.bodies(["inner"]).bodies;
    expect(eng.orbitRadii(inner, "schematic", 60, 290)).toHaveLength(4);
    expect(eng.drawnRadii(eng.body("sun")!, inner, "sizes", 40).bodies).toHaveLength(4);
    expect(eng.sunSegment([-700, 390], 800, { x0: 60, y0: 80, x1: 940, y1: 700 }).clipped).toBe(true);
    expect(eng.scaleNote("schematic", "nb")).toBe("Ikke i målestokk");
    expect(eng.scaleBar("sizes", 0.001, "en")?.lengthPx).toBe(100);
    expect(eng.labelTiers([0, 10], [30, 30], 4)).toEqual([0, 1]);
    expect(eng.logRadius(10, 1, 100, 0, 100)).toBeCloseTo(50, 9);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/space-engine.test.ts`
Expected: FAIL — `SpaceEngine` is not exported from engines, `KNOWN_ENGINES` lacks `"space"`.

- [ ] **Step 3: Write the engine**

Create `src/scenes/space/engine.ts`:

```ts
// The object a layout sees as `engines.space` and the ⊕ Space section reads:
// the table's bodies, the ephemeris, and the scale rules, behind one interface.
// Built by engines.ts's loadSpace from the dynamically imported table; this
// module is the lazy chunk (it is what pulls astronomy-engine in).

import { AU_KM, drawnRadii, expandBodies, indexBodies, labelTiers, logRadius, moonsOf, orbitRadii, satellitesFor, scaleBar, scaleNote, sunSegment } from "./rules";
import { EPHEMERIS_IDS, helioPositions, moonPhase, moonPositionsKm, resolveDate } from "./ephemeris";
import type { BodiesTable, SpaceEngine } from "./types";

export function makeSpaceEngine(table: BodiesTable): SpaceEngine {
  const all = indexBodies(table);
  const toBodies = (r: { ids: string[]; missing: string[] }) => ({ bodies: r.ids.map((id) => all[id]), missing: r.missing });
  return {
    all: () => all,
    body: (id) => all[id],
    bodies: (sel) => toBodies(expandBodies(all, sel)),
    moonsOf: (parentId) => moonsOf(all, parentId),
    satellites: (focus, moons) => toBodies(satellitesFor(all, focus, moons)),
    resolveDate,
    positions: (ids, d) => helioPositions(all, ids, d),
    moonPositions: (parentId, ids, d) => moonPositionsKm(all, parentId, ids, d),
    phase: moonPhase,
    schematic: (id) => !EPHEMERIS_IDS.has(id),
    au: (km) => km / AU_KM,
    km: (au) => au * AU_KM,
    orbitRadii,
    logRadius,
    drawnRadii,
    sunSegment,
    scaleNote,
    scaleBar,
    labelTiers,
  };
}
```

- [ ] **Step 4: Register it in `engines.ts`**

In `src/scenes/engines.ts`:

a. After line 26 (`export type { AnatomyEngine } from "./anatomy/types";`) add:

```ts
import type { BodiesTable, SpaceEngine } from "./space/types";
export type { SpaceEngine } from "./space/types";
```

b. Line 28: `export const KNOWN_ENGINES = ["smilesdrawer", "mathjax", "chess", "geo", "anatomy", "space"] as const;`

c. After `loadAnatomy` (ends line ~634, before `export const ENGINE_DEFS`) add:

```ts
/** The solar system: the bodies table and astronomy-engine in one lazy chunk.
 *  engine.ts imports astronomy-engine statically, so the dynamic import of
 *  engine.ts IS the code-split boundary — never import ./space/engine or
 *  ./space/ephemeris statically from anywhere the main chunk reaches. */
async function loadSpace(): Promise<SpaceEngine> {
  const [{ makeSpaceEngine }, tableMod] = await Promise.all([import("./space/engine"), import("./space/bodies.json")]);
  return makeSpaceEngine(tableMod.default as unknown as BodiesTable);
}
```

d. In `ENGINE_DEFS` add `space: { load: loadSpace },` after `anatomy`.

- [ ] **Step 5: The hand-made lists**

- `src/llm/author.ts:77`: `enum: ["smilesdrawer", "mathjax", "chess", "geo", "anatomy", "space"]`.
- `tests/author.test.ts:99`: the same list with `"space"`.
- `tests/molecule3d.test.ts` after line 254: `if (needsPacks.has("space")) await ensureEngines(["space"]);` (no example names the pack yet; this is the seat it will take in Task 5).
- `tests/engines.test.ts:147-152`: add `expect(KNOWN_ENGINES).toContain("space");` and rename the test to `"KNOWN_ENGINES lists smilesdrawer, mathjax, chess, geo, anatomy and space"`. The set-equality tripwire two tests down passes on its own once both lists carry `space`.

- [ ] **Step 6: Run, typecheck, commit**

Run: `npx vitest run tests/space-engine.test.ts tests/engines.test.ts tests/author.test.ts tests/molecule3d.test.ts tests/template-doc.test.ts && npx tsc --noEmit`
Expected: PASS. (`template-doc.test.ts` checks `doc.ts`'s "unknown engine" message, which lists `KNOWN_ENGINES` — if it pins the joined string, add `space` there too.)

```bash
git add src/scenes/space/engine.ts src/scenes/engines.ts src/llm/author.ts tests/author.test.ts tests/molecule3d.test.ts tests/engines.test.ts tests/space-engine.test.ts
git commit -m "Space engine: lazy loader, KNOWN_ENGINES, and the four hand-made lists"
```

---

## Task 4: `kit.ball()` — the shaded disc (kit v9)

**Files:**
- Modify: `src/scenes/kit.ts:41` (`KIT_VERSION`), `:230-410` (the `SceneKit` interface — add after `label`), `:608-618` (the implementation — add after `label`); `tests/kit-smooth-closed.test.ts:43`
- Test: `tests/scene-kit.test.ts` (append a describe)

**Interfaces:**
- Produces: `kit.ball(id: string, c: Pt, r: number, o?: { fill?: string; color?: string; strokeWidth?: number; opacity?: number; roughness?: number; ms?: number }): StrokeDrawable` — one circle-hinted stroke with `style.fill` = the body colour and `style.fillGradient` = project3d's up-left sphere gradient; the rim colour defaults to a darker shade of the fill.

- [ ] **Step 1: Write the failing test**

Append to `tests/scene-kit.test.ts`:

```ts
describe("kit.ball — a shaded disc for 2D figures", () => {
  test("is one circle-hinted stroke carrying project3d's sphere gradient over the fill", () => {
    const b = kit.ball("mars", [100, 200], 12, { fill: "#c1613d" });
    expect(b.kind).toBe("stroke");
    expect(b.pts).toEqual([[100, 200]]);
    expect(b.shapeHint).toEqual({ type: "circle", c: [100, 200], r: 12 });
    expect(b.style.fill).toBe("#c1613d");
    expect(b.style.fillGradient).toEqual({
      fx: 0.32,
      fy: 0.3,
      r: 0.75,
      stops: [
        { offset: 0, color: shadeColor("#c1613d", 0.78) },
        { offset: 0.55, color: "#c1613d" },
        { offset: 1, color: shadeColor("#c1613d", 0.3) },
      ],
    });
    expect(b.style.color).toBe(shadeColor("#c1613d", 0.25)); // the rim: a darker shade of the fill
    expect(b.style.strokeWidth).toBe(2);
    expect(b.drawOpts.mode).toBe("sketch");
  });

  test("options override the rim, width and opacity; the fill defaults to the guide colour", () => {
    const b = kit.ball("x", [0, 0], 5, { color: "red", strokeWidth: 3, opacity: 0.5 });
    expect(b.style.color).toBe("red");
    expect(b.style.strokeWidth).toBe(3);
    expect(b.style.opacity).toBe(0.5);
    expect(b.style.fill).toBe(kit.COLORS.guide);
  });

  test("kit v9 ships it", () => {
    expect(KIT_VERSION).toBe(9);
  });
});
```

And in `tests/kit-smooth-closed.test.ts:43`: `expect(KIT_VERSION).toBe(9);`.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/scene-kit.test.ts tests/kit-smooth-closed.test.ts`
Expected: FAIL — `kit.ball is not a function`; `KIT_VERSION` 8.

- [ ] **Step 3: Implement**

`src/scenes/kit.ts:41`:

```ts
export const KIT_VERSION = 9; // v9: ball() — a shaded 2D disc (space); v8: smoothClosed() + roughness on stroke/area (anatomy); v7: GROUND (the figure's paper); v6: softAlpha() (race crossings); v5: COLORS.series + plotArea() + textWidth() (the data pack)
```

In the `SceneKit` interface, after the `label(...)` line (~257):

```ts
  /**
   * A shaded disc: ONE circle-hinted stroke whose radial-gradient fill is lit
   * from up-left — exactly the look project3d gives a solid sphere, for flat
   * figures (planets, moons, balls). `fill` is the body's colour (6-digit hex
   * shades best); the rim defaults to a darker shade of it. Complete the
   * instant its circle finishes drawing; no overlay drawables.
   */
  ball(id: string, c: Pt, r: number, o?: { fill?: string; color?: string; strokeWidth?: number; opacity?: number; roughness?: number; ms?: number }): StrokeDrawable;
```

In the implementation object, after `label(...)` (~618):

```ts
  ball(id, c, r, o = {}) {
    const fill = o.fill ?? COLORS.guide;
    return {
      id,
      kind: "stroke",
      pts: [c],
      shapeHint: { type: "circle", c, r },
      z: Z_STROKE,
      style: defaultStyle({
        color: o.color ?? shadeColor(fill, 0.25),
        fill,
        fillGradient: {
          fx: 0.32,
          fy: 0.3,
          r: 0.75,
          stops: [
            { offset: 0, color: shadeColor(fill, 0.78) },
            { offset: 0.55, color: fill },
            { offset: 1, color: shadeColor(fill, 0.3) },
          ],
        },
        strokeWidth: o.strokeWidth ?? 2,
        ...(o.opacity !== undefined && { opacity: o.opacity }),
        ...(o.roughness !== undefined && { roughness: o.roughness }),
      }),
      drawOpts: defaultDrawOpts("sketch", o.ms ?? SKETCH_MS.node),
    };
  },
```

(`shadeColor`, `defaultStyle`, `defaultDrawOpts`, `Z_STROKE`, `SKETCH_MS.node` are all already in scope in kit.ts — the project3d sphere branch at ~line 980 uses every one of them.)

- [ ] **Step 4: Run, typecheck, commit**

Run: `npx vitest run tests/scene-kit.test.ts tests/kit-smooth-closed.test.ts tests/template-doc.test.ts && npx tsc --noEmit`
Expected: PASS. (`anatomy.yaml` declares `kit: 8`, which is ≤ 9 and still valid.)

```bash
git add src/scenes/kit.ts tests/scene-kit.test.ts tests/kit-smooth-closed.test.ts
git commit -m "kit v9: ball(), the shaded disc project3d's spheres already have, for flat figures"
```

---

## Task 5: The `solar_system` template, the pack, and its first example

**Files:**
- Create: `src/scenes/packs/space.yaml`
- Modify: `src/scenes/packs.ts:109-115` (PACK_DEFS entry after `data`), `src/store.ts:191` (enabledPacks), `src/examples.json` (append at the end, before the closing `]`)
- Test: `tests/space-template.test.ts`

**Interfaces:**
- Consumes: `engines.space` (Task 3's `SpaceEngine`), `kit.ball` (Task 4), the kit.
- Produces: template `solar_system` with element ids `sun`, `<body_id>`, `orbit_<id>`, `label_<id>`, `axis`, `frame`, `scale_note`, `scale_bar`, `missing_note`, `title`; params `bodies`, `view`, `scale`, `date`, `days`, `orbits`, `moons`, `focus`, `names`, `highlight`, `title`. Sub-drawable ids (never in `order`): `<id>__disc`, `<id>__ringb`, `<id>__ringb_o`, `<id>__ringf`, `<id>__ringf_o`, `sun__fill`, `sun__arc`, `scale_bar__line`, `scale_bar__t0`, `scale_bar__t1`, `scale_bar__label`.

- [ ] **Step 1: Write the failing tests**

Create `tests/space-template.test.ts`:

```ts
import { beforeAll, describe, expect, test } from "vitest";
import spaceYaml from "../src/scenes/packs/space.yaml?raw";
import bundledExamples from "../src/examples.json";
import { registerPack, unregisterPack } from "../src/scenes/packs";
import { scenes } from "../src/scenes/registry";
import { ensureEngines } from "../src/scenes/engines";
import { COLORS, flattenDrawables, leafDrawables, type Drawable, type StrokeDrawable } from "../src/layout/model";
import { elementBBoxes, layoutSpec } from "../src/layout/layout";

const DATE = "2026-09-06";
const lay = (params: Record<string, unknown>) => scenes.solar_system.layout!({ date: DATE, ...params });
const idsOf = (params: Record<string, unknown>) => lay(params).order;
const leaf = (r: ReturnType<typeof lay>, id: string): Drawable | undefined => flattenDrawables(r.drawables).find((d) => d.id === id);
/** The drawn radius of a body: its own circle hint, or its disc's inside a ringed group. */
const radiusOf = (r: ReturnType<typeof lay>, id: string): number => {
  const d = (leaf(r, id + "__disc") ?? leaf(r, id)) as StrokeDrawable | undefined;
  return d?.shapeHint?.type === "circle" ? d.shapeHint.r : NaN;
};
/** Label text wherever the layout put it: a solver request (top views) or a placed text (row). */
const labelText = (r: ReturnType<typeof lay>, id: string): string | undefined => {
  const req = r.labels.find((l) => l.id === id);
  if (req) return req.text;
  const d = leaf(r, id);
  return d && d.kind === "text" ? d.text : undefined;
};
const spec = (params: Record<string, unknown>) => ({ template: "solar_system", params: { date: DATE, ...params }, elements: [] }) as never;
const PLANETS = ["mercury", "venus", "earth", "mars", "jupiter", "saturn", "uranus", "neptune"];

beforeAll(async () => {
  await ensureEngines(["space"]);
  unregisterPack("space");
  registerPack("space", spaceYaml);
});

describe("solar_system: registration and the default figure", () => {
  test("registers as one ready template", () => {
    unregisterPack("space");
    expect(registerPack("space", spaceYaml)).toMatchObject({ ok: true, templateIds: ["solar_system"] });
  });

  test("draws the Sun, the eight planets, their orbits and names, and the scale note", () => {
    const ids = idsOf({});
    expect(ids).toContain("sun");
    for (const p of PLANETS) {
      expect(ids).toContain(p);
      expect(ids).toContain("orbit_" + p);
      expect(ids).toContain("label_" + p);
    }
    expect(ids).toContain("label_sun");
    expect(ids).toContain("scale_note");
    expect(ids).not.toContain("scale_bar");
    expect(ids).not.toContain("frame");
    expect(ids).not.toContain("axis");
    expect(ids).not.toContain("pluto");
  });

  test("group words and ids select the bodies; unknown names and moons go to the note", () => {
    expect(idsOf({ bodies: ["inner"] }).filter((id) => PLANETS.includes(id))).toEqual(["mercury", "venus", "earth", "mars"]);
    expect(idsOf({ bodies: ["all"] })).toContain("eris");
    const r = lay({ bodies: ["planets", "krypton", "io"] });
    expect(r.order).not.toContain("io");
    expect(labelText(r, "missing_note")).toBe("Unknown: krypton, io (a moon: use focus)");
    expect(r.order.filter((id) => PLANETS.includes(id))).toHaveLength(8);
  });

  test("names: en, nb or none", () => {
    expect(labelText(lay({}), "label_earth")).toBe("Earth");
    expect(labelText(lay({ names: "nb" }), "label_earth")).toBe("Jorden");
    expect(labelText(lay({ names: "nb" }), "scale_note")).toBe("Ikke i målestokk");
    expect(idsOf({ names: "none" }).some((id) => id.startsWith("label_"))).toBe(false);
  });

  test("orbits can be switched off, and a row never has them", () => {
    expect(idsOf({ orbits: false }).some((id) => id.startsWith("orbit_"))).toBe(false);
    expect(idsOf({ view: "row" }).some((id) => id.startsWith("orbit_"))).toBe(false);
  });

  test("the same params give byte-identical layouts — no clock in the layout", () => {
    expect(JSON.stringify(lay({ view: "tilted" }))).toBe(JSON.stringify(lay({ view: "tilted" })));
  });
});

describe("solar_system: scale", () => {
  test("schematic keeps the Sun within a sixth of the frame, in both views", () => {
    expect(radiusOf(lay({}), "sun")).toBeLessThanOrEqual(104);
    expect(radiusOf(lay({ view: "row" }), "sun")).toBeLessThanOrEqual(104);
  });

  test("sizes in a row keeps Jupiter/Earth ≈ 11 and shows the Sun as a segment inside the canvas", () => {
    const r = lay({ view: "row", scale: "sizes" });
    expect(radiusOf(r, "jupiter") / radiusOf(r, "earth")).toBeGreaterThan(10.5);
    expect(radiusOf(r, "jupiter") / radiusOf(r, "earth")).toBeLessThan(11.5);
    const sun = leaf(r, "sun");
    expect(sun?.kind).toBe("group");
    const kids = leafDrawables([sun!]);
    expect(kids.map((d) => d.id).sort()).toEqual(["sun__arc", "sun__fill"]);
    for (const d of kids) {
      for (const [x, y] of (d as { pts: [number, number][] }).pts) {
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThanOrEqual(1000);
        expect(y).toBeGreaterThanOrEqual(0);
        expect(y).toBeLessThanOrEqual(750);
      }
    }
    expect(labelText(r, "scale_note")).toBe("Sizes to scale, distances not");
    expect(labelText(r, "scale_bar__label")).toMatch(/km$/);
  });

  test("sizes from above clamps the Sun and says so", () => {
    const r = lay({ view: "top", scale: "sizes" });
    expect(radiusOf(r, "sun")).toBeLessThanOrEqual(104);
    expect(labelText(r, "scale_note")).toBe("Planet sizes to scale, Sun reduced, distances not");
  });

  test("distances: orbits proportional to a, every body the same dot, a bar in AU", () => {
    const r = lay({ scale: "distances", bodies: ["inner"] });
    const orbitR = (id: string): number => {
      const o = leaf(r, "orbit_" + id) as StrokeDrawable;
      return Math.hypot(o.pts[0][0] - 500, o.pts[0][1] - 390);
    };
    expect(orbitR("mars") / orbitR("earth")).toBeCloseTo(227956000 / 149598000, 2);
    expect(radiusOf(r, "mercury")).toBe(radiusOf(r, "mars"));
    expect(labelText(r, "scale_note")).toBe("Distances to scale, sizes not");
    expect(labelText(r, "scale_bar__label")).toBe("1\u202fAU");
  });

  test("log: the note says so and the eight planets get a 1 → 10 AU ruler", () => {
    const r = lay({ scale: "log" });
    expect(labelText(r, "scale_note")).toBe("Log distances");
    expect(r.order).toContain("scale_bar");
    expect(labelText(r, "scale_bar__label")).toBe("1 → 10 AU");
    expect(idsOf({ scale: "log", bodies: ["inner"] })).not.toContain("scale_bar"); // no decade pair between 0.39 and 1.52 AU
  });

  test("every view × scale × selection lays out without a lint error", () => {
    for (const view of ["top", "row", "tilted"]) {
      for (const scale of ["schematic", "sizes", "distances", "log"]) {
        for (const bodies of [["planets"], ["all"], ["inner"]]) {
          const res = layoutSpec(spec({ view, scale, bodies }));
          expect(res.warnings, `${view}/${scale}/${bodies}`).toEqual([]);
          expect(res.issues.filter((i) => i.severity === "error").map((i) => i.message), `${view}/${scale}/${bodies}`).toEqual([]);
        }
      }
    }
  });

  test("the drawn point budget stays under 4000", () => {
    const pts = leafDrawables(lay({ bodies: ["all"] }).drawables).reduce((s, d) => s + ("pts" in d ? d.pts.length : 0), 0);
    expect(pts).toBeLessThan(4000);
  });
});

describe("solar_system: focus, moons, time, highlight, clicks", () => {
  test("focus draws the body large with its moons, orbits, axis and frame — and nothing else", () => {
    const ids = idsOf({ focus: "jupiter" });
    for (const m of ["io", "europa", "ganymede", "callisto"]) {
      expect(ids).toContain(m);
      expect(ids).toContain("orbit_" + m);
      expect(ids).toContain("label_" + m);
    }
    expect(ids).toContain("jupiter");
    expect(ids).toContain("axis");
    expect(ids).toContain("frame");
    expect(ids).not.toContain("sun");
    expect(ids).not.toContain("mars");
    expect(radiusOf(lay({ focus: "jupiter" }), "jupiter")).toBeGreaterThan(60);
  });

  test("moons filters the focus body's moons; a foreign moon goes to the note", () => {
    const ids = idsOf({ focus: "jupiter", moons: ["io"] });
    expect(ids).toContain("io");
    expect(ids).not.toContain("europa");
    expect(labelText(lay({ focus: "jupiter", moons: ["titan"] }), "missing_note")).toBe("Unknown: titan (not a moon of jupiter)");
  });

  test("a body without moons stands alone; Saturn brings its ring", () => {
    const venus = lay({ focus: "venus" });
    expect(venus.order).toEqual(expect.arrayContaining(["frame", "venus", "axis", "label_venus", "scale_note"]));
    expect(venus.order.some((id) => id.startsWith("orbit_"))).toBe(false);
    const saturn = lay({ focus: "saturn", moons: ["titan"] });
    expect(leafDrawables([leaf(saturn, "saturn")!]).map((d) => d.id)).toEqual(expect.arrayContaining(["saturn__ringb", "saturn__disc", "saturn__ringf"]));
  });

  test("nothing a focus figure draws leaves the canvas", () => {
    for (const focus of ["jupiter", "saturn", "earth", "pluto", "venus"]) {
      for (const scale of ["schematic", "sizes", "distances", "log"]) {
        const res = layoutSpec(spec({ focus, scale }));
        expect(res.issues.filter((i) => i.severity === "error").map((i) => i.message), `${focus}/${scale}`).toEqual([]);
      }
    }
  });

  test("days moves Mars along its orbit, and one Martian year brings it back", () => {
    const a = lay({ bodies: ["inner"] }).anchors.mars;
    const b = lay({ bodies: ["inner"], days: 100 }).anchors.mars;
    expect(Math.hypot(a[0] - b[0], a[1] - b[1])).toBeGreaterThan(40);
    const back = lay({ bodies: ["inner"], days: 687 }).anchors.mars;
    expect(Math.hypot(a[0] - back[0], a[1] - back[1])).toBeLessThan(12);
  });

  test("highlight tints the body's rim without removing anything", () => {
    const r = lay({ highlight: ["mars"] });
    expect((leaf(r, "mars") as StrokeDrawable).style.color).toBe(COLORS.accent);
    expect(r.order).toContain("venus");
  });

  test("a body's box is its disc, so a click-ask can hit even a small planet", () => {
    const box = elementBBoxes(layoutSpec(spec({}))).get("mercury")!;
    expect(box.w).toBeCloseTo(2 * radiusOf(lay({}), "mercury"), 3);
  });

  test("tilted compresses the vertical spread and keeps everything on the page", () => {
    const spread = (params: Record<string, unknown>): number => {
      const ys = PLANETS.map((p) => lay(params).anchors[p][1]);
      return Math.max(...ys) - Math.min(...ys);
    };
    expect(spread({ view: "tilted" })).toBeLessThan(0.7 * spread({ view: "top" }));
  });
});

describe("bundled space examples", () => {
  test("drawcast ships one space example", () => {
    expect((bundledExamples as { packs?: string[] }[]).filter((e) => e.packs?.includes("space"))).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/space-template.test.ts`
Expected: FAIL — cannot resolve `../src/scenes/packs/space.yaml?raw`.

- [ ] **Step 3: Write the pack**

Create `src/scenes/packs/space.yaml`:

```yaml
pack: space
title: Space
description: "The solar system: the Sun, planets, dwarf planets and moons drawn for a date at a chosen scale, every body clickable by name. Positions from astronomy-engine (MIT); facts from the NASA planetary fact sheets."
---
template: solar_system
title: The solar system (planets, dwarf planets, moons)
version: 1
kit: 9
status: ready
engines: [space]
description: >-
  The Sun and its planets from a curated table and a real ephemeris: seen from
  above with every planet at its TRUE position on its orbit for a date
  (`view: top`, the default), lined up for a size comparison (`row`), or
  through a camera 30° above the plane (`tilted`). EVERY BODY IS A NAMED
  ELEMENT whose id is its own name in lower case (sun, mercury, venus, earth,
  mars, jupiter, saturn, uranus, neptune; dwarfs pluto, ceres, eris, haumea,
  makemake; moons moon, phobos, deimos, io, europa, ganymede, callisto, mimas,
  enceladus, tethys, dione, rhea, titan, iapetus, miranda, ariel, umbriel,
  titania, oberon, triton, charon), so `ask` with widget "click" and answer
  "mars" asks the viewer to find Mars, widget "drag" with items [{"id":
  "mars", "label": "Mars"}, …] asks them to place the names, and `quiz` can ask
  about any of them. Orbits are `orbit_<id>`, written names `label_<id>`.
  No drawing shows sizes AND distances truthfully, so `scale` chooses which
  truth to keep and the figure says so in `scale_note`: schematic (default;
  sizes compressed, orbits evenly spaced), sizes (true relative radii —
  Jupiter eleven Earths across; in a row the Sun is so large only its edge
  fits the page), distances (true relative orbit radii, every body a dot —
  pair it with bodies ["inner"] or ["outer"]; the whole system crowds the
  inner planets into the Sun), log. `date` (ISO, or today) places the bodies;
  `days` is a numeric offset from it and THE ANIMATABLE HANDLE — {"animate":
  {"days": 687}} moves every body along its orbit for one Martian year.
  `focus: "jupiter"` draws that body large in the centre with its moons on
  their orbits, its ring and its spin axis, and leaves everything else out —
  the ONLY way moons are drawn (they are invisible at any honest solar-system
  scale); `moons` narrows to some of them. `names` chooses the label
  language; the `highlight` PARAM tints bodies for the whole figure — to make
  one glow for ONE sentence use the highlight COMMAND ({"highlight":
  {"target": ["mars"]}, "speak": "…"}), and a click question glows its answer
  by itself. Choose this scene for ANY request about the solar system, a
  planet, a moon, the order, sizes or distances of the planets, or where a
  planet is on a date. An unrecognised name is skipped and listed in a small
  note rather than failing. In the app the ⊕ tray's Space section lets the
  viewer click any body to look closer; {"explore": {"space": true}} is the
  authored invitation to do so.
params:
  type: object
  properties:
    bodies:
      type: array
      items: { type: string }
      description: "Which sun-orbiting bodies to draw: ids (mercury, venus, earth, mars, jupiter, saturn, uranus, neptune, pluto, ceres, eris, haumea, makemake) or group words that expand in place — planets (the eight; the default), inner (mercury–mars), outer (jupiter–neptune), all (planets and the five dwarf planets). Moons are NOT drawn here — see focus."
      x-translate: false
    view:
      type: string
      enum: [top, row, tilted]
      description: "top (default): the orbits seen from above, bodies at their true angles for the date. row: the classic line-up, the Sun at the left, for comparing sizes — no orbits. tilted: the same orbits through a camera 30° above the plane."
    scale:
      type: string
      enum: [schematic, sizes, distances, log]
      description: "Which truth the figure keeps. schematic (default): compressed sizes, even orbit spacing — 'Not to scale'. sizes: true relative radii, even spacing. distances: true relative orbit radii, every body the same dot — pair it with bodies inner or outer. log: orbit radius by the log of the distance."
    date:
      type: string
      description: "ISO date (2026-09-06) or today (the default). Every body sits where it really is on this date."
      x-translate: false
    days:
      type: number
      minimum: -3650
      maximum: 3650
      description: "Offset from date in days (default 0) — the animatable handle: animate days to 687 and Mars goes round once while Earth laps it. Write the starting value (0) in params when you animate."
    orbits:
      type: boolean
      description: "Draw the dashed orbit circles (default true; a row has none)."
    moons:
      type: array
      items: { type: string }
      description: "With focus: which of the focus body's moons to draw — moon ids (io, europa) or the parent's own id for all of them. Omit to draw every listed moon of the focus body. Without focus nothing here is drawn."
      x-translate: false
    focus:
      type: string
      description: "One body id. That body large in the centre with its moons on their orbits, its ring and its spin axis; the frame crops to it and everything else is left out. This is how you draw Jupiter and its moons, Saturn's rings, or the Earth–Moon pair."
      x-translate: false
    names:
      type: string
      enum: [en, nb, none]
      description: "Language of the written names: en (default), nb (Norwegian), none (no names — for a 'which one is…' question)."
    highlight:
      type: array
      items: { type: string }
      description: "Body ids to tint for the whole figure. Nothing is removed."
      x-translate: false
    title:
      type: string
element_ids:
  sun: the Sun — a shaded disc, or, in a row at true sizes, the visible edge of a disc far larger than the page
  <body_id>: every drawn body is its own element and its id IS its name in lower case (mars, jupiter, io) — the ids an ask with widget "click" or "drag" compares against; Saturn's ring is part of saturn
  orbit_<body_id>: that body's dashed orbit circle (top and tilted views; a row has none)
  label_<body_id>: that body's written name, when names is not none
  axis: the focus body's spin axis, leaning by its axial tilt (focus only)
  frame: a light dashed frame around the crop (focus only)
  scale_note: "which truth the figure keeps — \"Not to scale\", \"Sizes to scale, distances not\", …"
  scale_bar: a bar with its length written (1 AU, 100 000 km) — sizes, distances and log
  missing_note: "\"Unknown: …\" for names that matched nothing, and for moons named outside focus"
  title: figure title, when set
examples:
  - request: "Draw the solar system."
    params: { view: "top", date: "2026-09-06" }
  - request: "How big are the planets compared with each other?"
    params: { view: "row", scale: "sizes", date: "2026-09-06" }
  - request: "Vis Jupiter og månene dens."
    params: { focus: "jupiter", names: "nb", date: "2026-09-06" }
  - request: "Where are the inner planets right now, to scale?"
    params: { view: "top", scale: "distances", bodies: ["inner"] }
layout: |
  const C = kit.COLORS, MS = kit.SKETCH_MS;
  const eng = engines.space;
  const all = eng.all();
  const F = { x0: 60, y0: 80, x1: 940, y1: 700 };
  const CX = (F.x0 + F.x1) / 2, CY = (F.y0 + F.y1) / 2;   // 500, 390
  const R_MAX = 290;                                        // the outermost orbit in the top views
  const SUN_CAP = Math.floor((F.y1 - F.y0) / 6);            // 103: the Sun never takes more than a sixth of the frame
  const LABEL_PX = 19, NOTE_PX = 18;

  const view = params.view === "row" || params.view === "tilted" ? params.view : "top";
  const mode = params.scale === "sizes" || params.scale === "distances" || params.scale === "log" ? params.scale : "schematic";
  const names = params.names === "nb" || params.names === "none" ? params.names : "en";
  const L = names === "nb" ? "nb" : "en";
  const daysIn = typeof params.days === "number" && Number.isFinite(params.days) ? params.days : 0;
  const date = eng.resolveDate(params.date, daysIn);
  const missing = [];

  // Which bodies. Group words expand in place; unknown names go to the note;
  // a moon named here is known but invisible at any honest scale — it belongs to focus.
  const picked = eng.bodies(Array.isArray(params.bodies) && params.bodies.length > 0 ? params.bodies : ["planets"]);
  missing.push(...picked.missing);
  for (const b of picked.bodies) if (b.parent !== "sun") missing.push(b.id + " (a moon: use focus)");
  let focusId = null;
  if (typeof params.focus === "string" && params.focus.trim() !== "") {
    const f = eng.bodies([params.focus]);
    if (f.bodies[0]) focusId = f.bodies[0].id; else missing.push(params.focus.trim());
  }
  const highlightIds = new Set();
  for (const hn of Array.isArray(params.highlight) ? params.highlight : []) {
    const hb = eng.bodies([hn]);
    if (hb.bodies[0]) highlightIds.add(hb.bodies[0].id); else missing.push(String(hn));
  }
  const orbitsOn = params.orbits !== false && view !== "row";

  // The centre and what orbits it: the Sun and the picked planets, or the
  // focus body and its moons — innermost first.
  let centre, sats;
  if (focusId) {
    centre = all[focusId];
    const s = eng.satellites(focusId, Array.isArray(params.moons) ? params.moons : undefined);
    sats = s.bodies; missing.push(...s.missing);
  } else {
    centre = all.sun;
    sats = picked.bodies.filter((b) => b.parent === "sun");
  }
  sats = sats.slice().sort((a, b) => a.a_km - b.a_km);
  const n = sats.length;

  // Where each body is on its orbit: the true angle for the date. Eccentricity
  // and inclination are not drawn this round — every body sits ON its circle.
  const angles = {};
  const pos = focusId ? eng.moonPositions(focusId, sats.map((b) => b.id), date) : eng.positions(sats.map((b) => b.id), date);
  for (const b of sats) { const p = pos[b.id]; angles[b.id] = p ? Math.atan2(p.y, p.x) : 0; }

  const drawables = [], labels = [], anchors = {}, order = [];
  const push = (d) => { drawables.push(d); order.push(d.id); };
  const nameOf = (b) => b.name[L] || b.name.en;
  const lit = (id) => highlightIds.has(id);
  const extent = (b, r) => r * (b.ring ? b.ring.outer : 1);   // how far a body reaches, ring included
  const ball = (id, c, r, b) => kit.ball(id, c, r, { fill: b.color, color: lit(id) ? C.accent : undefined, strokeWidth: lit(id) ? 3 : Math.min(2, Math.max(1, r / 6)) });

  // Saturn's ring: seen from straight above (top view) an annulus behind the
  // disc; otherwise an ellipse whose far half lies behind the disc and near
  // half in front. The pieces are sub-drawables of the body's own element.
  const ellipseArc = (c, rx, ry, t0, t1, m) => { const pts = []; for (let i = 0; i <= m; i++) { const t = t0 + ((t1 - t0) * i) / m; pts.push([c[0] + rx * Math.cos(t), c[1] + ry * Math.sin(t)]); } return pts; };
  const ringPieces = (b, id, c, r, flat) => {
    if (!b.ring) return null;
    const col = b.ring.color, ro = r * b.ring.outer, ri = r * b.ring.inner;
    if (flat) {
      return { back: [
        kit.area(id + "__ringb", kit.ellipse(c, ro, ro, 64), col, { opacity: 0.55, holes: [kit.ellipse(c, ri, ri, 48)], ms: MS.region }),
        kit.stroke(id + "__ringb_o", kit.ellipse(c, ro, ro, 64), { closed: true, color: col, strokeWidth: 1.5, ms: MS.stroke }),
      ], front: [] };
    }
    const q = 0.38;   // the ring plane seen at Saturn's tilt
    const band = (t0, t1) => [...ellipseArc(c, ro, ro * q, t0, t1, 24), ...ellipseArc(c, ri, ri * q, t1, t0, 24)];
    return {
      back: [kit.area(id + "__ringb", band(0, Math.PI), col, { opacity: 0.55, ms: MS.region }), kit.stroke(id + "__ringb_o", ellipseArc(c, ro, ro * q, 0, Math.PI, 24), { color: col, strokeWidth: 1.5, ms: MS.stroke })],
      front: [kit.area(id + "__ringf", band(Math.PI, 2 * Math.PI), col, { opacity: 0.55, ms: MS.region }), kit.stroke(id + "__ringf_o", ellipseArc(c, ro, ro * q, Math.PI, 2 * Math.PI, 24), { color: col, strokeWidth: 1.5, ms: MS.stroke })],
    };
  };
  // One body as an element: its shaded disc, wrapped with the ring when it has one.
  const bodyElement = (b, id, c, r, flat) => {
    const disc = ball(id, c, r, b);
    const rg = ringPieces(b, id, c, r, flat);
    return rg ? kit.group(id, [...rg.back, { ...disc, id: id + "__disc" }, ...rg.front]) : disc;
  };

  if (typeof params.title === "string" && params.title.trim() !== "") {
    push(kit.text("title", [500, 726], params.title, { fontSize: 30 }));
    anchors.title = [500, 726];
  }

  const orbitIds = sats.map((b) => "orbit_" + b.id);
  let pxPerKm = null;      // for the scale bar: px per km of DISTANCE (distances) or of RADIUS (sizes)
  let sunReduced = false;
  const labelReq = [];     // solver requests, placed at the end

  if (view === "row" && !focusId) {
    // ---- the line-up ------------------------------------------------------
    const y = CY, gap = 24;
    // The Sun's share of the width: a full disc (schematic, log), a segment of
    // fixed visible width (sizes), a dot (distances).
    const sunW = mode === "sizes" ? 110 : mode === "distances" ? 16 : 2 * Math.min(SUN_CAP, 97);
    const xs0 = F.x0 + sunW + gap, W = F.x1 - gap - xs0;
    let xs = [], rs = [], sunR, sunC;
    if (mode === "distances") {
      pxPerKm = n > 0 ? W / Math.max(...sats.map((b) => b.a_km)) : null;
      const sunX = F.x0 + sunW / 2;
      xs = sats.map((b) => sunX + b.a_km * pxPerKm);
      const rad = eng.drawnRadii(centre, sats, mode, 5);
      rs = rad.bodies; sunR = rad.centre; sunC = [sunX, y];
    } else {
      // Variable slots: each body takes its own reach (ring included) plus a
      // gap, so the giants get room and the small ones stay visible.
      const f = mode === "sizes" ? (v) => v : Math.sqrt;
      const reach = (b) => f(b.r_km) * (b.ring ? b.ring.outer : 1);
      const sum = sats.reduce((s, b) => s + reach(b), 0) || 1;
      const k = Math.max(0, W - (n + 1) * gap) / (2 * sum);
      const rad = eng.drawnRadii(centre, sats, mode, n > 0 ? k * Math.max(...sats.map((b) => f(b.r_km))) : 60);
      rs = rad.bodies;
      let x = xs0 + gap;
      xs = sats.map((b, i) => { const e = extent(b, rs[i]); const cx = x + e; x += 2 * e + gap; return cx; });
      if (mode === "sizes") {
        pxPerKm = k;
        sunR = rad.centre;                      // true: ~900 px — only its edge fits
        sunC = [F.x0 + sunW - sunR, y];
      } else {
        sunR = Math.min(rad.centre, sunW / 2);
        sunC = [F.x0 + sunW / 2, y];
      }
    }
    // The Sun: whole when it fits, else the circular segment inside the frame —
    // a stroke past the canvas edge is a lint ERROR, so the clip is not optional.
    const seg = eng.sunSegment(sunC, sunR, F);
    if (seg.clipped) {
      push(kit.group("sun", [
        kit.area("sun__fill", seg.fill, centre.color, { opacity: 0.9, precise: true, ms: MS.region }),
        kit.stroke("sun__arc", seg.arc, { color: lit("sun") ? C.accent : "#c98f00", strokeWidth: 3, ms: MS.stroke }),
      ]));
      anchors.sun = [F.x0 + Math.min(40, sunW / 2), y];
    } else {
      push(bodyElement(centre, "sun", sunC, sunR, true));
      anchors.sun = sunC;
    }
    sats.forEach((b, i) => { push(bodyElement(b, b.id, [xs[i], y], rs[i], false)); anchors[b.id] = [xs[i], y]; });
    // Names under the bodies, in tiers when neighbours are closer than a name is wide.
    if (names !== "none") {
      const texts = sats.map(nameOf);
      const widths = texts.map((t) => kit.textWidth(t, LABEL_PX));
      const tiers = eng.labelTiers(xs, widths, 6);
      sats.forEach((b, i) => {
        const w = widths[i];
        const tx = Math.min(1000 - w / 2 - 4, Math.max(w / 2 + 4, xs[i]));
        const ty = y - rs[i] - 16 - tiers[i] * 26;
        push(kit.text("label_" + b.id, [tx, ty], texts[i], { fontSize: LABEL_PX, color: lit(b.id) ? C.accent : C.ink }));
        anchors["label_" + b.id] = [tx, ty];
      });
      const sunAt = seg.clipped ? [F.x0 + 12, y] : [sunC[0], y - sunR - 16];
      push(kit.text("label_sun", sunAt, nameOf(centre), { fontSize: LABEL_PX, color: C.ink, anchor: seg.clipped ? "start" : "middle" }));
      anchors.label_sun = sunAt;
    }
  } else {
    // ---- from above: orbits around the centre ------------------------------
    // The tilted view is the same picture through an orbit camera 30° up —
    // kit.project3d's projection with azimuth 0, written out (x1 = x,
    // z1 = -y, y2 = -z1·sin el, depth = D - z1·cos el, s = D / depth) because
    // project3d has no polyline primitive and an orbit would cost 48 segments.
    // The far side (y > 0) lands at the top of the screen, smaller.
    const EL = Math.PI / 6, D = 1100;
    const P = (x, y) => {
      if (view !== "tilted") return { x: CX + x, y: CY + y, s: 1 };
      const s = D / (D + y * Math.cos(EL));
      return { x: CX + x * s, y: CY + y * Math.sin(EL) * s, s };
    };
    const rMin = focusId ? 130 : 60;
    const orbitR = eng.orbitRadii(sats, mode, rMin, R_MAX);
    const gaps = orbitR.map((r, i) => (i === 0 ? r : r - orbitR[i - 1]));
    const gapMin = gaps.length > 0 ? Math.min(...gaps) : R_MAX;
    const largestPx = n === 0 ? 120 : Math.max(3, 0.42 * gapMin);
    if (mode === "distances" && n > 0) pxPerKm = R_MAX / Math.max(...sats.map((b) => b.a_km));
    const rad = eng.drawnRadii(centre, sats, mode, largestPx, mode === "distances" && pxPerKm ? pxPerKm : undefined);
    if (mode === "sizes" && n > 0) pxPerKm = largestPx / Math.max(...sats.map((b) => b.r_km));
    const centreCap = n === 0 ? 120 : Math.max(3, Math.min(SUN_CAP, orbitR[0] - 12));
    sunReduced = mode === "sizes" && rad.centre > centreCap;
    const centreR = Math.min(rad.centre, centreCap);
    const flat = view === "top";

    if (focusId) {
      push(kit.stroke("frame", [[F.x0, F.y0], [F.x1, F.y0], [F.x1, F.y1], [F.x0, F.y1]], { closed: true, color: C.guide, strokeWidth: 1.5, dash: true, ms: MS.guides }));
    }
    // Orbits first (guides behind everything), then the centre and its axis,
    // then the bodies far-to-near so a near one covers a far one when tilted.
    if (orbitsOn) sats.forEach((b, i) => {
      const pts = [];
      for (let k = 0; k < 72; k++) { const t = (2 * Math.PI * k) / 72; const q = P(orbitR[i] * Math.cos(t), orbitR[i] * Math.sin(t)); pts.push([q.x, q.y]); }
      push(kit.stroke("orbit_" + b.id, pts, { closed: true, color: C.guide, strokeWidth: 1.2, dash: true, ms: MS.guides }));
      anchors["orbit_" + b.id] = pts[0];
    });
    const c0 = P(0, 0);
    push(bodyElement(centre, centre.id, [c0.x, c0.y], centreR * c0.s, flat));
    anchors[centre.id] = [c0.x, c0.y];
    if (focusId && typeof centre.tilt_deg === "number") {
      // The spin axis, leaning by the axial tilt, long enough to read past the disc (and the ring).
      const t = (centre.tilt_deg * Math.PI) / 180, len = extent(centre, centreR * c0.s) * 1.35;
      push(kit.stroke("axis", [[c0.x - len * Math.sin(t), c0.y - len * Math.cos(t)], [c0.x + len * Math.sin(t), c0.y + len * Math.cos(t)]], { color: C.guide, strokeWidth: 1.5, dash: true, ms: MS.guides }));
      anchors.axis = [c0.x, c0.y];
    }
    const placed = sats.map((b, i) => {
      const a = angles[b.id], ex = orbitR[i] * Math.cos(a), ey = orbitR[i] * Math.sin(a);
      const q = P(ex, ey);
      return { b, q, r: rad.bodies[i] * q.s, ey, ux: Math.cos(a), uy: Math.sin(a) };
    });
    placed.sort((u, v) => v.ey - u.ey);   // far first
    for (const p of placed) { push(bodyElement(p.b, p.b.id, [p.q.x, p.q.y], p.r, flat)); anchors[p.b.id] = [p.q.x, p.q.y]; }

    // Names beside the bodies, placed by the solver: each hangs off its body's
    // outward edge on the side away from the centre, may lie across the orbit
    // guides (dashed, faint — not ink), and must miss every other body and name.
    if (names !== "none") {
      for (const p of placed) {
        const side = p.ux >= 0 ? (p.uy >= 0 ? "above-right" : "below-right") : (p.uy >= 0 ? "above-left" : "below-left");
        const e = extent(p.b, p.r);
        labelReq.push({ id: "label_" + p.b.id, at: [p.q.x + p.ux * e, p.q.y + p.uy * e], side, text: nameOf(p.b), color: lit(p.b.id) ? C.accent : C.ink, ignore: [p.b.id, ...orbitIds] });
      }
      labelReq.push({ id: "label_" + centre.id, at: [c0.x, c0.y - extent(centre, centreR * c0.s)], side: "below", text: nameOf(centre), color: C.ink, ignore: [centre.id, "axis", ...orbitIds] });
    }

    // Log distances have no linear bar: a decade ruler from r(d) to r(10d)
    // straight down from the centre, when a decade pair fits the drawn range.
    if (mode === "log" && n > 1) {
      const as = sats.map((b) => b.a_km), aMin = Math.min(...as), aMax = Math.max(...as);
      const units = focusId ? [1e4, 1e5, 1e6, 1e7] : [0.1, 1, 10, 100].map((au) => eng.km(au));
      let pair = null;
      for (const d of units) if (d >= aMin * 0.999 && 10 * d <= aMax * 1.001) pair = d;
      if (pair !== null) {
        const r1 = eng.logRadius(pair, aMin, aMax, rMin, R_MAX), r2 = eng.logRadius(10 * pair, aMin, aMax, rMin, R_MAX);
        const a = P(0, -r1), z = P(0, -r2);
        const fmt = (d) => focusId ? String(Math.round(d)).replace(/\B(?=(\d{3})+(?!\d))/g, "\u202f") : String(Math.round(eng.au(d) * 10) / 10).replace(".", L === "nb" ? "," : ".");
        const text = fmt(pair) + " → " + fmt(10 * pair) + (focusId ? " km" : " AU");
        push(kit.group("scale_bar", [
          kit.stroke("scale_bar__line", [[a.x, a.y], [z.x, z.y]], { color: C.guide, strokeWidth: 2, ms: MS.guides }),
          kit.stroke("scale_bar__t0", [[a.x - 6, a.y], [a.x + 6, a.y]], { color: C.guide, strokeWidth: 2, ms: MS.guides }),
          kit.stroke("scale_bar__t1", [[z.x - 6, z.y], [z.x + 6, z.y]], { color: C.guide, strokeWidth: 2, ms: MS.guides }),
          kit.text("scale_bar__label", [(a.x + z.x) / 2 + 10, (a.y + z.y) / 2], text, { fontSize: 16, color: C.guide, anchor: "start" }),
        ]));
        anchors.scale_bar = [(a.x + z.x) / 2, (a.y + z.y) / 2];
      }
    }
  }

  for (const q of labelReq) {
    labels.push({ ...kit.label(q.id, q.at, q.side, q.text, { color: q.color, fontSize: LABEL_PX }), ignore: q.ignore });
    order.push(q.id);
  }

  // Every figure says which truth it keeps; sizes and distances add a bar at the bottom right.
  push(kit.text("scale_note", [F.x0, 36], eng.scaleNote(mode, L, sunReduced), { fontSize: NOTE_PX, color: C.guide, anchor: "start" }));
  anchors.scale_note = [F.x0, 36];
  const bar = pxPerKm && (mode === "sizes" || mode === "distances") ? eng.scaleBar(mode, pxPerKm, L) : null;
  if (bar) {
    const bx1 = F.x1, bx0 = F.x1 - bar.lengthPx, by = 40;
    push(kit.group("scale_bar", [
      kit.stroke("scale_bar__line", [[bx0, by], [bx1, by]], { color: C.guide, strokeWidth: 2, ms: MS.guides }),
      kit.stroke("scale_bar__t0", [[bx0, by - 6], [bx0, by + 6]], { color: C.guide, strokeWidth: 2, ms: MS.guides }),
      kit.stroke("scale_bar__t1", [[bx1, by - 6], [bx1, by + 6]], { color: C.guide, strokeWidth: 2, ms: MS.guides }),
      kit.text("scale_bar__label", [(bx0 + bx1) / 2, by - 18], bar.label, { fontSize: 16, color: C.guide }),
    ]));
    anchors.scale_bar = [(bx0 + bx1) / 2, by];
  }
  if (missing.length > 0) {
    push(kit.text("missing_note", [500, 36], (L === "nb" ? "Ukjent: " : "Unknown: ") + missing.join(", "), { fontSize: NOTE_PX, color: C.guide }));
    anchors.missing_note = [500, 36];
  }

  return { drawables, labels, anchors, order };
```

The log ruler's `fmt` writes the thousands separator as the escape `\u202f`, exactly as `rules.ts` does.

- [ ] **Step 4: Register the pack and enable it by default**

`src/scenes/packs.ts`, after the `data` entry (line 114):

```ts
  space: {
    id: "space",
    title: "Space",
    description: "The solar system: the Sun, planets, dwarf planets and moons drawn for a date at a chosen scale, every body clickable by name.",
    load: async () => (await import("./packs/space.yaml?raw")).default,
  },
```

`src/store.ts:191`: append `"space"` to `enabledPacks` (after `"data"`). `DEFAULT_OFF_PACKS` is untouched — the pack is part of the academic default.

- [ ] **Step 5: The first bundled example**

Append to `src/examples.json`, after the last entry (the piano drag example ends `}` before the final `]`; add a comma after it):

```json
  {
    "request": "Which one is Mars?",
    "packs": ["space"],
    "spec": {
      "title": "Find Mars",
      "template": "solar_system",
      "params": { "view": "top", "scale": "schematic", "date": "2026-09-06", "names": "none" },
      "commands": [
        { "draw": ["sun", "orbit_mercury", "orbit_venus", "orbit_earth", "orbit_mars", "orbit_jupiter", "orbit_saturn", "orbit_uranus", "orbit_neptune", "scale_note"], "speak": "The Sun, and eight orbits around it, seen from above. Not to scale — no drawing on one page can be." },
        { "draw": ["mercury", "venus", "earth", "mars"], "speak": "Four small rocky planets keep close to the Sun." },
        { "draw": ["jupiter", "saturn", "uranus", "neptune"], "speak": "Four giants keep their distance. Every planet sits where it really was on the day this was drawn." },
        { "ask": { "question": "Which one is Mars?", "widget": "click", "answer": "mars", "right": "Mars — the fourth planet out, on the orbit just outside Earth's.", "wrong": "Count outward from the Sun: Mercury, Venus, Earth — and the next orbit is Mars." } }
      ]
    }
  }
```

- [ ] **Step 6: Run the template tests, the guards, the whole suite**

Run: `npx vitest run tests/space-template.test.ts`
Expected: PASS. Two places to look if not:
- "every view × scale × selection lays out without a lint error" failing on `out-of-canvas` for `row/sizes`: the Sun segment or a label under Neptune left the page — check `sunC` (`F.x0 + sunW − sunR`) and the label clamp `tx`.
- "tilted compresses the vertical spread": the projection's `sin(EL)` factor — 0.5 — must be applied to `y`, not `x`.

Run: `npx vitest run tests/examples.test.ts tests/pack-defaults.test.ts tests/molecule3d.test.ts tests/spec-i18n.test.ts tests/packs.test.ts`
Expected: PASS. If `examples.test.ts` reports a `[warn] overlap-label-label` for "Find Mars": the example has `names: none`, so this cannot be a name — it would be `scale_note` against `missing_note` (there is no missing note here) — re-read the example's params.

Run: `npx vitest run && npx tsc --noEmit`
Expected: green.

- [ ] **Step 7: Commit**

```bash
git add src/scenes/packs/space.yaml src/scenes/packs.ts src/store.ts src/examples.json tests/space-template.test.ts
git commit -m "solar_system: the space pack's template — top, row and tilted views at four scales, focus with moons, and its first example"
```

---

## Task 6: `explore: { space: true }` — schema, plan step, tray plan

**Files:**
- Modify: `src/spec/schema.ts:365-370` (explore properties) and `:897-899` (validation), `src/spec/types.ts:302`, `src/render/plan.ts:24, 257`, `src/ui/tray-model.ts:86-135`
- Test: `tests/explore-command.test.ts` (append inside `describe("explore validation and planning")`), `tests/tray-model.test.ts` (append)

**Interfaces:**
- Produces: `explore.space?: boolean` in the spec; `{ kind: "explore"; …; space?: boolean }` in the plan; `trayPlan({ …, spaceTemplate?: boolean, space?: boolean }) → { …, space: boolean }`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/explore-command.test.ts` inside `describe("explore validation and planning", …)`, after the `explore.anatomy` test:

```ts
  test("explore.space is a boolean invitation to the Space section", () => {
    expect(validateSpec(spec([{ draw: ["a"] }, { explore: { space: true } }])).ok).toBe(true);
    expect(validateSpec(spec([{ explore: { space: "yes" } }])).ok).toBe(false);
    const plan = planCommands([{ explore: { space: true }, speak: "Look around." }], []);
    const s = plan.steps[0];
    expect(s.kind).toBe("explore");
    if (s.kind !== "explore") return;
    expect(s.space).toBe(true);
  });
```

Append to `tests/tray-model.test.ts`:

```ts
describe("trayPlan — the space section", () => {
  test("a solar-system figure shows the space section whenever the viewer opens the tray", () => {
    expect(trayPlan({ sliderPaths: ["days"], codeIds: [], spaceTemplate: true }).space).toBe(true);
    expect(trayPlan({ sliderPaths: ["days"], codeIds: [] }).space).toBe(false);
    expect(trayPlan({ sliderPaths: ["detail"], codeIds: [], bodyTemplate: true }).space).toBe(false);
  });
  test("a gated beat shows the space section when it asks for it, or when it names nothing else", () => {
    expect(trayPlan({ sliderPaths: ["days"], codeIds: [], spaceTemplate: true, gated: true, space: true }).space).toBe(true);
    expect(trayPlan({ sliderPaths: ["days"], codeIds: [], spaceTemplate: true, gated: true }).space).toBe(true);
    expect(trayPlan({ sliderPaths: ["days"], codeIds: [], spaceTemplate: true, gated: true, params: ["days"] }).space).toBe(false);
    expect(trayPlan({ sliderPaths: ["days"], codeIds: [], spaceTemplate: false, gated: true, space: true }).space).toBe(false);
  });
  test("a space gate keeps the days slider beside the section, and no activity pills", () => {
    const p = trayPlan({ sliderPaths: ["days"], codeIds: [], spaceTemplate: true, gated: true, space: true });
    expect(p.sliders).toEqual(["days"]);
    expect(p.activities).toBe(false);
    expect(p.body).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/explore-command.test.ts tests/tray-model.test.ts`
Expected: FAIL — `space: true` rejected (`additionalProperties: false`), `s.space` undefined, `.space` undefined.

- [ ] **Step 3: Implement**

`src/spec/schema.ts`, inside `explore.properties` after `anatomy` (line ~370):

```ts
        space: {
          type: "boolean",
          description:
            "On a solar_system figure: open the Space section of the explore tray — click a planet or moon to look closer, breadcrumbs back out, pills for scale, names and date, a fact card with the Wikipedia summary — and wait for Continue. The authored 'look around the solar system yourself' moment. App only; movies skip the beat.",
        },
```

`src/spec/schema.ts` after line 899 (the `explore.anatomy` check):

```ts
      if (cmd.explore.space !== undefined && typeof cmd.explore.space !== "boolean") {
        errors.push(`commands[${i}]: explore.space must be true or false`);
      }
```

`src/spec/types.ts:302`: `explore?: { params?: string[]; code?: string; game?: string; anatomy?: boolean; space?: boolean };`

`src/render/plan.ts:24`: `| { kind: "explore"; params?: string[]; code?: string; game?: string; anatomy?: boolean; space?: boolean }`; after line 257: `...(cmd.explore.space !== undefined ? { space: cmd.explore.space } : {}),`.

`src/ui/tray-model.ts`:

- `TrayPlan` gains, after `body`:
  ```ts
  /** The solar-system Space section: click a body to focus on it, breadcrumbs, scale/names/date pills, the fact card. */
  space: boolean;
  ```
- `trayPlan`'s input gains, after `anatomy?: boolean;`:
  ```ts
  /** The figure is a solar_system template: it has a sky to explore. */
  spaceTemplate?: boolean;
  /** The beat's `space` flag. */
  space?: boolean;
  ```
- The destructuring: `const { sliderPaths, codeIds, gated = false, params, code, open, bodyTemplate = false, anatomy, spaceTemplate = false, space: spaceBeat } = input;`
- The gated branch:
  ```ts
    const body = bodyTemplate && (anatomy === true || (params === undefined && code === undefined));
    // The same rule for a solar-system figure: asked for by name, or an unnamed gate.
    const space = spaceTemplate && (spaceBeat === true || (params === undefined && code === undefined));
    const wantsSliders = params !== undefined || scripts.length === 0 || body || space;
    const sliders = !wantsSliders ? [] : params ? sliderPaths.filter((p) => params.includes(p)) : sliderPaths;
    return { activities: false, sliders, scripts, body, space };
  ```
- The ungated return: `body: bodyTemplate, space: spaceTemplate,`.

- [ ] **Step 4: Run, typecheck, commit**

Run: `npx vitest run tests/explore-command.test.ts tests/tray-model.test.ts && npx tsc --noEmit`
Expected: PASS. `tsc` reports nothing in `tray.ts` — it reads `plan.body`, never destructures exhaustively.

```bash
git add src/spec/schema.ts src/spec/types.ts src/render/plan.ts src/ui/tray-model.ts tests/explore-command.test.ts tests/tray-model.test.ts
git commit -m "explore.space: the authored invitation to the Space section, through schema, plan and tray plan"
```

---

## Task 7: The other four bundled examples

**Files:**
- Modify: `src/examples.json` (append four entries after "Which one is Mars?"), `tests/space-template.test.ts` (the count → five)

**Interfaces:**
- Consumes: `solar_system` (Task 5), `explore.space` (Task 6), the drag widget (`ask.widget: "drag"`, `items` 1–8, `right` required, no `answer`).

- [ ] **Step 1: The count test → five**

In `tests/space-template.test.ts`: `"drawcast ships five space examples"` / `toHaveLength(5)`.

Run: `npx vitest run tests/space-template.test.ts -t "five space examples"` — FAIL (1 ≠ 5).

- [ ] **Step 2: Append the examples**

After the "Which one is Mars?" entry in `src/examples.json` (comma-separated, before the closing `]`):

```json
  {
    "request": "How big is Jupiter?",
    "packs": ["space"],
    "spec": {
      "title": "How big is Jupiter?",
      "template": "solar_system",
      "params": { "view": "row", "scale": "sizes", "date": "2026-09-06" },
      "commands": [
        { "draw": ["sun", "label_sun", "scale_note", "scale_bar"], "speak": "Sizes to scale this time. The Sun is so large that only its edge fits on the page." },
        { "draw": ["mercury", "label_mercury", "venus", "label_venus", "earth", "label_earth", "mars", "label_mars"], "speak": "The four rocky planets are specks beside it — Earth is a dot a hundredth of the Sun's width." },
        { "draw": ["jupiter", "label_jupiter"], "speak": "Jupiter: eleven Earths across, and heavier than all the other planets put together." },
        { "draw": ["saturn", "label_saturn", "uranus", "label_uranus", "neptune", "label_neptune"], "speak": "Saturn with its rings, then the two ice giants, Uranus and Neptune — near twins." },
        { "quiz": { "question": "Which of the two ice giants is larger?", "choices": ["Uranus", "Neptune", "They are the same size"], "correct": 1, "right": "Uranus, by a whisker — 25 400 kilometres in radius to Neptune's 24 600. Neptune is the heavier one, though." } }
      ]
    }
  },
  {
    "request": "Put the planets in order.",
    "packs": ["space"],
    "spec": {
      "title": "The planets in order",
      "template": "solar_system",
      "params": { "view": "row", "scale": "schematic", "date": "2026-09-06", "names": "none" },
      "commands": [
        { "draw": ["sun", "mercury", "venus", "earth", "mars", "jupiter", "saturn", "uranus", "neptune", "scale_note"], "speak": "The Sun and its eight planets in a line, closest first. None of them is named." },
        { "ask": { "question": "Drag each name onto its planet.", "widget": "drag", "items": [{ "id": "mercury", "label": "Mercury" }, { "id": "venus", "label": "Venus" }, { "id": "earth", "label": "Earth" }, { "id": "mars", "label": "Mars" }, { "id": "jupiter", "label": "Jupiter" }, { "id": "saturn", "label": "Saturn" }, { "id": "uranus", "label": "Uranus" }, { "id": "neptune", "label": "Neptune" }], "tolerance": 1, "right": "Mercury, Venus, Earth, Mars, then Jupiter, Saturn, Uranus and Neptune — the small rocky four, then the giants.", "wrong": "The rocky planets come first, small and close to the Sun; the giants follow, and Saturn is the one with the ring." } }
      ]
    }
  },
  {
    "request": "Where are the planets today?",
    "packs": ["space"],
    "spec": {
      "title": "The inner planets, moving",
      "template": "solar_system",
      "params": { "view": "top", "scale": "distances", "bodies": ["inner"], "date": "2026-09-06", "days": 0 },
      "commands": [
        { "draw": ["sun", "label_sun", "orbit_mercury", "orbit_venus", "orbit_earth", "orbit_mars", "scale_note", "scale_bar"], "speak": "The four inner orbits with the distances to scale: Mars is half again as far from the Sun as Earth." },
        { "draw": ["mercury", "label_mercury", "venus", "label_venus", "earth", "label_earth", "mars", "label_mars"], "speak": "And the planets where they stood on the sixth of September 2026." },
        { "animate": { "days": 687 }, "duration": 8, "easing": "linear", "speak": "Now let time run: 687 days, one Martian year. Mars goes round once — and Earth, on the inside track, goes round almost twice and laps it." }
      ]
    }
  },
  {
    "request": "Show me Jupiter and its moons.",
    "packs": ["space"],
    "spec": {
      "title": "Jupiter and its moons",
      "template": "solar_system",
      "params": { "focus": "jupiter", "moons": ["jupiter"], "date": "2026-09-06" },
      "commands": [
        { "draw": ["frame", "jupiter", "label_jupiter", "axis", "scale_note"], "speak": "Jupiter, close up, with its spin axis leaning a mere three degrees." },
        { "draw": ["orbit_io", "io", "label_io", "orbit_europa", "europa", "label_europa"], "speak": "Io and Europa, the two inner Galilean moons — volcanic Io, and Europa with an ocean under its ice." },
        { "draw": ["orbit_ganymede", "ganymede", "label_ganymede", "orbit_callisto", "callisto", "label_callisto"], "speak": "Ganymede, the largest moon in the solar system, and Callisto, cratered and quiet." },
        { "explore": { "space": true }, "speak": "Click any moon to look closer, use the crumbs to come back out, and try the scale and date buttons. Press Continue when you are done." },
        { "quiz": { "question": "Which of the four is the largest?", "choices": ["Io", "Europa", "Ganymede", "Callisto"], "correct": 3, "right": "Ganymede — larger than the planet Mercury." } }
      ]
    }
  }
```

- [ ] **Step 3: Run the guards**

Run: `npx vitest run tests/examples.test.ts tests/spec-i18n.test.ts tests/space-template.test.ts tests/molecule3d.test.ts`
Expected: PASS. The one failure this plan cannot rule out in advance is a `[warn] overlap-label-label` in "Where are the planets today?" (four solver-placed names in `top` view: two inner planets at nearly the same heliocentric longitude on the pinned date could crowd). If it appears, move the example's `date` by a week or two (`2026-09-13`, `2026-09-20`, …), re-run, and change the spoken date in the second beat to match. Do NOT switch the example to `names: none` — naming the planets is its point.

Run: `npx vitest run && npx tsc --noEmit` — green.

- [ ] **Step 4: Commit**

```bash
git add src/examples.json tests/space-template.test.ts
git commit -m "Space examples: Jupiter's size, the planets in order, the inner planets moving, Jupiter and its moons"
```

---

## Task 8: The space model — what a click means, the way back, the card's lines

**Files:**
- Create: `src/ui/space-model.ts`
- Test: `tests/space-model.test.ts`

**Interfaces:**
- Consumes: `Body`, `MoonPhaseInfo`, `ScaleMode` from `src/scenes/space/types.ts`; `AU_KM`, `THIN`, `fmtInt`, `indexBodies` from `src/scenes/space/rules.ts`. NEVER `ephemeris.ts`.
- Produces (used by Task 9):
  - `type SpaceLang = "en" | "nb"`; `ROOT_LABEL: Record<SpaceLang, string>`
  - `Choice<T> = { value: T; label: Record<SpaceLang, string> }`; `SCALE_CHOICES: Choice<ScaleMode>[]`; `NAME_CHOICES: Choice<"en" | "nb" | "none">[]`; `DATE_CHOICES: Choice<number>[]` (day offsets 0, −365, +365)
  - `bodyOfElement(bodies, elementId): string | null`
  - `focusTargetFor(bodies, clicked: string, currentFocus: string | null): string | null` — the NEW focus (null = the whole system)
  - `breadcrumbFor(bodies, focus: string | null): string[]` — ids root-first, the Sun omitted unless it is the focus
  - `bodyLabel(bodies, id, lang): string`
  - `cardFacts(body, bodies, lang): { label: string; value: string }[]`
  - `positionNote(schematic: boolean, lang): string | null`; `phaseLine(p: MoonPhaseInfo, lang): string`
  - `wikiSummaryUrl(lang, title): string`; `readWikiSummary(json: unknown): WikiSummary | null` with `WikiSummary = { title; extract; thumb: string | null; page: string | null }`
  - `isoDate(d: Date): string`

- [ ] **Step 1: Write the failing test**

Create `tests/space-model.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import bodiesJson from "../src/scenes/space/bodies.json";
import type { BodiesTable } from "../src/scenes/space/types";
import { indexBodies } from "../src/scenes/space/rules";
import {
  DATE_CHOICES, NAME_CHOICES, ROOT_LABEL, SCALE_CHOICES, bodyLabel, bodyOfElement, breadcrumbFor, cardFacts, focusTargetFor, isoDate, phaseLine,
  positionNote, readWikiSummary, wikiSummaryUrl,
} from "../src/ui/space-model";

const bodies = indexBodies(bodiesJson as unknown as BodiesTable);
/** The pack writes U+202F between thousands; compare with plain spaces. */
const plain = (s: string): string => s.replace(/\u202f/g, " ");
const fact = (id: string, lang: "en" | "nb", label: string): string => plain(cardFacts(bodies[id], bodies, lang).find((f) => plain(f.label) === label)!.value);

describe("focusTargetFor", () => {
  test("a body, its orbit or its name focuses that body", () => {
    expect(focusTargetFor(bodies, "mars", null)).toBe("mars");
    expect(focusTargetFor(bodies, "orbit_mars", null)).toBe("mars");
    expect(focusTargetFor(bodies, "label_io", "jupiter")).toBe("io");
    expect(bodyOfElement(bodies, "label_ganymede")).toBe("ganymede");
  });
  test("the Sun is the way out; the current focus, the notes and unknown ids change nothing", () => {
    expect(focusTargetFor(bodies, "sun", null)).toBeNull();
    expect(focusTargetFor(bodies, "sun", "jupiter")).toBeNull();
    expect(focusTargetFor(bodies, "label_sun", "io")).toBeNull();
    expect(focusTargetFor(bodies, "jupiter", "jupiter")).toBe("jupiter");
    expect(focusTargetFor(bodies, "scale_note", "jupiter")).toBe("jupiter");
    expect(focusTargetFor(bodies, "frame", "jupiter")).toBe("jupiter");
    expect(focusTargetFor(bodies, "axis", null)).toBeNull();
    expect(focusTargetFor(bodies, "nope", "mars")).toBe("mars");
    expect(bodyOfElement(bodies, "scale_bar")).toBeNull();
  });
});

describe("breadcrumbFor", () => {
  test("is the parent chain, root first, with the Sun left to the root crumb", () => {
    expect(breadcrumbFor(bodies, null)).toEqual([]);
    expect(breadcrumbFor(bodies, "jupiter")).toEqual(["jupiter"]);
    expect(breadcrumbFor(bodies, "io")).toEqual(["jupiter", "io"]);
    expect(breadcrumbFor(bodies, "moon")).toEqual(["earth", "moon"]);
    expect(breadcrumbFor(bodies, "charon")).toEqual(["pluto", "charon"]);
    expect(breadcrumbFor(bodies, "sun")).toEqual(["sun"]);
    expect(breadcrumbFor(bodies, "nope")).toEqual([]);
    expect(ROOT_LABEL.nb).toBe("Solsystemet");
  });
});

describe("labels and choices", () => {
  test("bodyLabel speaks the language and falls back to the id", () => {
    expect(bodyLabel(bodies, "earth", "nb")).toBe("Jorden");
    expect(bodyLabel(bodies, "earth", "en")).toBe("Earth");
    expect(bodyLabel(bodies, "nope", "nb")).toBe("nope");
  });
  test("the pills offer the four scales, three name settings and three dates", () => {
    expect(SCALE_CHOICES.map((c) => c.value)).toEqual(["schematic", "sizes", "distances", "log"]);
    expect(NAME_CHOICES.map((c) => c.value)).toEqual(["en", "nb", "none"]);
    expect(DATE_CHOICES.map((c) => c.value)).toEqual([0, -365, 365]);
    expect(DATE_CHOICES[0].label.nb).toBe("I dag");
  });
});

describe("cardFacts", () => {
  test("Earth, in English", () => {
    expect(fact("earth", "en", "Type")).toBe("Planet");
    expect(fact("earth", "en", "Radius")).toBe("6 371 km");
    expect(fact("earth", "en", "Distance from Sun")).toBe("1.00 AU (149.6 million km)");
    expect(fact("earth", "en", "Orbital period")).toBe("365 days");
    expect(fact("earth", "en", "Rotation")).toBe("23.9 h");
    expect(fact("earth", "en", "Axial tilt")).toBe("23.4°");
    expect(fact("earth", "en", "Mass")).toBe("5.97 × 10^24 kg");
  });
  test("years for long periods, days for rotations, retrograde flagged, unknown tilt a dash", () => {
    expect(fact("jupiter", "en", "Orbital period")).toBe("11.9 years");
    expect(fact("venus", "en", "Rotation")).toBe("243.0 days (retrograde)");
    expect(fact("triton", "en", "Orbital period")).toBe("5.88 days (retrograde)");
    expect(fact("haumea", "en", "Axial tilt")).toBe("—");
  });
  test("the Moon, in Norwegian: a moon of Earth, km not AU, decimal commas", () => {
    expect(fact("moon", "nb", "Type")).toBe("Måne rundt Jorden");
    expect(fact("moon", "nb", "Avstand fra Jorden")).toBe("384 400 km");
    expect(fact("moon", "nb", "Omløpstid")).toBe("27,3 dager");
    expect(fact("moon", "nb", "Rotasjon")).toBe("27,3 dager");
  });
  test("the Sun has no distance or period lines", () => {
    const labels = cardFacts(bodies.sun, bodies, "en").map((f) => f.label);
    expect(labels).toEqual(["Type", "Radius", "Rotation", "Axial tilt", "Mass"]);
    expect(fact("sun", "en", "Type")).toBe("Star");
  });
});

describe("notes, phase, Wikipedia", () => {
  test("a schematic position says so; an ephemeris does not", () => {
    expect(positionNote(true, "en")).toBe("Position schematic — a circular orbit, not an ephemeris.");
    expect(positionNote(true, "nb")).toBe("Posisjonen er skjematisk — en sirkelbane, ikke en efemeride.");
    expect(positionNote(false, "en")).toBeNull();
  });
  test("the phase line rounds the lit fraction", () => {
    const p = { fraction: 0.724, waxing: true, angle: 120, name: "waxing gibbous", name_nb: "voksende måne" };
    expect(phaseLine(p, "en")).toBe("Phase: waxing gibbous, 72 % lit");
    expect(phaseLine(p, "nb")).toBe("Fase: voksende måne, 72 % opplyst");
  });
  test("the summary URL goes to no. for Norwegian, en. otherwise, with the title URL-encoded", () => {
    expect(wikiSummaryUrl("nb", "Io (måne)")).toBe("https://no.wikipedia.org/api/rest_v1/page/summary/Io_(m%C3%A5ne)");
    expect(wikiSummaryUrl("en", "Mercury (planet)")).toBe("https://en.wikipedia.org/api/rest_v1/page/summary/Mercury_(planet)");
  });
  test("readWikiSummary keeps the extract, thumbnail and page link, and rejects a page without an extract", () => {
    const full = { title: "Io (moon)", extract: "Io is the innermost…", thumbnail: { source: "https://upload.wikimedia.org/x.jpg" }, content_urls: { desktop: { page: "https://en.wikipedia.org/wiki/Io_(moon)" } } };
    expect(readWikiSummary(full)).toEqual({ title: "Io (moon)", extract: "Io is the innermost…", thumb: "https://upload.wikimedia.org/x.jpg", page: "https://en.wikipedia.org/wiki/Io_(moon)" });
    expect(readWikiSummary({ title: "Io (moon)", extract: " Io. " })).toEqual({ title: "Io (moon)", extract: "Io.", thumb: null, page: null });
    expect(readWikiSummary({ title: "Nope", type: "https://mediawiki.org/wiki/HyperSwitch/errors/not_found" })).toBeNull();
    expect(readWikiSummary(null)).toBeNull();
  });
  test("isoDate is the UTC day", () => {
    expect(isoDate(new Date(Date.UTC(2026, 8, 6, 23, 59)))).toBe("2026-09-06");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/space-model.test.ts`
Expected: FAIL — cannot resolve `../src/ui/space-model`.

- [ ] **Step 3: Write the module**

Create `src/ui/space-model.ts`:

```ts
// The Space section's rules, DOM-free: which body a click on the figure
// means, the way back out, the pills' choices, and the fact card's lines.
// tray.ts and space-explore.ts render them; tests hold them against the real
// table. Imports only the light types and rules — never ephemeris.ts, so
// astronomy-engine stays in the engine's lazy chunk.

import { AU_KM, THIN, fmtInt } from "../scenes/space/rules";
import type { Body, MoonPhaseInfo, ScaleMode } from "../scenes/space/types";

export type SpaceLang = "en" | "nb";

export const ROOT_LABEL: Record<SpaceLang, string> = { en: "Solar system", nb: "Solsystemet" };

export interface Choice<T> {
  value: T;
  label: Record<SpaceLang, string>;
}

export const SCALE_CHOICES: Choice<ScaleMode>[] = [
  { value: "schematic", label: { en: "Schematic", nb: "Skjematisk" } },
  { value: "sizes", label: { en: "Sizes", nb: "Størrelser" } },
  { value: "distances", label: { en: "Distances", nb: "Avstander" } },
  { value: "log", label: { en: "Log", nb: "Log" } },
];
export const NAME_CHOICES: Choice<"en" | "nb" | "none">[] = [
  { value: "en", label: { en: "English", nb: "Engelsk" } },
  { value: "nb", label: { en: "Norwegian", nb: "Norsk" } },
  { value: "none", label: { en: "None", nb: "Ingen" } },
];
/** Day offsets from today. */
export const DATE_CHOICES: Choice<number>[] = [
  { value: 0, label: { en: "Today", nb: "I dag" } },
  { value: -365, label: { en: "−1 year", nb: "−1 år" } },
  { value: 365, label: { en: "+1 year", nb: "+1 år" } },
];

/** The body an element id stands for — itself, its orbit or its name; null for notes, frame, axis, unknown. */
export function bodyOfElement(bodies: Record<string, Body>, elementId: string): string | null {
  const id = elementId.replace(/^(orbit_|label_)/, "");
  return bodies[id] ? id : null;
}

/**
 * Where a click lands the viewer: on the clicked body. The Sun is the way
 * out (back to the whole system); anything that is not a body keeps the
 * current focus.
 */
export function focusTargetFor(bodies: Record<string, Body>, clicked: string, currentFocus: string | null): string | null {
  const id = bodyOfElement(bodies, clicked);
  if (id === null) return currentFocus;
  if (id === "sun") return null;
  return id;
}

/** The parent chain root-first, ending at the focus. The Sun belongs to the root crumb and is omitted unless it IS the focus. */
export function breadcrumbFor(bodies: Record<string, Body>, focus: string | null): string[] {
  const out: string[] = [];
  let cur: string | null = focus;
  while (cur && bodies[cur]) {
    out.unshift(cur);
    cur = bodies[cur].parent;
  }
  return out.length > 1 && out[0] === "sun" ? out.slice(1) : out;
}

export function bodyLabel(bodies: Record<string, Body>, id: string, lang: SpaceLang): string {
  const b = bodies[id];
  return b ? (b.name[lang] ?? b.name.en) : id;
}

const dec = (s: string, lang: SpaceLang): string => (lang === "nb" ? s.replace(".", ",") : s);

export function fmtKm(km: number, lang: SpaceLang): string {
  if (km >= 1e6) {
    const m = km / 1e6;
    return `${dec(m >= 1000 ? m.toFixed(0) : m.toFixed(1), lang)}${THIN}${lang === "nb" ? "mill. km" : "million km"}`;
  }
  return `${fmtInt(km)}${THIN}km`;
}

export function fmtPeriod(days: number, lang: SpaceLang): string {
  const d = Math.abs(days);
  if (d >= 800) return `${dec((d / 365.25).toFixed(1), lang)}${THIN}${lang === "nb" ? "år" : "years"}`;
  return `${dec(d < 10 ? d.toFixed(2) : d.toFixed(d < 100 ? 1 : 0), lang)}${THIN}${lang === "nb" ? "dager" : "days"}`;
}

export function fmtRotation(h: number, lang: SpaceLang): string {
  const a = Math.abs(h);
  const s = a < 48 ? `${dec(a.toFixed(1), lang)}${THIN}h` : `${dec((a / 24).toFixed(1), lang)}${THIN}${lang === "nb" ? "dager" : "days"}`;
  return h < 0 ? `${s} (${lang === "nb" ? "retrograd" : "retrograde"})` : s;
}

export function fmtMass(kg: number, lang: SpaceLang): string {
  const e = Math.floor(Math.log10(kg));
  return `${dec((kg / 10 ** e).toFixed(2), lang)} × 10^${e}${THIN}kg`;
}

const KIND: Record<Body["kind"], Record<SpaceLang, string>> = {
  star: { en: "Star", nb: "Stjerne" },
  planet: { en: "Planet", nb: "Planet" },
  dwarf: { en: "Dwarf planet", nb: "Dvergplanet" },
  moon: { en: "Moon of", nb: "Måne rundt" },
};

export interface Fact {
  label: string;
  value: string;
}

/** The table's numbers as the card's lines: type, radius, distance from the parent and period (not for the Sun), rotation, tilt, mass. */
export function cardFacts(body: Body, bodies: Record<string, Body>, lang: SpaceLang): Fact[] {
  const t = (en: string, nb: string): string => (lang === "nb" ? nb : en);
  const facts: Fact[] = [];
  const kind = body.kind === "moon" && body.parent ? `${KIND.moon[lang]} ${bodyLabel(bodies, body.parent, lang)}` : KIND[body.kind][lang];
  facts.push({ label: t("Type", "Type"), value: kind });
  facts.push({ label: t("Radius", "Radius"), value: fmtKm(body.r_km, lang) });
  if (body.parent) {
    const parent = bodyLabel(bodies, body.parent, lang);
    const dist = body.parent === "sun" ? `${dec((body.a_km / AU_KM).toFixed(2), lang)}${THIN}AU (${fmtKm(body.a_km, lang)})` : fmtKm(body.a_km, lang);
    facts.push({ label: t(`Distance from ${parent}`, `Avstand fra ${parent}`), value: dist });
    facts.push({ label: t("Orbital period", "Omløpstid"), value: fmtPeriod(body.period_d, lang) + (body.period_d < 0 ? t(" (retrograde)", " (retrograd)") : "") });
  }
  facts.push({ label: t("Rotation", "Rotasjon"), value: fmtRotation(body.rot_h, lang) });
  facts.push({ label: t("Axial tilt", "Aksehelning"), value: typeof body.tilt_deg === "number" ? `${dec(body.tilt_deg.toFixed(1), lang)}°` : "—" });
  facts.push({ label: t("Mass", "Masse"), value: fmtMass(body.mass_kg, lang) });
  return facts;
}

export function positionNote(schematic: boolean, lang: SpaceLang): string | null {
  if (!schematic) return null;
  return lang === "nb" ? "Posisjonen er skjematisk — en sirkelbane, ikke en efemeride." : "Position schematic — a circular orbit, not an ephemeris.";
}

export function phaseLine(p: MoonPhaseInfo, lang: SpaceLang): string {
  const pct = Math.round(p.fraction * 100);
  return lang === "nb" ? `Fase: ${p.name_nb}, ${pct} % opplyst` : `Phase: ${p.name}, ${pct} % lit`;
}

/** Wikipedia's REST summary — CORS-open, 2 KB, CC BY-SA. Norwegian Bokmål lives at no.wikipedia.org. */
export function wikiSummaryUrl(lang: SpaceLang, title: string): string {
  return `https://${lang === "nb" ? "no" : "en"}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.trim().replace(/\s+/g, "_"))}`;
}

export interface WikiSummary {
  title: string;
  extract: string;
  thumb: string | null;
  page: string | null;
}

export function readWikiSummary(json: unknown): WikiSummary | null {
  const o = json as { title?: unknown; extract?: unknown; thumbnail?: { source?: unknown }; content_urls?: { desktop?: { page?: unknown } } } | null;
  if (!o || typeof o.extract !== "string" || o.extract.trim() === "") return null;
  return {
    title: typeof o.title === "string" ? o.title : "",
    extract: o.extract.trim(),
    thumb: typeof o.thumbnail?.source === "string" ? o.thumbnail.source : null,
    page: typeof o.content_urls?.desktop?.page === "string" ? o.content_urls.desktop.page : null,
  };
}

export function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}
```

Note on `fmtPeriod`: the Moon's 27.3217 days prints as `27.3 days` (one decimal below 100), Mars's 686.98 as `687 days`, Triton's 5.877 as `5.88 days`; the test above pins all three shapes.

- [ ] **Step 4: Run, typecheck, commit**

Run: `npx vitest run tests/space-model.test.ts && npx tsc --noEmit`
Expected: PASS.

```bash
git add src/ui/space-model.ts tests/space-model.test.ts
git commit -m "Space model: what a click on the figure means, the way back out, and the fact card's lines"
```

---

## Task 9: The Space section — click overlay, crumbs, pills, the card

**Files:**
- Create: `src/ui/space-explore.ts`
- Modify: `src/ui/tray.ts` (import ~line 35; the mount guard 100-102; `freezeClick` 113-115; the handle 121-122; `close()` 264-265; `open()` 393-447; the gate 808), `src/styles.css` (after `.cs-body-pillrow` at line ~1679)

**Interfaces:**
- Consumes: Task 8's model; `SpaceEngine` via `getLoadedEngines(["space"])`; `h`, `logicalPoint` from `src/ui/dom.ts`; `elementBBoxes`, `elementRings` from `src/layout/layout.ts`; `makeBrowserMeasure` from `src/render/svg-backend.ts`; `hitElement` from `src/ui/hit.ts`; `hd.timeline.paintedLayout()`; `trayPlan(...).space` (Task 6).
- Produces: `mountSpaceSection(opts: { hd: RenderHandle; stage: HTMLElement | null; overrides: Record<string, unknown>; repaint(): void }): { el: HTMLElement; destroy(): void }`; `loadWikiSummary(lang, title, fetchFn?)`.

- [ ] **Step 1: Write the module**

Create `src/ui/space-explore.ts`:

```ts
// The Space section of the explore tray: click a body on the figure to focus
// on it (its moons appear), breadcrumbs back out to the whole system, pills
// for scale, names and date, and a fact card — the table's numbers at once,
// Wikipedia's summary when it arrives, the table alone when it does not.
// Every action is a PREVIEW through the tray's overrides → repaint, so
// Continue restores the lesson. The rules and the wording live in space-model.

import type { RenderHandle } from "../render";
import { elementBBoxes, elementRings } from "../layout/layout";
import { makeBrowserMeasure } from "../render/svg-backend";
import { getLoadedEngines } from "../scenes/engines";
import type { SpaceEngine } from "../scenes/space/types";
import { h, logicalPoint } from "./dom";
import { hitElement } from "./hit";
import {
  DATE_CHOICES, NAME_CHOICES, ROOT_LABEL, SCALE_CHOICES, bodyLabel, breadcrumbFor, cardFacts, focusTargetFor, isoDate, phaseLine, positionNote,
  readWikiSummary, wikiSummaryUrl, type Choice, type SpaceLang, type WikiSummary,
} from "./space-model";

export interface SpaceSection {
  el: HTMLElement;
  destroy(): void;
}

const HINT: Record<SpaceLang, string> = {
  en: "Click a planet or moon to look closer; use the crumbs to come back out.",
  nb: "Klikk på en planet eller måne for å se nærmere; bruk stien for å gå ut igjen.",
};
const ROW: Record<"scale" | "names" | "date", Record<SpaceLang, string>> = {
  scale: { en: "Scale", nb: "Målestokk" },
  names: { en: "Names", nb: "Navn" },
  date: { en: "Date", nb: "Dato" },
};
const CREDIT = "Wikipedia, CC BY-SA";

/** One fetch per article per session; a failure caches as null so the card never retries in a loop. */
const wikiCache = new Map<string, Promise<WikiSummary | null>>();
export function loadWikiSummary(lang: SpaceLang, title: string, fetchFn: typeof fetch = fetch): Promise<WikiSummary | null> {
  const key = `${lang}:${title}`;
  let p = wikiCache.get(key);
  if (!p) {
    p = fetchFn(wikiSummaryUrl(lang, title), { headers: { Accept: "application/json" } })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => readWikiSummary(j))
      .catch(() => null);
    wikiCache.set(key, p);
  }
  return p;
}

export function mountSpaceSection(opts: { hd: RenderHandle; stage: HTMLElement | null; overrides: Record<string, unknown>; repaint(): void }): SpaceSection {
  const { hd, stage, overrides, repaint } = opts;
  const eng = getLoadedEngines(["space"]).space as SpaceEngine;
  const bodies = eng.all();
  const authored = (hd.spec.params ?? {}) as Record<string, unknown>;
  /** The figure's params as previewed right now: authored, then the viewer's. */
  const current = (): Record<string, unknown> => ({ ...authored, ...overrides });
  const lang = (): SpaceLang => (current().names === "nb" ? "nb" : "en");
  const focusNow = (): string | null => {
    const f = current().focus;
    return typeof f === "string" && bodies[f] ? f : null;
  };
  const dateNow = (): Date => eng.resolveDate(current().date, current().days);

  const el = h("div", { class: "cs-tray-body cs-tray-space" });
  const hint = h("div", { class: "cs-tray-hint" });
  const crumbs = h("div", { class: "cs-body-crumbs" });
  const pills = h("div", { class: "cs-body-pills" });
  const card = h("div", { class: "cs-space-card" });
  el.append(hint, crumbs, pills, card);

  const setFocus = (focus: string | null): void => {
    if (focus) overrides.focus = focus;
    else delete overrides.focus;
    repaint();
    render();
  };

  const pillRow = <T,>(title: string, choices: Choice<T>[], selected: (v: T) => boolean, pick: (v: T) => void): HTMLElement => {
    const row = h("div", { class: "cs-tray-row cs-body-pillrow" });
    row.appendChild(h("span", { class: "cs-tray-label" }, title));
    for (const c of choices) {
      const b = h("button", { class: `cs-cardgate-pill cs-tray-pill${selected(c.value) ? " selected" : ""}` }, c.label[lang()]);
      b.addEventListener("click", () => {
        pick(c.value);
        repaint();
        render();
      });
      row.appendChild(b);
    }
    return row;
  };

  /** Which body the card shows, so a summary that arrives late for another body is dropped. */
  let cardFor: string | null = null;
  const renderCard = (id: string): void => {
    const L = lang();
    const b = bodies[id];
    cardFor = id;
    card.replaceChildren();
    card.appendChild(h("div", { class: "cs-space-name" }, bodyLabel(bodies, id, L)));
    const facts = h("dl", { class: "cs-space-facts" });
    for (const f of cardFacts(b, bodies, L)) {
      facts.appendChild(h("dt", {}, f.label));
      facts.appendChild(h("dd", {}, f.value));
    }
    card.appendChild(facts);
    if (id === "moon") card.appendChild(h("div", { class: "cs-space-note" }, phaseLine(eng.phase(dateNow()), L)));
    const note = positionNote(eng.schematic(id), L);
    if (note) card.appendChild(h("div", { class: "cs-space-note" }, note));
    const wiki = h("div", { class: "cs-space-wiki" });
    card.appendChild(wiki);
    void loadWikiSummary(L, b.wiki[L]).then((w) => {
      if (!w || cardFor !== id || lang() !== L) return;
      if (w.thumb) wiki.appendChild(h("img", { src: w.thumb, alt: "", class: "cs-space-thumb" }));
      wiki.appendChild(h("p", { class: "cs-space-extract" }, w.extract));
      const credit = h("div", { class: "cs-space-credit" });
      credit.append(CREDIT, " · ");
      credit.appendChild(h("a", { href: w.page ?? wikiSummaryUrl(L, b.wiki[L]), target: "_blank", rel: "noopener" }, w.title || b.wiki[L]));
      wiki.appendChild(credit);
    });
  };

  const render = (): void => {
    const L = lang();
    const focus = focusNow();
    hint.textContent = HINT[L];
    crumbs.replaceChildren();
    const chain = breadcrumbFor(bodies, focus);
    const crumb = (label: string, target: string | null, last: boolean): void => {
      const b = h("button", { class: `cs-body-crumb${last ? " current" : ""}` }, label);
      b.addEventListener("click", () => setFocus(target));
      crumbs.appendChild(b);
      if (!last) crumbs.appendChild(h("span", { class: "cs-body-sep" }, "›"));
    };
    crumb(ROOT_LABEL[L], null, chain.length === 0);
    chain.forEach((id, i) => crumb(bodyLabel(bodies, id, L), id, i === chain.length - 1));

    pills.replaceChildren();
    const scaleNow = typeof current().scale === "string" ? (current().scale as string) : "schematic";
    pills.appendChild(pillRow(ROW.scale[L], SCALE_CHOICES, (v) => v === scaleNow, (v) => { overrides.scale = v; }));
    const namesNow = typeof current().names === "string" ? (current().names as string) : "en";
    pills.appendChild(pillRow(ROW.names[L], NAME_CHOICES, (v) => v === namesNow, (v) => { overrides.names = v; }));
    const dateOf = (offsetDays: number): string => isoDate(new Date(Date.now() + offsetDays * 86400000));
    pills.appendChild(pillRow(ROW.date[L], DATE_CHOICES, (v) => overrides.date === dateOf(v), (v) => { overrides.date = dateOf(v); }));

    renderCard(focus ?? "sun");
  };

  // The click overlay: a layer over the stage, exempt from the tray's freeze,
  // that resolves a click to an element with the click-ask's own hit-testing —
  // against the PAINTED layout, so after a focus the ids are the focused view's.
  let overlay: HTMLElement | null = null;
  if (stage) {
    overlay = h("div", { class: "cs-spaceexplore" });
    overlay.addEventListener("click", (e) => {
      e.stopPropagation();
      const p = logicalPoint(stage, e);
      if (!p) return;
      const layout = hd.timeline.paintedLayout() ?? hd.layout;
      const id = hitElement(elementBBoxes(layout, makeBrowserMeasure()), p, 18, elementRings(layout));
      if (id === null) return;
      const next = focusTargetFor(bodies, id, focusNow());
      if (next !== focusNow()) setFocus(next);
    });
    stage.appendChild(overlay);
  }

  render();
  return {
    el,
    destroy() {
      cardFor = null;
      overlay?.remove();
      overlay = null;
    },
  };
}
```

- [ ] **Step 2: Wire it into the tray**

In `src/ui/tray.ts`:

a. Line 35, after the body-explore import: `import { mountSpaceSection, type SpaceSection } from "./space-explore";`

b. Lines 100-102 become:

```ts
  // An anatomy figure always has a body to explore, slider or no slider; a
  // solar-system figure a sky (its days slider comes from the schema anyway).
  const bodyTemplate = hd.spec.template === "anatomy";
  const spaceTemplate = hd.spec.template === "solar_system";
  if (liveSliders(hd).length === 0 && interactions.length === 0 && editable.length === 0 && games.length === 0 && !bodyTemplate && !spaceTemplate) return;
```

c. `freezeClick` (line 115): add `|| e.target.closest(".cs-spaceexplore")` inside the parenthesised condition, after `.cs-bodyexplore`.

d. After `let bodySection: BodySection | null = null;` (line 122):

```ts
  /** The solar-system Space section, while the tray shows one. */
  let spaceSection: SpaceSection | null = null;
```

e. In `close()` (line 264-265), after `bodySection = null;`: `spaceSection?.destroy(); spaceSection = null;`

f. `open()`'s signature (line 393) gains `space?: boolean`; the `trayPlan({...})` call (410-419) gains `spaceTemplate,` and `space: opts.space,` after `anatomy: opts.anatomy,`. After the Body block (447), before the games comment:

```ts
    // The Space section, the Body section's twin for a solar system.
    spaceSection?.destroy();
    spaceSection = null;
    if (plan.space) {
      spaceSection = mountSpaceSection({ hd, stage, overrides, repaint });
      tray.appendChild(spaceSection.el);
    }
```

g. The gate (line 808): `open({ filter: step.params, gated: true, code: step.code, anatomy: step.anatomy, space: step.space });`

- [ ] **Step 3: Styles**

Append to `src/styles.css` after the `.cs-body-pillrow .cs-tray-pill.selected` rule (line ~1679). Font sizes ONLY as tokens (`tests/palette.test.ts` allowlists `var(--text)`, `var(--text-sm)`, `var(--text-xs)`, `15px`, `12px` and nothing else):

```css
/* The solar-system Space section: click-to-focus overlay and the fact card. Crumbs and pills reuse the Body section's rules. */
.cs-spaceexplore { position: absolute; inset: 0; z-index: 4; cursor: pointer; }
.cs-space-card { display: flex; flex-direction: column; gap: 4px; font-size: var(--text-xs); color: var(--ink); }
.cs-space-name { font-weight: 600; }
.cs-space-facts { display: grid; grid-template-columns: max-content 1fr; gap: 2px 10px; margin: 0; }
.cs-space-facts dt { color: var(--muted); }
.cs-space-facts dd { margin: 0; }
.cs-space-note { color: var(--muted); font-style: italic; }
.cs-space-wiki { display: flow-root; }
.cs-space-thumb { float: right; max-width: 120px; margin: 0 0 4px 8px; border-radius: 4px; }
.cs-space-extract { margin: 0 0 4px; }
.cs-space-credit { color: var(--muted); }
.cs-space-credit a { color: inherit; }
```

- [ ] **Step 4: Typecheck, the whole suite, commit**

Run: `npx tsc --noEmit && npx vitest run`
Expected: clean and green — `tests/palette.test.ts` accepts the tokens; nothing here has node tests beyond the model (Task 8) and the plan rule (Task 6); the DOM module compiles against the real types, which is what `tsc` checks.

Then check the chunking claim before committing — `npm run build`, then:

Run: `grep -l "HelioVector" dist/assets/*.js`
Expected: exactly ONE file, and it is NOT the `index-*.js` main chunk. If the main chunk contains it, something in `tray.ts` → `space-explore.ts` → `space-model.ts` reaches `ephemeris.ts` statically — find it with `grep -rn "ephemeris\|astronomy-engine" src/ui src/scenes/space/rules.ts src/scenes/space/types.ts`.

```bash
git add src/ui/space-explore.ts src/ui/tray.ts src/styles.css
git commit -m "The Space section: click a body to look closer, crumbs back out, scale/names/date pills, a fact card with Wikipedia's summary"
```

---

## Task 10: Docs, the smoke, the merge

**Files:**
- Create: `src/scenes/space/README.md`
- Modify: `ROADMAP.md` (after the "Drag-to-place questions" bullet, ~line 445)

- [ ] **Step 1: The README**

Create `src/scenes/space/README.md`:

```markdown
# The space pack — round 1

`solar_system` draws the Sun, planets, dwarf planets and (under `focus`) moons
for a date, at a chosen scale. Design: `docs/superpowers/specs/2026-09-06-space-design.md`.

## Data and licences

- `bodies.json` — 35 bodies (radius, mass, semi-major axis, period, eccentricity,
  rotation, tilt, colour, ring, names en/nb, Wikipedia titles). Values from the
  NASA Planetary Fact Sheets and Planetary Satellite Fact Sheet (public domain);
  colours, Norwegian names and the `l0_deg` sketch longitudes are ours.
- Positions: [astronomy-engine](https://github.com/cosinekitty/astronomy) 2.1.19,
  MIT, loaded lazily with the engine. Sun, planets and Pluto through
  `HelioVector`, the Moon through `GeoMoon`, the Galilean moons through
  `JupiterMoons`; every other body rides a circular orbit of radius `a_km`
  (the ⊕ card says "position schematic" for those).
- The ⊕ card fetches the Wikipedia REST summary (CC BY-SA, credited on the card)
  at runtime; a failed fetch leaves the table's facts alone.

## Ids

Body ids are the English names in lower case and ARE the element ids (`mars`,
`io`); `orbit_<id>`, `label_<id>`, `axis`, `frame`, `scale_note`, `scale_bar`,
`missing_note`, `title`.

## The engine (`engines.space`)

`all`, `body`, `bodies` (group words `planets | inner | outer | all` expand in
place), `moonsOf`, `satellites`, `resolveDate` (the pack's only clock),
`positions` (AU, heliocentric ecliptic, z kept for round 3), `moonPositions`
(km), `phase`, `schematic`, `au`, `km`, and the scale rules from `rules.ts`.

## Rounds ahead

Round 2: `sky_map` + the `sky` engine. Round 3: `model3d: { kind: space }`
(three.js) — `texture` in the table is reserved for it.
```

- [ ] **Step 2: ROADMAP**

In `ROADMAP.md`, after the "Drag-to-place questions" bullet (~line 445), add:

```markdown
- **Space, round 1** (shipped 2026-09-06; spec
  `docs/superpowers/specs/2026-09-06-space-design.md`, plan
  `docs/superpowers/plans/2026-09-06-space-round-1.md`): the `space` pack —
  `solar_system` (top / row / tilted, four scales, `focus` with moons and
  ring, `days` animatable), the lazy `space` engine on astronomy-engine, the
  ⊕ Space section with the Wikipedia card, `explore: { space: true }`, kit v9
  `ball()`. Rounds 2 (`sky_map`) and 3 (three.js panel) next. Open: eccentric
  and inclined orbits, Uranus's ring, more moons (Wikidata's units are mixed),
  the Moon's phase drawn on the disc.
```

- [ ] **Step 3: Full suite and build**

Run: `npx vitest run && npx tsc --noEmit && npm run build`
Expected: green; the build lists a separate chunk for the engine (see Task 9 Step 4).

```bash
git add src/scenes/space/README.md ROADMAP.md
git commit -m "Space round 1: the pack's README and the roadmap entry"
```

- [ ] **Step 4: The smoke — short, on the dev server, screenshots deleted**

Start `npm run dev` in the worktree (Vite prints the URL, normally `http://localhost:5173/`). Drive it with the Playwright MCP tools (`browser_navigate`, `browser_snapshot`, `browser_click`) or by hand — the Chrome is VISIBLE and plays sound at Hans', so keep it to these steps and take at most two screenshots:

1. Open the app. From the Examples list pick **"Which one is Mars?"** and play it. Expect: the Sun sketches as a shaded amber disc, eight dashed orbits, then the planets as shaded discs; the ask card asks "Which one is Mars?"; click the fourth planet out → it glows and the reveal is spoken. Note in the browser's network panel that a separate chunk (the engine, with astronomy-engine in it) loaded when the figure rendered.
2. Pick **"Show me Jupiter and its moons."** and play it to the explore beat. Expect: the tray opens with a Space section under the `days` slider: the hint line, crumbs "Solar system › Jupiter", three pill rows (Scale / Names / Date), and a card headed "Jupiter" with "Radius 69 911 km" … "Mass 1.90 × 10^27 kg", then — within a second or two — Wikipedia's first paragraph with a thumbnail and the line "Wikipedia, CC BY-SA · Jupiter". Click **Io** on the figure → the figure redraws with Io alone and large, crumbs "Solar system › Jupiter › Io", the card headed "Io" with "Moon of Jupiter". Click the **Jupiter** crumb → back to Jupiter with its four moons. Press **Norsk** → the labels read "Io, Europa, Ganymedes, Callisto", the card's labels are Norwegian and the summary is Norwegian. Press **Sizes** → the moons shrink to true scale against Jupiter. Press **Continue** → the authored figure returns (English, schematic) and the quiz appears.
3. Pick **"Where are the planets today?"** and play it. Expect: four orbits with true spacing, four named dots, then over eight seconds Mars goes round once while Earth goes round almost twice.

If a screenshot was saved in the worktree root: `rm -f /Users/hom/Documents/GitHub/drawcast/.claude/worktrees/space/*.png` before the merge.

- [ ] **Step 5: Merge and push**

From the main checkout (`/Users/hom/Documents/GitHub/drawcast`):

```bash
git checkout main && git pull --ff-only && git merge --no-ff space && npm install && npx vitest run && git push origin main && git ls-remote origin refs/heads/main
```

Then remove the worktree and branch, and tell Hans what to try: the three smoke steps above, in that order.

---

## Self-Review

**Spec coverage.**

| Spec | Task |
|---|---|
| §3 engine location, lazy per template, dynamic imports | 3 (`loadSpace`, `engine.ts` as the chunk) |
| §3.1 the bodies table: 35 bodies, fields, `source`, groups, moons by parent | 1 (table, `expandBodies`, `satellitesFor`) |
| §3.2 HelioVector / GeoMoon / JupiterMoons / circular fallback / `days` / phase | 2 |
| §3.2 engine API `bodies`, `body`, `positions` (with z), `moonPositions`, `phase`, `au`/`km` | 1 (interface), 3 (engine) |
| §3.3 the four scale modes, Sun ≤ 1/6 frame, the segment, `scale_note`, `scale_bar` | 1 (rules), 5 (layout) |
| §4 manifest (`engines: [space]`, kit current major, ready), params table | 5 |
| §4 element ids = body ids; click and drag asks | 5 (ids), 7 (examples 1, 3) |
| §4 shaded circles lit from up-left, Saturn's ring behind and in front, no Sun glow | 4 (`ball`), 5 (`ringPieces`) |
| §4 labels with placement/quadrant sides, unknown-id note, ≤ 4000 points, nothing off-canvas | 5 (solver requests, `missing_note`, tests) |
| §4 the five bundled examples | 5 (1), 7 (2–5) |
| §5 `explore: {space: true}` schema flag, plan, tray | 6, 9 |
| §5 click → focus, breadcrumbs, pills scale/names/date, card facts + Wikipedia + credit, Continue restores | 8, 9 |
| §8 traps: examples with the pack, `draw` arrays, the four lists, `x-translate`, font tokens, no `-A`, screenshots, no new verb | 3, 5, 7, 9, 10 |
| §9 tests: table sanity, positions, scale rules, layout ids per mode, focus draws moons, examples lint clean, i18n survives, tray model rules, Playwright smoke | 1, 2, 5, 7, 8, 10 |

Not in scope by design: `sky_map`, the `sky` engine, the three.js panel (rounds 2–3). The table carries `texture` and `wiki` and `positions()` returns `z`, so those rounds start from here without reshaping the data.

**Placeholder scan.** Every code step carries its code; every run step its command and expected outcome; no task refers to another's code as "similar". The two things an implementer must discover at run time are named where they arise: the astronomy-engine namespace/`default` interop (Task 2 Step 4) and a possible label-collision on the pinned date in example 4 (Task 7 Step 3), each with the exact remedy.

**Type consistency.** `SpaceEngine` (Task 1) is what Task 3 builds, what the layout in Task 5 calls (`eng.all/bodies/satellites/resolveDate/positions/moonPositions/orbitRadii/logRadius/drawnRadii/sunSegment/scaleNote/scaleBar/labelTiers/km/au`) and what Task 9 reads (`all`, `resolveDate`, `phase`, `schematic`). `drawnRadii(centre, bodies, mode, largestPx, pxPerKm?)` returns `{ centre, bodies }` in Task 1 and is consumed so in Task 5. `sunSegment` returns `{ fill, arc, clipped }` (Task 1) and Task 5 branches on `clipped`. `focusTargetFor` returns a `string | null` FOCUS in Task 8 (not `{focus, highlight}` as the Body model does — a solar system has no "name it" second click) and Task 9 assigns it straight into `overrides.focus`. `trayPlan(...).space` (Task 6) is what Task 9 reads as `plan.space`. `explore.space` travels `schema → types → plan step → tray gate` under one name. `THIN` and `fmtInt` are exported from `rules.ts` (Task 1) because Task 8 imports them. `KIT_VERSION` 9 (Task 4) is what `space.yaml` declares as `kit: 9` (Task 5).

**Soft spots to watch while executing.**

1. `freezeClick` runs in the capture phase on the stage; `.cs-spaceexplore` in its allow-list is the one line that makes clicks reach the overlay.
2. The `sizes` row: `sunC = [F.x0 + sunW − sunR, y]` puts the Sun's centre ~770 units off the left edge; `sunSegment` clips it. If the out-of-canvas lint fires on `sun__arc`, the clip lost the arc's contiguity — check that `circle()` still starts at angle −π.
3. In `top` view with eight planets the orbit gap is 33 units, so Jupiter is a 14-unit disc and Mercury a 2.5-unit dot; that is the honest schematic and the tests pin `MIN_BODY_PX`. If Hans wants bigger discs, the lever is `R_MAX`/`rMin` in the layout, not `drawnRadii`.
4. Wikipedia's `no.` summaries for the `(måne)` titles exist for the moons the table lists; a renamed article answers 404 → `readWikiSummary(null)` → the card shows the table alone, which is the designed failure.
5. `hd.spec.template === "solar_system"` is the only way the tray knows the figure has a sky, exactly as `"anatomy"` is for the body; round 2's `sky_map` will want the same section and should generalise this to a set.
