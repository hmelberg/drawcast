// Publishing a course to the author's OWN public repo. One atomic commit
// through the Git Data API — five calls regardless of file count, rather than
// the Contents API's one commit and one sha fetch per file.
//
// The token is the user's own fine-grained PAT for their own repository, the
// same BYOK shape as the API key. There is no shared repo here, and therefore
// no shared credential to protect.

export class PublishError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PublishError";
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

async function call<T>(
  fetchImpl: typeof fetch,
  token: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const res = await fetchImpl(`${API}${path}`, {
    method,
    headers: { ...headers(token), ...(body ? { "Content-Type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) {
    if (res.status === 401) {
      throw new PublishError(
        "GitHub rejected the token. Check that it has not expired and that it grants Contents: read and write on this repository.",
      );
    }
    if (res.status === 403) {
      throw new PublishError("GitHub refused the request (403). The token most likely lacks Contents: write on this repository.");
    }
    if (res.status === 404) {
      throw new PublishError("GitHub returned 404 — the repository does not exist, or the token has no access to it.");
    }
    throw new PublishError(`GitHub returned ${res.status}: ${(await res.text()).slice(0, 200)}`);
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

/**
 * A file name a person can read in a URL. Non-ASCII is folded rather than
 * dropped, so "Årsak" does not become "rsak".
 */
export function slugify(text: string): string {
  const folded = text
    .toLowerCase()
    .replace(/[æøåäöüß]/g, (c) => FOLD[c] ?? c)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
  const slug = folded.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
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
  const res = await fetchImpl(`https://raw.githubusercontent.com/${repo.owner}/${repo.repo}/HEAD/${path}`);
  return res.ok ? await res.text() : null;
}

const MODE_FILE = "100644";

/**
 * One atomic commit: read the ref and its tree, post a new tree carrying every
 * file's content inline (which creates the blobs implicitly), post the commit,
 * move the ref. Five calls whether the course has three files or thirty, and
 * the whole course lands as a single revision rather than a dozen.
 */
export async function commitFiles(
  repo: RepoRef,
  token: string,
  branch: string,
  files: PublishFile[],
  deletions: string[],
  message: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ commitSha: string }> {
  if (files.length === 0 && deletions.length === 0) {
    throw new PublishError("There is nothing to publish.");
  }
  const base = `/repos/${repo.owner}/${repo.repo}`;
  const ref = await call<{ object: { sha: string } }>(fetchImpl, token, "GET", `${base}/git/ref/heads/${branch}`);
  const head = ref.object.sha;
  const commit = await call<{ tree: { sha: string } }>(fetchImpl, token, "GET", `${base}/git/commits/${head}`);

  const tree = [
    ...files.map((f) => ({ path: f.path, mode: MODE_FILE, type: "blob", content: f.content })),
    // A null sha is how the tree API says "remove this path".
    ...deletions.map((path) => ({ path, mode: MODE_FILE, type: "blob", sha: null })),
  ];
  const newTree = await call<{ sha: string }>(fetchImpl, token, "POST", `${base}/git/trees`, {
    base_tree: commit.tree.sha,
    tree,
  });
  const newCommit = await call<{ sha: string }>(fetchImpl, token, "POST", `${base}/git/commits`, {
    message,
    tree: newTree.sha,
    parents: [head],
  });
  await call(fetchImpl, token, "PATCH", `${base}/git/refs/heads/${branch}`, { sha: newCommit.sha });
  return { commitSha: newCommit.sha };
}
