# Round 6 — Reveals, Choices, Icons Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The viewer's answer never moves (the truth is drawn beside it), choices are made on drawn objects, guess marks end or follow, a question can take its own page, sorting is faster (tap, tap-all, deck), and icons are keywords shown as original-colour pictures.

**Architecture:** Each feature is a field on an existing structure (ask `reveal_style`/`reveal_order`/`choose`/`stage`/`keep`; cards `select`/`deck`; icon `icon_look`). Reveals keep the viewer's answer as a guess mark ("yours") and add the truth as ink drawables/marks; the colour language lives in one module. Icons resolve from keywords through the existing resolver plus an offline cache file; pictures render the original SVG artwork as an image drawable in figure coordinates.

**Tech Stack:** TypeScript, vitest, the existing guess/cards/tree/formula/market code, the icon resolver.

**Spec:** `docs/superpowers/specs/2026-10-03-round6-reveals-choices-icons-design.md`

## Global Constraints

- The "beside" reveal is the DEFAULT for every guess form; `reveal_style: "morph"` reproduces today's behaviour exactly.
- Bars beside = halves (your half left, the true half right); your answer fades to 35 % at the next command.
- Colours: yours `#3f6fb5`, truth = ink, right `#4a7c59` (✓), wrong `#b3412e` (✗).
- Original-colour picture icons are the DEFAULT for card, node and decorative icons; `icon_look: "drawn"` for a standalone icon element that is the subject.
- Specs carry icon KEYWORDS only; data lives in `assets:` (published) or the offline cache (examples/tests); no inline `icon_strokes` in bundled examples after Task 1.
- Every bundled example lints with zero warnings and round-trips; movies never wait; interaction on the figure; MUTED browser checks (stub speech + AudioContext; confirm before every Play; re-navigate after reloads).
- Never `git stash/reset/checkout` in the shared checkout; commit by explicit path. Commit messages end with:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01A1vsD5SQX5gKYDo4aucaMp
  ```

## Review Focus

1. An existing guess example under the new default: your bar/line/pin stays put, the truth appears beside, nothing overlaps labels; `morph` gives today's frames exactly.
2. A `choose` option that is a template part or a group: the hit test and hover ring work; a tap on blank paper does nothing.
3. A deck sort of 30 items in a movie: never waits, ends with the boxes filled.
4. An icon keyword that is not in the offline cache during lint: a clear warning naming the keyword (never a silent empty card).
5. Scrubbing back over an answered beside reveal: "yours" and the truth both clear; forward again shows them.

---

### Task 1: Icons as keywords, offline cache, picture look (spec §8)

**Files:** `src/render/icon.ts` (resolver: picture data + traced data; prefer colour sets for pictures), new `src/scenes/icon-cache.json` + a loader used by lint/layout/tests, `src/layout/tier2.ts` (picture drawable for icons: an `image`-kind drawable with the SVG as a data URI, in figure coordinates, fade-in), `src/render/svg-backend.ts` (draw it), `src/spec/types.ts`/`schema.ts` (`icon_look`), `src/spec/assets.ts` (hoist icon data incl. node/card `icon_strokes` and pictures into `assets:`), the editor's folding (find the YAML/JSON editor in src/ui and fold `assets:` and strings > 200 chars), `scripts/` a tool to (re)build the cache from all keywords in examples, `src/examples.json` (strip inline icon data, keep keywords).
**Tests:** keyword-only spec lays out with icons from the cache; missing keyword → warning naming it; picture vs drawn drawables; hoist moves icon data to assets and back; examples lint clean with no inline icon data.
- [ ] TDD each piece; commit in pieces; full suite green at the end.

### Task 2: Choose on the figure (spec §4)

**Files:** `src/spec/types.ts`/`schema.ts` (`choose`: string[] | {id, goto?}[]), `src/render/plan.ts` (ask step `choose`), `src/render/player.ts` (a `chooseAsk`: judged/opinion/branch, `{c}`/`{c.id}`, movie laser tap), new `src/ui/choose-gate.ts` (hover rings on the options' outlines, tap/keys; reuse the click widget's hit-testing), `src/ui/controls.ts` routing, `src/lint/lint.ts` (undrawn option → error; decide cards repeating drawn objects → hint).
**Tests:** player (judged right/wrong, opinion, branch + then, movie); lint; a gate test with the fake DOM (tests/guess-account-gate.test.ts shows how).

### Task 3: Beside reveals (spec §3)

**Files:** new `src/guess/reveal.ts` (pure: given handles, the guess and the truth → "yours" marks + truth drawables per form; colour constants), `src/guess/marks.ts`, `src/render/player.ts` (guessAsk/cardsAsk/treeAsk/formulaAsk use beside by default; `reveal_style: "morph"` keeps today's path; `reveal_order: "each"`; fade to 35 % at the next command; erase with the figure), bar halves (the true bar drawn narrower in the right half — via a template param override for the guessed bars' width/offset during the reveal, or as ink drawables; pick the one that keeps the chart's own look), cards ✓/✗ + true-order column / arrows, tree/formula ✓/✗ colours.
**Tests:** per form, beside vs morph; each-order timing; fade at next command; scrub clears; examples unchanged under morph.

### Task 4: Marks end with their moment, kept marks follow (spec §5)

**Files:** `src/render/player.ts` (end guess marks when the guessed part next changes shape or at the next ask unless `keep: true`; recompute kept owners' marks on re-layout via the pure guess setup), `src/spec/types.ts`/`schema.ts` (`keep`).
**Tests:** the deadliest-animal case (a later layout change → marks gone; with keep → marks moved with the bar).

### Task 5: A question on its own page (spec §6)

**Files:** player + svg backend (fade the non-asked parts to 15 % during the ask, back over ~300 ms after its lines), types/schema (`stage: "own"`), lint (overlap warning).
**Tests:** visible/opacities during and after; movie path; lint.

### Task 6: Faster sorting (spec §7)

**Files:** `src/spec/cards.ts`, `src/cards/model.ts`, `src/ui/cards-gate.ts` (tap-to-move cycling; `select` one-bin form with items `{text, in}`; `deck` flow with up to 30 items, one large card, keys 1/2/…), player movie paths, lint/schema.
**Tests:** model tap cycle; select scoring; deck geometry, flow, movie never waits (review focus 3); fake-DOM gate tests.

### Task 7: Revisions, guidance, browser check, push (spec §9–§10)

- Revise "The deadliest animal", "Is it a fruit?" (+ a deck version), and the decision course's lecture 1 (dev-casts/courses/decision-mistakes/lecture-01: bags and doors via `choose`; icons as pictures; keywords only), plus other lectures' decide cards that repeat drawn objects.
- Guidance lines (prompt, rule card, #interactive), prompt-size re-pin once.
- Muted browser check of all touched examples at desktop and phone width; a generated cast; spec "As built"; final whole-branch review; merge and push.
