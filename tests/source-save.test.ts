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
    await saveSource({
      title: "Ricardo on trade — revised",
      text: "title: Ricardo\ncommands: []\n",
      existing: "casts/sources/ricardo-on-trade.yaml",
      dir: "casts",
      repo,
      token: "t",
      fetchImpl,
    });
    const treeCalls = calls.filter((c) => c.url.includes("/git/trees") && c.method === "POST");
    const manifestFile = treeCalls[0].body!.tree as { path: string; content: string }[];
    const manifestContent = manifestFile.find((f) => f.path === "casts/sources/index.json")!.content;
    const manifest = JSON.parse(manifestContent) as SourceManifest;
    expect(manifest.sources).toHaveLength(1);
    expect(manifest.sources[0].title).toBe("Ricardo on trade — revised");
  });
});
