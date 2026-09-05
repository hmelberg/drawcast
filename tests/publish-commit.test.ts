// The atomic commit: one revision for the whole course — blobs first (one
// request per file; inlining content in the tree hit GitHub's 422 "input was
// too large to process" on a narration-baked course, 2026-09-02), then one
// tree of SHAs, one commit, one ref move. A dropped lecture is actually
// removed rather than left reachable.
//
// Since 2026-09-05 the branch's tree is read before anything is written, and
// a file whose blob SHA already sits at its path is neither uploaded nor
// listed — base_tree keeps it. Every fake here answers that read. The
// sequence tests give it an EMPTY listing, so every file is sent and the
// pre-existing shape is what they pin; the skip has its own describe below.

import { describe, expect, it } from "vitest";
import { commitFiles, gitBlobSha, setRetryDelaysForTests } from "../src/publish/github";

setRetryDelaysForTests([0, 0]); // retry behavior is under test; real waits are not

interface Call {
  url: string;
  method: string;
  body: Record<string, unknown> | null;
}

/** One entry of `GET /git/trees/<sha>?recursive=1`, as GitHub lists it. */
interface TreeEntry {
  path: string;
  sha: string;
  type?: string;
}

/**
 * The tree READ is `GET …/git/trees/<sha>?recursive=1`; the tree WRITE is
 * `POST …/git/trees`. Only the read has a slash after `trees`. Tests that
 * look at the tree body want the write — the read has no body at all.
 */
const isTreeRead = (url: string, method: string): boolean => method === "GET" && url.includes("/git/trees/");
const isTreeWrite = (c: Call): boolean => c.method === "POST" && c.url.endsWith("/git/trees");
/** What the tree read answers. A listing that names nothing sends everything. */
const listing = (entries: TreeEntry[] = []) => ({ tree: entries.map((e) => ({ type: "blob", ...e })) });

/**
 * Records every request and answers each Git Data endpoint in turn. `tree` is
 * what the branch's tree read lists; `treeStatus` makes that one read fail.
 */
