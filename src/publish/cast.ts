// Publishing ONE drawcast to the author's own public repo.
//
// The course path's smaller sibling: same commitFiles, same preflight, same
// slugFor, one folder (`casts/`) instead of one per course. A drawcast is not
// a course of one — it has no plan document, no lecture list and no per-lecture
// status — so it gets its own thin plan rather than a course shaped to fit.
//
// Its index lives in `casts/casts.json` rather than as a key in `courses.json`,
// deliberately: parseManifest rebuilds `{ courses }` and drops every other key,
// so anything stored beside it would be erased by the next course publish.

import { coursePageStyle, escapeHtml, escapeMd } from "../course/page";
import { joinPath } from "../course/publish";
import {
  commitFiles,
  preflight,
  readFile,
  slugFor,
  type PublishFile,
  type RepoRef,
} from "./github";
import type { Registration } from "../names";

export interface CastEntry {
  slug: string;
  title: string;
  /** Repo-relative-to-castsDir file name. */
  file: string;
  updated: string;
}

export interface CastIndex {
  casts: CastEntry[];
}

export function emptyCastIndex(): CastIndex {
  return { casts: [] };
}

/** Tolerant read: a missing or damaged index starts a fresh one. */
export function parseCastIndex(text: string): CastIndex {
  try {
    const raw = JSON.parse(text) as Partial<CastIndex>;
    if (!Array.isArray(raw.casts)) return emptyCastIndex();
    return { casts: raw.casts.filter((c) => c && typeof c.slug === "string") as CastEntry[] };
  } catch {
    return emptyCastIndex();
  }
}

export function upsertCast(index: CastIndex, entry: CastEntry): CastIndex {
  return { casts: [...index.casts.filter((c) => c.slug !== entry.slug), entry] };
}

export interface CastPlan {
  slug: string;
  files: PublishFile[];
  /** The link to share: the viewer, pointed at the published file. */
  castUrl: string;
  /** github.com's own rendering of the folder — works before Pages is on. */
  readmeUrl: string;
  /** The Pages index of every published drawcast. */
  pagesUrl: string;
}

export interface CastPlanArgs {
  title: string;
  /** The serialized document, published verbatim — baked audio and all. */
  text: string;
  /** The name requested for this publish (B3's editable Link field) — the
   *  name to publish under if it is available. May differ from
   *  `previousSlug` (a rename), equal it (an unedited republish), or be
   *  absent entirely. */
  slug?: string;
  /** The slug this drawcast is ALREADY published under, if any — distinct
   *  from `slug` (merely requested) so a republish under its own, unedited
   *  name is recognized as OWNING that slug rather than just asking for a
   *  name that happens to already be taken (by itself). */
  previousSlug?: string;
  repo: RepoRef;
  castsDir: string;
  viewerBase: string;
  index: CastIndex;
}

export function castHref(base: string, owner: string, repo: string, path: string): string {
  return `${base.replace(/\/+$/, "")}/#gh=${owner}/${repo}/${path}`;
}

/**
 * What a drawcast publish registers (spec §7). A cast has no document to carry
 * a `name:` override, so its slug — the name that is already permanent — is
 * the name.
 */
export function castRegistration(slug: string, repo: RepoRef, castsDir: string, page: string): Omit<Registration, "key"> {
  return { name: slug, kind: "cast", target: `${repo.owner}/${repo.repo}/${joinPath(castsDir, `${slug}.yaml`)}`, page };
}

export function buildCastPlan(args: CastPlanArgs): CastPlan {
  const { title, text, repo, castsDir, viewerBase, index, previousSlug } = args;
  // A recorded slug is permanent: retitling a drawcast must never move the file
  // a shared link already points at. Only a NEW one has to avoid the names
  // already taken — and republishing must not read its own name as a clash.
  const taken = new Set(index.casts.map((c) => c.slug).filter((s) => s !== previousSlug));
  const requested = args.slug || previousSlug;
  // A republish under its own, unedited slug keeps it even though that name
  // is (obviously) "taken" in the index — it's taken by THIS drawcast, which
  // `taken` already excludes above. Any OTHER requested name — a first
  // publish whose auto-slug collides with someone else's, or a rename typed
  // to a name another cast already owns — must never silently steal that
  // other entry, so it is uniquified exactly like a plain title would be.
  const slug = requested && (requested === previousSlug || !taken.has(requested)) ? requested : slugFor(requested || title || "lecture", taken);
  const file = `${slug}.yaml`;
  const path = joinPath(castsDir, file);

  const next = upsertCast(index, { slug, title: title || "Untitled drawcast", file, updated: new Date().toISOString().slice(0, 10) });
  const files: PublishFile[] = [
    { path, content: text },
    { path: joinPath(castsDir, "casts.json"), content: JSON.stringify(next, null, 2) + "\n" },
    { path: joinPath(castsDir, "index.html"), content: castsPage(next.casts, viewerBase, repo) },
    { path: joinPath(castsDir, "README.md"), content: castsReadme(next.casts, viewerBase, repo, castsDir) },
  ];
  // Pages runs Jekyll by default, which rewrites and skips files by its own
  // rules; these pages want serving verbatim. Only when the repo is ours to
  // shape, though — a repo we publish into a SUBFOLDER of may be someone's
  // Jekyll site, and this file at its root would break it.
  if (castsDir === "") files.push({ path: ".nojekyll", content: "" });

  return {
    slug,
    files,
    castUrl: castHref(viewerBase, repo.owner, repo.repo, path),
    readmeUrl: `https://github.com/${repo.owner}/${repo.repo}/tree/HEAD/${castsDir}`,
    pagesUrl: `https://${repo.owner}.github.io/${repo.repo}/${castsDir ? `${castsDir}/` : ""}`,
  };
}

