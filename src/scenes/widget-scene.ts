// The scene a widget body reads (spec §2.2): the template's parts with their
// boxes and outlines, the painted params, and the domain mappings. Pure —
// built from a layout, never from the DOM.
import { domainMapping, elementBBoxes, elementRings, inverseDomainMapping, type LayoutResult } from "../layout/layout";
import type { MeasureFn } from "../layout/measure";
import type { Pt } from "../layout/model";
import type { Spec } from "../spec/types";
import type { SceneModule } from "./types";
import type { WidgetScene } from "./widget-types";

export interface WidgetSceneOpts {
  domain?: Spec["domain"];
  vars?: Record<string, string>;
  /** The layout on screen; defaults to the module's own layout at `params`. */
  layout?: Pick<LayoutResult, "drawables" | "order" | "fit">;
  measure?: MeasureFn;
  /**
   * The ids on screen at this boundary (the host passes
   * `sceneAt(plan, position).visible` plus what the widget's own patches have
   * revealed). Parts outside it are dropped from `ids`, `boxes` and `rings`:
   * an undrawn pad is not there to click, and blank paper where one will
   * later stand must keep its ordinary meaning. Absent = no filter (the
   * harness and the author's node tests see the whole template).
   */
  visible?: ReadonlySet<string>;
}

/** The keys of the template's params_schema — what a `patch` may name. */
export function paramNamesOf(module: SceneModule): string[] {
  const props = (module.manifest.params_schema as { properties?: Record<string, unknown> }).properties;
  return props ? Object.keys(props) : [];
}

export function buildWidgetScene(module: SceneModule, params: Record<string, unknown>, opts: WidgetSceneOpts = {}): WidgetScene | null {
  if (!module.layout) return null;
  const own = module.layout(params);
  const layout = opts.layout ?? { drawables: own.drawables, order: own.order };
  const ids = opts.visible ? own.order.filter((id) => opts.visible!.has(id)) : own.order.slice();
  const all = elementBBoxes(layout, opts.measure);
  const boxes = new Map([...all].filter(([id]) => ids.includes(id)));
  const rings = new Map([...elementRings(layout)].filter(([id]) => ids.includes(id)));
  const fit = opts.layout?.fit;
  const fwd = domainMapping(opts.domain, fit);
  const inv = opts.domain ? inverseDomainMapping(opts.domain, fit) : null;
  return {
    ids,
    boxes,
    rings,
    params,
    vars: opts.vars ?? {},
    toDomain: (p: Pt) => (inv ? inv(p) : null),
    toLogical: (p: Pt) => fwd.toLogical(p),
  };
}
