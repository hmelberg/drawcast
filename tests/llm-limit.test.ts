import { describe, expect, it } from "vitest";
import { createGate } from "../src/llm/limit";

describe("createGate", () => {
  it("never runs more than the limit at once", async () => {
    const gate = createGate(2);
    let running = 0;
    let peak = 0;
    const task = () =>
      gate(async () => {
        running++;
        peak = Math.max(peak, running);
        await new Promise((r) => setTimeout(r, 5));
        running--;
        return true;
      });
    await Promise.all([task(), task(), task(), task(), task(), task()]);
    expect(peak).toBe(2);
  });

  it("runs every task and returns each result", async () => {
    const gate = createGate(2);
    const out = await Promise.all([1, 2, 3, 4, 5].map((n) => gate(async () => n * 2)));
    expect(out).toEqual([2, 4, 6, 8, 10]);
  });

  it("releases its slot when a task rejects", async () => {
    const gate = createGate(1);
    await expect(
      gate(async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    await expect(gate(async () => "after")).resolves.toBe("after");
  });
});
