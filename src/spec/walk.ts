// `walk: true` on a group: its members are PEERS the narration goes through
// one at a time — five kinds of bridge, six polygons, four forces (STYLE.md
// 2026-09-23). The one being talked about stands at full ink; the ones
// already explained step back to a shadow, so they stay as context without
// competing; when the narration compares across them, they all come back.
//
// A live Sonnet run grid-laid its galleries as taught but wrote none of the
// fades the prompt asked for: six well-placed commands is a lot to remember,
// one field is not. `expandWalks` turns the field into those ordinary fade
// commands before layout — the same arrangement `expandCards` has — so the
// player, the lint, export and the frames harness all see one thing, and
// nothing downstream knows walks exist.
//
// Four rules, kept few so an author can predict them:
//   1. a NEW member drawn → every other member on the page fades to WALK_DIM;
//   2. a command that addresses two or more members, or the group itself,
//      → every faded member comes back first (a comparison);
//   3. a command that goes back to ONE faded member (a highlight, a point, a
//      camera, more of its parts drawn) → it comes back, the current steps back;
//   4. the author's own `fade` on a member wins, and the walk remembers it;
//      erase/hide/clear forget a member.

import type { Command, Spec, SpecElement } from "./types";

/** The opacity a walked member steps back to: the shape stays readable. */
export const WALK_DIM = 0.3;
/** Seconds for a walk's own fade — quicker than a fade the author narrates. */
export const WALK_SECONDS = 0.6;

/** A verb's target: one id or a list (lint.ts idsOf's rule, kept here so spec/ needs no lint/). */
function idsOf(raw: string[] | string | undefined): string[] {
  return typeof raw === "string" ? [raw] : raw ?? [];
}

/** Ids a command ADDRESSES (not erases/fades) — what decides rules 1–3. */
function addressed(cmd: Command): string[] {
  const ref = (r: unknown) => (r && typeof r === "object" && typeof (r as { ref?: unknown }).ref === "string" ? [(r as { ref: string }).ref] : []);
  return [
    ...idsOf(cmd.draw),
    ...idsOf(cmd.show),
    ...idsOf(cmd.highlight?.target),
    ...idsOf(cmd.focus?.target),
    ...idsOf(cmd.move?.target),
    ...idsOf(cmd.arrange?.target),
    ...ref(cmd.point?.at),
    ...(cmd.camera && !cmd.camera.reset ? ref(cmd.camera.center) : []),
  ];
}

interface Walk {
  id: string;
  members: string[];
  /** Members drawn and not since erased, in the order they arrived. */
  shown: string[];
  faded: Set<string>;
  current: string | null;
}

/**
 * Replace every walked group's field with the fades it implies. Returns the
 * same object when no group walks — callers may compare by identity.
 */
export function expandWalks(spec: Spec): Spec {
  const elements = spec.elements ?? [];
  const walks: Walk[] = elements
    .filter((e) => e.type === "group" && e.walk === true && (e.members ?? []).length > 0)
    .map((e) => ({ id: e.id, members: [...(e.members ?? [])], shown: [], faded: new Set<string>(), current: null }));
  if (walks.length === 0) return spec;

  const byId = new Map(elements.map((e) => [e.id, e] as const));
  // An element may sit in several groups — a cell in the walk AND in the
  // grid that lays it out — so every group it is in is a way up.
  const parents = new Map<string, string[]>();
  for (const e of elements) if (e.type === "group") for (const m of e.members ?? []) parents.set(m, [...(parents.get(m) ?? []), e.id]);

  /** The member of `walk` that `id` belongs to: itself, a group it sits in,
   *  what it is attached to, or — the layout's own convention — the member
   *  whose id prefixes it (a `pieces` member's `<id>_3`). */
  const memberOf = (walk: Walk, id: string): string | null => {
    const seen = new Set<string>();
    const queue = [id];
    while (queue.length > 0) {
      const cur = queue.shift()!;
      if (seen.has(cur)) continue;
      seen.add(cur);
      if (walk.members.includes(cur)) return cur;
      const el: SpecElement | undefined = byId.get(cur);
      queue.push(...(parents.get(cur) ?? []));
      if (typeof el?.attach_to === "string") queue.push(el.attach_to);
    }
    return walk.members.find((m) => id.startsWith(`${m}_`)) ?? null;
  };

  const fade = (ids: string[], to: number): Command => ({ fade: { target: ids, to, duration: WALK_SECONDS } });
  const out: Command[] = [];

  for (const cmd of spec.commands ?? []) {
    const before: Command[] = [];
    for (const w of walks) {
      const forget = (m: string) => {
        w.shown = w.shown.filter((x) => x !== m);
        w.faded.delete(m);
        if (w.current === m) w.current = null;
      };
      // Rule 4: the author's own fade and removals — follow, never add.
      if (cmd.fade) {
        for (const id of idsOf(cmd.fade.target)) {
          const m = memberOf(w, id);
          if (m === null) continue;
          if (cmd.fade.to < 1) w.faded.add(m);
          else w.faded.delete(m);
        }
        continue;
      }
      for (const id of [...idsOf(cmd.erase), ...idsOf(cmd.hide)]) {
        const m = memberOf(w, id);
        if (m !== null) forget(m);
      }
      if (cmd.clear) {
        const keep = new Set(idsOf(cmd.clear.keep).map((id) => memberOf(w, id)));
        for (const m of [...w.shown]) if (!keep.has(m)) forget(m);
      }

      const ids = addressed(cmd);
      const whole = ids.includes(w.id);
      const touched = [...new Set(ids.map((id) => memberOf(w, id)).filter((m): m is string => m !== null))];
      const draws = cmd.draw !== undefined || cmd.show !== undefined;

      if (whole || touched.length >= 2) {
        // Rule 2: a comparison — everyone back.
        if (w.faded.size > 0) before.push(fade([...w.faded], 1));
        w.faded.clear();
        if (draws) for (const m of whole ? w.members : touched) if (!w.shown.includes(m)) w.shown.push(m);
        continue;
      }
      if (touched.length === 0) continue;
      const m = touched[0];
      if (draws && !w.shown.includes(m)) {
        // Rule 1: the next peer arrives; the others step back.
        const back = w.shown.filter((x) => x !== m && !w.faded.has(x));
        if (back.length > 0) before.push(fade(back, WALK_DIM));
        back.forEach((x) => w.faded.add(x));
        w.shown.push(m);
        w.current = m;
      } else if (w.faded.has(m)) {
        // Rule 3: back to one of them; the current one steps back instead.
        if (w.current !== null && w.current !== m && !w.faded.has(w.current)) {
          before.push(fade([w.current], WALK_DIM));
          w.faded.add(w.current);
        }
        before.push(fade([m], 1));
        w.faded.delete(m);
        w.current = m;
      } else if (w.shown.includes(m)) {
        w.current = m;
      }
    }
    out.push(...before, cmd);
  }
  return { ...spec, commands: out };
}
