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

### 2026-09-26 — A key name brings its face

Hans: "the aspirin example is good, but this, and other examples, tend to
forget the (soft) rule that if you mention a key name, then we temporarily
try to show the portrait from wikipedia if it exists."

What was wrong: the prompt's portrait bullet said "use one SPARINGLY, only
when the person … genuinely serves the topic", which overrode the cameo
rule of 2026-08-27; 90 bundled examples named a discoverer with no face.

Distilled: a key person named → a cameo on the sentence that names them,
erased quietly on the next beat. Soft: not for a passing mention, not for a
name that is not a person.

Status: the prompt bullet rewritten; 87 bundled examples given a cameo by
script (each name checked for a Wikipedia portrait first; 13 without one
left alone — Yerushalmy, Harberger, Paul Meier, Sackett, Kerrich, Gibrat,
Playfair, Hanau, Følling, Jacob Cohen, among them). The naming sentence
moved onto its own `draw` beat (one action per command); a gesture left
without words by the split was dropped.

### 2026-09-26 — Announce a change before the figure makes it

Hans, on "Should rents be capped?": "the curve should not change before you
speak and say 'after ten years it looks different' … Right now it changes
before you speak which leaves the listener confused (A general lesson)."
Also: rotate or shift in the long run? And "the new curve seems to indicate
that there are more supply at the same price after ten years. Is that
correct?"

What was wrong: the player's timing was fine (an animate waits for the
previous line), but the first change — supply turning steep for "next
year" — came before any sentence said the curve would change, under the
words "supply hardly moves". The viewer saw three supply curves and was told
what two of them meant.

Distilled: say what will change and why; then change it under a sentence
that names the change; keep the previous state as a ghost when the two are
compared. On the economics: the long-run response to the capped rent is a
movement along a flatter curve (a rotation about E); a shift is for what
the rent does not capture (worse upkeep, fear of stricter caps) — the
real-world complication after the model. Above P* the flatter curve does
offer more; say so, and that the cap rules those rents out.

Status: the rent-cap few-shot rebuilt that way (announce → steepen → ten
years: why → flatten with the short-run ghost → the far side → S′ shifted
left for upkeep and fear, Qs falling further); the rule in the prompt.

### 2026-09-26 — Say what we are doing and why; show the working, then put it away

Hans, on "Operate, or wait?": "the example … is too brief. It should: Tell
the user that a decision tree is one way to answer the question. This is
general point … We need to tell the listener what we are doing and why …
it would be beneficial to show some temporary information or calculation
that we may either erase or fade out or put in the corner afterwards … we
should show (and explain) how to calculate expected value … in a separate
box on the same page and we may highlight elements on the tree as we build
up the expression … it is no big deal if we write on top of something else
in a temporary box … We may have more than one of those."

Distilled: two general rules. (1) Name the method and its purpose before
using it — the viewer should know the plan before the steps. (2) Show the
working the conclusion rests on, line by line as it is said, in a temporary
card, highlighting the parts of the figure each line takes its numbers
from; then park it small in a corner, fade or erase it. Scratch paper may
overlap the figure.

Status: the `scratch` element (spec/scratch.ts — expanded before layout into a
rounded box and one text/math line each, grouped); the decision-tree
few-shot rebuilt around it (the tree in `params.box` above, the EV working
below, moved aside at 0.6); both rules in the prompt next to "Give the why".

### 2026-09-26 — Layout: established principles, aware of how it looks

Hans, across several examples: readout numbers "not aligned properly";
area names belong "inside the relevant area … the same color as the area …
if it gets too crowded and it is outside, we may have to have lines from the
text to the area"; the falling balls' drawing "is further down than the
figure … it would probably be better if they were aligned"; "it is also ok
to treat the screen a bit like a blackboard and sometimes a bit chaotic
(even with overlays) … but when we have space we should be aware of sizes
and placement and layout in general. Basically just use good and
established principles for good layout and design."

Distilled: alignment (shared edges and baselines: a drawing's ground on the
chart's axis, a table in true columns), proximity (a name in or on what it
names, a leader when it cannot be), consistency (the name in the thing's own
colour), and space used on purpose — with overlap allowed where it helps
(a translucent panel in an empty corner) rather than forbidden everywhere.

Status: supply_demand area names centred in their areas in their colours
(leader when displaced), the readout a true grid with shorter names and an
`inside` panel option, both price guides for a tax; the falling-ball drawing
aligned to the chart; the prompt's "Show the thing" bullet says to align.

### 2026-09-26 — Write it down as you say it: the figure as a memory aid

Hans, on "Statistical power, one sample size at a time": "As you play or
explain points on a curve, you might also draw some short text/numbers about
the point so the user can compare and do not have to remember. Generally
learning and writing/drawing is partly about creating visual aids that help
us remember … putting this in a table (some of it, not always all), at the
same time you say it." Also: the script's chart and printed line did not
look like the rest of drawcast, and the author should control where a
result line goes, what it says, and how many there are.

Distilled: when the narration walks through values, the figure keeps them —
a mark on the curve and a row in a small table per value spoken, drawn on
the beat that says it, so the viewer compares by looking instead of
remembering. And a script's numbers become drawcast ink: a template chart
fed by tokens, and the author's own text elements carrying `{codeid.path}`
tokens (live through every run and knob), not a plot or a printed line.