/** The list a visitor opens: every published drawcast, newest first. */
export function castsPage(casts: CastEntry[], viewerBase: string, repo: RepoRef): string {
  const items = [...casts]
    .sort((a, b) => b.updated.localeCompare(a.updated) || a.title.localeCompare(b.title))
    .map(
      (c) =>
        `<li><a class="t" href="${escapeHtml(castHref(viewerBase, repo.owner, repo.repo, c.file))}">${escapeHtml(c.title)}</a> <span class="soon">${escapeHtml(c.updated)}</span></li>`,
    )
    .join("\n");
  return `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Drawcasts</title>
<style>${coursePageStyle()}</style>
<h1>Drawcasts</h1>
<ol>
${items}
</ol>
<footer>Made with <a href="https://drawcast.app/">drawcast</a></footer>
</html>
`;
}

/**
 * github.com renders a folder's README.md with working links, so a drawcast is
 * shareable the moment it is committed — no Pages, no build, no waiting.
 *
 * The links are ABSOLUTE viewer links, not relative repo paths: a .yaml opened
 * on github.com shows the source, which is not what a link to a drawcast should
 * do.
 */
export function castsReadme(casts: CastEntry[], viewerBase: string, repo: RepoRef, castsDir: string): string {
  const out = ["# Drawcasts", ""];
  for (const c of [...casts].sort((a, b) => b.updated.localeCompare(a.updated))) {
    out.push(`- [${escapeMd(c.title)}](${castHref(viewerBase, repo.owner, repo.repo, joinPath(castsDir, c.file))}) — ${c.updated}`);
  }
  out.push("", "---", "", "Made with [drawcast](https://drawcast.app/).");
  return out.join("\n") + "\n";
}

export interface CastPublishArgs {
  title: string;
  text: string;
  /** The name requested for this publish — see `CastPlanArgs.slug`. */
  slug?: string;
  /** The slug this drawcast is already published under, if any — see
   *  `CastPlanArgs.previousSlug`. */
  previousSlug?: string;
  repo: RepoRef;
  token: string;
  castsDir: string;
  viewerBase: string;
  fetchImpl?: typeof fetch;
}

export interface CastPublishResult {
  /** Record this on the drawcast: it is what makes the link permanent. */
  slug: string;
  castUrl: string;
  readmeUrl: string;
  pagesUrl: string;
  defaultBranch: string;
  count: number;
}

export async function publishCast(args: CastPublishArgs): Promise<CastPublishResult> {
  const fetchImpl = args.fetchImpl ?? fetch;
  const { defaultBranch } = await preflight(args.repo, args.token, fetchImpl);
  const indexText = await readFile(args.repo, joinPath(args.castsDir, "casts.json"), fetchImpl);
  const index = indexText ? parseCastIndex(indexText) : emptyCastIndex();

  const plan = buildCastPlan({ ...args, index });
  // No deletions: a cast owns exactly one file, and its slug never changes, so
  // there is never a stale path to remove. (Courses need them because a
  // deleted lecture would otherwise stay reachable at its old link forever.)
  await commitFiles(args.repo, args.token, defaultBranch, plan.files, [], `drawcast: publish "${args.title || "Untitled drawcast"}"`, fetchImpl);

  return {
    slug: plan.slug,
    castUrl: plan.castUrl,
    readmeUrl: plan.readmeUrl,
    pagesUrl: plan.pagesUrl,
    defaultBranch,
    count: plan.files.length,
  };
}
