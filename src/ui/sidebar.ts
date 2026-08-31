// Four sections, all built the same way. Courses come out of the library —
// nesting them there made a course both a library item and not one — and every
// section can be closed, because a menu that only grows is a menu you scroll.

import type { SavedCourse, SavedDrawing } from "../store";
import { h } from "./dom";

export interface SectionInput {
  library: { title: string; courseId?: string }[];
  courses: { id: string; title: string }[];
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
  const specs: { id: string; label: string; titles: string[] }[] = [
    { id: "library", label: "📚 Library", titles: input.library.filter((i) => !i.courseId).map((i) => i.title) },
    { id: "courses", label: "🎓 Courses", titles: input.courses.map((c) => c.title) },
    { id: "examples", label: "✨ Examples", titles: input.examples.map((e) => e.title) },
    { id: "templates", label: "✦ Templates", titles: input.templates.map((t) => t.id) },
  ];
  return specs.map(({ id, label, titles }) => {
    const shown = titles.filter(match).length;
    const remembered = openState[id] ?? DEFAULT_OPEN[id];
    // A filter overrides the remembered state only upwards: it opens a closed
    // section that has hits, and never closes one the author opened.
    return { id, label, shown, total: titles.length, open: f !== "" && shown > 0 ? true : remembered };
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
