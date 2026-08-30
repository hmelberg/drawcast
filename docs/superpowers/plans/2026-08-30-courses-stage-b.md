# Courses, Stage B — Publishing

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish a whole course to the author's own public GitHub repo as one commit — the plan, the lectures, and an overview page students can open — with per-lecture links that survive regeneration.

**Architecture:** A publish module (`src/publish/github.ts`) that commits a file set through the Git Data API in five calls regardless of file count, a page generator (`src/course/page.ts`) that renders the overview from the course document, and one new viewer source (`#gh=owner/repo/path`) fetched from `raw.githubusercontent.com`. The author's own fine-grained PAT lives in localStorage beside the API key; there is no shared repo and therefore no shared credential.

**Tech Stack:** TypeScript, Vite, vitest. GitHub REST (Git Data API) via `fetch`. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-08-30-courses-design.md` §8–§11

## Global Constraints

- **The repo must be public.** `raw.githubusercontent.com` does not serve private repositories unauthenticated, and Pages on a private repo needs a paid plan. Preflight refuses a private repo with a clear message.
- **Pages is never probed.** `GET /repos/{o}/{r}/pages` needs *admin* permission, which a `Contents`-only token does not have — it answers 403 either way, so the check could only mislead. The first successful publish shows the one-time Pages instruction instead.
- **File names are permanent.** `<slug>.yaml`, recorded in the lecture's `status:` line on first publish and **never recomputed**. Renaming a lecture changes its displayed title only; reordering changes only the overview page. No position prefix — `01-` becomes a lie on the first reorder.
- **One atomic commit** via the Git Data API (ref → commit → tree → commit → ref), never one commit per file.
- **`HEAD`, not a branch name**, in `#gh=` links, so a link survives a branch rename.
- **Publishing is remote and invisible.** Three bugs in stage A were "saved but nothing showed it". Every publish reports the two resulting URLs in the panel itself, not only on the app status bar behind the modal.
- Token requirements stated in the UI: fine-grained PAT, **one** repository, `Contents: read and write` only, with an expiry. localStorage is per origin — a token entered on `drawcast.app` does not exist on `hmelberg.github.io`.

---

### Task 1: The `#gh=` viewer source

Independent of publishing and useful on its own: drop a playlist YAML in any public repo and it plays. Do it first so the link format is settled before anything generates links.

**Files:**
- Modify: `src/viewer.ts` (`ViewerRequest` at :17, `parseViewerHash` at :27, `fetchGdocText` at :44, `runViewer` at :65), `src/entry.ts`
- Test: `tests/course-gh-viewer.test.ts`

**Interfaces:**
- Consumes: `parsePlaylistText`, `validateSpec` (unchanged).
- Produces:
  ```ts
  export interface ViewerRequest {
    /** Exactly one of these is set. */
    docId?: string;
    gh?: { owner: string; repo: string; path: string };
    style: RenderStyle;
    mode: "narrated" | "silent" | "instant";
    speed: number;
    advance?: "click" | "auto";
  }
  export function rawUrlFor(gh: { owner: string; repo: string; path: string }): string;
  ```

- [ ] **Step 1: Write the failing tests**

Create `tests/course-gh-viewer.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseViewerHash, rawUrlFor } from "../src/viewer";

describe("#gh= parsing", () => {
  it("reads owner, repo and path", () => {
    const req = parseViewerHash("#gh=hmelberg/kurs/courses/causal/did.yaml");
    expect(req?.gh).toEqual({ owner: "hmelberg", repo: "kurs", path: "courses/causal/did.yaml" });
  });

  it("accepts the dash form, like #gdoc-", () => {
    expect(parseViewerHash("#gh-hmelberg/kurs/a.yaml")?.gh?.owner).toBe("hmelberg");
  });

  it("carries the playback params", () => {
    const req = parseViewerHash("#gh=o/r/a.yaml&mode=silent&speed=1.5&style=sketchy");
    expect(req?.mode).toBe("silent");
    expect(req?.speed).toBe(1.5);
    expect(req?.style).toBe("sketchy");
  });

  it("still parses #gdoc=", () => {
    expect(parseViewerHash("#gdoc=1AbCdEfGhIjKl")?.docId).toBe("1AbCdEfGhIjKl");
  });

  it("rejects a path that climbs out of the repo", () => {
    expect(parseViewerHash("#gh=o/r/../../etc/passwd")).toBeNull();
  });

  it("rejects a path that is not a document", () => {
    expect(parseViewerHash("#gh=o/r/script.js")).toBeNull();
    expect(parseViewerHash("#gh=o/r/a.yaml")).not.toBeNull();
    expect(parseViewerHash("#gh=o/r/a.yml")).not.toBeNull();
    expect(parseViewerHash("#gh=o/r/a.json")).not.toBeNull();
  });
});

describe("rawUrlFor", () => {
  it("uses HEAD rather than a branch name, so a rename cannot break a link", () => {
    expect(rawUrlFor({ owner: "o", repo: "r", path: "a/b.yaml" })).toBe(
      "https://raw.githubusercontent.com/o/r/HEAD/a/b.yaml",
    );
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- course-gh-viewer`
Expected: FAIL — `rawUrlFor` is not exported; `req.gh` is undefined.

