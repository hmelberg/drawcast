// The ＋ Insert menu's "Data from disk…" — a file becomes an asset. The pure
// halves only: parsing and naming. The dialog itself is DOM and lives in
// insert.ts's lazy build(), exactly as portrait-insert.test.ts has it.
import { describe, expect, test } from "vitest";
import { assetNameFor, parseDataFile, pickAssetName } from "../src/ui/insert";

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

  // Round 1 review, finding 3: a naive split(",") misparses any quoted field
  // that contains a comma — a name like "Melberg, Hans" is ordinary, not
  // exotic, for a feature whose whole pitch is "a spreadsheet export lands as
  // rows of objects".
  test("a quoted field may contain a comma", () => {
    const csv = 'name,note\n"Melberg, Hans",fan\nRuy Lopez,pro';
    const rows = parseDataFile(csv, "people.csv").rows as Record<string, unknown>[];
    expect(rows).toEqual([
      { name: "Melberg, Hans", note: "fan" },
      { name: "Ruy Lopez", note: "pro" },
    ]);
  });

  test('a doubled "" inside a quoted field is one literal quote, and the surrounding quotes are stripped', () => {
    const csv = 'quote\n"She said ""hi"""';
    const rows = parseDataFile(csv, "quotes.csv").rows as Record<string, unknown>[];
    expect(rows).toEqual([{ quote: 'She said "hi"' }]);
  });

  test("a row may mix quoted and bare fields", () => {
    const csv = 'eco,name,rating\nC60,"Ruy, Lopez",2500';
    const rows = parseDataFile(csv, "mixed.csv").rows as Record<string, unknown>[];
    expect(rows).toEqual([{ eco: "C60", name: "Ruy, Lopez", rating: 2500 }]);
  });

  test("a quoted number is still a number when every cell in its column is", () => {
    const csv = 'eco,rating\nC50,"2400"\nC60,"2500"';
    const rows = parseDataFile(csv, "q.csv").rows as Record<string, unknown>[];
    expect(rows[0].rating).toBe(2400);
  });

  test("an unterminated quote is reported, never silently spilled across lines", () => {
    expect(parseDataFile('a,b\n"unterminated,x', "broken.csv").error).toMatch(/unterminated/);
  });
});

// Round 1 review, finding 1: the confirm handler used to dedupe against
// `taken.filter(n => n !== nameInput.value)` — which removes the TYPED name
// from the taken list, so typing an existing asset's name always looked
// "free" and silently overwrote it while the status still said "Added".
// pickAssetName is the extracted, testable version of that decision: an
// untouched prefill keeps auto-deduping (a careless confirm can never
// clobber anything by accident), but a name the author actually typed is
// taken at face value — replacing it is a wanted re-import, not a bug — and
// reported as `replacing: true` so the caller can say "Replaced" instead of
// "Added".
describe("pickAssetName", () => {
  test("an untouched prefill keeps auto-deduping — never a silent collision", () => {
    expect(pickAssetName("openings", false, ["openings"])).toEqual({ name: "openings_2", replacing: false });
  });

  test("a typed name that matches an existing asset replaces it, honestly", () => {
    expect(pickAssetName("openings", true, ["openings"])).toEqual({ name: "openings", replacing: true });
  });

  test("a typed name that collides with nothing is a plain add", () => {
    expect(pickAssetName("new_data", true, ["openings"])).toEqual({ name: "new_data", replacing: false });
  });

  test('an emptied, typed field falls back to the auto-deduped "data"', () => {
    expect(pickAssetName("", true, ["data"])).toEqual({ name: "data_2", replacing: false });
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
