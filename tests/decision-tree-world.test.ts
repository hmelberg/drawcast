// A decision tree too big for the page is laid out at full size in a world
// larger than it (`size: "full"`, and by default once the page would need
// its words below the lint's floor), for the camera to walk through
// (2026-09-27). Before, past a dozen terminals it was scaled onto the page
// with its words held at the floor: twenty terminals, a dozen overlaps.
import { describe, expect, test } from "vitest";
import { layoutDecisionTree, type DecisionTreeParams, type TreeNode } from "../src/scenes/decision_tree/layout";
import { knee } from "./helpers/knee-tree";
import { lintDecisionTree } from "../src/scenes/decision_tree/lint";
import { layoutSpec, elementBBoxes } from "../src/layout/layout";
import { CANVAS } from "../src/layout/canvas";
import { flattenDrawables } from "../src/layout/model";
import examples from "../src/examples.json";
import fewshots from "../src/llm/prompts/fewshots.json";
import manifest from "../src/scenes/decision_tree/manifest.json";
import type { Spec } from "../src/spec/types";

const specOf = (params: DecisionTreeParams, commands: unknown[] = []): Spec => ({ title: "t", template: "decision_tree", params, commands }) as unknown as Spec;
const overlaps = (spec: Spec) =>
  layoutSpec(structuredClone(spec))
    .issues.filter((i) => i.rule.startsWith("overlap") || i.rule === "out-of-canvas")
    .map((i) => i.message);
const inside = (b: { x: number; y: number; w: number; h: number }, w: { x: number; y: number; w: number; h: number }) => {
  expect(b.x).toBeGreaterThanOrEqual(w.x - 1e-6);
  expect(b.y).toBeGreaterThanOrEqual(w.y - 1e-6);
  expect(b.x + b.w).toBeLessThanOrEqual(w.x + w.w + 1e-6);
  expect(b.y + b.h).toBeLessThanOrEqual(w.y + w.h + 1e-6);
};

