// A drawcast FILE's name (2026-10-03, .cast files): `<slug>.cast` (script)
// or, from before, `<slug>.yaml`. One rule for every place that adds, strips
// or checks the extension, so a .cast file is never half-supported.
// netlify/lib (which must not import src/) and the Anvil server keep copies,
// pinned by tests/cast-files.test.ts.

/** The extension of a drawcast document file, either generation. */
export const DOC_EXT_RE = /\.(cast|ya?ml)$/i;

/** The file without its drawcast extension: `casts/intro.cast` → `casts/intro`. */
export const stripDocExt = (path: string): string => path.replace(DOC_EXT_RE, "");
