// The bug this file exists to prevent: a translated drawcast with English
// words still on the figure. A scene template computes its own captions —
// "Susceptible" for compartment "S", "Reaction progress" under an axis — so
// they are in the layout code, never in the spec, and a translator that reads
// the spec cannot see them. Measured when it was found: 67 of the 114 bundled
// drawcasts drew text the spec did not hold.
//
// The check is end-to-end on purpose: lay out, read every word off the canvas,
// and require that the translation pipeline offered every one of them.

import { beforeAll, describe, expect, test } from "vitest";
import bundled from "../src/examples.json";
import { ensureEnabledPacks, PACK_DEFS } from "../src/scenes/packs";
import { scenes } from "../src/scenes/registry";
import { layoutSpec } from "../src/layout/layout";
import { collectDrawnText } from "../src/layout/text-map";
import { translatableStrings, applyTranslations } from "../src/spec/i18n";
import { drawnOnlyStrings } from "../src/llm/translate";
import { itemsOf, parsePlaylistText } from "../src/playlist/playlist";
import type { Spec } from "../src/spec/types";

const specs = (bundled as { spec?: Spec; playlist?: string }[]).flatMap((ex) =>
  ex.spec ? [ex.spec] : ex.playlist ? itemsOf(parsePlaylistText(ex.playlist)).map((i) => i.spec) : [],
);

beforeAll(async () => {
  await ensureEnabledPacks(Object.keys(PACK_DEFS));
});

function schemaFor(spec: Spec): object | undefined {
  return spec.template ? scenes[spec.template]?.manifest.params_schema : undefined;
}

/** Everything the pipeline would send a translator, spec fields and canvas both. */
function everythingSent(spec: Spec): Set<string> {
  const fromSpec = translatableStrings(spec, schemaFor(spec));
  const covered = new Set(fromSpec.map((t) => t.text));
  return new Set([...covered, ...drawnOnlyStrings(spec, covered).map((t) => t.text)]);
}

describe("translation reaches every word on the canvas", () => {
  test("no bundled drawcast draws text the translator is never shown", () => {
    const gaps: string[] = [];
    for (const spec of specs) {
      const sent = everythingSent(spec);
      const missed = collectDrawnText(layoutSpec(spec).drawables, []).filter((t) => !sent.has(t));
      if (missed.length > 0) gaps.push(`${spec.template ?? "(tier-2)"}: ${missed.slice(0, 4).join(" | ")}`);
    }
    expect(gaps).toEqual([]);
  });

  test("a template's computed caption survives the round trip and reaches the canvas", () => {
    // The original report: an SEIR model whose compartments are named "S", "E",
    // "I", "R" — the words below are supplied by the template, not the spec.
    const spec: Spec = { template: "sir_compartments", params: { compartments: ["S", "E", "I", "R"] } };
    const covered = new Set(translatableStrings(spec, schemaFor(spec)).map((t) => t.text));
    const drawn = drawnOnlyStrings(spec, covered).map((t) => t.text);
    expect(drawn).toContain("Susceptible");
    expect(drawn).toContain("Exposed");

    const translated = applyTranslations(spec, {}, schemaFor(spec));
    translated.text_map = { Susceptible: "Anfällig", Exposed: "Exponiert" };
    const onCanvas = collectDrawnText(layoutSpec(translated).drawables, []);
    expect(onCanvas).toContain("Anfällig");
    expect(onCanvas).toContain("Exponiert");
    expect(onCanvas).not.toContain("Susceptible");
  });
});
