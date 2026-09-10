// Definitional references (design 2026-09-10 §2.5): the element ids an
// element is DEFINED by — an intersection's curves, a region's curves, an
// arrow's endpoints, an angle's vertex and arms, a line's points, a point on
// a curve. When one of those moves, the element is recomputed. Placement
// (`at`), labels (`attach_to`) and group membership are not definitions and
// are deliberately absent; so is `measure`, which follows through the
// planner's own recompute (render/plan.ts measureUpdates).
import type { SpecElement } from "./types";

function refOf(v: unknown): string | null {
  return typeof v === "object" && v !== null && !Array.isArray(v) && typeof (v as { ref?: unknown }).ref === "string" ? (v as { ref: string }).ref : null;
}

export function definitionalRefs(el: SpecElement): string[] {
  const out: string[] = [];
  const add = (id: string | null | undefined) => {
    if (typeof id === "string" && id !== "" && !out.includes(id)) out.push(id);
  };
  const at = el.at as { intersection_of?: unknown; on?: unknown } | undefined;
  switch (el.type) {
    case "point":
      if (Array.isArray(at?.intersection_of)) for (const id of at!.intersection_of as unknown[]) add(typeof id === "string" ? id : null);
      if (typeof at?.on === "string") add(at.on);
      break;
    case "region":
      for (const id of el.between ?? []) add(id);
      break;
    case "arrow":
    case "edge":
      add(refOf(el.from));
      add(refOf(el.to));
      break;
    case "angle":
      add(refOf(el.at));
      add(refOf(el.from));
      add(refOf(el.to));
      break;
    case "line":
      for (const p of el.through ?? []) add(refOf(p));
      break;
  }
  return out;
}

/** source id → every element that depends on it, directly or through others, in spec order (never the source itself). */
export function dependentsMap(elements: SpecElement[]): Map<string, string[]> {
  const direct = new Map<string, string[]>();
  for (const el of elements) {
    for (const ref of definitionalRefs(el)) {
      const list = direct.get(ref) ?? [];
      if (!list.includes(el.id)) list.push(el.id);
      direct.set(ref, list);
    }
  }
  const order = new Map(elements.map((el, i) => [el.id, i]));
  const out = new Map<string, string[]>();
  for (const src of direct.keys()) {
    const seen = new Set<string>();
    const queue = [...(direct.get(src) ?? [])];
    while (queue.length > 0) {
      const id = queue.shift()!;
      if (id === src || seen.has(id)) continue;
      seen.add(id);
      queue.push(...(direct.get(id) ?? []));
    }
    out.set(src, [...seen].sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0)));
  }
  return out;
}

/** Every id something is defined by, in order of first use. */
export function sourceIds(elements: SpecElement[]): string[] {
  const out: string[] = [];
  for (const el of elements) for (const ref of definitionalRefs(el)) if (!out.includes(ref)) out.push(ref);
  return out;
}
