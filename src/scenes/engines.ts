// Engines: heavy notation machinery, lazy-loaded as code-split chunks on
// FIRST USE (spec §4 — enabling a pack never loads an engine). Compiled
// layout closures access engines SYNCHRONOUSLY via getLoadedEngines and
// throw when missing — layoutSpec's catch degrades that to the fall-through
// warning. Async hooks (present/generate/authoring) await ensureEngines
// before any layout runs.

// NOTE: registry.ts is reached only via a function-scope dynamic import in
// ensureEnginesForTemplate below, never a top-level static import here. The
// module cycle is registry → doc → engines → registry (doc.ts imports
// KNOWN_ENGINES; compile.ts imports getLoadedEngines); a static top-level
// `import { scenes } from "./registry"` here forces registry.ts's own
// bottom-of-file registerTemplateYaml(...) call to run WHILE doc.ts is still
// mid-evaluation (doc.ts pulls in engines.ts before its own `const ID_RE =
// ...` line runs), producing a `ID_RE` temporal-dead-zone ReferenceError.
// The dynamic import defers that resolution to call time, after every
// module has finished its own top-level evaluation.

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
  const { scenes } = await import("./registry");
  const engines = scenes[id]?.manifest.engines;
  if (engines && engines.length > 0) await ensureEngines(engines);
}

export async function ensureEnginesForSpecs(specs: { template?: string }[]): Promise<void> {
  for (const s of specs) if (s.template) await ensureEnginesForTemplate(s.template);
}
