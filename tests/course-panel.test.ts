import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { parseCourse } from "../src/course/document";
import { costPreview, lectureRowLabel, resolveOpenCourseId } from "../src/ui/course";

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

  it("names the missing parts of a partial lecture", () => {
    const partial = parseCourse("# T\n---\n## A\nQ?\nstatus: failed · id: a1 · missing: 1, 4 · error: parts 1, 4 of 4 failed - cut off\n");
    const label = lectureRowLabel(partial.lectures[0]);
    expect(label).toContain("partial");
    expect(label).toContain("missing 1, 4");
    expect(label).toContain("cut off");
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

describe("resolveOpenCourseId", () => {
  const saved = [{ id: "micro" }, { id: "causal" }];

  it("opens the requested course, not whatever the panel had loaded last — the headline bug", () => {
    // With two saved courses, clicking "Micro I" in the sidebar must load
    // Micro I, even though "Causal inference" (courses[1] here) is the one
    // that would win the old saved[0]-only fallback.
    expect(resolveOpenCourseId("micro", saved)).toBe("micro");
    expect(resolveOpenCourseId("causal", saved)).toBe("causal");
  });

  it("falls back to the newest saved course when nothing was requested", () => {
    // saveCourse unshifts, so saved[0] is the newest — this is the
    // "＋ New course" row and every other unspecific call site.
    expect(resolveOpenCourseId(undefined, saved)).toBe("micro");
  });

  it("loads nothing rather than guessing when the requested course is gone", () => {
    expect(resolveOpenCourseId("deleted", saved)).toBeNull();
  });

  it("loads nothing when nothing is saved at all", () => {
    expect(resolveOpenCourseId(undefined, [])).toBeNull();
  });
});

describe("reviseLecture reports outcome.notes (round 1 review, fix 1)", () => {
  // reviseDocument's `notes` (design §5.1) had a first caller, main.ts's
  // Revise, that was fixed on this same round — but reviseLecture is a
  // SECOND caller, and it read `outcome` on both its success and its
  // failure branch without ever looking at `.notes`, so an over-threshold
  // asset (or a restore that lost one) silently vanished on this path even
  // though the model call reported it. reviseLecture is a closure inside
  // openCoursePanel — not exported, and reaching it end-to-end means
  // mocking the store, the network layer, and a live dialog's DOM, none of
  // which any existing test for this module does — so this is a structural
  // guard on the wiring itself (withNotes's own joining rule is unit-tested
  // in spec-assets.test.ts) rather than a full integration test.
  it("reads outcome.notes and joins it via the shared withNotes helper on both branches", async () => {
    const src = await readFile(new URL("../src/ui/course.ts", import.meta.url), "utf8");
    expect(src).toContain('import { withNotes } from "../llm/hoist";');
    const start = src.indexOf("async function reviseLecture(");
    expect(start).toBeGreaterThan(-1);
    const end = src.indexOf("\n  function config(", start);
    const body = src.slice(start, end);
    expect(body).toContain("outcome.notes");
    // Both say() calls that report the model's outcome must ride the notes
    // along — the success line and the "could not revise" / "Cancelled" line.
    expect((body.match(/say\(withNotes\(/g) ?? []).length).toBe(2);
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

describe("the course modal's regions", () => {
  it("splits the working verbs over two rows — the plan slot with Cancel under the request box, Generate with the cost under a rule — and has no separate Revise button", async () => {
    const src = await readFile(new URL("../src/ui/course.ts", import.meta.url), "utf8");
    const planRow = src.slice(src.indexOf('class: "pane-bar course-plan-row"'));
    const planLine = planRow.slice(0, planRow.indexOf("\n"));
    expect(planLine).toContain("planBtn");
    expect(planLine).toContain("cancelBtn");
    expect(planLine).not.toContain("runBtn");
    const runRow = src.slice(src.indexOf('class: "pane-bar course-run-row"'));
    const runLine = runRow.slice(0, runRow.indexOf("\n"));
    expect(runLine).toContain("runBtn");
    expect(runLine).toContain("cost");
    expect(runLine).not.toContain("planBtn");
    for (const gone of ["reviseBtn", "courseSel", "newBtn", "saveBtn", "publishBtn", "undoBtn", "matchBtn"]) {
      expect(planLine + runLine).not.toContain(gone);
    }
    expect(src).not.toContain("reviseBtn");
    // The body lays them out in that order: request block, rule, run row.
    expect(src).toMatch(/course-ask-block"[\s\S]*?\n\s*rule,\n\s*runRow,/);
  });

  it("has no second copy of the publish checkbox — Share asks it once", async () => {
    // Checks for the removed CONTROL by its own identifiers, not for the
    // English phrase "with narration" — that phrase also occurs, entirely
    // legitimately, in bakeLectures()'s unrelated "needs a Google TTS key"
    // error, and a prose-substring assertion would fail on any sentence that
    // happens to use those two words.
    const src = await readFile(new URL("../src/ui/course.ts", import.meta.url), "utf8");
    for (const gone of ["bakeCb", "bakeLabel", "course-bake", "publishBtn"]) {
      expect(src).not.toContain(gone);
    }
  });

  it("no longer offers an app-global backup from inside one course", async () => {
    const src = await readFile(new URL("../src/ui/course.ts", import.meta.url), "utf8");
    expect(src).not.toMatch(/⬇ Backup/);
  });
});

describe("the course modal's width", () => {
  // The base `dialog` rule used to cap every dialog at 30rem. Setting `width`
  // alone on .course-modal did nothing, twice, because the cap is a different
  // property — so pin both here rather than rediscovering it a third time.
  // Now the cap lives on the named size scale (.modal-l for the course).
  it("still gives the course modal a working-surface width", async () => {
    const css = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");
    const rule = /\.modal-l\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(rule).toMatch(/width:\s*min\(/);
    expect(rule).toMatch(/max-width:\s*min\(/);
  });

  it("still caps the small dialog, so ordinary dialogs stay narrow", async () => {
    const css = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");
    expect(/\.modal-s\s*\{[^}]*max-width:\s*30rem/.test(css)).toBe(true);
  });
});

// Course panel layout (course-load round, 2026-09-17): one plan slot that
// reads Make plan until the document has lectures and Revise plan after;
// Generate appears only once there is a plan.
import { panelActions } from "../src/ui/course";

describe("panelActions", () => {
  it("an empty document offers Make plan and hides Generate", () => {
    expect(panelActions(parseCourse(""))).toEqual({ plan: "make", generate: false });
  });
  it("a document with lectures offers Revise plan and shows Generate", () => {
    expect(panelActions(parseCourse(DOC))).toEqual({ plan: "revise", generate: true });
  });
  it("a title alone is not a plan yet", () => {
    expect(panelActions(parseCourse("# Just a title\n"))).toEqual({ plan: "make", generate: false });
  });
});
