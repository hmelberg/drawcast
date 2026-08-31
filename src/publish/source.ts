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

/** Where a saving directory's manifest lives — alongside the sources it lists. */
export function sourceIndexPath(dir: string): string {
  return joinPath(dir, "sources", "index.json");
}

/** Tolerant read: a missing or damaged manifest starts a fresh one. A repo
 *  nothing has ever been saved to reads this way — not as an error. */
export function parseSourceManifest(text: string): SourceManifest {
  try {
    const raw = JSON.parse(text) as Partial<SourceManifest>;
    if (!Array.isArray(raw.sources)) return { sources: [] };
    return { sources: raw.sources.filter((s) => s && typeof s.path === "string") as SourceEntry[] };
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
  const path = sourcePathFor(args.title, args.dir, args.existing);
  const next = sourceManifest(manifest, { path, title: args.title || "Untitled drawcast", ts: new Date().toISOString() });

  await commitFiles(
    args.repo,
    args.token,
    defaultBranch,
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
