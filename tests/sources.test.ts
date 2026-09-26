// Spec-level `sources` and element `cites` (Hans 2026-09-26): the studies a
// cast names are listed for the viewer, and a claim on the canvas carries the
// study behind it on its info card.

import { describe, expect, test } from "vitest";
import { normalizeSpec, validateSpec } from "../src/spec/schema";
import { cardTargets } from "../src/ui/card-model";
import { citedSources, sourceByline, sourceHref } from "../src/ui/source-model";
import type { Spec } from "../src/spec/types";

const spec = (over: Partial<Spec> = {}): Spec =>
  ({
    sources: [
      { id: "seattle", title: "Evidence from Seattle", authors: "Jardim et al.", year: 2017, url: "https://www.nber.org/papers/w23532" },
      { id: "states", title: "The Effect of Minimum Wages on Low-Wage Jobs", doi: "10.1093/qje/qjz014" },
    ],
    elements: [
      { id: "claim_a", type: "text", text: "It always costs jobs", x: 500, y: 600, cites: ["seattle"] },
      { id: "strike_a", type: "annotation", target: ["claim_a"], kind: "strike" },
    ],
    commands: [{ draw: ["claim_a"] }],
    ...over,
  }) as Spec;

describe("sources", () => {
  test("a valid list and a cites that points into it pass", () => {
    expect(validateSpec(spec()).ok).toBe(true);
  });

  test("a cites naming no source is an error", () => {
    const v = validateSpec(spec({ sources: [{ id: "other", title: "Other" }] }));
    expect(v.ok).toBe(false);
    expect(v.errors.join("\n")).toMatch(/cites "seattle", which is not in sources/);
  });

  test("a made-up doi, a bare url and a repeated id are errors", () => {
    const bad = (sources: Spec["sources"]) => validateSpec(spec({ sources, elements: [], template: "supply_demand" })).errors.join("\n");
    expect(bad([{ id: "a", title: "A", doi: "not-a-doi" }])).toMatch(/is not a DOI/);
    expect(bad([{ id: "a", title: "A", url: "www.example.org" }])).toMatch(/must be a full http/);
    expect(bad([{ id: "a", title: "A" }, { id: "a", title: "B" }])).toMatch(/used twice/);
  });

  test("a bare-string cites is folded to a list", () => {
    const s = normalizeSpec({ ...spec(), elements: [{ id: "c", type: "text", text: "Claim here", x: 1, y: 1, cites: "seattle" }] } as Spec);
    expect((s as Spec).elements![0].cites).toEqual(["seattle"]);
  });

  test("links: a DOI resolves through doi.org, else the url; the byline is who and when", () => {
    const [seattle, states] = spec().sources!;
    expect(sourceHref(states)).toBe("https://doi.org/10.1093/qje/qjz014");
    expect(sourceHref(seattle)).toBe("https://www.nber.org/papers/w23532");
    expect(sourceHref({ id: "x", title: "No link" })).toBeNull();
    expect(sourceByline(seattle)).toBe("Jardim et al. (2017)");
    expect(citedSources(spec(), ["states", "nope"]).map((s) => s.id)).toEqual(["states"]);
  });

  test("the citing element's card carries the study, and the strike through it carries the same card", () => {
    const targets = cardTargets(spec());
    expect(targets.get("claim_a")?.cites?.map((s) => s.id)).toEqual(["seattle"]);
    // The strike sits on the claim and is smaller, so the hit test lands on it.
    expect(targets.get("strike_a")).toBe(targets.get("claim_a"));
  });
});
