// Typing inside a script: what Tab, Shift-Tab and Enter do to the text, and
// what the word list offers. Pure — the popup, the caret geometry and the key
// routing are the live smoke's, like every other DOM half in ui/.

import { describe, expect, test } from "vitest";
import { completionsFor, enterEdit, indentWidth, localWords, tabEdit } from "../src/ui/code-complete";

const apply = (value: string, e: ReturnType<typeof tabEdit>): string =>
  e === null ? value : value.slice(0, e.start) + e.text + value.slice(e.end);

describe("Tab", () => {
  test("moves to the next tab stop, so a half-indented line lands on the grid", () => {
    const e = tabEdit("total = 0", 0, 0, 4)!;
    expect(apply("total = 0", e)).toBe("    total = 0");
    expect(e.selStart).toBe(4);
    // …from column 2, only two spaces: the stop, not a fixed four.
    expect(apply("  x", tabEdit("  x", 2, 2, 4)!)).toBe("    x");
  });

  test("R indents by two, Python by four", () => {
    expect(indentWidth("r")).toBe(2);
    for (const l of ["python", "brython", "micropython", "microdata"]) expect(indentWidth(l)).toBe(4);
  });

  test("a selection spanning lines shifts every line it touches", () => {
    const v = "a = 1\nb = 2\nc = 3";
    const e = tabEdit(v, 0, 8, 4)!; // caret through the second line
    expect(apply(v, e)).toBe("    a = 1\n    b = 2\nc = 3");
  });

  test("Shift-Tab takes one level off, and says nothing when there is none", () => {
    expect(apply("        x = 1", tabEdit("        x = 1", 10, 10, 4, true)!)).toBe("    x = 1");
    expect(tabEdit("x = 1", 3, 3, 4, true)).toBeNull();
    // A line indented by less than a full level loses exactly what it has.
    expect(apply("  x", tabEdit("  x", 3, 3, 4, true)!)).toBe("x");
  });

  test("dedenting a block never eats a line's text", () => {
    const v = "  a\n    b\nc";
    expect(apply(v, tabEdit(v, 0, v.length, 4, true)!)).toBe("a\nb\nc");
  });
});

describe("Enter", () => {
  test("keeps the block you are in", () => {
    const v = "    total += i";
    const e = enterEdit(v, v.length, v.length, 4, "python");
    expect(e.text).toBe("\n    ");
  });

  test("opens one level deeper after a colon — and after a brace in R", () => {
    expect(enterEdit("for i in range(3):", 18, 18, 4, "python").text).toBe("\n    ");
    expect(enterEdit("  if (x) {", 10, 10, 2, "r").text).toBe("\n    ");
    expect(enterEdit("  if (x) {", 10, 10, 2, "python").text).toBe("\n  "); // a brace opens nothing in Python
  });
});

describe("the word list", () => {
  const py = (text: string, caret = text.length, force = false) => completionsFor({ text, caret, language: "python", force });
  const words = (r: ReturnType<typeof py>) => r?.items.map((i) => i.word) ?? [];

  test("waits for two characters, unless asked outright", () => {
    expect(py("p")).toBeNull();
    expect(words(py("p", 1, true))).toContain("print");
    expect(words(py("pri"))).toContain("print");
  });

  test("the script's own words come before the language's", () => {
    const r = py("total_sold = 3\ntot");
    expect(words(r)[0]).toBe("total_sold");
    expect(r!.start).toBe("total_sold = 3\n".length);
  });

  test("never offers the word already typed in full, nor a number", () => {
    expect(py("print")).toBeNull(); // nothing left to complete
    expect(py("x = 12")).toBeNull();
  });

  test("says nothing inside a comment or a string", () => {
    expect(py("# prin")).toBeNull();
    expect(py("s = 'prin")).toBeNull();
    expect(py("s = 'a'\npri")).not.toBeNull(); // the closed string does not swallow the line after
  });

  test("after a dot only the script's own words — an attribute is never a keyword", () => {
    const r = py("import numpy as np\nvalues = np.ar", undefined, false);
    expect(words(r)).toEqual([]); // 'ar' matches nothing in this script yet
    const r2 = py("data.average = 1\ndata.av");
    expect(words(r2)).toEqual(["average"]);
    expect(words(py("imp"))).toContain("import");
    expect(words(py("x.imp"))).not.toContain("import");
  });

  test("R's names carry dots, so the token scan keeps them", () => {
    const r = completionsFor({ text: "d <- data.fr", caret: 12, language: "r" });
    expect(r?.items.map((i) => i.word)).toContain("data.frame");
  });

  test("microdata brings its own vocabulary — pinned to the emulator in microdata-vocabulary.test.ts", () => {
    const cmd = completionsFor({ text: "imp", caret: 3, language: "microdata" });
    expect(cmd?.items.map((i) => i.word)).toEqual(expect.arrayContaining(["import", "import-panel"]));
    // The script's own words still come first, wherever the caret is.
    expect(completionsFor({ text: "generate x = 1\nsummarize x\nimportant = 2\ngenerate y = impo", caret: 57, language: "microdata" })?.items[0])
      .toEqual({ word: "important", kind: "local" });
  });

  test("every identifier in the script is a candidate, once", () => {
    expect(localWords("a = 1\nab = a + a\n", "python").sort()).toEqual(["ab"]);
  });
});
