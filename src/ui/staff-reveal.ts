// After a staff question is answered, WRITE the note on the staff: a real
// notehead from the music font (with its stem, a sharp if it has one, and
// ledger lines beyond the staff), at the correct pitch and just where the
// viewer clicked — the moment that ties the sound to the written note. A
// wrong guess is written too, faint and red, so the distance shows ("two
// steps too low"). Drawn straight into the figure's own svg, in its own
// coordinates, so it sits on the staff whatever the camera does; the
// caller removes it when the question moves on.

import { CANVAS } from "../layout/canvas";
import { getLoadedEngines, type MusicEngine } from "../scenes/engines";
import { staffYOf, diatOf, type Staff } from "./staffplay-model";

const SVG_NS = "http://www.w3.org/2000/svg";

type Pt = [number, number];

/**
 * Write `pitch` on `staff` at logical x `x`. `tone` picks the ink: the
 * correct note in the figure's ink, a wrong guess in the loss colour, faint.
 * Returns the remover. A no-op (and a no-op remover) off a mounted figure.
 */
export function writeStaffNote(stage: HTMLElement, staff: Staff, pitch: string, x: number, tone: "answer" | "guess"): () => void {
  const svg = stage.querySelector<SVGSVGElement>("svg.cs-svg");
  let music: MusicEngine;
  try {
    music = getLoadedEngines(["music"]).music as MusicEngine;
  } catch {
    return () => {};
  }
  if (!svg) return () => {};
  const y = staffYOf(staff, pitch);
  const sp = staff.gap;
  const up = y < staff.bottom + 2 * staff.gap; // low on the staff: stem up
  const n = music.note("quarter", [x, y], sp, { stem: up ? "up" : "down" });
  const toSvg = ([px, py]: Pt): string => `${px.toFixed(2)} ${(CANVAS.h - py).toFixed(2)}`;
  const ring = (r: Pt[]): string => `M${r.map(toSvg).join("L")}Z`;

  const g = document.createElementNS(SVG_NS, "g");
  g.setAttribute("class", `cs-staff-reveal ${tone}`);
  g.style.pointerEvents = "none";
  const fill = (shape: { pts: Pt[]; holes?: Pt[][] }): void => {
    const p = document.createElementNS(SVG_NS, "path");
    p.setAttribute("d", [shape.pts, ...(shape.holes ?? [])].map(ring).join(""));
    p.setAttribute("fill-rule", "evenodd");
    p.setAttribute("fill", "currentColor");
    g.appendChild(p);
  };
  const line = (a: Pt, b: Pt, w: number): void => {
    const l = document.createElementNS(SVG_NS, "line");
    const [ax, ay] = toSvg(a).split(" ");
    const [bx, by] = toSvg(b).split(" ");
    l.setAttribute("x1", ax);
    l.setAttribute("y1", ay);
    l.setAttribute("x2", bx);
    l.setAttribute("y2", by);
    l.setAttribute("stroke", "currentColor");
    l.setAttribute("stroke-width", String(w));
    g.appendChild(l);
  };

  // Ledger lines for a note beyond the staff — the lines it sits on or passes.
  const half = (music.bboxOf("noteheadBlack")[2] / 2 + music.defaults.legerLineExtension) * sp;
  for (let ly = staff.bottom - sp; ly >= y - sp / 4; ly -= sp) line([x - half, ly], [x + half, ly], 2.5);
  for (let ly = staff.bottom + 5 * sp; ly <= y + sp / 4; ly += sp) line([x - half, ly], [x + half, ly], 2.5);
  fill(n.head);
  if (n.stem) line(n.stem.from, n.stem.to, Math.max(2.5, n.stem.width));
  if (pitch.includes("#")) fill(music.glyphCentered("accidentalSharp", [x - (music.bboxOf("noteheadBlack")[2] / 2 + 0.9) * sp, y], sp));
  svg.appendChild(g);
  return () => g.remove();
}

/** The staff a pitch belongs on, of those drawn: on a grand staff, below middle C goes to the bass staff. */
export function staffFor(staves: Staff[], pitch: string, preferred?: string): Staff | undefined {
  const named = staves.find((s) => s.id === preferred);
  if (named) return named;
  if (staves.length > 1) return diatOf(pitch.replace("#", "")) < 28 ? staves.find((s) => s.id === "bass_staff") : staves[0];
  return staves[0];
}
