// Pure command planning: normalizes the spec's command sequence against the
// element ids that layout actually produced, and precomputes the scene state
// (visible ids, per-element offsets, camera) at every step boundary so that
// step back / scrubbing is exact by construction. Backend-independent, fully tested.

import { CANVAS } from "../layout/canvas";
import type { BBox } from "../layout/geometry";
import type { Pt } from "../layout/model";
import type { CodeWindow } from "../layout/code";
import { readParam } from "./params";
import { chessSquareBox, pianoKeyBox, pianoOctaves } from "./widgets";
import type { Command, Easing, HighlightEffect, PlayVoice, PointGesture } from "../spec/types";
import { notationBeats, parseNotation } from "../spec/notation";
import { parseABC } from "../spec/abc";
import type { Delivery } from "./delivery";

export type PlanStep = (
  | { kind: "speak"; text: string; blocking: boolean; speaker?: "a" | "b"; delivery?: Delivery }
  | { kind: "draw"; ids: string[]; parallel: boolean; implicit?: boolean }
  | { kind: "pause"; seconds: number }
  | { kind: "wait" }
  | { kind: "label"; name: string }
  | { kind: "explore"; params?: string[]; code?: string }
  | { kind: "if"; varName: string; op: "gt" | "lt" | "gte" | "lte" | "eq" | "ne"; value: number | string; target: string }
  | { kind: "quiz"; question: string; choices: string[]; correct: number; right?: string; wrong?: string; required: boolean; rightGoto?: string; wrongGoto?: string }
  | {
      kind: "ask";
      question: string;
      answer?: string;
      right?: string;
      wrong?: string;
      reveal: boolean;
      retry: boolean;
      store?: string;
      fallback?: string;
      required: boolean;
      rightGoto?: string;
      wrongGoto?: string;
      widget?: "click" | "piano" | "chess" | "code";
      answerBox?: BBox;
      /** code widget: the panel the viewer writes in, and what to read back. */
      codeId?: string;
      expect?: string;
    }
  | { kind: "show"; ids: string[] }
  | { kind: "hide"; ids: string[] }
  | { kind: "erase"; ids: string[]; parallel: boolean }
  | { kind: "clear"; ids: string[] }
  | {
      kind: "highlight";
      ids: string[];
      boxes: Record<string, BBox>;
      effect: HighlightEffect;
      seconds: number;
      color?: string;
      /** Narrated with no explicit duration: pulse in cycles until the voice ends. */
      untilNarrationEnd?: boolean;
    }
  | {
      kind: "focus";
      /** Targets that stay lit — the player dims the REST of the visible set. */
      ids: string[];
      seconds: number;
      /** Narrated with no explicit duration: hold the focus until the voice ends. */
      untilNarrationEnd?: boolean;
    }
  | { kind: "point"; x: number; y: number; box?: BBox; refId?: string; gesture: PointGesture; seconds: number }
  | { kind: "move"; ids: string[]; path: Pt[]; seconds: number; easing: Easing }
  | { kind: "camera"; box: BBox | null; seconds: number }
  | { kind: "animate"; targets: Record<string, number>; starts: Record<string, number | null>; seconds: number; easing?: Easing; varTargets?: Record<string, string> }
  | {
      kind: "play";
      voices: PlayVoice[];
      tempo: number;
      seconds: number;
      /** Ids revealed in time with the notes and kept; revealAt[k] = fraction of the step at which reveal[k] appears. */
      reveal: string[];
      revealAt: number[];
      /** Ids pressed transiently: down at pressAt[k], back up at pressOff[k] (fractions of the step). */
      press: string[];
      pressAt: number[];
      pressOff: number[];
    }
) & {
  /** speak paired with an action: voice and action start together, both must finish. */
  narration?: string;
  narrationSpeaker?: "a" | "b";
  narrationDelivery?: Delivery;
};

