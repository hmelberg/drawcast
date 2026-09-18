import { beforeEach, describe, expect, it, vi } from "vitest";

// Only for the "landed parts and the teaching pass" describe block below —
// the same mocking style as tests/course-partial.test.ts: generateFromOutline
// stands in for the whole multi-part pipeline, so its mock is what calls
// runCourse's onPart hook with the outcomes a test wants to count.
vi.mock("../src/llm/multi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/llm/multi")>();
  return { ...actual, outlineParts: vi.fn(), generateFromOutline: vi.fn() };
});

import { generateFromOutline, outlineParts } from "../src/llm/multi";
import { parseCourse } from "../src/course/document";
import { buildLectureRequest, estimateCalls, estimateMinutes, lecturePlaylist, pendingIndices, runCourse, type RunHooks, type StoreLecture } from "../src/course/run";
import { itemsOf } from "../src/playlist/playlist";
import type { GenerateConfig, GenerationOutcome, GenerationRound, PromptVariant } from "../src/llm/compile";
import type { Outline } from "../src/llm/outline";
import type { Spec } from "../src/spec/types";

const DOC = `# Causal Inference
level: advanced
notation: Y(1)/Y(0), D treatment
example: job training

---
## Potential outcomes
What is a counterfactual outcome?
#why #parts=4

---
## Difference-in-differences
What breaks parallel trends?
#controversy #parts=3

---
## Regression discontinuity
Why does the cutoff identify anything?
#parts=3
`;

describe("buildLectureRequest", () => {
  it("carries the shared context into every lecture", () => {
    const req = buildLectureRequest(parseCourse(DOC), 1);
    expect(req).toContain("Y(1)/Y(0), D treatment");
    expect(req).toContain("job training");
  });

  it("includes this lecture's questions", () => {
    expect(buildLectureRequest(parseCourse(DOC), 1)).toContain("What breaks parallel trends?");
  });

  it("tells the model what earlier lectures already covered", () => {
    const req = buildLectureRequest(parseCourse(DOC), 2);
    expect(req).toContain("Potential outcomes");
    expect(req).toContain("Difference-in-differences");
  });

  it("says nothing about earlier lectures for the first one", () => {
    expect(buildLectureRequest(parseCourse(DOC), 0)).not.toContain("already covered");
  });

  it("appends the lecture's tags so tags.ts fragments apply unchanged", () => {
    expect(buildLectureRequest(parseCourse(DOC), 1)).toContain("#controversy");
  });
});

describe("estimateCalls", () => {
  it("counts one outline plus the parts for each pending lecture", () => {
    // (1+4) + (1+3) + (1+3)
    expect(estimateCalls(parseCourse(DOC))).toBe(13);
  });

  it("skips lectures already done", () => {
    const done = DOC.replace("#why #parts=4", "#why #parts=4\nstatus: done · id: a1");
    expect(estimateCalls(parseCourse(done))).toBe(8);
  });

  it("counts only the missing parts of a partial lecture — its outline is kept", () => {
    const partial = DOC.replace("#why #parts=4", "#why #parts=4\nstatus: failed · id: a1 · missing: 1, 4 · error: cut off");
    // 2 + (1+3) + (1+3)
    expect(estimateCalls(parseCourse(partial))).toBe(10);
  });
});

