// A gallery of peers (2026-09-23): a live "overview of bridge designs" put
// five bridges in one row fitted to the full band — each at ~0.7×, the page
// two-thirds empty. The prompt now teaches the grid that picks its own
// columns, the list walk with fade, and one colour for a shared category.

import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { specSchema } from "../src/spec/schema";

const compilerV1 = readFileSync(new URL("../src/llm/prompts/compiler-v1.md", import.meta.url), "utf8");

describe("peers are a grid that picks its own columns", () => {
  test("rule 3 says four or more peers are a grid with no columns, and nine is the ceiling", () => {
    expect(compilerV1).toMatch(/leave out `columns` and it picks the count/);
    expect(compilerV1).toMatch(/Four or more PEERS[^.]*`grid` with no `columns`/);
    expect(compilerV1).toMatch(/past about nine, split/);
  });

  test("a category every peer shares is a colour, not a repeated label", () => {
    expect(compilerV1).toMatch(/category every peer shares[^.]*colour/);
  });

  test("the schema says columns may be left out", () => {
    const props = specSchema.properties.elements.items.properties as { columns: { description: string } };
    expect(props.columns.description).toMatch(/Leave it out/);
  });
});

describe("walking a list fades the one just explained", () => {
  test("the fade bullet teaches the walk, the restore, and where not to use it", () => {
    expect(compilerV1).toMatch(/Walking a list of peers one at a time[^.]*fade the one just explained to 0\.3/);
    expect(compilerV1).toMatch(/restore them all \(`to: 1`\)/);
    expect(compilerV1).toMatch(/never fade a part the narration still builds on/);
  });
});

describe("the pedagogy pass checks the walk", () => {
  // A live Sonnet run (2026-09-23) put two galleries in a grid as taught but
  // faded neither: one prompt sentence was not enough, so the teacher's
  // re-read that runs on every generation holds the spec against it too.
  test("the rubric names the walked list, the restore, and the exception", async () => {
    const { PEDAGOGY_RUBRIC } = await import("../src/llm/compile");
    expect(PEDAGOGY_RUBRIC).toMatch(/WALKED LIST[^\n]*fades to 0\.3/);
    expect(PEDAGOGY_RUBRIC).toMatch(/restored \(to: 1\) before anything compares/);
    expect(PEDAGOGY_RUBRIC).toMatch(/Never fade a part the narration still builds on/);
  });
});
