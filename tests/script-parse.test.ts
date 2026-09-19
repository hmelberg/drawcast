import { describe, expect, test } from "vitest";
import { parseScriptPages } from "../src/spec/script/parse";

const one = (text: string) => parseScriptPages(text).pages[0].spec;

describe("beats", () => {
  test("a spoken line with declarations becomes one draw command carrying the line", () => {
    const spec = one('To slags aktører.\n    node hush "Husholdninger" x 220 y 375\n    node bedr "Bedrifter" x 780 y 375\n');
    expect(spec.elements).toEqual([
      { id: "hush", type: "node", text: "Husholdninger", x: 220, y: 375 },
      { id: "bedr", type: "node", text: "Bedrifter", x: 780, y: 375 },
    ]);
    expect(spec.commands).toEqual([{ speak: "To slags aktører.", draw: ["hush", "bedr"] }]);
  });

  test("a verb after declarations is its own command, and the speech stays on the first", () => {
    const spec = one('Se her.\n    node a x 1 y 2\n    point at.ref a\n');
    expect(spec.commands).toEqual([
      { speak: "Se her.", draw: ["a"] },
      { point: { at: { ref: "a" } } },
    ]);
  });

  test("a blank line ends the beat", () => {
    const spec = one("Først.\n    node a x 1 y 2\n\n    camera zoom 2\n");
    expect(spec.commands).toEqual([
      { speak: "Først.", draw: ["a"] },
      { camera: { zoom: 2 } },
    ]);
  });

  test("two spoken lines in a row are two beats", () => {
    const spec = one("Først.\nSå.\n    camera reset true\n");
    expect(spec.commands).toEqual([{ speak: "Først." }, { speak: "Så.", camera: { reset: true } }]);
  });

  test("directions with no spoken line above them are a silent beat", () => {
    const spec = one("    camera zoom 2\n");
    expect(spec.commands).toEqual([{ camera: { zoom: 2 } }]);
  });

  test("a deeper indent continues the direction above it", () => {
    const spec = one("Flytt.\n    move target a\n        by [10, 0]\n        duration 2\n");
    expect(spec.commands).toEqual([{ speak: "Flytt.", move: { target: "a", by: [10, 0], duration: 2 } }]);
  });

  test("a dialogue line carries its voice", () => {
    const spec = one("B: Fordi.\n    camera zoom 2\n");
    expect(spec.commands).toEqual([{ speak: "Fordi.", voice: "b", camera: { zoom: 2 } }]);
  });

  test("@label attaches to the first command of the next beat", () => {
    const spec = one("@spor\nHva nå?\n    camera zoom 2\n");
    expect(spec.commands).toEqual([{ label: "spor", speak: "Hva nå?", camera: { zoom: 2 } }]);
  });
});

describe("directions", () => {
  test("dot declares a point element and point is the laser verb", () => {
    const spec = one("Se.\n    dot p x 3 on wave\n    point at.ref p gesture tap\n");
    expect(spec.elements).toEqual([{ id: "p", type: "point", x: 3, on: "wave" }]);
    expect(spec.commands![1]).toEqual({ point: { at: { ref: "p" }, gesture: "tap" } });
  });

  test("a quoted string after the id is the element's text", () => {
    const spec = one('Hei.\n    label l "Lønn" attach_to arr side below\n');
    expect(spec.elements).toEqual([{ id: "l", type: "label", text: "Lønn", attach_to: "arr", side: "below" }]);
  });

  test("dotted keys rebuild nested objects", () => {
    const spec = one('Hei.\n    arrow a from.ref x to.ref y style.color #2f6b8f style.stroke_width 3\n');
    expect(spec.elements![0]).toEqual({
      id: "a", type: "arrow", from: { ref: "x" }, to: { ref: "y" }, style: { color: "#2f6b8f", stroke_width: 3 },
    });
  });

  test("a list verb takes bare ids until a known key", () => {
    const spec = one("Hei.\n    draw a b c parallel true\n");
    expect(spec.commands).toEqual([{ speak: "Hei.", draw: ["a", "b", "c"], parallel: true }]);
  });

  test("a verb whose argument is a bare id fills its target", () => {
    const spec = one("Hei.\n    highlight a b effect glow\n");
    expect(spec.commands).toEqual([{ speak: "Hei.", highlight: { target: ["a", "b"], effect: "glow" } }]);
  });

  test("an unknown head names the line", () => {
    expect(() => one("Hei.\n    bx a x 1\n")).toThrow(/line 2/);
  });
});

describe("settings, pages and fences", () => {
  test("# titles a single page, ## opens pages", () => {
    const doc = parseScriptPages("# Kretsløpet\n\nHei.\n    camera zoom 2\n");
    expect(doc.pages).toHaveLength(1);
    expect(doc.pages[0].spec.title).toBe("Kretsløpet");
  });

  test("## pages carry their own titles and the # title is the playlist's", () => {
    const doc = parseScriptPages("# Serien\n\n## Første\nHei.\n\n## Andre\nDa.\n");
    expect(doc.meta.title).toBe("Serien");
    expect(doc.pages.map((p) => p.spec.title)).toEqual(["Første", "Andre"]);
  });

  test("settings land on the page, and use/with are template and params", () => {
    const spec = parseScriptPages('## Smitte\nlang: nb\nuse: sir_model\nwith: {"beta": 0.3}\nvars: {"f": 1}\nHei.\n').pages[0].spec;
    expect(spec).toMatchObject({ lang: "nb", template: "sir_model", params: { beta: 0.3 }, vars: { f: 1 } });
  });

  test("a language fence is a code element, drawn in its beat", () => {
    const spec = parseScriptPages('Se.\n    ```python p show below lines 5\n    import numpy as np\n    x = 1\n    ```\n').pages[0].spec;
    expect(spec.elements).toEqual([
      { id: "p", type: "code", language: "python", show: "below", lines: 5, code: "import numpy as np\nx = 1" },
    ]);
    expect(spec.commands).toEqual([{ speak: "Se.", draw: ["p"] }]);
  });

  test("a yaml fence is the escape hatch: its elements land verbatim", () => {
    const spec = parseScriptPages("Se.\n    ```yaml\n    - id: odd\n      type: pieces\n      of: sectors\n      n: 8\n      radius: 50\n    ```\n").pages[0].spec;
    expect(spec.elements).toEqual([{ id: "odd", type: "pieces", of: "sectors", n: 8, radius: 50 }]);
  });

  test("an assets fence restores the machine payloads", () => {
    const spec = parseScriptPages("Hei.\n    camera zoom 2\n\n```assets\nfoto: AAAB\n```\n").pages[0].spec;
    expect(spec.assets).toEqual({ foto: "AAAB" });
  });
});
