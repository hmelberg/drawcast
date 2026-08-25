# Science Packs & Engines Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expand drawcast's template library across economics, health/evidence, math & logic, natural-science fills, chess and maps — plus the kit/engine machinery (kit v2 helpers, MathJax, chess.js, d3-geo engines) they need — with a bundled offline example for every new template.

**Architecture:** Kit helpers land first (one KIT_VERSION bump to 2), then three lazy engines following the existing `smilesdrawer` pattern in `src/scenes/engines.ts`. Templates arrive as (a) TS layout promotions of the five existing stub built-ins and (b) multi-doc YAML pack templates in `src/scenes/packs/*.yaml`. Every template ships with `src/examples.json` entries that pass the strict zero-lint example gate. New academic packs are enabled by default (settings upgrade unions them in); `games` and `maps` stay default-off.

**Tech Stack:** TypeScript, Vite, Vitest; new deps: `mathjax-full`, `chess.js`, `d3-geo`, `topojson-client`, `world-atlas`.

**Spec:** This document's Part 1 (below) *is* the spec — the conversation-approved gap analysis of 2026-08-25.

## Global Constraints

- Canvas is 1000×750, **y-up logical coordinates** (larger y = higher on screen). `COORD_BOUND` is 4000.
- Template layout bodies are plain JS (`"use strict"`), signature `(params, kit, engines) → {drawables, labels, anchors, order}`. No TS syntax in YAML `layout:` bodies.
- Colors ONLY from `kit.COLORS` (ink, demand, supply, shifted, accent, guide, region1, region2, regionLoss). Durations ONLY from `kit.SKETCH_MS` (stroke, curve, axis, guides, dot, region, connector, node, priceLine, arrow, text).
- Params are **content, never coordinates**. Domain notations as param values where they exist (FEN, TeX, edge lists, genotype strings).
- Every new ready template MUST have ≥1 entry in `src/examples.json` (the coverage guard `tests/examples.test.ts` enforces it; examples must lay out with **zero lint issues, not even warnings**).
- Pack YAML conventions: copy `src/scenes/packs/physics.yaml` exactly (multi-doc: header, then one doc per template; `version: 1`; `kit: 2` for anything using new helpers; `status: ready`; descriptions say "Choose this scene for ANY request about …").
- Never touch files outside this worktree. Never rebase/merge `main` mid-plan (another agent pushes to it); integration happens at the end.
- Tests: `npx vitest run` (746 passing at baseline). Commit after every task with a short imperative subject line (repo style: "Run video export…", "Ask for each Google scope alone…").
- Reference files every template author MUST read first: `src/scenes/packs/physics.yaml`, `src/scenes/kit.ts` (SceneKit interface), `src/examples.json` (2–3 entries incl. one with `packs:`), `tests/examples.test.ts`.

---

# Part 1 — Spec (approved 2026-08-25)

## Existing library (baseline)

Ready (16): supply_demand, decision_tree, qaly_profiles, free_body, ring_molecule, protein_secondary, cell_diagram, molecule_3d, ray_diagram, wave_diagram, molecule, reaction_scheme, energy_diagram, membrane_bilayer, dna_helix, phylo_tree. Stubs (5): cost_effectiveness_plane, markov_model, two_by_two_table, timeline, generic_axes_diagram.

## What we build

1. **Kit v2** (`KIT_VERSION = 2`): expression evaluator + curve sampler, grid/table builder, node-and-edge graph layouts with semantic arrowheads, angle marks + tick marks, glyph stamp library with named anchors.
2. **Engines**: `mathjax` (TeX → sampled outline polylines/areas), `chess` (FEN/SAN via chess.js), `geo` (d3-geo + world-atlas country outlines).
3. **Stub promotions** (built-in TS layouts): two_by_two_table, timeline, generic_axes_diagram, markov_model, cost_effectiveness_plane.
4. **New packs**: economics (5), evidence (5), mathlogic (7), games (1, default-off), maps (1, default-off) + fills into physics (2), biology (3), chemistry (2).
5. **Catalog**: `TEMPLATE_FULL_THRESHOLD` 20 → 50 (default config stays full-entry, cache-stable). `DEFAULT_SETTINGS.enabledPacks` gains economics/evidence/mathlogic; games/maps stay off (visible as "Pack available but not enabled" catalog lines).
6. **Offline examples**: ≥1 bundled example per new template in `src/examples.json`.

---

# Part 2 — Tasks

### Task 1: Kit v2 helpers

**Files:**
- Modify: `src/scenes/kit.ts` (append helpers to `SceneKit` + `kit`; bump `KIT_VERSION` to 2)
- Test: `tests/scene-kit.test.ts` (append describes)

