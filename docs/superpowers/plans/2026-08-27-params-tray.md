# Params Tray (Interactivity Round 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A ⊕ button on the player control bar opens a tray of sliders (auto-derived from the template's numeric params) that live-preview the figure while paused, with an explicit "Continue ▶" that restores the exact boundary state and resumes.

**Architecture:** A pure schema-walk (`sliderSpecs`) derives sliders from `params_schema` entries that declare standard JSON-Schema `minimum`/`maximum`; a new public `Player.previewParams()` paints overrides via the existing `Reprojector.frame` and sets `geometryDirty` so the existing `renderUpTo(position)` restores the boundary honestly; a DOM tray (`src/ui/tray.ts`) mounts per item from `onItemMounted` exactly like the ⬡ 3D button. Movie export and `<drawcast-figure>` never mount controls, so the tray can never appear in recordings.

**Tech Stack:** TypeScript, vite, vitest (node env — DOM code stays out of node-tested modules).

**Spec:** `docs/superpowers/specs/2026-08-27-interactivity-principles.md` (§6 intrinsic capabilities — auto sliders; §7 UI model — pause is the door, tray under the control bar, explicit resume; §12 round 1).

## Global Constraints

- The timeline never waits on a response; the tray only ever pauses/resumes (spec §3).
- Playing = clean: no tray, no markers while playing; the tray opening pauses playback (spec §7.1).
- Movie export untouched: no imports from `src/ui/` into `src/export/` or `src/render/` (spec §5; export isolation confirmed — `src/export/video.ts` mounts no controls).
- Resume is explicit: "Continue ▶" (spec §7.5).
- Node test env has no DOM: pure logic lives in `src/ui/tray-model.ts` (tested), DOM wiring in `src/ui/tray.ts` (not node-tested; verified by tsc/build + manual smoke, same convention as controls.ts).
- Repo norms: no `package-lock.json`; run `npx tsc && npm test` before each commit (never pipe tsc through tail); check `git log --oneline -2` right before each commit — parallel sessions commit to this repo (2026-08-25 collision).

---

### Task 1: Slider derivation model (`sliderSpecs`)

**Files:**
- Create: `src/ui/tray-model.ts`
- Test: `tests/tray-model.test.ts`

**Interfaces:**
- Consumes: nothing (pure; input is a `params_schema` blob, `scenes[id].manifest.params_schema` at call sites).
- Produces: `interface SliderSpec { path: string; label: string; min: number; max: number; step: number | "any" }` and `function sliderSpecs(schema: unknown): SliderSpec[]` — Task 4 consumes both.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/tray-model.test.ts
import { describe, expect, test } from "vitest";
import { sliderSpecs } from "../src/ui/tray-model";

