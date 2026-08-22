# Design: user-defined templates, domain packs, and lazy loading

*2026-08-22. Decisions made in brainstorming with Hans; validated by a rendering spike
(ring molecule / protein strip / cell cross-section through the real layoutSpec pipeline,
no new primitives needed) and by a library survey
(docs/2026-08-22-template-library-research.md).*

## Goals

1. Users create **full first-class templates** (like `supply_demand`: parametrized,
   deterministic geometry) by **describing them and/or pasting an image**; the AI
   generates the template, the user previews, iterates, and saves.
2. Built-in coverage grows into chemistry, biology, physics — authored **through the
   same pipeline** and shipped as data, not as hand-written TypeScript per scene.
3. **Modular**: a small always-loaded core; domain packs lazy-loaded on demand; more
   packs loadable from a GitHub template repo. A chemistry-only user never pays
   (bundle bytes or prompt tokens) for economics templates and vice versa.
4. Templates accept **domain notations** as parameter values where they exist
   (SMILES, Newick, secondary-structure strings, edge lists) — LLMs are fluent in
   them, and they beat any coordinate list the model could produce.

Naming: user-facing word is **template** (matches the existing `template:` spec field;
"scene" now collides with playlist vocabulary). Internal `src/scenes/` naming may be
renamed opportunistically; not a goal in itself.

## Non-goals (v1)

- Live 3D (WebGL viewers). Verdict from research: bypasses sketchy style, progressive
  drawing, annotation targeting, and SVG video export — "3D island" widgets are off-brand.
  Two 3D-adjacent paths ARE on the roadmap: flat projections from real data
  (PDB HELIX/SHEET → protein strip template), and **static 3D→SVG projection**
  (`kit.project3d`, see §3a) — validated by a mini-spike 2026-08-22.
- Cloud sync / sharing UI. Personal templates live in localStorage; sharing = exporting
  the YAML file. (Note for later: importing a template means running its layout JS —
  when sharing arrives, imports need an explicit confirmation.)
- Auto-layout solvers. Template layout is closed-form and deterministic (Escher lesson).

## 1. The template document (one format for everything)

A template is ONE YAML document — the same format whether it is bundled, in a pack,
or user-created:

```yaml
template: free_body            # id, unique within the enabled set
title: Free-body diagram
version: 1                     # of this template
kit: 1                         # sceneKit major version it was written against
status: ready                  # ready | stub (stubs are catalog-only, as today)
description: >                 # goes into the compiler-prompt catalog verbatim
  A body with labeled force arrows...
params: { ...JSON schema... }  # content-only params; NEVER coordinates
element_ids: { ... }           # id -> doc, as today
examples:                      # request -> params pairs, as today
  - request: "..."
    params: { ... }
engines: []                    # optional: [smilesdrawer] — lazy-loaded engines
layout: |                      # JS FUNCTION BODY: (params, kit, engines) => SceneLayout
  const forces = params.forces ?? [];
  ...
  return { drawables, labels, anchors, order };
```

- `layout` is the body of `new Function("params", "kit", "engines", body)`. No imports —
  everything comes through `kit` (and `engines` for declared engines). This is both the
  authoring model and the containment model.
- The existing three TS scenes stay as compiled modules for now; the registry accepts
  both shapes (`SceneModule` gains a `source?: TemplateDoc` variant). Porting them to
  the document format is a later cleanup, not a v1 requirement — but ONE of them
  (decision_tree or supply_demand) gets a document-format port early as the validation
  case and the canonical few-shot exemplar.

## 2. Runtime: compile, guard, fall through

- On template registration, the layout body is compiled once via `new Function` and
  wrapped: try/catch + output validation (SceneLayout shape; ids non-empty and unique;
  all coordinates finite and within a sane multiple of CANVAS; order ⊆ known ids).
- Validation failure or a thrown error behaves exactly like today's scene failure:
  `layoutSpec` already warns and falls through to tier-2. No new failure architecture.
- Determinism is required and enforced in review + tests (no Math.random/Date; the kit
  provides seeded jitter). Same params ⇒ byte-identical drawables.

## 3. sceneKit (the authoring stdlib)

The spike showed generated code re-derives the same helpers every time — that is where
bugs would live. `src/scenes/kit.ts` exports ONE object handed to layout bodies:

- Factories: `stroke(id, pts, opts)`, `area(id, pts, fill, opts)`, `text(id, pos, s, opts)`,
  `label(id, anchor, side, s, opts)`, `group(id, children)` — with house style defaults
  (colors, SKETCH_MS, z-layers) baked in.
- Geometry: `polygon(c, r, n, rot)`, `arc`, `ellipse`, `blob` (seeded organic closed
  curve), `wave`, `helix`, `parallelOffset(pts, d)` (double bonds, double membranes),
  `blockArrow`, `hatch(pts, spacing, angle)`, `spur`, `smooth` (Catmull-Rom → dense
  polyline), `jitter(i)` (seeded, deterministic).
