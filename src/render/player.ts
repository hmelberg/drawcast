// The Player executes the command plan under the invariant: commands run
// strictly in sequence, each completes before the next begins (the one
// deliberate exception: speak with blocking:false starts narration and moves
// on). Supports the three global playback modes, play/pause, command-level
// stepping, and a live speed multiplier. Scrubbing applies the plan's
// precomputed scene state (visibility, offsets, camera) at any boundary.

import { tweenValue } from "./tween-space";
import type { ChooseOption, MeasureFollow, MorphItem, Plan, PlanStep, SceneState, TextOp, TrailProgress, TransformItem } from "./plan";
import { moveFrame, morphFrame, transformFrame } from "./tween";
import { overridesKey, type LayoutOverrides } from "../layout/posed";
import { answersMatch, AUTO_NAMESPACE, subVars } from "../spec/answers";
import { notationBeats } from "../spec/notation";
import { ACTIVITY_QUESTIONS } from "../spec/types";
import type { LayoutResult } from "../layout/layout";
import { heldFrom, posterOf, sceneAt } from "./plan";
import { breathAfterMs } from "./breath";
import { FOCUS_DIM, type BackendEffects, type RenderedElement } from "./backend";
import { EASINGS, lerpBox, pointerPath } from "./effects";
import { cameraBox, restView, restZoom } from "./camera";
import { lengthFractionAt } from "./trails";
import { pacedDurations } from "./pacing";
import type { BBox } from "../layout/geometry";
import type { Pt } from "../layout/model";
import type { Easing, SpecElement } from "../spec/types";
import type { ControlValue } from "../code/controls";
import { cueStartMs, lineMs } from "./cue";
import { MARK_RELEASE_MS, markFrameAt, markReleaseAt } from "./marks";
import { stripLangMarks } from "./lang-spans";
import { SpeechManager, type SpeechLike } from "./speech";
import { correctWord } from "./quiz-words";
import { EMPHASIS_EASE_MS, EMPHASIS_FIRST_PEAK_MS, EMPHASIS_HOLD_AT_MS, EMPHASIS_ONE_SWELL_MS, EMPHASIS_RELEASE_MS, easeInLevel, emphasisLevel, releaseLevel, swellLevel } from "./emphasis";
import { translateCaption, type SubtitleTrack } from "../spec/subtitles";
import type { ToneLike } from "./tones";
import { isIdentity, type Turn } from "./pose";
import { decodeFigures } from "./decode-figures";
import { smoothstep } from "./sweep";
import { deckCardMs, deckFlight } from "../cards/deck";
import { chunkCaption, pageTimes } from "./caption-chunks";
import { balancedSplit, budgetOf, defaultGuess, encodeGuess, decodeGuess, pointFor, startValues, type GuessEnd, type GuessHandle, type GuessSetup } from "../guess/handles";
import { gapsOf } from "../guess/market";
import { DEFAULT_TOLERANCE, guessText, guessVars, scoreGuess } from "../guess/score";
import { bandOf, guessBand, isEnglish, pickLine, seedOf, type Band } from "../feedback/bands";
import { isLong, pickJoke, rewardFor, type RewardEvent } from "../feedback/rewards";
import { accountMarks, guessMarks } from "../guess/marks";
import { cardsBeside, cardsParts } from "../cards/beside";
import { BESIDE_MS, EACH_MS, FADED, WRONG, besideMarks, besideStyles, besideOffsets, besideParams, besideValues, fadeYours, partProgress, revealLength, tick, type RevealOrder } from "../guess/reveal";
import { gateLang, gateWords } from "../ui/gate-words";
import type { CardsGeometry } from "../spec/cards";
import { cardsMarks, cardsTruth, decodeArrangement, encodeArrangement, initialArrangement, placeOff, positions, rightPick, scoreCards, struckAbove, type Arrangement } from "../cards/model";
import { GUESS_COLOR, type GuessMarkLine, type GuessMarkText, type GuessMarks } from "../guess/marks";
import { decodeTreeAnswer, encodeTreeAnswer, pickDiff, scoreBlanks, treeBlanks, treePick, type TreeBlank, type TreePick } from "../tree/blanks";
import { treeNumberText, type DecisionTreeParams } from "../scenes/decision_tree/layout";
import { walkTree } from "../scenes/decision_tree/rollback";
import { withOverrides } from "./params";
import { blankIsNumber, typedRight, type FormulaBlank } from "../formula/blanks";
import { exprToAscii, exprToTeX, parseAscii, texToExpr } from "../formula/expr";
import { parseBlankNumber } from "../tree/blanks";

export type PlaybackMode = "narrated" | "silent" | "instant";
export type PlayerState = "idle" | "playing" | "paused" | "done";

/** The per-element scene state a frame paints (the rebuilt nodes carry NO
 *  handles, so everything a handle would apply has to be repeated here). */
export interface FrameScene {
  visible: ReadonlySet<string>;
  offsets: Record<string, Pt>;
  turns: Record<string, Turn>;
  opacities: Record<string, number>;
  shapes: Record<string, Record<string, Pt[]>>;
  texts: Record<string, Record<string, string>>;
}

export interface FrameOpts {
  /** Show ids the previewed layout mints that the plan's visible set has never heard of (a chess piece on a fresh square). */
  revealNew?: boolean;
  /** The code editor's preview: a patched element list. */
  elements?: SpecElement[];
  /** The poses and shapes of the source ids the layout reads (design 2026-09-10 §2.5). */
  overrides?: LayoutOverrides;
  /** Trails mid-sweep: id → fraction of the trail drawn so far. */
  trailProgress?: Record<string, number>;
}

/** One swept script as the figure must now show it (spec 2026-09-15 §4.2):
 *  the rewritten code, its fresh envelope, and the value map that produced
 *  them (what the tray's knobs are put at when a `run` hands over). */
export interface CodePatch {
  code: string;
  result: string;
  values: Record<string, ControlValue>;
}

/** Run one script at one value map — applyControls + runCode, through the
 *  same door a knob uses. Injected by render() (src/render/sweep-run.ts), so
 *  a bare Player never carries a runtime. */
export type SweepRunner = (codeId: string, values: Record<string, ControlValue>) => Promise<{ code: string; result: string }>;

export interface Reprojector {
  /** Cheap per-frame swap at interpolated params. Values are numbers from
   *  animate/sliders except under free-play previews (a fen string, a moves
   *  array). The caller hands over the whole per-element scene state —
   *  `offsets`, `turns`, `opacities`, `shapes`, `texts` — or a rotated,
   *  scaled, faded or morphed element snaps back for the length of the tween. */
  frame(params: Record<string, unknown>, scene: FrameScene, opts?: FrameOpts): LayoutResult | void;
  /** Full remount at settled params (and the source poses/shapes of that boundary); returns the new element handles. */
  /** Params are numbers, save a tree's `answers` map (its blanks' "?"). */
  commit(params: Record<string, unknown>, overrides?: LayoutOverrides): Map<string, RenderedElement>;
  /** The layout the last commit mounted (null before any): what is on screen
   *  after an animate settles on params the mounted layout never had. */
  committed?(): LayoutResult | null;
  /** A `run`'s current patch for a script (null clears it). The render
   *  closure keeps these, so a COMMIT is patched too — a boundary layout
   *  that dropped them would snap the figure back to the authored script. */
  setCodePatch?(id: string, patch: CodePatch | null): void;
  /** The spec's elements with every live patch applied, or undefined when
   *  there is none — what a frame must be laid out from mid-sweep. */
  patchedElements?(): SpecElement[] | undefined;
  /** Fields laid over one element for every frame and commit from now on
   *  (null takes them off): a formula's `fills` once its ask is answered
   *  (design 2026-10-03 §5.4 — the box stays filled). */
  setElementPatch?(id: string, fields: Record<string, unknown> | null): void;
}

/** The glide from a guess to the truth. */
const GUESS_REVEAL_MS = 800;
/** A formula's wrong tiles, home again after the reveal, fade out over this. */
const TILE_FADE_MS = 350;
/** A question on its own page (stage: "own", spec round 6 §6): the rest of
 *  the figure at this strength while it stands, faded there and back over STAGE_MS. */
export const STAGE_DIM = 0.15;
const STAGE_MS = 300;
/** A line's given part drawing itself in before the viewer draws on. */
const GIVEN_DRAW_MS = 2200;
/** A revised guess's earlier one: the guess colour, faded. */
const GUESS_PREV_COLOR = "#9fb6d8";

/** Paint a guess at these numbers (marks: the sketch copy too); `extra`: a
 *  beside reveal's room (template params) and frame offsets (a pin dropping in). */
type GuessPaint = (values: number[][], marks?: boolean, extra?: { params?: Record<string, unknown>; offsets?: Record<string, Pt>; styles?: Record<string, Record<string, unknown>> }) => void;

/** A beside reveal on the figure (spec 2026-10-03-round6 §3): the step whose
 *  reveal drew it, its marks at full strength, faded yet, and what keeps the
 *  truth beside the viewer's answer — template params (bars in halves, the
 *  pie moved over), element offsets (cards and tiles where the viewer left
 *  them), elements kept on screen (tiles), element styles (a scale's true pin in ink). */
interface Beside {
  index: number;
  marks: GuessMarks | null;
  faded: boolean;
  params?: Record<string, unknown>;
  offsets?: Record<string, Pt>;
  shown?: string[];
  styles?: Record<string, Record<string, unknown>>;
}

/** A kept guess (ask `keep: true`, spec 2026-10-03-round6 §5): what its
 *  marks are worked out from again when its part is laid out anew. */
interface KeptGuess {
  /** The step whose reveal drew it (a prediction's: its animate). */
  index: number;
  on: string[];
  from?: number;
  guess: number[][];
  /** A revise's first guess, drawn lighter beside. */
  prev?: number[][];
  /** beside: yours beside the truth; morph: the ghost the glide left; held: a guess kept back (reveal: false). */
  style: "beside" | "morph" | "held";
}

/** A mark owner's guess: a revise's first guess (`_prev`) and a budget's account go with theirs. */
const ownerBase = (owner: string): string => owner.replace(/_(prev|account)$/, "");

/** Whether any of these ids takes away (or reshapes) one of these parts — itself, a part of it, or its whole. */
const touches = (ids: readonly string[], parts: readonly string[]): boolean =>
  ids.some((id) => parts.some((p) => id === p || id.startsWith(`${p}_`) || p.startsWith(`${id}_`)));

/** The ids a move, a transform or a morph reshapes (a guessed part among them ends its marks); null for any other step. */
function reshapedIds(step: PlanStep): string[] | null {
  if (step.kind === "move") return step.ids;
  if (step.kind === "transform" || step.kind === "morph") return step.items.map((it) => it.id);
  return null;
}

/** What render() gives the player for guess asks (see Player.guess). */
export interface GuessRuntime {
  /** `layout` is what is on screen, or null before any commit (the mount-time layout stands in). */
  setup(on: string[], from: number | undefined, params: Record<string, unknown>, layout: LayoutResult | null, opts?: { end?: GuessEnd }): GuessSetup;
  patch(setup: GuessSetup, values: number[][], elements: SpecElement[] | undefined): { params: Record<string, unknown>; elements?: SpecElement[] };
  /** A cards element's geometry (spec 2026-10-01-rank-and-sort), or null. */
  cards?(id: string): CardsGeometry | null;
  /** The decision tree a tree ask fills (spec 2026-10-03 §4), or null when
   *  the figure is not one: its authored params, every part's box in a
   *  layout, and every edge's points (edge id → polyline). */
  tree?(): TreeRuntime | null;
  /** A math element with \blank boxes (design 2026-10-03 §5), or null. */
  formula?(id: string): FormulaRuntime | null;
}

export interface FormulaRuntime {
  blanks: FormulaBlank[];
  /** The elements with this formula's `fills` set — on `base` (the elements
   *  a frame is laid out from) when given, else on the spec's own. */
  patch(fills: (string | null)[], base?: SpecElement[]): SpecElement[];
  /** Each blank's box (logical) in a layout (null: the mounted one). */
  boxes(layout: LayoutResult | null): (BBox | null)[];
}

/** What a formula gate is handed (ui/formula-gate.ts): the blanks to type
 *  into, where their boxes are, and the live preview. It resolves
 *  JSON.stringify(texts) — one typed text (or null) per blank — or null. */
export interface FormulaSession {
  blanks: FormulaBlank[];
  /** Blank k's box (k = 0, 1, … in blank order), logical. */
  boxOf(k: number): BBox | null;
  /** Paint typed answers into the boxes (null = empty). Returns false when a text does not parse (the field marks it). */
  show(texts: (string | null)[]): boolean[];
}

export interface TreeRuntime {
  params: DecisionTreeParams;
  boxes?(layout: LayoutResult | null): Map<string, BBox>;
  edges?(layout: LayoutResult | null): Record<string, Pt[]>;
}

/** What a tree gate is handed (ui/tree-gate.ts): the blanks to fill, the
 *  decision to pick in, where they are, and how to paint typed numbers. It
 *  resolves encodeTreeAnswer(values, pick), or null for a skip. */
export interface TreeSession {
  blanks: TreeBlank[];
  pick: TreePick | null;
  /** Each blank's box (logical), for laying the number fields. */
  boxOf(part: string): BBox | null;
  /** Paint typed values (null = "?") into the tree. */
  show(values: (number | null)[]): void;
  /** Branch hit areas for pick: option id → its edge's points (logical). */
  edges: Record<string, Pt[]>;
}

/** What a cards gate is handed (ui/cards-gate.ts): the geometry, the
 *  arrangement as drawn, and how to place a card (logical offset from where
 *  it is drawn). It resolves the encoded arrangement, or null for a skip. */
export interface CardsSession {
  geometry: CardsGeometry;
  start: Arrangement;
  /** `scale` (default 1): a deck's dealt card, drawn larger about its centre. */
  place(cardId: string, dx: number, dy: number, scale?: number): void;
  /** Show drawn-later parts now (a compare pair's numbers). */
  show(ids: string[]): void;
  /** The answer's marks while it is being given (match lines, compare ticks); null clears. */
  mark(m: GuessMarks | null): void;
}

/** What a guess gate is handed (ui/guess-gate.ts): the handles, where the
 *  guess starts, and how to paint a guess on the figure. It resolves the
 *  encoded guess (handles/encodeGuess), or null for a skip. */
export interface GuessSession {
  setup: GuessSetup;
  start: number[][];
  /** Paints the figure at `values` (and, for a budget, the account bar beside it). */
  paint(values: number[][]): void;
  /** A budget question (spec 2026-10-03-looks-feedback-account §5): the bars
   *  are split against it, the account bar labelled `label`; Answer waits
   *  until the account balances. The bars' geometry is in setup.handles. */
  account?: { budget: number; label: string; isDefault?: boolean };
}

/** One graded answer from a LIVE viewer (never a movie's auto path): what
 *  was chosen or typed, every attempt in order, and what would have been
 *  right. The viewer forwards these to the learner endpoint (src/learn.ts). */
export interface AnswerEvent {
  /** The step index — the question's slot in this drawcast's plan. */
  index: number;
  kind: "quiz" | "ask";
  /** The variable the answer was stored under: the explicit store, else `_answers.N`. */
  id: string;
  question: string;
  given: string[];
  expected: string;
  correct: boolean;
  /** Seconds from the gate opening to the answer (latest attempt); absent without a live gate. */
  secs?: number;
}

export interface PlayerCallbacks {
  onState?(state: PlayerState): void;
  onStep?(completed: number, total: number): void;
  onAnswer?(answer: AnswerEvent): void;
  /** A live answer's reward (spec 2026-10-03 §4.3), after its band line — never in a movie or on a skip. */
  onReward?(reward: RewardEvent): void;
}

const ERASE_SPEED = 0.55; // erasing runs faster than drawing
const CLEAR_MS = 550;
const SCROLL_MS = 250; // a code window sliding one or more rows
// Instant elements (durationMs 0, e.g. explicit instant text) would clear in
// 0 ms — a snap where everything else fades. The floor keeps clear soft.
const CLEAR_MIN_MS = 250;

/** One swell of the answer glow a click question puts on the correct element. */
const ANSWER_GLOW_MS = EMPHASIS_ONE_SWELL_MS;
/** The click gate's "right" green (styles.css --ok) — a literal, since SVG presentation attributes cannot read CSS variables. */
const ANSWER_OK_COLOR = "#4a7c59";

/**
 * A typed answer as the TeX its box shows: null when nothing is typed,
 * undefined when it does not parse (a number blank takes a number; any other
 * an AsciiMath-style expression, design 2026-10-03 §5.3).
 */
function typedFill(blank: FormulaBlank, text: string | null): string | null | undefined {
  if (text === null || text.trim() === "") return null;
  if (blankIsNumber(blank)) {
    const v = parseBlankNumber(text);
    if (v === null || !Number.isFinite(v)) return undefined;
    const t = text.trim();
    // As typed when it is plain digits ("3,5" keeps its comma), else the value.
    return /^[-+]?[\d\s.,]+$/.test(t) ? t.replace(/\s+/g, "").replace(/,/g, "{,}") : String(v);
  }
  const e = parseAscii(text);
  return "error" in e ? undefined : exprToTeX(e);
}

/** A viewer's fill: an empty group in front, so the layout (which inks a fill
 *  equal to the truth) draws it in the guess colour however right it is —
 *  the colour must not give the answer away before the reveal. The fill is
 *  grouped after it, so a leading sign stays a sign ("−3", not "{} − 3"). */
const guessFill = (tex: string): string => `{}{${tex}}`;

/** What the movie types for a blank: its number, or its truth as one would
 *  type it (`π r^2`); null when the truth is outside the typed subset. */
function typedTruth(blank: FormulaBlank): string | null {
  if (blankIsNumber(blank)) return blank.tex.replace(/\{,\}/g, ",").trim();
  const e = texToExpr(blank.tex);
  return e ? exprToAscii(e) : null;
}

/** A formula gate's answer: one text (or null) per blank. */
function decodeFormulaTexts(s: string, n: number): (string | null)[] | null {
  try {
    const v: unknown = JSON.parse(s);
    if (!Array.isArray(v) || v.length !== n) return null;
    return v.map((x) => (typeof x === "string" ? x : null));
  } catch {
    return null;
  }
}

export class Player {
  private plan: Plan;
  /** The boundary the last frame is held from (plan.ts heldFrom), or null
   *  when the drawcast ends with something on screen. Steps past it that
   *  only take things away are not performed, so the drawing stays up. */
  private readonly holdFrom: number | null;
  private elements: Map<string, RenderedElement>;
  private speech: SpeechLike;
  private captionEl: HTMLElement | null;
  private effects: BackendEffects | null;
  /** Settable after construction (the UI wires its controls in later). */
  callbacks: PlayerCallbacks;
  /**
   * Provider for the wait verb, set by the controls layer (click overlay) or
   * the exporter (auto-resolve). Must resolve on signal abort. When unset,
   * wait degrades to a short pause so a bare Player never deadlocks.
   */
  inputGate: ((signal: AbortSignal) => Promise<void>) | null = null;

  /**
   * Told when a quiz's spoken feedback starts (true) and ends (false), so the
   * card can offer "Skip explanation" for exactly that long; `skipFeedback`
   * cuts it short (Hans 2026-09-26: "even after we click on an answer, we
   * should still be able to skip the explanation").
   */
  feedbackHook: ((active: boolean) => void) | null = null;

  /**
   * Performs a book's text-pane steps (plan.ts TextOp) as they play — set by
   * the book shell (src/book/). Seeking does not call it: the shell rebuilds
   * the pane from the plan when onStep jumps.
   */
  textHook: ((op: TextOp, signal: AbortSignal) => Promise<void> | void) | null = null;
  private feedbackCtl: AbortController | null = null;
  /** Cut the current quiz feedback short; the lesson goes on from there. */
  skipFeedback(): void {
    this.feedbackCtl?.abort();
  }

  /**
   * Provider for the quiz verb, set by the controls layer (choice buttons) or
   * the exporter (auto-reveal beat). Resolves the 0-based chosen index, or
   * null for skipped/auto. Must resolve on signal abort. When unset, quiz
   * degrades to a short hold + reveal so a bare Player never deadlocks.
   */
  quizGate: ((signal: AbortSignal, step: Extract<PlanStep, { kind: "quiz" }>) => Promise<number | null>) | null = null;

  /**
   * Provider for the typed ask verb, set by the controls layer (input card)
   * or the exporter (self-typing demo). Resolves the typed string, or null
   * for skipped. Must resolve on signal abort. When unset, ask degrades to a
   * short hold + the auto text so a bare Player never deadlocks.
   */
  askGate: ((signal: AbortSignal, step: Extract<PlanStep, { kind: "ask" }>) => Promise<string | null>) | null = null;
  /** The code widget's gate — ui/tray.ts sets it, ui/controls.ts routes to it. */
  codeGate: ((signal: AbortSignal, step: Extract<PlanStep, { kind: "ask" }>) => Promise<string | null>) | null = null;

  /**
   * Guess asks (spec 2026-10-01-guess-and-reveal), set by render(): the
   * handles for an ask's `on` at the params and layout on screen, and the
   * preview patch that paints a guess. Null: a guess ask is skipped.
   */
  guess: GuessRuntime | null = null;
  /** Guess ghosts on screen, by owner — cleared on a scrub, a clear, the next guess. */
  private guessOwners = new Set<string>();
  /** What each guess's marks belong to: taking those parts away (erase,
   *  hide, clear) takes the marks with them. */
  private guessMarkParts = new Map<string, string[]>();
  /** Beside reveals on the figure (spec 2026-10-03-round6 §3), by owner: the
   *  step whose reveal drew them (the next command fades them to FADED), the
   *  marks at full strength, whether they have faded, and what keeps the
   *  truth beside the viewer's answer — template params (bars in halves, the
   *  pie moved over), card offsets (the cards where the viewer left them).
   *  They go with the owner's marks: an erase, a clear, the next question, a scrub. */
  private besides = new Map<string, Beside>();
  /** Every answered beside reveal, by owner: a seek forward past its ask puts
   *  it back (faded once a command has followed) while nothing since has ended it. */
  /** The question on its own page now standing (stage: "own"): the ids
   *  faded and how far (1 = not at all). Every opacity the player writes —
   *  applyScene's and a frame's — multiplies by it; a scrub drops it. */
  private staged: { ids: ReadonlySet<string>; alpha: number } | null = null;
  private besideMemory = new Map<string, Beside>();
  /** Kept guesses on the figure (ask `keep: true`, spec round 6 §5), by
   *  owner: their marks outlive the next question and follow their part
   *  when it is laid out again — worked out afresh from the same answer. */
  private kept = new Map<string, KeptGuess>();
  /** Every kept guess answered, by owner: a seek puts it back (laid out
   *  where its part stands then) while nothing since has ended it. */
  private keptMemory = new Map<string, KeptGuess>();
  /** A beside reveal's room was taken away mid-run (an erase, a hide, a clear):
   *  the template is committed afresh at the next boundary. */
  private pendingSettle = false;
  /** Every stored guess, for a later revise (spec 2026-10-02 §9). */
  private guessMemory = new Map<string, number[][]>();
  /** A decision's branches (spec 2026-10-02 §8): reaching another option's
   *  label skips on to `then` (or the end). It must survive the jump into the
   *  chosen branch, so it is not among what a scrub's endMarks clears. */
  private decideBranch: { labels: string[]; chosen: string; then?: string } | null = null;
  /** A prediction waiting for its animate (spec 2026-10-02 §3). */
  private predictCarry: {
    animIndex: number;
    step: Extract<PlanStep, { kind: "ask" }>;
    setup: GuessSetup;
    truthHandles: GuessHandle[];
    guess: number[][];
    owner: string;
    line: string | undefined;
    /** The feedback band's line (and a reward's joke), said after `line`. */
    extra: string[];
    live: boolean;
    answered: boolean;
    ok: boolean;
    judged: boolean;
  } | null = null;

  /** A template-bound ask's movie form, set by render() when the template carries a widget body: performs the widget's demo effects. */
  widgetDemo: ((signal: AbortSignal, step: Extract<PlanStep, { kind: "ask" }>) => Promise<void>) | null = null;

  /**
   * Provider for the explore verb, wired by the tray: opens the sliders and
   * resolves on Continue. Must resolve on signal abort. Absent (movies,
   * embeds, bare players), the WHOLE step — narration included — is skipped:
   * an exploration invitation with nothing to explore is a dangling intro.
   */
  /** Resolves when the viewer continues — with the vars the beat's `store`
   *  keeps (an activity's score, a composed melody), or nothing. */
  exploreGate: ((signal: AbortSignal, step: Extract<PlanStep, { kind: "explore" }>) => Promise<Record<string, string> | void>) | null = null;

  /** Responses collected by ask commands with store — {name} in later
   *  narration interpolates from here. Keys are lowercased. */
  readonly vars = new Map<string, string>();

  /** Viewer preference: skip quiz/ask entirely (a skipped collect-ask still
   *  stores its default so later {var} lines keep working). */
  private skipQuestions = false;

  /** Set by the exporter (and true in spirit for bare players): answers are
   *  the demo's, not a viewer's — gotos never fire, the path stays linear. */
  autoAnswers = false;

  /** A goto requested by the current step; the play loop performs it. */
  private pendingJump: number | null = null;

  /** Runtime values of "{var}" animate targets (path → the viewer's number).
   *  Overlaid by applyParams/previewParams — but only onto paths already
   *  present in the boundary's params, so pre-animate boundaries stay
   *  untouched and post-animate scrubs keep the personalization. */
  private varParamOverrides: Record<string, number> = {};

  /** Per-question outcomes, keyed by step index — re-answering a question
   *  (a remediation goto, a replay) overwrites its slot, never double-counts. */
  private outcomes = new Map<number, boolean>();
  /** Steps already answered in this pass — a re-answer does not extend {streak}. */
  private readonly streakSteps = new Set<number>();
  private streak(): number {
    return Number(this.vars.get("streak") ?? "0") || 0;
  }
  /** A backward jump ends the run of right answers; back at the start, a new pass begins. */
  private resetStreak(fromStart: boolean): void {
    if (this.vars.has("streak")) this.vars.set("streak", "0");
    this.rewardCount = 0;
    if (fromStart) this.streakSteps.clear();
  }

  /** Step index → 1-based ordinal among the playlist's questions (the N of
   *  `_answers.N`), assigned from the plan at construction. */
  readonly ordinalOf = new Map<number, number>();
  /** Question steps that have been answered (or skipped past) — `_answers.count`. */
  private answeredSteps = new Set<number>();

