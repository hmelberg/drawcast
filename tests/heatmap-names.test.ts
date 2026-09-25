// heatmap sizes its row-name lane to the widest name exactly; floating-point
// arithmetic on the lane's edges once left it a hair short, so the widest name
// was cut ("Income" → "Inco…") in a lane made for it (2026-09-25).
import { beforeAll, expect, test } from "vitest";
import { layoutSpec } from "../src/layout/layout";
import { flattenDrawables } from "../src/layout/model";
import { heuristicMeasure } from "../src/layout/measure";
import { ensureEnabledPacks } from "../src/scenes/packs";

beforeAll(async () => {
  await ensureEnabledPacks(["data"] as never);
});

test("the widest row name is drawn whole in a boxed heatmap", () => {
  const spec = {
    template: "heatmap",
    params: { rows: ["Age", "Income", "BMI", "BP"], cols: ["Age", "Income", "BMI", "BP"], values: [[1, -0.12, 0.34, 0.51], [-0.12, 1, 0.08, -0.21], [0.34, 0.08, 1, 0.46], [0.51, -0.21, 0.46, 1]], box: { x: 150, y: 160, w: 700, h: 500 } },
    commands: [],
  };
  const names = (flattenDrawables(layoutSpec(spec as never, heuristicMeasure).drawables) as { id: string; text?: string }[])
    .filter((d) => /__name$/.test(d.id)).map((d) => d.text);
  expect(names).toEqual(["Age", "Income", "BMI", "BP"]);
});
