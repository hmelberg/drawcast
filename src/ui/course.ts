// The course panel: plan a course, edit the plan, generate the lectures that
// are missing, resume. The document in the textarea is the source of truth —
// every action reads it back rather than holding a parsed copy, so the author's
// edits are never overwritten by stale state.

import { type Course, type CourseLecture, formatCourse, parseCourse } from "../course/document";
import { generateCoursePlan } from "../course/plan";
import { publishCourse } from "../course/publish";
import { reviseCourse } from "../course/revise";
import { estimateCalls, runCourse } from "../course/run";
import type { GenerateConfig, PromptVariant } from "../llm/compile";
import type { Exemplar } from "../llm/prompt";
import { reviseDocument } from "../llm/revise";
import { generationGate } from "../llm/limit";
import { formatPlaylist, singlePlaylist, type Playlist } from "../playlist/playlist";
import { parseRepo } from "../publish/github";
import { downloadJson, getGithubToken, loadCourses, loadLibrary, loadSettings, saveCourse, saveDrawing, type SavedCourse, type SavedDrawing } from "../store";
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
  /**
   * Re-render the sidebar library. Storing a lecture writes localStorage but
   * cannot repaint the list on its own, and a lecture that is saved yet
   * invisible is indistinguishable from one that was lost.
   */
  refreshLibrary: () => void;
}

let panel: { dialog: HTMLDialogElement; open: () => void } | null = null;
/** Re-syncs the button states when the panel is reopened mid-run. */
let reopen: (() => void) | null = null;
/** Repos published to in this session — the Pages note is shown only once each. */
const published = new Set<string>();

