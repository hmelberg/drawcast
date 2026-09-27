// params-ui's expressions (shared by equation_plot and any template with a
// live equation): "y = a*sin(b*x + c)" parsed to a small AST —
// evaluated for the curve, walked for its free parameters, and written back
// as TeX with the parameters' current values in place (each value its own
// marked group, so the layout can find its glyphs). The same function table
// and constants as every other expression in the app (spec/expression.ts);
// never eval(), and every name is looked up with hasOwnProperty so no
// "constructor" or "__proto__" ever reaches a prototype.
//
// Grammar, loosest first:
//   sum      := product (("+" | "-") product)*
//   product  := unary (("*" | "/" | "%") unary | <juxtaposed> unary)*
//   unary    := ("-" | "+") unary | power
//   power    := primary ("^" unary)?          right-associative, -x^2 = -(x^2)
//   primary  := number | name | name "(" args ")" | "(" sum ")"
// Juxtaposition is multiplication at product level: "2x", "3(x+1)",
// "(x-1)(x+2)", "a(x-h)^2". A name followed by "(" is a call when it is a
// known function, else a product ("a(x+1)") — except a longer name that is
// not a declared parameter, which is refused as an unknown function
// ("sinn(x)" is a typo, not sinn × x). Names are whole words: "ax" is one
// parameter called ax, so write a*x (the lint says so).
import { CONSTANTS, FUNCTIONS } from "../../spec/expression";

export type Node =
  | { k: "num"; v: number; text: string }
  | { k: "name"; name: string }
  | { k: "neg"; a: Node }
  | { k: "bin"; op: "+" | "-" | "*" | "/" | "%" | "^"; a: Node; b: Node; implicit?: boolean }
  | { k: "call"; fn: string; args: Node[] };

const has = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);
export const isFunctionName = (s: string): boolean => has(FUNCTIONS, s);
export const isConstantName = (s: string): boolean => has(CONSTANTS, s);

/** Longest expression accepted, and deepest nesting: a figure's equation, not a program. */
export const MAX_EXPR_LENGTH = 400;
const MAX_DEPTH = 40;

interface Tok { t: "num" | "name" | "op"; v: string; at: number }

/** Unicode a person types or pastes, as the ASCII the grammar reads. */
function normalize(src: string): string {
  return src
    .replace(/[−–]/g, "-")
    .replace(/[·×⋅∙]/g, "*")
    .replace(/÷/g, "/")
    .replace(/\*\*/g, "^")
    .replace(/π/g, "pi")
    .replace(/²/g, "^2")
    .replace(/³/g, "^3");
}

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) i++;
    else if (/[0-9.]/.test(c)) {
      const m = /^(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/.exec(src.slice(i));
      if (!m) throw new SyntaxError(`bad number at "${src.slice(i, i + 6)}"`);
      out.push({ t: "num", v: m[0], at: i });
      i += m[0].length;
    } else if (/[A-Za-z_]/.test(c)) {
      const m = /^[A-Za-z_][A-Za-z_0-9]*/.exec(src.slice(i))!;
      out.push({ t: "name", v: m[0], at: i });
      i += m[0].length;
    } else if ("+-*/%^(),".includes(c)) {
      out.push({ t: "op", v: c, at: i });
      i++;
    } else throw new SyntaxError(`unexpected character "${c}"`);
  }
  return out;
}

/**
 * Parse one right-hand side. `declared` are the parameter names the author
 * wrote in `params` — a declared name before "(" multiplies, it never calls.
 */
