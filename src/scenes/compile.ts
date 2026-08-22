// Compile a TemplateDoc's layout body into a guarded SceneModule (spec §2).
// The body is compiled ONCE via new Function; the guard validates the output
// shape and throws on violations — layoutSpec's existing try/catch turns that
// into the fall-through-to-tier-2 warning. No new failure architecture.

import { kit } from "./kit";
import { docToManifest, type TemplateDoc } from "./doc";
import type { SceneLayout, SceneModule } from "./types";
import { flattenDrawables, type Drawable, type Pt } from "../layout/model";

/** Sane coordinate bound: well beyond the 1000×750 canvas, catches runaways. */
const COORD_BOUND = 4000;

const SIDES = new Set(["above", "below", "left", "right", "above-left", "above-right", "below-left", "below-right"]);

export function compileTemplateDoc(doc: TemplateDoc): { module?: SceneModule; errors: string[] } {
  if (doc.status !== "ready" || !doc.layout) {
    return { module: { manifest: docToManifest(doc) }, errors: [] };
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

export function validateSceneLayout(v: unknown): string[] {
  if (typeof v !== "object" || v === null) return ["result must be an object with drawables/labels/anchors/order"];
  const r = v as Record<string, unknown>;
  if (!Array.isArray(r.drawables)) return ["drawables must be an array"];
  if (!Array.isArray(r.labels)) return ["labels must be an array"];
  if (typeof r.anchors !== "object" || r.anchors === null) return ["anchors must be an object"];
  if (!Array.isArray(r.order)) return ["order must be an array"];

  const errors: string[] = [];
  const topIds = new Set<string>();
  for (const d of r.drawables as Drawable[]) {
    if (typeof d?.id !== "string" || d.id === "") {
      errors.push("every drawable needs a non-empty string id");
      continue;
    }
    if (topIds.has(d.id)) errors.push(`duplicate drawable id "${d.id}"`);
    topIds.add(d.id);
  }
  for (const d of flattenDrawables((r.drawables as Drawable[]).filter((d) => d && typeof d === "object"))) {
    if (d.kind === "stroke" || d.kind === "area") {
      if (!Array.isArray(d.pts) || !d.pts.every(finitePt)) {
        errors.push(`drawable "${d.id}": pts must be finite [x, y] pairs within ±${COORD_BOUND} (bounds/finite check)`);
      }
    } else if (d.kind === "text") {
      if (!finitePt(d.pos)) errors.push(`text "${d.id}": pos must be a finite point (bounds/finite check)`);
      if (typeof d.text !== "string") errors.push(`text "${d.id}": text must be a string`);
    } else if (d.kind === "group") {
      if (!Array.isArray(d.children)) errors.push(`group "${d.id}": children must be an array`);
    } else {
      errors.push(`drawable "${(d as Drawable).id}": unknown kind "${(d as Drawable).kind}"`);
    }
  }

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
