// Live math (design 2026-09-29): a `math` element's TeX reads the spec's vars
// as `{name}` — the same token drawn text reads (spec/vars.ts) — and each var
// occurrence becomes a part of its own, `<id>_var_<name>` (`_2`, `_3` … for
// later ones), which the paused viewer scrubs or types (ui/live-vars.ts).
//
// The substitution keeps TeX's own braces: `{r}` becomes `{<value>}`, so the
// group it stood in is never loosened. A braced ARGUMENT is TeX, not a token:
// right after a control word (`\frac{u}`, `\text{r}`) or after `^`, `_`, `}`
// or `]` (`x^{t}`, a fraction's denominator) the name keeps its letter —
// `^{{t}}` puts the value there. A name that is not a var stays plain TeX.
//
// Each occurrence is wrapped in k nested `\mathord{…}` (k = its place in the
// formula): MathJax carries every wrapper into the token's ancestor chain,
// so the outermost one names the occurrence exactly, even when two vars hold
// the same number side by side (equation.ts leans on reading order instead).
import { formatVar, liveDecimals, type VarInfo } from "../spec/vars";

/** The token drawn text reads (spec/vars.ts TOKEN), with an optional dotted part. */
const TOKEN = /\{([a-zA-Z_][a-zA-Z_0-9]*(?:\.[a-zA-Z_][a-zA-Z_0-9]*)?)(?::(\d)?(,)?)?\}/g;

const GREEK = new Set([
  "alpha", "beta", "gamma", "delta", "epsilon", "varepsilon", "zeta", "eta", "theta", "vartheta", "iota", "kappa", "lambda", "mu", "nu", "xi", "pi", "rho", "sigma", "tau", "upsilon", "phi", "varphi", "chi", "psi", "omega",
  "Gamma", "Delta", "Theta", "Lambda", "Xi", "Pi", "Sigma", "Upsilon", "Phi", "Psi", "Omega",
]);

/** A var's name as a symbol: `r`, `\beta` for beta, `r_{1}` for r_1, `\mathit{rate}` for rate. */
export function symbolTeX(name: string): string {
  const [base, ...rest] = name.split("_");
  const head = GREEK.has(base) ? `\\${base}` : base.length <= 1 ? base : `\\mathit{${base}}`;
  const sub = rest.filter((s) => s !== "").join("\\,");
  return sub ? `${head}_{${sub}}` : head;
}

export interface LiveMathPart {
  /** `<id>_var_<name>`, `_2`, `_3` … for later occurrences. */
  id: string;
  name: string;
  /** The viewer may scrub and type it (a var not `fixed` and not computed). */
  live: boolean;
  /** Its colour: the live var's, else undefined (the formula's ink). */
  color?: string;
}

export interface LiveTeXOpts {
  /** The element id the parts are named after. */
  id: string;
  /** Every var's current number (spec/vars.ts varValues) — computed ones included. */
  vars: Record<string, number>;
  /** The definitions, for live, decimals and colour. */
  infos: ReadonlyMap<string, VarInfo>;
  /** Live var → colour (spec/vars.ts liveVarColors). */
  colors: Readonly<Record<string, string>>;
  /** Template and population values (`{pop.sick}`): shown as plain numbers, never parts. */
  values?: Readonly<Record<string, number | string>>;
  form?: "values" | "symbols" | "both";
  decimalComma?: boolean;
}

export interface LiveTeX {
  tex: string;
  /** Each occurrence's mark (the exact nested-\mathord string) → its part. */
  marks: Map<string, LiveMathPart>;
}

/** True when the `{…}` at `i` is a command's or a script's argument, not a token. */
function isArgument(tex: string, i: number): boolean {
  if (i === 0) return false;
  const prev = tex[i - 1];
  // `\{r}`: an escaped brace, TeX's own literal.
  if (prev === "\\") return true;
  // Directly after a control word: `\frac{u}`, `\text{r}`, `\sqrt{x}`.
  if (/[a-zA-Z]/.test(prev)) {
    let j = i - 1;
    while (j >= 0 && /[a-zA-Z]/.test(tex[j])) j--;
    if (j >= 0 && tex[j] === "\\") return true;
  }
  let j = i - 1;
  while (j >= 0 && /\s/.test(tex[j])) j--;
  return j >= 0 && "^_}]".includes(tex[j]);
}

