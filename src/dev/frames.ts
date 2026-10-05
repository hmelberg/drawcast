// The dev-only frame harness behind /frames.html — see that file's header for
// why it exists and how to call it. Never in the build (vite's build input is
// index.html alone), so nothing here ships or costs bundle size.
//
// Two passes, deliberately separated because they cost very different things:
//
//   MEASURE (cheap, the default) — for every frame the storyboard RESTS on,
//   lay the spec out with makeBrowserMeasure(), the same real text metrics the
//   app lints with and the test gate cannot use (vitest runs with no DOM, so
//   tests/examples.test.ts measures heuristically). Report the lint issues and
//   every element's bbox. The bboxes are the point: they turn a claim in the
//   narration — "the price rose by a quarter of the tax" — into arithmetic.
//
//   PICTURES (expensive) — mount those same frames as live SVG in a contact
//   sheet, so ONE screenshot of the page shows the whole cast. No canvas, no
//   PNG: what is on screen is the figure's own ink.
//
// A "resting frame" is a boundary the viewer actually sits at: the first beat
// that puts ink down, every boundary where an animate has committed new params
// (plan.states[i].params), and the last boundary (dev/frame-list.ts). Not
// every beat — a draw beat mid-figure is a frame nobody stops on.
//
// MID-GESTURE frames (&beats=all): a frame is the state AFTER its beat, and
// the momentary gestures — highlight, focus, point, flow — hold only while
// their sentence is spoken, so an after-frame never shows them and emphasis
// could not be judged from the sheet. A beat whose step IS one of those is
// drawn as the viewer sees it mid-sentence instead (paintGesture): the same
// backend effect calls the player makes, frozen at full strength. Pictures
// only — window.__frames reports the same data either way.
//
// QUESTION frames (dev/frame-list.ts): every quiz and ask is drawn twice —
// before the answer, with the player's own gate opened on the figure
// (openQuestion: headline, dock, quiz card, cards at home, buttons), and
// after the reveal. The after-state alone showed reviewers answers a live
// viewer never sees while answering, and none of the question.

import bundledExamples from "../examples.json";
import { setTrustPolicy } from "../security/code-trust";
import { composedPairs, elementBBoxes } from "../layout/layout";
import type { BBox } from "../layout/geometry";
import type { Drawable } from "../layout/model";
import { lintCommands } from "../lint/lint";
import { posedIssues } from "../lint/posed";
import { layoutAsSeen } from "../lint/at-scale";
import { figureUnion, fillIssue, fullestFrames, hasHeadingInk } from "../lint/fill";
import { smallTemplateText } from "../lint/template-text";
import { pacingReport, type PacingProblem } from "../lint/pacing-report";
import { itemsOf, parsePlaylistText } from "../playlist/playlist";
import { render } from "../render";
import { specAt } from "../render/params";
import { LASER_COLOR, makeBrowserMeasure } from "../render/svg-backend";
import { FOCUS_DIM, type BackendEffects } from "../render/backend";
import { pointerPath } from "../render/effects";

// Dev only: this harness renders the local author's own files and the
// bundled examples (scripts/cast.mjs), never a stranger's cast — so the code
// they carry runs without the viewer prompt (security/code-trust.ts).
setTrustPolicy("all");
import { sceneAt, type PlanStep } from "../render/plan";
import { posedBox } from "../render/pose";
import { gestureAt, gestureLabel } from "./gesture-beats";
import { MARK_GLIDE_MS, MARK_IN_MS, markFrameAt } from "../render/marks";
import type { RenderHandle } from "../render/index";
import { toSvgY } from "../layout/canvas";
import { resolveCode } from "../render/code";
import { resolveIcons } from "../render/icon";
import { expandSpec } from "../spec/expand";
import { validateSpec } from "../spec/schema";
import type { Spec } from "../spec/types";
import { ensureEnginesForSpecs } from "../scenes/engines";
import { ensureEnabledPacks, PACK_DEFS } from "../scenes/packs";
import { compileCard } from "../card/convert";
import type { CardResult } from "../card/types";
import { posterForPlaylistText } from "../export/snapshot";
import { attachPlayerControls } from "../ui/controls";
import { frameLabel, frameList } from "./frame-list";
// The gates' own look (the headline, the dock, the quiz card): a question
// frame opens the real gate on the figure, as the player does.
import "../styles.css";

