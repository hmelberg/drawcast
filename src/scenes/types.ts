import type { Drawable, Pt } from "../layout/model";
import type { LabelRequest } from "../layout/labels";
import type { WidgetBody } from "./widget-types";

/** What a scene's deterministic layout code produces. */
/** A layout must build fresh objects on every call: the template fit
 *  (layout/template-fit.ts) mutates what it returns. */
export interface SceneLayout {
  drawables: Drawable[];
  labels: LabelRequest[];
  anchors: Record<string, Pt>;
  /**
   * The chart's data coordinates, when the template draws one: its x and y
   * ranges and the canvas box they fill (before any params.box fit). With
   * it, `{data: [x, y]}` in a cast lands on the template's own axes — an
   * overlay the author no longer has to compute against the template's
   * private plot constants (2026-09-25). Linear axes only.
   */
  frame?: { x: [number, number]; y: [number, number]; box: { x0: number; y0: number; x1: number; y1: number } };
  /** Natural draw order for elements not mentioned in any command. */
  order: string[];
  /**
   * Curve polylines in LOGICAL coordinates, keyed by element id. Seeds tier-2
   * so spec-level region/intersection elements can reference scene curves.
   */
  curveSamples?: Record<string, Pt[]>;
  /**
   * Names for sets of this template's OWN elements — `{pieces: ["piece_a1",
   * …]}`. Naming one in a command stands for every member (the planner's
   * expandOne has always done this for freehand parents; this is the channel
   * a template reaches it through), while each member keeps its own id for
   * everything else: a chess board is `draw: ["board", "squares", "pieces"]`
   * and `piece_e2` is still the thing a beat points at.
   *
   * A group is a NAME, not an element: it belongs to no `order` and draws
   * nothing of its own, or the implicit final draw would paint a phantom.
   */
  groups?: Record<string, string[]>;

  /**
   * Which of this template's ids FOLLOW another — `{wtp_line: ["wtp_label"]}`.
   * A follower goes where its element goes (`move`, `arrange`), fades when it
   * fades, and stays lit when a `focus` keeps it: it is the element's own
   * name, not a thing of its own.
   *
   * The planner has always known this relation, but could only GUESS it from
   * the id: `label_<id>` and nothing else (render/index.ts attachedTo). A
   * template that calls its label anything shorter — `wtp_label` beside
   * `wtp_line`, `label_S` beside `supply_curve` — left it behind, in 70 of
   * the 262 bundled figures (measured 2026-09-21). This is the channel that
   * says it outright instead.
   */
  attached?: Record<string, string[]>;

  /**
   * The numbers the figure stands for, by name — a market's `price`, `dwl`,
   * `revenue` — in the author's units, computed by the same layout call that
   * draws it. Any template may fill it. Because the layout re-runs on every
   * animate frame and slider move, so do these: a cast's own drawn text reads
   * them as `{<namespace>.<key>}` tokens (layout.ts TEMPLATE_VALUES_NAME;
   * `{market.dwl}` for supply_demand) and they stay live (Hans 2026-09-26:
   * "we need … the numbers/results"). Only keys meaningful for the current
   * params are present.
   */
  values?: Record<string, number>;
}

/** Intrinsic interactions a template can declare (interactivity spec §6):
 *  the ⊕/tray and the context menu read this one source — never sniff. */
export const KNOWN_INTERACTIONS = ["piano", "chess", "periodic", "space", "sky", "staff"] as const;
export type InteractionKind = (typeof KNOWN_INTERACTIONS)[number];

/** Explore-tray sections a template can carry; each rides on the engine
 *  named beside it, so a doc may declare one only with that engine. */
export const KNOWN_EXPLORES = { body: "anatomy", space: "space" } as const;
export type ExploreKind = keyof typeof KNOWN_EXPLORES;

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
  model3d?: { kind: "molecule"; source: "preset" | "smiles" } | { kind: "anatomy" };
  /** Intrinsic interactions the scene offers while paused (free play, exercises). */
  interactions?: InteractionKind[];
  /** True when params_schema was widened (data-schema.ts) to accept "{id.var}" tokens. */
  accepts_data?: boolean;
  /** The explore-tray section this scene carries: the Body (anatomy engine) or the Space (space engine) panel. */
  explore?: ExploreKind;
  /** false: never enlarge this template to fill the canvas (layout.ts mayGrow) — for a figure whose size is its meaning. */
  grow?: boolean;
  /** True when the document carries a widget body: the figure is playable while paused. */
  widget?: true;
}

/** A registered template: manifest always; layout when ready and compiled. */
export interface SceneModule {
  manifest: SceneManifest;
  layout?: (params: Record<string, unknown>) => SceneLayout;
  /** A fresh widget body per mount (the doc's `widget` function body, compiled
   *  once — or a built-in's, supply_demand's). A body WITHOUT `manifest.widget`
   *  is free play only: the figure is workable while paused, but it is not
   *  offered as an ask's answer device. */
  widget?: () => WidgetBody;
}
