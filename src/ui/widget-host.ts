// The widget host (spec §2.3): while paused, a click on one of the template's
// parts runs the widget body and performs its effects; nothing persists past
// the preview. The DOM-free core (widgetHostFor) is what tests drive; the
// stage listener (attachWidgetHost) is source-pinned.
import type { RenderHandle } from "../render";
import type { Pt } from "../layout/model";
import type { MeasureFn } from "../layout/measure";
import { scenes } from "../scenes/registry";
import { buildWidgetScene, paramNamesOf } from "../scenes/widget-scene";
import { partAt, stepWidget } from "../scenes/widget-run";
import type { WidgetEffect } from "../scenes/widget-effects";
import type { WidgetBody, WidgetScene } from "../scenes/widget-types";
import { makeBrowserMeasure } from "../render/svg-backend";
import { logicalPoint } from "./dom";
import { gateIsOpen } from "./gates";

export interface WidgetHost {
  /** Route a logical point: true when it hit a part (and the widget ran). */
  clickAt(p: Pt): boolean;
  /** True when p is over a part (the cursor rule; no side effects). */
  over(p: Pt): boolean;
  lastAnswer(): string | null;
  /** Subscribe to answer effects; returns the unsubscribe. */
  onAnswer(fn: (value: string) => void): () => void;
  /** Drop state, patches and caption — the preview is gone. */
  reset(): void;
}

export interface WidgetHostDeps {
  warn?: (msg: string) => void;
  /** Text measure for boxes; the browser's in the app, the heuristic in tests. */
  measure?: MeasureFn;
}

export function widgetHostFor(hd: RenderHandle, deps: WidgetHostDeps = {}): WidgetHost | null {
  const template = hd.spec.template;
  const module = template ? scenes[template] : undefined;
  if (!module?.widget || !module.layout) return null;
  const warn = deps.warn ?? ((m: string) => console.warn(`[widget ${template}] ${m}`));
  const names = paramNamesOf(module);
  const listeners = new Set<(v: string) => void>();

  let body: WidgetBody | null = null;
  let state: unknown;
  let patches: Record<string, unknown> = {};
  let answer: string | null = null;
  let captioned = false;

  const params = (): Record<string, unknown> => ({ ...(hd.spec.params ?? {}), ...hd.timeline.getParamOverrides(), ...patches });
  const scene = (): WidgetScene | null => {
    const painted = hd.timeline.paintedLayout() ?? hd.layout;
    return buildWidgetScene(module, params(), { domain: hd.spec.domain, vars: Object.fromEntries(hd.timeline.vars), layout: painted, measure: deps.measure });
  };

  const perform = (effects: WidgetEffect[], sc: WidgetScene): void => {
    for (const e of effects) {
      if (e.sound) {
        const tones = hd.timeline.tones;
        if (tones) {
          if ("hz" in e.sound) tones.beep(e.sound.hz, e.sound.ms);
          else tones.play([{ notes: e.sound.notes }], e.sound.tempo ?? 120);
        }
      }
      if (e.patch && Object.keys(e.patch).length > 0) {
        patches = { ...patches, ...e.patch };
        hd.timeline.previewParams(patches, { revealNew: true });
      }
      if (e.glow) void hd.timeline.glow(e.glow, undefined, e.color);
      if (e.pointer) {
        const b = sc.boxes.get(e.pointer);
        if (b) void hd.timeline.tapAt(b);
      }
      if (e.caption !== undefined) {
        hd.timeline.caption(e.caption);
        captioned = true;
      }
      if (e.answer !== undefined) {
        answer = e.answer;
        for (const fn of listeners) fn(e.answer);
      }
    }
  };

  const host: WidgetHost = {
    over(p) {
      const sc = scene();
      return sc !== null && partAt(sc, p) !== null;
    },
    clickAt(p) {
      const sc = scene();
      if (!sc) return false;
      const id = partAt(sc, p);
      if (id === null) return false;
      if (!body) {
        body = module.widget!();
        try {
          state = body.init(sc);
        } catch (err) {
          warn(`init() threw: ${(err as Error).message}`);
          body = null;
          return true;
        }
      }
      const r = stepWidget(body, state, { type: "click", id, point: p, domain: sc.toDomain(p) }, sc, names);
      for (const m of r.errors) warn(m);
      state = r.state;
      perform(r.effects, sc);
      return true;
    },
    lastAnswer: () => answer,
    onAnswer(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    reset() {
      body = null;
      state = undefined;
      patches = {};
      answer = null;
      if (captioned) {
        hd.timeline.caption(null);
        captioned = false;
      }
    },
  };
  return host;
}

/** Wire the host to a stage: capture-phase clicks while paused, resets on
 *  playback and step boundaries. Null when the template has no widget body.
 *  The cursor's `cs-cardable` class is NOT toggled here — infocard.ts owns
 *  that one toggle (its own pointermove already runs after this add-on's
 *  click listener attaches, and now consults `host.over(p)` too), so a pad
 *  and a card element never fight over the same class in the same tick. */
export function attachWidgetHost(stage: HTMLElement, hd: RenderHandle): WidgetHost | null {
  const host = widgetHostFor(hd, { measure: makeBrowserMeasure() });
  if (!host) return null;

  stage.addEventListener("click", (e) => {
    if (hd.timeline.state === "playing") return;
    if (gateIsOpen(stage)) return;
    const p = logicalPoint(stage, e);
    if (!p) return;
    if (host.clickAt(p)) {
      e.stopPropagation();
      e.preventDefault();
    }
  }, true);

  // Playback, a scrub or a step lands honest geometry — chain, never replace
  // (the tray and the info card hang their own logic on these callbacks).
  const prevOnState = hd.timeline.callbacks.onState;
  hd.timeline.callbacks.onState = (s) => {
    prevOnState?.(s);
    if (s === "playing") host.reset();
  };
  const prevOnStep = hd.timeline.callbacks.onStep;
  hd.timeline.callbacks.onStep = (completed, total) => {
    prevOnStep?.(completed, total);
    host.reset();
  };
  return host;
}
