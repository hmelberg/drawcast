import { describe, expect, test } from "vitest";
import { sharedBriefIds } from "../src/llm/multi";

describe("sharedBriefIds", () => {
  test("only ids two or more freehand parts agree on", () => {
    expect([...sharedBriefIds([{ id: "sewing_machine", description: "x" }, null, { id: "sewing_machine", description: "y" }, { id: "violin", description: "z" }])]).toEqual(["sewing_machine"]);
    expect(sharedBriefIds([{ id: "a", description: "" }, { id: "b", description: "" }]).size).toBe(0);
  });
});
