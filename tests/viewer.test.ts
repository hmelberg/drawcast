import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { parseViewerHash } from "../src/viewer";
import { desmartenJson, extractJson } from "../src/spec/extract";

describe("parseViewerHash", () => {
  test("accepts #gdoc=<id> with defaults", () => {
    const r = parseViewerHash("#gdoc=1AbC_dEf-123456789");
    expect(r).toMatchObject({ docId: "1AbC_dEf-123456789", style: "clean", mode: "narrated" });
  });

  test("accepts #gdoc-<id> and extra params", () => {
    const r = parseViewerHash("#gdoc-1AbC_dEf-123456789&style=sketchy&mode=silent&speed=1.5");
    expect(r).toMatchObject({ docId: "1AbC_dEf-123456789", style: "sketchy", mode: "silent", speed: 1.5 });
  });

  test("maps legacy draw backend params onto styles", () => {
    expect(parseViewerHash("#gdoc=1AbC_dEf-123456789&backend=custom-svg")).toMatchObject({ style: "sketchy" });
    expect(parseViewerHash("#gdoc=1AbC_dEf-123456789&backend=clean-svg")).toMatchObject({ style: "clean" });
  });

  test("returns null without a gdoc fragment", () => {
    expect(parseViewerHash("#something-else")).toBeNull();
    expect(parseViewerHash("")).toBeNull();
  });

  test("accepts #gdrive=<id> and #gdrive-<id> with params", () => {
    expect(parseViewerHash("#gdrive=1AbC_dEf-123456789")).toMatchObject({ driveId: "1AbC_dEf-123456789", style: "clean", mode: "narrated" });
    expect(parseViewerHash("#gdrive-1AbC_dEf-123456789&style=sketchy")).toMatchObject({ driveId: "1AbC_dEf-123456789", style: "sketchy" });
  });

  test("a gdrive id never leaks into gdoc parsing", () => {
    expect(parseViewerHash("#gdrive=1AbC_dEf-123456789")!.docId).toBeUndefined();
  });

  test("a request carries no learner: the account is the identity, not a code on the link", () => {
    expect(parseViewerHash("#gdoc=1AbC_dEf-123456789&learner=fjell-rev-havn")).not.toHaveProperty("learner");
  });
});

// Drift guard: entry.ts's dispatch regex is a separate, hand-maintained copy
// of "which hash prefixes boot the viewer" — a real drawcast.app link with a
// prefix parseViewerHash accepts but this regex doesn't would silently fall
// through to the full editor bundle instead of the viewer.
describe("entry.ts dispatch regex", () => {
  test("names gdrive and anvil alongside gdoc and gh", () => {
    // Strip line comments first: a comment mentioning "gdrive" (or even the
    // regex literal as prose) must not be enough to satisfy this — only the
    // actual dispatch regex's alternation counts.
    const entry = readFileSync(new URL("../src/entry.ts", import.meta.url), "utf8");
    const withoutComments = entry.replace(/^\s*\/\/.*$/gm, "");
    expect(withoutComments).toContain("gdrive"); // truthy guard: fails loudly if stripping ate everything
    expect(withoutComments).toMatch(/\(gdoc\|gh\|gdrive\|anvil\)\[=-\]/);
  });
});

describe("desmartenJson", () => {
  test("repairs word-processor quotes so the JSON parses", () => {
    const doc = "My spec:\n\n{“template”: “supply_demand”, “commands”: []}";
    const spec = extractJson(desmartenJson(doc)) as { template: string };
    expect(spec.template).toBe("supply_demand");
  });

  test("strips BOM and non-breaking spaces", () => {
    const doc = '﻿{"a": 1}';
    expect(extractJson(desmartenJson(doc))).toEqual({ a: 1 });
  });
});
