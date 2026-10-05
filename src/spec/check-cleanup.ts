// A check's own visuals leave once its answer has been explained (Hans
// 2026-10-05, after the odds/risk/hazard book: "the screen becomes cluttered,
// especially if we stay on the same page … and especially in column and row
// format"). Sugar: a silent `erase` of the check's furniture right after the
// ask — the ask's right/wrong line has been said by then, the next line has
// not begun.
//
// What is furniture: the scale or the cards element a question is asked ON —
// an estimate's slider (expandEstimates makes it a scale), a number line, a
// sort/rank/select set. A guess on the page's own figure (a bar, a line, a
// slice, a population) is the figure itself and stays; only its marks fade,
// as they always did. Multiple choice is an overlay card and leaves anyway.
//
// When it leaves (Hans' rule):
//   - `after: "keep" | "clear"` on the ask decides, when given;
//   - else the page's `page.checks` ("keep" in a quiz-format cast — the
//     playlist sets it — or the author's own);
//   - else a slider leaves, and a scale or cards leave when the check is an
//     ASIDE: the page goes on with spoken explanation before its next question.
// It stays (unless `after: "clear"`) when a later command on the page names it
// — a highlight, a point, a draw onto it: the narration still uses it — and
// when nothing follows on the page (the page ends; clearing would only flicker).

import type { Command, Spec, SpecElement } from "./types";

type After = "keep" | "clear";

/** The furniture a question is asked on: its scale or cards elements. */
function furnitureOf(on: unknown, elements: readonly SpecElement[]): { ids: string[]; slider: boolean } {
  const ids = (Array.isArray(on) ? on : typeof on === "string" ? [on] : []).filter((x): x is string => typeof x === "string");
  const out: string[] = [];
  let slider = false;
  for (const id of ids) {
    const el = elements.find((e) => e.id === id) as (SpecElement & { slider?: boolean }) | undefined;
    if (!el || (el.type !== "scale" && (el.type as string) !== "cards")) continue;
    out.push(id);
    if (el.type === "scale" && el.slider === true) slider = true;
  }
  return { ids: out, slider };
}

/** Whether a command names one of the ids (or a part of it, `id_…`) anywhere but in its spoken words. */
function names(cmd: Command, ids: readonly string[]): boolean {
  const { speak: _s, ...rest } = cmd as Command & { speak?: unknown };
  void _s;
  const text = JSON.stringify(rest);
  return ids.some((id) => new RegExp(`"${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(_[^"]*)?"`).test(text));
}

const isQuestion = (c: Command): boolean => c.ask !== undefined || c.quiz !== undefined;

export function expandCheckCleanup(spec: Spec): Spec {
  const cmds = spec.commands ?? [];
  if (!cmds.some((c) => c.ask !== undefined)) return spec;
  const elements = spec.elements ?? [];
  const pageDefault = (spec.page as { checks?: After } | undefined)?.checks;
  const out: Command[] = [];
  let changed = false;
  cmds.forEach((c, i) => {
    out.push(c);
    const ask = c.ask as (Command["ask"] & { after?: After }) | undefined;
    if (!ask) return;
    const { ids, slider } = furnitureOf(ask.on, elements);
    if (ids.length === 0) return;
    const later = cmds.slice(i + 1);
    if (later.length === 0) return; // the page ends: nothing to clear for
    const chosen: After | undefined = ask.after ?? pageDefault;
    let clear: boolean;
    if (chosen !== undefined) clear = chosen === "clear";
    else {
      const used = later.some((l) => names(l, ids));
      // An aside: explanation is spoken before the page's next question (or its end).
      const next = later.findIndex(isQuestion);
      const between = next < 0 ? later : later.slice(0, next);
      const aside = between.some((l) => typeof (l as { speak?: unknown }).speak === "string");
      clear = !used && (slider || aside);
    }
    // Already erased by the author on the very next command: nothing to add.
    const next = later[0] as Command & { erase?: unknown };
    if (clear && !(next.erase !== undefined && names({ erase: next.erase } as Command, ids))) {
      out.push({ erase: ids } as Command);
      changed = true;
    }
  });
  return changed ? { ...spec, commands: out } : spec;
}