interface FrameReport {
  /** Boundary: the figure as it stands after this many plan steps (a
   *  question frame: the boundary before its question — what is judged). */
  at: number;
  /** Why this frame is a resting place — "first ink", an animate's overrides, a
   *  beat, "end", or a question's pair (dev/frame-list.ts). */
  changed: string;
  /** A question's pair: the question's step number (1-based) — the @N of both labels. */
  ask?: number;
  /** The question frame: the figure BEFORE the answer (boundary `at`), the gate open on it. */
  before?: true;
  /** Cumulative animate overrides at this boundary (dot paths). */
  params: Record<string, number>;
  /** The narration spoken between the previous resting frame and this one. */
  speak: string[];
  /** Lint at this frame, measured in the browser, for elements actually ON
   *  SCREEN at this boundary. `[warn] …` / `[error] …`. */
  issues: string[];
  /** Issues the layout reports at this frame about elements the storyboard has
   *  not drawn yet, or has erased. The app's own lint cannot tell these apart —
   *  it reads base geometry — so they are kept, separately, rather than mixed in
   *  with defects a viewer can see. */
  hiddenIssues: string[];
  /** Advice, not defects (lint/fill.ts): judged on a page at its fullest. */
  advisories: string[];
  /** Every element's bounding box at this frame, logical units (y-up). */
  bboxes: Record<string, BBox>;
}

interface PartReport {
  title: string;
  template?: string;
  validationErrors: string[];
  planWarnings: string[];
  /** Command-level lint (slow-start, talky-stretch, …) — frame-independent. */
  commandIssues: string[];
  /** Exceptions thrown while stepping the whole timeline boundary by boundary. */
  playbackErrors: string[];
  /** Icons that resolved to nothing and so draw BLANK: one line each, with how to give fallbacks. */
  iconIssues: string[];
  frames: FrameReport[];
  /** Timing, as the player would run it (lint/pacing-report.ts): the totals
   *  line, then one line per idle stretch, silent ink or overlong beat —
   *  beats numbered @N like the frames. `problems` carries the same, structured. */
  pacing: { lines: string[]; totalMs: number; spokenLines: number; lengthBand: string; problems: PacingProblem[] };
}

interface CastReport {
  title: string;
  source: string;
  parts: PartReport[];
  consoleErrors: string[];
}

/** A cast as this page understands it: one spec, or a playlist's parts. */
interface Cast {
  title: string;
  source: string;
  parts: Spec[];
}

const measure = makeBrowserMeasure();

/**
 * A cast from text: a bare spec, an examples.json entry ({request, spec} or
 * {request, playlist}), an array of those (the first is taken), or playlist
 * YAML. Forgiving on purpose — a cast arrives here pasted, not validated.
 */
function parseCastText(text: string, source: string): Cast {
  const trimmed = text.trim();
  let json: unknown = null;
  try {
    json = JSON.parse(trimmed);
  } catch {
    /* not JSON — playlist YAML below */
  }
  if (json !== null && typeof json === "object") {
    const entry = (Array.isArray(json) ? json[0] : json) as { request?: string; title?: string; spec?: Spec; playlist?: string } & Spec;
    if (typeof entry.playlist === "string") return { ...playlistCast(entry.playlist), title: entry.title ?? entry.request ?? source, source };
    const spec = (entry.spec ?? entry) as Spec;
    return { title: spec.title ?? entry.request ?? source, source, parts: [spec] };
  }
  return { ...playlistCast(trimmed), source };
}

function playlistCast(text: string): Cast {
  const playlist = parsePlaylistText(text);
  const items = itemsOf(playlist);
  return { title: playlist.meta.title ?? "playlist", source: "playlist", parts: items.map((i) => i.spec) };
}

function bundledCast(index: number): Cast {
  const ex = (bundledExamples as { request: string; title?: string; spec?: Spec; playlist?: string }[])[index];
  if (!ex) throw new Error(`no bundled example at index ${index} (0…${bundledExamples.length - 1})`);
  const title = ex.spec?.title ?? ex.title ?? ex.request;
  if (ex.playlist) return { ...playlistCast(ex.playlist), title, source: `examples.json[${index}]` };
  return { title, source: `examples.json[${index}]`, parts: ex.spec ? [ex.spec] : [] };
}

function speakBetween(steps: { kind: string; text?: string }[], from: number, to: number): string[] {
  return steps.slice(from, to).flatMap((s) => (s.kind === "speak" && s.text ? [s.text] : []));
}

