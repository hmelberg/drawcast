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

import { publishExt, stripDocExt } from "../cast-file";
import { coursePageStyle, escapeHtml, escapeMd } from "../course/page";
import { joinPath } from "../course/publish";
import {
  commitFiles,
  preflight,
  readFile,
  slugFor,
  slugify,
  type PublishFile,
  type RepoRef,
} from "./github";
import type { Registration } from "../names";
import { lockLectureFiles, type LectureLock } from "./lock";
import { castPageHtml } from "../standalone/page";
import { castFacts } from "../standalone/transcript";

export interface CastEntry {
  slug: string;
  title: string;
  /** Repo-relative-to-castsDir file name. */
  file: string;
  updated: string;
  /** It has its own page, `<slug>.html` beside it (a public publish since
   *  2026-10-03): the index and the sitemap link that, not drawcast.app. */
  page?: boolean;
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
  /** The cast's own page (`<slug>.html`, standalone/page.ts) — the fastest
   *  link to it. Absent for a private cast, which gets no page. */
  pageUrl?: string;
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
  /** The poster PNG (export/snapshot.ts posterPng), committed beside the
   *  cast as `<slug>.png` — the viewer shows it while the cast loads. */
  poster?: Uint8Array | null;
  /** A private cast: no page of its own (it would carry the cast unlocked). */
  private?: boolean;
}

/** Where a cast's poster lives: beside it, `.png` for `.yaml` (the viewer
 *  derives the same path from the link it was given). */
export function posterPathFor(castPath: string): string {
  return stripDocExt(castPath) + ".png";
}

/** The poster's address on the repo's GitHub Pages site — where a card's
 *  picture loads from, at no cost to drawcast.app (cards round, 2026-10-05). */
export function posterPagesUrl(owner: string, repo: string, castsDir: string, slug: string): string {
  return `https://${owner}.github.io/${repo}/${castsDir ? `${castsDir}/` : ""}${slug}.png`;
}

/**
 * The ONE prediction of a private cast's registry target and item key
 * (registry delivery 2, task 10) — Share's quote (privateRequest) and the
 * publish's own key fetch (main.ts privateCastLock) must agree on it, or a
 * cast is paid for under one item and locked under another. The rule is
 * buildCastPlan's: the Name field, else the slug it already publishes
 * under, else the title. `item` is the target without `.yaml` (Anvil's
 * registry.item_key for a cast).
 */
export function privateCastTarget(repo: RepoRef, castsDir: string, field: string | undefined, publishedAs: string | undefined, title: string): { target: string; item: string } {
  const slug = slugify((field ?? "").trim() || publishedAs || title || "lecture");
  const target = `${repo.owner}/${repo.repo}/${joinPath(castsDir, `${slug}${publishExt()}`)}`;
  return { target, item: stripDocExt(target) };
}

/** Where a cast's own page lives: beside it, `<slug>.html`. */
export function pagePathFor(castPath: string): string {
  return stripDocExt(castPath) + ".html";
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
  return { name: slug, kind: "cast", target: `${repo.owner}/${repo.repo}/${joinPath(castsDir, `${slug}${publishExt()}`)}`, page };
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
  const file = `${slug}${publishExt()}`;
  const path = joinPath(castsDir, file);

  const updated = new Date().toISOString().slice(0, 10);
  const next = upsertCast(index, { slug, title: title || "Untitled drawcast", file, updated, ...(args.private ? {} : { page: true }) });
  const pagesUrl = `https://${repo.owner}.github.io/${repo.repo}/${castsDir ? `${castsDir}/` : ""}`;
  const files: PublishFile[] = [
    { path, content: text },
    { path: joinPath(castsDir, "casts.json"), content: JSON.stringify(next, null, 2) + "\n" },
    { path: joinPath(castsDir, "index.html"), content: castsPage(next.casts, viewerBase, repo, castsDir) },
    // The list of pages for search engines (submit it in Search Console).
    { path: joinPath(castsDir, "sitemap.xml"), content: castsSitemap(next.casts, pagesUrl) },
    { path: joinPath(castsDir, "README.md"), content: castsReadme(next.casts, viewerBase, repo, castsDir) },
  ];
  // Pages runs Jekyll by default, which rewrites and skips files by its own
  // rules; these pages want serving verbatim. Only when the repo is ours to
  // shape, though — a repo we publish into a SUBFOLDER of may be someone's
  // Jekyll site, and this file at its root would break it.
  if (castsDir === "") files.push({ path: ".nojekyll", content: "" });
  if (args.poster) files.push({ path: posterPathFor(path), content: "", bytes: args.poster });
  // The cast's own page (standalone/page.ts): a DOOR to the .cast beside it
  // — the .cast stays the one copy, so an edit to it shows on the page at
  // once — with the player from drawcast.app and no name lookup. Its views
  // and comments are the cast's (`from`); its Transcript is what crawlers read.
  const pageUrl = args.private ? undefined : `${pagesUrl}${slug}.html`;
  if (pageUrl) {
    files.push({
      path: pagePathFor(path),
      content: castPageHtml({
        src: file,
        ...castFacts(text),
        title: title || "Untitled drawcast",
        url: pageUrl,
        image: args.poster ? `${pagesUrl}${slug}.png` : undefined,
        from: { owner: repo.owner, repo: repo.repo, path },
        author: repo.owner,
        // No date here: the page stays byte-identical across a republish of
        // an unchanged cast (the skill's push reads that as "no change");
        // the sitemap, a bookkeeping file, carries each page's date.
      }),
    });
  }

  return {
    slug,
    files,
    castUrl: castHref(viewerBase, repo.owner, repo.repo, path),
    readmeUrl: `https://github.com/${repo.owner}/${repo.repo}/tree/HEAD/${castsDir}`,
    pagesUrl,
    ...(pageUrl ? { pageUrl } : {}),
  };
}

