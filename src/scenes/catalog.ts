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

/**
 * Where the catalog switches from "full entry for everything" to
 * index + hot set. Until 2026-09-07 this sat ABOVE the default library so
 * every parameter schema stayed in front of the model: the only shortlist
 * was keyword overlap, which found the intended template in its top 5 for
 * 92.6 % of 338 known requests and missed every request shaped like a
 * story. With the template router (src/llm/router.ts — a Haiku call over
 * the index, 94.4 % alone, 97.9 % joined with the keyword picks) the
 * two-level regime became the default: the bundled library (84 ready
 * templates, ~279k chars in full) now reaches the model as a ~24k-char
 * index plus the core and a five-entry shortlist. Below this number — a
 * single-domain library, a host embed — everything is still expanded and
 * no router is needed.
 */
export const TEMPLATE_FULL_THRESHOLD = 40; // lowered 2026-09-07: the router (src/llm/router.ts) makes two-level the default regime

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
  /** Template ids to hide from the catalog entirely (host embeds exclude e.g. molecule_3d). */
  excludeIds?: string[];
  /**
   * A router's picks for THIS request (src/llm/router.ts), best first: in the
   * two-level regime these become the full entries in `variable` instead of
   * the keyword shortlist. Unknown, stub and already-stable ids are dropped;
   * at most HOT_SHORTLIST travel. Absent (or empty) means "use the keyword
   * selector", so a router outage degrades to today's behaviour, never to
   * an index-only prompt.
   */
  shortlist?: string[];
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

/** The "Choose this scene for …" sentence most descriptions carry — the
 *  author's own routing hint, written for exactly this purpose. */
function chooseSentence(description: string): string | null {
  const m = /\b(?:Choose|Use|Pick) this[^.!?]*[.!?]/.exec(description);
  return m ? m[0].trim() : null;
}

/**
 * The index a ROUTER reads (src/llm/router.ts): one line per ready template
 * — id, the first sentence, the "Choose this for…" sentence when there is
 * one, and up to two example requests. Meaning, not keywords, is what the
 * router matches on, so the line carries what a template is FOR rather than
 * its parameter schema. Byte-stable for a given library, so the router's
 * system prompt caches like the compiler's.
 */
export function routerIndexText(opts: { excludeIds?: string[] } = {}): string {
  const excluded = new Set(opts.excludeIds ?? []);
  return Object.values(scenes)
    .filter((s) => s.manifest.status === "ready" && !excluded.has(s.manifest.name))
    .map(({ manifest }) => {
      const choose = chooseSentence(manifest.description);
      const first = firstSentence(manifest.description);
      const examples = manifest.examples
        .slice(0, 2)
        .map((ex) => `"${ex.request}"`)
        .join("; ");
      return `- ${manifest.name}: ${first}${choose && choose !== first ? ` ${choose}` : ""}${examples ? ` e.g. ${examples}` : ""}`;
    })
    .join("\n");
}

/** True when the default library is past the point where every template
 *  gets a full entry — the regime in which a shortlist (router or keyword)
 *  decides what the model sees in full. */
export function catalogIsTwoLevel(excludeIds: string[] = []): boolean {
  const excluded = new Set(excludeIds);
  return Object.values(scenes).filter((s) => s.manifest.status === "ready" && !excluded.has(s.manifest.name)).length > TEMPLATE_FULL_THRESHOLD;
}

/** Full entries for EVERY template regardless of the threshold — the
 *  measurement the pack-budget test and the catalog sweep read. */
export function catalogFullText(opts: { excludeIds?: string[] } = {}): string {
  const excluded = new Set(opts.excludeIds ?? []);
  const parts: string[] = [];
  for (const { manifest } of Object.values(scenes).filter((s) => !excluded.has(s.manifest.name))) {
    parts.push(manifest.status === "ready" ? fullEntry(manifest) : stubLine(manifest));
  }
  for (const p of Object.values(PACK_DEFS).filter((def) => packTemplateIds(def.id).length === 0)) {
    parts.push(`Pack available but not enabled: ${p.title} — ${p.description}`);
  }
  return parts.join("\n\n");
}

