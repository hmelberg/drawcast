# Prompt rule audit (2026-09-27)

Step 1 of the plan "plan → stage → look". A document only: no prompt or code
has been changed. Hans reads it and decides each rule's fate.

Sources audited: `src/llm/prompts/compiler-v1.md` (the single-figure prompt),
`PEDAGOGY_RUBRIC` in `src/llm/compile.ts`, the storyboard system prompt in
`src/llm/storyboard.ts`, and the tag briefs in `src/llm/tags.ts` (opt-in, so
only skimmed). The code prompt (`compiler-v1-code.md`) is almost all tool
facts, so it is left out of this audit.

## The three kinds

- **a — tool fact.** Something the model cannot know without being told: syntax,
  what a verb does, engine behaviour, a known trap. These stay as rules, in a
  reference section.
- **b — house taste.** A choice a good explainer might make either way, where
  Hans has picked one: no neon, a heading card, ink within seconds, no
  signposting. Keep each one as a single line with its reason.
- **c — general craft.** Good explaining or design that a strong model already
  knows: give the why, use contrast, lead with a concrete example, model first
  then world, align things. It depends on context, and it is often worded around
  the one example that prompted it. Candidates to shorten, to show through an
  example instead, or to hand to a critic that can see the result.

## Where the prose goes (compiler-v1.md, about 58k characters)

| Section | Characters | Mostly |
|---|---|---|
| Intro, coordinates, approach, freehand rules, color, text (lines 1–40) | ~15k | a, some b |
| **Narration and drawing commands** (41–69) | ~14k | **b and c** |
| Verbs + elements (71–131) | ~28k | a, with b guidance woven in |

The teaching advice is concentrated in about 14k characters: roughly 25 bullets
between the verb reference and the schema, inside a system prompt of about 270k
characters. It is read while the model is also writing minified JSON.

## Rule by rule — Narration and drawing commands (the contested section)

| # | Rule (short) | Kind | Prompted by | Proposed fate |
|---|---|---|---|---|
| N1 | One verb per command; `speak` on the action | a | — | Keep in the reference |
| N2 | Speak = short sentence for the ear | c | — | One line in the taste sheet |
| N3 | Foreign words `[de:…]` | a | — | Keep in the reference |
| N4 | `draw`, `parallel`, template sets | a | — | Keep in the reference |
| N5 | Scaffolding fast and unnarrated; `speak`+`draw` marks what matters | b | — | Keep, but see **conflict C2** |
| N6 | Unmentioned elements are drawn at the end; mention them in a deliberate order | a + c | — | Keep the fact; drop the advice |
| N7 | One sentence per beat; simple figure 4–8 sentences | b | — | Keep, but see **conflict C3** |
| N8 | Start on the canvas; card heading; opening says what it is about | b | Sept 24–25 lessons | Keep (core house taste); merge with N9 |
| N9 | Situate: stakes before mechanics, everyday question | c (+b) | lead-time bias | Merge into one "opening" line with N8 |
| N10 | Keep the canvas moving (≤2 speak-only in a row) | b | — | Keep (lint already enforces it) |
| N11 | Canonical beat + `cue` / `cue_end` | a + b | — | Keep the fact; the "canonical beat" goes in examples |
| N12 | Gestures take narration; one per 2–3 beats; highlight vs point | a + b | — | Keep the "which gesture" fact; drop the ratio (see C4) |
| N13 | Step by step through one example with numbers; exaggerate; define on draw; a formula earns its place; currency | c (+b currency) | ball / DWL lessons | Shorten to one line + currency; exaggeration is shown by examples |
| N14 | Announce a change before the figure makes it; ghost the old | c | rent cap | Critic concern + example; see **C5** |
| N15 | Say what we are doing and why; show the working in `scratch` | c + a | decision tree | Keep the `scratch` fact; see **C1** |
| N16 | Give the why; contrast; distinction | c | chocolate | One line; examples show it |
| N17 | Model first, then the world | c | rent cap | One line, or leave to the model |
| N18 | Show the thing, then its chart; align | c + a | falling ball | Keep the `box: auto` / `bind` fact; the rest is for the critic |
| N19 | Explain in passing; no signposting; intelligent viewer | b | — | Keep (core house taste) |
| N20 | Make it land: one insight, end by naming it | c | — | Already the prompt's opening sentence — drop the duplicate |
| N21 | Make it interesting, vary the kind; truth guard | b | Aug 26 | Merge with N22 |
| N22 | One enrichment or none | b | Aug 26 | Merge with N21 (they say the same thing twice) |
| N23 | Directing tips: be generous with what happens; erase scaffolding | b | Sept 12 | Keep one line |