**Interfaces (produced — later tasks call these exactly):**
```ts
expr(src: string, variables: string[]): (env: Record<string, number>) => number
  // thin wrapper re-exporting src/spec/expression.ts compileExpression — import it in kit.ts
sample(fn: (x: number) => number, x0: number, x1: number, n?: number): Pt[]   // n default 60; skips non-finite points
table(id: string, o: { x: number; y: number; w: number; h: number; rows: number; cols: number;
      cells?: (string | null)[][];            // row-major text, null = empty
      rowHeaders?: string[]; colHeaders?: string[];   // drawn OUTSIDE the grid, guide color
      fontSize?: number; color?: string; headerColor?: string; ms?: number }):
  { drawables: Drawable[]; anchors: Record<string, Pt>; order: string[] }
  // grid strokes: `${id}__grid`; cell text ids `${id}__c<r>_<c>`; headers `${id}__rh<r>` / `${id}__ch<c>`
  // anchors: `${id}__c<r>_<c>` = each cell CENTER (also for empty cells); y-up: row 0 is the TOP row
layoutNodes(nodes: string[], edges: { from: string; to: string }[],
      o: { style: "chain" | "circle" | "layered"; x: number; y: number; w: number; h: number }):
  Record<string, Pt>   // node name -> center. chain = evenly spaced L→R on midline; circle = ring;
  // layered = longest-path layering L→R, layers spread vertically, deterministic order (input order, no RNG)
edgeArrow(id: string, from: Pt, to: Pt, o?: { curve?: number;  // 0 straight; ± = bow (fraction of length, e.g. 0.25)
      head?: "arrow" | "bar" | "circle" | "none"; selfLoop?: boolean;  // selfLoop: circle arc above `from`, ignores `to`
      color?: string; strokeWidth?: number; ms?: number; dash?: boolean;
      shorten?: number }):   // trim this many px off BOTH ends (node radius)
  { drawables: Drawable[]; order: string[] }
  // main path id = `id`; extra head strokes get `${id}__head`. "bar" = inhibition ⊣, "circle" = catalysis ○ (small stroke circle)
angleMark(id: string, vertex: Pt, a0: number, a1: number, r: number,
      o?: { right?: boolean; color?: string; ms?: number }): StrokeDrawable
  // arc from angle a0 to a1 (radians, CCW, y-up); right?: true draws the square corner instead of an arc
tickMarks(from: Pt, to: Pt, n: number, len?: number): [Pt, Pt][]
  // n short congruence ticks crossing the midpoint region of segment from→to, perpendicular to it
stamp(name: string, at: Pt, o?: { scale?: number; rot?: number; color?: string; strokeWidth?: number; ms?: number; idPrefix?: string }):
  { drawables: Drawable[]; anchors: Record<string, Pt>; order: string[] }
STAMPS: Record<string, StampDef>  // frozen; names below
```
`StampDef = { strokes: number[][][]; anchors: Record<string, [number, number]> }` — unit-box coordinate polyline programs (x,y in [-1,1], y-up), scaled by `scale` (default 40 = half-width px) and rotated by `rot` around `at`. Stamp library v1 (draw simple, recognizable, hand-sketchable): `resistor` (zigzag, anchors left/right), `battery` (long+short plates, left/right), `bulb` (circle + cross, left/right), `switch` (pivot + open lever, left/right), `capacitor` (two plates, left/right), `flask` (Erlenmeyer outline, mouth/base), `beaker` (open rectangle w/ spout, mouth/base), `burette` (thin tube + stopcock, top/tip), `test_tube` (U-bottom tube, mouth/base), `bunsen` (burner + flame, top/base), `person` (stick figure, head/base).

**Steps:**
- [ ] Write failing tests: `expr` evaluates `"100 - 0.5*x"`; `sample` of `x => x*x` over [0,2] returns 60 finite pts, first `[0,0]`; `table` 2×2 with headers returns grid + 4 cell anchors at centers and row-0-on-top (anchor y of row 0 > row 1); `layoutNodes` chain of 3 is evenly spaced and inside the box, layered puts a node's successor strictly to its right; `edgeArrow` with `head: "bar"` emits a `__head` drawable and `shorten` moves endpoints; `angleMark` right-angle variant returns 3-pt polyline; `stamp("resistor", …)` returns drawables within the unit box scaled and both anchors; every name in `STAMPS` round-trips through `stamp` with finite coords.
- [ ] Run: `npx vitest run tests/scene-kit.test.ts` — expect FAIL (helpers undefined).
- [ ] Implement in `kit.ts`. Bump `KIT_VERSION` to 2. Keep the object frozen. No `Math.random` — reuse `jitter` if noise is wanted.
- [ ] Run full suite: `npx vitest run` — all pass (template-doc tests that pin `kit: 1` docs must still pass; KIT_VERSION 2 accepts docs declaring 1 or 2).
- [ ] Commit: "Give the scene kit tables, graphs, angle marks, stamps and an expression sampler"

### Task 2: MathJax engine

**Files:**
- Modify: `package.json` (add `mathjax-full@^3.2.2`), `src/scenes/engines.ts` (add `"mathjax"` to `KNOWN_ENGINES`, loader + interface), `src/scenes/doc.ts` only if it hard-codes engine names (it imports `KNOWN_ENGINES` — verify, likely no change)
- Test: `tests/engines.test.ts` (append) + new `tests/mathjax.test.ts`

