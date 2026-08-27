# Explore Command Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans.

**Goal:** `{"explore": {"params": ["n"]}, "speak": "Try some numbers yourself."}` — the storyboard opens the ⊕ tray at the right moment (optionally restricted to named sliders), the viewer explores until Continue ▶; plus an ambient ⊕ pulse after any personalized animate, and tray sliders that start at the viewer's own committed numbers.

**The movie rule, sharpened:** in export/auto (or any player without the tray wired), the ENTIRE step vanishes — action AND its paired narration. An exploration invitation spoken over a movie that cannot explore is the dangling-intro bug reborn; the guard sits in runStep before narration starts, and collectSpeakLines never collects an explore command's speak.

**Pieces:**
1. Spec: `Command.explore?: { params?: string[] }` (wire object, params optional string array); verb sites (schema wire+prose+ACTION_VERBS+semantics: params must be a string array when present; lint+plan ACTION_KEYS).
2. Plan: `{ kind: "explore"; params?: string[] }`.
3. Player: `exploreGate: ((signal, step) => Promise<void>) | null` injectable; runStep skip-guard `explore && (skipQuestions || autoAnswers || !exploreGate)` BEFORE narration; case awaits the gate. Public `settleParams()` (= applyParams(stateAt(completed)) — commit honest geometry + adopt handles MID-RUN, which renderUpTo cannot do without aborting the run) and public `getParamOverrides()` for the tray.
4. Tray: wires exploreGate — opens WITHOUT renderUpTo (the run is already parked on the gate; renderUpTo would abort it and replay the step = an invitation loop), optional param filter, Continue/toggle-close/abort all settleParams + resolve; slider start values overlay getParamOverrides (start from the viewer's number); ⊕ pulses for a few seconds when an animate step with varTargets completes (chained onStep).
5. collectSpeakLines: skip speaks on explore commands. Example: "Your own sample size" gains the explore beat. Prompt bullet + help row.
6. Tests: schema/plan/player (skip-silence incl. narration, gate path, settleParams via reprojector spy); browser smoke: tray auto-opens at the invitation with ONLY the n slider AT the typed value, Continue resumes, ⊕ pulsed.
