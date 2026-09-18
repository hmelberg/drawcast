// The code pane's syntax colouring: a pure, per-line tokenizer ported from
// microdata's own editor backdrop (index.html highlightScriptPyR /
// highlightCodeLine for Python & R, highlightCommandTokens for the
// microdata command language) plus a small palette. See src/code/highlight.ts
// for the design notes (why triple-quote state does not cross lines, why the
// microdata reference's four reserved-word colours collapse into one
// "keyword" kind here).

import { describe, expect, test } from "vitest";
import { tokenColor, tokenizeLine, type Token, type TokenKind } from "../src/code/highlight";

/** The one invariant every caller depends on: token texts concatenate back
 *  to the exact source line, whitespace included. */
function assertConcatenates(line: string, language: string): Token[] {
  const tokens = tokenizeLine(line, language);
  expect(tokens.map((t) => t.text).join("")).toBe(line);
  return tokens;
}

const kindsOf = (tokens: Token[], text: string): TokenKind[] => tokens.filter((t) => t.text === text).map((t) => t.kind);

describe("tokenizeLine: the concatenation invariant", () => {
  const cases: [string, string][] = [
    ["def foo(x):", "python"],
    ["    return x + 1  # trailing comment", "python"],
    ['s = "a \\"quoted\\" word" + str(3.14e-2)', "python"],
    ["y = '''triple\nstring'''", "python"], // opens but does not close on THIS single-line call
    ["", "python"],
    ["   ", "python"],
    ["import numpy as np", "brython"],
    ["for i in range(10): print(i)", "micropython"],
    ["if (x > 1) return(TRUE)", "r"],
    ["df$col <- mean(df$col, na.rm = TRUE)  # note", "r"],
    ["require no.ssb.fdb:54 as db", "microdata"],
    ["create-dataset persons", "microdata"],
    ["import db/BEFOLKNING_KJOENN as sex", "microdata"],
    ["import db/INNTEKT_WLONN 2022-01-01 as wage", "microdata"],
    ["histogram wage", "microdata"],
    ['tabulate sex by wage, rowpct chi2 // a comment', "microdata"],
    ["10 PRINT \"HI\"", "basic"],
    ["20 FOR I = 1 TO 10", "basic"],
    ["30 REM a remark to the end of the line", "basic"],
    ["10 print \"hi\" : goto 10", "basic"],
    ["some text in an unknown language", "sql"],
    ["some text in an unknown language", ""],
  ];
  for (const [line, language] of cases) {
    test(`"${line}" (${language || "(none)"}) round-trips`, () => {
      assertConcatenates(line, language);
    });
  }
});

describe("tokenizeLine: unknown/absent language", () => {
  test("one plain token for the whole line", () => {
    expect(tokenizeLine("whatever(1)", "sql")).toEqual([{ text: "whatever(1)", kind: "plain" }]);
    expect(tokenizeLine("whatever(1)", "")).toEqual([{ text: "whatever(1)", kind: "plain" }]);
  });
  test("even an empty line still yields one (empty) token", () => {
    expect(tokenizeLine("", "python")).toEqual([{ text: "", kind: "plain" }]);
    expect(tokenizeLine("", "unknown")).toEqual([{ text: "", kind: "plain" }]);
  });
});

