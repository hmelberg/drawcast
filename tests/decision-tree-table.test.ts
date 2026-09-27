// decision_tree after the tutorial casts' report (2026-09-27): the strategy
// table above the narration band, its rows in addressable parts, a
// net-benefit and a "vs" column, increments that check by eye; a box the
// tree fills (native, not fitted twice); tokens in the tree's own text;
// a branch cost written on its branch; a scratch card sized by what it shows.
import { describe, expect, test } from "vitest";
import { layoutDecisionTree, type DecisionTreeParams, type TreeNode } from "../src/scenes/decision_tree/layout";
import { layoutSpec, elementBBoxes, nativeBox } from "../src/layout/layout";
import { flattenDrawables, type TextDrawable } from "../src/layout/model";
import { heuristicMeasure } from "../src/layout/measure";
import { pointerPath } from "../src/render/effects";
import { expandSpec } from "../src/spec/expand";
import manifest from "../src/scenes/decision_tree/manifest.json";
import type { Spec } from "../src/spec/types";

const t = (id: string, label: string, payoff: number, cost: number): TreeNode => ({ id, type: "terminal", label, payoff, cost });

/** The ICER tutorial's four options: A is extendedly dominated, C dominated. */
const icer = (extra: Partial<DecisionTreeParams> = {}): DecisionTreeParams => ({
  rollback: true,
  wtp: 50000,
  currency: "$",
  unit: "QALYs",
  decimals: 1,
  root: {
    id: "choice",
    type: "decision",
    label: "Treatment",
    children: [
      { label: "", node: t("usual", "Usual care", 5, 0) },
      { label: "", node: t("a", "Drug A", 5.2, 8000) },
      { label: "", node: t("b", "Drug B", 5.6, 20000) },
      { label: "", node: t("c", "Drug C", 5.5, 26000) },
    ],
  },
  ...extra,
});

/** The wtp tutorial with its costs where they belong: on the option branches. */
const drugs = (extra: Partial<DecisionTreeParams> = {}): DecisionTreeParams => ({
  rollback: true,
  wtp: 40000,
  currency: "$",
  unit: "QALYs",
  decimals: 1,
  root: {
    id: "choice",
    type: "decision",
    label: "Treatment",
    children: [
      { label: "", cost: 2000, node: { id: "cheap", type: "chance", label: "Cheap drug", children: [{ label: "Works", probability: 0.5, node: { id: "c_ok", type: "terminal", label: "Well", payoff: 7 } }, { label: "Fails", probability: 0.5, node: { id: "c_no", type: "terminal", label: "Ill", payoff: 5 } }] } },
      { label: "", cost: 32000, node: { id: "dear", type: "chance", label: "Dear drug", children: [{ label: "Works", probability: 0.75, node: { id: "d_ok", type: "terminal", label: "Well", payoff: 7 } }, { label: "Fails", probability: 0.25, node: { id: "d_no", type: "terminal", label: "Ill", payoff: 5 } }] } },
    ],
  },
  ...extra,
});

const specOf = (params: DecisionTreeParams, rest: Partial<Spec> = {}): Spec => ({ title: "t", template: "decision_tree", params, commands: [], ...rest }) as unknown as Spec;
const cells = (l: { drawables: Parameters<typeof flattenDrawables>[0] }, id: string) =>
  (flattenDrawables(l.drawables).filter((d) => d.id.startsWith(`${id}__`)) as TextDrawable[]).map((d) => d.text);
const labelText = (l: { labels: { id: string; text: string }[] }, id: string) => l.labels.find((x) => x.id === id)?.text;
const issuesOf = (spec: Spec) => layoutSpec(structuredClone(spec)).issues.map((i) => `${i.rule}: ${i.message}`);

describe("branch costs count for everything below the branch", () => {
  test("the option's value, table row and net benefit carry the cost on its branch — and its label says it", () => {
    const l = layoutDecisionTree(drugs());
    expect(labelText(l, "value_cheap")).toBe("6 · $2,000");
    expect(labelText(l, "value_dear")).toBe("6.5 · $32,000");
    expect(cells(l, "strategy_base_cheap")).toEqual(["Cheap drug", "$2,000", "6"]);
    expect(cells(l, "strategy_base_dear")).toEqual(["Dear drug", "$32,000", "6.5"]);
    // Not "dominated at $0": the dear drug is on the frontier at $60,000 per QALY.
    expect(cells(l, "strategy_icer_dear")).toEqual(["$60,000"]);
    expect(cells(l, "strategy_nmb_cheap")).toEqual(["$238,000"]);
    expect(l.values!.nmb_cheap).toBe(238000);
    expect(l.values!.best).toBe(0);
    expect(labelText(l, "branchlabel_choice_cheap")).toBe("$2,000");
  });

  test("a branch label with a name and a probability puts the cost between them", () => {
    const l = layoutDecisionTree({
      rollback: true,
      currency: "£",
      root: { id: "d", type: "decision", label: "D", children: [{ label: "Test", cost: 300, node: { id: "c", type: "chance", label: "C", children: [{ probability: 0.4, node: t("x", "X", 1, 0) }, { node: t("y", "Y", 2, 0) }] } }, { label: "No", node: t("n", "N", 1.5, 0) }] },
    });
    expect(labelText(l, "branchlabel_d_c")).toBe("Test, £300");
    expect(labelText(l, "branchlabel_c_x")).toBe("p=0.4");
  });
});

