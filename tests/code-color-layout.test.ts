// Syntax colouring reaches the layout as `runs` on a code element's SOURCE
// lines (layout/code.ts, ~codeStack.blocks.forEach) — one array per drawn
// row, computed from src/code/highlight.ts's tokenizer via codeLineRuns.
// Everything else a code element draws (the output pane, table cells, marks)
// stays untouched.

import { describe, expect, test } from "vitest";
import { codeLineRuns, wrapCodeLine } from "../src/layout/code";
import { layoutSpec } from "../src/layout/layout";
import { heuristicMeasure } from "../src/layout/measure";
import { flattenDrawables, COLORS, type TextDrawable } from "../src/layout/model";
import { tokenColor } from "../src/code/highlight";
import type { Spec } from "../src/spec/types";

const spec = (el: object): Spec => ({ elements: [{ id: "c1", type: "code", language: "python", code: "print(1)", ...el }], commands: [] }) as unknown as Spec;
const leaf = (s: Spec, id: string) => flattenDrawables(layoutSpec(s, heuristicMeasure).drawables).find((d) => d.id === id)! as TextDrawable;
const runText = (runs: { text: string; color?: string }[]) => runs.map((r) => r.text).join("");

describe("code element: source lines carry coloured runs", () => {
  test("a short unwrapped line gets one row of runs that concatenate back to the line", () => {
    const s = spec({ show: "code", code: "if x:\n    print(x)", language: "python" });
    const line1 = leaf(s, "c1_line_1");
    expect(line1.lines).toBeUndefined(); // not wrapped
    expect(line1.runs).toBeDefined();
    expect(line1.runs!.length).toBe(1);
    expect(runText(line1.runs![0])).toBe(line1.text);
    const ifRun = line1.runs![0].find((r) => r.text === "if");
    expect(ifRun?.color).toBe(tokenColor("keyword"));
    expect(tokenColor("keyword")).toBe(COLORS.accent);
  });

  test("microdata command coloring reaches the layout too", () => {
    const s = spec({ show: "code", code: "import db/X as x", language: "microdata" });
    const line1 = leaf(s, "c1_line_1");
    expect(runText(line1.runs![0])).toBe(line1.text);
    const importRun = line1.runs![0].find((r) => r.text === "import");
    expect(importRun?.color).toBe(tokenColor("command"));
    const dbRun = line1.runs![0].find((r) => r.text === "db");
    expect(dbRun?.color).toBe(tokenColor("path"));
  });

  test("an unknown/absent language still gets a runs array (one plain run per row, no colour override)", () => {
    const s = spec({ show: "code", code: "whatever(1)", language: undefined });
    const line1 = leaf(s, "c1_line_1");
    expect(line1.runs).toBeDefined();
    expect(runText(line1.runs![0])).toBe(line1.text);
    expect(line1.runs![0].every((r) => r.color === undefined)).toBe(true);
  });

  test("a wrapped line gets one run-array per DRAWN row, each concatenating to that row's own text", () => {
    // Force a wrap: default codePaneW=880, fontSize=17 → ~80-char budget.
    const long = "x = " + Array.from({ length: 30 }, (_, i) => `term_${i}`).join(" + ");
    const s = spec({ show: "code", code: long, language: "python" });
    const line1 = leaf(s, "c1_line_1");
    expect(line1.lines).toBeDefined();
    expect(line1.lines!.length).toBeGreaterThan(1);
    expect(line1.runs!.length).toBe(line1.lines!.length);
    line1.lines!.forEach((row, i) => {
      expect(runText(line1.runs![i])).toBe(row);
    });
  });

  test("only the source pane carries runs — the output pane, table cells and marks do not", () => {
    const OK = JSON.stringify({ ok: true, stdout: "hello\nworld", stderr: "", figures: [] });
    const s = spec({ show: "left", code: "print('hi')", language: "python", code_result: OK });
    const out0 = leaf(s, "c1__out0");
    expect((out0 as TextDrawable).runs).toBeUndefined();
  });
});

describe("codeLineRuns: the row split", () => {
  test("a single unwrapped row is exactly the tokenizer's output, coloured", () => {
    const line = "def foo(x):";
    const rows = wrapCodeLine(line, 200);
    const runs = codeLineRuns(line, rows, "python");
    expect(runs.length).toBe(1);
    expect(runText(runs[0])).toBe(line);
    expect(runs[0].find((r) => r.text === "def")?.color).toBe(tokenColor("keyword"));
  });

  test("every row's runs concatenate to that row's own text, for a genuinely wrapped line", () => {
    const line = "value = " + Array.from({ length: 20 }, (_, i) => `part${i}`).join(" + ");
    const rows = wrapCodeLine(line, 24);
    expect(rows.length).toBeGreaterThan(1);
    const runs = codeLineRuns(line, rows, "python");
    expect(runs.length).toBe(rows.length);
    rows.forEach((row, i) => {
      expect(runText(runs[i])).toBe(row);
    });
  });

  test("a language with no tokens to offer (unknown) still returns one run per row, matching row text", () => {
    const line = "whatever content here that is reasonably long for a wrap";
    const rows = wrapCodeLine(line, 20);
    expect(rows.length).toBeGreaterThan(1);
    const runs = codeLineRuns(line, rows, "not-a-real-language");
    rows.forEach((row, i) => {
      expect(runText(runs[i])).toBe(row);
      expect(runs[i].every((r) => r.color === undefined)).toBe(true);
    });
  });

  test("an empty line yields one row with one empty run", () => {
    const runs = codeLineRuns("", [""], "python");
    expect(runs).toEqual([[{ text: "", color: undefined }]]);
  });
});
