# Anatomy round 2 — one body

Written 2026-09-06, after Hans reviewed the first anatomy round in the app
(merge 764b1e4). His notes, in his words: the strokes and shapes were a little
angular and could be rounder; the body outline looked odd and large; the detail
slider in the interactive tray changed nothing on screen; there was no way to
zoom in and see more detail; organs overlap, which is right in 2D but must look
fine; the drawer's own interactions could include 3D, as they do for molecules.

Decisions Hans took on 2026-09-06, after the review that follows:

- All six proposals go ahead, in the order recommended below.
- **The whole 2D body — skeleton, organs, skin — is derived from BodyParts3D**,
  one dataset of one body, so every part is registered against every other and
  2D matches 3D exactly. The hand-drawn organs and the LadyofHats skeleton are
  retired; the drawn skeleton stays in the repo as a documented reserve.
- **A skin wash is the default ground, not a drawn outline.** `outline` chooses
  `skin` (default), `line` (the improved, mesh-derived silhouette as a stroke),
  or `none`.
- More bundled examples.
- One spec (this), three plans, one worktree per part, merge and push to
  `main` after each part.

## Sources evaluated

| source | what it is | usable? |
|---|---|---|
| **BodyParts3D 3.0** via `github.com/Kevin-Mattheus-Moerman/BodyParts3D` | binary STL per FMA id, one adult male, coordinates in mm; `parts_list_e.txt` (1 523 ids → English names), `composite_parts.txt` (composite → element parts), `conventional_part_of.txt` (part-of tree); CC BY-SA 2.1 Japan, attribution "BodyParts3D, © The Database Center for Life Science licensed under CC Attribution-Share Alike 2.1 Japan" | **yes — the source.** Verified 2026-09-06: every organ and bone this round needs exists as a leaf file or as a composite of leaf files. Only leaf element files are in the mirror; composites (heart, brain, skull, rib cage, vertebral column, sternum, lungs, intestines) are assembled from their elements. Raw files download over `raw.githubusercontent.com`. |
| Z-Anatomy (`github.com/Z-Anatomy/Models-of-human-anatomy`) | a Blender application template (87 MB zip) derived from BodyParts3D, CC BY-SA 4.0 | reserve only — meshes are inside a `.blend`; extracting them needs Blender in the build |
| AnatomyTOOL (`anatomytool.org`, `github.com/opgobee/anatomyTOOL`) | a Dutch/Flemish learning-materials portal; the GitHub repo is the platform code, not data; contributions carry per-item CC licences chosen by their authors | not a bulk data source; individual items would need per-item licence checks |
| LadyofHats `Human skeleton front en.svg` (round 1) | a public-domain illustration | retired from the atlas, kept in `assets/anatomy-sources/` as reserve |

Measured facts the design rests on (2026-09-06):

- Axes: the right femur spans x −145..−33, the liver x −118..81, the stomach
  x −28..114 → **patient's left is +x**. The stomach (anterior) spans y
  −196..−80 and the right kidney (posterior) y −98..−45 → **anterior is −y**.
  The femur spans z 403..843, the liver z 1030..1204 → **up is +z**. So the
  frontal (anterior) view is `X = x`, `Y_down = z_top − z`, and draw order is
  by `−y` (posterior parts first).
- Sizes: right femur 12 990 triangles / 650 KB; liver 19 416 / 971 KB; right
  hip bone 9 716 / 486 KB; diaphragm 10.5 MB; **skin (FMA7163) 79 MB**, a
  non-manifold mix of inner and outer surfaces per the mirror's README —
  harmless for a rasterised projection, which only asks "is this pixel
  covered".
- Composites: heart = 38 elements (chambers, papillary muscles, coronary
  vessels), brain = 117 (gyri and lobes), skull = 41, rib cage = 31 (ribs and
  sternum parts), vertebral column = 36 (sets of vertebrae and disks), sternum
  = 3, right lung = 3 lobes, small intestine = 3, large intestine = 6
  (colon plus taeniae and muscle layers), pelvis = 15 but includes seminal
  vesicles and piriformis, so the bony pelvis is assembled from the two hip
  bones, sacrum and coccyx instead. The composite list carries both a
  laterality-neutral entry and sided entries for many bones; only files that
  exist in the mirror are used, and a missing file is skipped and logged, not
  fatal.

