// The one place a code runtime is declared. Types, the schema enum, the
// cache key, the dispatch table, the authoring-time check and the prompt
// drift test all read this — so adding a runtime is one entry here plus its
// module, and a list that drifts from another is a test failure, not a
// silent gap (the vocabulary-in-five-places trap).
//
// Dependency-free on purpose: imported by spec/types.ts and spec/schema.ts,
// which must not transitively pull IndexedDB or any runtime loader.

export const LANGUAGES = ["python", "r", "brython", "micropython"] as const;
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
};

/** Pinned runtime versions — part of the cache key, so an upgrade misses
 *  cleanly instead of replaying stale output. python: pyodide (openstat's
 *  verified pin); r: webR; brython: the jsdelivr bundle; micropython: the
 *  pyscript WebAssembly build openstat runs. */
export const RUNTIME_VERSION: Record<Language, string> = {
  python: "314.0.2",
  r: "0.6.0",
  brython: "3.12.0",
  micropython: "1.27.0",
};

/** The vendored pure-Python library snapshot (public/pylib/<version>/) the
 *  dialects load. A new snapshot changes outputs exactly like a runtime
 *  upgrade, so it rides in the dialects' cache tag. */
export const PYLIB_VERSION = "2026-09-03";

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
  }
}
