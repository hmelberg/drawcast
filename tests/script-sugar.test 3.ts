import { describe, expect, test } from "vitest";
import { parseScriptPages } from "../src/spec/script/parse";
import { printScriptPages } from "../src/spec/script/print";
import type { Spec } from "../src/spec/types";

const one = (text: string) => parseScriptPages(text).pages[0].spec;
const el = (text: string) => one(`Hei.\n    ${text}\n`).elements![0];

describe("element aliases", () => {
  test("box, circle and person are nodes with a shape", () => {
    expect(el('box hush "Husholdninger"')).toEqual({ id: "hush", type: "node", shape: "rect", text: "Husholdninger" });
    expect(el('circle c "C"')).toMatchObject({ type: "node", shape: "circle" });
    expect(el('person p "Ola"')).toMatchObject({ type: "node", shape: "person" });
  });

  test("note is a text element", () => {
    expect(el('note n "BNP"')).toMatchObject({ type: "text", text: "BNP" });
  });
});

describe("positional shorthands", () => {
  test("flags stand for their fields", () => {
    expect(el("arrow a from.ref x to.ref y curved dashed thick")).toMatchObject({
      curved: true, style: { dash: true, stroke_width: 3 },
    });
  });

  test("a colour word or hex is the stroke colour", () => {
    expect(el("arrow a from.ref x to.ref y blue")).toMatchObject({ style: { color: "blue" } });
    expect(el("arrow b from.ref x to.ref y #2f6b8f")).toMatchObject({ style: { color: "#2f6b8f" } });
  });

  test("a curve says its shape in words", () => {
    expect(el("curve c rising convex steep")).toMatchObject({
      direction: "increasing", curvature: "convex", steepness: "steep",
    });
  });

  test("seconds and draw modes", () => {
    expect(el('text t "hi" x 1 y 2 typed 3s')).toMatchObject({ draw: { mode: "type", duration: 3 } });
  });

  test("an arrow between two ids", () => {
    expect(el("arrow lonn bedr -> hush")).toEqual({ id: "lonn", type: "arrow", from: { ref: "bedr" }, to: { ref: "hush" } });
  });

  test("an arrow with no id of its own still reads", () => {
    expect(el("arrow bedr -> hush")).toMatchObject({ from: { ref: "bedr" }, to: { ref: "hush" } });
  });
});

describe("placement in words", () => {
  test("a place word alone puts the element on the canvas", () => {
    expect(el('box hush "H" left')).toMatchObject({ at: { place: "left" } });
    expect(el('note n "x" top-right')).toMatchObject({ at: { place: "top_right" } });
  });

  test("a side word alone on a label is its side", () => {
    expect(el('label l "Lønn" attach_to lonn below')).toMatchObject({ side: "below", attach_to: "lonn" });
  });

  test("a side word followed by an id is relative placement", () => {
    expect(el('note n "x" above bedr gap 20')).toMatchObject({ at: { side: "above", ref: "bedr", gap: 20 } });
  });
});

describe("a verb takes shorthands too", () => {
  test("seconds on a verb is its duration", () => {
    expect(one("Hei.\n    camera zoom 2 3s\n").commands).toEqual([{ speak: "Hei.", camera: { zoom: 2, duration: 3 } }]);
  });
});

describe("the sugared forms print back", () => {
  const trip = (spec: Spec) => printScriptPages({}, [{ spec }]);

  test("a node with a shape prints as its alias", () => {
    expect(trip({ elements: [{ id: "hush", type: "node", shape: "rect", text: "H", x: 1, y: 2 }], commands: [{ draw: ["hush"] }] }))
      .toBe('    box hush "H" x 1 y 2\n');
  });

  test("an arrow prints with the arrow", () => {
    expect(trip({
      elements: [{ id: "a", type: "arrow", from: { ref: "x" }, to: { ref: "y" }, curved: true, style: { color: "#2f6b8f", stroke_width: 3 } }],
      commands: [{ draw: ["a"] }],
    })).toBe("    arrow a x -> y curved thick #2f6b8f\n");
  });

  test("a placed element prints its place word", () => {
    expect(trip({ elements: [{ id: "n", type: "text", text: "x", at: { place: "top_right" } }], commands: [{ draw: ["n"] }] }))
      .toBe('    text n "x" top-right\n');
  });
});

describe("quiz choice lists", () => {
  test("* is a choice and + is the correct one", () => {
    const spec = one('Hva skjer?\n    quiz question "Hva skjer med toppen?"\n        * Den blir høyere\n        + Den blir lavere\n        * Ingenting\n        right "Nettopp."\n');
    expect(spec.commands).toEqual([{
      speak: "Hva skjer?",
      quiz: { question: "Hva skjer med toppen?", choices: ["Den blir høyere", "Den blir lavere", "Ingenting"], correct: 2, right: "Nettopp." },
    }]);
  });

  test("the choices print back as a list", () => {
    const text = printScriptPages({}, [{ spec: {
      commands: [{ speak: "Hva skjer?", quiz: { question: "Hva nå?", choices: ["Opp", "Ned"], correct: 1 } }],
    } }]);
    expect(text).toBe('Hva skjer?\n    quiz question "Hva nå?"\n        + Opp\n        * Ned\n');
  });
});

describe("connector labels (parse-only sugar)", () => {
  test("quoted text on an arrow mints the attached label too", () => {
    const spec = one('Hei.\n    arrow lonn bedr -> hush "Lønn og inntekt" below\n');
    expect(spec.elements).toEqual([
      { id: "lonn", type: "arrow", from: { ref: "bedr" }, to: { ref: "hush" } },
      { id: "lonn_label", type: "label", text: "Lønn og inntekt", attach_to: "lonn", side: "below" },
    ]);
    expect(spec.commands).toEqual([{ speak: "Hei.", draw: ["lonn", "lonn_label"] }]);
  });

  test("the printer canonicalizes it to two lines — the fold is not reversible", () => {
    const spec = one('Hei.\n    arrow lonn bedr -> hush "Lønn" below\n');
    const text = printScriptPages({}, [{ spec }]);
    expect(text).toBe('Hei.\n    arrow lonn bedr -> hush\n    label lonn_label "Lønn" below attach_to lonn\n');
  });
});

describe("the two lint rules", () => {
  test("a spoken line that looks like a direction is reported", () => {
    const { warnings } = parseScriptPages("Hei.\n    camera zoom 2\n\ndraw axes\n");
    expect(warnings.join(" ")).toMatch(/line 4.*column 0/);
  });

  test("a real sentence beginning with a verb word is left alone", () => {
    const { warnings } = parseScriptPages("Point at the ramp and you see it.\n    camera zoom 2\n");
    expect(warnings).toEqual([]);
  });

  test("an id that shadows a shorthand word is reported", () => {
    const { warnings } = parseScriptPages('Hei.\n    box left "x"\n');
    expect(warnings.join(" ")).toMatch(/line 2.*left/);
  });
});

describe("warnings reach the editor's own channel", () => {
  test("a script's warnings land on the playlist", async () => {
    const { parsePlaylistText } = await import("../src/playlist/playlist");
    const playlist = parsePlaylistText("Hei.\n    camera zoom 2\n\ndraw axes\n");
    expect(playlist.warnings.join(" ")).toMatch(/column 0/);
  });
});
