// Numbers a template writes follow the cast's language (kit v11, 2026-09-25):
// a decimal comma in a Norwegian cast — and, where two decimals sit side by
// side, a semicolon between them, as Norwegian writes a coordinate pair.
import { beforeAll, expect, test } from "vitest";
import { layoutSpec } from "../src/layout/layout";
import { flattenDrawables } from "../src/layout/model";
import { heuristicMeasure } from "../src/layout/measure";
import { ensureEnabledPacks } from "../src/scenes/packs";

beforeAll(async () => {
  await ensureEnabledPacks(["mathlogic"] as never);
});

const coords = (lang?: string, speak = "Here is the point.") => {
  const l = layoutSpec({ template: "unit_circle", params: { angle_deg: 30 }, ...(lang ? { lang } : {}), commands: [{ speak }] } as never, heuristicMeasure);
  const t = flattenDrawables(l.drawables).find((d) => d.id === "coords_label") as { text: string } | undefined;
  return t?.text ?? "";
};

test("an English cast: (0.87, 0.50)", () => {
  expect(coords()).toBe("(0.87, 0.50)");
});

test("a Norwegian cast — by spec.lang or by its narration: (0,87; 0,50)", () => {
  expect(coords("nb")).toBe("(0,87; 0,50)");
  expect(coords(undefined, "Her er punktet på sirkelen, og det er fint.")).toBe("(0,87; 0,50)");
});
