import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { buildSystemPrompt, missingPlaceholders, selectExemplars, stripFence, styleBlock } from "../src/llm/prompt";

const compilerV1 = readFileSync(new URL("../src/llm/prompts/compiler-v1.md", import.meta.url), "utf8");
const compilerV1Code = readFileSync(new URL("../src/llm/prompts/compiler-v1-code.md", import.meta.url), "utf8");

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

  test("opens with the drawn title at the top — the app adds no duplicate around it (C9, clarified)", () => {
    expect(compilerV1).toContain("the title counts as something");
    expect(compilerV1).toContain("at the top of the canvas");
    expect(compilerV1).toContain("NO separate title text");
    expect(compilerV1).toContain("Speaking and drawing are not turns");
  });

  test("says which element a photo is, on both bullets that could be picked (B2)", () => {
    const clause = "`portrait` is for people; a photo of a THING";
    expect(compilerV1).toContain(clause);
    // Once in the freehand image bullet, once on the portrait bullet itself —
    // the model reads whichever it happens to be looking at.
    expect(compilerV1.split(clause).length - 1).toBe(2);
    expect(compilerV1).toContain("a photo of a THING — a building, an instrument, an animal — is `image`");
  });

  test("caps how big a freehand figure may get (B2)", () => {
    expect(compilerV1).toContain("A figure is at most about 30 elements and 15 beats; when a thing has more parts, name the six that matter.");
  });

  test("the freehand section stays short enough to be read", () => {
    const from = compilerV1.indexOf("## Freehand figures");
    const section = compilerV1.slice(from, compilerV1.indexOf("\n## ", from + 1));
    expect(section.split("\n").length).toBeLessThanOrEqual(25);
  });

  // The data bridge and the data templates are part of the CODE block, so they
  // are pinned in compiler-v1-code.md — the file {{CODE}} fills for a request
  // that wants a running script (Task 10). Same phrases, new home.
  test("teaches the data bridge: tokens, depth-means-staged, typed labels", () => {
    expect(compilerV1Code).toContain('"{sim.y}"');
    expect(compilerV1Code).toContain("Depth means staged");
    expect(compilerV1Code).toContain("TYPE the labels");
    expect(compilerV1Code).toContain('"show": "none"');
  });

  test("names the other data templates (line_chart, scatter_plot)", () => {
    expect(compilerV1Code).toContain("scatter_plot");
    expect(compilerV1Code).toContain("line_chart");
  });

  test("the action-verb inventory lists flip, morph, flow and keep", () => {
    const line = compilerV1.split("\n").find((l) => l.includes("Each command sets ONE action verb"));
    expect(line).toBeDefined();
    expect(line).toMatch(/`flip`/);
    expect(line).toMatch(/`morph`/);
    expect(line).toMatch(/`flow`/);
    expect(line).toMatch(/`keep`/);
  });

  test("teaches anchors and the four motion-round-2 verbs", () => {
    for (const s of ["\"anchor\": \"tail\"", "`flip`", "`morph`", "`flow`", "\"trail\": true", "riemann_sum", "tangent_secant", "compute a coordinate for a point you can name"]) expect(compilerV1).toContain(s);
  });

  test("teaches keep/ghost, the minted-elements verb of motion round 3", () => {
    for (const s of ["`keep`", "`ghost`", "\"keep\": {\"target\": \"kake\"}", "\"ghost\": true"]) expect(compilerV1).toContain(s);
  });

  test("teaches angle, measure, ellipse, line, unroll and halving — motion round 3's new elements and cut", () => {
    for (const s of ["`angle`", "`measure`", "`ellipse`", "`line`", "unroll", "halving", "`keep`"]) expect(compilerV1).toContain(s);
  });

  test("the freehand section makes the model plan the parts before writing elements", () => {
    // The rule the whole section hangs on: an assembly planned as a chain of
    // `at`s comes out assembled; one planned element by element comes out a pile.
    expect(compilerV1).toContain("## Freehand figures");
    expect(compilerV1).toContain("List the parts and how they sit BEFORE writing elements");
    expect(compilerV1).toContain('{"ref": "nucleus", "side": "right", "gap": 20}');
    expect(compilerV1).toContain('{"fit": "left"}');
  });

  test("the freehand section separates the icon STAMP from the seed's ready paths", () => {
    expect(compilerV1).toContain("`icon` is a STAMP; the seed is a starting shape");
    expect(compilerV1).toContain("arrives as ready `path` elements in a group named `seed`");
  });

  test("the freehand section names the anti-patterns", () => {
    const line = compilerV1.split("\n").find((l) => l.includes("**Anti-patterns, by name**"));
    expect(line).toBeDefined();
    expect(line).toContain("coordinates computed per element");
    expect(line).toContain("more than one image");
    expect(line).toContain("a formula typed as `text`");
    expect(line).toContain("an icon used as the whole figure");
  });

  test("the code bullets moved to their own file, reached through the optional {{CODE}} placeholder", () => {
    expect(compilerV1).toContain("\n{{CODE}}\n"); // on its own line, where the bullets were
    expect(compilerV1).not.toContain("**code** runs a real script");
    expect(compilerV1Code).toContain("**code** runs a real script");
    expect(compilerV1Code).toContain("**Data from code, drawn as ink.**");
  });

  test("teaches that a measure's number is the separate element label_<id>, named in draw beside the line", () => {
    // Round 3 review, I2: without this the model writes `draw: ["side"]` and
    // the number falls into the implicit final draw at the end of the cast.
    for (const s of ["`label_<id>`", '"draw": ["side", "label_side"]', '"draw": ["areal"]']) expect(compilerV1).toContain(s);
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

  // Half this app's requests are written in Norwegian and the stoplist was
  // English-only, so "hvordan", "hvorfor", "forklar" and "vis" survived as
  // keywords and a request scored overlap on filler alone. Measured against
  // src/examples.json before the fix, «Forklar hvorfor renter påvirker
  // inflasjonen» picked the 1/2+1/4+1/8 series, "Hvorfor heter jern Fe?" and
  // the circle-area proof — three exemplars, all on the single word "hvorfor".
  test("a Norwegian request never matches on Norwegian filler words alone", () => {
    const norwegian = [
      { prompt: "Hvorfor er arealet av en sirkel πr²?", spec: { commands: [] } },
      { prompt: "Vis hvordan en vektstang balanserer", spec: { commands: [] } },
      { prompt: "Forklar hvorfor jern heter Fe", spec: { commands: [] } },
    ];
    expect(selectExemplars("Forklar hvordan en vaksine virker", norwegian, 3)).toEqual([]);
  });

  // The same hole on the English side, and STYLE.md's 2026-09-07 ruling makes
  // it worse over time: every request is to be phrased as a QUESTION, so the
  // interrogative openers the stoplist never covered ("how", "what", "why",
  // "does") are exactly the words every request now shares. Measured before
  // the fix: "How does a vaccine actually work?" picked a confidence-interval
  // figure and an atrial-fibrillation figure on "does" and "actually".
  test("an English question never matches on interrogative openers alone", () => {
    const questions = [
      { prompt: "What does 95 percent confidence actually mean?", spec: { commands: [] } },
      { prompt: "How does a lock and key open a door?", spec: { commands: [] } },
      { prompt: "Why does the sky turn?", spec: { commands: [] } },
    ];
    expect(selectExemplars("How does a vaccine actually work?", questions, 3)).toEqual([]);
  });

  test("a real topical overlap still selects, in either language", () => {
    const mixed = [
      { prompt: "Hvorfor er arealet av en sirkel πr²?", spec: { commands: [] } },
      { prompt: "Forklar hvordan en vaksine gir flokkimmunitet", spec: { commands: [] } },
    ];
    expect(selectExemplars("Forklar hvordan en vaksine virker", mixed, 1)[0].prompt).toMatch(/vaksine/);
    expect(selectExemplars("How does a vaccine work?", pool, 1)).toEqual([]);
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
