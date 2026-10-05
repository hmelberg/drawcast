// The pacing report: a cast's TIMING, read off its plan the way the player
// would run it, for the frames harness (src/dev/frames.ts → cast.mjs frames).
// The frame tiles show the picture; this says where the picture stands still
// while the voice goes on, where the ink runs on after the voice, which beat
// is too long, and how long the whole thing is.
//
// No timing model of its own. Every number comes from the app:
//   - a spoken line lasts lineMs() (render/cue.ts) — SpeechManager's reading
//     estimate with the line's delivery rate, the same number the player
//     times cues by and the one unbaked narration runs on;
//   - an action lasts what the player gives it (Player.stepRunMs — a draw's
//     paced element durations, an erase at its own speed, every other
//     animating kind its planned `seconds`), passed in as `runMs`;
//   - a cued action starts at cueStartMs() (render/cue.ts);
//   - the step semantics are runStep/runAction's (render/player.ts): a
//     narrated action and its sentence start together and the beat ends when
//     both have; a non-blocking speak runs on under the next steps until one
//     that waits for it (the narration barrier); a gesture held to its
//     sentence (untilNarrationEnd) moves for the whole line.
// Pure: tests/pacing-report.test.ts drives it with hand-built plans.

import { BRIEF_CONTROLS } from "../llm/brief-controls";
import { cueStartMs, lineMs } from "../render/cue";
import type { PlanStep } from "../render/plan";

// ---- thresholds (tune here) ----
// Soft limits (Hans, 2026-09-30): a flag is a question for the author, not a
// failure — a deliberate stillness (a pause that lets a result sink in) may
// stand. The opening is the exception that goes the other way: talk before
// anything is drawn loses the viewer, so it is held to a tighter limit.

/** A stretch this long with nothing new on the canvas — no stroke drawn, nothing
 *  moving, no gesture — is flagged. Speech alone does not count as activity. */
export const IDLE_MAX_MS = 5000;
/** The same, before the first ink: the opening line should ride the first
 *  strokes, so only a breath of talk over a blank page passes. */
export const INTRO_IDLE_MAX_MS = 2000;
/** A narrated action still drawing/moving this long after its sentence ends
 *  is flagged: silent ink the viewer watches with no voice. */
export const INK_AFTER_VOICE_MAX_MS = 2000;
/** One beat (a spoken line with its action) longer than this is flagged —
 *  split it. SpeechManager.estimateMs caps a line at 15 s, so a line alone
 *  reaching this is a line of 43+ words. */
export const OVERLONG_BEAT_MS = 15000;

// ---- model ----

/** Steps that stop the clock: the viewer answers, explores or presses on. */
const INTERACTIVE = new Set(["wait", "quiz", "ask", "explore"]);
/** Steps with no picture and no time. */
const NO_TIME = new Set(["label", "if"]);
/** Actions that wait out a running non-blocking speak first (player.ts narrationBarrier). */
const BARRIER = new Set(["play", "run", "draw", "show", "erase", "clear", "animate", "copy"]);
/** Gestures a sentence can hold for its whole length. */
const HELD = new Set(["highlight", "focus", "flow", "mark"]);

export interface BeatTiming {
  /** Boundary number, as the frame tiles label it (@N = after step N). */
  at: number;
  kind: string;
  /** The line spoken on this beat (a speak's text or an action's narration). */
  line?: string;
  /** Start and end on the cast's clock, ms (interactive waits not counted). */
  start: number;
  end: number;
  lineMs: number;
  /** The action's own run time (0 for speak/pause/instant). */
  actionMs: number;
  /** When the action moves the canvas, on the clock ([] if nothing visible). */
  active: [number, number][];
}

export interface PacingProblem {
  kind: "idle" | "ink-after-voice" | "overlong";
  /** First and last beat involved (@N numbering). */
  from: number;
  to: number;
  ms: number;
  message: string;
}

export interface PacingReport {
  /** Estimated running time, ms — narration at the reading estimate, interactive waits excluded. */
  totalMs: number;
  spokenLines: number;
  /** The length brief the line count falls in, e.g. "standard (14–20)". */
  lengthBand: string;
  /** Beats where the clock stops for the viewer (quiz, ask, explore, wait). */
  interactive: number[];
  beats: BeatTiming[];
  problems: PacingProblem[];
  /** The printable report: the totals line first, then one line per problem. */
  lines: string[];
}

const secs = (ms: number) => (ms / 1000).toFixed(1);

function lineOf(step: PlanStep): string | undefined {
  if (step.kind === "speak") return step.text;
  return step.narration;
}

