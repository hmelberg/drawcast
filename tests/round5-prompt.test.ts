import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { lintCommands } from "../src/lint/lint";
import { expandSpec } from "../src/spec/expand";
import { validateSpec } from "../src/spec/schema";
import bundled from "../src/examples.json";
import { TAGS } from "../src/llm/tags";
import type { Command, Spec } from "../src/spec/types";

// Round 5 guidance (spec 2026-10-03-looks-feedback-account §6): the compiler
// prompt's one example ask with feedback lines must be valid when the model copies it.
const prompt = readFileSync("src/llm/prompts/compiler-v1.md", "utf8");
const bullet = prompt.split("\n").find((l) => l.startsWith("- `feedback` (optional")) ?? "";

/** The first balanced `{"ask": …}` JSON object in the bullet, parsed. */
function firstAsk(text: string): Command | undefined {
  const start = text.indexOf(`{"ask":`);
  if (start < 0) return undefined;
  let depth = 0;
  let end = start;
  for (; end < text.length; end++) {
    if (text[end] === "{") depth++;
    else if (text[end] === "}" && --depth === 0) break;
  }
  return JSON.parse(text.slice(start, end + 1)) as Command;
}

/** A bundled example by its title (indexes move as examples are added). */
const example = (title: string): Spec & { commands: Command[] } => {
  const spec = (bundled as { spec?: Spec }[]).find((e) => e.spec?.title === title)?.spec;
  if (!spec) throw new Error(`no bundled example titled "${title}"`);
  return { ...spec, commands: spec.commands ?? [] };
};

describe("round 5 guidance in the compiler prompt", () => {
  const ask = firstAsk(bullet);

  test("the feedback bullet carries one ask with all four band lines", () => {
    expect(ask).toBeDefined();
    const fb = (ask as { ask: { feedback?: Record<string, unknown> } }).ask.feedback;
    expect(fb).toBeDefined();
    for (const band of ["perfect", "good", "poor", "none"]) expect(typeof fb![band]).toBe("string");
  });

  test("the example ask is valid on the fruit sort, with no lint warnings or errors", () => {
    const fruit = example("Is it a fruit?");
    const at = fruit.commands.findIndex((c) => c.ask !== undefined);
    expect(at).toBeGreaterThan(0);
    const spec = { ...fruit, commands: [...fruit.commands.slice(0, at), ask!] };
    const v = validateSpec(spec);
    expect(v.ok, JSON.stringify(v)).toBe(true);
    expect(lintCommands(expandSpec(spec))).toEqual([]);
  });

  test("the prompt names icons on cards and boxes, look, and the account bar", () => {
    expect(prompt).toContain("A node box or a card item takes `\"icon\"`");
    expect(prompt).toContain("`match_icon`");
    expect(prompt).toContain("`look` (paper, flat, outline)");
    expect(prompt).toContain("`account_label`");
  });

  test("#interactive names icons on cards and feedback", () => {
    const brief = TAGS.find((t) => t.tag === "interactive")!.brief;
    expect(brief).toContain("`icon`");
    expect(brief).toContain("`feedback`");
    expect(brief).toContain("account_label");
  });
});
