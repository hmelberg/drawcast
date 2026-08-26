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

### 2026-08-26 — Situate the topic first: stakes before mechanics

Hans (on the lead-time-bias example, which opened with two timelines and no
why): "the listener may be left a bit confused as to why this is relevant …
i tend to think that often it is better to know the motivation or the
contect befor. In this example the conclusion is that lead-time bias is
important because it may lead to wrong conclusions about the effectivness
of screening. So one should, I think, say something like that right away.
Maybe not exactly the conclusion, but a topic needs to be situated and made
relevant. It is not important in itself. … state it or hint at it early nd
then do the explnation inclding suprises and intersting facts and
controversies or side.remarks (digressions are also ok sometimes). This is
a general style advice, not just for the lead time bias example (and th
eproblem is common with many of our eamples)."

Distilled — graduated into the prompt in the same commit as this entry:

1. **Situate before explaining.** The opening states or hints at WHY the
   viewer wants this concept — the decision it informs, the mistake it
   prevents, the claim it complicates — before the mechanics begin. Hint
   at the stakes, not the full conclusion. This resolves the "why it
   matters" candidate below (now its own prompt bullet, sibling to
   screen-first).
2. **Digressions are allowed.** The enrichment bullet now lists "a short
   digression that circles back" among the permitted enrichment moments.

Embodied in: the lead-time-bias example's opening rewritten (stakes ride
the first draw: "Screening can double measured survival without giving
anyone a single extra day — this timeline shows the trick"). Hans says the
un-situated opening is COMMON across the bundled examples — a sweep of
src/examples.json openings against this rule is a standing candidate below.

### 2026-08-26 — Color by role; explain in passing; skip the obvious; rules are defaults

Hans: "Use colors on different types of elements and objects. Assume people
are intelligent so avoid emphasising things that are very obvious. focus on
non-intuitive or surprising conclusions. At the same time one may need to
explain things but in a way that is more like part of a sentence or a
comment a sidebar, not like 'here is an important statement: bla bla'.
Another issue: in general few rules are absolute, use and follow rules and
advice based on your judgement and relevance to the topic/question."

Distilled, four rules — all graduated straight into the prompt (the same
commit that adds this entry):

1. **Color by role** — each conceptual TYPE of element gets its own palette
   color, used consistently; color is information, not decoration. New
   `## Color` section in the prompt spells out the house palette as hex
   values the model can put on tier-2/3 elements.
2. **Explain in passing, never by announcement** — explanations live inside
   the sentence doing the work, or as a brief aside; "It is important to
   note" / "Notice that" signposting is banned by name.
3. **Assume an intelligent viewer** — no words or highlights spent on the
   self-evident; the aha rule now explicitly prefers the non-intuitive
   conclusion, the one that runs against what a smart viewer would guess.
   (Kin to the one-surprise mandate below, but distinct: the surprise is a
   retellable fact, this is about which *insight* is worth building to.)
4. **Defaults, not laws** — the prompt's rulebook now closes by saying the
   rules are defaults to be weighed against the topic and request; only the
   output contract is absolute.

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
- **Situate the topic**: the opening states or hints at why the viewer
  wants the concept — stakes before mechanics, hint not conclusion.
- **Aha mandate**: identify the one insight — the sentence the viewer could
  not have said before watching — converge every beat on its reveal, end by
  naming it.
- **Concrete example as hook**: ground the explanation in one concrete case
  with actual numbers and carry it through the figure.
- **Annotation as punctuation**: box/circle the answer, strike the rejected
  option, at the moment of insight; 1–2 per figure.
- **Color by role**: one palette color per conceptual type, consistent
  across the figure; the house palette is listed as hex values.
- **Explain in passing**: explanation as a clause or brief aside in the
  working sentence; signposted emphasis banned by name.
- **Intelligent viewer / non-intuitive aha**: no ceremony on the obvious;
  prefer the insight the viewer would not have guessed.
- **Defaults, not laws**: apply every rule by judgment and relevance;
  only the JSON output contract is absolute.

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
- [x] ~~Consider whether the *why it matters* half of the hook deserves its
      own sentence in the prompt~~ — graduated 2026-08-26 as the
      "Situate the topic before you explain it" bullet (see ledger entry).
- [ ] **Sweep the bundled examples for un-situated openings**: Hans says
      the lead-time-bias problem — mechanics before motivation — is common
      across src/examples.json. Review every example's first two beats
      against the situate rule; rewrite the openings that fail it.
