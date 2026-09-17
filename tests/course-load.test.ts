// Loading published courses back from a GitHub repo (course-load round,
// 2026-09-17): planCourseLoad decides which manifest courses to fetch,
// importCourse turns a fetched course.md + lecture yamls into the local
// SavedCourse and library rows.
import { describe, expect, test } from "vitest";
import { importCourse, lectureFilesOf, planCourseLoad } from "../src/course/load";

const repo = { owner: "hm", repo: "casts" };
const manifest = {
  courses: [
    { slug: "micro-i", title: "Micro I", files: ["courses/micro-i/course.md", "courses/micro-i/supply.yaml"], updated: "2026-09-15T10:00:00.000Z" },
    { slug: "stats", title: "Stats", files: ["courses/stats/course.md"], updated: "2026-09-10T10:00:00.000Z" },
  ],
};
const localMicro = { id: "c-1", title: "Micro I", text: "# Micro I\nslug: micro-i\n---\n## Supply\nWhy?\n", ts: "2026-09-16T00:00:00.000Z" };

describe("planCourseLoad", () => {
  test("a repo course with no local copy is imported as new", () => {
    const todo = planCourseLoad(manifest, [], repo, "courses");
    expect(todo.map((t) => t.slug)).toEqual(["micro-i", "stats"]);
    expect(todo[0]).toMatchObject({ dir: "courses/micro-i", localId: null, updated: "2026-09-15T10:00:00.000Z", title: "Micro I" });
  });
  test("a local copy saved AFTER the repo's update is left alone (unpublished edits are never clobbered)", () => {
    const todo = planCourseLoad(manifest, [localMicro], repo, "courses");
    expect(todo.map((t) => t.slug)).toEqual(["stats"]);
  });
  test("a local copy OLDER than the repo's update is refreshed under its own id", () => {
    const stale = { ...localMicro, ts: "2026-09-01T00:00:00.000Z" };
    const todo = planCourseLoad(manifest, [stale], repo, "courses");
    expect(todo.find((t) => t.slug === "micro-i")).toMatchObject({ localId: "c-1" });
  });
  test("matching is by the slug recorded in the local course text, not by title", () => {
    const renamed = { ...localMicro, title: "Something else", ts: "2026-09-20T00:00:00.000Z" };
    expect(planCourseLoad(manifest, [renamed], repo, "courses").map((t) => t.slug)).toEqual(["stats"]);
  });
  test("an empty courses folder setting puts the course folder at the repo root", () => {
    expect(planCourseLoad(manifest, [], repo, "")[0].dir).toBe("micro-i");
  });
});

const COURSE_MD = `# Micro I
slug: micro-i
---
## Supply
Why does the curve slope up?
#parts=2
status: done · id: lec-a · file: supply.yaml · 2026-09-15
---
## Demand
Why down?
status: done · id: lec-b · file: demand.yaml · 2026-09-15
---
## Equilibrium
Not generated yet.
`;
const SUPPLY_YAML = `playlist:
  title: Micro I
  next:
    title: Demand
    href: https://drawcast.app/#gh=hm/casts/courses/micro-i/demand.yaml
  prompt: Why does the curve slope up?
---
title: Supply curve
elements:
  - id: a
    type: text
    text: Supply
    x: 500
    y: 500
commands:
  - draw: [a]
---
audio:
  lang: en
  lines:
    "0": { mp3: "AAAA", ms: 900 }
`;

describe("lectureFilesOf", () => {
  test("names the lecture files a course document publishes, in order, skipping ungenerated lectures", () => {
    expect(lectureFilesOf(COURSE_MD)).toEqual(["supply.yaml", "demand.yaml"]);
  });
});

describe("importCourse", () => {
  const out = importCourse({ text: COURSE_MD, yamlByFile: { "supply.yaml": SUPPLY_YAML }, courseId: "c-9", updated: "2026-09-15T10:00:00.000Z" });

  test("the course row keeps the document verbatim and takes the repo's time as its own", () => {
    expect(out.course).toMatchObject({ id: "c-9", title: "Micro I", text: COURSE_MD, ts: "2026-09-15T10:00:00.000Z" });
  });
  test("a lecture becomes a library row under the id the document already names, tagged with the course", () => {
    expect(out.drawings).toHaveLength(1);
    expect(out.drawings[0]).toMatchObject({ id: "lec-a", title: "Supply", courseId: "c-9", parts: 1, prompt: "Why does the curve slope up?" });
    expect(out.drawings[0].spec.title).toBe("Supply curve");
  });
  test("the stored playlist drops the baked audio and the publish-only next link", () => {
    const stored = out.drawings[0].playlist ?? "";
    expect(stored).not.toContain("audio");
    expect(stored).not.toContain("mp3");
    expect(stored).not.toContain("next:");
    expect(stored).toContain("Supply curve");
  });
  test("a lecture whose file did not come back is reported, not invented", () => {
    expect(out.missing).toEqual(["demand.yaml"]);
  });
  test("an unparsable lecture file is reported as missing too", () => {
    const bad = importCourse({ text: COURSE_MD, yamlByFile: { "supply.yaml": ":: not yaml [", "demand.yaml": SUPPLY_YAML }, courseId: "c-9", updated: "t" });
    expect(bad.missing).toEqual(["supply.yaml"]);
    expect(bad.drawings.map((d) => d.id)).toEqual(["lec-b"]);
  });
});

// Wiring in main.ts: the two rows lead the Courses section, ＋ New course
// really starts fresh, and a declared repo syncs quietly at startup.
import { readFileSync } from "node:fs";
describe("course-load wiring (main.ts)", () => {
  const main = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
  test("＋ New course and ⇩ Load courses are inserted BEFORE the course list, New first", () => {
    const i = main.indexOf("coursesSection.details.insertBefore(newCourseRow, coursesSection.list)");
    const j = main.indexOf("coursesSection.details.insertBefore(loadCoursesRow, coursesSection.list)");
    expect(i).toBeGreaterThan(-1);
    expect(j).toBeGreaterThan(i);
    expect(main).not.toContain("coursesSection.details.append(newCourseRow)");
  });
  test("＋ New course opens the panel fresh", () => {
    expect(main).toMatch(/newCourseRow\.addEventListener\("click", \(\) => openCourse\(undefined, \{ fresh: true \}\)\)/);
  });
  test("the row and the startup both go through one loader; startup is quiet and only when a repo is declared", () => {
    expect(main).toMatch(/loadCoursesRow\.addEventListener\("click", \(\) => void loadCoursesFromGithub\(\)\)/);
    expect(main).toMatch(/if \(settings\.githubRepo\) void loadCoursesFromGithub\(\{ quiet: true \}\);/);
    expect(main).toMatch(/planCourseLoad\(parseManifest\(/);
    expect(main).toMatch(/importCourse\(\{ text, yamlByFile, courseId: t\.localId \?\? crypto\.randomUUID\(\), updated: t\.updated \}\)/);
  });
});
