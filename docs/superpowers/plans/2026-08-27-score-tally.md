# Score Tally Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Every answered quiz/check-ask feeds two reserved variables, `{score}` and `{score_total}`, usable everywhere stored answers already work — narration ("You got {score} of {score_total}!"), captions, and `if` conditionals (`{"if": {"var": "score", "gte": 2, "goto": "well_done"}}`). No new verbs.

**Architecture:** Outcomes live per QUESTION STEP (`Map<stepIndex, boolean>` on the Player), so re-answering after a remediation goto OVERWRITES that question's slot instead of double-counting, and replays self-correct. The counters are written into `Player.vars` as digit strings right after each answer and BEFORE the feedback lines speak, so "That makes {score}!" reflects the fresh answer. Values stay strings by design (the stored text is the truth); every consumer coerces at use — `if`'s numeric ops already `Number()` at comparison time, interpolation is verbatim — so digit strings read naturally in text AND compare numerically. `collectSpeakLines` simulates the movie's tally (auto answers are always correct) so exported TTS lines interpolate correctly, question lines with the pre-answer state and feedback lines with the post-answer state.

**Rules:** A skipped answer (null) counts as answered-wrong (a test is a test); questions skipped by the skip-questions preference count not at all (and score-`if`s are already suppressed there). `score`/`score_total` are RESERVED: `ask.store` may not claim them (validation error) and the ask-var lint does not flag them (they exist automatically).

**Tasks:**
1. Player: `outcomes` map + `updateScoreVars()`; set in the quiz case (after the gate + question voice, before feedback) and the ask check-mode case (after the retry loop, before feedback). Tests: 1-of-2 spoken tally; skip counts wrong; remediation re-answer overwrites to 1-of-1; `if score gte 1` jumps; auto answers give N-of-N.
2. Schema: reserved store names error. Lint: exempt reserved names in ask-var. Tests for both.
3. `collectSpeakLines`: simulate the tally (pre-answer for question lines, post-answer for right/reveal). Test.
4. Docs: prompt (one sentence on {score}/{score_total} under quiz), help row, ROADMAP; the bundled quiz example ends with the tally line. Gate, push.
