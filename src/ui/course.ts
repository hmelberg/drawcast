// The course panel: plan a course, edit the plan, generate the lectures that
// are missing, resume. The document in the textarea is the source of truth —
// every action reads it back rather than holding a parsed copy, so the author's
// edits are never overwritten by stale state.

import { type Course, type CourseLecture, formatCourse, parseCourse } from "../course/document";
import { generateCoursePlan } from "../course/plan";
import { applyJoinBox, commitPublish, preparePublish, type PublishArgs } from "../course/publish";
import type { Door, DoorlessReason } from "../course/page";
import { matchLibrary, restoredStatus } from "../course/reconcile";
import { reviseCourse } from "../course/revise";
import { estimateCalls, runCourse } from "../course/run";
import { setLectureStatus } from "../course/document";
import type { GenerateConfig, PromptVariant } from "../llm/compile";
import type { Exemplar } from "../llm/prompt";
import { reviseDocument } from "../llm/revise";
import { generationGate } from "../llm/limit";
import { DEFAULT_META, formatPlaylist, formatPublished, itemsOf, parsePlaylistText, singlePlaylist, type AudioTrack, type Playlist } from "../playlist/playlist";
import { playlistSpeakLines } from "../playlist/session";
import { applyViewsFlag } from "../views";
import type { SpeakLine } from "../render/delivery";
import { bakeNarration, bakeSize, linesToBake, voiceChanges } from "../export/bake";
import { bakeClipStore, cachingSynthesizer, clipCacheKey, type SynthStats } from "../export/bake-cache";
import { addCosts, bakeCost, costLabel, courseNarrationProjection, type BakeCost } from "../export/tts-cost";
import { stampedVoice, synthesizeBase64, voiceLang } from "../export/tts";
import { joinPath } from "../course/publish";
import { claimCourse, claimNote, courseClaim, isRegistrable, MIN_NAME_LENGTH, nameNote, normalizeName, registerName } from "../names";
import { DEFAULT_ENROLL_API } from "../learn";
import { getToken } from "../account";

/**
 * Why the published page gets no door, per the registry's answer to the name
 * (identity round): a registered name is the ONLY door, so every other
 * answer is a sentence on the page instead of a link.
 */
const DOORLESS: Record<Exclude<Awaited<ReturnType<typeof registerName>>, "ok">, DoorlessReason> = {
  taken: "taken",
  owner: "owner",
  key: "signed-out",
  invalid: "invalid",
  rate: "unreachable",
  error: "unreachable",
};
import { parseRepo, readFile } from "../publish/github";
import { embeddedPlaylist } from "../publish/embed";
import { resolvePortraits } from "../render/portrait";
import { resolveSources } from "../render/source";
import { unembeddedImages } from "./insert";
import { getGithubToken, getTtsKey, loadCourses, loadLibrary, loadSettings, saveCourse, saveDrawing, type SavedCourse, type SavedDrawing } from "../store";
import { h } from "./dom";
import { createModal } from "./modal";
import { openShare, type ShareDeps } from "./share";

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

/**
 * The Share fields this panel forwards unchanged into `openShare()` now that
 * the narration checkbox and Publish live in Share instead of this file
 * (§2, §8). Picked from `ShareDeps` rather than re-typed here, so the two can
 * never drift apart.
 */
type CourseShareDeps = Pick<
  ShareDeps,
  "settings" | "persist" | "setStatusAction" | "refreshAccountRow" | "openSettings" | "renderVideo" | "beginExport" | "setProgress" | "endExport" | "setAbort"
>;

