import { describe, expect, test } from "vitest";
import { buildImproveMessages } from "../src/llm/compile";

describe("buildImproveMessages", () => {
  const source = "# Prompt\n{{SCHEMA}}\n{{CATALOG}}\n{{FEWSHOTS}}\n{{EXEMPLARS}}";

  test("system message demands placeholder preservation and prompt-only output", () => {
    const { system } = buildImproveMessages(source, []);
    expect(system).toContain("{{SCHEMA}}");
    expect(system).toMatch(/ONLY the complete revised prompt/i);
  });

  test("user message carries the current prompt and the failure cases", () => {
    const { user } = buildImproveMessages(source, [
      { prompt: "Draw a Markov model", rating: 2, error: undefined, lintMessages: ["label overlaps curve"], rounds: 3 },
    ]);
    expect(user).toContain("# Prompt");
    expect(user).toContain("Draw a Markov model");
    expect(user).toContain("2/5");
    expect(user).toContain("label overlaps curve");
  });

  test("no cases yields the clarity-pass instruction", () => {
    const { user } = buildImproveMessages(source, []);
    expect(user).toMatch(/no logged failures/i);
  });
});
