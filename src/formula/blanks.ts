// Formula blanks (design 2026-10-03 §5.2–5.4): `\blank{…}` in a math
// element's TeX. Before MathJax the blank is replaced by its content (or the
// viewer's fill), wrapped in a nested mark the way live math wraps a var
// (layout/live-math.ts), so the formula lays out exactly as the answer would
// and the blank's glyphs gather into a part of their own,
// `<id>_blank_<k>_fill`. layout/math.ts keeps those glyphs back until a fill
// shows them, and draws a rounded box, `<id>_blank_<k>`, around them.
import type { LiveMathPart } from "../layout/live-math";
import { equivalent, exactEqual, normTeX, parseAscii, texToExpr } from "./expr";
import { parseBlankNumber } from "../tree/blanks";

export interface FormulaBlank {
  /** 1, 2, … in reading order. */
  k: number;
  /** The true content, as written between the braces. */
  tex: string;
  /** `<id>_blank_<k>`: the box. */
  part: string;
  /** `<id>_blank_<k>_fill`: the content's glyphs. */
  fill: string;
}

/** The marks start this deep, so they never collide with live math's (1…n). */
const BLANK_DEPTH = 50;

/** `\blank{` (not `\blanket`). Not global, so `test` keeps no state; scan makes its own global copy. */
const BLANK = /\\blank(?![a-zA-Z])\s*\{/;

interface Found { blank: FormulaBlank; start: number; end: number }

/** Each `\blank{…}` with its braces matched (a `\{` inside does not count). */
function scan(id: string, tex: string): Found[] {
  const out: Found[] = [];
  for (const m of tex.matchAll(new RegExp(BLANK.source, "g"))) {
    const open = m.index! + m[0].length; // just past `{`
    if (out.length > 0 && m.index! < out[out.length - 1].end) continue; // inside an earlier blank
    let depth = 1;
    let i = open;
    for (; i < tex.length && depth > 0; i++) {
      const c = tex[i];
      if (c === "\\") { i++; continue; }
      if (c === "{") depth++;
      else if (c === "}") depth--;
    }
    if (depth !== 0) break; // unclosed: MathJax will say so
    const k = out.length + 1;
    out.push({ blank: { k, tex: tex.slice(open, i - 1), part: `${id}_blank_${k}`, fill: `${id}_blank_${k}_fill` }, start: m.index!, end: i });
  }
  return out;
}

export function hasBlanks(tex: string): boolean {
  return BLANK.test(tex);
}

export function formulaBlanks(id: string, tex: string): FormulaBlank[] {
  return scan(id, tex).map((f) => f.blank);
}

/**
 * The TeX with each `\blank{X}` replaced by X (or the fill's TeX) wrapped in
 * a nested mark, and the marks → parts. `filled[k-1]` says whether blank k
 * shows a fill (a non-empty one); an empty fill `""` draws the truth as
 * `\phantom` so the box keeps its size. A TeX without blanks comes back the
 * same string.
 */
export function markBlanks(id: string, tex: string, fills?: readonly (string | null)[]): { tex: string; marks: Map<string, LiveMathPart>; filled: boolean[] } {
  const marks = new Map<string, LiveMathPart>();
  const found = scan(id, tex);
  if (found.length === 0) return { tex, marks, filled: [] };
  const filled: boolean[] = [];
  let out = "";
  let last = 0;
  for (const { blank, start, end } of found) {
    const f = fills?.[blank.k - 1];
    const content = f === "" ? `\\phantom{${blank.tex}}` : f ?? blank.tex;
    filled.push(typeof f === "string" && f !== "");
    const depth = BLANK_DEPTH + blank.k;
    const mark = `${"\\mathord{".repeat(depth)}${content}${"}".repeat(depth)}`;
    marks.set(mark, { id: blank.fill, name: `blank_${blank.k}`, live: false });
    out += `${tex.slice(last, start)}{${mark}}`;
    last = end;
  }
  return { tex: out + tex.slice(last), marks, filled };
}

/** A tile's TeX against the blank's: equal after spaces and outer braces go. */
export function tileRight(blank: FormulaBlank, tileTeX: string): boolean {
  return normTeX(tileTeX) === normTeX(blank.tex);
}

/** The blank's content is a plain number (a number box answers it). */
export function blankIsNumber(blank: FormulaBlank): boolean {
  return /^\s*[-+]?(\d+(?:[.,]\d*)?|[.,]\d+)\s*$/.test(blank.tex.replace(/\{,\}/g, ","));
}

/** The truth converts to an expression (else it takes tiles only). */
export function blankConvertible(blank: FormulaBlank): boolean {
  return texToExpr(blank.tex) !== null;
}

/**
 * A typed answer: a number blank within `tolerance` (relative, default 0.02);
 * an expression checked by value, or by form with `form: "exact"`. False when
 * the typing does not parse.
 */
export function typedRight(blank: FormulaBlank, typed: string, form?: "exact", tolerance = 0.02): boolean {
  if (blankIsNumber(blank)) {
    const truth = parseBlankNumber(blank.tex.replace(/\{,\}/g, ","));
    const v = parseBlankNumber(typed);
    if (truth === null || v === null || !Number.isFinite(v)) return false;
    return Math.abs(v - truth) <= tolerance * Math.max(Math.abs(truth), 1e-9) + 1e-9;
  }
  const e = parseAscii(typed);
  if ("error" in e) return false;
  if (form === "exact") return exactEqual(e, blank.tex);
  const truth = texToExpr(blank.tex);
  return truth !== null && equivalent(e, truth);
}