- [ ] **Step 3: Implement in `src/viewer.ts`**

Change the interface and add the parse branch:

```ts
export interface ViewerRequest {
  /** A link-shared Google Doc. Exactly one of docId/gh is set. */
  docId?: string;
  /** A file in a public GitHub repo. */
  gh?: { owner: string; repo: string; path: string };
  style: RenderStyle;
  mode: "narrated" | "silent" | "instant";
  speed: number;
  advance?: "click" | "auto";
}

/**
 * HEAD rather than a branch name: a published link must survive the repo's
 * default branch being renamed.
 */
export function rawUrlFor(gh: { owner: string; repo: string; path: string }): string {
  return `https://raw.githubusercontent.com/${gh.owner}/${gh.repo}/HEAD/${gh.path}`;
}

const GH_RE = /[#&]gh[=-]([\w.-]+)\/([\w.-]+)\/([^&\s]+)/;
/** Only documents, and never a path that climbs out of the repo. */
const DOC_PATH_RE = /^(?!.*\.\.)[\w./-]+\.(ya?ml|json|txt)$/;
```

In `parseViewerHash`, factor the shared params out and add the `gh` branch before the `gdoc` one:

```ts
export function parseViewerHash(hash: string): ViewerRequest | null {
  const gh = GH_RE.exec(hash);
  const doc = /[#&]gdoc[=-]([A-Za-z0-9_-]{10,})/.exec(hash);
  if (!gh && !doc) return null;

  const params = new URLSearchParams(
    hash.replace(/^#/, "").replace(/gdoc-([A-Za-z0-9_-]+)/, "gdoc=$1").replace(/gh-/, "gh="),
  );
  const mode = params.get("mode");
  const styleParam = params.get("style") ?? params.get("backend");
  const advance = params.get("advance");
  const common = {
    style: (styleParam === "sketchy" || styleParam === "custom-svg" ? "sketchy" : "clean") as RenderStyle,
    mode: (mode === "silent" || mode === "instant" ? mode : "narrated") as ViewerRequest["mode"],
    speed: parseFloat(params.get("speed") ?? "") || loadSettings().speed || 1,
    advance: (advance === "auto" || advance === "click" ? advance : undefined) as ViewerRequest["advance"],
  };

  if (gh) {
    const path = decodeURIComponent(gh[3]);
    if (!DOC_PATH_RE.test(path)) return null;
    return { gh: { owner: gh[1], repo: gh[2], path }, ...common };
  }
  return { docId: doc![1], ...common };
}
```

Add the fetch beside `fetchGdocText`:

```ts
/** Fetch the playlist from a public repo. Private repos are not served here. */
async function fetchGhText(gh: NonNullable<ViewerRequest["gh"]>): Promise<string> {
  const res = await fetch(rawUrlFor(gh));
  if (res.ok) return await res.text();
  throw new Error(
    res.status === 404
      ? `Could not find ${gh.path} in ${gh.owner}/${gh.repo}. The repository must be public, and the path must be right. A just-published file can also take a few minutes to appear.`
      : `Could not fetch the drawcast (HTTP ${res.status}).`,
  );
}
```

In `runViewer`, pick the source and adjust the loading line:

```ts
  const status = h("div", { class: "viewer-status" }, req.gh ? "Loading drawing from GitHub…" : "Loading drawing from Google Doc…");
  …
    const text = req.gh ? await fetchGhText(req.gh) : await fetchGdocText(req.docId!);
```

- [ ] **Step 4: Route it in `src/entry.ts`**

```ts
const hash = location.hash;
if (/[#&](gdoc|gh)[=-]/.test(hash)) {
```

and update the file's header comment to name both sources.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test -- course-gh-viewer`
Expected: PASS, 8 tests.

- [ ] **Step 6: Run the full suite and typecheck**

Run: `npm test && npx tsc --noEmit`
Expected: PASS. The existing viewer tests cover the `#gdoc=` path and are the regression check for the refactor.

- [ ] **Step 7: Commit**

```bash
git add src/viewer.ts src/entry.ts tests/course-gh-viewer.test.ts
git commit -m "Viewer: play a drawcast from a public GitHub repo with #gh="
```

---

### Task 2: GitHub settings and preflight

**Files:**
- Modify: `src/store.ts` (`Settings` at :39, `DEFAULT_SETTINGS` at :89, `KEYS` at :11)
- Create: `src/publish/github.ts`
- Test: `tests/publish-github.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  ```ts
  // store.ts
  export function getGithubToken(): string;
  export function setGithubToken(token: string): void;
  // Settings gains: githubRepo: string; coursesDir: string; viewerBase: string;

  // publish/github.ts
  export interface RepoRef { owner: string; repo: string; }
  export function parseRepo(text: string): RepoRef | null;
  export interface RepoInfo { defaultBranch: string; }
  export async function preflight(repo: RepoRef, token: string, fetchImpl?: typeof fetch): Promise<RepoInfo>;
  export class PublishError extends Error {}
  ```

- [ ] **Step 1: Write the failing tests**

Create `tests/publish-github.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { PublishError, parseRepo, preflight } from "../src/publish/github";

describe("parseRepo", () => {
  it("reads owner/repo", () => {
    expect(parseRepo("hmelberg/kurs")).toEqual({ owner: "hmelberg", repo: "kurs" });
  });

  it("accepts a full GitHub URL", () => {
    expect(parseRepo("https://github.com/hmelberg/kurs")).toEqual({ owner: "hmelberg", repo: "kurs" });
  });

  it("trims a trailing slash and .git", () => {
    expect(parseRepo("hmelberg/kurs.git")).toEqual({ owner: "hmelberg", repo: "kurs" });
    expect(parseRepo("hmelberg/kurs/")).toEqual({ owner: "hmelberg", repo: "kurs" });
  });

  it("rejects nonsense", () => {
    expect(parseRepo("kurs")).toBeNull();
    expect(parseRepo("")).toBeNull();
  });
});

const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body, text: async () => "" }) as Response;
const fail = (status: number, text = "") => ({ ok: false, status, json: async () => ({}), text: async () => text }) as Response;

describe("preflight", () => {
  it("returns the default branch", async () => {
    const f = vi.fn(async () => ok({ private: false, default_branch: "main" }));
    expect(await preflight({ owner: "o", repo: "r" }, "t", f as unknown as typeof fetch)).toEqual({ defaultBranch: "main" });
  });

  it("refuses a private repo, because raw.githubusercontent cannot serve it", async () => {
    const f = vi.fn(async () => ok({ private: true, default_branch: "main" }));
    await expect(preflight({ owner: "o", repo: "r" }, "t", f as unknown as typeof fetch)).rejects.toThrow(/public/);
  });

  it("explains a 404 as a missing repo or a token without access", async () => {
    const f = vi.fn(async () => fail(404));
    await expect(preflight({ owner: "o", repo: "r" }, "t", f as unknown as typeof fetch)).rejects.toThrow(PublishError);
  });

  it("explains a 401 as a bad token", async () => {
    const f = vi.fn(async () => fail(401));
    await expect(preflight({ owner: "o", repo: "r" }, "t", f as unknown as typeof fetch)).rejects.toThrow(/token/i);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- publish-github`
Expected: FAIL — `Failed to resolve import "../src/publish/github"`.

- [ ] **Step 3: Implement the store side**

Add `githubToken: "drawcast.githubtoken",` to `KEYS`; add to `Settings` and `DEFAULT_SETTINGS`:

```ts
  /** owner/repo the courses publish to. Empty until the user sets one. */
  githubRepo: string;
  /** Directory inside that repo, so a repo can hold other things too. */
  coursesDir: string;
  /** Where a published link points; the app has two deploys. */
  viewerBase: string;
```

```ts
  githubRepo: "",
  coursesDir: "courses",
  viewerBase: "https://drawcast.app/",
```

and, beside `getApiKey`/`setApiKey`:

```ts
/**
 * The user's OWN fine-grained PAT for their OWN repo — the same BYOK shape as
 * the API key. There is no shared repo and so no shared credential to protect.
 */
export function getGithubToken(): string {
  return localStorage.getItem(KEYS.githubToken) ?? "";
}

export function setGithubToken(token: string): void {
  if (token) localStorage.setItem(KEYS.githubToken, token);
  else localStorage.removeItem(KEYS.githubToken);
}
```

- [ ] **Step 4: Implement `src/publish/github.ts`**

```ts
// Publishing a course to the author's OWN public repo. One atomic commit
// through the Git Data API — five calls regardless of file count, rather than
// the Contents API's one commit and one sha fetch per file.

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
    if (res.status === 401) throw new PublishError("GitHub rejected the token. Check that it has not expired and grants Contents: read and write on this repository.");
    if (res.status === 403) throw new PublishError("GitHub refused the request (403). The token most likely lacks Contents: write on this repository.");
    if (res.status === 404) throw new PublishError("GitHub returned 404 — the repository does not exist, or the token has no access to it.");
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
 * NOT probed: that endpoint needs admin and would answer 403 either way.
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
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test -- publish-github`
Expected: PASS, 8 tests.

- [ ] **Step 6: Commit**

```bash
git add src/store.ts src/publish/github.ts tests/publish-github.test.ts
git commit -m "GitHub publish settings and preflight"
```

---

### Task 3: Slugs, the manifest, and what a publish writes

Pure functions — the part that decides *what* the commit contains, testable with no network.

**Files:**
- Modify: `src/publish/github.ts`
- Test: `tests/publish-plan.test.ts`

**Interfaces:**
- Consumes: `Course`, `CourseLecture` (`src/course/document.ts`).
- Produces:
  ```ts
  export function slugify(text: string): string;
  export function slugFor(title: string, taken: Set<string>): string;
  export interface CourseEntry { slug: string; title: string; files: string[]; updated: string; }
  export interface Manifest { courses: CourseEntry[]; }
  export function emptyManifest(): Manifest;
  export function upsertCourse(manifest: Manifest, entry: CourseEntry): Manifest;
  export interface PublishFile { path: string; content: string; }
  export function removedPaths(manifest: Manifest, slug: string, keeping: string[]): string[];
  ```

- [ ] **Step 1: Write the failing tests**

Create `tests/publish-plan.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { emptyManifest, removedPaths, slugFor, slugify, upsertCourse } from "../src/publish/github";

describe("slugify", () => {
  it("lowercases and hyphenates", () => {
    expect(slugify("Potential Outcomes")).toBe("potential-outcomes");
  });

  it("folds Norwegian letters rather than dropping them", () => {
    expect(slugify("Årsak og effekt")).toBe("arsak-og-effekt");
    expect(slugify("Økonomi")).toBe("okonomi");
    expect(slugify("Præsis")).toBe("praesis");
  });

  it("drops punctuation and collapses separators", () => {
    expect(slugify("What is a counterfactual?  Really!")).toBe("what-is-a-counterfactual-really");
  });

  it("never returns an empty slug", () => {
    expect(slugify("???")).toBe("lecture");
  });
});

describe("slugFor", () => {
  it("suffixes a collision instead of overwriting", () => {
    const taken = new Set(["did"]);
    expect(slugFor("DiD", taken)).toBe("did-2");
  });

  it("keeps counting past the second collision", () => {
    expect(slugFor("DiD", new Set(["did", "did-2"]))).toBe("did-3");
  });
});

describe("the manifest", () => {
  const entry = { slug: "causal", title: "Causal Inference", files: ["a.yaml", "b.yaml"], updated: "2026-08-30" };

  it("adds a course", () => {
    expect(upsertCourse(emptyManifest(), entry).courses).toHaveLength(1);
  });

  it("replaces a course rather than duplicating it", () => {
    const once = upsertCourse(emptyManifest(), entry);
    const twice = upsertCourse(once, { ...entry, title: "Causal Inference II" });
    expect(twice.courses).toHaveLength(1);
    expect(twice.courses[0].title).toBe("Causal Inference II");
  });

  it("leaves other courses alone", () => {
    const m = upsertCourse(upsertCourse(emptyManifest(), entry), { ...entry, slug: "stats", title: "Stats" });
    expect(m.courses.map((c) => c.slug).sort()).toEqual(["causal", "stats"]);
  });
});

describe("removedPaths", () => {
  it("names a file the course used to publish and no longer does", () => {
    const m = upsertCourse(emptyManifest(), {
      slug: "causal",
      title: "C",
      files: ["courses/causal/a.yaml", "courses/causal/gone.yaml"],
      updated: "1",
    });
    expect(removedPaths(m, "causal", ["courses/causal/a.yaml"])).toEqual(["courses/causal/gone.yaml"]);
  });

  it("is empty for a course that was never published", () => {
    expect(removedPaths(emptyManifest(), "new", ["x"])).toEqual([]);
  });

  it("is empty when nothing was dropped", () => {
    const m = upsertCourse(emptyManifest(), { slug: "c", title: "C", files: ["a"], updated: "1" });
    expect(removedPaths(m, "c", ["a"])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- publish-plan`
Expected: FAIL — `slugify` is not exported.

- [ ] **Step 3: Implement, appended to `src/publish/github.ts`**

```ts
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- publish-plan`
Expected: PASS, 12 tests.

- [ ] **Step 5: Commit**

```bash
git add src/publish/github.ts tests/publish-plan.test.ts
git commit -m "Publish planning: slugs, the manifest, and deletions"
```

---

### Task 4: The atomic commit

**Files:**
- Modify: `src/publish/github.ts`
- Test: `tests/publish-commit.test.ts`

**Interfaces:**
- Consumes: `RepoRef`, `PublishFile`, `PublishError`, `preflight` (Tasks 2–3).
- Produces:
  ```ts
  export async function readFile(repo: RepoRef, path: string, fetchImpl?: typeof fetch): Promise<string | null>;
  export async function commitFiles(
    repo: RepoRef,
    token: string,
    branch: string,
    files: PublishFile[],
    deletions: string[],
    message: string,
    fetchImpl?: typeof fetch,
  ): Promise<{ commitSha: string }>;
  ```

- [ ] **Step 1: Write the failing tests**

Create `tests/publish-commit.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { commitFiles } from "../src/publish/github";

interface Call { url: string; method: string; body: Record<string, unknown> | null }

/** Records every request and answers each Git Data endpoint in turn. */
function recorder(): { calls: Call[]; fetchImpl: typeof fetch } {
  const calls: Call[] = [];
  const fetchImpl = (async (url: string, init: RequestInit = {}) => {
    calls.push({
      url,
      method: init.method ?? "GET",
      body: init.body ? (JSON.parse(init.body as string) as Record<string, unknown>) : null,
    });
    const body = url.includes("/git/ref/")
      ? { object: { sha: "refsha" } }
      : url.includes("/git/commits/")
        ? { tree: { sha: "treesha" } }
        : url.includes("/git/trees")
          ? { sha: "newtree" }
          : url.includes("/git/commits")
            ? { sha: "newcommit" }
            : {};
    return { ok: true, status: 200, json: async () => body, text: async () => "" } as Response;
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

const REPO = { owner: "o", repo: "r" };
const FILES = [{ path: "courses/c/a.yaml", content: "title: a" }];

describe("commitFiles", () => {
  it("writes everything in ONE commit, in five calls", async () => {
    const { calls, fetchImpl } = recorder();
    await commitFiles(REPO, "t", "main", FILES, [], "msg", fetchImpl);
    expect(calls).toHaveLength(5);
    expect(calls.map((c) => c.method)).toEqual(["GET", "GET", "POST", "POST", "PATCH"]);
  });

  it("sends file content inline in the tree, needing no separate blob calls", async () => {
    const { calls, fetchImpl } = recorder();
    await commitFiles(REPO, "t", "main", FILES, [], "msg", fetchImpl);
    const tree = calls[2].body!.tree as Record<string, unknown>[];
    expect(tree[0]).toEqual({ path: "courses/c/a.yaml", mode: "100644", type: "blob", content: "title: a" });
  });

  it("bases the tree on the current one, so untouched files survive", async () => {
    const { calls, fetchImpl } = recorder();
    await commitFiles(REPO, "t", "main", FILES, [], "msg", fetchImpl);
    expect(calls[2].body!.base_tree).toBe("treesha");
  });

  it("deletes a dropped path with a null sha", async () => {
    const { calls, fetchImpl } = recorder();
    await commitFiles(REPO, "t", "main", FILES, ["courses/c/gone.yaml"], "msg", fetchImpl);
    const tree = calls[2].body!.tree as Record<string, unknown>[];
    expect(tree).toContainEqual({ path: "courses/c/gone.yaml", mode: "100644", type: "blob", sha: null });
  });

  it("parents the new commit on the branch head and moves the ref to it", async () => {
    const { calls, fetchImpl } = recorder();
    await commitFiles(REPO, "t", "main", FILES, [], "msg", fetchImpl);
    expect(calls[3].body!.parents).toEqual(["refsha"]);
    expect(calls[3].body!.tree).toBe("newtree");
    expect(calls[4].body!.sha).toBe("newcommit");
    expect(calls[4].url).toContain("/git/refs/heads/main");
  });

  it("refuses to commit nothing", async () => {
    const { fetchImpl } = recorder();
    await expect(commitFiles(REPO, "t", "main", [], [], "msg", fetchImpl)).rejects.toThrow(/nothing/i);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- publish-commit`
Expected: FAIL — `commitFiles` is not exported.

- [ ] **Step 3: Implement, appended to `src/publish/github.ts`**

```ts
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- publish-commit`
Expected: PASS, 6 tests.

- [ ] **Step 5: Run the full suite and typecheck**

Run: `npm test && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/publish/github.ts tests/publish-commit.test.ts
git commit -m "Publish a file set as one atomic commit via the Git Data API"
```

---

### Task 5: The overview page

**Files:**
- Create: `src/course/page.ts`
- Test: `tests/course-page.test.ts`

**Interfaces:**
- Consumes: `Course`, `CourseLecture` (`src/course/document.ts`); `CourseEntry` (Task 3).
- Produces:
  ```ts
  export interface PageLink { title: string; questions: string[]; href: string | null; }
  export function coursePage(course: Course, links: PageLink[]): string;
  export function repoIndexPage(courses: CourseEntry[], base: string): string;
  export function escapeHtml(text: string): string;
  export function lectureHref(base: string, owner: string, repo: string, path: string): string;
  ```

- [ ] **Step 1: Write the failing tests**

Create `tests/course-page.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseCourse } from "../src/course/document";
import { coursePage, escapeHtml, lectureHref, repoIndexPage } from "../src/course/page";

const COURSE = parseCourse(`# Causal Inference
level: advanced

A master-level introduction.

---
## Potential outcomes
What is a counterfactual outcome?
---
## Difference-in-differences
What breaks parallel trends?
`);

const LINKS = [
  { title: "Potential outcomes", questions: ["What is a counterfactual outcome?"], href: "https://drawcast.app/#gh=o/r/courses/c/potential-outcomes.yaml" },
  { title: "Difference-in-differences", questions: ["What breaks parallel trends?"], href: null },
];

describe("escapeHtml", () => {
  it("escapes the characters that would break the page", () => {
    expect(escapeHtml('a<b>&"c"')).toBe("a&lt;b&gt;&amp;&quot;c&quot;");
  });
});

describe("coursePage", () => {
  it("carries the title and intro", () => {
    const html = coursePage(COURSE, LINKS);
    expect(html).toContain("Causal Inference");
    expect(html).toContain("A master-level introduction.");
  });

  it("links a published lecture and lists its questions", () => {
    const html = coursePage(COURSE, LINKS);
    expect(html).toContain('href="https://drawcast.app/#gh=o/r/courses/c/potential-outcomes.yaml"');
    expect(html).toContain("What is a counterfactual outcome?");
  });

  it("shows an unpublished lecture without a dead link", () => {
    const html = coursePage(COURSE, LINKS);
    expect(html).toContain("Difference-in-differences");
    expect(html).not.toContain('href="null"');
  });

  it("escapes a title that would otherwise break the markup", () => {
    const html = coursePage({ ...COURSE, title: "A <script>alert(1)</script> course" }, []);
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("is self-contained: no external stylesheet or script", () => {
    const html = coursePage(COURSE, LINKS);
    expect(html).not.toContain("<link rel=\\"stylesheet\\"");
    expect(html).not.toMatch(/<script[^>]+src=/);
  });
});

describe("repoIndexPage", () => {
  it("lists each course and links into its folder", () => {
    const html = repoIndexPage(
      [{ slug: "causal", title: "Causal Inference", files: [], updated: "2026-08-30" }],
      "courses",
    );
    expect(html).toContain("Causal Inference");
    expect(html).toContain('href="causal/"');
  });
});

describe("lectureHref", () => {
  it("joins the viewer base and the #gh= path", () => {
    expect(lectureHref("https://drawcast.app/", "o", "r", "courses/c/a.yaml")).toBe(
      "https://drawcast.app/#gh=o/r/courses/c/a.yaml",
    );
  });

  it("tolerates a base without a trailing slash", () => {
    expect(lectureHref("https://drawcast.app", "o", "r", "a.yaml")).toBe("https://drawcast.app/#gh=o/r/a.yaml");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- course-page`
Expected: FAIL — `Failed to resolve import "../src/course/page"`.

- [ ] **Step 3: Implement `src/course/page.ts`**

One self-contained file — inline `<style>`, no external CSS or JS, no build step — so it can be pasted into an LMS as easily as it can be hosted.

```ts
import type { CourseEntry } from "../publish/github";
import type { Course } from "./document";

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function lectureHref(base: string, owner: string, repo: string, path: string): string {
  return `${base.replace(/\/+$/, "")}/#gh=${owner}/${repo}/${path}`;
}

export interface PageLink {
  title: string;
  questions: string[];
  /** null for a lecture that has not been generated yet — listed, not linked. */
  href: string | null;
}

const STYLE = `
  :root { color-scheme: light dark; }
  body { max-width: 44rem; margin: 3rem auto; padding: 0 1.25rem;
         font: 16px/1.6 ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif; }
  h1 { font-size: 1.9rem; margin-bottom: 0.3rem; }
  .intro { opacity: 0.8; margin-top: 0; }
  ol { list-style: none; padding: 0; }
  li { border-top: 1px solid rgba(128,128,128,0.3); padding: 1rem 0; }
  .n { opacity: 0.5; font-variant-numeric: tabular-nums; margin-right: 0.5rem; }
  .t { font-size: 1.1rem; font-weight: 600; }
  .q { margin: 0.35rem 0 0; padding-left: 1.1rem; opacity: 0.8; }
  .soon { opacity: 0.55; font-size: 0.85rem; }
  footer { margin-top: 3rem; font-size: 0.85rem; opacity: 0.6; }
`;

function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${STYLE}</style>
${body}
<footer>Made with <a href="https://drawcast.app/">drawcast</a></footer>
</html>
`;
}

export function coursePage(course: Course, links: PageLink[]): string {
  const items = links
    .map((link, i) => {
      const head = link.href
        ? `<a class="t" href="${escapeHtml(link.href)}">${escapeHtml(link.title)}</a>`
        : `<span class="t">${escapeHtml(link.title)}</span> <span class="soon">not published yet</span>`;
      const questions = link.questions.length
        ? `<ul class="q">${link.questions.map((q) => `<li>${escapeHtml(q)}</li>`).join("")}</ul>`
        : "";
      return `<li><span class="n">${i + 1}</span>${head}${questions}</li>`;
    })
    .join("\n");
  const intro = course.intro ? `<p class="intro">${escapeHtml(course.intro)}</p>` : "";
  return page(course.title, `<h1>${escapeHtml(course.title)}</h1>\n${intro}\n<ol>\n${items}\n</ol>`);
}

export function repoIndexPage(courses: CourseEntry[], base: string): string {
  const items = courses
    .map(
      (c) =>
        `<li><a class="t" href="${escapeHtml(c.slug)}/">${escapeHtml(c.title)}</a> <span class="soon">updated ${escapeHtml(c.updated)}</span></li>`,
    )
    .join("\n");
  return page(base, `<h1>Courses</h1>\n<ol>\n${items}\n</ol>`);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- course-page`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add src/course/page.ts tests/course-page.test.ts
git commit -m "The course overview page, self-contained and escaped"
```

---

### Task 6: Publish from the panel

**Files:**
- Create: `src/course/publish.ts`
- Modify: `src/ui/course.ts`, `src/main.ts` (Settings dialog fields)
- Test: `tests/course-publish.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 1–5; `loadLibrary`, `getGithubToken`, `loadSettings`; `setLectureStatus`, `parseCourse`.
- Produces:
  ```ts
  export interface PublishPlan {
    slug: string;
    files: PublishFile[];
    deletions: string[];
    /** The file each lecture index was assigned, for the status write-back. */
    fileOf: Map<number, string>;
    courseUrl: string;
    pagesUrl: string;
  }
  export function buildPublishPlan(args: {
    course: Course; text: string; repo: RepoRef; coursesDir: string;
    viewerBase: string; manifest: Manifest; lectureYaml: (index: number) => string | null;
  }): PublishPlan;
  export async function publishCourse(...): Promise<{ text: string; courseUrl: string; pagesUrl: string }>;
  ```

- [ ] **Step 1: Write the failing tests**

Create `tests/course-publish.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseCourse } from "../src/course/document";
import { buildPublishPlan } from "../src/course/publish";
import { emptyManifest, upsertCourse } from "../src/publish/github";

const TEXT = `# Causal Inference
---
## Potential outcomes
What is a counterfactual?
status: done · id: a1
---
## Difference-in-differences
What breaks parallel trends?
status: done · id: b2 · file: did.yaml
---
## Not made yet
Q?
`;

const args = (over: Partial<Parameters<typeof buildPublishPlan>[0]> = {}) => ({
  course: parseCourse(TEXT),
  text: TEXT,
  repo: { owner: "o", repo: "r" },
  coursesDir: "courses",
  viewerBase: "https://drawcast.app/",
  manifest: emptyManifest(),
  lectureYaml: (i: number) => (i < 2 ? `title: lecture ${i}` : null),
  ...over,
});

describe("buildPublishPlan", () => {
  it("publishes the course document, the page, and every generated lecture", () => {
    const plan = buildPublishPlan(args());
    expect(plan.files.map((f) => f.path).sort()).toEqual([
      "courses/causal-inference/course.md",
      "courses/causal-inference/did.yaml",
      "courses/causal-inference/index.html",
      "courses/causal-inference/potential-outcomes.yaml",
      "courses/courses.json",
      "courses/index.html",
    ]);
  });

  it("keeps a file name already recorded in status, so a link stays permanent", () => {
    expect(buildPublishPlan(args()).fileOf.get(1)).toBe("did.yaml");
  });

  it("mints a slug for a lecture publishing for the first time", () => {
    expect(buildPublishPlan(args()).fileOf.get(0)).toBe("potential-outcomes.yaml");
  });

  it("does not publish an ungenerated lecture", () => {
    expect(buildPublishPlan(args()).fileOf.has(2)).toBe(false);
  });

  it("lists the ungenerated lecture on the page without a link", () => {
    const page = buildPublishPlan(args()).files.find((f) => f.path.endsWith("causal-inference/index.html"))!;
    expect(page.content).toContain("Not made yet");
    expect(page.content).toContain("not published yet");
  });

  it("points a published link at the viewer base", () => {
    const page = buildPublishPlan(args()).files.find((f) => f.path.endsWith("causal-inference/index.html"))!;
    expect(page.content).toContain("https://drawcast.app/#gh=o/r/courses/causal-inference/did.yaml");
  });

  it("deletes a file the course used to publish", () => {
    const manifest = upsertCourse(emptyManifest(), {
      slug: "causal-inference",
      title: "C",
      files: ["courses/causal-inference/dropped.yaml"],
      updated: "1",
    });
    expect(buildPublishPlan(args({ manifest })).deletions).toEqual(["courses/causal-inference/dropped.yaml"]);
  });

  it("reports both URLs", () => {
    const plan = buildPublishPlan(args());
    expect(plan.courseUrl).toBe("https://o.github.io/r/courses/causal-inference/");
    expect(plan.pagesUrl).toBe("https://o.github.io/r/courses/");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- course-publish`
Expected: FAIL — `Failed to resolve import "../src/course/publish"`.

- [ ] **Step 3: Implement `src/course/publish.ts`**

Build the file set from the course document. Key rules, all tested above: a
lecture's `status.file` wins when it has one (permanence); otherwise a slug is
minted against the names already taken; an ungenerated lecture is listed on the
page but not linked and not published.

```ts
import {
  parseManifest, removedPaths, slugFor, upsertCourse,
  type Manifest, type PublishFile, type RepoRef,
} from "../publish/github";
import { coursePage, lectureHref, repoIndexPage, type PageLink } from "./page";
import type { Course } from "./document";

export interface PublishPlan {
  slug: string;
  files: PublishFile[];
  deletions: string[];
  fileOf: Map<number, string>;
  courseUrl: string;
  pagesUrl: string;
}

export function buildPublishPlan(args: {
  course: Course;
  text: string;
  repo: RepoRef;
  coursesDir: string;
  viewerBase: string;
  manifest: Manifest;
  /** The lecture's playlist YAML, or null when it has not been generated. */
  lectureYaml: (index: number) => string | null;
}): PublishPlan {
  const { course, text, repo, coursesDir, viewerBase, manifest } = args;
  const slug = slugFor(course.title || "course", new Set());
  const dir = `${coursesDir}/${slug}`;

  const taken = new Set<string>();
  const fileOf = new Map<number, string>();
  const files: PublishFile[] = [];
  const links: PageLink[] = [];

  course.lectures.forEach((lecture, i) => {
    const yaml = args.lectureYaml(i);
    if (!yaml) {
      links.push({ title: lecture.title, questions: lecture.questions, href: null });
      return;
    }
    // A recorded name is permanent: renaming or reordering a lecture must
    // never move the file a published link points at.
    const name = lecture.status?.file ?? `${slugFor(lecture.title, taken)}.yaml`;
    taken.add(name.replace(/\.yaml$/, ""));
    fileOf.set(i, name);
    files.push({ path: `${dir}/${name}`, content: yaml });
    links.push({
      title: lecture.title,
      questions: lecture.questions,
      href: lectureHref(viewerBase, repo.owner, repo.repo, `${dir}/${name}`),
    });
  });

  files.push({ path: `${dir}/course.md`, content: text });
  files.push({ path: `${dir}/index.html`, content: coursePage(course, links) });

  const entry = {
    slug,
    title: course.title || "Untitled course",
    files: files.map((f) => f.path),
    updated: new Date().toISOString().slice(0, 10),
  };
  const next = upsertCourse(manifest, entry);
  files.push({ path: `${coursesDir}/courses.json`, content: JSON.stringify(next, null, 2) + "\n" });
  files.push({ path: `${coursesDir}/index.html`, content: repoIndexPage(next.courses, coursesDir) });

  return {
    slug,
    files,
    deletions: removedPaths(manifest, slug, files.map((f) => f.path)),
    fileOf,
    courseUrl: `https://${repo.owner}.github.io/${repo.repo}/${dir}/`,
    pagesUrl: `https://${repo.owner}.github.io/${repo.repo}/${coursesDir}/`,
  };
}

export { parseManifest };
```

Then the orchestrator, which is the only part that touches the network:

```ts
export async function publishCourse(...): Promise<{ text: string; courseUrl: string; pagesUrl: string }> {
  // preflight(repo, token) → defaultBranch
  // readFile(repo, `${coursesDir}/courses.json`) → parseManifest, or emptyManifest()
  // buildPublishPlan(...)
  // commitFiles(repo, token, branch, plan.files, plan.deletions, `drawcast: publish course "<title>"`)
  // for each [index, name] of plan.fileOf: text = setLectureStatus(text, index, { ...status, file: name })
  // return { text, courseUrl: plan.courseUrl, pagesUrl: plan.pagesUrl }
}
```

- [ ] **Step 4: Wire the panel**

In `src/ui/course.ts`, beside `saveBtn`:

```ts
const publishBtn = h("button", { class: "small", title: "Publish this course to your GitHub repository" }, "⬆ Publish");
```

The handler: read `getGithubToken()` and `loadSettings().githubRepo`; if either is
missing, `say("Set your GitHub repository and token in Settings first.", "error")`
and stop. Otherwise `begin()` a controller, call `publishCourse`, write the
returned text back into `doc.value`, `persist()`, `render()`, and report **both
URLs on the panel's own line** — publishing is a remote write whose result is
invisible, which is exactly the failure mode stage A hit three times:

```ts
say(`Published. Course page: ${courseUrl} — all courses: ${pagesUrl}`, "ok");
```

On the **first** publish to a repo, follow it with the one-time Pages note:
Settings → Pages → Deploy from a branch → `<defaultBranch>` / root; the lecture
links already work without it, only the overview page waits on Pages.

- [ ] **Step 5: Add the Settings fields in `src/main.ts`**

Three inputs in the existing Settings dialog: **GitHub repository** (`owner/repo`),
**GitHub token** (`type="password"`, with the requirement text: fine-grained PAT,
one repository, Contents: read and write, set an expiry), and **Courses folder**
(default `courses`). Save through `saveSettings` / `setGithubToken`.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm test -- course-publish`
Expected: PASS, 8 tests.

- [ ] **Step 7: Run the full suite, typecheck, and build**

Run: `npm test && npx tsc --noEmit && npm run build`
Expected: PASS.

- [ ] **Step 8: Manual check against a real repo**

Create a public repo, set it and a fine-grained PAT in Settings, publish a
two-lecture course, and confirm: one commit containing `course.md`, both
`.yaml` files, both `index.html` files and `courses.json`; the `#gh=` links play;
the `status:` lines gained `file:` names; a second publish after renaming a
lecture keeps the same file names and the same links; deleting a lecture and
republishing removes its file.

- [ ] **Step 9: Commit**

```bash
git add src/course/publish.ts src/ui/course.ts src/main.ts tests/course-publish.test.ts
git commit -m "Publish a course to the author's GitHub repo"
```

---

## Self-Review

**Spec coverage.** §8 publishing seam → Task 6 (`publishCourse` is the one
network-touching function; a Drive implementation would replace it alone). §9
repo requirements, layout, permanence, preflight, tree commit, deletions →
Tasks 2–4 and 6. §10 overview page → Task 5. §11 `#gh=` viewer → Task 1.

**Gap found and closed:** §9 says the branch is read from the repo rather than
assumed to be `main`; `preflight` returns `defaultBranch` (Task 2) and
`commitFiles` takes it as a parameter (Task 4) rather than defaulting.

**Type consistency.** `RepoRef`, `PublishFile`, `Manifest`, `CourseEntry` are
defined in Task 2–3 and consumed in Tasks 4–6. `PageLink` is defined in Task 5
and built in Task 6. `slugFor(title, taken)` has the same signature in both.
`commitFiles(repo, token, branch, files, deletions, message, fetchImpl)` is
called with exactly that shape in Task 6.

**Deliberately not built:** anything from §14 (catalogue, comments), batch
video, Drive. Task 6 step 8 is a manual check because the only honest test of a
GitHub write is a GitHub write.