function recorder(opts: { tree?: TreeEntry[]; treeStatus?: number } = {}): { calls: Call[]; fetchImpl: typeof fetch } {
  const calls: Call[] = [];
  const fetchImpl = (async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? "GET";
    calls.push({
      url,
      method,
      body: init.body ? (JSON.parse(init.body as string) as Record<string, unknown>) : null,
    });
    if (isTreeRead(url, method) && opts.treeStatus !== undefined) {
      return { ok: false, status: opts.treeStatus, json: async () => ({}), text: async () => "" } as Response;
    }
    const body = url.includes("/git/ref/")
      ? { object: { sha: "refsha" } }
      : url.includes("/git/commits/")
        ? { tree: { sha: "treesha" } }
        : url.includes("/git/blobs")
          ? { sha: `blob${calls.filter((c) => c.url.includes("/git/blobs")).length}` }
          : isTreeRead(url, method)
            ? listing(opts.tree)
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
  it("writes everything in ONE commit: three reads, then blobs, tree, commit, ref move", async () => {
    const { calls, fetchImpl } = recorder();
    await commitFiles(REPO, "t", "main", FILES, [], "msg", fetchImpl);
    // The reads decide what to write: the ref, its commit, and that commit's
    // tree (the unchanged check). The writes are one blob per file, then ONE
    // tree, ONE commit, ONE ref move. What the sequence protects is the
    // tail — a whole course lands as a single revision — and that nothing is
    // written before the reads that decide what to write.
    expect(calls.map((c) => c.method)).toEqual(["GET", "GET", "GET", "POST", "POST", "POST", "PATCH"]);
    expect(calls[2].url).toMatch(/\/git\/trees\/treesha\?recursive=1$/);
    expect(calls.filter((c) => c.url.includes("/git/commits") && c.method === "POST")).toHaveLength(1);
    expect(calls.filter((c) => c.method === "PATCH")).toHaveLength(1);
  });

  it("one blob request per file, still ONE commit for a whole course", async () => {
    const { calls, fetchImpl } = recorder();
    const many = Array.from({ length: 24 }, (_, i) => ({ path: `courses/c/${i}.yaml`, content: `n: ${i}` }));
    await commitFiles(REPO, "t", "main", many, [], "msg", fetchImpl);
    expect(calls.filter((c) => c.url.includes("/git/blobs"))).toHaveLength(24);
    // Tree WRITES: the read of the current tree is a GET and is not a commit.
    expect(calls.filter(isTreeWrite)).toHaveLength(1);
    expect(calls.filter((c) => c.url.includes("/git/commits") && c.method === "POST")).toHaveLength(1);
  });

  it("the tree carries blob SHAs, never inline content — the 422 too-large fix", async () => {
    const { calls, fetchImpl } = recorder();
    await commitFiles(REPO, "t", "main", FILES, [], "msg", fetchImpl);
    const blob = calls.find((c) => c.url.includes("/git/blobs"))!;
    expect(blob.body).toEqual({ content: Buffer.from("title: a", "utf8").toString("base64"), encoding: "base64" });
    const tree = calls.find(isTreeWrite)!.body!.tree as Record<string, unknown>[];
    expect(tree[0]).toEqual({ path: "courses/c/a.yaml", mode: "100644", type: "blob", sha: "blob1" });
    for (const entry of tree) expect(entry).not.toHaveProperty("content");
  });

  it("bases the tree on the current one, so untouched files survive", async () => {
    const { calls, fetchImpl } = recorder();
    await commitFiles(REPO, "t", "main", FILES, [], "msg", fetchImpl);
    // base_tree is the tree the ref's commit named — the same one the
    // unchanged check read. Files this publish does not list stay as they are.
    expect(calls.find(isTreeWrite)!.body!.base_tree).toBe("treesha");
  });

  it("deletes a dropped path with a null sha", async () => {
    const { calls, fetchImpl } = recorder();
    await commitFiles(REPO, "t", "main", FILES, ["courses/c/gone.yaml"], "msg", fetchImpl);
    const tree = calls.find(isTreeWrite)!.body!.tree as Record<string, unknown>[];
    expect(tree).toContainEqual({ path: "courses/c/gone.yaml", mode: "100644", type: "blob", sha: null });
  });

  it("parents the new commit on the branch head and moves the ref to it", async () => {
    const { calls, fetchImpl } = recorder();
    await commitFiles(REPO, "t", "main", FILES, [], "msg", fetchImpl);
    const commit = calls.find((c) => c.url.endsWith("/git/commits") && c.method === "POST")!;
    expect(commit.body!.parents).toEqual(["refsha"]);
    expect(commit.body!.tree).toBe("newtree");
    const ref = calls.find((c) => c.method === "PATCH")!;
    expect(ref.body!.sha).toBe("newcommit");
    expect(ref.url).toContain("/git/refs/heads/main");
  });

  it("commits to the branch it was given, not to main by default", async () => {
    const { calls, fetchImpl } = recorder();
    await commitFiles(REPO, "t", "trunk", FILES, [], "msg", fetchImpl);
    expect(calls[0].url).toContain("/git/ref/heads/trunk");
    expect(calls.find((c) => c.method === "PATCH")!.url).toContain("/git/refs/heads/trunk");
  });

  it("refuses to commit nothing", async () => {
    const { fetchImpl } = recorder();
    await expect(commitFiles(REPO, "t", "main", [], [], "msg", fetchImpl)).rejects.toThrow(/nothing/i);
  });
});

