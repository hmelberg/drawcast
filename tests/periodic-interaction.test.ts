// The third intrinsic interaction (interactivity spec §6). What is under test
// is mostly that the periodic table needs LESS machinery than the piano and the
// chessboard, not more: its geometry is the layout's own cell ids, so there is
// no second copy of the grid arithmetic to keep in sync, and a click on a cell
// is already an info card rather than something the card must stand aside for.

import { beforeEach, describe, expect, test } from "vitest";
import chemistryYaml from "../src/scenes/packs/chemistry.yaml?raw";
import musicYaml from "../src/scenes/packs/music.yaml?raw";
import { registerPack, unregisterPack } from "../src/scenes/packs";
import { ensureEngines } from "../src/scenes/engines";
import { scenes } from "../src/scenes/registry";
import { KNOWN_INTERACTIONS } from "../src/scenes/types";
import { elementBBoxes, layoutSpec } from "../src/layout/layout";
import { periodicCellAt, periodicCellBox, periodicSymbols } from "../src/render/widgets";
import { activitiesFor, periodicQuizTargets, periodicElementTargets, periodicGroupTargets } from "../src/ui/quiz-model";
import { resolveDragTargets, normalizeItems } from "../src/ui/drag-model";
import { cardTargets } from "../src/ui/card-model";
import type { ChemElement } from "../src/scenes/elements/types";

const boxesOf = (params: Record<string, unknown>) =>
  elementBBoxes(layoutSpec({ template: "periodic_table", params, elements: [] } as never));

/** A deterministic rng, so a drill's sampling is testable rather than flaky. */
const seeded = (seed: number) => () => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
};

let table: ChemElement[];

beforeEach(async () => {
  unregisterPack("chemistry");
  await ensureEngines(["elements"]);
  registerPack("chemistry", chemistryYaml);
  const { getLoadedEngines } = await import("../src/scenes/engines");
  table = (getLoadedEngines(["elements"]).elements as { all(): ChemElement[] }).all();
});

describe("the interaction is declared, not sniffed", () => {
  test("periodic joins the known interactions and the template declares it", () => {
    expect(KNOWN_INTERACTIONS).toContain("periodic");
    expect(scenes.periodic_table.manifest.interactions).toEqual(["periodic"]);
  });

  test("it brings two drills, and leaves the other instruments' pills alone", () => {
    expect(activitiesFor(["periodic"]).map((a) => a.id)).toEqual(["element_quiz", "group_quiz"]);
    expect(activitiesFor(["periodic"]).every((a) => a.kind === "periodic")).toBe(true);
    expect(activitiesFor(["piano"]).map((a) => a.id)).toEqual(["note_quiz"]);
    expect(activitiesFor([]).length).toBe(0);
  });
});

describe("cell geometry comes from the layout, not a second copy of the grid", () => {
  test("every drawn cell is found, and nothing else is", () => {
    const boxes = boxesOf({});
    const syms = periodicSymbols(boxes.keys());
    expect(syms).toHaveLength(118);
    expect(syms).toContain("Fe");
    // `grid`, `title` and the sub-drawables are not cells.
    expect(syms).not.toContain("grid");
    expect(periodicSymbols(["grid", "legend", "cell_Fe", "cell_Fe__box", "title"])).toEqual(["Fe"]);
  });

  test("a point inside a cell resolves to that element, and the gaps resolve to nothing", () => {
    const boxes = boxesOf({});
    const fe = boxes.get("cell_Fe")!;
    expect(periodicCellAt(boxes, [fe.x + fe.w / 2, fe.y + fe.h / 2])).toBe("Fe");
    // The hole in period 2, between group 2 and group 13, is empty paper.
    const be = boxes.get("cell_Be")!, b = boxes.get("cell_B")!;
    const between: [number, number] = [(be.x + be.w + b.x) / 2, be.y + be.h / 2];
    expect(periodicCellAt(boxes, between)).toBeNull();
    // Well off the table.
    expect(periodicCellAt(boxes, [5, 5])).toBeNull();
  });

  test("neighbouring cells never claim each other's centres", () => {
    const boxes = boxesOf({});
    for (const sym of ["H", "He", "Fe", "Og", "U", "La"]) {
      const b = boxes.get("cell_" + sym)!;
      expect(periodicCellAt(boxes, [b.x + b.w / 2, b.y + b.h / 2])).toBe(sym);
    }
  });

  test("a box can be looked up by symbol, case-insensitively", () => {
    const boxes = boxesOf({});
    expect(periodicCellBox(boxes, "Fe")).toEqual(boxes.get("cell_Fe"));
    expect(periodicCellBox(boxes, "fe")).toEqual(boxes.get("cell_Fe"));
    expect(periodicCellBox(boxes, " FE ")).toEqual(boxes.get("cell_Fe"));
    expect(periodicCellBox(boxes, "Xx")).toBeNull();
    expect(periodicCellBox(boxes, "")).toBeNull();
  });
});

