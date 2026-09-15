# Widget Bodies Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A template document gains an optional `widget: |` body — a pure JS function body returning `{init, on, demo?, judge?}` — so a paused click on the template's parts runs the widget, whose returned effects (patch params, sound, glow, pointer, caption, answer) the host performs; `ask.widget` may name the spec's template so the widget's answer is judged, and the movie performs the widget's `demo`.

**Architecture:** The widget body is compiled once by `compileTemplateDoc` into a factory on `SceneModule.widget`. Three pure modules do the work without a DOM: `widget-scene.ts` (the scene object: parts, boxes, rings, mappings), `widget-effects.ts` (effect validation), `widget-run.ts` (step a body, run a click sequence, run a demo — the node harness). One DOM module, `src/ui/widget-host.ts`, routes paused stage clicks to `stepWidget` and performs effects through three new public `Player` methods, `previewParams`, and a new `ToneLike.beep`. The ask binding rides the existing gate contract (a gate resolves a string) and the player's existing widget-ask branch, which now calls a `widgetDemo` hook set in `render/index.ts`.

**Tech Stack:** TypeScript (strict, `erasableSyntaxOnly`), vitest in plain node (no jsdom — pure modules, source pins, the local `El` fake), js-yaml template documents, the existing tray/preview machinery untouched.

**Spec:** `docs/superpowers/specs/2026-09-14-widget-bodies-design.md`

## Global Constraints

- A widget never draws and never touches the DOM, timers or the player: it returns effects; the host performs them. A body that throws is contained (logged, state unchanged).
- A widget changes the figure only through `patch` → `Player.previewParams`; unknown params are dropped with a console warning.
- Nothing persists: state and patches reset on play, step boundary, scrub and Continue. `ask.store` stays the only persistence channel.
- The widget's parts are the top-level ids of the template layout's `order` at the current params (a group is one part).
- Events in v1: `click` only. Effects in v1: `patch`, `sound`, `glow`, `pointer`, `caption`, `answer`.
- `AskArgs.widget` is a `string`: one of the six built-in names or `spec.template`. Schema stays anyOf-free.
- Every prompt/schema change re-pins BOTH constants in `tests/prompt-size.test.ts` with a dated note.
- `KIT_VERSION` → 10; both version pins updated in the same commit.
- Do not touch `src/ui/tray.ts`, `src/ui/tray-model.ts`, `src/layout/code.ts` or the code element (the pane-controls round owns them). Shared files (`types.ts`, `schema.ts`, `lint.ts`, `compiler-v1.md`, `prompt-size.test.ts`, `examples.json`, `ROADMAP.md`, `help.html`) get small localized edits only.
- Run `npm test` and `npx tsc --noEmit` before each commit that touches `src/`. Netlify runs `npm test && npm run build`.
- Work in the worktree `/Users/hom/Documents/GitHub/drawcast/.claude/worktrees/widgets` on branch `worktree-widgets`. Commit messages end with the session's attribution lines (copy from the branch's last commit, `git log -1 --format=%B`).

---

### Task 1: The `widget` body on a template document — validate, compile, manifest

**Files:**
- Create: `src/scenes/widget-types.ts`
- Modify: `src/scenes/types.ts` (SceneManifest, SceneModule)
- Modify: `src/scenes/doc.ts` (TemplateDoc, validateTemplateDoc, docToManifest)
- Modify: `src/scenes/compile.ts` (compileTemplateDoc)
- Test: `tests/widget-doc.test.ts`

**Interfaces:**
- Produces: `WidgetBody`, `WidgetEvent`, `WidgetScene` (types, `src/scenes/widget-types.ts`); `TemplateDoc.widget?: string`; `SceneManifest.widget?: true`; `SceneModule.widget?: () => WidgetBody`.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/widget-doc.test.ts
import { describe, expect, test } from "vitest";
import { validateTemplateDoc, docToManifest, type TemplateDoc } from "../src/scenes/doc";
import { compileTemplateDoc } from "../src/scenes/compile";

const base = {
  template: "tap_pad",
  version: 1,
  kit: 9,
  status: "ready",
  description: "A pad to tap.",
  params: { type: "object", properties: { count: { type: "integer" } } },
  element_ids: { pad: "the pad" },
  examples: [{ request: "A pad", params: {} }],
  layout: `const drawables = [kit.stroke("pad", [[0,0],[10,0],[10,10],[0,10]], { closed: true })];
    return { drawables, labels: [], anchors: {}, order: ["pad"] };`,
};

const WIDGET = `
  const init = () => ({ n: 0 });
  const on = (ev, st) => ev.id === "pad" ? { state: { n: st.n + 1 }, effects: [{ patch: { count: st.n + 1 } }] } : { state: st, effects: [] };
  return { init, on };
`;

