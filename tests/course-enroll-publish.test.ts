import { describe, expect, test } from "vitest";
import { parseCourse } from "../src/course/document";
import { buildPublishPlan, courseKeyFor, lectureCastKeys } from "../src/course/publish";
import { emptyManifest } from "../src/publish/github";
import { parsePlaylistText } from "../src/playlist/playlist";

const REPO = { owner: "hmelberg", repo: "dcast" };
const YAML = "title: One\nelements: []\ncommands: []\n";

function plan(text: string) {
  const course = parseCourse(text);
  return buildPublishPlan({ course, text, repo: REPO, coursesDir: "", viewerBase: "https://drawcast.app/", manifest: emptyManifest(), lectureYaml: () => YAML });
}

describe("publishing a course with enroll", () => {
  const text = "# Learn Russian\nslug: learn-russian\nenroll: https://drawcast.anvil.app/\n\n## Cases\nq\n\n## Verbs\nq\n";

  test("every lecture's published copy carries meta.enroll, normalised", () => {
    const p = plan(text);
    const lectures = p.files.filter((f) => f.path.endsWith(".yaml"));
    expect(lectures.length).toBe(2);
    for (const f of lectures) expect(parsePlaylistText(f.content).meta.enroll).toBe("https://drawcast.anvil.app");
  });
  test("the page carries the course key and the api, and each lecture its cast key", () => {
    const html = plan(text).files.find((f) => f.path === "learn-russian/index.html")!.content;
    expect(html).toContain('data-course="hmelberg/dcast/learn-russian"');
    expect(html).toContain('data-enroll="https://drawcast.anvil.app"');
    expect(html).toMatch(/data-cast="hmelberg\/dcast\/learn-russian\/[^"]+\.yaml"/);
  });
  test("without enroll nothing changes", () => {
    const p = plan("# Plain\nslug: plain\n\n## L\nq\n");
    expect(parsePlaylistText(p.files.find((f) => f.path.endsWith(".yaml"))!.content).meta.enroll).toBeUndefined();
    expect(p.files.find((f) => f.path === "plain/index.html")!.content).not.toContain("data-enroll");
  });
});

describe("keys", () => {
  test("courseKeyFor joins owner, repo and the course folder", () => {
    expect(courseKeyFor(REPO, "learn-russian")).toBe("hmelberg/dcast/learn-russian");
    expect(courseKeyFor(REPO, "courses/learn-russian")).toBe("hmelberg/dcast/courses/learn-russian");
  });
  test("lectureCastKeys lists published lectures in order and skips unpublished ones", () => {
    const c = parseCourse("# T\nslug: t\n\n## A\nq\nstatus: done · file: 01-a.yaml\n\n## B\nq\n\n## C\nq\nstatus: done · file: 03-c.yaml\n");
    expect(lectureCastKeys(c, REPO, "")).toEqual(["hmelberg/dcast/t/01-a.yaml", "hmelberg/dcast/t/03-c.yaml"]);
    expect(lectureCastKeys(c, REPO, "courses")).toEqual(["hmelberg/dcast/courses/t/01-a.yaml", "hmelberg/dcast/courses/t/03-c.yaml"]);
  });
});
