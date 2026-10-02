// Deterministic visual lint (Loop 1.2). Runs on the backend-independent layout
// IR, so every backend gets the same report and the results feed the LLM
// repair round as structured text.

import { SUB_SUFFIXES } from "../layout/model";
import { guessParts, marketParts } from "../guess/parts";
import { marketMove } from "../guess/market";
import { niceStep } from "../guess/handles";
import { treeBlanks, treePick } from "../tree/blanks";
import { blankConvertible, blankIsNumber, formulaBlanks, hasBlanks, tileRight } from "../formula/blanks";
import { walkTree } from "../scenes/decision_tree/rollback";
import type { DecisionTreeParams } from "../scenes/decision_tree/layout";
import { authoredScales } from "../spec/scale";
import { authoredCards } from "../spec/cards";
import { parseTarget } from "../links/resolve";
import { CANVAS } from "../layout/canvas";
import { MATH_DEFAULT_SIZE } from "../layout/math";
import { isFitName } from "../layout/regions";
import { AUTO_NAMESPACE, baseName, isReservedVar, VAR_RE } from "../spec/answers";
import { EXPR_BASE_VARS, varValues } from "../spec/vars";
import { texNamesVars } from "../layout/live-math";
import { effectiveShow } from "../spec/code-show";
import { bboxOfPts, bboxOfText, boxesOverlap, polylineIntersectsBox, type BBox } from "../layout/geometry";
import { drawablesForId, leafDrawables, type Drawable, type GroupDrawable, type StrokeDrawable, type TextDrawable } from "../layout/model";
import type { LeafDrawable } from "../layout/posed";
import { mathBox } from "../layout/labels";
import { findPart } from "../layout/highlight-part";
import { termTex } from "../layout/math-morph";
import type { MeasureFn } from "../layout/measure";
import { BUILTIN_WIDGETS } from "../spec/types";
import { pacedDurations } from "../render/pacing";
import { lineMs } from "../render/cue";
import type { Command, PlayArgs, Spec } from "../spec/types";
import { scenes } from "../scenes/registry";
import { resolveGame } from "../code/c64-catalogue";
import { grammarFor, parseControls } from "../code/controls";
import { runValues } from "../render/sweep";
import { pathsByCodeId, scanDataTokens } from "../code/tokens";
import { connectKey } from "../render/widgets";
import { CONNECT_MAX_EDGES } from "../ui/connect-model";
import { moreModel } from "../ui/more-model";
import { COLOR_WORDS, FLAGS, PLACE_WORDS, SIDE_WORDS } from "../spec/script/sugar";
import { MODIFIER_KEYS } from "../spec/script/parse";
import { inlineStrokes } from "../spec/assets";
import { decodePicture } from "../spec/trace";
import { BANDS, isEnglish, resolveFeedback } from "../feedback/bands";

/**
 * The shared traversal behind `lintableLeaves` and `flattenLintable`: a
 * pre-order walk of `drawables` that never descends into a `role: "inset"`
 * group's children — another page's ink, drawn small on purpose (spec
 * 2026-09-17-inset §6). `includeGroups` false collects leaves only (what
 * font-too-small, the overlap rules and out-of-canvas read); true also
 * collects the groups themselves (what the math-overlap rules filter by
 * role). One walker, one skip rule, so the two can never drift apart.
 */
function walkLintable(drawables: Drawable[], includeGroups: boolean, out: Drawable[]): void {
  for (const d of drawables) {
    if (d.kind === "group") {
      if (d.role === "inset") continue;
      if (includeGroups) out.push(d);
      walkLintable(d.children, includeGroups, out);
      continue;
    }
    out.push(d);
  }
}

/** The leaves lint reads: everything painted EXCEPT an inset's picture — a
 *  picture of text is not text, and its strokes are the other page's, drawn
 *  small on purpose (spec 2026-09-17-inset §6). The inset's own frame stays. */
export function lintableLeaves(drawables: Drawable[]): LeafDrawable[] {
  const out: Drawable[] = [];
  walkLintable(drawables, false, out);
  // Safe: includeGroups is false, so walkLintable never pushes a GroupDrawable.
  return out as LeafDrawable[];
}

/** `flattenDrawables`, but an inset's picture subtree is skipped, same as
 *  `lintableLeaves` — a group search (the `maths` line below) must not reach
 *  into another page's ink either. */
function flattenLintable(drawables: Drawable[]): Drawable[] {
  const out: Drawable[] = [];
  walkLintable(drawables, true, out);
  return out;
}

export const FONT_FLOOR = 14;
/** Below this fit scale the text floor is doing most of the work — the
 *  template box was too small for the figure (template-fit.ts). */
export const FIT_SCALE_FLOOR = 0.5;
/** The floor for the Commodore 64 face: a pixel glyph the size of its cell. */
export const C64_FONT_FLOOR = 11;
const CANVAS_TOLERANCE = 2;

export interface LintIssue {
  rule:
    | "overlap-label-label"
    | "overlap-label-stroke"
    /** a stroke through a formula's core, or a label on top of it — warns, never blocks (Hans 2026-09-10) */
    | "overlap-math-stroke"
    | "overlap-math-label"
    /** formulas of different sizes on one page — warns, never blocks */
    | "math-size"
    | "math-form"
    /** a code panel and the template figure beside it drawn on the same ground */
    | "overlap-code-figure"
    /** a template's box was small enough that the fit scale did most of the shrinking */
    | "fit-scale"
    | "out-of-canvas"
    | "font-too-small"
    | "slow-start"
    /** authoring only: a figure of many strokes exposes no named, outlined part the identify drill or a click ask could use */
    | "drillable-parts"
    | "talky-stretch"
    /** an action cued inside a sentence cannot land where it was written */
    | "cue-timing"
    | "ask-var"
    | "source-use"
    | "code-use"
    /** params measured against the template's own params_schema, not the wire schema. */
    | "template-params"
    /** a connect question the viewer cannot win, or one that is unfair given what has (not) been drawn yet */
    | "connect"
    /** relative placement: an unknown at.ref, or a cycle through at.ref/attach_to/members */
    | "placement"
    /** a written row or column of four or more members that a grid would show much larger — warns, never blocks */
    | "layout-shape"
    /** a group element whose members resolve to nothing */
    | "group-empty"
    /** a bind expression that cannot be evaluated: unknown var, non-numeric field, bad expression */
    | "bind"
    /** animate targets the box region with no starting params.box to glide from — the figure would jump */
    | "animate-box"
    /** a math element whose TeX the engine cannot parse */
    | "math"
    /** code controls: a name with no birthplace, born twice, not a control literal, a bad longhand argument, or a control the viewer could not see change */
    | "controls"
    /** pane: controls without controls, or a pane on show: output/none, or lines/marks on a controls pane */
    | "pane"
    /** a curve whose expr reads a plot-variable alias the page also declares as a var — the var wins and the curve is flat */
    | "curve-var-shadow"
    /** a run (or an explore beat's planned demo) whose script, controls or series the player could not honour */
    | "run"
    /** more insets in the thumbnail column than INSET_MAX: they shrink to fit */
    | "inset-count"
    /** an ask bound to the spec's template, whose document has no widget body */
    | "widget"
    /** a guess on the figure (ask.on) that cannot be asked fairly: nothing to guess, or the answer already drawn */
    | "guess"
    /** a draw naming an id the template DECLARES (element_ids) but did not draw under these params — a region without its `regions` entry, say */
    | "template-id-off"
    /** a highlight `part` that names no glyph or text in its targets (the whole target lights instead) */
    | "highlight-part"
    | "id-keyword"
    | "heading-intrusion"
    | "adjust-unknown"
    /** a label of more than four words — canvas text is a cue, the voice says the sentence */
    | "long-label"
    /** too many texts on one page state, or several below the small-print line (crowding.ts) — generation only, warns */
    | "crowding"
    /** a population's counts, states, orders or size (layout/population.ts) — warns */
    | "population"
    /** a link's href names no drawcast (links/resolve.ts parseTarget) — warns */
    | "link-target"
    /** the corner list (spec `more`) shows nothing, or leaves a source nowhere but the tray */
    | "more-list"
    /** an image shown by link (lnk1): blank in a movie or poster until embedded — warns */
    | "linked-picture"
    | "book-block-long"
    | "book-auto-id"
    | "book-marks"
    | "feedback"
    | "card-icon";
  ids: string[];
  message: string;
  severity: "warn" | "error";
}

/** `draw`/`show`/`erase`/`hide`/`clear.keep`/`reveal` all take either a
 *  single id or a list — this is the one place that difference is
 *  normalised away. Exported so layout.ts can use the same rule for "ids a
 *  command draws" (paramsAtFirstDraw). */
export function idsOf(raw: string[] | string | undefined): string[] {
  return typeof raw === "string" ? [raw] : raw ?? [];
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
export function coVisible(commands: Command[] | undefined, allIds: string[], expandId?: (id: string) => string[] | null | undefined): (a: string, b: string) => boolean {
  if (!commands || commands.length === 0) return () => true;
  const visible = new Set<string>();
  const managed = new Set<string>();
  const pairs = new Set<string>();
  const key = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const snapshot = () => {
    const list = [...visible];
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) pairs.add(key(list[i], list[j]));
  };
  // A pieces id stands for all its pieces here too (the plan expands it the same way).
  const ids = (raw: string[] | string | undefined): string[] => {
    const list = typeof raw === "string" ? [raw] : raw ?? [];
    return list.flatMap((id) => {
      const kids = expandId?.(id);
      return kids && kids.length > 0 ? kids : [id];
    });
  };
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
  // A sub-drawable ("card_3_text" …) is never named in a command, so it
  // counts as on screen at the end — wrongly so when its owner was taken
  // away (cards erased after their question): then it goes with its owner.
  const owner = (id: string): string => {
    for (const s of SUB_SUFFIXES) {
      const tail = `_${s}`;
      if (!id.endsWith(tail) || id.length <= tail.length) continue;
      const base = id.slice(0, -tail.length);
      if (managed.has(base) && !visible.has(base)) return base;
    }
    return id;
  };
  for (const id of allIds) if (!managed.has(id) && owner(id) === id) visible.add(id);
  snapshot();
  return (a, b) => {
    const oa = owner(a), ob = owner(b);
    return oa === ob || pairs.has(key(oa, ob));
  };
}

