import { describe, expect, test } from "vitest";
import { needsRepair, repairModelFor } from "../src/llm/compile";
import { buildSystemBlocks } from "../src/llm/prompt";
import type { LintIssue } from "../src/lint/lint";

const warn = (rule: LintIssue["rule"]): LintIssue => ({ rule, ids: [], message: "m", severity: "warn" });
const error = (rule: LintIssue["rule"]): LintIssue => ({ rule, ids: [], message: "m", severity: "error" });

describe("needsRepair — repair rounds fire only on real problems", () => {
  test("validation errors always repair", () => {
    expect(needsRepair(["bad"], [])).toBe(true);
  });

  test("error-severity lint repairs", () => {
    expect(needsRepair([], [error("out-of-canvas")])).toBe(true);
  });

  test("warn-only lint does NOT repair (cosmetic; the layout solver already nudges)", () => {
    expect(needsRepair([], [warn("overlap-label-label"), warn("font-too-small")])).toBe(false);
  });

  test("clean result does not repair", () => {
    expect(needsRepair([], [])).toBe(false);
  });
});

describe("repairModelFor — repairs are mechanical, use a faster model", () => {
  test("opus-tier repairs on sonnet", () => {
    expect(repairModelFor("claude-opus-5")).toBe("claude-sonnet-5");
  });

  test("sonnet and haiku repair on themselves (never a slower model than chosen)", () => {
    expect(repairModelFor("claude-sonnet-5")).toBe("claude-sonnet-5");
    expect(repairModelFor("claude-haiku-4-5")).toBe("claude-haiku-4-5");
  });
});

describe("buildSystemBlocks — static prefix cacheable, exemplars in the dynamic tail", () => {
  const source = "Rules here.\n{{SCHEMA}}\nCatalog: {{CATALOG}}\nShots: {{FEWSHOTS}}\n## Exemplars\n{{EXEMPLARS}}\nEnd.";
  const parts = { schema: { a: 1 }, catalog: "CAT", fewshots: "FEW", exemplars: "EXE" };

  test("splits at the exemplars placeholder with all other placeholders filled", () => {
    const { prefix, suffix } = buildSystemBlocks(source, parts);
    expect(prefix).toContain('"a": 1');
    expect(prefix).toContain("CAT");
    expect(prefix).toContain("FEW");
    expect(prefix).not.toContain("EXE");
    expect(suffix).toContain("EXE");
    expect(suffix).toContain("End.");
    expect(prefix + suffix).not.toContain("{{");
  });

  test("a source without the exemplars placeholder becomes one fully static block", () => {
    const { prefix, suffix } = buildSystemBlocks("Only {{SCHEMA}} here.", parts);
    expect(prefix).toContain('"a": 1');
    expect(suffix).toBe("");
  });

  test("prefix is byte-stable across calls with different exemplars (cache hit precondition)", () => {
    const a = buildSystemBlocks(source, { ...parts, exemplars: "EXE-1" });
    const b = buildSystemBlocks(source, { ...parts, exemplars: "EXE-2" });
    expect(a.prefix).toBe(b.prefix);
    expect(a.suffix).not.toBe(b.suffix);
  });
});
