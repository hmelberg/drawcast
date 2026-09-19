import { describe, expect, test } from "vitest";
import { fieldLines, formatValue, parseValue, setPath, splitTokens } from "../src/spec/script/values";

describe("tokenizing a direction's arguments", () => {
  test("splits on spaces but keeps quoted strings whole", () => {
    expect(splitTokens('a "to ord" 30')).toEqual(["a", '"to ord"', "30"]);
  });
  test("keeps bracketed JSON whole, spaces and all", () => {
    expect(splitTokens('points [[0, 0], [10, 5]] closed true')).toEqual(["points", "[[0, 0], [10, 5]]", "closed", "true"]);
  });
  test("keeps braced JSON whole", () => {
    expect(splitTokens('at {"ref": "a", "side": "above"}')).toEqual(["at", '{"ref": "a", "side": "above"}']);
  });
  test("an escaped quote does not end the string", () => {
    expect(splitTokens('text "han sa \\"hei\\"" x 1')).toEqual(['text', '"han sa \\"hei\\""', "x", "1"]);
  });
});

describe("reading and writing a value", () => {
  test("numbers, booleans and bare words", () => {
    expect(parseValue("30")).toBe(30);
    expect(parseValue("-1.5")).toBe(-1.5);
    expect(parseValue("true")).toBe(true);
    expect(parseValue("rect")).toBe("rect");
  });
  test("a quoted string keeps its spaces and loses its quotes", () => {
    expect(parseValue('"Lønn og inntekt"')).toBe("Lønn og inntekt");
  });
  test("a quoted number stays a string", () => {
    expect(parseValue('"30"')).toBe("30");
  });
  test("inline JSON", () => {
    expect(parseValue('[[0, 0], [10, 5]]')).toEqual([[0, 0], [10, 5]]);
    expect(parseValue('{"a": 1}')).toEqual({ a: 1 });
  });
  test("every value survives a round trip through formatValue", () => {
    for (const v of [30, -1.5, true, false, "rect", "to ord", "30", "true", "", [[0, 0]], { a: 1 }, {}, []]) {
      expect(parseValue(formatValue(v))).toEqual(v);
    }
  });
  test("a string that would read as something else is quoted", () => {
    expect(formatValue("30")).toBe('"30"');
    expect(formatValue("true")).toBe('"true"');
    expect(formatValue("")).toBe('""');
  });
});

describe("dotted paths", () => {
  test("an all-scalar object flattens to one line per leaf", () => {
    expect(fieldLines("style", { color: "#2f6b8f", stroke_width: 3 })).toEqual([
      // A hex colour needs no quotes: it has no spaces and reads back as itself.
      { path: "style.color", token: "#2f6b8f" },
      { path: "style.stroke_width", token: "3" },
    ]);
  });
  test("an empty object is a leaf, not something that vanishes", () => {
    // It prints as its own token rather than being flattened INTO nothing:
    // `params: {supply: {}}` is a real corpus value and must survive.
    expect(fieldLines("params", { supply: {} })).toEqual([{ path: "params.supply", token: "{}" }]);
    expect(fieldLines("params", {})).toEqual([{ path: "params", token: "{}" }]);
  });

  test("a key that is not a plain identifier is never flattened", () => {
    // `animate` keys ARE dot paths and math `colors` keys are TeX with
    // spaces — flattening either would split a literal key.
    expect(fieldLines("animate", { "demand_shift.amount": 22 })).toEqual([{ path: "animate", token: '{"demand_shift.amount":22}' }]);
    expect(fieldLines("colors", { "\\Delta C": "#b5482e" })).toEqual([{ path: "colors", token: '{"\\\\Delta C":"#b5482e"}' }]);
  });
  test("an array is written whole", () => {
    expect(fieldLines("points", [[0, 0], [10, 5]])).toEqual([{ path: "points", token: "[[0,0],[10,5]]" }]);
  });
  test("a scalar is one line", () => {
    expect(fieldLines("x", 220)).toEqual([{ path: "x", token: "220" }]);
  });
  test("setPath rebuilds what fieldLines took apart", () => {
    const target: Record<string, unknown> = {};
    for (const { path, token } of fieldLines("style", { color: "red", dash: true })) setPath(target, path, parseValue(token));
    expect(target).toEqual({ style: { color: "red", dash: true } });
  });
});
