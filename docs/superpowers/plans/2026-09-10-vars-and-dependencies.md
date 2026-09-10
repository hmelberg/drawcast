# Vars and Dependencies Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A freehand figure can sweep a number (`vars` + `animate`) with everything that reads it re-drawn each frame, and a point, region, arrow, angle or line defined in terms of another element follows that element when it moves.

**Architecture:** One mechanism for both: the `animate` path (full re-layout per frame → `swapGeometry`, settled by a remount) generalised from "params" to "params + vars + the poses/shapes of the elements something depends on". Layout gets an `overrides` argument and a posed *lookup view* so definitional references read moved geometry while an element's own ink stays in its original frame. The planner marks steps that need a re-layout (`relayout`) and the player tweens those through the reprojector.

**Tech Stack:** TypeScript, Vite, vitest (`npx vitest run <file>`), no DOM in tests (stub reprojector as in `tests/animate.test.ts`).

**Spec:** `docs/superpowers/specs/2026-09-10-vars-and-dependencies-design.md`

## Global Constraints

- The model writes semantics; code computes geometry. No new coordinate task for the model; no new verb.
- Names are single tokens: `vars`, `bind`, `on`, `trail` (spec §2.6). Schema descriptions stay short (the schema is 17.7k tokens).
- Every task ends green: `npx vitest run` for the touched test files, and `npx tsc --noEmit` before each commit (the build runs `tsc`).
- Commit per task on branch `manim-round` (worktree `.claude/worktrees/template-spike`); push the branch after each task (`git push -u origin manim-round`). Commit messages end with the session trailer used so far.
- `layout/` may import `render/pose.ts` (pure math) — the one layering exception this round, noted in the file header.
- Measures keep their round-3 planner recompute (`MeasureFollow`); they are not relayout triggers (`definitionalRefs` excludes `measure`), but a relayout layout recomputes them from posed refs, and the two agree.
- Baseline before this round: 332 test files, 6473 tests, all green (2026-09-10 12:32).

---

### Task 1: `src/spec/vars.ts` — var names, text tokens, bindings; expressions read vars

**Files:**
- Create: `src/spec/vars.ts`
- Modify: `src/layout/curves.ts:57-67` (`sampleExpression` takes vars)
- Test: `tests/vars.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type Vars = Record<string, number>;
  export const EXPR_BASE_VARS: readonly string[];            // ["x","X","q","Q","t","T"]
  export function varNameErrors(vars: unknown): string[];     // [] when valid
  export function exprVariables(vars?: Vars): string[];       // base + var names
  export function formatVar(value: number, decimals?: number): string;
  export function interpolateVars(text: string, vars: Vars): { text: string; unknown: string[] };
  export function evalBindings(el: SpecElement, vars: Vars): { el: SpecElement; errors: string[] };
  // curves.ts
  export function sampleExpression(expr: string, x0: number, x1: number, vars?: Vars): Pt[];
  ```

- [ ] **Step 1: Write the failing tests**

```ts
// tests/vars.test.ts
import { describe, expect, test } from "vitest";
import { evalBindings, exprVariables, formatVar, interpolateVars, varNameErrors } from "../src/spec/vars";
import { sampleExpression } from "../src/layout/curves";
import type { SpecElement } from "../src/spec/types";

describe("var names", () => {
  test("plain names pass; reserved, malformed and non-finite fail", () => {
    expect(varNameErrors({ f: 1, a_2: 0.5 })).toEqual([]);
    expect(varNameErrors({ x: 1 })).toEqual(['vars: "x" is reserved (a curve variable, a function or a constant of expressions)']);
    expect(varNameErrors({ sin: 1 })[0]).toContain("reserved");
    expect(varNameErrors({ pi: 1 })[0]).toContain("reserved");
    expect(varNameErrors({ "2f": 1 })[0]).toContain("not a name");
    expect(varNameErrors({ f: Infinity })[0]).toContain("finite number");
    expect(varNameErrors(["f"])[0]).toContain("an object");
  });
  test("exprVariables is the six curve names plus the vars", () => {
    expect(exprVariables({ f: 1 })).toEqual(["x", "X", "q", "Q", "t", "T", "f"]);
    expect(exprVariables(undefined)).toEqual(["x", "X", "q", "Q", "t", "T"]);
  });
});

describe("text tokens", () => {
  test("{f} is formatted by the measure rule, {f:2} by explicit decimals, unknown names stay and are reported", () => {
    expect(formatVar(1.57)).toBe("1.6");
    expect(formatVar(60)).toBe("60");
    expect(formatVar(540.4)).toBe("540");
    expect(formatVar(1.57, 2)).toBe("1.57");
    expect(interpolateVars("f = {f}, twice {f:2}", { f: 1.57 })).toEqual({ text: "f = 1.6, twice 1.57", unknown: [] });
    expect(interpolateVars("k = {k}", { f: 1 })).toEqual({ text: "k = {k}", unknown: ["k"] });
    expect(interpolateVars("no tokens", { f: 1 })).toEqual({ text: "no tokens", unknown: [] });
  });
});

describe("bindings", () => {
  test("a bound field is replaced by the expression's value; dot paths reach nested numbers", () => {
    const el: SpecElement = { id: "s", type: "sector", x: 500, y: 375, radius: 100, start: 0, end: 30, bind: { end: "30 + 60*f", "at.x": "2*f" }, at: { x: 1, on: "w" } } as SpecElement;
    const r = evalBindings(el, { f: 2 });
    expect(r.errors).toEqual([]);
    expect(r.el.end).toBe(150);
    expect((r.el.at as { x: number }).x).toBe(4);
    expect(el.end).toBe(30); // the original is untouched
  });
  test("a non-numeric path and an unknown var are errors and the binding is dropped", () => {
    const el = { id: "s", type: "sector", x: 1, bind: { text: "f", radius: "g*2" } } as unknown as SpecElement;
    const r = evalBindings(el, { f: 1 });
    expect(r.errors).toEqual([
      'element "s": bind "text" — not a numeric field of the element',
      'element "s": bind "radius" — unknown identifier "g"',
    ]);
    expect((r.el as { text?: unknown }).text).toBeUndefined();
  });
  test("a binding that evaluates to a non-finite number is an error", () => {
    const el = { id: "s", type: "sector", radius: 10, bind: { radius: "1/0" } } as unknown as SpecElement;
    expect(evalBindings(el, {}).errors[0]).toContain("not a finite number");
  });
});

describe("sampleExpression with vars", () => {
  test("sin(f*x) at f = 2 differs from f = 1 and matches Math.sin", () => {
    const pts = sampleExpression("sin(f*x)", 0, 3, { f: 2 });
    expect(pts[pts.length - 1][1]).toBeCloseTo(Math.sin(6), 9);
    expect(() => sampleExpression("sin(f*x)", 0, 3)).toThrow(/unknown identifier "f"/);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/vars.test.ts`
Expected: FAIL — `Cannot find module '../src/spec/vars'`.

- [ ] **Step 3: Write `src/spec/vars.ts`**

```ts
// Vars (design 2026-09-10 §2.1–2.2): a spec's top-level numbers, read by
// curve expressions, by `bind` expressions on any element, and as `{name}`
// tokens in drawn text. animate sweeps them (render/plan.ts).
import { compileExpression } from "./expression";
import type { SpecElement } from "./types";

export type Vars = Record<string, number>;

/** The variable names every curve expression already has. */
export const EXPR_BASE_VARS: readonly string[] = ["x", "X", "q", "Q", "t", "T"];

/** Names an expression resolves before it looks at vars — a var so named could never be read. */
const RESERVED = new Set([
  ...EXPR_BASE_VARS,
  "pi", "e",
  "exp", "ln", "log", "log10", "sqrt", "abs", "min", "max", "pow", "sin", "cos", "tan", "floor", "ceil", "round",
]);

const NAME = /^[a-zA-Z_][a-zA-Z_0-9]*$/;

export function varNameErrors(vars: unknown): string[] {
  if (typeof vars !== "object" || vars === null || Array.isArray(vars)) return ["vars: must be an object of numbers, e.g. {f: 1}"];
  const errors: string[] = [];
  for (const [name, value] of Object.entries(vars as Record<string, unknown>)) {
    if (!NAME.test(name)) errors.push(`vars: "${name}" is not a name (letters, digits and _ only, not starting with a digit)`);
    else if (RESERVED.has(name)) errors.push(`vars: "${name}" is reserved (a curve variable, a function or a constant of expressions)`);
    if (typeof value !== "number" || !Number.isFinite(value)) errors.push(`vars: "${name}" must be a finite number`);
  }
  return errors;
}

export function exprVariables(vars?: Vars): string[] {
  return [...EXPR_BASE_VARS, ...Object.keys(vars ?? {})];
}

/** The measure rule (layout/measures.ts formatMeasure): ≥ 100 → no decimals, else one, a trailing .0 dropped; explicit decimals kept as written. */
export function formatVar(value: number, decimals?: number): string {
  if (decimals !== undefined) return value.toFixed(decimals);
  const d = Math.abs(value) >= 100 ? 0 : 1;
  return value.toFixed(d).replace(/\.0$/, "");
}

const TOKEN = /\{([a-zA-Z_][a-zA-Z_0-9]*)(?::(\d))?\}/g;

/** `{f}` / `{f:2}` → the var's value; an unknown name is left as written and returned in `unknown`. */
export function interpolateVars(text: string, vars: Vars): { text: string; unknown: string[] } {
  const unknown: string[] = [];
  const out = text.replace(TOKEN, (whole, name: string, decimals: string | undefined) => {
    if (!Object.prototype.hasOwnProperty.call(vars, name)) {
      if (!unknown.includes(name)) unknown.push(name);
      return whole;
    }
    return formatVar(vars[name], decimals === undefined ? undefined : Number(decimals));
  });
  return { text: out, unknown };
}

/** Read the number at a dot path (`at.x`, `points.2.0`); null when the path does not end on a finite number. */
function numberAt(obj: unknown, segs: string[]): number | null {
  let cur: unknown = obj;
  for (const s of segs) {
    if (Array.isArray(cur)) cur = /^\d+$/.test(s) ? cur[Number(s)] : undefined;
    else if (typeof cur === "object" && cur !== null) cur = (cur as Record<string, unknown>)[s];
    else return null;
  }
  return typeof cur === "number" && Number.isFinite(cur) ? cur : null;
}

/** Write `value` at a dot path on a copy, cloning every container on the way. */
function withNumberAt<T>(obj: T, segs: string[], value: number): T {
  const [head, ...rest] = segs;
  if (Array.isArray(obj)) {
    const copy = [...obj] as unknown[];
    const i = Number(head);
    copy[i] = rest.length === 0 ? value : withNumberAt(copy[i], rest, value);
    return copy as unknown as T;
  }
  const copy = { ...(obj as Record<string, unknown>) };
  copy[head] = rest.length === 0 ? value : withNumberAt(copy[head], rest, value);
  return copy as T;
}

/**
 * `bind: {field: expr}` — evaluate every expression over the vars into a
 * shallow copy of the element (design §2.2). A path that does not end on a
 * number, an unknown identifier, a bad expression or a non-finite result is
 * an error and that binding is dropped; the others still apply.
 */
export function evalBindings(el: SpecElement, vars: Vars): { el: SpecElement; errors: string[] } {
  const bind = (el as { bind?: unknown }).bind;
  if (typeof bind !== "object" || bind === null) return { el, errors: [] };
  const errors: string[] = [];
  let out = el;
  const names = Object.keys(vars);
  for (const [path, expr] of Object.entries(bind as Record<string, unknown>)) {
    const segs = path.split(".");
    if (typeof expr !== "string" || segs.some((s) => s === "") || segs[0] === "bind") {
      errors.push(`element "${el.id}": bind "${path}" — the expression must be a string`);
      continue;
    }
    if (numberAt(out, segs) === null) {
      errors.push(`element "${el.id}": bind "${path}" — not a numeric field of the element`);
      continue;
    }
    let value: number;
    try {
      value = compileExpression(expr, names)(vars);
    } catch (err) {
      errors.push(`element "${el.id}": bind "${path}" — ${(err as Error).message}`);
      continue;
    }
    if (!Number.isFinite(value)) {
      errors.push(`element "${el.id}": bind "${path}" — "${expr}" is not a finite number`);
      continue;
    }
    out = withNumberAt(out, segs, value);
  }
  return { el: out, errors };
}
```

Then in `src/layout/curves.ts` replace `sampleExpression`:

```ts
import { exprVariables, type Vars } from "../spec/vars";

/** Sample an explicit expression y = f(x) over [x0, x1] in domain units; `vars` are read by name. */
export function sampleExpression(expr: string, x0: number, x1: number, vars: Vars = {}): Pt[] {
  const f = compileExpression(expr, exprVariables(vars));
  const pts: Pt[] = [];
  for (let i = 0; i <= CURVE_SAMPLES; i++) {
    const x = x0 + ((x1 - x0) * i) / CURVE_SAMPLES;
    const y = f({ ...vars, x, X: x, q: x, Q: x, t: x, T: x });
    if (Number.isFinite(y)) pts.push([x, y]);
  }
  if (pts.length < 2) throw new Error(`expression "${expr}" produced no finite points over [${x0}, ${x1}]`);
  return pts;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/vars.test.ts tests/curves.test.ts tests/expression.test.ts`
(If the latter two files do not exist, run `npx vitest run tests/vars.test.ts` and `npx vitest run -t expression`.)
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/spec/vars.ts src/layout/curves.ts tests/vars.test.ts
git commit -m "vars: names, {name} text tokens, bind expressions, and curve expressions that read them (manim round 1, Task 1)"
```

---

### Task 2: `src/spec/deps.ts` — definitional references and dependents

**Files:**
- Create: `src/spec/deps.ts`
- Test: `tests/deps.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export function definitionalRefs(el: SpecElement): string[];
  export function dependentsMap(elements: SpecElement[]): Map<string, string[]>; // source id → transitive dependents, spec order, never itself
  export function sourceIds(elements: SpecElement[]): string[];                  // every id something depends on, spec order of first use
  ```

- [ ] **Step 1: Write the failing tests**

```ts
// tests/deps.test.ts
import { describe, expect, test } from "vitest";
import { definitionalRefs, dependentsMap, sourceIds } from "../src/spec/deps";
import type { SpecElement } from "../src/spec/types";

