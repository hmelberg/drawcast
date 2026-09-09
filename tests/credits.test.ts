import { describe, expect, test } from "vitest";
import { creditsOf } from "../src/export/credits";
import { embeddedPlaylist } from "../src/publish/embed";
import { itemsOf, parsePlaylistText } from "../src/playlist/playlist";
import { foldedControls } from "../src/ui/controls";

describe("credits", () => {
  test("collects image and icon credits once each, in element order", () => {
    expect(creditsOf([{ elements: [{ id: "a", type: "image", of: "x", credit: "A · CC0" }, { id: "b", type: "icon", of: "y", credit: "lucide · ISC" }, { id: "c", type: "image", of: "x", credit: "A · CC0" }], commands: [] }] as never)).toEqual(["A · CC0", "lucide · ISC"]);
  });
  test("a credit on a GROUP counts too — the seed credit lives there (A1, spec §3.7)", () => {
    expect(
      creditsOf([
        {
          elements: [
            { id: "seed", type: "group", members: ["seed_1"], credit: "based on bee · Noto Emoji · CC BY 4.0" },
            { id: "seed_1", type: "path", points: [[0, 0], [1, 1]] },
            { id: "photo", type: "image", of: "Honeycomb", credit: "Honeycomb · CC BY-SA 4.0" },
          ],
          commands: [],
        },
      ] as never),
    ).toEqual(["based on bee · Noto Emoji · CC BY 4.0", "Honeycomb · CC BY-SA 4.0"]);
  });
  test("credits come from the RESOLVED specs: an image and a CC BY icon both reach the list (A3)", async () => {
    const doc = parsePlaylistText(["elements:", "  - {id: photo, type: image, of: Honeycomb}", "  - {id: bee, type: icon, of: bee}", "commands: []"].join("\n"));
    const out = await embeddedPlaylist(doc, {
      contactEmail: "x@y.z",
      resolvePortraits: async () => [],
      resolveSources: async () => [],
      resolveImages: async (spec) => {
        for (const el of spec.elements ?? []) if (el.type === "image") el.credit = "Honeycomb · Merdal · CC BY-SA 4.0";
        return [];
      },
      resolveIcons: async (spec) => {
        for (const el of spec.elements ?? []) if (el.type === "icon") el.credit = "bee · Noto Emoji · CC BY 4.0";
        return [];
      },
    });
    expect(creditsOf(itemsOf(out).map((i) => i.spec))).toEqual(["Honeycomb · Merdal · CC BY-SA 4.0", "bee · Noto Emoji · CC BY 4.0"]);
    // The bug this pins: reading the UNRESOLVED document gives an empty file.
    expect(creditsOf(itemsOf(doc).map((i) => i.spec))).toEqual([]);
  });
  test("credits slot is folded only when there are credits", () => {
    expect(foldedControls(false, true, true).folded).not.toContain("credits");
    expect(foldedControls(false, true, true, true).folded).toContain("credits");
    expect(foldedControls(false, true, true, true).inline).not.toContain("credits");
  });
});
