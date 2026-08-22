# Templates M4 Implementation Plan — chemistry pack + engine loading

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Templates can declare engines that lazy-load on first use — proven by a chemistry pack whose `molecule` template renders any SMILES string through smilesDrawer's layout, re-drawn in drawcast's sketchy style; the pack also ships `reaction_scheme` and `energy_diagram` (engine-free).

**Architecture:** `src/scenes/engines.ts` owns engine definitions, a load cache, and sync/async access: `ensureEngines(names)` (async, loads+caches), `getLoadedEngines(names)` (sync, throws if missing — compiled layout closures call this, so a not-yet-loaded engine degrades through `layoutSpec`'s existing fall-through). The smilesdrawer engine VALUE is a wrapper exposing `layoutSmiles(smiles, opts) → NormalizedMolecule` (atoms/bonds/rings, normalized coordinates) built on the VERIFIED canvas-free path: `new SD.Drawer(opts).svgDrawer.preprocessor` → `initDraw(tree, "light", true, [])` → `processGraph()` → `graph.vertices[].position.{x,y}` + `.value.element`, `graph.edges[].{sourceId,targetId,bondType}`, `preprocessor.rings[].members` (probed against smiles-drawer@2.4.1 in node — works without DOM; `SD.parse(smiles, cb, err)` is synchronous). Doc validation accepts known engine names; the manifest carries `engines` so runtime hooks (`present`, `generateSpec`, `generateTemplate`) can await loading per template.

**Tech Stack:** smiles-drawer@2.4.1 (MIT, ESM default-export namespace, ships its own .d.ts), vite dynamic import (code-split ~150KB min chunk), vitest (node — engine tests need no DOM).

**Spec:** `docs/superpowers/specs/2026-08-22-templates-design.md` §4 (engines) + the chemistry entries of the M4 milestone. Sub/superscript text: DELIBERATE ruling — unicode sub/superscripts (H₂O, SO₄²⁻) cover chemistry labels and already render (ring_molecule uses CH₃ today); no rich-text renderer work in M4.

## Global Constraints

- smiles-drawer@2.4.1 is THE ONE new dependency this milestone adds (spec-planned). Install with `npm install --no-package-lock --save smiles-drawer@2.4.1` — NEVER create or commit a package-lock.json (an untracked one exists locally; leave it).
- Verification gate before every commit: `npx tsc && npx vitest run` (T3/T4 add `npm run build` — the code-split chunk must build). Never pipe tsc through tail.
- Commit messages end with: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`
- Engines load on FIRST USE only (spec §4): enabling the chemistry pack must NOT import smiles-drawer; generating/previewing/presenting a molecule does. Loaded engines cache for the session.
- Compiled layout closures stay SYNCHRONOUS: they call `getLoadedEngines` and THROW when an engine is missing ("engine <name> not loaded") — `layoutSpec`'s catch turns that into the fall-through warning. All awaiting happens in the async hooks BEFORE layout runs.
- The never-clobber, all-or-nothing pack discipline from M3 applies to the chemistry pack unchanged.
- Layout bodies deterministic; y-up 1000×750.
- Carried debts from M3's final review land in T3: a mocked-`callForJson` test driving `generateSpec`'s loop (labels/models/escalation), a `generateTemplate` loop test, and an `ensureEnabledPacks` retriable-vs-deterministic test.

## File Structure

- Modify `package.json` — add smiles-drawer.
- Create `src/scenes/engines.ts` — `ENGINE_DEFS`, `KNOWN_ENGINES`, `ensureEngines`, `getLoadedEngines`, `enginesLoaded`, `ensureEnginesForTemplate`, `ensureEnginesForSpecs`; the smilesdrawer wrapper with `layoutSmiles` + `NormalizedMolecule`.
- Modify `src/scenes/doc.ts` — engines validation: known names allowed, unknown rejected (replaces the M1 "not supported until M4" rule); `docToManifest` passes `engines` through.
- Modify `src/scenes/types.ts` — `SceneManifest.engines?: string[]`.
- Modify `src/scenes/compile.ts` — layout closure passes `getLoadedEngines(doc.engines ?? [])`.
- Create `src/scenes/packs/chemistry.yaml` — pack header + `molecule` (engines: [smilesdrawer]) + `reaction_scheme` + `energy_diagram`.
- Modify `src/scenes/packs.ts` — chemistry `PACK_DEFS` entry.
- Modify `src/llm/compile.ts`, `src/llm/author.ts`, `src/main.ts` — async engine hooks.
- Tests: `tests/engines.test.ts`, extend `tests/packs.test.ts` (chemistry), `tests/generate-loop.test.ts` (carried debts).

---

### Task 1: Engines module + doc/compile plumbing

**Files:**
- Modify: `package.json` (dependency)
- Create: `src/scenes/engines.ts`
- Modify: `src/scenes/doc.ts`, `src/scenes/types.ts`, `src/scenes/compile.ts`
- Test: `tests/engines.test.ts`

**Interfaces:**
- Consumes: `scenes` from `./registry` (for `ensureEnginesForTemplate`); `TemplateDoc` from `./doc` is NOT consumed here (no cycle: doc.ts imports `KNOWN_ENGINES` from engines.ts; engines.ts must NOT import doc.ts).
- Produces (Tasks 2–3 rely on):
  - `export const KNOWN_ENGINES = ["smilesdrawer"] as const`
  - `export interface NormalizedMolecule { atoms: { x: number; y: number; element: string }[]; bonds: { a: number; b: number; order: 1 | 2 | 3; aromatic: boolean }[]; rings: number[][] }` — coordinates normalized so the molecule's bbox is centered at (0,0) with max dimension 1 (the template body scales into canvas space).
  - `export interface SmilesEngine { layoutSmiles(smiles: string): NormalizedMolecule }` — throws `Error("SMILES parse failed: …")` on bad input.
  - `export const ENGINE_DEFS: Record<string, { load: () => Promise<unknown> }>` (mutable for tests)
  - `export async function ensureEngines(names: string[]): Promise<void>` — loads uncached known engines; throws on unknown name or load failure.
  - `export function enginesLoaded(names: string[]): boolean`
  - `export function getLoadedEngines(names: string[]): Record<string, unknown>` — throws `Error('engine "<name>" not loaded — this template needs it')` for any missing name.
  - `export async function ensureEnginesForTemplate(id: string): Promise<void>` — no-op when the id is unknown or declares no engines (reads `scenes[id]?.manifest.engines`).
  - `export async function ensureEnginesForSpecs(specs: { template?: string }[]): Promise<void>`

- [ ] **Step 1: Install the dependency**

```bash
npm install --no-package-lock --save smiles-drawer@2.4.1
```

Verify `package.json` gained it and NO package-lock.json was created/modified beyond the pre-existing untracked one.

- [ ] **Step 2: Write the failing tests**

```ts
// tests/engines.test.ts
import { beforeEach, describe, expect, test } from "vitest";
import { ENGINE_DEFS, KNOWN_ENGINES, ensureEngines, enginesLoaded, getLoadedEngines, ensureEnginesForTemplate, type SmilesEngine } from "../src/scenes/engines";
import { validateTemplateDoc } from "../src/scenes/doc";
import { registerTemplateDoc, scenes } from "../src/scenes/registry";
import type { TemplateDoc } from "../src/scenes/doc";

describe("engine registry mechanics (fake engine)", () => {
  beforeEach(() => {
    delete (ENGINE_DEFS as Record<string, unknown>).fake;
  });

  test("ensureEngines loads once and caches; getLoadedEngines returns the value", async () => {
    let loads = 0;
    (ENGINE_DEFS as Record<string, { load: () => Promise<unknown> }>).fake = { load: async () => (loads++, { hello: "world" }) };
    expect(enginesLoaded(["fake"])).toBe(false);
    expect(() => getLoadedEngines(["fake"])).toThrow(/not loaded/);
    await ensureEngines(["fake"]);
    await ensureEngines(["fake"]);
    expect(loads).toBe(1);
    expect(enginesLoaded(["fake"])).toBe(true);
    expect((getLoadedEngines(["fake"]).fake as { hello: string }).hello).toBe("world");
  });

  test("unknown engine name rejects", async () => {
    await expect(ensureEngines(["nope"])).rejects.toThrow(/unknown engine/);
  });

  test("a compiled template body receives loaded engines and degrades when unloaded", async () => {
    (ENGINE_DEFS as Record<string, { load: () => Promise<unknown> }>).fake = { load: async () => ({ n: 7 }) };
    const doc: TemplateDoc = {
      template: "engine_probe", version: 1, kit: 1, status: "ready", description: "d",
      params: {}, element_ids: {}, examples: [{ request: "r", params: {} }],
      engines: ["fake"],
      layout: `const n = engines.fake.n; return { drawables: [kit.stroke("dot", [[500, 400 + n]], { shapeHint: { type: "circle", c: [500, 400 + n], r: 5 } })], labels: [], anchors: {}, order: ["dot"] };`,
    };
    expect(registerTemplateDoc(doc).ok).toBe(true);
    expect(() => scenes.engine_probe.layout!({})).toThrow(/not loaded/);   // before load: throws → layoutSpec fall-through
    await ensureEngines(["fake"]);
    const r = scenes.engine_probe.layout!({});
    expect(r.drawables[0].id).toBe("dot");
    delete scenes.engine_probe;
  });
});

describe("doc validation with engines", () => {
  const base = (engines: string[]): Record<string, unknown> => ({
    template: "e_t", version: 1, kit: 1, status: "ready", description: "d",
    params: {}, element_ids: {}, examples: [], engines,
    layout: "return { drawables: [], labels: [], anchors: {}, order: [] };",
  });

  test("known engine accepted; manifest carries it", () => {
    const v = validateTemplateDoc(base(["smilesdrawer"]));
    expect(v.errors).toEqual([]);
    expect(v.doc?.engines).toEqual(["smilesdrawer"]);
  });

  test("unknown engine rejected by name", () => {
    const v = validateTemplateDoc(base(["rdkit"]));
    expect(v.errors[0]).toMatch(/unknown engine "rdkit"/);
  });
});

describe("ensureEnginesForTemplate", () => {
  test("no-op for templates without engines and for unknown ids", async () => {
    await expect(ensureEnginesForTemplate("supply_demand")).resolves.toBeUndefined();
    await expect(ensureEnginesForTemplate("does_not_exist")).resolves.toBeUndefined();
  });
});

describe("smilesdrawer engine (real load — node, no DOM)", () => {
  test("layoutSmiles(phenol) yields a normalized 7-atom graph with one ring and the O atom", async () => {
    await ensureEngines(["smilesdrawer"]);
    const eng = getLoadedEngines(["smilesdrawer"]).smilesdrawer as SmilesEngine;
    const mol = eng.layoutSmiles("c1ccc(O)cc1");
    expect(mol.atoms).toHaveLength(7);
    expect(mol.bonds).toHaveLength(7);
    expect(mol.rings).toHaveLength(1);
    expect(mol.rings[0]).toHaveLength(6);
    expect(mol.atoms.some((a) => a.element === "O")).toBe(true);
    // normalized: centered, max dimension 1
    const xs = mol.atoms.map((a) => a.x), ys = mol.atoms.map((a) => a.y);
    const w = Math.max(...xs) - Math.min(...xs), h = Math.max(...ys) - Math.min(...ys);
    expect(Math.max(w, h)).toBeCloseTo(1, 3);
    expect(Math.abs((Math.max(...xs) + Math.min(...xs)) / 2)).toBeLessThan(1e-6);
    // determinism
    expect(JSON.stringify(eng.layoutSmiles("c1ccc(O)cc1"))).toBe(JSON.stringify(mol));
  });

  test("double bond order survives (C=C)", async () => {
    await ensureEngines(["smilesdrawer"]);
    const eng = getLoadedEngines(["smilesdrawer"]).smilesdrawer as SmilesEngine;
    const mol = eng.layoutSmiles("C=C");
    expect(mol.bonds[0].order).toBe(2);
  });

  test("bad SMILES throws a parse error", async () => {
    await ensureEngines(["smilesdrawer"]);
    const eng = getLoadedEngines(["smilesdrawer"]).smilesdrawer as SmilesEngine;
    expect(() => eng.layoutSmiles("this is not smiles ((")).toThrow(/parse/i);
  });
});

test("KNOWN_ENGINES lists smilesdrawer", () => {
  expect(KNOWN_ENGINES).toContain("smilesdrawer");
});
```

- [ ] **Step 3: Run to verify failure.**

- [ ] **Step 4: Implement**

`src/scenes/engines.ts`:

```ts
// Engines: heavy notation machinery, lazy-loaded as code-split chunks on
// FIRST USE (spec §4 — enabling a pack never loads an engine). Compiled
// layout closures access engines SYNCHRONOUSLY via getLoadedEngines and
// throw when missing — layoutSpec's catch degrades that to the fall-through
// warning. Async hooks (present/generate/authoring) await ensureEngines
// before any layout runs.

import { scenes } from "./registry";

export const KNOWN_ENGINES = ["smilesdrawer"] as const;

export interface NormalizedMolecule {
  atoms: { x: number; y: number; element: string }[];
  bonds: { a: number; b: number; order: 1 | 2 | 3; aromatic: boolean }[];
  rings: number[][];
}

export interface SmilesEngine {
  layoutSmiles(smiles: string): NormalizedMolecule;
}

/** Verified against smiles-drawer@2.4.1: the canvas-free layout path. */
async function loadSmilesDrawer(): Promise<SmilesEngine> {
  const SD = (await import("smiles-drawer")).default;
  return {
    layoutSmiles(smiles: string): NormalizedMolecule {
      // SD.parse is synchronous (PEG parser + sync callbacks).
      let tree: unknown = null;
      let parseErr: unknown = null;
      SD.parse(smiles, (t: unknown) => (tree = t), (e: unknown) => (parseErr = e));
      if (parseErr || !tree) throw new Error(`SMILES parse failed: ${String(parseErr ?? "no result")}`);
      const drawer = new SD.Drawer({ width: 500, height: 500 });
      const pre = (drawer as unknown as { svgDrawer: { preprocessor: SdPreprocessor } }).svgDrawer.preprocessor;
      pre.initDraw(tree, "light", true, []);
      pre.processGraph();
      const vertices = pre.graph.vertices;
      const atoms = vertices.map((v) => ({ x: v.position.x, y: v.position.y, element: v.value.element }));
      const aromaticIds = new Set<number>();
      const rings = pre.rings.map((r) => {
        for (const m of r.members) aromaticIds.add(m);
        return [...r.members];
      });
      const orderOf = (bt: string): 1 | 2 | 3 => (bt === "=" ? 2 : bt === "#" ? 3 : 1);
      const bonds = pre.graph.edges.map((e) => ({
        a: e.sourceId,
        b: e.targetId,
        order: orderOf(e.bondType),
        aromatic: aromaticIds.has(e.sourceId) && aromaticIds.has(e.targetId),
      }));
      // Normalize: center at origin, max dimension 1 (y flipped to y-up).
      const xs = atoms.map((a) => a.x), ys = atoms.map((a) => a.y);
      const cx = (Math.max(...xs) + Math.min(...xs)) / 2;
      const cy = (Math.max(...ys) + Math.min(...ys)) / 2;
      const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) || 1;
      return {
        atoms: atoms.map((a) => ({ x: (a.x - cx) / span, y: -(a.y - cy) / span, element: a.element })),
        bonds,
        rings,
      };
    },
  };
}

