// The readable forms of 2026-10-03: cards written as bin lines and `*` items,
// a question leading its line, feedback on `key: text` lines under it, an
// animate's paths as pairs, and `with:` as an indented YAML block. Each is
// read here AND printed back — the round-trip gate holds the whole corpus.
import { describe, expect, test } from "vitest";
import { parseScriptPages } from "../src/spec/script/parse";
import { printScriptPages } from "../src/spec/script/print";
import type { Spec } from "../src/spec/types";

const one = (text: string): Spec => parseScriptPages(text).pages[0].spec;
const print = (spec: Spec): string => printScriptPages({}, [{ spec }]);
const again = (text: string): string => print(one(text));

describe("cards as lines", () => {
  const sort = `Six infections.
    cards germs
        Virus: Flu, Measles, COVID-19
        Bacterium: Tuberculosis, Cholera
`;

  test("a bin line is that bin's items in order, and the bins are named by the lines", () => {
    const el = one(sort).elements![0] as unknown as Record<string, unknown>;
    expect(el.bins).toEqual(["Virus", "Bacterium"]);
    expect(el.items).toEqual([
      { text: "Flu", bin: "Virus" }, { text: "Measles", bin: "Virus" }, { text: "COVID-19", bin: "Virus" },
      { text: "Tuberculosis", bin: "Bacterium" }, { text: "Cholera", bin: "Bacterium" },
    ]);
  });

  test("it prints back as written", () => {
    expect(again(sort)).toBe(sort);
  });

  test("bins given on the head line keep their order and an empty bin", () => {
    const el = one(`Hei.\n    cards c bins ["A","B","C"]\n        B: x\n        A: y\n`).elements![0] as unknown as Record<string, unknown>;
    expect(el.bins).toEqual(["A", "B", "C"]);
    expect(again(`Hei.\n    cards c bins ["A","B","C"]\n        B: x\n        A: y\n`)).toContain('bins ["A","B","C"]');
  });

  test("rank items are `* text`, and an item with fields of its own is `* \"text\" key value`", () => {
    const text = `Hei.\n    cards spend ends ["most","least"]\n        * USA\n        * Germany\n`;
    expect((one(text).elements![0] as unknown as Record<string, unknown>).items).toEqual(["USA", "Germany"]);
    expect(again(text)).toBe(text);
    const icons = `Hei.\n    cards c bins ["Fixed","Variable"]\n        * "Rent" icon house bin Fixed\n        Variable: Flour\n`;
    expect((one(icons).elements![0] as unknown as Record<string, unknown>).items).toEqual([{ text: "Rent", bin: "Fixed", icon: "house" }, { text: "Flour", bin: "Variable" }]);
    expect(again(icons)).toBe(icons);
  });

  test("an element field under a cards line is still a field", () => {
    const el = one(`Hei.\n    cards c\n        A: x\n        width: 600\n`).elements![0] as unknown as Record<string, unknown>;
    expect(el.width).toBe(600);
  });
});

describe("questions and their feedback", () => {
  test("the question leads; right and wrong are lines of their own", () => {
    const text = `Hei.\n    ask "Which way?" on supply_curve predict true store t\n        right: Yes, down.\n        wrong: Not quite. {t.why}\n`;
    const ask = one(text).commands![0].ask as unknown as Record<string, unknown>;
    expect(ask).toMatchObject({ question: "Which way?", on: "supply_curve", store: "t", right: "Yes, down.", wrong: "Not quite. {t.why}" });
    expect(again(text)).toBe(text);
  });

  test("a quiz: question, feedback, then the choices", () => {
    const text = `Hei.\n    quiz "Who gains?"\n        right: Both.\n        * Sellers\n        + Both\n`;
    expect(one(text).commands![0].quiz).toEqual({ question: "Who gains?", right: "Both.", choices: ["Sellers", "Both"], correct: 2 });
    expect(again(text)).toBe(text);
  });

  test("a value that would read back as something else is quoted", () => {
    const spec: Spec = { commands: [{ speak: "Hei.", quiz: { question: "Q", right: "  padded", wrong: "42", choices: ["a", "b"], correct: 1 } }] } as unknown as Spec;
    const text = print(spec);
    expect(text).toContain('right "  padded"');
    expect(text).toContain('wrong "42"');
    expect(one(text).commands![0].quiz).toEqual(spec.commands![0].quiz);
  });

  test("a cued question stays on its one line", () => {
    const spec = { commands: [{ speak: "First this, then that." }, { cue: 0.5, ask: { question: "Q?", answer: "a", right: "Yes, that is the one." } }] } as unknown as Spec;
    const text = print(spec);
    expect(text).toContain('(@ask "Q?" answer a right "Yes, that is the one."@)');
    expect(print(one(text))).toBe(text);
  });
});

describe("animate and with:", () => {
  test("an animate's paths are pairs, each one literal key", () => {
    const text = `Hei.\n    animate tax.amount -15 demand.shift 3 duration 2.5\n`;
    expect(one(text).commands![0]).toMatchObject({ animate: { "tax.amount": -15, "demand.shift": 3 }, duration: 2.5 });
    expect(again(text)).toBe(text);
  });

  test("a nested animate map keeps its JSON", () => {
    const spec = { commands: [{ speak: "Hei.", animate: { tax: { amount: 3 } } }] } as unknown as Spec;
    expect(one(print(spec)).commands).toEqual(spec.commands);
  });

  test("with: as an indented YAML block, small lists inline", () => {
    const params = { x_label: "Pumps installed", demand: {}, units: { price: [0, 20000], price_unit: "$" }, readout: ["price_buyers"] };
    const spec = { template: "supply_demand", params, commands: [{ speak: "Hei." }] } as unknown as Spec;
    const text = print(spec);
    expect(text).toContain("with:\n    x_label: Pumps installed\n");
    expect(text).toContain("price: [0, 20000]");
    expect(one(text).params).toEqual(params);
  });
});
