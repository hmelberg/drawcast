// A lecture with a part missing is a PARTIAL lecture. The runner used to
// store a 4-part lecture as "done" with three parts and never read
// PartsResult.failed (diagnosed 2026-09-06); then it kept NOTHING from such
// a lecture, so ⟳ regenerated every part (9 of 10 lectures, Hans
// 2026-09-18). Now the parts that landed are stored with the outline and
// the missing part numbers, and a later run fills in only what is missing.
// See src/course/run.ts.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/llm/multi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/llm/multi")>();
  return { ...actual, outlineParts: vi.fn(), generateFromOutline: vi.fn() };
});

import { generateFromOutline, outlineParts } from "../src/llm/multi";
import { parseCourse } from "../src/course/document";
import { lecturePlaylist, loadedLectureFromRow, runCourse, type LoadLecture, type RunHooks, type StoreLecture } from "../src/course/run";
import { formatPlaylist, itemsOf, type Playlist } from "../src/playlist/playlist";
import type { GenerateConfig, PromptVariant } from "../src/llm/compile";
import type { Outline } from "../src/llm/outline";
import type { Spec } from "../src/spec/types";

const VARIANT: PromptVariant = { name: "t", source: "" };
const cfg: GenerateConfig = { apiKey: "k", model: "claude-opus-5", variant: VARIANT, exemplars: [] };
const hooks: RunHooks = { onLecture: () => {}, onProgress: () => {}, onDocument: () => {} };
const spec = (t: string): Spec => ({ title: t, elements: [], commands: [] }) as Spec;
const DOC = `# C\n\n## L1\nq\n#parts=3\n`;
const OUTLINE: Outline = { title: "L1", parts: [{ title: "a", brief: "" }, { title: "b", brief: "" }, { title: "c", brief: "" }] };
const titles = (playlist: Playlist) => itemsOf(playlist).map((i) => i.spec.title);

beforeEach(() => {
  vi.mocked(outlineParts).mockReset();
  vi.mocked(generateFromOutline).mockReset();
  vi.mocked(outlineParts).mockResolvedValue({ outline: OUTLINE });
});

describe("runCourse with a part missing", () => {
  it("stores the parts that landed, with the outline and what is missing, and marks the lecture failed with `missing`", async () => {
    vi.mocked(generateFromOutline).mockResolvedValue({
      outline: null,
      specs: [spec("a"), spec("c")],
      chapterOf: [undefined, undefined],
      failed: [2],
      errors: ["Bad control character in string literal in JSON at position 54\n(line 1)"],
    });
    const store = vi.fn<StoreLecture>(() => "id");
    const result = await runCourse(DOC, cfg, hooks, store);
    expect(store).toHaveBeenCalledTimes(1);
    const [, , playlist, extra] = store.mock.calls[0];
    expect(titles(playlist)).toEqual(["a", "c"]);
    expect(extra).toEqual({ outline: OUTLINE, missing: [2] });
    expect(result.failed).toEqual([]);
    expect(result.partial).toEqual([0]);
    expect(result.generated).toBe(0);
    const status = parseCourse(result.text).lectures[0].status;
    expect(status?.state).toBe("failed");
    expect(status?.id).toBe("id");
    expect(status?.missing).toEqual([2]);
    expect(status?.error).toMatch(/part 2 of 3 failed/);
    expect(status?.error).toContain("Bad control character");
    expect(status?.error).not.toContain("\n");
  });

  it("stores nothing when no part landed", async () => {
    vi.mocked(generateFromOutline).mockResolvedValue({ outline: null, specs: [], chapterOf: [], failed: [1, 2, 3], errors: ["x", "x", "x"], error: "x" });
    const store = vi.fn<StoreLecture>(() => "id");
    const result = await runCourse(DOC, cfg, hooks, store);
    expect(store).not.toHaveBeenCalled();
    expect(result.failed).toEqual([0]);
    expect(result.partial).toEqual([]);
    const status = parseCourse(result.text).lectures[0].status;
    expect(status?.state).toBe("failed");
    expect(status?.missing).toBeUndefined();
  });

  it("still stores a lecture whose every part landed, as done, with nothing extra", async () => {
    vi.mocked(generateFromOutline).mockResolvedValue({
      outline: null,
      specs: [spec("a"), spec("b"), spec("c")],
      chapterOf: [undefined, undefined, undefined],
      failed: [],
      errors: [],
    });
    const store = vi.fn<StoreLecture>(() => "id");
    const result = await runCourse(DOC, cfg, hooks, store);
    expect(store).toHaveBeenCalledTimes(1);
    expect(store.mock.calls[0][3]).toBeUndefined();
    expect(parseCourse(result.text).lectures[0].status?.state).toBe("done");
    expect(result.generated).toBe(1);
  });
});

