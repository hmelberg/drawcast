// The small card renderer (card lab, 2026-10-05): a compiled card (card/
// types.ts) as an SVG string, with no DOM and no engine — the same function
// on the front page and on the server. The drawing wobbles as the cast does:
// rough.js with the engine's own seed per element (render/svg-backend.ts
// roughOpts), so a card looks the same on every visit. The marks over it are
// thumb.mts's own, so a card matches the server-drawn listing pictures.

import { RoughGenerator } from "roughjs/bin/generator";
import type { Options as RoughOptions } from "roughjs/bin/core";
import { thumbSvg, type Corner } from "../../netlify/lib/thumb.mts";
import { CARD_H, CARD_W, type CardArea, type CardIcon, type CardItem, type CardStroke, type CardText, type CompiledCard } from "./types";

const PAPER = "#fffdf7";
const SKETCH_FONT = "'Patrick Hand', 'Segoe Print', 'Comic Sans MS', cursive";
const HEAD = 13;

const gen = new RoughGenerator();

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Logical y-up to SVG y-down. */
const sy = (y: number): number => CARD_H - y;

function pairs(flat: number[]): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i + 1 < flat.length; i += 2) out.push([flat[i], sy(flat[i + 1])]);
  return out;
}

/** rough.js's drawable as SVG paths (its own toPaths: d, stroke, fill). */
function paths(d: ReturnType<RoughGenerator["linearPath"]>, extra = ""): string {
  return gen
    .toPaths(d)
    .map((p) => `<path d="${p.d}" stroke="${p.stroke}" stroke-width="${p.strokeWidth}" fill="${p.fill ?? "none"}" stroke-linecap="round" stroke-linejoin="round"${extra}/>`)
    .join("");
}

function opts(it: CardStroke | CardArea, extra: Partial<RoughOptions> = {}): RoughOptions {
  return { roughness: it.r, seed: it.sd, bowing: 0.9, ...(it.k === "s" ? { stroke: it.c, strokeWidth: it.w } : {}), ...extra };
}

/** The arrowhead's three points at one end (render/svg-backend.ts arrowheadPts, in screen space). */
function arrowhead(pts: [number, number][], at: "end" | "start", size: number): [number, number][] | null {
  if (pts.length < 2) return null;
  const seq = at === "end" ? pts : [...pts].reverse();
  const tip = seq[seq.length - 1];
  // Back along the line by `size`.
  let prev = seq[seq.length - 2];
  let left = size;
  for (let i = seq.length - 1; i > 0; i--) {
    const [ax, ay] = seq[i];
    const [bx, by] = seq[i - 1];
    const l = Math.hypot(ax - bx, ay - by);
    if (l >= left) {
      prev = [ax + ((bx - ax) * left) / l, ay + ((by - ay) * left) / l];
      break;
    }
    left -= l;
    prev = seq[i - 1];
  }
  const dx = tip[0] - prev[0];
  const dy = tip[1] - prev[1];
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const s = 0.45;
  return [
    [tip[0] - size * (ux * Math.cos(s) - uy * Math.sin(s)), tip[1] - size * (uy * Math.cos(s) + ux * Math.sin(s))],
    tip,
    [tip[0] - size * (ux * Math.cos(s) + uy * Math.sin(s)), tip[1] - size * (uy * Math.cos(s) - ux * Math.sin(s))],
  ];
}

function stroke(it: CardStroke): string {
  // A shape's own fill is solid (render/svg-backend.ts roughHintFill); hatching is for regions.
  const o = opts(it, it.f ? { fill: it.f, fillStyle: "solid" } : {});
  const dash = it.d ? ` stroke-dasharray="10 8"` : "";
  let out = "";
  if (it.ci) out += paths(gen.circle(it.ci[0], sy(it.ci[1]), it.ci[2] * 2, o), dash);
  else if (it.rc) out += paths(gen.rectangle(it.rc[0], sy(it.rc[1] + it.rc[3]), it.rc[2], it.rc[3], o), dash);
  else {
    const pts = pairs(it.p);
    if (pts.length >= 2) out += paths(it.cl ? gen.polygon(pts, o) : gen.linearPath(pts, o), dash);
    if (it.a && pts.length >= 2) {
      const ends: ("end" | "start")[] = it.a === "b" ? ["start", "end"] : [it.a === "e" ? "end" : "start"];
      for (const at of ends) {
        const tri = arrowhead(pts, at, it.hs ?? HEAD);
        if (tri) out += paths(gen.linearPath(tri, opts(it)));
      }
    }
  }
  return it.o !== undefined && it.o < 1 ? `<g opacity="${it.o}">${out}</g>` : out;
}

