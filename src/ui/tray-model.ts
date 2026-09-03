// Pure derivation of explore-sliders from a template's params_schema: any
// number that declares BOTH standard JSON-Schema bounds (minimum/maximum)
// becomes a slider, or a `minimum` plus a `x-max-from` hint naming the
// staged param whose stage count bounds it. No bounds, no slider — ranges
// are never guessed from prose. Kept DOM-free so node tests can cover it
// (tray.ts is the DOM half).

export interface SliderSpec {
  path: string;
  label: string;
  min: number;
  max: number;
  step: number | "any";
}

interface SchemaNode {
  type?: unknown;
  properties?: Record<string, unknown>;
  oneOf?: unknown[];
  minimum?: unknown;
  maximum?: unknown;
  multipleOf?: unknown;
  "x-max-from"?: unknown;
}

/** Walks a dot path (object keys and array indices, e.g. "series.0.values") through params. */
function resolvePath(params: unknown, path: string): unknown {
  let cur: unknown = params;
  for (const seg of path.split(".")) {
    if (typeof cur !== "object" || cur === null) return undefined;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur;
}

/** A staged value: an array of stages whose first stage is itself an array, with at least 2 stages. */
function stageCount(value: unknown): number | null {
  return Array.isArray(value) && Array.isArray(value[0]) && value.length >= 2 ? value.length : null;
}

function boundedNumber(node: SchemaNode, params?: Record<string, unknown>): { min: number; max: number; step: number | "any" } | null {
  if ((node.type === "number" || node.type === "integer") && typeof node.minimum === "number" && typeof node.maximum === "number" && node.maximum > node.minimum) {
    const fallback = node.type === "integer" ? 1 : "any";
    return { min: node.minimum, max: node.maximum, step: typeof node.multipleOf === "number" ? node.multipleOf : fallback };
  }
  const hint = node["x-max-from"];
  if (typeof node.maximum !== "number" && typeof node.minimum === "number" && (typeof hint === "string" || Array.isArray(hint))) {
    const candidates = typeof hint === "string" ? [hint] : hint;
    for (const path of candidates) {
      if (typeof path !== "string") continue;
      const stages = stageCount(resolvePath(params, path));
      if (stages !== null) return { min: node.minimum, max: stages - 1, step: "any" };
    }
  }
  return null;
}

export function sliderSpecs(schema: unknown, params?: Record<string, unknown>): SliderSpec[] {
  const out: SliderSpec[] = [];
  const walk = (node: unknown, path: string): void => {
    if (typeof node !== "object" || node === null) return;
    const n = node as SchemaNode;
    const own =
      boundedNumber(n, params) ??
      (Array.isArray(n.oneOf) ? (n.oneOf.map((b) => boundedNumber((b ?? {}) as SchemaNode, params)).find(Boolean) ?? null) : null);
    if (own && path) {
      out.push({ path, label: path.split(".").at(-1)!, ...own });
      return;
    }
    if (typeof n.properties === "object" && n.properties !== null) {
      for (const [key, child] of Object.entries(n.properties)) walk(child, path ? `${path}.${key}` : key);
    }
  };
  walk(schema, "");
  return out;
}

// ---- what one tray shows (the composition rule) -----------------------------
// The ⊕ is the figure's whole control surface (interactivity spec §7.2: "the
// full menu of the scene's interactions"), so it shows everything the figure
// offers AT ONCE — sliders and any script on screen, never one instead of the
// other. An authored `explore` beat is the opposite: it shows exactly what it
// named, because that is the author's invitation, not the viewer's workbench.
// Kept DOM-free so node tests can hold the rule; tray.ts renders it.

export interface TrayPlan {
  /** The activity pill row (quiz, play-vs-computer) — never during a gate. */
  activities: boolean;
  /** Slider param paths, in the order the schema yielded them. */
  sliders: string[];
  /** Script editors to offer; collapsed unless this one is the point. */
  scripts: { id: string; expanded: boolean }[];
}

export function trayPlan(input: {
  sliderPaths: string[];
  codeIds: string[];
  /** An authored explore beat holds the run open. */
  gated?: boolean;
  /** The beat's `params` filter. */
  params?: string[];
  /** The beat's `code` element. */
  code?: string;
  /** The code element whose screen the viewer clicked. */
  open?: string;
}): TrayPlan {
  const { sliderPaths, codeIds, gated = false, params, code, open } = input;
  if (gated) {
    // Named code alone means the author asked for the keyboard, not the
    // knobs; naming both asks for both; naming neither is the old slider gate.
    const scripts = code !== undefined && codeIds.includes(code) ? [{ id: code, expanded: true }] : [];
    const wantsSliders = params !== undefined || scripts.length === 0;
    const sliders = !wantsSliders ? [] : params ? sliderPaths.filter((p) => params.includes(p)) : sliderPaths;
    return { activities: false, sliders, scripts };
  }
  // A script opens expanded when it IS the tray (no sliders to compete with)
  // or when the viewer reached it by clicking that very screen.
  const expandAll = sliderPaths.length === 0 && open === undefined;
  return {
    activities: true,
    sliders: sliderPaths,
    scripts: codeIds.map((id) => ({ id, expanded: expandAll || open === id })),
  };
}
