// tests/widget-host.test.ts
import { readFileSync } from "node:fs";
import { describe, expect, test, vi } from "vitest";
import { compileTemplateDoc } from "../src/scenes/compile";
import { scenes } from "../src/scenes/registry";
import { pressBlocked, widgetHostFor } from "../src/ui/widget-host";
import { layoutSpec } from "../src/layout/layout";
import { INITIAL_STATE, type Plan } from "../src/render/plan";
import type { RenderHandle } from "../src/render";
import type { TemplateDoc } from "../src/scenes/doc";

const doc = {
  template: "host_pads",
  version: 1,
  kit: 10,
  status: "ready",
  description: "Two pads.",
  params: { type: "object", properties: { signal: { type: "string" } } },
  element_ids: { dot: "dot pad", gap: "gap pad", signal: "the strip" },
  examples: [{ request: "pads", params: {} }],
  layout: `
    const drawables = [kit.pad("dot", [300, 400], "·", { r: 40 }), kit.pad("gap", [500, 400], "gap", { w: 90, h: 60 }), kit.text("signal", [400, 550], params.signal ?? "", { fontSize: 30 })];
    return { drawables, labels: [], anchors: {}, order: ["dot", "gap", "signal"] };`,
  widget: `
    const init = () => ({ signal: "" });
    const dot = (st) => { const signal = st.signal + "."; return { state: { signal }, effects: [{ sound: { hz: 700, ms: 80 } }, { patch: { signal } }, { glow: "dot" }] }; };
    const on = (ev, st) => {
      if (ev.type === "key") return ev.key === " " && ev.ms < 200 ? dot(st) : { state: st, effects: [] };
      if (ev.type === "drag") return { state: st, effects: [{ caption: ev.id + ">" + ev.to }] };
      if (ev.id === "dot") return dot(st);
      if (ev.id === "gap") return { state: st, effects: [{ answer: st.signal }, { caption: "sent" }, { patch: { nope: 1 } }] };
      return { state: st, effects: [] };
    };
    return { init, on, keys: [" "] };`,
} as TemplateDoc;

scenes["host_pads"] = compileTemplateDoc(doc).module!;

// A second document whose PART SET depends on a param: the send pad exists
// only once something has been sent. The widget's own patch is what mints it,
// so this is the "revealed since mount" case (F1) in its smallest form.
scenes["host_reveal"] = compileTemplateDoc({
  ...doc,
  template: "host_reveal",
  element_ids: { dot: "dot pad", sent: "the send pad" },
  layout: `
    const drawables = [kit.pad("dot", [300, 400], "·", { r: 40 })];
    const order = ["dot"];
    if ((params.signal ?? "") !== "") { drawables.push(kit.pad("sent", [500, 400], "sent", { w: 90, h: 60 })); order.push("sent"); }
    return { drawables, labels: [], anchors: {}, order };`,
} as TemplateDoc).module!;

/** Every part the boundary has drawn, unless a test says otherwise. */
const ALL_DRAWN = ["dot", "gap", "signal", "sent"];

/** The smallest plan whose single boundary shows `visible` (src/render/plan.ts). */
function fakePlan(visible: string[]): Plan {
  return { steps: [], states: [{ ...INITIAL_STATE, visible }], labels: {}, warnings: [], minted: [] } as unknown as Plan;
}

