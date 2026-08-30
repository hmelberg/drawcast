import { describe, expect, it } from "vitest";
import { parseCourse } from "../src/course/document";
import { coursePage, escapeHtml, lectureHref, repoIndexPage } from "../src/course/page";

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
