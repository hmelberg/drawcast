// decision_tree's numbers, worked on the figure while paused (2026-09-27):
// the body's scrub math, complements, clamps and patches; typed input; and
// the host's tap-to-type path (release → "edit" → field → commit).
import { describe, expect, test } from "vitest";
import manifest from "../src/scenes/decision_tree/manifest.json";
import { scenes } from "../src/scenes/registry";
import { buildWidgetScene } from "../src/scenes/widget-scene";
import { dragMoveEvent, inputEvent, partAt, runWidget } from "../src/scenes/widget-run";
import { treeField, treeParts, treeScrub, treeTarget, withAmount, withProbability } from "../src/scenes/decision_tree/widget";
import { layoutDecisionTree, type DecisionTreeParams, type TreeNode } from "../src/scenes/decision_tree/layout";
import { validateSpec } from "../src/spec/schema";
import { planCommands } from "../src/render/plan";
import { withOverrides } from "../src/render/params";
import { widgetHostFor } from "../src/ui/widget-host";
import { layoutSpec } from "../src/layout/layout";
import { INITIAL_STATE, type Plan } from "../src/render/plan";
import type { RenderHandle } from "../src/render";
import type { Pt } from "../src/layout/model";
import type { WidgetScene } from "../src/scenes/widget-types";

const module = scenes["decision_tree"];
/** The manifest's cost-effectiveness tree: watch / medication / surgery at $50,000 a QALY. */
const CE = manifest.examples[1].params as unknown as DecisionTreeParams;
/** The laid-out page (labels resolved into texts with boxes), as the host sees it. */
const pageOf = (params: DecisionTreeParams) => layoutSpec({ template: "decision_tree", params, commands: [] } as unknown as RenderHandle["spec"]);
const sceneOf = (params: DecisionTreeParams): WidgetScene => buildWidgetScene(module, params as unknown as Record<string, unknown>, { layout: pageOf(params) })!;
const runOn = (params: DecisionTreeParams, events: Parameters<typeof runWidget>[2]) => runWidget(module, params as unknown as Record<string, unknown>, events, { layout: pageOf(params) });
const centre = (sc: WidgetScene, id: string): Pt => {
  const b = sc.boxes.get(id)!;
  return [b.x + b.w / 2, b.y + b.h / 2];
};
const kids = (root: TreeNode, i: number) => root.children![i].node.children!.map((b) => b.probability);
const best = (params: DecisionTreeParams) => layoutDecisionTree(params).values!.best;

describe("the body: which numbers are the viewer's", () => {
  test("chance branches (a complement rollback filled in too) and terminals with numbers; never a decision's options", () => {
    const parts = treeParts(sceneOf(CE));
    expect(parts).toContain("branchlabel_watch_w_ok");
    expect(parts).toContain("branchlabel_watch_w_bad"); // filled in: 0.4
    expect(parts).toContain("payoff_s_bad");
    expect(parts.some((id) => id.startsWith("branchlabel_choice_"))).toBe(false);
  });

  test("without rollback a missing probability is not drawn, so not editable", () => {
    const bare = { ...CE, rollback: false };
    expect(treeParts(sceneOf(bare))).not.toContain("branchlabel_watch_w_bad");
  });

  test("a collapsed subtree's hidden branches are not parts", () => {
    const p = manifest.examples[2].params as unknown as DecisionTreeParams;
    expect(treeParts(sceneOf(p)).filter((id) => id.includes("screen"))).toEqual([]);
  });

  test("the scene hits a label by its box (a text has no outline and no strokes)", () => {
    const sc = sceneOf(CE);
    expect(partAt(sc, centre(sc, "branchlabel_surgery_s_ok"), 18, treeParts)).toBe("branchlabel_surgery_s_ok");
    expect(partAt(sc, [990, 740], 18, treeParts)).toBeNull();
  });
});

