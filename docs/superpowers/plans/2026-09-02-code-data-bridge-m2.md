# Code → template data bridge — M2 Implementation Plan (line, scatter, stage slider)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `line_chart` and `scatter_plot` to the `data` pack (staged, token-fed, animatable through `stage`), a data-bounded `stage` slider in the explore tray, the catalog threshold at 100, and bundled examples for both charts.

**Architecture:** Same shape as M1's `bar_chart`: a YAML template document with a plain-JS layout body that reads typed or substituted params, interpolates between adjacent stages itself, mints stable ids from the longest stage, and keeps beats alive offline with placeholders. The tray model learns one schema hint (`x-max-from`) so `stage` becomes a slider bounded by the data's stage count.

**Tech Stack:** TypeScript, Vite, vitest (node), js-yaml packs, kit v5.

**Spec:** `docs/superpowers/specs/2026-09-02-code-data-bridge-design.md` §6.1, §6.3, §6.4, §6.6, §12 (M2 bullet). M1 landed in commits 205d446..d5166eb (see `docs/superpowers/plans/2026-09-02-code-data-bridge-m1-ledger.md` for the rulings M2 inherits: a drawn title costs 55 units of plot height; title y = max(plot.y1 + 25, caption y + 40) ≤ 730; a token-fed series stays a zero series; depth means staged; `minItems: 1` on staged branches; token pattern on every data param).

## Global Constraints

- Template bodies are plain JS compiled with `new Function("params", "kit", "engines", body)`: no TS, no imports, deterministic (no `Math.random`, no `Date`), every point finite.
- Every data param that may come from a script accepts the token string branch `{ type: string, pattern: "^\\{[A-Za-z][A-Za-z0-9_]*\\.[A-Za-z_][A-Za-z0-9_.]*\\}$" }` in its `oneOf`, and staged branches carry `minItems: 1`.
- Ids are minted from the longest stage; a series whose values are still a token stays a zero series (so `line_k` / `point_i` beats exist offline).
- Limits are computed over ALL stages; a drawn title lowers the plot top to ≤ 620 and sits at `max(plot.y1 + 25, captionY + 40)` capped at 730 — copy the `bar_chart` title block verbatim.
- `src/examples.json` is 1-space-indented; append textually with the node one-liner from M1 (never re-serialize). `tests/examples.test.ts` requires every ready template to have an example, validates params against the template schema, and lays out every `animate.stage` target — new examples must pass all of that offline (placeholders from typed `x`/labels).
- `npm test` green before every commit (never piped through grep); `npx tsc --noEmit` clean. Commit trailer: `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` + `Claude-Session: https://claude.ai/code/session_01ABKjszY2Q9hhJpdbNC71p8`. Push at the end (pre-authorized).
- Do not touch `render/plan.ts`, `render/player.ts`, `render/index.ts`, `render/svg-backend.ts`, `export/video.ts`, `layout/layout.ts`.

---

## Shared geometry rules for line and scatter (used by Tasks 1 and 2)

**Stage interpolation with appearing/disappearing points.** For point index `i`, with `yk = stage k0` and `yk1 = stage k1` (each a number or absent):
- both present → `(X(i), lerp(yk[i], yk1[i], t))`;
- only in `k1` (appearing) → lerp from the predecessor point of stage `k0` (the last `j < i` with `yk[j]` present; itself if none) to `(X(i), yk1[i])`;
- only in `k0` (disappearing) → lerp from `(X(i), yk[i])` to the predecessor point of stage `k1` (last `j < i` with `yk1[j]` present; itself if none);
- absent in both → not drawn.
`t = 0` and `t = 1` therefore reproduce the stages exactly, and a series revealed prefix by prefix draws itself in out of its last point.

**X positions.** `x` numeric → `X(i) = xScale(x[i])` with limits from all x (or `xlim`); `x` strings → categorical, `X(i)` = slot centres like bars, the strings drawn under the axis (fontSize 17, or 13 when n > 12); `x` absent or a token → indices `1..n`.

**Axis marks.** No ticks (house style). Numeric x: draw the first and last x values under the axis ends in `C.guide`, fontSize 15 (ids `axes__x0`, `axes__x1`); numeric y: draw `yMin`/`yMax` left of the axis at its ends (`axes__y0`, `axes__y1`) formatted like bar_chart's `fmt`.

---

### Task 1: `line_chart` (+ two bundled examples)

**Files:**
- Modify: `src/scenes/packs/data.yaml` (append a document after `data_table`)
- Modify: `tests/data-pack.test.ts` (extend the two registration tests; add a `line_chart` describe)
- Modify: `tests/packs.test.ts` (`templateIds` list and the examples loop gain `"line_chart"`)
- Modify: `src/examples.json` (append two examples, textually)

**Interfaces:**
- Produces template `line_chart`: params `x`, `values` | `series[{name, values}]`, `stage`, `points`, `smooth`, `box`, `xlim`, `ylim`, `x_label`, `y_label`, `title`. Ids `axes`, `line_1..k`, `title`.

- [ ] **Step 1: Failing tests** — append to `tests/data-pack.test.ts` (and update the registration tests: `scenes.line_chart` ready; the examples loop lists `"line_chart"`):

