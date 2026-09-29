// Task 8: the author's own re-reads unlock. Each place that reads a
// published lecture back from GitHub for its own purposes — course-load,
// baked-narration reuse on a republish (main.ts and ui/course.ts both bake) —
// must pass the fetched text through item-key.ts's unlockForAuthor before
// parsing it, exactly like the publish/registry ordering guards in
// tests/registry-client.test.ts pin their own call order by reading the
// source back.
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

describe("every author re-read of a published lecture is unlocked before it is parsed", () => {
  test("main.ts loadCoursesFromGithub: unlockForAuthor runs on every fetched lecture yaml before it reaches yamlByFile / importCourse", () => {
    const main = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
    const fn = main.slice(main.indexOf("async function loadCoursesFromGithub("), main.indexOf("function refreshMyTemplates("));
    expect(fn.length).toBeGreaterThan(0);
    const iReadFile = fn.indexOf("await readFile(repo, joinPath(t.dir, f))");
    const iUnlock = fn.indexOf("unlockForAuthor(");
    const iImportCourse = fn.indexOf("importCourse({");
    expect(iReadFile).toBeGreaterThan(0);
    expect(iUnlock).toBeGreaterThan(iReadFile);
    expect(iUnlock).toBeLessThan(iImportCourse);
  });

  test("main.ts loadCoursesFromGithub: a lecture that cannot be unlocked is reported, never silently dropped or stored still-encrypted", () => {
    const main = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
    const fn = main.slice(main.indexOf("async function loadCoursesFromGithub("), main.indexOf("function refreshMyTemplates("));
    expect(fn).toContain("locked — sign in as the owner to load");
  });

  test("main.ts publishTextFor's default previousText: unlockForAuthor runs on the fetched cast text before publishTextFor reads it as audio", () => {
    const main = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
    const fn = main.slice(main.indexOf("async function publishTextFor("), main.indexOf("async function publishDrawcast("));
    expect(fn.length).toBeGreaterThan(0);
    const iReadFile = fn.indexOf("readFile(repo, joinPath(joinPath(settings.coursesDir");
    const iUnlock = fn.indexOf("unlockForAuthor(");
    const iParsePlaylist = fn.indexOf("parsePlaylistText(published)");
    expect(iReadFile).toBeGreaterThan(0);
    expect(iUnlock).toBeGreaterThan(iReadFile);
    expect(iUnlock).toBeLessThan(iParsePlaylist);
  });

  test("ui/course.ts bakeLectures: unlockForAuthor runs on the fetched published lecture before it is read for reusable audio lines", () => {
    const course = readFileSync(new URL("../src/ui/course.ts", import.meta.url), "utf8");
    const fn = course.slice(course.indexOf("async function bakeLectures("), course.indexOf("function bakeReport("));
    expect(fn.length).toBeGreaterThan(0);
    const iReadFile = fn.indexOf("await readFile(repo, joinPath(settings.coursesDir");
    const iUnlock = fn.indexOf("unlockForAuthor(");
    const iParsePlaylist = fn.indexOf("parsePlaylistText(unlocked.text)");
    expect(iReadFile).toBeGreaterThan(0);
    expect(iUnlock).toBeGreaterThan(iReadFile);
    expect(iUnlock).toBeLessThan(iParsePlaylist);
  });

  test("all three sites import unlockForAuthor from item-key.ts", () => {
    const main = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
    const course = readFileSync(new URL("../src/ui/course.ts", import.meta.url), "utf8");
    expect(main).toMatch(/import\s*\{[^}]*\bunlockForAuthor\b[^}]*\}\s*from\s*"\.\/item-key"/);
    expect(course).toMatch(/import\s*\{[^}]*\bunlockForAuthor\b[^}]*\}\s*from\s*"\.\.\/item-key"/);
  });
});