function fakeHandle(visible: string[] = ALL_DRAWN, template = "host_pads") {
  const spec = { template, params: {}, commands: [] } as unknown as RenderHandle["spec"];
  const layout = layoutSpec(spec);
  const calls: string[] = [];
  // previewParams PAINTS: what the host hit-tests afterwards is the patched
  // geometry, exactly as the player's paintedLayout() hands it back.
  let painted: ReturnType<typeof layoutSpec> | null = null;
  const timeline = {
    state: "paused",
    position: 1,
    vars: new Map<string, string>(),
    callbacks: {},
    tones: { beep: (hz: number, ms: number) => (calls.push(`beep ${hz} ${ms}`), ms), play: () => 0, cancel: () => undefined, pause: () => undefined, resume: () => undefined },
    previewParams: (o: Record<string, unknown>) => {
      painted = layoutSpec({ ...spec, params: o } as unknown as RenderHandle["spec"]);
      return calls.push(`preview ${JSON.stringify(o)}`);
    },
    paintedLayout: () => painted,
    glow: async (ids: string[]) => void calls.push(`glow ${ids.join(",")}`),
    tapAt: async () => undefined,
    caption: (t: string | null) => calls.push(`caption ${t}`),
    getParamOverrides: () => ({}),
  };
  const hd = { spec, layout, plan: fakePlan(visible), timeline } as unknown as RenderHandle;
  return { hd, calls, timeline };
}

/** A handle whose module counts what a scene build costs (one layout call). */
let counted = 0;
function countingHandle(visible: string[] = ALL_DRAWN) {
  const name = `host_pads_counted_${++counted}`;
  const base = scenes["host_pads"];
  let builds = 0;
  scenes[name] = { ...base, layout: (p: Record<string, unknown>) => (builds++, base.layout!(p)) };
  const h = fakeHandle(visible, name);
  builds = 0; // the handle's own layoutSpec is not a scene build
  return { ...h, builds: () => builds };
}

describe("widgetHostFor", () => {
  test("null for a template without a widget body", () => {
    const { hd } = fakeHandle();
    (hd.spec as { template: string }).template = "free_body";
    expect(widgetHostFor(hd)).toBeNull();
  });

  test("a click on a part runs the widget and performs the effects in order", () => {
    const { hd, calls } = fakeHandle();
    const host = widgetHostFor(hd)!;
    expect(host.over([300, 400])).toBe(true);
    expect(host.over([900, 700])).toBe(false);
    expect(host.clickAt([300, 400])).toBe(true);
    expect(calls).toEqual(["beep 700 80", 'preview {"signal":"."}', "glow dot"]);
    expect(host.clickAt([300, 400])).toBe(true);
    expect(calls[4]).toBe('preview {"signal":".."}'); // patches accumulate
  });

  test("a click on nothing is not consumed", () => {
    const { hd, calls } = fakeHandle();
    const host = widgetHostFor(hd)!;
    expect(host.clickAt([900, 700])).toBe(false);
    expect(calls).toEqual([]);
  });

  test("answer effects are remembered and published; unknown params are warned, not applied", () => {
    const warn = vi.fn();
    const { hd, calls } = fakeHandle();
    const host = widgetHostFor(hd, { warn })!;
    const seen: string[] = [];
    host.onAnswer((v) => seen.push(v));
    host.clickAt([300, 400]);
    host.clickAt([500, 400]);
    expect(host.lastAnswer()).toBe(".");
    expect(seen).toEqual(["."]);
    expect(calls).toContain("caption sent");
    expect(calls.filter((c) => c.includes("nope"))).toEqual([]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('"nope" is not a template param'));
  });

  // F1: the scene is the boundary's, not the whole layout's. A pad the
  // storyboard has not drawn yet is not there to click — and the click must
  // fall THROUGH (false), or blank paper where a pad will later stand would
  // swallow the resume.
  test("a part the boundary has not drawn is neither hoverable nor clickable", () => {
    const { hd, calls } = fakeHandle(["dot", "signal"]);
    const host = widgetHostFor(hd)!;
    expect(host.over([500, 400])).toBe(false);
    expect(host.clickAt([500, 400])).toBe(false);
    expect(calls).toEqual([]);
    expect(host.over([300, 400])).toBe(true);
    expect(host.clickAt([300, 400])).toBe(true);
  });

  // …but a part the widget's OWN patch mints counts as drawn from that moment,
  // exactly as previewParams({revealNew: true}) reveals it on screen.
  test("a part the widget's own patch reveals becomes clickable", () => {
    const { hd } = fakeHandle(["dot"], "host_reveal");
    const host = widgetHostFor(hd)!;
    expect(host.over([500, 400])).toBe(false); // the send pad is not drawn yet
    expect(host.clickAt([300, 400])).toBe(true); // …the dot patches signal…
    expect(host.over([500, 400])).toBe(true); // …and now it is on screen
  });

  // F2: hover asks this question on every pointermove. Building the scene per
  // move ran the template's layout body each time.
  test("two looks in a row build the scene once", () => {
    const { hd, builds } = countingHandle();
    const host = widgetHostFor(hd)!;
    host.over([300, 400]);
    host.over([310, 400]);
    host.over([900, 700]);
    expect(builds()).toBe(1);
    host.clickAt([300, 400]); // a patch changes the params — and the scene
    const after = builds();
    expect(after).toBeGreaterThan(1);
    host.over([300, 400]);
    host.over([310, 400]);
    expect(builds()).toBe(after + 1);
    host.reset(); // …and reset drops the memo with everything else
    host.over([300, 400]);
    expect(builds()).toBe(after + 2);
  });

  test("keyPress delivers a key event to the body — mounting it if needed — and ignores undeclared keys", () => {
    const { hd, calls } = fakeHandle();
    const host = widgetHostFor(hd)!;
    expect(host.keyPress("x", 50)).toBe(false);
    expect(calls).toEqual([]);
    expect(host.keyPress(" ", 80)).toBe(true);
    expect(calls).toEqual(["beep 700 80", 'preview {"signal":"."}', "glow dot"]);
  });

  test("reset forgets state, patches and the caption", () => {
    const { hd, calls } = fakeHandle();
    const host = widgetHostFor(hd)!;
    host.clickAt([300, 400]);
    host.clickAt([500, 400]);
    host.reset();
    expect(host.lastAnswer()).toBeNull();
    expect(calls.at(-1)).toBe("caption null");
    host.clickAt([300, 400]);
    expect(calls.at(-2)).toBe('preview {"signal":"."}'); // state started over
  });
});

