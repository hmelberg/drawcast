import { describe, expect, it } from "vitest";
import { lintChipModel, type LintIssueLike } from "../src/ui/lint-chip";

const warn = (rule = "label-overlap"): LintIssueLike => ({ rule, message: "m", severity: "warn" });
const error = (): LintIssueLike => ({ rule: "out-of-canvas", message: "m", severity: "error" });

describe("lintChipModel — non-developer (D2 option 2: errors only)", () => {
  it("hides the chip when there are only warnings — compiler-quality noise the author cannot act on", () => {
    expect(lintChipModel([warn(), warn()], ["planner note"], false).hidden).toBe(true);
  });
  it("hides the clean chip", () => {
    expect(lintChipModel([], [], false).hidden).toBe(true);
  });
  it("shows errors, counting and listing errors alone", () => {
    const m = lintChipModel([warn(), error()], ["w"], false);
    expect(m.hidden).toBe(false);
    expect(m.text).toBe("⚠ 1");
    expect(m.className).toBe("lint-chip error");
    expect(m.items).toHaveLength(1);
    expect(m.items[0].className).toBe("error");
  });
});

describe("lintChipModel — developer mode (unchanged behaviour)", () => {
  it("reports clean as information", () => {
    const m = lintChipModel([], [], true);
    expect(m.hidden).toBe(false);
    expect(m.text).toBe("✓ Lint clean");
    expect(m.className).toBe("lint-chip clean");
  });
  it("shows the full count and list, worst severity wins", () => {
    const m = lintChipModel([warn(), error()], ["planner note"], true);
    expect(m.text).toBe("⚠ 3");
    expect(m.className).toBe("lint-chip error");
    expect(m.items).toHaveLength(3);
  });
  it("warn-only shows amber", () => {
    expect(lintChipModel([warn()], [], true).className).toBe("lint-chip warn");
  });
});
