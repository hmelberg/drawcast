# Research: specialized scientific-diagram libraries → drawcast templates

*2026-08-22. Background research for the user-defined-templates design (spike + survey run the same day). Companion to the spike finding that the existing SceneLayout contract + drawable IR handled a ring molecule, a protein secondary-structure strip, and a cell cross-section without new primitives.*

## Part 1 — Library survey

### Chemistry 2D structure drawing

**smilesDrawer** — https://github.com/reymond-group/smilesdrawer — MIT
- Spec: a SMILES string + options (bondLength, themes, atomVisualization). A `reaction-drawer` branch accepts reaction SMILES.
- Primitives: line bonds; parallel-offset double/triple bonds; solid wedge (filled taper) and hash wedge (tick series) stereo bonds; atom labels with implicit-H and charge super/subscripts.
- Layout: deterministic and fast — rings as regular polygons, fused rings share edges, chains as 120° zigzag; only bridged ring systems fall back to Kamada–Kawai. No global overlap solver. v2 has an `SvgDrawer`.

**RDKit.js / MinimalLib** — https://github.com/rdkit/rdkit-js — BSD-3
- SMILES/molblock → WASM API; `get_svg()`, highlights as JSON; `get_molblock()` exposes computed 2D coordinates (CoordGen — industry-standard layouter). Cost: multi-MB WASM.

**Kekule.js** — https://github.com/partridgejiang/Kekule.js — MIT
- Imperative object model + editor widget. Rare feature: a glyph subsystem with reaction arrows and curved electron-pushing arrows as first-class objects. Value = the mechanism-arrow object model, not layout.

**ChemDoodle Web** — GPL v3 — exclude as dependency; taxonomy reference only (lone pairs, radicals, orbitals).

**Gap worth owning:** no permissively-licensed JS library draws Lewis dot structures with lone pairs well.

### Biology / cell & pathway

**Bioicons** — https://github.com/duerrsimon/bioicons — icons individually CC0/CC-BY/MIT
- Thousands of SVG glyphs (organelles, cells, lab equipment). Not a library — an asset source. Trace the CC0 subset into house sketchy style; CC-BY needs per-icon attribution.

**sbgnviz.js** — LGPL (implement SBGN-lite natively instead)
- Lesson: ~10 typed node shapes + 5 typed arrowheads (production triangle, catalysis circle, stimulation open triangle, inhibition bar) cover all of pathway biology.

**Escher** — https://github.com/opencobra/escher — MIT
- Metabolic maps as JSON with human-curated positions; data overlays restyle. Lesson: curate layouts, don't autolayout.

