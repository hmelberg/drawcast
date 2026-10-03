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

// A drawcast file's extension, either generation (.cast script, or .yaml from
// before) — the same rule as src/cast-file.ts DOC_EXT_RE (pinned by
// tests/cast-github.test.ts), for the tooling that runs without the app's
// modules.
export const DOC_EXT_RE = /\.(cast|ya?ml)$/i;
export const stripDocExt = (name) => name.replace(DOC_EXT_RE, "");

/** The text format a drawcast file of this name is written in: a .cast is
 *  script, anything else (a .yaml) YAML — a file never holds the other
 *  generation's text under its name. */
export const formatForName = (name) => (/\.cast$/i.test(name) ? "script" : "yaml");

/** DRAWCAST_PUBLISH_CAST=1 (or true/yes/on) turns the tooling's .cast
 *  publishing on — src/cast-file.ts setPublishesCast(true). Off otherwise. */
export const publishCastFromEnv = (env) => /^(1|true|yes|on)$/i.test(String(env.DRAWCAST_PUBLISH_CAST ?? "").trim());

/**
 * The file lecture-build writes for lecture `n`: its recorded name under the
 * current rule (`publishName`: a recorded .yaml becomes .cast once the tooling
 * publishes .cast), else a new `NN-<slug><publishExt()>`. `old` is the
 * recorded name it replaces, when that differs — the caller removes it.
 */
export function lectureFileName({ recorded, n, slug, publishName, publishExt }) {
  const file = recorded ? publishName(recorded) : `${String(n).padStart(2, "0")}-${slug}${publishExt()}`;
  return { file, old: recorded && recorded !== file ? recorded : null };
}

/** Which of a folder's entries holds the drawcast file `file` names: itself,
 *  or (a workdir not converted yet) the same stem under the other extension. */
export function existingDoc(entries, file) {
  if (entries.includes(file)) return file;
  const stem = stripDocExt(file);
  return entries.find((e) => DOC_EXT_RE.test(e) && stripDocExt(e) === stem) ?? null;
}

/** The origin.json of a FIRST publish (cast.mjs publish-target): the shape
 *  pull writes, so push treats it like any revision. A slug already in the
 *  repo is never reused — slugFor picks a free one. A cast's file takes
 *  `ext`, the app's publishExt() (".yaml" until .cast publishing is on). */
export function publishOrigin({ kind, owner, repo, branch, base, clone, viewerBase, dir, slug, takenSlugs, slugFor, ext = ".yaml" }) {
  const free = takenSlugs.includes(slug) ? slugFor(slug, new Set(takenSlugs)) : slug;
  const common = { owner, repo, branch, base, clone, viewerBase, pulled: new Date().toISOString(), published: "new" };
  if (kind === "course") return { slug: free, origin: { kind, ...common, path: join(dir, free), coursesDir: dir, lecture: null } };
  const castsDir = join(dir, "casts");
  const file = `${free}${ext}`;
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
  const fromTree = kind === "course" ? tree.map(stem) : tree.filter((n) => DOC_EXT_RE.test(n)).map(stem);
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