## The shape of the round

Three parts, each shippable alone, in this order:

1. **The body from one dataset** — the new atlas pipeline, the skin ground,
   smoothing, layers, the tray fix, and new examples. This is where Hans's
   first five notes are answered.
2. **Exploration in the drawer** — click a region to zoom, with breadcrumbs.
3. **The 3D panel** — the same body in WebGL beside the figure.

Part 1 changes what the template draws; parts 2 and 3 add interactions around
it. Part 3 reuses part 1's downloads.

---

## Part 1 — the body from one dataset

### Licence layout

- Code stays **MIT**.
- Everything derived from BodyParts3D lives under **`src/scenes/anatomy/atlas/`**
  (the three JSON files) and, in part 3, **`public/anatomy3d/`** (the mesh
  pack). Each directory carries a `LICENSE` (CC BY-SA 2.1 Japan, the deed's
  text and URL) and an `ATTRIBUTION.md` with the line DBCLS asks for and the
  citation (Mitsuhashi et al. 2009, `doi:10.1093/nar/gkn613`; archive
  `doi:10.18908/lsdba.nbdc00837-000`).
- The attribution line is SHOWN: in the anatomy pack's description text, in the
  atlas README, and as a footer in the 3D panel (part 3). Share-alike binds the
  adapted material — the JSON and the meshes — not the app around it.
- The downloaded STL files are a build cache under `.cache/bodyparts3d/`,
  **gitignored**, never committed. The build script fetches what it lacks.

### The pipeline (`scripts/build-anatomy-atlas.mjs`, rewritten)

1. **Part table** (`assets/anatomy-sources/bodyparts.mjs`): every atlas part
   with its FMA composite or element ids, names in en/nb/la, kind, system,
   parent, detail, colour, `layer` (`superficial` | `deep`) and `behind`
   (drawn dashed when a superficial layer covers it). Composites are expanded
   through `composite_parts.txt`; a part may also list explicit element ids
   (the bony pelvis; the heart without its coronary vessels).
2. **Fetch** each element STL into the cache if absent; HEAD first, skip 404
   with a log line; fail the build only if a part ends up with NO geometry.
3. **Parse** binary STL (80-byte header, uint32 count, 50 bytes per triangle)
   into Float32 vertex triples. Pure, node-tested on a hand-made 2-triangle file.
4. **Project** to the frontal plane: `X = x`, `Y = z_top − z`, where `z_top`
   is the skin's highest vertex; the atlas space 1000 × 2000 is fitted so the
   skin spans y 40..1960 and its x-midline sits at 500. Depth per part =
   mean `−y` of its vertices (posterior first).
5. **Rasterise** each part's projected triangles into a binary mask at
   **1.5 mm per cell** (≈ 1 200 × 500 cells for the body), scanline fill per
   triangle. Then **contour** the mask with `d3-contour` (MIT, devDependency,
   build-time only) → MultiPolygon with holes. This replaces polygon union:
   79 MB of skin and 117 gyri are no problem for a mask, and the output has
   the real holes (orbits, obturator foramina) by construction.
6. **Simplify** rings with Douglas–Peucker at 1.0 atlas units, drop outers
   below 20 units², holes below 40; round to one decimal.
7. **Regions** (detail 1) stay convex hulls of their bones' rings (the
   mannequin, unchanged — a concave silhouette remains a roadmap item).
   **Joints** stay the closest-pair midpoints of their two bones' rings.
8. **Skin** (FMA7163) becomes `body_outline`, kind `outline`: the real
   silhouette, with arms and legs separated wherever the skin separates them.
   The hand-authored `BODY_OUTLINE` is deleted.
9. **Emit** the three JSON files as before, plus `preview.svg`; the build
   prints per-part triangle counts, skipped files and point totals.

Point budgets are re-measured after the first build and the tests updated to
the measured numbers plus 30 % headroom, never to a number that merely passes.

### What the template draws differently