/** Whether this run shows every narrated beat, not just the resting frames. */
let everyBeatFlag = new URLSearchParams(location.search).get("beats") === "all";
const everyBeat = () => everyBeatFlag;

/** Mount a spec off-screen, walk every boundary, and report what broke. */
async function reportPart(spec: Spec, host: HTMLElement): Promise<PartReport> {
  const validation = validateSpec(spec);
  // Icons are keywords (round 6): the lint judges the figure with its icons
  // resolved, as render() draws it — an unresolved icon draws nothing, and
  // its `at` would read as ignored.
  const withIcons = structuredClone(spec);
  const icons = await resolveIcons(withIcons).catch((err: unknown) => [{ id: "icons", ok: false, of: "", error: String(err) }]);
  const expanded = expandSpec(withIcons);
  const report: PartReport = {
    title: spec.title ?? "(untitled)",
    template: spec.template,
    validationErrors: validation.errors,
    planWarnings: [],
    commandIssues: lintCommands(expanded).map((i) => `[${i.severity}] ${i.rule}: ${i.message}`),
    playbackErrors: [],
    iconIssues: icons.filter((r) => !r.ok).map((r) => `${r.id}: no icon for "${r.of ?? "?"}" — draws BLANK (${r.error ?? "not found"}); give fallbacks: "icon": ["${r.of ?? "…"}", "…"] (an icon element: "or": […]) or draw it by hand`),
    frames: [],
    pacing: { lines: [], totalMs: 0, spokenLines: 0, lengthBand: "", problems: [] },
  };
  const hd = await render(spec, host, { mode: "silent" });
  try {
    report.planWarnings = hd.plan.warnings;
    const pacing = pacingReport(hd.plan.steps, (i) => hd.timeline.stepRunMs(i));
    report.pacing = { lines: pacing.lines, totalMs: pacing.totalMs, spokenLines: pacing.spokenLines, lengthBand: pacing.lengthBand, problems: pacing.problems };
    const frames = frameList(hd.plan, everyBeat());
    // Does it play at all? Step every boundary, not just the resting ones —
    // an exception halfway through a cast is invisible to any lint.
    for (let n = 0; n <= hd.plan.steps.length; n++) {
      try {
        hd.timeline.renderUpTo(n);
      } catch (err) {
        report.playbackErrors.push(`boundary ${n}: ${(err as Error).message}`);
      }
    }
    let prevAt = 0;
    const fillInputs: { boxes: [string, BBox][]; visible: (id: string) => boolean; drawables: Drawable[] }[] = [];
    for (const frame of frames) {
      const params = hd.plan.states[frame.at - 1]?.params ?? {};
      // A tree's blanks still to be asked are "?" here, as on screen.
      const answers = frame.at > 0 ? hd.plan.states[frame.at - 1]?.answers : undefined;
      const atParams = specAt(expanded, params);
      const at = answers && Object.keys(answers).length > 0 ? { ...atParams, params: { ...(atParams.params ?? {}), answers } } : atParams;
      // A posed frame skips the draw-beat lints, as tests/examples.test.ts does:
      // template-id-off asks whether EVERY draw's id exists in THIS state, so a
      // label a template drops at small h (tangent_secant's Δx) was reported
      // at the end frame although it was drawn, correctly, while it existed.
      const posed = Object.keys(params).length > 0;
      // At the cast's text scale, as the player draws it (its drawables carry drawn sizes).
      const layout = layoutAsSeen(at, measure, undefined, undefined, posed ? { skipDrawBeatLint: true } : undefined);
      const boxes = elementBBoxes(layout, measure);
      // What the viewer can actually see at this boundary. An overlap between
      // an element that is drawn and one that is not (a label erased two beats
      // ago, a curve not yet inked) is geometry, not a defect — and it is
      // exactly what the app's own lint has no way to know.
      const visible = new Set(hd.plan.states[frame.at - 1]?.visible ?? []);
      const onScreen = (ids: string[]) => ids.length === 0 || ids.every((id) => visible.has(id) || [...visible].some((v) => id.startsWith(`${v}__`)));
      // …and where it stands: an element moved since it was drawn is judged at its new place.
      const state = hd.plan.states[frame.at - 1];
      const issues = state ? posedIssues(layout.drawables, measure, state, layout.issues, layout.world, composedPairs(at, layout)) : layout.issues;
      const seen = issues.filter((i) => onScreen(i.ids));
      const unseen = issues.filter((i) => !onScreen(i.ids));
      report.frames.push({
        at: frame.at,
        changed: frame.changed,
        ...(frame.ask !== undefined ? { ask: frame.ask } : {}),
        ...(frame.before ? { before: true as const } : {}),
        params,
        // A question frame: the question itself, as the headline reads it.
        speak: frame.before ? [String((hd.plan.steps[frame.at] as { question?: string }).question ?? "")] : speakBetween(hd.plan.steps as { kind: string; text?: string }[], prevAt, frame.at),
        issues: seen.map((i) => `[${i.severity}] ${i.message}`),
        hiddenIssues: unseen.map((i) => `[${i.severity}] ${i.message} (not on screen at ${frameLabel(frame).split(" ")[0]})`),
        advisories: [],
        bboxes: Object.fromEntries([...boxes.entries()].map(([id, b]) => [id, b])),
      });
      fillInputs.push({ boxes: [...boxes.entries()], visible: (id) => onScreen([id]), drawables: layout.drawables });
      if (!frame.before) prevAt = frame.at;
    }
    // The fill advisory, on each page at its fullest (lint/fill.ts).
    const unions = fillInputs.map((f) => figureUnion(f.boxes, f.visible));
    const heading = hasHeadingInk((expanded.elements ?? []).map((e) => e.id));
    for (const i of fullestFrames(unions.map((u) => (u ? u.w * u.h : 0)))) {
      const issue = fillIssue(fillInputs[i].boxes, { heading, visible: fillInputs[i].visible });
      const fr = report.frames[report.frames.length - fillInputs.length + i];
      if (issue && fr) fr.advisories.push(`[advisory] ${issue.rule}: ${issue.message}`);
      // Template text under the readable minimum as drawn (W30).
      const small = smallTemplateText(fillInputs[i].drawables, expanded, fillInputs[i].visible);
      if (small && fr) fr.advisories.push(`[advisory] ${small.rule}: ${small.message}`);
    }
  } finally {
    hd.destroy();
  }
  return report;
}

