// A derivation as a structure (ledger feature idea 1, Hans 2026-09-25): a
// `math` element lists the lines that follow its `tex` in `steps`, and each
// `{"step": "eq"}` beat writes the next one — the previous line is copied,
// the copy slides down one line and morphs, glyph by glyph, into the next
// TeX, and the beat's narration rides that morph. It is the copy → move →
// morph idiom every derivation used, three commands and a hand-picked offset
// per line, as one field and one verb.
//
// Lines are named `<id>_2`, `<id>_3`, … (the first is the element itself),
// so a later beat can highlight a term of a line (`part`) or circle the
// answer. A step `{tex, note}` also writes a short note to the right of its
// line: `<id>_2_note`. `{"step": {"target": "eq", "in_place": true}}` morphs
// the current line itself instead of writing a new one — a substitution in
// place.
//
// Expanded before layout like `card` and `walk`, so the planner, the lint
// and the export all see the plain commands.

import type { Command, Spec, SpecElement } from "./types";

export type DeriveStep = string | { tex: string; note?: string };

/** The gap between two lines of a derivation, canvas units: about three
 *  times the formula's size (0.467 × size is an x-height; a fraction stands
 *  some five x-heights tall). */
export function stepGap(el: SpecElement): number {
  const size = typeof el.size === "number" ? el.size : typeof el.font_size === "number" ? el.font_size : 28;
  return typeof el.step_gap === "number" && el.step_gap > 0 ? el.step_gap : Math.round(size * 3.2);
}

const texOf = (s: DeriveStep): string => (typeof s === "string" ? s : s.tex);
const noteOf = (s: DeriveStep): string | undefined => (typeof s === "string" ? undefined : s.note);

export function expandDerivations(spec: Spec): Spec {
  const commands = spec.commands ?? [];
  if (!commands.some((c) => c.step !== undefined)) return spec;
  const elements: SpecElement[] = [...(spec.elements ?? [])];
  const byId = new Map(elements.map((e) => [e.id, e]));
  /** Per derivation: the id of its current (last written) line and how many steps are used. */
  const state = new Map<string, { line: string; used: number; lines: number }>();
  const out: Command[] = [];
  for (const cmd of commands) {
    if (cmd.step === undefined) {
      out.push(cmd);
      continue;
    }
    const { step, ...rest } = cmd;
    const target = typeof step === "string" ? step : step.target;
    const inPlace = typeof step === "object" && step.in_place === true;
    const duration = typeof step === "object" && typeof step.duration === "number" ? step.duration : 1.5;
    const el = byId.get(target);
    const steps = (el?.type === "math" && Array.isArray(el.steps) ? el.steps : []) as DeriveStep[];
    const st = state.get(target) ?? { line: target, used: 0, lines: 1 };
    if (!el || st.used >= steps.length) {
      // Nothing to write: left as it is, so the planner reports the beat
      // ("step: …") instead of it vanishing.
      out.push(cmd);
      continue;
    }
    const next = steps[st.used];
    st.used++;
    if (inPlace) {
      out.push({ ...rest, morph: { target: st.line, tex: texOf(next), duration } });
    } else {
      const line = `${target}_${st.lines + 1}`;
      out.push({ copy: { target: st.line, as: line } });
      out.push({ move: { target: line, by: [0, -stepGap(el)], duration: 0.6 } });
      out.push({ ...rest, morph: { target: line, tex: texOf(next), duration } });
      st.line = line;
      st.lines++;
      const note = noteOf(next);
      if (note) {
        const noteId = `${line}_note`;
        const x = typeof el.x === "number" ? el.x : 500;
        const y = typeof el.y === "number" ? el.y : 375;
        elements.push({
          id: noteId,
          type: "text",
          text: note,
          // A column to the right of the lines, level with this one: its
          // left edge `note_dx` right of the formula's centre (text is drawn
          // centred, so the centre goes half an estimated width further).
          x: Math.round(x + (typeof el.note_dx === "number" ? el.note_dx : 220) + 0.26 * 22 * note.length),
          y: y - stepGap(el) * (st.lines - 1),
          font_size: 22,
          style: { color: "#8f887c" },
        } as SpecElement);
        out.push({ draw: [noteId] });
      }
    }
    state.set(target, st);
  }
  return { ...spec, elements, commands: out };
}
