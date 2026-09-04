# drawcast roadmap

Forked from [hmelberg/draw](https://github.com/hmelberg/draw) on 2026-08-19.
The engine milestones M1–M4 (spec, layout, player, lint, exemplars) and the
gesture-verb extension (highlight/point/move/show/hide/erase/clear/camera,
scene-state planning) arrived with the fork — see the `draw` repo's history and
ROADMAP for that record.

## Done at fork time

- **Strip-down**: one SVG renderer with a clean/sketchy style toggle; mermaid,
  jsxgraph, the raw-SVG baseline, and the side-by-side comparison harness stay
  behind in `draw`. Bundle drops accordingly.
- **Two-mode shell**: Player (YouTube-like: poster, big play, seek bar, speed,
  focus mode) ↔ Editor (AI generation with BYOK, bundled examples, local
  library with save/download/upload, editable spec JSON, lint report, rating +
  promote-to-exemplar, editable compiler prompt saved as a custom variant).
- **Share mode**: `#gdoc=<id>` plays a spec from a link-shared Google Doc
  (legacy `&backend=` params map onto styles).
- **Video export** (2026-08-19): "Export video" in the editor toolbar replays
  the drawcast once into a 720p canvas (captions burned in) while mixing
  narration synthesized by BYOK Google Cloud TTS (per-line en/nb voice pick),
  records via MediaRecorder, downloads a narrated WebM (YouTube-ready).
  Deliberately TTS-only: speechSynthesis is uncapturable and loopback capture
  was rejected as fragile. MP4 (WebCodecs) and direct YouTube upload were
  evaluated and deferred — WebM + drag-into-Studio covers the workflow.
  Follow-up the same day: **cloud voices in live playback** (CloudSpeech) —
  when the TTS key is set, player/editor narration uses the same neural
  voices with per-session caching, prefetch, live mute, and AudioContext
  pause/resume; per-line fallback to the browser voice on any failure.
- **Watch-page polish** (2026-08-19): YouTube-sized player (title below the
  video), mute (volume-0 narration, timing unchanged), theater and fullscreen
  toggles, editor/player switch on the control bar; the editor became an
  xplainer-style workbench — one compact toolbar, spec text and live preview
  side by side, Library/Prompt/Data collapsed below.
- **Prompt library** (2026-08-19): named user prompt variants with the full
  lifecycle (copy from bundled, edit, rename, delete, download/upload .md),
  an active-prompt selector feeding generation, placeholder validation
  ({{SCHEMA}} required), and **Improve with AI** — the model revises the
  active prompt from the worst logged generations; proposals become new
  prompts, never silent replacements (the brief's Loop-2 rule).
- **YAML as the human format** (2026-08-19): specs parse as YAML or JSON,
  auto-detected, everywhere text comes in (gdoc, upload, the editor textarea);
  the editor presents YAML by default with a JSON toggle. The engine and LLM
  stay JSON — YAML is a lossless conversion layer (`src/spec/text.ts`).

## Done since fork

- **`animate` command** (2026-08-23): tweens numeric template params by
  re-running layout per frame — cheap geometry swaps during the tween
  (`Reprojector.frame`) and a full remount to settle on commit
  (`Reprojector.commit`), smoothstep easing, boundary-exact param state per
  scene so scrubbing across the animate boundary is exact and the spec
  itself is never mutated. Ships with a numeric `demand`/`supply.steepness`
  and a continuous `demand_shift`/`supply_shift.amount` (plus the shift
  equilibrium) in `supply_demand`, and the bundled "Demand shift, animated"
  example. 536/536 tests pass; the DOM-only swap/remount path (the one seam
  no test harness reaches) was checked by a manual visual gate — see
  `.superpowers/sdd/2026-08-23-animate-command/task-7-report.md`.

- **Science packs** (2026-08-25): five stub templates promoted to ready
  (`two_by_two_table`, `timeline`, `generic_axes_diagram`, `markov_model`,
  `cost_effectiveness_plane` — real layout + manifest, no more fall-through);
  five new domain packs (`economics`, `evidence` epidemiology, `mathlogic`,
  plus `games` chess boards/replayed lines and `maps` sketched country
  outlines) and 7 more science-fill templates appended to the existing
  physics/chemistry/biology packs — 31 new ready templates in all. Three new
  lazy engines back them (`mathjax` TeX→SVG for handwritten equations,
  `chess` for FEN/SAN boards and move validation, `geo` for d3-geo/topojson
  country shapes), plus sceneKit v2 (`KIT_VERSION = 2` in `src/scenes/kit.ts`)
  giving layout bodies the extra stdlib these packs needed. `games` and
  `maps` sit outside the academic default and stay opt-in
  (`DEFAULT_OFF_PACKS`); the other six packs are on by default, and
  `TEMPLATE_FULL_THRESHOLD` moved 20→50 so every one of them still gets a
  full catalog entry with no index-only degradation. 1062/1062 tests pass;
  `npm run build` and `npm run build:engine` (dist-engine + its check
  script) both green — see
  `.superpowers/sdd/2026-08-25-science-packs/task-13-report.md`.

## Template policy — when a figure earns a template

Freehand (tier-2, often on `generic_axes_diagram`) is genuinely good at
"axes + one or two hand-shaped curves + labels" — the Phillips-curve
example proves it. A dedicated template must earn its catalog weight
(~500 cached prompt tokens + one more routing candidate each). Build one
only when at least one of these holds:

1. **Geometry encodes domain correctness lint can't check** — log scales,
   right-continuous steps, tangency conditions, exact intersections.
2. **Dense or repetitive structure** — the model would have to emit
   hundreds of coordinates (icon grids, boards, staffs).
3. **A standard notation is the natural input** — SMILES, FEN, Newick.
4. **Animation carries real teaching value** — numeric params + honest
   per-frame recomputation is template-only.
5. **The figure recurs constantly in the target literature** — worth
   deterministic, correct-by-construction output.

Otherwise trust freehand. Templates are a floor, not a cage: tier-2
elements can still be layered on top of a template's exported curves
(`curveSamples`), and the model can always fall through to composition.
Decided 2026-08-26 after the "does it hurt to have many templates?"
discussion; the two managed risks are shoehorning (kept in check by honest
"Choose this for…" scoping and the fall-through) and catalog weight (the
two-level catalog above `TEMPLATE_FULL_THRESHOLD`).

## Sound (the play command) — done 2026-08-26

`play` sounds synthesized notes (WebAudio oscillators, five instrument
recipes, chords with `+`, up to four parallel voices) with the same
routing discipline as narration: live → speakers, export → the recording
destination only (notes land in the YouTube video, silently, background
tabs included — scheduling rides the audio clock, the wait rides the
player's frame clock). Notation is shared between the command, the spec
validator, and the music templates via `kit.parseNotes` (kit v3).
Deferred follow-up: importing real score formats (ABC, MusicXML, MIDI)
as an engine that feeds both `note_sheet` and `play` — a bigger,
separate feature.

## Portraits (phase 1) — done 2026-08-26

A `portrait` element traces a photo into sketch strokes drawn in the house
style: name mode (the model writes a NAME; the app resolves it via the
Wikipedia summary API and traces the infobox portrait), URL mode
(user-supplied links, CORS permitting), and file mode (editor picker; a
file has no regenerable source, so its strokes auto-embed in the spec).
Traces cache in IndexedDB keyed by name/url + tracer version — the name
is the regenerable truth, the cache is materialization; resolution runs
in the ensure phase before layout (never mid-playback), and a missing
portrait degrades to a sketched placeholder with initials. Phase 2 delivered
shading, pinning and blob-hoisting; the poster (posterized-region) look
then replaced lines as the default. The halftone look (Hans's dots
idea) shipped 2026-08-27 and became the DEFAULT — poster destroyed
likeness; dot-size halftone keeps faces recognizable because tone
survives. The photo look shipped 2026-08-27
(image drawable kind; framed, paper-tinted grayscale JPEG data URIs) after
halftone at 900 dots also fell short of likeness; Hans judged photo the winner —
it is the DEFAULT look (halftone at 2400 dots stays the styled option).
Still deferred: crop/re-trace UI and the Anvil shared cache tier.

## Clickable words — done 2026-08-29

Any meaningful TEXT on the canvas now opens a card that knows what the word
means in THIS figure. A label already carried one; node text and tier-3 text
now do too (`meaningfulName` still screens out "D", "P*", "42"), and only a
label reaches through to what it `attach_to`s — a node has no such relation.

**And the words a TEMPLATE drew.** Measuring the first cut answered a question
badly: only 3% of the 495 readable words across the bundled drawcasts were
clickable, because 110 of the 114 specs use a template and a template computes
its own labels — they are not spec elements, so "Nucleus", "Base pair",
"α-helix" and "Amplitude A" were all dead text. Cards are now minted from the
LAYOUT as well, which takes that to 100%. Two rules keep it honest: the card
lands on the WORD's own box, never on the part behind it (mapping an axis
caption up to `axes` would make the whole coordinate cross clickable as
"Quantity (Q)"), and a word whose owning part is not command-addressable is
never minted at all, since nothing would ever hide it — a clickable ghost
outliving the erase of what it belonged to. Ownership comes from the drawable
TREE, not an id prefix: `pv_loop`'s "Stroke volume" is `sv__t`, sharing no
prefix with its group.

The disambiguation is the interesting half. "Mercury" is the element in a
figure about protons and thermometers and the planet in one about orbits, and
the figure ALREADY says which: its title, its narration, its other labels, its
params. `src/ui/wiki-match.ts` scores Wikipedia's search hits against that bag
of words. **No model is involved** — it is string arithmetic in the browser, so
there is no API key, no token cost, and nothing happens until a viewer clicks;
the only network access is one keyless `action=query&generator=search` call
(`origin=*` makes it CORS-open) that returns title, one-line description and
thumbnail for six candidates at once.

Two signals, and both were needed. Description overlap ALONE was measured
wrong: in a wave figure it ranked "Pulse-amplitude modulation" above the
article "Amplitude", because the longer description shared more words. For a
generic term an exact title match is itself the strongest evidence, so title
and context each carry their own weight.

The threshold is deliberately STRICT (Hans's call): over ten measured cases
five cleared it and all five were right; the rest fall to a "Did you mean"
chip row where the viewer picks, or to plain Search when nothing fits. A
disambiguation page is never a destination. Loosening it buys a few more
automatic summaries and eventually buys a confidently WRONG one — the trade
that was rejected, because a wrong summary presented as fact is worse than one
extra click.

### Selecting a phrase in the caption (2026-08-29)

The narration says things the canvas never draws — "the dismal science",
"regression to the mean" — and measuring two cheap detectors over all 735
bundled narration lines showed why no detector should be trusted with those:
matching words already on the canvas covers 29% of lines with perfect
precision, but capitalised runs (12%) return "AA Aa Aa" and
"Norway Sweden Denmark Finland" as if they were terms. English does not
capitalise its concepts, so the boundary is simply not in the text.

So the VIEWER draws the boundary: select a phrase in the caption and a small
"🔍" chip offers to look it up, through the same context matcher a canvas word
uses. Free of the play/pause conflict by construction — the caption is a
SIBLING of the stage and togglePlay is bound to the stage alone, so dragging
to select never touches playback — and free of any phrase detection at all.
The chip goes away when the caption is rewritten on the next beat.

Video export is untouched: it reads `currentCaption.textContent`, which is
unaffected by anything the card layer does. Deliberately NOT built: phrase
detection in running text, which needs either a vocabulary list or a model
call per line, and a model call would break the property that makes this
whole feature free.

### Saying an acronym (2026-08-29)

"QALY" is said as a word, "UN" is spelled "U N", and a speech engine guesses
which from the capitals. So the spelled kind ALREADY comes out right and needs
nothing — only the word-like ones need marking, and lowercasing them is the
whole mechanism ("qaly" is a nonsense word, so the engine falls back to
letter-to-sound rules and says it). Hans's idea, and better than the SSML
route it replaced: no format change, so it cannot break on an ampersand in the
narration; it fixes the BROWSER voice too, which ignores SSML; and the default
handles the larger half.

Lowercasing alone turned out not to be enough. Hans listened against the real
voices: "qaly" is not it — "qualy", with the u that drops the initialism, is
the accurate one, and ICER wants a doubled e ("iceer"). So an entry is a
PHONETIC RESPELLING arrived at by ear, and the table is a map rather than a
list. A trailing plural rides along on its own ("QALYs" → "qualys").

`sayable()` (src/render/pronounce.ts) is pure and applies at the two audio
boundaries only — inside `synthesizeOne` (all cloud paths, the export's
pre-synthesis batch included) and at `new SpeechSynthesisUtterance`. The
caption keeps its capitals, and since the movie burns the CAPTION, a viewer
always reads "QALY" however it is said. Cache keys and `detectLang` still see
the original.

Often the respelling is just the lowercase form — DALY, PICO, NICE — and that
still earns an entry, because ABSENT does not mean lowercase: absent means the
capitals stand and the engine spells the thing out. Leaving DALY out does not
give "daly", it gives "D-A-L-Y". Matching is case-sensitive, which is what
keeps NICE safe: the institute is capitalised, the ordinary adjective is not.

The table holds ONLY what has been listened to. Speculative entries were
removed: SIR in particular would have been wrong, since the epidemiology
model's letters really are spelled out, which is exactly what the default
does. If the vocabulary grows, domain packs should contribute to one
shared table (a term's pronunciation belongs to the term, not to a template —
QALY is QALY in every figure).

## Sources — done 2026-08-28

A `source` element puts the WORK itself on the canvas — a book cover, a
paper's title page, or one page of either — in the portrait photo family
(`docs/2026-08-28-source-element-spec.md`). Same architecture as portraits
and for the same reasons: the spec carries only the reference (`of` = the
title, verified against Wikipedia and therefore the preferred one; or
`doi`/`isbn`/`archive`/`url`, which must be COPIED from the request because
a wrong-but-real identifier resolves to the wrong work in silence), and
`src/render/source.ts` resolves it in the ensure phase into a paper-tinted
image cached in IndexedDB. Two cache entries per element — the reference
lookup (page-independent) and the image (page- and quote-specific) — so
turning a page never re-asks OpenAlex. A `quote` on the PDF path is matched
against `getTextContent()` (whitespace collapsed, curly punctuation
flattened, line-break hyphenation joined) and becomes drawcast's OWN ink:
one thick highlighter stroke per line, emitted as separate addressable
drawables `<id>_quote`, `<id>_quote_2`, … so the sweep is timed to the
narration beat and plays backwards on erase, never baked into the pixels.
pdf.js is lazy-loaded as its own chunk (433 kB) on first use. Two live
findings the implementation is built around: OpenAlex 404s on a
percent-encoded DOI slash, and its `best_oa_location.pdf_url` is often null
while the `locations` array carries a perfectly good arXiv PDF — so every
location is scanned and arxiv.org wins the tie (verified CORS-open). A third
came from running the real pdf.js: it has DROPPED
`viewport.convertToViewportRectangle` (which the spec assumed), so the flip
goes through `convertToViewportPoint` on the two corners — and because the
loader is a dynamic import, a wrong method name is a runtime TypeError rather
than a type error, so a 587-byte PDF written inline in the test suite pins
that contract offline. Failure degrades to a ruled placeholder page; a missing
cover (Open Library answers 1×1 pixels, not 404) or a paywalled DOI falls back
to the title, and a declared `quote` promises its `<id>_quote` id even when the
reference has not resolved, so the storyboard beat survives being offline.

Four bundled examples show the three uses: Ioannidis's false-findings paper by
DOI (further reading), Malthus's Essay by title (a cover beside the two
curves), the "Attention Is All You Need" abstract quoted off the real arXiv
PDF with the sweep on its own beat (verified: it lands 23% from the left, 57%
down, wrapping onto a second line), and Snow's 1854 cholera map from an
archive.org scan as a two-part playlist — part 1 the timeline of the outbreak,
part 2 the map alone at full size, reached by `zoom_from`. That split is
deliberate: a big source element sitting on a template disturbs the LABEL
SOLVER, which knows nothing about time, so labels get pushed aside by a
picture that is never on screen with them.

A VIDEO is a work like any other (2026-08-29): a YouTube url in a source's
`url` draws the video's still, framed and paper-tinted like a page, with a
hand-drawn play mark over it — ink, not baked pixels, so it arrives with the
frame and erases with it — and its real title as the caption. YouTube's
keyless oEmbed supplies the title and answers 400 for an id that does not
exist, so a wrong video fails VISIBLY, the property that makes `of` the
preferred reference for books. Stills come from i.ytimg.com
(`access-control-allow-origin: *`): the widescreen `maxresdefault` first, the
letterboxed `hqdefault` behind it, since older uploads lack the former. A
machine-discovered title is no longer allowed to serve as the picture
fallback — otherwise a video titled "Simpson's paradox" would quietly show
the Wikipedia article's image instead of the video.

Two more examples (2026-08-28) hang a YouTube video on a figure, which had
zero exemplars despite R7 shipping the embedded player: the derivative as the
slope of a tangent (3Blue1Brown's calculus series) and a positive test for a
1-in-10,000 disease (3Blue1Brown on Bayes). Both hang the link on a LABEL
element, so it reaches the label AND the element it `attach_to`s — the
documented reach that also had no exemplar. Every video id was checked against
`youtube.com/oembed` before use (title and channel came back as expected);
one plausible-looking id turned out not to exist, which is exactly the
fabrication hazard the prompt warns about. tests/examples.test.ts now pins
that every authored link reaches a card AND sniffs to the kind its URL
implies, because a mistyped video id still looks like a link — it just
degrades silently from the embedded player to a plain new tab.

Deferred, deliberately: a Netlify proxy for publisher PDFs (a policy
decision, not a technical one), Google Books covers (no CORS — their URLs
stay fine as plain links), Semantic Scholar (429s anonymous callers),
and full-text search inside PDFs — a quote is located verbatim-ish, never
discovered.

- **Explore tray** (2026-08-27): interactivity round 1 per
  `docs/superpowers/specs/2026-08-27-interactivity-principles.md` — ⊕ on the
  control bar opens a slider tray auto-derived from params_schema bounds
  (`minimum`/`maximum`), live-previewed via `Player.previewParams`, restored
  exactly by "Continue ▶" (and self-settled by any fresh `play()`). Flagship
  ranges declared on supply_demand and the stats pack; other templates join
  by declaring bounds.

## Languages — done 2026-08-29

The upload dialog carries a checkbox per language. Ticking one that is not the
source translates the drawcast into a COPY and queues a second video for it;
the document itself is never written to. Template-computed captions ride in
`text_map` because a template's own words ("Susceptible" for compartment "S")
never appear in the spec — measured at the time, 67 of the 114 bundled
drawcasts drew text a spec-level translator could not see.

Open follow-ups:

- **"Save the translations as new drawcasts" in the status line too.** Today
  the button lives only in the upload dialog, which closes when the queue
  starts — so the decision has to be made before uploading. The translations
  stay in memory until the dialog is next opened, so offering the same action
  again afterwards is only a second action on the status line (which currently
  takes exactly one).
- The upload **description** is shared across a multi-language set and is not
  translated; a playlist's **title page and chapter cards** are not translated
  either (item specs are, playlist meta is not).

## Phase A — interaction primitives

- `wait` until click (timed pause exists); auto-advance rule for any future
  batch runs.
- Modal layer over the canvas (HTML, framework-free).
- `new_page` as transition: clear + centered title card (TV-style), single
  page for now.
- `label` markers + `goto` — free random access thanks to per-boundary scene
  state; chapter ticks on the seek bar.

## Phase B — content elements

- `math` element: lazy-loaded MathJax SVG output → dash-offset "handwritten"
  equations. First use of the lazy capability-registry pattern.
- **`quiz` + typed `ask` shipped 2026-08-27** (plans:
  `docs/superpowers/plans/2026-08-27-ask-v1.md`,
  `2026-08-27-quiz-ask-typed.md`): `quiz` = the multiple-choice card
  (several in a row = a test); `ask` = a typed answer — check mode with
  `answer`/`retry`/`reveal`, collect mode with `store` + mandatory
  `default`, and `{name}` interpolation into later narration
  (`Player.vars`, ask-var lint). Movies perform both: the quiz card hovers
  across its options and selects the correct one; the ask card types its
  answer/default — painted by the export's frame painter. Goto branching shipped 2026-08-27
  (`docs/superpowers/plans/2026-08-27-goto-branching.md`): `label` commands,
  `right_goto`/`wrong_goto` on quiz/ask (viewer answers only — movies stay
  linear and terminate by construction), and `if` conditionals on stored
  answers (one comparison, backward jumps must cross a question). The score
  tally shipped the same day: reserved `{score}`/`{score_total}` variables,
  per-question outcome slots (remediation re-answers overwrite), usable in
  narration and `if` conditions. Values→params shipped the same
  day (`2026-08-27-var-params.md`): a "{var}" animate target glides the
  figure to the viewer's stored number, fallback = the ask's default,
  scrub-safe via a runtime override overlay. Widget answer devices shipped
  2026-08-28 (`2026-08-27-widgets.md`): `widget: "click"` (point at the
  element), `"piano"` (press the drawn key, it sounds; paused pianos are
  freely playable), `"chess"` (click a move) — all resolving strings the
  ordinary ask judging handles; movies demonstrate with the laser pointer.
  Still future: answers logged, {var} in drawn text, richer widgets (maps
  need point-in-polygon).
- `on_click` on elements: open an info modal or jump to a label (fat invisible
  hit areas over thin rough strokes).

- **Map accuracy** (follow-up to the 2026-08-25 ring smoothing in
  `maps.yaml`): load `world-atlas/countries-50m.json` in **focus mode**
  only — the whole-world view stays on `countries-110m` (its extra detail
  wouldn't survive being drawn at that scale, and it's what keeps the
  world-mode point budget sane). Composes with, doesn't replace, the
  Catmull-Rom smoothing (`kit.smooth`) already in place — 50m rings are
  themselves more angular before smoothing than a real coastline, just
  finer-grained than 110m's. `countries-50m.json` is ~700KB (vs 110m's
  ~108KB), so it needs the same lazy-load-on-first-use treatment `geo`
  already gets in `src/scenes/engines.ts`, fetched only when `focus` is
  actually requested.

- **Generic graph/network template via a real layout engine** (phase 2 of
  the 2026-08-26 Markov self-loop round; phase 1 — true self-loops aimed
  into the widest angular gap, stay-probability captions, node auto-shrink,
  obstacle-avoiding bows — shipped without dependencies). When we want a
  template that takes arbitrary nodes+edges (flowcharts, state machines,
  networks) and lays them out fully automatically, adopt
  **@dagrejs/dagre** inside `kit.layoutNodes` as the "layered" style: it is
  the only engine that fits the kit contract as-is — synchronous,
  ~100KB, deterministic, returns node positions + edge control points +
  reserved edge-label boxes (mermaid's default). Keep our own self-loop and
  sketchy edge rendering on top (dagre deliberately ignores self-loops).
  elkjs was evaluated and rejected for this slot: best-in-class quality and
  real self-loop routing options, but Promise-only API and ~1.4MB — wrong
  fit for the sync template contract and the embeddable dist-engine.
- **DOT-based graph template via Graphviz WASM** (phase 3, only if diagram
  ambitions grow): `@viz-js/viz` (actively maintained Graphviz WASM, v3) is
  the gold standard for small state diagrams — proper self-loops, edge-label
  placement, spline control points via its JSON output that we could
  re-render in the sketchy style. Costs: async WASM init (pre-warm once at
  app start, before the sync template compile path needs it) and a
  megabyte-class payload — keep it OUT of dist-engine, or lazy like the
  mathjax/geo engines. Independently of the renderer, **DOT is interesting
  as a standard format to create/store/express graph relationships**: it is
  the graph syntax LLMs know best, so a `dot` param (or an import path that
  parses DOT into nodes+edges for whatever layout engine we use) would let
  users and models paste existing graphs straight in. Keep JSON params as
  the primary Spec surface (schema validation + repair pipeline stay
  intact); DOT enters as an input/interchange format, not a replacement.

## Phase C — structure

- `pages: [{elements, commands}]` — true multi-scene drawcasts with per-page
  layout and lint; the player concatenates page plans with transitions.
- **Template-as-element** (idea only — revisit if a concrete lesson demands
  it, not scheduled): let a tier-2 element embed a template instance (own
  params, offset/scale) so two engine-backed figures can share one screen —
  e.g. a playable keyboard next to an interactive map. Today `Spec.template`
  is a single string and the interaction attach reads that one manifest
  (tray.ts/controls.ts), so multiple heavy interactive figures per screen are
  impossible by construction; the attach loop itself already handles a
  multi-kind `interactions:` list, so the registry is not the blocker.
  Known costs: layout composition, interaction attach across embedded
  manifests, hit-testing (the R9 visible-set lesson), schema + prompt.
  Reasons to keep deferring: one spec already combines a template with
  freehand elements; links/info cards/quizzes compose freely on any number
  of elements; heavy interactions are pause-gated so movies never need this;
  and the note_sheet `keyboard: true` precedent shows a purpose-built
  combined template covers a specific pairing cheaply.
- Time-proportional seek bar (estimate from speech + draw durations).
- `morph`: spec-diff tweening for untemplated specs — no template param to
  drive, so it has to re-layout from a diffed spec and interpolate. Remains
  open; buildable on the same reprojection primitive `animate` introduced
  (see Done). The templated case — "shift the demand curve" by animating a
  param — already shipped as `animate`.

- **Faster-than-real-time video export** (WebCodecs): step the player on a
  virtual clock — all wall-clock coupling sits in the player's `progress()` /
  `waitScaled()`, and the test suite already drives the player on a stubbed
  rAF, so the seam exists — render the soundtrack in one OfflineAudioContext
  pass from the known TTS buffer durations, encode with VideoEncoder /
  AudioEncoder, and mux with a small library (webm-muxer). Rasterization
  (~10–20 ms/frame) becomes the bottleneck, so expect 3–10× faster rather
  than instant; skip re-rasterizing frames whose serialized SVG is unchanged.
  Risks: silent pacing drift from any missed wall-clock wait (only visible by
  watching the output), AudioEncoder support outside Chrome/Firefox, and a
  second export path to maintain unless the real-time one is dropped. The
  background export (progress chip + pause-on-hidden-tab, 2026-08-25) covers
  the usability gap meanwhile.

## Courses — stage A done 2026-08-30

A course document (`#` course, `##` lecture = one drawcast, `###` chapter)
planned by one LLM call, revised conversationally, and batch-generated through
the existing `#playlist` machinery with shared course context, resumable per
lecture. Design: `docs/superpowers/specs/2026-08-30-courses-design.md`; plan:
`docs/superpowers/plans/2026-08-30-courses-stage-a.md`.

### Speed — the remaining levers

The 2026-08-30 round (two phases, gate 4 → 8, real progress) bought an
estimated 1.6–2.3× depending on course size, by cutting the number of *waves*.
Everything below attacks the other term — how long one part takes — so the two
gains multiply.

- **Measure before optimising further.** `T_part` (initial Opus round +
  pedagogy pass + conditional repairs) is a guess at ~90 s and the repair
  rate is entirely unknown. Log per-round durations and repair counts for one
  real course run; the answer decides whether `maxRepairs` is worth touching
  at all. Do this first — the speed estimates above are arithmetic on wave
  counts, never a stopwatch.
- **Draft mode** — the big one. Run the whole batch on Sonnet with
  `pedagogyReview: false`, then ⟳ individual lectures at full quality. Halves
  the calls per part *and* makes each call faster, so roughly another 2×.
  Machinery exists: `repairModelFor` already picks a different model per
  round. Must be an explicit checkbox in the course panel — it is a quality
  trade, not a free win, and silently downgrading a course would be a bad
  surprise.
- **One-hour prompt cache.** `systemBlocks` sets
  `cache_control: { type: "ephemeral" }` with no `ttl`, so the ~10k-token
  prefix expires after five minutes — shorter than a course run, so it gets
  re-processed mid-batch. `ttl: "1h"` costs more on the single write and less
  on every one of the twenty reads. Helps ordinary single-drawcast work too.
- **Fewer repair rounds in a batch.** `maxRepairs` defaults to 2. In a run
  whose output you will review anyway, one is probably enough — but see
  "measure first": if repairs rarely fire, this saves nothing.
- **Adaptive gate.** `GENERATION_LIMIT = 8` with the SDK retry budget at 4 is
  a guess at where rate limits start. If 429s show up in practice, shrink the
  gate on a 429 and grow it back, rather than tuning a constant by hand.

### Stage B — publishing (done 2026-08-30)

The author's own public GitHub repo, one folder per course, one atomic commit
via the Git Data API (five calls whatever the course's size), a generated
`index.html` overview page, and a `#gh=owner/repo/path` viewer mode. Chosen
over Drive because `SavedDrawing` has no `driveFileId`, so a regenerated
lecture would get a new Drive file and break every published link — plus Drive
needs per-file manual sharing and cannot host the overview page. The publishing
seam is `publishCourse` in `src/course/publish.ts`; a Drive target would
replace that one function and nothing else.

Open: **`#gh=` links work without Pages** (they are raw fetches), but the
overview page needs Pages switched on once per repo. The app says so after the
first publish rather than probing, because the Pages endpoint needs admin
permission a Contents-only token does not have and would answer 403 either
way.

### C — a catalogue of courses other people made

"Share this course" opens a prefilled issue on a catalogue repo — a link with
query parameters, no backend and no token. A GitHub Action builds a static
index from labelled issues, 👍 reactions serve as likes, and an issue *is* a
comment thread. An unlabelled issue simply does not appear, so nothing is
required of the maintainer: that is what makes it work without anyone being an
editor. PRs were rejected as the submission model for exactly that reason —
a PR demands a decision per submission.

The one real limit: liking or commenting needs a GitHub account. Anonymous
likes are where a Netlify function plus Blobs would earn its place — and where
the `consistency: "strong"` fix below becomes load-bearing.

### D — comments under a course

giscus on the **overview page**, one thread per course rather than per
lecture: ten empty comment sections under ten videos read as abandoned, and
`viewer.ts` stays free of third-party scripts. Needs Discussions enabled on
the repo and a GitHub account to comment.

### Deferred deliberately

- **Batch video/YouTube export.** Recording is real-time `MediaRecorder` in
  the tab; ten lectures is ~an hour unattended with no resume. A queue with
  per-item status and resume-after-failure is its own project. Export stays a
  per-drawcast action meanwhile.
- **Batch translation.** Already exists in the upload dialog; a course × N
  languages multiplies everything.
- **Clickable next/previous inside a video.** The link target does not exist
  until after publishing, and a burnt-in URL goes stale on reorder. The
  end-card carries the next lecture's *title* instead, which survives both.
- **A module level above lectures.** Only matters past ~15 lectures and only
  affects the overview page. Making the middle heading level optional would
  move the video boundary depending on how deep a document happens to go —
  an ambiguity paid on every document forever. When needed it arrives as an
  ordinary option line, `part: Foundations`, touching nothing else.
- **Full version history for the course document.** One-step undo covers the
  actual fear ("the revision ruined it"). `history.ts` is text-based and
  would slot in if walking further back turns out to matter.

### Known loose ends

- **`SECONDS_PER_SPEAK_LINE = 4.5` is uncalibrated** (`src/course/run.ts`).
  Export one generated lecture, divide its duration by
  `collectSpeakLines(...).length`, and replace the constant. Until then the
  per-lecture runtime estimate is a rough guide, not a number to quote.
- **`netlify/lib/rate-limit.mts` calls `getStore()` without
  `consistency: "strong"`.** Netlify Blobs is eventually consistent by
  default, so the password limiter may not be counting at all. Not in the way
  of anything shipped, but it blocks C.

## Text size and font — done 2026-09-03

A global text style with three sources and one rule: the viewer's setting
if set, else the spec's `text:` block, else the app default (26, cursive,
normal). The spec speaks CSS — `font_size` as a base every size scales by,
`font_family` as a generic family (`cursive` | `sans-serif` | `monospace`),
`font_weight` (`normal` | `bold`) — so the compiler needs no new vocabulary.
Applied at two boundaries in `render()` (the measurer and the drawables), so
templates and the seventy-odd layout size sites never changed. Settings →
Playback holds "Text size" and "Font"; both apply in the editor preview,
Player mode and the standalone viewer; exports keep the spec's defaults.

### Deferred: per-element bold and italic

Held back on purpose (Hans, 2026-09-03): weight changes text width, so
`font_weight` / `font_style` on a single element has to travel from the
element through the tier-2 text paths, the wrap helper and the measure
calls into the text drawable — about as much work as the whole global half,
for a control the compiler will use rarely while color and the pulse/glow
effects already carry emphasis. Take it up when a drawcast actually needs a
bold label or an italic aside. The vocabulary is fixed in advance: the same
CSS names per element, two-valued (`normal` | `bold`, `normal` | `italic`),
synthesized by the browser on the handwriting face and identical in export.
No viewer override for either — emphasis is the maker's.

## Charts and races — done 2026-09-03

Hans asked which further chart types were worth building, and the evaluation
overturned the answer given in the M2 planning session. Histogram and box plot
were already answered — `bar_chart`'s own description routes histograms to it,
the data-bridge spec had ruled both out, and the catalogue already ships
`sampling_dist`, `galton_board`, `distribution_curve` and `binscatter`. The
scarce asset was never chart types: token substitution is not pack-gated
(`render/code.ts`, `spec/schema.ts` check only that the id names a code
element), so what the data pack actually owned was token-tolerant *schemas*,
staged values and the numeric `stage` the animate verb tweens — an idiom that
reached four templates of sixty-four.

Delivered: `stacked` on `bar_chart`; `slope` with `color_by: "direction"` on
`line_chart`; a new **`bar_race`** (horizontal or vertical, ranked or fixed, a
`top_n` field racers slide into and out of, a year ticker, value labels riding
the bars); the **line race** as three additions to `line_chart` (`ticker`, a
sliding `x_window`, `label_top`) rather than a new template, because
`line_chart` already did staged values, prefix reveal and end labels; optional
`easing` on the animate command, where absent keeps the historical smoothstep
byte for byte; a new **`heatmap`** (graded ink wash, a label flip decided by
computed luminance, `box`); the **`accepts_data`** flag, which widens a
template's params schema in one place instead of sixty hand edits; and six
templates retrofitted onto it — `distribution_curve`, `forest_plot`,
`survival_curve`, `ceac`, `did_trends`, `event_study`.

Two rulings decide whether a race looks right, and both are in
`plans/2026-09-03-charts-round-ledger.md` with the other twenty-two. Rank is
computed at each integer stage and then **interpolated**, never recomputed from
interpolated values — ranking the interpolation holds a racer in its row until
the crossing frame and then jumps it, and the difference was proved against a
naive twin that snaps. And a racer's ids and colours follow the **racer, not
the rank**, because the rough.js seed is `hashSeed(drawable.id)`: a rank-keyed
id re-rolls a bar's sketchy stroke at the exact moment of an overtake.

`null` in a values row means **absent, not zero**, across `bar_race`,
`line_chart` and `heatmap` — the chess race was labelling an unrated player
"1345" mid-tween until it did.

Performance: `npm run smoke:race` measures **~1.5 ms median and 4 ms
worst-case per frame** (layout plus rough.js path generation) against a 16.7 ms
budget for 60 fps. It is a CPU-time proxy and says so — it excludes DOM
construction, paint and compositing, and the number must never be quoted as
"fps in Chrome". The same harness lints every stage of a race, exempting the
one-frame overlap of an overtake (which is what an overtake looks like) and
nothing else, and carries an adversarial self-check that must fail so drift in
that exemption announces itself. `npm run sweep:round` lints every bundled
example at every stage it can reach.

Two gaps in the round's own evidence were found and closed: the bundled-example
test asserted only `severity === "error"`, so every warn-level overlap shipped
silently — and nothing anywhere checked that a template's examples satisfy that
template's own schema, which matters because `catalog.ts` shows the schema and
the examples to the compiler together. Both are now pinned. Along the way two
templates were caught inventing data: `forest_plot` printed
`1.00 [0.75, 1.30]` for an interval it did not have.

### A race never deletes a label — 2026-09-03

Hans watched the urn race and saw names vanish and come back: `label_top` names
only the N highest series *at the current stage*, ranked by each line's last
plotted point, so a line dropping a place lost its name and took it back on the
way up. His ruling: in a race a label is never eliminated — overlap is fine,
because the point is that racers move around and pass close, so make the
collision look deliberate instead.

So the bundled races name every line, and a crossing is *rendered* rather than
avoided: `lint.ts` gained one narrow `crossing` rule (two labels a race
template has keyed as movers may overlap each other — a label against an axis,
ticker, title, note or caption still fails), and the crossing labels dim. How
far is computed **per ink**: each dims until one 0.005 step further would drop
it under the pack's readable floor (`COLORS.guide` at full ink, 3.4815:1), and
an ink with no headroom does not dim at all. The race harness reads that same
shipped rule rather than keeping its own copy of the idea.

It cost nothing and gained something. With every line named, the dodge simply
handles it: across 4001 sampled stages the urn race shows all five names in
every frame, 22.3 units apart, with zero crossings and zero dimming needed —
and naming all four chess players turned out strictly better than the old
`label_top`, because the extra dodge slot dissolves the collision that param
existed to avoid. `label_top` survives as the exception for a chart with more
lines than a margin can name, and a test now stops a bundled example using it
without the narration saying so — which caught one that dropped a name at
stage 11 and explained it at stage 16.

Two things learned in passing. Restoring the exemption cost the harness its
old rule that nothing may be excused at an integer stage; that is back as an
invariant over the shipped exempt list, proven by injecting a layout defect
that had been passing silently. And the mechanism is the **paper halo**, not
doubled ink: every text is stroked 5 units in the page colour with
`paint-order: stroke`, and opacity dims halo and glyph together — so an
undimmed upper name *erases* the lower one, and dimming is what lets both
survive a crossing as continuous words.

### Follow-ups this round deliberately left

- **`bar_race` has no `box`.** Every other data-pack template can share a
  canvas with a code panel; the heatmap gained one mid-round on an argument
  that applies verbatim to a race.
- **Label-versus-unlabeled-stroke collisions.** The dodge defends labels
  against each other and against the ticker, not against a third series' line.
  It is why the chess line race ships `label_top: 2`.
- **`tray-model.ts` cannot tell a matrix from stages of a matrix**, so
  `heatmap` opts out of the stage slider and moves by `animate` alone.
- **`ticker` is documented as "ignored in slope mode" but is not** — the draw
  has no `!slope` guard. The behaviour is safe; the description is wrong, and
  descriptions feed few-shots.
- **Hoist the ellipsis-truncation loop into the kit** (`kit.ellipsize`): four
  bodies inline it and a fifth has already factored it — the next
  `X_CAPTION_DROP`-shaped cleanup.
- **`bar_chart` maps `null` to 0** while the rest of the pack treats it as
  absent. Documented rather than unified.
- **A racer's value label cannot dim, so two numbers collide at full ink
  during an overtake** — measured at 10–25 % of swept stages depending on the
  example (cities 22 %, funds 25 %), up to full box coverage, and because the
  halo dims with the glyph the number painted second *erases* the first rather
  than blending. Names handle this well; numbers have no contrast headroom
  left. The fix is a darker ink for value labels, which is a palette decision.
  Related: three of the six series inks already sit below the pack's own
  readable floor at full opacity (2.87 / 2.63 / 1.66:1) — also palette.
- **Neither gate reaches a code-fed example's resolved shape.** A bundled
  example whose params are still `"{id.var}"` tokens reports `staged: false`,
  so `sweep:round` sees one resting frame and `smoke:race` skips it — which
  means the urn race and the SIR race, the two that motivated the labels work,
  have no automated per-stage coverage of what actually ships. The fix is a
  committed `tests/fixtures/*.json` of resolved params that the gate loads; it
  never reaches a prompt, so the catalogue's prompt economy does not apply.
- **A coefficient-fed `event_study`.** The retrofit gives `did_trends` and
  `event_study` a scalar knob, not a vector: they were built as teaching
  diagrams, and plotting real estimates is a redesign. Their descriptions say
  SCHEMATIC out loud and name their silent clamps; an author with real
  coefficients has `line_chart` and `scatter_plot`.

## The voice a publish uses — fixed 2026-09-04

Hans, from a real failure on drawcast.app: he set a Norwegian voice in
Settings → Playback and the publish died with

    the voice "Charon" was rejected by the API — pick a different en voice

Two independent defects, and a UI label that invited the confusion.

### 1. The picker offered voices publish cannot use

`voices.list` returns Gemini-TTS voices beside the ordinary ones, and their
names are BARE WORDS — "Charon", "Puck", "Kore". Two things break on such a
name: `voiceLanguageCode` derives the request's languageCode by splitting the
NAME on "-", so it sent `languageCode: "Charon"`; and Gemini-TTS additionally
requires a `voice.model_name` this client never sends. Either way every call
400s — a voice that can only fail, offered in a dropdown, with the failure
surfacing at publish time after the author has committed to the pick.

One rule now, `isUsableVoice`, read in both directions: `listCloudVoices`
filters the dropdown, and `preferredVoice` ignores a name an older build
already stored — otherwise filtering the dropdown would not have unstuck
Hans, whose `cloudVoices.en` still held "Charon". Falling back is safe HERE
and not at the API, because `stampedVoice` reads the same function: the clip
is stamped with the voice that actually sang it, so the reuse check cannot
mislabel a recording (the rule that made an API-side silent substitution
unacceptable in the first place).

Supporting Gemini voices properly means sending `voice.model_name` and
pinning a model whose name is still moving ("gemini-2.5-flash-tts",
"gemini-3.1-flash-tts-preview"). Left as its own piece of work.

### 2. The declared language never reached the cloud voice

`spec.lang` was already threaded to `speech.setLangHint`, and the BROWSER
voice path honoured it — but the cloud path sniffed every line with
`detectLang`, which knows Norwegian only by its letters and a short stopword
list. "Microdata har 10 000 enheter" reads as English, so a Norwegian
drawcast handed that line to the English voice, and with it to the English
slot of the author's per-language picks. That is why Hans's Norwegian pick
did not apply and a stale English one did.

`voiceLang(declared, text)` is now the one place that decides, used by
`synthesizeBase64`, `clipCacheKey` and the two bakes. It also reduces a
regional tag to its primary subtag, because `VOICES` and
`settings.cloudVoices` are keyed "nb"/"en" — a spec saying "nb-NO" used to
miss the author's "nb" pick entirely.

**The declared language stays UNDEFINED when nothing declares one.** The bake
had `?? "en"` for its track metadata, and reusing that for the voice would
have re-keyed every existing undeclared drawcast and re-charged its whole
narration. Undeclared documents keep the old sniffing key, byte for byte.

Cost of the fix, stated plainly: a drawcast that DOES declare `nb` re-bakes
the lines whose sniff disagreed with the declaration. Those clips were in the
wrong voice, so re-paying for them is the point.

### 3. And then it failed again, on a Chirp voice

Hans picked `nb-NO-Chirp3-HD-Charon` — a properly locale-prefixed name that
passes `isUsableVoice`, and it reached the `nb` slot, so fixes 1 and 2 both
worked. It still 400ed. His observation was the whole diagnosis: baking the
course **succeeded for three lectures and died on the fourth or fifth**.

So the voice was never the problem — one LINE was. The only per-line
difference in the request is `delivery`, which is the sole reason `pitch` and
`volumeGainDb` are ever sent, and Chirp 3: HD rejects pitch outright (and
caps speakingRate at 2.0). The publish ran until the series' first
soft/grave/brisk line and stopped there.

`audioLimits(voiceName)` replaces the old `!name.includes("Studio")` pitch
test with a per-family table: Chirp takes no pitch, no gain, rate ≤ 2;
Studio takes no pitch; everything else takes the lot. Dropping a field costs
a subtle prosody nudge on those voices; sending it costs the publish.

**And the reason this took three rounds:** the 400 handler threw our own
guidance and DISCARDED the API's sentence — the one that names the offending
field. It now carries both. Two rounds of guessing came out of that, and the
lesson generalises: an error that replaces an upstream explanation with
advice is worse than one that appends to it.

A bookkeeping defect on the same path, found by the new test: `saveUsage`
wrote to localStorage unguarded while `loadUsage` read through the guarded
helper. A browser that refuses storage turned a paid, SUCCESSFUL synthesis
into a failed publish. A usage counter must never fail the work it counts.

### 4. The rule that should have been there all along

Hans, after the third round: clean it up with "don't send fields that are
null". The measurement behind it — of the 42 `delivery` uses in the bundled
examples, **40 are `grave`, whose pitchSt and gainDb are both 0**, and
`brisk` (also all-zero) is used exactly 0 times. So on 95 % of the uses the
request announced a pitch and a gain it was not applying, and that
announcement is what a Chirp voice rejects.

`audioConfig` now carries only fields that do something: no `pitch` or
`volumeGainDb` when the delivery does not colour the voice, and no
`speakingRate` when it is the API's own default of 1. `soft`, the one
delivery that genuinely colours, still sends both.

This fixes the failure at the source rather than per voice family. The
per-family table stays, because `soft` on a Chirp voice still has real values
to suppress and the rate cap is still real — the two rules compose.

The general lesson, worth more than the fix: **a field carrying the API's own
default is not a setting, it is noise with a failure mode.** It cannot help,
and it can be rejected.

Left alone deliberately: the browser speechSynthesis path sets
`utterance.pitch = 1` for a neutral delivery, which is equally a no-op — but
nothing there can reject it. This is a rule about network requests.

### 5. The label

"Which language this voice choice applies to" is a scope selector, not a
narration-language setting — the narration language comes from the document.
Hans read it as the latter, which is a fair reading of a dropdown that sits
directly above the voice it governs. Not changed yet; noted.

### Not verified against the live API

Nobody here has a TTS key, so no round was re-run end to end: the filter is
tested against a stubbed `voices.list` answer, the request body against a
stubbed synthesize call, and the naming and prosody rules against what Google
documents. Hans's next publish is the real test — and now it will say what
the API actually objected to.

## microdata as a fifth runtime — done 2026-09-04

Hans wants an introduction to microdata.no built in drawcast, and chose
"teach the LANGUAGE first". So microdata became a `code` element language
rather than a new element, a template, or a mock UI:

```yaml
elements:
  - id: md
    type: code
    language: microdata
    show: left
    frame: screen
    draw: { mode: type }
    code: |
      require no.ssb.fdb:54 as fd
      create-dataset lonn
      import fd/INNTEKT_WLONN 2022-01-01 as inntekt
      summarize inntekt
```

Everything the lesson needs then came for free: `draw.mode: type` writes the
script out character by character, `md_line_3` makes each command its own
beat, `lines:` scrolls it like an editor, the output is REAL (so it cannot
rot against hand-written results), the result cache means a re-watch costs
nothing, `{md.df}` feeds `data_table` and the chart templates, and the code
panel is already editable and re-runnable while paused — so "try it
yourself" needed no new code at all.

### How it runs

drawcast does NOT reimplement the microdata parser. `m2py.py` — the real
emulator, 10k lines — is a Python program, and drawcast already runs pyodide,
so the emulator is vendored (`scripts/sync-mdlib.mjs` →
`public/mdlib/<MDLIB_VERSION>/`, 1.3 MB, stamped with a manifest) and runs on
the SAME pyodide instance and the SAME RunQueue as the `python` language. A
second instance would double a 30 MB download; a second queue would let two
scripts interleave inside one WASM heap.

Three seams, each testable where it lives:

- `src/code/microdata-output.ts` — what the emulator's answer MEANS. Pure and
  node-tested (`tests/microdata-output.test.ts`), the harvest.ts idiom.
- `public/mdlib/<v>/drawcast_microdata_runner.py` — the Python seam, tested
  by `npm run sanity:mdlib` under local CPython, since vitest cannot run m2py.
- `src/code/microdata.ts` — fetch, install, call. Thin on purpose.

### What the emulator does that no other runtime does

1. **It answers with one string.** Figures and tables ride inside it as
   `__micro_transform_start_<type>__` blocks. `figure` payloads are plotly
   JSON (straight into the shared renderer); `tablehtml` is pandas' own
   `to_html`, parsed back to `{columns, rows}` so drawcast draws its own
   ruled grid and no HTML ever enters the app. A Series is written with
   `header=False` and has NO thead — those get one blank header per column,
   because the grid sizes itself from `columns.length`.
2. **Failure is LOGGED, not raised.** A bad command prints `FEIL …` and the
   run "succeeds". Without detection the repair round would never fire and a
   broken script would show its error as if it were the answer. Matched
   case-sensitively on both catalogues' prefixes; `\b` keeps "Feilverdier"
   out.
3. **A missing package is logged in Norwegian.** `barchart` does not raise
   ModuleNotFoundError — it raises the emulator's own "plotly må være
   installert … pip install plotly". Matching only Python's wording left
   EVERY chart command broken. Caught by the live browser smoke, not by a
   unit test — `missingModule` now reads the `pip install <pkg>` tail, and
   plotly/statsmodels/lifelines install on demand and the script re-runs.
4. **An invented variable does not fail — it gets invented data.** The
   mock-data engine fabricates a plausible column for any name, so a
   hallucinated `INNTEKT_FANTASI` would run clean and teach a variable that
   does not exist. Only the shipped catalogue (736 names) can see it, so the
   runtime refuses the script before running and names near matches for the
   repair round.

### Rulings

- **Disclosure control OFF** (Hans, 2026-09-04). Set explicitly at boot
  rather than inherited, so an upstream release cannot quietly reshape a
  lesson's output; a script can still opt in with `// m2py: dc=on`.
- **A fresh interpreter per run.** Caught by the sanity script: a reused one
  let run B see run A's datasets, and the result cache is keyed by the SCRIPT
  — B would be cached under a key that never mentions A and replay wrongly
  the moment the two figures were drawn in the other order. Costs ~15 ms.
- **10 000 rows**, the emulator's own default, so a number a learner sees
  here is the number they see on microdata.no.
- **One printing command per element.** Tables stack under the text, so two
  of them lose their interleaving. This is also the teaching rhythm — one
  beat per command — so it is a rule, not a regret.
- **Give the output the full width.** The emulator echoes every command and
  answers in a full Norwegian sentence, so `show: "left"` starves the output
  pane: the bundled example lost its own summarize table to a
  "… (4 more lines)" before this was caught by loading it. Use
  `show: "below"` with `lines:` on the code. And `summarize` always prints
  NINE columns (it has no option to print fewer), which needs
  `width: 960` + `font_size: 16` — anything narrower clips the mean itself.
  `tabulate` is two columns and reads at any size.
- **`collapse` before the data bridge.** 10 000 people is over the harvest's
  5000-number cap, which is the honest lesson too: you aggregate, you never
  plot individuals.
- **No `microdata-vocab.ts`.** The design called for the 80-command list in
  one place, but nothing consumes it: the emulator itself is the authority,
  and `check.ts` runs the script. The prompt carries a teaching subset.
- **The snapshot is copied, never hand-edited.** `sync-mdlib.mjs` stamps a
  manifest of sha-prefixes; `--check` verifies it; a vitest guard fails if
  `MDLIB_VERSION` names a snapshot that is not on disk, and another fails if
  `__pycache__` (which vite would publish) is left in it.

### Deliberately not done this round

- The `microdata_screen` template — the app chrome as a drawn figure, with
  the script and output supplied by a `frame: "none"` code element placed
  inside it. Pure pack YAML, no core change. Hans chose language first.
- Generic `hotspots` on `SceneLayout` (click a part of a figure → jump to a
  labelled beat), which is how a clickable screen should be built. NOT the
  piano/chess pattern: hand-written TS hit-boxes that must be kept in sync
  with a template's constants.
- Baking `code_result` into a published cast, so a learner never boots a
  runtime. Worth doing for courses generally, but a learner here is meant to
  edit and re-run, so the runtime loads anyway.
- statx / py2m / r2m, the other modes in the microdata repo.

## View counts — done 2026-09-04

How often a published drawcast has been played. GitHub gives nothing here —
Pages has no analytics, and the repo traffic API counts views of the
*repository page on github.com* plus clones, needs write access, and keeps 14
days — so counting happens where we already own the code: the viewer. Every
`#gh=` link runs our player, so the content path `owner/repo/path.yaml` is
already a permanent identifier, and **nothing in the publish flow changed**:
everything published before this shipped counts from the day it deployed.

Each view writes one Blob keyed by that path; totals are derived by counting
keys. Writes never read, so simultaneous views — a class opening a lecture
together — cannot lose hits the way a read-modify-write counter does (Blobs
has no compare-and-set). Finished days fold into a per-cast rollup so a read
never grows with lifetime views, and **a day present in the rollup is counted
from the rollup only, its raw keys ignored** — that one rule is what makes
compaction safe to interrupt, duplicate, or race.

Reads are public but *keyed*: you must name a repo. drawcast.app is a shared
viewer, so a list-everything endpoint would expose other people's publishing;
scoping to a named repo leaks nothing that is not already public on GitHub.
`meta.views: false` rides in the published file when the author unticks
**Count views**, and off means the player never calls — nothing is recorded,
rather than recorded and filtered.

### The bug the suite could not see

All 4170 tests were green while the counter was **broken in production**:
writes landed, but the listing never returned them, so every badge would have
read `1` forever and the dashboard stayed empty. The cause was an encoding
asymmetry in the Blobs SDK — `set` sends the key raw in the URL path while
`list` sends its prefix through `URLSearchParams` — so the percent-encoded
key got a different number of layers per operation.

Two separate reviews had named this exact area as unverifiable without live
Blobs and load-bearing for the design; it was deferred, and it was the bug.
Every test drives an injected fake store, which is right for unit tests and
worth nothing against an API that does not behave like the fake. **The
generalisable lesson: a fake that never disagrees with the real thing is not
evidence about the real thing.**

### Remaining

- **The author-side e2e.** Publish a real drawcast and confirm the badge
  renders in the player. The chain is verified from the endpoint down —
  `POST → 1 → 2 → 3`, read-back agrees, repo grouping correct, and repo-prefix
  isolation re-checked with raw-slash keys — but the badge's own rendering
  needs a GitHub token to reach.
- **A live smoke script.** The bug above was found by hand with `curl`. That
  probe sequence belongs in `scripts/` beside `smoke:race`, because it is the
  only test in this feature that can fail for a real reason.
- **Five stray smoke hits** sit in the store under the deliberately fake repo
  `hmelberg/drawcast-smoketest`. Harmless — only a query naming that exact repo
  sees them — but there is no delete path, which is itself worth noticing.

### Follow-ups this round deliberately left

- **Course index landings.** The generated course page on `github.io` is
  script-free HTML the player never sees, so someone who opens a course and
  never clicks a lecture is invisible. A small inline script in `coursePage()`
  would count them, at the cost of changing published output and needing every
  course republished. Per-lecture counts — the more useful number, since they
  show drop-off from lecture 1 to lecture 7 — work regardless.
- **Per-source breakdown.** A source token in the key
  (`h/<cast>/<day>/<source>/<uuid>`) keeps counting-by-prefix intact and would
  separate arrivals from the Pages course page, the repo README, and pasted
  links. Left out because referrers are coarse and often absent, so the answer
  would be indicative rather than true.
- **A stats page.** v1 reads raw JSON at
  `/.netlify/functions/views?repo=<owner>/<name>`. Because reads are public and
  keyed, any dashboard is just a *client* of that URL — an in-app `#stats=`
  route, or the Anvil app that was weighed against this design and lost on
  delivery friction, not on merit. No migration either way.
- **The initial-rollup race is narrowed, not closed.** Two readers can still
  both see a day's rollup absent, list different eventually-consistent counts,
  and have the smaller write land last. `Math.max` against a re-read rollup
  plus a 15-minute post-midnight grace window shrink the window; only
  compare-and-set would close it, and Blobs has none.
- **`countRepo` is written for correctness, not speed.** It awaits one rollup
  read per cast serially, and `rawByCast` rebuilds its array per hit (O(n²) in
  one cast's raw keys). Both are one-line fixes worth taking the day a
  dashboard actually renders this.
- **`countRepo` accepts any key that decodes.** An `isValidCastKey` filter
  would drop a stray blob that decodes but was never a cast; today it would
  surface as a phantom row.
- **The client's key check mirrors the server's regex but not its 300-byte
  cap**, so an over-length key costs one pointless request — for a key the
  viewer could not have opened anyway.
- **Comments still lack the course seed.** `SavedCourse` gained
  `publishedViews` so an opted-out course stays opted out across a republish;
  `publishedComments` has the identical hole and did not get the same
  treatment. It matters less because a comments box reappearing is *visible* —
  the author notices — whereas counting resuming is not.
- **Smaller ones:** `Vary: Origin` still rides along on GET responses whose
  `Access-Control-Allow-Origin` is now `*`, fragmenting CDN cache for nothing;
  `.viewer-meta` keeps ~5px of padding when the badge is empty; the response's
  `days`/`total` come from the pre-compact rollup, so it can momentarily report
  less than what was just made durable.

### The player round — agreed, not started

Framed as a YouTube-like separation: the player is a hard boundary containing
everything that changes what you see (stage, controls, params tray, code
panels), while everything *about* the drawcast — title, view count, share,
comments — sits below it as page furniture. Fullscreen already honours that
boundary (`tests/fullscreen-frame.test.ts` enforces that every `:fullscreen`
selector names `.player-figure`); the non-fullscreen layout does not yet.
Unlike YouTube the box must be free to grow taller when a tray or code panel
opens, rather than being pinned to a video-shaped rectangle.

- **Fit-to-window sizing for `#gh=` links.** Measured on a live drawcast: the
  shell appears at 1055 ms with `.player-figure` at **960×16 px** — an empty
  bordered strip — and jumps to 960×752 only when the figure mounts. There is
  no animation; the box is content-sized, so it has no height until `render()`
  fills it. And `.viewer-wrap`'s `min(960px, 96vw)` at 4:3 is ~750px tall, so
  on a 730px viewport the play bar lands *below the fold* and the page
  scrolls. One fix removes both: size the viewer's figure from the viewport,
  hoisting `.viewer-body .player-figure` into the existing fullscreen rules
  rather than writing a fourth copy of them.
- **Comments below the drawcast**, out of the player's fixed-height column.
- **The `.viewer-footer` strip goes**, Share becoming an icon — in the control
  line, or in the meta row beside the count; that round decides.
- **A poster frame**: the drawcast's final image before play instead of a
  blank stage, cleared on play, designed so a user- or LLM-supplied start
  image can replace the default later (`meta.poster`, defaulting to the final
  frame). Sizing, poster and title-below want doing together — the page then
  looks finished at 200 ms instead of at 6 seconds.
- **The replay icon flashes at chapter boundaries** in a multi-chapter
  drawcast; it should appear only at the true end.
- **Drawcasts sometimes end on an empty chapter.** The last frame should hold
  whatever was on screen.
- **Same root cause, separate symptom:** the figure box collapses to the 16px
  strip and re-expands at *every* playlist item change, mid-playback, because
  `destroy()` removes the figure before the next one renders. The viewer's copy
  goes away with the sizing fix; the app player's does not.

## Deliberately left in `draw` (the frozen lab)

Backend comparison grids, the raw-SVG baseline, the benchmark runner UI, and
prompt A/B scoring. When a prompt change needs evidence, run it through the
lab; the packet export here feeds the same improvement loop.

## Housekeeping

- Regenerate `package-lock.json` (`npm install`) and switch CI back to
  `npm ci` with the npm cache.
