import { beforeAll, describe, expect, test } from "vitest";
import { ensureEngines, getLoadedEngines } from "../src/scenes/engines";
import { registerPack, unregisterPack } from "../src/scenes/packs";
import { scenes } from "../src/scenes/registry";
import anatomyYaml from "../src/scenes/packs/anatomy.yaml?raw";
import type { AnatomyEngine, AtlasPart } from "../src/scenes/anatomy/types";
import { anatomyInputFrom, packUrl, partName, PEEL_EDGE, peelOpacity, peelRanks, toCustomShape, visibleParts, type PackMesh } from "../src/ui/anatomy3d";

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

describe("peelRanks: the front-most part first", () => {
  test("ranks run from 0 at the largest front Z to 1 at the smallest", () => {
    expect(peelRanks([14.3, 10, 7.8, 2])).toEqual([0, (14.3 - 10) / 12.3, (14.3 - 7.8) / 12.3, 1]);
  });
  test("one part, or all at one depth: every rank 0", () => {
    expect(peelRanks([5])).toEqual([0]);
    expect(peelRanks([5, 5, 5])).toEqual([0, 0, 0]);
  });
});

describe("peelOpacity", () => {
  test("nothing is peeled at 0; the skin is a faint shell even then", () => {
    expect(peelOpacity(all.heart, 0.5, 0)).toBe(1);
    expect(peelOpacity(all.heart, 0, 0)).toBe(1);
    expect(peelOpacity(all.body_outline, 0, 0)).toBeCloseTo(0.3);
  });
  test("a part in front of the peel fades over the soft edge; one behind it stays", () => {
    expect(peelOpacity(all.lung_left, 0.2, 0.5)).toBe(0); // well in front of the peel
    expect(peelOpacity(all.lung_left, 0.45, 0.5)).toBeCloseTo(0.5); // half-way through the edge
    expect(peelOpacity(all.lung_left, 0.5, 0.5)).toBe(1); // at the peel: still whole
    expect(peelOpacity(all.heart, 0.8, 0.5)).toBe(1);
    expect(PEEL_EDGE).toBe(0.1);
  });
  test("at peel 1 only the furthest-back part remains; the skin is gone", () => {
    expect(peelOpacity(all.body_outline, 0, 1)).toBe(0);
    expect(peelOpacity(all.lung_left, 0.5, 1)).toBe(0);
    expect(peelOpacity(all.thoracic_vertebrae, 1, 1)).toBe(1);
  });
  test("peel is clamped", () => {
    expect(peelOpacity(all.liver, 0.5, -1)).toBe(1);
    expect(peelOpacity(all.liver, 0.5, 2)).toBe(0);
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