interface SdPreprocessor {
  initDraw(tree: unknown, theme: string, infoOnly: boolean, highlight: unknown[]): void;
  processGraph(): void;
  graph: {
    vertices: { position: { x: number; y: number }; value: { element: string } }[];
    edges: { sourceId: number; targetId: number; bondType: string }[];
  };
  rings: { members: number[] }[];
}

export const ENGINE_DEFS: Record<string, { load: () => Promise<unknown> }> = {
  smilesdrawer: { load: loadSmilesDrawer },
};

const cache = new Map<string, unknown>();

export function enginesLoaded(names: string[]): boolean {
  return names.every((n) => cache.has(n));
}

export async function ensureEngines(names: string[]): Promise<void> {
  for (const n of names) {
    if (cache.has(n)) continue;
    const def = ENGINE_DEFS[n];
    if (!def) throw new Error(`unknown engine "${n}"`);
    cache.set(n, await def.load());
  }
}

export function getLoadedEngines(names: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const n of names) {
    if (!cache.has(n)) throw new Error(`engine "${n}" not loaded — this template needs it`);
    out[n] = cache.get(n);
  }
  return out;
}

export async function ensureEnginesForTemplate(id: string): Promise<void> {
  const engines = scenes[id]?.manifest.engines;
  if (engines && engines.length > 0) await ensureEngines(engines);
}

