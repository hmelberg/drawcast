# Curves, Trees and Formulas Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Three new ways to answer on the figure — fill in a decision tree's numbers (and pick the best branch), fill the blanks of a formula (tiles, typed numbers, typed expressions checked by value), and move or turn a supply/demand curve to predict a tax, subsidy, shift or elasticity change.

**Architecture:** Each form is an `ask` whose structure says what it takes: `blanks`/`pick` on a decision-tree cast, `on` a math element containing `\blank{…}`, `on` a supply/demand curve with `predict`. Pure modules hold all arithmetic (`src/tree/blanks.ts`, `src/formula/expr.ts`, `src/formula/blanks.ts`, `src/guess/market.ts`); the player gets one ask runner per new form (or reuses `guessAsk` / `cardsAsk`), and the UI gets a tree gate and a formula gate beside the existing guess and cards gates.

**Tech Stack:** TypeScript, vitest, MathJax 4 (already loaded), the existing guess/cards/number-edit infrastructure.

**Spec:** `docs/superpowers/specs/2026-10-03-curves-trees-formulas-design.md` (read it with this plan; §-references below point into it). Background: `docs/superpowers/specs/2026-10-01-guess-and-reveal-design.md`, `docs/superpowers/specs/2026-10-02-more-ways-to-answer-design.md` (§15 as built).

## Global Constraints

- Every bundled example lints with zero warnings (`tests/examples.test.ts`) and passes `tests/script-roundtrip.test.ts`.
- Prompt-size pins in `tests/prompt-size.test.ts` move once, in Task 14.
- Guess colour is `GUESS_COLOR` (`#3f6fb5`, `src/guess/marks.ts`); misses use the ghost/gap vocabulary of rounds 1–3.
- Interaction happens on the figure; never open the tray.
- Canvas text is short (a word or three); the voice says the sentence.
- Movies never wait: every form has a demonstration path when `autoAnswers` is set or no gate is attached.
- Browser checks run MUTED: chrome-devtools initScript stubbing `speechSynthesis` and `AudioContext`; after any HMR reload, re-navigate with the initScript.
- Run tests with `npx vitest run <file>`; the full suite with `npx vitest run`; types with `npx tsc --noEmit`.
- Commit after each task, message ending with:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01A1vsD5SQX5gKYDo4aucaMp
  ```

## Review Focus

1. **A typed expression with a letter the truth does not have** (`pi d^2/4` against `pi r^2`): must be judged wrong, not crash or count as right — `equivalent` samples the union of both expressions' letters. Pinned in Task 6.
2. **A blank whose truth is undefined at some sample points** (`sqrt(x-2)` sampled at x = 0.5): skip those points, require ≥ 3 defined agreeing points, else fall back to exact comparison. Pinned in Task 6.
3. **A tree blank typed with a comma decimal or a currency sign** ("5,8", "£300"): parsed by `parseBlankNumber` (comma → dot, currency and spaces stripped), never rejected as NaN. Pinned in Task 3.
4. **A market question whose next animate does not move the asked curve** (`on: demand_curve`, `animate: {"tax.amount": 20}` on a seller tax): lint error, and the player falls back to asking nothing rather than judging against an unchanged curve. Pinned in Task 12.
5. **Scrubbing back over an answered blank/formula/market ask**: fills, `answers` and market marks end with their owner (`endGuessMarksFor`), the formula shows empty boxes again. Pinned in Tasks 4, 9, 12 (player tests seek backwards).

---

## File map

| File | Responsibility |
|---|---|
| `src/spec/types.ts`, `src/spec/schema.ts` | New ask fields `blanks`, `pick`, `work`, `check`, `others`, `form`; tree node `work`; math element `fills` |
| `src/render/plan.ts` | Ask step carries `tree`, `formula` and `check`; plan visibility after each form |
| `src/scenes/decision_tree/layout.ts` | `answers` param (part id → drawn text); node `work` |
| `src/tree/blanks.ts` (new) | Blank truths, labels, working lines, scoring, pick truth — pure |
| `src/ui/tree-gate.ts` (new) | Number fields over blanks; branch taps for pick |
| `src/formula/expr.ts` (new) | AsciiMath-style parser → AST; evaluate; AST → TeX; TeX → AST; `equivalent`, `exactEqual` |
| `src/formula/blanks.ts` (new) | `\blank` extraction/marking, fills, scoring of tiles and typed answers — pure |
| `src/layout/math.ts`, `src/layout/layout.ts` | Draw blank boxes, keep fills hidden or show `fills` |
| `src/spec/cards.ts`, `src/cards/model.ts` | Cards mode `fill` (tiles into formula boxes) |
| `src/spec/expand.ts` | Expand a formula ask's `others` into a tiles `cards` element |
| `src/ui/formula-gate.ts` (new) | Typed field over a blank with live preview and symbol keys |
| `src/guess/market.ts` (new) | Market handle: gaps from (s, k), truth from end params, shape/direction, why-sentences, implied equilibrium — pure |
| `src/guess/handles.ts`, `marks.ts`, `score.ts` | Kind `market` wired into setup, gesture, marks, vars |
| `src/render/player.ts`, `src/render/index.ts`, `src/ui/controls.ts` | `treeAsk`, `formulaAsk`, market truth/carry; runtime hooks; gate routing |
| `src/lint/lint.ts` | `lintTreeAsk`, `lintFormulaAsk`, market predict checks |
| `src/llm/tags.ts`, `src/llm/prompts/compiler-v1.md`, `.claude/skills/drawcast/references/rule-card.md` | Guidance |
| `src/examples.json` | 8 examples |

---

### Task 1: Ask fields, schema and plan step

**Files:**
- Modify: `src/spec/types.ts` (AskArgs ~line 862–937; TreeNode lives in `src/scenes/decision_tree/layout.ts`; SpecElement math fields near `tex`)
- Modify: `src/spec/schema.ts` (the ask object's properties; math element `fills`)
- Modify: `src/render/plan.ts` (ask PlanStep type ~line 105–125; the ask build ~line 1343–1410)
- Test: `tests/ask-round4-fields.test.ts` (new)

**Interfaces:**
- Produces (types.ts, AskArgs):
  ```ts
  /** Tree (spec 2026-10-03 §4): the tree parts the viewer fills in —
   *  value_<node>, branchlabel_<parent>_<child>, effect_<node>, cost_<node>. */
  blanks?: string[];
  /** Tree: the decision node whose best branch the viewer taps. */
  pick?: string;
  /** Tree: working lines under wrong blanks (default), "all", or false. */
  work?: "all" | false;
  /** Market guess: what "right" means — direction, shape (default), size. */
  check?: "direction" | "shape" | "size";
  /** Formula: wrong tiles; the right contents are always tiles. */
  others?: string[];
  /** Formula, typed: "exact" compares the written form, not the value. */
  form?: "exact";
  ```
- Produces (SpecElement): `fills?: (string | null)[]` (math; internal, written by the player through element patches) — documented "internal: the answer shown in each `\blank` box".
- Produces (plan.ts ask PlanStep):
  ```ts
  tree?: { blanks: string[]; pick?: string; work?: "all" | false };
  formula?: string;          // the math element id
  check?: "direction" | "shape" | "size";
  others?: string[];
  form?: "exact";
  ```

- [ ] **Step 1: Write the failing test**

```ts
// tests/ask-round4-fields.test.ts
import { describe, expect, test } from "vitest";
import { validateSpec } from "../src/spec/schema";
import { planCommands } from "../src/render/plan";