describe("tokenizeLine: python (shared by brython/micropython)", () => {
  test("keyword, function-call and a plain identifier", () => {
    const t = assertConcatenates("def foo(x):", "python");
    expect(kindsOf(t, "def")).toEqual(["keyword"]);
    expect(kindsOf(t, "foo")).toEqual(["function"]);
    expect(kindsOf(t, "x")).toEqual(["plain"]); // not a keyword/builtin and not itself called
  });
  test("a builtin without a call still colours as function", () => {
    const t = assertConcatenates("y = len", "python");
    expect(kindsOf(t, "len")).toEqual(["function"]);
  });
  test("comment runs to end of line", () => {
    const t = assertConcatenates("x = 1  # note", "python");
    expect(t[t.length - 1]).toEqual({ text: "# note", kind: "comment" });
  });
  test("string and number literals", () => {
    const t = assertConcatenates('s = "hi" + str(3.14e-2)', "python");
    expect(kindsOf(t, '"hi"')).toEqual(["string"]);
    expect(kindsOf(t, "3.14e-2")).toEqual(["number"]);
  });
  test("a triple-quoted string closing on the SAME line is one string token", () => {
    const t = assertConcatenates('x = """abc""" + 1', "python");
    expect(kindsOf(t, '"""abc"""')).toEqual(["string"]);
  });
  test("a triple-quote that does not close on this line colours the rest of the line as a string, with no cross-line memory", () => {
    const opener = tokenizeLine('a = """opening only', "python");
    expect(opener[opener.length - 1].kind).toBe("string");
    // The NEXT physical line is tokenized on its own — nothing carries over,
    // so ordinary code inside the (still logically open) string is coloured
    // as code, not string. This is the documented, deliberate scope cut.
    const inside = tokenizeLine("def not_really_a_def():", "python");
    expect(kindsOf(inside, "def")).toEqual(["keyword"]);
  });
  test("brython and micropython use the same rules as python", () => {
    for (const language of ["brython", "micropython"]) {
      const t = assertConcatenates("class Foo(object):", language);
      expect(kindsOf(t, "class")).toEqual(["keyword"]);
    }
  });
});

describe("tokenizeLine: r", () => {
  test("keywords (including TRUE/FALSE) take priority over the call/builtin check", () => {
    const t = assertConcatenates("if (x > 1) return(TRUE)", "r");
    expect(kindsOf(t, "if")).toEqual(["keyword"]);
    expect(kindsOf(t, "return")).toEqual(["keyword"]); // R_KEYWORDS wins even though it's called
    expect(kindsOf(t, "TRUE")).toEqual(["keyword"]);
    // "x" itself is not isolated as its own token — adjacent unstyled
    // characters merge into one plain run — but wherever it lands, it must
    // stay plain (not, say, mistaken for a call because of the "(" nearby).
    const xTok = t.find((tok) => tok.text.includes("x"));
    expect(xTok?.kind).toBe("plain");
  });
  test("a modest builtin set colours common base-R calls as functions", () => {
    const t = assertConcatenates("mean(x, na.rm = TRUE)", "r");
    expect(kindsOf(t, "mean")).toEqual(["function"]);
  });
  test("# comments, like python", () => {
    const t = assertConcatenates("y <- 1 # comment", "r");
    expect(t[t.length - 1]).toEqual({ text: "# comment", kind: "comment" });
  });
});

