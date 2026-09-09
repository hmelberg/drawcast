// Visual repair (freehand-figures Task 14): the model looks at its own last
// frame once, exactly the way a teacher would look at a student's drawing.
// Off by default (Settings → Advanced) — the round lives in compile.ts (Part
// B of this task); this module is just the qualifying test, the prompt, and
// the message shape, kept apart so a browser-only snapshot step (snapshot.ts)
// never has to be imported by anything that runs under node/vitest.

import type Anthropic from "@anthropic-ai/sdk";
import type { LintIssue } from "../lint/lint";
import type { Spec } from "../spec/types";

export const VISUAL_REPAIR_PROMPT =
  "This is your drawing, rendered exactly as the viewer sees its last frame. Look at it as a teacher would: parts in the wrong place or wrong size, overlapping strokes, text on top of lines, a thing that does not read as the thing. Fix what is wrong by returning the corrected spec (same template, same ids where possible). If nothing is wrong, return the spec unchanged.";

/**
 * Only a freehand spec (no `template`) with at least one `group` element
 * qualifies — a templated figure has no loose parts for a snapshot to catch
 * that lint and the pedagogy pass could not already, and a freehand spec with
 * no group has nothing the round's "same ids where possible" instruction can
 * anchor to. `type: "group"` is not in ElementType yet (freehand-figures Task
 * 13 is split across dispatches) — read through `as string`, the idiom
 * image.ts and seed.ts already use for the same reason.
 */
export function wantsVisualRepair(spec: Spec): boolean {
  return !spec.template && (spec.elements ?? []).some((e) => (e.type as string) === "group");
}

/**
 * One user turn: the rendered PNG as an image block, then the remaining lint
 * (if any) and the fixed prompt as text — mirrors buildAuthorUserContent's
 * image-then-text shape (src/llm/author.ts).
 */
export function visualRepairMessages(pngBase64: string, lint: LintIssue[]): Anthropic.MessageParam[] {
  const list = lint.length ? `Remaining lint:\n${lint.map((i) => `- [${i.severity}] ${i.message}`).join("\n")}\n\n` : "";
  return [
    {
      role: "user",
      content: [
        { type: "image", source: { type: "base64", media_type: "image/png", data: pngBase64 } },
        { type: "text", text: `${list}${VISUAL_REPAIR_PROMPT}` },
      ],
    },
  ];
}