describe("the table's increments check by eye", () => {
  test("Δ cost is the difference of the costs as shown, and the ICER their ratio", () => {
    // $10,236 shows as $10,200 (hundreds from 10,000); $7,668 as $7,668.
    const l = layoutDecisionTree({ rollback: true, currency: "$", decimals: 1, root: { id: "d", type: "decision", label: "D", children: [{ label: "Old", node: t("old", "Old", 5, 7668) }, { label: "New", node: t("new", "New", 5.5, 10236) }] } });
    expect(cells(l, "strategy_base_new")).toEqual(["New", "$10,200", "5.5"]);
    expect(cells(l, "strategy_delta_new")).toEqual(["+$2,532", "+0.5"]);
    expect(l.values!.dcost_new).toBe(2532);
    expect(l.values!.icer_new).toBeCloseTo(2532 / 0.5, 6);
    // Two options: no "vs" column — the second is against the first.
    expect(cells(l, "strategy_head")).toEqual(["Cost", "Effect", "Δ cost", "Δ Effect", "ICER"]);
  });

  test("three or more options: the vs column names the option each row is against", () => {
    const l = layoutDecisionTree(icer());
    expect(cells(l, "strategy_delta_a")).toEqual(["Usual care", "+$8,000", "+0.2"]);
    expect(cells(l, "strategy_delta_b")).toEqual(["Usual care", "+$20,000", "+0.6"]);
    expect(cells(l, "strategy_delta_c")).toEqual(["Drug B", "+$6,000", "-0.1"]);
    expect(cells(l, "strategy_icer_a")).toEqual(["ext. dominated"]);
    expect(cells(l, "strategy_icer_c")).toEqual(["dominated"]);
    expect(cells(l, "strategy_nmb_b")).toEqual(["$260,000"]);
    expect(l.values!.wtp).toBe(50000);
  });
});

describe("staging a row: parts drawn on their own beats", () => {
  test("rows first, verdicts later: every id exists and the whole-row id still draws all of it", () => {
    const spec = specOf(icer(), {
      commands: [
        { draw: ["node_choice", "strategy_head", "strategy_rule", "strategy_base_usual"] },
        { draw: ["strategy_base_a", "strategy_delta_a", "strategy_base_b", "strategy_delta_b", "strategy_row_c"] },
        { draw: ["strategy_icer_b"] },
        { draw: ["strategy_icer_a", "strategy_nmb", "strategy_wtp"] },
      ],
    } as Partial<Spec>);
    expect(issuesOf(spec).filter((m) => /template-ids|unknown/.test(m))).toEqual([]);
    const l = layoutDecisionTree(icer());
    expect(l.groups!.strategy_row_c).toEqual(["strategy_base_c", "strategy_delta_c", "strategy_icer_c"]);
  });
});

describe("where the table goes", () => {
  test("on the page it stands above the narration band (bottom 150), under the tree's words", () => {
    for (const params of [icer(), drugs(), structuredClone(manifest.examples[1].params) as unknown as DecisionTreeParams]) {
      const r = layoutSpec(specOf(params));
      const boxes = elementBBoxes(r);
      const table = [...boxes].filter(([id]) => id.startsWith("strategy_"));
      expect(table.length).toBeGreaterThan(4);
      const tableTop = Math.max(...table.map(([, b]) => b.y + b.h));
      for (const [, b] of table) expect(b.y).toBeGreaterThanOrEqual(145);
      const tree = [...boxes].filter(([id]) => /^(node|label|value|effect|cost|payoff|branchlabel)_/.test(id));
      for (const [, b] of tree) expect(b.y).toBeGreaterThan(tableTop);
      expect(r.issues.filter((i) => i.rule.startsWith("overlap") || i.rule === "out-of-canvas")).toEqual([]);
    }
  });
});

