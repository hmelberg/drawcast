// Compile a TemplateDoc's layout body into a guarded SceneModule (spec §2).
// The body is compiled ONCE via new Function; the guard validates the output
// shape and throws on violations — layoutSpec's existing try/catch turns that
// into the fall-through-to-tier-2 warning. No new failure architecture.

import { kit } from "./kit";
import { docToManifest, type TemplateDoc } from "./doc";
import type { SceneLayout, SceneManifest, SceneModule } from "./types";
import type { Pt } from "../layout/model";
import { SIDE_VALUES } from "../spec/types";

/** Sane coordinate bound: well beyond the 1000×750 canvas, catches runaways. */
const COORD_BOUND = 4000;

// Derived from the canonical SIDE_VALUES (spec/types.ts), not a hand-copied
// literal list — Side itself is derived from SIDE_VALUES too, so the two can
// never drift. Typed as ReadonlySet<string> (not <Side>) because membership
// here is exactly the runtime check that an untrusted `unknown` IS a Side.
const SIDES: ReadonlySet<string> = new Set(SIDE_VALUES);

export function compileTemplateDoc(doc: TemplateDoc): { module?: SceneModule; errors: string[] } {
  if (doc.status !== "ready" || !doc.layout) {
    // A "ready" doc with no layout body (only reachable by calling this
    // directly, bypassing validateTemplateDoc) has nothing to run — report
    // it as a stub rather than advertising a manifest the app can't back.
    const manifest: SceneManifest = docToManifest(doc);
    if (doc.status === "ready" && !doc.layout) manifest.status = "stub";
    return { module: { manifest }, errors: [] };
  }
  let fn: (params: Record<string, unknown>, kit: unknown, engines: unknown) => unknown;
  try {
    fn = new Function("params", "kit", "engines", `"use strict";\n${doc.layout}`) as typeof fn;
  } catch (err) {
    return { errors: [`template "${doc.template}" failed to compile: ${(err as Error).message}`] };
  }
  const layout = (params: Record<string, unknown>): SceneLayout => {
    const out = fn(params, kit, {});
    const errs = validateSceneLayout(out);
    if (errs.length > 0) {
      throw new Error(`template "${doc.template}" returned an invalid layout: ${errs[0]}`);
    }
    return out as SceneLayout;
  };
  return { module: { manifest: docToManifest(doc), layout }, errors: [] };
}

function finitePt(p: unknown): p is Pt {
  return Array.isArray(p) && p.length === 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]) && Math.abs(p[0] as number) <= COORD_BOUND && Math.abs(p[1] as number) <= COORD_BOUND;
}

/**
 * Validate one drawable node BEFORE recursing into it — this is what keeps
 * the guard defensive: a shape check (object, id, kind, pts/pos/text/children)
 * always runs first, so we never hand an unvalidated `children` array to a
 * `.forEach`/`.map` the way flattenDrawables (layout/model.ts) does. That
 * function is meant for already-valid Drawable[] — this guard is exactly
 * the boundary that has to work on untrusted, possibly-malformed output.
 *
 * `allIds` collects every id in the whole tree (top-level AND nested) for
 * the non-empty/uniqueness check (spec §2); `topIds` collects top-level ids
 * only, since `order` may only reference top-level drawables/labels (groups
 * are addressed by their own top-level id, never by a nested child's id —
 * see how order.push() is used across the per-template layout.ts files).
 */
function validateDrawableNode(raw: unknown, errors: string[], allIds: Set<string>, topIds: Set<string>, isTop: boolean): void {
  if (typeof raw !== "object" || raw === null) {
    errors.push("every drawable needs a non-empty string id");
    return;
  }
  const d = raw as Record<string, unknown>;
  if (typeof d.id !== "string" || d.id === "") {
    errors.push("every drawable needs a non-empty string id");
    return;
  }
  if (allIds.has(d.id)) {
    errors.push(`duplicate drawable id "${d.id}"`);
  } else {
    allIds.add(d.id);
  }
  if (isTop) topIds.add(d.id);

  if (d.kind === "stroke" || d.kind === "area") {
    if (!Array.isArray(d.pts) || !d.pts.every(finitePt)) {
      errors.push(`drawable "${d.id}": pts must be finite [x, y] pairs within ±${COORD_BOUND} (bounds/finite check)`);
    }
  } else if (d.kind === "text") {
    if (!finitePt(d.pos)) errors.push(`text "${d.id}": pos must be a finite point (bounds/finite check)`);
    if (typeof d.text !== "string") errors.push(`text "${d.id}": text must be a string`);
  } else if (d.kind === "group") {
    if (!Array.isArray(d.children)) {
      errors.push(`group "${d.id}": children must be an array`);
    } else {
      for (const child of d.children) validateDrawableNode(child, errors, allIds, topIds, false);
    }
  } else {
    errors.push(`drawable "${d.id}": unknown kind "${String(d.kind)}"`);
  }
}

export function validateSceneLayout(v: unknown): string[] {
  if (typeof v !== "object" || v === null) return ["result must be an object with drawables/labels/anchors/order"];
  const r = v as Record<string, unknown>;
  if (!Array.isArray(r.drawables)) return ["drawables must be an array"];
  if (!Array.isArray(r.labels)) return ["labels must be an array"];
  if (typeof r.anchors !== "object" || r.anchors === null) return ["anchors must be an object"];
  if (!Array.isArray(r.order)) return ["order must be an array"];

  const errors: string[] = [];
  const allIds = new Set<string>();
  const topIds = new Set<string>();
  for (const d of r.drawables as unknown[]) validateDrawableNode(d, errors, allIds, topIds, true);

  const labelIds = new Set<string>();
  for (const l of r.labels as { id?: unknown; anchor?: unknown; side?: unknown; text?: unknown }[]) {
    if (typeof l?.id !== "string" || l.id === "") {
      errors.push("every label needs a non-empty string id");
      continue;
    }
    labelIds.add(l.id);
    if (!finitePt(l.anchor)) errors.push(`label "${l.id}": anchor must be a finite point (bounds/finite check)`);
    if (typeof l.side !== "string" || !SIDES.has(l.side)) errors.push(`label "${l.id}": invalid side "${String(l.side)}"`);
    if (typeof l.text !== "string") errors.push(`label "${l.id}": text must be a string`);
  }

  for (const [id, p] of Object.entries(r.anchors as Record<string, unknown>)) {
    if (!finitePt(p)) errors.push(`anchor "${id}" must be a finite point (bounds/finite check)`);
  }

  for (const id of r.order as unknown[]) {
    if (typeof id !== "string" || (!topIds.has(id) && !labelIds.has(id))) {
      errors.push(`order names "${String(id)}" which is neither a drawable nor a label id (order check)`);
    }
  }
  return errors;
}
