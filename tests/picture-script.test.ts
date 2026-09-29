import { describe, expect, test } from "vitest";
import { parseScriptPages } from "../src/spec/script/parse";
import { printScriptPages } from "../src/spec/script/print";
import type { Spec } from "../src/spec/types";

describe("picture places in the script format", () => {
  const spec = {
    elements: [{ id: "md", type: "image", url: "https://x.org/a.png", look: "screen", regions: { datasets: [0, 0, 0.2, 0.5], results: [0.2, 0, 0.8, 0.9] } }],
    commands: [
      { draw: ["md"] },
      { highlight: { target: ["md:datasets"] } },
      { focus: { target: ["md:results", "md@[0.2, 0.9, 0.8, 0.1]", "md@top"] } },
      { camera: { on: ["md:results"] } },
      { point: { at: { ref: "md:datasets" }, gesture: "underline" } },
    ],
  } as unknown as Spec;
  test("a spec with places prints and parses back to itself", () => {
    const text = printScriptPages({}, [{ spec }]);
    expect(text).toContain("md:datasets");
    const back = parseScriptPages(text).pages[0].spec;
    expect(back.commands).toEqual(spec.commands);
    expect(printScriptPages({}, [{ spec: back }])).toBe(text);
  });
  test("a hand-written highlight line with a place", () => {
    const back = parseScriptPages("Se.\n    highlight md:datasets\n").pages[0].spec;
    expect(back.commands).toEqual([{ speak: "Se.", highlight: { target: ["md:datasets"] } }]);
  });
});
