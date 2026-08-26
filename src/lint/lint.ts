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

export function lintLayout(drawables: Drawable[], measure: MeasureFn): LintIssue[] {
  const issues: LintIssue[] = [];
  const leaves = leafDrawables(drawables);
  const texts = leaves.filter((d): d is TextDrawable => d.kind === "text");
  const strokes = leaves.filter((d): d is StrokeDrawable => d.kind === "stroke");

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

  // label–label overlap
  for (let i = 0; i < texts.length; i++) {
    for (let j = i + 1; j < texts.length; j++) {
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

const ACTION_KEYS = ["draw", "pause", "wait", "show", "hide", "erase", "clear", "highlight", "point", "move", "camera", "animate"] as const;

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
