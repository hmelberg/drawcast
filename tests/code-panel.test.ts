// The code panel round: layouts (show names where the code sits), the
// scrolling window (lines), its clip and published bottoms, the output
// tail, and the plan's scroll offsets. Pure node: layout geometry and plan
// states; the player tween and the clip rendering are the live smoke's.

import { describe, expect, test } from "vitest";
import { validateSpec } from "../src/spec/schema";
import { lintCommands } from "../src/lint/lint";
import type { Spec } from "../src/spec/types";

const spec = (el: object, commands: object[] = []): Spec =>
  ({ elements: [{ id: "c1", type: "code", language: "python", code: "print(1)", ...el }], commands }) as unknown as Spec;

describe("code panel vocabulary", () => {
  test("show names where the code sits; split is gone", () => {
    for (const s of ["output", "left", "right", "above", "below", "code", "none"]) expect(validateSpec(spec({ show: s })).ok).toBe(true);
    expect(validateSpec(spec({ show: "split" })).ok).toBe(false);
  });
  test("lines is an integer of at least 3", () => {
    expect(validateSpec(spec({ lines: 6 })).ok).toBe(true);
    expect(validateSpec(spec({ lines: 2 })).ok).toBe(false);
    expect(validateSpec(spec({ lines: 4.5 })).ok).toBe(false);
  });
  test("lint: a stacked layout with a long script and no window is called out; a narrow side-by-side too", () => {
    const long = Array.from({ length: 14 }, (_, i) => `x${i} = ${i}`).join("\n");
    expect(lintCommands(spec({ show: "above", code: long })).some((i) => i.rule === "code-use" && /set lines/.test(i.message))).toBe(true);
    expect(lintCommands(spec({ show: "above", code: long, lines: 6 })).some((i) => /set lines/.test(i.message))).toBe(false);
    expect(lintCommands(spec({ show: "right", width: 400 })).some((i) => i.rule === "code-use")).toBe(true);
  });
});