```ts
describe("line_chart", () => {
  const line = (params: object) => layoutSpec({ template: "line_chart", params } as Spec);
  const stroke = (l: ReturnType<typeof layoutSpec>, id: string) => flattenDrawables(l.drawables).find((d) => d.id === id) as StrokeDrawable | undefined;

  test("one series: axes, line_1 (polyline + end label), title; y follows the values", () => {
    const l = line({ x: [0, 1, 2], values: [2, 4, 8], title: "T", y_label: "Y" });
    expect(l.order).toEqual(["axes", "line_1", "title"]);
    const pts = stroke(l, "line_1__l")!.pts;
    expect(pts).toHaveLength(3);
    expect(pts[2][1]).toBeCloseTo(Y(8, 8, TITLED_TOP), 6);
    expect(pts[0][1]).toBeCloseTo(Y(2, 8, TITLED_TOP), 6);
    expect(pts[0][0]).toBeCloseTo(plot.x0, 6);
    expect(pts[2][0]).toBeCloseTo(plot.x1, 6);
    expect(l.warnings).toEqual([]);
  });

  test("series draw several lines with end labels dodged apart and series colours", () => {
    const l = line({ x: [0, 1], series: [{ name: "A", values: [1, 5] }, { name: "B", values: [1, 5.2] }] });
    expect(l.order).toEqual(["axes", "line_1", "line_2"]);
    const tA = flattenDrawables(l.drawables).find((d) => d.id === "line_1__t") as TextDrawable;
    const tB = flattenDrawables(l.drawables).find((d) => d.id === "line_2__t") as TextDrawable;
    expect(tA.text).toBe("A");
    expect(Math.abs(tA.pos[1] - tB.pos[1])).toBeGreaterThanOrEqual(44);
    expect(stroke(l, "line_1__l")!.style.color).toBe("#b5482e");
    expect(stroke(l, "line_2__l")!.style.color).toBe("#2f6b8f");
  });

  test("depth means staged: a fractional stage interpolates; limits span all stages", () => {
    const staged = { x: [0, 1, 2], values: [[2, 4, 8], [4, 8, 2]] };
    expect(stroke(line({ ...staged, stage: 0.5 }), "line_1__l")!.pts[0][1]).toBeCloseTo(Y(3, 8), 6);
    expect(stroke(line({ ...staged, stage: 1 }), "line_1__l")!.pts[2][1]).toBeCloseTo(Y(2, 8), 6);
    expect(stroke(line({ ...staged, stage: 7 }), "line_1__l")!.pts[0][1]).toBeCloseTo(Y(4, 8), 6);
  });

  test("a point absent from a stage grows out of its predecessor (prefix reveal)", () => {
    const l = line({ x: [0, 1, 2], values: [[5, 5], [5, 5, 9]], stage: 0.5 });
    const pts = stroke(l, "line_1__l")!.pts;
    expect(pts).toHaveLength(3);
    // third point halfway between the second point (x=1, y=5) and its target (x=2, y=9)
    expect(pts[2][0]).toBeCloseTo((plot.x0 + plot.x1) / 2 + (plot.x1 - (plot.x0 + plot.x1) / 2) / 2, 6);
    expect(pts[2][1]).toBeCloseTo((Y(5, 9) + Y(9, 9)) / 2, 6);
    expect(stroke(line({ x: [0, 1, 2], values: [[5, 5], [5, 5, 9]], stage: 0 }), "line_1__l")!.pts).toHaveLength(2);
  });

  test("categorical x draws the strings under the axis; absent x uses indices", () => {
    const l = line({ x: ["Q1", "Q2", "Q3"], values: [1, 2, 3] });
    const texts = flattenDrawables(l.drawables).filter((d): d is TextDrawable => d.kind === "text").map((d) => d.text);
    expect(texts).toEqual(expect.arrayContaining(["Q1", "Q2", "Q3"]));
    const noX = line({ values: [1, 2, 3] });
    expect(stroke(noX, "line_1__l")!.pts[1][0]).toBeCloseTo((plot.x0 + plot.x1) / 2, 6);
  });

  test("points and smooth are optional decorations; the polyline stays the line_k__l stroke", () => {
    const l = line({ x: [0, 1, 2], values: [1, 2, 3], points: true, smooth: true });
    expect(flattenDrawables(l.drawables).some((d) => d.id === "line_1__p2")).toBe(true);
    expect(stroke(l, "line_1__l")!.pts.length).toBeGreaterThan(3); // smoothed
  });

  test("the placeholder promise: series with token values keep their ids; x typed alone draws nothing", () => {
    const l = line({ x: [0, 1, 2], series: [{ name: "A", values: "{sim.a}" }, { name: "B", values: "{sim.b}" }] });
    expect(l.order).toEqual(["axes", "line_1", "line_2"]);
    expect(l.warnings).toEqual([]);
    expect(line({ x: [0, 1, 2], values: "{sim.y}" }).order).toEqual(["axes"]);
  });

  test("caps: 6 series, 2000 points", () => {
    const many = line({ series: Array.from({ length: 8 }, (_, k) => ({ name: `s${k}`, values: [1, 2] })) });
    expect(many.order.filter((id) => id.startsWith("line_"))).toHaveLength(6);
  });
});
```

Add `type StrokeDrawable` to the model import at the top of the file.

- [ ] **Step 2: Run** `npx vitest run tests/data-pack.test.ts` — FAIL (`unknown template "line_chart"`).

- [ ] **Step 3: Append the template** to `src/scenes/packs/data.yaml`:

