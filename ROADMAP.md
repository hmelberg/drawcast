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
  scrub-safe via a runtime override overlay. Still future: answers logged,
  {var} in drawn text, widget answer devices.
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
