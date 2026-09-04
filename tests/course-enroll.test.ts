import { describe, expect, test } from "vitest";
import { formatCourse, parseCourse } from "../src/course/document";

const DOC = `# Learn Russian
enroll: https://drawcast.anvil.app
name: learn-russian
level: beginner

Six short lectures.

## Cases
What is a case?
`;

describe("reserved course keys", () => {
  test("enroll and name leave the context and land on the course", () => {
    const c = parseCourse(DOC);
    expect(c.enroll).toBe("https://drawcast.anvil.app");
    expect(c.name).toBe("learn-russian");
    expect(c.context).toEqual({ level: "beginner" });
  });
  test("format → parse is stable", () => {
    const c = parseCourse(DOC);
    const again = parseCourse(formatCourse(c));
    expect(again.enroll).toBe(c.enroll);
    expect(again.name).toBe(c.name);
    expect(again.context).toEqual(c.context);
    expect(formatCourse(c)).toMatch(/^enroll: https:\/\/drawcast\.anvil\.app$/m);
  });
  test("a lecture-level enroll line is an ordinary lecture option", () => {
    const c = parseCourse("# T\n## L\nenroll: nope\n");
    expect(c.enroll).toBeUndefined();
    expect(c.lectures[0].options).toEqual({ enroll: "nope" });
  });
});
