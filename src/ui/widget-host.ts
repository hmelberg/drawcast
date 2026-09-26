// The widget host (spec §2.3): while paused, a gesture on one of the
// template's parts runs the widget body and performs its effects; nothing
// persists past the preview. ONE gesture is tracked — press, move, release —
// and read at the end (§2.2 addendum 2026-09-15b): a press that barely moved
// is a click, one that moved is a drag, and the pressed part follows the
// pointer as a ghost on the renderer's offset — or, for a LIVE body
// (2026-09-26), the figure itself recomputes under the pointer once a frame
// through the tray's previewParams, and a tap passes through. The DOM-free core
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
import { withNewIdsVisible, withOverrides } from "../render/params";
import { answersMatch } from "../spec/answers";
import { overCaption } from "./caption";
import { h, logicalPoint } from "./dom";
import { CONTROL_SELECTOR, gateIsOpen } from "./gates";
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
   *  body's own patch moves geometry for real); null when nothing was pressed.
   *  "pass" is a live body's tap: not its gesture, so the caller lets the
   *  click go on to the card or the play toggle. */
  release(p: Pt): "click" | "drag" | "pass" | null;
  /** Drop the gesture and its ghost without delivering anything (pointercancel). */
  cancel(): void;
  /** True once the live gesture has passed DRAG_MIN — the stage's cursor
   *  reads this alone to swap a grab for a grabbing hand; false with no
   *  gesture in flight and false again the moment one ends. */
  dragging(): boolean;
  /** The keys the body asked for (DOM KeyboardEvent.key values); empty for a
   *  click-only widget, and then no key listener is installed at all. */
  keys: readonly string[];
  /** Deliver a released key: true when the body declared it (and ran). */
  keyPress(key: string, ms: number): boolean;
  /** True when p is over a part (the cursor rule; no side effects). A live
   *  body's parts are NOT "over" — a tap on them is the card's (see live). */
  over(p: Pt): boolean;
  /** A live body only: true when p is on a part a press would grab — the
   *  hover's grab hand (cs-draggable). Always false for other bodies. */
  grabbable(p: Pt): boolean;
  /** The body drags live (WidgetBody.live): the figure recomputes under the
   *  pointer, a tap passes through. */
  live: boolean;
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
  /** A live drag's frame clock: runs fn once, soon; returns its cancel.
   *  requestAnimationFrame in the app, synchronous in tests. */
  frame?: (fn: () => void) => () => void;
}

