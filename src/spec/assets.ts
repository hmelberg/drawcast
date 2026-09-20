// Long machine-written payloads — traced strokes, photos, icons as base64 —
// kept OUT of the element that uses them (Hans 2026-09-10: "både base64
// bilder og lange path-definisjoner gjør at det kan være vanskelig å raskt
// forflytte og orientere seg i specen"). An element says `strokes: "@foto"`
// and the bytes live under a top-level `assets:` map, which the serializer
// writes LAST so the readable part of the spec stays at the top.
//
// Optional by design: an inline `strokes:` string is still exactly what it
// was. The layout never sees a reference — normalizeSpec (spec/schema.ts)
// inlines every `@name` before anything reads the element — and the four
// resolvers (render/portrait|source|image|icon.ts) read through
// `inlineStrokes` so an element whose bytes sit in `assets` counts as
// embedded.

import type { Spec, SpecElement } from "./types";

/** `@name`: the whole strokes string is a reference into `spec.assets`. */
const ASSET_REF = /^@([A-Za-z0-9_][\w.-]*)$/;

/** The sentinel llm/hoist.ts leaves in a strokes field while the bytes sit
 *  out a model round — spelled like a reference, but never one. */
export const HOISTED = "@pinned";

/** The asset name a strokes string refers to, or null for inline bytes / nothing. */
export function assetRef(strokes: string | undefined): string | null {
  if (typeof strokes !== "string" || strokes === HOISTED) return null;
  const m = ASSET_REF.exec(strokes);
  return m ? m[1] : null;
}

/** The element's strokes as bytes: inline, or looked up in `spec.assets`. A dangling reference reads as undefined. */
export function inlineStrokes(spec: Pick<Spec, "assets">, el: Pick<SpecElement, "strokes">): string | undefined {
  const name = assetRef(el.strokes);
  if (name === null) return el.strokes;
  const value = spec.assets?.[name];
  return typeof value === "string" ? value : undefined;
}

/**
 * Rewrite every `@name` that resolves into its bytes, IN PLACE. References
 * that do not resolve are left as written (the validator reports them —
 * see semanticErrors). Returns the dangling names.
 */
export function resolveAssetRefs(spec: { assets?: unknown; elements?: unknown }): string[] {
  const dangling: string[] = [];
  const assets = typeof spec.assets === "object" && spec.assets !== null ? (spec.assets as Record<string, unknown>) : {};
  for (const el of Array.isArray(spec.elements) ? (spec.elements as { strokes?: unknown }[]) : []) {
    if (!el || typeof el !== "object") continue;
    const name = assetRef(typeof el.strokes === "string" ? el.strokes : undefined);
    if (name === null) continue;
    const value = assets[name];
    if (typeof value === "string") el.strokes = value;
    else dangling.push(name);
  }
  return dangling;
}

/** Inline strokes shorter than this stay where they are: a reference would be no shorter. */
export const HOIST_MIN_LENGTH = 120;

/**
 * Move every long inline `strokes` into `spec.assets`, IN PLACE, named by
 * the element's id (`_2`, `_3`… when that name already holds something
 * else). What the Embed dialog and the file insert call before writing the
 * document back, so the editor shows `strokes: "@foto"` and the bytes at the
 * bottom. Returns how many were moved.
 */
export function hoistStrokes(spec: Spec, minLength = HOIST_MIN_LENGTH): number {
  let moved = 0;
  for (const el of spec.elements ?? []) {
    const s = el.strokes;
    if (typeof s !== "string" || s.length < minLength || assetRef(s) !== null) continue;
    const assets = (spec.assets ??= {});
    let name = el.id;
    for (let n = 2; assets[name] !== undefined && assets[name] !== s; n++) name = `${el.id}_${n}`;
    assets[name] = s;
    el.strokes = `@${name}`;
    moved++;
  }
  return moved;
}

/** The spec with `assets` as its LAST key, for serializing. A new object; the input is untouched. */
export function specForDump<T extends { assets?: unknown }>(spec: T): T {
  if (!("assets" in spec)) return spec;
  const { assets, ...rest } = spec;
  return (assets === undefined ? rest : { ...rest, assets }) as T;
}

/**
 * Every `@name` inside `params`, with the dotted path it sits at ("set",
 * "deep.rows.0"). One walk serves both the resolver below and the semantic
 * errors, so the two can never disagree about what counts as a reference.
 *
 * A reference is the WHOLE string or nothing: ASSET_REF is anchored, so
 * "see @openings" is prose and stays prose.
 */
export function paramAssetRefs(params: unknown): { path: string; name: string }[] {
  const out: { path: string; name: string }[] = [];
  const walk = (value: unknown, path: string): void => {
    if (typeof value === "string") {
      const name = assetRef(value);
      if (name !== null) out.push({ path, name });
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((v, i) => walk(v, path === "" ? String(i) : `${path}.${i}`));
      return;
    }
    if (value !== null && typeof value === "object") {
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        walk(v, path === "" ? k : `${path}.${k}`);
      }
    }
  };
  walk(params, "");
  return out;
}

/** Write `value` at a dotted path inside `params`. The path came from paramAssetRefs, so every host exists. */
function setAtPath(params: unknown, path: string, value: unknown): void {
  const keys = path.split(".");
  let host = params as Record<string, unknown>;
  for (const key of keys.slice(0, -1)) host = host[key] as Record<string, unknown>;
  host[keys[keys.length - 1]] = value;
}

/**
 * Rewrite every `@name` inside `params` into its asset value, IN PLACE.
 * Names that do not resolve are left as written (semanticErrors reports
 * them) and returned. The strokes counterpart is resolveAssetRefs above;
 * normalizeSpec calls both.
 */
export function resolveParamAssetRefs(spec: { assets?: unknown; params?: unknown }): string[] {
  const dangling: string[] = [];
  const assets = typeof spec.assets === "object" && spec.assets !== null ? (spec.assets as Record<string, unknown>) : {};
  for (const { path, name } of paramAssetRefs(spec.params)) {
    const value = assets[name];
    // Two references are left STANDING for semanticErrors to report: a name
    // that is not there, and a name whose asset is encoded bytes. Bytes are
    // not data, and silently pasting a base64 string into a param would fail
    // much further downstream, as a template complaining about a type.
    if (value === undefined) {
      dangling.push(name);
      continue;
    }
    if (typeof value === "string") continue;
    setAtPath(spec.params, path, value);
  }
  return dangling;
}

/**
 * Params with every `@name` resolved — the form every VALIDATOR must see.
 * normalizeSpec does this for the render path; this is for the authoring
 * path, which does not go through it (design §4.3). A copy: the document
 * keeps its references.
 */
export function paramsWithAssets(spec: Pick<Spec, "assets" | "params">): Record<string, unknown> {
  const params = (spec.params ?? {}) as Record<string, unknown>;
  if (spec.assets === undefined) return params;
  const clone = JSON.parse(JSON.stringify(params)) as Record<string, unknown>;
  resolveParamAssetRefs({ assets: spec.assets, params: clone });
  return clone;
}
