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
// (plan.states[i].params), and the last boundary. Not every beat — a draw beat
// mid-figure is a frame nobody stops on.

import bundledExamples from "../examples.json";
import { elementBBoxes, layoutSpec } from "../layout/layout";
import type { BBox } from "../layout/geometry";
import { lintCommands } from "../lint/lint";
import { itemsOf, parsePlaylistText } from "../playlist/playlist";
import { render } from "../render";
import { splitVarOverrides, withOverrides } from "../render/params";
import { makeBrowserMeasure } from "../render/svg-backend";
import { expandSpec } from "../spec/expand";
import { validateSpec } from "../spec/schema";
import type { Spec } from "../spec/types";
import { ensureEnginesForSpecs } from "../scenes/engines";
import { ensureEnabledPacks, PACK_DEFS } from "../scenes/packs";

interface FrameReport {
  /** Boundary: the figure as it stands after this many plan steps. */
  at: number;
  /** Why this frame is a resting place — "first ink", an animate's overrides, or "end". */
  changed: string;
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
  frames: FrameReport[];
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

/** The spec at a set of animate overrides — the shape render() lays out
 *  (`vars.<name>` keys into vars, everything else into params). Mirrors
 *  `specAt` in tests/examples.test.ts on purpose: the two must agree. */
function specAt(spec: Spec, overrides: Record<string, number>): Spec {
  if (Object.keys(overrides).length === 0) return spec;
  const split = splitVarOverrides(overrides);
  return {
    ...spec,
    params: withOverrides(spec.params, split.params),
    ...(Object.keys(split.vars).length > 0 ? { vars: { ...(spec.vars ?? {}), ...split.vars } } : {}),
  };
}

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

/** Boundaries the viewer rests at, with why. */
function restingFrames(plan: { steps: { kind: string }[]; states: { params: Record<string, number> }[] }): { at: number; changed: string }[] {
  const out: { at: number; changed: string }[] = [];
  const firstDraw = plan.steps.findIndex((s) => s.kind === "draw");
  if (firstDraw >= 0) out.push({ at: firstDraw + 1, changed: "first ink" });
  let prev = "{}";
  plan.states.forEach((state, i) => {
    const key = JSON.stringify(state.params ?? {});
    if (key !== prev) {
      // An animate commits its overrides at this boundary. Report the delta,
      // not the whole accumulated set — what CHANGED is the interesting part.
      out.push({ at: i + 1, changed: `animate ${key}` });
      prev = key;
    }
  });
  if (plan.steps.length > 0) out.push({ at: plan.steps.length, changed: "end" });
  // Dedupe by boundary, keeping the first reason given for it.
  const seen = new Set<number>();
  return out.filter((f) => (seen.has(f.at) ? false : (seen.add(f.at), true))).sort((a, b) => a.at - b.at);
}

function speakBetween(steps: { kind: string; text?: string }[], from: number, to: number): string[] {
  return steps.slice(from, to).flatMap((s) => (s.kind === "speak" && s.text ? [s.text] : []));
}

/** Mount a spec off-screen, walk every boundary, and report what broke. */
async function reportPart(spec: Spec, host: HTMLElement): Promise<PartReport> {
  const validation = validateSpec(spec);
  const expanded = expandSpec(spec);
  const report: PartReport = {
    title: spec.title ?? "(untitled)",
    template: spec.template,
    validationErrors: validation.errors,
    planWarnings: [],
    commandIssues: lintCommands(expanded).map((i) => `[${i.severity}] ${i.rule}: ${i.message}`),
    playbackErrors: [],
    frames: [],
  };
  const hd = await render(spec, host, { mode: "silent" });
  try {
    report.planWarnings = hd.plan.warnings;
    const frames = restingFrames(hd.plan);
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
    for (const frame of frames) {
      const params = hd.plan.states[frame.at - 1]?.params ?? {};
      const at = specAt(expanded, params);
      const layout = layoutSpec(at, measure);
      const boxes = elementBBoxes(layout, measure);
      // What the viewer can actually see at this boundary. An overlap between
      // an element that is drawn and one that is not (a label erased two beats
      // ago, a curve not yet inked) is geometry, not a defect — and it is
      // exactly what the app's own lint has no way to know.
      const visible = new Set(hd.plan.states[frame.at - 1]?.visible ?? []);
      const onScreen = (ids: string[]) => ids.length === 0 || ids.every((id) => visible.has(id) || [...visible].some((v) => id.startsWith(`${v}__`)));
      const seen = layout.issues.filter((i) => onScreen(i.ids));
      const unseen = layout.issues.filter((i) => !onScreen(i.ids));
      report.frames.push({
        at: frame.at,
        changed: frame.changed,
        params,
        speak: speakBetween(hd.plan.steps as { kind: string; text?: string }[], prevAt, frame.at),
        issues: seen.map((i) => `[${i.severity}] ${i.message}`),
        hiddenIssues: unseen.map((i) => `[${i.severity}] ${i.message} (not on screen at @${frame.at})`),
        bboxes: Object.fromEntries([...boxes.entries()].map(([id, b]) => [id, b])),
      });
      prevAt = frame.at;
    }
  } finally {
    hd.destroy();
  }
  return report;
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
  .canvas { width: 460px; height: 345px; background: #fff; border: 1px solid #ddd; overflow: hidden; }
  .cap { font: 11px/1.35 ui-monospace, monospace; color: #444; padding: 4px 0; }
  .cap b { color: #111; }
  .bad { color: #b5482e; }
  .ok { color: #2f6b8f; }
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
    ] as const) {
      if (lines.length > 0) section.append(h("pre", { class: "bad" }, `${label}: ${lines.join("\n")}`));
    }
    const sheet = h("div", { class: "sheet" });
    for (const frame of part.frames) {
      const cell = h("div", { class: "cell" });
      const canvas = h("div", { class: "canvas" });
      cell.append(canvas);
      const cap = h("div", { class: "cap" });
      cap.append(h("b", {}, `@${frame.at} ${frame.changed}`));
      if (frame.issues.length > 0) cap.append(h("div", { class: "bad" }, frame.issues.join("\n")));
      else cap.append(h("span", { class: "ok" }, ` — lint clean (browser metrics)${frame.hiddenIssues.length > 0 ? ` · ${frame.hiddenIssues.length} off-screen` : ""}`));
      if (frame.speak.length > 0) cap.append(h("div", {}, `“${frame.speak[frame.speak.length - 1]}”`));
      cell.append(cap);
      sheet.append(cell);
      // Each cell is its own mount held at its own boundary: the sheet is live
      // ink, so a screenshot of this page is a screenshot of the real figure.
      const hd = await render(spec, canvas, { mode: "silent" });
      hd.timeline.renderUpTo(frame.at);
    }
    section.append(sheet);
    app.append(section);
  }
  return report;
}

const header = h("header");
header.append(h("h1", {}, "drawcast frames (dev)"));
const hint = h("span", { class: "hint" }, "?index=<n> · ?cast=<url> · or paste a spec / {request, spec} / playlist YAML and press ⌘⏎");
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
    __frames: (input?: { index?: number; cast?: string; text?: string }) => Promise<CastReport>;
  }
}
window.__frames = async (input) => {
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
