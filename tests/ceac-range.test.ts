// W25: ceac takes any WTP range and any currency; a threshold off the axis warns.
import { beforeAll, describe, expect, test } from "vitest";
import { ensureEnabledPacks } from "../src/scenes/packs";
import { scenes } from "../src/scenes/registry";
import { layoutSpec } from "../src/layout/layout";
import { flattenDrawables } from "../src/layout/model";
import type { Spec } from "../src/spec/types";

beforeAll(async () => {
  await ensureEnabledPacks(["hta"]);
});

const textOf = (out: { drawables: unknown[] }, id: string) => {
  const d = flattenDrawables(out.drawables as never).find((x) => x.id === id);
  return d && d.kind === "text" ? d.text : undefined;
};

describe("ceac", () => {
  test("a 500k threshold on a 0–600 axis is drawn, not dropped", () => {
    const out = scenes.ceac.layout!({ thresholds: [30, 500], x_max: 600 });
    expect(textOf(out, "threshold_1__t")).toBe("$500k");
    expect(out.warnings ?? []).toEqual([]);
  });
  test("a word currency goes after the number; whole units with thousands: false", () => {
    const out = scenes.ceac.layout!({ thresholds: [500000], x_max: 1000000, thousands: false, currency: "kr" });
    expect(textOf(out, "threshold_0__t")).toMatch(/^500[ ,. ]?000 kr$/);
    expect(textOf(out, "axes__x_label")).toBe("Willingness to pay per QALY (kr)");
  });
  test("£ before the number, in the axis caption too", () => {
    const out = scenes.ceac.layout!({ thresholds: [20, 30], currency: "£" });
    expect(textOf(out, "threshold_0__t")).toBe("£20k");
    expect(textOf(out, "axes__x_label")).toBe("Willingness to pay per QALY (£1000s)");
  });
  test("a threshold off the axis warns (the layout's warnings)", () => {
    const spec = { template: "ceac", params: { thresholds: [30, 250], x_max: 200 }, commands: [{ draw: ["axes"], speak: "x" }] } as unknown as Spec;
    const w = layoutSpec(spec).warnings.join("\n");
    expect(w).toMatch(/threshold 250 is off the axis/);
  });
});
