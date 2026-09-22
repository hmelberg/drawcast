// Prompt corrections from the 2026-09-23 review of the prompt-weight round.

import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { specSchema } from "../src/spec/schema";

const compilerV1 = readFileSync(new URL("../src/llm/prompts/compiler-v1.md", import.meta.url), "utf8");
const compilerV1Code = readFileSync(new URL("../src/llm/prompts/compiler-v1-code.md", import.meta.url), "utf8");

describe("blocking: false is taught as what the player does", () => {
  test("names the verbs that run under the voice, and that a draw still waits", () => {
    expect(compilerV1).toContain('"blocking": false');
    expect(compilerV1).toMatch(/draw[^.]*still waits for the voice/);
    // The old sentence said a non-blocking speak is HOW to talk while
    // drawing — the paired speak already is, and a draw waits anyway.
    expect(compilerV1).not.toContain("that is how you talk WHILE pointing, highlighting or drawing");
  });
});

describe("the curve variable is x", () => {
  test("the prompt says t/q are aliases only until a var takes the name", () => {
    expect(compilerV1).toMatch(/the curve variable is `x`/);
    expect(compilerV1).toMatch(/`t`[^.]*alias/);
  });
});

describe("interactive code sits output-over-code by default", () => {
  test("the code prompt and the schema both say so", () => {
    expect(compilerV1Code).toMatch(/controls[^.]*output on top/i);
    const show = (specSchema.properties.elements.items.properties as { show: { description: string } }).show.description;
    expect(show).toMatch(/controls/);
    expect(show).toMatch(/below/);
  });
});