describe("complements: a chance node's branches keep adding up to 1", () => {
  test("two branches: the sibling becomes 1 − p, written out (it was a filled complement)", () => {
    const root = withProbability(CE.root, [0, 0], 0, 0.35);
    expect(kids(root, 0)).toEqual([0.35, 0.65]);
    expect(kids(CE.root, 0)).toEqual([0.6, undefined]); // the input is untouched
  });

  test("three or more: the OTHER siblings rescale in proportion, the sum stays exactly 1", () => {
    const three: TreeNode = { type: "chance", label: "c", children: [0.5, 0.3, 0.2].map((p, i) => ({ probability: p, node: { type: "terminal", label: `t${i}`, payoff: i } })) };
    const out = withProbability(three, [0], 0, 0.6);
    expect(out.children!.map((b) => b.probability)).toEqual([0.6, 0.24, 0.16]);
    // Rounding's remainder goes to the largest other.
    const thirds: TreeNode = { ...three, children: three.children!.map((b, i) => ({ ...b, probability: [0.34, 0.33, 0.33][i] })) };
    const t = withProbability(thirds, [0], 0, 0.51).children!.map((b) => b.probability!);
    expect(t[0]).toBe(0.51);
    expect(t[1] + t[2]).toBeCloseTo(0.49, 10);
    // All others at 0: they share what is left equally.
    const zero: TreeNode = { ...three, children: three.children!.map((b, i) => ({ ...b, probability: i === 0 ? 1 : 0 })) };
    expect(withProbability(zero, [0], 0, 0.5).children!.map((b) => b.probability)).toEqual([0.5, 0.25, 0.25]);
  });

  test("three decimals where the author wrote three", () => {
    const fine: TreeNode = { type: "chance", label: "c", children: [0.125, 0.875].map((p, i) => ({ probability: p, node: { type: "terminal", label: `t${i}`, payoff: i } })) };
    expect(withProbability(fine, [0], 0, 0.2).children!.map((b) => b.probability)).toEqual([0.2, 0.8]);
    expect(withProbability(fine, [0], 1, 0.9).children!.map((b) => b.probability)).toEqual([0.1, 0.9]);
  });
});

describe("the scrub: a sideways drag changes the number by whole steps", () => {
  test("a probability: ±0.01 per 4 units, clamped to 0–1", () => {
    const sc = sceneOf(CE);
    const t = treeTarget("branchlabel_surgery_s_ok", [0, 0], sc)!;
    expect(t).toMatchObject({ kind: "p", value: 0.9 });
    expect(treeScrub(t, 20)).toBe(0.95);
    expect(treeScrub(t, -40)).toBe(0.8);
    expect(treeScrub(t, 400)).toBe(1);
    expect(treeScrub(t, -4000)).toBe(0);
  });

  test("a cost: a step of about 1 % (150 000 → 2 000), never below 0", () => {
    const t = { kind: "cost" as const, id: "s_ok", path: [0, 2, 0], value: 150000, name: "Recovered" };
    expect(treeScrub(t, 8)).toBe(154000);
    expect(treeScrub({ ...t, value: 1000 }, -4000)).toBe(0);
    // A value already negative has no floor.
    expect(treeScrub({ ...t, value: -500 }, -8)).toBe(-510);
  });

  test("a payoff: 9 → steps of 0.1", () => {
    expect(treeScrub({ kind: "payoff", id: "s_ok", path: [0, 2, 0], value: 9, name: "Recovered" }, 12)).toBeCloseTo(9.3, 10);
  });

  test("a live drag on surgery's success flips the decision to surgery — EV, best and the table follow", () => {
    expect(best(CE)).toBe(1); // medication at $50,000/QALY
    const sc = sceneOf(CE);
    const from = centre(sc, "branchlabel_surgery_s_ok");
    const run = runOn(CE, [dragMoveEvent("branchlabel_surgery_s_ok", from, [from[0] + 32, from[1] + 3], sc)]);
    expect(run.errors).toEqual([]);
    const after = run.params as unknown as DecisionTreeParams;
    expect(kids(after.root, 2)).toEqual([0.98, 0.02]);
    const v = layoutDecisionTree(after).values!;
    expect(v.ev_surgery).toBeCloseTo(8.88, 10);
    expect(v.best).toBe(2);
    expect(layoutDecisionTree(after).order).toContain("best_choice_surgery");
  });
});