**Interfaces (produced):**
```ts
export interface MathJaxEngine {
  /** TeX → flat drawing-ready geometry. Height-normalized: `h` = 1 for an "x"-height-ish
   *  baseline row; caller scales. Glyph outlines are CLOSED polylines (sampled from the
   *  SVG font paths); rules (fraction bars etc.) come back as 4-pt rectangles. */
  layoutTeX(tex: string, opts?: { display?: boolean }): {
    outlines: { pts: [number, number][]; }[];   // y-up, origin at left baseline, unit height scale
    w: number; h: number;                        // bounding box in the same units
  };
}
```
Use `mathjax-full`'s liteAdaptor + TeX input + SVG output (`tex2svg` pipeline, headless — no DOM). The SVG output contains `<path d="…">` glyph defs referenced by `<use>` with transforms; walk the tree, resolve transforms, and flatten each path's `d` into polylines with a small path sampler (M/L/H/V/C/S/Q/T/Z — sample cubics/quadratics at 8 segments; A can throw "unsupported" — MathJax fonts don't emit arcs). If resolving `<use>`/defs proves brittle, acceptable fallback: pass `fontCache: "none"` so paths are inlined per-glyph.

**Steps:**
- [ ] `npm install mathjax-full` — commit lockfile change together with the task.
- [ ] Write failing test (`tests/mathjax.test.ts`): `ensureEngines(["mathjax"])` then `getLoadedEngines(["mathjax"]).mathjax.layoutTeX("x^2 + 1")` returns ≥4 outlines, all pts finite, `w > 0`, `h > 0`; a second call is cached-fast; `layoutTeX("E = mc^2")` outlines count ≥ 5; sampler unit test: path `"M0 0 L10 0 C10 10 0 10 0 0 Z"` → closed polyline with >6 pts, all finite.
- [ ] Run: expect FAIL (unknown engine "mathjax").
- [ ] Implement loader in `engines.ts` following the `smilesdrawer` loader shape (lazy `await import("mathjax-full/…")`; verify exact import paths against the installed package — e.g. `mathjax-full/js/mathjax.js`, `handlers/html.js`, `input/tex.js`, `output/svg.js`, `adaptors/liteAdaptor.js`).
- [ ] Run `npx vitest run` — pass. Also confirm `npm run build` still succeeds (vite must code-split the chunk; if TS moans about the deep imports add a `// @ts-expect-error` with a comment or a d.ts shim in `src/`).
- [ ] Commit: "Add a MathJax engine that turns TeX into sketchable outlines"

### Task 3: Chess engine

**Files:**
- Modify: `package.json` (add `chess.js@^1.4.0`), `src/scenes/engines.ts` (add `"chess"`)
- Test: `tests/chess-engine.test.ts`

**Interfaces (produced):**
```ts
export interface ChessEngine {
  /** FEN (or omitted → start position) → 8×8 board, rank 8 first (row 0 = rank 8 = Black's back rank).
   *  Cells: null or { piece: "k"|"q"|"r"|"b"|"n"|"p"; color: "w"|"b" }. Throws on invalid FEN. */
  board(fen?: string): ({ piece: string; color: string } | null)[][];
  /** Play SAN moves from fen/start; returns one entry per ply with the position AFTER the ply.
   *  Throws on an illegal move naming the offending SAN. */
  replay(fen: string | undefined, sans: string[]): {
    san: string; from: string; to: string; piece: string; capture: boolean; check: boolean; mate: boolean;
    fenAfter: string;
  }[];
}
```
- [ ] `npm install chess.js`.
- [ ] Failing tests: `board()` start position has white pawns on rank 2 (`board()[6]` all `{piece:"p",color:"w"}`); `board("8/8/8/8/8/8/8/K7 w - - 0 1")` puts a white king at a1 (`[7][0]`); `replay(undefined, ["e4","e5","Nf3"])` returns 3 plies, first `{from:"e2",to:"e4"}`; scholar's-mate line ends `mate: true`; illegal `replay(undefined, ["e5"])` throws.
- [ ] Run — FAIL; implement loader (chess.js exports `Chess`); run — PASS; full suite PASS.
- [ ] Commit: "Add a chess engine for FEN positions and SAN replay"

### Task 4: Geo engine

**Files:**
- Modify: `package.json` (add `d3-geo@^3`, `topojson-client@^3`, `world-atlas@^2`), `src/scenes/engines.ts` (add `"geo"`)
- Test: `tests/geo-engine.test.ts`

**Interfaces (produced):**
```ts
export interface GeoEngine {
  /** Natural Earth projection of countries-110m fitted to a w×h box (y-up, origin bottom-left).
   *  `countries("all")` → every country outline; `countries(["Norway","Sweden"])` → just those
   *  (name match on the world-atlas `properties.name`, case-insensitive; unknown names are
   *  reported in `missing`, not thrown). Rings become polylines (closed). */
  countries(names: string[] | "all", o?: { w?: number; h?: number }): {
    shapes: { name: string; rings: [number, number][][] }[];
    missing: string[];
    /** projected centroid per shape, for labels/markers */
    centroids: Record<string, [number, number]>;
  };
}
```
Data: `import("world-atlas/countries-110m.json")` (vite bundles JSON into the lazy chunk); `topojson-client`'s `feature()`; `d3-geo`'s `geoNaturalEarth1` + `geoPath`-free manual projection of ring coordinates (project each coordinate; drop nulls from clipping); fit via `projection.fitSize`. **Flip y** (d3 is y-down, drawcast y-up): after fitSize into [w,h], emit `[x, h - y]`.
- [ ] `npm install d3-geo topojson-client world-atlas` (+ `@types/d3-geo`, `@types/topojson-client` as devDeps).
- [ ] Failing tests: `countries(["Norway"])` returns 1 shape, ≥1 ring, ≥30 finite pts, empty `missing`, centroid inside the box; `countries(["Atlantis"])` → `missing: ["Atlantis"]`; `countries("all")` ≥ 150 shapes; all coords within [0,w]×[0,h].
- [ ] Run — FAIL; implement; PASS; full suite; `npm run build` OK.
- [ ] Commit: "Add a geo engine that projects world-atlas countries"

### Task 5: Promote two_by_two_table, timeline, generic_axes_diagram + raise the catalog threshold

**Files:**
- Create: `src/scenes/two_by_two_table/layout.ts`, `src/scenes/timeline/layout.ts`, `src/scenes/generic_axes_diagram/layout.ts`
- Modify: each `manifest.json` (status → "ready", real `params_schema`, `element_ids`, ≥2 `examples`), `src/scenes/registry.ts` (wire layouts like `supply_demand`), `src/scenes/catalog.ts` (`TEMPLATE_FULL_THRESHOLD` 20 → 50 + rewrite the comment: the default library now spans the academic packs; the two-level machinery stays the safety valve for user/remote packs), `src/examples.json` (+3 entries)
- Test: new `tests/promoted-scenes.test.ts`; existing `tests/pack-defaults.test.ts`, `tests/tier2.test.ts`, `tests/catalog.test.ts` may pin stub-ness — update the pins where they assert these ids are stubs, keeping each test's intent.

**Params (exact):**
- `two_by_two_table`: `{ row_label, col_label, row_values: [string,string], col_values: [string,string], cells: [[string,string],[string,string]], cell_notes?: [[string?,…]] (small sub-text per cell), highlight?: [r,c][], title? }`. Layout: `kit.table` centered ~(500,360), w 460 h 300; axis titles via `kit.text` guide color; highlight = `kit.area` behind the cell (region1, opacity 0.35). element_ids: `grid`, `cell_0_0`…`cell_1_1`, `row_header_0/1`, `col_header_0/1`, `row_title`, `col_title`, `title`, `hl_<r>_<c>`.
- `timeline`: `{ title?, start_label?, end_label?, milestones: [{ label, sublabel?, emphasize? }] (2–8) }`. Horizontal arrow at y 375 from x 90→930 (`arrowhead: "end"`); milestones evenly spaced dots (`kit.polygon` 8-gon r 7, filled via `closed: true, fill`), labels alternating above/below (`kit.label` side above/below) to dodge collisions; emphasized dot = accent color + r 11. element_ids: `line`, `dot_<i>`, `label_<i>`, `title`.
- `generic_axes_diagram`: `{ x_label, y_label, title?, curves: [{ id?, label?, expression?  // y = f(x) via kit.expr, in x∈[0,100] domain units
    , shape?: "linear_up"|"linear_down"|"convex_up"|"concave_down"|"s_curve"|"u_shape"|"bell", color?: "ink"|"demand"|"supply"|"accent"|"shifted" }] (1–4),
    points?: [{ x, y, label }], vlines?: [{ x, label? }], hlines?: [{ y, label? }], shade?: { between: [curveIdx, curveIdx] | "under": curveIdx, x_from, x_to } }`.
  Axes: L-shaped stroke (90,650)→(90,150)? — **no: y-up**, axes corner at (110,180) rising to (110,640) and right to (910,180)… copy supply_demand's axes drawing verbatim (read `src/scenes/supply_demand/layout.ts` first and reuse its axis + world→canvas mapping helpers by copying the pattern, not importing). Domain: x,y ∈ [0,100] mapped into the plot box. `expression` wins over `shape`; shapes are canned `kit.expr` strings (e.g. s_curve = `"100/(1+exp(-0.12*(x-50)))"`, bell = `"100*exp(-((x-50)^2)/300)"`). element_ids: `axes`, `curve_<i>` (or the curve's own `id`), `point_<i>` + `point_label_<i>`, `vline_<i>`, `hline_<i>`, `shade`, `title`, `x_label`, `y_label`.