/** Lay the plan on a clock, step by step, as the player runs it. */
export function timeBeats(steps: PlanStep[], runMs: (index: number) => number): { beats: BeatTiming[]; totalMs: number; interactive: number[]; breaks: number[] } {
  const beats: BeatTiming[] = [];
  const interactive: number[] = [];
  /** Clock times where an interactive beat splits the cast into segments. */
  const breaks: number[] = [];
  let t = 0;
  let pendingEnd = 0; // a non-blocking speak still talking until here
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const at = i + 1;
    const line = lineOf(step);
    const delivery = step.kind === "speak" ? step.delivery : step.narrationDelivery;
    const L = line ? lineMs(line, delivery) : 0;
    const beat = (start: number, end: number, actionMs: number, active: [number, number][]): void => {
      beats.push({ at, kind: step.kind, ...(line ? { line } : {}), start, end, lineMs: L, actionMs, active });
    };
    if (NO_TIME.has(step.kind)) continue;
    if (INTERACTIVE.has(step.kind)) {
      t = Math.max(t, pendingEnd);
      interactive.push(at);
      breaks.push(t);
      beat(t, t, 0, []);
      continue;
    }
    if (step.kind === "speak") {
      if (step.blocking) {
        beat(t, t + L, 0, []);
        t += L;
      } else {
        beat(t, t + L, 0, []);
        pendingEnd = Math.max(pendingEnd, t + L);
      }
      continue;
    }
    if (step.kind === "pause") {
      beat(t, t + step.seconds * 1000, 0, []);
      t += step.seconds * 1000;
      continue;
    }
    // A command's marks on further pictures run alongside its first (runActions).
    if (step.kind === "mark" && step.parallel) continue;
    const narrated = line !== undefined;
    let start = t;
    if (narrated || BARRIER.has(step.kind)) start = Math.max(t, pendingEnd);
    const A = runMs(i);
    const cue = narrated ? cueStartMs(step.cue, step.cueEnd, line!, delivery, A) : 0;
    // In a book a block written on the text pane, or a mark on one, is what
    // the viewer reads while the line is spoken: activity for the whole line,
    // not an instant (an 11-part book was flagged idle on every write, 2026-10-05).
    const onText = step.kind === "text" && (step.op.op === "write" || step.op.op === "mark");
    const held = narrated && ((HELD.has(step.kind) && "untilNarrationEnd" in step && step.untilNarrationEnd === true) || onText);
    // A held gesture moves until the voice stops; a held mark spreads its stops over the rest of the line.
    const moveMs = held ? Math.max(step.kind === "mark" ? A : 0, L - cue) : A;
    const active: [number, number][] = [[start + cue, start + cue + moveMs]];
    const end = start + Math.max(L, cue + moveMs);
    beat(start, end, A, active);
    t = end;
  }
  return { beats, totalMs: Math.max(t, pendingEnd), interactive, breaks };
}

/** What a beat was doing during an idle stretch, in a word or three. */
function idleRole(b: BeatTiming): string {
  if (b.kind === "speak") return `@${b.at} speak-only`;
  if (b.kind === "pause") return `@${b.at} pause ${secs(b.end - b.start)} s`;
  if (b.line && b.actionMs < b.lineMs) return `@${b.at} line ${secs(b.lineMs)} s over a ${secs(b.actionMs)} s ${b.kind}`;
  return `@${b.at} ${b.kind}`;
}

/** The length brief a line count falls in, from the app's own length control. */
export function lengthBand(lines: number): string {
  const bands = (BRIEF_CONTROLS.find((c) => c.group === "length")?.options ?? []).flatMap((o) => {
    const m = /(\d+)–(\d+)/.exec(o.hint);
    return m ? [{ name: o.label.replace(/ length$/, "").toLowerCase(), lo: Number(m[1]), hi: Number(m[2]) }] : [];
  });
  const hit = bands.find((b) => lines >= b.lo && lines <= b.hi);
  if (hit) return `${hit.name} (${hit.lo}–${hit.hi})`;
  const below = [...bands].reverse().find((b) => b.hi < lines);
  const above = bands.find((b) => b.lo > lines);
  if (below && above) return `between ${below.name} (${below.lo}–${below.hi}) and ${above.name} (${above.lo}–${above.hi})`;
  if (above) return `under ${above.name} (${above.lo}–${above.hi})`;
  if (below) return `over ${below.name} (${below.lo}–${below.hi})`;
  return "no length band";
}

