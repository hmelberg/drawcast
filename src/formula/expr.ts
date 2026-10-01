// Formula expressions (fill the formula): what a learner types, read the
// AsciiMath way (`pi r^2`, `2(a+b)`, `π·r²`, `sqrt(x)`), and the author's
// truth written in a small TeX subset (`\pi r^2`, `\frac{v^2}{2a}`). Both
// become the same Expr; an answer is checked by VALUE at random points
// (`equivalent`) or, when the form itself is asked for, by printing both back
// to TeX and comparing (`exactEqual`). Errors are values, never throws.

export type Expr =
  | { k: "num"; v: number }
  | { k: "sym"; name: string } // r, x_1, pi, e
  | { k: "neg"; a: Expr }
  | { k: "bin"; op: "+" | "-" | "*" | "/" | "^"; a: Expr; b: Expr }
  | { k: "fn"; name: string; a: Expr }; // sqrt, sin, cos, tan, ln, log, exp, abs

/** One token stream for both readers, so they share the parser. */
type Tok =
  | { t: "num"; v: number }
  | { t: "id"; name: string }
  | { t: "fn"; name: string }
  | { t: "op"; v: "+" | "-" | "*" | "/" | "^" | "(" | ")" };

const FUNCS = ["sqrt", "sin", "cos", "tan", "ln", "log", "exp", "abs"];
const GREEK = [
  "alpha", "beta", "gamma", "delta", "epsilon", "theta", "lambda", "mu",
  "rho", "sigma", "tau", "phi", "omega",
];
/** Multi-letter words the ascii reader keeps whole; any other run splits into letters. */
const WORDS = [...FUNCS, "pi", ...GREEK].sort((a, b) => b.length - a.length);
const UNI_GREEK: Record<string, string> = {
  π: "pi", α: "alpha", β: "beta", γ: "gamma", δ: "delta", ε: "epsilon", θ: "theta",
  λ: "lambda", μ: "mu", ρ: "rho", σ: "sigma", τ: "tau", φ: "phi", ω: "omega",
};

const isDigit = (c: string | undefined): boolean => !!c && c >= "0" && c <= "9";
const isLetter = (c: string | undefined): boolean => !!c && /^[A-Za-z]$/.test(c);
const isAlnum = (c: string | undefined): boolean => isDigit(c) || isLetter(c);

// ---- ascii reader ----

function asciiTokens(src: string): Tok[] | { error: string } {
  const out: Tok[] = [];
  let i = 0;
  // `_1`, `_12`, `_{12}` after a symbol: part of its name.
  const subscript = (): string | null => {
    if (src[i] !== "_") return "";
    let j = i + 1;
    const braced = src[j] === "{";
    if (braced) j++;
    const start = j;
    while (isAlnum(src[j])) j++;
    if (j === start) return null;
    const sub = src.slice(start, j);
    if (braced) {
      if (src[j] !== "}") return null;
      j++;
    }
    i = j;
    return "_" + sub;
  };
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (isDigit(c) || (c === "." && isDigit(src[i + 1]))) {
      let j = i;
      let num = "";
      while (j < src.length) {
        if (isDigit(src[j]) || src[j] === ".") num += src[j++];
        // a comma between digits, with no space after it, is a decimal comma
        else if (src[j] === "," && isDigit(src[j - 1]) && isDigit(src[j + 1])) { num += "."; j++; }
        else break;
      }
      const v = Number(num);
      if (!Number.isFinite(v)) return { error: `"${num}" is not a number` };
      out.push({ t: "num", v });
      i = j;
      continue;
    }
    if (isLetter(c)) {
      const word = WORDS.find((w) => src.startsWith(w, i));
      const name = word ?? c;
      i += name.length;
      if (FUNCS.includes(name)) { out.push({ t: "fn", name }); continue; }
      const sub = subscript();
      if (sub === null) return { error: "a subscript needs a letter or number after _" };
      out.push({ t: "id", name: name + sub });
      continue;
    }
    if (UNI_GREEK[c]) {
      i++;
      const sub = subscript();
      if (sub === null) return { error: "a subscript needs a letter or number after _" };
      out.push({ t: "id", name: UNI_GREEK[c] + sub });
      continue;
    }
    i++;
    if (c === "√") out.push({ t: "fn", name: "sqrt" });
    else if (c === "²" || c === "³") out.push({ t: "op", v: "^" }, { t: "num", v: c === "²" ? 2 : 3 });
    else if (c === "·" || c === "×" || c === "⋅") out.push({ t: "op", v: "*" });
    else if (c === "−") out.push({ t: "op", v: "-" });
    else if (c === "[") out.push({ t: "op", v: "(" });
    else if (c === "]") out.push({ t: "op", v: ")" });
    else if ("+-*/^()".includes(c)) out.push({ t: "op", v: c as "+" });
    else return { error: `"${c}" is not part of a formula` };
  }
  return out;
}

