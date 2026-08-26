# STYLE — what makes a drawcast engaging

A running ledger of Hans's ideas, comments and aims about how a drawcast
should be structured — and what its content should do — to be engaging and
interesting. New thoughts land here as dated entries, in Hans's own words
plus a short distillation. Periodically this file gets distilled back into
the prompt (`src/llm/prompts/compiler-v1.md`, the tag briefs in
`src/llm/tags.ts`) and into the bundled examples (`src/examples.json`),
which are what the model actually imitates.

How to use it: add a dated entry whenever Hans comments on style, structure
or content. When an idea graduates into the prompt or an example set, note
that on the entry instead of deleting it — the ledger doubles as the
history of why the prompt says what it says.

## The aim

A drawcast is not a recitation of facts with pictures. It earns attention
at the start, builds toward one insight the viewer could not have stated
before watching, and leaves them with something they want to retell.

## Ledger (newest first)

### 2026-08-26 — Open with a question or a purpose statement; always deliver one surprise

Hans: "the examples should start with a question or a statement like
telling what you are going to explain and why it is important (feel free to
use drawings to perform this too). Also try to give or tell the reader
something new, something slightly surprising or interesting related to the
topic."

Distilled, two rules:

1. **Hook opening** — the first beat is either a question or a plain
   statement of what will be explained *and why it matters*. The hook may
   be performed with ink, not just words: draw the thing the question is
   about while asking it (the screen-first rule already demands ink within
   seconds, so the hook rides on the first draw).
2. **One surprise** — every drawcast should hand the viewer at least one
   *true*, slightly surprising or interesting fact about the topic. This is
   distinct from the aha: the aha is an understanding the viewer builds;
   the surprise is a fact they can retell at dinner ("a neuron can be over
   a metre long", "before birth everyone has a hole in the heart").
   The truth guard applies with full force — a surprise must be a
   well-established fact, never invented or exaggerated for effect.

Status: the hook opening is largely encoded (screen-first rule + `#question`
tag); the **one-surprise mandate is NOT yet a standing prompt rule** —
top candidate for the next prompt refinement.

Embodied in: the five hook-first medicine examples (commit `513c204`) —
the bacon headline, silent AFib, the heart's spare pacemaker, the fetal
hole in the heart, the 400 km/h neuron signal.

### 2026-08-26 — Confirmed: the hook-first medicine examples hit the mark

Hans: "I like the headlines and approach of the last examples. It seems
like you have captured the aim and style well so far."

Distilled: treat those five as **reference exemplars** for tone and
structure when writing new examples:

- request phrased the way a curious person asks ("Bacon raises cancer risk
  by 18 percent — should I panic?", "How fast is a thought?");
- opening question or secret-reveal riding on the first draw;
- the figure built in an order that serves the story, not the template;
- exactly one surprise, planted where it lands hardest;
- `delivery: "grave"` (or `soft`) reserved for the one or two beats where
  the meaning turns serious;
- a closing line that names what the viewer can now see.

## Already encoded in the prompt (don't re-add — refine there)

From `src/llm/prompts/compiler-v1.md`:

- **Screen-first**: something appears within seconds; the opening line goes
  ON the first draw; at most one short standalone speak before ink; never a
  riddle over a blank canvas.
- **Aha mandate**: identify the one insight — the sentence the viewer could
  not have said before watching — converge every beat on its reveal, end by
  naming it.
- **Concrete example as hook**: ground the explanation in one concrete case
  with actual numbers and carry it through the figure.
- **Annotation as punctuation**: box/circle the answer, strike the rejected
  option, at the moment of insight; 1–2 per figure.

From `src/llm/tags.ts` (all opt-in unless noted):

- **Hooks**: `#question`, `#debate` (draw both claims, strike the loser),
  `#provoke` — all written draw-under.
- **Forms**: `#qa`, `#podcast`, `#story`, `#socratic` (+ voices a/b,
  `#male`/`#female`).
- **Ingredients**: `#why`, `#controversy`, `#history`, `#facts`,
  `#proscons` — untagged, the model picks at most ONE that fits.
- **Tone**: `#fun`, `#dry`, `#pun`; `#human` (hesitations, self-correction);
  per-line `delivery` soft/grave/brisk.
- **Truth guard**: never fabricate controversy, history or numbers.

Lint back-stops (feed the revise loop): slow-start (narration before ink),
talky-stretch (3+ speak-only lines in a row).

## Candidates for the next prompt refinement

- [ ] **One-surprise mandate** in the base prompt: alongside the aha,
      include one true, retellable, slightly surprising fact — with the
      truth guard attached. (From the 2026-08-26 entry.)
- [ ] Consider whether the *why it matters* half of the hook deserves its
      own sentence in the prompt — the current screen-first rule says
      "announce the goal, or pose the hook" but not "say why it matters".