// One pointer gesture, read at release (spec §2.2 addendum 2026-09-15b): the
// core is DOM-free, so the tests press, move and release it themselves and
// hand it a fake `nudge` — the ghost the renderer would paint.
describe("widgetHostFor — the gesture", () => {
  test("a press and release in place is a click", () => {
    const { hd, calls } = fakeHandle();
    const host = widgetHostFor(hd, { nudge: (id, dx, dy) => calls.push(`nudge ${id} ${dx} ${dy}`) })!;
    expect(host.press([300, 400])).toBe(true);
    host.move([302, 401]); // under DRAG_MIN: no ghost
    expect(host.release([302, 401])).toBe("click");
    expect(calls).toEqual(["beep 700 80", 'preview {"signal":"."}', "glow dot"]);
  });

  test("a press that moves is a ghost, then a drag on release — ghost cleared first", () => {
    const { hd, calls } = fakeHandle();
    const host = widgetHostFor(hd, { nudge: (id, dx, dy) => calls.push(`nudge ${id} ${dx} ${dy}`) })!;
    host.press([300, 400]);
    host.move([340, 410]);
    host.move([500, 400]);
    expect(host.release([500, 400])).toBe("drag");
    expect(calls).toEqual(["nudge dot 40 10", "nudge dot 200 0", "nudge dot 0 0", "caption dot>gap"]);
  });

  test("released on blank paper: to is null; cancel clears the ghost and delivers nothing", () => {
    const { hd, calls } = fakeHandle();
    const host = widgetHostFor(hd, { nudge: (id, dx, dy) => calls.push(`nudge ${id} ${dx} ${dy}`) })!;
    host.press([300, 400]);
    host.move([900, 700]);
    expect(host.release([900, 700])).toBe("drag");
    expect(calls.at(-1)).toBe("caption dot>null");
    calls.length = 0;
    host.press([300, 400]);
    host.move([400, 400]);
    host.cancel();
    expect(calls).toEqual(["nudge dot 100 0", "nudge dot 0 0"]);
    expect(host.release([400, 400])).toBeNull(); // nothing pressed
  });

  test("a second press while a gesture is live is refused — the first ghost is never stranded", () => {
    const { hd, calls } = fakeHandle();
    const host = widgetHostFor(hd, { nudge: (id, dx, dy) => calls.push(`nudge ${id} ${dx} ${dy}`) })!;
    expect(host.press([300, 400])).toBe(true);
    host.move([400, 400]);
    expect(host.press([500, 400])).toBe(false); // a second finger on the gap pad
    expect(host.release([500, 400])).toBe("drag"); // still the FIRST gesture
    expect(calls).toEqual(["nudge dot 100 0", "nudge dot 0 0", "caption dot>gap"]);
  });

  test("a press on nothing begins no gesture", () => {
    const { hd, calls } = fakeHandle();
    const host = widgetHostFor(hd)!;
    expect(host.press([900, 700])).toBe(false);
    expect(host.release([900, 700])).toBeNull();
    expect(calls).toEqual([]);
  });

  // The stage's cursor reads this ALONE to swap a grab for a grabbing hand
  // (widget-host.test.ts's "cursor affordances" group pins that it does) —
  // so every edge DRAG_MIN decides at release must show up here too.
  test("dragging() is false at rest, false under DRAG_MIN, true past it, and false again after release or cancel", () => {
    const { hd } = fakeHandle();
    const host = widgetHostFor(hd, { nudge: () => undefined })!;
    expect(host.dragging()).toBe(false); // nothing pressed
    expect(host.press([300, 400])).toBe(true);
    expect(host.dragging()).toBe(false); // pressed, not yet moved
    host.move([302, 401]); // under DRAG_MIN
    expect(host.dragging()).toBe(false);
    host.move([340, 410]); // past DRAG_MIN
    expect(host.dragging()).toBe(true);
    host.release([340, 410]);
    expect(host.dragging()).toBe(false); // released
    host.press([300, 400]);
    host.move([340, 410]);
    expect(host.dragging()).toBe(true);
    host.cancel();
    expect(host.dragging()).toBe(false); // cancelled
  });
});

