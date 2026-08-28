// Context-disambiguated Wikipedia matching: the same word, "Mercury", must
// resolve to the element in a chemistry figure and the planet in an astronomy
// one — from the figure's OWN words, with no model call and no network.
//
// Candidate sets here are verbatim what en.wikipedia.org's search API returned
// on 2026-08-29, so the fixtures are real answers, not invented ones.

import { describe, expect, test } from "vitest";
import { contextWords, matchWiki, scoreCandidate, words, type WikiCandidate } from "../src/ui/wiki-match";
import { cardTargets } from "../src/ui/card-model";
import type { Spec } from "../src/spec/types";

/** The real search result for "Mercury" (en.wikipedia, 2026-08-29). */
const MERCURY: WikiCandidate[] = [
  { title: "Mercury", description: "Topics referred to by the same term" },
  { title: "Mercury (planet)", description: "First planet from the Sun" },
  { title: "Freddie Mercury", description: "British rock singer and songwriter (1946–1991)" },
  { title: "Mercury Records", description: "American record label" },
  { title: "Mercury (element)", description: "Chemical element with atomic number 80 (Hg)" },
];

const figure = (title: string, speak: string[]): Spec =>
  ({ title, commands: speak.map((s) => ({ speak: s })), elements: [] }) as Spec;

const CHEMISTRY = figure("The periodic table", [
  "Every atom is defined by its atomic number, the count of protons in the nucleus.",
  "Mercury is the one metal that is liquid at room temperature, which is why it filled thermometers for two centuries.",
]);

const ASTRONOMY = figure("The inner solar system", [
  "Each planet orbits the Sun at its own distance, and the closer it sits the faster it travels.",
  "Mercury completes one orbit in eighty-eight days.",
]);

const MUSIC = figure("Stadium rock", ["The singers who defined it had range, and Mercury had four octaves of it."]);

describe("context words", () => {
  test("collects title, narration, labels, axes and string params — stemmed, stopword-free", () => {
    const spec = {
      title: "Waves",
      template: "wave_diagram",
      params: { caption: "Interference", amplitude: 3, nested: { note: "Cancelling" } },
      elements: [
        { id: "a", type: "axes", x_label: "Distance", y_label: "Displacement" },
        { id: "l", type: "label", text: "Crests", attach_to: "a" },
      ],
      commands: [{ speak: "Two waves cancelling." }, { quiz: { question: "What is amplitude?", choices: ["a", "b"], correct: 1 } }],
    } as unknown as Spec;
    const bag = contextWords(spec);
    for (const w of ["wave", "interference", "cancel", "distance", "displacement", "crest", "amplitude", "wave_diagram".replace("_diagram", "")]) {
      expect([...bag].some((t) => t.startsWith(w.slice(0, 4))), w).toBe(true);
    }
    expect(bag.has("the")).toBe(false); // stopwords out
    expect(words("orbits orbiting orbited")).toEqual(["orbit", "orbit", "orbit"]); // one stem
  });
});

