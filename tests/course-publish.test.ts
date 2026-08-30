import { describe, expect, it } from "vitest";
import { parseCourse } from "../src/course/document";
import { buildPublishPlan, publishCourse, type PlanArgs } from "../src/course/publish";
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

const args = (over: Partial<PlanArgs> = {}): PlanArgs => ({
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
    expect(buildPublishPlan(args()).files.map((f) => f.path).sort()).toEqual([
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

  it("never mints a name that collides with a permanent one", () => {
    const text = TEXT.replace("## Potential outcomes", "## DiD");
    const plan = buildPublishPlan(args({ course: parseCourse(text), text }));
    expect(plan.fileOf.get(0)).toBe("did-2.yaml");
    expect(plan.fileOf.get(1)).toBe("did.yaml");
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

  it("deletes a file the course used to publish and no longer does", () => {
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

// ---- the orchestration ----------------------------------------------------

interface Recorded {
  url: string;
  body: Record<string, unknown> | null;
}

function fakeGithub(opts: { manifest?: string; branch?: string } = {}): {
  seen: Recorded[];
  fetchImpl: typeof fetch;
} {
  const seen: Recorded[] = [];
  const fetchImpl = (async (url: string, init: RequestInit = {}) => {
    seen.push({ url, body: init.body ? (JSON.parse(init.body as string) as Record<string, unknown>) : null });
    if (url.includes("raw.githubusercontent.com")) {
      return opts.manifest !== undefined
        ? ({ ok: true, status: 200, text: async () => opts.manifest } as Response)
        : ({ ok: false, status: 404, text: async () => "" } as Response);
    }
    const body = /\/repos\/[^/]+\/[^/]+$/.test(url)
      ? { private: false, default_branch: opts.branch ?? "main" }
      : url.includes("/git/ref/")
        ? { object: { sha: "refsha" } }
        : url.includes("/git/commits/")
          ? { tree: { sha: "treesha" } }
          : { sha: "new" };
    return { ok: true, status: 200, json: async () => body, text: async () => "" } as Response;
  }) as unknown as typeof fetch;
  return { seen, fetchImpl };
}

const publishArgs = { text: TEXT, repo: { owner: "o", repo: "r" }, token: "t", coursesDir: "courses", viewerBase: "https://drawcast.app/", lectureYaml: (i: number) => (i < 2 ? `title: ${i}` : null) };

describe("publishCourse", () => {
  it("records each published file name back into the document", async () => {
    const { fetchImpl } = fakeGithub();
    const out = await publishCourse({ ...publishArgs, fetchImpl });
    expect(out.text).toContain("file: potential-outcomes.yaml");
    expect(out.text).toContain("file: did.yaml");
  });

  it("publishes a document that already carries the names, so the repo copy matches", async () => {
    const { seen, fetchImpl } = fakeGithub();
    await publishCourse({ ...publishArgs, fetchImpl });
    const tree = seen.find((s) => s.url.includes("/git/trees"))!.body!.tree as { path: string; content?: string }[];
    const md = tree.find((t) => t.path.endsWith("course.md"))!;
    expect(md.content).toContain("file: potential-outcomes.yaml");
  });

  it("commits to the repo's own default branch", async () => {
    const { seen, fetchImpl } = fakeGithub({ branch: "trunk" });
    const out = await publishCourse({ ...publishArgs, fetchImpl });
    expect(out.defaultBranch).toBe("trunk");
    expect(seen.some((s) => s.url.includes("/git/refs/heads/trunk"))).toBe(true);
  });

  it("merges into an existing manifest rather than replacing it", async () => {
    const manifest = JSON.stringify({ courses: [{ slug: "stats", title: "Stats", files: [], updated: "1" }] });
    const { seen, fetchImpl } = fakeGithub({ manifest });
    await publishCourse({ ...publishArgs, fetchImpl });
    const tree = seen.find((s) => s.url.includes("/git/trees"))!.body!.tree as { path: string; content?: string }[];
    const json = tree.find((t) => t.path === "courses/courses.json")!;
    expect(json.content).toContain("stats");
    expect(json.content).toContain("causal-inference");
  });

  it("survives a repo with no manifest yet", async () => {
    const { fetchImpl } = fakeGithub();
    await expect(publishCourse({ ...publishArgs, fetchImpl })).resolves.toBeTruthy();
  });

  it("refuses a private repo before writing anything", async () => {
    const fetchImpl = (async (url: string) =>
      /\/repos\/[^/]+\/[^/]+$/.test(url)
        ? ({ ok: true, status: 200, json: async () => ({ private: true, default_branch: "main" }), text: async () => "" } as Response)
        : ({ ok: true, status: 200, json: async () => ({}), text: async () => "" } as Response)) as unknown as typeof fetch;
    await expect(publishCourse({ ...publishArgs, fetchImpl })).rejects.toThrow(/public/);
  });
});
