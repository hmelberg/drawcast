import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import {
  DOC_EXT_RE,
  existingDoc,
  fileChanges,
  formatForName,
  lectureFileName,
  pageDoor,
  pagesUrlFor,
  parseGithubTarget,
  publishCastFromEnv,
  publishOrigin,
  stripDocExt,
  takenSlugs,
} from "../scripts/cast-github.mjs";
import { privateItemFor, registerFor } from "../scripts/cast-account.mjs";
import { DOC_EXT_RE as APP_DOC_EXT_RE, publishExt, publishName, setPublishesCast, stripDocExt as appStripDocExt } from "../src/cast-file";
import { slugFor } from "../src/publish/github";
import { coursePage, doorlessNote, type DoorlessReason } from "../src/course/page";
import { parseCourse } from "../src/course/document";

describe("parseGithubTarget (cast.mjs pull)", () => {
  const at = (owner: string, repo: string, branch: string | null, path: string) => ({ owner, repo, branch, path });
  it.each([
    ["https://www.drawcast.app/#gh=hmelberg/dcast/casts/twenty-players.yaml", at("hmelberg", "dcast", null, "casts/twenty-players.yaml")],
    ["https://github.com/hmelberg/dcast/tree/main/understanding-the-qaly", at("hmelberg", "dcast", "main", "understanding-the-qaly")],
    ["https://github.com/hmelberg/dcast/blob/main/understanding-the-qaly/a.yaml", at("hmelberg", "dcast", "main", "understanding-the-qaly/a.yaml")],
    ["https://github.com/hmelberg/dcast", at("hmelberg", "dcast", null, "")],
    ["https://raw.githubusercontent.com/hmelberg/dcast/main/casts/x.yaml", at("hmelberg", "dcast", "main", "casts/x.yaml")],
    ["https://hmelberg.github.io/dcast/understanding-the-qaly/", at("hmelberg", "dcast", null, "understanding-the-qaly")],
    ["https://hmelberg.github.io/dcast/understanding-the-qaly/index.html", at("hmelberg", "dcast", null, "understanding-the-qaly")],
    ["hmelberg/dcast/understanding-the-qaly", at("hmelberg", "dcast", null, "understanding-the-qaly")],
  ])("%s", (url, want) => expect(parseGithubTarget(url)).toEqual(want));

  it("refuses what is not a GitHub link", () => {
    expect(() => parseGithubTarget("https://example.com/x")).toThrow(/not a GitHub link/);
  });
});

describe("pageDoor reads back the door coursePage wrote (a push must not change it)", () => {
  const course = parseCourse("# A course\nenroll: https://drawcast.anvil.app\nslug: a-course\n\n---\n## One\nWhy?\n\n---\n## Two\nHow?\n");
  const links = course.lectures.map((l) => ({ title: l.title, questions: l.questions, href: null }));
  const reasons: DoorlessReason[] = ["signed-out", "taken", "short", "invalid", "owner", "elsewhere", "unreachable", "unregistered"];

  it("a door to a registered name", () => {
    const door = { name: "qaly", app: "https://www.drawcast.app/" };
    expect(pageDoor(coursePage(course, links, door), doorlessNote)).toEqual(door);
  });
  it("the name comes back clean even though coursePage's door link now ends &join (Task 8)", () => {
    const html = coursePage(course, links, { name: "qaly", app: "https://www.drawcast.app/" });
    expect(html).toContain('href="https://www.drawcast.app/#qaly&amp;join"');
    expect(pageDoor(html, doorlessNote)).toEqual({ name: "qaly", app: "https://www.drawcast.app/" });
  });
  it("still reads an OLDER page whose door link has no &join suffix", () => {
    const html = '<a class="door" href="https://www.drawcast.app/#qaly">Join this course in drawcast →</a>';
    expect(pageDoor(html, doorlessNote)).toEqual({ name: "qaly", app: "https://www.drawcast.app/" });
  });
  it.each(reasons)("doorless: %s", (why) => {
    expect(pageDoor(coursePage(course, links, { name: null, why }), doorlessNote)).toEqual({ name: null, why });
  });
  it("a page built with no door decision gives none back", () => {
    const html = coursePage(course, links, undefined);
    const again = pageDoor(html, doorlessNote);
    expect(coursePage(course, links, again)).toBe(html);
  });
  it("no page, no door", () => expect(pageDoor(null, doorlessNote)).toBeUndefined());
});