describe("round 4 ask fields", () => {
  test("validate", () => {
    const spec = {
      commands: [
        { ask: { question: "EV?", blanks: ["value_treat"], pick: "start", work: "all", store: "e" } },
        { ask: { question: "Box?", on: "area", others: ["r", "2r"], form: "exact" } },
        { ask: { question: "Tax?", on: "supply_curve", predict: true, check: "size" } },
      ],
      elements: [{ id: "area", type: "math", tex: "A = \\pi \\blank{r^2}", fills: [null] }],
    };
    expect(validateSpec(spec as never).ok).toBe(true);
  });

  test("bad values are rejected", () => {
    const bad = { commands: [{ ask: { question: "x", check: "nearly" } }] };
    expect(validateSpec(bad as never).ok).toBe(false);
  });

  test("plan: a tree ask carries its blanks and pick", () => {
    const plan = planCommands([{ ask: { question: "EV?", blanks: ["value_treat"], pick: "start" } }] as never, ["value_treat"], {});
    const step = plan.steps[0] as { kind: string; tree?: { blanks: string[]; pick?: string } };
    expect(step.tree).toEqual({ blanks: ["value_treat"], pick: "start" });
  });

  test("plan: a formula ask names its element", () => {
    const plan = planCommands([{ ask: { question: "Box?", on: "area", others: ["r"] } }] as never, ["area"], { formulaFor: (id: string) => (id === "area" ? { blanks: 1 } : null) } as never);
    const step = plan.steps[0] as { formula?: string; others?: string[] };
    expect(step.formula).toBe("area");
    expect(step.others).toEqual(["r"]);
  });
});
```

- [ ] **Step 2: Run it — expect FAIL** (`npx vitest run tests/ask-round4-fields.test.ts`: unknown properties / `step.tree` undefined).

- [ ] **Step 3: Implement**
  - types.ts: add the AskArgs fields above (doc comments as shown) after `judge`.
  - schema.ts: add to the ask schema: `blanks: array of string (minItems 1)`, `pick: string`, `work: enum ["all"] or const false`, `check: enum ["direction","shape","size"]`, `others: array of string`, `form: const "exact"`. Add `fills: array of (string|null)` to the math element's allowed fields. Follow the file's existing pattern for optional fields (search for `"budget"` and copy its shape).
  - plan.ts:
    - Add a planner option beside `cardsFor`: `formulaFor?: (id: string) => { blanks: number } | null;`.
    - In the ask build, BEFORE the `cardSet` lookup: `const formula = oneOn !== undefined ? (opts.formulaFor?.(oneOn) ?? null) : null;`. When `formula` is non-null, skip the guess branch (`guess` stays undefined) — but keep the cards lookup: Task 8 makes `cardsFor(mathId)` return the tiles.
    - Push onto the step:
      ```ts
      ...(cmd.ask.blanks !== undefined || cmd.ask.pick !== undefined
        ? { tree: { blanks: cmd.ask.blanks ?? [], ...(cmd.ask.pick !== undefined ? { pick: cmd.ask.pick } : {}), ...(cmd.ask.work !== undefined ? { work: cmd.ask.work } : {}) }, tolerance: cmd.ask.tolerance ?? 0.02 }
        : {}),
      ...(formula && oneOn !== undefined ? { formula: oneOn, tolerance: cmd.ask.tolerance ?? 0.02, ...(cmd.ask.others ? { others: cmd.ask.others } : {}), ...(cmd.ask.form ? { form: cmd.ask.form } : {}) } : {}),
      ...(cmd.ask.check !== undefined ? { check: cmd.ask.check } : {}),
      ```
    - A tree ask with `on` other than `"tree"` must not reach the guess branch: guard the existing `else if (cmd.ask.on !== undefined)` with `&& cmd.ask.blanks === undefined && cmd.ask.pick === undefined`, and treat `on: "tree"` as no `on`.

- [ ] **Step 4: Run the test — expect PASS.** Run `npx tsc --noEmit` and `npx vitest run tests/guess-player.test.ts tests/cards.test.ts` (no regressions).

- [ ] **Step 5: Commit** — `git add src/spec/types.ts src/spec/schema.ts src/render/plan.ts tests/ask-round4-fields.test.ts && git commit -m "Ask fields for trees, formulas and market checks"`

---

### Task 2: The tree draws `answers` and node `work`

**Files:**
- Modify: `src/scenes/decision_tree/layout.ts` (`DecisionTreeParams` ~line 52; `TreeNode` ~line 30; `wrap()` ~line 108–135; `terminalTexts`; `branchText`)
- Modify: `src/scenes/decision_tree/manifest.json` (document `work` on nodes; `answers` stays undocumented — internal)
- Test: `tests/decision-tree-answers.test.ts` (new)

**Interfaces:**
- Produces: `DecisionTreeParams.answers?: Record<string, string>` — part id (`value_<id>`, `branchlabel_<p>_<c>`, `effect_<id>`, `cost_<id>`) → the text drawn for that number. For `branchlabel_…` only the probability part is replaced (the branch's name stays). `TreeNode.work?: string`.

- [ ] **Step 1: Failing test**

```ts
// tests/decision-tree-answers.test.ts
import { describe, expect, test } from "vitest";
import { layoutDecisionTree } from "../src/scenes/decision_tree/layout";

const root = {
  id: "start", type: "decision", label: "Choose",
  children: [
    { label: "Treat", node: { id: "treat", type: "chance", label: "", children: [
      { label: "Cured", probability: 0.3, node: { id: "cured", type: "terminal", label: "", payoff: 10 } },
      { label: "Not", node: { id: "not", type: "terminal", label: "", payoff: 4 } },
    ] } },
    { label: "Wait", node: { id: "wait", type: "terminal", label: "", payoff: 5 } },
  ],
};

const textOf = (l: ReturnType<typeof layoutDecisionTree>, id: string): string | undefined => {
  const label = l.labels?.find((x: { id: string }) => x.id === id) as { text?: string } | undefined;
  if (label?.text !== undefined) return label.text;
  const d = l.drawables.find((x: { id: string }) => x.id === id) as { text?: string } | undefined;
  return d?.text;
};

