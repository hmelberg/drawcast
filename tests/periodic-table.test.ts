// The periodic table: the generated data, the engine's lookups, and the
// template's three forms. The rule under test that matters most is the one in
// §2 of the design — an UNMEASURED property must leave its cell blank, never
// paint it at the cold end of a scale.

import { beforeEach, describe, expect, test } from "vitest";
import chemistryYaml from "../src/scenes/packs/chemistry.yaml?raw";
import { registerPack, unregisterPack } from "../src/scenes/packs";
import { scenes } from "../src/scenes/registry";
import { ensureEngines, getLoadedEngines } from "../src/scenes/engines";
import type { ElementsEngine } from "../src/scenes/elements/types";
import { flattenDrawables } from "../src/layout/model";
import { elementBBoxes, layoutSpec } from "../src/layout/layout";

const lay = (params: Record<string, unknown>) => scenes.periodic_table.layout!(params);
const idsOf = (params: Record<string, unknown>) => lay(params).order;
const cellsOf = (params: Record<string, unknown>) => idsOf(params).filter((id) => id.startsWith("cell_"));
const textIn = (r: ReturnType<typeof lay>, id: string): string[] =>
  flattenDrawables(r.drawables)
    .filter((d) => d.kind === "text" && d.id.startsWith(id))
    .map((d) => (d as { text: string }).text);

/** Boxes through the real path: layoutSpec, the way the player builds them. */
const boxesOf = (params: Record<string, unknown>) =>
  elementBBoxes(layoutSpec({ template: "periodic_table", params, elements: [] } as never));

const engine = (): ElementsEngine => getLoadedEngines(["elements"]).elements as ElementsEngine;

beforeEach(async () => {
  unregisterPack("chemistry");
  await ensureEngines(["elements"]);
  registerPack("chemistry", chemistryYaml);
});

describe("the generated element data", () => {
  test("is all 118, once each, in atomic-number order", () => {
    const all = engine().all();
    expect(all).toHaveLength(118);
    expect(all.map((e) => e.z)).toEqual(Array.from({ length: 118 }, (_, i) => i + 1));
  });

  test("spot checks survive the build's normalisations", () => {
    const fe = engine().bySymbol("Fe")!;
    expect(fe).toMatchObject({ z: 26, group: 8, period: 4, block: "d", category: "transition-metal", state20: "solid" });
    expect(fe.name).toEqual({ en: "Iron", nb: "Jern", la: "Ferrum" });
    // Shell order, not the source's filling order.
    expect(fe.config).toBe("[Ar]3d⁶4s²");
    expect(engine().bySymbol("Au")!.config).toBe("[Xe]4f¹⁴5d¹⁰6s¹");
    // Real exceptions survive re-ordering — occupancies are never recomputed.
    expect(engine().bySymbol("Cu")!.config).toBe("[Ar]3d¹⁰4s¹");
    expect(engine().bySymbol("La")!.config).toBe("[Xe]5d¹6s²");
    // Bromine is one of the two liquids.
    expect(engine().bySymbol("Br")!.state20).toBe("liquid");
  });

  test("the f-block sits outside the eighteen columns, in its own two lanes", () => {
    const f = engine().all().filter((e) => e.block === "f");
    expect(f).toHaveLength(30);
    for (const e of f) {
      expect(e.group).toBeNull();
      expect(e.f_index).toBeGreaterThanOrEqual(1);
      expect(e.f_index).toBeLessThanOrEqual(15);
    }
    // Every other element has a real column.
    for (const e of engine().all().filter((x) => x.block !== "f")) {
      expect(e.group).toBeGreaterThanOrEqual(1);
      expect(e.group).toBeLessThanOrEqual(18);
    }
  });

  test("the four corners of the table are where they belong", () => {
    expect(engine().bySymbol("H")).toMatchObject({ group: 1, period: 1 });
    expect(engine().bySymbol("He")).toMatchObject({ group: 18, period: 1 });
    expect(engine().bySymbol("Fr")).toMatchObject({ group: 1, period: 7 });
    expect(engine().bySymbol("Og")).toMatchObject({ group: 18, period: 7 });
  });

  test("an unmeasured property is null, never zero", () => {
    // The noble gases have no Pauling electronegativity, and neither do the
    // superheavies. Zero would be a measurement; null is the truth.
    for (const s of ["He", "Ne", "Ar", "Og", "Ts"]) {
      expect(engine().bySymbol(s)!.electronegativity).toBeNull();
    }
    expect(engine().bySymbol("F")!.electronegativity).toBe(3.98);
  });

  test("the seven ancient metals carry \"ancient\", not a made-up year", () => {
    for (const s of ["Cu", "Ag", "Au", "Fe", "Pb", "Sn", "Hg"]) {
      expect(engine().bySymbol(s)!.discovered).toBe("ancient");
    }
    expect(engine().bySymbol("H")!.discovered).toBe(1766);
  });
});