export function parseExpr(src: string, declared: readonly string[] = []): Node {
  if (src.length > MAX_EXPR_LENGTH) throw new SyntaxError(`longer than ${MAX_EXPR_LENGTH} characters`);
  const toks = tokenize(normalize(src));
  if (toks.length === 0) throw new SyntaxError("empty expression");
  const decl = new Set(declared);
  let pos = 0;
  let depth = 0;
  const peek = (): Tok | undefined => toks[pos];
  const isOp = (v: string): boolean => peek()?.t === "op" && peek()!.v === v;
  const expect = (v: string): void => {
    if (!isOp(v)) throw new SyntaxError(`expected "${v}"${peek() ? ` before "${peek()!.v}"` : " at the end"}`);
    pos++;
  };
  const deeper = <T>(f: () => T): T => {
    if (++depth > MAX_DEPTH) throw new SyntaxError("nested too deeply");
    try {
      return f();
    } finally {
      depth--;
    }
  };

  const sum = (): Node =>
    deeper(() => {
      let a = product();
      while (isOp("+") || isOp("-")) {
        const op = toks[pos++].v as "+" | "-";
        a = { k: "bin", op, a, b: product() };
      }
      return a;
    });
  const startsPrimary = (): boolean => {
    const t = peek();
    return !!t && (t.t === "num" || t.t === "name" || (t.t === "op" && t.v === "("));
  };
  const product = (): Node => {
    let a = unary();
    for (;;) {
      if (isOp("*") || isOp("/") || isOp("%")) {
        const op = toks[pos++].v as "*" | "/" | "%";
        a = { k: "bin", op, a, b: unary() };
      } else if (startsPrimary()) {
        // A number right after a number ("2 3") is a typo, not a product.
        if (peek()!.t === "num" && (a.k === "num" || (a.k === "bin" && a.op === "^"))) throw new SyntaxError(`missing operator before "${peek()!.v}"`);
        a = { k: "bin", op: "*", a, b: power(), implicit: true };
      } else return a;
    }
  };
  const unary = (): Node =>
    deeper(() => {
      if (isOp("-")) {
        pos++;
        return { k: "neg", a: unary() };
      }
      if (isOp("+")) {
        pos++;
        return unary();
      }
      return power();
    });
  const power = (): Node => {
    const base = primary();
    if (isOp("^")) {
      pos++;
      return { k: "bin", op: "^", a: base, b: unary() };
    }
    return base;
  };
  const primary = (): Node => {
    const t = toks[pos++];
    if (!t) throw new SyntaxError("unexpected end of expression");
    if (t.t === "num") {
      const v = Number(t.v);
      if (!Number.isFinite(v)) throw new SyntaxError(`bad number "${t.v}"`);
      return { k: "num", v, text: t.v };
    }
    if (t.t === "name") {
      if (isOp("(") && peek()!.at === t.at + t.v.length) {
        if (isFunctionName(t.v)) {
          pos++;
          const args: Node[] = [];
          if (!isOp(")")) {
            args.push(sum());
            while (isOp(",")) {
              pos++;
              args.push(sum());
            }
          }
          expect(")");
          return { k: "call", fn: t.v, args };
        }
        if (t.v.length > 1 && !decl.has(t.v) && !isConstantName(t.v)) throw new SyntaxError(`unknown function "${t.v}"`);
      }
      return { k: "name", name: t.v };
    }
    if (t.v === "(") {
      const inner = sum();
      expect(")");
      return inner;
    }
    throw new SyntaxError(`unexpected "${t.v}"`);
  };

  const node = sum();
  if (pos < toks.length) throw new SyntaxError(`unexpected "${toks[pos].v}"`);
  return node;
}

/** The names an expression reads that are neither functions nor constants, in first-use order. */
export function namesIn(node: Node): string[] {
  const out: string[] = [];
  const walk = (n: Node): void => {
    if (n.k === "name") {
      if (!isConstantName(n.name) && !out.includes(n.name)) out.push(n.name);
    } else if (n.k === "neg") walk(n.a);
    else if (n.k === "bin") {
      walk(n.a);
      walk(n.b);
    } else if (n.k === "call") n.args.forEach(walk);
  };
  walk(node);
  return out;
}

/** Arity a function call must have (pow, min and max take more). */
export function arityProblem(node: Node): string | null {
  let problem: string | null = null;
  const walk = (n: Node): void => {
    if (problem) return;
    if (n.k === "call") {
      const want = n.fn === "pow" ? 2 : n.fn === "min" || n.fn === "max" ? -1 : 1;
      if ((want === -1 && n.args.length < 1) || (want > 0 && n.args.length !== want)) problem = `${n.fn}() takes ${want === -1 ? "one or more arguments" : want === 1 ? "one argument" : `${want} arguments`}`;
      n.args.forEach(walk);
    } else if (n.k === "neg") walk(n.a);
    else if (n.k === "bin") {
      walk(n.a);
      walk(n.b);
    }
  };
  walk(node);
  return problem;
}

export type Env = Record<string, number>;

/** The expression as a closure over an environment of names → numbers. A
 *  name the environment lacks reads NaN. */
export function compile(node: Node): (env: Env) => number {
  switch (node.k) {
    case "num": {
      const v = node.v;
      return () => v;
    }
    case "name": {
      const name = node.name;
      if (isConstantName(name)) {
        const v = CONSTANTS[name];
        return () => v;
      }
      return (env) => (has(env, name) ? env[name] : NaN);
    }
    case "neg": {
      const a = compile(node.a);
      return (env) => -a(env);
    }
    case "call": {
      const fn = FUNCTIONS[node.fn];
      const args = node.args.map(compile);
      if (args.length === 1) {
        const a = args[0];
        return (env) => fn(a(env));
      }
      return (env) => fn(...args.map((a) => a(env)));
    }
    case "bin": {
      const a = compile(node.a);
      const b = compile(node.b);
      switch (node.op) {
        case "+":
          return (env) => a(env) + b(env);
        case "-":
          return (env) => a(env) - b(env);
        case "*":
          return (env) => a(env) * b(env);
        case "/":
          return (env) => a(env) / b(env);
        case "%":
          return (env) => a(env) % b(env);
        case "^":
          return (env) => Math.pow(a(env), b(env));
      }
    }
  }
}

