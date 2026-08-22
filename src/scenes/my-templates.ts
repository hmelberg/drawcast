// User-authored templates: registration that can never clobber a built-in,
// and startup loading from localStorage. The authoring UI (main.ts) and the
// authoring pipeline (llm/author.ts) both go through here.

import { loadMyTemplates } from "../store";
import { parseTemplateDoc } from "./doc";
import { registerTemplateDoc, scenes } from "./registry";

/** Ids owned by the user this session. Only these may be re-registered or removed. */
const userIds = new Set<string>();

export function isUserTemplateId(id: string): boolean {
  return userIds.has(id);
}

/**
 * Parse + register a user template. Refuses ids that belong to a non-user
 * registry entry — a user template must never shadow a built-in.
 */
export function registerUserTemplateYaml(yaml: string): { ok: boolean; id?: string; errors: string[] } {
  const { doc, errors } = parseTemplateDoc(yaml);
  if (!doc) return { ok: false, errors };
  if (scenes[doc.template] && !userIds.has(doc.template)) {
    return { ok: false, id: doc.template, errors: [`"${doc.template}" is a built-in (or otherwise existing template) — choose a different template id`] };
  }
  const prev = scenes[doc.template];
  const r = registerTemplateDoc(doc); // reuse the parsed doc — also kills the double parse
  if (r.ok) userIds.add(doc.template);
  else if (prev) scenes[doc.template] = prev;
  else delete scenes[doc.template];
  return { ok: r.ok, id: doc.template, errors: r.errors };
}

/** Remove a USER template from the live registry (no-op for anything else). */
export function unregisterUserTemplate(id: string): void {
  if (!userIds.has(id)) return;
  delete scenes[id];
  userIds.delete(id);
}

/** Load every stored personal template into the registry. Call once at startup. */
export function registerMyTemplatesAtStartup(): { id: string; ok: boolean; errors: string[] }[] {
  return loadMyTemplates().map((t) => {
    const r = registerUserTemplateYaml(t.yaml);
    return { id: r.id ?? t.id, ok: r.ok, errors: r.errors };
  });
}
