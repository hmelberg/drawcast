// A drawcast FILE's name (2026-10-03, .cast files): `<slug>.cast` (script)
// or, from before, `<slug>.yaml`. One rule for every place that adds, strips
// or checks the extension, so a .cast file is never half-supported.
// netlify/lib (which must not import src/) and the Anvil server keep copies,
// pinned by tests/cast-files.test.ts.

/** The extension of a drawcast document file, either generation. */
export const DOC_EXT_RE = /\.(cast|ya?ml)$/i;

/** The file without its drawcast extension: `casts/intro.cast` → `casts/intro`. */
export const stripDocExt = (path: string): string => path.replace(DOC_EXT_RE, "");

/**
 * What PUBLISHING writes: `.cast` (script) or, until the drawcast server
 * accepts .cast keys, `.yaml`. The server checks every cast key against its
 * extension list (drawcast-anvil parsers.py CAST_RE) — learner events,
 * names, registration and server publishing would all be refused for a
 * .cast key it does not know. Flip to true once drawcast-anvil's
 * `cast-files` branch is deployed. A setter, not a constant, so tests can
 * hold both generations.
 */
let publishCast = false;
export const publishesCast = (): boolean => publishCast;
export function setPublishesCast(on: boolean): void {
  publishCast = on;
}

/** The extension a newly published file gets. */
export const publishExt = (): ".cast" | ".yaml" => (publishCast ? ".cast" : ".yaml");
/** The text format a published file is written in. */
export const publishFormat = (): "script" | "yaml" => (publishCast ? "script" : "yaml");
/** The MIME type for a published file (Drive). */
export const publishMime = (): string => (publishCast ? "text/plain" : "text/yaml");

/**
 * A recorded file name under the current rule: a `.yaml` lecture or cast
 * becomes `.cast` once publishing writes .cast — the republish IS its
 * conversion (the old file is removed in the same commit). Anything else
 * (a .json, a .cast) is kept.
 */
export function publishName(recorded: string): string {
  return publishCast && /\.ya?ml$/i.test(recorded) ? `${stripDocExt(recorded)}.cast` : recorded;
}
