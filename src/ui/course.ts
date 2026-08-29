// The course panel: plan a course, edit the plan, generate the lectures that
// are missing, resume. The document in the textarea is the source of truth —
// every action reads it back rather than holding a parsed copy, so the author's
// edits are never overwritten by stale state.

import { type Course, type CourseLecture, formatCourse, parseCourse } from "../course/document";
import { generateCoursePlan } from "../course/plan";
import { estimateCalls, runCourse } from "../course/run";
import type { GenerateConfig, PromptVariant } from "../llm/compile";
import type { Exemplar } from "../llm/prompt";
import { formatPlaylist, type Playlist } from "../playlist/playlist";
import { saveCourse, saveDrawing, type SavedCourse } from "../store";
import { h } from "./dom";
import { createModal } from "./modal";

export function lectureRowLabel(lecture: CourseLecture): string {
  const status = lecture.status;
  if (!status || status.state === "pending") return `${lecture.title} — pending`;
  if (status.state === "failed") return `${lecture.title} — failed: ${status.error ?? "unknown error"}`;
  return `${lecture.title} — done`;
}

export function costPreview(course: Course): string {
  const calls = estimateCalls(course);
  if (calls === 0) return "Every lecture is generated — nothing left to do.";
  const pending = course.lectures.filter((l) => l.status?.state !== "done").length;
  return `${pending} lecture${pending === 1 ? "" : "s"} to generate — about ${calls} AI calls.`;
}

export interface CoursePanelDeps {
  apiKey: () => string;
  model: () => string;
  variant: () => PromptVariant;
  exemplars: () => Exemplar[];
  bundledExemplars: () => Exemplar[];
  setStatus: (text: string, kind?: "ok" | "error") => void;
}

let panel: { dialog: HTMLDialogElement; open: () => void } | null = null;