// ---- parser (shared) ----

function parseTokens(toks: Tok[]): Expr | { error: string } {
  let i = 0;
  class ParseError extends Error {}
  const fail = (msg: string): never => { throw new ParseError(msg); };
  const isOp = (v: string): boolean => { const k = toks[i]; return !!k && k.t === "op" && k.v === v; };
  const startsAtom = (): boolean => {
    const k = toks[i];
    return !!k && (k.t !== "op" || k.v === "(");
  };

  const sum = (): Expr => {
    let a = prod();
    while (isOp("+") || isOp("-")) {
      const op = (toks[i++] as { v: "+" | "-" }).v;
      a = { k: "bin", op, a, b: prod() };
    }
    return a;
  };
  const prod = (): Expr => {
    let a = unary();
    for (;;) {
      if (isOp("*") || isOp("/")) {
        const op = (toks[i++] as { v: "*" | "/" }).v;
        a = { k: "bin", op, a, b: unary() };
      } else if (startsAtom()) {
        a = { k: "bin", op: "*", a, b: power() }; // implied: 2r, pi r, 2(a+b)
      } else return a;
    }
  };
  const unary = (): Expr => {
    if (isOp("-")) { i++; return { k: "neg", a: unary() }; }
    if (isOp("+")) { i++; return unary(); }
    return power();
  };
  const power = (): Expr => {
    const a = atom();
    if (isOp("^")) { i++; return { k: "bin", op: "^", a, b: unary() }; } // right-assoc via unary
    return a;
  };
  const atom = (): Expr => {
    const k = toks[i];
    if (!k) return fail("the formula ends too soon");
    i++;
    if (k.t === "num") return { k: "num", v: k.v };
    if (k.t === "id") return { k: "sym", name: k.name };
    if (k.t === "fn") return { k: "fn", name: k.name, a: atom() };
    if (k.v === "(") {
      const e = sum();
      if (!isOp(")")) fail("a bracket is not closed");
      i++;
      return e;
    }
    return fail(`"${k.v}" is out of place`);
  };

  try {
    if (toks.length === 0) return { error: "the formula is empty" };
    const e = sum();
    if (i < toks.length) {
      const k = toks[i];
      return { error: k.t === "op" && k.v === ")" ? "a bracket closes that never opened" : "something is left over at the end" };
    }
    return e;
  } catch (err) {
    if (err instanceof ParseError) return { error: err.message };
    throw err;
  }
}

export function parseAscii(src: string): Expr | { error: string } {
  const toks = asciiTokens(src);
  if (!Array.isArray(toks)) return toks;
  return parseTokens(toks);
}

// ---- TeX reader (the supported subset) ----

const TEX_SKIP = [",", ";", ":", "!", " "];