  /**
   * Publish one answer (spec 2026-09-15-stored-answers §2): under its ordinal
   * (`_answers.N`, `.N.ok`, `.N.secs`), under `_answers.last`, the running
   * `_answers.count`, and under the explicit store name with the same fields.
   * `ok` null (a collect-mode ask) and `secs` null (no live gate) write no
   * field — and clear a stale one, since latest wins.
   */
  /** The name an answer event and the record report: the explicit store, else the ordinal's slot. */
  private answerId(index: number, store: string | undefined): string {
    return store ? store.toLowerCase() : `${AUTO_NAMESPACE}.${this.ordinalOf.get(index) ?? 0}`;
  }

  private recordAnswer(index: number, store: string | undefined, value: string, ok: boolean | null, secs: number | null): void {
    const fields = (base: string): void => {
      this.vars.set(base, value);
      if (ok !== null) this.vars.set(`${base}.ok`, ok ? "true" : "false");
      else this.vars.delete(`${base}.ok`);
      if (secs !== null) this.vars.set(`${base}.secs`, secs.toFixed(1));
      else this.vars.delete(`${base}.secs`);
    };
    const n = this.ordinalOf.get(index);
    if (n !== undefined) {
      fields(`${AUTO_NAMESPACE}.${n}`);
      this.answeredSteps.add(index);
    }
    fields(`${AUTO_NAMESPACE}.last`);
    this.vars.set(`${AUTO_NAMESPACE}.count`, String(this.answeredSteps.size));
    if (store) fields(store.toLowerCase());
  }

  /** Publish {score}/{score_total} from the outcomes — called right after an
   *  answer lands, BEFORE the feedback lines speak. Digit strings: they read
   *  naturally in narration and if's numeric ops coerce at comparison time. */
  private updateScoreVars(index: number, last: boolean): void {
    // {streak}: right answers in a row — a wrong or skipped judged ask resets
    // it; answering a question again (a remediation loop) never extends it.
    if (!last) this.vars.set("streak", "0");
    else if (!this.streakSteps.has(index)) this.vars.set("streak", String(this.streak() + 1));
    this.streakSteps.add(index);
    let right = 0;
    for (const ok of this.outcomes.values()) if (ok) right++;
    this.vars.set("score", String(right));
    this.vars.set("score_total", String(this.outcomes.size));
  }

  /** Interpolate stored ask answers into a narration/caption line. */
  private line(text: string): string {
    return subVars(text, this.vars);
  }

  /**
   * The active subtitle track — what the viewer READS — or undefined for the
   * language the drawcast was written in. Independent of what is spoken (see
   * setSpokenTrack): the default is the original voice under translated text,
   * because baked or cloud narration really is a recording in one language and
   * a caption is not.
   */
  private subtitles: SubtitleTrack | undefined;

  /** The source line the caption currently shows, kept so a language change
   *  can re-render it without moving the playhead. */
  private captionSource = "";

  /**
   * Show a source line as the caption: translate first, substitute second.
   * That order is load-bearing — the translator copies {var} tokens through
   * verbatim, so a track's keys are the RAW spec lines, and a lookup done
   * after substitution would miss every personalized line.
   */
  private showCaption(source: string): void {
    this.captionSource = source;
    this.setCaption(this.line(translateCaption(source, this.subtitles)));
  }

  /** Switch the CC track (undefined = the source language). Re-renders the
   *  caption already on screen; never touches the playhead or the voice. */
  setSubtitles(track: SubtitleTrack | undefined): void {
    this.subtitles = track;
    this.showCaption(this.captionSource);
  }

  /**
   * What the VOICE says, which is a separate choice from what the caption
   * shows: Norwegian subtitles over the original English narration is a real
   * way to watch (read along), and so is the mirror image. The two tracks are
   * never coupled.
   */
  private spoken: SubtitleTrack | undefined;

  /** Switch the spoken track (undefined = the source language). Takes effect
   *  from the next line; the line already in the air is left to finish. */
  setSpokenTrack(track: SubtitleTrack | undefined): void {
    this.spoken = track;
  }

  /** The words to SPEAK for a source line: spoken track first, then {var}
   *  substitution — the same order, and for the same reason, as showCaption. */
  private spokenLine(source: string): string {
    return this.line(translateCaption(source, this.spoken));
  }
  /** Injectable after construction, exactly like inputGate: swaps geometry for the animate action. */
  reprojector: Reprojector | null = null;
  /**
   * Runs one script at one value map — the `run` step's engine, injected by
   * render() (sweep-run.ts). Null (headless tests, a Player with no runtime)
   * degrades a run to its pacing, exactly as a missing reprojector degrades
   * an animate: the drawcast keeps its shape, the figure just does not move.
   */
  sweepRunner: SweepRunner | null = null;
  /** Whether a caption shown now would sit on dark ground (render/caption-dark.ts), given what is on screen; the caption then takes the band. */
  captionOnDark: ((visible: readonly string[]) => boolean) | null = null;
  /**
   * id → the patches a `run` has left on that script, oldest first, one entry
   * per step that set one. A HISTORY, not a single value, because a script
   * can be swept twice: a scrub to a boundary between two runs must put the
   * FIRST run's result back, not throw the script away (the authored figure
   * belongs only before the first run of all). Mirrored here so the player
   * can answer without the reprojector — the tray asks what a run left the
   * script at.
   */
  private patchHistory = new Map<string, { step: number; patch: CodePatch }[]>();
  /**
   * plan step index → the full series of results that `run` step produced,
   * kept past the scrub that took its patch away. Patches are RUNTIME state:
   * `plan.states` carries none, so a scrub FORWARD over a run lands on a
   * boundary whose figure the plan cannot describe. This is how the boundary
   * gets described anyway — without running the script again, and without
   * the history entry, which `dropPatchesFrom` is entitled to throw away.
   */
  private runResults = new Map<number, CodePatch[]>();
  /**
   * The `run` step in flight, if any: its results all exist (they are
   * computed before the first frame) but its history entry holds only the
   * value the tween has reached so far. A scrub PAST it aborts it mid-sweep,
   * and must land on the value the run ENDS at, not on the half-swept one.
   */
  private activeRun: { index: number; id: string; results: CodePatch[] } | null = null;
  /**
   * The layout currently PAINTED, when a preview has replaced the plan-time
   * one. Anything hit-testing drawn geometry — a switch on a monitor's chin,
   * an overlay pinned to its glass — must ask for this, or it will be aiming
   * at where things were before the preview moved them.
   */
  private painted: LayoutResult | null = null;
  /**
   * Frame scheduler, injectable like inputGate: the exporter swaps in one
   * that keeps ticking while the tab is hidden (a Web Worker interval).
   * Callbacks receive a timestamp on the main window's clock.
   */
  raf: (cb: (now: number) => void) => void = (cb) => requestAnimationFrame(cb);
  /**
   * Sound engine for the play command, injectable like inputGate: live
   * playback wires a speaker-connected WebAudioTones, the exporter wires one
   * bound to its recording destination (notes land in the video, silently).
   * Null (headless tests) keeps play as pure pacing.
   */
  tones: ToneLike | null = null;

  private mode: PlaybackMode;
  private speedVal: number;
  /** Breathe after spoken beats (render/breath.ts). Off only for tests that measure raw sequencing. */
  private breathOn: boolean;
  private pausedFlag = false;
  /**
   * In-flight non-blocking narration. Steps that add or remove content (draw/
   * show/erase/clear/wait) await it first, so visuals never race ahead of the
   * voice; gestures and pauses run UNDER the voice by design.
   */
  private pendingSpeech: Promise<void> | null = null;
  /** The current narrated step's voice, so effects can follow it (glow-while-speaking). */
  private narrationVoice: Promise<void> | null = null;
  /**
   * Pictures whose mark is on screen (spec §13): painted by a mark step this
   * playback and not yet released — a continuing mark stays up for the next
   * step to take over. A scrub ends them all; a step whose `from` finds its
   * owner missing here (a seek landed on it) eases in instead of gliding.
   * Each painting step's own token: a stopped step's late clean-up ends the
   * mark only while it is still ITS mark, never a new run's on the picture.
   */
  private readonly liveMarks = new Map<string, symbol>();
  /** The language the cast is written in (spec.lang), for the words the player says itself. */
  private sourceLang: string | null = null;
  setSourceLang(lang: string | null): void {
    this.sourceLang = lang;
  }

  /** Stops the narrated step's voice alone — a question the viewer has already answered or skipped. */
  private narrationCtl: AbortController | null = null;

  /** A live viewer answered or skipped: the question's own reading stops now (Hans 2026-09-27). */
  private cutQuestionVoice(): void {
    this.narrationCtl?.abort();
  }
  private ac: AbortController | null = null;
  /** Boundary: number of fully completed steps. */
  private completed = 0;
  /** Speaker "a"'s gender (from Spec.voice), passed through to every speech.speak call. */
  private narratorGender: "male" | "female" | null = null;
  /** Animate params currently reflected on screen (last reprojector.commit call). */
  /** What is mounted: the params plus the source poses/shapes (design 2026-09-10 §2.5) the last commit ran at. */
  private appliedKey = Player.keyOf({}, undefined);
  /** True once any reprojector.frame() has run since the last commit — forces the next applyParams to commit even if params compare equal (frame() left the DOM at a live, possibly detached, mid-tween state). */
  private geometryDirty = false;
  /** Ids the plan-time layout had: anything a later param change mints beyond these was never addressable by a visibility verb and joins the implicit final draw (shown as soon as it exists). */
  private readonly planTimeIds: ReadonlySet<string>;
  /** The ids something is DEFINED by (plan.sources): only their poses and shapes are part of a boundary's layout key. */
  private readonly sources: ReadonlySet<string>;
  state: PlayerState = "idle";
  /** The camera at rest: the page, or the fit of a template's world (render/camera.ts). */
  readonly restBox: BBox;
  /** The box the PLAN last put the camera on (null = at rest). */
  private planCam: BBox | null = null;
  /** The viewer's own view while paused (ui/view-pan.ts), over the plan's; null = none. */
  private viewCam: BBox | null = null;
  /** The tween that hands the view back to the plan when play resumes. */
  private viewReturn: Promise<void> | null = null;

  constructor(
    plan: Plan,
    elements: Map<string, RenderedElement>,
    speech: SpeechLike,
    captionEl: HTMLElement | null,
    opts: { mode?: PlaybackMode; speed?: number; effects?: BackendEffects; questions?: "on" | "skip"; vars?: ReadonlyMap<string, string>; questionOffset?: number; breath?: boolean; world?: BBox } = {},
    callbacks: PlayerCallbacks = {},
  ) {
    this.plan = plan;
    this.restBox = restView(opts.world);
    this.holdFrom = heldFrom(plan);
    this.elements = elements;
    // A copy's id never appears in the plan-time (mounted) layout, so without
    // this it always fell through as "minted by a param change" and every
    // applyScene call unconditionally finish()ed it — undoing an erase/hide/
    // clear on a copy at the very next commit (review finding 1, 2026-09-10).
    this.planTimeIds = new Set([...elements.keys(), ...plan.states.flatMap((s) => Object.keys(s.copies ?? {}))]);
    this.sources = new Set(plan.sources ?? []);
    this.speech = speech;
    this.captionEl = captionEl;
    this.effects = opts.effects ?? null;
    this.callbacks = callbacks;
    this.mode = opts.mode ?? "narrated";
    this.speedVal = opts.speed ?? 1;
    this.breathOn = opts.breath ?? true;
    // Carried in from earlier playlist items (playlist/carry.ts): a name
    // stored in part 1 reads in part 3. Latest wins, so this item's own
    // answers overwrite what came in.
    if (opts.vars) for (const [k, v] of opts.vars) this.vars.set(k, v);
    // Every quiz/ask step gets its ordinal up front, from the plan, so
    // {_answers.N} means "the N-th question" whether or not the viewer
    // answered it, and a wrong_goto loop re-answers the same slot.
    let n = opts.questionOffset ?? 0;
    plan.steps.forEach((s, i) => {
      if (s.kind === "quiz" || s.kind === "ask") this.ordinalOf.set(i, ++n);
    });
    this.skipQuestions = opts.questions === "skip";
    this.hideAll();
  }

  get totalSteps(): number {
    return this.plan.steps.length;
  }

  get position(): number {
    return this.completed;
  }

  /** Whether the poster shows a boundary before the end (showPoster): the
   *  playhead stands there, but the counter, the step buttons and a
   *  playlist's item border count it as the end. */
  get atPoster(): boolean {
    return this.posterRestart;
  }

  setSpeed(x: number): void {
    this.speedVal = x;
  }

  setMode(mode: PlaybackMode): void {
    this.mode = mode;
    if (mode === "instant") this.renderUpTo(this.plan.steps.length);
  }

  setNarratorGender(g: "male" | "female" | null): void {
    this.narratorGender = g;
  }

  async play(): Promise<void> {
    if (this.state === "playing") return;
    if (this.ac && this.state === "paused" && this.pausedFlag) {
      // resume mid-step — the viewer's pan/zoom goes back to the plan's
      // camera first (the step is still held while it does)
      if (this.viewCam) {
        this.setState("playing");
        await this.returnView();
        if ((this.state as PlayerState) !== "playing" || !this.pausedFlag) return;
        this.pausedFlag = false;
        this.speechSynthResume();
        return;
      }
      this.pausedFlag = false;
      this.speechSynthResume();
      this.setState("playing");
      return;
    }
    if (this.mode === "instant") {
      this.renderUpTo(this.plan.steps.length);
      return;
    }
    // From a poster stopped before the first ask: from the beginning — by
    // jumpTo, not renderUpTo(0), which on a poster AT 0 would put the poster
    // back up. From the end: from the beginning too.
    if (this.posterRestart) {
      this.posterRestart = false;
      this.abortRun();
      this.jumpTo(0, false);
    } else if (this.completed >= this.plan.steps.length) this.renderUpTo(0);
    // A pending tray preview (geometryDirty) must settle before stepping:
    // frame() leaves handle-less DOM, and the run's actions need honest
    // elements. No-op when nothing is dirty and params already match; a
    // commit's fresh handles get the boundary's scene, as in settleParams.
    // A finished "Test me" is not part of the cast: its marks and room go.
    this.endOwner("guess_self");
    this.pendingSettle = false;
    const boundary = this.stateAt(this.completed);
    if (this.applyKey(boundary)) this.applyScene(boundary);

    const ac = new AbortController();
    this.ac = ac;
    this.pausedFlag = false;
    // A fresh run never inherits a paused synthesizer or tone context (a
    // pause the run it replaces left behind): its first line would queue
    // behind it and the whole run would draw in silence.
    this.speechSynthResume();
    this.setState("playing");
    if (this.viewCam) {
      await this.returnView();
      if (ac.signal.aborted) return;
    }
    while (this.completed < this.plan.steps.length && !ac.signal.aborted) {
      this.callbacks.onStep?.(this.completed, this.plan.steps.length);
      await this.runStep(this.completed, ac.signal);
      if (ac.signal.aborted) return;
      // Steps that ran alongside this one (marks on the other pictures of
      // the same command) are done too.
      const alongside = this.partnersOf(this.completed).length;
      if (this.pendingJump !== null) {
        const n = this.pendingJump;
        this.pendingJump = null;
        this.jumpTo(n, true);
        continue;
      }
      // A breath after a spoken beat (render/breath.ts): the next step's
      // voice and ink start only once the sentence has had its moment.
      // Scaled with playback speed like every other wait, and skipped when
      // the author wrote a `pause` here.
      if (this.breathOn) {
        await this.waitScaled(breathAfterMs(this.plan.steps, this.completed), ac.signal);
        if (ac.signal.aborted) return;
      }
      this.completed += 1 + alongside;
      this.callbacks.onStep?.(this.completed, this.plan.steps.length);
    }
    if (!ac.signal.aborted) {
      // A room taken away by the last steps: the end frame whole again.
      this.settleBesides();
      this.ac = null;
      this.setState("done");
    }
  }

  pause(): void {
    if (this.state !== "playing") return;
    this.pausedFlag = true;
    this.speech.pause();
    this.tones?.pause();
    this.setState("paused");
  }

  stop(): void {
    this.renderUpTo(0);
  }

  /** Where the step buttons count from: the end on a poster (the counter
   *  reads N/N there), else the playhead. */
  private get stepBase(): number {
    return this.posterRestart ? this.plan.steps.length : this.completed;
  }

  stepForward(): void {
    this.renderUpTo(Math.min(this.stepBase + 1, this.plan.steps.length));
  }

  stepBack(): void {
    this.renderUpTo(Math.max(this.stepBase - 1, 0));
  }

  /**
   * Poster/thumbnail state: show the finished figure without caption. Pressing
   * play from here restarts from the beginning.
   */
  showPoster(): void {
    this.renderUpTo(this.plan.steps.length);
    // The poster is the FINISHED drawing (Hans 2026-09-24: "the first page is
    // supposed to be the final drawing"): what the cast leaves on the page,
    // the whole page in view and at full strength — not the end's camera on
    // one detail (a zoom walk, a close-up that never pulled back) nor the
    // shadow a walk or a fade left the earlier items in. Erased things stay
    // erased: that was the author's choice. Playing moves on from here as
    // from any boundary.
    //
    // A cast whose asks answer on the figure (a tree, a formula, a guess,
    // cards) would give its answers away in that drawing: its poster is the
    // boundary before the first such ask, the trees' best and prune marks
    // still to be asked about left out (plan.ts posterOf). The playhead
    // stands at that boundary, so everything that reads "the boundary on
    // screen" (Test me, the tray, a widget) reads the poster's — and
    // posterRestart makes Play start from the beginning all the same.
    const poster = posterOf(this.plan);
    const end = this.stateAt(poster.at);
    for (const owner of [...this.besides.keys()]) this.dropBeside(owner);
    this.pendingSettle = false;
    if (poster.at < this.plan.steps.length) {
      this.restoreFormulaFills(poster.at);
      this.applyKey(end);
      this.completed = poster.at;
      this.posterRestart = true;
    }
    this.endMarks();
    const hide = new Set(poster.hide);
    this.applyScene({ ...end, visible: end.visible.filter((id) => !hide.has(id)), camera: null, opacities: {} });
    this.showCaption("");
  }

  /** Scene state PAINTED at a step boundary (after steps[0..n-1]) — the
   *  held last frame past holdFrom, the planned state everywhere else. */
  private stateAt(n: number): SceneState {
    return sceneAt(this.plan, n);
  }

  /** Whether a step that only takes things away is past the held frame —
   *  performed, it would wipe the frame the drawcast is meant to end on. */
  private heldPast(index: number): boolean {
    return this.holdFrom !== null && index >= this.holdFrom;
  }

  /** Set while the poster shows a boundary before the end (showPoster):
   *  the playhead stands there, but Play starts from the beginning. */
  private posterRestart = false;

  /** Jump to a step boundary: apply exactly the scene state after steps[0..n-1]. */
  renderUpTo(n: number): void {
    // Putting the poster's own boundary back (the tray after a preview)
    // keeps it the poster, not a cast paused at its first question.
    if (this.posterRestart && n === this.completed) {
      this.showPoster();
      return;
    }
    this.abortRun();
    // Back at the start: a second pass picks its feedback lines as the first did.
    if (n === 0) this.feedbackUsed.clear();
    this.jumpTo(n, false);
  }

  /** Move the playhead to a boundary: scrub (keepPlaying false, from
   *  renderUpTo) or a content-initiated goto mid-run (keepPlaying true —
   *  the run's own AbortController must survive the jump). Both drop the
   *  patches the steps at or after `n` made: a remediation `goto` that
   *  jumped backwards over a `run` and left its entry standing would put the
   *  history out of order, and the next scrub would show the wrong patch. */
  jumpTo(n: number, keepPlaying: boolean): void {
    this.posterRestart = false;
    if (n < this.completed || n === 0) this.resetStreak(n === 0);
    // A sweep's patch belongs to the step that set it: scrubbing to before
    // that step undoes it (back to the previous run's result, or to what the
    // author wrote), scrubbing past it keeps it. Dropped BEFORE the key is
    // applied, so the boundary commit below is laid out from the right script.
    this.dropPatchesFrom(n);
    // …and a scrub landing PAST a run puts back what that run ended on.
    if (!keepPlaying) this.restoreRunPatches(n);
    // …and a formula's boxes are empty before its ask, written in after it.
    this.restoreFormulaFills(n);
    // A beside reveal's room goes before the boundary is laid out — and the
    // ones this boundary still shows come back (yours and the truth).
    // A question on its own page that was standing is over: the boundary's
    // own opacities, nothing faded on top.
    this.staged = null;
    // Every mark and room off first (a reveal on screen now included), then
    // the restored ones on: nothing after this may drop them.
    this.endMarks();
    const restored = this.besidesAt(n);
    for (const [owner, b] of restored) this.putBeside(owner, b, false);
    // Kept guesses (§5) come back too, laid out where their parts stand at n.
    const kept = this.keptAt(n);
    const scene = this.stateAt(n);
    this.applyKey(scene);
    this.applyScene(scene);
    this.pendingSettle = false;
    for (const [owner, b] of restored) {
      this.guessOwners.add(owner);
      this.effects?.setGuessMarks?.(owner, b.faded && b.marks ? fadeYours(b.marks, FADED) : b.marks);
    }
    for (const [owner, r] of kept) {
      this.kept.set(owner, r);
      this.guessOwners.add(owner);
      if (r.prev) this.guessOwners.add(`${owner}_prev`);
    }
    this.refollow(scene);
    this.completed = n;
    // Show the most recent narration line at this boundary.
    let caption = "";
    for (let i = 0; i < n; i++) {
      const s = this.plan.steps[i];
      if (s.kind === "speak") caption = s.text;
      else if (s.narration !== undefined && !(this.skipQuestions && (s.kind === "quiz" || s.kind === "ask"))) caption = s.narration;
    }
    this.showCaption(caption);
    this.callbacks.onStep?.(this.completed, this.plan.steps.length);
    if (!keepPlaying) this.setState(n >= this.plan.steps.length ? "done" : n === 0 ? "idle" : "paused");
  }

  /** Apply a scene's visibility/offsets/pointer/camera to the currently mounted elements. */
  private applyScene(scene: SceneState): void {
    const visible = new Set(scene.visible);
    for (const [id, el] of this.elements) {
      // Cards a beside reveal left where the viewer put them stay there.
      const [dx, dy] = this.besideOffset(id) ?? scene.offsets[id] ?? [0, 0];
      const turn = scene.turns[id];
      if (turn && el.setTransform) el.setTransform(dx, dy, turn.deg, turn.pivot, turn.scale ?? 1, turn.mirror ?? false);
      else el.setOffset?.(dx, dy);
      // A kept tile of a faded beside reveal stays faded; a question on its
      // own page keeps the rest of the figure faded while it stands.
      el.setOpacity?.(this.baseOpacity(id, scene) * this.stageAlpha(id));
      el.setPoints?.(scene.shapes[id] ?? {});
      el.setText?.(scene.texts[id] ?? {});
      if (visible.has(id) || !this.planTimeIds.has(id) || this.besideShown(id)) el.finish();
      else el.hide();
    }
    this.effects?.setPointer(null);
    this.setCamera(scene.camera);
  }

  /** The plan puts the camera somewhere: it takes the screen back from the viewer. */
  private setCamera(box: BBox | null): void {
    this.planCam = box;
    this.viewCam = null;
    this.emitView(null);
    this.effects?.setCamera(box);
  }

  private readonly viewListeners = new Set<(box: BBox | null) => void>();
  private emitView(box: BBox | null): void {
    for (const f of this.viewListeners) f(box);
  }
  /** Hear the viewer's view change (null: the plan's camera is back). Returns the unsubscribe. */
  onViewChange(f: (box: BBox | null) => void): () => void {
    this.viewListeners.add(f);
    return () => this.viewListeners.delete(f);
  }

  /** Where the plan's camera stands now (the rest box when it is at rest). */
  get planCamera(): BBox {
    return this.planCam ?? this.restBox;
  }

  /** The viewer's own view, or null when the plan's camera is on screen. */
  get viewCamera(): BBox | null {
    return this.viewCam;
  }

  /**
   * The viewer's paused pan/zoom (ui/view-pan.ts): shown over the plan's
   * camera until play resumes or the plan moves the camera. Never while
   * playing — the movie's camera is the plan's alone — and never recorded:
   * an exporter drives a player with no UI, so this is app-only by
   * construction. null puts the plan's camera back.
   */
  setViewCamera(box: BBox | null): boolean {
    if (this.state === "playing" || !this.effects) return false;
    this.viewCam = box;
    this.emitView(box);
    this.effects.setCamera(box ?? this.planCam);
    return true;
  }

  /** Hand a viewer's view back to the plan's camera, smoothly (play resumes). */
  private returnView(ms = 450): Promise<void> {
    const from = this.viewCam;
    if (!from || !this.effects) return this.viewReturn ?? Promise.resolve();
    this.viewCam = null;
    this.emitView(null);
    const effects = this.effects;
    const to = this.planCam ?? this.restBox;
    const ease = EASINGS["ease-in-out"];
    const start = performance.now();
    this.viewReturn = new Promise<void>((resolve) => {
      const tick = (now: number) => {
        // A viewer who pauses again mid-return takes the view where it is.
        if (this.viewCam) return resolve();
        const t = Math.min(1, (now - start) / ms);
        effects.setCamera(t >= 1 ? this.planCam : lerpBox(from, to, ease(t)));
        if (t >= 1) return resolve();
        this.raf(tick);
      };
      this.raf(tick);
    }).finally(() => {
      this.viewReturn = null;
    });
    return this.viewReturn;
  }

  private static keyOf(params: Record<string, unknown>, ov: LayoutOverrides | undefined): string {
    return JSON.stringify([Object.entries(params).sort(([a], [b]) => (a < b ? -1 : 1)), overridesKey(ov)]);
  }

