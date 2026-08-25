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

// Type-only imports: erased at compile time, so mathjax-full/topojson stay
// entirely inside the lazy chunks their loaders' dynamic imports create.
import type { LiteElement, LiteNode } from "mathjax-full/js/adaptors/lite/Element.js";
import type { Topology, GeometryCollection } from "topojson-specification";
import type { FeatureCollection, Geometry, Polygon, MultiPolygon, Position } from "geojson";
import { sampleSvgPath } from "./svgpath";

export const KNOWN_ENGINES = ["smilesdrawer", "mathjax", "chess", "geo"] as const;

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
   *  baseline row; caller scales.
   *
   *  One `outlines` entry per FILLED SHAPE, not per ring: `pts` is the outer boundary
   *  (a CLOSED polyline sampled from the SVG font path) and `holes` are its counters —
   *  the enclosed rings of "b", "8", "0". Fill the shape with fill-rule evenodd
   *  (kit.area's `holes` option does exactly this) and the counters stay open; ignore
   *  `holes` and they paint solid. Rings are grouped per source glyph `<path>` and
   *  classified by containment, so a glyph whose parts are disjoint rather than nested
   *  ("=" — two bars) yields one entry PER PART, each hole-free. Rules (fraction bars,
   *  \sqrt and \overline overbars) come back as 4-pt rectangles with no holes. */
  layoutTeX(tex: string, opts?: { display?: boolean }): {
    outlines: { pts: [number, number][]; holes?: [number, number][][] }[];
    w: number; h: number;
  };
}

/** Crossing-number point-in-ring; rings from a font never self-intersect, so
 *  one probe point settles containment for a whole ring. */
