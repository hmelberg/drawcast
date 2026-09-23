// `sound: true` on a note_sheet (design 2026-09-24-music-notation-and-staff
// §7.1): the notes sound as they are drawn. A `draw` of note ids becomes a
// `play` of exactly those tokens, revealing each note (and pressing its key)
// as it sounds — the play + reveal + press choreography the model would
// otherwise have to write in step with its own drawing, derived from what it
// drew. Expanded before layout like cards and walks (spec/expand.ts), so the
// player, lint and export see ordinary commands.
//
// The author wins: a cast that already writes its own play with reveal or
// press is left as it is.

import { parseABC } from "./abc";
import { parseNotation } from "./notation";
import type { Command, Spec } from "./types";

const NOTE_ID = /^(bass_)?note_(\d+)$/;

/** The upper and lower staff's tokens, as note_sheet itself reads its params. */
function tokensOf(params: Record<string, unknown>): { upper: string[]; lower: string[] } {
  let upper = typeof params["notes"] === "string" ? params["notes"] : "";
  let lower = typeof params["bass_notes"] === "string" ? params["bass_notes"] : "";
  if (typeof params["abc"] === "string" && params["abc"].trim() !== "") {
    const tune = parseABC(params["abc"]);
    if (tune.voices[0]) upper = tune.voices[0].notes;
    if (params["clef"] === "grand" && tune.voices[1] && lower === "") lower = tune.voices[1].notes;
  }
  if (upper.trim() === "") upper = params["clef"] === "bass" ? "C3:q D3:q E3:q F3:q G3:q A3:q B3:q C4:q" : "C4:q D4:q E4:q F4:q G4:q A4:q B4:q C5:q";
  const split = (s: string) => (s.trim() === "" ? [] : s.trim().split(/\s+/)).slice(0, 16);
  return { upper: split(upper), lower: split(lower) };
}

export function expandSound(spec: Spec): Spec {
  const params = (spec.params ?? {}) as Record<string, unknown>;
  if (spec.template !== "note_sheet" || params["sound"] !== true) return spec;
  const commands = spec.commands ?? [];
  if (commands.some((c) => c.play !== undefined && (c.reveal !== undefined || c.press !== undefined))) return spec;
  const { upper, lower } = tokensOf(params);
  const sounding = (tok: string | undefined): boolean => tok !== undefined && parseNotation(tok).some((t) => t.pitches.length > 0);
  const keyboard = params["keyboard"] === true;

  const out: Command[] = [];
  for (const cmd of commands) {
    const ids = cmd.draw === undefined ? [] : typeof cmd.draw === "string" ? [cmd.draw] : cmd.draw;
    const notes = ids.map((id) => ({ id, m: NOTE_ID.exec(id) })).filter((x) => x.m !== null);
    if (cmd.draw === undefined || notes.length === 0) {
      out.push(cmd);
      continue;
    }
    const upperIds = notes.filter((x) => !x.m![1]).map((x) => ({ id: x.id, i: Number(x.m![2]) }));
    const lowerIds = notes.filter((x) => x.m![1]).map((x) => ({ id: x.id, i: Number(x.m![2]) }));
    // The voice that is revealed in step: the upper staff's, unless the beat draws only the lower.
    const leadIsLower = upperIds.length === 0;
    const lead = leadIsLower ? lowerIds : upperIds;
    const leadTokens = leadIsLower ? lower : upper;
    const follow = leadIsLower ? [] : lowerIds;
    const soundingLead = lead.filter((n) => sounding(leadTokens[n.i]));
    // Drawn quietly at the start: everything that is not a sounding lead note
    // (the staff, rests, the other hand).
    const quiet = [...ids.filter((id) => !NOTE_ID.test(id)), ...lead.filter((n) => !sounding(leadTokens[n.i])).map((n) => n.id), ...follow.map((n) => n.id)];
    const { draw: _draw, parallel: _parallel, ...rest } = cmd;
    if (quiet.length > 0) out.push({ draw: quiet });
    if (soundingLead.length === 0) {
      if (cmd.speak !== undefined) out.push({ ...rest });
      continue;
    }
    const voices = [
      { notes: lead.map((n) => leadTokens[n.i]).filter((t): t is string => t !== undefined).join(" ") },
      ...(follow.length > 0 ? [{ notes: follow.map((n) => lower[n.i]).filter((t): t is string => t !== undefined).join(" ") }] : []),
    ];
    out.push({
      ...rest,
      play: voices.length === 1 ? voices[0].notes : voices,
      instrument: cmd.instrument ?? "piano",
      reveal: soundingLead.map((n) => n.id),
      ...(keyboard ? { press: soundingLead.map((n) => (leadIsLower ? `bass_key_${n.i}` : `key_${n.i}`)) } : {}),
    });
  }
  return { ...spec, commands: out };
}
