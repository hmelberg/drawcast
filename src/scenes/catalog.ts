// Two-level scene template catalog (M3 Task 2). Below TEMPLATE_FULL_THRESHOLD
// ready templates, every template gets a full entry — the original,
// byte-stable format prompt caching pins (never perturb it below threshold).
// At or above the threshold, the catalog degrades to a complete one-line
// index plus full entries for a "hot set" (forced / keyword-matched /
// priority / core), with an escalation protocol: the LLM asks for a
// template's full definition by name (need_template) instead of guessing its
// parameters from the index line alone.

import { scenes } from "./registry";
import type { SceneManifest } from "./types";
import { PACK_DEFS, packTemplateIds } from "./packs";

export const TEMPLATE_FULL_THRESHOLD = 10;

/** Always promoted to a full entry once the catalog goes two-level. */
const CORE_IDS = ["supply_demand", "decision_tree", "qaly_profiles"];

/**
 * True when id names a registered, ready (rendering) template — a stub, an
 * unregistered id, or a ready manifest whose body failed to compile (no
 * `layout`) all fail this. Shared by the toolbar picker and forced-template
 * (#template=/picker) validation in main.ts, so both use one definition of
 * "usable template".
 */
export function isReadyTemplate(id: string): boolean {
  return scenes[id]?.manifest.status === "ready" && !!scenes[id].layout;
}

export interface CatalogOpts {
  request?: string;
  forced?: string;
  priorityIds?: string[];
}

function fullEntry(manifest: SceneManifest): string {
  return (
    `### Scene template: ${manifest.name} (READY — prefer this when it fits)\n` +
    `${manifest.description}\n` +
    `Parameter schema:\n${JSON.stringify(manifest.params_schema, null, 1)}\n` +
    `Element ids your commands can reference:\n` +
    Object.entries(manifest.element_ids)
      .map(([id, doc]) => `- ${id}: ${doc}`)
      .join("\n") +
    (manifest.examples.length > 0
      ? `\nExamples:\n` +
        manifest.examples
          .map((ex) => `Request: "${ex.request}" → params: ${JSON.stringify(ex.params)}`)
          .join("\n")
      : "")
  );
}

function stubLine(manifest: SceneManifest): string {
  return `### Scene template: ${manifest.name} (STUB — do NOT set template to this)\n${manifest.description}`;
}

function firstSentence(description: string): string {
  const m = /^[^.!?]*[.!?]/.exec(description.trim());
  return (m ? m[0] : description.trim()).trim();
}

function dedupe(ids: string[]): string[] {
  return [...new Set(ids)];
}

// Mirrors src/llm/prompt.ts's keywords() helper (copied, not imported — scenes/
// must not depend on llm/). Extended to keep underscores as word characters:
// template ids are snake_case and must survive tokenization intact.
const STOPWORDS = new Set([
  "draw", "the", "a", "an", "and", "with", "for", "of", "to", "in", "as", "show",
  "make", "create", "illustrate", "diagram", "figure", "me", "please", "that", "this",
]);

function keywords(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-zà-öø-ÿ0-9_]+/)
      .filter((w) => w.length > 2 && !STOPWORDS.has(w)),
  );
}

/** Ready-template ids ranked by keyword overlap of the request against description + example requests. */
export function selectTemplates(request: string, n: number): string[] {
  const target = keywords(request);
  const scored = Object.values(scenes)
    .filter((s) => s.manifest.status === "ready")
    .map((s) => {
      const text = `${s.manifest.description} ${s.manifest.examples.map((e) => e.request).join(" ")}`;
      const kw = keywords(text);
      let overlap = 0;
      for (const w of kw) if (target.has(w)) overlap++;
      const denom = Math.sqrt(kw.size * target.size) || 1;
      return { id: s.manifest.name, score: overlap / denom, overlap };
    })
    .filter((s) => s.overlap > 0)
    .sort((a, b) => b.score - a.score);
  return scored.slice(0, n).map((s) => s.id);
}

export const NEED_TEMPLATE_KEY = "need_template";

/** The escalation marker: an object of exactly { need_template: "<ready id>" }. */
export function detectNeedTemplate(json: unknown): string | null {
  if (typeof json !== "object" || json === null || Array.isArray(json)) return null;
  const keys = Object.keys(json as Record<string, unknown>);
  if (keys.length !== 1 || keys[0] !== NEED_TEMPLATE_KEY) return null;
  const id = (json as Record<string, unknown>)[NEED_TEMPLATE_KEY];
  if (typeof id !== "string") return null;
  return scenes[id]?.manifest.status === "ready" ? id : null;
}

