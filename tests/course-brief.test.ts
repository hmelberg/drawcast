import { beforeEach, describe, expect, it, vi } from "vitest";

// A course's brief (audience, level): stored as the tag line under course.md's
// title, and carried into the planner, every lecture's request/storyboard and
// every part.

vi.mock("../src/llm/multi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/llm/multi")>();
  return { ...actual, outlineParts: vi.fn(), generateFromOutline: vi.fn() };
});

import { generateFromOutline, outlineParts } from "../src/llm/multi";
import { formatCourse, parseCourse, setCourseTag } from "../src/course/document";
import { buildCourseMessages, normalizeCoursePlan } from "../src/course/plan";
import { buildLectureRequest, estimateCalls, lectureTags, partsOf, runCourse, type RunHooks } from "../src/course/run";
import { BRIEF_CONTROLS, COURSE_BRIEF_CONTROLS, courseBriefFrom, courseBriefValue } from "../src/llm/brief-controls";
import { buildPartRequest, type Outline } from "../src/llm/outline";
import { buildStoryboardMessagesV2 } from "../src/llm/storyboard";
import type { GenerateConfig, PromptVariant } from "../src/llm/compile";

const OLD = `# Causal Inference
level: master students
example: job training

Intro line.

---
## Potential outcomes
What is a counterfactual?
#why #parts=4

---
## Difference-in-differences
What breaks parallel trends?
#parts=3
`;

