// The fewshots ride every prompt; the ones that carry a code element must
// ride only the prompts that carry the code block and the code schema —
// the same boolean (wantsCode) that gates both, or a code-less request is
// shown a worked code example beside a schema with no code element in it.

import { describe, expect, test } from "vitest";
import { fewshotsText } from "../src/llm/compile";

describe("fewshots follow the code gate", () => {
  test("a code-less prompt gets no code fewshot", () => {
    expect(fewshotsText({ code: false })).not.toMatch(/"type":\s*"code"/);
    expect(fewshotsText({ code: false }).length).toBeGreaterThan(1000);
  });

  test("a code prompt keeps them", () => {
    expect(fewshotsText({ code: true })).toMatch(/"type":\s*"code"/);
    expect(fewshotsText()).toMatch(/"type":\s*"code"/);
  });
});
