import { describe, expect, test } from "vitest";
import { parseTarget, resolveLink, type LinkBase } from "../src/links/resolve";

const VB = "https://www.drawcast.app";
const gh: LinkBase = { kind: "gh", owner: "hmelberg", repo: "kurs", path: "courses/qaly/02-how.yaml" };

describe("parseTarget", () => {
  test("player links", () => {
    expect(parseTarget("https://www.drawcast.app/#gh=o/r/c/01.yaml")).toEqual({ kind: "gh", owner: "o", repo: "r", path: "c/01.yaml" });
    expect(parseTarget("https://x.org/drawcast/#gdrive=1AbCdEfGhIjK")).toEqual({ kind: "drive", id: "1AbCdEfGhIjK" });
  });
  test("GitHub forms", () => {
    const want = { kind: "gh", owner: "o", repo: "r", path: "c/01.yaml" };
    expect(parseTarget("o/r/c/01.yaml")).toEqual(want);
    expect(parseTarget("https://github.com/o/r/blob/main/c/01.yaml")).toEqual(want);
    expect(parseTarget("https://raw.githubusercontent.com/o/r/main/c/01.yaml")).toEqual(want);
    expect(parseTarget("https://raw.githubusercontent.com/o/r/HEAD/c/01.yaml")).toEqual(want);
  });
  test("Drive forms", () => {
    expect(parseTarget("https://drive.google.com/file/d/1AbCdEfGhIjK/view?usp=sharing")).toEqual({ kind: "drive", id: "1AbCdEfGhIjK" });
    expect(parseTarget("gdrive:1AbCdEfGhIjK")).toEqual({ kind: "drive", id: "1AbCdEfGhIjK" });
  });
  test("relative and lecture forms", () => {
    expect(parseTarget("./03-theory.yaml")).toEqual({ kind: "relative", path: "./03-theory.yaml" });
    expect(parseTarget("../intro/a.yaml")).toEqual({ kind: "relative", path: "../intro/a.yaml" });
    expect(parseTarget("03-theory.yaml")).toEqual({ kind: "relative", path: "03-theory.yaml" });
    expect(parseTarget("lecture:3")).toEqual({ kind: "lecture", n: 3 });
  });
  test("junk", () => {
    for (const s of ["", "  ", "hello", "lecture:0", "lecture:x", "https://example.org/page", "o/r"]) expect(parseTarget(s)).toBeNull();
  });
});

describe("resolveLink", () => {
  test("absolute GitHub target, with its poster and document", () => {
    expect(resolveLink("o/r/c/01.yaml", null, VB)).toEqual({
      href: "https://www.drawcast.app/#gh=o/r/c/01.yaml",
      posterUrl: "https://raw.githubusercontent.com/o/r/HEAD/c/01.png",
      docUrl: "https://raw.githubusercontent.com/o/r/HEAD/c/01.yaml",
    });
  });
  test("Drive target: player link only", () => {
    expect(resolveLink("gdrive:1AbCdEfGhIjK", null, VB)).toEqual({ href: "https://www.drawcast.app/#gdrive=1AbCdEfGhIjK" });
  });
  test("relative against a GitHub folder", () => {
    expect(resolveLink("./03-theory.yaml", gh, VB)?.href).toBe("https://www.drawcast.app/#gh=hmelberg/kurs/courses/qaly/03-theory.yaml");
    expect(resolveLink("../other/a.yaml", gh, VB)?.href).toBe("https://www.drawcast.app/#gh=hmelberg/kurs/courses/other/a.yaml");
    expect(resolveLink("../../../x.yaml", gh, VB)).toBeNull(); // above the repo root
  });
  test("relative with no folder does not resolve", () => {
    expect(resolveLink("./03-theory.yaml", null, VB)).toBeNull();
  });
  test("relative in dev opens through ?open=", () => {
    const dev: LinkBase = { kind: "dev", path: "/dev-casts/courses/qaly/02-how.yaml" };
    expect(resolveLink("./03-theory.yaml", dev, "http://localhost:5199")).toEqual({
      href: "http://localhost:5199/?open=/dev-casts/courses/qaly/03-theory.yaml",
      posterUrl: "/dev-casts/courses/qaly/03-theory.png",
      docUrl: "/dev-casts/courses/qaly/03-theory.yaml",
    });
  });
  test("lecture:N in an app course opens the drawing", () => {
    const course: LinkBase = { kind: "course", lectures: [{ drawingId: "a" }, { drawingId: "b" }, {}] };
    expect(resolveLink("lecture:2", course, VB)).toEqual({ drawingId: "b" });
    expect(resolveLink("lecture:3", course, VB)).toBeNull(); // not built
    expect(resolveLink("lecture:9", course, VB)).toBeNull();
  });
  test("lecture:N in a published course resolves through its folder", () => {
    const course: LinkBase = { kind: "course", lectures: [{ file: "01-a.yaml" }, { file: "02-how.yaml" }, { file: "03-theory.yaml" }], dir: gh };
    expect(resolveLink("lecture:3", course, VB)?.href).toBe("https://www.drawcast.app/#gh=hmelberg/kurs/courses/qaly/03-theory.yaml");
  });
  test("a relative link inside an app course names a lecture by file", () => {
    const course: LinkBase = { kind: "course", lectures: [{ file: "01-a.yaml", drawingId: "a" }, { file: "03-theory.yaml", drawingId: "c" }] };
    expect(resolveLink("./03-theory.yaml", course, VB)).toEqual({ drawingId: "c" });
    expect(resolveLink("./nope.yaml", course, VB)).toBeNull();
  });
  test("lecture:N with no course does not resolve", () => {
    expect(resolveLink("lecture:2", gh, VB)).toBeNull();
  });
});

import { courseBase, courseBaseForDrawing, withCourse } from "../src/links/course";

const COURSE = [
  "# QALY",
  "slug: qaly",
  "",
  "---",
  "## What is a QALY?",
  "Why?",
  "status: done · id: aaa · file: 01-what.yaml · 2026-09-28",
  "",
  "---",
  "## How is it calculated?",
  "How?",
  "status: done · id: bbb · file: 02-how.yaml · 2026-09-28",
  "",
  "---",
  "## Theory",
  "Which?",
  "",
].join("\n");

describe("course bases", () => {
  test("lectures in order, with files and library ids", () => {
    expect(courseBase(COURSE)).toEqual({ kind: "course", lectures: [{ file: "01-what.yaml", drawingId: "aaa" }, { file: "02-how.yaml", drawingId: "bbb" }, {}] });
  });
  test("the course holding a drawing", () => {
    expect(courseBaseForDrawing(["# other\n", COURSE], "bbb")?.kind).toBe("course");
    expect(courseBaseForDrawing([COURSE], "zzz")).toBeNull();
  });
  test("a published lecture widens to its course; lecture:N then resolves to the file", () => {
    const file: LinkBase = { kind: "gh", owner: "o", repo: "r", path: "c/qaly/02-how.yaml" };
    const base = withCourse(file, "02-how.yaml", COURSE);
    expect(resolveLink("lecture:1", base, VB)?.href).toBe("https://www.drawcast.app/#gh=o/r/c/qaly/01-what.yaml");
    expect(resolveLink("lecture:3", base, VB)).toBeNull(); // not built yet
    expect(withCourse(file, "99-other.yaml", COURSE)).toBe(file);
    expect(withCourse(file, "02-how.yaml", null)).toBe(file);
  });
});
