// tests/code-controls.test.ts
// The control grammar (spec 2026-09-14 §2.2–2.4): names in the spec, shapes
// in the script. Pure string functions — no DOM, no runtime.
import { describe, expect, test } from "vitest";
import { applyControls, grammarFor, parseControls, withControlDefaults } from "../src/code/controls";

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

  test('a "#" inside a string is not a comment', () => {
    const c = py('name = "a # b"  # trailing', ["name"]).controls[0];
    expect(c).toMatchObject({ kind: "text", default: "a # b" });
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

describe("parseControls — longhand", () => {
  test("Slider with step, default and label", () => {
    const c = py('n = Slider(1, 50, default=10, label="Cycles")', ["n"]).controls[0];
    expect(c).toMatchObject({ kind: "slider", min: 1, max: 50, step: 1, integer: true, default: 10, label: "Cycles" });
    expect('n = Slider(1, 50, default=10, label="Cycles")'.slice(c.start, c.end)).toBe('Slider(1, 50, default=10, label="Cycles")');
    expect(py("b = Slider(0.1, 1.0, step=0.05)", ["b"]).controls[0]).toMatchObject({ step: 0.05, integer: false, decimals: 2 });
  });
  test("Choice, Toggle, Text, Number, Button", () => {
    expect(py('m = Choice("SIR", "SEIR", label="Model")', ["m"]).controls[0]).toMatchObject({ kind: "choice", options: ["SIR", "SEIR"], default: "SIR", label: "Model" });
    expect(py('m = Choice("a", "b", default="b")', ["m"]).controls[0].default).toBe("b");
    expect(py('t = Toggle(True, label="Log")', ["t"]).controls[0]).toMatchObject({ kind: "toggle", default: true, label: "Log" });
    expect(py('s = Text("Alice", label="Name")', ["s"]).controls[0]).toMatchObject({ kind: "text", default: "Alice", label: "Name" });
    expect(py('k = Number(3, label="Seed")', ["k"]).controls[0]).toMatchObject({ kind: "number", default: 3, integer: true, label: "Seed" });
    expect(py('r = Button("Roll again")', ["r"]).controls[0]).toMatchObject({ kind: "button", default: 0, caption: "Roll again", label: "Roll again" });
  });
  test("bad longhand arguments are errors", () => {
    expect(py("n = Slider(1, 50, default=99)", ["n"]).issues[0]).toMatchObject({ severity: "error", message: expect.stringContaining("outside") });
    expect(py('m = Choice("a", "b", default="z")', ["m"]).issues[0]).toMatchObject({ severity: "error", message: expect.stringContaining("not one of") });
    expect(py("n = Slider(5)", ["n"]).issues[0]).toMatchObject({ severity: "error" });
    expect(py("n = Slider(1, 50, label=Cycles)", ["n"]).issues[0]).toMatchObject({ severity: "error", message: expect.stringContaining("label") });
  });
  test("longhand inside a def default", () => {
    const code = "def sim(beta=Slider(0.1, 1.0, step=0.05), days=(30, 200)):\n    pass";
    const { controls, issues } = py(code, ["beta", "days"]);
    expect(issues).toEqual([]);
    expect(controls[0]).toMatchObject({ kind: "slider", step: 0.05, birthplace: "param" });
    expect(code.split("\n")[0].slice(controls[0].start, controls[0].end)).toBe("Slider(0.1, 1.0, step=0.05)");
    expect(controls[1]).toMatchObject({ kind: "slider", min: 30, max: 200, integer: true });
  });
});

describe("parseControls — R", () => {
  const r = (code: string, names: string[]) => parseControls("r", code, names);
  test("c(a, b) is a range, c(\"a\", \"b\") a choice, TRUE a toggle; <- and = both assign", () => {
    expect(r("n <- c(1, 50)", ["n"]).controls[0]).toMatchObject({ kind: "slider", min: 1, max: 50, integer: true, default: 25 });
    expect(r("n = c(0.1, 1.0, 0.05)", ["n"]).controls[0]).toMatchObject({ kind: "slider", step: 0.05, integer: false });
    expect(r('m <- c("SIR", "SEIR")', ["m"]).controls[0]).toMatchObject({ kind: "choice", options: ["SIR", "SEIR"] });
    expect(r("lg <- TRUE", ["lg"]).controls[0]).toMatchObject({ kind: "toggle", default: true });
    expect(r('nm <- "Ann"', ["nm"]).controls[0]).toMatchObject({ kind: "text", default: "Ann" });
    expect(r("k <- 3", ["k"]).controls[0]).toMatchObject({ kind: "number", integer: true });
  });
  test("a function default is a birthplace; the function's own name is not", () => {
    const code = "sim <- function(n = c(1, 50), beta = 0.3) {\n  n * beta\n}\nsim()";
    const { controls, issues } = r(code, ["n", "beta"]);
    expect(issues).toEqual([]);
    expect(controls[0]).toMatchObject({ name: "n", kind: "slider", birthplace: "param" });
    expect(code.split("\n")[0].slice(controls[0].start, controls[0].end)).toBe("c(1, 50)");
    expect(controls[1]).toMatchObject({ name: "beta", kind: "number", integer: false });
  });
  test("longhand in R uses the same names", () => {
    expect(r('n <- Slider(1, 50, default = 10, label = "Cycles")', ["n"]).controls[0]).toMatchObject({ default: 10, label: "Cycles" });
    expect(r('b <- Button("Resample")', ["b"]).controls[0]).toMatchObject({ kind: "button", caption: "Resample" });
    expect(r("t <- Toggle(FALSE)", ["t"]).controls[0]).toMatchObject({ kind: "toggle", default: false });
  });
});

describe("applyControls / withControlDefaults", () => {
  test("rewrites the literal span with the value, in the language's own syntax, keeping the line count", () => {
    const code = "n = (1, 50)\nlog = False\nname = \"x\"\nm = [\"SIR\", \"SEIR\"]\nr = Button(\"Roll\")";
    const { controls } = py(code, ["n", "log", "name", "m", "r"]);
    const out = applyControls("python", code, controls, { n: 12, log: true, name: 'A"b', m: "SEIR", r: 3 });
    expect(out.split("\n")).toEqual(["n = 12", "log = True", 'name = "A\\"b"', 'm = "SEIR"', "r = 3"]);
  });
  test("a float slider value is written with the step's decimals", () => {
    const code = "beta = (0.1, 1.0, 0.05)";
    const { controls } = py(code, ["beta"]);
    expect(applyControls("python", code, controls, { beta: 0.35 })).toBe("beta = 0.35");
    expect(applyControls("python", code, controls, { beta: 0.3 })).toBe("beta = 0.30");
  });
  test("R writes TRUE/FALSE", () => {
    const code = "lg <- FALSE\nn <- c(1, 50)";
    const { controls } = parseControls("r", code, ["lg", "n"]);
    expect(applyControls("r", code, controls, { lg: true, n: 7 })).toBe("lg <- TRUE\nn <- 7");
  });
  test("two controls on one def line rewrite right-to-left so spans stay valid", () => {
    const code = "def sim(n=(1, 50), beta=Slider(0.1, 1.0, step=0.05)):\n    pass\nsim()";
    const { controls } = py(code, ["n", "beta"]);
    expect(applyControls("python", code, controls, { n: 3, beta: 0.2 }).split("\n")[0]).toBe("def sim(n=3, beta=0.20):");
  });
  test("a missing value falls back to the default", () => {
    const code = "n = (1, 50)";
    const { controls } = py(code, ["n"]);
    expect(applyControls("python", code, controls, {})).toBe("n = 25");
  });
  test("withControlDefaults applies defaults and is idempotent; no names → unchanged", () => {
    const code = "n = Slider(20, 2000, default=200)\nseed = Button(\"Draw again\")\nx = n + seed";
    const once = withControlDefaults("python", code, ["n", "seed"]);
    expect(once).toBe("n = 200\nseed = 0\nx = n + seed");
    expect(withControlDefaults("python", once, ["n", "seed"])).toBe(once);
    expect(withControlDefaults("python", code, undefined)).toBe(code);
    expect(withControlDefaults("python", code, [])).toBe(code);
    expect(withControlDefaults("basic", "10 N = 5", ["N"])).toBe("10 N = 5");
  });
  test("a name with an issue is left as written (the lint reports it)", () => {
    expect(withControlDefaults("python", "print(1)", ["n"])).toBe("print(1)");
  });
});