// The stage's press guard, as a truth table rather than a source pin. It was
// a pin on the words `hd.timeline.state === "playing"` — which is exactly the
// clause that made EVERY widget ask dead to the pointer: during an ask the
// player stays in state "playing" (the gate is awaited inside the play loop),
// so the guard refused every press under the widget's own gate, and the pin
// certified the bug. Six flags, one function, every clause inverted below.
describe("pressBlocked — whose press is it", () => {
  const NONE = { playing: false, ownGate: false, foreignGate: false, onControl: false, onCaption: false, onCard: false };
  const f = (o: Partial<typeof NONE>): boolean => pressBlocked({ ...NONE, ...o });

  test("paused, on the paper: the press is the widget's", () => {
    expect(f({})).toBe(false);
  });
  test("playing with no gate up: the press is the movie's (it pauses)", () => {
    expect(f({ playing: true })).toBe(true);
  });
  // The regression this whole predicate exists for.
  test("playing UNDER THE WIDGET'S OWN GATE: the press is the widget's — an ask never leaves the play loop", () => {
    expect(f({ playing: true, ownGate: true })).toBe(false);
  });
  test("the widget's own gate while paused: still the widget's", () => {
    expect(f({ ownGate: true })).toBe(false);
  });
  test("any other gate holds the run: its card is the door, not the figure", () => {
    expect(f({ foreignGate: true })).toBe(true);
    expect(f({ playing: true, foreignGate: true })).toBe(true);
  });
  test("a press on a control is that control's — even under the widget's own gate (the Skip pill lives inside it)", () => {
    expect(f({ onControl: true })).toBe(true);
    expect(f({ onControl: true, ownGate: true })).toBe(true);
  });
  test("the caption band and an open info card own their own presses", () => {
    expect(f({ onCaption: true })).toBe(true);
    expect(f({ onCard: true })).toBe(true);
    expect(f({ onCaption: true, ownGate: true })).toBe(true);
    expect(f({ onCard: true, ownGate: true })).toBe(true);
  });
});

