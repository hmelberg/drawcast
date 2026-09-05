// Key algebra for view counting. Pure: no Blobs, no network, no dates beyond
// formatting — so every rule here is testable without a platform.
//
// Layout — the cast key's OWN slashes are real path separators, not escaped:
//   h/<castKey>/<YYYY-MM-DD>/<uuid>   one recorded view, one-byte body
//   r/<castKey>                        rollup: {"2026-09-01": 12, …}
//
// This used to percent-encode the cast key into one path segment (so "every
// cast in this repo" stayed a plain string prefix). That broke counting in
// production: the Blobs SDK embeds `set`/`get`/`delete`'s key directly into
// the request PATH, but sends `list`'s `prefix` through `URLSearchParams`,
// which independently re-encodes it — so a key containing a literal "%"
// (which percent-encoding the cast key's slashes always produces) travels
// the wire with a DIFFERENT number of encoding layers depending on which
// operation carries it. Verified directly: against Netlify's own local Blobs
// emulator (which leaves path segments un-decoded) the encoded form matched;
// against a plain one-decode-per-segment router — what most real HTTP
// frameworks do, and evidently what production does too — it matched
// NOTHING, reproducing the live symptom exactly (every POST "succeeded", GET
// always reported 0, not a consistency lag). A valid cast key never contains
// "%" (see CAST_KEY_RE), so leaving its slashes alone removes the asymmetry
// instead of routing around it: "every cast in this repo" is still a plain
// string prefix, because a real "/" is still just a character a prefix check
// can match on — Netlify Blobs keys are natively hierarchical (its own docs
// show `list({ prefix: 'cats/' })`), which is what this now relies on
// instead of fighting it.

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

/**
 * Owners whose keys are NOT public on GitHub. `anvil/<slug>/<file>` is the
 * drawcast server's own store (round 0, spec §4), and a cast there may be
 * private to a course — while the views endpoint is public and enumerable
 * by owner. So these keys are refused at every door of
 * netlify/functions/views.mts (see its header), and the client never sends
 * them (src/views.ts). Shape is a separate question: such a key is still
 * shape-valid, because learner events use the same rule and DO carry it, to
 * an authenticated backend. Exact match on the owner segment: a GitHub user
 * called `anvil-courses` is public like any other.
 */
const PRIVATE_OWNERS: ReadonlySet<string> = new Set(["anvil"]);

export function isPrivateOwner(owner: string): boolean {
  return PRIVATE_OWNERS.has(owner);
}

/** True for a key whose owner segment is private, whatever its shape. */
export function isPrivateCastKey(key: string): boolean {
  return isPrivateOwner(key.split("/", 1)[0]);
}

export function hitPrefix(castKey: string): string {
  return `h/${castKey}/`;
}

export function hitKey(castKey: string, day: string, id: string): string {
  return `h/${castKey}/${day}/${id}`;
}

export function rollupKey(castKey: string): string {
  return `r/${castKey}`;
}

export function repoHitPrefix(owner: string, repo: string): string {
  return `h/${owner}/${repo}/`;
}

export function repoRollupPrefix(owner: string, repo: string): string {
  return `r/${owner}/${repo}/`;
}

/** `r/<castKey>` → the cast key, or null if what follows "r/" isn't a valid
 *  cast key. This runs over real `list()` output, which can contain keys
 *  this module never wrote — a stray blob, or an orphan from the old
 *  percent-encoded layout (a literal "%2F" is never a valid cast key
 *  character, so those are rejected here, not silently treated as live). */
export function castKeyOfRollup(blobKey: string): string | null {
  const castKey = blobKey.slice("r/".length);
  return isValidCastKey(castKey) ? castKey : null;
}

/** `h/<castKey>/<day>/<id>` → the cast key, or null if the shape is wrong.
 *  `castKey` itself contains "/" (every valid one does — see CAST_KEY_RE),
 *  so this reads in from both ends: `parts[0]` must be "h", the last part is
 *  the id (ignored here), the second-to-last is the day, and everything
 *  between the marker and the day — rejoined — is the candidate cast key. */
export function castKeyOfHitKey(blobKey: string): string | null {
  const parts = blobKey.split("/");
  if (parts.length < 4 || parts[0] !== "h") return null;
  const castKey = parts.slice(1, -2).join("/");
  return isValidCastKey(castKey) ? castKey : null;
}

export function dayOfHitKey(blobKey: string): string | null {
  const parts = blobKey.split("/");
  if (parts.length < 4 || parts[0] !== "h") return null;
  const day = parts[parts.length - 2];
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null;
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