// The republish that motivated the tree read: changing one setting on a
// narration-baked course re-uploaded every lecture — ~160 MB for a 17-lecture
// course — to rewrite four small files. The lecture YAMLs were byte-identical.
describe("unchanged files are not re-uploaded", () => {
  const A = { path: "courses/c/a.yaml", content: "title: a" };
  const B = { path: "courses/c/b.yaml", content: "title: b" };
  /** A as the branch already holds it — the SHA git gives these exact bytes. */
  const aThere = async (): Promise<TreeEntry> => ({ path: A.path, sha: await gitBlobSha(A.content) });
  /** B at its path, but with other bytes behind it. */
  const bDiffers: TreeEntry = { path: B.path, sha: "0123456789abcdef0123456789abcdef01234567" };

  it("gitBlobSha hashes as git does: sha1 of `blob <bytes>\\0<content>`", async () => {
    // Vectors from `git hash-object --stdin` (2026-09-05). The header counts
    // UTF-8 BYTES, not characters: "æøå" is three characters and six bytes,
    // and a character count would hash a different header.
    expect(await gitBlobSha("")).toBe("e69de29bb2d1d6434b8b29ae775ad8c2e48c5391");
    expect(await gitBlobSha("hello\n")).toBe("ce013625030ba8dba906f756967f9e9ca394464a");
    expect(await gitBlobSha("title: a")).toBe("384d5152fd6bef307df3e33842311bfc84b654c5");
    expect(await gitBlobSha("æøå")).toBe("5a9c6c8500db78700d651360f18dec88dc2fb642");
  });

  it("uploads and lists only the file whose bytes differ; base_tree keeps the other", async () => {
    const { calls, fetchImpl } = recorder({ tree: [await aThere(), bDiffers] });
    const seen: string[] = [];
    await commitFiles(REPO, "t", "main", [A, B], [], "msg", fetchImpl, (done, total) => seen.push(`${done}/${total}`));
    const blobs = calls.filter((c) => c.url.includes("/git/blobs"));
    expect(blobs).toHaveLength(1);
    expect(Buffer.from(blobs[0].body!.content as string, "base64").toString("utf8")).toBe(B.content);
    const tree = calls.find(isTreeWrite)!;
    expect(tree.body!.base_tree).toBe("treesha");
    // A is absent, not listed with some sha: listing it would need a blob
    // that was never made, and base_tree is what carries it forward.
    expect(tree.body!.tree).toEqual([{ path: B.path, mode: "100644", type: "blob", sha: "blob1" }]);
    // Progress counts what is sent, not what the plan holds.
    expect(seen).toEqual(["0/1", "1/1"]);
  });

  it("writes nothing and answers the current head when every file is already there", async () => {
    const { calls, fetchImpl } = recorder({ tree: [await aThere(), { path: B.path, sha: await gitBlobSha(B.content) }] });
    await expect(commitFiles(REPO, "t", "main", [A, B], [], "msg", fetchImpl)).resolves.toEqual({ commitSha: "refsha" });
    // Three reads and not one write: no blob, no tree, no commit, no ref move.
    expect(calls.map((c) => c.method)).toEqual(["GET", "GET", "GET"]);
  });

  it("a deletion still commits when every file is unchanged — the tree carries only the removal", async () => {
    const { calls, fetchImpl } = recorder({ tree: [await aThere()] });
    await commitFiles(REPO, "t", "main", [A], ["courses/c/gone.yaml"], "msg", fetchImpl);
    expect(calls.some((c) => c.url.includes("/git/blobs"))).toBe(false);
    expect(calls.find(isTreeWrite)!.body!.tree).toEqual([{ path: "courses/c/gone.yaml", mode: "100644", type: "blob", sha: null }]);
    expect(calls.at(-1)!.method).toBe("PATCH");
  });

  it("a path that is missing from the tree, or there with other bytes, is sent", async () => {
    const { calls, fetchImpl } = recorder({ tree: [bDiffers] }); // A not listed at all; B listed, different bytes
    await commitFiles(REPO, "t", "main", [A, B], [], "msg", fetchImpl);
    expect(calls.filter((c) => c.url.includes("/git/blobs"))).toHaveLength(2);
  });

  it("a tree read that fails skips the optimisation, never the publish", async () => {
    // A would have been skipped had the read worked. It did not, so the map
    // is empty and A goes up like everything else — the pre-skip behaviour.
    const { calls, fetchImpl } = recorder({ tree: [await aThere()], treeStatus: 404 });
    await expect(commitFiles(REPO, "t", "main", [A, B], [], "msg", fetchImpl)).resolves.toEqual({ commitSha: "newcommit" });
    expect(calls.filter((c) => c.url.includes("/git/blobs"))).toHaveLength(2);
  });
});

