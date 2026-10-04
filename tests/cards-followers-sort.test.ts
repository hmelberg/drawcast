// W25: labels on a card follow it into a select's or a sort's box — an
// attach_to label and an element placed `at: {ref: <card>}` alike — and the
// box opens its rows so the label does not land on the card below.
import { describe, expect, test } from "vitest";
import { expandSpec } from "../src/spec/expand";
import { cardsGeometryIn } from "../src/spec/cards";
import { cardsPlanFor } from "../src/render/index";
import type { Spec } from "../src/spec/types";

const sortSpec = (labels: boolean): Spec =>
  ({
    title: "Mammal or not?",
    elements: [
      { id: "an", type: "cards", bins: ["Mammal", "Not"], items: [{ text: "Whale", bin: "Mammal" }, { text: "Shark", bin: "Not" }, { text: "Bat", bin: "Mammal" }, { text: "Penguin", bin: "Not" }] },
      ...(labels
        ? [
            { id: "l_wh", type: "label", text: "big", attach_to: "an_1", side: "below" },
            { id: "l_sh", type: "text", text: "fish", at: { ref: "an_2", side: "below", gap: 8 }, font_size: 24 },
          ]
        : []),
    ],
    commands: [{ draw: ["an"] }, { ask: { question: "Which of these animals are mammals? Sort every card.", on: "an" } }],
  }) as unknown as Spec;

describe("card followers in a sort", () => {
  test("an attach_to label and an at-ref text both follow their card into its box", () => {
    const ex = expandSpec(sortSpec(true));
    const g = cardsGeometryIn(ex, "an")!;
    expect(g.followers?.an_1).toContain("l_wh");
    expect(g.followers?.an_2).toEqual(["l_sh"]);
    const plan = cardsPlanFor(g)!;
    expect(plan.offsets.l_sh).toEqual(plan.offsets.an_2);
    expect(plan.offsets.l_wh).toEqual(plan.offsets.an_1);
  });
  test("the box's rows open by the label's height: Whale's label clears Bat below it", () => {
    const plain = cardsGeometryIn(expandSpec(sortSpec(false)), "an")!;
    const g = cardsGeometryIn(expandSpec(sortSpec(true)), "an")!;
    // The gap between Whale's bottom and Bat's top, in one box.
    const gapUnder = (x: typeof g) => x.truth[0][1] - x.truth[2][1] - x.h;
    expect(gapUnder(g) - gapUnder(plain)).toBeGreaterThanOrEqual(30);
  });
});