export async function ensureEnginesForSpecs(specs: { template?: string }[]): Promise<void> {
  for (const s of specs) if (s.template) await ensureEnginesForTemplate(s.template);
}
```

TypeScript note: `import("smiles-drawer")` resolves types from the package's own `dist/types/app.d.ts`. If its loose `any`s fight strict mode, an `as unknown as` cast at the boundary (as shown for `svgDrawer.preprocessor`) is acceptable — keep the cast local to `loadSmilesDrawer`.

`src/scenes/types.ts`: add `engines?: string[];` to `SceneManifest`.

`src/scenes/doc.ts`: replace the M1 engines rule with: engines must be an array of strings, each in `KNOWN_ENGINES` (`import { KNOWN_ENGINES } from "./engines"`), else `unknown engine "<name>" — known engines: smilesdrawer`. `docToManifest` adds `engines: doc.engines` (omit when undefined/empty — keep manifests minimal: `...(doc.engines && doc.engines.length > 0 ? { engines: doc.engines } : {})`).

`src/scenes/compile.ts`: in `compileTemplateDoc`, the layout closure calls `fn(params, kit, getLoadedEngines(doc.engines ?? []))` (import from ./engines). No other change — a missing engine throws inside the closure, exactly like invalid output.

- [ ] **Step 5: Run to verify pass** — `npx vitest run tests/engines.test.ts`, then check M1's old engines-rejected test in `tests/template-doc.test.ts` (it asserts the M4 message) — UPDATE that test: `engines: ["smilesdrawer"]` is now valid; `engines: ["rdkit"]` errors with /unknown engine/. Full suite green.

- [ ] **Step 6: Gate and commit**

```bash
npx tsc && npx vitest run
git add package.json src/scenes/engines.ts src/scenes/doc.ts src/scenes/types.ts src/scenes/compile.ts tests/engines.test.ts tests/template-doc.test.ts
git commit -m "feat: engine registry + smilesdrawer canvas-free layout engine

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Chemistry pack

