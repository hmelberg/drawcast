# Space round 2 — the `sky_map` template and the `sky` engine

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Draw the sky from a place at a time — a stereographic planisphere with the horizon as its rim, the stars sized by magnitude and tinted by colour, the constellation figures from a machine-checked answer key, and the Sun, Moon (with its phase drawn) and naked-eye planets where they really are.

**Architecture:** A second lazy engine, `sky`, beside round 1's `space`: `src/scenes/space/sky-types.ts` (light types, reachable from the tray), `src/scenes/space/sky-rules.ts` (pure trig and tables, no astronomy import), `src/scenes/space/sky.ts` (the chunk that pulls astronomy-engine and the two committed JSON tables). `scripts/build-sky-data.mjs` snaps d3-celestial's constellation polylines onto catalogue stars once and commits the result, so the app never fetches. The `sky_map` template is a second document in `src/scenes/packs/space.yaml`; it declares `engines: [space, sky]` and reads the round-1 body table for the Sun, Moon and planets. The ⊕ Space section gains a sky half (`src/ui/sky-model.ts` + `src/ui/sky-explore.ts`), mounted by `src/ui/tray.ts` on the same `plan.space` flag.

**Tech Stack:** TypeScript, Vite, vitest. `astronomy-engine@2.1.19` (already a dependency — no new one). Data from d3-celestial (BSD-3-Clause, Olaf Frohn) fetched once by a build script; Norwegian constellation names from the Norwegian Wikipedia list (CC BY-SA), committed by hand.

**Spec:** `docs/superpowers/specs/2026-09-06-space-design.md` §6 and §6.1 (§3–§5 shipped as round 1; §7 is round 3), with every measured number in `docs/superpowers/specs/2026-09-07-sky-data-measured.md`. **Do not re-research anything in the measured doc and do not fetch to check it** — the build script's own run is the only network call this round makes.

---

## Global Constraints

These bind every task. They are the traps round 1 paid for, plus this round's own scope.

**Verification and lint**

- `layoutSpec(spec).issues` is the field the bundled-examples guard asserts (`tests/examples.test.ts:83`), **not `.warnings`**. `.warnings` carries the layout's own complaints and is empty for a template that never complains — a sweep reading it sees nothing and proves nothing. Every sweep in this plan reads `.issues`.
- A bundled example must produce **zero lint issues, warnings included**, at rest and at every animated stage.
- **A new template can warn on every single date without anyone noticing.** Round 1's default figure was 0/200 clean and only a measurement found it. Every task that touches the layout ends with a timestamp sweep whose bar is stated in that task, and the bar is always **0 issues**.
- Run tests with `npx vitest run <file>`; the whole suite with `npm test`; types with `npx tsc --noEmit` (which passes on this branch today).

**Drawing**

- **A stroke drawn `closed: true` becomes a HIT OUTLINE** (`elementRings`, `src/layout/layout.ts:265`), and `hitElement` returns the smallest outline containing the point and never reaches the box pass (`src/ui/hit.ts:52`). Round 1 shipped a `frame` that swallowed every click for exactly this reason. **The horizon circle and the crop frame are traced as OPEN paths that return to their start** — drawn identically, but they own no clicks. Pinned by `tests/sky-hit.test.ts`.
- **An `area` drawable of 3+ points is also a hit outline**, and `hitElement`'s box pass SKIPS any id that has a ring. So an element that fills part of itself must fill *all* of itself, or clicks on the unfilled part fall through to something else. The Moon draws a full faint disc under its lit crescent for this reason.
- **A group's leaf durations ACCUMULATE** (`src/render/svg-backend.ts:583-589`): 400 star dots at `SKETCH_MS.dot` would take 168 seconds. Any element built from many leaves divides a fixed budget among them — `Math.max(4, Math.round(BUDGET / n))`.
- **`applyTextMap` runs AFTER the template body** (`src/layout/layout.ts:111`), so a layout that measures its own words measures the UNTRANSLATED string. Round 1's remedy travels here unchanged: a character of headroom (`TRANSLATED_ROOM = kit.textWidth("n", LABEL_PX)`) goes into the clearance a name reserves, never into where a candidate sits.
- The four numbers of lint's label core (`{x + 0.2w, y + 0.25h, 0.6w, 0.5h}`, `src/lint/lint.ts:213`) are a **silent copy** in any layout that places its own names — a YAML layout body cannot import. Change one, change both.
- `kit.ball` emits ONE point plus a circle `shapeHint`, so a body is invisible to `overlap-label-stroke` (which needs `pts.length >= 2`) and is measured for `out-of-canvas` by its hint. This is why 500 star dots cost the lint almost nothing.
- Font sizes never below `FONT_FLOOR` (14). This round uses 30 (title), 20 (compass), 19 (names), 18 (foot lines).

**Spec surface**

- `draw` takes an **ARRAY of ids**; `"draw": "all"` does not exist and there is no wildcard (`resolveIds`, `src/render/plan.ts:210`). This is why the sky's stars and constellation lines are two group elements by default — see Task 4's ruling.
- `quiz.correct` is **1-based**.
- Id-shaped params carry `x-translate: false` (`src/spec/i18n.ts:40`); an `enum` param is already excluded.
- **Registering a template requires a bundled example in the SAME commit** — `tests/examples.test.ts:62` fails a ready template with no example or fewshot.
- No new command verb. Everything rides on `draw`, `ask`, `highlight`, `focus`, `animate`, `explore`.
- Nothing in a figure depends on a runtime fetch (spec §2).

**Repo hygiene**

- **Never `git add -A`** — another session shares this repo. Every commit lists its paths.
- Delete any Playwright screenshot from the worktree root before committing.
- Commit messages are a descriptive sentence in this repo's own voice ("Clicking a moon does nothing: the frame was eating every click"), not `feat:` prefixes. Every commit ends with:

```
Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01RWSwWnc8ToCq7H2pXdvXHY
```

**Numbers this round is built on** (measured 2026-09-06/07, `2026-09-07-sky-data-measured.md`)

- 735 edges over 88 constellations, as unordered HIP pairs; 750 distinct stars touched; the faintest is magnitude 5.89.
- Smallest figures: Canis Minor and Canes Venatici, 1 edge. Largest: Sagittarius 29, Eridanus 26, Orion 24, Pisces 23, Perseus 23.
- The bundled star set is a **union, not a magnitude cut**: mag ≤ 4.5 ∪ every constellation star = 1 040 stars (119 of the 750 line stars are fainter than 4.5). A plain cut leaves figures with gaps.
- Snapping rule: nearest catalogue star by angular distance with Δlongitude scaled by cos(latitude) and wrapped at ±180°, accepted under 0.35°. 799 of 800 vertices matched.

---

## File Structure

**Data, generated once and committed**

- `scripts/build-sky-data.mjs` — fetches `stars.6.json`, `constellations.lines.json` and `starnames.json` from jsdelivr into `.cache/sky/`, snaps the polylines to stars, writes the two tables below, prints a report. Run by hand: `node scripts/build-sky-data.mjs`.
- `src/scenes/space/sky-names.json` — hand-written and hand-verified: the 88 constellations' Latin/English/Norwegian names, and the Norwegian star names that differ from the international proper name. The `names.json` precedent from the elements pack: a name with no machine-readable source is committed by hand and a gap is a hard error.
- `src/scenes/space/sky/stars.json` — generated. `{ source, limit_mag, stars: [{ i, c: [ra, dec], m, b, n?, nb? }] }`, ~1 040 entries, ~55 KB.
- `src/scenes/space/sky/constellations.json` — generated. `{ source, constellations: [{ a, la, en, nb, e: [[hip, hip], …] }] }`, 88 entries, ~14 KB.
- `src/scenes/space/sky/LICENSE`, `src/scenes/space/sky/ATTRIBUTION.md` — BSD-3-Clause (Olaf Frohn) and the CC BY-SA credit for the Norwegian names.

**Engine**

- `src/scenes/space/sky-types.ts` — `Star`, `Constellation`, `AltAz`, `Place`, `StarTable`, `ConstellationTable`, `SkyLang`, `SkyEngine`. No astronomy import: the tray reaches this file.
- `src/scenes/space/sky-rules.ts` — pure: `CHART`, `precess`, `altAz`, `project`, `starRadius`, `starColor`, `STAR_TINTS`, `PLACES`, `resolveTime`, `localClock`, `noteText`, `constellationName`, `starName`, `edgeStars`, `expandStars`. No DOM, no clock beyond `resolveTime`'s own, no astronomy.
- `src/scenes/space/sky.ts` — `makeSkyEngine(stars, constellations)`. Imports `astronomy-engine` statically; the dynamic import of THIS file is the code-split boundary.
- `src/scenes/engines.ts` — `loadSky`, `KNOWN_ENGINES`, `ENGINE_DEFS`.

**Template**

- `src/scenes/packs/space.yaml` — a second `---` document, `template: sky_map`.

**Tray**

- `src/ui/sky-model.ts` — the ⊕ sky half's pure rules: what a click at a point means, the pill choices, the card's lines, the Wikipedia titles.
- `src/ui/sky-explore.ts` — its DOM, the twin of `space-explore.ts`.
- `src/ui/tray.ts` — mounts one section or the other by template.
- `src/spec/schema.ts`, `src/spec/types.ts` — `explore.space`'s description learns the sky (no new flag).

**Tests**

- `tests/sky-data.test.ts`, `tests/sky-rules.test.ts`, `tests/sky-engine.test.ts`, `tests/sky-template.test.ts`, `tests/sky-hit.test.ts`, `tests/sky-model.test.ts`.
- Edited: `tests/author.test.ts` (engines enum), `tests/engines.test.ts` (`KNOWN_ENGINES`), `tests/space-template.test.ts:39` (`templateIds` is now two).

**Docs**

- `src/scenes/space/README.md`, `ROADMAP.md`, `docs/superpowers/plans/2026-09-07-space-round-2-smoke.md`, `docs/superpowers/plans/2026-09-07-space-round-2-ledger.md`.

---

## Rulings this plan takes, and why

These are decisions the spec left open. An implementer must not quietly reverse one; if a task's measurement contradicts a ruling, record it in the ledger and raise it.

**R1 — `sky` is a SECOND engine, not an extension of `space`.** `ENGINE_DEFS` is a flat record and engines load per template, all-or-nothing (`ensureEnginesForTemplate`). Folding the sky into `space` would put 69 KB of star tables into every `solar_system` figure, which is a regression on a shipped template for no gain. A second entry costs five list edits, all mechanical. `sky_map` declares `engines: [space, sky]` and reads the round-1 body table through `engines.space` — the Sun, Moon and planets keep one table, one set of names and one set of colours.

**R2 — the projection is ten lines of arithmetic, not d3-geo.** Stereographic from the zenith is `r = R·tan(z/2)` with `z = 90° − alt`, and the screen placement is two lines. d3-geo would need a rotated `geoStereographic`, a y-flip (d3 is y-down, drawcast is y-up), a clip decision at the horizon, and would drag `d3-geo` into the sky chunk for no benefit. The alt/az step is likewise hand-rolled: **measured on this branch, the scalar hour-angle formula agrees with astronomy-engine's own `Horizon()` to four decimal places**, and it runs 1 040 stars in 0.3 ms per frame against `Horizon()`'s per-call cost.

*The formula, verified:*
```
H   = LST° − α          (hour angle, degrees, wrapped to ±180)
alt = asin( sin δ · sin φ + cos δ · cos φ · cos H )
az  = atan2( −sin H · cos δ ,  sin δ · cos φ − cos δ · sin φ · cos H )   (0 = N, 90 = E)
```
*and the chart, y-up, N at top, E on the LEFT — a planisphere held overhead, which is why east and west are swapped against a terrestrial map:*
```
r = R · tan( (90° − alt)·π/360 )
x = cx − r · sin(az)
y = cy + r · cos(az)
```
*Checks: az 0 → (cx, cy + r), north at the top. az 90 → (cx − r, cy), east on the left. alt 90 → r = 0, the zenith at the centre. alt 0 → r = R, on the horizon circle. alt < 0 → r > R, outside — those objects are omitted.*