/**
 * Whether `id` is already on screen right before `commands[askIndex]` fires,
 * and — when it is — the index of the LAST command before `askIndex` that
 * revealed it (the "revealing beat" a goto could bypass; meaningless, and
 * left at -1, when `visible` is false). The walk is the same draw/show
 * reveal, erase/hide/clear conceal state machine `coVisible` runs, but read
 * at one moving point in the timeline instead of folded into an all-pairs
 * table — and, on the "never managed" case, the OPPOSITE answer from
 * `coVisible`'s. `coVisible` asks "were these ever on screen together" (over
 * the whole cast), where unmanaged really does mean "present the whole time,
 * so it coexists with everything." This asks "was this on screen YET" at a
 * single instant, and an id no command manages is not on screen from the
 * start — the planner collects every unmentioned id into ONE implicit `draw`
 * step pushed AFTER every explicit command (`src/render/plan.ts:609-612`), so
 * it is drawn LAST, after the very question it was meant to precede. That is
 * the shape a compiling model is most likely to produce (an omitted draw,
 * mopped up implicitly) and exactly the cast this rule exists to catch.
 * Do not "fix" this back to match `coVisible` — the two functions answer
 * different questions and this divergence is deliberate.
 *
 * This is a TEXTUAL-order walk, same approximation `coVisible` makes — it
 * does not follow `right_goto`/`wrong_goto`/`if.goto`. Unlike `coVisible`,
 * whose textual-order errors only ever ADD warnings (safe), a missed jump
 * here would DROP one on the round's only fairness safeguard, so the
 * jump-hole check below is what closes that gap instead of this walk trying
 * (and failing) to be a full path analysis.
 */
function connectVisibility(commands: Command[], askIndex: number, id: string): { visible: boolean; revealIdx: number } {
  const touched = commands.some(
    (c) => idsOf(c.draw).includes(id) || idsOf(c.show).includes(id) || idsOf(c.erase).includes(id) || idsOf(c.hide).includes(id),
  );
  if (!touched) return { visible: false, revealIdx: -1 }; // drawn by the implicit final step — not yet on screen for any ask
  let visible = false;
  let revealIdx = -1;
  for (let i = 0; i < askIndex; i++) {
    const c = commands[i];
    if (idsOf(c.draw).includes(id) || idsOf(c.show).includes(id)) {
      visible = true;
      revealIdx = i;
    }
    if (idsOf(c.erase).includes(id) || idsOf(c.hide).includes(id)) visible = false;
    if (c.clear !== undefined && visible && !idsOf(c.clear.keep).includes(id)) visible = false;
  }
  return { visible, revealIdx };
}

/**
 * Every command index a `right_goto`/`wrong_goto`/`if.goto` could land a
 * viewer on — the label fields grepped directly from the source rather than
 * assumed (`src/spec/types.ts:320,346,348,387,389`; nothing else in the repo
 * carries a goto). An unresolved target (an unknown label) is dropped here;
 * schema.ts's own validation already reports that separately.
 */
function gotoTargetIndices(commands: Command[]): number[] {
  const labelIndex = new Map<string, number>();
  commands.forEach((c, i) => {
    if (typeof c.label === "string") labelIndex.set(c.label, i);
  });
  const targets: string[] = [];
  for (const c of commands) {
    if (typeof c.quiz?.right_goto === "string") targets.push(c.quiz.right_goto);
    if (typeof c.quiz?.wrong_goto === "string") targets.push(c.quiz.wrong_goto);
    if (typeof c.ask?.right_goto === "string") targets.push(c.ask.right_goto);
    if (typeof c.ask?.wrong_goto === "string") targets.push(c.ask.wrong_goto);
    if (typeof c.if?.goto === "string") targets.push(c.if.goto);
  }
  return targets.map((t) => labelIndex.get(t)).filter((t): t is number => t !== undefined);
}

/**
 * Whether a sky-moving `animate` — one targeting `hours` or `days`,
 * sky_map's own animatable handles (matched on the target path's LAST
 * segment, so a nested path is still caught, not only a bare top-level key)
 * — sits strictly between `revealIdx` (the beat that drew the figure) and
 * `askIndex` (the connect question itself). Used to refuse a connect ask
 * downstream of a turning sky: the gate derives its key from whatever is
 * actually painted (`connect-gate.ts`'s `paintedLayout()`), but between the
 * draw and the ask that painted layout can itself be null (an `animate`
 * tween discards its frame before the commit that would set it — the
 * player's own tween/commit path, not this rule's business to reach into),
 * in which case the gate falls back to the BASE layout — the sky exactly as
 * it stood before the turn. Either way the viewer loses: graded against a
 * stale key that demands stars which have since set, or simply asked to
 * redraw a shape that has visibly moved and rotated since they saw it. The
 * framing rule this sits beside exists so the viewer draws the figure they
 * JUST saw — a sky that turns in between breaks that promise however the
 * key is derived, so this is a question of fairness, not a technical guard
 * against one stale computation.
 */
