import { describe, expect, test } from "vitest";
import { visualRepairMessages, VISUAL_REPAIR_PROMPT, wantsVisualRepair } from "../src/llm/visual";

describe("visual repair", () => {
  test("only freehand specs with a group qualify", () => {
    expect(wantsVisualRepair({ elements: [{ id: "g", type: "group", members: ["a"] }, { id: "a", type: "shape", shape: "rect", x: 1, y: 1 }], commands: [] } as never)).toBe(true);
    expect(wantsVisualRepair({ template: "supply_demand", elements: [{ id: "g", type: "group", members: ["a"] }], commands: [] } as never)).toBe(false);
    expect(wantsVisualRepair({ elements: [{ id: "a", type: "shape", shape: "rect", x: 1, y: 1 }], commands: [] } as never)).toBe(false);
  });
  test("the user turn carries the PNG as an image block, then the lint list and the prompt", () => {
    const m = visualRepairMessages("AAAA", [{ rule: "overlap-label-stroke", ids: ["a", "b"], severity: "warn", message: "a overlaps b" }]);
    expect(m).toHaveLength(1);
    const content = m[0].content as { type: string; text?: string; source?: { data: string; media_type: string } }[];
    expect(content[0]).toMatchObject({ type: "image", source: { media_type: "image/png", data: "AAAA" } });
    expect(content[1].text).toContain("a overlaps b");
    expect(content[1].text).toContain(VISUAL_REPAIR_PROMPT);
  });
});
