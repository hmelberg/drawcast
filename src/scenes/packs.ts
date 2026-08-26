// Domain packs: multi-doc YAML (header + TemplateDocs), loaded lazily as
// code-split ?raw chunks, registered with the same never-clobber discipline
// as user templates. All-or-nothing per pack: one bad template rolls back
// the whole pack (the registry-always-writes trap from M2 applies per id).

import { CORE_SCHEMA, loadAll } from "js-yaml";
import { validateTemplateDoc, type TemplateDoc } from "./doc";
import { registerTemplateDoc, scenes } from "./registry";
import type { SceneModule } from "./types";

export interface PackDef {
  id: string;
  title: string;
  description: string;
  load: () => Promise<string>;
}

export const PACK_DEFS: Record<string, PackDef> = {
  physics: {
    id: "physics",
    title: "Physics",
    description: "Optics ray diagrams and wave diagrams — classroom physics figures with computed geometry.",
    load: async () => (await import("./packs/physics.yaml?raw")).default,
  },
  chemistry: {
    id: "chemistry",
    title: "Chemistry",
    description: "Molecules drawn from SMILES (via the smilesDrawer engine), reaction schemes, and energy diagrams.",
    load: async () => (await import("./packs/chemistry.yaml?raw")).default,
  },
  biology: {
    id: "biology",
    title: "Biology",
    description: "Cell-membrane, DNA-helix, and phylogenetic-tree figures — computed geometry, no engines.",
    load: async () => (await import("./packs/biology.yaml?raw")).default,
  },
  economics: {
    id: "economics",
    title: "Economics",
    description: "Consumer choice, PPF, cost curves, payoff matrices and AD-AS — micro and macro teaching figures with computed geometry.",
    load: async () => (await import("./packs/economics.yaml?raw")).default,
  },
  evidence: {
    id: "evidence",
    title: "Evidence & epidemiology",
    description: "Survival curves, forest plots, causal DAGs, epidemic compartments and distribution curves — the figures of clinical and epidemiological papers.",
    load: async () => (await import("./packs/evidence.yaml?raw")).default,
  },
  mathlogic: {
    id: "mathlogic",
    title: "Math & logic",
    description: "Venn diagrams, the unit circle, number lines, labeled geometry, truth tables, argument maps and handwritten equations.",
    load: async () => (await import("./packs/mathlogic.yaml?raw")).default,
  },
  medicine: {
    id: "medicine",
    title: "Medicine",
    description: "Icon arrays for absolute risk, ECG rhythm strips, the heart's double circulation, neurons, and screening/lead-time-bias timelines.",
    load: async () => (await import("./packs/medicine.yaml?raw")).default,
  },
  macro: {
    id: "macro",
    title: "Macroeconomics",
    description: "IS-LM, the Solow growth model and AD-AS — the macro teaching canon with computed intersections and shift arrows.",
    load: async () => (await import("./packs/macro.yaml?raw")).default,
  },
  empirics: {
    id: "empirics",
    title: "Empirical methods",
    description: "Event-study plots, difference-in-differences trends, regression discontinuity, binned scatters and Lorenz curves — the figures of modern applied economics.",
    load: async () => (await import("./packs/empirics.yaml?raw")).default,
  },
  hta: {
    id: "hta",
    title: "Health technology assessment",
    description: "Cost-effectiveness acceptability curves and tornado diagrams — the sensitivity-analysis figures of economic evaluation.",
    load: async () => (await import("./packs/hta.yaml?raw")).default,
  },
  music: {
    id: "music",
    title: "Music",
    description: "Staff notation and a piano keyboard — sheet-music figures that pair with the play command's synthesized sound.",
    load: async () => (await import("./packs/music.yaml?raw")).default,
  },
  games: {
    id: "games",
    title: "Games",
    description: "Chess positions and replayed lines from FEN and SAN — boards, move arrows, square highlights.",
    load: async () => (await import("./packs/games.yaml?raw")).default,
  },
  maps: {
    id: "maps",
    title: "Maps",
    description: "Hand-sketched world maps: country outlines, highlights and labeled markers.",
    load: async () => (await import("./packs/maps.yaml?raw")).default,
  },
};

/**
 * Bundled packs that stay off by default (DEFAULT_SETTINGS.enabledPacks does
 * NOT include them, and tests/pack-defaults.test.ts pins that). These are
 * outside the academic default this app ships for (evidence/physics/
 * chemistry/biology/economics/mathlogic) — they render fine and are one
 * toggle away, but a user has to reach for them. Unenabled, they still show
 * up in the catalog as "Pack available but not enabled" lines (see
 * catalogText in ./catalog) so the model knows they exist.
 */
export const DEFAULT_OFF_PACKS: ReadonlySet<string> = new Set(["games", "maps"]);

export interface ParsedPack {
  id: string;
  title: string;
  description: string;
  templates: TemplateDoc[];
}

