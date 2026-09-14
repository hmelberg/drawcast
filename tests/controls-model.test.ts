import { describe, expect, test } from "vitest";
import { debounceMs, nextValues, readout, rowWidth } from "../src/ui/controls-model";
import { parseControls } from "../src/code/controls";

const c = (code: string, name: string) => parseControls("python", code, [name]).controls[0];

describe("controls-model", () => {
  test("row widths: sliders and text take a row, the rest flow two per row", () => {
    expect(rowWidth("slider")).toBe("full");
    expect(rowWidth("text")).toBe("full");
    for (const k of ["toggle", "choice", "number", "button"] as const) expect(rowWidth(k)).toBe("half");
  });
  test("debounce: pyodide and webR are slower to re-run", () => {
    expect(debounceMs("python")).toBe(400);
    expect(debounceMs("r")).toBe(400);
    expect(debounceMs("brython")).toBe(250);
  });
  test("readout follows the step's decimals; integers have none", () => {
    expect(readout(c("n = (1, 50)", "n"), 12)).toBe("12");
    expect(readout(c("b = (0.1, 1.0, 0.05)", "b"), 0.3)).toBe("0.30");
    expect(readout(c("b = (0.0, 49.0)", "b"), 12.24)).toBe("12.2");
  });
  test("nextValues: a slider parses its number, a toggle its boolean, a button counts up", () => {
    const n = c("n = (1, 50)", "n");
    expect(nextValues({}, n, "12")).toEqual({ n: 12 });
    const t = c("t = False", "t");
    expect(nextValues({ n: 12 }, t, true)).toEqual({ n: 12, t: true });
    const b = c('r = Button("Roll")', "r");
    expect(nextValues({}, b, "")).toEqual({ r: 1 });
    expect(nextValues({ r: 1 }, b, "")).toEqual({ r: 2 });
    const k = c("k = 3", "k");
    expect(nextValues({}, k, "abc")).toEqual({ k: 3 }); // unparsable → default
  });
});