export function openCoursePanel(deps: CoursePanelDeps): void {
  if (panel) {
    panel.open();
    reopen?.();
    return;
  }

  const modal = createModal("Course", { class: "course-modal" });
  const doc = h("textarea", {
    class: "course-doc",
    spellcheck: "false",
    placeholder: "# My course\n\n---\n## First lecture\nWhat question does it answer? (or just name a topic)\n#parts=4",
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
  const links = h("div", { class: "course-links" });
  links.hidden = true;

  // Saved courses were reachable only in localStorage: the panel started empty
  // on every page load, so a course that HAD been saved looked lost. This is
  // how you get it back.
  const courseSel = h("select", { class: "small course-pick", title: "Saved courses" }) as HTMLSelectElement;
  const newBtn = h("button", { class: "small", title: "Start a new, empty course" }, "＋ New");
  const planBtn = h("button", { class: "small" }, "✦ Plan");
  const reviseBtn = h("button", { class: "small" }, "✎ Revise");
  const runBtn = h("button", { class: "small primary" }, "▶ Generate");
  const saveBtn = h("button", { class: "small" }, "💾 Save");
  const publishBtn = h("button", { class: "small", title: "Publish this course to your GitHub repository" }, "⬆ Publish");
  const backupBtn = h("button", { class: "small", title: "Download every course and drawcast as one file" }, "⬇ Backup");
  const undoBtn = h("button", { class: "small", title: "Undo the last AI change to this document" }, "↩ Undo");
  const cancelBtn = h("button", { class: "small course-cancel", title: "Stop everything this panel has in flight" }, "✕ Cancel");
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
  /**
   * Batch runs currently going. Two at once generate the same lectures twice
   * — the second run's plan was made before the first one's results landed —
   * and their status write-backs overwrite each other, so a lecture that
   * finished can lose its `status: done` and be generated a third time.
   */
  let runsActive = 0;

  function syncBusy(): void {
    const busy = inFlight.size > 0;
    planBtn.disabled = busy;
    reviseBtn.disabled = busy;
    runBtn.disabled = busy;
    saveBtn.disabled = busy;
    publishBtn.disabled = busy;
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

  /**
   * A message the user must actually see. deps.setStatus writes to the app's
   * status bar BEHIND the modal, where nobody can read it while the panel is
   * open — "Course saved." landing there is indistinguishable from nothing
   * having happened. Shown on the panel's own line first, and forwarded on so
   * the last word is still there once the panel closes.
   */
  function say(text: string, kind?: "ok" | "error"): void {
    status.textContent = text;
    status.classList.toggle("course-status-error", kind === "error");
    // deps.setStatus, never this function itself: a blanket rename once
    // rewrote this line into a self-call, and every message in the panel then
    // recursed until the stack blew. The text is assigned above first, so the
    // message still appeared — which is exactly what hid the bug.
    if (text) deps.setStatus(text, kind);
  }

  /** Transient progress: the panel's line only, never the app's. */
  function working(text: string): void {
    status.textContent = text;
    status.classList.remove("course-status-error");
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
      say("Add an API key in Settings first.", "error");
      return;
    }
    const saved = loadLibrary().find((d) => d.id === id);
    if (!saved) {
      say("That lecture is no longer in the library — regenerate it instead.", "error");
      return;
    }
    const docText = saved.playlist ?? formatPlaylist(singlePlaylist(saved.spec), "yaml");

    const controller = begin();
    const title = saved.title;
    working(`Revising "${title}"…`);
    try {
      const outcome = await generationGate(() =>
        reviseDocument(docText, instruction, {
          apiKey: key,
          model: deps.model(),
          variant: deps.variant(),
          signal: controller.signal,
        }),
      );
      if (!outcome.playlist || !outcome.text) {
        say(controller.signal.aborted ? "Cancelled." : `Could not revise "${title}": ${outcome.error}`, "error");
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
      deps.refreshLibrary();
      note.value = "";
      say(`Revised "${title}". Press ▶ to watch it again.`, "ok");
    } catch (err) {
      say(`Could not revise "${title}": ${(err as Error).message}`, "error");
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
    refreshCourseList();
  }

  function refreshCourseList(): void {
    const saved = loadCourses();
    const options = saved.map((c) => {
      const option = h("option", { value: c.id }, c.title || "Untitled course") as HTMLOptionElement;
      option.selected = c.id === courseId;
      return option;
    });
    // Without an entry of its own, an unsaved new course selects nothing — and
    // a <select> with nothing selected displays its FIRST option, so the panel
    // looked as though the previous course were still loaded and about to be
    // overwritten. It never was (persist mints a fresh id when courseId is
    // null), but the control has to say so.
    if (courseId === null) {
      const blank = h("option", { value: "" }, "— New course —") as HTMLOptionElement;
      blank.selected = true;
      options.unshift(blank);
    }
    courseSel.replaceChildren(...options);
    courseSel.hidden = options.length === 0;
  }

  function loadCourse(id: string): void {
    const saved = loadCourses().find((c) => c.id === id);
    if (!saved) return;
    courseId = saved.id;
    doc.value = saved.text;
    previous = null;
    undoBtn.hidden = true;
    render();
    refreshCourseList();
  }

  async function plan(): Promise<void> {
    const key = deps.apiKey();
    if (!key) {
      say("Add an API key in Settings first.", "error");
      return;
    }
    const request = ask.value.trim();
    if (!request) {
      say("Describe the course in the box first — topic, level, how many lectures.", "error");
      ask.focus();
      return;
    }
    // Be precise about what is at stake: planning never overwrites a saved
    // course — courseId is cleared below, so the new plan is saved under a new
    // id — and the old one stays in the list. The only thing genuinely at risk
    // is text that has not become a course yet, and even that survives in Undo.
    if (doc.value.trim()) {
      const current = parseCourse(doc.value).title;
      const warning = courseId
        ? `Plan a new course from what you wrote above?\n\nThis replaces the text in the editor. "${current || "The course you have open"}" stays saved — pick it again from the list at any time — and the new plan becomes a separate course.`
        : "Plan a new course from what you wrote above?\n\nThis replaces the text in the editor, which has not been saved as a course yet. ↩ Undo brings it back.";
      if (!confirm(warning)) return;
    }

    const controller = begin();
    working("Planning the course…");
    try {
      const course = await generateCoursePlan(request, { apiKey: key, model: deps.model() }, null, controller.signal);
      if (!course) {
        say("The model could not plan that into lectures — try rephrasing.", "error");
        return;
      }
      checkpoint();
      doc.value = formatCourse(course);
      courseId = null; // a new plan is a new course
      persist();
      render();
      status.textContent = `Planned ${course.lectures.length} lectures. Edit the questions, then Generate.`;
    } catch (err) {
      say(controller.signal.aborted ? "Cancelled." : `Planning failed: ${(err as Error).message}`, "error");
    } finally {
      end(controller);
    }
  }

  async function revise(): Promise<void> {
    const key = deps.apiKey();
    if (!key) {
      say("Add an API key in Settings first.", "error");
      return;
    }
    if (!doc.value.trim()) {
      say("There is no course to revise yet — press Plan first.", "error");
      return;
    }
    const instruction = ask.value.trim();
    if (!instruction) {
      say("Say what to change in the box first.", "error");
      ask.focus();
      return;
    }

    const controller = begin();
    working("Revising the course…");
    try {
      const outcome = await reviseCourse(doc.value, instruction, {
        apiKey: key,
        model: deps.model(),
        signal: controller.signal,
        onProgress: (chars) => {
          working(`Revising the course… (${chars.toLocaleString()} characters)`);
        },
      });
      if (!outcome.text) {
        say(controller.signal.aborted ? "Cancelled." : `Revision failed: ${outcome.error}`, "error");
        return;
      }
      checkpoint();
      doc.value = outcome.text;
      // The instruction is spent; the box is now free for the next one.
      ask.value = "";
      autoGrow(ask);
      persist();
      render();
      say("Course revised.", "ok");
    } catch (err) {
      say(`Revision failed: ${(err as Error).message}`, "error");
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
      say("Add an API key in Settings first.", "error");
      return;
    }
    if (runsActive > 0) {
      say(
        "A run is already going — starting another would generate the same lectures twice. Wait for it, or press Cancel and then Generate to pick up where it stopped.",
        "error",
      );
      return;
    }
    const course = parseCourse(doc.value);
    if (course.lectures.length === 0) {
      say("There is nothing to generate yet — plan or write a course first.", "error");
      return;
    }
    if (opts.only === undefined) {
      if (estimateCalls(course) === 0) {
        say("Every lecture is already generated.", "ok");
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
            working(last ? `${head} — ${last}` : head);
          },
          onDocument: (text) => {
            doc.value = text;
            persist();
            render();
            // A lecture has just landed in the library — show it there now,
            // not after the next reload.
            deps.refreshLibrary();
          },
        },
        store,
        opts,
      );
      status.textContent = "";
      const failed = result.failed.length;
      say(
        controller.signal.aborted
          ? `Cancelled after ${result.generated} lecture${result.generated === 1 ? "" : "s"}.`
          : failed > 0
            ? `Generated ${result.generated}; ${failed} failed — press ⟳ on a failed lecture to try again.`
            : `Generated ${result.generated} lecture${result.generated === 1 ? "" : "s"}.`,
        failed > 0 ? "error" : "ok",
      );
    } catch (err) {
      say(`The run stopped: ${(err as Error).message}`, "error");
    } finally {
      runsActive--;
      end(controller);
      render();
    }
  }

  courseSel.addEventListener("change", () => {
    if (courseSel.value) loadCourse(courseSel.value); // "" is the placeholder
  });
  newBtn.addEventListener("click", () => {
    // Autosave means whatever is on screen is already stored; starting a new
    // course can never cost the old one.
    courseId = null;
    doc.value = "";
    ask.value = "";
    previous = null;
    undoBtn.hidden = true;
    render();
    refreshCourseList();
    say("New course — nothing is saved until you write something, and your other courses are untouched.");
  });
  /**
   * Publishing is a remote write whose result is invisible from here — the
   * exact shape of the three "saved but nothing showed it" bugs in stage A —
   * so it reports both URLs on the panel's own line, and the one-time Pages
   * instruction the first time a repo is written to.
   */
  async function publish(): Promise<void> {
    const settings = loadSettings();
    const token = getGithubToken();
    const repo = parseRepo(settings.githubRepo);
    if (!token || !repo) {
      say("Set your GitHub repository and token in Settings first (Settings → Publishing).", "error");
      return;
    }
    const course = parseCourse(doc.value);
    if (course.lectures.length === 0) {
      say("There is nothing to publish yet.", "error");
      return;
    }
    const library = loadLibrary();
    const yamlFor = (index: number): string | null => {
      const status = course.lectures[index].status;
      if (status?.state !== "done" || !status.id) return null;
      const saved = library.find((d) => d.id === status.id);
      return saved?.playlist ?? (saved ? formatPlaylist(singlePlaylist(saved.spec), "yaml") : null);
    };

    const controller = begin();
    working("Publishing to GitHub…");
    try {
      const out = await publishCourse({
        text: doc.value,
        repo,
        token,
        coursesDir: settings.coursesDir,
        viewerBase: settings.viewerBase,
        lectureYaml: yamlFor,
        fetchImpl: (input, init) => fetch(input, { ...init, signal: controller.signal }),
      });
      // Past this line the commit has LANDED. Anything that fails below is
      // local bookkeeping, and reporting it as "Publish failed" would send the
      // user hunting for files that are already in their repository.
      const firstTime = !published.has(settings.githubRepo);
      published.add(settings.githubRepo);
      try {
        checkpoint();
        doc.value = out.text; // now carries each lecture's permanent file name
        persist();
        render();
      } catch (err) {
        console.error("drawcast: publish succeeded, bookkeeping failed", err);
        say(
          `Published to ${out.courseUrl} — but the file names could not be written back into the document (${(err as Error).name}: ${(err as Error).message}). Press Publish again after checking the document.`,
          "error",
        );
        return;
      }
      showLinks(out.readmeUrl, out.courseUrl, out.pagesUrl, firstTime, out.defaultBranch);
      say(`Published ${out.count} files to ${settings.githubRepo}.`, "ok");
    } catch (err) {
      // The stack is what names the culprit; the message alone rarely does.
      console.error("drawcast: publish failed", err);
      const e = err as Error;
      say(`Publish failed — ${e.name}: ${e.message} (full details in the browser console)`, "error");
    } finally {
      end(controller);
    }
  }

  /**
   * The two URLs, as links you can click and copy. A published address is the
   * whole point of publishing, and burying it in a status sentence that the
   * next message overwrites makes it useless — so this block persists.
   */
  function showLinks(readmeUrl: string, courseUrl: string, pagesUrl: string, firstTime: boolean, branch: string): void {
    const row = (label: string, url: string): HTMLElement => {
      const copy = h("button", { class: "small", title: `Copy ${label}` }, "⧉");
      copy.addEventListener("click", () => {
        void navigator.clipboard?.writeText(url).then(
          () => say(`Copied ${label}.`, "ok"),
          () => say("Could not reach the clipboard — select the link and copy it.", "error"),
        );
      });
      return h(
        "div",
        { class: "course-link" },
        h("span", { class: "course-link-label" }, label),
        h("a", { href: url, target: "_blank", rel: "noopener" }, url),
        copy,
      );
    };
    links.replaceChildren(
      // First, because it is the one that works without anything being switched on.
      row("Share now", readmeUrl),
      row("Course page", courseUrl),
      row("All courses", pagesUrl),
    );
    if (firstTime) {
      links.append(
        h(
          "div",
          { class: "course-link-note" },
          `"Share now" and the lecture links work already — GitHub renders the course README itself. The two page links need GitHub Pages switched on once, in the repository: Settings → Pages → Source: Deploy from a branch → ${branch} / (root). If that dropdown is greyed out, reload the page: GitHub reads the branch list when the settings page loads, so it stays empty if you opened it before the first commit. After that, every course in this repo gets its own page under the same site.`,
        ),
      );
    }
    links.hidden = false;
  }

  backupBtn.addEventListener("click", () => {
    // Everything localStorage holds for courses, in one file. Generated
    // lectures cost real money, and until a course is published to GitHub the
    // only copy is one browser away from being gone.
    const courses = loadCourses();
    const library = loadLibrary();
    const stamp = new Date().toISOString().slice(0, 10);
    downloadJson(`drawcast-backup-${stamp}.json`, { savedAt: new Date().toISOString(), courses, library });
    say(`Backed up ${courses.length} course${courses.length === 1 ? "" : "s"} and ${library.length} drawcast${library.length === 1 ? "" : "s"}.`, "ok");
  });

  planBtn.addEventListener("click", () => void plan());
  publishBtn.addEventListener("click", () => void publish());
  reviseBtn.addEventListener("click", () => void revise());
  runBtn.addEventListener("click", () => void run());
  undoBtn.addEventListener("click", () => {
    if (previous === null) return;
    const restored = previous;
    previous = doc.value; // undo is its own undo
    doc.value = restored;
    persist();
    render();
    say("Reverted the last AI change.", "ok");
  });
  saveBtn.addEventListener("click", () => {
    try {
      persist();
      const course = parseCourse(doc.value);
      say(`Saved "${course.title || "Untitled course"}" to this browser's course library.`, "ok");
    } catch (err) {
      say((err as Error).message, "error");
    }
  });
  cancelBtn.addEventListener("click", () => {
    for (const controller of inFlight) controller.abort();
  });

  let debounce: ReturnType<typeof setTimeout> | null = null;
  doc.addEventListener("input", () => {
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(() => {
      render();
      // Hand edits were the one path that did NOT persist: Plan, Revise, a run
      // and Undo all save themselves, so 💾 Save was the only thing standing
      // between typing and losing it. Autosave the way the drawcast editor
      // does, and let the button be reassurance rather than load-bearing.
      const course = parseCourse(doc.value);
      if (course.title || course.lectures.length > 0) {
        try {
          persist();
        } catch (err) {
          say((err as Error).message, "error");
        }
      }
    }, 300);
  });
  ask.addEventListener("input", () => autoGrow(ask));

  modal.body.append(
    h(
      "p",
      { class: "course-help" },
      "One ## heading per lecture \u2014 each becomes its own drawcast. Under it, write what the lecture must cover: questions work best (especially why and how), but topics or material to present are equally fine. Tags like #why, #data or #parts=4 apply to that lecture.",
    ),
    ask,
    h("div", { class: "pane-bar" }, courseSel, newBtn, planBtn, reviseBtn, runBtn, cancelBtn, saveBtn, publishBtn, backupBtn, undoBtn, h("span", { class: "pane-spacer" }), cost),
    doc,
    warnings,
    status,
    links,
    rows,
  );
  document.body.append(modal.dialog);
  panel = modal;
  reopen = () => {
    syncBusy();
    render();
  };
  const saved = loadCourses();
  if (saved.length > 0) loadCourse(saved[0].id); // newest first: saveCourse unshifts
  else refreshCourseList();
  render();
  modal.open();
}