export interface CoursePanelDeps extends CourseShareDeps {
  apiKey: () => string;
  model: () => string;
  variant: () => PromptVariant;
  /** The author's active style profile (B5) — rides along on every course generation too. */
  styleText: () => string;
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
/** Loads a saved course by id into the already-built panel — set once the
 *  panel exists, called again on a later `openCoursePanel(deps, id)` while
 *  it is still open (or merely reopened). */
let loadCourseRef: ((id: string) => void) | null = null;
/** Repos published to in this session — the Pages note is shown only once each. */
const published = new Set<string>();

/**
 * Which saved course the panel should load when opened. Pure so the decision
 * — the one thing that was never actually asserted, letting a course row
 * open whatever the panel last happened to have loaded instead of the course
 * that was clicked — can be pinned by a test with no DOM at all. An explicit
 * request wins whenever that course still exists; otherwise fall back to the
 * newest saved course (saveCourse unshifts, so `saved[0]` is newest), or
 * nothing when there is nothing saved.
 */
export function resolveOpenCourseId(requestedId: string | undefined, saved: { id: string }[]): string | null {
  if (requestedId && saved.some((c) => c.id === requestedId)) return requestedId;
  if (requestedId) return null; // asked for a course that is gone — load nothing rather than guess
  return saved[0]?.id ?? null;
}

/** `openId` names a specific saved course to open — the sidebar's course
 *  rows pass their own id, so clicking "Micro I" opens Micro I even when
 *  another course was loaded last. Omitted (the "＋ New course" row, and
 *  every other call site) leaves the previous behaviour: reopen wherever the
 *  panel already was, or load the newest saved course on first open. Named
 *  differently from the panel's own internal `courseId` (the currently-open
 *  course, tracked below) so the two are never confused. */
export function openCoursePanel(deps: CoursePanelDeps, openId?: string): void {
  if (panel) {
    panel.open();
    reopen?.();
    if (openId) {
      const toLoad = resolveOpenCourseId(openId, loadCourses());
      if (toLoad) loadCourseRef?.(toLoad);
    }
    return;
  }

  // Saved courses were reachable only in localStorage: the panel started empty
  // on every page load, so a course that HAD been saved looked lost. This is
  // how you get it back. Head content, not action — which document is open is
  // context, not a working verb.
  const courseSel = h("select", { class: "small course-pick", title: "Saved courses" }) as HTMLSelectElement;
  const newBtn = h("button", { class: "small", title: "Start a new, empty course" }, "＋ New");
  // Save and Publish live in the SAME top row as ＋ New (Hans 2026-09-02):
  // the footer placement made Publish invisible — he went looking for it on
  // the course modal's menu and could not find it. Publish is the committing
  // verb, so it alone wears primary.
  const saveBtn = h("button", { class: "small" }, "💾 Save");
  const shareBtn = h("button", { class: "small primary" }, "↗ Publish");
  const modal = createModal("🎓 Course", { size: "l", head: [courseSel, newBtn, saveBtn, shareBtn] });
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

  const planBtn = h("button", { class: "small" }, "✦ Plan");
  const reviseBtn = h("button", { class: "small" }, "✎ Revise");
  const runBtn = h("button", { class: "small primary" }, "▶ Generate");
  const matchBtn = h("button", { class: "small course-match" }, "⟲ Match");
  matchBtn.hidden = true;
  const undoBtn = h("button", { class: "small", title: "Undo the last AI change to this document" }, "↩ Undo");
  const cancelBtn = h("button", { class: "small course-cancel", title: "Stop everything this panel has in flight" }, "✕ Cancel");
  // Keeps its slot rather than disappearing, so the row stops reflowing under
  // the cursor while the author works — disabled when nothing is in flight.
  cancelBtn.disabled = true;
  undoBtn.hidden = true;

  let courseId: string | null = null;
  /**
   * Whether the last GitHub publish counted views for THIS course — mirrors
   * Doc.publishedViews (main.ts), but a course has no single Doc to hang it
   * on, so it lives here beside courseId and is carried into every persist()
   * the same way, and reset alongside courseId whenever a fresh course
   * starts (plan() and "New course" below).
   */
  let publishedViews: boolean | undefined;
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

  /** The priced narration of each DONE lecture (its saved playlist's speak
   *  lines, with the live voice picks). Basis for both cost surfaces: the
   *  Publish dialog's exact figure and the Generate confirm's projection. */
  function doneLectureCosts(course: Course): BakeCost[] {
    const settings = loadSettings();
    const library = loadLibrary();
    const costs: BakeCost[] = [];
    for (const lecture of course.lectures) {
      if (lecture.status?.state !== "done" || !lecture.status.id) continue;
      const saved = library.find((d) => d.id === lecture.status!.id);
      const text = saved?.playlist ?? (saved ? formatPlaylist(singlePlaylist(saved.spec), "yaml") : null);
      if (text === null) continue;
      try {
        costs.push(bakeCost(playlistSpeakLines(parsePlaylistText(text)), settings.cloudVoices));
      } catch {
        /* an unparsable lecture prices as nothing rather than blocking */
      }
    }
    return costs;
  }

  function syncBusy(): void {
    const busy = inFlight.size > 0;
    planBtn.disabled = busy;
    reviseBtn.disabled = busy;
    runBtn.disabled = busy;
    saveBtn.disabled = busy;
    // Publish carried this same guard before it moved into Share: publish()
    // reads and rewrites doc.value, same as plan/revise/a run, so it must
    // not overlap them.
    shareBtn.disabled = busy;
    undoBtn.disabled = busy;
    cancelBtn.disabled = !busy;
    // The parked race, closed: switching courses while a generation is in
    // flight wrote the OLD text under the NEW courseId (the run's write-backs
    // land on whatever course is open when they resolve). All three doors —
    // the saved-course picker, ＋ New, and the sidebar rows (see loadCourse's
    // own guard) — refuse while anything runs.
    courseSel.disabled = busy;
    newBtn.disabled = busy;
    // …and the fourth door is the textarea itself: a mid-run hand-edit is
    // autosaved, then silently clobbered by the run's next write-back (which
    // derives from its start-of-run snapshot). Read-only while anything runs.
    doc.readOnly = busy;
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

  /**
   * Adapts this panel's status reporter for Share, which also accepts
   * "info" (deps.setStatus here does not — every caller in this file only
   * ever says "ok" or "error"). "info" maps to omitting the kind, which is
   * exactly what "info" already means to the real function underneath
   * (main.ts's `setStatus` defaults to "info" when none is given).
   */
  function shareStatus(text: string, kind?: "info" | "error" | "ok"): void {
    deps.setStatus(text, kind === "info" ? undefined : kind);
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
    // A lecture whose drawcast exists but whose status line was lost would be
    // generated again at full cost. Offer the repair, and only when there is
    // one to make.
    const found = matchLibrary(course, loadLibrary(), courseId);
    matchBtn.hidden = found.length === 0;
    matchBtn.textContent = `⟲ Match ${found.length} to library`;
    matchBtn.title = `${found.length} lecture${found.length === 1 ? " is" : "s are"} already in your library but not marked done here — mark them, so Generate does not make them again`;
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
          styleText: deps.styleText(),
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
        // Recounted, never inherited from `saved`: a revision can add or drop
        // parts, and a stale count would leave the row's ▤ marker describing
        // the version before this one.
        parts: itemsOf(outcome.playlist).length,
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
      styleText: deps.styleText(),
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
      publishedViews,
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
    // The sidebar's course rows reach this through the panel-open path with
    // an id, bypassing the disabled picker — the guard has to live here.
    if (inFlight.size > 0) {
      say("A generation is running — cancel it or let it finish before switching courses.", "error");
      return;
    }
    const saved = loadCourses().find((c) => c.id === id);
    if (!saved) return;
    courseId = saved.id;
    doc.value = saved.text;
    publishedViews = saved.publishedViews;
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
      publishedViews = undefined; // never published — nothing to seed the checkbox from
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
      // Taken FROM the document rather than derived a second time here, so the
      // library row and the published lecture yaml can never disagree about
      // what was asked (lecturePlaylist stamps it — B9). The fallback covers a
      // playlist built by something that predates the stamp.
      prompt: playlist.meta.prompt ?? lecture.questions.join(" "),
      spec: first && first.kind === "item" ? first.spec : { elements: [], commands: [] },
      playlist: formatPlaylist(playlist, "yaml"),
      parts: itemsOf(playlist).length, // what the library's ▤ marker reads
      courseId: courseId ?? undefined,
      sourcePath: null, // a course lecture; GitHub source-saving is per drawcast, not wired to courses
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
      // Narration is paid LATER (Publish → Embed narration), but the size of
      // that later bill belongs in this confirm (Hans 2026-09-02): projected
      // from the lectures generated so far, or from a measured typical
      // lecture when none exist yet.
      const projection = courseNarrationProjection(doneLectureCosts(course), course.lectures.length, loadSettings().cloudVoices);
      const narrationNote = projection.chars > 0
        ? `\nNarration, if you later publish with “Embed narration”: roughly ${costLabel(projection)} for all ${course.lectures.length} lectures with the current voice.`
        : "";
      if (!confirm(`${costPreview(course)}${narrationNote}\n\nGenerate now?`)) return;
    }
    // Mint the course id before the first lecture is stored, so every lecture
    // this run produces is tagged with the course that owns it.
    persist();

    // The guard above reads this — it was checked and decremented but never
    // incremented (final review 2026-09-02), so a per-lecture ⟳ during a
    // batch started a SECOND concurrent run whose write-backs interleaved.
    runsActive++;
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
    publishedViews = undefined; // never published — nothing to seed the checkbox from
    doc.value = "";
    ask.value = "";
    previous = null;
    undoBtn.hidden = true;
    render();
    refreshCourseList();
    say("New course — nothing is saved until you write something, and your other courses are untouched.");
  });
  /**
   * Synthesize every lecture's narration and fold it into that lecture's text.
   *
   * Reuses whatever the repo already carries: a republished course pays only
   * for lines that are new or changed, which is what keeps a twentieth publish
   * as cheap as the second. Reading the published file is also how a lecture
   * that has not changed at all costs nothing.
   */
  let bakedTotal = 0;

