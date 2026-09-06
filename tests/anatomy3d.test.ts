import { beforeAll, describe, expect, test } from "vitest";
import { ensureEngines, getLoadedEngines } from "../src/scenes/engines";
import { registerPack, unregisterPack } from "../src/scenes/packs";
import { scenes } from "../src/scenes/registry";
import anatomyYaml from "../src/scenes/packs/anatomy.yaml?raw";
import type { AnatomyEngine, AtlasPart } from "../src/scenes/anatomy/types";
import { anatomyInputFrom, packUrl, partName, peelOpacity, toCustomShape, visibleParts, type PackMesh } from "../src/ui/anatomy3d";

// The 3D panel shows what the figure shows. These tests hold the panel's own
// copy of the rules against the template's real layout.

let all: Record<string, AtlasPart>;
beforeAll(async () => {
  await ensureEngines(["anatomy"]);
  all = (getLoadedEngines(["anatomy"]).anatomy as AnatomyEngine).parts({ systems: ["skeleton", "viscera"], sex: "neutral" });
  unregisterPack("anatomy");
  registerPack("anatomy", anatomyYaml);
});

/** The part ids the real template draws for these params (its own leaf rule, its own order). */
function drawnByTemplate(params: Record<string, unknown>): string[] {
  const layout = scenes.anatomy.layout!(params);
  return layout.drawables.filter((d) => d.kind === "group" && all[d.id] !== undefined && all[d.id].kind !== "outline").map((d) => d.id);
}

describe("anatomyInputFrom: the template's defaults", () => {
  test("empty params", () => {
    expect(anatomyInputFrom({})).toEqual({ systems: ["viscera"], detail: 2, layer: "superficial", focus: [], outline: "skin", sex: "neutral", names: "en" });
  });
  test("reads what is there and ignores junk", () => {
    const q = anatomyInputFrom({ systems: ["skeleton"], detail: 3, layer: "deep", focus: ["hand_left", 7], outline: "none", names: "nb", sex: "male" });
    expect(q).toEqual({ systems: ["skeleton"], detail: 3, layer: "deep", focus: ["hand_left"], outline: "none", sex: "male", names: "nb" });
    expect(anatomyInputFrom({ detail: 2.5 }).detail).toBe(2);
    expect(anatomyInputFrom({ detail: 9 }).detail).toBe(2);
    expect(anatomyInputFrom({ systems: ["nerves"] }).systems).toEqual(["viscera"]);
  });
});

describe("visibleParts agrees with the template's own leaf rule", () => {
  const cases: Record<string, unknown>[] = [
    { systems: ["viscera"], detail: 2 },
    { systems: ["skeleton"], detail: 1 },
    { systems: ["skeleton"], detail: 3 },
    { systems: ["skeleton", "viscera"], detail: 2, layer: "deep" },
    { systems: ["skeleton"], detail: 2, focus: ["hand_left"] },
    { systems: ["viscera"], detail: 2, focus: ["abdomen"] },
  ];
  for (const params of cases) {
    test(JSON.stringify(params), () => {
      const q = anatomyInputFrom(params);
      const mine = visibleParts(all, q).filter((id) => id !== "body_outline");
      expect(mine).toEqual(drawnByTemplate(params).filter((id) => all[id].kind !== "joint"));
    });
  }
  test("the skin comes last, and only without focus and with an outline", () => {
    expect(visibleParts(all, anatomyInputFrom({})).at(-1)).toBe("body_outline");
    expect(visibleParts(all, anatomyInputFrom({ outline: "none" }))).not.toContain("body_outline");
    expect(visibleParts(all, anatomyInputFrom({ focus: ["abdomen"] }))).not.toContain("body_outline");
  });
  test("a focus name resolves like the template: Norwegian and Latin names work", () => {
    const byId = visibleParts(all, anatomyInputFrom({ systems: ["skeleton"], focus: ["hand_left"] }));
    expect(byId.length).toBeGreaterThan(0);
    expect(visibleParts(all, anatomyInputFrom({ systems: ["skeleton"], focus: ["Venstre hånd"] }))).toEqual(byId);
    expect(visibleParts(all, anatomyInputFrom({ systems: ["skeleton"], focus: ["Manus sinistra"] }))).toEqual(byId);
  });
  test("a part list never includes joints or groups, and no id twice", () => {
    for (const detail of [1, 2, 3]) {
      const ids = visibleParts(all, anatomyInputFrom({ systems: ["skeleton", "viscera"], detail }));
      expect(new Set(ids).size).toBe(ids.length);
      for (const id of ids) expect(["bone", "organ", "region", "outline"], `${id} at detail ${detail}`).toContain(all[id].kind);
    }
  });
});

describe("peelOpacity", () => {
  test("skin is a faint shell that peels away first", () => {
    expect(peelOpacity(all.body_outline, 0)).toBeCloseTo(0.3);
    expect(peelOpacity(all.body_outline, 1)).toBe(0);
  });
  test("superficial organs and the skeleton fade with the peel; deep organs never do", () => {
    expect(peelOpacity(all.liver, 0.25)).toBeCloseTo(0.75);
    expect(peelOpacity(all.femur_left, 0.5)).toBeCloseTo(0.5);
    expect(peelOpacity(all.kidney_left, 0.9)).toBe(1);
    expect(peelOpacity(all.pancreas, 1)).toBe(1);
    expect(peelOpacity(all.heart, 1)).toBe(1);
  });
  test("peel is clamped", () => {
    expect(peelOpacity(all.liver, -1)).toBe(1);
    expect(peelOpacity(all.liver, 2)).toBe(0);
  });
});

describe("toCustomShape", () => {
  const mesh: PackMesh = { positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), indices: new Uint16Array([0, 1, 2]), triangles: 1 };
  test("vertices as {x,y,z}, faces as a plain array, an EMPTY normalArr, clickable", () => {
    const s = toCustomShape(mesh, "#abcdef", 0.5);
    expect(s.vertexArr).toEqual([{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }]);
    expect(s.faceArr).toEqual([0, 1, 2]);
    expect(Array.isArray(s.faceArr)).toBe(true);
    expect(s.normalArr).toEqual([]);
    expect(s).toMatchObject({ color: "#abcdef", opacity: 0.5, clickable: true });
  });
});

describe("names and urls", () => {
  test("partName falls back to English", () => {
    expect(partName(all.liver, "en")).toBe("Liver");
    expect(partName(all.liver, "nb")).toBe("Lever");
    expect(partName(all.liver, "la")).toBe("Hepar");
    expect(partName({ ...all.liver, name: { en: "Liver" } }, "nb")).toBe("Liver");
  });
  test("packUrl resolves against the document base", () => {
    expect(packUrl("liver.bin", "https://drawcast.app/")).toBe("https://drawcast.app/anatomy3d/liver.bin");
    expect(packUrl("index.json", "http://localhost:5173/some/page")).toBe("http://localhost:5173/some/anatomy3d/index.json");
  });
});
