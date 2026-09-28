// Story first, then stage. Before the JSON call, the creative model writes a
// plain-text TREATMENT — the storyline: question, naive answer, insight,
// example, figure, and the beats with their lines — as a teacher with a sheet
// of what the medium can do, not the API. The ordinary compiler call then
// STAGES it: same system prompt, the treatment riding the user turn.
//
// Born as a prompt-lab arm (docs/2026-09-27-prompt-rule-audit.md, v1/v2);
// since 2026-09-28 the app's default for a single drawcast ("v3", the
// storyline rules), chosen by Settings.approach — "storyboard" writes the
// story first for singles as it already did for parts, "independent" is the
// one-shot call. Builders here are pure.

import treatmentMd from "./prompts/treatment-v1.md?raw";
import treatmentV2Md from "./prompts/treatment-v2.md?raw";
import treatmentV3Md from "./prompts/treatment-v3.md?raw";
import type { Effort } from "./client";

export const TREATMENT_PROMPT_SOURCE: string = treatmentMd;
export const STORYLINE_PROMPT_SOURCE: string = treatmentV3Md;

/**
 * Which treatment sheet: "v1" (run 1 — the teacher also places things on the
 * page), "v2" (the teacher says WHAT is drawn, one main figure; the staging
 * step owns the layout — docs/prompt-lab/2026-09-27-A-vs-C.md) or "v3" (v2
 * plus the storyline rules: the question first, the naive answer, one ghosted
 * change at a time, the figure budget, template interactions, a transfer
 * quiz). v1 and v2 stay for the lab.
 */
export type TreatmentVersion = "v1" | "v2" | "v3";
const SOURCES: Record<TreatmentVersion, string> = { v1: treatmentMd, v2: treatmentV2Md, v3: treatmentV3Md };

/** The storyline call's effort unless GenerateConfig.treatmentEffort says otherwise: the plan is prose, not the teaching's last word. */
export const DEFAULT_TREATMENT_EFFORT: Effort = "medium";

/**
 * What a single drawcast is generated with, from the settings: the storyline
 * (v3) under the default approach, nothing (the one-shot call) under
 * "independent". Developer mode's lab Pipeline "plan" still forces the v2
 * sheet, so the lab's arm C stays reproducible. Parts never read this — they
 * are staged from the storyboard's script (llm/multi.ts).
 */
export function singleCastTreatment(s: { approach: "storyboard" | "independent"; developerMode?: boolean; pipeline?: "standard" | "plan" }): TreatmentVersion | undefined {
  if (s.developerMode && s.pipeline === "plan") return "v2";
  return s.approach === "independent" ? undefined : "v3";
}

/**
 * The treatment call's system prompt: the teacher's sheet, then the templates
 * worth considering for this request. v1/v2: `templateLines` as given (index
 * lines, or v2's full entries). v3: `templateLines` are the shortlist's story
 * lines (catalog.ts storyTemplateLines — description and "Viewer can"), and
 * `index`, when given, is the whole library one line each, so the story can
 * name a template the shortlist missed.
 */
export function buildTreatmentSystem(templateLines: string, version: TreatmentVersion = "v1", index?: string): string {
  if (version === "v3") {
    const parts = [
      templateLines.trim()
        ? `## Templates shortlisted for this request\n\nEach with what the viewer can do with it while paused. Prefer one when it can tell this story.\n\n${templateLines.trim()}`
        : "## Templates shortlisted for this request\n\nNone fits this request closely: plan a freehand figure, unless one in the index below clearly does.",
    ];
    if (index?.trim()) {
      parts.push(`## The rest of the library (one line each)\n\nIf one of these tells the story better than the shortlist, name its id on the TEMPLATE line; its full entry will be fetched.\n\n${index.trim()}`);
    }
    return `${SOURCES.v3.trim()}\n\n${parts.join("\n\n")}\n`;
  }
  const templates = templateLines.trim()
    ? `## Ready figure templates that may fit this request\n\nUse one when it draws what you need; otherwise plan a freehand figure.\n\n${templateLines.trim()}`
    : "## Ready figure templates\n\nNone fits this request closely: plan a freehand figure.";
  return `${SOURCES[version].trim()}\n\n${templates}\n`;
}

/** The treatment call's user turn: the request and any directing brief from #tags. */
export function buildTreatmentUser(request: string, brief?: string): string {
  return [request, brief].filter(Boolean).join("\n\n");
}