**Protein 2D cartoons**
- **SSDraw** (https://github.com/ncbi/SSDraw): PDB+FASTA → 1D strip; helices as stacked wave polygons, β-strands as fat arrows, loops as thin rects. Reproducible from a secondary-structure string like `CCHHHHHCCEEEECC`.
- **Pro-origami**: 2D topology cartoons via constraint layout (Dunnart/adaptagrams); server dead — the aesthetic is the takeaway.

**Phylogeny**: Newick string input (`((A,B),(C,D));`), ~50-line deterministic cladogram layout (cf. phylotree.js, MIT).

### Physics / engineering

**schemdraw** — https://github.com/cdelker/schemdraw — MIT
- Fluent relative placement (`d += elm.Resistor().right().label('R1')`) with named anchors on a unit grid. Every element is a tiny vector program of Segment/SegmentArc/SegmentCircle/SegmentPoly/SegmentText — i.e. exactly a template library over a drawcast-like IR. The MIT symbol tables are portable data.

**circuitikz** (concept only; GPL/LPPL): component-on-a-path — `\draw (0,0) to[R=$R_1$] (2,0);` — symbols spliced mid-edge of a wire. Generalizes to optical benches and pathways.

**Ray Optics Simulation** — https://github.com/ricktu288/ray-optics — Apache-2.0
- Typed scene JSON; virtual images as dashed extensions. Lesson: an education ray diagram is closed-form from (f, d_o, h) — ~30 lines of math, no dependency.

**Free-body diagrams**: no notable OSS library exists. A gap drawcast can own.

### Declarative DSLs worth learning from

- **Penrose** (MIT): Domain/Substance/Style triple; constraint solver via gradient descent. Steal the split, reject the solver (slow, nondeterministic).
- **mafs** (MIT): coordinate-frame element (axes + world→screen mapping) is the foundational primitive for physics/math scenes.
- **JSXGraph** (LGPL/MIT dual): dependency-graph constructions; angle-arc markers and congruence ticks.
- **mermaid** (MIT): one small forgiving grammar per diagram type, defaults for everything; LLMs write it fluently *because* the grammar is small.

## Part 2 — Synthesis

### A. Ranked template candidates (teaching frequency × feasibility)

1. **Free-body diagram** — body: box|ball|incline-block; forces [{label, angleDeg, relMagnitude}]; inclineAngleDeg; showAxes; showNetForce. No OSS competition.
2. **Optics ray diagram** — element: convex/concave lens|mirror; focalLength; objectDistance; objectHeight; rays subset; showVirtual (dashed). Geometry from the thin-lens equation.
3. **Circuit diagram** — components [{type, value?, label}]; topology series|parallel|2-loop; showCurrentArrows. Port schemdraw symbol recipes.
4. **Cell cross-section** — cellType animal|plant|bacterium; organelles[]; labelStyle leader|legend; highlight. Glyph-stamp heavy.
5. **Skeletal structure (chem)** — smiles; showCarbons; highlightAtoms; caption. Layout borrowed from smilesDrawer/RDKit.
6. **Reaction scheme** — reactants[]; products[]; overArrowText; reversible. Composes #5 + arrow.
7. **Energy/reaction-coordinate diagram** — levels, activationEnergy, showCatalystCurve.
8. **Wave diagram** — amplitude, wavelength, cycles, secondWavePhaseDeg?, labelParts (λ, A, crest, trough).
9. **Membrane/lipid bilayer** — widthUnits; proteins [channel|pump|receptor]; transport [{species, mode, direction}].
10. **Central dogma / DNA** — mode helix|replicationFork|transcription|translation; rungCount; highlightStep.
11. **Phylogenetic tree** — newick; style rectangular|slanted|circular; highlightClade.
12. **Lewis dot structure** — molecule; showLonePairs; showFormalCharges. Underserved niche.
13. **Pathway (SBGN-lite)** — nodes [{name, type}]; edges [{from, to, effect: activates|inhibits|converts}].
14. **Protein secondary-structure strip** — ssString ("CCHHHHEEEE…"); annotations [{range, label}].
15. **Titration/lab apparatus** — apparatus [burette, stand, flask…]; labels; indicatorColor. Pure glyph stamping.

### B. Primitives beyond {polyline, filled polygon, text}, ranked by template count (of 15)

| Primitive | Needs | Notes |
|---|---|---|
| Arrowheads on paths (filled/open/bar/circle/double, mid-path) | ~13 | semantic head variants carry meaning (SBGN) |
| Arcs/circles/ellipses first-class | ~10 | so they get sketchy wobble natively |
| Sub/superscript rich text | ~9 | H₂O, Fe³⁺, x², λ — chemistry breaks without it |
| Smooth curves (Bézier → dense polyline) | ~8 | compile-time expandable |
| Dashed/dotted strokes | ~7 | exists — confirm on arcs |
| Glyph stamps with named anchors | ~6 | biggest authoring-leverage item |
| Leader-line callouts | ~5 | exists (label solver) |
| Coordinate frame | ~5 | exists (axes) |
| Parallel-offset line | ~4 | compile-time |
| Hatching | ~4 | compile-time |
| Angle markers + congruence ticks | ~3 | |
| Wedge + hash stereo bonds | 2 | chemistry-only, compile-time |

Only arrowheads, rich text, dash-on-everything, and stamps/anchors really want first-class IR support; the rest compile down to existing IR at template-expansion time (→ the sceneKit).

### C. Format lessons

- Penrose's split, not its solver: template owns typed params + deterministic closed-form layout; LLM emits only content. Never coordinates.
- **Domain notations as parameter values**: SMILES, Newick, SS-strings, edge lists (`EGFR -> RAS; RAS -| p53`) — compact, LLM-fluent, validatable.
- Named anchors + relative placement (schemdraw) for composition beyond one template.
- Component-on-a-path (circuitikz) serves circuits, benches, pathways with one mechanism.
- One mini-grammar per figure type, defaults for everything (mermaid).
- Semantics over geometry: params say `inhibits`, template picks the bar head (SBGN).
- Physical params, derived geometry: teacher varies focalLength, figure re-derives itself.
- Curate, don't autolayout (Escher); only small deterministic algorithms are worth shipping.

### D. Embeddability (licenses)

- **smilesDrawer (MIT)**: best chemistry fit — run parser+layout, intercept vertex positions/bond orders, re-render sketchy. ~150 KB pure JS.
- **RDKit.js (BSD-3)**: optional "pro" backend via get_molblock(); multi-MB WASM.
- schemdraw (MIT, Python): port its symbol geometry tables as data.
- ray-optics (Apache-2.0): just reimplement the ~30-line thin-lens solver.
- ChemDoodle (GPL-3), sbgnviz (LGPL): avoid embedding.
- Bioicons: CC0 subset traceable into house glyphs.
- Penrose (MIT): possible offline authoring-time layout tool, never runtime.

## Part 3 — giorgioluciano/scientificillustration

Awesome-list only: README + LICENSE (MIT), no code, no SVG assets; dormant since Nov 2023. Links to 3D/Blender render pipelines, compositing tools, image databases. **Nothing directly reusable**; skim as a reading list at most.

## Part 4 — 3D structures (chem/protein/DNA)

Viewers: 3Dmol.js (BSD-3, ~1.3 MB, near-zero-line embed), Mol* (MIT, largest, complex API), NGL (MIT, ~4 lines), Miew (MIT). All render to **WebGL canvas, not SVG**.

Friction with drawcast's pipeline: bypasses sketchy style, progressive stroke animation, SVG-anchored annotations, and SVG-rasterizing video export (would need a second per-frame capture path composited in). Verdict: isolated "3D island" widget = moderate; true pipeline integration = **complex, not credible**.

**Recommended SVG-native path instead**:
- Chemistry: 2D wedge/hash already encodes stereochemistry; no 3D needed at school level.
- Protein: parse PDB text (fixed-column), read HELIX/SHEET records → SSDraw-style strip or topology cartoon through the existing sketchy renderer (trivial-to-moderate). Stretch: Cα coordinates, PCA-project to best 2D plane, smoothed backbone polyline → a sketchy protein cartoon no other tool offers (~100 lines).
- DNA: the parametric helix template covers what teachers want.

If live 3D is later demanded anyway: 3Dmol.js as an explicitly styled-apart widget, accepting it never joins the sketchy/animated pipeline.
