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
      "courses/README.md",
      "courses/causal-inference/README.md",
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
    // Content travels as blobs now (the 422 too-large fix) — find the blob
    // whose decoded body is the course document.
    const blobs = seen.filter((s) => s.url.includes("/git/blobs")).map((s) => Buffer.from(s.body!.content as string, "base64").toString("utf8"));
    expect(blobs.some((b) => b.includes("file: potential-outcomes.yaml"))).toBe(true);
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
    const blobs = seen.filter((s) => s.url.includes("/git/blobs")).map((s) => Buffer.from(s.body!.content as string, "base64").toString("utf8"));
    const json = blobs.find((b) => b.includes('"courses"'))!;
    expect(json).toContain("stats");
    expect(json).toContain("causal-inference");
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

describe("publishing at the repository root", () => {
  it("gives each course its own folder without an extra level", () => {
    const plan = buildPublishPlan(args({ coursesDir: "" }));
    expect(plan.files.map((f) => f.path).sort()).toEqual([
      ".nojekyll",
      "README.md",
      "causal-inference/README.md",
      "causal-inference/course.md",
      "causal-inference/did.yaml",
      "causal-inference/index.html",
      "causal-inference/potential-outcomes.yaml",
      "courses.json",
      "index.html",
    ]);
  });

  it("points the course URL at the root folder", () => {
    const plan = buildPublishPlan(args({ coursesDir: "" }));
    expect(plan.courseUrl).toBe("https://o.github.io/r/causal-inference/");
    expect(plan.pagesUrl).toBe("https://o.github.io/r/");
  });

  it("links lectures without a doubled slash", () => {
    const page = buildPublishPlan(args({ coursesDir: "" })).files.find((f) => f.path === "causal-inference/index.html")!;
    expect(page.content).toContain("#gh=o/r/causal-inference/did.yaml");
    expect(page.content).not.toContain("//causal-inference");
  });
});

describe("GitHub Pages", () => {
  it("disables Jekyll when the repo is ours to shape", () => {
    expect(buildPublishPlan(args({ coursesDir: "" })).files.map((f) => f.path)).toContain(".nojekyll");
  });

  it("leaves the root alone when publishing into a subfolder of someone else's repo", () => {
    expect(buildPublishPlan(args({ coursesDir: "courses" })).files.map((f) => f.path)).not.toContain(".nojekyll");
  });

  it("gives every course its own page under one Pages site", () => {
    const a = buildPublishPlan(args({ coursesDir: "" }));
    expect(a.courseUrl).toBe("https://o.github.io/r/causal-inference/");
    expect(a.pagesUrl).toBe("https://o.github.io/r/");
  });
});

describe("the folder name", () => {
  const long = `# Causal inference in economics: evidence from health and health care\n---\n## A\nQ?\nstatus: done · id: a1\n`;

  it("cuts a long course title at a word boundary", () => {
    const plan = buildPublishPlan(args({ course: parseCourse(long), text: long, coursesDir: "" }));
    expect(plan.slug).toBe("causal-inference-in-economics-evidence");
    expect(plan.slug.length).toBeLessThanOrEqual(40);
  });

  it("lets the document name the folder itself", () => {
    const chosen = long.replace("care\n", "care\nslug: causal\n");
    expect(buildPublishPlan(args({ course: parseCourse(chosen), text: chosen })).slug).toBe("causal");
  });

  it("keeps the recorded slug when the course is retitled, so nothing is orphaned", () => {
    const renamed = `# A completely different name\nslug: causal\n---\n## A\nQ?\nstatus: done · id: a1\n`;
    expect(buildPublishPlan(args({ course: parseCourse(renamed), text: renamed })).slug).toBe("causal");
  });
});

describe("the README GitHub renders itself", () => {
  it("links each published lecture", () => {
    const readme = buildPublishPlan(args()).files.find((f) => f.path.endsWith("causal-inference/README.md"))!;
    expect(readme.content).toContain("[Difference-in-differences](https://drawcast.app/#gh=o/r/courses/causal-inference/did.yaml)");
  });

  it("marks an ungenerated lecture instead of linking it", () => {
    const readme = buildPublishPlan(args()).files.find((f) => f.path.endsWith("causal-inference/README.md"))!;
    expect(readme.content).toContain("Not made yet — *not published yet*");
  });

  it("points at github.com, which needs no Pages", () => {
    expect(buildPublishPlan(args()).readmeUrl).toBe("https://github.com/o/r/tree/HEAD/courses/causal-inference");
  });

  it("lists every course at the top level", () => {
    const readme = buildPublishPlan(args()).files.find((f) => f.path === "courses/README.md")!;
    expect(readme.content).toContain("[Causal Inference](causal-inference/)");
  });
});

describe("recording the slug", () => {
  it("writes it into the document on the first publish", async () => {
    const { fetchImpl } = fakeGithub();
    const out = await publishCourse({ ...publishArgs, fetchImpl });
    expect(out.text).toContain("slug: causal-inference");
  });

  it("does not rewrite one the document already carries", async () => {
    const { fetchImpl } = fakeGithub();
    const chosen = TEXT.replace("# Causal Inference\n", "# Causal Inference\nslug: mine\n");
    const out = await publishCourse({ ...publishArgs, text: chosen, fetchImpl });
    expect(out.text).toContain("slug: mine");
    expect(out.text).not.toContain("slug: causal-inference");
  });
});