**Files:**
- Create: `src/scenes/packs/chemistry.yaml`
- Modify: `src/scenes/packs.ts` (PACK_DEFS entry)
- Test: extend `tests/packs.test.ts`

**Interfaces:**
- Consumes: the engines contract from Task 1 (`engines.smilesdrawer.layoutSmiles(smiles) → NormalizedMolecule`); kit.
- Produces: templates `molecule`, `reaction_scheme`, `energy_diagram` registered under pack `chemistry`.

- [ ] **Step 1: Write `src/scenes/packs/chemistry.yaml`**

Header: `pack: chemistry`, `title: Chemistry`, description mentioning molecules from SMILES, reaction schemes, energy diagrams.

**`molecule`** — `engines: [smilesdrawer]`. Params: `smiles` (string, REQUIRED in schema prose: "standard SMILES — e.g. aspirin CC(=O)Oc1ccccc1C(=O)O"), `name` (caption), `scale` (0.5–1.5, default 1). Element ids: `bonds` (group), `double_bonds` (group), `atoms` (group of exact-position texts for non-C elements), `ring_circles` (group: aromatic rings drawn as inner circles), `molecule_name`. Layout body sketch (write it fully in the YAML; ~60 lines):

```js
const eng = engines.smilesdrawer;
const mol = eng.layoutSmiles(params.smiles ?? "c1ccccc1");
const S = 420 * Math.min(1.5, Math.max(0.5, params.scale ?? 1));
const cx = 500, cy = 400;
const P = (a) => [cx + a.x * S, cy + a.y * S];
// bonds: trim near labeled (non-C) atoms; order 2/3 via kit.parallelOffset;
// aromatic rings: one inner circle per ring (kit.ellipse at ring centroid, r *0.55 of mean member distance)
// atoms: kit.text for element !== "C" (red-ish C.demand), exact position
// name: kit.label below the molecule
```