describe("a repository with no commits yet", () => {
  /**
   * A fresh repo 409s on the ref read AND on creating a tree — the whole Git
   * Data API is unavailable until something has been committed. Only the
   * Contents API can write the first file, after which the ref exists.
   *
   * `tree` is what the tree read lists once the repo is seeded. The default
   * is empty so the ordinary path is exercised with the file in it; what the
   * seed commit's tree REALLY holds — the seeded file — has its own tests.
   */
  function emptyRepo(tree: TreeEntry[] = []): { calls: Call[]; fetchImpl: typeof fetch } {
    const calls: Call[] = [];
    let seeded = false;
    const fetchImpl = (async (url: string, init: RequestInit = {}) => {
      const method = init.method ?? "GET";
      calls.push({
        url,
        method,
        body: init.body ? (JSON.parse(init.body as string) as Record<string, unknown>) : null,
      });
      if (url.includes("/contents/") && method === "PUT") {
        seeded = true;
        return { ok: true, status: 201, json: async () => ({ commit: { sha: "seed" } }), text: async () => "" } as Response;
      }
      if (!seeded) {
        return { ok: false, status: 409, json: async () => ({}), text: async () => "Git Repository is empty." } as Response;
      }
      const body = url.includes("/git/ref/")
        ? { object: { sha: "seedsha" } }
        : url.includes("/git/commits/")
          ? { tree: { sha: "seedtree" } }
          : isTreeRead(url, method)
            ? listing(tree)
            : { sha: "new" };
      return { ok: true, status: 200, json: async () => body, text: async () => "" } as Response;
    }) as unknown as typeof fetch;
    return { calls, fetchImpl };
  }

  it("publishes instead of failing with 409", async () => {
    const { fetchImpl } = emptyRepo();
    await expect(commitFiles(REPO, "t", "main", FILES, [], "msg", fetchImpl)).resolves.toBeTruthy();
  });

  it("seeds the repo through the Contents API, which is the only endpoint that can", async () => {
    const { calls, fetchImpl } = emptyRepo();
    await commitFiles(REPO, "t", "main", FILES, [], "msg", fetchImpl);
    const seed = calls.find((c) => c.url.includes("/contents/"))!;
    expect(seed.method).toBe("PUT");
    expect(seed.body!.branch).toBe("main");
    // base64 of the first file's content
    expect(seed.body!.content).toBe(btoa("title: a"));
  });

  it("commits the rest on the ordinary path once the repo exists", async () => {
    const { calls, fetchImpl } = emptyRepo();
    await commitFiles(REPO, "t", "main", FILES, [], "msg", fetchImpl);
    const tree = calls.find(isTreeWrite)!;
    expect(tree.body!.base_tree).toBe("seedtree");
    expect(calls.at(-1)!.method).toBe("PATCH");
  });

  it("ignores deletions, since there was nothing to delete", async () => {
    const { calls, fetchImpl } = emptyRepo();
    await commitFiles(REPO, "t", "main", FILES, ["gone.yaml"], "msg", fetchImpl);
    const tree = calls.find(isTreeWrite)!.body!.tree as Record<string, unknown>[];
    expect(tree).toHaveLength(1);
  });

  it("a single-file publish stops at the seed commit when the tree read shows the file landed", async () => {
    // Faithful listing: the file the Contents API just wrote IS in the seed
    // commit's tree, under the SHA git gives its bytes. Nothing is left to
    // send, so the seed commit is the publish — one commit, not two.
    const { calls, fetchImpl } = emptyRepo([{ path: FILES[0].path, sha: await gitBlobSha(FILES[0].content) }]);
    await expect(commitFiles(REPO, "t", "main", FILES, [], "msg", fetchImpl)).resolves.toEqual({ commitSha: "seedsha" });
    expect(calls.some(isTreeWrite)).toBe(false);
    expect(calls.some((c) => c.method === "PATCH")).toBe(false);
  });

  it("the rest follow on the ordinary path without uploading the seeded file twice", async () => {
    const second = { path: "courses/c/b.yaml", content: "title: b" };
    const { calls, fetchImpl } = emptyRepo([{ path: FILES[0].path, sha: await gitBlobSha(FILES[0].content) }]);
    await commitFiles(REPO, "t", "main", [FILES[0], second], [], "msg", fetchImpl);
    expect(calls.filter((c) => c.url.includes("/git/blobs"))).toHaveLength(1);
    const tree = calls.find(isTreeWrite)!;
    expect(tree.body!.base_tree).toBe("seedtree");
    expect((tree.body!.tree as { path: string }[]).map((e) => e.path)).toEqual([second.path]);
  });

  it("encodes a path with a space without eating its slashes", async () => {
    const { calls, fetchImpl } = emptyRepo();
    await commitFiles(REPO, "t", "main", [{ path: "a b/c.yaml", content: "x" }], [], "msg", fetchImpl);
    expect(calls.find((c) => c.url.includes("/contents/"))!.url).toContain("/contents/a%20b/c.yaml");
  });
});

