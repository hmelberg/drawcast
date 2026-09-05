import { describe, expect, test } from "vitest";
import { parseCourse } from "../src/course/document";
import type { Door } from "../src/course/page";
import { buildPublishPlan, courseKeyFor, courseNameFor, lectureCastKeys } from "../src/course/publish";
import { emptyManifest } from "../src/publish/github";
import { parsePlaylistText } from "../src/playlist/playlist";

const REPO = { owner: "hmelberg", repo: "dcast" };
const YAML = "title: One\nelements: []\ncommands: []\n";

function plan(text: string, door?: Door) {
  const course = parseCourse(text);
  return buildPublishPlan({ course, text, repo: REPO, coursesDir: "", viewerBase: "https://drawcast.app/", manifest: emptyManifest(), lectureYaml: () => YAML, door });
}
const pageOf = (p: ReturnType<typeof plan>, slug: string) => p.files.find((f) => f.path === `${slug}/index.html`)!.content;

describe("publishing a course with enroll", () => {
  const text = "# Learn Russian\nslug: learn-russian\nenroll: https://drawcast.anvil.app/\n\n## Cases\nq\n\n## Verbs\nq\n";
  const DOOR: Door = { name: "learn-russian", app: "https://drawcast.app/" };

  test("every lecture's published copy carries meta.enroll, normalised", () => {
    const p = plan(text, DOOR);
    const lectures = p.files.filter((f) => f.path.endsWith(".yaml"));
    expect(lectures.length).toBe(2);
    for (const f of lectures) expect(parsePlaylistText(f.content).meta.enroll).toBe("https://drawcast.anvil.app");
  });
  test("with a registered name the page is a door: one link to that name in the app, no script, and nothing for one to read", () => {
    const html = pageOf(plan(text, DOOR), "learn-russian");
    expect(html).toContain('href="https://drawcast.app/#learn-russian"');
    expect(html).toMatch(/Join this course/i);
    expect(html).not.toContain("<script");
    expect(html).not.toContain("data-enroll");
    expect(html).not.toContain("data-course");
    expect(html).not.toContain("data-cast");
  });
  test("the door is the name the caller registered, whatever the document says — the page never guesses", () => {
    const named = "# Learn Russian\nslug: learn-russian\nname: russian-for-all\nenroll: https://drawcast.anvil.app/\n\n## Cases\nq\n";
    // The registration named it russian-for-all and came back ok:
    expect(pageOf(plan(named, { name: "russian-for-all", app: "https://drawcast.app/" }), "learn-russian")).toContain('href="https://drawcast.app/#russian-for-all"');
    // …but had the caller registered nothing, neither name: nor the slug becomes a link.
    const html = pageOf(plan(named), "learn-russian");
    expect(html).not.toContain("#russian-for-all");
    expect(html).not.toContain("#learn-russian");
  });
  test("without a door decision the page ships doorless and says so — a taken name must never become a Join button into a stranger's run", () => {
    const html = pageOf(plan(text), "learn-russian");
    expect(html).toMatch(/Joining is not open yet/);
    expect(html).not.toMatch(/href="https:\/\/drawcast\.app\/#/);
    expect(html).not.toMatch(/Join this course/i);
    const taken = pageOf(plan(text, { name: null, why: "taken" }), "learn-russian");
    expect(taken).toMatch(/belongs to someone else/);
    expect(taken).not.toMatch(/href="https:\/\/drawcast\.app\/#/);
  });
  test("a server of the author's own gets no door even when one was offered — the viewer reports to the drawcast server only", () => {
    const own = "# Learn Russian\nslug: learn-russian\nenroll: https://my-own.anvil.app\n\n## Cases\nq\n";
    const p = plan(own, DOOR);
    expect(parsePlaylistText(p.files.find((f) => f.path.endsWith(".yaml"))!.content).meta.enroll).toBe("https://my-own.anvil.app");
    const html = pageOf(p, "learn-russian");
    expect(html).toMatch(/Joining is not open yet/);
    expect(html).toMatch(/drawcast server only/);
    expect(html).not.toContain('href="https://drawcast.app/#learn-russian"');
  });
  test("without enroll there is no join section, and the lectures carry no server", () => {
    const p = plan("# Plain\nslug: plain\n\n## L\nq\n", { name: "plain-course", app: "https://drawcast.app/" });
    expect(parsePlaylistText(p.files.find((f) => f.path.endsWith(".yaml"))!.content).meta.enroll).toBeUndefined();
    const html = pageOf(p, "plain");
    expect(html).not.toMatch(/Join this course|Joining is not open/);
    expect(html).not.toContain('class="join"');
  });
});

describe("keys and names", () => {
  test("courseKeyFor joins owner, repo and the course folder", () => {
    expect(courseKeyFor(REPO, "learn-russian")).toBe("hmelberg/dcast/learn-russian");
    expect(courseKeyFor(REPO, "courses/learn-russian")).toBe("hmelberg/dcast/courses/learn-russian");
  });
  test("lectureCastKeys lists published lectures in order and skips unpublished ones", () => {
    const c = parseCourse("# T\nslug: t\n\n## A\nq\nstatus: done · file: 01-a.yaml\n\n## B\nq\n\n## C\nq\nstatus: done · file: 03-c.yaml\n");
    expect(lectureCastKeys(c, REPO, "")).toEqual(["hmelberg/dcast/t/01-a.yaml", "hmelberg/dcast/t/03-c.yaml"]);
    expect(lectureCastKeys(c, REPO, "courses")).toEqual(["hmelberg/dcast/courses/t/01-a.yaml", "hmelberg/dcast/courses/t/03-c.yaml"]);
  });
  test("courseNameFor: `name:` when set, else the slug, lower-cased — and a name the rule rejects travels as written so the publish can report it", () => {
    expect(courseNameFor({ name: undefined }, "learn-russian")).toBe("learn-russian");
    expect(courseNameFor({ name: "Learn-Russian" }, "x")).toBe("learn-russian");
    expect(courseNameFor({ name: "gh-nope" }, "x")).toBe("gh-nope");
  });
});
