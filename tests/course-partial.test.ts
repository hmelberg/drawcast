// A lecture with a part missing is a failed lecture. The runner used to store
// a 4-part lecture as "done" with three parts and never read
// PartsResult.failed — the visible "failed: <JSON error>" only appeared when
// every part died (diagnosed 2026-09-06). See src/course/run.ts.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/llm/multi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/llm/multi")>();
  return { ...actual, outlineParts: vi.fn(), generateFromOutline: vi.fn() };
});

import { generateFromOutline, outlineParts } from "../src/llm/multi";
import { parseCourse } from "../src/course/document";
import { runCourse, type RunHooks } from "../src/course/run";
import type { GenerateConfig, PromptVariant } from "../src/llm/compile";
import type { Spec } from "../src/spec/types";

const VARIANT: PromptVariant = { name: "t", source: "" };
const cfg: GenerateConfig = { apiKey: "k", model: "claude-opus-5", variant: VARIANT, exemplars: [] };
const hooks: RunHooks = { onLecture: () => {}, onProgress: () => {}, onDocument: () => {} };
const spec = (t: string): Spec => ({ title: t, elements: [], commands: [] }) as Spec;
const DOC = `# C\n\n## L1\nq\n#parts=3\n`;

beforeEach(() => {
  vi.mocked(outlineParts).mockReset();
  vi.mocked(generateFromOutline).mockReset();
  vi.mocked(outlineParts).mockResolvedValue({
    outline: { title: "L1", parts: [{ title: "a", brief: "" }, { title: "b", brief: "" }, { title: "c", brief: "" }] },
  });
});

describe("runCourse with a part missing", () => {
  it("marks the lecture failed, names the part, and stores nothing", async () => {
    vi.mocked(generateFromOutline).mockResolvedValue({
      outline: null,
      specs: [spec("a"), spec("c")],
      chapterOf: [undefined, undefined],
      failed: [2],
      errors: ["Bad control character in string literal in JSON at position 54\n(line 1)"],
    });
    const store = vi.fn(() => "id");
    const result = await runCourse(DOC, cfg, hooks, store);
    expect(store).not.toHaveBeenCalled();
    expect(result.failed).toEqual([0]);
    const status = parseCourse(result.text).lectures[0].status;
    expect(status?.state).toBe("failed");
    expect(status?.error).toMatch(/part 2 of 3 failed/);
    expect(status?.error).toContain("Bad control character");
    expect(status?.error).not.toContain("\n");
  });

  it("still stores a lecture whose every part landed", async () => {
    vi.mocked(generateFromOutline).mockResolvedValue({
      outline: null,
      specs: [spec("a"), spec("b"), spec("c")],
      chapterOf: [undefined, undefined, undefined],
      failed: [],
      errors: [],
    });
    const store = vi.fn(() => "id");
    const result = await runCourse(DOC, cfg, hooks, store);
    expect(store).toHaveBeenCalledTimes(1);
    expect(parseCourse(result.text).lectures[0].status?.state).toBe("done");
  });
});
