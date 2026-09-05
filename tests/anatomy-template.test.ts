import { beforeEach, describe, expect, test } from "vitest";
import anatomyYaml from "../src/scenes/packs/anatomy.yaml?raw";
import { registerPack, unregisterPack } from "../src/scenes/packs";
import { scenes } from "../src/scenes/registry";
import { ensureEngines } from "../src/scenes/engines";
import { flattenDrawables, leafDrawables } from "../src/layout/model";
import { layoutSpec } from "../src/layout/layout";

const lay = (params: Record<string, unknown>) => scenes.anatomy.layout!(params);
const idsOf = (params: Record<string, unknown>) => lay(params).order;

describe("anatomy template", () => {
  beforeEach(async () => {
    unregisterPack("anatomy");
    await ensureEngines(["anatomy"]);
    registerPack("anatomy", anatomyYaml);
  });

  test("registers as one ready template", () => {
    unregisterPack("anatomy");
    expect(registerPack("anatomy", anatomyYaml)).toMatchObject({ ok: true, templateIds: ["anatomy"] });
  });

  test("draws the outline and the organs by default, and no bones", () => {
    const ids = idsOf({});
    expect(ids).toContain("body_outline");
    expect(ids).toContain("heart");
    expect(ids).toContain("liver");
    expect(ids).toContain("kidney_left"); // detail 2 is the default
    expect(ids).not.toContain("gallbladder"); // detail 3
    expect(ids).not.toContain("femur_left");
    expect(ids).not.toContain("abdomen"); // grouping parts are never drawn
  });

  test("systems chooses what is drawn", () => {
    const bones = idsOf({ systems: ["skeleton"] });
    expect(bones).toContain("femur_left");
    expect(bones).toContain("knee_left");
    expect(bones).not.toContain("heart");
    const both = idsOf({ systems: ["skeleton", "viscera"], detail: 1 });
    expect(both).toContain("thigh_left");
    expect(both).toContain("heart");
  });

  test("detail draws the leaves at that level: the hand is a mitten at 1 and 2, bones at 3", () => {
    expect(idsOf({ systems: ["skeleton"], detail: 1 })).toContain("hand_left");
    expect(idsOf({ systems: ["skeleton"], detail: 1 })).not.toContain("femur_left"); // thigh_left instead
    expect(idsOf({ systems: ["skeleton"], detail: 1 })).toContain("thigh_left");
    expect(idsOf({ systems: ["skeleton"], detail: 2 })).toContain("hand_left");
    expect(idsOf({ systems: ["skeleton"], detail: 2 })).toContain("femur_left");
    expect(idsOf({ systems: ["skeleton"], detail: 2 })).not.toContain("thigh_left");
    const fine = idsOf({ systems: ["skeleton"], detail: 3 });
    expect(fine).toContain("carpals_left");
    expect(fine).not.toContain("hand_left");
  });

  test("every drawn part is ink plus wash on the same ring, so it has an outline AND a clickable shape", () => {
    const flat = flattenDrawables(lay({}).drawables);
    const heart = flat.find((d) => d.id === "heart");
    expect(heart?.kind).toBe("group");
    const leaves = leafDrawables([heart!]);
    const fill = leaves.find((d) => d.kind === "area");
    const ink = leaves.find((d) => d.kind === "stroke");
    expect(fill).toBeDefined();
    expect(ink).toBeDefined();
    expect((ink as { closed?: boolean }).closed).toBe(true);
    expect((ink as { pts: unknown }).pts).toEqual((fill as { pts: unknown }).pts);
  });

  test("a joint is drawn as a closed ring, not a filled shape", () => {
    const flat = flattenDrawables(lay({ systems: ["skeleton"] }).drawables);
    const knee = leafDrawables([flat.find((d) => d.id === "knee_left")!]);
    expect(knee.every((d) => d.kind === "stroke" && (d as { closed?: boolean }).closed)).toBe(true);
  });

  test("names chooses the label language and falls back to English", () => {
    const nb = lay({ labels: "all", detail: 1, names: "nb" }).labels.find((l) => l.id === "label_liver");
    expect((nb as { text: string }).text).toBe("Lever");
    const la = lay({ labels: "all", detail: 1, names: "la" }).labels.find((l) => l.id === "label_liver");
    expect((la as { text: string }).text).toBe("Hepar");
    const en = lay({ labels: "all", detail: 1 }).labels.find((l) => l.id === "label_liver");
    expect((en as { text: string }).text).toBe("Liver");
  });

  test("the whole figure fits the canvas at every level and with both systems", () => {
    for (const detail of [1, 2, 3]) {
      const res = layoutSpec({ template: "anatomy", params: { systems: ["skeleton", "viscera"], detail }, elements: [] } as never);
      expect(res.issues.filter((i) => i.severity === "error"), `detail ${detail}`).toEqual([]);
      expect(res.warnings, `detail ${detail}`).toEqual([]);
    }
  });
});