describe("matching a word against the figure that contains it", () => {
  test('"Mercury" is the element in a chemistry figure and the planet in an astronomy one', () => {
    const chem = matchWiki(MERCURY, contextWords(CHEMISTRY), "Mercury");
    expect(chem.kind).toBe("confident");
    expect(chem.kind === "confident" && chem.page.title).toBe("Mercury (element)");

    const astro = matchWiki(MERCURY, contextWords(ASTRONOMY), "Mercury");
    expect(astro.kind).toBe("confident");
    expect(astro.kind === "confident" && astro.page.title).toBe("Mercury (planet)");
  });

  test("a genuinely ambiguous figure offers the choice instead of guessing", () => {
    // "singers" and "range" only weakly favour Freddie: the strict threshold
    // (Hans, 2026-08-29) turns that into a question, not a confident answer.
    const m = matchWiki(MERCURY, contextWords(MUSIC), "Mercury");
    expect(m.kind).toBe("choice");
    expect(m.kind === "choice" && m.pages[0].title).toBe("Freddie Mercury"); // best first
    expect(m.kind === "choice" && m.pages.length).toBeLessThanOrEqual(3);
  });

  test("a word no candidate fits leaves the card as it was — plain Search only", () => {
    const waves = figure("Two waves cancel", ["Every crest of one lands on a trough of the other."]);
    expect(matchWiki(MERCURY, contextWords(waves), "Mercury").kind).toBe("choice"); // senses, never a claim
    expect(matchWiki([], contextWords(waves), "Mercury").kind).toBe("none");
    expect(matchWiki([{ title: "Mercury", description: "Topics referred to by the same term" }], contextWords(waves), "Mercury").kind).toBe("none");
  });

  test("a disambiguation page is never a destination, whatever it scores", () => {
    expect(scoreCandidate(MERCURY[0], contextWords(CHEMISTRY), "Mercury")).toBe(-1);
  });

  test("an exact title match counts, or a generic term loses to a longer article", () => {
    // Measured regression: description overlap ALONE ranked
    // "Pulse-amplitude modulation" above the article "Amplitude" in a wave
    // figure, because the longer description shared more words.
    const amplitude: WikiCandidate[] = [
      { title: "Amplitude", description: "Measure of change in a periodic variable" },
      { title: "Amplitude modulation", description: "Electronic method of transmitting information" },
      { title: "Pulse-amplitude modulation", description: "Form of signal modulation" },
    ];
    const waves = figure("Two waves, out of step", [
      "One wave: a disturbance travelling along, rising and falling in a fixed rhythm.",
      "Its two measurements are how tall it swings and how far apart the crests are.",
    ]);
    const m = matchWiki(amplitude, contextWords(waves), "Amplitude");
    expect(m.kind).toBe("confident");
    expect(m.kind === "confident" && m.page.title).toBe("Amplitude");
  });

  test("the thumbnail rides along when the page has one", () => {
    const withThumb: WikiCandidate[] = [{ ...MERCURY[4], thumbnail: "https://upload.wikimedia.org/hg.jpg" }];
    const m = matchWiki(withThumb, contextWords(CHEMISTRY), "Mercury");
    expect(m.kind === "confident" && m.page.thumbnail).toBe("https://upload.wikimedia.org/hg.jpg");
  });
});

describe("which text on the canvas carries a card", () => {
  test("a node's text and a tier-3 text are as clickable as a label's", () => {
    const spec = {
      elements: [
        { id: "n1", type: "node", shape: "rect", text: "Confounding" },
        { id: "t1", type: "text", text: "Selection bias", x: 500, y: 300 },
        { id: "l1", type: "label", text: "Exposure", attach_to: "n1" },
        { id: "sym", type: "node", shape: "circle", text: "P*" },
      ],
      commands: [],
    } as unknown as Spec;
    const targets = cardTargets(spec);
    expect(targets.get("n1")?.name).toBe("Confounding");
    expect(targets.get("t1")?.name).toBe("Selection bias");
    expect(targets.get("l1")?.name).toBe("Exposure");
    // A symbol is not a thing to look up — meaningfulName screens it out.
    expect(targets.has("sym")).toBe(false);
  });

  test("only a LABEL reaches through to what it attaches to", () => {
    const spec = {
      elements: [
        { id: "curve", type: "curve", direction: "increasing" },
        { id: "lab", type: "label", text: "Demand", attach_to: "curve" },
        { id: "box", type: "node", shape: "rect", text: "Supply", attach_to: "curve" },
      ],
      commands: [],
    } as unknown as Spec;
    const targets = cardTargets(spec);
    // The label names the curve; the node names only itself, since a node has
    // no "the thing I am beside" relationship to reach through.
    expect(targets.get("curve")?.name).toBe("Demand");
    expect(targets.get("box")?.name).toBe("Supply");
  });
});
