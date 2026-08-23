// Explore-in-3D modal: a 3Dmol.js island mounted only for scenes whose
// registry manifest advertises model3d. Two input paths — a preset molecule's
// exact coordinates (molecule_3d template, duplicated here from its template
// body since a YAML `layout:` string cannot be imported — see the cross-check
// test in tests/model3d.test.ts) or a live PubChem 3D-SDF fetch keyed by the
// spec's smiles param (chemistry pack's molecule template). 3dmol.js itself
// is a large, browser-only dependency: never imported statically anywhere —
// ensure3dmol() dynamic-imports it on first actual open, same discipline as
// engines.ts's smiles-drawer chunk.

import { scenes } from "../scenes/registry";

// ---------- qualification ----------

export interface Model3dQuery {
  kind: "molecule";
  input: { xyz: string } | { smiles: string };
}

/**
 * Null unless spec.template's registry manifest carries model3d AND the spec
 * has what that source needs (a known preset name, or a non-empty smiles
 * param). Never throws — an unregistered template or a stub manifest is just
 * "doesn't qualify", not an error.
 */
export function qualifiesFor3d(spec: { template?: string; params?: Record<string, unknown> }): Model3dQuery | null {
  if (!spec.template) return null;
  const m3 = scenes[spec.template]?.manifest.model3d;
  if (!m3 || m3.kind !== "molecule") return null;
  const params = spec.params ?? {};
  if (m3.source === "preset") {
    const name = typeof params.molecule === "string" ? params.molecule : "methane";
    const xyz = xyzFromPreset(name) ?? xyzFromPreset("methane");
    return xyz ? { kind: "molecule", input: { xyz } } : null;
  }
  if (m3.source === "smiles") {
    const smiles = params.smiles;
    return typeof smiles === "string" && smiles.trim() !== "" ? { kind: "molecule", input: { smiles } } : null;
  }
  return null;
}

// ---------- preset coordinates ----------

/**
 * DUPLICATED from src/scenes/molecule_3d/template.yaml's `layout:` PRESETS
 * table (atoms' sym + p only — the yaml body is a plain string, not an
 * importable module). Keep these two tables in sync by hand; the cross-check
 * test in tests/model3d.test.ts renders molecule_3d and fails if the atom
 * counts (or symbols) ever drift apart.
 */
export const PRESET_XYZ: Record<string, { sym: string; p: [number, number, number] }[]> = {
  methane: [
    { sym: "C", p: [0, 0, 0] },
    { sym: "H", p: [0.63, 0.63, 0.63] },
    { sym: "H", p: [0.63, -0.63, -0.63] },
    { sym: "H", p: [-0.63, 0.63, -0.63] },
    { sym: "H", p: [-0.63, -0.63, 0.63] },
  ],
  water: [
    { sym: "O", p: [0, 0, 0] },
    { sym: "H", p: [0.76, 0.59, 0] },
    { sym: "H", p: [-0.76, 0.59, 0] },
  ],
  ammonia: [
    { sym: "N", p: [0, 0.1, 0] },
    { sym: "H", p: [0.94, -0.38, 0] },
    { sym: "H", p: [-0.47, -0.38, 0.81] },
    { sym: "H", p: [-0.47, -0.38, -0.81] },
  ],
  co2: [
    { sym: "C", p: [0, 0, 0] },
    { sym: "O", p: [1.16, 0, 0] },
    { sym: "O", p: [-1.16, 0, 0] },
  ],
};

/** Standard XYZ text (count line, comment line, then "El x y z" rows). */
export function xyzFromPreset(name: string): string | null {
  const atoms = PRESET_XYZ[name];
  if (!atoms) return null;
  const lines = atoms.map((a) => `${a.sym} ${a.p[0].toFixed(4)} ${a.p[1].toFixed(4)} ${a.p[2].toFixed(4)}`);
  return [String(atoms.length), name, ...lines].join("\n");
}

// ---------- lazy 3dmol.js load ----------

/**
 * 3dmol@2.5.5 ships only a webpack UMD bundle (package.json `main`, no
 * `exports`/`module` field) whose `types/index.d.ts` re-exports everything
 * through CommonJS `export =`. Under Vite's cjs interop the live namespace
 * (the object with createViewer/etc.) lands at either the dynamic import's
 * `.default` or the module object itself depending on the bundler's
 * analysis — this checks for the real thing rather than assuming one shape.
 * Only the handful of members actually used are typed; everything else the
 * viewer offers is reached through this same boundary, cast at the call site
 * (the smiles-drawer precedent in engines.ts).
 */
export interface Model3dViewer {
  addModel(data: string, format: string): unknown;
  setStyle(sel: Record<string, unknown>, style: Record<string, unknown>): unknown;
  zoomTo(): unknown;
  spin(axis: boolean | string): void;
  render(): unknown;
  clear(): unknown;
}
export interface Model3dNamespace {
  createViewer(container: HTMLElement, config?: Record<string, unknown>): Model3dViewer;
}

/**
 * Pure shape-resolution, factored out of ensure3dmol so both the "namespace
 * has createViewer directly" and "namespace sits under .default" interop
 * shapes can be unit-tested without touching the module-level cache below.
 */
export function resolveModel3dNamespace(mod: unknown): Model3dNamespace | undefined {
  const m = mod as Record<string, unknown> & { default?: Record<string, unknown> };
  const ns = typeof m.createViewer === "function" ? m : m.default;
  return ns && typeof ns.createViewer === "function" ? (ns as unknown as Model3dNamespace) : undefined;
}

/** Injectable load hook — tests replace `.load` the same way engines.test.ts fakes ENGINE_DEFS. */
export const MODEL3D_DEF: { load: () => Promise<unknown> } = { load: () => import("3dmol") };

