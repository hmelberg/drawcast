// Course revision: text in, text out — and the status lines, which cost real
// money to lose, are carried across deterministically rather than by asking
// the model nicely.

import { describe, expect, it } from "vitest";
import { applyStatuses, buildCourseReviseUser, statusesByTitle, stripStatusLines, acceptRevision } from "../src/course/revise";
import { parseCourse } from "../src/course/document";

const DOC = `# Causal Inference
level: advanced

---
## Potential outcomes
What is a counterfactual outcome?
#why #parts=4
status: done · id: a3f9c1 · 2026-08-30

---
## Difference-in-differences
What breaks parallel trends?
#controversy #parts=3
`;

describe("stripStatusLines", () => {
  it("removes every status line", () => {
    expect(stripStatusLines(DOC)).not.toContain("status:");
  });

  it("leaves everything else byte-identical", () => {
    const out = stripStatusLines(DOC);
    for (const line of DOC.split("\n")) {
      if (line.trim() && !line.startsWith("status:")) expect(out).toContain(line);
    }
  });
});

describe("buildCourseReviseUser", () => {
  it("carries the document and the instruction", () => {
    const msg = buildCourseReviseUser(DOC, "add a lecture on synthetic control");
    expect(msg).toContain("Potential outcomes");
    expect(msg).toContain("add a lecture on synthetic control");
  });

  it("never sends status lines to the model", () => {
    expect(buildCourseReviseUser(DOC, "x")).not.toContain("a3f9c1");
  });
});

describe("applyStatuses", () => {
  const statuses = statusesByTitle(DOC);

  it("restores a surviving lecture's status by title", () => {
    const revised = `# Causal Inference
---
## Potential outcomes
What is a counterfactual outcome, really?
#why #parts=4
---
## Difference-in-differences
What breaks parallel trends?
#controversy #parts=3
`;
    const out = parseCourse(applyStatuses(revised, statuses));
    expect(out.lectures[0].status?.id).toBe("a3f9c1");
    expect(out.lectures[1].status).toBeUndefined();
  });

  it("drops the status of a lecture that was renamed", () => {
    const revised = "# C\n---\n## Counterfactuals\nQ?\n---\n## DiD\nQ?\n";
    const out = parseCourse(applyStatuses(revised, statuses));
    expect(out.lectures[0].status).toBeUndefined();
  });

  it("keeps a status when a new lecture is inserted before it", () => {
    const revised = `# Causal Inference
---
## Motivation
Why bother?
---
## Potential outcomes
What is a counterfactual outcome?
#why #parts=4
`;
    const out = parseCourse(applyStatuses(revised, statuses));
    expect(out.lectures[0].status).toBeUndefined();
    expect(out.lectures[1].status?.id).toBe("a3f9c1");
  });
});

describe("acceptRevision", () => {
  it("accepts a plain document", () => {
    expect(acceptRevision("# T\n---\n## A\nQ?\n").text).toContain("## A");
  });

  it("strips a markdown fence", () => {
    const reply = "```markdown\n# T\n---\n## A\nQ?\n```";
    expect(acceptRevision(reply).text).toContain("## A");
    expect(acceptRevision(reply).text).not.toContain("```");
  });

  it("rejects a reply with no lectures", () => {
    expect(acceptRevision("Sure! I can help with that.").text).toBeNull();
    expect(acceptRevision("Sure! I can help with that.").error).toBeTruthy();
  });

  it("rejects an empty reply", () => {
    expect(acceptRevision("").text).toBeNull();
  });
});
