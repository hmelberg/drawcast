import { describe, expect, test } from "vitest";
import { normalizeSpec, validateSpec } from "../src/spec/schema";
import { planCommands } from "../src/render/plan";
import type { Command } from "../src/spec/types";

const base = {
  elements: [{ id: "t", type: "text", text: "hi", x: 500, y: 375 }],
};

describe("spec.level", () => {
  test("level basic/advanced validates", () => {
    expect(validateSpec({ ...base, level: "basic", commands: [] }).ok).toBe(true);
    expect(validateSpec({ ...base, level: "advanced", commands: [] }).ok).toBe(true);
  });

  test("an unknown level is rejected", () => {
    expect(validateSpec({ ...base, level: "expert", commands: [] }).ok).toBe(false);
  });
});

describe("wait verb", () => {
  test('{"wait": "click"} validates as a command', () => {
    expect(validateSpec({ ...base, commands: [{ wait: "click" }] }).ok).toBe(true);
  });

  test("wait plus another action verb in one command is rejected", () => {
    const v = validateSpec({ ...base, commands: [{ wait: "click", pause: 1 }] });
    expect(v.ok).toBe(false);
    expect(v.errors[0]).toContain("at most one action verb");
  });

  test('normalizeSpec maps the YAML-friendly pause: "click" to wait', () => {
    const n = normalizeSpec({ commands: [{ pause: "click" }] }) as { commands: Command[] };
    expect(n.commands[0]).toEqual({ wait: "click" });
  });

  test('a spec written with pause: "click" validates end to end', () => {
    expect(validateSpec({ ...base, commands: [{ pause: "click" }] }).ok).toBe(true);
  });

  test("clear warns when it wipes an element drawn just beforehand (forgotten keep)", () => {
    const plan = planCommands(
      [{ draw: ["a"] }, { draw: ["b"] }, { clear: { keep: ["a"] } }] as Command[],
      ["a", "b"],
    );
    expect(plan.warnings.join(" ")).toMatch(/clear hides "b".*just drawn/);
  });

  test("clear long after a draw does not warn", () => {
    const plan = planCommands(
      [{ draw: ["b"] }, { pause: 1 }, { pause: 1 }, { pause: 1 }, { clear: {} }] as Command[],
      ["b"],
    );
    expect(plan.warnings.join(" ")).not.toMatch(/just drawn/);
  });

  test("planCommands emits a wait step that leaves scene state unchanged", () => {
    const plan = planCommands([{ draw: ["t"] }, { wait: "click" }] as Command[], ["t"]);
    expect(plan.steps[1]).toEqual({ kind: "wait" });
    expect(plan.states[1]).toEqual(plan.states[0]);
    expect(plan.warnings).toEqual([]);
  });
});
