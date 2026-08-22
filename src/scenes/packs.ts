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
};

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

/** Load + register every listed pack (skipping already-registered ones). */
export async function ensureEnabledPacks(ids: string[]): Promise<{ id: string; ok: boolean; errors: string[] }[]> {
  const out: { id: string; ok: boolean; errors: string[] }[] = [];
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
    try {
      const yaml = await def.load();
      const r = registerPack(id, yaml);
      out.push({ id, ok: r.ok, errors: r.errors });
    } catch (err) {
      out.push({ id, ok: false, errors: [`failed to load pack: ${(err as Error).message}`] });
    }
  }
  return out;
}