describe("publishOrigin (cast.mjs publish-target)", () => {
  const common = { owner: "ann", repo: "casts", branch: "main", base: "abc123", clone: "dev-casts/repos/ann__casts", viewerBase: "https://www.drawcast.app/", slugFor };

  it("a course goes in <dir>/<slug> with the pull shape", () => {
    const { origin, slug } = publishOrigin({ ...common, kind: "course", dir: "courses", slug: "qaly-basics", takenSlugs: [] });
    expect(slug).toBe("qaly-basics");
    expect(origin).toMatchObject({ kind: "course", owner: "ann", repo: "casts", branch: "main", base: "abc123", path: "courses/qaly-basics", coursesDir: "courses", lecture: null, published: "new" });
  });

  it("a course at the repo root has no leading slash", () => {
    expect(publishOrigin({ ...common, kind: "course", dir: "", slug: "q", takenSlugs: [] }).origin.path).toBe("q");
  });

  it("a slug already in the repo gets a fresh one — never overwrites", () => {
    const { slug, origin } = publishOrigin({ ...common, kind: "course", dir: "", slug: "qaly-basics", takenSlugs: ["qaly-basics"] });
    expect(slug).not.toBe("qaly-basics");
    expect(origin.path).toBe(slug);
  });

  it("a cast goes in <dir>/casts/<slug>.yaml", () => {
    const { origin } = publishOrigin({ ...common, kind: "cast", dir: "", slug: "twenty-players", takenSlugs: [] });
    expect(origin).toMatchObject({ kind: "cast", path: "casts/twenty-players.yaml", castsDir: "casts", file: "twenty-players.yaml" });
  });

  it("pagesUrlFor", () => {
    expect(pagesUrlFor("ann", "casts", "courses/q")).toBe("https://ann.github.io/casts/courses/q/");
  });
});

describe("takenSlugs (publish-target never overwrites)", () => {
  it("a course: the manifest's slugs, every name already in the folder, and casts", () => {
    const t = takenSlugs({ kind: "course", listed: ["qaly"], tree: ["hand-made", "README.md", "index.html", "courses.json"] });
    for (const s of ["qaly", "hand-made", "casts", "readme", "index", "courses"]) expect(t).toContain(s);
  });
  it("a cast: the index's slugs and every .yaml already in casts/", () => {
    const t = takenSlugs({ kind: "cast", listed: ["a"], tree: ["b.yaml", "c.yml", "casts.json", "README.md"] });
    expect(t).toEqual(expect.arrayContaining(["a", "b", "c"]));
  });
});

describe("fileChanges (cast.mjs push)", () => {
  const png = (n: number) => new Uint8Array([137, 80, 78, n]);
  const at = (files: Record<string, string | Uint8Array>) => (p: string) => (p in files ? Buffer.from(files[p] as string | Uint8Array) : null);

  it("text and pictures are compared by their bytes", () => {
    const files = [
      { path: "casts/a.yaml", content: "same" },
      { path: "casts/a.png", content: "", bytes: png(1) },
      { path: "casts/b.yaml", content: "new text" },
      { path: "casts/b.png", content: "", bytes: png(2) },
      { path: "casts/c.png", content: "", bytes: png(3) },
    ];
    const { changes, real } = fileChanges(files, [], at({ "casts/a.yaml": "same", "casts/a.png": png(1), "casts/b.yaml": "old text", "casts/b.png": png(9) }));
    expect(changes).toEqual([["changed", "casts/b.yaml"], ["changed", "casts/b.png"], ["new", "casts/c.png"]]);
    expect(real).toEqual(changes);
  });

  it("an identical redrawn picture is no change, so an unchanged cast is nothing to push", () => {
    const { changes, real } = fileChanges([{ path: "casts/a.yaml", content: "x" }, { path: "casts/a.png", content: "", bytes: png(1) }], [], at({ "casts/a.yaml": "x", "casts/a.png": png(1) }));
    expect(changes).toEqual([]);
    expect(real).toEqual([]);
  });

  it("a picture alone is a real change — pull then push adds pictures to an older repo", () => {
    const { real } = fileChanges([{ path: "q/01.yaml", content: "x" }, { path: "q/01.png", content: "", bytes: png(1) }, { path: "q/README.md", content: "r2" }], [], at({ "q/01.yaml": "x", "q/README.md": "r1" }));
    expect(real).toEqual([["new", "q/01.png"]]);
  });

  it("bookkeeping files alone are not real; deletions are", () => {
    const { changes, real } = fileChanges(
      [{ path: "casts/casts.json", content: "2" }, { path: "q/index.html", content: "2" }, { path: ".drawcast/claim", content: "n" }],
      ["q/01.png"],
      at({ "casts/casts.json": "1", "q/index.html": "1" }),
    );
    expect(changes.map(([, p]) => p)).toEqual(["casts/casts.json", "q/index.html", ".drawcast/claim", "q/01.png"]);
    expect(real).toEqual([["deleted", "q/01.png"]]);
  });
});

