// Templates that travel INSIDE a drawcast (`spec.templates`, template-on-
// demand step 3). A template authored while answering a request is saved to
// the author's My templates, but a viewer of the published cast has no such
// list — so the cast carries the document itself, and every render path
// registers it on sight. The rule is the user-template rule: a cast copy
// never shadows a built-in or pack template, nor a My-templates copy the
// author may have improved since; it only fills the gap.

import { registerTemplateDoc, scenes } from "./registry";
import { validateTemplateDoc, type TemplateDoc } from "./doc";
import { isTrusted, noteBlocked, templateHasCode, templateKey } from "../security/code-trust";

/** Ids registered from a cast this session — the only ids a later cast may replace. */
const castIds = new Set<string>();

/** Ids a cast carried whose code was refused (untrusted) — drawn freehand instead. */
const blockedIds = new Set<string>();

export function isCastTemplateId(id: string): boolean {
  return castIds.has(id);
}

/** Was this template id carried by a cast but refused as untrusted code? */
export function isBlockedCastTemplate(id: string): boolean {
  return blockedIds.has(id);
}

export interface CastTemplatesResult {
  registered: string[];
  /** Ids a built-in, pack or user template already owns — the cast's copy is not needed. */
  skipped: string[];
  /**
   * Ids whose document carries code this browser does not trust
   * (security/code-trust.ts): not compiled, not registered. The cast then
   * draws as it would with an unknown template — freehand — until the
   * viewer says "Run it" and the page registers again.
   */
  blocked: string[];
  errors: string[];
}

/**
 * Register every template document a spec carries. Idempotent: a cast
 * copy already registered from an earlier cast is replaced (so a revised
 * cast wins over a stale one), anything else already in the registry is
 * left alone. Malformed documents are reported, never thrown — a broken
 * embedded template degrades to "unknown template → freehand" downstream.
 */
export function registerCastTemplates(spec: { templates?: unknown } | null | undefined): CastTemplatesResult {
  const out: CastTemplatesResult = { registered: [], skipped: [], blocked: [], errors: [] };
  const raw = spec?.templates;
  if (!Array.isArray(raw)) return out;
  raw.forEach((entry, i) => {
    const v = validateTemplateDoc(entry);
    if (!v.doc) {
      out.errors.push(`templates[${i}]: ${v.errors[0] ?? "invalid template document"}`);
      return;
    }
    const doc: TemplateDoc = v.doc;
    if (scenes[doc.template] && !castIds.has(doc.template)) {
      out.skipped.push(doc.template);
      return;
    }
    // The gate: a layout or widget body is a program, and new Function runs
    // it in this page's origin. Only bytes this browser trusts compile.
    if (templateHasCode(doc) && !isTrusted(templateKey(doc))) {
      out.blocked.push(doc.template);
      blockedIds.add(doc.template);
      noteBlocked({ key: templateKey(doc), kind: "template", name: doc.template });
      return;
    }
    blockedIds.delete(doc.template);
    const r = registerTemplateDoc(doc);
    if (r.ok) {
      castIds.add(doc.template);
      out.registered.push(doc.template);
    } else {
      // registerTemplateDoc leaves a STUB manifest for a doc whose body fails
      // to compile; that stub must not be mistaken for a cast-owned template.
      delete scenes[doc.template];
      out.errors.push(`templates[${i}] (${doc.template}): ${r.errors[0] ?? "failed to compile"}`);
    }
  });
  return out;
}

/** Test seam: forget which ids came from casts (the registry entries stay). */
export function resetCastTemplates(): void {
  castIds.clear();
  blockedIds.clear();
}
