// The anatomy atlas: named body parts as closed outlines in a shared
// coordinate space, with the part-of tree that drives detail levels and focus.

/** Atlas coordinates: x right, y DOWN, in a 1000 × 2000 box. The template
 *  flips y when it scales onto drawcast's y-up canvas. */
export type AtlasPt = [number, number];

/** One closed outline with optional holes (a skull's orbits, the pelvis's
 *  foramina). First point NOT repeated at the end. */
export interface AtlasRing {
  outer: AtlasPt[];
  holes?: AtlasPt[][];
}

export type AtlasSystem = "skeleton" | "viscera";
export type AtlasKind = "bone" | "joint" | "organ" | "region" | "outline" | "group";

export interface AtlasPart {
  /** Display names. `nb` and `la` fall back to `en`. These NEVER go through
   *  the prose translator. */
  name: { en: string; nb?: string; la?: string };
  system: AtlasSystem;
  kind: AtlasKind;
  /** Part-of parent id, or null for a root. Drives `focus` and the leaf rule. */
  parent: string | null;
  /** The level at which this part is drawn: 1 = region silhouettes and the
   *  big organs, 2 = named bones, joints and the smaller organs, 3 = the small
   *  bones and the fine structures. A part is drawn when its own detail ≤ the
   *  request and none of its geometry-bearing children's is. */
  detail: 1 | 2 | 3;
  /** Draw order within a system, 0 = furthest back. */
  depth: number;
  sex: "any" | "female" | "male";
  /** Optional fill colour; the template falls back to a per-system default. */
  color?: string;
  /** Closed outlines, ALREADY decimated. Empty for a pure grouping part. */
  rings: AtlasRing[];
  /** Optional cross-reference to an open anatomy ontology. */
  uberon?: string;
}

export interface Atlas {
  view: "anterior";
  /** [width, height] of the atlas coordinate box. */
  space: [number, number];
  source: string;
  parts: Record<string, AtlasPart>;
}

/** What a template's `layout` gets as `engines.anatomy`. */
export interface AnatomyEngine {
  /** The body atlas plus the requested systems, merged into one record and
   *  filtered by sex. Detail and the leaf rule are the template's business. */
  parts(q: { systems: AtlasSystem[]; sex: "neutral" | "female" | "male" }): Record<string, AtlasPart>;
  /** The atlas coordinate box, for scaling. */
  space(): [number, number];
}