describe("sliderSpecs", () => {
  test("finds a top-level bounded number", () => {
    const schema = { type: "object", properties: { n: { type: "number", minimum: 1, maximum: 100, multipleOf: 1 } } };
    expect(sliderSpecs(schema)).toEqual([{ path: "n", label: "n", min: 1, max: 100, step: 1 }]);
  });

  test("walks nested objects into dot paths", () => {
    const schema = {
      type: "object",
      properties: {
        demand_shift: { type: "object", properties: { amount: { type: "number", minimum: -93, maximum: 95 } } },
      },
    };
    expect(sliderSpecs(schema)).toEqual([{ path: "demand_shift.amount", label: "amount", min: -93, max: 95, step: "any" }]);
  });

  test("takes the number branch of a oneOf", () => {
    const schema = {
      type: "object",
      properties: {
        steepness: { oneOf: [{ type: "string", enum: ["flat", "steep"] }, { type: "number", minimum: 0.25, maximum: 2.5 }] },
      },
    };
    expect(sliderSpecs(schema)).toEqual([{ path: "steepness", label: "steepness", min: 0.25, max: 2.5, step: "any" }]);
  });

  test("skips numbers without both bounds, degenerate ranges, and non-schemas", () => {
    const schema = {
      type: "object",
      properties: {
        unbounded: { type: "number" },
        onlyMin: { type: "number", minimum: 0 },
        empty: { type: "number", minimum: 5, maximum: 5 },
        label: { type: "string" },
      },
    };
    expect(sliderSpecs(schema)).toEqual([]);
    expect(sliderSpecs(null)).toEqual([]);
    expect(sliderSpecs("nope")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/tray-model.test.ts`
Expected: FAIL — cannot resolve `../src/ui/tray-model`.

- [ ] **Step 3: Implement**

```ts
// src/ui/tray-model.ts
// Pure derivation of explore-sliders from a template's params_schema: any
// number that declares BOTH standard JSON-Schema bounds (minimum/maximum)
// becomes a slider. No bounds, no slider — ranges are never guessed from
// prose. Kept DOM-free so node tests can cover it (tray.ts is the DOM half).

export interface SliderSpec {
  path: string;
  label: string;
  min: number;
  max: number;
  step: number | "any";
}

interface SchemaNode {
  type?: unknown;
  properties?: Record<string, unknown>;
  oneOf?: unknown[];
  minimum?: unknown;
  maximum?: unknown;
  multipleOf?: unknown;
}

function boundedNumber(node: SchemaNode): { min: number; max: number; step: number | "any" } | null {
  if (node.type === "number" && typeof node.minimum === "number" && typeof node.maximum === "number" && node.maximum > node.minimum) {
    return { min: node.minimum, max: node.maximum, step: typeof node.multipleOf === "number" ? node.multipleOf : "any" };
  }
  return null;
}

export function sliderSpecs(schema: unknown): SliderSpec[] {
  const out: SliderSpec[] = [];
  const walk = (node: unknown, path: string): void => {
    if (typeof node !== "object" || node === null) return;
    const n = node as SchemaNode;
    const own = boundedNumber(n) ?? (Array.isArray(n.oneOf) ? n.oneOf.map((b) => boundedNumber((b ?? {}) as SchemaNode)).find(Boolean) ?? null : null);
    if (own && path) {
      out.push({ path, label: path.split(".").at(-1)!, ...own });
      return;
    }
    if (typeof n.properties === "object" && n.properties !== null) {
      for (const [key, child] of Object.entries(n.properties)) walk(child, path ? `${path}.${key}` : key);
    }
  };
  walk(schema, "");
  return out;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/tray-model.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
cd /Users/hom/Documents/GitHub/drawcast && git log --oneline -2 && npx tsc && npx vitest run tests/tray-model.test.ts && git add src/ui/tray-model.ts tests/tray-model.test.ts && git commit -m "Derive explore-sliders from params_schema bounds"
```

---

### Task 2: `Player.previewParams` (the honest-restore seam)

**Files:**
- Modify: `src/render/player.ts` (next to `applyParams`, ~line 241)
- Test: `tests/preview-params.test.ts`

**Interfaces:**
- Consumes: existing private `stateAt`, public `reprojector`, private `geometryDirty` (all inside Player).
- Produces: `previewParams(overrides: Record<string, number>): void` on Player — Task 4 calls `hd.timeline.previewParams(...)` and restores with the existing `hd.timeline.renderUpTo(hd.timeline.position)`.

**Why:** calling `reprojector.frame()` from outside leaves `geometryDirty === false`, so a later `renderUpTo(position)` early-returns out of the commit (player.ts:243) and the preview geometry sticks. The method must set the flag itself.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/preview-params.test.ts
// Slider preview must paint boundary+overrides via reprojector.frame and mark
// geometry dirty so renderUpTo(position) commits the boundary back even though
// its params compare equal (the stuck-preview regression class).
import { describe, expect, test } from "vitest";
import { Player, type Reprojector } from "../src/render/player";
import { planCommands } from "../src/render/plan";
import { SilentSpeech } from "../src/render/speech";
import type { RenderedElement } from "../src/render/backend";

function makeReprojector() {
  const frames: Record<string, number>[] = [];
  const commits: Record<string, number>[] = [];
  const rp: Reprojector = {
    frame: (p) => frames.push({ ...p }),
    commit: (p) => {
      commits.push({ ...p });
      return new Map<string, RenderedElement>();
    },
  };
  return { rp, frames, commits };
}

const BASE = { demand_shift: { amount: 0 } };

function makePlayer() {
  const plan = planCommands([{ draw: ["demand"] }], ["demand"], { animateBase: BASE });
  const el: RenderedElement = { id: "demand", durationMs: 0, setProgress: () => {}, finish: () => {}, hide: () => {} } as unknown as RenderedElement;
  return new Player(plan, new Map([["demand", el]]), new SilentSpeech(), null, { mode: "silent" });
}

describe("previewParams", () => {
  test("paints boundary params merged with overrides", () => {
    const player = makePlayer();
    const { rp, frames } = makeReprojector();
    player.reprojector = rp;
    player.renderUpTo(1);
    player.previewParams({ "demand_shift.amount": 40 });
    expect(frames.at(-1)).toEqual({ "demand_shift.amount": 40 });
  });

  test("renderUpTo(position) after a preview commits the boundary back", () => {
    const player = makePlayer();
    const { rp, commits } = makeReprojector();
    player.reprojector = rp;
    player.renderUpTo(1);
    const before = commits.length;
    player.previewParams({ "demand_shift.amount": 40 });
    player.renderUpTo(player.position);
    expect(commits.length).toBe(before + 1); // dirty flag forced the commit
    expect(commits.at(-1)).toEqual({});      // boundary has no overrides
  });

  test("no reprojector: previewParams is a no-op", () => {
    const player = makePlayer();
    expect(() => player.previewParams({ x: 1 })).not.toThrow();
  });
});
```

(If `planCommands`'s options argument or `SilentSpeech`'s home differs, copy the exact construction from `tests/animate.test.ts` — its `makeReprojector`/`BASE` are the model for this file.)

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/preview-params.test.ts`
Expected: FAIL — `player.previewParams is not a function`.

- [ ] **Step 3: Implement (in `src/render/player.ts`, directly under `applyParams`)**

```ts
  /**
   * Paint the current boundary with extra param overrides — the explore
   * tray's live slider preview. Cheap frame() geometry only (no handles);
   * marks geometry dirty so the next renderUpTo/applyParams commits honest
   * state even when the boundary's params compare equal to appliedParams.
   */
  previewParams(overrides: Record<string, number>): void {
    if (!this.reprojector) return;
    const scene = this.stateAt(this.completed);
    this.reprojector.frame({ ...scene.params, ...overrides }, new Set(scene.visible), scene.offsets);
    this.geometryDirty = true;
  }
```

- [ ] **Step 4: Run to verify pass, plus the neighboring suites**

Run: `npx vitest run tests/preview-params.test.ts tests/animate.test.ts tests/player-sync.test.ts`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/hom/Documents/GitHub/drawcast && git log --oneline -2 && npx tsc && npx vitest run tests/preview-params.test.ts tests/animate.test.ts && git add src/render/player.ts tests/preview-params.test.ts && git commit -m "Player.previewParams: slider preview that restores honestly"
```

---

### Task 3: Declare ranges in the flagship manifests

**Files:**
- Modify: `src/scenes/supply_demand/manifest.json` (`demand_shift.amount`, `supply_shift.amount`, the `oneOf` number branches of `demand.steepness` / `supply.steepness`)
- Modify: `src/scenes/packs/stats.yaml` (`sampling_dist.n`, `ci_dance.confidence`, `galton_board.rows`)
- Test: existing suite (catalog/fewshots/examples tests pin manifest content — they are the regression net here)

**Interfaces:**
- Produces: `minimum`/`maximum` (and `multipleOf` where integral) keys that Task 1's `sliderSpecs` picks up. Values MUST mirror the layout clamps exactly:
  - `demand_shift.amount` / `supply_shift.amount`: `"minimum": -93, "maximum": 95` (clamp at `src/scenes/supply_demand/layout.ts:131`)
  - `steepness` number branches: `"minimum": 0.25, "maximum": 2.5` (the prose's useful range; layout floor 0.05 stays the hard clamp)
  - `sampling_dist` `n`: `minimum: 1, maximum: 100, multipleOf: 1` (clamp at stats.yaml:312)
  - `ci_dance` `confidence`: `minimum: 0.5, maximum: 0.99` (clamp at stats.yaml:418)
  - `galton_board` `rows`: `minimum: 4, maximum: 12, multipleOf: 1` (clamp at stats.yaml:178)

- [ ] **Step 1: Check whether params_schema is enforced anywhere**

Run: `grep -rn "params_schema" src/ --include="*.ts" | grep -v scenes/types`
Read each hit: if any feeds ajv/validation of generated params, note it — the added bounds then also *validate* generations, which is acceptable only because the values mirror the layout clamps. If validation would REJECT values the bundled examples/fewshots use, widen the bound to cover them instead.

- [ ] **Step 2: Edit the manifests**

Add the keys listed above to each entry, keeping every existing key (`type`, `description`, `oneOf` shape) untouched. Example, `demand_shift.amount`:

```json
"amount": {
  "type": "number",
  "minimum": -93,
  "maximum": 95,
  "description": "Signed horizontal shift in domain units (0–100 axis). ..."
}
```

- [ ] **Step 3: Run the full suite**

Run: `npx tsc && npm test`
Expected: catalog/prompt-pinning tests may fail on changed manifest bytes. Update ONLY fixtures that literally snapshot catalog text; any failure that is a real behavior change gets investigated, not overwritten.

- [ ] **Step 4: Commit**

```bash
cd /Users/hom/Documents/GitHub/drawcast && git log --oneline -2 && git add -u src/scenes tests && git commit -m "Declare slider ranges on flagship numeric params"
```

---

### Task 4: The tray DOM (`src/ui/tray.ts` + styles)

**Files:**
- Create: `src/ui/tray.ts`
- Modify: `src/styles.css` (new block after `.pl-panel` rules, ~line 928)

**Interfaces:**
- Consumes: `sliderSpecs`/`SliderSpec` (Task 1), `hd.timeline.previewParams` (Task 2), `hd.timeline.renderUpTo/position/pause/play/state/callbacks`, `readParam`/`withOverrides` from `src/render/params.ts`, `scenes` from `src/scenes/registry.ts`, `INITIAL_STATE` from `src/render/plan.ts`, `h` from `src/ui/dom.ts` (check its exact export name in `src/ui/dom.ts` first — main.ts imports it).
- Produces: `attachParamsTray(host: HTMLElement, hd: RenderHandle): void` — Task 5 calls it from `onItemMounted`. Idempotent per mount (removes any existing `.cs-paramtray` / `.cs-tray-btn` in `host` first, same convention as controls.ts:61-63).

- [ ] **Step 1: Implement `src/ui/tray.ts`**

```ts
// The explore tray (interactivity round 1, spec §7): a ⊕ button on the
// control bar opens a strip of sliders under the bar. Opening pauses; every
// drag live-previews via Player.previewParams; "Continue ▶" restores the
// exact boundary and resumes. Playing (from anywhere) closes the tray.
// Never mounted by video export or <drawcast-figure> — they attach no
// controls — so none of this can appear in a recording.

import type { RenderHandle } from "../render";
import { INITIAL_STATE } from "../render/plan";
import { readParam, withOverrides } from "../render/params";
import { scenes } from "../scenes/registry";
import { h } from "./dom";
import { sliderSpecs, type SliderSpec } from "./tray-model";

/** Sliders whose param has a current numeric value in the mounted spec —
 *  a slider for a param the spec never set moves invisible geometry. */
function liveSliders(hd: RenderHandle): { spec: SliderSpec; value: number }[] {
  const tpl = hd.spec.template;
  if (!tpl) return [];
  const schema = scenes[tpl]?.manifest.params_schema;
  if (!schema) return [];
  const n = hd.timeline.position;
  const boundary = n > 0 ? hd.plan.states[n - 1] : INITIAL_STATE;
  const effective = withOverrides(hd.spec.params, boundary.params);
  return sliderSpecs(schema)
    .map((spec) => ({ spec, value: readParam(effective, spec.path) }))
    .filter((s): s is { spec: SliderSpec; value: number } => s.value !== null);
}

export function attachParamsTray(host: HTMLElement, hd: RenderHandle): void {
  host.querySelector(".cs-paramtray")?.remove();
  host.querySelector(".cs-tray-btn")?.remove();
  const bar = host.querySelector<HTMLElement>(".cs-controlbar");
  if (!bar) return; // no control bar (author preview, embeds): no tray
  if (liveSliders(hd).length === 0) return;

  const tray = h("div", { class: "cs-paramtray", hidden: "" });
  tray.addEventListener("click", (e) => e.stopPropagation());
  bar.insertAdjacentElement("afterend", tray);

  const overrides: Record<string, number> = {};

  const close = (): void => {
    tray.hidden = true;
    trayBtn.classList.remove("open");
  };

  const restore = (): void => {
    for (const k of Object.keys(overrides)) delete overrides[k];
    hd.timeline.renderUpTo(hd.timeline.position);
  };

  const open = (): void => {
    hd.timeline.pause();
    tray.replaceChildren();
    for (const { spec, value } of liveSliders(hd)) {
      const range = h("input", {
        type: "range",
        min: String(spec.min),
        max: String(spec.max),
        step: spec.step === "any" ? "any" : String(spec.step),
        value: String(value),
        "aria-label": spec.label,
      }) as HTMLInputElement;
      const readout = h("span", { class: "cs-tray-value" }, fmt(value));
      range.addEventListener("input", () => {
        overrides[spec.path] = Number(range.value);
        readout.textContent = fmt(Number(range.value));
        hd.timeline.previewParams(overrides);
      });
      tray.appendChild(h("label", { class: "cs-tray-row" }, h("span", { class: "cs-tray-label" }, spec.label), range, readout));
    }
    const continueBtn = h("button", { class: "cs-tray-continue" }, "Continue ▶");
    continueBtn.addEventListener("click", () => {
      restore();
      close();
      void hd.timeline.play();
    });
    tray.appendChild(h("div", { class: "cs-tray-actions" }, continueBtn));
    tray.hidden = false;
    trayBtn.classList.add("open");
  };

  const trayBtn = h("button", { class: "cs-bar-btn cs-tray-btn", title: "Explore this figure (sliders)" }, "⊕");
  trayBtn.addEventListener("click", () => {
    if (tray.hidden) open();
    else {
      restore(); // toggle-close: back to honest state, stay paused
      close();
    }
  });
  bar.appendChild(trayBtn);

  // Play from anywhere else (big play, spacebar, stage click) closes the tray;
  // the run already owns the state, so no restore — chain, never replace, the
  // existing onState (controls + session both hang callbacks here).
  const prevOnState = hd.timeline.callbacks.onState;
  hd.timeline.callbacks.onState = (s) => {
    prevOnState?.(s);
    if (s === "playing" && !tray.hidden) {
      for (const k of Object.keys(overrides)) delete overrides[k];
      close();
    }
  };
}

function fmt(x: number): string {
  return Math.abs(x) >= 10 ? String(Math.round(x)) : String(Math.round(x * 100) / 100);
}
```

One behavior to verify while implementing: pressing play while a preview is on screen. `play()` walks on from `completed` without re-committing the boundary, so the first frames could run atop preview geometry. If observed in the smoke test, make the `onState` handler call `hd.timeline.renderUpTo(hd.timeline.position)` before `close()` when `overrides` is non-empty — `renderUpTo` aborts nothing that matters at that instant only if play has not yet advanced; verify against `tests/animate.test.ts`'s abort-mid-animate expectations. Prefer the explicit "Continue ▶" path in the help text either way.

- [ ] **Step 2: Styles (append after the `.pl-panel` block in `src/styles.css`)**

```css
/* ---------- explore tray (params sliders under the control bar) ---------- */

.cs-paramtray {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  padding: 0.45rem 0.6rem 0.55rem;
  border-top: 1px dashed var(--line);
}
.cs-tray-row {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  font-size: 0.82rem;
  color: var(--muted);
}
.cs-tray-row input[type="range"] { flex: 1; accent-color: var(--rust); }
.cs-tray-label { min-width: 6.5rem; text-transform: none; }
.cs-tray-value { min-width: 3ch; text-align: right; font-variant-numeric: tabular-nums; color: var(--ink); }
.cs-tray-actions { display: flex; justify-content: flex-end; }
.cs-tray-continue { font-size: 0.82rem; }
.cs-tray-btn.open { color: var(--rust); }
```

(`[hidden] { display: none !important; }` at styles.css:27 already beats the flex rule — the third-time-lesson is baked in globally.)

- [ ] **Step 3: Typecheck**

Run: `npx tsc`
Expected: clean. (No node test covers tray.ts — DOM module, same convention as controls.ts.)

- [ ] **Step 4: Commit**

```bash
cd /Users/hom/Documents/GitHub/drawcast && git log --oneline -2 && npx tsc && npm test 2>&1 | tail -3 && git add src/ui/tray.ts src/styles.css && git commit -m "Explore tray: slider strip under the control bar"
```

---

### Task 5: Wire the tray into the app player and the viewer

**Files:**
- Modify: `src/main.ts` — inside `present()`'s `onItemMounted` (~line 1467, the ⬡ 3D block)
- Modify: `src/viewer.ts` — the `mountPlaylist` options (~line 99-107)

**Interfaces:**
- Consumes: `attachParamsTray(host, hd)` from Task 4.

- [ ] **Step 1: main.ts** — add to the existing `onItemMounted` callback, after the 3D-button block:

```ts
attachParamsTray(host, hd);
```

with the import `import { attachParamsTray } from "./ui/tray";` alongside the other `./ui/` imports. `host` here is the same element the 3D block queries `.cs-controlbar` in; `attachParamsTray` no-ops when the bar or sliders are absent, so the author-preview path (which passes no controls) stays clean without a special case.

- [ ] **Step 2: viewer.ts** — the viewer's `mountPlaylist` call gets an `onItemMounted`:

```ts
onItemMounted: (hd) => attachParamsTray(figureHost, hd),
```

(Match the exact `SessionOptions` property name and `figureHost` variable already in the file; if an `onItemMounted` already exists there, append the call inside it.)

- [ ] **Step 3: Verify**

Run: `npx tsc && npm test 2>&1 | tail -3 && npm run build 2>&1 | tail -1`
Expected: clean, all tests pass, build ok. Also run `npm run build:engine` and its check — the engine bundle must NOT gain `ui/tray` (engine-element mounts no controls; if the import graph pulls tray into dist-engine, move the import in main.ts, not in engine code).

- [ ] **Step 4: Manual smoke (Playwright or `vite preview` + browser)**

Load the bundled "Demand shift, animated" example → player mode → pause → ⊕ appears on the bar → open → drag amount: curve glides live → Continue ▶ → figure snaps back to the paused boundary and playback resumes. Then replay the item start-to-end untouched and confirm it is byte-identical behavior (no tray interference).

- [ ] **Step 5: Commit**

```bash
cd /Users/hom/Documents/GitHub/drawcast && git log --oneline -2 && git add src/main.ts src/viewer.ts && git commit -m "Mount the explore tray in the app player and the shared viewer"
```

---

### Task 6: Help + docs touch, final verification, push

**Files:**
- Modify: `public/help.html` — the Player controls section gains one short paragraph
- Modify: `ROADMAP.md` — move "auto param sliders" from planned to done-since-fork with a one-liner

**Steps:**

- [ ] **Step 1: help.html** — add to the player-controls section:

```html
<p>
  When a figure has explorable numbers, a <strong>⊕</strong> button appears on the
  control bar while paused. It opens a small tray of sliders — drag them to see how
  the figure responds. <strong>Continue ▶</strong> puts everything back exactly as it
  was and resumes the narration. Exploration never appears in exported videos.
</p>
```

- [ ] **Step 2: ROADMAP.md** — under "Done since fork", add:

```markdown
- **Explore tray** (2026-08-27): interactivity round 1 per
  `docs/superpowers/specs/2026-08-27-interactivity-principles.md` — ⊕ on the
  control bar opens a slider tray auto-derived from params_schema bounds
  (`minimum`/`maximum`), live-previewed via `Player.previewParams`, restored
  exactly by "Continue ▶". Flagship ranges declared on supply_demand and the
  stats pack; other templates join by declaring bounds.
```

- [ ] **Step 3: Full gate**

Run: `npx tsc && npm test 2>&1 | tail -3 && npm run build 2>&1 | tail -1 && npm run build:engine 2>&1 | tail -1`
Expected: everything green.

- [ ] **Step 4: Commit and push (check for parallel-session commits first)**

```bash
cd /Users/hom/Documents/GitHub/drawcast && git log --oneline -3 && git status --porcelain && git add public/help.html ROADMAP.md docs/superpowers/plans/2026-08-27-params-tray.md && git commit -m "Explore tray: help + roadmap; params-tray plan" && git push origin main && git ls-remote origin main
```

---

## Self-review notes

- Spec coverage: §7.1 (playing = clean — tray hidden until opened, opening pauses), §7.4 (tray under the bar), §7.5 (explicit Continue ▶), §6 (auto sliders from bounds; no guessing), §12 round-1 scope. The ⊕ doubles as the §7.2 indicator for this round; element-level pause-reveal markers arrive with element-level interactions (links), not here.
- The one deliberate scope cut: sliders only for params with a current value in the spec (invisible-element lesson from the animate round).
- Type consistency: `SliderSpec` produced in Task 1 is consumed by name in Task 4; `previewParams(overrides: Record<string, number>): void` matches between Tasks 2 and 4.
