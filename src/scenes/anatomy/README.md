# The anatomy atlas

Three generated JSON files in `atlas/`, under their own licence (CC BY-SA 2.1
Japan — see `atlas/LICENSE` and `atlas/ATTRIBUTION.md`). **Do not hand-edit
them** — they are the output of `scripts/build-anatomy-atlas.mjs`, and the
next build will overwrite whatever you typed.

Every part is the frontal projection of one or more **BodyParts3D** meshes:
the mesh triangles are projected (x → right, z → up), scan-filled into a
coverage mask over the atlas space, and the mask is contoured with
`d3-contour`, so the union of a composite's element meshes and the real
holes (orbits, foramina) come out by construction. Draw depth is the mean
anterior offset of the mesh, so posterior organs are drawn first. The skin
mesh gives the body silhouette. The one part with no mesh is the uterus
(`source: "authored"`); this dataset is one adult male.

To change the body:

- **Which meshes make a part, its names, parent, detail, colour, layer** →
  `assets/anatomy-sources/bodyparts.mjs`. A part lists leaf ids (`fma`) or a
  composite (`composite`, narrowed by `side`, `filter`, `exclude`).
- **A joint** → `assets/anatomy-sources/joints.mjs`
- **How fine the outlines are** → `CELL` (mask cell, atlas units) and `TOL`
  (Douglas–Peucker) in the build script
- **Where the body sits in the atlas box** → `TOP` / `BOTTOM` in the build script

Then:

    node scripts/build-anatomy-atlas.mjs
    qlmanage -t -s 1000 -o assets/anatomy-sources assets/anatomy-sources/preview.svg
    npx vitest run tests/anatomy-atlas.test.ts

and LOOK at `preview.svg.png` before committing (delete the PNG afterwards; the
SVG is what is kept). No test can say whether a femur still looks like a femur.

The first build downloads ~150 MB of STL files from the BodyParts3D GitHub
mirror into `.cache/bodyparts3d/` (gitignored); later runs are offline. A
file the mirror lacks is remembered as `<id>.missing` and skipped; a part
with no geometry at all fails the build and names itself.

Not in BodyParts3D 3.0, and so not in the atlas: the coccyx, the thyroid
gland, a female body. Left out on purpose: the diaphragm, whose frontal
projection is a sheet that covers the whole upper abdomen (a dome LINE is
the right drawing — roadmap). The round-1 hand-drawn skeleton is kept as a
reserve: `assets/anatomy-sources/human-skeleton-front.svg` and
`skeleton-map.reserve.mjs`, not used by the build.

## Exploring in the app

The ⊕ explore tray of any anatomy figure has a **Body** section: click a
part on the figure to zoom into its region (the liver zooms to the abdomen,
a metacarpal to the hand), click a part inside the zoomed view to pick it
out and see its name, and use the breadcrumbs (`Body › Left arm › Left hand`)
to come back. Pills switch the layer (in front / behind), the systems shown
and the label language; the detail slider sits beside them. Every action is
a preview through the tray's own overrides, so **Continue restores the
lesson** exactly as after a slider drag. `explore: { anatomy: true }` is the
authored beat that opens the section and waits. The rules — which region a
click zooms to, the breadcrumb path — live in `src/ui/body-model.ts` and are
tested against the real atlas; the DOM is `src/ui/body-explore.ts`.

## Pointing at a part

Two kinds of emphasis, one word. The template's `highlight` **param** tints
parts for the whole figure (and, with `labels: focus`, names them). The
`highlight` **command** is the gesture: `{"highlight": {"target": ["liver"]},
"speak": "…"}` pulses (or `glow`s, or `circle`s) the part for exactly as long
as the sentence, then lets go — the way to talk about one organ. A click
question (`ask` with `widget: "click"`) needs neither: when the answer is
spoken, the correct part glows by itself — green when the viewer found it,
red when it is revealed after a miss or a skip. That lives in the player
(`glowWhile` in `src/render/player.ts`) and works on every template whose
answer is a drawn element.

## The 3D panel

`public/anatomy3d/` is the same body as meshes: one decimated `.bin` per bone
and organ plus the skin, built by `scripts/build-anatomy-meshes.mjs` from the
same STL cache (`node scripts/build-anatomy-meshes.mjs`; run it whenever the
part table changes, and commit the pack — it is under the atlas's CC BY-SA
licence, with its own `LICENSE` and `ATTRIBUTION.md`). Pack units are
centimetres, re-centred on the skin, +Y up, +Z toward the camera. Decimation
is grid clustering at the base cell (2 mm bones, 3 mm organs, 6 mm skin) to
share vertices, then quadric edge collapse to the budget: skin 20 000
triangles, other parts 400–4 000 by size; the whole pack must stay under
200 000 (pinned by `tests/anatomy3d-pack.test.ts`; measured 143 584, 1.6 MB).
Regions list their bones' files, so nothing is stored twice. The panel shows
what the figure shows — `visibleParts` in `src/ui/anatomy3d.ts` is the
template's leaf rule again, cross-checked against the real layout — coloured
as in 2D, each part clickable for its name in the figure's language.
**Peel works from the front**: parts are ranked by the front-most point of
their pack bbox (not the atlas's mean depth — the lungs' centre lies behind
the heart's, but their front edges hide it), and the slider fades the front
ranks first over a soft edge, so at peel 1 only the furthest-back part is
left. Front/Side/Back are camera presets. 3dmol computes the normals itself
(`normalArr: []`).

Adding a system (muscles, vessels, nerves): a fourth atlas file, a new value
in `AtlasSystem`, a new entry in the template's `systems` enum, and its parts
in `bodyparts.mjs`. The engine merges by system already.
