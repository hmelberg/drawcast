// Revising an existing drawcast: the whole editor document goes out, a whole
// replacement document comes back. Text in, text out — so a single spec and a
// multi-document playlist are ONE path, hand-edits in the textarea ride along,
// and the model can add, drop, reorder and retitle parts rather than only edit
// the ones already there.
//
// Deliberately not a continued conversation: a stateless call also works on a
// document loaded from the library, a bundled example, or a #gdoc= share, and
// its cost does not grow every round.

import type Anthropic from "@anthropic-ai/sdk";
import { itemsOf, parsePlaylistText, type Playlist, formatPlaylist } from "../playlist/playlist";
import { buildSystemBlocks, stripFence, systemBlocks } from "./prompt";
import { validateSpec } from "../spec/schema";
import { hoistPortraitStrokes, restorePortraitStrokes } from "./hoist";
import { layoutSpec } from "../layout/layout";
import { heuristicMeasure, type MeasureFn } from "../layout/measure";
import { lintCommands, lintReportText, type LintIssue } from "../lint/lint";
import { callForText, describeApiError, makeClient } from "./client";
import { apiSchema, fewshotsText, needsRepair, repairModelFor, type PromptVariant } from "./compile";
import { catalogParts } from "../scenes/catalog";
import { ensureEnginesForTemplate } from "../scenes/engines";
import { makeBrowserMeasure } from "../render/svg-backend";

export function buildReviseUser(docText: string, instruction: string): string {
  return [
    "Here is the current drawcast document:",
    "```yaml",
    docText,
    "```",
    "",
    `Apply this change: ${instruction}`,
    "",
    "Return the COMPLETE document in the same shape it came in — one document, or a `---` separated multi-document stream if it already is one.",
    "Change only what the instruction asks for and leave everything else as it is.",
    "Return the document only, with no commentary before or after it.",
  ].join("\n");
}

export function parseReviseReply(text: string): { playlist: Playlist | null; error?: string } {
  try {
    return { playlist: parsePlaylistText(stripFence(text)) };
  } catch (err) {
    return { playlist: null, error: `the reply is not a readable document: ${(err as Error).message}` };
  }
}

/**
 * Validate and lint EVERY item. Errors are prefixed with the item number only
 * when there is more than one — a single-spec document should not be told about
 * "item 1".
 */
export function checkPlaylist(playlist: Playlist, measure: MeasureFn = heuristicMeasure): { errors: string[]; lintIssues: LintIssue[] } {
  const items = itemsOf(playlist);
  if (items.length === 0) return { errors: ["the document has no drawable items"], lintIssues: [] };
  const errors: string[] = [];
  const lintIssues: LintIssue[] = [];
  for (const item of items) {
    const where = items.length > 1 ? `item ${item.index + 1}: ` : "";
    const v = validateSpec(item.spec);
    if (!v.ok) {
      errors.push(...v.errors.map((e) => `${where}${e}`));
      continue;
    }
    try {
      lintIssues.push(...layoutSpec(item.spec, measure).issues);
      lintIssues.push(...lintCommands(item.spec));
    } catch (err) {
      errors.push(`${where}layout failed: ${(err as Error).message}`);
    }
  }
  return { errors, lintIssues };
}

export interface ReviseConfig {
  apiKey: string;
  model: string;
  /** The active compiler prompt — the same one Generate uses, so the cached prefix is reused. */
  variant: PromptVariant;
  /** Priority packs from settings; templates in the document are added automatically. */
  priorityIds?: string[];
  maxRepairs?: number;
  /** Cancels the revision, whichever round is in flight. */
  signal?: AbortSignal;
  /** Called as the model rewrites the document, once per streamed delta. */
  onProgress?: (progress: { label: ReviseRound["label"]; round: number; text: string }) => void;
}

export interface ReviseRound {
  label: "initial" | "repair";
  text: string;
  errors: string[];
  lintIssues: LintIssue[];
  ms: number;
}

export interface ReviseOutcome {
  playlist: Playlist | null;
  /** The accepted document text, exactly as returned (fence stripped). */
  text: string | null;
  rounds: ReviseRound[];
  error?: string;
}

/** Template ids used anywhere in the document — they need FULL catalog entries, not index stubs. */
function templatesIn(playlist: Playlist): string[] {
  return [...new Set(itemsOf(playlist).map((i) => i.spec.template).filter((t): t is string => !!t))];
}