describe("resuming a partial lecture", () => {
  const PARTIAL = `# C\n\n## L1\nq\n#parts=3\nstatus: failed · id: id · missing: 2 · error: part 2 of 3 failed - cut off · 2026-09-18\n`;
  const row = (missing: number[], specs: Spec[]): ReturnType<LoadLecture> => ({ outline: OUTLINE, specs, chapterOf: specs.map(() => undefined), missing });

  it("skips the outline, regenerates only the missing parts, and merges them in order", async () => {
    vi.mocked(generateFromOutline).mockResolvedValue({ outline: OUTLINE, specs: [spec("b")], chapterOf: [undefined], failed: [], errors: [] });
    const store = vi.fn<StoreLecture>(() => "id");
    const loadLecture = vi.fn<LoadLecture>(() => row([2], [spec("a"), spec("c")]));
    const result = await runCourse(PARTIAL, cfg, hooks, store, { loadLecture });
    expect(outlineParts).not.toHaveBeenCalled();
    expect(generateFromOutline).toHaveBeenCalledTimes(1);
    const [, plan, , , opts] = vi.mocked(generateFromOutline).mock.calls[0];
    expect(plan).toEqual(OUTLINE);
    expect(opts).toEqual({ only: [2] });
    expect(store).toHaveBeenCalledTimes(1);
    expect(titles(store.mock.calls[0][2])).toEqual(["a", "b", "c"]);
    expect(store.mock.calls[0][3]).toBeUndefined();
    const status = parseCourse(result.text).lectures[0].status;
    expect(status?.state).toBe("done");
    expect(status?.id).toBe("id");
    expect(status?.missing).toBeUndefined();
    expect(result.generated).toBe(1);
  });

  it("a part still missing after the fill keeps the lecture partial, with the smaller `missing`", async () => {
    const twoMissing = PARTIAL.replace("missing: 2", "missing: 1, 3");
    vi.mocked(generateFromOutline).mockResolvedValue({ outline: OUTLINE, specs: [spec("c")], chapterOf: [undefined], failed: [1], errors: ["cut off"] });
    const store = vi.fn<StoreLecture>(() => "id");
    const result = await runCourse(twoMissing, cfg, hooks, store, { loadLecture: () => row([1, 3], [spec("b")]) });
    expect(vi.mocked(generateFromOutline).mock.calls[0][4]).toEqual({ only: [1, 3] });
    expect(titles(store.mock.calls[0][2])).toEqual(["b", "c"]);
    expect(store.mock.calls[0][3]).toEqual({ outline: OUTLINE, missing: [1] });
    const status = parseCourse(result.text).lectures[0].status;
    expect(status?.state).toBe("failed");
    expect(status?.missing).toEqual([1]);
    expect(status?.error).toMatch(/part 1 of 3 failed/);
    expect(result.partial).toEqual([0]);
  });

  it("falls back to a full regeneration when the library row is gone", async () => {
    vi.mocked(generateFromOutline).mockResolvedValue({
      outline: OUTLINE,
      specs: [spec("a"), spec("b"), spec("c")],
      chapterOf: [undefined, undefined, undefined],
      failed: [],
      errors: [],
    });
    const store = vi.fn<StoreLecture>(() => "id");
    const result = await runCourse(PARTIAL, cfg, hooks, store, { loadLecture: () => null });
    expect(outlineParts).toHaveBeenCalledTimes(1);
    expect(vi.mocked(generateFromOutline).mock.calls[0][4]?.only).toBeUndefined();
    expect(parseCourse(result.text).lectures[0].status?.state).toBe("done");
  });

  it("⟳ on a partial lecture fills in the missing parts, not everything", async () => {
    vi.mocked(generateFromOutline).mockResolvedValue({ outline: OUTLINE, specs: [spec("b")], chapterOf: [undefined], failed: [], errors: [] });
    const store = vi.fn<StoreLecture>(() => "id");
    await runCourse(PARTIAL, cfg, hooks, store, { only: 0, loadLecture: () => row([2], [spec("a"), spec("c")]) });
    expect(outlineParts).not.toHaveBeenCalled();
    expect(vi.mocked(generateFromOutline).mock.calls[0][4]).toEqual({ only: [2] });
    expect(titles(store.mock.calls[0][2])).toEqual(["a", "b", "c"]);
  });

  it("⟳ on a done lecture regenerates everything, as before", async () => {
    const done = `# C\n\n## L1\nq\n#parts=3\nstatus: done · id: id · 2026-09-18\n`;
    vi.mocked(generateFromOutline).mockResolvedValue({
      outline: OUTLINE,
      specs: [spec("a"), spec("b"), spec("c")],
      chapterOf: [undefined, undefined, undefined],
      failed: [],
      errors: [],
    });
    const loadLecture = vi.fn<LoadLecture>(() => row([2], [spec("a"), spec("c")]));
    await runCourse(done, cfg, hooks, () => "id", { only: 0, loadLecture });
    expect(loadLecture).not.toHaveBeenCalled();
    expect(outlineParts).toHaveBeenCalledTimes(1);
    expect(vi.mocked(generateFromOutline).mock.calls[0][4]?.only).toBeUndefined();
  });
});

describe("loadedLectureFromRow", () => {
  const TWO = `# C\n\n## L1\nq\n#parts=3\n\n## L2\nq\n`;

  it("reads the landed parts back from the stored playlist — without the next-card — plus the outline and what is missing", () => {
    const course = parseCourse(TWO);
    const playlist = lecturePlaylist(course, 0, { outline: OUTLINE, specs: [spec("a"), spec("c")], chapterOf: ["Setup", "Payoff"], failed: [2] });
    const loaded = loadedLectureFromRow({ playlist: formatPlaylist(playlist, "yaml"), outline: OUTLINE, missing: [2] });
    expect(loaded?.specs.map((s) => s.title)).toEqual(["a", "c"]);
    expect(loaded?.chapterOf).toEqual(["Setup", "Payoff"]);
    expect(loaded?.outline).toEqual(OUTLINE);
    expect(loaded?.missing).toEqual([2]);
  });

  it("is null for a row that carries no outline or no playlist", () => {
    expect(loadedLectureFromRow({ playlist: "title: a\nelements: []\ncommands: []\n", missing: [2] })).toBeNull();
    expect(loadedLectureFromRow({ outline: OUTLINE, missing: [2] })).toBeNull();
  });
});