describe("the engine's lookups", () => {
  test("find resolves a symbol, an atomic number and a name in any language", () => {
    const fe = engine().bySymbol("Fe")!;
    for (const q of ["Fe", "fe", " FE ", 26, "26", "Iron", "iron", "Jern", "jern", "Ferrum"]) {
      expect(engine().find(q)?.z).toBe(fe.z);
    }
    expect(engine().find("unobtainium")).toBeNull();
  });

  test("a symbol wins over a name that collides with it", () => {
    // "N" is nitrogen's symbol; nothing may shadow it.
    expect(engine().find("N")?.symbol).toBe("N");
  });

  test("nameIn falls back to English wherever no Latin name explains the symbol", () => {
    const eng = engine();
    expect(eng.nameIn(eng.bySymbol("Fe")!, "la")).toBe("Ferrum");
    expect(eng.nameIn(eng.bySymbol("Fe")!, "nb")).toBe("Jern");
    expect(eng.nameIn(eng.bySymbol("O")!, "la")).toBe("Oxygen");
    expect(eng.nameIn(eng.bySymbol("O")!, "nb")).toBe("Oksygen");
  });
});

describe("the template", () => {
  test("registers as a ready template with the elements engine", () => {
    expect(scenes.periodic_table.manifest.status).toBe("ready");
    expect(scenes.periodic_table.manifest.engines).toContain("elements");
    expect(scenes.periodic_table.manifest.interactions).toContain("periodic");
  });

  test("the whole table draws one addressable cell per element", () => {
    const cells = cellsOf({});
    expect(cells).toHaveLength(118);
    expect(cells).toContain("cell_H");
    expect(cells).toContain("cell_Fe");
    expect(cells).toContain("cell_Og");
    expect(idsOf({})).toContain("grid");
  });

  test("the whole table puts hydrogen top-left, helium top-right, oganesson bottom-right", () => {
    const boxes = boxesOf({});
    const h = boxes.get("cell_H")!, he = boxes.get("cell_He")!, og = boxes.get("cell_Og")!;
    expect(h.x).toBeLessThan(he.x); // group 1 left of group 18
    expect(Math.round(h.y)).toBe(Math.round(he.y)); // same period, same row
    expect(og.y).toBeLessThan(h.y); // y is up: period 7 sits below period 1
    expect(Math.round(og.x)).toBe(Math.round(he.x)); // both in group 18
  });

  test("the whole table keeps its holes — the gap between group 2 and 13 is the shape", () => {
    const boxes = boxesOf({});
    const be = boxes.get("cell_Be")!, b = boxes.get("cell_B")!;
    // Beryllium (group 2) and boron (group 13) are neighbours in period 2 but
    // ten columns apart on the page. A compacted row would make them adjacent.
    expect(b.x - be.x).toBeGreaterThan(be.w * 8);
  });

  test("a subset compacts to its own columns and grows the cells", () => {
    const halogens = cellsOf({ group: 17 });
    expect(halogens.sort()).toEqual(["cell_At", "cell_Br", "cell_Cl", "cell_F", "cell_I", "cell_Ts"].sort());
    const wide = boxesOf({ group: 17 }).get("cell_F")!;
    const small = boxesOf({}).get("cell_F")!;
    expect(wide.w).toBeGreaterThan(small.w * 1.4);
  });

  test("cells drawn large carry the element's name; small ones do not", () => {
    expect(textIn(lay({ group: 17 }), "cell_F")).toContain("Fluorine");
    expect(textIn(lay({}), "cell_F")).not.toContain("Fluorine");
    // The symbol and the atomic number are always there.
    expect(textIn(lay({}), "cell_F")).toEqual(expect.arrayContaining(["F", "9"]));
  });

  test("names: nb and names: la change what the cells say", () => {
    expect(textIn(lay({ group: 17, names: "nb" }), "cell_F")).toContain("Fluor");
    expect(textIn(lay({ element: "Fe", names: "la" }), "cell_Fe")).toContain("Ferrum");
    expect(textIn(lay({ element: "Fe", names: "nb" }), "cell_Fe")).toContain("Jern");
  });

  test("the detail form is one big cell carrying the configuration", () => {
    const r = lay({ element: "Fe" });
    expect(r.order.filter((id) => id.startsWith("cell_"))).toEqual(["cell_Fe"]);
    expect(textIn(r, "cell_Fe")).toEqual(expect.arrayContaining(["Fe", "26", "Iron", "[Ar]3d⁶4s²"]));
    const box = boxesOf({ element: "Fe" }).get("cell_Fe")!;
    expect(box.w).toBeGreaterThan(300);
  });

  test("the detail form accepts a symbol, a number or a name in any language", () => {
    for (const q of ["Fe", "26", "iron", "jern", "ferrum"]) {
      expect(cellsOf({ element: q })).toEqual(["cell_Fe"]);
    }
  });

  test("first, period, category and a named list each pick their own cells", () => {
    expect(cellsOf({ first: 20 })).toHaveLength(20);
    expect(cellsOf({ period: 2 })).toHaveLength(8);
    expect(cellsOf({ category: "noble-gas" })).toHaveLength(7);
    expect(cellsOf({ elements: ["Na", "Cl"] }).sort()).toEqual(["cell_Cl", "cell_Na"]);
  });

  test("a filter that matches nothing draws the table rather than an empty frame", () => {
    expect(cellsOf({ category: "unobtainium" })).toHaveLength(118);
    expect(cellsOf({ elements: ["Xx", "Yy"] })).toHaveLength(118);
  });

  describe("colouring", () => {
    test("no colour_by means no washes at all", () => {
      expect(idsOf({}).filter((id) => id.startsWith("fill_"))).toEqual([]);
    });

    test("by category, every cell is washed and the key names the categories", () => {
      const ids = idsOf({ colour_by: "category" });
      expect(ids.filter((id) => id.startsWith("fill_"))).toHaveLength(118);
      expect(ids).toContain("legend");
    });

    test("AN UNMEASURED VALUE LEAVES THE CELL BLANK — never the cold end of the ramp", () => {
      const ids = idsOf({ colour_by: "electronegativity" });
      // The noble gases and the superheavies have no Pauling value at all.
      for (const s of ["He", "Ne", "Ar", "Og", "Ts", "Rf"]) {
        expect(ids).not.toContain("fill_" + s);
      }
      // Everything that HAS a value is washed.
      expect(ids).toContain("fill_F");
      expect(ids).toContain("fill_Cs");
      const measured = engine().all().filter((e) => e.electronegativity !== null).length;
      expect(ids.filter((id) => id.startsWith("fill_"))).toHaveLength(measured);
    });

    test("the same rule holds for every continuous property", () => {
      for (const prop of ["radius", "discovered"] as const) {
        const ids = idsOf({ colour_by: prop });
        const measured = engine().all().filter((e) => (prop === "radius" ? e.radius !== null : e.discovered !== null)).length;
        expect(ids.filter((id) => id.startsWith("fill_"))).toHaveLength(measured);
      }
    });

    test("\"ancient\" is its own bucket in the discovery colouring, not year zero", () => {
      const r = lay({ colour_by: "discovered" });
      const fills = flattenDrawables(r.drawables).filter((d) => d.kind === "area" && d.id.startsWith("fill_"));
      const colourOf = (sym: string) =>
        (fills.find((d) => d.id === "fill_" + sym) as { style?: { fill?: string } } | undefined)?.style?.fill;
      // Copper (ancient) takes the oldest end; a 20th-century element does not.
      expect(colourOf("Cu")).toBeTruthy();
      expect(colourOf("Cu")).not.toBe(colourOf("Fl"));
      expect(r.order).toContain("legend");
    });

    test("the legend appears only when there is a colouring to explain", () => {
      expect(idsOf({})).not.toContain("legend");
      expect(idsOf({ colour_by: "block" })).toContain("legend");
      expect(idsOf({ colour_by: "block", legend: false })).not.toContain("legend");
    });
  });

  test("highlights are their own ids, in the order given, and ignore undrawn elements", () => {
    const ids = idsOf({ group: 17, highlight: ["F", "Cl", "Na"] });
    // Sodium is not in group 17, so it gets no mark — and the two that are
    // drawn keep the indices of their own places in the list.
    expect(ids).toContain("highlight_0");
    expect(ids).toContain("highlight_1");
    expect(ids).not.toContain("highlight_2");
  });

  test("every drawn cell has a hit box and an anchor — the whole interaction surface", () => {
    const r = lay({});
    const boxes = boxesOf({});
    for (const e of engine().all()) {
      expect(boxes.has("cell_" + e.symbol)).toBe(true);
      expect(r.anchors["cell_" + e.symbol]).toBeDefined();
    }
  });

  test("the full table lays out well under a frame budget", () => {
    const t0 = performance.now();
    for (let i = 0; i < 5; i++) lay({ colour_by: "category" });
    const per = (performance.now() - t0) / 5;
    // 118 cells is the heaviest figure in the library; measured, not assumed.
    expect(per).toBeLessThan(120);
  });
});
