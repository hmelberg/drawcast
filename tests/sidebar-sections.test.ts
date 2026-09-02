import { describe, expect, it } from "vitest";
import { accordionOpenState, sidebarSections, type SectionInput  } from "../src/ui/sidebar";

const input: SectionInput = {
  library: [{ title: "Ricardo on trade" }, { title: "Lecture 1", courseId: "c1" }, { title: "Lecture 2", courseId: "c1" }],
  courses: [{ id: "c1", title: "Causal inference", lectures: ["Lecture 1", "Lecture 2"] }],
  examples: [{ title: "Supply and demand" }, { title: "Ricardo" }],
  templates: [{ id: "t1" }],
};

describe("sidebarSections", () => {
  it("lists four sections in reading order", () => {
    expect(sidebarSections(input, "", {}).map((s) => s.id)).toEqual(["library", "courses", "examples", "templates"]);
  });

  it("keeps lectures out of the library — a course is not also a loose item", () => {
    const lib = sidebarSections(input, "", {})[0];
    expect(lib.total).toBe(1);
  });

  it("defaults only library open — one expanded list keeps the sidebar inside the viewport", () => {
    const open = Object.fromEntries(sidebarSections(input, "", {}).map((s) => [s.id, s.open]));
    expect(open).toEqual({ library: true, courses: false, examples: false, templates: false });
  });

  it("honours a remembered state over the default", () => {
    const open = Object.fromEntries(sidebarSections(input, "", { courses: true, library: false }).map((s) => [s.id, s.open]));
    expect(open.courses).toBe(true);
    expect(open.library).toBe(false);
  });

  it("auto-expands a closed section that has matches — a hit inside a closed\n     section is a hit that does not exist", () => {
    const courses = sidebarSections(input, "causal", {}).find((s) => s.id === "courses")!;
    expect(courses.open).toBe(true);
    expect(courses.shown).toBe(1);
  });

  it("reports shown-of-total while filtering", () => {
    const ex = sidebarSections(input, "ricardo", {}).find((s) => s.id === "examples")!;
    expect([ex.shown, ex.total]).toEqual([1, 2]);
  });

  it("does not auto-expand a section with no matches", () => {
    expect(sidebarSections(input, "zzz", {}).find((s) => s.id === "courses")!.open).toBe(false);
  });

  it("counts a course as a match when a lecture title matches, even though the course's own title doesn't", () => {
    const courses = sidebarSections(input, "lecture 1", {}).find((s) => s.id === "courses")!;
    expect(courses.shown).toBe(1);
    expect(courses.open).toBe(true);
  });
});

describe("accordionOpenState", () => {
  it("opening one section closes the others", () => {
    expect(accordionOpenState({ library: true, examples: true }, "courses", true)).toEqual({
      library: false, courses: true, examples: false, templates: false,
    });
  });

  it("closing writes only the closed one — nothing else springs open", () => {
    expect(accordionOpenState({ library: true }, "library", false)).toEqual({ library: false });
  });
});
