// Saving the SOURCE to GitHub — the .yaml you are editing, not the rendered
// page Share/Publish commits for an audience (publish/cast.ts). Both can
// exist for one document, and neither implies the other: Publish says
// "Published to <url>", this says "Saved "<title>" to <owner>/<repo>".
//
// Shares commitFiles, preflight and readFile with the publishing path, but
// keeps its own manifest (sources/index.json) rather than a key in any other
// index — a missing one is the normal state of a repo nothing has been saved
// to yet, not an error.

import { joinPath } from "../course/publish";
import { commitFiles, preflight, readFile, slugify, type RepoRef } from "./github";

export interface SourceEntry {
  path: string;
  title: string;
  ts: string;
}

export interface SourceManifest {
  sources: SourceEntry[];
}

export function sourcePathFor(title: string, dir: string, existing: string | null): string {
  // A document keeps the path it was first saved to. Retitling must not leave
  // the old file behind as an orphan nobody will ever delete.
  if (existing) return existing;
  return joinPath(dir, "sources", `${slugify(title) || "drawcast"}.yaml`);
}

export function sourceManifest(m: SourceManifest, e: SourceEntry): SourceManifest {
  const at = m.sources.findIndex((s) => s.path === e.path);
  return { sources: at === -1 ? [...m.sources, e] : m.sources.map((s) => (s.path === e.path ? e : s)) };
}

/**
 * A candidate path already claimed by a DIFFERENT document in the manifest
 * gets suffixed -2, -3, … until free — same shape as publish/github.ts's
 * slugFor. Two never-saved documents both titled "Untitled drawcast" would
 * otherwise mint the identical path; the second save's commit would
 * overwrite the first's file in HEAD, and sourceManifest's replace-by-path
 * would erase the first's entry too — silent, unannounced data loss.
 *
 * Never called for a re-save: sourcePathFor already returns the document's
 * OWN existing path in that case, which by definition it already owns in the
 * manifest, so it can never collide with itself here.
 */
export function uniqueSourcePath(candidate: string, manifest: SourceManifest): string {
  const taken = new Set(manifest.sources.map((s) => s.path));
  if (!taken.has(candidate)) return candidate;
  const extMatch = /\.ya?ml$/.exec(candidate);
  const ext = extMatch ? extMatch[0] : "";
  const base = ext ? candidate.slice(0, -ext.length) : candidate;
  for (let n = 2; ; n++) {
    const next = `${base}-${n}${ext}`;
    if (!taken.has(next)) return next;
  }
}

/** Where a saving directory's manifest lives — alongside the sources it lists. */
export function sourceIndexPath(dir: string): string {
  return joinPath(dir, "sources", "index.json");
}

/**
 * Tolerant read: a missing or damaged manifest starts a fresh one. A repo
 * nothing has ever been saved to reads this way — not as an error.
 *
 * Validates every field, not just `path`: a hand-edited entry missing `ts`
 * would otherwise reach `main.ts`'s `b.ts.localeCompare(a.ts)` sort and throw
 * — turning one bad entry into the WHOLE listing failing ("GitHub open
 * failed"). A malformed entry is dropped and the rest still list.
 */
export function parseSourceManifest(text: string): SourceManifest {
  try {
    const raw = JSON.parse(text) as Partial<SourceManifest>;
    if (!Array.isArray(raw.sources)) return { sources: [] };
    return {
      sources: raw.sources.filter(
        (s): s is SourceEntry => !!s && typeof s.path === "string" && typeof s.title === "string" && typeof s.ts === "string",
      ),
    };
  } catch {
    return { sources: [] };
  }
}

export interface SaveSourceArgs {
  title: string;
  /** The document's YAML, published verbatim — this IS the source, unrendered. */
  text: string;
  /** This document's recorded source path, or null if it has never been saved. */
  existing: string | null;
  dir: string;
  repo: RepoRef;
  token: string;
  fetchImpl?: typeof fetch;
}

export interface SaveSourceResult {
  /** Record this on the document: what stops a later save minting a second file. */
  path: string;
  defaultBranch: string;
}

/**
 * One commit carrying both the .yaml and the updated manifest. Two commits
 * would let an interruption between them leave the manifest naming a file
 * that was never written — Open would then offer a document it cannot fetch.
 */
export async function saveSource(args: SaveSourceArgs): Promise<SaveSourceResult> {
  const fetchImpl = args.fetchImpl ?? fetch;
  const { defaultBranch } = await preflight(args.repo, args.token, fetchImpl);
  const indexPath = sourceIndexPath(args.dir);
  const indexText = await readFile(args.repo, indexPath, fetchImpl);
  const manifest = indexText ? parseSourceManifest(indexText) : { sources: [] };
  const candidate = sourcePathFor(args.title, args.dir, args.existing);
  // Collision-check only a FIRST save (existing === null): a re-save's
  // `existing` is by definition already this document's own entry in the
  // manifest, so uniqueSourcePath would see it as "taken" and wrongly
  // suffix a document saving over itself.
  const path = args.existing ? candidate : uniqueSourcePath(candidate, manifest);
  const next = sourceManifest(manifest, { path, title: args.title || "Untitled drawcast", ts: new Date().toISOString() });

  await commitFiles(
    args.repo,
    args.token,
    defaultBranch,
    // The .yaml MUST be files[0], the manifest files[1] — not just for
    // readability. In an EMPTY repo, commitFiles seeds files[0] alone through
    // the Contents API as its OWN commit, before the real one lands (the only
    // place a "one commit" save can still become two GitHub commits). With
    // the .yaml first, an interruption between them leaves a file that
    // exists but no manifest entry for it yet — silent but safe. Reversed,
    // it would leave a manifest naming a file that was never written, which
    // is exactly the failure the one-commit rule exists to prevent. Do not
    // swap this order; see tests/source-save.test.ts's empty-repo case,
    // which asserts the seed call's path is the .yaml, not the manifest.
    [
      { path, content: args.text },
      { path: indexPath, content: JSON.stringify(next, null, 2) + "\n" },
    ],
    [],
    `drawcast: save source "${args.title || "Untitled drawcast"}"`,
    fetchImpl,
  );

  return { path, defaultBranch };
}
