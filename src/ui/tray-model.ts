// Pure derivation of the explore tray's controls from a template's
// params_schema. Two kinds, one walk each:
//
//   sliderSpecs — any number that declares BOTH standard JSON-Schema bounds
//   (minimum/maximum) becomes a slider, or a `minimum` plus a `x-max-from`
//   hint naming the staged param whose stage count bounds it. No bounds, no
//   slider — ranges are never guessed from prose.
//
//   choiceSpecs — any string that declares a short `enum` becomes a
//   segmented control. No declared enum, no control — the options are never
//   guessed from prose either.
//
// Both are kept DOM-free so node tests can cover them (tray.ts is the DOM
// half).

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
  enum?: unknown;
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

// ---- the enum sibling: a fixed set of words is a segmented control ----------
// A `type: "string"` param with a declared `enum` names modes, not a
// magnitude — oral vs iv, linear vs convex vs concave — so the tray offers
// the words themselves instead of a knob. Only a DECLARED enum counts: a
// description listing the options in prose is not one, the same discipline
// that keeps sliderSpecs from inventing bounds out of a sentence.

export interface ChoiceSpec {
  path: string;
  label: string;
  values: string[];
}

/** Past this a row of buttons stops being readable, and a long enum is an
 *  authoring choice (picked once, in the spec) rather than a knob the viewer
 *  turns while looking at the figure. Six fit; seven is a list. */
const MAX_CHOICES = 6;

function stringEnum(node: SchemaNode): string[] | null {
  if (node.type !== "string" || !Array.isArray(node.enum)) return null;
  // Fewer than two is nothing to choose between; a numeric or mixed enum is
  // not this control (integer enums like `curves: [1, 2, 3]` are counts).
  if (node.enum.length < 2 || node.enum.length > MAX_CHOICES) return null;
  return node.enum.every((v) => typeof v === "string") ? (node.enum as string[]).slice() : null;
}

/** Takes no `params`: unlike a slider's `x-max-from`, an enum is declared in
 *  full by the schema, so there is nothing to resolve against the spec. */
export function choiceSpecs(schema: unknown): ChoiceSpec[] {
  const out: ChoiceSpec[] = [];
  const walk = (node: unknown, path: string): void => {
    if (typeof node !== "object" || node === null) return;
    const n = node as SchemaNode;
    const own =
      stringEnum(n) ?? (Array.isArray(n.oneOf) ? (n.oneOf.map((b) => stringEnum((b ?? {}) as SchemaNode)).find(Boolean) ?? null) : null);
    if (own && path) {
      out.push({ path, label: path.split(".").at(-1)!, values: own });
      return;
    }
    if (typeof n.properties === "object" && n.properties !== null) {
      for (const [key, child] of Object.entries(n.properties)) walk(child, path ? `${path}.${key}` : key);
    }
  };
  walk(schema, "");
  return out;
}

/** The word at a dot path — readParam's sibling (it reads numbers, and a
 *  choice's value is a word). A path whose value is a number belongs to a
 *  slider, so it reads as nothing here: that is what keeps a param offering
 *  both (supply_demand's `steepness`) from growing two controls at once. */
export function readChoice(params: unknown, path: string): string | null {
  const v = resolvePath(params, path);
  return typeof v === "string" ? v : null;
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
  /** Segmented-control param paths, same order, same `params` filter. */
  choices: string[];
  /** Script editors to offer; collapsed unless this one is the point. */
  scripts: { id: string; expanded: boolean }[];
  /** The anatomy Body section: click-to-zoom, breadcrumbs, layer/systems/names. */
  body: boolean;
  /** The solar-system Space section: click a body to focus on it, breadcrumbs, scale/names/date pills, the fact card. */
  space: boolean;
}

export function trayPlan(input: {
  sliderPaths: string[];
  /** Enum param paths — the beat's `params` filter names these the same way. */
  choicePaths?: string[];
  codeIds: string[];
  /** An authored explore beat holds the run open. */
  gated?: boolean;
  /** The beat's `params` filter. */
  params?: string[];
  /** The beat's `code` element. */
  code?: string;
  /** The code element whose screen the viewer clicked. */
  open?: string;
  /** The figure is an anatomy template: it has a body to explore. */
  bodyTemplate?: boolean;
  /** The beat's `anatomy` flag. */
  anatomy?: boolean;
  /** The figure is a solar_system template: it has a sky to explore. */
  spaceTemplate?: boolean;
  /** The beat's `space` flag. */
  space?: boolean;
}): TrayPlan {
  const {
    sliderPaths,
    choicePaths = [],
    codeIds,
    gated = false,
    params,
    code,
    open,
    bodyTemplate = false,
    anatomy,
    spaceTemplate = false,
    space: spaceBeat,
  } = input;
  if (gated) {
    // Named code alone means the author asked for the keyboard, not the
    // knobs; naming both asks for both; naming neither is the old slider gate.
    const scripts = code !== undefined && codeIds.includes(code) ? [{ id: code, expanded: true }] : [];
    // A body beat: asked for by name, or an unnamed gate on an anatomy figure
    // (the body IS what there is to explore). Naming params or code instead
    // asks for those. The body keeps its detail slider beside it.
    const body = bodyTemplate && (anatomy === true || (params === undefined && code === undefined));
    // The same rule for a solar-system figure: asked for by name, or an unnamed gate.
    const space = spaceTemplate && (spaceBeat === true || (params === undefined && code === undefined));
    // Sliders and choices are both "the knobs" here: one `params` filter
    // names them in one list, and a beat that asks for neither gets neither.
    // A body or a space section keeps its knobs beside it either way.
    const wantsParams = params !== undefined || scripts.length === 0 || body || space;
    const pick = (paths: string[]): string[] => (!wantsParams ? [] : params ? paths.filter((p) => params.includes(p)) : paths);
    return { activities: false, sliders: pick(sliderPaths), choices: pick(choicePaths), scripts, body, space };
  }
  // A script opens expanded when it IS the tray (no knob — slider or choice —
  // to compete with) or when the viewer reached it by clicking that screen.
  const expandAll = sliderPaths.length === 0 && choicePaths.length === 0 && open === undefined;
  return {
    activities: true,
    sliders: sliderPaths,
    choices: choicePaths,
    scripts: codeIds.map((id) => ({ id, expanded: expandAll || open === id })),
    body: bodyTemplate,
    space: spaceTemplate,
  };
}
