import { describe, expect, test } from "vitest";
import { compileTemplateDoc } from "../src/scenes/compile";
import { scenes } from "../src/scenes/registry";
import { lintCommands } from "../src/lint/lint";
import type { Spec } from "../src/spec/types";
import type { TemplateDoc } from "../src/scenes/doc";

const mk = (id: string, widget?: string): TemplateDoc =>
  ({
    template: id,
    version: 1,
    kit: 10,
    status: "ready",
    description: "d",
    params: { type: "object", properties: {} },
    element_ids: { pad: "p" },
    examples: [{ request: "r", params: {} }],
    layout: `return { drawables: [kit.pad("pad", [100, 100], "x", { r: 20 })], labels: [], anchors: {}, order: ["pad"] };`,
    ...(widget ? { widget } : {}),
  }) as TemplateDoc;

scenes["lint_with_widget"] = compileTemplateDoc(mk("lint_with_widget", "return { init: () => 0, on: (e, s) => ({ state: s, effects: [] }) };")).module!;
scenes["lint_without_widget"] = compileTemplateDoc(mk("lint_without_widget")).module!;

const spec = (template: string): Spec => ({ title: "t", template, params: {}, commands: [{ ask: { question: "?", widget: template, answer: "x" } }] }) as unknown as Spec;

describe("lint rule widget", () => {
  test("an ask bound to a template with a widget body is clean", () => {
    expect(lintCommands(spec("lint_with_widget")).filter((i) => i.rule === "widget")).toEqual([]);
  });
  test("an ask bound to a template without one is an error", () => {
    const issues = lintCommands(spec("lint_without_widget")).filter((i) => i.rule === "widget");
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe("error");
    expect(issues[0].message).toMatch(/"lint_without_widget" has no widget body/);
  });
  test("built-in devices are not this rule's business", () => {
    const s = { ...spec("lint_without_widget"), commands: [{ ask: { question: "?", widget: "click", answer: "pad" } }] } as unknown as Spec;
    expect(lintCommands(s).filter((i) => i.rule === "widget")).toEqual([]);
  });
});
