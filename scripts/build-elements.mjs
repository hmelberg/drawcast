// Generates src/scenes/elements/elements.json — the periodic table's data,
// the way scripts/ generates the anatomy atlas: the source package is a
// devDependency, the generated JSON is what ships and what the tests pin.
//
// Two sources, deliberately split by what kind of fact they are:
//
//   MEASURED values (mass, electronegativity, radius, melting/boiling point,
//   density, category, discovery year, electron configuration) come from the
//   `periodic-table-data` package — MIT, and the data itself is PubChem's
//   periodic-table export, a US-government work in the public domain. None of
//   these numbers is written by hand anywhere in this repo.
//
//   STRUCTURAL values (group, period, block, the f-block column) are DERIVED
//   here from the atomic number by the table's own shape. They are
//   definitional rather than observed, and deriving them means the grid the
//   template draws and the data the drills read can never disagree.
//
//   NAMES in Norwegian and Latin have no machine-readable source, so they
//   live in src/scenes/elements/names.json, hand-verified against Norwegian
//   Wikipedia and snl.no. An element missing from that file is a hard error:
//   a silently-English table would be a quiet lie in a Norwegian lesson.
//
// Run: node scripts/build-elements.mjs

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "node_modules/periodic-table-data/periodicTableData.json");
const NAMES = join(ROOT, "src/scenes/elements/names.json");
const OUT = join(ROOT, "src/scenes/elements/elements.json");

// ---- structure: group, period, block, f-column, all from z -----------------

/** The last atomic number of each period — the table's own row breaks. */
const PERIOD_END = [2, 10, 18, 36, 54, 86, 118];

function periodOf(z) {
  for (let i = 0; i < PERIOD_END.length; i++) if (z <= PERIOD_END[i]) return i + 1;
  throw new Error(`z ${z} is past the seventh period`);
}

/** 1..15 for La..Lu and Ac..Lr, null elsewhere — the f-block's own column. */
function fIndexOf(z) {
  if (z >= 57 && z <= 71) return z - 56;
  if (z >= 89 && z <= 103) return z - 88;
  return null;
}

/** Periods 1-3 are the irregular rows — hydrogen and helium at the two far
 *  ends, then a ten-column hole between group 2 and group 13 where the d-block
 *  has not started yet. Small enough to state outright rather than compute. */
const SHORT_ROW_GROUP = {
  1: 1, 2: 18,
  3: 1, 4: 2, 5: 13, 6: 14, 7: 15, 8: 16, 9: 17, 10: 18,
  11: 1, 12: 2, 13: 13, 14: 14, 15: 15, 16: 16, 17: 17, 18: 18,
};

/**
 * The group, 1..18 — null for the f-block, which sits outside the eighteen
 * columns in every drawn table (whether lutetium "really" belongs in group 3
 * is a live argument in chemistry; a drawing must not take a side it cannot
 * defend, so the f-block gets its own two rows and no group number).
 *
 * From period 4 on, the rows are regular: the group is the atomic number less
 * the count of everything on the rows above, plus the f-block's fifteen once
 * the lanthanides have been passed.
 */
function group(z) {
  if (SHORT_ROW_GROUP[z] !== undefined) return SHORT_ROW_GROUP[z];
  if (fIndexOf(z) !== null) return null;
  const p = periodOf(z);
  if (p === 4) return z - 18;
  if (p === 5) return z - 36;
  if (p === 6) return z <= 56 ? z - 54 : z - 68;
  return z <= 88 ? z - 86 : z - 100;
}

function blockOf(z) {
  if (fIndexOf(z) !== null) return "f";
  const g = group(z);
  if (z === 2) return "s"; // helium: group 18, but its outer shell is 1s².
  if (g === 1 || g === 2) return "s";
  if (g >= 3 && g <= 12) return "d";
  return "p";
}

// ---- normalisation ---------------------------------------------------------

const CATEGORY = {
  "Nonmetal": "nonmetal",
  "Noble gas": "noble-gas",
  "Alkali metal": "alkali-metal",
  "Alkaline earth metal": "alkaline-earth-metal",
  "Metalloid": "metalloid",
  "Halogen": "halogen",
  "Post-transition metal": "post-transition-metal",
  "Transition metal": "transition-metal",
  "Lanthanide": "lanthanide",
  "Actinide": "actinide",
};

/** The source's five state strings collapse to three, plus a predicted flag —
 *  the superheavy elements' states are computed, not observed. */
function stateOf(raw) {
  const s = String(raw ?? "").toLowerCase();
  const predicted = s.startsWith("expected");
  for (const k of ["solid", "liquid", "gas"]) if (s.includes(k)) return { state20: k, state_predicted: predicted };
  return { state20: null, state_predicted: predicted };
}

