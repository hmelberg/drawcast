// No click gates unless asked. The model wrote `wait: click` commands into
// lecture parts although no lecture was tagged #click (Hans's 10-lecture
// course, 2026-09-18) — a lecture plays through on its own; pauses are
// `pause`, not clicks. The runner strips them unless the lecture's tags
// include `click`. See src/course/run.ts.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/llm/multi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/llm/multi")>();
  return { ...actual, outlineParts: vi.fn(), generateFromOutline: vi.fn() };
});

import { generateFromOutline, outlineParts } from "../src/llm/multi";
import { runCourse, type RunHooks } from "../src/course/run";
import { itemsOf, type Playlist } from "../src/playlist/playlist";
import type { GenerateConfig, PromptVariant } from "../src/llm/compile";
import type { Spec } from "../src/spec/types";

const VARIANT: PromptVariant = { name: "t", source: "" };
const cfg: GenerateConfig = { apiKey: "k", model: "claude-opus-5", variant: VARIANT, exemplars: [] };
const hooks: RunHooks = { onLecture: () => {}, onProgress: () => {}, onDocument: () => {} };

const gated = (): Spec => ({
  title: "a",
  elements: [],
  commands: [{ speak: "one" }, { wait: "click" }, { pause: 0.5 }, { draw: ["x"], speak: "two" }, { wait: "click", speak: "now click" }],
});

beforeEach(() => {
  vi.mocked(outlineParts).mockReset();
  vi.mocked(generateFromOutline).mockReset();
  vi.mocked(outlineParts).mockResolvedValue({ outline: { title: "L1", parts: [{ title: "a", brief: "" }] } });
  vi.mocked(generateFromOutline).mockImplementation(async () => ({
    outline: null,
    specs: [gated()],
    chapterOf: [undefined],
    failed: [],
    errors: [],
  }));
});

async function storedCommands(doc: string): Promise<NonNullable<Spec["commands"]>> {
  let stored: Playlist | undefined;
  await runCourse(doc, cfg, hooks, (_i, _l, playlist) => {
    stored = playlist;
    return "id";
  });
  return itemsOf(stored!)[0].spec.commands ?? [];
}

describe("click gates in a lecture", () => {
  it("are stripped when the lecture is not tagged #click — pauses stay", async () => {
    const commands = await storedCommands(`# C\n\n## L1\nq\n#parts=1\n`);
    expect(commands.some((c) => "wait" in c)).toBe(false);
    expect(commands).toEqual([{ speak: "one" }, { pause: 0.5 }, { draw: ["x"], speak: "two" }]);
  });

  it("are kept when the lecture asked for them with #click", async () => {
    const commands = await storedCommands(`# C\n\n## L1\nq\n#click #parts=1\n`);
    expect(commands.filter((c) => "wait" in c)).toHaveLength(2);
  });
});
