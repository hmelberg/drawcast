import { describe, expect, it } from "vitest";
import { buildCourseMessages, normalizeCoursePlan } from "../src/course/plan";
import { formatCourse, parseCourse } from "../src/course/document";

describe("buildCourseMessages", () => {
  it("hands the model the tag vocabulary", () => {
    const { system } = buildCourseMessages("causal inference, master level", 8);
    expect(system).toContain("#controversy");
    expect(system).toContain("#quiz");
  });

  it("asks for exactly the requested lecture count when given", () => {
    expect(buildCourseMessages("x", 8).system).toContain("exactly 8");
  });

  it("carries the fabrication guardrail", () => {
    expect(buildCourseMessages("x", null).system).toContain("Never manufacture");
  });
});

describe("normalizeCoursePlan", () => {
  const good = {
    title: "Causal Inference",
    context: { level: "advanced", notation: "Y(1)/Y(0)" },
    intro: "A master-level course.",
    lectures: [
      { title: "Potential outcomes", questions: ["What is a counterfactual?"], tags: ["why", "parts=4"] },
      { title: "DiD", questions: ["What breaks parallel trends?"], tags: ["controversy"] },
    ],
  };

  it("normalizes a well-formed plan", () => {
    const course = normalizeCoursePlan(good);
    expect(course?.title).toBe("Causal Inference");
    expect(course?.lectures).toHaveLength(2);
    expect(course?.context.notation).toBe("Y(1)/Y(0)");
  });

  it("prefixes tags with # so the document format is canonical", () => {
    expect(normalizeCoursePlan(good)?.lectures[0].tags).toEqual(["#why", "#parts=4"]);
  });

  it("keeps a tag that already carries its #", () => {
    const course = normalizeCoursePlan({ ...good, lectures: [{ title: "A", questions: ["Q?"], tags: ["#why"] }, { title: "B" }] });
    expect(course?.lectures[0].tags).toEqual(["#why"]);
  });

  it("survives a lecture with only a title", () => {
    const course = normalizeCoursePlan({ title: "T", lectures: [{ title: "A" }, { title: "B" }] });
    expect(course?.lectures).toHaveLength(2);
    expect(course?.lectures[0].questions).toEqual([]);
  });

  it("rejects a plan with fewer than two lectures", () => {
    expect(normalizeCoursePlan({ title: "T", lectures: [{ title: "A" }] })).toBeNull();
    expect(normalizeCoursePlan({ title: "T" })).toBeNull();
    expect(normalizeCoursePlan(null)).toBeNull();
  });

  it("caps the lecture count", () => {
    const many = { title: "T", lectures: Array.from({ length: 30 }, (_, i) => ({ title: `L${i}` })) };
    expect(normalizeCoursePlan(many)?.lectures).toHaveLength(20);
  });

  it("produces a document that parses back to the same lectures", () => {
    const course = normalizeCoursePlan(good)!;
    const round = parseCourse(formatCourse(course));
    expect(round.lectures.map((l) => l.title)).toEqual(["Potential outcomes", "DiD"]);
    expect(round.lectures[0].tags).toEqual(["#why", "#parts=4"]);
  });
});

describe("taste lives in the planner, not the runner", () => {
  it("steers the planner toward why and how", () => {
    const system = buildCourseMessages("x", null).system;
    expect(system).toContain("why and how");
  });

  it("tells the planner that presentation lectures are legitimate", () => {
    const system = buildCourseMessages("x", null).system;
    expect(system.toLowerCase()).toContain("not every lecture is an argument");
    expect(system).toContain("#data");
  });

  it("tells the planner to leave a teacher's topics alone", () => {
    expect(buildCourseMessages("x", null).system).toContain("keep them as topics");
  });
});