export function openCoursePanel(deps: CoursePanelDeps): void {
  if (panel) {
    panel.open();
    return;
  }

  const modal = createModal("Course", { class: "course-modal" });
  const doc = h("textarea", {
    class: "course-doc",
    spellcheck: "false",
    placeholder: "# My course\n\n---\n## First lecture\nWhat question does it answer?\n#parts=4",
  }) as HTMLTextAreaElement;
  const rows = h("div", { class: "course-rows" });
  const warnings = h("div", { class: "course-warnings" });
  const cost = h("div", { class: "course-cost" });
  const status = h("div", { class: "course-status" });

  const planBtn = h("button", { class: "small" }, "✦ Plan");
  const runBtn = h("button", { class: "small primary" }, "▶ Generate");
  const saveBtn = h("button", { class: "small" }, "💾 Save");
  const cancelBtn = h("button", { class: "small" }, "✕ Cancel");
  cancelBtn.hidden = true;

  let courseId: string | null = null;
  let running: AbortController | null = null;

  const setBusy = (busy: boolean): void => {
    planBtn.disabled = busy;
    runBtn.disabled = busy;
    saveBtn.disabled = busy;
    cancelBtn.hidden = !busy;
  };

  function render(): void {
    const course = parseCourse(doc.value);
    warnings.textContent = course.warnings.join(" ");
    warnings.hidden = course.warnings.length === 0;
    cost.textContent = course.lectures.length > 0 ? costPreview(course) : "";
    rows.replaceChildren(
      ...course.lectures.map((lecture, i) => {
        const again = h("button", { class: "small course-again", title: `Regenerate "${lecture.title}"` }, "⟳");
        again.addEventListener("click", () => void run({ only: i }));
        return h(
          "div",
          { class: `course-row course-${lecture.status?.state ?? "pending"}` },
          h("span", { class: "course-row-label" }, `${i + 1}. ${lectureRowLabel(lecture)}`),
          again,
        );
      }),
    );
  }

  function config(signal: AbortSignal): GenerateConfig {
    return {
      apiKey: deps.apiKey(),
      pedagogyReview: true,
      model: deps.model(),
      variant: deps.variant(),
      exemplars: deps.exemplars(),
      bundledExemplars: deps.bundledExemplars(),
      signal,
    };
  }

  function persist(): void {
    const course = parseCourse(doc.value);
    courseId ??= crypto.randomUUID();
    const entry: SavedCourse = {
      id: courseId,
      title: course.title || "Untitled course",
      text: doc.value,
      ts: new Date().toISOString(),
    };
    saveCourse(entry);
  }

  async function plan(): Promise<void> {
    const key = deps.apiKey();
    if (!key) {
      deps.setStatus("Add an API key in Settings first.", "error");
      return;
    }
    if (doc.value.trim() && !confirm("Replace the course document with a new plan?")) return;
    const request = prompt("Describe the course — topic, level, how many lectures:");
    if (!request) return;

    const controller = new AbortController();
    running = controller;
    setBusy(true);
    status.textContent = "Planning the course…";
    try {
      const course = await generateCoursePlan(request, { apiKey: key, model: deps.model() }, null, controller.signal);
      if (!course) {
        status.textContent = "";
        deps.setStatus("The model could not plan that into lectures — try rephrasing.", "error");
        return;
      }
      doc.value = formatCourse(course);
      courseId = null; // a new plan is a new course
      persist();
      render();
      status.textContent = `Planned ${course.lectures.length} lectures. Edit the questions, then Generate.`;
    } catch (err) {
      status.textContent = "";
      deps.setStatus(controller.signal.aborted ? "Cancelled." : `Planning failed: ${(err as Error).message}`, "error");
    } finally {
      running = null;
      setBusy(false);
    }
  }

  function store(_index: number, lecture: CourseLecture, playlist: Playlist): string {
    const id = crypto.randomUUID();
    const first = playlist.entries.find((e) => e.kind === "item");
    saveDrawing({
      id,
      title: lecture.title,
      prompt: lecture.questions.join(" "),
      spec: first && first.kind === "item" ? first.spec : { elements: [], commands: [] },
      playlist: formatPlaylist(playlist, "yaml"),
      ts: new Date().toISOString(),
    });
    return id;
  }

  async function run(opts: { only?: number } = {}): Promise<void> {
    const key = deps.apiKey();
    if (!key) {
      deps.setStatus("Add an API key in Settings first.", "error");
      return;
    }
    const course = parseCourse(doc.value);
    if (course.lectures.length === 0) {
      deps.setStatus("There is nothing to generate yet — plan or write a course first.", "error");
      return;
    }
    if (opts.only === undefined) {
      if (estimateCalls(course) === 0) {
        deps.setStatus("Every lecture is already generated.", "ok");
        return;
      }
      if (!confirm(`${costPreview(course)}\n\nGenerate now?`)) return;
    }

    const controller = new AbortController();
    running = controller;
    setBusy(true);
    try {
      const result = await runCourse(
        doc.value,
        config(controller.signal),
        {
          onLecture: (index, phase) => {
            const title = course.lectures[index]?.title ?? `Lecture ${index + 1}`;
            status.textContent =
              phase === "start" ? `Generating "${title}"…` : `${title}: ${phase}.`;
          },
          onDocument: (text) => {
            doc.value = text;
            persist();
            render();
          },
        },
        store,
        opts,
      );
      status.textContent = "";
      const failed = result.failed.length;
      deps.setStatus(
        controller.signal.aborted
          ? `Cancelled after ${result.generated} lecture${result.generated === 1 ? "" : "s"}.`
          : failed > 0
            ? `Generated ${result.generated}; ${failed} failed — press ⟳ on a failed lecture to try again.`
            : `Generated ${result.generated} lecture${result.generated === 1 ? "" : "s"}.`,
        failed > 0 ? "error" : "ok",
      );
    } catch (err) {
      status.textContent = "";
      deps.setStatus(`The run stopped: ${(err as Error).message}`, "error");
    } finally {
      running = null;
      setBusy(false);
      render();
    }
  }

  planBtn.addEventListener("click", () => void plan());
  runBtn.addEventListener("click", () => void run());
  saveBtn.addEventListener("click", () => {
    try {
      persist();
      deps.setStatus("Course saved.", "ok");
    } catch (err) {
      deps.setStatus((err as Error).message, "error");
    }
  });
  cancelBtn.addEventListener("click", () => running?.abort());

  let debounce: ReturnType<typeof setTimeout> | null = null;
  doc.addEventListener("input", () => {
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(render, 300);
  });

  modal.body.append(
    h(
      "p",
      { class: "course-help" },
      "One `##` heading per lecture — each becomes its own drawcast. Write questions, not topics. Tags like #why or #parts=4 apply to that lecture.",
    ),
    h("div", { class: "pane-bar" }, planBtn, runBtn, saveBtn, cancelBtn, h("span", { class: "pane-spacer" }), cost),
    doc,
    warnings,
    status,
    rows,
  );
  document.body.append(modal.dialog);
  panel = modal;
  render();
  modal.open();
}