  /** The poses and shapes of the source ids at a scene, plus every math
   *  element's current TeX and every clone `copy` has minted — the part of
   *  the scene a layout reads (design 2026-09-10 §2.5); undefined when none
   *  of the four is populated. Poses/shapes stay restricted to sources so a
   *  move of anything else never changes the key (and never forces a
   *  remount); tex and copies never are — a TeX override always changes the
   *  layout, and a copy is what MAKES an id exist at all (mirrors plan.ts's
   *  currentOverrides, so both sides key the same layout). `frameMath`
   *  overlays a tween in progress (its `from`/`t`) onto the settled tex. */
  private overridesOf(
    offsets: Record<string, Pt>,
    turns: Record<string, Turn>,
    shapes: Record<string, Record<string, Pt[]>>,
    tex: Record<string, string>,
    copies: Record<string, string>,
    frameMath?: Record<string, { tex: string; from?: string; t?: number }>,
  ): LayoutOverrides | undefined {
    const poses: Record<string, { offset: Pt; turn?: Turn }> = {};
    const shp: Record<string, Record<string, Pt[]>> = {};
    for (const id of this.sources) {
      const o = offsets[id];
      const t = turns[id];
      if ((o && (o[0] !== 0 || o[1] !== 0)) || (t && !isIdentity(t))) poses[id] = { offset: o ?? [0, 0], turn: t };
      if (shapes[id]) shp[id] = shapes[id];
    }
    const math: Record<string, { tex: string; from?: string; t?: number }> = {};
    for (const [id, t] of Object.entries(tex)) math[id] = { tex: t };
    Object.assign(math, frameMath);
    if (Object.keys(poses).length === 0 && Object.keys(shp).length === 0 && Object.keys(math).length === 0 && Object.keys(copies).length === 0) return undefined;
    return { poses, shapes: shp, math, copies: { ...copies } };
  }

  private frameScene(scene: SceneState, visible: ReadonlySet<string> = new Set(scene.visible)): FrameScene {
    // A frame paints fresh nodes: a question on its own page must ride on it.
    const st = this.staged;
    const opacities = st && st.alpha < 1 ? { ...scene.opacities, ...Object.fromEntries([...st.ids].map((id) => [id, (scene.opacities[id] ?? 1) * st.alpha])) } : scene.opacities;
    return { visible, offsets: scene.offsets, turns: scene.turns, opacities, shapes: scene.shapes, texts: scene.texts };
  }

  /** An element's own opacity at a scene: a kept tile of a faded beside reveal stays faded. */
  private baseOpacity(id: string, scene: SceneState): number {
    return this.besideFadedShown(id) ? FADED : (scene.opacities[id] ?? 1);
  }

  /** How far a question on its own page fades this id now (1 = not at all). */
  private stageAlpha(id: string): number {
    return this.staged?.ids.has(id) ? this.staged.alpha : 1;
  }

  /**
   * A question on its own page (stage: "own", spec 2026-10-03-round6 §6):
   * everything on screen but the asked parts (the plan's `stage`) fades to
   * STAGE_DIM as the question opens — not removed — and comes back over
   * STAGE_MS once the question (its reveal and its lines) is done. The fade
   * in runs beside the question, never before it, and the way back is a
   * plain tween: a movie never waits on either. Aborted (a pause, a scrub),
   * the figure is put back at once — unless a scrub already took the stage
   * down and repainted (renderUpTo/jumpTo).
   */
  private async onOwnPage(step: Extract<PlanStep, { kind: "ask" }>, before: SceneState, signal: AbortSignal, run: () => Promise<void>): Promise<void> {
    if (!step.stage) return run();
    const keep = new Set(step.stage);
    const ids = new Set(before.visible.filter((id) => !keep.has(id)));
    if (ids.size === 0) return run();
    const mine = { ids, alpha: 1 };
    this.staged = mine;
    const paint = (a: number): void => {
      if (this.staged !== mine) return;
      mine.alpha = a;
      for (const id of ids) this.elements.get(id)?.setOpacity?.(this.baseOpacity(id, before) * a);
    };
    try {
      await Promise.all([this.progress(STAGE_MS, signal, (t) => paint(1 - (1 - STAGE_DIM) * t)), run()]);
      if (!signal.aborted) await this.progress(STAGE_MS, signal, (t) => paint(STAGE_DIM + (1 - STAGE_DIM) * t));
    } finally {
      if (this.staged === mine) {
        paint(1);
        this.staged = null;
      }
    }
  }

  /**
   * Remount at the boundary's params when they differ from what is on screen,
   * or when reprojector.frame() has run since the last commit (its mid-tween
   * DOM state must always be settled by a trailing commit — never left as-is,
   * even if the boundary's params happen to equal the last committed ones).
   */
  /** Commit the current boundary's honest geometry MID-RUN — the explore
   *  gate's way back after slider previews (renderUpTo would abort the run
   *  the gate is parked on). Adopts fresh element handles. */
  settleParams(): void {
    // A `run`'s patch is NOT preview state: it is what the lesson now shows,
    // and it survives Continue (only a scrub back past the run takes it away).
    // A commit mounts fresh handles: show them as the boundary has them, or
    // the stage goes blank after a preview (a figure drag, a slider).
    const scene = this.stateAt(this.completed);
    if (this.applyKey(scene)) this.applyScene(scene);
  }

  /** What a `run` has left this script at, or null — the tray reads it to
   *  open its knobs where the sweep stopped instead of at the author's
   *  defaults. */
  codePatchOf(id: string): CodePatch | null {
    const hist = this.patchHistory.get(id);
    return hist && hist.length > 0 ? hist[hist.length - 1].patch : null;
  }

  /** The elements a frame must be laid out from while a sweep is live. */
  patchedElements(): SpecElement[] | undefined {
    return this.reprojector?.patchedElements?.();
  }

  /** Record one script's patch at the step that made it, and show it. Within
   *  a step the newest wins (a sweep sets one per value, and only its last is
   *  a boundary's state) — so the history holds one entry per (id, step) and
   *  never grows with the length of a sweep. */
  private pushCodePatch(id: string, patch: CodePatch, step: number): void {
    const hist = this.patchHistory.get(id) ?? [];
    // BY STEP, not by arrival: a forward scrub fills in the runs it skipped
    // after later ones may already have entries, and an out-of-order history
    // would make `dropPatchesFrom` and `codePatchOf` answer with the wrong
    // one. Playback always appends (its step is the newest), so the common
    // path is still a push or an in-place replace.
    const at = hist.findIndex((e) => e.step >= step);
    if (at === -1) hist.push({ step, patch });
    else if (hist[at].step === step) hist[at] = { step, patch };
    else hist.splice(at, 0, { step, patch });
    this.patchHistory.set(id, hist);
    // Only the newest entry is what the figure shows; an older one filled in
    // behind a later run's result must not paint over it.
    if (hist[hist.length - 1].step === step) this.showCodePatch(id, patch);
  }

  /**
   * Put back what every `run` before boundary `n` left its script at.
   *
   * A forward scrub crosses runs the viewer never played, and there is
   * nothing in the plan to read their results from — `plan.states` carries
   * geometry, not code. So: a run whose results are already known (the one in
   * flight this scrub just aborted, or one remembered from an earlier play)
   * gets its LAST result applied synchronously, before the boundary is laid
   * out. A run with no results at all is asked for its last value only —
   * a cache read after the idle warm-up — and the answer is applied later,
   * and only if the scrub it was asked for still stands.
   */
  private restoreRunPatches(n: number): void {
    const upto = Math.min(n, this.plan.steps.length);
    for (let i = 0; i < upto; i++) {
      const step = this.plan.steps[i];
      if (step.kind !== "run") continue;
      // The aborted in-flight run's entry holds the value its tween had
      // reached; its own results say where it was going. Those win.
      const known = (this.activeRun?.index === i ? this.activeRun.results : null) ?? this.runResults.get(i) ?? null;
      if (known) {
        const last = known[known.length - 1];
        // code === "" is "nothing ever succeeded" — leave the authored script.
        if (last && last.code !== "") this.pushCodePatch(step.code, last, i);
        continue;
      }
      if (this.patchHistory.get(step.code)?.some((e) => e.step === i)) continue;
      const runner = this.sweepRunner;
      const values = step.values[step.values.length - 1];
      if (!runner || !values) continue;
      void runner(step.code, values).then(
        async (patch) => {
          // Decoded before it is shown (see the run case): the restored
          // figure arrives painted, not as a pane that fills in a beat later.
          await decodeFigures(patch.result);
          // The scrub must still stand, and nothing may have played this run
          // in the meantime — either way its own result is the honest one.
          if (this.completed !== n) return;
          if (this.patchHistory.get(step.code)?.some((e) => e.step === i)) return;
          this.pushCodePatch(step.code, { ...patch, values }, i);
          // The commit mounts fresh elements, hidden until told otherwise:
          // the scene's visibility must be applied again, as jumpTo does, or
          // the whole page — heading and all — stays blank (2026-09-25: every
          // scrub past an uncached run, and every frames-harness end frame of
          // a cast with a run).
          const scene = this.stateAt(this.completed);
          this.applyKey(scene);
          this.applyScene(scene);
        },
        () => {
          /* a script that will not run leaves the authored figure standing */
        },
      );
    }
    this.activeRun = null; // consumed, or stale: either way the scrub owns the state now
  }

  /** Hand one script's patch (or null, the authored script) to the render
   *  closure, and mark the geometry dirty so the next boundary commits the
   *  patched layout even when its params compare equal to what is mounted. */
  private showCodePatch(id: string, patch: CodePatch | null): void {
    this.reprojector?.setCodePatch?.(id, patch);
    this.geometryDirty = true;
  }

  /** Take back every patch a step at or after `n` made — a scrub to before
   *  the run that made it. What the EARLIER runs left stands: the newest
   *  surviving entry goes back on screen, and only a script with no entry
   *  left returns to what the author wrote. */
  private dropPatchesFrom(n: number): void {
    for (const [id, hist] of [...this.patchHistory]) {
      let dropped = false;
      while (hist.length > 0 && hist[hist.length - 1].step >= n) {
        hist.pop();
        dropped = true;
      }
      if (!dropped) continue;
      if (hist.length === 0) {
        this.patchHistory.delete(id);
        this.showCodePatch(id, null);
      } else {
        this.showCodePatch(id, hist[hist.length - 1].patch);
      }
    }
  }

  /** The viewer's runtime var-animate values (path → number) — the tray
   *  starts its sliders at these, not at the plan-time fallbacks. */
  getParamOverrides(): Record<string, number> {
    return { ...this.varParamOverrides };
  }

  /** A boundary's params as laid out: the var overrides, plus a tree's
   *  `answers` (its blanks still to be asked show "?" — plan.ts). */
  private paramsOf(scene: SceneState): Record<string, unknown> {
    const p0 = this.withVarOverrides(scene.params);
    // A beside reveal's room (bars in halves, the pie moved over) stands until its marks go.
    let p: Record<string, unknown> = p0;
    for (const b of this.besides.values()) if (b.params) p = { ...p, ...b.params };
    return scene.answers ? { ...p, answers: scene.answers } : p;
  }

  /** Overlay runtime var-animate values onto paths the params already hold. */
  private withVarOverrides(params: Record<string, number>): Record<string, number> {
    let out = params;
    for (const [k, v] of Object.entries(this.varParamOverrides)) {
      if (k in params && params[k] !== v) {
        if (out === params) out = { ...params };
        out[k] = v;
      }
    }
    return out;
  }

  /** Commit the scene's geometry when it differs from what is mounted (or
   *  is dirty); true when it did — the handles are then FRESH, at their
   *  mounted state, and the caller must apply the scene to them. */
  private applyKey(scene: SceneState): boolean {
    if (!this.reprojector) return false;
    this.painted = null; // back to the plan-time geometry
    const merged = this.paramsOf(scene);
    const ov = this.overridesOf(scene.offsets, scene.turns, scene.shapes, scene.tex, scene.copies);
    const key = Player.keyOf(merged, ov);
    if (!this.geometryDirty && key === this.appliedKey) return false;
    // Numbers, save a tree's `answers` map (its blanks' "?"), which the
    // layout reads like any other template param.
    this.elements = this.reprojector.commit(merged, ov);
    this.appliedKey = key;
    this.geometryDirty = false;
    return true;
  }

  /**
   * Paint the current boundary with extra param overrides — the explore
   * tray's live slider preview and free play's position preview. Cheap
   * frame() geometry only (no handles); marks geometry dirty so the next
   * renderUpTo/applyParams commits honest state even when the boundary's
   * params compare equal to appliedParams.
   */
  previewParams(overrides: Record<string, unknown>, opts: { revealNew?: boolean } = {}): void {
    if (!this.reprojector) return;
    const scene = this.stateAt(this.completed);
    this.painted =
      this.reprojector.frame({ ...this.paramsOf(scene), ...overrides }, this.frameScene(scene), {
        revealNew: opts.revealNew,
        overrides: this.overridesOf(scene.offsets, scene.turns, scene.shapes, scene.tex, scene.copies),
      }) || null;
    this.geometryDirty = true;
  }

  /** One swell of the answer glow on `ids` — a widget's "right", "wrong" or
   *  "look here" — always cleared, even when there are no effects to draw it. */
  async glow(ids: string[], ms = ANSWER_GLOW_MS, color?: string): Promise<void> {
    const effects = this.effects;
    if (!effects || ids.length === 0) return;
    const ac = new AbortController();
    try {
      await this.progress(ms, ac.signal, (t) => effects.setHighlight(ids, "glow", swellLevel(t), null, color, t * ms));
    } finally {
      effects.endHighlight(ids);
    }
  }

  /** The laser taps the centre of `box` — a widget demo's gesture — and lifts. */
  async tapAt(box: BBox, ms = 900): Promise<void> {
    const effects = this.effects;
    if (!effects) return;
    const path = pointerPath({ x: box.x + box.w / 2, y: box.y + box.h / 2, box }, "tap");
    const ac = new AbortController();
    try {
      await this.progress(ms, ac.signal, (t) => effects.setPointer(t >= 1 ? null : path(t)));
    } finally {
      effects.setPointer(null);
    }
  }

  /** A widget's line in the caption band; null puts the narration's caption back. */
  caption(text: string | null): void {
    if (text === null) this.showCaption(this.captionSource);
    else this.setCaption(text);
  }

  /**
   * Paint the current boundary with a patched SPEC — the code editor's
   * preview: edited elements (a script and its fresh envelope) and, when the
   * script feeds tokens, the re-substituted params. Ids the patched layout
   * mints that the plan never drew (new code lines, a new output row) are
   * revealed. settleParams() is the way back, as for slider previews.
   */
  previewSpec(patch: { elements?: SpecElement[]; params?: Record<string, unknown>; hide?: ReadonlySet<string> }): void {
    if (!this.reprojector) return;
    const scene = this.stateAt(this.completed);
    // `hide` is the viewer's own subtraction — a switch on a drawn monitor
    // turning a half off. It goes through the SAME call as everything else,
    // because the reprojector rebuilds geometry without minting new element
    // handles: anything applied afterwards would be talking to stale nodes.
    const visible = new Set(scene.visible);
    for (const id of patch.hide ?? []) visible.delete(id);
    this.painted =
      this.reprojector.frame({ ...this.paramsOf(scene), ...(patch.params ?? {}) }, this.frameScene(scene, visible), {
        revealNew: true,
        elements: patch.elements,
        overrides: this.overridesOf(scene.offsets, scene.turns, scene.shapes, scene.tex, scene.copies),
      }) || null;
    this.geometryDirty = true;
  }

  /** The layout on screen right now: a preview's, or the plan's. */
  paintedLayout(): LayoutResult | null {
    // No preview: the last committed boundary's layout. Without it a figure
    // that ends on an animated param (a time cursor swept to the end) was
    // hit-tested against the authored params' geometry (2026-09-28).
    return this.painted ?? this.reprojector?.committed?.() ?? null;
  }

  /** Move a rendered part by (dx, dy) on top of the pose it is drawn with — a
   *  widget's drag ghost; (0, 0) restores it. Through the EFFECTS, not the
   *  element handles: the handles hold the nodes this figure mounted with, and
   *  any preview since (a slider, the widget's own patch) has replaced them. */
  nudge(id: string, dx: number, dy: number, scale = 1, pivot?: Pt): void {
    if (scale !== 1 && pivot) this.effects?.setOffset?.(id, dx, dy, scale, pivot);
    else this.effects?.setOffset?.(id, dx, dy);
  }

  /**
   * Add-on hook (the identify drill, ui/quiz.ts): dim these ids to alpha, or
   * restore them with alpha 1. Rides on the focus verb's primitive and, like
   * it, survives no scrub — which is why the drill tears down on any step.
   */
  dimElements(ids: string[], alpha: number): void {
    if (!this.effects?.setFocus || ids.length === 0) return;
    if (alpha >= 1) this.effects.endFocus?.(ids);
    else this.effects.setFocus(ids, alpha);
  }

  dispose(): void {
    this.abortRun();
    this.endMarks();
  }

  /**
   * A guess on the figure (spec 2026-10-01-guess-and-reveal): the guessed
   * parts are painted at the viewer's guess while the question stands, the
   * answer is scored, then the figure tweens from the guess to the truth with
   * the ghost and the gap left on it, and right/wrong is spoken.
   */
  /**
   * The painter of a guess at a boundary: the figure redrawn from the
   * guessed numbers (and, for a sketched line, the viewer's dashed copy over
   * it while it is theirs — the part they draw would otherwise look exactly
   * like the part they were given).
   */
  private guessPainter(setup: GuessSetup, before: SceneState, visible: ReadonlySet<string>, owner: string): GuessPaint {
    const rp = this.reprojector!;
    const sceneParams = this.paramsOf(before);
    const overrides = this.overridesOf(before.offsets, before.turns, before.shapes, before.tex, before.copies);
    const baseElements = rp.patchedElements?.();
    // A sketched line's copy, or a market curve's (spec 2026-10-03 §3.2: the
    // copy is a mark — the template is never painted from it).
    const sketched = setup.handles.some((h) => h.kind === "curve" || h.kind === "market");
    return (values, marks = true, extra) => {
      const patch0 = this.guess!.patch(setup, values, baseElements);
      // A beside reveal's truth in ink (extra.styles: a scale's own pin and number).
      const styles = extra?.styles;
      const patch = styles && patch0.elements ? { ...patch0, elements: patch0.elements.map((e) => (styles[e.id] ? ({ ...e, ...styles[e.id] } as SpecElement) : e)) } : patch0;
      // A beside reveal's room (extra.params) and a scale's pin dropping in (extra.offsets).
      const scene = extra?.offsets ? { ...before, offsets: { ...before.offsets, ...extra.offsets } } : before;
      rp.frame({ ...sceneParams, ...patch.params, ...(extra?.params ?? {}) }, this.frameScene(scene, visible), { revealNew: true, overrides, ...(patch.elements ? { elements: patch.elements } : {}) });
      this.geometryDirty = true;
      if (marks && sketched) {
        this.guessOwners.add(owner);
        this.effects?.setGuessMarks?.(owner, guessMarks(setup.handles, values, 0, { asking: true }));
      }
    };
  }

  /** The handles for `on` at a boundary (the template params as they stand there). */
  private guessSetupAt(on: string[], from: number | undefined, before: SceneState, quiet = false, end?: GuessEnd): GuessSetup | null {
    if (!this.guess || !this.reprojector) return null;
    const setup = this.guess.setup(on, from, this.tplParamsOf(before), this.paintedLayout(), end ? { end } : undefined);
    if (!quiet) for (const w of setup.warnings) console.warn(`[guess] ${w}`);
    return setup.handles.length > 0 ? setup : null;
  }

