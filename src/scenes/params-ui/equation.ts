// A drawn equation with its parameters' values written in (params-ui): the
// TeX laid out by the mathjax engine in the drawing's own hand, every glyph a
// filled outline, and the glyphs of each parameter's value gathered into a
// part of their own — eq_param_<name> (eq_param_<name>_2, _3 … where the
// name appears again) — so a cast can point at a number and the paused viewer
// can scrub or type it (controls.ts). Editable values are written in the
// parameter colour, fixed ones in the equation's ink.
import { MATH_X_HEIGHT, mathSizeOf } from "../../layout/math";
import { COLORS, Z_TEXT, SKETCH_MS, defaultDrawOpts, defaultStyle, type Drawable, type Pt } from "../../layout/model";
import { simplifyPolyline } from "../../layout/geometry";
import type { MathJaxEngine } from "../engines";
import { kit } from "../kit";
import { PARAM_MARK, toTeX, type Node } from "./expr";
import { digitsOf, type ParamSet } from "./params";

/** What a number the viewer may change is written in. */
export const PARAM_COLOR = COLORS.accent;
export const EQ_SIZE = 42;
export const EQ_MIN_SIZE = 22;

/** The part id prefix of a parameter's value in a drawn equation. */
export const EQ_PARAM_PREFIX = "eq_param_";

export interface EquationOpts {
  /** The line's id: its glyphs other than the values. */
  id: string;
  /** The left side, as TeX ("y", "f(x)", "z"). */
  lhsTeX: string;
  /** The right side — or a tuple of them, written (a, b, c). */
  node: Node | readonly Node[];
  /** Names that are variables, not parameters (x; x and y for a surface). */
  variables: string | readonly string[];
  set: ParamSet;
  /** "values" writes the numbers in, "symbols" the names. */
  form: "values" | "symbols";
  center: Pt;
  /** Widest the line may be; it shrinks (to EQ_MIN_SIZE) to fit. */
  width: number;
  ink?: string;
  size?: number;
  /** Occurrences so far, by name, across every line of the figure (ids stay unique). */
  seen?: Map<string, number>;
}

const isTuple = (n: Node | readonly Node[]): n is readonly Node[] => Array.isArray(n);

/** "\mathord{…}" and nothing after the brace that closes it. */
export function isWholeMark(e: string): boolean {
  const open = `${PARAM_MARK}{`;
  if (!e.startsWith(open)) return false;
  let depth = 0;
  for (let i = open.length - 1; i < e.length; i++) {
    if (e[i] === "{") depth++;
    else if (e[i] === "}" && --depth === 0) return i === e.length - 1;
  }
  return false;
}

/** The TeX of one line, and the parameters in the order their marks appear. */
export function equationTeX(o: Pick<EquationOpts, "lhsTeX" | "node" | "variables" | "set" | "form">): { tex: string; order: string[] } {
  const writer = {
    digits: (name: string) => {
      if (o.form === "symbols") return null;
      const p = o.set.byName.get(name);
      return p ? digitsOf(p) : "1";
    },
  };
  if (isTuple(o.node)) {
    // A tuple — a space curve's (x(t), y(t), z(t)): each part written in
    // turn, so the marks still come in reading order.
    const parts = o.node.map((n) => toTeX(n, o.variables, writer));
    return { tex: `${o.lhsTeX} = \\left(${parts.map((p) => p.tex).join(",\\ ")}\\right)`, order: parts.flatMap((p) => p.order) };
  }
  const { tex, order } = toTeX(o.node, o.variables, writer);
  return { tex: `${o.lhsTeX} = ${tex}`, order };
}

/**
 * The drawn line: one group under `id` (the glyphs that are not values) and
 * one per value (`paramIds`, in reading order), each anchored at its centre.
 */
