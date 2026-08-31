// Building a subtitle track: collect the lines the caption can show, ask for
// them in one call, and put the answer back on the spec.
//
// This is the authoring half of spec/subtitles.ts. It lives here, above the
// spec layer, because collecting the lines means reading the PLAN — the same
// structure the player consumes — and because it talks to a model. Nothing in
// spec/ or render/ depends on it; playback never calls any of this.
//
// Narrower than translateSpec by design. That one rewrites everything a
// drawcast says AND everything it draws, for a whole translated copy bound for
// YouTube. A subtitle track is text under the picture: the labels stay put, the
// voice stays put, and only what the caption displays is sent.

import { callForJson, makeClient, type CallOpts } from "./client";
import { planCommands } from "../render/plan";
import type { SubtitleTrack } from "../spec/subtitles";
import type { Spec } from "../spec/types";

/**
 * Every line the caption can display, unsubstituted and deduplicated.
 *
 * Read off the PLAN rather than the raw commands: planCommands is what decides
 * whether a `speak` becomes a step's narration or a step of its own, and a
 * second reading of those rules here would be a copy that drifts. The quiz and
 * ask feedback fields are plain fields on the step and are taken directly.
 *
 * Unsubstituted is the point: the caption is translated BEFORE {var} tokens are
 * filled in (see Player.showCaption), so these raw lines are the track's keys.
 *
 * Deliberately not collectSpeakLines (export/video.ts), which substitutes vars
 * and walks the MOVIE's path — where every question is answered correctly and
 * the `wrong` line is never spoken. A live viewer who answers wrong is exactly
 * the person who needs it subtitled.
 */
export function captionLines(spec: Spec): string[] {
  const out = new Set<string>();
  const add = (text: unknown): void => {
    if (typeof text === "string" && text.trim().length > 0) out.add(text);
  };
  for (const step of planCommands(spec.commands ?? [], []).steps) {
    add(step.narration);
    if (step.kind === "speak") add(step.text);
    if (step.kind === "quiz") {
      add(step.right);
      add(step.wrong);
      // The reveal after a wrong answer: the author's line, or the correct
      // choice read out when there isn't one.
      add(step.right ?? step.choices[step.correct]);
    }
    if (step.kind === "ask") {
      add(step.right);
      add(step.wrong);
      add(step.right ?? step.answer);
    }
  }
  return [...out];
}

/**
 * A COPY of the spec carrying `track` as its subtitles for `code`. Never
 * mutates: exportSequence and the library hand out the document's own spec
 * objects by reference, so writing in place would rewrite the user's drawcast.
 * An empty track removes the language rather than leaving an entry the CC menu
 * would offer and then fail to fill.
 */
export function withSubtitles(spec: Spec, code: string, track: SubtitleTrack): Spec {
  const subtitles = { ...spec.subtitles };
  if (Object.keys(track).length === 0) delete subtitles[code];
  else subtitles[code] = track;
  const out: Spec = { ...spec };
  if (Object.keys(subtitles).length === 0) delete out.subtitles;
  else out.subtitles = subtitles;
  return out;
}

const SYSTEM = `You subtitle drawcasts: short animated explanations where a narrator speaks while a figure is drawn.

You are given the whole spec as context and a list of spoken lines. Reply with a JSON object mapping each source line to its subtitle in the target language. Include every line; translate nothing else.

- These lines are SPOKEN aloud and shown as subtitles under the picture. Write what a good lecturer would say in the target language, not a literal rendering of the English.
- Keep each line close to the length of the source: it is timed against the drawing, and it has to fit on two short lines of subtitle.
- Keep established technical terms and abbreviations that the field uses untranslated (QALY, ICER, DNA, p-value) unless the target language has a genuinely standard equivalent.
- Copy anything in curly braces exactly: {score}, {answer}. They are substituted at playback.
- The figure's own labels are NOT being translated and stay in the source language. Where a line names a label, use wording a viewer can match to the word on screen.
- Numbers, units and proper names stay as they are.`;

const SCHEMA = {
  type: "object",
  description: "Source line → subtitle, one entry per requested line.",
  additionalProperties: { type: "string" },
} as const;

export interface SubtitleConfig {
  apiKey: string;
  model: string;
}

export interface SubtitleResult {
  track: SubtitleTrack;
  /** Sent but unanswered: these keep their source wording rather than vanish. */
  missing: string[];
  /** Answered but never sent — dropped, and worth showing: the model was inventing. */
  unknown: string[];
}

/**
 * Reduce the reply to what we are willing to show. Only lines we sent, only
 * non-blank answers: a blank subtitle is a caption that goes empty mid-
 * sentence, which reads as a bug, where an untranslated one merely reads as
 * untranslated.
 */
export function verifySubtitles(sent: string[], received: unknown): SubtitleResult {
  const wanted = new Set(sent);
  const track: SubtitleTrack = {};
  const unknown: string[] = [];
  if (received && typeof received === "object" && !Array.isArray(received)) {
    for (const [key, value] of Object.entries(received as Record<string, unknown>)) {
      if (!wanted.has(key)) {
        unknown.push(key);
        continue;
      }
      if (typeof value === "string" && value.trim().length > 0) track[key] = value;
    }
  }
  return { track, missing: sent.filter((line) => !(line in track)), unknown };
}

/** Ask for one language's track. The spec goes along as context — a subtitle
 *  reads badly without knowing what is being drawn while it is said. */
export async function translateSubtitles(
  spec: Spec,
  target: { code: string; label: string },
  cfg: SubtitleConfig,
  opts: CallOpts = {},
): Promise<SubtitleResult> {
  const sent = captionLines(spec);
  if (sent.length === 0) return { track: {}, missing: [], unknown: [] };
  const listing = sent.map((line) => `- ${JSON.stringify(line)}`).join("\n");
  const { json } = await callForJson(
    makeClient(cfg.apiKey),
    cfg.model,
    SYSTEM,
    [
      {
        role: "user",
        content: `Subtitle this drawcast in ${target.label}.\n\nThe whole spec, for context:\n\`\`\`json\n${JSON.stringify(spec)}\n\`\`\`\n\nTranslate exactly these spoken lines:\n${listing}`,
      },
    ],
    SCHEMA,
    opts,
  );
  return verifySubtitles(sent, json);
}
