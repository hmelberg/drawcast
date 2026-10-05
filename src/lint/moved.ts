// The move-aware static check (W31, spec 2026-10-04 §6: lints judge what the
// viewer sees, after moves). The layout lint judges the figure where the
// spec drew it, and drops every pair an element joins once a `move` or an
// `arrange` has taken it off that place (lint.ts coVisible) — the static
// geometry no longer says where it is. Until now only the browser frames
// harness judged those pairs (src/dev/frames.ts, posedIssues per frame).
//
// This judges them without a browser: it plans the cast exactly as render()
// does (render/index.ts planSpec — the same offsets for moves, arranges,
// labels that follow their element, cards that go to their slots, boxes or
// true places on a question's reveal; the same turns and visibility), and at
// the RESTING boundary after each command — never mid-animation, where a
// passing overlap is fine — lays the figure at the boundary's params,
// re-judges the pairs the poses moved relative to each other (lint/posed.ts
// rejudged, with the layout's composition exemptions and the accepted
// crossings of a moving field), keeps what is on screen then, and names the
// command after which each issue first stands.
//
// Placement rules only (overlaps, out-of-canvas): crowding counts the texts
// on the page, which a move does not change, and the layout already judges
// it. Settling (layout/settle.ts) never moves a cast with move/arrange, so
// its dy is in the layout either way.

import { composedPairs, elementBBoxes, type LayoutResult } from "../layout/layout";
import { leafDrawables, SUB_SUFFIXES } from "../layout/model";
import type { MeasureFn } from "../layout/measure";
import type { LayoutOverrides } from "../layout/posed";
import { planSpec } from "../render/index";
import { specAt } from "../render/params";
import type { Plan } from "../render/plan";
import type { Command, Spec, SpecElement } from "../spec/types";
import { layoutAsSeen } from "./at-scale";
import type { LintIssue } from "./lint";
import { PLACED, rejudged } from "./posed";

/** A placement issue found at a resting pose, with the command after which it first stands. */
export interface MovedIssue extends LintIssue {
  /** Index in the (expanded) spec's commands; -1 for the implicit final draw. */
  command: number;
}

const VERBS = ["move", "arrange", "ask", "quiz", "draw", "show", "animate", "flip", "morph", "copy", "keep", "card", "erase", "hide", "clear"] as const;

/**
 * A command as an author finds it: its verb, what it acts on and the first
 * words of its line. Not its index — `check` judges the EXPANDED spec, where
 * a card beat or a question has become several commands, so an index would
 * point at the wrong line of the file.
 */
function describe(c: Command | undefined): string {
  if (!c) return "the final draw";
  const verb = VERBS.find((v) => c[v] !== undefined) ?? "command";
  const arg = c[verb as keyof Command] as unknown;
  const raw = Array.isArray(arg) || typeof arg === "string" ? arg : (arg as { target?: unknown } | undefined)?.target;
  const targets = (Array.isArray(raw) ? raw : typeof raw === "string" ? [raw] : []).filter((t): t is string => typeof t === "string");
  const what = targets.length > 0 ? ` ${targets.slice(0, 3).join(", ")}${targets.length > 3 ? ", …" : ""}` : "";
  const line = typeof c.speak === "string" && c.speak.trim() !== "" ? ` ("${c.speak.trim().split(/\s+/).slice(0, 6).join(" ")}…")` : "";
  return `the ${verb}${what}${line}`;
}

const issueKey = (i: LintIssue): string => `${i.rule}|${[...i.ids].sort().join(",")}`;

/** Lay the spec out at a boundary's params (and poses), cached; the given
 *  layout at the spec's own params. */
function layoutCache(spec: Spec, measure: MeasureFn, layout: LayoutResult) {
  const cache = new Map<string, LayoutResult>();
  return (params: Record<string, unknown>, overrides?: LayoutOverrides): LayoutResult => {
    const noOverrides = !overrides || Object.keys(overrides).length === 0;
    if (Object.keys(params).length === 0 && noOverrides) return layout;
    const key = JSON.stringify([Object.entries(params).sort(), overrides ?? null]);
    let l = cache.get(key);
    if (!l) {
      l = layoutAsSeen(specAt(spec, params), measure, overrides, undefined, { skipDrawBeatLint: true });
      cache.set(key, l);
    }
    return l;
  };
}

/** The cast planned as render() plans it; null when the player could not build it either. */
function planOf(spec: Spec, measure: MeasureFn, layout: LayoutResult, layoutAt: ReturnType<typeof layoutCache>): Plan | null {
  try {
    return planSpec(spec, layout, measure, elementBBoxes(layout, measure), (params, _cache, elements?: SpecElement[], overrides?) =>
      elements ? layoutAsSeen({ ...specAt(spec, params), elements }, measure, overrides, undefined, { skipDrawBeatLint: true }) : layoutAt(params, overrides),
    ).plan;
  } catch {
    return null; // the other lints say why
  }
}

