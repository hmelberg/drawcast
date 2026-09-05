// Deterministic visual lint (Loop 1.2). Runs on the backend-independent layout
// IR, so every backend gets the same report and the results feed the LLM
// repair round as structured text.

import { CANVAS } from "../layout/canvas";
import { RESERVED_VARS, VAR_RE } from "../spec/answers";
import { bboxOfPts, bboxOfText, boxesOverlap, polylineIntersectsBox, type BBox } from "../layout/geometry";
import { leafDrawables, type Drawable, type StrokeDrawable, type TextDrawable } from "../layout/model";
import type { MeasureFn } from "../layout/measure";
import type { Command, Spec } from "../spec/types";
import { scanDataTokens } from "../code/tokens";

export const FONT_FLOOR = 14;
const CANVAS_TOLERANCE = 2;

export interface LintIssue {
  rule:
    | "overlap-label-label"
    | "overlap-label-stroke"
    /** a code panel and the template figure beside it drawn on the same ground */
    | "overlap-code-figure"
    | "out-of-canvas"
    | "font-too-small"
    | "slow-start"
    | "talky-stretch"
    | "ask-var"
    | "source-use"
    | "code-use"
    /** params measured against the template's own params_schema, not the wire schema. */
    | "template-params";
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
export function coVisible(commands: Command[] | undefined, allIds: string[]): (a: string, b: string) => boolean {
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

/**
 * An ACCEPTED overlap: two drawables that belong to DIFFERENT movers of the
 * same moving field (`crossing`, layout/model.ts). Two racers swapping places
 * share a row for the frame of the overtake; a line race's names travel with
 * lines that pass each other. Hans, 2026-09-03, on the urn line race: "in
 * these examples we may allow some overlap since the point is that they may
 * move around and sometimes be close … but do not eliminate labels in these
 * race models." So the ink is softened by the template and the lint stops
 * calling it a defect.
 *
 * Deliberately narrow — every one of these is still a defect:
 *  - a mover's label against anything UNKEYED (axes, ticker, title, note, a
 *    caption, tier-2 elements, another template's furniture): one side has no
 *    key, so the pair is never a crossing;
 *  - a mover against ITSELF (same key): a racer's name landing on its own
 *    value, or a line's name landing on its own stroke, is not an overtake;
 *  - anything that is not an overlap rule at all (out-of-canvas,
 *    font-too-small, the command-level rules) — those never consult this.
 */
function crossingPair(a: Drawable, b: Drawable): boolean {
  const ka = a.crossing, kb = b.crossing;
  return typeof ka === "string" && ka !== "" && typeof kb === "string" && kb !== "" && ka !== kb;
}

/**
 * The same lint, with the accepted crossings kept rather than dropped, so a
 * harness can REPORT what was excused instead of re-deriving the rule (which
 * is how two differently-shaped exemptions come to exist). `issues` is what
 * every caller acts on; `exempt` is evidence.
 */
export function lintLayoutDetailed(
  drawables: Drawable[],
  measure: MeasureFn,
  commands?: Command[],
): { issues: LintIssue[]; exempt: LintIssue[] } {
  const issues: LintIssue[] = [];
  const exempt: LintIssue[] = [];
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

  // A clipped text that does not lie wholly inside its clip rectangle is not
  // painted there — a code line beyond its window sits below the pane (even
  // below the canvas, for a long script) until the plan scrolls it in — so
  // it is neither out of canvas nor on top of anything.
  const clippedAway = (t: TextDrawable, box: BBox): boolean => {
    const c = t.clip;
    if (!c) return false;
    return box.x < c.x - 1 || box.y < c.y - 1 || box.x + box.w > c.x + c.w + 1 || box.y + box.h > c.y + c.h + 1;
  };

  // out-of-canvas
  for (const d of leaves) {
    let box;
    if (d.kind === "text") box = bboxOfText(d, measure);
    else if (d.kind === "image") box = { x: d.pos[0] - d.w / 2, y: d.pos[1] - d.h / 2, w: d.w, h: d.h };
    else if (d.pts.length > 0) box = d.kind === "stroke" && d.shapeHint?.type === "circle"
      ? { x: d.shapeHint.c[0] - d.shapeHint.r, y: d.shapeHint.c[1] - d.shapeHint.r, w: 2 * d.shapeHint.r, h: 2 * d.shapeHint.r }
      : bboxOfPts(d.pts);
    else continue;
    if (d.kind === "text" && clippedAway(d, box)) continue;
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
    if (clippedAway(texts[i], bboxOfText(texts[i], measure))) continue;
    for (let j = i + 1; j < texts.length; j++) {
      if (clippedAway(texts[j], bboxOfText(texts[j], measure))) continue;
      if (!coexist(texts[i].id, texts[j].id)) continue;
      const a = bboxOfText(texts[i], measure);
      const b = bboxOfText(texts[j], measure);
      if (boxesOverlap(a, b, 2)) {
        (crossingPair(texts[i], texts[j]) ? exempt : issues).push({
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
    if (clippedAway(t, full)) continue;
    const core = { x: full.x + full.w * 0.2, y: full.y + full.h * 0.25, w: full.w * 0.6, h: full.h * 0.5 };
    for (const s of strokes) {
      if (s.id === `${t.id}_leader`) continue;
      if (!coexist(t.id, s.id)) continue;
      if (s.pts.length >= 2 && polylineIntersectsBox(s.pts, core)) {
        (crossingPair(t, s) ? exempt : issues).push({
          rule: "overlap-label-stroke",
          ids: [t.id, s.id],
          message: `label "${t.id}" ("${t.text}") sits on stroke "${s.id}" — move it to a different side`,
          severity: "warn",
        });
      }
    }
  }

  return { issues, exempt };
}

export function lintLayout(drawables: Drawable[], measure: MeasureFn, commands?: Command[]): LintIssue[] {
  return lintLayoutDetailed(drawables, measure, commands).issues;
}

const ACTION_KEYS = ["draw", "pause", "wait", "quiz", "ask", "label", "if", "explore", "show", "hide", "erase", "clear", "highlight", "focus", "point", "move", "camera", "animate", "play"] as const;

function isStandaloneSpeak(c: Command): boolean {
  return c.speak !== undefined && !ACTION_KEYS.some((k) => c[k] !== undefined);
}

/** Something new appears or changes on screen. */
function isVisibleAction(c: Command): boolean {
  return c.draw !== undefined || c.show !== undefined || c.animate !== undefined;
}

/**
 * Source elements earn their place one at a time (further reading, a proof
 * pointer, a quotation the narration actually uses) — a wall of covers is a
 * bibliography, not a figure. The other two rules catch settings that quietly
 * do nothing: a quote with no page to find it on, and cameo, which is a
 * person-entrance gesture and has no meaning for a book.
 */
function lintSources(spec: Spec): LintIssue[] {
  const sources = (spec.elements ?? []).filter((e) => e.type === "source");
  if (sources.length === 0) return [];
  const issues: LintIssue[] = [];
  for (const el of sources) {
    if (typeof el.quote === "string" && el.quote.trim() !== "" && el.page === undefined) {
      issues.push({
        rule: "source-use",
        ids: [el.id],
        message: `source "${el.id}" has a quote but no page — add the page the passage is on, or drop the quote`,
        severity: "warn",
      });
    }
    if (el.cameo === true) {
      issues.push({
        rule: "source-use",
        ids: [el.id],
        message: `source "${el.id}" sets cameo, which is a person-entrance gesture — ignored; drop it`,
        severity: "warn",
      });
    }
  }
  if (sources.length > 2) {
    issues.push({
      rule: "source-use",
      ids: sources.map((e) => e.id),
      message: `${sources.length} source elements in one figure — keep at most one or two; a gallery of covers reads as a bibliography, not a figure`,
      severity: "warn",
    });
  }
  return issues;
}

/**
 * Code panels are load-bearing: the script executes in the viewer's browser.
 * These rules catch the storyboard killers — a script too long to narrate, a
 * split view too narrow to read, and figure-as-IDE (several panels at once).
 */
function lintCode(spec: Spec): LintIssue[] {
  const issues: LintIssue[] = [];
  // draw.mode: type is the code lines' typed reveal; anywhere else it is
  // silently sketch (layout/resolve.ts), which an author should hear about.
  for (const el of spec.elements ?? []) {
    if (el.type !== "code" && el.draw?.mode === "type") {
      issues.push({
        rule: "code-use",
        ids: [el.id],
        message: `"${el.id}" asks for draw.mode "type", which only code lines honour — it draws as sketch`,
        severity: "warn",
      });
    }
  }
  const els = (spec.elements ?? []).filter((e) => e.type === "code");
  // An ask that hands over the keyboard needs a panel with a code pane on it:
  // a missing id has nothing to write in, and an output-only panel has nothing
  // to write ON — both reach the viewer as a question they cannot answer.
  for (const cmd of spec.commands ?? []) {
    const id = cmd.ask?.code;
    if (id === undefined) continue;
    const target = els.find((e) => e.id === id);
    if (!target) {
      issues.push({ rule: "code-use", ids: [id], message: `ask code: "${id}" is not a code element in this drawcast`, severity: "warn" });
      continue;
    }
    const shown = target.show ?? "output";
    if (shown === "output" || shown === "none") {
      issues.push({
        rule: "code-use",
        ids: [id],
        message: `ask code: "${id}" shows no code pane to write in (show: "${shown}") — use show: "left", "code", "above" or "below"`,
        severity: "warn",
      });
    }
  }
  if (els.length === 0) return issues;
  const referenced = new Set(scanDataTokens(spec.params).map((t) => t.codeId));
  for (const el of els) {
    const lines = (el.code ?? "").split("\n").filter((l) => l.trim() !== "").length;
    if (lines > 22) {
      issues.push({
        rule: "code-use",
        ids: [el.id],
        message: `code "${el.id}" is ${lines} lines — a figure's script should stay under ~14; make the same point in fewer lines`,
        severity: "warn",
      });
    }
    const show = el.show ?? "output";
    if ((show === "left" || show === "right") && (el.width ?? 880) < 560) {
      issues.push({
        rule: "code-use",
        ids: [el.id],
        message: `code "${el.id}" puts the code ${show} of the output at width ${el.width} — too narrow for two readable panes; use width ≥ 700, show: "above", or show: "output"`,
        severity: "warn",
      });
    }
    // A stacked layout shares the 750-unit canvas height between the two
    // panes: a long script leaves the output no room unless it scrolls.
    if ((show === "above" || show === "below") && el.lines === undefined && lines > 12) {
      issues.push({
        rule: "code-use",
        ids: [el.id],
        message: `code "${el.id}": ${lines} lines ${show} the output leave little room for it on the canvas — set lines (a window of 6–8) or use show: "left"`,
        severity: "warn",
      });
    }
    if (el.show === "none" && !referenced.has(el.id)) {
      issues.push({
        rule: "code-use",
        ids: [el.id],
        message: `data source unused: code "${el.id}" is show: none but no param references it — it draws nothing and feeds nothing; reference it as "{${el.id}.<variable>}" or show its output`,
        severity: "warn",
      });
    }
  }
  if (els.length > 1) {
    issues.push({
      rule: "code-use",
      ids: els.map((e) => e.id),
      message: `${els.length} code elements in one figure — one panel per figure; give each script its own figure`,
      severity: "warn",
    });
  }
  return issues;
}

/**
 * Screen-first lint (spec principle 1): the canvas must start fast and keep
 * moving. Deterministic, spec-level — feeds the same report as lintLayout so
 * the LLM repair round self-corrects talky storyboards.
 */
export function lintCommands(spec: Spec): LintIssue[] {
  const cmds = spec.commands ?? [];
  const issues: LintIssue[] = [...lintSources(spec), ...lintCode(spec)];

  // {var} tokens must be stored by an EARLIER ask — a later or missing store
  // means the line speaks the literal braces.
  const stored = new Set<string>();
  const flagVars = (text: string | undefined, where: string): void => {
    if (typeof text !== "string") return;
    for (const m of text.matchAll(VAR_RE)) {
      const name = m[1].toLowerCase();
      if ((RESERVED_VARS as readonly string[]).includes(name)) continue; // the player maintains these
      if (!stored.has(name)) {
        issues.push({
          rule: "ask-var",
          ids: [],
          message: `${where} uses {${m[1]}} before any ask stores it — add an ask with store: ${m[1]} earlier (or fix the name)`,
          severity: "warn",
        });
      }
    }
  };
  cmds.forEach((c, i) => {
    flagVars(c.speak, `commands[${i}].speak`);
    flagVars(c.quiz?.question, `commands[${i}].quiz.question`);
    flagVars(c.quiz?.right, `commands[${i}].quiz.right`);
    flagVars(c.quiz?.wrong, `commands[${i}].quiz.wrong`);
    flagVars(c.ask?.question, `commands[${i}].ask.question`);
    flagVars(c.ask?.right, `commands[${i}].ask.right`);
    flagVars(c.ask?.wrong, `commands[${i}].ask.wrong`);
    if (c.ask?.store) stored.add(c.ask.store.toLowerCase());
  });

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