export function pacingReport(steps: PlanStep[], runMs: (index: number) => number): PacingReport {
  const { beats, totalMs, interactive, breaks } = timeBeats(steps, runMs);
  const problems: PacingProblem[] = [];

  // 1. Idle stretches: gaps between the canvas's moments of change, inside
  //    each stretch the viewer watches without being asked anything.
  const edges = [0, ...breaks, totalMs];
  for (let s = 0; s + 1 < edges.length; s++) {
    const [lo, hi] = [edges[s], edges[s + 1]];
    const spans = beats
      .flatMap((b) => b.active)
      .filter(([a, z]) => z >= lo && a <= hi)
      .sort((p, q) => p[0] - q[0]);
    let cursor = lo;
    const gaps: [number, number][] = [];
    for (const [a, z] of spans) {
      if (a > cursor) gaps.push([cursor, a]);
      cursor = Math.max(cursor, z);
    }
    if (hi > cursor) gaps.push([cursor, hi]);
    for (const [g0, g1] of gaps) {
      const ms = g1 - g0;
      const opening = g0 <= 1 && s === 0;
      if (ms <= (opening ? INTRO_IDLE_MAX_MS : IDLE_MAX_MS)) continue;
      const inGap = beats.filter((b) => b.end > g0 + 1 && b.start < g1 - 1 && b.end > b.start);
      if (inGap.length === 0) continue;
      const from = inGap[0].at;
      const to = inGap[inGap.length - 1].at;
      const where = g1 >= totalMs - 1 && s === edges.length - 2 ? " to the end" : opening ? ` before the first ink (the opening allows ${secs(INTRO_IDLE_MAX_MS)} s)` : "";
      problems.push({
        kind: "idle",
        from,
        to,
        ms,
        message: `${from === to ? `@${from}` : `@${from}–@${to}`} idle ${secs(ms)} s${where}: nothing new on the canvas (${inGap.map(idleRole).join("; ")})`,
      });
    }
  }

  for (const b of beats) {
    // 2. The voice ends before the ink: a narrated action running on in silence.
    if (b.line && b.kind !== "speak" && b.active.length > 0) {
      const inkEnd = b.active[0][1];
      const voiceEnd = b.start + b.lineMs;
      const over = inkEnd - voiceEnd;
      if (over > INK_AFTER_VOICE_MAX_MS) {
        problems.push({
          kind: "ink-after-voice",
          from: b.at,
          to: b.at,
          ms: over,
          message: `@${b.at} silent ink ${secs(over)} s: the ${b.kind} runs on after its sentence ends (line ${secs(b.lineMs)} s, ${b.kind} ${secs(b.actionMs)} s${inkEnd - b.actionMs > b.start + 1 ? `, cued at ${secs(inkEnd - b.actionMs - b.start)} s` : ""})`,
        });
      }
    }
    // 3. Overlong beats.
    const ms = b.end - b.start;
    if (ms >= OVERLONG_BEAT_MS) {
      problems.push({
        kind: "overlong",
        from: b.at,
        to: b.at,
        ms,
        message: `@${b.at} overlong beat ${secs(ms)} s (${b.line ? `line ${secs(b.lineMs)} s` : "no line"}${b.actionMs > 0 ? `, ${b.kind} ${secs(b.actionMs)} s` : ""})`,
      });
    }
  }
  problems.sort((p, q) => p.from - q.from || p.to - q.to);

  const spokenLines = beats.filter((b) => b.line).length;
  const band = lengthBand(spokenLines);
  const clock = `${Math.floor(totalMs / 60000)}:${String(Math.round((totalMs % 60000) / 1000)).padStart(2, "0")}`;
  const head =
    `pacing (soft limits): ≈ ${clock} (${Math.round(totalMs / 1000)} s at the reading estimate) · ${spokenLines} spoken line${spokenLines === 1 ? "" : "s"} — ${band}` +
    (interactive.length ? ` · clock stops at ${interactive.map((a) => `@${a}`).join(", ")} (viewer's turn, not counted)` : "");
  const lines = [head, ...(problems.length ? problems.map((p) => `  ${p.message}`) : [`  no pacing flags (idle > ${IDLE_MAX_MS / 1000} s, ${INTRO_IDLE_MAX_MS / 1000} s before the first ink, silent ink > ${INK_AFTER_VOICE_MAX_MS / 1000} s, beat ≥ ${OVERLONG_BEAT_MS / 1000} s)`])];
  return { totalMs, spokenLines, lengthBand: band, interactive, beats, problems, lines };
}
