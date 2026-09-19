import { describe, expect, test } from "vitest";
import { parseScriptPages } from "../src/spec/script/parse";
import { printScriptPages } from "../src/spec/script/print";
import type { Spec } from "../src/spec/types";

const one = (text: string) => parseScriptPages(text).pages[0].spec;

describe("a structure written as a block", () => {
  test("the members are the lines under the row", () => {
    const spec = one('To slags aktører.\n    row\n        box hush "Husholdninger"\n        box bedr "Bedrifter"\n');
    expect(spec.elements).toEqual([
      { id: "hush", type: "node", shape: "rect", text: "Husholdninger" },
      { id: "bedr", type: "node", shape: "rect", text: "Bedrifter" },
      { id: "row_2", type: "group", layout: "row", members: ["hush", "bedr"] },
    ]);
    // A group is a handle, not ink: the members are what gets drawn.
    expect(spec.commands).toEqual([{ speak: "To slags aktører.", draw: ["hush", "bedr"] }]);
  });

  test("the row takes its own keys", () => {
    const spec = one('Hei.\n    row r gap 80 align start\n        box a "A"\n        box b "B"\n');
    expect(spec.elements![2]).toMatchObject({ id: "r", type: "group", layout: "row", gap: 80, align: "start" });
  });

  test("a column nests inside a row", () => {
    const spec = one('Hei.\n    row\n        box a "A"\n        column stage\n            box b "B"\n            box c "C"\n');
    const groups = spec.elements!.filter((e) => e.type === "group");
    expect(groups.map((g) => g.layout)).toEqual(["column", "row"]);
    expect(groups[0].members).toEqual(["b", "c"]);
    expect(groups[1].members).toEqual(["a", "stage"]);
  });
});

describe("a member born in a later beat", () => {
  test("`in` joins a group declared earlier", () => {
    const spec = one('    row kretslop\n\nHusholdningene.\n    box hush "Husholdninger" in kretslop\n\nBedriftene.\n    box bedr "Bedrifter" in kretslop\n');
    const group = spec.elements!.find((e) => e.type === "group")!;
    expect(group).toMatchObject({ id: "kretslop", layout: "row", members: ["hush", "bedr"] });
    expect(spec.elements!.find((e) => e.id === "hush")).not.toHaveProperty("in");
  });

  test("`in` may name a group declared later in the page", () => {
    const spec = one('Hei.\n    box a "A" in later\n\n    row later\n');
    expect(spec.elements!.find((e) => e.id === "later")!.members).toEqual(["a"]);
  });
});

describe("printing", () => {
  const nested: Spec = {
    elements: [
      { id: "a", type: "node", shape: "rect", text: "A" },
      { id: "b", type: "node", shape: "rect", text: "B" },
      { id: "g", type: "group", layout: "row", members: ["a", "b"] },
    ],
    // The draw list a nested block actually produces: the members, not the
    // group — a group is a handle, so drawing it is a different spec.
    commands: [{ draw: ["a", "b"], speak: "Hei." }],
  };

  test("members drawn with their group print as a block", () => {
    expect(printScriptPages({}, [{ spec: nested }])).toBe('Hei.\n    row g\n        box a "A"\n        box b "B"\n');
  });

  test("members drawn later print with in", () => {
    const staged: Spec = {
      elements: nested.elements,
      commands: [{ draw: ["g"] }, { draw: ["a"], speak: "Først." }, { draw: ["b"], speak: "Så." }],
    };
    const text = printScriptPages({}, [{ spec: staged }]);
    expect(text).toContain("in g");
    expect(parseScriptPages(text).pages[0].spec.elements!.find((e) => e.id === "g")!.members).toEqual(["a", "b"]);
  });
});

describe("the block form survives a round trip", () => {
  test("write it as a block, read it, write it again — unchanged", () => {
    const source = 'To slags aktører.\n    row aktorer gap 260\n        box hush "Husholdninger"\n        box bedr "Bedrifter"\n';
    const spec = parseScriptPages(source).pages[0].spec;
    expect(printScriptPages({}, [{ spec }])).toBe(source);
  });
});