```yaml
---
template: line_chart
title: Line chart
version: 1
kit: 5
status: ready
description: >-
  A line chart from data: one or more series over a numeric or categorical
  x, each line ending in its own name, drawn as ink so it animates as
  geometry. `values` may be one list (static) or a list of lists — STAGES
  of the same chart — and the numeric `stage` param picks which one is
  shown; a fractional stage interpolates, so `animate: {stage: 1}` plays
  the change, and a series given prefix by prefix draws itself in from its
  last point. Feed it typed numbers, or a code element's variables via
  "{id.var}" tokens (name the series by hand so the line_k beats exist
  before the script has run). Choose this scene for ANY request for a line
  chart, a trend over time, a curve computed from data, two scenarios
  compared over time, or "show how this develops".
params:
  type: object
  properties:
    x:
      oneOf:
        - { type: array, items: { type: number }, maxItems: 2000 }
        - { type: array, items: { type: string }, maxItems: 2000 }
        - { type: string, pattern: "^\\{[A-Za-z][A-Za-z0-9_]*\\.[A-Za-z_][A-Za-z0-9_.]*\\}$" }
      description: "x positions: numbers (a real axis), strings (categories under the axis), or a \"{id.var}\" token. Omitted: 1, 2, 3, …"
    values:
      oneOf:
        - { type: array, items: { type: number }, maxItems: 2000 }
        - { type: array, minItems: 1, items: { type: array, items: { type: number }, maxItems: 2000 }, maxItems: 12 }
        - { type: string, pattern: "^\\{[A-Za-z][A-Za-z0-9_]*\\.[A-Za-z_][A-Za-z0-9_.]*\\}$" }
      description: "One series: a list of numbers (static), a list of lists (STAGES — depth means staged; a shorter stage reveals the line prefix by prefix), or a \"{id.var}\" token."
    series:
      type: array
      maxItems: 6
      items:
        type: object
        properties:
          name: { type: string }
          values:
            oneOf:
              - { type: array, items: { type: number }, maxItems: 2000 }
              - { type: array, minItems: 1, items: { type: array, items: { type: number }, maxItems: 2000 }, maxItems: 12 }
              - { type: string, pattern: "^\\{[A-Za-z][A-Za-z0-9_]*\\.[A-Za-z_][A-Za-z0-9_.]*\\}$" }
        required: [values]
      description: "Several lines, each ending in its name. Use INSTEAD of values. Each series' values follow the same static/staged/token rule."
    stage:
      type: number
      minimum: 0
      x-max-from: ["values", "series.0.values"]
      description: "Which stage is shown (0-based; default 0). Fractional values interpolate — the animate verb's target: {\"animate\": {\"stage\": 1}}. Write the starting stage explicitly."
    points:
      type: boolean
      description: "Dots at the data points (default false)."
    smooth:
      type: boolean
      description: "Catmull–Rom smoothing through the points (default false; keep off for step-like data)."
    box:
      type: object
      properties: { x: { type: number }, y: { type: number }, w: { type: number }, h: { type: number } }
      required: [x, y, w, h]
      description: "Plot area (lower-left corner, width, height) when the chart shares the canvas. Default: the standard plot area."
    xlim:
      type: array
      items: { type: number }
      minItems: 2
      maxItems: 2
      description: "Fixed x range for numeric x."
    ylim:
      type: array
      items: { type: number }
      minItems: 2
      maxItems: 2
      description: "Fixed y range. Default: the data's range across ALL stages plus headroom, so the frame never jumps."
    x_label: { type: string }
    y_label: { type: string }
    title: { type: string }
element_ids:
  axes: the x and y axes with their captions and end values
  line_1: "the first series: its polyline, optional dots, and its name at the end (line_2, … likewise)"
  title: figure title, when set
examples:
  - request: "Plot 100 growing at 2 and 7 percent over 50 years as two curves."
    params:
      x: [0, 10, 20, 30, 40, 50]
      series:
        - { name: "2 %", values: [100, 122, 149, 181, 221, 269] }
        - { name: "7 %", values: [100, 197, 387, 761, 1497, 2946] }
      y_label: "Value of 100"
      x_label: "Years"
  - request: "A line that is revealed point by point as the narration walks along it."
    params:
      x: ["Mon", "Tue", "Wed", "Thu", "Fri"]
      values: [[3, 5], [3, 5, 4], [3, 5, 4, 7, 6]]
      stage: 0
      points: true
      title: "Sales this week"
layout: |
  const C = kit.COLORS, MS = kit.SKETCH_MS;
  const num = (v, d) => (typeof v === "number" && Number.isFinite(v) ? v : d);
  const str = (v, d) => (typeof v === "string" && v.trim() !== "" ? v.trim() : d);
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const isNumRow = (a) => Array.isArray(a) && a.every((v) => v === null || (typeof v === "number" && Number.isFinite(v)));
  const toStages = (v) => {
    if (!Array.isArray(v) || v.length === 0) return null;
    if (Array.isArray(v[0])) return v.every(isNumRow) ? v.slice(0, 12) : null;
    return isNumRow(v) ? [v] : null;
  };
  const series = [];
  if (Array.isArray(params.series)) {
    params.series.slice(0, 6).forEach((s, k) => {
      const st = toStages(s && s.values);
      // A series whose values are not data yet still COUNTS (zero series), so
      // the line_k beat, its colour and its end label exist before the script runs.
      series.push({ name: str(s && s.name, "Series " + (k + 1)), stages: st || [[]] });
    });
  } else {
    const st = toStages(params.values);
    if (st) series.push({ name: "", stages: st });
  }
  // x: numbers (real axis), strings (categories), else indices 1..n.
  const xNum = Array.isArray(params.x) && params.x.length > 0 && params.x.every((v) => typeof v === "number" && Number.isFinite(v)) ? params.x.slice(0, 2000) : null;
  const xCat = !xNum && Array.isArray(params.x) && params.x.length > 0 && params.x.every((v) => typeof v === "string") ? params.x.slice(0, 2000) : null;
  let n = xNum ? xNum.length : xCat ? xCat.length : 0;
  for (const s of series) for (const st of s.stages) n = Math.max(n, st.length);
  n = Math.min(2000, n);
  let K = 1;
  for (const s of series) K = Math.max(K, s.stages.length);
  const stage = clamp(num(params.stage, 0), 0, K - 1);
  const k0 = Math.floor(stage), k1 = Math.min(K - 1, k0 + 1), t = stage - k0;
  const at = (s, k, i) => { const st = s.stages[Math.min(k, s.stages.length - 1)]; const v = st[i]; return typeof v === "number" ? v : null; };

  // Limits over all stages (y) and all x, so the frame never jumps mid-tween.
  let lo = Infinity, hi = -Infinity;
  for (const s of series) for (const st of s.stages) for (const v of st) if (typeof v === "number") { lo = Math.min(lo, v); hi = Math.max(hi, v); }
  if (!Number.isFinite(lo)) { lo = 0; hi = 1; }
  const ylim = Array.isArray(params.ylim) && params.ylim.length === 2 && params.ylim.every((v) => typeof v === "number" && Number.isFinite(v)) ? params.ylim : null;
  let yMin = ylim ? Math.min(ylim[0], ylim[1]) : Math.min(0, lo);
  let yMax = ylim ? Math.max(ylim[0], ylim[1]) : hi;
  if (!ylim) { const pad = (yMax - yMin) * 0.08; if (yMax > 0) yMax += pad; if (yMin < 0) yMin -= pad; }
  if (yMax - yMin < 1e-9) yMax = yMin + 1;
  const xs = xNum ? xNum : Array.from({ length: n }, (_, i) => i + 1);
  const xlim = xNum && Array.isArray(params.xlim) && params.xlim.length === 2 && params.xlim.every((v) => typeof v === "number" && Number.isFinite(v)) ? params.xlim : null;
  let xMin = xlim ? Math.min(xlim[0], xlim[1]) : Math.min(...xs), xMax = xlim ? Math.max(xlim[0], xlim[1]) : Math.max(...xs);
  if (!(xMax - xMin > 1e-9)) xMax = xMin + 1;

  const b = params.box;
  const boxed = b && typeof b === "object" && [b.x, b.y, b.w, b.h].every((v) => typeof v === "number" && Number.isFinite(v)) && b.w > 0 && b.h > 0;
  const plot = boxed ? { x0: b.x, y0: b.y, x1: b.x + b.w, y1: b.y + b.h } : kit.plotArea();
  const title = str(params.title, "");
  // A drawn title costs 55 units of plot height (the did_trends convention) — see bar_chart.
  if (title) plot.y1 = Math.max(plot.y0, Math.min(plot.y1, 620));
  const Y = (v) => plot.y0 + ((v - yMin) / (yMax - yMin)) * (plot.y1 - plot.y0);
  const X = xCat
    ? (i) => plot.x0 + ((plot.x1 - plot.x0) / Math.max(1, n)) * (i + 0.5)
    : (i) => plot.x0 + ((xs[i] - xMin) / (xMax - xMin)) * (plot.x1 - plot.x0);
  const xLab = str(params.x_label, ""), yLab = str(params.y_label, "");
  let dec = 0;
  for (const v of [yMin, yMax]) if (!Number.isInteger(v)) dec = Math.min(2, Math.max(dec, 1));
  const fmt = (v) => (dec === 0 ? String(Math.round(v)) : v.toFixed(dec));

  const drawables = [], labelReqs = [], anchors = {}, order = [];
  const push = (d) => { drawables.push(d); order.push(d.id); };

  const axesChildren = [
    kit.stroke("axes__x", [[plot.x0 - 6, plot.y0], [plot.x1 + kit.AXIS_OVERHANG, plot.y0]], { arrowhead: "end", strokeWidth: 4, ms: MS.axis }),
    kit.stroke("axes__y", [[plot.x0, plot.y0 - 6], [plot.x0, plot.y1 + kit.AXIS_OVERHANG]], { arrowhead: "end", strokeWidth: 4, ms: MS.axis }),
  ];
  if (xLab) axesChildren.push(kit.axisLabel("axes__x_label", "x", plot, xLab, { fontSize: 22 }));
  if (yLab) axesChildren.push(kit.axisLabel("axes__y_label", "y", plot, yLab, { fontSize: 22 }));
  if (xCat) {
    const size = n > 12 ? 13 : 17;
    xCat.forEach((s, i) => axesChildren.push(kit.text("axes__c" + i, [X(i), plot.y0 - 20], s, { fontSize: size })));
  } else if (n > 0) {
    axesChildren.push(kit.text("axes__x0", [X(0), plot.y0 - 20], fmt(xs[0]), { fontSize: 15, color: C.guide }));
    axesChildren.push(kit.text("axes__x1", [X(n - 1), plot.y0 - 20], fmt(xs[n - 1]), { fontSize: 15, color: C.guide }));
  }
  axesChildren.push(kit.text("axes__y0", [plot.x0 - 12, plot.y0], fmt(yMin), { fontSize: 15, anchor: "end", color: C.guide }));
  axesChildren.push(kit.text("axes__y1", [plot.x0 - 12, plot.y1], fmt(yMax), { fontSize: 15, anchor: "end", color: C.guide }));
  if (yMin < 0 && yMax > 0) axesChildren.push(kit.stroke("axes__zero", [[plot.x0, Y(0)], [plot.x1, Y(0)]], { color: C.guide, dash: true, strokeWidth: 2, ms: MS.guides }));
  push(kit.group("axes", axesChildren));
  anchors.axes = [plot.x0, plot.y0];

  // Interpolated points for one series: appearing points grow out of their
  // predecessor in the older stage, disappearing ones shrink into their
  // predecessor in the newer stage — a prefix reveal draws the line in.
  const pointsOf = (s) => {
    const pts = [];
    const pred = (k, i) => { for (let j = i - 1; j >= 0; j--) { const v = at(s, k, j); if (v !== null) return [X(j), Y(v)]; } return null; };
    for (let i = 0; i < n; i++) {
      const a = at(s, k0, i), c = at(s, k1, i);
      if (a === null && c === null) continue;
      let from, to;
      if (a !== null && c !== null) { from = [X(i), Y(a)]; to = [X(i), Y(c)]; }
      else if (a === null) { to = [X(i), Y(c)]; from = pred(k0, i) || to; }
      else { from = [X(i), Y(a)]; to = pred(k1, i) || from; }
      pts.push([from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t]);
    }
    return pts;
  };

  const ends = [];
  const lines = series.map((s, k) => ({ s, k, pts: pointsOf(s) }));
  // Dodge end labels apart (46 units) the way did_trends does, in y order.
  const labelY = lines.map((L) => (L.pts.length ? L.pts[L.pts.length - 1][1] : plot.y0));
  const orderIdx = labelY.map((y, i) => i).sort((i, j) => labelY[i] - labelY[j]);
  const dodged = labelY.slice();
  for (let q = 1; q < orderIdx.length; q++) {
    const prev = orderIdx[q - 1], cur = orderIdx[q];
    if (dodged[cur] - dodged[prev] < 46) dodged[cur] = dodged[prev] + 46;
  }
  lines.forEach((L, k) => {
    const id = "line_" + (k + 1);
    const color = C.series[k % C.series.length];
    const children = [];
    const pts = L.pts;
    if (pts.length >= 2) children.push(kit.stroke(id + "__l", params.smooth === true ? kit.smooth(pts) : pts, { color, strokeWidth: 4, ms: MS.curve }));
    else if (pts.length === 1) children.push(kit.stroke(id + "__l", [pts[0], [pts[0][0] + 0.01, pts[0][1]]], { color, strokeWidth: 4, ms: MS.curve }));
    else children.push(kit.stroke(id + "__l", [], { color, strokeWidth: 4, ms: MS.curve }));
    if (params.points === true) pts.forEach((p, i) => children.push(kit.stroke(id + "__p" + (i + 1), kit.polygon(p, 4, 10), { closed: true, color, fill: color, strokeWidth: 2, ms: MS.stroke })));
    if (L.s.name && pts.length) children.push(kit.text(id + "__t", [pts[pts.length - 1][0] + 12, dodged[k]], L.s.name, { fontSize: 19, anchor: "start", color }));
    push(kit.group(id, children));
    anchors[id] = pts.length ? pts[Math.floor(pts.length / 2)] : [plot.x0, plot.y0];
  });

  if (title) {
    let ty = Math.min(700, plot.y1 + 25);
    const yCap = axesChildren.find((d) => d.id === "axes__y_label");
    if (yCap) ty = Math.max(ty, yCap.pos[1] + 40);
    ty = Math.min(ty, 730);
    push(kit.text("title", [(plot.x0 + plot.x1) / 2, ty], title, { fontSize: 30 }));
    anchors.title = [(plot.x0 + plot.x1) / 2, ty];
  }
  return { drawables, labels: labelReqs, anchors, order };
```

