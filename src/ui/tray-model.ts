// Pure derivation of explore-sliders from a template's params_schema: any
// number that declares BOTH standard JSON-Schema bounds (minimum/maximum)
// becomes a slider. No bounds, no slider — ranges are never guessed from
// prose. Kept DOM-free so node tests can cover it (tray.ts is the DOM half).

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
}

function boundedNumber(node: SchemaNode): { min: number; max: number; step: number | "any" } | null {
  if ((node.type === "number" || node.type === "integer") && typeof node.minimum === "number" && typeof node.maximum === "number" && node.maximum > node.minimum) {
    const fallback = node.type === "integer" ? 1 : "any";
    return { min: node.minimum, max: node.maximum, step: typeof node.multipleOf === "number" ? node.multipleOf : fallback };
  }
  return null;
}

export function sliderSpecs(schema: unknown): SliderSpec[] {
  const out: SliderSpec[] = [];
  const walk = (node: unknown, path: string): void => {
    if (typeof node !== "object" || node === null) return;
    const n = node as SchemaNode;
    const own =
      boundedNumber(n) ??
      (Array.isArray(n.oneOf) ? (n.oneOf.map((b) => boundedNumber((b ?? {}) as SchemaNode)).find(Boolean) ?? null) : null);
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