describe("a terminal's payoff and cost share one text: the press's x picks one", () => {
  test("left of the comma is the payoff, right of it the cost — each with its own half as the field's box", () => {
    const sc = sceneOf(CE);
    const b = sc.boxes.get("payoff_s_ok")!;
    const left = treeTarget("payoff_s_ok", [b.x + 3, b.y + b.h / 2], sc)!;
    const right = treeTarget("payoff_s_ok", [b.x + b.w - 3, b.y + b.h / 2], sc)!;
    expect(left).toMatchObject({ kind: "payoff", value: 9 });
    expect(right).toMatchObject({ kind: "cost", value: 150000 });
    const lb = treeField(left, sc, "payoff_s_ok").box!;
    const rb = treeField(right, sc, "payoff_s_ok").box!;
    expect(lb.x + lb.w).toBeLessThanOrEqual(rb.x);
  });

  test("a number the author put on the incoming branch is patched there", () => {
    const root: TreeNode = { type: "chance", label: "c", children: [{ probability: 1, payoff: 3, node: { type: "terminal", label: "t" } }] };
    const out = withAmount(root, [0, 0], "payoff", 5);
    expect(out.children![0].payoff).toBe(5);
    expect(out.children![0].node.payoff).toBeUndefined();
    expect(withAmount(root, [0, 0], "cost", 7).children![0].node.cost).toBe(7);
  });
});

describe("tap to type: the body's field and the typed value", () => {
  test("a probability's field: bounds 0–1, named for its branch, over the number itself", () => {
    const sc = sceneOf(CE);
    const f = treeField(treeTarget("branchlabel_watch_w_ok", [0, 0], sc)!, sc, "branchlabel_watch_w_ok");
    expect(f).toMatchObject({ value: 0.6, min: 0, max: 1, label: "Probability of Stable" });
    const whole = sc.boxes.get("branchlabel_watch_w_ok")!;
    expect(f.box!.w).toBeLessThan(whole.w / 2);
  });

  test("a cost's field floors at 0; a payoff's does not", () => {
    const sc = sceneOf(CE);
    const b = sc.boxes.get("payoff_w_bad")!;
    expect(treeField(treeTarget("payoff_w_bad", [b.x + b.w - 2, b.y], sc)!, sc, "payoff_w_bad")).toMatchObject({ label: "Cost of Worse", min: 0 });
    expect(treeField(treeTarget("payoff_w_bad", [b.x + 1, b.y], sc)!, sc, "payoff_w_bad").min).toBeUndefined();
  });

  test("a typed probability lands with its complement; a typed cost lands on the terminal", () => {
    const run = runOn(CE, [inputEvent("branchlabel_watch_w_bad", 0.25)]);
    expect(kids((run.params as unknown as DecisionTreeParams).root, 0)).toEqual([0.75, 0.25]);
    const sc = sceneOf(CE);
    const b = sc.boxes.get("payoff_s_bad")!;
    const cost = runOn(CE, [inputEvent("payoff_s_bad", 250000, [b.x + b.w - 2, b.y + 2])]);
    expect(((cost.params as unknown as DecisionTreeParams).root.children![2].node.children![1].node).cost).toBe(250000);
  });
});

describe("the movie form: a cast can already sweep a probability", () => {
  test("animate of root…probability validates, starts from the drawn value, and the fold-back follows", () => {
    const path = "root.children.2.node.children.0.probability";
    const spec = { template: "decision_tree", params: CE, commands: [{ animate: { [path]: 0.99 }, duration: 2, speak: "If surgery almost always worked…" }] };
    expect(validateSpec(spec).ok).toBe(true);
    const plan = planCommands(spec.commands as never, [], { animateBase: CE as unknown as Record<string, unknown> });
    const step = plan.steps.find((s) => s.kind === "animate") as { starts: Record<string, number | null>; targets: Record<string, number> };
    expect(step.starts[path]).toBe(0.9);
    // Each frame is withOverrides(params, {path: p}); the sibling is the
    // complement rollback fills in, so the tree folds back at every p.
    const mid = withOverrides(CE as unknown as Record<string, unknown>, { [path]: 0.95 }) as unknown as DecisionTreeParams;
    expect(layoutDecisionTree(mid).values!.ev_surgery).toBeCloseTo(0.95 * 9 + 0.05 * 3, 10);
    expect(best(withOverrides(CE as unknown as Record<string, unknown>, { [path]: 0.99 }) as unknown as DecisionTreeParams)).toBe(2);
  });
});

