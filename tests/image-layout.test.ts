import { describe, expect, test } from "vitest";
import { layoutSpec, elementBBoxes } from "../src/layout/layout";
import { flattenDrawables } from "../src/layout/model";
import { encodePhoto } from "../src/spec/trace";

const strokes = encodePhoto(0.5, "data:image/jpeg;base64,AAAA");

describe("image element layout", () => {
  test("photo with credit caption below, sized by width, placeable with at", () => {
    const r = layoutSpec({
      elements: [
        { id: "a", type: "shape", shape: "rect", x: 300, y: 300, width: 100, height: 40 },
        { id: "p", type: "image", of: "Bicycle pump", width: 200, strokes, credit: "Jane Doe · CC0", at: { ref: "a", side: "right", gap: 30 } },
      ],
      commands: [{ draw: ["a", "p"] }],
    });
    const ds = flattenDrawables(r.drawables);
    const img = ds.find((d) => d.id === "p__img") as { kind: string; w: number; h: number; reveal?: string };
    expect(img).toMatchObject({ kind: "image", w: 200, h: 100, reveal: "fade" });
    const cap = ds.find((d) => d.id === "p__name") as { kind: string; text: string; fontSize: number };
    expect(cap).toMatchObject({ kind: "text", text: "Jane Doe · CC0", fontSize: 14 });
    expect(elementBBoxes(r).get("p")!.x).toBeCloseTo(300 + 100 + 30, 0);
  });
  test("unresolved image draws nothing and warns", () => {
    const r = layoutSpec({ elements: [{ id: "p", type: "image", of: "Nothing", x: 100, y: 100 }], commands: [{ draw: ["p"] }] });
    expect(flattenDrawables(r.drawables).filter((d) => d.id.startsWith("p"))).toEqual([]);
    expect(r.warnings.join(" ")).toMatch(/no image found for "Nothing"/);
  });
});
