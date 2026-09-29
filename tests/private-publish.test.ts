// Registry delivery 2, task 10: publishing a PRIVATE course or drawcast.
// Review Focus #1 — no path may commit a plaintext lecture, a poster, or
// narration outside the envelope. The lock runs over every lecture file of
// the plan BEFORE the one commit; any failure means nothing is committed.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { commitPublish, preparePublish, type PublishArgs } from "../src/course/publish";
import { publishCast } from "../src/publish/cast";
import { LOCK_HEADER, lockText } from "../src/crypto/lecture-lock";

const TEXT = `# Causal Inference
enroll: https://drawcast.anvil.app
private: true
---
## Potential outcomes
What is a counterfactual?
status: done · id: a1
---
## Difference-in-differences
What breaks parallel trends?
status: done · id: b2 · file: did.yaml
---
## Regression discontinuity
Where is the cutoff?
status: done · id: c3
`;

interface Recorded {
  url: string;
  body: Record<string, unknown> | null;
}

function fakeGithub(existing: string[] = []): { seen: Recorded[]; fetchImpl: typeof fetch } {
  const seen: Recorded[] = [];
  const fetchImpl = (async (url: string, init: RequestInit = {}) => {
    seen.push({ url, body: init.body ? (JSON.parse(init.body as string) as Record<string, unknown>) : null });
    if (url.includes("raw.githubusercontent.com")) return { ok: false, status: 404, text: async () => "" } as Response;
    const body = /\/repos\/[^/]+\/[^/]+$/.test(url)
      ? { private: false, default_branch: "main" }
      : url.includes("/git/ref/")
        ? { object: { sha: "refsha" } }
        : url.includes("/git/commits/")
          ? { tree: { sha: "treesha" } }
          : url.includes("/git/trees/")
            ? { tree: existing.map((path) => ({ path, sha: `old-${path}`, type: "blob" })) }
            : { sha: "new" };
    return { ok: true, status: 200, json: async () => body, text: async () => "" } as Response;
  }) as unknown as typeof fetch;
  return { seen, fetchImpl };
}

const isWrite = (url: string) => /\/git\/(blobs|trees|commits|refs)|\/contents\//.test(url);

/** Every committed file, path → text, read from the tree the commit wrote. */
function committed(seen: Recorded[]): Map<string, string> {
  const blobs = new Map<string, string>();
  const blobBodies = seen.filter((s) => s.url.endsWith("/git/blobs")).map((s) => Buffer.from(s.body!.content as string, "base64").toString("utf8"));
  const tree = seen.find((s) => /\/git\/trees$/.test(s.url))!.body!.tree as { path: string; sha: string | null }[];
  // The fake answers every blob with sha "new", so pair tree entries with
  // blob bodies by order (commitFiles uploads in file order).
  tree.filter((t) => t.sha !== null).forEach((t, i) => blobs.set(t.path, blobBodies[i]));
  return blobs;
}

/** Paths the commit's tree removes (a null sha). */
function removed(seen: Recorded[]): string[] {
  const tree = seen.find((s) => /\/git\/trees$/.test(s.url))!.body!.tree as { path: string; sha: string | null }[];
  return tree.filter((t) => t.sha === null).map((t) => t.path);
}

const fakeLock = async (path: string, text: string): Promise<string> => `${LOCK_HEADER}\nitem: o/r/x\nfor: ${path}\nlen: ${text.length}\n`;

const courseArgs = (over: Partial<PublishArgs> = {}): PublishArgs => ({
  text: TEXT,
  repo: { owner: "o", repo: "r" },
  token: "t",
  coursesDir: "courses",
  viewerBase: "https://drawcast.app/",
  lectureYaml: (i: number) => `title: lecture ${i}\n`,
  poster: async () => new Uint8Array([1, 2, 3]),
  ...over,
});

describe("a private course publish", () => {
  it("commits every lecture locked, the page and indexes plain, no poster, and the page's Join door at the free name", async () => {
    const { seen, fetchImpl } = fakeGithub();
    const args = courseArgs({ fetchImpl, lock: fakeLock });
    const prepared = await preparePublish(args);
    await commitPublish(args, prepared, { name: "causal-free", app: "https://drawcast.app/" });
    const files = committed(seen);
    const lectures = ["courses/causal-inference/potential-outcomes.yaml", "courses/causal-inference/did.yaml", "courses/causal-inference/regression-discontinuity.yaml"];
    for (const p of lectures) expect(files.get(p)?.startsWith(LOCK_HEADER)).toBe(true);
    for (const p of ["courses/causal-inference/course.md", "courses/causal-inference/index.html", "courses/causal-inference/README.md", "courses/courses.json"]) {
      expect(files.get(p)).toBeDefined();
      expect(files.get(p)!.startsWith(LOCK_HEADER)).toBe(false);
    }
    expect(files.get("courses/causal-inference/course.md")).toContain("private: true");
    expect([...files.keys()].some((p) => p.endsWith(".png"))).toBe(false);
    // No committed file carries a lecture's plaintext.
    for (const text of files.values()) expect(text).not.toContain("title: lecture 0");
    const page = files.get("courses/causal-inference/index.html")!;
    const door = /href="([^"]*&amp;join|[^"]*&join)"/.exec(page)?.[1] ?? "";
    expect(door.replace("&amp;", "&").endsWith("#causal-free&join")).toBe(true);
  });

  it("a lock that fails on the 2nd lecture commits nothing and says why", async () => {
    const { seen, fetchImpl } = fakeGithub();
    let calls = 0;
    const lock = async (path: string, text: string) => {
      calls += 1;
      if (calls === 2) throw new Error("bad-key");
      return fakeLock(path, text);
    };
    const args = courseArgs({ fetchImpl, lock });
    const prepared = await preparePublish(args);
    await expect(commitPublish(args, prepared)).rejects.toThrow(/^Not published: could not lock the lectures \(bad-key\)/);
    expect(seen.some((s) => isWrite(s.url))).toBe(false);
  });

  it("a lock that returns plaintext is caught before the commit", async () => {
    const { seen, fetchImpl } = fakeGithub();
    const args = courseArgs({ fetchImpl, lock: async (_p, t) => t });
    const prepared = await preparePublish(args);
    await expect(commitPublish(args, prepared)).rejects.toThrow(/Not published: could not lock the lectures/);
    expect(seen.some((s) => isWrite(s.url))).toBe(false);
  });
});

