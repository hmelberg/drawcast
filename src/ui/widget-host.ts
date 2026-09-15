// The widget host (spec §2.3): while paused, a gesture on one of the
// template's parts runs the widget body and performs its effects; nothing
// persists past the preview. ONE gesture is tracked — press, move, release —
// and read at the end (§2.2 addendum 2026-09-15b): a press that barely moved
// is a click, one that moved is a drag, and the pressed part follows the
// pointer as a ghost on the renderer's offset. The DOM-free core
// (widgetHostFor) is what tests drive; the stage listeners (attachWidgetHost)
// are source-pinned.
import type { RenderHandle } from "../render";
import type { Pt } from "../layout/model";
import type { MeasureFn } from "../layout/measure";
import { scenes } from "../scenes/registry";
import { buildWidgetScene, paramNamesOf } from "../scenes/widget-scene";
import { partAt, stepWidget } from "../scenes/widget-run";
import type { WidgetEffect } from "../scenes/widget-effects";
import type { WidgetBody, WidgetEvent, WidgetScene } from "../scenes/widget-types";
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

/** How far a press must travel, in logical units, for the release to read it
 *  as a drag rather than a click. Decided at RELEASE, never before: a press
 *  that wanders 5 units and comes back is still a click. */
export const DRAG_MIN = 6;

export interface WidgetHost {
  /** Route a logical point: true when it hit a part (and the widget ran) —
   *  a press and a release in the same place. */
  clickAt(p: Pt): boolean;
  /** Begin the gesture: true when a part is under p, and the caller then owns
   *  the pointer until release() or cancel(). False leaves everything alone. */
  press(p: Pt): boolean;
  /** Carry the pressed part along: past DRAG_MIN it ghosts under the pointer.
   *  A no-op when no gesture is in flight, so it is free at rest. */
  move(p: Pt): void;
  /** Read the gesture at release: "click" when it barely moved, "drag" when it
   *  did (the ghost is cleared BEFORE the event is delivered, so only the
   *  body's own patch moves geometry for real); null when nothing was pressed. */
  release(p: Pt): "click" | "drag" | null;
  /** Drop the gesture and its ghost without delivering anything (pointercancel). */
  cancel(): void;
  /** The keys the body asked for (DOM KeyboardEvent.key values); empty for a
   *  click-only widget, and then no key listener is installed at all. */
  keys: readonly string[];
  /** Deliver a released key: true when the body declared it (and ran). */
  keyPress(key: string, ms: number): boolean;
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
  /** The drag ghost: the renderer's per-element offset (the player's `nudge`
   *  in the app, a recorder in tests). (0, 0) puts the part back. */
  nudge?: (id: string, dx: number, dy: number) => void;
}

