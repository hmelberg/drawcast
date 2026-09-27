import { describe, expect, test } from "vitest";
import { buildTreatmentSystem, buildTreatmentUser, stagingNote, TREATMENT_PROMPT_SOURCE } from "../src/llm/treatment";

describe("treatment → staging (prompt-lab arm C)", () => {
  test("the system prompt carries the sheet and the shortlisted templates", () => {
    const sys = buildTreatmentSystem("- supply_demand: Supply and demand curves.");
    expect(sys.startsWith(TREATMENT_PROMPT_SOURCE.trim())).toBe(true);
    expect(sys).toContain("- supply_demand: Supply and demand curves.");
    expect(buildTreatmentSystem("")).toContain("plan a freehand figure");
  });

  test("the house decisions are in the sheet", () => {
    expect(TREATMENT_PROMPT_SOURCE).toContain("12–17 sentences");
    expect(TREATMENT_PROMPT_SOURCE).toMatch(/ride\s+the scaffolding/);
  });

  test("the user turn and the staging note", () => {
    expect(buildTreatmentUser("Why?", "Directing brief:\n- short")).toBe("Why?\n\nDirecting brief:\n- short");
    expect(buildTreatmentUser("Why?")).toBe("Why?");
    const note = stagingNote("QUESTION: why?\nBEATS: 1. …");
    expect(note).toContain("## The treatment to stage");
    expect(note.endsWith("QUESTION: why?\nBEATS: 1. …")).toBe(true);
  });
});
