// Treatment → staging (prompt-lab experiment, arm C — docs/2026-09-27-prompt-
// rule-audit.md): before the JSON call, the creative model writes a plain-text
// TREATMENT — question, insight, example, figure, and the beats with their
// lines — as a teacher with a sheet of what the medium can do, not the API.
// The ordinary compiler call then STAGES it: same system prompt, the
// treatment riding the user turn. Off unless GenerateConfig.treatment is set,
// so the app's own path is unchanged. Builders here are pure.

import treatmentMd from "./prompts/treatment-v1.md?raw";
import treatmentV2Md from "./prompts/treatment-v2.md?raw";

export const TREATMENT_PROMPT_SOURCE: string = treatmentMd;

/**
 * Which treatment sheet: "v1" (run 1 — the teacher also places things on the
 * page) or "v2" (the teacher says WHAT is drawn, one main figure; the staging
 * step owns the layout). docs/prompt-lab/2026-09-27-A-vs-C.md.
 */
export type TreatmentVersion = "v1" | "v2";
const SOURCES: Record<TreatmentVersion, string> = { v1: treatmentMd, v2: treatmentV2Md };

/**
 * The treatment call's system prompt: the teacher's sheet, then the templates
 * worth considering for this request (the router's shortlist as one-liners)
 * so the figure it plans is one the staging step can draw.
 */
export function buildTreatmentSystem(templateLines: string, version: TreatmentVersion = "v1"): string {
  const templates = templateLines.trim()
    ? `## Ready figure templates that may fit this request\n\nUse one when it draws what you need; otherwise plan a freehand figure.\n\n${templateLines.trim()}`
    : "## Ready figure templates\n\nNone fits this request closely: plan a freehand figure.";
  return `${SOURCES[version].trim()}\n\n${templates}\n`;
}

/** The treatment call's user turn: the request and any directing brief from #tags. */
export function buildTreatmentUser(request: string, brief?: string): string {
  return [request, brief].filter(Boolean).join("\n\n");
}

/**
 * Appended to the compiler's user turn: the treatment, and how to stage it.
 * The treatment's lines, order and length win over the prompt's general
 * guidance — that is the experiment — while the medium's facts still hold.
 */
export function stagingNote(treatment: string, _version: TreatmentVersion = "v1"): string {
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