- Cheap standard parsers: `parseNewick(s)`, `parseSS(s)` ("CCHHHHEEEE…"),
  `parseEdgeList(s)` ("A -> B; B -| C"). Heavy notations (SMILES) live in engines.
- Constants: `COLORS`, `CANVAS`, `SKETCH_MS`.
- Versioned: `kit: 1` in the doc; additive growth within a major version.

The kit's doc comment block IS the prompt documentation — one source, injected into the
template-authoring prompt.

Two rules the authoring prompt must teach (spike findings):
1. Text that IS geometry (atom symbols, N/C termini) = exact-position `text()`;
   text that NAMES things (organelle labels) = `label()` so the collision solver may move it.
2. Repeated micro-strokes (ring bonds, cristae, ribosome dots) go in ONE `group(id)` —
   groups are the narration/annotation beats.

## 3a. kit.project3d — static 3D as flat drawables (later kit addition)

Mini-spike (2026-08-22) validated: a ~100-line projection module (orbit camera
{azimuth, elevation, distance, fov}; perspective projection; painter's-algorithm depth
sort over typed primitives sphere/segment/polyline/arrow/billboard-text; bond segments
split at midpoints and trimmed at sphere surfaces) renders correct, good-looking
tetrahedral ball-and-stick molecules and 3D vector/axes figures as ordinary flat
drawables — so progressive drawing, narration targeting, and SVG video export all work
unchanged. Camera angles are template params (a playlist can redraw the same molecule
from a second angle as its "rotation").

Reliable scope: ball-and-stick molecules, 3D coordinate geometry/vectors, simple
lattices/unit cells, parametric helices. OUT of scope (unreliable under painter's
sorting, or SVG-bloat): intersecting surfaces, 3D ribbons/cartoons, large structures.
Not in M1; lands as a kit minor version when the first 3D template is authored
(chemistry pack is the natural driver). Cross-ref: simple-3d-svg (tscircuit) proves
the approach at 20 KB but is boxes-only — we implement our own primitives.

## 4. Engines (lazy, declared, few)

- `src/scenes/engines.ts`: registry `name -> () => import(...)`. Enabling a template
  never loads its engine; the engine loads on FIRST USE (a generation selects the
  template, or the authoring preview renders it), and that use awaits the load
  (spinner in preview). Loaded engines stay cached for the session.
- v1 ships ONE engine: `smilesdrawer` (MIT, ~150 KB, code-split chunk). Adapter runs
  its parser+layout, reads vertex positions/bond orders/wedge flags, emits drawables
  through the kit (sketchy re-render — never its own canvas).
- RDKit.js (multi-MB WASM) is explicitly deferred as an optional "pro chemistry" engine.
- Engines are same-origin code-split chunks (vite dynamic import), not CDN fetches.

## 5. Packs, loading tiers, and the catalog

A **pack** is a YAML file: `{ pack, title, description, templates: [TemplateDoc...] }`.

Three tiers, one format:
1. **Core (bundled, always on)**: the current scenes (economics/health-econ + generic).
   Small; ships in the main bundle as today.
2. **Domain packs (in-repo, lazy)**: `public/packs/chemistry.yaml`, `biology.yaml`,
   `physics.yaml` — fetched same-origin only when the user enables them. First pack
   contents come from the research top candidates (chemistry: molecule via smilesdrawer,
   reaction scheme, energy diagram; physics: free-body, ray diagram, wave; biology:
   cell, membrane, DNA strip) — authored via the AI pipeline itself, curated, committed.
3. **External packs + personal templates**: fetched by URL from a template repo
   (`hmelberg/drawcast-templates` with an `index.json`), cached in localStorage;
   personal templates are the same document, stored in localStorage, exportable as YAML.

Enabled-set semantics:
- The compiler catalog (`{{CATALOG}}`) is built from ENABLED templates only. This keeps
  the prompt lean — modularity saves prompt tokens, not just bundle bytes.
- Enabling/disabling lives in a Templates panel (see §7). Enabled set persists in
  localStorage. Default: core on; packs off until enabled.
- Loading an external pack executes its layout JS. v1 sources are Hans's own repos plus
  the user's own files; a URL outside the official index gets a confirm dialog naming
  the risk plainly.

## 5a. Template selection at generation time

Four mechanisms, in precedence order (higher wins):

1. **Explicit per-request**: a template picker near the prompt box AND a #tag
   (`#template:free_body`, with short aliases) via the existing tags vocabulary.
   Forcing a template puts ONLY that template's full entry in the prompt (the task
   degrades from "route then fill" to "fill"), and lint enforces
   `spec.template == forced` as an error (repair-loop eligible).