describe("tokenizeLine: microdata command language", () => {
  test("the five-line example script", () => {
    const lines = [
      "require no.ssb.fdb:54 as db",
      "create-dataset persons",
      "import db/BEFOLKNING_KJOENN as sex",
      "import db/INNTEKT_WLONN 2022-01-01 as wage",
      "histogram wage",
    ];
    for (const line of lines) assertConcatenates(line, "microdata");

    const l1 = tokenizeLine(lines[0], "microdata");
    expect(kindsOf(l1, "require")).toEqual(["command"]); // first word
    expect(kindsOf(l1, "as")).toEqual(["keyword"]);
    expect(kindsOf(l1, "db")).toEqual(["variable"]); // not before a slash here — a nickname

    const l2 = tokenizeLine(lines[1], "microdata");
    expect(kindsOf(l2, "create-dataset")).toEqual(["command"]); // hyphenated word, still one token
    expect(kindsOf(l2, "persons")).toEqual(["variable"]);

    const l3 = tokenizeLine(lines[2], "microdata");
    expect(kindsOf(l3, "import")).toEqual(["command"]);
    expect(kindsOf(l3, "db")).toEqual(["path"]); // THIS "db" sits right before "/" — a path prefix
    expect(kindsOf(l3, "/")).toEqual(["operator"]);
    expect(kindsOf(l3, "BEFOLKNING_KJOENN")).toEqual(["variable"]);
    expect(kindsOf(l3, "sex")).toEqual(["variable"]);

    const l4 = tokenizeLine(lines[3], "microdata");
    expect(kindsOf(l4, "2022")).toEqual(["number"]);
    expect(kindsOf(l4, "01")).toEqual(["number", "number"]); // both day and month groups
    expect(kindsOf(l4, "-")).toEqual(["plain", "plain"]); // the connecting hyphens are unstyled, ported as-is

    const l5 = tokenizeLine(lines[4], "microdata");
    expect(kindsOf(l5, "histogram")).toEqual(["command"]);
    expect(kindsOf(l5, "wage")).toEqual(["variable"]);
  });
  test("scrub-* verbs are commands anywhere on the line, not just first", () => {
    const t = assertConcatenates("import db/X as x scrub-jitter 0.1", "microdata");
    expect(kindsOf(t, "scrub-jitter")).toEqual(["command"]);
  });
  test("report/aggregate options collapse into one keyword kind", () => {
    const t = assertConcatenates("tabulate sex by wage, rowpct chi2", "microdata");
    expect(kindsOf(t, "by")).toEqual(["keyword"]);
    expect(kindsOf(t, "rowpct")).toEqual(["keyword"]);
    expect(kindsOf(t, "chi2")).toEqual(["keyword"]);
  });
  test("a quoted string and a // comment (guarded: not after a ':')", () => {
    const t = assertConcatenates('summarize wage "label text" // a note', "microdata");
    expect(kindsOf(t, '"label text"')).toEqual(["string"]);
    expect(t[t.length - 1]).toEqual({ text: "// a note", kind: "comment" });
    // "//" directly after a ':' is a path-like thing (e.g. a URL), not a
    // comment marker — the same guard the reference's stripInlineMdComment
    // uses.
    const guarded = assertConcatenates("open http://x", "microdata");
    expect(guarded.some((tok) => tok.kind === "comment")).toBe(false);
  });
  test("a word followed by '(' is a function call", () => {
    const t = assertConcatenates("generate z = log(income)", "microdata");
    expect(kindsOf(t, "log")).toEqual(["function"]);
  });
});

describe("tokenizeLine: C64 BASIC (a small, modest keyword set)", () => {
  test("line number, PRINT keyword and a string", () => {
    const t = assertConcatenates('10 PRINT "HI"', "basic");
    expect(kindsOf(t, "10")).toEqual(["number"]);
    expect(kindsOf(t, "PRINT")).toEqual(["keyword"]);
    expect(kindsOf(t, '"HI"')).toEqual(["string"]);
  });
  test("keywords are recognised case-insensitively but keep their typed case", () => {
    const t = assertConcatenates('10 print "hi"', "basic");
    expect(kindsOf(t, "print")).toEqual(["keyword"]);
  });
  test("REM starts a comment that runs to end of line", () => {
    const t = assertConcatenates("30 REM a remark", "basic");
    expect(t[t.length - 1]).toEqual({ text: "REM a remark", kind: "comment" });
  });
  test("FOR/TO and a plain variable", () => {
    const t = assertConcatenates("20 FOR I = 1 TO 10", "basic");
    expect(kindsOf(t, "FOR")).toEqual(["keyword"]);
    expect(kindsOf(t, "TO")).toEqual(["keyword"]);
    expect(kindsOf(t, "I")).toEqual(["variable"]);
  });
});

describe("tokenColor", () => {
  test("plain has no colour override", () => {
    expect(tokenColor("plain")).toBeUndefined();
  });
  test("every other kind has a colour, and the palette stays small (5-6 distinct colours)", () => {
    const kinds: TokenKind[] = ["keyword", "command", "variable", "number", "string", "comment", "operator", "function", "path"];
    const colors = kinds.map(tokenColor);
    for (const c of colors) expect(typeof c).toBe("string");
    expect(new Set(colors).size).toBeLessThanOrEqual(6);
  });
});
