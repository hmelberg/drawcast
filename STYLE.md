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

### 2026-08-27 — Cameo entrances: develop, not fade — and the face must land ON the name

Hans: "When a photo appears in drawcast in order to just sow the person
behind an idea or a concept (i.e. mainly as backgroun) we currently fade
it. Introduce some more interesting wasy to fade the phonto in and out
Also do not keep it on the page for a long time, but only introduce it
when relevant on the screen. For instance in the ricardo example it is
perhaps introduced too early and then taken away just before the name is
mentioned whi is a bit non-inuitive. Dirst we do not know why the photo
appears, and then it disappears before the name is mentioned! Revise and
also note in style notes."

Distilled — two halves, an engine half and a timing half, both graduated
in the same commit:

1. **Richer entrances (engine).** Photos now enter by `reveal` effect:
   `develop` (darkroom blur-to-sharp — the new default), `iris` (circle
   opening), `wipe` (print emerging top-down), `drift` (settles into
   place), `fade` (the old plain one). Every effect is a pure function
   of reveal progress, so `erase` plays the same entrance backwards for
   free — a developed photo dissolves back out of focus. Cameo entrance
   650 ms (was 450 — a develop needs a beat to read as developing).
2. **The face lands ON the name (timing).** The Ricardo example had the
   backwards pattern: photo up during the anonymous "a retired London
   stockbroker" hook, erased exactly on the beat that finally says
   "David Ricardo". Wrong twice — first the viewer doesn't know whose
   face it is, then the face leaves just as they could have connected
   it. The rule (already written, now enforced with an explicit
   anti-pattern sentence in the prompt bullet): the cameo appears on the
   beat that FIRST names the person, holds for a beat or two of
   biography, exits quietly under the next content line. Short on-screen
   life is the point — a cameo visits, it does not reside.

Embodied in: the Ricardo example restructured (anonymous hook photo-free
→ face + name + biography beat → quiet exit under "He answered with two
countries and two goods" → the table). Extends the 2026-08-27 cameo
entry below; the prompt's portrait bullet now carries both the
anti-pattern and the `reveal` options (element-specific — still not in
PEDAGOGY_RUBRIC, which stays general).

### 2026-08-27 — Portraits as cameos: appear at first mention, fade away

Hans: "photos can often be used without putting it permanently on top of
a figure. They tend to have different styles. So maybe make it possible
for photos to appear when you want (like when you mention the person's
name the first time) and then fade away. Something like that. Not
necessarily always (sometimes the image may be integral to the story),
but often this seems like a better design."

Distilled — no new engine work needed (erase on a photo is already an
opacity fade-out); this is a USAGE pattern, graduated into the prompt's
portrait bullet in the same commit:

1. **Default: the cameo.** Draw the portrait on the beat that first
   names the person, let it sit for a beat or two of biography, then
   `erase` it (paired with the next content line, so the exit is quiet)
   before the figure work continues. A photo has a different visual
   register than the drawn elements — as a permanent fixture it competes
   with the figure; as a cameo it enriches without occupying.
2. **Permanent when integral.** When the person IS the story (the Darwin
   timeline), the portrait may stay for the duration.
3. Encoded in the prompt's portrait bullet (element-specific guidance —
   deliberately NOT added to PEDAGOGY_RUBRIC, which stays general).

Refined same day — Hans: "If it is to appear and fade, it might as well
be more centralized and a little larger than the current default. It
might also fade faster and perhaps no need to draw the border? Just fade
in and out." → `cameo: true` on the portrait element: centered (500,
420), larger (width 280), frameless, ~450 ms fade — and a missing cameo
draws NOTHING (no placeholder frame squatting on the figure).

Embodied in: the Ricardo comparative-advantage example — frameless cameo
fades in centered, biography beat, fades out before the table draws.

### 2026-08-26 — Interesting, not mandatorily "surprising": vary the kind

Hans (correcting the one-surprise mandate the same day it graduated):
"making the surprise a mandate or absolute rule is too strong. what i mean
is that most presentations should contain something that is interesting.
it could be a surprising conclusion, implication, fact but it could also
just be an interesting fact related to what you say or some biographical
information about a person behind or related to the concept or some piece
of history around it or any interesting tidbit related to it. If we
mandate a 'surprising' fact then we may start inventing things that are
not true, or not surprising and it also becomes a bit like all lectures
are the same. We need variation and relevance to the topic. Sometimes
there are interesting interpretations, implications and so on. Sometimes
it is more plain, but there might be other interesting things to say."

Distilled — supersedes the one-surprise mandate below, graduated to the
prompt and mirrored in `PEDAGOGY_RUBRIC` in the same commit:

1. **Most (not all) drawcasts carry one genuinely interesting thing** —
   and the KIND varies: a surprising conclusion or implication, an
   unexpected true fact, a scrap of history or biography behind the
   concept, an interpretation that reframes it, a good tidbit.
2. **Two failure modes the old mandate invited**: forced "surprises"
   pressure the model toward invention or exaggeration (truth-guard
   risk), and a fixed formula makes every lecture feel the same
   (homogenization). Variation across drawcasts is itself a quality.
3. **Relevance beats wow**: the interesting thing must belong to the
   topic. When nothing honest offers itself, a plain clean explanation
   wins over a forced tidbit.
4. Kin to the ingredient tags (#history/#facts/#controversy/#why) — those
   force a kind; the default rule asks the model to pick whichever kind
   genuinely fits, or none.

### 2026-08-26 — The rules are now enforced, not just written

Hans: "implement the round to improve the pedagogy and the instructions or
suggestions about how to explain things."

Done in two halves. (1) The last un-graduated ledger rule — the
one-surprise mandate — entered the prompt ("Hand over one surprise").
(2) The generation loop gained a **pedagogy review pass**: after a spec is
structurally clean, the model re-reads it as a teacher against
`PEDAGOGY_RUBRIC` in `src/llm/compile.ts` — situated, hook on ink, one
surprise, aha convergence, no signposting, intelligent viewer, moments
marked — and may return an improved version, adopted only when it stays
valid, keeps the template, and lints no worse. The geometry has its lint;
the teaching now has one too.

Maintenance rule: when a new ledger entry graduates into the prompt, also
mirror it in `PEDAGOGY_RUBRIC` — the rubric is the ledger's enforcement
arm and must not drift from it.

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

Status: the hook opening was already encoded (screen-first rule +
`#question` tag). The one-surprise mandate graduated 2026-08-26 ("Hand
over one surprise") — and was SOFTENED the same day into "Make it
interesting — and vary how" (see the newest ledger entry): the
interestingness survives, the mandate and the surprise-only framing
do not.

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

- [x] ~~**One-surprise mandate** in the base prompt~~ — graduated
      2026-08-26 as the "Hand over one surprise" bullet, and enforced by
      the pedagogy review pass (see ledger entry).
- [x] ~~Consider whether the *why it matters* half of the hook deserves its
      own sentence in the prompt~~ — graduated 2026-08-26 as the
      "Situate the topic before you explain it" bullet (see ledger entry).
- [ ] **Sweep the bundled examples for un-situated openings**: Hans says
      the lead-time-bias problem — mechanics before motivation — is common
      across src/examples.json. Review every example's first two beats
      against the situate rule; rewrite the openings that fail it.
