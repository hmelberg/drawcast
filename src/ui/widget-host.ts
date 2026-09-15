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
import { sceneAt } from "../render/plan";
import { withNewIdsVisible } from "../render/params";
import { answersMatch } from "../spec/answers";
import { h, logicalPoint } from "./dom";
import { gateIsOpen } from "./gates";
// Type-only: controls.ts imports this module for attachWidgetHost, so the
// crossing back has to be erased at compile time or the two would cycle.
import type { AskGateStep } from "./controls";

const CARD_LINGER_MS = 900;

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
  /** The order of the layout the widget's own patches last produced — the
   *  preview order `revealNew` compares against the mounted one (render/index.ts
   *  ~382), so a pad a patch mints is on screen and clickable at once. */
  let previewOrder: readonly string[] = [];

  const params = (): Record<string, unknown> => ({ ...(hd.spec.params ?? {}), ...hd.timeline.getParamOverrides(), ...patches });

  /** What the viewer can actually see right now: the paused boundary's own
   *  visible set, widened by the ids this widget's patches have revealed. */
  const visible = (): ReadonlySet<string> => {
    const drawn = new Set(sceneAt(hd.plan, hd.timeline.position).visible);
    return previewOrder.length > 0 ? withNewIdsVisible(new Set(hd.layout.order), previewOrder, drawn) : drawn;
  };

  // One scene per (painted geometry, params, boundary). `over()` runs on every
  // pointermove, and building a scene runs the template's layout body — so the
  // answer is remembered until something that could change it does.
  let memo: { layout: unknown; key: string; scene: WidgetScene | null } | null = null;
  const scene = (): WidgetScene | null => {
    const painted = hd.timeline.paintedLayout() ?? hd.layout;
    const p = params();
    const key = `${hd.timeline.position}|${previewOrder.length}|${JSON.stringify(p)}`;
    if (memo && memo.layout === painted && memo.key === key) return memo.scene;
    const built = buildWidgetScene(module, p, { domain: hd.spec.domain, vars: Object.fromEntries(hd.timeline.vars), layout: painted, measure: deps.measure, visible: visible() });
    memo = { layout: painted, key, scene: built };
    return built;
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
        // The patched layout's own order: whatever it mints that the mounted
        // layout never had is now painted (revealNew), so the host must count
        // it as visible too or the widget could not click what it just drew.
        try {
          previewOrder = module.layout!(params()).order;
        } catch {
          previewOrder = [];
        }
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
        // Construction and init() are the author's code: a body that throws
        // reports and stands down — the gate does the same (below), and the
        // click is still the widget's, so nothing falls through to the card.
        try {
          body = module.widget!();
          state = body.init(sc);
        } catch (err) {
          warn(`widget body threw on mount: ${(err as Error).message}`);
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
      previewOrder = [];
      memo = null;
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

/** A template-bound ask's gate: the figure gate's hint and Skip, clicks routed
 *  to the host, resolved by the widget's next `answer` effect. Resolves a
 *  string like every gate: the step's answer when judged right (so the
 *  player's answersMatch agrees), the given string otherwise. */
export function widgetGateFor(stage: HTMLElement, hd: RenderHandle, host: WidgetHost): (signal: AbortSignal, step: AskGateStep) => Promise<string | null> {
  return (signal, step) =>
    new Promise<string | null>((resolve) => {
      stage.querySelector(".cs-figgate")?.remove();
      const hint = h("span", { class: "cs-waitgate-pill cs-figgate-hint" }, "Use the figure ▸");
      const gate = h("div", { class: "cs-figgate" }, hint);
      const template = hd.spec.template;
      // A body of this template's own, used for `judge` alone — the host keeps
      // the one that holds the viewer's state. A body that throws on
      // construction must not take the question down with it: without one the
      // gate still stands and answersMatch judges, which is the same contract
      // every other gate has.
      let body: WidgetBody | null = null;
      try {
        body = template && scenes[template]?.widget ? scenes[template]!.widget!() : null;
      } catch (err) {
        console.warn(`[widget ${template}] gate: widget body threw on load: ${(err as Error).message} — judging with answersMatch`);
      }
      let settled = false;
      // The one place either subscription comes off.
      const detach = (): void => {
        unsubscribe();
        signal.removeEventListener("abort", onAbort);
      };
      /** The answerless exits (abort, Skip): nothing to show, so nothing lingers. */
      const finish = (value: string | null): void => {
        if (settled) return;
        settled = true;
        detach();
        gate.remove();
        resolve(value);
      };
      const onAbort = (): void => finish(null);
      const unsubscribe = host.onAnswer((given) => {
        if (settled) return;
        if (step.answer === undefined || !body) return finish(given);
        const ok = body.judge ? body.judge(given, step.answer) : answersMatch(given, step.answer);
        const gr = gate.getBoundingClientRect();
        const mark = h("span", { class: `cs-figgate-mark ${ok ? "right" : "wrong"}` });
        mark.style.left = `${gr.width / 2}px`;
        mark.style.top = `${gr.height / 2}px`;
        gate.appendChild(mark);
        hint.remove();
        settled = true;
        detach();
        window.setTimeout(() => gate.remove(), CARD_LINGER_MS);
        resolve(ok ? step.answer : given);
      });
      gate.addEventListener("click", (e) => {
        e.stopPropagation();
        if (settled) return;
        const p = logicalPoint(stage, e);
        if (p) host.clickAt(p);
      });
      if (!step.required) {
        const skip = h("button", { class: "cs-cardgate-pill skip cs-figgate-skip" }, "Skip ▸");
        skip.addEventListener("click", (e) => {
          e.stopPropagation();
          finish(null);
        });
        gate.appendChild(skip);
      }
      signal.addEventListener("abort", onAbort);
      stage.appendChild(gate);
    });
}