/** The list a visitor opens: every published drawcast, newest first. */
export function castsPage(casts: CastEntry[], viewerBase: string, repo: RepoRef, castsDir = ""): string {
  const items = [...casts]
    .sort((a, b) => b.updated.localeCompare(a.updated) || a.title.localeCompare(b.title))
    .map(
      // The repo path, folder included (2026-10-03: it was left out, so a
      // cast published into casts/ was listed with a link that 404s).
      // A cast with its own page links that: a crawler can follow it, where
      // everything after drawcast.app's `#` is one empty page to a crawler.
      (c) =>
        `<li><a class="t" href="${escapeHtml(c.page ? `${stripDocExt(c.file)}.html` : castHref(viewerBase, repo.owner, repo.repo, joinPath(castsDir, c.file)))}">${escapeHtml(c.title)}</a> <span class="soon">${escapeHtml(c.updated)}</span></li>`,
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
 * The casts folder's sitemap: its index and every cast with a page, with the
 * date each was last published. Search engines find pages by links and by
 * this; the author submits it once (Google Search Console → Sitemaps).
 */
export function castsSitemap(casts: CastEntry[], pagesUrl: string): string {
  const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const newest = casts.reduce((d, c) => (c.updated > d ? c.updated : d), "");
  const urls = [
    `  <url><loc>${esc(pagesUrl)}</loc>${newest ? `<lastmod>${newest}</lastmod>` : ""}</url>`,
    ...casts.filter((c) => c.page).map((c) => `  <url><loc>${esc(`${pagesUrl}${stripDocExt(c.file)}.html`)}</loc><lastmod>${esc(c.updated)}</lastmod></url>`),
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.join("\n")}
</urlset>
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
  poster?: Uint8Array | null;
  /** Files committed alongside the cast's own — the registry's claim file
   *  (registry delivery 1), when this publish is proving repo ownership. */
  extraFiles?: PublishFile[];
  /** A PRIVATE cast (registry delivery 2, task 10): locks the cast file
   *  before the commit (publish/lock.ts — all or nothing, nothing committed
   *  on a failure). When set, no poster is committed: it would show a
   *  frame of the locked cast. */
  lock?: LectureLock;
  fetchImpl?: typeof fetch;
}

export interface CastPublishResult {
  /** Record this on the drawcast: it is what makes the link permanent. */
  slug: string;
  castUrl: string;
  readmeUrl: string;
  pagesUrl: string;
  pageUrl?: string;
  defaultBranch: string;
  count: number;
}

export async function publishCast(args: CastPublishArgs): Promise<CastPublishResult> {
  const fetchImpl = args.fetchImpl ?? fetch;
  const { defaultBranch } = await preflight(args.repo, args.token, fetchImpl);
  const indexText = await readFile(args.repo, joinPath(args.castsDir, "casts.json"), fetchImpl);
  const index = indexText ? parseCastIndex(indexText) : emptyCastIndex();

  // A private cast gets no poster at all — `poster` is dropped here, before
  // the plan, so no .png path can exist to be committed.
  const plan = buildCastPlan({ ...args, poster: args.lock ? null : args.poster, private: !!args.lock, index });
  const castPath = joinPath(args.castsDir, `${plan.slug}${publishExt()}`);
  const own = args.lock ? await lockLectureFiles(plan.files, [castPath], args.lock) : plan.files;
  // The claim file (registry delivery 1), when this publish is proving repo
  // ownership, rides in the same commit as the cast itself.
  const files = [...own, ...(args.extraFiles ?? [])];
  // No deletions: a cast owns exactly one file, and its slug never changes, so
  // there is never a stale path to remove. (Courses need them because a
  // deleted lecture would otherwise stay reachable at its old link forever.)
  // A private cast also removes a poster an earlier PUBLIC publish left —
  // it shows a frame of what is now locked (only if the repo has one). And a
  // cast written as .cast removes the .yaml it was before (if the repo has
  // one): the republish is its conversion.
  const before = castPath.endsWith(".cast") ? [`${stripDocExt(castPath)}.yaml`] : [];
  // Likewise its page: a page from a public publish carries the cast in the
  // clear, so going private removes it.
  await commitFiles(args.repo, args.token, defaultBranch, files, [], `drawcast: publish "${args.title || "Untitled drawcast"}"`, fetchImpl, undefined, [...(args.lock ? [posterPathFor(castPath), pagePathFor(castPath)] : []), ...before]);

  return {
    slug: plan.slug,
    castUrl: plan.castUrl,
    readmeUrl: plan.readmeUrl,
    pagesUrl: plan.pagesUrl,
    ...(plan.pageUrl ? { pageUrl: plan.pageUrl } : {}),
    defaultBranch,
    count: files.length,
  };
}