function pointInRing(p: [number, number], ring: [number, number][]): boolean {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

function ringBox(ring: [number, number][]): { x0: number; y0: number; x1: number; y1: number } {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of ring) {
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  return { x0, y0, x1, y1 };
}

/**
 * Split one glyph's rings into filled shapes and their counters. Depth = how
 * many sibling rings enclose a ring; even depth is a filled shape, odd depth
 * is a hole of its immediate (smallest) container. Fonts never nest deeper
 * than one level, but the parity rule stays correct if one ever does — and it
 * needs no winding information, which the flattened polylines have lost.
 */
function groupRings(rings: [number, number][][]): { pts: [number, number][]; holes?: [number, number][][] }[] {
  if (rings.length === 1) return [{ pts: rings[0] }];
  const boxes = rings.map(ringBox);
  const contains = (j: number, i: number): boolean => {
    const [a, b] = [boxes[j], boxes[i]];
    if (b.x0 < a.x0 || b.x1 > a.x1 || b.y0 < a.y0 || b.y1 > a.y1) return false;
    return pointInRing(rings[i][0], rings[j]);
  };
  const parent = rings.map((_, i) => {
    let best = -1;
    for (let j = 0; j < rings.length; j++) {
      if (j === i || !contains(j, i)) continue;
      const span = (b: number) => (boxes[b].x1 - boxes[b].x0) * (boxes[b].y1 - boxes[b].y0);
      if (best === -1 || span(j) < span(best)) best = j;
    }
    return best;
  });
  const depth = rings.map((_, i) => {
    let n = 0;
    for (let p = parent[i]; p !== -1; p = parent[p]) n++;
    return n;
  });

  const out: { pts: [number, number][]; holes?: [number, number][][] }[] = [];
  const slot = new Map<number, number>();
  rings.forEach((r, i) => {
    if (depth[i] % 2 === 0) {
      slot.set(i, out.length);
      out.push({ pts: r });
    }
  });
  rings.forEach((r, i) => {
    if (depth[i] % 2 === 0) return;
    const at = slot.get(parent[i]);
    if (at === undefined) return;               // unreachable: an odd-depth ring always has an even-depth parent
    (out[at].holes ??= []).push(r);
  });
  return out;
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

  // One entry per source <path>/<rect> — the grouping that says which rings
  // belong to the same glyph, and so which of them are that glyph's counters.
  const collect = (node: LiteElement, parent: Mat, groups: [number, number][][][]): void => {
    const err = adaptor.getAttribute(node, "data-mjx-error");
    // MathJax draws parse errors as a giant labelled box rather than throwing —
    // for a figure that is worse than nothing, so surface it like a parse failure.
    if (err) throw new Error(`TeX error: ${err}`);
    const tf = adaptor.getAttribute(node, "transform");
    const m = tf ? mulMat(parent, parseTransform(tf)) : parent;
    const at = (x: number, y: number): [number, number] => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
    if (adaptor.kind(node) === "path") {
      const rings = sampleSvgPath(adaptor.getAttribute(node, "d") || "").map((ring) => ring.map(([x, y]) => at(x, y)));
      if (rings.length > 0) groups.push(rings);
    } else if (adaptor.kind(node) === "rect") {
      // Rules (fraction bars, \sqrt and \overline overbars) — 4 corners.
      const n = (a: string) => Number(adaptor.getAttribute(node, a) || 0);
      const x = n("x"), y = n("y"), w = n("width"), h = n("height");
      if (w > 0 && h > 0) groups.push([[at(x, y), at(x + w, y), at(x + w, y + h), at(x, y + h)]]);
    }
    // <line> (table/menclose borders) and <text> (unknown-font fallbacks) are
    // strokes and glyphs we cannot sample — skipped rather than faked.
    for (const child of adaptor.childNodes(node)) if (isElement(child)) collect(child, m, groups);
  };

  return {
    layoutTeX(tex, opts = {}) {
      const container = doc.convert(tex, { display: !!opts.display }) as LiteElement;
      const svg = adaptor.tags(container, "svg")[0];
      if (!svg) throw new Error("MathJax produced no SVG");
      const [vx, , vw, vh] = (adaptor.getAttribute(svg, "viewBox") || "0 0 0 0").split(/[\s,]+/).map(Number);
      const groups: [number, number][][][] = [];
      collect(svg, IDENTITY, groups);
      // The walk stays in SVG's y-down user space (the root <g> carries the
      // scale(1,-1) that flips MathJax's y-up layout), so flip back here. The
      // viewBox's left edge becomes x = 0; y = 0 is already the baseline.
      // Normalizing before grouping keeps the containment test in the same
      // space as the points it returns (an affine map preserves containment
      // either way, so this is only about not doing it twice).
      const norm = (ring: [number, number][]): [number, number][] =>
        ring.map(([x, y]) => [(x - vx) / unitsPerEx, -y / unitsPerEx] as [number, number]);
      return {
        outlines: groups.flatMap((rings) => groupRings(rings.map(norm))),
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

export interface GeoEngine {
  /** Natural Earth projection of countries-110m fitted to a w×h box (y-up, origin bottom-left).
   *  `countries("all")` → every country outline, the projection fit to the WHOLE WORLD
   *  FeatureCollection. `countries(["Norway","Sweden"])` → just those, but the projection is
   *  fit to the UNION of only the matched countries (`fitExtent` with a ~4%-of-min(w,h)
   *  margin) — not the whole world — so a small focus selection fills the frame instead of
   *  sitting at its true, tiny share of a world-fitted box.
   *
   *  Antimeridian-safe: before `fitExtent`, the projection is ROTATED so the fit set's own
   *  spherical centroid longitude (`geoCentroid`, which unwraps ±180° correctly — unlike an
   *  arithmetic mean of raw longitudes) sits at the projection's center. Without this, a
   *  selection straddling ±180° (Fiji, Russia, the Aleutians) has raw longitudes at both
   *  extremes of the [-180,180] range, so the naive bounding box spans nearly the whole
   *  projected width no matter how compact the country actually is on the globe — collapsing
   *  it to a sliver once that width is scaled to fit the box. Rotating moves the seam to the
   *  fit set's own antipode, away from any of its geometry. World mode is never rotated.
   *
   *  `o.fitNames` lets the FIT use a smaller/different name set than the shapes/centroids
   *  actually returned — e.g. fit to `focus` + `highlight` only, while still resolving a
   *  `markers`-only country's centroid (which would otherwise dilute the fit if it were far
   *  from the focus set: a marker across the globe shrinks everything else to fit it in too).
   *  Defaults to `names` (today's behavior) when omitted or empty; ignored in `"all"` mode.
   *
   *  (Name match on the world-atlas `properties.name`, case-insensitive; unknown names are
   *  reported in `missing`, not thrown.) Rings become polylines (closed). Requested names are
   *  de-duplicated case-insensitively — `["Norway","Norway"]` yields one Norway shape and an
   *  empty `missing`, not a phantom "missing" entry for the name that was in fact found. */
  countries(names: string[] | "all", o?: { w?: number; h?: number; fitNames?: string[] }): {
    shapes: { name: string; rings: [number, number][][] }[];
    missing: string[];
    /** projected centroid per shape, for labels/markers */
    centroids: Record<string, [number, number]>;
  };
}

type Ring = [number, number][];
type CountryProps = { name: string };

/** Only the two geometry shapes world-atlas's countries-110m ever emits. */
function ringsOfGeometry(geom: Geometry): Position[][] {
  if (geom.type === "Polygon") return geom.coordinates;
  if (geom.type === "MultiPolygon") return geom.coordinates.flat();
  return [];
}

/** Verified against world-atlas@2 countries-110m.json + topojson-client@3.1: `feature()`
 *  yields a 177-entry FeatureCollection keyed by `properties.name`; every geometry is a
 *  Polygon or MultiPolygon (never Point/LineString at this resolution). d3-geo is y-down
 *  (SVG convention) — drawcast is y-up, so every projected y is flipped as `h - y` after
 *  fitting the projection (`fitSize` for "all", `fitExtent` with a margin for a focus
 *  selection — see `countries` below). Projected points that fall outside the projection's
 *  clip (rare at world scale with geoNaturalEarth1, which has no hard clip circle) come back
 *  null from `projection()` and are dropped rather than faked. */
async function loadGeo(): Promise<GeoEngine> {
  const [{ geoNaturalEarth1, geoPath, geoCentroid }, { feature }, atlas] = await Promise.all([
    import("d3-geo"),
    import("topojson-client"),
    import("world-atlas/countries-110m.json"),
  ]);
  // world-atlas ships plain JSON with no .d.ts of its own — treat it as the
  // opaque TopoJSON topology topojson-client's feature() expects.
  const topology = atlas.default as unknown as Topology<{ countries: GeometryCollection<CountryProps> }>;
  const fc: FeatureCollection<Polygon | MultiPolygon, CountryProps> = feature(
    topology,
    topology.objects.countries,
  ) as FeatureCollection<Polygon | MultiPolygon, CountryProps>;

  return {
    countries(names, o = {}) {
      const w = o.w ?? 1000, h = o.h ?? 750;
      const all = names === "all";
      // De-dupe requested names case-insensitively (keeping first-seen casing)
      // BEFORE building `missing`: fc.features has exactly one entry per
      // country, so a repeated request (["Norway","Norway"]) would otherwise
      // only ever get ONE splice out of `missing`, leaving a false leftover
      // entry for a name that was in fact found.
      const requested: string[] = [];
      if (!all) {
        const seen = new Set<string>();
        for (const n of names) {
          const key = n.toLowerCase();
          if (!seen.has(key)) { seen.add(key); requested.push(n); }
        }
      }
      const missing = all ? [] : [...requested];

      // Which features this call will actually draw/centroid — computed
      // BEFORE the projection is built so a focus selection can be fit to
      // just its own union rather than the whole world. Dataset order is
      // preserved (matches fc.features), same as the old single-pass loop.
      const matched = all
        ? fc.features
        : fc.features.filter((f) => {
            const idx = missing.findIndex((n) => n.toLowerCase() === f.properties.name.toLowerCase());
            if (idx === -1) return false;
            missing.splice(idx, 1);
            return true;
          });

      // The set the projection is actually FIT to — independent of `matched`
      // (which decides what gets a shape/centroid). `o.fitNames`, when given
      // a non-empty list, restricts fitting to just those names (matched
      // against the full dataset, not just `matched`, so it's self-contained
      // even if a caller's fitNames isn't a strict subset of `names`) — e.g.
      // fit to `focus`+`highlight` only, while a `markers`-only country far
      // away still gets resolved (via `matched`/`centroids` below) without
      // dragging the fit box out to include it. Omitted/empty fitNames falls
      // back to `matched` itself (today's behavior, and every existing
      // caller).
      let fitMatched = matched;
      if (!all && o.fitNames && o.fitNames.length > 0) {
        const fitKeys = new Set(o.fitNames.map((n) => n.toLowerCase()));
        const restricted = fc.features.filter((f) => fitKeys.has(f.properties.name.toLowerCase()));
        if (restricted.length > 0) fitMatched = restricted;
      }

      const projection = geoNaturalEarth1();
      if (all) {
        projection.fitSize([w, h], fc);
      } else if (fitMatched.length > 0) {
        // Focus mode: fit to the UNION of only the fit set (not the whole
        // world) so a small selection — e.g. the Nordics — fills the frame
        // instead of sitting at its true, tiny share of a world-fitted box.
        const fitFc: FeatureCollection<Polygon | MultiPolygon, CountryProps> = {
          type: "FeatureCollection",
          features: fitMatched,
        };
        // Antimeridian-safe: rotate the sphere so the fit set's own
        // spherical centroid longitude sits at the projection's center
        // BEFORE fitExtent measures its bounds — see the interface doc
        // above for why (a raw-longitude bounding box is wrong for a
        // selection straddling ±180°, e.g. Fiji or Russia).
        const [lon0] = geoCentroid(fitFc);
        projection.rotate([-lon0, 0]);
        // A small margin (~4% of the shorter side) keeps outlines off the
        // very edge.
        const pad = Math.min(w, h) * 0.04;
        projection.fitExtent([[pad, pad], [w - pad, h - pad]], fitFc);
      } else {
        // Nothing to fit to (every requested name is unknown, or fitNames
        // matched nothing) — no shape will be drawn either way, but keep
        // the projection well-defined (fitExtent on an empty collection is
        // degenerate).
        projection.fitSize([w, h], fc);
      }
      const path = geoPath(projection);

      const shapes: { name: string; rings: Ring[] }[] = [];
      const centroids: Record<string, [number, number]> = {};
      for (const f of matched) {
        const name = f.properties.name;
        const rings: Ring[] = ringsOfGeometry(f.geometry)
          .map((ring) => {
            const pts: Ring = [];
            for (const [lon, lat] of ring) {
              const p = projection([lon, lat]);
              if (p) pts.push([p[0], h - p[1]]);
            }
            return pts;
          })
          .filter((ring) => ring.length > 0);
        shapes.push({ name, rings });
        const [cx, cy] = path.centroid(f);
        centroids[name] = [cx, h - cy];
      }
      return { shapes, missing, centroids };
    },
  };
}

export const ENGINE_DEFS: Record<string, { load: () => Promise<unknown> }> = {
  smilesdrawer: { load: loadSmilesDrawer },
  mathjax: { load: loadMathJax },
  chess: { load: loadChess },
  geo: { load: loadGeo },
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
