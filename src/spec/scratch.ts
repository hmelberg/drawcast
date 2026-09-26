// A scratch card (Hans 2026-09-26): "show some temporary information or
// calculation that we may either erase or fade out or put in the corner
// afterwards … a temporary box with rounded corners … we may have more than
// one of those." One element — `{"type": "scratch", "work": [...]}` (scratch
// paper; `note` is taken, the script syntax's word for text) — expanded
// before layout into ordinary elements: a rounded card on translucent paper
// (`<id>_box`) and one text or formula per line (`<id>_line_1`, …), grouped
// as `<id>`. A beat draws the box and the first line, the next beats add a
// line each while the narration builds the sum; afterwards the ordinary
// verbs retire it — erase, fade, or a move with `scale` into a corner.
//
// Expanded like `card` and `step`, so the planner, the lint and the export
// see plain elements. Sizes are estimated from the characters (no measurer
// before layout): generous, since a card a little too wide is harmless and
// one too narrow is not. The lines are `work` ("show your work"; `lines` is
// the code panel's window height); the corner is the usual `at: {place}`.

import type { Spec, SpecElement } from "./types";

export type NoteLine = string | { tex: string };

const PAD = 18;
const RADIUS = 14;

const PLACES = ["top_left", "top_right", "bottom_left", "bottom_right", "center"] as const;

/** A rounded rectangle as a closed polyline: quarter circles at the corners. */
function roundedRect(cx: number, cy: number, w: number, h: number, r: number): [number, number][] {
  const pts: [number, number][] = [];
  const corner = (x: number, y: number, a0: number) => {
    for (let i = 0; i <= 6; i++) {
      const a = a0 + (Math.PI / 2) * (i / 6);
      pts.push([x + r * Math.cos(a), y + r * Math.sin(a)]);
    }
  };
  const [x0, x1, y0, y1] = [cx - w / 2, cx + w / 2, cy - h / 2, cy + h / 2];
  corner(x1 - r, y1 - r, 0); // top right (y up)
  corner(x0 + r, y1 - r, Math.PI / 2); // top left
  corner(x0 + r, y0 + r, Math.PI); // bottom left
  corner(x1 - r, y0 + r, (3 * Math.PI) / 2); // bottom right
  return pts.map(([x, y]) => [Math.round(x * 10) / 10, Math.round(y * 10) / 10]);
}

export function expandScratch(spec: Spec): Spec {
  const els = spec.elements ?? [];
  if (!els.some((e) => e.type === "scratch")) return spec;
  const out: SpecElement[] = [];
  for (const el of els) {
    if (el.type !== "scratch") {
      out.push(el);
      continue;
    }
    const lines = (Array.isArray(el.work) ? el.work : []) as NoteLine[];
    const size = typeof el.font_size === "number" ? el.font_size : 24;
    const lineH = Math.round(size * 1.9);
    // A formula is measured by what shows: \text{…} keeps its letters, a
    // command (\times, \approx) is one glyph, braces and scripts are nothing.
    const texChars = (tex: string) =>
      tex
        .replace(/\\text\{([^}]*)\}/g, "$1")
        .replace(/\\[a-zA-Z]+/g, "x")
        .replace(/[{}_^\s]/g, "").length +
      (tex.match(/\s*[=+\-×]\s*|\\(times|approx|cdot)/g)?.length ?? 0);
    const widthOf = (l: NoteLine) =>
      typeof l === "string" ? l.length * size * 0.46 : texChars(l.tex) * size * 0.42;
    const w = Math.max(160, ...lines.map(widthOf)) + 2 * PAD;
    const h = Math.max(1, lines.length) * lineH + 2 * PAD - (lineH - size * 1.2);
    // Where: an explicit centre, or a named corner of the page under the
    // heading strip (the band figures use: y 95–655).
    const at = el.at as { place?: unknown } | undefined;
    const place = typeof at?.place === "string" && (PLACES as readonly string[]).includes(at.place) ? at.place : null;
    const cx =
      typeof el.x === "number" ? el.x : place?.endsWith("left") ? 60 + w / 2 : place?.endsWith("right") ? 940 - w / 2 : 500;
    const cy =
      typeof el.y === "number" ? el.y : place?.startsWith("top") ? 655 - h / 2 : place?.startsWith("bottom") ? 95 + h / 2 : 375;
    const members: string[] = [`${el.id}_box`];
    out.push({
      id: `${el.id}_box`,
      type: "path",
      points: roundedRect(cx, cy, w, h, RADIUS),
      closed: true,
      style: { color: "#8f887c", fill: "#fdfbf5", opacity: 0.92, ...(el.style ?? {}) },
      ...(el.app_only ? { app_only: true } : {}),
    } as SpecElement);
    const top = cy + h / 2 - PAD - size * 0.6;
    lines.forEach((l, i) => {
      const id = `${el.id}_line_${i + 1}`;
      members.push(id);
      const y = Math.round(top - i * lineH);
      out.push(
        typeof l === "string"
          ? ({ id, type: "text", text: l, x: cx, y, font_size: size } as SpecElement)
          // A formula reads smaller than words at one nominal size.
          : ({ id, type: "math", tex: l.tex, x: cx, y, size: Math.round(size * 1.25) } as SpecElement),
      );
    });
    out.push({ id: el.id, type: "group", members } as SpecElement);
  }
  return { ...spec, elements: out };
}
