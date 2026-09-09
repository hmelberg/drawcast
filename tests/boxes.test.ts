import { describe, expect, test } from "vitest";
import { unionBBoxForId } from "../src/layout/boxes";
import { heuristicMeasure } from "../src/layout/measure";
import { defaultDrawOpts, defaultStyle, type Drawable } from "../src/layout/model";

const stroke = (id: string, pts: [number, number][]): Drawable => ({ id, kind: "stroke", pts, z: 1, style: defaultStyle(), drawOpts: defaultDrawOpts("sketch") });

describe("unionBBoxForId", () => {
  test("unions an element with its sub-drawables and ignores leaders", () => {
    const ds = [stroke("a", [[0, 0], [10, 10]]), stroke("a_wash", [[0, 0], [20, 5]]), stroke("a_leader", [[0, 0], [500, 500]])];
    expect(unionBBoxForId(ds, "a", heuristicMeasure)).toEqual({ x: 0, y: 0, w: 20, h: 10 });
  });
  test("null for an unknown id", () => {
    expect(unionBBoxForId([], "nope", heuristicMeasure)).toBeNull();
  });
});
