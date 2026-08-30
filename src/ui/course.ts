// The course panel: plan a course, edit the plan, generate the lectures that
// are missing, resume. The document in the textarea is the source of truth —
// every action reads it back rather than holding a parsed copy, so the author's
// edits are never overwritten by stale state.

import { type Course, type CourseLecture, formatCourse, parseCourse } from "../course/document";
import { generateCoursePlan } from "../course/plan";
import { reviseCourse } from "../course/revise";
import { estimateCalls, runCourse } from "../course/run";
import type { GenerateConfig, PromptVariant } from "../llm/compile";
import type { Exemplar } from "../llm/prompt";
import { reviseDocument } from "../llm/revise";
import { generationGate } from "../llm/limit";
import { formatPlaylist, singlePlaylist, type Playlist } from "../playlist/playlist";
import { loadLibrary, saveCourse, saveDrawing, type SavedCourse, type SavedDrawing } from "../store";
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
  /** Load a saved drawcast into the main editor/player. */
  openDrawing: (id: string) => void;
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
  // The one input for both actions: describe the course to Plan it, then
  // describe a change to Revise it. It grows with the text — a course is often
  // several lines to describe, and a one-line box hides what you wrote.
  const ask = h("textarea", {
    class: "course-ask",
    rows: "2",
    spellcheck: "false",
    placeholder: "Describe the course to plan it — or a change to revise it (e.g. “add a lecture on synthetic control, and make lecture 3 shorter”)",
  }) as HTMLTextAreaElement;
  const rows = h("div", { class: "course-rows" });
  const warnings = h("div", { class: "course-warnings" });
  const cost = h("div", { class: "course-cost" });
  const status = h("div", { class: "course-status" });

  const planBtn = h("button", { class: "small" }, "✦ Plan");
  const reviseBtn = h("button", { class: "small" }, "✎ Revise");
  const runBtn = h("button", { class: "small primary" }, "▶ Generate");
  const saveBtn = h("button", { class: "small" }, "💾 Save");
  const undoBtn = h("button", { class: "small", title: "Undo the last AI change to this document" }, "↩ Undo");
  const cancelBtn = h("button", { class: "small" }, "✕ Cancel");
  cancelBtn.hidden = true;
  undoBtn.hidden = true;

  let courseId: string | null = null;
  /** The document as it stood before the last AI change — the one-step undo. */
  let previous: string | null = null;
  /**
   * Every call this panel has in flight. A per-lecture comment can be queued
   * while the batch is still running, so one controller would not do: Cancel
   * has to reach all of them, and the buttons must stay disabled until the
   * last one lands, not the newest.
   */
  const inFlight = new Set<AbortController>();

  function syncBusy(): void {
    const busy = inFlight.size > 0;
    planBtn.disabled = busy;
    reviseBtn.disabled = busy;
    runBtn.disabled = busy;
    saveBtn.disabled = busy;
    undoBtn.disabled = busy;
    cancelBtn.hidden = !busy;
  }

  function begin(): AbortController {
    const controller = new AbortController();
    inFlight.add(controller);
    syncBusy();
    return controller;
  }

  function end(controller: AbortController): void {
    inFlight.delete(controller);
    syncBusy();
  }

  /** Grow the box to fit what is in it, up to the cap the stylesheet sets. */
  function autoGrow(el: HTMLTextAreaElement): void {
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }

  /** Remember the pre-change text so one bad revision is never the end of it. */
  function checkpoint(): void {
    previous = doc.value;
    undoBtn.hidden = false;
  }

  function render(): void {
    const course = parseCourse(doc.value);
    warnings.textContent = course.warnings.join(" ");
    warnings.hidden = course.warnings.length === 0;
    cost.textContent = course.lectures.length > 0 ? costPreview(course) : "";
    rows.replaceChildren(
      ...course.lectures.map((lecture, i) => {
        const done = lecture.status?.state === "done" && lecture.status.id;
        const parts: HTMLElement[] = [
          h("span", { class: "course-row-label" }, `${i + 1}. ${lectureRowLabel(lecture)}`),
        ];

        // Only a generated lecture can be commented on or watched — there is
        // nothing to revise or play until one exists.
        const note = h("input", {
          type: "text",
          class: "course-note",
          placeholder: "what to change…",
          title: "Leave empty to regenerate from scratch; write a note to revise what is there",
        }) as HTMLInputElement;
        if (done) parts.push(note);

        const again = h("button", {
          class: "small course-again",
          title: done
            ? `Apply the note to "${lecture.title}" — or regenerate it if the note is empty`
            : `Generate "${lecture.title}"`,
        }, "⟳");
        again.addEventListener("click", () => {
          const instruction = done ? note.value.trim() : "";
          if (instruction) void reviseLecture(lecture.status!.id!, instruction, note);
          else void run({ only: i });
        });
        parts.push(again);

        if (done) {
          const open = h("button", { class: "small course-open", title: `Watch "${lecture.title}"` }, "▶");
          open.addEventListener("click", () => {
            deps.openDrawing(lecture.status!.id!);
            modal.dialog.close();
            deps.setStatus(
              `Playing "${lecture.title}". The course keeps generating — press 🎓 Course to come back.`,
              "ok",
            );
          });
          parts.push(open);
        }

        return h("div", { class: `course-row course-${lecture.status?.state ?? "pending"}` }, ...parts);
      }),
    );
  }

  /**
   * Apply one note to one already-generated lecture. This is the cheap path:
   * reviseDocument is a single call against the drawcast that exists, where a
   * regenerate is a fresh outline plus every part. It queues on the same gate
   * as the batch, so a note written while the run is still going simply falls
   * in behind the parts already in flight — and it writes back to the SAME
   * library id, so the course document's status stays valid.
   */
  async function reviseLecture(id: string, instruction: string, note: HTMLInputElement): Promise<void> {
    const key = deps.apiKey();
    if (!key) {
      deps.setStatus("Add an API key in Settings first.", "error");
      return;
    }
    const saved = loadLibrary().find((d) => d.id === id);
    if (!saved) {
      deps.setStatus("That lecture is no longer in the library — regenerate it instead.", "error");
      return;
    }
    const docText = saved.playlist ?? formatPlaylist(singlePlaylist(saved.spec), "yaml");

    const controller = begin();
    const title = saved.title;
    status.textContent = `Revising "${title}"…`;
    try {
      const outcome = await generationGate(() =>
        reviseDocument(docText, instruction, {
          apiKey: key,
          model: deps.model(),
          variant: deps.variant(),
          signal: controller.signal,
        }),
      );
      status.textContent = "";
      if (!outcome.playlist || !outcome.text) {
        deps.setStatus(controller.signal.aborted ? "Cancelled." : `Could not revise "${title}": ${outcome.error}`, "error");
        return;
      }
      const first = outcome.playlist.entries.find((e) => e.kind === "item");
      const next: SavedDrawing = {
        ...saved,
        spec: first && first.kind === "item" ? first.spec : saved.spec,
        playlist: outcome.text,
        ts: new Date().toISOString(),
      };
      saveDrawing(next);
      note.value = "";
      deps.setStatus(`Revised "${title}". Press ▶ to watch it again.`, "ok");
    } catch (err) {
      status.textContent = "";
      deps.setStatus(`Could not revise "${title}": ${(err as Error).message}`, "error");
    } finally {
      end(controller);
    }
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
    const request = ask.value.trim();
    if (!request) {
      deps.setStatus("Describe the course in the box first — topic, level, how many lectures.", "error");
      ask.focus();
      return;
    }
    if (doc.value.trim() && !confirm("Replace the course document with a new plan?")) return;

    const controller = begin();
    status.textContent = "Planning the course…";
    try {
      const course = await generateCoursePlan(request, { apiKey: key, model: deps.model() }, null, controller.signal);
      if (!course) {
        status.textContent = "";
        deps.setStatus("The model could not plan that into lectures — try rephrasing.", "error");
        return;
      }
      checkpoint();
      doc.value = formatCourse(course);
      courseId = null; // a new plan is a new course
      persist();
      render();
      status.textContent = `Planned ${course.lectures.length} lectures. Edit the questions, then Generate.`;
    } catch (err) {
      status.textContent = "";
      deps.setStatus(controller.signal.aborted ? "Cancelled." : `Planning failed: ${(err as Error).message}`, "error");
    } finally {
      end(controller);
    }
  }

  async function revise(): Promise<void> {
    const key = deps.apiKey();
    if (!key) {
      deps.setStatus("Add an API key in Settings first.", "error");
      return;
    }
    if (!doc.value.trim()) {
      deps.setStatus("There is no course to revise yet — press Plan first.", "error");
      return;
    }
    const instruction = ask.value.trim();
    if (!instruction) {
      deps.setStatus("Say what to change in the box first.", "error");
      ask.focus();
      return;
    }

    const controller = begin();
    status.textContent = "Revising the course…";
    try {
      const outcome = await reviseCourse(doc.value, instruction, {
        apiKey: key,
        model: deps.model(),
        signal: controller.signal,
        onProgress: (chars) => {
          status.textContent = `Revising the course… (${chars.toLocaleString()} characters)`;
        },
      });
      status.textContent = "";
      if (!outcome.text) {
        deps.setStatus(controller.signal.aborted ? "Cancelled." : `Revision failed: ${outcome.error}`, "error");
        return;
      }
      checkpoint();
      doc.value = outcome.text;
      // The instruction is spent; the box is now free for the next one.
      ask.value = "";
      autoGrow(ask);
      persist();
      render();
      deps.setStatus("Course revised.", "ok");
    } catch (err) {
      status.textContent = "";
      deps.setStatus(`Revision failed: ${(err as Error).message}`, "error");
    } finally {
      end(controller);
    }
  }

  function store(_index: number, lecture: CourseLecture, playlist: Playlist): string {
    // Regenerating writes over the row it replaces rather than minting a new
    // one: the course document points at this id, and a fresh id every time
    // would leave the previous version orphaned in the library.
    const id = lecture.status?.id ?? crypto.randomUUID();
    const first = playlist.entries.find((e) => e.kind === "item");
    saveDrawing({
      id,
      title: lecture.title,
      prompt: lecture.questions.join(" "),
      spec: first && first.kind === "item" ? first.spec : { elements: [], commands: [] },
      playlist: formatPlaylist(playlist, "yaml"),
      courseId: courseId ?? undefined,
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
    // Mint the course id before the first lecture is stored, so every lecture
    // this run produces is tagged with the course that owns it.
    persist();

    const controller = begin();
    let last = "";
    try {
      const result = await runCourse(
        doc.value,
        config(controller.signal),
        {
          onLecture: (index, phase) => {
            if (phase === "start") return; // the progress line covers starts
            const title = course.lectures[index]?.title ?? `Lecture ${index + 1}`;
            last = `${title}: ${phase}.`;
          },
          onProgress: (p) => {
            // Lectures now run together, so a per-lecture line would flicker
            // between them. One aggregate line, plus whatever last finished.
            const head =
              p.phase === "outlining"
                ? `Planning ${p.lecturesTotal} lecture${p.lecturesTotal === 1 ? "" : "s"}…`
                : `${p.lecturesDone}/${p.lecturesTotal} lectures · ${p.partsDone}/${p.partsTotal} figures drawn`;
            status.textContent = last ? `${head} — ${last}` : head;
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
      end(controller);
      render();
    }
  }

  planBtn.addEventListener("click", () => void plan());
  reviseBtn.addEventListener("click", () => void revise());
  runBtn.addEventListener("click", () => void run());
  undoBtn.addEventListener("click", () => {
    if (previous === null) return;
    const restored = previous;
    previous = doc.value; // undo is its own undo
    doc.value = restored;
    persist();
    render();
    deps.setStatus("Reverted the last AI change.", "ok");
  });
  saveBtn.addEventListener("click", () => {
    try {
      persist();
      deps.setStatus("Course saved.", "ok");
    } catch (err) {
      deps.setStatus((err as Error).message, "error");
    }
  });
  cancelBtn.addEventListener("click", () => {
    for (const controller of inFlight) controller.abort();
  });

  let debounce: ReturnType<typeof setTimeout> | null = null;
  doc.addEventListener("input", () => {
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(render, 300);
  });
  ask.addEventListener("input", () => autoGrow(ask));

  modal.body.append(
    h(
      "p",
      { class: "course-help" },
      "One ## heading per lecture — each becomes its own drawcast. Write questions, not topics. Tags like #why or #parts=4 apply to that lecture.",
    ),
    ask,
    h("div", { class: "pane-bar" }, planBtn, reviseBtn, runBtn, saveBtn, undoBtn, cancelBtn, h("span", { class: "pane-spacer" }), cost),
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