function skyTurnsBetween(commands: Command[], revealIdx: number, askIndex: number): boolean {
  for (let k = revealIdx + 1; k < askIndex; k++) {
    const animate = commands[k]?.animate;
    if (!animate) continue;
    for (const path of Object.keys(animate)) {
      const target = path.split(".").pop();
      if (target === "hours" || target === "days") return true;
    }
  }
  return false;
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
/**
 * An action written inside a sentence has to be able to land where it was
 * written. A sketched curve costs 2150 ms, so a cue three tenths into a
 * three-second line simply cannot be a finish — and a start cue late in the
 * line leaves the ink arriving after the sentence has ended, which is the
 * mistake `cue_end` exists to fix.
 *
 * Only `draw` and `erase` are checked, and only against durations read off
 * the drawables themselves, paced exactly as the player paces them. Other
 * verbs carry their own `duration` and are the author's own arithmetic.
 */
function lintCueTiming(drawables: Drawable[], commands: Command[], expandId?: (id: string) => string[] | null | undefined): LintIssue[] {
  const issues: LintIssue[] = [];
  const secs = (ms: number): string => (ms / 1000).toFixed(1);
  for (const cmd of commands) {
    if (cmd.cue === undefined || cmd.speak === undefined) continue;
    const ids = ([] as string[]).concat(cmd.draw ?? cmd.erase ?? []);
    if (ids.length === 0) continue;
    // One duration per drawn id, the way the player counts them: it looks up
    // one element per id, and a group's element is the sum of its leaves.
    const durations: number[] = [];
    for (const id of ids) {
      for (const each of expandId?.(id) ?? [id]) {
        const leaves = leafDrawables(drawablesForId(drawables, each));
        if (leaves.length > 0) durations.push(leaves.reduce((a, d) => a + d.drawOpts.duration, 0));
      }
    }
    if (durations.length === 0) continue;
    const paced = pacedDurations(durations, { narrated: true, parallel: cmd.parallel === true });
    const actionMs = cmd.parallel === true ? Math.max(...paced) : paced.reduce((a, b) => a + b, 0);
    const line = lineMs(cmd.speak, cmd.delivery);
    const point = line * cmd.cue;
    if (cmd.cue_end === true && actionMs > point) {
      issues.push({
        rule: "cue-timing",
        ids,
        severity: "warn",
        message: `this draw takes ${secs(actionMs)} s but its cue sits ${secs(point)} s into the line, so it cannot finish there — move the cue later, or drop cue_end`,
      });
    } else if (cmd.cue_end !== true && point + actionMs > line) {
      issues.push({
        rule: "cue-timing",
        ids,
        severity: "warn",
        message: `this draw starts ${secs(point)} s in and takes ${secs(actionMs)} s, so it is still arriving ${secs(point + actionMs - line)} s after the line ends — did you mean cue_end (land it ON the word)?`,
      });
    }
  }
  return issues;
}

export function lintLayoutDetailed(
  drawables: Drawable[],
  measure: MeasureFn,
  commands?: Command[],
  /** A pieces id → its piece ids, so `draw: ["kake"]` reveals the slices here as it does in the plan. */
  expandId?: (id: string) => string[] | null | undefined,
  /** Two element ids that belong to the SAME `fit` group: the author composed
   *  that figure and the fit scaled it as one, so its own parts touching is
   *  the drawing, not a collision. Overlap rules only. */
  sameGroup?: (a: string, b: string) => boolean,
  /** The figure's extent when a template reports a world larger than the
   *  page (LayoutResult.world): out-of-canvas measures against it. */
  bounds?: BBox,
): { issues: LintIssue[]; exempt: LintIssue[] } {
  const issues: LintIssue[] = [...lintCueTiming(drawables, commands ?? [], expandId)];
  const exempt: LintIssue[] = [];
  const leaves = lintableLeaves(drawables);
  // An empty text (a template's blank cell mark, waiting for a move) has no
  // ink to collide with — tictactoe's cells were reported against every
  // stroke through a cell centre (2026-09-25).
  const texts = leaves.filter((d): d is TextDrawable => d.kind === "text" && d.text.trim() !== "");
  const strokes = leaves.filter((d): d is StrokeDrawable => d.kind === "stroke");
  // Leaf → owning top-level element, for the co-visibility exemption.
  const owner = new Map<string, string>();
  for (const top of drawables) for (const leaf of leafDrawables([top])) owner.set(leaf.id, top.id);
  const together = coVisible(commands, drawables.map((d) => d.id), expandId);
  const coexist = (a: string, b: string) => together(owner.get(a) ?? a, owner.get(b) ?? b);
  const composed = (a: string, b: string) => !!sameGroup?.(owner.get(a) ?? a, owner.get(b) ?? b);

  for (const t of texts) {
    // The C64 face fills its whole em square with an 8 × 8 pixel glyph, so a
    // cell of 11 units reads where the handwriting needs 14 — and a 40-column
    // screen at a sane width lands between the two.
    if (t.fontSize < (t.font === "c64" ? C64_FONT_FLOOR : FONT_FLOOR)) {
      issues.push({
        rule: "font-too-small",
        ids: [t.id],
        message: `text "${t.id}" has font size ${t.fontSize} (< ${FONT_FLOOR} logical units — unreadable)`,
        severity: "warn",
      });
    }
  }

  // A highlight `part` that names nothing lights the whole target instead
  // (render/svg-backend) — the author meant a piece, so say which was missed.
  // The layout only has each formula's FIRST tex; a part that names a term of
  // the formula a morph turned it into is checked against that tex instead
  // (morph, then light a term, is the derivation idiom — 2026-09-25).
  const morphedTo = new Map<string, string[]>();
  for (const cmd of commands ?? []) {
    const m = cmd.morph;
    if (m?.tex !== undefined) {
      for (const id of Array.isArray(m.target) ? m.target : [m.target]) morphedTo.set(id, [...(morphedTo.get(id) ?? []), termTex(m.tex)]);
    }
    const h = cmd.highlight;
    if (!h?.part) continue;
    const targets = (Array.isArray(h.target) ? h.target : [h.target]).flatMap((id) => expandId?.(id) ?? [id]);
    const want = termTex(h.part);
    if (targets.some((id) => (morphedTo.get(id) ?? []).some((t) => t.includes(want)))) continue;
    const pieces = targets.flatMap((id) => leafDrawables(drawablesForId(drawables, id)));
    if (pieces.length > 0 && findPart(pieces, h.part).length === 0) {
      issues.push({
        rule: "highlight-part",
        ids: targets,
        message: `highlight part "${h.part}" is not in ${targets.join(", ")} — the whole target lights instead (a formula's part is the TeX of a term as its tex writes it; text is verbatim)`,
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
    const area = bounds ?? { x: 0, y: 0, w: CANVAS.w, h: CANVAS.h };
    if (
      box.x < area.x - CANVAS_TOLERANCE ||
      box.y < area.y - CANVAS_TOLERANCE ||
      box.x + box.w > area.x + area.w + CANVAS_TOLERANCE ||
      box.y + box.h > area.y + area.h + CANVAS_TOLERANCE
    ) {
      issues.push({
        rule: "out-of-canvas",
        ids: [d.id],
        message: bounds
          ? `element "${d.id}" extends outside the template's world (${Math.round(area.x)}, ${Math.round(area.y)}, ${Math.round(area.w)}×${Math.round(area.h)})`
          : `element "${d.id}" extends outside the ${CANVAS.w}×${CANVAS.h} logical canvas`,
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
      if (composed(texts[i].id, texts[j].id)) continue;
      // Two rows of a Commodore screen are cells on a grid, one em apart: they
      // touch by construction and never overlap. The 2-unit pad is for labels.
      if (texts[i].font === "c64" && texts[j].font === "c64") continue;
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
    // These four numbers are COPIED, of necessity, into the space pack's
    // `coreOf` (src/scenes/packs/space.yaml, the solar_system layout): that
    // template places its own names and has to reserve the box this rule will
    // measure, and a layout body is compiled from YAML with no way to import.
    // Change them here and change them there — the 200-date sweeps in
    // tests/space-template.test.ts are the only thing that would notice.
    const core = { x: full.x + full.w * 0.2, y: full.y + full.h * 0.25, w: full.w * 0.6, h: full.h * 0.5 };
    for (const s of strokes) {
      if (s.id === `${t.id}_leader`) continue;
      if (!coexist(t.id, s.id)) continue;
      if (composed(t.id, s.id)) continue;
      // A code panel's marker pen (`<id>_mark_k`) lies UNDER that panel's own
      // lines on purpose — that is what a highlighter is. Not an overlap.
      if (/_mark_\d+$/.test(s.id) && t.id.startsWith(`${s.id.replace(/_mark_\d+$/, "")}_line_`)) continue;
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

  // math–stroke and math–label: a formula is words. A stroke through its
  // core or a label on top of it is the label rules' defect again; both
  // WARN, never error — a drawing with many elements may have to accept a
  // collision, and the placement (place.ts pickSide) has already taken the
  // least-bad side.
  // An inset's picture is skipped here too — its own math groups belong to
  // another page, drawn small on purpose (spec 2026-09-17-inset §6).
  const maths = flattenLintable(drawables).filter((d): d is GroupDrawable => d.kind === "group" && d.role === "math");
  for (const m of maths) {
    const box = mathBox(m);
    if (!box) continue;
    const core = { x: box.x + box.w * 0.2, y: box.y + box.h * 0.25, w: box.w * 0.6, h: box.h * 0.5 };
    for (const s of strokes) {
      if (!coexist(m.id, s.id) || composed(m.id, s.id)) continue;
      // A formula blank's box (`<id>_blank_<k>`, layout/math.ts) is drawn round the formula's own glyphs.
      const own = owner.get(s.id) ?? s.id;
      if (own.startsWith(`${m.id}_blank_`) && /^\d+$/.test(own.slice(`${m.id}_blank_`.length))) continue; // /^<id>_blank_\d+$/
      if (s.pts.length >= 2 && polylineIntersectsBox(s.pts, core)) {
        (crossingPair(m, s) ? exempt : issues).push({
          rule: "overlap-math-stroke",
          ids: [m.id, s.id],
          message: `math "${m.id}" sits on stroke "${s.id}" — give it a different at.side or position`,
          severity: "warn",
        });
      }
    }
    for (const t of texts) {
      const tb = bboxOfText(t, measure);
      if (clippedAway(t, tb) || !coexist(m.id, t.id) || composed(m.id, t.id)) continue;
      if (boxesOverlap(box, tb, 2)) {
        (crossingPair(m, t) ? exempt : issues).push({
          rule: "overlap-math-label",
          ids: [m.id, t.id],
          message: `math "${m.id}" and label "${t.id}" ("${t.text}") overlap — choose a different side for one of them`,
          severity: "warn",
        });
      }
    }
  }

  // connect: refuse a constellation question the viewer cannot win, and —
  // independently — one that is unfair given what has (not) been drawn yet.
  // Built lazily, only when a connect ask is actually present: most figures
  // have none, and every one of them must pay nothing for this pass.
  const connectAsks: { i: number; answer: string }[] = [];
  (commands ?? []).forEach((c, i) => {
    if (c.ask?.widget === "connect" && typeof c.ask?.answer === "string") connectAsks.push({ i, answer: c.ask.answer });
  });
  if (connectAsks.length > 0) {
    const leafBoxes = new Map<string, BBox>();
    for (const d of leaves) {
      if (d.kind === "text") leafBoxes.set(d.id, bboxOfText(d, measure));
      else if (d.kind === "image") leafBoxes.set(d.id, { x: d.pos[0] - d.w / 2, y: d.pos[1] - d.h / 2, w: d.w, h: d.h });
      else if (d.pts.length > 0) leafBoxes.set(d.id, bboxOfPts(d.pts));
    }
    const jumpTargets = gotoTargetIndices(commands ?? []);
    for (const { i, answer } of connectAsks) {
      const prefix = `${answer}__`;
      const drawnHere = leaves.some((d) => d.id === answer || d.id.startsWith(prefix));
      const key = connectKey(leaves, leafBoxes, answer);
      // At most one of these four — a figure that is not drawn has no edges
      // either, and saying both is noise — in the table's own order.
      if (!drawnHere) {
        issues.push({
          rule: "connect",
          ids: [answer],
          message: `connect: "${answer}" is not drawn in this figure — a connect question needs focus on that constellation`,
          severity: "error",
        });
      } else if (key.edges.length === 0) {
        issues.push({ rule: "connect", ids: [answer], message: `connect: "${answer}" has no lines to draw`, severity: "error" });
      } else if (key.unmatched > 0) {
        issues.push({
          rule: "connect",
          ids: [answer],
          message: `connect: ${key.unmatched} of "${answer}"'s points have no star to join — the figure cannot be drawn as it stands`,
          severity: "error",
        });
      } else if (key.edges.length > CONNECT_MAX_EDGES) {
        issues.push({
          rule: "connect",
          ids: [answer],
          message: `connect: "${answer}" has ${key.edges.length} lines; the cap is ${CONNECT_MAX_EDGES} (Orion's) — ask which constellation it is instead`,
          severity: "error",
        });
      }
      // Reported independently of the four above: a figure can be perfectly
      // drawable and the question still unfair.
      const { visible, revealIdx } = connectVisibility(commands ?? [], i, answer);
      if (!visible) {
        issues.push({
          rule: "connect",
          ids: [answer],
          message: `connect: "${answer}" is asked for before it has been drawn — draw the figure earlier in the cast, so the question is "draw the one you just saw" and not "guess which convention we use"`,
          severity: "error",
        });
      } else if (jumpTargets.some((t) => t > revealIdx && t <= i)) {
        // The TEXTUAL walk above says the figure is on screen, but some
        // right_goto/wrong_goto/if.goto lands between the beat that drew it
        // and this ask — a viewer who takes that branch never sees the draw.
        issues.push({
          rule: "connect",
          ids: [answer],
          message: `connect: a jump can reach this question without passing the beat that draws "${answer}" — a viewer who takes that branch is asked to draw a figure they never saw`,
          severity: "error",
        });
      }
      // Reported independently again: the sky can turn ON the main line,
      // with no jump involved at all — see skyTurnsBetween's own comment
      // for why this is a fairness problem, not only a stale-key one.
      if (visible && skyTurnsBetween(commands ?? [], revealIdx, i)) {
        issues.push({
          rule: "connect",
          ids: [answer],
          message: `connect: the sky turns between the beat that draws "${answer}" and this question — a viewer is asked to redraw a figure that has moved, and part of it may have set`,
          severity: "error",
        });
      }
    }
  }

  return { issues, exempt };
}

export function lintLayout(drawables: Drawable[], measure: MeasureFn, commands?: Command[], expandId?: (id: string) => string[] | null | undefined, sameGroup?: (a: string, b: string) => boolean, bounds?: BBox): LintIssue[] {
  return lintLayoutDetailed(drawables, measure, commands, expandId, sameGroup, bounds).issues;
}

const ACTION_KEYS = ["draw", "pause", "wait", "quiz", "ask", "label", "if", "explore", "show", "hide", "erase", "clear", "highlight", "focus", "point", "move", "arrange", "fade", "flip", "morph", "copy", "flow", "keep", "camera", "card", "animate", "play", "run", "write", "view"] as const;

/** A narration line with nothing happening on screen. Exported for the examples' style ratchet (tests/examples-style.test.ts), which must count openings by the SAME definition the lint enforces. */
export function isStandaloneSpeak(c: Command): boolean {
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
 * The corner list (spec `more`, ui/more-model.ts). Unknown ids are the
 * validator's; what it cannot see is an author's `items` that list nothing
 * the viewer can use, or that leave out a source no element `cites` — that
 * study is then one the narration names and the figure never offers.
 */
function lintMore(spec: Spec): LintIssue[] {
  const more = spec.more;
  if (typeof more !== "object" || more === null || more.items === undefined) return [];
  if (moreModel(spec) === null) {
    return [{ rule: "more-list", ids: [], message: "more.items lists nothing to show — list source ids or {title, url} entries, or write more: false", severity: "warn" }];
  }
  const listed = new Set(more.items.filter((i): i is string => typeof i === "string"));
  const cited = new Set((spec.elements ?? []).flatMap((e) => (Array.isArray(e.cites) ? e.cites : typeof e.cites === "string" ? [e.cites] : [])));
  const left = (spec.sources ?? []).filter((s) => !listed.has(s.id) && !cited.has(s.id)).map((s) => s.id);
  if (left.length === 0) return [];
  return [{ rule: "more-list", ids: [], message: `more.items leaves out ${left.map((id) => `"${id}"`).join(", ")}, which no element cites — add ${left.length === 1 ? "it" : "them"} to more.items`, severity: "warn" }];
}

/** Formulas beyond this ratio of largest to smallest size on one page read as
 *  a mistake, not an emphasis (Hans 2026-09-16: "very large and then smaller
 *  equations in the same page"). 28 → 34, the headline allowance, is 1.21. */
export const MATH_SIZE_SPREAD = 1.3;

/**
 * Every formula on a page shares one size; `size` exists for the one
 * headline formula, not for compensating a fraction that looked small
 * (formulas are typeset display-style now, so none does). A page whose
 * formulas span more than MATH_SIZE_SPREAD is warned once, naming them all.
 */
function lintMathSizes(spec: Spec): LintIssue[] {
  const maths = (spec.elements ?? []).filter((e) => e.type === "math");
  if (maths.length < 2) return [];
  const sized = maths.map((e) => ({ id: e.id, size: typeof e.size === "number" ? e.size : MATH_DEFAULT_SIZE }));
  const lo = Math.min(...sized.map((s) => s.size)), hi = Math.max(...sized.map((s) => s.size));
  if (hi <= lo * MATH_SIZE_SPREAD) return [];
  const list = sized.map((s) => `${s.id} at ${s.size}`).join(", ");
  return [{
    rule: "math-size",
    ids: sized.map((s) => s.id),
    message: `formulas of different sizes on one page (${list}) — drop size so they share the text size, or keep at most one headline formula`,
    severity: "warn",
  }];
}

/**
 * Live math (design 2026-09-29): `form` says how a formula writes its
 * `{var}` tokens, so on a formula that names none it does nothing — and the
 * link's card/text forms mean nothing on a formula (nor values on a link).
 */
function lintLiveMath(spec: Spec): LintIssue[] {
  const issues: LintIssue[] = [];
  const vars = varValues(spec.vars);
  for (const el of spec.elements ?? []) {
    if (el.form === undefined) continue;
    const mathForm = el.form === "values" || el.form === "symbols" || el.form === "both";
    if (el.type === "math" && !mathForm) issues.push({ rule: "math-form", ids: [el.id], severity: "warn", message: `math "${el.id}": form "${el.form}" is a link's — a formula takes values, symbols or both` });
    else if (el.type === "link" && mathForm) issues.push({ rule: "math-form", ids: [el.id], severity: "warn", message: `link "${el.id}": form "${el.form}" is a formula's — a link takes card or text` });
    else if (el.type === "math" && el.form !== "values" && !(typeof el.tex === "string" && texNamesVars(el.tex, vars)))
      issues.push({ rule: "math-form", ids: [el.id], severity: "warn", message: `math "${el.id}": form "${el.form}" does nothing — the formula names no var as {name}` });
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
    const shown = effectiveShow(target);
    if (shown === "output" || shown === "none") {
      issues.push({
        rule: "code-use",
        ids: [id],
        message: `ask code: "${id}" shows no code pane to write in (show: "${shown}") — use show: "left", "code", "above" or "below"`,
        severity: "warn",
      });
    }
  }
  // controls on something that is not a script
  for (const el of spec.elements ?? []) {
    if (el.type !== "code" && el.controls !== undefined) {
      issues.push({ rule: "controls", ids: [el.id], message: `"${el.id}" has controls but is not a code element`, severity: "error" });
    }
  }
  if (els.length === 0) return issues;
  // A game rides in the emulator page's URL hash, and that page is https: a
  // plain-http program would be blocked as mixed content, and a '#' in the
  // URL would end the hash early. Both fail silently in a viewer's browser,
  // so they are caught here instead.
  for (const el of els) {
    if (el.game === undefined) continue;
    const r = resolveGame(el.game);
    if (r.reason !== undefined) issues.push({ rule: "code-use", ids: [el.id], message: `code "${el.id}": game — ${r.reason}`, severity: "warn" });
  }
  // Code controls (design 2026-09-14): names in the spec, shapes in the script.
  const fed = pathsByCodeId(scanDataTokens(spec.params));
  for (const el of els) {
    if (!el.controls || el.controls.length === 0) continue;
    const lang = el.language ?? "";
    if (grammarFor(lang) === null) {
      issues.push({ rule: "controls", ids: [el.id], message: `code "${el.id}": controls are not available for ${lang || "this"} scripts`, severity: "error" });
      continue;
    }
    const { controls, issues: found } = parseControls(lang, el.code ?? "", el.controls);
    for (const f of found) issues.push({ rule: "controls", ids: [el.id], message: `code "${el.id}": ${f.message}`, severity: f.severity });
    // A step that does not land on max.
    for (const c of controls) {
      if (c.kind === "slider" && c.min !== undefined && c.max !== undefined && c.step) {
        const k = (c.max - c.min) / c.step;
        if (Math.abs(k - Math.round(k)) > 1e-9) issues.push({ rule: "controls", ids: [el.id], message: `code "${el.id}": "${c.name}" — step ${c.step} does not divide the range ${c.min}–${c.max}`, severity: "warn" });
      }
    }
    // Two controls, one label.
    const byLabel = new Map<string, string[]>();
    for (const c of controls) byLabel.set(c.label, [...(byLabel.get(c.label) ?? []), c.name]);
    for (const [label, names] of byLabel) {
      if (names.length > 1) issues.push({ rule: "controls", ids: [el.id], message: `code "${el.id}": controls ${names.join(" and ")} share the label "${label}"`, severity: "warn" });
    }
    // A call site that passes a controlled name as an explicit keyword.
    for (const c of controls) {
      if (c.birthplace !== "param") continue;
      const re = new RegExp(`\\b([A-Za-z_][\\w.]*)\\s*\\([^)]*\\b${c.name}\\s*=(?!=)`);
      const lines = (el.code ?? "").split("\n");
      lines.forEach((line, i) => {
        if (i === c.line) return;
        const m = re.exec(line);
        if (m) issues.push({ rule: "controls", ids: [el.id], message: `code "${el.id}": ${m[1]}(${c.name}=…) on line ${i + 1} overrides the "${c.name}" control`, severity: "warn" });
      });
    }
    // A hidden pane that feeds nothing: the control would change nothing visible.
    if (effectiveShow(el) === "none" && (fed[el.id] ?? []).length === 0) {
      issues.push({ rule: "controls", ids: [el.id], message: `code "${el.id}": its pane is hidden and no template param reads {${el.id}.…} — a control would change nothing visible`, severity: "warn" });
    }
  }
  for (const el of els) {
    if (el.pane === undefined) continue;
    const shown = effectiveShow(el);
    if (shown === "output" || shown === "none") {
      issues.push({ rule: "pane", ids: [el.id], message: `code "${el.id}": pane has no effect with show: "${shown}" — the pane sits on a side (left/right/above/below/code)`, severity: "warn" });
    }
    if (el.pane === "controls") {
      if (!el.controls || el.controls.length === 0) {
        issues.push({ rule: "pane", ids: [el.id], message: `code "${el.id}": pane: controls needs a non-empty controls list`, severity: "error" });
      }
      if (el.lines !== undefined) issues.push({ rule: "pane", ids: [el.id], message: `code "${el.id}": lines is ignored with pane: controls (there are no code lines to window)`, severity: "warn" });
      if (el.marks !== undefined) issues.push({ rule: "pane", ids: [el.id], message: `code "${el.id}": marks is ignored with pane: controls (there are no code lines to mark)`, severity: "warn" });
    }
  }
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
    const show = effectiveShow(el);
    if ((show === "left" || show === "right") && (el.width ?? 880) < 560) {
      issues.push({
        rule: "code-use",
        ids: [el.id],
        message: `code "${el.id}" puts the code ${show} of the output at width ${el.width} — too narrow for two readable panes; use width ≥ 700, show: "above", or show: "output"`,
        severity: "warn",
      });
    }
    // A stacked layout shares the 750-unit canvas height between the two
    // panes: a long script leaves the output no room unless it scrolls. A
    // controls pane draws knobs, not lines — its `code` is the model that
    // feeds the sliders, not a script the viewer reads stacked over output.
    if ((show === "above" || show === "below") && el.lines === undefined && lines > 12 && el.pane !== "controls") {
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
 * An ask may name this drawcast's own template as its answer device — but only
 * a template DOCUMENT with a `widget:` body can answer one. Naming a template
 * without one reaches the viewer as a question with no device: the schema
 * accepts it (the name IS spec.template), so the check has to be here, where
 * the registry says what the template actually carries.
 */
function lintWidget(spec: Spec): LintIssue[] {
  const issues: LintIssue[] = [];
  for (const cmd of spec.commands ?? []) {
    const w = cmd.ask?.widget;
    if (w === undefined || (BUILTIN_WIDGETS as readonly string[]).includes(w) || w !== spec.template) continue;
    // The manifest flag too, not the body alone: a built-in's free-play body
    // (supply_demand's drags) answers no question.
    if (!scenes[w]?.widget) {
      issues.push({ rule: "widget", ids: [], message: `ask widget: template "${w}" has no widget body — only a template document with a widget: body can answer an ask`, severity: "error" });
    } else if (scenes[w]?.manifest.widget !== true) {
      issues.push({ rule: "widget", ids: [], message: `ask widget: template "${w}" is free play only (the viewer can work it while paused, but it answers no ask) — use an explore beat, or a built-in device`, severity: "error" });
    }
  }
  return issues;
}

/**
 * Guesses on the figure (spec 2026-10-01-guess-and-reveal): `on` must name
 * something guessable here, and the guessed part must not be on screen yet —
 * a viewer asked to guess a bar they can already see is reading, not guessing.
 */
function lintGuess(spec: Spec): LintIssue[] {
  const issues: LintIssue[] = [];
  const commands = spec.commands ?? [];
  const scales = new Set(authoredScales(spec).map((sc) => sc.id));
  const pops = (spec.elements ?? []).filter((e) => e.type === "population");
  const cardSets = new Map(authoredCards(spec).map((cs) => [cs.id, cs]));
  const keptBack = new Set<string>();
  commands.forEach((c, i) => {
    // `check` (spec 2026-10-03 §3.3) says what right means for a market curve only.
    if (c.ask?.check !== undefined && (c.ask.on === undefined || marketParts(spec, guessParts(spec, c.ask.on)).length === 0)) {
      issues.push({ rule: "guess", ids: [], message: `ask check: "${c.ask.check}" only means something on a supply or demand curve guess (on: supply_curve or demand_curve) — it is ignored here`, severity: "warn" });
    }
    // account_label names a budget's account bar: without a budget there is none.
    if (c.ask?.account_label !== undefined && c.ask.budget === undefined && c.ask.blanks === undefined && c.ask.pick === undefined) {
      issues.push({ rule: "guess", ids: [], message: `ask account_label: "${c.ask.account_label}" labels a budget's account bar — add budget (with on: "all" over bars), or leave it out`, severity: "warn" });
    }
    if (c.ask?.on === undefined) return;
    // A tree ask (blanks / pick) is linted by lintTreeAsk, a formula ask by lintFormulaAsk.
    if (c.ask.blanks !== undefined || c.ask.pick !== undefined) return;
    if (formulaOn(spec, c.ask.on) !== null) return;
    // Predict (spec 2026-10-02 §3): the animate it predicts must come next.
    if (c.ask.predict === true) {
      const next = commands.slice(i + 1).find((d) => d.animate !== undefined || d.ask !== undefined || d.quiz !== undefined || d.label !== undefined);
      if (!next || next.animate === undefined) {
        issues.push({ rule: "guess", ids: [], message: `ask predict: put an animate right after this question — it is what the viewer predicts, and it plays from their guess to the truth`, severity: "error" });
      }
    }
    // Revise (§9): it starts from a guess kept back earlier.
    if (c.ask.revise !== undefined && !keptBack.has(c.ask.revise.toLowerCase())) {
      issues.push({ rule: "guess", ids: [], message: `ask revise: "${c.ask.revise}" is not an earlier guess's store made with reveal: false — ask the first guess with store: ${c.ask.revise} and reveal: false`, severity: "error" });
    }
    if (c.ask.reveal === false && c.ask.store) keptBack.add(c.ask.store.toLowerCase());
    // Cards to rank or sort (spec 2026-10-01-rank-and-sort): drawn shuffled,
    // so they must be ON screen before the question — it moves them.
    const one = typeof c.ask.on === "string" ? c.ask.on : c.ask.on.length === 1 ? c.ask.on[0] : null;
    if (one !== null && cardSets.has(one)) {
      const cs = cardSets.get(one)!;
      // Decide (spec 2026-10-02 §8): every option's label, and `then`, lie ahead.
      if (Array.isArray(cs.options)) {
        const ahead = new Set(commands.slice(i + 1).map((d) => d.label).filter((l): l is string => typeof l === "string"));
        for (const o of cs.options) {
          if (o.goto !== undefined && !ahead.has(o.goto)) issues.push({ rule: "guess", ids: [one], message: `cards "${one}": option "${o.text}" goes to "${o.goto}", which is not a label after the question`, severity: "error" });
        }
        if (cs.then === undefined) issues.push({ rule: "guess", ids: [one], message: `cards "${one}": give then — the label where the branches meet; without it a live viewer runs on from their branch into the next`, severity: "warn" });
        else if (!ahead.has(cs.then)) issues.push({ rule: "guess", ids: [one], message: `cards "${one}": then "${cs.then}" is not a label after the question`, severity: "error" });
      }
      // Place (§4): the cards go on a scale of this drawcast.
      if (cs.along !== undefined && !authoredScales(spec).some((sc) => sc.id === cs.along)) {
        issues.push({ rule: "guess", ids: [one], message: `cards "${one}": along "${cs.along}" is not a scale element`, severity: "error" });
      }
      const first = `${one}_1`;
      if (!connectVisibility(commands, i, one).visible && !connectVisibility(commands, i, first).visible) {
        issues.push({ rule: "guess", ids: [one], message: `ask on: the cards "${one}" are not drawn before the question — draw them first (they are drawn shuffled), so the viewer sees them arrive; the question shows them otherwise`, severity: "warn" });
      }
      return;
    }
    const market = new Set(marketParts(spec, guessParts(spec, c.ask.on)));
    if (market.size > 1) {
      issues.push({ rule: "guess", ids: [...market], message: `ask on: one curve per question — ask about ${[...market].join(" or ")}, not both`, severity: "error" });
      return;
    }
    const budgetIssue = budgetRangeIssue(spec, guessParts(spec, c.ask.on), c.ask.budget);
    if (budgetIssue) issues.push(budgetIssue);
    for (const part of guessParts(spec, c.ask.on)) {
      // Move the curve (spec 2026-10-03 §3): a prediction of the animate
      // right after, which must move this curve.
      if (market.has(part)) {
        if (c.ask.predict !== true) {
          issues.push({ rule: "guess", ids: [part], message: `ask on: "${part}" — a curve is guessed as a prediction: add predict: true and put the animate that moves it (tax.amount, a shift, offset or elasticity) right after`, severity: "error" });
          continue;
        }
        const next = commands.slice(i + 1).find((d) => d.animate !== undefined || d.ask !== undefined || d.quiz !== undefined || d.label !== undefined);
        if (next?.animate === undefined) continue; // the predict error above says it
        const move = marketMove(part, (spec.params ?? {}) as Record<string, unknown>, next.animate as Record<string, unknown>);
        if (typeof move === "string") {
          issues.push({ rule: "guess", ids: [part], message: `ask on: "${part}" — ${move}: animate tax.amount (a tax on ${part === "supply_curve" ? "sellers" : "buyers"}), ${part === "supply_curve" ? "supply" : "demand"}_shift.amount, or ${part === "supply_curve" ? "supply" : "demand"}.offset / .elasticity`, severity: "error" });
        }
        continue;
      }
      // What must stay undrawn for this part, or null when nothing here is guessable by that name.
      let hidden: string[] | null = null;
      if (/^bar_\d+$/.test(part) && spec.template === "bar_chart") {
        if (Array.isArray(spec.params?.["series"])) {
          issues.push({ rule: "guess", ids: [part], message: `ask on: "${part}" — grouped or stacked bars cannot be guessed yet; give the chart one series (values)`, severity: "error" });
          continue;
        }
        hidden = [part];
      } else if (/^line_\d+$/.test(part) && spec.template === "line_chart") hidden = [part];
      else if ((part === "pie" || /^slice_\d+$/.test(part)) && spec.template === "pie_chart") hidden = [part === "pie" ? "slice_1" : part];
      else if (scales.has(part)) hidden = [`${part}_answer`, `${part}_answer_pin`, `${part}_answer_num`];
      else {
        const pop = pops.find((e) => part.startsWith(`${e.id}_`) && Object.keys(e.states ?? {}).some((k) => `${e.id}_${k}`.toLowerCase() === part.toLowerCase()));
        if (pop) hidden = [pop.id, part];
      }
      if (hidden === null) {
        issues.push({ rule: "guess", ids: [part], message: `ask on: "${part}" is not something to guess here — a bar_chart bar (bar_2), a line_chart line (line_1), a pie_chart slice (slice_1), a population state (crowd_sick) or a scale's id`, severity: "error" });
        continue;
      }
      // A prediction's part IS the present: it may be on screen.
      const shown = c.ask.predict === true ? undefined : hidden.find((id) => connectVisibility(commands, i, id).visible);
      if (shown) {
        issues.push({ rule: "guess", ids: [shown], message: `ask on: "${part}" is already drawn before the question (${shown}) — the viewer would read the answer instead of guessing it; draw it after the ask (the ask reveals it)`, severity: "warn" });
      }
    }
  });
  return issues;
}

/**
 * A budget over bar_chart bars (spec 2026-10-03-looks-feedback-account §5)
 * the bars cannot make: each bar is capped at the axis, so the sum runs from
 * the bars' floors to their tops. Outside that the account never balances
 * (the gate then lets Answer through, but the question is broken). The axis
 * is bar_chart's own: ylim, else 0 … the largest value + 8 %.
 */
function budgetRangeIssue(spec: Spec, parts: string[], budget: unknown): LintIssue | null {
  if (typeof budget !== "number" || !(budget > 0) || spec.template !== "bar_chart") return null;
  const params = (spec.params ?? {}) as Record<string, unknown>;
  const bars = parts.filter((p) => /^bar_\d+$/.test(p));
  if (bars.length < 2 || bars.length !== parts.length || Array.isArray(params["series"])) return null;
  const vals = (Array.isArray(params["values"]) ? (params["values"] as unknown[]) : []).flat().filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  const ylim = Array.isArray(params["ylim"]) && params["ylim"].length === 2 && params["ylim"].every((v) => typeof v === "number" && Number.isFinite(v)) ? (params["ylim"] as number[]) : null;
  let lo = vals.length ? Math.min(...vals) : 0;
  let hi = vals.length ? Math.max(...vals) : 1;
  let yMin = ylim ? Math.min(ylim[0], ylim[1]) : Math.min(0, lo);
  let yMax = ylim ? Math.max(ylim[0], ylim[1]) : hi;
  if (!ylim) {
    const pad = (yMax - yMin) * 0.08;
    if (yMax > 0) yMax += pad;
    if (yMin < 0) yMin -= pad;
  }
  if (yMax - yMin < 1e-9) yMax = yMin + 1;
  lo = bars.length * yMin;
  hi = bars.length * yMax;
  const slack = niceStep(yMax - yMin) / 2 + 1e-9;
  if (budget >= lo - slack && budget <= hi + slack) return null;
  const fmt = (v: number) => String(Math.round(v * 100) / 100);
  return {
    rule: "guess",
    ids: bars,
    message: `ask budget: ${budget} cannot be reached — each of the ${bars.length} bars stops at the axis (${fmt(yMin)}–${fmt(yMax)}), so together they make ${fmt(lo)}–${fmt(hi)}; lower the budget, or give the chart a ylim that leaves room`,
    severity: "error",
  };
}

/** Blanks a tree ask may hold, and nodes a tree may have, before it stops
 *  being a question worked by hand (spec 2026-10-03 §4.4). */
const TREE_MAX_BLANKS = 4;
const TREE_MAX_NODES = 12;
/** Guess fields that mean nothing on a tree ask. */
const GUESS_ONLY = ["predict", "budget", "account_label", "from", "revise", "relative", "judge"] as const;
/** Ask fields a tree ask ignores: it is answered in the tree, once. */
const TREE_INERT = ["answer", "widget", "retry"] as const;

/**
 * Tree asks (spec 2026-10-03 §4): the blanks must be numbers the tree has
 * (the same check the player makes, treeBlanks), the pick a decision node
 * rollback picks a best branch at; and the question small enough to work
 * by hand. Rule "guess", like every question on the figure.
 */
function lintTreeAsk(spec: Spec): LintIssue[] {
  const issues: LintIssue[] = [];
  const params = spec.params as unknown as DecisionTreeParams | undefined;
  const isTree = spec.template === "decision_tree" && params?.root !== undefined && typeof params.root === "object";
  const commands = spec.commands ?? [];
  for (const [i, c] of commands.entries()) {
    const a = c.ask;
    if (a === undefined || (a.blanks === undefined && a.pick === undefined)) continue;
    if (!isTree) {
      if (a.blanks !== undefined) issues.push({ rule: "guess", ids: [], message: `blanks: only a decision tree has blanks — use the decision_tree template, or ask on a part of this figure`, severity: "error" });
      if (a.pick !== undefined) issues.push({ rule: "guess", ids: [], message: `pick: only a decision tree has a pick — use the decision_tree template, or a choice question`, severity: "error" });
      continue;
    }
    if (a.on !== undefined && a.on !== "tree") {
      issues.push({ rule: "guess", ids: [], message: `ask on: a tree ask (blanks or pick) is on the whole tree — leave on out, or write on: "tree"`, severity: "error" });
    }
    const stray = GUESS_ONLY.filter((k) => a[k] !== undefined);
    if (stray.length > 0) {
      issues.push({ rule: "guess", ids: [], message: `ask: ${stray.join(", ")} do nothing on a tree ask (they belong to a guess on a chart) — leave them out`, severity: "warn" });
    }
    const inert = TREE_INERT.filter((k) => a[k] !== undefined);
    if (inert.length > 0) {
      issues.push({ rule: "guess", ids: [], message: `ask: ${inert.join(", ")} do nothing on a tree ask (the blanks and the pick are the answer, and it is asked once) — leave them out`, severity: "warn" });
    }
    // The tree is on screen before it is asked about. Its blanks need not be
    // drawn on their own: they show "?" until their ask, which draws them.
    const drawnBefore = commands.slice(0, i).some((d) => [...idsOf(d.draw), ...idsOf(d.show)].some((id) => /^(node|edge|label|branchlabel|value|payoff)_/.test(id) && connectVisibility(commands, i, id).visible));
    if (!drawnBefore) {
      issues.push({ rule: "guess", ids: [], message: `ask: the tree is not drawn before the question — draw the tree first (its blanks show "?" until the ask, so draw them with it)`, severity: "warn" });
    }
    const blanks = a.blanks ?? [];
    for (const m of treeBlanks(params!, blanks).issues) issues.push({ rule: "guess", ids: [], message: m, severity: "error" });
    if (a.pick !== undefined) {
      const picked = treePick(params!, a.pick);
      if (typeof picked === "string") issues.push({ rule: "guess", ids: [a.pick], message: picked, severity: "error" });
    }
    if (blanks.length > TREE_MAX_BLANKS) {
      issues.push({ rule: "guess", ids: [], message: `ask blanks: ${blanks.length} blanks — more than 4 blanks is a worksheet, not a question; ask in two steps`, severity: "warn" });
    }
    let nodes = 0;
    walkTree(params!.root, () => nodes++);
    if (nodes > TREE_MAX_NODES) {
      issues.push({ rule: "guess", ids: [], message: `ask on a tree of ${nodes} nodes — more than ${TREE_MAX_NODES} is too many to work by hand; ask on a smaller tree (or a folded part)`, severity: "warn" });
    }
  }
  if (!isTree) return issues;
  // A blank asked twice shows "?" again between the asks: its truth, just
  // revealed, is taken back.
  const askedAt = new Map<string, number>();
  for (const [i, c] of commands.entries()) {
    for (const b of c.ask?.blanks ?? []) {
      if (askedAt.has(b)) issues.push({ rule: "guess", ids: [b], message: `ask blanks: "${b}" is already a blank in an earlier tree ask (commands[${askedAt.get(b)}]) — it would show ? again after its answer; blank it in one ask only`, severity: "warn" });
      else askedAt.set(b, i);
    }
  }
  // After a tree's blanks, the choice is the viewer's: a pick ask's reveal
  // draws the best and prune marks. Drawing best_<decision>_… yourself with
  // no pick on that decision skips the question the blanks led up to.
  const decisions: string[] = [];
  walkTree(params!.root, (n, id) => {
    if (n.type === "decision") decisions.push(id);
  });
  const decisionOf = (id: string): string | null => {
    const d = decisions.filter((x) => id.startsWith(`best_${x}_`)).sort((a, b) => b.length - a.length)[0];
    return d ?? null;
  };
  const firstBlanks = commands.findIndex((c) => (c.ask?.blanks ?? []).length > 0);
  if (firstBlanks >= 0) {
    const picked = new Set<string>();
    for (const c of commands.slice(firstBlanks + 1)) {
      if (c.ask?.pick !== undefined) picked.add(c.ask.pick);
      for (const id of [...idsOf(c.draw), ...idsOf(c.show)]) {
        const d = decisionOf(id);
        if (d !== null && !picked.has(d)) issues.push({ rule: "guess", ids: [id], message: `draw "${id}" after a tree's blanks with no pick ask on "${d}" — ask {"pick": "${d}"} instead: its reveal draws the best and prune marks`, severity: "warn" });
      }
    }
  }
  return issues;
}

/** The math element an ask's `on` names (one id), or null: a formula ask. */
function formulaOn(spec: Spec, on: string | string[] | undefined): { id: string; tex: string } | null {
  const one = typeof on === "string" ? on : Array.isArray(on) && on.length === 1 ? on[0] : undefined;
  if (one === undefined) return null;
  const el = (spec.elements ?? []).find((e) => e.id === one);
  if (!el || el.type !== "math" || typeof el.tex !== "string") return null;
  return { id: el.id, tex: el.tex };
}

/**
 * Formula asks (spec 2026-10-03 §5): an ask on a math element with
 * `\blank{…}`. The formula is drawn before the question (its boxes are what
 * the viewer fills); every blank is answerable — a number, an expression the
 * converter reads, or tiles — and none hides in a live-math var; `others`
 * holds only wrong tiles. A blank no ask fills, an ask on a formula with no
 * blank, and the formula fields on another kind of ask are warned. Rule
 * "guess", like every question on the figure.
 */
function lintFormulaAsk(spec: Spec): LintIssue[] {
  const issues: LintIssue[] = [];
  const commands = spec.commands ?? [];
  const vars = varValues(spec.vars);
  const filled = new Set<string>();
  commands.forEach((c, i) => {
    const a = c.ask;
    if (a === undefined) return;
    const f = formulaOn(spec, a.on);
    if (f === null) {
      if (a.others !== undefined) issues.push({ rule: "guess", ids: [], message: `ask others: tiles only go with an ask on a formula with \\blank{…} — leave others out, or ask on a math element with a blank`, severity: "warn" });
      if (a.form === "exact") issues.push({ rule: "guess", ids: [], message: `ask form: "exact" only applies to a typed answer in a formula's \\blank{…} — leave form out`, severity: "warn" });
      return;
    }
    filled.add(f.id);
    if (!connectVisibility(commands, i, f.id).visible) {
      issues.push({ rule: "guess", ids: [f.id], message: `ask on: the formula "${f.id}" is not drawn before the question — draw it first; its boxes are what the viewer fills`, severity: "error" });
    }
    const blanks = formulaBlanks(f.id, f.tex);
    if (blanks.length === 0) {
      issues.push({ rule: "guess", ids: [f.id], message: `ask on: the formula "${f.id}" has nothing to fill — write the answer as \\blank{…} in its tex`, severity: "warn" });
      return;
    }
    const others = Array.isArray(a.others) ? a.others.map(String) : null;
    for (const b of blanks) {
      if (texNamesVars(b.tex, vars)) {
        issues.push({ rule: "guess", ids: [b.part], message: `math "${f.id}": blank ${b.k} holds a live var ({name}) — a blank's content must be fixed; take the var out of \\blank{…}`, severity: "error" });
      }
      if (others === null && !blankIsNumber(b) && !blankConvertible(b)) {
        issues.push({ rule: "guess", ids: [b.part], message: `math "${f.id}": blank ${b.k} (${b.tex}) cannot be typed — give the ask others, so it is answered with tiles`, severity: "error" });
      }
      const dup = others?.find((t) => tileRight(b, t));
      if (dup !== undefined) {
        issues.push({ rule: "guess", ids: [b.part], message: `ask others: "${dup}" is already a tile — the right contents are always tiles; others holds only wrong ones`, severity: "warn" });
      }
    }
  });
  for (const el of spec.elements ?? []) {
    if (el.type !== "math" || typeof el.tex !== "string" || filled.has(el.id) || !hasBlanks(el.tex)) continue;
    issues.push({ rule: "guess", ids: [el.id], message: `math "${el.id}": it has \\blank{…} but no ask fills it — add an ask with on: "${el.id}", or write the content without \\blank`, severity: "warn" });
  }
  return issues;
}

/**
 * Screen-first lint (spec principle 1): the canvas must start fast and keep
 * moving. Deterministic, spec-level — feeds the same report as lintLayout so
 * the LLM repair round self-corrects talky storyboards.
 */
/** One question's automatic name (spec 2026-09-15-stored-answers §2), for
 *  the lint message and any listing: `_answers.N` from the offset, plus the
 *  explicit store when the author gave one. */
export interface QuestionName {
  /** Index into spec.commands. */
  index: number;
  kind: "quiz" | "ask";
  /** `_answers.N`, N counting from questionOffset + 1. */
  name: string;
  store?: string;
}

export function questionNames(spec: Spec, questionOffset = 0): QuestionName[] {
  const out: QuestionName[] = [];
  let n = questionOffset;
  (spec.commands ?? []).forEach((c, i) => {
    const kind = c.quiz !== undefined ? "quiz" : c.ask !== undefined ? "ask" : null;
    if (kind === null) return;
    const store = kind === "quiz" ? c.quiz?.store : c.ask?.store;
    out.push({ index: i, kind, name: `${AUTO_NAMESPACE}.${++n}`, ...(store ? { store } : {}) });
  });
  return out;
}

export interface LintCommandsOptions {
  /** Store names earlier playlist items wrote — carried in, so not "used before stored" here. */
  knownVars?: ReadonlySet<string>;
  /** Questions in earlier items: this item's `_answers.N` continues from here. */
  questionOffset?: number;
}

/**
 * A curve whose `expr` reads a plot-variable ALIAS that the page has also
 * declared as a var. `t`, `T`, `q` and `Q` are aliases of the curve variable
 * only until a var of that name exists, at which point the var wins —
 * layout/curves.ts sampleExpression spreads `vars` last, on purpose, because
 * a sweep parameter naturally wants to be called `t`.
 *
 * So `expr: "0.5*t*t"` on a page carrying `vars: {"t": 0}` is not a parabola.
 * It is the constant 0, drawn as a flat line, and nothing else in the
 * pipeline complains: it validates, it lays out, it renders. Measured
 * 2026-09-22 on a real generation, where a deadweight-loss-against-tax curve
 * came back flat for exactly this reason. The PARAMETRIC path already warns
 * about the same collision (layout/tier2.ts, "a var named t is shadowed by
 * the parameter"); the plain `expr` path did not.
 *
 * Only flagged when the expression has no live plot variable LEFT — an expr
 * of `100 - t - x` deliberately mixes a swept var with the curve variable,
 * which is the whole point of the vars round, and must stay silent.
 */
function lintCurveExprs(spec: Spec): LintIssue[] {
  const shadowed = new Set(Object.keys(spec.vars ?? {}).filter((n) => EXPR_BASE_VARS.includes(n)));
  if (shadowed.size === 0) return [];
  const issues: LintIssue[] = [];
  for (const el of spec.elements ?? []) {
    if (el.type !== "curve" || typeof el.expr !== "string") continue;
    const names = new Set(el.expr.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? []);
    const hit = [...names].filter((n) => shadowed.has(n));
    if (hit.length === 0) continue;
    if ([...names].some((n) => EXPR_BASE_VARS.includes(n) && !shadowed.has(n))) continue;
    issues.push({
      rule: "curve-var-shadow",
      ids: [el.id],
      message: `curve "${el.id}": expr "${el.expr}" reads ${hit.join(", ")}, which this page also declares in vars — the var wins, so the curve is a flat line. Write the curve variable as x, or drop the var.`,
      // An error, not a warning (review 2026-09-23): a warning only rides
      // along with a repair some ERROR already triggered (compile.ts), so the
      // flat curve this rule was written for still shipped. A curve with no
      // live plot variable left is always a defect.
      severity: "error",
    });
  }
  return issues;
}

/** Words a book block may hold before it is the spoken sentence written out
 *  (spec 2026-10-01-book-layout §9): a definition or a quote may run long. */
const BOOK_BLOCK_WORDS = 40;
/** Marks on text in one part before the page turns into a colouring book. */
const BOOK_MARKS = 3;

/** A book's text (spec 2026-10-01-book-layout §9). */
export function lintBook(spec: Spec): LintIssue[] {
  if (spec.book === undefined) return [];
  const issues: LintIssue[] = [];
  const cmds = spec.commands ?? [];
  const elementIds = new Set((spec.elements ?? []).map((e) => e.id));
  let blocks = 0;
  let marks = 0;
  for (const c of cmds) {
    if (c.write !== undefined) {
      blocks++;
      const w = typeof c.write === "string" ? { text: c.write } : c.write;
      const prose = w.text.replace(/```[\s\S]*?```/g, "").replace(/\$\$[\s\S]*?\$\$/g, "").replace(/\|.*\|/g, "");
      const words = prose.split(/\s+/).filter((t) => /\w/.test(t)).length;
      const quoted = /^\s*>/.test(w.text);
      if (words > BOOK_BLOCK_WORDS && !quoted) {
        issues.push({ rule: "book-block-long", ids: w.id ? [w.id] : [], message: `book block ${w.id ?? `w${blocks}`} has ${words} words — a block keeps what to remember (about 12 words); the voice says the sentence`, severity: "warn" });
      }
    }
    const target = c.highlight?.target ?? c.erase ?? (c.point?.at?.ref !== undefined ? [c.point.at.ref] : undefined);
    const ids = target === undefined ? [] : typeof target === "string" ? [target] : target;
    const text = ids.filter((id) => !elementIds.has(id));
    if (c.highlight !== undefined && text.length > 0) marks++;
    for (const id of text) {
      if (/^w\d+$/.test(id)) {
        issues.push({ rule: "book-auto-id", ids: [id], message: `"${id}" is a block's automatic id — it changes when a block is added before it; give the block an id (write: {id: …, text: …}) and use that`, severity: "warn" });
      }
    }
  }
  if (marks > BOOK_MARKS) {
    issues.push({ rule: "book-marks", ids: [], message: `${marks} marks on the text in one part — keep to two or three, or the page reads as all emphasis`, severity: "warn" });
  }
  return issues;
}

/**
 * Feedback that does nothing, and card icons that are sentences (spec
 * 2026-10-03-looks-feedback-account §7). Band lines or a joke/picture reward
 * under plain are never said or shown; a cast not in English gets no bundled
 * fallback line, so a flavour there needs lines of its own; an icon keyword
 * is a word or two, never a sentence (a search for one finds nothing).
 */
function lintFeedback(spec: Spec): LintIssue[] {
  const issues: LintIssue[] = [];
  const seen = new Set<string>();
  const warn = (rule: LintIssue["rule"], ids: string[], message: string): void => {
    if (seen.has(message)) return;
    seen.add(message);
    issues.push({ rule, ids, message, severity: "warn" });
  };
  const plainWithLines = (fb: unknown, where: string): void => {
    if (typeof fb !== "object" || fb === null) return;
    const o = fb as Record<string, unknown>;
    const bands = BANDS.filter((b) => o[b] !== undefined);
    if (o.style === "plain" && bands.length > 0) {
      warn("feedback", [], `${where}: feedback lines (${bands.join(", ")}) with style "plain" are never said — use style "warm" or "dry", or leave the lines out`);
    }
  };
  plainWithLines(spec.feedback, "feedback");
  // Each question's feedback is the cast's merged with its own; a cast with
  // no questions is judged by its own feedback.
  const questions: { fb: unknown; where: string }[] = [];
  (spec.commands ?? []).forEach((c, i) => {
    if (c.ask) questions.push({ fb: c.ask.feedback, where: `commands[${i}].ask` });
    if (c.quiz) questions.push({ fb: c.quiz.feedback, where: `commands[${i}].quiz` });
  });
  if (questions.length === 0) questions.push({ fb: undefined, where: "feedback" });
  const english = isEnglish(spec.lang);
  for (const q of questions) {
    if (q.fb !== undefined) plainWithLines(q.fb, q.where);
    if (q.fb === undefined && spec.feedback === undefined) continue;
    const fb = resolveFeedback(spec.feedback, q.fb);
    if (fb.style === "plain" && (fb.reward === "joke" || fb.reward === "picture")) {
      warn("feedback", [], `${q.fb !== undefined ? q.where : "feedback"}: reward "${fb.reward}" plays only with a feedback style — add style "warm" or "dry"`);
    }
    if (!english && fb.style !== "plain" && Object.keys(fb.lines).length === 0) {
      warn("feedback", [], `feedback "${fb.style}" in a cast in "${spec.lang}" has no lines of its own, and the bundled lines are English only — write perfect/good/poor/none in the cast's language`);
    }
  }
  for (const el of spec.elements ?? []) {
    if (el.type !== "cards" || !Array.isArray(el.items)) continue;
    (el.items as unknown[]).forEach((item, i) => {
      if (typeof item !== "object" || item === null) return;
      for (const key of ["icon", "match_icon"] as const) {
        const v = (item as Record<string, unknown>)[key];
        const kw = typeof v === "string" ? v : typeof v === "object" && v !== null ? (v as { of?: unknown }).of : undefined;
        if (typeof kw !== "string") continue;
        if (kw.trim().split(/\s+/).length > 3) {
          warn("card-icon", [el.id], `${el.id} item ${i + 1}: ${key} "${kw}" is a sentence — an icon keyword is a word or two ("cheetah", "pill")`);
        }
      }
    });
  }
  return issues;
}

export function lintCommands(spec: Spec, opts: LintCommandsOptions = {}): LintIssue[] {
  const cmds = spec.commands ?? [];
  const issues: LintIssue[] = [...lintSources(spec), ...lintMore(spec), ...lintCode(spec), ...lintWidget(spec), ...lintGuess(spec), ...lintTreeAsk(spec), ...lintFormulaAsk(spec), ...lintMathSizes(spec), ...lintLiveMath(spec), ...lintCurveExprs(spec), ...lintBook(spec), ...lintFeedback(spec)];

  // A link whose href names nothing the resolver can read draws, but never
  // opens (links/resolve.ts decides the forms a target may take).
  for (const el of spec.elements ?? []) {
    if (el.type === "link" && typeof el.href === "string" && parseTarget(el.href) === null) {
      issues.push({ rule: "link-target", ids: [el.id], message: `link "${el.id}": href "${el.href}" is not a drawcast link — use a player/GitHub/Drive link, owner/repo/path.yaml, ./file.yaml or lecture:N`, severity: "warn" });
    }
  }

  // A linked picture (lnk1) shows in the player, but a movie or a poster
  // draws the SVG on a canvas that cannot load it (export/linked-pictures.ts).
  for (const el of spec.elements ?? []) {
    if (el.type !== "image") continue;
    const strokes = inlineStrokes(spec, el);
    const pic = strokes ? decodePicture(strokes) : null;
    if (!pic?.linked) continue;
    let host = pic.href;
    try {
      host = new URL(pic.href).host;
    } catch {
      /* keep the whole href */
    }
    issues.push({ rule: "linked-picture", ids: [el.id], message: `${el.id} is shown by link from ${host}: it will be blank in a movie or poster until embedded (the host refuses pixel reads)`, severity: "warn" });
  }

  // Keys of a positioned element's `at` ("gap 12") read as fields too: an
  // element called gap lost its id on the round trip.
  const AT_KEYS = new Set(["gap", "offset"]);
  // An id that is a side, place, flag or colour word ("right", "top-left",
  // "flat", "red") is read as that word by the script format, so the element loses its id on the way through
  // the editor (found by the round-trip test on a revised example, 2026-09-25).
  for (const el of spec.elements ?? []) {
    // …and a beat modifier ("ghost", "trail", "parallel"): an element named
    // ghost broke every line that named it (an #interactive draft, 2026-10-02).
    if (SIDE_WORDS.has(el.id) || PLACE_WORDS.has(el.id) || el.id in FLAGS || COLOR_WORDS.has(el.id) || AT_KEYS.has(el.id) || MODIFIER_KEYS.has(el.id)) {
      issues.push({ rule: "id-keyword", ids: [el.id], message: `element id "${el.id}" is a word the script format reads as a side, place, flag, colour or beat modifier — rename it (e.g. "${el.id}_note")`, severity: "warn" });
    }
  }

  // animate.box glides the figure into a region — but only when params has a
  // starting box (a name or a rectangle) to glide FROM. Without one it
  // validates, lays out and lints clean everywhere else, and only the
  // planner ever notices (four separate "no numeric start value" warnings on
  // box.x/y/w/h, which never reach the repair round because lintCommands is
  // what the LLM repair round reads). Warn once per spec, not once per
  // command.
  const paramsHaveBox = spec.params?.box !== undefined;
  if (!paramsHaveBox) {
    const animatesBox = cmds.some(
      (c) => c.animate !== undefined && Object.keys(c.animate).some((k) => (k === "box" && isFitName(c.animate![k])) || k.startsWith("box.")),
    );
    if (animatesBox) {
      issues.push({
        rule: "animate-box",
        ids: [],
        message: 'animate "box" with no params.box — the figure would jump into the box instead of gliding; write the starting box in params (e.g. "full")',
        severity: "warn",
      });
    }
  }

  // {var} tokens must be stored by an EARLIER ask — a later or missing store
  // means the line speaks the literal braces. A dotted token ({age.secs})
  // is judged by its base name; the player's own namespace ({_answers.*})
  // and score are never flagged; a name an earlier item stored is known.
  // The message lists the names this spec DOES have, so an author copies
  // one instead of deriving it — the only way an automatic name gets used.
  const stored = new Set<string>();
  const names = questionNames(spec, opts.questionOffset ?? 0);
  const available = names.map((q) => (q.store ? `${q.store} (${q.kind} at commands[${q.index}], also ${q.name})` : `${q.name} (${q.kind} at commands[${q.index}])`)).join(", ") || "none";
  const flagVars = (text: string | undefined, where: string): void => {
    if (typeof text !== "string") return;
    for (const m of text.matchAll(VAR_RE)) {
      const name = baseName(m[1].toLowerCase());
      if (isReservedVar(name)) continue; // the player maintains these
      if (!stored.has(name) && !opts.knownVars?.has(name)) {
        issues.push({
          rule: "ask-var",
          ids: [],
          message: `${where} uses {${m[1]}} before any question stores it — add store: ${name} to an earlier quiz/ask (or fix the name); automatic names here: ${available}`,
          severity: "warn",
        });
      }
    }
  };
  // A run (and an explore beat's planned demo) names a script and a series per
  // control: the same model the planner and the player use decides whether the
  // sweep can be played at all, so a bad one is caught here rather than in a
  // silent no-op at playback. The lint sees the RESOLVED spec in the app, where
  // `code` was rewritten with the control defaults and `code_src` holds the
  // authored literals; in a test it sees the raw spec, which has only `code`.
  const checkSweep = (i: number, where: "run" | "explore.play", codeId: string | undefined, args: PlayArgs): void => {
    if (codeId === undefined) {
      issues.push({ rule: "run", ids: [], message: `commands[${i}].${where}: names no script — set ${where === "run" ? "run.code" : "explore.code"} to a code element with controls`, severity: "error" });
      return;
    }
    const el = (spec.elements ?? []).find((e) => e.id === codeId);
    if (!el || el.type !== "code") {
      issues.push({ rule: "run", ids: [], message: `commands[${i}].${where}: "${codeId}" is not a code element`, severity: "error" });
      return;
    }
    if (!el.controls || el.controls.length === 0) {
      issues.push({ rule: "run", ids: [el.id], message: `commands[${i}].${where}: code "${el.id}" has no controls`, severity: "error" });
      return;
    }
    const { controls } = parseControls(el.language ?? "", el.code_src ?? el.code ?? "", el.controls);
    const { issues: found } = runValues(args, controls);
    for (const m of found) issues.push({ rule: "run", ids: [el.id], message: `commands[${i}].${where}: ${m}`, severity: "error" });
  };

  cmds.forEach((c, i) => {
    flagVars(c.speak, `commands[${i}].speak`);
    flagVars(c.quiz?.question, `commands[${i}].quiz.question`);
    flagVars(c.quiz?.right, `commands[${i}].quiz.right`);
    flagVars(c.quiz?.wrong, `commands[${i}].quiz.wrong`);
    flagVars(c.ask?.question, `commands[${i}].ask.question`);
    // The player stores the answer BEFORE the feedback lines, so an ask's own
    // right/wrong may use its own store ("You said {g}; it is {g.true}").
    if (c.ask?.store) stored.add(c.ask.store.toLowerCase());
    flagVars(c.ask?.right, `commands[${i}].ask.right`);
    flagVars(c.ask?.wrong, `commands[${i}].ask.wrong`);
    if (c.quiz?.store) stored.add(c.quiz.store.toLowerCase());
    // An explore beat keeps an activity's score ({x}, {x.total}) or a composed melody.
    if (c.explore?.store) stored.add(c.explore.store.toLowerCase());
    if (c.run !== undefined) checkSweep(i, "run", c.run.code, c.run);
    if (c.explore?.play !== undefined && c.explore.play !== false) checkSweep(i, "explore.play", c.explore.code, c.explore.play);
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
