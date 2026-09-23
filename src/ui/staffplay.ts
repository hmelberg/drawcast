// The staff as an instrument (design 2026-09-24-music-notation-and-staff §5):
// while paused, a click on a note_sheet's staff sounds that pitch, and a
// click to the RIGHT of the last note also writes it there — so does a key
// of the keyboard under the staff. What the viewer writes follows the
// authored melody (decision 3.5) in the accent ink, through the param
// machinery (a `notes` preview with `draft_from`), so free play stays an
// excursion: play, a step or a scrub restores the lesson untouched.
//
// Everything happens on the figure (decision 3.3): the control row sits
// UNDER the staff (3.4) — durations, rest, play, undo, clear, instrument —
// and the keys 1–5, 0, ⌫ and ↵ do the same. Space is left alone: it resumes
// the lesson, which would discard the draft.

import type { RenderHandle } from "../render";
import { sceneAt } from "../render/plan";
import { withOverrides } from "../render/params";
import { parseABC } from "../spec/abc";
import { INSTRUMENTS, type Instrument } from "../spec/notation";
import { clientPointFor, h, logicalPoint } from "./dom";
import { gateIsOpen } from "./gates";
import { getLoadedEngines, type MusicEngine } from "../scenes/engines";
import type { NoteValue } from "../scenes/music/geometry";
import {
  authoredLine, clear, draftParams, DURATIONS, keyboardStartOctave, lastNoteRight, sheetKeyAt, staffPitchAt, stavesOf, tokensOf, undo, write,
  diatOf, type Draft, type Duration, type Staff,
} from "./staffplay-model";

/** What the viewer has composed on a stage's staff, for an explore beat's `store`. */
const composers = new WeakMap<HTMLElement, () => string | null>();
export function composedOn(stage: HTMLElement): string | null {
  return composers.get(stage)?.() ?? null;
}

const VALUE: Record<Duration, NoteValue> = { w: "whole", h: "half", q: "quarter", e: "eighth", s: "sixteenth" };
const SVG_NS = "http://www.w3.org/2000/svg";

/** A button icon drawn from the music font itself — the Unicode music
 *  characters are missing from most text fonts (they rendered as ≡). */
