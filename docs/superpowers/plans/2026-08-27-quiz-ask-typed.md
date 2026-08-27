# Quiz Rename + Typed Ask Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename the multiple-choice verb to `quiz`; introduce a new typed-answer `ask` verb (check mode with `answer`/`reveal`/`retry`, collect mode with `store`/`default` and `{var}` interpolation into later narration); movies demonstrate both — the quiz card hovers-then-selects, the ask card types its answer — painted by the export's frame painter.

**Architecture:** Mechanical rename first (quiz = the shipped feature, six verb sites + gates + example). The typed ask mirrors quiz's plumbing: flat wire schema, plan step, a `Player.askGate` returning the typed string (null = skipped), a card gate in controls with an input field. Answers land in a public `Player.vars` map; `{name}` interpolates at speak/caption time (and at TTS-collection time in the export, using defaults, so every line exists as audio). The export gates run a demo timeline (pure phase functions, node-tested) that `paintFrame` renders onto the canvas — DOM stays invisible to movies, the painter is the movie's UI.

**Tech Stack:** TypeScript, vitest (node), canvas 2D in the export painter. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-08-27-interactivity-principles.md` §3/§5 + this conversation's decisions (2026-08-27): quiz=choices, ask=typed; `default` REQUIRED with `store`; movie types answer (check) / default (collect); `reveal` (default true) and `retry` (default false) are separate check-mode arguments.

## Global Constraints

- Verb list sites (now for BOTH verbs): schema ACTION_VERBS + prose, plan ACTION_KEYS, lint ACTION_KEYS, compiler-v1.md list + bullets. Player switch is NOT compile-enforced — tests carry it.
- Wire schema flat, no unions, additionalProperties: false.
- The movie never waits: export gates auto-perform; `required`/`retry` bind live only.
- Every line the player can speak in a movie must come out of `collectSpeakLines`, INTERPOLATED with defaults, with matching voice/delivery/gender.
- `{var}` tokens: `/\{([a-z][a-z0-9_]*)\}/gi`, replaced only when the var is known; unknown braces left untouched.
- Repo norms: tsc+tests before each commit; `git log` right before each commit; commit trailers.

---

### Task 1: Rename ask → quiz (mechanical, no behavior change)

**Files:** `src/spec/types.ts` (AskArgs→QuizArgs, Command.ask→quiz), `src/spec/schema.ts` (property, prose, ACTION_VERBS entry, semantic block), `src/render/plan.ts` (step kind "quiz", ACTION_KEYS, arm), `src/render/player.ts` (askGate→quizGate, case "quiz"; speakLine's step type widens later), `src/lint/lint.ts` (ACTION_KEYS), `src/ui/controls.ts` (askGateFor→quizGateFor, AskGateStep→QuizGateStep, assignment; CSS class names cs-askgate*→cs-cardgate* shared), `src/styles.css` (rename the block's class names), `src/export/video.ts` (collectSpeakLines c.ask→c.quiz; gate assignment), `src/examples.json` (the quiz example's two commands ask→quiz), tests: rename `tests/ask-*.test.ts` → `tests/quiz-*.test.ts` and update symbol names, `tests/export.test.ts` ask block.

- [ ] Step 1: sweep with grep as the checklist: `grep -rn "\bask\b" src/ tests/ --include="*.ts" -l` and rename occurrences that belong to the verb (NOT tags.ts/prompt yet — Task 7 rewrites those). CSS: `.cs-askgate`→`.cs-cardgate`, `.cs-askgate-card`→`.cs-cardgate-card`, `-q`, `-choices`, `-pill` likewise (shared by both gates from Task 5 on).
- [ ] Step 2: `npx tsc && npm test` — everything green (pure rename; the examples file's ask→quiz keeps the examples bar green).
- [ ] Step 3: commit "Rename the choice verb to quiz".

---

### Task 2: Typed ask — types, schema, validation

**Files:** `src/spec/types.ts`, `src/spec/schema.ts`, new `src/spec/answers.ts`, test `tests/ask-schema.test.ts` (fresh file for the NEW ask).

**Interfaces:**
```ts
// types.ts
export interface AskArgs {
  question: string;
  /** Correct answer (check mode). Compared trimmed, case-insensitively. */
  answer?: string;
  right?: string;
  wrong?: string;
  /** Check mode: speak the correct answer after a final wrong attempt (default true). */
  reveal?: boolean;
  /** Check mode: clear the field and ask again after a wrong attempt (default false). */
  retry?: boolean;
  /** Store the typed response under this name; later speak lines may use {name}. */
  store?: string;
  /** Stand-in the movie types and silent/skip paths use. REQUIRED with store. */
  default?: string;
  required?: boolean;
}
// answers.ts
export function answersMatch(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}
export const VAR_RE = /\{([a-z][a-z0-9_]*)\}/gi;
export function subVars(text: string, vars: ReadonlyMap<string, string>): string {
  return text.replace(VAR_RE, (m, name: string) => vars.get(name.toLowerCase()) ?? m);
}
```

Wire schema `ask` (flat): question/answer/right/wrong/reveal/retry/store/default/required, required: ["question"], additionalProperties false. Descriptions state: check vs collect, 1 of answer|store required, default required with store, movie behavior.

Semantic checks: question non-empty; `answer` XOR/OR `store` — at least one present; `store` matches `/^[a-z][a-z0-9_]*$/i`; `default` present when `store` is; `retry`/`reveal`/`wrong` only with `answer`; `right` only with `answer`.

- [ ] Tests (RED first): valid check-ask passes; valid collect-ask (store+default) passes; both-modes ask passes; neither answer nor store fails; store without default fails; retry without answer fails; bad store name fails; ask+draw combined fails; answersMatch("  AU ", "au") true; subVars replaces known, leaves unknown.
- [ ] GREEN: implement; ACTION_VERBS gets "ask" (alongside "quiz"); prose updated.
- [ ] Full suite; commit.

---

### Task 3: Plan step + Player (vars, interpolation, the ask case)

**Files:** `src/render/plan.ts`, `src/render/player.ts`, tests `tests/ask-plan.test.ts`, `tests/ask-player.test.ts` (fresh files).

**Plan step:**
```ts
| { kind: "ask"; question: string; answer?: string; right?: string; wrong?: string; reveal: boolean; retry: boolean; store?: string; fallback?: string; required: boolean }
```
Arm mirrors quiz: narration defaults to the question; `reveal: cmd.ask.reveal !== false`, `retry: cmd.ask.retry === true`, `fallback: cmd.ask.default`. ACTION_KEYS gets "ask".

**Player:**
- `readonly vars = new Map<string, string>()` (public). Keys lowercased.
- `askGate: ((signal, step: Extract<PlanStep, {kind:"ask"}>) => Promise<string | null>) | null` beside quizGate.
- Interpolation: every spoken/captioned text passes `subVars(text, this.vars)` — the narrated-action path in runStep (speak + setCaption + estimateMs), the standalone `speak` case, `speakLine`, and `renderUpTo`'s caption recompute. `speakLine`'s step parameter widens to `Extract<PlanStep, { kind: "quiz" | "ask" }>`.
- `case "ask"` semantics:
  1. gate (or no-gate fallback: hold 1600 ms, typed = `answer ?? fallback ?? ""` — the auto path).
  2. await the question voice.
  3. check mode (`answer` set): while typed is a wrong string — speak `wrong` (if present); if `retry` and gate exists, gate again; else break. Outcome: correct → speak `right` (if present); not-correct (wrong final or skipped) and `reveal` → speak `right ?? answer`.
  4. store: `vars.set(store.toLowerCase(), typed ?? fallback ?? answer ?? "")` — set BEFORE feedback lines so they may interpolate `{store}` themselves.
- The export/auto gate resolves the TYPED STRING (answer in check mode, default in collect), so the player treats movie and live identically — no auto-marker.

- [ ] Tests (RED): plan arm defaults (reveal true, retry false, fallback carries, narration=question, paired speak overrides); player collect: gate types "Hans" → vars.get("name")==="Hans", later speak "Hi {name}!" spoken as "Hi Hans!"; collect skipped (null) → fallback stored + interpolated; check correct ("au" vs "Au") → right only; check wrong, retry:false, reveal default → wrong then right-or-answer; check wrong, reveal:false → wrong only; check retry:true → gate called until correct (answers ["x","Au"] → wrong spoken once, then right); no gate (auto) check → right spoken (typed=answer); no gate collect → fallback stored; skipped during retry with reveal → reveal line.
- [ ] GREEN; neighboring suites; commit.

---

### Task 4: Lint — the `ask-var` rule

**Files:** `src/lint/lint.ts` (rule union + `lintCommands` addition), test in `tests/ask-plan.test.ts`.

Rule: walk commands in order, collecting store names from ask commands; scan every `speak`, quiz/ask `question`/`right`/`wrong` for VAR_RE tokens; a token with no EARLIER store → `{ rule: "ask-var", severity: "warn", message: '"{x}" is used before any ask stores it' }`. Add `"ask-var"` to the LintIssue rule union.

- [ ] RED test: spec using `{name}` in a speak before (or without) the storing ask → one ask-var warning; correctly ordered spec → none. GREEN. Run tests/examples.test.ts — all 92 existing examples must stay clean (if any legitimately uses braces, tighten the regex or the rule, don't the example). Commit.

---

### Task 5: Controls — shared card, typed input gate

**Files:** `src/ui/controls.ts`, `src/styles.css`.

`askGateFor(stage)` beside `quizGateFor`: card (shared `.cs-cardgate*` classes) with the question on top, a row `<input type="text">` (autofocus, Enter submits) + an OK button, Skip unless required. On submit: collect mode → resolve text immediately, card lingers briefly; check mode → judge with `answersMatch` (gate receives `answer?` and `retry` in its step slice): correct → input gets `.right`, linger `ASK_LINGER_MS`, resolve; wrong+retry → input flashes `.wrong`, clears, stays (does NOT resolve — the SAME gate invocation keeps accepting attempts; resolve only on a correct attempt or Skip — this keeps the card stable instead of remounting per attempt, and the player's retry loop is then only exercised by OTHER gates, which is fine: the player loop re-gates only when a wrong string is RESOLVED, and this gate never resolves wrong strings when retry is true); wrong+no-retry → `.wrong`, linger, resolve the wrong text (player speaks wrong/reveal). Assignment beside the quiz gate in attachPlayerControls. CSS: `.cs-cardgate-input` row styles (+ .right/.wrong border colors), reusing the card family.

- [ ] `npx tsc && npm test`; commit. (DOM module — browser-verified in Task 8's smoke.)

---

### Task 6: Export — interpolated TTS collection + demo performances

**Files:** `src/export/video.ts`, new `src/export/demo.ts`, tests `tests/export.test.ts` additions + `tests/export-demo.test.ts`.

**collectSpeakLines** rewrite: track `vars` (store → default) while walking commands; every pushed line is `subVars`-interpolated with vars-so-far; quiz pushes question-unless-speak + (right ?? correct choice); ask pushes question-unless-speak + (`answer` set ? (right ?? answer) : nothing); ask with store sets vars AFTER pushing its own lines.

**Demo phase functions** (pure, node-tested):
```ts
// demo.ts
export interface QuizDemoFrame { hover: number | null; selected: boolean; done: boolean }
export function quizDemoAt(elapsedMs: number, choiceCount: number, correct: number): QuizDemoFrame;
export function quizDemoDuration(choiceCount: number): number;
// timeline: 400 appear + 900 hold + 500/choice hover walk (0..n-1, ending on correct) + select
export interface AskDemoFrame { typedChars: number; done: boolean }
export function askDemoAt(elapsedMs: number, text: string): AskDemoFrame;
export function askDemoDuration(text: string): number;
// timeline: 400 appear + 900 hold + 75ms/char typing + 800 settle
```

**Painting**: `paintFrame` gains an optional `demo` argument `{ kind: "quiz" | "ask"; question: string; choices?: string[]; correct?: number; typed?: string; elapsed: number }`; draws the centered card over the figure (paper `rgba(255,253,246,0.93)` fill + ink border + Patrick Hand), question wrapped on top, then: quiz — numbered rows, the hovered row outlined rust, the selected row green-tinted; ask — an input box with `typed.slice(0, typedChars)` and a caret while typing, green border once done (check mode). The frame loop passes the current demo state.

**Gates in exportVideo**: a `currentDemo` slot the frame loop reads;
```ts
handle.timeline.quizGate = async (sig, step) => {
  if (sig.aborted) return null;
  currentDemo = { kind: "quiz", question: step.question, choices: step.choices, correct: step.correct, t0: performance.now() };
  await zzz(quizDemoDuration(step.choices.length));
  scheduleDemoClear(2600); // linger through the reveal line, abort-safe
  return null;
};
handle.timeline.askGate = async (sig, step) => {
  if (sig.aborted) return null;
  const text = step.answer ?? step.fallback ?? "";
  currentDemo = { kind: "ask", question: step.question, typed: text, t0: performance.now() };
  await zzz(askDemoDuration(text));
  scheduleDemoClear(2600);
  return text;
};
```
(`scheduleDemoClear` = fire-and-forget `zzz(ms).then(clear)` guarded by the abort signal and by a newer demo having replaced the slot.)

- [ ] Tests (RED): collectSpeakLines — quiz lines as before (renamed); ask check-mode pushes right-or-answer; collect-mode pushes only the question; `{name}` in a later speak comes out interpolated with the default; demo phase functions — appear phase has hover null/typedChars 0, mid-walk hovers intermediate index, end selects correct / full text, durations monotone in inputs. GREEN. Commit.

---

### Task 7: Prompt, tags, examples, help, roadmap

- compiler-v1.md: quiz bullet (rename + unchanged guidance), ask bullet: typed answer; check vs collect; `store`+`default` pair; "later speak lines may use {name}"; use only when the request wants typing/personalization. Verb list line gets both.
- tags.ts: `quiz` tag (aliases quiz/test) with the current brief; `ask` tag re-briefed for typed personalization ("collect the viewer's name/age with store+default and weave {name} into later narration").
- examples.json: quiz example already renamed (Task 1); ADD one small personalization example (collect name → greet with {name} → tiny figure) that clears the zero-lint bar.
- help.html: quiz row (reworded), ask row (typed; store/{var}; movie types the answer/default), video section sentence covers both demos.
- ROADMAP: Phase B ask entry updated (quiz shipped + typed ask shipped; branching/logging still future).
- [ ] Full suite green; commit.

---

### Task 8: Full gate, browser smoke, push

- `npx tsc && npm test && npm run build && npm run build:engine` all green; REBUILD BEFORE SMOKE (the stale-dist trap).
- Playwright against `vite preview --host`: play the personalization example → type a name → later caption contains the name; skip → caption contains the default; play the quiz example → quiz card still works (rename regression). Check-mode ask (edit spec inline): wrong answer with retry → field clears and stays; correct → green + proceeds.
- Movie demos: phase functions are unit-tested and the painter is export-only; a real export needs the TTS key → Hans verifies the rhythm in prod. State this in the report.
- `git log` (parallel sessions), commit remaining, push, ls-remote; update memory.

## Self-review notes

- Decisions honored: rename-first; default mandatory with store; movie types answer (check) / default (collect); reveal default true, retry default false, both check-mode-only; store naming `{var}`-interpolation.
- Consistency: gate resolves STRINGS everywhere (auto = the typed performance's text), so the player has one code path; collectSpeakLines' pushed lines match exactly what the player can speak in the auto path (right if present — with reveal's right??answer covered since auto is always "correct").
  Wait — auto path is always correct, so reveal lines (right ?? answer on wrong) never play in movies; collection pushing (right ?? answer) covers the check-mode movie's only extra line when right is absent... the player speaks right-if-present on correct; if right absent it speaks NOTHING on correct. So collection needs only `right` when present. But the plan above says push (right ?? answer) — harmless extra synthesis when right is absent; keep it as slack for future paths. Documented, intentional.
- The retry UX lives in the gate (no per-attempt remount); the player's retry loop remains correct for gates that DO resolve wrong strings (export never does; bare player never wrong).
