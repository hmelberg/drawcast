import { describe, expect, it } from "vitest";
import { pageDoor, parseGithubTarget } from "../scripts/cast-github.mjs";
import { coursePage, doorlessNote, type DoorlessReason } from "../src/course/page";
import { parseCourse } from "../src/course/document";

describe("parseGithubTarget (cast.mjs pull)", () => {
  const at = (owner: string, repo: string, branch: string | null, path: string) => ({ owner, repo, branch, path });
  it.each([
    ["https://drawcast.app/#gh=hmelberg/dcast/casts/twenty-players.yaml", at("hmelberg", "dcast", null, "casts/twenty-players.yaml")],
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
    const door = { name: "qaly", app: "https://drawcast.app/" };
    expect(pageDoor(coursePage(course, links, door), doorlessNote)).toEqual(door);
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
