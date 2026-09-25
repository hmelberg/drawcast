// A measure writes its number the way the cast's voice reads it: 8,7 in a
// Norwegian cast, 8.7 in an English one (2026-09-25 example revisions).
import { describe, expect, test } from "vitest";
import { layoutSpec } from "../src/layout/layout";
import { flattenDrawables } from "../src/layout/model";
import type { Spec } from "../src/spec/types";

const withSpeech = (speak: string, lang?: string): Spec => ({
  ...(lang ? { lang } : {}),
  elements: [{ id: "side", type: "measure", from: { x: 100, y: 300 }, to: { x: 187, y: 300 }, scale: 10, unit: "cm", label: "a = {value}" }],
  commands: [{ draw: ["side"], speak }],
} as unknown as Spec);

const labelOf = (spec: Spec) =>
  (flattenDrawables(layoutSpec(spec).drawables).find((d) => d.kind === "text" && /a = /.test((d as { text: string }).text)) as { text: string } | undefined)?.text;

describe("measure decimal separator", () => {
  test("a Norwegian cast writes a decimal comma", () => {
    expect(labelOf(withSpeech("Siden er åtte komma sju centimeter lang, og det er ikke tilfeldig."))).toBe("a = 8,7 cm");
  });
  test("an English cast keeps the point", () => {
    expect(labelOf(withSpeech("The side is eight point seven centimetres long, and that is the point."))).toBe("a = 8.7 cm");
  });
  test("spec.lang wins over the sniff", () => {
    expect(labelOf(withSpeech("The side is 8.7 cm long.", "de"))).toBe("a = 8,7 cm");
  });
});
