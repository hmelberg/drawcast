import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { parseCourse } from "../src/course/document";
import { courseRegistration } from "../src/course/publish";
import { castRegistration } from "../src/publish/cast";
import { SETTINGS_TABS } from "../src/store";

const REPO = { owner: "hmelberg", repo: "dcast" };

describe("registrations", () => {
  test("a course registers under name: when set, else under its slug, with page, title and lecture keys", () => {
    const c = parseCourse("# Learn Russian\nslug: russian\nname: learn-russian\n\n## A\nq\nstatus: done · file: 01-a.yaml\n\n## B\nq\n");
    expect(courseRegistration(c, REPO, "", "https://hmelberg.github.io/dcast/russian/")).toEqual({
      name: "learn-russian", kind: "course", target: "hmelberg/dcast/russian", page: "https://hmelberg.github.io/dcast/russian/", title: "Learn Russian", lectures: ["hmelberg/dcast/russian/01-a.yaml"],
    });
    const shouty = parseCourse("# Learn Russian\nslug: russian\nname: Learn-Russian\n\n## A\nq\n");
    expect(courseRegistration(shouty, REPO, "", "https://h/x/")?.name).toBe("learn-russian");
    const plain = parseCourse("# T\nslug: t\n\n## A\nq\n");
    expect(courseRegistration(plain, REPO, "courses", "https://h/x/")?.name).toBe("t");
    expect(courseRegistration(plain, REPO, "courses", "https://h/x/")?.target).toBe("hmelberg/dcast/courses/t");
    expect(courseRegistration(parseCourse("# No slug yet\n"), REPO, "", "https://h/")).toBeNull();
  });
  test("a cast registers under its slug", () => {
    expect(castRegistration("did", REPO, "casts", "https://hmelberg.github.io/dcast/casts/")).toEqual({
      name: "did", kind: "cast", target: "hmelberg/dcast/casts/did.yaml", page: "https://hmelberg.github.io/dcast/casts/",
    });
  });
});

describe("the author key lives beside the GitHub token", () => {
  test("settings tab", () => {
    expect(SETTINGS_TABS.find((t) => t.id === "publishing")!.fields).toContain("authorKey");
  });
  test("both publishers register after the commit landed AND after their own bookkeeping, with the key, a timeout, and the outcome reported", () => {
    const main = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
    const course = readFileSync(new URL("../src/ui/course.ts", import.meta.url), "utf8");
    for (const src of [main, course]) {
      expect(src).toMatch(/getAuthorKey\(\)/);
      expect(src).toMatch(/registerName\(DEFAULT_ENROLL_API,/);
      expect(src).toMatch(/nameNote\(/);
      // An unreachable registry costs ten seconds, not the rest of the session.
      expect(src).toMatch(/AbortSignal\.timeout\(10_000\)/);
    }
    // Sliced at the publish call so the anchors are the ones in THIS function:
    // autosave() and render() are called all over both files.
    const castPublish = main.slice(main.indexOf("await publishCast("));
    expect(castPublish.indexOf("registerName(")).toBeGreaterThan(0);
    expect(castPublish.indexOf("registerName(")).toBeGreaterThan(castPublish.indexOf("autosave();"));
    const coursePublish = course.slice(course.indexOf("await publishCourse("));
    expect(coursePublish.indexOf("registerName(")).toBeGreaterThan(0);
    expect(coursePublish.indexOf("registerName(")).toBeGreaterThan(coursePublish.indexOf("render();"));
  });
});
