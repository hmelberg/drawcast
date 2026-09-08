// Generates src/scenes/space/sky/{stars,constellations}.json — the sky map's
// two data tables — the way scripts/build-elements.mjs generates the periodic
// table: the source is fetched once into a gitignored cache, the OUTPUT is
// what ships, and tests/sky-data.test.ts is what pins it.
//
// Three sources, all d3-celestial (BSD-3-Clause, Olaf Frohn), all measured
// CORS-open and stable on 2026-09-06:
//   stars.6.json               5 044 stars to magnitude 6, GeoJSON points
//   constellations.lines.json  88 MultiLineString figures in RA/Dec
//   starnames.json              proper names by HIP
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
// Pinned to a commit SHA, not a branch: an early round-2 run against
// "@master" drifted from the 2026-09-06 measured doc (800 vertices measured
// vs 893 fetched the next day, same URL) even though nothing in this file
// changed — a fresh clone or a wiped .cache/sky pulls whatever master holds
// that day. jsdelivr serves a commit SHA the same way it serves a branch
// name, so pinning costs nothing and makes the build reproducible. This is a
// deliberate improvement over scripts/anatomy/bp3d.mjs's MIRROR, which still
// pins to a branch ("main") — that script gets away with it because BodyParts3D
// is static; d3-celestial's data files are not, so the sky build needs the
// stronger guarantee. SHA 7e720a3de062059d4c5400a379146a601d9010e0 is
// ofrohn/d3-celestial's master HEAD as of 2026-09-07, chosen because it
// reproduces the 893-vertex content this round's build was actually made
// from (see docs/superpowers/specs/2026-09-07-sky-data-measured.md).
const BASE = "https://cdn.jsdelivr.net/gh/ofrohn/d3-celestial@7e720a3de062059d4c5400a379146a601d9010e0/data/";

/** Magnitude cut for the FIELD stars. Every constellation-line star is kept
 *  whatever its magnitude — see the union below. */
const LIMIT_MAG = 4.5;
/** Proper names are carried only for the stars a teaching chart would ask
 *  about; the faint field stays anonymous. */
const NAME_MAG = 3.0;
/** The measured snapping tolerance: at most one vertex per run fails to
 *  match under it (799 of 800 in the 2026-09-06 measurement; 892 of 893 in
 *  the 2026-09-07 pinned rebuild — same one-vertex shortfall, larger source). */
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
/** stars.6.json carries bv as a numeric STRING ("0.911"), not a number —
 *  verified on the live fetch: 5 042 of 5 044 features, the rest "". */
function bvOf(v) {
  if (typeof v === "number") return v;
  const n = Number(v);
  return typeof v === "string" && v !== "" && Number.isFinite(n) ? n : null;
}
/** { hip, ra, dec, mag, bv } for every catalogue star. */
const catalogue = starsRaw.features.map((f) => ({
  hip: Number(f.id),
  ra: ((f.geometry.coordinates[0] % 360) + 360) % 360,
  dec: f.geometry.coordinates[1],
  mag: f.properties.mag,
  bv: bvOf(f.properties.bv),
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
// Serpens is drawn as two disconnected GeoJSON features (Caput and Cauda)
// that share the abbreviation "Ser" — the one constellation whose figure is
// split in two. Group by abbreviation, not by feature, so it lands as a
// single entry with the union of both halves' edges, the way sky-names.json
// (one row per abbreviation) expects.
const edgesByAbbr = new Map();
for (const f of linesRaw.features) {
  const abbr = f.id ?? f.properties?.id;
  const meta = names.constellations[abbr];
  if (!meta) throw new Error(`sky-names.json has no entry for "${abbr}" — add it by hand`);
  if (!edgesByAbbr.has(abbr)) edgesByAbbr.set(abbr, new Set());
  const edges = edgesByAbbr.get(abbr);
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
}
const constellations = [...edgesByAbbr.entries()].map(([abbr, edges]) => {
  const meta = names.constellations[abbr];
  return {
    a: abbr,
    la: meta.la,
    en: meta.en,
    nb: meta.nb,
    e: [...edges].map((k) => k.split(",").map(Number)).sort((p, q) => p[0] - q[0] || p[1] - q[1]),
  };
});
constellations.sort((a, b) => a.a.localeCompare(b.a));
if (constellations.length !== 88) throw new Error(`got ${constellations.length} constellations, expected 88`);

// The whole "the drawing IS the answer key" claim rests on this number being
// about one. A vertex that finds no catalogue star within SNAP_DEG is dropped
// and its line broken, silently — so a rebuild against a shifted catalogue, a
// changed SNAP_DEG or coordinates in the wrong units would still WRITE the
// files, with three hundred edges quietly missing or joined to the wrong
// star. Counting it and printing it is not enough; nobody reads a log line on
// a green run. The measurement that ships is 1 unmatched of 893 vertices, so
// anything past a handful means the snap itself has stopped working.
const MAX_UNMATCHED = 5;
if (unmatched > MAX_UNMATCHED) {
  throw new Error(
    `${unmatched} of ${vertices} vertices matched no catalogue star within ${SNAP_DEG}° (allowed ${MAX_UNMATCHED}). `
    + "The snap has stopped working — check the pinned source, the catalogue and SNAP_DEG before writing these files.",
  );
}

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
    const n = s.mag <= NAME_MAG ? (proper.get(s.hip) ?? null) : null;
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

// bvOf() parses a string today (stars.6.json's own shape, verified on the
// live fetch). If that shape changes again, a silent parse failure would
// null out every star's colour index the same way the unparsed typeof
// check once did — so fail loudly instead, the way the two checks above do.
const bvMissing = stars.filter((s) => s.b === null).length;
if (bvMissing > stars.length * 0.05) {
  const sample = starsRaw.features.slice(0, 3).map((f) => f.properties.bv);
  throw new Error(
    `${bvMissing} of ${stars.length} kept stars have no B-V — bvOf() is not reading stars.6.json's ` +
      `"bv" property correctly. First three raw values: ${JSON.stringify(sample)}.`,
  );
}

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