export async function reviseDocument(docText: string, instruction: string, cfg: ReviseConfig): Promise<ReviseOutcome> {
  // Portrait strokes never visit the model (llm/hoist.ts) — swapped for a
  // sentinel here, restored onto the winning revision before returning.
  const hoisted = hoistPortraitStrokes(docText);
  docText = hoisted.text;
  const parsedNow = parseReviseReply(docText);
  if (!parsedNow.playlist) {
    return { playlist: null, text: null, rounds: [], error: `the current document is unreadable: ${parsedNow.error}` };
  }

  // Same system blocks as generation, including the cache_control prefix, so a
  // revise right after a generate reuses the warm ~10k-token cached prompt.
  // Exemplars are deliberately empty: pickExemplars teaches request -> spec
  // authoring, and a revision already has a spec in front of it.
  const priorityIds = [...new Set([...(cfg.priorityIds ?? []), ...templatesIn(parsedNow.playlist)])];
  const catalog = catalogParts({ request: instruction, priorityIds });
  const blocks = buildSystemBlocks(cfg.variant.source, {
    schema: apiSchema(),
    catalog: catalog.stable,
    fewshots: fewshotsText(),
    exemplars: "",
  });
  const suffixText = blocks.suffix + (catalog.variable ? "\n\n" + catalog.variable : "");
  // systemBlocks drops a whitespace-only tail. Passing no exemplars leaves the
  // suffix as just the newline after {{EXEMPLARS}}, which the API rejects.
  const system: Anthropic.TextBlockParam[] = systemBlocks(blocks.prefix, suffixText);

  const messages: Anthropic.MessageParam[] = [{ role: "user", content: buildReviseUser(docText, instruction) }];
  const rounds: ReviseRound[] = [];
  const maxRepairs = cfg.maxRepairs ?? 2;
  let repairsUsed = 0;
  let best: { playlist: Playlist; text: string } | null = null;
  const client = makeClient(cfg.apiKey);
  const measure = makeBrowserMeasure();

  try {
    while (true) {
      const label: ReviseRound["label"] = rounds.length === 0 ? "initial" : "repair";
      const model = label === "initial" ? cfg.model : repairModelFor(cfg.model);
      const round = rounds.length + 1;
      const { text: raw, ms } = await callForText(client, model, system, messages, {
        signal: cfg.signal,
        effort: label === "initial" ? undefined : "low",
        onDelta: cfg.onProgress && ((_delta, text) => cfg.onProgress!({ label, round, text })),
      });
      const cleaned = stripFence(raw);
      const parsed = parseReviseReply(raw);

      let errors: string[] = [];
      let lintIssues: LintIssue[] = [];
      if (!parsed.playlist) {
        errors = [parsed.error!];
      } else {
        // Engines must be loaded before layout — layoutSpec reads them synchronously.
        for (const id of templatesIn(parsed.playlist)) {
          await ensureEnginesForTemplate(id).catch((err) => {
            errors.push(`engine load failed for "${id}": ${(err as Error).message}`);
          });
        }
        const checked = checkPlaylist(parsed.playlist, measure);
        errors = [...errors, ...checked.errors];
        lintIssues = checked.lintIssues;
        if (errors.length === 0) best = { playlist: parsed.playlist, text: cleaned };
      }
      rounds.push({ label, text: cleaned, errors, lintIssues, ms });

      if (!needsRepair(errors, lintIssues) || repairsUsed >= maxRepairs) break;
      repairsUsed++;

      const lintErrors = lintIssues.filter((i) => i.severity === "error");
      const lintWarnings = lintIssues.filter((i) => i.severity === "warn");
      // A repair round never fires for warns alone (needsRepair above), but
      // once one is running for a real problem, warn-severity lint rides
      // along too — free correction, not a reason to spend another round.
      const warningsBlock = lintWarnings.length > 0 ? `\n\nAlso worth fixing while you're at it (non-blocking):\n${lintReportText(lintWarnings)}` : "";
      const feedback =
        errors.length > 0
          ? `The revised document failed validation:\n${errors.join("\n")}${warningsBlock}\n\nReturn the corrected COMPLETE document, in the same shape.`
          : `The revised figure has visual problems:\n${lintReportText(lintErrors)}${warningsBlock}\n\nReturn the corrected COMPLETE document, in the same shape. Typical fixes: different label sides, shorter texts, fewer overlapping elements.`;
      messages.push({ role: "assistant", content: raw }, { role: "user", content: feedback });
    }
  } catch (err) {
    return { playlist: best?.playlist ?? null, text: best?.text ?? null, rounds, error: describeApiError(err) };
  }

  if (best && hoisted.blobs.size > 0) {
    restorePortraitStrokes(best.playlist, hoisted.blobs);
    best = { playlist: best.playlist, text: formatPlaylist(best.playlist, "yaml") };
  }
  return {
    playlist: best?.playlist ?? null,
    text: best?.text ?? null,
    rounds,
    error: best ? undefined : (rounds[rounds.length - 1]?.errors[0] ?? "The model never produced a usable document."),
  };
}