/** The first `=` outside every brace group, or -1. */
function topLevelEquals(tex: string): number {
  let depth = 0;
  for (let i = 0; i < tex.length; i++) {
    const c = tex[i];
    if (c === "\\") {
      i++;
      continue;
    }
    if (c === "{") depth++;
    else if (c === "}") depth--;
    else if (c === "=" && depth === 0) return i;
  }
  return -1;
}

/** Does this TeX name any var as a token? (What makes a formula live at all.) */
export function texNamesVars(tex: string, vars: Readonly<Record<string, unknown>>): boolean {
  for (const m of tex.matchAll(TOKEN)) if (Object.prototype.hasOwnProperty.call(vars, m[1]) && !isArgument(tex, m.index!)) return true;
  return false;
}

/**
 * The TeX with its var tokens written in (values or names, per `form`) and
 * each occurrence marked. A formula that names no var comes back unchanged —
 * the same string, so every existing formula lays out exactly as before.
 */
export function liveTeX(tex: string, o: LiveTeXOpts): LiveTeX {
  const marks = new Map<string, LiveMathPart>();
  const has = (name: string) => Object.prototype.hasOwnProperty.call(o.vars, name);
  const values = o.values ?? {};
  if (!texNamesVars(tex, o.vars) && ![...tex.matchAll(TOKEN)].some((m) => m[1].includes(".") && m[1] in values && !isArgument(tex, m.index!))) return { tex, marks };
  let k = 0;
  const seen = new Map<string, number>();
  // TeX spaces a bare comma as punctuation; `{,}` keeps it inside the number.
  const num = (s: string) => s.replace(/,/g, "{,}").replace(/\u00a0/g, "\\,");
  const sub = (src: string, form: "values" | "symbols"): string =>
    src.replace(TOKEN, (whole, name: string, decimals: string | undefined, group: string | undefined, at: number) => {
      if (isArgument(src, at)) return whole;
      if (!has(name)) {
        // A template's or a population's number: written in, never a part.
        const v = name.includes(".") ? values[name] : undefined;
        if (typeof v === "number") return `{${num(formatVar(v, decimals === undefined ? undefined : Number(decimals), o.decimalComma, group !== undefined))}}`;
        if (typeof v === "string") return `{\\text{${v.replace(/[{}\\]/g, "")}}}`;
        return whole;
      }
      const info = o.infos.get(name);
      const live = info !== undefined && !info.fixed;
      const d = decimals !== undefined ? Number(decimals) : info ? (info.expr !== undefined ? info.decimals : liveDecimals(info)) : undefined;
      const body = form === "symbols" ? symbolTeX(name) : num(formatVar(o.vars[name], d, o.decimalComma, group !== undefined));
      k++;
      const mark = `${"\\mathord{".repeat(k)}${body}${"}".repeat(k)}`;
      const n = (seen.get(name) ?? 0) + 1;
      seen.set(name, n);
      const color = live ? o.colors[name] : undefined;
      marks.set(mark, { id: `${o.id}_var_${name}${n > 1 ? `_${n}` : ""}`, name, live, ...(color ? { color } : {}) });
      return `{${mark}}`;
    });
  const form = o.form ?? "values";
  if (form !== "both") return { tex: sub(tex, form), marks };
  // Both: the formula in names, then its right side in numbers — equation_plot's
  // equation_form. With no `=`, the whole formula is the right side.
  const eq = topLevelEquals(tex);
  const lhs = eq >= 0 ? tex.slice(0, eq) : "";
  const rhs = eq >= 0 ? tex.slice(eq + 1) : tex;
  const symbols = eq >= 0 ? `${sub(lhs, "symbols")}=${sub(rhs, "symbols")}` : sub(rhs, "symbols");
  return { tex: `${symbols.trimEnd()} = ${sub(rhs, "values").trimStart()}`, marks };
}

/**
 * The occurrence a glyph belongs to, from its token's ancestor chain
 * (innermost first): the outermost of the run of marks that starts at the
 * first mark in the chain — occurrence k's k-deep wrapper, even when a
 * shallower wrapper of the same text is another occurrence's mark.
 */
export function partOfChain(chain: readonly string[], marks: ReadonlyMap<string, LiveMathPart>): LiveMathPart | null {
  if (marks.size === 0) return null;
  let found: LiveMathPart | null = null;
  for (const entry of chain) {
    const p = marks.get(entry);
    if (p) found = p;
    else if (found) break;
  }
  return found;
}