Note `x-max-from` is a plain extra key in JSON Schema (ajv `strict: false` ignores it); Task 3 teaches the tray to read it.

- [ ] **Step 4: Update `tests/packs.test.ts`**: the `templateIds` expectation becomes `["bar_chart", "data_table", "line_chart"]` and the examples loop lists the three.

- [ ] **Step 5: Run** `npx vitest run tests/data-pack.test.ts tests/packs.test.ts` — PASS. Fix the template if a geometry assertion disagrees with the rules above; fix the test only if its arithmetic was wrong (say which in the report).

- [ ] **Step 6: Two bundled examples** — write to a scratch file and append with M1's node one-liner (textual append; `git diff --stat src/examples.json` shows insertions only):

```json
[
  {
    "request": "Replay the compounding example as two curves drawn from the numbers Python computes: 100 at 2 percent and at 7 percent, year by year",
    "packs": ["data"],
    "spec": {
      "title": "Compounding, as curves",
      "template": "line_chart",
      "params": {
        "x": "{calc.years}",
        "series": [
          { "name": "2 %", "values": "{calc.low}" },
          { "name": "7 %", "values": "{calc.high}" }
        ],
        "ylim": [0, 3200],
        "y_label": "Value of 100",
        "x_label": "Years",
        "box": { "x": 470, "y": 95, "w": 460, "h": 560 }
      },
      "elements": [
        { "id": "calc", "type": "code", "language": "python", "show": "code", "x": 225, "y": 400, "width": 410, "font_size": 15,
          "code": "years = list(range(0, 51))\nlow = [100 * 1.02 ** y for y in years]\nhigh = [100 * 1.07 ** y for y in years]" }
      ],
      "commands": [
        { "draw": ["calc", "calc_line_1"], "parallel": true, "speak": "Fifty-one years, one per point." },
        { "draw": ["calc_line_2", "calc_line_3"], "parallel": true, "speak": "Two lines of Python: the same hundred at two percent and at seven." },
        { "draw": ["axes", "line_1"], "parallel": true, "speak": "At two percent the curve is almost a straight line: two hundred and sixty-nine after fifty years." },
        { "draw": ["line_2"], "speak": "At seven percent it bends upward and keeps bending: nearly three thousand." },
        { "highlight": { "target": ["line_2"] }, "delivery": "grave", "speak": "That bend is compounding. The rate is three and a half times higher; the money is eleven times more." }
      ]
    }
  },
  {
    "request": "Flatten the curve: an epidemic with and without distancing, computed with a simple SIR model",
    "packs": ["data"],
    "spec": {
      "title": "Flattening the curve",
      "template": "line_chart",
      "params": {
        "x": "{sir.days}",
        "series": [{ "name": "Infected", "values": "{sir.frames}" }],
        "stage": 0,
        "y_label": "Share infected",
        "x_label": "Days",
        "title": "Flattening the curve"
      },
      "elements": [
        { "id": "sir", "type": "code", "language": "python", "show": "none",
          "code": "def sir(r0, days=160, gamma=0.1):\n    s, i, out = 0.999, 0.001, []\n    for d in range(days):\n        out.append(round(i, 4))\n        new = r0 * gamma * s * i\n        s, i = s - new, i + new - gamma * i\n    return out\ndays = list(range(160))\nframes = [sir(2.5), sir(1.4)]" }
      ],
      "commands": [
        { "draw": ["title"], "speak": "Same virus, same population. The only thing that changes is how many people each case infects." },
        { "draw": ["axes", "line_1"], "parallel": true, "speak": "With every case infecting two and a half others, the wave peaks early and high: a fifth of the population sick at once." },
        { "animate": { "stage": 1 }, "duration": 4, "speak": "Bring that down to one point four, and the same wave spreads out: later, lower, longer." },
        { "highlight": { "target": ["line_1"] }, "speak": "Fewer people are sick at the same time. That is the whole point of flattening the curve: not fewer cases, but room to treat them." }
      ]
    }
  }
]
```

