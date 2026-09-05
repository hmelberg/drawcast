// The translation layer's two halves share ONE traversal, so they can never
// disagree about what is text: a field the collector misses is a field the
// applier cannot reach either. What they must never touch is the spec they are
// given — exportSequence hands out the document's own objects by reference
// (playlist.ts), so a mutating translator would rewrite the user's library.

import { describe, expect, test } from "vitest";
import { applyTranslations, translatableStrings } from "../src/spec/i18n";
import type { Spec } from "../src/spec/types";

const spec: Spec = {
  title: "The cost-effectiveness plane",
  elements: [
    { id: "ax", type: "axes", x_label: "Cost", y_label: "Effect" },
    { id: "note", type: "label", text: "The threshold", attach_to: "ax", side: "above" },
    { id: "src", type: "source", of: "Adam Smith", quote: "the invisible hand", doi: "10.1000/x" },
  ],
  commands: [
    { speak: "Here is the plane." },
    { draw: ["ax", "note"], label: "start" },
    { quiz: { question: "Which quadrant dominates?", choices: ["North-east", "South-west"], correct: 2, right: "Exactly.", wrong_goto: "start" } },
  ],
};

describe("applyTranslations", () => {
  test("never touches the spec it is given — the document survives an upload in another language", () => {
    const before = JSON.stringify(spec);

    applyTranslations(spec, { "Here is the plane.": "Her er planet.", Cost: "Kostnad" });

    expect(JSON.stringify(spec)).toBe(before);
  });

  test("puts the translations in and leaves untranslated strings as they were", () => {
    const out = applyTranslations(spec, { "Here is the plane.": "Her er planet.", Cost: "Kostnad" });

    expect(out.commands?.[0].speak).toBe("Her er planet.");
    expect(out.elements?.[0].x_label).toBe("Kostnad");
    expect(out.elements?.[0].y_label).toBe("Effect"); // no entry: left alone, never blanked
  });
});

describe("translatableStrings", () => {
  const found = translatableStrings(spec);
  const texts = found.map((t) => t.text);

  test("collects the narration, the labels, the axis captions and the title", () => {
    expect(texts).toContain("Here is the plane.");
    expect(texts).toContain("The threshold");
    expect(texts).toContain("Cost");
    expect(texts).toContain("The cost-effectiveness plane");
  });

  test("collects a quiz's question, its choices and its feedback line", () => {
    expect(texts).toContain("Which quadrant dominates?");
    expect(texts).toContain("North-east");
    expect(texts).toContain("Exactly.");
  });

  test("leaves the machinery alone: ids, goto targets, references and lookup keys", () => {
    for (const machinery of ["ax", "note", "start", "Adam Smith", "10.1000/x", "above"]) {
      expect(texts).not.toContain(machinery);
    }
  });

  test("a quote is matched against the real document's text, so it must survive verbatim", () => {
    expect(texts).not.toContain("the invisible hand");
  });

  test("each string carries the role it plays, so a label can be told to stay short", () => {
    expect(found.find((t) => t.text === "Here is the plane.")?.role).toBe("narration");
    expect(found.find((t) => t.text === "Cost")?.role).toBe("axis label");
  });
});

// The measured danger: "a string without an enum" would have translated a math
// expression, a color, a structure string and a reference to another param's
// id. These assert against the REAL manifests, so a new template that adds an
// untranslatable string fails here rather than in a video.
describe("template params", () => {
  const collect = (params: Record<string, unknown>, schema: object): string[] =>
    translatableStrings({ template: "t", params }, schema).map((t) => t.text);

  test("an axis diagram's labels travel; its curve expressions and ids do not", async () => {
    const schema = (await import("../src/scenes/generic_axes_diagram/manifest.json")).default.params_schema;
    const texts = collect({ x_label: "Quantity", curves: [{ id: "demand", label: "Demand", expression: "100 - 2*x" }] }, schema);
    expect(texts).toContain("Quantity");
    expect(texts).toContain("Demand");
    expect(texts).not.toContain("100 - 2*x");
    expect(texts).not.toContain("demand");
  });

  test("a QALY profile's label travels; its color and its shade references do not", async () => {
    const schema = (await import("../src/scenes/qaly_profiles/manifest.json")).default.params_schema;
    const texts = collect(
      { profiles: [{ id: "treated", label: "With treatment", color: "accent" }], shade_between: { a: "treated", b: "usual", gain_label: "Gain" } },
      schema,
    );
    expect(texts).toContain("With treatment");
    expect(texts).toContain("Gain");
    expect(texts).not.toContain("accent");
    expect(texts).not.toContain("treated");
    expect(texts).not.toContain("usual");
  });

  test("a Markov state name and the transitions that name it move together", async () => {
    const schema = (await import("../src/scenes/markov_model/manifest.json")).default.params_schema;
    const params = { states: ["Healthy", "Dead"], transitions: [{ from: "Healthy", to: "Dead", label: "0.1" }] };
    expect(collect(params, schema)).toContain("Healthy");

    // Both sides go through the same source-keyed map, so a renamed state keeps
    // its transitions — the reference cannot be left pointing at a ghost.
    const out = applyTranslations({ template: "t", params }, { Healthy: "Frisk", Dead: "Død" }, schema);
    const p = out.params as { states: string[]; transitions: { from: string; to: string }[] };
    expect(p.states).toEqual(["Frisk", "Død"]);
    expect(p.transitions[0]).toMatchObject({ from: "Frisk", to: "Død" });
  });

  test("a protein's secondary-structure string is data, not prose", async () => {
    const schema = (await import("../src/scenes/protein_secondary/manifest.json")).default.params_schema;
    expect(collect({ ss: "HHHEEECCC", title: "Myoglobin" }, schema)).not.toContain("HHHEEECCC");
  });
});

