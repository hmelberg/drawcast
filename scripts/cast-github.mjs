// The pure parts of the /drawcast skill's revise-from-GitHub commands
// (scripts/cast.mjs pull/push), apart so tests can reach them.

/**
 * Where a drawcast lives on GitHub, from any link to it: github.com (tree/blob),
 * raw.githubusercontent.com, a player link (…/#gh=owner/repo/path), a Pages
 * URL (owner.github.io/repo/path/) or plain owner/repo/path.
 */
export function parseGithubTarget(url) {
  const u = url.trim().replace(/[?#]$/, "");
  const trim = (p) => decodeURIComponent(p ?? "").replace(/^\/+|\/+$/g, "").replace(/\/index\.html$|^index\.html$/, "");
  let m;
  if ((m = /#gh=([\w.-]+)\/([\w.-]+)\/(.+)$/.exec(u))) return { owner: m[1], repo: m[2], branch: null, path: trim(m[3]) };
  if ((m = /^https?:\/\/github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:\/(?:tree|blob)\/([^/]+)(\/.*)?)?\/?$/.exec(u))) return { owner: m[1], repo: m[2], branch: m[3] ?? null, path: trim(m[4]) };
  if ((m = /^https?:\/\/raw\.githubusercontent\.com\/([\w.-]+)\/([\w.-]+)\/([^/]+)\/(.+)$/.exec(u))) return { owner: m[1], repo: m[2], branch: m[3], path: trim(m[4]) };
  if ((m = /^https?:\/\/([\w-]+)\.github\.io\/([\w.-]+)(\/.*)?$/.exec(u))) return { owner: m[1], repo: m[2], branch: null, path: trim(m[3]) };
  if ((m = /^([\w.-]+)\/([\w.-]+)(\/.*)?$/.exec(u))) return { owner: m[1], repo: m[2], branch: null, path: trim(m[3]) };
  throw new Error(`not a GitHub link I can read: ${url}`);
}

const unescapeHtml = (s) => s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");

/**
 * The course page's Join door as it is now, so a republish from here keeps it:
 * a door to a registered name, or the reason there is none (course/page.ts).
 * A page with no join section gives undefined, which is what it was built with.
 *
 * The door's href ends `&join` (Task 8, courseHref in course/page.ts) —
 * escapeHtml turns that `&` into `&amp;` in the page itself, so the raw
 * capture is unescaped BEFORE the trailing `&join` is trimmed back off, so a
 * push does not rewrite the door to a name literally called "<name>&join".
 * An older page with no `&join` suffix still reads fine: nothing to trim.
 */
export function pageDoor(html, doorlessNote) {
  if (!html) return undefined;
  const door = /<a class="door" href="([^"]*?)\/?#([^"]+)"/.exec(html);
  if (door) return { name: unescapeHtml(door[2]).replace(/&join$/, ""), app: door[1] + "/" };
  const note = /Joining is not open yet<\/b> — ([^<]*)</.exec(html)?.[1];
  if (note === undefined) return undefined;
  const reasons = ["signed-out", "taken", "short", "invalid", "owner", "elsewhere", "unreachable", "unregistered"];
  const why = reasons.find((r) => doorlessNote(r) === unescapeHtml(note).trim());
  return { name: null, why: why ?? "unregistered" };
}

const join = (...p) => p.filter(Boolean).join("/");

/** The origin.json of a FIRST publish (cast.mjs publish-target): the shape
 *  pull writes, so push treats it like any revision. A slug already in the
 *  repo is never reused — slugFor picks a free one. */
export function publishOrigin({ kind, owner, repo, branch, base, clone, viewerBase, dir, slug, takenSlugs, slugFor }) {
  const free = takenSlugs.includes(slug) ? slugFor(slug, new Set(takenSlugs)) : slug;
  const common = { owner, repo, branch, base, clone, viewerBase, pulled: new Date().toISOString(), published: "new" };
  if (kind === "course") return { slug: free, origin: { kind, ...common, path: join(dir, free), coursesDir: dir, lecture: null } };
  const castsDir = join(dir, "casts");
  const file = `${free}.yaml`;
  return { slug: free, origin: { kind, ...common, path: join(castsDir, file), castsDir, file } };
}

/** The GitHub Pages address of a folder in owner/repo. */
export function pagesUrlFor(owner, repo, path) {
  return `https://${owner}.github.io/${repo}/${path ? `${path}/` : ""}`;
}

/** The slugs a first publish may not take: those the manifest lists AND every
 *  name already in the folder on GitHub (a course made by hand, a manifest
 *  kept elsewhere) — push --direct would otherwise write over them. A course
 *  may also not be called `casts`, the folder single casts live in. `tree` is
 *  the folder's entry names (git ls-tree); compared lower-case, extension off. */
export function takenSlugs({ kind, listed, tree }) {
  const stem = (n) => n.toLowerCase().replace(/\.[a-z0-9]+$/, "");
  const fromTree = kind === "course" ? tree.map(stem) : tree.filter((n) => /\.ya?ml$/i.test(n)).map(stem);
  return [...new Set([...listed, ...fromTree, ...(kind === "course" ? ["casts"] : [])])];
}

/** Bookkeeping a publish rewrites every time: on its own it is no change
 *  (the manifests' dates, READMEs, index pages, the registry claim). */
const BOOKKEEPING_RE = /(^|\/)(courses\.json|casts\.json|index\.html|README\.md|\.drawcast\/claim)$/;

/**
 * What a push would change against upstream (cast.mjs push), compared by
 * bytes — a redrawn picture identical to GitHub's is no change, a new or
 * different one is (spec 2026-10-02-share-design §7.1: pull then push adds
 * pictures to an older repo). `real` is what is worth a commit.
 */
export function fileChanges(files, deletions, readAt) {
  const changes = [];
  for (const f of files) {
    const now = readAt(f.path);
    const want = f.bytes ? Buffer.from(f.bytes) : Buffer.from(f.content, "utf8");
    if (now === null) changes.push(["new", f.path]);
    else if (!now.equals(want)) changes.push(["changed", f.path]);
  }
  for (const p of deletions) changes.push(["deleted", p]);
  return { changes, real: changes.filter(([, p]) => !BOOKKEEPING_RE.test(p)) };
}