/** Scene state at a step boundary. A pure function of the step index. */
export interface SceneState {
  /** Ids visible after this step, in draw order. */
  visible: string[];
  /** Cumulative translation per moved id, logical units (y-up). */
  offsets: Record<string, Pt>;
  /** Camera viewBox in logical y-up coordinates; null = full canvas. */
  camera: BBox | null;
  /** Cumulative animate overrides at this boundary (dot paths → numeric value). */
  params: Record<string, number>;
}

export const INITIAL_STATE: SceneState = { visible: [], offsets: {}, camera: null, params: {} };

export interface Plan {
  steps: PlanStep[];
  /** states[i] = scene state after steps[0..i] have completed. */
  states: SceneState[];
  /** Label name → step index (the label step itself). Gotos resolve here. */
  labels: Record<string, number>;
  warnings: string[];
}

export interface PlanOptions {
  /** Layout-time bbox per element id (logical units), for point/camera/highlight targeting. */
  bboxOf?: (id: string) => BBox | null;
  /** Windowed code panes (layout's `windows`): after every visibility change
   *  the plan scrolls each so its highest visible line is the bottom row,
   *  recorded as per-line offsets in the state — the move verb's own store,
   *  so scrub, step-back and the exporter restore it for free. */
  windows?: Record<string, CodeWindow>;
  /** Domain → logical point mapping (identity when no domain is declared). */
  toLogical?: (p: Pt) => Pt;
  /** Domain-delta → logical-delta mapping for move.by / move.path. */
  deltaToLogical?: (d: Pt) => Pt;
  /** The spec's `params` when the spec has a template; null/undefined = no template, animate warns + skips. */
  animateBase?: Record<string, unknown> | null;
  /** After an animate step, the planner switches its bbox source to this so later steps target post-animate geometry. */
  bboxesFor?: (params: Record<string, number>) => (id: string) => BBox | null;
}

const CAMERA_MAX_ZOOM = 8;