## Elsewhere in compiler-v1.md

- **Intro (teacher persona, one insight, concrete example, end naming it)** —
  c/b. This is the goal statement. Keep it, move it into the taste sheet, and
  make it the first thing read.
- **Approach 1 routing hints** ("area of a circle is `circle_sectors` …") — a.
  These duplicate the router and the catalogue. Move them into the catalogue
  entries.
- **Freehand 2** ("list the parts before writing … at most 30 elements, 15
  beats") — planning advice (c) plus limits (b). In a treatment → staging split
  this planning happens in the treatment call. See C3 for the beat limit.
- **Freehand 3** (layouts, `walk`, peers as a grid, split past nine) — a + b.
  Keep.
- **Color** — the palette and color-by-role (b); "color is information" (c).
  Keep the palette; shorten the rest.
- **Verbs** — a. A few taste lines ride inside: focus for regions, highlight
  for moments; one or two `animate` beats; a quiz at the end by default; `wait`
  only when asked. Keep them, but collect the taste lines in the taste sheet so
  they are not scattered.
- **Portrait / source / icon / annotation** — a, plus b defaults (cameo on the
  naming beat, at most 1–2 annotations). Keep.
- **"The rules above are defaults, not laws"** — b. It sits at the **end**,
  after 55k characters of rules. It belongs at the top of the taste sheet.

## PEDAGOGY_RUBRIC (runs after generation, low effort)

All nine items repeat compiler bullets (N8/N9, N8, N21, N20, N19, N19, N12,
Freehand 1, Freehand 3). Item 9 ("WALKED LIST") is a tool fact in a teaching
checklist. Item 2 directly contradicts the compiler (C1b). Since this pass can't
change the figure and runs at low effort, it is the weakest place for any of
this. Proposed fate: replace it with the vision "look" pass (plan, stage 3).

## Storyboard prompt (multi-part)

Its teaching rules are a third copy of N8/N9/N19/N20/N21, reworded. It has **no
affordance sheet**: the writer doesn't know about `walk`, `step`, `scratch`,
`animate`, `ghost`, `focus`, cameos or quizzes, yet the artist may not change
its lines. It also holds one rule the single-figure prompt lacks: *"the player
leaves a silence after a question mark, so the line after a rhetorical question
begins the answer."* That is a tool fact (a), and single figures need it too.

## Conflicts and tensions

- **C1a — "Say what we are doing" (N15) vs "never by announcement" (N19).**
  N15's model sentence ("A decision tree is one way to answer that: it lays
  out …") is exactly the kind of framing N19 warns against. Both are right in
  context. The distinction the model needs is between *stating the plan* (fine,
  in one clause) and *pointing at the screen* ("notice that"). Neither bullet
  says so.
- **C1b — Opening: compiler "No standalone speak before the first drawing"
  vs pedagogy rubric "at most one short standalone speak before ink".** The
  checker is looser than the rule it checks. The examples follow the strict
  rule: none opens with a standalone speak. That makes the ratchet in
  `tests/examples-style.test.ts` (pinned at 74 speak-first openings) look
  stale; it could come down to 0.
- **C2 — "The opening line rides the first draw" (N8) vs "scaffolding is
  drawn unnarrated" (N5).** The first thing drawn is usually scaffolding.
  Few-shot "When demand rises" puts its opening question on `draw: ["axes"]`,
  and the examples settle it that way.
- **C3 — Length: "4–8 sentences for a simple figure" / "as many beats as it has
  ideas" (N7) vs "at most about 15 beats" (Freehand 2) vs the storyboard's
  "8–14 lines per part".** Three different numbers.
- **C4 — Gesture density: "about one per two or three beats" (N12) vs "the
  limit is meaning, not count" (N23).** One is a quota, the other a judgment.
- **C5 — "Announce a change before the figure makes it" (N14) vs "never speak
  about something not yet on the canvas" (N13) and the canonical "draw WHILE
  the sentence describes it" (N11).** N14 is the exception for *changes*, but
  it is written as a separate law instead of as that exception.
- **C6 — Five demands on the first two beats:** say what it is about (N8),
  situate the stakes (N9), open with a question or everyday puzzle (N9), say
  what method we'll use (N15), ground it in a concrete example (N13) — plus a
  card and ink within seconds. Each is sensible alone. Together they crowd an
  opening that should be light, and the model can't honour all of them at
  once.
- **C7 — Duplicates that drift:** "interesting" is stated in N21, N22, the
  rubric and the storyboard; "one insight" in the intro, N20, the rubric and
  the storyboard. Each copy words it slightly differently, so the model reads
  four versions of one idea.

## Evidence from the examples

Measured over the 11 few-shots and 313 bundled specs (293 plain, plus 20
playlist parts). The script is in the session scratchpad, not the repo.

- A **beat** is a command with `speak`, not counting `card` and `quiz`.
- A **sentence** is counted separately; one speak line can hold several.

| Rule | Few-shots | Examples | Verdict |
|---|---|---|---|
| Card first, then a narrated draw (N8) | 100% | 94% / 96% | Followed |
| No standalone speak before ink (C1b) | 0 violations | 0 violations | Followed |
| ≤2 speak-only commands in a row (N10) | max run 1 | max run 1 | Followed |
| A narrated gesture every 2–3 beats (N12) | 30% of beats | 32% | Followed |
| No signposting (N19) | 0 | 1 ("her ser vi") | Followed |
| Line after a question starts the answer | 0 of 7 break it | 0 of 38 | Followed |
| **Scaffolding unnarrated (N5)** | 27% open on bare axes | 20% | **Examples contradict** (C2) |
| **4–8 sentences for a simple figure (N7)** | median 13 sentences | median 17; 64% over 15 | **Examples contradict** (C3) |
| **Short sentences for the ear (N2)** | 18% of lines over 25 words | 9% | Few-shots contradict |
| **A quiz at the end by default** | 4 of 11 | 90% | Few-shots under-teach it |
| `wrong` usually omitted | 0 of 4 | 6 of 289 | Followed |

What it means:

- **Where the examples agree with a rule, the rule is redundant as prose.**
  The model learns the opening shape, speak-only runs, gesture density, no
  signposting and the question rule from the examples. The prose copies could
  shrink to a line each, or go.
- **Where they disagree, the examples probably win**, and the rule quietly
  loses:
  - **Length:** "4–8 sentences" against a median of 13–17. Either the number
    is wrong or the examples are too long. Hans to decide. (Few-shot "Should
    rents be capped?" has 24 lines; "Six faces" has 2.)
  - **Opening on axes:** "When demand rises", "Diminishing marginal utility"
    and "Should rents be capped?" all open their question over bare axes.
    Either say that's fine ("the opening line may ride the scaffolding"), or
    draw the axes together with the first real curve.
  - **Long lines in the few-shots:** "Operate, or wait?" (38 words), "The law
    of large numbers" (36), "Inside the nacelle" (36).
  - **Quiz:** the few-shots show it far less often than the default claims.
- Lesson for the process: **a rule and the examples must say the same
  thing**, and when they don't, fix the examples first. They are the stronger
  signal.

## Proposed shape, if Hans agrees

1. **Taste sheet (~1 page)** — the goal (one insight, the teacher's aim), then
   about 12 one-line house choices, each with its reason: N5, N7, N8+N9 as one
   opening line, N10, N19, N21+N22, the question-mark silence, color by role,
   one image, a card heading, a quiz at the end, "defaults, not laws" at the
   top.
2. **Affordance sheet (~1 page)** — what the medium can do, as capabilities,
   for the treatment writer and the storyboard.
3. **API reference** — everything of kind a, as today, minus the scattered
   taste lines.
4. **Kind c goes into examples**: each c bullet is kept only if a few-shot
   shows it; otherwise it is dropped, or handed to the look pass as a concern.

Nothing here is applied yet. The next step, after Hans has marked the table, is
the A-vs-C experiment in a separate worktree.

## Decisions (Hans, 2026-09-27)

- **Length (C3):** the target becomes **12–17 sentences** for an ordinary
  drawcast, matching what the examples already do. The "4–8 sentences" (N7),
  "at most about 15 beats" (Freehand 2) and the storyboard's "8–14 lines" are
  to be brought in line with it.
- **Opening over bare axes (C2):** **allowed.** The opening line may ride the
  scaffolding; N5 ("scaffolding is unnarrated") gets that exception, so the
  rule and the few-shots agree.
- **Where the work lives:** every change of this experiment goes on the
  branch `prompt-lab` (worktree `.claude/worktrees/prompt-lab`), never on
  `main`, so it can be compared with `main` and merged later only by choice.
