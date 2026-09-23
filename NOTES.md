# drawcast notes

A running file of ideas, sources and options that are not yet decided or
not yet built — the things worth remembering between rounds. Hans refers
to this file as "notes". Dated entries, newest first. When an item
graduates into a spec or the roadmap, note that on the entry rather than
deleting it.

## 2026-09-24 — An element id that is a notation keyword does not round-trip

Found adding the sharp/flat/natural example: a group with the id `flat`
prints as `group flat members [...]`, and the author-notation parser reads
`flat` as the curve keyword (`direction: flat`), so the spec comes back as
an unnamed group with a direction. The bundled example renames its cells
(`flat_sign`); the round-trip test over the corpus caught it. Any cast can
hit this — a generated one naming a part `flat`, `steep`, `linear`, `up`…
Options, none chosen: the printer quotes an id that collides with a
keyword; or the parser takes the word right after an element head as the
id, always. The second is the cleaner rule if nothing depends on the
current reading.

## 2026-09-23 — Structure-derived motion: candidates after `walk`

The principle (STYLE.md 2026-09-23): one field on the content's structure,
expanded into ordinary commands by `expandSpec`, beats choreography the model
must place by hand. Counted over the 265 bundled casts before choosing:

| Pattern written by hand | Count |
|---|---|
| camera zoom-in | 1 in 265 casts |
| erase followed by draw (contrast) | 6 |
| arrow drawn on a later beat than both its ends | 19 of 28 |
| highlight of the element just drawn, on the next beat | 29 |

Candidates, strongest first:

1. **`walk: "zoom"`** — the walk also pushes the camera in on each new peer
   while it is explained and pulls back for the comparison. The camera is
   the least-used verb in the library, and this gives small grid cells full
   size while they are the subject — most of what the dock (below) wanted,
   with no new layout.
