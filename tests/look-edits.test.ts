import { describe, expect, test } from "vitest";
import { applySpecEdits, applySpecEditsLenient, isEditsReply, lookFixPrompt } from "../src/llm/look";

const spec = {
  title: "t",
  params: { box: { x: 1, y: 2 }, price: 5 },
  elements: [
    { id: "a", type: "label", text: "A", x: 10 },
    { id: "b", type: "label", text: "B" },
  ],
  commands: [{ card: { title: "t" } }, { draw: ["a"], speak: "one" }, { draw: ["b"], speak: "two" }],
};

describe("look fix as edits", () => {
  test("elements by id, params deep, commands by their original number", () => {
    const out = applySpecEdits(spec, [
      { element: "a", set: { x: 40, text: null } },
      { element: "b", remove: true },
      { add: { id: "c", type: "label", text: "C" } },
      { params: { box: { y: 9 } } },
      { spec: { vars: { t: 0 } } },
      { command: 1, remove: true },
      { command: 2, set: { speak: "two!" } },
      { insert_after: 1, commands: [{ pause: 0.3 }] },
      { insert_before: 0, commands: [{ pause: 0.1 }] },
    ]);
    expect(out.elements).toEqual([
      { id: "a", type: "label", x: 40 },
      { id: "c", type: "label", text: "C" },
    ]);
    expect(out.params).toEqual({ box: { x: 1, y: 9 }, price: 5 });
    expect((out as Record<string, unknown>).vars).toEqual({ t: 0 });
    expect(out.commands).toEqual([{ pause: 0.1 }, { card: { title: "t" } }, { pause: 0.3 }, { draw: ["b"], speak: "two!" }]);
    expect(spec.elements).toHaveLength(2); // the input is untouched
  });

  test("an edit that names nothing throws", () => {
    expect(() => applySpecEdits(spec, [{ element: "zz", set: { x: 1 } }])).toThrow(/no element/);
    expect(() => applySpecEdits(spec, [{ command: 9, remove: true }])).toThrow(/no command 9/);
  });

  test("the lenient form keeps the good edits and reports the bad ones", () => {
    const { spec: out, skipped } = applySpecEditsLenient(spec, [{ element: "a", set: { x: 5 } }, { element: "zz", set: { x: 1 } }, { command: 9, remove: true }]);
    expect(out.elements[0]).toMatchObject({ id: "a", x: 5 });
    expect(skipped).toHaveLength(2);
  });

  test("the prompt numbers the commands; the reply shape is recognised", () => {
    const p = lookFixPrompt("1. Beat 2: move A.\nWISH: none", spec);
    expect(p).toContain('1: draw — "one"');
    expect(p).not.toContain("WISH");
    expect(isEditsReply({ edits: [] })).toBe(true);
    expect(isEditsReply({ title: "x", commands: [] })).toBe(false);
  });
});
