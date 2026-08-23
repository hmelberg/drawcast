# The `animate` Command Implementation Plan (param animation — revival of the 2026-08-23 parked tween)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A spec command `{"animate": {"demand_shift.amount": 25}, "duration": 3, "speak": "…"}` that smoothly animates any NUMERIC template parameter — in the live player and (automatically, via the real-time-replay exporter) in exported video — by re-running the template's layout every frame. Canonical demos: a demand curve that slides right while the voice speaks (with the new equilibrium gliding along the supply curve), demand steepness changing so the tax deadweight-loss triangle honestly shrinks, and smooth molecule_3d rotation via azimuth.

**Architecture:** Animation is PARAMETER animation, not element animation — the player knows nothing about demand curves. Per frame: interpolate the targeted params (smoothstep), re-run `layoutSpec` with the merged params, and swap the mounted SVG's drawable nodes at full progress, restricted to currently visible ids (cheap: no element handles, no `getTotalLength`). At completion (and at every scrub boundary): one FULL remount at the settled params, rebuilding element handles so later draw/gesture steps target the new geometry. Cumulative param overrides live in the plan's per-boundary `SceneState` — exactly like `offsets` — so scrub/step-back/restart stay exact by construction and the spec is never mutated. Boiling is already prevented: rough.js seeds are pinned per element id (`hashSeed`, svg-backend.ts). The exporter replays the live Player in real time and rasterizes the mounted SVG at 30fps, so animate needs ZERO export code.

**Tech Stack:** existing layout/plan/player/svg-backend machinery; no new dependencies.

**Spec:** the parked plan `git show a5fff86:docs/superpowers/plans/2026-08-23-tween-rotation.md` (Tasks 2–4 design + rulings) + the parked-appendix revival ruling in `docs/superpowers/plans/2026-08-23-3d-solids-modal.md` + chat design 2026-08-23 (this revival: SceneState params instead of spec mutation; plan-time bbox refresh; frame-swap/commit split; numeric steepness).

## Global Constraints

