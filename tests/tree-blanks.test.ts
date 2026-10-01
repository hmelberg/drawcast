import { describe, expect, test } from "vitest";
import { decodeTreeAnswer, encodeTreeAnswer, parseBlankNumber, parseTreeBlankNumber, scoreBlanks, treeAnswerAction, treeBlanks, treePick } from "../src/tree/blanks";

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
  test("a probability blank filled in as the complement has a working line; a given one has none (fix wave 2026-10-03)", () => {
    expect(treeBlanks(params, ["branchlabel_treat_not"]).blanks[0].work).toBe("1 − 0.3 = 0.7");
    expect(treeBlanks(params, ["branchlabel_treat_cured"]).blanks[0].work).toBeNull();
  });
  test("a pick's option labels fall back to the node's label when the branch has none (fix wave 2026-10-03)", () => {
    const unlabelled = { rollback: true, root: { ...root, children: [{ label: "", node: { ...root.children[0].node, label: "Statin" } }, root.children[1]] } } as never;
    const p = treePick(unlabelled, "start");
    expect(typeof p !== "string" && p.options.map((o) => o.label)).toEqual(["Statin", "Wait"]);
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
    // A leading "0," is a decimal comma, never thousands.
    expect(parseBlankNumber("0,250")).toBe(0.25);
    expect(parseBlankNumber("-0,250")).toBe(-0.25);
    expect(parseBlankNumber("78,000")).toBe(78000);
  });
  test("a probability typed as a percent is a fraction: 88% is 0.88; other blanks keep the number", () => {
    expect(parseTreeBlankNumber("88%", "probability")).toBeCloseTo(0.88, 12);
    expect(parseTreeBlankNumber("12,5 %", "probability")).toBeCloseTo(0.125, 12);
    expect(parseTreeBlankNumber("0.88", "probability")).toBe(0.88);
    expect(parseTreeBlankNumber("88%", "value")).toBe(88);
    expect(parseTreeBlankNumber("£300", "cost")).toBe(300);
    expect(parseTreeBlankNumber("%", "probability")).toBeNull();
    const { blanks } = treeBlanks(params, ["branchlabel_treat_not"]);
    const typed = parseTreeBlankNumber(`${Math.round(blanks[0].truth * 100)}%`, "probability");
    expect(scoreBlanks(blanks, [typed], 0.02).ok).toBe(true);
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
  test("Answer (and Enter) with an empty blank opens the first empty one, never submits nulls (final review 2026-10-03)", () => {
    expect(treeAnswerAction([5.8, null, null], false, null)).toEqual({ open: 1 });
    expect(treeAnswerAction([null], true, "treat")).toEqual({ open: 0 });
    // Every blank given: the pick if one is still to make, else the answer.
    expect(treeAnswerAction([5.8], true, null)).toBe("nudge");
    expect(treeAnswerAction([5.8], true, "treat")).toBe("submit");
    expect(treeAnswerAction([5.8, 4], false, null)).toBe("submit");
    expect(treeAnswerAction([], true, null)).toBe("nudge");
  });
  test("encoding", () => {
    expect(decodeTreeAnswer(encodeTreeAnswer([5.8, null], "treat"), 2)).toEqual({ values: [5.8, null], pick: "treat" });
  });
  test("thousands commas read as drawn; a lone short comma is a decimal", () => {
    expect(parseBlankNumber("1,200")).toBe(1200);
    expect(parseBlankNumber("$78,000")).toBe(78000);
    expect(parseBlankNumber("1,200,000")).toBe(1200000);
    expect(parseBlankNumber("1,234.5")).toBe(1234.5);
    expect(parseBlankNumber("1.234,5")).toBe(1234.5);
    expect(parseBlankNumber("5,8")).toBe(5.8);
    expect(parseBlankNumber("0,25")).toBe(0.25);
    expect(parseBlankNumber("12,5000")).toBe(12.5);
    expect(parseBlankNumber("1,20,0")).toBeNull();
  });
  test("a decision under wtp: the working line names net benefit, so it matches the pick", () => {
    const costly = { rollback: true, wtp: 20000, root: { id: "start", type: "decision", label: "", children: [
      { label: "Treat", node: { id: "treat", type: "chance", label: "", children: [
        { label: "Good", probability: 0.5, node: { id: "good", type: "terminal", label: "", payoff: 10, cost: 50000 } },
        { label: "Bad", node: { id: "bad", type: "terminal", label: "", payoff: 6, cost: 50000 } },
      ] } },
      { label: "Wait", node: { id: "wait", type: "terminal", label: "", payoff: 7, cost: 0 } },
    ] } } as never;
    const { blanks } = treeBlanks(costly, ["value_start"]);
    expect(blanks[0].truth).toBe(7);
    expect(blanks[0].work).toBe("best net benefit of 110000, 140000 → 7");
    const c = treeBlanks(costly, ["cost_good"]).blanks[0];
    expect(scoreBlanks([c], [parseBlankNumber("$50,000")], 0.01).ok).toBe(true);
  });
});
