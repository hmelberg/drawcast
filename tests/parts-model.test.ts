// The generic identify drill's data space: which drawn things count as
// parts, where their names come from, what the drill hides, and that the
// questions are distinct and deterministic under an injected rng.
import { describe, expect, test } from "vitest";
import { MIN_PARTS, partsOf, partsQuizTargets, type PartFacts } from "../src/ui/parts-model";
import type { Spec } from "../src/spec/types";
import type { BBox } from "../src/layout/geometry";

const spec = (elements: unknown[]): Spec => ({ elements, commands: [] }) as unknown as Spec;
const box = (x = 0): BBox => ({ x, y: 0, w: 10, h: 10 });
const boxes = (...ids: string[]): Map<string, BBox> => new Map(ids.map((id, i) => [id, box(i * 20)]));

function rngOf(...vals: number[]): () => number {
  let i = 0;
  return () => vals[i++ % vals.length];
}

describe("partsOf — freehand specs", () => {
  test("an authored label names what it attaches to; the label, its leader and the part's own guide are the name ids", () => {
    const s = spec([
      { id: "mito", type: "circle" },
      { id: "mito_lbl", type: "label", text: "Mitochondria", attach_to: "mito" },
    ]);
    const parts = partsOf(s, { boxes: boxes("mito", "mito_lbl") });
    expect(parts).toEqual([{ id: "mito", name: "Mitochondria", nameIds: ["mito_lbl", "mito_lbl_leader", "mito_leader"], box: box(0) }]);
  });

  test("a node is a part named by its own words; the drawn word it owns is hidden", () => {
    const s = spec([{ id: "conf", type: "node", text: "Confounding" }]);
    const facts: PartFacts = { boxes: boxes("conf"), texts: [{ id: "conf__text", text: "Confounding", owner: "conf" }] };
    expect(partsOf(s, facts)).toEqual([{ id: "conf", name: "Confounding", nameIds: ["conf__text", "conf_leader"], box: box(0) }]);
  });

  test("portraits are parts named by their person", () => {
    const s = spec([{ id: "pascal", type: "portrait", of: "Blaise Pascal" }]);
    expect(partsOf(s, { boxes: boxes("pascal") }).map((p) => p.name)).toEqual(["Blaise Pascal"]);
  });

  test("labels, texts, sources, code and annotations are never parts, and symbols do not name one", () => {
    const s = spec([
      { id: "d", type: "curve" },
      { id: "d_lbl", type: "label", text: "D′", attach_to: "d" },
      { id: "cap", type: "text", text: "A caption sentence" },
      { id: "src", type: "source", of: "A paper title" },
      { id: "sim", type: "code", language: "python", code: "print(1)" },
      { id: "box_lbl", type: "label", text: "Caption box", attach_to: "cap" },
    ]);
    expect(partsOf(s, { boxes: boxes("d", "d_lbl", "cap", "src", "sim", "box_lbl") })).toEqual([]);
  });

  test("an element without geometry (not drawn) is not a part", () => {
    const s = spec([
      { id: "gone", type: "circle" },
      { id: "gone_lbl", type: "label", text: "Somewhere", attach_to: "gone" },
    ]);
    expect(partsOf(s, { boxes: boxes("gone_lbl") })).toEqual([]);
  });
});

describe("partsOf — templates", () => {
  test("a drawn `label_<part>` word names the part; sub-drawables and the label itself never qualify", () => {
    const facts: PartFacts = {
      boxes: boxes("body", "bridge", "label_bridge", "label_body"),
      texts: [
        { id: "label_bridge", text: "Bridge", owner: "label_bridge" },
        { id: "label_body", text: "Body", owner: "label_body" },
        { id: "axes__x_label", text: "Quantity", owner: "axes" },
      ],
    };
    const parts = partsOf(spec([]), facts);
    expect(parts.map((p) => [p.id, p.name, p.nameIds])).toEqual([
      ["body", "Body", ["label_body", "label_body_leader", "body_leader"]],
      ["bridge", "Bridge", ["label_bridge", "label_bridge_leader", "bridge_leader"]],
    ]);
  });

  test("the `<part>_label` suffix convention names a part the same way", () => {
    const facts: PartFacts = { boxes: boxes("p1", "p1_label"), texts: [{ id: "p1_label", text: "Origin point", owner: "p1_label" }] };
    expect(partsOf(spec([]), facts).map((p) => [p.id, p.name])).toEqual([["p1", "Origin point"]]);
  });

  test("scene names are parts too, with only the part's own guide to hide", () => {
    const parts = partsOf(spec([]), { boxes: boxes("cell_Fe"), sceneNames: [{ id: "cell_Fe", name: "Iron" }] });
    expect(parts).toEqual([{ id: "cell_Fe", name: "Iron", nameIds: ["cell_Fe_leader"], box: box(0) }]);
  });

  test("a part named twice keeps its first name and gains the extra name ids", () => {
    const s = spec([
      { id: "heart", type: "blob" },
      { id: "heart_lbl", type: "label", text: "Heart", attach_to: "heart" },
    ]);
    const facts: PartFacts = { boxes: boxes("heart", "heart_lbl", "label_heart"), texts: [{ id: "label_heart", text: "Hjertet", owner: "label_heart" }] };
    expect(partsOf(s, facts)).toEqual([
      { id: "heart", name: "Heart", nameIds: ["heart_lbl", "heart_lbl_leader", "heart_leader", "label_heart", "label_heart_leader"], box: box(0) },
    ]);
  });

  test("parts come in draw order", () => {
    const facts: PartFacts = {
      boxes: boxes("a", "b", "c"),
      texts: [
        { id: "label_c", text: "Third" },
        { id: "label_a", text: "First" },
        { id: "label_b", text: "Second" },
      ],
    };
    expect(partsOf(spec([]), facts).map((p) => p.name)).toEqual(["First", "Second", "Third"]);
  });
});

describe("partsQuizTargets", () => {
  const parts = partsOf(spec([]), {
    boxes: boxes("a", "b", "c", "d"),
    texts: ["a", "b", "c", "d"].map((id) => ({ id: `label_${id}`, text: `Part ${id.toUpperCase()}` })),
  });

  test("distinct parts, as many as asked, never more than the figure has", () => {
    const t = partsQuizTargets(3, parts);
    expect(t).toHaveLength(3);
    expect(new Set(t.map((q) => q.reveal[0])).size).toBe(3);
    expect(partsQuizTargets(9, parts)).toHaveLength(4);
  });

  test("a question accepts the part and the words that print its name, reveals the part, and asks by name", () => {
    const [q] = partsQuizTargets(1, parts.slice(0, 1));
    expect(q).toEqual({ prompt: "Click: Part A", accepts: ["a", "label_a", "label_a_leader", "a_leader"], reveal: ["a"] });
  });

  test("deterministic under an injected rng", () => {
    expect(partsQuizTargets(3, parts, rngOf(0.1, 0.5, 0.9))).toEqual(partsQuizTargets(3, parts, rngOf(0.1, 0.5, 0.9)));
  });

  test("MIN_PARTS is a small number a modest figure clears", () => {
    expect(MIN_PARTS).toBe(3);
  });
});