Check the SIR numbers before appending (`python3` locally): with `r0=2.5, gamma=0.1` the peak share is about 0.20–0.24; with `r0=1.4` about 0.05–0.07, later. If the peak for 2.5 is not within 0.17–0.25, change the narration's "a fifth" to the nearest simple fraction and report it.

- [ ] **Step 7: Run** `npx vitest run tests/examples.test.ts tests/translate-coverage.test.ts`, then `npm test`, `npx tsc --noEmit` — green.

- [ ] **Step 8: Commit** — `feat(scenes): line_chart — staged series with prefix reveal, end labels, categorical x (+2 examples)`.

---

### Task 2: `scatter_plot` (+ two bundled examples, spec amendment)

**Files:**
- Modify: `src/scenes/packs/data.yaml` (append a document)
- Modify: `tests/data-pack.test.ts`, `tests/packs.test.ts` (lists gain `"scatter_plot"`)
- Modify: `src/examples.json` (append two examples)
- Modify: `docs/superpowers/specs/2026-09-02-code-data-bridge-design.md` §6.4 (ids clause)

**Interfaces:**
- Produces template `scatter_plot`: params `x`, `y` (static | staged | token), `labels` (per point), `fit` (`true` | `[slope, intercept]`), `stage`, `box`, `xlim`, `ylim`, `x_label`, `y_label`, `title`. Ids `axes`, `points` (the unlabelled dots), `point_i` (each LABELLED point, its own beat), `fit_line`, `title`.

Spec amendment (§6.4, replace the Ids sentence): "Ids: `axes`; `points` — one group holding every dot that has no label; `point_i` — a labelled point is its own group (dot + label) so it can be its own beat; `fit_line` (with its equation as caption); `title`. A point lives in exactly one of `points`/`point_i`."

- [ ] **Step 1: Failing tests** (append to `tests/data-pack.test.ts`; registration lists gain `"scatter_plot"`):

```ts
describe("scatter_plot", () => {
  const sc = (params: object) => layoutSpec({ template: "scatter_plot", params } as Spec);
  const find = (l: ReturnType<typeof layoutSpec>, id: string) => flattenDrawables(l.drawables).find((d) => d.id === id);

  test("unlabelled points share the points group; labelled ones are their own beats", () => {
    const l = sc({ x: [1, 2, 3], y: [2, 4, 8], labels: ["", "B", ""] });
    expect(l.order).toEqual(["axes", "points", "point_2"]);
    expect(find(l, "points__d1")).toBeDefined();
    expect(find(l, "points__d2")).toBeUndefined();
    expect((find(l, "point_2__t") as TextDrawable).text).toBe("B");
  });

  test("dots sit at the scaled positions; a fit: true line is least squares", () => {
    const l = sc({ x: [0, 1, 2, 3], y: [1, 3, 5, 7], fit: true });
    const d = find(l, "points__d4") as StrokeDrawable;
    const cx = d.pts.reduce((a, p) => a + p[0], 0) / d.pts.length;
    expect(cx).toBeCloseTo(plot.x1, 0);
    const fit = find(l, "fit_line__l") as StrokeDrawable;
    expect(fit.pts[0][1]).toBeCloseTo(Y(1, 7 + 0.48, plot.y1) * 0 + (plot.y0 + ((1 - 0) / (7 * 1.08 - 0)) * (plot.y1 - plot.y0)), 4);
    expect((find(l, "fit_line__t") as TextDrawable).text).toBe("y = 2.00x + 1.00");
  });

  test("fit: [slope, intercept] draws the given line (animatable numbers)", () => {
    const l = sc({ x: [0, 4], y: [0, 4], fit: [0.5, 1] });
    const fit = find(l, "fit_line__l") as StrokeDrawable;
    expect((find(l, "fit_line__t") as TextDrawable).text).toBe("y = 0.50x + 1.00");
    expect(fit.pts).toHaveLength(2);
  });

  test("staged y interpolates and an appearing point grows out of its predecessor", () => {
    const l = sc({ x: [0, 1, 2], y: [[1, 1], [1, 1, 3]], stage: 0.5 });
    expect(l.order).toEqual(["axes", "points"]);
    const d3 = find(l, "points__d3") as StrokeDrawable;
    expect(d3).toBeDefined();
    const cx = d3.pts.reduce((a, p) => a + p[0], 0) / d3.pts.length;
    expect(cx).toBeCloseTo((plot.x0 + plot.x1) / 2 + (plot.x1 - (plot.x0 + plot.x1) / 2) / 2, 0);
  });

  test("placeholder: typed x with a token y → n dots at the floor; both tokens → axes only", () => {
    const l = sc({ x: [1, 2, 3], y: "{sim.y}" });
    expect(l.order).toEqual(["axes", "points"]);
    expect(find(l, "points__d3")).toBeDefined();
    expect(l.warnings).toEqual([]);
    expect(sc({ x: "{sim.x}", y: "{sim.y}" }).order).toEqual(["axes"]);
  });

  test("caps at 500 points", () => {
    const l = sc({ x: Array.from({ length: 600 }, (_, i) => i), y: Array.from({ length: 600 }, (_, i) => i) });
    expect(find(l, "points__d500")).toBeDefined();
    expect(find(l, "points__d501")).toBeUndefined();
  });
});
```

