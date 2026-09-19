import { describe, expect, test } from "vitest";
import { printScriptPages } from "../src/spec/script/print";
import { parseScriptPages } from "../src/spec/script/parse";
import type { Spec } from "../src/spec/types";

const print = (spec: Spec) => printScriptPages({}, [{ spec }]);

describe("printing beats", () => {
  test("a draw of freshly declared elements prints as declarations under the line", () => {
    const spec: Spec = {
      elements: [
        { id: "hush", type: "node", text: "Husholdninger", x: 220, y: 375 },
        { id: "bedr", type: "node", text: "Bedrifter", x: 780, y: 375 },
      ],
      commands: [{ draw: ["hush", "bedr"], speak: "To slags aktører." }],
    };
    expect(print(spec)).toBe(
      'To slags aktører.\n    node hush "Husholdninger" x 220 y 375\n    node bedr "Bedrifter" x 780 y 375\n',
    );
  });

  test("a verb command prints as one direction line", () => {
    const spec: Spec = { commands: [{ camera: { zoom: 2 }, speak: "Nærmere." }] };
    expect(print(spec)).toBe("Nærmere.\n    camera zoom 2\n");
  });

  test("consecutive commands are separate beats, one blank line apart", () => {
    const spec: Spec = { commands: [{ speak: "Først." }, { camera: { zoom: 2 } }] };
    expect(print(spec)).toBe("Først.\n\n    camera zoom 2\n");
  });

  test("an element that is never drawn goes in the props block, marked hidden", () => {
    const spec: Spec = {
      elements: [{ id: "feed", type: "code", language: "python", code: "x = 1", show: "none" }],
      commands: [{ speak: "Hei." }],
    };
    expect(print(spec)).toContain("hidden");
  });

  test("an element out of first-mention order goes in the props block, not inline", () => {
    const spec: Spec = {
      elements: [
        { id: "second", type: "shape", shape: "rect", x: 1, y: 2 },
        { id: "first", type: "shape", shape: "rect", x: 3, y: 4 },
      ],
      commands: [{ draw: ["first"] }, { draw: ["second"] }],
    };
    const text = print(spec);
    expect(parseScriptPages(text).pages[0].spec.elements!.map((e) => e.id)).toEqual(["second", "first"]);
  });

  test("voice b prints as a dialogue prefix and a label as @name", () => {
    const spec: Spec = { commands: [{ speak: "Fordi.", voice: "b", label: "spor", camera: { zoom: 2 } }] };
    expect(print(spec)).toBe("@spor\nB: Fordi.\n    camera zoom 2\n");
  });

  test("printing is stable: printing what was parsed from a print changes nothing", () => {
    const spec: Spec = {
      elements: [{ id: "a", type: "shape", shape: "rect", x: 1, y: 2, style: { color: "red" } }],
      commands: [{ draw: ["a"], speak: "Hei." }, { highlight: { target: ["a"], effect: "glow" } }],
    };
    const once = print(spec);
    expect(print(parseScriptPages(once).pages[0].spec)).toBe(once);
  });
});