const castArgs = {
  title: "Difference-in-differences",
  text: "title: DiD\ncommands: []\n",
  repo: { owner: "o", repo: "r" },
  token: "t",
  castsDir: "casts",
  viewerBase: "https://drawcast.app",
  poster: new Uint8Array([1, 2, 3]),
};

describe("a private cast publish", () => {
  it("commits the cast locked and no poster", async () => {
    const { seen, fetchImpl } = fakeGithub();
    await publishCast({ ...castArgs, fetchImpl, lock: fakeLock });
    const files = committed(seen);
    expect(files.get("casts/difference-in-differences.yaml")?.startsWith(LOCK_HEADER)).toBe(true);
    expect(files.get("casts/difference-in-differences.yaml")).toContain("for: casts/difference-in-differences.yaml");
    expect(files.get("casts/casts.json")!.startsWith(LOCK_HEADER)).toBe(false);
    expect([...files.keys()].some((p) => p.endsWith(".png"))).toBe(false);
    for (const text of files.values()) expect(text).not.toContain("title: DiD");
  });

  it("a public cast still commits its poster", async () => {
    const { seen, fetchImpl } = fakeGithub();
    await publishCast({ ...castArgs, fetchImpl });
    expect(seen.some((s) => /\/git\/trees$/.test(s.url) && JSON.stringify(s.body).includes("difference-in-differences.png"))).toBe(true);
  });

  it("a lock failure commits nothing", async () => {
    const { seen, fetchImpl } = fakeGithub();
    await expect(
      publishCast({
        ...castArgs,
        fetchImpl,
        lock: async () => {
          throw new Error("bad-item");
        },
      }),
    ).rejects.toThrow(/^Not published: could not lock the lectures \(bad-item\)/);
    expect(seen.some((s) => isWrite(s.url))).toBe(false);
  });
});

describe("locking is deterministic", () => {
  it("the same lecture locked twice gives the same committed bytes — an unchanged private lecture is not re-uploaded", async () => {
    const key = Buffer.alloc(32, 7).toString("base64url");
    const a = await lockText("title: T\ncommands: []\n", key, "o/r/courses/c");
    const b = await lockText("title: T\ncommands: []\n", key, "o/r/courses/c");
    expect(a).toBe(b);
    expect(a.startsWith(LOCK_HEADER)).toBe(true);
  });
});

describe("the private publish paths fetch the key and re-quote before committing", () => {
  const between = (src: string, start: string, end: string) => src.slice(src.indexOf(start), src.indexOf(end, src.indexOf(start)));
  it("main.ts publishDrawcast", () => {
    const src = readFileSync("src/main.ts", "utf8");
    const body = between(src, "async function publishDrawcast(", "\n}\n");
    const commit = body.indexOf("publishCast(");
    expect(commit).toBeGreaterThan(0);
    // The quote and the key live in privateCastLock, which publishDrawcast
    // awaits (and returns on a refusal) before it ever reaches publishCast.
    expect(body.indexOf("await privateCastLock(")).toBeGreaterThan(0);
    expect(body.indexOf("await privateCastLock(")).toBeLessThan(commit);
    expect(body).toContain("lock,");
    expect(body).toContain("Published locked — only enrolled learners can watch.");
    const helper = between(src, "async function privateCastLock(", "\n}\n");
    expect(helper.indexOf("quotePrivate(")).toBeGreaterThan(0);
    expect(helper.indexOf("quote.due > 0")).toBeGreaterThan(helper.indexOf("quotePrivate("));
    expect(helper.indexOf("fetchItemKey(")).toBeGreaterThan(helper.indexOf("quote.due > 0"));
    expect(helper).toContain("lockText(");
  });
  it("ui/course.ts publish", () => {
    const src = readFileSync("src/ui/course.ts", "utf8");
    const body = between(src, "async function publish(", "\n  }\n");
    const commit = body.indexOf("commitPublish(");
    expect(commit).toBeGreaterThan(0);
    expect(body.indexOf("quotePrivate(")).toBeGreaterThan(0);
    expect(body.indexOf("quotePrivate(")).toBeLessThan(commit);
    expect(body.indexOf("fetchItemKey(")).toBeGreaterThan(0);
    expect(body.indexOf("fetchItemKey(")).toBeLessThan(commit);
    expect(body).toContain("lockText(");
    expect(body).toContain("applyJoinDoor(");
    expect(body).toContain('setCourseOption(');
    expect(body).toContain("Published locked — only enrolled learners can watch.");
  });
  it("ui/course.ts seeds Share's Private box from the course document", () => {
    const src = readFileSync("src/ui/course.ts", "utf8");
    expect(src).toMatch(/private: course\.private/);
  });
});

