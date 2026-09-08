// The connect question's rules, DOM-free: which star a tap lands on, how a
// drawn line toggles into and out of existence, which drawn line a tap on
// the canvas lands on, and how a set of drawn lines is judged against the
// key `connectKey` (render/widgets.ts) reads off the figure's own drawing.
// The gate the DOM builds on top of this leans on it entirely; node tests
// cover it, since this repo's vitest has no jsdom anywhere a DOM-side test
// could reach a DOM-side decision.

import type { Pt } from "../layout/model";
import type { ConnectEdge, ConnectStar } from "../render/widgets";

/** Orion's own edge count. Two figures in the pack exceed it — Eridanus
 *  (26), Sagittarius (29) — and are refused by `connectOpens` rather than
 *  shipped as a connect question nobody can finish inside a sane number of
 *  taps. */
export const CONNECT_MAX_EDGES = 24;

/** The nearest star to `p`, or null when even the closest one is farther
 *  than `radius`. Squared distance throughout — a sqrt would only cost time
 *  to answer a question `<=` doesn't need asked. */
export function snapStar(p: Pt, stars: readonly ConnectStar[], radius: number): ConnectStar | null {
  const r2 = radius * radius;
  let best: ConnectStar | null = null;
  let bestD = Infinity;
  for (const s of stars) {
    const dx = s.at[0] - p[0];
    const dy = s.at[1] - p[1];
    const d = dx * dx + dy * dy;
    if (d > r2) continue;
    // Strictly less: a tie keeps the FIRST star within radius (the
    // convention `connectKey` already uses for its own nearest-match) rather
    // than letting whichever star happens to be visited last silently win.
    if (d < bestD) {
      bestD = d;
      best = s;
    }
  }
  return best;
}

/** The one place an edge is built, so every edge in the app is sorted the
 *  same way and a line drawn A→B is indistinguishable from one drawn B→A. */
export function makeEdge(a: string, b: string): ConnectEdge {
  return a < b ? [a, b] : [b, a];
}

/** Element-wise equality on the sorted pair — cheap, and correct only
 *  because `makeEdge` is the sole constructor every caller goes through. */
export function sameEdge(a: ConnectEdge, b: ConnectEdge): boolean {
  return a[0] === b[0] && a[1] === b[1];
}

/** Drawing a line the viewer already drew erases it; drawing a new one adds
 *  it. This is the whole undo model for connect — there is no separate
 *  eraser tool, because clicking the line back over itself already is one. */
export function toggleEdge(drawn: readonly ConnectEdge[], e: ConnectEdge): ConnectEdge[] {
  const i = drawn.findIndex((d) => sameEdge(d, e));
  if (i === -1) return [...drawn, e];
  return [...drawn.slice(0, i), ...drawn.slice(i + 1)];
}

const distToSegment = (p: Pt, a: Pt, b: Pt): number => {
  const vx = b[0] - a[0];
  const vy = b[1] - a[1];
  const len2 = vx * vx + vy * vy;
  // Clamped to [0, 1]: the nearest point on the SEGMENT, not the infinite
  // line through it. Past an end is off the line the viewer actually drew,
  // however close it sits to where that line would continue.
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / len2));
  return Math.hypot(p[0] - (a[0] + t * vx), p[1] - (a[1] + t * vy));
};

/** The drawn line nearest a tap, within `tol`, or null when nothing drawn is
 *  close enough — the gate's way of finding what a tap-to-erase click meant
 *  to remove. Stars not present in `stars` (there should be none) simply
 *  can't anchor a segment and are skipped. */
export function edgeAt(p: Pt, drawn: readonly ConnectEdge[], stars: readonly ConnectStar[], tol: number): ConnectEdge | null {
  const at = new Map(stars.map((s) => [s.id, s.at] as const));
  let best: ConnectEdge | null = null;
  let bestD = Infinity;
  for (const e of drawn) {
    const a = at.get(e[0]);
    const b = at.get(e[1]);
    if (!a || !b) continue;
    const d = distToSegment(p, a, b);
    if (d > tol) continue;
    // Strictly less, same direction as snapStar's tie-break: the FIRST
    // segment within tol wins a tie rather than the last one drawn. Real
    // click geometry never lands exactly equidistant from two drawn
    // segments, so nothing exercises this — it's a consistency choice
    // between this function and its neighbour, not a load-bearing one.
    if (d < bestD) {
      bestD = d;
      best = e;
    }
  }
  return best;
}

export interface ConnectGrade {
  hits: ConnectEdge[];
  missing: ConnectEdge[];
  strays: ConnectEdge[];
  pass: boolean;
}

/** Exact: `pass` iff nothing is missing and nothing is extra. There is no
 *  tolerance constant here and none should be added — the viewer can already
 *  see a stray line and remove it with the same click that drew it, and
 *  submits only when they press Done, so forgiving one stray would just make
 *  the app say "right" about a drawing it is about to paint with a red line. */
export function gradeConnect(drawn: readonly ConnectEdge[], key: readonly ConnectEdge[]): ConnectGrade {
  // De-duplicated defensively: toggleEdge is the only path that builds a
  // drawn list in this app and it can never produce a repeat, but the
  // exported grading function has to be honest about whatever list it is
  // actually handed.
  const seen = new Set<string>();
  const uniqueDrawn: ConnectEdge[] = [];
  for (const e of drawn) {
    // Written as an ESCAPE, never as a literal NUL byte: a raw one in the
    // source makes git treat this whole file as binary, and a module nobody
    // can diff is a module nobody can review.
    const k = `${e[0]}\u0000${e[1]}`;
    if (seen.has(k)) continue;
    seen.add(k);
    uniqueDrawn.push(e);
  }
  const hits = key.filter((k) => uniqueDrawn.some((d) => sameEdge(d, k)));
  const missing = key.filter((k) => !uniqueDrawn.some((d) => sameEdge(d, k)));
  const strays = uniqueDrawn.filter((d) => !key.some((k) => sameEdge(d, k)));
  return { hits, missing, strays, pass: missing.length === 0 && strays.length === 0 };
}

