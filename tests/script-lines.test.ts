import { describe, expect, test } from "vitest";
import { scanLines } from "../src/spec/script/lines";

describe("the line scanner", () => {
  test("column 0 prose is speech, indented lines are directions", () => {
    const ls = scanLines("Hei der.\n    node a x 10\n");
    expect(ls.map((l) => l.kind)).toEqual(["speech", "direction"]);
    expect(ls[0]).toMatchObject({ kind: "speech", line: 1, text: "Hei der." });
    expect(ls[1]).toMatchObject({ kind: "direction", line: 2, indent: 4, head: "node", rest: "a x 10" });
  });

  test("a deeper indent is still a direction — the parser decides what it attaches to", () => {
    const ls = scanLines("Hei.\n    move a\n        duration 2\n");
    expect((ls[1] as { indent: number }).indent).toBe(4);
    expect((ls[2] as { indent: number }).indent).toBe(8);
  });

  test("headings, settings, gotos, comments and blanks are their own kinds", () => {
    const ls = scanLines("# Tittel\n## Side\nlang: nb\n@spor\n// noe\n\n");
    expect(ls.map((l) => l.kind)).toEqual(["heading", "heading", "setting", "goto", "comment", "blank"]);
    expect(ls[0]).toMatchObject({ depth: 1, text: "Tittel" });
    expect(ls[1]).toMatchObject({ depth: 2, text: "Side" });
    expect(ls[2]).toMatchObject({ key: "lang", rest: "nb" });
    expect(ls[3]).toMatchObject({ name: "spor" });
  });

  test("a colon line whose key is not a setting is speech, not a setting", () => {
    const ls = scanLines("Kort sagt: pengene sirkulerer.\n");
    expect(ls[0].kind).toBe("speech");
  });

  test("a dialogue prefix sets the voice and is stripped from the text", () => {
    const ls = scanLines("A: Hvorfor?\nB: Fordi.\n");
    expect(ls[0]).toMatchObject({ kind: "speech", text: "Hvorfor?", voice: "a" });
    expect(ls[1]).toMatchObject({ kind: "speech", text: "Fordi.", voice: "b" });
  });

  test("a fence swallows its body verbatim and dedents it by its own indent", () => {
    const ls = scanLines('Se her.\n    ```python p show below\n    import numpy\n      x = 1\n    ```\n');
    expect(ls[1]).toMatchObject({ kind: "fence", indent: 4, info: "python p show below" });
    expect((ls[1] as { body: string }).body).toBe("import numpy\n  x = 1");
  });

  test("a tab indents one level, four spaces", () => {
    const ls = scanLines("Hei.\n\tnode a\n");
    expect((ls[1] as { indent: number }).indent).toBe(4);
  });

  test("line numbers survive a fence", () => {
    const ls = scanLines("Hei.\n    ```python p\n    x = 1\n    ```\nEtterpå.\n");
    expect(ls[2]).toMatchObject({ kind: "speech", line: 5, text: "Etterpå." });
  });
});