describe("lecturePlaylist", () => {
  const spec = (title: string): Spec => ({ title, elements: [], commands: [] });

  it("appends a next-card naming the following lecture", () => {
    const playlist = lecturePlaylist(parseCourse(DOC), 0, {
      outline: null,
      specs: [spec("a"), spec("b")],
      chapterOf: [undefined, undefined],
      failed: [],
    });
    const items = itemsOf(playlist);
    const texts = (items.at(-1)!.spec.elements ?? []).map((e) => ("text" in e ? e.text : "")).join(" ");
    expect(texts).toContain("Difference-in-differences");
  });

  it("adds no next-card to the last lecture", () => {
    const course = parseCourse(DOC);
    const playlist = lecturePlaylist(course, 2, {
      outline: null,
      specs: [spec("a")],
      chapterOf: [undefined],
      failed: [],
    });
    expect(itemsOf(playlist)).toHaveLength(1);
  });

  it("emits chapter entries where the outline assigned them", () => {
    const playlist = lecturePlaylist(parseCourse(DOC), 2, {
      outline: null,
      specs: [spec("a"), spec("b")],
      chapterOf: ["Setup", "Payoff"],
      failed: [],
    });
    expect(playlist.entries.filter((e) => e.kind === "chapter")).toHaveLength(2);
  });

  // B9: the founding request travels in the file. A lecture's request is its
  // teacher's notes — without this the published lecture yaml carries a title
  // and no trace of what it was asked to cover.
  it("stamps the lecture's own notes into the playlist header (B9)", () => {
    const playlist = lecturePlaylist(parseCourse(DOC), 1, {
      outline: null,
      specs: [spec("a")],
      chapterOf: [undefined],
      failed: [],
    });
    expect(playlist.meta.prompt).toBe("What breaks parallel trends?");
  });

  it("a lecture with no notes IS its title, so that is the request it carries (B9)", () => {
    const bare = parseCourse("# Course\n\n---\n## Only a title\n");
    const playlist = lecturePlaylist(bare, 0, { outline: null, specs: [spec("a")], chapterOf: [undefined], failed: [] });
    expect(playlist.meta.prompt).toBe("Only a title");
  });

  it("names the playlist after the lecture", () => {
    const playlist = lecturePlaylist(parseCourse(DOC), 1, {
      outline: null,
      specs: [spec("a")],
      chapterOf: [undefined],
      failed: [],
    });
    expect(playlist.meta.title).toBe("Difference-in-differences");
  });
});

describe("estimateMinutes", () => {
  it("scales with the number of spoken lines", () => {
    const one: Spec = { elements: [], commands: [{ speak: "a" }] };
    const four: Spec = { elements: [], commands: [{ speak: "a" }, { speak: "b" }, { speak: "c" }, { speak: "d" }] };
    expect(estimateMinutes([four])).toBeGreaterThan(estimateMinutes([one]));
  });
});

describe("pendingIndices", () => {
  it("returns every ungenerated lecture", () => {
    expect(pendingIndices(parseCourse(DOC))).toEqual([0, 1, 2]);
  });

  it("skips the ones already done", () => {
    const done = DOC.replace("#why #parts=4", "#why #parts=4\nstatus: done · id: a1");
    expect(pendingIndices(parseCourse(done))).toEqual([1, 2]);
  });

  it("honours `only`, even for a lecture already done", () => {
    const done = DOC.replace("#why #parts=4", "#why #parts=4\nstatus: done · id: a1");
    expect(pendingIndices(parseCourse(done), { only: 0 })).toEqual([0]);
  });

  it("returns nothing for an out-of-range `only`", () => {
    expect(pendingIndices(parseCourse(DOC), { only: 9 })).toEqual([]);
  });
});

describe("topics, not only questions", () => {
  const TOPICS = `# Causal Inference
---
## Difference-in-differences
Parallel trends
The 2x2 estimator
---
## Synthetic control
`;

  it("passes topic lines through as the ground to cover", () => {
    const req = buildLectureRequest(parseCourse(TOPICS), 0);
    expect(req).toContain("Parallel trends");
    expect(req).toContain("The 2x2 estimator");
  });

  it("presents the lines as the teacher's notes, without classifying them", () => {
    const req = buildLectureRequest(parseCourse(TOPICS), 0);
    expect(req).toContain("teacher's notes");
    expect(req).toContain("some are material to show");
  });

  it("does not claim the lines are questions", () => {
    const req = buildLectureRequest(parseCourse(TOPICS), 0);
    expect(req).not.toContain("Answer these questions");
    // The taste lives in the planner prompt; the runner must not re-argue it.
    expect(req).not.toContain("Match the mode");
  });

  it("falls back to the title when a lecture has nothing under it", () => {
    const req = buildLectureRequest(parseCourse(TOPICS), 1);
    expect(req).toContain('explain "Synthetic control"');
    expect(req).toContain("why it matters");
  });

  it("still carries questions when they are questions", () => {
    expect(buildLectureRequest(parseCourse(DOC), 1)).toContain("What breaks parallel trends?");
  });
});

