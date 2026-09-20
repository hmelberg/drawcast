// The ＋ Insert menu's "Data from disk…" — a file becomes an asset. The pure
// halves only: parsing and naming. The dialog itself is DOM and lives in
// insert.ts's lazy build(), exactly as portrait-insert.test.ts has it.
import { describe, expect, test } from "vitest";
import { assetNameFor, parseDataFile } from "../src/ui/insert";

describe("parseDataFile", () => {
  test("JSON comes through as written", () => {
    expect(parseDataFile('[{"name":"Italian Game","eco":"C50"}]', "openings.json").rows).toEqual([
      { name: "Italian Game", eco: "C50" },
    ]);
  });

  test("CSV's header row becomes the keys", () => {
    const csv = "name,eco,moves\nItalian Game,C50,e4 e5\nRuy Lopez,C60,e4 e5";
    expect(parseDataFile(csv, "openings.csv").rows).toEqual([
      { name: "Italian Game", eco: "C50", moves: "e4 e5" },
      { name: "Ruy Lopez", eco: "C60", moves: "e4 e5" },
    ]);
  });

  test("a column is numeric only when EVERY cell in it is", () => {
    const csv = "eco,rating,note\nC50,2400,solid\nC60,n/a,sharp";
    const rows = parseDataFile(csv, "x.csv").rows as Record<string, unknown>[];
    expect(rows[0].rating).toBe("2400"); // one bad cell keeps the whole column as text
    const clean = parseDataFile("eco,rating\nC50,2400\nC60,2500", "y.csv").rows as Record<string, unknown>[];
    expect(clean[0].rating).toBe(2400);
  });

  test("malformed input is reported, never thrown", () => {
    expect(parseDataFile("{not json", "x.json").error).toMatch(/could not be read as JSON/);
    expect(parseDataFile("", "x.csv").error).toMatch(/empty/);
  });
});

describe("assetNameFor", () => {
  test("slugifies the filename to the reference character set", () => {
    expect(assetNameFor("My Openings (2026).json", [])).toBe("my_openings_2026");
  });

  test("never collides with a name already in the document", () => {
    expect(assetNameFor("openings.csv", ["openings"])).toBe("openings_2");
    expect(assetNameFor("openings.csv", ["openings", "openings_2"])).toBe("openings_3");
  });
});