export function planCommands(commands: Command[] | undefined, allIds: string[], opts: PlanOptions = {}): Plan {
  let bboxOf = opts.bboxOf ?? (() => null);
  const toLogical = opts.toLogical ?? ((p: Pt) => p);
  const deltaToLogical = opts.deltaToLogical ?? ((d: Pt) => d);

  const known = new Set(allIds);
  const steps: PlanStep[] = [];
  const states: SceneState[] = [];
  const warnings: string[] = [];
  const labels: Record<string, number> = {};
  /** Ask store → default, in command order — the fallback for "{var}" animate targets. */
  const storeDefaults: Record<string, string> = {};
  /** Ids whose visibility the spec manages explicitly — excluded from the implicit final draw. */
  const mentioned = new Set<string>();

  let visible: string[] = [];
  const visibleSet = new Set<string>();
  const offsets: Record<string, Pt> = {};
  let camera: BBox | null = null;
  let params: Record<string, number> = {};
  /** Step index at which each id was last drawn/shown — the forgotten-keep check. */
  const lastRevealed = new Map<string, number>();

  /** Narration of the command currently being planned (speak paired with an action). */
  let currentNarration: string | undefined;
  /** Voice/delivery hints for currentNarration — travel together, always. */
  let currentNarrationSpeaker: "a" | "b" | undefined;
  let currentNarrationDelivery: Delivery | undefined;
  const pushStep = (step: PlanStep) => {
    if (currentNarration !== undefined && step.kind !== "speak") {
      step = {
        ...step,
        narration: currentNarration,
        narrationSpeaker: currentNarrationSpeaker,
        narrationDelivery: currentNarrationDelivery,
      };
    }
    steps.push(step);
    states.push({ visible: [...visible], offsets: { ...offsets }, camera, params: { ...params } });
  };
  /** The window's scroll: the highest visible line's bottom sits at the
   *  window's bottom. Every line of the element gets the offset — the hidden
   *  ones too, so a line drawn later arrives already in place. y-up: a
   *  positive dy moves a line up, which is what scrolling does. */
  const applyScroll = () => {
    for (const w of Object.values(opts.windows ?? {})) {
      let maxBottom = 0;
      w.ids.forEach((id, i) => {
        if (visibleSet.has(id)) maxBottom = Math.max(maxBottom, w.bottoms[i]);
      });
      const scroll = Math.max(0, maxBottom - w.height);
      // The marks ride along without voting: a pen stroke belongs to its line
      // and must scroll with it, but its own extent is not "the lowest thing
      // on screen" — counting it would scroll the pane to chase a highlight.
      for (const id of [...w.ids, ...(w.follow ?? [])]) {
        if (scroll === 0) delete offsets[id];
        else offsets[id] = [0, scroll];
      }
    }
  };
  const makeVisible = (ids: string[]) => {
    for (const id of ids) {
      if (!visibleSet.has(id)) {
        visibleSet.add(id);
        visible.push(id);
      }
    }
    applyScroll();
  };
  const makeHidden = (ids: string[]) => {
    for (const id of ids) visibleSet.delete(id);
    visible = visible.filter((id) => visibleSet.has(id));
    applyScroll();
  };
  const resolveIds = (raw: string[] | string | undefined, verb: string): string[] => {
    const requested = typeof raw === "string" ? [raw] : raw ?? [];
    return requested.filter((id) => {
      if (known.has(id)) return true;
      warnings.push(`${verb} command references unknown id "${id}" (dropped)`);
      return false;
    });
  };
  /** Element's current visual bbox: layout bbox shifted by its accumulated offset. */
  const currentBox = (id: string): BBox | null => {
    const box = bboxOf(id);
    if (!box) return null;
    const [dx, dy] = offsets[id] ?? [0, 0];
    return { x: box.x + dx, y: box.y + dy, w: box.w, h: box.h };
  };

  const ACTION_KEYS = ["draw", "pause", "wait", "quiz", "ask", "label", "if", "explore", "show", "hide", "erase", "clear", "highlight", "focus", "point", "move", "camera", "animate", "play"] as const;
  for (const cmd of commands ?? []) {
    const hasAction = ACTION_KEYS.some((k) => cmd[k] !== undefined);
    currentNarration = hasAction ? cmd.speak : undefined;
    currentNarrationSpeaker = hasAction ? cmd.voice : undefined;
    currentNarrationDelivery = hasAction ? cmd.delivery : undefined;
    if (cmd.speak !== undefined && !hasAction) {
      pushStep({ kind: "speak", text: cmd.speak, blocking: cmd.blocking !== false, speaker: cmd.voice, delivery: cmd.delivery });
    } else if (cmd.draw !== undefined) {
      const ids = resolveIds(cmd.draw, "draw");
      ids.forEach((id) => mentioned.add(id));
      ids.forEach((id) => lastRevealed.set(id, steps.length));
      makeVisible(ids);
      pushStep({ kind: "draw", ids, parallel: cmd.parallel === true });
    } else if (cmd.pause !== undefined) {
      pushStep({ kind: "pause", seconds: cmd.pause });
    } else if (cmd.wait !== undefined) {
      pushStep({ kind: "wait" });
    } else if (cmd.label !== undefined) {
      labels[cmd.label] = steps.length;
      pushStep({ kind: "label", name: cmd.label });
    } else if (cmd.explore !== undefined) {
      pushStep({
        kind: "explore",
        ...(cmd.explore.params !== undefined ? { params: cmd.explore.params } : {}),
        ...(cmd.explore.code !== undefined ? { code: cmd.explore.code } : {}),
      });
    } else if (cmd.if !== undefined) {
      const f = cmd.if;
      const pair = (["gt", "lt", "gte", "lte", "eq", "ne"] as const).find((k) => f[k] !== undefined);
      if (pair === undefined) {
        warnings.push("if command with no comparison skipped");
      } else {
        pushStep({ kind: "if", varName: f.var, op: pair, value: f[pair]!, target: f.goto });
      }
    } else if (cmd.quiz !== undefined) {
      // The question IS the narration unless the author paired a speak; the
      // intro prepends either way (inside the step, so skipping skips it).
      if (currentNarration === undefined) currentNarration = cmd.quiz.question;
      if (cmd.quiz.intro) currentNarration = `${cmd.quiz.intro} ${currentNarration}`;
      pushStep({
        kind: "quiz",
        question: cmd.quiz.question,
        choices: cmd.quiz.choices,
        correct: cmd.quiz.correct - 1,
        ...(cmd.quiz.right !== undefined ? { right: cmd.quiz.right } : {}),
        ...(cmd.quiz.wrong !== undefined ? { wrong: cmd.quiz.wrong } : {}),
        required: cmd.quiz.required === true,
        ...(cmd.quiz.right_goto !== undefined ? { rightGoto: cmd.quiz.right_goto } : {}),
        ...(cmd.quiz.wrong_goto !== undefined ? { wrongGoto: cmd.quiz.wrong_goto } : {}),
      });
    } else if (cmd.ask !== undefined) {
      // The question IS the narration unless the author paired a speak; the
      // intro prepends either way (inside the step, so skipping skips it).
      if (currentNarration === undefined) currentNarration = cmd.ask.question;
      if (cmd.ask.intro) currentNarration = `${cmd.ask.intro} ${currentNarration}`;
      pushStep({
        kind: "ask",
        question: cmd.ask.question,
        ...(cmd.ask.answer !== undefined ? { answer: cmd.ask.answer } : {}),
        ...(cmd.ask.right !== undefined ? { right: cmd.ask.right } : {}),
        ...(cmd.ask.wrong !== undefined ? { wrong: cmd.ask.wrong } : {}),
        reveal: cmd.ask.reveal !== false,
        retry: cmd.ask.retry === true,
        ...(cmd.ask.store !== undefined ? { store: cmd.ask.store } : {}),
        ...(cmd.ask.default !== undefined ? { fallback: cmd.ask.default } : {}),
        required: cmd.ask.required === true,
        ...(cmd.ask.right_goto !== undefined ? { rightGoto: cmd.ask.right_goto } : {}),
        ...(cmd.ask.wrong_goto !== undefined ? { wrongGoto: cmd.ask.wrong_goto } : {}),
        // Naming a code element IS the code widget — one thing to get right
        // instead of two that can disagree.
        ...(cmd.ask.code !== undefined ? { widget: "code" as const, codeId: cmd.ask.code } : cmd.ask.widget !== undefined ? { widget: cmd.ask.widget } : {}),
        ...(cmd.ask.code !== undefined && cmd.ask.expect !== undefined ? { expect: cmd.ask.expect } : {}),
        ...(cmd.ask.code !== undefined && currentBox(cmd.ask.code) !== null ? { answerBox: currentBox(cmd.ask.code)! } : {}),
        // The movie demo points at the answer: the element's box (click) or
        // the key's box (piano — geometry mirrored from the template).
        ...(cmd.ask.widget === "click" && cmd.ask.answer !== undefined && currentBox(cmd.ask.answer) !== null
          ? { answerBox: currentBox(cmd.ask.answer)! }
          : {}),
        ...(cmd.ask.widget === "piano" && cmd.ask.answer !== undefined && pianoKeyBox(pianoOctaves(opts.animateBase), cmd.ask.answer) !== null
          ? { answerBox: pianoKeyBox(pianoOctaves(opts.animateBase), cmd.ask.answer)! }
          : {}),
        ...(cmd.ask.widget === "chess" && cmd.ask.answer !== undefined && chessSquareBox(opts.animateBase?.["flip"] === true, cmd.ask.answer.trim().slice(-2)) !== null
          ? { answerBox: chessSquareBox(opts.animateBase?.["flip"] === true, cmd.ask.answer.trim().slice(-2))! }
          : {}),
      });
      if (cmd.ask.store !== undefined && cmd.ask.default !== undefined) storeDefaults[cmd.ask.store.toLowerCase()] = cmd.ask.default;
    } else if (cmd.show !== undefined) {
      const ids = resolveIds(cmd.show, "show");
      ids.forEach((id) => mentioned.add(id));
      ids.forEach((id) => lastRevealed.set(id, steps.length));
      makeVisible(ids);
      pushStep({ kind: "show", ids });
    } else if (cmd.hide !== undefined) {
      const ids = resolveIds(cmd.hide, "hide");
      ids.forEach((id) => mentioned.add(id));
      makeHidden(ids);
      pushStep({ kind: "hide", ids });
    } else if (cmd.erase !== undefined) {
      const ids = resolveIds(cmd.erase, "erase");
      ids.forEach((id) => mentioned.add(id));
      // Only visible elements can animate an un-sketch; the rest just stay hidden.
      const animatable = ids.filter((id) => visibleSet.has(id));
      makeHidden(ids);
      if (animatable.length > 0) pushStep({ kind: "erase", ids: animatable, parallel: cmd.parallel === true });
    } else if (cmd.clear !== undefined) {
      const keep = new Set(resolveIds(cmd.clear.keep, "clear.keep"));
      const ids = visible.filter((id) => !keep.has(id));
      // A likely forgotten keep: wiping something revealed only moments ago.
      for (const id of ids) {
        const at = lastRevealed.get(id);
        if (at !== undefined && steps.length - at <= 3) {
          warnings.push(`clear hides "${id}" — it was just drawn (${steps.length - at} step${steps.length - at === 1 ? "" : "s"} earlier); add it to keep if the story still needs it`);
        }
      }
      makeHidden(ids);
      pushStep({ kind: "clear", ids });
    } else if (cmd.highlight !== undefined) {
      const ids = resolveIds(cmd.highlight.target, "highlight").filter((id) => {
        if (visibleSet.has(id)) return true;
        warnings.push(`highlight target "${id}" is not visible at that point (skipped)`);
        return false;
      });
      if (ids.length === 0) continue;
      const boxes: Record<string, BBox> = {};
      for (const id of ids) {
        const box = bboxOf(id); // layout box; the player adds the live offset
        if (box) boxes[id] = box;
      }
      pushStep({
        kind: "highlight",
        ids,
        boxes,
        effect: cmd.highlight.effect ?? "pulse",
        seconds: cmd.highlight.duration ?? 1.5,
        color: cmd.highlight.color,
        ...(cmd.highlight.duration === undefined && currentNarration !== undefined ? { untilNarrationEnd: true } : {}),
      });
    } else if (cmd.focus !== undefined) {
      const ids = resolveIds(cmd.focus.target, "focus").filter((id) => {
        if (visibleSet.has(id)) return true;
        warnings.push(`focus target "${id}" is not visible at that point (skipped)`);
        return false;
      });
      if (ids.length === 0) continue;
      pushStep({
        kind: "focus",
        ids,
        seconds: cmd.focus.duration ?? 2,
        ...(cmd.focus.duration === undefined && currentNarration !== undefined ? { untilNarrationEnd: true } : {}),
      });
    } else if (cmd.point !== undefined) {
      const at = cmd.point.at;
      let x: number, y: number;
      let box: BBox | undefined;
      let refId: string | undefined;
      if (at?.ref !== undefined) {
        if (!known.has(at.ref)) {
          warnings.push(`point command references unknown id "${at.ref}" (skipped)`);
          continue;
        }
        refId = at.ref;
        if (!visibleSet.has(at.ref)) warnings.push(`point target "${at.ref}" is not visible at that point`);
        const b = currentBox(at.ref);
        if (b) {
          box = b;
          x = b.x + b.w / 2;
          y = b.y + b.h / 2;
        } else {
          x = CANVAS.w / 2;
          y = CANVAS.h / 2;
        }
      } else if (at?.x !== undefined && at?.y !== undefined) {
        [x, y] = toLogical([at.x, at.y]);
      } else {
        warnings.push("point command without a resolvable target skipped");
        continue;
      }
      pushStep({ kind: "point", x, y, box, refId, gesture: cmd.point.gesture ?? "tap", seconds: cmd.point.duration ?? 2 });
    } else if (cmd.move !== undefined) {
      const ids = resolveIds(cmd.move.target, "move");
      for (const id of ids) {
        if (!visibleSet.has(id)) warnings.push(`move target "${id}" is not visible at that point (still moved)`);
      }
      const rawPath = cmd.move.path && cmd.move.path.length > 0 ? cmd.move.path : cmd.move.by ? [cmd.move.by] : null;
      if (ids.length === 0 || !rawPath) {
        if (!rawPath) warnings.push("move command without by/path skipped");
        continue;
      }
      const path = rawPath.map((d) => deltaToLogical(d as Pt));
      const [fx, fy] = path[path.length - 1];
      for (const id of ids) {
        const [ox, oy] = offsets[id] ?? [0, 0];
        offsets[id] = [ox + fx, oy + fy];
      }
      pushStep({ kind: "move", ids, path, seconds: cmd.move.duration ?? 1, easing: cmd.move.easing ?? "ease-in-out" });
    } else if (cmd.camera !== undefined) {
      let box: BBox | null = null;
      if (!cmd.camera.reset) {
        const zoom = Math.min(CAMERA_MAX_ZOOM, Math.max(1, cmd.camera.zoom ?? 2));
        if (zoom <= 1) {
          box = null;
        } else {
          let cx: number = camera ? camera.x + camera.w / 2 : CANVAS.w / 2;
          let cy: number = camera ? camera.y + camera.h / 2 : CANVAS.h / 2;
          const center = cmd.camera.center;
          if (center?.ref !== undefined) {
            if (!known.has(center.ref)) {
              warnings.push(`camera command references unknown id "${center.ref}" (centering on canvas)`);
            } else {
              const b = currentBox(center.ref);
              if (b) {
                cx = b.x + b.w / 2;
                cy = b.y + b.h / 2;
              }
            }
          } else if (center?.x !== undefined && center?.y !== undefined) {
            [cx, cy] = toLogical([center.x, center.y]);
          }
          const w = CANVAS.w / zoom;
          const h = CANVAS.h / zoom;
          box = {
            x: Math.min(Math.max(cx - w / 2, 0), CANVAS.w - w),
            y: Math.min(Math.max(cy - h / 2, 0), CANVAS.h - h),
            w,
            h,
          };
        }
      }
      camera = box;
      pushStep({ kind: "camera", box, seconds: cmd.camera.duration ?? 1.2 });
    } else if (cmd.animate !== undefined) {
      const targets: Record<string, number> = {};
      const varTargets: Record<string, string> = {};
      for (const [key, v] of Object.entries(cmd.animate)) {
        if (typeof v === "number" && Number.isFinite(v)) {
          targets[key] = v;
        } else if (typeof v === "string" && /^\{[a-z][a-z0-9_]*\}$/i.test(v)) {
          // Plan-time = the FALLBACK (the ask's default): targets and every
          // boundary state stay plain numbers; the player swaps in the
          // viewer's answer at run time.
          const name = v.slice(1, -1).toLowerCase();
          const raw = (storeDefaults[name] ?? "").trim();
          const fallback = raw === "" ? NaN : Number(raw);
          if (Number.isFinite(fallback)) {
            targets[key] = fallback;
            varTargets[key] = name;
          } else {
            warnings.push(`animate "${key}" references {${name}} but its ask default is not numeric (dropped)`);
          }
        } else {
          warnings.push(`animate "${key}" target is not a number (dropped)`);
        }
      }
      if (opts.animateBase === undefined || opts.animateBase === null) {
        warnings.push("animate requires a scene template (skipped)");
        // No template means no animation surface at all, but a paired
        // narration is still content the story wanted spoken — keep it
        // rather than silently dropping the sentence with the animate.
        if (cmd.speak !== undefined) pushStep({ kind: "speak", text: cmd.speak, blocking: true, speaker: cmd.voice, delivery: cmd.delivery });
        continue;
      }
      if (Object.keys(targets).length === 0) {
        warnings.push("animate command without numeric targets skipped");
        continue;
      }
      const starts: Record<string, number | null> = {};
      for (const key of Object.keys(targets)) {
        const start = params[key] ?? readParam(opts.animateBase, key);
        starts[key] = start;
        if (start === null) warnings.push(`animate "${key}" has no numeric start value in params — it will jump straight to the target`);
      }
      params = { ...params, ...targets };
      pushStep({
        kind: "animate",
        targets,
        starts,
        seconds: cmd.duration ?? 2,
        ...(cmd.easing !== undefined ? { easing: cmd.easing } : {}),
        ...(Object.keys(varTargets).length > 0 ? { varTargets } : {}),
      });
      if (opts.bboxesFor) bboxOf = opts.bboxesFor(params);
    } else if (cmd.play !== undefined) {
      let raw;
      let abcTempo: number | null = null;
      if (typeof cmd.play === "string") {
        raw = [{ notes: cmd.play, instrument: cmd.instrument }];
      } else if (Array.isArray(cmd.play)) {
        raw = cmd.play;
      } else {
        const tune = parseABC(cmd.play.abc);
        abcTempo = tune.tempo;
        raw = tune.voices.map((v) => ({ notes: v.notes, instrument: cmd.instrument }));
      }
      const tempo = Math.min(300, Math.max(30, typeof cmd.tempo === "number" && Number.isFinite(cmd.tempo) ? cmd.tempo : abcTempo ?? 100));
      const voices: PlayVoice[] = raw
        .filter((v) => v && typeof v.notes === "string")
        .map((v) => ({ notes: v.notes, instrument: v.instrument ?? cmd.instrument }))
        .filter((v) => notationBeats(v.notes) > 0)
        .slice(0, 4);
      if (voices.length === 0) {
        warnings.push("play command with no readable notes skipped");
        // Keep a paired narration rather than silently dropping the sentence.
        if (cmd.speak !== undefined) pushStep({ kind: "speak", text: cmd.speak, blocking: true, speaker: cmd.voice, delivery: cmd.delivery });
        continue;
      }
      const beats = Math.max(...voices.map((v) => notationBeats(v.notes)));
      // reveal/press: id k tracks the k-th sounding note (rest-skipping) of
      // the FIRST voice — reveal appears at its start and stays; press
      // appears at its start and vanishes at its end (the key comes back
      // up). Both expressed as fractions of the whole step, so the player
      // just drives them from its progress clock.
      const reveal = resolveIds(cmd.reveal, "reveal");
      const press = resolveIds(cmd.press, "press");
      const revealAt: number[] = [];
      const pressAt: number[] = [];
      const pressOff: number[] = [];
      if (reveal.length > 0 || press.length > 0) {
        const spans: [number, number][] = [];
        let acc = 0;
        for (const tok of parseNotation(voices[0].notes)) {
          if (tok.pitches.length > 0) spans.push([acc, acc + tok.beats]);
          acc += tok.beats;
        }
        const overflow = (list: string[], name: string) => {
          if (list.length > spans.length) {
            warnings.push(`play has ${list.length} ${name} ids but only ${spans.length} sounding notes — the extras land at the end`);
          }
        };
        overflow(reveal, "reveal");
        overflow(press, "press");
        for (let k = 0; k < reveal.length; k++) revealAt.push(k < spans.length ? spans[k][0] / beats : 1);
        for (let k = 0; k < press.length; k++) {
          pressAt.push(k < spans.length ? spans[k][0] / beats : 1);
          pressOff.push(k < spans.length ? Math.min(1, spans[k][1] / beats) : 1);
        }
        reveal.forEach((id) => mentioned.add(id));
        reveal.forEach((id) => lastRevealed.set(id, steps.length));
        makeVisible(reveal);
        // Pressed ids end the step hidden — the key has come back up.
        press.forEach((id) => mentioned.add(id));
        makeHidden(press);
      }
      pushStep({ kind: "play", voices, tempo, seconds: (beats * 60) / tempo, reveal, revealAt, press, pressAt, pressOff });
    } else {
      warnings.push("command with no recognized verb skipped");
    }
  }

  currentNarration = undefined;
  currentNarrationSpeaker = undefined;
  currentNarrationDelivery = undefined;
  const remaining = allIds.filter((id) => !mentioned.has(id));
  if (remaining.length > 0) {
    makeVisible(remaining);
    pushStep({ kind: "draw", ids: remaining, parallel: false, implicit: true });
  }

  return { steps, states, labels, warnings };
}
