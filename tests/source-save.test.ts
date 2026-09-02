// Saving the SOURCE to GitHub — the .yaml a document is edited as, distinct
// from Share/Publish's rendered viewer page. Both can exist for one document;
// neither implies the other happened.
import { describe, expect, it } from "vitest";
import {
  parseSourceManifest,
  saveSource,
  sourceIndexPath,
  sourceManifest,
  sourcePathFor,
  uniqueSourcePath,
  type SourceManifest,
} from "../src/publish/source";

describe("sourcePathFor", () => {
  it("derives a path from the title", () => {
    expect(sourcePathFor("Ricardo on trade", "casts", null)).toBe("casts/sources/ricardo-on-trade.yaml");
  });
  it("keeps the path a document already has — retitling must not orphan the file", () => {
    expect(sourcePathFor("A new title", "casts", "casts/sources/ricardo-on-trade.yaml"))
      .toBe("casts/sources/ricardo-on-trade.yaml");
  });
  it("handles an empty subfolder", () => {
    expect(sourcePathFor("Ricardo", "", null)).toBe("sources/ricardo.yaml");
  });
});

describe("sourceManifest", () => {
  const base: SourceManifest = { sources: [{ path: "sources/a.yaml", title: "A", ts: "t1" }] };

  it("replaces the entry for a path it already knows", () => {
    const out = sourceManifest(base, { path: "sources/a.yaml", title: "A renamed", ts: "t2" });
    expect(out.sources).toHaveLength(1);
    expect(out.sources[0].title).toBe("A renamed");
  });
  it("appends a new path", () => {
    const out = sourceManifest(base, { path: "sources/b.yaml", title: "B", ts: "t2" });
    expect(out.sources.map((s) => s.path)).toEqual(["sources/a.yaml", "sources/b.yaml"]);
  });
  it("does not mutate its input", () => {
    sourceManifest(base, { path: "sources/b.yaml", title: "B", ts: "t2" });
    expect(base.sources).toHaveLength(1);
  });
});

describe("uniqueSourcePath", () => {
  const manifest: SourceManifest = { sources: [{ path: "casts/sources/untitled-drawcast.yaml", title: "Untitled drawcast", ts: "t1" }] };

  it("a free path is returned unchanged", () => {
    expect(uniqueSourcePath("casts/sources/ricardo.yaml", manifest)).toBe("casts/sources/ricardo.yaml");
  });
  it("a claimed path gets suffixed -2, before the extension", () => {
    expect(uniqueSourcePath("casts/sources/untitled-drawcast.yaml", manifest)).toBe("casts/sources/untitled-drawcast-2.yaml");
  });
  it("keeps counting past an already-suffixed collision", () => {
    const twoTaken: SourceManifest = {
      sources: [...manifest.sources, { path: "casts/sources/untitled-drawcast-2.yaml", title: "Untitled drawcast", ts: "t2" }],
    };
    expect(uniqueSourcePath("casts/sources/untitled-drawcast.yaml", twoTaken)).toBe("casts/sources/untitled-drawcast-3.yaml");
  });
});

describe("parseSourceManifest", () => {
  it("a missing or damaged manifest starts a fresh one rather than throwing", () => {
    expect(parseSourceManifest("")).toEqual({ sources: [] });
    expect(parseSourceManifest("{ not json")).toEqual({ sources: [] });
    expect(parseSourceManifest('{"sources":"nope"}')).toEqual({ sources: [] });
  });
  it("round-trips what sourceManifest produced", () => {
    const m = sourceManifest({ sources: [] }, { path: "casts/sources/a.yaml", title: "A", ts: "t1" });
    expect(parseSourceManifest(JSON.stringify(m))).toEqual(m);
  });
  it("drops an entry missing ts, rather than letting the whole listing fail on a later sort", () => {
    const text = JSON.stringify({
      sources: [
        { path: "casts/sources/a.yaml", title: "A" }, // hand-edited, ts dropped
        { path: "casts/sources/b.yaml", title: "B", ts: "t1" },
      ],
    });
    expect(parseSourceManifest(text)).toEqual({ sources: [{ path: "casts/sources/b.yaml", title: "B", ts: "t1" }] });
  });
  it("drops an entry missing title", () => {
    const text = JSON.stringify({ sources: [{ path: "casts/sources/a.yaml", ts: "t1" }] });
    expect(parseSourceManifest(text)).toEqual({ sources: [] });
  });
});

