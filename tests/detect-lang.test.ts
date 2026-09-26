import { describe, expect, test } from "vitest";
import { detectLang } from "../src/render/speech";

describe("detectLang weighs evidence, not a single letter", () => {
  test("an English line with a Norwegian name stays English", () => {
    expect(detectLang("Bjørn falls ill at 76 and dies at 78.")).toBe("en");
    expect(detectLang("Count the share of the remaining life that is lost — and it is Bjørn's.")).toBe("en");
    expect(detectLang("Anna and Bjørn.")).toBe("en");
  });
  test("Norwegian lines are Norwegian, with or without æøå", () => {
    expect(detectLang("Hvorfor blir renters rente så stor?")).toBe("nb");
    expect(detectLang("Pengene går rundt, og det én bruker er det en annen tjener.")).toBe("nb");
    expect(detectLang("Dette er en rett linje som går gjennom origo.")).toBe("nb");
  });
  test("no evidence either way is English", () => {
    expect(detectLang("42")).toBe("en");
  });
});
