import { describe, expect, test } from "vitest";
import { buildBrief, parseTags, suggestTags } from "../src/llm/tags";

describe("parseTags — recognition and stripping", () => {
  test("text without tags passes through unchanged", () => {
    const r = parseTags("Draw supply and demand with a tax");
    expect(r.clean).toBe("Draw supply and demand with a tax");
    expect(r.tags).toEqual([]);
    expect(r.unknown).toEqual([]);
    expect(r.playlist).toBe(false);
  });

  test("recognized tags are stripped from the clean text", () => {
    const r = parseTags("Explain QALYs #short #basic");
    expect(r.clean).toBe("Explain QALYs");
    expect(r.tags).toEqual(["short", "basic"]);
  });

  test("a tag in the middle of the text strips without leaving double spaces", () => {
    const r = parseTags("Explain #short QALYs");
    expect(r.clean).toBe("Explain QALYs");
    expect(r.tags).toEqual(["short"]);
  });

  test("matching is case-insensitive and aliases map to the canonical tag", () => {
    expect(parseTags("Forklar QALYs #NB").tags).toEqual(["norwegian"]);
    expect(parseTags("Explain #Advanced").tags).toEqual(["advanced"]);
    expect(parseTags("Explain #en").tags).toEqual(["english"]);
  });

  test("within an exclusive group the last tag wins", () => {
    const r = parseTags("Explain externalities #short #long");
    expect(r.tags).toEqual(["long"]);
  });

  test("unknown #words are reported and left in the text", () => {
    const r = parseTags("Explain QALYs #advnced");
    expect(r.unknown).toEqual(["advnced"]);
    expect(r.clean).toBe("Explain QALYs #advnced");
    expect(r.tags).toEqual([]);
  });

  test("a # inside a word is not a tag", () => {
    const r = parseTags("Explain the C# market");
    expect(r.clean).toBe("Explain the C# market");
    expect(r.unknown).toEqual([]);
  });

  test("level is surfaced for spec stamping", () => {
    expect(parseTags("x #basic").level).toBe("basic");
    expect(parseTags("x #advanced").level).toBe("advanced");
    expect(parseTags("x").level).toBeNull();
  });
});

describe("parseTags — playlist structure tags", () => {
  test("#playlist requests a multi-part drawcast with an open part count", () => {
    const r = parseTags("The history of vaccination #playlist");
    expect(r.playlist).toBe(true);
    expect(r.parts).toBeNull();
    expect(r.clean).toBe("The history of vaccination");
  });

  test("#parts=3 requests exactly three parts", () => {
    const r = parseTags("Markov models #parts=3");
    expect(r.playlist).toBe(true);
    expect(r.parts).toBe(3);
    expect(r.clean).toBe("Markov models");
  });

  test("#parts with a non-numeric value is unknown", () => {
    const r = parseTags("Markov models #parts=abc");
    expect(r.playlist).toBe(false);
    expect(r.unknown).toEqual(["parts=abc"]);
  });
});

describe("parseTags — #template", () => {
  test("#template=free_body is parsed out and exposed", () => {
    const p = parseTags("show forces #template=free_body");
    expect(p.template).toBe("free_body");
    expect(p.clean).toBe("show forces");
  });
  test("no template tag yields null", () => {
    expect(parseTags("plain request").template).toBeNull();
  });

  test("bare #template (no =) is not silently stripped as a no-op — surfaces as unknown, matching bare #parts", () => {
    const r = parseTags("x #template");
    expect(r.template).toBeNull();
    expect(r.unknown).toContain("template");
    expect(r.clean).toBe("x #template"); // left in the text, same as any other unknown tag
  });
});

describe("buildBrief", () => {
  test("no tags produces no brief", () => {
    expect(buildBrief([])).toBe("");
  });

  test("length tags override the examples' length explicitly", () => {
    const brief = buildBrief(["short"]);
    expect(brief).toContain("Directing brief");
    expect(brief.toLowerCase()).toContain("override the examples");
  });

  test("long pedagogy: announce first, ground in a concrete example, explain step by step, synthesis", () => {
    const brief = buildBrief(["long"]).toLowerCase();
    expect(brief).toContain("what you will explain");
    expect(brief).toContain("step by step");
    expect(brief).toContain("concrete example");
    expect(brief).toContain("synthesis");
  });

  test("verylong adds the debate/controversy moment", () => {
    expect(buildBrief(["verylong"]).toLowerCase()).toMatch(/controvers|debate/);
  });

  test("norwegian directs narration language", () => {
    expect(buildBrief(["norwegian"]).toLowerCase()).toContain("norwegian");
  });

  test("click instructs the wait verb", () => {
    expect(buildBrief(["click"])).toContain('"wait"');
  });

  test("structure tags alone contribute nothing", () => {
    expect(buildBrief(["playlist"])).toBe("");
  });
});

describe("suggestTags — autosuggest source", () => {
  test("empty prefix lists every suggestable tag with a hint", () => {
    const all = suggestTags("");
    expect(all.length).toBeGreaterThan(8);
    for (const s of all) expect(s.hint.length).toBeGreaterThan(0);
  });

  test("prefix filters case-insensitively", () => {
    const tags = suggestTags("LO").map((s) => s.tag);
    expect(tags).toContain("long");
    expect(tags).not.toContain("short");
  });

  test("an alias prefix suggests the canonical tag", () => {
    expect(suggestTags("nb").map((s) => s.tag)).toContain("norwegian");
  });
});