// .cast files (2026-10-03): the skill's tooling reads both generations and
// writes what the app's switch (src/cast-file.ts publishesCast) says.
describe(".cast files in the skill's tooling (cast.mjs)", () => {
  const common = { owner: "ann", repo: "casts", branch: "main", base: "abc123", clone: "dev-casts/repos/ann__casts", viewerBase: "https://www.drawcast.app/", slugFor };
  afterEach(() => setPublishesCast(false));

  it("its extension rule is the app's own", () => {
    expect(DOC_EXT_RE.source).toBe(APP_DOC_EXT_RE.source);
    expect(DOC_EXT_RE.flags).toBe(APP_DOC_EXT_RE.flags);
    for (const n of ["casts/a.cast", "casts/a.yaml", "a.yml", "A.CAST"]) expect(stripDocExt(n)).toBe(appStripDocExt(n));
  });

  it("readers take a .cast: taken slugs, the workdir's file, the format a name says", () => {
    expect(takenSlugs({ kind: "cast", listed: [], tree: ["b.cast", "c.yaml", "casts.json"] })).toEqual(expect.arrayContaining(["b", "c"]));
    expect(existingDoc(["x.cast", "origin.json"], "x.cast")).toBe("x.cast");
    expect(existingDoc(["x.yaml", "origin.json"], "x.cast")).toBe("x.yaml");
    expect(existingDoc(["y.yaml"], "x.cast")).toBeNull();
    expect(formatForName("casts/x.cast")).toBe("script");
    expect(formatForName("casts/x.yaml")).toBe("yaml");
  });

  it("the switch off (the default): names are as before", () => {
    expect(publishOrigin({ ...common, kind: "cast", dir: "", slug: "p", takenSlugs: [], ext: publishExt() }).origin).toMatchObject({ path: "casts/p.yaml", file: "p.yaml" });
    expect(lectureFileName({ recorded: undefined, n: 3, slug: "costs", publishName, publishExt })).toEqual({ file: "03-costs.yaml", old: null });
    expect(lectureFileName({ recorded: "01-intro.yaml", n: 1, slug: "x", publishName, publishExt })).toEqual({ file: "01-intro.yaml", old: null });
  });

  it("the switch on: new names are .cast, and a recorded .yaml becomes .cast with the old one named for removal", () => {
    setPublishesCast(true);
    expect(publishOrigin({ ...common, kind: "cast", dir: "", slug: "p", takenSlugs: [], ext: publishExt() }).origin).toMatchObject({ path: "casts/p.cast", file: "p.cast" });
    expect(lectureFileName({ recorded: undefined, n: 3, slug: "costs", publishName, publishExt })).toEqual({ file: "03-costs.cast", old: null });
    expect(lectureFileName({ recorded: "01-intro.yaml", n: 1, slug: "x", publishName, publishExt })).toEqual({ file: "01-intro.cast", old: "01-intro.yaml" });
    expect(lectureFileName({ recorded: "01-intro.cast", n: 1, slug: "x", publishName, publishExt })).toEqual({ file: "01-intro.cast", old: null });
  });

  it("a .cast cast registers under its file, and locks under the same item its .yaml did", () => {
    const origin = { kind: "cast", owner: "ann", repo: "casts", castsDir: "casts", file: "qaly.cast" };
    const reg = registerFor(origin, {} as never);
    expect(reg).toMatchObject({ target: "ann/casts/casts/qaly.cast", title: "qaly" });
    expect(privateItemFor(origin, reg)).toBe("ann/casts/casts/qaly");
  });

  it("DRAWCAST_PUBLISH_CAST=1 turns it on, on the module every load() shares", () => {
    expect(publishCastFromEnv({ DRAWCAST_PUBLISH_CAST: "1" })).toBe(true);
    expect(publishCastFromEnv({ DRAWCAST_PUBLISH_CAST: "true" })).toBe(true);
    expect(publishCastFromEnv({ DRAWCAST_PUBLISH_CAST: "0" })).toBe(false);
    expect(publishCastFromEnv({})).toBe(false);
    const src = readFileSync("scripts/cast.mjs", "utf8");
    expect(src).toContain("const PUBLISH_CAST = publishCastFromEnv(process.env);");
    const vite = src.slice(src.indexOf("async function withVite(fn) {"), src.indexOf("async function browser() {"));
    expect(vite).toMatch(/if \(PUBLISH_CAST\) \(await server\.ssrLoadModule\("\/src\/cast-file\.ts"\)\)\.setPublishesCast\(true\);\s*return await fn\(\(p\) => server\.ssrLoadModule\(p\)\);/);
    // Every writer goes through the switch: no hard-coded .yaml name or YAML text is left.
    expect(src).not.toMatch(/formatPlaylist\(playlist, "yaml"\)|formatSpec\(spec, "yaml"\)|\$\{name\}\.yaml|\$\{plan\.slug\}\.yaml|\$\{free\}\.yaml/);
  });
});