describe("large files", () => {
  it("base64-encodes a megabyte-scale lecture without building it byte by byte", async () => {
    // Firefox reports a deeply nested rope as "too much recursion"; the chunked
    // encoder is what keeps this from happening on a lecture with portraits.
    const { calls, fetchImpl } = (() => {
      const calls: Call[] = [];
      let seeded = false;
      const fetchImpl = (async (url: string, init: RequestInit = {}) => {
        const method = init.method ?? "GET";
        calls.push({ url, method, body: init.body ? (JSON.parse(init.body as string) as Record<string, unknown>) : null });
        if (url.includes("/contents/") && method === "PUT") {
          seeded = true;
          return { ok: true, status: 201, json: async () => ({}), text: async () => "" } as Response;
        }
        if (!seeded) return { ok: false, status: 409, json: async () => ({}), text: async () => "" } as Response;
        const body = url.includes("/git/ref/")
          ? { object: { sha: "s" } }
          : url.includes("/git/commits/")
            ? { tree: { sha: "t" } }
            : isTreeRead(url, method)
              ? listing()
              : { sha: "n" };
        return { ok: true, status: 200, json: async () => body, text: async () => "" } as Response;
      }) as unknown as typeof fetch;
      return { calls, fetchImpl };
    })();
    const big = "æøå".repeat(400_000); // ~2.4 MB once UTF-8 encoded
    await commitFiles(REPO, "t", "main", [{ path: "a.yaml", content: big }], [], "msg", fetchImpl);
    const seed = calls.find((c) => c.url.includes("/contents/"))!;
    expect(typeof seed.body!.content).toBe("string");
    expect((seed.body!.content as string).length).toBeGreaterThan(1_000_000);
  });
});

