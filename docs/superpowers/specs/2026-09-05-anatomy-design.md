# Anatomy — the body as an atlas, not as a drawing

Written 2026-09-05, after the PPF/QALY round (e87b772). Approach approved by
Hans: **2D atlas first, 3D as an optional panel later.**

## What Hans asked for, in his order of importance

1. An anatomy template, allowed to be fairly detailed.
2. A way to choose HOW detailed — zoom in and out, focus on some organs or parts.
3. Ask-questions built on the body: locate a structure by clicking or touching
   it, name all the joints, multiple choice about the body.
4. Colours.
5. Standard anatomy files, if they help.
6. Sex, and maybe age — "not so important in v1, I think".
7. Pathology: put faults IN. Listen to a heart rhythm through a stethoscope and
   hear a defect; put diseases in organs for the viewer to identify. In short:
   the template should be able to CHANGE the body, not only draw the normal one.

## What drawcast already had (measured, 2026-09-05)

Most of the interaction Hans wants is already built:

- `ask.widget: "click"` — click the named element, the answer is its element id
  (`src/spec/schema.ts:386`). The gate maps clicks through the svg's LIVE
  viewBox, so it is camera-proof and works under zoom (`src/ui/controls.ts:188`).
- `quiz` — multiple choice, 2–4 options, with `right_goto`/`wrong_goto`.
- `camera: {center, zoom}` and `animate` on numeric params.
- `sampleSvgPath()` (`src/scenes/svgpath.ts:20`) — SVG path data → polylines.
  Written for MathJax glyphs, general enough for anything.
- The `engines` mechanism: a template declares `engines: [geo]` and the data is
  lazily `import()`ed only when that template runs (`src/scenes/engines.ts:597`).
- `world_map` (`src/scenes/packs/maps.yaml`) is the STRUCTURAL TWIN of an
  anatomy template: an external geometry dataset, `focus` to crop, `highlight`
  to tint, `markers` to label, and an unknown-name note instead of a failure.
- `heart_circulation.defect: septal_defect` — precedent for "put a fault in" as
  a parameter.
- `WebAudioTones` (`src/render/tones.ts:40`) — a real oscillator-layer synth
  with per-instrument envelopes.

So this round is mostly DATA plus one small fix, not a new interaction system.

## What the research settled

**A usable standard file exists — for the skeleton.** Häggström's
`Human skeleton (svg template).svg` on Wikimedia Commons is **public domain**
and is a real vector atlas: 36 named bone groups with left/right ids
(`FemurLeft`, `ClavicleRight`, `Cranium`…), and the part-of hierarchy is IN the
file (`FootLeft` ⊃ `TarsalsLeft` + `MetatarsalsLeft` + `PhalangesFootLeft`).
Every path parses through drawcast's own `sampleSvgPath` with zero failures.

**But the point budget explodes.** Measured: 980 rings, **131 633 points**
across those 36 groups. That is one to two orders of magnitude too many for one
figure. Decimation is not an optimisation here, it is a precondition — and it
confirms the architecture: a coarse whole-body atlas plus detailed regional
atlases, exactly the `countries-110m` vs `countries-50m` split the maps roadmap
already describes.

**The organ template does not work.** `Female template with organs.svg` is 6 MB
because it embeds **22 raster images**. Organs must be drawn.

**Naming standards are usable as vocabulary.** UBERON is CC-BY. FMA grants a
royalty-free licence to reproduce, modify and distribute the ontology (but not
to use the FMA or University of Washington names). Either can supply stable
ids, Latin/English names and the part-of tree.

**3D is real but cannot carry the teaching.** `3dmol` 2.5.5 ships only
molecular parsers — no STL/OBJ — but `viewer.addCustom({vertexArr, faceArr})`
renders arbitrary triangle meshes, and shapes are `clickable`/`hoverable` with
per-shape colour and opacity. BodyParts3D supplies ~3000 meshes named
`FMA<id>.stl`. Two problems: the 3D view is a modal dialog behind a button
(`main.ts:2562`), OUTSIDE the storyboard — no `speak`, `ask`, `quiz` or video
export inside it — and BodyParts3D is CC BY-**SA** 2.1 Japan while drawcast has
no LICENSE file and no `license` in package.json. Bundling share-alike meshes
into a closed app is what share-alike exists to prevent.

## The shape of the thing

Three separable units. Each can be understood, tested and changed alone.

1. **The atlas** — data. Named parts, closed rings, a part-of tree, names in
   nb/en/la, a detail rank. Built offline by a script, loaded lazily at runtime.
2. **The `anatomy` template** — a view onto the atlas. Structurally a twin of
   `world_map`.
3. **Polygon hit-testing** — the one code fix the asks need.

Pathology rides on (2). Sound is deliberately out of v1 (see M3).

---

## M1 — the atlas and the template

### The atlas format

One JSON module per atlas, in `src/scenes/anatomy/`:

