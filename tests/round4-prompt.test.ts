import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { lintCommands } from "../src/lint/lint";
import { expandSpec } from "../src/spec/expand";
import { validateSpec } from "../src/spec/schema";
import bundled from "../src/examples.json";
import { TAGS } from "../src/llm/tags";
import type { Command, Spec } from "../src/spec/types";

// Round 4 guidance (spec 2026-10-03 §8): the compiler prompt's one example each
// for a tree, a formula and a market ask must be valid when the model copies it.
const prompt = readFileSync("src/llm/prompts/compiler-v1.md", "utf8");
const bullet = prompt.split("\n").find((l) => l.startsWith("- Three asks that FILL OR MOVE")) ?? "";

/** Every balanced `{"ask": …}` / `{"animate": …}` JSON object in the bullet, parsed. */
function objects(text: string, key: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  let from = 0;
  for (;;) {
    const start = text.indexOf(`{"${key}":`, from);
    if (start < 0) return out;
    let depth = 0;
    let end = start;
    for (; end < text.length; end++) {
      if (text[end] === "{") depth++;
      else if (text[end] === "}" && --depth === 0) break;
    }
    out.push(JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>);
    from = end + 1;
  }
}

const asks = objects(bullet, "ask").map((o) => o as unknown as Command);
const [blanksAsk, pickAsk, tilesAsk, marketAsk] = asks;
const [marketAnimate] = objects(bullet, "animate").map((o) => ({ ...o, speak: "It moves." }) as unknown as Command);

const example = (i: number) => (bundled as { spec: Spec }[])[i]!.spec;
const issues = (spec: Spec) => lintCommands(expandSpec(spec)).filter((i) => i.rule === "guess" && i.severity === "error");

function check(spec: Spec) {
  const v = validateSpec(spec);
  expect(v.ok, JSON.stringify(v)).toBe(true);
  expect(issues(spec)).toEqual([]);
}

describe("round 4 asks in the compiler prompt", () => {
  test("the bullet carries the four asks and the animate", () => {
    expect(asks).toHaveLength(4);
    expect(marketAnimate).toBeDefined();
  });

  test("the tree blanks and pick are valid on the treat-or-wait tree", () => {
    const tree = example(373);
    check({ ...tree, commands: [...tree.commands.slice(0, 5), blanksAsk!, pickAsk!] });
  });

  test("the formula tiles are valid on the circle's area", () => {
    const area = example(375);
    check({ ...area, commands: [...area.commands.slice(0, 4), tilesAsk!] });
  });

  test("the market predict is valid right before the animate", () => {
    const market = example(378);
    const at = market.commands.findIndex((c) => c.ask !== undefined);
    check({ ...market, commands: [...market.commands.slice(0, at), marketAsk!, marketAnimate!] });
  });

  test("#interactive names the three new forms", () => {
    const brief = TAGS.find((t) => t.tag === "interactive")!.brief;
    expect(brief).toContain("move the curve");
    expect(brief).toContain("fill the tree");
    expect(brief).toContain("fill the formula");
  });
});