export function widgetHostFor(hd: RenderHandle, deps: WidgetHostDeps = {}): WidgetHost | null {
  const template = hd.spec.template;
  const module = template ? scenes[template] : undefined;
  if (!module?.widget || !module.layout) return null;
  const warn = deps.warn ?? ((m: string) => console.warn(`[widget ${template}] ${m}`));
  const nudge = deps.nudge ?? ((id: string, dx: number, dy: number) => hd.timeline.nudge(id, dx, dy));
  const names = paramNamesOf(module);
  const listeners = new Set<(v: string) => void>();
  // The keys the body asked for: read once, from a probe body that is then
  // discarded (the host's own body still mounts on the first event). A body
  // that throws on construction simply wants no keys — clickAt says so too.
  const declaredKeys: string[] = (() => {
    try {
      return module.widget!().keys ?? [];
    } catch {
      return [];
    }
  })();

  let body: WidgetBody | null = null;
  let state: unknown;
  let patches: Record<string, unknown> = {};
  let answer: string | null = null;
  let captioned = false;
  /** The order of the layout the widget's own patches last produced — the
   *  preview order `revealNew` compares against the mounted one (render/index.ts
   *  ~382), so a pad a patch mints is on screen and clickable at once. */
  let previewOrder: readonly string[] = [];
  /** The one pointer gesture in flight: the part pressed, where the press
   *  began, and whether it has passed DRAG_MIN (once past, it stays a drag). */
  let gesture: { id: string; start: Pt; moved: boolean } | null = null;

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

  /** One event's whole journey: mount on the first one, step, keep the state,
   *  perform. A click and a key press differ only in the event they carry. */
  const run = (sc: WidgetScene, ev: WidgetEvent): void => {
    if (!body) {
      // Construction and init() are the author's code: a body that throws
      // reports and stands down — the gate does the same (below), and the
      // event is still the widget's, so nothing falls through to the card.
      try {
        body = module.widget!();
        state = body.init(sc);
      } catch (err) {
        warn(`widget body threw on mount: ${(err as Error).message}`);
        body = null;
        return;
      }
    }
    const r = stepWidget(body, state, ev, sc, names);
    for (const m of r.errors) warn(m);
    state = r.state;
    perform(r.effects, sc);
  };

  const host: WidgetHost = {
    keys: Object.freeze(declaredKeys),
    over(p) {
      const sc = scene();
      return sc !== null && partAt(sc, p) !== null;
    },
    clickAt(p) {
      // The whole gesture in one point — the harness, the tests and anything
      // that has a click and no pointer travel to read.
      return this.press(p) && this.release(p) === "click";
    },
    press(p) {
      const sc = scene();
      if (!sc) return false;
      const id = partAt(sc, p);
      if (id === null) return false;
      gesture = { id, start: p, moved: false };
      return true;
    },
    move(p) {
      if (!gesture) return;
      const dx = p[0] - gesture.start[0],
        dy = p[1] - gesture.start[1];
      if (!gesture.moved && Math.hypot(dx, dy) < DRAG_MIN) return;
      gesture.moved = true;
      nudge(gesture.id, dx, dy);
    },
    release(p) {
      if (!gesture) return null;
      const g = gesture;
      gesture = null;
      // The ghost goes first — before the scene, before the event: the body's
      // patch is the only thing that may move geometry for real, and a part
      // left hanging on an offset nothing owns never finds its way back.
      if (g.moved) nudge(g.id, 0, 0);
      const sc = scene();
      if (!sc) return null;
      if (!g.moved) {
        run(sc, { type: "click", id: g.id, point: g.start, domain: sc.toDomain(g.start) });
        return "click";
      }
      run(sc, { type: "drag", id: g.id, to: partAt(sc, p), point: p, domain: sc.toDomain(p) });
      return "drag";
    },
    cancel() {
      if (!gesture) return;
      if (gesture.moved) nudge(gesture.id, 0, 0);
      gesture = null;
    },
    keyPress(key, ms) {
      if (!declaredKeys.includes(key)) return false;
      const sc = scene();
      if (!sc) return false;
      run(sc, { type: "key", key, ms });
      return true;
    },
    lastAnswer: () => answer,
    onAnswer(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    reset() {
      this.cancel();
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

  // One pointer gesture, read at release (spec §2.2 addendum 2026-09-15b).
  // Capture phase so the stage's play/pause toggle never sees it. The big play
  // overlay and the gate pills are buttons INSIDE the stage: a press on one
  // over a large ringed part (Hanoi's middle peg zone, the gate body) is the
  // button's, never the widget's — the chess and piano guard.
  let swallowClick = false;
  const blocked = (e: Event): boolean =>
    hd.timeline.state === "playing" ||
    (e.target instanceof Element && e.target.closest("button") !== null) ||
    gateIsOpen(stage);
  stage.addEventListener("pointerdown", (e) => {
    if (blocked(e)) return;
    const p = logicalPoint(stage, e);
    if (!p || !host.press(p)) return;
    swallowClick = true;
    // A part being dragged is not a page to scroll (the piano's precedent),
    // and capture keeps a fast drag from escaping the stage mid-gesture.
    stage.style.touchAction = "none";
    try {
      stage.setPointerCapture(e.pointerId);
    } catch {
      /* a synthetic pointer has no capture to take */
    }
    e.preventDefault();
  }, true);
  // host.move is a no-op without a gesture, so this costs nothing at rest —
  // and it must never ask over(): the hover class is the info card's.
  stage.addEventListener("pointermove", (e) => {
    const p = logicalPoint(stage, e);
    if (p) host.move(p);
  }, true);
  const end = (e: PointerEvent, cancelled: boolean): void => {
    stage.style.touchAction = "";
    try {
      stage.releasePointerCapture(e.pointerId);
    } catch {
      /* not captured */
    }
    if (cancelled) {
      // No click follows a cancelled pointer, so the armed swallow would sit
      // there and eat the NEXT one — a tap on the play button, doing nothing.
      swallowClick = false;
      host.cancel();
      return;
    }
    const p = logicalPoint(stage, e);
    if (p) host.release(p);
    else host.cancel();
  };
  stage.addEventListener("pointerup", (e) => end(e, false), true);
  stage.addEventListener("pointercancel", (e) => end(e, true), true);
  // The click that follows a press which began on a part is the widget's
  // gesture already delivered — never the play/pause toggle (the piano's rule).
  stage.addEventListener("click", (e) => {
    if (swallowClick) {
      swallowClick = false;
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

  // The keys (spec §2.2 addendum), the piano's free-play pattern: window
  // listeners ONLY for a body that asked for keys, so a click-only widget
  // adds none at all. One `key` event per release, with the held ms.
  if (host.keys.length > 0) {
    const downAt = new Map<string, number>();
    const typing = (t: EventTarget | null): boolean =>
      t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || (t instanceof HTMLElement && t.isContentEditable);
    // While playing, and under any OTHER gate, the keys are not the widget's;
    // under its own gate (cs-widgetgate) they are the whole point. The
    // gate's OWN controls (its Skip pill, a card gate's pill) are reachable
    // by Tab, and a key landing there — Space activating Skip, say — is the
    // control's gesture, never the widget's, exactly like the click guard
    // below for the play button.
    const keysBlocked = (e: KeyboardEvent): boolean =>
      typing(e.target) ||
      (hd.timeline.state === "playing" && !stage.querySelector(".cs-widgetgate")) ||
      (gateIsOpen(stage) && !stage.querySelector(".cs-widgetgate")) ||
      (e.target instanceof Element && e.target.closest(".cs-figgate-skip, .cs-cardgate-pill") !== null);
    const onKeyDown = (e: KeyboardEvent): void => {
      if (!stage.isConnected) {
        window.removeEventListener("keydown", onKeyDown);
        window.removeEventListener("keyup", onKeyUp);
        return;
      }
      if (!host.keys.includes(e.key) || keysBlocked(e)) return;
      // A declared key is the widget's: preventDefault stops a focused play
      // button from activating and the page from scrolling on Space. (No
      // stopPropagation — this listener sits on window, already last in the
      // bubble phase, so there is nothing left it could stop.)
      e.preventDefault();
      if (e.repeat) return;
      downAt.set(e.key, performance.now());
    };
    const onKeyUp = (e: KeyboardEvent): void => {
      if (!stage.isConnected) {
        window.removeEventListener("keydown", onKeyDown);
        window.removeEventListener("keyup", onKeyUp);
        return;
      }
      const t0 = downAt.get(e.key);
      if (t0 === undefined) return;
      downAt.delete(e.key);
      if (keysBlocked(e)) return;
      e.preventDefault();
      host.keyPress(e.key, Math.max(1, Math.round(performance.now() - t0)));
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
  }
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
      // The marker the key listeners look for: under THIS gate the widget's
      // own keys still work, under any other gate they stand aside.
      const gate = h("div", { class: "cs-figgate cs-widgetgate" }, hint);
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
      // The gate's overlay covers the figure, so the gesture is read HERE —
      // the same four calls the stage makes, so a drag works under the ask
      // exactly as it does in free play. The gate's own pills are buttons.
      const onGate = (e: PointerEvent): boolean => !settled && !(e.target instanceof Element && e.target.closest("button") !== null);
      gate.addEventListener("pointerdown", (e) => {
        e.stopPropagation();
        if (!onGate(e)) return;
        const p = logicalPoint(stage, e);
        if (p) host.press(p);
      });
      gate.addEventListener("pointermove", (e) => {
        if (!onGate(e)) return;
        const p = logicalPoint(stage, e);
        if (p) host.move(p);
      });
      gate.addEventListener("pointerup", (e) => {
        if (!onGate(e)) return;
        const p = logicalPoint(stage, e);
        if (p) host.release(p);
        else host.cancel();
      });
      gate.addEventListener("pointercancel", () => host.cancel());
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
