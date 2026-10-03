// Math in a book's text pane: the engine's own MathJax 4 in the figures' math
// font (Fira Math), drawn as inline SVG on the text's baseline — so a formula
// in the text and one in the figure are the same hand. (A separate MathJax
// from a CDN, tried in the mock, wrote in another font and clashed.)
//
// Until the engine is in, a formula is written as its plain TeX (a
// `bk-tex-fallback` code). That must never be the last word: a load that
// failed once (a chunk lost to a redeploy under an open tab, a dropped
// connection) is tried again, and the pane swaps its plain-TeX formulas for
// drawn ones the moment the engine arrives (upgradeMath) — before this, one
// failed load left every formula in the session as raw TeX
// (`\dfrac{9}{9 + 89} \approx 9\%` in the Bayes book, 2026-10-03).

import { ensureEngines, ensureMathFont, getLoadedEngines, type MathJaxEngine } from "../scenes/engines";

let engine: MathJaxEngine | null = null;
let loading: Promise<boolean> | null = null;

/** Load the math engine; texSvg draws plain code until it is in. Resolves
 *  true once it is. A failed load is forgotten, so the next call tries again. */
export function loadBookMath(): Promise<boolean> {
  if (engine) return Promise.resolve(true);
  loading ??= (async () => {
    await ensureEngines(["mathjax"]);
    await ensureMathFont("fira");
    engine = (getLoadedEngines(["mathjax"]) as { mathjax?: MathJaxEngine }).mathjax ?? null;
    return engine !== null;
  })()
    .catch(() => false)
    .then((ok) => {
      if (!ok) loading = null;
      return ok;
    });
  return loading;
}

/** Whether formulas are drawn now — taking up an engine a figure loaded
 *  since (the figure's own math loads it too). */
export function bookMathReady(): boolean {
  if (!engine) {
    try {
      engine = (getLoadedEngines(["mathjax"]) as { mathjax?: MathJaxEngine }).mathjax ?? null;
    } catch {
      engine = null;
    }
  }
  return engine !== null;
}

/** layoutTeX is height-normalised (1 ≈ the x-height); the handwriting's
 *  x-height is about half an em. */
const EM_PER_UNIT = 0.5;

const escapeText = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");

