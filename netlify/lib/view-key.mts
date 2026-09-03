// Key algebra for view counting. Pure: no Blobs, no network, no dates beyond
// formatting — so every rule here is testable without a platform.
//
// Layout, with <enc> = the cast key percent-encoded into ONE path segment:
//   h/<enc>/<YYYY-MM-DD>/<uuid>   one recorded view, empty body
//   r/<enc>                        rollup: {"2026-09-01": 12, …}
//
// One segment matters: it makes "every cast in this repo" a plain string
// prefix, because encodeURIComponent touches only "/" in a legal cast key.

/**
 * The path half must match what the VIEWER will open — `DOC_PATH_RE` in
 * src/viewer.ts. A key the viewer can reach but the counter rejects would be
 * a drawcast that silently never counts, which is worse than a loud 400.
 */
const CAST_KEY_RE = /^[\w.-]+\/[\w.-]+\/(?!.*\.\.)[\w./-]+\.(ya?ml|json|txt)$/;

/** Netlify caps Blobs keys at 600 bytes; a real key is nearer 100 because
 *  slugs are capped at 40 chars (src/publish/github.ts). 300 leaves room for
 *  the prefix, date and uuid without letting anyone bloat the store. */
const MAX_CAST_KEY_BYTES = 300;

export function isValidCastKey(key: string): boolean {
  if (!key || key.length > MAX_CAST_KEY_BYTES) return false;
  return CAST_KEY_RE.test(key);
}

export function encodeCastKey(key: string): string {
  return encodeURIComponent(key);
}

export function hitPrefix(enc: string): string {
  return `h/${enc}/`;
}

export function hitKey(enc: string, day: string, id: string): string {
  return `h/${enc}/${day}/${id}`;
}

export function rollupKey(enc: string): string {
  return `r/${enc}`;
}

export function repoHitPrefix(owner: string, repo: string): string {
  return `h/${encodeURIComponent(`${owner}/${repo}/`)}`;
}

export function repoRollupPrefix(owner: string, repo: string): string {
  return `r/${encodeURIComponent(`${owner}/${repo}/`)}`;
}

/** `r/<enc>` → the cast key, or null if `<enc>` is not valid percent-encoding.
 *  This runs over real `list()` output, which can contain keys this module
 *  never wrote — a stray or legacy blob — so decodeURIComponent's throw on a
 *  malformed sequence must not propagate. */
export function castKeyOfRollup(blobKey: string): string | null {
  try {
    return decodeURIComponent(blobKey.slice("r/".length));
  } catch {
    return null;
  }
}

/** `h/<enc>/<day>/<id>` → the cast key, or null if the shape is wrong or
 *  `<enc>` is not valid percent-encoding (see castKeyOfRollup). */
export function castKeyOfHitKey(blobKey: string): string | null {
  const parts = blobKey.split("/");
  if (parts.length !== 4 || parts[0] !== "h") return null;
  try {
    return decodeURIComponent(parts[1]);
  } catch {
    return null;
  }
}

export function dayOfHitKey(blobKey: string): string | null {
  const parts = blobKey.split("/");
  if (parts.length !== 4 || parts[0] !== "h") return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(parts[2]) ? parts[2] : null;
}

/** UTC, so "today" is one thing worldwide, and ISO so string order is date
 *  order — compaction compares days with `<`. */
export function dayString(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** The folder a cast publishes into: the course slug for a lecture, `casts`
 *  for a single drawcast. Per-course totals are just this grouping. */
export function courseFolderOf(castKey: string): string {
  const parts = castKey.split("/").slice(2);
  parts.pop();
  return parts.join("/");
}