describe("a private publish removes posters an earlier public publish left", () => {
  it("course: a lecture's .png in the repo is deleted; one that is not there is not asked for", async () => {
    const { seen, fetchImpl } = fakeGithub(["courses/causal-inference/did.png", "courses/causal-inference/other.png"]);
    const args = courseArgs({ fetchImpl, lock: fakeLock });
    await commitPublish(args, await preparePublish(args), { name: "causal-free", app: "https://drawcast.app/" });
    expect(removed(seen)).toContain("courses/causal-inference/did.png");
    expect(removed(seen)).not.toContain("courses/causal-inference/potential-outcomes.png");
    expect(removed(seen)).not.toContain("courses/causal-inference/other.png");
  });
  it("course: a public publish deletes no poster", async () => {
    const { seen, fetchImpl } = fakeGithub(["courses/causal-inference/did.png"]);
    const args = courseArgs({ fetchImpl });
    await commitPublish(args, await preparePublish(args));
    expect(removed(seen)).not.toContain("courses/causal-inference/did.png");
  });
  it("cast: its .png in the repo is deleted", async () => {
    const { seen, fetchImpl } = fakeGithub(["casts/difference-in-differences.png"]);
    await publishCast({ ...castArgs, fetchImpl, lock: fakeLock });
    expect(removed(seen)).toEqual(["casts/difference-in-differences.png"]);
  });
});

describe("one prediction of a private cast's target (Share's quote and the publish agree)", () => {
  it("a retitled cast with an empty Name field keeps its published slug in both", async () => {
    const { privateCastTarget } = await import("../src/publish/cast");
    const { privateRequest } = await import("../src/ui/share");
    const repo = { owner: "o", repo: "r" };
    const doc = { title: "A brand new title", publishedAs: "old-slug", folder: undefined, lectureCount: undefined };
    const shared = privateRequest(doc, { githubRepo: "o/r", coursesDir: "" }, "drawcast", "");
    const own = privateCastTarget(repo, "casts", "", "old-slug", "A brand new title");
    expect(own.target).toBe("o/r/casts/old-slug.yaml");
    expect(own.item).toBe("o/r/casts/old-slug");
    expect(shared?.target).toBe(own.target);
    const src = readFileSync("src/main.ts", "utf8");
    expect(src).toContain("privateCastTarget(");
  });
});

describe("private items never go anywhere unlocked", () => {
  const main = readFileSync("src/main.ts", "utf8");
  const fn = (name: string) => main.slice(main.indexOf(`async function ${name}(`), main.indexOf("\n}\n", main.indexOf(`async function ${name}(`)));
  it("Save source refuses a private drawcast before anything is written", () => {
    const body = fn("saveSourceToGithub");
    const guard = body.indexOf("if (isPrivateDoc())");
    expect(guard).toBeGreaterThan(0);
    expect(guard).toBeLessThan(body.indexOf("saveSource("));
    expect(body).toContain("This drawcast is private — Save source would put it on GitHub unencrypted. Publish it (locked) instead.");
  });
  it("the drawcast server and Google Drive publishes refuse a private drawcast", () => {
    for (const [name, write] of [["publishServerCast", "publishToServer("], ["publishDriveCast", "saveSpec("]]) {
      const body = fn(name);
      const guard = body.indexOf("if (isPrivateDoc())");
      expect(guard, name).toBeGreaterThan(0);
      expect(guard, name).toBeLessThan(body.indexOf(write));
      expect(body).toContain("PRIVATE_ELSEWHERE");
    }
    expect(main).toContain('"This is private — publish it to GitHub, where it is locked."');
  });
  it("a private course refuses a custom enroll: server and a door with no name, before the commit", () => {
    const course = readFileSync("src/ui/course.ts", "utf8");
    const body = course.slice(course.indexOf("async function publish("), course.indexOf("function showLinks("));
    const commit = body.indexOf("await commitPublish(");
    const custom = body.indexOf("A private course joins through drawcast.app — remove the custom enroll: line to publish it privately.");
    const nameless = body.indexOf("Not published: the course's link isn't registered yet — try again in a minute.");
    expect(custom).toBeGreaterThan(0);
    expect(custom).toBeLessThan(commit);
    expect(nameless).toBeGreaterThan(0);
    expect(nameless).toBeLessThan(commit);
  });
});
