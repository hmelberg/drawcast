import type { Drawable, Pt } from "../layout/model";
import type { LabelRequest } from "../layout/labels";

/** What a scene's deterministic layout code produces. */
export interface SceneLayout {
  drawables: Drawable[];
  labels: LabelRequest[];
  anchors: Record<string, Pt>;
  /** Natural draw order for elements not mentioned in any command. */
  order: string[];
  /**
   * Curve polylines in LOGICAL coordinates, keyed by element id. Seeds tier-2
   * so spec-level region/intersection elements can reference scene curves.
   */
  curveSamples?: Record<string, Pt[]>;
}

/** Intrinsic interactions a template can declare (interactivity spec §6):
 *  the ⊕/tray and the context menu read this one source — never sniff. */
export const KNOWN_INTERACTIONS = ["piano", "chess"] as const;
export type InteractionKind = (typeof KNOWN_INTERACTIONS)[number];

/** Scene manifest — data, improvable by Loop 2 without touching code. */
export interface SceneManifest {
  name: string;
  status: "ready" | "stub";
  description: string;
  params_schema: object;
  element_ids: Record<string, string>;
  examples: { request: string; params: Record<string, unknown> }[];
  engines?: string[];
  /** Explore-in-3D affordance: present when a 3Dmol.js view can be built for this scene. */
  model3d?: { kind: "molecule"; source: "preset" | "smiles" };
  /** Intrinsic interactions the scene offers while paused (free play, exercises). */
  interactions?: InteractionKind[];
}

/** A registered template: manifest always; layout when ready and compiled. */
export interface SceneModule {
  manifest: SceneManifest;
  layout?: (params: Record<string, unknown>) => SceneLayout;
}
