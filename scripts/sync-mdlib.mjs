// Vendors the microdata emulator into public/mdlib/<MDLIB_VERSION>/.
//
// m2py.py is a 10k-line Python program that already runs under pyodide —
// which drawcast already runs — so the `microdata` language RUNS THE REAL
// EMULATOR rather than reimplementing its parser. That makes the microdata
// repo an upstream, and an upstream copied by hand drifts (the engine-js
// byte-copy that silently dropped dash entries). So: one script, one
// version stamp, and a manifest of exactly what was taken and when.
//
//   node scripts/sync-mdlib.mjs            # copy from ../microdata
//   node scripts/sync-mdlib.mjs --check    # verify the snapshot matches
//   node scripts/sync-mdlib.mjs --from PATH
//
// static_data/ (15 MB of frozen extracts) is deliberately NOT taken: the
// emulator generates realistic mock data on its own, which is what a
// teaching drawcast wants anyway.

import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");

// The snapshot version lives in one place (src/code/languages.ts); read it
// rather than duplicate it — pylib-sanity.py does the same.
const langs = readFileSync(join(ROOT, "src/code/languages.ts"), "utf8");
const MDLIB_VERSION = /MDLIB_VERSION = "([^"]+)"/.exec(langs)?.[1];
if (!MDLIB_VERSION) throw new Error("MDLIB_VERSION not found in src/code/languages.ts");

/** What the emulator needs to import and run. Order is irrelevant — the
 *  runner writes them all to the pyodide FS before importing m2py. */
const FILES = [
  "m2py.py", // the emulator: parser, mock-data engine, every command
  "functions.py", // the expression functions generate/keep see (imports scipy)
  "mockdata_core.py", // top-level import of m2py.py — must be present
  "mockdata_realism.py", // lazily imported; without it the mock data is flatter
  "protect.py", // the scrub-* commands
  "names.json",
  "variable_metadata.json", // the variable catalogue MicroInterpreter takes
];
const DIRS = ["codelists"]; // opened lazily by URL from metadata_base_url

const args = new Set(process.argv.slice(2));
const fromArg = process.argv.indexOf("--from");
const SRC = resolve(fromArg > -1 ? process.argv[fromArg + 1] : join(ROOT, "..", "microdata"));
const DEST = join(ROOT, "public", "mdlib", MDLIB_VERSION);
const check = args.has("--check");

if (!existsSync(join(SRC, "m2py.py"))) {
  console.error(`No microdata checkout at ${SRC} — pass --from <path>.`);
  process.exit(1);
}

const sha = (p) => createHash("sha256").update(readFileSync(p)).digest("hex").slice(0, 16);

const manifest = { version: MDLIB_VERSION, source: "microdata", copied: new Date().toISOString().slice(0, 10), files: {} };
let bytes = 0;
const problems = [];

if (!check) {
  // Remove only what THIS script owns. drawcast_microdata_runner.py lives in
  // the same folder and is drawcast's own code — wiping the directory would
  // delete it.
  mkdirSync(DEST, { recursive: true });
  for (const f of FILES) rmSync(join(DEST, f), { force: true });
  for (const d of DIRS) rmSync(join(DEST, d), { recursive: true, force: true });
  // Anything that imported the snapshot under local CPython leaves bytecode
  // behind, and the whole folder is copied verbatim into dist/.
  rmSync(join(DEST, "__pycache__"), { recursive: true, force: true });
}

for (const f of FILES) {
  const src = join(SRC, f);
  if (!existsSync(src)) {
    problems.push(`missing upstream: ${f}`);
    continue;
  }
  const digest = sha(src);
  manifest.files[f] = digest;
  bytes += statSync(src).size;
  if (check) {
    const dst = join(DEST, f);
    if (!existsSync(dst)) problems.push(`not vendored: ${f}`);
    else if (sha(dst) !== digest) problems.push(`stale: ${f}`);
  } else {
    cpSync(src, join(DEST, f));
  }
}

for (const d of DIRS) {
  const src = join(SRC, d);
  if (!existsSync(src)) continue;
  for (const name of readdirSync(src)) {
    const digest = sha(join(src, name));
    manifest.files[`${d}/${name}`] = digest;
    bytes += statSync(join(src, name)).size;
    if (check) {
      const dst = join(DEST, d, name);
      if (!existsSync(dst) || sha(dst) !== digest) problems.push(`stale or missing: ${d}/${name}`);
    }
  }
  if (!check) cpSync(src, join(DEST, d), { recursive: true });
}

if (check) {
  const onDisk = existsSync(join(DEST, "manifest.json")) ? JSON.parse(readFileSync(join(DEST, "manifest.json"), "utf8")) : null;
  if (!onDisk) problems.push("no manifest.json — run `node scripts/sync-mdlib.mjs`");
  if (problems.length > 0) {
    console.error(`mdlib ${MDLIB_VERSION} is out of date:\n  ${problems.join("\n  ")}`);
    process.exit(1);
  }
  console.log(`mdlib ${MDLIB_VERSION}: up to date (${Object.keys(manifest.files).length} files).`);
} else {
  if (problems.length > 0) {
    console.error(problems.join("\n"));
    process.exit(1);
  }
  writeFileSync(join(DEST, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(
    `mdlib ${MDLIB_VERSION}: ${Object.keys(manifest.files).length} files, ${(bytes / 1024 / 1024).toFixed(1)} MB → public/mdlib/${MDLIB_VERSION}/`,
  );
  console.log("drawcast_microdata_runner.py is drawcast's own — it is NOT overwritten by this script.");
}