- [ ] Failing tests (`tests/promoted-scenes.test.ts`): each template — `scenes[id].manifest.status === "ready"`, layout of each manifest example returns >5 drawables, every id in `order` unique, all pts finite; two_by_two highlight adds an area; generic_axes `expression: "x"` produces a rising polyline (last y > first y in y-up coords); timeline with 3 milestones spaces dots evenly.
- [ ] Run — FAIL; implement layouts (TS, typed params interfaces exported like `SupplyDemandParams`); wire registry; update manifests; bump threshold + comment.
- [ ] Add 3 examples to `src/examples.json` (no `packs` key — these are built-ins): sensitivity/specificity 2×2 ("Show sensitivity and specificity in a 2×2 test-versus-disease table"), a research-project timeline, a diminishing-returns curve ("Draw a production function with diminishing returns"). Follow existing entries' command style (open with one speak, then draw/highlight/speak beats).
- [ ] `npx vitest run` — everything passes incl. examples gate.
- [ ] Commit: "Promote the 2×2 table, timeline and generic axes stubs to ready templates"

### Task 6: Promote markov_model and cost_effectiveness_plane

**Files:**
- Create: `src/scenes/markov_model/layout.ts`, `src/scenes/cost_effectiveness_plane/layout.ts`
- Modify: both `manifest.json`, `src/scenes/registry.ts`, `src/examples.json` (+2)
- Test: append to `tests/promoted-scenes.test.ts`

**Params (exact):**
- `markov_model`: `{ states: string[] (2–6), transitions: [{ from, to, label? }] , self_loops?: string[] (states that also stay), layout?: "circle"|"chain" (default circle for ≥3, chain for 2), highlight_state?, title? }`. Use `kit.layoutNodes` (+ box x 140 y 200 w 720 h 360), nodes as `kit.ellipse` strokes rx 78 ry 44 with centered `kit.text`, edges via `kit.edgeArrow` (`shorten: 80`, `curve: 0.18` when a reverse edge exists, else 0), self-loops via `edgeArrow(…, { selfLoop: true })`, transition labels via `kit.label` at each edge midpoint. Absorbing state (no outgoing) drawn ink; highlight_state fills accent-tinted area behind. element_ids: `state_<name-slug>`, `state_label_<slug>`, `t_<i>` (+ `t_label_<i>`), `loop_<slug>`, `title`.
- `cost_effectiveness_plane`: `{ x_label? (default "Incremental effect (QALYs)"), y_label? (default "Incremental cost"), wtp_threshold?: number (slope in y-units per x-unit, e.g. 30000 — draw when present), points: [{ label, effect, cost, emphasize? }] (1–6), quadrant_labels?: boolean (default true), title? }`. World coords: x∈[-max|effect|·1.2, +…], y likewise, both axes THROUGH the origin center (500, 400) with arrowheads both ends; quadrant labels ("More costly, more effective" NE etc.) small guide text in corners; WTP line dashed accent through origin with slope, labeled "WTP threshold"; points 8-gon dots + labels; points below the line get region2-tinted halo, above regionLoss (only when threshold present). element_ids: `x_axis`, `y_axis`, `wtp_line`, `wtp_label`, `q_ne/q_nw/q_se/q_sw`, `pt_<i>`, `pt_label_<i>`, `title`.
- [ ] Failing tests: markov circle layout of 3 states yields 3 ellipse strokes with distinct centers ≥120 px apart, transition arrows shortened (endpoints ≥60 px from centers), self loop drawables present; CE plane: axes cross at center, a point with effect>0, cost<0 lands in the SE quadrant (x > 500, y < 400 in canvas coords — remember y-up when asserting), WTP line present only when threshold given.
- [ ] Implement; wire; manifests ready with ≥2 examples each.
- [ ] Examples (+2, no packs): "Draw a three-state Markov model: Well, Sick, Dead" (self-loops on Well/Sick, absorbing Dead — speak beats explaining cycles), "Show two treatments on a cost-effectiveness plane with a WTP threshold of 30 000 per QALY".
- [ ] Full suite green.
- [ ] Commit: "Promote the Markov model and cost-effectiveness plane to ready templates"

### Task 7: Economics pack

**Files:**
- Create: `src/scenes/packs/economics.yaml`
- Modify: `src/scenes/packs.ts` (PACK_DEFS entry: id `economics`, title "Economics", description "Consumer choice, PPF, cost curves, payoff matrices and AD-AS — micro and macro teaching figures with computed geometry."), `src/store.ts` (`DEFAULT_SETTINGS.enabledPacks` + "economics"), `src/examples.json` (+5, each `packs: ["economics"]`)
- Test: append a describe to `tests/packs.test.ts` mirroring how existing packs are load-tested (register `economics`, expect 5 ready ids)

All five are YAML docs, `kit: 2`. Params exact:

