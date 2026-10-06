import { describe, expect, it } from "vitest";
import type { JobStatus } from "../src/llm/job-transport";
import { meterText } from "../src/ui/credit-meter";

const label = (id: string) => (id === "claude-opus-5-5" ? "Opus 5.5" : id);
const job = (phase: JobStatus["phase"], elapsedMs: number, chars = 0): JobStatus => ({ job: "j", model: "claude-opus-5-5", phase, elapsedMs, chars });

describe("meterText", () => {
  it("names the phase of a single call", () => {
    expect(meterText([job("queued", 1200)], 0, null, label)).toBe("AI on credit · Opus 5.5 · waiting for the model… 1 s");
    expect(meterText([job("thinking", 23_400)], 0, null, label)).toBe("AI on credit · Opus 5.5 · thinking… 23 s");
    expect(meterText([job("writing", 41_000, 7360)], 0, null, label)).toBe("AI on credit · Opus 5.5 · writing… ~1,840 tokens · 41 s");
  });

  it("sums up parallel calls", () => {
    const text = meterText([job("writing", 5000), job("thinking", 9000), job("writing", 2000)], 12.4, null, label);
    expect(text).toBe("AI on credit · 3 calls: 2 writing, 1 thinking · 9 s · charged 12 credits so far");
  });

  it("after the run, says what it cost and what is left", () => {
    expect(meterText([], 143.2, 1227, label)).toBe("AI on credit · charged 143 credits for this run · 1,227 left");
    expect(meterText([], 0, 1227, label)).toBe("");
  });
});
