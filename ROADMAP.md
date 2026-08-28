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

## Deliberately left in `draw` (the frozen lab)

Backend comparison grids, the raw-SVG baseline, the benchmark runner UI, and
prompt A/B scoring. When a prompt change needs evidence, run it through the
lab; the packet export here feeds the same improvement loop.

## Housekeeping

- Regenerate `package-lock.json` (`npm install`) and switch CI back to
  `npm ci` with the npm cache.
