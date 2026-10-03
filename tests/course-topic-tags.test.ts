// A course's topic tags for the registry, and its published lecture titles.
import { describe, expect, test } from "vitest";
import { courseTopicTags } from "../src/course/publish";
import { parseCourse } from "../src/course/document";
import { publishedLectureTitles } from "../src/links/course";
import { readTags } from "../src/playlist/playlist";

describe("course topic tags", () => {
  test("the brief tags are left out; underscores become spaces", () => {
    expect(courseTopicTags({ tags: ["#for=nurses", "#basic", "#economics", "#health_economics", "#short"] })).toEqual(["economics", "health economics"]);
    expect(courseTopicTags({ tags: ["#students", "#advanced"] })).toBeUndefined();
    expect(courseTopicTags({})).toBeUndefined();
  });
  test("from course.md's header line", () => {
    const course = parseCourse("# Health economics\n#basic #economics #qaly\n\n## What is a QALY?\n");
    expect(courseTopicTags(course)).toEqual(["economics", "qaly"]);
  });
  test("tags the registry would refuse are dropped, never sent", () => {
    expect(readTags(["c++", "ok", "x".repeat(31), "data science"])).toEqual(["ok", "data science"]);
  });
});

describe("published lecture titles", () => {
  test("only lectures with a file, in order", () => {
    const text = [
      "# C", "", "---", "## One", "Why?", "", "---", "status: done · file: one.cast · 2026-10-01", "",
      "## Draft", "Not yet.", "", "---", "## Two", "How?", "", "---", "status: done · file: two.cast · 2026-10-01", "",
    ].join("\n");
    expect(publishedLectureTitles(text)).toEqual(["One", "Two"]);
  });
});