describe("the drills sample only what the figure drew", () => {
  test("the element drill asks by name, by atomic number and by symbol in turn", () => {
    const qs = periodicElementTargets(5, table, seeded(7));
    expect(qs).toHaveLength(5);
    expect(qs[0].prompt).not.toMatch(/^Click Z = /);
    expect(qs[1].prompt).toMatch(/^Click Z = \d+$/);
    for (const q of qs) {
      expect(q.accepts).toHaveLength(1);
      expect(q.reveal).toEqual(q.accepts);
      expect(table.some((e) => e.symbol === q.accepts[0])).toBe(true);
    }
  });

  test("a subset's drill can only ask about the subset", () => {
    const halogens = table.filter((e) => e.category === "halogen");
    const qs = periodicElementTargets(5, halogens, seeded(3));
    for (const q of qs) expect(halogens.map((e) => e.symbol)).toContain(q.accepts[0]);
  });

  test("the family drill accepts every member of the family it asked for", () => {
    const qs = periodicGroupTargets(3, table, seeded(11));
    expect(qs.length).toBeGreaterThan(0);
    for (const q of qs) {
      expect(q.accepts.length).toBeGreaterThanOrEqual(2);
      expect(q.reveal).toEqual(q.accepts);
      // Every accepted symbol really is in one and the same category.
      const cats = new Set(q.accepts.map((s) => table.find((e) => e.symbol === s)!.category));
      expect(cats.size).toBe(1);
    }
  });

  test("a family with only one drawn member is never asked — it would be one element by another name", () => {
    // A figure showing all the halogens but a single noble gas.
    const drawn = [...table.filter((e) => e.category === "halogen"), table.find((e) => e.symbol === "He")!];
    const qs = periodicGroupTargets(9, drawn, seeded(5));
    expect(qs.map((q) => q.prompt)).not.toContain("Click a noble gas");
    expect(qs.map((q) => q.prompt)).toContain("Click a halogen");
  });

  test("a figure too thin to quiz yields no questions rather than a broken drill", () => {
    expect(periodicGroupTargets(5, [table[0]], seeded(1))).toEqual([]);
    expect(periodicQuizTargets("group_quiz", 5, [], seeded(1))).toEqual([]);
    expect(periodicQuizTargets("element_quiz", 5, [], seeded(1))).toEqual([]);
  });

  test("the activity id picks the drill", () => {
    expect(periodicQuizTargets("group_quiz", 2, table, seeded(2))[0].prompt).toMatch(/^Click an? /);
    expect(periodicQuizTargets("element_quiz", 2, table, seeded(2))[0].accepts).toHaveLength(1);
  });
});

describe("drag items may be written as bare symbols", () => {
  test("cellBox resolves \"Fe\" the way noteBox resolves \"C4\"", () => {
    const boxes = boxesOf({ group: 17 });
    const { targets, missing } = resolveDragTargets(normalizeItems(["F", "Cl", "Br"]), {
      boxes: new Map(),
      rings: new Map(),
      cellBox: (s) => periodicCellBox(boxes, s),
    });
    expect(missing).toEqual([]);
    expect(targets.map((t) => t.id)).toEqual(["F", "Cl", "Br"]);
    expect(targets.every((t) => t.element === false)).toBe(true);
  });

  test("an element id still wins over the symbol fallback", () => {
    const boxes = boxesOf({ group: 17 });
    const { targets } = resolveDragTargets(normalizeItems(["cell_F"]), {
      boxes,
      rings: new Map(),
      cellBox: (s) => periodicCellBox(boxes, s),
    });
    expect(targets[0].element).toBe(true);
  });

  test("an element not on this figure is reported missing, not silently dropped", () => {
    const boxes = boxesOf({ group: 17 });
    const { missing } = resolveDragTargets(normalizeItems(["F", "Na"]), {
      boxes: new Map(),
      rings: new Map(),
      cellBox: (s) => periodicCellBox(boxes, s),
    });
    expect(missing).toEqual(["Na"]);
  });
});

describe("the info card: 118 of them, which is the whole point", () => {
  // The cells print "Fe" and "26" — both too short for meaningfulName — so
  // without the scene naming its own parts the richest clickable surface in
  // the library would carry no cards at all. This is that guarantee.
  const sceneNames = (lang: "en" | "nb" | "la") =>
    table.map((e) => ({ id: "cell_" + e.symbol, name: lang === "nb" ? e.name.nb : lang === "la" ? (e.name.la ?? e.name.en) : e.name.en }));

  test("every cell carries a card, named by its element", () => {
    const spec = { template: "periodic_table", params: {}, elements: [] } as never;
    const res = layoutSpec(spec);
    const targets = cardTargets(spec, { order: res.order, sceneNames: sceneNames("en") });
    expect(targets.get("cell_Fe")?.name).toBe("Iron");
    expect(targets.get("cell_Og")?.name).toBe("Oganesson");
    for (const e of table) expect(targets.has("cell_" + e.symbol)).toBe(true);
  });

  test("the card speaks the figure's language", () => {
    const spec = { template: "periodic_table", params: { names: "nb" }, elements: [] } as never;
    const res = layoutSpec(spec);
    expect(cardTargets(spec, { order: res.order, sceneNames: sceneNames("nb") }).get("cell_Fe")?.name).toBe("Jern");
    expect(cardTargets(spec, { order: res.order, sceneNames: sceneNames("la") }).get("cell_Fe")?.name).toBe("Ferrum");
  });

  test("an authored label still outranks the scene's own name", () => {
    const spec = {
      template: "periodic_table",
      params: {},
      elements: [{ id: "cell_Fe", type: "label", text: "The one that rusts", attach_to: "cell_Fe" }],
    } as never;
    const res = layoutSpec(spec);
    const targets = cardTargets(spec, { order: res.order, sceneNames: sceneNames("en") });
    expect(targets.get("cell_Fe")?.name).toBe("The one that rusts");
  });

  test("a scene that declares nothing gets no scene names — this costs other figures nothing", () => {
    unregisterPack("music");
    registerPack("music", musicYaml);
    const spec = { template: "piano_keys", params: {}, elements: [] } as never;
    const res = layoutSpec(spec);
    const before = cardTargets(spec, { order: res.order });
    const after = cardTargets(spec, { order: res.order, sceneNames: [] });
    expect([...after.keys()]).toEqual([...before.keys()]);
  });
});