export function drawEquation(mathjax: MathJaxEngine, o: EquationOpts): { drawables: Drawable[]; anchors: Record<string, Pt>; paramIds: string[] } {
  const ink = o.ink ?? COLORS.ink;
  const seen = o.seen ?? new Map<string, number>();
  const { tex, order: names } = equationTeX(o);
  const laid = mathjax.layoutTeX(tex, { display: true });
  // Each marked group, in reading order: consecutive tokens under one
  // \mathord{…} entry. (Two identical marks side by side would merge; a
  // value always has a dot or an operator beside another, and a count that
  // does not match leaves every glyph in the line — never a wrong id.)
  // The entry must be the mark WHOLE: "\mathord{1.00}^{2}" also starts with
  // the mark, and taking it would count a power's exponent as a value of its
  // own (a parameter squared — a Gaussian's σ² — then lost every id).
  const markOf = (chain: string[]): string | null => chain.find(isWholeMark) ?? null;
  const tokenGroup = new Map<number, number>();
  let g = -1;
  let prevMark: string | null = null;
  let prevIndex = -2;
  for (const t of laid.tokens) {
    const mk = markOf(t.chain);
    if (mk === null) {
      prevMark = null;
      continue;
    }
    if (!(mk === prevMark && t.index === prevIndex + 1)) g++;
    tokenGroup.set(t.index, g);
    prevMark = mk;
    prevIndex = t.index;
  }
  const mapped = g + 1 === names.length;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const ol of laid.outlines)
    for (const [x, y] of ol.pts) {
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
  if (!(maxX >= minX)) return { drawables: [], anchors: {}, paramIds: [] };
  let size = mathSizeOf(o.size ?? EQ_SIZE);
  const w0 = (maxX - minX) * size * MATH_X_HEIGHT;
  if (w0 > o.width) size = Math.max(mathSizeOf(EQ_MIN_SIZE), (size * o.width) / w0);
  const s = size * MATH_X_HEIGHT;
  const w = (maxX - minX) * s;
  const h = (maxY - minY) * s;
  const [cx, cy] = o.center;
  const tx = (x: number): number => cx - w / 2 + (x - minX) * s;
  const ty = (y: number): number => cy - h / 2 + (y - minY) * s;
  const place = (ring: [number, number][]): Pt[] => simplifyPolyline(ring.map(([x, y]): Pt => [tx(x), ty(y)]), 0.35);

  const own: Drawable[] = [];
  const perGroup = new Map<number, Drawable[]>();
  laid.outlines.forEach((ol, k) => {
    const pts = place(ol.pts);
    if (pts.length < 3) return;
    const holes = (ol.holes ?? []).map(place).filter((r) => r.length >= 3);
    const grp = mapped ? tokenGroup.get(ol.token.index) : undefined;
    const p = grp !== undefined ? o.set.byName.get(names[grp]) : undefined;
    const color = p?.editable ? PARAM_COLOR : ink;
    const area = kit.area(`${o.id}__g${k}`, pts, color, { precise: true, ...(holes.length > 0 ? { holes } : {}) });
    const d: Drawable = { ...area, z: Z_TEXT, style: { ...area.style, color, fill: color, opacity: 1 }, drawOpts: defaultDrawOpts("sketch", SKETCH_MS.text) };
    if (grp !== undefined) {
      if (!perGroup.has(grp)) perGroup.set(grp, []);
      perGroup.get(grp)!.push(d);
    } else own.push(d);
  });
  const group = (gid: string, children: Drawable[], color: string): Drawable => ({
    id: gid,
    kind: "group",
    role: "math",
    children,
    z: Z_TEXT,
    style: defaultStyle({ color }),
    drawOpts: defaultDrawOpts("sketch", SKETCH_MS.text),
  });
  const drawables: Drawable[] = [group(o.id, own, ink)];
  const anchors: Record<string, Pt> = { [o.id]: [cx, cy] };
  const paramIds: string[] = [];
  for (const [gi, children] of [...perGroup].sort((a, b) => a[0] - b[0])) {
    const name = names[gi];
    const k = (seen.get(name) ?? 0) + 1;
    seen.set(name, k);
    const pid = `${EQ_PARAM_PREFIX}${name}${k > 1 ? `_${k}` : ""}`;
    drawables.push(group(pid, children, o.set.byName.get(name)?.editable ? PARAM_COLOR : ink));
    const xs = children.flatMap((d) => (d.kind === "area" ? d.pts.map((q) => q[0]) : []));
    anchors[pid] = [(Math.min(...xs) + Math.max(...xs)) / 2, cy];
    paramIds.push(pid);
  }
  return { drawables, anchors, paramIds };
}

/** The parameter an eq_param_<name>[_k] part is the value of, or null. A
 *  name that itself ends in _<digits> (k_1) is tried whole first. */
export function paramOfEqPart(id: string, set: ParamSet): string | null {
  if (!id.startsWith(EQ_PARAM_PREFIX)) return null;
  const rest = id.slice(EQ_PARAM_PREFIX.length);
  if (set.byName.has(rest)) return rest;
  const base = rest.replace(/_\d+$/, "");
  return base !== rest && set.byName.has(base) ? base : null;
}
