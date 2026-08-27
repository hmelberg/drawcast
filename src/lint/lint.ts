// Deterministic visual lint (Loop 1.2). Runs on the backend-independent layout
// IR, so every backend gets the same report and the results feed the LLM
// repair round as structured text.

import { CANVAS } from "../layout/canvas";
import { bboxOfPts, bboxOfText, boxesOverlap, polylineIntersectsBox } from "../layout/geometry";
import { leafDrawables, type Drawable, type StrokeDrawable, type TextDrawable } from "../layout/model";
import type { MeasureFn } from "../layout/measure";
import type { Command, Spec } from "../spec/types";

export const FONT_FLOOR = 14;
const CANVAS_TOLERANCE = 2;

export interface LintIssue {
  rule: "overlap-label-label" | "overlap-label-stroke" | "out-of-canvas" | "font-too-small" | "slow-start" | "talky-stretch";
  ids: string[];
  message: string;
  severity: "warn" | "error";
}

/**
 * Which ELEMENTS are ever on screen together, from a visibility walk over the
 * commands. Static overlap between two elements that never coexist — a cameo
 * portrait (and its name caption) erased before the figure draws — is not a
 * defect, and without this every centered transient forced its caption to be
 * dropped (the kameo lesson). Mirrors the plan's rules: draw/show reveal,
 * erase/hide/clear conceal, and everything no visibility verb ever touched
 * joins an implicit final draw. Unknown ids in commands are simply ignored
 * here (the plan already warns about them); anything not provably transient
 * ends up coexisting, so approximation errs toward keeping warnings.
 */
function coVisible(commands: Command[] | undefined, allIds: string[]): (a: string, b: string) => boolean {
  if (!commands || commands.length === 0) return () => true;
  const visible = new Set<string>();
  const managed = new Set<string>();
  const pairs = new Set<string>();
  const key = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const snapshot = () => {
    const list = [...visible];
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) pairs.add(key(list[i], list[j]));
  };
  const ids = (raw: string[] | string | undefined): string[] => (typeof raw === "string" ? [raw] : raw ?? []);
  for (const c of commands) {
    const revealed = [...ids(c.draw), ...ids(c.show)];
    if (revealed.length > 0) {
      for (const id of revealed) {
        visible.add(id);
        managed.add(id);
      }
      snapshot();
    }
    for (const id of [...ids(c.erase), ...ids(c.hide)]) {
      visible.delete(id);
      managed.add(id);
    }
    if (c.clear !== undefined) {
      const keep = new Set(ids(c.clear.keep));
      for (const id of [...visible]) {
        if (keep.has(id)) continue;
        visible.delete(id);
        managed.add(id);
      }
    }
  }
  for (const id of allIds) if (!managed.has(id)) visible.add(id);
  snapshot();
  return (a, b) => a === b || pairs.has(key(a, b));
}