/** Tokens for a TeX source; `{…}` groups become brackets. Null = outside the subset. */
function texTokens(src: string): Tok[] | null {
  let i = 0;
  const out: Tok[] = [];
  const word = (): string => {
    let j = i;
    while (isLetter(src[j])) j++;
    const w = src.slice(i, j);
    i = j;
    return w;
  };
  // One argument: a {group}, or a single character / control word.
  const arg = (): Tok[] | null => {
    while (src[i] === " ") i++;
    if (src[i] === "{") {
      i++;
      const inner = run(true);
      if (!inner) return null;
      return [{ t: "op", v: "(" }, ...inner, { t: "op", v: ")" }];
    }
    const c = src[i];
    if (isDigit(c)) { i++; return [{ t: "num", v: Number(c) }]; }
    if (isLetter(c)) { i++; return [{ t: "id", name: c }]; }
    if (c === "\\") {
      const save = out.length;
      if (!step()) return null;
      return out.splice(save);
    }
    return null;
  };
  // Reads one item into `out`; false = outside the subset.
  const step = (): boolean => {
    const c = src[i];
    if (/\s/.test(c)) { i++; return true; }
    if (isDigit(c) || (c === "." && isDigit(src[i + 1]))) {
      let j = i;
      while (isDigit(src[j]) || src[j] === ".") j++;
      const v = Number(src.slice(i, j));
      if (!Number.isFinite(v)) return false;
      out.push({ t: "num", v });
      i = j;
      return true;
    }
    if (isLetter(c)) { i++; out.push({ t: "id", name: c }); return true; }
    if (c === "_") {
      const last = out[out.length - 1];
      if (!last || last.t !== "id") return false;
      i++;
      let sub: string;
      if (src[i] === "{") {
        const close = src.indexOf("}", i);
        if (close < 0) return false;
        sub = src.slice(i + 1, close).replace(/\s+/g, "");
        i = close + 1;
      } else sub = src[i++] ?? "";
      if (!sub || ![...sub].every(isAlnum)) return false;
      last.name += "_" + sub;
      return true;
    }
    if (c === "^") {
      i++;
      const a = arg();
      if (!a) return false;
      out.push({ t: "op", v: "^" }, ...a);
      return true;
    }
    if (c === "{") {
      i++;
      const inner = run(true);
      if (!inner) return false;
      out.push({ t: "op", v: "(" }, ...inner, { t: "op", v: ")" });
      return true;
    }
    if (c === "\\") {
      i++;
      if (TEX_SKIP.includes(src[i])) { i++; return true; }
      const w = word();
      if (w === "frac" || w === "dfrac" || w === "tfrac") {
        const a = arg();
        const b = a && arg();
        if (!a || !b) return false;
        out.push({ t: "op", v: "(" }, ...a, { t: "op", v: "/" }, ...b, { t: "op", v: ")" });
        return true;
      }
      if (w === "sqrt") {
        if (src[i] === "[") return false; // nth roots are outside the subset
        const a = arg();
        if (!a) return false;
        out.push({ t: "fn", name: "sqrt" }, ...a);
        return true;
      }
      if (w === "cdot" || w === "times") { out.push({ t: "op", v: "*" }); return true; }
      if (w === "left" || w === "right") {
        while (src[i] === " ") i++;
        const d = src[i++];
        if (d === "(" || d === "[") out.push({ t: "op", v: "(" });
        else if (d === ")" || d === "]") out.push({ t: "op", v: ")" });
        else return false;
        return true;
      }
      if (w === "pi" || GREEK.includes(w)) { out.push({ t: "id", name: w }); return true; }
      // \sin, \ln and the rest take an unbraced argument whose reach TeX
      // leaves to the reader (`\sin 2x`, `\sin x^2`): outside the subset.
      return false;
    }
    i++;
    if (c === "[") out.push({ t: "op", v: "(" });
    else if (c === "]") out.push({ t: "op", v: ")" });
    else if ("+-*/()".includes(c)) out.push({ t: "op", v: c as "+" });
    else return false;
    return true;
  };
  // Runs `step` to the end, or to the `}` closing a group (consumed).
  const run = (inGroup: boolean): Tok[] | null => {
    const start = out.length;
    while (i < src.length) {
      if (src[i] === "}") {
        if (!inGroup) return null;
        i++;
        return out.splice(start);
      }
      if (!step()) return null;
    }
    return inGroup ? null : out.splice(start);
  };
  return run(false);
}

export function texToExpr(tex: string): Expr | null {
  const toks = texTokens(tex);
  if (!toks) return null;
  const e = parseTokens(toks);
  return "error" in e ? null : e;
}

