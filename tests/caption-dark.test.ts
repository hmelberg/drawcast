// Captions written on the drawing take the band over dark ground (render/caption-dark.ts).
import { expect, test } from "vitest";
import { darkUnderCaption } from "../src/render/caption-dark";
import { defaultStyle, defaultDrawOpts, type Drawable } from "../src/layout/model";

const area = (id: string, y0: number, fill: string): Drawable =>
  ({ id, kind: "area", pts: [[0, y0], [1000, y0], [1000, y0 + 100], [0, y0 + 100]], z: 1, style: defaultStyle({ fill, color: fill, opacity: 1 }), drawOpts: defaultDrawOpts("instant") }) as Drawable;

test("a dark fill or a picture reaching into the caption strip is dark ground; light fills and high ones are not", () => {
  const img = { id: "photo", kind: "image", href: "data:,", pos: [500, 120], w: 300, h: 200, z: 1, style: defaultStyle(), drawOpts: defaultDrawOpts("instant") } as unknown as Drawable;
  const ids = darkUnderCaption([area("night", 0, "#111111"), area("sand", 0, "#f2c14e"), area("high", 400, "#111111"), img]);
  expect([...ids].sort()).toEqual(["night", "photo"]);
});
