// The template router (templates design §5a "inference assists, never
// gates", made semantic): a small, cheap model reads the one-line index of
// every ready template plus the request and names the few templates worth
// showing the compiler in full. It matches MEANING — "did the policy work"
// is an event study even though no word overlaps — which the keyword
// selector (catalog.ts selectTemplates) cannot; measured 2026-09-07 the
// keyword selector found the intended template in its top 3 for 80 % of
// the bundled examples, and every miss was a request shaped like a story.
//
// Its answer is a SHORTLIST, not a decision: the compiler still sees the
// whole index, can escalate with need_template, and may compose freehand.
// `none_fits` is the router's honest "nothing here is this figure" — the
// signal a template-on-demand offer will read later.

import type Anthropic from "@anthropic-ai/sdk";
import { callForJson, makeClient, type JsonCallMeta } from "./client";
import { HOT_SHORTLIST, routerIndexText } from "../scenes/catalog";
import { scenes } from "../scenes/registry";

/** Haiku: the index is ~6k cached tokens and the answer five ids — a second, not a minute. */
export const ROUTER_MODEL = "claude-haiku-4-5";

export interface RouteResult {
  /** Ready template ids, best first, at most HOT_SHORTLIST; empty when none fits (or the router had nothing to say). */
  ids: string[];
  /** The router judged that no template draws this figure — the compiler will compose freehand. */
  noneFits: boolean;
  meta?: JsonCallMeta;
}

/** Closed shape: structured outputs accept it, so the reply is always this JSON. */
export const ROUTE_SCHEMA = {
  type: "object",
  properties: {
    ids: { type: "array", items: { type: "string" }, maxItems: HOT_SHORTLIST },
    none_fits: { type: "boolean" },
  },
  required: ["ids", "none_fits"],
  additionalProperties: false,
} as const;

const ROUTER_PROMPT = `You are drawcast's template router. drawcast turns a short teaching request into an animated, narrated figure. It has a library of scene TEMPLATES — parametrized figure generators — listed below, one per line: the template id, what the figure is, what requests it is meant for, and example requests.

Given a request, return the ids of the templates most likely to be THE FIGURE the request is asking for, best first, at most ${HOT_SHORTLIST}. Think about what the request wants to SHOW, not which words it uses: "did the policy work" wants an effect-over-time plot, "one number for a country's inequality" wants a Lorenz curve. Include close runners-up — the compiler makes the final choice from your list and sees only your picks in full. Never invent an id; use only ids from the index.

If no template in the index draws the figure the request needs (the compiler will then draw it freehand), return an empty list and none_fits: true. A template that merely shares a topic is not a fit: a request for a violin's parts is not a piano keyboard.

Reply with JSON only: {"ids": [...], "none_fits": false}.

## Template index

`;

/** The router's system prompt: the instruction plus the index, cached as one block. */
export function buildRouterSystem(index: string = routerIndexText()): Anthropic.TextBlockParam[] {
  return [{ type: "text", text: ROUTER_PROMPT + index, cache_control: { type: "ephemeral" } }];
}

/**
 * The reply, made safe: only ids that name a READY template survive, in
 * order, without duplicates, capped; none_fits is honoured only when the
 * list is empty (a router that names templates AND says none fits is
 * contradicting itself — the ids win, they are checkable).
 */
export function parseRouteReply(json: unknown, readyIds: ReadonlySet<string> = new Set(Object.keys(scenes).filter((id) => scenes[id].manifest.status === "ready"))): { ids: string[]; noneFits: boolean } {
  if (typeof json !== "object" || json === null || Array.isArray(json)) return { ids: [], noneFits: false };
  const r = json as Record<string, unknown>;
  const raw = Array.isArray(r.ids) ? r.ids : [];
  const ids: string[] = [];
  for (const id of raw) {
    if (typeof id !== "string" || !readyIds.has(id) || ids.includes(id)) continue;
    ids.push(id);
    if (ids.length >= HOT_SHORTLIST) break;
  }
  return { ids, noneFits: ids.length === 0 && r.none_fits === true };
}

export interface RouterConfig {
  apiKey: string;
  model?: string;
  signal?: AbortSignal;
  /** Template ids hidden from the compiler's catalog — hidden from the router too. */
  excludeIds?: string[];
}

/** One cheap call: the index + the request in, a validated shortlist out. Throws on API failure (the caller degrades to the keyword selector). */
export async function routeTemplates(request: string, cfg: RouterConfig): Promise<RouteResult> {
  const client = makeClient(cfg.apiKey);
  const system = buildRouterSystem(routerIndexText({ excludeIds: cfg.excludeIds }));
  // No `effort`: Haiku 4.5 rejects the parameter outright (400, measured
  // 2026-09-07), and a five-id answer needs no dial anyway.
  const { json, meta } = await callForJson(client, cfg.model ?? ROUTER_MODEL, system, [{ role: "user", content: request }], ROUTE_SCHEMA as unknown as object, {
    signal: cfg.signal,
    maxTokens: 400,
  });
  const excluded = new Set(cfg.excludeIds ?? []);
  const ready = new Set(Object.keys(scenes).filter((id) => scenes[id].manifest.status === "ready" && !excluded.has(id)));
  return { ...parseRouteReply(json, ready), meta };
}