2. **`walk: "replace"`** — for alternatives rather than peers: the next one
   erases (or ghosts) the previous, the survivor stays. This is the
   2026-09-12 contrast rule ("with more than two alternatives, draw-then-
   erase each rejected alternative"), still not in the prompt.
3. **`chain: true`** on a laid-out row/column joined by arrows — drawing the
   next box draws the arrow into it. Weak evidence: the bundled casts draw
   19 of 28 arrows on a beat of their own, often narrated, so this would
   take a choice away. Lower priority.

Built the same day (Hans: "do it"): 1 and 2, as `walk: "zoom"` and
`walk: "replace"`, plus `camera.zoom: "fit"` — the planner frames the
target's box with a 1.4 margin, lifted a tenth of the view clear of the
caption band — which the zoom walk needs because it is expanded before
layout knows any sizes. Examples: note values (zoom), Newton's cannon
(replace). Example 242 (the PPF, straight vs bowed) could move to
`walk: "replace"`; not done. Candidate 3 stays open.

Already automatic and worth pointing at walked groups: the identify drill
(`src/ui/parts-model.ts`) builds "click the ___" questions from a figure's
named parts; a walked gallery's captions are exactly such names — check
whether it qualifies before building anything.

## 2026-09-23 — A dock: finished drawings shrink aside for the next one

Raised by Hans alongside the gallery ruling (STYLE.md 2026-09-23): the inset
element already puts a PAGE in the corner; the same for drawings on the page
itself. Walking five bridges, each would be drawn large, explained, and then
shrink into a strip at the side while the next gets the whole stage; at the
end they come out of the dock into a grid for the comparison.

Why not insets: docked items stay live elements with their own ids, so
`highlight`, `point` and `arrange` keep working on them; an inset is a
picture. Parts that exist: `move` scales, a template's `animate box`
shrinks a figure into a half, the inset column reserves a right-hand strip
and divides stroke width and roughness by the scale. Missing: a named dock
whose space is reserved from the start, a way to say `move X to the dock`,
and arranging the items back out of it.

Not built. Grid + fade (shipped the same day) does most of the job without
it — the one thing the dock adds is size for the current item. Try first:
a throwaway cast of the bridges with today's `move` + `scale` to fixed
corner coordinates, to judge the pacing before designing any syntax.

## 2026-09-20 — The caption band sits on the x-axis label

Seen for the first time by looking, not by linting: at the end of the
bundled `ppf` cast the x-axis caption "Hospitals" is illegible, because the
narration band is drawn over it.

Not a bug in the example. `.cs-caption` is `position: absolute; bottom: 0`
across the stage (`src/render/figure-style.ts`), translucent by design — the
alpha is 0.6 and `tests/caption-band.test.ts` pins it as the lightest value
that still gives the caption text 4.5:1. Measured at a realistic size (900 ×
675): the band is 65 px, the bottom 9.6% of the figure, and `kit.axisLabel`
puts an x-axis label below the plot floor at y0 = 95 — the bottom 12.7%. So
the two occupy the same strip, in every template that labels its x-axis, for
as long as any line of narration is on screen. That is most of the chart-like
catalogue: supply_demand, ppf, ad_as, firm_cost_curves, is_lm, the empirics
pack, generic_axes_diagram.

Nothing catches it. The lint works in canvas coordinates and the band is
chrome ("never placed in canvas coordinates, so it cannot collide with the
drawing's own layout" — render/index.ts), which is true and is exactly why
this is invisible to every gate we have.

Options, none costed yet:

1. **Reserve the strip**: shrink the figure's usable canvas by the band's
   height while a caption is showing. Truest, but the figure would resize as
   narration comes and goes unless the room is reserved permanently.
2. **Raise the axis label**: move `kit.axisLabel`'s x-label above the plot
   floor rather than below it. One kit function, every template inherits it —
   but it changes the look of every existing figure.
3. **Live with it** and let authors avoid bottom labels on casts with heavy
   narration. Cheapest, and the worst answer for generated casts, which
   cannot know.

Found with the dev-only frame harness added the same day (`/frames.html`,
`npm run dev`): it lays a cast's resting frames out with the browser's real
text metrics and mounts them as a contact sheet, so one screenshot shows the
whole cast. The five intro-economics casts were clean on every on-screen
frame under those metrics — and this, which no metric was looking for.

## 2026-09-11 — Exemplar selection is lexical, and that is half a problem

`selectExemplars` (`src/llm/prompt.ts`) picks the 3 exemplars for a request
by keyword overlap against a stoplist. The stoplist was the IMPERATIVE
request verbs and English only — which is the shape a request had when it
was written ("Draw a demand curve"), not the shape STYLE.md's 2026-09-07
ruling asks for. Measured against `src/examples.json`:

| Request | Picked, before | On the word |
|---|---|---|
| «Forklar hvorfor renter påvirker inflasjonen» | 1/2+1/4+1/8 = 1; why iron is Fe; circle area | `hvorfor` |
| "How does a vaccine actually work?" | a confidence interval; a lock and key; atrial fibrillation | `does`, `actually` |

Fixed 2026-09-11: the stoplist gained the interrogative openers in both
languages and the Norwegian request verbs and grammar words. The English
side now selects properly ("How does a vaccine actually work?" → the
herd-immunity vaccine figure, on `vaccine`).

**The open half.** A Norwegian request now matches NOTHING rather than the
wrong thing — better, but not good: «Forklar hvordan tilbud og etterspørsel
bestemmer prisen» gets no exemplar at all, though the file holds a dozen
supply-and-demand figures in English. 33 of 241 bundled examples are
Norwegian, and a lexical matcher cannot cross the language line. Options,
none chosen:

- A small bilingual term map (tilbud→supply, etterspørsel→demand, celle→cell)
  applied to the request's keywords before scoring. Cheap, partial, and it
  is a glossary someone has to keep.
- Let the ROUTER pick the exemplars. It already runs a Haiku call per
  request and already reads the request semantically to shortlist templates;
  exemplar ids would be nearly free there, and it crosses languages by
  construction. Costs a schema field, not a call.
- Embeddings over the 241 requests. Best quality, needs an embeddings key —
  the same blocker as `gift`'s dense retriever.

Nothing here is urgent: the 11 fewshots are always in the prompt and carry
the mechanics, so a missing exemplar costs topical fit, not correctness.

**Graduated 2026-09-12** into the roadmap as **Language-neutral retrieval**,
after Hans asked whether the answer is instead to translate every request to
English, generate, and translate back. The ruling recorded there: forward
yes, backward no — translate what is MATCHED, never what is DELIVERED. The
three options above are the roadmap section's options table, with the
router's `topic` field preferred; the case against translating the spec back
(ids and content in the same JSON, the lint measuring text the viewer never
sees, translationese, an undiscardable round) is written up there too.

## 2026-09-10 — What manim has that drawcast lacks

Hans asked whether manim (3b1b's engine, github.com/3b1b/manim; the
Fourier-transform video as the example) has functions drawcast can and
should implement, weighing usefulness, complexity and — his addition — how
easy the spec stays for a model to write. Manim is imperative Python:
everything is coordinates, objects update per frame, scenes render offline
with ffmpeg, OpenGL and LaTeX; nothing runs in a browser, so no code is
reusable. Models write manim fluently, and the errors they make (overlaps,
things off screen, manimgl-vs-community confusion) are exactly what
drawcast's architecture removes — so the lesson was: borrow the moves, not
the language; add capability as attributes on verbs that exist and as
relations that hold, never as new coordinate work for the model.

| Manim move | Value | Cost | Model cost | Ruling |
|---|---|---|---|---|
| Updaters: dependents follow what they are defined by | High | Medium–high | None | **Done, part 1** |
| ValueTracker: a var swept through a freehand figure | High | Medium | Small (`vars`, `animate`) | **Done, part 1** |
| A locus traced across a sweep (`trail` on `animate`) | Medium | Small | One key | **Done, part 1** |
| A number readout following a var (`{f}` in text) | Medium | Small | None | **Done, part 1** |
| TransformMatchingTex: like terms glide between `equation_steps` lines | High for algebra | Medium–high | None | **Done, part 2** |
| t2c: per-term colours in formulas | Medium | Small–medium | Trivial | **Done, part 2** |
| TransformFromCopy: a `copy` verb minting `<id>_copy` | Medium | Small | One verb | **Done, part 2** |
| Parametric curve (`x_expr`/`y_expr` in t) | Medium | Small | Trivial | **Done, part 2** |
| LaggedStart: `stagger` on `draw` | Low–medium | Small | One key | Later |
| A camera that follows an element | Low–medium | Small | One key | Later |
| Indicate/Circumscribe/Flash/Wiggle | Covered by highlight/point/focus/flow/annotation | — | — | No |
| More rate functions | Low | — | Noise | No |
| 3D surfaces | Low for our fields | Large | — | No |
| VectorField / StreamLines | Low | Medium | — | No |
| ApplyMatrix on a grid | Medium for linear algebra | Fits a template | — | Template on demand |

The Fourier video itself (a signal wound round a circle, a centre of mass,
a 15–30 s linear sweep, the spectrum drawn as the frequency rises) is
writable today as one on-demand template with `animate` on a `freq` param;
part 1 makes the same thing possible freehand.

Status: part 1 shipped 2026-09-10 (ROADMAP "Vars and dependencies"); part
2 shipped 2026-09-10 (ROADMAP "Formula morph, term colours, copy and
parametric curves"); the `equation_steps`-lines glide is round 2b,
unscheduled.

## 2026-09-09 — Sources for how a thing looks (freehand drawing)

Context: the freehand-figures round
(`docs/superpowers/specs/2026-09-09-freehand-figures-design.md`). When
the model draws without a template, its only knowledge of how a thing
looks is its training, the spec vocabulary, the exemplars and numeric
lint. It never sees a reference and never sees its own drawing. Sources
considered, with the ruling in that spec:

| Source | What it gives | Status |
|---|---|---|
| **Keyword icons via Iconify** (Lucide, Tabler, Phosphor, Heroicons, Material Symbols; Font Awesome Free and Twemoji as CC BY; OpenMoji as BY-SA) | Simple, consistent SVG shapes by keyword; flatten to strokes with `svgpath.ts`. Stamp (unchanged) or seed (the model edits the strokes). Licence policy in spec §3.7. | **DONE 2026-09-09** — `icon` element, resolver and stamp/seed modes (`780b477`, `f85f3f4`, `260d3ef`); router names the subject and the seed rides the user turn with credit following surviving paths (`63b7a5d`, `3035879`, `aa78d9a`) |
| **A parts list before drawing** | The model lists parts and their relations (above, inside, left of) before writing elements; `at` is the vocabulary for it. | **DONE 2026-09-09** — the compiler prompt's `## Freehand figures` section puts the parts-and-relations list before "write elements" (`3b0bafc`) |
| **Visual repair round** | Render the laid-out figure to PNG and send it back with the lint list; the only source that lets the model see its own drawing. | **DONE 2026-09-09** — snapshot + one extra model round, off by default, Settings → Advanced (`68e88c1`, `66365e0`, `06480e6`, `4071454`) |
| **Commons photo shown to the model** | Real proportions; the model abstracts from a photo instead of memory. Needs the subject extracted before generation. | Still deferred — next round, pending the eval (Part C) |
| **Commons SVG diagrams** ("Bicycle pump diagram.svg", anatomy, physics) | Already schematic, often with parts; flattening exists. Unpredictable: 20–5000 paths, embedded text, no part ids, licence per file. | Still deferred — needs a spike |
| **Wikipedia summary text** (no.wikipedia for Norwegian part names) | Correct terminology in the request's language; the summary is short. | Candidate |
| **The user's own image** | Best when the user has a picture of the thing. | Stays with template authoring, where upload exists |
| **Wikidata** | Structured "has part" statements for some things. | Not assessed in depth; likely too sparse |
| **Quick, Draw!** (Google, 50M sketches, 345 categories, CC BY) | Hand-drawn stroke data by keyword. Low quality, few categories. | Rejected |
| **Unicode / emoji glyphs** | Font glyphs, not strokes; colour emoji break the style; OpenMoji via Iconify covers the same motifs as SVG. | Rejected |
| **The kit's 11 stamps** (resistor, battery, flask, person…) | An internal icon set, kit-only today. | Superseded by Iconify; could be exposed later |
| **3D engines** (BodyParts3D, 3Dmol) | Real geometry, but domain-specific. | Already in place for anatomy and molecules |

Other methods noted the same day:

- **Two-step generation**: parts + relations first as a small structured
  call, then the spec. The composition guide asks for this inside one
  call; a separate call is the fallback if the model skips the step.
- **Reference by example**: the on-demand template author already
  accepts an image drop; the same door could feed freehand ("draw this")
  if the user has a picture.

Ruling (Hans, 2026-09-09, on the live eval): the eval's output feeds the
examples. Up to three of the after-run's generated specs may be promoted
into `src/examples.json`, after hand-fixing them to pass the examples
gate, when they use the new elements well and read as real explanations.
The source run and every edit made to a promoted spec are recorded in the
round's ledger; Hans may strike any of them back out at the smoke test.

## 2026-09-09 — Follow-ups from the strategic review (not yet scheduled)

From the 2026-09-08 review of the whole app, the items Hans has not yet
ruled on:

- Landing page as a question box; server-side LLM proxy with a per-user
  budget instead of BYOK and key vending.
- The YAML spec editor to a drawer; prompt library, ratings,
  improve-from-worst and the Data modal to dev-only or out.
- Schema condensation. Measured 2026-09-18 (count_tokens, Opus 5): the
  cached prefix is ~83k tokens, the schema ~30k of it now that it is
  embedded minified (36k pretty-printed); 54k of its 79k chars are the 280
  property descriptions, many restating compiler-v1.md. Worth doing only
  for the cache WRITES — a cached read of the whole prefix is ~$0.04. The
  `code` bullet is a conditional block since the freehand round.
- Cost levers still open after the 2026-09-18 cost round (which added the
  prefix gate, low-effort outline, medium-effort plan, the one-token
  "unchanged" teaching-pass reply and the course cost estimate): the effort
  dial at medium for the creative round (output is ~80 % of a part's cost
  and thinking most of the output — measure one course at each setting);
  dropping or narrowing the teaching pass once its adopted count (now on
  the course run summary) says how often it changes anything; the Batch
  API for courses (50 % off everything, needs the repair loop as rounds).
- Warn-level lint (overlap, small text) getting one repair round.
- One deploy target (Netlify); the Pages build depends on Netlify anyway.
- Code runtimes beyond Pyodide and webR (Brython, MicroPython,
  microdata, C64 BASIC) as lazy packs in their own repos.
- Publish rail from five destinations to two.
- Learners / view counts / giscus frozen until there is a class.
- BRIEF.md, the second roadmap and the plan/ledger pairs archived.
- An explanation eval: 30–50 requests judged against PEDAGOGY_RUBRIC and
  lint, run on every prompt change.
