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

/** One `@name` found inside `params`: the dotted path it sits at, for
 *  MESSAGES only ("deep.rows.0"), and the container + key it actually
 *  occupies, for writing back without re-parsing that path as a string —
 *  which would mis-traverse a params object that has a literal dotted key
 *  (`{"chart.title": "@x"}`, the same idiom as `bind: {"at.x": "t"}`). */
interface FoundRef {
  path: string;
  name: string;
  host: Record<string, unknown> | unknown[];
  key: string | number;
}

/**
 * The one walk that finds every `@name` inside `params`. `paramAssetRefs`
 * (the public, message-only view) and `resolveParamAssetRefs` (the writer)
 * both stand on this, so they can never disagree about what counts as a
 * reference — and the writer never throws away the container it is standing
 * on only to reconstruct it later by splitting a string.
 *
 * A reference is the WHOLE string or nothing: ASSET_REF is anchored, so
 * "see @openings" is prose and stays prose.
 */
function findParamRefs(params: unknown): FoundRef[] {
  const out: FoundRef[] = [];
  const walk = (value: unknown, path: string, host: Record<string, unknown> | unknown[] | null, key: string | number | null): void => {
    if (typeof value === "string") {
      const name = assetRef(value);
      if (name !== null && host !== null && key !== null) out.push({ path, name, host, key });
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((v, i) => walk(v, path === "" ? String(i) : `${path}.${i}`, value, i));
      return;
    }
    if (value !== null && typeof value === "object") {
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        walk(v, path === "" ? k : `${path}.${k}`, value as Record<string, unknown>, k);
      }
    }
  };
  walk(params, "", null, null);
  return out;
}

/** Write into the container a FoundRef stands on — never a path re-parsed from a string. No `any`: the two host shapes each get their own indexing. */
function setRef(ref: FoundRef, value: unknown): void {
  if (Array.isArray(ref.host)) ref.host[ref.key as number] = value;
  else ref.host[ref.key as string] = value;
}

/**
 * Every `@name` inside `params`, with the dotted path it sits at ("set",
 * "deep.rows.0") — for MESSAGES (semanticErrors, Task 3). Resolution itself
 * goes through findParamRefs directly, never through this path string.
 */
export function paramAssetRefs(params: unknown): { path: string; name: string }[] {
  return findParamRefs(params).map(({ path, name }) => ({ path, name }));
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
  for (const ref of findParamRefs(spec.params)) {
    const value = assets[ref.name];
    // Two references are left STANDING for semanticErrors to report: a name
    // that is not there, and a name whose asset is encoded bytes. Bytes are
    // not data, and silently pasting a base64 string into a param would fail
    // much further downstream, as a template complaining about a type.
    if (value === undefined) {
      dangling.push(ref.name);
      continue;
    }
    if (typeof value === "string") continue;
    setRef(ref, value);
  }
  return dangling;
}

/**
 * Params with every `@name` resolved — the form every VALIDATOR must see.
 * normalizeSpec does this for the render path; this is for the authoring
 * path, which does not go through it (design §4.3). ALWAYS a copy — even
 * when there are no assets to resolve — so a caller can never end up
 * mutating the spec's own params through the result.
 */
export function paramsWithAssets(spec: Pick<Spec, "assets" | "params">): Record<string, unknown> {
  const clone = JSON.parse(JSON.stringify(spec.params ?? {})) as Record<string, unknown>;
  if (spec.assets !== undefined) resolveParamAssetRefs({ assets: spec.assets, params: clone });
  return clone;
}

/**
 * The largest a single asset may be (design §4.5). An error, not a warning:
 * assets land in IndexedDB with the rest of the library, and the course round
 * of 2026-09-18 lost a user's work to a storage limit that failed silently. A
 * named limit with a clear message is that round's lesson.
 */
export const ASSET_MAX_BYTES = 1024 * 1024;

/** An asset's size as serialized — what it costs in the document and in a model call. */
export function assetBytes(value: unknown): number {
  const text = typeof value === "string" ? value : JSON.stringify(value) ?? "";
  // Byte length, not character count: a spec is UTF-8 on disk and on the wire.
  return new TextEncoder().encode(text).length;
}

/** A size the way a person says it: "6 KB", "1.4 MB". The switchover reads
 *  the KB branch's own rounded output, not a second independent threshold —
 *  otherwise a byte count that rounds up to 1024 KB (roughly
 *  [1_048_064, 1_048_576)) prints as "1024 KB" instead of "1 MB" (round 1
 *  review finding, cross-task: Tasks 7 and 8 call this with arbitrary
 *  sizes that land in exactly this gap). */
export function formatAssetSize(bytes: number): string {
  const kb = Math.round(bytes / 1024);
  if (kb >= 1024) {
    const mb = bytes / (1024 * 1024);
    return `${mb >= 10 ? Math.round(mb) : Math.round(mb * 10) / 10} MB`;
  }
  return `${kb} KB`;
}

/**
 * Serialized size beyond which a data asset is DESCRIBED to the model rather
 * than sent (design §5.1). Under it the asset rides into the call and the
 * model may rewrite it, which is what makes "add the Sicilian" work; over it
 * the model gets a line about its shape and cannot touch the rows.
 *
 * 32 KB because a 50-row openings set is 5-6 KB — about 1500 tokens against a
 * system prompt already near 50 000, affordable exactly when the data is
 * there — while a real dataset is not.
 */
export const ASSET_SEND_MAX = 32 * 1024;

/** The marker that opens every descriptor. Never a valid ASSET_REF (it has a space). */
export const DATA_DESCRIPTOR = "@data ";

/**
 * One line naming a data asset's SHAPE, for a model that must not see its
 * contents: "@data 50 rows — name, eco, moves[], idea". Twelve tokens where
 * the rows would have been three thousand, and the model cannot corrupt a row
 * it was never shown.
 *
 * Derived from the value, never authored. The keys come from the FIRST row —
 * a hint, not a schema; a ragged table describes as its first row and that is
 * accepted.
 */
export function describeAsset(value: unknown): string {
  if (Array.isArray(value)) {
    if (value.length === 0) return `${DATA_DESCRIPTOR}0 rows`;
    const first = value[0];
    if (first !== null && typeof first === "object" && !Array.isArray(first)) {
      const row = first as Record<string, unknown>;
      const keys = Object.keys(row).map((k) => (Array.isArray(row[k]) ? `${k}[]` : k));
      return `${DATA_DESCRIPTOR}${value.length} rows — ${keys.join(", ")}`;
    }
    const kind = typeof first === "number" ? "numbers" : typeof first === "string" ? "strings" : "values";
    return `${DATA_DESCRIPTOR}${value.length} ${kind}`;
  }
  if (value !== null && typeof value === "object") {
    return `${DATA_DESCRIPTOR}object — ${Object.keys(value as Record<string, unknown>).join(", ")}`;
  }
  return `${DATA_DESCRIPTOR}value`;
}

/**
 * True for an asset value that is data (rows, numbers, an object) rather
 * than encoded bytes. `null`/`undefined` are excluded too (round 1 review,
 * C1 follow-up): `typeof null === "object"`, so without this a reply that
 * writes `openings:` with nothing after the colon parses as `null`, reads as
 * "data" here, and silently replaces a SENT asset's real rows in
 * restorePortraitStrokes's merge guard — the same class of hole an empty
 * string was, closed the same way.
 */
export function isDataAsset(value: unknown): boolean {
  return value !== null && value !== undefined && typeof value !== "string";
}