  async function bakeLectures(course: Course, yamlFor: (i: number) => string | null, signal: AbortSignal): Promise<Map<number, string>> {
    bakedTotal = 0;
    bakeStats = { cached: 0, synthesized: 0 };
    bakeReused = 0;
    bakeRevoiced.clear();
    const settings = loadSettings();
    const apiKey = getTtsKey();
    if (!apiKey) throw new Error("Publishing with narration needs a Google TTS key — add one in Settings.");
    const repo = parseRepo(settings.githubRepo);
    const out = new Map<number, string>();
    const numbered = course.lectures.map((_, i) => i).filter((i) => yamlFor(i) !== null);

    for (const [n, index] of numbered.entries()) {
      if (signal.aborted) throw new Error("Publishing was cancelled.");
      const text = yamlFor(index)!;
      const playlist = parsePlaylistText(text);
      const lines = playlistSpeakLines(playlist);
      // Undefined when nothing declares one — see the same decision in main.ts.
      const declaredLang = playlist.entries.flatMap((e) => (e.kind === "item" && e.spec.lang ? [e.spec.lang] : []))[0];
      const voiceOf = (line: SpeakLine): string | undefined => stampedVoice(settings.cloudVoices, voiceLang(declaredLang, line.text), line);
      // What this lecture already published, so unchanged lines are free.
      let existing: AudioTrack["lines"] = {};
      const file = course.lectures[index].status?.file;
      // No slug means this course has never been published, so there is no
      // file to read and nothing to reuse — do not spend a request finding out.
      if (repo && file && course.context.slug) {
        const published = await readFile(repo, joinPath(settings.coursesDir, course.context.slug || "", file), (input, init) =>
          fetch(input, { ...init, signal }),
        ).catch(() => null);
        if (published) existing = parsePlaylistText(published).audio?.lines ?? {};
      }
      const track = await bakeNarration(
        lines,
        {
          lang: declaredLang ?? "en",
          existing,
          // B15: see export/bake-cache.ts — a 20-lecture bake that dies at
          // lecture 14 resumes from the local clip cache, not from Google.
          synthesize: cachingSynthesizer(
            bakeClipStore,
            (line) => clipCacheKey(settings.rate, settings.cloudVoices, line, declaredLang),
            (line) => synthesizeBase64({ apiKey, rate: settings.rate, voices: settings.cloudVoices, lang: declaredLang }, line.text, line),
            bakeStats,
          ),
          voiceOf,
        },
        (done, total) =>
          working(`Narration for lecture ${n + 1} of ${numbered.length} — ${done}/${total} lines…`),
        signal,
      );
      // The accounting that answers "why is it synthesizing again?": what was
      // reused from the published copy, what a changed voice re-bought, what
      // the local cache replayed free.
      bakeReused += linesToBake(lines, {}, voiceOf).length - linesToBake(lines, existing, voiceOf).length;
      for (const c of voiceChanges(lines, existing, voiceOf)) {
        const k = `${c.from} → ${c.to}`;
        bakeRevoiced.set(k, (bakeRevoiced.get(k) ?? 0) + c.count);
      }
      out.set(index, formatPublished(playlist, track));
      bakedTotal += bakeSize(track).inlineBytes;
    }
    return out;
  }