describe("the course brief in course.md", () => {
  it("a course without a header tag line parses exactly as before (no tags key)", () => {
    const course = parseCourse(OLD);
    expect("tags" in course).toBe(false);
    expect(course.lectures[0].tags).toEqual(["#why", "#parts=4"]);
    expect(formatCourse(course)).not.toMatch(/^#for|^#basic/m);
  });

  it("reads the tag line under the title as the course's tags, not a lecture's", () => {
    const text = OLD.replace("example: job training\n", "example: job training\n#for=nurses #basic\n");
    const course = parseCourse(text);
    expect(course.tags).toEqual(["#for=nurses", "#basic"]);
    expect(course.lectures[0].tags).toEqual(["#why", "#parts=4"]);
    expect(course.context).toEqual({ level: "master students", example: "job training" });
    expect(course.intro).toBe("Intro line.");
  });

  it("round-trips through formatCourse", () => {
    const course = parseCourse(OLD);
    course.tags = ["#professionals", "#advanced"];
    const text = formatCourse(course);
    expect(text).toContain("example: job training\n#professionals #advanced\n");
    expect(parseCourse(text).tags).toEqual(["#professionals", "#advanced"]);
  });

  it("setCourseTag adds the line after the options, replaces within a group, and removes it when empty", () => {
    let text = setCourseTag(OLD, "audience", "for=nurses");
    expect(text).toContain("example: job training\n#for=nurses\n");
    text = setCourseTag(text, "level", "basic");
    expect(parseCourse(text).tags).toEqual(["#for=nurses", "#basic"]);
    text = setCourseTag(text, "audience", "students");
    expect(parseCourse(text).tags).toEqual(["#basic", "#students"]);
    // Lectures untouched.
    expect(parseCourse(text).lectures.map((l) => l.tags)).toEqual([["#why", "#parts=4"], ["#parts=3"]]);
    text = setCourseTag(setCourseTag(text, "audience", ""), "level", "");
    expect(text).toBe(OLD);
  });

  it("setCourseTag keeps a hand-written course tag of another group", () => {
    const text = OLD.replace("example: job training\n", "example: job training\n#norwegian\n");
    expect(parseCourse(setCourseTag(text, "level", "advanced")).tags).toEqual(["#norwegian", "#advanced"]);
  });
});

describe("courseBriefFrom and the course controls", () => {
  it("reuses the single drawcast's option lists, without Length", () => {
    expect(COURSE_BRIEF_CONTROLS.map((c) => c.group)).toEqual(["audience", "level"]);
    expect(COURSE_BRIEF_CONTROLS[0]).toBe(BRIEF_CONTROLS[0]);
  });

  it("takes a typed tag over the control, and strips it from the request", () => {
    const r = courseBriefFrom("Diabetes care, six lectures #for=nurses", { audience: "students", level: "basic" });
    expect(r.tags).toEqual(["#for=nurses", "#basic"]);
    expect(r.request).toBe("Diabetes care, six lectures");
  });

  it("leaves the request untouched when there is no brief", () => {
    expect(courseBriefFrom("Diabetes #why", {})).toEqual({ request: "Diabetes #why", tags: [] });
  });

  it("reads a course's current choice per group", () => {
    expect(courseBriefValue(["#for=icu-nurses", "#basic"], "audience")).toBe("for=icu-nurses");
    expect(courseBriefValue(["#basic"], "audience")).toBe("");
    expect(courseBriefValue(undefined, "level")).toBe("");
  });
});

describe("the brief reaches the planner", () => {
  it("adds the brief's sentences to the planner's user message", () => {
    const { user } = buildCourseMessages("Diabetes care", null, ["#for=nurses", "#basic"]);
    expect(user).toContain("Diabetes care");
    expect(user).toContain("#for=nurses #basic");
    expect(user).toContain("Audience: nurses.");
    expect(user).toContain("Audience: beginners.");
  });

  it("leaves the planner's messages as before without one", () => {
    expect(buildCourseMessages("Diabetes care", null).user).toBe("Diabetes care");
    expect(buildCourseMessages("Diabetes care", null, []).user).toBe("Diabetes care");
  });

  it("a plan normalized and given the brief formats with the tag line", () => {
    const course = normalizeCoursePlan({ title: "T", lectures: [{ title: "A", questions: ["q"] }, { title: "B", questions: ["q"] }] })!;
    course.tags = ["#for=nurses"];
    expect(formatCourse(course)).toMatch(/^# T\n#for=nurses\n/);
  });
});

describe("the brief reaches every lecture", () => {
  const text = OLD.replace("example: job training\n", "example: job training\n#for=nurses #basic\n");
  const course = parseCourse(text);

  it("lectureTags puts the course's first, so a lecture's own tag wins its group", () => {
    expect(lectureTags(course, course.lectures[0])).toEqual(["#for=nurses", "#basic", "#why", "#parts=4"]);
    expect(lectureTags(parseCourse(OLD), parseCourse(OLD).lectures[0])).toEqual(["#why", "#parts=4"]);
  });

  it("the lecture request ends with the course's tags and the lecture's", () => {
    expect(buildLectureRequest(course, 1).split("\n").at(-1)).toBe("#for=nurses #basic #parts=3");
  });

  it("parts and the call estimate are unchanged by a brief", () => {
    expect(partsOf(course.lectures[0], course)).toBe(4);
    expect(estimateCalls(course)).toBe(estimateCalls(parseCourse(OLD)));
  });

  it("a course-level #parts=N applies where the lecture sets none", () => {
    const c = parseCourse("# C\n#parts=2\n\n## A\nq\n\n## B\nq\n#parts=5\n");
    expect(c.lectures.map((l) => partsOf(l, c))).toEqual([2, 5]);
  });

  describe("runCourse", () => {
    const VARIANT: PromptVariant = { name: "t", source: "" };
    const cfg: GenerateConfig = { apiKey: "k", model: "claude-opus-5", variant: VARIANT, exemplars: [] };
    const hooks: RunHooks = { onLecture: () => {}, onProgress: () => {}, onDocument: () => {} };
    const OUTLINE: Outline = { title: "L", parts: [{ title: "a", brief: "" }] };

    beforeEach(() => {
      vi.mocked(outlineParts).mockReset();
      vi.mocked(generateFromOutline).mockReset();
      vi.mocked(outlineParts).mockResolvedValue({ outline: OUTLINE });
      vi.mocked(generateFromOutline).mockResolvedValue({ outline: OUTLINE, specs: [], chapterOf: [], failed: [1], error: "x" });
    });

    it("gives every lecture's storyboard and parts the course's brief, a lecture's own tag winning", async () => {
      const t = text.replace("#why #parts=4", "#why #advanced #parts=4");
      await runCourse(t, cfg, hooks, () => "id");
      const briefs = vi.mocked(outlineParts).mock.calls.map((c) => c[0].brief);
      expect(briefs[0]).toContain("Audience: nurses.");
      expect(briefs[0]).toContain("Audience: advanced.");
      expect(briefs[0]).not.toContain("Audience: beginners.");
      expect(briefs[1]).toContain("Audience: nurses.");
      expect(briefs[1]).toContain("Audience: beginners.");
      // The same request goes on to the parts.
      const partBriefs = vi.mocked(generateFromOutline).mock.calls.map((c) => c[0].brief);
      expect(partBriefs.sort()).toEqual([...briefs].sort());
    });

    it("the storyboard and part requests carry the brief they are handed", async () => {
      await runCourse(text, cfg, hooks, () => "id");
      const req = vi.mocked(outlineParts).mock.calls[0][0];
      expect(buildStoryboardMessagesV2(req.request, req.parts, { brief: req.brief }).user).toContain("Audience: nurses.");
      const outline: Outline = { title: "L", parts: [{ title: "a", brief: "b" }, { title: "c", brief: "d" }] };
      expect(buildPartRequest(req.request, outline, 0, req.brief, "v2")).toContain("Audience: nurses.");
      expect(buildPartRequest(req.request, outline, 0, req.brief, "v1")).toContain("Audience: beginners.");
    });
  });
});
