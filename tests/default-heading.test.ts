// The default heading (page frame spec 2026-10-04 §2): a titled page with no
// `card` gets its title drawn as the top heading, quickly and unnarrated, just
// before the first ink — and the escape hatches and exclusions hold.

import { describe, expect, test } from "vitest";
import { expandSpec } from "../src/spec/expand";
import { DEFAULT_HEADING, pageHeading, withoutDefaultHeading } from "../src/spec/card";
import { validateSpec } from "../src/spec/schema";
import { layoutSpec } from "../src/layout/layout";
import { lintCommands } from "../src/lint/lint";
import { parseScript, printScript } from "../src/spec/script";
import type { Spec } from "../src/spec/types";

const base = (over: Partial<Spec> = {}): Spec => ({
  title: "Why the sky is blue",
  elements: [{ id: "sun", type: "shape", shape: "circle", x: 500, y: 400, radius: 80 }],
  commands: [{ speak: "Look up." }, { draw: ["sun"], speak: "Here is the sun." }],
  ...over,
});

describe("default heading", () => {
  test("a titled page with no card gets the title as heading, drawn just before the first ink", () => {
    const s = expandSpec(base());
    const title = s.elements!.find((e) => e.id === `${DEFAULT_HEADING}_title`);
    expect(title).toMatchObject({ type: "text", text: "Why the sky is blue" });
    expect(s.elements!.some((e) => e.id === `${DEFAULT_HEADING}_line`)).toBe(true);
    // The announcement stays first; the heading beat is unnarrated and parallel.
    expect(s.commands![0]).toEqual({ speak: "Look up." });
    expect(s.commands![1]).toEqual({ draw: [`${DEFAULT_HEADING}_title`, `${DEFAULT_HEADING}_line`], parallel: true });
    expect(s.commands![2].draw).toEqual(["sun"]);
  });

  test("expanding twice adds it once", () => {
    const once = expandSpec(base());
    expect(expandSpec(once)).toEqual(once);
  });

  test("heading: a string draws that text; false draws none", () => {
    expect(pageHeading(base({ heading: "Blue skies" }))).toBe("Blue skies");
    expect(pageHeading(base({ heading: false }))).toBeNull();
    expect(pageHeading(base({ heading: "  " }))).toBeNull();
  });

  test("no heading: no title, a card of either style, a book part, an end page, no commands", () => {
    expect(pageHeading(base({ title: undefined }))).toBeNull();
    expect(pageHeading(base({ commands: [{ card: { title: "X" } }, { draw: ["sun"] }] }))).toBeNull();
    expect(pageHeading(base({ commands: [{ card: { title: "X", style: "center" } }, { draw: ["sun"] }] }))).toBeNull();
    expect(pageHeading(base({ book: {} as Spec["book"] }))).toBeNull();
    expect(pageHeading(base({ end_page: true }))).toBeNull();
    expect(pageHeading(base({ commands: [] }))).toBeNull();
  });

  test("it yields to a figure the author already drew in the heading strip", () => {
    const own = base({ elements: [{ id: "t", type: "text", text: "My own title", x: 500, y: 710 }] });
    expect(pageHeading(own)).toBeNull();
    // Placed relative to something: not judged statically.
    const rel = base({ elements: [{ id: "sun", type: "shape", shape: "circle", x: 500, y: 300, radius: 40 }, { id: "t", type: "text", text: "Sun", at: { ref: "sun", side: "above" } }] });
    expect(pageHeading(rel)).toBe("Why the sky is blue");
  });

  test("the heading sets the page's heading floor like a card's", () => {
    const s = expandSpec(base());
    const l = layoutSpec(s);
    expect(l.drawables.some((d) => d.id === `${DEFAULT_HEADING}_title`)).toBe(true);
    expect(l.issues).toEqual([]);
  });

  test("the heading beat is not the first ink for slow-start", () => {
    const s = expandSpec(base({ commands: [{ speak: "One." }, { speak: "Two." }, { draw: ["sun"] }] }));
    expect(lintCommands(s).some((i) => i.rule === "slow-start")).toBe(true);
  });

  test("an inset's picture leaves it out", () => {
    const s = withoutDefaultHeading(expandSpec(base()));
    expect(s.elements!.some((e) => e.id.startsWith(DEFAULT_HEADING))).toBe(false);
    expect(s.commands!.some((c) => Array.isArray(c.draw) && c.draw.some((id) => String(id).startsWith(DEFAULT_HEADING)))).toBe(false);
  });

  test("the schema takes a string or false, nothing else", () => {
    expect(validateSpec(base({ heading: "Other" })).ok).toBe(true);
    expect(validateSpec(base({ heading: false })).ok).toBe(true);
    expect(validateSpec({ ...base(), heading: true } as unknown as Spec).ok).toBe(false);
  });

  test("a .cast file carries heading: as a page setting", () => {
    for (const heading of [false, "Blue skies"] as const) {
      const text = printScript(base({ heading }));
      expect(text).toContain("heading:");
      expect(parseScript(text).heading).toBe(heading);
    }
  });
});