Draw double/triple bonds as the main segment plus `kit.parallelOffset([pA, pB], 7)` (and −7 for triple's second line), shortened 15% at both ends (slice the two-point segment by lerping). Aromatic bonds render as SINGLE bonds + the ring's inner circle (classic organic style) — do NOT also alternate double bonds. Examples: benzene `c1ccccc1` named Benzene; aspirin `CC(=O)Oc1ccccc1C(=O)O`; ethene `C=C`. Description must tell the compiler: "Choose this for ANY 'draw molecule X' request; supply the standard SMILES for X — you know SMILES for common molecules."

**`reaction_scheme`** — no engines. Params: `reactants: string[]` (formula/name texts, unicode subscripts encouraged), `products: string[]`, `over` (conditions above arrow), `under`, `reversible` (⇌ as two half arrows — two parallel `kit.stroke` with `arrowhead: "end"` opposite directions), `name`. Layout: texts joined by " + " spacing computed from text length estimate (chars × fontSize × 0.6), centered row at y=400, arrow (length 150) between reactant and product groups, over/under labels. Ids: `reactants` (group), `products` (group), `arrow` (group), `label_over`, `label_under`. Examples: combustion CH₄ + 2 O₂ → CO₂ + 2 H₂O with over "Δ"; Haber N₂ + 3 H₂ ⇌ 2 NH₃.

**`energy_diagram`** — no engines. Params: `reactant_level` (0–10, default 3), `product_level` (default 1), `activation_energy` (above reactant level, default 5), `catalyzed` (bool: second dashed lower hump), `labels` (bool). Layout: axes (kit.stroke L-shape with arrowheads, "Energy" y-label, "Reaction progress" x-label as labels), reactant/product plateau lines, smooth hump via `kit.smooth` through [plateau end, peak, plateau start] control points sampled, Ea double-headed arrow from reactant level to peak with label "Eₐ", ΔH arrow between levels. Ids: `axes` (group), `reactant_line`, `product_line`, `curve`, `curve_catalyzed`, `ea_arrow`, `dh_arrow`, `label_ea`, `label_dh`, `label_reactants`, `label_products`. Examples: exothermic default; catalyzed comparison.

- [ ] **Step 2: PACK_DEFS entry**

```ts
chemistry: {
  id: "chemistry",
  title: "Chemistry",
  description: "Molecules drawn from SMILES (via the smilesDrawer engine), reaction schemes, and energy diagrams.",
  load: async () => (await import("./packs/chemistry.yaml?raw")).default,
},
```

- [ ] **Step 3: Extend `tests/packs.test.ts`**

```ts
import chemistryYaml from "../src/scenes/packs/chemistry.yaml?raw";
import { ensureEngines } from "../src/scenes/engines";

describe("chemistry pack", () => {
  beforeEach(() => unregisterPack("chemistry"));

  test("parses and registers three templates; molecule declares the engine", () => {
    const r = registerPack("chemistry", chemistryYaml);
    expect(r).toMatchObject({ ok: true, templateIds: ["molecule", "reaction_scheme", "energy_diagram"] });
    expect(scenes.molecule.manifest.engines).toEqual(["smilesdrawer"]);
  });

  test("molecule layout throws (falls through) before the engine loads, renders after", async () => {
    registerPack("chemistry", chemistryYaml);
    // NOTE: engine cache may already be warm from other test files in this worker —
    // only assert the post-load path unconditionally; assert the pre-load throw
    // only when enginesLoaded says cold. (Import enginesLoaded for the check.)
    await ensureEngines(["smilesdrawer"]);
    const r = layoutSpec({ template: "molecule", params: { smiles: "c1ccccc1", name: "Benzene" }, elements: [] } as never);
    expect(r.warnings).toEqual([]);
    expect(r.issues.filter((i) => i.severity === "error")).toEqual([]);
  });

  test("every chemistry example renders clean and deterministically (engine pre-loaded)", async () => {
    await ensureEngines(["smilesdrawer"]);
    registerPack("chemistry", chemistryYaml);
    for (const tid of ["molecule", "reaction_scheme", "energy_diagram"]) {
      for (const ex of scenes[tid].manifest.examples) {
        const res = layoutSpec({ template: tid, params: ex.params, elements: [] } as never);
        expect(res.warnings).toEqual([]);
        expect(res.issues.filter((i) => i.severity === "error")).toEqual([]);
      }
      const a = scenes[tid].layout!(scenes[tid].manifest.examples[0].params);
      expect(JSON.stringify(a)).toBe(JSON.stringify(scenes[tid].layout!(scenes[tid].manifest.examples[0].params)));
    }
  });

  test("aromatic ring renders an inner circle, not alternating double bonds", async () => {
    await ensureEngines(["smilesdrawer"]);
    registerPack("chemistry", chemistryYaml);
    const r = scenes.molecule.layout!({ smiles: "c1ccccc1" });
    const ids = flattenDrawables(r.drawables).map((d) => d.id);
    expect(ids.some((id) => /ring_circle/.test(id))).toBe(true);
    expect(ids.some((id) => /dbond|double/.test(id))).toBe(false);
  });
});
```

- [ ] **Step 4: Iterate the YAML bodies until green** (ids/params/examples stable; geometry/labels adjustable — same authorization as the physics pack).

- [ ] **Step 5: Gate and commit**

```bash
npx tsc && npx vitest run
git add src/scenes/packs/chemistry.yaml src/scenes/packs.ts tests/packs.test.ts
git commit -m "feat: chemistry pack — molecule (SMILES engine), reaction_scheme, energy_diagram

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Runtime engine hooks + carried loop tests

**Files:**
- Modify: `src/llm/compile.ts` (generateSpec), `src/llm/author.ts` (generateTemplate), `src/main.ts` (present + authoring preview)
- Test: `tests/generate-loop.test.ts` (new)

**Interfaces:**
- Consumes: Task 1's `ensureEnginesForTemplate`, `ensureEnginesForSpecs`, `ensureEngines`.

- [ ] **Step 1: Hooks**

1. `src/llm/compile.ts` `generateSpec`: after `validateSpec` succeeds and before `layoutSpec` lint, add `if (best.template) await ensureEnginesForTemplate(best.template).catch((err) => { validation.errors.push(\`engine load failed: \${(err as Error).message}\`); });` — an engine that cannot load becomes a validation error (repair can switch template or the round fails visibly).
2. `src/llm/author.ts` `generateTemplate`: after `validateTemplateDoc` yields a doc with engines (inside the loop, before `processAuthorDoc`), `await ensureEngines(doc.engines ?? []).catch(...)` pushing an errors entry on failure. Note `processAuthorDoc` runs `compiled.module.layout` — with the engine pre-loaded, it works; without (load failure), the throw message lands in errors and feeds a repair round. IMPLEMENTATION DETAIL: `processAuthorDoc` currently does validate+collision+compile+run in one call — add the await BETWEEN validate and the rest by giving `processAuthorDoc` an async pre-step in `generateTemplate`: validate first (`validateTemplateDoc(json)`), await engines for `v.doc?.engines`, THEN call `processAuthorDoc(json, measure)` (which re-validates cheaply — fine).
3. `src/main.ts` `present()`: before `mountPlaylist`, `await ensureEnginesForSpecs(itemsOf(doc.playlist).map((i) => i.spec)).catch((err) => setStatus(\`Engine load failed: \${describeApiError ? (err as Error).message : (err as Error).message}\`, "error"));` — plain `(err as Error).message` (describeApiError is for API errors; don't use it here). A failed load still mounts — the affected template falls through with the existing warning. Also in the authoring preview path (`renderAuthorPreview`): `await ensureEnginesForTemplate(id)` before `mountPlaylist`.

- [ ] **Step 2: Carried loop tests (`tests/generate-loop.test.ts`)**

Drive `generateSpec`'s loop with a mocked `callForJson` via `vi.mock("../src/llm/client", ...)` (mock `callForJson` + `makeClient`; keep `describeApiError` real or stubbed). Because `vi.mock` hoists, define response queues in the factory or via `vi.mocked`. Cases:

```ts
// Shape (write it out fully in the implementation):
// 1. happy path: one valid-spec response → 1 round labeled "initial", model = cfg.model.
// 2. schema-repair: invalid then valid → rounds ["initial","schema-repair"], second call's model === repairModelFor(cfg.model).
// 3. escalation: {need_template:"free_body"} then a valid spec with template free_body →
//    rounds ["initial","template-fetch"... wait — the fetch round IS the marker round] —
//    assert rounds[0].label === "template-fetch"? NO: re-read compile.ts — the marker round is
//    pushed with label "template-fetch" and the NEXT is "initial" on cfg.model. Assert the
//    captured per-call models: call 1 cfg.model, call 2 cfg.model (post-escalation initial).
//    Also assert repairsUsed budget unaffected: with maxRepairs 0, escalation still completes.
// 4. forced mismatch: forcedTemplate "free_body", model returns template "supply_demand" (twice) →
//    outcome error after repairs; the mismatch message appears in rounds[i].validationErrors.
// 5. escalation suppressed when forcedTemplate is set: marker response with cfg.forcedTemplate →
//    treated as a normal invalid spec (validation errors mention commands), no template-fetch round.
```

Each case asserts against `outcome.rounds` labels, captured `model` argument per call, and (case 3) that the second system blocks contain the full free_body entry (capture the `system` argument). Use minimal valid specs (`{ title: "t", template: "free_body", params: {...}, commands: [] }` — check `validateSpec`'s minimum requirements first and use a spec that genuinely validates; the existing `tests/schema.test.ts` shows valid shapes).

Also add to `tests/packs.test.ts` (or a small suite in generate-loop.test.ts): `ensureEnabledPacks` retriable split — patch `PACK_DEFS.physics.load` to reject once → result `{ok:false, retriable:true}`; then restore and confirm success; and a deterministic failure (register a colliding id first) → `retriable` falsy.

And ONE authoring-loop test in the same file: mock callForJson to return a valid TemplateDoc JSON (no engines) → `generateTemplate` returns yaml + doc with rounds [initial]; then a two-round case: first response invalid (missing layout) → repair → valid; assert round labels and repair model.

- [ ] **Step 3: Gate and commit**

```bash
npx tsc && npx vitest run && npm run build
git add src/llm/compile.ts src/llm/author.ts src/main.ts tests/generate-loop.test.ts tests/packs.test.ts
git commit -m "feat: engine load hooks (present/generate/authoring) + generation-loop tests

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Final verification + push

- [ ] Step 1: `npx tsc && npx vitest run && npm run build` — and verify the build emitted a SEPARATE chunk for smiles-drawer (`ls dist/assets | grep -i smiles` or check build output listing; the main bundle must not grow by ~150KB).
- [ ] Step 2: `npx vitest run tests/engines.test.ts tests/packs.test.ts tests/generate-loop.test.ts tests/template-doc.test.ts tests/author.test.ts` — pass.
- [ ] Step 3: `git push`. Smoke notes for the report: enable Chemistry → "Draw the aspirin molecule" (engine chunk loads on generation, molecule renders sketchy); "Show the combustion of methane as a reaction scheme"; "Draw an energy diagram with and without a catalyst".

---

## Self-Review Notes

- **Spec §4 coverage:** engines registry + first-use lazy loading (T1); enabling-never-loads pinned by design (PACK_DEFS chemistry.load imports only the yaml, not smiles-drawer — the engine import lives in ENGINE_DEFS); sync closures + throw-degrade (T1 test 3); per-template manifest carriage (T1); load-failure paths per hook (T3); code-split verification (T4).
- **Verified facts embedded:** the smilesdrawer API calls in `loadSmilesDrawer` were probed live against 2.4.1 in node (exports shape: default namespace; `Drawer` wraps `svgDrawer.preprocessor: DrawerBase`; `initDraw/processGraph/graph/rings`; `SD.parse` sync; no DOM needed). The implementer should not need to re-derive them.
- **Type consistency:** `NormalizedMolecule`/`SmilesEngine`/`ensureEngines`/`getLoadedEngines`/`ensureEnginesForTemplate`/`ensureEnginesForSpecs` names match across T1→T2 (yaml body uses `engines.smilesdrawer.layoutSmiles`)→T3 hooks.
- **Carried debts:** M3 final review's three test debts all land in T3 Step 2.
- **Known risks, named:** smiles-drawer's own .d.ts may be loose under strict tsc — boundary casts authorized, kept local. The chemistry YAML bodies iterate under the same frozen-surface rule as physics. The `vi.mock` hoisting in generate-loop tests is the usual vitest footgun — factory-scoped queues.
