// Effect validation for widget bodies (spec §2.2): a body may return anything;
// only well-formed effects reach the host, and every rejection is named so
// the harness and the console can say what was dropped.
import type { EditField } from "./widget-types";

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

/** A number field a body's `editable` hook asked for (widget-types.ts
 *  EditField), checked like an effect: a body may return anything, and only
 *  a well-formed field reaches the DOM. Null with the reasons otherwise. */
export function validateEditField(raw: unknown): { field: EditField | null; issues: string[] } {
  if (raw === null || raw === undefined) return { field: null, issues: [] };
  if (typeof raw !== "object" || Array.isArray(raw)) return { field: null, issues: ["editable must return an object or null"] };
  const e = raw as Record<string, unknown>;
  const issues: string[] = [];
  const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
  if (!finite(e.value)) issues.push("editable: value must be a finite number");
  if (typeof e.label !== "string" || e.label.trim() === "") issues.push("editable: label must be a non-empty string (the field's aria-label)");
  for (const k of ["min", "max", "step"] as const) if (e[k] !== undefined && !finite(e[k])) issues.push(`editable: ${k} must be a finite number`);
  if (finite(e.step) && e.step <= 0) issues.push("editable: step must be above 0");
  if (finite(e.min) && finite(e.max) && e.min > e.max) issues.push("editable: min is above max");
  const b = e.box as Record<string, unknown> | undefined;
  const boxOk = b === undefined || (typeof b === "object" && b !== null && ["x", "y", "w", "h"].every((k) => finite(b[k])) && (b.w as number) > 0 && (b.h as number) > 0);
  if (!boxOk) issues.push("editable: box must be {x, y, w, h} with w and h above 0");
  if (issues.length > 0) return { field: null, issues };
  return {
    field: {
      value: e.value as number,
      label: (e.label as string).trim(),
      ...(finite(e.min) ? { min: e.min } : {}),
      ...(finite(e.max) ? { max: e.max } : {}),
      ...(finite(e.step) ? { step: e.step } : {}),
      ...(b ? { box: { x: b.x as number, y: b.y as number, w: b.w as number, h: b.h as number } } : {}),
    },
    issues: [],
  };
}

/** The viewer's typed text as the number a field takes, or why not: a
 *  decimal comma reads as a point ("0,25"), a trailing % divides by 100 only
 *  when the field is a share (max ≤ 1), and a number outside the field's
 *  bounds is rejected — never clamped, so what lands is what was typed. */
export function parseFieldValue(text: string, field: Pick<EditField, "min" | "max">): { value: number } | { error: string } {
  let t = text.trim().replace(/−/g, "-").replace(/\s/g, "");
  if (t === "") return { error: "empty" };
  let pct = false;
  if (t.endsWith("%")) {
    pct = true;
    t = t.slice(0, -1);
  }
  // One comma and no point: a decimal comma. Otherwise commas group thousands.
  t = /^[^.]*,[^,.]*$/.test(t) && (!/,\d{3}$/.test(t) || /^[-+]?0,/.test(t)) ? t.replace(",", ".") : t.replace(/,/g, "");
  if (!/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(t)) return { error: "not a number" };
  let v = Number(t);
  if (!Number.isFinite(v)) return { error: "not a number" };
  if (pct && field.max !== undefined && field.max <= 1) v /= 100;
  if (field.min !== undefined && v < field.min - 1e-12) return { error: `at least ${field.min}` };
  if (field.max !== undefined && v > field.max + 1e-12) return { error: `at most ${field.max}` };
  return { value: v };
}