describe("a branch that moved under us", () => {
  /**
   * Answers the first PATCH with 422, then behaves; head advances after it.
   * `tree` is what the tree read lists — it is read once, before the race.
   */
  function racing(tree: TreeEntry[] = []): { calls: Call[]; fetchImpl: typeof fetch } {
    const calls: Call[] = [];
    let patched = 0;
    let head = "old";
    const fetchImpl = (async (url: string, init: RequestInit = {}) => {
      const method = init.method ?? "GET";
      calls.push({ url, method, body: init.body ? (JSON.parse(init.body as string) as Record<string, unknown>) : null });
      if (url.includes("/git/refs/heads/") && method === "PATCH") {
        patched++;
        if (patched === 1) {
          head = "moved";
          return { ok: false, status: 422, json: async () => ({}), text: async () => "Update is not a fast forward" } as Response;
        }
        return { ok: true, status: 200, json: async () => ({}), text: async () => "" } as Response;
      }
      const body = url.includes("/git/ref/")
        ? { object: { sha: head } }
        : url.includes("/git/commits/")
          ? { tree: { sha: `${head}-tree` } }
          : isTreeRead(url, method)
            ? listing(tree)
            : { sha: "new" };
      return { ok: true, status: 200, json: async () => body, text: async () => "" } as Response;
    }) as unknown as typeof fetch;
    return { calls, fetchImpl };
  }

  it("re-reads the branch and lands the commit instead of failing", async () => {
    const { fetchImpl } = racing();
    await expect(commitFiles(REPO, "t", "main", FILES, [], "msg", fetchImpl)).resolves.toBeTruthy();
  });

  it("rebuilds on whatever is there now, not on the stale parent", async () => {
    const { calls, fetchImpl } = racing();
    await commitFiles(REPO, "t", "main", FILES, [], "msg", fetchImpl);
    const commits = calls.filter((c) => c.url.endsWith("/git/commits") && c.method === "POST");
    expect(commits[0].body!.parents).toEqual(["old"]);
    expect(commits[1].body!.parents).toEqual(["moved"]);
    // Tree WRITES only. The tree read that precedes them is a GET with no
    // body, and it is not repeated on the retry (next test) — so the second
    // write is the rebuilt one, and it must sit on the tree the branch has NOW.
    const trees = calls.filter(isTreeWrite);
    expect(trees[0].body!.base_tree).toBe("old-tree");
    expect(trees[1].body!.base_tree).toBe("moved-tree");
  });

  /**
   * The retry question. `remoteBlobShas` reads the tree ONCE, before the
   * retry, so a skip was decided against the tree the branch had then — not
   * the one it moved to. Is that safe?
   *
   * For the first attempt the map is never stale: it comes from the very tree
   * the commit is based on, a differing or missing entry always sends the
   * file, and the only way to skip is a byte-identical blob at that path.
   *
   * On the retry the map IS stale, and "stale can only over-send, never
   * under-send" is not quite true: if the concurrent commit changed or deleted
   * a path we skipped, the rebuilt commit keeps THEIR version — we asserted
   * nothing about that path, so base_tree = moved-tree supplies it. That is
   * git's own merge outcome (paths we did not change carry what the other
   * side did to them; paths we changed carry ours), it replaces the old
   * behaviour of silently overwriting a concurrent edit of the same lecture
   * with an identical-to-before copy, and the NEXT publish reads the moved
   * tree, sees the mismatch, and sends the file. For a seconds-wide window in
   * which someone else edits the very lecture being republished, that is
   * acceptable. Re-reading the tree inside the retry would mean moving the
   * blob loop into it — for a case that has never occurred.
   */
  it("keeps the skip decided against the tree it read once; the retry does not re-read", async () => {
    const changed = { path: "courses/c/b.yaml", content: "title: b" };
    const { calls, fetchImpl } = racing([{ path: FILES[0].path, sha: await gitBlobSha(FILES[0].content) }]);
    await commitFiles(REPO, "t", "main", [FILES[0], changed], [], "msg", fetchImpl);
    expect(calls.filter((c) => isTreeRead(c.url, c.method))).toHaveLength(1);
    expect(calls.filter((c) => c.url.includes("/git/blobs"))).toHaveLength(1);
    const trees = calls.filter(isTreeWrite);
    expect(trees).toHaveLength(2);
    for (const t of trees) expect((t.body!.tree as { path: string }[]).map((e) => e.path)).toEqual([changed.path]);
    expect(trees[1].body!.base_tree).toBe("moved-tree");
  });

  it("gives up after one retry rather than looping", async () => {
    const calls: Call[] = [];
    const alwaysStale = (async (url: string, init: RequestInit = {}) => {
      const method = init.method ?? "GET";
      calls.push({ url, method, body: null });
      if (url.includes("/git/refs/heads/") && method === "PATCH") {
        return { ok: false, status: 422, json: async () => ({}), text: async () => "Update is not a fast forward" } as Response;
      }
      const body = url.includes("/git/ref/")
        ? { object: { sha: "s" } }
        : url.includes("/git/commits/")
          ? { tree: { sha: "t" } }
          : isTreeRead(url, method)
            ? listing()
            : { sha: "n" };
      return { ok: true, status: 200, json: async () => body, text: async () => "" } as Response;
    }) as unknown as typeof fetch;
    await expect(commitFiles(REPO, "t", "main", FILES, [], "msg", alwaysStale)).rejects.toThrow(/fast forward/);
    expect(calls.filter((c) => c.method === "PATCH")).toHaveLength(2);
  });

  it("never lets the browser answer an API read from cache", async () => {
    const seen: (RequestCache | undefined)[] = [];
    const fetchImpl = (async (url: string, init: RequestInit = {}) => {
      seen.push(init.cache);
      const method = init.method ?? "GET";
      const body = url.includes("/git/ref/")
        ? { object: { sha: "s" } }
        : url.includes("/git/commits/")
          ? { tree: { sha: "t" } }
          : isTreeRead(url, method)
            ? listing()
            : { sha: "n" };
      return { ok: true, status: 200, json: async () => body, text: async () => "" } as Response;
    }) as unknown as typeof fetch;
    await commitFiles(REPO, "t", "main", FILES, [], "msg", fetchImpl);
    // The tree read is included: a cached listing a minute old would compare
    // against blobs that are no longer there.
    expect(seen.length).toBeGreaterThanOrEqual(3);
    expect(seen.every((c) => c === "no-store")).toBe(true);
  });
});