const ESCALATION_PROSE =
  "If the best template for the request appears ONLY in the index above, do not guess its parameters: " +
  'return exactly {"need_template": "<id>"} and nothing else; you will receive its full definition.';

/** Preamble for catalogParts().variable — keeps the shortlist visually distinct from the stable hot set. */
const VARIABLE_PREAMBLE = "Additional likely-relevant template definitions for THIS request:";

/**
 * Split {{CATALOG}} into a cache-stable part and a request-dependent part
 * (M5 Task 2 — the churn seam left by M3/M4: below the two-level threshold,
 * or when forced, the keyword shortlist never runs, so the whole thing is
 * stable and `variable` is empty (byte-identical to the pre-split catalogText
 * output — required for prompt-cache pinning, see catalogText below). Above
 * the threshold, `stable` is built ONLY from configuration that doesn't vary
 * per free-text request (forced/priority/core + the full index + stubs +
 * pack lines + escalation prose) — so it can sit in generateSpec's
 * cache_control prefix and stay byte-identical across different requests
 * sharing the same forced/priority config. `variable` carries the
 * keyword-matched shortlist (selectTemplates(request, …), the one part that
 * genuinely depends on the free-text request) minus anything already
 * promoted into `stable`, so a full entry never appears twice.
 */
export function catalogParts(opts: CatalogOpts = {}): { stable: string; variable: string } {
  const entries = Object.values(scenes);
  const ready = entries.filter((s) => s.manifest.status === "ready");

  if (opts.forced) {
    const forcedModule = scenes[opts.forced];
    if (forcedModule && forcedModule.manifest.status === "ready") {
      return {
        stable: `${fullEntry(forcedModule.manifest)}\n\nYou MUST set "template" to "${opts.forced}" for this request.`,
        variable: "",
      };
    }
  }

  if (ready.length <= TEMPLATE_FULL_THRESHOLD) {
    // Legacy path: byte-identical to the pre-M3 sceneCatalogText() output —
    // required for prompt-cache stability. Do not touch separators/ordering.
    const parts: string[] = [];
    for (const { manifest } of entries) {
      parts.push(manifest.status === "ready" ? fullEntry(manifest) : stubLine(manifest));
    }
    return { stable: parts.join("\n\n"), variable: "" };
  }

  const index = ready.map((s) => `- ${s.manifest.name}: ${firstSentence(s.manifest.description)}`).join("\n");

  // Preference-stable hot set: config only (forced/priority/core), NEVER the
  // free-text request — that's what keeps `stable` identical across requests
  // sharing the same forced template / priority packs (the cache_control pin).
  const stableIds = dedupe([...(opts.forced ? [opts.forced] : []), ...(opts.priorityIds ?? []), ...CORE_IDS]).filter(
    (id) => scenes[id]?.manifest.status === "ready",
  );

  const stubs = entries.filter((s) => s.manifest.status !== "ready");
  const unregisteredPacks = Object.values(PACK_DEFS).filter((p) => packTemplateIds(p.id).length === 0);

  const stableParts: string[] = [index];
  for (const id of stableIds) stableParts.push(fullEntry(scenes[id].manifest));
  for (const s of stubs) stableParts.push(stubLine(s.manifest));
  for (const p of unregisteredPacks) stableParts.push(`Pack available but not enabled: ${p.title} — ${p.description}`);
  stableParts.push(ESCALATION_PROSE);

  const shortlist = selectTemplates(opts.request ?? "", 3).filter(
    (id) => scenes[id]?.manifest.status === "ready" && !stableIds.includes(id),
  );
  const variable = shortlist.length > 0 ? [VARIABLE_PREAMBLE, ...shortlist.map((id) => fullEntry(scenes[id].manifest))].join("\n\n") : "";

  return { stable: stableParts.join("\n\n"), variable };
}

/** The scene catalog injected into the compiler prompt ({{CATALOG}}). */
export function catalogText(opts: CatalogOpts = {}): string {
  const { stable, variable } = catalogParts(opts);
  return stable + (variable ? "\n\n" + variable : "");
}
