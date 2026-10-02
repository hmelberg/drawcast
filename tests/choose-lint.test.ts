// Choose on the figure (spec 2026-10-03-round6 §4): an option must be drawn
// before the ask; decide cards whose options repeat drawn things are told
// about choose; the schema keeps the ask's fields consistent.

import { describe, expect, test } from "vitest";
import { layoutSpec } from "../src/layout/layout";
import { lintCommands } from "../src/lint/lint";
import { expandSpec } from "../src/spec/expand";
import { validateSpec } from "../src/spec/schema";
import type { Spec } from "../src/spec/types";

const node = (id: string, text: string, x: number) => ({ id, type: "node", shape: "rect", text, x, y: 375, width: 160, height: 80 });

const doors = (commands: Spec["commands"], extra: object[] = []): Spec =>
  ({
    elements: [node("door_1", "Door 1", 200), node("door_2", "Door 2", 500), node("door_3", "Door 3", 800), ...extra],
    commands,
  }) as unknown as Spec;

const chooseIssues = (spec: Spec) => layoutSpec(spec).issues.filter((i) => i.rule === "choose");

describe("choose lint: options drawn before the ask", () => {
  test("every option drawn first: clean", () => {
    const spec = doors([{ draw: ["door_1", "door_2", "door_3"] }, { ask: { question: "Which?", choose: ["door_1", "door_2", "door_3"], answer: "door_2" } }]);
    expect(chooseIssues(spec)).toEqual([]);
  });

  test("an option not drawn yet is an error naming it", () => {
    const spec = doors([{ draw: ["door_1", "door_2"] }, { ask: { question: "Which?", choose: ["door_1", "door_2", "door_3"], answer: "door_2" } }, { draw: "door_3" }]);
    const issues = chooseIssues(spec);
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe("error");
    expect(issues[0].ids).toEqual(["door_3"]);
    expect(issues[0].message).toMatch(/door_3.*not drawn/);
  });

  test("an option erased before the ask is not drawn", () => {
    const spec = doors([{ draw: ["door_1", "door_2", "door_3"] }, { erase: "door_1" }, { ask: { question: "Which?", choose: ["door_1", "door_2"], answer: "door_2" } }]);
    expect(chooseIssues(spec).map((i) => i.ids[0])).toEqual(["door_1"]);
  });

  test("an id the figure does not have is an error", () => {
    const spec = doors([{ draw: ["door_1", "door_2"] }, { ask: { question: "Which?", choose: ["door_1", "door_9"], answer: "door_1" } }]);
    const issues = chooseIssues(spec);
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toMatch(/door_9/);
  });

  test("a group counts as drawn when its members are", () => {
    const spec = doors(
      [{ draw: ["door_1", "door_2", "door_3"] }, { ask: { question: "Which?", choose: ["pair", "door_3"], store: "c", judge: false } }],
      [{ id: "pair", type: "group", members: ["door_1", "door_2"] }],
    );
    expect(chooseIssues(spec)).toEqual([]);
  });
});

describe("choose lint: branches", () => {
  test("an option's goto that is not a label after the question, and a missing then", () => {
    const spec = doors([
      { label: "before" },
      { draw: ["door_1", "door_2"] },
      { ask: { question: "Which?", choose: [{ id: "door_1", goto: "before" }, { id: "door_2", goto: "two" }] } },
      { label: "two" },
    ]);
    const issues = lintCommands(expandSpec(spec)).filter((i) => i.rule === "choose");
    expect(issues.map((i) => i.severity).sort()).toEqual(["error", "warn"]);
  });
});

describe("decide cards that repeat drawn things", () => {
  test("a hint to use choose", () => {
    const spec = doors(
      [
        { draw: ["door_1", "door_2", "door_3"] },
        { ask: { question: "Which door?", on: "pick" } },
        { label: "a" },
        { label: "b" },
        { label: "after" },
      ],
      [{ id: "pick", type: "cards", options: [{ text: "Door 1", goto: "a" }, { text: "Door 2", goto: "b" }], then: "after" }],
    );
    const issues = lintCommands(expandSpec(spec)).filter((i) => i.rule === "choose");
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toMatch(/choose/);
  });

  test("decide cards whose options are not on the figure: nothing", () => {
    const spec = doors(
      [{ draw: ["door_1"] }, { ask: { question: "What next?", on: "pick" } }, { label: "a" }, { label: "b" }, { label: "after" }],
      [{ id: "pick", type: "cards", options: [{ text: "Treat", goto: "a" }, { text: "Wait", goto: "b" }], then: "after" }],
    );
    expect(lintCommands(expandSpec(spec)).filter((i) => i.rule === "choose")).toEqual([]);
  });
});

describe("choose schema", () => {
  const errs = (ask: object, extra: object[] = []) =>
    validateSpec(doors([{ draw: ["door_1", "door_2"] }, { ask: { question: "Which?", ...ask } }, ...extra] as never)).errors?.filter((e: string) => /ask/.test(e)) ?? [];

  test("a judged, an opinion and a branching choose validate", () => {
    expect(errs({ choose: ["door_1", "door_2"], answer: "door_2" })).toEqual([]);
    expect(errs({ choose: ["door_1", "door_2"], store: "c", judge: false, right: "You took {c}." })).toEqual([]);
    expect(errs({ choose: [{ id: "door_1", goto: "one" }, { id: "door_2", goto: "two" }], then: "end" }, [{ label: "one" }, { label: "two" }, { label: "end" }])).toEqual([]);
  });

  test("an answer that is not an option, a default that is not, judge false with an answer, one option, then without choose", () => {
    expect(errs({ choose: ["door_1", "door_2"], answer: "door_3" })[0]).toMatch(/not one of the choose options/);
    expect(errs({ choose: ["door_1", "door_2"], store: "c", default: "door_3", judge: false })[0]).toMatch(/default/);
    expect(errs({ choose: ["door_1", "door_2"], answer: "door_1", judge: false })[0]).toMatch(/opinion/);
    expect(errs({ choose: ["door_1"], answer: "door_1" }).length).toBeGreaterThan(0);
    expect(errs({ answer: "x", then: "end" }, [{ label: "end" }])[0]).toMatch(/then only applies to choose/);
    expect(errs({ choose: ["door_1", "door_2"], widget: "click", answer: "door_1" }).some((e: string) => /choose is answered by tapping/.test(e))).toBe(true);
  });
});

describe("choose lint: minted and revealed things", () => {
  test("a copy made before the ask is a drawn option", () => {
    const spec = doors([{ draw: ["door_1", "door_2"] }, { copy: { target: "door_1", as: "door_1b" } }, { ask: { question: "Which?", choose: ["door_1b", "door_2"], answer: "door_2" } }]);
    expect(chooseIssues(spec)).toEqual([]);
  });
});