// Drift guard. A new template that adds a string param joins this list or fails
// here — which is the point: every string on a figure has to be classified as
// prose or as machinery ONCE, deliberately, rather than discovered as a
// mistranslated axis in a finished video.
describe("every bundled template's string params are classified", () => {
  /** A params object whose every string leaf holds its own path, so the real
   *  traversal reports back exactly the paths it considers translatable. */
  function probe(schema: Record<string, any>, path = ""): unknown {
    if (schema?.type === "string") return path;
    if (schema?.type === "array") return [probe(schema.items ?? {}, `${path}[]`)];
    if (schema?.properties) {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(schema.properties)) out[k] = probe(v as Record<string, any>, `${path}.${k}`);
      return out;
    }
    return null;
  }

  test("the translatable set is exactly this, per template", async () => {
    const manifests = import.meta.glob("../src/scenes/*/manifest.json", { eager: true }) as Record<string, { default: { name: string; params_schema: object } }>;
    const actual: Record<string, string[]> = {};
    for (const mod of Object.values(manifests)) {
      const m = mod.default;
      const params = probe(m.params_schema as Record<string, any>) as Record<string, unknown>;
      actual[m.name] = translatableStrings({ template: m.name, params }, m.params_schema).map((t) => t.text);
    }
    expect(actual).toEqual({
      cost_effectiveness_plane: [".x_label", ".y_label", ".points[].label", ".title"],
      decision_tree: [".root.label", ".root.children[].label"],
      free_body: [".body_label", ".forces[].label", ".net_force.label"],
      generic_axes_diagram: [".x_label", ".y_label", ".title", ".curves[].label", ".points[].label", ".vlines[].label", ".hlines[].label"],
      markov_model: [".states[]", ".transitions[].from", ".transitions[].to", ".transitions[].label", ".highlight_state", ".title"],
      protein_secondary: [".segments[].label", ".title"],
      qaly_profiles: [
        ".x_label",
        ".y_label",
        ".profiles[].label",
        ".shade_between.gain_label",
        ".shade_between.loss_label",
        ".reference.label",
        ".shortfall.label",
      ],
      ring_molecule: [".substituents[].text", ".name"],
      supply_demand: [
        ".x_label",
        ".y_label",
        ".demand.label",
        ".supply.label",
        ".equilibrium.label",
        ".equilibrium.q_label",
        ".equilibrium.p_label",
        ".demand_shift.label",
        ".supply_shift.label",
        ".tax.label",
        ".price_ceiling.label",
        ".price_floor.label",
      ],
      timeline: [".title", ".start_label", ".end_label", ".milestones[].label", ".milestones[].sublabel"],
      two_by_two_table: [".row_label", ".col_label", ".row_values[]", ".col_values[]", ".cells[][]", ".title"],
    });
  });
});

// The end-to-end guard: run every bundled drawcast through a translation that
// changes every string, and require the result to still be a valid spec that
// lays out. If the extractor ever reaches a field it should not, a real figure
// breaks here rather than in someone's video.
describe("every bundled drawcast survives being translated", () => {
  test("a full-substitution pass leaves a valid spec, and leaves the original alone", async () => {
    const [{ default: bundled }, { scenes }, { validateSpec }, { parsePlaylistText, itemsOf }] = await Promise.all([
      import("../src/examples.json"),
      import("../src/scenes/registry"),
      import("../src/spec/schema"),
      import("../src/playlist/playlist"),
    ]);
    const specs = (bundled as { spec?: Spec; playlist?: string }[]).flatMap((ex) =>
      ex.spec ? [ex.spec] : ex.playlist ? itemsOf(parsePlaylistText(ex.playlist)).map((i) => i.spec) : [],
    );
    expect(specs.length).toBeGreaterThan(50);

    for (const spec of specs) {
      const before = JSON.stringify(spec);
      const schema = spec.template ? scenes[spec.template]?.manifest.params_schema : undefined;
      const strings = translatableStrings(spec, schema);
      // "Translate" everything: a marker no source string could contain.
      const map = Object.fromEntries(strings.map((t) => [t.text, `«${t.text}»`]));
      const out = applyTranslations(spec, map, schema);

      expect(JSON.stringify(spec)).toBe(before);
      const result = validateSpec(out);
      expect(result.ok, `${spec.title ?? spec.template}: ${result.errors.join("; ")}`).toBe(true);
    }
  });
});

describe("data tokens are never text", () => {
  test("a \"{sim.y}\" param is neither offered to the translator nor rewritten", () => {
    const schema = { type: "object", properties: { labels: { type: "array", items: { type: "string" } }, title: { type: "string" } } };
    const s: Spec = { template: "bar_chart", params: { labels: "{sim.df.country}", title: "GDP" }, elements: [], commands: [] };
    expect(translatableStrings(s, schema).map((t) => t.text)).toEqual(["GDP"]);
    const out = applyTranslations(s, { "{sim.df.country}": "BROKEN", GDP: "BNP" }, schema);
    expect(out.params).toEqual({ labels: "{sim.df.country}", title: "BNP" });
  });
});
