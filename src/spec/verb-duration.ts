// A command's `duration` written beside its verb instead of inside it
// (2026-10-05). The schema documents a duration on highlight, focus, move …
// and an author reading it wrote `{highlight: {target: bar_1}, duration: 2}`
// — the command-level field animate uses — which validation refused. Such a
// duration is the verb's own when the verb declares one and sets none: both
// normalizeSpec (validation, layout) and planCommands (the player) read the
// command through here, so what validates is what plays.

import type { Command } from "./types";

/** The verbs whose own object takes `duration` (tests/verb-duration.test.ts
 *  keeps this in step with the schema). */
export const VERBS_WITH_DURATION: ReadonlySet<string> = new Set(["highlight", "focus", "point", "move", "arrange", "fade", "flip", "morph", "step", "flow", "camera"]);

/** The command with a beside-the-verb duration moved into the verb; unchanged otherwise. */
export function foldVerbDuration(cmd: Command): Command {
  if (cmd === null || typeof cmd !== "object" || typeof cmd.duration !== "number" || cmd.animate !== undefined) return cmd;
  const verb = Object.keys(cmd).find((k) => VERBS_WITH_DURATION.has(k));
  const own = verb === undefined ? undefined : (cmd as Record<string, unknown>)[verb];
  // `step: next` (a name) has no object to carry it.
  if (verb === undefined || own === null || typeof own !== "object" || Array.isArray(own)) return cmd;
  const { duration, ...rest } = cmd;
  const mine = own as { duration?: number };
  return { ...rest, [verb]: { ...mine, duration: mine.duration ?? duration } } as Command;
}