/** The card's running count while the viewer is still drawing. */
export function connectProgress(drawn: number, needed: number): string {
  return `${drawn} / ${needed} lines`;
}

/** The card's line after Done: what was right, and what was extra —
 *  singular/plural on "extra" isn't needed since the count already carries
 *  it. */
export function connectSummary(g: ConnectGrade): string {
  const total = g.hits.length + g.missing.length;
  const extra = g.strays.length;
  return `${g.hits.length} of ${total} lines, ${extra === 0 ? "none extra" : `${extra} extra`}`;
}

/** Whether a gate may open on this key at all — the ONE decision the DOM
 *  gate must not make for itself, because vitest runs in `node` and nothing
 *  in this repo mounts a DOM: a decision left inside a DOM file is a
 *  decision no test will ever see. A figure needs at least one edge to draw
 *  and at least two stars to draw it between, and must not exceed
 *  `CONNECT_MAX_EDGES` (the Eridanus/Sagittarius cap). */
export function connectOpens(key: { stars: readonly unknown[]; edges: readonly unknown[] }): boolean {
  return key.edges.length >= 1 && key.edges.length <= CONNECT_MAX_EDGES && key.stars.length >= 2;
}

/** The median nearest-neighbour distance among a figure's own stars — its
 *  own natural spacing, so a crowded figure (a few close stars) and a
 *  sprawling one each get a press radius sized to themselves rather than one
 *  constant tuned for neither. Pure and DOM-free on purpose, like everything
 *  else here: the gate's own snap radius is derived from this, and a decision
 *  left inside the DOM file is a decision no test will ever see. */
export function medianNearestNeighbour(stars: readonly ConnectStar[]): number {
  const dists = stars.map((s, i) => {
    let best = Infinity;
    for (let j = 0; j < stars.length; j++) {
      if (j === i) continue;
      const d = Math.hypot(stars[j].at[0] - s.at[0], stars[j].at[1] - s.at[1]);
      if (d < best) best = d;
    }
    return best;
  });
  dists.sort((a, b) => a - b);
  const mid = Math.floor(dists.length / 2);
  return dists.length % 2 === 0 ? (dists[mid - 1] + dists[mid]) / 2 : dists[mid];
}

/** Logical-unit clamp on the star-press radius: never so small a real press
 *  misses, never so wide two stars of a crowded figure share it. No
 *  `stars.length < 2` guard — `connectOpens` already refuses anything under
 *  two stars before the gate ever calls this — but `medianNearestNeighbour`
 *  answers `Infinity` for zero or one star regardless, so a direct call
 *  (from a test, or from a caller that skipped connectOpens) still lands on
 *  SNAP_MAX rather than NaN or a radius of zero. */
const SNAP_MIN = 12;
const SNAP_MAX = 40;
export function snapRadiusFor(stars: readonly ConnectStar[]): number {
  const nn = medianNearestNeighbour(stars);
  if (!Number.isFinite(nn)) return SNAP_MAX;
  return Math.max(SNAP_MIN, Math.min(SNAP_MAX, nn * 0.4));
}

/** Escapes a value for interpolation into a CSS attribute selector's quoted
 *  string — `CSS.escape`'s own contract (a valid CSS identifier) already
 *  neutralizes the characters, a quote or a backslash, that would otherwise
 *  let the value break out of the quotes here. Falls back to a minimal
 *  quote/backslash escape when the runtime has no `CSS` global — this repo's
 *  own vitest included, which runs in `environment: "node"`. Exported so
 *  both branches can be pinned by a test rather than only exercised by
 *  whichever one happens to be present. */
export function escapeSelectorValue(s: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") return CSS.escape(s);
  return s.replace(/(["\\])/g, "\\$1");
}

/** The selector that finds every leaf of the figure named `answer` — the
 *  leaf itself (a single-leaf figure) and every leaf of its group
 *  (`answer__0`, `answer__1`, …) — by the `data-leaf-id` attribute
 *  `svg-backend.ts` stamps on every leaf. `answer` is an element id, but is
 *  escaped regardless: an id that happened to carry a quote, interpolated
 *  unescaped, would throw INSIDE `querySelectorAll` — rejecting the promise
 *  the player is awaiting and stopping playback with no message. */
export function hiddenLeafSelector(answer: string): string {
  const esc = escapeSelectorValue(answer);
  return `[data-leaf-id="${esc}"], [data-leaf-id^="${esc}__"]`;
}

/** The restore half of hiding the figure's own lines, as a pure function: a
 *  saved id → previous-opacity map, and a setter the gate wires to a real
 *  DOM node. Every saved id is put back, including one whose saved opacity
 *  was the empty string (no inline opacity at all) — genuinely restoring
 *  that, rather than treating an empty string as "nothing to do" the way a
 *  truthiness check would, is the whole point of pulling this out where a
 *  test can drive it with a fake setter and see whether it does. What's left
 *  in the DOM file is then only the wiring: finding the nodes and touching
 *  their style, the least interesting part of the operation. */
export function restoreOpacity(saved: ReadonlyMap<string, string>, set: (id: string, value: string) => void): void {
  for (const [id, value] of saved) set(id, value);
}
