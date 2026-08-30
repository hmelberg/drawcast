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
  /** GitHub answers 409 "Git Repository is empty" for the ref of a fresh repo. */
  function emptyRepo(): { calls: Call[]; fetchImpl: typeof fetch } {
    const calls: Call[] = [];
    const fetchImpl = (async (url: string, init: RequestInit = {}) => {
      calls.push({
        url,
        method: init.method ?? "GET",
        body: init.body ? (JSON.parse(init.body as string) as Record<string, unknown>) : null,
      });
      if (url.includes("/git/ref/heads/")) {
        return { ok: false, status: 409, json: async () => ({}), text: async () => "Git Repository is empty." } as Response;
      }
      return { ok: true, status: 200, json: async () => ({ sha: "new" }), text: async () => "" } as Response;
    }) as unknown as typeof fetch;
    return { calls, fetchImpl };
  }

  it("makes the first commit instead of failing with 409", async () => {
    const { fetchImpl } = emptyRepo();
    await expect(commitFiles(REPO, "t", "main", FILES, [], "msg", fetchImpl)).resolves.toBeTruthy();
  });

  it("has no parent and no base tree", async () => {
    const { calls, fetchImpl } = emptyRepo();
    await commitFiles(REPO, "t", "main", FILES, [], "msg", fetchImpl);
    const tree = calls.find((c) => c.url.includes("/git/trees"))!;
    expect(tree.body!.base_tree).toBeUndefined();
    const commit = calls.find((c) => c.url.endsWith("/git/commits"))!;
    expect(commit.body!.parents).toEqual([]);
  });

  it("creates the ref rather than moving it", async () => {
    const { calls, fetchImpl } = emptyRepo();
    await commitFiles(REPO, "t", "main", FILES, [], "msg", fetchImpl);
    const ref = calls.at(-1)!;
    expect(ref.method).toBe("POST");
    expect(ref.url).toMatch(/\/git\/refs$/);
    expect(ref.body).toEqual({ ref: "refs/heads/main", sha: "new" });
  });

  it("ignores deletions, since there is nothing to delete", async () => {
    const { calls, fetchImpl } = emptyRepo();
    await commitFiles(REPO, "t", "main", FILES, ["gone.yaml"], "msg", fetchImpl);
    const tree = calls.find((c) => c.url.includes("/git/trees"))!.body!.tree as Record<string, unknown>[];
    expect(tree).toHaveLength(1);
  });
});