  /** What the last bake actually did, for the publish report. */
  let bakeStats: SynthStats = { cached: 0, synthesized: 0 };
  let bakeReused = 0;
  const bakeRevoiced = new Map<string, number>();

  function bakeReport(): string {
    const parts = [`${bakeReused} line(s) reused from the published copy`, `${bakeStats.cached} replayed free from the local cache`, `${bakeStats.synthesized} synthesized`];
    const revoiced = [...bakeRevoiced.entries()].map(([k, n]) => `${n} line(s) re-voiced ${k}`).join("; ");
    return ` (${parts.join(", ")}${revoiced ? `. NOTE: ${revoiced} — a voice pick counts as a change; Settings → Playback puts it back` : ""}).`;
  }

  /**
   * Resolve every lecture's portraits and sources into the text that gets
   * published — the course's answer to Publish's "Embed images" checkbox.
   *
   * Text-level on purpose: a course has no playlist of its own, so each
   * lecture is parsed, embedded on the parsed copy (embeddedPlaylist clones
   * again inside), and re-serialized. The library row this text came from is
   * never written back, which is the same promise a single drawcast gets —
   * publishing embeds into the copy it sends, not into your document.
   *
   * A lecture with nothing left to embed is skipped entirely rather than
   * round-tripped through parse+format, so publishing can never reflow the
   * yaml of a lecture it had no work to do on.
   */
  let embeddedTotal = 0;