const els = [
  { id: "d", type: "curve", expr: "100 - x" },
  { id: "s", type: "curve", expr: "x" },
  { id: "eq", type: "point", at: { intersection_of: ["d", "s"] } },
  { id: "cs", type: "region", between: ["d", "s"] },
  { id: "a", type: "arrow", from: { ref: "eq" }, to: { x: 10, y: 10 } },
  { id: "lbl", type: "label", attach_to: "eq", text: "E" },
  { id: "box", type: "shape", at: { ref: "eq", side: "right" } },
  { id: "ang", type: "angle", at: { ref: "s", anchor: "start" }, from: { ref: "d", anchor: "end" }, to: 90 },
  { id: "ln", type: "line", through: [{ ref: "eq" }, [0, 0]] },
  { id: "dot", type: "point", at: { x: 2, on: "d" } },
  { id: "m", type: "measure", of: "cs" },
  { id: "n1", type: "node", text: "A" },
  { id: "n2", type: "node", text: "B" },
  { id: "e", type: "edge", from: { ref: "n1" }, to: { ref: "n2" } },
] as unknown as SpecElement[];

describe("definitional references", () => {
  test("each element names what it is defined by; placement and labels are not definitions", () => {
    expect(definitionalRefs(els[2])).toEqual(["d", "s"]);
    expect(definitionalRefs(els[3])).toEqual(["d", "s"]);
    expect(definitionalRefs(els[4])).toEqual(["eq"]);
    expect(definitionalRefs(els[5])).toEqual([]);
    expect(definitionalRefs(els[6])).toEqual([]);
    expect(definitionalRefs(els[7])).toEqual(["s", "d"]);
    expect(definitionalRefs(els[8])).toEqual(["eq"]);
    expect(definitionalRefs(els[9])).toEqual(["d"]);
    expect(definitionalRefs(els[10])).toEqual([]); // measures keep their own follow path
    expect(definitionalRefs(els[13])).toEqual(["n1", "n2"]);
  });
  test("dependents are transitive and in spec order; sources are what something depends on", () => {
    const m = dependentsMap(els);
    expect(m.get("d")).toEqual(["eq", "cs", "a", "ang", "ln", "dot"]);
    expect(m.get("eq")).toEqual(["a", "ln"]);
    expect(m.get("n1")).toEqual(["e"]);
    expect(m.get("a")).toBeUndefined();
    expect(sourceIds(els)).toEqual(["d", "s", "eq", "n1", "n2"]);
  });
  test("a template id may be a source: an arrow from an id no element declares", () => {
    const m = dependentsMap([{ id: "a", type: "arrow", from: { ref: "eq_point" }, to: { ref: "n" } }, { id: "n", type: "node" }] as unknown as SpecElement[]);
    expect(m.get("eq_point")).toEqual(["a"]);
    expect(m.get("n")).toEqual(["a"]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/deps.test.ts` — Expected: FAIL, module not found.

- [ ] **Step 3: Write `src/spec/deps.ts`**

```ts
// Definitional references (design 2026-09-10 §2.5): the element ids an
// element is DEFINED by — an intersection's curves, a region's curves, an
// arrow's endpoints, an angle's vertex and arms, a line's points, a point on
// a curve. When one of those moves, the element is recomputed. Placement
// (`at`), labels (`attach_to`) and group membership are not definitions and
// are deliberately absent; so is `measure`, which follows through the
// planner's own recompute (render/plan.ts measureUpdates).
import type { SpecElement } from "./types";

function refOf(v: unknown): string | null {
  return typeof v === "object" && v !== null && !Array.isArray(v) && typeof (v as { ref?: unknown }).ref === "string" ? (v as { ref: string }).ref : null;
}

export function definitionalRefs(el: SpecElement): string[] {
  const out: string[] = [];
  const add = (id: string | null | undefined) => {
    if (typeof id === "string" && id !== "" && !out.includes(id)) out.push(id);
  };
  const at = el.at as { intersection_of?: unknown; on?: unknown; ref?: unknown } | undefined;
  switch (el.type) {
    case "point":
      if (Array.isArray(at?.intersection_of)) for (const id of at!.intersection_of as unknown[]) add(typeof id === "string" ? id : null);
      if (typeof at?.on === "string") add(at.on);
      break;
    case "region":
      for (const id of el.between ?? []) add(id);
      break;
    case "arrow":
    case "edge":
      add(refOf(el.from));
      add(refOf(el.to));
      break;
    case "angle":
      add(refOf(el.at));
      add(refOf(el.from));
      add(refOf(el.to));
      break;
    case "line":
      for (const p of el.through ?? []) add(refOf(p));
      break;
  }
  return out;
}

/** source id → every element that depends on it, directly or through others, in spec order. */
export function dependentsMap(elements: SpecElement[]): Map<string, string[]> {
  const direct = new Map<string, string[]>();
  for (const el of elements) {
    for (const ref of definitionalRefs(el)) {
      const list = direct.get(ref) ?? [];
      if (!list.includes(el.id)) list.push(el.id);
      direct.set(ref, list);
    }
  }
  const order = new Map(elements.map((el, i) => [el.id, i]));
  const out = new Map<string, string[]>();
  for (const src of direct.keys()) {
    const seen = new Set<string>();
    const stack = [...(direct.get(src) ?? [])];
    while (stack.length > 0) {
      const id = stack.shift()!;
      if (id === src || seen.has(id)) continue;
      seen.add(id);
      stack.push(...(direct.get(id) ?? []));
    }
    out.set(src, [...seen].sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0)));
  }
  return out;
}

export function sourceIds(elements: SpecElement[]): string[] {
  const out: string[] = [];
  for (const el of elements) for (const ref of definitionalRefs(el)) if (!out.includes(ref)) out.push(ref);
  return out;
}
```

- [ ] **Step 4: Run to verify pass** — `npx vitest run tests/deps.test.ts` — PASS.

- [ ] **Step 5: Commit**

```bash
git add src/spec/deps.ts tests/deps.test.ts
git commit -m "deps: definitional references, transitive dependents and source ids (manim round 1, Task 2)"
```

---

### Task 3: Types, schema and validation — `vars`, `bind`, `at.on`, `trail` on a command

**Files:**
- Modify: `src/spec/types.ts` (Spec ~`domain?:` line; SpecElement `at?:` line and after `bind`; Command after `ghost?:`)
- Modify: `src/spec/schema.ts` (element `at` properties ~line 120-131; element properties near `draw:` ~373; top-level after `domain:` ~842-850; command-level after `ghost:` ~765; `semanticErrors` ~1024; point check ~1338)
- Modify: `src/lint/lint.ts:22-45` (rule union gains `"bind"`)
- Test: `tests/vars-schema.test.ts`

**Interfaces:**
- Produces (types):
  ```ts
  // Spec
  vars?: Record<string, number>;
  // SpecElement
  at?: { x?: number; y?: number; on?: string; intersection_of?: string[]; ref?: string; anchor?: string; side?: Side; gap?: number; offset?: [number, number] } | [number, number];
  bind?: Record<string, string>;
  // Command
  trail?: { of: string; anchor?: string; color?: string; width?: number };
  ```

- [ ] **Step 1: Write the failing tests**

```ts
// tests/vars-schema.test.ts
import { describe, expect, test } from "vitest";
import { validateSpec } from "../src/spec/schema";

const base = { elements: [{ id: "w", type: "curve", expr: "sin(f*x)" }], commands: [{ draw: ["w"] }] };

describe("vars, bind, at.on and trail validate", () => {
  test("a spec with vars, a bind, a point on a curve and a trailing animate is valid", () => {
    const r = validateSpec({
      ...base,
      vars: { f: 1, t: 2 },
      elements: [
        ...base.elements,
        { id: "dot", type: "point", at: { x: 1, on: "w" }, bind: { "at.x": "t" } },
      ],
      commands: [{ draw: ["w", "dot"] }, { animate: { f: 3 }, trail: { of: "dot" }, duration: 4 }],
    });
    expect(r.errors).toEqual([]);
    expect(r.ok).toBe(true);
  });
  test("a reserved var name is an error", () => {
    const r = validateSpec({ ...base, vars: { x: 1 } });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes('"x" is reserved'))).toBe(true);
  });
  test("a non-numeric var and a non-string bind are structural errors", () => {
    expect(validateSpec({ ...base, vars: { f: "1" } }).ok).toBe(false);
    expect(validateSpec({ ...base, elements: [{ id: "w", type: "curve", expr: "x", bind: { x_to: 3 } }] }).ok).toBe(false);
  });
  test("at.on needs x; trail needs of", () => {
    expect(validateSpec({ ...base, elements: [...base.elements, { id: "p", type: "point", at: { on: "w" } }] }).errors[0]).toContain("at.on needs x");
    expect(validateSpec({ ...base, commands: [{ animate: { f: 1 }, trail: {} }], vars: { f: 0 } }).ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run tests/vars-schema.test.ts` — Expected: FAIL (vars rejected by `additionalProperties: false`, or `ok` true where an error is expected).

- [ ] **Step 3: Types**

In `src/spec/types.ts`:
- `Spec`: after `domain?: …;` add
  ```ts
  /** Top-level numbers (design 2026-09-10): read by curve `expr`, by `bind` expressions, as `{name}` in drawn text, and swept by animate. */
  vars?: Record<string, number>;
  ```
- `SpecElement`: in the `at?:` object type add `on?: string;` after `y?: number;`. After `anchor?: string;` add
  ```ts
  /** `{field: expr}` — numeric fields (or dot paths to numbers, `at.x`) computed from the vars at layout time. */
  bind?: Record<string, string>;
  ```
- `Command`: after the `ghost?: GhostOption;` line (the "With animate" one) add
  ```ts
  /** With animate: leave the track of `of`'s anchor across the sweep as the element `<of>_trail` (design §2.4). */
  trail?: { of: string; anchor?: string; color?: string; width?: number };
  ```

- [ ] **Step 4: Schema**

In `src/spec/schema.ts`:
- Element `at` object: after `y: { type: "number" },` add
  ```ts
  on: { type: "string", description: "point: the curve id this point sits ON at x — y is read off the curve (with x; not with y or intersection_of)." },
  ```
  and extend the `at` description's first sentence to `"Where the element goes. point: x,y, or x + on (a curve id), or intersection_of. …"`.
- Element properties, right before `style: styleSchema,`:
  ```ts
  bind: {
    type: "object",
    additionalProperties: { type: "string" },
    description: 'Numeric fields computed from the top-level vars: {"end": "30 + 60*f", "at.x": "t"} — a field name or a dot path to a number; the written value is the start. Same expression language as curve expr.',
  },
  ```
- Top-level, after the `domain` property:
  ```ts
  vars: {
    type: "object",
    additionalProperties: { type: "number" },
    description: 'Named numbers for a freehand figure, e.g. {"f": 1}: curve expr may use them ("sin(f*x)"), bind computes fields from them, drawn text shows them as {f}, and animate sweeps them ({"animate": {"f": 4}}). Names must not be x/t/q or a function name.',
  },
  ```
- Command-level, after the animate `ghost:` line:
  ```ts
  trail: {
    type: "object",
    properties: {
      of: { type: "string", description: "The element whose point is traced." },
      anchor: { type: "string", description: `Its anchor (default center): ${ANCHOR_NAMES}.` },
      color: { type: "string" },
      width: { type: "number", exclusiveMinimum: 0 },
    },
    required: ["of"],
    additionalProperties: false,
    description: "With animate: leave the track of that point across the sweep as the element <of>_trail (a locus — the spectrum a winding frequency traces); erase or fade it by id later.",
  },
  ```
  (`ANCHOR_NAMES` is the existing constant used by the `at.anchor` description; if it is declared below this point in the file, move the reference or inline the list the way `at.anchor` does.)
- `semanticErrors`, right after the `templates` check: `if (spec.vars !== undefined) errors.push(...varNameErrors(spec.vars));` (import `varNameErrors` from `./vars`).
- Point check (`case "point":`): change the first `need` message to `"needs at ({x,y}, {x, on} or {intersection_of})"`, and after the existing `need(!Array.isArray(el.at) …)` add
  ```ts
  const on = (el.at as { on?: unknown; x?: unknown }).on;
  if (on !== undefined) need(typeof on === "string" && typeof (el.at as { x?: unknown }).x === "number", "at.on needs x (the curve id and the x to read it at)");
  ```
- `src/lint/lint.ts` rule union: add `| "bind"` with the comment `/** a bind expression that cannot be evaluated: unknown var, non-numeric field, bad expression */` before `"math"`.

- [ ] **Step 5: Run** — `npx vitest run tests/vars-schema.test.ts tests/schema.test.ts` (and any `tests/*schema*.test.ts`) — PASS. Run `npx tsc --noEmit` — clean.

- [ ] **Step 6: Commit**

```bash
git add src/spec/types.ts src/spec/schema.ts src/lint/lint.ts tests/vars-schema.test.ts
git commit -m "Schema and types: vars, bind, point at.on, trail on animate (manim round 1, Task 3)"
```

---

### Task 4: Layout reads vars — expr, bind, text tokens, `at.on`

**Files:**
- Modify: `src/layout/tier2.ts` (`layoutElements` opts ~127-137; Pass 2 ~181-189; loop head ~205-207; `text` case ~264-283; `label` case ~228-243; `nodeDrawables` ~732-740; `sampleCurveDomain` ~594-604; `resolvePointDomain` ~628-660)
- Modify: `src/layout/layout.ts:112-118` (pass `vars`; collect bind issues)
- Test: `tests/vars-layout.test.ts`

**Interfaces:**
- Consumes: Task 1 (`evalBindings`, `interpolateVars`, `sampleExpression(expr, x0, x1, vars)`).
- Produces: `layoutElements(elements, domain, seedAnchors, seedCurveSamples, opts)` accepts `opts.vars?: Vars`; `layoutSpec` reads `spec.vars`. Bind errors arrive as `issues` with `rule: "bind", severity: "error"`; unknown text tokens as warnings.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/vars-layout.test.ts
import { describe, expect, test } from "vitest";
import { layoutSpec } from "../src/layout/layout";
import type { Spec } from "../src/spec/types";
import type { StrokeDrawable, TextDrawable } from "../src/layout/model";

const stroke = (l: ReturnType<typeof layoutSpec>, id: string) => l.drawables.find((d) => d.id === id) as StrokeDrawable;
const text = (l: ReturnType<typeof layoutSpec>, id: string) => l.drawables.find((d) => d.id === id) as TextDrawable;

describe("layout reads vars", () => {
  test("a curve expr reads a var; changing the var changes the curve", () => {
    const spec = (f: number): Spec => ({ vars: { f }, domain: { x: [0, 6], y: [-1, 1] }, elements: [{ id: "w", type: "curve", expr: "sin(f*x)" }], commands: [] });
    const a = stroke(layoutSpec(spec(1)), "w").pts;
    const b = stroke(layoutSpec(spec(2)), "w").pts;
    expect(a.length).toBe(b.length);
    expect(a[10][1]).not.toBeCloseTo(b[10][1], 3);
  });
  test("bind replaces a sector's end from the var; the spec object is untouched", () => {
    const el = { id: "s", type: "sector", x: 500, y: 375, radius: 100, start: 0, end: 30, bind: { end: "30 + 60*f" } } as Spec["elements"][number];
    const l = layoutSpec({ vars: { f: 1 }, elements: [el], commands: [] });
    expect(l.namedAnchors.s.end[1]).toBeCloseTo(375 + 100 * Math.sin(Math.PI / 2), 6); // end anchor at 90°
    expect(el.end).toBe(30);
  });
  test("an unknown var in a bind is an error-severity lint, and the written value is used", () => {
    const l = layoutSpec({ vars: { f: 1 }, elements: [{ id: "s", type: "sector", x: 500, y: 375, radius: 100, start: 0, end: 30, bind: { end: "g" } }], commands: [] });
    expect(l.issues.some((i) => i.rule === "bind" && i.severity === "error" && i.ids[0] === "s" && i.message.includes('unknown identifier "g"'))).toBe(true);
    expect(l.namedAnchors.s.end[0]).toBeCloseTo(500 + 100 * Math.cos(Math.PI / 6), 6);
  });
  test("{f} in text, label and node text is written; an unknown token warns and stays", () => {
    const l = layoutSpec({
      vars: { f: 1.57 },
      elements: [
        { id: "t", type: "text", text: "f = {f}", x: 500, y: 700 },
        { id: "n", type: "node", text: "{f:2}", x: 200, y: 200 },
        { id: "w", type: "curve", expr: "x" },
        { id: "lb", type: "label", attach_to: "w", text: "k = {k}" },
      ],
      commands: [],
    });
    expect(text(l, "t").text).toBe("f = 1.6");
    expect(text(l, "n_text").text).toBe("1.57");
    expect(text(l, "lb").text).toBe("k = {k}");
    expect(l.warnings.some((w) => w.includes('label "lb"') && w.includes("{k}"))).toBe(true);
  });
  test("a point ON a curve at x reads its y off the curve", () => {
    const l = layoutSpec({ domain: { x: [0, 10], y: [0, 100] }, elements: [{ id: "w", type: "curve", expr: "x*x" }, { id: "p", type: "point", at: { x: 3, on: "w" } }], commands: [] });
    const w = stroke(l, "w").pts;
    const p = stroke(l, "p") ;
    // the dot's centre sits on the sampled curve at x = 3 → y = 9 (domain), i.e. between the samples around it
    const c = p.shapeHint && p.shapeHint.type === "circle" ? p.shapeHint.c : p.pts[0];
    const near = w.reduce((best, q) => (Math.abs(q[0] - c[0]) < Math.abs(best[0] - c[0]) ? q : best), w[0]);
    expect(Math.abs(near[1] - c[1])).toBeLessThan(4);
    expect(l.warnings).toEqual([]);
  });
  test("a point on an unknown curve or off its range warns and is skipped", () => {
    const l = layoutSpec({ domain: { x: [0, 10], y: [0, 100] }, elements: [{ id: "w", type: "curve", expr: "x", x_from: 0, x_to: 5 }, { id: "p", type: "point", at: { x: 8, on: "w" } }, { id: "q", type: "point", at: { x: 1, on: "nope" } }], commands: [] });
    expect(l.warnings.some((w) => w.includes('point "p"') && w.includes("outside"))).toBe(true);
    expect(l.warnings.some((w) => w.includes('point "q"') && w.includes("unknown curve"))).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run tests/vars-layout.test.ts` — FAIL.

- [ ] **Step 3: Implement**

`src/layout/tier2.ts`:
- Import `{ evalBindings, interpolateVars, type Vars } from "../spec/vars"`.
- `layoutElements` opts type: `{ measure?: MeasureFn; seedDrawables?: Drawable[]; vars?: Vars }`; `const vars = opts.vars ?? {};` and put `vars` on `Ctx` (`vars: Vars`).
- `Tier2Result.issues` already exists (placement issues) — bind errors are pushed there.
- Pass 2 (curves): apply bindings before sampling so `x_from`/`x_to`/`expr` see bound values:
  ```ts
  for (const raw of elements.filter((e) => e.type === "curve")) {
    const el = bound(raw);
    …sampleCurveDomain(el, ctx)…
  }
  ```
  where, defined before Pass 2:
  ```ts
  // bind (design §2.2): evaluated once per element into a copy; errors are
  // error-severity lint so the repair round sees them. Cached so Pass 2 and
  // Pass 3 see the same copy.
  const boundCache = new Map<string, SpecElement>();
  const bound = (el: SpecElement): SpecElement => {
    const hit = boundCache.get(el.id);
    if (hit) return hit;
    const r = evalBindings(el, vars);
    for (const msg of r.errors) issues.push({ rule: "bind", ids: [el.id], severity: "error", message: msg });
    boundCache.set(el.id, r.el);
    return r.el;
  };
  ```
  Note `issues` is declared by `placementOrder(...)` further down today (`const { order: emitOrder, issues } = placementOrder(elements, known);`). Move that call ABOVE Pass 2 (it only reads `elements` and `known`; `known` needs `seedAnchors`/`opts.seedDrawables`, both available) so `issues` exists for Pass 2.
- Pass 3 loop head: `for (const raw of emitOrder) { const el = bound(raw); const start = drawables.length; switch (el.type) { …` — every later use of `el` in the loop body then sees the bound copy. Relative placement reads `relAt(el)` — bound `at.x`/`at.y` therefore apply to placement too, which is right.
- `sampleCurveDomain`: pass `ctx.vars` to `sampleExpression(el.expr, x0, x1, ctx.vars)`.
- Text tokens: a helper in tier2.ts
  ```ts
  /** `{name}` tokens in drawn text (design §2.1); an unknown name stays as written and warns. */
  function withVars(text: string, el: SpecElement, ctx: Ctx): string {
    const r = interpolateVars(text, ctx.vars);
    for (const name of r.unknown) ctx.warnings.push(`${el.type} "${el.id}": text names {${name}}, which is not one of the vars — left as written`);
    return r.text;
  }
  ```
  applied in the `text` case (`text: withVars(el.text ?? "", el, ctx)`), the `label` case (`text: withVars(el.text ?? el.id, el, ctx)`), and `nodeDrawables` (`const text = el.text === undefined ? undefined : withVars(el.text, el, ctx);`).
- `resolvePointDomain`: after the `intersection_of` branch and before the `x/y` branch:
  ```ts
  if (typeof at.on === "string") {
    const samples = ctx.curveSamples.get(at.on);
    if (!samples) { ctx.warnings.push(`point "${el.id}": at.on names unknown curve "${at.on}"`); return null; }
    if (typeof at.x !== "number") { ctx.warnings.push(`point "${el.id}": at.on needs x`); return null; }
    const y = interpolateAtX(samples, at.x);
    if (y === null) { ctx.warnings.push(`point "${el.id}": x = ${at.x} is outside curve "${at.on}"`); return null; }
    return [at.x, y];
  }
  ```
`src/layout/layout.ts`: pass `vars: spec.vars` in the `layoutElements(...)` opts (line 114). `issues.push(...tier2.issues)` already happens.

- [ ] **Step 4: Run** — `npx vitest run tests/vars-layout.test.ts tests/tier2.test.ts tests/placement.test.ts` (whatever exists among those) then the full suite `npx vitest run` — PASS.

- [ ] **Step 5: Commit**

```bash
git add src/layout/tier2.ts src/layout/layout.ts tests/vars-layout.test.ts
git commit -m "Layout reads vars: curve expr, bind on any element, {name} in drawn text, a point on a curve (manim round 1, Task 4)"
```

---

### Task 5: Layout overrides — the posed lookup view

**Files:**
- Create: `src/layout/posed.ts`
- Modify: `src/render/minted.ts:46-78` (`ghostDrawables` uses `mapLeaf`)
- Modify: `src/layout/tier2.ts` (Ctx gains `ix`, `iy`, `view`, `posedAnchors`, `posedNamed`; `ctx.drawablesSoFar` is the view; `resolveEnd`; group anchors; `applyOverride`)
- Modify: `src/layout/layout.ts:53` (`layoutSpec(rawSpec, measure, overrides?)`)
- Test: `tests/dependencies-layout.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // src/layout/posed.ts
  export interface PoseOverride { offset: Pt; turn?: Turn }
  export interface LayoutOverrides { poses?: Record<string, PoseOverride>; shapes?: Record<string, Record<string, Pt[]>> }
  export type LeafDrawable = Exclude<Drawable, GroupDrawable>;
  export function poseMapOf(ov: PoseOverride): { map: (p: Pt) => Pt; scale: number };
  export function mapLeaf(leaf: LeafDrawable, map: (p: Pt) => Pt, scale: number, shapes?: Record<string, Pt[]>): LeafDrawable;
  export function mapDrawable(d: Drawable, map: (p: Pt) => Pt, scale: number, shapes?: Record<string, Pt[]>): Drawable;
  export function isEmptyOverrides(ov?: LayoutOverrides): boolean;
  export function overridesKey(ov?: LayoutOverrides): string; // "" when empty, else stable JSON
  // layout.ts
  export function layoutSpec(rawSpec: Spec, measure?: MeasureFn, overrides?: LayoutOverrides): LayoutResult;
  ```

- [ ] **Step 1: Write the failing tests**

```ts
// tests/dependencies-layout.test.ts
import { describe, expect, test } from "vitest";
import { layoutSpec } from "../src/layout/layout";
import { isEmptyOverrides, mapLeaf, overridesKey } from "../src/layout/posed";
import type { Spec } from "../src/spec/types";
import type { AreaDrawable, StrokeDrawable } from "../src/layout/model";

const stroke = (l: ReturnType<typeof layoutSpec>, id: string) => l.drawables.find((d) => d.id === id) as StrokeDrawable;
const dot = (l: ReturnType<typeof layoutSpec>, id: string) => { const d = stroke(l, id); return d.shapeHint?.type === "circle" ? d.shapeHint.c : d.pts[0]; };
const area = (pts: [number, number][]) => Math.abs(pts.reduce((s, p, i) => { const q = pts[(i + 1) % pts.length]; return s + p[0] * q[1] - q[0] * p[1]; }, 0) / 2);

const market: Spec = {
  domain: { x: [0, 100], y: [0, 100] },
  elements: [
    { id: "d", type: "curve", expr: "80 - x" },
    { id: "s", type: "curve", expr: "20 + x" },
    { id: "eq", type: "point", at: { intersection_of: ["d", "s"] }, guides: true },
    { id: "cs", type: "region", between: ["d", "s"], x_from: 0, x_to: 30 },
    { id: "a", type: "arrow", from: { ref: "eq" }, to: { x: 80, y: 90 } },
    { id: "lb", type: "label", attach_to: "d", text: "D" },
  ],
  commands: [],
};

describe("posed helpers", () => {
  test("mapLeaf maps text, circle hints (radius × scale), rect hints (to corners) and points", () => {
    const map = (p: [number, number]): [number, number] => [p[0] + 10, p[1] * 2];
    const t = mapLeaf({ id: "t", kind: "text", pos: [1, 1], text: "x", fontSize: 20, anchor: "middle", z: 2, style: { color: "#000", strokeWidth: 1, roughness: 1, opacity: 1 }, drawOpts: { mode: "instant", duration: 0 } }, map, 2);
    expect((t as { pos: [number, number] }).pos).toEqual([11, 2]);
    const c = mapLeaf({ id: "c", kind: "stroke", pts: [[5, 5]], shapeHint: { type: "circle", c: [5, 5], r: 3 }, z: 1, style: { color: "#000", strokeWidth: 1, roughness: 1, opacity: 1 }, drawOpts: { mode: "instant", duration: 0 } }, map, 2) as StrokeDrawable;
    expect(c.shapeHint).toEqual({ type: "circle", c: [15, 10], r: 6 });
    const r = mapLeaf({ id: "r", kind: "stroke", pts: [], shapeHint: { type: "rect", x: 0, y: 0, w: 2, h: 2 }, z: 1, style: { color: "#000", strokeWidth: 1, roughness: 1, opacity: 1 }, drawOpts: { mode: "instant", duration: 0 } }, map, 1) as StrokeDrawable;
    expect(r.shapeHint).toBeUndefined();
    expect(r.closed).toBe(true);
    expect(r.pts).toEqual([[10, 0], [12, 0], [12, 4], [10, 4]]);
  });
  test("overridesKey is empty for nothing and stable for something", () => {
    expect(isEmptyOverrides(undefined)).toBe(true);
    expect(isEmptyOverrides({ poses: {} })).toBe(true);
    expect(overridesKey({ poses: {} })).toBe("");
    expect(overridesKey({ poses: { d: { offset: [5, 0] } } })).toBe(overridesKey({ poses: { d: { offset: [5, 0] } } }));
  });
});

describe("definitions hold under overrides", () => {
  test("an intersection follows a translated curve; the curve's own ink does not move; the label anchor stays raw", () => {
    const base = layoutSpec(market);
    const moved = layoutSpec(market, undefined, { poses: { d: { offset: [60, 0] } } }); // +60 logical ≈ +? domain, rightwards
    expect(stroke(moved, "d").pts).toEqual(stroke(base, "d").pts);
    const e0 = dot(base, "eq");
    const e1 = dot(moved, "eq");
    expect(e1[0]).toBeGreaterThan(e0[0] + 20);
    expect(e1[1]).toBeGreaterThan(e0[1] + 20); // up the supply curve
    // the arrow tail is the moved intersection
    expect(stroke(moved, "a").pts[0][0]).toBeCloseTo(e1[0], 0);
    // the label attached to d is solved against d's raw anchor, so its request anchor is unchanged
    const lb0 = base.drawables.find((d) => d.id === "lb") as { pos: [number, number] };
    const lb1 = moved.drawables.find((d) => d.id === "lb") as { pos: [number, number] };
    expect(lb1.pos[0] - lb0.pos[0]).toBeLessThan(30);
  });
  test("a region between a moved and a fixed curve changes area the right way", () => {
    const base = layoutSpec(market);
    const up = layoutSpec(market, undefined, { poses: { d: { offset: [0, 40] } } });
    expect(area((up.drawables.find((d) => d.id === "cs") as AreaDrawable).pts)).toBeGreaterThan(area((base.drawables.find((d) => d.id === "cs") as AreaDrawable).pts));
  });
  test("an angle follows a rotated arm; a line through a moved point follows", () => {
    const spec: Spec = {
      elements: [
        { id: "v", type: "shape", shape: "circle", x: 500, y: 375, radius: 4 },
        { id: "a", type: "arrow", from: { x: 500, y: 375 }, to: { x: 700, y: 375 } },
        { id: "b", type: "arrow", from: { x: 500, y: 375 }, to: { x: 700, y: 375 } },
        { id: "ang", type: "angle", at: { ref: "a", anchor: "tail" }, from: { ref: "a", anchor: "tip" }, to: { ref: "b", anchor: "tip" } },
        { id: "ln", type: "line", through: [{ ref: "v" }, { ref: "b", anchor: "tip" }] },
      ],
      commands: [],
    };
    const turned = layoutSpec(spec, undefined, { poses: { b: { offset: [0, 0], turn: { deg: 90, pivot: [500, 375] } } } });
    const arc = stroke(turned, "ang");
    expect(arc).toBeDefined();
    const label = turned.drawables.find((d) => d.id === "ang_text") as { text: string } | undefined;
    expect(label?.text).toBe("90°");
    const ln = stroke(turned, "ln");
    const dir = [ln.pts[1][0] - ln.pts[0][0], ln.pts[1][1] - ln.pts[0][1]];
    expect(Math.abs(dir[0])).toBeLessThan(1e-6); // vertical: through (500,375) and (500,575)
    expect(turned.warnings).toEqual([]);
  });
  test("an edge between nodes follows a moved node; a morphed curve's intersection follows its shapes", () => {
    const g = layoutSpec({ elements: [{ id: "n1", type: "node", x: 200, y: 300, text: "A" }, { id: "n2", type: "node", x: 600, y: 300, text: "B" }, { id: "e", type: "edge", from: { ref: "n1" }, to: { ref: "n2" } }], commands: [] }, undefined, { poses: { n2: { offset: [0, 200] } } });
    const e = stroke(g, "e");
    expect(e.pts[e.pts.length - 1][1]).toBeGreaterThan(400);
    const base = layoutSpec(market);
    const flat = stroke(base, "d").pts.map(([x]) => [x, 200] as [number, number]);
    const m = layoutSpec(market, undefined, { shapes: { d: { d: flat } } });
    expect(dot(m, "eq")[1]).toBeCloseTo(200, 0);
  });
  test("a template id can be a source: a freehand arrow from a template point follows its pose", () => {
    const spec: Spec = { template: "supply_demand", params: {}, elements: [{ id: "a", type: "arrow", from: { ref: "equilibrium_point" }, to: { x: 90, y: 90 } }], commands: [] };
    const base = layoutSpec(spec);
    const moved = layoutSpec(spec, undefined, { poses: { equilibrium_point: { offset: [0, 50] } } });
    expect(stroke(moved, "a").pts[0][1]).toBeCloseTo(stroke(base, "a").pts[0][1] + 50, 0);
  });
});
```
(The `supply_demand` template exports `equilibrium_point` — check `src/scenes/supply_demand/layout.ts` for the exact id and adjust the test to the real one.)

- [ ] **Step 2: Run to verify failure** — `npx vitest run tests/dependencies-layout.test.ts` — FAIL, module not found.

- [ ] **Step 3: Write `src/layout/posed.ts`** (the mapping code is lifted from `render/minted.ts` `ghostDrawables`; that function then calls `mapLeaf`)

```ts
// The posed lookup view (design 2026-09-10 §2.5): geometry of an element as
// it stands under a pose (offset/turn) and a morph (shapes), for the elements
// DEFINED in terms of it to read. The element's own drawables stay in their
// original frame — the renderer applies the pose transform.
//
// Layering: layout/ imports render/pose.ts here — the pure pose math, no DOM.
import { poseOf, type Turn } from "../render/pose";
import type { Drawable, GroupDrawable, Pt } from "./model";

export interface PoseOverride { offset: Pt; turn?: Turn }
export interface LayoutOverrides {
  poses?: Record<string, PoseOverride>;
  /** Morphed ORIGINAL-frame leaf points: element id → leaf id → points. */
  shapes?: Record<string, Record<string, Pt[]>>;
}
export type LeafDrawable = Exclude<Drawable, GroupDrawable>;

export function poseMapOf(ov: PoseOverride): { map: (p: Pt) => Pt; scale: number } {
  return { map: poseOf(ov.offset, ov.turn), scale: ov.turn?.scale ?? 1 };
}

/** A leaf under a point map: text and images move, a circle hint keeps its centre and scales its radius, a rect hint becomes its four mapped corners (a closed stroke), everything else maps its points (morphed `shapes` first). */
export function mapLeaf(leaf: LeafDrawable, map: (p: Pt) => Pt, scale: number, shapes?: Record<string, Pt[]>): LeafDrawable {
  if (leaf.kind === "text") return { ...leaf, pos: map(leaf.pos) };
  if (leaf.kind === "image") return { ...leaf, pos: map(leaf.pos), w: leaf.w * scale, h: leaf.h * scale };
  if (leaf.kind === "stroke" && leaf.shapeHint?.type === "circle") {
    const c = map(leaf.shapeHint.c);
    return { ...leaf, pts: [c], shapeHint: { type: "circle", c, r: leaf.shapeHint.r * scale } };
  }
  if (leaf.kind === "stroke" && leaf.shapeHint?.type === "rect") {
    const h = leaf.shapeHint;
    const corners: Pt[] = [[h.x, h.y], [h.x + h.w, h.y], [h.x + h.w, h.y + h.h], [h.x, h.y + h.h]];
    const { shapeHint: _drop, ...rest } = leaf;
    return { ...rest, pts: corners.map(map), closed: true };
  }
  const pts = (shapes?.[leaf.id] ?? leaf.pts).map(map);
  return leaf.kind === "area" ? { ...leaf, pts, holes: leaf.holes?.map((ring) => ring.map(map)) } : { ...leaf, pts };
}

/** mapLeaf through groups (a group's nominal box becomes the box of its mapped corners). */
export function mapDrawable(d: Drawable, map: (p: Pt) => Pt, scale: number, shapes?: Record<string, Pt[]>): Drawable {
  if (d.kind !== "group") return mapLeaf(d, map, scale, shapes);
  const children = d.children.map((c) => mapDrawable(c, map, scale, shapes));
  if (!d.box) return { ...d, children };
  const b = d.box;
  const cs = ([[b.x, b.y], [b.x + b.w, b.y], [b.x + b.w, b.y + b.h], [b.x, b.y + b.h]] as Pt[]).map(map);
  const xs = cs.map((p) => p[0]);
  const ys = cs.map((p) => p[1]);
  return { ...d, children, box: { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) } };
}

export function isEmptyOverrides(ov?: LayoutOverrides): boolean {
  return !ov || (Object.keys(ov.poses ?? {}).length === 0 && Object.keys(ov.shapes ?? {}).length === 0);
}

/** A stable key for caches and the player's "what is mounted" comparison; "" when nothing is overridden. */
export function overridesKey(ov?: LayoutOverrides): string {
  if (isEmptyOverrides(ov)) return "";
  const poses = Object.entries(ov!.poses ?? {}).sort(([a], [b]) => (a < b ? -1 : 1));
  const shapes = Object.entries(ov!.shapes ?? {}).sort(([a], [b]) => (a < b ? -1 : 1));
  return JSON.stringify([poses, shapes]);
}
```

`src/render/minted.ts`: import `mapLeaf` from `../layout/posed`; in `ghostDrawables` replace the per-kind branches with
```ts
for (const leaf of leafDrawables(drawablesForId(sourceLayout.drawables, g.sourceId))) {
  const id = ghostLeafId(leaf.id, g.sourceId, g.id);
  const style = { ...leaf.style, opacity: leaf.style.opacity * g.opacity };
  const drawOpts = resolveDrawOpts({ mode: "instant" });
  out.push({ ...mapLeaf(leaf, map, s, g.shapes), id, style, drawOpts });
}
```
(`tests/ghost*.test.ts` must stay green — same mapping.)

- [ ] **Step 4: `layoutSpec` and tier2 overrides**

`src/layout/layout.ts`:
- Signature `export function layoutSpec(rawSpec: Spec, measure: MeasureFn = heuristicMeasure, overrides?: LayoutOverrides): LayoutResult` (import the type from `./posed`).
- Pass `overrides` into `layoutElements(...)` opts: `{ measure, seedDrawables: [...drawables], vars: spec.vars, overrides }`.

`src/layout/tier2.ts`:
- Imports: `import { mapDrawable, poseMapOf, type LayoutOverrides } from "./posed";`
- `Ctx` gains: `ix: (v: number) => number; iy: (v: number) => number;` (inverse scales: `linearScale([plot.x0, plot.x1], domainX)`, same for y), `posedAnchors: Record<string, Pt>; posedNamed: Record<string, Record<string, Pt>>;` and `overrides: LayoutOverrides`.
- The lookup view: replace `ctx.drawablesSoFar = drawables;` with
  ```ts
  // The posed lookup view (posed.ts): what DEFINITIONAL readers — arrow
  // endpoints, angle arms, a measure's ring, a line's points — see. Placement
  // (`at`, labels) reads `drawables`/`seedDrawables` and the raw anchors.
  const view: Drawable[] = [];
  ctx.drawablesSoFar = view;
  const overriddenIds = new Set([...Object.keys(ctx.overrides.poses ?? {}), ...Object.keys(ctx.overrides.shapes ?? {})]);
  /** Register an id's posed geometry: its anchors, its curve samples, and its leaves in `view` from `from` on. */
  const applyOverride = (id: string, from: number) => {
    if (!overriddenIds.has(id)) return;
    const pose = ctx.overrides.poses?.[id];
    const shp = ctx.overrides.shapes?.[id];
    const { map, scale } = pose ? poseMapOf(pose) : { map: (p: Pt) => p, scale: 1 };
    for (let i = from; i < view.length; i++) {
      const d = view[i];
      if (d.id === id || SUB_SUFFIXES.some((s) => d.id === `${id}_${s}`)) view[i] = mapDrawable(d, map, scale, shp);
    }
    const a = ctx.anchors[id];
    if (a) ctx.posedAnchors[id] = map(a);
    const named = ctx.namedAnchors[id];
    if (named) ctx.posedNamed[id] = Object.fromEntries(Object.entries(named).map(([k, p]) => [k, map(p)]));
    const cs = ctx.curveSamples.get(id);
    if (cs) {
      const logical = shp?.[id] ?? cs.map((p): Pt => [ctx.sx(p[0]), ctx.sy(p[1])]);
      ctx.curveSamples.set(id, logical.map(map).map((p): Pt => [ctx.ix(p[0]), ctx.iy(p[1])]));
    }
  };
  // Template ink and anchors first, so a moved template id reads posed too.
  view.push(...(opts.seedDrawables ?? []));
  for (const id of overriddenIds) applyOverride(id, 0);
  ```
  (`SUB_SUFFIXES` is exported from `./model` — add it to the import.) Place this block right after Pass 2 (curve sampling) and before Pass 3, so seeded curve samples are already in `ctx.curveSamples`.
- At the END of the Pass 3 loop body (after the relative-placement block, still inside `for (const raw of emitOrder)`):
  ```ts
  const viewStart = view.length;
  view.push(...drawables.slice(start));
  applyOverride(el.id, viewStart);
  for (const kid of ctx.pieceGroups[el.id] ?? []) applyOverride(kid, viewStart);
  ```
- `resolveEnd` (line ~863 and the named-anchor line): read `const a = ctx.posedAnchors[end.ref] ?? ctx.anchors[end.ref];` and `const named = (ctx.posedNamed[end.ref] ?? ctx.namedAnchors[end.ref])?.[end.anchor];`. The universal-anchor branch already reads `ctx.drawablesSoFar` (now the view).
- `primaryRingSoFar` (line ~1625) already reads `ctx.drawablesSoFar` — measures follow in a relayout.
- Group case: after the fit block, compute the anchors from the view when a member is overridden:
  ```ts
  if (box) {
    ctx.groupBoxes[el.id] = box;
    ctx.anchors[el.id] = [box.x + box.w / 2, box.y + box.h / 2];
    ctx.namedAnchors[el.id] = Object.fromEntries(UNIVERSAL_ANCHORS.map((n) => [n, boxAnchor(box, n)]));
    if (leaves.some((m) => overriddenIds.has(m))) {
      const vbox = boxOfId(view, el.id, measure, ctx.groups, ctx.pieceGroups);
      if (vbox) {
        ctx.posedAnchors[el.id] = [vbox.x + vbox.w / 2, vbox.y + vbox.h / 2];
        ctx.posedNamed[el.id] = Object.fromEntries(UNIVERSAL_ANCHORS.map((n) => [n, boxAnchor(vbox, n)]));
      }
    }
  }
  ```
- `label` case and `refBBox`/relative placement keep reading `ctx.anchors` (raw) — no change.

- [ ] **Step 5: Run** — `npx vitest run tests/dependencies-layout.test.ts tests/ghost.test.ts tests/anchors.test.ts tests/angle.test.ts tests/measure.test.ts` then the full suite — PASS. `npx tsc --noEmit` clean.

- [ ] **Step 6: Commit**

```bash
git add src/layout/posed.ts src/layout/tier2.ts src/layout/layout.ts src/render/minted.ts tests/dependencies-layout.test.ts
git commit -m "Layout overrides: definitional references read posed geometry while an element's own ink stays put (manim round 1, Task 5)"
```

---

### Task 6: Planner — `animate` on vars, `relayout` steps, `sources`, `trail` on `animate`

**Files:**
- Modify: `src/render/params.ts` (add `splitVarOverrides`)
- Modify: `src/render/trails.ts` (add `cutTrail`)
- Modify: `src/render/plan.ts` (PlanOptions ~233-266; Plan ~221-232; step kinds ~83-100; animate branch ~1369-1427; move/transform/morph push sites ~1006, ~1077, ~1362)
- Test: `tests/animate-vars.test.ts`, `tests/relayout-plan.test.ts`

**Interfaces:**
- Consumes: `LayoutOverrides`, `PoseOverride`, `isIdentity` (`render/pose.ts`), `readParam`.
- Produces:
  ```ts
  // params.ts
  export function splitVarOverrides(params: Record<string, unknown>): { params: Record<string, unknown>; vars: Record<string, number> };
  // trails.ts
  export function cutTrail(pts: Pt[], fraction: number): Pt[];   // the leading part of a polyline by arc length; fraction ≥ 1 → pts
  // plan.ts
  PlanOptions: varsBase?: Record<string, number> | null;
               dependentsOf?: (id: string) => string[];
               sourceIds?: string[];
               bboxesFor?: (params: Record<string, number>, overrides?: LayoutOverrides) => (id: string) => BBox | null;
               anchorsAt?: (params: Record<string, number>, overrides?: LayoutOverrides) => (id: string, name: string) => Pt | null;
  Plan: sources: string[];
  PlanStep: move/transform/morph gain `relayout?: true`; animate gains `trails?: TrailProgress[]`.
  ```

- [ ] **Step 1: Write the failing tests**

```ts
// tests/animate-vars.test.ts
import { describe, expect, test } from "vitest";
import { planCommands, type PlanStep } from "../src/render/plan";
import { splitVarOverrides } from "../src/render/params";
import { cutTrail } from "../src/render/trails";

const animateStep = (plan: ReturnType<typeof planCommands>, i: number) => plan.steps[i] as Extract<PlanStep, { kind: "animate" }>;

describe("animate on vars", () => {
  test("a bare name that is a var animates it, keyed vars.<name>, starting at the var's value", () => {
    const plan = planCommands([{ animate: { f: 4 }, duration: 3 }], [], { varsBase: { f: 1 }, animateBase: null });
    expect(plan.warnings).toEqual([]);
    const s = animateStep(plan, 0);
    expect(s.targets).toEqual({ "vars.f": 4 });
    expect(s.starts).toEqual({ "vars.f": 1 });
    expect(plan.states[0].params).toEqual({ "vars.f": 4 });
  });
  test("a second animate starts where the first ended; vars.f is accepted as written", () => {
    const plan = planCommands([{ animate: { f: 4 } }, { animate: { "vars.f": 0 } }], [], { varsBase: { f: 1 }, animateBase: null });
    expect(animateStep(plan, 1).starts).toEqual({ "vars.f": 4 });
  });
  test("params first: a name that is both animates the param and warns; an unknown name is skipped with a warning", () => {
    const plan = planCommands([{ animate: { n: 3 } }, { animate: { zz: 1 } }], [], { varsBase: { n: 1, f: 0 }, animateBase: { n: 12 } });
    expect(animateStep(plan, 0).targets).toEqual({ n: 3 });
    expect(plan.warnings).toContain('animate "n" is both a template param and a var — the param is animated');
    expect(plan.warnings.some((w) => w.includes('animate "zz": neither a template param nor a var'))).toBe(true);
  });
  test("no template and no vars: the old warning, and a paired speak survives", () => {
    const plan = planCommands([{ animate: { f: 1 }, speak: "still said" }], [], { animateBase: null });
    expect(plan.warnings).toContain("animate needs a template param or a var (skipped)");
    expect(plan.steps.map((s) => s.kind)).toEqual(["speak"]);
  });
  test("splitVarOverrides moves vars.* keys into vars", () => {
    expect(splitVarOverrides({ "demand_shift.amount": 3, "vars.f": 2 })).toEqual({ params: { "demand_shift.amount": 3 }, vars: { f: 2 } });
  });
  test("cutTrail keeps the leading part by arc length", () => {
    expect(cutTrail([[0, 0], [10, 0], [10, 10]], 0.5)).toEqual([[0, 0], [10, 0]]);
    expect(cutTrail([[0, 0], [10, 0], [10, 10]], 0.75)).toEqual([[0, 0], [10, 0], [10, 5]]);
    expect(cutTrail([[0, 0], [10, 0]], 1)).toEqual([[0, 0], [10, 0]]);
    expect(cutTrail([[0, 0], [10, 0]], 0)).toEqual([[0, 0], [0, 0]]);
  });
  test("trail on animate: a point bound to a circle traces 61 samples on the circle and the step carries the progress table", () => {
    const anchorsAt = (params: Record<string, number>) => (id: string, name: string) => (id === "p" && name === "center" ? ([500 + 100 * Math.cos(params["vars.t"] ?? 0), 375 + 100 * Math.sin(params["vars.t"] ?? 0)] as [number, number]) : null);
    const plan = planCommands([{ draw: ["p"] }, { animate: { t: Math.PI }, trail: { of: "p" }, duration: 2 }], ["p"], { varsBase: { t: 0 }, animateBase: null, anchorsAt, bboxOf: () => ({ x: 490, y: 365, w: 20, h: 20 }) });
    expect(plan.warnings).toEqual([]);
    const tr = plan.minted.find((m) => m.kind === "trail") as { id: string; pts: [number, number][] };
    expect(tr.id).toBe("p_trail");
    expect(tr.pts).toHaveLength(61);
    expect(tr.pts[0]).toEqual([600, 375]);
    expect(tr.pts[60][0]).toBeCloseTo(400, 6);
    for (const p of tr.pts) expect(Math.hypot(p[0] - 500, p[1] - 375)).toBeCloseTo(100, 6);
    expect(animateStep(plan, 1).trails?.[0].id).toBe("p_trail");
    expect(plan.states[1].visible).toContain("p_trail");
  });
  test("trail without of, or naming an unknown id, warns and mints nothing", () => {
    const plan = planCommands([{ animate: { t: 1 }, trail: { of: "ghost" } }], [], { varsBase: { t: 0 }, animateBase: null, anchorsAt: () => () => null });
    expect(plan.minted).toEqual([]);
    expect(plan.warnings.some((w) => w.includes('animate.trail.of "ghost"'))).toBe(true);
  });
});
```

```ts
// tests/relayout-plan.test.ts
import { describe, expect, test } from "vitest";
import { planCommands, type PlanStep } from "../src/render/plan";

const box = (x: number, y: number, w: number, h: number) => ({ x, y, w, h });
const boxes: Record<string, ReturnType<typeof box>> = { d: box(100, 100, 300, 200), eq: box(240, 190, 20, 20), n: box(600, 600, 40, 40) };
const dependentsOf = (id: string) => (id === "d" ? ["eq", "a"] : []);

describe("relayout steps", () => {
  test("a move whose target has dependents is marked relayout and switches the bbox source with the poses", () => {
    const calls: unknown[] = [];
    const plan = planCommands(
      [{ draw: ["d", "eq", "n"] }, { move: { target: "d", by: [50, 0] } }, { point: { at: { ref: "eq" } } }],
      ["d", "eq", "a", "n"],
      {
        bboxOf: (id) => boxes[id] ?? null,
        dependentsOf,
        sourceIds: ["d"],
        bboxesFor: (params, overrides) => {
          calls.push({ params, overrides });
          return (id) => (id === "eq" ? box(290, 220, 20, 20) : boxes[id] ?? null);
        },
      },
    );
    const mv = plan.steps[1] as Extract<PlanStep, { kind: "move" }>;
    expect(mv.relayout).toBe(true);
    expect(calls).toEqual([{ params: {}, overrides: { poses: { d: { offset: [50, 0], turn: undefined } }, shapes: {} } }]);
    const pt = plan.steps[2] as Extract<PlanStep, { kind: "point" }>;
    expect(pt.x).toBeCloseTo(300, 6); // the post-move intersection box
    expect(plan.sources).toEqual(["d"]);
  });
  test("a move of an element nothing depends on is a plain move and calls bboxesFor never", () => {
    let calls = 0;
    const plan = planCommands([{ draw: ["n"] }, { move: { target: "n", by: [5, 5] } }], ["n"], { bboxOf: (id) => boxes[id] ?? null, dependentsOf, sourceIds: ["d"], bboxesFor: () => { calls++; return () => null; } });
    expect((plan.steps[1] as Extract<PlanStep, { kind: "move" }>).relayout).toBeUndefined();
    expect(calls).toBe(0);
  });
  test("a rotate (transform) and a morph of a source are relayout steps; the overrides carry only source ids", () => {
    const seen: unknown[] = [];
    const plan = planCommands(
      [{ draw: ["d", "n"] }, { move: { target: ["d", "n"], rotate: 30 } }, { morph: { target: "d", stretch: [2, 1] } }],
      ["d", "n"],
      {
        bboxOf: (id) => boxes[id] ?? null,
        dependentsOf,
        sourceIds: ["d"],
        leafPointsOf: (id) => (id === "d" ? [{ leafId: "d", pts: [[100, 100], [400, 300]], closed: false }] : null),
        bboxesFor: (_p, overrides) => { seen.push(overrides); return (id) => boxes[id] ?? null; },
      },
    );
    expect((plan.steps[1] as Extract<PlanStep, { kind: "transform" }>).relayout).toBe(true);
    expect((plan.steps[2] as Extract<PlanStep, { kind: "morph" }>).relayout).toBe(true);
    expect(Object.keys((seen[0] as { poses: object }).poses)).toEqual(["d"]);
    expect(Object.keys((seen[1] as { shapes: object }).shapes)).toEqual(["d"]);
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run tests/animate-vars.test.ts tests/relayout-plan.test.ts` — FAIL.

- [ ] **Step 3: `params.ts` and `trails.ts`**

```ts
// params.ts — append
/** animate keeps a var's value under `vars.<name>` (design §2.4); layout wants it in spec.vars. */
export function splitVarOverrides(params: Record<string, unknown>): { params: Record<string, unknown>; vars: Record<string, number> } {
  const rest: Record<string, unknown> = {};
  const vars: Record<string, number> = {};
  for (const [k, v] of Object.entries(params)) {
    if (k.startsWith("vars.") && typeof v === "number") vars[k.slice(5)] = v;
    else rest[k] = v;
  }
  return { params: rest, vars };
}
```

```ts
// trails.ts — append
/** The leading `fraction` of a polyline by arc length (a trail mid-sweep). */
export function cutTrail(pts: Pt[], fraction: number): Pt[] {
  if (pts.length < 2 || fraction >= 1) return pts;
  const f = Math.max(0, fraction);
  const lens = cumulativeLengthFractions(pts);
  const out: Pt[] = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    if (lens[i] <= f) { out.push(pts[i]); continue; }
    const a = pts[i - 1], b = pts[i];
    const span = lens[i] - lens[i - 1];
    const t = span > 0 ? (f - lens[i - 1]) / span : 0;
    out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    break;
  }
  if (out.length === 1) out.push(pts[0]);
  return out;
}
```
(`cumulativeLengthFractions` returns all zeros for a motionless trail — then every `lens[i] <= f` and the whole trail returns, which is right.)

- [ ] **Step 4: `plan.ts`**

1. Types: add `relayout?: true` to the `move`, `transform` and `morph` step variants; add `trails?: TrailProgress[]` to the `animate` variant; `Plan` gains `sources: string[]`; `PlanOptions` gains the five members listed under Interfaces (with doc comments in the file's style). Import `LayoutOverrides`, `PoseOverride` from `../layout/posed`.
2. In `planCommands`, after `const trailCount…`:
   ```ts
   const sourceSet = new Set(opts.sourceIds ?? []);
   /** The poses and shapes of the SOURCE ids as they stand — what a relayout layout reads (design §2.5). Restricted to sources so the planner's boundary layouts and the player's commits share one key. */
   const currentOverrides = (): LayoutOverrides => {
     const poses: Record<string, PoseOverride> = {};
     for (const id of sourceSet) {
       const o = offsets[id];
       const t = turns[id];
       if ((o && (o[0] !== 0 || o[1] !== 0)) || !isIdentity(t)) poses[id] = { offset: o ?? [0, 0], turn: t };
     }
     const shp: Record<string, Record<string, Pt[]>> = {};
     for (const id of sourceSet) if (shapes[id]) shp[id] = shapes[id];
     return { poses, shapes: shp };
   };
   /** The elements defined in terms of any of these ids (never the ids themselves). */
   const dependentsOf = (ids: string[]): string[] => [...new Set(ids.flatMap((id) => opts.dependentsOf?.(id) ?? []))].filter((d) => !ids.includes(d));
   /** After a step that changed a source: later steps aim at recomputed geometry. */
   const relayoutBoxes = () => { if (opts.bboxesFor) bboxOf = opts.bboxesFor(params, currentOverrides()); };
   ```
   (`isIdentity` from `./pose`.)
3. Move (translate-only) push site (`pushStep({ kind: "move", ids: moving, path, seconds, easing, trails: stepTrails, ...upd })`): before it `const relayout = dependentsOf(moving).length > 0;` and push `...(relayout ? { relayout: true as const } : {})`; after it `if (relayout) relayoutBoxes();`. Same for the transform push (`items.map((it) => it.id)` as the ids) and the morph push (`items.map((it) => it.id)`).
4. `animate` branch — replace the key loop and the template guard:
   ```ts
   const hasTemplate = opts.animateBase !== undefined && opts.animateBase !== null;
   const varsBase = opts.varsBase ?? null;
   const isVar = (bare: string) => varsBase !== null && Object.prototype.hasOwnProperty.call(varsBase, bare);
   /** Params first (a dot path a template knows — or, on a template spec, any path: an unknown one still jumps, as before); else a var by bare name or as vars.<name>; else null. */
   const resolveKey = (raw: string): string | null => {
     const explicitVar = raw.startsWith("vars.");
     const bare = explicitVar ? raw.slice(5) : raw;
     const param = hasTemplate && !explicitVar && readParam(opts.animateBase!, raw) !== null;
     if (param && isVar(bare)) warnings.push(`animate "${raw}" is both a template param and a var — the param is animated`);
     if (param) return raw;
     if (isVar(bare)) return `vars.${bare}`;
     if (hasTemplate && !explicitVar) return raw;
     return null;
   };
   if (!hasTemplate && varsBase === null) {
     warnings.push("animate needs a template param or a var (skipped)");
     if (cmd.speak !== undefined) pushStep({ kind: "speak", text: cmd.speak, blocking: true, speaker: cmd.voice, delivery: cmd.delivery });
     continue;
   }
   for (const [rawKey, v] of Object.entries(cmd.animate)) {
     const key = resolveKey(rawKey);
     if (key === null) { warnings.push(`animate "${rawKey}": neither a template param nor a var — skipped`); continue; }
     … the existing number / "{var}" handling, writing targets[key] / varTargets[key] …
   }
   ```
   Starts: `const start = params[key] ?? (key.startsWith("vars.") ? varsBase![key.slice(5)] : readParam(opts.animateBase ?? {}, key));`.
   After `params = { ...params, ...targets };` and before `pushStep`, the trail:
   ```ts
   let stepTrails: TrailProgress[] = [];
   const tr = cmd.trail;
   if (tr !== undefined) {
     if (!known.has(tr.of)) warnings.push(`animate.trail.of "${tr.of}" is not an element — no trail`);
     else if (!opts.anchorsAt) warnings.push("animate.trail: no layout to sample — no trail");
     else {
       const before = states.length > 0 ? states[states.length - 1].params : {};
       const pts: Pt[] = [];
       for (let k = 0; k <= 60; k++) {
         const u = k / 60;
         const at: Record<string, number> = { ...before };
         for (const key of Object.keys(targets)) { const s = starts[key]; at[key] = s === null ? targets[key] : s + (targets[key] - s) * u; }
         const raw = opts.anchorsAt(at, currentOverrides())(tr.of, tr.anchor ?? "center");
         if (raw) pts.push(poseOf(offsets[tr.of] ?? [0, 0], turns[tr.of])(raw));
       }
       if (pts.length < 2) warnings.push(`animate.trail.of "${tr.of}": the point does not resolve — no trail`);
       else {
         const n = (trailCount.get(tr.of) ?? 0) + 1;
         trailCount.set(tr.of, n);
         const trailId = n === 1 ? `${tr.of}_trail` : `${tr.of}_trail_${n}`;
         minted.push({ kind: "trail", id: trailId, pts, color: tr.color, width: tr.width ?? 2.5 });
         const b = ptsBox(pts);
         if (b) mintedBoxes.set(trailId, b);
         known.add(trailId); mentioned.add(trailId); makeVisible([trailId]);
         stepTrails = [{ id: trailId, lengthAt: cumulativeLengthFractions(pts) }];
       }
     }
   }
   ```
   Note: `before` must be read BEFORE `params = { ...params, ...targets }` — capture `const paramsBefore = { ...params }` above that line and use it. Push `...(stepTrails.length > 0 ? { trails: stepTrails } : {})` on the animate step. Replace the trailing `if (opts.bboxesFor) bboxOf = opts.bboxesFor(params);` with `relayoutBoxes();`.
5. `return { steps, states, labels, warnings, minted, sources: [...sourceSet] };`

- [ ] **Step 5: Run** — `npx vitest run tests/animate-vars.test.ts tests/relayout-plan.test.ts tests/animate.test.ts tests/plan.test.ts tests/trail.test.ts tests/ghost.test.ts` then the full suite. Fix any test asserting the old message `"animate requires a scene template (skipped)"` (grep `tests/` for it) to the new one. `npx tsc --noEmit` clean.

- [ ] **Step 6: Commit**

```bash
git add src/render/params.ts src/render/trails.ts src/render/plan.ts tests/animate-vars.test.ts tests/relayout-plan.test.ts
git commit -m "Planner: animate on vars, relayout steps for moved sources, trail on animate (manim round 1, Task 6)"
```

---

### Task 7: Reprojector, player and render — the layout key and the relayout tween

**Files:**
- Create: `src/render/tween.ts` (pure per-frame pose/shape interpolation, shared by both paths)
- Modify: `src/render/player.ts` (Reprojector ~27-48; fields ~224-260; `applyParams` ~470-478 → `applyKey`; `previewParams`/`previewSpec` ~486-514; `jumpTo` ~398-401; `settleParams` ~449; animate case ~1009-1051; move/transform/morph cases ~1052-1137)
- Modify: `src/render/index.ts` (`rawLayoutFor`/`layoutFor` ~252-268; `planCommands` opts ~270-279; reprojector ~297-311; `planOptionsFor` ~101-150)
- Modify: `src/render/minted.ts` (`withMinted(layout, minted, layoutAt, trailProgress?)`)
- Test: `tests/relayout-player.test.ts`; existing `tests/animate.test.ts` keeps passing (its stub `frame: (p) => …` / `commit: (p) => …` is signature-compatible)

**Interfaces:**
- Produces:
  ```ts
  // player.ts
  export interface FrameScene { visible: ReadonlySet<string>; offsets: Record<string, Pt>; turns: Record<string, Turn>; opacities: Record<string, number>; shapes: Record<string, Record<string, Pt[]>>; texts: Record<string, Record<string, string>> }
  export interface FrameOpts { revealNew?: boolean; elements?: SpecElement[]; overrides?: LayoutOverrides; trailProgress?: Record<string, number> }
  export interface Reprojector {
    frame(params: Record<string, unknown>, scene: FrameScene, opts?: FrameOpts): LayoutResult | void;
    commit(params: Record<string, number>, overrides?: LayoutOverrides): Map<string, RenderedElement>;
  }
  // tween.ts
  export function moveFrame(step: { ids: string[]; path: Pt[] }, before: SceneState, e: number): Record<string, Pt>;           // offsets for the moved ids
  export function transformFrame(items: TransformItem[], e: number): { offsets: Record<string, Pt>; turns: Record<string, Turn>; squash: Record<string, Squash> };
  export function morphFrame(items: MorphItem[], before: SceneState, e: number): Record<string, Record<string, Pt[]>>;
  // minted.ts
  export function withMinted(layout, minted, layoutAt, trailProgress?: Record<string, number>): LayoutResult;
  ```

- [ ] **Step 1: Write the failing tests**

```ts
// tests/relayout-player.test.ts
import { describe, expect, test } from "vitest";
import { Player, type Reprojector } from "../src/render/player";
import { planCommands } from "../src/render/plan";
import { SpeechManager } from "../src/render/speech";
import type { RenderedElement } from "../src/render/backend";
import { moveFrame, transformFrame, morphFrame } from "../src/render/tween";
import { INITIAL_STATE } from "../src/render/plan";

globalThis.requestAnimationFrame ??= ((cb: FrameRequestCallback) => setTimeout(() => cb(performance.now()), 5) as unknown as number) as typeof requestAnimationFrame;

class StubSpeech extends SpeechManager {
  override get available(): boolean { return false; }
  override speak(): Promise<void> { return Promise.resolve(); }
  override cancel(): void {}
}
function stub() {
  const frames: { params: Record<string, unknown>; overrides: unknown; offsets: Record<string, unknown> }[] = [];
  const commits: { params: Record<string, number>; overrides: unknown }[] = [];
  const rp: Reprojector = {
    frame: (params, scene, opts) => { frames.push({ params: { ...params }, overrides: opts?.overrides, offsets: { ...scene.offsets } }); },
    commit: (params, overrides) => { commits.push({ params: { ...params }, overrides }); return new Map<string, RenderedElement>(); },
  };
  return { rp, frames, commits };
}
const box = { x: 100, y: 100, w: 50, h: 50 };
const opts = { bboxOf: () => box, dependentsOf: (id: string) => (id === "d" ? ["eq"] : []), sourceIds: ["d"], bboxesFor: () => () => box };

describe("tween helpers", () => {
  test("moveFrame, transformFrame and morphFrame interpolate", () => {
    expect(moveFrame({ ids: ["d"], path: [[0, 0], [10, 20]] }, INITIAL_STATE, 0.5)).toEqual({ d: [5, 10] });
    const t = transformFrame([{ id: "d", from: { offset: [0, 0], turn: { deg: 0, pivot: [0, 0] } }, to: { offset: [10, 0], turn: { deg: 90, pivot: [0, 0] } } }], 0.5);
    expect(t.offsets.d).toEqual([5, 0]);
    expect(t.turns.d.deg).toBe(45);
    expect(morphFrame([{ id: "d", leaves: [{ leafId: "d", from: [[0, 0]], to: [[10, 10]] }] }], INITIAL_STATE, 0.5)).toEqual({ d: { d: [[5, 5]] } });
  });
});

describe("relayout steps in the player", () => {
  test("a move with dependents tweens through the reprojector with the pose in the overrides, then commits the boundary key once", async () => {
    const plan = planCommands([{ draw: ["d", "eq"] }, { move: { target: "d", by: [40, 0], duration: 0.1 } }], ["d", "eq"], opts);
    const { rp, frames, commits } = stub();
    const player = new Player(plan, new Map(), new StubSpeech(), null, { mode: "silent" });
    player.reprojector = rp;
    await player.play();
    expect(frames.length).toBeGreaterThanOrEqual(2);
    const xs = frames.map((f) => (f.overrides as { poses: { d: { offset: [number, number] } } }).poses.d.offset[0]);
    expect(Math.max(...xs)).toBeCloseTo(40, 5);
    expect(frames.every((f) => (f.offsets.d as [number, number])[0] === xs[frames.indexOf(f)])).toBe(true);
    expect(commits).toHaveLength(1);
    expect((commits[0].overrides as { poses: { d: { offset: [number, number] } } }).poses.d.offset).toEqual([40, 0]);
  });
  test("a plain move never calls the reprojector", async () => {
    const plan = planCommands([{ draw: ["n"] }, { move: { target: "n", by: [40, 0], duration: 0.05 } }], ["n"], opts);
    const { rp, frames, commits } = stub();
    const player = new Player(plan, new Map(), new StubSpeech(), null, { mode: "silent" });
    player.reprojector = rp;
    await player.play();
    expect(frames).toEqual([]);
    expect(commits).toEqual([]);
  });
  test("scrubbing across a relayout boundary commits exactly when the key changes", () => {
    const plan = planCommands([{ draw: ["d", "eq"] }, { move: { target: "d", by: [40, 0] } }, { draw: ["n"] }, { move: { target: "n", by: [1, 1] } }], ["d", "eq", "n"], opts);
    const { rp, commits } = stub();
    const player = new Player(plan, new Map(), new StubSpeech(), null, { mode: "silent" });
    player.reprojector = rp;
    player.renderUpTo(1);
    expect(commits).toHaveLength(0);
    player.renderUpTo(2);
    expect(commits).toHaveLength(1);
    player.renderUpTo(4); // n moved: not a source → same key
    expect(commits).toHaveLength(1);
    player.renderUpTo(0);
    expect(commits).toHaveLength(2);
    expect(commits[1].overrides).toBeUndefined();
  });
  test("an animate with a trail hands the trail's progress to every frame", async () => {
    const anchorsAt = () => (id: string) => (id === "p" ? ([500, 375] as [number, number]) : null);
    const plan = planCommands([{ draw: ["p"] }, { animate: { t: 1 }, trail: { of: "p" }, duration: 0.05 }], ["p"], { varsBase: { t: 0 }, animateBase: null, anchorsAt, bboxOf: () => box });
    const progress: number[] = [];
    const rp: Reprojector = { frame: (_p, _s, o) => { progress.push(o?.trailProgress?.p_trail ?? -1); }, commit: () => new Map() };
    const player = new Player(plan, new Map(), new StubSpeech(), null, { mode: "silent" });
    player.reprojector = rp;
    await player.play();
    expect(progress.every((p) => p >= 0 && p <= 1)).toBe(true);
    expect(progress[progress.length - 1]).toBe(1);
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run tests/relayout-player.test.ts` — FAIL.

- [ ] **Step 3: `src/render/tween.ts`**

```ts
// Per-frame interpolation of a step's poses and shapes (design 2026-09-10
// §2.5): the same arithmetic the handle path always used, pulled out so the
// relayout path can feed the reprojector the very same numbers.
import type { Squash } from "./backend";
import { pathPosition } from "./effects";
import type { Pt } from "../layout/model";
import type { MorphItem, SceneState, TransformItem } from "./plan";
import type { Turn } from "./pose";

export function moveFrame(step: { ids: string[]; path: Pt[] }, before: SceneState, e: number): Record<string, Pt> {
  const [px, py] = pathPosition(step.path, e);
  const out: Record<string, Pt> = {};
  for (const id of step.ids) {
    const [bx, by] = before.offsets[id] ?? [0, 0];
    out[id] = [bx + px, by + py];
  }
  return out;
}

export function transformFrame(items: TransformItem[], e: number): { offsets: Record<string, Pt>; turns: Record<string, Turn>; squash: Record<string, Squash> } {
  const offsets: Record<string, Pt> = {};
  const turns: Record<string, Turn> = {};
  const squash: Record<string, Squash> = {};
  for (const it of items) {
    if (it.flip) {
      const half = e < 0.5;
      const pose = half ? it.from : it.to;
      offsets[it.id] = pose.offset;
      turns[it.id] = pose.turn;
      if (e < 1) squash[it.id] = { at: it.flip.at, angle: it.flip.angle, k: half ? 1 - 2 * e : 2 * e - 1 };
      continue;
    }
    offsets[it.id] = [it.from.offset[0] + (it.to.offset[0] - it.from.offset[0]) * e, it.from.offset[1] + (it.to.offset[1] - it.from.offset[1]) * e];
    turns[it.id] = {
      deg: it.from.turn.deg + (it.to.turn.deg - it.from.turn.deg) * e,
      pivot: it.to.turn.pivot,
      scale: (it.from.turn.scale ?? 1) + ((it.to.turn.scale ?? 1) - (it.from.turn.scale ?? 1)) * e,
      mirror: it.to.turn.mirror ?? false,
    };
  }
  return { offsets, turns, squash };
}

export function morphFrame(items: MorphItem[], before: SceneState, e: number): Record<string, Record<string, Pt[]>> {
  const out: Record<string, Record<string, Pt[]>> = {};
  for (const it of items) {
    const pts: Record<string, Pt[]> = { ...(before.shapes[it.id] ?? {}) };
    for (const leaf of it.leaves) pts[leaf.leafId] = leaf.from.map((p, i): Pt => [p[0] + (leaf.to[i][0] - p[0]) * e, p[1] + (leaf.to[i][1] - p[1]) * e]);
    out[it.id] = pts;
  }
  return out;
}
```

- [ ] **Step 4: `minted.ts`** — `withMinted(layout, minted, layoutAt, trailProgress: Record<string, number> = {})`; in the trail branch `drawables.push(trailDrawable(layout, trailProgress[m.id] === undefined ? m : { ...m, pts: cutTrail(m.pts, trailProgress[m.id]) }));` (import `cutTrail` from `./trails`).

- [ ] **Step 5: `player.ts`**

1. Types: `FrameScene`, `FrameOpts`, the new `Reprojector` (imports: `LayoutOverrides`, `overridesKey` from `../layout/posed`; `moveFrame`, `transformFrame`, `morphFrame` from `./tween`).
2. Fields: replace `private appliedParams: Record<string, number> = {};` with `private appliedKey = Player.keyOf({}, undefined);` and add `private readonly sources: ReadonlySet<string>;` set in the constructor from `plan.sources ?? []`.
3. Helpers:
   ```ts
   private static keyOf(params: Record<string, number>, ov: LayoutOverrides | undefined): string {
     return JSON.stringify([Object.entries(params).sort(([a], [b]) => (a < b ? -1 : 1)), overridesKey(ov)]);
   }
   /** The poses and shapes of the source ids at a scene — the part of the scene a layout reads (design §2.5); undefined when none is posed. */
   private overridesOf(offsets: Record<string, Pt>, turns: Record<string, Turn>, shapes: Record<string, Record<string, Pt[]>>): LayoutOverrides | undefined {
     const poses: Record<string, { offset: Pt; turn?: Turn }> = {};
     const shp: Record<string, Record<string, Pt[]>> = {};
     for (const id of this.sources) {
       const o = offsets[id];
       const t = turns[id];
       if ((o && (o[0] !== 0 || o[1] !== 0)) || (t && !isIdentity(t))) poses[id] = { offset: o ?? [0, 0], turn: t };
       if (shapes[id]) shp[id] = shapes[id];
     }
     return Object.keys(poses).length === 0 && Object.keys(shp).length === 0 ? undefined : { poses, shapes: shp };
   }
   ```
   (`isIdentity` from `./pose`.)
4. `applyParams(params)` → `applyKey(scene: SceneState)`:
   ```ts
   private applyKey(scene: SceneState): void {
     if (!this.reprojector) return;
     this.painted = null;
     const merged = this.withVarOverrides(scene.params);
     const ov = this.overridesOf(scene.offsets, scene.turns, scene.shapes);
     const key = Player.keyOf(merged, ov);
     if (!this.geometryDirty && key === this.appliedKey) return;
     this.elements = this.reprojector.commit(merged, ov);
     this.appliedKey = key;
     this.geometryDirty = false;
   }
   ```
   Call sites: `this.applyParams(this.stateAt(this.completed).params)` → `this.applyKey(this.stateAt(this.completed))` (lines ~323, ~449); `jumpTo`: `this.applyKey(scene)`; animate settle: `this.applyKey(this.plan.states[index])`. Delete `sameParams`.
5. `previewParams` / `previewSpec`: call `this.reprojector.frame({ ...this.withVarOverrides(scene.params), ...overrides }, { visible: new Set(scene.visible), offsets: scene.offsets, turns: scene.turns, opacities: scene.opacities, shapes: scene.shapes, texts: scene.texts }, { revealNew: opts.revealNew, overrides: this.overridesOf(scene.offsets, scene.turns, scene.shapes) })` (previewSpec adds `elements: patch.elements, revealNew: true` and its `visible` minus `patch.hide`).
6. Animate case: build `trailProgress` per tick — `const trailProgress = Object.fromEntries((step.trails ?? []).map((tr) => [tr.id, lengthFractionAt(tr.lengthAt, e)]));` — and call `rp.frame(cur, { visible, offsets: before.offsets, turns: before.turns, opacities: before.opacities, shapes: before.shapes, texts: before.texts }, { revealNew: true, overrides: this.overridesOf(before.offsets, before.turns, before.shapes), trailProgress })`. `visible` = `new Set([...before.visible, ...(step.trails ?? []).map((t) => t.id)])`.
7. The relayout tween:
   ```ts
   /** A step whose targets something is defined by (design §2.5): every frame is a re-layout at the interpolated poses, handed to the reprojector; the handles are bypassed and the boundary is committed at the end. */
   private async relayoutTween(
     index: number,
     step: { seconds: number; easing: Easing; trails?: TrailProgress[] } & MeasureFollow,
     before: SceneState,
     signal: AbortSignal,
     frameAt: (e: number) => { offsets?: Record<string, Pt>; turns?: Record<string, Turn>; shapes?: Record<string, Record<string, Pt[]>> },
   ): Promise<void> {
     const rp = this.reprojector!;
     const ease = EASINGS[step.easing];
     // This step's own measure extras are recomputed by the layout each frame; their stale
     // boundary overrides would pin them to the old geometry mid-tween.
     const skipShapes = new Set((step.extraMorphs ?? []).map((m) => m.id));
     const skipTexts = new Set((step.texts ?? []).map((t) => t.id));
     const visible = new Set([...before.visible, ...(step.trails ?? []).map((t) => t.id)]);
     await this.progress(step.seconds * 1000, signal, (t) => {
       const e = ease(t);
       const f = frameAt(e);
       const offsets = { ...before.offsets, ...(f.offsets ?? {}) };
       const turns = { ...before.turns, ...(f.turns ?? {}) };
       const shapes: Record<string, Record<string, Pt[]>> = { ...before.shapes, ...(f.shapes ?? {}) };
       for (const id of skipShapes) if (!(f.shapes && id in f.shapes)) delete shapes[id];
       const texts = { ...before.texts };
       for (const id of skipTexts) delete texts[id];
       const trailProgress = Object.fromEntries((step.trails ?? []).map((tr) => [tr.id, lengthFractionAt(tr.lengthAt, e)]));
       rp.frame(before.params, { visible, offsets, turns, opacities: before.opacities, shapes, texts }, { overrides: this.overridesOf(offsets, turns, shapes), trailProgress });
       this.geometryDirty = true;
     });
     if (signal.aborted) return;
     const after = this.plan.states[index];
     this.applyKey(after);
     this.applyScene(after);
   }
   ```
   (`Easing`, `TrailProgress` imported as types from `./plan`/`../spec/types` as the file already does for `MeasureFollow`.)
8. In `case "move"`: first line `if (step.relayout && this.reprojector) return this.relayoutTween(index, step, before, signal, (e) => ({ offsets: moveFrame(step, before, e) }));`. Then the existing handle path, with the per-frame offsets taken from `moveFrame(step, before, e)` instead of the inline arithmetic (behaviour identical). `case "transform"`: `if (step.relayout && this.reprojector) return this.relayoutTween(index, step, before, signal, (e) => { const f = transformFrame(step.items, e); return { offsets: f.offsets, turns: f.turns }; });` — the handle path applies `transformFrame`'s `offsets`/`turns`/`squash` through `setTransform` exactly as the inline code did. `case "morph"`: `if (step.relayout && this.reprojector) return this.relayoutTween(index, step, before, signal, (e) => ({ shapes: morphFrame(step.items, before, e) }));`, handle path via `morphFrame`.

- [ ] **Step 6: `render/index.ts`**

1. `rawLayoutFor(params, cache, elements?, overrides?)`: key `cache && !elements ? JSON.stringify([Object.entries(params).sort(), overridesKey(overrides)]) : undefined`; the early return `if (Object.keys(params).length === 0 && !elements && isEmptyOverrides(overrides)) return layout;`; the layout call:
   ```ts
   const split = splitVarOverrides(params);
   const l = applyTextStyle(
     layoutSpec({ ...spec, params: withOverrides(spec.params, split.params), vars: { ...(spec.vars ?? {}), ...split.vars }, ...(elements ? { elements } : {}) }, measure, overrides),
     textStyle,
   );
   ```
   `layoutFor(params, cache, elements?, overrides?, trailProgress?)` = `withMinted(rawLayoutFor(params, cache, elements, overrides), minted, (p) => rawLayoutFor(p, true), trailProgress)`.
2. `planCommands` opts: `animateBase: spec.template ? spec.params ?? {} : null, varsBase: spec.vars ?? null, bboxesFor: (params, overrides) => { const b = elementBBoxes(layoutFor(params, true, undefined, overrides), measure); return (id) => b.get(id) ?? null; }, anchorsAt: (params, overrides) => { const l = layoutFor(params, false, undefined, overrides); const b = elementBBoxes(l, measure); return (id, name) => l.namedAnchors[id]?.[name] ?? (b.get(id) ? boxAnchor(b.get(id)!, name) : null); }` (`boxAnchor` from `../layout/anchors`).
3. `planOptionsFor`: add `dependentsOf: (id) => deps.get(id) ?? []` with `const deps = dependentsMap(spec.elements ?? [])`, and `sourceIds: sourceIds(spec.elements ?? [])` (from `../spec/deps`); extend its return type's `Pick<…>` accordingly.
4. Reprojector:
   ```ts
   player.reprojector = {
     frame: (params, scene, o = {}) => {
       const l = layoutFor(params, false, o.elements, o.overrides, o.trailProgress);
       const vis = o.revealNew ? withNewIdsVisible(new Set(layout.order), l.order, scene.visible) : scene.visible;
       mounted.swapGeometry!(l, vis, scene.offsets, scene.turns, scene.opacities, scene.shapes, scene.texts);
       return l;
     },
     commit: (params, overrides) => mounted.remount!(layoutFor(params, true, undefined, overrides)),
   };
   ```

- [ ] **Step 7: Run** — `npx vitest run tests/relayout-player.test.ts tests/animate.test.ts tests/animate-easing.test.ts tests/ask-player.test.ts tests/trail.test.ts tests/ghost.test.ts tests/measure-follow.test.ts` (whichever exist), then the full suite; `npx tsc --noEmit`; `npm run build` once (the engine build too: `npm run build:engine`). PASS.

- [ ] **Step 8: Commit**

```bash
git add src/render/tween.ts src/render/player.ts src/render/index.ts src/render/minted.ts tests/relayout-player.test.ts
git commit -m "Player: the layout key, relayout tweens through the reprojector, trails under animate (manim round 1, Task 7)"
```

---

### Task 8: Prompt, schema wording, four bundled examples, gates

**Files:**
- Modify: `src/llm/prompts/compiler-v1.md` (tier-2 bullet line 14; `animate` bullet line 54; `move` bullet line 72)
- Modify: `src/examples.json` (append four examples)
- Modify: `tests/examples.test.ts` (post-move geometry check for relayout examples — see step 3)
- Test: `tests/vars-prompt.test.ts`

- [ ] **Step 1: Write the failing prompt test**

```ts
// tests/vars-prompt.test.ts
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import examples from "../src/examples.json";

const prompt = readFileSync("src/llm/prompts/compiler-v1.md", "utf8");

describe("the prompt teaches vars and holding definitions", () => {
  test("vars, bind, at.on and trail are named once each, briefly", () => {
    expect(prompt).toMatch(/`vars`/);
    expect(prompt).toMatch(/`bind`/);
    expect(prompt).toMatch(/"on"|`on`/);
    expect(prompt).toMatch(/"trail"/);
  });
  test("the definitions rule replaces the old redraw advice", () => {
    expect(prompt).toContain("DEFINITIONS");
    expect(prompt).not.toContain("intersection points, guide lines and regions do NOT");
    expect(prompt).not.toContain("do not move the original");
  });
  test("four bundled examples: a var sweep, a tangent, a shifted demand curve, a turning arm", () => {
    type Ex = { request: string; spec?: { vars?: Record<string, number>; elements?: { type: string; at?: { on?: string }; bind?: unknown }[]; commands?: Record<string, unknown>[] } };
    const ex = examples as Ex[];
    const withVars = ex.filter((e) => e.spec?.vars);
    expect(withVars.length).toBeGreaterThanOrEqual(2);
    expect(withVars.some((e) => e.spec!.elements!.some((x) => x.type === "point" && x.at?.on && x.bind))).toBe(true);
    expect(ex.some((e) => e.request.toLowerCase().includes("demand") && e.spec?.commands?.some((c) => c.move))).toBe(true);
    expect(ex.some((e) => e.spec?.elements?.some((x) => x.type === "angle") && e.spec?.commands?.some((c) => c.move))).toBe(true);
    for (const e of withVars) expect(e.request).toMatch(/\?/);
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run tests/vars-prompt.test.ts` — FAIL.

- [ ] **Step 3: Prompt edits** (`src/llm/prompts/compiler-v1.md`)

- Line 14 (tier-2 bullet), after the `line` sentence and before "Give filled primitives…", insert:
  `A number the figure should SWEEP is a top-level var — \`"vars": {"f": 1}\` — read by a curve's \`expr\` (\`"sin(f*x)"\`), by \`bind\` on any element (\`"bind": {"end": "30 + 60*f", "at.x": "t"}\` computes a numeric field, or a dot path to one, from the vars; the written value is the start), and by drawn text as \`{f}\` (\`"text": "f = {f}"\`, \`{f:2}\` for two decimals). A point ON a curve is \`at: {"x": 3, "on": "wave"}\` — y is read off the curve.`
- Line 54 (`animate`), after "only numeric params animate, and only on template specs" replace that clause with: `only numeric params animate — or a var, on any spec: \`{"animate": {"f": 4}, "duration": 6, "easing": "linear"}\` sweeps \`f\` and every expr, bind and \`{f}\` that reads it moves with it (params first when a name is both); add \`"trail": {"of": "com", "anchor": "center"}\` to leave the track of a point across the sweep as the element \`com_trail\` (the spectrum a winding frequency traces), erasable by id`.
- Line 72 (`move`): replace `Attached labels follow their element's move, turn and scale (the text itself never rotates); intersection points, guide lines and regions do NOT — redraw those. To shift a curve semantically (e.g. demand shifting right with a new equilibrium), declare the shifted curve as a second element (D′) and draw it — do not move the original.` with: `Attached labels follow their element's move, turn and scale (the text itself never rotates). DEFINITIONS hold: a point defined as an intersection or as a point on a curve, a region between two curves, an arrow or edge between two things, an angle between two arms, a line through points and a measure of a thing are recomputed from the moved geometry — move the demand curve and its equilibrium, guide lines and surplus follow honestly (\`"ghost": true\` keeps the original faded). Placement does not follow: an element set \`at\` another stays where it was assembled. Declare a second curve (D′) instead when both curves are discussed side by side.`

- [ ] **Step 4: Four bundled examples** — append to `src/examples.json` (before the closing `]`), every request a question. Write them in the file's style (title drawn first, narrated draws, one idea per beat); the geometry below is what the gate checks.

```json
{
  "request": "Why does a higher frequency squeeze the wave?",
  "spec": {
    "title": "Frequency squeezes the wave",
    "vars": { "f": 1, "t": 2 },
    "domain": { "x": [0, 12.6], "y": [-1.5, 1.5] },
    "elements": [
      { "id": "title", "type": "text", "text": "Frequency squeezes the wave", "x": 500, "y": 700, "font_size": 34 },
      { "id": "ax", "type": "axes", "x_label": "time", "y_label": "" },
      { "id": "wave", "type": "curve", "expr": "sin(f*x)", "style": { "color": "#2f6b8f" } },
      { "id": "dot", "type": "point", "at": { "x": 2, "on": "wave" }, "bind": { "at.x": "t" }, "style": { "color": "#b5482e" } },
      { "id": "readout", "type": "text", "text": "f = {f}", "x": 840, "y": 640, "font_size": 30, "style": { "color": "#2f6b8f" } },
      { "id": "lbl", "type": "label", "attach_to": "dot", "side": "above-right", "text": "one point rides the wave", "style": { "color": "#b5482e" } }
    ],
    "commands": [
      { "draw": ["title", "ax"], "speak": "A sound has a pitch. What does a higher pitch look like on the wave?" },
      { "draw": ["wave", "readout"], "speak": "Here is a wave that repeats once per unit of time: frequency one." },
      { "draw": ["dot", "lbl"], "speak": "Mark one point on it, so we can watch it." },
      { "pause": 0.4 },
      { "animate": { "f": 4 }, "duration": 6, "easing": "linear", "speak": "Raise the frequency and the same stretch of time holds more and more cycles: the wave is squeezed, and the point rides up and down four times as often." },
      { "point": { "at": { "ref": "readout" }, "gesture": "underline" }, "speak": "Four cycles per unit — that is what a higher pitch is." },
      { "animate": { "t": 10 }, "duration": 4, "speak": "Slide the point along the squeezed wave and you feel how fast it now has to move." }
    ]
  }
},
{
  "request": "What is the tangent at a point, and how does it turn as the point slides?",
  "spec": {
    "title": "The tangent turns with the point",
    "vars": { "t": 1 },
    "domain": { "x": [0, 6.3], "y": [-1.5, 1.5] },
    "elements": [
      { "id": "title", "type": "text", "text": "The tangent turns with the point", "x": 500, "y": 700, "font_size": 34 },
      { "id": "ax", "type": "axes", "x_label": "x", "y_label": "sin x" },
      { "id": "curve", "type": "curve", "expr": "sin(x)", "style": { "color": "#2f6b8f" } },
      { "id": "foot", "type": "point", "at": { "x": 1, "on": "curve" }, "bind": { "at.x": "t" }, "style": { "color": "#b5482e" } },
      { "id": "tangent", "type": "line", "through": [{ "ref": "foot" }], "slope": 0.54, "bind": { "slope": "cos(t)" }, "style": { "color": "#b5482e", "dash": true } },
      { "id": "slope_txt", "type": "text", "text": "slope = cos(t) = {t:1}", "x": 780, "y": 640, "font_size": 26 },
      { "id": "lbl", "type": "label", "attach_to": "foot", "side": "below-right", "text": "the point", "style": { "color": "#b5482e" } }
    ],
    "commands": [
      { "draw": ["title", "ax"], "speak": "A curve bends. How steep is it at one point?" },
      { "draw": ["curve"], "speak": "Take the sine curve." },
      { "draw": ["foot", "lbl"], "speak": "Pick a point on it." },
      { "draw": ["tangent"], "speak": "The tangent is the straight line that touches the curve there and leans exactly as the curve leans: its slope is the derivative, cos t." },
      { "pause": 0.4 },
      { "animate": { "t": 4.7 }, "duration": 7, "easing": "linear", "speak": "Slide the point along, and the tangent turns with it: flat at the crest, steepest where the curve crosses zero, flat again in the trough." },
      { "highlight": { "target": ["tangent"], "effect": "glow" }, "speak": "That turning line is the derivative made visible." }
    ]
  }
},
{
  "request": "Does the equilibrium follow when demand shifts?",
  "spec": {
    "title": "Demand shifts, the equilibrium follows",
    "domain": { "x": [0, 100], "y": [0, 100] },
    "elements": [
      { "id": "title", "type": "text", "text": "Demand shifts, the equilibrium follows", "x": 500, "y": 700, "font_size": 34 },
      { "id": "ax", "type": "axes", "x_label": "Quantity", "y_label": "Price" },
      { "id": "demand", "type": "curve", "expr": "80 - x", "x_from": 5, "x_to": 75, "style": { "color": "#b5482e" } },
      { "id": "supply", "type": "curve", "expr": "20 + x", "x_from": 5, "x_to": 75, "style": { "color": "#2f6b8f" } },
      { "id": "label_D", "type": "label", "attach_to": "demand", "side": "above-right", "text": "D", "style": { "color": "#b5482e" } },
      { "id": "label_S", "type": "label", "attach_to": "supply", "side": "above-left", "text": "S", "style": { "color": "#2f6b8f" } },
      { "id": "eq", "type": "point", "at": { "intersection_of": ["demand", "supply"] }, "guides": true },
      { "id": "label_eq", "type": "label", "attach_to": "eq", "side": "below-right", "text": "E" },
      { "id": "surplus", "type": "region", "between": ["demand", "supply"], "x_from": 5, "x_to": 30, "style": { "fill": "#f2c14e" } }
    ],
    "commands": [
      { "draw": ["title", "ax"], "speak": "Incomes rise and people want more of everything. Where does the market settle now?" },
      { "draw": ["demand", "label_D"], "speak": "Demand slopes down: the higher the price, the less is bought." },
      { "draw": ["supply", "label_S"], "speak": "Supply slopes up: the higher the price, the more is offered." },
      { "draw": ["eq", "label_eq"], "speak": "Where they cross, the market clears — this point is defined by the two curves." },
      { "draw": ["surplus"], "speak": "The wedge between them, up to this quantity, is the surplus the first buyers enjoy." },
      { "pause": 0.4 },
      { "move": { "target": "demand", "by": [15, 0], "duration": 3, "ghost": true }, "speak": "Now demand shifts right. Watch: the crossing point, its guide lines and the surplus all move with it — nothing has to be redrawn, because they were defined by the curves." },
      { "point": { "at": { "ref": "eq" }, "gesture": "circle" }, "speak": "Higher price, higher quantity: the new equilibrium." },
      { "erase": ["demand_ghost"], "speak": "The old demand curve can go." }
    ]
  }
},
{
  "request": "What happens to the angle when one arm turns?",
  "spec": {
    "title": "An angle is made of its arms",
    "elements": [
      { "id": "title", "type": "text", "text": "An angle is made of its arms", "x": 500, "y": 700, "font_size": 34 },
      { "id": "arm_a", "type": "arrow", "from": { "x": 400, "y": 300 }, "to": { "x": 720, "y": 300 }, "style": { "color": "#2f6b8f" } },
      { "id": "arm_b", "type": "arrow", "from": { "x": 400, "y": 300 }, "to": { "x": 690, "y": 420 }, "style": { "color": "#b5482e" } },
      { "id": "ang", "type": "angle", "at": { "ref": "arm_a", "anchor": "tail" }, "from": { "ref": "arm_a", "anchor": "tip" }, "to": { "ref": "arm_b", "anchor": "tip" }, "radius": 70 },
      { "id": "label_a", "type": "label", "attach_to": "arm_a", "side": "below", "text": "fixed arm", "style": { "color": "#2f6b8f" } },
      { "id": "label_b", "type": "label", "attach_to": "arm_b", "side": "above", "text": "turning arm", "style": { "color": "#b5482e" } }
    ],
    "commands": [
      { "draw": ["title"], "speak": "What is an angle, really?" },
      { "draw": ["arm_a", "label_a"], "speak": "Two arms from one vertex. This one stays." },
      { "draw": ["arm_b", "label_b"], "speak": "This one we will turn." },
      { "draw": ["ang"], "speak": "The angle is the opening between them — and it writes its own size." },
      { "pause": 0.4 },
      { "move": { "target": "arm_b", "rotate": 50, "pivot": { "anchor": "tail" }, "duration": 3 }, "speak": "Turn the arm about the vertex and the arc widens with it, the number climbing as it goes: the angle is nothing but the two arms." },
      { "move": { "target": "arm_b", "rotate": -80, "pivot": { "anchor": "tail" }, "duration": 3 }, "speak": "Turn it back past the first arm and the opening shrinks to nothing, then grows the other way round." },
      { "highlight": { "target": ["ang"], "effect": "glow" }, "speak": "Move an arm, and the angle follows — it was defined by them." }
    ]
  }
}
```
Adjust numbers (label sides, x ranges, the readout position) until `npx vitest run tests/examples.test.ts` is clean — its lint gate rejects overlaps; the tangent's initial `slope` must equal `cos(1)` rounded (0.54) so the written value matches the first frame.

- [ ] **Step 5: The examples gate checks post-move geometry** — in `tests/examples.test.ts`, the existing plan gate builds `planCommands(spec.commands, layout.order, { …, bboxesFor })`; extend `bboxesFor` there to `(params, overrides) => { const b = elementBBoxes(layoutSpec({ ...spec, params: withOverrides(spec.params, split.params), vars: {...} }, undefined, overrides)); … }` using `splitVarOverrides`, and pass `varsBase: spec.vars ?? null`, `dependentsOf`, `sourceIds` from `planOptionsFor(spec, layout)` (already spread there — after Task 7 it carries them). Add one assertion: every relayout step's plan warnings are empty and the post-move `eq`/`ang` boxes exist (the point/highlight after the move resolve — the plan already warns "not visible"/"no box" otherwise, and the gate asserts no warnings).

- [ ] **Step 6: Run** — `npx vitest run tests/vars-prompt.test.ts tests/examples.test.ts tests/freehand-examples.test.ts tests/prompt*.test.ts tests/fewshot*.test.ts` then the full suite — PASS.

- [ ] **Step 7: Commit**

```bash
git add src/llm/prompts/compiler-v1.md src/examples.json tests/examples.test.ts tests/vars-prompt.test.ts
git commit -m "Prompt: vars, bind, a point on a curve, trail on animate, and definitions hold; four bundled examples (manim round 1, Task 8)"
```

---

### Task 9: Docs, ledger, smoke checklist, merge

**Files:**
- Modify: `ROADMAP.md` (new section after "Ghosts, angle and measure…", line ~370)
- Modify: `NOTES.md` (dated entry: the manim assessment table, what was taken, what waits)
- Create: `docs/superpowers/plans/2026-09-10-vars-and-dependencies-ledger.md`, `docs/superpowers/plans/2026-09-10-vars-and-dependencies-smoke.md`

- [ ] **Step 1: ROADMAP section** `## Vars and dependencies (the manim round, part 1) — done 2026-09-10`: the problem in two sentences, the five things shipped (`vars` + `bind` + `{f}` + `at.on`; `animate` on vars; `trail` on animate; definitions hold via relayout steps; four examples), "Deliberately not done" copied from the design's §6.
- [ ] **Step 2: NOTES entry** `## 2026-09-10 — What manim has that drawcast lacks` with the assessment table (candidate / value / cost / model cost / ruling) and the parts 2–3 list.
- [ ] **Step 3: Ledger** — header like the anchors ledger; every ruling made during execution; test counts before/after; anything the executor departed from in the plan and why.
- [ ] **Step 4: Smoke checklist** for Hans — one section per bundled example: what to load, what to watch for (the readout counting, the tangent turning, the equilibrium sliding with guides and surplus, the angle's number climbing), a scrub back and forth across the move, an export of the demand example.
- [ ] **Step 5: Full verification** — `npx vitest run` (all green, count noted in the ledger), `npx tsc --noEmit`, `npm run build`, `npm run build:engine`.
- [ ] **Step 6: Commit, push, merge** — commit the docs; `git push -u origin manim-round`; then merge into main: `git fetch origin && git merge --no-ff origin/main` (resolve if main moved), run the suite once more, `git push origin manim-round:main`; confirm with `git ls-remote origin main` that main's tip is the merge commit. (Hans's smoke test remains as the round's acceptance, as before.)

---

## Self-review

- **Spec coverage:** §2.1 vars/text tokens → Tasks 1, 4; §2.2 bind → 1, 3, 4; §2.3 at.on → 3, 4; §2.4 animate on vars + trail → 6, 7; §2.5 definitions hold (deps, overrides, planner, player, key) → 2, 5, 6, 7; §2.6 prompt → 8; §3 tests → each task; §4 examples → 8; §5 order matches. Measures: kept on their path (Task 2 excludes them; Task 7 drops this step's stale measure overrides mid-tween).
- **Placeholders:** none; every step carries code or exact edits.
- **Type consistency:** `LayoutOverrides`/`PoseOverride` (posed.ts) used by layout.ts, plan.ts, player.ts, index.ts; `splitVarOverrides` (params.ts) used by index.ts and the examples gate; `cutTrail` (trails.ts) used by minted.ts; `moveFrame`/`transformFrame`/`morphFrame` (tween.ts) used by player.ts; `Plan.sources`, `PlanOptions.varsBase/dependentsOf/sourceIds/bboxesFor(params, overrides)/anchorsAt` consistent between Tasks 6, 7, 8; `Reprojector.frame(params, scene, opts)` / `commit(params, overrides)` consistent between Task 7's player and index and the stub tests.