describe("answers", () => {
  test("a blank value shows ?", () => {
    const l = layoutDecisionTree({ root, rollback: true, answers: { value_treat: "?" } } as never);
    expect(textOf(l, "value_treat")).toBe("?");
  });
  test("a blank probability keeps the branch name", () => {
    const l = layoutDecisionTree({ root, rollback: true, answers: { branchlabel_treat_cured: "?" } } as never);
    expect(textOf(l, "branchlabel_treat_cured")).toMatch(/Cured/);
    expect(textOf(l, "branchlabel_treat_cured")).toMatch(/\?/);
    expect(textOf(l, "branchlabel_treat_cured")).not.toMatch(/0\.3/);
  });
  test("rollback is unchanged by answers", () => {
    const a = layoutDecisionTree({ root, rollback: true } as never);
    const b = layoutDecisionTree({ root, rollback: true, answers: { value_treat: "?" } } as never);
    expect(b.values).toEqual(a.values);
  });
});
```

(If the layout's export is named differently, use the name the template's `index.ts` registers — check `src/scenes/decision_tree/index.ts`; adjust `textOf` to how `value_<id>` is emitted — `labels` requests or text drawables.)

- [ ] **Step 2: Run — FAIL.**

- [ ] **Step 3: Implement**
  - Add `answers` to `WrapCtx` (`answers: Record<string, string>`), passed from the layout entry (`params.answers ?? {}`).
  - In `wrap()`: after `value` is computed, `const over = ctx.answers[\`value_${cleanId}\`]; if (over !== undefined) value = over;`.
  - `branchText(branch, costText)` gains a third argument `pText?: string`; where it formats `branch.probability`, use `pText` when given. Call it with `ctx.answers[\`branchlabel_${parentId}_${cleanId}\`]` — `wrap` needs the parent id: add a `parentId?: string` parameter to `wrap` (the `child` closure passes `cleanId`).
  - `terminalTexts(node, branch, fmt, rolled)` gains `answers` and replaces the payoff text with `answers[\`effect_${id}\`]` and the cost text with `answers[\`cost_${id}\`]` when present.
  - `TreeNode.work?: string` — doc: "A terminal's working, shown under a wrong payoff/cost blank ('12 × £300')." No drawing yet (Task 4 draws working lines as marks).

- [ ] **Step 4: Run — PASS**; also `npx vitest run tests/decision-tree*.test.ts`.

- [ ] **Step 5: Commit** — "Decision tree: answers override drawn numbers; node work"

---

### Task 3: Tree blanks — pure arithmetic

**Files:**
- Create: `src/tree/blanks.ts`
- Test: `tests/tree-blanks.test.ts`

**Interfaces:**
- Consumes: `rollback`, `walkTree`, `nodeId` from `src/scenes/decision_tree/rollback.ts`; `TreeNode` from layout.
- Produces:
  ```ts
  export type BlankKind = "value" | "probability" | "effect" | "cost";
  export interface TreeBlank {
    part: string;          // as written in the ask
    kind: BlankKind;
    node: string;          // node id (for branchlabel: the child)
    truth: number;
    label: string;         // "Expected value of Treat", "Probability of Cured", "Payoff of Wait", "Cost of Wait"
    work: string | null;   // "0.3 × 10 + 0.7 × 4 = 5.8", a terminal's authored work, or null
    depth: number;         // for the right-to-left reveal (deepest first)
  }
  export function treeBlanks(params: DecisionTreeParams, parts: string[]): { blanks: TreeBlank[]; issues: string[] };
  export function parseBlankNumber(text: string): number | null;
  export function blankRight(b: TreeBlank, v: number | null, tolerance: number): boolean;
  export function scoreBlanks(blanks: TreeBlank[], values: (number | null)[], tolerance: number): { within: number; count: number; ok: boolean; right: boolean[] };
  export interface TreePick { node: string; options: { id: string; label: string; edge: string }[]; best: string; values: Record<string, number> }
  export function treePick(params: DecisionTreeParams, node: string): TreePick | string;
  export function encodeTreeAnswer(values: (number | null)[], pick: string | null): string;  // "5.8,;treat"
  export function decodeTreeAnswer(s: string, n: number): { values: (number | null)[]; pick: string | null } | null;
  ```

- [ ] **Step 1: Failing test**

```ts
// tests/tree-blanks.test.ts
import { describe, expect, test } from "vitest";
import { decodeTreeAnswer, encodeTreeAnswer, parseBlankNumber, scoreBlanks, treeBlanks, treePick } from "../src/tree/blanks";

const root = {
  id: "start", type: "decision", label: "Choose",
  children: [
    { label: "Treat", node: { id: "treat", type: "chance", label: "", children: [
      { label: "Cured", probability: 0.3, node: { id: "cured", type: "terminal", label: "", payoff: 10 } },
      { label: "Not", node: { id: "not", type: "terminal", label: "", payoff: 4 } },
    ] } },
    { label: "Wait", node: { id: "wait", type: "terminal", label: "", payoff: 5, work: "5 × 1" } },
  ],
};
const params = { root, rollback: true } as never;

describe("tree blanks", () => {
  test("a value blank: truth, label and working", () => {
    const { blanks, issues } = treeBlanks(params, ["value_treat"]);
    expect(issues).toEqual([]);
    expect(blanks[0].truth).toBeCloseTo(5.8);
    expect(blanks[0].label).toBe("Expected value of Treat");
    expect(blanks[0].work).toBe("0.3 × 10 + 0.7 × 4 = 5.8");
  });
  test("a filled-in probability and a terminal payoff", () => {
    const { blanks } = treeBlanks(params, ["branchlabel_treat_not", "effect_wait"]);
    expect(blanks[0].truth).toBeCloseTo(0.7);
    expect(blanks[0].kind).toBe("probability");
    expect(blanks[1].truth).toBe(5);
    expect(blanks[1].work).toBe("5 × 1");
  });
  test("unknown parts and value blanks without rollback are issues", () => {
    expect(treeBlanks(params, ["value_nope"]).issues).toHaveLength(1);
    expect(treeBlanks({ root } as never, ["value_treat"]).issues[0]).toMatch(/rollback/);
  });
  test("typed numbers: comma decimals, currency, spaces", () => {
    expect(parseBlankNumber("5,8")).toBe(5.8);
    expect(parseBlankNumber("£ 300")).toBe(300);
    expect(parseBlankNumber("1 200")).toBe(1200);
    expect(parseBlankNumber("")).toBeNull();
    expect(parseBlankNumber("abc")).toBeNull();
  });
  test("scoring: relative tolerance; probabilities within 0.01; empty is wrong", () => {
    const { blanks } = treeBlanks(params, ["value_treat", "branchlabel_treat_not"]);
    expect(scoreBlanks(blanks, [5.85, 0.705], 0.02)).toMatchObject({ within: 2, ok: true });
    expect(scoreBlanks(blanks, [6.2, null], 0.02)).toMatchObject({ within: 0, ok: false, right: [false, false] });
  });
  test("pick: the best option", () => {
    const p = treePick(params, "start");
    if (typeof p === "string") throw new Error(p);
    expect(p.best).toBe("treat");
    expect(p.options.map((o) => o.label)).toEqual(["Treat", "Wait"]);
    expect(typeof treePick(params, "treat")).toBe("string"); // not a decision
  });
  test("encoding", () => {
    expect(decodeTreeAnswer(encodeTreeAnswer([5.8, null], "treat"), 2)).toEqual({ values: [5.8, null], pick: "treat" });
  });
});
```

- [ ] **Step 2: Run — FAIL** (module missing).

- [ ] **Step 3: Implement `src/tree/blanks.ts`**

```ts
// Tree blanks (spec 2026-10-03 §4): the numbers of a decision tree the
// viewer fills in, and the best branch they pick. Pure: the truths come
// from the tree's own rollback (or, for a terminal, the number the author
// wrote), the working lines from the same rollback, so they always agree.
import { rollback, walkTree } from "../scenes/decision_tree/rollback";
import type { DecisionTreeParams, TreeNode } from "../scenes/decision_tree/layout";

export type BlankKind = "value" | "probability" | "effect" | "cost";
export interface TreeBlank { part: string; kind: BlankKind; node: string; truth: number; label: string; work: string | null; depth: number }
export interface TreePick { node: string; options: { id: string; label: string; edge: string }[]; best: string; values: Record<string, number> }

const PROB_TOLERANCE = 0.01;

/** Short numbers for working lines: up to 3 significant decimals, no float dust. */
function n(v: number): string {
  return String(Number(v.toFixed(3)));
}

interface Info { node: TreeNode; id: string; parent?: string; branchLabel?: string; depth: number; payoff?: number; cost?: number }

function index(root: TreeNode): Map<string, Info> {
  const out = new Map<string, Info>();
  const depthOf = new Map<string, number>();
  walkTree(root, (node, id, branch, parentId) => {
    const depth = parentId === undefined ? 0 : (depthOf.get(parentId) ?? 0) + 1;
    depthOf.set(id, depth);
    out.set(id, { node, id, parent: parentId, branchLabel: branch?.label, depth, payoff: node.payoff ?? branch?.payoff, cost: node.cost ?? branch?.cost });
  });
  return out;
}

export function treeBlanks(params: DecisionTreeParams, parts: string[]): { blanks: TreeBlank[]; issues: string[] } {
  const issues: string[] = [];
  const blanks: TreeBlank[] = [];
  const nodes = index(params.root);
  const rolled = rollback(params.root, params.wtp !== undefined ? { wtp: params.wtp } : {});
  const name = (id: string): string => nodes.get(id)?.branchLabel || nodes.get(id)?.node.label || id;
  for (const part of parts) {
    let m: RegExpExecArray | null;
    if ((m = /^value_(.+)$/.exec(part))) {
      const id = m[1];
      const info = nodes.get(id);
      if (!info || info.node.type === "terminal") { issues.push(`blank "${part}": no chance or decision node "${id}"`); continue; }
      if (params.rollback !== true) { issues.push(`blank "${part}": a value blank needs rollback: true`); continue; }
      const ev = rolled.ev[id];
      if (ev === undefined) { issues.push(`blank "${part}": rollback computes no value here (a payoff below is missing)`); continue; }
      const kids = info.node.children ?? [];
      const work = info.node.type === "chance"
        ? `${kids.map((b, i) => { const cid = [...nodes.values()].find((x) => x.parent === id && x.node === b.node)!.id; return `${n(rolled.p[`${id}_${cid}`] ?? 0)} × ${n(rolled.ev[cid] ?? 0)}`; }).join(" + ")} = ${n(ev)}`
        : `best of ${kids.map((b) => { const cid = [...nodes.values()].find((x) => x.parent === id && x.node === b.node)!.id; return n(rolled.ev[cid] ?? 0); }).join(", ")} = ${n(ev)}`;
      blanks.push({ part, kind: "value", node: id, truth: ev, label: `Expected value of ${name(id)}`, work, depth: info.depth });
    } else if ((m = /^branchlabel_(.+)$/.exec(part))) {
      const key = m[1];
      const p = rolled.p[key];
      const child = [...nodes.values()].find((x) => x.parent !== undefined && `${x.parent}_${x.id}` === key);
      if (p === undefined || !child) { issues.push(`blank "${part}": no chance branch "${key}" with a probability`); continue; }
      blanks.push({ part, kind: "probability", node: child.id, truth: p, label: `Probability of ${name(child.id)}`, work: null, depth: child.depth });
    } else if ((m = /^(effect|cost)_(.+)$/.exec(part))) {
      const kind = m[1] as "effect" | "cost";
      const info = nodes.get(m[2]);
      const v = kind === "effect" ? info?.payoff : info?.cost;
      if (!info || info.node.type !== "terminal" || typeof v !== "number") { issues.push(`blank "${part}": no terminal "${m[2]}" with a ${kind === "effect" ? "payoff" : "cost"}`); continue; }
      blanks.push({ part, kind, node: info.id, truth: v, label: `${kind === "effect" ? "Payoff" : "Cost"} of ${name(info.id)}`, work: info.node.work ?? null, depth: info.depth });
    } else {
      issues.push(`blank "${part}": not a tree number (value_<node>, branchlabel_<parent>_<child>, effect_<node>, cost_<node>)`);
    }
  }
  return { blanks, issues };
}

export function parseBlankNumber(text: string): number | null {
  const t = text.replace(/[\s  ]/g, "").replace(/[£$€¥%]|kr|NOK/gi, "").replace(",", ".");
  if (t === "" || !/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(t)) return null;
  return Number(t);
}

export function blankRight(b: TreeBlank, v: number | null, tolerance: number): boolean {
  if (v === null || !Number.isFinite(v)) return false;
  if (b.kind === "probability") return Math.abs(v - b.truth) <= PROB_TOLERANCE + 1e-9;
  return Math.abs(v - b.truth) <= tolerance * Math.max(Math.abs(b.truth), 1e-9) + 1e-9;
}

export function scoreBlanks(blanks: TreeBlank[], values: (number | null)[], tolerance: number) {
  const right = blanks.map((b, i) => blankRight(b, values[i] ?? null, tolerance));
  const within = right.filter(Boolean).length;
  return { within, count: blanks.length, ok: within === blanks.length, right };
}

export function treePick(params: DecisionTreeParams, node: string): TreePick | string {
  const nodes = index(params.root);
  const info = nodes.get(node);
  if (!info || info.node.type !== "decision") return `pick "${node}": not a decision node`;
  const rolled = rollback(params.root, params.wtp !== undefined ? { wtp: params.wtp } : {});
  const best = rolled.bestId[node];
  if (best === undefined) return `pick "${node}": rollback picks no best branch here`;
  const options = [...nodes.values()].filter((x) => x.parent === node).map((x) => ({ id: x.id, label: x.branchLabel ?? x.node.label, edge: `edge_${node}_${x.id}` }));
  const values: Record<string, number> = {};
  for (const o of options) values[o.id] = params.wtp !== undefined && rolled.nmb[o.id] !== undefined ? rolled.nmb[o.id] : (rolled.ev[o.id] ?? NaN);
  return { node, options, best, values };
}

export function encodeTreeAnswer(values: (number | null)[], pick: string | null): string {
  return `${values.map((v) => (v === null ? "" : String(v))).join(",")};${pick ?? ""}`;
}

export function decodeTreeAnswer(s: string, n: number): { values: (number | null)[]; pick: string | null } | null {
  const [a, b] = s.split(";");
  if (a === undefined || b === undefined) return null;
  const values = n === 0 ? [] : a.split(",").map((x) => (x === "" ? null : Number(x)));
  if (values.length !== n || values.some((v) => v !== null && !Number.isFinite(v))) return null;
  return { values, pick: b === "" ? null : b };
}
```

Check the edge id convention against `layout.ts` (`edge_<parent>_<child>` — search `edge_`) and `walkTree`'s callback order (node, id, branch, parentId). Simplify the child-id lookups with a `childrenOf(id)` helper if they read awkwardly.

- [ ] **Step 4: Run — PASS.**
- [ ] **Step 5: Commit** — "Tree blanks: truths, working lines, scoring, pick"

---

### Task 4: Tree ask in the player, runtime and gate

**Files:**
- Modify: `src/render/player.ts` (dispatch near line 2099; new `treeAsk`; a `TreeSession` type beside `CardsSession`)
- Modify: `src/render/index.ts` (`player.guess` runtime gains `tree`)
- Create: `src/ui/tree-gate.ts`
- Modify: `src/ui/controls.ts` (route `step.treeSession` to the tree gate, like `cardsSession` ~line 1195)
- Modify: `src/styles.css` (`.cs-tree-blank` ring; reuse `.cs-guess-answer`)
- Test: `tests/tree-ask-player.test.ts` (new; copy the harness style of `tests/guess-player.test.ts`)

**Interfaces:**
- Consumes: Task 2 `answers`, Task 3 module.
- Produces:
  ```ts
  // player.ts
  export interface TreeSession {
    blanks: TreeBlank[];
    pick: TreePick | null;
    /** Each blank's box (logical), for laying the number fields. */
    boxOf(part: string): BBox | null;
    /** Paint typed values (null = "?") into the tree. */
    show(values: (number | null)[]): void;
    /** Branch hit areas for pick: option id → its edge's points (logical). */
    edges: Record<string, Pt[]>;
  }
  // index.ts runtime
  player.guess.tree = () => spec.template === "decision_tree" ? { params: spec.params as DecisionTreeParams } : null;
  ```

- [ ] **Step 1: Failing player test** — build a decision-tree spec (the root from Task 3), commands `[{draw: ["all"]}, {ask: {question: "EV?", blanks: ["value_treat"], store: "e", right: "Yes", wrong: "No: {e.work}"}}]` (use whatever `draw` form the decision-tree tests use), run the player in movie mode (no gate) and assert:
  - `vars.get("e")` is `"5.8"` and `vars.get("e.true")` is `"5.8"`;
  - `vars.get("e.work")` is `"0.3 × 10 + 0.7 × 4 = 5.8"`;
  - after the step, the painted params have no `answers` (the truth is drawn);
  - with a gate stub resolving `encodeTreeAnswer([6.5], null)`: `vars.get("e.ok")` is `"false"` and a guess mark owner `tree_<index>` holds a text whose `text` is the working line;
  - seeking back to step 0 clears the marks (`endGuessMarksFor`).

- [ ] **Step 2: Run — FAIL.**

- [ ] **Step 3: Implement**
  - Dispatch: `if (step.tree !== undefined) return this.treeAsk(index, step, before, signal);` before the `cards` line.
  - `treeAsk`:
    1. `await this.narrationBarrier()`; read the tree params as painted at `before` (`this.withVarOverrides(before.params)`); `treeBlanks(params, step.tree.blanks)`; `step.tree.pick ? treePick(params, step.tree.pick) : null`. Warn and return on issues (lint catches them earlier).
    2. `show(values)`: `rp.frame({...sceneParams, answers: Object.fromEntries(blanks.map((b, i) => [b.part, values[i] === null ? "?" : fmt(values[i], b)]))}, this.frameScene(before, visible), {revealNew: true, overrides})`. `fmt` writes probabilities with 2 decimals, others with the tree's `decimals` (default 1).
    3. Live: `await this.askGate!(signal, {...step, treeSession})` → decode. Movie: `values = blanks.map(b => b.truth)`, pick = best; type each one in with `show` at 300 ms intervals through `this.progress`.
    4. Score with `scoreBlanks(…, step.tolerance ?? 0.02)`; pick right = `pick === treePick.best`; `ok = scores.ok && (pickRight ?? true)`.
    5. `recordAnswer(index, step.store, text, ok, secs)` where text is the value of a single blank (formatted) or `"<within> of <count>"`; set vars: `<s>.true` (single blank), `<s>.<part>` / `<s>.<part>.true`, `<s>.work` (single blank's working, or the first wrong blank's), `<s>.within`, `<s>.count`; for pick: `<s>.pick`, `<s>.pick.true` (labels), `<s>.diff` (best value − chosen value, formatted). When the ask has only `pick`, `{s}` is the chosen label and `{s.true}` the best label (spec §4.3).
    6. Reveal, while the right/wrong line is spoken (`speakLine` in parallel, as `guessAsk` does): blanks sorted by `depth` descending; for each, over 300 ms, drop it from `answers` (the true number draws in). Then marks under owner `tree_${index}` via `this.effects?.setGuessMarks`: for each wrong blank (or every blank with `work: "all"`; none with `work: false`) a text mark `{at: [box.x + box.w/2, box.y - 14], text: b.work, anchor: "middle"}` and a dashed outline around the wrong number's box. For pick: when wrong, a dashed ring around the chosen edge. Register the marks' parts with `this.guessMarkParts.set(owner, [...blank parts])` so they end with the tree.
    7. `applyKey`/`applyScene(this.plan.states[index])`; right/wrong gotos as in `guessAsk`.
  - Runtime (`index.ts`): add `tree` to `player.guess` as above; `TreeSession.boxOf` reads `elementBBoxes(this.paintedLayout())`; `edges` from the painted layout's drawables `edge_<node>_<option>` points.
  - `src/ui/tree-gate.ts` (`treeGateFor(stage, hd)`, same shape as `cardsGateFor`):
    - For each blank, a dashed ring over its box (`clientPointFor`) that opens `mountNumberEdit(stage, {box, value: NaN-safe start (empty), label: b.label, onCommit})` on tap; `onCommit(text)` → `parseBlankNumber`; null → return "Type a number"; else store, `session.show(values)`, open the next blank's field (Enter moves on).
    - With one blank and no pick, committing answers (`release`); otherwise the Answer button (`cs-cardgate-pill cs-guess-answer`, bottom centre).
    - Pick: after the blanks are filled (or at once when there are none), the option edges get hover rings; a tap within 18 px of an edge's polyline picks it (and answers, unless blanks are pending).
    - Keys: Tab moves between blanks; Enter commits/answers; 1–4 pick an option.
    - Resolve `encodeTreeAnswer(values, pick)` or null on abort/skip.
  - controls.ts: `step.treeSession ? treeGate(signal, step) : step.cardsSession ? …`.
  - Self-test (`test-me.ts`) needs nothing: tree asks are authored questions only.

- [ ] **Step 4: Run** the new test, then `npx vitest run tests/guess-player.test.ts tests/cards-round3.test.ts`, `npx tsc --noEmit`.
- [ ] **Step 5: Commit** — "Tree asks: fill the blanks, pick the branch (player, gate, marks)"

---

### Task 5: Tree lint and two examples

**Files:**
- Modify: `src/lint/lint.ts` (new `lintTreeAsk(spec)`, added to the list at ~line 1222)
- Modify: `src/examples.json`; dev copies in `dev-casts/round4/` (gitignored)
- Test: `tests/tree-ask-lint.test.ts` (new)

- [ ] **Step 1: Failing test** — assert, for a tree spec:
  - `blanks` naming an unknown part → one error (rule `"guess"`), message from `treeBlanks` issues;
  - a value blank with `rollback` off → error;
  - 5 blanks → warning "more than 4 blanks";
  - a tree with 13 nodes → warning;
  - `pick` on a chance node → error;
  - `blanks` on a non-tree template → error "blanks: only a decision tree has blanks";
  - a clean ask → no issues.
- [ ] **Step 2: Run — FAIL.**
- [ ] **Step 3: Implement** `lintTreeAsk` iterating `spec.commands` (and nested `commands` the way `lintGuess` walks them — reuse its walker), calling `treeBlanks`/`treePick` with `spec.params`.
- [ ] **Step 4: Examples** (each opening says what it is about; connected narration; one quiz line):
  1. *"Treat or wait? Expected values by hand"* — a 2-option tree with one chance node; ask `blanks: ["value_treat"]` then `pick: "start"`.
  2. *"Screening tree: the missing probability"* — HE tree, `rollback: true`, `wtp`; ask `blanks: ["branchlabel_test_neg", "value_test"]` with `work: "all"`.
  Add both to `src/examples.json` with `#interactive` in their prompts; run `npx vitest run tests/examples.test.ts tests/script-roundtrip.test.ts tests/tree-ask-lint.test.ts`.
- [ ] **Step 5: Browser check (muted)** — `npm run dev`, open each example with the mute initScript, answer one wrong and one right; check the "?" boxes, the number field placement, the right-to-left reveal and the working line. Fix what you see.
- [ ] **Step 6: Commit** — "Tree asks: lint and two examples"

---

### Task 6: Expression parser — AsciiMath-style input, TeX truth, equivalence

**Files:**
- Create: `src/formula/expr.ts`
- Test: `tests/formula-expr.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type Expr =
    | { k: "num"; v: number }
    | { k: "sym"; name: string }                       // r, x_1, pi, e
    | { k: "neg"; a: Expr }
    | { k: "bin"; op: "+" | "-" | "*" | "/" | "^"; a: Expr; b: Expr }
    | { k: "fn"; name: string; a: Expr };              // sqrt, sin, cos, tan, ln, log, exp, abs
  export function parseAscii(src: string): Expr | { error: string };
  export function texToExpr(tex: string): Expr | null;   // null: outside the supported subset
  export function exprToTeX(e: Expr): string;
  export function evaluate(e: Expr, env: Record<string, number>): number;
  export function symbols(e: Expr): string[];            // free letters, excluding pi and e
  export function equivalent(a: Expr, b: Expr, opts?: { samples?: number; seed?: number }): boolean;
  export function exactEqual(a: Expr, texTruth: string): boolean;
  export function normTeX(tex: string): string;          // spaces and outer braces removed
  ```

- [ ] **Step 1: Failing test**

```ts
// tests/formula-expr.test.ts
import { describe, expect, test } from "vitest";
import { equivalent, evaluate, exactEqual, exprToTeX, normTeX, parseAscii, texToExpr, type Expr } from "../src/formula/expr";

const p = (s: string): Expr => {
  const e = parseAscii(s);
  if ("error" in e) throw new Error(e.error);
  return e;
};
const t = (s: string): Expr => {
  const e = texToExpr(s);
  if (!e) throw new Error(`no expr for ${s}`);
  return e;
};

describe("parseAscii", () => {
  test("implied multiplication and unicode", () => {
    expect(evaluate(p("2r"), { r: 3 })).toBe(6);
    expect(evaluate(p("pi r^2"), { r: 2 })).toBeCloseTo(4 * Math.PI);
    expect(evaluate(p("π·r²"), { r: 2 })).toBeCloseTo(4 * Math.PI);
    expect(evaluate(p("2(a+b)"), { a: 1, b: 2 })).toBe(6);
    expect(evaluate(p("(a+b)/2"), { a: 1, b: 3 })).toBe(2);
    expect(evaluate(p("sqrt(x)"), { x: 9 })).toBe(3);
    expect(evaluate(p("√x"), { x: 16 })).toBe(4);
    expect(evaluate(p("x^-1"), { x: 4 })).toBe(0.25);
    expect(evaluate(p("3 × 4"), {})).toBe(12);
    expect(evaluate(p("2,5"), {})).toBe(2.5); // comma decimal
  });
  test("power binds tighter than unary minus; right-associative", () => {
    expect(evaluate(p("-x^2"), { x: 3 })).toBe(-9);
    expect(evaluate(p("2^3^2"), {})).toBe(512);
  });
  test("errors are values, not throws", () => {
    expect("error" in (parseAscii("2+") as object)).toBe(true);
    expect("error" in (parseAscii("(a+b") as object)).toBe(true);
    expect("error" in (parseAscii("") as object)).toBe(true);
  });
});

describe("texToExpr", () => {
  test("the supported subset", () => {
    expect(evaluate(t("r^2"), { r: 3 })).toBe(9);
    expect(evaluate(t("\\frac{v^2}{2a}"), { v: 4, a: 2 })).toBe(4);
    expect(evaluate(t("\\sqrt{x}"), { x: 4 })).toBe(2);
    expect(evaluate(t("2\\pi r"), { r: 1 })).toBeCloseTo(2 * Math.PI);
    expect(evaluate(t("a \\cdot b"), { a: 2, b: 5 })).toBe(10);
    expect(evaluate(t("\\left(a+b\\right)^{2}"), { a: 1, b: 1 })).toBe(4);
    expect(evaluate(t("x_1 + x_2"), { x_1: 1, x_2: 2 })).toBe(3);
  });
  test("outside the subset → null", () => {
    expect(texToExpr("\\sum_{i=1}^n i")).toBeNull();
    expect(texToExpr("\\int x dx")).toBeNull();
  });
});

describe("equivalent", () => {
  test("same value, different form", () => {
    expect(equivalent(p("r*r"), t("r^2"))).toBe(true);
    expect(equivalent(p("r r"), t("r^2"))).toBe(true);
    expect(equivalent(p("(a+b)/2"), t("\\frac{a}{2}+\\frac{b}{2}"))).toBe(true);
  });
  test("different value", () => {
    expect(equivalent(p("2r"), t("r^2"))).toBe(false);
  });
  test("a letter the truth does not have is wrong (review focus 1)", () => {
    expect(equivalent(p("pi d^2/4"), t("\\pi r^2"))).toBe(false);
  });
  test("points outside the domain are skipped (review focus 2)", () => {
    expect(equivalent(p("sqrt(x-2)"), t("\\sqrt{x-2}"))).toBe(true);
    expect(equivalent(p("sqrt(x-2)"), t("\\sqrt{x-3}"))).toBe(false);
  });
});

describe("exact form", () => {
  test("printed back and compared", () => {
    expect(exprToTeX(p("pi r^2"))).toBe("\\pi r^{2}");
    expect(exactEqual(p("pi r^2"), "\\pi r^2")).toBe(true);
    expect(exactEqual(p("pi r r"), "\\pi r^2")).toBe(false);
    expect(normTeX(" { r^{2} } ")).toBe("r^2");
  });
});
```

- [ ] **Step 2: Run — FAIL.**

- [ ] **Step 3: Implement `src/formula/expr.ts`**
  - **Tokenizer** (ascii): numbers (`2,5` → 2.5 only when a comma sits between digits and is not followed by a space), identifiers (a letter, optional `_` + alnum; multi-letter words only if in `FUNCS` or `pi`/`theta`/greek names; otherwise split `ab` into `a b`), operators `+ - * / ^ ( )`, unicode `· × ⋅` → `*`, `π` → `pi`, `√` → function `sqrt` applied to the next atom, `²`/`³` → `^2`/`^3`.
  - **Parser** (recursive descent): `sum := prod (('+'|'-') prod)*`; `prod := unary (('*'|'/') unary | implicit unary)*` where implicit = next token begins an atom (number, identifier, `(`, `√`) and the previous was an atom end; `unary := '-' unary | power`; `power := atom ('^' unary)?` (right-assoc through `unary`); `atom := num | sym | fn '(' sum ')' | fn atom | '(' sum ')'`. Errors return `{error}`.
  - **texToExpr**: a second tokenizer over TeX: `\frac{A}{B}` → `A/B` as bin, `\sqrt{A}` → fn, `\pi` → sym pi, `\cdot`/`\times` → `*`, `\left(`/`\right)` → parens, `{…}` groups → parens, `^{…}`/`^x`, `x_{1}`/`x_1` → sym `x_1`, `\,`/`\;`/`\ ` → nothing. Any other control word → return null. Reuse the same parser on the resulting token stream (share the token type).
  - **exprToTeX**: canonical printing — `bin *` between a number and a symbol or two symbols prints as juxtaposition with a space (`\pi r`), `^` prints `{}` around the exponent, `/` prints `\frac{}{}`, `sqrt` prints `\sqrt{}`, `pi` prints `\pi`. Parenthesize by precedence.
  - **evaluate**: symbols from env; `pi`, `e` constants; unknown symbol → NaN.
  - **equivalent**: seeded LCG (`seed` default 7); letters = union of `symbols(a)` and `symbols(b)`; `samples` (default 5) points with each letter in [0.5, 3]; up to `samples * 4` tries to collect points where both are finite; right when ≥ 3 such points all agree within `1e-6 * max(1, |vb|)`; if fewer than 3 defined points, fall back to `exactEqual(a, exprToTeX(b))`.
  - **exactEqual(a, texTruth)**: `normTeX(exprToTeX(a)) === normTeX(exprToTeX(texToExpr(texTruth) ?? …))` when the truth converts, else `normTeX(exprToTeX(a)) === normTeX(texTruth)`. `normTeX`: strip whitespace, strip matching outer braces repeatedly, and `^{x}` → `^x` for a single-character exponent.
- [ ] **Step 4: Run — PASS.**
- [ ] **Step 5: Commit** — "Formula expressions: AsciiMath-style input, TeX truth, check by value"

---

### Task 7: `\blank` in math elements — boxes and fills

**Files:**
- Create: `src/formula/blanks.ts`
- Modify: `src/layout/math.ts` (`mathDrawables`: marks for blanks; box drawables; fill opacity)
- Modify: the call site that prepares a math element's TeX (`src/layout/layout.ts` where `liveTeX` is called for math elements — search `liveTeX(`)
- Test: `tests/formula-blanks.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // src/formula/blanks.ts
  export interface FormulaBlank { k: number; tex: string; part: string /* <id>_blank_<k> */; fill: string /* <id>_blank_<k>_fill */ }
  export function formulaBlanks(id: string, tex: string): FormulaBlank[];
  /** The TeX with each \blank{X} replaced by X (or the fill's TeX) wrapped in a nested mark, and the marks → parts. */
  export function markBlanks(id: string, tex: string, fills?: (string | null)[]): { tex: string; marks: Map<string, LiveMathPart>; filled: boolean[] };
  export function hasBlanks(tex: string): boolean;
  export function tileRight(blank: FormulaBlank, tileTeX: string): boolean;     // normTeX compare
  export function typedRight(blank: FormulaBlank, typed: string, form?: "exact", tolerance?: number): boolean;
  export function blankIsNumber(blank: FormulaBlank): boolean;
  export function blankConvertible(blank: FormulaBlank): boolean;               // texToExpr(blank.tex) !== null
  ```
  Parts in the layout: `<id>_blank_<k>` (the box; a top-level drawable id so the plan can name it) and `<id>_blank_<k>_fill` (the nested glyph group).

- [ ] **Step 1: Failing test**

```ts
// tests/formula-blanks.test.ts
import { describe, expect, test } from "vitest";
import { formulaBlanks, markBlanks, tileRight, typedRight, blankIsNumber } from "../src/formula/blanks";
import { layoutSpec } from "../src/layout/layout";
import { expandSpec } from "../src/spec/expand";

describe("formula blanks", () => {
  test("found in order, nested braces kept", () => {
    const b = formulaBlanks("area", "A = \\pi \\blank{r^{2}} + \\blank{\\frac{1}{2}}");
    expect(b.map((x) => x.tex)).toEqual(["r^{2}", "\\frac{1}{2}"]);
    expect(b[0].part).toBe("area_blank_1");
    expect(b[1].fill).toBe("area_blank_2_fill");
  });
  test("marked TeX lays out like the answer", () => {
    const m = markBlanks("area", "A = \\pi \\blank{r^2}");
    expect(m.tex).not.toMatch(/\\blank/);
    expect(m.tex).toMatch(/r\^2/);
    expect([...m.marks.values()][0].id).toBe("area_blank_1_fill");
    expect(m.filled).toEqual([false]);
  });
  test("a fill replaces the content", () => {
    const m = markBlanks("area", "A = \\pi \\blank{r^2}", ["2r"]);
    expect(m.tex).toMatch(/2r/);
    expect(m.filled).toEqual([true]);
  });
  test("judging", () => {
    const [b] = formulaBlanks("a", "\\blank{r^2}");
    expect(tileRight(b, " r^{2} ")).toBe(true);
    expect(tileRight(b, "2r")).toBe(false);
    expect(typedRight(b, "r*r")).toBe(true);
    expect(typedRight(b, "r*r", "exact")).toBe(false);
    const [n] = formulaBlanks("a", "\\blank{12}");
    expect(blankIsNumber(n)).toBe(true);
    expect(typedRight(n, "12,1", undefined, 0.02)).toBe(true);
  });
  test("layout: a box part, and the fill glyphs hidden", async () => {
    const spec = expandSpec({ elements: [{ id: "area", type: "math", tex: "A = \\pi \\blank{r^2}" }], commands: [] } as never);
    const l = layoutSpec(spec);
    expect(l.order).toContain("area_blank_1");
    // the fill group exists, nested, at opacity 0
    const area = l.drawables.find((d) => d.id === "area") as { children?: { id: string; style?: { opacity?: number } }[] };
    const fill = area.children?.find((c) => c.id === "area_blank_1_fill");
    expect(fill?.style?.opacity).toBe(0);
  });
});
```
(The layout test needs MathJax; copy the setup of `tests/math-element.test.ts` — it shows how the engine is loaded in tests.)

- [ ] **Step 2: Run — FAIL.**
- [ ] **Step 3: Implement**
  - `formulaBlanks`: scan for `\blank{` and match braces to the closing `}`; k from 1.
  - `markBlanks`: build the TeX left to right; blank k becomes `{${"\\mathord{".repeat(depth)}${content}${"}".repeat(depth)}}` with a depth that cannot collide with live-math marks: start depth at 50 + k (live math uses 1…n). `marks.set(markString, {id: fill, name: \`blank_${k}\`, live: false})`. Content = `fills?.[k-1] ?? blank.tex`. An empty fill content `""` uses `\phantom{X}` of the truth so the box keeps its size.
  - `typedRight`: number blank → `parseBlankNumber` (import from `src/tree/blanks.ts`) relative tolerance (default 0.02); else `parseAscii` → `form === "exact" ? exactEqual(e, blank.tex) : equivalent(e, texToExpr(blank.tex)!)`; false on parse error.
  - Layout: where a math element's TeX is turned into `liveTeX(...)` marks, also run `markBlanks(el.id, tex, el.fills)` when `hasBlanks`; merge the two mark maps (pass the blank-marked TeX into `liveTeX`; live-math tokens inside a blank are a lint error so they never nest). In `mathDrawables`, a part whose `name` starts with `blank_` gets: its group style `opacity: filled[k] ? 1 : 0`, colour `GUESS_COLOR` when the fill differs from the truth's TeX (a viewer's answer), ink otherwise; and after the loop, for each blank part, a box drawable:
    ```ts
    { id: `${el.id}_blank_${k}`, kind: "line", closed: true, pts: roundedRect(padded(parts[fillId], 6, minW = size * 0.6)), style: resolveStyle(el.style, { color: GUESS_COLOR, opacity: 0.9 }), drawOpts }
    ```
    returned as a TOP-LEVEL drawable (sibling of the formula group) so the plan can show/hide it and `elementBBoxes` gives its box. Use the existing rounded-rect helper the cards use (search `roundedRect` / `rectPts` in `src/layout`).
  - After the reveal the boxes go: the box parts stay in the layout, and the plan drops them from `visible` at the ask (Task 9), so `applyScene` of the step's state hides them.
- [ ] **Step 4: Run — PASS**, plus `npx vitest run tests/live-math.test.ts tests/math-element.test.ts`.
- [ ] **Step 5: Commit** — "Math blanks: boxes in the formula, fills shown or kept back"

---

### Task 8: Tiles — cards mode `fill` and the expansion

**Files:**
- Modify: `src/spec/cards.ts` (`CardsMode` adds `"fill"`; `cardsMode`; `cardsGeometry(el, scaleOf, blanksOf?)`; `cardsElements` draws `math` for tiles)
- Modify: `src/cards/model.ts` (`initialArrangement`, `drop`, `positions`, `rightCards`, `scoreCards`, `cardsMarks`, `cardsTruth`, encode/decode for `fill`)
- Modify: `src/spec/expand.ts` (`expandFormulaTiles` after `expandCardSets`)
- Modify: `src/render/index.ts` (`cardsFor` and `player.guess.cards` pass `blanksOf` from the mounted layout; a math id maps to its `<id>_tiles` cards)
- Test: `tests/cards-fill.test.ts`

**Interfaces:**
- Cards element fields (internal, set by the expansion): `fill: "<math id>"`, items `{ text: string /* TeX */, blank?: number /* 1-based */ }`.
- `cardsGeometry(el, scaleOf, blanksOf?: (mathId: string) => BBox[] | null)`: for `fill`, `binBoxes` = the blank boxes (centres `c`), `binSlot(k, 0)` = box k's centre, `truthBin[i]` = `item.blank - 1` or -1 for a wrong tile, `truth[i]` = its box centre or its home.
- Arrangement for fill: `boxes[k]` holds at most one card (dropping on a full box swaps: the old card goes home).

- [ ] **Step 1: Failing test** — mirror `tests/cards.test.ts` "sort":
  - geometry from `{id: "area_tiles", type: "cards", fill: "area", items: [{text: "r^2", blank: 1}, {text: "2r"}, {text: "d"}]}` with `blanksOf = () => [{x: 100, y: 100, w: 40, h: 30}]` → `mode === "fill"`, `truthBin` `[0, -1, -1]`;
  - drop card 1 on box 0, then card 0 on box 0 → `boxes[0]` is `[0]` and card 1 is back home;
  - `scoreCards` with `boxes: [[0]]` → `{within: 1, count: 1, ok: true}` (count = number of blanks, not tiles);
  - encode/decode round-trips;
  - `expandSpec` of a spec with the math element and the ask `{on: "area", others: ["2r", "d"]}` adds an element `area_tiles` of type `cards` with `fill: "area"` and three items, the right one first-blank-tagged; a typed-only ask (no `others`) adds nothing.
- [ ] **Step 2: Run — FAIL.**
- [ ] **Step 3: Implement**
  - `cardsMode`: `typeof el.fill === "string"` → `"fill"` (checked first).
  - Tiles are laid out in a row under the formula: the expansion sets `at: {ref: mathId, side: "below", gap: 30}` on the group, `arrange: "row"`, items shuffled with `shuffleOrder`. Card size from the TeX: width `max(56, 22 * texLength^0.8)`, height 48; `cardsElements` emits a `math` element (size 22) instead of a `text` element for each tile in fill mode.
  - Model functions: add `fill` branches mirroring `sort` with capacity 1 and score over blanks.
  - `cardsMarks` for fill: a wrong tile in a box gets a struck-through copy mark (`texts: [{at: above box, text: tile TeX as plain text, anchor: "middle"}]` plus a line through it).
  - `expandFormulaTiles(spec)`: for each ask (walk commands like `expandCardSets` does) whose `on` is a math element with blanks and `others` is set, append (once per math id) the cards element; the right items are each blank's TeX.
  - `index.ts`: `cardsFor(id)` → `cardsGeometryIn(spec, isFormulaWithTiles(id) ? \`${id}_tiles\` : id, blanksOf)` where `blanksOf(mathId) = formulaBlanks(...).map(b => bboxes.get(b.part))`.
- [ ] **Step 4: Run — PASS**, plus `tests/cards*.test.ts`.
- [ ] **Step 5: Commit** — "Cards fill mode: tiles into a formula's blanks"

---

### Task 9: Formula ask in the player, the typed field, and the reveal

**Files:**
- Modify: `src/render/player.ts` (`formulaAsk`; dispatch; `FormulaSession`)
- Modify: `src/render/index.ts` (`formulaFor` planner option; runtime `formula`)
- Create: `src/ui/formula-gate.ts`
- Modify: `src/ui/cards-gate.ts` (fill mode: HINT `"Drag a tile into each box"`; drop targets are the blank boxes)
- Modify: `src/ui/controls.ts` (route `formulaSession`)
- Modify: `src/styles.css` (`.cs-formula-field`, `.cs-formula-keys`)
- Test: `tests/formula-ask-player.test.ts`

**Interfaces:**
- ```ts
  export interface FormulaSession {
    blanks: FormulaBlank[];
    boxOf(k: number): BBox | null;
    /** Paint typed answers into the boxes (null = empty). Returns false when a text does not parse (the field marks it). */
    show(texts: (string | null)[]): boolean[];
  }
  ```
- The ask routes: tiles (`step.others`) → `cardsAsk` (cards mode fill, via `step.cards` set by the plan's `cardsFor`); otherwise → `formulaAsk` (typed numbers and expressions).

- [ ] **Step 1: Failing player test**:
  - movie mode, tiles: after the ask, `fills` of `area` equals `["r^2"]` in the painted element patch and the box part is hidden in the step's state;
  - live gate stub resolving typed `"r*r"` → `vars.get("f.ok") === "true"`, `vars.get("f")` is `"r*r"`, `vars.get("f.true")` is `"r^2"`;
  - typed `"2r"` → not ok; marks under owner `formula_<index>` contain a struck-through text `"2r"`;
  - `form: "exact"` with typed `"r*r"` → not ok;
  - seek back → the element patch is gone (boxes empty again).
- [ ] **Step 2: Run — FAIL.**
- [ ] **Step 3: Implement**
  - Plan (`index.ts` → `planCommands` option `formulaFor(id)`: the math element with blanks → `{blanks: n}`). In plan.ts, a formula ask with tiles is a cards ask (`cards: "<id>"`, Task 8 offsets) PLUS `formula: id`; without tiles it is `formula` only. After the ask, the plan makes `<id>_blank_k` boxes hidden and the formula's fills visible — the element patch `fills = truths` is applied in the player (the plan cannot patch elements), and the plan just drops the box ids from `visible` (use the same `makeHidden`/erase mechanism as `erase` commands).
  - `formulaAsk`: like `guessAsk`, with `paint(texts)` = `rp.frame(sceneParams, scene, {elements: patch(el, {fills: texts})})` using `rp.patchedElements()` as the base (follow `patchFor`'s element-replacement code for scales). Movie: type the truth in character by character (40 ms a char) for typed blanks. Score each blank with `typedRight`, record, set vars `f`, `f.true`, `f.<k>`, `f.<k>.true`, `f.within`, `f.count`. Reveal while speaking: `fills` → truths over 400 ms (swap at t = 0.5 with a fade: paint truths then raise opacity via the fill group's style — keep it simple: swap at the start of the reveal), wrong ones get a mark with the viewer's text struck through above the box (owner `formula_${index}`, parts `[id]`).
  - `cardsAsk` in fill mode: on finish, also apply `fills` = the tiles' TeX for boxes that hold a tile, then reveal `fills` = truths, and the wrong tiles glide home (existing glide).
  - `formula-gate.ts`: for each blank, a ring over its box; tap → a text field (`<input type="text" class="cs-formula-field" inputmode="text" autocapitalize="off" spellcheck=false>`) positioned like `mountNumberEdit` (reuse its positioning code: export a `placeOverBox(stage, el, box)` helper from `number-edit.ts` rather than copying). On `input`: `session.show(texts)` → preview in the box; a parse error adds class `invalid` with the error as `title`. A key row above the field (`^ √ π / ( )`) inserts at the caret. Number blanks use `mountNumberEdit` directly. Enter: next blank, or answer when it is the last/only one. Answer button when several blanks. Resolve `JSON.stringify(texts)`.
- [ ] **Step 4: Run — PASS**; `npx tsc --noEmit`.
- [ ] **Step 5: Commit** — "Formula asks: tiles, typed numbers and expressions, the reveal"

---

### Task 10: Formula lint and three examples

**Files:** `src/lint/lint.ts` (`lintFormulaAsk`), `src/examples.json`, test `tests/formula-lint.test.ts`.

- [ ] **Step 1: Failing test** — errors: a blank inside a live-math `{var}`; a symbolic blank, no `others`, and `blankConvertible` false (e.g. `\blank{\sum i}`); `others` containing the right answer (warning: "already a tile"). Warning: a math element with `\blank` that no ask fills; an ask `on` a formula without blanks ("nothing to fill"). Clean asks → none.
- [ ] **Step 2: Run — FAIL.** **Step 3: Implement.** **Step 4: Run — PASS.**
- [ ] **Step 5: Examples**
  1. *"Area of a circle"* — `A = \pi \blank{r^2}`, tiles `others: ["2r", "r", "d^2"]`.
  2. *"The missing number"* — `7 \times \blank{8} = 56`, typed number.
  3. *"The derivative of x squared"* — `\frac{d}{dx} x^2 = \blank{2x}`, typed expression (accepts `2x`, `2*x`, `x+x`).
  Run examples + roundtrip tests; browser check muted (tiles drag and keyboard; the typed preview; a phone-width check of the key row).
- [ ] **Step 6: Commit** — "Formula asks: lint and three examples"

---

### Task 11: Market handle — pure arithmetic

**Files:**
- Create: `src/guess/market.ts`
- Test: `tests/guess-market.test.ts`

**Interfaces:**
- Consumes: `layoutSupplyDemand` (`src/scenes/supply_demand/layout.ts`, returns `curveSamples` in template-logical units and `frame {x:[0,100], y:[0,100], box}`), `interpolateAtX`, `intersectPolylines` (`src/layout/curves.ts`).
- Produces:
  ```ts
  export type MarketAxis = "price" | "quantity";
  export interface MarketCurve {
    curve: "supply_curve" | "demand_curve";
    axis: MarketAxis;
    pivot: number;            // c: 0 on the price axis, Qe on the quantity axis
    base: Pt[];               // the old curve, domain units (Q, P), sorted by the moving axis' partner
    at: [number, number];     // the two sample points' coordinate on the other axis (Q for price axis, P for quantity axis)
    truth: [number, number];  // t1, t2 gaps along the axis
    truthCurve: Pt[];         // the true new curve, domain units
    other: Pt[];              // the other curve (for implied equilibrium), domain units
  }
  /** What moves the asked curve, from the animate's targets. */
  export function marketMove(curve: string, params: Record<string, unknown>, targets: Record<string, unknown>): { axis: MarketAxis; truthId: string } | string;
  export function marketCurve(params: Record<string, unknown>, end: Record<string, unknown>, curve: string, targets: Record<string, unknown>): MarketCurve | string;
  /** The viewer's curve for (s, k), domain units. */
  export function transformed(m: MarketCurve, s: number, k: number): Pt[];
  /** Gaps (v1, v2) of (s, k), and back: the (s, k) that give gaps (v1, v2). */
  export function gapsOf(m: MarketCurve, s: number, k: number): [number, number];
  export function skOf(m: MarketCurve, v: [number, number]): { s: number; k: number };
  export type Shape = "shift" | "turn" | "none";
  export function shapeOf(v: [number, number], range: number): Shape;     // none when both gaps < 1% of range
  export function directionOf(v: [number, number]): 1 | -1 | 0;
  export function marketRight(m: MarketCurve, v: [number, number], check: "direction" | "shape" | "size", tolerance: number): boolean;
  export function marketWords(m: MarketCurve, v: [number, number]): string;   // "moved up", "turned up", "moved right" …
  export function marketWhy(m: MarketCurve, v: [number, number], kind: "tax" | "subsidy" | "shift" | "elasticity", ok: boolean): string;
  export function impliedEquilibrium(curve: Pt[], other: Pt[]): Pt | null;
  ```
  Gap definitions: price axis — `v(Q) = P_new(Q) − P_old(Q)` at `Q ∈ at`; quantity axis — `v(P) = Q_new(P) − Q_old(P)` at `P ∈ at`. The sample points are a quarter and three quarters of the way along the old curve's extent on the partner axis, clipped to where both the old and the true curve are defined.

- [ ] **Step 1: Failing test**

```ts
// tests/guess-market.test.ts
import { describe, expect, test } from "vitest";
import { directionOf, gapsOf, impliedEquilibrium, marketCurve, marketMove, marketRight, marketWhy, shapeOf, skOf } from "../src/guess/market";

const base = { demand: { steepness: "medium" }, supply: { steepness: "medium" }, tax: { amount: 0, side: "seller", kind: "per_unit" } };

describe("market handle", () => {
  test("what moves the curve", () => {
    expect(marketMove("supply_curve", base, { "tax.amount": 20 })).toEqual({ axis: "price", truthId: "tax_supply_curve" });
    expect(marketMove("demand_curve", { ...base, demand_shift: { amount: 0 } }, { "demand_shift.amount": 20 })).toEqual({ axis: "quantity", truthId: "demand_shift_curve" });
    expect(marketMove("supply_curve", base, { "supply.elasticity": 1.5 })).toEqual({ axis: "quantity", truthId: "supply_curve" });
    expect(typeof marketMove("demand_curve", base, { "tax.amount": 20 })).toBe("string"); // a seller tax does not move demand
  });

  test("per-unit tax: equal gaps, a shift up", () => {
    const m = marketCurve(base, { ...base, tax: { ...base.tax, amount: 20 } }, "supply_curve", { "tax.amount": 20 });
    if (typeof m === "string") throw new Error(m);
    expect(m.truth[0]).toBeCloseTo(m.truth[1], 0);
    expect(shapeOf(m.truth, 100)).toBe("shift");
    expect(directionOf(m.truth)).toBe(1);
  });

  test("percent tax: growing gaps, a turn", () => {
    const pct = { ...base, tax: { amount: 0, side: "seller", kind: "ad_valorem" } };
    const m = marketCurve(pct, { ...pct, tax: { ...pct.tax, amount: 40 } }, "supply_curve", { "tax.amount": 40 });
    if (typeof m === "string") throw new Error(m);
    expect(m.truth[1]).toBeGreaterThan(m.truth[0] * 1.3);
    expect(shapeOf(m.truth, 100)).toBe("turn");
  });

  test("(s, k) ↔ gaps round-trip; s and k reach the truth", () => {
    const pct = { ...base, tax: { amount: 0, side: "seller", kind: "ad_valorem" } };
    const m = marketCurve(pct, { ...pct, tax: { ...pct.tax, amount: 40 } }, "supply_curve", { "tax.amount": 40 }) as Exclude<ReturnType<typeof marketCurve>, string>;
    const { s, k } = skOf(m, m.truth);
    const v = gapsOf(m, s, k);
    expect(v[0]).toBeCloseTo(m.truth[0], 5);
    expect(v[1]).toBeCloseTo(m.truth[1], 5);
  });

  test("checks", () => {
    const m = marketCurve(base, { ...base, tax: { ...base.tax, amount: 20 } }, "supply_curve", { "tax.amount": 20 }) as Exclude<ReturnType<typeof marketCurve>, string>;
    const t = m.truth;
    const evenLow: [number, number] = [t[0] * 0.5, t[1] * 0.5];
    const turned: [number, number] = [t[0] * 0.3, t[1] * 1.6];
    const down: [number, number] = [-t[0], -t[1]];
    expect(marketRight(m, evenLow, "direction", 0.08)).toBe(true);
    expect(marketRight(m, evenLow, "shape", 0.08)).toBe(true);
    expect(marketRight(m, evenLow, "size", 0.08)).toBe(false);
    expect(marketRight(m, turned, "shape", 0.08)).toBe(false);
    expect(marketRight(m, down, "direction", 0.08)).toBe(false);
    expect(marketWhy(m, turned, "tax", false)).toMatch(/same amount/);
    expect(marketWhy(m, down, "tax", false)).toMatch(/moves up, not down/);
  });

  test("implied equilibrium", () => {
    const e = impliedEquilibrium([[0, 0], [100, 100]], [[0, 100], [100, 0]]);
    expect(e![0]).toBeCloseTo(50);
    expect(e![1]).toBeCloseTo(50);
  });
});
```

- [ ] **Step 2: Run — FAIL.**
- [ ] **Step 3: Implement `src/guess/market.ts`**
  - `marketMove`: price axis when a target key is `tax.amount` and the tax's side matches the curve (`seller` → supply, `buyer` → demand) → truthId `tax_<supply|demand>_curve`; quantity axis for `<curve>_shift.amount` (truthId `<demand|supply>_shift_curve`), `<demand|supply>.offset` and `<demand|supply>.elasticity` (truthId = the curve itself). Else the error string `"the next animate does not move <curve>"`.
  - `marketCurve`: lay out both params with `layoutSupplyDemand`; convert `curveSamples[id]` back to domain with the frame box (`domain = [(x − box.x) / box.w * 100, (y − box.y) / box.h * 100]` — check the y direction against `ctx.toLogical` in `layout.ts` and invert exactly what it does); `base` = `curveSamples[curve]` at `params`, `truthCurve` = `curveSamples[truthId]` at `end`, `other` = the other curve at `params`; `pivot` = 0 on the price axis, the equilibrium Q (`intersectPolylines(base, other)[0]`) on the quantity axis; `at` = quarter/three-quarter points of the partner coordinate over the overlap of base and truth; `truth` = gaps computed by interpolation (`interpolateAtX` on (Q→P) for price; on the swapped points (P→Q) for quantity).
  - `gapsOf(m, s, k)`: price axis: `v_i = (k − 1) · P0(at_i) + s` (pivot 0); quantity axis: `v_i = (k − 1) · (Q0(at_i) − pivot) + s`. `skOf` solves the 2×2 linear system (if `X0(at_1) == X0(at_2)` — a vertical/horizontal curve — set k = 1 and s = mean).
  - `transformed(m, s, k)`: each base point's moving coordinate `X → pivot + k (X − pivot) + s`.
  - `shapeOf(v, range)`: `none` when `max(|v1|, |v2|) < 0.01 · range`; `shift` when `|v2 − v1| < 0.25 · max(|v1|, |v2|)`; else `turn`.
  - `marketRight`: direction = `directionOf(v) === directionOf(truth)`; shape = direction && `shapeOf(v) === shapeOf(truth)`; size = shape && `(|v1 − t1| + |v2 − t2|) / 2 ≤ tolerance · 100`.
  - `marketWords`: `{shift|turn} + {up|down}` on the price axis, `{right|left}` on the quantity axis: "moved up", "turned up", "moved right", "turned right", "did not move it".
  - `marketWhy(m, v, kind, ok)` — sentences from spec §3.4 (right; shift-vs-turn; turn-vs-shift; wrong direction per kind: tax "A tax on sellers raises the price they need at every quantity, so supply moves up, not down." / subsidy "A subsidy lowers the price sellers need, so supply moves down." / shift "Demand rises at every price, so the curve moves right." with the direction word from the truth / elasticity "More elastic means flatter: the curve turns about the equilibrium."). Keep them in one `WHY` table so i18n can translate them (`src/spec/i18n.ts` — follow how other built-in sentences are registered; if none are, leave a `// i18n:` note and English only, matching the cards hints).
  - `impliedEquilibrium` = `intersectPolylines(curve, other)`.
- [ ] **Step 4: Run — PASS.**
- [ ] **Step 5: Commit** — "Market handle: gaps, shift or turn, checks, why"

---

### Task 12: Market guesses in the guess path, player, gate and lint

**Files:**
- Modify: `src/guess/handles.ts` (`GuessKind` adds `"market"`; `GuessHandle.market?: MarketCurve`; `guessSetup` builds it when `spec.template === "supply_demand"` and `parts` is `supply_curve`/`demand_curve`; `opts.end?: {params, targets}`; `startValues`, `valueAt`, `hitDistance`, `nudge`, `pointFor`, `patchFor` (no params), `GUESSABLE_TEMPLATES` unchanged — market is predict-only)
- Modify: `src/guess/marks.ts` (`market` marks: the copy as a dashed polyline; at `t > 0` the two gap lines and an open dot at the implied equilibrium)
- Modify: `src/guess/score.ts` (`scoreGuess` delegates to `marketRight` for market handles; `guessText`/`guessVars` write `{t}`, `{t.true}`, `{t.off}`, `{t.price}`, `{t.price_true}`, `{t.quantity}`, `{t.quantity_true}`, `{t.why}`)
- Modify: `src/render/player.ts` (`guessSetupAt` passes the next animate's params when `step.predict`; `truthHandles` keeps a market handle's own truth; the guess painter paints market handles with marks every frame; `release` false for market)
- Modify: `src/render/index.ts` (`player.guess.setup` forwards `end`)
- Modify: `src/ui/guess-gate.ts` (hint "Drag the middle to move it, an end to turn it"; grab = 0 middle / 1 end by `END_ZONE` along the copy; keys ↑/↓ and Shift+↑/↓)
- Modify: `src/lint/lint.ts` (`lintGuess`: a predict `on` a supply/demand curve is allowed; `marketMove` error when the next animate does not move it; `check` only on market asks — warning otherwise; remove supply_demand from the "free play only" error for this case only)
- Modify: `src/render/plan.ts` (`guessParts` on supply_demand returns the curve with `shows: [curve]`)
- Test: `tests/guess-market-player.test.ts`, additions to `tests/guess-lint.test.ts`

**Interfaces:**
- Handle numbers for market: `truth = [t1, t2]`, values `[v1, v2]`; `min/max` = ±100 on the axis; `step` = `niceStep(100)` (2); `format` = the price units when `params.units.price` is set (`formatterFor` with the unit).
- Gesture state: `valueAt(h, p, current, prev, grab)` with `grab` 0 (move) → add the pointer's axis delta since `prev` to both gaps; `grab` 1 (turn) → keep `s` from `skOf(current)`, solve `k` so the copy passes the pointer's axis coordinate at the pointer's partner coordinate; return `gapsOf(m, s, k)`.

- [ ] **Step 1: Failing tests**
  - Player (movie mode): S&D spec with `tax: {amount: 0, side: "seller", kind: "ad_valorem"}`, commands `[{draw: […all…]}, {ask: {question: "Show it", on: "supply_curve", predict: true, store: "t", right: "Yes: {t.why}", wrong: "No: {t.why}"}}, {animate: {"tax.amount": 40}, duration: 1}]`; the movie demo (move the middle by the per-unit equivalent) → `vars.get("t")` is `"moved up"`, `vars.get("t.true")` is `"turned up"`, `vars.get("t.ok")` is `"false"`, `t.why` mentions "steeper"; after the animate the market marks remain under owner `guess_<index>`; seeking back clears them.
  - Lint: the review-focus-4 case errors; a correct ask has no issues; `check` on a bar guess warns.
- [ ] **Step 2: Run — FAIL.**
- [ ] **Step 3: Implement** as listed. Key points:
  - In `guessAsk`, `animIndex` is known before setup: compute it first, and when ≥ 0 pass `{end: {params: this.plan.states[animIndex].params, targets: <that animate step's targets>}}` into `guessSetupAt`. For market handles, skip the `later` re-setup (`setup.handles.every(h => h.kind !== "market")`).
  - The movie demo for market: `defaultGuess` absent → a "commonest guess": `gapsOf(m, mean(truth), 1)` (an even move of the mean size).
  - The painter: when any handle is market, `marks = true` always paints `guessMarks(...)` with `t = 0` (the copy), never params.
  - The predict carry: market handles have no `paths`, so the animate runs from the template's own start; the carry still repaints marks each frame with `t = e` (already does).
  - `{t.why}` is set before `right/wrong` is spoken (vars are set in `guessVars`; `marketWhy` needs the kind — derive from `marketMove`: `tax.amount` with a negative target → `subsidy`).
- [ ] **Step 4: Run — PASS**; full guess suite `npx vitest run tests/guess-*.test.ts`; `npx tsc --noEmit`.
- [ ] **Step 5: Commit** — "Market guesses: move or turn a supply/demand curve to predict"

---

### Task 13: Market examples and browser check

- [ ] **Step 1: Examples** in `src/examples.json` (dev copies in `dev-casts/round4/`):
  1. *"A tax per unit on cigarettes"* — `tax {amount: 0, side: seller, kind: per_unit}`, ask `on: supply_curve, predict: true`, `animate {"tax.amount": 18}`.
  2. *"A 25 % tax on wine"* — `kind: ad_valorem`, `check: shape`, then a line contrasting it with the per-unit tax.
  3. *"A subsidy for heat pumps"* — negative `tax.amount`, `check: direction`.
  Narration per memory rules: connected sentences, short canvas text, opening says what it's about.
- [ ] **Step 2:** `npx vitest run tests/examples.test.ts tests/script-roundtrip.test.ts`.
- [ ] **Step 3: Browser (muted):** each example — move only (wrong for the percent tax), turn only, both; check the copy follows the pointer exactly at any zoom, the end zone feels right, Answer is bottom centre, the gap lines and the open dot read clearly, the animate runs after the answer with the ghost staying. Fix what you see.
- [ ] **Step 4: Commit** — "Market guesses: three examples"

---

### Task 14: LLM guidance

**Files:** `src/llm/tags.ts` (`#interactive` brief), `src/llm/prompts/compiler-v1.md` ("Ask the viewer"), `.claude/skills/drawcast/references/rule-card.md`, `tests/prompt-size.test.ts`.

- [ ] **Step 1:** Add to `#interactive`'s "pick the form from the answer" list (spec §8), one compact example each in the compiler prompt (a tree `blanks` + `pick`; a formula with `\blank` and `others`; a market `predict` with `check`), and the same three lines in the rule card.
- [ ] **Step 2:** `npx vitest run tests/prompt-size.test.ts` — update the pins to the new sizes (once), re-run `tests/tags.test.ts`.
- [ ] **Step 3: Commit** — "Guidance: trees, formulas and market curves in #interactive"

---

### Task 15: A generated cast, as-built notes, push

- [ ] **Step 1:** `node scripts/prompt-lab.mjs --set interactive` with three prompts (a health decision, a physics formula, a market tax) — or the local author `/drawcast` — and read what comes back; fix guidance where the generated asks are wrong. Add the best one as an example (it must lint clean).
- [ ] **Step 2:** Full suite `npx vitest run` and `npx tsc --noEmit` — all green.
- [ ] **Step 3:** Add `## 11. As built (2026-10-0x)` to the spec: decisions taken during the build, anything that differs from §3–§9.
- [ ] **Step 4:** Commit, then `git push` (main), and update the memory file `drawcast-guess-reveal.md` with a line on round 4.

---

## Self-review notes

- Spec coverage: §3 → Tasks 11–13; §4 → Tasks 2–5; §5 → Tasks 6–10; §6 movies → Tasks 4, 9, 12 (movie paths) ; §7 shared → Tasks 1, 8, 12; §8 → Task 14; §9 order kept (tree, formula, market); §10 decisions → Tasks 3 (payoff/cost), 6 (typed), 11 (elasticity).