  async function embedLectures(
    course: Course,
    yamlFor: (i: number) => string | null,
    contactEmail: string,
    signal: AbortSignal,
  ): Promise<Map<number, string>> {
    embeddedTotal = 0;
    const out = new Map<number, string>();
    const numbered = course.lectures.map((_, i) => i).filter((i) => yamlFor(i) !== null);
    for (const [n, index] of numbered.entries()) {
      // Same cancellation contract as bakeLectures: Cancel between lectures
      // leaves the repo untouched, because nothing is committed until both
      // passes are done.
      if (signal.aborted) throw new Error("Publishing was cancelled.");
      const playlist = parsePlaylistText(yamlFor(index)!);
      const before = unembeddedImages(playlist);
      if (before === 0) continue;
      working(`Embedding images for lecture ${n + 1} of ${numbered.length}…`);
      const done = await embeddedPlaylist(playlist, { resolvePortraits, resolveSources, contactEmail });
      embeddedTotal += before - unembeddedImages(done);
      out.set(index, formatPlaylist(done, "yaml"));
    }
    return out;
  }

  /**
   * Publishing is a remote write whose result is invisible from here — the
   * exact shape of the three "saved but nothing showed it" bugs in stage A —
   * so it reports both URLs on the panel's own line, and the one-time Pages
   * instruction the first time a repo is written to.
   */
  // `slug` (B3's Link name field) is accepted here only to match
  // ShareDeps.publish's signature — a course has no single slug of its own
  // (each lecture's file name is derived by publishCourse from the course
  // document, below), so Link hides the name field for `subject: "course"`
  // and this parameter is never read.
  async function publish({ bake, embedImages, allowComments, countViews, allowSignup }: { bake: boolean; embedImages: boolean; slug?: string; allowComments?: boolean; countViews?: boolean; allowSignup?: boolean }): Promise<void> {
    const settings = loadSettings();
    const token = getGithubToken();
    const repo = parseRepo(settings.githubRepo);
    if (!token || !repo) {
      say("Set your GitHub repository and token in Settings first (Settings → Publishing).", "error");
      return;
    }
    // The join-box choice is applied to the TEXT first, so the copy that goes
    // out and the copy written back (out.text) agree on the enroll: line. The
    // editor's own document changes only when the commit lands, with the rest
    // of the bookkeeping below.
    const text = allowSignup === undefined ? doc.value : applyJoinBox(doc.value, allowSignup);
    const course = parseCourse(text);
    if (course.lectures.length === 0) {
      say("There is nothing to publish yet.", "error");
      return;
    }
    const library = loadLibrary();
    const savedYaml = (index: number): string | null => {
      const status = course.lectures[index].status;
      if (status?.state !== "done" || !status.id) return null;
      const saved = library.find((d) => d.id === status.id);
      return saved?.playlist ?? (saved ? formatPlaylist(singlePlaylist(saved.spec), "yaml") : null);
    };

    const controller = begin();
    working("Publishing to GitHub…");
    try {
      // Embed BEFORE baking, and both before the commit, so a cancelled or
      // failed step leaves the repo untouched rather than half-published.
      // Each lecture's text is embedded on its own parsed copy — the library
      // row it came from is never rewritten, exactly as a drawcast's own
      // document is not (publish/embed.ts, P §3.4).
      const embedded = embedImages ? await embedLectures(course, savedYaml, settings.contactEmail, controller.signal) : null;
      const embeddedFor = (index: number): string | null => embedded?.get(index) ?? savedYaml(index);
      // "Allow comments" writes the giscus wiring into EVERY lecture's header
      // (C1 — the checkbox used to be silently dropped for courses): each
      // lecture is its own cast link, so each gets its own Discussions
      // thread, keyed to its file path by the viewer. Before the bake, so
      // formatPublished carries the header through unchanged.
      const commentsMeta =
        allowComments && settings.giscusRepoId && settings.giscusCategoryId
          ? { repoId: settings.giscusRepoId, category: settings.giscusCategory, categoryId: settings.giscusCategoryId }
          : null;
      const yamlFor = (index: number): string | null => {
        const yaml = embeddedFor(index);
        if (yaml === null) return yaml;
        if (!commentsMeta && countViews !== false) return yaml;
        const parsed = parsePlaylistText(yaml);
        if (commentsMeta) parsed.meta.comments = commentsMeta;
        return formatPlaylist(applyViewsFlag(parsed, countViews !== false), "yaml");
      };
      const baked = bake ? await bakeLectures(course, yamlFor, controller.signal) : null;
      const publishText = (index: number): string | null => baked?.get(index) ?? yamlFor(index);
      const publishArgs: PublishArgs = {
        text,
        repo,
        token,
        coursesDir: settings.coursesDir,
        viewerBase: settings.viewerBase,
        lectureYaml: publishText,
        fetchImpl: (input, init) => fetch(input, { ...init, signal: controller.signal }),
        onUpload: (done, total) => working(done < total ? `Uploading to GitHub — file ${done + 1}/${total}…` : "Committing…"),
      };
      const prepared = await preparePublish(publishArgs);
      // The registry BEFORE the commit (identity round): the page's door is
      // built only from a name THIS publish registered. A name that comes
      // back taken would otherwise ship a Join button into a stranger's run
      // — the learner's address and answers to someone else — and a name
      // under the floor, or a signed-out publish, a door to "No drawcast
      // called …". The slug and the page URL are known from the plan before
      // anything is written; a name registered for a publish that then fails
      // is ours and recoverable, a door into a stranger's course is neither.
      // Signed out there is no registration and no door. Publishing is
      // complete either way: a registry that is down or a name someone else
      // owns never turns a publish into a failure — it changes the page's
      // join section and the note at the end of the line. The timeout keeps
      // that promise: an unreachable registry costs ten seconds, not the
      // rest of the session.
      let nameSuffix = "";
      let door: Door = { name: null, why: "signed-out" };
      // `token` above is the GitHub one; this is the drawcast server's.
      const accountToken = getToken();
      const reg = accountToken ? prepared.registration : null;
      if (accountToken && reg) {
        working("Registering the course…");
        const bounded: typeof fetch = (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(10_000) });
        // The claim FIRST (teachers round, spec §5): publishing signed in is
        // what makes the author the course's owner in the teacher dashboard,
        // and a name may only be registered by the owner — so the name step
        // never runs for a course this account does not own.
        const claimed = await claimCourse(DEFAULT_ENROLL_API, courseClaim(accountToken, reg), bounded);
        nameSuffix = claimNote(claimed);
        // "error" means we do not know whether this key owns the course — a
        // 404 from an Anvil app not yet redeployed, a timeout, anything that
        // is not one of the explicit ownership answers below. Registering the
        // name anyway falls back to the pre-round behaviour, where /name runs
        // the ownership check itself and answers 403 before touching a name
        // row (spec's own belt-and-braces). "owner", "key" and "invalid" ARE
        // explicit answers, so the name step never runs for them — and
        // neither does "rate": the registry is refusing calls, not unsure.
        if (claimed === "ok" || claimed === "error") {
          if (isRegistrable(reg.name)) {
            const named = await registerName(DEFAULT_ENROLL_API, { key: accountToken, ...reg }, bounded);
            nameSuffix += nameNote(named, reg.name);
            door = named === "ok" ? { name: reg.name, app: settings.viewerBase } : { name: null, why: DOORLESS[named] };
          } else {
            // A name under the floor is not sent (main.ts does the same for
            // a cast): the registry would answer 400 and nameNote would call
            // the name invalid, which it is not — it is short.
            const short = normalizeName(reg.name) !== null;
            nameSuffix += short
              ? ` · name not registered: names need at least ${MIN_NAME_LENGTH} characters — set a longer name: in the course document`
              : nameNote("invalid", reg.name);
            door = { name: null, why: short ? "short" : "invalid" };
          }
        } else {
          door = { name: null, why: claimed === "owner" ? "owner" : claimed === "key" ? "signed-out" : "unreachable" };
        }
      }
      const out = await commitPublish(publishArgs, prepared, door);
      // Past this line the commit has LANDED. Anything that fails below is
      // local bookkeeping, and reporting it as "Publish failed" would send the
      // user hunting for files that are already in their repository.
      publishedViews = countViews !== false;
      const firstTime = !published.has(settings.githubRepo);
      published.add(settings.githubRepo);
      // Writing the permanent file names back into the document is what keeps
      // the links in it pointing at the files that were just committed.
      let bookkeeping: Error | null = null;
      try {
        checkpoint();
        doc.value = out.text; // now carries each lecture's permanent file name
        persist();
        render();
      } catch (err) {
        console.error("drawcast: publish succeeded, bookkeeping failed", err);
        bookkeeping = err as Error;
      }
      if (bookkeeping) {
        say(
          `Published to ${out.courseUrl} — but the file names could not be written back into the document (${bookkeeping.name}: ${bookkeeping.message}). Press Publish again after checking the document.${nameSuffix}`,
          "error",
        );
        return;
      }
      showLinks(out.readmeUrl, out.courseUrl, out.pagesUrl, firstTime, out.defaultBranch);
      const narration = baked ? ` Narration included — ${(bakedTotal / 1_048_576).toFixed(1)} MB across ${baked.size} lecture(s), so viewers need no key.${bakeReport()}` : "";
      // `embedded &&` matters: embeddedTotal survives between publishes, so a
      // second publish with the box off would otherwise report the first
      // publish's count.
      const images = embedded && embeddedTotal > 0 ? ` — ${embeddedTotal} image(s) embedded` : "";
      say(`Published ${out.count} files to ${settings.githubRepo}${images}.${narration}${nameSuffix}`, "ok");
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

  matchBtn.addEventListener("click", () => {
    const course = parseCourse(doc.value);
    const found = matchLibrary(course, loadLibrary(), courseId);
    if (found.length === 0) return;
    let text = doc.value;
    for (const match of found) {
      text = setLectureStatus(text, match.index, restoredStatus(match.id, course.lectures[match.index].status));
    }
    checkpoint();
    doc.value = text;
    try {
      persist();
    } catch (err) {
      say((err as Error).message, "error");
      return;
    }
    render();
    say(
      `Marked ${found.length} lecture${found.length === 1 ? "" : "s"} as done: ${found.map((m) => m.title).join(", ")}. Generate will now skip them. ↩ Undo reverses this.`,
      "ok",
    );
  });

  planBtn.addEventListener("click", () => void plan());
  reviseBtn.addEventListener("click", () => void revise());
  runBtn.addEventListener("click", () => void run());
  shareBtn.addEventListener("click", () => {
    openShare({
      subject: "course",
      doc: () => {
        const course = parseCourse(doc.value);
        return {
          title: course.title || "Untitled course",
          // A course has no single playlist of its own — each lecture has
          // its own — so this is left genuinely empty rather than fabricated
          // from one lecture's content. Do NOT "fix" this by filling in a
          // lecture's playlist: Share's own setup (prepPanels) reads doc()
          // once per open no matter which destination ends up offered,
          // purely to default the hidden YouTube/Video panels a course never
          // shows (shareDestinations offers Link alone for subject
          // "course"); Link's own Publish button never reads doc().playlist
          // at all — it calls deps.publish(bake) below, which is this
          // file's own publish(). sourceLanguage() on an empty playlist is
          // safe (falls back to "en", never throws).
          playlist: { meta: { ...DEFAULT_META }, entries: [], warnings: [] },
          // The one line Link's panel shows so Publish never looks the same
          // as publishing a single drawcast (spec §2).
          lectureCount: course.lectures.length,
          narrationCost: costLabel(addCosts(doneLectureCosts(course))),
          publishedViews,
          // The join box's current state, straight from the document (spec §5).
          joinBox: course.enroll !== undefined,
          // What unchecking would delete — an author running their own Anvil
          // app is the one who needs to see this before the line is gone (F2).
          enrollUrl: course.enroll,
        };
      },
      settings: deps.settings,
      persist: deps.persist,
      setStatus: shareStatus,
      setStatusAction: deps.setStatusAction,
      refreshLibrary: deps.refreshLibrary,
      refreshAccountRow: deps.refreshAccountRow,
      openSettings: deps.openSettings,
      publish,
      // Unreachable by construction: Drive's DESTS row is `courses: false`,
      // so the rail never offers it here and its button is never mounted.
      // Present, and loud rather than silent, because the alternative is an
      // optional field a future caller forgets — and a course publishing
      // itself into one Drive file would be wrong, not merely surprising:
      // publishCourse writes a file per lecture.
      publishDrive: async () => shareStatus("A course publishes to GitHub, not to Drive — its lectures are separate files.", "error"),
      // Same construction, same reason: the server's row is `courses: false`
      // in this round (one cast per key; courses come in a later round), so
      // the rail never offers it here — and if that ever changes, this says
      // so out loud rather than publishing a course as a single cast.
      publishServer: async () => shareStatus("A course publishes to GitHub in this round — the drawcast server takes single drawcasts.", "error"),
      renderVideo: deps.renderVideo,
      beginExport: deps.beginExport,
      setProgress: deps.setProgress,
      endExport: deps.endExport,
      setAbort: deps.setAbort,
    });
  });
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
    h("div", { class: "pane-bar" }, planBtn, reviseBtn, runBtn, cancelBtn, h("span", { class: "pane-spacer" }), cost),
    // Messages sit with the buttons that produce them; the document and the
    // lecture list share the width below, side by side when there is room.
    status,
    links,
    h(
      "div",
      { class: "course-split" },
      h("div", { class: "course-doc-col" }, doc, warnings),
      h("div", { class: "course-rows-col" }, rows),
    ),
  );
  // Undo/Match on the left — a reflow there moves nothing the author is
  // aiming at; Save/Share on the right, primary last.
  modal.footer.append(h("span", { class: "footer-left" }, undoBtn, matchBtn));
  document.body.append(modal.dialog);
  panel = modal;
  reopen = () => {
    syncBusy();
    render();
  };
  loadCourseRef = loadCourse;
  const saved = loadCourses();
  const toLoad = resolveOpenCourseId(openId, saved);
  if (toLoad) loadCourse(toLoad);
  else refreshCourseList();
  render();
  modal.open();
}
