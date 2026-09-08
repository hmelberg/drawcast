// The shared state of one run's template authoring: the cap, the lock that
// authors one template at a time across parallel lectures, and the summary
// the status line appends.
import { describe, expect, test } from "vitest";
import { createOnDemandRun, DEFAULT_ON_DEMAND_MAX, onDemandSummary } from "../src/llm/on-demand-run";

const tick = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("the cap", () => {
  test("defaults to three", () => {
    expect(DEFAULT_ON_DEMAND_MAX).toBe(3);
    const run = createOnDemandRun();
    expect(run.max).toBe(3);
    expect(run.left).toBe(3);
  });
  test("take() hands out exactly max slots", () => {
    const run = createOnDemandRun(2);
    expect(run.take()).toBe(true);
    expect(run.take()).toBe(true);
    expect(run.take()).toBe(false);
    expect(run.take()).toBe(false);
    expect(run.left).toBe(0);
  });
  test("zero means no slot at all", () => {
    expect(createOnDemandRun(0).take()).toBe(false);
  });
  test("a nonsense max falls back to the default rather than to unlimited", () => {
    expect(createOnDemandRun(Number.NaN).max).toBe(DEFAULT_ON_DEMAND_MAX);
    expect(createOnDemandRun(-4).max).toBe(DEFAULT_ON_DEMAND_MAX);
    expect(createOnDemandRun(2.7).max).toBe(2);
  });
});

describe("the lock", () => {
  test("runs the callers one at a time, in arrival order", async () => {
    const run = createOnDemandRun();
    const log: string[] = [];
    await Promise.all([
      run.lock(async () => {
        log.push("a:in");
        await tick(15);
        log.push("a:out");
      }),
      run.lock(async () => {
        log.push("b:in");
        await tick(1);
        log.push("b:out");
      }),
      run.lock(async () => {
        log.push("c:in");
        log.push("c:out");
      }),
    ]);
    expect(log).toEqual(["a:in", "a:out", "b:in", "b:out", "c:in", "c:out"]);
  });
  test("returns the callback's value", async () => {
    const run = createOnDemandRun();
    expect(await run.lock(async () => 42)).toBe(42);
  });
  test("a throw releases the lock for the next caller and reaches the thrower only", async () => {
    const run = createOnDemandRun();
    const failing = run.lock(async () => {
      throw new Error("boom");
    });
    const next = run.lock(async () => "after");
    await expect(failing).rejects.toThrow("boom");
    expect(await next).toBe("after");
  });
});

describe("the summary", () => {
  test("is empty when nothing was authored or skipped", () => {
    expect(onDemandSummary(createOnDemandRun())).toBe("");
  });
  test("counts what was authored", () => {
    const run = createOnDemandRun();
    run.authored = 1;
    expect(onDemandSummary(run)).toBe(" · 1 template authored");
    run.authored = 2;
    expect(onDemandSummary(run)).toBe(" · 2 templates authored");
  });
  test("names the cap when parts were left freehand because of it", () => {
    const run = createOnDemandRun(3);
    run.authored = 3;
    run.skipped = 1;
    expect(onDemandSummary(run)).toBe(" · 3 templates authored · 1 part left freehand (cap 3)");
    run.skipped = 2;
    expect(onDemandSummary(run)).toContain("2 parts left freehand (cap 3)");
  });
});