describe("a box the tree fills", () => {
  const box = { x: 30, y: 165, w: 940, h: 490 };

  test("the box is the template's own (native), not a second fit of a tree already laid out in it", () => {
    expect(nativeBox("decision_tree")).toBe(true);
  });

  test("with its table: no overlap between the rows (the double fit held the text at the floor while the rows closed up)", () => {
    expect(issuesOf(specOf(icer({ box }))).filter((m) => m.startsWith("overlap") || m.startsWith("out-of"))).toEqual([]);
    const r = layoutSpec(specOf(icer({ box })));
    const boxes = elementBBoxes(r);
    for (const [id, b] of boxes) {
      if (!id.startsWith("strategy_")) continue;
      expect(b.y).toBeGreaterThanOrEqual(box.y - 1);
    }
  });

  test("a roomy box: the tree at label size or larger, spread over the box's height", () => {
    const params: DecisionTreeParams = {
      rollback: true,
      root: {
        id: "choice",
        type: "decision",
        label: "Treatment",
        children: [
          { label: "", node: { id: "surgery", type: "chance", label: "Surgery", children: [{ label: "Cured", probability: 0.6, node: { id: "s1", type: "terminal", label: "Cured", payoff: 10 } }, { label: "Same", probability: 0.3, node: { id: "s2", type: "terminal", label: "Same", payoff: 6 } }, { label: "Harmed", probability: 0.1, node: { id: "s3", type: "terminal", label: "Harmed", payoff: 2 } }] } },
          { label: "", node: { id: "drug", type: "chance", label: "Drug", children: [{ label: "Works", probability: 0.7, node: { id: "d1", type: "terminal", label: "Works", payoff: 9 } }, { label: "Fails", probability: 0.3, node: { id: "d2", type: "terminal", label: "Fails", payoff: 7 } }] } },
        ],
      },
    };
    const l = layoutDecisionTree({ ...params, box });
    expect(l.textSize).toBeGreaterThanOrEqual(26);
    const ys = Object.values(l.positions).map((p) => p[1]);
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(0.6 * box.h);
    expect(issuesOf(specOf({ ...params, box })).filter((m) => m.startsWith("overlap") || m.startsWith("out-of"))).toEqual([]);
    // Narrow: smaller words, still inside and clean.
    const narrow = { ...box, w: 600 };
    const n = layoutSpec(specOf({ ...params, box: narrow }));
    expect(n.issues.filter((i) => i.rule.startsWith("overlap") || i.rule === "out-of-canvas").map((i) => i.message)).toEqual([]);
    for (const [, b] of elementBBoxes(n)) {
      expect(b.x).toBeGreaterThanOrEqual(narrow.x - 30);
      expect(b.x + b.w).toBeLessThanOrEqual(narrow.x + narrow.w + 30);
    }
  });
});

describe("pointing at a row", () => {
  test("a row part's box is its glyph band, and an underline sweep under row A stays above row B", () => {
    const l = layoutDecisionTree(icer());
    const groupBox = (id: string) => (l.drawables.find((d) => d.id === id) as { box?: { x: number; y: number; w: number; h: number } }).box!;
    const a = groupBox("strategy_base_a");
    const b = groupBox("strategy_base_b");
    // Rows by cost: usual, A, B, C — A over B.
    expect(a.y).toBeGreaterThan(b.y + b.h);
    const sweep = pointerPath({ x: a.x + a.w / 2, y: a.y + a.h / 2, box: a }, "underline")(0.6)[1];
    expect(sweep).toBeLessThan(a.y);
    // The pointer's dot (radius 4.5) clears row B's glyphs.
    expect(sweep - 4.5).toBeGreaterThan(b.y + b.h);
  });
});

describe("tokens in the tree's own text", () => {
  test("a value override with {tree.…} and {var} is expanded, and follows the var", () => {
    const params = drugs();
    (params.root.children![0].node as TreeNode).value = "NMB ${tree.nmb_cheap:0,} at ${w:0,}";
    const at = (w: number) => {
      const r = layoutSpec(specOf(params, { vars: { w } } as Partial<Spec>));
      return (flattenDrawables(r.drawables).find((d) => d.id === "value_cheap") as TextDrawable).text;
    };
    expect(at(40000)).toBe("NMB $238,000 at $40,000");
    expect(at(60000)).toBe("NMB $238,000 at $60,000");
    // An animate of wtp relayouts with the new param: the template's value follows.
    const r = layoutSpec(specOf({ ...params, wtp: 60000 }, { vars: { w: 60000 } } as Partial<Spec>));
    expect((flattenDrawables(r.drawables).find((d) => d.id === "value_cheap") as TextDrawable).text).toBe("NMB $358,000 at $60,000");
  });

  test("value: \"\" draws no value under rollback (the root's repeats its pick's)", () => {
    const params = drugs();
    params.root.value = "";
    const l = layoutDecisionTree(params);
    expect(labelText(l, "value_choice")).toBeUndefined();
    expect(labelText(l, "value_cheap")).toBe("6 · $2,000");
  });
});

describe("a scratch card is sized by what it shows, not its tokens", () => {
  test("a line of {tree.…} tokens gets a card near its drawn width", () => {
    const spec = {
      template: "decision_tree",
      params: drugs(),
      vars: { w: 40000 },
      elements: [{ id: "nb", type: "scratch", work: ["Cheap ${tree.nmb_cheap:0,}", "Dear ${tree.nmb_dear:0,}", "${w:0,} / QALY"], x: 200, y: 600 }],
      commands: [],
    } as unknown as Spec;
    const box = expandSpec(spec).elements!.find((e) => e.id === "nb_box") as unknown as { points: [number, number][] };
    const xs = box.points.map((p) => p[0]);
    const w = Math.max(...xs) - Math.min(...xs);
    // "$40,000 / QALY" with a digit to grow, at 24, and the card padding — not the tokens as written (360 wide).
    expect(w).toBeLessThan(heuristicMeasure("$40,0000 / QALY", 24).w + 2 * 18 + 2);
    expect(w).toBeGreaterThanOrEqual(heuristicMeasure("Cheap $238,000", 24).w + 2 * 18);
  });
});