(The second test's first `expect` on `fit.pts[0][1]` is deliberately written as the scale arithmetic: with `x: 0..3` and `y: 1..7`, `yMin = 0`, `yMax = 7 · 1.08`; the fitted line at `x = 0` is `y = 1`. Simplify it to `expect(fit.pts[0][1]).toBeCloseTo(plot.y0 + (1 / (7 * 1.08)) * (plot.y1 - plot.y0), 4)` when you transcribe.)

- [ ] **Step 2: Run** — FAIL (`unknown template "scatter_plot"`).

- [ ] **Step 3: Append the template:**

```yaml
---
template: scatter_plot
title: Scatter plot
version: 1
kit: 5
status: ready
description: >-
  A scatter plot from data: one dot per (x, y) pair, optional per-point
  labels (a labelled point is its own beat), and an optional fitted line —
  least squares computed here (`fit: true`) or `[slope, intercept]` handed
  in from a script (animatable numbers). `y` may be one list (static) or a
  list of lists (STAGES) and a fractional `stage` interpolates, so the same
  points can move — Anscombe's quartet, before/after a treatment. Feed it
  typed numbers or a code element's variables via "{id.var}" tokens (type
  `x` by hand so the dots exist before the script has run). Choose this
  scene for ANY request for a scatter plot, a correlation, a regression
  line through data, or "does x go with y".
params:
  type: object
  properties:
    x:
      oneOf:
        - { type: array, items: { type: number }, maxItems: 500 }
        - { type: string, pattern: "^\\{[A-Za-z][A-Za-z0-9_]*\\.[A-Za-z_][A-Za-z0-9_.]*\\}$" }
      description: "x of every point (numbers), or a \"{id.var}\" token. TYPE these by hand when the beats address points."
    y:
      oneOf:
        - { type: array, items: { type: number }, maxItems: 500 }
        - { type: array, minItems: 1, items: { type: array, items: { type: number }, maxItems: 500 }, maxItems: 12 }
        - { type: string, pattern: "^\\{[A-Za-z][A-Za-z0-9_]*\\.[A-Za-z_][A-Za-z0-9_.]*\\}$" }
      description: "y of every point: a list (static), a list of lists (STAGES of the same points — depth means staged), or a \"{id.var}\" token."
    labels:
      type: array
      items: { type: string }
      maxItems: 500
      description: "Optional per-point names; a named point becomes its own beat point_i (empty string = unnamed)."
    fit:
      oneOf:
        - { type: boolean }
        - { type: array, items: { type: number }, minItems: 2, maxItems: 2 }
        - { type: string, pattern: "^\\{[A-Za-z][A-Za-z0-9_]*\\.[A-Za-z_][A-Za-z0-9_.]*\\}$" }
      description: "true = least-squares line computed here (follows the points through a stage tween); [slope, intercept] = a line from the script, e.g. np.polyfit — animatable as fit.0 / fit.1."
    stage:
      type: number
      minimum: 0
      x-max-from: ["y"]
      description: "Which stage of y is shown (0-based; default 0). Fractional values interpolate — {\"animate\": {\"stage\": 1}}."
    box:
      type: object
      properties: { x: { type: number }, y: { type: number }, w: { type: number }, h: { type: number } }
      required: [x, y, w, h]
      description: "Plot area (lower-left corner, width, height). Default: the standard plot area."
    xlim: { type: array, items: { type: number }, minItems: 2, maxItems: 2, description: "Fixed x range." }
    ylim: { type: array, items: { type: number }, minItems: 2, maxItems: 2, description: "Fixed y range. Default: the data's range across ALL stages plus headroom." }
    x_label: { type: string }
    y_label: { type: string }
    title: { type: string }
element_ids:
  axes: the x and y axes with their captions and end values
  points: every unnamed dot, as one group
  point_1: "a NAMED point (dot + its label) — its own beat; numbered by position (point_2, …)"
  fit_line: the fitted line with its equation
  title: figure title, when set
examples:
  - request: "Scatter of study hours against exam score with a regression line."
    params:
      x: [1, 2, 3, 4, 5, 6, 7, 8]
      y: [52, 55, 61, 58, 70, 74, 79, 83]
      fit: true
      x_label: "Hours studied"
      y_label: "Score"
  - request: "Show Anscombe's first two datasets as the same fitted line through different points."
    params:
      x: [10, 8, 13, 9, 11, 14, 6, 4, 12, 7, 5]
      y:
        - [8.04, 6.95, 7.58, 8.81, 8.33, 9.96, 7.24, 4.26, 10.84, 4.82, 5.68]
        - [9.14, 8.14, 8.74, 8.77, 9.26, 8.10, 6.13, 3.10, 9.13, 7.26, 4.74]
      stage: 0
      fit: true
      title: "Same line, different data"
layout: |
  const C = kit.COLORS, MS = kit.SKETCH_MS;
  const num = (v, d) => (typeof v === "number" && Number.isFinite(v) ? v : d);
  const str = (v, d) => (typeof v === "string" && v.trim() !== "" ? v.trim() : d);
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const isNumRow = (a) => Array.isArray(a) && a.every((v) => v === null || (typeof v === "number" && Number.isFinite(v)));
  const toStages = (v) => {
    if (!Array.isArray(v) || v.length === 0) return null;
    if (Array.isArray(v[0])) return v.every(isNumRow) ? v.slice(0, 12) : null;
    return isNumRow(v) ? [v] : null;
  };
  const xs = Array.isArray(params.x) && params.x.every((v) => typeof v === "number" && Number.isFinite(v)) ? params.x.slice(0, 500) : null;
  let stages = toStages(params.y);
  // The placeholder promise: typed x but y still a token → dots at the floor.
  if (!stages && xs && xs.length > 0) stages = [xs.map(() => 0)];
  if (!xs || !stages) {
    // Nothing to place: axes only (a spec with both x and y unresolved).
  }
  const n = xs ? Math.min(500, xs.length) : 0;
  const K = stages ? stages.length : 1;
  const stage = clamp(num(params.stage, 0), 0, K - 1);
  const k0 = Math.floor(stage), k1 = Math.min(K - 1, k0 + 1), t = stage - k0;
  const at = (k, i) => { if (!stages) return null; const st = stages[Math.min(k, stages.length - 1)]; const v = st[i]; return typeof v === "number" ? v : null; };
  const labels = Array.isArray(params.labels) ? params.labels.map((l) => (typeof l === "string" ? l.trim() : "")) : [];

  let lo = Infinity, hi = -Infinity;
  if (stages) for (const st of stages) for (const v of st) if (typeof v === "number") { lo = Math.min(lo, v); hi = Math.max(hi, v); }
  if (!Number.isFinite(lo)) { lo = 0; hi = 1; }
  const ylim = Array.isArray(params.ylim) && params.ylim.length === 2 && params.ylim.every((v) => typeof v === "number" && Number.isFinite(v)) ? params.ylim : null;
  let yMin = ylim ? Math.min(ylim[0], ylim[1]) : Math.min(0, lo), yMax = ylim ? Math.max(ylim[0], ylim[1]) : hi;
  if (!ylim) { const pad = (yMax - yMin) * 0.08; if (yMax > 0) yMax += pad; if (yMin < 0) yMin -= pad; }
  if (yMax - yMin < 1e-9) yMax = yMin + 1;
  const xlim = Array.isArray(params.xlim) && params.xlim.length === 2 && params.xlim.every((v) => typeof v === "number" && Number.isFinite(v)) ? params.xlim : null;
  let xMin = xlim ? Math.min(xlim[0], xlim[1]) : n ? Math.min(0, ...xs.slice(0, n)) : 0, xMax = xlim ? Math.max(xlim[0], xlim[1]) : n ? Math.max(...xs.slice(0, n)) : 1;
  if (!xlim) { const pad = (xMax - xMin) * 0.06; if (xMax > 0) xMax += pad; }
  if (!(xMax - xMin > 1e-9)) xMax = xMin + 1;

  const b = params.box;
  const boxed = b && typeof b === "object" && [b.x, b.y, b.w, b.h].every((v) => typeof v === "number" && Number.isFinite(v)) && b.w > 0 && b.h > 0;
  const plot = boxed ? { x0: b.x, y0: b.y, x1: b.x + b.w, y1: b.y + b.h } : kit.plotArea();
  const title = str(params.title, "");
  if (title) plot.y1 = Math.max(plot.y0, Math.min(plot.y1, 620));
  const X = (v) => plot.x0 + ((v - xMin) / (xMax - xMin)) * (plot.x1 - plot.x0);
  const Y = (v) => plot.y0 + ((v - yMin) / (yMax - yMin)) * (plot.y1 - plot.y0);
  const xLab = str(params.x_label, ""), yLab = str(params.y_label, "");
  const fmt = (v) => (Number.isInteger(v) ? String(v) : v.toFixed(1));

  const drawables = [], labelReqs = [], anchors = {}, order = [];
  const push = (d) => { drawables.push(d); order.push(d.id); };
  const axesChildren = [
    kit.stroke("axes__x", [[plot.x0 - 6, plot.y0], [plot.x1 + kit.AXIS_OVERHANG, plot.y0]], { arrowhead: "end", strokeWidth: 4, ms: MS.axis }),
    kit.stroke("axes__y", [[plot.x0, plot.y0 - 6], [plot.x0, plot.y1 + kit.AXIS_OVERHANG]], { arrowhead: "end", strokeWidth: 4, ms: MS.axis }),
  ];
  if (xLab) axesChildren.push(kit.axisLabel("axes__x_label", "x", plot, xLab, { fontSize: 22 }));
  if (yLab) axesChildren.push(kit.axisLabel("axes__y_label", "y", plot, yLab, { fontSize: 22 }));
  axesChildren.push(kit.text("axes__x1", [plot.x1, plot.y0 - 20], fmt(xMax), { fontSize: 15, color: C.guide }));
  axesChildren.push(kit.text("axes__y1", [plot.x0 - 12, plot.y1], fmt(yMax), { fontSize: 15, anchor: "end", color: C.guide }));
  push(kit.group("axes", axesChildren));
  anchors.axes = [plot.x0, plot.y0];

  // Current position of point i (see line_chart for the appear/disappear rule).
  const pred = (k, i) => { for (let j = i - 1; j >= 0; j--) { const v = at(k, j); if (v !== null) return [X(xs[j]), Y(v)]; } return null; };
  const pos = [];
  for (let i = 0; i < n; i++) {
    const a = at(k0, i), c = at(k1, i);
    if (a === null && c === null) { pos.push(null); continue; }
    let from, to;
    if (a !== null && c !== null) { from = [X(xs[i]), Y(a)]; to = [X(xs[i]), Y(c)]; }
    else if (a === null) { to = [X(xs[i]), Y(c)]; from = pred(k0, i) || to; }
    else { from = [X(xs[i]), Y(a)]; to = pred(k1, i) || from; }
    pos.push([from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t]);
  }

  const color = C.series[0];
  const dot = (id, p) => kit.stroke(id, kit.polygon(p, 5, 12), { closed: true, color, fill: color, strokeWidth: 2, ms: MS.stroke });
  const cloud = [];
  const named = [];
  pos.forEach((p, i) => {
    if (!p) return;
    const name = labels[i] || "";
    if (name) named.push({ i, p, name });
    else cloud.push(dot("points__d" + (i + 1), p));
  });
  if (cloud.length) { push(kit.group("points", cloud)); anchors.points = [(plot.x0 + plot.x1) / 2, (plot.y0 + plot.y1) / 2]; }
  named.forEach(({ i, p, name }) => {
    const id = "point_" + (i + 1);
    push(kit.group(id, [dot(id + "__d", p), kit.text(id + "__t", [p[0] + 10, p[1] + 12], name, { fontSize: 16, anchor: "start", color: C.ink })]));
    anchors[id] = p;
  });

  // The fitted line: least squares through the CURRENT (interpolated) points,
  // or the script's [slope, intercept]. Drawn across the visible x range.
  let fit = null;
  if (Array.isArray(params.fit) && params.fit.length === 2 && params.fit.every((v) => typeof v === "number" && Number.isFinite(v))) fit = { slope: params.fit[0], intercept: params.fit[1] };
  else if (params.fit === true && n >= 2) {
    let sx = 0, sy = 0, sxx = 0, sxy = 0, m = 0;
    for (let i = 0; i < n; i++) {
      if (!pos[i]) continue;
      const yv = yMin + ((pos[i][1] - plot.y0) / (plot.y1 - plot.y0)) * (yMax - yMin);
      const xv = xMin + ((pos[i][0] - plot.x0) / (plot.x1 - plot.x0)) * (xMax - xMin);
      sx += xv; sy += yv; sxx += xv * xv; sxy += xv * yv; m++;
    }
    const den = m * sxx - sx * sx;
    if (m >= 2 && Math.abs(den) > 1e-12) { const slope = (m * sxy - sx * sy) / den; fit = { slope, intercept: (sy - slope * sx) / m }; }
  }
  if (fit) {
    const ya = fit.intercept + fit.slope * xMin, yb = fit.intercept + fit.slope * xMax;
    const eq = "y = " + fit.slope.toFixed(2) + "x " + (fit.intercept < 0 ? "− " : "+ ") + Math.abs(fit.intercept).toFixed(2);
    push(kit.group("fit_line", [
      kit.stroke("fit_line__l", [[X(xMin), Y(clamp(ya, yMin, yMax))], [X(xMax), Y(clamp(yb, yMin, yMax))]], { color: C.accent, strokeWidth: 3, ms: MS.curve }),
      kit.text("fit_line__t", [X(xMax) - 8, Y(clamp(yb, yMin, yMax)) + 18], eq, { fontSize: 16, anchor: "end", color: C.accent }),
    ]));
    anchors.fit_line = [X((xMin + xMax) / 2), Y(clamp((ya + yb) / 2, yMin, yMax))];
  }

  if (title) {
    let ty = Math.min(700, plot.y1 + 25);
    const yCap = axesChildren.find((d) => d.id === "axes__y_label");
    if (yCap) ty = Math.max(ty, yCap.pos[1] + 40);
    ty = Math.min(ty, 730);
    push(kit.text("title", [(plot.x0 + plot.x1) / 2, ty], title, { fontSize: 30 }));
    anchors.title = [(plot.x0 + plot.x1) / 2, ty];
  }
  return { drawables, labels: labelReqs, anchors, order };
```

(The equation text uses a plain hyphen-minus for negatives: replace `"− "` with `"- "` when transcribing — keep the caption ASCII.)

- [ ] **Step 4:** `tests/packs.test.ts` lists gain `"scatter_plot"`; spec §6.4 Ids sentence amended as above.

- [ ] **Step 5: Run** the pack tests — PASS (same fix-which-side rule as Task 1).

- [ ] **Step 6: Two bundled examples** (append textually):

```json
[
  {
    "request": "Anscombe's quartet: three datasets with the same regression line, morphing from one to the next",
    "packs": ["data"],
    "spec": {
      "title": "Same line, different data",
      "template": "scatter_plot",
      "params": {
        "x": [10, 8, 13, 9, 11, 14, 6, 4, 12, 7, 5],
        "y": [
          [8.04, 6.95, 7.58, 8.81, 8.33, 9.96, 7.24, 4.26, 10.84, 4.82, 5.68],
          [9.14, 8.14, 8.74, 8.77, 9.26, 8.10, 6.13, 3.10, 9.13, 7.26, 4.74],
          [7.46, 6.77, 12.74, 7.11, 7.81, 8.84, 6.08, 5.39, 8.15, 6.42, 5.73]
        ],
        "stage": 0,
        "fit": true,
        "xlim": [0, 16],
        "ylim": [0, 14],
        "title": "Same line, different data"
      },
      "commands": [
        { "draw": ["title", "axes", "points"], "parallel": true, "speak": "Eleven points. They look like a cloud with a trend." },
        { "draw": ["fit_line"], "speak": "The regression line: y equals three plus half of x. Nothing surprising." },
        { "animate": { "stage": 1 }, "duration": 3, "speak": "Now watch the points move to Anscombe's second dataset. A perfect curve, no noise at all. The line does not move." },
        { "animate": { "stage": 2 }, "duration": 3, "speak": "And the third: a straight line with one outlier dragging the fit. Same slope, same intercept." },
        { "highlight": { "target": ["fit_line"] }, "delivery": "grave", "speak": "Three stories the summary statistics cannot tell apart. Always look at the points." }
      ]
    }
  },
  {
    "request": "Simulate how exam scores rise with hours studied, and fit the line in Python",
    "packs": ["data"],
    "spec": {
      "title": "Hours and scores",
      "template": "scatter_plot",
      "params": {
        "x": [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
        "y": "{sim.scores}",
        "fit": "{sim.fit}",
        "ylim": [0, 100],
        "x_label": "Hours studied",
        "y_label": "Score",
        "box": { "x": 470, "y": 95, "w": 460, "h": 560 }
      },
      "elements": [
        { "id": "sim", "type": "code", "language": "python", "show": "code", "x": 225, "y": 400, "width": 410, "font_size": 15,
          "code": "import numpy as np\nrng = np.random.default_rng(11)\nhours = np.arange(1, 13)\nscores = 40 + 4 * hours + rng.normal(0, 6, 12)\nscores = np.clip(scores, 0, 100).round(1)\nslope, intercept = np.polyfit(hours, scores, 1)\nfit = [round(float(slope), 2), round(float(intercept), 2)]" }
      ],
      "commands": [
        { "draw": ["sim", "sim_line_1", "sim_line_2", "sim_line_3"], "parallel": true, "speak": "Twelve students, one to twelve hours of study." },
        { "draw": ["sim_line_4", "sim_line_5"], "parallel": true, "speak": "Scores rise with hours, plus some noise: nobody's brain is a formula." },
        { "draw": ["axes", "points"], "parallel": true, "speak": "Here they are. The trend is visible, the scatter is real." },
        { "draw": ["sim_line_6", "sim_line_7"], "parallel": true, "speak": "Two lines of numpy fit the least-squares line and hand its slope and intercept to the chart." },
        { "draw": ["fit_line"], "speak": "Roughly four points per hour. The line is computed by the script; the chart just draws it." }
      ]
    }
  }
]
```

Run the Python for the second example locally to confirm the fitted slope is near 4 (between 3 and 5); if not, change "Roughly four points per hour" to the nearest integer and report.

- [ ] **Step 7: Run** `npx vitest run tests/examples.test.ts tests/translate-coverage.test.ts`, `npm test`, `npx tsc --noEmit` — green.

- [ ] **Step 8: Commit** — `feat(scenes): scatter_plot — labelled beats, least-squares or scripted fit, staged points (+2 examples)`.

---

### Task 3: Data-bounded stage slider, threshold 100, prompt clause

**Files:**
- Modify: `src/ui/tray-model.ts`, `src/ui/tray.ts:35`, `tests/tray-model.test.ts`
- Modify: `src/scenes/catalog.ts:25`, `tests/pack-defaults.test.ts` (comment only if it names 80)
- Modify: `src/scenes/packs/data.yaml` (`bar_chart.stage` gains `x-max-from: ["values", "series.0.values"]`)
- Modify: `src/llm/prompts/compiler-v1.md` (data bullet), `tests/prompt.test.ts`

- [ ] **Step 1: Failing tests** — append to `tests/tray-model.test.ts`:

```ts
describe("x-max-from — a slider bounded by the data's stage count", () => {
  const schema = { type: "object", properties: { stage: { type: "number", minimum: 0, "x-max-from": ["values", "series.0.values"] } } };
  test("staged values give max = stages − 1 with a continuous step", () => {
    expect(sliderSpecs(schema, { values: [[1, 2], [3, 4], [5, 6]] })).toEqual([{ path: "stage", label: "stage", min: 0, max: 2, step: "any" }]);
  });
  test("falls through the candidate paths", () => {
    expect(sliderSpecs(schema, { series: [{ values: [[1], [2]] }] })).toEqual([{ path: "stage", label: "stage", min: 0, max: 1, step: "any" }]);
  });
  test("a static list, a token or a single stage yields no slider", () => {
    expect(sliderSpecs(schema, { values: [1, 2, 3] })).toEqual([]);
    expect(sliderSpecs(schema, { values: "{sim.frames}" })).toEqual([]);
    expect(sliderSpecs(schema, { values: [[1, 2]] })).toEqual([]);
    expect(sliderSpecs(schema)).toEqual([]);
  });
  test("a static maximum still wins over the hint", () => {
    const s = { type: "object", properties: { stage: { type: "number", minimum: 0, maximum: 5, "x-max-from": ["values"] } } };
    expect(sliderSpecs(s, { values: [[1], [2], [3]] })[0].max).toBe(5);
  });
});
```

- [ ] **Step 2: Implement** in `src/ui/tray-model.ts`: `sliderSpecs(schema: unknown, params?: Record<string, unknown>)`. In `boundedNumber(node, params)`: if `node.maximum` is not a number and `node["x-max-from"]` is a string or string[] and `node.minimum` is a number, walk each candidate dot path (object keys and array indices) through `params`; the first value that is an array whose first element is an array (staged) with length ≥ 2 gives `max = length − 1`, `step: "any"`; otherwise no slider. Update the doc comment at the top of the file (“…or a `x-max-from` hint naming the staged param whose stage count bounds it”). In `src/ui/tray.ts:35` pass the current spec's params (`hd.spec.params` — the handle's resolved clone — is what the tray already reads for initial values; use the same source).