/** The resting boundaries: the last step of each command. */
function restingStates(plan: Plan): number[] {
  const commandOf = plan.commandOf ?? [];
  return plan.states.map((_, k) => k).filter((k) => !(k + 1 < plan.states.length && commandOf[k + 1] === commandOf[k]));
}

/** Whether a drawable id is on screen at a boundary: visible, not faded out. */
function shownAt(state: Plan["states"][number], l: LayoutResult): (id: string) => boolean {
  const visible = new Set(state.visible.filter((id) => (state.opacities[id] ?? 1) > 0.05));
  const owner = new Map<string, string>();
  for (const top of l.drawables) for (const leaf of leafDrawables([top])) owner.set(leaf.id, top.id);
  return (id: string): boolean => {
    const top = owner.get(id) ?? id;
    if (visible.has(id) || visible.has(top)) return true;
    // A sub-drawable (`xb1_text`, `card_3_value`) is on screen with its element.
    for (const sfx of SUB_SUFFIXES) if (top.endsWith(`_${sfx}`) && visible.has(top.slice(0, -sfx.length - 1))) return true;
    for (const v of visible) if (id.startsWith(`${v}__`) || top.startsWith(`${v}__`)) return true;
    return false;
  };
}

/**
 * The layout's issues as the viewer sees them across an `animate`: the
 * layout judges the figure at the spec's own params, and an overlap there
 * that no resting boundary shows — the pair is on screen together only
 * after an animate has carried them apart — is dropped (2026-10-05: a
 * curve's guide values were flagged at HR 1 though they were drawn at HR
 * 0.5). An issue stays when some boundary shows its ids at params where it
 * stands, and when no boundary shows its ids at all (that is coVisible's
 * call, not this one's). No animate: the layout's issues, untouched.
 */
export function settledIssues(spec: Spec, measure: MeasureFn, layout: LayoutResult = layoutAsSeen(spec, measure)): LintIssue[] {
  if (!(spec.commands ?? []).some((c) => c.animate !== undefined)) return layout.issues;
  if (!layout.issues.some((i) => PLACED.has(i.rule))) return layout.issues;
  const layoutAt = layoutCache(spec, measure, layout);
  const plan = planOf(spec, measure, layout, layoutAt);
  if (!plan) return layout.issues;
  const boundaries = restingStates(plan).map((k) => {
    const state = plan.states[k];
    const l = layoutAt(state.params);
    return { shown: shownAt(state, l), keys: new Set(l.issues.map(issueKey)) };
  });
  const unseen = (i: LintIssue): boolean => {
    if (!PLACED.has(i.rule)) return false;
    const showing = boundaries.filter((b) => i.ids.every(b.shown));
    return showing.length > 0 && showing.every((b) => !b.keys.has(issueKey(i)));
  };
  const kept = layout.issues.filter((i) => !unseen(i));
  return kept.length === layout.issues.length ? layout.issues : kept;
}

/**
 * The placement issues that appear only once moved elements stand at their
 * real places: one per (rule, ids), at the first command boundary it holds.
 * `spec` is the expanded spec the layout was made from (icons resolved, as
 * `check` lays it out); `layout` its layoutAsSeen. Issues the layout already
 * reports (same rule and ids) are not repeated.
 */
export function movedIssues(spec: Spec, measure: MeasureFn, layout: LayoutResult = layoutAsSeen(spec, measure)): MovedIssue[] {
  const commands = spec.commands ?? [];
  if (commands.length === 0) return [];
  const layoutAt = layoutCache(spec, measure, layout);
  const plan = planOf(spec, measure, layout, layoutAt);
  if (!plan) return [];
  const commandOf = plan.commandOf ?? [];
  const reported = new Set(layout.issues.map(issueKey));
  const out: MovedIssue[] = [];
  let lastKey = "";
  for (let k = 0; k < plan.states.length; k++) {
    // The resting pose after a command: its last step.
    if (k + 1 < plan.states.length && commandOf[k + 1] === commandOf[k]) continue;
    const state = plan.states[k];
    const posed = Object.values(state.offsets).some(([x, y]) => x !== 0 || y !== 0) || Object.keys(state.turns).length > 0 || Object.keys(state.shapes).length > 0;
    if (!posed) continue;
    // The same boundary again (a speak, a pause): nothing new to judge.
    const key = JSON.stringify([state.offsets, state.turns, state.shapes, state.visible, state.opacities, state.params]);
    if (key === lastKey) continue;
    lastKey = key;
    const at = specAt(spec, state.params);
    const l = layoutAt(state.params);
    const r = rejudged(l.drawables, measure, state, l.world, composedPairs(at, l));
    if (!r || r.issues.length === 0) continue;
    // On screen at this boundary: visible, and not faded out.
    const shown = shownAt(state, l);
    const command = commandOf[k] ?? -1;
    const where = command < 0 ? "on the finished page" : `after ${describe(commands[command])}`;
    for (const i of r.issues) {
      const ik = issueKey(i);
      if (!i.ids.every(shown) || reported.has(ik)) continue;
      reported.add(ik);
      out.push({ ...i, message: `${i.message} — where it stands ${where}`, command });
    }
  }
  return out;
}
