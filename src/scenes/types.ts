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

/** Scene manifest — data, improvable by Loop 2 without touching code. */
export interface SceneManifest {
  name: string;
  status: "ready" | "stub";
  description: string;
  params_schema: object;
  element_ids: Record<string, string>;
  examples: { request: string; params: Record<string, unknown> }[];
  engines?: string[];
}

/** A registered template: manifest always; layout when ready and compiled. */
export interface SceneModule {
  manifest: SceneManifest;
  layout?: (params: Record<string, unknown>) => SceneLayout;
}
