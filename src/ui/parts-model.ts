// The identify drill's data space for ANY figure — interactivity spec §9:
// "identify — 'click the ___'. Universal: any template with named parts can
// generate it." A part is a drawn thing with a hit geometry and a name a
// viewer could be asked to find; the names come from the same sources the
// info card trusts (an authored label and what it attaches to, a node's own
// words, a template's `label_<part>` texts, the scene's own names), and the
// geometry from the same boxes and outlines the click/drag asks use. Nothing
// here knows chess or pianos: those keep their bespoke drills, this one is
// what every OTHER figure — a violin, a flower, the body, a freehand
// flowchart — gets for free. Pure half; ui/quiz.ts is the DOM loop.

import type { Spec } from "../spec/types";
import type { BBox } from "../layout/geometry";
import { meaningfulName } from "./card-model";

export interface Part {
  /** The element whose geometry is the answer. */
  id: string;
  name: string;
  /** Drawn text ids that PRINT the name (a label, its leader, a node's
   *  words): hidden while the drill runs, since a visible name makes "find
   *  the bridge" a reading test; a click on one counts as a hit anyway. */
  nameIds: string[];
  box: BBox;
}

export interface PartFacts {
  /** Command-addressable ids with geometry, in draw order, with their boxes. */
  boxes: ReadonlyMap<string, BBox>;
  /** Every text actually drawn: its id, its words, the top-level drawable it belongs to. */
  texts?: readonly { id: string; text: string; owner?: string }[];
  /** Names the scene knows for its parts (the periodic table's cells). */
  sceneNames?: readonly { id: string; name: string }[];
}

/** Fewer than this and there is nothing to drill — a three-part figure
 *  still asks three honest questions. */
export const MIN_PARTS = 3;

/** Element types that are words or pictures OF something, never a part with an outline of its own. */
const NEVER_A_PART = new Set(["label", "text", "source", "code", "annotation"]);

/**
 * Every part of the figure, in draw order, one per element id. An element
 * named twice (an authored label AND a drawn word) keeps its first name and
 * gains the extra name ids, so the drill hides both.
 */
export function partsOf(spec: Spec, facts: PartFacts): Part[] {
  const out = new Map<string, Part>();
  const typeOf = new Map<string, string>();
  for (const el of spec.elements ?? []) if (typeof el.id === "string") typeOf.set(el.id, el.type);

  const add = (id: string, name: string, nameIds: string[]): void => {
    if (!meaningfulName(name)) return;
    if (id.includes("__")) return; // a sub-drawable is never addressed on its own
    if (NEVER_A_PART.has(typeOf.get(id) ?? "")) return;
    const box = facts.boxes.get(id);
    if (!box) return;
    // A template may draw its own guide from a part to a label placed
    // outside the figure (`<part>_leader`, the violin's bridge): that line
    // points straight at the answer, so it hides with the name.
    const all = [...nameIds, `${id}_leader`];
    const prev = out.get(id);
    if (prev) {
      for (const n of all) if (!prev.nameIds.includes(n)) prev.nameIds.push(n);
      return;
    }
    out.set(id, { id, name: name.trim(), nameIds: all, box });
  };

  // Authored labels name what they attach to; a node's own words name it.
  for (const el of spec.elements ?? []) {
    if (typeof el.id !== "string") continue;
    if (el.type === "label" && typeof el.text === "string" && typeof el.attach_to === "string") {
      add(el.attach_to, el.text, [el.id, `${el.id}_leader`]);
    } else if (el.type === "node" && typeof el.text === "string") {
      const words = (facts.texts ?? []).filter((t) => t.owner === el.id && t.id !== el.id).map((t) => t.id);
      add(el.id, el.text, words);
    } else if (el.type === "portrait" && typeof el.of === "string") {
      add(el.id, el.of, []);
    }
  }

  // A template's own labels: the packs name a part's label `label_<part>`,
  // so the drawn word reaches its part through its id alone — no spec, no
  // attach_to, no engine. The leader that may hang off a moved label shares
  // the label's id with a suffix (layout/labels.ts).
  for (const t of facts.texts ?? []) {
    const m = /^label_(.+)$/.exec(t.id) ?? /^(.+)_label$/.exec(t.id);
    if (!m || m[1] === t.id) continue;
    add(m[1], t.text, [t.id, `${t.id}_leader`]);
  }

  // What the scene knows its parts are called (a cell is iron whatever it printed).
  for (const n of facts.sceneNames ?? []) add(n.id, n.name, []);

  // Draw order, so the drill is deterministic under an injected rng.
  const rank = new Map([...facts.boxes.keys()].map((id, i) => [id, i]));
  return [...out.values()].sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0));
}

export interface PartTarget {
  prompt: string;
  /** The part itself and the words that print its name. */
  accepts: string[];
  /** The part to ring on a miss. */
  reveal: string[];
}

/** n distinct random picks from pool (all of it, shuffled, when n ≥ pool). */
function sample<T>(pool: readonly T[], n: number, rng: () => number): T[] {
  const a = [...pool];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, Math.min(n, a.length));
}

/** "Click: Bridge" — distinct random parts, as many as the figure has up to n. */
export function partsQuizTargets(n: number, parts: readonly Part[], rng: () => number = Math.random): PartTarget[] {
  return sample(parts, n, rng).map((p) => ({ prompt: `Click: ${p.name}`, accepts: [p.id, ...p.nameIds], reveal: [p.id] }));
}
