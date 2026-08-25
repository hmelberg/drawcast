// Engines: heavy notation machinery, lazy-loaded as code-split chunks on
// FIRST USE (spec §4 — enabling a pack never loads an engine). Compiled
// layout closures access engines SYNCHRONOUSLY via getLoadedEngines and
// throw when missing — layoutSpec's catch degrades that to the fall-through
// warning. Async hooks (present/generate/authoring) await ensureEngines
// before any layout runs.

// NOTE: registry.ts is reached only via a function-scope dynamic import in
// ensureEnginesForTemplate below, never a top-level static import here. The
// module cycle is registry → doc → engines → registry (doc.ts imports
// KNOWN_ENGINES; compile.ts imports getLoadedEngines); a static top-level
// `import { scenes } from "./registry"` here forces registry.ts's own
// bottom-of-file registerTemplateYaml(...) call to run WHILE doc.ts is still
// mid-evaluation (doc.ts pulls in engines.ts before its own `const ID_RE =
// ...` line runs), producing a `ID_RE` temporal-dead-zone ReferenceError.
// The dynamic import defers that resolution to call time, after every
// module has finished its own top-level evaluation.

// Type-only import: erased at compile time, so mathjax-full stays entirely
// inside the lazy chunk that loadMathJax's dynamic imports create.
import type { LiteElement, LiteNode } from "mathjax-full/js/adaptors/lite/Element.js";
import { sampleSvgPath } from "./svgpath";

export const KNOWN_ENGINES = ["smilesdrawer", "mathjax", "chess"] as const;

export interface NormalizedMolecule {
  atoms: { x: number; y: number; element: string }[];
  bonds: { a: number; b: number; order: 1 | 2 | 3; aromatic: boolean }[];
  rings: number[][];
}

export interface SmilesEngine {
  layoutSmiles(smiles: string): NormalizedMolecule;
}

/** Verified against smiles-drawer@2.4.1: the canvas-free layout path. */
async function loadSmilesDrawer(): Promise<SmilesEngine> {
  const SD = (await import("smiles-drawer")).default;
  return {
    layoutSmiles(smiles: string): NormalizedMolecule {
      // SD.parse is synchronous (PEG parser + sync callbacks).
      let tree: unknown = null;
      let parseErr: unknown = null;
      SD.parse(smiles, (t: unknown) => (tree = t), (e: unknown) => (parseErr = e));
      if (parseErr || !tree) throw new Error(`SMILES parse failed: ${String(parseErr ?? "no result")}`);
      const drawer = new SD.Drawer({ width: 500, height: 500 });
      const pre = (drawer as unknown as { svgDrawer: { preprocessor: SdPreprocessor } }).svgDrawer.preprocessor;
      pre.initDraw(tree, "light", true, []);
      pre.processGraph();
      const vertices = pre.graph.vertices;
      const atoms = vertices.map((v) => ({ x: v.position.x, y: v.position.y, element: v.value.element }));
      // SSSR ring membership — still what the template needs for drawing ring
      // outlines; whether a given ring is aromatic (for the inner circle) is
      // derived by the caller from its member bonds' own `aromatic` flags.
      const rings = pre.rings.map((r) => [...r.members]);
      const orderOf = (bt: string): 1 | 2 | 3 => (bt === "=" ? 2 : bt === "#" ? 3 : 1);
      // Aromaticity comes straight from the library's own perception
      // (Edge.isPartOfAromaticRing) — NOT from "both endpoints sit in some
      // ring", which would also flag saturated rings (e.g. cyclohexane).
      const bonds = pre.graph.edges.map((e) => ({
        a: e.sourceId,
        b: e.targetId,
        order: orderOf(e.bondType),
        aromatic: !!e.isPartOfAromaticRing,
      }));
      // Normalize: center at origin, max dimension 1 (y flipped to y-up).
      const xs = atoms.map((a) => a.x), ys = atoms.map((a) => a.y);
      const cx = (Math.max(...xs) + Math.min(...xs)) / 2;
      const cy = (Math.max(...ys) + Math.min(...ys)) / 2;
      const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) || 1;
      return {
        atoms: atoms.map((a) => ({ x: (a.x - cx) / span, y: -(a.y - cy) / span, element: a.element })),
        bonds,
        rings,
      };
    },
  };
}

