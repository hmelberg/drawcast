import { describe, expect, it } from "vitest";
import { parseCourse } from "../src/course/document";
import { costPreview, lectureRowLabel } from "../src/ui/course";

const DOC = `# T
---
## A
Q?
#parts=4
status: done · id: a1
---
## B
Q?
#parts=3
`;

describe("lectureRowLabel", () => {
  it("marks a generated lecture as done", () => {
    expect(lectureRowLabel(parseCourse(DOC).lectures[0])).toContain("done");
  });

  it("marks an ungenerated lecture as pending", () => {
    expect(lectureRowLabel(parseCourse(DOC).lectures[1])).toContain("pending");
  });

  it("shows the error on a failed lecture", () => {
    const failed = parseCourse("# T\n---\n## A\nQ?\nstatus: failed · error: no spec\n");
    expect(lectureRowLabel(failed.lectures[0])).toContain("no spec");
  });
});

describe("costPreview", () => {
  it("counts only what still has to be generated", () => {
    // lecture A is done; lecture B is 1 outline + 3 parts
    expect(costPreview(parseCourse(DOC))).toContain("4");
  });

  it("says nothing is left when every lecture is done", () => {
    const all = DOC.replace("#parts=3", "#parts=3\nstatus: done · id: b1");
    expect(costPreview(parseCourse(all)).toLowerCase()).toContain("nothing");
  });
});
