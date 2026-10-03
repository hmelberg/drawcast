// POLL AND COMPARE (page-frame spec round 2, W16): an opinion question,
// answered on the figure, then what a study's people answered drawn beside
// the viewer's own answer, theirs highlighted ("You and 38% of people…").
//
//   {"ask": {"question": "…", "poll": {"choices": [{"text": "Offer 50", "share": 0.5}, …], "source": "oost"}, "judge": false, "store": "p"}}
//   {"ask": {"question": "…", "poll": {"on": "<scale id>", "others": [{"value": 40, "share": 0.5}, …]}, "store": "p"}}
//
// Sugar, expanded before layout into ordinary things (as on-canvas quiz
// buttons are, spec/answer-buttons.ts):
//   choices → buttons `poll_<k>_btn_N` (a little wider: the share is written
//             at the right end), drawn quick; an ask with `choose` and
//             judge: false. The buttons stay (with the shares on them)
//             until the cast hides, erases or clears them.
//   on      → a guess on that scale with judge: false; a scale with no
//             `value` gets the people's mean, so the reveal marks it.
// The poll itself rides on the ask: the plan hands the shares to the player,
// which draws them (guess/poll.ts) and sets {p.share}, {p.most}, {p.mean}.
// Counting the app's own viewers needs a backend: `live: true` validates and
// warns (not yet).

import { buttonSet, visibleBefore } from "./answer-buttons";
import type { Command, PollArg, Spec, SpecElement } from "./types";

/** Room at a poll button's right end for its share ("38%"). */
export const POLL_SHARE_ROOM = 76;

/** The people's mean answer on a scale poll: the shares as weights. */
export function pollMean(others: readonly { value: number; share: number }[]): number {
  const w = others.reduce((s, o) => s + o.share, 0);
  return w > 0 ? others.reduce((s, o) => s + o.value * o.share, 0) / w : 0;
}

export function expandPolls(spec: Spec): Spec {
  const cmds = spec.commands ?? [];
  if (!cmds.some((c) => c.ask?.poll !== undefined && c.ask.choose === undefined)) return spec;
  let els = spec.elements ?? [];
  const byId = new Map(els.map((e) => [e.id, e]));
  const taken = new Set(els.map((e) => e.id));
  const added: SpecElement[] = [];
  const out: Command[] = [];
  let k = 0;
  for (const cmd of cmds) {
    const ask = cmd.ask;
    const poll: PollArg | undefined = ask?.poll;
    if (!ask || !poll || ask.choose !== undefined) {
      out.push(cmd);
      continue;
    }
    if (Array.isArray(poll.choices) && poll.choices.length >= 2) {
      k++;
      let base = `poll_${k}`;
      while (taken.has(`${base}_buttons`)) base = `${base}_${k}`;
      const set = buttonSet(base, poll.choices.map((c) => c.text), poll.choices.map((c) => c.icon), visibleBefore(out, out.length), byId, {}, POLL_SHARE_ROOM);
      added.push(...set.elements);
      for (const el of set.elements) taken.add(el.id);
      out.push({ draw: set.ids, parallel: true });
      out.push({ ...cmd, ask: { ...ask, choose: set.ids, judge: false } });
    } else if (typeof poll.on === "string" && Array.isArray(poll.others) && poll.others.length > 0) {
      const scale = byId.get(poll.on) as (SpecElement & { value?: unknown }) | undefined;
      if (scale && scale.type === "scale" && typeof scale.value !== "number") {
        const mean = Math.round(pollMean(poll.others) * 10) / 10;
        els = els.map((e) => (e.id === poll.on ? ({ ...e, value: mean } as SpecElement) : e));
      }
      out.push({ ...cmd, ask: { ...ask, on: poll.on, judge: false } });
    } else out.push(cmd);
  }
  return { ...spec, elements: [...els, ...added], commands: out };
}
