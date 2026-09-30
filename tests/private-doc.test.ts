// Task 10 fix round 2: a lecture of a private course, opened on its own, is
// private too — whatever flag its library row happens to carry. The guards
// on every plaintext upload (Save source, Drive, drawcast server) ask
// isPrivateDrawing, never a copied flag alone.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isPrivateDrawing, keptRowFields } from "../src/private-doc";

const course = (priv: boolean, id = "L1") => `# Course
${priv ? "private: true\n" : ""}---
## One
Q?
status: done · id: ${id}
`;

describe("isPrivateDrawing", () => {
  it("a lecture row whose courseId names a private course is private", () => {
    expect(isPrivateDrawing({ id: "L1" }, [{ id: "L1", courseId: "C" }], [{ id: "C", text: course(true) }])).toBe(true);
  });
  it("a lecture of a public course is not", () => {
    expect(isPrivateDrawing({ id: "L1" }, [{ id: "L1", courseId: "C" }], [{ id: "C", text: course(false) }])).toBe(false);
  });
  it("a lecture a private course's document names is private even without a courseId", () => {
    expect(isPrivateDrawing({ id: "L1" }, [{ id: "L1" }], [{ id: "C", text: course(true) }])).toBe(true);
  });
  it("the doc's own flag, or the row's, is enough", () => {
    expect(isPrivateDrawing({ id: "X", private: true }, [], [])).toBe(true);
    expect(isPrivateDrawing({ id: "X" }, [{ id: "X", private: true }], [])).toBe(true);
  });
  it("a fresh document with no id is public", () => {
    expect(isPrivateDrawing({ id: null }, [], [{ id: "C", text: course(true) }])).toBe(false);
  });
});

describe("every plaintext upload asks isPrivateDoc()", () => {
  const main = readFileSync("src/main.ts", "utf8");
  const fn = (name: string) => main.slice(main.indexOf(`async function ${name}(`), main.indexOf("\n}\n", main.indexOf(`async function ${name}(`)));
  for (const name of ["saveSourceToGithub", "publishServerCast", "publishDriveCast"]) {
    it(name, () => {
      expect(fn(name)).toContain("if (isPrivateDoc())");
      expect(fn(name)).not.toContain("if (doc.private)");
    });
  }
  it("isPrivateDoc reads the library and the courses", () => {
    expect(main).toMatch(/function isPrivateDoc\(\): boolean \{\s*return isPrivateDrawing\(doc, loadLibrary\(\), loadCourses\(\)\);/);
  });
});

describe("ui/course.ts marks a private course's lecture rows private", () => {
  const src = readFileSync("src/ui/course.ts", "utf8");
  it("store() writes private on a lecture of a private course", () => {
    const body = src.slice(src.indexOf("function store("), src.indexOf("function loadLecture("));
    expect(body).toMatch(/private: parseCourse\(doc\.value\)\.private \? true : undefined/);
  });
  it("a private publish marks the course's existing lecture rows", () => {
    const body = src.slice(src.indexOf("async function publish("), src.indexOf("function showLinks("));
    expect(body).toContain("markDrawingsPrivate(");
  });
});

describe("autosave never clears what makes a row private (fix round 3)", () => {
  it("an existing row {private, courseId} autosaved from a doc without them keeps both", () => {
    expect(keptRowFields({}, { private: true, courseId: "c1" })).toEqual({ private: true, courseId: "c1" });
  });
  it("the doc's own private is kept; nothing existing is nothing kept", () => {
    expect(keptRowFields({ private: true }, undefined)).toEqual({ private: true, courseId: undefined });
    expect(keptRowFields({}, undefined)).toEqual({ private: undefined, courseId: undefined });
  });
  it("only an explicit make-public (doc.private === false) clears it", () => {
    expect(keptRowFields({ private: false }, { private: true, courseId: "c1" })).toEqual({ private: undefined, courseId: "c1" });
  });
  it("main.ts autosave merges from the existing row, and an opened lecture of a private course is private in memory", () => {
    const main = readFileSync("src/main.ts", "utf8");
    const save = main.slice(main.indexOf("function autosave("), main.indexOf("\n}\n", main.indexOf("function autosave(")));
    expect(save).toContain("...keptRowFields(doc, loadLibrary().find((d) => d.id === doc.id))");
    expect(save).not.toContain("private: doc.private,");
    const open = main.slice(main.indexOf("function docFromSaved("), main.indexOf("\n}\n", main.indexOf("function docFromSaved(")));
    expect(open).toContain("isPrivateDrawing(");
  });
});
