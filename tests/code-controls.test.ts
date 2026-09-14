// tests/code-controls.test.ts
// The control grammar (spec 2026-09-14 §2.2–2.4): names in the spec, shapes
// in the script. Pure string functions — no DOM, no runtime.
import { describe, expect, test } from "vitest";
import { grammarFor, parseControls } from "../src/code/controls";

const py = (code: string, names: string[]) => parseControls("python", code, names);

describe("grammarFor", () => {
  test("the python family shares one grammar; r its own; basic none", () => {
    expect(grammarFor("python")).toBe("python");
    expect(grammarFor("brython")).toBe("python");
    expect(grammarFor("micropython")).toBe("python");
    expect(grammarFor("microdata")).toBe("python");
    expect(grammarFor("r")).toBe("r");
    expect(grammarFor("basic")).toBeNull();
    expect(grammarFor("cobol")).toBeNull();
  });
});

describe("parseControls — python shorthand", () => {
  test("a two-integer tuple is an integer slider with step 1 and the midpoint default", () => {
    const { controls, issues } = py("n = (1, 50)\nprint(n)", ["n"]);
    expect(issues).toEqual([]);
    expect(controls).toHaveLength(1);
    const c = controls[0];
    expect(c).toMatchObject({ name: "n", kind: "slider", label: "n", min: 1, max: 50, step: 1, integer: true, default: 25, line: 0, birthplace: "assign" });
    expect("n = (1, 50)".slice(c.start, c.end)).toBe("(1, 50)");
  });

  test("a decimal point anywhere makes a float slider; the third number is the step", () => {
    expect(py("beta = (0.1, 1.0, 0.05)", ["beta"]).controls[0]).toMatchObject({ kind: "slider", min: 0.1, max: 1, step: 0.05, integer: false, decimals: 2 });
    expect(py("x = (1, 5, 0.5)", ["x"]).controls[0]).toMatchObject({ integer: false, step: 0.5, default: 3 });
    expect(py("x = (0, 100, 5)", ["x"]).controls[0]).toMatchObject({ integer: true, step: 5, default: 50 });
  });

  test("a float slider without a step gets a nice hundredth of the range", () => {
    expect(py("x = (0.1, 1.0)", ["x"]).controls[0].step).toBe(0.01);
    expect(py("x = (0.0, 49.0)", ["x"]).controls[0].step).toBe(0.5);
  });

  test("a list of strings is a choice row, default the first item", () => {
    expect(py('model = ["SIR", "SEIR"]', ["model"]).controls[0]).toMatchObject({ kind: "choice", options: ["SIR", "SEIR"], default: "SIR" });
    expect(py("m = ['a', 'b', 'c']", ["m"]).controls[0].options).toEqual(["a", "b", "c"]);
  });

  test("a bool is a toggle, a string a text field, a number a number field (never a guessed range)", () => {
    expect(py("log = False", ["log"]).controls[0]).toMatchObject({ kind: "toggle", default: false });
    expect(py("log = True", ["log"]).controls[0]).toMatchObject({ kind: "toggle", default: true });
    expect(py('name = "Alice"', ["name"]).controls[0]).toMatchObject({ kind: "text", default: "Alice" });
    expect(py("seed = 3", ["seed"]).controls[0]).toMatchObject({ kind: "number", default: 3, integer: true });
    expect(py("rate = 2.5", ["rate"]).controls[0]).toMatchObject({ kind: "number", default: 2.5, integer: false });
  });

  test("a trailing comment does not reach the literal", () => {
    const c = py("n = (1, 50)  # cycles", ["n"]).controls[0];
    expect(c).toMatchObject({ kind: "slider", max: 50 });
    expect("n = (1, 50)  # cycles".slice(c.start, c.end)).toBe("(1, 50)");
  });

  test("a default argument in a def line is a birthplace too", () => {
    const code = "def simulate(n=(1, 50), beta=(0.1, 1.0)):\n    return n * beta\nsimulate()";
    const { controls, issues } = py(code, ["n", "beta"]);
    expect(issues).toEqual([]);
    expect(controls.map((c) => c.birthplace)).toEqual(["param", "param"]);
    expect(controls[1]).toMatchObject({ name: "beta", line: 0 });
    expect(code.split("\n")[0].slice(controls[1].start, controls[1].end)).toBe("(0.1, 1.0)");
  });

  test("controls come back in the order of `names`, not the order in the script", () => {
    const { controls } = py("b = 1\na = 2", ["a", "b"]);
    expect(controls.map((c) => c.name)).toEqual(["a", "b"]);
  });
});

describe("parseControls — issues", () => {
  test("a name with no birthplace is an error", () => {
    const { controls, issues } = py("print(1)", ["n"]);
    expect(controls).toEqual([]);
    expect(issues).toEqual([{ name: "n", message: expect.stringContaining("no birthplace"), severity: "error" }]);
  });

  test("a name born twice is an error (two assignments, or an assignment and a default)", () => {
    expect(py("n = (1, 5)\nn = (2, 6)", ["n"]).issues[0]).toMatchObject({ name: "n", severity: "error", message: expect.stringContaining("twice") });
    expect(py("n = (1, 5)\ndef f(n=3):\n    pass", ["n"]).issues[0]).toMatchObject({ name: "n", severity: "error" });
  });

  test("an assignment that is not a control literal is not a birthplace; a later plain literal warns", () => {
    const { controls, issues } = py("x = (1, 50)\nx = x * 2", ["x"]);
    expect(controls).toHaveLength(1);
    expect(issues).toEqual([]);
    const later = py("x = (1, 50)\nx = 5", ["x"]);
    expect(later.controls).toHaveLength(1);
    expect(later.issues).toEqual([{ name: "x", message: expect.stringContaining("reassigned"), severity: "warn" }]);
  });

  test("a literal outside the grammar is an error", () => {
    expect(py("x = {'a': 1}", ["x"]).issues[0]).toMatchObject({ name: "x", severity: "error", message: expect.stringContaining("not a control literal") });
    expect(py("x = [1, 2]", ["x"]).issues[0]).toMatchObject({ severity: "error" });
    expect(py("x = f(2)", ["x"]).issues[0]).toMatchObject({ severity: "error" });
  });

  test("an unsupported language reports every name as an error", () => {
    expect(parseControls("basic", "10 N = 5", ["N"]).issues[0]).toMatchObject({ name: "N", severity: "error", message: expect.stringContaining("basic") });
  });

  test("a later invalid-but-control-shaped literal warns instead of being silently dropped", () => {
    const { controls, issues } = py("n = (1, 50)\nn = (5, 1)", ["n"]);
    expect(controls).toHaveLength(1);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ name: "n", severity: "warn" });
    expect(issues[0].message).toContain("line 2");
    expect(issues[0].message).toContain("min < max");

    const dict = py("n = (1, 50)\nn = {'a': 1}", ["n"]);
    expect(dict.controls).toHaveLength(1);
    expect(dict.issues).toEqual([]);
  });

  test("a later longhand call is a second birth, even when its kind is not itself a shape", () => {
    expect(py("log = False\nlog = Toggle(True)", ["log"]).issues[0]).toMatchObject({ name: "log", severity: "error", message: expect.stringContaining("twice") });
    expect(py("x = (1, 50)\nx = 5", ["x"]).issues[0]).toMatchObject({ name: "x", severity: "warn" });
  });
});