// ---- TeX ------------------------------------------------------------------

const GREEK = new Set([
  "alpha", "beta", "gamma", "delta", "epsilon", "zeta", "eta", "theta", "iota", "kappa", "lambda", "mu", "nu", "xi",
  "rho", "sigma", "tau", "upsilon", "phi", "chi", "psi", "omega", "Gamma", "Delta", "Theta", "Lambda", "Xi", "Sigma", "Phi", "Psi", "Omega",
]);

/** A name as TeX: Greek by its name (omega → ω), letters-then-digits as a
 *  subscript (x0 → x₀, k_1 → k₁), a longer word upright. */
export function nameTeX(name: string): string {
  const m = /^([A-Za-z]+)_?(\d+)$/.exec(name);
  if (m) return `${nameTeX(m[1])}_{${m[2]}}`;
  const u = /^([A-Za-z]+)_([A-Za-z0-9]+)$/.exec(name);
  if (u) return `${nameTeX(u[1])}_{${u[2].length === 1 ? u[2] : `\\mathrm{${u[2]}}`}}`;
  if (name === "pi") return "\\pi";
  if (GREEK.has(name)) return `\\${name}`;
  if (name.length === 1) return name;
  return `\\mathrm{${name.replace(/_/g, "\\_")}}`;
}

/** A side of "=" written by the author ("y", "f(x)", "N(t)") as TeX. */
export function lhsTeX(lhs: string): string {
  const s = lhs.trim();
  const call = /^([A-Za-z][A-Za-z0-9_]*)\s*\(\s*([A-Za-z][A-Za-z0-9_]*)\s*\)$/.exec(s);
  if (call) return `${nameTeX(call[1])}(${nameTeX(call[2])})`;
  if (/^[A-Za-z][A-Za-z0-9_]*$/.test(s)) return nameTeX(s);
  return `\\text{${s.replace(/[\\{}$&#^%~]/g, "")}}`;
}

/** How a parameter is written in the TeX. */
export interface ParamWriter {
  /** The parameter's value as the digits to show ("2.0", "-1.25"), or null to write its name. */
  digits(name: string): string | null;
}

/** The marker every parameter's value is wrapped in — the layout finds its
 *  glyphs by it (a token whose ancestor chain holds a `\mathord{…}` entry). */
export const PARAM_MARK = "\\mathord";

const PREC = { sum: 1, product: 2, unary: 3, power: 4, atom: 5 } as const;

/**
 * The expression as TeX with every parameter (any name that is not one of
 * `variables` or a constant) written by `w` — each one
 * wrapped in `\mathord{…}` so the layout can find it, and the parameters in
 * the order `order` lists (reading order: the n-th mark in the TeX is
 * order[n]).
 *
 * Signs read the way a person writes them: a term whose leading factor is a
 * parameter with a negative value turns the "+" before it into "−" and shows
 * the magnitude ("2x² − 3x", not "2x² + −3x"); a negative value elsewhere
 * is bracketed ("x·(−2)").
 */
