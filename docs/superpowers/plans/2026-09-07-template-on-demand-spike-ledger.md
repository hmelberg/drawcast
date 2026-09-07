# Spike ledger — template on demand (2026-09-07)

Question (Hans, 2026-09-07): when a request has no template, is a
template the model authors on the spot better than the freehand
(tier-2) figure the compiler draws today? If yes, "template on demand"
is worth building; if no, the freehand path is good enough and the
library should keep growing by hand.

Worktree: `.claude/worktrees/template-spike`, branch
`worktree-template-spike`, base 43082fc (5235 tests green after a real
`npm ci` — a symlinked node_modules from the main checkout lacked
astronomy-engine and failed 6 files).

## Method

Throwaway harness (scratchpad `spike.mjs`, Playwright 1.62 from
microdata's node_modules against `vite --port 5178`, headless). Everything
runs inside the real app page through vite's module graph, so the
registry, packs, prompts and renderer are exactly the app's:

- **Arm A, baseline** — `generateSpec(request)` with the full catalog
  (all bundled packs), `bundledExemplars` = examples.json, no user
  exemplars, `pedagogyReview: false` (both arms; it changes narration,
  not the figure), `executeCode: false` (no code elements expected).
- **Arm B, template** — `generateTemplate(description)` from
  `src/llm/author.ts` (the shipped Author dialog pipeline: validate →
  compile → run examples[0] → preview lint → up to 2 repairs), register
  it through `registerUserTemplateYaml`, then `generateSpec(request,
  {forcedTemplate: id})` — the same forced-template path `#template=`
  uses. The `description` is what a compiler escalation would carry:
  figure type, parts, params, and what requests it should catch
  (scratchpad `topics.json`).
- Both specs are rendered with `render(spec, host, {mode: "instant"})`
  and screenshotted; `hd.lint()` and `layout.warnings` recorded.
- Model: `claude-opus-5` (the app default) for every call; repairs use
  the app's repair routing (Sonnet 5, low effort).

Five requests with no matching template (checked against every pack —
`neuron` was dropped because medicine has one):

| slug | request |
|---|---|
| bicycle_gears | Explain how bicycle gears work: why a small rear cog makes pedalling harder but faster, and a big one easier but slower. |
| violin | Show the parts of a violin and explain what each part does for the sound. |
| water_cycle | Explain the water cycle: evaporation, condensation, precipitation and collection. |
| flower | Show the parts of a flower and explain how pollination leads to a seed. |
| hydraulic_press | Explain a hydraulic press: why a small force on a small piston can lift a heavy load on a big piston. |

## Finding 0 — the authoring call overran its output limit

First real run: `The reply was cut off at the output limit (16000 tokens,
thinking included)`. `callForJson` hard-codes `max_tokens: 16000`; a
template document is a whole program plus schema, and Opus with thinking
on spent 20 349 output tokens on the bicycle drivetrain. Fix in this
worktree: `CallOpts.maxTokens` (default unchanged, 16000) and the
authoring rounds pass 32000. This is a real defect in the shipped Author
dialog, not a spike artefact — keep the fix.

## Results

### bicycle_gears

| | baseline (freehand) | template (authored) |
|---|---|---|
| wall time | 85 s (1 round) | 263 s = author 230 s (1 round, 20 349 out-tokens) + spec 31 s |
| system prompt | 178 934 chars | 124 768 chars (forced template = one catalog entry) |
| spec | 19 elements (text/shape/label/path/arrow/annotation), 16 commands | template `bicycle_drivetrain` + 2 elements, 17 commands |
| lint at render | clean | clean |
| figure | two plain circles, chain = two grey lines, no crank, no wheel; the 10-tooth cog the narration talks about is never drawn (only the 25-tooth one); two ratio lines as text | toothed chainring and cog at true relative size, chain with links on both tangents, crank + pedal + force arrow, faint wheel with spokes and a rotation arrow, ratio caption |
| what only one arm could do | erase-and-redraw to "shift gear" | `animate: {rear_teeth: 28}` — the cog GROWS and the ratio caption re-computes while the narration shifts gear; `front_teeth`/`rear_teeth` carry min/max, so the ⊕ tray offers them as sliders for free |

Verdict: template wins clearly on the figure and on the storyboard (a
real gear shift instead of erase/redraw). Cost: 3× the wall time.

Defects seen: the compiler added its own `title` text element on top of
the spec title (compiler habit, not the template's); the "Chain" label
crowds "28T rear cog" at the animated stage (lint clean at rest — the
animate-stage guard the examples test applies would have caught it).

### violin

| | baseline (freehand) | template (authored) |
|---|---|---|
| wall time | 140 s (1 round, 10 301 out-tokens) | 371 s = author 334 s (1 round, 28 605 out-tokens) + spec 35 s |
| spec | 28 elements (text/path/label/annotation), 18 commands | template `violin_anatomy`, 0 extra elements, 18 commands; params: instrument, bow, strings, highlight, labels (a list of 13 part ids) |
| lint at render | 1 warn (label on stroke) | 4 warns (Fingerboard on body/purfling, Bridge on fingerboard/string_3) |
| figure | a guitar-shaped outline, strings fan out from the pegbox like a broom, the bridge is an oval with a zigzag inside, no bow; labels float free of the parts | a violin: scroll, four pegs, neck, fingerboard, four strings, f-holes, bridge, purfling, hatched top, tailpiece, chinrest, plus a bow with frog and tip; every part has its own element id |
| what only one arm could do | — | `labels` is a list param, `highlight` names a part: the storyboard draws parts one at a time by id; every named part is a click/drag target for `ask` and a slider-free ⊕ entry |

Verdict: template wins on the figure by a wide margin (the freehand
violin is barely a violin). Cost: 2.6× wall time, and the authored
layout left four label-on-stroke warnings the authoring loop does not
repair (only errors trigger a repair round — the same threshold the
compiler uses).

Defects seen: the fingerboard is drawn down to the bridge and its label
lands on the body; "Waist (C-bout)" and "f-holes" crowd each other. Both
are label-placement issues on a good drawing — the kind a second repair
round on warnings would fix.

### hydraulic_press

| | baseline (freehand) | template (authored) |
|---|---|---|
| wall time | 103 s (1 round, 8 304 out-tokens) | 274 s = author 233 s (1 round, 19 975 out-tokens) + spec 39 s |
| spec | 22 elements, 18 commands | template `hydraulic_press` + 2 elements, 19 commands; params: areaRatio, inputForce, forceUnit, loadLabel, fluidLabel, showDisplacement, showEquation |
| lint at render | clean | clean |
| figure | a clean U-shaped vessel outline, two piston plates, force arrows, a 100 kg block on a stalk, dashed "falls 20 cm / rises 1 cm" arrows, the pressure equation and a work line in a box | the same U-vessel with hatched fluid, piston rods, a hatched ground line, d1/d2 displacement marks with dashed levels, the load block, equation plus two derived lines |
| what only one arm could do | — | `animate: {areaRatio: 10}` — the wide piston widens and the derived force/displacement lines re-compute during the "now make it ten times bigger" beat |

Verdict: close. The freehand press is already a good textbook figure
(the best baseline of the five — this is the kind of boxes-and-arrows
schematic tier-2 does well). The template adds fluid, ground and a live
area ratio; a small win on the figure, a clear win on the animate beat.

### water_cycle

| | baseline (freehand) | template (authored) |
|---|---|---|
| wall time | 70 s (1 round, 5 166 out-tokens) | 324 s = author 294 s (1 round, 25 263 out-tokens) + spec 29 s |
| spec | 20 elements, 14 commands | template `water_cycle`, 0 extra elements, 19 commands; params: stages (list), labels, groundwater, precipType |
| lint at render | clean | clean |
| figure | schematic: a sun circle, a cloud of three circles, a mountain as two lines, a wavy sea line, four curved labelled arrows (evaporation / condensation / precipitation / collection) | a landscape: sun with rays, hatched ocean and land, two hatched clouds with a condensation arrow between them, rain streaks, runoff arrows down the slope, infiltration arrows into a dashed groundwater layer flowing back to the sea |
| what only one arm could do | — | `stages` is a list param: the storyboard adds runoff and infiltration (the request named four stages, the template offers five, the compiler took them) and `focus` zooms into the groundwater |

Verdict: template wins on the figure (the freehand one is a diagram of
the words, the template one is a picture of the thing). The freehand
figure is cleaner and 4.6× faster; a teacher who wants a schematic would
be happy with it.

Defects seen (template): the "Evaporation" label sits far left of its
arrows; the closing narration line overflows the caption bar (spec text,
not layout).

### flower

| | baseline (freehand) | template (authored) |
|---|---|---|
| wall time | 104 s (1 round, 8 418 out-tokens) | 353 s = author 327 s (1 round, 29 053 out-tokens) + spec 24 s |
| spec | 28 elements, 18 commands (with two `camera` moves) | template `flower_anatomy` + 2 elements, 20 commands; params: petals, stamens, pollen, bee, labels (13 part ids) — the template also carries part names in six languages |
| lint at render | 2 warns (Ovule label on a petal, Seed on the stem) | 2 warns (Pollen tube on two petals) |
| figure | stick diagram: two thin petals, two lollipop stamens, a bullseye ovary, a dashed line for the pollen tube; "Seed" floats under the ovary | a flower: five hatched petals, sepals, receptacle, two stamens with anthers, a pistil with stigma, style and three ovules, a pollen path from a drawn bee to the stigma and a dashed pollen tube down the style |
| what only one arm could do | camera moves onto its own thin drawing | `pollen: true` draws the whole fertilisation story as named parts (pollen grain, path, tube), so the storyboard can draw and point at each |

Verdict: template wins clearly; the freehand flower is not something a
biology teacher would show.

## Verdict

| topic | figure | storyboard | wall time (template / baseline) |
|---|---|---|---|
| bicycle_gears | template, clearly | template (`animate` the cog) | 263 s / 85 s |
| violin | template, clearly | even | 371 s / 140 s |
| water_cycle | template (freehand is a fine schematic) | template (`stages` list, `focus`) | 324 s / 70 s |
| flower | template, clearly | template (`pollen` story) | 353 s / 104 s |
| hydraulic_press | close (freehand already good) | template (`animate` the area ratio) | 274 s / 103 s |

Four clear wins and one draw for the authored template, on the figure.
On the storyboard the template arm wins wherever the template exposes a
numeric or list param the compiler can animate or step through — which
the authoring prompt produces without being asked. The cost is 2.6–4.6×
the wall time (four to six minutes per request instead of one to two),
almost all of it the authoring call: 20–29k output tokens of Opus with
thinking, one round each — no repair round was ever needed once the
output ceiling was raised, and no authored layout threw or failed the
compile guard.

What the authored templates got for free from the interaction layer
(no code touched): `front_teeth`/`rear_teeth`/`areaRatio` carry
min/max, so the ⊕ tray offers them as sliders; every part has its own
element id with a closed outline, so click and drag asks work on them.
What they did NOT get: an identify quiz (the generator is still bound
to piano/chess/periodic) — the generic "parts" quiz from the assessment
is the missing piece, and these five templates are exactly the figures
it would light up.

Two systematic defects of authored templates, both label placement:
2/5 left warn-level label-on-stroke issues that the authoring loop
does not repair (only errors trigger a repair round), and the labels
inside crowded interiors (a violin's bridge, a flower's pollen tube)
need a human-quality second look. A repair round on warnings — one
Sonnet call — would likely fix most.

Recommendation: build "template on demand" as an OFFER on the
compiler's escalation channel (the assessment's step 3), not as
automation, and put the generic identify quiz and template transport in
published casts ahead of it — the first because it multiplies the value
of every authored template, the second because without it an authored
template only ever works on the author's own machine.

## Integration (what shipped from this spike)

- The five authored templates are bundled: `bicycle_drivetrain` and
  `hydraulic_press` in the physics pack, `violin_anatomy` in music,
  `flower_anatomy` and `water_cycle` in biology (pack descriptions
  updated in the YAML headers and PACK_DEFS; the pinned id lists in
  tests/packs.test.ts extended).
- The five template-arm drawcasts are bundled examples (src/examples.json,
  format-preserving append), each tagged with its pack. Baseline
  (freehand) drawcasts were NOT added: the examples list also feeds the
  compiler's exemplar pool, and two of them lint with warnings anyway.
- Hand edits, so the examples pass the zero-warning bar:
  - violin: `label_fingerboard` moved to the neck (was on the body),
    `label_bridge` moved below the right f-hole with the gesture anchor
    kept on the bridge. The cello/Italian manifest example still has one
    warn ("Ponticello" is too long for the space inside the lower bout).
  - flower: `label_receptacle` moved below-right (was on the stem),
    `label_pollen_tube` moved left of the style with the gesture anchor
    kept on the tube.
  - bicycle example: spec title aligned to the drawn title ("Bicycle
    gears") so the renderer's title band does not duplicate it (C9
    rule). Known: at the animated stage (`rear_teeth: 28`) the wheel
    label sits on a spoke — warn-level, not covered by the examples
    test, which only sweeps `stage` animations.
  - water_cycle: the second manifest example (transpiration only) has one
    warn-level label issue; left.
- `CallOpts.maxTokens` + 32000 for authoring rounds (Finding 0).

### harness note

The first four-topic run died mid-violin: vite logged a "page reload"
for client.ts/author.ts at 17:01 although neither file was touched
(mtimes 16:51), and the reload destroyed the evaluate context. The
harness now blocks the HMR websocket (`page.routeWebSocket`) and catches
per-arm errors. Background commands cap at 10 minutes, so each topic
runs as its own job, four in parallel.

Second trap: a `render()` fired the instant every pack template had a
`layout` in the registry hit "unknown template bicycle_drivetrain" —
startup re-registers packs after the first registration lands, and the
first render fell into that window. A 4 s settle after the registry check
made all five render clean in the browser (label lint clean too, with the
real text measure). Not a product bug a user can reach (the Examples list
loads after startup), but a smoke script must wait for startup, not for
the registry.
