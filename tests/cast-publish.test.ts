// Publishing ONE drawcast, as opposed to a whole course.
//
// Shares commitFiles, preflight and slugFor with the course path and adds no
// new publishing machinery. It keeps its own index file rather than a key in
// courses.json, deliberately: parseManifest rebuilds {courses} and drops every
// other key, so anything stored beside it would be erased by the next course
// publish (design §5).
import { describe, expect, test, beforeAll, afterAll } from "vitest";
import { setPublishesCast } from "../src/cast-file";
import { buildCastPlan, emptyCastIndex, parseCastIndex, upsertCast } from "../src/publish/cast";

// The .yaml generation of publishing: these pin slugs, doors, links and locks,
// which are the same either way; the .cast names are tests/cast-files.test.ts's.
beforeAll(() => setPublishesCast(false));
afterAll(() => setPublishesCast(true));

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

  // B3's Link panel always sends an explicit `slug` (the name field's own
  // value, prefilled — never blank), so this is no longer a hypothetical: a
  // FIRST publish (no `previousSlug` — this document has never published
  // before) can request a name another cast already owns, e.g. because two
  // documents share a title and neither author edited the field. Fix round 1:
  // `buildCastPlan` must never let a bare `slug` request clobber an entry it
  // does not already own — only `previousSlug === slug` may keep a taken name.
  test("first publish requesting an already-taken slug is uniquified, not overwritten", () => {
    const index = upsertCast(emptyCastIndex(), { slug: "regression", title: "Someone else's regression cast", file: "regression.yaml", updated: "2026-08-31" });
    const plan = buildCastPlan({ ...base, title: "Regression", slug: "regression", index });
    expect(plan.slug).toBe("regression-2");
    // The other cast's entry survives untouched — the new one never claims its slug.
    const json = plan.files.find((f) => f.path === "casts/casts.json")!.content;
    const casts = parseCastIndex(json).casts;
    expect(casts.find((c) => c.slug === "regression")?.title).toBe("Someone else's regression cast");
    expect(casts.find((c) => c.slug === "regression-2")?.title).toBe("Regression");
  });

  test("republishing the SAME drawcast under its own unedited slug keeps it rather than minting -2", () => {
    const index = upsertCast(emptyCastIndex(), { slug: "regression", title: "Regression", file: "regression.yaml", updated: "2026-08-31" });
    // `previousSlug` is what makes this a republish of the SAME drawcast
    // rather than a rename colliding with someone else's "regression" —
    // Link's field is prefilled with `previousSlug`, so an untouched
    // republish always sends the two equal, exactly as here.
    expect(buildCastPlan({ ...base, title: "Regression", slug: "regression", previousSlug: "regression", index }).slug).toBe("regression");
  });

  test("a rename to a FREE slug still mints the new file — the old entry is untouched", () => {
    const index = upsertCast(emptyCastIndex(), { slug: "old-name", title: "Old title", file: "old-name.yaml", updated: "2026-08-31" });
    const plan = buildCastPlan({ ...base, title: "New title", slug: "new-name", previousSlug: "old-name", index });
    expect(plan.slug).toBe("new-name");
    expect(plan.files.some((f) => f.path === "casts/new-name.yaml")).toBe(true);
    // publishCast never deletes (see the file's own top comment) — the old
    // slug's entry is still in the index this plan writes.
    const json = plan.files.find((f) => f.path === "casts/casts.json")!.content;
    expect(parseCastIndex(json).casts.map((c) => c.slug).sort()).toEqual(["new-name", "old-name"]);
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

describe("the cast's own page (standalone/page.ts)", () => {
  test("a public publish writes <slug>.html beside the cast: a door to it, naming its GitHub copy", () => {
    const plan = buildCastPlan({ ...base, poster: new Uint8Array([1]) });
    const page = plan.files.find((f) => f.path === "casts/difference-in-differences.html");
    expect(page).toBeDefined();
    // The .cast stays the one copy: the page points at it and preloads it.
    expect(page!.content).toContain('data-src="difference-in-differences.yaml"');
    expect(page!.content).toContain('<link rel="preload" href="difference-in-differences.yaml" as="fetch" crossorigin>');
    expect(page!.content).not.toContain(base.text);
    expect(page!.content).toContain('data-gh="hmelberg/kurs/casts/difference-in-differences.yaml"');
    expect(page!.content).toContain('<script type="module" src="https://drawcast.app/play.js" crossorigin>');
    expect(page!.content).toContain('content="https://hmelberg.github.io/kurs/casts/difference-in-differences.png"');
    expect(plan.pageUrl).toBe("https://hmelberg.github.io/kurs/casts/difference-in-differences.html");
  });

  test("the door carries the spoken lines as its Transcript, for crawlers and screen readers", () => {
    const text = "title: T\nelements: []\ncommands:\n  - speak: Prices rise when demand rises.\n  - speak: Supply <then> catches up.\n";
    const page = buildCastPlan({ ...base, text }).files.find((f) => f.path.endsWith("difference-in-differences.html"))!;
    expect(page.content).toContain('<details id="drawcast-transcript">');
    expect(page.content).toContain("<p>Prices rise when demand rises.</p>");
    expect(page.content).toContain("<p>Supply &lt;then&gt; catches up.</p>");
  });

  test("a private publish gets no page — it would carry the cast unlocked", () => {
    const plan = buildCastPlan({ ...base, private: true });
    expect(plan.files.some((f) => f.path.endsWith(".html") && f.path !== "casts/index.html")).toBe(false);
    expect(plan.pageUrl).toBeUndefined();
  });

  test("no poster, no picture in the link card", () => {
    const page = buildCastPlan(base).files.find((f) => f.path.endsWith("difference-in-differences.html"))!;
    expect(page.content).not.toContain("og:image");
  });
});

describe("the casts index page", () => {
  test("links each cast by its full repo path, folder included", () => {
    const index = buildCastPlan(base).files.find((f) => f.path === "casts/index.html")!;
    expect(index.content).toContain("#gh=hmelberg/kurs/casts/difference-in-differences.yaml");
  });
  test("a repo-root cast has no folder to add", () => {
    const index = buildCastPlan({ ...base, castsDir: "" }).files.find((f) => f.path === "index.html")!;
    expect(index.content).toContain("#gh=hmelberg/kurs/difference-in-differences.yaml");
  });
});
