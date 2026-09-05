# Anatomy — the body as an atlas, not as a drawing

Written 2026-09-05, after the PPF/QALY round (e87b772). Approach approved by
Hans: **2D atlas first, 3D as an optional panel later.**

**Revised 2026-09-06**, after a review that opened the source files and ran the
extraction end to end. What changed, and why, is listed under "Revision notes"
at the end. The short version: the skeleton source is a different public-domain
file than the one first named, bones must be extracted as the UNION of their
painted shapes, the whole skeleton then measures ~2 300 points rather than
131 000, `detail` is an integer that is not animated, labels take a `names`
language parameter, and joints join the atlas.

Licensing context, set by Hans 2026-09-05: **the app itself becomes open source
under MIT.** Money comes from saving and server use, not from the code, and the
prompt / instruction text files may be held back as private. That decision is
what makes M4 possible at all — see the licence note there.

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

## What the research settled (corrected 2026-09-06)

**A usable standard file exists — for the skeleton — but it is not the one
first named.** Two public-domain SVGs on Wikimedia Commons share one lineage
and one naming scheme (`FemurLeft`, `ClavicleRight`, `HandLeft` ⊃
`CarpalsLeft` + `MetacarpalsLeft` + `PhalangesLeft`):

- **`Human skeleton front en.svg`** by LadyofHats (Mariana Ruiz Villarreal),
  public domain. The classic labelled Wikipedia skeleton: every bone on ONE
  page in ONE frame, 45 named groups including both hands and both forearms,
  no embedded raster, 28 text labels with leader lines that must be ignored.
  **This is the source.**
- `Human skeleton (svg template).svg` by Häggström is DERIVED from it and is an
  Inkscape working file: the torso and one arm sit on the page, both legs and
  the other arm are parked off-page at negative x, every group carries its own
  matrix, and a 975×991 reference photo is embedded. Commons renders it as a
  torso with no legs. Not usable without re-assembly.

**Bones are painted, not outlined.** Each bone is several overlapping paths — a
base fill plus darker shading and lighter highlights — and no single path is
the bone's silhouette. Measured: taking every path as a ring gives blotchy
fragments; taking only the base colour gives hollow slivers. The silhouette is
the **polygon union** of a bone's painted shapes, which also produces the real
holes: the orbits of the skull, the obturator foramina of the pelvis. Union is
a build-time step with a build-time dependency (`polygon-clipping`, MIT).

**Every group carries a transform.** The named groups sit in the page through
`matrix(...)` and `translate(...)` attributes that must be composed down the
tree before any coordinate is used. Ignoring them scrambles the body.

**The point budget is small once extraction is right.** Measured on the
LadyofHats file: union per bone, Douglas–Peucker at tolerance 1.2 atlas units,
holes kept — **2 342 points, 62 rings, 29 holes for the whole skeleton at full
detail**, including both hands and both feet. At tolerance 4 the same skeleton
is 1 002 points. The 131 633 figure in the first draft counted every shading
path at eight curve segments; it measured the paint, not the bones. Rendered
and inspected: the skeleton, the torso and a hand all read correctly.

**Region silhouettes come for free.** The convex hull of a region's bones —
the hand, the rib cage, the spine — is a clean coarse stand-in: 16 regions,
146 points. That is the whole-body "stick skeleton" at detail 1.

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
export inside it — and BodyParts3D is CC BY-**SA** 2.1 Japan, which constrains
how the meshes may be shipped (resolved below, now that drawcast is going MIT).

## The shape of the thing

Three separable units. Each can be understood, tested and changed alone.

