import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, test } from "vitest";
import { catalogText } from "../src/scenes/catalog";
import { ensureEnabledPacks } from "../src/scenes/packs";
import { validateSpec } from "../src/spec/schema";
import { planCommands } from "../src/render/plan";
import { BUILTIN_WIDGETS } from "../src/spec/types";
import type { Spec } from "../src/spec/types";

const base: Spec = {
  title: "t",
  template: "piano_keys",
  params: {},
  commands: [{ ask: { question: "Send?", widget: "piano_keys", answer: "SOS" } }],
} as unknown as Spec;

describe("ask.widget may name the spec's template", () => {
  test("the six built-in names and the template pass; anything else is an error", () => {
    expect(validateSpec(base).ok).toBe(true);
    for (const w of BUILTIN_WIDGETS) {
      // drag's answer is implied by its items; connect needs the reveal sentence.
      const ask =
        w === "drag"
          ? { question: "?", widget: "drag", items: ["a"], right: "r" }
          : w === "connect"
            ? { question: "?", widget: "connect", answer: "x", right: "r" }
            : { question: "?", widget: w, answer: "x" };
      expect(validateSpec({ ...base, commands: [{ ask }] } as unknown as Spec).ok, w).toBe(true);
    }
    const bad = validateSpec({ ...base, commands: [{ ask: { question: "?", widget: "morse_key", answer: "x" } }] } as unknown as Spec);
    expect(bad.ok).toBe(false);
    expect(bad.errors.join("\n")).toMatch(/ask\.widget "morse_key" is neither a built-in device .* nor this drawcast's template \("piano_keys"\)/);
  });

  test("the plan flags a template-bound ask", () => {
    const plan = planCommands(base.commands, [], { bboxOf: () => null, windows: {}, toLogical: (p) => p, deltaToLogical: (d) => d, animateBase: {} });
    const step = plan.steps.find((s) => s.kind === "ask") as { widget?: string; widgetTemplate?: true };
    expect(step.widget).toBe("piano_keys");
    expect(step.widgetTemplate).toBe(true);
    const plain = planCommands([{ ask: { question: "?", widget: "click", answer: "x" } }], [], { bboxOf: () => null, windows: {}, toLogical: (p) => p, deltaToLogical: (d) => d, animateBase: {} });
    expect((plain.steps[0] as { widgetTemplate?: true }).widgetTemplate).toBeUndefined();
  });

  test("naming a code element still wins: one question, one device", () => {
    const plan = planCommands([{ ask: { question: "?", code: "panel", widget: "piano_keys", answer: "x" } }], [], {
      bboxOf: () => null,
      windows: {},
      toLogical: (p) => p,
      deltaToLogical: (d) => d,
      animateBase: {},
    });
    const step = plan.steps.find((s) => s.kind === "ask") as { widget?: string; widgetTemplate?: true; codeId?: string };
    expect(step.widget).toBe("code");
    expect(step.codeId).toBe("panel");
    expect(step.widgetTemplate).toBeUndefined();
  });
});

// The compiler prompt tells the model to look for a marker in the catalog
// entry; until this round nothing ever emitted one, so the binding was
// unreachable for any request the model had not been handed by name.
describe("what the model sees: a workable template says so in its catalog entry", () => {
  beforeAll(async () => {
    await ensureEnabledPacks(["widgets"]);
  });
  test("the full entry carries the widget marker, and only for a widget-bearing template", () => {
    const text = catalogText({ forced: "morse_key" });
    expect(text).toContain("### Scene template: morse_key (READY");
    expect(text).toContain("widget: the viewer can work this figure while paused; an ask may bind to it with widget: morse_key");
    expect(catalogText({ forced: "supply_demand" })).not.toContain("widget: the viewer can work");
  });
  test("the ask bullet sends the model looking for exactly that marker", () => {
    const prompt = readFileSync("src/llm/prompts/compiler-v1.md", "utf8");
    expect(prompt).toContain('its catalog entry says "widget"');
  });
});

describe("the player's widget-ask branch and the gate — source pins", () => {
  const player = readFileSync("src/render/player.ts", "utf8");
  const index = readFileSync("src/render/index.ts", "utf8");
  const controls = readFileSync("src/ui/controls.ts", "utf8");
  const host = readFileSync("src/ui/widget-host.ts", "utf8");
  test("a template-bound ask on the auto path runs widgetDemo before the auto answer stands", () => {
    expect(player).toMatch(/widgetDemo: \(\(signal: AbortSignal, step: Extract<PlanStep, \{ kind: "ask" \}>\) => Promise<void>\) \| null = null/);
    const branch = player.slice(player.indexOf('if (step.widget !== undefined && (this.autoAnswers || !this.askGate))'), player.indexOf("typed = auto;"));
    expect(branch).toContain("if (step.widgetTemplate && this.widgetDemo) {");
    expect(branch).toContain("await this.widgetDemo(signal, step)");
  });
  test("render() wires the demo when the template carries a widget body", () => {
    expect(index).toMatch(/player\.widgetDemo = widgetDemoFor\(player, spec, layout\)/);
  });
  test("controls dispatches a template-bound ask to the widget gate", () => {
    expect(controls).toMatch(/step\.widgetTemplate && widgetHost\s*\?\s*widgetGate\(signal, step\)/);
  });
  test("the widget gate resolves the step's answer on a correct judgement and the given string otherwise", () => {
    const gate = host.slice(host.indexOf("export function widgetGateFor"));
    expect(gate).toContain("body.judge ? body.judge(given, step.answer) : answersMatch(given, step.answer)");
    expect(gate).toContain("resolve(ok ? step.answer : given)");
    expect(gate).toContain('class: "cs-figgate cs-widgetgate"'); // the figure gate's markup, plus the marker its own keys look for
    expect(gate).toContain("cs-figgate-skip");
    // A body that throws on construction must not take the question down with
    // it: the gate stands, body stays null, and answersMatch judges.
    expect(gate).toMatch(/try \{[\s\S]*scenes\[template\]!\.widget!\(\)[\s\S]*\} catch/);
  });
});