describe("runCourse: landed parts and the teaching pass", () => {
  const VARIANT: PromptVariant = { name: "t", source: "" };
  const cfg: GenerateConfig = { apiKey: "k", model: "claude-opus-5", variant: VARIANT, exemplars: [] };
  const hooks: RunHooks = { onLecture: () => {}, onProgress: () => {}, onDocument: () => {} };
  const ONE_LECTURE = `# C\n\n## L1\nq\n#parts=3\n`;
  const OUTLINE: Outline = { title: "L1", parts: [{ title: "a", brief: "" }, { title: "b", brief: "" }, { title: "c", brief: "" }] };
  const mkSpec = (title: string): Spec => ({ title, elements: [], commands: [] }) as Spec;
  const round = (label: GenerationRound["label"], adopted?: boolean): GenerationRound => ({
    label,
    spec: null,
    validationErrors: [],
    lintIssues: [],
    meta: { ms: 0, structuredOutput: true },
    ...(adopted !== undefined ? { adopted } : {}),
  });
  const outcome = (spec: Spec | null, rounds: GenerationRound[]): GenerationOutcome => ({
    spec,
    rounds,
    systemPromptChars: 0,
    seeded: false,
    ...(spec ? {} : { error: "no spec" }),
  });

  beforeEach(() => {
    vi.mocked(outlineParts).mockReset();
    vi.mocked(generateFromOutline).mockReset();
    vi.mocked(outlineParts).mockResolvedValue({ outline: OUTLINE });
  });

  it("counts only the parts that landed fresh, and tallies the teaching pass across every part touched", async () => {
    // Part 1: pedagogy ran and replaced the spec. Part 2: pedagogy ran but was
    // not adopted. Part 3: failed before a pedagogy pass ever ran.
    const outcomes = [
      outcome(mkSpec("a"), [round("initial"), round("pedagogy", true)]),
      outcome(mkSpec("b"), [round("initial"), round("pedagogy", false)]),
      outcome(null, [round("initial")]),
    ];
    vi.mocked(generateFromOutline).mockImplementation(async (_req, _plan, _cfg, partsHooks) => {
      outcomes.forEach((o, i) => partsHooks?.onPart?.(i + 1, outcomes.length, i, o));
      return { outline: null, specs: [mkSpec("a"), mkSpec("b")], chapterOf: [undefined, undefined], failed: [3], errors: ["no spec"] };
    });
    const store = vi.fn<StoreLecture>(() => "id");
    const result = await runCourse(ONE_LECTURE, cfg, hooks, store);
    expect(result.partsGenerated).toBe(2); // only the two that produced a spec
    expect(result.teachingPass).toEqual({ runs: 2, adopted: 1 });
  });

  it("counts nothing generated and no teaching pass when every part fails outright", async () => {
    const outcomes = [outcome(null, [round("initial")]), outcome(null, [round("initial")]), outcome(null, [round("initial")])];
    vi.mocked(generateFromOutline).mockImplementation(async (_req, _plan, _cfg, partsHooks) => {
      outcomes.forEach((o, i) => partsHooks?.onPart?.(i + 1, outcomes.length, i, o));
      return { outline: null, specs: [], chapterOf: [], failed: [1, 2, 3], errors: ["x", "x", "x"], error: "x" };
    });
    const store = vi.fn<StoreLecture>(() => "id");
    const result = await runCourse(ONE_LECTURE, cfg, hooks, store);
    expect(result.partsGenerated).toBe(0);
    expect(result.teachingPass).toEqual({ runs: 0, adopted: 0 });
  });
});