describe("a tree too big for the page, in a world", () => {
  test("twenty terminals: full-size text, a world reported, grown right and down from the page", () => {
    const l = layoutDecisionTree(knee({ size: "full" }));
    expect(l.textSize).toBe(26);
    expect(l.scale).toBe(1);
    expect(l.labels.every((x) => x.fontSize === 26)).toBe(true);
    const w = l.world!;
    expect(w).toBeDefined();
    expect(w.y).toBeLessThan(0); // down…
    expect(w.x + w.w).toBeGreaterThan(CANVAS.w); // …and right
    expect(w.x).toBeGreaterThan(-50); // not left: the root is where a page puts it
    // The root and the top of the tree are on the page, under the card heading.
    const root = l.positions.choice;
    expect(root[0]).toBeLessThan(200);
    expect(Math.max(...Object.values(l.positions).map((p) => p[1]))).toBeLessThanOrEqual(CANVAS.h - 95 + 1e-6);
    // Not a thread: the overview (the world at 4 : 3) is shrunk by far less than
    // the tree is tall in pages.
    expect(Math.max(w.w / CANVAS.w, w.h / CANVAS.h)).toBeLessThan(3.5);
  });

  test("…and by default, since the page would need its words below the floor", () => {
    const auto = layoutDecisionTree(knee());
    expect(auto.world).toBeDefined();
    expect(JSON.stringify(auto)).toBe(JSON.stringify(layoutDecisionTree(knee({ size: "full" }))));
  });

  test("its words do not collide: no overlap or out-of-canvas lint", () => {
    expect(overlaps(specOf(knee({ size: "full" })))).toEqual([]);
    const r = layoutSpec(specOf(knee({ size: "full" })));
    expect(r.world).toBeDefined();
    // Every element inside the world the layout reports.
    for (const [, b] of elementBBoxes(r)) inside(b, r.world!);
  });

  test("size: page keeps the old page layout (words at the floor, no world)", () => {
    const l = layoutDecisionTree(knee({ size: "page" }));
    expect(l.world).toBeUndefined();
    expect(l.scale).toBeLessThan(1);
    expect(l.textSize).toBe(14);
    expect(lintDecisionTree(knee({ size: "page" })).map((i) => i.message).join(" ")).toMatch(/size: "full"/);
  });

  test("rolled back with costs: the strategy table sits under the tree, inside the world", () => {
    const p = knee({ size: "full", rollback: true, currency: "$", unit: "QALYs", wtp: 30000 }, true);
    expect(overlaps(specOf(p))).toEqual([]);
    const r = layoutSpec(specOf(p));
    const boxes = elementBBoxes(r);
    const lowestNode = Math.min(...[...boxes].filter(([id]) => id.startsWith("node_")).map(([, b]) => b.y));
    const rows = [...boxes].filter(([id]) => id.startsWith("strategy_base_"));
    expect(rows).toHaveLength(4);
    for (const [, b] of rows) {
      expect(b.y + b.h).toBeLessThan(lowestNode);
      inside(b, r.world!);
    }
  });

  test("collapsed and world together: a collapsed arm still folds back, the rest is a world", () => {
    const p = knee({ size: "full", rollback: true });
    (p.root.children![0].node as TreeNode).collapsed = true;
    const l = layoutDecisionTree(p);
    expect(l.world).toBeDefined();
    const ids = flattenDrawables(l.drawables).map((d) => d.id);
    expect(ids).toContain("collapsed_physio");
    expect(ids).not.toContain("node_physio_good");
    expect(l.labels.find((x) => x.id === "value_physio")?.text).toMatch(/\d/);
    expect(overlaps(specOf(p))).toEqual([]);
    // Collapse all but one arm and, left to choose, it fits the page again.
    const q = knee();
    for (const b of q.root.children!.slice(0, 3)) (b.node as TreeNode).collapsed = true;
    expect(layoutDecisionTree(q).world).toBeUndefined();
  });

  test("the manifest's sixteen-terminal example is a world and lays out lint-clean", () => {
    const ex = manifest.examples.find((e) => (e.params as { size?: string }).size === "full")!;
    const p = ex.params as unknown as DecisionTreeParams;
    const r = layoutSpec(specOf(structuredClone(p)));
    expect(r.world).toBeDefined();
    expect(r.issues.map((i) => `${i.rule}: ${i.message}`)).toEqual([]);
    expect(lintDecisionTree(p)).toEqual([]);
  });

  test("a box fits the tree onto the page: no world", () => {
    const p = { ...knee({ size: "full" }), box: "full" } as DecisionTreeParams;
    expect(layoutDecisionTree(p).world).toBeUndefined();
    expect(layoutSpec(specOf(p)).world).toBeUndefined();
  });

  test("the lint: a world asked for is not 'too small'; one not asked for says to walk it with the camera", () => {
    const asked = lintDecisionTree(knee({ size: "full" })).map((i) => i.message).join(" ");
    expect(asked).not.toMatch(/text at|too big/);
    const unasked = lintDecisionTree(knee()).map((i) => i.message).join(" ");
    expect(unasked).toMatch(/camera \{on/);
    expect(unasked).toMatch(/size: "full"/);
  });
});

describe("the trees that fit are untouched", () => {
  const bundled = [...(examples as { spec?: Spec }[]), ...(fewshots as { spec?: Spec }[])]
    .map((e) => e.spec)
    .filter((s): s is Spec => s?.template === "decision_tree")
    .map((s): [string, DecisionTreeParams] => [s.title ?? "", s.params as unknown as DecisionTreeParams]);
  const fromManifest = manifest.examples.map((e, i): [string, DecisionTreeParams] => [`manifest example ${i}`, e.params as unknown as DecisionTreeParams]);
  test.each([...bundled, ...fromManifest].filter(([, p]) => p.size === undefined))("%s: no world; size page lays it out the same, and full too unless it had to shrink", (_name, params) => {
    const l = layoutDecisionTree(structuredClone(params));
    const plain = JSON.stringify(l);
    expect(l.world).toBeUndefined();
    expect(JSON.stringify(layoutDecisionTree({ ...structuredClone(params), size: "page" }))).toBe(plain);
    const full = layoutDecisionTree({ ...structuredClone(params), size: "full" });
    // A box ignores size (it is filled); on the page a tree at full size is the same tree.
    if (l.textSize === 26 || params.box !== undefined) expect(JSON.stringify(full)).toBe(plain);
    else {
      // Its words had given up size to fit (the cost example, at 19): full
      // keeps them at 26, in a world a little larger than the page.
      expect(full.textSize).toBe(26);
      expect(full.world).toBeDefined();
    }
  });
});
