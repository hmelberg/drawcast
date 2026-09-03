# Charts Round Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add stacked bars and a slope mode to the data pack, build animated
race charts (bar race + line race) that stay smooth under the existing tween,
add a heatmap, and let six existing templates be fed by `{id.var}` data tokens.

**Architecture:** Everything rides the machinery the data bridge already
built: staged `values`, a numeric `stage` param, and `animate` re-running the
template's layout body per frame. Two new templates (`bar_race`, `heatmap`)
join `src/scenes/packs/data.yaml`; `bar_chart` and `line_chart` gain params;
the player gains one optional `easing`; and a schema-widening helper lets any
template opt into data tokens with one manifest flag.

**Tech Stack:** TypeScript, Vite, Vitest (`environment: "node"`), template
bodies as sandboxed JS strings in YAML packs, rough.js SVG rendering,
Playwright for live smoke.

**Spec:** `docs/superpowers/specs/2026-09-03-charts-round-design.md`

## Global Constraints

- **Commit named files only — never `git add -A`.** Another session is
  implementing R and other language runtimes in this repo and owns
  `src/code/*`. Rebase (`git pull --rebase`) before pushing.
- **Never touch `src/code/*`.** This round's surface is `src/scenes/*`,
  `src/render/{plan,player,effects}.ts`, `src/spec/{types,schema}.ts`
  (animate `easing` only), `src/layout/axes.ts`, tests and examples.
- **Contrast numbers are computed, never asserted.** Any claim like "4.5:1"
  must come from a calculation in the test.
- **Every new assertion must be seen to fail** before the implementation
  lands. Run the test first; paste the failure into the commit body when it
  is not obvious.
- **`h()` throws under `environment: "node"`** — keep new logic pure so it is
  unit-testable.
- **Bump `kit:` in a pack template** whose body starts calling a kit function
  it did not call before. `KIT_VERSION` lives in `src/scenes/kit.ts`.
- **Template ids in `element_ids` must match what the body emits**, and the
  offline examples test requires one bundled example per `status: ready`
  template.
- Full suite: `npx vitest run` — **never pipe it through `grep`** (a pipe
  hides a red suite behind exit code 0).

---

## File Structure

| File | Responsibility |
|---|---|
| `src/scenes/packs/data.yaml` | Modified: `stacked` on bar_chart, `slope` on line_chart, race params on line_chart, new `bar_race` and `heatmap` templates |
| `src/layout/axes.ts` | Modified: `X_CAPTION_DROP` hoisted here from three template bodies |
| `src/scenes/doc.ts` | Modified: `accepts_data` manifest flag |
| `src/scenes/data-schema.ts` | **New**: `widenForDataTokens(schema)` — the one place a schema learns the token string |
| `src/scenes/registry.ts` | Modified: apply the widening at registration |
| `src/spec/types.ts`, `src/spec/schema.ts` | Modified: `easing` on an animate command |
| `src/render/plan.ts`, `src/render/player.ts` | Modified: carry and apply the animate easing |
| `tests/data-pack.test.ts` | Modified: stacked, slope, heatmap body tests |
| `tests/bar-race.test.ts` | **New**: continuous rank, top_n airlock, id stability |
| `tests/animate-easing.test.ts` | **New**: easing plumbing + narration-under-tween regression |
| `tests/data-tokens-widening.test.ts` | **New**: the widening helper and the six retrofitted templates |

---

## Task 1: Stacked bars

