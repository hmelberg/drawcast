# drawcast notes

A running file of ideas, sources and options that are not yet decided or
not yet built — the things worth remembering between rounds. Hans refers
to this file as "notes". Dated entries, newest first. When an item
graduates into a spec or the roadmap, note that on the entry rather than
deleting it.

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
- Schema condensation (17.7k tokens today, larger than the prompt); the
  `code` bullet as a conditional block (in the freehand round).
- Warn-level lint (overlap, small text) getting one repair round.
- One deploy target (Netlify); the Pages build depends on Netlify anyway.
- Code runtimes beyond Pyodide and webR (Brython, MicroPython,
  microdata, C64 BASIC) as lazy packs in their own repos.
- Publish rail from five destinations to two.
- Learners / view counts / giscus frozen until there is a class.
- BRIEF.md, the second roadmap and the plan/ledger pairs archived.
- An explanation eval: 30–50 requests judged against PEDAGOGY_RUBRIC and
  lint, run on every prompt change.
