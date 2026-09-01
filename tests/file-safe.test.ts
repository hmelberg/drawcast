import { describe, expect, it } from "vitest";
import { fileSafe } from "../src/ui/share";

describe("fileSafe", () => {
  it("keeps spaces and Norwegian characters — a filename, not a slug", () => {
    expect(fileSafe("Årsak og effekt")).toBe("Årsak og effekt");
  });
  it("strips illegal characters and falls back when nothing survives", () => {
    expect(fileSafe("???")).toBe("drawcast");
    expect(fileSafe("???", "prompt")).toBe("prompt");
  });
  it("caps at 40 characters, cut at a word boundary (P §8.1)", () => {
    const long = "Ricardo on trade and comparative advantage in the nineteenth century";
    const out = fileSafe(long);
    expect(out.length).toBeLessThanOrEqual(40);
    expect(out).toBe("Ricardo on trade and comparative");
    expect(out).not.toMatch(/ $/);
  });
  it("hard-cuts a single 80-char word rather than returning it whole", () => {
    expect(fileSafe("a".repeat(80)).length).toBe(40);
  });
  it("leaves short titles untouched", () => {
    expect(fileSafe("Supply and demand")).toBe("Supply and demand");
  });
});
