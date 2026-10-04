// W25: a bar guess's value pill stays inside the plot — never over the y-axis.
import { describe, expect, test } from "vitest";
import { barPill } from "../src/ui/bar-pill";

const base = { axisX: 50, plotR: 400, plotTop: 20, pw: 60, ph: 24, lift: 34 };

describe("barPill", () => {
  test("above a low bar, centred on it", () => {
    expect(barPill({ ...base, barL: 150, barR: 190, barTop: 200 })).toEqual({ mode: "above", x: 170 });
  });
  test("above the first bar, a wide pill is pushed right of the y-axis", () => {
    const out = barPill({ ...base, barL: 60, barR: 90, barTop: 200 });
    expect(out.mode).toBe("above");
    expect(out.x - base.pw / 2).toBeGreaterThanOrEqual(base.axisX);
  });
  test("a tall bar: beside its top, right of it", () => {
    expect(barPill({ ...base, barL: 150, barR: 190, barTop: 40 })).toEqual({ mode: "beside", x: 194 });
  });
  test("the last bar: left of it, inside the plot", () => {
    expect(barPill({ ...base, barL: 340, barR: 380, barTop: 40 })).toEqual({ mode: "beside", x: 276 });
  });
  test("no room either side: clamped inside the plot, off the axis", () => {
    const out = barPill({ ...base, plotR: 160, barL: 70, barR: 120, barTop: 40 });
    expect(out.x).toBeGreaterThanOrEqual(base.axisX + 4);
    expect(out.x + base.pw).toBeLessThanOrEqual(160);
  });
});
