// Books (spec 2026-10-01-book-layout §4): the text-pane verbs as plan steps.
import { describe, expect, test } from "vitest";
import { planCommands, textMarkEffect, type TextOp } from "../src/render/plan";
import { validateSpec } from "../src/spec/schema";
import { printScriptPage } from "../src/spec/script/print";
import { parseScriptPages } from "../src/spec/script/parse";
import type { Command, Spec } from "../src/spec/types";

const ops = (commands: Command[], ids: string[] = ["d"], book = true): TextOp[] =>
  planCommands(commands, ids, { book }).steps.flatMap((s) => (s.kind === "text" ? [s.op] : []));

describe("book text verbs", () => {
  test("write: blocks are w1, w2, … by place unless named; temp marks a scratch note", () => {
    expect(ops([{ write: "# Title" }, { write: { id: "formula", text: "$$x$$" } }, { write: { text: "65 = halfway", temp: true } }])).toEqual([
      { op: "write", id: "w1", text: "# Title", temp: false },
      { op: "write", id: "formula", text: "$$x$$", temp: false },
      { op: "write", id: "w3", text: "65 = halfway", temp: true },
    ]);
  });

  test("a write carries its speak: the block appears as the sentence starts", () => {
    const plan = planCommands([{ write: "## Two extremes", speak: "Some goods barely react." }], [], { book: true });
    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0]).toMatchObject({ kind: "text", narration: "Some goods barely react." });
  });

  test("highlight, erase and point on a text block become text steps; on an element they stay figure verbs", () => {
    const steps = planCommands(
      [
        { write: { id: "formula", text: "$$x$$" } },
        { highlight: { target: "formula", effect: "ring" } },
        { highlight: { target: "formula", part: "x", effect: "strike" } },
        { erase: ["formula"] },
        { point: { at: { ref: "formula" } } },
        { draw: ["d"] },
        { highlight: { target: "d" } },
      ],
      ["d"],
      { book: true },
    ).steps;
    expect(steps.map((s) => s.kind)).toEqual(["text", "text", "text", "text", "text", "draw", "highlight"]);
    const [, ring, strike, erase, point] = steps.map((s) => (s.kind === "text" ? s.op : null));
    expect(ring).toEqual({ op: "mark", ids: ["formula"], effect: "circle", keep: false });
    // a strike stays: it is a correction, not an emphasis
    expect(strike).toEqual({ op: "mark", ids: ["formula"], effect: "strike", keep: true, part: "x" });
    expect(erase).toEqual({ op: "erase", ids: ["formula"] });
    expect(point).toEqual({ op: "point", id: "formula" });
  });

  test("in a book, an id that is no element is an earlier part's block", () => {
    expect(ops([{ highlight: { target: "formula_from_part_1", keep: true } }])).toEqual([
      { op: "mark", ids: ["formula_from_part_1"], effect: "light", keep: true },
    ]);
  });

  test("view, and clear by pane: notes alone is a text step; both is a text step then the figure's clear, one voice", () => {
    expect(ops([{ view: "figure" }])).toEqual([{ op: "view", view: "figure" }]);
    expect(ops([{ clear: { pane: "notes" } }])).toEqual([{ op: "clear" }]);
    const plan = planCommands([{ draw: ["d"] }, { clear: { pane: "both" }, speak: "Something new." }], ["d"], { book: true });
    expect(plan.steps.map((s) => s.kind)).toEqual(["draw", "text", "clear"]);
    expect(plan.steps[1].narration).toBe("Something new.");
    expect(plan.steps[2].narration).toBeUndefined();
  });

  test("outside a book, write warns — nothing will show it", () => {
    const plan = planCommands([{ write: "# Title" }], ["d"], {});
    expect(plan.warnings.some((w) => w.includes("write is for books"))).toBe(true);
  });

  test("figure effects map onto a text block's four marks", () => {
    expect(textMarkEffect(undefined)).toBe("light");
    expect(textMarkEffect("glow")).toBe("light");
    expect(textMarkEffect("ring")).toBe("circle");
    expect(textMarkEffect("box")).toBe("box");
  });
});

describe("book specs validate and round-trip", () => {
  const spec = {
    title: "Elasticity",
    book: { layout: "columns", share: 40, look: "mixed" },
    elements: [{ id: "ax", type: "axes", x_label: "Q", y_label: "P" }],
    commands: [
      { write: "# Price elasticity", speak: "How much does quantity react?" },
      { write: { id: "formula", text: "$$\\varepsilon = \\frac{\\%\\Delta Q}{\\%\\Delta P}$$" } },
      { highlight: { target: "formula", effect: "circle" } },
      { view: "figure" },
      { clear: { pane: "both" } },
    ],
  } as unknown as Spec;

  test("validateSpec accepts the book field and the new verbs", () => {
    expect(validateSpec(spec).errors).toEqual([]);
  });

  test("the script format prints and reads them back", () => {
    const back = parseScriptPages(printScriptPage(spec)).pages[0].spec;
    expect(back.book).toEqual(spec.book);
    expect(back.commands).toEqual([
      { write: "# Price elasticity", speak: "How much does quantity react?" },
      { write: { id: "formula", text: "$$\\varepsilon = \\frac{\\%\\Delta Q}{\\%\\Delta P}$$" } },
      { highlight: { target: ["formula"], effect: "circle" } },
      { view: "figure" },
      { clear: { pane: "both" } },
    ]);
  });
});
