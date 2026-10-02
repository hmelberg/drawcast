import { describe, expect, test } from "vitest";
import bundled from "../src/examples.json";
import { decodeIconSvg, iconAssetName, iconLookOf, iconSlots, storedIcon } from "../src/spec/icon-data";
import { itemsOf, parsePlaylistText, singlePlaylist } from "../src/playlist/playlist";
import type { Spec } from "../src/spec/types";

// Final fix I, item 5: in "What each drug does" Penicillin's card read as
// "0" — a monochrome outline (tabler "capsule") beside colour emoji. Its
// keyword now finds a colour twemoji picture, like the cards round it.
describe("What each drug does: every card icon is a colour picture", () => {
  const specs = (bundled as { spec?: Spec; playlist?: string }[]).flatMap((e) => (e.playlist ? itemsOf(parsePlaylistText(e.playlist)).map((i) => i.spec) : e.spec ? itemsOf(singlePlaylist(e.spec)).map((i) => i.spec) : []));
  const spec = specs.find((s) => JSON.stringify(s).includes('"Kills bacteria"'))!;
  test("Penicillin's icon resolves to twemoji with fill colours", () => {
    expect(spec).toBeDefined();
    const cards = spec.elements!.find((e) => e.type === "cards")!;
    const pen = (cards.items as Record<string, unknown>[]).find((i) => i.text === "Penicillin")!;
    const slot = iconSlots(spec).find((s) => s.host === pen && s.data === "icon_strokes")!;
    const data = storedIcon(spec, iconAssetName(slot.ask, iconLookOf(cards)));
    const svg = decodeIconSvg(data);
    expect(svg?.set).toBe("twemoji");
    expect(svg!.svg).toMatch(/fill="#[0-9a-f]{3,6}"/i);
  });
});
