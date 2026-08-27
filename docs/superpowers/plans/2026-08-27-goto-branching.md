# Goto Branching Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `label` markers in the storyboard plus `right_goto`/`wrong_goto` on quiz and ask — a wrong answer can jump back to re-watch an explanation (the quiz then comes again), a right answer can skip ahead. Jumps fire only on real viewer answers; movies and auto-paths stay strictly linear and always terminate.

**Architecture:** `label` is a new no-op command/step; the Plan carries a `labels: Record<string, number>` map (name → step index, resolved at plan time so forward references work). The quiz/ask cases set a `pendingJump` after their feedback; the play loop performs it via a new private `jumpTo(n, keepPlaying)` — renderUpTo minus abortRun (a jump must not abort its own run). A public `Player.autoAnswers` flag, set by the exporter (and implied by gate-less playback), suppresses all gotos — the principles doc's "branching content exports its default path".

**Spec:** `docs/superpowers/specs/2026-08-27-interactivity-principles.md` §4 (redirection: play continues FROM the target — that is the whole point of a jump) and §3/§5 (movies never wait, never loop; pick-a-path exports the default path).

## Global Constraints

- Verb sites for `label`: schema ACTION_VERBS + prose, plan ACTION_KEYS, lint ACTION_KEYS, compiler-v1.md. (`right_goto`/`wrong_goto` are fields inside quiz/ask — no new verb.)
- Gotos NEVER fire when `autoAnswers` is true or the answer was skipped (null) — movies/bare players are linear and terminate by construction. Viewer-driven loops (wrong → re-watch → try again) are intended and are bounded by the human answering each round.
- `retry` and `wrong_goto` on the same ask are mutually exclusive (validation error).
- Goto targets are validated statically: an unknown or duplicate label is a spec error.
- Repo norms: tsc+tests per commit, `git log` before each commit, trailers, push at round end.

## Tasks

### Task 1: Spec — `label` command, goto fields, validation
Files: `src/spec/types.ts` (Command.label?: string; QuizArgs/AskArgs `right_goto?: string; wrong_goto?: string`), `src/spec/schema.ts` (wire: `label: { type: "string" }` + goto fields on both question objects with descriptions stating the viewer-only/movie-linear rule; ACTION_VERBS + prose gain `label`; semantic pass: label name matches `/^[a-z][a-z0-9_]*$/i`, duplicate labels error, every `right_goto`/`wrong_goto` must name an existing label, ask retry+wrong_goto error), test `tests/goto-schema.test.ts`.
TDD: valid label+goto spec passes; unknown target fails; duplicate label fails; retry+wrong_goto fails; label+draw combined fails (one-verb rule).

### Task 2: Plan — label step and the labels map
Files: `src/render/plan.ts` (step `{ kind: "label"; name: string }`; `Plan.labels: Record<string, number>`; ACTION_KEYS + arm: record `labels[name] = steps.length` then pushStep; quiz/ask steps carry `rightGoto?/wrongGoto?` copied from the wire fields), `src/lint/lint.ts` ACTION_KEYS, test `tests/goto-plan.test.ts`.
TDD: labels map holds the step index (forward and backward); quiz step carries the goto names; label step is kind "label".

### Task 3: Player — jumpTo, pendingJump, autoAnswers
Files: `src/render/player.ts`, test `tests/goto-player.test.ts`.
- Extract `private jumpTo(n: number, keepPlaying: boolean)` from renderUpTo (everything but abortRun; `setState` only when !keepPlaying). `renderUpTo(n)` = `abortRun(); jumpTo(n, false)`.
- `autoAnswers = false` public field; `private pendingJump: number | null = null`.
- `case "label"`: return (instant no-op).
- quiz case: after the feedback speech — `const viewer = !this.autoAnswers && this.quizGate !== null && chosen !== null; const target = chosen === step.correct ? step.rightGoto : step.wrongGoto; if (viewer && target !== undefined && this.plan.labels[target] !== undefined) this.pendingJump = this.plan.labels[target];`
- ask case: same shape in check mode (viewer = gate existed, typed !== null, !autoAnswers; outcome from isRight of the FINAL typed).
- play loop: after `await this.runStep(...)`, `if (!ac.signal.aborted && this.pendingJump !== null) { const n = this.pendingJump; this.pendingJump = null; this.jumpTo(n, true); continue; }` (before completed++/onStep of the normal path — check the loop's exact shape and keep onStep firing once via jumpTo). Clear pendingJump in abortRun.
TDD (speech-sequence style, RecordingSpeech): wrong answer with wrong_goto to an earlier label replays the intervening speak and re-asks (gate answers wrong then right → the recap line heard twice, then the right line, state done); right_goto forward skips the in-between speak; autoAnswers=true → no jump; skipped (null) → no jump; goto with skipQuestions on → question skipped entirely, no jump.

### Task 4: Export + docs + example
- `src/export/video.ts`: `handle.timeline.autoAnswers = true;` beside the gate assignments.
- compiler-v1.md: `label` in the verb list + bullet (`{"label": "shift_explained"}` — a named position, snake_case); quiz/ask bullets gain: `wrong_goto` jumps back to a label so the viewer re-watches and the question comes again — the classic remediation loop; `right_goto` skips ahead; movies always play straight through.
- help.html: label row + one sentence on branching in the quiz/ask rows.
- ROADMAP: move goto branching to shipped; still future: score tally, logging, params.
- examples.json: the "Demand up, price up — quiz" example gains `{"label": "shift_explained"}` before the shift-draw beat and `wrong_goto: "shift_explained"` on its first quiz — the remediation showcase (static tests never trigger it; the examples bar must stay green).

### Task 5: Gate + smoke + push
tsc, full tests, both builds, REBUILD before smoke. Playwright: play the quiz example, answer question 1 WRONG → the playhead jumps back (step indicator decreases, the shift narration replays), the quiz comes again, answer right → continues to question 2 and finishes. Then autoAnswers sanity is covered by tests. Push, ls-remote, memory.

## Self-review
- §4 honored: play continues FROM the target (jumpTo sets completed=labelIndex; the label step no-ops and the run continues) — not back at the jump point.
- Termination: gotos need a live gate + non-null answer + !autoAnswers; export sets autoAnswers, bare players have no gates — no unattended loop is reachable.
- Type consistency: plan fields `rightGoto`/`wrongGoto` (camelCase in the step, snake_case on the wire, converted in the arm, same as fallback/default).