```jsonc
{
  "view": "anterior",
  "space": [1000, 2000],              // atlas coordinate box; the template scales it
  "source": "Wikimedia Commons, Mikael Häggström, public domain",
  "parts": {
    "femur_left": {
      "name": { "en": "Femur", "nb": "Lårbein", "la": "Os femoris" },
      "system": "skeleton",
      "parent": "lower_limb_left",
      "detail": 2,                    // lowest detail level at which it is drawn
      "sex": "any",                   // "any" | "female" | "male"
      "rings": [[[x, y], …], …],      // closed polylines, ALREADY decimated
      "uberon": "UBERON:0000981"      // optional cross-reference
    }
  }
}
```

Three files, so the whole body never pays for a foot:

| file | contents | budget |
|---|---|---|
| `atlas-body.json` | the body outline and torso landmarks, plus detail-1 versions of every part in both systems | ≤ 3 000 points |
| `atlas-skeleton.json` | detail 2–3 bones | ≤ 6 000 points |
| `atlas-viscera.json` | detail 2–3 organs | ≤ 6 000 points |

`atlas-body.json` always loads: it carries `body_outline`, which every figure
draws. The other two load only when their system is asked for at detail ≥ 2.

**The budgets are a tested constraint, not a hope.** A test asserts each file's
total point count. The 131 633-point measurement is exactly the failure mode
this guards against.

**And the template caps what it draws, not just what it loads.** Both systems at
detail 3 would be 12 000 points on one figure. The template holds a total budget
(4 000 points for the drawn scene) and, when a request exceeds it, DROPS DETAIL
— rendering the next level down for the parts outside `focus` — rather than
emitting a figure that takes ten seconds to sketch. The degradation is reported
in the same "Unknown: …" note, so it is visible rather than mysterious.

### Building it

`scripts/build-anatomy-atlas.mjs` — deterministic, run by hand, output checked
in:

1. Read the vendored PD source SVG (`assets/anatomy-sources/`, with a
   `PROVENANCE.md` naming author, licence and retrieval date — public domain
   owes no attribution, but the provenance is worth keeping).
2. Slice out each named `<g>`, flatten its `d=` attributes through the same
   `sampleSvgPath` the runtime uses.
3. Douglas–Peucker per ring at a tolerance tied to the target detail level;
   drop rings that fall below a minimum enclosed area.
4. Emit the JSON with names and the tree.

Organs are hand-authored into the same format — schematic but anatomically
placed, in the idiom `heart_circulation` and `nephron` already use. ~18 for v1.

### The engine

`anatomy` joins `KNOWN_ENGINES` in `src/scenes/engines.ts`, lazily importing
whichever atlas files the params ask for. Same pattern as `geo`.

### The template

`src/scenes/packs/anatomy.yaml`, one template `anatomy`, `engines: [anatomy]`.
A new pack rather than a slot in `medicine.yaml`: packs are the unit of
enable/disable, and this one carries a heavy engine.