- **Smooth curves.** Every ring is run through a **closed Catmull-Rom**
  (`kit.smoothClosed(ring, per)`, new in kit — the existing `kit.smooth` is
  an open curve with a seam at its start) with `per = 3` before ink and wash
  are built. Bones lose their chords, organs their corners. Budget: roughly
  3 × the atlas points in the drawn scene; `world_map` already draws 33 000
  smoothed points in world mode, so the 4 000-point atlas budget maps to
  ≈ 12 000 drawn, well inside what ships today.
- **`outline: skin | line | none`**, default `skin`. `skin` draws the
  silhouette as a `kit.area` wash in a skin tone (`#f1dccb` at low opacity)
  with NO stroke — it is the paper the body sits on, not a line, so labels may
  cross it freely and the lint has nothing to catch. `line` draws the same
  ring as a closed stroke (the round-1 look, with the real silhouette).
  `none` omits it. Under `focus` the skin is cropped to the frame with the
  same rule as before (no outline stroke under focus; the skin wash is clipped
  to the drawn parts' box, so it cannot leave the canvas).
- **`layer: superficial | deep`**, default `superficial`. `deep` omits every
  part tagged `layer: "superficial"` in the atlas — the intestines, stomach
  and liver — so kidneys, pancreas, spleen, adrenals and the posterior
  abdominal wall show. Parts tagged `behind: true` (kidneys, pancreas,
  spleen) are drawn with a **dashed** ink outline when the superficial layer
  is shown over them, and solid under `deep`. That is how a schematic says
  "this lies behind".
- **Colours** come from the atlas as before; the skeleton's ivory stays.
- **No new drawing library.** Hans asked whether something other than
  rough.js would serve anatomy better. drawcast already has two renderers the
  viewer switches between — `sketchy` (rough.js) and `clean` (plain SVG
  paths), `src/render/svg-backend.ts:949-954` — and the store's default is
  `clean`, so the angular look was the geometry, not the pen: rings with
  10–20 vertices are angular whichever renderer paints them. Smoothing fixes
  that for both. In `sketchy` mode anatomy dials the pen down: `kit.stroke`
  and `kit.area` gain a `roughness` option (the field already exists on
  `ResolvedStyle` and reaches rough.js at `svg-backend.ts:230`), and the
  template draws bones and organs at roughness 0.7 so a femur wobbles like a
  quick sketch, not like a nervous one. Decided on the preview and in the
  app; the number is one constant.
- **The interactive tray reveals new ids.** `src/ui/tray.ts` passes
  `{ revealNew: true }` to `previewParams`, the flag `previewSpec` already
  uses. Anatomy's `detail` changes the SET of element ids (leaf-at-level), so
  without it the slider rebuilt only ids already on screen and revealed
  nothing. `withNewIdsVisible` measures against the plan-time layout, so ids
  the storyboard deliberately hides stay hidden.

### Examples (five new here, in `src/examples.json`, all with `packs: ["anatomy"]`)

1. **The body, default look** — whole body, skin ground, organs at detail 2,
   labels all: the plate with columns and leaders.
2. **What lies behind** — `layer: deep`, a quiz on which organs appeared when
   the gut was lifted out, then "click on the left kidney".
3. **Latin names** — `names: la`, the skeleton at detail 2, three typed asks
   ("Hva heter lårbeinet på latin?" → `Os femoris`).
4. **Skeleton in ink** — `color: mono`, `outline: line`, detail 2, a quiz on
   how many bones a hand has. Params cannot change mid-spec, so the close-up
   of the hand is its own example.
5. **Inside the hand** — `focus: ["hand_left"]`, `names: nb`, labels focus,
   asks to click the carpals and the phalanges.

Parts 2 and 3 add one example each (**Explore the body**, **See it in 3D**),
for nine anatomy examples in all.

Every example must pass the bundled-example guards unchanged: validate, zero
lint issues, every drawn id present, `lintCommands`, params schema.

### Tests

- STL parser on a synthetic file; rasteriser on a triangle whose area is
  known; contour of a square with a square hole gives one ring with one hole.
- Atlas invariants as in round 1, budgets re-measured, `body_outline` now has
  more than one ring only if the skin genuinely separates (it should not: one
  outer ring, possibly with holes between the arms and the torso — those are
  kept as holes).
- Every superficial part has `layer: "superficial"`; every `behind` part is
  deep; `layer: deep` removes exactly the superficial parts and nothing else.
- `outline` variants: `skin` yields an area and no stroke; `line` a closed
  stroke; `none` neither; under focus none of them leaves the canvas.
- Smoothed rings: every drawn ring has ≥ 3 × its atlas points − 3 (the
  Catmull-Rom expansion), and the layout stays deterministic.
- The tray fix: a unit test on `tray.ts`'s repaint path is impractical
  (DOM); instead a test asserts that `previewParams` with `revealNew` reveals
  an anatomy id absent from the plan-time layout — the player-level contract
  the fix relies on.

---

## Part 2 — exploration in the drawer

### What the viewer gets

For an anatomy figure the explore tray (the ⊕ panel) gains a **Body** section:

- **Click a part on the figure to zoom into it.** A click gate like the one
  `ask.widget: "click"` uses (same `hitElement` with rings) resolves the part;
  the figure is re-laid out with `focus: [thatPartsRegion]` — the clicked
  part's nearest ancestor with geometry at detail 1 (so clicking the liver
  zooms to the abdomen, clicking a metacarpal to the hand). Clicking a part
  inside a focused view zooms one level further if it has children; otherwise
  it highlights the part and shows its name in the section.