export function lintLayout(drawables: Drawable[], measure: MeasureFn, commands?: Command[]): LintIssue[] {
  const issues: LintIssue[] = [];
  const leaves = leafDrawables(drawables);
  const texts = leaves.filter((d): d is TextDrawable => d.kind === "text");
  const strokes = leaves.filter((d): d is StrokeDrawable => d.kind === "stroke");
  // Leaf → owning top-level element, for the co-visibility exemption.
  const owner = new Map<string, string>();
  for (const top of drawables) for (const leaf of leafDrawables([top])) owner.set(leaf.id, top.id);
  const together = coVisible(commands, drawables.map((d) => d.id));
  const coexist = (a: string, b: string) => together(owner.get(a) ?? a, owner.get(b) ?? b);

  for (const t of texts) {
    if (t.fontSize < FONT_FLOOR) {
      issues.push({
        rule: "font-too-small",
        ids: [t.id],
        message: `text "${t.id}" has font size ${t.fontSize} (< ${FONT_FLOOR} logical units — unreadable)`,
        severity: "warn",
      });
    }
  }

  // out-of-canvas
  for (const d of leaves) {
    let box;
    if (d.kind === "text") box = bboxOfText(d, measure);
    else if (d.kind === "image") box = { x: d.pos[0] - d.w / 2, y: d.pos[1] - d.h / 2, w: d.w, h: d.h };
    else if (d.pts.length > 0) box = d.kind === "stroke" && d.shapeHint?.type === "circle"
      ? { x: d.shapeHint.c[0] - d.shapeHint.r, y: d.shapeHint.c[1] - d.shapeHint.r, w: 2 * d.shapeHint.r, h: 2 * d.shapeHint.r }
      : bboxOfPts(d.pts);
    else continue;
    if (
      box.x < -CANVAS_TOLERANCE ||
      box.y < -CANVAS_TOLERANCE ||
      box.x + box.w > CANVAS.w + CANVAS_TOLERANCE ||
      box.y + box.h > CANVAS.h + CANVAS_TOLERANCE
    ) {
      issues.push({
        rule: "out-of-canvas",
        ids: [d.id],
        message: `element "${d.id}" extends outside the ${CANVAS.w}×${CANVAS.h} logical canvas`,
        severity: "error",
      });
    }
  }

  // label–label overlap (skipped for pairs that are never on screen together)
  for (let i = 0; i < texts.length; i++) {
    for (let j = i + 1; j < texts.length; j++) {
      if (!coexist(texts[i].id, texts[j].id)) continue;
      const a = bboxOfText(texts[i], measure);
      const b = bboxOfText(texts[j], measure);
      if (boxesOverlap(a, b, 2)) {
        issues.push({
          rule: "overlap-label-label",
          ids: [texts[i].id, texts[j].id],
          message: `labels "${texts[i].id}" ("${texts[i].text}") and "${texts[j].id}" ("${texts[j].text}") overlap — choose different preferred sides`,
          severity: "warn",
        });
      }
    }
  }

  // label–stroke: a graze is fine by design (soft obstacles + text halo);
  // only a stroke crossing the label's CORE threatens legibility.
  for (const t of texts) {
    const full = bboxOfText(t, measure);
    const core = { x: full.x + full.w * 0.2, y: full.y + full.h * 0.25, w: full.w * 0.6, h: full.h * 0.5 };
    for (const s of strokes) {
      if (s.id === `${t.id}_leader`) continue;
      if (!coexist(t.id, s.id)) continue;
      if (s.pts.length >= 2 && polylineIntersectsBox(s.pts, core)) {
        issues.push({
          rule: "overlap-label-stroke",
          ids: [t.id, s.id],
          message: `label "${t.id}" ("${t.text}") sits on stroke "${s.id}" — move it to a different side`,
          severity: "warn",
        });
      }
    }
  }

  return issues;
}

const ACTION_KEYS = ["draw", "pause", "wait", "show", "hide", "erase", "clear", "highlight", "focus", "point", "move", "camera", "animate", "play"] as const;

function isStandaloneSpeak(c: Command): boolean {
  return c.speak !== undefined && !ACTION_KEYS.some((k) => c[k] !== undefined);
}

/** Something new appears or changes on screen. */
function isVisibleAction(c: Command): boolean {
  return c.draw !== undefined || c.show !== undefined || c.animate !== undefined;
}

/**
 * Screen-first lint (spec principle 1): the canvas must start fast and keep
 * moving. Deterministic, spec-level — feeds the same report as lintLayout so
 * the LLM repair round self-corrects talky storyboards.
 */
export function lintCommands(spec: Spec): LintIssue[] {
  const cmds = spec.commands ?? [];
  const issues: LintIssue[] = [];

  let speaksBeforeInk = 0;
  for (const c of cmds) {
    if (isVisibleAction(c)) break;
    if (isStandaloneSpeak(c)) speaksBeforeInk++;
  }
  if (speaksBeforeInk > 1) {
    issues.push({
      rule: "slow-start",
      ids: [],
      message: `${speaksBeforeInk} narration lines before anything is drawn — put the opening line ON the first draw (at most one standalone speak before ink)`,
      severity: "warn",
    });
  }

  // A run of speak/pause commands with 3+ spoken lines and nothing on screen.
  let run = 0;
  for (const c of cmds) {
    const idle = isStandaloneSpeak(c) || (c.pause !== undefined && c.speak === undefined);
    if (!idle) {
      run = 0;
      continue;
    }
    if (isStandaloneSpeak(c)) run++;
    if (run === 3) {
      issues.push({
        rule: "talky-stretch",
        ids: [],
        message: "three or more narration lines in a row with nothing happening on screen — attach speak to draw/point/highlight/animate or interleave an action",
        severity: "warn",
      });
    }
  }
  return issues;
}

/** Structured-text form for the LLM repair round. */
export function lintReportText(issues: LintIssue[]): string {
  return issues.map((i) => `[${i.severity}] ${i.rule}: ${i.message}`).join("\n");
}
