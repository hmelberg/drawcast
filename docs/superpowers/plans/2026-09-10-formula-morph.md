# Formula Morph, Term Colours, Copy and Parametric Curves — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `math` element can morph into a new formula (`morph: {target, tex}`) with matching terms gliding and the rest fading; formulas take per-term colours; a `copy` verb clones an element in the layout; a `curve` can be parametric.

**Architecture:** One mechanism from part 1 — a relayout step whose layout override carries the new TeX and the progress `t`; the layout itself emits the interpolated formula, so commits and scrubs are exact. Token identity comes from the MathJax SVG the engine already walks (`data-mml-node`, `data-latex`, `data-c`). `copy` is a layout override too (a cloned element), not a minted ghost.

**Tech Stack:** TypeScript, Vite, vitest (`npx vitest run <file>`), MathJax 4 (`@mathjax/src`, lite adaptor, no DOM), stub reprojectors for player tests (see `tests/relayout-player.test.ts`).

**Spec:** `docs/superpowers/specs/2026-09-10-formula-morph-design.md` (read it first; part 1's design `2026-09-10-vars-and-dependencies-design.md` explains the relayout engine this builds on).

## Global Constraints

- The model writes semantics; code computes every glyph. New surface: `morph.tex`, `colors`, the `copy` verb, `x_expr`/`y_expr`/`t_from`/`t_to`. Nothing else the model has to learn.
- Branch `manim-part2` in the worktree `/Users/hom/Documents/GitHub/drawcast/.claude/worktrees/template-spike` (cut from `origin/main` 834ea8d, MathJax 4). Work ONLY there; never `cd` to the main checkout.
- Every task ends green: the touched test files, then `npx tsc --noEmit`. Commit per task on `manim-part2`; `git push` after each commit. Commit messages end with:
  ```
  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01T7Cy2RG2Hcp8VYvra3prb3
  ```
- Baseline on `manim-part2` before this round: 341 test files, 6816 tests, all green.
- Bundled examples must pass `tests/examples.test.ts` with no warning and no lint issue of any severity; the examples gate also lays out every post-step layout (`bboxesFor` asserts them).
- A new verb is registered in SEVEN places (part 2 round-2 lesson): `src/spec/types.ts` (Command + args interface), `src/spec/schema.ts` (commandSchema property, the verb list in commandSchema.description, `ACTION_VERBS` ~line 1076), `src/render/plan.ts` (`ACTION_KEYS` ~785 + the branch), `src/lint/lint.ts` (`ACTION_KEYS` ~498), `src/llm/subtitles.ts` (the paired-speak verb list ~61), `src/llm/prompts/compiler-v1.md` (the verb list in "Each command sets ONE action verb" ~line 42, plus its bullet).
- The prompt-size budget test (`tests/prompt-size.test.ts`) is re-pinned, with a dated note, in the task that grows the prompt (Task 8) — never silently.
- The sandbox refuses `sed -n "$(…)"` with computed arguments; use literal line numbers or `awk '/pattern/{f=1} f{print; n++} n>40{exit}' file`.

---

### Task 1: Token identity from the engine

**Files:**
- Modify: `src/scenes/engines.ts` (the `MathJaxEngine` interface ~118-138; `collect` and `layoutTeX` ~311-360)
- Test: `tests/mathjax.test.ts` (append a `describe`)

**Interfaces:**
- Produces (exported from `src/scenes/engines.ts`):
  ```ts
  export interface MathToken { index: number; node: string; latex: string; chain: string[]; glyphs: number[] }
  export interface MathOutline {
    pts: [number, number][];
    holes?: [number, number][][];
    /** Index of the source <path>/<rect> in reading order. */
    glyph: number;
    token: { index: number; node: string; latex: string; c?: string; chain: string[] };
  }
  // MathJaxEngine.layoutTeX now returns { outlines: MathOutline[]; tokens: MathToken[]; w: number; h: number }
  ```
  `node` is the nearest `data-mml-node` ancestor that directly contains the glyph (`mi`, `mo`, `mn`, `mtext`, …), or `"rule"` for a `<rect>`; `latex` is that node's `data-latex` (a rule's: its parent's); `chain` is the `data-latex` of every ancestor from the token's node up to the root (`[own, parent, …, root]`); `c` is the path's `data-c`. Tokens are numbered in reading order; a token's `glyphs` lists its glyph indices.

- [ ] **Step 1: Write the failing test** (append to `tests/mathjax.test.ts`, reusing its `mathjax()` helper)

```ts
describe("token identity (formula morph design §2.2)", () => {
  test("x = \\frac{a+1}{2b}: tokens in reading order, the rule keyed to its fraction, chains up to the root", async () => {
    const mj = await mathjax();
    const laid = mj.layoutTeX("x = \\frac{a+1}{2b}", { display: false });
    const keys = laid.tokens.map((t) => `${t.node}:${t.latex}`);
    expect(keys).toEqual(["mi:x", "mo:=", "mi:a", "mo:+", "mn:1", "mn:2", "mi:b", "rule:\\frac{a+1}{2b}"].sort((a, b) => 0) === undefined ? [] : keys);
    // reading order: x, =, a, +, 1, (rule), 2, b — MathJax emits the numerator, the denominator, then the rule
    expect(keys.slice(0, 5)).toEqual(["mi:x", "mo:=", "mi:a", "mo:+", "mn:1"]);
    expect(keys).toContain("rule:\\frac{a+1}{2b}");
    expect(keys.filter((k) => k.startsWith("mn:")).sort()).toEqual(["mn:1", "mn:2"]);
    for (const t of laid.tokens) expect(t.glyphs.length).toBeGreaterThan(0);
    // every outline names its glyph and token; the rule has no codepoint
    for (const o of laid.outlines) {
      expect(typeof o.glyph).toBe("number");
      expect(laid.tokens[o.token.index].glyphs).toContain(o.glyph);
      expect(o.token.chain[o.token.chain.length - 1]).toBe("x = \\frac{a+1}{2b}");
    }
    const rule = laid.outlines.find((o) => o.token.node === "rule")!;
    expect(rule.token.c).toBeUndefined();
    expect(rule.pts).toHaveLength(4);
    const x = laid.outlines.find((o) => o.token.latex === "x")!;
    expect(x.token.c).toMatch(/^1D465$/i);
    expect(x.token.chain[0]).toBe("x");
  });
  test("= is one token of one glyph that yields two hole-free outlines; 11 is one token of two glyphs", async () => {
    const mj = await mathjax();
    const eq = mj.layoutTeX("=", { display: false });
    expect(eq.tokens).toHaveLength(1);
    expect(eq.tokens[0].glyphs).toHaveLength(1);
    expect(eq.outlines.filter((o) => o.token.index === 0)).toHaveLength(2);
    const eleven = mj.layoutTeX("11", { display: false });
    expect(eleven.tokens).toHaveLength(1);
    expect(eleven.tokens[0].node).toBe("mn");
    expect(eleven.tokens[0].glyphs).toHaveLength(2);
  });
});
```
(Drop the first nonsense `expect(keys).toEqual(...)` line — it is a placeholder for you to replace with the exact order you observe once the implementation runs; the rule's position in reading order is whatever MathJax emits, so assert the order of the first five keys and the presence of the rest, as the lines after it do.)

- [ ] **Step 2: Run** `npx vitest run tests/mathjax.test.ts` — the new tests FAIL (`tokens` undefined).

- [ ] **Step 3: Implement** in `src/scenes/engines.ts`

Replace the interface's `layoutTeX` return type with the one under Interfaces (add the two exported interfaces above it). In `makeMathJaxEngine` (the function that defines `collect`), change the walk so it carries token context:

```ts
  interface Group { rings: [number, number][][]; glyph: number; tokenIndex: number; c?: string }
  interface Walk { groups: Group[]; tokens: MathToken[]; glyphs: number }
  interface TokenRef { node: string; latex: string; chain: string[]; index: number }

  const collect = (node: LiteElement, parent: Mat, walk: Walk, token: TokenRef | null): void => {
    const err = adaptor.getAttribute(node, "data-mjx-error");
    if (err) throw new Error(`TeX error: ${err}`);
    const tf = adaptor.getAttribute(node, "transform");
    const m = tf ? mulMat(parent, parseTransform(tf)) : parent;
    const at = (x: number, y: number): [number, number] => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
    const mml = adaptor.getAttribute(node, "data-mml-node");
    if (mml) {
      const latex = adaptor.getAttribute(node, "data-latex") ?? "";
      token = { node: mml, latex, chain: [latex, ...(token?.chain ?? [])], index: -1 };
    }
    /** The token this glyph belongs to, materialised on first use so tokens are numbered in reading order. */
    const tokenFor = (kind: string): number => {
      const t = token ?? { node: kind, latex: "", chain: [], index: -1 };
      if (t.index < 0) {
        t.index = walk.tokens.length;
        walk.tokens.push({ index: t.index, node: kind === "rule" ? "rule" : t.node, latex: t.latex, chain: t.chain, glyphs: [] });
      }
      return t.index;
    };
    const kind = adaptor.kind(node);
    if (kind === "path") {
      const rings = sampleSvgPath(adaptor.getAttribute(node, "d") || "").map((ring) => ring.map(([x, y]) => at(x, y)));
      if (rings.length > 0) {
        const tokenIndex = tokenFor("glyph");
        const glyph = walk.glyphs++;
        walk.tokens[tokenIndex].glyphs.push(glyph);
        walk.groups.push({ rings, glyph, tokenIndex, c: adaptor.getAttribute(node, "data-c") ?? undefined });
      }
    } else if (kind === "rect") {
      const n = (a: string) => Number(adaptor.getAttribute(node, a) || 0);
      const x = n("x"), y = n("y"), w = n("width"), h = n("height");
      if (w > 0 && h > 0) {
        // A rule belongs to its own token, keyed "rule" on the fraction/root it bars —
        // a fresh TokenRef so the mfrac's paths (none directly) never share it.
        const ruleToken: TokenRef = { node: "rule", latex: token?.latex ?? "", chain: token?.chain ?? [], index: -1 };
        const saved = token; token = ruleToken;
        const tokenIndex = tokenFor("rule");
        token = saved;
        const glyph = walk.glyphs++;
        walk.tokens[tokenIndex].glyphs.push(glyph);
        walk.groups.push({ rings: [[at(x, y), at(x + w, y), at(x + w, y + h), at(x, y + h)]], glyph, tokenIndex });
      }
    }
    for (const child of adaptor.childNodes(node)) if (isElement(child)) collect(child, m, walk, token);
  };
```
(`tokenFor` closes over the `token` variable of the current call; because `token` is reassigned per `<g data-mml-node>` on the way down and the recursion passes it explicitly, each node's paths materialise the same TokenRef object — `t.index` is written on the shared object, so a `mn` with two `<path>`s gets one token with two glyphs.) In `layoutTeX`:

```ts
      const walk: Walk = { groups: [], tokens: [], glyphs: 0 };
      collect(svg, IDENTITY, walk, null);
      const norm = …; // unchanged
      const outlines: MathOutline[] = walk.groups.flatMap((g) => {
        const t = walk.tokens[g.tokenIndex];
        return groupRings(g.rings.map(norm)).map((o) => ({ ...o, glyph: g.glyph, token: { index: t.index, node: t.node, latex: t.latex, chain: t.chain, ...(g.c !== undefined ? { c: g.c } : {}) } }));
      });
      return { outlines, tokens: walk.tokens, w: vw / unitsPerEx, h: vh / unitsPerEx };
```
Update the interface's doc comment (one sentence on glyph/token). `tests/packs.test.ts` and `tests/math-element.test.ts` read only `pts`/`holes` and keep passing.

- [ ] **Step 4: Run** `npx vitest run tests/mathjax.test.ts tests/math-element.test.ts tests/packs.test.ts` — PASS; fix the observed reading order in the test's assertions if MathJax's order differs from the comment (assert what is true, and say so in the comment). `npx tsc --noEmit` clean.

- [ ] **Step 5: Commit** `git add src/scenes/engines.ts tests/mathjax.test.ts && git commit -m "mathjax engine: every outline names its glyph and token (node, latex, codepoint, chain); tokens in reading order (formula morph, Task 1)" && git push`

---

### Task 2: Matcher and colour lookup — `src/layout/math-morph.ts`

**Files:**
- Create: `src/layout/math-morph.ts`
- Test: `tests/math-match.test.ts`

**Interfaces:**
```ts
export function normalizeTex(s: string): string;                 // collapse whitespace, trim
export function colorFor(chain: string[], colors: Record<string, string> | undefined): string | null; // deepest chain entry equal (normalised) to a key
export interface TokenMatch { pairs: [number, number][]; unmatchedFrom: number[]; unmatchedTo: number[] } // token indices
export function matchTokens(from: MathToken[], to: MathToken[]): TokenMatch;   // LCS on `${node}\0${normalizeTex(latex)}`
export interface ShapeMatch { pairs: [number, number][]; unmatchedFrom: number[]; unmatchedTo: number[] } // outline indices
export function matchShapes(from: { tokens: MathToken[]; outlines: MathOutline[] }, to: { tokens: MathToken[]; outlines: MathOutline[] }): ShapeMatch;
```
`matchShapes`: for each token pair, walk both glyph lists in order pairing glyph k with glyph k (the shorter run bounds it); for each glyph pair, pair the outlines carrying those glyph indices in order (an `=` glyph has two outlines); everything left is unmatched. `colorFor` keys and chain entries are compared after `normalizeTex`; the deepest (index 0 = the token's own latex) match wins.

- [ ] **Step 1: Write the failing test**

```ts
// tests/math-match.test.ts
import { describe, expect, test } from "vitest";
import { colorFor, matchShapes, matchTokens, normalizeTex } from "../src/layout/math-morph";
import { ensureEngines, getLoadedEngines, type MathJaxEngine, type MathToken } from "../src/scenes/engines";

async function mathjax(): Promise<MathJaxEngine> {
  await ensureEngines(["mathjax"]);
  return getLoadedEngines(["mathjax"]).mathjax as MathJaxEngine;
}
const tok = (node: string, latex: string, i: number): MathToken => ({ index: i, node, latex, chain: [latex], glyphs: [i] });

describe("matchTokens", () => {
  test("2x + 3 = 11 → 2x = 8 keeps 2, x, = and drops +, 3, 11; 8 is new", () => {
    const from = [tok("mn", "2", 0), tok("mi", "x", 1), tok("mo", "+", 2), tok("mn", "3", 3), tok("mo", "=", 4), tok("mn", "11", 5)];
    const to = [tok("mn", "2", 0), tok("mi", "x", 1), tok("mo", "=", 2), tok("mn", "8", 3)];
    const m = matchTokens(from, to);
    expect(m.pairs).toEqual([[0, 0], [1, 1], [4, 2]]);
    expect(m.unmatchedFrom).toEqual([2, 3, 5]);
    expect(m.unmatchedTo).toEqual([3]);
  });
  test("a repeated x matches in order; node kind matters (mn:2 never matches mi:2)", () => {
    const from = [tok("mi", "x", 0), tok("mo", "+", 1), tok("mi", "x", 2)];
    const to = [tok("mi", "x", 0), tok("mo", "-", 1), tok("mi", "x", 2)];
    expect(matchTokens(from, to).pairs).toEqual([[0, 0], [2, 2]]);
    expect(matchTokens([tok("mn", "2", 0)], [tok("mi", "2", 0)]).pairs).toEqual([]);
  });
  test("normalizeTex collapses whitespace; colorFor picks the deepest matching chain entry", () => {
    expect(normalizeTex(" \\Delta  C ")).toBe("\\Delta C");
    const colors = { "\\Delta C": "#b5482e", "\\frac{\\Delta C}{\\Delta E}": "#000" };
    expect(colorFor(["C", "\\Delta C", "\\frac{\\Delta C}{\\Delta E}", "ICER = \\frac{\\Delta C}{\\Delta E}"], colors)).toBe("#b5482e");
    expect(colorFor(["E", "\\Delta  E", "\\frac{\\Delta C}{\\Delta E}"], colors)).toBe("#000");
    expect(colorFor(["x"], colors)).toBeNull();
    expect(colorFor(["x"], undefined)).toBeNull();
  });
});

describe("matchShapes on real engine output", () => {
  test("2x + 3 = 11 → 2x = 8: the = glyph's two bars pair, 11's two glyphs are unmatched", async () => {
    const mj = await mathjax();
    const a = mj.layoutTeX("2x + 3 = 11", { display: false });
    const b = mj.layoutTeX("2x = 8", { display: false });
    const m = matchShapes(a, b);
    const eqA = a.outlines.map((o, i) => (o.token.latex === "=" ? i : -1)).filter((i) => i >= 0);
    const eqB = b.outlines.map((o, i) => (o.token.latex === "=" ? i : -1)).filter((i) => i >= 0);
    expect(eqA).toHaveLength(2);
    expect(m.pairs).toEqual(expect.arrayContaining([[eqA[0], eqB[0]], [eqA[1], eqB[1]]]));
    const eleven = a.outlines.map((o, i) => (o.token.latex === "11" ? i : -1)).filter((i) => i >= 0);
    expect(eleven).toHaveLength(2);
    for (const i of eleven) expect(m.unmatchedFrom).toContain(i);
    expect(m.pairs.length + m.unmatchedFrom.length).toBe(a.outlines.length);
    expect(m.pairs.length + m.unmatchedTo.length).toBe(b.outlines.length);
  });
});
```

- [ ] **Step 2: Run** `npx vitest run tests/math-match.test.ts` — FAIL (module missing).

- [ ] **Step 3: Implement `src/layout/math-morph.ts`** (matcher only in this task; the tween layout is Task 3)

```ts
// Formula morph (design 2026-09-10-formula-morph §2.3–2.4): which terms of
// one formula are the same terms in another, and what colour a term wears.
import type { MathOutline, MathToken } from "../scenes/engines";

export function normalizeTex(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/** The deepest entry of a token's latex chain (index 0 = its own) that equals a colour key. */
export function colorFor(chain: string[], colors: Record<string, string> | undefined): string | null {
  if (!colors) return null;
  const keys = new Map(Object.entries(colors).map(([k, v]) => [normalizeTex(k), v]));
  for (const entry of chain) {
    const hit = keys.get(normalizeTex(entry));
    if (hit !== undefined) return hit;
  }
  return null;
}

export interface TokenMatch { pairs: [number, number][]; unmatchedFrom: number[]; unmatchedTo: number[] }

const keyOf = (t: MathToken): string => `${t.node}\0${normalizeTex(t.latex)}`;

/** Longest common subsequence over token keys, in reading order; each token matches at most once. */
export function matchTokens(from: MathToken[], to: MathToken[]): TokenMatch {
  const n = from.length, m = to.length;
  const L: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = keyOf(from[i]) === keyOf(to[j]) ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const pairs: [number, number][] = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (keyOf(from[i]) === keyOf(to[j])) { pairs.push([from[i].index, to[j].index]); i++; j++; }
    else if (L[i + 1][j] >= L[i][j + 1]) i++;
    else j++;
  }
  const pf = new Set(pairs.map((p) => p[0])), pt = new Set(pairs.map((p) => p[1]));
  return { pairs, unmatchedFrom: from.map((t) => t.index).filter((k) => !pf.has(k)), unmatchedTo: to.map((t) => t.index).filter((k) => !pt.has(k)) };
}

export interface ShapeMatch { pairs: [number, number][]; unmatchedFrom: number[]; unmatchedTo: number[] }

/** Token pairs → glyph pairs (in order, the shorter run bounds it) → outline pairs (in order per glyph). */
export function matchShapes(from: { tokens: MathToken[]; outlines: MathOutline[] }, to: { tokens: MathToken[]; outlines: MathOutline[] }): ShapeMatch {
  const outlinesOfGlyph = (side: { outlines: MathOutline[] }, glyph: number): number[] => side.outlines.map((o, i) => (o.glyph === glyph ? i : -1)).filter((i) => i >= 0);
  const pairs: [number, number][] = [];
  for (const [fi, ti] of matchTokens(from.tokens, to.tokens).pairs) {
    const fg = from.tokens[fi].glyphs, tg = to.tokens[ti].glyphs;
    for (let k = 0; k < Math.min(fg.length, tg.length); k++) {
      const fo = outlinesOfGlyph(from, fg[k]), tob = outlinesOfGlyph(to, tg[k]);
      for (let q = 0; q < Math.min(fo.length, tob.length); q++) pairs.push([fo[q], tob[q]]);
    }
  }
  const pf = new Set(pairs.map((p) => p[0])), pt = new Set(pairs.map((p) => p[1]));
  return {
    pairs,
    unmatchedFrom: from.outlines.map((_, i) => i).filter((i) => !pf.has(i)),
    unmatchedTo: to.outlines.map((_, i) => i).filter((i) => !pt.has(i)),
  };
}
```

- [ ] **Step 4: Run** `npx vitest run tests/math-match.test.ts` — PASS. `npx tsc --noEmit` clean.
- [ ] **Step 5: Commit** `git add src/layout/math-morph.ts tests/math-match.test.ts && git commit -m "math-morph: token and shape matching by LCS, colour lookup by latex chain (formula morph, Task 2)" && git push`

---

### Task 3: The tween layout, and `colors` in `math.ts` and `equation_steps`

**Files:**
- Modify: `src/layout/math.ts` (add `colors`; add `mathMorphDrawables`)
- Modify: `src/scenes/packs/mathlogic.yaml` (`equation_steps`: `colors` param ~951-967, fill per shape ~1094-1096; the pack's `description` mentions colours)
- Modify: `src/spec/types.ts` (`SpecElement.colors?: Record<string, string>`), `src/spec/schema.ts` (element `colors` property, one sentence; `label` with `tex` carries it through `normalizeSpec`'s tex-label rewrite — find where `tex` labels become math elements and copy `colors` too)
- Test: `tests/math-morph-layout.test.ts`, extend `tests/packs.test.ts` (equation_steps colours)

**Interfaces:**
```ts
// src/layout/math.ts
export function mathDrawables(el, mathjax, cx, cy): { drawables: Drawable[]; box: BBox; unusedColors: string[] };
export function mathMorphDrawables(el, mathjax, cx, cy, from: string, to: string, t: number): { drawables: Drawable[]; box: BBox; unusedColors: string[] };
```
Placement rule shared by both (extract `placeFormula(laid, cx, cy, size)` returning `{ shapes: { pts: Pt[]; holes: Pt[][]; outline: MathOutline }[]; box: BBox }` — the `mathDrawables` loop today, kept identical so every existing math test still passes). Colour per shape: `colorFor(outline.token.chain, el.colors) ?? ink.color`, fill and stroke alike (the child's `style` is built from `resolveStyle(el.style, { color, fill: color, opacity })`). `unusedColors`: keys no shape matched (the tier-2 case warns: `math "<id>": colors key "<k>" matches nothing`).

`mathMorphDrawables`: `const A = placeFormula(engine.layoutTeX(from), …)`, `const B = placeFormula(engine.layoutTeX(to), …)`, `const m = matchShapes(laidFrom, laidTo)`; children:
- for each pair `[i, j]`: `const pair = morphPair(A[i].pts, true, B[j].pts, true)`; `pts = lerp(pair.from, pair.to, t)`; holes: if `A[i].holes.length === B[j].holes.length` lerp each via `morphPair`, else `t >= 0.5 ? B[j].holes : A[i].holes` — no: "a counter that cannot be paired does not drag": use `t >= 0.5 ? B[j].holes : []`; colour from B[j]'s token; opacity 1;
- each unmatched `i` of A: own pts/holes, `style.opacity = 1 - t`;
- each unmatched `j` of B: own pts/holes, `style.opacity = t`;
- shapes with opacity 0 exactly are still emitted (the node list must not depend on `t`); ids `${el.id}__g${k}` by emission order; `precise: true`; box = union of A.box and B.box; the group as in `mathDrawables`.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/math-morph-layout.test.ts
import { beforeAll, describe, expect, test } from "vitest";
import { ensureEngines, getLoadedEngines, type MathJaxEngine } from "../src/scenes/engines";
import { mathDrawables, mathMorphDrawables } from "../src/layout/math";
import type { AreaDrawable, GroupDrawable } from "../src/layout/model";
import type { SpecElement } from "../src/spec/types";

let mj: MathJaxEngine;
beforeAll(async () => { await ensureEngines(["mathjax"]); mj = getLoadedEngines(["mathjax"]).mathjax as MathJaxEngine; });
const el = (extra: Partial<SpecElement> = {}): SpecElement => ({ id: "eq", type: "math", tex: "2x + 3 = 11", size: 40, ...extra } as SpecElement);
const kids = (r: { drawables: { kind: string }[] }) => ((r.drawables[0] as GroupDrawable).children as AreaDrawable[]);
const centroid = (pts: [number, number][]) => pts.reduce((s, p) => [s[0] + p[0] / pts.length, s[1] + p[1] / pts.length], [0, 0]);

describe("mathMorphDrawables", () => {
  test("t = 0: matched shapes sit on the old formula, new-only shapes have opacity 0; t = 1: the reverse", () => {
    const a = kids(mathDrawables(el(), mj, 500, 375));
    const b = kids(mathDrawables(el({ tex: "2x = 8" }), mj, 500, 375));
    const at0 = kids(mathMorphDrawables(el(), mj, 500, 375, "2x + 3 = 11", "2x = 8", 0));
    const at1 = kids(mathMorphDrawables(el(), mj, 500, 375, "2x + 3 = 11", "2x = 8", 1));
    expect(at0.length).toBe(at1.length); // the node list never depends on t
    expect(at0.filter((k) => k.style.opacity === 0).length).toBeGreaterThanOrEqual(1); // 8, unmatched new
    expect(at1.filter((k) => k.style.opacity === 0).length).toBe(a.length - 3 - 1); // +, 3, 11(2 glyphs) → 4 shapes gone… adjust to the observed count and explain
    // a matched shape at t=1 lies on the new formula's shape (the "2"):
    const two1 = at1.find((k) => k.style.opacity === 1)!;
    const twoB = b[0];
    expect(centroid(two1.pts)[0]).toBeCloseTo(centroid(twoB.pts)[0], 0);
  });
  test("t = 0.5: a matched glyph's centroid is the midpoint of its old and new place; an unpaired counter appears only from t ≥ 0.5", () => {
    const a = kids(mathDrawables(el({ tex: "x = 1" }), mj, 500, 375));
    const b = kids(mathDrawables(el({ tex: "x = 8" }), mj, 500, 375));
    const mid = kids(mathMorphDrawables(el({ tex: "x = 1" }), mj, 500, 375, "x = 1", "x = 8", 0.5));
    const xa = a[0], xb = b[0], xm = mid[0];
    expect(centroid(xm.pts)[0]).toBeCloseTo((centroid(xa.pts)[0] + centroid(xb.pts)[0]) / 2, 0);
    const eightMid = mid.find((k) => k.style.opacity === 0.5 && (k.holes?.length ?? 0) === 2);
    expect(eightMid).toBeDefined();
    const before = kids(mathMorphDrawables(el({ tex: "x = 1" }), mj, 500, 375, "x = 1", "x = 8", 0.25));
    expect(before.every((k) => k.style.opacity !== 0.25 || (k.holes?.length ?? 0) === 2)).toBe(true); // the 8 keeps its own holes: it is unmatched, not lerped
  });
});

describe("colors", () => {
  test("colors: {x: …} colours both x in x^2 + x and nothing else; an unknown key is reported", () => {
    const r = mathDrawables(el({ tex: "x^2 + x", colors: { x: "#2f6b8f", q: "#000" } }), mj, 500, 375);
    const blue = kids(r).filter((k) => k.style.fill === "#2f6b8f");
    expect(blue).toHaveLength(2);
    expect(kids(r).filter((k) => k.style.fill !== "#2f6b8f").length).toBe(kids(r).length - 2);
    expect(r.unusedColors).toEqual(["q"]);
  });
  test("a multi-token key colours the whole numerator; the colour survives a morph on matched shapes", () => {
    const r = mathDrawables(el({ tex: "\\frac{\\Delta C}{\\Delta E}", colors: { "\\Delta C": "#b5482e" } }), mj, 500, 375);
    expect(kids(r).filter((k) => k.style.fill === "#b5482e").length).toBeGreaterThanOrEqual(2); // Δ and C
    const m = kids(mathMorphDrawables(el({ tex: "\\frac{C_1 - C_0}{E}", colors: { "\\Delta C": "#b5482e", "C_1 - C_0": "#b5482e" } }), mj, 500, 375, "\\frac{C_1 - C_0}{E}", "\\frac{\\Delta C}{E}", 0.5));
    expect(m.some((k) => k.style.fill === "#b5482e")).toBe(true);
  });
});
```
Replace the "adjust to the observed count" assertion with the count you observe, and say in a comment why it is that number (which shapes are unmatched).

- [ ] **Step 2: Run** — FAIL (`mathMorphDrawables` missing; `colors` ignored).
- [ ] **Step 3: Implement** as described under Interfaces; `lerp(a, b, t)` point-wise; import `morphPair` from `../render/morph` (pure math, like `pose.ts` — note the layering exception in the file header, as `posed.ts` does).
- [ ] **Step 4: `equation_steps` colours** — in `src/scenes/packs/mathlogic.yaml`: add to params `colors: { type: object, additionalProperties: { type: string }, description: "Colour per term: a TeX snippet → colour, e.g. {\"x\": \"#2f6b8f\"} — every occurrence, in every step." }`; in the step loop compute the fill `colorFor(o.token.chain, params.colors) ?? C.ink`. The template body has no import access — expose the helper on the kit: add `kit.mathColorFor(chain: string[], colors?: Record<string, string>): string | null` in `src/scenes/kit.ts` (interface + implementation, delegating to `colorFor`), bump nothing else. Test in `tests/packs.test.ts`: an `equation_steps` with `colors: {x: "#2f6b8f"}` and steps `["x = 1", "2x = 2"]` colours exactly the two `x` shapes.
- [ ] **Step 5: Types and schema** — `colors?: Record<string, string>` on `SpecElement` (types.ts) and in the element schema (`colors: { type: "object", additionalProperties: { type: "string" }, description: 'math: colour per term, a TeX snippet → colour ({"x": "#2f6b8f", "\\\\Delta C": "#b5482e"}); every occurrence.' }`); in `normalizeSpec`'s tex-label rewrite (grep `tex` in schema.ts near the `label` → `math` conversion) carry `colors` over. In `src/layout/tier2.ts`'s `math` case, push `laid.unusedColors` as warnings.
- [ ] **Step 6: Run** `npx vitest run tests/math-morph-layout.test.ts tests/math-element.test.ts tests/packs.test.ts tests/mathjax.test.ts` — PASS; `npx tsc --noEmit`.
- [ ] **Step 7: Commit** `… -m "Formula tween layout (mathMorphDrawables) and per-term colours on math elements and equation_steps (formula morph, Task 3)"` and push.

---

### Task 4: Layout overrides — `math` and `copies`

**Files:**
- Modify: `src/layout/posed.ts` (`LayoutOverrides` gains `math`, `copies`; `isEmptyOverrides`/`overridesKey` include them)
- Modify: `src/layout/tier2.ts` (copies appended to the element list; the `math` case reads the override)
- Test: `tests/formula-overrides.test.ts`

**Interfaces:**
```ts
export interface LayoutOverrides {
  poses?: …; shapes?: …;
  /** A math element's current TeX (and, mid-morph, where it comes from and how far along). */
  math?: Record<string, { tex: string; from?: string; t?: number }>;
  /** Cloned elements: new id → source element id (design §2.5). */
  copies?: Record<string, string>;
}
```
tier2: at the top of `layoutElements`, `elements = withCopies(elements, opts.overrides?.copies)` — for each `[newId, srcId]` in insertion order, if `srcId` names an element (or an earlier copy) push `{ ...source, id: newId }` (a shallow clone; `bind`, `at`, `style` shared by reference is fine — layout never mutates the spec element) right AFTER the source in the list, so placement order and dependency order treat it like the source; a copy whose source is unknown is a warning and skipped. The `math` case: `const ov = ctx.overrides.math?.[el.id]; const tex = ov?.tex ?? el.tex; if (ov?.from !== undefined && ov.t !== undefined && ov.t < 1) laid = mathMorphDrawables({ ...el, tex }, engine, cx, cy, ov.from, ov.tex, ov.t); else laid = mathDrawables({ ...el, tex }, engine, cx, cy);`.

- [ ] **Step 1: Tests**

```ts
// tests/formula-overrides.test.ts
import { beforeAll, describe, expect, test } from "vitest";
import { ensureEngines } from "../src/scenes/engines";
import { layoutSpec } from "../src/layout/layout";
import { isEmptyOverrides, overridesKey } from "../src/layout/posed";
import type { Spec } from "../src/spec/types";
import type { GroupDrawable, TextDrawable } from "../src/layout/model";

beforeAll(async () => { await ensureEngines(["mathjax"]); });
const spec: Spec = { elements: [{ id: "eq", type: "math", tex: "2x + 3 = 11", x: 500, y: 375 }, { id: "lbl", type: "label", attach_to: "eq", text: "start" }], commands: [] };
const group = (l: ReturnType<typeof layoutSpec>, id: string) => l.drawables.find((d) => d.id === id) as GroupDrawable;

describe("math override", () => {
  test("{tex} lays out the new formula; {from, t} lays out the tween; t = 1 equals the plain new layout", () => {
    const plain = layoutSpec({ ...spec, elements: [{ ...spec.elements![0], tex: "2x = 8" }, spec.elements![1]] });
    const over = layoutSpec(spec, undefined, { math: { eq: { tex: "2x = 8" } } });
    expect(group(over, "eq").children.length).toBe(group(plain, "eq").children.length);
    const settled = layoutSpec(spec, undefined, { math: { eq: { tex: "2x = 8", from: "2x + 3 = 11", t: 1 } } });
    expect(group(settled, "eq").children.length).toBe(group(plain, "eq").children.length);
    const mid = layoutSpec(spec, undefined, { math: { eq: { tex: "2x = 8", from: "2x + 3 = 11", t: 0.5 } } });
    expect(group(mid, "eq").children.length).toBeGreaterThan(group(plain, "eq").children.length);
    expect(isEmptyOverrides({ math: {} })).toBe(true);
    expect(overridesKey({ math: { eq: { tex: "a" } } })).not.toBe(overridesKey({ math: { eq: { tex: "b" } } }));
  });
});

describe("copies override", () => {
  test("a copy is laid out at the source's place under the new id and can carry its own pose", () => {
    const base = layoutSpec(spec);
    const withCopy = layoutSpec(spec, undefined, { copies: { eq2: "eq" } });
    expect(withCopy.order).toContain("eq2");
    expect(group(withCopy, "eq2").children.length).toBe(group(base, "eq").children.length);
    expect(withCopy.namedAnchors.eq2.center).toEqual(withCopy.namedAnchors.eq.center);
    const moved = layoutSpec(spec, undefined, { copies: { eq2: "eq" }, poses: { eq2: { offset: [0, -100] } }, math: { eq2: { tex: "2x = 8" } } });
    expect(group(moved, "eq2").children.length).not.toBe(group(base, "eq").children.length); // the copy morphed, the source did not
    expect(group(moved, "eq").children.length).toBe(group(base, "eq").children.length);
    // the label attached to the source is not copied
    expect(withCopy.drawables.filter((d) => (d as TextDrawable).text === "start")).toHaveLength(1);
  });
  test("a copy of an unknown source warns and is skipped; a copy of a copy works", () => {
    const l = layoutSpec(spec, undefined, { copies: { c1: "nope", eq2: "eq", eq3: "eq2" } });
    expect(l.warnings.some((w) => w.includes('copy "c1"') && w.includes("nope"))).toBe(true);
    expect(l.order).toContain("eq3");
  });
});
```

- [ ] **Step 2–4:** run (FAIL), implement, run (PASS), `tsc`. Note `layoutSpec`'s early-return in `render/index.ts` (`isEmptyOverrides`) already keys on the whole override object once `isEmptyOverrides`/`overridesKey` know the new fields.
- [ ] **Step 5: Commit** `… -m "Layout overrides: a math element's current TeX (and its tween), and cloned elements (formula morph, Task 4)"` and push.

---

### Task 5: Planner — `morph.tex`, the `copy` verb, scene state

**Files:**
- Modify: `src/spec/types.ts` (`MorphArgs.tex?: string`; `CopyArgs { target: string; as?: string }`; `Command.copy?: CopyArgs`)
- Modify: `src/spec/schema.ts` (`morph.tex` property + description sentence; `copy` command property; verb list in commandSchema.description; `ACTION_VERBS`; semantic check "exactly one of to/stretch/reset/tex")
- Modify: `src/render/plan.ts` (`PlanStep` morph gains `texItems?: { id: string; from: string; to: string }[]`; new step `{ kind: "copy"; ids: string[] }`; `SceneState.tex: Record<string, string>`, `SceneState.copies: Record<string, string>`; `INITIAL_STATE`; `pushStep` snapshots both; `currentOverrides()` and `ghostOverrides()` include `math` (every tex entry, `{tex}` only) and `copies`; `PlanOptions.mathOf?: (id: string) => string | null`; `ACTION_KEYS`; the morph branch's fourth mode; the copy branch)
- Modify: `src/lint/lint.ts` (`ACTION_KEYS`), `src/llm/subtitles.ts` (verb list gains `"copy"`)
- Modify: `src/render/index.ts` (`planOptionsFor` returns `mathOf: (id) => the tex of a math element (after normalizeSpec — read `layout`? no: read `spec.elements` where `type === "math"` and `tex` is a string) `)
- Test: `tests/formula-plan.test.ts`

Planner rules:
- `morph` with `tex`: modes count includes `tex`; for each target id: `const cur = tex[id] ?? opts.mathOf?.(copies-resolved id)`; if `cur === null/undefined` → warning `morph "<id>": not a math element — tex needs one` and skip that id; else `texItems.push({ id, from: cur, to: cmd.morph.tex })`, `tex[id] = cmd.morph.tex`. Push `{ kind: "morph", items: [], texItems, seconds, easing, relayout: true, ...upd }`; `relayoutBoxes()`. (A morph with `tex` never carries `items`; the player's morph case treats an empty `items` with `texItems` as a pure relayout tween.) `mathOf` must resolve copies: the planner keeps `copies` state, so `const srcOf = (id) => copies[id] ? srcOf(copies[id]) : id` and `opts.mathOf(srcOf(id))`.
- `copy: {target, as}`: `resolveIds([target])` must be exactly one known id; `as` default `<id>_copy`, `_copy_2`, …; a taken `as` warns and skips; a minted id or a template id (not in `opts.copyable?` — simplest: `opts.mathOf`-independent: refuse when `mintedBoxes.has(id)` or when `opts.isElement?.(id) === false`; add `PlanOptions.isElement?: (id: string) => boolean` from `planOptionsFor` = `spec.elements.some(e => e.id === id) || copies-resolved`). Then `copies[as] = id`, `known.add(as)`, `mentioned.add(as)`, `makeVisible([as])`, `pushStep({ kind: "copy", ids: [as] })`, `relayoutBoxes()` — the copy's box comes from the copies-aware layout (`bboxesFor(params, currentOverrides())`), so `boxOf(as)` works for every later verb. The copy's tex state: `tex[as] = tex[id] ?? undefined` (inherit the source's current tex if it has one).

- [ ] **Step 1: Tests**

```ts
// tests/formula-plan.test.ts
import { describe, expect, test } from "vitest";
import { planCommands, type PlanStep } from "../src/render/plan";

const box = { x: 100, y: 100, w: 200, h: 40 };
const opts = { bboxOf: () => box, mathOf: (id: string) => (id === "eq" ? "2x + 3 = 11" : null), isElement: (id: string) => ["eq", "n"].includes(id), bboxesFor: () => () => box };

describe("morph.tex", () => {
  test("a math element morphs to new TeX: a relayout morph step with texItems and tex state; a second morph starts from the first's result", () => {
    const plan = planCommands([{ draw: ["eq"] }, { morph: { target: "eq", tex: "2x = 8" } }, { morph: { target: "eq", tex: "x = 4" } }], ["eq"], opts);
    expect(plan.warnings).toEqual([]);
    const s1 = plan.steps[1] as Extract<PlanStep, { kind: "morph" }>;
    expect(s1.relayout).toBe(true);
    expect(s1.items).toEqual([]);
    expect(s1.texItems).toEqual([{ id: "eq", from: "2x + 3 = 11", to: "2x = 8" }]);
    expect(plan.states[1].tex).toEqual({ eq: "2x = 8" });
    expect((plan.steps[2] as Extract<PlanStep, { kind: "morph" }>).texItems).toEqual([{ id: "eq", from: "2x = 8", to: "x = 4" }]);
  });
  test("tex on a non-math target warns and skips; tex with to is refused", () => {
    const plan = planCommands([{ draw: ["n"] }, { morph: { target: "n", tex: "x" } }, { morph: { target: "eq", tex: "x", to: { ref: "n" } } }], ["eq", "n"], opts);
    expect(plan.warnings).toContain('morph "n": not a math element — tex needs one');
    expect(plan.warnings.some((w) => w.includes("exactly one of"))).toBe(true);
    expect(plan.steps.filter((s) => s.kind === "morph")).toHaveLength(0);
  });
});

describe("copy", () => {
  test("copy mints a clone: copies state, default name, visible, a copy step; the clone can be moved and tex-morphed", () => {
    const plan = planCommands([{ draw: ["eq"] }, { copy: { target: "eq" } }, { move: { target: "eq_copy", by: [0, -80] } }, { morph: { target: "eq_copy", tex: "2x = 8" } }], ["eq"], opts);
    expect(plan.warnings).toEqual([]);
    expect(plan.steps[1]).toMatchObject({ kind: "copy", ids: ["eq_copy"] });
    expect(plan.states[1].copies).toEqual({ eq_copy: "eq" });
    expect(plan.states[1].visible).toContain("eq_copy");
    expect(plan.states[2].offsets.eq_copy).toEqual([0, -80]);
    expect((plan.steps[3] as Extract<PlanStep, { kind: "morph" }>).texItems).toEqual([{ id: "eq_copy", from: "2x + 3 = 11", to: "2x = 8" }]);
    expect(plan.states[3].tex).toEqual({ eq_copy: "2x = 8" });
    expect(plan.states[3].copies).toEqual({ eq_copy: "eq" });
  });
  test("as names the copy; a taken name, an unknown target and a template id are refused", () => {
    const plan = planCommands([{ draw: ["eq", "n"] }, { copy: { target: "eq", as: "line2" } }, { copy: { target: "eq", as: "n" } }, { copy: { target: "ghost" } }, { copy: { target: "tpl" } }], ["eq", "n", "tpl"], opts);
    expect(plan.states[1].copies).toEqual({ line2: "eq" });
    expect(plan.warnings).toEqual(expect.arrayContaining([expect.stringContaining('copy: "n" is already an element'), expect.stringContaining('copy target "ghost"'), expect.stringContaining('copy target "tpl"')]));
  });
  test("a second unnamed copy of the same element is _copy_2", () => {
    const plan = planCommands([{ draw: ["eq"] }, { copy: { target: "eq" } }, { copy: { target: "eq" } }], ["eq"], opts);
    expect(Object.keys(plan.states[2].copies)).toEqual(["eq_copy", "eq_copy_2"]);
  });
});
```

- [ ] **Step 2–4:** run (FAIL), implement (all seven verb sites for `copy`; `MorphArgs.tex`; the schema's semantic check), run the new file plus `tests/morph.test.ts tests/plan.test.ts tests/relayout-plan.test.ts tests/ghost.test.ts tests/subtitles*.test.ts tests/*schema*.test.ts` (PASS), `tsc`.
- [ ] **Step 5: Commit** `… -m "Planner: morph.tex on math elements, the copy verb, tex and copies in the scene state and the layout key (formula morph, Task 5)"` and push.

---

### Task 6: Player and render plumbing

**Files:**
- Modify: `src/render/player.ts` (`overridesOf` takes the scene's `tex` and `copies`; `relayoutTween`'s `frameAt` may return `math`; the morph case with `texItems`; the `copy` step; `frameScene` unchanged)
- Modify: `src/render/index.ts` (`planOptionsFor` gains `mathOf`, `isElement`; nothing else — `layoutFor(params, cache, elements, overrides)` already passes any override to `layoutSpec`)
- Test: `tests/formula-player.test.ts`

Player rules:
- `overridesOf(offsets, turns, shapes, tex, copies, frameMath?)`: poses/shapes as today (restricted to sources); `math` = every `tex` entry as `{tex}`, overlaid by `frameMath` entries; `copies` as is; undefined only when all four are empty.
- `applyKey(scene)` passes `scene.tex`, `scene.copies`.
- morph case: `if ((step.relayout || step.texItems) && this.reprojector) return this.relayoutTween(index, step, before, signal, (e) => ({ shapes: morphFrame(step.items, before, e), math: Object.fromEntries((step.texItems ?? []).map((it) => [it.id, { tex: it.to, from: it.from, t: e }])) }))`. Without a reprojector (headless): `waitScaled(step.seconds * 1000)` when `items` is empty (nothing to tween through handles), else the handle path as today.
- `relayoutTween`: `frameAt` return type gains `math?: Record<string, { tex: string; from?: string; t?: number }>`; the frame's overrides come from `this.overridesOf(offsets, turns, shapes, before.tex, before.copies, f.math)`.
- animate case and previews: pass `before.tex`/`before.copies` (scene's) to `overridesOf`.
- `case "copy"`: `await this.narrationBarrier?.()` as other non-speak steps do (mirror `show`'s handling of narration); then `this.applyKey(after); this.applyScene(after)`; with no reprojector, nothing to show (the id has no handle) — return.
- The exporter and `paintedLayout` need nothing new.

- [ ] **Step 1: Tests** (stub reprojector as in `tests/relayout-player.test.ts`)

```ts
// tests/formula-player.test.ts — same StubSpeech/stub() helpers as tests/relayout-player.test.ts (copy them)
describe("formula morph in the player", () => {
  test("a tex morph tweens with math.t from 0 to 1 in the frame overrides and commits once with the new tex", async () => {
    const plan = planCommands([{ draw: ["eq"] }, { morph: { target: "eq", tex: "2x = 8", duration: 0.1 } }], ["eq"], { bboxOf: () => box, mathOf: () => "2x + 3 = 11", isElement: () => true, bboxesFor: () => () => box });
    const { rp, frames, commits } = stub();
    const player = new Player(plan, new Map(), new StubSpeech(), null, { mode: "silent" });
    player.reprojector = rp;
    await player.play();
    const ts = frames.map((f) => (f.overrides as { math: { eq: { t: number; from: string; tex: string } } }).math.eq);
    expect(ts[0].from).toBe("2x + 3 = 11");
    expect(ts[ts.length - 1].t).toBeCloseTo(1, 5);
    expect(Math.min(...ts.map((x) => x.t))).toBeLessThan(0.5);
    expect(commits).toHaveLength(1);
    expect((commits[0].overrides as { math: { eq: { tex: string; t?: number } } }).math.eq).toEqual({ tex: "2x = 8" });
  });
  test("a copy step commits the boundary key (the copy in it) and shows the id; a scrub back drops it", () => {
    const plan = planCommands([{ draw: ["eq"] }, { copy: { target: "eq" } }], ["eq"], { bboxOf: () => box, isElement: () => true, bboxesFor: () => () => box });
    const { rp, commits } = stub();
    const player = new Player(plan, new Map(), new StubSpeech(), null, { mode: "silent" });
    player.reprojector = rp;
    player.renderUpTo(2);
    expect((commits[0].overrides as { copies: Record<string, string> }).copies).toEqual({ eq_copy: "eq" });
    player.renderUpTo(1);
    expect(commits[1].overrides).toBeUndefined();
  });
});
```

- [ ] **Step 2–4:** run (FAIL), implement, run with `tests/relayout-player.test.ts tests/animate.test.ts tests/preview-params.test.ts tests/morph.test.ts` (PASS), `tsc`, `npm run build`.
- [ ] **Step 5: Commit** `… -m "Player: tex morphs tween through the reprojector, copies and tex in the layout key, the copy step (formula morph, Task 6)"` and push.

---

### Task 7: Parametric curve

**Files:**
- Modify: `src/spec/types.ts` (`x_expr?`, `y_expr?`, `t_from?`, `t_to?` on `SpecElement`), `src/spec/schema.ts` (four properties, one sentence each; semantic check: a curve has `expr` or both `x_expr` and `y_expr`, never both)
- Modify: `src/layout/curves.ts` (`sampleParametric(xExpr, yExpr, t0, t1, vars)`), `src/layout/tier2.ts` (`sampleCurveDomain` branch; `ctx.parametric: Set<string>`; `resolvePointDomain` (intersection_of, on) and `regionDrawable` warn `curve "<id>" is parametric, not a function of x — <what> skipped`)
- Test: `tests/parametric-curve.test.ts`

- [ ] **Step 1: Tests**: a unit circle `x_expr: "cos(t)"`, `y_expr: "sin(t)"`, `t_from: 0`, `t_to: 6.2832` in a domain `[-1.5, 1.5]²` has 61 samples all at radius 1 (domain; read `layout` via the drawable's logical points mapped back — or test `sampleParametric` directly for the radius and `layoutSpec` for the drawable's existence); `bind: {t_to: "s"}` with `vars: {s: 3.14}` yields a half circle (last sample near (−1, 0)); a `point.at.on` the circle warns "parametric"; validation refuses `expr` together with `x_expr`.
- [ ] **Step 2–4:** run, implement, run with `tests/vars-layout.test.ts tests/curves*.test.ts`, `tsc`.
- [ ] **Step 5: Commit** `… -m "Parametric curves: x_expr/y_expr in t over t_from–t_to, vars readable (formula morph, Task 7)"` and push.

---

### Task 8: Prompt, three bundled examples, gates, prompt-size re-pin

**Files:**
- Modify: `src/llm/prompts/compiler-v1.md` — (a) the verb list in "Each command sets ONE action verb" gains `copy`; (b) the `morph` bullet gains: ``A `math` element morphs into a NEW FORMULA: `{"morph": {"target": "eq", "tex": "2x = 8"}}` — like terms glide to their new place, the rest fades out and in; write the whole new formula.``; (c) a `copy` line after `keep`: ``- `copy`: `{"copy": {"target": "eq", "as": "eq2"}, "speak": "Keep the line and work on a copy."}` — a full clone of an element, in place, that you then `move` and `morph`: the derivation idiom is copy the line, move the copy down, morph its TeX (`keep` is the choice when the original should fade instead).``; (d) freehand rule 5 (math) gains: ``Colour terms by role with `"colors": {"x": "#2f6b8f", "\\Delta C": "#b5482e"}` — a TeX snippet per colour, every occurrence, kept through a morph.``; (e) the tier-2 bullet's curve sentence gains: ``a curve may be parametric — `"x_expr": "cos(t)", "y_expr": "sin(t)", "t_from": 0, "t_to": 6.28` (vars readable; bind `t_to` to a var and animate it to draw the curve progressively).``
- Modify: `src/examples.json` (append three examples, spec §4 — write them fully; every request a question; titles drawn first; narrated draws; the derivation example uses `copy` + `move` + `morph.tex` twice; the ICER example uses `colors` on both sides and one `morph.tex`; the circle example uses a parametric curve with `bind: {t_to: "s"}`, `vars: {s: 0.01}`, an `animate: {s: 6.28}` and a `math` label `(\cos t, \sin t)`)
- Modify: `tests/prompt-size.test.ts` (re-pin `BASELINE_SYSTEM_CHARS`, and `BASELINE_SCHEMA_CHARS` if the schema ceiling is exceeded, with a dated note naming what grew)
- Modify: `tests/examples.test.ts` — the gate's `planCommands` options already spread `planOptionsFor(spec, layout)` (which now carries `mathOf`/`isElement`); add to the "every var value" test's sibling a test that every `morph.tex` boundary lays out cleanly: for each morph command with `tex`, `layoutSpec(spec, undefined, { math: { [target]: { tex } } })` (accumulating per id, and `copies` accumulated from `copy` commands) has no warnings and no error issues.
- Test: `tests/formula-prompt.test.ts` — the prompt names `morph.tex`, `copy`, `colors`, `x_expr`; the three examples exist by request text and use the machinery (plan them with `planOptionsFor` as `tests/vars-prompt.test.ts` does: the derivation's plan has two `morph` steps with `texItems` and two `copy` steps; the ICER plan has one; the circle's plan has an `animate` on `vars.s`).

- [ ] Steps: write the prompt test (FAIL), edit the prompt, write the examples (iterate until `npx vitest run tests/examples.test.ts` is clean — labels off strokes, nothing outside the canvas), extend the gate, re-pin the budget, run `tests/formula-prompt.test.ts tests/examples.test.ts tests/prompt-size.test.ts tests/fewshots.test.ts tests/vars-prompt.test.ts`, `tsc`.
- [ ] **Commit** `… -m "Prompt: morph.tex, copy, colors and parametric curves; three bundled examples; the gate lays out every morph boundary (formula morph, Task 8)"` and push.

---

### Task 9: Docs, ledger, smoke, merge

- [ ] `ROADMAP.md`: `## Formula morph, term colours, copy and parametric curves (the manim round, part 2) — done 2026-09-10` after the part-1 section: what shipped (the five things), the mechanism in three sentences, "Deliberately not done" from the design's §6, and the round-2b note.
- [ ] `NOTES.md`: in the 2026-09-10 manim entry, mark the part-2/part-3 rows "Done, part 2".
- [ ] `docs/superpowers/plans/2026-09-10-formula-morph-ledger.md`: numbers before/after, every ruling, review findings and fixes.
- [ ] `docs/superpowers/plans/2026-09-10-formula-morph-smoke.md`: one section per example (what to load, what to watch: the `3` fading and the `11` becoming `8` while `2x =` glides; the deltas forming with colours kept; the circle drawing itself), a scrub across a morph, an export.
- [ ] Full verification: `npx vitest run`, `npx tsc --noEmit`, `npm run build`, `npm run build:engine`.
- [ ] Commit, push the branch. The merge to main is a fast-forward push (`git push origin manim-part2:main`) that the auto-mode classifier blocks — Hans says "push"; report that.

---

## Self-review

- **Spec coverage:** §2.1 relayout mechanism → Tasks 4, 5, 6; §2.2 token identity → 1; §2.3 matcher/tween → 2, 3; §2.4 colours → 2, 3; §2.5 copy → 4, 5, 6; §2.6 parametric → 7; §2.7 prompt → 8; §3 tests → each task; §4 examples → 8; §5 order matches.
- **Placeholders:** the two "adjust to the observed count" spots in Tasks 1 and 3 are deliberate — the exact MathJax reading order and the number of unmatched shapes are facts to observe once, then pin with a comment; everything else is spelled out.
- **Type consistency:** `MathToken`/`MathOutline` (engines.ts) used by math-morph.ts and math.ts; `LayoutOverrides.math/copies` (posed.ts) used by tier2, plan, player; `PlanStep` morph `texItems` and the `copy` step used by the player; `PlanOptions.mathOf`/`isElement` provided by `planOptionsFor` and consumed by the planner; `overridesOf`'s new parameters consistent across the player's call sites.
