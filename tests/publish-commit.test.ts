// The atomic commit: one revision for the whole course, five calls whatever
// its size, and a dropped lecture actually removed rather than left reachable.

import { describe, expect, it } from "vitest";
import { commitFiles } from "../src/publish/github";

interface Call {
  url: string;
  method: string;
  body: Record<string, unknown> | null;
}

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

  it("stays at five calls for a whole course, not one per file", async () => {
    const { calls, fetchImpl } = recorder();
    const many = Array.from({ length: 24 }, (_, i) => ({ path: `courses/c/${i}.yaml`, content: `n: ${i}` }));
    await commitFiles(REPO, "t", "main", many, [], "msg", fetchImpl);
    expect(calls).toHaveLength(5);
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

  it("commits to the branch it was given, not to main by default", async () => {
    const { calls, fetchImpl } = recorder();
    await commitFiles(REPO, "t", "trunk", FILES, [], "msg", fetchImpl);
    expect(calls[0].url).toContain("/git/ref/heads/trunk");
    expect(calls[4].url).toContain("/git/refs/heads/trunk");
  });

  it("refuses to commit nothing", async () => {
    const { fetchImpl } = recorder();
    await expect(commitFiles(REPO, "t", "main", [], [], "msg", fetchImpl)).rejects.toThrow(/nothing/i);
  });
});

describe("a repository with no commits yet", () => {
  /**
   * A fresh repo 409s on the ref read AND on creating a tree — the whole Git
   * Data API is unavailable until something has been committed. Only the
   * Contents API can write the first file, after which the ref exists.
   */
  function emptyRepo(): { calls: Call[]; fetchImpl: typeof fetch } {
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
    const tree = calls.find((c) => c.url.includes("/git/trees"))!;
    expect(tree.body!.base_tree).toBe("seedtree");
    expect(calls.at(-1)!.method).toBe("PATCH");
  });

  it("ignores deletions, since there was nothing to delete", async () => {
    const { calls, fetchImpl } = emptyRepo();
    await commitFiles(REPO, "t", "main", FILES, ["gone.yaml"], "msg", fetchImpl);
    const tree = calls.find((c) => c.url.includes("/git/trees"))!.body!.tree as Record<string, unknown>[];
    expect(tree).toHaveLength(1);
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
        const body = url.includes("/git/ref/") ? { object: { sha: "s" } } : url.includes("/git/commits/") ? { tree: { sha: "t" } } : { sha: "n" };
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
  /** Answers the first PATCH with 422, then behaves; head advances after it. */
  function racing(): { calls: Call[]; fetchImpl: typeof fetch } {
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
    const trees = calls.filter((c) => c.url.includes("/git/trees"));
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
      const body = url.includes("/git/ref/") ? { object: { sha: "s" } } : url.includes("/git/commits/") ? { tree: { sha: "t" } } : { sha: "n" };
      return { ok: true, status: 200, json: async () => body, text: async () => "" } as Response;
    }) as unknown as typeof fetch;
    await expect(commitFiles(REPO, "t", "main", FILES, [], "msg", alwaysStale)).rejects.toThrow(/fast forward/);
    expect(calls.filter((c) => c.method === "PATCH")).toHaveLength(2);
  });

  it("never lets the browser answer an API read from cache", async () => {
    const seen: (RequestCache | undefined)[] = [];
    const fetchImpl = (async (url: string, init: RequestInit = {}) => {
      seen.push(init.cache);
      const body = url.includes("/git/ref/") ? { object: { sha: "s" } } : url.includes("/git/commits/") ? { tree: { sha: "t" } } : { sha: "n" };
      return { ok: true, status: 200, json: async () => body, text: async () => "" } as Response;
    }) as unknown as typeof fetch;
    await commitFiles(REPO, "t", "main", FILES, [], "msg", fetchImpl);
    expect(seen.every((c) => c === "no-store")).toBe(true);
  });
});