describe("sourceIndexPath", () => {
  it("sits beside the sources it lists", () => {
    expect(sourceIndexPath("casts")).toBe("casts/sources/index.json");
  });
  it("handles an empty directory", () => {
    expect(sourceIndexPath("")).toBe("sources/index.json");
  });
});

describe("saveSource", () => {
  interface Call {
    url: string;
    method: string;
    body: Record<string, unknown> | null;
  }

  /** Same recorder shape publish-commit.test.ts uses for commitFiles. */
  function recorder(existingIndex: string | null): { calls: Call[]; fetchImpl: typeof fetch } {
    const calls: Call[] = [];
    const fetchImpl = (async (url: string, init: RequestInit = {}) => {
      const method = init.method ?? "GET";
      calls.push({ url, method, body: init.body ? (JSON.parse(init.body as string) as Record<string, unknown>) : null });
      if (url.startsWith("https://raw.githubusercontent.com/")) {
        return existingIndex === null
          ? ({ ok: false, status: 404, json: async () => ({}), text: async () => "" } as Response)
          : ({ ok: true, status: 200, json: async () => ({}), text: async () => existingIndex } as Response);
      }
      if (url.includes("/repos/") && !url.includes("/git/")) {
        return { ok: true, status: 200, json: async () => ({ private: false, default_branch: "main" }), text: async () => "" } as Response;
      }
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

  const repo = { owner: "hmelberg", repo: "kurs" };

  it("commits the .yaml and the updated manifest in ONE commit", async () => {
    const { calls, fetchImpl } = recorder(null);
    const out = await saveSource({
      title: "Ricardo on trade",
      text: "title: Ricardo\ncommands: []\n",
      existing: null,
      dir: "casts",
      repo,
      token: "t",
      fetchImpl,
    });
    expect(out.path).toBe("casts/sources/ricardo-on-trade.yaml");
    // Exactly one tree POST — i.e. one commit — carrying both paths.
    const treeCalls = calls.filter((c) => c.url.includes("/git/trees") && c.method === "POST");
    expect(treeCalls).toHaveLength(1);
    const paths = (treeCalls[0].body!.tree as { path: string }[]).map((f) => f.path).sort();
    expect(paths).toEqual(["casts/sources/index.json", "casts/sources/ricardo-on-trade.yaml"]);
    const commitCalls = calls.filter((c) => c.url.endsWith("/git/commits") && c.method === "POST");
    expect(commitCalls).toHaveLength(1);
  });

  it("a missing manifest is the normal state of a fresh repo, not an error", async () => {
    const { fetchImpl } = recorder(null);
    await expect(
      saveSource({ title: "T", text: "title: T\ncommands: []\n", existing: null, dir: "casts", repo, token: "t", fetchImpl }),
    ).resolves.toBeTruthy();
  });

  it("re-saving an existing source keeps its path and updates its manifest entry, not appends a second", async () => {
    const existing = JSON.stringify({ sources: [{ path: "casts/sources/ricardo-on-trade.yaml", title: "Ricardo", ts: "t0" }] });
    const { calls, fetchImpl } = recorder(existing);
    const out = await saveSource({
      title: "Ricardo on trade — revised",
      text: "title: Ricardo\ncommands: []\n",
      existing: "casts/sources/ricardo-on-trade.yaml",
      dir: "casts",
      repo,
      token: "t",
      fetchImpl,
    });
    const blobs = calls.filter((c) => c.url.includes("/git/blobs")).map((c) => Buffer.from(c.body!.content as string, "base64").toString("utf8"));
    const manifestContent = blobs.find((b) => b.includes('"sources"'))!;
    const manifest = JSON.parse(manifestContent) as SourceManifest;
    expect(manifest.sources).toHaveLength(1);
    expect(manifest.sources[0].title).toBe("Ricardo on trade — revised");
    expect(out.path).toBe("casts/sources/ricardo-on-trade.yaml"); // never suffixed on a re-save
  });

  it("a second, DISTINCT never-saved document with the same title is suffixed — the first is never overwritten or dropped", async () => {
    // Doc A's own first save already landed and is recorded in the manifest.
    const existing = JSON.stringify({ sources: [{ path: "casts/sources/untitled-drawcast.yaml", title: "Untitled drawcast", ts: "t0" }] });
    const { calls, fetchImpl } = recorder(existing);
    const out = await saveSource({
      title: "Untitled drawcast", // doc B: never saved before, same title as doc A
      text: "title: B\ncommands: []\n",
      existing: null,
      dir: "casts",
      repo,
      token: "t",
      fetchImpl,
    });
    expect(out.path).toBe("casts/sources/untitled-drawcast-2.yaml");
    const treeCalls = calls.filter((c) => c.url.includes("/git/trees") && c.method === "POST");
    const tree = treeCalls[0].body!.tree as { path: string; content: string }[];
    const blobs = calls.filter((c) => c.url.includes("/git/blobs")).map((c) => Buffer.from(c.body!.content as string, "base64").toString("utf8"));
    // The manifest committed here must still carry doc A's entry alongside
    // the new one — this is the exact loss the fix exists to prevent.
    const manifest = JSON.parse(blobs.find((b) => b.includes('"sources"'))!) as SourceManifest;
    expect(manifest.sources.map((s) => s.path).sort()).toEqual([
      "casts/sources/untitled-drawcast-2.yaml",
      "casts/sources/untitled-drawcast.yaml",
    ]);
  });
});

describe("saveSource in an empty repository", () => {
  interface Call {
    url: string;
    method: string;
    body: Record<string, unknown> | null;
  }

  /**
   * 409s on the ref/tree reads until seeded through the Contents API — same
   * shape publish-commit.test.ts's "a repository with no commits yet" uses
   * for commitFiles directly, one layer down from saveSource.
   */
  function emptyRepoRecorder(): { calls: Call[]; fetchImpl: typeof fetch } {
    const calls: Call[] = [];
    let seeded = false;
    const fetchImpl = (async (url: string, init: RequestInit = {}) => {
      const method = init.method ?? "GET";
      calls.push({ url, method, body: init.body ? (JSON.parse(init.body as string) as Record<string, unknown>) : null });
      if (url.startsWith("https://raw.githubusercontent.com/")) {
        return { ok: false, status: 404, json: async () => ({}), text: async () => "" } as Response;
      }
      if (url.includes("/repos/") && !url.includes("/git/") && !url.includes("/contents/")) {
        return { ok: true, status: 200, json: async () => ({ private: false, default_branch: "main" }), text: async () => "" } as Response;
      }
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

  const repo = { owner: "hmelberg", repo: "kurs" };

  it("seeds the .yaml first, never the manifest — an interruption there must not leave the manifest naming a file that was never written", async () => {
    const { calls, fetchImpl } = emptyRepoRecorder();
    const out = await saveSource({
      title: "Ricardo on trade",
      text: "title: Ricardo\ncommands: []\n",
      existing: null,
      dir: "casts",
      repo,
      token: "t",
      fetchImpl,
    });
    const seed = calls.find((c) => c.url.includes("/contents/") && c.method === "PUT")!;
    expect(seed.url).toContain("/contents/casts/sources/ricardo-on-trade.yaml");
    expect(seed.url).not.toContain("index.json");
    expect(out.path).toBe("casts/sources/ricardo-on-trade.yaml");
  });
});