2. **Inference (assists, never gates)**: client-side, zero-token matching of the
   request text against template metadata (description, a new optional `keywords:`
   field, and `examples[].request` — the same exemplar-matching approach already used
   for fewshots). Its ONLY effect is choosing which templates get full entries.
3. **Preference default**: Settings gains a "default domain" (pack multi-select /
   priority). For a user who always works in economics: their packs' templates are
   always in the hot set and no #tag is ever needed. Stable preference ⇒ stable prompt
   prefix ⇒ cache-friendly.
4. **Core defaults** otherwise.

Catalog structure (activates only above ~10 enabled templates — below that, full
entries for everything, exactly as today):

- **Compact index, always complete**: one line per ENABLED template (id + one-liner,
  ~15–25 tokens each), so the model always knows everything available. Plus one line
  per available-but-disabled pack ("chemistry pack — not enabled"), so the model can
  suggest enabling it (client may offer one-click enable).
- **Full entries for the hot set**: forced template ∪ inference shortlist ∪ preference
  packs ∪ core — typically 3–5 fat entries.
- **Escalation for the rare miss**: if the model wants an index-only template, it
  signals via a marker documented in the prompt TEXT (structured outputs can be off —
  known trap); the client re-calls with that template's full entry. Normal case stays
  one call.

## 6. AI authoring pipeline

Editor gains "New template" (and "Improve this template" on an existing one):

1. Input: free-text description AND/OR pasted/uploaded image (Anthropic image content
   block — supported by the existing direct-SDK client; message becomes [image, text]).
   Image is authoring-context only; never stored in the saved template.
2. Generation call: dedicated authoring system prompt = the TemplateDoc contract +
   kit documentation + 2–3 exemplar templates (incl. the ported built-in) + the two
   spike rules + determinism rule. The JSON/YAML shape ALSO appears in the prompt text
   (structured outputs can be off for the whole session — known trap).
3. Preview loop: compile + validate + render examples[0] (or a params draft) →
   warnings + lint issues + (on request) the rendered check feed a repair round —
   reusing the existing lint-driven repair pattern and repair-model routing.
4. Iterate conversationally (image stays in context for "compare against the reference").
5. Save → localStorage "My templates", immediately enabled, in the catalog, usable in
   playlists like any built-in.

## 7. UI touchpoints (v1-minimal)

- **Templates panel**: list core/pack/personal templates with enable toggles per pack
  and per personal template; "Load pack…" (official index + URL field); import/export
  YAML; "New template" entry point. No gallery aesthetics in v1.
- Generation UI unchanged — the compiler just sees a different catalog.

## 8. Error handling summary

| Failure | Behavior |
|---|---|
| Layout body throws / invalid output | warn + fall through to tier-2 (existing path) |
| Engine fails to load | template degrades to stub (catalog notes it); toast |
| Pack fetch fails | toast; enabled set unchanged |
| Generated template invalid at authoring | repair round with validator+lint messages |
| Personal template references missing kit fn (kit version drift) | compile error at registration → stub + warning naming the function |

## 9. Testing

- Kit unit tests (geometry helpers, parsers, determinism of `blob`/`jitter`).
- Template-doc validator tests (good/bad docs).
- Guard tests: layout body that throws / returns garbage / NaN coords → fall-through.
- Pack round-trip: parse → register → catalog text contains enabled only.
- Every bundled pack template: examples render with zero lint ERRORS (warn allowed) —
  same pattern as the fewshots guard test.
- smilesDrawer adapter: 3 known molecules → expected atom/bond counts and stable output.
- Authoring pipeline: prompt-shape tests offline; live generation behind Hans's manual
  BYOK smoke (as usual).

## 10. Milestones (each independently shippable)

- **M1 — format + runtime + kit**: TemplateDoc, compile+guard, sceneKit v1, registry
  accepts doc-templates, port one built-in as validation + exemplar. Tests.
- **M2 — authoring**: New/Improve template flow with text+image input, preview,
  repair loop, My templates in localStorage, export/import YAML.
- **M3 — packs + lazy + selection**: pack format, Templates panel, in-repo lazy packs,
  catalog built from enabled set; #template tag + picker; preference default domain;
  two-level catalog + escalation (the >10-templates machinery of §5a). First domain
  pack: physics (free-body, ray diagram, wave — zero engine dependencies).
- **M4 — chemistry pack + engine loading**: engines registry, smilesDrawer adapter,
  molecule + reaction-scheme + energy-diagram templates.
- **M5 — external repo**: drawcast-templates repo + index.json, load-by-URL with
  confirm, localStorage caching. Biology pack lands here or in M3/M4 as authoring
  output permits.

Renderer additions (decorated arrowheads incl. mid-path + semantic variants; first-class
arcs/ellipses with sketchy wobble; sub/superscript text) are a parallel track informed by
the research ranking — none blocks M1–M3; sub/superscript should land with M4 (chemistry
labels need it most).
