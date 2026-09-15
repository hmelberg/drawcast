import { describe, expect, test } from "vitest";
import { isInvitation } from "../src/lint/invite";
import { lintCommands } from "../src/lint/lint";
import type { Spec } from "../src/spec/types";

const spec = (commands: object[]): Spec =>
  ({ elements: [{ id: "t", type: "text", text: "hi", x: 500, y: 375 }], commands }) as unknown as Spec;
const rules = (s: Spec) => lintCommands(s).filter((i) => i.rule === "explore-invite");

describe("isInvitation", () => {
  test("invitation words at a clause start trip", () => {
    for (const t of ["Slide the rate down.", "Now drag the knob.", "Press Draw again.", "Try it: click a square.", "Toggle the log scale.", "Set the rate to zero.", "Dra i glidebryteren.", "Trykk på knappen.", "Prøv selv."]) {
      expect(isInvitation(t), t).toBe(true);
    }
  });
  test("narration about the mechanism does not trip", () => {
    for (const t of ["Try to guess where the peak lands.", "The slide rule was invented in 1622.", "Pressure rises with depth.", "A landslide moves the mass.", "We set the seed once."]) {
      expect(isInvitation(t), t).toBe(false);
    }
  });
  test("a hyphenated compound built on an invitation word does not trip (final wave item 10)", () => {
    for (const t of ["Click-through rates rose that quarter.", "Press-fit parts need no glue."]) {
      expect(isInvitation(t), t).toBe(false);
    }
  });
});

describe("explore-invite lint", () => {
  test("an ordinary speak that invites interaction warns", () => {
    const [i] = rules(spec([{ draw: ["t"], speak: "Now slide the rate down and watch." }]));
    expect(i).toMatchObject({ severity: "warn" });
    expect(i.message).toContain("explore");
  });
  test("the same line in an explore beat is fine", () => {
    expect(rules(spec([{ draw: ["t"] }, { explore: { params: ["x"] }, speak: "Now slide the rate down and watch." }]))).toEqual([]);
  });
  test("a standalone speak is checked too", () => {
    expect(rules(spec([{ draw: ["t"] }, { speak: "Press the button." }]))).toHaveLength(1);
  });
  test("the quoted preview gets an ellipsis only when something was actually cut (final wave item 9)", () => {
    const short = "Now drag the knob."; // 18 chars, shown whole
    const [shortIssue] = rules(spec([{ draw: ["t"], speak: short }]));
    expect(shortIssue.message).toContain(`"${short}"`);
    expect(shortIssue.message).not.toContain("…");

    const long = "Now slide the rate down and watch the curve flatten out completely."; // 67 chars, cut
    const [longIssue] = rules(spec([{ draw: ["t"], speak: long }]));
    expect(longIssue.message).toContain(`"${long.slice(0, 40)}…"`);
  });
});
