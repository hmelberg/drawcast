// In a book, `erase` of a figure group (a cards set) erases the figure, not a text block (2026-10-05).
import { expect, test } from "vitest";
import { expandSpec } from "../src/spec/expand";
import { layoutSpec } from "../src/layout/layout";
import { planCommands } from "../src/render/plan";

const spec = {
  title: "T",
  book: { layout: "columns", look: "mixed" },
  elements: [{ id: "cs", type: "cards", bins: ["Can", "Cannot"], items: [{ text: "Odds ratio", bin: "Can" }, { text: "Risk", bin: "Cannot" }] }],
  commands: [
    { draw: ["cs"], speak: "Sort these." },
    { write: { id: "note", text: "A note" }, speak: "A note." },
    { erase: ["cs"], speak: "Now the cards go." },
    { erase: ["note"], speak: "And the note." },
  ],
};

test("erasing the cards group plans a figure erase; erasing a text block stays a text op", () => {
  const s = expandSpec(spec as never);
  const order = layoutSpec(s).order;
  // The renderer's group map (render/index.ts expandGroup): the cards set stands for its leaves.
  const p = planCommands(s.commands, order, { book: true, expandGroup: (id: string) => (id === "cs" ? order.filter((k) => k.startsWith("cs_")) : []) } as never);
  const erases = p.steps.filter((st) => st.kind === "erase") as { ids: string[] }[];
  expect(erases.length).toBe(1);
  expect(erases[0].ids.some((id) => id.startsWith("cs_"))).toBe(true);
});

import { heldFrom } from "../src/render/plan";

test("a book that clears its figure and goes on in the text pane does not hold the last frame", () => {
  const s = expandSpec(spec as never);
  const order = layoutSpec(s).order;
  const p = planCommands(s.commands, order, { book: true, expandGroup: (id: string) => (id === "cs" ? order.filter((k) => k.startsWith("cs_")) : []) } as never);
  expect(p.states[p.states.length - 1].visible.length).toBe(0);
  expect(heldFrom(p)).toBeNull();
});