1. **indifference_budget** — `{ income (default 100), price_x (default 2), price_y (default 1), preference?: "balanced"|"x_leaning"|"y_leaning" (Cobb-Douglas α .5/.7/.3), curves?: 1|2|3 (default 3, utility levels below/at/above the optimum), show_optimum?: bool (default true), x_good? (label, default "Good X"), y_good? }`. Axes like generic pattern; budget line from (0, income/price_y) to (income/price_x, 0) in world units fitted to plot box; indifference curves `u = x^α y^(1-α)` sampled via `kit.sample`; optimum at `x* = αI/px, y* = (1-α)I/py`, dot + dashed guides to axes. element_ids: `axes`, `budget_line`, `ic_1..3`, `optimum`, `optimum_label`, `guide_x`, `guide_y`, labels. Examples: default; "Show how a consumer chooses between food and housing" (x_leaning). **Numeric params make `animate` work on income/price — mention that in the description.**
2. **ppf** — `{ good_x (label), good_y, bowed?: bool (default true), points?: [{ x_share: 0–1 along the curve, label, kind?: "efficient"|"inefficient"|"unattainable" }], shade_attainable?: bool (default true) }`. Curve: quarter-ellipse from (0, 90) to (90, 0) world units (bowed) or straight line; inefficient points plotted at 0.6× radius, unattainable at 1.25×. element_ids: `axes`, `frontier`, `attainable`, `pt_<i>`, `pt_label_<i>`.
3. **firm_cost_curves** — `{ mode: "competition"|"monopoly" (default competition), show?: subset of ["mc","atc","avc","mr","demand","price_line"] (defaults per mode: competition mc+atc+avc+price_line, monopoly mc+atc+demand+mr), price?: number (competition world price 0–100, default 55), shade?: "profit"|"loss"|"deadweight"|null }`. Canned expressions: MC `= "0.06*(x-30)^2 + 12"`, ATC `= "0.04*(x-45)^2 + 22"`, AVC `= "0.04*(x-45)^2 + 14"`, demand `= "90 - 0.8*x"`, MR `= "90 - 1.6*x"`. Monopoly: q* where MC=MR (solve by scanning samples), price up to demand; deadweight triangle via `kit.area` between demand and MC from q* to competitive q. element_ids: `axes`, `mc`, `atc`, `avc`, `demand`, `mr`, `price_line`, `q_star`, `p_star`, `shade`, curve labels.
4. **payoff_matrix** — `{ row_player (default "Player 1"), col_player, row_strategies: [s,s], col_strategies: [s,s], payoffs: [[[r,c],[r,c]],[[r,c],[r,c]]] (row-major, numbers), highlight_equilibrium?: bool (default true — compute pure-strategy Nash by best-response check), title? }`. `kit.table` 2×2, cells "r, c"; best-response payoffs underlined (short stroke under the number — separate drawable); Nash cell(s) shaded region1. element_ids: `grid`, `cell_<r>_<c>`, `nash_<r>_<c>`, `row_label_<i>`, `col_label_<i>`, player labels, `title`. Examples: prisoner's dilemma (description MUST name "prisoner's dilemma", "Nash equilibrium", "game theory").
5. **ad_as** — `{ shift?: { curve: "ad"|"as", direction: "left"|"right", amount?: 0–30 (default 18) }, show_lras?: bool (default false), x_label? (default "Real GDP"), y_label? (default "Price level") }`. Clone supply_demand's visual pattern (READ its layout first): AD downward, AS upward, equilibrium dot + dashed guides; shifted curve in `shifted` color with arrow between old/new; LRAS vertical guide stroke. Numeric `shift.amount` animates. element_ids: `axes`, `ad`, `as`, `lras`, `ad_shifted`/`as_shifted`, `shift_arrow`, `eq`, `eq_new`, guides + labels.

- [ ] Failing test in `tests/packs.test.ts`: `registerPack("economics", yaml)` → ok, 5 ids ready, each lays out its first manifest example finite.
- [ ] Author the YAML; wire PACK_DEFS + store default (mind `tests/pack-defaults.test.ts` expects enabledPacks == all PACK_DEFS keys — leave passing for now; Task 11 introduces the games/maps default-off carve-out).
- [ ] 5 examples: prisoner's dilemma (highlight equilibrium beats), consumer optimum, PPF with an unattainable point, monopoly deadweight loss, AD shift right with `animate` on `shift.amount` (copy the supply_demand animate example's command shape).
- [ ] Full suite green (examples gate is the hard part — iterate until zero lint issues).
- [ ] Commit: "Add the economics pack: choice, PPF, cost curves, games and AD-AS"

### Task 8: Evidence pack (health/epi)

**Files:** Create `src/scenes/packs/evidence.yaml`; modify `src/scenes/packs.ts` (id `evidence`, title "Evidence & epidemiology", description "Survival curves, forest plots, causal DAGs, epidemic compartments and distribution curves — the figures of clinical and epidemiological papers."), `src/store.ts` (+"evidence"), `src/examples.json` (+5, `packs: ["evidence"]`); test in `tests/packs.test.ts`.

1. **survival_curve** — `{ arms: [{ label, color?: "supply"|"demand"|"accent", survival: number[] (proportions 1.0→…, one per time tick, first SHOULD be 1) }] (1–3), time_label? (default "Months"), censor_ticks?: [{ arm: idx, at: idx }] , show_median?: bool (default true), title? }`. Step-function polylines (right-continuous steps): for each consecutive pair make an L (horizontal then vertical drop); median = dashed guide at y=0.5 crossing to each arm's crossing x. element_ids: `axes`, `arm_<i>`, `arm_label_<i>`, `median_line`, `censor_<i>`, `title`.
2. **forest_plot** — `{ measure?: "RR"|"OR"|"HR"|"MD" (default RR — log scale for ratio measures: position by ln), studies: [{ label, est, lo, hi, weight?: 1–10 }] (2–8), pooled?: { est, lo, hi }, null_line?: number (default 1 for ratios, 0 for MD), title? }`. Rows top→bottom (y-up: first study highest); each row: square marker sized by weight, horizontal CI whisker; pooled = diamond (4-pt closed polygon); labels left column, "est [lo, hi]" right column as text; dashed vertical null line. element_ids: `null_line`, `study_<i>`, `ci_<i>`, `study_label_<i>`, `est_label_<i>`, `pooled`, `pooled_label`, `axis`, `title`.
3. **causal_dag** — `{ nodes: [{ name, role?: "exposure"|"outcome"|"confounder"|"collider"|"mediator" }], edges: "A -> B; C -> A; C -> B" (kit.parseEdgeList — only -> is meaningful here), highlight_backdoor?: bool (default false: tint confounder paths), title? }`. Layout: exposure far left mid-height, outcome far right, confounders above, mediators on the E→O midline, colliders below (role-driven banding; multiple per band spread horizontally). Straight `edgeArrow`s, `shorten: 46`; nodes = text with a `kit.ellipse` halo stroke rx 60 ry 30. element_ids: `node_<slug>`, `edge_<i>`, `title`.
4. **sir_compartments** — `{ compartments?: ["S","I","R"] variants like SEIR (2–5 single-letter-or-word names, default S/I/R), labels?: full names (default Susceptible/Infectious/Recovered), rates?: string[] (labels over each arrow, e.g. "β·S·I", default β then γ), show_loop?: { from, to, label } (e.g. waning immunity R→S) }`. Chain layout: `kit.layoutNodes` chain; boxes (rect strokes 150×90) not circles; big `edgeArrow`s with rate labels above; optional curved return arrow below. element_ids: `box_<name>`, `box_label_<name>`, `flow_<i>`, `rate_<i>`, `loop`, `loop_label`.
5. **distribution_curve** — `{ kind?: "normal"|"right_skew"|"left_skew" (default normal), mean_label? (default "μ"), sd_label? (default "σ"), shade?: { from?: number (in SDs, e.g. 1.96), to?: number, side?: "upper"|"lower"|"two" , label? (e.g. "2.5%") }, show_sd_ticks?: bool (default true), title? }`. Bell via `kit.expr("exp(-((x-50)^2)/2/s^2)")` world-units; skew via lognormal-ish canned expr; shaded tail = `kit.area` under the sampled curve between bounds (close the polygon along the axis); σ ticks at ±1σ ±2σ with labels. element_ids: `axis`, `curve`, `shade` (+`shade2` for two-sided), `shade_label`, `mean_line`, `sd_tick_<i>`, `title`.