export function toTeX(root: Node, variables: string | readonly string[], w: ParamWriter): { tex: string; order: string[] } {
  const order: string[] = [];
  const vars = new Set(typeof variables === "string" ? [variables] : variables);
  const isParam = (n: Node): n is { k: "name"; name: string } => n.k === "name" && !vars.has(n.name) && !isConstantName(n.name);
  const negativeParam = (n: Node): boolean => {
    if (!isParam(n)) return false;
    const d = w.digits(n.name);
    return d !== null && d.startsWith("-");
  };
  /** The parameter a product chain starts with ("b" in b*x, b*x^2, b/x), or null. */
  const leading = (n: Node): Node | null => {
    if (isParam(n)) return n;
    if (n.k === "bin" && (n.op === "*" || n.op === "/" || n.op === "%")) return leading(n.a);
    return null;
  };
  const writeParam = (n: { name: string }, abs: boolean, bracketNeg: boolean): string => {
    order.push(n.name);
    const d = w.digits(n.name);
    if (d === null) return `${PARAM_MARK}{${nameTeX(n.name)}}`;
    const body = abs && d.startsWith("-") ? d.slice(1) : d;
    const marked = `${PARAM_MARK}{${body}}`;
    return bracketNeg && body.startsWith("-") ? `\\left(${marked}\\right)` : marked;
  };
  const hasFrac = (s: string): boolean => s.includes("\\frac");
  const paren = (s: string): string => (hasFrac(s) ? `\\left(${s}\\right)` : `(${s})`);

  /**
   * `need`: the loosest precedence this spot takes without brackets.
   * `lead`: the node starts a term (a negative value needs no bracket).
   * `abs`: write this node's leading parameter as its magnitude (the sign
   * went into the operator before it).
   */
  const tex = (n: Node, need: number, lead: boolean, abs: Node | null): string => {
    const [s, prec] = raw(n, lead, abs);
    return prec < need ? paren(s) : s;
  };
  const raw = (n: Node, lead: boolean, abs: Node | null): [string, number] => {
    switch (n.k) {
      case "num":
        return [n.text.replace(/^\./, "0."), PREC.atom];
      case "name":
        if (vars.has(n.name) || isConstantName(n.name)) return [nameTeX(n.name), PREC.atom];
        return [writeParam(n, abs === n, !lead), PREC.atom];
      case "neg":
        return [`-${tex(n.a, PREC.unary, false, null)}`, PREC.unary];
      case "call":
        return [callTeX(n), PREC.atom];
      case "bin": {
        if (n.op === "+" || n.op === "-") {
          const left = tex(n.a, PREC.sum, lead, abs);
          const lp = leading(n.b);
          const flip = lp !== null && negativeParam(lp);
          const op = flip ? (n.op === "+" ? "-" : "+") : n.op;
          const right = tex(n.b, n.op === "-" || flip ? PREC.product : PREC.sum, true, flip ? lp : null);
          return [`${left} ${op} ${right}`, PREC.sum];
        }
        if (n.op === "/") {
          const top = tex(n.a, 0, true, null);
          const bottom = tex(n.b, 0, true, null);
          // A leading negative parameter over something: its sign is the fraction's.
          return [`\\frac{${top}}{${bottom}}`, PREC.atom];
        }
        if (n.op === "^") {
          const base = n.a;
          let b: string;
          if (isParam(base) && negativeParam(base)) b = writeParam(base, false, true);
          else b = tex(base, PREC.power + 1, false, null);
          if (base.k === "call" && base.fn !== "sqrt" && base.fn !== "abs") b = paren(b);
          return [`${b}^{${tex(n.b, 0, true, null)}}`, PREC.power];
        }
        if (n.op === "%") return [`${tex(n.a, PREC.product, lead, abs)} \\bmod ${tex(n.b, PREC.unary, false, null)}`, PREC.product];
        // "*": juxtaposed, unless the right side starts with a digit or a
        // sign ("x · 2", "3 · (−2)"). TeX ignores the space; it only keeps a
        // control word ("\pi") from running into a letter.
        const left = tex(n.a, PREC.product, lead, abs);
        const right = tex(n.b, PREC.unary, false, null);
        const numeric = /^(-|[\d.]|\\mathord\{-?[\d.]|\\left\(\\mathord)/.test(right);
        return [`${left} ${numeric ? "\\cdot " : ""}${right}`, PREC.product];
      }
    }
  };
  const callTeX = (n: { fn: string; args: Node[] }): string => {
    const a = n.args.map((x) => tex(x, 0, true, null));
    const one = a[0] ?? "";
    switch (n.fn) {
      case "exp":
        // A fraction in an exponent is set too small to read (a Gaussian's
        // −(x²+y²)/(2σ²)): then exp(…) on the line instead.
        return hasFrac(one) ? `\\exp\\left(${one}\\right)` : `e^{${one}}`;
      case "sqrt":
        return `\\sqrt{${one}}`;
      case "abs":
        return `\\left|${one}\\right|`;
      case "floor":
        return `\\lfloor ${one} \\rfloor`;
      case "ceil":
        return `\\lceil ${one} \\rceil`;
      case "ln":
      case "log":
        return `\\ln${paren(one)}`;
      case "log10":
        return `\\log_{10}${paren(one)}`;
      case "pow":
        return `${tex(n.args[0], PREC.power + 1, false, null)}^{${a[1] ?? ""}}`;
      case "min":
      case "max":
        return `\\${n.fn}${paren(a.join(", "))}`;
      case "sin":
      case "cos":
      case "tan":
        return `\\${n.fn}${paren(one)}`;
      default:
        return `\\operatorname{${n.fn}}${paren(a.join(", "))}`;
    }
  };

  const s = tex(root, 0, true, null);
  return { tex: s, order };
}
