import { describe, expect, test } from "vitest";
import { elementBBoxes, layoutSpec } from "../src/layout/layout";
import { drawablesForId, leafDrawables } from "../src/layout/model";

describe("tier-2 elements can reference template-scene curves", () => {
  test("a region shades between the scene's demand and supply curves", () => {
    const layout = layoutSpec({
      template: "supply_demand",
      params: { equilibrium: { show: true } },
      elements: [{ id: "gap", type: "region", between: ["supply_curve", "demand_curve"], x_from: 20, x_to: 45 }],
      commands: [],
    });
    expect(layout.warnings.join(" ")).not.toContain("unknown curves");
    const leaves = leafDrawables(drawablesForId(layout.drawables, "gap"));
    expect(leaves).toHaveLength(1);
    expect(leaves[0].kind).toBe("area");
    expect(leaves[0].kind === "area" && leaves[0].pts.length).toBeGreaterThan(10);
  });

  test("a point can sit on the intersection of two scene curves (the equilibrium)", () => {
    const layout = layoutSpec({
      template: "supply_demand",
      params: { equilibrium: { show: true } },
      elements: [{ id: "meet", type: "point", at: { intersection_of: ["demand_curve", "supply_curve"] } }],
      commands: [],
    });
    const boxes = elementBBoxes(layout);
    const meet = boxes.get("meet")!;
    const eq = boxes.get("equilibrium_point")!;
    expect(meet).toBeDefined();
    expect(eq).toBeDefined();
    expect(Math.abs(meet.x + meet.w / 2 - (eq.x + eq.w / 2))).toBeLessThan(3);
    expect(Math.abs(meet.y + meet.h / 2 - (eq.y + eq.h / 2))).toBeLessThan(3);
  });

  test("a region can use a price line as one of its bounds", () => {
    const layout = layoutSpec({
      template: "supply_demand",
      params: { equilibrium: { show: true }, price_ceiling: { label: "Cap", show_shortage: true } },
      elements: [{ id: "wedge", type: "region", between: ["ceiling_line", "demand_curve"], x_from: 40, x_to: 80 }],
      commands: [],
    });
    expect(layout.warnings.join(" ")).not.toContain("unknown curves");
    expect(leafDrawables(drawablesForId(layout.drawables, "wedge"))).toHaveLength(1);
  });
});