export function parsePack(yamlText: string): { pack?: ParsedPack; errors: string[] } {
  let docs: unknown[];
  try {
    docs = loadAll(yamlText, undefined, { schema: CORE_SCHEMA }).filter((d) => d != null);
  } catch (err) {
    return { errors: [`YAML: ${(err as Error).message}`] };
  }
  const [header, ...rest] = docs;
  const h = header as { pack?: unknown; title?: unknown; description?: unknown } | undefined;
  if (!h || typeof h.pack !== "string") {
    return { errors: ["the first document must be the pack header ({ pack, title, description })"] };
  }
  const errors: string[] = [];
  const templates: TemplateDoc[] = [];
  rest.forEach((raw, i) => {
    const v = validateTemplateDoc(raw);
    if (v.doc) templates.push(v.doc);
    else errors.push(`template ${i}: ${v.errors.join("; ")}`);
  });
  if (errors.length > 0) return { errors };
  return {
    pack: {
      id: h.pack,
      title: typeof h.title === "string" ? h.title : h.pack,
      description: typeof h.description === "string" ? h.description : "",
      templates,
    },
    errors: [],
  };
}

/** pack id -> the template ids it registered. */
const packOwned = new Map<string, Set<string>>();

export function isPackTemplateId(tid: string): boolean {
  for (const ids of packOwned.values()) if (ids.has(tid)) return true;
  return false;
}

export function packTemplateIds(id: string): string[] {
  return [...(packOwned.get(id) ?? [])];
}

export function registerPack(id: string, yamlText: string): { ok: boolean; templateIds: string[]; errors: string[] } {
  if (packOwned.has(id)) return { ok: true, templateIds: packTemplateIds(id), errors: [] };
  const { pack, errors } = parsePack(yamlText);
  if (!pack) return { ok: false, templateIds: [], errors };
  if (pack.templates.length === 0) {
    // A pack that registers with zero templates would make packOwned.has(id)
    // true while packTemplateIds(id) stays empty — the exact state catalogText's
    // "unregistered" check (packTemplateIds(p.id).length === 0) uses as its
    // proxy for "not registered". Rejecting here keeps that proxy exact instead
    // of conflating "genuinely unregistered" with "registered but empty" — and
    // it's a clearer authoring error than a silent no-op pack anyway.
    return { ok: false, templateIds: [], errors: [`pack "${id}" has no templates`] };
  }
  const undo: { tid: string; prev: SceneModule | undefined }[] = [];
  const registered: string[] = [];
  for (const doc of pack.templates) {
    if (scenes[doc.template]) {
      rollback(undo);
      return { ok: false, templateIds: [], errors: [`pack "${id}": template id "${doc.template}" already exists in the registry — pack not loaded`] };
    }
    undo.push({ tid: doc.template, prev: scenes[doc.template] });
    const r = registerTemplateDoc(doc);
    if (!r.ok) {
      rollback(undo);
      return { ok: false, templateIds: [], errors: [`pack "${id}": template "${doc.template}" failed to compile: ${r.errors.join("; ")}`] };
    }
    registered.push(doc.template);
  }
  packOwned.set(id, new Set(registered));
  return { ok: true, templateIds: registered, errors: [] };
}

function rollback(undo: { tid: string; prev: SceneModule | undefined }[]): void {
  for (const { tid, prev } of undo.reverse()) {
    if (prev) scenes[tid] = prev;
    else delete scenes[tid];
  }
}

export function unregisterPack(id: string): void {
  const ids = packOwned.get(id);
  if (!ids) return;
  for (const tid of ids) delete scenes[tid];
  packOwned.delete(id);
}

export interface EnsurePackResult {
  id: string;
  ok: boolean;
  errors: string[];
  /**
   * True only when the failure was fetching the pack module itself (network
   * hiccup, stale chunk after a deploy, offline) — transient, so a caller must
   * NOT drop it from persisted "enabled" settings (spec §8: "Pack fetch fails
   * → toast; enabled set unchanged" — retrying, e.g. on the next reload, can
   * still succeed). Left undefined for a deterministic failure (registerPack's
   * parse/compile/collision errors, or an id no longer in PACK_DEFS) — retrying
   * that can't help, so a caller MAY drop it from settings.
   */
  retriable?: boolean;
}

/** Load + register every listed pack (skipping already-registered ones). */
export async function ensureEnabledPacks(ids: string[]): Promise<EnsurePackResult[]> {
  const out: EnsurePackResult[] = [];
  for (const id of ids) {
    const def = PACK_DEFS[id];
    if (!def) {
      out.push({ id, ok: false, errors: [`unknown pack "${id}"`] });
      continue;
    }
    if (packOwned.has(id)) {
      out.push({ id, ok: true, errors: [] });
      continue;
    }
    let yaml: string;
    try {
      yaml = await def.load();
    } catch (err) {
      out.push({ id, ok: false, errors: [`failed to load pack: ${(err as Error).message}`], retriable: true });
      continue;
    }
    const r = registerPack(id, yaml);
    out.push({ id, ok: r.ok, errors: r.errors });
  }
  return out;
}