// ---- TeX printing ----

const PREC = { sum: 1, prod: 2, neg: 3, pow: 4, atom: 5 };

function prec(e: Expr): number {
  if (e.k === "bin") {
    if (e.op === "+" || e.op === "-") return PREC.sum;
    if (e.op === "*") return PREC.prod;
    if (e.op === "/") return PREC.atom; // \frac is self-contained
    return PREC.pow;
  }
  if (e.k === "neg") return PREC.neg;
  if (e.k === "num" && e.v < 0) return PREC.neg;
  return PREC.atom;
}

const paren = (s: string): string => `\\left(${s}\\right)`;

function symTeX(name: string): string {
  const [base, sub] = name.split(/_(.*)/s);
  const b = base === "pi" || GREEK.includes(base) ? `\\${base}` : base;
  if (sub === undefined) return b;
  return sub.length === 1 ? `${b}_${sub}` : `${b}_{${sub}}`;
}

export function exprToTeX(e: Expr): string {
  // `min`: the least precedence printed bare in this position.
  const p = (x: Expr, min: number): string => (prec(x) < min ? paren(exprToTeX(x)) : exprToTeX(x));
  switch (e.k) {
    case "num":
      return String(e.v);
    case "sym":
      return symTeX(e.name);
    case "neg":
      return `-${p(e.a, PREC.pow)}`;
    case "fn":
      if (e.name === "sqrt") return `\\sqrt{${exprToTeX(e.a)}}`;
      if (e.name === "abs") return `\\left|${exprToTeX(e.a)}\\right|`;
      return `\\${e.name}${paren(exprToTeX(e.a))}`;
    case "bin": {
      if (e.op === "/") return `\\frac{${exprToTeX(e.a)}}{${exprToTeX(e.b)}}`;
      if (e.op === "^") {
        const base = e.a.k === "bin" && e.a.op === "/" ? paren(exprToTeX(e.a)) : p(e.a, PREC.atom);
        return `${base}^{${exprToTeX(e.b)}}`;
      }
      if (e.op === "*") {
        const l = p(e.a, PREC.prod);
        const r = p(e.b, PREC.pow);
        // juxtapose (\pi r, 2 r^{2}) unless the right side starts with a digit
        return /^[\d.]/.test(r) ? `${l} \\cdot ${r}` : `${l} ${r}`;
      }
      return `${p(e.a, PREC.sum)}${e.op}${p(e.b, e.op === "-" ? PREC.prod : PREC.sum)}`;
    }
  }
}

/** An expression as a learner would type it (`π r^2`, `v^2/(2 a)`,
 *  `sqrt(x)`) — what parseAscii reads back to the same value. The movie
 *  types a typed blank's truth in with it, a character at a time. */
export function exprToAscii(e: Expr): string {
  // Typed, `/` binds like `*` (a/b c is (a/b)·c), so a quotient is a product here.
  const level = (x: Expr): number => (x.k === "bin" && x.op === "/" ? PREC.prod : prec(x));
  const p = (x: Expr, min: number): string => (level(x) < min ? `(${exprToAscii(x)})` : exprToAscii(x));
  switch (e.k) {
    case "num":
      return String(e.v);
    case "sym": {
      const [base, sub] = e.name.split(/_(.*)/s);
      const b = base === "pi" ? "π" : base;
      return sub === undefined ? b : `${b}_${sub}`;
    }
    case "neg":
      return `-${p(e.a, PREC.pow)}`;
    case "fn":
      return `${e.name}(${exprToAscii(e.a)})`;
    case "bin": {
      if (e.op === "^") return `${p(e.a, PREC.atom)}^${p(e.b, PREC.atom)}`;
      if (e.op === "/") return `${p(e.a, PREC.prod)}/${p(e.b, PREC.atom)}`;
      if (e.op === "*") {
        const l = p(e.a, PREC.prod);
        const r = p(e.b, PREC.pow);
        // 2r, 2(a+b) and π r juxtaposed; a number on the right needs its `*`.
        return /^[\d.]/.test(r) ? `${l}*${r}` : /^[\d.]+$/.test(l) ? `${l}${r}` : `${l} ${r}`;
      }
      return `${p(e.a, PREC.sum)}${e.op}${p(e.b, e.op === "-" ? PREC.prod : PREC.sum)}`;
    }
  }
}

