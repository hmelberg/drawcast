// The CODE element: a Python/R script whose code and/or output is drawn on
// the canvas. Schema, the result envelope + cached facade, tier-2 layout
// (panel, per-line ids, output pane, error panel, placeholder), the resolver
// with an injected fake runner, hoisting, lint, and the generation-time
// execution check. Nothing here loads WASM or touches the network.

import { describe, expect, test } from "vitest";
import { validateSpec } from "../src/spec/schema";
import type { Spec } from "../src/spec/types";

const spec = (el: object): Spec =>
  ({ elements: [{ id: "c1", type: "code", ...el }], commands: [] }) as unknown as Spec;

describe("code element — schema", () => {
  test("validates with language + code; rejects either missing", () => {
    expect(validateSpec(spec({ language: "python", code: "print(1)" })).ok).toBe(true);
    expect(validateSpec(spec({ language: "r", code: "1 + 1" })).ok).toBe(true);
    expect(validateSpec(spec({ language: "python" })).ok).toBe(false);
    expect(validateSpec(spec({ code: "print(1)" })).ok).toBe(false);
    expect(validateSpec(spec({ language: "cobol", code: "x" })).ok).toBe(false);
  });

  test("show, width, font_size and code_result are accepted; junk is not", () => {
    expect(validateSpec(spec({ language: "python", code: "print(1)", show: "split", width: 880, font_size: 17 })).ok).toBe(true);
    expect(validateSpec(spec({ language: "python", code: "print(1)", code_result: "{}" })).ok).toBe(true);
    expect(validateSpec(spec({ language: "python", code: "print(1)", show: "sideways" })).ok).toBe(false);
    expect(validateSpec(spec({ language: "python", code: "print(1)", nonsense: 1 })).ok).toBe(false);
  });
});
