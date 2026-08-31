// Four sections, all built the same way. Courses come out of the library —
// nesting them there made a course both a library item and not one — and every
// section can be closed, because a menu that only grows is a menu you scroll.

import type { SavedCourse, SavedDrawing } from "../store";
import { h } from "./dom";

export interface SectionInput {
  library: { title: string; courseId?: string }[];
  /** `lectures` are each lecture's own title — a course with ten lectures is
   *  exactly the case search has to see into, or a hit inside it just
   *  vanishes from the menu instead of surfacing the course that has it. */
  courses: { id: string; title: string; lectures: string[] }[];
  examples: { title: string }[];
  templates: { id: string }[];
}

export interface SectionModel {
  id: string;
  label: string;
  /** Matching the filter. Equals `total` when there is no filter. */
  shown: number;
  total: number;
  open: boolean;
}

/** Library and Examples are what you reach for; four open lists is a tall menu. */
const DEFAULT_OPEN: Record<string, boolean> = { library: true, courses: false, examples: true, templates: false };

export function sidebarSections(input: SectionInput, filter: string, openState: Record<string, boolean>): SectionModel[] {
  const f = filter.trim().toLowerCase();
  const match = (t: string): boolean => f === "" || t.toLowerCase().includes(f);
  const libraryTitles = input.library.filter((i) => !i.courseId).map((i) => i.title);
  const exampleTitles = input.examples.map((e) => e.title);
  const templateTitles = input.templates.map((t) => t.id);
  // A course counts as a hit on its own title OR any of its lectures' — a
  // course whose title never matches is still where a matching lecture
  // lives, and hiding the course would hide the lecture too.
  const courseHits = input.courses.filter((c) => match(c.title) || c.lectures.some(match)).length;
  const specs: { id: string; label: string; shown: number; total: number }[] = [
    { id: "library", label: "📚 Library", shown: libraryTitles.filter(match).length, total: libraryTitles.length },
    { id: "courses", label: "🎓 Courses", shown: courseHits, total: input.courses.length },
    { id: "examples", label: "✨ Examples", shown: exampleTitles.filter(match).length, total: exampleTitles.length },
    { id: "templates", label: "✦ Templates", shown: templateTitles.filter(match).length, total: templateTitles.length },
  ];
  return specs.map(({ id, label, shown, total }) => {
    const remembered = openState[id] ?? DEFAULT_OPEN[id];
    // A filter overrides the remembered state only upwards: it opens a closed
    // section that has hits, and never closes one the author opened.
    return { id, label, shown, total, open: f !== "" && shown > 0 ? true : remembered };
  });
}

/** "3 of 12" while a filter narrows the list, "(12)" otherwise. */
export function sectionCountLabel(model: SectionModel): string {
  return model.shown === model.total ? `(${model.total})` : `${model.shown} of ${model.total}`;
}

export interface SidebarSection {
  details: HTMLDetailsElement;
  /** The content host inside the details — the caller populates this. */
  list: HTMLElement;
}

/**
 * One of the sidebar's four uniform sections: a `<details>` whose `<summary>`
 * carries the label and a live count (the native disclosure triangle is the
 * caret — nothing in this codebase suppresses it). `onToggle` fires only on a
 * genuine click, with the native toggle suppressed (`preventDefault`) — open
 * state is driven entirely by `applySection` afterwards, so a filter's
 * temporary auto-expand (see `sidebarSections`) never overwrites what the
 * user actually remembered.
 */
export function createSidebarSection(onToggle: (nextOpen: boolean) => void): SidebarSection {
  const list = h("div", { class: "library-list" });
  const summary = h("summary", { class: "sidebar-heading" }, "");
  const details = h("details", { class: "sidebar-section" }, summary, list);
  summary.addEventListener("click", (e) => {
    e.preventDefault();
    onToggle(!details.open);
  });
  return { details, list };
}

/** Sync a section's header text and open state to its computed model. */
export function applySection(section: SidebarSection, model: SectionModel): void {
  const summary = section.details.querySelector("summary")!;
  summary.textContent = `${model.label} ${sectionCountLabel(model)}`;
  section.details.open = model.open;
}

/**
 * One saved course's row inside the Courses section: title and lecture count
 * as a `<details>` summary, its lectures inline when expanded — the exact
 * shape `refreshLibrary`'s per-course grouping used to build inside the
 * library, moved out and now driven by every saved course rather than only
 * the ones with a lecture already in view. Two separate targets inside the
 * one summary: the title button opens the course panel, the rest of the
 * summary (its native disclosure marker included) is the free `<details>`
 * toggle — so a lecture list can be peeked at without ever opening the
 * panel over it.
 */
export function courseGroup(course: SavedCourse, lectures: SavedDrawing[], row: (item: SavedDrawing) => HTMLElement, onOpen: () => void): HTMLDetailsElement {
  const group = h("details", { class: "library-course" });
  const title = course.title || "Course";
  const titleBtn = h("button", { class: "library-open" }, `🎓 ${title}`);
  titleBtn.addEventListener("click", (e) => {
    // The <details> toggle is this click's DEFAULT ACTION, not a listener —
    // stopPropagation alone would not stop it, so preventDefault is the one
    // that matters here; stopPropagation is kept too, so opening the panel
    // never also reaches some future listener on an ancestor.
    e.preventDefault();
    e.stopPropagation();
    onOpen();
  });
  const count = h("span", { class: "row-note" }, `${lectures.length} lecture${lectures.length === 1 ? "" : "s"}`);
  const summary = h("summary", {}, titleBtn, count);
  group.append(summary, ...lectures.map(row));
  return group;
}