const animationFrame = (fn: () => void): (() => void) => {
  if (typeof requestAnimationFrame === "function") {
    const h = requestAnimationFrame(fn);
    return () => cancelAnimationFrame(h);
  }
  const t = setTimeout(fn, 16);
  return () => clearTimeout(t);
};

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
  // Its named parts and its live flag come off the same probe.
  const probe: { keys: string[]; parts?: string[]; live: boolean } = (() => {
    try {
      const b = module.widget!();
      return { keys: b.keys ?? [], ...(Array.isArray(b.parts) ? { parts: b.parts } : {}), live: b.live === true };
    } catch {
      return { keys: [], live: false };
    }
  })();
  const declaredKeys = probe.keys;
  const live = probe.live;
  const frame = deps.frame ?? animationFrame;
  /** Which part a press at p takes: the body's named parts, else the surface. */
  const hit = (sc: WidgetScene, p: Pt): string | null => partAt(sc, p, 18, probe.parts);

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
  let gesture: {
    id: string;
    start: Pt;
    moved: boolean;
    /** Live bodies: the scene as pressed (every drag_move maps against it),
     *  the patches before the press (a cancel puts them back), and the
     *  latest pointer waiting for its frame. */
    scene: WidgetScene;
    before: Record<string, unknown>;
    pending: Pt | null;
    unframe: (() => void) | null;
  } | null = null;

  // The params AT THIS BOUNDARY, as the tray reads them (tray.ts
  // effectiveParams): what the author wrote, the storyboard's animate values
  // so far, the viewer's var overrides — then the widget's own patches. The
  // boundary layer matters the moment a cast animates what a body patches:
  // a supply_demand lesson that has tweened the tax to 30 must be dragged
  // FROM 30, not snapped back to the authored 18 on the first frame.
  // (`vars.*` paths are the spec's vars, not template params — left out.)
  const templatePaths = (o: Record<string, unknown>): Record<string, unknown> => Object.fromEntries(Object.entries(o).filter(([k]) => !k.startsWith("vars.")));
  const params = (): Record<string, unknown> => ({
    ...withOverrides(withOverrides(hd.spec.params, templatePaths(sceneAt(hd.plan, hd.timeline.position).params)), templatePaths(hd.timeline.getParamOverrides())),
    ...patches,
  });

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

  /** Make `next` the widget's patches and paint them — the tray's route
   *  (previewParams), so intersections, guides and regions all recompute. */
  const paint = (next: Record<string, unknown>): void => {
    patches = next;
    hd.timeline.previewParams(patches, { revealNew: true });
    // The patched layout's own order: whatever it mints that the mounted
    // layout never had is now painted (revealNew), so the host must count
    // it as visible too or the widget could not click what it just drew.
    try {
      previewOrder = module.layout!(params()).order;
    } catch {
      previewOrder = [];
    }
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
      if (e.patch && Object.keys(e.patch).length > 0) paint({ ...patches, ...e.patch });
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

  /** A live drag's latest pointer, delivered against the press-time scene. */
  const flush = (): void => {
    const g = gesture;
    if (!g) return;
    g.unframe = null;
    const p = g.pending;
    g.pending = null;
    if (!p) return;
    run(g.scene, { type: "drag_move", id: g.id, from: g.start, fromDomain: g.scene.toDomain(g.start), point: p, domain: g.scene.toDomain(p) });
  };
  /** Forget the gesture and any frame it booked — nothing painted, nothing put back. */
  const drop = (): void => {
    gesture?.unframe?.();
    gesture = null;
  };

  const host: WidgetHost = {
    keys: Object.freeze(declaredKeys),
    live,
    over(p) {
      // A live body's parts are its only by DRAGGING; standing the card aside
      // for them (infocard.ts targetAt) would make a tap on a named curve dead.
      if (live) return false;
      const sc = scene();
      return sc !== null && hit(sc, p) !== null;
    },
    grabbable(p) {
      if (!live) return false;
      const sc = scene();
      return sc !== null && hit(sc, p) !== null;
    },
    clickAt(p) {
      // The whole gesture in one point — the harness, the tests and anything
      // that has a click and no pointer travel to read.
      return this.press(p) && this.release(p) === "click";
    },
    press(p) {
      // One gesture at a time: a second finger landing mid-drag would strand
      // the first part on an offset nothing owns any more.
      if (gesture) return false;
      const sc = scene();
      if (!sc) return false;
      const id = hit(sc, p);
      if (id === null) return false;
      gesture = { id, start: p, moved: false, scene: sc, before: patches, pending: null, unframe: null };
      return true;
    },
    move(p) {
      if (!gesture) return;
      const dx = p[0] - gesture.start[0],
        dy = p[1] - gesture.start[1];
      if (!gesture.moved && Math.hypot(dx, dy) < DRAG_MIN) return;
      gesture.moved = true;
      if (!live) {
        nudge(gesture.id, dx, dy);
        return;
      }
      // Live: the figure itself follows, at most once a frame — a pointer
      // reports far more often than a re-layout is worth painting.
      gesture.pending = p;
      if (!gesture.unframe) {
        let ran = false;
        const cancel = frame(() => {
          ran = true;
          flush();
        });
        // A synchronous clock (the tests') has already flushed.
        if (!ran && gesture) gesture.unframe = cancel;
      }
    },
    release(p) {
      if (!gesture) return null;
      const g = gesture;
      drop();
      if (live) {
        // A tap is not a live body's gesture: the caller lets its click go on.
        if (!g.moved) return "pass";
        // The last word is the release point itself, against the SAME
        // press-time scene every drag_move used — so the final patch is the
        // one the viewer was looking at, not one frame behind it.
        const now = scene();
        run(g.scene, { type: "drag", id: g.id, to: now ? hit(now, p) : null, point: p, domain: g.scene.toDomain(p), from: g.start, fromDomain: g.scene.toDomain(g.start) });
        return "drag";
      }
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
      run(sc, { type: "drag", id: g.id, to: hit(sc, p), point: p, domain: sc.toDomain(p), from: g.start, fromDomain: sc.toDomain(g.start) });
      return "drag";
    },
    cancel() {
      if (!gesture) return;
      const g = gesture;
      drop();
      if (!g.moved) return;
      // A live drag has been painting for real: a cancelled one (the browser
      // took the pointer, a drop on a button) puts back what was there before
      // the press, as the ghost goes back for everyone else.
      if (live) paint(g.before);
      else nudge(g.id, 0, 0);
    },
    dragging: () => gesture?.moved === true,
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
      // Everything goes below, so a live drag in flight is simply dropped —
      // painting its "before" now would dirty the geometry play is settling.
      if (live) drop();
      else this.cancel();
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

/** Whose press is this? The stage's press guard as a pure function of six
 *  flags, so it can be unit-tested rather than read: a press is the widget's
 *  only while the figure is not running past it (or the widget's own gate is
 *  up, which is what that gate is FOR), nowhere near a control, the caption
 *  band or an open info card, and with no other gate holding the run.
 *
 *  The clause that matters: during an ask the player stays in state "playing"
 *  (the gate is awaited inside the play loop), so a bare `playing` test made
 *  EVERY widget ask dead to the pointer — the gate's own router, since
 *  removed, used to compensate. `ownGate` is the exception the keys have had
 *  all along (keysBlocked below reads it the same way). */
export function pressBlocked(f: { playing: boolean; ownGate: boolean; foreignGate: boolean; onControl: boolean; onCaption: boolean; onCard: boolean }): boolean {
  // The big play overlay and the gate pills are buttons INSIDE the stage, the
  // param tray and the code card are controls on it, the subtitle band lies
  // across the bottom of the canvas, an open info card floats over the figure.
  // A press on any of them belongs to that thing, never to a part.
  if (f.onControl || f.onCaption || f.onCard) return true;
  // Another gate holds the run: its card is the door, not the figure.
  if (f.foreignGate) return true;
  // Playing, the gesture is the movie's (a click pauses it) — unless the
  // widget's own gate is up, where working the figure IS the question.
  return f.playing && !f.ownGate;
}

/** Wire the host to a stage: capture-phase clicks while paused, resets on
 *  playback and step boundaries. Null when the template has no widget body.
 *  The cursor's `cs-cardable` class is NOT toggled here — infocard.ts owns
 *  that one toggle (its own pointermove already runs after this add-on's
 *  click listener attaches, and now consults `host.over(p)` too), so a pad
 *  and a card element never fight over the same class in the same tick.
 *  `cs-grabbable`/`cs-grabbing`, the press-and-drag cursor, IS this add-on's
 *  own: cs-cardable only ever says "something is here", and only this host
 *  knows whether that something is currently being held. */
export function attachWidgetHost(stage: HTMLElement, hd: RenderHandle): WidgetHost | null {
  const host = widgetHostFor(hd, { measure: makeBrowserMeasure() });
  if (!host) return null;

  // One pointer gesture, read at release (spec §2.2 addendum 2026-09-15b),
  // with ONE owner. Capture phase so the stage's play/pause toggle never sees
  // it — and these listeners also stand UNDER the widget's own gate, because
  // the gate is a child of the stage and they see its events first: a second
  // router on the gate raced with this one, delivering the release twice and
  // letting a drop on Skip both answer the question and skip it (review
  // 2026-09-15).
  let swallowClick = false;
  /** The swallowed click follows a DRAG: stand every other listener down. */
  let swallowAll = false;
  /** The pointer that owns the gesture; every other one is someone else's. */
  let activeId: number | null = null;
  /** The figure's own inline touch-action (a piano stage sets "none" for the
   *  whole mount) — restored at the end, so the press only BORROWS it. */
  let priorTouchAction = "";
  /** Both grab-cursor classes at once — the ONE place they come off, used by
   *  every gesture exit (a normal release, a cancel, a lost capture) AND by
   *  the onState/onStep chains below. reset()/cancel() in the host CORE
   *  never touch the DOM, so a play or step that lands mid-press (a
   *  keyboard-activated play button, a scrub) would otherwise leave a grab
   *  or grabbing class sitting on the stage until whatever pointer is still
   *  down finally lifts. */
  const clearGrab = (): void => {
    stage.classList.remove("cs-grabbable", "cs-grabbing");
  };
  /** The widget's OWN ask gate is up — the marker the keys read too. It comes
   *  off the moment the gate settles, so the mark's 900 ms linger is foreign. */
  const ownGate = (): boolean => stage.querySelector(".cs-widgetgate") !== null;
  const blocked = (e: Event): boolean => {
    const own = ownGate();
    const t = e.target instanceof Element ? e.target : null;
    return pressBlocked({
      playing: hd.timeline.state === "playing",
      ownGate: own,
      foreignGate: gateIsOpen(stage) && !own,
      onControl: t !== null && t.closest(CONTROL_SELECTOR) !== null,
      onCaption: overCaption(e.target as Element | null),
      onCard: t !== null && t.closest(".cs-infocard") !== null,
    });
  };
  stage.addEventListener("pointerdown", (e) => {
    // A right- or middle-click, and a second finger, are nobody's gesture: no
    // click follows a secondary button, so letting one through would both run
    // the widget on a context menu and disarm a swallow a live press armed.
    if (!e.isPrimary || (e.pointerType === "mouse" && e.button !== 0)) return;
    swallowClick = false; // whatever an earlier press armed, this click is new
    swallowAll = false;
    if (blocked(e)) return;
    const p = logicalPoint(stage, e);
    if (!p || !host.press(p)) return;
    activeId = e.pointerId;
    swallowClick = true;
    // The grab cursor: a plain press, before it is known to be a drag.
    stage.classList.add("cs-grabbable");
    // A part being dragged is not a page to scroll (the piano's precedent),
    // and capture keeps a fast drag from escaping the stage mid-gesture.
    priorTouchAction = stage.style.touchAction;
    stage.style.touchAction = "none";
    try {
      stage.setPointerCapture(e.pointerId);
    } catch {
      /* a synthetic pointer has no capture to take */
    }
    e.preventDefault();
  }, true);
  // Nothing in flight means nothing to measure: logicalPoint reads the svg's
  // bounding box, and every pointer move over a paused figure would pay for it.
  // (It must never ask over() either — the hover class is the info card's.)
  stage.addEventListener("pointermove", (e) => {
    if (e.pointerId !== activeId) return;
    const p = logicalPoint(stage, e);
    if (!p) return;
    host.move(p);
    // The grabbing hand: read off the host's own gesture, not the move
    // event, the moment it flips — swapped, never merely added, so a stage
    // never wears both cursors at once.
    if (host.dragging()) stage.classList.replace("cs-grabbable", "cs-grabbing");
  }, true);
  const end = (e: PointerEvent, cancelled: boolean): void => {
    if (e.pointerId !== activeId) return;
    activeId = null;
    clearGrab();
    stage.style.touchAction = priorTouchAction;
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
    // A drop on a control (the gate's Skip pill) is that control's gesture:
    // the widget gets nothing and the ghost goes back. Under pointer capture
    // every event retargets to the STAGE, so the event's own target cannot
    // tell Skip from paper — the release point can.
    const dropped = document.elementFromPoint(e.clientX, e.clientY);
    const p = dropped instanceof Element && dropped.closest("button") !== null ? null : logicalPoint(stage, e);
    if (!p) {
      host.cancel();
      return;
    }
    const read = host.release(p);
    // A live body's tap was never its gesture: the click goes on, to the
    // part's card or the play toggle, exactly as if no widget were here.
    if (read === "pass") swallowClick = false;
    // A drag's click is nobody's — not even the info card's, whose own
    // capture listener sits on this same stage (so a plain stopPropagation
    // never reached it): a curve let go under the pointer is not a tap on it.
    swallowAll = read === "drag";
  };
  stage.addEventListener("pointerup", (e) => end(e, false), true);
  stage.addEventListener("pointercancel", (e) => end(e, true), true);
  // Capture yanked mid-gesture (the browser takes the pointer, the node goes
  // away): no pointerup and no click will follow, so the ghost and the armed
  // swallow would both be stranded. On the ORDINARY path end() has already
  // cleared activeId by the time this fires, so it does nothing at all.
  stage.addEventListener("lostpointercapture", (e) => {
    if (e.pointerId !== activeId) return;
    activeId = null;
    swallowClick = false;
    clearGrab();
    stage.style.touchAction = priorTouchAction;
    host.cancel();
  });
  // The click that follows a press which began on a part is the widget's
  // gesture already delivered — never the play/pause toggle (the piano's rule).
  stage.addEventListener("click", (e) => {
    if (swallowClick) {
      swallowClick = false;
      e.stopPropagation();
      e.preventDefault();
      // This listener is attached before the card's (controls.ts), so after a
      // drag it can stand the card's same-stage listener down too.
      if (swallowAll) e.stopImmediatePropagation();
    }
    swallowAll = false;
  }, true);

  // The hover's grab hand over what a live body lets the viewer drag (a
  // curve is thin — without it nothing says it can be taken). Its own class,
  // cs-draggable: cs-cardable stays the info card's sole toggle, and
  // cs-grabbable/cs-grabbing stay the press's. Only a live body installs it.
  if (host.live) {
    stage.addEventListener("pointermove", (e) => {
      if (activeId !== null) return; // a gesture's own classes rule
      const p = blocked(e) ? null : logicalPoint(stage, e);
      stage.classList.toggle("cs-draggable", p !== null && host.grabbable(p));
    });
    stage.addEventListener("pointerleave", () => stage.classList.remove("cs-draggable"));
  }

  // Playback, a scrub or a step lands honest geometry — chain, never replace
  // (the tray and the info card hang their own logic on these callbacks).
  const prevOnState = hd.timeline.callbacks.onState;
  hd.timeline.callbacks.onState = (s) => {
    prevOnState?.(s);
    if (s === "playing") {
      host.reset();
      // A press that never got to release (a keyboard-activated play button,
      // this landing mid-drag) leaves the host's own gesture cleared already
      // — but reset()/cancel() never touch the DOM, so without this the grab
      // classes and the borrowed touch-action would sit on the stage until
      // whatever pointer is still down finally lifts. Nulling activeId makes
      // that eventual pointerup inert: end()'s own `e.pointerId !== activeId`
      // guard is what stops it from running its drop-on-a-control dance
      // against a gesture that is already gone.
      clearGrab();
      stage.classList.remove("cs-draggable"); // the movie has nothing to grab
      activeId = null;
      stage.style.touchAction = priorTouchAction;
    }
  };
  const prevOnStep = hd.timeline.callbacks.onStep;
  hd.timeline.callbacks.onStep = (completed, total) => {
    prevOnStep?.(completed, total);
    host.reset();
    clearGrab();
    activeId = null;
    stage.style.touchAction = priorTouchAction;
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
      (hd.timeline.state === "playing" && !ownGate()) ||
      (gateIsOpen(stage) && !ownGate()) ||
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

/** A template-bound ask's gate: the figure gate's hint and Skip, resolved by
 *  the widget's next `answer` effect. It routes NO gestures of its own — the
 *  stage's listeners (attachWidgetHost) read the gesture under this gate the
 *  same way they do in free play, and two routers on the same events raced.
 *  Resolves a
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
        // The mark lingers 900 ms — but the question is OVER. The marker class
        // comes off right here (cs-figgate stays, so gateIsOpen still holds),
        // and the stage's guards read the linger as any other gate: no press
        // reaches the body after the answer has been judged.
        gate.classList.remove("cs-widgetgate");
        settled = true;
        detach();
        window.setTimeout(() => gate.remove(), CARD_LINGER_MS);
        resolve(ok ? step.answer : given);
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