**Files:**
- Modify: `src/scenes/packs/data.yaml` (bar_chart: `stacked` param, body, one example)
- Test: `tests/data-pack.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `bar_chart` accepts `stacked: boolean`. Segment drawable ids stay
  `bar_<i>__f<j>` where `j` is the series index — the id shape later tasks
  and existing tests already use.

- [ ] **Step 1: Write the failing tests**

Add to `tests/data-pack.test.ts`:

```ts
describe("stacked bars", () => {
  const stacked = (extra: object = {}) =>
    layout({
      labels: ["A", "B"],
      series: [
        { name: "One", values: [3, 1] },
        { name: "Two", values: [1, 3] },
      ],
      stacked: true,
      ...extra,
    });

  test("segments sit on top of each other, totals equal across categories", () => {
    const l = stacked();
    const seg = (i: number, j: number) => area(l, `bar_${i}__f${j}`)!.pts.map((p) => p[1]);
    // Series 0 starts at the axis; series 1 starts where series 0 ended.
    expect(Math.min(...seg(1, 0))).toBeCloseTo(plot.y0, 1);
    expect(Math.min(...seg(1, 1))).toBeCloseTo(Math.max(...seg(1, 0)), 1);
    // Both stacks total 4, so both reach the same height.
    expect(Math.max(...seg(1, 1))).toBeCloseTo(Math.max(...seg(2, 1)), 1);
  });

  test("the y scale comes from stack totals, not the largest single value", () => {
    const l = stacked();
    // Totals are 4; a grouped chart would scale to the largest bar, 3.
    const top = Math.max(...area(l, "bar_1__f1")!.pts.map((p) => p[1]));
    expect(top).toBeCloseTo(Y(4, 4), 0);
  });

  test("mixed signs refuse to stack: an issue names the series, bars group instead", () => {
    const l = layout({
      labels: ["A"],
      series: [
        { name: "Up", values: [3] },
        { name: "Down", values: [-2] },
      ],
      stacked: true,
    });
    expect(l.issues.some((i) => /stacked/i.test(i.message) && /Down/.test(i.message))).toBe(true);
    // Grouped fallback: the two bars are side by side, so their x spans differ.
    const x = (j: number) => area(l, `bar_1__f${j}`)!.pts.map((p) => p[0]);
    expect(Math.min(...x(0))).not.toBeCloseTo(Math.min(...x(1)), 1);
  });

  test("a fractional stage interpolates stacked segment heights", () => {
    const l = layout({
      labels: ["A"],
      series: [
        { name: "One", values: [[2], [4]] },
        { name: "Two", values: [[2], [2]] },
      ],
      stacked: true,
      stage: 0.5,
    });
    // Series 0 is 2 → 4, half-way is 3; the stack total is 5.
    expect(Math.max(...area(l, "bar_1__f0")!.pts.map((p) => p[1]))).toBeCloseTo(Y(3, 6), 0);
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run tests/data-pack.test.ts -t "stacked"`
Expected: FAIL — segments overlap at the axis, scale comes from 3 not 4, no issue is raised.

- [ ] **Step 3: Add the param to the bar_chart schema**

In `src/scenes/packs/data.yaml`, inside `template: bar_chart` → `params.properties`:

```yaml
    stacked:
      type: boolean
      description: "Stack the series on top of each other instead of grouping them side by side (requires `series`). The y scale then comes from the stack TOTAL. Use for composition — how a total splits — not for comparing series to each other. Values must all be positive: a stack of mixed signs misstates the total, so it falls back to grouped bars and reports the problem."
```

Bump `version: 1` → `2` for `bar_chart`.

- [ ] **Step 4: Implement in the bar_chart body**

In the `layout: |` body, after the series are normalised and before the
limits are computed:

```js
  const wantStacked = params.stacked === true && series.length > 1;
  const negatives = wantStacked
    ? series.filter((s) => s.stages.some((st) => st.some((v) => typeof v === "number" && v < 0)))
    : [];
  const stacked = wantStacked && negatives.length === 0;
  if (wantStacked && negatives.length > 0) {
    issue(`stacked bars need non-negative values — "${negatives[0].name}" has a negative value, so the bars are grouped instead`);
  }
```

Use the pack's existing issue helper (the same call the token placeholder
path uses — grep `issues.push` in the body and follow it).

Limits, when `stacked`: replace the per-value min/max scan with a per-stage,
per-label **total** scan:

```js
  if (stacked) {
    for (let k = 0; k < K; k++) {
      for (let i = 0; i < n; i++) {
        let tot = 0;
        for (const s of series) { const v = at(s, k, i); if (typeof v === "number") tot += v; }
        hi = Math.max(hi, tot);
        lo = Math.min(lo, 0);
      }
    }
  }
```

Geometry, when `stacked`: every series shares the full category slot width
(no per-series offset), and each segment's baseline is the running total of
the segments below it at the *interpolated* stage:

```js
  // Stacked: one column per category, segments piled bottom-up in series
  // order. The baseline is the running total BELOW this segment, computed
  // from interpolated values so a fractional stage re-proportions smoothly.
  const baseFor = (i, j) => {
    let b = 0;
    for (let q = 0; q < j; q++) b += valueAt(series[q], i);
    return b;
  };
```

where `valueAt` is the body's existing interpolated-value helper (the one
that already lerps between `k0` and `k1`).

Value labels, when `stacked` and `value_labels`: a segment gets its own label
only when its drawn height is ≥ 26 units; the stack total is written above
the column.

- [ ] **Step 5: Run the tests**

Run: `npx vitest run tests/data-pack.test.ts -t "stacked"`
Expected: PASS, 4 tests.

- [ ] **Step 6: Add the bundled example**

In `bar_chart`'s `examples:` list:

```yaml
  - request: "Stacked bars: how total health spending splits between hospitals, primary care and drugs, 2015 vs 2020."
    params:
      labels: ["2015", "2020"]
      stacked: true
      value_labels: true
      series:
        - { name: "Hospitals", values: [52, 61] }
        - { name: "Primary care", values: [24, 29] }
        - { name: "Drugs", values: [14, 18] }
      y_label: "Billion NOK"
      title: "Health spending by sector"
```

- [ ] **Step 7: Run the full data-pack suite**

Run: `npx vitest run tests/data-pack.test.ts`
Expected: PASS — including "every manifest example lays out with zero warnings".

- [ ] **Step 8: Commit**

```bash
git add src/scenes/packs/data.yaml tests/data-pack.test.ts
git commit -m "feat(data): stacked bars on bar_chart — totals scale the axis, mixed signs refuse"
```

---

## Task 2: Slope mode

**Files:**
- Modify: `src/scenes/packs/data.yaml` (line_chart: `slope`, `color_by`, body branch, one example)
- Test: `tests/data-pack.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `line_chart` accepts `slope: boolean` and `color_by: "series" | "direction"`. Series drawable ids are unchanged (`series_<k>` — confirm the body's actual id shape before writing tests and use that shape).

- [ ] **Step 1: Read the existing line_chart body**

Find the id shape it emits for a series line and its end label, and the
helper that dodges end labels. Write them down; the tests below must use the
real ids, not invented ones.

- [ ] **Step 2: Write the failing tests**

```ts
describe("slope mode", () => {
  const slope = (extra: object = {}) =>
    layoutSpec({
      template: "line_chart",
      params: {
        slope: true,
        x: ["Before", "After"],
        series: [
          { name: "Treated", values: [10, 16] },
          { name: "Control", values: [12, 9] },
        ],
        ...extra,
      },
    } as Spec);

  test("both ends carry a name and a value", () => {
    const texts = flattenDrawables(slope().drawables).filter((d) => d.kind === "text") as TextDrawable[];
    const treated = texts.filter((t) => /Treated/.test(t.text));
    expect(treated.length).toBe(2);
    expect(Math.min(...treated.map((t) => t.at[0]))).toBeLessThan(Math.max(...treated.map((t) => t.at[0])));
  });

  test("labels on the same side never overlap", () => {
    const l = slope({
      series: [
        { name: "A", values: [10, 10.05] },
        { name: "B", values: [10.1, 10] },
      ],
    });
    expect(l.issues.filter((i) => /overlap/i.test(i.message))).toEqual([]);
  });

  test("color_by direction paints risers and fallers differently", () => {
    const l = slope({ color_by: "direction" });
    const strokes = flattenDrawables(l.drawables).filter((d) => d.kind === "stroke") as StrokeDrawable[];
    const treated = strokes.find((d) => d.id.includes("1"))!;
    const control = strokes.find((d) => d.id.includes("2"))!;
    expect(treated.style.color).not.toBe(control.style.color);
  });

  test("more than two values per series reports a problem", () => {
    const l = slope({ series: [{ name: "A", values: [1, 2, 3] }] });
    expect(l.issues.some((i) => /slope/i.test(i.message) && /two/i.test(i.message))).toBe(true);
  });
});
```

Adjust the id lookups in test 3 to the real ids found in Step 1.

- [ ] **Step 3: Run them and watch them fail**

Run: `npx vitest run tests/data-pack.test.ts -t "slope"`
Expected: FAIL — `slope` is not a known param, so nothing changes.

- [ ] **Step 4: Add the params**

```yaml
    slope:
      type: boolean
      description: "Slope chart: exactly two values per series, drawn as one straight connector each, with the name and value at BOTH ends. Choose it for before/after, two time points, or Simpson's paradox (each group's line rising while the pooled line falls). Every series must have exactly two values."
    color_by:
      type: string
      enum: ["series", "direction"]
      description: "Slope charts only. \"direction\" paints rising lines and falling lines in two inks — what makes the contrast argue. Default \"series\" keeps one colour per line."
```

Bump `line_chart`'s `version`.

- [ ] **Step 5: Implement the branch**

In the line_chart body, after series normalisation:

```js
  const slope = params.slope === true;
  if (slope) {
    const wrong = series.filter((s) => s.stages.some((st) => st.length !== 2));
    if (wrong.length > 0) issue(`slope charts need exactly two values per series — "${wrong[0].name || "series 1"}" has ${wrong[0].stages[0].length}`);
  }
```

When `slope` and no such issue: skip the x axis arrow and the numeric x
ticks; place two column ticks at `plotArea().x0 + pad` and
`plotArea().x1 - pad` carrying `x[0]` and `x[1]`; draw each series as a
single stroke between its two points; and emit `name value` labels outside
each column, dodged **per side** with the body's existing dodge helper called
once for the left set and once for the right set.

`color_by: "direction"` picks `kit.COLORS.series[0]` for a rise and
`kit.COLORS.series[1]` for a fall (use the pack's existing colour handles —
do not introduce new hex).

- [ ] **Step 6: Run the tests**

Run: `npx vitest run tests/data-pack.test.ts -t "slope"`
Expected: PASS, 4 tests.

- [ ] **Step 7: Add the example**

```yaml
  - request: "Simpson's paradox as a slope chart: both hospitals improve, the pooled average falls."
    params:
      slope: true
      color_by: "direction"
      x: ["2019", "2024"]
      series:
        - { name: "Hospital A", values: [93, 96] }
        - { name: "Hospital B", values: [78, 84] }
        - { name: "Both pooled", values: [88, 86] }
      y_label: "Survival (%)"
      title: "Each hospital improved. The average did not."
```

- [ ] **Step 8: Run the full suite and commit**

```bash
npx vitest run
git add src/scenes/packs/data.yaml tests/data-pack.test.ts
git commit -m "feat(data): slope mode on line_chart — labels both ends, colour by direction"
```

---

## Task 3: Animate easing, caps, and the narration regression test

**Files:**
- Modify: `src/spec/types.ts` (animate command `easing`), `src/spec/schema.ts` (validation), `src/render/plan.ts:443` (carry it), `src/render/player.ts:846` (apply it)
- Modify: `src/scenes/packs/data.yaml` (staged caps 12 → 200 in bar_chart and line_chart; line_chart series cap 6 → 12)
- Test: `tests/animate-easing.test.ts` (new)

**Interfaces:**
- Consumes: nothing.
- Produces: `PlanStep` of kind `"animate"` gains optional `easing?: Easing`. Absent means today's smoothstep — later tasks rely on `easing: "linear"` existing.

- [ ] **Step 1: Write the failing tests**

Create `tests/animate-easing.test.ts`:

```ts
// The animate verb's pacing. Two things are pinned: an explicit easing
// reaches the plan (and absent stays today's smoothstep), and a narrated
// animate tweens UNDER its narration rather than after it — the property a
// thirty-second race depends on, which nothing pinned before.

import { describe, expect, test } from "vitest";
import { planCommands } from "../src/render/plan";
import { EASINGS } from "../src/render/effects";

const plan = (cmd: object) =>
  planCommands([cmd] as never, ["fig"], { bboxOf: () => null, animateBase: { stage: 0 } } as never);

describe("animate easing", () => {
  test("an explicit easing reaches the step", () => {
    const step = plan({ animate: { stage: 3 }, duration: 10, easing: "linear" }).steps[0];
    expect(step).toMatchObject({ kind: "animate", easing: "linear" });
  });

  test("no easing leaves the step's easing undefined (the smoothstep default)", () => {
    const step = plan({ animate: { stage: 3 }, duration: 10 }).steps[0];
    expect((step as { easing?: string }).easing).toBeUndefined();
  });

  test("linear is the identity, so a race runs at constant speed", () => {
    expect(EASINGS.linear(0.25)).toBeCloseTo(0.25, 6);
    expect(EASINGS.linear(0.75)).toBeCloseTo(0.75, 6);
  });
});

describe("narrated animate", () => {
  test("the narration rides on the animate step, so the prelude runs them together", () => {
    const step = plan({ animate: { stage: 3 }, duration: 10, speak: "Watch the 80s." }).steps[0];
    // The player's narrated-action prelude (player.ts:494) runs
    // Promise.all([action, voice]) for any step carrying `narration`. If a
    // future edit moved the speech into its own blocking step, the race
    // would go silent-then-move and this assertion would catch it.
    expect(step).toMatchObject({ kind: "animate", narration: "Watch the 80s." });
    expect(plan({ animate: { stage: 3 }, speak: "x" }).steps.filter((s) => s.kind === "speak")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run and watch fail**

Run: `npx vitest run tests/animate-easing.test.ts`
Expected: FAIL on the first test — `easing` is dropped by the planner.

- [ ] **Step 3: Allow `easing` on an animate command**

`src/spec/types.ts`: the command type already has `easing?: Easing` for
`move` — confirm, and widen the comment to name animate.

`src/spec/schema.ts`: find the clause that restricts `easing` to `move` (grep
`easing` near the `duration only applies to animate` rule at line 732) and
allow `animate` as well, keeping the rejection for every other verb.

- [ ] **Step 4: Carry it through the planner**

`src/render/plan.ts`, the animate branch (~line 443):

```ts
      pushStep({
        kind: "animate",
        targets,
        starts,
        seconds: cmd.duration ?? 2,
        ...(cmd.easing !== undefined ? { easing: cmd.easing } : {}),
        ...(Object.keys(varTargets).length > 0 ? { varTargets } : {}),
      });
```

and add `easing?: Easing` to the animate variant of `PlanStep` (line 51).

- [ ] **Step 5: Apply it in the player**

`src/render/player.ts`, the animate case (~line 846):

```ts
        // Absent easing keeps the historical smoothstep exactly; a long race
        // asks for `linear` so the middle years do not blur past while the
        // ends crawl.
        const ease = step.easing ? EASINGS[step.easing] : (t: number) => t * t * (3 - 2 * t);
        await this.progress(step.seconds * 1000, signal, (t) => {
          const e = ease(t);
```

- [ ] **Step 6: Run the tests**

Run: `npx vitest run tests/animate-easing.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 7: Raise the caps**

In `src/scenes/packs/data.yaml`, for both `bar_chart` and `line_chart`:
change every staged-array `maxItems: 12` (the OUTER array — the list of
stages) to `maxItems: 200`, and in `line_chart` change `series`'
`maxItems: 6` to `12` plus the body's `params.series.slice(0, 6)` to
`slice(0, 12)`. Leave `bar_chart`'s series cap at 6 — grouped bars past six
series are unreadable, and the race template covers many-entity charts.

Add to both descriptions: "Up to 200 stages, but a script's harvest caps at
5000 numbers — 20 series × 200 stages fits, 40 × 200 does not."

- [ ] **Step 8: Full suite and commit**

```bash
npx vitest run
git add src/spec/types.ts src/spec/schema.ts src/render/plan.ts src/render/player.ts src/scenes/packs/data.yaml tests/animate-easing.test.ts
git commit -m "feat(animate): optional easing (absent keeps smoothstep); 200 stages, 12 lines; pin narration-under-tween"
```

---

## Task 4: `bar_race` — rank, rows and ids

**Files:**
- Modify: `src/scenes/packs/data.yaml` (new template `bar_race`, horizontal only in this task)
- Test: `tests/bar-race.test.ts` (new)

**Interfaces:**
- Consumes: `kit` v5 (`COLORS.series`, `plotArea`), the staged-values idiom from `bar_chart`.
- Produces: template `bar_race` with ids `race_1 … race_N` **by input order**; params `labels`, `values`, `stage`, `top_n`, `order`, `orientation`, `ticker`, `value_labels`, `xlim`, `title`, `x_label`, `decimals`.

- [ ] **Step 1: Write the failing tests**

Create `tests/bar-race.test.ts`:

```ts
// The bar race. What is pinned: rank is interpolated (never recomputed from
// interpolated values), a racer's id follows the RACER and not its rank —
// the rough.js seed is hashSeed(id), so a rank-keyed id would re-roll a
// bar's sketchy stroke mid-overtake — and the top_n airlock lets a racer
// slide in and out instead of popping.

import { beforeAll, describe, expect, test } from "vitest";
import dataYaml from "../src/scenes/packs/data.yaml?raw";
import { registerPack } from "../src/scenes/packs";
import { scenes } from "../src/scenes/registry";
import { layoutSpec } from "../src/layout/layout";
import { flattenDrawables, type AreaDrawable } from "../src/layout/model";
import type { Spec } from "../src/spec/types";

beforeAll(() => {
  expect(registerPack("data", dataYaml).errors).toEqual([]);
});

const race = (params: object) => layoutSpec({ template: "bar_race", params } as Spec);
const bar = (l: ReturnType<typeof layoutSpec>, i: number) =>
  flattenDrawables(l.drawables).find((d) => d.id === `race_${i}` && d.kind === "area") as AreaDrawable | undefined;
const rowY = (l: ReturnType<typeof layoutSpec>, i: number) => {
  const pts = bar(l, i)!.pts;
  return (Math.min(...pts.map((p) => p[1])) + Math.max(...pts.map((p) => p[1]))) / 2;
};
const barLen = (l: ReturnType<typeof layoutSpec>, i: number) => {
  const xs = bar(l, i)!.pts.map((p) => p[0]);
  return Math.max(...xs) - Math.min(...xs);
};

// Two racers that swap between stage 0 and stage 1.
const SWAP = { labels: ["A", "B"], values: [[10, 6], [6, 10]] };

describe("bar_race", () => {
  test("is a ready template with one id per racer, in input order", () => {
    expect(scenes.bar_race?.manifest.status).toBe("ready");
    const l = race({ ...SWAP, stage: 0 });
    expect(l.order.filter((id) => id.startsWith("race_"))).toEqual(["race_1", "race_2"]);
  });

  test("the row position glides across the crossing instead of jumping", () => {
    const at = (s: number) => rowY(race({ ...SWAP, stage: s }), 1);
    const [y0, quarter, half, threeQ, y1] = [0, 0.25, 0.5, 0.75, 1].map(at);
    // Monotone, and the quarter step is a real fraction of the whole move —
    // a rank-snap would leave y unchanged until it jumped.
    expect(Math.abs(quarter - y0)).toBeGreaterThan(Math.abs(y1 - y0) * 0.15);
    expect(half).toBeCloseTo((y0 + y1) / 2, 0);
    expect(Math.abs(threeQ - y0)).toBeGreaterThan(Math.abs(quarter - y0));
  });

  test("bar length interpolates with the value", () => {
    expect(barLen(race({ ...SWAP, stage: 0.5 }), 1)).toBeCloseTo(barLen(race({ ...SWAP, stage: 0.5 }), 2), 0);
  });

  test("an id belongs to a racer, not to a rank", () => {
    // A is ahead at stage 0 and behind at stage 1; race_1 is A at both.
    const first = race({ ...SWAP, stage: 0 });
    const last = race({ ...SWAP, stage: 1 });
    expect(rowY(first, 1)).not.toBeCloseTo(rowY(last, 1), 0);
    const label = (l: ReturnType<typeof layoutSpec>) =>
      flattenDrawables(l.drawables).filter((d) => d.kind === "text" && d.id === "race_1").map((d) => (d as { text: string }).text);
    expect(label(first).join(" ")).toContain("A");
    expect(label(last).join(" ")).toContain("A");
  });

  test("top_n keeps the field to n rows, and the n+1th is the airlock", () => {
    const l = race({
      labels: ["A", "B", "C", "D"],
      values: [[10, 8, 6, 4]],
      top_n: 2,
      stage: 0,
    });
    expect(bar(l, 1)).toBeDefined();
    expect(bar(l, 2)).toBeDefined();
    // Third place sits in the fading airlock row; fourth is not drawn at all.
    expect(bar(l, 4)).toBeUndefined();
  });

  test("a racer climbing into the field fades in rather than popping", () => {
    const climbing = { labels: ["A", "B", "C"], values: [[10, 8, 1], [10, 1, 8]], top_n: 2 };
    const mid = race({ ...climbing, stage: 0.5 });
    const end = race({ ...climbing, stage: 1 });
    const op = (l: ReturnType<typeof layoutSpec>) => bar(l, 3)?.style.opacity ?? 0;
    expect(op(mid)).toBeGreaterThan(0);
    expect(op(mid)).toBeLessThan(op(end));
  });

  test("order: fixed keeps input order and animates lengths only", () => {
    const fixed = { ...SWAP, order: "fixed" };
    expect(rowY(race({ ...fixed, stage: 0 }), 1)).toBeCloseTo(rowY(race({ ...fixed, stage: 1 }), 1), 3);
  });
});
```

- [ ] **Step 2: Run and watch fail**

Run: `npx vitest run tests/bar-race.test.ts`
Expected: FAIL — unknown template `bar_race`.

- [ ] **Step 3: Write the manifest**

Append to `src/scenes/packs/data.yaml` (a `---` separator, then the doc).
`version: 1`, `kit: 5`, `status: ready`, params per spec §5.1, and:

```yaml
element_ids:
  axes: the value axis with its caption and ticks
  race_1: "the first racer's bar (its fill, name and value label; race_2, race_3, … likewise) — one per label, in INPUT order, at every stage"
  ticker: the large stage caption (the year), when set
  title: figure title, when set
```

Description must say: horizontal by default; ranks reorder unless
`order: fixed`; `top_n` bounds the field; `animate: {stage: N}` with
`easing: linear` plays the race; up to 200 stages but a script's harvest
caps at 5000 numbers, so 20 racers × 200 stages fits.

- [ ] **Step 4: Implement the body — rank and rows**

```js
  // Rank at each INTEGER stage, then interpolated. Ranking interpolated
  // values instead would hold a racer in row 3 until the exact crossing
  // frame and then jump it to row 4; interpolating the rank glides it
  // across the whole interval, which is what makes a race read as motion.
  const rankAt = (k) => {
    const idx = labels.map((_, i) => i);
    idx.sort((a, b) => (valueAtStage(b, k) - valueAtStage(a, k)) || (a - b));
    const r = new Array(labels.length);
    idx.forEach((i, pos) => { r[i] = pos; });
    return r;
  };
  const r0 = rankAt(k0), r1 = rankAt(k1);
  const rowPos = (i) => (order === "fixed" ? i : r0[i] + (r1[i] - r0[i]) * t);
  const value = (i) => valueAtStage(i, k0) + (valueAtStage(i, k1) - valueAtStage(i, k0)) * t;
```

Rows: row height from the plot height divided by `topN`; a racer's y from
`rowPos(i)`. Draw a racer when `rowPos(i) < topN + 1`; opacity ramps linearly
from 1 at `rowPos === topN - 1` to 0 at `rowPos === topN` (the airlock row),
clamped to `[0, 1]`.

Ids: `race_${i + 1}` where `i` is the **input index** — never the rank.
Colour: `kit.COLORS.series[i % kit.COLORS.series.length]`, likewise by input
index. Add the comment naming `hashSeed` so the next reader knows why.

- [ ] **Step 5: Run the tests**

Run: `npx vitest run tests/bar-race.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 6: Commit**

```bash
git add src/scenes/packs/data.yaml tests/bar-race.test.ts
git commit -m "feat(data): bar_race — interpolated rank, ids by racer, top_n airlock"
```

---

## Task 5: `bar_race` — scale, ticker, labels, vertical, examples

**Files:**
- Modify: `src/scenes/packs/data.yaml` (bar_race body and examples)
- Test: `tests/bar-race.test.ts`

**Interfaces:**
- Consumes: Task 4's `bar_race` body, `rowPos`, `value`.
- Produces: the finished template; Task 8 smokes it.

- [ ] **Step 1: Write the failing tests**

```ts
describe("bar_race scale and furniture", () => {
  const growing = { labels: ["A", "B"], values: [[10, 5], [100, 50]] };

  test("the scale follows the leader, so the leader always fills the plot", () => {
    const early = race({ ...growing, stage: 0 });
    const late = race({ ...growing, stage: 1 });
    expect(barLen(early, 1)).toBeCloseTo(barLen(late, 1), 0);
  });

  test("xlim fixes the scale instead", () => {
    const early = race({ ...growing, stage: 0, xlim: [0, 100] });
    const late = race({ ...growing, stage: 1, xlim: [0, 100] });
    expect(barLen(early, 1)).toBeLessThan(barLen(late, 1) * 0.2);
  });

  test("tick values are chosen once and only their positions move", () => {
    const texts = (s: number) =>
      flattenDrawables(race({ ...growing, stage: s }).drawables)
        .filter((d) => d.kind === "text" && d.id === "axes")
        .map((d) => (d as { text: string }).text);
    // The same tick vocabulary at both ends — ticks slide, they do not reflow.
    expect(new Set(texts(1)).size).toBeGreaterThan(1);
    expect(texts(0.5).every((t) => texts(1).includes(t))).toBe(true);
  });

  test("the ticker shows the nearest stage's caption, never a blend", () => {
    const l = race({ ...growing, ticker: ["1990", "2020"], stage: 0.6 });
    const tick = flattenDrawables(l.drawables).find((d) => d.id === "ticker") as { text: string };
    expect(tick.text).toBe("2020");
  });

  test("vertical orientation puts names under the bars and caps the field at 12", () => {
    const l = race({
      labels: Array.from({ length: 15 }, (_, i) => "P" + i),
      values: [Array.from({ length: 15 }, (_, i) => 15 - i)],
      orientation: "vertical",
      stage: 0,
    });
    expect(l.issues.filter((i) => /overlap/i.test(i.message))).toEqual([]);
    expect(bar(l, 13)).toBeUndefined();
  });

  test("value labels stay inside the plot at full length", () => {
    const l = race({ labels: ["A"], values: [[100]], value_labels: true, stage: 0, decimals: 0 });
    const label = flattenDrawables(l.drawables).find((d) => d.kind === "text" && /100/.test((d as { text: string }).text)) as { at: [number, number] };
    expect(label.at[0]).toBeLessThan(plot.x1);
  });
});
```

- [ ] **Step 2: Run and watch fail**

Run: `npx vitest run tests/bar-race.test.ts -t "scale and furniture"`
Expected: FAIL.

- [ ] **Step 3: Implement the scale**

```js
  // A race rescales: the leader defines the plot, so early years are not
  // squashed into nothing. Tick VALUES come from the final stage's
  // magnitude once; their positions are recomputed every frame and ticks
  // outside the current range are dropped, so ticks slide rather than
  // reflow.
  const auto = !Array.isArray(params.xlim);
  const hiNow = Math.max(1e-9, ...labels.map((_, i) => value(i)));
  const [xLo, xHi] = auto ? [0, hiNow * 1.08] : [Math.min(...params.xlim), Math.max(...params.xlim)];
  const tickStep = niceStep(Math.max(...labels.map((_, i) => valueAtStage(i, K - 1))));
  const ticks = [];
  for (let v = 0; v <= xHi; v += tickStep) ticks.push(v);
```

`niceStep` is a local helper (1/2/5 × 10^n). Ticks render with id `axes`.

- [ ] **Step 4: Implement ticker, value labels, vertical**

- Ticker: `ticker[Math.round(stage)]`, clamped, drawn at 46px in the
  plot's lower-right corner at reduced opacity, id `ticker`. Never blend two
  captions — text does not interpolate.
- Value label: rides the bar's end, offset 8 units, right-aligned inside the
  plot when the bar reaches the edge.
- Vertical: bars grow upward, names sit under the bars, field capped at 12
  racers (`top_n` clamped to 12); the value label sits above the bar.

- [ ] **Step 5: Run the tests**

Run: `npx vitest run tests/bar-race.test.ts`
Expected: PASS, 13 tests.

- [ ] **Step 6: Add two examples**

```yaml
examples:
  - request: "Bar chart race: the world's top chess players by Elo, 1971 to 2021."
    params:
      labels: ["Fischer", "Karpov", "Kasparov", "Kramnik", "Anand", "Carlsen"]
      values:
        - [2760, 2660, 0, 0, 0, 0]
        - [2780, 2725, 2595, 0, 0, 0]
        - [0, 2720, 2800, 2695, 2650, 0]
        - [0, 0, 2830, 2780, 2770, 2690]
        - [0, 0, 0, 2790, 2800, 2870]
      ticker: ["1971", "1981", "1991", "2001", "2021"]
      top_n: 5
      xlim: [2500, 2900]
      x_label: "Elo rating"
      title: "The top of the chess world"
  - request: "Race the five largest cities by population, one stage per decade."
    params:
      labels: ["Tokyo", "Delhi", "Shanghai", "São Paulo", "Mexico City"]
      values:
        - [23.3, 9.7, 13.0, 14.8, 15.6]
        - [28.4, 15.7, 16.6, 17.0, 18.0]
        - [36.9, 22.0, 20.3, 19.7, 20.1]
        - [37.3, 29.4, 27.1, 22.0, 21.8]
      ticker: ["1990", "2000", "2010", "2020"]
      value_labels: true
      decimals: 1
      x_label: "Millions"
      title: "The world's largest cities"
```

Note the chess example uses `xlim` — Elo is a range where zero is not
meaningful, and it doubles as the bundled demonstration of a fixed scale.
A racer with 0 in a stage is simply last; the description says so.

- [ ] **Step 7: Full suite and commit**

```bash
npx vitest run
git add src/scenes/packs/data.yaml tests/bar-race.test.ts
git commit -m "feat(data): bar_race scale, ticker, value labels, vertical orientation, two examples"
```

---

## Task 6: Line race — `ticker`, `x_window`, `label_top`

**Files:**
- Modify: `src/scenes/packs/data.yaml` (line_chart params, body, one example)
- Test: `tests/data-pack.test.ts`

**Interfaces:**
- Consumes: Task 3's raised caps (12 series, 200 stages).
- Produces: `line_chart` accepts `ticker`, `x_window`, `label_top`.

- [ ] **Step 1: Write the failing tests**

```ts
describe("line race", () => {
  const many = {
    x: Array.from({ length: 40 }, (_, i) => 1980 + i),
    series: Array.from({ length: 8 }, (_, k) => ({
      name: "Player " + (k + 1),
      values: [Array.from({ length: 40 }, (_, i) => 2600 + k * 20 + i * 2)],
    })),
  };
  const line = (p: object) => layoutSpec({ template: "line_chart", params: p } as Spec);

  test("x_window slides: an early x is off-plot late in the race", () => {
    const l = line({ ...many, x_window: 10, stage: 0 });
    const xs = flattenDrawables(l.drawables).filter((d) => d.kind === "stroke").flatMap((d) => (d as StrokeDrawable).pts.map((p) => p[0]));
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(plot.x0 - 1);
    expect(l.issues.filter((i) => /overlap/i.test(i.message))).toEqual([]);
  });

  test("label_top labels only the leaders", () => {
    const texts = (p: object) =>
      flattenDrawables(line(p).drawables).filter((d) => d.kind === "text" && /Player/.test((d as { text: string }).text)).length;
    expect(texts({ ...many, label_top: 3 })).toBe(3);
    expect(texts(many)).toBe(8);
  });

  test("eight lines are allowed now that the cap is twelve", () => {
    expect(templateParamErrors("line_chart", many)).toEqual([]);
  });

  test("the ticker shows the nearest stage's caption", () => {
    const l = line({
      series: [{ name: "A", values: [[1, 2], [1, 3]] }],
      ticker: ["1990", "2000"],
      stage: 0.6,
    });
    const tick = flattenDrawables(l.drawables).find((d) => d.id === "ticker") as { text: string };
    expect(tick.text).toBe("2000");
  });
});
```

- [ ] **Step 2: Run and watch fail**

Run: `npx vitest run tests/data-pack.test.ts -t "line race"`
Expected: FAIL.

- [ ] **Step 3: Add the params**

```yaml
    ticker:
      oneOf:
        - { type: array, items: { type: string }, maxItems: 200 }
        - { type: string, pattern: "^\\{[A-Za-z][A-Za-z0-9_]*\\.[A-Za-z_][A-Za-z0-9_.]*\\}$" }
      description: "One caption per stage (years, say), drawn large and dimmed in the corner as the race runs. The caption never blends: a fractional stage shows the nearer stage's caption."
    x_window:
      type: integer
      minimum: 2
      description: "Show only the last N x positions, sliding as the stage advances — a rolling window instead of an ever-shrinking line. Leave it out to keep the whole span in view."
    label_top:
      type: integer
      minimum: 1
      description: "Only the N highest lines at the current stage carry their name at the end; the rest stay drawn but unlabelled. Use it when a race has more lines than a margin can name."
```

- [ ] **Step 4: Implement**

- `ticker`: same rule and id as `bar_race` — factor the caption placement
  into the shared body helper if both bodies want it, otherwise duplicate the
  four lines with a comment pointing at the other template.
- `x_window`: when set, the x range is `[xAt(cur - n), xAt(cur)]` with `cur`
  the fractional stage's x position; points outside are clipped, not dropped
  (a clipped segment keeps the line entering the frame).
- `label_top`: rank series by value at the interpolated stage; only the top
  n get an end label; the dodge runs over that subset.

- [ ] **Step 5: Run the tests**

Run: `npx vitest run tests/data-pack.test.ts -t "line race"`
Expected: PASS, 4 tests.

- [ ] **Step 6: Add the example**

```yaml
  - request: "Race the top chess players' Elo ratings across the decades as lines."
    params:
      x: [1971, 1981, 1991, 2001, 2011, 2021]
      series:
        - { name: "Karpov", values: [[2660, 2725, 2720, 2680, 2619, 2617]] }
        - { name: "Kasparov", values: [[0, 2595, 2800, 2838, 2812, 2812]] }
        - { name: "Anand", values: [[0, 0, 2650, 2770, 2817, 2751]] }
        - { name: "Carlsen", values: [[0, 0, 0, 2690, 2815, 2847]] }
      label_top: 3
      ticker: ["1971", "1981", "1991", "2001", "2011", "2021"]
      y_label: "Elo"
      title: "Fifty years at the top"
```

- [ ] **Step 7: Full suite and commit**

```bash
npx vitest run
git add src/scenes/packs/data.yaml tests/data-pack.test.ts
git commit -m "feat(data): line race — ticker, sliding x_window, label_top"
```

---

## Task 7: Hoist `X_CAPTION_DROP`

**Files:**
- Modify: `src/layout/axes.ts` (export the drop and apply it in `axisLabelPlacement`)
- Modify: `src/scenes/packs/data.yaml` (bar_chart, line_chart, scatter_plot: delete the local constant)
- Test: `tests/data-pack.test.ts` (existing caption-clearance tests must still pass)

**Interfaces:**
- Consumes: nothing.
- Produces: `axisLabelPlacement` returns the already-dropped y for a stacked
  x caption; template bodies stop carrying their own constant.

- [ ] **Step 1: Find the three copies**

Run: `grep -n "X_CAPTION_DROP" src/scenes/packs/data.yaml`
Expected: three definitions with the same value (28) and the comment
explaining that a stacked x caption must clear the end-mark row.

- [ ] **Step 2: Run the existing clearance tests and record what passes**

Run: `npx vitest run tests/data-pack.test.ts -t "caption"`
Expected: PASS. These are the tests that must still pass after the hoist —
this is a refactor with no behaviour change.

- [ ] **Step 3: Move the constant**

In `src/layout/axes.ts`, define `X_CAPTION_DROP = 28` with the comment from
the template body (why it exists, and that 27.625 is the measured need), and
subtract it inside `axisLabelPlacement` on the stacked branch (`anchor:
"end"`) so the returned y already clears the row.

- [ ] **Step 4: Delete the three local copies**

In each of the three bodies, remove the constant and the manual subtraction;
the placement now arrives correct.

- [ ] **Step 5: Verify no behaviour changed**

Run: `npx vitest run`
Expected: PASS, and the caption tests unchanged. If any y moved, the hoist
double-applied — check that the body no longer subtracts.

- [ ] **Step 6: Commit**

```bash
git add src/layout/axes.ts src/scenes/packs/data.yaml
git commit -m "refactor(layout): hoist X_CAPTION_DROP into axisLabelPlacement (was duplicated in three bodies)"
```

---

## Task 8: Live smoke and the fps gate

**Files:**
- Create: `scripts/smoke-race.mjs` (Playwright driver, kept — it is the fps gate for future rounds)

**Interfaces:**
- Consumes: everything from Tasks 1-7.
- Produces: a recorded fps number for a 20-racer race.

- [ ] **Step 1: Start the dev server**

Run: `npm run dev` (background). Note the port.

- [ ] **Step 2: Drive a race in Chrome**

Write `scripts/smoke-race.mjs` to load the editor, paste a spec with a
`bar_race` of 20 racers over 60 stages and `- animate: {stage: 59}` with
`duration: 20, easing: linear`, press Play, and sample
`performance.now()` deltas across animation frames for the middle 10 seconds.

- [ ] **Step 3: Record the number**

Run: `node scripts/smoke-race.mjs`
Expected: median fps ≥ 50. **Record the measured number in the ledger** —
this is a measurement, not an assertion; do not round it up.

- [ ] **Step 4: If it misses the gate**

In this order, re-measuring after each: (1) cut per-bar path count to one
rounded rect with no hachure while a race is running; (2) cap tween frames to
30 fps above a drawable threshold in `Player.progress`. Do not restructure
the renderer.

- [ ] **Step 5: Runtime lint across the race**

In the same script, for 12 stages sampled across the race, assert
`layoutSpec(resolvedSpec, stage k).issues` is empty. The offline examples
test only ever sees placeholders, so this is the only place overlap at an
intermediate stage can be caught.

- [ ] **Step 6: Commit**

```bash
git add scripts/smoke-race.mjs
git commit -m "test(smoke): race fps gate and per-stage runtime lint"
```

---

## Task 9: `heatmap`

**Files:**
- Modify: `src/scenes/packs/data.yaml` (new template `heatmap`, two examples)
- Test: `tests/data-pack.test.ts`

**Interfaces:**
- Consumes: kit v5.
- Produces: template `heatmap`, ids `row_1 … row_R`, `axes`, `legend`, `title`.

- [ ] **Step 1: Write the failing tests**

```ts
describe("heatmap", () => {
  const map = (p: object) => layoutSpec({ template: "heatmap", params: p } as Spec);
  const CORR = {
    rows: ["Age", "Income", "BMI"],
    cols: ["Age", "Income", "BMI"],
    values: [[1, 0.3, 0.5], [0.3, 1, -0.2], [0.5, -0.2, 1]],
  };

  test("one drawable group per row, cells in column order", () => {
    const l = map(CORR);
    expect(l.order.filter((id) => id.startsWith("row_"))).toEqual(["row_1", "row_2", "row_3"]);
  });

  test("a bigger value gets a denser wash", () => {
    const cells = flattenDrawables(map(CORR).drawables).filter((d) => d.kind === "area" && d.id === "row_1") as AreaDrawable[];
    expect(cells[0].style.fillOpacity!).toBeGreaterThan(cells[1].style.fillOpacity!);
  });

  test("the label ink flips by COMPUTED luminance, never by a guessed cutoff", () => {
    const texts = flattenDrawables(map(CORR).drawables).filter((d) => d.kind === "text" && d.id === "row_1") as TextDrawable[];
    const lum = (hex: string) => {
      const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
      return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    };
    // The darkest cell (1.0) carries light ink; the palest (-0.2) carries dark ink.
    const dark = texts.find((t) => t.text.startsWith("1"))!;
    const pale = texts.find((t) => /0\.3/.test(t.text))!;
    expect(lum(dark.style.color)).toBeGreaterThan(lum(pale.style.color));
  });

  test("diverging scale puts negatives in the other ink", () => {
    const cells = flattenDrawables(map({ ...CORR, scale: "diverging" }).drawables).filter((d) => d.kind === "area" && d.id === "row_2") as AreaDrawable[];
    expect(cells[2].style.fill).not.toBe(cells[0].style.fill);
  });

  test("more than 12 rows or columns reports a problem", () => {
    const big = { rows: Array.from({ length: 13 }, (_, i) => "r" + i), cols: ["a"], values: Array.from({ length: 13 }, () => [1]) };
    expect(map(big).issues.some((i) => /12/.test(i.message))).toBe(true);
  });
});
```

- [ ] **Step 2: Run and watch fail**

Run: `npx vitest run tests/data-pack.test.ts -t "heatmap"`
Expected: FAIL — unknown template.

- [ ] **Step 3: Write the manifest and body**

Params: `rows`, `cols`, `values` (2-D, optionally staged: a list of 2-D
grids), `stage`, `scale` (`sequential` default, `diverging`),
`value_labels` (default true), `decimals`, `title`. All accept tokens.

Body: cells fill the plot area, 12 × 12 max (issue past that). Fill is one
ink at graded opacity (`sequential`), or two inks either side of zero
(`diverging`), normalised by the largest absolute value across all stages so
the wash does not flicker mid-tween. The label ink flips when the **computed**
relative luminance of the composited cell passes the midpoint — compute it in
the body from the ink and the wash, and put the formula in a comment.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/data-pack.test.ts -t "heatmap"`
Expected: PASS, 5 tests.

- [ ] **Step 5: Two examples**

A correlation matrix (diverging), and a confusion matrix from a script,
fed by `{clf.cm}` with typed row and column names so the placeholder promise
holds before the script runs.

- [ ] **Step 6: Full suite and commit**

```bash
npx vitest run
git add src/scenes/packs/data.yaml tests/data-pack.test.ts
git commit -m "feat(data): heatmap — graded ink wash, computed label flip, diverging scale"
```

---

## Task 10: The widening mechanism

**Files:**
- Create: `src/scenes/data-schema.ts`
- Modify: `src/scenes/doc.ts` (accept `accepts_data`), `src/scenes/registry.ts` (apply it)
- Test: `tests/data-tokens-widening.test.ts` (new)

**Interfaces:**
- Consumes: nothing.
- Produces: `widenForDataTokens(schema: object): object` — returns a deep copy
  in which every leaf typed `number`, `array of number`, `array of string` or
  `array of array of number` also accepts the data-token string. Manifest
  flag `accepts_data?: boolean`.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, test } from "vitest";
import { widenForDataTokens, DATA_TOKEN_PATTERN } from "../src/scenes/data-schema";

describe("widenForDataTokens", () => {
  test("a number leaf also accepts a token string", () => {
    const w = widenForDataTokens({ type: "object", properties: { mean: { type: "number" } } }) as never;
    expect(w.properties.mean.oneOf).toEqual([{ type: "number" }, { type: "string", pattern: DATA_TOKEN_PATTERN }]);
  });

  test("an array-of-number leaf is widened, not replaced", () => {
    const w = widenForDataTokens({ type: "object", properties: { xs: { type: "array", items: { type: "number" } } } }) as never;
    expect(w.properties.xs.oneOf[0]).toEqual({ type: "array", items: { type: "number" } });
  });

  test("a boolean or enum leaf is left alone — a token cannot be a mode", () => {
    const src = { type: "object", properties: { on: { type: "boolean" }, how: { type: "string", enum: ["a", "b"] } } };
    expect(widenForDataTokens(src)).toEqual(src);
  });

  test("it does not mutate its input", () => {
    const src = { type: "object", properties: { mean: { type: "number" } } };
    const copy = JSON.parse(JSON.stringify(src));
    widenForDataTokens(src);
    expect(src).toEqual(copy);
  });

  test("an already-widened leaf is left alone (idempotent)", () => {
    const once = widenForDataTokens({ type: "object", properties: { mean: { type: "number" } } });
    expect(widenForDataTokens(once)).toEqual(once);
  });
});
```

- [ ] **Step 2: Run and watch fail**

Run: `npx vitest run tests/data-tokens-widening.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// One place a template's params schema learns that a "{code.var}" token may
// stand in for data. Hand-editing sixty schemas would drift; this widens
// exactly the leaf shapes a harvested variable can fill, and leaves modes,
// flags and enums alone — a token cannot be a boolean.

export const DATA_TOKEN_PATTERN = "^\\{[A-Za-z][A-Za-z0-9_]*\\.[A-Za-z_][A-Za-z0-9_.]*\\}$";
```

with a recursive walk over `properties`, widening a leaf when it matches one
of the four shapes and is not already a `oneOf` containing the pattern.

- [ ] **Step 4: Wire the flag**

`src/scenes/doc.ts`: accept optional `accepts_data: boolean` (error if
present and not a boolean); carry it into the manifest in `docToManifest`.

`src/scenes/registry.ts`: when registering a doc with `accepts_data: true`,
store `params_schema: widenForDataTokens(doc.params)`.

- [ ] **Step 5: Test the wiring**

```ts
test("a template flagged accepts_data validates a token where a number belongs", () => {
  // register a one-off doc via registerPack with accepts_data: true, then:
  expect(templateParamErrors("distribution_curve", { mean: "{sim.mu}" })).toEqual([]);
});
```

- [ ] **Step 6: Run, then commit**

```bash
npx vitest run tests/data-tokens-widening.test.ts
git add src/scenes/data-schema.ts src/scenes/doc.ts src/scenes/registry.ts tests/data-tokens-widening.test.ts
git commit -m "feat(scenes): accepts_data widens a template's schema for {id.var} tokens, in one place"
```

---

## Task 11: Retrofit six templates

**Files:**
- Modify: `src/scenes/packs/stats.yaml`, `evidence.yaml`, `medicine.yaml`, `hta.yaml`, `empirics.yaml` (whichever hold the six templates — locate each with `grep -n "^template: " src/scenes/packs/*.yaml`)
- Test: `tests/data-tokens-widening.test.ts`

**Interfaces:**
- Consumes: Task 10's flag.
- Produces: `distribution_curve`, `forest_plot`, `survival_curve`, `ceac`, `did_trends`, `event_study` each carry `accepts_data: true`, tolerate an unresolved token, and say so in their description.

- [ ] **Step 1: Write the failing test**

```ts
const RETROFIT = ["distribution_curve", "forest_plot", "survival_curve", "ceac", "did_trends", "event_study"];

test.each(RETROFIT)("%s accepts data tokens and survives an unresolved one", (id) => {
  expect(scenes[id].manifest.accepts_data).toBe(true);
  const numericArrayParam = firstNumericArrayParam(id); // helper: reads the widened schema
  const l = layoutSpec({ template: id, params: { ...minimalParams(id), [numericArrayParam]: "{sim.v}" } } as Spec);
  // The editor lints BEFORE the script runs, so an unresolved token must lay
  // out as a placeholder rather than throwing or emitting an overlap.
  expect(l.warnings).toEqual([]);
  expect(l.issues.filter((i) => i.severity === "error")).toEqual([]);
});

test.each(RETROFIT)("%s tells the model it accepts tokens", (id) => {
  expect(scenes[id].manifest.description).toMatch(/\{[a-z]+\.[a-z]+\}|data token/i);
});
```

- [ ] **Step 2: Run and watch all twelve fail**

Run: `npx vitest run tests/data-tokens-widening.test.ts -t "accepts data tokens"`
Expected: FAIL — the flag is absent.

- [ ] **Step 3: Retrofit one template at a time**

For each: add `accepts_data: true`, bump `version`, run the test for that
template alone, and fix the body where an unresolved token throws or lays out
wrong — the M1 promise idiom: a token that is still a string contributes zero
points, and any typed companion param (labels, names) supplies the count.

Do not proceed to the next template until the current one is green.

- [ ] **Step 4: Add one code-fed example each**

Each retrofitted template gains one bundled example with a `code` element and
a token, following the shape of `data.yaml`'s compounding example.

- [ ] **Step 5: Prompt bullet**

In the compiler prompt (grep for the data-bridge bullet added in M1), add one
sentence: data tokens work in any template whose description says so, not
only in the data pack.

- [ ] **Step 6: Full suite and commit**

```bash
npx vitest run
git add src/scenes/packs/*.yaml src/llm/prompts/* tests/data-tokens-widening.test.ts
git commit -m "feat(scenes): six templates accept {id.var} data — distribution_curve, forest_plot, survival_curve, ceac, did_trends, event_study"
```

---

## Task 12: Round verification, ledger, push

**Files:**
- Create: `docs/superpowers/plans/2026-09-03-charts-round-ledger.md`

- [ ] **Step 1: Full suite, unpiped**

Run: `npx vitest run`
Expected: PASS. Record the test count.

- [ ] **Step 2: Live smoke every new example**

Run the dev server and, for each new bundled example (stacked bars, slope,
two races, line race, two heatmaps, six retrofit examples), render it and
confirm zero lint issues at three stages. Fix, do not exempt.

- [ ] **Step 3: Write the ledger**

Every ruling made during implementation, numbered, with what it costs if
wrong — the format of `2026-09-02-code-data-bridge-m2-ledger.md`. Include the
measured fps from Task 8 and any traps found.

- [ ] **Step 4: Rebase and push**

```bash
git pull --rebase
npx vitest run          # the other session's commits are in the tree now
git push
```

Expected: green after the rebase. If the R session touched
`src/spec/schema.ts`, re-run the animate-easing tests specifically.

- [ ] **Step 5: Report**

State the pushed URL, what Hans should look at with his own eyes (the two
races, the slope chart, the heatmap), and the measured fps.

---

## Self-Review

**Spec coverage:** §3 → Task 1. §4 → Task 2. §5 → Tasks 4-5. §6 → Task 6.
§7.1 → Task 3. §7.2 → Task 3 (regression test). §7.3 → Task 8. §8 → Task 9.
§9 → Tasks 10-11. §10 → tests in every task plus Tasks 8 and 12. §11 →
Task 7 (X_CAPTION_DROP) and the global constraints. §12 → nothing built, as
intended.

**Type consistency:** `race_<i>` ids are input-ordered in Tasks 4, 5 and 8.
`widenForDataTokens` and `DATA_TOKEN_PATTERN` are named identically in Tasks
10 and 11. `easing` is optional on the animate `PlanStep` in Task 3 and used
as `easing: "linear"` in Tasks 5 and 8. `valueAtStage(i, k)` and `value(i)`
in Task 4 are the same helpers Task 5 calls.

**Known soft spots, called out rather than hidden:** Task 2's tests use
invented series ids until Step 1 reads the real ones; Task 11's
`minimalParams(id)` and `firstNumericArrayParam(id)` are helpers the
implementer writes against the real schemas.
