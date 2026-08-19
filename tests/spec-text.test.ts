import { describe, expect, test } from "vitest";
import { formatSpec, parseSpecText } from "../src/spec/text";

describe("parseSpecText — format detection", () => {
  test("whole-document JSON is recognized as json", () => {
    const r = parseSpecText('{"template": "supply_demand", "commands": []}');
    expect(r.format).toBe("json");
    expect(r.value).toMatchObject({ template: "supply_demand" });
  });

  test("YAML is recognized as yaml", () => {
    const r = parseSpecText(
      [
        "title: Demand increase",
        "template: supply_demand",
        "params:",
        "  demand: {curvature: linear, label: D}",
        "commands:",
        "  - speak: Price on the vertical axis.",
        "  - draw: [axes]",
        "  - speak: Talk while pointing.",
        "    blocking: false",
      ].join("\n"),
    );
    expect(r.format).toBe("yaml");
    expect(r.value).toMatchObject({
      title: "Demand increase",
      params: { demand: { curvature: "linear", label: "D" } },
      commands: [
        { speak: "Price on the vertical axis." },
        { draw: ["axes"] },
        { speak: "Talk while pointing.", blocking: false },
      ],
    });
  });

  test("a YAML document containing a JSON-parseable fragment is NOT misread as embedded JSON", () => {
    const r = parseSpecText("title: My drawing\nparams: {}\ncommands: []");
    expect(r.format).toBe("yaml");
    expect(r.value).toMatchObject({ title: "My drawing", params: {} });
  });

  test("JSON embedded in surrounding prose still works (the gdoc case)", () => {
    const r = parseSpecText('My spec is below.\n\n{"template": "supply_demand", "commands": []}\n\nEnjoy!');
    expect(r.format).toBe("json");
    expect(r.value).toMatchObject({ template: "supply_demand" });
  });

  test("smart-quoted JSON from a word processor is repaired", () => {
    const r = parseSpecText("{“template”: “supply_demand”, “commands”: []}");
    expect(r.value).toMatchObject({ template: "supply_demand" });
  });

  test("smart-quoted YAML strings are repaired on the retry pass", () => {
    const r = parseSpecText("title: “A title: with a colon”\ncommands: []");
    expect(r.format).toBe("yaml");
    expect((r.value as { title: string }).title).toBe("A title: with a colon");
  });

  test('the Norway problem stays solved: unquoted "no" is a string, not false', () => {
    const r = parseSpecText("title: no\ncommands: []");
    expect((r.value as { title: unknown }).title).toBe("no");
  });

  test("YAML comments are allowed", () => {
    const r = parseSpecText("# a teaching spec\ntitle: T\ncommands: [] # none yet");
    expect(r.value).toMatchObject({ title: "T" });
  });

  test("unreadable text throws with a line-numbered YAML message", () => {
    expect(() => parseSpecText("title: ok\n  bad: indentation\n weird")).toThrow(/YAML|line/i);
  });

  test("a bare scalar is rejected (not a mapping)", () => {
    expect(() => parseSpecText("just a sentence with no structure")).toThrow(/mapping|JSON|YAML/i);
  });
});

describe("formatSpec", () => {
  const spec = {
    title: "Round trip",
    domain: { x: [0, 100] as [number, number] },
    commands: [{ speak: "A long narration sentence that must never be wrapped onto multiple lines by the serializer." }, { draw: ["a", "b"] }],
  };

  test("yaml round-trips losslessly", () => {
    const text = formatSpec(spec, "yaml");
    expect(parseSpecText(text).value).toEqual(spec);
  });

  test("yaml never wraps long narration lines", () => {
    const text = formatSpec(spec, "yaml");
    const speakLine = text.split("\n").find((l) => l.includes("A long narration"));
    expect(speakLine).toContain("multiple lines by the serializer.");
  });

  test("json output is plain pretty-printed JSON", () => {
    expect(JSON.parse(formatSpec(spec, "json"))).toEqual(spec);
  });
});
