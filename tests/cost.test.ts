// The call ledger's cost estimate: list prices by model prefix, cache reads
// at a tenth, cache writes at 1.25×, unknown models priced as Opus.
import { describe, expect, test } from "vitest";
import { callLedger, costSummary, formatCost, priceFor, resetCallLedger, type CallUsage } from "../src/llm/client";

const call = (model: string, input: number, cacheRead: number, cacheWrite: number, output: number): CallUsage => ({ model, input, cacheRead, cacheWrite, output, ms: 1 });

describe("priceFor", () => {
  test("matches by prefix, dated ids and fallbacks included; unknown is priced as Opus", () => {
    expect(priceFor("claude-opus-5")).toEqual({ input: 5, output: 25 });
    expect(priceFor("claude-sonnet-5")).toEqual({ input: 2, output: 10 });
    expect(priceFor("claude-haiku-4-5-20251001")).toEqual({ input: 1, output: 5 });
    expect(priceFor("claude-fable-5-1")).toEqual({ input: 10, output: 50 });
    expect(priceFor("something-else")).toEqual({ input: 5, output: 25 });
  });
});

describe("costSummary", () => {
  test("sums tokens and prices each call by its own model", () => {
    const s = costSummary([call("claude-opus-5", 10_000, 40_000, 0, 4_000), call("claude-haiku-4-5", 100, 13_000, 0, 200)]);
    expect(s.calls).toBe(2);
    expect(s.input).toBe(10_100);
    expect(s.cacheRead).toBe(53_000);
    expect(s.output).toBe(4_200);
    // opus: 10k×5 + 40k×0.5 + 4k×25 = 50k+20k+100k = 170k µ$ = 0.170; haiku: 100×1 + 13k×0.1 + 200×5 = 100+1300+1000 = 2.4k µ$ = 0.0024
    expect(s.usd).toBeCloseTo(0.1724, 4);
  });
  test("cache writes cost 1.25× the input price", () => {
    expect(costSummary([call("claude-opus-5", 0, 0, 1_000_000, 0)]).usd).toBeCloseTo(6.25, 6);
  });
  test("an empty ledger is free and formats to nothing", () => {
    const s = costSummary([]);
    expect(s.usd).toBe(0);
    expect(formatCost(s)).toBe("");
  });
});

describe("formatCost", () => {
  test("reads as an estimate with thousands and the cached share", () => {
    const text = formatCost(costSummary([call("claude-opus-5", 9_000, 52_000, 0, 8_000)]));
    expect(text).toMatch(/^≈ \$\d+\.\d\d · 61k tokens in \(52k cached\) · 8k out · 1 call$/);
  });
  test("a fraction of a cent reads as <$0.01", () => {
    expect(formatCost(costSummary([call("claude-haiku-4-5", 100, 0, 0, 10)]))).toMatch(/^≈ <\$0\.01/);
  });
});

describe("the ledger", () => {
  test("resets to empty", () => {
    resetCallLedger();
    expect(callLedger()).toEqual([]);
  });
});