// ---- mid-gesture frames ----


/**
 * Hold a gesture on a mount parked at its boundary, as the player paints it
 * mid-sentence (render/player.ts, the highlight/focus/flow/point cases): the
 * same BackendEffects calls, at full level, with enough elapsed time that a
 * marker or band is fully written. The player keeps its effects private; a
 * dev page reaches in rather than widen the app's API for a picture.
 */
function paintGesture(hd: RenderHandle, at: number, step: PlanStep, canvas: HTMLElement): void {
  const effects = (hd.timeline as unknown as { effects: BackendEffects | null }).effects;
  if (!effects) return;
  const before = sceneAt(hd.plan, at - 1);
  switch (step.kind) {
    case "highlight": {
      // Each target's own box, as the player passes them.
      const boxList = step.ids.flatMap((id) => {
        const b = step.boxes[id];
        if (!b) return [];
        return [posedBox(b, before.offsets[id] ?? [0, 0], before.turns[id])];
      });
      effects.setHighlight(step.ids, step.effect, 1, boxList.length > 0 ? boxList : null, step.color, 10_000, step.part);
      return;
    }
    case "focus": {
      const keep = new Set(step.ids);
      effects.setFocus?.(before.visible.filter((id) => !keep.has(id)), FOCUS_DIM);
      return;
    }
    case "mark": {
      // The end state: written, at full, at the last stop, the light at its
      // deepest — sampled late enough that even a short step has eased in
      // and finished its glide.
      const ms = Math.max(step.seconds * 1000, MARK_IN_MS + MARK_GLIDE_MS);
      effects.setMark?.(step.owner, markFrameAt(step, ms, ms));
      // The command's marks on other pictures run with it (parallel): lit on the same frame.
      for (let j = at; hd.plan.steps[j]?.kind === "mark" && (hd.plan.steps[j] as { parallel?: true }).parallel; j++) {
        const s = hd.plan.steps[j] as Extract<PlanStep, { kind: "mark" }>;
        const sms = Math.max(s.seconds * 1000, MARK_IN_MS + MARK_GLIDE_MS);
        effects.setMark?.(s.owner, markFrameAt(s, sms, sms));
      }
      return;
    }
    case "flow": {
      effects.setFlow?.(step.ids, { spacing: step.spacing, marks: step.marks, color: step.color, reverse: step.reverse }, { travelled: step.spacing * 0.4, alpha: 1 });
      // The marks are the stroke's own colour on the stroke: moving, they catch
      // the eye; stilled in a thumbnail they read as bumps. Fatten them here
      // (the sheet only) so a still shows where the flow runs.
      const dash = step.marks === "dots" ? `0.1 ${step.spacing}` : `${step.spacing / 2} ${step.spacing / 2}`;
      for (const p of canvas.querySelectorAll(`[data-leaf-id] > path[stroke-dasharray="${dash}"]`)) p.setAttribute("stroke-width", step.marks === "dots" ? "13" : "7");
      return;
    }
    case "point": {
      const path = pointerPath({ x: step.x, y: step.y, box: step.box }, step.gesture);
      // The gesture's own trace (a ring, a sweep), faint, under the dot where it ends.
      if (step.gesture !== "tap") {
        const pts = Array.from({ length: 61 }, (_, i) => path(0.22 + (0.95 - 0.22) * (i / 60)));
        const trace = document.createElementNS("http://www.w3.org/2000/svg", "path");
        trace.setAttribute("d", pts.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${toSvgY(y).toFixed(1)}`).join(" "));
        trace.setAttribute("fill", "none");
        trace.setAttribute("stroke", LASER_COLOR);
        trace.setAttribute("stroke-width", "3");
        trace.setAttribute("stroke-dasharray", "2 6");
        trace.setAttribute("stroke-linecap", "round");
        trace.setAttribute("opacity", "0.55");
        canvas.querySelector(".cs-overlay")?.appendChild(trace);
      }
      effects.setPointer(path(1));
      return;
    }
  }
}

// ---- question frames ----

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Stand a mount at the viewer's turn of the question at step `at`: the
 * player's own controls and gates attached (ui/controls.ts), the playhead at
 * the boundary before the question, played until its gate opens — so the
 * tile shows what the player draws there (the headline and dock, the quiz
 * card, the cards at home, the guessed part not yet drawn, the on-canvas
 * buttons), then left waiting on the gate, which nobody answers.
 * Returns a note when the gate never opened, else null.
 */
async function openQuestion(hd: RenderHandle, canvas: HTMLElement, at: number): Promise<string | null> {
  attachPlayerControls(canvas, hd, { mode: "silent", speed: 2, questions: "interactive" });
  const tl = hd.timeline;
  let opened = (): void => undefined;
  const open = new Promise<boolean>((r) => (opened = () => r(true)));
  const quiz = tl.quizGate;
  const ask = tl.askGate;
  if (quiz) tl.quizGate = (signal, step) => (opened(), quiz(signal, step));
  if (ask) tl.askGate = (signal, step) => (opened(), ask(signal, step));
  // Fast: what precedes the gate (the question's silent reading, a line
  // drawing itself in) is not what the picture is of.
  tl.setSpeed(10);
  tl.renderUpTo(at);
  void tl.play().catch(() => undefined);
  const ok = await Promise.race([open, sleep(15_000).then(() => false)]);
  // The headline fades in, the cards glide home, a stage fades the rest.
  await sleep(1200);
  return ok ? null : `the question's gate did not open in 15 s — this is the boundary before it, without the gate`;
}

// ---- the page ----

const app = document.getElementById("frames-app")!;
const consoleErrors: string[] = [];
const realError = console.error.bind(console);
console.error = (...args: unknown[]) => {
  consoleErrors.push(args.map((a) => (a instanceof Error ? a.message : String(a))).join(" "));
  realError(...args);
};
window.addEventListener("error", (e) => consoleErrors.push(e.message));
window.addEventListener("unhandledrejection", (e) => consoleErrors.push(String((e as PromiseRejectionEvent).reason)));

const css = `
  body { margin: 0; font: 14px/1.5 -apple-system, system-ui, sans-serif; background: #faf8f4; color: #222; }
  header { padding: 14px 18px; border-bottom: 1px solid #ddd; display: flex; gap: 12px; align-items: baseline; flex-wrap: wrap; }
  h1 { font-size: 16px; margin: 0; }
  .hint { color: #666; font-size: 12px; }
  textarea { width: 100%; box-sizing: border-box; min-height: 90px; font: 12px/1.4 ui-monospace, monospace; }
  .part { padding: 12px 18px; border-bottom: 1px solid #eee; }
  .part h2 { font-size: 14px; margin: 0 0 8px; }
  .sheet { display: flex; flex-wrap: wrap; gap: 14px; }
  .cell { width: 460px; }
  .canvas { width: 460px; height: 345px; background: #fff; border: 1px solid #ddd; overflow: hidden; position: relative; }
  /* A question frame carries the player's controls for its gates: the bar
     itself is not part of the picture. */
  .canvas .cs-controlbar, .canvas .cs-bigplay { display: none !important; }
  .cap { font: 11px/1.35 ui-monospace, monospace; color: #444; padding: 4px 0; }
  .cap b { color: #111; }
  .bad { color: #b5482e; }
  .ok { color: #2f6b8f; }
  .advice { color: #8a5fa8; white-space: pre-wrap; }
  pre { font: 11px/1.4 ui-monospace, monospace; white-space: pre-wrap; margin: 4px 0 0; }
`;
const style = document.createElement("style");
style.textContent = css;
document.head.appendChild(style);

function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, ...kids: (Node | string)[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  for (const kid of kids) el.append(kid);
  return el;
}

async function loadCast(): Promise<Cast> {
  const q = new URLSearchParams(location.search);
  const index = q.get("index");
  const url = q.get("cast");
  if (index !== null) return bundledCast(Number(index));
  if (url !== null) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url}: ${res.status} ${res.statusText}`);
    return parseCastText(await res.text(), url);
  }
  throw new Error("nothing to show: pass ?index=<n> or ?cast=<url>, or paste a cast below");
}

/** Draw the contact sheet AND return the report — pictures and numbers from one pass. */
async function show(cast: Cast): Promise<CastReport> {
  await ensureEnabledPacks(Object.keys(PACK_DEFS));
  await ensureEnginesForSpecs(cast.parts);
  const report: CastReport = { title: cast.title, source: cast.source, parts: [], consoleErrors };
  for (const [i, spec] of cast.parts.entries()) {
    const section = h("section", { class: "part" });
    const offscreen = h("div", { style: "position:fixed;left:-10000px;top:0;width:800px;height:600px" });
    document.body.append(offscreen);
    let part: PartReport;
    try {
      part = await reportPart(spec, offscreen);
    } finally {
      offscreen.remove();
    }
    report.parts.push(part);
    section.append(h("h2", {}, `${i + 1}. ${part.title}${part.template ? ` — ${part.template}` : " — freehand"}`));
    for (const [label, lines] of [
      ["validation", part.validationErrors],
      ["plan", part.planWarnings],
      ["commands", part.commandIssues],
      ["playback", part.playbackErrors],
      ["icons", part.iconIssues],
    ] as const) {
      if (lines.length > 0) section.append(h("pre", { class: "bad" }, `${label}: ${lines.join("\n")}`));
    }
    section.append(h("pre", { class: part.pacing.problems.length > 0 ? "bad" : "ok" }, part.pacing.lines.join("\n")));
    const sheet = h("div", { class: "sheet" });
    for (const frame of part.frames) {
      const cell = h("div", { class: "cell" });
      const canvas = h("div", { class: "canvas" });
      cell.append(canvas);
      const cap = h("div", { class: "cap" });
      // Each cell is its own mount held at its own boundary: the sheet is live
      // ink, so a screenshot of this page is a screenshot of the real figure.
      const hd = await render(spec, canvas, { mode: "silent" });
      // A question frame: the viewer's turn, as the player stands it — the
      // real gate opened on the boundary before the question.
      const gateTrouble = frame.before ? await openQuestion(hd, canvas, frame.at) : null;
      if (!frame.before) hd.timeline.renderUpTo(frame.at);
      // Only with &beats=all: a resting frame stays the after-state it always was.
      const gesture = everyBeat() && !frame.before ? gestureAt(hd.plan, frame.at) : null;
      if (gesture) paintGesture(hd, frame.at, gesture, canvas);
      cap.append(h("b", {}, `${frameLabel(frame)}${gesture ? ` (mid-gesture: ${gestureLabel(gesture)})` : ""}`));
      if (gateTrouble) cap.append(h("div", { class: "bad" }, gateTrouble));
      if (frame.issues.length > 0) cap.append(h("div", { class: "bad" }, frame.issues.join("\n")));
      else cap.append(h("span", { class: "ok" }, ` — lint clean (browser metrics)${frame.hiddenIssues.length > 0 ? ` · ${frame.hiddenIssues.length} off-screen` : ""}`));
      if (frame.advisories?.length) cap.append(h("div", { class: "advice" }, frame.advisories.join("\n")));
      if (frame.speak.length > 0) cap.append(h("div", {}, `“${frame.speak[frame.speak.length - 1]}”`));
      cell.append(cap);
      sheet.append(cell);
    }
    section.append(sheet);
    app.append(section);
  }
  return report;
}

const header = h("header");
header.append(h("h1", {}, "drawcast frames (dev)"));
const hint = h("span", { class: "hint" }, "?index=<n> · ?cast=<url> · &beats=all · or paste a spec / {request, spec} / playlist YAML and press ⌘⏎");
header.append(hint);
const box = h("textarea", { placeholder: "paste a cast here, then ⌘⏎ / Ctrl+⏎" });
header.append(box);
document.body.prepend(header);

let latest: CastReport | null = null;

async function run(cast: Cast): Promise<CastReport> {
  app.replaceChildren();
  consoleErrors.length = 0;
  try {
    latest = await show(cast);
  } catch (err) {
    app.append(h("pre", { class: "bad" }, String((err as Error).message ?? err)));
    latest = { title: cast.title, source: cast.source, parts: [], consoleErrors };
  }
  return latest;
}

box.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void run(parseCastText(box.value, "pasted"));
});

/**
 * The driver's entry point: measurements without pictures when given a cast,
 * or the last drawn cast's report when called bare. Small answer by design —
 * the pictures are on the page, for a screenshot, not in this JSON.
 */
declare global {
  interface Window {
    __stampCode: (index: number) => Promise<Record<string, string>>;
    __poster: (text: string) => Promise<string | null>;
    __card: (text: string, opts?: { private?: boolean }) => Promise<CardResult | null>;
    __frames: (input?: { index?: number; cast?: string; text?: string; beats?: "all" | "resting" }) => Promise<CastReport>;
  }
}
/**
 * The recorder's call (scripts/stamp-code-results.mjs): run a bundled
 * example's scripts with the real runtimes, the way render() does, and hand
 * back each code element's envelope — figures reduced to their size, the
 * only thing layout reads — for the examples gate to lay out real data in
 * Node (tests/fixtures/code-results.json).
 */
window.__stampCode = async (index) => {
  const ex = (bundledExamples as { spec?: Spec }[])[index];
  if (!ex?.spec) return {};
  const clone = structuredClone(expandSpec(ex.spec));
  await resolveCode(clone, { style: "sketchy" });
  const out: Record<string, string> = {};
  for (const el of clone.elements ?? []) {
    if (el.type !== "code" || !el.code_result) continue;
    const env = JSON.parse(el.code_result) as { figures?: { href: string; w: number; h: number }[] };
    if (env.figures) env.figures = env.figures.map((f) => ({ ...f, href: "data:image/png;base64," }));
    out[el.id] = JSON.stringify(env);
  }
  return out;
};

window.__frames = async (input) => {
  if (input?.beats !== undefined) everyBeatFlag = input.beats === "all";
  if (input?.text !== undefined) return run(parseCastText(input.text, "passed in"));
  if (input?.index !== undefined) return run(bundledCast(input.index));
  if (input?.cast !== undefined) {
    const res = await fetch(input.cast);
    return run(parseCastText(await res.text(), input.cast));
  }
  if (latest) return latest;
  return run(await loadCast());
};

// A cast named in the URL draws itself; otherwise the box waits.
const q = new URLSearchParams(location.search);
if (q.has("index") || q.has("cast")) void loadCast().then(run);
else app.append(h("pre", {}, "Paste a cast above and press ⌘⏎ — or open with ?index=274 / ?cast=/dev-casts/x.json"));

/**
 * The picture a published cast shows on its link card (spec 2026-10-02-
 * share-design §7.1), for scripts/pictures.mjs: the app's own
 * posterForPlaylistText, as base64 — or null when nothing could be drawn.
 */
window.__poster = async (text) => {
  await ensureEnabledPacks(Object.keys(PACK_DEFS));
  const bytes = await posterForPlaylistText(text);
  if (!bytes) return null;
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
};

/**
 * The card lab's call (scripts/card-lab.mjs, 2026-10-05): the cast's
 * compiled card (src/card/convert.ts) — the poster frame's own drawing,
 * simplified — or null when it has no poster item.
 */
window.__card = async (text, opts) => {
  await ensureEnabledPacks(Object.keys(PACK_DEFS));
  return compileCard(text, opts);
};
