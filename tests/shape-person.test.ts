// W25: `shape: "person"` on a shape element draws the stick figure a node draws.
import { describe, expect, test } from "vitest";
import { layoutSpec } from "../src/layout/layout";
import type { Spec } from "../src/spec/types";

describe("shape person", () => {
  test("a stick figure, not an empty rectangle", () => {
    const spec = { elements: [{ id: "who", type: "shape", shape: "person", x: 300, y: 400, height: 120 }], commands: [{ draw: ["who"] }] } as unknown as Spec;
    const out = layoutSpec(spec);
    const d = out.drawables.find((x) => x.id === "who")!;
    expect(d.kind).toBe("group");
    const kids = d.kind === "group" ? d.children.map((k) => k.id) : [];
    expect(kids).toEqual(["who_head", "who_body"]);
    expect(out.warnings.filter((w) => /who/.test(w))).toEqual([]);
  });
});