1. **The atlas** — data. Named parts, closed rings with holes, a part-of tree,
   names in nb/en/la, a detail rank, a depth rank, a colour. Built offline by
   a script, loaded at runtime through an engine.
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
  "space": [1000, 2000],              // atlas coordinate box, y DOWN; the template flips
  "source": "Wikimedia Commons, LadyofHats, public domain; organs authored for drawcast",
  "parts": {
    "femur_left": {
      "name": { "en": "Left femur", "nb": "Venstre lårbein", "la": "Os femoris sinistrum" },
      "system": "skeleton",
      "kind": "bone",                 // "bone" | "joint" | "organ" | "region" | "outline"
      "parent": "thigh_left",
      "detail": 2,                    // the level at which this part is drawn (see below)
      "depth": 1,                     // draw order, 0 = furthest back
      "sex": "any",                   // "any" | "female" | "male"
      "color": "#e6dcc4",             // optional; the template has a per-system default
      "rings": [                      // ALREADY decimated
        { "outer": [[x, y], …], "holes": [[[x, y], …]] }
      ],
      "uberon": "UBERON:0000981"      // optional cross-reference
    }
  }
}
```

A ring is an outer polygon plus optional holes, because the union of a skull's
paint has orbits and the pelvis has foramina; drawcast's `kit.area` already
paints holes with `fill-rule: evenodd`. Grouping parts that exist only so
`focus` can name a region — `arm_left`, `leg_right` — carry `rings: []`.

**Detail is a level, not a superset.** Every part has ONE `detail`, the level
at which it is drawn:

| level | skeleton | viscera |
|---|---|---|
| 1 | 16 region silhouettes — convex hulls: skull, spine, shoulder girdle, rib cage, pelvis, upper arms, forearms, hands, thighs, lower legs, feet | the big organs: brain, lungs, heart, liver, stomach, intestines |
| 2 | the named bones and the joints | the smaller organs: kidneys, spleen, pancreas, bladder, diaphragm, trachea, uterus/prostate |
| 3 | the small bones: carpals, metacarpals, phalanges, tarsals, metatarsals | the fine structures: thyroid, gallbladder |

The template draws the **leaves at the requested level**: a part is drawn when
its own `detail` ≤ the request and none of its children with geometry is. So at
detail 1 the hand is one mitten-shaped silhouette named `hand_left`; at detail 3
it is `carpals_left`, `metacarpals_left`, `phalanges_hand_left` and the mitten
is not drawn. Element ids therefore depend on the detail level, and a storyboard
names the ids of the level it shows. The earlier draft demanded that raising
detail never removes an id, in the service of animating `detail`; that
animation is gone (see "Zoom"), and the demand with it.

Three files, so each can hold its own budget and be authored on its own:

| file | contents | budget (asserted by a test) |
|---|---|---|
| `atlas-body.json` | `body_outline`, the 16 skeleton region hulls, the geometry-less grouping parts | ≤ 1 500 points |
| `atlas-skeleton.json` | detail 2–3 bones and the joints | ≤ 4 000 points |
| `atlas-viscera.json` | every organ, detail 1–3 | ≤ 4 000 points |

Measured headroom: the skeleton at tolerance 1.2 is 2 342 points; the hulls are
146. The engine loads **all three files together** the first time the
`anatomy` template is used — engines load per template, before the layout runs,
so they cannot know which systems a request will ask for. Roughly 8 000 points
of JSON is a fraction of `world_map`'s dataset, and lazy per template is enough.

**And the template caps what it draws, not just what it loads.** The drawn
scene holds a total budget of **4 000 points**, and when a request exceeds it
the template DROPS DETAIL — rendering the next level down for the parts outside
`focus` — rather than emitting a figure that takes ten seconds to sketch. The
degradation is reported in the same "Unknown: …" note, so it is visible rather
than mysterious. With the measured numbers this is a safety net, not a
mechanism that fires in ordinary use.

### Building it

`scripts/build-anatomy-atlas.mjs` — deterministic, run by hand, output checked
in — with its pure geometry and SVG-walking helpers in `scripts/anatomy/` where
node tests can reach them:

1. Read the vendored PD source SVG (`assets/anatomy-sources/`, with a
   `PROVENANCE.md` naming author, licence, URL and retrieval date — public
   domain owes no attribution, but the provenance is worth keeping). Because
   the source is public domain, the v1 atlas carries no licence complication at
   all: it ships MIT with the rest of the code.
2. Walk the group tree, **composing every `transform`** down to each path.
   Keep only paths inside the skeleton layer whose fill is a colour — `none`
   and the near-black `#231f20` are outlines and label art, not bone.
3. For each atlas part, collect its source groups (the source's own names for
   36 of them; six unnamed groups and one loose path are identified by
   position and mapped by id — the rib cage, the right femur, the sternum
   body among them), flatten every path through the same `sampleSvgPath` the
   runtime uses, and take the **polygon union** of the result. The union's
   outer rings and holes are the part.
