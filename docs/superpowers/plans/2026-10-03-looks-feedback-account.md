# Looks, Feedback and the Account Bar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rounded, shadowed card looks with icons on cards and boxes; optional feedback flavour lines (written by the cast's author) with small rewards; and an account bar that replaces rebalancing in budget questions.

**Architecture:** Box corners and shadows are new node fields drawn by the layout (an ordinary shadow drawable, no SVG filter) and the backend (rounded `shapeHint`). Card `look` presets expand into those node fields. A node or card `icon` is resolved by the existing icon pipeline and drawn inside the box. Feedback bands are computed by one pure module from each ask kind's score and spoken by the player after the author's line; rewards draw on a UI overlay, never in movies. The account bar is a guess mark driven by the guess gate.

**Tech Stack:** TypeScript, vitest, rough.js (sketchy backend), the Iconify-based icon resolver, WebAudio tones.

**Spec:** `docs/superpowers/specs/2026-10-03-looks-feedback-account-design.md` (read it with this plan; § references point into it).

## Global Constraints

- Every bundled example lints with zero warnings (`tests/examples.test.ts`) and passes `tests/script-roundtrip.test.ts`.
- `paper` is the default card look for ALL card examples, old and new (spec §9.1).
- `feedback` defaults to `plain`: no extra line and no reward unless a cast or ask sets a style (spec §9.2).
- Feedback lines are written by the cast's author in the cast's language; the bundled fallback set is English only and used only for English casts (spec §9.3).
- Movies and exports stay plain: no flavour lines, no rewards (spec §2).
- The shadow is an ordinary drawable (no SVG filter): it must look the same in sketchy, clean and mixed styles and in exports.
- Interaction on the figure, never the tray; short canvas text.
- Prompt-size pins in `tests/prompt-size.test.ts` move once, in Task 9.
- Browser checks run MUTED: an initScript stubbing `speechSynthesis` and `AudioContext`; confirm the stub before EVERY Play; re-navigate after any reload or dev-server restart. Use a private port per agent.
- Never `git stash`/`reset`/`checkout` in the shared checkout; commit by explicit path. Commit messages end with:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01A1vsD5SQX5gKYDo4aucaMp
  ```

## Review Focus

1. **An existing card example with sort bins or decide options** under the new `paper` default: bins, end words, decide options and fill tiles must still fit; nothing overlaps (the new rounded boxes are the same size as today's). Pinned in Task 3 by an examples layout-overlap check.
2. **An icon that cannot be resolved offline** on a card: the card shows text only, the same height as a card without an icon, and only the existing `no icon for "…"` warning. Pinned in Task 2.
3. **A budget question where a bar is dragged past the budget**: the account goes negative (red, below the baseline) and Answer stays disabled; typing a number into a bar works the same way. Pinned in Task 5.
4. **A non-English cast with `feedback: "dry"` and no lines**: no line is spoken (no English fallback in a Norwegian cast), and lint warns. Pinned in Task 6/8.
5. **The movie of a cast with feedback and rewards**: no flavour line, no confetti, no picture, no joke; the run never waits. Pinned in Task 7.

---

### Task 1: Rounded corners and shadows on boxes

**Files:**
- Modify: `src/spec/types.ts` (SpecElement node fields), `src/spec/schema.ts`
- Modify: `src/layout/tier2.ts` (the `shape === "rect" || "decision"` branch, ~line 1629)
- Modify: `src/layout/model.ts` (`ShapeHint` rect gains `r?: number`)
- Modify: `src/render/svg-backend.ts` (hint drawing: `hintRing`, `hintOutlineD`, the rough path for rect hints, `drawLeafClean`)
- Test: `tests/node-radius-shadow.test.ts`

**Interfaces:**
- Produces: node fields `radius?: number` (canvas units, default 0) and `shadow?: boolean`; `ShapeHint` rect `{type:"rect", x, y, w, h, r?}`; a shadow drawable with id `<nodeId>__shadow` (z just below the box) when `shadow` is true.

- [ ] **Step 1: Failing test** — layout a spec with `{id:"b", type:"node", shape:"rect", text:"Hi", x:300, y:300, radius:10, shadow:true}` and assert: the box drawable's `shapeHint.r === 10`; its `pts` ring has rounded corners (more than 4 distinct points, and no point equals the square corner `[x-w/2, y-h/2]`); a drawable `b__shadow` exists, offset by (3, −4) in y-up logical units (check the sign convention in `rectPts`), filled with the ink at opacity 0.12, no stroke, z below `b`; without `radius`/`shadow` the output is byte-identical to today (snapshot the drawables of a plain rect node before and after).
- [ ] **Step 2: Run — FAIL.**
- [ ] **Step 3: Implement** — a `roundedRectPts(c, w, h, r)` helper next to `rectPts` (corners as 4-segment arcs, r clamped to min(w,h)/2); the rect branch uses it when `radius > 0` and sets `shapeHint.r`; the backend draws a rect hint with `r` as a rough path (`rc.path` of the rounded outline) in sketchy and as an exact `<path>` with arcs in clean; `hintRing`/`hintOutlineD` honour `r` (dashed outlines and fills follow the corners); the shadow is pushed before the box as `{id: el.id+"__shadow", kind:"area", pts: roundedRectPts(c+offset, …), style:{fill: ink, opacity: 0.12, stroke: none}, z: Z_STROKE - 1}` and attached to the box (it moves, hides and erases with it — use the same mechanism `attached`/`drawnWith` the layout uses for a node's text).
- [ ] **Step 4: Run — PASS**; run `tests/examples.test.ts`, `tests/script-roundtrip.test.ts`, any svg-backend tests.
- [ ] **Step 5: Commit** — "Boxes: rounded corners and a soft shadow"

---

### Task 2: Icons inside boxes

**Files:**
- Modify: `src/spec/types.ts`, `src/spec/schema.ts` (node `icon?: string | {of: string; set?: string}`, machine-written `icon_strokes?: string`)
- Modify: `src/render/icon.ts` (`resolveIcons` also resolves node icons, writing `icon_strokes`), `src/publish/embed.ts` if it filters by type
- Modify: `src/layout/tier2.ts` (rect node with an icon: grow height, draw the icon rings inside above the text)
- Test: `tests/node-icon.test.ts`

**Interfaces:**
- Produces: a node with `icon` lays out as box + icon + text, all moving/hiding/erasing with the node id; box height grows to fit (icon ≈ 45 % of the box height; a card with an icon is 96 high); an unresolved icon → text only, normal height, the existing `no icon for "…"` warning.

- [ ] **Step 1: Failing tests** — (a) `resolveIcons` with stub deps (follow the existing icon tests' deps stubbing) fills `icon_strokes` on a node with `icon: "shark"`; (b) a node with `icon_strokes` lays out taller and has icon drawables inside the box bbox, above the text; (c) a node with `icon` but no strokes lays out exactly like one without an icon and reports the warning (review focus 2).
- [ ] **Step 2: Run — FAIL.**
- [ ] **Step 3: Implement** — reuse `iconDrawable` (tier2 ~2247) for the rings, scaled into a square of side 0.45·h centred horizontally in the upper part of the box; the text moves down; all icon drawables are attached to the node like its text. The resolver's cache key and licence checks are the same as for icon elements.
- [ ] **Step 4: Run — PASS**; plus the existing icon tests.
- [ ] **Step 5: Commit** — "Boxes: an icon inside"

---

### Task 3: Card looks and icons on cards

**Files:**
- Modify: `src/spec/cards.ts` (`look`, item `icon`, card heights, `cardsElements` emits `radius`/`shadow`/fill and `icon` on the card nodes and bins/tiles/options), `src/spec/types.ts`, `src/spec/schema.ts`
- Modify: `src/cards/model.ts` only if geometry heights live there
- Test: `tests/cards-look.test.ts`

**Interfaces:**
- Produces: `cards.look?: "paper" | "flat" | "outline"` (default `paper`): paper = radius 10, fill `#fffdf8`, shadow; flat = radius 10, fill = ink at 8 %, no shadow; outline = today. Item `icon` → the card node's `icon`; the geometry uses the taller height (96) for every card of an element when ANY item has an icon (rows stay even).