Status: text tokens from scripts shipped (code/tokens.ts scanTextTokens,
layout scriptValues); line_chart per-series `points` (a one-value marker
series); the power example rebuilt that way; the code prompt says so.

### 2026-09-26 — Exaggerate: big areas, big changes, corner cases

Hans, on "How severe is a disease?": "one of the areas is quite small. In
explanation and in visual explanations in particular, it is often useful to
have examples that are easy to understand visually and that means usually
large areas (not always, sometimes a small area is natural and what we
want!). In general corner solutions, making things exaggerated (using large
changes) makes a point better than small changes."

Distilled: choose the example's numbers for what they SHOW. A difference the
eye has to hunt for teaches less than one it cannot miss; push the case
toward the corner (a big tax, a patient who loses nearly everything) unless
the smallness is itself the lesson. When two big areas would overlap, show
them one at a time (hide/show) rather than shrinking one.

Status: one sentence in the prompt's "Explain step by step, through an
example" rule; the severity example rebuilt (Anna loses 30 of 48 QALYs,
Bjørn 16.5 of 17), its two areas shown in turn.

### 2026-09-26 — The thing beside its chart; the heading is not part of the plot

Hans, on the falling ball: "This drawcast belongs to a class of explanations
where it might be useful to have both a plot as well as an animation or a
drawing of the event itself … distance it takes for a car to stop. Have an
animated car stopping on the same page as a chart." And on "When demand
rises": "the title line should be reserved … in this example it is visually a
bit strange. The headline becomes part of the plot almost." Also: curves want
both what they ARE in words ("speed of the ball") and, where useful, their
formula — a formula explained, or kept in `details`.

Distilled: (1) when a chart measures something that happens, draw the thing
beside it and drive both from one var — `domain.box: "left"` gives the chart
half the page, `bind` moves the thing and a point on the curve, one
`animate` plays them together (the prompt's "Show the thing beside its
chart"; the falling-ball few-shot). (2) With a card heading, every plot keeps
its top 50 units under the underline (`plotArea()` reads the heading floor),
so a chart never shares a line with the title. (3) The shift arrow stops
short of both curves.

Status: all three shipped the same day.

Later the same day, Hans on the result: "the ball falling does not really
speed up as it falls. Also: it might be a good contrast to show the actual
ball falling in the different circumstances … often the best explanation may
first show the ball falling, then show the more formal chart. Start with the
simple actual example, then make it more formal and show specific aspects …
it depends on the level of the explanation … not a hard requirement."
Distilled: the event first, then the chart (an advanced request may start
abstract); the contrast cases side by side (no air / in air); and a strobe —
a faint copy each second — because one moving dot does not show
acceleration, while growing (then even) gaps do. The falling-ball few-shot
is built that way; the prompt bullet is "Show the thing, then its chart".

### 2026-09-26 — The why, the contrast, and the model against the world

Hans, going through the few-shots (the examples every generation sees):
on the dropped ball, "It does not really explain why. It just asserts. … A
good explanation gives you the why, often a mechanism, and does not just
assert something. This why may have several steps and there may be several
whys and mechanisms that need explaining" — here both why it speeds up
(gravity) and why that stops (air resistance). On diminishing marginal
utility: "could benefit from an example (the first chocolate gives a lot of
satisfaction …) Could in general also add contrast. Sometimes the second is
better than the first … Listening to music as you understand more. So:
learning by contrast. And digging into distinctions and details (are we
talking about consuming two units in a row? Only goods, or also
experiences)." On the nacelle: "confusing because the 'problem' or the issue
to be explained is never stated." On the price ceiling: the hook "is not
clear unless you know the topic. Better to say something like 'Is it a good
idea to set a maximum rent?'"; the shortage should be built step by step (qd,
then qs, then the gap: more people want flats than there are flats); the
closing line was wrong — a cap does lower the rent for those who get a flat,
the problem is that fewer do; and "complications, details, nuances and
exceptions like these is what gives value and understanding. … we may often
start with the basic model. That is good explanation style. But then we
introduce the other issues. In this way people also feel they learn
something. We have a contrast (traditional story vs. what happens when we
bring in more complications) and it is more honest."

Distilled, four rules:

1. **Open with the viewer's question, and name the problem.** Everyday words,
   not the textbook term ("Is it a good idea to cap rents?"). When a device
   or a mechanism is explained, state the problem it solves before the
   solution (the rotor turns 15 times a minute; the generator needs 1,500).
2. **Give the why, not the what.** Show the mechanism, and follow the chain of
   whys as far as the question needs — often more than one link, and often
   more than one mechanism (gravity AND air resistance).
3. **Teach by contrast and distinction.** The idea against its neighbour or
   its exception (the fourth chocolate against the first — and the song you
   like better the tenth time); pin down its scope (in a row or over a year?
   goods or experiences?).
4. **The model first, then the world.** The clean model, then the one or two
   complications that change the answer in practice (short run against long
   run, who gains and who loses, where the model breaks), said plainly. Not
   every complication, and not always — but the honest answer to the question
   actually asked, never the model's slogan standing in for it.