  /** The template's params at a boundary (dot-path overrides, vars left out). */
  private tplParamsOf(state: SceneState): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(this.withVarOverrides(state.params))) if (!k.startsWith("vars.")) out[k] = v;
    return out;
  }

  /**
   * The beside reveal (spec 2026-10-03-round6 §3): the viewer's answer stays
   * where they put it, the truth is drawn beside or over it — all at once, or
   * part by part (`order` "each"). Leaves the owner's beside record (its
   * marks, the room it keeps) for the caller's commit. False when aborted.
   */
  private async revealBeside(setup: GuessSetup, guess: number[][], paint: GuessPaint, owner: string, signal: AbortSignal, index: number, order: RevealOrder): Promise<boolean> {
    this.guessOwners.add(owner);
    const hs = setup.handles;
    const total = revealLength(hs.length, BESIDE_MS, order);
    const styles = besideStyles(hs);
    await this.progress(total, signal, (t) => {
      const prog = hs.map((_, k) => partProgress(k, t * total, BESIDE_MS, order));
      paint(besideValues(hs, guess, prog), false, { params: besideParams(hs, prog), offsets: besideOffsets(hs, prog), styles });
      this.effects?.setGuessMarks?.(owner, besideMarks(hs, guess, prog));
    });
    if (signal.aborted) {
      this.endGuessMarks(true);
      return false;
    }
    const ones = hs.map(() => 1);
    const room = besideParams(hs, ones);
    this.putBeside(owner, { index, marks: besideMarks(hs, guess, ones), faded: false, ...(Object.keys(room).length > 0 ? { params: room } : {}), ...(Object.keys(styles).length > 0 ? { styles } : {}) });
    return true;
  }

  /** The reveal: guess → truth, the ghost staying where the viewer put it. False when aborted. */
  private async revealGuess(setup: GuessSetup, guess: number[][], paint: GuessPaint, owner: string, signal: AbortSignal): Promise<boolean> {
    this.guessOwners.add(owner);
    const truth = setup.handles.map((h) => h.truth);
    await this.progress(GUESS_REVEAL_MS, signal, (t) => {
      const e = smoothstep(t);
      paint(guess.map((row, k) => row.map((v, j) => v + (truth[k][j] - v) * e)), false);
      this.effects?.setGuessMarks?.(owner, guessMarks(setup.handles, guess, e));
    });
    if (signal.aborted) {
      this.endGuessMarks(true);
      return false;
    }
    return true;
  }

  /**
   * "Test me" (spec §7): the viewer's own guess at every guessable part on
   * screen at this boundary — the same gate, the same reveal, nothing
   * recorded. `open` is the gate (ui/guess-gate.ts). Resolves false when
   * there is nothing to guess here. Any play or seek aborts it.
   */
  async selfTest(open: (signal: AbortSignal, session: GuessSession) => Promise<string | null>): Promise<boolean> {
    if (!this.guess || !this.reprojector || this.state === "playing") return false;
    const n = this.shownAt();
    const before = this.stateAt(n);
    const setup0 = this.guessSetupAt(["all"], undefined, before, true);
    if (!setup0) return false;
    // Only what the viewer can see: a part not drawn yet is the cast's own question to come.
    const visible = new Set(before.visible);
    const handles = setup0.handles.filter((h) => h.shows.every((id) => visible.has(id)));
    if (handles.length === 0) return false;
    const setup: GuessSetup = { ...setup0, handles };
    this.selfTestAbort?.abort();
    const ac = new AbortController();
    this.selfTestAbort = ac;
    this.endGuessMarks(true);
    const owner = "guess_self";
    const paint = this.guessPainter(setup, before, visible, owner);
    const start = setup.handles.map(startValues);
    paint(start);
    const typed = await open(ac.signal, { setup, start, paint });
    const guess = typed !== null ? decodeGuess(typed, setup.handles) : null;
    if (ac.signal.aborted) return true;
    if (!guess) {
      // Put back: the boundary's honest geometry.
      this.endGuessMarks(true);
      this.applyKey(before);
      this.applyScene(before);
      return true;
    }
    if (await this.revealBeside(setup, guess, paint, owner, ac.signal, -1, "all")) {
      this.applyKey(before);
      this.applyScene(before);
      this.effects?.setGuessMarks?.(owner, this.besides.get(owner)?.marks ?? null);
    }
    if (this.selfTestAbort === ac) this.selfTestAbort = null;
    return true;
  }
  private selfTestAbort: AbortController | null = null;

  /** Drop a self test in progress (playback starting): its gate closes, its marks go. */
  cancelSelfTest(): void {
    if (this.selfTestAbort) {
      this.selfTestAbort.abort();
      this.selfTestAbort = null;
      this.endGuessMarks(true);
    }
    // A finished one: its marks and its room go too (play commits the boundary afresh).
    this.endOwner("guess_self");
  }

  /** The boundary on screen: the poster's (before the first ask) while it
   *  shows, the end once played through, else where the playhead stands. */
  private shownAt(): number {
    return this.state === "done" && !this.posterRestart ? this.plan.steps.length : this.completed;
  }

  /** Whether "Test me" has anything to offer at this boundary (the chip shows only then). */
  canSelfTest(): boolean {
    if (!this.guess || !this.reprojector || this.state === "playing" || this.plan.steps.length === 0) return false;
    const n = this.shownAt();
    const before = this.stateAt(n);
    const setup = this.guessSetupAt(["all"], undefined, before, true);
    if (!setup) return false;
    const visible = new Set(before.visible);
    return setup.handles.some((h) => h.shows.every((id) => visible.has(id)));
  }

  /**
   * A guess on the figure (spec 2026-10-01-guess-and-reveal): the guessed
   * parts are painted at the viewer's guess while the question stands, the
   * answer is scored, then the figure tweens from the guess to the truth with
   * the ghost and the gap left on it, and right/wrong is spoken.
   */
  private async guessAsk(index: number, step: Extract<PlanStep, { kind: "ask" }>, before: SceneState, signal: AbortSignal): Promise<void> {
    await this.narrationBarrier();
    if (signal.aborted || !step.on) return;
    // PREDICT (spec 2026-10-02 §3): the truth is the figure after the next
    // animate; that animate is the reveal, so this step only asks. A market
    // curve's truth is read from that animate's end (spec 2026-10-03 §3).
    const animIndex = step.predict ? this.nextAnimate(index) : -1;
    const animStep = animIndex >= 0 ? this.plan.steps[animIndex] : null;
    const end: GuessEnd | undefined =
      animStep?.kind === "animate" ? { params: this.tplParamsOf(this.plan.states[animIndex]), targets: animStep.targets } : undefined;
    const setup = this.guessSetupAt(step.on, step.from, before, false, end);
    if (!setup) return;
    // Earlier guesses' marks end with this question — a kept one only when it asks about the same part.
    this.endGuessMarks(true, true, setup.handles.flatMap((h) => [h.part, ...h.shows]));
    const truthHandles = (() => {
      // A market handle carries its own truth (the curve at the animate's end).
      if (animIndex < 0 || setup.handles.some((h) => h.kind === "market")) return setup.handles;
      const later = this.guessSetupAt(step.on, step.from, this.plan.states[animIndex], true);
      return later && later.handles.length === setup.handles.length ? setup.handles.map((h, k) => ({ ...h, truth: later.handles[k].truth })) : setup.handles;
    })();
    // What the question shows: everything the plan reveals at this step (the
    // guessed parts), painted from the guess instead of the truth.
    const after = this.plan.states[index];
    const visible = new Set([...before.visible, ...after.visible, ...setup.handles.flatMap((h) => h.shows)]);
    const owner = `guess_${index}`;
    const marked = setup.handles.flatMap((h) => [h.part, ...h.shows]);
    this.guessMarkParts.set(owner, marked);
    this.guessMarkParts.set(`${owner}_prev`, marked);
    const paintFigure = this.guessPainter(setup, before, visible, owner);
    // A budget (spec 2026-10-03-looks-feedback-account §5): the bars move on
    // their own and an account bar beside the plot shows what is left; it
    // stands while the question does and goes before the reveal.
    const budget = budgetOf(setup.handles, step.budget);
    // No account_label: the gates' own word for it, in the cast's language ("Left" / "Igjen").
    const account = budget !== null ? (step.accountLabel !== undefined ? { budget, label: step.accountLabel } : { budget, label: gateWords(gateLang(this.sourceLang)).account, isDefault: true }) : null;
    const accountOwner = `${owner}_account`;
    const paint: GuessPaint = (values, marks = true, extra) => {
      paintFigure(values, marks, extra);
      if (!account || !marks) return;
      this.guessOwners.add(accountOwner);
      this.effects?.setGuessMarks?.(accountOwner, accountMarks(setup.handles, values, account.budget, account.label));
    };
    const endAccount = (): void => {
      if (!account) return;
      this.effects?.setGuessMarks?.(accountOwner, null);
      this.guessOwners.delete(accountOwner);
    };
    // A line not drawn yet: its given part draws itself in while the
    // question is read, before the viewer takes over (Hans 2026-10-02:
    // "it should draw the first part of the line while talking").
    if (!step.predict) await this.drawGivenIn(setup, before, visible, signal);
    if (signal.aborted) return;
    // Where the guess starts: the present (predict), the earlier guess
    // (revise), else the handle's own start (a budget too: every bar low,
    // the budget in the account, nothing balanced until the viewer splits it).
    const prev = step.revise !== undefined ? this.guessMemory.get(step.revise.toLowerCase()) : undefined;
    const fits = (v: number[][] | undefined): v is number[][] => v !== undefined && v.length === setup.handles.length && v.every((r, k) => r.length === setup.handles[k].truth.length);
    const start: number[][] = step.predict
      ? setup.handles.map((h) => (h.kind === "market" ? startValues(h) : h.truth.slice()))
      : fits(prev)
        ? prev.map((r) => r.slice())
        : setup.handles.map(startValues);
    if (fits(prev)) {
      // The first guess stays, lighter, while the viewer revises it.
      this.guessOwners.add(`${owner}_prev`);
      this.effects?.setGuessMarks?.(`${owner}_prev`, { ...guessMarks(setup.handles, prev, 0), color: GUESS_PREV_COLOR });
    }
    const live = !this.autoAnswers && this.askGate !== null;
    paint(start);
    let guess: number[][] = start;
    let answered = false;
    let secs: number | null = null;
    if (live) {
      const from = performance.now();
      const session: GuessSession = { setup, start, paint, ...(account ? { account } : {}) };
      const typed = await this.askGate!(signal, Object.assign({}, step, { guess: session }));
      if (signal.aborted) return;
      secs = (performance.now() - from) / 1000;
      const decoded = typed !== null ? decodeGuess(typed, setup.handles) : null;
      if (decoded) {
        guess = decoded;
        answered = true;
      }
      if (typed !== null) this.cutQuestionVoice();
    } else {
      // The movie: the laser carries the demo guess (`default`) from the
      // start to where it lands, painting as it goes.
      // A market curve with no default: the commonest guess, an even move
      // of the true mean size (spec 2026-10-03 §6) — the laser takes the middle.
      // A turn about the equilibrium (gaps of opposite sign) has no even move
      // to show: the movie turns it right instead.
      const commonest = (h: GuessHandle, k: number): number[] => {
        if (!h.market) return start[k];
        if (h.truth[0] * h.truth[1] < 0) return h.truth.slice();
        return gapsOf(h.market, (h.truth[0] + h.truth[1]) / 2, 1);
      };
      const authored = defaultGuess(step.fallback, setup.handles);
      const demo = account
        ? balancedSplit(authored ?? start, account.budget)
        : (authored ?? (setup.handles.some((h) => h.kind === "market") ? setup.handles.map(commonest) : start));
      const effects = this.effects;
      // Where the laser holds: a market curve's middle to move it, its end to
      // turn it (a demo whose gaps differ in sign is a turn); else the last entry.
      const h0 = setup.handles[0];
      const laserAt = h0.kind === "market" ? ((demo[0]?.[0] ?? 0) * (demo[0]?.[1] ?? 0) < 0 ? 1 : 0) : (demo[0]?.length ?? 1) - 1;
      await this.progress(1400, signal, (t) => {
        const e = smoothstep(t);
        const vals = start.map((row, k) => row.map((v, j) => v + ((demo[k]?.[j] ?? v) - v) * e));
        paint(vals);
        const p = pointFor(h0, vals[0], laserAt);
        effects?.setPointer(t >= 1 || !p ? null : p);
      });
      effects?.setPointer(null);
      if (signal.aborted) return;
      guess = demo;
      answered = true;
    }
    if (this.narrationVoice) await this.narrationVoice;
    if (signal.aborted) return;
    endAccount();
    if (step.store) this.guessMemory.set(step.store.toLowerCase(), guess.map((r) => r.slice()));

    // Kept back (reveal: false): stored, its ghost left, nothing revealed or scored.
    if (!step.reveal) {
      this.recordAnswer(index, step.store, guessText(setup.handles, guess, scoreGuess(setup.handles, guess)), null, secs);
      this.applyKey(after);
      this.applyScene(after);
      this.guessOwners.add(owner);
      this.effects?.setGuessMarks?.(owner, guessMarks(setup.handles, guess, 0));
      this.keepGuess(owner, index, step, guess, "held", fits(prev) ? prev : undefined);
      if (step.right) await this.speakLine(step.right, step, signal);
      return;
    }

    const judged = step.judge !== false;
    const score = scoreGuess(truthHandles, guess, { tolerance: step.tolerance, relative: step.relative, check: step.check });
    const ok = answered && score.ok;
    this.recordAnswer(index, step.store, guessText(truthHandles, guess, score), judged ? ok : null, secs);
    if (step.store) {
      for (const [k, v] of Object.entries(guessVars(step.store, truthHandles, guess, score))) this.vars.set(k, v);
      this.setRoundThreeVars(step.store, truthHandles, guess, fits(prev) ? prev : null);
    }
    if (judged) {
      this.outcomes.set(index, ok);
      this.updateScoreVars(index, ok);
    }
    if (live) {
      this.callbacks.onAnswer?.({
        index,
        kind: "ask",
        id: this.answerId(index, step.store),
        question: step.question,
        given: answered ? [encodeGuess(guess)] : [],
        expected: encodeGuess(truthHandles.map((h) => h.truth)),
        correct: judged ? ok : true,
        ...(secs !== null ? { secs } : {}),
      });
    }
    const line = !judged ? (step.right ?? step.wrong) : ok ? step.right : (step.wrong ?? step.right);
    const market = truthHandles.length === 1 && truthHandles[0].kind === "market";
    const extra =
      live && answered && judged
        ? this.feedbackAfter(step, guessBand(score, step.tolerance ?? DEFAULT_TOLERANCE, market), { long: !market && isLong({ parts: score.count }), parts: truthHandles.map((h) => h.part) }, signal)
        : [];
    if (animIndex >= 0) {
      // The animate after this step is the reveal: it starts from the guess.
      this.predictCarry = { animIndex, step, setup, truthHandles, guess, owner, line, extra, live, answered, ok, judged };
      return;
    }
    // The feedback is spoken AS the figure moves to the truth, not after it:
    // waiting for the glide and then the voice left a gap after answering.
    const spoken = this.speakLines(line, extra, step, signal);
    if (step.revealStyle === "morph") {
      if (!(await this.revealGuess(setup, guess, paint, owner, signal))) return;
      this.applyKey(this.plan.states[index]);
      this.applyScene(this.plan.states[index]);
      this.effects?.setGuessMarks?.(owner, guessMarks(setup.handles, guess, 1));
    } else {
      // Beside (the default): yours stays, the truth arrives beside it.
      if (!(await this.revealBeside(setup, guess, paint, owner, signal, index, step.revealOrder ?? "all"))) return;
      this.applyKey(this.plan.states[index]);
      this.applyScene(this.plan.states[index]);
      this.effects?.setGuessMarks?.(owner, this.besides.get(owner)?.marks ?? null);
    }
    this.keepGuess(owner, index, step, guess, step.revealStyle === "morph" ? "morph" : "beside", fits(prev) ? prev : undefined);
    await spoken;
    if (live && answered && judged) {
      const target = ok ? step.rightGoto : step.wrongGoto;
      if (target !== undefined && this.plan.labels[target] !== undefined) this.pendingJump = this.plan.labels[target];
    }
  }

  /**
   * The given part of each sketched line that is not on screen yet, drawn
   * in point by point — as the line chart draws a series given prefix by
   * prefix (stages of growing length, the stage swept).
   */
  private async drawGivenIn(setup: GuessSetup, before: SceneState, visible: ReadonlySet<string>, signal: AbortSignal): Promise<void> {
    const rp = this.reprojector;
    if (!rp) return;
    const lines = setup.handles.filter((h) => h.kind === "curve" && h.rowPath && (h.given?.length ?? 0) >= 2 && !before.visible.includes(h.part));
    if (lines.length === 0) return;
    const sceneParams = this.paramsOf(before);
    if ("stage" in sceneParams) return; // a staged chart: its stages are the author's
    const overrides = this.overridesOf(before.offsets, before.turns, before.shapes, before.tex, before.copies);
    const m = Math.max(...lines.map((h) => h.given!.length));
    const prefixes: Record<string, unknown> = { ...setup.pin };
    for (const h of lines) prefixes[h.rowPath!] = h.given!.map((_, k) => h.given!.slice(0, k + 1).map((p) => p.v));
    await this.progress(GIVEN_DRAW_MS, signal, (t) => {
      rp.frame({ ...sceneParams, ...prefixes, stage: smoothstep(t) * (m - 1) }, this.frameScene(before, visible), { revealNew: true, overrides });
      this.geometryDirty = true;
    });
  }

  /** The next animate after step `index`, before any other question; -1 if none. */
  private nextAnimate(index: number): number {
    for (let j = index + 1; j < this.plan.steps.length; j++) {
      const k = this.plan.steps[j].kind;
      if (k === "animate") return j;
      if (k === "ask" || k === "quiz" || k === "label" || k === "if") return -1;
    }
    return -1;
  }

  /** Round-3 variables (spec 2026-10-02): how far a revise moved, and an
   *  allocation's shares and its biggest part. */
  private setRoundThreeVars(store: string, handles: GuessHandle[], guess: number[][], prev: number[][] | null): void {
    const base = store.toLowerCase();
    if (prev && handles.length === 1 && handles[0].truth.length === 1) {
      this.vars.set(`${base}.moved`, handles[0].format(Math.abs(guess[0][0] - prev[0][0])));
      this.vars.set(`${base}.before`, handles[0].format(prev[0][0]));
    }
    if (handles.length > 1 && handles.every((h) => h.truth.length === 1)) {
      let best = 0;
      handles.forEach((h, k) => {
        this.vars.set(`${base}.${h.part.toLowerCase()}`, h.format(guess[k][0]));
        if (guess[k][0] > guess[best][0]) best = k;
      });
      this.vars.set(`${base}.biggest`, handles[best].label);
    }
  }

  /**
   * Cards (specs 2026-10-01-rank-and-sort, 2026-10-02-more-ways-to-answer):
   * the viewer ranks, sorts, places, matches, compares or decides on the
   * drawn cards; the moving cards glide to their true places (the plan's
   * offsets after this step) with the misses marked, and right/wrong is
   * spoken as they move. A decision goes to its option's label.
   */
  private async cardsAsk(index: number, step: Extract<PlanStep, { kind: "ask" }>, signal: AbortSignal): Promise<void> {
    await this.narrationBarrier();
    if (signal.aborted || step.cards === undefined) return;
    const g = this.guess?.cards?.(step.cards) ?? null;
    if (!g) return;
    this.endGuessMarks(true, true);
    // A decision starts afresh (its branch state outlives the jump into the branch).
    if (g.mode === "decide") this.decideBranch = null;
    // Tiles into a formula's boxes (design 2026-10-03 §5.3): the marks are the
    // formula's, and stay until it is erased.
    const formula = g.mode === "fill" && step.formula !== undefined ? (this.guess?.formula?.(step.formula) ?? null) : null;
    const owner = formula ? `formula_${index}` : `cards_${index}`;
    // A formula's marks go with the formula, or with the tiles a beside reveal keeps on it.
    this.guessMarkParts.set(owner, formula ? [step.formula!, g.id] : [...g.cards, ...(g.valueIds ?? [])]);
    const start = initialArrangement(g);
    // A deck's dealt card is drawn larger, about where the card is drawn (round 6 §7).
    const place = (id: string, dx: number, dy: number, scale = 1): void => this.nudge(id, dx, dy, scale, g.home[g.cards.indexOf(id)]);
    const show = (ids: string[]): void => {
      for (const el of this.els(ids)) el.finish();
    };
    const mark = (m: GuessMarks | null): void => {
      this.guessOwners.add(owner);
      this.effects?.setGuessMarks?.(owner, m);
    };
    // The cards are the question: if the cast did not draw them first, the
    // question shows them (never a compare pair's numbers — those are the answer).
    // (Nor a deck's waiting cards: the deal shows each in turn.)
    const answerIds = new Set([...(g.valueIds ?? []), ...(g.deal ?? []).slice(1).map((i) => g.cards[i])]);
    show([...this.elements.keys()].filter((id) => id.startsWith(`${g.id}_`) && !answerIds.has(id)));
    const live = !this.autoAnswers && this.askGate !== null;
    let arrangement: Arrangement = start;
    let answered = false;
    let secs: number | null = null;
    if (live) {
      const from = performance.now();
      const typed = await this.askGate!(signal, Object.assign({}, step, { cardsSession: { geometry: g, start, place, show, mark } satisfies CardsSession }));
      if (signal.aborted) return;
      secs = (performance.now() - from) / 1000;
      const decoded = typed !== null ? decodeArrangement(g, typed) : null;
      if (decoded) {
        arrangement = decoded;
        answered = true;
      }
      if (typed !== null) this.cutQuestionVoice();
    } else if (g.mode === "compare") {
      // The movie: each pair in turn, the bigger one marked and both numbers shown.
      const picks = start.picks!.slice();
      for (let r = 0; r < (g.rows ?? []).length; r++) {
        await this.waitScaled(900, signal);
        if (signal.aborted) return;
        picks[r] = rightPick(g, r);
        show(g.rows![r].map((c) => g.valueIds![c]));
        mark(cardsMarks(g, { ...start, picks }));
      }
      arrangement = { ...start, picks };
      answered = true;
    } else if (g.mode === "decide") {
      // The movie taps the `default` option (or the first) and plays on.
      const want = (step.fallback ?? "").trim().toLowerCase();
      const k = Math.max(0, g.texts.findIndex((t) => t.toLowerCase() === want));
      const [x, y] = g.home[k];
      await this.tapAt({ x: x - g.w / 2, y: y - g.h / 2, w: g.w, h: g.h });
      arrangement = { ...start, choice: k };
      answered = true;
    } else if (g.mode === "fill") {
      // The movie: the right tiles glide into their boxes one by one.
      const boxes = start.boxes.map((b) => b.slice());
      for (let k = 0; k < g.binBoxes.length; k++) {
        const i = g.truthBin.indexOf(k);
        if (i < 0) continue;
        await this.waitScaled(300, signal);
        if (signal.aborted) return;
        const [hx, hy] = g.home[i];
        const [tx, ty] = g.binSlot(k, 0);
        await this.progress(600, signal, (t) => {
          const e = smoothstep(t);
          place(g.cards[i], (tx - hx) * e, (ty - hy) * e);
        });
        if (signal.aborted) return;
        boxes[k] = [i];
      }
      arrangement = { ...start, boxes };
      answered = true;
    } else if (g.deck && g.deal) {
      // The movie (round 6 §7): the cards go to their boxes one by one, each
      // dealt large and flown small — never a wait, however many there are.
      const boxes = start.boxes.map((b) => b.slice());
      const ms = deckCardMs(g.cards.length);
      const [cx, cy] = g.home[g.deal[0]];
      for (const i of g.deal) {
        const [hx, hy] = g.home[i];
        const [tx, ty] = g.truth[i];
        show([g.cards[i]]);
        await this.progress(ms, signal, (t) => {
          const f = deckFlight(t, g.deckScale ?? 1);
          place(g.cards[i], cx - hx + (tx - cx) * f.along, cy - hy + (ty - cy) * f.along, f.scale);
        });
        if (signal.aborted) return;
        boxes[g.truthBin[i]]?.push(i);
      }
      arrangement = { ...start, boxes };
      answered = true;
    } else {
      // The movie: a breath on the cards as drawn, then the truth.
      await this.waitScaled(900, signal);
      if (signal.aborted) return;
    }
    if (this.narrationVoice) await this.narrationVoice;
    if (signal.aborted) return;

    const judged = g.mode !== "decide" || (g.best ?? []).some(Boolean);
    const score = scoreCards(g, arrangement, step.tolerance ?? 0);
    const ok = answered && score.ok;
    const choice = arrangement.choice ?? -1;
    // A formula's tiles: what each box holds, as the blank's answer.
    const tileIn = g.binBoxes.map((_, k) => {
      const card = arrangement.boxes[k]?.[0];
      return card !== undefined ? g.texts[card] : null;
    });
    const text = g.mode === "decide" ? (choice >= 0 ? g.texts[choice] : "") : formula && formula.blanks.length === 1 ? (tileIn[0] ?? "") : `${score.within} of ${score.count}`;
    this.recordAnswer(index, step.store, text, judged ? ok : null, secs);
    if (formula && step.store) this.setFormulaVars(step.store, formula.blanks, tileIn);
    if (step.store) {
      const base = step.store.toLowerCase();
      this.vars.set(`${base}.within`, String(score.within));
      this.vars.set(`${base}.count`, String(score.count));
      const off = g.mode === "place" ? placeOff(g, arrangement) : null;
      if (off !== null && g.scale) {
        // A distance is a number of units, never a year: "40 years", "40".
        const n = off >= 10 ? Math.round(off) : Math.round(off * 10) / 10;
        const u = g.scale.unit;
        this.vars.set(`${base}.off`, u === "" ? String(n) : u === "%" ? `${n}%` : `${n} ${u}`);
      }
    }
    if (judged) {
      this.outcomes.set(index, ok);
      this.updateScoreVars(index, ok);
    }
    if (live) {
      this.callbacks.onAnswer?.({
        index,
        kind: "ask",
        id: this.answerId(index, step.store),
        question: step.question,
        given: answered ? [encodeArrangement(g, arrangement)] : [],
        expected: encodeArrangement(g, cardsTruth(g)),
        correct: judged ? ok : true,
        ...(secs !== null ? { secs } : {}),
      });
    }
    const line = !judged ? (step.right ?? step.wrong) : ok ? step.right : (step.wrong ?? step.right);
    // Where the viewer left the cards (in their bins, their slots) — the
    // reward bursts from there, not from the cards' home row.
    const from = positions(g, arrangement);
    const shift: Record<string, Pt> = {};
    g.cards.forEach((id, i) => (shift[id] = [from[i][0] - g.home[i][0], from[i][1] - g.home[i][1]]));
    const extra =
      live && answered && judged
        ? this.feedbackAfter(step, bandOf({ ok, within: score.within, count: score.count }), { long: isLong({ items: score.count }), parts: formula ? [step.formula!] : g.cards, ...(formula ? {} : { shift }) }, signal)
        : [];
    const spoken = this.speakLines(line, extra, step, signal);
    // Beside (the default, spec 2026-10-03-round6 §3): an answer stays where
    // the viewer left it, ✓/✗ on each card and the truth in ink beside. A
    // skipped question (and a movie's breath on the cards as drawn) has no
    // answer to keep: its cards glide to the truth, as with morph. Tiles in a
    // formula's boxes stay in them too, the truth written into the boxes.
    const beside = step.revealStyle !== "morph" && answered;
    // Tiles the viewer put in a box (the answer): kept on screen beside a formula's truth.
    const placedTiles = formula ? g.cards.filter((_, i) => arrangement.boxes.some((b) => b.includes(i))) : [];
    // The cards that move glide from where the viewer left them to the truth.
    const moves = !beside && g.cards.some((_, i) => Math.abs(from[i][0] - g.truth[i][0]) > 0.5 || Math.abs(from[i][1] - g.truth[i][1]) > 0.5);
    if (moves) {
      await this.progress(GUESS_REVEAL_MS, signal, (t) => {
        const e = smoothstep(t);
        g.cards.forEach((id, i) => {
          const x = from[i][0] + (g.truth[i][0] - from[i][0]) * e - g.home[i][0];
          const y = from[i][1] + (g.truth[i][1] - from[i][1]) * e - g.home[i][1];
          place(id, x, y);
        });
      });
      for (const id of g.cards) place(id, 0, 0);
      if (signal.aborted) {
        this.endGuessMarks(true);
        return;
      }
    }
    // The right tiles are in their boxes: their glyphs are written in (the
    // plan takes the tiles and the boxes away). The wrong tiles, home again,
    // fade out first: no tile stays to the end of the cast.
    if (formula) this.setFills(step.formula!, formula.blanks.map((b) => b.tex));
    // Beside: the tiles left in the row go; morph: the wrong tiles, home again, go.
    const leaving = formula ? this.els(g.cards.filter((id, i) => (beside ? !placedTiles.includes(id) : g.truthBin[i] < 0))) : [];
    if (leaving.length > 0) {
      await this.progress(TILE_FADE_MS, signal, (t) => leaving.forEach((el) => el.setOpacity?.(1 - t)));
      if (signal.aborted) {
        leaving.forEach((el) => el.setOpacity?.(1));
        this.endGuessMarks(true);
        return;
      }
    }
    if (beside) {
      // The cards stay put: the gate's nudges off, the beside offsets hold them where they stand.
      // Every card, the unmoved ones too: the plan has them all at the truth.
      const offsets: Record<string, Pt> = {};
      g.cards.forEach((id, i) => (offsets[id] = [from[i][0] - g.home[i][0], from[i][1] - g.home[i][1]]));
      for (const id of g.cards) place(id, 0, 0);
      this.putBeside(owner, { index, marks: null, faded: false, offsets, ...(placedTiles.length > 0 ? { shown: placedTiles } : {}) });
    }
    this.applyKey(this.plan.states[index]);
    // Hidden now: their own opacity back, for a replay that draws them again.
    leaving.forEach((el) => el.setOpacity?.(1));
    this.applyScene(this.plan.states[index]);
    if (beside) {
      const tolerance = step.tolerance ?? 0;
      const n = cardsParts(g);
      if (step.revealOrder === "each") {
        for (let k = 1; k < n; k++) {
          mark(cardsBeside(g, arrangement, { upTo: k, tolerance }));
          await this.waitScaled(EACH_MS, signal);
          if (signal.aborted) return;
        }
      }
      const marks = cardsBeside(g, arrangement, { tolerance });
      mark(marks);
      const b = this.besides.get(owner);
      if (b) b.marks = marks;
    } else if (answered) mark(cardsMarks(g, arrangement));
    await spoken;
    if (signal.aborted) return;
    if (g.mode === "decide" && choice >= 0) {
      // Live: to the chosen branch; the others are skipped on the way to `then`.
      const go = g.gotos?.[choice];
      if (live && go !== undefined && this.plan.labels[go] !== undefined) {
        this.pendingJump = this.plan.labels[go];
        this.decideBranch = { labels: (g.gotos ?? []).filter((l): l is string => l !== undefined), chosen: go, then: g.then };
      }
      return;
    }
    if (live && answered && judged) {
      const target = ok ? step.rightGoto : step.wrongGoto;
      if (target !== undefined && this.plan.labels[target] !== undefined) this.pendingJump = this.plan.labels[target];
    }
  }

  /** The option a movie (or a skipped question) stands in with: `default`, else the answer, else the first. */
  private static chooseDefault(step: Extract<PlanStep, { kind: "ask" }>): ChooseOption | undefined {
    const opts = step.choose ?? [];
    const find = (want: string | undefined): ChooseOption | undefined =>
      want === undefined ? undefined : opts.find((o) => o.id.toLowerCase() === want.trim().toLowerCase());
    return find(step.fallback) ?? find(step.answer) ?? opts[0];
  }

  /**
   * Choose on the figure (spec 2026-10-03-round6 §4): the options are drawn
   * things and the viewer taps one. With `answer` it is judged (the answer
   * glows green when found, in the highlight colour when revealed); with
   * `judge: false` (or no answer) it is an opinion; an option's `goto`
   * branches like a decide card, meeting again at `then`. {store} is the
   * tapped thing's label, {store.id} its id. The movie's laser taps `default`,
   * else the answer, else the first option, and plays on.
   */
  private async chooseAsk(index: number, step: Extract<PlanStep, { kind: "ask" }>, signal: AbortSignal): Promise<void> {
    await this.narrationBarrier();
    if (signal.aborted) return;
    const opts = step.choose ?? [];
    if (opts.some((o) => o.goto !== undefined)) this.decideBranch = null; // only a branching choose starts afresh: one inside a branch keeps it
    const live = !this.autoAnswers && this.askGate !== null;
    const judged = step.answer !== undefined && step.judge !== false;
    let picked: ChooseOption | undefined;
    let secs: number | null = null;
    if (live) {
      const from = performance.now();
      const typed = await this.askGate!(signal, step);
      if (signal.aborted) return;
      secs = (performance.now() - from) / 1000;
      picked = typed === null ? undefined : opts.find((o) => o.id.toLowerCase() === typed.trim().toLowerCase());
      if (typed !== null) this.cutQuestionVoice();
    } else {
      picked = Player.chooseDefault(step);
      if (picked?.box && this.effects) await this.tapAt(picked.box, 1400);
      else await this.waitScaled(1200, signal);
      if (signal.aborted) return;
    }
    if (this.narrationVoice) await this.narrationVoice;
    if (signal.aborted) return;

    const answerOpt = judged ? opts.find((o) => answersMatch(o.id, step.answer!)) : undefined;
    const ok = judged && picked !== undefined && picked === answerOpt;
    // A skip stores what the movie would: the default's words.
    const stands = picked ?? Player.chooseDefault(step);
    this.recordAnswer(index, step.store, stands?.label ?? "", judged ? ok : null, secs);
    if (step.store) this.vars.set(`${step.store.toLowerCase()}.id`, stands?.id ?? "");
    if (judged) {
      this.outcomes.set(index, ok);
      this.updateScoreVars(index, ok);
    }
    if (live) {
      this.callbacks.onAnswer?.({
        index,
        kind: "ask",
        id: this.answerId(index, step.store),
        question: step.question,
        given: picked ? [picked.id] : [],
        expected: step.answer ?? "",
        correct: judged ? ok : true,
        ...(secs !== null ? { secs } : {}),
      });
    }

    if (judged && answerOpt) {
      const extra = live && picked ? this.feedbackAfter(step, ok ? "perfect" : "none", { parts: answerOpt.members, sparkle: !ok }, signal) : [];
      if (ok) {
        await this.glowWhile(live ? [{ ids: answerOpt.members, color: ANSWER_OK_COLOR }] : [], signal, () => this.speakLines(step.right, extra, step, signal));
      } else {
        if (picked && step.wrong) await this.speakLine(step.wrong, step, signal);
        if (signal.aborted) return;
        if (step.reveal) await this.glowWhile(live ? [{ ids: answerOpt.members }] : [], signal, () => this.speakLines(step.right ?? answerOpt.label, extra, step, signal));
        else if (extra.length > 0) await this.speakLines(null, extra, step, signal);
      }
      if (signal.aborted) return;
      if (live && picked) {
        const target = ok ? step.rightGoto : step.wrongGoto;
        if (target !== undefined && this.plan.labels[target] !== undefined) this.pendingJump = this.plan.labels[target];
      }
    } else {
      // An opinion or a branch: its line is spoken whatever was chosen.
      const line = step.right ?? step.wrong;
      if (line) await this.glowWhile(live && picked ? [{ ids: picked.members }] : [], signal, () => this.speakLines(line, [], step, signal));
      if (signal.aborted) return;
    }
    // Live: to the chosen branch; the others are skipped on the way to `then`.
    if (live && picked?.goto !== undefined && this.plan.labels[picked.goto] !== undefined) {
      this.pendingJump = this.plan.labels[picked.goto];
      this.decideBranch = { labels: opts.map((o) => o.goto).filter((l): l is string => l !== undefined), chosen: picked.goto, ...(step.then !== undefined ? { then: step.then } : {}) };
    }
  }

  /**
   * A formula to fill by typing (design 2026-10-03 §5.3–5.4): a number box
   * or an AsciiMath-style field per blank, the answer drawn into the box as
   * it is typed (`fills`, in the guess colour); scored by value (or by form,
   * `form: "exact"`); the truths written into the boxes as right/wrong is
   * spoken, a wrong answer struck through above its box. (Tiles go through
   * cardsAsk: the plan makes that ask a cards ask too.)
   */
  private async formulaAsk(index: number, step: Extract<PlanStep, { kind: "ask" }>, before: SceneState, signal: AbortSignal): Promise<void> {
    await this.narrationBarrier();
    if (signal.aborted || step.formula === undefined) return;
    const id = step.formula;
    const rt = this.guess?.formula?.(id) ?? null;
    const rp = this.reprojector;
    if (!rt || !rp || rt.blanks.length === 0) {
      console.warn(`[formula] "${id}" has no blanks to fill; the question is skipped`);
      return;
    }
    this.endGuessMarks(true);
    const { blanks } = rt;
    const owner = `formula_${index}`;
    this.guessMarkParts.set(owner, [id]);
    const after = this.plan.states[index];
    const visible = new Set([...before.visible, ...after.visible]);
    const sceneParams = this.paramsOf(before);
    const overrides = this.overridesOf(before.offsets, before.turns, before.shapes, before.tex, before.copies);
    const base = rp.patchedElements?.();
    // What each box shows: the last typing that parsed (a half-typed `r^`
    // keeps `r` there rather than blinking out).
    const shown: (string | null)[] = blanks.map(() => null);
    const show = (texts: (string | null)[]): boolean[] => {
      const ok = blanks.map((b, k) => {
        const f = typedFill(b, texts[k] ?? null);
        if (f === undefined) return false;
        shown[k] = f === null ? null : guessFill(f);
        return true;
      });
      this.painted = rp.frame(sceneParams, this.frameScene(before, visible), { revealNew: true, overrides, elements: rt.patch(shown.slice(), base) }) || null;
      this.geometryDirty = true;
      return ok;
    };
    const boxOf = (k: number): BBox | null => rt.boxes(this.paintedLayout())[k] ?? null;

    let texts: (string | null)[] = blanks.map(() => null);
    show(texts);
    const live = !this.autoAnswers && this.askGate !== null;
    let answered = false;
    let secs: number | null = null;
    if (live) {
      const from = performance.now();
      const typed = await this.askGate!(signal, Object.assign({}, step, { formulaSession: { blanks, boxOf, show } satisfies FormulaSession }));
      if (signal.aborted) return;
      secs = (performance.now() - from) / 1000;
      const decoded = typed !== null ? decodeFormulaTexts(typed, blanks.length) : null;
      if (decoded) {
        texts = decoded;
        answered = true;
      }
      if (typed !== null) this.cutQuestionVoice();
    } else {
      // The movie: each blank's truth typed in, a character at a time.
      for (let k = 0; k < blanks.length; k++) {
        const truth = typedTruth(blanks[k]);
        if (truth === null) continue;
        for (let c = 1; c <= truth.length; c++) {
          await this.waitScaled(40, signal);
          if (signal.aborted) return;
          texts = texts.slice();
          texts[k] = truth.slice(0, c);
          show(texts);
        }
        await this.waitScaled(250, signal);
        if (signal.aborted) return;
      }
      answered = true;
    }
    if (this.narrationVoice) await this.narrationVoice;
    if (signal.aborted) return;

    const right = blanks.map((b, k) => {
      const t = texts[k];
      return t !== null && t.trim() !== "" && typedRight(b, t, step.form, step.tolerance ?? 0.02);
    });
    const within = right.filter(Boolean).length;
    const ok = answered && within === blanks.length;
    this.recordAnswer(index, step.store, blanks.length === 1 ? (texts[0] ?? "") : `${within} of ${blanks.length}`, ok, secs);
    if (step.store) this.setFormulaVars(step.store, blanks, texts, right);
    this.outcomes.set(index, ok);
    this.updateScoreVars(index, ok);
    if (live) {
      this.callbacks.onAnswer?.({
        index,
        kind: "ask",
        id: this.answerId(index, step.store),
        question: step.question,
        given: answered ? [JSON.stringify(texts)] : [],
        expected: JSON.stringify(blanks.map((b) => b.tex)),
        correct: ok,
        ...(secs !== null ? { secs } : {}),
      });
    }

    // The reveal, as the line is spoken: the truths written into the boxes
    // (the plan takes the boxes away), each wrong answer struck through above.
    const line = ok ? step.right : (step.wrong ?? step.right);
    const extra = live && answered ? this.feedbackAfter(step, bandOf({ ok, within, count: blanks.length }), { long: isLong({ parts: blanks.length }), parts: [id] }, signal) : [];
    const spoken = this.speakLines(line, extra, step, signal);
    this.setFills(id, blanks.map((b) => b.tex));
    this.applyKey(after);
    this.applyScene(after);
    // Where the boxes stand with the truth written in (the preview's were
    // sized to the viewer's typing): the struck-through answers go over these.
    const boxes = blanks.map((_, k) => boxOf(k));
    const lines: GuessMarkLine[] = [];
    const words: GuessMarkText[] = [];
    blanks.forEach((_, k) => {
      const t = texts[k]?.trim();
      const box = boxes[k];
      if (right[k] || !t || !box) return;
      const m = struckAbove({ c: [box.x + box.w / 2, box.y + box.h / 2], h: box.h }, t);
      words.push(m.text);
      lines.push(m.line);
    });
    if (step.revealStyle !== "morph" && answered) {
      // Beside (spec 2026-10-03-round6 §3): a ✓ or ✗ by each box — box by box with reveal_order each.
      const marksUpTo = (n: number): GuessMarks => ({
        color: GUESS_COLOR,
        lines,
        texts: [...words, ...boxes.flatMap((box, k) => (box && k < n ? [tick([box.x + box.w + 16, box.y + box.h / 2], right[k], "middle")] : []))],
      });
      if (step.revealOrder === "each") {
        for (let k = 1; k < blanks.length; k++) {
          this.guessOwners.add(owner);
          this.effects?.setGuessMarks?.(owner, marksUpTo(k));
          await this.waitScaled(EACH_MS, signal);
          if (signal.aborted) return;
        }
      }
      const marks = marksUpTo(blanks.length);
      this.guessOwners.add(owner);
      this.effects?.setGuessMarks?.(owner, marks);
      this.putBeside(owner, { index, marks, faded: false });
    } else if (words.length > 0) {
      this.guessOwners.add(owner);
      this.effects?.setGuessMarks?.(owner, { color: GUESS_COLOR, lines, texts: words });
    }
    await spoken;
    if (signal.aborted) return;
    if (live && answered) {
      const target = ok ? step.rightGoto : step.wrongGoto;
      if (target !== undefined && this.plan.labels[target] !== undefined) this.pendingJump = this.plan.labels[target];
    }
  }

  /** A formula ask's stored answers (design 2026-10-03 §5.4): `{f.<k>}` and
   *  `{f.<k>.true}` per blank, `{f.true}` (the truths, comma-joined when
   *  several), and with `right`, `{f.within}` / `{f.count}`. */
  private setFormulaVars(store: string, blanks: FormulaBlank[], given: (string | null)[], right?: boolean[]): void {
    const base = store.toLowerCase();
    blanks.forEach((b, k) => {
      this.vars.set(`${base}.${b.k}`, given[k] ?? "");
      this.vars.set(`${base}.${b.k}.true`, b.tex);
    });
    this.vars.set(`${base}.true`, blanks.map((b) => b.tex).join(", "));
    if (right) {
      this.vars.set(`${base}.within`, String(right.filter(Boolean).length));
      this.vars.set(`${base}.count`, String(blanks.length));
    }
  }

  /** What a formula's boxes show for the rest of the cast (null: empty
   *  again), mirrored here so a seek can put it back (restoreFormulaFills). */
  private fillsShown = new Map<string, string[]>();
  private setFills(id: string, fills: string[] | null): void {
    const cur = this.fillsShown.get(id);
    if (fills === null ? cur === undefined : cur !== undefined && JSON.stringify(cur) === JSON.stringify(fills)) return;
    if (fills === null) this.fillsShown.delete(id);
    else this.fillsShown.set(id, fills);
    this.reprojector?.setElementPatch?.(id, fills === null ? null : { fills });
    this.geometryDirty = true;
  }

  /** The boxes as boundary `n` has them: every formula asked before it shows
   *  its truths (the reveal wrote them in, answered or not); any other is empty. */
  private restoreFormulaFills(n: number): void {
    const want = new Map<string, string[]>();
    for (let i = 0; i < Math.min(n, this.plan.steps.length); i++) {
      const s = this.plan.steps[i];
      if (s.kind !== "ask" || s.formula === undefined) continue;
      const rt = this.guess?.formula?.(s.formula);
      if (rt) want.set(s.formula, rt.blanks.map((b) => b.tex));
    }
    for (const id of [...this.fillsShown.keys()]) if (!want.has(id)) this.setFills(id, null);
    for (const [id, fills] of want) this.setFills(id, fills);
  }

  /**
   * A tree to fill (spec 2026-10-03 §4): the viewer types the numbers the
   * blanks hide and/or taps the best branch; the true numbers are written in
   * from the right of the tree to the left (deepest first), with the working
   * line under each wrong blank, while right/wrong is spoken.
   */
  private async treeAsk(index: number, step: Extract<PlanStep, { kind: "ask" }>, before: SceneState, signal: AbortSignal): Promise<void> {
    await this.narrationBarrier();
    if (signal.aborted || !step.tree) return;
    const rt = this.guess?.tree?.() ?? null;
    const rp = this.reprojector;
    if (!rt || !rp) {
      console.warn("[tree] a tree ask needs a decision_tree figure; the question is skipped");
      return;
    }
    // The tree as it stands at this boundary (an animate may have moved a probability).
    const sceneParams = this.paramsOf(before);
    const tplOverrides: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(sceneParams)) if (!k.startsWith("vars.")) tplOverrides[k] = v;
    const params = withOverrides(rt.params as unknown as Record<string, unknown>, tplOverrides) as unknown as DecisionTreeParams;
    const { blanks, issues } = treeBlanks(params, step.tree.blanks);
    const picked = step.tree.pick !== undefined ? treePick(params, step.tree.pick) : null;
    if (typeof picked === "string") issues.push(picked);
    for (const w of issues) console.warn(`[tree] ${w}`);
    const pick: TreePick | null = typeof picked === "string" ? null : picked;
    if (issues.length > 0 || (blanks.length === 0 && !pick)) return;
    // Earlier guesses' ghosts go; earlier tree asks' working lines stay.
    this.endGuessMarks(true);

    // Numbers as the tree draws them: what is said matches what is written.
    const treeText = treeNumberText(params);
    const fmt = (v: number, b: TreeBlank): string => treeText(v, b.kind);
    const fmtNum = (v: number): string => treeText(v, "value");
    const after = this.plan.states[index];
    // A decision's best and prune marks give its answer away: hidden while
    // asked (the picked decision's, and those of a decision whose value is a
    // blank), drawn in at the reveal (spec §4.3).
    // Matched exactly, child by child: a prefix `best_start_` would also
    // catch a decision `start_2`'s marks.
    const told = new Set([...(pick ? [pick.node] : []), ...blanks.filter((b) => b.kind === "value").map((b) => b.node)]);
    const marksOf = new Set<string>();
    walkTree(params.root, (_n, id, _b, parent) => {
      if (parent !== undefined && told.has(parent)) marksOf.add(`best_${parent}_${id}`).add(`prune_${parent}_${id}`);
    });
    const givesAway = (id: string): boolean => marksOf.has(id);
    const hidden = [...new Set([...before.visible, ...after.visible])].filter(givesAway);
    const visible = new Set([...before.visible, ...after.visible].filter((id) => !givesAway(id)));
    const overrides = this.overridesOf(before.offsets, before.turns, before.shapes, before.tex, before.copies);
    // What the blanks show: "?", a typed number, or (dropped) the truth.
    // Later tree asks' blanks stay "?" throughout (the boundary's own answers).
    const own = new Set(blanks.map((b) => b.part));
    const later = Object.fromEntries(Object.entries(before.answers ?? {}).filter(([k]) => !own.has(k)));
    let answers: Record<string, string> = {};
    const paintAnswers = (): void => {
      const all = { ...later, ...answers };
      const { answers: _boundary, ...rest } = sceneParams;
      const p = Object.keys(all).length > 0 ? { ...rest, answers: all } : rest;
      this.painted = rp.frame(p, this.frameScene(before, visible), { revealNew: true, overrides }) || null;
      this.geometryDirty = true;
    };
    const show = (values: (number | null)[]): void => {
      answers = Object.fromEntries(blanks.map((b, i) => [b.part, values[i] === null || values[i] === undefined || !Number.isFinite(values[i]) ? "?" : fmt(values[i]!, b)]));
      paintAnswers();
    };
    const boxOf = (part: string): BBox | null => rt.boxes?.(this.paintedLayout()).get(part) ?? null;
    const edgePts = rt.edges?.(this.paintedLayout()) ?? {};
    const edges: Record<string, Pt[]> = {};
    for (const o of pick?.options ?? []) if (edgePts[o.edge]) edges[o.id] = edgePts[o.edge];
    const owner = `tree_${index}`;
    this.guessMarkParts.set(owner, [...blanks.map((b) => b.part), ...(pick?.options.map((o) => o.edge) ?? [])]);

    let values: (number | null)[] = blanks.map(() => null);
    show(values);
    const live = !this.autoAnswers && this.askGate !== null;
    let chosen: string | null = null;
    let answered = false;
    let secs: number | null = null;
    if (live) {
      const from = performance.now();
      const typed = await this.askGate!(signal, Object.assign({}, step, { treeSession: { blanks, pick, boxOf, show, edges } satisfies TreeSession }));
      if (signal.aborted) return;
      secs = (performance.now() - from) / 1000;
      const decoded = typed !== null ? decodeTreeAnswer(typed, blanks.length) : null;
      if (decoded) {
        values = decoded.values;
        chosen = decoded.pick !== null && pick?.options.some((o) => o.id === decoded.pick) ? decoded.pick : null;
        answered = true;
      }
      if (typed !== null) this.cutQuestionVoice();
    } else {
      // The movie: each "?" is written in with the true value, then the
      // laser taps the best branch.
      for (let i = 0; i < blanks.length; i++) {
        await this.waitScaled(300, signal);
        if (signal.aborted) return;
        values = values.slice();
        values[i] = blanks[i].truth;
        show(values);
      }
      if (pick) {
        const pts = edges[pick.best];
        if (pts && pts.length > 0) {
          const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
          await this.tapAt({ x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) });
        } else await this.waitScaled(600, signal);
        if (signal.aborted) return;
        chosen = pick.best;
      }
      answered = true;
    }
    if (this.narrationVoice) await this.narrationVoice;
    if (signal.aborted) return;

    // Scored and stored before the line is spoken, so it may use {e.work}.
    const score = scoreBlanks(blanks, values, step.tolerance ?? 0.02);
    const pickRight = pick ? chosen === pick.best : null;
    const ok = answered && score.ok && (pickRight ?? true);
    const labelOf = (id: string | null): string => pick?.options.find((o) => o.id === id)?.label ?? "";
    const text = blanks.length === 1
      ? (values[0] !== null ? fmt(values[0], blanks[0]) : "")
      : blanks.length === 0
        ? labelOf(chosen)
        : `${score.within} of ${score.count}`;
    this.recordAnswer(index, step.store, text, ok, secs);
    if (step.store) {
      const base = step.store.toLowerCase();
      const set = (k: string, v: string | null): void => {
        if (v === null) this.vars.delete(k);
        else this.vars.set(k, v);
      };
      blanks.forEach((b, i) => {
        const key = `${base}.${b.part.toLowerCase()}`;
        set(key, values[i] !== null ? fmt(values[i]!, b) : "");
        set(`${key}.true`, fmt(b.truth, b));
      });
      if (blanks.length === 1) set(`${base}.true`, fmt(blanks[0].truth, blanks[0]));
      else if (blanks.length === 0 && pick) set(`${base}.true`, labelOf(pick.best));
      const firstWrong = blanks.find((_, i) => !score.right[i] && blanks[i].work !== null);
      set(`${base}.work`, blanks.length === 1 ? blanks[0].work : (firstWrong?.work ?? null));
      set(`${base}.within`, String(score.within));
      set(`${base}.count`, String(score.count));
      if (pick) {
        set(`${base}.pick`, labelOf(chosen));
        set(`${base}.pick.true`, labelOf(pick.best));
        // How much better the best is: the margin, or what a wrong pick cost;
        // a cost or a net benefit as money, as the tree writes it.
        const diff = pickDiff(pick, chosen);
        set(`${base}.diff`, diff === null ? null : pick.measure === "value" ? fmtNum(diff) : treeText(diff, "cost"));
      }
    }
    this.outcomes.set(index, ok);
    this.updateScoreVars(index, ok);
    if (live) {
      this.callbacks.onAnswer?.({
        index,
        kind: "ask",
        id: this.answerId(index, step.store),
        question: step.question,
        given: answered ? [encodeTreeAnswer(values, chosen)] : [],
        expected: encodeTreeAnswer(blanks.map((b) => b.truth), pick?.best ?? null),
        correct: ok,
        ...(secs !== null ? { secs } : {}),
      });
    }

    // The reveal, as the line is spoken: the truths written in from the
    // right of the tree to the left, then the working lines and the miss.
    const line = ok ? step.right : (step.wrong ?? step.right);
    // Counted: each blank, and the pick as one more.
    const counted = score.count + (pick ? 1 : 0);
    const extra =
      live && answered
        ? this.feedbackAfter(step, bandOf({ ok, within: score.within + (pickRight ? 1 : 0), count: counted }), { long: isLong({ parts: counted }), parts: blanks.map((b) => b.part) }, signal)
        : [];
    const spoken = this.speakLines(line, extra, step, signal);
    const order = blanks.map((b, i) => ({ b, i })).sort((a, z) => z.b.depth - a.b.depth);
    const beside = step.revealStyle !== "morph";
    for (const { b } of order) {
      if (answers[b.part] === undefined) continue;
      const { [b.part]: _gone, ...rest } = answers;
      answers = rest;
      paintAnswers();
      await this.waitScaled(beside && step.revealOrder === "each" ? EACH_MS : 300, signal);
      if (signal.aborted) return;
    }
    this.applyKey(after);
    this.applyScene(after);
    // The best and prune marks draw themselves in.
    const drawIn = this.els(hidden.filter((id) => after.visible.includes(id)));
    if (drawIn.length > 0) {
      for (const el of drawIn) el.setProgress(0);
      await this.progress(600, signal, (t) => {
        for (const el of drawIn) el.setProgress(t);
      });
      for (const el of drawIn) el.finish();
      if (signal.aborted) return;
    }
    // No marks of its own (rollback off): a solid ring round the best branch is the reveal.
    const bestEdge = pick && !after.visible.some((id) => id.startsWith(`best_${pick.node}_`)) ? edges[pick.best] : undefined;
    const marks = this.treeMarks(blanks, score.right, step.tree.work, boxOf, !live, pick && chosen !== null && !pickRight ? edges[chosen] : undefined, bestEdge, beside && answered);
    if (marks) {
      this.guessOwners.add(owner);
      this.effects?.setGuessMarks?.(owner, marks);
    }
    await spoken;
    if (signal.aborted) return;
    if (live && answered) {
      const target = ok ? step.rightGoto : step.wrongGoto;
      if (target !== undefined && this.plan.labels[target] !== undefined) this.pendingJump = this.plan.labels[target];
    }
  }

  /** A tree ask's marks: the working line under each wrong blank (or every
   *  blank with work "all"; none with work false, and in a movie under the
   *  first), a dashed box around a wrong number, a dashed ring round a
   *  wrongly picked branch. Null when there is nothing to mark. */
  private treeMarks(blanks: TreeBlank[], right: boolean[], work: "all" | false | undefined, boxOf: (part: string) => BBox | null, movie: boolean, wrongEdge: Pt[] | undefined, bestEdge?: Pt[], verdicts = false): GuessMarks | null {
    const lines: GuessMarkLine[] = [];
    const texts: GuessMarkText[] = [];
    blanks.forEach((b, i) => {
      const box = boxOf(b.part);
      if (!box) return;
      const wrong = !right[i];
      const withWork = work !== false && (work === "all" || wrong || (movie && i === 0));
      if (withWork && b.work) texts.push({ at: [box.x + box.w / 2, box.y - 14], text: b.work, anchor: "middle" });
      if (wrong) {
        const p = 4;
        lines.push({ pts: [[box.x - p, box.y - p], [box.x + box.w + p, box.y - p], [box.x + box.w + p, box.y + box.h + p], [box.x - p, box.y + box.h + p]], closed: true, dashed: true, ...(verdicts ? { color: WRONG } : {}) });
      }
      // Beside (spec 2026-10-03-round6 §3): a ✓ or ✗ by each blank.
      if (verdicts) texts.push(tick([box.x + box.w + 14, box.y + box.h / 2], !wrong, "middle", 22));
    });
    // A capsule round a branch: its two sides, 10 off the line — dashed
    // round a wrong choice, solid round the best one.
    const capsule = (edge: Pt[] | undefined, dashed: boolean): void => {
      if (!edge || edge.length < 2) return;
      const a = edge[0], z = edge[edge.length - 1];
      const len = Math.hypot(z[0] - a[0], z[1] - a[1]) || 1;
      const nx = (-(z[1] - a[1]) / len) * 10, ny = ((z[0] - a[0]) / len) * 10;
      lines.push({ pts: [[a[0] + nx, a[1] + ny], [z[0] + nx, z[1] + ny], [z[0] - nx, z[1] - ny], [a[0] - nx, a[1] - ny]], closed: true, dashed });
    };
    capsule(wrongEdge, true);
    capsule(bestEdge, false);
    return lines.length > 0 || texts.length > 0 ? { color: GUESS_COLOR, lines, texts } : null;
  }

  /** Take off the marks of every guess whose parts these ids take away. */
  private endGuessMarksFor(ids: readonly string[]): void {
    for (const [owner, parts] of this.guessMarkParts) {
      if (!this.guessOwners.has(owner)) continue;
      if (!touches(ids, parts)) continue;
      this.effects?.setGuessMarks?.(owner, null);
      this.guessOwners.delete(owner);
      this.kept.delete(owner);
      // Erased or hidden with its figure: the room it kept goes at the next commit.
      this.dropBeside(owner);
    }
  }

  /** Take every guess ghost off the figure. `keepTrees`: a tree's working
   *  lines and a formula's struck-through answers stay (spec 2026-10-03
   *  §4.2, §5.4: until the tree or the formula is erased — the next question
   *  does not take them). `settle`: a beside reveal's room taken away (the
   *  bars whole again, the cards at their places) is put on screen now — a
   *  question starting at the boundary; a scrub commits its own. With
   *  `keepTrees`, a kept guess (spec round 6 §5) stays too, unless `asked`
   *  — the parts the new question is about — touch its own. */
  private endGuessMarks(keepTrees = false, settle = false, asked: readonly string[] = []): void {
    let dropped = false;
    for (const owner of [...this.guessOwners]) {
      if (keepTrees && (owner.startsWith("tree_") || owner.startsWith("formula_"))) continue;
      const base = ownerBase(owner);
      if (keepTrees && this.kept.has(base) && !touches(asked, this.guessMarkParts.get(base) ?? [])) continue;
      this.effects?.setGuessMarks?.(owner, null);
      this.guessOwners.delete(owner);
      this.kept.delete(owner);
      dropped = this.dropBeside(owner) || dropped;
    }
    if (dropped && settle) this.settleBesides();
  }

  /** Forget a beside reveal's room; true when it kept any. The template is
   *  committed afresh at the next boundary (pendingSettle) unless the caller
   *  commits first (a seek, the next question). */
  private dropBeside(owner: string): boolean {
    const b = this.besides.get(owner);
    if (!b) return false;
    this.besides.delete(owner);
    for (const id of Object.keys(b.styles ?? {})) this.reprojector?.setElementPatch?.(id, null);
    if (b.params || b.styles) this.geometryDirty = true;
    const room = b.params !== undefined || b.offsets !== undefined || b.shown !== undefined || b.styles !== undefined;
    if (room) this.pendingSettle = true;
    return room;
  }

  /** Put a beside reveal on the figure's state (its element styles patched
   *  in); `remember`: kept for a later seek forward past its ask. */
  private putBeside(owner: string, b: Beside, remember = true): void {
    this.besides.set(owner, b);
    for (const [id, fields] of Object.entries(b.styles ?? {})) this.reprojector?.setElementPatch?.(id, fields);
    if (b.params || b.styles) this.geometryDirty = true;
    if (remember && b.index >= 0) this.besideMemory.set(owner, b);
  }

  /** Take one owner's marks and room off the figure. */
  private endOwner(owner: string): void {
    if (!this.guessOwners.has(owner) && !this.besides.has(owner)) return;
    this.effects?.setGuessMarks?.(owner, null);
    this.guessOwners.delete(owner);
    this.kept.delete(owner);
    this.dropBeside(owner);
  }

  /**
   * Guess marks end with their moment (spec round 6 §5): the guessed part
   * changes shape — every template part at an animate (`ids` null), the
   * moved parts at a move, a transform or a morph. A kept guess stays: at an
   * animate it follows its part — the owners returned have their marks
   * worked out afresh on each frame; a kept pie pair steps aside instead
   * (its room is a place in the old layout) and comes back once the figure
   * has settled (refollow). `except`: a prediction's own animate.
   */
  private endWithMoment(ids: readonly string[] | null, except?: string): string[] {
    const follow: string[] = [];
    for (const owner of new Set([...this.guessOwners, ...this.besides.keys()])) {
      if (!owner.startsWith("guess_")) continue;
      const base = ownerBase(owner);
      if (base === except) continue;
      if (ids !== null && !touches(ids, this.guessMarkParts.get(base) ?? [])) continue;
      if (!this.kept.has(base)) {
        this.endOwner(owner);
        continue;
      }
      if (ids !== null || owner !== base) continue;
      const b = this.besides.get(owner);
      if (b?.params && "beside_pie" in b.params) {
        this.besides.set(owner, Player.withoutPie(b));
        this.geometryDirty = true;
        this.effects?.setGuessMarks?.(owner, null);
      } else follow.push(owner);
    }
    return follow;
  }

  /** A beside record without its pie's room. */
  private static withoutPie(b: Beside): Beside {
    const { params, ...rest } = b;
    const { beside_pie: _pie, ...room } = params ?? {};
    return Object.keys(room).length > 0 ? { ...rest, params: room } : rest;
  }

  /** A kept guess's handles on this layout at these params, or null when its
   *  marks can no longer be worked out (the part gone, a market curve, whose
   *  truth is the end of an animate). */
  private keptHandles(r: KeptGuess, params: Record<string, unknown>, layout: LayoutResult | null): GuessHandle[] | null {
    if (!this.guess) return null;
    const tpl: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(params)) if (!k.startsWith("vars.") && k !== "answers") tpl[k] = v;
    const hs = this.guess.setup(r.on, r.from, tpl, layout).handles;
    if (hs.length !== r.guess.length || hs.some((h, k) => h.kind === "market" || h.truth.length !== r.guess[k].length)) return null;
    return hs;
  }

  /** A kept guess's marks on these handles (yours faded once a command has followed a beside reveal). */
  private keptMarks(r: KeptGuess, hs: GuessHandle[], faded: boolean): GuessMarks {
    if (r.style === "held") return guessMarks(hs, r.guess, 0);
    if (r.style === "morph") return guessMarks(hs, r.guess, 1);
    const m = besideMarks(hs, r.guess, hs.map(() => 1));
    return faded ? fadeYours(m, FADED) : m;
  }

  /** Draw a kept guess (and a revise's first guess) on these handles. */
  private drawKept(owner: string, r: KeptGuess, hs: GuessHandle[]): void {
    this.effects?.setGuessMarks?.(owner, this.keptMarks(r, hs, this.besides.get(owner)?.faded ?? false));
    if (r.prev && this.guessOwners.has(`${owner}_prev`)) this.effects?.setGuessMarks?.(`${owner}_prev`, { ...guessMarks(hs, r.prev, 0), color: GUESS_PREV_COLOR });
  }

  /**
   * Every kept guess worked out afresh on the figure as committed at `scene`
   * (spec round 6 §5: the guess setup is pure — re-run on the new layout,
   * the marks follow the bar or the line). A beside reveal's room follows
   * too: bars stay halved (the room names bars, not places); a pie pair is
   * laid out from the pie standing whole, then moved over again.
   */
  private refollow(scene: SceneState): void {
    if (this.kept.size === 0) return;
    let whole = false;
    for (const owner of this.kept.keys()) {
      const b = this.besides.get(owner);
      if (!b?.params || !("beside_pie" in b.params)) continue;
      this.besides.set(owner, Player.withoutPie(b));
      whole = true;
    }
    if (whole) {
      this.geometryDirty = true;
      this.applyKey(scene);
      this.applyScene(scene);
    }
    let roomMoved = whole;
    for (const [owner, r] of [...this.kept]) {
      if (!this.guessOwners.has(owner)) continue;
      const hs = this.keptHandles(r, this.tplParamsOf(scene), this.paintedLayout());
      if (!hs) {
        this.endOwner(owner);
        this.effects?.setGuessMarks?.(`${owner}_prev`, null);
        this.guessOwners.delete(`${owner}_prev`);
        roomMoved = true;
        continue;
      }
      const b = this.besides.get(owner);
      if (b) {
        const room = r.style === "beside" ? besideParams(hs, hs.map(() => 1)) : {};
        const { params: _old, ...rest } = b;
        const next: Beside = { ...rest, marks: this.keptMarks(r, hs, false), ...(Object.keys(room).length > 0 ? { params: room } : {}) };
        if (JSON.stringify(next.params ?? null) !== JSON.stringify(b.params ?? null)) roomMoved = true;
        this.besides.set(owner, next);
      }
      this.drawKept(owner, r, hs);
    }
    if (roomMoved) {
      this.geometryDirty = true;
      this.applyKey(scene);
      this.applyScene(scene);
    }
    this.pendingSettle = false;
  }

  /** Remember an answered guess as kept when its ask says `keep: true`. */
  private keepGuess(owner: string, index: number, step: Extract<PlanStep, { kind: "ask" }>, guess: number[][], style: KeptGuess["style"], prev?: number[][]): void {
    if (!step.keep || !step.on) return;
    const r: KeptGuess = { index, on: step.on, ...(step.from !== undefined ? { from: step.from } : {}), guess: guess.map((row) => row.slice()), style, ...(prev ? { prev: prev.map((row) => row.slice()) } : {}) };
    this.kept.set(owner, r);
    this.keptMemory.set(owner, r);
  }

  /** Whether step `st` ends an owner's marks (its moment over): a clear, its
   *  parts erased or hidden; for a guess, the next question (one about the
   *  same parts, when kept) and its part reshaped (unless kept). A tree's
   *  working lines and a formula's answers outlive questions. */
  private endsMarks(owner: string, st: PlanStep, kept: boolean): boolean {
    const parts = this.guessMarkParts.get(owner) ?? [];
    if (st.kind === "clear") return true;
    if ((st.kind === "erase" || st.kind === "hide") && touches(st.ids, parts)) return true;
    if (owner.startsWith("tree_") || owner.startsWith("formula_")) return false;
    if (st.kind === "ask") return !kept || touches(st.on ?? [], parts);
    if (!owner.startsWith("guess_") || kept) return false;
    if (st.kind === "animate") return true;
    const ids = reshapedIds(st);
    return ids !== null && touches(ids, parts);
  }

  /** Whether nothing in steps (from, n) ends the owner's marks. */
  private aliveThrough(owner: string, from: number, n: number, kept: boolean): boolean {
    for (let j = from + 1; j < n; j++) if (this.endsMarks(owner, this.plan.steps[j], kept)) return false;
    return true;
  }

  /** The kept guesses boundary `n` shows (their marks are laid out by refollow). */
  private keptAt(n: number): [string, KeptGuess][] {
    const out: [string, KeptGuess][] = [];
    for (const [owner, r] of this.keptMemory) {
      if (r.index >= n || !this.aliveThrough(owner, r.index, n, true)) continue;
      out.push([owner, r]);
    }
    return out;
  }

  /** The figure committed afresh after a beside reveal's room went (at a boundary). */
  private settleBesides(): void {
    if (!this.pendingSettle) return;
    this.pendingSettle = false;
    const scene = this.stateAt(this.completed);
    this.applyKey(scene);
    this.applyScene(scene);
  }

  /** Whether a faded beside reveal keeps this element on screen (it is drawn at FADED). */
  private besideFadedShown(id: string): boolean {
    for (const b of this.besides.values()) if (b.faded && b.shown?.includes(id)) return true;
    return false;
  }

  /** Whether a beside reveal keeps this element on screen (a tile in a box). */
  private besideShown(id: string): boolean {
    for (const b of this.besides.values()) if (b.shown?.includes(id)) return true;
    return false;
  }

  /**
   * The beside reveals boundary `n` shows (Review Focus 5: a seek forward past
   * an answered ask shows yours and the truth again): each remembered one
   * whose ask lies before `n` and that nothing between has ended — the next
   * question (a tree's and a formula's marks outlive it), an animate of the
   * template, a clear, or its parts erased or hidden. Faded when a command has
   * followed its reveal.
   */
  private besidesAt(n: number): [string, Beside][] {
    const out: [string, Beside][] = [];
    for (const [owner, b] of this.besideMemory) {
      if (b.index >= n || !b.marks) continue;
      if (this.aliveThrough(owner, b.index, n, this.keptMemory.has(owner))) out.push([owner, { ...b, faded: n > b.index + 1 }]);
    }
    return out;
  }

  /** Where a beside reveal keeps this element (a card left where the viewer put it), or null. */
  private besideOffset(id: string): Pt | null {
    for (const b of this.besides.values()) {
      const o = b.offsets?.[id];
      if (o) return o;
    }
    return null;
  }

  /** The next command after a beside reveal: the viewer's answer fades to FADED. */
  private fadeBesides(index: number): void {
    for (const [owner, b] of this.besides) {
      if (b.faded || b.index === index) continue;
      b.faded = true;
      if (b.marks && this.guessOwners.has(owner)) this.effects?.setGuessMarks?.(owner, fadeYours(b.marks, FADED));
      // Tiles kept in a formula's boxes are yours too.
      for (const el of this.els(b.shown ?? [])) el.setOpacity?.(FADED);
    }
  }

  /** Take down every mark still on screen — a scrub, the poster, disposal. */
  private endMarks(): void {
    for (const owner of [...this.besides.keys()]) this.dropBeside(owner);
    this.kept.clear();
    this.predictCarry = null;
    this.selfTestAbort?.abort();
    this.selfTestAbort = null;
    this.endGuessMarks();
    for (const owner of this.liveMarks.keys()) this.effects?.endMark?.(owner);
    this.liveMarks.clear();
  }

  private abortRun(): void {
    this.pendingJump = null;
    this.pausedFlag = false;
    this.pendingSpeech = null;
    this.speech.cancel();
    this.tones?.cancel();
    this.ac?.abort();
    this.ac = null;
  }

  /** Wait out any in-flight non-blocking narration (resolves on abort too). */
  private async narrationBarrier(): Promise<void> {
    if (!this.pendingSpeech) return;
    await this.pendingSpeech;
    this.pendingSpeech = null;
  }

  private speechSynthResume(): void {
    this.speech.resume();
    this.tones?.resume();
  }

  private setState(s: PlayerState): void {
    this.state = s;
    this.callbacks.onState?.(s);
  }

  /** Feedback lines already said in this cast — none is said twice (spec 2026-10-03 §4.2). */
  private readonly feedbackUsed = new Set<string>();
  /** The cast's seed for picking feedback lines: its questions, so a replay picks the same. */
  private feedbackSeed: number | null = null;

  /**
   * The feedback line for the band a LIVE viewer reached (spec 2026-10-03
   * §4.2), or null: plain (no step.feedback), a skip (band null) or a movie
   * (the caller passes null) adds nothing.
   */
  private bandLine(step: Extract<PlanStep, { kind: "quiz" | "ask" }>, band: Band | null): string | null {
    if (!step.feedback || band === null) return null;
    return pickLine(step.feedback, band, this.sourceLang, this.castSeed(), this.feedbackUsed);
  }

  private castSeed(): number {
    return (this.feedbackSeed ??= seedOf(this.plan.steps.map((s) => (s.kind === "quiz" || s.kind === "ask" ? s.question : "")).join("\n")));
  }

  /** The author's right/wrong line, then the band's line (and a joke) straight after it. */
  private async speakLines(line: string | null | undefined, extra: readonly string[], step: Extract<PlanStep, { kind: "quiz" | "ask" }>, signal: AbortSignal): Promise<void> {
    if (line) await this.speakLine(line, step, signal);
    for (const l of extra) {
      if (signal.aborted) return;
      await this.speakLine(l, step, signal);
    }
  }

  /** The answered parts' boxes (logical units), for placing a reward; set by the renderer. */
  partBox: ((id: string) => BBox | null) | null = null;
  /** Rewards played in this cast so far — the next picture alternates. */
  private rewardCount = 0;

  /**
   * What follows the author's line for a LIVE answer (callers never ask for
   * a movie or a skip): the band's line, then the reward it earns (spec
   * 2026-10-03 §4.3) — a joke joins the lines; a sparkle glows the answered
   * parts green (unless `sparkle: false`, a green glow already showing);
   * every reward is told to the UI (onReward), which plays confetti, its
   * still badge or the picture on an overlay.
   */
  private feedbackAfter(
    step: Extract<PlanStep, { kind: "quiz" | "ask" }>,
    band: Band,
    task: { long?: boolean; parts?: string[]; sparkle?: boolean; shift?: Record<string, Pt> },
    signal: AbortSignal,
  ): string[] {
    const out: string[] = [];
    const line = this.bandLine(step, band);
    if (line) out.push(line);
    if (!step.feedback) return out;
    const streak = this.streak();
    const kind = rewardFor(step.feedback, band, task.long ?? false, streak);
    if (kind === null) return out;
    const parts = task.parts ?? [];
    // The bundled jokes are English: said in an English cast (or one with no `lang`) only.
    if (kind === "joke" && isEnglish(this.sourceLang)) {
      const joke = pickJoke(this.castSeed(), this.feedbackUsed);
      if (joke) out.push(joke);
    }
    if (kind === "sparkle" && task.sparkle !== false) this.sparkle(parts, signal);
    this.callbacks.onReward?.({ kind, band, box: this.boxOfParts(parts, task.shift), streak, n: this.rewardCount++ });
    return out;
  }

  /** One short green swell on the answered parts — the sparkle. Not awaited. */
  private sparkle(ids: string[], signal: AbortSignal): void {
    const effects = this.effects;
    if (!effects || ids.length === 0) return;
    void this.emphasize(signal, (level, elapsedMs) => effects.setHighlight(ids, "glow", level, null, ANSWER_OK_COLOR, elapsedMs), Promise.resolve(), 1, "ease").finally(() =>
      effects.endHighlight(ids),
    );
  }

  /** The box around the parts — each moved by its `shift` (a card the viewer
   *  dragged off its layout place) — or null when none is known. */
  private boxOfParts(ids: string[], shift?: Record<string, Pt>): BBox | null {
    let box: BBox | null = null;
    for (const id of ids) {
      const at = this.partBox?.(id);
      if (!at) continue;
      const [dx, dy] = shift?.[id] ?? [0, 0];
      const b = { x: at.x + dx, y: at.y + dy, w: at.w, h: at.h };
      if (!box) box = { ...b };
      else {
        const x = Math.min(box.x, b.x), y = Math.min(box.y, b.y);
        box = { x, y, w: Math.max(box.x + box.w, b.x + b.w) - x, h: Math.max(box.y + box.h, b.y + b.h) - y };
      }
    }
    return box;
  }

  /** Speak a runtime-chosen line (quiz/ask feedback): narrated mode voices it,
   *  other modes hold a capped reading beat; the caption always updates. */
  private async speakLine(source: string, step: Extract<PlanStep, { kind: "quiz" | "ask" }>, signal: AbortSignal): Promise<void> {
    // The caption may be a translation; what is SPOKEN never is.
    const text = this.spokenLine(source);
    this.showCaption(source);
    if (this.mode === "narrated") {
      await this.speech.speak(text, this.speedVal, signal, {
        speaker: step.narrationSpeaker,
        delivery: step.narrationDelivery,
        gender: this.narratorGender ?? undefined,
        onStart: this.pagerFor(text),
      });
    } else {
      const hold = Math.min(1400, SpeechManager.estimateMs(text) * 0.4);
      this.pageCaption(hold / this.speedVal);
      await this.waitScaled(hold, signal);
    }
  }

  /** The pages of the caption on screen (render/caption-chunks.ts), and a run counter that retires a pager. */
  private captionPages: string[] = [""];
  private pagerRun = 0;

  /** How many characters two caption lines hold at the stage's present width. */
  private captionBudget(): number {
    const el = this.captionEl;
    const w = el?.parentElement?.clientWidth ?? 0;
    if (!el || !w || typeof getComputedStyle !== "function") return 90;
    const fs = parseFloat(getComputedStyle(el).fontSize) || 18;
    // Patrick Hand runs about 0.45 em a character; less the band's padding.
    const perLine = Math.max(24, (w - 2.5 * fs) / (fs * 0.45));
    return Math.floor(2 * perLine * 0.92);
  }

  /**
   * Turn the caption's pages while the voice runs: page k comes up when the
   * voice has said the pages before it, by their share of the characters of
   * `durationMs`. On the player's frame clock, so it stops while paused and
   * keeps step in an export; a new caption retires it.
   */
  private pageCaption(durationMs: number): void {
    const run = ++this.pagerRun;
    const at = pageTimes(this.captionPages, durationMs);
    if (at.length === 0) return;
    let t = 0;
    let last = performance.now();
    let shown = 0;
    const tick = (now: number): void => {
      if (run !== this.pagerRun) return;
      if (!this.pausedFlag) t += now - last;
      last = now;
      while (shown < at.length && t >= at[shown]) this.showPage(++shown);
      if (shown < at.length) this.raf(tick);
    };
    this.raf(tick);
  }

  /** `onStart` for a line's voice: page the caption over what it will take. */
  private pagerFor(spoken: string): (durationMs: number | null) => void {
    return (ms) => this.pageCaption(ms ?? SpeechManager.estimateMs(spoken) / this.speedVal);
  }

  private setCaption(text: string): void {
    if (!this.captionEl) return;
    // `[de:ich]` is an instruction to the VOICE; the reader sees "ich". The
    // strip belongs here and not upstream because this is the one place every
    // caption passes through — narration, a widget's own line, a translated
    // track — so no path can forget it. (pronounce.ts draws the same line
    // from the other side: what is SAID is not what is written.)
    text = stripLangMarks(text);
    // At most two lines on screen: a long line is shown page by page as it
    // is said (pageCaption), never as a band over the lower third.
    this.pagerRun++;
    this.captionPages = chunkCaption(text, this.captionBudget());
    this.showPage(0);
  }

  private showPage(k: number): void {
    if (!this.captionEl) return;
    const text = this.captionPages[k] ?? "";
    this.captionEl.textContent = text;
    this.captionEl.classList.toggle("cs-caption-empty", text === "");
    // Written on the drawing, a caption over something dark (a photo, a C64
    // screen) takes the band instead (figure-style.ts .cs-caption-dark).
    const scene = this.plan.states[Math.min(this.completed, this.plan.states.length - 1)];
    this.captionEl.classList.toggle("cs-caption-dark", text !== "" && !!this.captionOnDark && !!scene && this.captionOnDark(scene.visible));
  }

  private els(ids: string[]): RenderedElement[] {
    return ids.map((id) => this.elements.get(id)).filter((el): el is RenderedElement => el !== undefined);
  }

  /** The steps that run together with step `index`: the parallel mark steps right after it. */
  private partnersOf(index: number): number[] {
    const out: number[] = [];
    for (let j = index + 1; j < this.plan.steps.length; j++) {
      const s = this.plan.steps[j];
      if (s.kind !== "mark" || !s.parallel) break;
      out.push(j);
    }
    return out;
  }

  /** Step `index`'s action and, all at once, its partners'. */
  private runActions(index: number, signal: AbortSignal): Promise<void> {
    const partners = this.partnersOf(index);
    if (partners.length === 0) return this.runAction(index, signal);
    return Promise.all([index, ...partners].map((i) => this.runAction(i, signal))).then(() => undefined);
  }

  private async runStep(index: number, signal: AbortSignal): Promise<void> {
    const step = this.plan.steps[index];
    // A room taken away since the last boundary: the template whole again.
    this.settleBesides();
    // This ask runs again: whatever it showed last time is no longer its answer.
    if (step.kind === "ask") {
      for (const k of ["guess", "cards", "formula"]) this.besideMemory.delete(`${k}_${index}`);
      this.keptMemory.delete(`guess_${index}`);
    }
    // The next command after a beside reveal: the viewer's answer fades.
    this.fadeBesides(index);
    // A guessed part moved, turned or morphed: its marks end with that moment (spec round 6 §5).
    const reshaped = reshapedIds(step);
    if (reshaped) this.endWithMoment(reshaped);
    if (step.kind === "explore" && (this.skipQuestions || this.autoAnswers || !this.exploreGate)) {
      // Nobody is there to play (a movie, questions off): stand in the way a
      // movie answers an ask — as a perfect viewer — so later {x} lines read
      // naturally: full marks for an activity, no melody for a composition.
      if (step.store) {
        const k = step.store.toLowerCase();
        if (step.activity !== undefined) {
          this.vars.set(k, String(ACTIVITY_QUESTIONS));
          this.vars.set(`${k}.total`, String(ACTIVITY_QUESTIONS));
        } else this.vars.set(k, "");
      }
      return;
    }
    if (this.skipQuestions && (step.kind === "quiz" || step.kind === "ask")) {
      // Preference: no question, no narration, no gate — but a collect-ask
      // still stores its default so later {var} lines keep working.
      if (step.kind === "ask" && step.store && step.choose) {
        const o = Player.chooseDefault(step);
        this.vars.set(step.store.toLowerCase(), o?.label ?? "");
        this.vars.set(`${step.store.toLowerCase()}.id`, o?.id ?? "");
      } else if (step.kind === "ask" && step.store) this.vars.set(step.store.toLowerCase(), step.fallback ?? step.answer ?? "");
      if (step.kind === "quiz" && step.store) this.vars.set(step.store.toLowerCase(), step.choices[step.correct]);
      return;
    }
    if (step.kind !== "speak" && step.narration !== undefined) {
      // Narrated action: voice and action start together; both must finish.
      await this.narrationBarrier();
      if (signal.aborted) return;
      const narration = this.spokenLine(step.narration);
      this.showCaption(step.narration);
      const voiceCtl = new AbortController();
      this.narrationCtl = voiceCtl;
      const voiceSignal = anySignal(signal, voiceCtl.signal);
      const voice =
        this.mode === "narrated"
          ? this.speech.speak(narration, this.speedVal, voiceSignal, {
              speaker: step.narrationSpeaker,
              delivery: step.narrationDelivery,
              gender: this.narratorGender ?? undefined,
              onStart: this.pagerFor(narration),
            })
          : this.silentHold(narration, voiceSignal);
      this.narrationVoice = voice;
      try {
        // An action written inside the sentence waits for its moment. The
        // estimate rather than a measured duration: it is the one number
        // available identically here, in a baked-audio cast and in the
        // export, and no speech marks have to be plumbed to get it.
        const cued = async (): Promise<void> => {
          const wait = cueStartMs(step.cue, step.cueEnd, narration, step.narrationDelivery, this.actionMs(index));
          if (wait > 0) await this.waitScaled(wait, signal);
          if (signal.aborted) return;
          return this.runActions(index, signal);
        };
        await Promise.all([cued(), voice]);
      } finally {
        this.narrationVoice = null;
        if (this.narrationCtl === voiceCtl) this.narrationCtl = null;
      }
      return;
    }
    return this.runActions(index, signal);
  }

  private async runAction(index: number, signal: AbortSignal): Promise<void> {
    const step = this.plan.steps[index];
    const before = this.stateAt(index);
    switch (step.kind) {
      case "speak": {
        const text = this.spokenLine(step.text);
        this.showCaption(step.text);
        if (this.mode === "narrated") {
          const spoken = this.speech.speak(text, this.speedVal, signal, {
            speaker: step.speaker,
            delivery: step.delivery,
            gender: this.narratorGender ?? undefined,
            onStart: this.pagerFor(text),
          });
          if (step.blocking) await spoken;
          else this.pendingSpeech = spoken;
        } else {
          // silent: hold the caption for a reading-time slice instead
          const hold = this.silentHold(text, signal);
          if (step.blocking) await hold;
          else this.pendingSpeech = hold;
        }
        return;
      }
      case "pause":
        return this.waitScaled(step.seconds * 1000, signal);
      case "play": {
        await this.narrationBarrier();
        if (signal.aborted) return;
        // Notes are scheduled on the audio clock; the WAIT runs on the frame
        // clock (worker-driven in export), so background tabs can't desync.
        // Tempo scales with the live speed so audio and wait stay aligned.
        // A voice written as "{melody}" is what the viewer composed and a
        // `store` kept (design 2026-09-24-music §5.2): filled in now, and the
        // step lasts as long as what it turned out to be.
        const filled = step.voices.some((v) => v.notes.includes("{"));
        const voices = filled ? step.voices.map((v) => ({ ...v, notes: subVars(v.notes, this.vars) })).filter((v) => notationBeats(v.notes) > 0) : step.voices;
        const seconds = filled ? (Math.max(0, ...voices.map((v) => notationBeats(v.notes))) * 60) / step.tempo : step.seconds;
        if (this.mode === "narrated" && voices.length > 0) this.tones?.play(voices, step.tempo * this.speedVal, signal);
        if (step.press.length === 0 && step.reveal.length === 0) return this.waitScaled(seconds * 1000, signal);
        // reveal[k] appears at its note's start and stays; press[k] goes
        // down at its note's start and back up at its end — all driven off
        // the same progress clock as the wait, so audio and ink stay locked.
        let revealed = 0;
        let pressed = 0;
        let released = 0;
        await this.progress(step.seconds * 1000, signal, (t) => {
          while (revealed < step.reveal.length && step.revealAt[revealed] <= t) {
            this.elements.get(step.reveal[revealed])?.finish();
            revealed++;
          }
          while (pressed < step.press.length && step.pressAt[pressed] <= t) {
            this.elements.get(step.press[pressed])?.finish();
            pressed++;
          }
          while (released < pressed && step.pressOff[released] <= t) {
            this.elements.get(step.press[released])?.hide();
            released++;
          }
        });
        return;
      }
      case "run": {
        await this.narrationBarrier();
        if (signal.aborted) return;
        const rp = this.reprojector;
        const runner = this.sweepRunner;
        // No runtime and no reprojection surface (headless tests, the plan's
        // subtitle pass, a degraded backend): keep the pacing, change nothing.
        if (!runner || !rp) return this.waitScaled(step.seconds * 1000, signal);
        // Every map is run BEFORE the first frame (spec §4.2): a sweep that
        // stalls between values is not a sweep, it is a slideshow of spinners.
        // The idle precompute (render/index.ts) has usually filled the cache
        // by now, so this loop is a cache read per step.
        const results: CodePatch[] = [];
        for (const v of step.values) {
          try {
            results.push({ ...(await runner(step.code, v)), values: v });
          } catch (err) {
            // A step that failed HOLDS the previous result: the figure stops
            // moving rather than blanking out mid-sweep. The held entry is
            // reused WHOLE — its own values with its own script, or the tray
            // would open knobs that never produced the code on screen.
            console.warn(`[run ${step.code}] step failed: ${(err as Error).message}`);
            results.push(results[results.length - 1] ?? { code: "", result: "", values: v });
          }
          if (signal.aborted) return;
        }
        // Every figure decoded before the first frame, for the same reason
        // every VALUE was run before it: a repaint rebuilds the output pane's
        // <image> from scratch, and an undecoded PNG paints nothing — a white
        // flash per step. Cached by href, so a value seen before is free.
        // It must stay BEFORE runResults.set below: restoreRunPatches' sync
        // branch re-shows those results without decoding them itself.
        await Promise.all(results.map((r) => decodeFigures(r.result)));
        if (signal.aborted) return;
        const n = results.length;
        // Remembered from here on: a scrub that skips this step (forward, or
        // back and forward again) has to show what the run ended on, and
        // re-running the series to find that out would stall the scrub.
        this.runResults.set(index, results);
        this.activeRun = { index, id: step.code, results };
        const scene = this.plan.states[index];
        const overrides = this.overridesOf(scene.offsets, scene.turns, scene.shapes, scene.tex, scene.copies);
        let last = -1;
        await this.progress(step.seconds * 1000, signal, (t) => {
          const k = Math.min(n - 1, Math.floor(t * n));
          if (k === last) return;
          // Catch up rather than jump: a frame clock slower than the sweep
          // must not drop values silently (and a test must be able to name
          // every step the sweep went through).
          while (last < k) {
            last++;
            // code === "" is "nothing ever succeeded": leave the authored script alone.
            if (results[last].code !== "") this.pushCodePatch(step.code, results[last], index);
          }
          // revealNew: a fresh envelope mints rows the authored run never had.
          rp.frame(this.paramsOf(scene), this.frameScene(scene), { revealNew: true, elements: this.patchedElements(), overrides });
          // As in animate: frame() left the DOM at a live, handle-less state,
          // so the boundary below MUST commit even when nothing was patched
          // (a sweep whose every step failed still painted frames).
          this.geometryDirty = true;
        });
        if (signal.aborted) return; // a scrub's renderUpTo owns the state now
        this.activeRun = null; // the run finished: its history entry IS its last result
        this.applyKey(scene); // the boundary, with the last patch in it
        this.applyScene(scene);
        return;
      }
      case "label": {
        // A decision's other branch: a live viewer who chose one skips on.
        const d = this.decideBranch;
        if (d && step.name !== d.chosen && d.labels.includes(step.name)) {
          this.decideBranch = null;
          this.pendingJump = d.then !== undefined && this.plan.labels[d.then] !== undefined ? this.plan.labels[d.then] : this.plan.steps.length;
        } else if (d && step.name === d.then) this.decideBranch = null;
        return;
      }
      case "text":
        // A book's text pane (src/book/): write, mark, erase, look back, clear,
        // view. With no book around it, nothing to do.
        if (this.textHook) await this.textHook(step.op, signal);
        return;
      case "explore": {
        await this.narrationBarrier();
        if (signal.aborted) return;
        if (this.exploreGate) {
          const kept = await this.exploreGate(signal, step);
          if (kept && !signal.aborted) for (const [k, v] of Object.entries(kept)) this.vars.set(k.toLowerCase(), v);
        }
        return;
      }
      case "if": {
        // Live viewers only: movies/skip fall straight through (linear path).
        if (this.autoAnswers || this.skipQuestions) return;
        const raw = this.vars.get(step.varName.toLowerCase());
        if (raw === undefined) return;
        const num = Number(raw.trim());
        let hit = false;
        switch (step.op) {
          case "gt": hit = Number.isFinite(num) && num > (step.value as number); break;
          case "lt": hit = Number.isFinite(num) && num < (step.value as number); break;
          case "gte": hit = Number.isFinite(num) && num >= (step.value as number); break;
          case "lte": hit = Number.isFinite(num) && num <= (step.value as number); break;
          case "eq": hit = answersMatch(raw, String(step.value)); break;
          case "ne": hit = !answersMatch(raw, String(step.value)); break;
        }
        if (hit && this.plan.labels[step.target] !== undefined) this.pendingJump = this.plan.labels[step.target];
        return;
      }
      case "wait":
        await this.narrationBarrier();
        if (signal.aborted) return;
        if (this.inputGate) return this.inputGate(signal);
        return this.waitScaled(800, signal);
      case "quiz": {
        await this.narrationBarrier();
        if (signal.aborted) return;
        // The gate shows immediately — the viewer may answer while the
        // question narration (started by runStep) is still speaking.
        let chosen: number | null;
        const liveQuiz = !this.autoAnswers && this.quizGate !== null;
        const t0 = performance.now();
        if (this.quizGate) {
          chosen = await this.quizGate(signal, step);
        } else {
          await this.waitScaled(1600, signal);
          chosen = null;
        }
        const quizSecs = liveQuiz ? (performance.now() - t0) / 1000 : null;
        if (signal.aborted) return;
        // A live viewer who has answered or skipped has read the question:
        // its reading stops now rather than running on under the feedback.
        // Otherwise (a movie) let it finish before any feedback talks.
        if (liveQuiz) this.cutQuestionVoice();
        if (this.narrationVoice) await this.narrationVoice;
        if (signal.aborted) return;
        // Auto paths (movies, gate-less players) answer correctly by
        // definition; a live viewer's Skip counts as wrong — a test is a test.
        const quizOk = this.autoAnswers || this.quizGate === null ? true : chosen === step.correct;
        this.outcomes.set(index, quizOk);
        this.updateScoreVars(index, quizOk);
        // Store BEFORE feedback so the feedback lines may use {store} too; a
        // skip or an auto answer keeps the correct option (the ask's default).
        this.recordAnswer(index, step.store, step.choices[chosen ?? step.correct], quizOk, quizSecs);
        if (!this.autoAnswers && this.quizGate !== null) {
          this.callbacks.onAnswer?.({
            index,
            kind: "quiz",
            id: this.answerId(index, step.store),
            question: step.question,
            given: chosen === null ? [] : [step.choices[chosen]],
            expected: step.choices[step.correct],
            correct: chosen === step.correct,
            ...(quizSecs !== null ? { secs: quizSecs } : {}),
          });
        }
        const reveal = step.right ?? step.choices[step.correct];
        // The feedback runs on its own signal, so the viewer can skip it
        // without skipping what comes after.
        const ctl = new AbortController();
        this.feedbackCtl = ctl;
        const fb = anySignal(signal, ctl.signal);
        const lines: string[] = [];
        if (chosen === step.correct) {
          // A live viewer who got it right already knows why: hearing the
          // explanation again is just repetition (Hans 2026-09-27: "maybe
          // just say 'correct'"). A movie still reads `right` — it answers
          // for the viewer, who has not.
          // A `right` that reads a live value ("That makes {score}.") is news,
          // not repetition, and is still said.
          if (liveQuiz) lines.push(step.right && /\{[A-Za-z_][\w.]*\}/.test(step.right) ? step.right : correctWord(this.sourceLang, step.question));
          else if (step.right) lines.push(step.right);
        } else if (chosen !== null) {
          // `wrong` is a hint BEFORE the reveal; one that just repeats the
          // reveal would say the same sentence twice (Hans 2026-09-25).
          if (step.wrong && step.wrong.trim() !== reveal.trim()) lines.push(step.wrong);
          lines.push(reveal);
        } else if (!liveQuiz) {
          // A movie or a gate-less player reveals the answer; a live viewer
          // who pressed Skip skipped the question AND its explanation.
          lines.push(reveal);
        }
        // The feedback band's line: a live viewer who answered, right or wrong.
        if (liveQuiz && chosen !== null) lines.push(...this.feedbackAfter(step, chosen === step.correct ? "perfect" : "none", {}, signal));
        if (lines.length > 0) {
          if (liveQuiz) this.feedbackHook?.(true);
          try {
            for (const line of lines) {
              if (fb.aborted) break;
              await this.speakLine(line, step, fb);
            }
          } finally {
            if (this.feedbackCtl === ctl) this.feedbackCtl = null;
            if (liveQuiz) this.feedbackHook?.(false);
          }
        }
        if (signal.aborted) return;
        if (!this.autoAnswers && this.quizGate !== null && chosen !== null) {
          const target = chosen === step.correct ? step.rightGoto : step.wrongGoto;
          if (target !== undefined && this.plan.labels[target] !== undefined) this.pendingJump = this.plan.labels[target];
        }
        return;
      }
      case "ask": {
        if (step.choose !== undefined) return this.onOwnPage(step, before, signal, () => this.chooseAsk(index, step, signal));
        if (step.tree !== undefined) return this.onOwnPage(step, before, signal, () => this.treeAsk(index, step, before, signal));
        if (step.cards !== undefined) return this.onOwnPage(step, before, signal, () => this.cardsAsk(index, step, signal));
        if (step.formula !== undefined) return this.onOwnPage(step, before, signal, () => this.formulaAsk(index, step, before, signal));
        if (step.on !== undefined) return this.onOwnPage(step, before, signal, () => this.guessAsk(index, step, before, signal));
        await this.narrationBarrier();
        if (signal.aborted) return;
        // The auto path (movie/bare player) "types" the answer in check mode,
        // the default in collect mode — one uniform string contract.
        const auto = step.answer ?? step.fallback ?? "";
        let typed: string | null;
        const attempts: string[] = [];
        // Seconds from the card opening to the answer, latest attempt wins;
        // null when no viewer sat at a gate (movies, bare players).
        const timing: { secs: number | null } = { secs: null };
        const timedGate = async (): Promise<string | null> => {
          const from = performance.now();
          const t = await this.askGate!(signal, step);
          if (!this.autoAnswers) timing.secs = (performance.now() - from) / 1000;
          return t;
        };
        if (step.widget !== undefined && (this.autoAnswers || !this.askGate)) {
          // Widget asks demonstrate with the laser instead of the typing card:
          // the pointer taps the answer element (SVG — it exports), then the
          // auto answer stands. A piano answer also SOUNDS (tones route into
          // the export's recording).
          if ((step.widget === "piano" || step.widget === "staff") && step.answer !== undefined && this.tones) {
            try {
              this.tones.play([{ notes: `${step.answer}:q` }], 160, signal);
            } catch {
              /* an unparseable note stays silent */
            }
          }
          if (step.widgetTemplate && this.widgetDemo) {
            await this.widgetDemo(signal, step);
            if (signal.aborted) return;
          } else {
            // A drag question has one box per item: the laser taps each in turn.
            const boxes = step.answerBoxes ?? (step.answerBox ? [step.answerBox] : []);
            if (this.effects && boxes.length > 0) {
              const effects = this.effects;
              for (const b of boxes) {
                const path = pointerPath({ x: b.x + b.w / 2, y: b.y + b.h / 2, box: b }, "tap");
                try {
                  await this.progress(boxes.length > 1 ? 900 : 1400, signal, (t) => effects.setPointer(t >= 1 ? null : path(t)));
                } finally {
                  effects.setPointer(null);
                }
                if (signal.aborted) return;
              }
            } else {
              await this.waitScaled(1200, signal);
            }
          }
          typed = auto;
        } else if (this.askGate) {
          typed = await timedGate();
          if (typed !== null) attempts.push(typed);
        } else {
          await this.waitScaled(1600, signal);
          typed = auto;
        }
        if (signal.aborted) return;
        // Answered live: the question's reading stops (as for a quiz).
        if (typed !== null && this.askGate && !this.autoAnswers) this.cutQuestionVoice();
        if (this.narrationVoice) await this.narrationVoice;
        if (signal.aborted) return;
        // Store BEFORE feedback so the feedback lines may use {store} too.
        // Collect mode has nothing to judge, so no .ok field.
        this.recordAnswer(index, step.store, typed ?? step.fallback ?? step.answer ?? "", null, timing.secs);
        if (step.answer === undefined) return; // collect mode: nothing to judge
        const answer = step.answer;
        const isRight = (t: string | null): boolean => t !== null && answersMatch(t, answer);
        while (typed !== null && !isRight(typed)) {
          if (step.wrong) await this.speakLine(step.wrong, step, signal);
          if (signal.aborted) return;
          if (!step.retry || !this.askGate) break;
          typed = await timedGate();
          if (typed !== null) attempts.push(typed);
          if (signal.aborted) return;
          if (typed !== null) this.recordAnswer(index, step.store, typed, null, timing.secs);
        }
        this.recordAnswer(index, step.store, typed ?? step.fallback ?? step.answer ?? "", isRight(typed), timing.secs);
        this.outcomes.set(index, isRight(typed));
        this.updateScoreVars(index, isRight(typed));
        if (!this.autoAnswers && this.askGate !== null) {
          this.callbacks.onAnswer?.({
            index,
            kind: "ask",
            id: this.answerId(index, step.store),
            question: step.question,
            given: attempts,
            expected: answer,
            correct: isRight(typed),
            ...(timing.secs !== null ? { secs: timing.secs } : {}),
          });
        }
        // A click question shows WHERE the answer was: the element glows
        // while the answer line is spoken — green when the viewer found it,
        // the highlight colour when it is revealed after a miss or a skip.
        // Live viewers only: the movie's laser has already tapped it.
        const live = !this.autoAnswers && this.askGate !== null;
        let groups: { ids: string[]; color?: string }[] = [];
        if (step.widget === "drag" && step.items) {
          // The truth appears: every element item is shown (the plan's state
          // agrees); live, the hits glow green and the misses the highlight colour.
          const elementIds = step.items.filter((i) => i.element).map((i) => i.id);
          for (const el of this.els(elementIds)) el.finish();
          if (live) {
            const placed = new Set(
              (typed ?? "")
                .split(",")
                .map((s) => s.trim().toLowerCase())
                .filter((s) => s !== ""),
            );
            groups = [
              { ids: elementIds.filter((id) => placed.has(id.toLowerCase())), color: ANSWER_OK_COLOR },
              { ids: elementIds.filter((id) => !placed.has(id.toLowerCase())) },
            ];
          }
        } else if (step.widget === "click" && step.answerBox && live) {
          groups = [{ ids: [answer], ...(isRight(typed) ? { color: ANSWER_OK_COLOR } : {}) }];
        }
        // The feedback band's line: a live viewer who answered, right or wrong.
        // A green group already glowing IS the sparkle; else the sparkle glows the answer.
        const greenNow = groups.some((g) => g.color === ANSWER_OK_COLOR && g.ids.length > 0);
        const sparkleIds = step.widget === "click" ? [answer] : step.widget === "drag" && step.items ? step.items.filter((i) => i.element).map((i) => i.id) : [];
        const extra =
          live && typed !== null
            ? this.feedbackAfter(step, isRight(typed) ? "perfect" : "none", { long: step.widget === "drag" && isLong({ parts: sparkleIds.length }), parts: sparkleIds, sparkle: !greenNow }, signal)
            : [];
        if (isRight(typed)) {
          await this.glowWhile(groups, signal, () => this.speakLines(step.right, extra, step, signal));
        } else if (step.reveal) {
          await this.glowWhile(groups, signal, () => this.speakLines(step.right ?? answer, extra, step, signal));
        } else if (extra.length > 0) await this.speakLines(null, extra, step, signal);
        if (!this.autoAnswers && this.askGate !== null && typed !== null) {
          const target = isRight(typed) ? step.rightGoto : step.wrongGoto;
          if (target !== undefined && this.plan.labels[target] !== undefined) this.pendingJump = this.plan.labels[target];
        }
        return;
      }
      case "draw": {
        await this.narrationBarrier();
        if (signal.aborted) return;
        // A windowed code pane scrolls first, so the new line lands at the
        // bottom row before its ink appears.
        await this.tweenScroll(index, signal);
        if (signal.aborted) return;
        const els = this.els(step.ids);
        const ms = this.paced(els, step, 1);
        if (step.parallel) {
          await Promise.all(els.map((el, i) => this.animateRange(el, 0, 1, ms[i], signal)));
        } else {
          for (const [i, el] of els.entries()) {
            await this.animateRange(el, 0, 1, ms[i], signal);
            if (signal.aborted) return;
          }
        }
        return;
      }
      case "show":
        await this.narrationBarrier();
        if (signal.aborted) return;
        await this.tweenScroll(index, signal);
        for (const el of this.els(step.ids)) el.finish();
        return;
      case "hide":
        if (this.heldPast(index)) return;
        this.endGuessMarksFor(step.ids);
        for (const el of this.els(step.ids)) el.hide();
        await this.tweenScroll(index, signal);
        return;
      case "erase": {
        await this.narrationBarrier();
        if (signal.aborted || this.heldPast(index)) return;
        this.endGuessMarksFor(step.ids);
        const els = this.els(step.ids);
        const ms = this.paced(els, step, ERASE_SPEED);
        if (step.parallel) {
          await Promise.all(els.map((el, i) => this.animateRange(el, 1, 0, ms[i], signal)));
        } else {
          for (const [i, el] of els.entries()) {
            await this.animateRange(el, 1, 0, ms[i], signal);
            if (signal.aborted) return;
          }
        }
        // The pane settles back only once the erased line is gone.
        await this.tweenScroll(index, signal);
        return;
      }
      case "clear": {
        await this.narrationBarrier();
        if (signal.aborted || this.heldPast(index)) return;
        this.endGuessMarks();
        const els = this.els(step.ids);
        await Promise.all(
          els.map((el) => this.animateRange(el, 1, 0, Math.min(Math.max(el.durationMs * 0.4, CLEAR_MIN_MS), CLEAR_MS), signal)),
        );
        return;
      }
      case "highlight": {
        if (!this.effects) return;
        const effects = this.effects;
        // Each target's own box (a ring or box per target, not one round them all).
        const boxList = step.ids.flatMap((id) => {
          const b = step.boxes[id];
          if (!b) return [];
          const [dx, dy] = before.offsets[id] ?? [0, 0];
          return [{ x: b.x + dx, y: b.y + dy, w: b.w, h: b.h }];
        });
        const box = boxList.length > 0 ? boxList : null;
        const paint = (level: number, elapsedMs?: number) => effects.setHighlight(step.ids, step.effect, level, box, step.color, elapsedMs, step.part);
        // pulse throbs three times before the hold; everything else eases in once.
        const curve = step.effect === "pulse" ? "throb" : "ease";
        try {
          if (step.untilNarrationEnd && this.narrationVoice) {
            // Emphasis-while-speaking: in, then held at full for the rest of
            // the sentence, released the moment the voice stops.
            await this.emphasize(signal, paint, this.narrationVoice, 1, curve);
          } else {
            // An explicit duration is the whole effect, release included: the
            // throbs compress to fit when there is less room than they want.
            const swellMs = Math.max(1, step.seconds * 1000 - EMPHASIS_RELEASE_MS);
            const rate = curve === "throb" ? Math.max(1, EMPHASIS_HOLD_AT_MS / swellMs) : 1;
            await this.emphasize(signal, paint, this.waitScaled(swellMs, signal), rate, curve);
          }
        } finally {
          effects.endHighlight(step.ids);
        }
        return;
      }
      case "focus": {
        const effects = this.effects;
        if (!effects) return;
        // The inverse spotlight: dim everything visible EXCEPT the targets.
        const keep = new Set(step.ids);
        const dimIds = before.visible.filter((id) => !keep.has(id));
        if (dimIds.length === 0) return;
        const RAMP = 280;
        const alphaAt = (t: number) => 1 - (1 - FOCUS_DIM) * t;
        const paint = (a: number) => effects.setFocus?.(dimIds, a);
        try {
          await this.progress(RAMP, signal, (t) => paint(alphaAt(t)));
          if (signal.aborted) return;
          if (step.untilNarrationEnd && this.narrationVoice) {
            await this.narrationVoice;
          } else {
            await this.waitScaled(Math.max(0, step.seconds * 1000 - 2 * RAMP), signal);
          }
          if (signal.aborted) return;
          await this.progress(RAMP, signal, (t) => paint(alphaAt(1 - t)));
        } finally {
          effects.endFocus?.(dimIds);
        }
        return;
      }
      case "mark": {
        const effects = this.effects;
        if (!effects?.setMark) return;
        const owner = step.owner;
        // Seek-safety: a step that continues a mark glides from it only when
        // that mark is actually up — landed on by a seek, it eases in.
        const path = step.from && !this.liveMarks.has(owner) ? { ...step, from: undefined } : step;
        // Held to the sentence: the stops spread over the voice's estimated
        // remainder (never shorter than the step's own seconds), and the last
        // stop holds — the light deepening, a glow breathing — until the voice
        // actually ends.
        const voice = step.untilNarrationEnd ? this.narrationVoice : null;
        // A partner (parallel) step is timed by the sentence its lead carries.
        let leadIndex = index;
        while (leadIndex > 0 && this.plan.steps[leadIndex].kind === "mark" && (this.plan.steps[leadIndex] as { parallel?: true }).parallel) leadIndex--;
        const lead = this.plan.steps[leadIndex];
        let durMs = step.seconds * 1000;
        if (voice && this.mode === "narrated" && lead.narration !== undefined) {
          const line = this.spokenLine(lead.narration);
          const wait = cueStartMs(lead.cue, lead.cueEnd, line, lead.narrationDelivery, this.actionMs(leadIndex));
          durMs = Math.max(durMs, lineMs(line, lead.narrationDelivery) - wait);
        }
        let speaking = voice !== null;
        if (voice) void voice.then(() => (speaking = false), () => (speaking = false));
        const token = Symbol(owner);
        this.liveMarks.set(owner, token);
        const release = () => {
          if (this.liveMarks.get(owner) !== token) return;
          this.liveMarks.delete(owner);
          effects.endMark?.(owner);
        };
        try {
          let at = 0;
          await this.frames(signal, (elapsed) => {
            at = elapsed;
            effects.setMark!(owner, markFrameAt(path, elapsed, durMs));
            return elapsed < durMs || speaking;
          });
          if (signal.aborted || step.continues) return;
          await this.progress(MARK_RELEASE_MS, signal, (t) => effects.setMark!(owner, markReleaseAt(path, t * MARK_RELEASE_MS, at)));
          if (signal.aborted) return;
          release();
        } finally {
          if (signal.aborted) release();
        }
        return;
      }
      case "flow": {
        const effects = this.effects;
        if (!effects?.setFlow) return;
        const o = { spacing: step.spacing, marks: step.marks, color: step.color, reverse: step.reverse };
        const paint = (elapsedMs: number, alpha: number) => effects.setFlow!(step.ids, o, { travelled: (elapsedMs / 1000) * step.speed, alpha });
        try {
          if (step.untilNarrationEnd && this.narrationVoice) {
            let speaking = true;
            void this.narrationVoice.finally(() => (speaking = false));
            let base = 0;
            const CYCLE = 1000;
            while (speaking && !signal.aborted) {
              await this.progress(CYCLE, signal, (t) => paint(base + t * CYCLE, Math.min(1, (base + t * CYCLE) / 300)));
              base += CYCLE;
            }
            if (!signal.aborted) await this.progress(300, signal, (t) => paint(base + t * 300, 1 - t));
          } else {
            const ms = step.seconds * 1000;
            await this.progress(ms, signal, (t) => paint(t * ms, Math.min(1, t / 0.1, (1 - t) / 0.1)));
          }
        } finally {
          effects.endFlow?.(step.ids);
        }
        return;
      }
      case "point": {
        if (!this.effects) return;
        const effects = this.effects;
        // The planner aimed at the element's CURRENT box (its pose applied),
        // so nothing is added here — adding the offset again sent the laser
        // twice as far for a moved element.
        const path = pointerPath({ x: step.x, y: step.y, box: step.box }, step.gesture);
        try {
          await this.progress(step.seconds * 1000, signal, (t) => effects.setPointer(t >= 1 ? null : path(t)));
        } finally {
          effects.setPointer(null);
        }
        return;
      }
      case "animate": {
        await this.narrationBarrier();
        if (signal.aborted) return;
        const rp = this.reprojector;
        if (!rp) {
          // No reprojection surface (headless tests, degraded backends): keep the pacing.
          return this.waitScaled(step.seconds * 1000, signal);
        }
        // "{var}" targets: swap in the viewer's stored number (the plan-time
        // value is the ask's default — the movie's path); record the override
        // so later commits and scrubs keep the personalization.
        const targets = { ...step.targets };
        if (step.varTargets) {
          for (const [key, varName] of Object.entries(step.varTargets)) {
            const raw = this.vars.get(varName);
            if (raw === undefined || raw.trim() === "") continue;
            const n = Number(raw.trim());
            if (!Number.isFinite(n)) continue;
            targets[key] = n;
            this.varParamOverrides[key] = n;
          }
        }
        // A trail minted by this step is visible from its first frame (the
        // plan makes it visible in the AFTER state); cut to the sweep's progress.
        const visible = new Set([...before.visible, ...(step.trails ?? []).map((tr) => tr.id)]);
        const overrides = this.overridesOf(before.offsets, before.turns, before.shapes, before.tex, before.copies);
        // Absent easing keeps the historical smoothstep exactly (the SAME
        // definition a sweep glides by — render/sweep.ts owns it, so the two
        // cannot drift); a long race asks for `linear` so the middle years do
        // not blur past while the ends crawl.
        const ease = step.easing ? EASINGS[step.easing] : smoothstep;
        // A prediction waiting for this animate (spec 2026-10-02 §3): it
        // starts from the viewer's guess — an animated path starts at the
        // guessed number, a stage's row is replaced by it — and the gap to
        // the truth is drawn as it moves.
        const carry = this.predictCarry && this.predictCarry.animIndex === index ? this.predictCarry : null;
        this.predictCarry = null;
        // A beside reveal on the template ends with its moment (spec round 6
        // §3, §5): the figure is about to change, so yours, its gap and the
        // room the truth took go before the tween — the bars whole again in
        // the animate's own frames (example 386: the chart moves to the left).
        // A kept guess (§5) stays and follows its part, frame by frame.
        const follow = this.endWithMoment(null, carry?.owner);
        this.pendingSettle = false; // the animate commits its own end
        const held: Record<string, unknown> = {};
        const startAt: Record<string, number> = {};
        // Beside (the default): the animate plays from the present as written,
        // the prediction stays where the viewer put it beside it.
        const besideCarry = carry !== null && carry.step.revealStyle !== "morph";
        const carryMarks = (e: number): GuessMarks | null => {
          if (!carry) return null;
          if (!besideCarry || carry.truthHandles.some((h) => h.kind === "market")) return guessMarks(carry.truthHandles, carry.guess, e, besideCarry ? { beside: true } : {});
          return besideMarks(carry.truthHandles, carry.guess, carry.truthHandles.map(() => e));
        };
        if (carry && besideCarry) Object.assign(held, carry.setup.pin);
        if (carry && !besideCarry) {
          Object.assign(held, carry.setup.pin);
          carry.setup.handles.forEach((h, k) =>
            h.paths?.forEach((path, j) => {
              const v = carry.guess[k]?.[j];
              if (v === undefined) return;
              if (path in targets) startAt[path] = v;
              else held[path] = v;
            }),
          );
        }
        const spokenCarry = carry && (carry.line || carry.extra.length > 0) && step.narration === undefined ? this.speakLines(carry.line, carry.extra, carry.step, signal) : null;
        await this.progress(step.seconds * 1000, signal, (t) => {
          const e = ease(t);
          const cur: Record<string, unknown> = { ...this.paramsOf(before), ...held };
          for (const key of Object.keys(targets)) {
            const start = startAt[key] ?? step.starts[key];
            cur[key] = start === null ? targets[key] : tweenValue(start, targets[key], e, step.spaces?.[key]);
          }
          if (besideCarry) Object.assign(cur, besideParams(carry!.truthHandles, carry!.truthHandles.map(() => e)));
          // reveal ids the tween mints (a 40th slice): they join the implicit final draw
          const laid = rp.frame(cur, this.frameScene(before, visible), { revealNew: true, overrides, trailProgress: Player.trailProgressAt(step.trails, e) });
          this.geometryDirty = true;
          if (laid) {
            for (const owner of follow) {
              const r = this.kept.get(owner);
              const hs = r ? this.keptHandles(r, cur, laid) : null;
              if (r && hs) this.drawKept(owner, r, hs);
            }
          }
          if (carry) this.effects?.setGuessMarks?.(carry.owner, carryMarks(e));
        });
        if (signal.aborted) return; // a scrub's renderUpTo owns the state now
        if (carry && besideCarry) {
          const room = besideParams(carry.truthHandles, carry.truthHandles.map(() => 1));
          this.putBeside(carry.owner, { index, marks: carryMarks(1), faded: false, ...(Object.keys(room).length > 0 ? { params: room } : {}) });
        }
        this.applyKey(this.plan.states[index]);
        this.applyScene(this.plan.states[index]);
        // Kept guesses settle where their parts now stand.
        this.refollow(this.plan.states[index]);
        if (carry) {
          this.guessOwners.add(carry.owner);
          this.effects?.setGuessMarks?.(carry.owner, carryMarks(1));
          this.keepGuess(carry.owner, index, carry.step, carry.guess, besideCarry ? "beside" : "morph");
          if (spokenCarry) await spokenCarry;
          else if (carry.line || carry.extra.length > 0) {
            if (this.narrationVoice) await this.narrationVoice;
            if (!signal.aborted) await this.speakLines(carry.line, carry.extra, carry.step, signal);
          }
          if (carry.live && carry.answered && carry.judged) {
            const target = carry.ok ? carry.step.rightGoto : carry.step.wrongGoto;
            if (target !== undefined && this.plan.labels[target] !== undefined) this.pendingJump = this.plan.labels[target];
          }
        }
        return;
      }
      case "move": {
        if (step.relayout && this.reprojector) return this.relayoutTween(index, step, before, signal, (e) => ({ offsets: moveFrame(step, before, e) }));
        const els = this.els(step.ids).filter((el) => el.setOffset);
        const ease = EASINGS[step.easing];
        await this.progress(step.seconds * 1000, signal, (t) => {
          const e = ease(t);
          const offsets = moveFrame(step, before, e);
          for (const el of els) {
            const [x, y] = offsets[el.id];
            // A plain move never changes an element's turn — carry the
            // existing pose through setTransform so an earlier rotate isn't
            // dropped by setOffset's transform-attribute rewrite.
            const turn = before.turns[el.id];
            if (turn && el.setTransform) el.setTransform(x, y, turn.deg, turn.pivot, turn.scale ?? 1, turn.mirror ?? false);
            else el.setOffset!(x, y);
          }
          for (const tr of step.trails ?? []) this.elements.get(tr.id)?.setProgress(lengthFractionAt(tr.lengthAt, e));
          this.tweenMorphItems(step.extraMorphs, e, before);
          this.tweenTransformItems(step.extraTransforms, e);
        });
        if (signal.aborted) return; // a scrub's renderUpTo owns the state now
        this.settleMeasures(step, this.plan.states[index]);
        return;
      }
      case "transform": {
        if (step.relayout && this.reprojector) {
          // A flip with dependents runs on its two half-poses; the turn-over
          // squash is a handle-only prefix and is dropped for that step (design §2.5).
          return this.relayoutTween(index, step, before, signal, (e) => {
            const f = transformFrame(step.items, e);
            return { offsets: f.offsets, turns: f.turns };
          });
        }
        const ease = EASINGS[step.easing];
        const items = step.items.map((it) => ({ it, el: this.elements.get(it.id) })).filter((x) => x.el?.setTransform || x.el?.setOffset);
        await this.progress(step.seconds * 1000, signal, (t) => {
          const e = ease(t);
          const f = transformFrame(step.items, e);
          for (const { it, el } of items) {
            const [dx, dy] = f.offsets[it.id];
            const turn = f.turns[it.id];
            if (el!.setTransform) el!.setTransform(dx, dy, turn.deg, turn.pivot, turn.scale ?? 1, turn.mirror ?? false, f.squash[it.id]);
            else el!.setOffset!(dx, dy);
          }
          for (const tr of step.trails ?? []) this.elements.get(tr.id)?.setProgress(lengthFractionAt(tr.lengthAt, e));
          this.tweenMorphItems(step.extraMorphs, e, before);
          this.tweenTransformItems(step.extraTransforms, e);
        });
        if (signal.aborted) return; // a scrub's renderUpTo owns the state now
        this.settleMeasures(step, this.plan.states[index]);
        return;
      }
      case "fade": {
        const ease = EASINGS[step.easing];
        const items = step.items.map((it) => ({ it, el: this.elements.get(it.id) })).filter((x) => x.el?.setOpacity);
        await this.progress(step.seconds * 1000, signal, (t) => {
          const e = ease(t);
          for (const { it, el } of items) el!.setOpacity!(it.from + (it.to - it.from) * e);
        });
        return;
      }
      case "morph": {
        if ((step.relayout || (step.texItems && step.texItems.length > 0)) && this.reprojector)
          return this.relayoutTween(index, step, before, signal, (e) => ({
            shapes: morphFrame(step.items, before, e),
            math: Object.fromEntries((step.texItems ?? []).map((it) => [it.id, { tex: it.to, from: it.from, t: e }])),
          }));
        // A tex-only morph (texItems, no shape items) has nothing to tween
        // through a handle: without a reprojector, just keep the pacing
        // (mirrors the animate case's no-reprojector branch).
        if (step.items.length === 0) return this.waitScaled(step.seconds * 1000, signal);
        const ease = EASINGS[step.easing];
        const items = step.items.map((it) => ({ it, el: this.elements.get(it.id) })).filter((x) => x.el?.setPoints);
        await this.progress(step.seconds * 1000, signal, (t) => {
          const e = ease(t);
          const shapes = morphFrame(step.items, before, e);
          for (const { it, el } of items) el!.setPoints!(shapes[it.id]);
          this.tweenMorphItems(step.extraMorphs, e, before);
          this.tweenTransformItems(step.extraTransforms, e);
        });
        if (signal.aborted) return; // a scrub's renderUpTo owns the state now
        // Settle on the boundary's own points — the last tween frame is
        // morphPair's K-point resample, not the layout's own vertex count, so
        // a `reset` (whose boundary carries no shapes entry at all) must be
        // re-applied here or the element keeps its resampled path until the
        // next applyScene (a scrub).
        const after = this.plan.states[index];
        for (const { it, el } of items) el!.setPoints!(after.shapes[it.id] ?? {});
        this.settleMeasures(step, after);
        return;
      }
      case "copy": {
        // The clone is a fresh element the layout mints from `copies` in the
        // overrides (design 2026-09-10 §2.5) — nothing to tween, so the step
        // just commits the boundary key (which now carries the copy) and
        // shows the id. With no reprojector the id has no handle: applyKey
        // is a no-op and applyScene finds nothing to show for it — fine.
        await this.narrationBarrier();
        if (signal.aborted) return;
        const after = this.plan.states[index];
        this.applyKey(after);
        this.applyScene(after);
        return;
      }
      case "camera": {
        if (!this.effects) return;
        const effects = this.effects;
        const from = before.camera ?? this.restBox;
        const to = step.box ?? this.restBox;
        const ease = EASINGS["ease-in-out"];
        await this.progress(step.seconds * 1000, signal, (t) => {
          this.planCam = t >= 1 ? step.box : lerpBox(from, to, ease(t));
          // Paused mid-move with the viewer looking round: the view is theirs.
          if (this.viewCam) return;
          effects.setCamera(this.planCam);
        });
        return;
      }
    }
  }

  /**
   * Per-element durations for one draw/erase step, capped so the whole step
   * fits its budget (src/render/pacing.ts). `speedFactor` is the verb's own
   * multiplier (erase runs faster than draw) and applies before the cap, so
   * the budget always means wall-clock.
   */
  /**
   * What a step's animation costs, in milliseconds — what an end-anchored cue
   * has to start early by. A draw is its elements' own paced durations; every
   * other animating kind carries its `seconds`. Anything instant (a show, a
   * hide) costs nothing, which makes an end cue on it the same as a start
   * cue, exactly as it should be.
   */
  private actionMs(index: number): number {
    const step = this.plan.steps[index];
    if (step.kind === "draw" || step.kind === "erase") {
      const ms = this.paced(this.els(step.ids), step, 1);
      if (ms.length === 0) return 0;
      return step.parallel ? Math.max(...ms) : ms.reduce((a, b) => a + b, 0);
    }
    return "seconds" in step && typeof step.seconds === "number" ? step.seconds * 1000 : 0;
  }

  /**
   * How long a step's own animation actually runs, ms — actionMs, but with an
   * erase at ERASE_SPEED and a clear at its fade, as runAction plays them.
   * The frames harness's pacing report (lint/pacing-report.ts) reads it, so
   * the report times a cast by the player's numbers, not a copy of them.
   */
  stepRunMs(index: number): number {
    const step = this.plan.steps[index];
    if (!step) return 0;
    if (step.kind === "erase") {
      const ms = this.paced(this.els(step.ids), step, ERASE_SPEED);
      if (ms.length === 0) return 0;
      return step.parallel ? Math.max(...ms) : ms.reduce((a, b) => a + b, 0);
    }
    if (step.kind === "clear") return Math.max(0, ...this.els(step.ids).map((el) => Math.min(Math.max(el.durationMs * 0.4, CLEAR_MIN_MS), CLEAR_MS)));
    return this.actionMs(index);
  }

  private paced(els: RenderedElement[], step: { parallel?: boolean; narration?: string }, speedFactor: number): number[] {
    return pacedDurations(
      els.map((el) => el.durationMs * speedFactor),
      { narrated: step.narration !== undefined, parallel: !!step.parallel },
    );
  }

  /** Reveal/erase an element by animating its progress from `from` to `to`. */
  private animateRange(el: RenderedElement, from: number, to: number, ms: number, signal: AbortSignal): Promise<void> {
    if (ms <= 0) {
      el.setProgress(to);
      return Promise.resolve();
    }
    return this.progress(ms, signal, (t) => el.setProgress(from + (to - from) * t));
  }

  /**
   * A measure's dimension line rides its figure (design §2.3): the same
   * per-leaf lerp the morph case runs for its own items, merged over the
   * boundary's existing points so leaves this step does not touch stay put.
   */
  private static trailProgressAt(trails: TrailProgress[] | undefined, e: number): Record<string, number> {
    return Object.fromEntries((trails ?? []).map((tr) => [tr.id, lengthFractionAt(tr.lengthAt, e)]));
  }

  /**
   * A step whose targets something is DEFINED by (design 2026-09-10 §2.5):
   * every frame is a re-layout at the interpolated poses and shapes, handed
   * to the reprojector — the moved element from its original-frame layout
   * under its interpolated transform (the same look as the handle path), the
   * dependents from their recomputed geometry. The handles are bypassed and
   * the boundary is committed at the end, as after an animate.
   */
  private async relayoutTween(
    index: number,
    step: { seconds: number; easing: Easing; trails?: TrailProgress[] } & MeasureFollow,
    before: SceneState,
    signal: AbortSignal,
    frameAt: (e: number) => {
      offsets?: Record<string, Pt>;
      turns?: Record<string, Turn>;
      shapes?: Record<string, Record<string, Pt[]>>;
      math?: Record<string, { tex: string; from?: string; t?: number }>;
    },
  ): Promise<void> {
    const rp = this.reprojector!;
    const ease = EASINGS[step.easing];
    const params = this.paramsOf(before);
    const visible = new Set([...before.visible, ...(step.trails ?? []).map((t) => t.id)]);
    await this.progress(step.seconds * 1000, signal, (t) => {
      const e = ease(t);
      const f = frameAt(e);
      // The step's measure extras ride along exactly as on the handle path
      // (a measure of a co-moved element that is not a source has nothing
      // else to move it — review finding 7): its dimension line as a shape,
      // its label's slide as a pose; the value is written at the boundary.
      const extra = transformFrame(step.extraTransforms ?? [], e);
      const offsets = { ...before.offsets, ...(f.offsets ?? {}), ...extra.offsets };
      const turns = { ...before.turns, ...(f.turns ?? {}), ...extra.turns };
      const shapes: Record<string, Record<string, Pt[]>> = { ...before.shapes, ...morphFrame(step.extraMorphs ?? [], before, e), ...(f.shapes ?? {}) };
      rp.frame(
        params,
        { visible, offsets, turns, opacities: before.opacities, shapes, texts: before.texts },
        { overrides: this.overridesOf(offsets, turns, shapes, before.tex, before.copies, f.math), trailProgress: Player.trailProgressAt(step.trails, e) },
      );
      this.geometryDirty = true;
    });
    if (signal.aborted) return; // a scrub's renderUpTo owns the state now
    const after = this.plan.states[index];
    this.applyKey(after);
    this.applyScene(after);
  }

  private tweenMorphItems(items: MorphItem[] | undefined, e: number, before: SceneState): void {
    for (const it of items ?? []) {
      const el = this.elements.get(it.id);
      if (!el?.setPoints) continue;
      const pts: Record<string, Pt[]> = { ...(before.shapes[it.id] ?? {}) };
      for (const leaf of it.leaves) pts[leaf.leafId] = leaf.from.map((p, i): Pt => [p[0] + (leaf.to[i][0] - p[0]) * e, p[1] + (leaf.to[i][1] - p[1]) * e]);
      el.setPoints(pts);
    }
  }

  /** A measure's label slides to the new spot alongside the step it belongs to — the transform case's own pose lerp, on ids the step does not otherwise touch. */
  private tweenTransformItems(items: TransformItem[] | undefined, e: number): void {
    for (const it of items ?? []) {
      const el = this.elements.get(it.id);
      if (!el) continue;
      const dx = it.from.offset[0] + (it.to.offset[0] - it.from.offset[0]) * e;
      const dy = it.from.offset[1] + (it.to.offset[1] - it.from.offset[1]) * e;
      const deg = it.from.turn.deg + (it.to.turn.deg - it.from.turn.deg) * e;
      const sc = (it.from.turn.scale ?? 1) + ((it.to.turn.scale ?? 1) - (it.from.turn.scale ?? 1)) * e;
      if (el.setTransform) el.setTransform(dx, dy, deg, it.to.turn.pivot, sc, it.to.turn.mirror ?? false);
      else el.setOffset?.(dx, dy);
    }
  }

  /**
   * Land the step's measure extras on the boundary the plan recorded: the
   * dimension lines on their exact points (the tween's last frame is a fresh
   * array, and a later scrub reads these), and the labels on their recomputed
   * strings. The VALUE never tweens — a measure reads what the figure is once
   * it has arrived, so it is written in one go at the end.
   */
  private settleMeasures(step: MeasureFollow, after: SceneState): void {
    for (const it of step.extraMorphs ?? []) this.elements.get(it.id)?.setPoints?.(after.shapes[it.id] ?? {});
    for (const t of step.texts ?? []) this.elements.get(t.id)?.setText?.({ ...(after.texts[t.id] ?? {}) });
  }

  /**
   * Drive onTick(t) with t ∈ [0,1] over a duration, honoring pause and the
   * live speed multiplier. Always ends with onTick(1) unless aborted.
   */
  /**
   * Offsets that differ between a step's before and after states without a
   * move verb are a code window's scroll (the plan writes them after every
   * visibility change): slide them over SCROLL_MS so the pane reads as an
   * editor scrolling, not a jump. renderUpTo applies the after-state's
   * offsets outright, so scrub and step-back need nothing here.
   */
  private async tweenScroll(index: number, signal: AbortSignal): Promise<void> {
    const before = this.stateAt(index);
    const after = this.plan.states[index];
    const ids = new Set([...Object.keys(before.offsets), ...Object.keys(after.offsets)]);
    const moves: { el: RenderedElement; from: Pt; to: Pt }[] = [];
    for (const id of ids) {
      const a = before.offsets[id] ?? [0, 0];
      const b = after.offsets[id] ?? [0, 0];
      if (a[0] === b[0] && a[1] === b[1]) continue;
      const el = this.elements.get(id);
      if (el?.setOffset) moves.push({ el, from: a, to: b });
    }
    if (moves.length === 0) return;
    const ease = EASINGS["ease-in-out"];
    await this.progress(SCROLL_MS, signal, (t) => {
      const e = ease(t);
      for (const m of moves) m.el.setOffset!(m.from[0] + (m.to[0] - m.from[0]) * e, m.from[1] + (m.to[1] - m.from[1]) * e);
    });
  }

  /**
   * Runs `work` (a spoken line, typically) while the groups glow — each its
   * own ids in its own colour, all in one loop of full swells of
   * ANSWER_GLOW_MS until the work is done; at least one whole swell, so a
   * silent player still shows the elements. No effects or nothing to glow:
   * just the work. The glow is always cleared, even on abort.
   */
  private async glowWhile(groups: { ids: string[]; color?: string }[], signal: AbortSignal, work: () => Promise<void>): Promise<void> {
    const effects = this.effects;
    const live = groups.filter((g) => g.ids.length > 0);
    if (!effects || live.length === 0) {
      await work();
      return;
    }
    const done = work();
    try {
      await this.emphasize(
        signal,
        (level, elapsedMs) => {
          for (const g of live) effects.setHighlight(g.ids, "glow", level, null, g.color, elapsedMs);
        },
        done,
        1,
        "ease",
      );
    } finally {
      for (const g of live) effects.endHighlight(g.ids);
    }
    await done;
  }

  /**
   * An open-ended rAF loop: `onFrame(elapsedMs)` every frame until it returns
   * false (or the signal aborts). progress()'s sibling for work whose length
   * is not known in advance — a sentence's, say. Honours pause and speed the
   * same way.
   */
  private frames(signal: AbortSignal, onFrame: (elapsedMs: number) => boolean): Promise<void> {
    return new Promise((resolve) => {
      let t = 0;
      let last = performance.now();
      const tick = (now: number) => {
        if (signal.aborted) return resolve();
        if (!this.pausedFlag) t += (now - last) * this.speedVal;
        last = now;
        if (!onFrame(t)) return resolve();
        this.raf(tick);
      };
      this.raf(tick);
    });
  }

  /**
   * The emphasis envelope: three throbs, then a HOLD at full for as long as
   * `until` takes, then a release from wherever the level had got to.
   *
   * The hold is the point. Repeating a swell instead — which is what this used
   * to do — left the element at full for an instant at a time and never simply
   * ON, and since a repeat could only stop at a cycle boundary it went on
   * breathing past the end of the voice. Here the level is sampled per frame,
   * so the release starts on the word. `rate` > 1 compresses the throbs to fit
   * an explicit duration; the floor at the first peak keeps even an instant
   * emphasis visible.
   */
  private async emphasize(
    signal: AbortSignal,
    paint: (level: number, elapsedMs?: number) => void,
    until: Promise<unknown>,
    rate = 1,
    curve: "throb" | "ease" = "throb",
  ): Promise<void> {
    let running = true;
    void until.then(
      () => (running = false),
      () => (running = false),
    );
    let level = 0;
    await this.frames(signal, (elapsed) => {
      const at = elapsed * rate;
      level = curve === "throb" ? emphasisLevel(at) : easeInLevel(at);
      paint(level, elapsed);
      return running || at < (curve === "throb" ? EMPHASIS_FIRST_PEAK_MS : EMPHASIS_EASE_MS);
    });
    if (signal.aborted) return;
    // No elapsed time in the release: a band or marker stays as written and only fades.
    await this.progress(EMPHASIS_RELEASE_MS, signal, (t) => paint(releaseLevel(level, t)));
  }

  private progress(ms: number, signal: AbortSignal, onTick: (t: number) => void): Promise<void> {
    if (ms <= 0) {
      onTick(1);
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      let t = 0;
      let last = performance.now();
      let lastP = -1;
      const tick = (now: number) => {
        if (signal.aborted) return resolve();
        if (!this.pausedFlag) t += (now - last) * this.speedVal;
        last = now;
        const p = Math.min(t / ms, 1);
        // Skip onTick while paused holds p unchanged — avoids a busy-loop of
        // relayouts (e.g. animate's reprojector.frame) firing every rAF for
        // no visual change. p===1 always gets through so completion fires.
        if (p !== lastP) {
          lastP = p;
          onTick(p);
        }
        if (p >= 1) return resolve();
        this.raf(tick);
      };
      this.raf(tick);
    });
  }

  /** A silent player's reading beat for a line, its caption paged over it. */
  private silentHold(text: string, signal: AbortSignal): Promise<void> {
    const hold = Math.min(1400, SpeechManager.estimateMs(text) * 0.4);
    this.pageCaption(hold / this.speedVal);
    return this.waitScaled(hold, signal);
  }

  private waitScaled(ms: number, signal: AbortSignal): Promise<void> {
    if (ms <= 0) return Promise.resolve();
    return new Promise((resolve) => {
      let t = 0;
      let last = performance.now();
      const tick = (now: number) => {
        if (signal.aborted) return resolve();
        if (!this.pausedFlag) t += (now - last) * this.speedVal;
        last = now;
        if (t >= ms) return resolve();
        this.raf(tick);
      };
      this.raf(tick);
    });
  }

  private hideAll(): void {
    for (const el of this.elements.values()) el.hide();
  }

  /**
   * Un-draw everything visible at the current boundary — the playlist's soft
   * exit between items. Runs outside the plan (no step, no state change);
   * dispose and scrubbing abort it like any running step.
   */
  /**
   * Out-of-plan camera push into an element's box — the playlist's live
   * semantic-zoom exit (the export path plays the same move as a camera
   * command in exportSequence). Abortable like fadeOutAll.
   */
  async zoomInto(box: BBox, opts: { zoom?: number; ms?: number } = {}): Promise<void> {
    const effects = this.effects;
    if (!effects) return;
    this.abortRun();
    const ac = new AbortController();
    this.ac = ac;
    const zoom = Math.min(8, Math.max(1.2 * restZoom(this.restBox), opts.zoom ?? 4.5));
    const to = cameraBox(box.x + box.w / 2, box.y + box.h / 2, zoom, this.restBox) ?? this.restBox;
    const from = this.viewCam ?? this.stateAt(this.completed).camera ?? this.restBox;
    this.viewCam = null;
    const ease = EASINGS["ease-in-out"];
    await this.progress(opts.ms ?? 1600, ac.signal, (t) => effects.setCamera(lerpBox(from, to, ease(t))));
  }

  async fadeOutAll(ms = CLEAR_MS): Promise<void> {
    this.abortRun();
    const ac = new AbortController();
    this.ac = ac;
    const els = this.els([...this.stateAt(this.completed).visible]);
    await Promise.all(els.map((el) => this.animateRange(el, 1, 0, ms, ac.signal)));
  }
}

/** A signal that aborts when either does (AbortSignal.any, where the runtime has it). */
function anySignal(a: AbortSignal, b: AbortSignal): AbortSignal {
  const any = (AbortSignal as unknown as { any?: (s: AbortSignal[]) => AbortSignal }).any;
  if (any) return any([a, b]);
  const c = new AbortController();
  const stop = () => c.abort();
  if (a.aborted || b.aborted) c.abort();
  a.addEventListener("abort", stop, { once: true });
  b.addEventListener("abort", stop, { once: true });
  return c.signal;
}
