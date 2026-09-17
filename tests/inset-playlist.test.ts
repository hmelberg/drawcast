import { describe, expect, test } from "vitest";
import { parsePlaylistText } from "../src/playlist/playlist";

const doc = (of: string) => `playlist:
  title: T
---
title: The model
elements:
  - { id: tri, type: polygon, points: [[100, 100], [300, 100], [200, 300]] }
commands:
  - draw: [tri]
---
chapter: Later
---
title: Conclusion
elements:
  - { id: pic, type: inset, of: ${of} }
commands:
  - draw: [pic]
`;

describe("inset references in a playlist (spec §4.10)", () => {
  test("a title, a number and previous resolve without a warning; chapters do not count", () => {
    for (const of of ['"The model"', "1", '"previous"']) {
      expect(parsePlaylistText(doc(of)).warnings, of).toEqual([]);
    }
  });
  test("a miss and a self-reference warn, naming the item and the inset", () => {
    expect(parsePlaylistText(doc('"Nope"')).warnings).toEqual(['item 2: inset "pic": no item titled "Nope"']);
    expect(parsePlaylistText(doc("2")).warnings).toEqual(['item 2: inset "pic": an inset cannot show its own page']);
  });
});