- No new npm dependencies; NEVER create or commit a package-lock.json (an untracked one exists — leave it).
- Gate before every commit: `npx tsc && npx vitest run`. Never pipe tsc through tail. Final task adds `npm run build`.
- Commit trailer: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`
- Determinism: no `Math.random`/`Date` in layout or render paths (rough seeds come from `hashSeed(id)`).
- Rulings carried over from the parked plan, unchanged: animate only overrides NUMERIC values; an animate on a spec with no `template` is a plan-time warning + no-op step (never a crash, never a validation hard-fail); a missing/non-numeric start value makes that key jump to its target at t=0 (warned, documented); abort/scrub must leave the END state applied via the boundary machinery; instant mode jumps to the end state; silent mode keeps the duration; easing is smoothstep; default duration 2 s.
- New rulings (chat 2026-08-23): NEVER mutate `spec.params` at runtime — cumulative overrides live in `SceneState.params` (restart-from-beginning must replay the original figure); per-frame layouts are NOT cached (only boundary layouts are — a 2 s tween is ~120 distinct param sets); `swapGeometry` skips `nudgeTextsIntoCanvas` (the full remount does it).
- Frame re-layout must reuse the SAME pipeline (`layoutSpec`) — no parallel layout path.
- `tests/` run in plain node (vite.config.ts: `environment: "node"`) — no DOM, no rAF. Player tests polyfill rAF locally (see Task 5); DOM-bound svg-backend behavior gets pure-part unit tests plus the visual gate, the repo's convention.

## File Structure

- Modify `src/layout/curves.ts` — `qualitativeShape` accepts numeric steepness.
- Modify `src/scenes/supply_demand/layout.ts` + `src/scenes/supply_demand/manifest.json` — numeric `amount` on shifts, numeric steepness, shift equilibrium elements.
- Create `src/render/params.ts` — pure dot-path param helpers (`readParam`, `withOverrides`).
- Modify `src/spec/types.ts`, `src/spec/schema.ts` — `animate` + `duration` on Command; validation.
- Modify `src/render/plan.ts` — `animate` step kind; `SceneState.params`; plan-time bbox refresh.
- Modify `src/render/backend.ts`, `src/render/svg-backend.ts` — `swapGeometry`/`remount` on MountResult.
- Modify `src/render/player.ts` — `Reprojector` hook, `animate` action, param-aware `renderUpTo`.
- Modify `src/render/index.ts` — wiring: `layoutFor`, reprojector, `bboxesFor`, `animateBase`.
- Modify `src/llm/prompts/compiler-v1.md`, `src/scenes/molecule_3d/template.yaml`, `src/examples.json`, `ROADMAP.md`.
- Tests: extend `tests/supply-demand.test.ts`, `tests/plan.test.ts`, `tests/schema.test.ts`; create `tests/params.test.ts`, `tests/animate.test.ts`.

---

### Task 1: Numeric curve params on supply_demand (shift `amount`, numeric `steepness`, shift equilibrium)

**Files:**
- Modify: `src/layout/curves.ts:9-21` (STEEPNESS / `qualitativeShape`)
- Modify: `src/scenes/supply_demand/layout.ts` (CurveParams, SupplyDemandParams, the shift block at lines ~120-146)
- Modify: `src/scenes/supply_demand/manifest.json` (param docs + one animate example)
- Test: `tests/supply-demand.test.ts`

**Interfaces produced (later tasks and the LLM rely on):**
- `CurveParams.steepness?: "gentle" | "medium" | "steep" | number` — a number IS the steepness factor `k` (enum: gentle 0.55, medium 1, steep 1.5; useful range ~0.25–2.5; clamped to ≥ 0.05).
- `demand_shift`/`supply_shift` gain `amount?: number` — SIGNED horizontal shift in domain units (0–100 axis). When present it wins over `direction`; default stays `direction`-derived ±15. `amount: 0` is legal: the shifted curve coincides with the base curve (the canonical animate start state).
- New elements when EXACTLY ONE shift is set, supply and demand both exist, the shifted pair intersects, and `equilibrium.show !== false`: `shift_equilibrium_point` (dot), `shift_guide_lines` (dashed guides), labels `label_E_shift` ("E′"), `label_P_shift` ("P*′"), `label_Q_shift` ("Q*′"). At `amount: 0` these coincide with the base equilibrium — E′ starts ON E and glides as the curve slides. When BOTH shifts are set, no shift-equilibrium elements are emitted (documented v1 limit).
- The shift arrow keeps its id (`demand_shift_arrow`/`supply_shift_arrow`) at every amount, but drops its arrowhead when `|dx| < 2` (a zero-length arrow must not render a floating arrowhead triangle; the element must EXIST at amount 0 so plan-time id resolution never drops it).

**Steps:**

- [ ] **Step 1: Write the failing tests** in `tests/supply-demand.test.ts` (follow the file's existing helpers for running `layoutSupplyDemand` and finding drawables/labels by id):

```ts
describe("numeric curve params (animate prerequisites)", () => {
  test("numeric steepness: larger k spans more of the y range, enum words unchanged", () => {
    const flat = layoutSupplyDemand({ demand: { steepness: 0.4 } });
    const steep = layoutSupplyDemand({ demand: { steepness: 2 } });
    const enumSteep = layoutSupplyDemand({ demand: { steepness: "steep" } });
    const numSteep = layoutSupplyDemand({ demand: { steepness: 1.5 } });
    const ySpan = (l: SceneLayout) => {
      const pts = l.curveSamples!["demand_curve"];
      const ys = pts.map(([, y]) => y);
      return Math.max(...ys) - Math.min(...ys);
    };
    expect(ySpan(steep)).toBeGreaterThan(ySpan(flat));
    expect(ySpan(numSteep)).toBeCloseTo(ySpan(enumSteep), 5);
  });

  test("shift amount: signed domain-unit shift, direction fallback intact", () => {
    const byAmount = layoutSupplyDemand({ demand_shift: { amount: 20 } });
    const byDirection = layoutSupplyDemand({ demand_shift: { direction: "right" } });
    const left = layoutSupplyDemand({ demand_shift: { amount: -10 } });
    const base = (l: SceneLayout) => l.curveSamples!["demand_curve"];
    const shifted = (l: SceneLayout) => l.curveSamples!["demand_shift_curve"];
    // logical dx for a 20-domain-unit shift = 20 * (plot width / 100); compare
    // via a base point: the shifted curve's first point x minus the matching
    // base point x must be positive for amount 20 / direction right, negative for -10.
    expect(shifted(byAmount)[0][0]).toBeGreaterThan(base(byAmount)[0][0]);
    expect(shifted(byDirection)[0][0]).toBeGreaterThan(base(byDirection)[0][0]);
    expect(shifted(left)[0][0]).toBeLessThan(base(left)[0][0]);
  });

  test("amount 0: shifted curve coincides with base; arrow exists WITHOUT arrowhead", () => {
    const l = layoutSupplyDemand({ demand_shift: { amount: 0 } });
    expect(l.curveSamples!["demand_shift_curve"]).toEqual(l.curveSamples!["demand_curve"]);
    const arrow = l.drawables.find((d) => d.id === "demand_shift_arrow");
    expect(arrow).toBeDefined();
    expect((arrow as StrokeDrawable).arrowhead).toBeUndefined();
    const arrow15 = layoutSupplyDemand({ demand_shift: { amount: 15 } }).drawables.find((d) => d.id === "demand_shift_arrow");
    expect((arrow15 as StrokeDrawable).arrowhead).toBe("end");
  });

  test("shift equilibrium: exists for a single shift, glides with amount, absent when both shift", () => {
    const at0 = layoutSupplyDemand({ demand_shift: { amount: 0 } });
    const at20 = layoutSupplyDemand({ demand_shift: { amount: 20 } });
    const both = layoutSupplyDemand({ demand_shift: { amount: 10 }, supply_shift: { amount: 10 } });
    const dot = (l: SceneLayout) => l.drawables.find((d) => d.id === "shift_equilibrium_point");
    expect(dot(at0)).toBeDefined();
    expect(dot(at20)).toBeDefined();
    // at amount 0, E' sits on E
    const eq = (l: SceneLayout) => l.anchors["equilibrium_point"];
    const eqS = (l: SceneLayout) => l.anchors["shift_equilibrium_point"];
    expect(eqS(at0)[0]).toBeCloseTo(eq(at0)[0], 3);
    expect(eqS(at0)[1]).toBeCloseTo(eq(at0)[1], 3);
    // demand shifted right: new equilibrium at higher Q and higher P
    expect(eqS(at20)[0]).toBeGreaterThan(eq(at20)[0]);
    expect(eqS(at20)[1]).toBeGreaterThan(eq(at20)[1]);
    expect(dot(both)).toBeUndefined();
    // labels E'/P*'/Q*' + guides exist for the single-shift case
    for (const id of ["shift_guide_lines", "label_E_shift", "label_P_shift", "label_Q_shift"]) {
      expect(at20.order).toContain(id);
    }
  });
});
```

Adapt accessor details (`SceneLayout` field names, how labels appear in `order`, exact anchor bookkeeping) to what `tests/supply-demand.test.ts` already does — the assertions above are the contract; delete the stray `expect(l => l)` placeholder line when transcribing.

- [ ] **Step 2: Run to verify failure** — `npx vitest run tests/supply-demand.test.ts`. Expected: new tests FAIL (amount ignored, no shift_equilibrium_point, numeric steepness treated as `?? 1` fallback… note `STEEPNESS[number] ?? 1` currently coerces any number to 1, so the numeric-steepness test fails on `ySpan(steep) > ySpan(flat)`).

- [ ] **Step 3: Implement.**

`src/layout/curves.ts` — widen the signature; a number is `k` directly:

```ts
export function qualitativeShape(
  direction: "increasing" | "decreasing" | "flat" | "vertical",
  curvature: "linear" | "convex" | "concave" = "linear",
  steepness: "gentle" | "medium" | "steep" | number = "medium",
): Pt[] {
  const k = Math.max(0.05, typeof steepness === "number" ? steepness : STEEPNESS[steepness] ?? 1);
  ...
```

`src/scenes/supply_demand/layout.ts`:
- `CurveParams.steepness` type widened to match.
- `demand_shift?: { direction?: "right" | "left"; amount?: number; label?: string }` (same for supply_shift).
- In the shift loop: `const dx = shift.amount ?? ((shift.direction ?? "right") === "right" ? 15 : -15);` and build the arrow with `...(Math.abs(dx) >= 2 ? { arrowhead: "end" as const } : {})` instead of the unconditional `arrowhead: "end"`.
- After the shift loop, add the shift equilibrium (mirror the existing base-equilibrium block at lines ~106-117; reuse `guides()` and `dot()`):

```ts
// New equilibrium after a single shift: E' glides as the curve slides.
const shifts = [params.demand_shift, params.supply_shift].filter(Boolean);
if (shifts.length === 1 && supplyPts && params.equilibrium?.show !== false) {
  const eqS = params.demand_shift
    ? intersectPolylines(shiftedDomain["demand_shift_curve"]!, supplyPts)
    : intersectPolylines(demandPts, shiftedDomain["supply_shift_curve"]!);
  if (eqS) {
    const eqSL = ctx.toLogical([eqS])[0];
    push(guides("shift_guide_lines", eqS, ctx, plot));
    push(dot("shift_equilibrium_point", eqSL));
    anchors["shift_equilibrium_point"] = eqSL;
    label("label_E_shift", eqSL, "above-right", "E′");
    label("label_P_shift", [plot.x0, eqSL[1]], "left", "P*′");
    label("label_Q_shift", [eqSL[0], plot.y0], "below", "Q*′");
  }
}
```

The shift loop currently keeps its domain-space `shifted` array locally — hoist those into a small record (e.g. `const shiftedDomain: Record<string, Pt[]> = {}` filled inside the loop) so the equilibrium block can read them; do NOT re-derive from `curveSamples` (those are logical, `intersectPolylines` runs in domain space here).

- [ ] **Step 4: Run the tests** — `npx vitest run tests/supply-demand.test.ts`, then the full suite `npx vitest run` (watch for: any test asserting supply_demand element counts/order — the new ids appear in `order` and in the implicit final draw; update such assertions deliberately).

- [ ] **Step 5: Update `src/scenes/supply_demand/manifest.json`** — document `amount` (signed, 0–100 domain units, wins over direction, 0 = coincides with the base curve), numeric `steepness` (factor; 0.25 flat … 2.5 very steep; the words still work), the new shift-equilibrium ids, and add one example whose request is "show demand increasing and where the new equilibrium lands" with `demand_shift: { amount: 0 }` in params (the animate story starts at 0). Keep the existing examples intact.

- [ ] **Step 6: Gate + commit**

```bash
npx tsc && npx vitest run
git add src/layout/curves.ts src/scenes/supply_demand/ tests/supply-demand.test.ts
git commit -m "feat: numeric shift amount + continuous steepness + shift equilibrium in supply_demand"
```

---

### Task 2: Pure param-path helpers (`src/render/params.ts`)

**Files:**
- Create: `src/render/params.ts`
- Test: `tests/params.test.ts`

**Interfaces produced:**
- `readParam(params: Record<string, unknown> | undefined, path: string): number | null` — resolves a dot path (`"demand_shift.amount"`, `"azimuth"`); returns the value only if it is a finite number, else null.
- `withOverrides(params: Record<string, unknown> | undefined, overrides: Record<string, number>): Record<string, unknown>` — immutable deep-set of every dot path, creating missing intermediate objects; never mutates the input; if a path segment exists but is not a plain object, that override is skipped (the original value wins).

**Steps:**

- [ ] **Step 1: Write the failing tests** (`tests/params.test.ts`):

```ts
import { describe, expect, test } from "vitest";
import { readParam, withOverrides } from "../src/render/params";

describe("readParam", () => {
  test("top-level and nested numeric reads", () => {
    expect(readParam({ azimuth: 32 }, "azimuth")).toBe(32);
    expect(readParam({ demand_shift: { amount: 0 } }, "demand_shift.amount")).toBe(0);
  });
  test("missing, non-numeric, and non-finite → null", () => {
    expect(readParam(undefined, "a")).toBeNull();
    expect(readParam({}, "demand_shift.amount")).toBeNull();
    expect(readParam({ demand: { steepness: "steep" } }, "demand.steepness")).toBeNull();
    expect(readParam({ a: NaN }, "a")).toBeNull();
    expect(readParam({ a: 5 }, "a.b")).toBeNull();
  });
});

describe("withOverrides", () => {
  test("deep-sets without mutating and creates intermediate objects", () => {
    const base = { demand: { steepness: 1 }, other: true };
    const out = withOverrides(base, { "demand.steepness": 2, "demand_shift.amount": 10 });
    expect(out).toEqual({ demand: { steepness: 2 }, other: true, demand_shift: { amount: 10 } });
    expect(base.demand.steepness).toBe(1);
    expect((base as Record<string, unknown>).demand_shift).toBeUndefined();
  });
  test("non-object collision: the original value wins", () => {
    expect(withOverrides({ a: 5 }, { "a.b": 1 })).toEqual({ a: 5 });
  });
  test("undefined base works", () => {
    expect(withOverrides(undefined, { azimuth: 90 })).toEqual({ azimuth: 90 });
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run tests/params.test.ts` (module not found).

- [ ] **Step 3: Implement** (`src/render/params.ts`):

```ts
// Dot-path helpers for the animate command: template params are nested
// objects (demand_shift.amount), animate targets address them by path.

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** The numeric value at a dot path, or null when missing/non-numeric. */
export function readParam(params: Record<string, unknown> | undefined, path: string): number | null {
  let cur: unknown = params;
  for (const seg of path.split(".")) {
    if (!isRecord(cur)) return null;
    cur = cur[seg];
  }
  return typeof cur === "number" && Number.isFinite(cur) ? cur : null;
}

/** Immutably overlay numeric overrides onto params, creating missing objects. */
export function withOverrides(
  params: Record<string, unknown> | undefined,
  overrides: Record<string, number>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...(params ?? {}) };
  for (const [path, value] of Object.entries(overrides)) {
    const segs = path.split(".");
    let host = out;
    let ok = true;
    for (let i = 0; i < segs.length - 1; i++) {
      const existing = host[segs[i]];
      if (existing === undefined) host[segs[i]] = {};
      else if (isRecord(existing)) host[segs[i]] = { ...existing };
      else { ok = false; break; }
      host = host[segs[i]] as Record<string, unknown>;
    }
    if (ok) host[segs[segs.length - 1]] = value;
  }
  return out;
}
```

- [ ] **Step 4: Run** — `npx vitest run tests/params.test.ts`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/render/params.ts tests/params.test.ts
git commit -m "feat: dot-path param helpers for the animate command"
```

---

### Task 3: `animate` in the spec (types + schema) and in the plan (step kind + SceneState.params)

**Files:**
- Modify: `src/spec/types.ts:151-178` (Command)
- Modify: `src/spec/schema.ts` (commandSchema ~line 140; `semanticErrors` ~line 310)
- Modify: `src/render/plan.ts`
- Test: `tests/schema.test.ts`, `tests/plan.test.ts`

**Interfaces produced (Task 5 relies on):**
- `Command.animate?: Record<string, number>` + `Command.duration?: number` (seconds; only with animate).
- PlanStep variant: `{ kind: "animate"; targets: Record<string, number>; starts: Record<string, number | null>; seconds: number }` (plus the shared optional `narration`).
- `SceneState.params: Record<string, number>` — cumulative animate overrides at each boundary; `INITIAL_STATE.params = {}`.
- `PlanOptions.animateBase?: Record<string, unknown> | null` — the spec's `params` when the spec HAS a template; `null`/undefined = no template → every animate warns + is skipped.
- `PlanOptions.bboxesFor?: (params: Record<string, number>) => (id: string) => BBox | null` — after an animate step, the planner switches its bbox source to this so later highlight/point/camera steps target POST-animate geometry.

**Steps:**

- [ ] **Step 1: Failing schema tests** (extend `tests/schema.test.ts`, following its existing valid/invalid spec fixtures):

```ts
test("animate command validates: numeric targets, duration only with animate", () => {
  const ok = validateSpec({ template: "supply_demand", params: { demand_shift: { amount: 0 } }, commands: [
    { animate: { "demand_shift.amount": 20 }, duration: 3, speak: "watch it slide" },
  ]});
  expect(ok.valid).toBe(true);
  const badValue = validateSpec({ template: "supply_demand", params: {}, commands: [
    { animate: { "demand_shift.amount": "right" as unknown as number } },
  ]});
  expect(badValue.valid).toBe(false);
  const strayDuration = validateSpec({ template: "supply_demand", params: {}, commands: [
    { draw: ["axes"], duration: 2 },
  ]});
  expect(strayDuration.valid).toBe(false);
  const twoVerbs = validateSpec({ template: "supply_demand", params: {}, commands: [
    { animate: { a: 1 }, draw: ["axes"] },
  ]});
  expect(twoVerbs.valid).toBe(false);
});
```

(Adapt `validateSpec` to the module's real export names.)

- [ ] **Step 2: Failing plan tests** (extend `tests/plan.test.ts`):

```ts
describe("animate planning", () => {
  const base = { demand_shift: { amount: 0 }, azimuth: 32 };

  test("step carries targets, starts from animateBase, default duration 2", () => {
    const plan = planCommands([{ animate: { "demand_shift.amount": 20 } }], ["axes"], { animateBase: base });
    const step = plan.steps.find((s) => s.kind === "animate")!;
    expect(step).toMatchObject({ kind: "animate", targets: { "demand_shift.amount": 20 }, starts: { "demand_shift.amount": 0 }, seconds: 2 });
  });

  test("cumulative: a second animate starts from the first's target; states carry params", () => {
    const plan = planCommands(
      [{ animate: { azimuth: 120 } }, { animate: { azimuth: 240 } }],
      ["axes"],
      { animateBase: base },
    );
    const steps = plan.steps.filter((s) => s.kind === "animate");
    expect(steps[1]).toMatchObject({ starts: { azimuth: 120 } });
    const idx = plan.steps.indexOf(steps[1]);
    expect(plan.states[idx].params).toEqual({ azimuth: 240 });
    expect(INITIAL_STATE.params).toEqual({});
  });

  test("no template → warn + no step; missing numeric start → null start + warning", () => {
    const none = planCommands([{ animate: { a: 1 } }], ["axes"], {});
    expect(none.steps.some((s) => s.kind === "animate")).toBe(false);
    expect(none.warnings.join(" ")).toMatch(/animate requires a scene template/);
    const missing = planCommands([{ animate: { "tax.rate": 5 } }], ["axes"], { animateBase: base });
    const step = missing.steps.find((s) => s.kind === "animate")!;
    expect(step).toMatchObject({ starts: { "tax.rate": null } });
    expect(missing.warnings.join(" ")).toMatch(/no numeric start value/);
  });

  test("bbox source switches after an animate", () => {
    const before = { x: 0, y: 0, w: 10, h: 10 };
    const after = { x: 50, y: 0, w: 10, h: 10 };
    const plan = planCommands(
      [
        { draw: ["dot"] },
        { highlight: { target: ["dot"] } },
        { animate: { "demand_shift.amount": 20 } },
        { highlight: { target: ["dot"] } },
      ],
      ["dot"],
      { animateBase: base, bboxOf: () => before, bboxesFor: () => () => after },
    );
    const highlights = plan.steps.filter((s) => s.kind === "highlight");
    expect(highlights[0].boxes["dot"]).toEqual(before);
    expect(highlights[1].boxes["dot"]).toEqual(after);
  });

  test("narrated animate gets the narration pairing", () => {
    const plan = planCommands([{ animate: { azimuth: 90 }, speak: "spin" }], [], { animateBase: base });
    expect(plan.steps[0].narration).toBe("spin");
  });
});
```

- [ ] **Step 3: Run to verify failures** — `npx vitest run tests/schema.test.ts tests/plan.test.ts`.

- [ ] **Step 4: Implement types + schema.**

`src/spec/types.ts` (Command):

```ts
  /** Smoothly animate numeric template params to target values (dot paths into params). */
  animate?: Record<string, number>;
  /** With animate: seconds the animation takes (default 2). */
  duration?: number;
```

`src/spec/schema.ts` commandSchema properties (keep `additionalProperties` handling consistent with how `params` is declared; numeric enforcement lives in `semanticErrors` so the structured-output path stays permissive):

```ts
    animate: {
      type: "object",
      additionalProperties: true,
      description:
        "Smoothly animate NUMERIC template params to these target values while the paired speak lands. Keys are dot paths into params (e.g. {\"demand_shift.amount\": 25} or {\"azimuth\": 240}); the whole figure re-computes every frame, so intersections, guides, and regions move honestly. Always write the STARTING value explicitly in params (e.g. demand_shift: {amount: 0}). Only for template specs.",
    },
    duration: { type: "number", description: "With animate: seconds the animation takes (default 2)." },
```

`semanticErrors`: add `"animate"` to `ACTION_VERBS`; after the existing per-verb checks add:

```ts
    if (verb === "animate") {
      const entries = Object.entries(cmd.animate!);
      if (entries.length === 0) errors.push(`commands[${i}]: animate needs at least one param target`);
      for (const [k, v] of entries) {
        if (typeof v !== "number" || !Number.isFinite(v)) errors.push(`commands[${i}]: animate "${k}" must be a finite number`);
      }
    }
    if (cmd.duration !== undefined && verb !== "animate") {
      errors.push(`commands[${i}]: duration only applies to animate (other verbs carry their own duration fields)`);
    }
```

Update the commandSchema `description` string and the top-level `commands` description to include animate in the verb list.

- [ ] **Step 5: Implement plan.ts.**

- PlanStep union gains `| { kind: "animate"; targets: Record<string, number>; starts: Record<string, number | null>; seconds: number }`.
- `SceneState` gains `params: Record<string, number>`; `INITIAL_STATE` gains `params: {}`.
- Import `readParam` from `./params`.
- `PlanOptions` gains `animateBase?: Record<string, unknown> | null;` and `bboxesFor?: (params: Record<string, number>) => (id: string) => BBox | null;`.
- Make the bbox source mutable: `let bboxOf = opts.bboxOf ?? (() => null);` (it is currently a `const`).
- Track `let params: Record<string, number> = {};` alongside `offsets`; `pushStep` snapshots it: `states.push({ visible: [...visible], offsets: { ...offsets }, camera, params: { ...params } })`.
- Add `"animate"` to `ACTION_KEYS`.
- Parsing branch (insert before the final `else`):

```ts
    } else if (cmd.animate !== undefined) {
      const targets = Object.fromEntries(
        Object.entries(cmd.animate).filter(([, v]) => typeof v === "number" && Number.isFinite(v)),
      ) as Record<string, number>;
      if (opts.animateBase === undefined || opts.animateBase === null) {
        warnings.push("animate requires a scene template (skipped)");
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
      pushStep({ kind: "animate", targets, starts, seconds: cmd.duration ?? 2 });
      if (opts.bboxesFor) bboxOf = opts.bboxesFor(params);
```

Note `params[key] ?? readParam(...)`: `??` (not `||`) so an accumulated 0 survives. `starts[key]` may be `null` from readParam — that is the jump-to-target marker.

- [ ] **Step 6: Full suite** — `npx vitest run`. The `SceneState` shape change will break any test deep-equal on states or `INITIAL_STATE` — update those literals to include `params: {}`.

- [ ] **Step 7: Commit**

```bash
git add src/spec/types.ts src/spec/schema.ts src/render/plan.ts tests/schema.test.ts tests/plan.test.ts
git commit -m "feat: animate command — spec surface and plan step with per-boundary param state"
```

---

### Task 4: Backend reprojection (`swapGeometry` + `remount`)

**Files:**
- Modify: `src/render/backend.ts` (MountResult)
- Modify: `src/render/svg-backend.ts` (makeSvgBackend.mount, ~lines 585-629)
- Test: extend whichever pattern `tests/svg-gradient.test.ts` uses to exercise svg-backend (INVESTIGATE first; if it tests only pure helpers, do the same here and lean on the Task 7 visual gate for the DOM path — the repo's convention for DOM-bound seams)

**Interfaces produced (Task 5/6 rely on):**

`src/render/backend.ts`, on `MountResult` (both optional so the contract stays backward-compatible):

```ts
  /**
   * Per-frame geometry swap for the animate command: rebuild the drawable
   * nodes from a new layout at FULL progress, restricted to `visible` ids,
   * applying `offsets` (logical y-up). The svg element, camera viewBox, and
   * gesture overlay are untouched. Creates NO element handles and does NO
   * measurement — it must stay cheap enough for 30–60 fps.
   */
  swapGeometry?(layout: LayoutResult, visible: ReadonlySet<string>, offsets: Record<string, Pt>): void;
  /**
   * Full re-mount of a new layout into the same svg: rebuilds nodes AND
   * element handles (measurement included; handles start hidden exactly like
   * after mount). Gesture effects stay wired. Returns the new element map.
   */
  remount?(layout: LayoutResult): Map<string, RenderedElement>;
```

**Steps:**

- [ ] **Step 1: Investigate + record in the task report:** how `tests/svg-gradient.test.ts` exercises svg-backend in the node environment (pure helpers vs a DOM shim); confirm `makeEffects` closes over the `leafNodes` map (svg-backend.ts:626) — remount must MUTATE that map in place (clear + refill), never replace it, or highlight/point break after an animate.

- [ ] **Step 2: Implement.** Inside `makeSvgBackend`'s `mount`, extract the existing node-building loop (lines ~598-610) into a closure-local helper and reuse it:

```ts
      const buildNodes = (l: LayoutResult, into: Map<string, { g: SVGGElement; leaf: Exclude<Drawable, { kind: "group" }> }[]>, visible?: ReadonlySet<string>, offsets?: Record<string, Pt>) => {
        for (const id of l.order) {
          if (visible && !visible.has(id)) continue;
          const parts = drawablesForId(l.drawables, id);
          const entry: { g: SVGGElement; leaf: Exclude<Drawable, { kind: "group" }> }[] = [];
          for (const leaf of leafDrawables(parts)) {
            const g = drawLeaf(rc, leaf);
            const z = (leaf.z <= 0 ? 0 : leaf.z === 1 ? 1 : 2) as 0 | 1 | 2;
            const [dx, dy] = offsets?.[id] ?? [0, 0];
            if (dx !== 0 || dy !== 0) g.setAttribute("transform", `translate(${dx.toFixed(1)} ${(-dy).toFixed(1)})`);
            layers[z].appendChild(g);
            entry.push({ g, leaf });
          }
          into.set(id, entry);
        }
      };
```

`mount` body becomes `buildNodes(layout, leafNodes)` (no visible/offsets filter). Then in the returned MountResult:

```ts
        swapGeometry: (l, visible, offsets) => {
          layers[0].replaceChildren();
          layers[1].replaceChildren();
          layers[2].replaceChildren();
          buildNodes(l, new Map(), visible, offsets); // throwaway map: no handles, effects keep the mount-time nodes
        },
        remount: (l) => {
          layers[0].replaceChildren();
          layers[1].replaceChildren();
          layers[2].replaceChildren();
          leafNodes.clear();
          buildNodes(l, leafNodes);
          nudgeTextsIntoCanvas(svg);
          const els = new Map<string, RenderedElement>();
          for (const [id, entry] of leafNodes) {
            els.set(id, new SvgElementHandle(id, entry.map(({ g, leaf }) => makeLeafHandle(g, leaf)), entry.map(({ g }) => g)));
          }
          return els;
        },
```

Notes locked in: `swapGeometry` renders full-progress by construction (`prepare()` is what hides paths, and no handles are created); it deliberately SKIPS `nudgeTextsIntoCanvas` (per-frame `getBBox` is the expense to avoid); `remount` includes it. The stale-but-unused `leafNodes` during a tween is safe because commands are strictly sequential — no gesture runs mid-animate.

- [ ] **Step 3: Unit-test what the investigation found testable** (at minimum: nothing DOM-free may regress — run the full suite). If svg-gradient tests use a DOM shim, add: after `remount`, the returned map's ids equal the new layout's order, and `swapGeometry` with a restricted visible set leaves only those ids' nodes in the layers.

- [ ] **Step 4: Gate + commit**

```bash
npx tsc && npx vitest run
git add src/render/backend.ts src/render/svg-backend.ts
git commit -m "feat: svg-backend geometry swap + full remount for param reprojection"
```

---

### Task 5: Player — the `animate` action and param-aware boundaries

**Files:**
- Modify: `src/render/player.ts`
- Test: create `tests/animate.test.ts` (player-sync conventions: real `Player`, `StubSpeech`, no elements; plus a local rAF polyfill)

**Interfaces produced (Task 6 wires):**

```ts
export interface Reprojector {
  /** Cheap per-frame swap at interpolated params. */
  frame(params: Record<string, number>, visible: ReadonlySet<string>, offsets: Record<string, Pt>): void;
  /** Full remount at settled params; returns the new element handles. */
  commit(params: Record<string, number>): Map<string, RenderedElement>;
}
```

- `Player.reprojector: Reprojector | null = null` — injectable after construction, exactly like `inputGate`.
- Behavior contract: an `animate` step drives `reprojector.frame` with smoothstep-interpolated params each tick; on natural completion it commits the boundary's params and re-applies the scene state; on abort it does NOTHING further (the scrubber's `renderUpTo` owns state); `renderUpTo(n)` commits `stateAt(n).params` whenever they differ from the currently applied params — restart, step-back, instant mode, and `showPoster` all flow through it. Without a reprojector the step is a timed no-op (narration still paces it).

**Steps:**

- [ ] **Step 1: Failing tests** (`tests/animate.test.ts`):

```ts
import { describe, expect, test } from "vitest";
import { Player, type Reprojector } from "../src/render/player";
import { planCommands } from "../src/render/plan";
import { SpeechManager } from "../src/render/speech";
import type { RenderedElement } from "../src/render/backend";

// node has no rAF; drive Player.progress with a timer-based stand-in.
globalThis.requestAnimationFrame ??= ((cb: FrameRequestCallback) =>
  setTimeout(() => cb(performance.now()), 5) as unknown as number) as typeof requestAnimationFrame;

class StubSpeech extends SpeechManager {
  resolvers: (() => void)[] = [];
  override get available(): boolean { return false; }
  override speak(): Promise<void> { return new Promise((res) => this.resolvers.push(res)); }
  override cancel(): void {}
}

function makeReprojector() {
  const frames: Record<string, number>[] = [];
  const commits: Record<string, number>[] = [];
  const rp: Reprojector = {
    frame: (p) => frames.push({ ...p }),
    commit: (p) => { commits.push({ ...p }); return new Map<string, RenderedElement>(); },
  };
  return { rp, frames, commits };
}

const BASE = { demand_shift: { amount: 0 } };

describe("the animate action", () => {
  test("interpolates from start to target, then commits the end state", async () => {
    const plan = planCommands([{ animate: { "demand_shift.amount": 20 }, duration: 0.1 }], [], { animateBase: BASE });
    const { rp, frames, commits } = makeReprojector();
    const player = new Player(plan, new Map(), new StubSpeech(), null, { mode: "silent" });
    player.reprojector = rp;
    await player.play();
    expect(frames.length).toBeGreaterThanOrEqual(2);
    const vals = frames.map((f) => f["demand_shift.amount"]);
    expect(Math.min(...vals)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...vals)).toBeLessThanOrEqual(20);
    expect(vals[vals.length - 1]).toBeCloseTo(20, 5);
    expect(commits).toEqual([{ "demand_shift.amount": 20 }]);
    expect(player.state).toBe("done");
  });

  test("null start jumps straight to the target", async () => {
    const plan = planCommands([{ animate: { "tax.rate": 5 }, duration: 0.05 }], [], { animateBase: BASE });
    const { rp, frames } = makeReprojector();
    const player = new Player(plan, new Map(), new StubSpeech(), null, { mode: "silent" });
    player.reprojector = rp;
    await player.play();
    expect(frames.every((f) => f["tax.rate"] === 5)).toBe(true);
  });

  test("narrated animate: voice and animation both must finish", async () => {
    const speech = new StubSpeech();
    const plan = planCommands([{ animate: { "demand_shift.amount": 20 }, duration: 0.05, speak: "slide" }], [], { animateBase: BASE });
    const { rp, commits } = makeReprojector();
    const player = new Player(plan, new Map(), speech, null, { mode: "narrated" });
    player.reprojector = rp;
    const done = player.play();
    await new Promise((r) => setTimeout(r, 120)); // animation done, voice still open
    expect(player.state).toBe("playing");
    expect(commits.length).toBe(1); // action settled while the voice speaks
    speech.resolvers[0]();
    await done;
    expect(player.state).toBe("done");
  });

  test("scrubbing commits boundary params: back to 0 restores the original figure", async () => {
    const plan = planCommands([{ animate: { "demand_shift.amount": 20 }, duration: 0.05 }], [], { animateBase: BASE });
    const { rp, commits } = makeReprojector();
    const player = new Player(plan, new Map(), new StubSpeech(), null, { mode: "silent" });
    player.reprojector = rp;
    await player.play();
    player.renderUpTo(0);
    expect(commits[commits.length - 1]).toEqual({});
    player.renderUpTo(plan.steps.length);
    expect(commits[commits.length - 1]).toEqual({ "demand_shift.amount": 20 });
  });

  test("no reprojector: animate is a timed no-op, never a crash", async () => {
    const plan = planCommands([{ animate: { "demand_shift.amount": 20 }, duration: 0.02 }], [], { animateBase: BASE });
    const player = new Player(plan, new Map(), new StubSpeech(), null, { mode: "silent" });
    await player.play();
    expect(player.state).toBe("done");
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run tests/animate.test.ts` (no `Reprojector` export, no animate case).

- [ ] **Step 3: Implement in `src/render/player.ts`.**

- Export the `Reprojector` interface (above); add `reprojector: Reprojector | null = null;` next to `inputGate` and `private appliedParams: Record<string, number> = {};`.
- Extract the boundary-application body of `renderUpTo` (lines 163-171: the offsets/finish/hide loop + pointer/camera) into `private applyScene(scene: SceneState): void` so the animate settle can reuse it.
- `renderUpTo(n)`: after `abortRun()`, before applying visibility:

```ts
    const scene = this.stateAt(n);
    this.applyParams(scene.params);
    this.applyScene(scene);
```

- New private helpers:

```ts
  private static sameParams(a: Record<string, number>, b: Record<string, number>): boolean {
    const ka = Object.keys(a); const kb = Object.keys(b);
    return ka.length === kb.length && ka.every((k) => a[k] === b[k]);
  }

  /** Remount at the boundary's params when they differ from what is on screen. */
  private applyParams(params: Record<string, number>): void {
    if (!this.reprojector || Player.sameParams(this.appliedParams, params)) return;
    this.elements = this.reprojector.commit(params);
    this.appliedParams = { ...params };
  }
```

- `runAction` gains the case (before `move` for readability):

```ts
      case "animate": {
        await this.narrationBarrier();
        if (signal.aborted) return;
        const rp = this.reprojector;
        const after = this.plan.states[index].params;
        if (!rp) {
          // No reprojection surface (headless tests, degraded backends): keep the pacing.
          return this.waitScaled(step.seconds * 1000, signal);
        }
        const visible = new Set(before.visible);
        await this.progress(step.seconds * 1000, signal, (t) => {
          const e = t * t * (3 - 2 * t); // smoothstep
          const cur: Record<string, number> = { ...before.params };
          for (const key of Object.keys(step.targets)) {
            const start = step.starts[key];
            cur[key] = start === null ? step.targets[key] : start + (step.targets[key] - start) * e;
          }
          rp.frame(cur, visible, before.offsets);
        });
        if (signal.aborted) return; // a scrub's renderUpTo owns the state now
        this.applyParams(after);
        this.applyScene(this.plan.states[index]);
        return;
      }
```

The final `applyScene(this.plan.states[index])` matters: `commit` returns freshly `prepare()`-hidden handles; the scene application re-finishes the visible ones and re-applies offsets, leaving the settled figure on screen before the next step runs.

- [ ] **Step 4: Run** — `npx vitest run tests/animate.test.ts tests/player-sync.test.ts tests/narrated-actions.test.ts`, then the full suite.

- [ ] **Step 5: Commit**

```bash
git add src/render/player.ts tests/animate.test.ts
git commit -m "feat: player animate action — smoothstep param frames, boundary-exact commits"
```

---

### Task 6: Wiring (`render/index.ts`), prompt, template docs, bundled example

**Files:**
- Modify: `src/render/index.ts`
- Modify: `src/llm/prompts/compiler-v1.md` (the gesture-rules block around line 31)
- Modify: `src/scenes/molecule_3d/template.yaml` (description + example)
- Modify: `src/examples.json`
- Test: whichever test validates `examples.json` (locate with `grep -rl examples.json tests/`) must pass; no new test files

**Interfaces consumed:** `withOverrides` (Task 2), `PlanOptions.animateBase`/`bboxesFor` (Task 3), `MountResult.swapGeometry`/`remount` (Task 4), `Player.reprojector` (Task 5).

**Steps:**

- [ ] **Step 1: Wire `render()`** (`src/render/index.ts`, after `const bboxes = …`):

```ts
  // Param-state layouts for the animate command. Boundary layouts (commit,
  // plan-time bboxes) are cached; per-frame layouts are NOT (every tween tick
  // is a distinct param set — caching them would hoard hundreds of layouts).
  const boundaryLayouts = new Map<string, LayoutResult>();
  const layoutFor = (params: Record<string, number>, cache: boolean): LayoutResult => {
    if (Object.keys(params).length === 0) return layout;
    const key = JSON.stringify(Object.entries(params).sort());
    const hit = cache ? boundaryLayouts.get(key) : undefined;
    if (hit) return hit;
    const l = layoutSpec({ ...spec, params: withOverrides(spec.params, params) }, measure);
    if (cache) boundaryLayouts.set(key, l);
    return l;
  };
```

Extend the `planCommands` call:

```ts
  const plan = planCommands(spec.commands, layout.order, {
    bboxOf: (id) => bboxes.get(id) ?? null,
    ...domainMapping(spec.domain),
    animateBase: spec.template ? spec.params ?? {} : null,
    bboxesFor: (params) => {
      const b = elementBBoxes(layoutFor(params, true), measure);
      return (id) => b.get(id) ?? null;
    },
  });
```

After `const player = new Player(…)`:

```ts
  if (mounted.swapGeometry && mounted.remount) {
    player.reprojector = {
      frame: (params, visible, offsets) => mounted.swapGeometry!(layoutFor(params, false), visible, offsets),
      commit: (params) => mounted.remount!(layoutFor(params, true)),
    };
  }
```

- [ ] **Step 2: Prompt rule** (`src/llm/prompts/compiler-v1.md`, appended to the command-usage rules near the gesture bullet):

```
- **animate** changes NUMERIC template params smoothly while the paired speak lands: `{"animate": {"demand_shift.amount": 25}, "duration": 3, "speak": "As incomes rise, demand grows…"}`. The whole figure re-computes every frame, so intersections, guide lines, and shaded regions move honestly — a sliding demand curve drags its new equilibrium along the supply curve; steepening demand shrinks a tax's deadweight-loss triangle. Keys are dot paths into params. Always write the STARTING value explicitly in params (e.g. `demand_shift: {amount: 0}` so the primed curve starts on the original); only numeric params animate, and only on template specs. One or two animate beats per figure at the moments of change; draw the elements first, animate them after.
```

- [ ] **Step 3: molecule_3d** (`src/scenes/molecule_3d/template.yaml`): description gains one sentence — `Rotate the whole molecule smoothly with the animate command: {"animate": {"azimuth": 240}, "duration": 3} (write the starting azimuth in params).` — and the water example's params keep the explicit `azimuth: 40` (already present; ensure the methane example gains `azimuth: 32` so both are animate-ready). Bump the template's `version` if the doc-validation tests require it (check `tests/template-doc.test.ts` conventions).

- [ ] **Step 4: Bundled example** (`src/examples.json`): add one example, e.g. title "Demand shift, animated": `template: supply_demand`, `params: { demand: { steepness: 1 }, demand_shift: { amount: 0 } }`, commands telling the classic story — narrated draws of axes/curves/equilibrium; then `{"animate": {"demand_shift.amount": 22}, "duration": 3, "speak": "Now incomes rise — at every price, buyers want more, so the whole curve slides to the right."}`; then narrated draw of `shift_equilibrium_point` + `shift_guide_lines` + `label_E_shift` ("Where it crosses supply, both price and quantity have risen."); a closing highlight on the equilibrium pair. Follow the JSON shape of the existing examples exactly (find how they set style/title). Run the examples-validation test.

- [ ] **Step 5: Gate + commit**

```bash
npx tsc && npx vitest run
git add src/render/index.ts src/llm/prompts/compiler-v1.md src/scenes/molecule_3d/template.yaml src/examples.json
git commit -m "feat: animate wiring — reprojector, param-aware plan bboxes, prompt rule, example"
```

---

### Task 7: Final verification, visual gate, docs, push

**Files:** `ROADMAP.md`; no code beyond fixes the gate demands.

- [ ] **Step 1: Full gates** — `npx tsc && npx vitest run && npm run build`.
- [ ] **Step 2: Visual gate** (dev server, repo convention — throwaway checks, screenshots referenced in the task report):
  - Load the new "Demand shift, animated" example: the curve must SLIDE (not shimmer/boil — seeds are pinned), E′ must glide along the supply curve, labels must follow without wild hopping. If a label flips sides mid-tween, record it as a known niggle with a screenshot (candidate follow-up: freeze label placement during frames) — do not fix it in this plan.
  - Scrub: drag the seek bar back across the animate boundary (figure returns to the un-shifted state), forward again (shifted state), restart from the beginning (original figure — the spec was never mutated).
  - Instant mode: end state appears at once.
  - Editor: hand-write `{"animate": {"demand.steepness": 2.2}, "duration": 3, "speak": "…"}` on a spec with `demand: {steepness: 0.6}` + `tax: {}` — the deadweight-loss triangle must visibly shrink as demand steepens.
  - Rough perf check: the tween must look smooth (~30 fps+) on supply_demand; note in the report if frames visibly chug.
- [ ] **Step 3: Export smoke** (needs the BYOK TTS key — if unavailable, hand to Hans as a smoke note): export the animated example; the slide must be in the video (the exporter replays real-time, so no code was touched — this is a confirmation, not a feature test).
- [ ] **Step 4: ROADMAP.md** — under Phase C, replace the `morph` bullet's "on the M5 diff/tween machinery" framing with a note that the `animate` command (param animation, this plan) shipped and that `morph`/spec-diff tweening for untemplated specs remains open, buildable on the same reprojection primitive. Add a Done-section entry for animate.
- [ ] **Step 5: Commit + push**

```bash
git add ROADMAP.md
git commit -m "docs: roadmap — animate command delivered; morph scoped to untemplated specs"
git push
```

Smoke notes for Hans: the two demos above (slide + steepness/DWL), scrub across the boundary, one exported video with the slide.

---

## Self-Review Notes

- **Spec coverage:** parked Task 2 (seed pinning) — already shipped (`hashSeed`, svg-backend.ts:165), dropped; parked Task 2's reprojection — Task 4/5 here, upgraded to the frame-swap/commit split; parked Task 3 (command end-to-end) — Tasks 3+5; parked Task 4 (export/prompt/example) — export needs nothing (real-time replay exporter), prompt/example in Task 6; revival prerequisite (numeric shift params) — Task 1, extended with numeric steepness (Hans, 2026-08-23) and the shift equilibrium.
- **Rulings changed vs the parked plan, deliberately:** end params are NOT persisted into `spec.params` (breaks restart); they live in `SceneState.params` with `renderUpTo` committing boundaries — strictly more exact, and it makes abort handling trivial (abort = do nothing, the scrubber applies its own boundary).
- **Known v1 limits (documented, not bugs):** animate on non-template specs warns + no-ops; qualitative enum params don't animate; both-curves-shifted emits no shift equilibrium; label placement re-solves per frame and may occasionally flip a side mid-tween (watch item in the visual gate).
- **Type consistency check:** `Reprojector.frame/commit` signatures match Task 6's wiring; `PlanOptions.animateBase/bboxesFor` match Task 3's tests; `starts: Record<string, number | null>` matches the player's `start === null` branch; `SceneState.params` is read by `stateAt(n).params` and `plan.states[index].params` in Task 5.