describe("widget body — document", () => {
  test("a widget body is accepted and reaches the manifest", () => {
    const v = validateTemplateDoc({ ...base, widget: WIDGET });
    expect(v.errors).toEqual([]);
    expect(docToManifest(v.doc!).widget).toBe(true);
    expect(docToManifest(validateTemplateDoc(base).doc!).widget).toBeUndefined();
  });

  test("a non-string widget is rejected", () => {
    const v = validateTemplateDoc({ ...base, widget: 42 });
    expect(v.errors.some((e) => /widget must be a string/.test(e))).toBe(true);
  });

  test("compile turns the body into a factory of fresh bodies", () => {
    const { module, errors } = compileTemplateDoc({ ...base, widget: WIDGET } as TemplateDoc);
    expect(errors).toEqual([]);
    expect(typeof module!.widget).toBe("function");
    const a = module!.widget!();
    const b = module!.widget!();
    expect(a).not.toBe(b);
    expect(typeof a.init).toBe("function");
    expect(typeof a.on).toBe("function");
  });

  test("a body without init or on is a document error", () => {
    const { module, errors } = compileTemplateDoc({ ...base, widget: "return { init: () => 0 };" } as TemplateDoc);
    expect(module).toBeUndefined();
    expect(errors[0]).toMatch(/widget body must return \{ init, on \}/);
  });

  test("a body that does not parse is a document error", () => {
    const { module, errors } = compileTemplateDoc({ ...base, widget: "return {" } as TemplateDoc);
    expect(module).toBeUndefined();
    expect(errors[0]).toMatch(/widget body failed to compile/);
  });

  test("a stub document keeps no widget", () => {
    const { module } = compileTemplateDoc({ ...base, status: "stub", layout: undefined, widget: WIDGET } as TemplateDoc);
    expect(module!.widget).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/widget-doc.test.ts`
Expected: FAIL (`widget` unknown on the manifest; compile ignores it).

- [ ] **Step 3: The types**

`src/scenes/widget-types.ts` (new):

```ts
// The widget contract (spec 2026-09-14-widget-bodies-design §2.2): a pure
// function of (event, state, scene) → (state, effects). The host performs
// effects; the body never sees the DOM, timers or the player.
import type { BBox } from "../layout/geometry";
import type { Pt } from "../layout/model";

export interface WidgetEvent {
  type: "click";
  /** The part hit (a top-level id of the template layout). */
  id: string;
  /** Logical, y-up. */
  point: Pt;
  /** Spec-domain units when the spec declares a domain, else null. */
  domain: Pt | null;
}

export interface WidgetScene {
  /** The widget's parts: the template layout's top-level ids at these params. */
  ids: string[];
  boxes: Map<string, BBox>;
  rings: Map<string, Pt[][]>;
  /** Template params as painted, the widget's own patches included. */
  params: Record<string, unknown>;
  vars: Record<string, string>;
  toDomain(p: Pt): Pt | null;
  toLogical(p: Pt): Pt;
}

/** What a compiled widget body returns. `effects` is validated by the host
 *  (widget-effects.ts) — a body may return anything, nothing escapes. */
export interface WidgetBody {
  init(scene: WidgetScene): unknown;
  on(event: WidgetEvent, state: unknown, scene: WidgetScene): { state: unknown; effects: unknown };
  demo?(scene: WidgetScene, answer: string): unknown;
  judge?(given: string, answer: string): boolean;
}
```

In `src/scenes/types.ts`, add the import and two fields:

```ts
import type { WidgetBody } from "./widget-types";
// … in SceneManifest, after `explore?`:
  /** True when the document carries a widget body: the figure is playable while paused. */
  widget?: true;
// … in SceneModule:
  /** A fresh widget body per mount (the doc's `widget` function body, compiled once). */
  widget?: () => WidgetBody;
```

- [ ] **Step 4: The document**

In `src/scenes/doc.ts` `TemplateDoc`, after `layout?`:

```ts
  /** JS function body: (kit) => { init, on, demo?, judge? } — the widget
   *  contract (widget-types.ts). Optional; a document with one is playable
   *  while paused by that fact alone. */
  widget?: string;
```

In `validateTemplateDoc`, next to the `layout` check:

```ts
  if (d.widget !== undefined && typeof d.widget !== "string") {
    errors.push("widget must be a string (a JavaScript function body returning { init, on })");
  }
```

In `docToManifest`, after the `explore` spread:

```ts
    ...(typeof doc.widget === "string" && doc.widget.trim() !== "" ? { widget: true as const } : {}),
```

- [ ] **Step 5: Compile**

In `src/scenes/compile.ts`, `compileTemplateDoc`, after `layout` is built and before the `return`:

```ts
  let widget: (() => WidgetBody) | undefined;
  if (typeof doc.widget === "string" && doc.widget.trim() !== "") {
    let wfn: (kit: unknown) => unknown;
    try {
      wfn = new Function("kit", `"use strict";\n${doc.widget}`) as typeof wfn;
    } catch (err) {
      return { errors: [`template "${doc.template}" widget body failed to compile: ${(err as Error).message}`] };
    }
    let probe: unknown;
    try {
      probe = wfn(kit);
    } catch (err) {
      return { errors: [`template "${doc.template}" widget body threw on load: ${(err as Error).message}`] };
    }
    const p = probe as { init?: unknown; on?: unknown } | null;
    if (typeof p !== "object" || p === null || typeof p.init !== "function" || typeof p.on !== "function") {
      return { errors: [`template "${doc.template}" widget body must return { init, on } (demo and judge optional)`] };
    }
    widget = () => wfn(kit) as WidgetBody;
  }
  return { module: { manifest: docToManifest(doc), layout, ...(widget ? { widget } : {}) }, errors: [] };
```

Add `import type { WidgetBody } from "./widget-types";`. The stub early-return at the top of the function is untouched, so a stub never carries a widget.

- [ ] **Step 6: Run the tests**

Run: `npx vitest run tests/widget-doc.test.ts && npx tsc --noEmit`
Expected: PASS, tsc clean.

- [ ] **Step 7: Commit**

```bash
git add src/scenes/widget-types.ts src/scenes/types.ts src/scenes/doc.ts src/scenes/compile.ts tests/widget-doc.test.ts
git commit -m "Widget bodies: the widget body on a template document — validated, compiled once into a factory, flagged on the manifest (Task 1)"
```

---

### Task 2: Kit primitives — `circle`, `rect`, `pad`, `MORSE`; `inverseDomainMapping` exported

**Files:**
- Modify: `src/scenes/kit.ts` (SceneKit interface ~line 232–300; the `kit` object ~line 564+; `KIT_VERSION` line 43)
- Modify: `src/layout/layout.ts:346` (`inverseDomainMapping` → exported)
- Test: `tests/scene-kit.test.ts` (extend; re-pin line ~165), `tests/kit-smooth-closed.test.ts:43` (re-pin)

**Interfaces:**
- Produces: `kit.circle(c: Pt, r: number, n?: number): Pt[]`; `kit.rect(x: number, y: number, w: number, h: number): Pt[]`; `kit.pad(id: string, at: Pt, label: string, size: { r: number } | { w: number; h: number }, o?: { fontSize?: number; fill?: string; color?: string }): GroupDrawable` (children `<id>__shape` closed stroke, `<id>__label` text); `kit.MORSE: Readonly<Record<string, string>>`; `export function inverseDomainMapping(domain: Spec["domain"]): (p: Pt) => Pt`.

- [ ] **Step 1: Write the failing tests** (append to `tests/scene-kit.test.ts`)

```ts
import { elementRings } from "../src/layout/layout";

describe("kit v10: circle, rect, pad, MORSE", () => {
  test("circle and rect return closed point rings in y-up logical units", () => {
    const c = kit.circle([100, 100], 10, 4);
    expect(c).toHaveLength(4);
    expect(c[0][0]).toBeCloseTo(110);
    const r = kit.rect(10, 20, 30, 40);
    expect(r).toEqual([[10, 20], [40, 20], [40, 60], [10, 60]]);
  });

  test("pad is a group: a closed paper-filled shape plus a centred label", () => {
    const p = kit.pad("key_dot", [300, 420], "·", { r: 40 });
    expect(p.kind).toBe("group");
    expect(p.id).toBe("key_dot");
    const [shape, label] = p.children;
    expect(shape.id).toBe("key_dot__shape");
    expect(shape.kind).toBe("stroke");
    expect((shape as { closed?: boolean }).closed).toBe(true);
    expect(shape.style.fill).toBe(kit.GROUND);
    expect(label.id).toBe("key_dot__label");
    expect(label.kind).toBe("text");
    expect((label as { pos: Pt }).pos).toEqual([300, 420]);
    const rect = kit.pad("gap", [540, 420], "gap", { w: 90, h: 60 });
    expect((rect.children[0] as { pts: Pt[] }).pts).toHaveLength(4);
  });

  test("a pad's outline is what elementRings hit-tests", () => {
    const p = kit.pad("key_dot", [300, 420], "·", { r: 40 });
    const rings = elementRings({ drawables: [p], order: ["key_dot"] });
    expect(rings.get("key_dot")).toHaveLength(1);
  });

  test("MORSE covers the letters and digits", () => {
    expect(kit.MORSE.S).toBe("...");
    expect(kit.MORSE.O).toBe("---");
    expect(kit.MORSE["1"]).toBe(".----");
    expect(Object.keys(kit.MORSE)).toHaveLength(36);
    expect(Object.isFrozen(kit.MORSE)).toBe(true);
  });
});
```

Change both version pins: in `tests/scene-kit.test.ts` the test title `"KIT_VERSION is 9 …"` → `"KIT_VERSION is 10 …"` with `expect(KIT_VERSION).toBe(10)`, and in `tests/kit-smooth-closed.test.ts:43` `expect(KIT_VERSION).toBe(10)`.

- [ ] **Step 2: Run the tests**

Run: `npx vitest run tests/scene-kit.test.ts tests/kit-smooth-closed.test.ts`
Expected: FAIL (no `circle`, version 9).

- [ ] **Step 3: Implement**

`src/scenes/kit.ts` line 43:

```ts
export const KIT_VERSION = 10; // v10: circle()/rect() point rings, pad() — a tappable labelled shape for widgets, MORSE table (widget bodies); v9: ball() — a shaded 2D disc (space); v8: smoothClosed() + roughness on stroke/area (anatomy); v7: GROUND (the figure's paper); v6: softAlpha() (race crossings); v5: COLORS.series + plotArea() + textWidth() (the data pack)
```

Interface additions (after `ellipse` in the geometry section, and after `GROUND`):

```ts
  /** Closed ring of n points around c at radius r (a circle for a closed stroke or an area). */
  circle(c: Pt, r: number, n?: number): Pt[];
  /** The four corners of an axis-aligned rectangle, lower-left at (x, y), counter-clockwise. */
  rect(x: number, y: number, w: number, h: number): Pt[];
  /**
   * A tappable pad for widgets: a group whose first child is a closed,
   * paper-filled outline (`<id>__shape` — elementRings hit-tests it) and
   * whose second is the label centred on it (`<id>__label`). Round with
   * `{r}`, rectangular with `{w, h}`.
   */
  pad(id: string, at: Pt, label: string, size: { r: number } | { w: number; h: number }, o?: { fontSize?: number; fill?: string; color?: string }): GroupDrawable;
  /** International Morse: letters A–Z and digits 0–9 → dots and dashes. Frozen. */
  MORSE: Readonly<Record<string, string>>;
```

Data (module level, near `STAMPS_DATA`):

```ts
const MORSE_DATA: Record<string, string> = Object.freeze({
  A: ".-", B: "-...", C: "-.-.", D: "-..", E: ".", F: "..-.", G: "--.", H: "....", I: "..", J: ".---",
  K: "-.-", L: ".-..", M: "--", N: "-.", O: "---", P: ".--.", Q: "--.-", R: ".-.", S: "...", T: "-",
  U: "..-", V: "...-", W: ".--", X: "-..-", Y: "-.--", Z: "--..",
  "0": "-----", "1": ".----", "2": "..---", "3": "...--", "4": "....-", "5": ".....", "6": "-....", "7": "--...", "8": "---..", "9": "----.",
});
```

Implementations in the `kit` object (next to `ellipse` and `group`):

```ts
  circle(c, r, n = 48) {
    return kit.ellipse(c, r, r, n);
  },
  rect(x, y, w, h) {
    return [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
  },
  pad(id, at, label, size, o = {}) {
    const pts = "r" in size ? kit.circle(at, size.r) : kit.rect(at[0] - size.w / 2, at[1] - size.h / 2, size.w, size.h);
    const h = "r" in size ? size.r * 2 : size.h;
    const shape = kit.stroke(`${id}__shape`, pts, { closed: true, fill: o.fill ?? GROUND, strokeWidth: 3, ms: SKETCH_MS.node });
    const text = kit.text(`${id}__label`, at, label, { fontSize: o.fontSize ?? Math.max(16, Math.round(h * 0.4)), color: o.color ?? COLORS.ink });
    return kit.group(id, [shape, text]);
  },
  MORSE: MORSE_DATA,
```

(`GROUND`, `SKETCH_MS`, `COLORS` are the module constants the kit already exposes; `kit.text` centres by default — confirm against `text()`'s implementation at ~line 604 and pass the anchor option it uses if centring is not the default.)

`src/layout/layout.ts:346`: change `function inverseDomainMapping` to `export function inverseDomainMapping`.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/scene-kit.test.ts tests/kit-smooth-closed.test.ts && npx tsc --noEmit`
Expected: PASS, tsc clean.

- [ ] **Step 5: Commit**

```bash
git add src/scenes/kit.ts src/layout/layout.ts tests/scene-kit.test.ts tests/kit-smooth-closed.test.ts
git commit -m "Widget bodies: kit v10 — circle and rect rings, a tappable pad, the Morse table; inverseDomainMapping exported (Task 2)"
```

---

### Task 3: `ToneLike.beep` and three public Player methods

**Files:**
- Modify: `src/render/tones.ts` (ToneLike ~line 16–26; WebAudioTones ~line 66+)
- Modify: `src/render/player.ts` (public `glow`, `tapAt`, `caption` next to `previewParams` ~line 543)
- Modify: `tests/music-sound.test.ts:83` (the fake gains `beep`)
- Test: `tests/widget-tones.test.ts`, `tests/widget-player-api.test.ts`

**Interfaces:**
- Produces: `ToneLike.beep(hz: number, ms: number, signal?: AbortSignal): number` (returns ms); `Player.glow(ids: string[], ms?: number, color?: string): Promise<void>`; `Player.tapAt(box: BBox, ms?: number): Promise<void>`; `Player.caption(text: string | null): void`.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/widget-tones.test.ts
import { describe, expect, test } from "vitest";
import { WebAudioTones } from "../src/render/tones";

/** Just enough AudioContext for one oscillator + gain. */
function fakeCtx() {
  const oscs: { freq: number; started: number; stopped: number }[] = [];
  const ctx = {
    currentTime: 1,
    state: "running",
    destination: {},
    resume: async () => undefined,
    createOscillator: () => {
      const o = { type: "sine", frequency: { value: 0 }, connect: () => undefined, start: (t: number) => (rec.started = t), stop: (t: number) => (rec.stopped = t) };
      const rec = { freq: 0, started: 0, stopped: 0 };
      Object.defineProperty(o.frequency, "value", { set: (v: number) => (rec.freq = v), get: () => rec.freq });
      oscs.push(rec);
      return o;
    },
    createGain: () => ({ gain: { setValueAtTime: () => undefined, linearRampToValueAtTime: () => undefined, setTargetAtTime: () => undefined }, connect: () => undefined }),
  };
  return { ctx: ctx as unknown as AudioContext, oscs };
}

describe("ToneLike.beep", () => {
  test("schedules one oscillator at hz for ms and returns ms", () => {
    const { ctx, oscs } = fakeCtx();
    const t = new WebAudioTones(ctx, ctx.destination as AudioNode);
    expect(t.beep(700, 80)).toBe(80);
    expect(oscs).toHaveLength(1);
    expect(oscs[0].freq).toBe(700);
    expect(oscs[0].stopped - oscs[0].started).toBeCloseTo(0.08 + 0.01, 3);
  });

  test("a non-positive duration or frequency schedules nothing", () => {
    const { ctx, oscs } = fakeCtx();
    const t = new WebAudioTones(ctx, ctx.destination as AudioNode);
    expect(t.beep(0, 80)).toBe(0);
    expect(t.beep(440, 0)).toBe(0);
    expect(oscs).toHaveLength(0);
  });
});
```

```ts
// tests/widget-player-api.test.ts — source pins: the three wrappers exist and route through the private machinery.
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const src = readFileSync("src/render/player.ts", "utf8");

describe("Player: the widget host's public surface", () => {
  test("glow(ids, ms, color) is one swell of the answer glow, always cleared", () => {
    expect(src).toMatch(/^\s+async glow\(ids: string\[\], ms = ANSWER_GLOW_MS, color\?: string\): Promise<void>/m);
    const body = src.slice(src.indexOf("async glow("), src.indexOf("async glow(") + 900);
    expect(body).toContain('effects.setHighlight(ids, "glow", t, null, color)');
    expect(body).toContain("effects.endHighlight(ids)");
  });
  test("tapAt(box, ms) drives the laser along pointerPath(…, \"tap\") and lifts it", () => {
    expect(src).toMatch(/^\s+async tapAt\(box: BBox, ms = 900\): Promise<void>/m);
    const body = src.slice(src.indexOf("async tapAt("), src.indexOf("async tapAt(") + 700);
    expect(body).toContain('pointerPath({ x: box.x + box.w / 2, y: box.y + box.h / 2, box }, "tap")');
    expect(body).toContain("effects.setPointer(null)");
  });
  test("caption(text | null) writes the band or restores the source caption", () => {
    expect(src).toMatch(/^\s+caption\(text: string \| null\): void/m);
    const body = src.slice(src.indexOf("caption(text: string | null)"), src.indexOf("caption(text: string | null)") + 300);
    expect(body).toContain("this.showCaption(this.captionSource)");
  });
});
```

- [ ] **Step 2: Run them**

Run: `npx vitest run tests/widget-tones.test.ts tests/widget-player-api.test.ts`
Expected: FAIL (`beep` missing; pins missing).

- [ ] **Step 3: `beep`**

`src/render/tones.ts`, in `ToneLike` after `play`:

```ts
  /**
   * One plain tone at `hz` for `ms` (a widget's press, a Morse dot) with the
   * "tone" recipe's envelope; returns ms. Nothing is scheduled for a
   * non-positive hz or ms.
   */
  beep(hz: number, ms: number, signal?: AbortSignal): number;
```

In `WebAudioTones`, after `play`:

```ts
  beep(hz: number, ms: number, signal?: AbortSignal): number {
    if (!(hz > 0) || !(ms > 0)) return 0;
    const audio = this.ensure();
    if (!audio) return ms;
    const { ctx, sink } = audio;
    const recipe = RECIPES.tone;
    const at = ctx.currentTime + 0.01;
    const dur = ms / 1000;
    const osc = ctx.createOscillator();
    osc.type = recipe.layers[0][0];
    osc.frequency.value = hz;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(recipe.gain, at + Math.min(recipe.attack, dur / 2));
    g.gain.setValueAtTime(recipe.gain, Math.max(at + recipe.attack, at + dur - 0.02));
    g.gain.linearRampToValueAtTime(0, at + dur);
    osc.connect(g);
    g.connect(sink);
    osc.start(at);
    osc.stop(at + dur + 0.01);
    const handle = {
      stop: () => {
        try {
          osc.stop();
        } catch {
          /* already stopped */
        }
        this.active.delete(handle);
      },
    };
    this.active.add(handle);
    osc.onended = () => this.active.delete(handle);
    signal?.addEventListener("abort", handle.stop, { once: true });
    return ms;
  }
```

(Read how `play` registers its handle in `this.active` — lines ~127–140 — and mirror it exactly, including any `onended` cleanup it does.) In `tests/music-sound.test.ts:83` add `beep: () => 0,` to the fake. Grep for any other `ToneLike` object literal in `src/` (the exporter's) and add the same.

- [ ] **Step 4: The Player wrappers**

`src/render/player.ts`, after `previewParams`:

```ts
  /** One swell of the answer glow on `ids` — a widget's "right", "wrong" or
   *  "look here" — always cleared, even when there are no effects to draw it. */
  async glow(ids: string[], ms = ANSWER_GLOW_MS, color?: string): Promise<void> {
    const effects = this.effects;
    if (!effects || ids.length === 0) return;
    const ac = new AbortController();
    try {
      await this.progress(ms, ac.signal, (t) => effects.setHighlight(ids, "glow", t, null, color));
    } finally {
      effects.endHighlight(ids);
    }
  }

  /** The laser taps the centre of `box` — a widget demo's gesture — and lifts. */
  async tapAt(box: BBox, ms = 900): Promise<void> {
    const effects = this.effects;
    if (!effects) return;
    const path = pointerPath({ x: box.x + box.w / 2, y: box.y + box.h / 2, box }, "tap");
    const ac = new AbortController();
    try {
      await this.progress(ms, ac.signal, (t) => effects.setPointer(t >= 1 ? null : path(t)));
    } finally {
      effects.setPointer(null);
    }
  }

  /** A widget's line in the caption band; null puts the narration's caption back. */
  caption(text: string | null): void {
    if (text === null) this.showCaption(this.captionSource);
    else this.setCaption(text);
  }
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run tests/widget-tones.test.ts tests/widget-player-api.test.ts tests/music-sound.test.ts && npx tsc --noEmit`
Expected: PASS, tsc clean.

- [ ] **Step 6: Commit**

```bash
git add src/render/tones.ts src/render/player.ts tests/music-sound.test.ts tests/widget-tones.test.ts tests/widget-player-api.test.ts
git commit -m "Widget bodies: ToneLike.beep and the Player's public glow, tapAt and caption — the surface a widget host performs effects through (Task 3)"
```

---

### Task 4: The pure core — scene, effect validation, the run harness

**Files:**
- Create: `src/scenes/widget-scene.ts`, `src/scenes/widget-effects.ts`, `src/scenes/widget-run.ts`
- Test: `tests/widget-effects.test.ts`, `tests/widget-run.test.ts`

**Interfaces:**
- Consumes: `WidgetBody`, `WidgetEvent`, `WidgetScene` (Task 1); `elementBBoxes`, `elementRings`, `domainMapping`, `inverseDomainMapping` (`src/layout/layout.ts`); `SceneModule` (`src/scenes/types.ts`).
- Produces:
  - `buildWidgetScene(module: SceneModule, params: Record<string, unknown>, opts?: { domain?: Spec["domain"]; vars?: Record<string, string>; layout?: Pick<LayoutResult, "drawables" | "order">; measure?: MeasureFn }): WidgetScene | null` — null when the module has no layout; `layout` defaults to the module's own layout at `params`.
  - `type WidgetEffect = { patch?: Record<string, unknown>; sound?: { hz: number; ms: number } | { notes: string; tempo?: number }; glow?: string[]; color?: string; pointer?: string; caption?: string; answer?: string }`.
  - `validateEffects(raw: unknown, scene: { ids: string[]; paramNames: string[] }): { effects: WidgetEffect[]; issues: string[] }`.
  - `stepWidget(body: WidgetBody, state: unknown, event: WidgetEvent, scene: WidgetScene, paramNames: string[]): { state: unknown; effects: WidgetEffect[]; errors: string[] }`.
  - `runWidget(module: SceneModule, params: Record<string, unknown>, clicks: (string | WidgetEvent)[], opts?: { domain?: Spec["domain"]; vars?: Record<string, string> }): { states: unknown[]; effects: WidgetEffect[][]; errors: string[]; answer: string | null; params: Record<string, unknown> }` — a string click is the id of a part, clicked at its box centre; after each `patch` the scene is rebuilt at the patched params.
  - `demoWidget(module: SceneModule, params: Record<string, unknown>, answer: string, opts?): { effects: WidgetEffect[]; errors: string[] }` — `demo`'s effects validated, or the default `[{ pointer: <first part> }]`.
  - `paramNamesOf(module: SceneModule): string[]` — the keys of `manifest.params_schema.properties`.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/widget-effects.test.ts
import { describe, expect, test } from "vitest";
import { validateEffects } from "../src/scenes/widget-effects";

const scene = { ids: ["key_dot", "key_dash"], paramNames: ["signal", "decoded"] };

describe("validateEffects", () => {
  test("a well-formed list passes untouched", () => {
    const { effects, issues } = validateEffects(
      [{ sound: { hz: 700, ms: 80 } }, { patch: { signal: "." } }, { glow: "key_dot", color: "#4a7c59" }, { pointer: "key_dash" }, { caption: "dot" }, { answer: "S" }],
      scene,
    );
    expect(issues).toEqual([]);
    expect(effects).toHaveLength(6);
    expect(effects[2].glow).toEqual(["key_dot"]);
  });
  test("a non-array is an issue and yields nothing", () => {
    expect(validateEffects({ patch: {} }, scene)).toEqual({ effects: [], issues: ["effects must be an array"] });
  });
  test("an unknown param in a patch is dropped with an issue, the rest kept", () => {
    const { effects, issues } = validateEffects([{ patch: { signal: ".", bogus: 1 } }], scene);
    expect(effects).toEqual([{ patch: { signal: "." } }]);
    expect(issues).toEqual(['patch: "bogus" is not a template param (signal, decoded)']);
  });
  test("an unknown effect key is an issue; an unknown part in glow/pointer is dropped", () => {
    const { effects, issues } = validateEffects([{ blink: 1 }, { glow: ["nope", "key_dot"] }, { pointer: "nope" }], scene);
    expect(effects).toEqual([{ glow: ["key_dot"] }]);
    expect(issues).toContain('unknown effect key "blink"');
    expect(issues).toContain('glow: "nope" is not a part');
    expect(issues).toContain('pointer: "nope" is not a part');
  });
  test("sound needs hz and ms, or notes", () => {
    const { effects, issues } = validateEffects([{ sound: { hz: 700 } }, { sound: { notes: "C4:q" } }, { sound: "beep" }], scene);
    expect(effects).toEqual([{ sound: { notes: "C4:q" } }]);
    expect(issues).toHaveLength(2);
  });
  test("answer and caption must be strings", () => {
    const { effects, issues } = validateEffects([{ answer: 3 }, { caption: ["x"] }], scene);
    expect(effects).toEqual([]);
    expect(issues).toHaveLength(2);
  });
});
```

```ts
// tests/widget-run.test.ts
import { describe, expect, test } from "vitest";
import { compileTemplateDoc } from "../src/scenes/compile";
import { buildWidgetScene, paramNamesOf } from "../src/scenes/widget-scene";
import { demoWidget, runWidget, stepWidget } from "../src/scenes/widget-run";
import type { TemplateDoc } from "../src/scenes/doc";

// A two-pad counter: dot adds ".", gap commits the count as the answer.
const doc = {
  template: "tap_counter",
  version: 1,
  kit: 10,
  status: "ready",
  description: "Two pads.",
  params: { type: "object", properties: { signal: { type: "string" } } },
  element_ids: { dot: "dot pad", gap: "gap pad", signal: "the strip" },
  examples: [{ request: "pads", params: {} }],
  layout: `
    const drawables = [
      kit.pad("dot", [300, 400], "·", { r: 40 }),
      kit.pad("gap", [500, 400], "gap", { w: 90, h: 60 }),
      kit.text("signal", [400, 550], params.signal ?? "", { fontSize: 30 }),
    ];
    return { drawables, labels: [], anchors: {}, order: ["dot", "gap", "signal"] };`,
  widget: `
    const init = () => ({ signal: "" });
    const on = (ev, st, scene) => {
      if (ev.id === "dot") { const signal = st.signal + "."; return { state: { signal }, effects: [{ sound: { hz: 700, ms: 80 } }, { patch: { signal } }] }; }
      if (ev.id === "gap") return { state: st, effects: [{ answer: String(st.signal.length) }, { caption: "sent " + scene.params.signal }] };
      return { state: st, effects: [] };
    };
    const demo = (scene, answer) => Array.from({ length: Number(answer) }, () => ({ pointer: "dot", sound: { hz: 700, ms: 80 } })).concat([{ pointer: "gap" }]);
    const judge = (given, answer) => Number(given) === Number(answer);
    return { init, on, demo, judge };`,
} as TemplateDoc;

const module = compileTemplateDoc(doc).module!;

describe("buildWidgetScene", () => {
  test("parts are the layout's top-level ids with boxes and the pad outlines as rings", () => {
    const scene = buildWidgetScene(module, {})!;
    expect(scene.ids).toEqual(["dot", "gap", "signal"]);
    expect(scene.boxes.get("dot")!.w).toBeCloseTo(80, 0);
    expect(scene.rings.has("dot")).toBe(true);
    expect(scene.rings.has("signal")).toBe(false);
    expect(scene.toDomain([500, 400])).toBeNull();
    expect(paramNamesOf(module)).toEqual(["signal"]);
  });
  test("with a domain, toDomain and toLogical invert each other", () => {
    const scene = buildWidgetScene(module, {}, { domain: { x: [0, 10], y: [0, 5] } })!;
    const p = scene.toLogical([5, 2.5]);
    expect(scene.toDomain(p)![0]).toBeCloseTo(5);
    expect(scene.toDomain(p)![1]).toBeCloseTo(2.5);
  });
});

describe("stepWidget", () => {
  test("returns the new state and validated effects", () => {
    const scene = buildWidgetScene(module, {})!;
    const body = module.widget!();
    const r = stepWidget(body, body.init(scene), { type: "click", id: "dot", point: [300, 400], domain: null }, scene, ["signal"]);
    expect(r.errors).toEqual([]);
    expect(r.state).toEqual({ signal: "." });
    expect(r.effects).toEqual([{ sound: { hz: 700, ms: 80 } }, { patch: { signal: "." } }]);
  });
  test("a body that throws is contained: state unchanged, the error reported", () => {
    const scene = buildWidgetScene(module, {})!;
    const body = { init: () => ({ n: 1 }), on: () => { throw new Error("boom"); } };
    const r = stepWidget(body, { n: 1 }, { type: "click", id: "dot", point: [0, 0], domain: null }, scene, []);
    expect(r.state).toEqual({ n: 1 });
    expect(r.effects).toEqual([]);
    expect(r.errors[0]).toMatch(/boom/);
  });
  test("a malformed return is contained the same way", () => {
    const scene = buildWidgetScene(module, {})!;
    const body = { init: () => 0, on: () => 42 as unknown as { state: unknown; effects: unknown } };
    const r = stepWidget(body, 0, { type: "click", id: "dot", point: [0, 0], domain: null }, scene, []);
    expect(r.state).toBe(0);
    expect(r.errors[0]).toMatch(/must return \{ state, effects \}/);
  });
});

describe("runWidget — the harness", () => {
  test("a click sequence by part id yields states, effects, the patched params and the last answer", () => {
    const r = runWidget(module, {}, ["dot", "dot", "dot", "gap"]);
    expect(r.errors).toEqual([]);
    expect(r.states.at(-1)).toEqual({ signal: "..." });
    expect(r.params).toEqual({ signal: "..." });
    expect(r.answer).toBe("3");
    expect(r.effects[3]).toEqual([{ answer: "3" }, { caption: "sent ..." }]); // the scene was rebuilt after the patches
  });
  test("an unknown part id is an error, not a throw", () => {
    const r = runWidget(module, {}, ["nope"]);
    expect(r.errors).toEqual(['click: "nope" is not a part (dot, gap, signal)']);
  });
  test("demoWidget validates the demo's effects, and defaults to one tap on the first part", () => {
    expect(demoWidget(module, {}, "2").effects).toEqual([{ pointer: "dot", sound: { hz: 700, ms: 80 } }, { pointer: "dot", sound: { hz: 700, ms: 80 } }, { pointer: "gap" }]);
    const noDemo = compileTemplateDoc({ ...doc, widget: "return { init: () => 0, on: (e, s) => ({ state: s, effects: [] }) };" } as TemplateDoc).module!;
    expect(demoWidget(noDemo, {}, "x").effects).toEqual([{ pointer: "dot" }]);
  });
});
```

- [ ] **Step 2: Run them**

Run: `npx vitest run tests/widget-effects.test.ts tests/widget-run.test.ts`
Expected: FAIL (modules missing).

- [ ] **Step 3: `widget-effects.ts`**

```ts
// Effect validation for widget bodies (spec §2.2): a body may return anything;
// only well-formed effects reach the host, and every rejection is named so
// the harness and the console can say what was dropped.
export type WidgetSound = { hz: number; ms: number } | { notes: string; tempo?: number };

export interface WidgetEffect {
  patch?: Record<string, unknown>;
  sound?: WidgetSound;
  glow?: string[];
  color?: string;
  pointer?: string;
  caption?: string;
  answer?: string;
}

const KEYS = new Set(["patch", "sound", "glow", "color", "pointer", "caption", "answer"]);

export function validateEffects(raw: unknown, scene: { ids: string[]; paramNames: string[] }): { effects: WidgetEffect[]; issues: string[] } {
  const issues: string[] = [];
  if (!Array.isArray(raw)) return { effects: [], issues: ["effects must be an array"] };
  const parts = new Set(scene.ids);
  const effects: WidgetEffect[] = [];
  raw.forEach((item, i) => {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      issues.push(`effects[${i}] must be an object`);
      return;
    }
    const e = item as Record<string, unknown>;
    const out: WidgetEffect = {};
    for (const k of Object.keys(e)) if (!KEYS.has(k)) issues.push(`unknown effect key "${k}"`);
    if (e.patch !== undefined) {
      if (typeof e.patch !== "object" || e.patch === null || Array.isArray(e.patch)) issues.push("patch must be an object of params");
      else {
        const p: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(e.patch as Record<string, unknown>)) {
          if (scene.paramNames.includes(k)) p[k] = v;
          else issues.push(`patch: "${k}" is not a template param (${scene.paramNames.join(", ")})`);
        }
        out.patch = p;
      }
    }
    if (e.sound !== undefined) {
      const s = e.sound as { hz?: unknown; ms?: unknown; notes?: unknown; tempo?: unknown } | null;
      if (typeof s === "object" && s !== null && typeof s.hz === "number" && typeof s.ms === "number") out.sound = { hz: s.hz, ms: s.ms };
      else if (typeof s === "object" && s !== null && typeof s.notes === "string") out.sound = { notes: s.notes, ...(typeof s.tempo === "number" ? { tempo: s.tempo } : {}) };
      else issues.push("sound needs { hz, ms } or { notes, tempo? }");
    }
    if (e.glow !== undefined) {
      const ids = (Array.isArray(e.glow) ? e.glow : [e.glow]).filter((id): id is string => typeof id === "string");
      const known = ids.filter((id) => parts.has(id));
      for (const id of ids) if (!parts.has(id)) issues.push(`glow: "${id}" is not a part`);
      if (known.length > 0) out.glow = known;
      if (typeof e.color === "string") out.color = e.color;
    }
    if (e.pointer !== undefined) {
      if (typeof e.pointer === "string" && parts.has(e.pointer)) out.pointer = e.pointer;
      else issues.push(`pointer: "${String(e.pointer)}" is not a part`);
    }
    if (e.caption !== undefined) {
      if (typeof e.caption === "string") out.caption = e.caption;
      else issues.push("caption must be a string");
    }
    if (e.answer !== undefined) {
      if (typeof e.answer === "string") out.answer = e.answer;
      else issues.push("answer must be a string");
    }
    if (Object.keys(out).length > 0) effects.push(out);
  });
  return { effects, issues };
}
```

- [ ] **Step 4: `widget-scene.ts`**

```ts
// The scene a widget body reads (spec §2.2): the template's parts with their
// boxes and outlines, the painted params, and the domain mappings. Pure —
// built from a layout, never from the DOM.
import { domainMapping, elementBBoxes, elementRings, inverseDomainMapping, type LayoutResult } from "../layout/layout";
import type { MeasureFn } from "../layout/measure";
import type { Pt } from "../layout/model";
import type { Spec } from "../spec/types";
import type { SceneModule } from "./types";
import type { WidgetScene } from "./widget-types";

export interface WidgetSceneOpts {
  domain?: Spec["domain"];
  vars?: Record<string, string>;
  /** The layout on screen; defaults to the module's own layout at `params`. */
  layout?: Pick<LayoutResult, "drawables" | "order">;
  measure?: MeasureFn;
}

/** The keys of the template's params_schema — what a `patch` may name. */
export function paramNamesOf(module: SceneModule): string[] {
  const props = (module.manifest.params_schema as { properties?: Record<string, unknown> }).properties;
  return props ? Object.keys(props) : [];
}

export function buildWidgetScene(module: SceneModule, params: Record<string, unknown>, opts: WidgetSceneOpts = {}): WidgetScene | null {
  if (!module.layout) return null;
  const own = module.layout(params);
  const layout = opts.layout ?? { drawables: own.drawables, order: own.order };
  const ids = own.order.slice();
  const all = elementBBoxes(layout as LayoutResult, opts.measure);
  const boxes = new Map([...all].filter(([id]) => ids.includes(id)));
  const rings = new Map([...elementRings(layout)].filter(([id]) => ids.includes(id)));
  const fwd = domainMapping(opts.domain);
  const inv = opts.domain ? inverseDomainMapping(opts.domain) : null;
  return {
    ids,
    boxes,
    rings,
    params,
    vars: opts.vars ?? {},
    toDomain: (p: Pt) => (inv ? inv(p) : null),
    toLogical: (p: Pt) => fwd.toLogical(p),
  };
}
```

(`elementBBoxes` takes a full `LayoutResult`; if its type does not accept the `Pick`, pass `layout as LayoutResult` — it reads only `drawables` and `order`. Check `MeasureFn`'s import path in `src/layout/measure.ts`.)

- [ ] **Step 5: `widget-run.ts`**

```ts
// Stepping a widget body, and the node harness authors and the examples gate
// run a click sequence through (spec §2.8). Nothing here touches the DOM.
import { hitElement } from "../ui/hit";
import { validateEffects, type WidgetEffect } from "./widget-effects";
import { buildWidgetScene, paramNamesOf, type WidgetSceneOpts } from "./widget-scene";
import type { SceneModule } from "./types";
import type { WidgetBody, WidgetEvent, WidgetScene } from "./widget-types";

export function stepWidget(body: WidgetBody, state: unknown, event: WidgetEvent, scene: WidgetScene, paramNames: string[]): { state: unknown; effects: WidgetEffect[]; errors: string[] } {
  let out: unknown;
  try {
    out = body.on(event, state, scene);
  } catch (err) {
    return { state, effects: [], errors: [`widget on() threw: ${(err as Error).message}`] };
  }
  const r = out as { state?: unknown; effects?: unknown } | null;
  if (typeof r !== "object" || r === null || !("state" in r) || !("effects" in r)) {
    return { state, effects: [], errors: ["widget on() must return { state, effects }"] };
  }
  const v = validateEffects(r.effects, { ids: scene.ids, paramNames });
  return { state: r.state, effects: v.effects, errors: v.issues };
}

export interface WidgetRun {
  states: unknown[];
  effects: WidgetEffect[][];
  errors: string[];
  answer: string | null;
  params: Record<string, unknown>;
}

/** Click the parts in order (an id clicks the part's box centre; a full event
 *  is used as given). After each patch the scene is rebuilt at the patched params. */
export function runWidget(module: SceneModule, params: Record<string, unknown>, clicks: (string | WidgetEvent)[], opts: WidgetSceneOpts = {}): WidgetRun {
  const run: WidgetRun = { states: [], effects: [], errors: [], answer: null, params: { ...params } };
  if (!module.widget) return { ...run, errors: ["template has no widget body"] };
  const names = paramNamesOf(module);
  let scene = buildWidgetScene(module, run.params, opts);
  if (!scene) return { ...run, errors: ["template has no layout"] };
  const body = module.widget();
  let state: unknown;
  try {
    state = body.init(scene);
  } catch (err) {
    return { ...run, errors: [`widget init() threw: ${(err as Error).message}`] };
  }
  for (const c of clicks) {
    const ev: WidgetEvent | null =
      typeof c === "string"
        ? (() => {
            const b = scene!.boxes.get(c);
            if (!b) return null;
            const point: [number, number] = [b.x + b.w / 2, b.y + b.h / 2];
            return { type: "click", id: c, point, domain: scene!.toDomain(point) };
          })()
        : c;
    if (!ev) {
      run.errors.push(`click: "${String(c)}" is not a part (${scene.ids.join(", ")})`);
      continue;
    }
    const r = stepWidget(body, state, ev, scene, names);
    state = r.state;
    run.states.push(state);
    run.effects.push(r.effects);
    run.errors.push(...r.errors);
    let patched = false;
    for (const e of r.effects) {
      if (e.patch) {
        Object.assign(run.params, e.patch);
        patched = true;
      }
      if (e.answer !== undefined) run.answer = e.answer;
    }
    if (patched) scene = buildWidgetScene(module, run.params, opts) ?? scene;
  }
  return run;
}

/** The movie form: the body's demo effects, validated — or one tap on the first part. */
export function demoWidget(module: SceneModule, params: Record<string, unknown>, answer: string, opts: WidgetSceneOpts = {}): { effects: WidgetEffect[]; errors: string[] } {
  const scene = buildWidgetScene(module, params, opts);
  if (!scene || !module.widget) return { effects: [], errors: ["template has no widget body"] };
  const body = module.widget();
  if (!body.demo) return { effects: scene.ids.length > 0 ? [{ pointer: scene.ids[0] }] : [], errors: [] };
  let raw: unknown;
  try {
    raw = body.demo(scene, answer);
  } catch (err) {
    return { effects: [], errors: [`widget demo() threw: ${(err as Error).message}`] };
  }
  const v = validateEffects(raw, { ids: scene.ids, paramNames: paramNamesOf(module) });
  return { effects: v.effects, errors: v.issues };
}

/** Where a click at `p` lands among the parts, with the click gates' fat-finger slop. */
export function partAt(scene: WidgetScene, p: [number, number], slop = 18): string | null {
  return hitElement(scene.boxes, p, slop, scene.rings);
}
```

- [ ] **Step 6: Run the tests**

Run: `npx vitest run tests/widget-effects.test.ts tests/widget-run.test.ts && npx tsc --noEmit`
Expected: PASS, tsc clean.

- [ ] **Step 7: Commit**

```bash
git add src/scenes/widget-scene.ts src/scenes/widget-effects.ts src/scenes/widget-run.ts tests/widget-effects.test.ts tests/widget-run.test.ts
git commit -m "Widget bodies: the pure core — the scene a body reads, effect validation, stepWidget and the runWidget/demoWidget harness (Task 4)"
```

---

### Task 5: The host — paused clicks on the parts run the widget; effects performed; state dies with the preview

**Files:**
- Create: `src/ui/widget-host.ts`
- Modify: `src/ui/controls.ts` (~line 1013: attach; keep the gate dispatch for Task 6)
- Modify: `src/ui/infocard.ts` (~line 224: stand aside for widget parts)
- Test: `tests/widget-host.test.ts`

**Interfaces:**
- Consumes: `stepWidget`, `partAt` (Task 4); `buildWidgetScene`, `paramNamesOf` (Task 4); `Player.previewParams`, `Player.glow`, `Player.tapAt`, `Player.caption`, `ToneLike.beep`/`play` (Task 3); `logicalPoint` (`src/ui/dom.ts`); `gateIsOpen` (`src/ui/gates.ts`); `scenes` (`src/scenes/registry.ts`).
- Produces:

```ts
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
export function widgetHostFor(hd: RenderHandle, deps?: WidgetHostDeps): WidgetHost | null; // null when the template has no widget body
export function attachWidgetHost(stage: HTMLElement, hd: RenderHandle): WidgetHost | null;
```

`WidgetHostDeps` (for tests) = `{ warn?: (msg: string) => void }`.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/widget-host.test.ts
import { readFileSync } from "node:fs";
import { describe, expect, test, vi } from "vitest";
import { compileTemplateDoc } from "../src/scenes/compile";
import { scenes } from "../src/scenes/registry";
import { widgetHostFor } from "../src/ui/widget-host";
import { layoutSpec } from "../src/layout/layout";
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
    const on = (ev, st) => {
      if (ev.id === "dot") { const signal = st.signal + "."; return { state: { signal }, effects: [{ sound: { hz: 700, ms: 80 } }, { patch: { signal } }, { glow: "dot" }] }; }
      if (ev.id === "gap") return { state: st, effects: [{ answer: st.signal }, { caption: "sent" }, { patch: { nope: 1 } }] };
      return { state: st, effects: [] };
    };
    return { init, on };`,
} as TemplateDoc;

scenes["host_pads"] = compileTemplateDoc(doc).module!;

function fakeHandle() {
  const spec = { template: "host_pads", params: {}, commands: [] } as unknown as RenderHandle["spec"];
  const layout = layoutSpec(spec);
  const calls: string[] = [];
  const timeline = {
    state: "paused",
    position: 0,
    vars: new Map<string, string>(),
    callbacks: {},
    tones: { beep: (hz: number, ms: number) => (calls.push(`beep ${hz} ${ms}`), ms), play: () => 0, cancel: () => undefined, pause: () => undefined, resume: () => undefined },
    previewParams: (o: Record<string, unknown>) => calls.push(`preview ${JSON.stringify(o)}`),
    paintedLayout: () => null,
    glow: async (ids: string[]) => void calls.push(`glow ${ids.join(",")}`),
    tapAt: async () => undefined,
    caption: (t: string | null) => calls.push(`caption ${t}`),
    getParamOverrides: () => ({}),
  };
  const hd = { spec, layout, timeline } as unknown as RenderHandle;
  return { hd, calls, timeline };
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

describe("attachWidgetHost — source pins", () => {
  const src = readFileSync("src/ui/widget-host.ts", "utf8");
  const controls = readFileSync("src/ui/controls.ts", "utf8");
  const infocard = readFileSync("src/ui/infocard.ts", "utf8");
  test("listens in the capture phase, stands aside while playing and while a gate is open", () => {
    expect(src).toContain('stage.addEventListener("click"');
    expect(src).toMatch(/hd\.timeline\.state === "playing"\) return/);
    expect(src).toMatch(/gateIsOpen\(stage\)\) return/);
    expect(src).toContain("e.stopPropagation()");
  });
  test("resets on play, on a step boundary and chains the callbacks", () => {
    expect(src).toContain("const prevOnState = hd.timeline.callbacks.onState");
    expect(src).toContain("const prevOnStep = hd.timeline.callbacks.onStep");
    expect(src).toMatch(/if \(s === "playing"\) host\.reset\(\)/);
  });
  test("the cursor class marks parts while paused", () => {
    expect(src).toContain('stage.classList.toggle("cs-cardable"');
  });
  test("controls attaches it beside the chess free play, before the info cards", () => {
    const a = controls.indexOf("attachWidgetHost(stage, hd)");
    const b = controls.indexOf("attachInfoCards(stage, hd)");
    expect(a).toBeGreaterThan(-1);
    expect(a).toBeLessThan(b);
  });
  test("the info card stands aside for widget parts", () => {
    expect(infocard).toMatch(/widgetHost\?\.over\(p\)\) return null/);
  });
});
```

- [ ] **Step 2: Run it**

Run: `npx vitest run tests/widget-host.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 3: `widget-host.ts`**

```ts
// The widget host (spec §2.3): while paused, a click on one of the template's
// parts runs the widget body and performs its effects; nothing persists past
// the preview. The DOM-free core (widgetHostFor) is what tests drive; the
// stage listener (attachWidgetHost) is source-pinned.
import type { RenderHandle } from "../render";
import type { Pt } from "../layout/model";
import { scenes } from "../scenes/registry";
import { buildWidgetScene, paramNamesOf } from "../scenes/widget-scene";
import { partAt, stepWidget } from "../scenes/widget-run";
import type { WidgetEffect } from "../scenes/widget-effects";
import type { WidgetBody, WidgetScene } from "../scenes/widget-types";
import { makeBrowserMeasure } from "../render/svg-backend";
import { logicalPoint } from "./dom";
import { gateIsOpen } from "./gates";

export interface WidgetHost {
  clickAt(p: Pt): boolean;
  over(p: Pt): boolean;
  lastAnswer(): string | null;
  onAnswer(fn: (value: string) => void): () => void;
  reset(): void;
}

export interface WidgetHostDeps {
  warn?: (msg: string) => void;
  /** Text measure for boxes; the browser's in the app, the heuristic in tests. */
  measure?: Parameters<typeof buildWidgetScene>[2] extends { measure?: infer M } ? M : never;
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
      if (e.patch) {
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

/** Wire the host to a stage: capture-phase clicks while paused, the cursor
 *  class over parts, resets on playback and step boundaries. Null when the
 *  template has no widget body. */
export function attachWidgetHost(stage: HTMLElement, hd: RenderHandle): WidgetHost | null {
  const host = widgetHostFor(hd, { measure: makeBrowserMeasure() });
  if (!host) return null;

  stage.addEventListener(
    "click",
    (e) => {
      if (hd.timeline.state === "playing") return;
      if (gateIsOpen(stage)) return;
      const p = logicalPoint(stage, e);
      if (!p) return;
      if (host.clickAt(p)) {
        e.stopPropagation();
        e.preventDefault();
      }
    },
    true,
  );
  stage.addEventListener("pointermove", (e) => {
    if (hd.timeline.state === "playing") return;
    const p = logicalPoint(stage, e);
    if (p && host.over(p)) stage.classList.toggle("cs-cardable", true);
  });

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
```

Notes for the implementer: `hd.timeline.state`, `getParamOverrides`, `paintedLayout`, `vars`, `tones`, `callbacks` all exist on `Player` (see `src/render/player.ts`). `makeBrowserMeasure` is exported from `src/render/svg-backend.ts` (used by `figureGateFor`). The `measure` type in `WidgetHostDeps` may simply be `MeasureFn` from `src/layout/measure.ts` — use that if the conditional type is awkward. Only the pointermove handler sets the class on; the info card's own pointermove toggles it off when nothing is under the pointer, so a pad and a card element share the cursor rule.

- [ ] **Step 4: Attach from controls, stand aside in the info card**

`src/ui/controls.ts` ~line 1013, after `if (interactions.includes("chess")) attachChessPlay(stage, hd);`:

```ts
  const widgetHost = attachWidgetHost(stage, hd); // no-op unless the template carries a widget body
  attachInfoCards(stage, hd, widgetHost); // no-op unless the spec carries card elements
```

Add `import { attachWidgetHost, type WidgetHost } from "./widget-host";`.

`src/ui/infocard.ts`: change the signature to `export function attachInfoCards(stage: HTMLElement, hd: RenderHandle, widgetHost: WidgetHost | null = null): void` (import the type), and in `targetAt` right after the piano stand-aside line (~225):

```ts
    if (widgetHost?.over(p)) return null;
```

Grep for other callers of `attachInfoCards` (the viewer, embeds) — the defaulted third parameter keeps them compiling.

- [ ] **Step 5: Run the tests and tsc**

Run: `npx vitest run tests/widget-host.test.ts tests/infocard*.test.ts && npx tsc --noEmit`
Expected: PASS, tsc clean. (If `infocard` tests pin `attachInfoCards(stage, hd)` two-argument calls, update the pin to the new call.)

- [ ] **Step 6: Commit**

```bash
git add src/ui/widget-host.ts src/ui/controls.ts src/ui/infocard.ts tests/widget-host.test.ts
git commit -m "Widget bodies: the host — paused clicks on the parts run the widget, effects performed through the Player, state dies with the preview; info card stands aside (Task 5)"
```

---

### Task 6: Asks bind to the template's widget — types, schema, plan, gate, demo, lint, prompt

**Files:**
- Modify: `src/spec/types.ts` (`AskArgs.widget` ~line 583; add `BUILTIN_WIDGETS`)
- Modify: `src/spec/schema.ts` (~line 539 description/type; ~line 1250 semantic check)
- Modify: `src/render/plan.ts` (step type ~line 52; `pushStep` ~line 926: `widgetTemplate`)
- Modify: `src/render/player.ts` (`widgetDemo` field; the ask branch ~line 826)
- Create: `src/render/widget-demo.ts`
- Modify: `src/render/index.ts` (~line 351: set `player.widgetDemo`)
- Modify: `src/ui/widget-host.ts` (add `widgetGateFor`), `src/ui/controls.ts` (~line 983: dispatch)
- Modify: `src/lint/lint.ts` (union + `lintWidget` in `lintCommands`)
- Modify: `src/llm/prompts/compiler-v1.md` (the ask bullet, line 101), `src/llm/prompts/author-v1.md`
- Modify: `tests/prompt-size.test.ts` (re-pin)
- Test: `tests/widget-ask.test.ts`, `tests/widget-lint.test.ts`

**Interfaces:**
- Consumes: `demoWidget` (Task 4); `Player.tapAt/glow/caption`, `ToneLike.beep` (Task 3); `WidgetHost` (Task 5); `answersMatch` (`src/spec/answers.ts`).
- Produces: `export const BUILTIN_WIDGETS = ["click", "piano", "chess", "code", "drag", "connect"] as const` (`src/spec/types.ts`); `AskArgs.widget?: string`; plan ask step `widget?: string; widgetTemplate?: true`; `Player.widgetDemo: ((signal: AbortSignal, step: Extract<PlanStep, { kind: "ask" }>) => Promise<void>) | null`; `widgetDemoFor(player: Player, spec: Spec, layout: LayoutResult): (signal, step) => Promise<void>` (`src/render/widget-demo.ts`); `widgetGateFor(stage: HTMLElement, hd: RenderHandle, host: WidgetHost): (signal: AbortSignal, step: AskGateStep) => Promise<string | null>`; lint rule `"widget"`.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/widget-ask.test.ts
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { validateSpec } from "../src/spec/schema";
import { planCommands } from "../src/render/plan";
import { BUILTIN_WIDGETS } from "../src/spec/types";
import type { Spec } from "../src/spec/types";

const base: Spec = {
  title: "t",
  template: "piano_keys",
  params: {},
  commands: [{ ask: { question: "Send?", widget: "piano_keys", answer: "SOS" } }],
} as unknown as Spec;

describe("ask.widget may name the spec's template", () => {
  test("the six built-in names and the template pass; anything else is an error", () => {
    expect(validateSpec(base).ok).toBe(true);
    for (const w of BUILTIN_WIDGETS) {
      const ask = w === "drag" ? { question: "?", widget: "drag", items: ["a"], right: "r" } : { question: "?", widget: w, answer: "x" };
      expect(validateSpec({ ...base, commands: [{ ask }] } as unknown as Spec).ok, w).toBe(true);
    }
    const bad = validateSpec({ ...base, commands: [{ ask: { question: "?", widget: "morse_key", answer: "x" } }] } as unknown as Spec);
    expect(bad.ok).toBe(false);
    expect(bad.errors.join("\n")).toMatch(/ask\.widget "morse_key" is neither a built-in device .* nor this drawcast's template \("piano_keys"\)/);
  });

  test("the plan flags a template-bound ask", () => {
    const plan = planCommands(base.commands, [], { bboxOf: () => null, windows: {}, toLogical: (p) => p, deltaToLogical: (d) => d, animateBase: {} });
    const step = plan.steps.find((s) => s.kind === "ask") as { widget?: string; widgetTemplate?: true };
    expect(step.widget).toBe("piano_keys");
    expect(step.widgetTemplate).toBe(true);
    const plain = planCommands([{ ask: { question: "?", widget: "click", answer: "x" } }], [], { bboxOf: () => null, windows: {}, toLogical: (p) => p, deltaToLogical: (d) => d, animateBase: {} });
    expect((plain.steps[0] as { widgetTemplate?: true }).widgetTemplate).toBeUndefined();
  });
});

describe("the player's widget-ask branch and the gate — source pins", () => {
  const player = readFileSync("src/render/player.ts", "utf8");
  const index = readFileSync("src/render/index.ts", "utf8");
  const controls = readFileSync("src/ui/controls.ts", "utf8");
  const host = readFileSync("src/ui/widget-host.ts", "utf8");
  test("a template-bound ask on the auto path runs widgetDemo before the auto answer stands", () => {
    expect(player).toMatch(/widgetDemo: \(\(signal: AbortSignal, step: Extract<PlanStep, \{ kind: "ask" \}>\) => Promise<void>\) \| null = null/);
    const branch = player.slice(player.indexOf('if (step.widget !== undefined && (this.autoAnswers || !this.askGate))'), player.indexOf("typed = auto;"));
    expect(branch).toContain("if (step.widgetTemplate && this.widgetDemo) {");
    expect(branch).toContain("await this.widgetDemo(signal, step)");
  });
  test("render() wires the demo when the template carries a widget body", () => {
    expect(index).toMatch(/player\.widgetDemo = widgetDemoFor\(player, spec, layout\)/);
  });
  test("controls dispatches a template-bound ask to the widget gate", () => {
    expect(controls).toMatch(/step\.widgetTemplate && widgetHost\s*\?\s*widgetGate\(signal, step\)/);
  });
  test("the widget gate resolves the step's answer on a correct judgement and the given string otherwise", () => {
    const gate = host.slice(host.indexOf("export function widgetGateFor"));
    expect(gate).toContain("body.judge ? body.judge(given, step.answer) : answersMatch(given, step.answer)");
    expect(gate).toContain("resolve(ok ? step.answer : given)");
    expect(gate).toContain('class: "cs-figgate"');
    expect(gate).toContain("cs-figgate-skip");
  });
});
```

```ts
// tests/widget-lint.test.ts
import { describe, expect, test } from "vitest";
import { compileTemplateDoc } from "../src/scenes/compile";
import { scenes } from "../src/scenes/registry";
import { lintCommands } from "../src/lint/lint";
import type { Spec } from "../src/spec/types";
import type { TemplateDoc } from "../src/scenes/doc";

const mk = (id: string, widget?: string): TemplateDoc =>
  ({
    template: id,
    version: 1,
    kit: 10,
    status: "ready",
    description: "d",
    params: { type: "object", properties: {} },
    element_ids: { pad: "p" },
    examples: [{ request: "r", params: {} }],
    layout: `return { drawables: [kit.pad("pad", [100, 100], "x", { r: 20 })], labels: [], anchors: {}, order: ["pad"] };`,
    ...(widget ? { widget } : {}),
  }) as TemplateDoc;

scenes["lint_with_widget"] = compileTemplateDoc(mk("lint_with_widget", "return { init: () => 0, on: (e, s) => ({ state: s, effects: [] }) };")).module!;
scenes["lint_without_widget"] = compileTemplateDoc(mk("lint_without_widget")).module!;

const spec = (template: string): Spec => ({ title: "t", template, params: {}, commands: [{ ask: { question: "?", widget: template, answer: "x" } }] }) as unknown as Spec;

describe("lint rule widget", () => {
  test("an ask bound to a template with a widget body is clean", () => {
    expect(lintCommands(spec("lint_with_widget")).filter((i) => i.rule === "widget")).toEqual([]);
  });
  test("an ask bound to a template without one is an error", () => {
    const issues = lintCommands(spec("lint_without_widget")).filter((i) => i.rule === "widget");
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe("error");
    expect(issues[0].message).toMatch(/"lint_without_widget" has no widget body/);
  });
  test("built-in devices are not this rule's business", () => {
    const s = { ...spec("lint_without_widget"), commands: [{ ask: { question: "?", widget: "click", answer: "pad" } }] } as unknown as Spec;
    expect(lintCommands(s).filter((i) => i.rule === "widget")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run them**

Run: `npx vitest run tests/widget-ask.test.ts tests/widget-lint.test.ts`
Expected: FAIL.

- [ ] **Step 3: Types and schema**

`src/spec/types.ts`, before `AskArgs`:

```ts
/** The answer devices the app builds in; `ask.widget` may also name the spec's own template when that template carries a widget body. */
export const BUILTIN_WIDGETS = ["click", "piano", "chess", "code", "drag", "connect"] as const;
```

`AskArgs.widget` becomes:

```ts
  /** Answer device: click = click the element on the figure (answer = its id);
   *  piano = press a key on the drawn keyboard (answer = the note, e.g. "C4");
   *  chess = click two squares (answer = the move, e.g. "e2e4");
   *  code = write a script on a code panel (implied by `code`);
   *  drag / connect as documented in the schema; or THE SPEC'S TEMPLATE NAME
   *  when that template carries a widget body — the widget's `answer` effect
   *  is what is judged. Requires answer. */
  widget?: string;
```

`src/spec/schema.ts` ~line 539: remove the `enum` line and append to the description: `" Or the name of this drawcast's template (spec.template) when that template carries a widget body: the viewer works the figure and the widget's own answer is judged — in movies the widget's demo performs it."`

`src/spec/schema.ts` ~line 1250, after the `ask.widget requires answer` check (the enclosing function has the spec in scope — find the variable that `spec.template` is read from in that validator, e.g. `spec`):

```ts
      if (a.widget !== undefined && !(BUILTIN_WIDGETS as readonly string[]).includes(a.widget) && a.widget !== spec.template) {
        errors.push(`commands[${i}]: ask.widget "${a.widget}" is neither a built-in device (${BUILTIN_WIDGETS.join(", ")}) nor this drawcast's template (${spec.template ? `"${spec.template}"` : "none"})`);
      }
```

Import `BUILTIN_WIDGETS` from `./types`. Grep `schema.ts`, `plan.ts` and `controls.ts` for the literal union `"click" | "piano" | "chess" | "code" | "drag" | "connect"` and replace each with `string` (plan step, `AskGateStep.widget`).

- [ ] **Step 4: Plan and player**

`src/render/plan.ts` ask step: `widget?: string; /** ask.widget names the spec's template: the widget body answers, the demo performs. */ widgetTemplate?: true;`. In `pushStep` (~line 926) add after the widget spread:

```ts
        ...(cmd.ask.widget !== undefined && !(BUILTIN_WIDGETS as readonly string[]).includes(cmd.ask.widget) ? { widgetTemplate: true as const } : {}),
```

`src/render/player.ts`: after `codeGate`:

```ts
  /** A template-bound ask's movie form, set by render() when the template carries a widget body: performs the widget's demo effects. */
  widgetDemo: ((signal: AbortSignal, step: Extract<PlanStep, { kind: "ask" }>) => Promise<void>) | null = null;
```

In the ask branch, replace the block from `// A drag question has one box per item` through `typed = auto;` with:

```ts
          if (step.widgetTemplate && this.widgetDemo) {
            await this.widgetDemo(signal, step);
            if (signal.aborted) return;
          } else {
            // A drag question has one box per item: the laser taps each in turn.
            const boxes = step.answerBoxes ?? (step.answerBox ? [step.answerBox] : []);
            if (this.effects && boxes.length > 0) {
              const effects = this.effects;
              for (const b of boxes) {
                const path = pointerPath({ x: b.x + b.w / 2, y: b.y + b.h / 2, box: b }, "tap");
                try {
                  await this.progress(boxes.length > 1 ? 900 : 1400, signal, (t) => effects.setPointer(t >= 1 ? null : path(t)));
                } finally {
                  effects.setPointer(null);
                }
                if (signal.aborted) return;
              }
            } else {
              await this.waitScaled(1200, signal);
            }
          }
          typed = auto;
```

`src/render/widget-demo.ts` (new):

```ts
// The movie form of a template-bound ask (spec §2.4): perform the widget's
// demo effects on the player — taps awaited, sounds through the tones seam
// (which the exporter records), patches previewed so the figure follows.
import type { Player } from "./player";
import type { PlanStep } from "./plan";
import type { LayoutResult } from "../layout/layout";
import type { Spec } from "../spec/types";
import { scenes } from "../scenes/registry";
import { demoWidget } from "../scenes/widget-run";
import { buildWidgetScene } from "../scenes/widget-scene";

export function widgetDemoFor(player: Player, spec: Spec, layout: LayoutResult): (signal: AbortSignal, step: Extract<PlanStep, { kind: "ask" }>) => Promise<void> {
  return async (signal, step) => {
    const module = spec.template ? scenes[spec.template] : undefined;
    if (!module?.widget || step.answer === undefined) return;
    const params = { ...(spec.params ?? {}), ...player.getParamOverrides() };
    const { effects, errors } = demoWidget(module, params, step.answer, { domain: spec.domain, layout });
    for (const m of errors) console.warn(`[widget ${spec.template}] demo: ${m}`);
    let patches: Record<string, unknown> = {};
    let scene = buildWidgetScene(module, params, { domain: spec.domain, layout });
    for (const e of effects) {
      if (signal.aborted) return;
      if (e.sound && player.tones) {
        if ("hz" in e.sound) player.tones.beep(e.sound.hz, e.sound.ms, signal);
        else player.tones.play([{ notes: e.sound.notes }], e.sound.tempo ?? 120, signal);
      }
      if (e.caption !== undefined) player.caption(e.caption);
      if (e.patch) {
        patches = { ...patches, ...e.patch };
        player.previewParams(patches, { revealNew: true });
        scene = buildWidgetScene(module, { ...params, ...patches }, { domain: spec.domain, layout: player.paintedLayout() ?? layout });
      }
      if (e.glow) await player.glow(e.glow, undefined, e.color);
      if (e.pointer) {
        const b = scene?.boxes.get(e.pointer);
        if (b) await player.tapAt(b, 900);
      }
    }
    if (effects.some((e) => e.caption !== undefined)) player.caption(null);
  };
}
```

`src/render/index.ts` after `player.tones = options.tones ?? liveTones();`:

```ts
  if (spec.template && scenes[spec.template]?.widget) player.widgetDemo = widgetDemoFor(player, spec, layout);
```

with `import { scenes } from "../scenes/registry";` and `import { widgetDemoFor } from "./widget-demo";`. (`layout` is the variable the handle carries as `hd.layout` — use the same one the `RenderHandle` is built from.)

- [ ] **Step 5: The gate**

Append to `src/ui/widget-host.ts`:

```ts
import { answersMatch } from "../spec/answers";
import { h } from "./dom";
import type { AskGateStep } from "./controls";

const CARD_LINGER_MS = 900;

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
      const body = template && scenes[template]?.widget ? scenes[template]!.widget!() : null;
      let settled = false;
      const finish = (value: string | null): void => {
        if (settled) return;
        settled = true;
        unsubscribe();
        signal.removeEventListener("abort", onAbort);
        window.setTimeout(() => gate.remove(), value === null ? 0 : CARD_LINGER_MS);
        resolve(value);
      };
      const onAbort = (): void => finish(null);
      const unsubscribe = host.onAnswer((given) => {
        if (step.answer === undefined || !body) return finish(given);
        const ok = body.judge ? body.judge(given, step.answer) : answersMatch(given, step.answer);
        const gr = gate.getBoundingClientRect();
        const mark = h("span", { class: `cs-figgate-mark ${ok ? "right" : "wrong"}` });
        mark.style.left = `${gr.width / 2}px`;
        mark.style.top = `${gr.height / 2}px`;
        gate.appendChild(mark);
        hint.remove();
        resolve(ok ? step.answer : given);
        settled = true;
        unsubscribe();
        signal.removeEventListener("abort", onAbort);
        window.setTimeout(() => gate.remove(), CARD_LINGER_MS);
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
```

(Write the pinned line exactly as `const ok = body.judge ? body.judge(given, step.answer) : answersMatch(given, step.answer);` and `resolve(ok ? step.answer : given);`. If `AskGateStep` importing from `controls.ts` creates a cycle, move `AskGateStep` to `src/ui/gates.ts` and re-export it from `controls.ts`.)

`src/ui/controls.ts` dispatch (~line 983): `const widgetGate = widgetHost ? widgetGateFor(stage, hd, widgetHost) : null;` — this requires `widgetHost` to be created BEFORE the dispatch; move the `attachWidgetHost` call from Task 5 above the gate block (keep it after `attachChessPlay`'s guard is fine; ordering pin in Task 5 only requires it before `attachInfoCards`). Then the first branch:

```ts
  hd.timeline.askGate = (signal, step) =>
    step.widgetTemplate && widgetHost && widgetGate
      ? widgetGate(signal, step)
      : step.widget === "click"
        ? figureGate(signal, step)
        : …
```

Add `widgetTemplate?: true` to `AskGateStep` (~line 183).

- [ ] **Step 6: Lint**

`src/lint/lint.ts` union: add `/** an ask bound to the spec's template, whose document has no widget body */ | "widget"`. New function next to `lintCode`:

```ts
function lintWidget(spec: Spec): LintIssue[] {
  const issues: LintIssue[] = [];
  for (const cmd of spec.commands ?? []) {
    const w = cmd.ask?.widget;
    if (w === undefined || (BUILTIN_WIDGETS as readonly string[]).includes(w) || w !== spec.template) continue;
    if (!scenes[w]?.widget) {
      issues.push({ rule: "widget", ids: [], message: `ask widget: template "${w}" has no widget body — only a template document with a widget: body can answer an ask`, severity: "error" });
    }
  }
  return issues;
}
```

and in `lintCommands`: `const issues: LintIssue[] = [...lintSources(spec), ...lintCode(spec), ...lintWidget(spec)];`. Imports: `BUILTIN_WIDGETS` from `../spec/types`, `scenes` from `../scenes/registry` (check `lint.ts` does not already import from `scenes` in a way that cycles; `params-check.ts` imports the registry from lint-adjacent code already, so it is safe).

- [ ] **Step 7: Prompts and the pins**

`src/llm/prompts/compiler-v1.md` line 101 — append one sentence to the ask bullet, after the connect sentence: ` When the drawcast's template carries a widget body (its catalog entry says "widget"), `"widget": "<the template name>"` makes the figure itself the answer device: the viewer works it and the widget's own answer is judged; in movies the widget's demo performs it.`

`src/llm/prompts/author-v1.md` — a new section after "## The layout function body":

```
## The widget body (optional)

A template that the viewer should be able to WORK while the lesson is paused
(tap pads, toggle switches, move pieces) adds `"widget": "<a JavaScript
FUNCTION BODY>"`. It is the body of: new Function("kit"), and must
`return { init, on }` (optionally `demo` and `judge`):

- `init(scene) -> state` — plain JSON data; the host holds it and passes it back.
- `on(event, state, scene) -> { state, effects }` — the only event is
  `{type: "click", id, point, domain}` where `id` is one of the layout's
  top-level ids. Return the new state and a list of effects.
- `demo(scene, answer) -> effects` — the movie form: what the laser does to
  show the answer (taps as `{pointer: id}`, sounds beside them).
- `judge(given, answer) -> boolean` — when the ask's answer needs more than
  a trimmed, case-insensitive comparison.

Effects, one or more keys per object: `{patch: {param: value}}` changes the
template's params (the layout redraws — a widget NEVER draws, it patches
params you declared, so declare a param for every value the widget sets, with
"the widget sets this" in its description); `{sound: {hz, ms}}` or
`{sound: {notes: "C4:q"}}`; `{glow: id | [ids], color?}`; `{pointer: id}`;
`{caption: "text"}`; `{answer: "text"}` — what an ask bound to this template
judges. `scene` carries `ids`, `boxes` (id → {x,y,w,h}), `rings`, `params`,
`vars`, `toDomain(p)`, `toLogical(p)`. No DOM, no timers, no globals; state
is discarded when the lesson continues. Draw tappable parts with
`kit.pad(id, [x, y], "label", {r} | {w, h})`.
```

`tests/prompt-size.test.ts`: run the suite once to read the new measured sizes, then set both constants to the measured values and append to the changelog comment:

```
// Re-pinned 2026-09-14 for the widget-bodies round (Task 6): ask.widget lost
// its enum and gained one sentence (a template with a widget body may be the
// device), and the ask bullet in compiler-v1.md gained the same sentence —
// schema <old> → <new>, system <old> → <new>. The author prompt (author-v1.md,
// on-demand only) grew a section; it is not part of these pins.
```

- [ ] **Step 8: Run everything**

Run: `npx vitest run tests/widget-ask.test.ts tests/widget-lint.test.ts tests/prompt-size.test.ts tests/code-element.test.ts tests/ask*.test.ts && npx tsc --noEmit`
Expected: PASS, tsc clean. Then `npx vitest run` — any test pinning the old widget enum (grep `"click" | "piano"` in `tests/`) is updated to the string form.

- [ ] **Step 9: Commit**

```bash
git add src/spec/types.ts src/spec/schema.ts src/render/plan.ts src/render/player.ts src/render/widget-demo.ts src/render/index.ts src/ui/widget-host.ts src/ui/controls.ts src/lint/lint.ts src/llm/prompts/compiler-v1.md src/llm/prompts/author-v1.md tests/prompt-size.test.ts tests/widget-ask.test.ts tests/widget-lint.test.ts
git commit -m "Widget bodies: ask.widget may name the template — schema, plan flag, the widget gate (judge or answersMatch, resolves a string), the movie demo through widgetDemo, the widget lint, the prompt sentence and the author section, pins re-pinned (Task 6)"
```

---

### Task 7: The `widgets` pack — Morse key, Tower of Hanoi, logic gates — examples, gate, docs

**Files:**
- Create: `src/scenes/packs/widgets.yaml`
- Modify: `src/scenes/packs.ts` (`PACK_DEFS`: add `widgets`)
- Modify: `src/examples.json` (append three entries), `tests/examples.test.ts` (widget smoke per ready template with a widget body)
- Modify: `public/help.html` (~line 365: the widget row), `ROADMAP.md` (new section after "Code controls")
- Create: `docs/superpowers/plans/2026-09-14-widget-bodies-smoke.md`
- Test: the examples gate

**Interfaces:**
- Consumes: `runWidget` (Task 4); `kit.pad`, `kit.MORSE`, `kit.stamp` (Task 2).

- [ ] **Step 1: Extend the examples gate first (failing)**

Append to `tests/examples.test.ts` inside the describe:

```ts
  // A template that can be WORKED must survive being worked: one click on
  // every part at the example's params, no error, no dropped effect.
  test("every ready template with a widget body runs clean under one click per part", () => {
    for (const s of Object.values(scenes)) {
      if (s.manifest.status !== "ready" || !s.widget) continue;
      for (const ex of s.manifest.examples) {
        const scene = buildWidgetScene(s, ex.params);
        expect(scene, s.manifest.name).not.toBeNull();
        const run = runWidget(s, ex.params, scene!.ids);
        expect(run.errors, `${s.manifest.name} ${ex.request}`).toEqual([]);
      }
    }
  });
  test("the widgets pack ships at least three worked widgets", () => {
    expect(Object.values(scenes).filter((s) => s.manifest.status === "ready" && s.widget).length).toBeGreaterThanOrEqual(3);
  });
```

Imports: `import { runWidget } from "../src/scenes/widget-run"; import { buildWidgetScene } from "../src/scenes/widget-scene";`.

Run: `npx vitest run tests/examples.test.ts` — Expected: the "at least three" test FAILS.

- [ ] **Step 2: The pack**

`src/scenes/packs.ts` `PACK_DEFS`, after `hta` (or at the end):

```ts
  widgets: {
    id: "widgets",
    title: "Widgets",
    description: "Figures the viewer can work while paused — a Morse key, the Tower of Hanoi, logic gates — each a template document with a widget body; the models for writing your own.",
    load: async () => (await import("./packs/widgets.yaml?raw")).default,
  },
```

`src/scenes/packs/widgets.yaml` — the header, then three documents. The Morse document is the spec §2.1 one; write `chartRows` inline in the layout (a helper function defined inside the body):

```yaml
pack: widgets
title: Widgets
description: Figures the viewer can work while paused — templates with a widget body.
---
template: morse_key
title: Morse code key
version: 1
kit: 10
status: ready
description: >-
  A telegraph key with a dot pad and a dash pad, the sent signal as a strip of
  dots and dashes, the decoded letters, and a small code chart with one word
  highlighted. The viewer can tap the pads while paused (each sounds); an ask
  bound to this template can require a word. Choose this for ANY request about
  Morse code, telegraphy, SOS, or dots and dashes.
params:
  type: object
  properties:
    word:
      type: string
      description: "Word the chart highlights and the lesson is about, e.g. SOS (default SOS)."
    chart:
      type: boolean
      description: "Show the code chart (default true)."
    signal:
      type: string
      description: "Sent signal so far — the widget sets this; leave empty."
    decoded:
      type: string
      description: "Decoded letters so far — the widget sets this; leave empty."
element_ids:
  key_dot: the dot pad (tap to send a dot)
  key_dash: the dash pad (tap to send a dash)
  key_gap: the gap pad (tap to end a letter)
  signal: the strip of sent dots and dashes
  decoded: the decoded letters
  chart: the code chart (a group; chart_<letter> per row)
  title: the title
examples:
  - request: "Teach Morse code and let me send SOS."
    params: { word: "SOS" }
  - request: "Show the Morse alphabet."
    params: { word: "HELLO", chart: true }
layout: |
  const C = kit.COLORS;
  const word = (typeof params.word === "string" && params.word.trim() !== "" ? params.word : "SOS").toUpperCase();
  const drawables = [], labels = [], anchors = {}, order = [];
  const push = (d) => { drawables.push(d); order.push(d.id); };
  push(kit.text("title", [500, 700], "Morse code", { fontSize: 30 }));
  push(kit.pad("key_dot", [300, 150], "·", { r: 42 }));
  push(kit.pad("key_dash", [430, 150], "−", { r: 42 }));
  push(kit.pad("key_gap", [580, 150], "gap", { w: 100, h: 64 }));
  push(kit.text("signal", [500, 260], params.signal ?? "", { fontSize: 44, color: C.demand }));
  push(kit.text("decoded", [500, 330], params.decoded ?? "", { fontSize: 34 }));
  if (params.chart !== false) {
    const letters = Object.keys(kit.MORSE).filter((k) => /[A-Z]/.test(k));
    const cols = 4, rows = Math.ceil(letters.length / cols);
    const x0 = 120, y0 = 640, dx = 210, dy = 34;
    const children = letters.map((L, i) => {
      const x = x0 + (i % cols) * dx, y = y0 - Math.floor(i / cols) * dy;
      const hot = word.includes(L);
      return kit.text("chart_" + L.toLowerCase(), [x, y], L + "  " + kit.MORSE[L], { fontSize: 18, color: hot ? C.demand : C.guide });
    });
    push(kit.group("chart", children));
    anchors.chart = [500, y0 - (rows * dy) / 2];
  }
  anchors.key_dot = [300, 150]; anchors.key_dash = [430, 150]; anchors.key_gap = [580, 150];
  return { drawables, labels, anchors, order };
widget: |
  const CODE = kit.MORSE;
  const decode = (s) => Object.keys(CODE).find((k) => CODE[k] === s) ?? "?";
  const same = (state) => ({ state, effects: [] });
  const beep = (sym) => ({ sound: { hz: 700, ms: sym === "." ? 80 : 240 } });
  const init = () => ({ signal: "", letter: "", text: "" });
  const on = (ev, st) => {
    if (ev.type !== "click") return same(st);
    if (ev.id === "key_dot" || ev.id === "key_dash") {
      const sym = ev.id === "key_dot" ? "." : "-";
      const next = { ...st, signal: st.signal + sym, letter: st.letter + sym };
      return { state: next, effects: [beep(sym), { patch: { signal: next.signal } }] };
    }
    if (ev.id === "key_gap") {
      if (st.letter === "") return same(st);
      const next = { ...st, letter: "", text: st.text + decode(st.letter), signal: st.signal + " " };
      return { state: next, effects: [{ patch: { signal: next.signal, decoded: next.text } }, { answer: next.text }] };
    }
    return same(st);
  };
  const demo = (scene, answer) => [...answer.toUpperCase()].flatMap((ch) =>
    [...(CODE[ch] ?? "")].map((sym) => ({ pointer: sym === "." ? "key_dot" : "key_dash", ...beep(sym) })).concat([{ pointer: "key_gap" }]));
  const judge = (given, answer) => given.trim().toUpperCase() === answer.trim().toUpperCase();
  return { init, on, demo, judge };
---
template: tower_of_hanoi
title: Tower of Hanoi
version: 1
kit: 10
status: ready
description: >-
  The Tower of Hanoi puzzle: three pegs and a stack of disks that must move
  one at a time, never a larger disk onto a smaller one. The viewer can play
  it while paused (click a peg to pick up its top disk, another to put it
  down); an ask bound to this template can require the puzzle to be solved.
  Choose this for ANY request about the Tower of Hanoi, recursion puzzles or
  the 2^n − 1 moves.
params:
  type: object
  properties:
    disks:
      type: integer
      description: "Number of disks, 3–5 (default 3)."
    pegs:
      type: string
      description: "Peg contents bottom→top, pegs separated by | (e.g. \"321||\") — the widget sets this; leave empty for the start."
    moves:
      type: integer
      description: "Moves made so far — the widget sets this; leave empty."
element_ids:
  peg_0: the left peg with its disks (a group)
  peg_1: the middle peg with its disks (a group)
  peg_2: the right peg with its disks (a group)
  counter: the move counter
  title: the title
examples:
  - request: "The Tower of Hanoi puzzle with three disks."
    params: { disks: 3 }
  - request: "Show a four-disk Tower of Hanoi."
    params: { disks: 4 }
layout: |
  const C = kit.COLORS;
  const n = Math.min(5, Math.max(3, Number.isInteger(params.disks) ? params.disks : 3));
  const start = Array.from({ length: n }, (_, i) => String(n - i)).join("") + "||";
  const pegs = (typeof params.pegs === "string" && params.pegs.split("|").length === 3 ? params.pegs : start).split("|");
  const drawables = [], labels = [], anchors = {}, order = [];
  const push = (d) => { drawables.push(d); order.push(d.id); };
  push(kit.text("title", [500, 700], "Tower of Hanoi", { fontSize: 30 }));
  const X = [220, 500, 780], BASE = 180, H = 24, MAXW = 200;
  pegs.forEach((stack, p) => {
    const children = [
      kit.stroke("peg_" + p + "__base", [[X[p] - 120, BASE], [X[p] + 120, BASE]], { strokeWidth: 4 }),
      kit.stroke("peg_" + p + "__pole", [[X[p], BASE], [X[p], BASE + 200]], { strokeWidth: 4 }),
    ];
    [...stack].forEach((d, i) => {
      const w = MAXW * (Number(d) / n), y = BASE + i * H;
      children.push(kit.stroke("peg_" + p + "__disk_" + d, kit.rect(X[p] - w / 2, y, w, H - 4), { closed: true, fill: C.series[(Number(d) - 1) % C.series.length], strokeWidth: 2 }));
    });
    push(kit.group("peg_" + p, children));
    anchors["peg_" + p] = [X[p], BASE + 100];
  });
  push(kit.text("counter", [500, 120], "moves: " + (Number.isInteger(params.moves) ? params.moves : 0), { fontSize: 22, color: C.guide }));
  return { drawables, labels, anchors, order };
widget: |
  const same = (state) => ({ state, effects: [] });
  const encode = (pegs) => pegs.map((s) => s.join("")).join("|");
  const init = (scene) => {
    const raw = typeof scene.params.pegs === "string" && scene.params.pegs.split("|").length === 3 ? scene.params.pegs : null;
    const n = Math.min(5, Math.max(3, Number.isInteger(scene.params.disks) ? scene.params.disks : 3));
    const pegs = raw ? raw.split("|").map((s) => [...s]) : [Array.from({ length: n }, (_, i) => String(n - i)), [], []];
    return { pegs, selected: null, moves: Number.isInteger(scene.params.moves) ? scene.params.moves : 0, n };
  };
  const on = (ev, st) => {
    const m = /^peg_(\d)$/.exec(ev.id);
    if (!m) return same(st);
    const p = Number(m[1]);
    if (st.selected === null) {
      if (st.pegs[p].length === 0) return same(st);
      return { state: { ...st, selected: p }, effects: [{ glow: "peg_" + p }] };
    }
    if (st.selected === p) return { state: { ...st, selected: null }, effects: [] };
    const from = st.pegs[st.selected], to = st.pegs[p];
    const disk = from[from.length - 1];
    if (to.length > 0 && Number(to[to.length - 1]) < Number(disk)) {
      return { state: { ...st, selected: null }, effects: [{ glow: "peg_" + p, color: "#b23a3a" }, { caption: "A larger disk may not go on a smaller one." }] };
    }
    const pegs = st.pegs.map((s, i) => (i === st.selected ? s.slice(0, -1) : i === p ? [...s, disk] : s));
    const moves = st.moves + 1;
    const solved = pegs[2].length === st.n;
    const effects = [{ patch: { pegs: encode(pegs), moves } }];
    if (solved) effects.push({ glow: "peg_2", color: "#4a7c59" }, { caption: "Solved in " + moves + " moves." }, { answer: "solved" });
    return { state: { ...st, pegs, selected: null, moves }, effects };
  };
  const demo = (scene, answer) => {
    const n = Math.min(5, Math.max(3, Number.isInteger(scene.params.disks) ? scene.params.disks : 3));
    const taps = [];
    const hanoi = (k, from, to, via) => { if (k === 0) return; hanoi(k - 1, from, via, to); taps.push({ pointer: "peg_" + from }, { pointer: "peg_" + to }); hanoi(k - 1, via, to, from); };
    hanoi(n, 0, 2, 1);
    return taps.slice(0, 14);
  };
  const judge = (given, answer) => given === "solved";
  return { init, on, demo, judge };
---
template: logic_gates
title: Logic gate
version: 1
kit: 10
status: ready
description: >-
  One logic gate (AND, OR, XOR or NAND) with two input switches and a bulb:
  the bulb lights when the gate's output is 1. The viewer can flip the
  switches while paused and watch the bulb; an ask bound to this template
  can require an input that lights it. Choose this for ANY request about a
  single logic gate, a truth table shown on a circuit, or Boolean AND/OR/XOR.
params:
  type: object
  properties:
    gate:
      type: string
      enum: [AND, OR, XOR, NAND]
      description: "The gate (default AND)."
    a:
      type: boolean
      description: "Input A on/off — the widget sets this; default false."
    b:
      type: boolean
      description: "Input B on/off — the widget sets this; default false."
element_ids:
  switch_a: input A's switch pad (tap to flip)
  switch_b: input B's switch pad (tap to flip)
  gate: the gate body with its name
  bulb: the output bulb (lit when the output is 1)
  wires: the wiring (a group)
  title: the title
examples:
  - request: "How an XOR gate works."
    params: { gate: "XOR" }
  - request: "Show an AND gate with two switches and a bulb."
    params: { gate: "AND" }
layout: |
  const C = kit.COLORS;
  const gate = ["AND", "OR", "XOR", "NAND"].includes(params.gate) ? params.gate : "AND";
  const a = params.a === true, b = params.b === true;
  const out = gate === "AND" ? a && b : gate === "OR" ? a || b : gate === "XOR" ? a !== b : !(a && b);
  const drawables = [], labels = [], anchors = {}, order = [];
  const push = (d) => { drawables.push(d); order.push(d.id); };
  push(kit.text("title", [500, 700], gate + " gate", { fontSize: 30 }));
  push(kit.pad("switch_a", [180, 460], "A = " + (a ? 1 : 0), { w: 150, h: 64, fill: a ? C.series[2] : undefined }));
  push(kit.pad("switch_b", [180, 300], "B = " + (b ? 1 : 0), { w: 150, h: 64, fill: b ? C.series[2] : undefined }));
  push(kit.group("wires", [
    kit.stroke("wires__a", [[255, 460], [400, 460], [400, 410]], { strokeWidth: 3 }),
    kit.stroke("wires__b", [[255, 300], [400, 300], [400, 350]], { strokeWidth: 3 }),
    kit.stroke("wires__out", [[600, 380], [700, 380]], { strokeWidth: 3 }),
  ]));
  push(kit.group("gate", [
    kit.stroke("gate__body", kit.rect(400, 320, 200, 120), { closed: true, fill: kit.GROUND, strokeWidth: 3 }),
    kit.text("gate__name", [500, 380], gate, { fontSize: 32 }),
  ]));
  const bulb = kit.stamp("bulb", [780, 380], { scale: 60 });
  const lit = kit.area("bulb__lit", kit.circle([780, 380], 40), out ? "#f2c94c" : kit.GROUND, { opacity: out ? 0.9 : 0.0, precise: true });
  push(kit.group("bulb", [lit, ...bulb.drawables]));
  anchors.bulb = [780, 380]; anchors.switch_a = [180, 460]; anchors.switch_b = [180, 300];
  return { drawables, labels, anchors, order };
widget: |
  const same = (state) => ({ state, effects: [] });
  const table = (gate, a, b) => gate === "AND" ? a && b : gate === "OR" ? a || b : gate === "XOR" ? a !== b : !(a && b);
  const init = (scene) => ({ a: scene.params.a === true, b: scene.params.b === true, gate: ["AND", "OR", "XOR", "NAND"].includes(scene.params.gate) ? scene.params.gate : "AND" });
  const on = (ev, st) => {
    if (ev.id !== "switch_a" && ev.id !== "switch_b") return same(st);
    const next = { ...st, [ev.id === "switch_a" ? "a" : "b"]: !(ev.id === "switch_a" ? st.a : st.b) };
    const out = table(next.gate, next.a, next.b);
    const effects = [{ sound: { hz: 520, ms: 60 } }, { patch: { a: next.a, b: next.b } }, { caption: "A=" + (next.a ? 1 : 0) + ", B=" + (next.b ? 1 : 0) + " → " + (out ? 1 : 0) }];
    if (out) effects.push({ glow: "bulb", color: "#4a7c59" }, { answer: "lit" });
    return { state: next, effects };
  };
  const demo = (scene, answer) => {
    const gate = ["AND", "OR", "XOR", "NAND"].includes(scene.params.gate) ? scene.params.gate : "AND";
    const taps = [];
    if (table(gate, true, false)) taps.push({ pointer: "switch_a" });
    else if (table(gate, true, true)) taps.push({ pointer: "switch_a" }, { pointer: "switch_b" });
    else taps.push({ pointer: "switch_a" });
    return taps.concat([{ glow: "bulb", color: "#4a7c59" }]);
  };
  return { init, on, demo };
```

Check `kit.stamp`'s option name for size (`StampOpts` in `kit.ts` ~line 200) and use the real one; check `kit.text`'s centring; keep every coordinate inside 1000×750 and above y = 60. Run `npx vitest run tests/examples.test.ts` after each document and fix any lint issue (overlaps, out-of-canvas) until the gate is clean.

- [ ] **Step 3: The three examples**

Append to `src/examples.json` (playlist-less specs, `packs: ["widgets"]`):

```json
  {
    "request": "Teach Morse code and let me send SOS.",
    "packs": ["widgets"],
    "spec": {
      "title": "Sending SOS",
      "template": "morse_key",
      "params": { "word": "SOS" },
      "commands": [
        { "draw": "title", "speak": "Morse code spells letters with two sounds: a short dot and a long dash." },
        { "draw": "chart", "speak": "Every letter has its own pattern. S is three dots; O is three dashes." },
        { "draw": ["key_dot", "key_dash", "key_gap"], "speak": "A telegraph key sends them. Here it is as three pads: dot, dash, and a gap that ends a letter." },
        { "draw": ["signal", "decoded"] },
        { "point": "key_dot", "speak": "Tap the dot pad three times for S, the gap, then the dash pad three times for O." },
        { "ask": { "question": "Send SOS on the key.", "widget": "morse_key", "answer": "SOS", "right": "Three short, three long, three short — the signal every radio operator knows.", "wrong": "Not quite — end each letter with the gap pad." } }
      ]
    }
  },
  {
    "request": "The Tower of Hanoi puzzle with three disks.",
    "packs": ["widgets"],
    "spec": {
      "title": "The Tower of Hanoi",
      "template": "tower_of_hanoi",
      "params": { "disks": 3 },
      "commands": [
        { "draw": "title", "speak": "Three pegs, three disks, one rule: never put a larger disk on a smaller one." },
        { "draw": ["peg_0", "peg_1", "peg_2"], "speak": "Move the whole tower from the left peg to the right, one disk at a time." },
        { "draw": "counter", "speak": "With three disks the fewest moves is seven — two to the power of three, minus one." },
        { "ask": { "question": "Move the tower to the right peg.", "widget": "tower_of_hanoi", "answer": "solved", "right": "Solved. Notice the pattern: move the smaller tower aside, the big disk over, the smaller tower back on top.", "wrong": "Keep going — click a peg to lift its top disk, another to set it down." } }
      ]
    }
  },
  {
    "request": "How an XOR gate works.",
    "packs": ["widgets"],
    "spec": {
      "title": "The XOR gate",
      "template": "logic_gates",
      "params": { "gate": "XOR" },
      "commands": [
        { "draw": "title", "speak": "XOR means exclusive or: one input or the other, but not both." },
        { "draw": ["switch_a", "switch_b", "wires", "gate"], "speak": "Two switches feed the gate." },
        { "draw": "bulb", "speak": "The bulb lights when the gate's output is one." },
        { "ask": { "question": "Find an input that lights the bulb.", "widget": "logic_gates", "answer": "lit", "right": "Exactly one switch on — that is what exclusive means.", "wrong": "Flip a switch and watch the bulb." } }
      ]
    }
  }
```

(Check the `draw` verb's accepted forms in `compiler-v1.md`'s verb list — an array of ids or `draw: id`. If arrays are not allowed, use one `draw` per id.)

- [ ] **Step 4: Run the gate**

Run: `npx vitest run tests/examples.test.ts tests/prompt-size.test.ts`
Expected: PASS (zero warnings, zero lint, the widget smoke clean, the "every ready template has an example" coverage satisfied). The catalog grows by three templates; if `prompt-size` fails on the system pin, re-pin with a note "three widget templates in the catalog" and the measured delta.

- [ ] **Step 5: Help, roadmap, smoke checklist**

`public/help.html` ~line 365 — append to the widget row's cell: ` A template with a <em>widget body</em> (Morse key, Tower of Hanoi, logic gate — the Widgets pack) can be the device too: <code>widget: morse_key</code> lets the viewer work the figure and the widget's own answer is judged; paused, such a figure is always playable.`

`ROADMAP.md` — after the "Code controls — done 2026-09-14" section:

```
## Widget bodies — done 2026-09-14

Spec `docs/superpowers/specs/2026-09-14-widget-bodies-design.md`, plan
`docs/superpowers/plans/2026-09-14-widget-bodies.md`. A template document may
carry `widget: |` — a JS function body returning `{init, on, demo?, judge?}`
— compiled once into a factory (`SceneModule.widget`). While paused, a click
on one of the template's parts runs `on` and the host (`src/ui/widget-host.ts`)
performs the effects: `patch` (params → `previewParams`), `sound`
(`ToneLike.beep` or notes), `glow`, `pointer`, `caption`, `answer`. Nothing
persists: state and patches die on play, step, scrub and Continue. `ask.widget`
may name the spec's template: the widget gate judges the next `answer` effect
(`judge` or `answersMatch`) and resolves a string like every gate; the movie
performs `demo` through `Player.widgetDemo`. Pure core in
`src/scenes/widget-{types,scene,effects,run}.ts` — `runWidget` is the node
harness authors test with and the examples gate runs. Kit v10: `circle`,
`rect`, `pad`, `MORSE`. Pack `widgets`: morse_key, tower_of_hanoi,
logic_gates. Round 2 of "users extend drawcast themselves".

Open: `run`/`result` (a widget executing a code element); `key`, `tick`,
press duration; anchors on the scene object; a ⊕ pill / context-menu launcher
for free play (tray.ts); Python/R widget bodies; the tray-vs-widget preview
collision (last writer wins); a widget the author prompt writes on demand has
not been exercised end to end.
```

`docs/superpowers/plans/2026-09-14-widget-bodies-smoke.md`:

```
# Widget bodies — smoke checklist (Hans)

Open Examples → Widgets pack.

1. "Teach Morse code and let me send SOS." Play; pause on the pads. Tap dot
   three times: three short beeps, the strip shows "...". Tap gap: the
   decoded line shows "S". Continue ▸ — the strip is empty again.
2. Play to the ask. Send S O S with gaps: green mark, the right line. Reload,
   send "SOO": red mark, the wrong line, the reveal.
3. Export the movie (or play with the response channel closed): the laser
   taps dot·dot·dot gap dash·dash·dash gap dot·dot·dot gap, each with its
   tone.
4. "The Tower of Hanoi puzzle with three disks." Paused: click the left peg
   (it glows), click the middle peg — the small disk moves, counter reads 1.
   Try a big disk onto a small one: red glow and the caption. Solve it: the
   right peg glows green, the ask is satisfied.
5. "How an XOR gate works." Paused: flip A — the bulb lights, the caption
   reads A=1, B=0 → 1. Flip B — it goes out. The ask accepts the lit state.
6. A pad never opens the info card; a click on the paper still resumes.
7. Scrub while a widget has state: the figure returns to the storyboard.
```

- [ ] **Step 6: Run the whole suite and tsc**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all green, tsc clean.

- [ ] **Step 7: Commit**

```bash
git add src/scenes/packs/widgets.yaml src/scenes/packs.ts src/examples.json tests/examples.test.ts public/help.html ROADMAP.md docs/superpowers/plans/2026-09-14-widget-bodies-smoke.md
git commit -m "Widget bodies: the widgets pack — a Morse key, the Tower of Hanoi, a logic gate — three examples, the examples gate works every widget, help, roadmap, smoke checklist (Task 7)"
```

---

### Task 8: Merge main, verify, push

**Files:** none new.

- [ ] **Step 1: Merge main**

```bash
git fetch origin
git merge origin/main
```

Resolve conflicts. Expected conflict spots: `tests/prompt-size.test.ts` (both rounds re-pin — keep both changelog notes, then RE-MEASURE: run the test, set both constants to the measured values), `src/examples.json` (both append — keep both), `ROADMAP.md` (both append — keep both sections), `src/lint/lint.ts` union (keep both members), `src/spec/types.ts` / `schema.ts` (different regions — keep both). Never pick a side on a pin.

- [ ] **Step 2: Verify**

```bash
npm test
npx tsc --noEmit
npm run build
```

Expected: all green. If `npm test` fails on the pins after the merge, re-pin with a dated note and re-run.

- [ ] **Step 3: Push**

```bash
git push -u origin worktree-widgets
git ls-remote --heads origin worktree-widgets
```

Report the branch, the test count, and that the smoke checklist (`docs/superpowers/plans/2026-09-14-widget-bodies-smoke.md`) awaits Hans before merge to main.