4. Douglas–Peucker per ring at a tolerance tied to the file (1.2 for the
   skeleton file, 4 for the body file); drop rings below a minimum area.
5. Region silhouettes: the convex hull of a region's bones, decimated.
6. **Joints**: for each pair (shoulder, elbow, wrist, hip, knee, ankle on both
   sides, and the jaw) find the closest pair of vertices between the two
   bones; the joint is a small circle at their midpoint, radius scaled to the
   bones. Thirteen clickable parts for "name all the joints".
7. Organs are authored in `assets/anatomy-sources/viscera.mjs` as shapes in
   atlas coordinates — a `blob` (an organic ellipse), a `poly` (a hand-drawn
   ring, for the liver's wedge, the stomach's J, the lungs with the cardiac
   notch, the heart), or a `tube` (a centre line swept to a width, for the
   colon that frames the small intestine, and for the trachea). Each carries
   `depth` so kidneys and pancreas sit behind the gut and the heart in front
   of the lungs. ~19 for v1, placed against the skeleton's own landmarks.
8. Emit the JSON, **and a preview**: `assets/anatomy-sources/preview.svg`, the
   whole atlas drawn plainly — skeleton, organs, outline, joints — so a person
   or a session can look at it without the app. Chrome headless turns it into a
   PNG in one command. No test can say whether a femur still looks like a
   femur; the preview is how that is checked, after every rebuild.

### The engine

`anatomy` joins `KNOWN_ENGINES` in `src/scenes/engines.ts`, importing the three
atlas files. `engines.anatomy.parts({systems, sex})` returns the merged parts
of the body atlas plus the requested systems, with the sex filter applied;
`engines.anatomy.space()` returns the atlas box. Detail is the template's
business, not the engine's.

### The template

`src/scenes/packs/anatomy.yaml`, one template `anatomy`, `engines: [anatomy]`.
A new pack rather than a slot in `medicine.yaml`: packs are the unit of
enable/disable, and this one carries a heavy engine.

