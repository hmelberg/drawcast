import { describe, expect, it } from "vitest";
import { referencedLectureIds, formatCourse, parseCourse, setCourseOption, setLectureStatus  } from "../src/course/document";

const DOC = `# Causal Inference
level: advanced · minutes: 5
notation: Y(1)/Y(0), D treatment

A master-level introduction.

---
## Potential outcomes
What is a counterfactual outcome?
Why are ATE and ATT different?
#why #parts=4
status: done · id: a3f9c1 · file: potential-outcomes.yaml · 2026-08-30

---
## Difference-in-differences
What does parallel trends claim?
#controversy #quiz
`;

describe("parseCourse", () => {
  it("reads the title, context and intro", () => {
    const c = parseCourse(DOC);
    expect(c.title).toBe("Causal Inference");
    expect(c.context.level).toBe("advanced");
    expect(c.context.minutes).toBe("5");
    expect(c.context.notation).toBe("Y(1)/Y(0), D treatment");
    expect(c.intro).toBe("A master-level introduction.");
  });

  it("splits lectures on ## and keeps questions verbatim", () => {
    const c = parseCourse(DOC);
    expect(c.lectures).toHaveLength(2);
    expect(c.lectures[0].title).toBe("Potential outcomes");
    expect(c.lectures[0].questions).toEqual([
      "What is a counterfactual outcome?",
      "Why are ATE and ATT different?",
    ]);
  });

  it("reads tags as raw tokens", () => {
    expect(parseCourse(DOC).lectures[0].tags).toEqual(["#why", "#parts=4"]);
  });

  it("round-trips status", () => {
    const s = parseCourse(DOC).lectures[0].status;
    expect(s).toEqual({ state: "done", id: "a3f9c1", file: "potential-outcomes.yaml", ts: "2026-08-30" });
  });

  it("distinguishes a heading from a tag line", () => {
    const c = parseCourse("# Title\n---\n## L\n#why #fun\n");
    expect(c.title).toBe("Title");
    expect(c.lectures[0].tags).toEqual(["#why", "#fun"]);
    expect(c.lectures[0].questions).toEqual([]);
  });

  it("reads ### as a chapter", () => {
    const c = parseCourse("# T\n---\n## L\n### Parallel trends\nWhat breaks it?\n");
    expect(c.lectures[0].chapters).toEqual(["Parallel trends"]);
    expect(c.lectures[0].questions).toEqual(["What breaks it?"]);
  });

  it("warns on #### and keeps its text as a question", () => {
    const c = parseCourse("# T\n---\n## L\n#### Too deep\n");
    expect(c.warnings.some((w) => w.includes("####"))).toBe(true);
    expect(c.lectures[0].questions).toEqual(["Too deep"]);
  });

  it("treats an unknown key as context, not an error", () => {
    const c = parseCourse("# T\naudience: nurses\n---\n## L\nQ?\n");
    expect(c.context.audience).toBe("nurses");
    expect(c.warnings).toEqual([]);
  });

  it("does not mistake a capitalised question for an option", () => {
    const c = parseCourse("# T\n---\n## L\nWhy: does it matter?\n");
    expect(c.lectures[0].questions).toEqual(["Why: does it matter?"]);
    expect(c.lectures[0].options).toEqual({});
  });

  it("caps the lecture count and warns", () => {
    const many = "# T\n" + "\n---\n## L\nQ?\n".repeat(25);
    const c = parseCourse(many);
    expect(c.lectures).toHaveLength(20);
    expect(c.warnings.some((w) => w.includes("20"))).toBe(true);
  });
});

describe("formatCourse", () => {
  it("is stable under parse → format → parse", () => {
    const once = parseCourse(DOC);
    const twice = parseCourse(formatCourse(once));
    expect(twice.lectures).toEqual(once.lectures);
    expect(twice.title).toBe(once.title);
    expect(twice.context).toEqual(once.context);
  });
});

describe("setLectureStatus", () => {
  it("adds a status line without touching anything else", () => {
    const out = setLectureStatus(DOC, 1, { state: "done", id: "b7", ts: "2026-08-31" });
    expect(out).toContain("status: done · id: b7 · 2026-08-31");
    // every original line except the new one survives byte-identically
    for (const line of DOC.split("\n")) {
      if (line.trim()) expect(out).toContain(line);
    }
  });

  it("replaces an existing status line in place", () => {
    const out = setLectureStatus(DOC, 0, { state: "failed", error: "no spec" });
    expect(out).toContain("status: failed · error: no spec");
    expect(out).not.toContain("id: a3f9c1");
    expect(out).toContain("## Difference-in-differences");
  });
});

describe("setCourseOption", () => {
  it("adds a header key without touching anything else", () => {
    const out = setCourseOption(DOC, "slug", "causal");
    expect(out).toContain("slug: causal");
    for (const line of DOC.split("\n")) {
      if (line.trim()) expect(out).toContain(line);
    }
  });

  it("replaces an existing one in place", () => {
    const once = setCourseOption(DOC, "slug", "causal");
    const twice = setCourseOption(once, "slug", "other");
    expect(twice).toContain("slug: other");
    expect(twice).not.toContain("slug: causal");
    expect(twice.match(/slug:/g)).toHaveLength(1);
  });

  it("puts it in the header, never inside a lecture", () => {
    const out = setCourseOption(DOC, "slug", "causal");
    expect(out.indexOf("slug: causal")).toBeLessThan(out.indexOf("## Potential outcomes"));
    expect(parseCourse(out).context.slug).toBe("causal");
    expect(parseCourse(out).lectures[0].options.slug).toBeUndefined();
  });
});

describe("referencedLectureIds", () => {
  it("collects status ids in document order, skipping unfinished lectures", () => {
    const text = [
      "# C",
      "---",
      "## One",
      "q?",
      "status: done · id: aaa · 2026-09-01",
      "---",
      "## Two (pending, no id)",
      "q?",
      "---",
      "## Three",
      "q?",
      "status: done · id: bbb · 2026-09-01",
    ].join("\n");
    expect(referencedLectureIds(text)).toEqual(["aaa", "bbb"]);
  });

  it("an empty or planless document references nothing", () => {
    expect(referencedLectureIds("")).toEqual([]);
  });
});