// Hans's live failure (2026-09-02): /git/trees answered 502 by GitHub's edge
// — whose error pages carry no CORS headers, so Firefox reported an opaque
// "NetworkError when attempting to fetch resource". Every write on this path
// is content-addressed or idempotent, so retrying in place is safe.
describe("transient failures", () => {
  /** `method` narrows a failure to the read or the write of a shared path. */
  function flaky(failures: { match: string; method?: string; times: number; kind: "throw" | "502" }[]): { calls: Call[]; fetchImpl: typeof fetch } {
    const calls: Call[] = [];
    const left = failures.map((f) => ({ ...f }));
    const fetchImpl = (async (url: string, init: RequestInit = {}) => {
      const method = init.method ?? "GET";
      calls.push({ url, method, body: init.body ? (JSON.parse(init.body as string) as Record<string, unknown>) : null });
      const f = left.find((x) => url.includes(x.match) && (!x.method || x.method === method) && x.times > 0);
      if (f) {
        f.times--;
        if (f.kind === "throw") throw new TypeError("NetworkError when attempting to fetch resource.");
        return { ok: false, status: 502, json: async () => ({}), text: async () => "Bad gateway" } as Response;
      }
      const body = url.includes("/git/ref/")
        ? { object: { sha: "refsha" } }
        : url.includes("/git/commits/")
          ? { tree: { sha: "treesha" } }
          : url.includes("/git/blobs")
            ? { sha: "blob1" }
            : isTreeRead(url, method)
              ? listing()
              : url.includes("/git/trees")
                ? { sha: "newtree" }
                : url.includes("/git/commits")
                  ? { sha: "newcommit" }
                  : {};
      return { ok: true, status: 200, json: async () => body, text: async () => "" } as Response;
    }) as unknown as typeof fetch;
    return { calls, fetchImpl };
  }

  it("a 502 on the tree call is retried in place and the publish lands", async () => {
    // The tree WRITE — that is the call Hans's 502 hit. The read has its own test.
    const { calls, fetchImpl } = flaky([{ match: "/git/trees", method: "POST", times: 1, kind: "502" }]);
    await expect(commitFiles(REPO, "t", "main", FILES, [], "msg", fetchImpl)).resolves.toEqual({ commitSha: "newcommit" });
    expect(calls.filter(isTreeWrite)).toHaveLength(2);
  });

  it("a dropped connection (opaque NetworkError) is retried the same way", async () => {
    const { fetchImpl } = flaky([{ match: "/git/trees", method: "POST", times: 2, kind: "throw" }]);
    await expect(commitFiles(REPO, "t", "main", FILES, [], "msg", fetchImpl)).resolves.toEqual({ commitSha: "newcommit" });
  });

  it("a persistent network failure names the request instead of a bare NetworkError", async () => {
    const { fetchImpl } = flaky([{ match: "/git/trees", method: "POST", times: 99, kind: "throw" }]);
    await expect(commitFiles(REPO, "t", "main", FILES, [], "msg", fetchImpl)).rejects.toThrow(/git\/trees.*3 times.*press Publish again/s);
  });

  it("a tree READ that keeps failing is retried like any call, then given up quietly — every file is sent", async () => {
    const { calls, fetchImpl } = flaky([{ match: "/git/trees/", method: "GET", times: 99, kind: "throw" }]);
    await expect(commitFiles(REPO, "t", "main", FILES, [], "msg", fetchImpl)).resolves.toEqual({ commitSha: "newcommit" });
    expect(calls.filter((c) => isTreeRead(c.url, c.method))).toHaveLength(3); // one try, two retries
    expect(calls.filter((c) => c.url.includes("/git/blobs"))).toHaveLength(1);
  });

  it("a blob that cannot upload names ITS file and size", async () => {
    const { fetchImpl } = flaky([{ match: "/git/blobs", times: 99, kind: "throw" }]);
    await expect(commitFiles(REPO, "t", "main", FILES, [], "msg", fetchImpl)).rejects.toThrow(/Uploading "courses\/c\/a\.yaml" \(0\.0 MB\)/);
  });

  it("reports upload progress per blob", async () => {
    const { fetchImpl } = flaky([]);
    const seen: string[] = [];
    const many = [FILES[0], { path: "courses/c/b.yaml", content: "title: b" }];
    await commitFiles(REPO, "t", "main", many, [], "msg", fetchImpl, (done, total) => seen.push(`${done}/${total}`));
    expect(seen).toEqual(["0/2", "1/2", "2/2"]);
  });
});