| param | meaning |
|---|---|
| `view` | `anterior` (v1's only value; present so v2 does not change the shape) |
| `sex` | `neutral` \| `female` \| `male` — default `neutral` |
| `systems` | `["organs"]` (default), `["skeleton"]`, or both |
| `detail` | 1–3, default 2. NUMERIC, so `animate` can tween it |
| `focus` | part names to crop to, with their children, at detail 3 regardless of `detail` |
| `highlight` | part names to tint |
| `labels` | `none` \| `focus` (default) \| `all` |
| `markers` | `[{part, label}]` — labelled dots |
| `findings` | `[{part, condition, severity}]` — see below |
| `color` | `system` (default) \| `mono` |

**Element ids ARE part ids.** `femur_left`, `liver`, `heart`. That is what makes
`ask.widget: "click"` work with no new machinery: `answer: "liver"`.
Plus `label_<part>`, `finding_<part>`, `body_outline`, `missing_note`.

An unrecognised part name is skipped and listed in a small "Unknown: …" note,
never a failed figure — `world_map`'s rule.

### Zoom

There is no continuous zoom into ever-finer real geometry, and pretending
otherwise would be a mapping project. `focus` on a subtree pins those parts
(and their children) to detail 3 while everything else stays at `detail`, swaps
in the regional atlas, and crops the frame to the focused parts' bounds plus a
margin; the player's `camera` moves in on top of that. It reads as zoom. This is
the maps answer, applied here.

### Names and language

Part ids are machine ids. The displayed label comes from `name.<lang>` in the
atlas, picked by the spec's language. Anatomical names must NOT go through the
prose translation track — "Manubrium" machine-translated is nonsense — so every
id-shaped param carries `x-translate: false`, and the drift guard in
`tests/spec-i18n.test.ts` will demand that classification explicitly.

### Tests

- Atlas invariants: every part has name/system/parent/rings; every `parent` id
  exists; no NaN; point budgets held.
- `detail: 3` draws a superset of `detail: 1` (monotone, so raising detail never
  makes a part vanish).
- `focus` crops; `highlight` tints only the named parts; unknown names land in
  the note and nowhere else.
- Every manifest example is **lint-clean** — zero warn-level issues, the
  standard set in the QALY round (the whole bundled library carries three).

---

## M2 — asks on the body

### Polygon hit-testing (the one real code change)

`hitElement` (`src/ui/hit.ts:11`) picks the smallest bounding box containing the
point. For anatomy that is wrong: organs overlap in box while not overlapping in
shape, so a click low on the left lung can land inside the heart's box and be
judged wrong.

Fix: `hitElement` takes an optional second map of id → closed rings and does
point-in-polygon first, falling back to the box when a shape has no rings. The
file is 35 lines, DOM-free, node-tested; `src/render/plan.ts` builds the ring
map from drawables that expose closed rings. Additive, and every existing
figure keeps today's behaviour.

Test: two overlapping organ shapes; a point inside A's box but inside B's
polygon resolves to B.

### The asks themselves — no new verbs

- **Locate:** `ask` with `widget: "click"`, `answer: "<part id>"`.
- **Name it:** a plain typed `ask`, the name as the answer.
- **Multiple choice:** `quiz`.
- **Name all the joints:** N asks in the storyboard. This works today. A
  `drill`/`ask.set` sugar is YAGNI until the repetition actually hurts.

Known limit, deliberately left: `ask.widget: "click"` takes ONE element id, so
"click all four valves" is not expressible. Note it, do not build it.

### Pathology, visually

`findings: [{part, condition, severity?}]`, rendered by a small registry keyed
on condition, with a generic fallback so an unknown condition degrades instead
of failing:

| condition | rendering |
|---|---|
| `enlarged` | scale the part's rings about their centroid |
| `fracture` | a jagged line across the part |
| `lesion` / `mass` | a small filled blob inside it |
| `effusion` | fill the space between two parts |
| `absent` | dashed outline only |
| *anything else* | hatched patch + label |

`severity` (`mild`/`moderate`/`severe`) scales the effect. Findings are DRAWN,
never diagnosed — a `quiz` or `ask` asks the viewer what they are looking at.
That is Hans's "put in a fault the user must identify", with existing verbs.

---

## M3 — sound, deliberately deferred

`tones.ts` has no noise source; its `Recipe` is oscillator layers plus an
envelope. Heart sounds need both: S1/S2 are low decaying thumps (a damped
40–120 Hz sine is convincing), murmurs are band-passed noise, crackles are noise
bursts, wheeze is a whistling tone. The change is a `noise` layer type
(BufferSource + BiquadFilter) plus a `listen` widget — a click that PLAYS rather
than judges. Roughly 100–150 lines with tests.

Deferred because it is a genuinely new interaction, not because it is hard.

**Honest limit to state up front:** synthesised heart sounds will be
recognisable, not clinical. Real auscultation training needs recordings, and
that is an audio-asset project with its own licence question — not this one.

## M4 — the 3D panel (later, and optional)

`manifest.model3d: {kind, source}` already exists as a declarative seam
(`src/ui/model3d.ts:26`). An anatomy figure would declare `kind: "anatomy"` and
gain the same button molecules have. Inside: one `addCustom` shape per organ,
clickable, semi-transparent so layers peel.

Two unresolved questions, both for Hans, both cheap to defer:

1. **Licence.** BodyParts3D is CC BY-SA 2.1 Japan against an unlicensed app.
   Fetching at runtime from DBCLS's own host avoids redistribution but makes the
   figure depend on an external service; CORS there is unverified.
2. **Scope.** The panel has no `speak`, `ask`, `quiz` or video export. It is
   free exploration beside the figure, not a second teaching surface — unless we
   decide to build one, which is its own round.

## Out of scope for v1, on purpose

- **Age.** The head-to-body ratio is one parameter, but internal organs do not
  scale linearly. Hans agreed it is not v1.
- **Posterior and lateral views.** `view` exists in the params so adding them
  later does not change the shape.
- **Muscles, nervous and vascular systems.** The atlas format takes them
  whenever someone draws them; `systems` is already a list.

## Risks worth naming

- **The organ drawings are the schedule.** Bones come nearly free from the PD
  source; the ~18 organs are hand work, and if they are bad the template is bad.
- **Decimation may make bones mushy.** The budgets are tight. Needs Hans's eye
  on a rendered figure before the atlas is considered done.
- **`detail` as an animatable number** is attractive, but tweening it
  adds and removes whole parts — that may read as popping rather than growth.
  Try it; drop the animation if it looks wrong.

## Open, and Hans's call

- Which two regions get high-detail atlases first? The spec assumes **skeleton**
  and **viscera**; joints or brain are equally defensible.
- Whether the 18 v1 organs are the right 18 — that list should be written before
  anyone starts drawing.
