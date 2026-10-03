// The format a cast's structure says it is (src/standalone/transcript.ts castFormat).
import { describe, expect, test } from "vitest";
import { castFormat } from "../src/standalone/transcript";

const say = (t = "A line.") => ({ speak: t, draw: [] });
const ask = () => ({ ask: { question: "Which?", options: ["a", "b"] } });
const spec = (...commands: unknown[]) => ({ commands });
const lines = (n: number) => Array.from({ length: n }, () => say());

describe("castFormat", () => {
  test("a book is an Xplanation", () => {
    expect(castFormat([{ book: { layout: "column" }, commands: [] }], 10)).toBe("xplanation");
  });
  test("no question: a Drawcast", () => {
    expect(castFormat([spec(...lines(14))], 14)).toBe("drawcast");
  });
  test("short and question-led: a Quiz (the old rule)", () => {
    expect(castFormat([spec(say(), ask(), ...lines(3))], 4)).toBe("quiz");
  });
  test("one question up front in 14 lines: a Quiz (the quiz batch)", () => {
    expect(castFormat([spec(say(), say(), ask(), ...lines(12))], 14)).toBe("quiz");
  });
  test("five questions in 20 lines: a Quiz (True or myth?)", () => {
    const cmds = [say(), say(), ...Array.from({ length: 5 }, () => [ask(), say(), say(), say()]).flat(), say(), say()];
    expect(castFormat([spec(...cmds)], 20)).toBe("quiz");
  });
  test("a long explanation that ends in a quiz stays a Drawcast", () => {
    expect(castFormat([spec(...lines(16), ask(), say())], 17)).toBe("drawcast");
  });
  test("one question early in a long cast stays a Drawcast", () => {
    expect(castFormat([spec(say(), ask(), ...lines(18))], 19)).toBe("drawcast");
  });
});