function area(it: CardArea): string {
  const pts = pairs(it.p);
  if (pts.length < 3) return "";
  if (it.x) return `<path d="M${pts.map(([x, y]) => `${x} ${y}`).join("L")}Z" fill="${it.f}" opacity="${it.o}"/>`;
  const o = opts(it, { fill: it.f, fillStyle: "hachure", hachureGap: 5.5, fillWeight: 1.7, strokeWidth: 1.8, stroke: "none" });
  return `<g opacity="${Math.min(1, it.o + 0.15)}">${paths(gen.polygon(pts, o))}</g>`;
}

function text(it: CardText): string {
  const anchor = it.an === "s" ? "start" : it.an === "e" ? "end" : "middle";
  const lines = it.ls && it.ls.length ? it.ls : [it.t];
  const lh = it.s * 1.25;
  // A wrapped block is centred on its position, as the engine lays it out.
  const top = lines.length > 1 ? sy(it.y) - ((lines.length - 1) * lh) / 2 : sy(it.y);
  const rot = it.tl ? ` transform="rotate(${-it.tl} ${it.x} ${sy(it.y)})"` : "";
  const spans = lines.map((l, i) => `<tspan x="${it.x}" y="${(top + i * lh).toFixed(1)}">${esc(l)}</tspan>`).join("");
  return `<text font-family="${SKETCH_FONT}" font-size="${it.s}" fill="${it.c}" text-anchor="${anchor}" dominant-baseline="central" paint-order="stroke" stroke="${PAPER}" stroke-width="${(it.s / 6).toFixed(1)}" stroke-linejoin="round"${rot}>${spans}</text>`;
}

function icon(it: CardIcon): string {
  return `<image href="${esc(it.href)}" x="${it.x - it.w / 2}" y="${sy(it.y) - it.h / 2}" width="${it.w}" height="${it.h}"${it.o !== undefined ? ` opacity="${it.o}"` : ""}/>`;
}

function item(it: CardItem): string {
  return it.k === "s" ? stroke(it) : it.k === "a" ? area(it) : it.k === "i" ? icon(it) : text(it);
}

/** The drawing alone, on the 1000 × 750 canvas (no outer <svg>). */
export function drawingMarkup(card: CompiledCard): string {
  return `<rect width="${CARD_W}" height="${CARD_H}" fill="${PAPER}"/>` + card.items.map(item).join("");
}

/** The corners in the card's order as thumb.mts's busyness (emptiest first). */
function busyOf(corners: Corner[]): Record<Corner, number> {
  const out: Record<Corner, number> = { tl: 9, tr: 9, bl: 9, br: 9 };
  corners.forEach((c, i) => (out[c] = i));
  return out;
}

/**
 * The whole card as an SVG string: the drawing — or, given `posterHref`, the
 * poster — under the marks. The marks stand where the card says whichever
 * picture is under them.
 */
export function drawCard(card: CompiledCard, opts: { posterHref?: string; width?: number } = {}): string {
  const svg = thumbSvg(card.marks, opts.posterHref ?? "", busyOf(card.corners), opts.posterHref ? undefined : drawingMarkup(card));
  if (!opts.width) return svg;
  const h = Math.round((opts.width * CARD_H) / CARD_W);
  return svg.replace(/^<svg ([^>]*?)width="\d+" height="\d+"/, `<svg $1width="${opts.width}" height="${h}"`);
}