- [ ] **Step 1: Failing tests** — expand a rank, sort, compare, decide and fill cards element with and without `look`/`icon` and assert the node fields; geometry heights; bins under `paper` get rounded ends; `outline` reproduces today's elements exactly.
- [ ] **Step 2: Run — FAIL.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Overlap check (review focus 1)** — add to `tests/cards-look.test.ts` a pass over every bundled example with a cards element: layout it and assert no card overlaps another card, a bin title, or the canvas edge at its initial and true positions (reuse the layout lint's overlap helper if there is one). Run `tests/examples.test.ts`, `tests/cards*.test.ts`.
- [ ] **Step 5: Commit** — "Cards: paper, flat and outline looks; icons on cards"

---

### Task 4: Two examples with icons and a scene

**Files:** `src/examples.json` ("What is more dangerous", "What each drug does"); dev copies in `dev-casts/round5/`.

- [ ] **Step 1:** "What is more dangerous": icons on every card (shark, lightning, snake, mosquito, a police siren for murder, car); a short opening scene (a beach with a fin) drawn with existing elements before the cards; narration moves from the scene to the question (connected sentences; opening says what it's about).
- [ ] **Step 2:** "What each drug does": icons on drugs (pill, syringe, capsule, heart) and effects (blood drop, glucose meter, bacterium, artery). Keep every number, source and line that still fits.
- [ ] **Step 3:** `npx vitest run tests/examples.test.ts tests/script-roundtrip.test.ts`; resolve each icon once with the real resolver (network) to confirm every keyword finds an icon; record the icon each found in the report.
- [ ] **Step 4: Commit** — "Examples: icons and a scene for the dangers and the drugs"

---

### Task 5: The account bar

**Files:**
- Modify: `src/ui/guess-gate.ts` (budget: no `constrain`/`withBudget`; account state; Answer enabled only when balanced; hint "Balance the budget: {left} left" / "{over} over"; the total pill removed)
- Modify: `src/guess/handles.ts` (remove `withBudget`; add `accountOf(values, budget)`), `src/guess/marks.ts` (the account bar mark), `src/render/player.ts` (movie: glide to `default` or an even split, account reaches zero; `GuessSession` exposes the bar geometry the marks need)
- Modify: `src/lint/lint.ts` if budget rules mention rebalancing; `src/examples.json` "Your health budget" wording
- Test: `tests/guess-account.test.ts`

**Interfaces:**
- Produces: `accountOf(values: number[][], budget: number): number` = budget − sum; a mark set `accountMarks(handles, values, budget, label)` drawing a bar right of the plot on the same y scale, labelled `account_label ?? "Left"`, in GUESS_COLOR, red (`#b3412e`) below the baseline when negative, with its number; ask field `account_label?: string` (schema).

- [ ] **Step 1: Failing tests** — moving one bar leaves the others unchanged; account = budget − sum; negative account → mark below the baseline, red; balanced within half a step → "balanced" true; the movie run ends balanced and never waits; `judge: false` path unchanged (review focus 3: a bar dragged past the budget and a typed number past it).
- [ ] **Step 2: Run — FAIL.** **Step 3: Implement.** **Step 4: Run — PASS** plus `tests/guess-*.test.ts`, examples.
- [ ] **Step 5:** Update "Your health budget" narration ("balance it" instead of "the others adjust").
- [ ] **Step 6: Commit** — "Budget questions: an account bar that must balance"

---

### Task 6: Feedback bands and lines

**Files:**
- Create: `src/feedback/bands.ts` (pure), `src/feedback/lines.ts` (English fallback set)
- Modify: `src/spec/types.ts`, `src/spec/schema.ts` (cast-level `feedback` and ask `feedback`: `"plain" | "warm" | "dry" | {style, reward?, perfect?, good?, poor?, none?}` where a band is a string or string[])
- Modify: `src/render/player.ts` (after the author's right/wrong line: the band line, for every ask kind — guess, cards, tree, formula, market, typed/check-mode asks, quiz if it has right/wrong), `src/render/plan.ts` (carry the resolved feedback onto the ask step)
- Test: `tests/feedback-bands.test.ts`, additions to a player test file

**Interfaces:**
- Produces:
  ```ts
  export type Band = "perfect" | "good" | "poor" | "none";
  export function bandOf(r: { within?: number; count?: number; ok: boolean; frac?: number; tolerance?: number }): Band;
  export interface FeedbackSpec { style: "plain" | "warm" | "dry"; reward: "auto" | "none" | "confetti" | "picture" | "joke"; lines: Partial<Record<Band, string[]>> }
  export function resolveFeedback(cast: unknown, ask: unknown): FeedbackSpec;
  export function pickLine(fb: FeedbackSpec, band: Band, lang: string | undefined, seed: number, used: Set<string>): string | null;
  ```
  Bands: counted tasks (cards, tree blanks, formula blanks, several guesses) — all right = perfect, ≥ ⅔ = good, some = poor, none = none; a single guess — within tolerance = perfect, within 2× = good, else poor; a single right/wrong ask — perfect / none; a skip — no line.
- `pickLine`: the cast's own lines first (ask lines win over cast lines); else the English fallback ONLY when the cast's `lang` is absent or English; no repeat within a cast (seeded by the cast); `{vars}` substituted by the existing subVars.

- [ ] **Step 1: Failing tests** — `bandOf` cases; `resolveFeedback` precedence; `pickLine` uses authored lines, falls back in English, returns null for a Norwegian cast without lines (review focus 4), no repeats; player: a cards ask with `feedback: {style:"dry", perfect:"…", poor:"…"}` speaks the author's line then the band line; `plain` speaks nothing extra; a skip speaks nothing extra; the movie speaks nothing extra (review focus 5).
- [ ] **Step 2: Run — FAIL.** **Step 3: Implement.** **Step 4: Run — PASS** plus the player test files for every ask kind.
- [ ] **Step 5: Commit** — "Feedback: a line for how well you did, written by the cast's author"

---

### Task 7: Rewards

**Files:**
- Create: `src/ui/rewards.ts` (confetti overlay, still badge for reduced motion, reaction picture, joke line)
- Create: `src/feedback/jokes.ts` (English, clean, one-liners), reaction picture keywords (twemoji, through the icon resolver)
- Modify: `src/render/player.ts` (emit a `reward` event/effect after the band line with `{kind, band, part box}`; `{streak}` var), `src/ui/controls.ts` (wire the overlay), `src/render/tones.ts` use for a soft chime under the player's mute
- Test: `tests/rewards.test.ts`

**Interfaces:**
- Produces: `rewardFor(fb: FeedbackSpec, band: Band, long: boolean, streak: number): "sparkle" | "confetti" | "picture" | "joke" | null` (pure) — auto: right single → sparkle; perfect long (≥ 4 items or several parts) or streak ≥ 3 → confetti; picture/joke only when asked; never on skip; never in movies/exports.
- `{streak}`: right answers in a row (reset on a wrong or skipped judged ask).

- [ ] **Step 1: Failing tests** — `rewardFor` table; the player emits rewards live only (autoAnswers/movie → none); `{streak}` counts; reduced motion → badge (unit-test the overlay's choice function).
- [ ] **Step 2: Run — FAIL.** **Step 3: Implement** — confetti: ~60 paper pieces on a canvas overlay above the stage, 1.5 s, removed after; sparkle: the existing `glow()` with ANSWER_OK_COLOR, short; picture: a large twemoji (🎉 🏆 perfect, 🤦 🙈 none) beside the figure for 2 s, resolved through `resolveIcons`-style fetch with the twemoji set (CC BY credit kept off-canvas as icons do); joke: spoken + captioned after the band line.
- [ ] **Step 4: Run — PASS.**
- [ ] **Step 5: Commit** — "Feedback: sparkle, confetti, a reaction picture or a joke"

---

### Task 8: Lint and two flavoured examples

**Files:** `src/lint/lint.ts`, `src/examples.json`, test `tests/feedback-lint.test.ts`.

- [ ] **Step 1: Failing test** — warnings: band lines with `style: "plain"`; `reward: "joke"|"picture"` with plain; a non-English cast with a non-plain style and no lines; a card `icon` of more than three words. Schema error: `look` on a non-cards element.
- [ ] **Step 2: Run — FAIL.** **Step 3: Implement.** **Step 4: Run — PASS.**
- [ ] **Step 5:** Add `feedback` to "What each drug does" (dry; lines about pharmacists, kind not mean) and to "What is more dangerous" (warm); reward auto.
- [ ] **Step 6: Commit** — "Feedback: lint, and flavour on two examples"

---

### Task 9: Guidance

**Files:** `src/llm/tags.ts` (#interactive), `src/llm/prompts/compiler-v1.md`, `.claude/skills/drawcast/references/rule-card.md`, `tests/prompt-size.test.ts`.

- [ ] **Step 1:** Spec §6 lines: icons on cards and boxes for concrete things; `look` exists (default is fine); `feedback` optional, for longer quizzes and lighter topics, never for serious personal topics; when used, write the four band lines yourself — short, in the cast's language, about its topic, kind rather than mean; the budget ask balances against an account. Keep it short; one example ask with feedback lines.
- [ ] **Step 2:** Re-pin `tests/prompt-size.test.ts` once; a test that the prompt's example ask validates (follow `tests/round4-prompt.test.ts`, finding examples by TITLE).
- [ ] **Step 3: Commit** — "Guidance: icons on cards, feedback lines, the account bar"

---

### Task 10: Browser check, a generated cast, as built, push

- [ ] **Step 1:** Muted browser check of every touched example (desktop 1280×800 and phone 390×844): card looks and icons, the beach scene, the account bar (drag past the budget, balance, Answer), feedback lines and each reward. Fix what's found (one fix wave).
- [ ] **Step 2:** Generate one `#interactive` cast with the prompt lab on a light topic (e.g. "Which animal is deadliest? #interactive") and check it uses icons and, if feedback, writes its own lines in its language.
- [ ] **Step 3:** Full suite + tsc green; spec §10 "As built"; merge to main and push.
