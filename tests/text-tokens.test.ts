import { describe, expect, test } from "vitest";
import { requestedTokens, scanTextTokens } from "../src/code/tokens";
import { layoutSpec } from "../src/layout/layout";
import type { Spec } from "../src/spec/types";

describe("script values in drawn text", () => {
  const elements = [
    { id: "pow", type: "code", language: "r", show: "none", code: "x <- 1" },
    { id: "result", type: "text", text: "{pow.label} — {market.dwl}", x: 500, y: 300 },
  ] as never[];

  test("text tokens name code elements only, and join the harvest request", () => {
    expect(scanTextTokens(elements).map((t) => `${t.codeId}.${t.path}`)).toEqual(["pow.label"]);
    expect(requestedTokens({ params: { values: "{pow.pw}" }, elements }).map((t) => t.path)).toEqual(["pw", "label"]);
  });

  test("the layout writes the script's value; before it runs, a quiet ellipsis and no warning", () => {
    const before = layoutSpec({ title: "t", elements: [elements[0], { id: "r", type: "text", text: "{pow.label}", x: 500, y: 300 }], commands: [] } as unknown as Spec);
    const t0 = before.drawables.find((d) => d.id === "r") as { text?: string };
    expect(t0.text).toBe("…");
    expect(before.warnings.some((w) => w.includes("pow.label"))).toBe(false);
    const envelope = JSON.stringify({ ok: true, stdout: "", stderr: "", figures: [], data: { label: ["40 per arm: power 42%"], here: [42.3] } });
    const after = layoutSpec({
      title: "t",
      elements: [{ ...(elements[0] as object), code_result: envelope }, { id: "r", type: "text", text: "{pow.label} ({pow.here:0})", x: 500, y: 300 }],
      commands: [],
    } as unknown as Spec);
    expect((after.drawables.find((d) => d.id === "r") as { text?: string }).text).toBe("40 per arm: power 42% (42)");
  });
});
