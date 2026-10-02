import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, test } from "vitest";
import { lintCommands } from "../src/lint/lint";
import { layoutSpec } from "../src/layout/layout";
import { expandSpec } from "../src/spec/expand";
import { validateSpec } from "../src/spec/schema";
import { ensureEnginesForSpecs } from "../src/scenes/engines";
import { ensureEnabledPacks, PACK_DEFS } from "../src/scenes/packs";
import bundled from "../src/examples.json";
import { TAGS } from "../src/llm/tags";
import type { Command, Spec, SpecElement } from "../src/spec/types";

// Round 6 guidance (spec 2026-10-03-round6-reveals-choices-icons §10): the
// compiler prompt's new examples — a `choose` on drawn bars and a "tap all
// the …" cards element — must be valid, and lint clean, when the model
// copies them into a figure that has those parts.
const prompt = readFileSync("src/llm/prompts/compiler-v1.md", "utf8");
const ruleCard = readFileSync(".claude/skills/drawcast/references/rule-card.md", "utf8");

/** The balanced JSON object starting at `start`, as text — braces inside strings do not count. */
function objectAt(text: string, start: number): string {
  let depth = 0;
  let inString = false;
  let end = start;
  for (; end < text.length; end++) {
    const c = text[end];
    if (inString) {
      if (c === "\\") end++;
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) break;
  }
  return text.slice(start, end + 1);
}

/** The first JSON object in the prompt that starts with `head`, parsed. */
function firstObject<T>(head: string): T {
  const start = prompt.indexOf(head);
  if (start < 0) throw new Error(`the prompt has no ${head}`);
  return JSON.parse(objectAt(prompt, start)) as T;
}

/** A bundled example by its title (indexes move as examples are added). */
const example = (title: string): Spec & { commands: Command[] } => {
  const spec = (bundled as { spec?: Spec }[]).find((e) => e.spec?.title === title)?.spec;
  if (!spec) throw new Error(`no bundled example titled "${title}"`);
  return structuredClone({ ...spec, commands: spec.commands ?? [] });
};

/** Validation errors, then every lint finding (commands and layout). */
function check(spec: Spec): { valid: string[]; lint: string[] } {
  const v = validateSpec(spec);
  if (!v.ok) return { valid: v.errors, lint: [] };
  const ex = expandSpec(spec);
  const laid = layoutSpec(ex);
  return { valid: [], lint: [...laid.issues, ...lintCommands(ex)].map((i) => `${i.severity} ${i.rule}: ${i.message}`) };
}

beforeAll(async () => {
  await ensureEnabledPacks(Object.keys(PACK_DEFS));
  await ensureEnginesForSpecs([example("The deadliest animal")]);
});

describe("round 6 guidance in the compiler prompt", () => {
  test("the choose example is valid on the deadliest-animal bars, once they are drawn", () => {
    const ask = firstObject<Command>(`{"ask": {"question": "Which of these kills the most people? Tap its bar."`);
    expect((ask as { ask: { choose?: unknown } }).ask.choose).toEqual(["bar_1", "bar_4", "bar_5"]);
    const host = example("The deadliest animal");
    const at = host.commands.findIndex((c) => Array.isArray(c.draw) && c.draw.includes("bar_5"));
    expect(at).toBeGreaterThan(0);
    const spec = { ...host, commands: [...host.commands.slice(0, at + 1), ask, ...host.commands.slice(at + 1)] };
    expect(check(spec)).toEqual({ valid: [], lint: [] });
    // Asked before its bars are drawn, the same example is an error — the lint the prompt relies on.
    const early = { ...host, commands: [ask, ...host.commands] };
    expect(check(early).lint.some((l) => l.startsWith("error"))).toBe(true);
  });

  test("the tap-all example is a valid cards element in the mammals example", () => {
    const zoo = firstObject<SpecElement>(`{"id": "zoo", "type": "cards", "select": "Mammals"`);
    const host = example("Which of these are mammals?");
    expect(host.elements?.some((e) => e.id === "zoo")).toBe(true);
    const spec = { ...host, elements: (host.elements ?? []).map((e) => (e.id === "zoo" ? zoo : e)) };
    // The host highlights cards 5–8; the prompt's three cards keep to its first lines.
    spec.commands = spec.commands.filter((c) => !(c.highlight && JSON.stringify(c.highlight).includes("zoo_5")));
    expect(check(spec)).toEqual({ valid: [], lint: [] });
  });

  test("the prompt names deck, stage own, keyword icons and the picture look", () => {
    expect(prompt).toContain('`"deck": true`');
    expect(prompt).toContain('`"stage": "own"`');
    expect(prompt).toContain("write only the KEYWORD");
    expect(prompt).toContain('`"icon_look": "picture"`');
    expect(prompt).toContain('"judge": false');
  });

  test("the rule card and the #interactive brief carry the same lines", () => {
    for (const s of ["choose:", "deck: true", 'select: "Mammals"', 'stage: "own"', 'icon_look: "picture"']) expect(ruleCard).toContain(s);
    const brief = TAGS.find((t) => t.tag === "interactive")!.brief;
    for (const s of ["choose on them", "deck: true", "select (tap all the …)", 'stage: "own"', "shown as a picture"]) expect(brief).toContain(s);
  });

  test("the bundled deck and tap-all examples use the forms the prompt teaches", () => {
    const deck = example("Fruit or not? — a quick deck");
    const cards = deck.elements?.find((e) => e.type === "cards") as { deck?: boolean; items?: { text: string }[] } | undefined;
    expect(cards?.deck).toBe(true);
    expect(cards!.items!.length).toBeGreaterThanOrEqual(12);
    for (const it of cards!.items!) expect(it.text.split(/\s+/).length).toBeLessThanOrEqual(2);
    const zoo = example("Which of these are mammals?").elements?.find((e) => e.type === "cards") as { select?: string } | undefined;
    expect(zoo?.select).toBe("Mammals");
  });
});