const escapeAttr = (s: string): string => escapeText(s).replace(/"/g, "&quot;");

const SYMBOLS: Record<string, string> = {
  approx: "≈", times: "×", cdot: "·", le: "≤", leq: "≤", ge: "≥", geq: "≥", ne: "≠", neq: "≠", pm: "±", mid: "|",
  infty: "∞", to: "→", rightarrow: "→", leftarrow: "←", sum: "Σ", prod: "Π", alpha: "α", beta: "β", gamma: "γ",
  delta: "δ", Delta: "Δ", epsilon: "ε", theta: "θ", lambda: "λ", mu: "μ", pi: "π", rho: "ρ", sigma: "σ", tau: "τ",
  phi: "φ", omega: "ω", ldots: "…", dots: "…", cdots: "⋯", quad: " ", qquad: " ", left: "", right: "",
};

/** `{…}` starting at `i` (or one character / one \command): its content and where it ends. */
function group(s: string, i: number): [string, number] {
  while (s[i] === " ") i++;
  if (s[i] === "{") {
    let depth = 0;
    for (let j = i; j < s.length; j++) {
      if (s[j] === "\\") j++;
      else if (s[j] === "{") depth++;
      else if (s[j] === "}" && --depth === 0) return [s.slice(i + 1, j), j + 1];
    }
    return [s.slice(i + 1), s.length];
  }
  const cmd = /^\\[A-Za-z]+/.exec(s.slice(i));
  if (cmd) return [cmd[0], i + cmd[0].length];
  return [s[i] ?? "", i + 1];
}

/** A fraction's part, bracketed unless it is one term. */
const term = (t: string): string => (/^[\w.]+$|^\w*\([^()]*\)$/.test(t) ? t : `(${t})`);

/**
 * TeX as plain readable text — what the pane shows while the engine is out,
 * so a reader sees "9/(9 + 89) ≈ 9%", not `\dfrac{9}{9 + 89} \approx 9\%`.
 * Fractions, roots, \text and the common symbols; anything else passes as written.
 */
export function plainTex(tex: string): string {
  let out = "";
  let i = 0;
  while (i < tex.length) {
    const c = tex[i];
    if (c === "\\") {
      const name = /^[A-Za-z]+/.exec(tex.slice(i + 1))?.[0];
      if (!name) {
        // \% \$ \{ \} \_ \& as themselves; \, \; \\ \  a space; \! nothing.
        const next = tex[i + 1] ?? "";
        out += /[,; \\]/.test(next) ? " " : next === "!" ? "" : next;
        i += 2;
        continue;
      }
      i += 1 + name.length;
      if (name === "frac" || name === "dfrac" || name === "tfrac") {
        const [a, j] = group(tex, i);
        const [b, k] = group(tex, j);
        out += `${term(plainTex(a).trim())}/${term(plainTex(b).trim())}`;
        i = k;
      } else if (name === "sqrt") {
        const [a, j] = group(tex, i);
        out += `√${term(plainTex(a).trim())}`;
        i = j;
      } else if (/^(text|textrm|mathrm|mathbf|mathit|operatorname|mathsf|boldsymbol)$/.test(name)) {
        const [a, j] = group(tex, i);
        out += plainTex(a);
        i = j;
      } else out += SYMBOLS[name] ?? `\\${name}`;
    } else if (c === "{" || c === "}") i++;
    else {
      out += c;
      i++;
    }
  }
  return out.replace(/\s+/g, " ");
}

/** A formula as plain text, keeping its TeX so upgradeMath can draw it later. */
const fallback = (tex: string, display: boolean): string =>
  `<code class="bk-tex-fallback" data-tex="${escapeAttr(tex)}"${display ? ' data-display=""' : ""}>${escapeText(plainTex(tex).trim())}</code>`;

/** One formula as an inline SVG sized in em, sitting on the baseline. */
export function texSvg(tex: string, display: boolean): string {
  if (!bookMathReady()) return fallback(tex, display);
  let outlines;
  try {
    outlines = engine!.layoutTeX(tex, { display, font: engine!.fontFor("fira") }).outlines;
  } catch {
    return fallback(tex, display);
  }
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  for (const o of outlines) {
    for (const ring of [o.pts, ...(o.holes ?? [])]) {
      for (const [x, y] of ring) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (!Number.isFinite(x0)) return "";
  // Outlines are y-up (the canvas convention); SVG is y-down: flip about y1.
  const ring = (pts: [number, number][]): string => "M" + pts.map(([x, y]) => `${(x - x0).toFixed(3)},${(y1 - y).toFixed(3)}`).join("L") + "Z";
  const d = outlines.map((o) => [o.pts, ...(o.holes ?? [])].map(ring).join("")).join("");
  const w = x1 - x0;
  const h = y1 - y0;
  const k = EM_PER_UNIT * (display ? 1.25 : 1);
  return (
    `<svg class="bk-tex" viewBox="0 0 ${w.toFixed(3)} ${h.toFixed(3)}" fill-rule="evenodd" aria-label="${escapeText(tex)}" role="img"` +
    ` style="width:${(w * k).toFixed(3)}em;height:${(h * k).toFixed(3)}em;vertical-align:${(y0 * k).toFixed(3)}em"><path d="${d}"/></svg>`
  );
}

/** The bit of a DOM element upgradeMath touches (a real Element in the app). */
export interface FallbackEl {
  getAttribute(name: string): string | null;
  hasAttribute(name: string): boolean;
  outerHTML: string;
}

/** Draw, in place, every formula under `root` still written as plain TeX.
 *  Returns how many were drawn; 0 (and nothing touched) while the engine is out. */
export function upgradeMath(root: { querySelectorAll(sel: string): Iterable<FallbackEl> }): number {
  if (!bookMathReady()) return 0;
  let n = 0;
  for (const el of [...root.querySelectorAll("code.bk-tex-fallback")]) {
    const html = texSvg(el.getAttribute("data-tex") ?? "", el.hasAttribute("data-display"));
    if (html.startsWith("<code")) continue; // the engine cannot draw this one either
    el.outerHTML = html;
    n++;
  }
  return n;
}
