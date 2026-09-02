import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { buildSystemPrompt, missingPlaceholders, selectExemplars, stripFence, styleBlock } from "../src/llm/prompt";

const compilerV1 = readFileSync(new URL("../src/llm/prompts/compiler-v1.md", import.meta.url), "utf8");

describe("compiler prompt style rules", () => {
  test("carries the color-by-role palette rule", () => {
    expect(compilerV1).toContain("Color by role");
    expect(compilerV1).toContain("#2f6b8f"); // the palette is spelled out as usable hex values
  });

  test("bans signposted emphasis and assumes an intelligent viewer", () => {
    expect(compilerV1).toContain("It is important to note"); // named as a banned phrase
    expect(compilerV1).toContain("Assume an intelligent viewer");
  });

  test("aims the insight at the non-intuitive and marks the rules as defaults", () => {
    expect(compilerV1).toContain("non-intuitive");
    expect(compilerV1).toContain("defaults, not laws");
  });

  test("demands the topic be situated — stakes stated or hinted before the mechanics", () => {
    expect(compilerV1).toContain("Situate the topic");
    expect(compilerV1).toContain("No concept is important in itself");
  });

  test("opens with the drawn title — the written one sits below the player now (C9)", () => {
    expect(compilerV1).toContain("the title counts as something");
    expect(compilerV1).toContain("BELOW the player");
    expect(compilerV1).toContain("Speaking and drawing are not turns");
  });
});

describe("buildSystemPrompt", () => {
  test("substitutes schema, catalog, fewshot, and exemplar placeholders", () => {
    const out = buildSystemPrompt("Rules.\n{{SCHEMA}}\n{{CATALOG}}\n{{FEWSHOTS}}\n{{EXEMPLARS}}", {
      schema: { type: "object" },
      catalog: "SCENE CATALOG HERE",
      fewshots: "FEWSHOTS HERE",
      exemplars: "EXEMPLARS HERE",
    });
    expect(out).toContain('"type": "object"');
    expect(out).toContain("SCENE CATALOG HERE");
    expect(out).toContain("FEWSHOTS HERE");
    expect(out).toContain("EXEMPLARS HERE");
    expect(out).not.toMatch(/\{\{[A-Z]+\}\}/);
  });
});

describe("missingPlaceholders", () => {
  test("a complete prompt has none missing", () => {
    expect(missingPlaceholders("x {{SCHEMA}} y {{CATALOG}} {{FEWSHOTS}} {{EXEMPLARS}}")).toEqual([]);
  });

  test("reports exactly the absent placeholders", () => {
    expect(missingPlaceholders("only {{SCHEMA}} here")).toEqual(["{{CATALOG}}", "{{FEWSHOTS}}", "{{EXEMPLARS}}"]);
  });
});

describe("stripFence", () => {
  test("removes a fence wrapping the whole text", () => {
    expect(stripFence("```markdown\n# Prompt\nbody\n```")).toBe("# Prompt\nbody");
    expect(stripFence("```\nplain\n```")).toBe("plain");
  });

  test("leaves unfenced text (and inner fences) alone", () => {
    expect(stripFence("# Prompt\n```json\n{}\n```\ntail")).toBe("# Prompt\n```json\n{}\n```\ntail");
  });
});

describe("selectExemplars", () => {
  const pool = [
    { prompt: "Draw a demand and supply diagram", spec: { commands: [] } },
    { prompt: "Draw a supply curve shifting right", spec: { commands: [] } },
    { prompt: "Show herd immunity as a network", spec: { commands: [] } },
  ];

  test("ranks by keyword overlap with the request", () => {
    const picked = selectExemplars("draw a supply and demand diagram with equilibrium", pool, 2);
    expect(picked[0].prompt).toMatch(/demand and supply/);
    expect(picked).toHaveLength(2);
  });

  test("returns empty for an empty pool", () => {
    expect(selectExemplars("anything", [], 3)).toEqual([]);
  });

  test("ignores exemplars with no overlap at all", () => {
    const picked = selectExemplars("xylophone quantum zebra", pool, 3);
    expect(picked).toEqual([]);
  });
});

describe("styleBlock — the author's style is added last, so it wins (B5, S §4)", () => {
  test("empty, missing and whitespace styles produce nothing", () => {
    expect(styleBlock(undefined)).toBe("");
    expect(styleBlock("")).toBe("");
    expect(styleBlock("   \n ")).toBe("");
  });

  test("a real style becomes a block that declares the author wins", () => {
    const b = styleBlock("Open with a question.");
    expect(b).toContain("Open with a question.");
    expect(b).toContain("the author's instructions win");
    expect(b.startsWith("\n\n## ")).toBe(true); // appended, never replacing
  });

  test("compile and revise both append it to the request suffix", () => {
    // An append can never be skipped — a user-made prompt fork predating the
    // concept would silently drop a placeholder. These pin the seam.
    const compile = readFileSync(new URL("../src/llm/compile.ts", import.meta.url), "utf8");
    const revise = readFileSync(new URL("../src/llm/revise.ts", import.meta.url), "utf8");
    expect(compile.match(/suffixText = [^;]*styleBlock\(cfg\.styleText\)/g)?.length).toBe(2);
    expect(revise.match(/suffixText = [^;]*styleBlock\(cfg\.styleText\)/g)?.length).toBe(1);
  });
});