- **Breadcrumbs**: `Body › Abdomen › Liver`; each crumb is a button that
  re-lays out at that level; `Body` restores the whole figure.
- **Controls**: `layer` (superficial/deep), `systems` (organs/skeleton/both),
  `names` (en/nb/la), and the existing `detail` slider. All apply through the
  same repaint.
- The repaint is `hd.timeline.previewSpec({ params })` — the tray's own path,
  which re-lays out with new params, reveals new ids, and keeps the mount —
  so zooming is instant and the storyboard's own state is untouched.
  **Continue** restores the authored params, as every explore beat does.

### The command

`explore: { anatomy: true }` is the authored beat ("now look around the body
yourself"). Schema: a new optional boolean on `explore`, alongside `params`,
`code` and `game`; `planCommands` carries it on the explore step; the tray
opens with the Body section expanded. Without the flag, the Body section still
appears whenever the figure's template is `anatomy` and the viewer opens the
tray themselves — the flag only makes it the authored moment.

### Seams

- `src/spec/schema.ts` explore properties; `src/render/plan.ts` explore step
  (`anatomy?: boolean`); `src/ui/tray.ts` a new section builder next to the
  games row; `src/ui/hit.ts` unchanged; the click gate is a sibling of
  `figureGateFor` in `controls.ts`, or that function gains a mode. One new
  file, `src/ui/body-explore.ts`, holds the section, the breadcrumbs and the
  focus logic so `tray.ts` grows by a call, not a screen.
- Tests: the focus-target rule (`liver → abdomen`, `carpals_left → hand_left`,
  `femur_left → thigh_left`, a region → itself) is pure and node-tested; the
  breadcrumb path for a part is pure and tested; the DOM section is exercised
  the way the existing tray tests exercise theirs.

### Example

**Explore the body**: the organs at detail 2 with a short narration, then
`explore: { anatomy: true }` — "click anything you are curious about, then
press Continue" — then a quiz that assumes they found the pancreas.

---

## Part 3 — the 3D panel

### What the viewer gets

The anatomy figure gets the 3D button molecules have. The dialog shows the
same body in WebGL: one mesh per atlas part, coloured as in 2D, lit and
slowly spinning; **click a part** and its name appears (in the figure's
`names` language); a **peel** slider sets the opacity of the superficial
layer and the skeleton so deeper organs show through; **Front / Side / Back**
camera presets; the DBCLS attribution line as a footer. Parts hidden by the
figure's `layer` or `systems` are hidden here too, so the panel shows what
the figure shows, in depth.

### The mesh pack (`public/anatomy3d/`)

Built by `scripts/build-anatomy-meshes.mjs` from the same cached STL files:

- One binary file per atlas part, `<part_id>.bin`: a 16-byte header (magic,
  vertex count, index count, flags), Float32 positions (x, y, z in atlas
  metres — mm ÷ 1000, re-centred on the skin's centre), Uint16 or Uint32
  indices. Plus `index.json`: part id → file, byte size, triangle count,
  bounding box, colour, layer, system.
- **Decimation** by vertex clustering: snap vertices to a grid (3 mm for
  organs, 2 mm for bones, 6 mm for skin), merge, drop degenerate triangles,
  then one pass of edge-collapse on the shortest edges if still above the
  part's triangle budget. Budgets: skin 20 000, big organs 4 000, small
  organs 1 500, long bones 1 500, small bones 400. Whole pack ≤ 200 000
  triangles, ≈ 4–6 MB, gzipped by the host. Composites (heart, brain,
  rib cage) are merged into one mesh per part.
- The mesh pack is fetched lazily when the dialog opens, one file per visible
  part, and cached in memory for the session.

### Seams

- `manifest.model3d: { kind: "anatomy" }` on the anatomy template.
- `src/ui/model3d.ts`: `Model3dQuery` gains `{ kind: "anatomy"; input: {
  parts: string[]; names: "en" | "nb" | "la"; colours: Record<string,
  string> } }`; `qualifiesFor3d` returns it for the anatomy template;
  `openModel3d` branches: molecules keep `addModel`, anatomy uses
  `viewer.addCustom({ vertexArr, normalArr?, faceArr, color, opacity })`
  per part, `clickable: true` with a callback that shows the name,
  `viewer.zoomTo()`, a light spin. 3dmol's `addCustom` accepts flat vertex
  arrays and face index arrays; normals are computed per face in the build.
- The peel slider and camera presets are dialog controls in `main.ts`'s
  existing 3D dialog, shown only for the anatomy kind.
- Tests: the STL → decimated mesh path on a synthetic cube (vertex count
  drops, triangles stay closed); the `.bin` writer and a reader round-trip;
  `qualifiesFor3d` for anatomy; `openModel3d` with a stub viewer records one
  `addCustom` per visible part — the same stub pattern
  `tests/model3d.test.ts` uses.

### Example

**See it in 3D**: the heart and lungs at detail 2, a narration about the
heart sitting between the lungs, and a closing line that tells the viewer the
3D button shows the same body from any side.

---

## Out of scope, on purpose

- **Sound (M3)** — unchanged, roadmap.
- **A second body (female, child).** BodyParts3D 3.0 has one adult male, so
  there is no uterus mesh. The `sex` param keeps working: `prostate` comes
  from the dataset, `uterus` stays a schematic blob placed against the
  projected pelvis — the ONE hand-authored part left, and the atlas marks it
  `source: "authored"` so nobody mistakes it for data.
- **Muscles, vessels, nerves** — the pipeline takes them whenever a part table
  lists them; not this round.
- **Concave region silhouettes** at detail 1 — roadmap.
- **Multi-target click asks** — roadmap.

## Risks

- **Download size.** The skin is 79 MB and the brain's 117 gyri may total
  50 MB; the first build takes minutes and needs the network. The cache is
  local and gitignored; the build prints progress; CI never runs it (the JSON
  is committed).
- **Composite gaps.** A composite whose elements are all missing from the
  mirror produces no geometry; the build fails loudly with the part id, and
  the table gets explicit element ids or the part is dropped with a note in
  the atlas README.
- **The skin silhouette may have thin bridges** between arms and torso at 1.5
  mm cells (where the skin mesh touches). If it does, the outline shows a
  seam; a 1.0 mm cell size or a one-cell erosion fixes it — decided on the
  preview.
- **3dmol addCustom performance** with 200 000 triangles is untested here;
  molecules are far smaller. If the dialog stutters, the skin drops to 8 000
  triangles and the spin turns off by default.
- **Hans has not yet seen round 1's sketched figure closely enough to judge
  rough.js on smoothed rings.** Smoothing multiplies points; the sketch style
  may want a lower roughness for anatomy. The preview and the app decide.

## Delivery

One worktree per part. Each part ends with the full suite green, the
production build clean, a merge to `main` and a push, and a note to Hans on
what to look at in the app.