/** The template a storyline names on its TEMPLATE line, or null for none / no line. */
export function treatmentTemplate(treatment: string): string | null {
  const m = /^[\s*_#-]*TEMPLATE[\s*_]*:[\s*_]*`?([a-z][a-z0-9_]*)`?/im.exec(treatment);
  if (!m || m[1] === "none" || m[1] === "freehand") return null;
  return m[1];
}

/** A note from staging: a planned template could not do what the story needed. */
export interface TemplateGap {
  template: string;
  missing: string;
}

/** The top-level field the staged reply carries its gap notes in — never part of the spec schema. */
export const TEMPLATE_GAPS_KEY = "template_gaps";

/**
 * Takes the staging step's gap notes off a reply, IN PLACE, before it is
 * validated — so a spec never carries them (the schema is closed, and a
 * published cast must not), and returns them normalised. Anything malformed
 * is dropped, never fatal.
 */
export function takeTemplateGaps(json: unknown): TemplateGap[] {
  if (typeof json !== "object" || json === null || Array.isArray(json)) return [];
  const obj = json as Record<string, unknown>;
  if (!(TEMPLATE_GAPS_KEY in obj)) return [];
  const raw = obj[TEMPLATE_GAPS_KEY];
  delete obj[TEMPLATE_GAPS_KEY];
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((g): g is Record<string, unknown> => typeof g === "object" && g !== null)
    .map((g) => ({ template: String(g.template ?? "").trim(), missing: String(g.missing ?? "").trim() }))
    .filter((g) => g.template !== "" && g.missing !== "")
    .slice(0, 5);
}

/**
 * Appended to the compiler's user turn: the treatment, and how to stage it.
 * v1/v2: the treatment's lines, order and length win over the prompt's
 * general guidance, the medium's facts still hold. v3 (the storyline): lines
 * are sacred, ink is not — staging owns the page and keeps the figure budget,
 * honours the temporary marks, and reports a template that fell short.
 */
export function stagingNote(treatment: string, version: TreatmentVersion = "v1"): string {
  if (version === "v3") {
    return [
      "## The storyline to stage",
      "",
      "A teacher has already written this drawcast's storyline. STAGE it: build the figure it describes and one command per beat, in its order, with its lines as the `speak` text.",
      "- The LINES are sacred: keep what each says and their order. You may tighten a line to fit the ink, split a long one across two beats or merge two short ones — never change its content, reorder, or add new ideas. Its length and opening override the general length and opening guidance in your instructions.",
      "- The INK is not: the layout is yours. You may merge, shrink or drop a planned piece to keep the page clear, and you must keep the figure budget — one main figure, drawn large, and at most one temporary supporting piece (a scratch card, a readout, an inset) on the page at a time.",
      "- Honour every `temporary` mark: erase or fade that piece at the beat it names (erase, fade or clear commands), and fade ghosts and helper lines once they have served.",
      "- Numbers the storyline puts on the canvas go on the canvas; its quiz becomes the closing quiz with its `wrong` hint; its explore beat becomes a pause on the figure.",
      "- Choose the exact verbs, ids, colors and layout yourself, following your instructions; where the storyline asks for something the medium cannot do, do the nearest thing it can.",
      `- If the storyline planned a template that cannot do what the story needs and you draw that part freehand instead, add a top-level field \`"${TEMPLATE_GAPS_KEY}": [{"template": "<id>", "missing": "<what it could not do, in a short phrase>"}]\` to your reply — it is taken off before the spec is checked. Leave it out otherwise.`,
      "- Open with a `card` heading as usual.",
      "",
      treatment.trim(),
    ].join("\n");
  }
  return [
    "## The treatment to stage",
    "",
    "A teacher has already planned this drawcast. STAGE it: build the figure it describes and one command per beat, in its order, with its lines as the `speak` text.",
    "- Keep the lines. You may tighten one to fit the ink, split a long one across two beats, or merge two short ones — never change what it says or add new ideas.",
    "- The treatment's length and opening override the general length and opening guidance in your instructions.",
    "- Choose the exact verbs, ids, colors and layout yourself, following your instructions; where the treatment asks for something the medium cannot do, do the nearest thing it can.",
    "- Open with a `card` heading as usual.",
    "",
    treatment.trim(),
  ].join("\n");
}
