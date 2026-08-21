import { describe, expect, test } from "vitest";
import { buildOutlineMessages, buildPartRequest, normalizeOutline, type Outline } from "../src/llm/outline";

describe("buildOutlineMessages", () => {
  test("the user message carries the request", () => {
    const { user } = buildOutlineMessages("The economics of vaccination", null);
    expect(user).toContain("The economics of vaccination");
  });

  test("an explicit part count is demanded, otherwise 2–4", () => {
    expect(buildOutlineMessages("x", 3).system).toContain("exactly 3");
    expect(buildOutlineMessages("x", null).system).toMatch(/2[–-]4/);
  });
});

describe("normalizeOutline", () => {
  test("a well-formed outline passes through", () => {
    const o = normalizeOutline({ title: "T", parts: [{ title: "A", brief: "a" }, { title: "B", brief: "b" }] });
    expect(o?.title).toBe("T");
    expect(o?.parts).toHaveLength(2);
  });

  test("fewer than two parts is rejected", () => {
    expect(normalizeOutline({ title: "T", parts: [{ title: "A", brief: "a" }] })).toBeNull();
    expect(normalizeOutline({ title: "T" })).toBeNull();
    expect(normalizeOutline("garbage")).toBeNull();
  });

  test("an overlong outline is trimmed to six parts", () => {
    const parts = Array.from({ length: 9 }, (_, i) => ({ title: `P${i}`, brief: "b" }));
    expect(normalizeOutline({ title: "T", parts })?.parts).toHaveLength(6);
  });

  test("part levels survive when valid and drop when not", () => {
    const o = normalizeOutline({
      title: "T",
      parts: [
        { title: "A", brief: "a", level: "basic" },
        { title: "B", brief: "b", level: "expert" },
      ],
    });
    expect(o?.parts[0].level).toBe("basic");
    expect(o?.parts[1].level).toBeUndefined();
  });
});

describe("buildPartRequest", () => {
  const outline: Outline = {
    title: "Vaccination economics",
    parts: [
      { title: "Externalities", brief: "why one shot protects many" },
      { title: "Herd immunity thresholds", brief: "the math of coverage" },
    ],
  };

  test("names the part, its position, and the series", () => {
    const r = buildPartRequest("Explain vaccination economics", outline, 1, "");
    expect(r).toContain("Herd immunity thresholds");
    expect(r).toContain("part 2 of 2");
    expect(r).toContain("Vaccination economics");
  });

  test("later parts bridge from the previous part; the first opens the series with a hook", () => {
    const first = buildPartRequest("x", outline, 0, "");
    const second = buildPartRequest("x", outline, 1, "");
    expect(first.toLowerCase()).toContain("hook");
    expect(second).toContain("Externalities");
    expect(second.toLowerCase()).toContain("bridg");
  });

  test("a directing brief is appended when present", () => {
    const r = buildPartRequest("x", outline, 0, "Directing brief:\n- Audience: beginners.");
    expect(r).toContain("Audience: beginners.");
  });
});
