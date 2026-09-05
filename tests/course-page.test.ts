import { describe, expect, it, test } from "vitest";
import { parseCourse } from "../src/course/document";
import { courseHref, courseNameFor, coursePage, escapeHtml, lectureHref, repoIndexPage } from "../src/course/page";

const COURSE = parseCourse(`# Causal Inference
level: advanced

A master-level introduction.

---
## Potential outcomes
What is a counterfactual outcome?
---
## Difference-in-differences
What breaks parallel trends?
`);

const LINKS = [
  {
    title: "Potential outcomes",
    questions: ["What is a counterfactual outcome?"],
    href: "https://drawcast.app/#gh=o/r/courses/c/potential-outcomes.yaml",
  },
  { title: "Difference-in-differences", questions: ["What breaks parallel trends?"], href: null },
];

describe("escapeHtml", () => {
  it("escapes the characters that would break the page", () => {
    expect(escapeHtml('a<b>&"c"')).toBe("a&lt;b&gt;&amp;&quot;c&quot;");
  });
});

describe("coursePage", () => {
  it("carries the title and intro", () => {
    const html = coursePage(COURSE, LINKS);
    expect(html).toContain("Causal Inference");
    expect(html).toContain("A master-level introduction.");
  });

  it("links a published lecture and lists its questions", () => {
    const html = coursePage(COURSE, LINKS);
    expect(html).toContain('href="https://drawcast.app/#gh=o/r/courses/c/potential-outcomes.yaml"');
    expect(html).toContain("What is a counterfactual outcome?");
  });

  it("shows an unpublished lecture without a dead link", () => {
    const html = coursePage(COURSE, LINKS);
    expect(html).toContain("Difference-in-differences");
    expect(html).toContain("not published yet");
    expect(html).not.toContain('href="null"');
  });

  it("escapes a title that would otherwise break the markup", () => {
    const html = coursePage({ ...COURSE, title: "A <script>alert(1)</script> course" }, []);
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("escapes a question too", () => {
    const html = coursePage(COURSE, [{ title: "T", questions: ['Why <b>"this"</b>?'], href: null }]);
    expect(html).toContain("&lt;b&gt;");
    expect(html).not.toContain("<b>");
  });

  it("is self-contained: no external stylesheet or script", () => {
    const html = coursePage(COURSE, LINKS);
    expect(html).not.toMatch(/<link[^>]+stylesheet/);
    expect(html).not.toMatch(/<script[^>]+src=/);
  });
});

// The door (spec §8): a public course's page is static — title, intro,
// lecture list and one link into the app, where joining is one click for a
// signed-in account. The join form, the progress marks and the code they
// minted lived in an inline script the page no longer carries.
describe("the door", () => {
  const SPANISH = { title: "Spanish", context: {}, lectures: [], warnings: [] };
  const JOIN = { courseKey: "h/d/spanish", app: "https://drawcast.app/" };

  test("the published page carries no script at all", () => {
    const html = coursePage(SPANISH, [], JOIN);
    expect(html).not.toContain("<script");
    expect(html).not.toContain("localStorage");
    expect(html).not.toContain("data-enroll");
    expect(html).not.toContain("data-cast");
  });
  test("it points at the app rather than trying to be one", () => {
    const html = coursePage(SPANISH, [], JOIN);
    expect(html).toMatch(/Join this course/i);
    expect(html).toContain("https://drawcast.app/#");
    expect(html).toContain('href="https://drawcast.app/#spanish"');
  });
  test("the door leads to the course's registered name: `name:` when set, else the slug at the end of the key", () => {
    expect(coursePage({ ...SPANISH, name: "Spanish-For-All" }, [], JOIN)).toContain('href="https://drawcast.app/#spanish-for-all"');
    expect(coursePage(SPANISH, [], { ...JOIN, courseKey: "h/d/courses/spanish-b1" })).toContain('href="https://drawcast.app/#spanish-b1"');
    expect(courseNameFor({ name: undefined }, "learn-russian")).toBe("learn-russian");
    expect(courseNameFor({ name: "Learn-Russian" }, "x")).toBe("learn-russian");
    // A name the rule rejects travels as written, so the publish can report it.
    expect(courseNameFor({ name: "gh-nope" }, "x")).toBe("gh-nope");
  });
  test("the door follows the app base the lecture links use, without a doubled slash", () => {
    expect(courseHref("https://drawcast.app/", "spanish")).toBe("https://drawcast.app/#spanish");
    expect(courseHref("https://my.site", "spanish")).toBe("https://my.site/#spanish");
    expect(coursePage(SPANISH, [], { ...JOIN, app: "https://my.site/" })).toContain('href="https://my.site/#spanish"');
  });
  test("without join data there is no door", () => {
    const html = coursePage(SPANISH, []);
    expect(html).not.toMatch(/Join this course/i);
    expect(html).not.toContain('class="join"');
  });
});

describe("repoIndexPage", () => {
  it("lists each course and links into its folder", () => {
    const html = repoIndexPage([{ slug: "causal", title: "Causal Inference", files: [], updated: "2026-08-30" }], "courses");
    expect(html).toContain("Causal Inference");
    expect(html).toContain('href="causal/"');
  });
});

describe("lectureHref", () => {
  it("joins the viewer base and the #gh= path", () => {
    expect(lectureHref("https://drawcast.app/", "o", "r", "courses/c/a.yaml")).toBe(
      "https://drawcast.app/#gh=o/r/courses/c/a.yaml",
    );
  });

  it("tolerates a base without a trailing slash", () => {
    expect(lectureHref("https://drawcast.app", "o", "r", "a.yaml")).toBe("https://drawcast.app/#gh=o/r/a.yaml");
  });
});