- [ ] **Step 3:** `src/scenes/catalog.ts`: `TEMPLATE_FULL_THRESHOLD = 100` with a one-line comment (“raised 2026-09-02 with the data pack; Hans OK”). `bar_chart.stage` gains the hint (Task 1 and 2 templates already carry theirs).

- [ ] **Step 4: Prompt** — in the data bullet of `compiler-v1.md` (the line starting `- **Data from code, drawn as ink.**`), after the sentence that names `bar_chart` / `data_table`, insert: `The same rules drive \`line_chart\` (\`x\` numbers or category strings, \`values\` or \`series\`, each line ends in its name — a shorter earlier stage reveals a line point by point) and \`scatter_plot\` (\`x\`, \`y\`, optional per-point \`labels\` that become \`point_i\` beats, and \`fit: true\` for a least-squares line or \`fit: [slope, intercept]\` from the script — the \`points\` beat draws every unnamed dot at once).` Add to `tests/prompt.test.ts`: `expect(compilerV1).toContain("scatter_plot"); expect(compilerV1).toContain("line_chart");`.

- [ ] **Step 5: Run** `npx vitest run tests/tray-model.test.ts tests/pack-defaults.test.ts tests/catalog-split.test.ts tests/prompt.test.ts`, then `npm test`, `npx tsc --noEmit` — green. If `tests/catalog-split.test.ts` builds a fixture sized from the old constant, adapt it to `TEMPLATE_FULL_THRESHOLD` (never hard-code 80).

- [ ] **Step 6: Commit** — `feat(tray): stage slider bounded by the data (x-max-from); catalog threshold 100; prompt names line_chart and scatter_plot`.

---

### Task 4: Verification, smoke, push

- [ ] `npm test && npx tsc --noEmit && npm run build` — green.
- [ ] Browser smoke (controller, Playwright against `npm run dev -- --port 5178 --strictPort`): render the four new examples through `render()`; assert substituted values, ids in `order`, zero warnings; `renderUpTo(end)` commits the last stage; one screenshot of the Anscombe end state and one of the SIR curve.
- [ ] `git push origin main`; verify with `git ls-remote origin main`.

## Self-review

- Spec coverage M2: `line_chart` (T1), `scatter_plot` (T2), `x-max-from` (T3), threshold 100 (T3), examples (T1, T2). `packsDefault` v7 already landed in M1.
- Type consistency: `line_k__l` / `line_k__t` / `line_k__pN`, `points__dN`, `point_i__d` / `point_i__t`, `fit_line__l` / `fit_line__t` used identically in templates and tests; `sliderSpecs(schema, params?)` signature matches the tray call.
- Placeholders: none.