function glyphIcon(shapes: { pts: [number, number][]; holes?: [number, number][][] }[], stem: { from: [number, number]; to: [number, number]; width: number } | null): SVGSVGElement {
  const all = [...shapes.flatMap((g) => [g.pts, ...(g.holes ?? [])]), ...(stem ? [[stem.from, stem.to]] : [])].flat();
  const xs = all.map((p) => p[0]), ys = all.map((p) => p[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const pad = 0.2;
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", `${x0 - pad} ${-y1 - pad} ${x1 - x0 + 2 * pad} ${y1 - y0 + 2 * pad}`);
  svg.setAttribute("class", "cs-staffrow-icon");
  const ring = (r: [number, number][]) => `M${r.map(([x, y]) => `${x.toFixed(3)} ${(-y).toFixed(3)}`).join("L")}Z`;
  for (const g of shapes) {
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", [g.pts, ...(g.holes ?? [])].map(ring).join(""));
    path.setAttribute("fill-rule", "evenodd");
    path.setAttribute("fill", "currentColor");
    svg.appendChild(path);
  }
  if (stem) {
    const line = document.createElementNS(SVG_NS, "line");
    line.setAttribute("x1", String(stem.from[0]));
    line.setAttribute("y1", String(-stem.from[1]));
    line.setAttribute("x2", String(stem.to[0]));
    line.setAttribute("y2", String(-stem.to[1]));
    line.setAttribute("stroke", "currentColor");
    line.setAttribute("stroke-width", String(stem.width * 1.4));
    svg.appendChild(line);
  }
  return svg;
}

export function attachStaffPlay(stage: HTMLElement, hd: RenderHandle): void {
  let drafts: Partial<Record<Staff["id"], Draft>> = {};
  let lastStaff: Staff["id"] = "staff";
  let duration: Duration = "q";
  let instrument: Instrument = "piano";
  let row: HTMLElement | null = null;
  let note: HTMLElement | null = null;

  /** The params the boundary shows — what the viewer continues from. */
  const boundaryParams = (): Record<string, unknown> => withOverrides(hd.spec.params, sceneAt(hd.plan, hd.timeline.position).params) as Record<string, unknown>;
  const layoutNow = () => hd.timeline.paintedLayout() ?? hd.layout;
  const abcVoices = (p: Record<string, unknown>) => (typeof p["abc"] === "string" && p["abc"].trim() !== "" ? parseABC(p["abc"]).voices : undefined);

  const sound = (notes: string): void => {
    try {
      hd.timeline.tones?.play([{ notes, instrument }], 110);
    } catch {
      /* silent */
    }
  };

  const draftOf = (id: Staff["id"]): Draft => {
    const have = drafts[id];
    if (have) return have;
    const p = boundaryParams();
    return { authored: tokensOf(authoredLine(p, id, abcVoices(p))), written: [] };
  };

  /** Repaint the staves with what is written — both, so neither snaps back. */
  const repaint = (): void => {
    const o: Record<string, unknown> = { abc: "" };
    const top = drafts.staff, bass = drafts.bass_staff;
    if (top) {
      const d = draftParams(top);
      Object.assign(o, { notes: d.notes, draft_from: d.from });
    }
    if (bass) {
      const d = draftParams(bass);
      Object.assign(o, { bass_notes: d.notes, bass_draft_from: d.from });
    }
    hd.timeline.previewParams(o, { revealNew: true });
  };

  const say = (text: string): void => {
    if (!note) return;
    note.textContent = text;
    note.hidden = text === "";
  };

  const writeOn = (id: Staff["id"], token: string): void => {
    const next = write(draftOf(id), token);
    if (!next) {
      showRow();
      say("Staff full — ↺ to start over");
      return;
    }
    drafts = { ...drafts, [id]: next };
    lastStaff = id;
    repaint();
    showRow();
    say("");
  };

  const placeRow = (): void => {
    if (!row) return;
    const staves = stavesOf(layoutNow().drawables, boundaryParams()["clef"]);
    if (staves.length === 0) return;
    // Under the lowest staff, below its letter names (68 units under the
    // bottom line); with keys below, centred in the band between the names
    // and the keys' top edge (about y 312). Scaled to the stage, so a small
    // preview gets a small row rather than one that covers the keys.
    // The row's TOP edge sits just under the names, measured in the
    // stage's own units — on a small stage it may then overlap the keys'
    // top edge a little, which beats hiding the letters.
    const low = Math.min(...staves.map((s) => s.bottom));
    const namesBottom = low - 80;
    const scale = Math.min(1, stage.clientWidth / 620);
    const at = clientPointFor(stage, [500, namesBottom]);
    if (!at) return;
    row.style.left = `${at[0]}px`;
    row.style.top = `${at[1]}px`;
    row.style.transform = `translate(-50%, 0) scale(${scale.toFixed(3)})`;
  };

  const showRow = (): void => {
    if (row) return placeRow();
    row = h("div", { class: "cs-staffrow" });
    row.addEventListener("pointerdown", (e) => e.stopPropagation());
    row.addEventListener("click", (e) => e.stopPropagation());
    const M = getLoadedEngines(["music"]).music as MusicEngine; // a staff on screen means it is loaded
    const durBtns = DURATIONS.map((d) => {
      const n = M.note(VALUE[d], [0, 0], 1, { stem: "up" });
      const b = h("button", { class: "cs-staffrow-btn", title: `${VALUE[d]} note (${DURATIONS.indexOf(d) + 1})` });
      b.appendChild(glyphIcon([n.head, ...(n.flag ? [n.flag] : [])], n.stem));
      b.addEventListener("click", () => setDuration(d));
      return b;
    });
    const markDur = (): void => durBtns.forEach((b, i) => b.classList.toggle("on", DURATIONS[i] === duration));
    setDuration = (d: Duration) => {
      duration = d;
      markDur();
    };
    markDur();
    const rest = h("button", { class: "cs-staffrow-btn", title: "rest (0)" });
    rest.appendChild(glyphIcon([M.glyphCentered("restQuarter", [0, 0], 1)], null));
    rest.addEventListener("click", () => writeOn(lastStaff, `R:${duration}`));
    const play = h("button", { class: "cs-staffrow-btn", title: "play what is written (↵)" }, "▶");
    play.addEventListener("click", () => playWritten());
    const back = h("button", { class: "cs-staffrow-btn", title: "undo (⌫)" }, "↶");
    back.addEventListener("click", () => undoLast());
    const wipe = h("button", { class: "cs-staffrow-btn", title: "start over on an empty staff" }, "↺");
    wipe.addEventListener("click", () => {
      drafts = Object.fromEntries(stavesOf(layoutNow().drawables, boundaryParams()["clef"]).map((s) => [s.id, clear()]));
      repaint();
      say("");
    });
    const inst = h("select", { class: "cs-menu-select cs-staffrow-inst", "aria-label": "Instrument" }) as HTMLSelectElement;
    for (const i of INSTRUMENTS) inst.appendChild(h("option", { value: i }, i));
    inst.value = instrument;
    inst.addEventListener("change", () => {
      instrument = inst.value as Instrument;
    });
    note = h("span", { class: "cs-staffrow-note", hidden: "" });
    row.append(...durBtns, rest, play, back, wipe, inst, note);
    stage.appendChild(row);
    placeRow();
  };
  let setDuration = (d: Duration): void => {
    duration = d;
  };

  const playWritten = (): void => {
    const top = draftParams(draftOf("staff")).notes;
    const bass = drafts.bass_staff ? draftParams(drafts.bass_staff).notes : "";
    const voices = [{ notes: top, instrument }, ...(bass ? [{ notes: bass, instrument }] : [])].filter((v) => v.notes !== "");
    if (voices.length === 0) return;
    try {
      hd.timeline.tones?.play(voices, 100);
    } catch {
      /* silent */
    }
  };

  const undoLast = (): void => {
    const d = drafts[lastStaff];
    if (!d || d.written.length === 0) return;
    drafts = { ...drafts, [lastStaff]: undo(d) };
    repaint();
    say("");
  };

  const reset = (): void => {
    drafts = {};
    row?.remove();
    row = null;
    note = null;
  };
  // Playback, a step or a scrub lands honest geometry: the draft is gone
  // (the timeline already dropped the preview). Chained, never replaced.
  const prevOnState = hd.timeline.callbacks.onState;
  hd.timeline.callbacks.onState = (s) => {
    prevOnState?.(s);
    if (s === "playing") reset();
  };
  const prevOnStep = hd.timeline.callbacks.onStep;
  hd.timeline.callbacks.onStep = (completed, total) => {
    prevOnStep?.(completed, total);
    reset();
  };

  const blocked = (e: Event): boolean =>
    hd.timeline.state === "playing" ||
    (e.target instanceof Element && (e.target.closest("button") !== null || e.target.closest(".cs-staffrow") !== null)) ||
    gateIsOpen(stage);

  stage.addEventListener(
    "pointerdown",
    (e) => {
      if (blocked(e)) return;
      const p = logicalPoint(stage, e);
      if (!p) return;
      const layout = layoutNow();
      const params = boundaryParams();
      const staves = stavesOf(layout.drawables, params["clef"]);
      const hit = staffPitchAt(staves, p);
      if (hit) {
        e.stopPropagation();
        e.preventDefault();
        sound(`${hit.pitch}:${duration}`);
        // Right of the last note: write it. Elsewhere on the staff: only hear it.
        if (p[0] > lastNoteRight(layout.drawables, hit.staff) + 4) writeOn(hit.staff.id, `${hit.pitch}:${duration}`);
        return;
      }
      if (!layout.drawables.some((d) => d.id === "keys")) return;
      const shown = [draftParams(draftOf("staff")).notes, drafts.bass_staff ? draftParams(drafts.bass_staff).notes : authoredLine(params, "bass_staff", abcVoices(params))];
      const key = sheetKeyAt(layout.drawables, keyboardStartOctave(shown), p);
      if (!key) return;
      e.stopPropagation();
      e.preventDefault();
      sound(`${key}:${duration}`);
      // Below middle C goes to a grand staff's bass staff; everything else to the upper one.
      const onBass = staves.some((s) => s.id === "bass_staff") && diatOf(key.replace("#", "")) < 28;
      writeOn(onBass ? "bass_staff" : "staff", `${key}:${duration}`);
    },
    true,
  );
  // The synthesized click after a staff or key press must not resume playback.
  stage.addEventListener(
    "click",
    (e) => {
      if (blocked(e)) return;
      const p = logicalPoint(stage, e);
      if (!p) return;
      const layout = layoutNow();
      if (staffPitchAt(stavesOf(layout.drawables, boundaryParams()["clef"]), p)) e.stopPropagation();
      else if (layout.drawables.some((d) => d.id === "keys") && sheetKeyAt(layout.drawables, 4, p) !== null) e.stopPropagation();
    },
    true,
  );

  const onKey = (e: KeyboardEvent): void => {
    if (!stage.isConnected) {
      window.removeEventListener("keydown", onKey);
      return;
    }
    if (hd.timeline.state === "playing" || gateIsOpen(stage)) return;
    if (e.target instanceof Element && e.target.closest("input, textarea, select, [contenteditable]")) return;
    const k = DURATIONS[Number(e.key) - 1];
    if (k) {
      setDuration(k);
      e.preventDefault();
    } else if (e.key === "0" && Object.keys(drafts).length > 0) {
      writeOn(lastStaff, `R:${duration}`);
      e.preventDefault();
    } else if (e.key === "Backspace" && Object.keys(drafts).length > 0) {
      undoLast();
      e.preventDefault();
    } else if (e.key === "Enter" && Object.keys(drafts).length > 0) {
      playWritten();
      e.preventDefault();
    }
  };
  window.addEventListener("keydown", onKey);

  composers.set(stage, () => (drafts.staff || drafts.bass_staff ? draftParams(draftOf("staff")).notes : null));
}
