import { describe, expect, test } from "vitest";
import { BRIEF_CONTROLS, briefTagInText, clearBriefTag, forTag, withBriefDefaults } from "../src/llm/brief-controls";
import { parseTags } from "../src/llm/tags";

describe("brief controls — audience, level, length beside the request box", () => {
  test("four controls (the fourth, Format, since books 2026-10-01), each with an untagged default", () => {
    expect(BRIEF_CONTROLS.map((c) => c.group)).toEqual(["audience", "level", "length", "book"]);
    for (const c of BRIEF_CONTROLS) {
      expect(c.options.some((o) => o.value === "")).toBe(true);
      // every option but the default and "other" is a real tag the parser knows
      for (const o of c.options.filter((o) => o.value && o.value !== "for")) {
        expect(parseTags(`x #${o.value}`).tags).toEqual([o.value]);
      }
    }
    const length = BRIEF_CONTROLS.find((c) => c.group === "length")!;
    expect(length.options.map((o) => o.value)).toEqual(["veryshort", "short", "", "long", "verylong"]);
  });

  test("a typed tag is read back per group; none → null", () => {
    expect(briefTagInText("Explain QALYs #long #advanced", "length")).toBe("long");
    expect(briefTagInText("Explain QALYs #long #advanced", "level")).toBe("advanced");
    expect(briefTagInText("Explain QALYs #for=nurses", "audience")).toBe("for=nurses");
    expect(briefTagInText("Explain QALYs", "audience")).toBeNull();
  });

  test("the controls' defaults are appended only for groups the text leaves open", () => {
    const d = { audience: "professionals", level: "", length: "long", book: "" };
    expect(withBriefDefaults("Explain QALYs", d)).toBe("Explain QALYs #professionals #long");
    // a typed tag wins over the control
    expect(withBriefDefaults("Explain QALYs #short", d)).toBe("Explain QALYs #short #professionals");
    expect(withBriefDefaults("Explain QALYs", { audience: "", level: "", length: "", book: "" })).toBe("Explain QALYs");
  });

  test("clearing a group removes its typed tags (and aliases) and nothing else", () => {
    expect(clearBriefTag("Explain #kids QALYs #long", "audience")).toBe("Explain QALYs #long");
    expect(clearBriefTag("Explain QALYs #for=nurses #basic", "audience")).toBe("Explain QALYs #basic");
    expect(clearBriefTag("Explain QALYs #advnced", "level")).toBe("Explain QALYs #advnced");
  });

  test("#for= from free words: spaces become dashes, stray # and blanks go", () => {
    expect(forTag("intensive care nurses")).toBe("for=intensive-care-nurses");
    expect(forTag("  #GPs ")).toBe("for=GPs");
    expect(forTag("   ")).toBe("");
  });
});

describe("the Format control (books, 2026-10-01)", () => {
  test("Book, text beside appends #column, which makes a multi-part book", async () => {
    const { parseTags } = await import("../src/llm/tags");
    const sent = withBriefDefaults("Explain price elasticity", { audience: "", level: "", length: "", book: "column" });
    expect(sent).toBe("Explain price elasticity #column");
    const parsed = parseTags(sent);
    expect(parsed.book).toBe("columns");
    expect(parsed.playlist).toBe(true);
    expect(parseTags("Explain it #row").book).toBe("rows");
    expect(parseTags("Explain it #book").book).toBeNull(); // the first name is gone
    expect(parseTags("Explain it").book).toBeNull();
  });
});