- [ ] Failing pack test → author YAML → PACK_DEFS/store → 5 examples: KM curve two arms ("Compare survival on treatment versus control"), meta-analysis forest plot pooling 4 studies, confounding DAG ("Show how a confounder biases the effect of coffee on heart disease"), SEIR model, normal curve with the 2.5% upper tail shaded ("Explain a p-value cutoff of 0.05, two-sided").
- [ ] Full suite green. Commit: "Add the evidence pack: survival, forest, DAG, SIR and distributions"

### Task 9: Math & logic pack

**Files:** Create `src/scenes/packs/mathlogic.yaml`; modify `packs.ts` (id `mathlogic`, title "Math & logic", description "Venn diagrams, the unit circle, number lines, labeled geometry, truth tables, argument maps and handwritten equations."), `src/store.ts` (+"mathlogic"), `src/examples.json` (+7, `packs: ["mathlogic"]`); test in `tests/packs.test.ts`.

1. **venn_diagram** — `{ sets: [{ label, only_label? }] (2–3), overlap_labels?: { ab?, bc?, ac?, abc?, outside? }, shade?: ["a","b","ab","abc","outside", …], universe_box?: bool (default true), mode?: "overlap"|"containment" (containment: 2 sets only, A inside B — Euler "All A are B") , title? }`. Circles via `kit.ellipse` (2 sets: centers 380/620, r 170; 3 sets: triangle arrangement); shading approximated per region with `kit.blob` areas at region centroids (opacity .35 region1) — document the approximation in a comment. element_ids: `universe`, `set_<i>`, `set_label_<i>`, `region_label_<k>`, `shade_<k>`, `title`.
2. **unit_circle** — `{ angle_deg (default 45), show?: subset ["sin","cos","tan","coords","arc"] (default sin+cos+arc+coords), quadrant_labels?: bool (default false) }`. Circle r 240 at (500,380); radius stroke to angle point; sin = dashed vertical drop (demand color, labeled "sin θ"), cos horizontal (supply), small `angleMark` arc at origin labeled θ; coords text "(cos θ, sin θ)" at the point with actual 2-dec values. Numeric angle_deg **animates**. element_ids: `circle`, `x_axis`, `y_axis`, `radius`, `point`, `sin_line`, `cos_line`, `angle_arc`, `angle_label`, `coords_label`.
3. **number_line** — `{ min (default -5), max (default 5), step?: 1, points?: [{ at, label?, open?: bool }], intervals?: [{ from, to, open_from?, open_to?, label? }], arrow_ops?: [{ from, to, label }] (curved hop arrows for +/-) }`. Line + ticks + numerals; open points = stroke circle, closed = filled; intervals = thick accent overlay stroke; hops via `edgeArrow` curve 0.5. element_ids: `line`, `tick_<v>`, `pt_<i>`, `interval_<i>`, `hop_<i>` + labels.
4. **geometry_figure** — `{ kind: "triangle"|"right_triangle"|"isosceles"|"circle_theorem", vertex_labels?: ["A","B","C"], side_labels?: [a,b,c] (opposite each vertex), angle_labels?: [α,β,γ] or values, mark_angles?: [0,1,2] subset, congruent_sides?: [[0,1]] (tick pairs), right_angle_at?: 0|1|2, hypotenuse_label? }`. Triangle world pts canned per kind (right: (200,180),(760,180),(200,560) canvas y-up mapped); `angleMark` at listed vertices (right angle square at right_angle_at), `tickMarks` on congruent sides; labels outside vertices. circle_theorem: circle + inscribed triangle on a diameter (Thales) — diameter stroke, right angle marked. element_ids: `side_<i>`, `vertex_label_<i>`, `angle_<i>`, `angle_label_<i>`, `ticks_<i>`, `circle`.
5. **truth_table** — `{ variables: ["A","B"] (2–3), expression: string over A,B,C with AND/OR/NOT/XOR/IMPLIES (parse in layout: uppercase words + parens; implement a tiny recursive-descent evaluator IN the layout body — ~30 lines, no kit change), highlight_true?: bool (default true) }`. Rows = all combinations (T/F); `kit.table` with variables + expression columns; result column values bold ink, true rows shaded region2 0.25. element_ids: `grid`, cells per kit.table convention passed through, `expr_header`, `title`.
6. **argument_map** — `{ conclusion: string, premises: [{ text, supports?: idx|"conclusion" (default conclusion), objection?: bool }] (1–5) }`. Conclusion box top center (y-up: high y), premises in a row below, `edgeArrow` head "arrow" for support, "bar" + demand color for objections; wrap text at ~28 chars into multiple text lines (helper in layout body). element_ids: `conclusion_box`, `conclusion_text_<line>`, `premise_<i>` (+ text lines), `link_<i>`, `title`.
7. **equation_steps** — `engines: [mathjax]`. `{ steps: [{ tex, note? }] (1–4), title? }`. Each step: `engines.mathjax.layoutTeX(tex)` → scale so h ≈ 54 px (display) and center x; steps stacked top→bottom with 40 px gaps; outlines emitted as `kit.area(…, kit.COLORS.ink, { opacity: 0.9 })` per glyph grouped per step (`kit.group("step_<i>", …)`), note = small guide text right of the step. Description: "Handwritten math: an equation or a short derivation revealed line by line — choose for ANY request to show a formula, identity, or algebra steps." element_ids: `step_<i>`, `note_<i>`, `title`.