/** A year, or "ancient" for the metals known to antiquity. "Ancient" is NOT
 *  year zero — a discovery-year colouring must give it its own bucket rather
 *  than pretending copper was found in 1 AD. */
function discoveredOf(raw) {
  const s = String(raw ?? "").trim();
  if (s === "" ) return null;
  if (/^ancient$/i.test(s)) return "ancient";
  const n = Number(s.match(/\d{3,4}/)?.[0]);
  return Number.isFinite(n) ? n : null;
}

const SUP = { 0: "⁰", 1: "¹", 2: "²", 3: "³", 4: "⁴", 5: "⁵", 6: "⁶", 7: "⁷", 8: "⁸", 9: "⁹" };
const SUBSHELL = { s: 0, p: 1, d: 2, f: 3 };

/**
 * "[Ar]4s2 3d6" -> "[Ar]3d⁶4s²". The source lists subshells in FILLING
 * (Aufbau) order; textbooks write them in shell order. Sorting by principal
 * quantum number and then by subshell is that convention exactly — a total
 * order over the same tokens, never a changed occupancy.
 */
function configOf(raw) {
  const s = String(raw ?? "").trim();
  const core = s.match(/^\[[A-Z][a-z]?\]/)?.[0] ?? "";
  const rest = s.slice(core.length);
  const toks = [...rest.matchAll(/(\d+)([spdf])(\d+)/g)].map((m) => ({ n: Number(m[1]), l: m[2], k: Number(m[3]) }));
  if (toks.length === 0) return s;
  toks.sort((a, b) => a.n - b.n || SUBSHELL[a.l] - SUBSHELL[b.l]);
  const sup = (k) => String(k).split("").map((d) => SUP[d]).join("");
  return core + toks.map((t) => `${t.n}${t.l}${sup(t.k)}`).join("");
}

const num = (v) => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));

// ---- build -----------------------------------------------------------------

const raw = JSON.parse(readFileSync(SRC, "utf8"));
const rows = Array.isArray(raw) ? raw : raw.elements ?? Object.values(raw)[0];
if (!Array.isArray(rows) || rows.length !== 118) throw new Error(`expected 118 source rows, got ${rows?.length}`);

const names = JSON.parse(readFileSync(NAMES, "utf8"));

const elements = rows
  .map((r) => {
    const z = Number(r.atomicNumber);
    const nm = names[r.symbol];
    if (!nm) throw new Error(`names.json has no entry for ${r.symbol} (z ${z})`);
    if (nm.z !== z) throw new Error(`names.json has ${r.symbol} at z ${nm.z}, the data has ${z}`);
    if (typeof nm.nb !== "string" || nm.nb === "") throw new Error(`names.json has no Norwegian name for ${r.symbol}`);
    const cat = CATEGORY[r.groupBlock];
    if (!cat) throw new Error(`unmapped category "${r.groupBlock}" for ${r.symbol}`);
    return {
      z,
      symbol: r.symbol,
      name: { en: r.name, nb: nm.nb, la: nm.la ?? null },
      mass: num(r.atomicMass),
      group: group(z),
      period: periodOf(z),
      block: blockOf(z),
      f_index: fIndexOf(z),
      category: cat,
      config: configOf(r.electronConfiguration),
      electronegativity: num(r.electronegativity),
      radius: num(r.atomicRadius),
      melt: num(r.meltingPoint),
      boil: num(r.boilingPoint),
      density: num(r.density),
      ...stateOf(r.standardState),
      discovered: discoveredOf(r.yearDiscovered),
    };
  })
  .sort((a, b) => a.z - b.z);

// Structural sanity: every z once, and every non-f element in exactly one cell.
const seen = new Set();
for (const e of elements) {
  if (seen.has(e.z)) throw new Error(`duplicate z ${e.z}`);
  seen.add(e.z);
  if (e.block === "f") {
    if (e.group !== null || e.f_index === null) throw new Error(`${e.symbol}: bad f-block placement`);
  } else if (!(e.group >= 1 && e.group <= 18)) {
    throw new Error(`${e.symbol}: group ${e.group} outside 1..18`);
  }
}
for (let z = 1; z <= 118; z++) if (!seen.has(z)) throw new Error(`missing z ${z}`);

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify({ elements }, null, 0) + "\n");

const gaps = (k) => elements.filter((e) => e[k] === null).length;
console.log(`wrote ${OUT}`);
console.log(`  ${elements.length} elements, ${(JSON.stringify({ elements }).length / 1024).toFixed(1)} kB`);
console.log(`  gaps: electronegativity ${gaps("electronegativity")}, radius ${gaps("radius")}, melt ${gaps("melt")}, boil ${gaps("boil")}, density ${gaps("density")}`);
console.log(`  latin names: ${elements.filter((e) => e.name.la).length}`);