interface SdPreprocessor {
  initDraw(tree: unknown, theme: string, infoOnly: boolean, highlight: unknown[]): void;
  processGraph(): void;
  graph: {
    vertices: { position: { x: number; y: number }; value: { element: string } }[];
    edges: { sourceId: number; targetId: number; bondType: string; isPartOfAromaticRing: boolean }[];
  };
  rings: { members: number[] }[];
}

export interface MathJaxEngine {
  /** TeX → flat drawing-ready geometry. Height-normalized: `h` = 1 for an "x"-height-ish
   *  baseline row; caller scales. Glyph outlines are CLOSED polylines (sampled from the
   *  SVG font paths); rules (fraction bars etc.) come back as 4-pt rectangles. */
  layoutTeX(tex: string, opts?: { display?: boolean }): {
    outlines: { pts: [number, number][] }[];
    w: number; h: number;
  };
}

/** 2×3 affine, SVG's own order: x' = ax + cy + e, y' = bx + dy + f. */
type Mat = [number, number, number, number, number, number];
const IDENTITY: Mat = [1, 0, 0, 1, 0, 0];

function mulMat(m: Mat, n: Mat): Mat {
  return [
    m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

/** Only the four forms MathJax's SVG output emits; anything else is loud. */
function parseTransform(spec: string): Mat {
  let m = IDENTITY;
  for (const fn of spec.matchAll(/([a-zA-Z]+)\s*\(([^)]*)\)/g)) {
    const a = fn[2].trim().split(/[\s,]+/).map(Number);
    switch (fn[1]) {
      case "translate": m = mulMat(m, [1, 0, 0, 1, a[0] || 0, a[1] || 0]); break;
      case "scale": m = mulMat(m, [a[0], 0, 0, a.length > 1 ? a[1] : a[0], 0, 0]); break;
      case "matrix": m = mulMat(m, [a[0], a[1], a[2], a[3], a[4], a[5]]); break;
      case "rotate": {
        const th = ((a[0] || 0) * Math.PI) / 180, cx = a[1] || 0, cy = a[2] || 0;
        const cos = Math.cos(th), sin = Math.sin(th);
        m = mulMat(mulMat(m, [1, 0, 0, 1, cx, cy]), mulMat([cos, sin, -sin, cos, 0, 0], [1, 0, 0, 1, -cx, -cy]));
        break;
      }
      default: throw new Error(`unsupported SVG transform "${fn[1]}"`);
    }
  }
  return m;
}

/** Verified against mathjax-full@3.2.2: the liteAdaptor tex2svg pipeline (no DOM). */
async function loadMathJax(): Promise<MathJaxEngine> {
  const [{ mathjax }, { TeX }, { SVG }, { liteAdaptor }, { RegisterHTMLHandler }] = await Promise.all([
    import("mathjax-full/js/mathjax.js"),
    import("mathjax-full/js/input/tex.js"),
    import("mathjax-full/js/output/svg.js"),
    import("mathjax-full/js/adaptors/liteAdaptor.js"),
    import("mathjax-full/js/handlers/html.js"),
    // Side-effect import: it registers the "ams" package (align, matrices, the
    // extra symbols). Naming a package TeX never registered is silently
    // ignored, so without this line \begin{pmatrix} dies as "unknown
    // environment". AllPackages is the alternative and drags in mhchem et al.
    import("mathjax-full/js/input/tex/ams/AmsConfiguration.js"),
  ]);
  const adaptor = liteAdaptor();
  RegisterHTMLHandler(adaptor);
  // fontCache "none" inlines each glyph's <path> where it is used, so there are
  // no <use>/<defs> indirections to chase — only nested transforms, which the
  // walk below composes.
  const out = new SVG({ fontCache: "none" });
  const doc = mathjax.document("", { InputJax: new TeX({ packages: ["base", "ams"] }), OutputJax: out });
  // MathJax lays out in 1000-units-per-em font coordinates; dividing by the
  // font's x-height puts an "x"-tall baseline row at h ≈ 1.
  const unitsPerEx = 1000 * out.font.params.x_height;

  const isElement = (n: LiteNode): n is LiteElement => adaptor.kind(n) !== "#text";

  const collect = (node: LiteElement, parent: Mat, rings: [number, number][][]): void => {
    const err = adaptor.getAttribute(node, "data-mjx-error");
    // MathJax draws parse errors as a giant labelled box rather than throwing —
    // for a figure that is worse than nothing, so surface it like a parse failure.
    if (err) throw new Error(`TeX error: ${err}`);
    const tf = adaptor.getAttribute(node, "transform");
    const m = tf ? mulMat(parent, parseTransform(tf)) : parent;
    const at = (x: number, y: number): [number, number] => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
    if (adaptor.kind(node) === "path") {
      for (const ring of sampleSvgPath(adaptor.getAttribute(node, "d") || "")) {
        rings.push(ring.map(([x, y]) => at(x, y)));
      }
    } else if (adaptor.kind(node) === "rect") {
      // Rules (fraction bars, \sqrt and \overline overbars) — 4 corners.
      const n = (a: string) => Number(adaptor.getAttribute(node, a) || 0);
      const x = n("x"), y = n("y"), w = n("width"), h = n("height");
      if (w > 0 && h > 0) rings.push([at(x, y), at(x + w, y), at(x + w, y + h), at(x, y + h)]);
    }
    // <line> (table/menclose borders) and <text> (unknown-font fallbacks) are
    // strokes and glyphs we cannot sample — skipped rather than faked.
    for (const child of adaptor.childNodes(node)) if (isElement(child)) collect(child, m, rings);
  };

  return {
    layoutTeX(tex, opts = {}) {
      const container = doc.convert(tex, { display: !!opts.display }) as LiteElement;
      const svg = adaptor.tags(container, "svg")[0];
      if (!svg) throw new Error("MathJax produced no SVG");
      const [vx, , vw, vh] = (adaptor.getAttribute(svg, "viewBox") || "0 0 0 0").split(/[\s,]+/).map(Number);
      const rings: [number, number][][] = [];
      collect(svg, IDENTITY, rings);
      // The walk stays in SVG's y-down user space (the root <g> carries the
      // scale(1,-1) that flips MathJax's y-up layout), so flip back here. The
      // viewBox's left edge becomes x = 0; y = 0 is already the baseline.
      return {
        outlines: rings.map((pts) => ({
          pts: pts.map(([x, y]) => [(x - vx) / unitsPerEx, -y / unitsPerEx] as [number, number]),
        })),
        w: vw / unitsPerEx,
        h: vh / unitsPerEx,
      };
    },
  };
}

export interface ChessEngine {
  /** FEN (or omitted → start position) → 8×8 board, rank 8 first (row 0 = rank 8 = Black's back rank).
   *  Cells: null or { piece: "k"|"q"|"r"|"b"|"n"|"p"; color: "w"|"b" }. Throws on invalid FEN. */
  board(fen?: string): ({ piece: string; color: string } | null)[][];
  /** Play SAN moves from fen/start; returns one entry per ply with the position AFTER the ply.
   *  Throws on an illegal move naming the offending SAN. */
  replay(fen: string | undefined, sans: string[]): {
    san: string; from: string; to: string; piece: string; capture: boolean; check: boolean; mate: boolean;
    fenAfter: string;
  }[];
}

const isFenDigit = (ch: string) => ch >= "0" && ch <= "9";

/** A close port of chess.js@1.4.0's own `validateFen`, with exactly one rule
 *  relaxed: a color may have ZERO kings (a diagram-only position — e.g. a lone
 *  king for a king-and-pawn endgame figure) — but never more than one.
 *
 *  This is a full re-derivation, not a wrapper around chess.js's own
 *  `validateFen` plus a check on its returned message: that function
 *  short-circuits on the FIRST failing criterion (king presence is criterion
 *  10 of 11, checked white-then-black, each with its own early return), so
 *  pattern-matching its message text cannot tell whether a missing king was
 *  the ONLY problem. Verified concretely against the installed package:
 *  "kk6/8/8/8/8/8/8/8 b - - 0 1" (two black kings, no white king) reports only
 *  "missing white king" — the too-many-black-kings problem is never reached —
 *  and "P7/8/8/8/8/8/8/K7 w - - 0 1" (a pawn on rank 8) reports only "missing
 *  black king" — criterion 11 (pawns on the back rank) is never reached
 *  either. Every criterion below is therefore evaluated independently, in
 *  chess.js's own order, rather than chained through its early returns.
 *  Returns an error string, or null when the FEN (bar king *count*) is
 *  well-formed. */
function checkFenForBoard(fen: string): string | null {
  const tokens = fen.split(/\s+/);
  if (tokens.length !== 6) return "Invalid FEN: must contain six space-delimited fields";
  const moveNumber = parseInt(tokens[5], 10);
  if (isNaN(moveNumber) || moveNumber <= 0) return "Invalid FEN: move number must be a positive integer";
  const halfMoves = parseInt(tokens[4], 10);
  if (isNaN(halfMoves) || halfMoves < 0) return "Invalid FEN: half move counter number must be a non-negative integer";
  if (!/^(-|[abcdefgh][36])$/.test(tokens[3])) return "Invalid FEN: en-passant square is invalid";
  if (/[^kKqQ-]/.test(tokens[2])) return "Invalid FEN: castling availability is invalid";
  if (!/^(w|b)$/.test(tokens[1])) return "Invalid FEN: side-to-move is invalid";
  const rows = tokens[0].split("/");
  if (rows.length !== 8) return "Invalid FEN: piece data does not contain 8 '/'-delimited rows";
  for (const row of rows) {
    let sum = 0, prevWasDigit = false;
    for (const ch of row) {
      if (isFenDigit(ch)) {
        if (prevWasDigit) return "Invalid FEN: piece data is invalid (consecutive number)";
        sum += Number(ch);
        prevWasDigit = true;
      } else {
        if (!/^[prnbqkPRNBQK]$/.test(ch)) return "Invalid FEN: piece data is invalid (invalid piece)";
        sum += 1;
        prevWasDigit = false;
      }
    }
    if (sum !== 8) return "Invalid FEN: piece data is invalid (too many squares in rank)";
  }
  if ((tokens[3][1] === "3" && tokens[1] === "w") || (tokens[3][1] === "6" && tokens[1] === "b")) {
    return "Invalid FEN: illegal en-passant square";
  }
  for (const [color, re] of [["white", /K/g], ["black", /k/g]] as const) {
    if ((tokens[0].match(re) || []).length > 1) return `Invalid FEN: too many ${color} kings`;
  }
  if (Array.from(rows[0] + rows[7]).some((ch) => ch.toUpperCase() === "P")) {
    return "Invalid FEN: some pawns are on the edge rows";
  }
  return null;
}

/** Verified against chess.js@1.4.0: named `Chess` export, board() rank-8-first, verbose move(). */
async function loadChess(): Promise<ChessEngine> {
  const { Chess } = await import("chess.js");

  const load = (fen?: string): InstanceType<typeof Chess> => {
    if (fen === undefined) return new Chess();
    const err = checkFenForBoard(fen);
    if (err) throw new Error(err);
    // Our own check above already enforces every structural criterion
    // chess.js's validateFen would (row/field shape, piece characters, king
    // COUNT); skipValidation here only bypasses chess.js re-checking king
    // PRESENCE, which is the one rule we deliberately relaxed.
    return new Chess(fen, { skipValidation: true });
  };

  return {
    board(fen) {
      return load(fen).board().map((row) =>
        row.map((cell) => (cell ? { piece: cell.type, color: cell.color } : null)),
      );
    },
    replay(fen, sans) {
      const game = load(fen);
      return sans.map((san) => {
        let m;
        try {
          m = game.move(san);
        } catch {
          throw new Error(`illegal move "${san}"`);
        }
        return {
          san: m.san,
          from: m.from,
          to: m.to,
          piece: m.piece,
          capture: !!m.captured,
          check: game.isCheck(),
          mate: game.isCheckmate(),
          fenAfter: game.fen(),
        };
      });
    },
  };
}

export const ENGINE_DEFS: Record<string, { load: () => Promise<unknown> }> = {
  smilesdrawer: { load: loadSmilesDrawer },
  mathjax: { load: loadMathJax },
  chess: { load: loadChess },
};

const cache = new Map<string, unknown>();

export function enginesLoaded(names: string[]): boolean {
  return names.every((n) => cache.has(n));
}

export async function ensureEngines(names: string[]): Promise<void> {
  for (const n of names) {
    if (cache.has(n)) continue;
    const def = ENGINE_DEFS[n];
    if (!def) throw new Error(`unknown engine "${n}"`);
    cache.set(n, await def.load());
  }
}

export function getLoadedEngines(names: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const n of names) {
    if (!cache.has(n)) throw new Error(`engine "${n}" not loaded — this template needs it`);
    out[n] = cache.get(n);
  }
  return out;
}

export async function ensureEnginesForTemplate(id: string): Promise<void> {
  const { scenes } = await import("./registry");
  const engines = scenes[id]?.manifest.engines;
  if (engines && engines.length > 0) await ensureEngines(engines);
}

export async function ensureEnginesForSpecs(specs: { template?: string }[]): Promise<void> {
  for (const s of specs) if (s.template) await ensureEnginesForTemplate(s.template);
}