describe("attachWidgetHost — source pins", () => {
  const src = readFileSync("src/ui/widget-host.ts", "utf8");
  const controls = readFileSync("src/ui/controls.ts", "utf8");
  const infocard = readFileSync("src/ui/infocard.ts", "utf8");
  test("the stage reads ONE pointer gesture in the capture phase, and no longer hit-tests clicks", () => {
    for (const type of ["pointerdown", "pointermove", "pointerup", "pointercancel"]) {
      expect(src).toContain(`stage.addEventListener("${type}"`);
    }
    const attach = src.slice(src.indexOf("export function attachWidgetHost"), src.indexOf("export function widgetGateFor"));
    // The click listener keeps ONE job (below): the hit test moved to press().
    expect(attach).not.toContain("host.clickAt");
    expect(attach).toContain("host.press(p)");
    expect(attach).toContain("host.release(p)");
    expect(attach).toContain("host.cancel()");
    expect(attach).toContain("e.stopPropagation()");
  });
  // The guard's LOGIC is the truth table above; what the stage owes it is the
  // six flags, read off the real DOM. Each one is pinned here because a flag
  // wired to the wrong query would pass every unit test.
  test("the stage reads the six flags off the DOM and asks pressBlocked", () => {
    const guard = src.slice(src.indexOf("const blocked = (e: Event): boolean =>"), src.indexOf('stage.addEventListener("pointerdown"'));
    expect(guard).toContain("return pressBlocked({");
    expect(guard).toContain('playing: hd.timeline.state === "playing"');
    // The widget's own gate is ONE definition, shared with the key listeners.
    expect(src).toContain('const ownGate = (): boolean => stage.querySelector(".cs-widgetgate") !== null;');
    expect(guard).toContain("ownGate: own");
    expect(guard).toContain("foreignGate: gateIsOpen(stage) && !own");
    // Every live control surface, not just "button": the same list the stage's
    // own play/pause toggle uses (src/ui/gates.ts), so the two cannot drift —
    // a press that began on a slider or the param tray is never a part's.
    expect(guard).toContain("onControl: t !== null && t.closest(CONTROL_SELECTOR) !== null");
    expect(src).toContain('import { CONTROL_SELECTOR, gateIsOpen } from "./gates";');
    // The subtitle band lies across the bottom of the canvas and an open info
    // card floats over the figure: a press on either is that thing's.
    expect(guard).toContain("onCaption: overCaption(e.target as Element | null)");
    expect(guard).toContain('onCard: t !== null && t.closest(".cs-infocard") !== null');
  });
  // A right-click over a part ran the widget (and a context menu on top of
  // it); a second finger, or the right button pressed mid-drag, would also
  // have disarmed the swallow the live press armed. Nothing but the primary
  // button of the primary pointer begins — or disturbs — a gesture.
  test("only the primary button of the primary pointer is a gesture, checked before anything else", () => {
    expect(src).toMatch(/stage\.addEventListener\("pointerdown", \(e\) => \{[\s\S]{0,320}?if \(!e\.isPrimary \|\| \(e\.pointerType === "mouse" && e\.button !== 0\)\) return;\s*swallowClick = false;[\s\S]{0,140}?if \(blocked\(e\)\) return;/);
  });
  test("the press takes touch-action and pointer capture, and hands both back at the end", () => {
    expect(src).toContain('stage.style.touchAction = "none"');
    // The figure's OWN inline value comes back (a piano stage sets "none" for
    // the whole mount) — never a blanket "".
    expect(src).toContain("priorTouchAction = stage.style.touchAction");
    expect(src).toContain("stage.style.touchAction = priorTouchAction");
    expect(src).not.toContain('stage.style.touchAction = ""');
    expect(src).toMatch(/try \{\s*stage\.setPointerCapture\(e\.pointerId\);\s*\} catch/);
    expect(src).toMatch(/try \{\s*stage\.releasePointerCapture\(e\.pointerId\);\s*\} catch/);
  });
  test("one pointer owns the gesture: the others' moves, ups and cancels are not it", () => {
    const attach = src.slice(src.indexOf("export function attachWidgetHost"), src.indexOf("export function widgetGateFor"));
    expect(attach).toContain("let activeId: number | null = null;");
    expect(attach).toContain("activeId = e.pointerId;");
    expect(attach).toMatch(/if \(e\.pointerId !== activeId\) return;/);
  });
  test("a release on a control (the gate's Skip pill) cancels the gesture instead of delivering it", () => {
    const end = src.slice(src.indexOf("const end = (e: PointerEvent"), src.indexOf('stage.addEventListener("pointerup"'));
    // With the pointer captured every event retargets to the stage, so the
    // event's own target cannot tell a drop on Skip from one on the paper.
    expect(end).toContain("document.elementFromPoint(e.clientX, e.clientY)");
    expect(end).toContain('closest("button")');
    expect(end).toContain("host.cancel()");
  });
  test("capture lost mid-gesture drops the ghost and disarms the swallow — and the ordinary release is untouched", () => {
    const lost = src.slice(src.indexOf('stage.addEventListener("lostpointercapture"'));
    expect(lost).toContain("if (e.pointerId !== activeId) return;");
    expect(lost).toContain("swallowClick = false;");
    expect(lost).toContain("host.cancel();");
  });
  test("pointermove costs nothing at rest — no measuring without a gesture, and it never asks over()", () => {
    const move = src.slice(src.indexOf('stage.addEventListener("pointermove"'), src.indexOf("const end = (e: PointerEvent"));
    // logicalPoint reads the svg's bounding box: without this guard every
    // pointer move over a paused figure paid for a layout read.
    expect(move).toMatch(/if \(e\.pointerId !== activeId\) return;[\s\S]*logicalPoint\(stage, e\)/);
    expect(move).toContain("host.move(p)");
    expect(move).not.toContain("host.over");
  });
  test("a cancelled pointer disarms the swallow — no click follows it, and the next one is not the widget's", () => {
    const end = src.slice(src.indexOf("const end = (e: PointerEvent"), src.indexOf('stage.addEventListener("pointerup"'));
    expect(end).toMatch(/if \(cancelled\) \{[\s\S]*swallowClick = false;[\s\S]*host\.cancel\(\);/);
  });
  test("the synthesized click after a press that began on a part is swallowed (the piano's rule)", () => {
    const listener = src.slice(src.indexOf('stage.addEventListener("click"'), src.indexOf("// Playback, a scrub or a step lands honest geometry"));
    expect(listener).toContain("if (swallowClick) {");
    expect(listener).toContain("swallowClick = false;");
    expect(listener).toContain("e.stopPropagation();");
    expect(listener).toContain("e.preventDefault();");
  });
  test("DRAG_MIN is six logical units, decided at release", () => {
    expect(src).toContain("export const DRAG_MIN = 6;");
  });
  // ONE owner. The gate used to route the gesture itself, but the stage's
  // capture-phase listeners run FIRST on the same events (the gate is a child
  // of the stage), so the two raced: the release was delivered twice over and
  // a drop on Skip both answered the question and skipped it. The gate now
  // carries nothing but its hint and its Skip pill; the stage's own listeners
  // stand under the widget's gate instead of standing aside.
  test("the widget gate routes no gestures of its own — the stage is the one owner", () => {
    const gate = src.slice(src.indexOf("export function widgetGateFor"));
    expect(gate).not.toContain("host.clickAt");
    expect(gate).not.toContain("host.press");
    expect(gate).not.toContain("host.move");
    expect(gate).not.toContain("host.release");
    expect(gate).not.toContain('gate.addEventListener("pointer');
    // What it keeps: the hint, Skip, and the answer subscription.
    expect(gate).toContain("cs-figgate-skip");
    expect(gate).toContain("host.onAnswer(");
  });

  // The key listeners (spec §2.2 addendum): the piano's free-play pattern —
  // installed only for a body that asked for keys, self-cleaning, swallowing
  // the key it owns, standing aside while playing, typing or another gate.
  test("window key listeners are installed only when the body declares keys", () => {
    expect(src).toMatch(/if \(host\.keys\.length > 0\) \{/);
    expect(src).toContain('window.addEventListener("keydown", onKeyDown)');
    expect(src).toContain('window.addEventListener("keyup", onKeyUp)');
  });
  test("the listeners self-clean, ignore auto-repeat and swallow a declared key", () => {
    expect(src).toContain("if (!stage.isConnected)");
    expect(src).toContain('window.removeEventListener("keydown", onKeyDown)');
    expect(src).toContain('window.removeEventListener("keyup", onKeyUp)');
    expect(src).toMatch(/if \(e\.repeat\) return;/);
    const down = src.slice(src.indexOf("const onKeyDown"), src.indexOf("const onKeyUp"));
    expect(down).toContain("e.preventDefault()");
    // NOT stopPropagation: this listener is on window, already last in the
    // bubble phase, so calling it would stop nothing (unlike the capture-
    // phase click listener above, which really does own something to stop).
    expect(down).not.toContain("e.stopPropagation()");
  });
  // Both key listeners drop the SAME stage the way onKeyDown always has —
  // onKeyUp used to skip the check, so a key released after the stage left
  // the DOM (an item that has moved on) still tried to deliver it.
  test("onKeyUp carries the same isConnected guard as onKeyDown", () => {
    const up = src.slice(src.indexOf("const onKeyUp"), src.indexOf('window.addEventListener("keydown"'));
    expect(up).toContain("if (!stage.isConnected)");
  });
  test("typing in an input, textarea or contenteditable is never captured", () => {
    expect(src).toContain("t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || (t instanceof HTMLElement && t.isContentEditable)");
  });
  test("keys stand aside while playing and while another gate is open — the widget's own gate excepted", () => {
    expect(src).toContain('(hd.timeline.state === "playing" && !ownGate())');
    expect(src).toContain("(gateIsOpen(stage) && !ownGate())");
  });
  test("the widget gate marks itself, so its own keys keep working", () => {
    expect(src).toContain('h("div", { class: "cs-figgate cs-widgetgate" }');
  });
  // …and UNMARKS itself the instant it settles. The mark lingers 900 ms
  // (CARD_LINGER_MS) before the gate leaves the DOM, and for that whole
  // window the question is over — but the gate was still wearing the class
  // that says "this figure's gestures are the point", so a press went on
  // reaching the body after the answer had been judged. Dropping just the
  // marker (cs-figgate stays, so gateIsOpen still holds) makes the linger
  // read as any other gate: blocked, by the very same flag.
  test("the gate drops its widget marker the moment it settles, before the mark lingers", () => {
    const gate = src.slice(src.indexOf("export function widgetGateFor"));
    expect(gate).toContain('gate.classList.remove("cs-widgetgate");');
    expect(gate.indexOf('gate.classList.remove("cs-widgetgate");')).toBeLessThan(gate.indexOf("window.setTimeout(() => gate.remove(), CARD_LINGER_MS)"));
  });
  // I1: Skip lives INSIDE the widget's own gate (cs-widgetgate), so the
  // "another gate" exception above never stands aside for it — without this,
  // a keyboard could never reach Skip at all.
  test("a key that lands on the gate's own Skip pill or a card gate's pill is the control's, never the widget's", () => {
    expect(src).toContain('e.target.closest(".cs-figgate-skip, .cs-cardgate-pill") !== null');
  });

  test("resets on play, on a step boundary and chains the callbacks", () => {
    expect(src).toContain("const prevOnState = hd.timeline.callbacks.onState");
    expect(src).toContain("const prevOnStep = hd.timeline.callbacks.onStep");
    expect(src).toMatch(/if \(s === "playing"\) host\.reset\(\)/);
  });
  test("controls' own callbacks chain the handlers the add-ons hung on first — a wholesale replacement would kill every reset above it", () => {
    const at = controls.indexOf("hd.timeline.callbacks = {");
    expect(at).toBeGreaterThan(-1);
    const after = controls.slice(at);
    expect(after).toContain("prev.onState?.(s)");
    expect(after).toContain("prev.onStep?.(");
    // ...and the handler it chains to is the object that stood there before.
    expect(controls.slice(0, at)).toContain("const prev = hd.timeline.callbacks;");
  });
  test("the cursor class marks parts while paused — the one toggle lives in the info card, and consults the widget host", () => {
    expect(src).not.toContain('stage.classList.toggle("cs-cardable"');
    expect(infocard).toContain('stage.classList.toggle("cs-cardable"');
    expect(infocard).toContain("widgetHost !== null && p !== null && widgetHost.over(p)");
  });
  test("controls attaches it beside the chess free play, before the info cards", () => {
    const a = controls.indexOf("attachWidgetHost(stage, hd)");
    const b = controls.indexOf("attachInfoCards(stage, hd, widgetHost)");
    expect(a).toBeGreaterThan(-1);
    expect(a).toBeLessThan(b);
  });
  // The clause is now "playing AND not under the widget's own gate" — an ask
  // never leaves state "playing" (pressBlocked's own regression above), so
  // without the `own` escape the hand could never show while a question on
  // the widget's own figure was standing, over() cost included.
  test("the hover class asks the widget while paused OR under the widget's own gate — over() builds a scene, and the plain movie must not pay for it on every pointer move", () => {
    expect(infocard).toContain('const own = stage.querySelector(".cs-widgetgate") !== null;');
    expect(infocard).toContain('const on = (hd.timeline.state !== "playing" || own) && (targetAt(e) !== null || overWidget(e));');
  });
  test("the info card stands aside for widget parts", () => {
    expect(infocard).toMatch(/widgetHost\?\.over\(p\)\) return null/);
  });

  // cursor affordances: a grab while a part is held, a grabbing hand once
  // the gesture crosses DRAG_MIN — the widget host's own classes (cs-cardable
  // stays infocard.ts's, per the two tests above).
  describe("cursor affordances", () => {
    test("cs-grabbable goes on the moment press() succeeds", () => {
      const down = src.slice(src.indexOf('stage.addEventListener("pointerdown"'), src.indexOf('stage.addEventListener("pointermove"'));
      expect(down).toMatch(/if \(!p \|\| !host\.press\(p\)\) return;[\s\S]*stage\.classList\.add\("cs-grabbable"\);/);
    });
    test("pointermove swaps grabbable for grabbing, reading host.dragging() alone", () => {
      const move = src.slice(src.indexOf('stage.addEventListener("pointermove"'), src.indexOf("const end = (e: PointerEvent"));
      expect(move).toContain("host.dragging()");
      expect(move).toContain('stage.classList.replace("cs-grabbable", "cs-grabbing")');
    });
    test("end() drops both classes, on the normal release and the cancelled path alike", () => {
      const end = src.slice(src.indexOf("const end = (e: PointerEvent"), src.indexOf('stage.addEventListener("pointerup"'));
      // Placed before the `if (cancelled)` branch: both paths run it.
      expect(end.indexOf('stage.classList.remove("cs-grabbable", "cs-grabbing")')).toBeLessThan(end.indexOf("if (cancelled)"));
    });
    test("a lost pointer capture — the path that never reaches end() — clears both classes too", () => {
      const lost = src.slice(src.indexOf('stage.addEventListener("lostpointercapture"'));
      expect(lost).toContain('stage.classList.remove("cs-grabbable", "cs-grabbing")');
    });
    test("dragging() is on the WidgetHost interface", () => {
      expect(src).toMatch(/dragging\(\):\s*boolean;/);
    });
  });
});
