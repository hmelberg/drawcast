import { describe, expect, test } from "vitest";
import { apiSchema, fewshotsText, promptVariants, CODE_PROMPT_SOURCE } from "../src/llm/compile";
import { catalogParts } from "../src/scenes/catalog";
import { buildSystemPrompt, wantsCode } from "../src/llm/prompt";

// Measured on the merged main (4a04eb2) BEFORE the freehand round's prompt and
// schema edits — the size this round must not exceed for an ordinary request.
const BASELINE_SYSTEM_CHARS = 216427;
const BASELINE_SCHEMA_CHARS = 100767;

const system = (code: boolean) => buildSystemPrompt(promptVariants()[0].source, { schema: apiSchema(), catalog: catalogParts({}).stable, fewshots: fewshotsText(), exemplars: "", code: code ? CODE_PROMPT_SOURCE : "" });

describe("prompt budget (spec §6.3)", () => {
  test("schema grew by at most 5,500 chars", () => {
    expect(JSON.stringify(apiSchema(), null, 2).length).toBeLessThanOrEqual(BASELINE_SCHEMA_CHARS + 5_500);
  });
  test("a non-code request gets a system prompt smaller than today's", () => {
    expect(system(false).length).toBeLessThan(BASELINE_SYSTEM_CHARS);
  });
  test("the code block is only sent when asked for, and is the 12k bullet", () => {
    expect(system(true).length - system(false).length).toBeGreaterThan(10_000);
    expect(system(false)).not.toContain("**code** runs a real script");
    expect(system(true)).toContain("**code** runs a real script");
  });
  test("wantsCode reads the request text — in Norwegian too", () => {
    expect(wantsCode("Explain a demand curve")).toBe(false);
    expect(wantsCode("Simulate 500 coin flips in Python")).toBe(true);
    expect(wantsCode("Show the C64 booting")).toBe(true);
    // Norwegian stems: half the requests this app sees are written in it.
    expect(wantsCode("Simuler 500 myntkast i Python")).toBe(true);
    expect(wantsCode("Skriv et skript som regner ut renters rente")).toBe(true);
    expect(wantsCode("Lag et program som simulerer terningkast")).toBe(true);
    expect(wantsCode("Beregn nåverdien og vis koden")).toBe(true);
    // Ordinary explanations still pay nothing for the code block.
    expect(wantsCode("Hvorfor er himmelen blå?")).toBe(false);
    expect(wantsCode("Forklar inflasjon for en nybegynner")).toBe(false);
  });
});
