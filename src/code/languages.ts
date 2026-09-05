// The one place a code runtime is declared. Types, the schema enum, the
// cache key, the dispatch table, the authoring-time check and the prompt
// drift test all read this — so adding a runtime is one entry here plus its
// module, and a list that drifts from another is a test failure, not a
// silent gap (the vocabulary-in-five-places trap).
//
// Dependency-free on purpose: imported by spec/types.ts and spec/schema.ts,
// which must not transitively pull IndexedDB or any runtime loader.

export const LANGUAGES = ["python", "r", "brython", "micropython", "microdata", "basic"] as const;
export type Language = (typeof LANGUAGES)[number];

export function isLanguage(x: unknown): x is Language {
  return typeof x === "string" && (LANGUAGES as readonly string[]).includes(x);
}

/** What the loading pill and the check's warnings call each runtime. */
export const RUNTIME_LABEL: Record<Language, string> = {
  python: "Python",
  r: "R",
  brython: "Brython",
  micropython: "MicroPython",
  microdata: "microdata",
  basic: "C64 BASIC",
};

/** Pinned runtime versions — part of the cache key, so an upgrade misses
 *  cleanly instead of replaying stale output. python: pyodide (openstat's
 *  verified pin); r: webR; brython: the jsdelivr bundle; micropython: the
 *  pyscript WebAssembly build openstat runs; microdata: the SAME pyodide —
 *  the m2py emulator is a Python program, so its interpreter pin is
 *  pyodide's and its own snapshot rides in MDLIB_VERSION below. */
const PYODIDE_PIN = "314.0.2";

export const RUNTIME_VERSION: Record<Language, string> = {
  python: PYODIDE_PIN,
  r: "0.6.0",
  brython: "3.12.0",
  micropython: "1.27.0",
  microdata: PYODIDE_PIN,
  // drawcast's own interpreter (code/basic.ts): its version is ours to bump
  // when its behaviour changes, so a cached screen never outlives the rules
  // that drew it.
  basic: "1",
};

/** The vendored pure-Python library snapshot (public/pylib/<version>/) the
 *  dialects load. A new snapshot changes outputs exactly like a runtime
 *  upgrade, so it rides in the dialects' cache tag. */
export const PYLIB_VERSION = "2026-09-03";

/** The vendored microdata emulator snapshot (public/mdlib/<version>/) —
 *  m2py.py and the metadata it reads, copied from the microdata repo by
 *  scripts/sync-mdlib.mjs. A new snapshot changes what a script prints
 *  exactly like a runtime upgrade, so it rides in microdata's cache tag. */
export const MDLIB_VERSION = "2026-09-04";

export function cacheTag(language: Language): string {
  switch (language) {
    case "python":
      return `py${RUNTIME_VERSION.python}`;
    case "r":
      return `r${RUNTIME_VERSION.r}`;
    case "brython":
      return `bry${RUNTIME_VERSION.brython}+${PYLIB_VERSION}`;
    case "micropython":
      return `mpy${RUNTIME_VERSION.micropython}+${PYLIB_VERSION}`;
    case "microdata":
      return `md${RUNTIME_VERSION.microdata}+${MDLIB_VERSION}`;
    case "basic":
      return `bas${RUNTIME_VERSION.basic}`;
  }
}