// ---- the host: tap to type -------------------------------------------------

function fakePlan(order: string[]): Plan {
  return { steps: [], states: [{ ...INITIAL_STATE, visible: order }], labels: {}, warnings: [], minted: [] } as unknown as Plan;
}

function dtHandle(params: DecisionTreeParams = CE) {
  const spec = { template: "decision_tree", params, commands: [] } as unknown as RenderHandle["spec"];
  const layout = layoutSpec(spec);
  const previews: Record<string, unknown>[] = [];
  let painted: ReturnType<typeof layoutSpec> | null = null;
  const timeline = {
    state: "paused",
    position: 1,
    vars: new Map<string, string>(),
    callbacks: {},
    previewParams: (o: Record<string, unknown>) => {
      painted = layoutSpec({ ...spec, params: { ...params, ...o } } as unknown as RenderHandle["spec"]);
      previews.push(o);
    },
    paintedLayout: () => painted,
    glow: async () => undefined,
    tapAt: async () => undefined,
    caption: () => undefined,
    getParamOverrides: () => ({}),
  };
  const hd = { spec, layout, plan: fakePlan(layout.order), timeline } as unknown as RenderHandle;
  const warnings: string[] = [];
  const host = widgetHostFor(hd, { frame: (fn) => (fn(), () => undefined), warn: (m) => warnings.push(m) })!;
  return { host, previews, warnings, sc: sceneOf(params) };
}

describe("the host: a tap on a number opens its field", () => {
  test("a tap on a probability reads 'edit' and holds the field; a bad number is refused and the field stays", () => {
    const { host, previews, sc } = dtHandle();
    const p = centre(sc, "branchlabel_watch_w_ok");
    expect(host.scrubbable(p)).toBe(true);
    expect(host.press(p)).toBe(true);
    expect(host.release(p)).toBe("edit");
    const f = host.editField()!;
    expect(f.id).toBe("branchlabel_watch_w_ok");
    expect(f.field).toMatchObject({ value: 0.6, label: "Probability of Stable" });
    expect(host.commitEdit("lots")).toEqual({ ok: false, error: "not a number" });
    expect(host.commitEdit("1.5")).toMatchObject({ ok: false });
    expect(host.editField()).not.toBeNull();
    expect(previews).toEqual([]);
    expect(host.commitEdit("0,3")).toEqual({ ok: true }); // a decimal comma reads as a point
    expect(host.editField()).toBeNull();
    expect(kids((previews.at(-1) as { root: TreeNode }).root, 0)).toEqual([0.3, 0.7]);
  });

  test("Escape (cancelEdit) delivers nothing; a scrub drag still paints live", () => {
    const { host, previews, sc } = dtHandle();
    const p = centre(sc, "branchlabel_surgery_s_ok");
    host.press(p);
    host.release(p);
    host.cancelEdit();
    expect(host.editField()).toBeNull();
    expect(previews).toEqual([]);
    host.press(p);
    host.move([p[0] + 8, p[1]]);
    expect(kids((previews.at(-1) as { root: TreeNode }).root, 2)).toEqual([0.92, 0.08]);
    expect(host.release([p[0] + 20, p[1]])).toBe("drag");
    expect(kids((previews.at(-1) as { root: TreeNode }).root, 2)).toEqual([0.95, 0.05]);
  });

  test("the next edit starts from the last one (patches accumulate), and reset() forgets both", () => {
    const { host, previews, sc } = dtHandle();
    const p = centre(sc, "branchlabel_watch_w_ok");
    host.press(p);
    host.release(p);
    host.commitEdit("0.5");
    host.press(p);
    host.release(p);
    expect(host.editField()!.field.value).toBe(0.5);
    host.reset();
    expect(host.editField()).toBeNull();
    expect(previews.length).toBe(1);
  });

  test("blank paper is neither scrubbable nor a press", () => {
    const { host } = dtHandle();
    expect(host.scrubbable([990, 740])).toBe(false);
    expect(host.press([990, 740])).toBe(false);
  });
});
