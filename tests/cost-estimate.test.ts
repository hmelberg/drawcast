// The AI-call count the course confirm always showed was never the bill —
// this is what prices it (Hans 2026-09-18). Course objects are built the
// same way tests/course-run.test.ts builds them: a plain-text plan run
// through parseCourse, with a `status:` line spliced in to mark a lecture
// done or partial.

import { describe, expect, it } from "vitest";
import { parseCourse } from "../src/course/document";
import {
  estimateCourseUsd,
  formatCourseEstimate,
  learnRate,
  PRIOR_USD_PER_OUTLINE,
  PRIOR_USD_PER_PART,
  priorUsdPerOutline,
  priorUsdPerPart,
  rateKey,
} from "../src/llm/cost-estimate";

const DOC = `# Causal Inference
level: advanced

---
## Potential outcomes
What is a counterfactual outcome?
#why #parts=4

---
## Difference-in-differences
What breaks parallel trends?
#parts=3
status: done · id: a1

---
## Regression discontinuity
Why does the cutoff identify anything?
#parts=3
status: failed · id: a2 · missing: 1, 3 · error: cut off
`;

describe("rateKey", () => {
  it("joins model and effort with a pipe", () => {
    expect(rateKey("claude-opus-5", "high")).toBe("claude-opus-5|high");
  });

  it("keeps different efforts apart for the same model", () => {
    expect(rateKey("claude-sonnet-5", "low")).not.toBe(rateKey("claude-sonnet-5", "high"));
  });
});

describe("priors", () => {
  it("tiers opus/fable, sonnet and haiku by id prefix", () => {
    expect(priorUsdPerPart("claude-opus-5", "high")).toBe(PRIOR_USD_PER_PART.opus.high);
    expect(priorUsdPerPart("claude-fable-1", "high")).toBe(PRIOR_USD_PER_PART.opus.high);
    expect(priorUsdPerPart("claude-sonnet-5", "medium")).toBe(PRIOR_USD_PER_PART.sonnet.medium);
    expect(priorUsdPerPart("claude-haiku-4-5", "low")).toBe(PRIOR_USD_PER_PART.haiku.low);
  });

  it("prices an unknown model id as opus — an estimate that errs high is the honest one", () => {
    expect(priorUsdPerPart("some-future-model", "high")).toBe(PRIOR_USD_PER_PART.opus.high);
    expect(priorUsdPerOutline("some-future-model")).toBe(PRIOR_USD_PER_OUTLINE.opus);
  });

  it("prices an outline per tier, independent of effort", () => {
    expect(priorUsdPerOutline("claude-opus-5")).toBe(PRIOR_USD_PER_OUTLINE.opus);
    expect(priorUsdPerOutline("claude-sonnet-5")).toBe(PRIOR_USD_PER_OUTLINE.sonnet);
    expect(priorUsdPerOutline("claude-haiku-4-5")).toBe(PRIOR_USD_PER_OUTLINE.haiku);
  });
});

describe("estimateCourseUsd", () => {
  it("counts a pending lecture's outline+parts, nothing for a done lecture, and only the missing parts (no outline) for a partial one", () => {
    const course = parseCourse(DOC);
    const e = estimateCourseUsd(course, "claude-opus-5", "high", {});
    // pending "Potential outcomes": 1 outline + 4 parts. Done "Difference-in-
    // differences": nothing. Partial "Regression discontinuity": 2 missing
    // parts (1 and 3), its outline is kept — not spent again.
    expect(e.outlines).toBe(1);
    expect(e.parts).toBe(4 + 2);
    expect(e.source).toBe("default");
    expect(e.usd).toBeCloseTo(6 * PRIOR_USD_PER_PART.opus.high + 1 * PRIOR_USD_PER_OUTLINE.opus);
  });

  it("prefers a learned rate over the prior, and reports source: measured", () => {
    const course = parseCourse(DOC);
    const learned = { [rateKey("claude-opus-5", "high")]: 1.5 };
    const e = estimateCourseUsd(course, "claude-opus-5", "high", learned);
    expect(e.source).toBe("measured");
    expect(e.usd).toBeCloseTo(6 * 1.5 + PRIOR_USD_PER_OUTLINE.opus);
  });

  it("a learned rate for a different model|effort does not leak into this one", () => {
    const course = parseCourse(DOC);
    const learned = { [rateKey("claude-sonnet-5", "high")]: 999 };
    const e = estimateCourseUsd(course, "claude-opus-5", "high", learned);
    expect(e.source).toBe("default");
  });

  it("costs nothing once every lecture is done", () => {
    const allDone = DOC.replace("#why #parts=4", "#why #parts=4\nstatus: done · id: a0").replace(
      "status: failed · id: a2 · missing: 1, 3 · error: cut off",
      "status: done · id: a2",
    );
    const e = estimateCourseUsd(parseCourse(allDone), "claude-opus-5", "high", {});
    expect(e).toEqual({ usd: 0, parts: 0, outlines: 0, source: "default" });
  });
});

describe("learnRate", () => {
  it("takes the first measurement as-is", () => {
    expect(learnRate(undefined, 0.4)).toBe(0.4);
  });

  it("blends 50/50 with the previous rate", () => {
    expect(learnRate(0.4, 0.6)).toBeCloseTo(0.5);
  });

  it("ignores a non-finite measurement, keeping the previous rate", () => {
    expect(learnRate(0.4, NaN)).toBe(0.4);
    expect(learnRate(0.4, Infinity)).toBe(0.4);
  });

  it("ignores a zero or negative measurement", () => {
    expect(learnRate(0.4, 0)).toBe(0.4);
    expect(learnRate(0.4, -1)).toBe(0.4);
  });

  it("falls back to 0 for a bad measurement with no previous rate at all — never NaN or negative", () => {
    expect(learnRate(undefined, NaN)).toBe(0);
    expect(learnRate(undefined, -1)).toBe(0);
  });
});

describe("formatCourseEstimate", () => {
  it("rounds to whole dollars above $10", () => {
    const text = formatCourseEstimate({ usd: 22.4, parts: 10, outlines: 1, source: "measured" }, "Opus 5", "high");
    expect(text).toContain("$22");
    expect(text).not.toContain("22.4");
  });

  it("keeps two decimals at or below $10", () => {
    const text = formatCourseEstimate({ usd: 4.5, parts: 4, outlines: 1, source: "default" }, "Sonnet 5", "medium");
    expect(text).toContain("$4.50");
  });

  it("names the model label and effort", () => {
    const text = formatCourseEstimate({ usd: 1, parts: 1, outlines: 0, source: "default" }, "Opus 5", "high");
    expect(text).toContain("Opus 5");
    expect(text).toContain("high effort");
  });

  it("says measured vs. a rough default in plain words", () => {
    const measured = formatCourseEstimate({ usd: 1, parts: 1, outlines: 0, source: "measured" }, "Opus 5", "high");
    expect(measured).toContain("from your last run");
    const guess = formatCourseEstimate({ usd: 1, parts: 1, outlines: 0, source: "default" }, "Opus 5", "high");
    expect(guess).toContain("rough default");
  });
});