- [ ] Failing pack test (7 ids) → author → wire → 7 examples: sets A∩B shading; unit circle at 30° + an `animate` of angle_deg 0→360; solving-an-inequality number line; Thales' theorem figure; truth table for "(A AND B) OR NOT A"; a modus-ponens argument map; the quadratic formula via equation_steps ("Show the quadratic formula" — steps: x²+bx+c form, completed square, formula).
- [ ] Full suite green. Commit: "Add the math & logic pack, with handwritten equations via MathJax"

### Task 10: Science fills (physics, biology, chemistry packs)

**Files:** Modify `src/scenes/packs/physics.yaml` (+2 docs), `biology.yaml` (+3), `chemistry.yaml` (+2), `src/examples.json` (+7 with the right `packs:`); pack tests already count ids — update expected id lists in `tests/packs.test.ts`.

1. physics/**circuit_diagram** — `{ topology: "series"|"parallel" (default series), components: [{ type: "resistor"|"battery"|"bulb"|"switch"|"capacitor", label? }] (2–5; exactly one battery recommended — put the battery in the bottom wire), show_current?: bool (default true) }`. Rectangular loop wire (strokes); series: components spliced evenly along the top wire via `kit.stamp` (anchors left/right join the wire); parallel: 2–3 rungs between top and bottom rails, one component centered per rung; battery always bottom center; current arrows = small `edgeArrow` heads along the wire clockwise-from-battery-+ (drawn, not physically simulated). element_ids: `wire`, `comp_<i>` (stamp prefix), `comp_label_<i>`, `current_<i>`.
2. physics/**projectile_motion** — `{ speed?: 1–10 (default 6), angle_deg?: (default 45), show_vectors?: bool (default true), show_components?: bool (default false), label_apex?: bool (default true) }`. Parabola sampled from world physics (g=10), fitted to canvas; velocity vector arrows at launch/apex/landing (at apex: horizontal only); dashed component arrows when requested; ground hatch via `kit.hatch`. Numeric speed/angle **animate**. element_ids: `ground`, `path`, `v0`/`v_apex`/`v_land`, `vx_<k>`/`vy_<k>`, `apex_label`.
3. biology/**pathway** — `{ edges: "EGFR -> RAS; RAS -> ERK; p53 -| cycle" (kit.parseEdgeList: -> activates, -| inhibits, => converts), node_types?: { name: "protein"|"gene"|"metabolite"|"process" } (protein = rounded rect [ellipse rx 64 ry 30], gene = rect, metabolite = circle r 30, process = plain text), title? }`. `kit.layoutNodes` layered; `edgeArrow` head arrow/bar/arrow per edge kind (converts = open double? use plain arrow + dash). element_ids: `node_<slug>`, `node_label_<slug>`, `edge_<i>`, `title`.
4. biology/**punnett_square** — `{ parent1: "Aa" (two alleles), parent2: "Aa", trait?: { dominant: "brown eyes", recessive: "blue eyes" }, highlight?: "recessive"|"dominant"|null (default recessive), show_ratio?: bool (default true) }`. `kit.table` 2×2 with parent gametes as headers; offspring genotype per cell (sorted: uppercase first); highlighted phenotype cells shaded; ratio caption text under the grid ("3 : 1" or "1 : 2 : 1 genotypes"). element_ids: `grid` + kit.table cell ids, `parent1_label`, `parent2_label`, `ratio`, `hl_<r>_<c>`.
5. biology/**food_web** — `{ organisms: [{ name, level: "producer"|"primary"|"secondary"|"apex" }], links: "grass -> rabbit; rabbit -> fox" (A -> B means A is eaten by B), highlight?: name (tint its direct links) }`. Vertical trophic bands (producers bottom — y-up: low y), names as text with ellipse halos, `edgeArrow`s upward. element_ids: `org_<slug>`, `link_<i>`, `band_label_<k>`.
6. chemistry/**lewis_dot** — `{ molecule: "H2O"|"CO2"|"O2"|"N2"|"NH3"|"CH4"|"HCl"|"NaCl" (closed set v1 — canned geometries in the layout body: atom positions, bond pairs, lone pairs per atom), show_lone_pairs?: bool (default true), show_charges?: bool (default false — NaCl ionic brackets) }`. Atoms = element symbol text; bonds = 1–2 short parallel strokes (`kit.parallelOffset`); lone pairs = dot pairs (tiny filled 6-gons) at N/E/S/W slots. element_ids: `atom_<i>`, `bond_<i>`, `lp_<atom>_<k>`, `charge_<i>`.
7. chemistry/**lab_apparatus** — `{ setup: "titration"|"heating"|"filtration" (canned arrangements of stamps), labels?: string[] (leader labels onto the stamps' anchors in order), indicator_color?: "pink"|"blue"|"clear"|null }`. Titration: stand stroke + burette stamp above flask stamp; heating: bunsen + beaker (stand ring as ellipse); filtration: two beakers + funnel (funnel = triangle strokes, inline not a stamp). Liquid = small `kit.area` blob inside the vessel (indicator_color maps pink→regionLoss, blue→supply tint, clear→none). element_ids: `app_<k>` (stamp prefixes), `label_<i>`, `liquid`.

- [ ] Failing tests first (update pack id-count expectations), author docs, 7 examples ("Draw a series circuit with a battery, a bulb and a switch", "Show projectile motion at 45 degrees" with an `animate` of `angle_deg`, "Draw the MAPK-style pathway EGFR → RAS → ERK with p53 inhibiting the cell cycle", "Cross two heterozygous parents in a Punnett square", "Draw a food web with grass, rabbits, mice, foxes and hawks", "Draw the Lewis structure of water", "Show a titration setup with a pink indicator").
- [ ] Full suite green. Commit: "Fill the science packs: circuits, projectiles, pathways, Punnett, food webs, Lewis dots and lab setups"

### Task 11: Games pack (chess) + default-off carve-out

**Files:** Create `src/scenes/packs/games.yaml`; modify `packs.ts` (id `games`, title "Games", description "Chess positions and replayed lines from FEN and SAN — boards, move arrows, square highlights."), `src/store.ts` (do NOT add to defaults), `tests/pack-defaults.test.ts` (the pin changes: export `const DEFAULT_OFF_PACKS = new Set(["games", "maps"])` from `src/scenes/packs.ts` and assert `enabledPacks == PACK_DEFS keys minus DEFAULT_OFF_PACKS`; keep the comment explaining the academic default), `src/examples.json` (+1 with `packs: ["games"]`)
- Test: append to `tests/packs.test.ts`

**chess_board** — `engines: [chess]`. `{ fen?: string (default start), moves?: string[] (SAN line played from fen), plies_shown?: number (0–len(moves), default all — the board shows the position after floor(plies_shown) plies and an arrow for the LAST played move; NUMERIC → `animate` replays the line), arrows?: [{ from: "e2", to: "e4" }] (static annotation arrows, accent), highlights?: ["d5", …] (region1-shaded squares), flip?: bool (default false, true = Black's view), coords?: bool (default true, file/rank letters) }`. Board: 8×8 via `kit.table` (no cell text) 520×520 centered, dark squares = `kit.area` fills (guide-tinted, opacity .35); pieces = `kit.text` Unicode (♔♕♖♗♘♙/♚♛♜♝♞♟) fontSize 44 at cell anchors; last-move arrow via `edgeArrow` demand color; annotation arrows accent. Use `engines.chess.board`/`replay`. element_ids: `board`, `sq_<file><rank>` (shades), `piece_<file><rank>`, `move_arrow`, `arrow_<i>`, `hl_<sq>`, `coord_<k>`.
- [ ] Failing tests: pack registers; layout of start position emits 32 piece texts; `plies_shown: 1` on `["e4"]` moves the e2 pawn text to e4 and emits `move_arrow`; illegal SAN degrades: layout throws (caught upstream as fall-through) — assert the throw message names the move.
- [ ] Author; wire; carve out defaults + update the pinned test WITH its comment.
- [ ] Example: "Show the Scholar's Mate" — fen omitted, moves `["e4","e5","Bc4","Nc6","Qh5","Nf6","Qxf7#"]`, commands: draw board, speak setup, `animate` `plies_shown` 0→7 slowly with speak beats, final highlight f7. (Playable offline like every bundled example.)
- [ ] Full suite green. Commit: "Add the games pack: chess boards and replayed lines"

### Task 12: Maps pack

**Files:** Create `src/scenes/packs/maps.yaml`; modify `packs.ts` (id `maps`, title "Maps", description "Hand-sketched world maps: country outlines, highlights and labeled markers."; default-off per Task 11's carve-out), `src/examples.json` (+1, `packs: ["maps"]`); test in `tests/packs.test.ts`.

**world_map** — `engines: [geo]`. `{ focus?: string[] (country names — when present, draw ONLY these + a light graticule frame; absent → whole world), highlight?: string[] (subset of drawn countries, region2 area fill at low opacity), markers?: [{ country, label? }] (dot at centroid + label), title? }`. Outlines via `engines.geo.countries`; fit box 880×560 at (60,120); world mode draws every ring as guide-color strokes `ms: kit.SKETCH_MS.guides` (cap: skip rings with <8 points to keep drawable count sane); focus mode draws focus countries in ink with higher weight. Unknown names → include in a `warnings`-visible way: put "Unknown: X" into a small guide text drawable `missing_note` (layout has no warning channel). element_ids: `country_<slug>`, `hl_<slug>`, `marker_<i>`, `marker_label_<i>`, `graticule`, `missing_note`, `title`.
- [ ] Failing tests: registers; `focus: ["Norway","Sweden"]` layout yields 2+ country strokes, all pts inside canvas bounds; highlight adds an area; unknown country yields `missing_note`.
- [ ] Author; example: "Where are the Nordic countries?" (focus the 5, highlight Norway, markers with capitals in labels).
- [ ] Full suite green. Commit: "Add the maps pack: sketched country outlines via d3-geo"

### Task 13: Integration & verification

**Files:** Modify `ROADMAP.md` (a "Done" entry describing packs+engines), possibly `index.html`/help copy if pack names are listed anywhere user-facing (grep for "biology" in `index.html` and `public/` — mirror however existing packs surface), `src/llm/prompts/*` only if a prompt hard-lists packs (grep "physics" there; likely no change).
- [ ] `npx vitest run` — full suite green.
- [ ] `npm run build` — passes; note the new lazy chunk sizes in the task report.
- [ ] `npm run build:engine` — dist-engine build + `check-engine-build.mjs` pass (packs/engines must not break the embeddable build; `excludeIds` hosts keep working).
- [ ] Catalog sanity: a small node/vitest scratch (or extend `tests/pack-defaults.test.ts`) printing `catalogText({request:""}).length` with all default packs enabled — record the token-ish size (chars/4) in the final report; assert every default-enabled template has a full entry and games/maps appear as "Pack available but not enabled" lines.
- [ ] Grep the diff for leftovers: `git diff main --stat`, no stray console.log, no TODO.
- [ ] Update ROADMAP.md; commit: "Record the science-pack expansion in the roadmap"

---

## Self-review notes

- Spec coverage: kit v2 (T1), engines (T2–T4), stub promotions (T5–T6), econ (T7), evidence (T8), mathlogic incl. equations (T9), science fills (T10), chess (T11), maps (T12), threshold+defaults (T5/T7/T11), offline examples (every template task), integration (T13). Deferred by design: tier-2 `math` element (ROADMAP Phase B — engine now exists for it), RDKit pro backend, dagre/ELK, 3Dmol expansion, Norway municipality data.
- Type consistency: `kit.table`/`layoutNodes`/`edgeArrow`/`stamp` signatures in T1 are the ones every later task uses; engine method names `layoutTeX`/`board`/`replay`/`countries` used consistently.
- The examples gate (zero lint issues) is the schedule risk on every template task — authors iterate example params/labels until clean, exactly like existing bundled examples.