let cached: Model3dNamespace | null = null;

/**
 * Test-only: clears the module-level cache so a test can force ensure3dmol()
 * to actually call its (freshly-stubbed) MODEL3D_DEF.load rather than
 * silently reusing whatever a PRIOR test in the same file already cached.
 * Never called from production code.
 */
export function resetModel3dCacheForTests(): void {
  cached = null;
}

export async function ensure3dmol(): Promise<unknown> {
  if (cached) return cached;
  const mod = await MODEL3D_DEF.load();
  const ns = resolveModel3dNamespace(mod);
  if (!ns) throw new Error("3dmol module has no createViewer export");
  cached = ns;
  return cached;
}

// ---------- PubChem 3D SDF fetch ----------

const PUBCHEM_TIMEOUT_MS = 15000;

/**
 * `signal` is the CALLER's per-open AbortSignal (main.ts aborts it on close or
 * on a newer open superseding this one) — forwarded into an internal
 * timeout-owning AbortController so the outstanding network request is
 * actually cancelled, not just ignored on resolution. Manual forwarding
 * (rather than `AbortSignal.any([signal, AbortSignal.timeout(...)])`) is
 * kept for explicit listener cleanup — AbortSignal.any is available in
 * TypeScript 5.9's lib.dom.d.ts (ES2022 target) and would also work.
 */
async function fetchPubchemSdf(smiles: string, signal: AbortSignal): Promise<string> {
  const url = `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/smiles/${encodeURIComponent(smiles)}/SDF?record_type=3d`;
  const ac = new AbortController();
  const forwardAbort = () => ac.abort();
  if (signal.aborted) forwardAbort();
  else signal.addEventListener("abort", forwardAbort);
  const timer = setTimeout(() => ac.abort(), PUBCHEM_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ac.signal });
    if (!res.ok) throw new Error(`PubChem lookup failed (${res.status})`);
    const text = await res.text();
    if (!text.trim()) throw new Error("PubChem returned no 3D structure for this molecule");
    return text;
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      // Distinguishes the two abort causes for anyone reading a log — the
      // caller (openModel3d) never surfaces this text either way once
      // signal.aborted is true, since that path bails without touching the
      // container at all.
      throw new Error(signal.aborted ? "cancelled — superseded or dialog closed" : "PubChem lookup timed out");
    }
    throw err;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", forwardAbort);
  }
}

// ---------- viewer lifecycle ----------

/**
 * Resolves the query's input, mounts a 3Dmol viewer into `container`, and
 * returns a destroy function.
 *
 * `signal` is this call's OWN generation marker (main.ts creates one
 * AbortController per open and aborts the previous one on both close and a
 * newer open) — it is what actually cancels a still-in-flight PubChem fetch
 * (see fetchPubchemSdf) AND is checked at TWO points: immediately on entry
 * (a call that arrives already superseded never touches `container` at
 * all — not even to show "Loading…") and again immediately before the final
 * mount (anything async above — chunk load, fetch — could have taken long
 * enough for this call to have been superseded in the meantime). Both checks
 * matter: by the time a stale call's promise resolves, a newer call may
 * already have mounted its own viewer into the same shared container, so
 * this must never assume it still owns it. `host.open` is kept as a second,
 * redundant guard on the pre-mount check (defense in depth against any path
 * that closes the dialog without going through the abort wiring). Any
 * failure (offline, chunk load, PubChem error) — PROVIDED this call is still
 * current — replaces `container` with plain failure text: never throws,
 * never leaves the dialog blank with no explanation.
 *
 * Status/error text is written as a bare string via `container.replaceChildren`
 * (browsers turn a string argument into a Text node) rather than through an
 * `h()`-built element — this function otherwise has no DOM dependency beyond
 * whatever `host`/`container` themselves provide, which keeps its abort/guard
 * behavior unit-testable against plain object stubs (see tests/model3d.test.ts).
 *
 * `opts.onMounted` fires once after a successful mount — the caller's handle
 * for runtime controls like the spin toggle — and never fires on an aborted,
 * superseded, or failed open.
 */
export async function openModel3d(
  host: HTMLDialogElement,
  container: HTMLElement,
  q: Model3dQuery,
  signal: AbortSignal,
  opts?: { onMounted?: (viewer: Model3dViewer) => void },
): Promise<() => void> {
  let viewer: Model3dViewer | null = null;
  const destroy = (): void => {
    try {
      viewer?.spin(false);
      viewer?.clear();
    } catch {
      // Teardown must never throw during dialog close.
    }
    viewer = null;
  };
  if (signal.aborted) return destroy; // dead on arrival — never touch the container
  container.replaceChildren("Loading 3D viewer…");
  try {
    const $3Dmol = (await ensure3dmol()) as Model3dNamespace;
    const data = "xyz" in q.input ? q.input.xyz : await fetchPubchemSdf(q.input.smiles, signal);
    const format = "xyz" in q.input ? "xyz" : "sdf";
    // Immediately before the mount, not before: this is the checkpoint that
    // matters — anything async above (chunk load, fetch) could have taken
    // long enough for this call to have been superseded.
    if (signal.aborted || !host.open) return destroy;
    container.replaceChildren();
    viewer = $3Dmol.createViewer(container, { backgroundColor: "white" });
    viewer.addModel(data, format);
    viewer.setStyle({}, { stick: {}, sphere: { scale: 0.3 } });
    viewer.zoomTo();
    viewer.render();
    viewer.spin(true);
    opts?.onMounted?.(viewer);
  } catch (err) {
    if (signal.aborted) return destroy; // superseded mid-flight — never touch a container another call may now own
    container.replaceChildren(`Couldn't load the 3D view: ${(err as Error).message}`);
  }
  return destroy;
}