| param | meaning |
|---|---|
| `view` | `anterior` (v1's only value; present so v2 does not change the shape) |
| `sex` | `neutral` \| `female` \| `male` — default `neutral` |
| `systems` | `["viscera"]` (default), `["skeleton"]`, or both |
| `detail` | 1, 2 or 3 — an INTEGER, default 2 |
| `focus` | part names to crop to, with their children, at detail 3 regardless of `detail` |
| `highlight` | part names to tint |
| `labels` | `none` \| `focus` (default) \| `all` — `all` names every drawn part except the joints |
| `names` | `en` (default) \| `nb` \| `la` — the language the labels are written in |
| `markers` | `[{part, label}]` — labelled dots |
| `findings` | `[{part, condition, severity, label}]` — see below |
| `color` | `system` (default) \| `mono` |

**Element ids ARE part ids.** `femur_left`, `liver`, `heart`, `knee_left`. That
is what makes `ask.widget: "click"` work with no new machinery: `answer:
"liver"`. Plus `label_<part>`, `finding_<part>`, `body_outline`, `frame`,
`missing_note`.

**Every part is ink plus wash.** A part is drawn as a group of two drawables
per ring: an area fill in the part's colour at low opacity, and a closed stroke
in ink on the same ring. `kit.area` alone has no outline — a shaded region in
drawcast is a wash with no edge — and organs without edges are blobs of colour.
The pair is the idiom `heart_circulation` already uses. Both drawables share
the ring, so polygon hit-testing sees the shape either way.

**Draw order is `depth`**, back to front, so a kidney's fill sits behind the
gut's fill. Outlines all render above all fills (drawcast buckets by kind), so
a bone or organ behind another still shows as an edge. That is how anatomical
schematics read.

An unrecognised part name is skipped and listed in a small "Unknown: …" note,
never a failed figure — `world_map`'s rule.

### Zoom

There is no continuous zoom into ever-finer real geometry, and pretending
otherwise would be a mapping project. `focus` on a subtree pins those parts
(and their children) to detail 3 while everything else stays at `detail`,
crops the frame to the focused parts' bounds plus a margin, and **omits the
body outline** — cropped, the outline would extend far past the canvas, which
is an `out-of-canvas` lint ERROR, not a warning. A light frame marks the crop
instead, as `world_map` does in focus mode. The player's `camera` moves in on
top of that. It reads as zoom. This is the maps answer, applied here.

**`detail` is not animated.** The first draft made it a number "so `animate`
can tween it". Measured against the player: the per-frame geometry swap
(`swapGeometry`) never reveals element ids that were not already visible, and
parts that appear at a higher level arrive only with the implicit final draw.
An animated `detail` shows nothing while it runs and pops everything in at the
end. "Let the small organs appear as you explain" is what staged `draw`
commands already do, at the level the storyboard chose.

### Names and language

Part ids are machine ids. The displayed label comes from `name.<names>` in the
atlas, where `names` is the template's own language parameter — a pack layout
sees `params`, `kit` and `engines` and nothing else, so the spec's prose
language is not available to it. The compiler sets `names` from the request's
language; `la` exists because Latin is what medical students are drilled on.
Anatomical names must NOT go through the prose translation track — "Manubrium"
machine-translated is nonsense — so every id-shaped param carries `x-translate:
false`. Name resolution in `focus`, `highlight`, `markers` and `findings`
accepts the id or any language's name, case-insensitively, so "Lever" and
"Hepar" both find `liver`.

### Tests

- Build-time geometry (simplify, hull, tube, area) and the SVG walk (composed
  transforms, fill filter) are node-tested on small inputs.
- Atlas invariants: every part has name/system/kind/parent/rings/depth; every
  `parent` id exists; the tree has no cycles; no NaN; every hole lies inside
  its outer ring's box; point budgets held.
- Leaf-at-level is well founded: every part drawn at level d is, at level d+1,
  either still drawn or replaced by children that are.
- `focus` crops and omits the outline; `highlight` tints only the named parts;
  unknown names land in the note and nowhere else; no figure produces
  `out-of-canvas`.
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
file is 35 lines, DOM-free, node-tested; `src/layout/layout.ts` builds the ring
map from drawables that expose closed rings. Additive, and every existing
figure keeps today's behaviour.

Test: two overlapping organ shapes; a point inside A's box but inside B's
polygon resolves to B.

### The asks themselves — no new verbs

- **Locate:** `ask` with `widget: "click"`, `answer: "<part id>"`.
- **Name it:** a plain typed `ask`, the name as the answer.
- **Multiple choice:** `quiz`.
- **Name all the joints:** the joints are parts — `knee_left`, `elbow_right`,
  `jaw` — so this is N click-asks or typed asks in the storyboard. A
  `drill`/`ask.set` sugar is YAGNI until the repetition actually hurts.

Known limit, deliberately left: `ask.widget: "click"` takes ONE element id, so
"click all four valves" or "click either kidney" is not expressible. Note it,
do not build it.

### Pathology, visually

`findings: [{part, condition, severity?, label?}]`, rendered by a small registry
keyed on condition, with a generic fallback so an unknown condition degrades
instead of failing:

| condition | rendering |
|---|---|
| `enlarged` | scale the part's rings about their centroid |
| `fracture` | a jagged line across the part |
| `lesion` / `mass` | a small filled blob inside it |
| `effusion` | fill the space below the part |
| `absent` | dashed outline only |
| *anything else* | hatched patch + label |

`severity` (`mild`/`moderate`/`severe`) scales the effect. Findings are DRAWN,
never diagnosed unless given a `label` — a `quiz` or `ask` asks the viewer what
they are looking at. That is Hans's "put in a fault the user must identify",
with existing verbs.

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

### Licence — no longer a blocker

With the app going MIT, share-alike meshes stop being a contradiction. CC
BY-SA's obligation attaches to the ADAPTED MATERIAL, not to a collection that
merely contains it — the 2.1 JP deed words it as "you must distribute your
contributions under the same license as the original". So:

- The code stays **MIT**.
- Anything derived from BodyParts3D — the meshes themselves, and any 2D outline
  projected from them — lives in its own directory under **CC BY-SA**, with a
  `LICENSE` in that directory and the attribution line DBCLS asks for
  ("BodyParts3D, © The Database Center for Life Science licensed under CC
  Attribution-Share Alike 2.1 Japan") shown in the 3D panel, not buried in a
  file.
- The repo therefore has mixed licensing, stated per directory. That is normal
  and honest; it is not a reason to avoid the data.

Two things to check before writing the code, neither of them hard:

1. Read the 2.1 JP **legal code**, not just the deed, on whether adaptations may
   be released under a later CC BY-SA version (4.0). The deed points at
   `creativecommons.org/compatiblelicenses`; the legal code is the authority.
2. If we fetch at runtime from DBCLS's own host instead of vendoring, CORS there
   is unverified. Vendoring is now the simpler path, so this only matters if the
   payload turns out to be too big to ship.

### Scope — still the real limit

The panel has no `speak`, `ask`, `quiz` or video export. It is free exploration
beside the figure, not a second teaching surface — unless we decide to build
one, which is its own round.

## Out of scope for v1, on purpose

- **Age.** The head-to-body ratio is one parameter, but internal organs do not
  scale linearly. Hans agreed it is not v1.
- **Posterior and lateral views.** `view` exists in the params so adding them
  later does not change the shape. LadyofHats' `Human skeleton back en.svg`
  exists and is PD, but its groups are unnamed — a naming job before it is an
  atlas.
- **Muscles, nervous and vascular systems.** The atlas format takes them
  whenever someone draws them; `systems` is already a list.
- **Individual vertebrae.** The source groups them as cervical, thoracic and
  lumbar; the vertebrae themselves are unnamed subgroups.
- **Animating `detail`.** See "Zoom". Staged `draw` is the mechanism.

## Risks worth naming

- **The organ drawings are the schedule.** Bones come nearly free from the PD
  source; the ~19 organs are hand work, and if they are bad the template is
  bad. The preview SVG exists so the drawing loop is fast; the shapes are
  placed against the skeleton's own landmarks, and every coordinate in the
  plan is a first guess that the preview corrects.
- **Detail 1 is a mannequin.** Convex hulls make a rib cage a shield and a
  skull a box. It reads as a coarse body and it is what detail 1 is for; if it
  offends, the fix is a concave silhouette (the union of the region's bones,
  dilated), which is more build-time work, not a design change.
- **Joints are derived, not drawn.** "Closest pair of vertices between two
  bones" lands on the joint line for hinge joints and near it for the
  shoulder and hip. Good enough to click; not an anatomical drawing of a joint.
- **Ids change with detail.** `hand_left` at detail 1, its three bone groups at
  detail 3. A storyboard written at one level and replayed at another names
  ids that are not there. The compiler sees the level it chose; the note
  catches the rest.

## Open, and Hans's call

- Which two regions get high-detail atlases first? Decided 2026-09-05:
  **skeleton and viscera**.
- Whether the 19 v1 organs are the right 19 — the list is in the plan's
  `viscera.mjs`; it should be read before anyone starts drawing.

## Revision notes, 2026-09-06

What the review found, and what it changed:

1. **Source.** The Häggström template renders as a torso with no legs; half its
   groups are parked off-page and every group carries a matrix. Replaced by the
   LadyofHats front skeleton it derives from — same licence, same names, whole
   body in one frame, both hands and forearms named.
2. **Extraction.** Bones are unions of painted shapes, not single paths; the
   build script gained transform composition, a fill filter and
   `polygon-clipping` as a build-time dependency. Measured result 2 342 points
   for the full skeleton, against 131 633 first quoted.
3. **Detail semantics.** Leaf-at-level replaces "detail 3 is a superset of
   detail 1", because `animate` on `detail` cannot work in the player
   (`swapGeometry` reveals no new ids). `detail` is an integer.
4. **Rendering.** Parts are ink plus wash, in a group, because `kit.area` has
   no outline. Parts carry `depth` and `color` in the atlas.
5. **Language.** `names` param replaces an assumed `lang` variable that a pack
   layout does not have.
6. **Focus.** The body outline is omitted under `focus` and a frame drawn,
   because a cropped outline is an `out-of-canvas` error.
7. **Joints.** Thirteen derived joints join the skeleton atlas, for Hans's
   "name all the joints".
8. **Ring format.** `{outer, holes}` so the skull keeps its orbits.
