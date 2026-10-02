// Round 5 lint (spec 2026-10-03-looks-feedback-account §7): feedback that
// does nothing warns (band lines or a joke/picture reward under plain; a
// non-English cast with a flavour but no lines of its own — there is no
// fallback in its language); a card icon that is a sentence warns; `look`
// on anything but cards (or image's own "screen") is a schema error.
import { describe, expect, test } from "vitest";
import { lintCommands } from "../src/lint/lint";
import { validateSpec } from "../src/spec/schema";
import type { Spec } from "../src/spec/types";

const rank = { id: "r", type: "cards", items: ["Cheetah", "Horse", "Human"], ends: ["fastest", "slowest"] };
const cast = (over: Record<string, unknown> = {}, ask: Record<string, unknown> = {}): Spec =>
  ({ elements: [rank], commands: [{ draw: ["r"] }, { ask: { question: "Order them.", on: "r", ...ask } }], ...over }) as unknown as Spec;
const issues = (spec: Spec, rule: string) => lintCommands(spec).filter((i) => i.rule === rule);

describe("feedback lint", () => {
  test("a flavour with lines, or a plain cast, is clean", () => {
    expect(issues(cast({ feedback: { style: "dry", perfect: "Fast work." } }), "feedback")).toEqual([]);
    expect(issues(cast(), "feedback")).toEqual([]);
    expect(issues(cast({ feedback: "warm" }), "feedback")).toEqual([]); // English: the fallback lines
  });

  test("band lines with style plain warn (on the cast and on an ask)", () => {
    const a = issues(cast({ feedback: { style: "plain", perfect: "Fast work." } }), "feedback");
    expect(a).toHaveLength(1);
    expect(a[0].severity).toBe("warn");
    expect(a[0].message).toMatch(/plain/);
    expect(issues(cast({}, { feedback: { style: "plain", none: "Oh well." } }), "feedback")).toHaveLength(1);
  });

  test("a joke or picture reward under plain warns", () => {
    for (const reward of ["joke", "picture"]) {
      const a = issues(cast({ feedback: { style: "plain", reward } }), "feedback");
      expect(a.some((i) => i.message.includes(reward))).toBe(true);
      // No style and no lines is plain too.
      expect(issues(cast({}, { feedback: { reward } }), "feedback").some((i) => i.message.includes(reward))).toBe(true);
    }
    expect(issues(cast({ feedback: { style: "warm", reward: "joke" } }), "feedback")).toEqual([]);
  });

  test("a non-English cast with a flavour and no lines warns; with its own lines it is clean", () => {
    const a = issues(cast({ lang: "nb", feedback: "warm" }), "feedback");
    expect(a).toHaveLength(1);
    expect(a[0].message).toMatch(/nb/);
    expect(issues(cast({ lang: "nb" }, { feedback: "dry" }), "feedback")).toHaveLength(1);
    expect(issues(cast({ lang: "nb", feedback: { style: "warm", perfect: "Helt riktig!" } }), "feedback")).toEqual([]);
    // The ask's own lines count, and the cast's lines reach the ask.
    expect(issues(cast({ lang: "nb", feedback: "warm" }, { feedback: { good: "Nesten!" } }), "feedback")).toEqual([]);
    expect(issues(cast({ lang: "en-GB", feedback: "warm" }), "feedback")).toEqual([]);
  });

  test("a card icon of more than three words warns", () => {
    const words = (icon: unknown, key = "icon") =>
      issues({ elements: [{ ...rank, items: [{ text: "Cheetah", [key]: icon }, "Horse"] }], commands: [{ draw: ["r"] }] } as unknown as Spec, "card-icon");
    expect(words("cheetah")).toEqual([]);
    expect(words("running horse")).toEqual([]);
    expect(words("a big cat running very fast")).toHaveLength(1);
    expect(words({ of: "a big cat running very fast", set: "twemoji" })).toHaveLength(1);
    expect(words("a cup of strong coffee", "match_icon")).toHaveLength(1);
  });
});

describe("look schema", () => {
  test("look on a node or a label is a schema error; on cards and image it is not", () => {
    const node = { elements: [{ id: "n", type: "node", shape: "rect", text: "Hi", look: "paper" }], commands: [{ draw: ["n"] }] };
    const r = validateSpec(node);
    expect(r.ok).toBe(false);
    expect(r.errors.join("\n")).toMatch(/look/);
    expect(validateSpec({ elements: [{ ...rank, look: "flat" }], commands: [{ draw: ["r"] }] }).errors).toEqual([]);
  });

  test("a cards look on an image, or screen on cards, is a schema error", () => {
    expect(validateSpec({ elements: [{ ...rank, look: "screen" }], commands: [{ draw: ["r"] }] }).ok).toBe(false);
  });
});
