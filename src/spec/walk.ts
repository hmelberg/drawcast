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
//   1. a NEW member drawn → every other member on the page steps back;
//   2. a command that addresses two or more members, or the group itself,
//      → the ones stepped back come back first (a comparison);
//   3. a command that goes back to ONE stepped-back member (a highlight, a
//      point, a camera, more of its parts drawn) → it comes back, the
//      current one steps back;
//   4. the author's own `fade` or `camera` wins, and the walk remembers it;
//      erase/hide/clear forget a member.
//
// Three ways to step back, the field's value:
//   true | "fade" — to a shadow (WALK_DIM); a comparison brings ALL back.
//   "zoom"        — the same, and the camera frames each member as it
//                   arrives (zoom "fit"), pulling back to the whole page for
//                   a comparison, before a quiz and at the end: small grid
//                   cells get the whole stage while they are the subject.
//   "replace"     — for ALTERNATIVES in one place (a straight frontier, then
//                   the bowed one): the next ERASES the one before, and a
//                   comparison draws back only the ones it names (all of
//                   them when it names the group) — STYLE.md 2026-09-12,
//                   "draw-then-erase each rejected alternative".

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

type WalkMode = "fade" | "zoom" | "replace";

interface Walk {
  id: string;
  mode: WalkMode;
  members: string[];
  /** Members drawn and not since erased, in the order they arrived. */
  shown: string[];
  /** Members stepped back: faded (fade, zoom) or erased (replace). */
  back: Set<string>;
  current: string | null;
  /** zoom: the camera is framing a member rather than the whole page. */
  zoomed: boolean;
}

/**
 * Replace every walked group's field with the commands it implies. Returns
 * the same object when no group walks — callers may compare by identity.
 */
export function expandWalks(spec: Spec): Spec {
  const elements = spec.elements ?? [];
  const walks: Walk[] = elements
    .filter((e) => e.type === "group" && e.walk !== undefined && e.walk !== false && (e.members ?? []).length > 0)
    .map((e) => ({
      id: e.id,
      mode: e.walk === true ? "fade" : (e.walk as WalkMode),
      members: [...(e.members ?? [])],
      shown: [],
      back: new Set<string>(),
      current: null,
      zoomed: false,
    }));
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

  const out: Command[] = [];

  for (const cmd of spec.commands ?? []) {
    const before: Command[] = [];
    for (const w of walks) {
      const stepBack = (ids: string[]) => {
        if (ids.length === 0) return;
        before.push(w.mode === "replace" ? { erase: ids } : { fade: { target: ids, to: WALK_DIM, duration: WALK_SECONDS } });
        ids.forEach((m) => w.back.add(m));
      };
      const bringBack = (ids: string[]) => {
        if (ids.length > 0) before.push(w.mode === "replace" ? { draw: ids } : { fade: { target: ids, to: 1, duration: WALK_SECONDS } });
        ids.forEach((m) => w.back.delete(m));
      };
      const frame = (m: string) => {
        before.push({ camera: { center: { ref: m }, zoom: "fit" } });
        w.zoomed = true;
      };
      const unframe = () => {
        if (w.zoomed) before.push({ camera: { reset: true } });
        w.zoomed = false;
      };
      const forget = (m: string) => {
        w.shown = w.shown.filter((x) => x !== m);
        w.back.delete(m);
        if (w.current === m) w.current = null;
      };

      // Rule 4: the author's own fade, camera and removals — follow, never add.
      if (cmd.fade) {
        if (w.mode !== "replace")
          for (const id of idsOf(cmd.fade.target)) {
            const m = memberOf(w, id);
            if (m === null) continue;
            if (cmd.fade.to < 1) w.back.add(m);
            else w.back.delete(m);
          }
        continue;
      }
      const ownCamera = cmd.camera !== undefined;
      if (cmd.camera) w.zoomed = !cmd.camera.reset;
      for (const id of [...idsOf(cmd.erase), ...idsOf(cmd.hide)]) {
        const m = memberOf(w, id);
        if (m !== null) forget(m);
      }
      if (cmd.clear) {
        const keep = new Set(idsOf(cmd.clear.keep).map((id) => memberOf(w, id)));
        for (const m of [...w.shown]) if (!keep.has(m)) forget(m);
      }
      // A quiz is about the whole set: it sees the whole page.
      if (cmd.quiz !== undefined && w.mode === "zoom") unframe();

      const ids = addressed(cmd);
      const whole = ids.includes(w.id);
      const touched = [...new Set(ids.map((id) => memberOf(w, id)).filter((m): m is string => m !== null))];
      const draws = cmd.draw !== undefined || cmd.show !== undefined;
      /** Members this command draws whole, by their own id — no need to draw them back first. */
      const drawnWhole = new Set([...idsOf(cmd.draw), ...idsOf(cmd.show)].filter((id) => w.members.includes(id)));

      if (whole || touched.length >= 2) {
        // Rule 2: a comparison. Fade and zoom bring everyone back; replace
        // draws back only the alternatives the command names.
        if (!ownCamera) unframe();
        const wanted = w.mode === "replace" && !whole ? touched : w.members;
        bringBack(wanted.filter((m) => w.back.has(m) && !drawnWhole.has(m)));
        for (const m of wanted) if (drawnWhole.has(m)) w.back.delete(m);
        if (draws) for (const m of whole ? w.members : touched) if (!w.shown.includes(m)) w.shown.push(m);
        continue;
      }
      if (touched.length === 0) continue;
      const m = touched[0];
      if (draws && !w.shown.includes(m)) {
        // Rule 1: the next member arrives; the others step back.
        stepBack(w.shown.filter((x) => x !== m && !w.back.has(x)));
        if (w.mode === "zoom" && !ownCamera) frame(m);
        w.shown.push(m);
        w.current = m;
      } else if (w.back.has(m)) {
        // Rule 3: back to one of them; the current one steps back instead.
        if (w.current !== null && w.current !== m && !w.back.has(w.current)) stepBack([w.current]);
        if (drawnWhole.has(m)) w.back.delete(m);
        else bringBack([m]);
        if (w.mode === "zoom" && !ownCamera) frame(m);
        w.current = m;
      } else if (w.shown.includes(m)) {
        w.current = m;
      }
    }
    out.push(...before, cmd);
  }
  // The end of the cast sees the whole page.
  if (walks.some((w) => w.mode === "zoom" && w.zoomed)) out.push({ camera: { reset: true } });
  return { ...spec, commands: out };
}
