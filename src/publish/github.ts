// Publishing a course to the author's OWN public repo. One atomic commit
// through the Git Data API — five calls regardless of file count, rather than
// the Contents API's one commit and one sha fetch per file.
//
// The token is the user's own fine-grained PAT for their own repository, the
// same BYOK shape as the API key. There is no shared repo here, and therefore
// no shared credential to protect.

export class PublishError extends Error {
  /** The HTTP status, when the failure came from GitHub. */
  readonly status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "PublishError";
    this.status = status;
  }
}

export interface RepoRef {
  owner: string;
  repo: string;
}

const REPO_RE = /^(?:https?:\/\/github\.com\/)?([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/;

export function parseRepo(text: string): RepoRef | null {
  const m = REPO_RE.exec(text.trim());
  return m ? { owner: m[1], repo: m[2] } : null;
}

const API = "https://api.github.com";

function headers(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

/**
 * Transient-failure retry. GitHub's edge answers heavy Git Data calls with
 * the occasional 502/503/504 — and those error pages carry NO CORS headers,
 * so the browser surfaces them as an opaque "NetworkError when attempting to
 * fetch resource" (Hans's live course publish: /git/trees, 502, 2026-09-02).
 * A multi-megabyte blob upload can also drop mid-flight. Every write on this
 * path is content-addressed (blob/tree/commit objects) or idempotent (ref to
 * a fixed sha), so retrying in place is safe — and much cheaper than failing
 * the whole publish and re-uploading every blob.
 */
let retryDelaysMs = [800, 2400];
/** Test hook: retries themselves are behavior worth testing; real waits are not. */
export function setRetryDelaysForTests(ds: number[]): void {
  retryDelaysMs = ds;
}
const RETRYABLE_STATUS = new Set([502, 503, 504]);
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function call<T>(
  fetchImpl: typeof fetch,
  token: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  let res: Response;
  for (let attempt = 0; ; attempt++) {
    try {
      res = await fetchImpl(`${API}${path}`, {
        method,
        // GitHub sends `Cache-Control: private, max-age=60` on API responses, so a
        // plain GET of the branch ref can be answered from the browser cache with a
        // sha that is a minute old. Committing on top of that stale parent is
        // exactly what GitHub then rejects as "Update is not a fast forward".
        cache: "no-store",
        headers: { ...headers(token), ...(body ? { "Content-Type": "application/json" } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    } catch (err) {
      // Thrown, not answered: the connection dropped, or an error page with
      // no CORS headers made the browser hide the status. Retry, then say
      // WHICH request died — "NetworkError" alone sent us to the console.
      if (attempt < retryDelaysMs.length) {
        await sleep(retryDelaysMs[attempt]);
        continue;
      }
      throw new PublishError(
        `${method} ${path.replace(/^\/repos\/[^/]+\/[^/]+/, "")} failed ${attempt + 1} times (${(err as Error).message}) — GitHub or the connection hiccuped; press Publish again, nothing was half-committed.`,
      );
    }
    if (RETRYABLE_STATUS.has(res.status) && attempt < retryDelaysMs.length) {
      await sleep(retryDelaysMs[attempt]);
      continue;
    }
    break;
  }
  if (!res.ok) {
    if (res.status === 401) {
      throw new PublishError(
        "GitHub rejected the token. Check that it has not expired and that it grants Contents: read and write on this repository.",
        401,
      );
    }
    if (res.status === 403) {
      throw new PublishError("GitHub refused the request (403). The token most likely lacks Contents: write on this repository.", 403);
    }
    if (res.status === 404) {
      throw new PublishError("GitHub returned 404 — the repository does not exist, or the token has no access to it.", 404);
    }
    throw new PublishError(`GitHub returned ${res.status}: ${(await res.text()).slice(0, 200)}`, res.status);
  }
  return (await res.json()) as T;
}

export interface RepoInfo {
  defaultBranch: string;
}

/**
 * Repository metadata is readable by any fine-grained token with access, so
 * this needs no permission beyond the one we ask for. Pages is deliberately
 * NOT probed: that endpoint requires admin and would answer 403 whether or not
 * Pages is on, so the check could only mislead.
 */
export async function preflight(repo: RepoRef, token: string, fetchImpl: typeof fetch = fetch): Promise<RepoInfo> {
  const info = await call<{ private: boolean; default_branch: string }>(
    fetchImpl,
    token,
    "GET",
    `/repos/${repo.owner}/${repo.repo}`,
  );
  if (info.private) {
    throw new PublishError(
      "That repository is private. Published lectures are fetched from raw.githubusercontent.com, which does not serve private repositories, so the links would not work. Use a public repository.",
    );
  }
  return { defaultBranch: info.default_branch };
}

// ---- What a publish contains ---------------------------------------------

const FOLD: Record<string, string> = { æ: "ae", ø: "o", å: "a", ä: "a", ö: "o", ü: "u", ß: "ss" };

/** Past this, a folder name stops being something a student will type. */
export const MAX_SLUG = 40;

/**
 * A file name a person can read in a URL. Non-ASCII is folded rather than
 * dropped, so "Årsak" does not become "rsak", and a long title is cut at a
 * word boundary rather than mid-word — a course called "Causal inference in
 * economics: evidence from health and health care" should not become a
 * 63-character path.
 */
export function slugify(text: string, max = MAX_SLUG): string {
  const folded = text
    .toLowerCase()
    .replace(/[æøåäöüß]/g, (c) => FOLD[c] ?? c)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
  let slug = folded.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  if (slug.length > max) {
    const cut = slug.slice(0, max + 1);
    const boundary = cut.lastIndexOf("-");
    // Only honour the boundary if it leaves something worth reading.
    slug = (boundary > max / 2 ? cut.slice(0, boundary) : slug.slice(0, max)).replace(/-+$/, "");
  }
  return slug || "lecture";
}

/** The same title twice in one course would otherwise overwrite one file. */
export function slugFor(title: string, taken: Set<string>): string {
  const base = slugify(title);
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

export interface CourseEntry {
  slug: string;
  title: string;
  /** Repo-relative paths this course published last time. */
  files: string[];
  updated: string;
}

export interface Manifest {
  courses: CourseEntry[];
}

export function emptyManifest(): Manifest {
  return { courses: [] };
}

export function upsertCourse(manifest: Manifest, entry: CourseEntry): Manifest {
  return { courses: [...manifest.courses.filter((c) => c.slug !== entry.slug), entry] };
}

export interface PublishFile {
  path: string;
  content: string;
}

/**
 * Files this course published before and is not publishing now. Without this a
 * deleted lecture stays reachable at its old link forever.
 */
export function removedPaths(manifest: Manifest, slug: string, keeping: string[]): string[] {
  const previous = manifest.courses.find((c) => c.slug === slug);
  if (!previous) return [];
  const kept = new Set(keeping);
  return previous.files.filter((path) => !kept.has(path));
}

/** Tolerant read: a missing or damaged manifest starts a fresh one. */
export function parseManifest(text: string): Manifest {
  try {
    const raw = JSON.parse(text) as Partial<Manifest>;
    if (!Array.isArray(raw.courses)) return emptyManifest();
    return { courses: raw.courses.filter((c) => c && typeof c.slug === "string") as CourseEntry[] };
  } catch {
    return emptyManifest();
  }
}

// ---- The commit -----------------------------------------------------------

/** Read one file from the public repo; null when it is not there yet. */
export async function readFile(repo: RepoRef, path: string, fetchImpl: typeof fetch = fetch): Promise<string | null> {
  // Cache-busted: raw.githubusercontent sits behind a CDN with a multi-minute
  // TTL, and a stale manifest would make the next publish compute deletions
  // from a picture of the repo that is no longer true.
  const bust = `?t=${Date.now()}`;
  const res = await fetchImpl(`https://raw.githubusercontent.com/${repo.owner}/${repo.repo}/HEAD/${path}${bust}`, {
    cache: "no-store",
  });
  return res.ok ? await res.text() : null;
}

const MODE_FILE = "100644";

/**
 * UTF-8 safe: btoa alone throws on anything outside Latin-1.
 *
 * Chunked rather than `binary += String.fromCharCode(b)` per byte. A lecture
 * carrying embedded portrait strokes runs to megabytes, and building a string
 * that size by repeated concatenation makes Firefox flatten a rope thousands
 * of levels deep — which it reports as "too much recursion", not as a memory
 * error. 32k at a time keeps the concatenation count in the dozens.
 */
function toBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  const CHUNK = 0x8000;
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i += CHUNK) {
    parts.push(String.fromCharCode(...bytes.subarray(i, i + CHUNK)));
  }
  return btoa(parts.join(""));
}

/** Each segment encoded, but the slashes kept — they are the path. */
function encodePath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

/** The branch's head commit and its tree, or null when the repo has no commits. */
async function readHead(
  fetchImpl: typeof fetch,
  token: string,
  base: string,
  branch: string,
): Promise<{ head: string; baseTree: string } | null> {
  try {
    const ref = await call<{ object: { sha: string } }>(fetchImpl, token, "GET", `${base}/git/ref/heads/${branch}`);
    const commit = await call<{ tree: { sha: string } }>(fetchImpl, token, "GET", `${base}/git/commits/${ref.object.sha}`);
    return { head: ref.object.sha, baseTree: commit.tree.sha };
  } catch (err) {
    // 409 = empty repository; 404 = the branch does not exist yet.
    if (err instanceof PublishError && (err.status === 409 || err.status === 404)) return null;
    throw err;
  }
}

/**
 * A file's git blob SHA, computed locally. Git hashes `blob <bytes>\0<content>`,
 * so this is comparable with what `GET /git/trees` reports for the same path —
 * which is how a republish can tell an unchanged lecture from a changed one
 * without downloading it. A baked lecture is megabytes; its SHA is 40 bytes.
 */
export async function gitBlobSha(content: string): Promise<string> {
  const body = new TextEncoder().encode(content);
  const header = new TextEncoder().encode(`blob ${body.length}\0`);
  const buf = new Uint8Array(header.length + body.length);
  buf.set(header);
  buf.set(body, header.length);
  const digest = await crypto.subtle.digest("SHA-1", buf);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Every path in the branch with the blob SHA it currently has — ONE request
 * for the whole repository, however many megabytes it holds. Any failure is
 * an empty map, which simply means every file is treated as changed: the
 * optimisation may be skipped, never the publish.
 */
export async function remoteBlobShas(
  fetchImpl: typeof fetch,
  token: string,
  base: string,
  treeSha: string,
): Promise<Map<string, string>> {
  try {
    const tree = await call<{ tree: { path: string; sha: string; type: string }[] }>(
      fetchImpl, token, "GET", `${base}/git/trees/${treeSha}?recursive=1`, undefined,
    );
    return new Map(tree.tree.filter((e) => e.type === "blob").map((e) => [e.path, e.sha]));
  } catch {
    return new Map();
  }
}

/**
 * One atomic commit: read the ref, its commit and that commit's tree; upload a
 * blob for each file whose bytes are not already at its path; post ONE tree of
 * SHAs on top of the current one; post the commit; move the ref. However many
 * files the course has, it lands as a single revision rather than a dozen —
 * and a republish that changes four small files sends four small blobs.
 */
export async function commitFiles(
  repo: RepoRef,
  token: string,
  branch: string,
  files: PublishFile[],
  deletions: string[],
  message: string,
  fetchImpl: typeof fetch = fetch,
  /** Upload progress — a narration-baked course is many megabytes of blobs,
   *  and a silent minute reads as a hang. */
  onUpload?: (done: number, total: number) => void,
): Promise<{ commitSha: string }> {
  if (files.length === 0 && deletions.length === 0) {
    throw new PublishError("There is nothing to publish.");
  }
  const base = `/repos/${repo.owner}/${repo.repo}`;

  let state = await readHead(fetchImpl, token, base, branch);
  const wasEmpty = state === null;
  if (!state) {
    // The whole Git Data API refuses a repository with no commits — the ref
    // read answers 409 "Git Repository is empty", and so does creating a tree.
    // The Contents API is the one endpoint that CAN write into an empty repo,
    // so one file goes in through it to create the initial commit, and
    // everything else follows on the ordinary path. One extra commit, once,
    // rather than making the user seed the repo by hand.
    await call(fetchImpl, token, "PUT", `${base}/contents/${encodePath(files[0].path)}`, {
      message,
      content: toBase64(files[0].content),
      branch,
    });
    state = await readHead(fetchImpl, token, base, branch);
    if (!state) throw new PublishError("The repository is still empty after the first write — nothing was published.");
  }

  // Blobs first, one request per file, then a tree of SHAs — never inline
  // content. A course of narration-baked lectures put megabytes of base64
  // into a single /git/trees body and GitHub refused it (422 "input was too
  // large to process… consider building the tree incrementally" — Hans's
  // live publish, 2026-09-02). The blob route is the API's intended path for
  // big content; base64 encoding also keeps arbitrary bytes JSON-safe. Blobs
  // are content-addressed and repo-scoped, so the non-fast-forward retry in
  // commitOnto reuses them for free — which is why they are created HERE,
  // outside the retry.
  // A file whose published copy is byte-identical is skipped entirely: no
  // blob upload, and no tree entry — `base_tree` below keeps what is already
  // there. Changing one setting on a narration-baked course used to re-upload
  // every lecture, ~160 MB for the HTA course, to rewrite four small files
  // (Hans, 2026-09-05). One tree read replaces those megabytes; on any
  // failure the map is empty and every file is uploaded as before.
  //
  // The skip is HERE and not in the plan: `removedPaths` computes deletions
  // from the plan's file list, so dropping an unchanged lecture there would
  // delete it from the repository instead of leaving it alone.
  const remote = await remoteBlobShas(fetchImpl, token, base, state.baseTree);
  const local = await Promise.all(files.map((f) => gitBlobSha(f.content)));
  const unchanged = files.map((f, i) => remote.get(f.path) === local[i]);
  const sending = files.filter((_, i) => !unchanged[i]);

  const blobShas: string[] = [];
  for (const [i, f] of sending.entries()) {
    onUpload?.(i, sending.length);
    try {
      const blob = await call<{ sha: string }>(fetchImpl, token, "POST", `${base}/git/blobs`, {
        content: toBase64(f.content),
        encoding: "base64",
      });
      blobShas.push(blob.sha);
    } catch (err) {
      // Name the file: "NetworkError" with no noun cost a console excavation.
      const mb = (f.content.length / 1_048_576).toFixed(1);
      throw new PublishError(`Uploading "${f.path}" (${mb} MB): ${(err as Error).message}`, (err as PublishError).status);
    }
  }
  onUpload?.(sending.length, sending.length);
  // Nothing to send and nothing to remove means the repository already holds
  // exactly what this publish would write. An empty tree would make a commit
  // identical to its parent — noise in the history for no change — so the
  // current head is the honest answer.
  // `removing`, not `deletions`: the tree below drops deletions entirely when
  // the repository was empty a moment ago, so testing the raw list here could
  // let an empty-repo publish through to POST an empty tree. One name, used
  // by both, so the two cannot disagree about what is being removed.
  const removing = wasEmpty ? [] : deletions;
  if (sending.length === 0 && removing.length === 0) return { commitSha: state.head };

  const tree = [
    // `sending`, not `files`: an unchanged path is absent from the tree, and
    // base_tree is what keeps it. Listing it would need a blob we never made.
    ...sending.map((f, i) => ({ path: f.path, mode: MODE_FILE, type: "blob", sha: blobShas[i] })),
    // A null sha is how the tree API says "remove this path". There is nothing
    // to remove in a repository that had no commits a moment ago.
    ...removing.map((path) => ({ path, mode: MODE_FILE, type: "blob", sha: null })),
  ];

  /** Build a commit on the given parent and move the branch to it. */
  const commitOnto = async (onto: { head: string; baseTree: string }): Promise<string> => {
    const newTree = await call<{ sha: string }>(fetchImpl, token, "POST", `${base}/git/trees`, {
      base_tree: onto.baseTree,
      tree,
    });
    const newCommit = await call<{ sha: string }>(fetchImpl, token, "POST", `${base}/git/commits`, {
      message,
      tree: newTree.sha,
      parents: [onto.head],
    });
    await call(fetchImpl, token, "PATCH", `${base}/git/refs/heads/${branch}`, { sha: newCommit.sha });
    return newCommit.sha;
  };

  try {
    return { commitSha: await commitOnto(state) };
  } catch (err) {
    // "Update is not a fast forward": someone else pushed between our read and
    // our write — a commit from GitHub's web editor, another tab, another
    // machine. Re-read the branch and rebuild on top of what is there now.
    // Once only: a second failure means something is pushing continuously, and
    // retrying forever would be worse than saying so.
    if (!(err instanceof PublishError) || err.status !== 422) throw err;
    const fresh = await readHead(fetchImpl, token, base, branch);
    if (!fresh) throw err;
    return { commitSha: await commitOnto(fresh) };
  }
}
