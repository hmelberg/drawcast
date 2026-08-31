// Publishing ONE drawcast, as opposed to a whole course.
//
// Shares commitFiles, preflight and slugFor with the course path and adds no
// new publishing machinery. It keeps its own index file rather than a key in
// courses.json, deliberately: parseManifest rebuilds {courses} and drops every
// other key, so anything stored beside it would be erased by the next course
// publish (design §5).
import { describe, expect, test } from "vitest";
import { buildCastPlan, emptyCastIndex, parseCastIndex, upsertCast } from "../src/publish/cast";

const repo = { owner: "hmelberg", repo: "kurs" };
const base = {
  title: "Difference-in-differences",
  text: "title: DiD\ncommands: []\n",
  repo,
  castsDir: "casts",
  viewerBase: "https://drawcast.app",
  index: emptyCastIndex(),
};

describe("buildCastPlan", () => {
  test("writes the drawcast, an index page and the index file", () => {
    const plan = buildCastPlan(base);
    const paths = plan.files.map((f) => f.path).sort();
    expect(paths).toContain("casts/difference-in-differences.yaml");
    expect(paths).toContain("casts/index.html");
    expect(paths).toContain("casts/README.md");
    expect(paths).toContain("casts/casts.json");
  });

  test("the drawcast's text is published verbatim, audio and all", () => {
    const text = "title: T\ncommands: []\n---\naudio:\n  lang: en\n  lines: {}\n";
    const plan = buildCastPlan({ ...base, text });
    expect(plan.files.find((f) => f.path.endsWith(".yaml"))!.content).toBe(text);
  });

  test("the viewer link points at the published file", () => {
    expect(buildCastPlan(base).castUrl).toBe("https://drawcast.app/#gh=hmelberg/kurs/casts/difference-in-differences.yaml");
  });

  test("a recorded slug is permanent — retitling must not orphan a shared link", () => {
    const plan = buildCastPlan({ ...base, title: "A completely new title", slug: "difference-in-differences" });
    expect(plan.slug).toBe("difference-in-differences");
    expect(plan.files.some((f) => f.path === "casts/difference-in-differences.yaml")).toBe(true);
  });

  test("a new drawcast never takes a slug another one already holds", () => {
    const index = upsertCast(emptyCastIndex(), { slug: "regression", title: "Regression", file: "regression.yaml", updated: "2026-08-31" });
    expect(buildCastPlan({ ...base, title: "Regression", index }).slug).toBe("regression-2");
  });

  test("republishing the SAME drawcast keeps its slug rather than minting -2", () => {
    const index = upsertCast(emptyCastIndex(), { slug: "regression", title: "Regression", file: "regression.yaml", updated: "2026-08-31" });
    expect(buildCastPlan({ ...base, title: "Regression", slug: "regression", index }).slug).toBe("regression");
  });

  test("the index lists every cast, the new one included", () => {
    const index = upsertCast(emptyCastIndex(), { slug: "regression", title: "Regression", file: "regression.yaml", updated: "2026-08-31" });
    const plan = buildCastPlan({ ...base, index });
    const json = plan.files.find((f) => f.path === "casts/casts.json")!.content;
    expect(parseCastIndex(json).casts.map((c) => c.slug).sort()).toEqual(["difference-in-differences", "regression"]);
  });

  test("publishing at the repo root adds .nojekyll, in a subfolder it does not", () => {
    // Jekyll rewrites and skips files by its own rules; these pages want
    // serving verbatim. But a repo we publish into a SUBFOLDER of may be
    // someone's Jekyll site, and this file at its root would break it.
    expect(buildCastPlan({ ...base, castsDir: "" }).files.some((f) => f.path === ".nojekyll")).toBe(true);
    expect(buildCastPlan(base).files.some((f) => f.path === ".nojekyll")).toBe(false);
  });

  test("an untitled drawcast still gets a usable file name", () => {
    expect(buildCastPlan({ ...base, title: "" }).slug).toBe("lecture");
  });

  test("it never publishes into a course's folder", () => {
    // Casts and courses share a repo. A cast writing outside casts/ could
    // overwrite a lecture, and removedPaths would then delete it.
    for (const f of buildCastPlan(base).files) {
      expect(f.path === ".nojekyll" || f.path.startsWith("casts/")).toBe(true);
    }
  });
});

describe("the cast index", () => {
  test("a missing or damaged index starts a fresh one rather than throwing", () => {
    expect(parseCastIndex("")).toEqual(emptyCastIndex());
    expect(parseCastIndex("{ not json")).toEqual(emptyCastIndex());
    expect(parseCastIndex('{"casts":"nope"}')).toEqual(emptyCastIndex());
  });

  test("upsert replaces by slug rather than appending a duplicate", () => {
    const one = upsertCast(emptyCastIndex(), { slug: "a", title: "First", file: "a.yaml", updated: "2026-08-30" });
    const two = upsertCast(one, { slug: "a", title: "Renamed", file: "a.yaml", updated: "2026-08-31" });
    expect(two.casts).toHaveLength(1);
    expect(two.casts[0].title).toBe("Renamed");
  });
});
