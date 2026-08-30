import { readFile } from "node:fs/promises";
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

describe("the panel's own source", () => {
  // A blanket search-and-replace of deps.setStatus( -> the local reporter once
  // rewrote the call INSIDE that reporter, so every message recursed until the
  // stack blew — and because the text is assigned before the recursive call,
  // the message still appeared, which hid it. Cheap structural guard.
  it("has no function that calls itself unconditionally", async () => {
    const src = await readFile(new URL("../src/ui/course.ts", import.meta.url), "utf8");
    const decl = /\n\s*(?:export )?(?:async )?function (\w+)\s*\([^)]*\)[^{]*\{/g;
    let m: RegExpExecArray | null;
    let checked = 0;
    while ((m = decl.exec(src))) {
      const name = m[1];
      // Walk braces from the opening one so the body ends where it really does.
      let depth = 1;
      let i = m.index + m[0].length;
      for (; i < src.length && depth > 0; i++) {
        if (src[i] === "{") depth++;
        else if (src[i] === "}") depth--;
      }
      const body = src.slice(m.index + m[0].length, i - 1);
      expect(body, `${name}() calls itself`).not.toMatch(new RegExp(`(?<![.\\w])${name}\\s*\\(`));
      checked++;
    }
    expect(checked).toBeGreaterThan(5);
  });
});
