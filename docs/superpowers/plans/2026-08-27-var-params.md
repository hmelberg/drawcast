# Personalized Params (var → animate) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** A stored ask answer drives the figure: `{"animate": {"n": "{n_choice}"}}` glides a template param to the viewer's own value — "you typed 60, watch the distribution squeeze to YOUR sample size."

**Architecture:** The wire lets an animate value be a `"{var}"` token (validated: pure token, referencing an EARLIER ask's store). The plan resolves the token's FALLBACK from that ask's mandatory `default` (`Number(default)`, must be finite) — so `step.targets` and every precomputed boundary state stay plain numbers (scrub-exact, movie-deterministic: movie vars ARE the defaults), and the step carries `varTargets: {path → varName}`. At runtime the player resolves each varTarget from `vars` (coerce `Number`, ignore non-numeric → fallback), tweens to the RESOLVED value, and records it in a `varParamOverrides` map that `applyParams`/`previewParams` overlay — but ONLY onto paths already present in the incoming params, so boundaries BEFORE the animate stay untouched and scrubbing after it keeps the personalization.

**Rules:** No new verbs, no plan-state type changes. Coerce-at-use holds: vars stay strings; `Number()` at resolution; non-numeric answers degrade to the fallback, never break the figure. Movies and skip-mode are automatically consistent (their vars hold the defaults = the fallbacks).

**Tasks:**
1. Types/schema: `Command.animate: Record<string, number | string>`; semantic check: each value finite number OR `/^\{[a-z][a-z0-9_]*\}$/i` token whose var an earlier ask stores (error otherwise). Tests.
2. Plan: collect store→default while walking; animate arm resolves tokens → fallback number into `targets` + `varTargets` on the step (drop + warn when the default isn't numeric). Tests.
3. Player: `varParamOverrides` map + `withVarOverrides(params)` (overlay only paths present); `applyParams` and `previewParams` go through it; the animate case resolves varTargets from `vars` into the tween's targets and records overrides. Tests via makeReprojector: tween ends at the typed value; scrub-forward keeps it; scrub-to-0 untouched; no answer → fallback.
4. Example "Your own sample size" (sampling_dist: collect n_choice, default numeric, var-animate), prompt/help/ROADMAP, full gate, push.