/** At most this many router-picked entries travel in full with a request. */
export const HOT_SHORTLIST = 5;

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
  const excluded = new Set(opts.excludeIds ?? []);
  const entries = Object.values(scenes).filter((s) => !excluded.has(s.manifest.name));
  const ready = entries.filter((s) => s.manifest.status === "ready");

  if (opts.forced && !excluded.has(opts.forced)) {
    const forcedModule = scenes[opts.forced];
    if (forcedModule && forcedModule.manifest.status === "ready") {
      return {
        stable: `${fullEntry(forcedModule.manifest)}\n\nYou MUST set "template" to "${opts.forced}" for this request.`,
        variable: "",
      };
    }
  }

  if (ready.length <= TEMPLATE_FULL_THRESHOLD) {
    // Legacy path: byte-identical to the pre-M3 sceneCatalogText() output
    // when every bundled pack is registered — required for prompt-cache
    // stability, so separators/ordering above this point stay untouched.
    // A default-off pack (games/maps — see DEFAULT_OFF_PACKS in ./packs)
    // stays unregistered until a user opts in, and the model has no other
    // way to learn it exists while the catalog sits below the two-level
    // threshold (the "Pack available but not enabled" line otherwise only
    // renders in the two-level branch below) — so append one such line per
    // unregistered pack here too. This does perturb the byte-identical
    // guarantee, but only in a config with an unregistered pack; a cache
    // pinned to a fully-enabled config is unaffected.
    const parts: string[] = [];
    for (const { manifest } of entries) {
      parts.push(manifest.status === "ready" ? fullEntry(manifest) : stubLine(manifest));
    }
    for (const p of Object.values(PACK_DEFS).filter((def) => packTemplateIds(def.id).length === 0)) {
      parts.push(`Pack available but not enabled: ${p.title} — ${p.description}`);
    }
    return { stable: parts.join("\n\n"), variable: "" };
  }

  const index = ready.map((s) => `- ${s.manifest.name}: ${firstSentence(s.manifest.description)}`).join("\n");

  // Preference-stable hot set: config only (forced/priority/core), NEVER the
  // free-text request — that's what keeps `stable` identical across requests
  // sharing the same forced template / priority packs (the cache_control pin).
  const stableIds = dedupe([...(opts.forced ? [opts.forced] : []), ...(opts.priorityIds ?? []), ...CORE_IDS]).filter(
    (id) => scenes[id]?.manifest.status === "ready" && !excluded.has(id),
  );

  const stubs = entries.filter((s) => s.manifest.status !== "ready");
  const unregisteredPacks = Object.values(PACK_DEFS).filter((p) => packTemplateIds(p.id).length === 0);

  const stableParts: string[] = [index];
  for (const id of stableIds) stableParts.push(fullEntry(scenes[id].manifest));
  for (const s of stubs) stableParts.push(stubLine(s.manifest));
  for (const p of unregisteredPacks) stableParts.push(`Pack available but not enabled: ${p.title} — ${p.description}`);
  stableParts.push(ESCALATION_PROSE);

  // The router's picks first, then the keyword selector's, up to HOT_SHORTLIST
  // in all: the two miss DIFFERENT requests (measured 2026-09-07 over 338
  // known cases — router 94.4 % in its top 5, keyword 92.6 %, their union
  // 97.9 %), the router being terse and the keyword selector literal. Without
  // a router it is the keyword selector alone, three deep, as before.
  const routed = opts.shortlist && opts.shortlist.length > 0 ? dedupe(opts.shortlist).slice(0, HOT_SHORTLIST) : [];
  const picks = routed.length > 0 ? dedupe([...routed, ...selectTemplates(opts.request ?? "", HOT_SHORTLIST)]).slice(0, HOT_SHORTLIST) : selectTemplates(opts.request ?? "", 3);
  const shortlist = picks.filter((id) => scenes[id]?.manifest.status === "ready" && !stableIds.includes(id) && !excluded.has(id));
  const variable = shortlist.length > 0 ? [VARIABLE_PREAMBLE, ...shortlist.map((id) => fullEntry(scenes[id].manifest))].join("\n\n") : "";

  return { stable: stableParts.join("\n\n"), variable };
}

/** The scene catalog injected into the compiler prompt ({{CATALOG}}). */
export function catalogText(opts: CatalogOpts = {}): string {
  const { stable, variable } = catalogParts(opts);
  return stable + (variable ? "\n\n" + variable : "");
}
