import { describe, expect, it } from "vitest";
import { emptyManifest, parseManifest, removedPaths, slugFor, slugify, upsertCourse } from "../src/publish/github";

describe("slugify", () => {
  it("lowercases and hyphenates", () => {
    expect(slugify("Potential Outcomes")).toBe("potential-outcomes");
  });

  it("folds Norwegian letters rather than dropping them", () => {
    expect(slugify("Årsak og effekt")).toBe("arsak-og-effekt");
    expect(slugify("Økonomi")).toBe("okonomi");
  });

  it("drops punctuation and collapses separators", () => {
    expect(slugify("What is a counterfactual?  Really!")).toBe("what-is-a-counterfactual-really");
  });

  it("never returns an empty slug", () => {
    expect(slugify("???")).toBe("lecture");
  });
});

describe("slugFor", () => {
  it("suffixes a collision instead of overwriting", () => {
    expect(slugFor("DiD", new Set(["did"]))).toBe("did-2");
  });

  it("keeps counting past the second collision", () => {
    expect(slugFor("DiD", new Set(["did", "did-2"]))).toBe("did-3");
  });
});

describe("the manifest", () => {
  const entry = { slug: "causal", title: "Causal Inference", files: ["a.yaml", "b.yaml"], updated: "2026-08-30" };

  it("adds a course", () => {
    expect(upsertCourse(emptyManifest(), entry).courses).toHaveLength(1);
  });

  it("replaces a course rather than duplicating it", () => {
    const twice = upsertCourse(upsertCourse(emptyManifest(), entry), { ...entry, title: "Causal Inference II" });
    expect(twice.courses).toHaveLength(1);
    expect(twice.courses[0].title).toBe("Causal Inference II");
  });

  it("leaves other courses alone", () => {
    const m = upsertCourse(upsertCourse(emptyManifest(), entry), { ...entry, slug: "stats", title: "Stats" });
    expect(m.courses.map((c) => c.slug).sort()).toEqual(["causal", "stats"]);
  });

  it("starts fresh on a damaged manifest rather than throwing", () => {
    expect(parseManifest("not json")).toEqual(emptyManifest());
    expect(parseManifest('{"courses":"nope"}')).toEqual(emptyManifest());
  });
});

describe("removedPaths", () => {
  it("names a file the course used to publish and no longer does", () => {
    const m = upsertCourse(emptyManifest(), {
      slug: "causal",
      title: "C",
      files: ["courses/causal/a.yaml", "courses/causal/gone.yaml"],
      updated: "1",
    });
    expect(removedPaths(m, "causal", ["courses/causal/a.yaml"])).toEqual(["courses/causal/gone.yaml"]);
  });

  it("is empty for a course that was never published", () => {
    expect(removedPaths(emptyManifest(), "new", ["x"])).toEqual([]);
  });

  it("is empty when nothing was dropped", () => {
    const m = upsertCourse(emptyManifest(), { slug: "c", title: "C", files: ["a"], updated: "1" });
    expect(removedPaths(m, "c", ["a"])).toEqual([]);
  });
});

describe("slug length", () => {
  it("cuts at a word boundary rather than mid-word", () => {
    expect(slugify("Causal inference in economics: evidence from health and health care")).toBe(
      "causal-inference-in-economics-evidence",
    );
  });

  it("leaves a short title alone", () => {
    expect(slugify("Causal Inference")).toBe("causal-inference");
  });

  it("hard-cuts a single long word rather than returning nothing", () => {
    expect(slugify("a".repeat(80)).length).toBe(40);
  });

  it("never ends on a hyphen", () => {
    expect(slugify("one two three four five six seven eight nine ten")).not.toMatch(/-$/);
  });
});
