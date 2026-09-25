// The card's top heading owns its strip: a figure reaching up through the
// underline passed every overlap rule (a stroke grazing a text is allowed,
// stroke–stroke is never checked). 2026-09-25 example revisions.
import { describe, expect, test } from "vitest";
import { layoutSpec } from "../src/layout/layout";
import { expandSpec } from "../src/spec/expand";
import type { Spec } from "../src/spec/types";

const withPath = (topY: number, x = 500): Spec =>
  expandSpec({
    elements: [{ id: "blob", type: "path", points: [[x - 60, 400], [x, topY], [x + 60, 400]] }],
    commands: [{ card: { title: "A hole in the heart" } }, { draw: ["blob"] }],
  } as Spec);

const intrusions = (spec: Spec) => layoutSpec(spec).issues.filter((i) => i.rule === "heading-intrusion");

describe("heading-intrusion", () => {
  test("a stroke rising through the heading's underline is reported", () => {
    expect(intrusions(withPath(720)).map((i) => i.ids[0])).toEqual(["blob"]);
  });
  test("a stroke that stays below the underline is not", () => {
    expect(intrusions(withPath(640))).toEqual([]);
  });
  test("a tall stroke off to the side of the heading's words is not", () => {
    expect(intrusions(withPath(740, 60))).toEqual([]);
  });
});