Also from the same pass (engine and templates, each fixed at the general
cause rather than in the one example): the supply_demand shift arrow ran
between two curve samples at different prices — now horizontal by default,
with `arrow: vertical | perpendicular`; `numbering: "index"` names a changed
market D₁ → D₂, P₁ → P₂ (and on); a shortage or surplus draws Qd and Qs as
separate guides with their own names, so a cast can build it in steps; two
arrows between the same two boxes keep to their own sides instead of meeting
at one point; the figure drills say the verdict ("✗ It was F4"), leave the
figure empty for a moment, and bring the next question in visibly; every
few-shot opens with a heading.

Status: rules 1–4 in the prompt (the opening bullet, "Give the why", "The
model first, then the world"); the seven few-shots rewritten to show them.

### 2026-09-25 — Say what it is about first; one line after a quiz answer

Hans, on the eight revised examples: "maybe a tendency (as before) to jump
into things without briefly saying what the specific drawcast is about (can
even draw this if possible). Also you seem to narrate both things after a
multiple choice question (the right and wrong) and I think you should only
do one."

Distilled: (1) the first line names the question the drawcast answers,
in a clause, before the hook or the example: "The quadratic formula solves
any equation with x squared in it, and it comes from a picture. Take this
one…" — the viewer should never have to work out what the example is an
example OF. This is the "announce" pass of 2026-09-12, kept short enough for
the quick heading (2026-09-24). (2) After a wrong quiz answer the player
speaks `wrong`, then `right` as the reveal. `wrong` is therefore a hint,
never the answer again, and is left out when there is nothing to add; the
player now skips a `wrong` identical to the reveal.

Status: in the prompt (the opening rule and the quiz rule), and applied to
the eight revised examples. "Can even draw this" is open: the top heading
could carry the question as a small subtitle line (see the example-revision
ledger's feature ideas).

### 2026-09-24 — A quick heading, then straight to ink

Hans: "many presentations now have a chapter like zoom from page. I wonder
if this takes too much time for short drawcasts. Instead, maybe the default
should be a heading, centralized on top of the page and underlined? I am
happy to have it animated a bit too (zoom from large to smaller? if
possible, quite quickly) And try to get quickly to a drawing or an
animation or some event. Do not speak much (or almost anything) before the
first drawing."

Distilled: the opening is a heading, not a scene. The card (2026-09-16)
cost 5–8 seconds — a title sketched mid-canvas, a subtitle, a 1.6 s
push-in, an erase, a reset — under a full opening sentence, before any
figure. Now `card` defaults to a heading centred at the top, underlined,
that zooms from large into place in under a second and STAYS; its speak is
a few words or none; the next beat is a drawing, and the hook rides that
first ink. The old card is `"style": "center"`, for a long lecture.

Status: shipped 2026-09-24 (`spec/card.ts` headingElements, the prompt's
opening rule and card bullet). The twelve examples added that day follow
it (the hook moved onto the first drawing); the economics course and the
playlist example keep `style: "center"` — their subtitles belong to that
style — until Hans says otherwise.

### 2026-09-23 — Motion that follows from the structure, not from commands

Hans: "It is a good general pattern that we introduce interactions and
animations that do not need a lot of extra or specific or detailed code.
This makes it easier for the llm to write engaging and interesting
drawcasts. Walk is a good example. If we have a list we may often (if it
fits in the context) apply a walk which makes it more dynamic without a lot
of commands. It just follows from the content and the structure of the
content."

**Distillation.** Prefer one declarative field on the content's structure — a
group of peers, a set of alternatives, a chain — that the engine turns into
motion, over verbs the model must place one command at a time. The model
reliably gets structure right (both live galleries were grids) and reliably
forgets choreography (neither faded). So choreography should be derived from
structure wherever the rule is simple enough to predict. Mechanism: sugar
expanded into ordinary commands before layout (`expandSpec`:
cards, then walks), so the player, lint and export stay unchanged; the
author's explicit command always wins.

Status: the principle is recorded; `walk` is its first instance, and its
`"zoom"` and `"replace"` values (built the same day) the next two — the
latter finally carries the 2026-09-12 contrast rule into the prompt.
Remaining candidates are in NOTES.md (2026-09-23, "Structure-derived
motion").

### 2026-09-23 — A gallery of peers: a grid, walked with a fade

Hans, on a Sonnet cast for "an overview of different bridge designs": "It is
not bad, but, it seems a little squeezed. The elements are close together and
a little messy. Maybe such "lists" should be in a list of rows as opposed to
all in one row (or some compromise if we have lots of categories, rows in
columns?)". Then: "fading might be a good rule when we go over lists (and we
can always zoom back and unfade if we want to make a contrast or compare
later)", and "the rule is that three could be in a row, more list, and at
some point grid".

**Distillation.** Three rules and one mechanism:

1. **The shape of the arrangement follows the items, not a count.** Five
   bridges in one `row` fitted to the page showed each at ~0.7× with two
   thirds of the page empty. A row while the items fit at their own size;
   pictures that stop fitting become a grid (2×2, 3×2, 3×3); wide, flat
   items — a name and a line of text — become a list. Past about nine,
   split across pages. Hans's "three in a row, then list, then grid" is this
   rule for flat items; for roughly square pictures the list is the worst of
   the three (0.6× for four bridges against 1.2× as 2×2).
2. **Walk a list with a fade.** Fade the item just explained to ~0.3 before
   the next is drawn, so one thing is at full ink and the rest are context;
   restore them all before comparing across them, or `focus` two to
   contrast.
3. **A category every item shares is a colour, not a repeated label.**
   "compression"/"tension" written into all five bridges was most of the
   mess; blue and red on the parts themselves, named once, says it.

Mechanism: a `grid` with no `columns` picks the count that shows its members
largest in its fit region (capped at their own size, so a row still wins
while it fits); a written row or column of four or more that a grid would
show 1.25× larger warns (`layout-shape`).

Status: shipped 2026-09-23 — `bestColumns` in `src/layout/group-layout.ts`,
rule 3 and the `fade` bullet in `compiler-v1.md`, item 9 (WALKED LIST) of
the pedagogy rubric (`PEDAGOGY_RUBRIC` in `src/llm/compile.ts` — a live
Sonnet run grid-laid both galleries it made but faded neither, so the prompt
sentence alone was not enough), and three bundled
examples: the bridges (3 + 2 with the colour key as the sixth cell), regular
polygons that tile (3 × 2), the four forces (a list). The dock — finished
items shrinking into a strip so the current one gets the whole stage — is
parked in NOTES.md.

Later the same day: rubric item 9 got one gallery of two to fade, so the walk
became a field — `"walk": true` on the group of peers, expanded into the same
fades before layout by `src/spec/walk.ts` (via `expandSpec`, next to cards).
Drawing the next peer fades the ones already shown; a command across two or
more, or the group itself, restores them all; going back to one faded peer
restores it and sets the current one back; the author's own fade wins. The
three examples now carry the field instead of hand-written fades.

### 2026-09-24 — Emphasis should suit what it lights, and never look like neon

Hans: "I think the glow command produce ugly output … it looks a bit like a
cheap neon sign with an ugly halo that lights up in an ugly way." And of the
code marker: "It looks weak, partly because letters (I think) have a white
line around." Compared on a bench of the engine's own ink (today's effects
beside prototypes, one clock): "tint on thin curve is not very distinct",
"retracing did not really show (same color problem)", "both swipe and
rounded are good. use the one that is easiest and most accurate", "yellow
band, go ahead" — and on the ~80 examples that use glow: revise the effect,
keep the command.

Distillation: emphasis is a highlighter, not a light source. A halo says
"this thing is glowing", which is a property of the thing; a marker says
"look here", which is the teacher's. What a highlighter looks like depends on
what it lies on: a band under a line (a recoloured 2 px line is still 2 px —
colour alone never carries on a thin stroke), a box behind a line of code,
the ink itself turning red on a formula or a word. And the pen and what it
marks must never share a colour — a blue emphasis on a blue curve, the marker
yellow over a code number that is itself that yellow — so the default colour
steps aside when it would read as the target's own ink.

Status: shipped 2026-09-24. `glow` is the default effect and is resolved per
leaf in svg-backend (`glowKindOf`): band under strokes, marker behind mono
rows, tint on the rest; one 250 ms ease-in instead of three throbs, the pen
written on over 700 ms. `pulse` keeps the throbbing recolour for when a flash
is the point. Code panes lost the text halo on their rows; a `marks` marker is
one precise round-capped stroke (a rounded box) at 60 %, placed on the CHAR_W
grid that mono text is now letter-spaced to; characters under it that read as
the marker's yellow go to ink (`inkUnderMark`). `readsAsSame` (layout/ink.ts)
is the one test of "same colour", and an explicit `color` is never switched.
The same day `highlight` gained `part` — one piece of the target: a formula
term as TeX (matched against each glyph's token chain, AreaDrawable.tex, as
`math.colors` is), or a verbatim phrase of a label or code line
(layout/highlight-part.ts) — and the `underline` effect; circle and
underline are drawn round the part, not the element. A part that names
nothing lights the whole target, and lint says so (`highlight-part`).

### 2026-09-19 — Emphasis should land and STAY, not breathe through the sentence

Hans: "in drawcast, the we use the pulsating highlight (glow?) it often keep
going for too long. And it is also not disitnct enough." Asked what should
happen instead: "how about three swells then hold".

Distillation: attention is a thing you place, not a thing you keep asking
for. A mark that throbs for eight seconds is the visual equivalent of
repeating a word — and, like a highlight on something self-evident, it
teaches the viewer to ignore the next one. The motion earns the glance; the
hold is what lets them actually look while the sentence explains. Measured
before the change: of 155 highlight commands in `src/examples.json`, **not
one** carried an explicit `duration`, so every one repeated a 1.5 s swell
until the voice ended — a median of 5 swells and up to 10 — and, because the
loop could only stop at a cycle boundary, went on breathing 0.67 s past the
end of the sentence on average (1.4 s worst case). The peak was 0.7 opacity
for an instant, averaging 0.45 over a cycle, so the element was never plainly
ON.

Status: shipped 2026-09-19. `src/render/emphasis.ts` owns the envelope —
three throbs whose troughs rise (1/3, 2/3), the third running straight into a
hold at full for the rest of the sentence, released over 400 ms the moment
the voice stops. Distinctness came from the hold rather than from more
motion: full opacity instead of a 0.7 peak, and a two-layer halo for `glow`.
Taught to the model in the same round (`compiler-v1.md`, the `highlight`
schema description). Dimming the rest of the frame was considered and
rejected — that is what `focus` is for.

### 2026-09-16 — The title is page furniture; a heading on the canvas is the cast's own choice

Hans: "In drawcast there is a title field on top, but also often a title
below that, and sometimes we have a title that is in the middle that zooms in
a little with an underline, and then disappears. Given that we want it to be
a bit like YouTube, maybe it is best not to have the fixed title field above
the whole presentation. […] This does not mean that the video should not have
a headline (often it should, and maybe we can have different styles) or never
a permanent title (as part of the drawcast)."

Distilled:

1. **The `title` field names the document, nothing more.** It is shown
   under the player, like a video's name, and never painted inside the frame
   — so a template's own title and the document's title no longer stack.
2. **A heading on the canvas is drawn ink, in one of two styles.** A text
   element at the top that stays, or a `card` beat — the title sketched in
   the middle over an underline, a slow push-in, then gone — the opening the
   playlist title page has always drawn, now available inside a single cast.
3. **Rule 2 of the 2026-09-01 entry now bites in full:** the canvas is the
   only place the viewer reads a heading, so open with one.

Status: **in the prompt since 2026-09-16** — the "Start on the canvas"
opening rule rewritten, `card` in the verb catalogue and the schema
(design: `docs/superpowers/specs/2026-09-16-title-below-player-design.md`).

### 2026-09-12 — Be generous by default: things happening, and small asides

Hans: «By default bør vi også være generøse med interaksjoner og ting som
skjer på skjermen. Det er kjedelig å bare høre. Det er også veldig fint å
bruke konkrete eksempler og små asides når det er relevant (historiske
anekdoter, biografiske anekdoter). Som med alt annet. Ikke overdriv, men noe
er bra.»

**Distillation.** This raises a DEFAULT, and the rules it meets are written
as floors and ceilings — which is why it does not simply slot in:

1. **Things happening is the default setting, not the minimum.** "Keep the
   canvas moving" is a floor (never more than two speak-only commands in a
   row) and it is satisfied by a figure that barely moves. Hans is setting
   the resting level above the floor: something is happening most of the
   time, because a viewer who is only listening is watching a podcast with a
   picture on it.
2. **Concrete examples and small asides are welcome, not rationed.** A
   historical or biographical anecdote where it is relevant, carried in a
   clause or a beat — the enrichment the 2026-08-26 entry already names, but
   with the emphasis moved from "at most one, or none" toward "some is good".
3. **The limit holds, as everywhere else.** "Ikke overdriv, men noe er bra."
   Generosity is a default, not a mandate, and the topic still decides.

**The three ceilings this argues with,** all currently in the prompt, all
written when the worry was excess rather than flatness:

- **Gestures: "2–4 per figure lands; a gesture on literally every element
  exhausts."** A cap on the very thing Hans wants more of. The cap is not
  wrong — a highlight on everything teaches the viewer to ignore highlights
  (2026-08-26, intelligent viewer) — but 2–4 is a number for a small figure,
  and a 16-beat drawcast held to four gestures is mostly a voice over a still
  picture. Likely fix: scale the budget to the length rather than fix it.
- **Enrichment: "Choose ONE enrichment, or none … never stuff several."**
  Hans is now saying an aside is *veldig fint* where relevant. One-or-none
  probably becomes one-or-two-where-they-genuinely-fit; the truth guard and
  the relevance test are what actually do the work, not the count.
- **Annotations at 1–2, animate beats at "one or two per figure."** Same
  shape: fixed small numbers standing in for judgment.

**Answered the same day** (Hans): «jeg mente mest bevegelser, men du skal
også ta med seer interaksjoner. Spesielt quiz mot slutten er lurt. Og som alt
annet. dette er råd og guidelines, ikke absolutte regler. Du avgjør avhengig
av brukerens prompt og tema hvordan en drawcast børe være.» So: both, with
motion first and a closing quiz named as the specific move worth having.
The question it answered — "interaksjoner" is ambiguous between two very
different things, and the answer changes the prompt:

- *Motion* — gestures, animate, focus, flow, camera. Raising this default is
  uncontroversial; it is the ceilings above.
- *Viewer interaction* — `quiz`, `ask`, `explore`, `wait`. These are
  currently GATED behind an explicit request or tag ("Use ONLY when the
  request asks for a quiz/test or the #quiz tag is present — most drawcasts
  need none"). Making them generous by default is a policy reversal, not a
  loosened number, and it has a real cost: the video export degrades every
  one of them — a quiz auto-answers itself, an `ask` types its own answer,
  `wait` auto-resolves, and an `explore` beat is DROPPED ENTIRELY INCLUDING
  ITS SPEAK. Generous interaction makes the app version richer and the
  exported film thinner. Worth deciding deliberately rather than inheriting.

**Status.** GRADUATED 2026-09-12, in the verb-section round. In the prompt:
the directing tips now open with "be generous with what HAPPENS … a viewer
who is only listening is watching a podcast with a picture on it" and scale
the gesture budget to the figure's length instead of the flat 2–4; the
`quiz` bullet's gate ("Use ONLY when the request asks for a quiz/test or the
#quiz tag is present — most drawcasts need none") became "A quiz at the END
is a good default when the figure has taught something checkable"; `ask`
stays the deliberate one, since typing is a bigger thing to ask of a viewer
than picking, and `quiz` is now named as the everyday check. NOT changed:
the 1–2 annotation and one-or-two-animate numbers, which nobody has
complained about and which the closing "defaults, not laws" line already
governs — that line now closes the verb catalogue too, which is where Hans's
"dette er råd og guidelines, ikke absolutte regler" needed it to sit.

The enrichment cap ("Choose ONE enrichment, or none") was left alone
deliberately: loosening it and the gesture budget in the same round would
have made it impossible to tell which one moved the output. It is the first
candidate if drawcasts still read thin.

### 2026-09-12 — The three passes: announce, explain, conclude — each from a different angle

Hans: «En god metode når man skal forklare, er ofte å si hva man skal
forklare, så forklare det, og til slutt konkludere med hva man har fortalt.
Alt med litt ulik vinkling slik at det ikke blir ren repetisjon, men det gir
et mentalt veikart.»

**Distillation.** The classic shape, with the qualifier that is the whole
point: **the three passes take different angles on the same thing.** Announce
the destination, walk the road, name where you arrived — and if the three
could be swapped for one another, the piece has said its content once and
padded it twice. A workable division of labour:

1. **Announce** — the question, and the stakes. What this decides, prevents
   or complicates. Not the mechanism, and not the answer.
2. **Explain** — the mechanism, step by step, in the example's own numbers.
3. **Conclude** — what the viewer can now SEE that they could not before.
   The insight in its own words, not the opening sentence again.

The value is navigational: a viewer who knows the destination follows every
step, and a viewer who knows they have arrived can stop working. It is the
same instinct as the situate rule (2026-08-26) extended over the whole arc
rather than the opening beat — situate says *why we are going*, this says
*the viewer should always know where in the journey they are*.

Two frictions to resolve when this graduates, both real:

- **Against "explain in passing, never by announcement" (2026-08-26).** That
  ban is on signposting INSIDE the explanation — "Notice that", "It is
  important to note" — never on the opening pass, which is an announcement by
  design. The `#long` / `#verylong` briefs already say "Open by saying in one
  sentence what you will explain", so the two coexist today; whoever writes
  the prompt sentence must keep them from reading as contradictory.
- **Against short drawcasts.** Three passes over 3–4 speak lines is mostly
  frame and little picture. This is a rule for the medium and long forms;
  `#veryshort` and `#short` should keep overriding it, as they already
  override length everywhere else.

**Status.** Half-encoded, as two separate rules that were never framed as one
arc: the opening is covered twice ("Start on the canvas" and "Situate the
topic"), the close once ("Make it land" — end with a one-line synthesis that
names what the viewer can now see). What is NOT anywhere: the arc itself as a
mental roadmap, and the different-angle discipline that keeps the third pass
from being a restatement. Not yet in the prompt.

### 2026-09-12 — Step by step, and the contract runs both ways

Hans: «Et annet råd er å forklare skritt for skritt. Spesielt i denne typen
videoer når vi tegner/animerer og snakker. Man skal ikke snakke lenge uten at
noe skjer på skjermen, og man skal heller ikke plutselig gjøre noe på skjermen
som ikke er forklart eller motivert.»

**Distillation.** Voice and canvas owe each other something, and we have only
ever written down one half of the debt:

1. **No talking over a still canvas.** Encoded since 2026-09-01 ("Do not talk
   to a blank screen"), enforced by two lint rules (slow-start,
   talky-stretch) — the debt we collect on.
2. **No ink the narration has not prepared.** NOT written down anywhere, and
   this is the half Hans is adding. A stroke that appears unannounced makes
   the viewer stop listening and start decoding: *what is that, and why is it
   there?* — attention spent on the figure instead of the idea.

The second half has a mechanism working against it. The prompt tells the
model that "elements you never mention are drawn automatically at the end",
softened with "but a good storyboard mentions everything in a deliberate
order" — so anything the model forgets lands on the canvas in one silent
batch, AFTER the explanation is over. The space round already found the sharp
edge of this (unnamed elements drawn by an implicit final `draw`, landing
after the question that was supposed to precede them). The fallback is right
as a safety net and wrong as a habit.

The exception that keeps the rule honest is already in the prompt and must
survive: **scaffolding is drawn fast and unnarrated** — axes, grids, boards.
So the rule is not "every element gets a sentence". It is: *anything that
carries meaning is motivated before or as it appears; only backdrop may
arrive unannounced.* Drawing something and explaining it afterwards is the
failure — the sentence and the stroke start together, which is what narrated
actions are FOR.

"Step by step" is the same discipline seen from the other side: each beat
adds one thing, and the viewer is told why that thing is next. A beat that
adds three things has made two of them unmotivated by construction.

**Status.** Half in the prompt and half absent, as above. The missing half is
also the only half with no lint — and a deterministic check looks reachable:
an element that is neither scaffolding nor named by any `speak`, and whose
`draw` command carries no `speak`, is unmotivated ink. Worth a spike when
this graduates; the implicit final draw is where it would bite first.

### 2026-09-09 — A thing is drawn as named parts

Hans's ruling for the freehand round, recorded in its design spec
(`docs/superpowers/specs/2026-09-09-freehand-figures-design.md`, §1):

> the round is judged on three kinds of request — schematic THINGS with
> named parts (a bicycle pump, a neuron, a heart with its circulation),
> maths/physics with FORMULAS next to curves and figures, and ILLUSTRATED
> explanations with a photo as part of the figure.

and, on where freehand now sits relative to authoring a template:

> Freehand comes first: the automatic template-on-demand path no longer
> fires on a single freehand figure with named parts; a template is an
> upgrade the user asks for.

**Distillation.** A figure of a THING is not a pile of strokes that happens
to look like the thing: each part is its own element, with its own id, sitting
against the part it hangs off. That is not tidiness. It is what makes the
figure answerable afterwards — "Find the part" can only ask about something
that has a name, and click-to-explain can only open a card on an element that
exists. A drawing whose piston is three anonymous polylines teaches the viewer
the same picture and leaves the app nothing to work with. The same rule sets
the ceiling on how good a freehand figure has to be: since freehand is now the
first answer rather than the fallback, a request for a thing must come back as
a labelled assembly, not as a sketch waiting for a template to rescue it.

**Status.** In the prompt — the "Freehand figures" section of
`src/llm/prompts/compiler-v1.md` (Task 10) — and in `PEDAGOGY_RUBRIC` as item
8 ("If the figure is a thing, its parts are named elements the narration
points at"). In the exemplars as of Task 11: three freehand few-shots (a pump,
a free-fall curve with its formulas, a wind turbine with a photo) and six
bundled examples, two per target and at least one Norwegian in each pair.
The two bundled photos are embedded as the Commons thumbnail's own colour
bytes rather than through the app's grayscale-and-warm-tint pass, which needs
a canvas node does not have — an accepted difference between a bundled example
and a freshly generated one, not a defect.

### 2026-09-15 — The movie rule is a default, not a law; one look for controls

Hans (on the code controls after two rounds): "It works, but it is ugly
and clunky. […] It would be better if the svg drawn controls themselves
could work, instead of replacing them with html when we actually want to
use it. […] The point is: Not have two slightly different looking, but
one." And on the rule: "Relax the rule about everything being designed as
a movie. It is too restrictive. Sometimes we really want to design an
interactive lesson with lots of visible interactions and user input. We
should not be restricted not to do so by the rules. Instead we might want
to avoid those elements when we actually want to make something that can
be a movie as well. And we can tell the llm that (maybe have a #movie)."
Also: pausing on a control should not open the tray; no handwritten box
around the tray; load the runtimes when the presentation starts.

**Distillation.** Movie-first was written as a law for the model (an
ordinary `speak` never invites; the invitation lives only in the explore
beat) and that law is what constrains the lessons, not the engine. The
engine's substrate rule — the timeline never waits on a response — is what
keeps export free and stays. The model-facing rule flips to a default:
interactive lessons may invite and stop as they like; `#movie` asks for a
lesson that also works unattended (few live controls, invitations in
explore beats, a played sweep instead of a live knob). A control has ONE
look: the drawn one, which must itself be live while paused.

**Status.** Evaluated 2026-09-15, staged plan proposed (SVG-live
controls + preload; then `#movie` and the rule flip; then a code sweep
verb). Not built.

### 2026-09-07 — A bundled example starts from a question, or from something worth explaining

Hans: «Generelt er det fint om eksemplene tar utgangspunkt i et spørsmål
eller noe de vil forklare.»

**Distillation.** The `request` line of a bundled example is not a caption —
it is the user input the model learns to recognise, and the example is the
answer it learns to give. A request phrased as an errand ("Show me X", "Put
the Ys in order") teaches the model that the app draws things on command. A
request phrased as a question, or as something someone wants understood,
teaches it that the app answers. The same applies to the beats: a figure that
labels its parts has explained nothing; the example should carry an idea the
viewer would not have guessed.

This is the same instinct as the situate rule (2026-08-26) applied one level
up: that rule governs the opening beat, this one governs what the whole
example is FOR.

**Status.** Applied to the `space` pack the day it shipped. Of its five
examples, three already asked a question ("Which one is Mars?", "How big is
Jupiter?", "Where are the planets today?") and two were errands: "Put the
planets in order." and "Show me Jupiter and its moons." Both rewritten to
start from a question the figure actually answers, without touching their
params. The wider sweep of `src/examples.json` for errand-shaped requests
remains open — see the candidates list.

Hans: "Sometimes explanation by contrast is useful. For instance when
explaining the production possibilities frontier (one of our examples) the
curve you draw can be contrasted with a linear curve (or even a non-linear
curve indicating economies of scale). This contrast makes the viewer
understand why something has the shape it has. It also increases understanding
and leads naturally to concepts like marginal rate of substitution, economies
of scale and so on. […] we can draw one curve/alternative and then erase it
(if there are many we should erase, if there is only two we might keep both
sometimes) and draw the other as we explain. Second, we should try to explain
things the user might wonder about. In this case one might wonder: Why does
the curve have this shape? Glossing over this and other non-obvious issues
leads to holes in the understanding. […] Of course there is a limit to this
(we cannot explain everything from first principles in a drawcast); we should
strive to focus on non-obvious details and when relevant try to explain by
using contrasts and alternatives."

Distilled — two rules and a discipline:

1. **Contrast is an explaining instrument, not decoration.** When a shape,
   formula or claim is non-obvious, draw the *wrong or simpler alternative*
   first (or alongside) and let the difference carry the explanation: the PPF
   against a straight line is what makes "why is it bowed?" answerable, and
   the contrast opens the door to the next concept (MRS, economies of scale)
   for free. Mechanics: with exactly two alternatives, keeping both on screen
   is often right; with more than two, draw-then-erase each rejected
   alternative so the survivor stays clean.
2. **Answer the question the viewer is silently asking.** Anything
   non-obvious that the explanation *uses* — and that we do not assume was
   explained before — gets explained, or the piece leaves a hole exactly
   where curiosity was. "Why does the curve have this shape?" is the test
   case: a drawcast that draws the shape without earning it fails.
3. **The limit:** not first principles — the discipline is to *find* the one
   or two genuinely non-obvious details and spend the contrast budget there,
   not to explain everything.

Status: **not yet in the prompt.** Belongs in the compiler prompt's
explanation rules, near the one-surprise mandate — contrast-then-erase also
needs the engine's erase/undraw verbs, which exist.


### 2026-09-01 — Do not talk to a blank screen: draw something early, even if it only illustrates

Hans: "sometimes the style of drawcasts is not to speak for too long before
drawing or doing anything on the screen. That becomes boring, add some title
and be careful not to speak too long before adding something. You may even draw
something while speaking (whether it is a hook or a question) even if it is
just for illustration."

Distilled — three rules, in the order they bite:

1. **Something is on screen before the narration is old.** A drawcast that
   opens with a spoken hook over an empty page has thrown away the one thing it
   has that a podcast does not. The hook is good; the empty page under it is
   not.
2. **A title counts as something.** Opening with the title drawn is the cheapest
   fix and it doubles as the piece's own label — which matters more now that
   the title may move below the player (see the roadmap's title-position item),
   because then the drawing is the only place the viewer reads what this is.
3. **Speaking and drawing are not turns.** A hook or a question can be spoken
   *while* something appears — an axis, a shape, a face, even a mark that is
   only illustrative. Narration that waits for the pen, and a pen that waits for
   the narration, is the failure mode; they should overlap.

The rule this replaces, implicitly: "set up the question, then draw the answer".
That produces a correct drawcast and a slow one. The question can be asked over
a moving pen.

Status: **in the prompt since 2026-09-02** — folded into the compiler
prompt's "Start on the canvas" opening rule (title-as-first-beat + speaking
over a moving pen), the same day the written title moved below the player
(C9), which is what makes rule 2 load-bearing. Once Instructions become
a personal style addendum (see `specs/2026-09-01-style-and-vocabulary-design.md`),
this is exactly the kind of rule a user would want to state for themselves too.


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

Refined same day — Hans: "when we have a name and a photo, try to use
add the name as text also above or below the photo (centralized).
Default can be wipe (for portraits/faces), but for other things use
fade." → Three changes, same commit:

1. **The name rides with the photo.** A portrait with a known name draws
   it as a centered caption below the photo (above when the photo sits
   too low) — part of the SAME element, so it appears and erases with
   the portrait. No separate label element (prompt updated; the old
   "pair it with a label" advice reversed). The Darwin example's manual
   name label removed.
2. **wipe is the portrait default** (a face emerging like a print);
   develop/iris/drift/fade remain choices. Non-portrait images keep the
   plain fade — reveal effects are for faces.
3. **The lint learned about time** (what forced the caption-drop
   compromise in the first cameo round): overlap checks now skip element
   pairs that are never on screen together, computed from a visibility
   walk over the commands. A cameo's caption may statically sit on the
   figure it never actually meets.

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
Both sweeps below now have an enforcement arm, added 2026-09-11:
`tests/examples-style.test.ts` counts them and pins the count, so a NEW
example can never push either number up. They are ratchets, not gates —
each sweep lowers its own pin, and the target for both is 0. The render
gate (`tests/examples.test.ts`) still checks only geometry and lint; this
is the first test that looks at what an example TEACHES.

- [ ] **Sweep the bundled examples for un-situated openings**: Hans says
      the lead-time-bias problem — mechanics before motivation — is common
      across src/examples.json. Review every example's first two beats
      against the situate rule; rewrite the openings that fail it.
      Partly ratcheted: the test pins speak-only openings at **74** of the
      specs the file carries — the permitted exception (one standalone speak
      before ink), taken by about a third of the examples, which stops it
      reading as an exception. Whether the opening SITUATES is still a human
      read; only its shape is measured.
- [ ] **Sweep the bundled examples for errand-shaped requests** (2026-09-07):
      a `request` that says "Show me X", "Draw Y" or "Put the Zs in order"
      teaches the model that the app takes orders rather than answers
      questions. Grep `src/examples.json` for imperative openings and rewrite
      each as the question its figure actually answers. The `space` pack's
      two were done at the time; the rest of the file was not.
      Ratcheted at **75** (`isErrandShaped` — imperative drawing verbs in
      both languages; "Explain"/"Forklar" passes, since wanting a thing
      understood is not an errand).
