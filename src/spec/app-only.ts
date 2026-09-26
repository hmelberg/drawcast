// `app_only` elements are for the live player — a "The math ▸" note a viewer
// can click — and have no meaning in a movie, where nobody can click. The
// export strips them before anything else sees the spec: the element, the
// labels attached to it, its place in groups, and every command's mention of
// it. A command left with nothing to do keeps its narration as a plain line
// (a sentence is never lost with the button beside it); one left with neither
// is dropped.

import type { Spec, SpecElement } from "./types";

/** Keys that hold a command's verb (everything a command does besides speak). */
const META = new Set(["speak", "voice", "delivery", "cue", "cue_end", "blocking", "parallel", "duration", "easing", "label"]);

export function stripAppOnly(spec: Spec): Spec {
  const gone = new Set((spec.elements ?? []).filter((e) => e.app_only === true).map((e) => e.id));
  if (gone.size === 0) return spec;
  // Labels of a stripped element go with it.
  for (const e of spec.elements ?? []) if (e.type === "label" && typeof e.attach_to === "string" && gone.has(e.attach_to)) gone.add(e.id);

  const elements: SpecElement[] = (spec.elements ?? [])
    .filter((e) => !gone.has(e.id))
    .map((e) => (Array.isArray(e.members) ? { ...e, members: e.members.filter((m: string) => !gone.has(m)) } : e));

  /** A verb's value with the stripped ids filtered out, or null when it names one by ref or is left empty. */
  const clean = (v: unknown): unknown => {
    if (typeof v === "string") return gone.has(v) ? null : v;
    if (Array.isArray(v)) {
      const kept = v.map(clean).filter((x) => x !== null);
      return kept.length === 0 && v.length > 0 ? null : kept;
    }
    if (v !== null && typeof v === "object") {
      const o = v as Record<string, unknown>;
      if (typeof o.ref === "string" && gone.has(o.ref)) return null;
      const out: Record<string, unknown> = {};
      for (const [k, x] of Object.entries(o)) {
        const c = clean(x);
        // A target list emptied means the verb has nothing left to act on.
        // …and one that pointed AT a stripped element (a point, a move's `to`)
        // would mean something else without it.
        if (c === null && (k === "target" || k === "at" || k === "along" || (x !== null && typeof x === "object" && !Array.isArray(x)))) return null;
        if (c !== null) out[k] = c;
      }
      return out;
    }
    return v;
  };

  const commands = (spec.commands ?? []).flatMap((cmd) => {
    const out: Record<string, unknown> = {};
    let verbs = 0;
    for (const [k, v] of Object.entries(cmd as Record<string, unknown>)) {
      if (META.has(k)) {
        out[k] = v;
        continue;
      }
      const c = clean(v);
      if (c !== null) {
        out[k] = c;
        verbs++;
      }
    }
    if (verbs > 0) return [out];
    if (typeof out.speak === "string") return [{ speak: out.speak, ...(out.voice ? { voice: out.voice } : {}), ...(out.delivery ? { delivery: out.delivery } : {}) }];
    return typeof out.label === "string" ? [{ label: out.label }] : [];
  });
  return { ...spec, elements, commands: commands as Spec["commands"] };
}