**R3 — J2000 catalogue coordinates are precessed to date.** 26 years of precession is 0.35° (measured: Betelgeuse's azimuth moves from 45.2065° to 44.8570°), which is more than a bright star's drawn radius. `Rotation_EQJ_EQD(date).rot` is one 3×3 matrix per frame and nine multiply-adds per star. The matrix convention is `out[j] = Σᵢ rot[i][j]·in[i]` — verified against `RotateVector` on this branch.

**R4 — the chart draws two group elements by default, and lifts out what the author singles out.** `draw` has no wildcard, and the model writing a spec cannot know which constellations are above the horizon at a given hour, so it cannot list them. Therefore: **`stars` is one element holding every star dot, `figures` is one element holding every drawn constellation's lines**, and a star, constellation or body named in `mark`, `highlight` or `focus` is **lifted out into its own element** (`sirius`, `con_ori`) so that `draw`, the `highlight` command and `ask.widget: "click"` can address it. This is round 1's own shape — moons exist only under `focus` — and it keeps the element count near 20 instead of 110. `mark` is the new param that makes a click question authorable without the tint giving the answer away.

**R5 — a constellation or star name is written only where it costs nothing; a body's name is written at the cheapest spot.** The shared solver (`layout/labels.ts`) cannot aim at the gaps between constellation lines any more than it could aim at round 1's orbit gaps, so this template places its own names. But a star chart is denser than a solar system and naming everything is not possible at any size: an atlas names the figures it has room for. So constellation and star names take the FIRST zero-cost candidate and are otherwise not written — which makes the sweep clean by construction — while a body the author asked for by name always gets its name, from a candidate set aimed inward at the zenith where the disc is empty. Guarded against the cheap fix by floor tests: the default figure names at least five constellations, and a `focus` portrait always names its own.

**R6 — one foot caption, not three.** Round 1's known limit is `scale_note` and `missing_note` colliding in the same strip, and its own recorded remedy was "place the second relative to the first's measured right edge". This template starts there: `place_label` on one foot line, `sky_note` on another below it, and `sky_note` composes every caveat (daylight, below the horizon, unknown names, the symbol scale) into ONE string, dropping clauses from the end while it is too wide. One caption cannot collide with itself.

**R7 — `limit_mag` runs 2 … 4.5 and there is no runtime deeper-star fetch.** The spec offered a jsdelivr fetch when `limit_mag > 4.5`. A layout body is synchronous and engines load before any params are known, so the value that would trigger the fetch is read in a place that cannot await — and spec §2's own rule is that nothing in a figure depends on a runtime fetch. The bundled union already carries every star a constellation line needs, down to magnitude 5.89. A star a DRAWN constellation line touches is always drawn whatever `limit_mag` says, because a line ending at nothing is a lie.

**R8 — Messier objects are not in this round.** `messier.json` is the one file in the measured doc whose JSON shape was not measured, and it adds no machinery: it is dots on a projection that already exists, with the label rule that already exists. Deferred to a follow-up and recorded in the ROADMAP entry Task 8 writes.

**R9 — star proper names live in `stars.json`, not a third file.** The spec listed `starnames-bright.json` separately; it keys on the same HIP number as the star record and buys nothing as its own file. Two data files, not three.

---

### Task 1: The sky data — build it once, commit it, pin it

**Files:**
- Create: `scripts/build-sky-data.mjs`
- Create: `src/scenes/space/sky-names.json`
- Create (generated): `src/scenes/space/sky/stars.json`, `src/scenes/space/sky/constellations.json`
- Create: `src/scenes/space/sky/LICENSE`, `src/scenes/space/sky/ATTRIBUTION.md`
- Modify: `package.json` (one `scripts` entry)
- Test: `tests/sky-data.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: the two JSON tables, in exactly these shapes. Tasks 2 and 3 read them.
  - `stars.json` → `{ source: string; limit_mag: number; stars: { i: number; c: [number, number]; m: number; b: number | null; n?: string; nb?: string }[] }` — `i` HIP, `c` [RA°, Dec°] J2000 rounded to 3 decimals, `m` magnitude, `b` B−V or null, `n` English proper name, `nb` Norwegian proper name where it differs.
  - `constellations.json` → `{ source: string; constellations: { a: string; la: string; en: string; nb: string; e: [number, number][] }[] }` — `a` the IAU abbreviation as d3-celestial spells it ("Ori", "UMa"), `e` unordered HIP pairs, each pair sorted ascending, the list sorted and de-duplicated.

- [ ] **Step 1: Write the failing test**

`tests/sky-data.test.ts`:

```ts
// The committed sky tables. Generated once by scripts/build-sky-data.mjs and
// committed, the way the anatomy atlas and the periodic table are: the app
// never fetches, and these assertions are what a re-run has to survive.
// The numbers come from docs/superpowers/specs/2026-09-07-sky-data-measured.md,
// measured against d3-celestial on 2026-09-06.

import { describe, expect, test } from "vitest";
import starTable from "../src/scenes/space/sky/stars.json";
import conTable from "../src/scenes/space/sky/constellations.json";
import namesJson from "../src/scenes/space/sky-names.json";

const names = namesJson as unknown as {
  source: string;
  constellations: Record<string, { la: string; en: string; nb: string }>;
  stars_nb: Record<string, string>;
};
const stars = starTable.stars;
const cons = conTable.constellations;
const byHip = new Map(stars.map((s) => [s.i, s]));

describe("the star table", () => {
  test("is the magnitude-4.5 UNION, not a magnitude cut", () => {
    // 1 040 measured. A rebuild that drifts a little is fine; one that drops
    // a fifth of the sky is not.
    expect(stars.length).toBeGreaterThanOrEqual(1000);
    expect(stars.length).toBeLessThanOrEqual(1100);
    expect(starTable.limit_mag).toBe(4.5);
    // The union property, checkable on the committed file alone: every star
    // here is either inside the cut or wanted by a constellation line.
    const wanted = new Set(cons.flatMap((c) => c.e.flat()));
    for (const s of stars) {
      expect(s.m <= 4.5 || wanted.has(s.i), `HIP ${s.i} at mag ${s.m} is neither bright nor on a line`).toBe(true);
    }
    // …and the union really does reach past the cut: 119 of the 750 line
    // stars are fainter than 4.5, the faintest at 5.89.
    expect(Math.max(...stars.map((s) => s.m))).toBeGreaterThan(5.5);
  });

  test("every record is a usable star", () => {
    for (const s of stars) {
      expect(Number.isInteger(s.i) && s.i > 0, `bad HIP ${s.i}`).toBe(true);
      expect(s.c[0]).toBeGreaterThanOrEqual(0);
      expect(s.c[0]).toBeLessThan(360);
      expect(Math.abs(s.c[1])).toBeLessThanOrEqual(90);
      expect(Number.isFinite(s.m)).toBe(true);
      expect(s.b === null || Number.isFinite(s.b)).toBe(true);
    }
    expect(new Set(stars.map((s) => s.i)).size).toBe(stars.length);
  });

  test("the brightest star is Sirius, and it carries its name", () => {
    const brightest = stars.reduce((a, b) => (b.m < a.m ? b : a));
    expect(brightest.n).toBe("Sirius");
    expect(brightest.m).toBeLessThan(-1.4);
  });

  test("the stars a teaching chart names are named", () => {
    const named = new Map(stars.filter((s) => s.n).map((s) => [s.n, s]));
    for (const n of ["Sirius", "Vega", "Capella", "Rigel", "Procyon", "Betelgeuse", "Altair", "Aldebaran", "Antares", "Spica", "Pollux", "Deneb", "Regulus", "Polaris"]) {
      expect(named.has(n), `${n} is not in the table`).toBe(true);
    }
    // Names are for the stars a viewer can be asked about; the faint field is
    // anonymous. Measured: ~170 stars at mag ≤ 3.0 carry one.
    expect(named.size).toBeGreaterThanOrEqual(100);
    expect(named.get("Polaris")!.nb).toBe("Polarstjernen");
  });
});

describe("the constellation figures", () => {
  test("all 88, with names in three languages", () => {
    expect(cons.length).toBe(88);
    expect(new Set(cons.map((c) => c.a)).size).toBe(88);
    for (const c of cons) {
      for (const k of ["la", "en", "nb"] as const) expect(c[k].trim(), `${c.a}.${k}`).not.toBe("");
    }
    expect(cons.find((c) => c.a === "UMa")).toMatchObject({ la: "Ursa Major", en: "The Great Bear", nb: "Store bjørn" });
    expect(cons.find((c) => c.a === "Ori")).toMatchObject({ la: "Orion", nb: "Orion" });
  });

  test("735 edges, every endpoint a star in the table", () => {
    const total = cons.reduce((n, c) => n + c.e.length, 0);
    expect(total).toBeGreaterThanOrEqual(700);
    expect(total).toBeLessThanOrEqual(780);
    for (const c of cons) {
      for (const [a, b] of c.e) {
        expect(byHip.has(a), `${c.a}: HIP ${a} is not in stars.json`).toBe(true);
        expect(byHip.has(b), `${c.a}: HIP ${b} is not in stars.json`).toBe(true);
        expect(a).toBeLessThan(b); // sorted pairs, so an edge has one spelling
      }
      expect(new Set(c.e.map((p) => p.join("-"))).size, `${c.a} has a duplicate edge`).toBe(c.e.length);
    }
  });

  test("the figures are the sizes the measurement found", () => {
    const size = (a: string) => cons.find((c) => c.a === a)!.e.length;
    expect(size("CMi")).toBe(1);
    expect(size("CVn")).toBe(1);
    const biggest = [...cons].sort((x, y) => y.e.length - x.e.length).slice(0, 5).map((c) => c.a);
    expect(biggest[0]).toBe("Sgr");
    expect(biggest).toContain("Ori");
    expect(size("Ori")).toBeGreaterThanOrEqual(20);
    expect(size("Ori")).toBeLessThanOrEqual(28);
  });

  test("Orion's belt is three named stars joined in a row", () => {
    const ori = cons.find((c) => c.a === "Ori")!;
    const hips = new Set(ori.e.flat());
    const belt = ["Mintaka", "Alnilam", "Alnitak"].map((n) => stars.find((s) => s.n === n));
    for (const s of belt) expect(s, "a belt star is missing").toBeDefined();
    for (const s of belt) expect(hips.has(s!.i), `${s!.n} is not on an Orion line`).toBe(true);
  });
});

describe("the hand-written names file", () => {
  test("carries all 88 constellations, and every one the tables use", () => {
    expect(Object.keys(names.constellations)).toHaveLength(88);
    for (const c of cons) expect(names.constellations, c.a).toHaveProperty(c.a);
  });

  test("says where its Norwegian comes from", () => {
    expect(names.source).toMatch(/Wikipedia/);
    expect(names.source).toMatch(/CC BY-SA/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/sky-data.test.ts`
Expected: FAIL — `Failed to resolve import "../src/scenes/space/sky/stars.json"`.

- [ ] **Step 3: Write the hand-verified names file**

`src/scenes/space/sky-names.json`. The abbreviation, Latin and Norwegian columns are the Norwegian Wikipedia list as recorded in `docs/superpowers/specs/2026-09-07-sky-data-measured.md`; the English column is the conventional English name. All 88 abbreviations match `constellations.lines.json` exactly — measured, no gap in either direction.

```json
{
  "source": "Constellation names: abbreviation and Latin name as d3-celestial's constellations.lines.json spells them; Norwegian from no.wikipedia.org/wiki/Liste_over_stjernebilder (CC BY-SA), read 2026-09-06; English is the conventional name. Star names: the proper name comes from d3-celestial's starnames.json (BSD-3-Clause); only the Norwegian names that DIFFER from the international proper name are listed here.",
  "constellations": {
    "And": { "la": "Andromeda", "en": "Andromeda", "nb": "Andromeda" },
    "Ant": { "la": "Antlia", "en": "The Air Pump", "nb": "Luftpumpen" },
    "Aps": { "la": "Apus", "en": "The Bird of Paradise", "nb": "Paradisfuglen" },
    "Aqr": { "la": "Aquarius", "en": "The Water Bearer", "nb": "Vannmannen" },
    "Aql": { "la": "Aquila", "en": "The Eagle", "nb": "Ørnen" },
    "Ara": { "la": "Ara", "en": "The Altar", "nb": "Alteret" },
    "Ari": { "la": "Aries", "en": "The Ram", "nb": "Væren" },
    "Aur": { "la": "Auriga", "en": "The Charioteer", "nb": "Kusken" },
    "Boo": { "la": "Bootes", "en": "The Herdsman", "nb": "Bjørnevokteren" },
    "Cae": { "la": "Caelum", "en": "The Chisel", "nb": "Meiselen" },
    "Cam": { "la": "Camelopardalis", "en": "The Giraffe", "nb": "Sjiraffen" },
    "Cnc": { "la": "Cancer", "en": "The Crab", "nb": "Krepsen" },
    "CVn": { "la": "Canes Venatici", "en": "The Hunting Dogs", "nb": "Jakthundene" },
    "CMa": { "la": "Canis Major", "en": "The Great Dog", "nb": "Store hund" },
    "CMi": { "la": "Canis Minor", "en": "The Little Dog", "nb": "Den lille hund" },
    "Cap": { "la": "Capricornus", "en": "The Sea Goat", "nb": "Steinbukken" },
    "Car": { "la": "Carina", "en": "The Keel", "nb": "Kjølen" },
    "Cas": { "la": "Cassiopeia", "en": "Cassiopeia", "nb": "Kassiopeia" },
    "Cen": { "la": "Centaurus", "en": "The Centaur", "nb": "Kentauren" },
    "Cep": { "la": "Cepheus", "en": "Cepheus", "nb": "Kefeus" },
    "Cet": { "la": "Cetus", "en": "The Whale", "nb": "Hvalfisken" },
    "Cha": { "la": "Chamaeleon", "en": "The Chameleon", "nb": "Kameleonen" },
    "Cir": { "la": "Circinus", "en": "The Compasses", "nb": "Passeren" },
    "Col": { "la": "Columba", "en": "The Dove", "nb": "Duen" },
    "Com": { "la": "Coma Berenices", "en": "Berenice's Hair", "nb": "Berenikes hår" },
    "CrA": { "la": "Corona Australis", "en": "The Southern Crown", "nb": "Den sørlige krone" },
    "CrB": { "la": "Corona Borealis", "en": "The Northern Crown", "nb": "Den nordlige krone" },
    "Crv": { "la": "Corvus", "en": "The Crow", "nb": "Ravnen" },
    "Crt": { "la": "Crater", "en": "The Cup", "nb": "Begeret" },
    "Cru": { "la": "Crux", "en": "The Southern Cross", "nb": "Sørkorset" },
    "Cyg": { "la": "Cygnus", "en": "The Swan", "nb": "Svanen" },
    "Del": { "la": "Delphinus", "en": "The Dolphin", "nb": "Delfinen" },
    "Dor": { "la": "Dorado", "en": "The Swordfish", "nb": "Gullfisken" },
    "Dra": { "la": "Draco", "en": "The Dragon", "nb": "Dragen" },
    "Equ": { "la": "Equuleus", "en": "The Little Horse", "nb": "Føllet" },
    "Eri": { "la": "Eridanus", "en": "The River", "nb": "Floden" },
    "For": { "la": "Fornax", "en": "The Furnace", "nb": "Smelteovnen" },
    "Gem": { "la": "Gemini", "en": "The Twins", "nb": "Tvillingene" },
    "Gru": { "la": "Grus", "en": "The Crane", "nb": "Tranen" },
    "Her": { "la": "Hercules", "en": "Hercules", "nb": "Herkules" },
    "Hor": { "la": "Horologium", "en": "The Clock", "nb": "Uret" },
    "Hya": { "la": "Hydra", "en": "The Water Snake", "nb": "Vannslangen" },
    "Hyi": { "la": "Hydrus", "en": "The Lesser Water Snake", "nb": "Den sørlige vannslangen" },
    "Ind": { "la": "Indus", "en": "The Indian", "nb": "Indianeren" },
    "Lac": { "la": "Lacerta", "en": "The Lizard", "nb": "Firfislen" },
    "Leo": { "la": "Leo", "en": "The Lion", "nb": "Løven" },
    "LMi": { "la": "Leo Minor", "en": "The Little Lion", "nb": "Den lille løve" },
    "Lep": { "la": "Lepus", "en": "The Hare", "nb": "Haren" },
    "Lib": { "la": "Libra", "en": "The Scales", "nb": "Vekten" },
    "Lup": { "la": "Lupus", "en": "The Wolf", "nb": "Ulven" },
    "Lyn": { "la": "Lynx", "en": "The Lynx", "nb": "Gaupen" },
    "Lyr": { "la": "Lyra", "en": "The Lyre", "nb": "Lyren" },
    "Men": { "la": "Mensa", "en": "Table Mountain", "nb": "Bordet" },
    "Mic": { "la": "Microscopium", "en": "The Microscope", "nb": "Mikroskopet" },
    "Mon": { "la": "Monoceros", "en": "The Unicorn", "nb": "Enhjørningen" },
    "Mus": { "la": "Musca", "en": "The Fly", "nb": "Fluen" },
    "Nor": { "la": "Norma", "en": "The Set Square", "nb": "Vinkelhaken" },
    "Oct": { "la": "Octans", "en": "The Octant", "nb": "Oktanten" },
    "Oph": { "la": "Ophiuchus", "en": "The Serpent Bearer", "nb": "Slangebæreren" },
    "Ori": { "la": "Orion", "en": "Orion", "nb": "Orion" },
    "Pav": { "la": "Pavo", "en": "The Peacock", "nb": "Påfuglen" },
    "Peg": { "la": "Pegasus", "en": "Pegasus", "nb": "Pegasus" },
    "Per": { "la": "Perseus", "en": "Perseus", "nb": "Persevs" },
    "Phe": { "la": "Phoenix", "en": "The Phoenix", "nb": "Føniks" },
    "Pic": { "la": "Pictor", "en": "The Painter's Easel", "nb": "Maleren" },
    "Psc": { "la": "Pisces", "en": "The Fishes", "nb": "Fiskene" },
    "PsA": { "la": "Piscis Austrinus", "en": "The Southern Fish", "nb": "Den sørlige fisken" },
    "Pup": { "la": "Puppis", "en": "The Stern", "nb": "Akterstavnen" },
    "Pyx": { "la": "Pyxis", "en": "The Mariner's Compass", "nb": "Kompasset" },
    "Ret": { "la": "Reticulum", "en": "The Net", "nb": "Nettet" },
    "Sge": { "la": "Sagitta", "en": "The Arrow", "nb": "Pilen" },
    "Sgr": { "la": "Sagittarius", "en": "The Archer", "nb": "Skytten" },
    "Sco": { "la": "Scorpius", "en": "The Scorpion", "nb": "Skorpionen" },
    "Scl": { "la": "Sculptor", "en": "The Sculptor", "nb": "Billedhuggeren" },
    "Sct": { "la": "Scutum", "en": "The Shield", "nb": "Skjoldet" },
    "Ser": { "la": "Serpens", "en": "The Serpent", "nb": "Slangen" },
    "Sex": { "la": "Sextans", "en": "The Sextant", "nb": "Sekstanten" },
    "Tau": { "la": "Taurus", "en": "The Bull", "nb": "Tyren" },
    "Tel": { "la": "Telescopium", "en": "The Telescope", "nb": "Teleskopet" },
    "TrA": { "la": "Triangulum Australe", "en": "The Southern Triangle", "nb": "Det sørlige triangelet" },
    "Tri": { "la": "Triangulum", "en": "The Triangle", "nb": "Triangelet" },
    "Tuc": { "la": "Tucana", "en": "The Toucan", "nb": "Tukanen" },
    "UMa": { "la": "Ursa Major", "en": "The Great Bear", "nb": "Store bjørn" },
    "UMi": { "la": "Ursa Minor", "en": "The Little Bear", "nb": "Lille bjørn" },
    "Vel": { "la": "Vela", "en": "The Sails", "nb": "Seilet" },
    "Vir": { "la": "Virgo", "en": "The Maiden", "nb": "Jomfruen" },
    "Vol": { "la": "Volans", "en": "The Flying Fish", "nb": "Flygefisken" },
    "Vul": { "la": "Vulpecula", "en": "The Fox", "nb": "Reven" }
  },
  "stars_nb": {
    "Polaris": "Polarstjernen"
  }
}
```

- [ ] **Step 4: Write the build script**

`scripts/build-sky-data.mjs`:

```js
// Generates src/scenes/space/sky/{stars,constellations}.json — the sky map's
// two data tables — the way scripts/build-elements.mjs generates the periodic
// table: the source is fetched once into a gitignored cache, the OUTPUT is
// what ships, and tests/sky-data.test.ts is what pins it.
//
// Three sources, all d3-celestial (BSD-3-Clause, Olaf Frohn), all measured
// CORS-open and stable on 2026-09-06:
//   stars.6.json               5 044 stars to magnitude 6, GeoJSON points
//   constellations.lines.json  88 MultiLineString figures in RA/Dec
//   starnames.json             proper names by HIP
//
// The one idea in this file: constellations.lines.json draws each figure as
// coordinate polylines, not as star references, so a figure cannot be checked
// against anything. Measured 2026-09-06: every vertex lies within 0.35 deg of
// a catalogue star (799 of 800 across all 88). Snapping each vertex to its
// nearest star turns the drawing into pairs of HIP numbers — a machine-
// checkable answer key, which is what makes the connect-the-stars exercise
// gradeable in both directions.
//
// Names have no machine-readable Norwegian source, so src/scenes/space/
// sky-names.json is hand-verified and a missing constellation is a hard
// error: a silently English chart would be a quiet lie in a Norwegian lesson.
//
// Run: node scripts/build-sky-data.mjs

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CACHE = join(ROOT, ".cache/sky");
const OUT = join(ROOT, "src/scenes/space/sky");
const NAMES = join(ROOT, "src/scenes/space/sky-names.json");
const BASE = "https://cdn.jsdelivr.net/gh/ofrohn/d3-celestial@master/data/";

/** Magnitude cut for the FIELD stars. Every constellation-line star is kept
 *  whatever its magnitude — see the union below. */
const LIMIT_MAG = 4.5;
/** The measured snapping tolerance: 799 of 800 vertices match under it. */
const SNAP_DEG = 0.35;

async function grab(name) {
  mkdirSync(CACHE, { recursive: true });
  const file = join(CACHE, name);
  if (!existsSync(file)) {
    const res = await fetch(BASE + name);
    if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
    writeFileSync(file, Buffer.from(await res.arrayBuffer()));
    console.log(`fetched ${name}`);
  }
  return JSON.parse(readFileSync(file, "utf8"));
}

/** Angular distance in degrees, longitude scaled by cos(latitude) and wrapped
 *  at +-180 — the recipe the 0.35 deg measurement was made with. */
function sep(ra1, dec1, ra2, dec2) {
  let dra = ((ra1 - ra2 + 540) % 360) - 180;
  dra *= Math.cos((((dec1 + dec2) / 2) * Math.PI) / 180);
  return Math.hypot(dra, dec1 - dec2);
}

// ---- stars ----------------------------------------------------------------

const starsRaw = await grab("stars.6.json");
/** { hip, ra, dec, mag, bv } for every catalogue star. */
const catalogue = starsRaw.features.map((f) => ({
  hip: Number(f.id),
  ra: ((f.geometry.coordinates[0] % 360) + 360) % 360,
  dec: f.geometry.coordinates[1],
  mag: f.properties.mag,
  bv: typeof f.properties.bv === "number" ? f.properties.bv : null,
}));
if (catalogue.length < 4000) throw new Error(`stars.6.json gave only ${catalogue.length} stars`);
const byHip = new Map(catalogue.map((s) => [s.hip, s]));

// A 1-degree bucket grid, so snapping is a local search rather than
// 800 x 5 044 comparisons.
const grid = new Map();
const cell = (ra, dec) => `${Math.floor(ra)}|${Math.floor(dec)}`;
for (const s of catalogue) {
  const k = cell(s.ra, s.dec);
  if (!grid.has(k)) grid.set(k, []);
  grid.get(k).push(s);
}
function nearest(ra, dec) {
  let best = null;
  let bestD = Infinity;
  for (let dr = -2; dr <= 2; dr++) {
    for (let dd = -2; dd <= 2; dd++) {
      for (const s of grid.get(cell((ra + dr + 360) % 360, dec + dd)) ?? []) {
        const d = sep(ra, dec, s.ra, s.dec);
        if (d < bestD) { bestD = d; best = s; }
      }
    }
  }
  return { star: best, d: bestD };
}

// ---- constellation figures as HIP pairs ------------------------------------

const linesRaw = await grab("constellations.lines.json");
const names = JSON.parse(readFileSync(NAMES, "utf8"));
let vertices = 0;
let unmatched = 0;
const constellations = [];
for (const f of linesRaw.features) {
  const abbr = f.id ?? f.properties?.id;
  const meta = names.constellations[abbr];
  if (!meta) throw new Error(`sky-names.json has no entry for "${abbr}" — add it by hand`);
  const edges = new Set();
  for (const line of f.geometry.coordinates) {
    let prev = null;
    for (const [ra, dec] of line) {
      vertices++;
      const { star, d } = nearest(((ra % 360) + 360) % 360, dec);
      if (!star || d > SNAP_DEG) { unmatched++; prev = null; continue; }
      if (prev !== null && prev !== star.hip) edges.add([prev, star.hip].sort((a, b) => a - b).join(","));
      prev = star.hip;
    }
  }
  constellations.push({
    a: abbr,
    la: meta.la,
    en: meta.en,
    nb: meta.nb,
    e: [...edges].map((k) => k.split(",").map(Number)).sort((p, q) => p[0] - q[0] || p[1] - q[1]),
  });
}
constellations.sort((a, b) => a.a.localeCompare(b.a));
if (constellations.length !== 88) throw new Error(`got ${constellations.length} constellations, expected 88`);

// ---- the union: bright stars PLUS every star a line names ------------------

const wanted = new Set(constellations.flatMap((c) => c.e.flat()));
const kept = catalogue.filter((s) => s.mag <= LIMIT_MAG || wanted.has(s.hip));

// ---- proper names ----------------------------------------------------------

const namesRaw = await grab("starnames.json");
/** d3-celestial keys starnames.json by HIP. A value is either the name itself
 *  or an object carrying it under `name` (with a Bayer designation under
 *  `desig`). Anything else is a shape this script has not seen. */
function properName(v) {
  if (typeof v === "string") return v.trim() || null;
  if (v && typeof v === "object" && typeof v.name === "string") return v.name.trim() || null;
  return null;
}
const proper = new Map();
for (const [hip, v] of Object.entries(namesRaw)) {
  const n = properName(v);
  if (n) proper.set(Number(hip), n);
}
const brightest = kept.reduce((a, b) => (b.mag < a.mag ? b : a));
if (!/sirius/i.test(proper.get(brightest.hip) ?? "")) {
  const sample = Object.entries(namesRaw).slice(0, 3);
  throw new Error(
    `starnames.json did not name the brightest star (HIP ${brightest.hip}, mag ${brightest.mag}) "Sirius". ` +
      `Its shape is not what properName() expects. First three entries: ${JSON.stringify(sample)}. ` +
      `Fix properName(), re-run, and record the real shape in the round-2 ledger.`,
  );
}

const stars = kept
  .sort((a, b) => a.hip - b.hip)
  .map((s) => {
    const n = s.mag <= 3.0 ? (proper.get(s.hip) ?? null) : null;
    const nb = n ? (names.stars_nb[n] ?? null) : null;
    return {
      i: s.hip,
      c: [Math.round(s.ra * 1000) / 1000, Math.round(s.dec * 1000) / 1000],
      m: s.mag,
      b: s.bv === null ? null : Math.round(s.bv * 1000) / 1000,
      ...(n ? { n } : {}),
      ...(nb ? { nb } : {}),
    };
  });
const namedCount = stars.filter((s) => s.n).length;
if (namedCount < 100) throw new Error(`only ${namedCount} stars got a proper name — starnames.json was not read properly`);

// ---- write ------------------------------------------------------------------

mkdirSync(OUT, { recursive: true });
const SOURCE_STARS =
  `d3-celestial stars.6.json (BSD-3-Clause, Olaf Frohn), Hipparcos. Kept: every star to magnitude ${LIMIT_MAG} PLUS every star a constellation line touches. Proper names from d3-celestial starnames.json; Norwegian names that differ from src/scenes/space/sky-names.json. Generated by scripts/build-sky-data.mjs.`;
const SOURCE_CONS =
  `Figures from d3-celestial constellations.lines.json (BSD-3-Clause, Olaf Frohn), each vertex snapped to the nearest catalogue star within ${SNAP_DEG} deg and stored as unordered HIP pairs. Latin and Norwegian names from src/scenes/space/sky-names.json. Generated by scripts/build-sky-data.mjs.`;
const write = (name, obj) => {
  const path = join(OUT, name);
  writeFileSync(path, JSON.stringify(obj) + "\n");
  return Math.round(readFileSync(path).length / 1024);
};
const kbStars = write("stars.json", { source: SOURCE_STARS, limit_mag: LIMIT_MAG, stars });
const kbCons = write("constellations.json", { source: SOURCE_CONS, constellations });

const edgeTotal = constellations.reduce((n, c) => n + c.e.length, 0);
const faintestLine = Math.max(...[...wanted].map((h) => byHip.get(h)?.mag ?? -9));
console.log(`
stars kept          ${stars.length}   (${kbStars} KB)   named ${namedCount}
constellations      ${constellations.length}   edges ${edgeTotal}   (${kbCons} KB)
distinct line stars ${wanted.size}   faintest ${faintestLine.toFixed(2)}
vertices            ${vertices}   unmatched ${unmatched}
biggest figures     ${[...constellations].sort((a, b) => b.e.length - a.e.length).slice(0, 5).map((c) => `${c.a}:${c.e.length}`).join(" ")}
`);
```

- [ ] **Step 5: Write the licence and attribution files**

`src/scenes/space/sky/ATTRIBUTION.md`:

```markdown
# The sky tables — where they come from

`stars.json` and `constellations.json` are generated by
`scripts/build-sky-data.mjs` and committed. The app never fetches them.

- **Star positions, magnitudes, colour indices and proper names** — the
  d3-celestial data set (`stars.6.json`, `starnames.json`), Olaf Frohn,
  BSD-3-Clause. See `LICENSE` beside this file. The underlying catalogue is
  Hipparcos, and `i` is the Hipparcos number.
- **Constellation figures** — d3-celestial's `constellations.lines.json`,
  same licence, with each polyline vertex snapped to its nearest catalogue
  star (within 0.35°) and stored as pairs of Hipparcos numbers.
- **Norwegian constellation names** — the Norwegian Wikipedia list of
  constellations, <https://no.wikipedia.org/wiki/Liste_over_stjernebilder>,
  CC BY-SA 4.0. Kept by hand in `../sky-names.json`.
- **English constellation names** — the conventional English names, ours.
- **Positions of the Sun, Moon and planets** are not stored anywhere: they
  are computed for a moment by astronomy-engine (MIT).
```

`src/scenes/space/sky/LICENSE` — the BSD-3-Clause text with `Copyright (c) 2015-2021, Olaf Frohn`. Fetch it once, unedited, and commit it:

```bash
curl -sSL https://cdn.jsdelivr.net/gh/ofrohn/d3-celestial@master/LICENSE -o src/scenes/space/sky/LICENSE
head -3 src/scenes/space/sky/LICENSE
```
Expected: a BSD 3-Clause header naming Olaf Frohn. If the fetch 404s, take the text from the repository's GitHub page instead — do not paraphrase a licence.

- [ ] **Step 6: Add the npm script**

In `package.json`'s `scripts`, beside `"sync:mdlib"`:

```json
"build:sky": "node scripts/build-sky-data.mjs",
```

- [ ] **Step 7: Run the build and read its report**

Run: `node scripts/build-sky-data.mjs`
Expected: a report close to

```
stars kept          1040   (55 KB)   named 170
constellations      88   edges 735   (14 KB)
distinct line stars 750   faintest 5.89
vertices            800   unmatched 1
biggest figures     Sgr:29 Eri:26 Ori:24 Psc:23 Per:23
```

If a number differs from the measured doc, **record the difference in the ledger and keep what the script produced** — do not adjust the snapping to chase a number. If the script throws on `starnames.json`, follow the message: fix `properName()` for the shape it prints, re-run, and record the real shape in the ledger.

- [ ] **Step 8: Run the test to verify it passes**

Run: `npx vitest run tests/sky-data.test.ts`
Expected: PASS, 9 tests.

Run: `npx tsc --noEmit`
Expected: no output.

- [ ] **Step 9: Commit**

```bash
git add scripts/build-sky-data.mjs src/scenes/space/sky-names.json src/scenes/space/sky tests/sky-data.test.ts package.json
git commit -m "The sky, reduced to two files: 1 040 stars and 88 figures as star pairs

The constellation lines arrive as coordinate polylines, which cannot be
checked against anything. Snapping every vertex to its nearest catalogue star
turns each figure into pairs of Hipparcos numbers — an answer key a machine
can grade. The star set is a union, not a magnitude cut: 119 of the stars the
lines need are fainter than 4.5, so a cut would leave the figures with gaps.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01RWSwWnc8ToCq7H2pXdvXHY"
```

---

### Task 2: The light half — types and pure rules

Everything the chart needs that is not astronomy: the projection, the alt/az transform, the dot's size and tint, the clock, the observer presets, and the one foot caption's wording. No astronomy-engine import — the tray reaches this file, and round 1's code-split boundary must not move.

**Files:**
- Create: `src/scenes/space/sky-types.ts`
- Create: `src/scenes/space/sky-rules.ts`
- Test: `tests/sky-rules.test.ts`

**Interfaces:**
- Consumes: `src/scenes/space/sky/stars.json` and `.../constellations.json` from Task 1 (their compact record shapes).
- Produces, from `sky-types.ts`:
  ```ts
  export type SkyLang = "en" | "nb" | "la";
  export interface Star { hip: number; ra: number; dec: number; mag: number; bv: number | null; name: string | null; name_nb: string | null }
  export interface Constellation { abbr: string; name: { la: string; en: string; nb: string }; edges: [number, number][] }
  export interface AltAz { alt: number; az: number }
  export interface Place { id: string; name: { en: string; nb: string }; lat: number; lon: number }
  export interface Chart { cx: number; cy: number; r: number }
  export interface MoonLimb { fraction: number; waxing: boolean; toward: AltAz | null }
  export interface StarTable { source: string; limit_mag: number; stars: { i: number; c: [number, number]; m: number; b: number | null; n?: string; nb?: string }[] }
  export interface ConstellationTable { source: string; constellations: { a: string; la: string; en: string; nb: string; e: [number, number][] }[] }
  export interface NoteParts { daylight: boolean; below: string[]; unknown: string[]; symbols: boolean }
  ```
- Produces, from `sky-rules.ts`: `DEG`, `CHART`, `FRAME`, `STAR_TINTS`, `PLACES`, `precess`, `altAz`, `project`, `starRadius`, `starColor`, `resolveTime`, `localClock`, `noteClauses`, `constellationName`, `starName`, `placeName`, `starId`, `conId`, `edgeStars`, `expandStars`, `expandConstellations`. Task 3 wraps these into the engine; Tasks 4–6 reach them through it.

- [ ] **Step 1: Write the failing test**

`tests/sky-rules.test.ts`:

```ts
// The sky's pure half: the projection, the alt/az transform, the dot, the
// clock. Every number here is checkable by hand or against astronomy-engine,
// and none of it needs the browser or the engine chunk.

import { describe, expect, test } from "vitest";
import * as A from "astronomy-engine";
import starTable from "../src/scenes/space/sky/stars.json";
import conTable from "../src/scenes/space/sky/constellations.json";
import {
  CHART, DEG, PLACES, STAR_TINTS, altAz, conId, constellationName, edgeStars, expandConstellations,
  expandStars, localClock, noteClauses, precess, project, resolveTime, starColor, starId, starName,
} from "../src/scenes/space/sky-rules";
import type { ConstellationTable, StarTable } from "../src/scenes/space/sky-types";
import { relativeLuminance } from "./contrast";

const stars = expandStars(starTable as unknown as StarTable);
const cons = expandConstellations(conTable as unknown as ConstellationTable);
const ground = "#faf6ec"; // kit.GROUND — the figure's paper

function contrast(a: string, b: string): number {
  const [x, y] = [relativeLuminance(a), relativeLuminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

describe("the projection — a planisphere held overhead", () => {
  test("the zenith is the centre and the horizon is the rim", () => {
    expect(project({ alt: 90, az: 0 })).toEqual([CHART.cx, CHART.cy]);
    const [x, y] = project({ alt: 0, az: 0 });
    expect(Math.hypot(x - CHART.cx, y - CHART.cy)).toBeCloseTo(CHART.r, 6);
  });

  test("north is at the top and EAST IS ON THE LEFT — the chart is held up, not laid down", () => {
    const n = project({ alt: 0, az: 0 });
    const e = project({ alt: 0, az: 90 });
    const s = project({ alt: 0, az: 180 });
    const w = project({ alt: 0, az: 270 });
    expect(n[1]).toBeGreaterThan(CHART.cy);   // y-up: north is above the centre
    expect(s[1]).toBeLessThan(CHART.cy);
    expect(e[0]).toBeLessThan(CHART.cx);      // east on the LEFT
    expect(w[0]).toBeGreaterThan(CHART.cx);
  });

  test("below the horizon lands outside the circle, which is how the template omits it", () => {
    const [x, y] = project({ alt: -10, az: 45 });
    expect(Math.hypot(x - CHART.cx, y - CHART.cy)).toBeGreaterThan(CHART.r);
  });

  test("halfway up is NOT halfway out — stereographic stretches toward the rim", () => {
    const [x, y] = project({ alt: 45, az: 0 });
    const r = Math.hypot(x - CHART.cx, y - CHART.cy);
    expect(r / CHART.r).toBeCloseTo(Math.tan(22.5 * DEG), 6);
    expect(r / CHART.r).toBeLessThan(0.5);
  });
});

describe("alt/az agrees with astronomy-engine's own Horizon()", () => {
  // The reason this file may hand-roll the transform at all: it is not an
  // approximation of Horizon(), it is the same answer, and it costs a tenth of
  // a millisecond for a thousand stars where a thousand Horizon() calls do not.
  const at = new Date("2026-09-07T21:00:00Z");
  const obs = new A.Observer(59.91, 10.75, 0);
  const lst = (A.SiderealTime(at) + 10.75 / 15) * 15;
  const rot = A.Rotation_EQJ_EQD(at).rot;

  test.each([
    ["Betelgeuse", 88.7929, 7.4071],
    ["Polaris", 37.9545, 89.2641],
    ["Sirius", 101.2872, -16.7161],
  ])("%s lands where Horizon() puts it", (_name, ra, dec) => {
    const d = precess(rot, ra, dec);
    const mine = altAz(d.ra, d.dec, lst, 59.91);
    const theirs = A.Horizon(at, obs, d.ra / 15, d.dec, "");
    expect(mine.alt).toBeCloseTo(theirs.altitude, 4);
    expect(mine.az).toBeCloseTo(theirs.azimuth, 4);
  });

  test("precession is worth doing: 26 years moves a star by about a third of a degree", () => {
    const d = precess(rot, 88.7929, 7.4071);
    expect(Math.abs(d.ra - 88.7929)).toBeGreaterThan(0.3);
    expect(Math.abs(d.dec - 7.4071)).toBeLessThan(0.05);
  });

  test("Polaris sits at the latitude, whatever the hour", () => {
    for (const h of [0, 6, 12, 18]) {
      const t = new Date(Date.UTC(2026, 8, 7, h));
      const l = (A.SiderealTime(t) + 10.75 / 15) * 15;
      const p = precess(A.Rotation_EQJ_EQD(t).rot, 37.9545, 89.2641);
      expect(altAz(p.ra, p.dec, l, 59.91).alt, `hour ${h}`).toBeCloseTo(59.91, 0);
    }
  });
});

describe("the dot", () => {
  test("brighter is bigger, and the size does not move when limit_mag does", () => {
    expect(starRadiusOf(-1.46)).toBeGreaterThan(starRadiusOf(0));
    expect(starRadiusOf(0)).toBeGreaterThan(starRadiusOf(2));
    expect(starRadiusOf(2)).toBeGreaterThan(starRadiusOf(4));
    expect(starRadiusOf(-1.46)).toBeCloseTo(4.905, 2);
    expect(starRadiusOf(4.5)).toBe(1.3);   // the floor: still visible ink
    expect(starRadiusOf(5.89)).toBe(1.3);
    expect(starRadiusOf(-20)).toBe(5.4);   // the cap
  });

  test("the B−V tint runs blue to orange, and every tint reads on the paper", () => {
    expect(starColor(-0.2)).toBe(STAR_TINTS[0].color);
    expect(starColor(2.0)).toBe(STAR_TINTS[STAR_TINTS.length - 1].color);
    expect(starColor(null)).toBe(starColor(0.45));   // no colour index: neutral
    for (const t of STAR_TINTS) {
      expect(contrast(t.color, ground), t.color).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe("the clock", () => {
  test("an ISO instant with an offset is that instant", () => {
    expect(resolveTime("2026-09-07T22:00:00+02:00", 0, 0, 10.75).toISOString()).toBe("2026-09-07T20:00:00.000Z");
  });

  test("an ISO datetime with no offset is read as UTC", () => {
    expect(resolveTime("2026-09-07T22:00", 0, 0, 10.75).toISOString()).toBe("2026-09-07T22:00:00.000Z");
  });

  test("a bare date is 22:00 local solar time where the observer stands", () => {
    // Oslo, lon 10.75 -> 22:00 local solar is 21:17 UTC.
    expect(resolveTime("2026-09-07", 0, 0, 10.75).toISOString()).toBe("2026-09-07T21:17:00.000Z");
    // …and at the prime meridian it really is 22:00 UTC.
    expect(resolveTime("2026-09-07", 0, 0, 0).toISOString()).toBe("2026-09-07T22:00:00.000Z");
  });

  test("hours and days shift whatever it resolved to, fractions allowed", () => {
    expect(resolveTime("2026-09-07T22:00Z", 6, 0, 0).toISOString()).toBe("2026-09-08T04:00:00.000Z");
    expect(resolveTime("2026-09-07T22:00Z", 0, -1.5, 0).toISOString()).toBe("2026-09-06T10:00:00.000Z");
  });

  test("now, nonsense and nothing all mean the injected moment", () => {
    const now = new Date("2026-03-01T12:00:00Z");
    for (const v of ["now", "", "tonight", undefined, 7]) {
      expect(resolveTime(v, 0, 0, 0, now).getTime(), String(v)).toBe(now.getTime());
    }
  });

  test("the written clock is local solar time, and it needs no timezone table", () => {
    expect(localClock(new Date("2026-09-07T21:17:00Z"), 10.75)).toEqual({ date: "2026-09-07", time: "22:00" });
    expect(localClock(new Date("2026-09-07T23:30:00Z"), 18.96).date).toBe("2026-09-08");   // Tromsø rolls over
  });
});

describe("names, ids and the caption", () => {
  test("three languages give three different labels, which is what makes 'write the Latin name' answerable", () => {
    const uma = cons.find((c) => c.abbr === "UMa")!;
    expect(constellationName(uma, "la")).toBe("Ursa Major");
    expect(constellationName(uma, "en")).toBe("The Great Bear");
    expect(constellationName(uma, "nb")).toBe("Store bjørn");
  });

  test("a star keeps its proper name unless Norwegian has its own", () => {
    const polaris = stars.find((s) => s.name === "Polaris")!;
    const sirius = stars.find((s) => s.name === "Sirius")!;
    expect(starName(polaris, "nb")).toBe("Polarstjernen");
    expect(starName(polaris, "en")).toBe("Polaris");
    expect(starName(sirius, "nb")).toBe("Sirius");
    expect(starName(stars.find((s) => s.name === null)!, "en")).toBeNull();
  });

  test("ids: a proper name in lower case, else hip_<n>; a constellation is con_<abbr>", () => {
    expect(starId(stars.find((s) => s.name === "Sirius")!)).toBe("sirius");
    expect(starId({ hip: 12345, ra: 0, dec: 0, mag: 5, bv: null, name: null, name_nb: null })).toBe("hip_12345");
    expect(starId({ hip: 1, ra: 0, dec: 0, mag: 5, bv: null, name: "Kaus Australis", name_nb: null })).toBe("kaus_australis");
    expect(conId(cons.find((c) => c.abbr === "UMa")!)).toBe("con_uma");
  });

  test("the caption's clauses come in the order they matter, cheapest last", () => {
    const all = noteClauses({ daylight: true, below: ["Jupiter"], unknown: ["krypton"], symbols: true }, "en");
    expect(all).toHaveLength(4);
    expect(all[0]).toMatch(/^The Sun is up/);
    expect(all[1]).toBe("Below the horizon: Jupiter");
    expect(all[2]).toBe("Unknown: krypton");
    expect(all[3]).toMatch(/symbols/);
    expect(noteClauses({ daylight: false, below: [], unknown: [], symbols: false }, "en")).toEqual([]);
    expect(noteClauses({ daylight: false, below: ["Jupiter"], unknown: [], symbols: false }, "nb")[0]).toBe("Under horisonten: Jupiter");
  });

  test("the observer presets are the four the tray offers", () => {
    expect(PLACES.map((p) => p.id)).toEqual(["oslo", "bergen", "tromso", "equator"]);
    expect(PLACES[0]).toMatchObject({ lat: 59.91, lon: 10.75 });
    for (const p of PLACES) {
      expect(Math.abs(p.lat)).toBeLessThanOrEqual(90);
      expect(Math.abs(p.lon)).toBeLessThanOrEqual(180);
    }
  });
});

describe("expanding the committed tables", () => {
  test("every compact star record becomes a usable Star", () => {
    expect(stars.length).toBe((starTable as unknown as StarTable).stars.length);
    const s = stars.find((x) => x.name === "Sirius")!;
    expect(s.hip).toBeGreaterThan(0);
    expect(s.dec).toBeLessThan(0);
    expect(s.name_nb).toBeNull();
  });

  test("edgeStars gives a figure's own stars, once each, in order", () => {
    const ori = cons.find((c) => c.abbr === "Ori")!;
    const hips = edgeStars(ori);
    expect(new Set(hips).size).toBe(hips.length);
    expect([...hips].sort((a, b) => a - b)).toEqual(hips);
    expect(hips.length).toBeGreaterThanOrEqual(15);
    expect(hips.every((h) => stars.some((s) => s.hip === h))).toBe(true);
  });
});

```

Two mechanical notes on that file. `starRadius` is used above under the short
alias `starRadiusOf` purely so the size assertions read as a table — add it to
the import list and put `const starRadiusOf = starRadius;` immediately after
the imports. And the `Star` literals in the id test (`{ hip: 12345, ra: 0,
dec: 0, mag: 5, bv: null, name: null, name_nb: null }`) need every field of the
`Star` interface, which is why they carry `ra`, `dec` and `bv` they do not use.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/sky-rules.test.ts`
Expected: FAIL — `Failed to resolve import "../src/scenes/space/sky-rules"`.

- [ ] **Step 3: Write `src/scenes/space/sky-types.ts`**

```ts
// The sky map's data shapes and the engine a layout sees as `engines.sky`.
// Nothing here imports astronomy-engine: the tray reaches this file and the
// engine chunk must stay behind sky.ts's dynamic import (the same rule
// types.ts follows for round 1).

/** Chart label language. `la` is the international Latin name, `en` the
 *  descriptive English one — three different words, which is what lets a
 *  question ask for one of them by name. */
export type SkyLang = "en" | "nb" | "la";

export interface Star {
  /** Hipparcos number: the catalogue key, and `hip_<n>` when there is no name. */
  hip: number;
  /** J2000 right ascension, degrees 0–360. */
  ra: number;
  /** J2000 declination, degrees −90–90. */
  dec: number;
  /** Apparent visual magnitude; smaller is brighter. */
  mag: number;
  /** B−V colour index; null where the catalogue has none. */
  bv: number | null;
  /** Proper name, for stars to magnitude 3.0; null for the anonymous field. */
  name: string | null;
  /** Norwegian proper name where it differs from `name`; null otherwise. */
  name_nb: string | null;
}

export interface Constellation {
  /** IAU abbreviation as d3-celestial spells it: "Ori", "UMa". */
  abbr: string;
  name: { la: string; en: string; nb: string };
  /** The figure as unordered HIP pairs, each pair ascending. The answer key. */
  edges: [number, number][];
}

/** Where something is for an observer: degrees. Azimuth is clockwise from north. */
export interface AltAz {
  alt: number;
  az: number;
}

/** An observer preset the ⊕ section offers. */
export interface Place {
  id: string;
  name: { en: string; nb: string };
  lat: number;
  lon: number;
}

/** The drawn dome on the logical canvas, y-up. */
export interface Chart {
  cx: number;
  cy: number;
  r: number;
}

/** The Moon's phase, and where its bright limb points ON THE SKY: a point 5°
 *  from the Moon along the great circle toward the Sun, which the template
 *  projects to get the direction on the page. null at new or full, where the
 *  crescent has no orientation worth drawing. */
export interface MoonLimb {
  fraction: number;
  waxing: boolean;
  toward: AltAz | null;
}

export interface NoteParts {
  daylight: boolean;
  below: string[];
  unknown: string[];
  symbols: boolean;
}

/** The committed table shapes (compact on purpose — 1 040 records). */
export interface StarTable {
  source: string;
  limit_mag: number;
  stars: { i: number; c: [number, number]; m: number; b: number | null; n?: string; nb?: string }[];
}
export interface ConstellationTable {
  source: string;
  constellations: { a: string; la: string; en: string; nb: string; e: [number, number][] }[];
}

/** What a template's `layout` gets as `engines.sky`, and what the ⊕ section reads. */
export interface SkyEngine {
  /** The drawn dome — ONE definition, shared by the template and the tray's click overlay. */
  chart: Chart;
  stars(): Star[];
  star(hip: number): Star | undefined;
  /** By proper name (en or nb), "hip_1234", or a bare HIP number. Case-insensitive. */
  findStar(query: string): Star | undefined;
  constellations(): Constellation[];
  /** By abbreviation, "con_ori", or the Latin, English or Norwegian name. Case-insensitive. */
  findConstellation(query: string): Constellation | undefined;
  /** The distinct stars a figure's edges touch, ascending. */
  edgeStars(c: Constellation): number[];
  /** "now" / an ISO instant / an ISO datetime / a bare date, shifted by hours and days. The pack's only clock for the sky. */
  resolveTime(time: unknown, hours: unknown, days: unknown, lon?: number): Date;
  /** Local solar time at `lon` — what `place_label` writes. */
  localClock(at: Date, lon: number): { date: string; time: string };
  /** Alt/az for every catalogue star, keyed by HIP. Precessed to date. */
  starPositions(at: Date, lat: number, lon: number): Map<number, AltAz>;
  /** Alt/az for the named bodies (round-1 `space` ids), of date, with aberration. */
  bodyPositions(ids: readonly string[], at: Date, lat: number, lon: number): Record<string, AltAz>;
  moonLimb(at: Date, lat: number, lon: number): MoonLimb;
  // ---- the pure rules (sky-rules.ts), reachable from a layout body ----
  project(p: AltAz, chart?: Chart): [number, number];
  starRadius(mag: number): number;
  starColor(bv: number | null): string;
  name(c: Constellation, lang: SkyLang): string;
  starName(s: Star, lang: SkyLang): string | null;
  starId(s: Star): string;
  conId(c: Constellation): string;
  noteClauses(p: NoteParts, lang: SkyLang): string[];
  places(): readonly Place[];
  placeName(p: Place, lang: SkyLang): string;
}
```

- [ ] **Step 4: Write `src/scenes/space/sky-rules.ts`**

```ts
// The sky map's pure rules: the projection, the alt/az transform, the star
// dot's size and tint, the clock, the observer presets and the one foot
// caption's wording. No DOM, no astronomy-engine — the ephemeris lives in
// sky.ts, which is the code-split boundary. A layout body cannot import, so
// the engine re-exposes these as engines.sky.*.

import type {
  Chart, Constellation, ConstellationTable, NoteParts, Place, SkyLang, Star, StarTable, AltAz,
} from "./sky-types";

export const DEG = Math.PI / 180;

/** The drawn dome: the zenith at the centre, the horizon at `r`, on the
 *  1000×750 y-up canvas. The template draws it and the tray's click overlay
 *  reads it, so it is defined once. The numbers leave room for the compass
 *  letters at r + 18 (top 688, bottom 82), the title at y 726 and the two
 *  foot lines at y 52 and y 24 — measured so no two boxes meet. */
export const CHART: Chart = Object.freeze({ cx: 500, cy: 385, r: 285 });

/** The box a `focus` portrait crops to — round 1's frame, same numbers. */
export const FRAME = Object.freeze({ x0: 60, y0: 80, x1: 940, y1: 700 });

/** J2000 → equatorial of date. `rot` is astronomy-engine's Rotation_EQJ_EQD
 *  matrix, whose convention is out[j] = Σᵢ rot[i][j]·in[i]. Twenty-six years
 *  of precession moves a star by about 0.35° — more than a bright star's drawn
 *  radius — for one matrix per frame and nine multiply-adds per star. */
export function precess(rot: readonly (readonly number[])[], raDeg: number, decDeg: number): { ra: number; dec: number } {
  const cd = Math.cos(decDeg * DEG);
  const v0 = cd * Math.cos(raDeg * DEG);
  const v1 = cd * Math.sin(raDeg * DEG);
  const v2 = Math.sin(decDeg * DEG);
  const x = rot[0][0] * v0 + rot[1][0] * v1 + rot[2][0] * v2;
  const y = rot[0][1] * v0 + rot[1][1] * v1 + rot[2][1] * v2;
  const z = rot[0][2] * v0 + rot[1][2] * v1 + rot[2][2] * v2;
  return { ra: (Math.atan2(y, x) / DEG + 360) % 360, dec: Math.asin(Math.max(-1, Math.min(1, z))) / DEG };
}

/** Equatorial of date → horizontal, for latitude `latDeg` at local sidereal
 *  time `lstDeg`. Azimuth is degrees clockwise from north, astronomy-engine's
 *  own convention — and this agrees with its Horizon() to four decimals
 *  (tests/sky-rules.test.ts), at a tenth of a millisecond for a thousand stars. */
export function altAz(raDeg: number, decDeg: number, lstDeg: number, latDeg: number): AltAz {
  const H = ((((lstDeg - raDeg) % 360) + 540) % 360 - 180) * DEG;
  const d = decDeg * DEG, p = latDeg * DEG;
  const sd = Math.sin(d), cd = Math.cos(d), sp = Math.sin(p), cp = Math.cos(p), ch = Math.cos(H);
  const alt = Math.asin(Math.max(-1, Math.min(1, sd * sp + cd * cp * ch))) / DEG;
  let az = Math.atan2(-Math.sin(H) * cd, sd * cp - cd * sp * ch) / DEG;
  if (az < 0) az += 360;
  return { alt, az };
}

/** Stereographic from the zenith, onto the y-up canvas: north at the top,
 *  EAST ON THE LEFT. A planisphere is held overhead and you look up through
 *  it, so east and west are swapped against a map of the ground. alt 90 → the
 *  centre; alt 0 → the horizon circle; alt < 0 → outside it, which is how the
 *  template omits what has set. */
export function project(p: AltAz, chart: Chart = CHART): [number, number] {
  const r = chart.r * Math.tan(((90 - p.alt) * DEG) / 2);
  return [chart.cx - r * Math.sin(p.az * DEG), chart.cy + r * Math.cos(p.az * DEG)];
}

/** Dot radius by magnitude, ABSOLUTE rather than relative to `limit_mag`: a
 *  star must not change size because the author asked for a fainter chart.
 *  Sirius (−1.46) 4.9, Vega (0.03) 4.0, mag 2 → 2.8, mag 4 → 1.5, floor 1.3
 *  (still ink at the size the page is drawn), cap 5.4. */
export function starRadius(mag: number): number {
  return Math.max(1.3, Math.min(5.4, 4.0 - 0.62 * mag));
}

/** B−V → ink. The chart is dark marks on warm paper (kit.GROUND #faf6ec), so
 *  a star's colour is a TINT of the ink, not the star's own light: a pale blue
 *  dot on cream would be invisible. Every tint clears 4.5:1 against the paper
 *  — measured, not guessed (tests/sky-rules.test.ts recomputes them). */
export const STAR_TINTS: readonly { max: number; color: string }[] = Object.freeze([
  { max: 0.0, color: "#42618c" },   // blue        5.86:1
  { max: 0.3, color: "#4f6f8e" },   // blue-white  4.87:1
  { max: 0.6, color: "#66697a" },   // white       5.03:1
  { max: 1.0, color: "#7d6540" },   // yellow      5.11:1
  { max: 1.5, color: "#8d5932" },   // orange      5.39:1
  { max: Infinity, color: "#94472a" }, // red      6.09:1
]);

/** A star with no colour index is drawn neutral — the "white" band. */
export function starColor(bv: number | null): string {
  const v = bv === null ? 0.45 : bv;
  for (const t of STAR_TINTS) if (v < t.max) return t.color;
  return STAR_TINTS[STAR_TINTS.length - 1].color;
}

const HOUR_MS = 3600000;
const DAY_MS = 86400000;

/**
 * The pack's ONE clock for the sky. "now" — or anything unusable — is the real
 * moment; an ISO datetime carrying an offset or a Z is that instant; one
 * without is read as UTC; a bare date is 22:00 LOCAL SOLAR time at `lon`
 * (UTC + lon/15 hours), which needs no timezone table, is deterministic, and
 * lands within a few minutes of the clock on the wall inside a zone. `hours`
 * and `days` then shift it, fractions allowed — they are the animatable handles.
 */
export function resolveTime(time: unknown, hours: unknown, days: unknown, lon = 0, now: Date = new Date()): Date {
  const s = typeof time === "string" ? time.trim() : "";
  const full = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?(Z|[+-]\d{2}:?\d{2})?$/.exec(s);
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  let ms: number;
  if (full) {
    ms = full[7] ? Date.parse(s.replace(" ", "T")) : Date.UTC(+full[1], +full[2] - 1, +full[3], +full[4], +full[5], +(full[6] ?? 0));
  } else if (dateOnly) {
    ms = Date.UTC(+dateOnly[1], +dateOnly[2] - 1, +dateOnly[3]) + (22 - lon / 15) * HOUR_MS;
  } else {
    ms = now.getTime();
  }
  if (!Number.isFinite(ms)) ms = now.getTime();
  const h = typeof hours === "number" && Number.isFinite(hours) ? hours : 0;
  const d = typeof days === "number" && Number.isFinite(days) ? days : 0;
  return new Date(ms + h * HOUR_MS + d * DAY_MS);
}

/** What `place_label` writes: local SOLAR time at `lon`. Same reasoning as
 *  the bare-date rule above — no timezone table, and honest about being solar. */
export function localClock(at: Date, lon: number): { date: string; time: string } {
  const d = new Date(at.getTime() + (lon / 15) * HOUR_MS);
  const p = (n: number): string => String(n).padStart(2, "0");
  return {
    date: `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`,
    time: `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`,
  };
}

/**
 * The figure's ONE caption, as clauses in the order they matter. The template
 * joins them with " · " and drops from the END while the line is too wide,
 * which is why the cheapest clause is last. Round 1's known limit was two
 * captions colliding in the same foot strip; one caption cannot collide with
 * itself.
 */
export function noteClauses(p: NoteParts, lang: SkyLang): string[] {
  const nb = lang === "nb";
  const out: string[] = [];
  if (p.daylight) out.push(nb ? "Sola er oppe — stjernene er der, men du kan ikke se dem" : "The Sun is up — these stars are there, but you cannot see them");
  if (p.below.length > 0) out.push((nb ? "Under horisonten: " : "Below the horizon: ") + p.below.join(", "));
  if (p.unknown.length > 0) out.push((nb ? "Ukjent: " : "Unknown: ") + p.unknown.join(", "));
  if (p.symbols) out.push(nb ? "Sol, måne og planeter som symboler, ikke i målestokk" : "Sun, Moon and planets as symbols, not to scale");
  return out;
}

export function constellationName(c: Constellation, lang: SkyLang): string {
  return lang === "nb" ? c.name.nb : lang === "la" ? c.name.la : c.name.en;
}

/** The proper name, or null for the anonymous field. Norwegian only where it
 *  differs — most star names are the same word in every language. */
export function starName(s: Star, lang: SkyLang): string | null {
  if (!s.name) return null;
  return lang === "nb" && s.name_nb ? s.name_nb : s.name;
}

export function starId(s: Star): string {
  return s.name ? s.name.toLowerCase().replace(/\s+/g, "_") : `hip_${s.hip}`;
}

export function conId(c: Constellation): string {
  return `con_${c.abbr.toLowerCase()}`;
}

export function edgeStars(c: Constellation): number[] {
  return [...new Set(c.edges.flat())].sort((a, b) => a - b);
}

export const PLACES: readonly Place[] = Object.freeze([
  { id: "oslo", name: { en: "Oslo", nb: "Oslo" }, lat: 59.91, lon: 10.75 },
  { id: "bergen", name: { en: "Bergen", nb: "Bergen" }, lat: 60.39, lon: 5.32 },
  { id: "tromso", name: { en: "Tromsø", nb: "Tromsø" }, lat: 69.65, lon: 18.96 },
  { id: "equator", name: { en: "The equator", nb: "Ekvator" }, lat: 0, lon: 0 },
]);

export function placeName(p: Place, lang: SkyLang): string {
  return lang === "nb" ? p.name.nb : p.name.en;
}

export function expandStars(t: StarTable): Star[] {
  return t.stars.map((s) => ({
    hip: s.i,
    ra: s.c[0],
    dec: s.c[1],
    mag: s.m,
    bv: s.b,
    name: s.n ?? null,
    name_nb: s.nb ?? null,
  }));
}

export function expandConstellations(t: ConstellationTable): Constellation[] {
  return t.constellations.map((c) => ({ abbr: c.a, name: { la: c.la, en: c.en, nb: c.nb }, edges: c.e }));
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run tests/sky-rules.test.ts`
Expected: PASS, 18 tests.

If the bare-date test is off by a minute, the cause is `(22 - lon / 15) * HOUR_MS` producing a fractional millisecond — round it: `Math.round((22 - lon / 15) * HOUR_MS)`. Do not change the 22.

Run: `npx tsc --noEmit`
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add src/scenes/space/sky-types.ts src/scenes/space/sky-rules.ts tests/sky-rules.test.ts
git commit -m "The sky's pure half: a planisphere is held overhead, so east is on the left

The projection and the alt/az transform are ten lines of arithmetic rather
than d3-geo, and they are not an approximation: measured against
astronomy-engine's own Horizon(), they agree to four decimal places, at a
tenth of a millisecond for a thousand stars. Star tints are a tint of the ink,
not of starlight — a pale blue dot on cream paper is not visible, and every
one of the six clears 4.5:1 against the figure's ground.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01RWSwWnc8ToCq7H2pXdvXHY"
```

---

### Task 3: The `sky` engine, and the lists a new engine must join

**Files:**
- Create: `src/scenes/space/sky.ts`
- Modify: `src/scenes/engines.ts` (`KNOWN_ENGINES` at line 32; a `loadSky` beside `loadSpace` at line 672; `ENGINE_DEFS` at line 677; the type import/re-export at lines 29-30)
- Modify: `src/llm/author.ts:77` (the `engines` enum)
- Modify: `tests/author.test.ts:99` (its copy of that enum)
- Modify: `tests/engines.test.ts:147-153` (the `KNOWN_ENGINES` roll-call)
- Test: `tests/sky-engine.test.ts`

**Interfaces:**
- Consumes: `expandStars`, `expandConstellations`, `precess`, `altAz`, `project`, `starRadius`, `starColor`, `starId`, `conId`, `edgeStars`, `constellationName`, `starName`, `noteClauses`, `placeName`, `PLACES`, `CHART`, `DEG`, `resolveTime`, `localClock` (Task 2); the two JSON tables (Task 1).
- Produces: `makeSkyEngine(starTable: StarTable, conTable: ConstellationTable): SkyEngine`, and `engines.sky` reachable from a pack layout. Task 4 uses every member of `SkyEngine`; Task 6 uses `chart`, `project`, `starPositions`, `findStar`, `findConstellation`, `resolveTime`, `localClock`, `places`.

**Not to be changed, and here is why** — `tests/molecule3d.test.ts` and `tests/pack-defaults.test.ts` need no edit. molecule3d derives the engines it preloads from the manifests of the specs the examples actually use (`ensureEnginesForSpecs`, `tests/molecule3d.test.ts:254`), and pack-defaults derives its expectation from `PACK_DEFS` minus `DEFAULT_OFF_PACKS`. The `space` pack is already in `DEFAULT_SETTINGS.enabledPacks` (`src/store.ts:195`) from round 1, so a second template in it enables itself. Do not add a line to either file.

- [ ] **Step 1: Write the failing test**

`tests/sky-engine.test.ts`:

```ts
// engines.sky: the committed tables plus astronomy-engine, behind one
// interface. What is checked here is that the ephemeris half agrees with
// astronomy-engine's own answers, and that the lookups are as forgiving as a
// model's spelling requires.

import { beforeAll, describe, expect, test } from "vitest";
import * as A from "astronomy-engine";
import { ENGINE_DEFS, KNOWN_ENGINES, ensureEngines, getLoadedEngines } from "../src/scenes/engines";
import { TEMPLATE_DOC_API_SCHEMA } from "../src/llm/author";
import type { AltAz, SkyEngine } from "../src/scenes/space/sky-types";

let sky: SkyEngine;
const OSLO = { lat: 59.91, lon: 10.75 };
const AT = new Date("2026-09-07T21:00:00Z");

beforeAll(async () => {
  await ensureEngines(["sky"]);
  sky = getLoadedEngines(["sky"]).sky as SkyEngine;
});

/** Angular separation of two horizontal positions, degrees. */
function sep(a: AltAz, b: AltAz): number {
  const d = Math.PI / 180;
  const v = (p: AltAz): number[] => [Math.cos(p.alt * d) * Math.cos(p.az * d), Math.cos(p.alt * d) * Math.sin(p.az * d), Math.sin(p.alt * d)];
  const [x, y] = [v(a), v(b)];
  return Math.acos(Math.max(-1, Math.min(1, x[0] * y[0] + x[1] * y[1] + x[2] * y[2]))) / d;
}

describe("registration", () => {
  test("sky joins the known engines, the loader table and the authoring schema", () => {
    expect(KNOWN_ENGINES).toContain("sky");
    expect(ENGINE_DEFS.sky).toBeDefined();
    expect(TEMPLATE_DOC_API_SCHEMA.properties.engines.items.enum).toEqual([...KNOWN_ENGINES]);
  });
});

describe("the tables, and finding things in them", () => {
  test("the whole bundled sky is there, and the chart is defined once", () => {
    expect(sky.stars().length).toBeGreaterThanOrEqual(1000);
    expect(sky.constellations()).toHaveLength(88);
    expect(sky.chart).toEqual({ cx: 500, cy: 385, r: 285 });
  });

  test("a star answers to its name, its id and its number", () => {
    const sirius = sky.findStar("Sirius")!;
    expect(sirius).toBeDefined();
    expect(sky.findStar("sirius")).toBe(sirius);
    expect(sky.findStar(`hip_${sirius.hip}`)).toBe(sirius);
    expect(sky.findStar(String(sirius.hip))).toBe(sirius);
    expect(sky.star(sirius.hip)).toBe(sirius);
    expect(sky.findStar("Polarstjernen")!.name).toBe("Polaris");
    expect(sky.findStar("krypton")).toBeUndefined();
  });

  test("a constellation answers to its abbreviation, its id and all three names", () => {
    const uma = sky.findConstellation("UMa")!;
    for (const q of ["uma", "con_uma", "Ursa Major", "The Great Bear", "store bjørn"]) {
      expect(sky.findConstellation(q), q).toBe(uma);
    }
    expect(sky.conId(uma)).toBe("con_uma");
    expect(sky.name(uma, "nb")).toBe("Store bjørn");
    expect(sky.findConstellation("Krypton")).toBeUndefined();
  });

  test("a figure's own stars are all in the table", () => {
    const ori = sky.findConstellation("Orion")!;
    const hips = sky.edgeStars(ori);
    expect(hips.length).toBeGreaterThanOrEqual(15);
    for (const h of hips) expect(sky.star(h), `HIP ${h}`).toBeDefined();
  });
});

describe("where things are", () => {
  test("every star gets an alt/az, and they match astronomy-engine's own Horizon()", () => {
    const pos = sky.starPositions(AT, OSLO.lat, OSLO.lon);
    expect(pos.size).toBe(sky.stars().length);
    const obs = new A.Observer(OSLO.lat, OSLO.lon, 0);
    for (const name of ["Sirius", "Vega", "Polaris"]) {
      const s = sky.findStar(name)!;
      // Precess by astronomy-engine's OWN path, then ask its own Horizon() —
      // so this compares two independent routes, not a formula with itself.
      const sph = A.SphereFromVector(A.RotateVector(A.Rotation_EQJ_EQD(AT), A.VectorFromSphere(new A.Spherical(s.dec, s.ra, 1), AT)));
      const theirs = A.Horizon(AT, obs, sph.lon / 15, sph.lat, "");
      const mine = pos.get(s.hip)!;
      expect(mine.alt, name).toBeCloseTo(theirs.altitude, 3);
      expect(mine.az, name).toBeCloseTo(theirs.azimuth, 3);
    }
  });

  test("Polaris stands at the observer's latitude, from Oslo, Tromsø and the equator", () => {
    const s = sky.findStar("Polaris")!;
    for (const p of [{ lat: 59.91, lon: 10.75 }, { lat: 69.65, lon: 18.96 }]) {
      expect(sky.starPositions(AT, p.lat, p.lon).get(s.hip)!.alt, String(p.lat)).toBeCloseTo(p.lat, 0);
    }
    expect(Math.abs(sky.starPositions(AT, 0, 0).get(s.hip)!.alt)).toBeLessThan(1.5);
  });

  test("the Sun, Moon and planets agree with Equator → Horizon", () => {
    const got = sky.bodyPositions(["sun", "moon", "jupiter", "saturn"], AT, OSLO.lat, OSLO.lon);
    const obs = new A.Observer(OSLO.lat, OSLO.lon, 0);
    for (const [id, body] of [["sun", A.Body.Sun], ["moon", A.Body.Moon], ["jupiter", A.Body.Jupiter], ["saturn", A.Body.Saturn]] as const) {
      const eq = A.Equator(body, AT, obs, true, true);
      const theirs = A.Horizon(AT, obs, eq.ra, eq.dec, "");
      expect(got[id].alt, id).toBeCloseTo(theirs.altitude, 4);
      expect(got[id].az, id).toBeCloseTo(theirs.azimuth, 4);
    }
    // An id that is not a naked-eye body is left out, not faked.
    expect(sky.bodyPositions(["krypton", "io"], AT, OSLO.lat, OSLO.lon)).toEqual({});
  });

  test("the Sun is high at midday and below the horizon at midnight", () => {
    const noon = sky.bodyPositions(["sun"], new Date("2026-06-21T10:00:00Z"), OSLO.lat, OSLO.lon).sun;
    const night = sky.bodyPositions(["sun"], new Date("2026-12-21T23:00:00Z"), OSLO.lat, OSLO.lon).sun;
    expect(noon.alt).toBeGreaterThan(40);
    expect(noon.az).toBeGreaterThan(120);   // south-ish at local noon from 60°N
    expect(noon.az).toBeLessThan(240);
    expect(night.alt).toBeLessThan(0);
  });

  test("a thousand stars cost well under a frame", () => {
    const t0 = performance.now();
    for (let i = 0; i < 20; i++) sky.starPositions(new Date(AT.getTime() + i * 3600000), OSLO.lat, OSLO.lon);
    expect((performance.now() - t0) / 20).toBeLessThan(5);
  });
});

describe("the Moon's phase", () => {
  test("the illuminated fraction is astronomy-engine's, and waxing follows the phase angle", () => {
    const m = sky.moonLimb(AT, OSLO.lat, OSLO.lon);
    expect(m.fraction).toBeCloseTo(A.Illumination(A.Body.Moon, AT).phase_fraction, 6);
    expect(m.waxing).toBe(A.MoonPhase(AT) < 180);
  });

  test("the bright limb points at the Sun, 5° away from the Moon", () => {
    const at = new Date("2026-09-20T20:00:00Z");
    const m = sky.moonLimb(at, OSLO.lat, OSLO.lon);
    expect(m.toward).not.toBeNull();
    const p = sky.bodyPositions(["moon", "sun"], at, OSLO.lat, OSLO.lon);
    expect(sep(p.moon, m.toward!)).toBeCloseTo(5, 1);
    // Stepping toward the Sun really does get closer to it.
    expect(sep(m.toward!, p.sun)).toBeLessThan(sep(p.moon, p.sun));
  });

  test("at new and full there is no direction worth drawing", () => {
    // Ask astronomy-engine for a real new moon rather than guessing a date.
    const newMoon = A.SearchMoonPhase(0, new Date("2026-09-01T00:00:00Z"), 40)!.date;
    expect(sky.moonLimb(newMoon, OSLO.lat, OSLO.lon).toward).toBeNull();
    expect(sky.moonLimb(newMoon, OSLO.lat, OSLO.lon).fraction).toBeLessThan(0.01);
    const full = A.SearchMoonPhase(180, new Date("2026-09-01T00:00:00Z"), 40)!.date;
    expect(sky.moonLimb(full, OSLO.lat, OSLO.lon).toward).toBeNull();
    expect(sky.moonLimb(full, OSLO.lat, OSLO.lon).fraction).toBeGreaterThan(0.99);
  });
});

describe("the code-split boundary", () => {
  test("the light half never pulls astronomy-engine in", async () => {
    const { readFileSync } = await import("node:fs");
    for (const f of ["sky-rules.ts", "sky-types.ts"]) {
      const src = readFileSync(new URL(`../src/scenes/space/${f}`, import.meta.url), "utf8");
      expect(src, f).not.toMatch(/astronomy-engine/);
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/sky-engine.test.ts`
Expected: FAIL — `unknown engine "sky"` thrown by `ensureEngines`.

- [ ] **Step 3: Write `src/scenes/space/sky.ts`**

```ts
// The object a layout sees as `engines.sky`: the committed star and
// constellation tables, the ephemeris for the Sun, Moon and planets, and the
// pure rules, behind one interface. Built by engines.ts's loadSky.
//
// THIS FILE IS THE CODE-SPLIT BOUNDARY. It imports astronomy-engine
// statically, so nothing the main chunk reaches may import it — sky-types.ts
// and sky-rules.ts are the light half the tray uses. The same rule
// space/engine.ts follows for round 1.

import * as AstroNs from "astronomy-engine";
import {
  CHART, DEG, PLACES, altAz, conId, constellationName, edgeStars, expandConstellations, expandStars,
  localClock, noteClauses, placeName, precess, project, resolveTime, starColor, starId, starName, starRadius,
} from "./sky-rules";
import type { AltAz, Constellation, ConstellationTable, SkyEngine, Star, StarTable } from "./sky-types";

// astronomy-engine ships CommonJS; Vite prebundles named exports, Node's ESM
// interop may hand them over under `default`. One shim, both worlds — the same
// one ephemeris.ts uses.
const A: typeof AstroNs = (AstroNs as { HelioVector?: unknown }).HelioVector ? AstroNs : ((AstroNs as { default?: typeof AstroNs }).default as typeof AstroNs);

/** The bodies a sky chart can mark, by their round-1 `space` ids. Everything
 *  else — a moon, a dwarf planet — is left out rather than faked: nothing but
 *  these has a naked-eye place in the sky worth drawing. */
const ASTRO_BODY: Record<string, AstroNs.Body> = {
  sun: A.Body.Sun,
  moon: A.Body.Moon,
  mercury: A.Body.Mercury,
  venus: A.Body.Venus,
  mars: A.Body.Mars,
  jupiter: A.Body.Jupiter,
  saturn: A.Body.Saturn,
  uranus: A.Body.Uranus,
  neptune: A.Body.Neptune,
};

/** Local apparent sidereal time in degrees — the one number the whole chart
 *  turns on. SiderealTime is Greenwich, in hours; longitude east adds lon/15. */
function lstDeg(at: Date, lon: number): number {
  return (((A.SiderealTime(at) + lon / 15) * 15) % 360 + 360) % 360;
}

const unit = (raDeg: number, decDeg: number): [number, number, number] => {
  const cd = Math.cos(decDeg * DEG);
  return [cd * Math.cos(raDeg * DEG), cd * Math.sin(raDeg * DEG), Math.sin(decDeg * DEG)];
};

export function makeSkyEngine(starTable: StarTable, conTable: ConstellationTable): SkyEngine {
  const stars = expandStars(starTable);
  const cons = expandConstellations(conTable);
  const byHip = new Map(stars.map((s) => [s.hip, s]));

  // One index per lookup, built once: a model spells a star four ways and a
  // constellation five, and a chart that answered to only one of them would
  // send half of them to the "unknown" clause of its own caption.
  const starIndex = new Map<string, Star>();
  const put = (k: string | number, s: Star): void => {
    const key = String(k).trim().toLowerCase();
    if (key !== "" && !starIndex.has(key)) starIndex.set(key, s);
  };
  for (const s of stars) {
    put(s.hip, s);
    put(`hip_${s.hip}`, s);
    if (s.name) { put(s.name, s); put(starId(s), s); }
    if (s.name_nb) put(s.name_nb, s);
  }
  const conIndex = new Map<string, Constellation>();
  for (const c of cons) {
    for (const k of [c.abbr, conId(c), c.name.la, c.name.en, c.name.nb]) {
      const key = k.trim().toLowerCase();
      if (!conIndex.has(key)) conIndex.set(key, c);
    }
  }

  return {
    chart: CHART,
    stars: () => stars,
    star: (hip) => byHip.get(hip),
    findStar: (q) => (typeof q === "string" ? starIndex.get(q.trim().toLowerCase()) : undefined),
    constellations: () => cons,
    findConstellation: (q) => (typeof q === "string" ? conIndex.get(q.trim().toLowerCase()) : undefined),
    edgeStars,
    resolveTime,
    localClock,

    starPositions(at, lat, lon) {
      // One precession matrix and one sidereal time per frame; nine
      // multiply-adds and two trig calls per star after that. Measured: 0.3 ms
      // for the whole catalogue, where a per-star Horizon() call is not.
      const rot = A.Rotation_EQJ_EQD(at).rot;
      const lst = lstDeg(at, lon);
      const out = new Map<number, AltAz>();
      for (const s of stars) {
        const d = precess(rot, s.ra, s.dec);
        out.set(s.hip, altAz(d.ra, d.dec, lst, lat));
      }
      return out;
    },

    bodyPositions(ids, at, lat, lon) {
      // Equator of date WITH aberration and a real observer, so the Moon's
      // parallax — about a degree — is in; then the same altAz the stars use,
      // so one transform draws the whole chart.
      const obs = new A.Observer(lat, lon, 0);
      const lst = lstDeg(at, lon);
      const out: Record<string, AltAz> = {};
      for (const id of ids) {
        const body = ASTRO_BODY[id];
        if (body === undefined) continue;
        const eq = A.Equator(body, at, obs, true, true);
        out[id] = altAz(eq.ra * 15, eq.dec, lst, lat);
      }
      return out;
    },

    moonLimb(at, lat, lon) {
      const obs = new A.Observer(lat, lon, 0);
      const lst = lstDeg(at, lon);
      const eqM = A.Equator(A.Body.Moon, at, obs, true, true);
      const eqS = A.Equator(A.Body.Sun, at, obs, true, true);
      const m = unit(eqM.ra * 15, eqM.dec);
      const s = unit(eqS.ra * 15, eqS.dec);
      const dot = m[0] * s[0] + m[1] * s[1] + m[2] * s[2];
      let toward: AltAz | null = null;
      // At new and full the Sun and Moon are (anti)parallel and the bright
      // limb has no direction at all — the drawn shape there is a full disc or
      // a bare rim, neither of which needs one.
      if (Math.abs(dot) < 0.9995) {
        const t = [s[0] - dot * m[0], s[1] - dot * m[1], s[2] - dot * m[2]];
        const len = Math.hypot(t[0], t[1], t[2]);
        const c5 = Math.cos(5 * DEG), s5 = Math.sin(5 * DEG);
        const p = [0, 1, 2].map((i) => m[i] * c5 + (t[i] / len) * s5);
        const ra = (Math.atan2(p[1], p[0]) / DEG + 360) % 360;
        const dec = Math.asin(Math.max(-1, Math.min(1, p[2]))) / DEG;
        toward = altAz(ra, dec, lst, lat);
      }
      return { fraction: A.Illumination(A.Body.Moon, at).phase_fraction, waxing: A.MoonPhase(at) < 180, toward };
    },

    project,
    starRadius,
    starColor,
    name: constellationName,
    starName,
    starId,
    conId,
    noteClauses,
    places: () => PLACES,
    placeName,
  };
}
```

- [ ] **Step 4: Add the loader to `src/scenes/engines.ts`**

Beside the round-1 space type imports (lines 29-30):

```ts
import type { ConstellationTable, SkyEngine, StarTable } from "./space/sky-types";
export type { SkyEngine } from "./space/sky-types";
```

Line 32 becomes:

```ts
export const KNOWN_ENGINES = ["smilesdrawer", "mathjax", "chess", "geo", "anatomy", "elements", "space", "sky"] as const;
```

Immediately after `loadSpace` (line 675):

```ts
/** The night sky: two committed tables (69 KB) and astronomy-engine in one
 *  lazy chunk. A SECOND engine rather than a bigger `space` one, because
 *  engines load per template and folding the star tables into `space` would
 *  charge every solar_system figure for a sky it never draws. sky.ts imports
 *  astronomy-engine statically, so the dynamic import of sky.ts IS the
 *  code-split boundary — never import ./space/sky from anywhere the main
 *  chunk reaches; sky-types.ts and sky-rules.ts are the light half. */
async function loadSky(): Promise<SkyEngine> {
  const [{ makeSkyEngine }, starsMod, consMod] = await Promise.all([
    import("./space/sky"),
    import("./space/sky/stars.json"),
    import("./space/sky/constellations.json"),
  ]);
  return makeSkyEngine(starsMod.default as unknown as StarTable, consMod.default as unknown as ConstellationTable);
}
```

And `ENGINE_DEFS` gains, after `space`:

```ts
  sky: { load: loadSky },
```

- [ ] **Step 5: Teach the three hand-made lists**

`src/llm/author.ts:77` — the enum whose own comment says it must stay in step with `KNOWN_ENGINES`:

```ts
    engines: { type: "array", items: { type: "string", enum: ["smilesdrawer", "mathjax", "chess", "geo", "anatomy", "elements", "space", "sky"] } },
```

`tests/author.test.ts:99` — its copy:

```ts
      items: { type: "string", enum: ["smilesdrawer", "mathjax", "chess", "geo", "anatomy", "elements", "space", "sky"] },
```

`tests/engines.test.ts:147-153` — the roll-call, renamed and extended:

```ts
test("KNOWN_ENGINES lists smilesdrawer, mathjax, chess, geo, anatomy, space and sky", () => {
  expect(KNOWN_ENGINES).toContain("smilesdrawer");
  expect(KNOWN_ENGINES).toContain("mathjax");
  expect(KNOWN_ENGINES).toContain("chess");
  expect(KNOWN_ENGINES).toContain("geo");
  expect(KNOWN_ENGINES).toContain("anatomy");
  expect(KNOWN_ENGINES).toContain("space");
  expect(KNOWN_ENGINES).toContain("sky");
});
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run tests/sky-engine.test.ts tests/engines.test.ts tests/author.test.ts`
Expected: PASS, all three files.

Run: `npx tsc --noEmit`
Expected: no output.

- [ ] **Step 7: Prove the chunk boundary in the real build**

Run: `npm run build`
Then: `grep -l "Rotation_EQJ_EQD" dist/assets/*.js`
Expected: exactly one file, an `engine-*.js` chunk — never `index-*.js`. If the main chunk matches, something reachable from `src/main.ts` is importing `./space/sky` statically; find it with `grep -rn "space/sky\"" src/` and move that import to `sky-types` or `sky-rules`.

- [ ] **Step 8: Commit**

```bash
git add src/scenes/space/sky.ts src/scenes/engines.ts src/llm/author.ts tests/sky-engine.test.ts tests/engines.test.ts tests/author.test.ts
git commit -m "A second engine for the sky, so a solar system never pays for stars

Engines load per template, all or nothing, so folding 69 KB of star tables
into the space engine would charge every solar_system figure for a sky it
does not draw. sky.ts is the boundary: it imports astronomy-engine, the light
half beside it does not, and the tray only ever reaches the light half.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01RWSwWnc8ToCq7H2pXdvXHY"
```

---

### Task 4: `sky_map` — the dome, the stars, and the Moon with its phase drawn

The chart without its constellation figures: the horizon, the compass, the star field, the Sun, Moon and planets where they really are, one caption, one bundled example. Task 5 adds the figures and the names on top of a template that is already lint-clean over a year of timestamps.

**Files:**
- Modify: `src/scenes/packs/space.yaml` (a second `---` document after `solar_system`)
- Modify: `src/examples.json` (one bundled example — a template may not register without one)
- Modify: `tests/space-template.test.ts:39` (`templateIds` is now two)
- Test: `tests/sky-template.test.ts`, `tests/sky-hit.test.ts`

**Interfaces:**
- Consumes: `engines.sky` (Task 3) and `engines.space` (round 1, for the body table's names and colours).
- Produces: the template id `sky_map`; the element ids `horizon`, `compass_n/e/s/w`, `stars`, `place_label`, `sky_note`, `title`, plus a body id per drawn body, `label_<body>`, and — for anything named in `mark` or `highlight` — a star's own id and `label_<star>`. Task 5 adds `figures`, `con_<abbr>`, `label_con_<abbr>`, `frame` and `hip_<n>`; Task 6 reads `engines.sky.chart` to hit-test the same picture.

- [ ] **Step 1: Write the failing test**

`tests/sky-template.test.ts` (Task 5 appends to this file; write these describes now):

```ts
// sky_map: the sky over a place at a moment. Every geometric claim here is
// checkable against the projection's own definition — the zenith is the
// centre, the horizon is the rim, north is up and east is on the LEFT.
//
// `issues`, not `warnings`. `warnings` carries the layout's own complaints and
// is empty for a template that never complains; `issues` is what the bundled-
// examples guard asserts, and it is where round 1's two label defects lived.

import { beforeAll, describe, expect, test } from "vitest";
import spaceYaml from "../src/scenes/packs/space.yaml?raw";
import { registerPack, unregisterPack } from "../src/scenes/packs";
import { scenes } from "../src/scenes/registry";
import { ensureEngines, getLoadedEngines } from "../src/scenes/engines";
import { elementBBoxes, elementRings, layoutSpec } from "../src/layout/layout";
import { flattenDrawables, type Drawable, type StrokeDrawable, type TextDrawable } from "../src/layout/model";
import type { SkyEngine } from "../src/scenes/space/sky-types";

const AT = "2026-09-07T21:00:00Z";
const lay = (params: Record<string, unknown>) => scenes.sky_map.layout!({ time: AT, ...params });
const spec = (params: Record<string, unknown>) => ({ template: "sky_map", params: { time: AT, ...params }, elements: [] }) as never;
const idsOf = (params: Record<string, unknown>) => lay(params).order;
const leaf = (r: ReturnType<typeof lay>, id: string): Drawable | undefined => flattenDrawables(r.drawables).find((d) => d.id === id);
const textOf = (r: ReturnType<typeof lay>, id: string): string | undefined => {
  const d = leaf(r, id);
  return d && d.kind === "text" ? d.text : undefined;
};
let sky: SkyEngine;

beforeAll(async () => {
  await ensureEngines(["space", "sky"]);
  sky = getLoadedEngines(["sky"]).sky as SkyEngine;
  unregisterPack("space");
  registerPack("space", spaceYaml);
});

describe("sky_map: registration and the default figure", () => {
  test("the space pack now registers two templates", () => {
    unregisterPack("space");
    expect(registerPack("space", spaceYaml)).toMatchObject({ ok: true, templateIds: ["solar_system", "sky_map"] });
  });

  test("draws a dome: the horizon, four compass points, a star field, a place and a caption", () => {
    const ids = idsOf({});
    for (const id of ["horizon", "compass_n", "compass_e", "compass_s", "compass_w", "stars", "place_label"]) {
      expect(ids, id).toContain(id);
    }
    expect(textOf(lay({}), "place_label")).toBe("Oslo · 2026-09-07 21:43");
  });

  test("the same params and the same moment give byte-identical layouts", () => {
    expect(JSON.stringify(lay({}))).toBe(JSON.stringify(lay({})));
  });

  test("the compass sits where the projection says it does — and EAST IS ON THE LEFT", () => {
    const r = lay({});
    const at = (id: string): [number, number] => (leaf(r, id) as TextDrawable).pos;
    const c = sky.chart;
    expect(at("compass_n")[1]).toBeGreaterThan(c.cy);
    expect(at("compass_s")[1]).toBeLessThan(c.cy);
    expect(at("compass_e")[0]).toBeLessThan(c.cx);
    expect(at("compass_w")[0]).toBeGreaterThan(c.cx);
    expect(textOf(r, "compass_e")).toBe("E");
    expect(textOf(lay({ names: "nb" }), "compass_e")).toBe("Ø");
  });

  test("the horizon is a circle, and it owns no clicks — it is an edge, not a region", () => {
    const h = leaf(lay({}), "horizon") as StrokeDrawable;
    expect(h.kind).toBe("stroke");
    expect(h.closed).not.toBe(true);
    const rr = h.pts.map((p) => Math.hypot(p[0] - sky.chart.cx, p[1] - sky.chart.cy));
    expect(Math.max(...rr) - Math.min(...rr)).toBeLessThan(0.001);
    expect(Math.max(...rr)).toBeCloseTo(sky.chart.r, 6);
    // …and it closes: the last point is the first, so it draws as a ring.
    expect(h.pts[0]).toEqual(h.pts[h.pts.length - 1]);
  });

  test("every drawn star is above the horizon, and inside the circle", () => {
    const r = lay({});
    const pos = sky.starPositions(new Date(AT), 59.91, 10.75);
    const dots = flattenDrawables(r.drawables).filter((d) => d.id.startsWith("stars__hip_")) as StrokeDrawable[];
    expect(dots.length).toBeGreaterThan(150);
    for (const d of dots) {
      const hip = Number(d.id.replace("stars__hip_", ""));
      expect(pos.get(hip)!.alt, `HIP ${hip}`).toBeGreaterThanOrEqual(0);
      const c = d.shapeHint!.type === "circle" ? d.shapeHint.c : d.pts[0];
      expect(Math.hypot(c[0] - sky.chart.cx, c[1] - sky.chart.cy)).toBeLessThanOrEqual(sky.chart.r + 0.001);
    }
  });

  test("a brighter star is a bigger dot", () => {
    const r = lay({});
    const dots = (flattenDrawables(r.drawables).filter((d) => d.id.startsWith("stars__hip_")) as StrokeDrawable[])
      .map((d) => ({ hip: Number(d.id.replace("stars__hip_", "")), r: d.shapeHint!.type === "circle" ? d.shapeHint.r : 0 }));
    const withMag = dots.map((d) => ({ ...d, m: sky.star(d.hip)!.mag })).sort((a, b) => a.m - b.m);
    expect(withMag[0].r).toBeGreaterThan(withMag[withMag.length - 1].r);
  });

  test("limit_mag thins the field without moving the stars that stay", () => {
    const count = (limit?: number) => flattenDrawables(lay(limit === undefined ? {} : { limit_mag: limit }).drawables).filter((d) => d.id.startsWith("stars__hip_")).length;
    expect(count(2)).toBeLessThan(count(4.5));
    expect(count(2)).toBeGreaterThan(5);
    const bright = (limit: number) => {
      const d = flattenDrawables(lay({ limit_mag: limit }).drawables).find((x) => x.id.startsWith("stars__hip_")) as StrokeDrawable;
      return d.shapeHint!.type === "circle" ? d.shapeHint.r : 0;
    };
    // A star does not shrink because the author asked for a fainter chart.
    expect(bright(2)).toBe(bright(4.5));
  });

  test("the star field draws in a couple of seconds however many stars there are", () => {
    // A group's leaf durations ACCUMULATE (src/render/svg-backend.ts:583-589),
    // so 400 dots at SKETCH_MS.dot would take 168 seconds.
    const total = flattenDrawables(lay({}).drawables)
      .filter((d) => d.id.startsWith("stars__hip_"))
      .reduce((n, d) => n + d.drawOpts.duration, 0);
    expect(total).toBeLessThan(4000);
    expect(total).toBeGreaterThan(200);
  });
});

describe("sky_map: the Sun, the Moon and the planets", () => {
  test("a body above the horizon is drawn where the ephemeris puts it; one below is not drawn at all", () => {
    const at = new Date(AT);
    const pos = sky.bodyPositions(["sun", "moon", "jupiter", "saturn"], at, 59.91, 10.75);
    const ids = idsOf({});
    for (const id of ["sun", "moon", "jupiter", "saturn"]) {
      expect(ids.includes(id), `${id} alt ${pos[id].alt.toFixed(1)}`).toBe(pos[id].alt >= 0);
    }
    const sat = leaf(lay({}), "saturn") as StrokeDrawable;
    const want = sky.project(pos.saturn, sky.chart);
    expect(sat.shapeHint!.type === "circle" ? sat.shapeHint.c : sat.pts[0]).toEqual(want);
  });

  test("a body named in show but under the horizon is SAID, not silently dropped", () => {
    // Jupiter is 13° below the horizon at this moment — a real answer to
    // "where is Jupiter tonight?", and a figure that just omitted it would be
    // a blank page with no explanation.
    expect(textOf(lay({ show: ["jupiter"] }), "sky_note")).toContain("Below the horizon: Jupiter");
    expect(textOf(lay({ show: ["jupiter"], names: "nb" }), "sky_note")).toContain("Under horisonten: Jupiter");
    // The DEFAULT set never complains: half of it is always down.
    expect(textOf(lay({}), "sky_note") ?? "").not.toContain("Below the horizon");
  });

  test("an unknown name goes to the caption, never to an exception", () => {
    expect(textOf(lay({ show: ["krypton"] }), "sky_note")).toContain("Unknown: krypton");
    expect(textOf(lay({ mark: ["vulcan"] }), "sky_note")).toContain("Unknown: vulcan");
  });

  test("the Moon is drawn with its phase — a full disc when full, a sliver when new", () => {
    const lit = (time: string): number => {
      const r = layoutSpec(spec({ time, show: ["moon"] }));
      const d = flattenDrawables(r.drawables).find((x) => x.id === "moon__lit") as { pts: [number, number][] } | undefined;
      if (!d) return 0;
      let a = 0;
      for (let i = 0; i < d.pts.length; i++) {
        const p = d.pts[i], q = d.pts[(i + 1) % d.pts.length];
        a += p[0] * q[1] - q[0] * p[1];
      }
      return Math.abs(a) / 2;
    };
    // Two moments in 2026 chosen by phase, then checked by area against the
    // engine's own illuminated fraction rather than by eye.
    const disc = Math.PI * 12 * 12;
    const full = lit("2026-09-26T22:00:00Z");
    const crescent = lit("2026-02-22T20:00:00Z");
    expect(full / disc).toBeGreaterThan(0.85);
    expect(crescent / disc).toBeLessThan(0.45);
    expect(crescent).toBeGreaterThan(0);
  });

  test("the Moon fills its WHOLE disc, so its dark half still answers a click", () => {
    // An `area` is a hit outline and hitElement's box pass skips any id that
    // has one, so a moon that filled only its crescent would lose every click
    // on its dark half to whatever is behind it.
    const r = lay({ time: "2026-02-22T20:00:00Z", show: ["moon"] });
    const disc = flattenDrawables(r.drawables).find((d) => d.id === "moon__disc");
    expect(disc?.kind).toBe("area");
    expect((disc as { pts: [number, number][] }).pts.length).toBeGreaterThanOrEqual(40);
  });

  test("the crescent points at the Sun", () => {
    const at = new Date("2026-02-22T20:00:00Z");
    const p = sky.bodyPositions(["moon", "sun"], at, 59.91, 10.75);
    const moonAt = sky.project(p.moon, sky.chart);
    const sunAt = sky.project(p.sun, sky.chart);
    const r = lay({ time: "2026-02-22T20:00:00Z", show: ["moon", "sun"] });
    const litPts = (flattenDrawables(r.drawables).find((d) => d.id === "moon__lit") as { pts: [number, number][] }).pts;
    // The lit region's centroid lies on the Sun's side of the Moon's centre.
    const cx = litPts.reduce((s, q) => s + q[0], 0) / litPts.length;
    const cy = litPts.reduce((s, q) => s + q[1], 0) / litPts.length;
    const toSun = [sunAt[0] - moonAt[0], sunAt[1] - moonAt[1]];
    const toLit = [cx - moonAt[0], cy - moonAt[1]];
    expect(toSun[0] * toLit[0] + toSun[1] * toLit[1]).toBeGreaterThan(0);
  });

  test("when the Sun is up the figure says so, and still draws the stars", () => {
    const noon = lay({ time: "2026-06-21T10:00:00Z" });
    expect(textOf(noon, "sky_note")).toMatch(/^The Sun is up/);
    expect(noon.order).toContain("stars");
    expect(noon.order).toContain("sun");
  });
});

describe("sky_map: what the author singles out", () => {
  test("a star named in mark leaves the field and becomes its own element", () => {
    // `draw` has no wildcard and the model cannot know which stars are up, so
    // the field is ONE element and `mark` lifts out what a question needs.
    const plain = idsOf({});
    expect(plain).not.toContain("vega");
    const marked = lay({ mark: ["Vega"] });
    expect(marked.order).toContain("vega");
    expect(flattenDrawables(marked.drawables).some((d) => d.id === `stars__hip_${sky.findStar("Vega")!.hip}`)).toBe(false);
  });

  test("highlight both lifts and tints, so a click question can hide its answer while a beat can show it", () => {
    const r = lay({ highlight: ["Vega"] });
    expect(r.order).toContain("vega");
    const dot = leaf(r, "vega") as StrokeDrawable;
    expect(dot.style.color).toBe("#8a5fa8");   // COLORS.accent
    // mark alone does NOT tint: that is the whole point of having both.
    const m = leaf(lay({ mark: ["Vega"] }), "vega") as StrokeDrawable;
    expect(m.style.color).not.toBe("#8a5fa8");
  });

  test("a marked star that is below the horizon is simply not there", () => {
    const down = sky.stars().find((s) => s.name && sky.starPositions(new Date(AT), 59.91, 10.75).get(s.hip)!.alt < -20)!;
    expect(idsOf({ mark: [down.name!] })).not.toContain(sky.starId(down));
  });
});

describe("sky_map: the observer", () => {
  test("the place and the clock are written, and the clock is local solar time", () => {
    expect(textOf(lay({ place: "Tromsø", lat: 69.65, lon: 18.96 }), "place_label")).toBe("Tromsø · 2026-09-07 22:15");
    // lat/lon without a place does not silently claim to be Oslo.
    expect(textOf(lay({ lat: 0, lon: 0 }), "place_label")).toBe("2026-09-07 21:00");
  });

  test("moving the observer moves the sky", () => {
    const oslo = lay({});
    const sydney = lay({ lat: -33.87, lon: 151.21, place: "Sydney" });
    expect(JSON.stringify(oslo.drawables)).not.toBe(JSON.stringify(sydney.drawables));
    // From Sydney the southern sky is up: Crux's brightest star is above the
    // horizon there and below it from Oslo.
    const acrux = sky.findStar("Acrux") ?? sky.stars().reduce((a, b) => (b.dec < a.dec ? b : a));
    expect(sky.starPositions(new Date(AT), -33.87, 151.21).get(acrux.hip)!.alt).toBeGreaterThan(0);
    expect(sky.starPositions(new Date(AT), 59.91, 10.75).get(acrux.hip)!.alt).toBeLessThan(0);
  });

  test("hours and days turn the sky, and they are the animatable handles", () => {
    const now = lay({});
    const later = lay({ hours: 6 });
    expect(JSON.stringify(now.drawables)).not.toBe(JSON.stringify(later.drawables));
    // Six hours is a quarter turn: Polaris does not move, everything else does.
    const pol = sky.findStar("Polaris")!;
    const a = sky.starPositions(new Date(AT), 59.91, 10.75).get(pol.hip)!;
    const b = sky.starPositions(new Date(Date.parse(AT) + 6 * 3600000), 59.91, 10.75).get(pol.hip)!;
    expect(Math.abs(a.alt - b.alt)).toBeLessThan(0.5);
    expect(textOf(lay({ days: 30 }), "place_label")).toContain("2026-10-07");
  });
});

describe("sky_map: the captions cannot collide, because there is only one of each", () => {
  test("the two foot lines sit clear of each other and of the compass", () => {
    const r = layoutSpec(spec({ show: ["jupiter", "krypton"], title: "The sky over Oslo tonight" }));
    const boxes = elementBBoxes(r);
    const place = boxes.get("place_label")!;
    const note = boxes.get("sky_note")!;
    expect(note.y + note.h).toBeLessThan(boxes.get("compass_s")!.y - 2);
    expect(place.y + place.h).toBeLessThan(note.y - 2);
    expect(place.x).toBeGreaterThanOrEqual(0);
    expect(boxes.get("title")!.y + boxes.get("title")!.h).toBeLessThanOrEqual(750);
    expect(r.issues.map((i) => `[${i.severity}] ${i.message}`)).toEqual([]);
  });

  test("a caption too wide for the page drops its cheapest clause, not its most important", () => {
    const long = lay({ time: "2026-06-21T10:00:00Z", show: ["jupiter", "saturn", "uranus", "neptune", "krypton", "vulcan", "romulus"] });
    const note = textOf(long, "sky_note")!;
    expect(note).toMatch(/^The Sun is up/);            // the clause that matters most survives
    expect(note).not.toMatch(/as symbols/);            // the cheapest one went
    expect(note.length).toBeGreaterThan(20);
  });
});

describe("sky_map: lint-clean over a year of moments", () => {
  // Round 1's lesson, in one test: its default figure warned on EVERY date and
  // nothing noticed for a whole round. 200 moments, stepping 1.837 days and
  // 1.373 hours each time, so a year of sky and a whole day of rotation are
  // both covered — and the bar is zero issues, not zero errors.
  const moments = (n: number): string[] =>
    Array.from({ length: n }, (_, i) => new Date(Date.UTC(2026, 0, 1) + i * (1.837 * 86400000 + 1.373 * 3600000)).toISOString());

  const sweep = (params: Record<string, unknown>): { dirty: string[]; count: number } => {
    const dirty: string[] = [];
    let count = 0;
    for (const time of moments(200)) {
      const issues = layoutSpec(spec({ ...params, time })).issues;
      if (issues.length > 0) { count++; dirty.push(`${time}: [${issues[0].severity}] ${issues[0].message}`); }
    }
    return { dirty: dirty.slice(0, 4), count };
  };

  test.each([
    ["the default figure", {}],
    ["in Norwegian", { names: "nb" }],
    ["from Tromsø", { lat: 69.65, lon: 18.96, place: "Tromsø" }],
    ["from the equator", { lat: 0, lon: 0, place: "The equator" }],
    ["from Sydney", { lat: -33.87, lon: 151.21, place: "Sydney" }],
    ["with only the brightest stars", { limit_mag: 2 }],
    ["with a title over it", { title: "The sky over Oslo tonight" }],
    ["with a planet named that is sometimes down", { show: ["jupiter", "saturn"] }],
    ["with a star singled out", { mark: ["Vega"], highlight: ["Sirius"] }],
    ["with an unknown name", { show: ["planets", "krypton"] }],
  ])("%s is lint-clean on every one of 200 moments", (_what, params) => {
    const { dirty, count } = sweep(params);
    expect(dirty).toEqual([]);
    expect(count).toBe(0);
  });

  test("the clean figure is not clean because it draws nothing", () => {
    const r = lay({});
    expect(flattenDrawables(r.drawables).filter((d) => d.id.startsWith("stars__hip_")).length).toBeGreaterThan(150);
    expect(r.order).toContain("horizon");
    for (const d of flattenDrawables(r.drawables)) {
      if (d.kind === "text") expect(d.fontSize, d.id).toBeGreaterThanOrEqual(14);
    }
  });

  test("the manifest's own examples lay out with NO lint issue at all", () => {
    for (const ex of scenes.sky_map.manifest.examples) {
      const res = layoutSpec({ template: "sky_map", params: { time: AT, ...ex.params }, elements: [] } as never);
      expect(res.warnings, ex.request).toEqual([]);
      expect(res.issues.map((i) => `[${i.severity}] ${i.message}`), ex.request).toEqual([]);
    }
  });
});
```

`tests/sky-hit.test.ts`:

```ts
// A click on the sky must reach what was clicked. The trap this file exists
// for: round 1 drew a `frame` with closed: true, elementRings handed it an
// outline covering the whole canvas, and hitElement's outline pass returned it
// for every click and never reached the box pass (src/ui/hit.ts, "Pass 1").
// A sky map draws a horizon circle, which is the same shape and the same risk.

import { beforeAll, describe, expect, test } from "vitest";
import { ensureEnabledPacks } from "../src/scenes/packs";
import { DEFAULT_SETTINGS } from "../src/store";
import { ensureEngines, getLoadedEngines } from "../src/scenes/engines";
import { elementBBoxes, elementRings, layoutSpec } from "../src/layout/layout";
import { hitElement } from "../src/ui/hit";
import type { SkyEngine } from "../src/scenes/space/sky-types";

const AT = "2026-09-07T21:00:00Z";
let sky: SkyEngine;

beforeAll(async () => {
  await ensureEnabledPacks(DEFAULT_SETTINGS.enabledPacks);
  await ensureEngines(["space", "sky"]);
  sky = getLoadedEngines(["sky"]).sky as SkyEngine;
});

const lay = (params: Record<string, unknown>) =>
  layoutSpec({ template: "sky_map", params: { time: AT, ...params }, elements: [] } as never);

function clickOn(params: Record<string, unknown>, id: string): string | null {
  const r = lay(params);
  const b = elementBBoxes(r).get(id);
  if (!b) throw new Error(`no box for ${id}`);
  return hitElement(elementBBoxes(r), [b.x + b.w / 2, b.y + b.h / 2], 18, elementRings(r));
}

describe("the horizon is drawn but owns no clicks", () => {
  test("it declares no outline", () => {
    const r = lay({});
    expect(r.order).toContain("horizon");
    expect([...elementRings(r).keys()]).not.toContain("horizon");
  });

  test("a click on a marked star answers that star, not the rim it sits inside", () => {
    expect(clickOn({ mark: ["Vega"] }, "vega")).toBe("vega");
    expect(clickOn({ mark: ["Vega", "Deneb"] }, "deneb")).toBe("deneb");
  });

  test("a click on a planet answers that planet", () => {
    expect(clickOn({}, "saturn")).toBe("saturn");
  });
});

describe("the Moon answers for its whole disc, lit or not", () => {
  test("the centre of a crescent moon is still the Moon", () => {
    const params = { time: "2026-02-22T20:00:00Z", show: ["moon"] };
    expect(clickOn(params, "moon")).toBe("moon");
    const r = lay(params);
    // It has a ring, and the ring is the whole disc — not just the crescent.
    const rings = elementRings(r).get("moon")!;
    const box = elementBBoxes(r).get("moon")!;
    const areas = rings.map((ring) => {
      let a = 0;
      for (let i = 0; i < ring.length; i++) { const p = ring[i], q = ring[(i + 1) % ring.length]; a += p[0] * q[1] - q[0] * p[1]; }
      return Math.abs(a) / 2;
    });
    expect(Math.max(...areas)).toBeGreaterThan(0.6 * box.w * box.h);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/sky-template.test.ts tests/sky-hit.test.ts`
Expected: FAIL — `Cannot read properties of undefined (reading 'layout')` for `scenes.sky_map`.

- [ ] **Step 3: Write the template document**

Append to `src/scenes/packs/space.yaml`, after the `solar_system` document, a new `---` document. The manifest first:

```yaml
---
template: sky_map
title: The night sky from a place at a time
version: 1
kit: 9
status: ready
engines: [space, sky]
description: >-
  THE SKY OVERHEAD, from a place on Earth at a moment: a round chart with the
  zenith at its centre and the horizon as its rim, north at the top and EAST ON
  THE LEFT — the way a planisphere reads when you hold it up and look through
  it. Every star to `limit_mag` that is above the horizon is drawn, sized by
  brightness and tinted by colour, from a bundled catalogue of 1 040 stars; the
  Sun, Moon and naked-eye planets are placed by a real ephemeris and the Moon
  is drawn with the phase it actually has that night, its lit side turned
  toward the Sun. `lat`/`lon`/`place` say where the viewer stands (Oslo by
  default), `time` when (an ISO datetime, or now); `hours` and `days` are
  numeric offsets from it and THE ANIMATABLE HANDLES — {"animate": {"hours":
  6}} turns the sky through a night, {"animate": {"days": 182}} shows why the
  same stars are not up in six months. Anything below the horizon is simply not
  drawn, and a body you named in `show` that has set is SAID so in the caption
  rather than silently missing. The star field is ONE element, `stars`, because
  no author can know which stars are up at a given hour — so to ask a question
  about one star, name it in `mark` and it becomes its own element with its own
  name as its id ({"ask": {"question": "Which one is Vega?", "widget": "click",
  "answer": "vega"}}); `highlight` marks AND tints. Choose this scene for any
  request about tonight's sky, a constellation, a named star, where a planet is
  tonight, the Moon's phase, or why the sky turns.
params:
  type: object
  properties:
    lat:
      type: number
      minimum: -90
      maximum: 90
      description: "Observer's latitude in degrees north (default 59.91, Oslo). Negative is south."
    lon:
      type: number
      minimum: -180
      maximum: 180
      description: "Observer's longitude in degrees east (default 10.75, Oslo). Negative is west."
    place:
      type: string
      description: "The place name written under the chart (default Oslo, and only when lat/lon are the default too — a chart at other coordinates does not claim to be somewhere it is not)."
    time:
      type: string
      description: "ISO datetime with its offset (2026-09-07T22:00:00+02:00), or now (the default). Without an offset the time is read as UTC; a bare date means 22:00 local solar time where the observer stands."
      x-translate: false
    hours:
      type: number
      minimum: -24
      maximum: 24
      description: "Offset from time in hours (default 0) — an animatable handle: animate hours to 6 and the sky turns a quarter of a circle about the pole. Write the starting value (0) in params when you animate."
    days:
      type: number
      minimum: -366
      maximum: 366
      description: "Offset from time in days (default 0) — the other animatable handle: animate days to 182 and the same hour of night shows the opposite half of the sky."
    limit_mag:
      type: number
      minimum: 2
      maximum: 4.5
      description: "The faintest star drawn (default 4.5, which is roughly what a dark suburban sky shows). 2 keeps only the few dozen brightest. A star does not change size when this does."
    names:
      type: string
      enum: [en, nb, la, none]
      description: "Label language: en (default; the descriptive English names, The Great Bear), la (the international Latin names, Ursa Major), nb (Norwegian, Store bjørn), none. Star proper names are the same word in every language except where Norwegian has its own."
    show:
      type: array
      items: { type: string }
      description: "Which Sun/Moon/planet ids to mark (sun, moon, mercury, venus, mars, jupiter, saturn, uranus, neptune). Default: all of those, drawn when they are up and passed over in silence when they are not. Name one explicitly and the chart SAYS so when it is below the horizon."
      x-translate: false
    mark:
      type: array
      items: { type: string }
      description: "Stars or bodies to lift out into their own elements so a question or a highlight command can address them, WITHOUT changing how they look — the way to write {\"ask\": {\"widget\": \"click\", \"answer\": \"sirius\"}} without the figure giving the answer away. A star's id is its proper name in lower case (sirius, betelgeuse)."
      x-translate: false
    highlight:
      type: array
      items: { type: string }
      description: "Stars or bodies to tint for the whole figure; they are lifted into their own elements too. To make one glow for ONE sentence use the highlight COMMAND instead ({\"highlight\": {\"target\": [\"sirius\"]}}), and a click question glows its answer by itself."
      x-translate: false
    title:
      type: string
element_ids:
  horizon: the circle where the sky meets the ground — everything drawn is inside it
  compass_n: "N at the top of the chart"
  compass_e: "E on the LEFT (a chart held overhead reverses east and west)"
  compass_s: "S at the bottom"
  compass_w: "W on the right"
  stars: every star that is not singled out, as one element — this is what an author draws when the stars come out
  <star_name>: a star named in mark or highlight becomes its own element, its id its proper name in lower case (sirius, vega, betelgeuse)
  <body_id>: sun, moon, mercury, venus, mars, jupiter, saturn, uranus or neptune, drawn only when it is above the horizon
  moon: the Moon, drawn with the phase it has that night, its lit side turned toward the Sun
  label_<id>: the written name of a body or a singled-out star
  place_label: the place and the local time, along the foot
  sky_note: "the figure's one caption: daylight, anything named that has set, unknown names, and that the Sun, Moon and planets are drawn as symbols"
  title: figure title, when set
examples:
  - request: "What is up over Oslo tonight?"
    params: { time: "2026-09-07T22:00:00+02:00" }
  - request: "Hvor er Saturn i kveld?"
    params: { time: "2026-09-07T22:00:00+02:00", show: ["saturn"], highlight: ["saturn"], names: "nb" }
  - request: "Which star is Vega?"
    params: { time: "2026-09-07T22:00:00+02:00", mark: ["Vega", "Deneb", "Altair"] }
```

- [ ] **Step 4: Write the layout body**

Still inside the `sky_map` document, `layout: |`. Written out in full — the pieces are ordered as they run.

```js
  const C = kit.COLORS, MS = kit.SKETCH_MS;
  const eng = engines.sky, spc = engines.space;
  const CH = eng.chart;                                  // { cx: 500, cy: 385, r: 285 }
  const F = { x0: 60, y0: 80, x1: 940, y1: 700 };
  const NOTE_PX = 18, LABEL_PX = 19, COMPASS_PX = 20;
  const LABEL_H = LABEL_PX * 1.25;
  // Headroom for the OTHER word: a translated copy swaps the words this body
  // measured AFTER it has run (src/layout/text-map.ts) and leaves every box
  // where it was put. A character's width, added to the clearance a name
  // reserves — never to where a candidate sits.
  const TRANSLATED_ROOM = kit.textWidth("n", LABEL_PX);

  const num = (v, d) => (typeof v === "number" && Number.isFinite(v) ? v : d);
  const clamp = (lo, hi, v) => Math.max(lo, Math.min(hi, v));
  const list = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === "string" && x.trim() !== "") : []);
  const oneOf = (v, opts, d) => (typeof v === "string" && opts.indexOf(v) >= 0 ? v : d);

  const lat = clamp(-90, 90, num(params.lat, 59.91));
  const lon = ((num(params.lon, 10.75) + 540) % 360) - 180;
  const names = oneOf(params.names, ["en", "nb", "la", "none"], "en");
  const L = names === "none" ? "en" : names;
  const bodyLang = L === "nb" ? "nb" : "en";
  const limit = clamp(2, 4.5, num(params.limit_mag, 4.5));
  const at = eng.resolveTime(params.time, params.hours, params.days, lon);
  // A chart at coordinates the author chose does not claim to be Oslo.
  const defaultSpot = params.lat === undefined && params.lon === undefined;
  const placeText = typeof params.place === "string" && params.place.trim() !== "" ? params.place.trim() : (defaultSpot ? "Oslo" : "");

  const drawables = [], labels = [], anchors = {}, order = [];
  const push = (d) => { drawables.push(d); order.push(d.id); };
  const unknown = [];

  // ---- what the author singled out ---------------------------------------
  // `draw` has no wildcard and the model cannot know which stars are up at a
  // given hour, so the field is ONE element. Anything named in `mark` or
  // `highlight` is lifted OUT of it into its own element, which is what makes
  // a click question and the highlight command reach a single star.
  const markStars = new Set(), markBodies = new Set();
  const litStars = new Set(), litBodies = new Set();
  const take = (q, stars, bodies) => {
    const s = eng.findStar(q);
    if (s) { stars.add(s.hip); return true; }
    const b = spc.bodies([q]);
    if (b.bodies[0]) { bodies.add(b.bodies[0].id); return true; }
    return false;
  };
  for (const q of list(params.mark)) if (!take(q, markStars, markBodies)) unknown.push(q.trim());
  for (const q of list(params.highlight)) {
    if (take(q, litStars, litBodies)) take(q, markStars, markBodies);
    else unknown.push(q.trim());
  }

  // ---- the bodies ---------------------------------------------------------
  const DEFAULT_SHOW = ["sun", "moon", "mercury", "venus", "mars", "jupiter", "saturn"];
  const asked = list(params.show);
  const showIds = [];
  for (const q of (asked.length > 0 ? asked : DEFAULT_SHOW)) {
    const b = spc.bodies([q]);
    if (b.bodies[0]) { if (showIds.indexOf(b.bodies[0].id) < 0) showIds.push(b.bodies[0].id); }
    else if (asked.length > 0) unknown.push(q.trim());
  }
  for (const id of markBodies) if (showIds.indexOf(id) < 0) showIds.push(id);
  const bPos = eng.bodyPositions(showIds, at, lat, lon);
  const bodyName = (id) => { const b = spc.body(id); return b ? (b.name[bodyLang] || b.name.en) : id; };
  const below = [];
  // Only a body the author NAMED is reported as set: the default list is half
  // below the horizon at any hour, and saying so every time would be noise.
  for (const id of showIds) {
    const p = bPos[id];
    if ((!p || p.alt < 0) && (asked.length > 0 || markBodies.has(id))) below.push(bodyName(id));
  }
  const up = showIds.filter((id) => bPos[id] && bPos[id].alt >= 0);
  const daylight = bPos.sun !== undefined && bPos.sun.alt > -0.5;

  // ---- the captions, measured before anything is placed -------------------
  const clauses = eng.noteClauses({ daylight, below, unknown, symbols: up.length > 0 }, L);
  let noteText = clauses.join(" · ");
  // ONE caption, and it drops its cheapest clause rather than running off the
  // page. Round 1's known limit was two captions colliding in this same foot
  // strip; one caption cannot collide with itself.
  while (clauses.length > 0 && kit.textWidth(noteText, NOTE_PX) > F.x1 - F.x0) { clauses.pop(); noteText = clauses.join(" · "); }
  const clock = eng.localClock(at, lon);
  const placeLine = (placeText !== "" ? placeText + " · " : "") + clock.date + " " + clock.time;
  const titleText = typeof params.title === "string" && params.title.trim() !== "" ? params.title.trim() : "";
  const textBox = (at2, s, fs, start) => { const w = kit.textWidth(s, fs), h = fs * 1.25; return { x: start ? at2[0] : at2[0] - w / 2, y: at2[1] - h / 2, w, h }; };
  const captionBoxes = () => {
    const out = [textBox([F.x0, 24], placeLine, NOTE_PX, true)];
    if (noteText !== "") out.push(textBox([F.x0, 52], noteText, NOTE_PX, true));
    if (titleText !== "") out.push(textBox([500, 726], titleText, 30));
    return out;
  };

  // ---- geometry, all measured before any ink ------------------------------
  const P = (p) => eng.project(p, CH);
  const horizonPts = [];
  for (let i = 0; i <= 144; i++) { const t = (2 * Math.PI * i) / 144; horizonPts.push([CH.cx + CH.r * Math.cos(t), CH.cy + CH.r * Math.sin(t)]); }

  const COMPASS = [[0, "compass_n", "N", "N"], [90, "compass_e", "E", "Ø"], [180, "compass_s", "S", "S"], [270, "compass_w", "W", "V"]];
  const compass = COMPASS.map((c) => {
    const rr = CH.r + 20, a = (c[0] * Math.PI) / 180;
    return { id: c[1], text: L === "nb" ? c[3] : c[2], at: [CH.cx - rr * Math.sin(a), CH.cy + rr * Math.cos(a)] };
  });

  const sPos = eng.starPositions(at, lat, lon);
  const field = [], own = [];
  for (const s of eng.stars()) {
    const p = sPos.get(s.hip);
    if (!p || p.alt < 0) continue;
    const singled = markStars.has(s.hip);
    if (s.mag > limit && !singled) continue;
    (singled ? own : field).push({ s, at: P(p), r: eng.starRadius(s.mag) });
  }

  const bodies = up.map((id) => {
    const b = spc.body(id);
    return { id, b, at: P(bPos[id]), r: id === "sun" ? 11 : id === "moon" ? 12 : 6 };
  });

  // ---- names -------------------------------------------------------------
  // Two rules, and they are different on purpose.
  //   A BODY the author asked for by name always gets its name, so its search
  //   takes the CHEAPEST spot; its candidates aim INWARD, toward the zenith,
  //   where the dome is emptiest — a name placed outward from a body near the
  //   rim runs off the page.
  //   A STAR's name is written only where it costs NOTHING. A chart names what
  //   it has room for; an atlas leaves the rest off, and a name that would sit
  //   on a line is worse than no name. tests/sky-template.test.ts holds the
  //   floor so this cannot become "write nothing and lint clean".
  const boxAt = (c, w, h) => ({ x: c[0] - w / 2, y: c[1] - h / 2, w, h });
  const boxHit = (a, b, pad) => a.x - pad < b.x + b.w && a.x + a.w + pad > b.x && a.y - pad < b.y + b.h && a.y + a.h + pad > b.y;
  // The core lint reads a label by: the middle 60 % across and 50 % down of
  // its box, offset a fifth and a quarter in. A SILENT COPY of the four
  // numbers in lintText (src/lint/lint.ts, the overlap-label-stroke rule) — a
  // layout body is compiled from YAML and cannot import, so the duplication is
  // forced. Change one, change the other; the 200-moment sweeps in
  // tests/sky-template.test.ts are all that would notice.
  const coreOf = (b) => ({ x: b.x + b.w * 0.2, y: b.y + b.h * 0.25, w: b.w * 0.6, h: b.h * 0.5 });
  const turn = (p, q, r) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
  const segHit = (a, b, r) => {
    if (Math.max(a[0], b[0]) < r.x || Math.min(a[0], b[0]) > r.x + r.w || Math.max(a[1], b[1]) < r.y || Math.min(a[1], b[1]) > r.y + r.h) return false;
    if (a[0] >= r.x && a[0] <= r.x + r.w && a[1] >= r.y && a[1] <= r.y + r.h) return true;
    const k = [[r.x, r.y], [r.x + r.w, r.y], [r.x + r.w, r.y + r.h], [r.x, r.y + r.h]];
    for (let j = 0; j < 4; j++) { const u = k[j], v = k[(j + 1) % 4]; if (turn(a, b, u) !== turn(a, b, v) && turn(u, v, a) !== turn(u, v, b)) return true; }
    return false;
  };
  const pathHit = (pts, r) => { for (let j = 0; j < pts.length - 1; j++) if (segHit(pts[j], pts[j + 1], r)) return true; return false; };

  const written = captionBoxes();
  for (const c of compass) written.push(textBox(c.at, c.text, COMPASS_PX));
  const guides = [horizonPts];                       // Task 5 pushes the constellation lines here
  const discs = [];
  for (const d of field) discs.push(boxAt(d.at, 2 * d.r, 2 * d.r));
  for (const d of own) discs.push(boxAt(d.at, 2 * d.r * 1.25, 2 * d.r * 1.25));
  for (const b of bodies) discs.push(boxAt(b.at, 2 * b.r, 2 * b.r));

  const nameTexts = [];
  /** Candidate spots around a point: `dirs` are screen directions in
   *  preference order, `gaps` how far past the disc to sit. */
  const spotsAround = (c, w, e, dirs, gaps) => {
    const out = [];
    for (const g of gaps) for (const th of dirs) {
      const dx = Math.cos(th), dy = Math.sin(th);
      const d = e + g + (Math.abs(dx) * w + Math.abs(dy) * LABEL_H) / 2;
      out.push([c[0] + dx * d, c[1] + dy * d]);
    }
    return out;
  };
  /** What a spot costs the reader: off the page is unreadable and a lint
   *  error; two names on top of each other are two names nobody can read; a
   *  name across a line is the graze lint warns about; a name touching a disc
   *  is only untidy. `freeOnly` means take a zero-cost spot or none at all. */
  const place = (id, c, e, text, color, dirs, gaps, freeOnly) => {
    const w = kit.textWidth(text, LABEL_PX);
    let pick = null, best = null, bestCost = Infinity;
    for (const q of spotsAround(c, w, e, dirs, gaps)) {
      const bx = boxAt(q, w, LABEL_H), room = boxAt(q, w + TRANSLATED_ROOM, LABEL_H), co = coreOf(bx);
      let cost = bx.x < 4 || bx.y < 4 || bx.x + bx.w > kit.CANVAS.w - 4 || bx.y + bx.h > kit.CANVAS.h - 4 ? 10000 : 0;
      for (const t of written) if (boxHit(room, t, 2)) cost += 100;
      for (const g of guides) if (pathHit(g, co)) cost += 10;
      for (const t of discs) if (boxHit(bx, t, 2)) cost += 6;
      if (cost === 0) { pick = bx; break; }
      if (cost < bestCost) { bestCost = cost; best = bx; }
    }
    if (!pick && !freeOnly) pick = best;
    if (!pick) return;
    written.push({ x: pick.x - TRANSLATED_ROOM / 2, y: pick.y, w: pick.w + TRANSLATED_ROOM, h: pick.h });
    nameTexts.push({ id: id, at: [pick.x + pick.w / 2, pick.y + pick.h / 2], text: text, color: color });
  };

  if (names !== "none") {
    const IN = [], STEP = Math.PI / 4;
    // Inward first, then round the compass from there.
    for (const m of [0, 1, -1, 2, -2, 3, -3, 4]) IN.push(m * STEP);
    for (const b of bodies) {
      const th0 = Math.atan2(CH.cy - b.at[1], CH.cx - b.at[0]);
      place("label_" + b.id, b.at, b.r, bodyName(b.id), litBodies.has(b.id) ? C.accent : C.ink, IN.map((d) => th0 + d), [8, 24, 42], false);
    }
    for (const d of own) {
      const t = eng.starName(d.s, L);
      if (!t) continue;
      const th0 = Math.atan2(CH.cy - d.at[1], CH.cx - d.at[0]);
      place("label_" + eng.starId(d.s), d.at, d.r * 1.25, t, litStars.has(d.s.hip) ? C.accent : C.ink, IN.map((x) => th0 + x), [8, 22], true);
    }
  }

  // ---- and now the ink, back to front -------------------------------------
  // The rim is traced as an OPEN path that returns to its start, NOT
  // closed: true. Drawn the same either way, but `closed` would make
  // elementRings hand the horizon a hit OUTLINE covering the whole sky, and
  // hitElement answers with the smallest outline containing the point and
  // never looks at boxes after that (src/ui/hit.ts, "Pass 1") — the rim would
  // win every click meant for a star. Round 1 shipped exactly that as a frame.
  push(kit.stroke("horizon", horizonPts, { color: C.guide, strokeWidth: 2, ms: MS.guides }));
  for (const c of compass) { push(kit.text(c.id, c.at, c.text, { fontSize: COMPASS_PX, color: C.ink })); anchors[c.id] = c.at; }

  if (field.length > 0) {
    // A group's leaf durations ACCUMULATE (src/render/svg-backend.ts:583-589),
    // so a fixed per-dot sketch time would make the star field take minutes.
    // The field draws in about two seconds however many stars are in it.
    const per = Math.max(4, Math.round(2200 / field.length));
    push(kit.group("stars", field.map((d) => kit.ball("stars__hip_" + d.s.hip, d.at, d.r, { fill: eng.starColor(d.s.bv), strokeWidth: 0.8, ms: per }))));
    anchors.stars = [CH.cx, CH.cy];
  }
  for (const d of own) {
    const id = eng.starId(d.s), on = litStars.has(d.s.hip);
    push(kit.ball(id, d.at, d.r * 1.25, { fill: on ? C.accent : eng.starColor(d.s.bv), color: on ? C.accent : undefined, strokeWidth: on ? 2 : 0.8, ms: MS.dot }));
    anchors[id] = d.at;
  }

  const limb = bodies.some((b) => b.id === "moon") ? eng.moonLimb(at, lat, lon) : null;
  for (const b of bodies) {
    if (b.id === "moon" && limb) {
      const r = b.r, c = b.at, rim = [];
      for (let i = 0; i <= 48; i++) { const t = (2 * Math.PI * i) / 48; rim.push([c[0] + r * Math.cos(t), c[1] + r * Math.sin(t)]); }
      // The WHOLE disc is filled first, faintly. An `area` is a hit outline
      // and hitElement's box pass SKIPS any id that already has one, so a moon
      // that filled only its crescent would lose every click on its dark half
      // to whatever lies behind it.
      const parts = [kit.area("moon__disc", rim, "#cfcabb", { opacity: 0.3, ms: MS.region })];
      let dir = [1, 0];
      if (limb.toward) {
        const q = P(limb.toward), dx = q[0] - c[0], dy = q[1] - c[1], m = Math.hypot(dx, dy) || 1;
        dir = [dx / m, dy / m];
      }
      const nrm = [-dir[1], dir[0]];
      // The terminator is a half-ellipse whose semi-axis along the bright
      // direction is r(1 - 2k): +r at new (it lies on the limb, no lit area),
      // 0 at quarter (a straight edge through the centre), -r at full (it
      // reaches the far limb and the whole disc is lit).
      const d = r * (1 - 2 * limb.fraction), lit = [];
      for (let i = 0; i <= 32; i++) { const t = -Math.PI / 2 + (Math.PI * i) / 32, ct = Math.cos(t), st = Math.sin(t); lit.push([c[0] + r * ct * dir[0] + r * st * nrm[0], c[1] + r * ct * dir[1] + r * st * nrm[1]]); }
      for (let i = 32; i >= 0; i--) { const t = -Math.PI / 2 + (Math.PI * i) / 32, ct = Math.cos(t), st = Math.sin(t); lit.push([c[0] + d * ct * dir[0] + r * st * nrm[0], c[1] + d * ct * dir[1] + r * st * nrm[1]]); }
      parts.push(kit.area("moon__lit", lit, litBodies.has("moon") ? C.accent : "#efe9d2", { opacity: 0.95, ms: MS.region }));
      parts.push(kit.stroke("moon__rim", rim, { color: C.guide, strokeWidth: 1.2, ms: MS.stroke }));
      push(kit.group("moon", parts));
      anchors.moon = c;
      continue;
    }
    const on = litBodies.has(b.id);
    push(kit.ball(b.id, b.at, b.r, { fill: on ? C.accent : b.b.color, color: on ? C.accent : undefined, strokeWidth: on ? 3 : 1.5, ms: MS.dot }));
    anchors[b.id] = b.at;
  }

  for (const t of nameTexts) { push(kit.text(t.id, t.at, t.text, { fontSize: LABEL_PX, color: t.color })); anchors[t.id] = t.at; }

  push(kit.text("place_label", [F.x0, 24], placeLine, { fontSize: NOTE_PX, color: C.guide, anchor: "start" }));
  anchors.place_label = [F.x0, 24];
  if (noteText !== "") {
    push(kit.text("sky_note", [F.x0, 52], noteText, { fontSize: NOTE_PX, color: C.guide, anchor: "start" }));
    anchors.sky_note = [F.x0, 52];
  }
  if (titleText !== "") { push(kit.text("title", [500, 726], titleText, { fontSize: 30 })); anchors.title = [500, 726]; }

  return { drawables, labels, anchors, order };
```

- [ ] **Step 5: Update the round-1 registration assertion**

`tests/space-template.test.ts:39` — the pack now carries two templates:

```ts
    expect(registerPack("space", spaceYaml)).toMatchObject({ ok: true, templateIds: ["solar_system", "sky_map"] });
```

- [ ] **Step 6: Add the bundled example**

A template may not be `status: ready` with no example (`tests/examples.test.ts:62`), so this lands in the same commit. It starts from a question, per Hans's rule of 2026-09-07: an errand ("Show me the sky tonight") teaches the model that the app takes orders. Append to `src/examples.json`:

```json
{
  "request": "Why does the sky turn?",
  "packs": ["space"],
  "spec": {
    "title": "The sky turns because we do",
    "template": "sky_map",
    "params": { "time": "2026-09-07T22:00:00+02:00", "lat": 59.91, "lon": 10.75, "place": "Oslo", "mark": ["Polaris"], "hours": 0 },
    "commands": [
      { "draw": ["horizon", "compass_n", "compass_e", "compass_s", "compass_w", "place_label"], "speak": "The rim of this circle is the horizon all the way round you, and the middle is straight up. North is at the top — and east is on the left, because you are looking at a chart held over your head rather than a map of the ground." },
      { "draw": ["stars", "sky_note"], "speak": "Oslo, ten in the evening. Every star bright enough to see on a clear night out of town, where it really was." },
      { "draw": ["polaris", "label_polaris"], "speak": "One star sits almost still: Polaris, nearly straight above the Earth's axis, and as high above your horizon as your latitude — sixty degrees, here." },
      { "animate": { "hours": 6 }, "duration": 8, "easing": "linear", "speak": "Now let six hours run. Nothing out there moved: the ground you are standing on turned a quarter of a circle, and the whole sky wheels around the one point the axis is pointing at." },
      { "quiz": { "question": "From the equator, where would Polaris be?", "choices": ["Straight overhead", "Halfway up the sky", "On the horizon"], "correct": 3, "right": "On the horizon — the pole star stands as many degrees up as you are north, and at the equator that is nothing." } }
    ]
  }
}
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx vitest run tests/sky-template.test.ts tests/sky-hit.test.ts tests/space-template.test.ts tests/examples.test.ts tests/pack-defaults.test.ts`
Expected: PASS in all five.

The two hard-coded strings in the tests — `"Oslo · 2026-09-07 21:43"` and `"Tromsø · 2026-09-07 22:16"` — are `localClock` at those longitudes. If they come out a minute different, take the value the engine produces and fix the test, not the engine: the clock's definition is in Task 2 and it is already pinned there.

If a sweep row fails, the message names the first bad moment and its rule. Fix it by moving a name, never by writing fewer names — and never by lowering the bar from `issues` to errors.

- [ ] **Step 8: Run everything**

Run: `npm test` — expected: all files pass, roughly 5 180 tests.
Run: `npx tsc --noEmit` — expected: no output.

- [ ] **Step 9: Commit**

```bash
git add src/scenes/packs/space.yaml src/examples.json tests/sky-template.test.ts tests/sky-hit.test.ts tests/space-template.test.ts
git commit -m "A sky map: the dome, the stars, and the Moon with the phase it really has

Held overhead rather than laid on the ground, so east is on the left. The rim
is an open path that returns to its start, because a closed stroke becomes a
hit outline and would answer every click meant for a star — the frame bug of
round 1, met before it could happen. The Moon fills its whole disc faintly
before its lit crescent, for the same reason from the other side: an area is
an outline, and a half-filled moon would lose the clicks on its dark half.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01RWSwWnc8ToCq7H2pXdvXHY"
```

---

### Task 5: The constellation figures, their names, and `focus`

The answer key becomes a drawing. This is the task where the label problem is real — a star chart is denser than a solar system — so it ends with the sweep at full strength.

**Files:**
- Modify: `src/scenes/packs/space.yaml` (the `sky_map` document: two new params, the constellation block in the layout, the name rule)
- Modify: `tests/sky-template.test.ts` (new describes; the sweep table grows)
- Modify: `tests/sky-hit.test.ts` (a constellation answers a click)

**Interfaces:**
- Consumes: everything Task 4 built, plus `engines.sky.constellations()`, `findConstellation`, `edgeStars`, `name`, `conId`.
- Produces: the element ids `figures`, `con_<abbr lower>`, `label_con_<abbr lower>`, `frame`, and `hip_<n>` for the stars of a focused figure. Task 6's ⊕ section resolves a click to a constellation with `findConstellation`; Task 7's examples draw `con_ori` and `figures`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/sky-template.test.ts`:

```ts
describe("sky_map: the constellation figures", () => {
  // A December evening: Orion is up over Oslo, which is what makes it the
  // figure every test here can name.
  const WINTER = "2026-12-20T21:00:00Z";
  const win = (params: Record<string, unknown>) => scenes.sky_map.layout!({ time: WINTER, ...params });

  test("the figures are ONE element by default, because no author can list them", () => {
    const r = win({});
    expect(r.order).toContain("figures");
    expect(r.order.filter((id) => id.startsWith("con_"))).toEqual([]);
    const segs = flattenDrawables(r.drawables).filter((d) => d.id.startsWith("figures__"));
    expect(segs.length).toBeGreaterThan(80);
    for (const s of segs) expect((s as StrokeDrawable).pts).toHaveLength(2);
  });

  /** Every circle-hinted dot on the page, keyed by its exact centre — the star
   *  field, the singled-out stars and the bodies alike. A line endpoint has to
   *  land on one of these, because that is the whole claim: the drawing IS the
   *  answer key, not a picture that resembles it. */
  const dotCentres = (r: ReturnType<typeof win>): Set<string> => {
    const out = new Set<string>();
    for (const d of flattenDrawables(r.drawables)) {
      if (d.kind !== "stroke") continue;
      const hint = (d as StrokeDrawable).shapeHint;
      if (hint?.type === "circle") out.add(hint.c.join(","));
    }
    return out;
  };

  test("every drawn line joins two stars that are both above the horizon", () => {
    const r = win({});
    const dots = dotCentres(r);
    const segs = flattenDrawables(r.drawables).filter((d) => d.id.startsWith("figures__")) as StrokeDrawable[];
    expect(segs.length).toBeGreaterThan(80);
    for (const s of segs) {
      for (const p of s.pts) {
        // Every endpoint is inside the dome — which, since a point outside it
        // is below the horizon, is the same statement as "both stars are up".
        expect(Math.hypot(p[0] - sky.chart.cx, p[1] - sky.chart.cy)).toBeLessThanOrEqual(sky.chart.r + 0.001);
        expect(dots.has(p.join(",")), `line endpoint ${p.join(",")} has no star`).toBe(true);
      }
    }
  });

  test("a star a drawn line needs is drawn however faint — a line to nothing is a lie", () => {
    // 119 of the 750 line stars are fainter than 4.5 and 28 fainter than 5.0,
    // so a magnitude cut alone would leave the figures with holes.
    const r = win({ limit_mag: 2 });
    const dots = dotCentres(r);
    const segs = flattenDrawables(r.drawables).filter((d) => d.id.startsWith("figures__")) as StrokeDrawable[];
    expect(segs.length).toBeGreaterThan(20);
    for (const s of segs) for (const p of s.pts) expect(dots.has(p.join(",")), `${s.id} ends at nothing`).toBe(true);
    // …and the figures really did keep stars the cut would have thrown away.
    const faint = sky.stars().filter((x) => x.mag > 2 && sky.constellations().some((c) => c.edges.some((e) => e[0] === x.hip || e[1] === x.hip)));
    expect(faint.length).toBeGreaterThan(100);
  });

  test("constellations: none draws no lines and no names", () => {
    const r = win({ constellations: "none" });
    expect(r.order).not.toContain("figures");
    expect(r.order.filter((id) => id.startsWith("label_con_"))).toEqual([]);
    expect(r.order).toContain("stars");
  });

  test("constellations: lines draws lines and no names; names draws names and no lines", () => {
    const lines = win({ constellations: "lines" });
    expect(lines.order).toContain("figures");
    expect(lines.order.filter((id) => id.startsWith("label_con_"))).toEqual([]);
    const only = win({ constellations: "names" });
    expect(only.order).not.toContain("figures");
    expect(only.order.filter((id) => id.startsWith("label_con_")).length).toBeGreaterThan(0);
  });

  test("a constellation the author singles out leaves the group and becomes its own element", () => {
    const r = win({ mark: ["Orion"] });
    expect(r.order).toContain("con_ori");
    expect(r.order).toContain("figures");
    const own = flattenDrawables(r.drawables).filter((d) => d.id.startsWith("con_ori__"));
    expect(own.length).toBeGreaterThanOrEqual(15);
    expect(flattenDrawables(r.drawables).some((d) => d.id.startsWith("figures__Ori"))).toBe(false);
    // highlight tints it as well as lifting it.
    const hot = flattenDrawables(win({ highlight: ["Orion"] }).drawables).find((d) => d.id.startsWith("con_ori__")) as StrokeDrawable;
    expect(hot.style.color).toBe("#8a5fa8");
  });

  test("a figure draws in about a second however many lines it has", () => {
    // The group-duration trap again: Sagittarius has 29 edges, and 29 strokes
    // at SKETCH_MS.stroke would be forty seconds of drawing.
    const r = win({ mark: ["Orion"] });
    const total = flattenDrawables(r.drawables).filter((d) => d.id.startsWith("con_ori__")).reduce((n, d) => n + d.drawOpts.duration, 0);
    expect(total).toBeLessThan(2000);
    const field = flattenDrawables(r.drawables).filter((d) => d.id.startsWith("figures__")).reduce((n, d) => n + d.drawOpts.duration, 0);
    expect(field).toBeLessThan(4000);
  });
});

describe("sky_map: names on a crowded chart", () => {
  const WINTER = "2026-12-20T21:00:00Z";
  const win = (params: Record<string, unknown>) => scenes.sky_map.layout!({ time: WINTER, ...params });
  const namesOf = (r: ReturnType<typeof win>) => r.order.filter((id) => id.startsWith("label_con_"));

  // The guard against the cheap fix. A name is written only where it costs
  // nothing, which is what makes the sweep clean — so the sweep alone would
  // also pass a template that wrote NO names at all. These are the floor.
  test("the default chart names a real handful of constellations", () => {
    expect(namesOf(win({})).length).toBeGreaterThanOrEqual(5);
  });

  test("Orion is named on a December evening over Oslo", () => {
    expect(namesOf(win({}))).toContain("label_con_ori");
  });

  test("three languages give three different words on the page", () => {
    const at = (params: Record<string, unknown>) => {
      const d = flattenDrawables(win(params).drawables).find((x) => x.id === "label_con_uma");
      return d && d.kind === "text" ? d.text : undefined;
    };
    expect(at({ focus: "UMa" })).toBe("The Great Bear");
    expect(at({ focus: "UMa", names: "la" })).toBe("Ursa Major");
    expect(at({ focus: "UMa", names: "nb" })).toBe("Store bjørn");
    expect(at({ focus: "UMa", names: "none" })).toBeUndefined();
  });

  test("a name is never written where it would cross a line or another name", () => {
    // The same rule lint applies, applied here to the names this layout placed
    // itself — which is the only reason it is allowed to place them.
    const r = layoutSpec(spec({ time: WINTER }));
    expect(r.issues.filter((i) => i.ids.some((id) => id.startsWith("label_"))).map((i) => i.message)).toEqual([]);
  });
});

describe("sky_map: focus — one figure, filling the page", () => {
  const WINTER = "2026-12-20T21:00:00Z";
  const win = (params: Record<string, unknown>) => scenes.sky_map.layout!({ time: WINTER, ...params });

  test("focus draws that figure alone, names it, and gives every one of its stars an id", () => {
    const r = win({ focus: "Orion" });
    expect(r.order).toContain("con_ori");
    expect(r.order).not.toContain("figures");
    expect(r.order).toContain("label_con_ori");     // a portrait ALWAYS names its subject
    expect(r.order).toContain("frame");
    expect(r.order).not.toContain("horizon");       // the crop does not keep the rim
    const ori = sky.findConstellation("Ori")!;
    for (const h of sky.edgeStars(ori)) {
      const s = sky.star(h)!;
      expect(r.order, `HIP ${h}`).toContain(sky.starId(s));
    }
    expect(r.order).toContain("betelgeuse");
    expect(r.order).toContain("rigel");
  });

  test("the frame owns no clicks — it is a border, not a region", () => {
    const r = layoutSpec(spec({ time: WINTER, focus: "Orion" }));
    expect(r.order).toContain("frame");
    expect([...elementRings(r).keys()]).not.toContain("frame");
  });

  test("the portrait really is bigger than the same figure on the whole sky", () => {
    const span = (params: Record<string, unknown>): number => {
      const b = elementBBoxes(layoutSpec(spec({ time: WINTER, ...params }))).get("con_ori")!;
      return Math.max(b.w, b.h);
    };
    expect(span({ focus: "Orion" })).toBeGreaterThan(2 * span({ mark: ["Orion"] }));
  });

  test("focus resolves however the model spells it", () => {
    for (const q of ["Orion", "orion", "Ori", "con_ori"]) {
      expect(win({ focus: q }).order, q).toContain("con_ori");
    }
    expect(textOf(win({ focus: "Krypton" }), "sky_note")).toContain("Unknown: Krypton");
    expect(win({ focus: "Krypton" }).order).toContain("horizon");   // falls back to the whole sky
  });

  test("a figure entirely below the horizon is SAID, not silently blank", () => {
    // Crux never rises over Oslo.
    const r = win({ focus: "Crux" });
    expect(textOf(r, "sky_note")).toContain("Below the horizon: The Southern Cross");
    expect(r.order).toContain("horizon");
    expect(r.order).toContain("stars");
  });
});
```

Replace the sweep's `test.each` table with the full one (the Task 4 rows plus these):

```ts
  test.each([
    ["the default figure", {}],
    ["in Norwegian", { names: "nb" }],
    ["in Latin", { names: "la" }],
    ["with no names at all", { names: "none" }],
    ["from Tromsø", { lat: 69.65, lon: 18.96, place: "Tromsø" }],
    ["from the equator", { lat: 0, lon: 0, place: "The equator" }],
    ["from Sydney", { lat: -33.87, lon: 151.21, place: "Sydney" }],
    ["with only the brightest stars", { limit_mag: 2 }],
    ["with a title over it", { title: "The sky over Oslo tonight" }],
    ["with a planet named that is sometimes down", { show: ["jupiter", "saturn"] }],
    ["with a star singled out", { mark: ["Vega"], highlight: ["Sirius"] }],
    ["with an unknown name", { show: ["planets", "krypton"] }],
    ["with lines but no names", { constellations: "lines" }],
    ["with names but no lines", { constellations: "names" }],
    ["with a constellation singled out", { mark: ["Orion"], highlight: ["Cassiopeia"] }],
    ["a portrait of Orion", { focus: "Orion" }],
    ["a portrait of the Plough", { focus: "Ursa Major" }],
    ["a portrait of Cassiopeia in Norwegian", { focus: "Cassiopeia", names: "nb" }],
  ])("%s is lint-clean on every one of 200 moments", (_what, params) => {
    const { dirty, count } = sweep(params);
    expect(dirty).toEqual([]);
    expect(count).toBe(0);
  });
```

And add the translation guard beside it — the same limit round 1 documented:

```ts
  test("a copy translated into a language the pack does not know keeps its names apart", () => {
    // applyTextMap runs AFTER this body (src/layout/layout.ts:111), so every
    // clearance was measured for the word written HERE. A character of
    // headroom is what the layout buys; this is the size of what it buys.
    const text_map = {
      Orion: "Orione", "The Great Bear": "Orsa Maggiore", "The Little Bear": "Orsa Minore",
      Cassiopeia: "Cassiopea", "The Bull": "Toro", "The Twins": "Gemelli", "The Charioteer": "Auriga",
      Sirius: "Sirio", Vega: "Vega", "The Sun is up — these stars are there, but you cannot see them": "Il Sole è alto",
    };
    let residual = 0;
    for (const time of moments(40)) {
      const res = layoutSpec({ template: "sky_map", params: { time }, elements: [], text_map } as never);
      expect(res.issues.filter((i) => i.rule === "overlap-label-label").map((i) => i.message), time).toEqual([]);
      residual += res.issues.length;
    }
    expect(residual).toBeLessThanOrEqual(3);
  });
```

Append to `tests/sky-hit.test.ts`:

```ts
describe("a constellation answers for its own patch of sky", () => {
  const WINTER = "2026-12-20T21:00:00Z";
  test("a click inside a singled-out figure answers that figure", () => {
    expect(clickOn({ time: WINTER, mark: ["Orion"] }, "con_ori")).toBe("con_ori");
  });

  test("a click on a named star inside it answers the star, which is the smaller thing", () => {
    // Smallest box wins (src/ui/hit.ts pass 2), and that is the right answer:
    // a click ON Betelgeuse means Betelgeuse. This is why the constellation
    // questions in this round are quizzes and typed answers, not click asks.
    expect(clickOn({ time: WINTER, mark: ["Orion", "Betelgeuse"] }, "betelgeuse")).toBe("betelgeuse");
  });

  test("in a portrait every star of the figure answers for itself", () => {
    const params = { time: WINTER, focus: "Orion" };
    for (const id of ["betelgeuse", "rigel"]) expect(clickOn(params, id), id).toBe(id);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/sky-template.test.ts tests/sky-hit.test.ts`
Expected: FAIL — the new describes fail on `expect(r.order).toContain("figures")`; the existing Task 4 describes still pass.

- [ ] **Step 3: Add the two params to the manifest**

In the `sky_map` document's `params.properties`, after `limit_mag`:

```yaml
    constellations:
      type: string
      enum: [both, lines, names, none]
      description: "both (default): the figures drawn and the ones that have room named. lines: the figures with no names. names: names with no lines. none: neither. The chart names as many as it can place cleanly, largest first — a star chart names what it has room for, the way an atlas does."
    focus:
      type: string
      description: "One constellation — its abbreviation (Ori), its Latin, English or Norwegian name, or its element id (con_ori). That figure alone fills the page, magnified, with EVERY one of its own stars given its own element id (a proper name where it has one, else hip_<number>) so a question can name any of them; the horizon goes and a dashed frame says this is a detail. A figure that is entirely below the horizon is said so in the caption and the whole sky is drawn instead."
      x-translate: false
```

And add to `element_ids`:

```yaml
  figures: every constellation's lines that is not singled out, as one element — what an author draws when the shapes come out
  con_<abbr>: a constellation named in mark, highlight or focus becomes its own element — con_ori, con_uma, con_cas
  label_con_<abbr>: that constellation's written name, in the language names chose
  hip_<number>: under focus, a star of that figure with no proper name of its own
  frame: a light dashed border around the crop (focus only)
```

Extend the `description` with a sentence after the `mark` sentence:

```
  The constellation figures are ONE element too, `figures`, for the same
  reason; `mark: ["Orion"]`, `highlight` or `focus` lifts one out as
  `con_ori`, and `focus` magnifies it to fill the page with every one of its
  own stars addressable. The figures come from a bundled answer key — each is
  stored as pairs of catalogue stars, so what is drawn and what a question
  grades against are the same thing.
```

And a fourth manifest example:

```yaml
  - request: "Where is Orion in the winter sky?"
    params: { time: "2026-12-20T21:00:00Z", mark: ["Orion"], names: "la" }
```

- [ ] **Step 4: Add the constellation block to the layout body**

Four edits inside the `sky_map` layout, in order.

**(a) `take` learns constellations** — replace the helper and the two loops from Task 4 with:

```js
  const markStars = new Set(), markBodies = new Set(), markCons = new Set();
  const litStars = new Set(), litBodies = new Set(), litCons = new Set();
  // Constellation first: "Leo" and "Orion" are figures, and no star carries
  // either name, so the order is unambiguous and it is the commoner ask.
  const take = (q, stars, bodies, cons) => {
    const c = eng.findConstellation(q);
    if (c) { cons.add(c.abbr); return true; }
    const s = eng.findStar(q);
    if (s) { stars.add(s.hip); return true; }
    const b = spc.bodies([q]);
    if (b.bodies[0]) { bodies.add(b.bodies[0].id); return true; }
    return false;
  };
  for (const q of list(params.mark)) if (!take(q, markStars, markBodies, markCons)) unknown.push(q.trim());
  for (const q of list(params.highlight)) {
    if (take(q, litStars, litBodies, litCons)) take(q, markStars, markBodies, markCons);
    else unknown.push(q.trim());
  }
  const conMode = oneOf(params.constellations, ["both", "lines", "names", "none"], "both");
  let focusCon = null;
  if (typeof params.focus === "string" && params.focus.trim() !== "") {
    const c = eng.findConstellation(params.focus);
    if (c) focusCon = c; else unknown.push(params.focus.trim());
  }
```

**(b) the figures, resolved BEFORE the caption** — insert immediately after `const sPos = eng.starPositions(at, lat, lon);` (which must therefore move up, above the caption block; it has no dependency on it):

```js
  // An edge is drawn only when BOTH its stars are above the horizon. A line
  // running off into the ground is not what a setting constellation looks
  // like: its lower half is simply gone, and that is what a viewer sees.
  const segsOf = (c) => c.edges.filter((e) => {
    const pa = sPos.get(e[0]), pb = sPos.get(e[1]);
    return pa !== undefined && pb !== undefined && pa.alt >= 0 && pb.alt >= 0;
  });
  if (focusCon && segsOf(focusCon).length === 0) { below.push(eng.name(focusCon, L)); focusCon = null; }
  const drawnCons = [];
  if (focusCon) {
    drawnCons.push({ c: focusCon, segs: segsOf(focusCon) });
  } else if (conMode !== "none") {
    for (const c of eng.constellations()) { const s = segsOf(c); if (s.length > 0) drawnCons.push({ c: c, segs: s }); }
  }
  // A star a drawn line reaches is drawn whatever limit_mag says: 119 of the
  // 750 stars the figures need are fainter than 4.5, and a line ending at
  // nothing is a lie about the sky.
  const lineStars = new Set();
  for (const d of drawnCons) for (const e of d.segs) { lineStars.add(e[0]); lineStars.add(e[1]); }
  const lifted = new Set(markCons);
  if (focusCon) lifted.add(focusCon.abbr);
```

`below` is declared in Task 4's body block, which now has to come before this — move the `below`/`bPos`/`showIds` block up so it precedes this one, and the caption block down so it follows. The order that works is: params → mark/highlight/focus → bodies → stars positions → figures → captions → geometry.

**(c) the zoom, and every projection through it** — after the figures block:

```js
  // A portrait is the same projection through a magnifying glass: the figure's
  // own stars are projected as usual, then the plane is scaled and shifted to
  // fill the frame. Nothing about the geometry changes — the stretch near the
  // rim is inherited honestly — and the crop is why the horizon is not drawn.
  let zoom = 1, Z = (q) => q;
  if (focusCon) {
    const pts = eng.edgeStars(focusCon).map((h) => sPos.get(h)).filter((p) => p !== undefined && p.alt >= 0).map((p) => eng.project(p, CH));
    const xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1]);
    const x0 = Math.min.apply(null, xs), x1 = Math.max.apply(null, xs);
    const y0 = Math.min.apply(null, ys), y1 = Math.max.apply(null, ys);
    const pad = 110;                          // room for the names and the frame
    zoom = Math.min(6, Math.max(1, Math.min((F.x1 - F.x0 - 2 * pad) / Math.max(1, x1 - x0), (F.y1 - F.y0 - 2 * pad) / Math.max(1, y1 - y0))));
    const bx = (x0 + x1) / 2, by = (y0 + y1) / 2;
    Z = (q) => [500 + (q[0] - bx) * zoom, 390 + (q[1] - by) * zoom];
  }
  const P = (p) => Z(eng.project(p, CH));
  const dotScale = Math.min(2, 0.5 + 0.5 * zoom);
```

Delete Task 4's `const P = (p) => eng.project(p, CH);` — this replaces it.

**(d) stars, lines, frame and names.** In the star loop, the filter and the radius become:

```js
  for (const s of eng.stars()) {
    const p = sPos.get(s.hip);
    if (!p || p.alt < 0) continue;
    const singled = markStars.has(s.hip) || (focusCon !== null && lineStars.has(s.hip));
    if (s.mag > limit && !singled && !lineStars.has(s.hip)) continue;
    const at2 = P(p);
    // A portrait crops: a star projected outside the frame is off the page.
    if (focusCon && (at2[0] < F.x0 || at2[0] > F.x1 || at2[1] < F.y0 || at2[1] > F.y1)) continue;
    (singled ? own : field).push({ s: s, at: at2, r: eng.starRadius(s.mag) * dotScale });
  }
```

Where Task 4 built `horizonPts`, wrap it: `const horizonPts = focusCon ? null : (…)`, and build the frame instead:

```js
  // Traced as an open path that returns to its start, NOT closed: true — the
  // same reason as the horizon, and the exact bug round 1 shipped.
  const framePts = focusCon ? [[F.x0, F.y0], [F.x1, F.y0], [F.x1, F.y1], [F.x0, F.y1], [F.x0, F.y0]] : null;
```

Build the drawn segments before names, so a name can avoid them:

```js
  const segPts = {};                     // abbr -> [[Pt, Pt], …] in canvas units
  for (const d of drawnCons) {
    segPts[d.c.abbr] = d.segs.map((e) => [P(sPos.get(e[0])), P(sPos.get(e[1]))]);
  }
  const showLines = conMode !== "names" || focusCon !== null;
  if (showLines) for (const d of drawnCons) for (const s of segPts[d.c.abbr]) guides.push(s);
  if (horizonPts) guides.push(horizonPts);
  if (framePts) guides.push(framePts);
```

(Task 4's `const guides = [horizonPts];` becomes `const guides = [];` and the two pushes above take its place.)

Names, after the body and star names:

```js
  // Constellation names, largest figure first — the one an eye finds first is
  // the one worth naming — and only where the name costs NOTHING. A portrait
  // is the exception: its subject is the whole point of the page, so its name
  // is placed at the cheapest spot rather than only a free one.
  const showConNames = names !== "none" && (conMode === "both" || conMode === "names" || focusCon !== null);
  if (showConNames) {
    const jobs = drawnCons.map((d) => {
      const pts = segPts[d.c.abbr].reduce((a, s) => a.concat(s), []);
      const xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1]);
      const x0 = Math.min.apply(null, xs), x1 = Math.max.apply(null, xs);
      const y0 = Math.min.apply(null, ys), y1 = Math.max.apply(null, ys);
      return { d: d, at: [(x0 + x1) / 2, (y0 + y1) / 2], e: Math.max(x1 - x0, y1 - y0) / 2, span: (x1 - x0) * (y1 - y0) };
    });
    jobs.sort((a, b) => b.span - a.span);
    const RING = [0, 1, -1, 2, -2, 3, -3, 4].map((m) => (m * Math.PI) / 4);
    for (const j of jobs) {
      place(
        "label_" + eng.conId(j.d.c), j.at, Math.min(j.e, 90), eng.name(j.d.c, L),
        litCons.has(j.d.c.abbr) ? C.accent : C.ink,
        RING.map((t) => t - Math.PI / 2), [6, 22, 40],
        focusCon === null,
      );
    }
  }
```

Finally the ink, inserted between the horizon/compass block and the star field so lines sit under the dots:

```js
  if (framePts) push(kit.stroke("frame", framePts, { color: C.guide, strokeWidth: 1.5, dash: true, ms: MS.guides }));
  if (showLines) {
    // A group's leaf durations accumulate, so a figure's edges share a budget:
    // Sagittarius has 29 of them, and 29 full strokes would be forty seconds.
    const loose = drawnCons.filter((d) => !lifted.has(d.c.abbr));
    const total = loose.reduce((n, d) => n + d.segs.length, 0);
    if (total > 0) {
      const per = Math.max(4, Math.round(2600 / total));
      const kids = [];
      for (const d of loose) segPts[d.c.abbr].forEach((s, i) => kids.push(kit.stroke("figures__" + d.c.abbr + "_" + i, s, { color: C.guide, strokeWidth: 1.2, ms: per })));
      push(kit.group("figures", kids));
      anchors.figures = [CH.cx, CH.cy];
    }
    for (const d of drawnCons) {
      if (!lifted.has(d.c.abbr)) continue;
      const on = litCons.has(d.c.abbr), id = eng.conId(d.c);
      const per = Math.max(20, Math.round(1200 / Math.max(1, d.segs.length)));
      push(kit.group(id, segPts[d.c.abbr].map((s, i) => kit.stroke(id + "__" + i, s, { color: on ? C.accent : C.guide, strokeWidth: on ? 2.5 : 1.6, ms: per }))));
      anchors[id] = segPts[d.c.abbr][0][0];
    }
  }
```

And guard the horizon push: `if (horizonPts) push(kit.stroke("horizon", …));`, with the compass drawn only when there is a horizon to hang it on: `if (horizonPts) for (const c of compass) { … }`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/sky-template.test.ts tests/sky-hit.test.ts`
Expected: PASS.

If a sweep row fails, read the moment and the rule it names and reproduce it alone:

```bash
npx vitest run tests/sky-template.test.ts -t "is lint-clean on every one of 200 moments"
```

The remedy is always the placement, never the bar: widen `place`'s candidate set, or add the missing obstacle to `guides`/`written`/`discs`. Do not lower `issues` to errors, do not stop drawing lines, and do not silence a name that the floor tests require.

- [ ] **Step 6: Run everything**

Run: `npm test` — expected: all pass.
Run: `npx tsc --noEmit` — expected: no output.

- [ ] **Step 7: Commit**

```bash
git add src/scenes/packs/space.yaml tests/sky-template.test.ts tests/sky-hit.test.ts
git commit -m "The figures, and names for as many of them as the page will hold

The lines are drawn from the answer key itself — pairs of catalogue stars —
so what a viewer sees and what a question grades against cannot drift apart.
An edge is drawn only when both its stars are up, which is what a setting
constellation actually looks like. Names take a free spot or none: a star
chart names what it has room for, and a name lying across a line is worse
than no name. A portrait is the exception, because its subject is the page.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01RWSwWnc8ToCq7H2pXdvXHY"
```

---

### Task 6: The ⊕ Space section learns the sky

The Body section's twin, one more time: click a star or a constellation on the chart to read about it, pills for the hour, the date and where you are standing. Same `explore: { space: true }` flag, same overlay class, same preview-through-overrides discipline — a different section because the sky's rules are not the solar system's.

**Files:**
- Create: `src/ui/sky-model.ts`
- Create: `src/ui/sky-explore.ts`
- Modify: `src/ui/tray.ts` (line 129 `spaceTemplate`; the import at line 36; the mount at lines 522-527)
- Modify: `src/ui/tray-model.ts` (two doc comments that say "solar_system")
- Modify: `src/spec/schema.ts:370-374` and `src/spec/types.ts:302` (the `explore.space` wording)
- Test: `tests/sky-model.test.ts`

**Interfaces:**
- Consumes: `engines.sky` (Task 3) and the chart the template drew (Tasks 4-5) — the section projects the same positions with `engines.sky.chart`, which is why that constant lives in the engine and not in the YAML.
- Produces: `mountSkySection(opts: { hd: RenderHandle; stage: HTMLElement | null; overrides: Record<string, unknown>; repaint(): void }): SpaceSection` — the same `{ el, destroy }` shape `mountSpaceSection` returns, so `tray.ts` holds one variable for either.

**Why the section hit-tests itself.** `hitElement` answers with element ids, and on this chart the star field is ONE element — a click inside it would only ever say "the stars". The section has the engine and the same `chart` constant the template used, so it projects the positions itself and finds the nearest star or line. That is also why `engines.sky.chart` is a value on the engine rather than a number in the YAML: two readers, one definition, and `tests/sky-template.test.ts` already asserts the template draws at it.

- [ ] **Step 1: Write the failing test**

`tests/sky-model.test.ts`:

```ts
// The sky section's rules, DOM-free: what a click on the chart means, what the
// card says, which Wikipedia article to ask for, and what the pills offer.
// The DOM half (sky-explore.ts) has no unit tests, the same split the anatomy
// Body section and the round-1 Space section use — which is a reason to keep
// that file thin, not an excuse.

import { beforeAll, describe, expect, test } from "vitest";
import { ensureEngines, getLoadedEngines } from "../src/scenes/engines";
import type { SkyEngine } from "../src/scenes/space/sky-types";
import {
  DAY_CHOICES, HOUR_CHOICES, conWikiTitle, constellationFacts, starFacts, starWikiTitle, targetAt,
} from "../src/ui/sky-model";

let sky: SkyEngine;
beforeAll(async () => {
  await ensureEngines(["sky"]);
  sky = getLoadedEngines(["sky"]).sky as SkyEngine;
});

describe("what a click on the chart means", () => {
  const stars = [
    { hip: 1, at: [100, 100] as [number, number] },
    { hip: 2, at: [400, 400] as [number, number] },
  ];
  const segs = [{ abbr: "Ori", a: [200, 200] as [number, number], b: [300, 200] as [number, number] }];

  test("a click on a star is that star, and the nearest one wins", () => {
    expect(targetAt([102, 103], stars, segs)).toEqual({ kind: "star", hip: 1 });
    expect(targetAt([398, 401], stars, segs)).toEqual({ kind: "star", hip: 2 });
  });

  test("a click on a line is its constellation — a star still wins when both are near", () => {
    expect(targetAt([250, 204], stars, segs)).toEqual({ kind: "constellation", abbr: "Ori" });
    // A star inside the slop beats a line inside the slop: the smaller,
    // definite thing is what the viewer aimed at.
    expect(targetAt([205, 202], [{ hip: 9, at: [205, 203] }], segs)).toEqual({ kind: "star", hip: 9 });
  });

  test("a click on empty sky is nothing, not the nearest thing on the page", () => {
    expect(targetAt([700, 700], stars, segs)).toBeNull();
  });

  test("the slop is a real radius, not a bounding box", () => {
    expect(targetAt([100, 113], stars, [], 14)).toEqual({ kind: "star", hip: 1 });
    expect(targetAt([110, 110], stars, [], 14)).toBeNull();   // 14.1 away, diagonally
  });
});

describe("the card", () => {
  test("a star's card carries the facts a chart cannot draw", () => {
    const s = sky.findStar("Betelgeuse")!;
    const facts = starFacts(s, { alt: 32.5, az: 128.4 }, "en");
    const label = (k: string) => facts.find((f) => f.label === k)?.value;
    expect(label("Magnitude")).toMatch(/^0\.\d/);
    expect(label("Colour")).toMatch(/red|orange/i);
    expect(label("Altitude")).toBe("33° above the horizon");
    expect(label("Direction")).toMatch(/south-east/i);
    // Below the horizon is said, not shown as a negative number.
    expect(starFacts(s, { alt: -4, az: 10 }, "en").find((f) => f.label === "Altitude")!.value).toMatch(/below the horizon/i);
    // No position at all (the tray asked before the sky was computed).
    expect(starFacts(s, null, "en").some((f) => f.label === "Altitude")).toBe(false);
    expect(starFacts(s, null, "nb").some((f) => f.label === "Lysstyrke")).toBe(true);
  });

  test("a constellation's card gives all three names, its size and its brightest star", () => {
    const c = sky.findConstellation("Ori")!;
    const brightest = sky.stars().filter((s) => sky.edgeStars(c).includes(s.hip)).reduce((a, b) => (b.mag < a.mag ? b : a));
    const facts = constellationFacts(c, brightest, sky.edgeStars(c).length, "en");
    const label = (k: string) => facts.find((f) => f.label === k)?.value;
    expect(label("Latin")).toBe("Orion");
    expect(label("Norwegian")).toBe("Orion");
    expect(label("Brightest star")).toMatch(/^(Rigel|Betelgeuse)/);
    expect(label("Stars in the figure")).toBe(String(sky.edgeStars(c).length));
    expect(constellationFacts(c, null, 0, "nb").find((f) => f.label === "Latin")!.value).toBe("Orion");
  });
});

describe("Wikipedia", () => {
  test("a constellation's article is disambiguated in each language", () => {
    const c = sky.findConstellation("Ori")!;
    expect(conWikiTitle(c, "en")).toBe("Orion (constellation)");
    expect(conWikiTitle(c, "nb")).toBe("Orion (stjernebilde)");
    expect(conWikiTitle(c, "la")).toBe("Orion (constellation)");
  });

  test("a star's article is its proper name, in the language's own spelling", () => {
    expect(starWikiTitle(sky.findStar("Sirius")!, "en")).toBe("Sirius");
    expect(starWikiTitle(sky.findStar("Polaris")!, "nb")).toBe("Polarstjernen");
    expect(starWikiTitle(sky.findStar("Polaris")!, "en")).toBe("Polaris");
  });
});

describe("the pills", () => {
  test("the hour and the date offer what a lesson about the sky needs", () => {
    expect(HOUR_CHOICES.map((c) => c.value)).toEqual([0, 1, 6]);
    expect(DAY_CHOICES.map((c) => c.value)).toEqual([0, 30, 182]);
    for (const c of [...HOUR_CHOICES, ...DAY_CHOICES]) {
      expect(c.label.en.trim()).not.toBe("");
      expect(c.label.nb.trim()).not.toBe("");
    }
  });

  test("the places are the engine's own four, so the tray and the chart agree", () => {
    expect(sky.places().map((p) => p.id)).toEqual(["oslo", "bergen", "tromso", "equator"]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/sky-model.test.ts`
Expected: FAIL — `Failed to resolve import "../src/ui/sky-model"`.

- [ ] **Step 3: Write `src/ui/sky-model.ts`**

```ts
// The Sky section's rules, DOM-free: what a click on the chart means, the
// pills' choices, the card's lines and which Wikipedia article to ask for.
// tray.ts and sky-explore.ts render them; tests hold them against the real
// tables. Imports only the light half — never sky.ts, so astronomy-engine
// stays in the engine's lazy chunk.

import { starColor, STAR_TINTS } from "../scenes/space/sky-rules";
import type { AltAz, Constellation, SkyLang, Star } from "../scenes/space/sky-types";
import type { Choice, Fact } from "./space-model";

export type Pt = [number, number];

export type SkyTarget =
  | { kind: "star"; hip: number }
  | { kind: "constellation"; abbr: string };

const dist2 = (a: Pt, b: Pt): number => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2;

/** Squared distance from a point to a segment. */
function segDist2(p: Pt, a: Pt, b: Pt): number {
  const vx = b[0] - a[0], vy = b[1] - a[1];
  const len = vx * vx + vy * vy;
  if (len === 0) return dist2(p, a);
  let t = ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / len;
  t = Math.max(0, Math.min(1, t));
  return dist2(p, [a[0] + t * vx, a[1] + t * vy]);
}

/**
 * What a click on the chart means: the nearest drawn star within `slop`, else
 * the constellation whose lines pass closest within `slop`, else nothing.
 *
 * The section hit-tests itself rather than going through hitElement, because
 * the star field is ONE element (`draw` has no wildcard, so it has to be) and
 * a click inside it would otherwise only ever answer "the stars". A star beats
 * a line at equal distance: the smaller, definite thing is what was aimed at.
 */
export function targetAt(
  p: Pt,
  stars: readonly { hip: number; at: Pt }[],
  segs: readonly { abbr: string; a: Pt; b: Pt }[],
  slop = 14,
): SkyTarget | null {
  const r2 = slop * slop;
  let bestStar: number | null = null, bestStarD = r2;
  for (const s of stars) {
    const d = dist2(p, s.at);
    if (d <= bestStarD) { bestStarD = d; bestStar = s.hip; }
  }
  if (bestStar !== null) return { kind: "star", hip: bestStar };
  let bestCon: string | null = null, bestConD = r2;
  for (const s of segs) {
    const d = segDist2(p, s.a, s.b);
    if (d <= bestConD) { bestConD = d; bestCon = s.abbr; }
  }
  return bestCon === null ? null : { kind: "constellation", abbr: bestCon };
}

/** Offsets in hours from the figure's own moment. */
export const HOUR_CHOICES: Choice<number>[] = [
  { value: 0, label: { en: "Now", nb: "Nå" } },
  { value: 1, label: { en: "+1 hour", nb: "+1 time" } },
  { value: 6, label: { en: "+6 hours", nb: "+6 timer" } },
];

/** Offsets in days — a month and half a year, because half a year is when the
 *  same hour of night shows the opposite sky, and that is the lesson. */
export const DAY_CHOICES: Choice<number>[] = [
  { value: 0, label: { en: "Tonight", nb: "I kveld" } },
  { value: 30, label: { en: "+1 month", nb: "+1 måned" } },
  { value: 182, label: { en: "+6 months", nb: "+6 måneder" } },
];

const COMPASS_16 = {
  en: ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"],
  nb: ["nord", "nordøst", "øst", "sørøst", "sør", "sørvest", "vest", "nordvest"],
};

/** An azimuth as a word: what a viewer needs in order to go outside and look. */
export function directionWord(az: number, lang: SkyLang): string {
  const i = Math.round((((az % 360) + 360) % 360) / 45) % 8;
  return (lang === "nb" ? COMPASS_16.nb : COMPASS_16.en)[i];
}

const COLOUR_WORD: Record<string, { en: string; nb: string }> = {
  "#42618c": { en: "blue", nb: "blå" },
  "#4f6f8e": { en: "blue-white", nb: "blåhvit" },
  "#66697a": { en: "white", nb: "hvit" },
  "#7d6540": { en: "yellow", nb: "gul" },
  "#8d5932": { en: "orange", nb: "oransje" },
  "#94472a": { en: "red", nb: "rød" },
};

/** The colour the dot is drawn in, in words — the same band, so the card can
 *  never disagree with the page. */
export function colourWord(bv: number | null, lang: SkyLang): string {
  const w = COLOUR_WORD[starColor(bv)] ?? COLOUR_WORD[STAR_TINTS[2].color];
  return lang === "nb" ? w.nb : w.en;
}

const dec = (s: string, lang: SkyLang): string => (lang === "nb" ? s.replace(".", ",") : s);

/** A star's card: what the chart cannot draw. `at` is where it is right now,
 *  or null when the section has no position for it. */
export function starFacts(s: Star, at: AltAz | null, lang: SkyLang): Fact[] {
  const t = (en: string, nb: string): string => (lang === "nb" ? nb : en);
  const facts: Fact[] = [
    { label: t("Magnitude", "Lysstyrke"), value: dec(s.mag.toFixed(2), lang) },
    { label: t("Colour", "Farge"), value: colourWord(s.bv, lang) },
    { label: t("Catalogue", "Katalog"), value: `HIP ${s.hip}` },
  ];
  if (at) {
    facts.push({
      label: t("Altitude", "Høyde"),
      value: at.alt < 0
        ? t("below the horizon", "under horisonten")
        : `${Math.round(at.alt)}° ${t("above the horizon", "over horisonten")}`,
    });
    facts.push({ label: t("Direction", "Retning"), value: `${directionWord(at.az, lang)} (${Math.round(at.az)}°)` });
  }
  return facts;
}

/** A constellation's card: the three names side by side — which is the point,
 *  since the same figure is three different words and a question has to say
 *  which one it wants. */
export function constellationFacts(c: Constellation, brightest: Star | null, starCount: number, lang: SkyLang): Fact[] {
  const t = (en: string, nb: string): string => (lang === "nb" ? nb : en);
  const facts: Fact[] = [
    { label: t("Latin", "Latin"), value: c.name.la },
    { label: t("English", "Engelsk"), value: c.name.en },
    { label: t("Norwegian", "Norsk"), value: c.name.nb },
    { label: t("Abbreviation", "Forkortelse"), value: c.abbr },
  ];
  if (brightest && brightest.name) {
    facts.push({ label: t("Brightest star", "Klareste stjerne"), value: `${brightest.name} (${dec(brightest.mag.toFixed(2), lang)})` });
  }
  if (starCount > 0) facts.push({ label: t("Stars in the figure", "Stjerner i figuren"), value: String(starCount) });
  return facts;
}

/** Wikipedia disambiguates constellations, and does it differently per
 *  language. A title that misses gives a 404, which the card already survives:
 *  the table's facts stand alone. */
export function conWikiTitle(c: Constellation, lang: SkyLang): string {
  return lang === "nb" ? `${c.name.la} (stjernebilde)` : `${c.name.la} (constellation)`;
}

export function starWikiTitle(s: Star, lang: SkyLang): string {
  return (lang === "nb" && s.name_nb ? s.name_nb : s.name) ?? `HIP ${s.hip}`;
}
```

- [ ] **Step 4: Write `src/ui/sky-explore.ts`**

The DOM glue, deliberately thin — every rule above lives in `sky-model.ts`, where a test can pin it.

```ts
// The Sky section of the explore tray: click a star or a constellation on the
// chart to read about it, pills for the hour, the date and where you stand.
// Every action is a PREVIEW through the tray's overrides → repaint, so
// Continue restores the lesson. The rules and the wording live in sky-model.
//
// The click overlay does NOT use hitElement: the star field is one element and
// a click inside it would only ever answer "the stars". This section has the
// engine and the same `chart` the template drew at, so it projects the
// positions itself — see targetAt in sky-model.ts.

import type { RenderHandle } from "../render";
import { getLoadedEngines } from "../scenes/engines";
import type { SkyEngine, SkyLang } from "../scenes/space/sky-types";
import { h, logicalPoint } from "./dom";
import { loadWikiSummary } from "./space-explore";
import type { SpaceSection } from "./space-explore";
import { readWikiSummary, wikiSummaryUrl, type Choice } from "./space-model";
import {
  DAY_CHOICES, HOUR_CHOICES, conWikiTitle, constellationFacts, starFacts, starWikiTitle, targetAt,
  type SkyTarget,
} from "./sky-model";

const HINT: Record<"en" | "nb", string> = {
  en: "Click a star or a constellation to read about it; the pills move the hour, the date and where you are standing.",
  nb: "Klikk på en stjerne eller et stjernebilde for å lese om det; knappene flytter timen, datoen og stedet du står.",
};
const ROW: Record<"hour" | "date" | "place", Record<"en" | "nb", string>> = {
  hour: { en: "Hour", nb: "Time" },
  date: { en: "Date", nb: "Dato" },
  place: { en: "Place", nb: "Sted" },
};
const CREDIT = "Wikipedia, CC BY-SA";

export function mountSkySection(opts: { hd: RenderHandle; stage: HTMLElement | null; overrides: Record<string, unknown>; repaint(): void }): SpaceSection {
  const { hd, stage, overrides, repaint } = opts;
  const eng = getLoadedEngines(["sky"]).sky as SkyEngine;
  const authored = (hd.spec.params ?? {}) as Record<string, unknown>;
  const current = (): Record<string, unknown> => ({ ...authored, ...overrides });
  const lang = (): SkyLang => {
    const n = current().names;
    return n === "nb" || n === "la" ? n : "en";
  };
  const uiLang = (): "en" | "nb" => (lang() === "nb" ? "nb" : "en");
  const num = (v: unknown, d: number): number => (typeof v === "number" && Number.isFinite(v) ? v : d);
  const where = (): { lat: number; lon: number } => ({ lat: num(current().lat, 59.91), lon: num(current().lon, 10.75) });
  const moment = (): Date => {
    const w = where();
    return eng.resolveTime(current().time, current().hours, current().days, w.lon);
  };

  const el = h("div", { class: "cs-tray-body" });
  const hint = h("div", { class: "cs-tray-hint" });
  const pills = h("div", { class: "cs-body-pills" });
  const card = h("div", { class: "cs-space-card" });
  el.append(hint, pills, card);

  let target: SkyTarget | null = null;

  const pillRow = <T,>(title: string, choices: Choice<T>[], selected: (v: T) => boolean, pick: (v: T) => void): HTMLElement => {
    const row = h("div", { class: "cs-tray-row cs-body-pillrow" });
    row.appendChild(h("span", { class: "cs-tray-label" }, title));
    for (const c of choices) {
      const b = h("button", { class: `cs-cardgate-pill cs-tray-pill${selected(c.value) ? " selected" : ""}` }, c.label[uiLang()]);
      b.addEventListener("click", () => { pick(c.value); repaint(); render(); });
      row.appendChild(b);
    }
    return row;
  };

  /** Which target the card shows, so a summary that arrives late for another one is dropped. */
  let cardFor = "";
  const renderCard = (): void => {
    const L = lang(), U = uiLang();
    card.replaceChildren();
    if (!target) {
      card.appendChild(h("div", { class: "cs-space-note" }, U === "nb" ? "Ingenting valgt ennå." : "Nothing picked yet."));
      cardFor = "";
      return;
    }
    const w = where();
    let name: string, facts: { label: string; value: string }[], title: string;
    if (target.kind === "star") {
      const s = eng.star(target.hip)!;
      const at = eng.starPositions(moment(), w.lat, w.lon).get(s.hip) ?? null;
      name = eng.starName(s, L) ?? `HIP ${s.hip}`;
      facts = starFacts(s, at, L);
      title = starWikiTitle(s, L);
    } else {
      const c = eng.constellations().find((x) => x.abbr === target!.abbr)!;
      const hips = eng.edgeStars(c);
      const brightest = hips.map((x) => eng.star(x)).filter((x) => x !== undefined).reduce((a, b) => (b!.mag < a!.mag ? b : a), undefined as ReturnType<SkyEngine["star"]>) ?? null;
      name = eng.name(c, L);
      facts = constellationFacts(c, brightest, hips.length, L);
      title = conWikiTitle(c, L);
    }
    const key = `${target.kind}:${target.kind === "star" ? target.hip : target.abbr}`;
    cardFor = key;
    card.appendChild(h("div", { class: "cs-space-name" }, name));
    const dl = h("dl", { class: "cs-space-facts" });
    for (const f of facts) { dl.appendChild(h("dt", {}, f.label)); dl.appendChild(h("dd", {}, f.value)); }
    card.appendChild(dl);
    const wiki = h("div", { class: "cs-space-wiki" });
    card.appendChild(wiki);
    const wl = L === "nb" ? "nb" : "en";
    void loadWikiSummary(wl, title).then((s) => {
      if (!s || cardFor !== key || lang() !== L) return;
      if (s.thumb) wiki.appendChild(h("img", { src: s.thumb, alt: "", class: "cs-space-thumb" }));
      wiki.appendChild(h("p", { class: "cs-space-extract" }, s.extract));
      const credit = h("div", { class: "cs-space-credit" });
      credit.append(CREDIT, " · ");
      credit.appendChild(h("a", { href: s.page ?? wikiSummaryUrl(wl, title), target: "_blank", rel: "noopener" }, s.title || title));
      wiki.appendChild(credit);
    });
  };

  const render = (): void => {
    const U = uiLang();
    hint.textContent = HINT[U];
    pills.replaceChildren();
    const hours = num(current().hours, 0), days = num(current().days, 0);
    pills.appendChild(pillRow(ROW.hour[U], HOUR_CHOICES, (v) => v === hours, (v) => { overrides.hours = v; }));
    pills.appendChild(pillRow(ROW.date[U], DAY_CHOICES, (v) => v === days, (v) => { overrides.days = v; }));
    const w = where();
    pills.appendChild(
      pillRow(
        ROW.place[U],
        eng.places().map((p) => ({ value: p.id, label: p.name })),
        (id) => { const p = eng.places().find((q) => q.id === id)!; return Math.abs(p.lat - w.lat) < 0.01 && Math.abs(p.lon - w.lon) < 0.01; },
        (id) => {
          const p = eng.places().find((q) => q.id === id)!;
          overrides.lat = p.lat;
          overrides.lon = p.lon;
          overrides.place = eng.placeName(p, lang());
        },
      ),
    );
    renderCard();
  };

  // The click overlay: a layer over the stage, exempt from the tray's freeze
  // (tray.ts's freezeClick keeps .cs-spaceexplore's own clicks), resolving a
  // point against the SAME projection the template drew with.
  let overlay: HTMLElement | null = null;
  if (stage) {
    overlay = h("div", { class: "cs-spaceexplore" });
    overlay.addEventListener("click", (e) => {
      e.stopPropagation();
      const p = logicalPoint(stage, e);
      if (!p) return;
      const w = where();
      const at = moment();
      const pos = eng.starPositions(at, w.lat, w.lon);
      const limit = num(current().limit_mag, 4.5);
      const stars: { hip: number; at: [number, number] }[] = [];
      const segs: { abbr: string; a: [number, number]; b: [number, number] }[] = [];
      // The same two rules the template draws by: an edge needs both stars up,
      // and a star a drawn edge reaches is on the page whatever limit_mag says.
      const lineStars = new Set<number>();
      for (const c of eng.constellations()) {
        for (const [a, b] of c.edges) {
          lineStars.add(a);
          lineStars.add(b);
          const pa = pos.get(a), pb = pos.get(b);
          if (!pa || !pb || pa.alt < 0 || pb.alt < 0) continue;
          segs.push({ abbr: c.abbr, a: eng.project(pa, eng.chart), b: eng.project(pb, eng.chart) });
        }
      }
      for (const s of eng.stars()) {
        const q = pos.get(s.hip);
        if (!q || q.alt < 0) continue;
        if (s.mag > limit && !lineStars.has(s.hip)) continue;
        stars.push({ hip: s.hip, at: eng.project(q, eng.chart) });
      }
      const t = targetAt(p, stars, segs);
      if (!t) return;
      target = t;
      render();
    });
    stage.appendChild(overlay);
  }

  render();
  return {
    el,
    destroy() {
      cardFor = "";
      target = null;
      overlay?.remove();
      overlay = null;
    },
  };
}
```

One cleanup while typing this: `readWikiSummary` is in the import list and never used — `loadWikiSummary` already applies it — so drop it. `npx tsc --noEmit` will say so.

- [ ] **Step 5: Wire it into the tray**

`src/ui/tray.ts:36` — beside the round-1 import:

```ts
import { mountSkySection } from "./sky-explore";
```

`src/ui/tray.ts:127-129` — the comment and the flag:

```ts
  // An anatomy figure always has a body to explore, slider or no slider; a
  // solar-system figure its planets, and a sky map the sky over a place.
  const bodyTemplate = hd.spec.template === "anatomy";
  const spaceTemplate = hd.spec.template === "solar_system" || hd.spec.template === "sky_map";
```

`src/ui/tray.ts:522-527` — the mount picks the section by template. Both return `SpaceSection`, so the variable and the `destroy()` at line 305 are untouched:

```ts
    // The Space section, the Body section's twin — the solar system's planets,
    // or a sky map's stars and constellations.
    spaceSection?.destroy();
    spaceSection = null;
    if (plan.space) {
      spaceSection = hd.spec.template === "sky_map"
        ? mountSkySection({ hd, stage, overrides, repaint })
        : mountSpaceSection({ hd, stage, overrides, repaint });
      tray.appendChild(spaceSection.el);
    }
```

`src/ui/tray-model.ts` — two doc comments now cover both templates:

```ts
  /** The Space section: a solar system's bodies, or a sky map's stars and constellations. */
  space: boolean;
```
```ts
  /** The figure is a solar_system or sky_map template: it has a Space section. */
  spaceTemplate?: boolean;
```

- [ ] **Step 6: Let a spec say so**

`src/spec/schema.ts:370-374` — the `explore.space` description:

```ts
        space: {
          type: "boolean",
          description:
            "On a solar_system figure: open the Space section of the explore tray — click a planet or moon to look closer, breadcrumbs back out, pills for scale, names and date, a fact card with the Wikipedia summary. On a sky_map figure the same flag opens the sky's own section — click a star or a constellation to read about it, pills for the hour, the date and where you are standing. Either way the lesson waits for Continue. The authored 'look around yourself' moment. App only; movies skip the beat.",
        },
```

`src/spec/types.ts:300-302` — the comment above `explore`:

```ts
  /** Open the explore tray and wait (app only; movies skip the whole beat,
   *  narration included). params restricts which sliders show; `space` opens
   *  the Space section — the solar system's bodies, or a sky map's sky. */
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx vitest run tests/sky-model.test.ts tests/tray-model.test.ts`
Expected: PASS.

Run: `npm test` — expected: all pass.
Run: `npx tsc --noEmit` — expected: no output.

- [ ] **Step 8: Prove the boundary again**

Run: `npm run build`
Then: `grep -l "Rotation_EQJ_EQD" dist/assets/*.js`
Expected: still exactly one `engine-*.js` chunk. `sky-explore.ts` reaches the engine only through `getLoadedEngines`, which is how round 1's Space section does it; a stray `import { makeSkyEngine }` would show up here.

- [ ] **Step 9: Commit**

```bash
git add src/ui/sky-model.ts src/ui/sky-explore.ts src/ui/tray.ts src/ui/tray-model.ts src/spec/schema.ts src/spec/types.ts tests/sky-model.test.ts
git commit -m "The Space section learns the sky: click a star, click a figure

The star field has to be one element — draw has no wildcard and nobody can
list which stars are up at ten tonight — so hitElement would answer every
click inside the dome with 'the stars'. The section therefore hit-tests
itself, against the same chart constant the template drew with, and a star
beats a line when both are near: the smaller, definite thing is what was
aimed at.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01RWSwWnc8ToCq7H2pXdvXHY"
```

---

### Task 7: Four more bundled examples, every one of them a question

Hans, `STYLE.md`, 2026-09-07: *"Generelt er det fint om eksemplene tar utgangspunkt i et spørsmål eller noe de vil forklare."* The `request` line is the user input the model learns to recognise, so an errand ("Show me the sky tonight") teaches it that this app draws on command. Every example below starts from a question, and every beat carries an idea rather than naming the part it just drew.

Two of them are Direction A of spec §6.2 — the lines are drawn, name the constellation — as a quiz and as a typed answer. Direction B (`widget: "connect"`) is not in this round; it gets its own plan.

**Files:**
- Modify: `src/examples.json` (four entries)
- Test: no new file — `tests/examples.test.ts` already holds every bundled example to zero lint issues, valid params, resolvable ids, one opening speak, and a full translation round trip.

**Interfaces:**
- Consumes: every element id Tasks 4-6 produced.
- Produces: nothing later tasks read; Task 8 links them from the README.

**The moments, already checked against the ephemeris from Oslo (59.91, 10.75):**

| moment | what is where |
|---|---|
| `2026-12-20T21:00:00Z` | Betelgeuse 31.6°, Rigel 19.3°, Sirius 4.7°, Polaris 60.5°; Cassiopeia and Ursa Major circumpolar |
| that moment + 182 days | the Sun is at −1.97°, so a midsummer Oslo sky is still (just) a night sky and the caption does not switch to daylight |
| `2027-02-19T21:00:00Z` | Jupiter 41.1°, Sirius 12.5°, Capella 64.9°, Sun −33.8° |
| `2026-02-22T20:00:00Z` | the Moon 28.5° up at 31 % lit — a real crescent, well clear of the horizon |

- [ ] **Step 1: Add the four examples to `src/examples.json`**

```json
{
  "request": "Why can't I see the winter stars in summer?",
  "packs": ["space"],
  "spec": {
    "title": "Half a year, the other half of the sky",
    "template": "sky_map",
    "params": { "time": "2026-12-20T21:00:00Z", "place": "Oslo", "mark": ["Orion"], "names": "la", "days": 0 },
    "commands": [
      { "draw": ["horizon", "compass_n", "compass_e", "compass_s", "compass_w", "stars", "figures", "place_label"], "speak": "Nine in the evening, four days before Christmas, and this is the whole sky over Oslo — the rim is the horizon, the middle is straight up." },
      { "draw": ["con_ori", "label_con_ori"], "speak": "Orion is the winter shape everyone knows: three stars in a row with a bright one above and below. In December it is up all night." },
      { "animate": { "days": 182 }, "duration": 9, "easing": "linear", "speak": "Now hold the hour still and let half a year go by. The Earth carries you round the far side of its orbit, so at nine in the evening your night side is pointing the opposite way — and Orion is out there in broad daylight, behind the Sun." },
      { "quiz": { "question": "Why is Orion missing in June?", "choices": ["It has moved to another part of the galaxy", "It is above the horizon only in daytime", "It is too faint in summer"], "correct": 2, "right": "It is up in the daytime. Nothing out there moved — we did, half an orbit's worth, and the night now faces the other way." } }
    ]
  }
},
{
  "request": "Which constellation is this?",
  "packs": ["space"],
  "spec": {
    "title": "The W that never sets",
    "template": "sky_map",
    "params": { "time": "2026-12-20T21:00:00Z", "place": "Oslo", "focus": "Cassiopeia", "names": "la" },
    "commands": [
      { "draw": ["frame", "stars"], "speak": "A patch of the northern sky, magnified. Five stars of about the same brightness, and no two of them the same distance from us — this shape is a trick of where we happen to stand." },
      { "draw": ["con_cas"], "speak": "Joined up, they make a W. From this far north it never sets: it wheels round the pole all night and all year, which is why sailors used it to find north when cloud hid the pole star itself." },
      { "quiz": { "question": "Which constellation is this?", "choices": ["Cassiopeia", "Perseus", "Andromeda", "Ursa Major"], "correct": 1, "right": "Cassiopeia — the queen, drawn as a W or an M depending on which way round the sky has turned." } }
    ]
  }
},
{
  "request": "Hvilket stjernebilde er dette?",
  "packs": ["space"],
  "spec": {
    "title": "Sju stjerner som peker nordover",
    "template": "sky_map",
    "params": { "time": "2026-12-20T21:00:00Z", "place": "Oslo", "focus": "Ursa Major", "names": "la" },
    "commands": [
      { "draw": ["frame", "stars"], "speak": "Et utsnitt av himmelen mot nord, forstørret. Sju klare stjerner, fire i en firkant og tre i en bue ut fra den." },
      { "draw": ["con_uma"], "speak": "Karlsvogna er bare den lyseste delen av et større stjernebilde. De to ytterste i firkanten er verdt å kjenne: en linje gjennom dem, fem ganger så lang, treffer polarstjernen — og dermed nord, uten kompass." },
      { "ask": { "question": "Skriv det latinske navnet på stjernebildet.", "intro": "Det har tre navn: ett norsk, ett engelsk og ett latinsk, og astronomer over hele verden bruker det latinske.", "answer": "Ursa Major", "right": "Ursa Major — Store bjørn. Karlsvogna er bare ryggen og halen på den." , "wrong": "Det står skrevet på figuren." } }
    ]
  }
},
{
  "request": "Why doesn't Jupiter twinkle when the stars do?",
  "packs": ["space"],
  "spec": {
    "title": "A point twinkles, a disc does not",
    "template": "sky_map",
    "params": { "time": "2027-02-19T21:00:00Z", "place": "Oslo", "show": ["jupiter"], "mark": ["Sirius", "Capella"], "names": "la" },
    "commands": [
      { "draw": ["horizon", "compass_n", "compass_e", "compass_s", "compass_w", "stars", "place_label"], "speak": "An evening in February. Somewhere in here is something that looks like a very bright star and is not one." },
      { "draw": ["sirius", "label_sirius", "capella", "label_capella"], "speak": "Sirius and Capella are stars: unimaginably far away, so each arrives as a single point of light. Every pocket of moving air in the atmosphere bends that one point a little, and it flickers." },
      { "draw": ["jupiter", "label_jupiter"], "speak": "Jupiter is close enough to be a tiny disc rather than a point — a few dozen points side by side, each flickering out of step with the others. Averaged together they hold steady, and that steadiness is how you pick a planet out of a sky full of stars." },
      { "ask": { "question": "Click the one that is not a star.", "widget": "click", "answer": "jupiter", "right": "Jupiter — the steady one. Sunlight bounced off a planet, not a star's own light.", "wrong": "The two you were told about are stars. Look for the third bright light." } }
    ]
  }
}
```

- [ ] **Step 2: Run the examples guard**

Run: `npx vitest run tests/examples.test.ts`
Expected: PASS. The four assertions that bite hardest are

- `%s — lays out with no lint issue at all, not even a warning` (reads `.issues`, every severity),
- `%s — every command id resolves` (so `con_cas`, `label_con_ori`, `capella` and `label_sirius` must really exist at those moments — the table above is why they do),
- `%s — params satisfy the template's own params_schema`,
- `%s — at most one opening (announcement) speak precedes the first draw`.

If an id fails to resolve, the cause is almost always that the object is below the horizon at that moment. Do not shift the whole example: check the moment with

```bash
node -e "
const A=require('astronomy-engine');const obs=new A.Observer(59.91,10.75,0);
const t=new Date(process.argv[1]);
const eq=A.Equator(A.Body[process.argv[2]],t,obs,true,true);
console.log(A.Horizon(t,obs,eq.ra,eq.dec,'').altitude.toFixed(1));
" 2027-02-19T21:00:00Z Jupiter
```

and move the example's `time` to a moment where the thing it is about is actually in the sky.

- [ ] **Step 3: Run the translation guards**

Run: `npx vitest run tests/spec-i18n.test.ts tests/translate-coverage.test.ts`
Expected: PASS.

`translate-coverage` lays every bundled example out and requires that every word drawn on the canvas was offered to the translator; it derives that from the layout itself, so a new template needs no hand edit — but a word the template computes and the pipeline cannot see fails here. `spec-i18n`'s per-template drift table covers `src/scenes/*/manifest.json` only, not packs, so it needs no edit either. Both facts were checked when this plan was written; if either turns out otherwise, fix the classification (`x-translate: false` on the id-shaped params) rather than the test.

- [ ] **Step 4: Run everything**

Run: `npm test` — expected: all pass.
Run: `npx tsc --noEmit` — expected: no output.

- [ ] **Step 5: Sweep the round's own examples, the way round 1 did**

Run: `npm run sweep:round`
Expected: the script reports every example it knows about as clean. If it does not cover `sky_map`, that is not a failure — it is a script scoped to the charts round; note it in the ledger and move on.

- [ ] **Step 6: Commit**

```bash
git add src/examples.json
git commit -m "Four sky examples, each of them a question somebody would actually ask

Why the winter stars are gone in summer, which constellation this is (as a
quiz, and again in Norwegian as a typed answer that has to say WHICH of the
three names it wants), and why Jupiter does not twinkle. Every request line is
a question rather than an errand: the request is what the model learns to
recognise, and 'show me the sky' teaches it that the app takes orders.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01RWSwWnc8ToCq7H2pXdvXHY"
```

---

### Task 8: The pack's own account of itself, the roadmap, and a smoke list

Round 1's reviewer called `src/scenes/space/README.md` the best thing on the branch. Round 2 keeps that standard: what the sky map is, why it is projected the way it is, what it deliberately does not do, and the two limits it ships with.

**Files:**
- Modify: `src/scenes/space/README.md`
- Modify: `ROADMAP.md` (the space entry at lines 464-473)
- Create: `docs/superpowers/plans/2026-09-07-space-round-2-smoke.md`
- Create: `docs/superpowers/plans/2026-09-07-space-round-2-ledger.md` (kept from Task 1 onward, finished here)

**Interfaces:** none — nothing reads these.

- [ ] **Step 1: Extend the README**

Add these sections to `src/scenes/space/README.md`, after the round-1 material and before "Rounds ahead". Fill each measurement from what the tasks actually produced; the numbers below are the ones this plan predicted, and any that came out different should be corrected here, not quietly kept.

```markdown
## The sky map — round 2

`sky_map` draws the sky from a place at a moment: a stereographic chart with
the zenith at the centre and the horizon as its rim.

### Why east is on the left

A planisphere is held OVERHEAD and looked up through, so its east and west
are swapped against a map of the ground. The projection is
`r = R·tan((90° − alt)/2)` from the zenith, with `x = cx − r·sin(az)` and
`y = cy + r·cos(az)` on the y-up canvas: north at the top, east on the left,
alt 0 exactly on the rim, and anything below the horizon landing outside it —
which is how the template omits what has set, with no separate test.

The alt/az transform is hand-rolled rather than astronomy-engine's `Horizon()`,
and it is not an approximation: measured, the two agree to four decimal places.
What it buys is a thousand stars in 0.3 ms instead of a thousand library calls.
J2000 catalogue coordinates ARE precessed to date first — twenty-six years is
0.35°, which is more than a bright star's drawn radius.

### The data, and what makes the figures gradeable

`sky/stars.json` and `sky/constellations.json` are generated once by
`scripts/build-sky-data.mjs` and committed; the app never fetches. See
`sky/ATTRIBUTION.md` for the licences.

d3-celestial draws each constellation as coordinate polylines, which cannot be
checked against anything. Every vertex lies within 0.35° of a catalogue star
(799 of 800, measured), so the build snaps each one and stores the figure as
pairs of Hipparcos numbers instead — 735 edges over 88 figures. That is what
makes "draw Orion" gradeable, and it is why the edges ship this round even
though the `connect` widget that will read them does not.

The star set is a UNION, not a magnitude cut: every star to 4.5 plus every
star any line touches, because 119 of the 750 line stars are fainter than that
and a cut would leave the figures with holes. A star a drawn line reaches is
drawn whatever `limit_mag` says, for the same reason.

### Two elements, and what lifts a thing out of them

`draw` takes an array of ids and has no wildcard, and no author — human or
model — can know which stars are above the horizon at ten tonight. So the
chart draws `stars` (every dot) and `figures` (every constellation's lines) as
two elements, and anything the author singles out by `mark`, `highlight` or
`focus` is lifted OUT into its own element: `sirius`, `con_ori`. That is what
makes `{"ask": {"widget": "click", "answer": "sirius"}}` writable — `mark`
lifts without tinting, so the figure does not give the answer away, while
`highlight` does both.

The ⊕ section cannot use `hitElement` for the same reason: a click inside the
dome would only ever answer "the stars". It projects the positions itself,
with the same `engines.sky.chart` the template drew at, and finds the nearest
star or line (`targetAt`, `src/ui/sky-model.ts`).

### Names: a free spot or none

A star chart is denser than a solar system, and round 1's lesson was that the
shared solver cannot aim at the gaps in a specific figure. So this template
places its own names too — but with a stricter rule than round 1's: a
constellation's or a star's name is written only where it costs NOTHING, and a
name with no free spot is simply not written. An atlas names what it has room
for. That is what makes the 200-moment sweep clean by construction rather than
by luck.

The two exceptions are deliberate. A BODY the author asked for by name always
gets its name, at the cheapest spot rather than only a free one, with its
candidates aimed inward at the zenith where the dome is emptiest. And a
`focus` portrait always names its subject, because the subject is the page.
`tests/sky-template.test.ts` holds the floor from the other side — the default
chart must name at least five constellations, and Orion on a December evening
— so "write nothing and lint clean" is not available.

### One caption

Round 1 shipped a known limit: `scale_note` and `missing_note` colliding in
the same foot strip, with the recorded remedy "place the second relative to
the first's measured right edge". This template starts one step past that.
There is ONE caption, `sky_note`, and it composes every caveat — daylight,
anything named that has set, unknown names, and that the Sun, Moon and planets
are drawn as symbols — into a single line, dropping clauses from the end while
it is too wide. One caption cannot collide with itself.

### The Moon

Drawn with the phase it really has, from `Illumination`, and turned the way it
really is: the bright limb points along the great circle toward the Sun, so
the crescent tips as it does in the sky rather than always sitting upright.
The lit region is the bright half-circle closed by a half-ellipse whose
semi-axis along that direction is `r(1 − 2k)` — `+r` at new (no lit area at
all), 0 at quarter (a straight terminator), `−r` at full (the whole disc).

The whole disc is filled faintly BEFORE the crescent, and that is
load-bearing: an `area` is a hit outline, and `hitElement`'s box pass skips
any id that already has one, so a moon that filled only its crescent would
lose every click on its dark half to whatever lay behind it.

### Two traps this pack met on purpose

- **The rim owns no clicks.** `horizon` and `frame` are traced as OPEN paths
  that return to their start. `closed: true` would make `elementRings` hand
  them a hit outline covering the whole picture, and `hitElement` answers with
  the smallest outline containing the point and never reaches the box pass.
  Round 1 shipped exactly that as a frame and it swallowed every click.
- **A group's leaf durations accumulate** (`src/render/svg-backend.ts:583`).
  Four hundred star dots at `SKETCH_MS.dot` would take 168 seconds to draw, and
  Sagittarius's 29 line segments forty. Both divide a fixed budget instead —
  about two seconds for the star field, one for a figure.

### Known limits (honest, not fixed this round)

- **Messier objects are not drawn.** `messier: true` is not a param. The
  data's JSON shape is the one thing the source measurement did not measure,
  and it adds no machinery — dots on the projection that already exists. A
  follow-up, not a gap in the design.
- **No deeper stars at runtime.** `limit_mag` stops at 4.5, which is what the
  bundled union holds. The spec offered a jsdelivr fetch beyond that, but a
  layout body is synchronous and engines load before any params are known, so
  the value that would trigger the fetch is read where nothing can await it.
  Dropping it removes a promise the architecture could not keep.
- **The written clock is local SOLAR time** at the observer's longitude, not
  the wall clock: within a few minutes inside a time zone, and it needs no
  timezone table. A bare `time` date means 22:00 local solar for the same
  reason.
- **`focus` magnifies, it does not re-project.** A portrait scales the same
  stereographic plane rather than re-centring the projection on the figure, so
  a constellation low on the horizon carries the rim's stretch into its
  close-up. Honest, and visible; re-centring is a second projection centre and
  a second set of tests.
```

- [ ] **Step 2: Update the ROADMAP entry**

`ROADMAP.md`, the "Space, round 1" bullet at line 464. Add a sibling bullet immediately after it, mid-block, so nothing below is orphaned:

```markdown
- **Space, round 2** (shipped 2026-09-07; spec
  `docs/superpowers/specs/2026-09-06-space-design.md` §6 with every measured
  number in `…/2026-09-07-sky-data-measured.md`, plan
  `docs/superpowers/plans/2026-09-07-space-round-2.md`): `sky_map` — a
  stereographic planisphere from a place at a moment (north up, east LEFT),
  1 040 bundled stars sized by magnitude and tinted by B−V, the 88
  constellation figures as pairs of catalogue stars, the Sun, Moon and
  naked-eye planets by ephemeris with the Moon's phase drawn and turned toward
  the Sun, `hours`/`days` animatable, `focus` portraits, the lazy `sky` engine,
  and the ⊕ Space section's sky half. Direction A of the connect-the-stars
  exercise (the lines are drawn, name the constellation) ships as a quiz and as
  a typed answer. Open: Direction B — `ask.widget: "connect"`, its own round;
  Messier objects; deeper stars than magnitude 4.5; a `focus` that re-centres
  the projection rather than magnifying it; and the language wrinkle §6.2
  named — `ask.answer` is one string, so a figure with three names needs the
  question to say which one it wants.
```

- [ ] **Step 3: Write the smoke checklist**

`docs/superpowers/plans/2026-09-07-space-round-2-smoke.md`. Written, not executed — Hans's standing preference is to limit browser automation, and the Chrome at his machine is visible and audible. Keep it to things a node test cannot see.

```markdown
# Space round 2 — manual smoke checklist

Run `npm run dev`, open a drawcast that uses `sky_map`, and check the things
no node test can see. Delete any screenshot from the worktree root before
committing.

1. **The chart reads as a sky.** Load the bundled "Why does the sky turn?"
   example. The dome fills the page, the star field sketches in over about two
   seconds rather than dot by dot, and the dots are visibly different sizes.
2. **The colours read on paper.** Betelgeuse and Antares should look warm,
   Rigel and Spica cool, on the warm ground — not a field of identical grey.
3. **The animation.** `animate hours 0 → 6` turns the whole sky about Polaris,
   which stays put. Nothing jumps at the start or the end.
4. **The Moon.** Load the "Why can't I see the winter stars in summer?"
   example and use the ⊕ date pills to reach a crescent. The crescent's points
   should aim away from the Sun's side of the chart.
5. **The ⊕ Sky section.** `explore: { space: true }` on a `sky_map` opens the
   sky section, not the solar system's. Click a bright star: the card names it,
   gives its magnitude, colour and how high it is right now, and the Wikipedia
   summary arrives (or the card stands on the table's facts alone when it does
   not). Click a constellation's lines: the card gives all three names.
6. **The pills.** Hour, Date and Place each repaint the figure. Place moves the
   whole sky — Tromsø raises Polaris, the equator drops it to the rim.
   Continue restores the authored figure exactly.
7. **The click question.** The "Why doesn't Jupiter twinkle?" example's click
   ask: clicking Jupiter is right and glows; clicking a star is wrong. Clicking
   empty sky does nothing rather than grading.
8. **Dark mode.** The chart is legible in both themes; the star tints do not
   vanish into the dark ground.
```

- [ ] **Step 4: Finish the ledger**

`docs/superpowers/plans/2026-09-07-space-round-2-ledger.md`, kept from Task 1 onward in the shape round 1's used (`docs/superpowers/plans/2026-09-06-space-round-1-ledger.md`): a pre-flight scan of the pairs that share a file or an interface, then one line per task as it completes, and a numbered **Ruling** for every decision taken during the round that the plan did not already take — including any measurement that came out different from what this plan predicted (the build script's counts, a sweep that needed a wider candidate set, a clock string a minute off).

Record, at minimum:
- the actual output of `node scripts/build-sky-data.mjs` (Task 1 step 7);
- the real shape of `starnames.json`, if `properName()` had to change;
- the largest catalog entry from `tests/pack-defaults.test.ts` after `sky_map` joined, since round 1's Ruling 5 asked for that number to be watched;
- the `grep -l Rotation_EQJ_EQD dist/assets/*.js` result from Tasks 3 and 6;
- anything the sweep forced.

- [ ] **Step 5: Final verification**

Run: `npm test` — expected: all pass.
Run: `npx tsc --noEmit` — expected: no output.
Run: `npm run build` — expected: clean, with the sky tables inside an `engine-*.js` chunk.
Run: `git status --short` — expected: nothing but the files this task touches. **Delete any stray screenshot before committing, and never `git add -A`.**

- [ ] **Step 6: Commit**

```bash
git add src/scenes/space/README.md ROADMAP.md docs/superpowers/plans/2026-09-07-space-round-2-smoke.md docs/superpowers/plans/2026-09-07-space-round-2-ledger.md
git commit -m "The sky map's own account of itself: why east is left, and what it will not do

Including the two limits it ships with — no Messier objects, and no stars
fainter than 4.5 — with the reason for each, and the two traps it met on
purpose: the rim that would have eaten every click, and the group whose leaf
durations would have made the star field take three minutes to draw.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01RWSwWnc8ToCq7H2pXdvXHY"
```

- [ ] **Step 7: Hand back**

Do **not** merge and do **not** push. Report to the controller: the eight commits, the sweep numbers, the build-script report, the ledger's rulings, and anything the plan predicted that the code contradicted.

---

## Deliberately not in this round

Each of these is a decision, not an omission. If a reviewer wants one back, it is a conversation, not a bug.

| Left out | Why | Where it goes |
|---|---|---|
| `ask.widget: "connect"` — draw the lines from a name (spec §6.2, Direction B) | A sixth widget with its own gate, grading and reveal — comparable in size to the drag round, which was a round of its own. Its answer key (the 735 HIP-pair edges) ships here, because the same build produces it and the template needs the same star set. | Its own plan, immediately after this one |
| `messier: true` and `messier.json` | The one data shape the source measurement did not measure, and it adds no machinery — dots on the projection that already exists, with the label rule that already exists. | A follow-up; recorded in the README and the ROADMAP |
| Deeper stars than magnitude 4.5 at runtime | A layout body is synchronous and engines load before any params are known, so the value that triggers the fetch is read where nothing can await it — and spec §2's own rule is that no figure depends on a runtime fetch. | Not planned; if it is ever wanted, `limit_mag` has to move into the engine's load contract |
| A `focus` that re-centres the projection | The portrait magnifies the same stereographic plane instead. Re-centring is a second projection origin and a second set of geometry tests, for a difference visible only near the rim. | Recorded as a known limit |
| Making `ask.answer` accept alternatives | Spec §6.2 raises it and explicitly declines to decide: it would change comparison semantics for every template in the app. The Norwegian example handles it the way the spec suggests — the question says which language it wants. | A whole-app decision, not this pack's |
| Letting a filled disc declare a hit outline | Round 1's recorded known limit (`tests/space-hit.test.ts`): the centre of a portrait loses its click to its own axis. The honest fix changes hit-testing for every template that draws circle-hinted strokes. | Still the repository's decision, not this pack's |

---

## Self-review

**1. Spec coverage.** Every requirement of §6 and §6.1, against the task that implements it:

| Spec §6 | Task |
|---|---|
| stereographic centred on the zenith, horizon the outer circle, N top, E left | 2 (`project`), 4 (drawn), R2 |
| objects below the horizon omitted | 2 (falls outside the rim by construction), 4 (star and body filters) |
| `stars-45.json` — the mag-4.5 union, 1 040 stars, `{i, c, m, b}` | 1 (as `sky/stars.json`) |
| `constellations.json` — 88 entries with `edges` as HIP pairs | 1 |
| `starnames-bright.json` | 1, folded into `stars.json` — R9 |
| `messier.json` | not this round — R8 |
| LICENSE + ATTRIBUTION, BSD-3 and the CC BY-SA Norwegian names | 1 |
| §6.1 — the build script, 735 edges, the answer key | 1 |
| §6.2 Direction A as quiz and as typed answer | 7 (two examples), and the language wrinkle handled in the Norwegian one |
| §6.2 Direction B (`connect`) | out of scope by the controller's decision; its data ships in Task 1 |
| Sun/Moon/planets by `Equator` → `Horizon`, Moon with its phase | 3 (`bodyPositions`, `moonLimb`), 4 (drawn) |
| params `lat`, `lon`, `place`, `time`, `hours`, `days`, `limit_mag`, `names`, `show`, `highlight`, `focus` | 4 and 5 |
| param `constellations` (`both`/`lines`/`names`/`none`) | 5 |
| param `messier` | not this round — R8 |
| element ids `con_<abbr>`, proper names, `hip_<n>`, body ids, `horizon`, `compass_n/e/s/w`, `place_label`, `moon` with its phase | 4 and 5. **Two deviations, both R4:** `hip_<n>` ids exist under `focus` rather than for every star (a whole-sky chart would need 375 of them and `draw` has no wildcard), and the anonymous field plus the un-singled-out figures are the group elements `stars` and `figures`. A new param, `mark`, is what makes a click question addressable without the tint revealing the answer. |
| star dots scale with magnitude, faint B−V tint | 2 (`starRadius`, `starColor`), 4 |
| examples: find Orion, where is Jupiter, the sky turns, name the constellations | 4 (the sky turns), 7 (Orion in a portrait, Jupiter, two namings). "Name the constellations" as a DRAG is not among them: the drag widget places items on drawn targets, and with the figures grouped into `figures` there are no per-constellation targets unless every one is marked. Recorded here rather than silently dropped. |
| ⊕ section gains constellation/star cards and time/date/place pills | 6 |
| optional deeper stars at runtime | dropped — R7 |
| Whole bundled payload 66 KB | 1 — measured at ~69 KB with the names folded in |

**2. Placeholder scan.** No "TBD", no "similar to Task N", no "add error handling", no "write tests for the above". Every code step carries the code; every run step carries the command and its expected output. Three places give an instruction that depends on a measurement rather than a fixed value, and each names the exact action and the exact fallback: Task 1 step 7 (if the build's counts differ from the measured doc, keep the output and record the difference), Task 1 step 4 (if `starnames.json`'s shape is not what `properName` expects, the script throws with the first three entries printed and says what to do), and Task 4 step 7 (if `localClock`'s string is a minute off, fix the test — the clock is pinned in Task 2). Task 5 step 5 and Task 7 step 2 give a reproduction command and name the legitimate remedies and the forbidden ones.

**3. Type consistency.** Checked across tasks:

- `Star` is `{hip, ra, dec, mag, bv, name, name_nb}` everywhere (Tasks 2, 3, 6); the COMPACT record `{i, c, m, b, n?, nb?}` appears only in `StarTable` and in `expandStars`, and Task 1's test asserts the compact shape while Tasks 2-6 use the expanded one.
- `Constellation` is `{abbr, name: {la, en, nb}, edges}` in Tasks 2, 3, 5, 6; the compact `{a, la, en, nb, e}` only in `ConstellationTable`.
- `AltAz` is `{alt, az}` in Tasks 2, 3, 4, 5, 6.
- `SkyEngine.name` (constellation name) vs `SkyEngine.starName` — distinct members, used consistently: Task 4 calls neither, Task 5 calls `eng.name`, Task 4 and 5 call `eng.starName`, Task 6 calls both.
- `eng.chart` is a value (`Chart`), not a function — read as `eng.chart` in Tasks 4, 5, 6 and asserted in Task 3's test.
- `eng.places()` IS a function; `PLACES` is the constant behind it. Task 6's test calls `sky.places()`.
- `starId`/`conId` return the element ids Tasks 4, 5, 6 and 7 use: `sirius`, `hip_1234`, `con_ori`.
- `resolveTime(time, hours, days, lon?, now?)` — the same five-parameter signature in Task 2's implementation, Task 2's tests, `SkyEngine` (four parameters exposed), Task 4's layout and Task 6's section.
- `noteClauses(NoteParts, SkyLang)` returns `string[]`; the JOIN and the width-driven drop are the template's (Task 4), which is why the engine returns clauses and not a sentence.
- `SpaceSection` (`{el, destroy}`) is the return type of both `mountSpaceSection` (round 1) and `mountSkySection` (Task 6), which is what lets `tray.ts` keep one variable.
- `Choice<T>` and `Fact` are imported from `space-model` by `sky-model` (Task 6) — the same shapes round 1 defined, not new ones.

**4. What the self-review changed.** Two things were wrong on the first pass and are fixed above: the crescent tests named a moment when the Moon is 9.7° BELOW the horizon over Oslo (now `2026-02-22T20:00:00Z`, 28.5° up at 31 % lit), and Tromsø's written clock was a minute out (`22:15`, not `22:16` — `localClock` floors the minute). Both were caught by computing them rather than reading them.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-09-07-space-round-2.md`. Two execution options:

**1. Subagent-Driven (recommended)** — a fresh subagent per task, review between tasks, fast iteration. REQUIRED SUB-SKILL: `superpowers:subagent-driven-development`.

**2. Inline Execution** — execute the tasks in this session with checkpoints. REQUIRED SUB-SKILL: `superpowers:executing-plans`.

Which approach?
