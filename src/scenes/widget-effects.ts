// Effect validation for widget bodies (spec §2.2): a body may return anything;
// only well-formed effects reach the host, and every rejection is named so
// the harness and the console can say what was dropped.
export type WidgetSound = { hz: number; ms: number } | { notes: string; tempo?: number };

export interface WidgetEffect {
  patch?: Record<string, unknown>;
  sound?: WidgetSound;
  glow?: string[];
  color?: string;
  pointer?: string;
  caption?: string;
  answer?: string;
}

const KEYS = new Set(["patch", "sound", "glow", "color", "pointer", "caption", "answer"]);

export function validateEffects(raw: unknown, scene: { ids: string[]; paramNames: string[] }): { effects: WidgetEffect[]; issues: string[] } {
  const issues: string[] = [];
  if (!Array.isArray(raw)) return { effects: [], issues: ["effects must be an array"] };
  const parts = new Set(scene.ids);
  const effects: WidgetEffect[] = [];
  raw.forEach((item, i) => {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      issues.push(`effects[${i}] must be an object`);
      return;
    }
    const e = item as Record<string, unknown>;
    const out: WidgetEffect = {};
    for (const k of Object.keys(e)) if (!KEYS.has(k)) issues.push(`unknown effect key "${k}"`);
    if (e.patch !== undefined) {
      if (typeof e.patch !== "object" || e.patch === null || Array.isArray(e.patch)) issues.push("patch must be an object of params");
      else {
        const p: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(e.patch as Record<string, unknown>)) {
          if (scene.paramNames.includes(k)) p[k] = v;
          else issues.push(`patch: "${k}" is not a template param (${scene.paramNames.join(", ")})`);
        }
        out.patch = p;
      }
    }
    if (e.sound !== undefined) {
      const s = e.sound as { hz?: unknown; ms?: unknown; notes?: unknown; tempo?: unknown } | null;
      if (typeof s === "object" && s !== null && typeof s.hz === "number" && typeof s.ms === "number") out.sound = { hz: s.hz, ms: s.ms };
      else if (typeof s === "object" && s !== null && typeof s.notes === "string") out.sound = { notes: s.notes, ...(typeof s.tempo === "number" ? { tempo: s.tempo } : {}) };
      else issues.push("sound needs { hz, ms } or { notes, tempo? }");
    }
    if (e.glow !== undefined) {
      const ids = (Array.isArray(e.glow) ? e.glow : [e.glow]).filter((id): id is string => typeof id === "string");
      const known = ids.filter((id) => parts.has(id));
      for (const id of ids) if (!parts.has(id)) issues.push(`glow: "${id}" is not a part`);
      if (known.length > 0) out.glow = known;
      if (typeof e.color === "string") out.color = e.color;
    }
    if (e.pointer !== undefined) {
      if (typeof e.pointer === "string" && parts.has(e.pointer)) out.pointer = e.pointer;
      else issues.push(`pointer: "${String(e.pointer)}" is not a part`);
    }
    if (e.caption !== undefined) {
      if (typeof e.caption === "string") out.caption = e.caption;
      else issues.push("caption must be a string");
    }
    if (e.answer !== undefined) {
      if (typeof e.answer === "string") out.answer = e.answer;
      else issues.push("answer must be a string");
    }
    if (Object.keys(out).length > 0) effects.push(out);
  });
  return { effects, issues };
}