// ---- value ----

export function evaluate(e: Expr, env: Record<string, number>): number {
  switch (e.k) {
    case "num":
      return e.v;
    case "sym":
      if (e.name in env) return env[e.name];
      if (e.name === "pi") return Math.PI;
      if (e.name === "e") return Math.E;
      return NaN;
    case "neg":
      return -evaluate(e.a, env);
    case "fn": {
      const a = evaluate(e.a, env);
      switch (e.name) {
        case "sqrt": return Math.sqrt(a);
        case "sin": return Math.sin(a);
        case "cos": return Math.cos(a);
        case "tan": return Math.tan(a);
        case "ln": return Math.log(a);
        case "log": return Math.log10(a);
        case "exp": return Math.exp(a);
        case "abs": return Math.abs(a);
        default: return NaN;
      }
    }
    case "bin": {
      const a = evaluate(e.a, env);
      const b = evaluate(e.b, env);
      switch (e.op) {
        case "+": return a + b;
        case "-": return a - b;
        case "*": return a * b;
        case "/": return a / b;
        case "^": return Math.pow(a, b);
      }
    }
  }
}

export function symbols(e: Expr): string[] {
  const seen = new Set<string>();
  const walk = (x: Expr): void => {
    if (x.k === "sym") { if (x.name !== "pi" && x.name !== "e") seen.add(x.name); }
    else if (x.k === "neg" || x.k === "fn") walk(x.a);
    else if (x.k === "bin") { walk(x.a); walk(x.b); }
  };
  walk(e);
  return [...seen].sort();
}

/** Same value at random points. Letters come from BOTH sides, so a letter the
 *  truth lacks makes the answer vary where the truth does not — wrong. Points
 *  where either side is undefined (sqrt of a negative, ÷0) are skipped; with
 *  fewer than 3 defined points the check falls back to the exact form. */
export function equivalent(a: Expr, b: Expr, opts: { samples?: number; seed?: number } = {}): boolean {
  const samples = opts.samples ?? 5;
  let state = (opts.seed ?? 7) >>> 0;
  const rand = (): number => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
  const letters = [...new Set([...symbols(a), ...symbols(b)])];
  let defined = 0;
  for (let tries = 0; tries < samples * 4 && defined < samples; tries++) {
    const env: Record<string, number> = {};
    for (const l of letters) env[l] = 0.5 + 2.5 * rand();
    const va = evaluate(a, env);
    const vb = evaluate(b, env);
    if (!Number.isFinite(va) || !Number.isFinite(vb)) continue;
    if (Math.abs(va - vb) > 1e-6 * Math.max(1, Math.abs(vb))) return false;
    defined++;
  }
  if (defined >= 3) return true;
  return exactEqual(a, exprToTeX(b));
}

/** The same form: both printed by `exprToTeX` (the truth via `texToExpr`
 *  when it is in the subset, else as written) and normalized. */
export function exactEqual(a: Expr, texTruth: string): boolean {
  const mine = normTeX(exprToTeX(a));
  const truth = texToExpr(texTruth);
  return mine === normTeX(truth ? exprToTeX(truth) : texTruth);
}

/** Spaces and outer braces removed; `^{2}` → `^2` for a one-character exponent. */
export function normTeX(tex: string): string {
  let s = tex.replace(/\s+/g, "");
  const outerPair = (x: string): boolean => {
    if (!x.startsWith("{") || !x.endsWith("}")) return false;
    let depth = 0;
    for (let j = 0; j < x.length; j++) {
      if (x[j] === "{") depth++;
      else if (x[j] === "}") depth--;
      if (depth === 0 && j < x.length - 1) return false; // the first { closes early
    }
    return true;
  };
  while (outerPair(s)) s = s.slice(1, -1);
  return s.replace(/\^\{(.)\}/g, "^$1");
}
