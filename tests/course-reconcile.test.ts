import { describe, expect, it } from "vitest";
import { parseCourse } from "../src/course/document";
import { matchLibrary, restoredStatus } from "../src/course/reconcile";

const DOC = `# Causal Inference
---
## Potential outcomes
Q?
---
## Difference-in-differences
Q?
status: done · id: kept · file: did.yaml
---
## Regression discontinuity
Q?
---
## Never made
Q?
`;

const course = parseCourse(DOC);

describe("matchLibrary", () => {
  it("finds a lecture whose drawcast is in the library but whose status was lost", () => {
    const matches = matchLibrary(course, [{ id: "a1", title: "Potential outcomes", courseId: "c1" }], "c1");
    expect(matches).toEqual([{ index: 0, id: "a1", title: "Potential outcomes" }]);
  });

  it("leaves a lecture that is already done alone", () => {
    const matches = matchLibrary(course, [{ id: "other", title: "Difference-in-differences", courseId: "c1" }], "c1");
    expect(matches).toEqual([]);
  });

  it("ignores a drawcast belonging to a different course", () => {
    expect(matchLibrary(course, [{ id: "x", title: "Potential outcomes", courseId: "other" }], "c1")).toEqual([]);
  });

  it("accepts a drawcast with no course, since older rows carry none", () => {
    expect(matchLibrary(course, [{ id: "x", title: "Potential outcomes" }], "c1")).toHaveLength(1);
  });

  it("never points two lectures at the same drawcast", () => {
    const twins = parseCourse("# C\n---\n## Same\nQ?\n---\n## Same\nQ?\n");
    const matches = matchLibrary(twins, [{ id: "only", title: "Same" }], null);
    expect(matches).toHaveLength(1);
  });

  it("never hands out an id the document already claims", () => {
    const matches = matchLibrary(course, [{ id: "kept", title: "Potential outcomes" }], "c1");
    expect(matches).toEqual([]);
  });

  it("matches case- and space-insensitively", () => {
    expect(matchLibrary(course, [{ id: "a1", title: "  potential OUTCOMES " }], "c1")).toHaveLength(1);
  });

  it("takes the newest when several share a title (the library is newest first)", () => {
    const matches = matchLibrary(
      course,
      [
        { id: "new", title: "Potential outcomes" },
        { id: "old", title: "Potential outcomes" },
      ],
      "c1",
    );
    expect(matches[0].id).toBe("new");
  });

  it("leaves a lecture with no drawcast to be generated", () => {
    const matches = matchLibrary(course, [{ id: "a1", title: "Potential outcomes" }], "c1");
    expect(matches.map((m) => m.title)).not.toContain("Never made");
  });
});

describe("restoredStatus", () => {
  it("marks the lecture done with its drawcast's id", () => {
    expect(restoredStatus("a1")).toMatchObject({ state: "done", id: "a1" });
  });

  it("keeps a published file name, so the link does not move", () => {
    expect(restoredStatus("a1", { state: "done", id: "old", file: "did.yaml" }).file).toBe("did.yaml");
  });
});
